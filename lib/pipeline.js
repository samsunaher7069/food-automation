'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('./db');
const ai = require('./ai');
const nutritionLib = require('./nutrition');
const providers = require('./providers');
const {
  zonedParts, dateInZone, hhmmToMinutes, jaccard, tokenSet, truncate, HttpError, ENV,
} = require('./util');

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'data', 'media');
const CURATED_TOPICS = [
  'High-protein chicken and broccoli rice bowl',
  'Greek yogurt berry breakfast bowl with chia seeds',
  'Garlic butter salmon with roasted asparagus',
  'Easy turkey and avocado meal prep wraps',
  'Cottage cheese egg white scramble with spinach',
  'Spicy peanut tofu noodle bowl',
  'High-protein lentil and vegetable soup',
  'Sheet-pan lemon herb chicken with sweet potato',
  'Protein-packed overnight oats with banana',
  'Tuna and white bean salad with lemon',
  'Chickpea and roasted vegetable quinoa bowl',
  'Lean beef and broccoli stir-fry',
  'Creamy garlic chicken pasta with Greek yogurt',
  'Black bean and sweet potato breakfast hash',
  'Air-fryer chicken shawarma bowl',
  'High-protein strawberry smoothie with oats',
  'Baked feta and chickpea dinner bowls',
  'Egg and veggie meal prep muffins',
  'Sesame ginger shrimp and rice bowl',
  'Paneer tikka bowl with mint yogurt',
  'Protein banana oat pancakes',
  'Slow-cooker shredded chicken chili',
  'Mediterranean salmon salad with feta',
  'Tofu scramble breakfast burrito',
  'Crispy chickpea and spinach curry',
  'Peanut butter protein energy bites',
  'Grilled chicken Caesar lettuce cups',
  'Whipped cottage cheese berry toast',
  'Turkey meatballs with zucchini noodles',
  'Warm lentil and roasted carrot salad',
];

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function serializePost(row) {
  if (!row) return null;
  const stage = safeJson(row.stage_status, {});
  return {
    id: row.id,
    topic: row.topic,
    title: row.title || '',
    seoTitle: row.seo_title || '',
    description: row.description || '',
    category: row.category || '',
    language: row.language || 'English',
    servings: Number(row.servings || 2),
    imageUrl: row.image_url || '',
    imageLocalUrl: row.image_local_url || '',
    imagePublicId: row.image_public_id || '',
    imageMime: row.image_mime || '',
    imageWidth: row.image_width || null,
    imageHeight: row.image_height || null,
    imageAlt: row.image_alt || '',
    imagePrompt: row.image_prompt || '',
    imageAnalysis: safeJson(row.image_analysis, null),
    recipe: safeJson(row.recipe_json, null),
    nutrition: safeJson(row.nutrition_json, null),
    bloggerContent: row.blogger_content || '',
    bloggerUrl: row.blogger_url || '',
    bloggerPostId: row.blogger_post_id || '',
    pinterestTitle: row.pinterest_title || '',
    pinterestDescription: row.pinterest_description || '',
    pinterestTags: safeJson(row.pinterest_tags, []),
    pinterestUrl: row.pinterest_url || '',
    pinterestPinId: row.pinterest_pin_id || '',
    status: row.status || 'draft',
    bloggerStatus: row.blogger_status || 'not_published',
    pinterestStatus: row.pinterest_status || 'not_published',
    stageStatus: stage,
    error: row.error || '',
    source: row.source || 'manual',
    customInstructions: row.custom_instructions || '',
    nutritionGoals: safeJson(row.nutrition_goals, null),
    scheduledAt: row.scheduled_at || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPublicImage: /^https?:\/\//i.test(row.image_url || ''),
  };
}

async function getPostRow(id) {
  return db.get(`SELECT * FROM posts WHERE id = ?`, [id]);
}

async function getPost(id) {
  return serializePost(await getPostRow(id));
}

const POST_COLUMNS = {
  topic: 'topic', title: 'title', seoTitle: 'seo_title', description: 'description',
  category: 'category', language: 'language', servings: 'servings', imageUrl: 'image_url',
  imageLocalUrl: 'image_local_url', imagePublicId: 'image_public_id', imageMime: 'image_mime',
  imageWidth: 'image_width', imageHeight: 'image_height', imageAlt: 'image_alt',
  imagePrompt: 'image_prompt', imageAnalysis: 'image_analysis', recipe: 'recipe_json',
  nutrition: 'nutrition_json', bloggerContent: 'blogger_content', bloggerUrl: 'blogger_url',
  bloggerPostId: 'blogger_post_id', pinterestTitle: 'pinterest_title',
  pinterestDescription: 'pinterest_description', pinterestTags: 'pinterest_tags',
  pinterestUrl: 'pinterest_url', pinterestPinId: 'pinterest_pin_id', status: 'status',
  bloggerStatus: 'blogger_status', pinterestStatus: 'pinterest_status',
  stageStatus: 'stage_status', error: 'error', source: 'source',
  customInstructions: 'custom_instructions', nutritionGoals: 'nutrition_goals',
  scheduledAt: 'scheduled_at', publishedAt: 'published_at',
};

const JSON_COLUMNS = new Set(['image_analysis', 'recipe_json', 'nutrition_json', 'pinterest_tags', 'stage_status', 'nutrition_goals']);

async function updatePost(id, patch) {
  const sets = []; const params = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = POST_COLUMNS[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    if (JSON_COLUMNS.has(col)) params.push(value === null ? null : JSON.stringify(value));
    else if (typeof value === 'boolean') params.push(value ? 1 : 0);
    else params.push(value === null ? null : value);
  }
  if (!sets.length) return;
  params.push(new Date().toISOString(), id);
  await db.run(`UPDATE posts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params);
}

async function createPost(fields = {}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const row = {
    topic: fields.topic || 'Untitled healthy recipe',
    category: fields.category || 'High Protein',
    language: fields.language || 'English',
    servings: Number(fields.servings) || 2,
    imagePrompt: fields.imagePrompt || '',
    customInstructions: fields.customInstructions || '',
    nutritionGoals: fields.nutritionGoals || null,
    source: fields.source || 'manual',
  };
  await db.run(
    `INSERT INTO posts (id, topic, category, language, servings, image_prompt, custom_instructions,
      nutrition_goals, source, status, blogger_status, pinterest_status, stage_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, row.topic, row.category, row.language, row.servings, row.imagePrompt,
      row.customInstructions, row.nutritionGoals ? JSON.stringify(row.nutritionGoals) : null,
      row.source, 'draft', 'not_published', 'not_published', '{}', now, now],
  );
  if (fields.topic) await registerTopic(fields.topic, id);
  return getPost(id);
}

async function registerTopic(topic, postId) {
  const normalized = sanitizeTopicKey(topic);
  if (!normalized) return { inserted: false, similar: [] };
  const used = await db.query(`SELECT topic FROM topics ORDER BY created_at DESC LIMIT 400`);
  const similar = used.filter((r) => jaccard(r.topic, topic) >= 0.62).map((r) => r.topic);
  try {
    await db.run(`INSERT INTO topics (id, topic, normalized, post_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), topic, normalized, postId || null, new Date().toISOString()]);
    return { inserted: true, similar };
  } catch {
    return { inserted: false, similar };
  }
}

function sanitizeTopicKey(topic) {
  return String(topic || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Stages                                                             */
/* ------------------------------------------------------------------ */

async function setStage(postId, stage, status, extra = {}) {
  const row = await getPostRow(postId);
  if (!row) return;
  const current = safeJson(row.stage_status, {});
  current[stage] = { status, at: new Date().toISOString(), ...extra };
  await updatePost(postId, { stageStatus: current });
}

function assertStage(condition, postId, stage, message) {
  if (condition) return;
  setStage(postId, stage, 'failed', { error: message }).catch(() => {});
  throw new HttpError(400, message);
}

/* ------------------------------------------------------------------ */
/* Image helpers                                                      */
/* ------------------------------------------------------------------ */

function imageDimensions(buffer) {
  try {
    if (buffer.length > 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        const marker = buffer[offset + 1];
        const len = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + len;
      }
    }
    if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      if (buffer.toString('ascii', 12, 16) === 'VP8X') {
        const w = 1 + buffer.readUIntLE(24, 3); const h = 1 + buffer.readUIntLE(27, 3);
        return { width: w, height: h };
      }
    }
  } catch { /* ignore */ }
  return { width: null, height: null };
}

function extForMime(mime, fallback = 'png') {
  if (/jpe?g/i.test(mime)) return 'jpg';
  if (/webp/i.test(mime)) return 'webp';
  return fallback;
}

function saveLocalImage(buffer, postId, mime = 'image/png') {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const ext = extForMime(mime);
  const filename = `${postId}-${Date.now()}.${ext}`;
  const filePath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return { filename, filePath, localUrl: `/media/${filename}`, mime };
}

async function storeImageBuffer(postId, buffer, mime, prompt, { replace = true } = {}) {
  const saved = saveLocalImage(buffer, postId, mime);
  const dims = imageDimensions(buffer);
  let publicUpload = null;
  let uploadWarning = '';
  try {
    const cfg = await providers.cloudinaryConfig();
    if (cfg.cloudName && cfg.apiKey && cfg.apiSecret) {
      await setStage(postId, 'image_storage', 'running');
      const uploaded = await providers.uploadToCloudinary(buffer, {
        folder: `food-automation/${postId}`, filename: saved.filename, mime,
      });
      publicUpload = uploaded;
      await setStage(postId, 'image_storage', 'success', { url: uploaded.url });
    } else {
      await setStage(postId, 'image_storage', 'warning', {
        error: 'Cloudinary is not configured. Image is preview-only; Pinterest publishing needs a public URL.',
      });
    }
  } catch (err) {
    uploadWarning = `Image stored locally, but Cloudinary upload failed: ${err.message}`;
    await setStage(postId, 'image_storage', 'warning', { error: uploadWarning });
    await db.logEvent({
      level: 'warning', service: 'storage', operation: 'cloudinary.upload', status: 'warning',
      postId, message: uploadWarning,
    });
  }

  const publicUrl = publicUpload?.url || '';
  await updatePost(postId, {
    imageLocalUrl: saved.localUrl,
    imageUrl: publicUrl,
    imagePublicId: publicUpload?.publicId || '',
    imageMime: mime,
    imageWidth: dims.width || publicUpload?.width || null,
    imageHeight: dims.height || publicUpload?.height || null,
    imagePrompt: prompt || '',
  });
  await db.run(
    `INSERT INTO post_images (id, post_id, url, local_url, public_id, provider, mime, width, height, prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), postId, publicUrl || null, saved.localUrl, publicUpload?.publicId || null,
      publicUpload ? 'cloudinary' : 'local', mime, dims.width || publicUpload?.width || null,
      dims.height || publicUpload?.height || null, prompt || null, new Date().toISOString()],
  );
  return { ...saved, publicUrl, publicId: publicUpload?.publicId || '', dims, uploadWarning };
}

async function loadPostImageBuffer(post) {
  const candidates = [];
  if (post.imageLocalUrl) candidates.push(path.join(MEDIA_DIR, path.basename(post.imageLocalUrl)));
  if (!candidates.length && post.imageUrl) {
    const res = await fetch(post.imageUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new HttpError(502, `Could not download the post image (HTTP ${res.status}).`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
  }
  for (const file of candidates) {
    if (fs.existsSync(file)) return { buffer: fs.readFileSync(file), mime: post.imageMime || 'image/png' };
  }
  throw new HttpError(400, 'This post has no image. Generate or upload one first.');
}

async function ensurePublicImage(post) {
  if (/^https?:\/\//i.test(post.imageUrl || '')) return post.imageUrl;
  if (!post.imageLocalUrl) return '';
  const file = path.join(MEDIA_DIR, path.basename(post.imageLocalUrl));
  if (!fs.existsSync(file)) return '';
  try {
    const cfg = await providers.cloudinaryConfig();
    if (!cfg.cloudName) return '';
    const buffer = fs.readFileSync(file);
    const uploaded = await providers.uploadToCloudinary(buffer, {
      folder: `food-automation/${post.id}`, filename: path.basename(file), mime: post.imageMime || 'image/png',
    });
    await updatePost(post.id, { imageUrl: uploaded.url, imagePublicId: uploaded.publicId });
    await setStage(post.id, 'image_storage', 'success', { url: uploaded.url });
    return uploaded.url;
  } catch (err) {
    await db.logEvent({
      level: 'warning', service: 'storage', operation: 'cloudinary.retry', status: 'warning',
      postId: post.id, message: `Public image upload failed: ${err.message}`,
    });
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Topic selection                                                    */
/* ------------------------------------------------------------------ */

async function generateTopic({ category, language, niche, count = 6, exclude = [] }) {
  const used = await db.query(`SELECT topic FROM topics ORDER BY created_at DESC LIMIT 300`);
  const usedList = [...new Set([...used.map((r) => r.topic), ...exclude])].slice(0, 120);
  let topics = [];
  try {
    const prompt = await ai.renderPrompt('topic_generation', {
      niche: niche || 'healthy high-protein food',
      category: category || 'High Protein',
      count,
      used_topics: usedList.join('; ') || 'none yet',
      language: language || 'English',
    }, 'Generate {{count}} unique healthy recipe topics for {{category}}. Return JSON: {"topics":[]}');
    const data = await ai.generateJson({ prompt, system: 'You are a precise content planner. Output valid JSON only.' });
    topics = Array.isArray(data?.topics) ? data.topics : (Array.isArray(data) ? data : []);
  } catch (err) {
    await db.logEvent({
      level: 'warning', service: 'gemini', operation: 'topic.generate', status: 'warning',
      message: `AI topic generation failed, using curated fallback: ${err.message}`,
    });
  }
  const cleaned = [...new Set([...topics, ...CURATED_TOPICS]
    .map((t) => String(t || '').trim()).filter((t) => t.length > 8 && t.length < 140))];
  for (const topic of cleaned) {
    const duplicate = usedList.find((u) => jaccard(u, topic) >= 0.62);
    if (!duplicate) return topic;
  }
  return `${CURATED_TOPICS[usedList.length % CURATED_TOPICS.length]} variation ${Date.now().toString().slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Prompt builders                                                    */
/* ------------------------------------------------------------------ */

const STYLE_HINTS = {
  'Realistic Food Photography': 'natural window light, authentic textures, shallow depth of field',
  'Professional Restaurant Photography': 'fine-dining plating, soft directional lighting, elegant props',
  'Homemade Food Photography': 'cozy home kitchen setting, rustic table, warm natural light',
  'Meal Prep Photography': 'clean meal-prep containers, organized portions, bright even lighting',
  'Minimalist Food Photography': 'minimal ceramic plate, soft neutral background, lots of negative space',
  'Rustic Food Photography': 'dark wood surface, linen napkin, moody side lighting',
};

async function buildImagePrompt(post, { style, customInstructions } = {}) {
  if (post.imagePrompt && post.imagePrompt.trim()) return post.imagePrompt.trim();
  const settings = await db.getSettings();
  const chosenStyle = style || settings.defaultImageStyle || 'Realistic Food Photography';
  const hint = STYLE_HINTS[chosenStyle] || 'natural light, realistic textures';
  return ai.renderPrompt('image_generation', {
    topic: post.topic,
    food_name: post.topic,
    image_style: `${chosenStyle} — ${hint}`,
    custom_instructions: customInstructions || post.customInstructions || '',
    language: post.language,
  }, `Create a realistic professional food photograph of ${post.topic}. Vertical 2:3, natural light, no text or watermark.`);
}

/* ------------------------------------------------------------------ */
/* Image generation + analysis                                        */
/* ------------------------------------------------------------------ */

async function generateImageStage(postId, { style, customInstructions, prompt, regenerate = false } = {}) {
  const post = await getPost(postId);
  assertStage(post, postId, 'image', 'Post not found.');
  const started = Date.now();
  await updatePost(postId, { status: 'generating' });
  await setStage(postId, 'image', 'running');

  const finalPrompt = prompt || post.imagePrompt || await buildImagePrompt(post, { style, customInstructions });
  if (prompt) await updatePost(postId, { imagePrompt: prompt });
  else if (!post.imagePrompt) await updatePost(postId, { imagePrompt: finalPrompt });

  try {
    const result = await ai.generateImage({ prompt: finalPrompt, aspectRatio: '2:3' });
    const stored = await storeImageBuffer(postId, result.buffer, result.mime, finalPrompt);
    await setStage(postId, 'image', 'success', {
      model: result.model, url: stored.publicUrl || stored.localUrl, durationMs: Date.now() - started,
    });
    await updatePost(postId, {
      status: 'generated',
      error: stored.uploadWarning || '',
      imageAnalysis: regenerate ? null : post.imageAnalysis,
    });
    await db.logEvent({
      level: 'success', service: 'gemini', operation: 'image.generate', status: 'success',
      postId, message: `Image generated with ${result.model}${stored.publicUrl ? '' : ' (local preview only)'}`,
      durationMs: Date.now() - started, meta: { model: result.model, bytes: result.buffer.length },
    });
    if (regenerate) {
      const row = await getPostRow(postId);
      const stages = safeJson(row.stage_status, {});
      for (const k of ['image_analysis', 'recipe', 'nutrition', 'seo', 'blogger_html']) delete stages[k];
      await updatePost(postId, { stageStatus: stages, imageAnalysis: null, recipe: null, nutrition: null, pinterestTitle: '', bloggerContent: '' });
    }
    return getPost(postId);
  } catch (err) {
    await setStage(postId, 'image', 'failed', { error: err.message });
    await updatePost(postId, { status: 'failed', error: `Image generation failed: ${err.message}` });
    await db.logEvent({
      level: 'error', service: 'gemini', operation: 'image.generate', status: 'error',
      postId, message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

async function uploadImageStage(postId, buffer, mime) {
  const post = await getPostRow(postId);
  if (!post) throw new HttpError(404, 'Post not found.');
  if (!buffer?.length) throw new HttpError(400, 'Uploaded image is empty.');
  if (buffer.length > 12 * 1024 * 1024) throw new HttpError(413, 'Image is larger than 12 MB.');
  const stored = await storeImageBuffer(postId, buffer, mime || 'image/png', post.image_prompt || 'Custom uploaded image');
  await setStage(postId, 'image', 'success', { source: 'upload', url: stored.publicUrl || stored.localUrl });
  const row = await getPostRow(postId);
  const stages = safeJson(row.stage_status, {});
  for (const k of ['image_analysis', 'recipe', 'nutrition', 'seo', 'blogger_html']) delete stages[k];
  await updatePost(postId, {
    stageStatus: stages, imageAnalysis: null, recipe: null, nutrition: null, bloggerContent: '',
    pinterestTitle: '', status: 'generated', error: stored.uploadWarning || '',
  });
  return getPost(postId);
}

async function analyzeImageStage(postId) {
  const post = await getPost(postId);
  assertStage(post, postId, 'image_analysis', 'Post not found.');
  if (!post.imageLocalUrl && !post.imageUrl) assertStage(false, postId, 'image_analysis', 'Generate or upload an image before analysing it.');
  await setStage(postId, 'image_analysis', 'running');
  const started = Date.now();
  try {
    const { buffer, mime } = await loadPostImageBuffer(post);
    const prompt = await ai.renderPrompt('image_analysis', { topic: post.topic, language: post.language },
      `Analyse this food photograph for the topic "${post.topic}". Return JSON.`);
    const analysis = await ai.analyzeImage({ imageBuffer: buffer, mime, prompt });
    const score = Number(analysis?.match_score);
    const warning = score && score < 55
      ? `Image appears to differ from the topic (match score ${score}/100). Consider regenerating the image.`
      : '';
    await updatePost(postId, { imageAnalysis: analysis, error: warning || '' });
    await setStage(postId, 'image_analysis', 'success', { matchScore: Number.isFinite(score) ? score : null });
    await db.logEvent({
      level: warning ? 'warning' : 'success', service: 'gemini', operation: 'image.analyze',
      status: warning ? 'warning' : 'success', postId,
      message: warning || `Image analysed: ${truncate(analysis?.food_name || 'food', 80)}`,
      durationMs: Date.now() - started,
    });
    return getPost(postId);
  } catch (err) {
    await setStage(postId, 'image_analysis', 'failed', { error: err.message });
    await db.logEvent({
      level: 'error', service: 'gemini', operation: 'image.analyze', status: 'error',
      postId, message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Recipe                                                             */
/* ------------------------------------------------------------------ */

function normalizeRecipe(raw, post) {
  const r = raw || {};
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).map((ing) => {
    if (typeof ing === 'string') {
      const p = nutritionLib.parseIngredient(ing);
      return { item: p.name, quantity: p.qty, unit: p.unit || '', notes: '' };
    }
    return {
      item: String(ing.item || ing.name || '').trim(),
      quantity: Number(ing.quantity ?? ing.qty) || 1,
      unit: String(ing.unit || '').trim(),
      notes: String(ing.notes || '').trim(),
    };
  }).filter((i) => i.item);

  const asText = (v) => (typeof v === 'string' ? v : (v?.text || ''));
  const instructions = (Array.isArray(r.instructions) ? r.instructions : []).map((s) => asText(s)).filter(Boolean);
  const tips = (Array.isArray(r.tips) ? r.tips : []).map(asText).filter(Boolean);
  const substitutions = (Array.isArray(r.substitutions) ? r.substitutions : []).map((s) => {
    if (typeof s === 'string') return { original: s, alternative: '', note: '' };
    return { original: String(s.original || s.ingredient || ''), alternative: String(s.alternative || s.substitute || ''), note: String(s.note || '') };
  }).filter((s) => s.original || s.alternative);
  const faq = (Array.isArray(r.faq) ? r.faq : []).map((f) => ({
    question: String(f.question || f.q || ''), answer: String(f.answer || f.a || ''),
  })).filter((f) => f.question && f.answer);
  const keywords = Array.isArray(r.keywords) ? r.keywords.map(String) : [];

  return {
    title: String(r.title || post.topic || 'Healthy recipe').slice(0, 140),
    seo_title: String(r.seo_title || r.title || post.topic || '').slice(0, 70),
    description: String(r.description || '').slice(0, 300),
    introduction: String(r.introduction || ''),
    category: String(r.category || post.category || 'High Protein'),
    prep_time_minutes: Math.max(0, Number(r.prep_time_minutes ?? r.prep_time) || 10),
    cook_time_minutes: Math.max(0, Number(r.cook_time_minutes ?? r.cook_time) || 20),
    total_time_minutes: Math.max(1, Number(r.total_time_minutes ?? r.total_time) || ((Number(r.prep_time_minutes) || 10) + (Number(r.cook_time_minutes) || 20))),
    difficulty: String(r.difficulty || 'Easy'),
    servings: Math.max(1, Number(r.servings) || post.servings || 2),
    ingredients,
    instructions,
    tips,
    storage: String(r.storage || ''),
    meal_prep: String(r.meal_prep || ''),
    substitutions,
    faq,
    conclusion: String(r.conclusion || ''),
    keywords,
    generatedAt: new Date().toISOString(),
  };
}

async function generateRecipeStage(postId, { regenerate = false, extraInstructions = '' } = {}) {
  const post = await getPost(postId);
  assertStage(post, postId, 'recipe', 'Post not found.');
  await setStage(postId, 'recipe', 'running');
  const started = Date.now();
  try {
    const existingTitles = (await db.query(`SELECT title FROM posts WHERE title IS NOT NULL AND id <> ? ORDER BY created_at DESC LIMIT 200`, [postId]))
      .map((r) => r.title).filter(Boolean);
    const goals = post.nutritionGoals || (await db.getSettings()).automation.nutritionGoals;
    const prompt = await ai.renderPrompt('recipe_generation', {
      topic: post.topic,
      language: post.language || 'English',
      category: post.category || 'High Protein',
      servings: post.servings || 2,
      nutrition_goals: goals ? JSON.stringify(goals) : 'balanced, high protein',
      image_analysis: post.imageAnalysis ? JSON.stringify(post.imageAnalysis) : 'No image analysis available. Follow the topic.',
      custom_instructions: [post.customInstructions, extraInstructions].filter(Boolean).join(' ') || 'None',
      used_titles: existingTitles.slice(0, 40).join('; ') || 'none',
    }, `Write a complete recipe for ${post.topic}. Return JSON.`);

    let data = await ai.generateJson({ prompt, system: 'You are a professional recipe developer. Output valid JSON only.', maxOutputTokens: 16_384 });
    let recipe = normalizeRecipe(data, post);

    if (existingTitles.some((t) => jaccard(t, recipe.title) >= 0.8)) {
      await db.logEvent({
        level: 'warning', service: 'gemini', operation: 'recipe.duplicate', status: 'warning', postId,
        message: `Recipe title close to an existing post ("${recipe.title}"); regenerating once with a stronger uniqueness instruction.`,
      });
      const retryPrompt = `${prompt}\n\nIMPORTANT: The previous attempt produced a title too similar to an existing post. Invent a clearly different recipe title and angle. Previous attempt: ${recipe.title}`;
      data = await ai.generateJson({ prompt: retryPrompt, system: 'You are a professional recipe developer. Output valid JSON only.', maxOutputTokens: 16_384 });
      recipe = normalizeRecipe(data, post);
    }

    await updatePost(postId, {
      title: recipe.title,
      seoTitle: recipe.seo_title,
      description: recipe.description,
      category: recipe.category || post.category,
      servings: recipe.servings,
      recipe,
      status: 'generated',
      error: '',
    });
    await setStage(postId, 'recipe', 'success', { title: recipe.title, ingredients: recipe.ingredients.length });
    await db.logEvent({
      level: 'success', service: 'gemini', operation: 'recipe.generate', status: 'success', postId,
      message: `Recipe generated: ${truncate(recipe.title, 120)}`, durationMs: Date.now() - started,
    });
    return getPost(postId);
  } catch (err) {
    await setStage(postId, 'recipe', 'failed', { error: err.message });
    await updatePost(postId, { status: 'failed', error: `Recipe generation failed: ${err.message}` });
    await db.logEvent({
      level: 'error', service: 'gemini', operation: 'recipe.generate', status: 'error', postId,
      message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Nutrition                                                         */
/* ------------------------------------------------------------------ */

async function calculateNutritionStage(postId) {
  const post = await getPost(postId);
  assertStage(post, postId, 'nutrition', 'Post not found.');
  assertStage(post.recipe?.ingredients?.length, postId, 'nutrition', 'Generate a recipe before calculating nutrition.');
  await setStage(postId, 'nutrition', 'running');
  const settings = await db.getSettings();
  const conn = (await db.getConnection('nutrition')) || {};
  const provider = settings.nutrition?.provider || 'builtin';
  const usdaKey = conn.usdaKey || process.env.NUTRITION_API_KEY || '';
  try {
    let mapWithAI = null;
    if (provider === 'gemini') {
      mapWithAI = async (lines) => {
        const prompt = await ai.renderPrompt('nutrition_mapping', { ingredients: lines.join('\n') },
          'Map ingredients to generic food names. Return JSON.');
        return ai.generateJson({ prompt, maxOutputTokens: 2048 });
      };
    }
    const result = await nutritionLib.calculateNutrition(post.recipe.ingredients, post.recipe.servings || post.servings, {
      provider, usdaKey, mapWithAI,
    });
    await updatePost(postId, { nutrition: result });
    await setStage(postId, 'nutrition', result.unmatchedCount ? 'warning' : 'success', {
      confidence: result.confidence, unmatched: result.unmatched,
    });
    await db.logEvent({
      level: result.unmatchedCount ? 'warning' : 'success', service: 'nutrition', operation: 'nutrition.calculate',
      status: result.unmatchedCount ? 'warning' : 'success', postId,
      message: `Estimated ${result.perServing.calories} kcal and ${result.perServing.protein} g protein per serving. `
        + `${result.matchedCount}/${result.ingredients.length} ingredients matched` +
        (result.unmatched.length ? `; unmatched: ${result.unmatched.join(', ')}` : ''),
    });
    return getPost(postId);
  } catch (err) {
    await setStage(postId, 'nutrition', 'failed', { error: err.message });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* SEO                                                                */
/* ------------------------------------------------------------------ */

async function generateSeoStage(postId) {
  const post = await getPost(postId);
  assertStage(post, postId, 'seo', 'Post not found.');
  assertStage(post.recipe, postId, 'seo', 'Generate a recipe before SEO content.');
  await setStage(postId, 'seo', 'running');
  const started = Date.now();
  try {
    const prompt = await ai.renderPrompt('seo_content', {
      recipe_title: post.recipe.title,
      topic: post.topic,
      category: post.category,
      description: post.recipe.description,
      keywords: post.recipe.keywords || [],
      language: post.language,
    }, 'Create SEO and Pinterest metadata. Return JSON.');
    const data = await ai.generateJson({ prompt, system: 'You are an SEO editor for a food blog. Output valid JSON only.', maxOutputTokens: 4096 });
    const seo = {
      seo_title: String(data.seo_title || post.seoTitle || post.recipe.seo_title || '').slice(0, 70),
      meta_description: String(data.meta_description || post.description || post.recipe.description || '').slice(0, 200),
      keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
      pinterest_title: String(data.pinterest_title || post.recipe.title).slice(0, 100),
      pinterest_description: String(data.pinterest_description || post.recipe.description || '').slice(0, 500),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      hashtags: Array.isArray(data.hashtags) ? data.hashtags.map(String) : [],
      image_alt: String(data.image_alt || post.recipe.title),
      blogger_labels: Array.isArray(data.blogger_labels) ? data.blogger_labels.map(String) : [],
    };
    const recipe = { ...post.recipe, seo };
    await updatePost(postId, {
      seoTitle: seo.seo_title || post.seoTitle,
      description: seo.meta_description || post.description,
      pinterestTitle: seo.pinterest_title,
      pinterestDescription: seo.pinterest_description,
      pinterestTags: seo.tags,
      imageAlt: seo.image_alt,
      recipe,
    });
    await setStage(postId, 'seo', 'success');
    await db.logEvent({
      level: 'success', service: 'gemini', operation: 'seo.generate', status: 'success', postId,
      message: `SEO + Pinterest metadata generated for "${truncate(seo.pinterest_title, 100)}"`,
      durationMs: Date.now() - started,
    });
    return getPost(postId);
  } catch (err) {
    await setStage(postId, 'seo', 'failed', { error: err.message });
    await db.logEvent({
      level: 'error', service: 'gemini', operation: 'seo.generate', status: 'error', postId,
      message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Blogger article HTML                                               */
/* ------------------------------------------------------------------ */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
}

function buildBloggerHtml(post) {
  const recipe = post.recipe || {};
  const n = post.nutrition;
  const seo = recipe.seo || {};
  const imageUrl = post.imageUrl || post.imageLocalUrl || '';
  const absoluteImage = /^https?:\/\//i.test(imageUrl) ? imageUrl : (imageUrl ? `${ENV.appUrl}${imageUrl}` : '');
  const alt = escapeHtml(post.imageAlt || seo.image_alt || recipe.title || post.topic);
  const servings = recipe.servings || post.servings || 2;
  const title = escapeHtml(recipe.title || post.title || post.topic);

  const ingredientItems = (recipe.ingredients || []).map((ing) => {
    const qty = `${ing.quantity ?? ''} ${ing.unit || ''}`.trim();
    return `<li>${escapeHtml(qty ? `${qty} ` : '')}${escapeHtml(ing.item)}${ing.notes ? ` <em>(${escapeHtml(ing.notes)})</em>` : ''}</li>`;
  }).join('\n');

  const steps = (recipe.instructions || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('\n');
  const tips = (recipe.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('\n');
  const subs = (recipe.substitutions || []).map((s) =>
    `<li><strong>${escapeHtml(s.original)}</strong> → ${escapeHtml(s.alternative)}${s.note ? ` — ${escapeHtml(s.note)}` : ''}</li>`).join('\n');
  const faqs = (recipe.faq || []).map((f) =>
    `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`).join('\n');

  const nutritionTable = n ? `
<h2>Nutrition (per serving)</h2>
<p><em>Estimated values based on ingredient quantities. Actual values vary by brand and preparation.</em></p>
<table>
  <thead><tr><th>Nutrient</th><th>Per serving</th><th>Whole recipe</th></tr></thead>
  <tbody>
    <tr><td>Calories</td><td>${n.perServing?.calories ?? '—'} kcal</td><td>${n.total?.calories ?? '—'} kcal</td></tr>
    <tr><td>Protein</td><td>${n.perServing?.protein ?? '—'} g</td><td>${n.total?.protein ?? '—'} g</td></tr>
    <tr><td>Carbohydrates</td><td>${n.perServing?.carbs ?? '—'} g</td><td>${n.total?.carbs ?? '—'} g</td></tr>
    <tr><td>Fat</td><td>${n.perServing?.fat ?? '—'} g</td><td>${n.total?.fat ?? '—'} g</td></tr>
    <tr><td>Saturated fat</td><td>${n.perServing?.satfat ?? '—'} g</td><td>${n.total?.satfat ?? '—'} g</td></tr>
    <tr><td>Fiber</td><td>${n.perServing?.fiber ?? '—'} g</td><td>${n.total?.fiber ?? '—'} g</td></tr>
    <tr><td>Sugar</td><td>${n.perServing?.sugar ?? '—'} g</td><td>${n.total?.sugar ?? '—'} g</td></tr>
    <tr><td>Sodium</td><td>${n.perServing?.sodium ?? '—'} mg</td><td>${n.total?.sodium ?? '—'} mg</td></tr>
  </tbody>
</table>` : '';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title || post.title,
    image: absoluteImage ? [absoluteImage] : undefined,
    description: recipe.description || post.description,
    recipeCategory: recipe.category || post.category,
    recipeCuisine: 'Healthy',
    prepTime: `PT${Number(recipe.prep_time_minutes) || 0}M`,
    cookTime: `PT${Number(recipe.cook_time_minutes) || 0}M`,
    totalTime: `PT${Number(recipe.total_time_minutes) || 0}M`,
    recipeYield: `${servings} servings`,
    keywords: (recipe.keywords || []).join(', '),
    recipeIngredient: (recipe.ingredients || []).map((i) => `${i.quantity ?? ''} ${i.unit || ''} ${i.item}`.replace(/\s+/g, ' ').trim()),
    recipeInstructions: (recipe.instructions || []).map((s) => ({ '@type': 'HowToStep', text: s })),
    nutrition: n ? {
      '@type': 'NutritionInformation',
      calories: `${n.perServing?.calories ?? ''} calories`,
      proteinContent: `${n.perServing?.protein ?? ''} g`,
      carbohydrateContent: `${n.perServing?.carbs ?? ''} g`,
      fatContent: `${n.perServing?.fat ?? ''} g`,
      fiberContent: `${n.perServing?.fiber ?? ''} g`,
    } : undefined,
  };

  const blogUrl = post.bloggerBlogUrl || '';

  return `<article class="recipe-post">
<p class="recipe-lead">${escapeHtml(recipe.description || post.description || '')}</p>
${absoluteImage ? `<figure><img src="${escapeHtml(absoluteImage)}" alt="${alt}" loading="lazy" />${recipe.title ? `<figcaption>${escapeHtml(recipe.title)}</figcaption>` : ''}</figure>` : ''}
${paragraphs(recipe.introduction || '')}
<div class="recipe-meta">
  <p><strong>Prep time:</strong> ${Number(recipe.prep_time_minutes) || 0} minutes · <strong>Cook time:</strong> ${Number(recipe.cook_time_minutes) || 0} minutes · <strong>Total:</strong> ${Number(recipe.total_time_minutes) || 0} minutes</p>
  <p><strong>Servings:</strong> ${servings} · <strong>Difficulty:</strong> ${escapeHtml(recipe.difficulty || 'Easy')} · <strong>Category:</strong> ${escapeHtml(recipe.category || post.category)}</p>
</div>
<h2>Ingredients</h2>
<ul>
${ingredientItems}
</ul>
<h2>Instructions</h2>
<ol>
${steps}
</ol>
${nutritionTable}
${tips ? `<h2>Recipe tips</h2>\n<ul>\n${tips}\n</ul>` : ''}
${recipe.storage ? `<h2>Storage</h2>\n<p>${escapeHtml(recipe.storage)}</p>` : ''}
${recipe.meal_prep ? `<h2>Meal prep</h2>\n<p>${escapeHtml(recipe.meal_prep)}</p>` : ''}
${subs ? `<h2>Substitutions</h2>\n<ul>\n${subs}\n</ul>` : ''}
${faqs ? `<h2>Frequently asked questions</h2>\n${faqs}` : ''}
${recipe.conclusion ? `<h2>Final thoughts</h2>\n${paragraphs(recipe.conclusion)}` : ''}
<p><em>Nutrition figures are estimates and are not medical advice. Check labels and adjust portions to your own needs.</em></p>
${blogUrl ? `<p><a href="${escapeHtml(blogUrl)}">More healthy recipes on the blog</a></p>` : ''}
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}</script>
</article>`;
}

async function buildBloggerContentStage(postId) {
  const post = await getPost(postId);
  assertStage(post, postId, 'blogger_html', 'Post not found.');
  assertStage(post.recipe, postId, 'blogger_html', 'Generate a recipe before building the article.');
  const settings = await db.getSettings();
  const html = buildBloggerHtml({ ...post, bloggerBlogUrl: settings.blogger?.defaultBlogUrl || '' });
  await updatePost(postId, { bloggerContent: html, imageAlt: post.imageAlt || post.recipe?.seo?.image_alt || post.recipe?.title });
  await setStage(postId, 'blogger_html', 'success');
  return getPost(postId);
}

/* ------------------------------------------------------------------ */
/* Publishing                                                         */
/* ------------------------------------------------------------------ */

async function recordPublishing(postId, platform, status, { externalId = '', url = '', error = '' } = {}) {
  const now = new Date().toISOString();
  const existing = await db.get(`SELECT id, attempts FROM publishing_records WHERE post_id = ? AND platform = ?`, [postId, platform]);
  if (existing) {
    await db.run(
      `UPDATE publishing_records SET status = ?, external_id = ?, url = ?, error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      [status, externalId || null, url || null, error ? truncate(error, 2000) : null, now, existing.id],
    );
  } else {
    await db.run(
      `INSERT INTO publishing_records (id, post_id, platform, status, external_id, url, error, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), postId, platform, status, externalId || null, url || null, error ? truncate(error, 2000) : null, 1, now, now],
    );
  }
}

function computeStatus(post) {
  const b = post.bloggerStatus; const p = post.pinterestStatus;
  if (b === 'published' && p === 'published') return 'published';
  if (b === 'failed' || p === 'failed') return (b === 'published' || p === 'published') ? 'partially_published' : 'failed';
  if (b === 'published') return 'partially_published';
  if (p === 'published') return 'partially_published';
  if (b === 'publishing' || p === 'publishing') return 'publishing';
  return post.status === 'draft' ? 'draft' : 'generated';
}

async function publishBloggerStage(postId, { forceNew = false, isDraft = false } = {}) {
  const settings = await db.getSettings();
  const blogId = settings.blogger?.defaultBlogId;
  const started = Date.now();
  const row = await getPostRow(postId);
  assertStage(row, postId, 'blogger_publish', 'Post not found.');

  if (row.blogger_post_id && !forceNew) {
    const url = row.blogger_url || '';
    if (url) {
      await db.logEvent({
        level: 'info', service: 'blogger', operation: 'blogger.publish', status: 'success', postId,
        message: 'Blogger article already exists — skipped to prevent a duplicate article.',
      });
      return getPost(postId);
    }
  }

  assertStage(blogId, postId, 'blogger_publish', 'No default Blogger blog selected. Choose one in API Connections.');
  await setStage(postId, 'blogger_publish', 'running');
  await updatePost(postId, { bloggerStatus: 'publishing', status: computeStatus({ ...row, bloggerStatus: 'publishing', pinterestStatus: row.pinterest_status || 'not_published' }) });

  try {
    let post = await getPost(postId);
    if (!post.bloggerContent) post = await buildBloggerContentStage(postId);
    const labels = post.recipe?.seo?.blogger_labels || post.recipe?.keywords?.slice(0, 5) || [];

    let result;
    if (post.bloggerPostId) {
      // Re-publishing an existing article updates it instead of creating a duplicate.
      result = await providers.updateBloggerPost({
        blogId, postId: post.bloggerPostId, title: post.seoTitle || post.title, content: post.bloggerContent, labels,
      });
      if (!isDraft && String(result.status || '').toLowerCase() === 'draft') {
        result = await providers.publishBloggerDraft({ blogId, postId: post.bloggerPostId });
      }
    } else {
      result = await providers.publishBloggerPost({
        blogId, title: post.seoTitle || post.title, content: post.bloggerContent,
        labels, isDraft,
      });
    }

    if (!result.url) throw new HttpError(502, 'Blogger published the article but returned no URL.');
    const current = await getPost(postId);
    await updatePost(postId, {
      bloggerPostId: result.id || '',
      bloggerUrl: result.url,
      bloggerStatus: isDraft ? 'draft' : 'published',
      publishedAt: current.publishedAt || (isDraft ? null : new Date().toISOString()),
      error: isDraft ? current.error : '',
      status: computeStatus({ ...current, bloggerStatus: isDraft ? 'draft' : 'published' }),
    });
    await setStage(postId, 'blogger_publish', 'success', { url: result.url, id: result.id });
    await recordPublishing(postId, 'blogger', isDraft ? 'draft' : 'published', { externalId: result.id, url: result.url });
    await db.logEvent({
      level: 'success', service: 'blogger', operation: 'blogger.publish', status: 'success', postId,
      message: `${isDraft ? 'Draft saved' : 'Article published'}: ${truncate(result.url, 200)}`,
      durationMs: Date.now() - started,
    });
    return getPost(postId);
  } catch (err) {
    await updatePost(postId, { bloggerStatus: 'failed', status: 'failed', error: `Blogger publishing failed: ${err.message}` });
    await setStage(postId, 'blogger_publish', 'failed', { error: err.message });
    await recordPublishing(postId, 'blogger', 'failed', { error: err.message });
    await db.logEvent({
      level: 'error', service: 'blogger', operation: 'blogger.publish', status: 'error', postId,
      message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

async function publishPinterestStage(postId, { forceNew = false } = {}) {
  const settings = await db.getSettings();
  const started = Date.now();
  let row = await getPostRow(postId);
  assertStage(row, postId, 'pinterest_publish', 'Post not found.');

  if (row.pinterest_pin_id && !forceNew) {
    await db.logEvent({
      level: 'info', service: 'pinterest', operation: 'pinterest.publish', status: 'success', postId,
      message: 'Pinterest Pin already exists — skipped to prevent a duplicate Pin.',
    });
    return getPost(postId);
  }

  const allowNoBlogger = Boolean(settings.publishing?.allowPinterestWithoutBlogger);
  assertStage(row.blogger_url || allowNoBlogger, postId, 'pinterest_publish',
    'Pinterest needs a live Blogger article URL as the destination. Publish to Blogger first, or enable the override in Settings.');
  assertStage(settings.pinterest?.defaultBoardId, postId, 'pinterest_publish',
    'No default Pinterest board selected. Choose one in API Connections.');

  let publicImage = row.image_url || '';
  if (!/^https?:\/\//i.test(publicImage)) {
    publicImage = await ensurePublicImage(serializePost(row));
    row = await getPostRow(postId);
  }
  assertStage(/^https?:\/\//i.test(publicImage), postId, 'pinterest_publish',
    'Pinterest requires a public image URL. Configure Cloudinary in API Connections and regenerate/upload the image.');

  const destination = row.blogger_url || (allowNoBlogger ? ENV.appUrl : '');
  await setStage(postId, 'pinterest_publish', 'running');
  await updatePost(postId, { pinterestStatus: 'publishing', status: 'publishing' });

  try {
    const post = await getPost(postId);
    const result = await providers.createPinterestPin({
      boardId: settings.pinterest.defaultBoardId,
      title: post.pinterestTitle || post.recipe?.seo?.pinterest_title || post.title,
      description: post.pinterestDescription || post.recipe?.seo?.pinterest_description || post.recipe?.description || '',
      link: destination,
      imageUrl: publicImage,
      altText: post.imageAlt || post.recipe?.title,
    });
    const successPost = await getPost(postId);
    await updatePost(postId, {
      pinterestPinId: result.id || '',
      pinterestUrl: result.url || (result.id ? `https://www.pinterest.com/pin/${result.id}/` : ''),
      pinterestStatus: 'published',
      error: '',
      status: computeStatus({ ...successPost, pinterestStatus: 'published' }),
    });
    await setStage(postId, 'pinterest_publish', 'success', { pinId: result.id, url: result.url });
    await recordPublishing(postId, 'pinterest', 'published', { externalId: result.id, url: result.url });
    await db.logEvent({
      level: 'success', service: 'pinterest', operation: 'pinterest.publish', status: 'success', postId,
      message: `Pin created: ${truncate(result.url || result.id, 200)} → ${truncate(destination, 160)}`,
      durationMs: Date.now() - started,
    });
    return getPost(postId);
  } catch (err) {
    const failPost = await getPost(postId);
    await updatePost(postId, {
      pinterestStatus: 'failed',
      status: computeStatus({ ...failPost, pinterestStatus: 'failed' }),
      error: `Pinterest publishing failed: ${err.message}`,
    });
    await setStage(postId, 'pinterest_publish', 'failed', { error: err.message });
    await recordPublishing(postId, 'pinterest', 'failed', { error: err.message });
    await db.logEvent({
      level: 'error', service: 'pinterest', operation: 'pinterest.publish', status: 'error', postId,
      message: err.message, durationMs: Date.now() - started,
    });
    throw err;
  }
}

async function publishPost(postId, platforms = ['blogger', 'pinterest'], options = {}) {
  const lock = await db.acquireLock(`post-publish:${postId}`, 15 * 60_000);
  if (!lock) throw new HttpError(409, 'A publishing job for this post is already running.');
  const results = { blogger: null, pinterest: null, errors: [] };
  try {
    const post = await getPost(postId);
    assertStage(post, postId, 'publish', 'Post not found.');
    if (platforms.includes('blogger')) {
      try { results.blogger = await publishBloggerStage(postId, options); }
      catch (err) { results.errors.push({ platform: 'blogger', error: err.message }); }
    }
    const after = await getPost(postId);
    if (platforms.includes('pinterest')) {
      if (!after.bloggerUrl && !results.blogger?.bloggerUrl && !(await db.getSettings()).publishing?.allowPinterestWithoutBlogger) {
        results.errors.push({ platform: 'pinterest', error: 'Pinterest was not attempted because the Blogger destination URL is unavailable.' });
      } else {
        try { results.pinterest = await publishPinterestStage(postId, options); }
        catch (err) { results.errors.push({ platform: 'pinterest', error: err.message }); }
      }
    }
    results.post = await getPost(postId);
    return results;
  } finally {
    await db.releaseLock(`post-publish:${postId}`, lock);
  }
}

/* ------------------------------------------------------------------ */
/* Full generation pipeline                                           */
/* ------------------------------------------------------------------ */

async function runPipeline({ postId = null, options = {} } = {}) {
  const {
    topic, category, language, servings, imageStyle, imagePrompt, customInstructions,
    nutritionGoals, publish = false, platforms = ['blogger', 'pinterest'], regenerate = {},
    skipImage = false, skipContent = false,
  } = options;

  let post = postId ? await getPost(postId) : null;
  if (!post) {
    post = await createPost({
      topic, category, language, servings, imagePrompt, customInstructions, nutritionGoals,
      source: options.source || 'manual',
    });
  } else {
    await updatePost(post.id, {
      topic: topic || post.topic,
      category: category || post.category,
      language: language || post.language,
      servings: servings || post.servings,
      customInstructions: customInstructions ?? post.customInstructions,
      nutritionGoals: nutritionGoals || post.nutritionGoals,
      ...(imagePrompt ? { imagePrompt } : {}),
    });
    post = await getPost(post.id);
  }

  const id = post.id;
  try {
    if (!skipImage && ((!post.imageLocalUrl && !post.imageUrl) || regenerate.image)) {
      post = await generateImageStage(id, { style: imageStyle, customInstructions, prompt: imagePrompt, regenerate: Boolean(regenerate.image) });
    }
    if (skipContent) {
      await setStage(id, 'content', 'skipped', { reason: 'Content generation is disabled in automation settings.' });
      await updatePost(id, { status: post.recipe ? 'generated' : 'draft' });
      return getPost(id);
    }
    if (!skipImage && (!post.imageAnalysis || regenerate.image || regenerate.analysis) && (post.imageLocalUrl || post.imageUrl)) {
      post = await analyzeImageStage(id);
    }
    if (!post.recipe || regenerate.recipe) post = await generateRecipeStage(id);
    if (!post.nutrition || regenerate.recipe || regenerate.nutrition) post = await calculateNutritionStage(id);
    if (!post.pinterestTitle || regenerate.seo) post = await generateSeoStage(id);
    if (!post.bloggerContent || regenerate.seo || regenerate.recipe) post = await buildBloggerContentStage(id);
    await setStage(id, 'content', 'success');

    if (publish) {
      const result = await publishPost(id, platforms, {});
      post = result.post;
      if (result.errors.length) {
        const msg = result.errors.map((e) => `${e.platform}: ${e.error}`).join(' | ');
        await updatePost(id, { error: msg });
        post = await getPost(id);
      }
    } else {
      await updatePost(id, { status: 'generated', error: '' });
      post = await getPost(id);
    }
    return post;
  } catch (err) {
    await updatePost(id, { status: 'failed', error: err.message });
    await setStage(id, 'content', 'failed', { error: err.message });
    throw Object.assign(err, { postId: id });
  }
}

/* ------------------------------------------------------------------ */
/* Scheduled posts                                                    */
/* ------------------------------------------------------------------ */

async function processDueScheduled(now = new Date()) {
  const due = await db.query(
    `SELECT * FROM scheduled_posts WHERE status = 'Scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 5`,
    [now.toISOString()],
  );
  const results = [];
  for (const item of due) {
    const claim = await db.run(
      `UPDATE scheduled_posts SET status = 'Running', updated_at = ? WHERE id = ? AND status = 'Scheduled'`,
      [new Date().toISOString(), item.id],
    );
    if (!claim.changes) continue;
    let destinations = safeJson(item.destinations, ['blogger', 'pinterest']);
    if (!Array.isArray(destinations) || !destinations.length) destinations = ['blogger'];
    try {
      let post = await getPost(item.post_id);
      if (!post) throw new Error('The scheduled post no longer exists.');
      const needsContent = !post.recipe || !post.nutrition || !post.pinterestTitle;
      if (needsContent) post = await runPipeline({ postId: post.id, options: { publish: false } });
      const result = await publishPost(post.id, destinations, {});
      const failed = result.errors.filter((e) => e.platform !== 'pinterest' || destinations.includes('pinterest'));
      if (failed.length) throw new Error(failed.map((e) => `${e.platform}: ${e.error}`).join(' | '));
      await db.run(`UPDATE scheduled_posts SET status = 'Published', updated_at = ? WHERE id = ?`, [new Date().toISOString(), item.id]);
      await updatePost(post.id, { scheduledAt: null, status: computeStatus(await getPost(post.id)) });
      await db.logEvent({
        level: 'success', service: 'scheduler', operation: 'scheduled.publish', status: 'success',
        postId: post.id, message: `Scheduled post published to ${destinations.join(' + ')}.`,
      });
      results.push({ id: item.id, status: 'Published' });
    } catch (err) {
      await db.run(`UPDATE scheduled_posts SET status = 'Failed', note = ?, updated_at = ? WHERE id = ?`,
        [truncate(err.message, 1000), new Date().toISOString(), item.id]);
      await db.logEvent({
        level: 'error', service: 'scheduler', operation: 'scheduled.publish', status: 'error',
        postId: item.post_id, message: err.message,
      });
      results.push({ id: item.id, status: 'Failed', error: err.message });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Automation tick                                                    */
/* ------------------------------------------------------------------ */

function zoneOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const [y, mo, d] = p.date.split('-').map(Number);
  const [h, mi] = p.time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  return (asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000;
}

function localDayBounds(tz, date = new Date()) {
  const p = zonedParts(date, tz);
  const [y, mo, d] = p.date.split('-').map(Number);
  const offset = zoneOffsetMinutes(date, tz);
  const start = new Date(Date.UTC(y, mo - 1, d) - offset * 60_000);
  const end = new Date(start.getTime() + 86_400_000);
  return { startIso: start.toISOString(), endIso: end.toISOString(), date: p.date };
}

async function automationRunCount(tz) {
  const { startIso, endIso } = localDayBounds(tz);
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM posts WHERE source = 'automation' AND created_at >= ? AND created_at < ?`,
    [startIso, endIso],
  );
  return Number(row?.c || 0);
}

function findDueSlot(automation, tz, now) {
  const p = zonedParts(now, tz);
  if (!automation.daysOfWeek?.includes(p.weekday)) return null;
  const windowMinutes = Number(automation.slotWindowMinutes || 45);
  const slots = (automation.times || []).map((t) => ({ time: t, minutes: hhmmToMinutes(t) })).filter((s) => s.minutes != null);
  for (const slot of slots) {
    if (p.minutes >= slot.minutes && p.minutes < slot.minutes + windowMinutes) {
      return { slotKey: `${p.date}#${slot.time}`, time: slot.time, date: p.date };
    }
  }
  return null;
}

async function runAutomationTick({ trigger = 'scheduler', force = false } = {}) {
  const startedAt = new Date().toISOString();
  const settings = await db.getSettings();
  const tz = settings.timezone || 'Asia/Dhaka';
  const automation = settings.automation || {};
  const dueScheduled = await processDueScheduled();

  if (!automation.enabled && !force) {
    return { skipped: 'Automation is disabled.', dueScheduled };
  }

  const slot = force ? null : findDueSlot(automation, tz, new Date());
  if (!force && !slot) return { skipped: 'No posting slot is due right now.', dueScheduled };

  const lock = await db.acquireLock('automation-tick', 20 * 60_000);
  if (!lock) return { skipped: 'Another automation run is already in progress.', dueScheduled };

  const runId = crypto.randomUUID();
  const jobType = force ? 'manual_run' : 'automation';
  try {
    if (!force) {
      const existing = await db.get(`SELECT id FROM automation_runs WHERE scheduled_for = ? AND job_type = 'automation'`, [slot.slotKey]);
      if (existing) return { skipped: `Slot ${slot.time} was already processed today.`, dueScheduled };

      const count = await automationRunCount(tz);
      if (count >= Number(automation.postsPerDay || 1)) {
        return { skipped: `Daily limit reached (${count}/${automation.postsPerDay}).`, dueScheduled };
      }
      const delay = Number(automation.minDelayMinutes || 0);
      if (delay > 0) {
        const last = await db.get(`SELECT started_at FROM automation_runs WHERE job_type IN ('automation','manual_run') ORDER BY created_at DESC LIMIT 1`);
        if (last?.started_at && Date.now() - new Date(last.started_at).getTime() < delay * 60_000) {
          return { skipped: `Minimum delay of ${delay} minutes between posts has not elapsed.`, dueScheduled };
        }
      }
    }

    await db.run(
      `INSERT INTO automation_runs (id, job_type, status, trigger, scheduled_for, meta, started_at, created_at)
       VALUES (?, ?, 'Running', ?, ?, ?, ?, ?)`,
      [runId, jobType, trigger, slot?.slotKey || 'manual', JSON.stringify({ settings: {
        categories: automation.categories, imageStyle: automation.imageStyle, language: automation.language,
      } }), startedAt, startedAt],
    );

    const categories = Array.isArray(automation.categories) && automation.categories.length
      ? automation.categories : [settings.defaultCategory || 'High Protein'];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const topic = await generateTopic({
      category, language: automation.language || settings.language,
      niche: settings.niche,
    });

    const platforms = [];
    if (automation.autoBlogger) platforms.push('blogger');
    if (automation.autoPinterest && automation.publishBoth !== false && platforms.includes('blogger')) platforms.push('pinterest');
    const shouldPublish = !automation.manualApproval && !automation.generateContentOnly
      && automation.autoContent !== false && platforms.length > 0;

    const post = await runPipeline({
      options: {
        topic,
        category,
        language: automation.language || settings.language,
        servings: settings.defaultServings || 2,
        imageStyle: automation.imageStyle || settings.defaultImageStyle,
        nutritionGoals: automation.nutritionGoals || settings.defaultNutritionGoals,
        publish: shouldPublish,
        platforms,
        source: 'automation',
        skipImage: automation.autoImage === false,
        skipContent: automation.autoContent === false,
      },
    });

    if (post.status === 'failed') {
      throw new Error(post.error || 'Content pipeline failed.');
    }
    if (post.error) {
      await db.logEvent({
        level: 'warning', service: 'automation', operation: jobType, status: 'warning', postId: post.id,
        message: `Pipeline finished with warnings: ${post.error}`,
      });
    }

    await db.run(
      `UPDATE automation_runs SET status = 'Completed', post_id = ?, finished_at = ? WHERE id = ?`,
      [post.id, new Date().toISOString(), runId],
    );
    await db.logEvent({
      level: 'success', service: 'automation', operation: jobType, status: 'success', postId: post.id,
      message: shouldPublish
        ? `Automation created and published "${truncate(post.title || post.topic, 100)}" to ${platforms.join(' + ')}.`
        : `Automation generated "${truncate(post.title || post.topic, 100)}" as a draft (publishing paused or manual approval enabled).`,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      meta: { trigger, slot: slot?.slotKey || null },
    });
    return { runId, post, dueScheduled, published: shouldPublish, platforms };
  } catch (err) {
    await db.run(
      `UPDATE automation_runs SET status = 'Failed', error = ?, finished_at = ? WHERE id = ?`,
      [truncate(err.message, 2000), new Date().toISOString(), runId],
    );
    await db.logEvent({
      level: 'error', service: 'automation', operation: jobType, status: 'error',
      postId: err.postId || null, message: err.message,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });
    return { runId, error: err.message, postId: err.postId || null, dueScheduled };
  } finally {
    await db.releaseLock('automation-tick', lock);
  }
}

/* ------------------------------------------------------------------ */
/* Misc                                                               */
/* ------------------------------------------------------------------ */

async function nextScheduledRun(settings) {
  const automation = settings?.automation;
  if (!automation?.enabled) return null;
  const tz = settings.timezone || 'Asia/Dhaka';
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const p = zonedParts(probe, tz);
    if (!automation.daysOfWeek?.includes(p.weekday)) continue;
    const slots = (automation.times || []).map(hhmmToMinutes).filter((n) => n != null).sort((a, b) => a - b);
    for (const slot of slots) {
      if (dayOffset === 0 && slot <= p.minutes) continue;
      return { date: p.date, time: `${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}`, timestamp: new Date(probe.getTime() + (slot - p.minutes) * 60_000).toISOString() };
    }
  }
  return null;
}

module.exports = {
  serializePost, safeJson, getPost, getPostRow, updatePost, createPost, setStage, registerTopic,
  generateTopic, buildImagePrompt, generateImageStage, uploadImageStage, analyzeImageStage,
  generateRecipeStage, calculateNutritionStage, generateSeoStage, buildBloggerContentStage,
  buildBloggerHtml, escapeHtml, publishBloggerStage, publishPinterestStage, publishPost,
  runPipeline, processDueScheduled, runAutomationTick, nextScheduledRun, computeStatus,
  ensurePublicImage, localDayBounds, automationRunCount,
};
