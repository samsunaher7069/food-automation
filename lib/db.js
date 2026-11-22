'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptSecret, decryptSecret } = require('./util');

/* ------------------------------------------------------------------ */
/* Connection: PostgreSQL in production, SQLite locally                */
/* ------------------------------------------------------------------ */

let driver = null;
let pool = null;
let sqlite = null;

function normalizeParams(params = []) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p !== null && typeof p === 'object' && !(p instanceof Date)) return JSON.stringify(p);
    return p;
  });
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function init() {
  if (driver) return;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const { Pool } = require('pg');
    // Supabase/Render hosts use certificates that are not in the local trust
    // store (or a self-signed pooler cert). Accept them for the private DB
    // connection; the traffic is still encrypted.
    const needsSslAccept = /render\.com|supabase\.co|sslmode=require|sslmode=verify-full/i.test(databaseUrl);
    const cleanUrl = databaseUrl.replace(/([?&])sslmode=(require|verify-full|prefer)(&|$)/i, '$1').replace(/[?&]$/, '');
    pool = new Pool({
      connectionString: cleanUrl,
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl: needsSslAccept ? { rejectUnauthorized: false } : undefined,
    });
    await pool.query('SELECT 1');
    driver = 'pg';
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000;');
    driver = 'sqlite';
  }
  await migrate();
}

async function rawQuery(sql, params = []) {
  const p = normalizeParams(params);
  if (driver === 'pg') {
    const res = await pool.query(toPgPlaceholders(sql), p);
    return res.rows || [];
  }
  const stmt = sqlite.prepare(sql);
  if (/^\s*(select|with|pragma)/i.test(sql) || /returning/i.test(sql)) {
    return stmt.all(...p);
  }
  stmt.run(...p);
  return [];
}

async function query(sql, params = []) { return rawQuery(sql, params); }

async function get(sql, params = []) {
  const rows = await rawQuery(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  if (driver === 'pg') {
    const res = await pool.query(toPgPlaceholders(sql), normalizeParams(params));
    return { changes: res.rowCount || 0, rows: res.rows || [] };
  }
  const stmt = sqlite.prepare(sql);
  if (/returning/i.test(sql)) {
    const rows = stmt.all(...normalizeParams(params));
    return { changes: rows.length, rows };
  }
  const info = stmt.run(...normalizeParams(params));
  return { changes: Number(info.changes || 0), rows: [] };
}

async function exec(sql) {
  if (driver === 'pg') { await pool.query(sql); return; }
  sqlite.exec(sql);
}

async function close() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
  driver = null; pool = null; sqlite = null;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_connections (
  provider TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  post_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  title TEXT,
  seo_title TEXT,
  description TEXT,
  category TEXT,
  language TEXT,
  servings INTEGER DEFAULT 2,
  image_url TEXT,
  image_local_url TEXT,
  image_public_id TEXT,
  image_mime TEXT,
  image_width INTEGER,
  image_height INTEGER,
  image_alt TEXT,
  image_prompt TEXT,
  image_analysis TEXT,
  recipe_json TEXT,
  nutrition_json TEXT,
  blogger_content TEXT,
  blogger_url TEXT,
  blogger_post_id TEXT,
  pinterest_title TEXT,
  pinterest_description TEXT,
  pinterest_tags TEXT,
  pinterest_url TEXT,
  pinterest_pin_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  blogger_status TEXT NOT NULL DEFAULT 'not_published',
  pinterest_status TEXT NOT NULL DEFAULT 'not_published',
  stage_status TEXT,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  custom_instructions TEXT,
  nutrition_goals TEXT,
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_images (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  url TEXT,
  local_url TEXT,
  public_id TEXT,
  provider TEXT,
  mime TEXT,
  width INTEGER,
  height INTEGER,
  prompt TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishing_records (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  url TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  destinations TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT,
  scheduled_for TEXT,
  post_id TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  meta TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT,
  post_id TEXT,
  message TEXT,
  duration_ms INTEGER,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_blogger_status ON posts (blogger_status);
CREATE INDEX IF NOT EXISTS idx_posts_pinterest_status ON posts (pinterest_status);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created_at);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_posts (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_runs_created ON automation_runs (created_at);
`;

async function migrate() {
  await exec(SCHEMA);
  await ensureColumn('posts', 'image_alt', 'TEXT');
  await ensureColumn('posts', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  await seedDefaults();
}

async function columnExists(table, column) {
  if (driver === 'pg') {
    const row = await get(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [table, column],
    );
    return Boolean(row);
  }
  const rows = await query(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

async function ensureColumn(table, column, type) {
  if (await columnExists(table, column)) return;
  await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_NUTRITION_GOALS = { calories: 550, protein: 35, fat: 20, carbs: 50, fiber: 8 };

const DEFAULT_SETTINGS = {
  siteName: 'Nourish Studio',
  tagline: 'AI food content automation',
  timezone: 'Asia/Dhaka',
  language: 'English',
  defaultCategory: 'High Protein',
  defaultImageStyle: 'Realistic Food Photography',
  defaultServings: 2,
  defaultNutritionGoals: { ...DEFAULT_NUTRITION_GOALS },
  niche: 'healthy high-protein food',
  blogger: { defaultBlogId: '', defaultBlogName: '' },
  pinterest: { defaultBoardId: '', defaultBoardName: '' },
  publishing: {
    allowPinterestWithoutBlogger: false,
    updateExistingBloggerPost: true,
    pinterestDestination: 'blogger',
  },
  nutrition: { provider: 'builtin' },
  ai: { text: 'gemini', image: 'auto' },
  automation: {
    enabled: false,
    autoTopic: true,
    autoImage: true,
    autoContent: true,
    autoBlogger: true,
    autoPinterest: true,
    publishBoth: true,
    manualApproval: false,
    generateContentOnly: false,
    postsPerDay: 1,
    times: ['09:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    minDelayMinutes: 60,
    categories: ['High Protein', 'Healthy Breakfast', 'Healthy Dinner', 'Meal Prep'],
    imageStyle: 'Realistic Food Photography',
    language: 'English',
    nutritionGoals: { ...DEFAULT_NUTRITION_GOALS },
  },
  setup: { completed: false, step: 0 },
};

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (override && typeof override === 'object' && !Array.isArray(override)) {
      for (const [k, v] of Object.entries(override)) {
        out[k] = k in base ? deepMerge(base[k], v) : v;
      }
    }
    return out;
  }
  return override === undefined ? base : override;
}

const DEFAULT_PROMPTS = [
  {
    category: 'topic_generation',
    name: 'Default topic generator',
    body: `You are the content strategist for a healthy food blog focused on {{niche}}.
Generate {{count}} original, specific recipe topics for the category "{{category}}".
The topics must be practical home-cooking ideas with a clear nutritional angle (protein, calories, meal prep, etc.).

Rules:
- Never repeat or closely paraphrases these already-used topics: {{used_topics}}
- Each topic must be 6 to 14 words, natural and searchable.
- Avoid medical claims, detox language and "guaranteed" results.
- Mix cuisines and meal formats; keep them realistic for a home cook.
- Language: {{language}}.

Return JSON only in this shape:
{"topics":["topic one","topic two"]}`,
  },
  {
    category: 'image_generation',
    name: 'Default food photo prompt',
    body: `Create a realistic professional food photograph of {{topic}}.

The food must look genuinely edible, natural and appetizing.
Use realistic ingredients, realistic food textures, professional food photography,
natural window lighting, a clean composition and an attractive presentation.
Vertical 2:3 composition suitable for Pinterest.
Do not add text, captions, watermarks, logos or graphic overlays.
The image must accurately represent the actual recipe: {{food_name}}.
Style: {{image_style}}.
{{custom_instructions}}`,
  },
  {
    category: 'image_analysis',
    name: 'Default image analyst',
    body: `Analyse this food photograph carefully. The intended recipe topic is: "{{topic}}".
Describe only what is actually visible in the image. Do not invent exact quantities.

Return JSON only:
{
  "food_name": "short specific dish name",
  "category": "food category",
  "visible_ingredients": ["ingredient", "..."],
  "main_protein_source": "protein or none",
  "cooking_method": "grilled / baked / pan-fried / no-cook / ...",
  "presentation_style": "bowl / plate / meal-prep containers / ...",
  "matches_topic": true,
  "match_score": 0-100,
  "recipe_interpretation": "one or two sentences on what dish this appears to be",
  "warnings": ["anything that conflicts with the topic"]
}`,
  },
  {
    category: 'recipe_generation',
    name: 'Default recipe writer',
    body: `You are a professional recipe developer creating content for a healthy food blog.
Write one complete, original recipe for: "{{topic}}".
Language: {{language}}.
Category: {{category}}.
Servings: {{servings}}.
Nutrition goals (approximate per serving): {{nutrition_goals}}.
Image analysis of the generated photo: {{image_analysis}}.
User instructions: {{custom_instructions}}

The recipe MUST match the photo and the topic. Use real, compatible, edible ingredients.
Include exact quantities in the ingredients list (metric preferred, with US equivalents in notes).
Cooking times and temperatures must be safe and realistic. No medical claims, no "guaranteed" weight loss or muscle gain claims.
Avoid these previously used recipe titles: {{used_titles}}

Return JSON only:
{
  "title": "recipe title",
  "seo_title": "SEO title under 60 characters",
  "description": "2 sentence meta description under 160 characters",
  "introduction": "2-3 short paragraphs separated by \\n\\n",
  "category": "category",
  "prep_time_minutes": 10,
  "cook_time_minutes": 20,
  "total_time_minutes": 30,
  "difficulty": "Easy",
  "ingredients": [{"item":"chicken breast","quantity":400,"unit":"g","notes":"boneless, skinless"}],
  "instructions": ["step 1", "step 2"],
  "tips": ["practical cooking tip"],
  "storage": "how to store",
  "meal_prep": "meal prep guidance",
  "substitutions": [{"original":"Greek yogurt","alternative":"cottage cheese","note":"blended smooth"}],
  "faq": [{"question":"...","answer":"..."}],
  "conclusion": "short closing paragraph",
  "keywords": ["..."]
}`,
  },
  {
    category: 'nutrition_mapping',
    name: 'Default nutrition mapper',
    body: `Map these recipe ingredient lines to simple generic food names so a nutrition database can match them.
Ingredients: {{ingredients}}

Return JSON only: {"mappings":[{"input":"raw line","food":"generic food name"}]}
Use plain English generic names (e.g. "chicken breast", "olive oil", "Greek yogurt"). Never output quantities.`,
  },
  {
    category: 'seo_content',
    name: 'Default SEO + Pinterest writer',
    body: `Create SEO and Pinterest metadata for this recipe.

Recipe: {{recipe_title}}
Topic: {{topic}}
Category: {{category}}
Description: {{description}}
Keywords: {{keywords}}
Language: {{language}}

Rules:
- Pinterest title: max 90 characters, appealing, no clickbait, include the main keyword.
- Pinterest description: 2-4 natural sentences, keyword-rich but not stuffed, ends with a soft call to action. Max 480 characters.
- Tags: 4-8 short keyword tags. Hashtags: 3-6 relevant hashtags starting with #, no spam.
- SEO title max 60 chars, meta description max 160 chars, image alt text descriptive.
- No health guarantees or medical claims.

Return JSON only:
{
  "seo_title": "...",
  "meta_description": "...",
  "keywords": ["..."],
  "pinterest_title": "...",
  "pinterest_description": "...",
  "tags": ["..."],
  "hashtags": ["..."],
  "image_alt": "...",
  "blogger_labels": ["..."]
}`,
  },
  {
    category: 'blogger_formatting',
    name: 'Default blogger article structure',
    body: `Format the recipe into clean semantic HTML for Blogger.
Use <h2>, <h3>, <p>, <ul>, <ol>, <table> only. No inline styles, no scripts.
Include: intro, at-a-glance info, ingredients, instructions, nutrition table, tips, storage, meal prep, substitutions, FAQ and a closing note.
Recipe JSON: {{recipe}}
Nutrition: {{nutrition}}
Language: {{language}}`,
  },
  {
    category: 'content_instructions',
    name: 'Default custom instruction enhancer',
    body: `Rewrite the following user instruction into a short, precise creative brief for a recipe writer. Keep the user's intent and language. Do not add health claims. Instruction: {{custom_instructions}}`,
  },
];

async function seedDefaults() {
  const now = new Date().toISOString();
  const existing = await get(`SELECT key FROM settings WHERE key = ?`, ['config']);
  if (!existing) {
    await run(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, ['config', JSON.stringify(DEFAULT_SETTINGS), now]);
  }
  const promptCount = await get(`SELECT COUNT(*) AS c FROM prompts`);
  const count = Number(promptCount?.c || 0);
  if (count === 0) {
    for (const p of DEFAULT_PROMPTS) {
      await run(
        `INSERT INTO prompts (id, category, name, body, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), p.category, p.name, p.body, 1, now, now],
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function getSettings() {
  const row = await get(`SELECT value FROM settings WHERE key = ?`, ['config']);
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  const merged = deepMerge(DEFAULT_SETTINGS, saved);
  // environment overrides for the very first boot
  if (!merged.setup?.completed && process.env.APP_NAME && !saved.siteName) merged.siteName = process.env.APP_NAME;
  return merged;
}

async function saveSettings(patch) {
  const current = await getSettings();
  const merged = deepMerge(current, patch || {});
  delete merged.adminPassword;
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ['config', JSON.stringify(merged), new Date().toISOString()],
  );
  return merged;
}

async function getSetting(key) {
  const s = await getSettings();
  return key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), s);
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

async function getConnection(provider) {
  const row = await get(`SELECT data, updated_at FROM api_connections WHERE provider = ?`, [provider]);
  if (!row) return null;
  try { return { ...JSON.parse(decryptSecret(row.data) || '{}'), updatedAt: row.updated_at }; } catch { return null; }
}

async function setConnection(provider, data) {
  const now = new Date().toISOString();
  const payload = encryptSecret(JSON.stringify(data || {}));
  await run(
    `INSERT INTO api_connections (provider, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [provider, payload, now],
  );
  return { ...data, updatedAt: now };
}

async function deleteConnection(provider) {
  await run(`DELETE FROM api_connections WHERE provider = ?`, [provider]);
}

async function patchConnection(provider, patch) {
  const current = (await getConnection(provider)) || {};
  return setConnection(provider, { ...current, ...patch });
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

function scrub(message) {
  return String(message || '')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[redacted-key]')
    .replace(/ya29\.[0-9A-Za-z\-_]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key=[^&\s]+/gi, 'api_key=[redacted]')
    .slice(0, 4000);
}

async function logEvent({ level = 'info', service = 'app', operation = 'operation', status = 'success', postId = null, message = '', durationMs = null, meta = null }) {
  try {
    await run(
      `INSERT INTO logs (id, level, service, operation, status, post_id, message, duration_ms, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), level, service, operation, status, postId, scrub(message),
        durationMs == null ? null : Math.round(Number(durationMs)), meta ? JSON.stringify(meta) : null, new Date().toISOString()],
    );
  } catch (err) {
    console.error('[log] failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Locks + OAuth state                                                */
/* ------------------------------------------------------------------ */

async function acquireLock(name, ttlMs = 10 * 60_000) {
  const now = new Date().toISOString();
  await run(`DELETE FROM locks WHERE expires_at < ?`, [now]);
  const owner = crypto.randomUUID();
  const expires = new Date(Date.now() + ttlMs).toISOString();
  try {
    await run(`INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)`, [name, owner, expires]);
    return owner;
  } catch {
    return null;
  }
}

async function releaseLock(name, owner) {
  if (!owner) return;
  await run(`DELETE FROM locks WHERE name = ? AND owner = ?`, [name, owner]);
}

async function saveOauthState(state, provider) {
  const now = new Date();
  await run(`DELETE FROM oauth_states WHERE expires_at < ?`, [now.toISOString()]);
  await run(`INSERT INTO oauth_states (state, provider, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [state, provider, now.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString()]);
}

async function consumeOauthState(state, provider) {
  if (!state) return false;
  const row = await get(`SELECT * FROM oauth_states WHERE state = ? AND provider = ?`, [state, provider]);
  if (!row) return false;
  await run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

module.exports = {
  init, query, get, run, exec, close, get driver() { return driver; },
  getSettings, saveSettings, getSetting, deepMerge, DEFAULT_SETTINGS, DEFAULT_PROMPTS,
  getConnection, setConnection, deleteConnection, patchConnection,
  logEvent, acquireLock, releaseLock, saveOauthState, consumeOauthState,
};
