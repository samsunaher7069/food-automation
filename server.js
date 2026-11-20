'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { loadEnv } = require('./lib/util');
loadEnv();

const db = require('./lib/db');
const ai = require('./lib/ai');
const nutritionLib = require('./lib/nutrition');
const providers = require('./lib/providers');
const pipeline = require('./lib/pipeline');
const {
  ENV, HttpError, randomToken, sha256, hashPassword, verifyPassword,
  zonedParts, isValidTimezone, hhmmToMinutes, minutesToHHMM, truncate, isSimilarTopic,
} = require('./lib/util');

const APP_VERSION = '1.0.0';
const SESSION_COOKIE = 'nourish_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'data', 'media');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; "
    + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    + "font-src 'self' https://fonts.gstatic.com data:; "
    + "script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self' https:; frame-ancestors 'none'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = ENV.isProd || ENV.appUrl.startsWith('https://');
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS, path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}

async function createSession(userId, res) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = new Date();
  await db.run(
    `INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sha256(token), userId, csrf, new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString()],
  );
  setSessionCookie(res, token);
  return { token, csrf };
}

function sessionUser(req) {
  return req.user || null;
}

async function loadSession(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    req.user = null; req.session = null;
    if (token) {
      const row = await db.get(
        `SELECT s.id AS session_id, s.csrf, s.expires_at, u.id AS user_id, u.username, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
        [sha256(token)],
      );
      if (row && new Date(row.expires_at).getTime() > Date.now()) {
        req.user = { id: row.user_id, username: row.username, createdAt: row.created_at };
        req.session = { id: row.session_id, csrf: row.csrf };
      } else if (row) {
        await db.run(`DELETE FROM sessions WHERE id = ?`, [row.session_id]);
        clearSessionCookie(res);
      }
    }
    next();
  } catch (err) { next(err); }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.headers['x-csrf-token'];
  if (!req.session || !sent || String(sent) !== req.session.csrf) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Refresh the page and try again.' });
  }
  next();
}

function requireCron(req, res, next) {
  if (req.user) return next();
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured on the server.' });
  const sent = req.headers['x-cron-secret'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!sent || sent !== secret) return res.status(401).json({ error: 'Invalid cron secret.' });
  next();
}

const CATEGORIES = ['High Protein', 'Healthy Breakfast', 'Healthy Lunch', 'Healthy Dinner', 'Meal Prep',
  'Muscle Building', 'Weight Management', 'Healthy Snacks', 'Protein Smoothies', 'Low Calorie',
  'Budget Meals', 'Healthy Desserts', 'Custom'];

const IMAGE_STYLES = ['Realistic Food Photography', 'Professional Restaurant Photography', 'Homemade Food Photography',
  'Meal Prep Photography', 'Minimalist Food Photography', 'Rustic Food Photography', 'Custom'];

const LANGUAGES = ['English', 'Bengali', 'Hindi', 'Urdu', 'Spanish', 'French', 'German', 'Arabic', 'Portuguese', 'Turkish', 'Indonesian'];

function str(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intOr(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function pageParams(req) {
  const page = intOr(req.query.page, 1, 1, 10_000);
  const limit = intOr(req.query.limit, 12, 1, 50);
  return { page, limit, offset: (page - 1) * limit };
}

async function userCount() {
  const row = await db.get(`SELECT COUNT(*) AS c FROM users`);
  return Number(row?.c || 0);
}

async function ensureAdminFromEnv() {
  if (await userCount()) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  await db.run(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), username, hashPassword(password), new Date().toISOString()]);
  await db.logEvent({ level: 'info', service: 'auth', operation: 'admin.bootstrap', message: 'Initial admin created from environment variables.' });
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.');
  }
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
}

/* ------------------------------------------------------------------ */
/* Bootstrap / auth                                                    */
/* ------------------------------------------------------------------ */

app.use(['/api', '/auth'], loadSession);

app.get('/health', asyncHandler(async (req, res) => {
  let dbOk = true; let dbError = '';
  try { await db.query('SELECT 1'); } catch (err) { dbOk = false; dbError = err.message; }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded', version: APP_VERSION, database: dbOk ? 'connected' : 'unavailable',
    driver: db.driver, uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString(),
    ...(dbError ? { error: dbError } : {}),
  });
}));

app.get('/api/bootstrap', asyncHandler(async (req, res) => {
  res.json({
    appName: 'Nourish Studio', version: APP_VERSION,
    setupRequired: (await userCount()) === 0,
    authenticated: Boolean(req.user),
    oauth: {
      googleConfigured: Boolean((await providers.oauthCreds('google')).clientId),
      pinterestConfigured: Boolean((await providers.oauthCreds('pinterest')).clientId),
    },
  });
}));

app.post('/api/setup', asyncHandler(async (req, res) => {
  if (!rateLimit(`setup:${clientIp(req)}`, 10, 15 * 60_000)) throw new HttpError(429, 'Too many setup attempts. Try again later.');
  if (await userCount() > 0) throw new HttpError(409, 'An admin account already exists. Sign in instead.');
  const username = str(req.body.username, 60) || str(process.env.ADMIN_USERNAME, 60);
  const password = req.body.password || process.env.ADMIN_PASSWORD;
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username || '')) throw new HttpError(400, 'Username must be 3–40 characters (letters, numbers, dot, dash, underscore).');
  validatePassword(password);
  const id = crypto.randomUUID();
  await db.run(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
    [id, username, hashPassword(password), new Date().toISOString()]);
  if (req.body.siteName) await db.saveSettings({ siteName: str(req.body.siteName, 80) });
  const { csrf } = await createSession(id, res);
  await db.logEvent({ level: 'success', service: 'auth', operation: 'admin.create', message: `Admin account "${username}" created.` });
  res.status(201).json({ ok: true, csrf, user: { id, username } });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000)) throw new HttpError(429, 'Too many login attempts. Try again in a few minutes.');
  const username = str(req.body.username, 60);
  const password = String(req.body.password || '');
  const user = await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    await db.logEvent({ level: 'warning', service: 'auth', operation: 'login', status: 'failed', message: `Failed login for "${truncate(username, 40)}" from ${clientIp(req)}` });
    throw new HttpError(401, 'Incorrect username or password.');
  }
  await db.run(`DELETE FROM sessions WHERE expires_at < ?`, [new Date().toISOString()]);
  const { csrf } = await createSession(user.id, res);
  await db.logEvent({ level: 'success', service: 'auth', operation: 'login', message: `Login: ${user.username}` });
  res.json({ ok: true, csrf, user: { id: user.id, username: user.username } });
}));

app.post('/api/logout', requireCsrf, asyncHandler(async (req, res) => {
  if (req.session) await db.run(`DELETE FROM sessions WHERE id = ?`, [req.session.id]);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/session', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  res.json({
    authenticated: Boolean(req.user),
    setupRequired: (await userCount()) === 0,
    user: req.user ? { username: req.user.username, createdAt: req.user.createdAt } : null,
    csrf: req.session?.csrf || null,
    setupCompleted: Boolean(settings.setup?.completed),
    siteName: settings.siteName,
    version: APP_VERSION,
  });
}));

/* All /api routes below require a session. */
app.use('/api', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/cron/run')) return next(); // validated by requireCron
  return requireAuth(req, res, () => requireCsrf(req, res, next));
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/dashboard', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  const tz = settings.timezone || 'Asia/Dhaka';
  const { startIso: todayStart, endIso: todayEnd } = pipeline.localDayBounds(tz);
  const monthDate = new Date(); const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1)).toISOString();

  const statusRows = await db.query(`SELECT status, COUNT(*) AS c FROM posts GROUP BY status`);
  const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.c)]));
  const totals = await db.get(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN blogger_url IS NOT NULL AND blogger_url <> '' THEN 1 ELSE 0 END) AS blogger_published,
      SUM(CASE WHEN pinterest_pin_id IS NOT NULL AND pinterest_pin_id <> '' THEN 1 ELSE 0 END) AS pinterest_published
    FROM posts`);
  const todayRow = await db.get(`SELECT COUNT(*) AS c FROM posts WHERE created_at >= ? AND created_at < ?`, [todayStart, todayEnd]);
  const monthRow = await db.get(`SELECT COUNT(*) AS c FROM posts WHERE created_at >= ?`, [monthStart]);
  const recentPosts = await db.query(`SELECT * FROM posts ORDER BY created_at DESC LIMIT 6`);
  const recentLogs = await db.query(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 8`);
  const recentRuns = await db.query(`SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 6`);
  const lastRun = await db.get(`SELECT * FROM automation_runs WHERE status = 'Completed' ORDER BY finished_at DESC LIMIT 1`);
  const nextRun = await pipeline.nextScheduledRun(settings);
  const todayAutomation = await pipeline.automationRunCount(tz);
  const pendingErrors = await db.get(`SELECT COUNT(*) AS c FROM posts WHERE status = 'failed'`);

  res.json({
    stats: {
      totalPosts: Number(totals?.total || 0),
      bloggerPublished: Number(totals?.blogger_published || 0),
      pinterestPublished: Number(totals?.pinterest_published || 0),
      drafts: statusCounts.draft || 0,
      generated: statusCounts.generated || 0,
      scheduled: statusCounts.scheduled || 0,
      failed: statusCounts.failed || 0,
      published: statusCounts.published || 0,
      partiallyPublished: statusCounts.partially_published || 0,
      today: Number(todayRow?.c || 0),
      thisMonth: Number(monthRow?.c || 0),
      pendingErrors: Number(pendingErrors?.c || 0),
    },
    automation: {
      enabled: Boolean(settings.automation?.enabled),
      manualApproval: Boolean(settings.automation?.manualApproval),
      postsPerDay: settings.automation?.postsPerDay || 1,
      times: settings.automation?.times || [],
      timezone: tz,
      nextRun,
      lastRun: lastRun ? {
        id: lastRun.id, finishedAt: lastRun.finished_at, postId: lastRun.post_id,
        trigger: lastRun.trigger, status: lastRun.status,
      } : null,
      todayCount: todayAutomation,
    },
    recentPosts: recentPosts.map(pipeline.serializePost),
    recentLogs,
    recentRuns,
    connections: await providers.connectionSummary(),
    empty: Number(totals?.total || 0) === 0,
  });
}));

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

function postInput(body = {}) {
  const goals = body.nutritionGoals;
  return {
    topic: str(body.topic, 160),
    category: str(body.category, 60) || 'High Protein',
    language: str(body.language, 40) || 'English',
    servings: intOr(body.servings, 2, 1, 50),
    imagePrompt: str(body.imagePrompt, 4000),
    customInstructions: str(body.customInstructions, 3000),
    nutritionGoals: goals && typeof goals === 'object' ? {
      calories: goals.calories === '' || goals.calories == null ? null : num(goals.calories),
      protein: goals.protein === '' || goals.protein == null ? null : num(goals.protein),
      fat: goals.fat === '' || goals.fat == null ? null : num(goals.fat),
      carbs: goals.carbs === '' || goals.carbs == null ? null : num(goals.carbs),
      fiber: goals.fiber === '' || goals.fiber == null ? null : num(goals.fiber),
    } : null,
  };
}

app.get('/api/posts', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const where = []; const params = [];
  const status = str(req.query.status, 40);
  if (status && status !== 'all') {
    if (status === 'blogger') { where.push(`blogger_status = 'published'`); }
    else if (status === 'pinterest') { where.push(`pinterest_status = 'published'`); }
    else { where.push('status = ?'); params.push(status); }
  }
  if (str(req.query.category, 60)) { where.push('category = ?'); params.push(str(req.query.category, 60)); }
  const search = str(req.query.search, 100);
  if (search) {
    where.push('(LOWER(topic) LIKE ? OR LOWER(COALESCE(title, \'\')) LIKE ? OR LOWER(COALESCE(category, \'\')) LIKE ?)');
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM posts ${whereSql}`, params);
  const total = Number(totalRow?.c || 0);
  const rows = await db.query(
    `SELECT * FROM posts ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({
    items: rows.map(pipeline.serializePost), total, page, limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: await db.query(`SELECT status, COUNT(*) AS c FROM posts GROUP BY status`),
  });
}));

app.get('/api/posts/:id', asyncHandler(async (req, res) => {
  const post = await pipeline.getPost(req.params.id);
  if (!post) throw new HttpError(404, 'Post not found.');
  const images = await db.query(`SELECT * FROM post_images WHERE post_id = ? ORDER BY created_at DESC`, [post.id]);
  const records = await db.query(`SELECT * FROM publishing_records WHERE post_id = ? ORDER BY updated_at DESC`, [post.id]);
  res.json({ post, images, publishingRecords: records });
}));

app.post('/api/posts', asyncHandler(async (req, res) => {
  const input = postInput(req.body);
  if (!input.topic) throw new HttpError(400, 'A topic is required.');
  const post = await pipeline.createPost({ ...input, source: 'manual' });
  const dup = await db.query(`SELECT topic FROM topics WHERE topic <> ? ORDER BY created_at DESC LIMIT 200`, [input.topic]);
  const similar = dup.filter((r) => isSimilarTopic(r.topic, input.topic)).map((r) => r.topic);
  await db.logEvent({ level: 'info', service: 'app', operation: 'post.create', postId: post.id, message: `Draft created: ${truncate(input.topic, 120)}` });
  res.status(201).json({ post, similarTopics: similar });
}));

app.put('/api/posts/:id', asyncHandler(async (req, res) => {
  const existing = await pipeline.getPost(req.params.id);
  if (!existing) throw new HttpError(404, 'Post not found.');
  const body = req.body || {};
  const patch = {};
  const allowed = ['topic', 'title', 'seoTitle', 'description', 'category', 'language', 'imagePrompt',
    'customInstructions', 'imageAlt', 'pinterestTitle', 'pinterestDescription', 'bloggerContent',
    'imageUrl', 'imageLocalUrl', 'imageMime', 'imageWidth', 'imageHeight'];
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = str(body[key], key === 'bloggerContent' ? 200_000 : 4000);
  }
  if (body.servings !== undefined) patch.servings = intOr(body.servings, existing.servings, 1, 50);
  if (body.recipe !== undefined) {
    if (body.recipe !== null && typeof body.recipe !== 'object') throw new HttpError(400, 'Recipe must be an object.');
    patch.recipe = body.recipe;
  }
  if (body.nutrition !== undefined) {
    if (body.nutrition !== null && typeof body.nutrition !== 'object') throw new HttpError(400, 'Nutrition must be an object.');
    patch.nutrition = body.nutrition;
  }
  if (body.pinterestTags !== undefined) {
    patch.pinterestTags = Array.isArray(body.pinterestTags) ? body.pinterestTags.map(String).slice(0, 30)
      : (typeof body.pinterestTags === 'string' ? body.pinterestTags.split(',').map((s) => s.trim()).filter(Boolean) : []);
  }
  if (body.nutritionGoals !== undefined) patch.nutritionGoals = body.nutritionGoals;
  await pipeline.updatePost(existing.id, patch);
  if (patch.title || patch.recipe || patch.description) {
    // keep SEO title in sync when the user edits manually and field was left blank
    const fresh = await pipeline.getPost(existing.id);
    if (fresh && !fresh.seoTitle && fresh.title) await pipeline.updatePost(existing.id, { seoTitle: fresh.title.slice(0, 70) });
  }
  const post = await pipeline.getPost(existing.id);
  await db.logEvent({ level: 'info', service: 'app', operation: 'post.update', postId: post.id, message: 'Post updated manually.' });
  res.json({ post });
}));

app.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  const post = await pipeline.getPost(req.params.id);
  if (!post) throw new HttpError(404, 'Post not found.');
  const remote = str(req.query.remote, 100).split(',').map((s) => s.trim()).filter(Boolean);
  const remoteResults = [];
  const settings = await db.getSettings();
  if (remote.includes('blogger') && post.bloggerPostId && settings.blogger?.defaultBlogId) {
    try {
      await providers.deleteBloggerPost(settings.blogger.defaultBlogId, post.bloggerPostId);
      remoteResults.push({ platform: 'blogger', ok: true });
    } catch (err) { remoteResults.push({ platform: 'blogger', ok: false, error: err.message }); }
  }
  if (remote.includes('pinterest') && post.pinterestPinId) {
    try {
      await providers.deletePinterestPin(post.pinterestPinId);
      remoteResults.push({ platform: 'pinterest', ok: true });
    } catch (err) { remoteResults.push({ platform: 'pinterest', ok: false, error: err.message }); }
  }
  const remoteFailures = remoteResults.filter((r) => !r.ok);
  if (remoteFailures.length) {
    throw new HttpError(502, `Remote deletion failed, so the local post was kept: ${remoteFailures.map((r) => `${r.platform}: ${r.error}`).join(' | ')}`);
  }
  if (post.imageLocalUrl) {
    try { fs.unlinkSync(path.join(MEDIA_DIR, path.basename(post.imageLocalUrl))); } catch { /* ignore */ }
  }
  await db.run(`DELETE FROM post_images WHERE post_id = ?`, [post.id]);
  await db.run(`DELETE FROM publishing_records WHERE post_id = ?`, [post.id]);
  await db.run(`DELETE FROM scheduled_posts WHERE post_id = ?`, [post.id]);
  await db.run(`DELETE FROM posts WHERE id = ?`, [post.id]);
  await db.logEvent({
    level: 'info', service: 'app', operation: 'post.delete', message: `Post deleted locally: ${truncate(post.title || post.topic, 120)}`,
    meta: { remoteResults },
  });
  res.json({ ok: true, remoteResults });
}));

app.post('/api/posts/:id/duplicate', asyncHandler(async (req, res) => {
  const source = await pipeline.getPost(req.params.id);
  if (!source) throw new HttpError(404, 'Post not found.');
  const topic = `${source.topic} (copy)`.slice(0, 160);
  const copy = await pipeline.createPost({
    topic, category: source.category, language: source.language, servings: source.servings,
    imagePrompt: source.imagePrompt, customInstructions: source.customInstructions,
    nutritionGoals: source.nutritionGoals, source: 'manual',
  });
  await pipeline.updatePost(copy.id, {
    title: source.title ? `${source.title} (copy)` : '',
    seoTitle: source.seoTitle, description: source.description, imageAlt: source.imageAlt,
    imageLocalUrl: source.imageLocalUrl, imageMime: source.imageMime,
    imageWidth: source.imageWidth, imageHeight: source.imageHeight,
    recipe: source.recipe ? { ...source.recipe, title: source.recipe.title ? `${source.recipe.title} (copy)` : source.recipe.title } : null,
    nutrition: source.nutrition, status: 'draft',
  });
  await db.logEvent({ level: 'info', service: 'app', operation: 'post.duplicate', postId: copy.id, message: `Duplicated from ${source.id}` });
  res.status(201).json({ post: await pipeline.getPost(copy.id) });
}));

/* --------------------------- generation --------------------------- */

app.post('/api/topics/suggest', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  const category = str(req.body.category, 60) || settings.defaultCategory;
  const topic = await pipeline.generateTopic({
    category, language: str(req.body.language, 40) || settings.language,
    niche: settings.niche, exclude: str(req.body.exclude, 160) ? [str(req.body.exclude, 160)] : [],
  });
  const topics = await db.query(`SELECT topic FROM topics ORDER BY created_at DESC LIMIT 5`);
  res.json({ topic, recentTopics: topics.map((t) => t.topic) });
}));

async function ensurePostForBody(req, body) {
  if (req.params.id) {
    const post = await pipeline.getPost(req.params.id);
    if (!post) throw new HttpError(404, 'Post not found.');
    return post;
  }
  const input = postInput(body);
  if (!input.topic) throw new HttpError(400, 'Enter a topic (or create a draft first).');
  return pipeline.createPost({ ...input, source: 'manual' });
}

app.post('/api/posts/generate-image', asyncHandler(async (req, res) => {
  const post = await ensurePostForBody(req, req.body);
  const result = await pipeline.generateImageStage(post.id, {
    style: str(req.body.imageStyle, 80), customInstructions: str(req.body.customInstructions, 3000),
    prompt: str(req.body.imagePrompt, 4000),
  });
  res.json({ post: result });
}));

app.post('/api/posts/:id/generate-image', asyncHandler(async (req, res) => {
  const result = await pipeline.generateImageStage(req.params.id, {
    prompt: str(req.body.prompt, 4000), style: str(req.body.imageStyle, 80),
  });
  res.json({ post: result });
}));

app.post('/api/posts/:id/regenerate-image', asyncHandler(async (req, res) => {
  const result = await pipeline.generateImageStage(req.params.id, {
    prompt: str(req.body.prompt, 4000), regenerate: true,
  });
  res.json({ post: result });
}));

app.post('/api/posts/:id/analyze-image', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.analyzeImageStage(req.params.id) });
}));

app.post('/api/posts/:id/generate-recipe', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.generateRecipeStage(req.params.id, { extraInstructions: str(req.body.customInstructions, 2000) }) });
}));

app.post('/api/posts/:id/regenerate-recipe', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.generateRecipeStage(req.params.id, { regenerate: true, extraInstructions: str(req.body.customInstructions, 2000) }) });
}));

app.post('/api/posts/:id/generate-nutrition', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.calculateNutritionStage(req.params.id) });
}));

app.post('/api/posts/:id/generate-seo', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.generateSeoStage(req.params.id) });
}));

app.post('/api/posts/:id/regenerate-seo', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.generateSeoStage(req.params.id) });
}));

app.post('/api/posts/:id/build-article', asyncHandler(async (req, res) => {
  res.json({ post: await pipeline.buildBloggerContentStage(req.params.id) });
}));

app.post('/api/posts/:id/generate', asyncHandler(async (req, res) => {
  const post = await pipeline.runPipeline({
    postId: req.params.id,
    options: {
      regenerate: req.body.regenerate || {},
      publish: false,
    },
  });
  res.json({ post });
}));

app.post('/api/posts/generate', asyncHandler(async (req, res) => {
  const input = postInput(req.body);
  if (!input.topic) throw new HttpError(400, 'Enter a topic or use topic generation.');
  const post = await pipeline.runPipeline({
    options: {
      ...input,
      imageStyle: str(req.body.imageStyle, 80) || undefined,
      publish: Boolean(req.body.publish),
      platforms: Array.isArray(req.body.platforms) ? req.body.platforms.filter((p) => ['blogger', 'pinterest'].includes(p)) : ['blogger', 'pinterest'],
      source: 'manual',
    },
  });
  res.status(201).json({ post });
}));

app.post('/api/posts/:id/image/upload', asyncHandler(async (req, res) => {
  const { dataUrl, base64, mime } = req.body || {};
  let buffer; let detectedMime = str(mime, 60) || 'image/png';
  if (dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl));
    if (!m) throw new HttpError(400, 'Invalid image data URL.');
    detectedMime = m[1]; buffer = Buffer.from(m[2], 'base64');
  } else if (base64) {
    buffer = Buffer.from(String(base64), 'base64');
  } else throw new HttpError(400, 'Provide an image as dataUrl or base64.');
  if (!/^image\/(png|jpe?g|webp)$/i.test(detectedMime)) throw new HttpError(400, 'Only PNG, JPEG and WebP images are supported.');
  res.json({ post: await pipeline.uploadImageStage(req.params.id, buffer, detectedMime) });
}));

/* --------------------------- publishing --------------------------- */

async function publishRequest(req, res, platforms, options = {}) {
  const result = await pipeline.publishPost(req.params.id, platforms, options);
  res.json({
    post: result.post, errors: result.errors,
    ok: result.errors.length === 0,
    message: result.errors.length
      ? result.errors.map((e) => `${e.platform}: ${e.error}`).join(' | ')
      : `Published to ${platforms.join(' + ')}.`,
  });
}

app.post('/api/posts/:id/publish-blogger', asyncHandler((req, res) => publishRequest(req, res, ['blogger'], { forceNew: Boolean(req.body.forceNew), isDraft: Boolean(req.body.isDraft) })));
app.post('/api/posts/:id/publish-pinterest', asyncHandler((req, res) => publishRequest(req, res, ['pinterest'], { forceNew: Boolean(req.body.forceNew) })));
app.post('/api/posts/:id/publish-both', asyncHandler((req, res) => publishRequest(req, res, ['blogger', 'pinterest'], { forceNew: Boolean(req.body.forceNew) })));

app.post('/api/posts/:id/publish', asyncHandler(async (req, res) => {
  const platforms = Array.isArray(req.body.platforms)
    ? req.body.platforms.filter((p) => ['blogger', 'pinterest'].includes(p)) : ['blogger', 'pinterest'];
  if (!platforms.length) throw new HttpError(400, 'Choose at least one platform.');
  const result = await pipeline.publishPost(req.params.id, platforms, { forceNew: Boolean(req.body.forceNew), isDraft: Boolean(req.body.isDraft) });
  res.json({
    post: result.post, errors: result.errors, ok: result.errors.length === 0,
    message: result.errors.length ? result.errors.map((e) => `${e.platform}: ${e.error}`).join(' | ') : `Published to ${platforms.join(' + ')}.`,
  });
}));

app.post('/api/posts/:id/retry', asyncHandler(async (req, res) => {
  const post = await pipeline.getPost(req.params.id);
  if (!post) throw new HttpError(404, 'Post not found.');
  const platforms = [];
  if (post.bloggerStatus !== 'published') platforms.push('blogger');
  if (post.bloggerUrl && post.pinterestStatus !== 'published') platforms.push('pinterest');
  if (!platforms.length) throw new HttpError(400, 'Both platforms are already published. Use republish explicitly if you need a new copy.');
  const result = await pipeline.publishPost(post.id, platforms);
  res.json({ post: result.post, errors: result.errors, ok: result.errors.length === 0, platforms });
}));

/* ------------------------------------------------------------------ */
/* Scheduled posts                                                     */
/* ------------------------------------------------------------------ */

app.get('/api/scheduled', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT s.*, p.topic, p.title, p.image_local_url, p.image_url, p.status AS post_status,
            p.blogger_status, p.pinterest_status, p.blogger_url, p.pinterest_url
     FROM scheduled_posts s JOIN posts p ON p.id = s.post_id
     ORDER BY CASE WHEN s.status IN ('Scheduled','Running') THEN 0 ELSE 1 END, s.scheduled_at ASC LIMIT 200`,
  );
  const items = rows.map((r) => ({
    id: r.id, postId: r.post_id, scheduledAt: r.scheduled_at, status: r.status, note: r.note,
    destinations: pipeline.safeJson(r.destinations, []),
    post: {
      id: r.post_id, topic: r.topic, title: r.title, imageLocalUrl: r.image_local_url, imageUrl: r.image_url,
      status: r.post_status, bloggerStatus: r.blogger_status, pinterestStatus: r.pinterest_status,
      bloggerUrl: r.blogger_url, pinterestUrl: r.pinterest_url,
    },
    createdAt: r.created_at,
  }));
  res.json({ items });
}));

app.post('/api/scheduled', asyncHandler(async (req, res) => {
  const post = await pipeline.getPost(req.body.postId);
  if (!post) throw new HttpError(404, 'Post not found.');
  const when = new Date(req.body.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'Choose a valid schedule date/time.');
  const destinations = Array.isArray(req.body.destinations)
    ? req.body.destinations.filter((p) => ['blogger', 'pinterest'].includes(p)) : ['blogger', 'pinterest'];
  if (!destinations.length) throw new HttpError(400, 'Choose at least one destination.');
  if (destinations.includes('pinterest') && !post.bloggerUrl && !destinations.includes('blogger')) {
    throw new HttpError(400, 'Pinterest needs a Blogger destination URL. Include Blogger in this schedule.');
  }
  await db.run(`UPDATE scheduled_posts SET status = 'Cancelled', updated_at = ? WHERE post_id = ? AND status IN ('Scheduled','Running')`,
    [new Date().toISOString(), post.id]);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO scheduled_posts (id, post_id, scheduled_at, destinations, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Scheduled', ?, ?, ?)`,
    [id, post.id, when.toISOString(), JSON.stringify(destinations), str(req.body.note, 300), now, now],
  );
  await pipeline.updatePost(post.id, { scheduledAt: when.toISOString(), status: 'scheduled' });
  await db.logEvent({
    level: 'info', service: 'scheduler', operation: 'schedule.create', postId: post.id,
    message: `Scheduled for ${when.toISOString()} → ${destinations.join(' + ')}`,
  });
  res.status(201).json({ id, scheduledAt: when.toISOString(), destinations, status: 'Scheduled' });
}));

app.put('/api/scheduled/:id', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM scheduled_posts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Scheduled post not found.');
  if (!['Scheduled', 'Failed', 'Cancelled'].includes(row.status)) throw new HttpError(400, 'This schedule can no longer be edited.');
  const when = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date(row.scheduled_at);
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'Invalid date/time.');
  const destinations = Array.isArray(req.body.destinations)
    ? req.body.destinations.filter((p) => ['blogger', 'pinterest'].includes(p)) : pipeline.safeJson(row.destinations, []);
  await db.run(`UPDATE scheduled_posts SET scheduled_at = ?, destinations = ?, status = 'Scheduled', note = ?, updated_at = ? WHERE id = ?`,
    [when.toISOString(), JSON.stringify(destinations), str(req.body.note, 300) || null, new Date().toISOString(), row.id]);
  await pipeline.updatePost(row.post_id, { scheduledAt: when.toISOString(), status: 'scheduled' });
  res.json({ ok: true, scheduledAt: when.toISOString(), destinations, status: 'Scheduled' });
}));

app.delete('/api/scheduled/:id', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM scheduled_posts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Scheduled post not found.');
  await db.run(`UPDATE scheduled_posts SET status = 'Cancelled', updated_at = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
  const post = await pipeline.getPost(row.post_id);
  if (post && !['published', 'partially_published'].includes(post.status)) {
    await pipeline.updatePost(post.id, { scheduledAt: null, status: post.recipe ? 'generated' : 'draft' });
  }
  res.json({ ok: true });
}));

app.post('/api/scheduled/:id/publish-now', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM scheduled_posts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Scheduled post not found.');
  const claim = await db.run(`UPDATE scheduled_posts SET status = 'Running', updated_at = ? WHERE id = ? AND status IN ('Scheduled','Failed')`,
    [new Date().toISOString(), row.id]);
  if (!claim.changes) throw new HttpError(409, 'This scheduled item is already running or completed.');
  const destinations = pipeline.safeJson(row.destinations, ['blogger']);
  try {
    let post = await pipeline.getPost(row.post_id);
    if (!post.recipe || !post.nutrition) post = await pipeline.runPipeline({ postId: post.id, options: { publish: false } });
    const result = await pipeline.publishPost(post.id, destinations);
    if (result.errors.length) throw new Error(result.errors.map((e) => `${e.platform}: ${e.error}`).join(' | '));
    await db.run(`UPDATE scheduled_posts SET status = 'Published', updated_at = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
    await pipeline.updatePost(post.id, { scheduledAt: null });
    res.json({ ok: true, post: result.post });
  } catch (err) {
    await db.run(`UPDATE scheduled_posts SET status = 'Failed', note = ?, updated_at = ? WHERE id = ?`,
      [truncate(err.message, 900), new Date().toISOString(), row.id]);
    throw err;
  }
}));

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/analytics', asyncHandler(async (req, res) => {
  const range = ['7', '30', '90', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '30';
  const days = range === 'all' ? 3650 : Number(range);
  const start = new Date(Date.now() - (days - 1) * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  const startIso = start.toISOString();

  const totals = await db.get(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'partially_published' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN blogger_status = 'published' THEN 1 ELSE 0 END) AS blogger_published,
      SUM(CASE WHEN blogger_status = 'failed' THEN 1 ELSE 0 END) AS blogger_failed,
      SUM(CASE WHEN pinterest_status = 'published' THEN 1 ELSE 0 END) AS pinterest_published,
      SUM(CASE WHEN pinterest_status = 'failed' THEN 1 ELSE 0 END) AS pinterest_failed
    FROM posts WHERE created_at >= ?`, [startIso]);

  const dailyRows = await db.query(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c,
            SUM(CASE WHEN status IN ('published','partially_published') THEN 1 ELSE 0 END) AS published
     FROM posts WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`, [startIso]);
  const categoryRows = await db.query(
    `SELECT category, COUNT(*) AS c FROM posts WHERE created_at >= ? GROUP BY category ORDER BY c DESC LIMIT 8`, [startIso]);
  const statusRows = await db.query(
    `SELECT status, COUNT(*) AS c FROM posts WHERE created_at >= ? GROUP BY status`, [startIso]);
  const recentPublished = await db.query(
    `SELECT id, title, topic, image_local_url, blogger_url, pinterest_url, published_at, status
     FROM posts WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 8`);

  const chartDays = range === 'all' ? Math.min(90, 90) : Number(range);
  const series = [];
  const dailyMap = new Map(dailyRows.map((r) => [r.day, r]));
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const hit = dailyMap.get(key);
    series.push({ date: key, posts: Number(hit?.c || 0), published: Number(hit?.published || 0) });
  }

  const total = Number(totals?.total || 0);
  const bloggerAttempts = Number(totals?.blogger_published || 0) + Number(totals?.blogger_failed || 0);
  const pinterestAttempts = Number(totals?.pinterest_published || 0) + Number(totals?.pinterest_failed || 0);

  let pinterest = { available: false, reason: 'Pinterest is not connected.', metrics: null };
  const pconn = await db.getConnection('pinterest');
  if (pconn) {
    const cacheKey = `pin-analytics:${range}`;
    const cached = await db.get(`SELECT value, updated_at FROM analytics_cache WHERE key = ?`, [cacheKey]);
    if (cached && Date.now() - new Date(cached.updated_at).getTime() < 15 * 60_000) {
      pinterest = pipeline.safeJson(cached.value, pinterest);
    } else {
      try {
        const startDate = start.toISOString().slice(0, 10);
        const endDate = new Date().toISOString().slice(0, 10);
        const data = await providers.getPinterestAnalytics({ startDate, endDate });
        const all = data.all || data;
        const metrics = {};
        const summary = all.summary_metrics || all.summary || [];
        for (const m of summary) {
          const key = String(m.metric_type || m.metric || '').toUpperCase();
          metrics[key] = Number(m.value ?? m.total ?? 0);
        }
        if (!Object.keys(metrics).length) {
          const daily = all.daily_metrics || [];
          for (const d of daily) {
            for (const m of d.metrics || []) {
              const key = String(m.metric_type || '').toUpperCase();
              metrics[key] = Number(metrics[key] || 0) + Number(m.value || 0);
            }
          }
        }
        const pick = (...keys) => {
          for (const k of keys) if (metrics[k] !== undefined) return metrics[k];
          return null;
        };
        pinterest = {
          available: true,
          metrics: {
            impressions: pick('IMPRESSION', 'IMPRESSIONS'),
            saves: pick('SAVE', 'SAVES'),
            pinClicks: pick('PIN_CLICK', 'PIN_CLICKS'),
            outboundClicks: pick('OUTBOUND_CLICK', 'OUTBOUND_CLICKS'),
            engagement: pick('ENGAGEMENT'),
          },
          requestedRange: { startDate, endDate },
          note: 'Reported by the official Pinterest API for the connected account. Recently created Pins may take up to 24–48 hours to appear.',
        };
      } catch (err) {
        const denied = [401, 403].includes(err.status);
        pinterest = {
          available: false,
          reason: denied ? 'Unavailable with current API permissions.' : `Pinterest analytics could not be loaded: ${err.message}`,
        };
      }
      await db.run(
        `INSERT INTO analytics_cache (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [cacheKey, JSON.stringify(pinterest), new Date().toISOString()],
      );
    }
  }

  res.json({
    range, startDate: startIso,
    totals: {
      total,
      published: Number(totals?.published || 0),
      partiallyPublished: Number(totals?.partial || 0),
      failed: Number(totals?.failed || 0),
      drafts: Number(totals?.drafts || 0),
      bloggerPublished: Number(totals?.blogger_published || 0),
      pinterestPublished: Number(totals?.pinterest_published || 0),
    },
    successRates: {
      overall: total ? Math.round(((Number(totals?.published || 0) + Number(totals?.partial || 0)) / total) * 100) : null,
      blogger: bloggerAttempts ? Math.round((Number(totals?.blogger_published || 0) / bloggerAttempts) * 100) : null,
      pinterest: pinterestAttempts ? Math.round((Number(totals?.pinterest_published || 0) / pinterestAttempts) * 100) : null,
    },
    daily: series,
    categories: categoryRows.map((r) => ({ category: r.category || 'Uncategorised', count: Number(r.c) })),
    statuses: statusRows.map((r) => ({ status: r.status, count: Number(r.c) })),
    recentPublished,
    pinterest,
    empty: total === 0,
  });
}));

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/settings', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  res.json({
    settings,
    categories: CATEGORIES,
    imageStyles: IMAGE_STYLES,
    languages: LANGUAGES,
    timezones: ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Jakarta',
      'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'],
    appUrl: ENV.appUrl,
    version: APP_VERSION,
  });
}));

const SETTINGS_KEYS = ['siteName', 'tagline', 'timezone', 'language', 'defaultCategory', 'defaultImageStyle',
  'defaultServings', 'defaultNutritionGoals', 'niche', 'blogger', 'pinterest', 'publishing', 'nutrition', 'automation', 'setup'];

app.put('/api/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const key of SETTINGS_KEYS) if (body[key] !== undefined) patch[key] = body[key];
  if (patch.timezone && !isValidTimezone(patch.timezone)) throw new HttpError(400, 'Invalid timezone.');
  if (patch.siteName !== undefined) patch.siteName = str(patch.siteName, 80);
  if (patch.defaultServings !== undefined) patch.defaultServings = intOr(patch.defaultServings, 2, 1, 50);
  if (patch.automation) {
    const a = patch.automation;
    if (a.postsPerDay !== undefined) a.postsPerDay = intOr(a.postsPerDay, 1, 1, 20);
    if (a.minDelayMinutes !== undefined) a.minDelayMinutes = intOr(a.minDelayMinutes, 60, 0, 1440);
    if (a.times !== undefined) {
      if (!Array.isArray(a.times)) throw new HttpError(400, 'Posting times must be an array.');
      a.times = a.times.map((t) => str(t, 5)).filter((t) => hhmmToMinutes(t) != null).slice(0, 12);
      if (!a.times.length) throw new HttpError(400, 'Add at least one valid posting time (HH:MM).');
    }
    if (a.daysOfWeek !== undefined) {
      a.daysOfWeek = (Array.isArray(a.daysOfWeek) ? a.daysOfWeek : []).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6);
      if (!a.daysOfWeek.length) throw new HttpError(400, 'Select at least one posting day.');
    }
    if (a.categories !== undefined) a.categories = (Array.isArray(a.categories) ? a.categories : []).map((c) => str(c, 60)).filter(Boolean);
    if (a.nutritionGoals !== undefined && a.nutritionGoals !== null) a.nutritionGoals = a.nutritionGoals;
  }
  if (patch.publishing?.allowPinterestWithoutBlogger !== undefined) {
    patch.publishing.allowPinterestWithoutBlogger = Boolean(patch.publishing.allowPinterestWithoutBlogger);
  }
  const merged = await db.saveSettings(patch);
  await db.logEvent({ level: 'info', service: 'app', operation: 'settings.update', message: `Settings updated: ${Object.keys(patch).join(', ') || 'no changes'}` });
  res.json({ settings: merged });
}));

app.post('/api/settings/password', asyncHandler(async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = req.body.newPassword;
  const user = await db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  if (!user || !verifyPassword(current, user.password_hash)) throw new HttpError(401, 'Current password is incorrect.');
  validatePassword(next);
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashPassword(next), user.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`, [user.id, req.session.id]);
  await db.logEvent({ level: 'success', service: 'auth', operation: 'password.change', message: 'Admin password changed.' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Prompts                                                            */
/* ------------------------------------------------------------------ */

const PROMPT_CATEGORIES = ['topic_generation', 'image_generation', 'image_analysis', 'recipe_generation',
  'nutrition_mapping', 'seo_content', 'blogger_formatting', 'content_instructions'];

function defaultPromptFor(category) {
  return db.DEFAULT_PROMPTS.find((p) => p.category === category) || null;
}

app.get('/api/prompts', asyncHandler(async (req, res) => {
  const category = str(req.query.category, 60);
  const rows = category
    ? await db.query(`SELECT * FROM prompts WHERE category = ? ORDER BY is_default DESC, created_at ASC`, [category])
    : await db.query(`SELECT * FROM prompts ORDER BY category ASC, is_default DESC, created_at ASC`);
  res.json({
    items: rows.map((r) => ({ id: r.id, category: r.category, name: r.name, body: r.body, isDefault: Boolean(r.is_default), createdAt: r.created_at, updatedAt: r.updated_at })),
    categories: PROMPT_CATEGORIES,
  });
}));

app.post('/api/prompts', asyncHandler(async (req, res) => {
  const category = str(req.body.category, 60);
  const name = str(req.body.name, 120);
  const body = str(req.body.body, 20_000);
  if (!PROMPT_CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown prompt category.');
  if (!name || !body) throw new HttpError(400, 'Prompt name and body are required.');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const isDefault = req.body.isDefault ? 1 : 0;
  if (isDefault) await db.run(`UPDATE prompts SET is_default = 0 WHERE category = ?`, [category]);
  await db.run(`INSERT INTO prompts (id, category, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, category, name, body, isDefault, now, now]);
  res.status(201).json({ id });
}));

app.put('/api/prompts/:id', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM prompts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Prompt not found.');
  const name = req.body.name !== undefined ? str(req.body.name, 120) : row.name;
  const body = req.body.body !== undefined ? str(req.body.body, 30_000) : row.body;
  const category = req.body.category !== undefined ? str(req.body.category, 60) : row.category;
  if (!PROMPT_CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown prompt category.');
  if (!name || !body) throw new HttpError(400, 'Prompt name and body are required.');
  await db.run(`UPDATE prompts SET name = ?, body = ?, category = ?, updated_at = ? WHERE id = ?`,
    [name, body, category, new Date().toISOString(), row.id]);
  res.json({ ok: true });
}));

app.delete('/api/prompts/:id', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM prompts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Prompt not found.');
  const count = await db.get(`SELECT COUNT(*) AS c FROM prompts WHERE category = ?`, [row.category]);
  if (Number(count.c) <= 1) throw new HttpError(400, 'At least one prompt must exist for this category.');
  await db.run(`DELETE FROM prompts WHERE id = ?`, [row.id]);
  if (row.is_default) {
    const next = await db.get(`SELECT id FROM prompts WHERE category = ? ORDER BY created_at ASC LIMIT 1`, [row.category]);
    if (next) await db.run(`UPDATE prompts SET is_default = 1 WHERE id = ?`, [next.id]);
  }
  res.json({ ok: true });
}));

app.post('/api/prompts/:id/duplicate', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM prompts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Prompt not found.');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await db.run(`INSERT INTO prompts (id, category, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, row.category, `${row.name} (copy)`, row.body, now, now]);
  res.status(201).json({ id });
}));

app.post('/api/prompts/:id/default', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM prompts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Prompt not found.');
  await db.run(`UPDATE prompts SET is_default = 0 WHERE category = ?`, [row.category]);
  await db.run(`UPDATE prompts SET is_default = 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
  res.json({ ok: true });
}));

app.post('/api/prompts/:id/reset', asyncHandler(async (req, res) => {
  const row = await db.get(`SELECT * FROM prompts WHERE id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Prompt not found.');
  const def = defaultPromptFor(row.category);
  if (!def) throw new HttpError(400, 'No built-in default for this category.');
  await db.run(`UPDATE prompts SET body = ?, name = ?, updated_at = ? WHERE id = ?`,
    [def.body, def.name, new Date().toISOString(), row.id]);
  res.json({ ok: true, body: def.body });
}));

app.post('/api/prompts/preview', asyncHandler(async (req, res) => {
  const body = str(req.body.body, 30_000);
  const vars = req.body.variables && typeof req.body.variables === 'object' ? req.body.variables : {};
  res.json({ rendered: ai.renderTemplate(body, vars) });
}));

app.post('/api/prompts/test', asyncHandler(async (req, res) => {
  if (!rateLimit(`prompt-test:${req.user.id}`, 20, 10 * 60_000)) throw new HttpError(429, 'Too many prompt tests. Wait a few minutes.');
  const body = str(req.body.body, 20_000);
  const vars = req.body.variables && typeof req.body.variables === 'object' ? req.body.variables : {};
  const rendered = ai.renderTemplate(body, vars);
  const started = Date.now();
  const output = await ai.generateText({
    prompt: rendered,
    system: 'You are testing a prompt for a food content studio. Follow the prompt and return a concrete sample response.',
    maxOutputTokens: 1200,
  });
  await db.logEvent({
    level: 'success', service: 'gemini', operation: 'prompt.test', status: 'success',
    message: `Prompt tested (${rendered.length} chars)`, durationMs: Date.now() - started,
  });
  res.json({ output, rendered, durationMs: Date.now() - started });
}));

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/connections', asyncHandler(async (req, res) => {
  const summary = await providers.connectionSummary();
  const settings = await db.getSettings();
  res.json({
    connections: summary,
    selections: {
      blogger: settings.blogger,
      pinterest: settings.pinterest,
    },
    envHints: {
      APP_URL: ENV.appUrl,
      googleRedirectUri: summary.google.redirectUri,
      pinterestRedirectUri: summary.pinterest.redirectUri,
      hasCronSecret: Boolean(process.env.CRON_SECRET),
      database: db.driver === 'pg' ? 'PostgreSQL' : 'SQLite (local fallback)',
    },
  });
}));

app.put('/api/connections/gemini', asyncHandler(async (req, res) => {
  const existing = (await db.getConnection('gemini')) || {};
  const patch = { ...existing };
  if (req.body.apiKey !== undefined) {
    const key = str(req.body.apiKey, 300);
    if (key && key.length < 20) throw new HttpError(400, 'That API key looks too short.');
    patch.apiKey = key;
  }
  if (req.body.textModel !== undefined) patch.textModel = str(req.body.textModel, 120);
  if (req.body.imageModel !== undefined) patch.imageModel = str(req.body.imageModel, 120);
  await db.setConnection('gemini', patch);
  await db.logEvent({ level: 'info', service: 'gemini', operation: 'connection.save', message: 'Gemini settings saved.' });
  res.json({ ok: true, connections: await providers.connectionSummary() });
}));

app.post('/api/connections/gemini/test', asyncHandler(async (req, res) => {
  const existing = (await db.getConnection('gemini')) || {};
  const overrides = {
    apiKey: str(req.body.apiKey, 300) || existing.apiKey || process.env.GEMINI_API_KEY,
    textModel: str(req.body.textModel, 120) || existing.textModel,
    imageModel: str(req.body.imageModel, 120) || existing.imageModel,
  };
  const result = await ai.testGemini(overrides);
  await db.setConnection('gemini', { ...existing, lastTest: result, verifiedAt: new Date().toISOString() });
  await db.logEvent({
    level: result.ok ? 'success' : 'warning', service: 'gemini', operation: 'connection.test',
    status: result.ok ? 'success' : 'warning', message: result.message, durationMs: result.durationMs,
  });
  res.json(result);
}));

app.delete('/api/connections/gemini', asyncHandler(async (req, res) => {
  await db.deleteConnection('gemini');
  res.json({ ok: true });
}));

app.put('/api/connections/cloudinary', asyncHandler(async (req, res) => {
  const existing = (await db.getConnection('cloudinary')) || {};
  const cloudName = req.body.cloudName !== undefined ? str(req.body.cloudName, 120) : existing.cloudName;
  const apiKey = req.body.apiKey !== undefined ? str(req.body.apiKey, 200) : existing.apiKey;
  const apiSecret = req.body.apiSecret !== undefined ? str(req.body.apiSecret, 200) : existing.apiSecret;
  await db.setConnection('cloudinary', { cloudName, apiKey, apiSecret, verifiedAt: existing.verifiedAt });
  res.json({ ok: true, connections: await providers.connectionSummary() });
}));

app.post('/api/connections/cloudinary/test', asyncHandler(async (req, res) => {
  const result = await providers.testCloudinary({
    cloudName: str(req.body.cloudName, 120), apiKey: str(req.body.apiKey, 200), apiSecret: str(req.body.apiSecret, 200),
  });
  const existing = (await db.getConnection('cloudinary')) || {};
  await db.setConnection('cloudinary', { ...existing, lastTest: result });
  res.json(result);
}));

app.delete('/api/connections/cloudinary', asyncHandler(async (req, res) => {
  await db.deleteConnection('cloudinary');
  res.json({ ok: true });
}));

app.put('/api/connections/nutrition', asyncHandler(async (req, res) => {
  const provider = str(req.body.provider, 40) || 'builtin';
  if (!['builtin', 'usda', 'gemini'].includes(provider)) throw new HttpError(400, 'Unknown nutrition provider.');
  const existing = (await db.getConnection('nutrition')) || {};
  const usdaKey = req.body.usdaKey !== undefined ? str(req.body.usdaKey, 200) : existing.usdaKey;
  await db.setConnection('nutrition', { ...existing, usdaKey });
  await db.saveSettings({ nutrition: { provider } });
  res.json({ ok: true, connections: await providers.connectionSummary() });
}));

app.post('/api/connections/nutrition/test', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  const existing = (await db.getConnection('nutrition')) || {};
  const provider = str(req.body.provider, 40) || settings.nutrition?.provider || 'builtin';
  const apiKey = str(req.body.usdaKey, 200) || existing.usdaKey || process.env.NUTRITION_API_KEY;
  const result = await providers.testNutrition({ provider, apiKey });
  await db.setConnection('nutrition', { ...existing, lastTest: result });
  res.json(result);
}));

app.put('/api/connections/oauth/:provider', asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  if (!['google', 'pinterest'].includes(provider)) throw new HttpError(404, 'Unknown OAuth provider.');
  const existing = (await db.getConnection(`${provider}_oauth`)) || {};
  const patch = { ...existing };
  for (const key of ['clientId', 'clientSecret', 'redirectUri']) {
    if (req.body[key] !== undefined) patch[key] = str(req.body[key], 300);
  }
  await db.setConnection(`${provider}_oauth`, patch);
  res.json({ ok: true, connections: await providers.connectionSummary() });
}));

app.get('/api/connections/blogger/blogs', asyncHandler(async (req, res) => {
  const test = await providers.testBlogger();
  res.json(test);
}));

app.post('/api/connections/blogger/select', asyncHandler(async (req, res) => {
  const blogId = str(req.body.blogId, 80);
  if (!blogId) throw new HttpError(400, 'Choose a blog.');
  const settings = await db.saveSettings({
    blogger: {
      defaultBlogId: blogId,
      defaultBlogName: str(req.body.blogName, 200),
      defaultBlogUrl: str(req.body.blogUrl, 300),
    },
  });
  res.json({ ok: true, blogger: settings.blogger });
}));

app.post('/api/connections/blogger/test', asyncHandler(async (req, res) => {
  const result = await providers.testBlogger();
  const conn = (await db.getConnection('google')) || {};
  await db.setConnection('google', { ...conn, lastTest: { ok: true, at: new Date().toISOString(), blogs: result.blogs.length } });
  await db.logEvent({ level: 'success', service: 'blogger', operation: 'connection.test', message: result.message });
  res.json(result);
}));

app.post('/api/connections/blogger/disconnect', asyncHandler(async (req, res) => {
  await providers.disconnectGoogle();
  await db.saveSettings({ blogger: { defaultBlogId: '', defaultBlogName: '', defaultBlogUrl: '' } });
  res.json({ ok: true });
}));

app.get('/api/connections/pinterest/boards', asyncHandler(async (req, res) => {
  res.json(await providers.testPinterest());
}));

app.post('/api/connections/pinterest/select', asyncHandler(async (req, res) => {
  const boardId = str(req.body.boardId, 100);
  if (!boardId) throw new HttpError(400, 'Choose a board.');
  const settings = await db.saveSettings({ pinterest: { defaultBoardId: boardId, defaultBoardName: str(req.body.boardName, 200) } });
  res.json({ ok: true, pinterest: settings.pinterest });
}));

app.post('/api/connections/pinterest/test', asyncHandler(async (req, res) => {
  const result = await providers.testPinterest();
  const conn = (await db.getConnection('pinterest')) || {};
  await db.setConnection('pinterest', { ...conn, lastTest: { ok: true, at: new Date().toISOString(), boards: result.boards.length } });
  await db.logEvent({ level: 'success', service: 'pinterest', operation: 'connection.test', message: result.message });
  res.json(result);
}));

app.post('/api/connections/pinterest/disconnect', asyncHandler(async (req, res) => {
  await providers.disconnectPinterest();
  await db.saveSettings({ pinterest: { defaultBoardId: '', defaultBoardName: '' } });
  res.json({ ok: true });
}));

app.get('/api/connections/oauth/:provider/url', requireAuth, asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  if (!['google', 'pinterest'].includes(provider)) throw new HttpError(404, 'Unknown OAuth provider.');
  const state = randomToken(24);
  await db.saveOauthState(state, provider);
  const out = provider === 'google' ? await providers.googleAuthUrl(state) : await providers.pinterestAuthUrl(state);
  res.json(out);
}));

/* ------------------------------------------------------------------ */
/* OAuth callbacks                                                     */
/* ------------------------------------------------------------------ */

app.get('/auth/google', asyncHandler(async (req, res) => {
  if (!req.user) return res.redirect('/?login=required#connections');
  const state = randomToken(24);
  await db.saveOauthState(state, 'google');
  const { url } = await providers.googleAuthUrl(state);
  res.redirect(url);
}));

app.get('/auth/pinterest', asyncHandler(async (req, res) => {
  if (!req.user) return res.redirect('/?login=required#connections');
  const state = randomToken(24);
  await db.saveOauthState(state, 'pinterest');
  const { url } = await providers.pinterestAuthUrl(state);
  res.redirect(url);
}));

app.get('/auth/google/callback', asyncHandler(async (req, res) => {
  const redirect = (params) => res.redirect(`/?${new URLSearchParams(params).toString()}#connections`);
  if (req.query.error) {
    await db.logEvent({ level: 'warning', service: 'blogger', operation: 'oauth.callback', status: 'warning', message: `Google OAuth denied: ${str(req.query.error, 200)}` });
    return redirect({ oauth_error: str(req.query.error_description || req.query.error, 200) });
  }
  const valid = await db.consumeOauthState(str(req.query.state, 200), 'google');
  if (!valid) return redirect({ oauth_error: 'OAuth state was invalid or expired. Try connecting again.' });
  try {
    await providers.exchangeGoogleCode(str(req.query.code, 2000));
    const blogs = await providers.listBlogs();
    if (blogs.length === 1) {
      await db.saveSettings({ blogger: { defaultBlogId: blogs[0].id, defaultBlogName: blogs[0].name, defaultBlogUrl: blogs[0].url } });
    }
    await db.logEvent({ level: 'success', service: 'blogger', operation: 'oauth.callback', message: `Blogger connected. ${blogs.length} blog(s) found.` });
    redirect({ connected: 'blogger' });
  } catch (err) {
    await db.logEvent({ level: 'error', service: 'blogger', operation: 'oauth.callback', status: 'error', message: err.message });
    redirect({ oauth_error: truncate(err.message, 200) });
  }
}));

app.get('/auth/pinterest/callback', asyncHandler(async (req, res) => {
  const redirect = (params) => res.redirect(`/?${new URLSearchParams(params).toString()}#connections`);
  if (req.query.error) {
    await db.logEvent({ level: 'warning', service: 'pinterest', operation: 'oauth.callback', status: 'warning', message: `Pinterest OAuth denied: ${str(req.query.error_description || req.query.error, 200)}` });
    return redirect({ oauth_error: str(req.query.error_description || req.query.error, 200) });
  }
  const valid = await db.consumeOauthState(str(req.query.state, 200), 'pinterest');
  if (!valid) return redirect({ oauth_error: 'OAuth state was invalid or expired. Try connecting again.' });
  try {
    await providers.exchangePinterestCode(str(req.query.code, 2000));
    const boards = await providers.listBoards();
    if (boards.length === 1) await db.saveSettings({ pinterest: { defaultBoardId: boards[0].id, defaultBoardName: boards[0].name } });
    await db.logEvent({ level: 'success', service: 'pinterest', operation: 'oauth.callback', message: `Pinterest connected. ${boards.length} board(s) found.` });
    redirect({ connected: 'pinterest' });
  } catch (err) {
    await db.logEvent({ level: 'error', service: 'pinterest', operation: 'oauth.callback', status: 'error', message: err.message });
    redirect({ oauth_error: truncate(err.message, 200) });
  }
}));

/* ------------------------------------------------------------------ */
/* Logs                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/logs', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const where = []; const params = [];
  const level = str(req.query.level, 20);
  if (level && level !== 'all') {
    if (level === 'success') { where.push(`(level = 'success')`); }
    else if (level === 'warning') { where.push(`(level = 'warning')`); }
    else if (level === 'error') { where.push(`(level IN ('error','warning'))`); }
    else { where.push('level = ?'); params.push(level); }
  }
  const service = str(req.query.service, 40);
  if (service && service !== 'all') { where.push('service = ?'); params.push(service); }
  const postId = str(req.query.postId, 80);
  if (postId) { where.push('post_id = ?'); params.push(postId); }
  const q = str(req.query.search, 120);
  if (q) { where.push('LOWER(message) LIKE ?'); params.push(`%${q.toLowerCase()}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.get(`SELECT COUNT(*) AS c FROM logs ${whereSql}`, params);
  const rows = await db.query(`SELECT * FROM logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({
    items: rows, total: Number(total?.c || 0), page, limit,
    pages: Math.max(1, Math.ceil(Number(total?.c || 0) / limit)),
    services: (await db.query(`SELECT DISTINCT service FROM logs ORDER BY service`)).map((r) => r.service),
  });
}));

app.delete('/api/logs', asyncHandler(async (req, res) => {
  const before = req.query.before ? new Date(req.query.before) : null;
  if (before && !Number.isNaN(before.getTime())) {
    await db.run(`DELETE FROM logs WHERE created_at < ?`, [before.toISOString()]);
  } else if (req.query.all === 'true') {
    await db.run(`DELETE FROM logs`);
  } else {
    throw new HttpError(400, 'Specify ?before=<ISO date> or ?all=true.');
  }
  await db.logEvent({ level: 'info', service: 'app', operation: 'logs.clear', message: 'Logs cleared by owner.' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Automation                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/automation', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  const runs = await db.query(`SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 15`);
  res.json({
    automation: settings.automation,
    timezone: settings.timezone,
    nextRun: await pipeline.nextScheduledRun(settings),
    todayCount: await pipeline.automationRunCount(settings.timezone),
    runs,
  });
}));

app.put('/api/automation', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const allowed = ['enabled', 'autoTopic', 'autoImage', 'autoContent', 'autoBlogger', 'autoPinterest',
    'publishBoth', 'manualApproval', 'generateContentOnly', 'postsPerDay', 'times', 'daysOfWeek',
    'minDelayMinutes', 'categories', 'imageStyle', 'language', 'nutritionGoals', 'slotWindowMinutes'];
  const patch = {};
  for (const key of allowed) if (body[key] !== undefined) patch[key] = body[key];
  if (patch.postsPerDay !== undefined) patch.postsPerDay = intOr(patch.postsPerDay, 1, 1, 20);
  if (patch.minDelayMinutes !== undefined) patch.minDelayMinutes = intOr(patch.minDelayMinutes, 60, 0, 1440);
  if (patch.slotWindowMinutes !== undefined) patch.slotWindowMinutes = intOr(patch.slotWindowMinutes, 45, 10, 240);
  if (patch.times !== undefined) {
    patch.times = (Array.isArray(patch.times) ? patch.times : []).map((t) => str(t, 5)).filter((t) => hhmmToMinutes(t) != null);
    if (!patch.times.length) throw new HttpError(400, 'Add at least one valid posting time.');
  }
  if (patch.daysOfWeek !== undefined) {
    patch.daysOfWeek = (Array.isArray(patch.daysOfWeek) ? patch.daysOfWeek : []).map(Number).filter((d) => d >= 0 && d <= 6);
    if (!patch.daysOfWeek.length) throw new HttpError(400, 'Select at least one day.');
  }
  if (patch.categories !== undefined) patch.categories = (Array.isArray(patch.categories) ? patch.categories : []).map((c) => str(c, 60)).filter(Boolean);
  const settings = await db.saveSettings({ automation: patch });
  await db.logEvent({ level: 'info', service: 'automation', operation: 'settings.update', message: `Automation settings updated: ${Object.keys(patch).join(', ')}` });
  res.json({ automation: settings.automation, nextRun: await pipeline.nextScheduledRun(settings) });
}));

app.post('/api/automation/toggle', asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body.enabled);
  const settings = await db.saveSettings({ automation: { enabled } });
  await db.logEvent({
    level: 'info', service: 'automation', operation: enabled ? 'automation.resume' : 'automation.pause',
    message: enabled ? 'Automation enabled.' : 'Automation paused.',
  });
  res.json({ enabled: settings.automation.enabled, automation: settings.automation });
}));

app.post('/api/automation/run', asyncHandler(async (req, res) => {
  const mode = str(req.body.mode, 30) || 'full';
  const lock = await db.acquireLock('automation-manual', 30 * 60_000);
  if (!lock) throw new HttpError(409, 'Another automation run is already in progress.');
  try {
    let result;
    if (mode === 'publish-next') {
      const row = await db.get(`SELECT id FROM scheduled_posts WHERE status = 'Scheduled' ORDER BY scheduled_at ASC LIMIT 1`);
      if (!row) throw new HttpError(400, 'There are no scheduled posts waiting.');
      await db.run(`UPDATE scheduled_posts SET scheduled_at = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
      const due = await pipeline.processDueScheduled();
      return res.json({ activated: true, dueScheduled: due });
    }
    result = await pipeline.runAutomationTick({ trigger: 'manual', force: true });
    res.json(result);
  } finally {
    await db.releaseLock('automation-manual', lock);
  }
}));

app.post('/api/automation/generate-test', asyncHandler(async (req, res) => {
  const settings = await db.getSettings();
  const categories = settings.automation?.categories?.length ? settings.automation.categories : [settings.defaultCategory];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const topic = await pipeline.generateTopic({ category, language: settings.language, niche: settings.niche });
  const post = await pipeline.runPipeline({
    options: {
      topic, category, language: settings.language, servings: settings.defaultServings,
      imageStyle: settings.defaultImageStyle, nutritionGoals: settings.defaultNutritionGoals,
      publish: false, source: 'manual',
    },
  });
  await db.logEvent({ level: 'success', service: 'automation', operation: 'test.generate', postId: post.id, message: `Test post generated: ${truncate(post.title || topic, 120)}` });
  res.status(201).json({ post });
}));

app.get('/api/automation/runs', asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 100`);
  res.json({ items: rows });
}));

/* ------------------------------------------------------------------ */
/* Cron                                                               */
/* ------------------------------------------------------------------ */

app.post('/api/cron/run', requireCron, asyncHandler(async (req, res) => {
  if (!rateLimit('cron', 30, 60_000)) throw new HttpError(429, 'Cron rate limit exceeded.');
  const result = await pipeline.runAutomationTick({ trigger: 'cron' });
  res.json(result);
}));

/* ------------------------------------------------------------------ */
/* Static + errors                                                     */
/* ------------------------------------------------------------------ */

app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[error]', err.stack || err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: err.message || 'Internal server error.',
      ...(err.details?.error?.message && !String(err.message).includes(err.details.error.message)
        ? { providerMessage: err.details.error.message } : {}),
    });
  }
  res.status(status).send(status === 500 ? 'Internal server error' : err.message);
});

/* ------------------------------------------------------------------ */
/* Startup                                                            */
/* ------------------------------------------------------------------ */

async function startServer() {
  await db.init();
  await ensureAdminFromEnv();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    console.log(`[server] Nourish Studio ${APP_VERSION} listening on :${port} (${db.driver})`);
  });
  server.requestTimeout = 15 * 60_000;

  if (process.env.ENABLE_INTERNAL_SCHEDULER !== 'false') {
    const intervalMs = Math.max(30_000, Number(process.env.INTERNAL_SCHEDULER_INTERVAL_SECONDS || 60) * 1000);
    const tick = () => pipeline.runAutomationTick({ trigger: 'ticker' })
      .then((r) => { if (r?.post) console.log(`[scheduler] created ${r.post.id}`); })
      .catch((err) => console.error('[scheduler]', err.message));
    setTimeout(tick, 15_000).unref?.();
    setInterval(tick, intervalMs).unref?.();
    console.log(`[scheduler] internal ticker enabled every ${Math.round(intervalMs / 1000)}s (cron remains authoritative on Render)`);
  }
  return server;
}

async function runWorker() {
  await db.init();
  await ensureAdminFromEnv();
  console.log('[worker] running scheduled automation tick...');
  const result = await pipeline.runAutomationTick({ trigger: 'cron-worker' });
  console.log('[worker] result:', JSON.stringify(result, null, 2));
  await db.close();
  process.exit(result.error ? 1 : 0);
}

if (require.main === module) {
  const mode = process.argv[2];
  const boot = mode === 'worker' ? runWorker() : startServer();
  boot.catch(async (err) => {
    console.error('[fatal]', err.stack || err.message);
    try { await db.close(); } catch { /* ignore */ }
    process.exit(1);
  });
}

module.exports = { app, startServer, runWorker };
