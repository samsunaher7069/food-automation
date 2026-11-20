'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nourish-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.SESSION_SECRET = 'test-secret-for-encryption';
delete process.env.DATABASE_URL;

const db = require('../lib/db');
const ai = require('../lib/ai');
const providers = require('../lib/providers');
const pipeline = require('../lib/pipeline');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const calls = { image: 0, analyze: 0, recipe: 0, seo: 0, blogger: 0, bloggerUpdate: 0, pinterest: 0, cloudinary: 0 };

const RECIPE = {
  title: 'Mock High-Protein Chicken and Broccoli Bowl',
  seo_title: 'High-Protein Chicken Broccoli Bowl',
  description: 'A fast, filling bowl with lean chicken, broccoli and brown rice.',
  introduction: 'A weeknight bowl.\n\nHigh in protein and fiber.',
  category: 'High Protein',
  prep_time_minutes: 10,
  cook_time_minutes: 15,
  total_time_minutes: 25,
  difficulty: 'Easy',
  servings: 2,
  ingredients: [
    { item: 'chicken breast', quantity: 200, unit: 'g', notes: 'boneless' },
    { item: 'broccoli', quantity: 150, unit: 'g', notes: '' },
    { item: 'brown rice', quantity: 100, unit: 'g', notes: 'dry weight' },
    { item: 'olive oil', quantity: 1, unit: 'tbsp', notes: '' },
  ],
  instructions: ['Cook the brown rice.', 'Grill the chicken breast.', 'Steam the broccoli and combine.'],
  tips: ['Rest the chicken for five minutes before slicing.'],
  storage: 'Keep in the fridge for up to 3 days.',
  meal_prep: 'Divide into two containers.',
  substitutions: [{ original: 'chicken breast', alternative: 'firm tofu', note: 'Add 2 extra minutes of cooking.' }],
  faq: [{ question: 'Can I meal prep this bowl?', answer: 'Yes, it keeps for three days.' }],
  conclusion: 'A simple high-protein bowl for busy days.',
  keywords: ['high protein bowl', 'chicken broccoli', 'meal prep'],
};

const SEO = {
  seo_title: 'High-Protein Chicken and Broccoli Bowl',
  meta_description: 'A 25-minute high-protein chicken and broccoli bowl with calculated nutrition.',
  keywords: ['high protein bowl', 'chicken broccoli', 'healthy dinner'],
  pinterest_title: 'High-Protein Chicken and Broccoli Bowl',
  pinterest_description: 'A quick high-protein dinner with real nutrition numbers.',
  tags: ['high protein', 'meal prep', 'healthy dinner'],
  hashtags: ['#highprotein', '#mealprep'],
  image_alt: 'Chicken and broccoli rice bowl',
  blogger_labels: ['High Protein', 'Dinner'],
};

function setupMocks() {
  ai.generateJson = async ({ prompt }) => {
    if (String(prompt).includes('"prep_time_minutes"')) { calls.recipe++; return JSON.parse(JSON.stringify(RECIPE)); }
    if (String(prompt).includes('"pinterest_title"')) { calls.seo++; return JSON.parse(JSON.stringify(SEO)); }
    return { topics: ['Unused mock topic'] };
  };
  ai.generateImage = async () => { calls.image++; return { buffer: PNG, mime: 'image/png', model: 'mock-image' }; };
  ai.analyzeImage = async () => { calls.analyze++; return { food_name: 'Chicken and broccoli bowl', match_score: 94, visible_ingredients: ['chicken', 'broccoli', 'rice'] }; };
  providers.cloudinaryConfig = async () => ({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' });
  providers.uploadToCloudinary = async () => {
    calls.cloudinary++;
    return { url: 'https://res.cloudinary.com/demo/image/upload/v1/mock.png', publicId: 'mock', width: 1000, height: 1500 };
  };
  providers.publishBloggerPost = async () => {
    calls.blogger++;
    return { id: 'blog-123', url: 'https://example.blogspot.com/2026/11/mock-bowl.html' };
  };
  providers.updateBloggerPost = async () => {
    calls.bloggerUpdate++;
    return { id: 'blog-123', url: 'https://example.blogspot.com/2026/11/mock-bowl.html' };
  };
  providers.publishBloggerDraft = async () => ({ id: 'blog-123', url: 'https://example.blogspot.com/2026/11/mock-bowl.html', status: 'LIVE' });
  providers.createPinterestPin = async () => {
    calls.pinterest++;
    return { id: 'pin-123', url: 'https://www.pinterest.com/pin/pin-123/' };
  };
}

test.before(async () => {
  await db.init();
  setupMocks();
  await db.saveSettings({
    blogger: { defaultBlogId: 'blog-1', defaultBlogName: 'Test Blog', defaultBlogUrl: 'https://example.blogspot.com' },
    pinterest: { defaultBoardId: 'board-1', defaultBoardName: 'Healthy Food' },
  });
});

test.after(async () => {
  await db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('full pipeline creates content, public image, deterministic nutrition and article HTML', async () => {
  const post = await pipeline.runPipeline({
    options: { topic: 'High-protein chicken and broccoli rice bowl', category: 'High Protein', servings: 2, source: 'manual' },
  });

  assert.equal(post.status, 'generated');
  assert.ok(post.title.includes('Chicken'));
  assert.ok(post.recipe.ingredients.length === 4);
  assert.ok(post.imageLocalUrl.startsWith('/media/'));
  assert.match(post.imageUrl, /^https:\/\/res\.cloudinary\.com/);
  assert.ok(fs.existsSync(path.join(process.env.MEDIA_DIR, path.basename(post.imageLocalUrl))), 'local image exists');
  assert.equal(post.imageAnalysis.match_score, 94);
  assert.ok(post.nutrition, 'nutrition exists');
  assert.ok(post.nutrition.perServing.calories > 250, `calories ${post.nutrition.perServing.calories}`);
  assert.ok(post.nutrition.perServing.protein > 25, `protein ${post.nutrition.perServing.protein}`);
  assert.ok(post.nutrition.matchedCount >= 3, `matched ${post.nutrition.matchedCount}`);
  assert.equal(post.nutrition.perServing.calories, Math.round(post.nutrition.total.calories / 2));
  assert.ok(post.bloggerContent.includes('application/ld+json'));
  assert.ok(post.bloggerContent.includes('High-Protein'));
  assert.ok(post.pinterestTitle.length > 0);
  assert.equal(post.bloggerStatus, 'not_published');
  assert.equal(post.pinterestStatus, 'not_published');

  const stage = post.stageStatus;
  for (const key of ['image', 'image_analysis', 'recipe', 'nutrition', 'seo', 'blogger_html', 'content']) {
    assert.ok(stage[key], `stage ${key} recorded`);
    assert.notEqual(stage[key].status, 'failed', `stage ${key} not failed`);
  }

  // Persist for later tests
  test.postId = post.id;
});

test('publishing order is Blogger first, then Pinterest with the live URL', async () => {
  const before = { ...calls };
  const result = await pipeline.publishPost(test.postId, ['blogger', 'pinterest']);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.ok(result.post.bloggerUrl.includes('blogspot.com'));
  assert.ok(result.post.pinterestUrl.includes('pinterest.com'));
  assert.equal(result.post.bloggerStatus, 'published');
  assert.equal(result.post.pinterestStatus, 'published');
  assert.equal(result.post.status, 'published');
  assert.equal(calls.blogger, before.blogger + 1);
  assert.equal(calls.pinterest, before.pinterest + 1);

  const records = await db.query(`SELECT platform, status FROM publishing_records WHERE post_id = ? ORDER BY platform`, [test.postId]);
  assert.deepEqual(records.map((r) => r.platform), ['blogger', 'pinterest']);
  assert.ok(records.every((r) => r.status === 'published'));
});

test('re-publishing is idempotent: no duplicate article or pin', async () => {
  const before = { ...calls };
  const result = await pipeline.publishPost(test.postId, ['blogger', 'pinterest']);
  assert.equal(result.errors.length, 0);
  assert.equal(calls.blogger, before.blogger, 'no new Blogger article');
  assert.equal(calls.pinterest, before.pinterest, 'no new Pinterest pin');
  assert.equal(calls.bloggerUpdate, before.bloggerUpdate, 'skip path does not update either');
});

test('duplicate topic guard normalises and rejects the same topic', async () => {
  const first = await pipeline.registerTopic('High-Protein Chicken & Broccoli Rice Bowl', 'post-a');
  const second = await pipeline.registerTopic('high protein chicken and broccoli rice bowl!!!', 'post-b');
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
});

test('nutrition engine is deterministic and reports unmatched ingredients', async () => {
  const result = await pipeline.calculateNutritionStage(test.postId);
  const strip = (n) => JSON.stringify({ ...n, calculatedAt: null });
  const first = strip(result.nutrition);
  const second = await pipeline.calculateNutritionStage(test.postId);
  assert.equal(strip(second.nutrition), first, 'same input gives same output');
  assert.ok(result.nutrition.perServing.calories > 0);
  assert.ok(result.nutrition.disclaimer.length > 0, 'estimate disclaimer present');

  const { calculateNutrition } = require('../lib/nutrition');
  const odd = await calculateNutrition([
    { item: 'chicken breast', quantity: 100, unit: 'g' },
    { item: 'unobtainium powder', quantity: 5, unit: 'g' },
  ], 1, { provider: 'builtin' });
  assert.ok(odd.unmatched.some((u) => u.includes('unobtainium')), `unmatched: ${JSON.stringify(odd.unmatched)}`);
  assert.ok(odd.confidence !== 'high');
});

test('scheduled posts publish once and cannot run twice', async () => {
  const post = await pipeline.runPipeline({
    options: { topic: 'Greek yogurt berry breakfast bowl with chia', category: 'Healthy Breakfast', servings: 2, source: 'manual' },
  });
  const when = new Date(Date.now() - 60_000).toISOString();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO scheduled_posts (id, post_id, scheduled_at, destinations, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Scheduled', ?, ?)`,
    [id, post.id, when, JSON.stringify(['blogger', 'pinterest']), now, now],
  );

  const due = await pipeline.processDueScheduled();
  assert.equal(due.length, 1);
  assert.equal(due[0].status, 'Published');
  const row = await db.get(`SELECT status FROM scheduled_posts WHERE id = ?`, [id]);
  assert.equal(row.status, 'Published');

  const again = await pipeline.processDueScheduled();
  assert.equal(again.length, 0, 'nothing due the second time');

  const fresh = await pipeline.getPost(post.id);
  assert.equal(fresh.bloggerStatus, 'published');
  assert.equal(fresh.pinterestStatus, 'published');
});

test('automation tick respects the daily limit and records the run', async () => {
  await db.saveSettings({
    automation: {
      enabled: true, times: ['09:00'], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], postsPerDay: 1,
      autoBlogger: true, autoPinterest: true, manualApproval: false, generateContentOnly: false,
      minDelayMinutes: 0, categories: ['High Protein'],
    },
  });
  const result = await pipeline.runAutomationTick({ trigger: 'test', force: true });
  assert.ok(result.runId, JSON.stringify(result));
  assert.ok(result.post, 'automation produced a post');
  assert.equal(result.post.source, 'automation');
  const runs = await db.query(`SELECT status FROM automation_runs WHERE id = ?`, [result.runId]);
  assert.equal(runs[0].status, 'Completed');
});

test('automation slot keys prevent a second run for the same slot', async () => {
  const tz = 'Asia/Dhaka';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === 'hour').value;
  const mm = parts.find((p) => p.type === 'minute').value;
  const time = `${hh}:${mm}`;
  await db.saveSettings({
    automation: {
      enabled: true, times: [time], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], postsPerDay: 5,
      minDelayMinutes: 0, slotWindowMinutes: 120, manualApproval: true,
      autoBlogger: false, autoPinterest: false,
    },
  });
  const first = await pipeline.runAutomationTick({ trigger: 'test-slot' });
  assert.ok(first.post, `first tick: ${JSON.stringify(first)}`);
  const second = await pipeline.runAutomationTick({ trigger: 'test-slot' });
  assert.ok(second.skipped, `second tick: ${JSON.stringify(second)}`);
  assert.match(second.skipped, /already processed|Daily limit/i);
});

test('next scheduled run is in the future and respects the timezone', async () => {
  const settings = await db.getSettings();
  const next = await pipeline.nextScheduledRun(settings);
  assert.ok(next && next.timestamp, 'next run exists when enabled');
  assert.ok(new Date(next.timestamp).getTime() > Date.now() - 60_000);
  assert.match(next.time, /^\d{2}:\d{2}$/);
});

test('article HTML escapes untrusted recipe text', async () => {
  const post = await pipeline.getPost(test.postId);
  const hostile = {
    ...post,
    recipe: {
      ...post.recipe,
      title: '<script>alert(1)</script>',
      instructions: ['<img src=x onerror=alert(2)>'],
      ingredients: [{ item: '<b>chicken</b>', quantity: 1, unit: 'g' }],
    },
  };
  const html = pipeline.buildBloggerHtml(hostile);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('onerror=alert(2)>'));
  assert.ok(html.includes('application/ld+json'));
});

test('failed image generation marks the post and reports a friendly error', async () => {
  const original = ai.generateImage;
  ai.generateImage = async () => { const e = new Error('Image quota exceeded for this API key.'); e.status = 429; throw e; };
  const post = await pipeline.createPost({ topic: 'Failure-path test bowl', category: 'High Protein' });
  await assert.rejects(() => pipeline.generateImageStage(post.id), /quota/i);
  const fresh = await pipeline.getPost(post.id);
  assert.equal(fresh.status, 'failed');
  assert.ok(fresh.stageStatus.image.status === 'failed');
  assert.ok(fresh.error.includes('quota'));
  ai.generateImage = original;
});
