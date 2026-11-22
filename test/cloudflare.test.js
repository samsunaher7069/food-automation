'use strict';

/*
 * Cloudflare Workers AI provider tests. A fake database module and a local
 * HTTP server stand in for Cloudflare, so no real credentials or Neurons are
 * used. The request/response shapes mirror the documented REST API.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

const requests = [];

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { parseError: true }; }
    requests.push({ url: req.url, auth: req.headers.authorization, body });

    if (req.headers.authorization !== 'Bearer test-token-1234567890abcdef') {
      return json(res, 401, {
        success: false,
        result: null,
        errors: [{ code: 10000, message: 'Authentication error' }],
      });
    }

    if (req.url.endsWith('/@cf/test/text')) {
      const last = body.messages?.at(-1)?.content || '';
      const response = /JSON/i.test(String(last)) ? '{"matches_topic":true}' : 'CONNECTED';
      return json(res, 200, { success: true, result: { response }, errors: [] });
    }
    if (req.url.endsWith('/@cf/test/vision')) {
      return json(res, 200, {
        success: true,
        result: { response: '```json\n{"matches_topic":true,"foods":["yogurt"]}\n```' },
        errors: [],
      });
    }
    if (req.url.endsWith('/@cf/test/image')) {
      return json(res, 200, { success: true, result: { image: PNG_1PX }, errors: [] });
    }
    if (req.url.endsWith('/@cf/test/binary-image')) {
      const bytes = Buffer.from(PNG_1PX, 'base64');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(bytes);
    }
    if (req.url.includes('/@cf/retired/image')) {
      return json(res, 400, {
        success: false,
        result: null,
        errors: [{ code: 5007, message: 'No such model' }],
      });
    }
    return json(res, 401, {
      success: false,
      result: null,
      errors: [{ code: 10000, message: 'Authentication error' }],
    });
  });
});

async function loadAi({ connection, settings }) {
  const dbPath = path.join(__dirname, '..', 'lib', 'db.js');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getConnection: async (provider) => (provider === 'cloudflare' ? connection : {}),
      getSettings: async () => settings,
      query: async () => [],
    },
  };
  const aiPath = path.join(__dirname, '..', 'lib', 'ai.js');
  delete require.cache[aiPath];
  return require(aiPath);
}

const connection = {
  accountId: 'test-account',
  apiToken: 'test-token-1234567890abcdef',
  textModel: '@cf/test/text',
  visionModel: '@cf/test/vision',
  imageModel: '@cf/test/image',
};

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.CLOUDFLARE_API_BASE = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('Cloudflare text generation uses the configured model and token', async () => {
  const ai = await loadAi({ connection, settings: { ai: { text: 'cloudflare', image: 'auto' } } });
  const text = await ai.generateText({ prompt: 'Say connected', provider: 'cloudflare' });
  assert.equal(text, 'CONNECTED');

  const call = requests.at(-1);
  assert.match(call.url, /\/accounts\/test-account\/ai\/run\/@cf\/test\/text$/);
  assert.equal(call.auth, 'Bearer test-token-1234567890abcdef');
  assert.equal(call.body.messages.at(-1).content, 'Say connected');
});

test('Cloudflare JSON generation tolerates markdown fences', async () => {
  const ai = await loadAi({ connection, settings: { ai: { text: 'cloudflare', image: 'auto' } } });
  const result = await ai.generateJson({ prompt: 'Analyse the photo', provider: 'cloudflare' });
  assert.equal(result.matches_topic, true);
});

test('Cloudflare vision accepts a data URI image', async () => {
  const ai = await loadAi({ connection, settings: { ai: { text: 'auto', image: 'auto' } } });
  const result = await ai.analyzeImage({
    imageBuffer: Buffer.from(PNG_1PX, 'base64'),
    mime: 'image/png',
    prompt: 'Does it match?',
    provider: 'cloudflare',
  });
  assert.equal(result.matches_topic, true);

  const call = requests.at(-1);
  const imagePart = call.body.messages[0].content.find((p) => p.type === 'image_url');
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);
});

test('Cloudflare image generation decodes base64 JSON results', async () => {
  const ai = await loadAi({ connection, settings: { ai: { text: 'gemini', image: 'cloudflare' } } });
  const image = await ai.generateImage({ prompt: 'A bowl of yogurt', aspectRatio: '2:3' });
  assert.equal(image.provider, 'cloudflare');
  assert.equal(image.mime, 'image/png');
  assert.ok(image.buffer.length > 0);
});

test('Cloudflare image generation accepts a binary image response', async () => {
  const ai = await loadAi({
    connection: { ...connection, imageModel: '@cf/test/binary-image' },
    settings: { ai: { text: 'gemini', image: 'cloudflare' } },
  });
  const image = await ai.generateImage({ prompt: 'A bowl of yogurt' });
  assert.equal(image.mime, 'image/png');
  assert.ok(image.buffer.length > 0);
});

test('Cloudflare connection test reports a readable error for bad credentials', async () => {
  const ai = await loadAi({
    connection: { ...connection, apiToken: 'bad-token-value-that-is-long-enough' },
    settings: { ai: { text: 'cloudflare', image: 'auto' } },
  });
  await assert.rejects(
    () => ai.testCloudflare({ apiToken: 'bad-token-value-that-is-long-enough' }),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Cloudflare rejected the credentials/i);
      return true;
    },
  );
});
