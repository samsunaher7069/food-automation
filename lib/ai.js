'use strict';

const { fetchJson, HttpError, truncate } = require('./util');
const { getConnection, getSettings, query } = require('./db');

const API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const API_REVISION = process.env.GEMINI_API_REVISION || '2026-05-20';
const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

const CF_API_BASE = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
const DEFAULT_CF_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_CF_VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const DEFAULT_CF_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

async function geminiConfig() {
  const conn = (await getConnection('gemini')) || {};
  return {
    apiKey: conn.apiKey || process.env.GEMINI_API_KEY || '',
    textModel: conn.textModel || process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    imageModel: conn.imageModel || process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    imageSize: conn.imageSize || '1K',
  };
}

async function cloudflareConfig() {
  const conn = (await getConnection('cloudflare')) || {};
  const accountId = conn.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = conn.apiToken || process.env.CLOUDFLARE_API_TOKEN || '';
  return {
    accountId,
    apiToken,
    textModel: conn.textModel || process.env.CLOUDFLARE_TEXT_MODEL || DEFAULT_CF_TEXT_MODEL,
    visionModel: conn.visionModel || process.env.CLOUDFLARE_VISION_MODEL || DEFAULT_CF_VISION_MODEL,
    imageModel: conn.imageModel || process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CF_IMAGE_MODEL,
    configured: Boolean(accountId && apiToken),
  };
}

async function providerPreference() {
  const settings = await getSettings();
  const ai = settings.ai || {};
  return {
    // Writing, recipes and SEO stay on Gemini by default; Cloudflare is the
    // free image generator. Both remain selectable in API Connections.
    text: ['auto', 'gemini', 'cloudflare'].includes(ai.text) ? ai.text : 'gemini',
    image: ['auto', 'gemini', 'cloudflare'].includes(ai.image) ? ai.image : 'auto',
  };
}

function friendlyGeminiError(err) {
  const msg = String(err?.message || err);
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(msg)) {
    return new HttpError(401, 'Gemini rejected the API key. Update the key in API Connections.', err?.details);
  }
  if (/free tier is not available|set up billing|PERMISSION_DENIED|ACCESS_DENIED/i.test(msg)) {
    return new HttpError(403,
      'Gemini generation is blocked for this project: Google requires billing on the API key\'s project. '
      + 'Enable billing at aistudio.google.com/billing, or switch the AI provider to Cloudflare Workers AI.', err?.details);
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return new HttpError(429, 'Gemini quota exhausted for this key/model. Check your plan or try another model.', err?.details);
  }
  if (/not found|NOT_FOUND|does not support|unsupported/i.test(msg)) {
    return new HttpError(400, `Gemini model is unavailable: ${truncate(msg, 240)}`, err?.details);
  }
  return err;
}

function friendlyCloudflareError(err) {
  const details = err?.details;
  const cfMessages = Array.isArray(details?.errors)
    ? details.errors.map((e) => `${e.message}${e.code ? ` (code ${e.code})` : ''}`).join('; ')
    : '';
  const msg = `${err?.message || err}${cfMessages ? ` — ${cfMessages}` : ''}`;
  if (/authentication error|invalid api token|10000|authorization|permission|not authorized/i.test(msg)) {
    return new HttpError(401,
      'Cloudflare rejected the credentials. Check the Account ID and create a token with '
      + '"Account → Workers AI → Read" permission.', details);
  }
  if (/neurons|quota|rate limit|429|daily.*limit/i.test(msg)) {
    return new HttpError(429,
      'Cloudflare Workers AI daily free allocation (10,000 Neurons) is used up or rate-limited. '
      + 'It resets at 00:00 UTC.', details);
  }
  if (/not found|no such model|5007|5019|model.*(unavailable|deprecated)/i.test(msg)) {
    return new HttpError(400, `Cloudflare model is unavailable: ${truncate(msg, 240)}`, details);
  }
  return err instanceof HttpError ? err : new HttpError(502, truncate(msg, 300), details);
}

/* ------------------------------------------------------------------ */
/* Cloudflare Workers AI transport                                     */
/* ------------------------------------------------------------------ */

async function cloudflareRequest(model, body, cfg, timeoutMs = 120_000) {
  if (!cfg?.accountId || !cfg?.apiToken) {
    throw new HttpError(400, 'Cloudflare Workers AI is not configured. Add the Account ID and API token in API Connections.');
  }
  if (!model) throw new HttpError(400, 'No Cloudflare model configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${encodeURIComponent(cfg.accountId)}/ai/run/${model.replace(/^\/+/, '')}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      },
    );
    const contentType = res.headers.get('content-type') || '';
    if (/json/i.test(contentType)) {
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        const message = (data?.errors || []).map((e) => e.message).filter(Boolean).join('; ')
          || data?.error?.message || `Cloudflare request failed (HTTP ${res.status})`;
        const e = new HttpError(res.status || 502, message, data);
        throw friendlyCloudflareError(e);
      }
      return { json: data, buffer: null, contentType };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new HttpError(res.status, `Cloudflare returned ${contentType || 'an error'} (HTTP ${res.status})`);
    return { json: null, buffer, contentType };
  } catch (err) {
    if (err.name === 'AbortError') throw new HttpError(504, `Cloudflare request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err instanceof HttpError ? err : friendlyCloudflareError(err);
  } finally { clearTimeout(timer); }
}

function extractCloudflareText(data) {
  const r = data?.result ?? data;
  if (typeof r === 'string') return r.trim();
  if (typeof r?.response === 'string') return r.response.trim();
  if (typeof r?.output_text === 'string') return r.output_text.trim();
  const choice = r?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
  return '';
}

function sniffImageMime(buffer, fallback = 'image/png') {
  if (!buffer || buffer.length < 4) return fallback;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return fallback;
}

function cloudflareImageBody(prompt, aspectRatio = '9:16', model = '') {
  // FLUX.1 [schnell] is fixed at 1024x1024 and only accepts prompt/steps/seed.
  const body = { prompt, steps: 4 };
  if (/stable-diffusion|dreamshaper/i.test(String(model))) {
    const [w, h] = String(aspectRatio).split(':').map(Number);
    const ratio = (w && h) ? w / h : 2 / 3;
    const height = 1216;
    body.height = height;
    body.width = Math.max(256, Math.min(2048, Math.round((height * ratio) / 64) * 64));
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Response parsing (Interactions API + legacy generateContent)        */
/* ------------------------------------------------------------------ */

function extractText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const chunks = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    const type = node.type;
    if ((type === 'text' || type === 'output_text') && typeof node.text === 'string') { chunks.push(node.text); return; }
    if (type === 'thought' || type === 'thinking') return;
    if (Array.isArray(node.content)) walk(node.content);
    if (Array.isArray(node.parts)) walk(node.parts);
    if (Array.isArray(node.steps)) walk(node.steps);
  };
  walk(data.steps);
  walk(data.outputs);
  walk(data.output);
  if (chunks.length) return chunks.join('\n').trim();
  const cand = data.candidates?.[0];
  if (cand) {
    const parts = cand.content?.parts || [];
    return parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  }
  return '';
}

function extractImage(data) {
  if (!data) return null;
  const direct = data.output_image || data.outputImage;
  if (direct?.data) return { data: direct.data, mime: direct.mime_type || direct.mimeType || 'image/png' };
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if ((node.type === 'image' || node.type === 'image_output') && node.data) {
      found.push({ data: node.data, mime: node.mime_type || node.mimeType || 'image/png' });
      return;
    }
    if (node.inlineData?.data) found.push({ data: node.inlineData.data, mime: node.inlineData.mimeType || 'image/png' });
    if (node.inline_data?.data) found.push({ data: node.inline_data.data, mime: node.inline_data.mime_type || 'image/png' });
    if (Array.isArray(node.content)) walk(node.content);
    if (Array.isArray(node.parts)) walk(node.parts);
    if (Array.isArray(node.steps)) walk(node.steps);
    if (Array.isArray(node.candidates)) walk(node.candidates);
  };
  walk(data.steps);
  walk(data.outputs);
  walk(data.output);
  walk(data.candidates);
  return found[0] || null;
}

/* ------------------------------------------------------------------ */
/* JSON parsing                                                        */
/* ------------------------------------------------------------------ */

function extractJson(text) {
  if (!text) throw new HttpError(502, 'Gemini returned an empty response.');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) throw new HttpError(502, `Gemini did not return JSON. Response began: "${truncate(s, 160)}"`);
  const openChar = s[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0; let inString = false; let escape = false; let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new HttpError(502, 'Gemini returned malformed JSON (unbalanced brackets).');
  try { return JSON.parse(s.slice(start, end + 1)); } catch (err) {
    throw new HttpError(502, `Could not parse Gemini JSON: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Core calls                                                          */
/* ------------------------------------------------------------------ */

async function callInteractions(payload, apiKey, timeoutMs = 120_000) {
  return fetchJson(`${API_BASE}/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });
}

async function callGenerateContent(model, payload, apiKey, timeoutMs = 120_000) {
  return fetchJson(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
    timeoutMs,
  });
}

function legacyTextRequest(prompt, system, opts) {
  const generationConfig = {
    maxOutputTokens: opts.maxOutputTokens || 8192,
  };
  // Sampling params are ignored/deprecated on Gemini 3.6+, so only send if explicitly set.
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig,
  };
}

// Models that are known to answer the Interactions API. Used only when the
// configured model is retired, overloaded (503) or out of quota (429), so a
// temporary Google capacity spike does not fail an otherwise healthy run.
const TEXT_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
const CF_TEXT_FALLBACK_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/google/gemma-4-26b-a4b-it'];

async function requestTextOnce(model, finalPrompt, system, { key, maxOutputTokens, temperature, timeoutMs }) {
  const body = {
    model,
    input: finalPrompt,
    ...(system ? { system_instruction: system } : {}),
    generation_config: { max_output_tokens: maxOutputTokens },
  };

  let data;
  let primaryError = null;
  try {
    data = await callInteractions(body, key, timeoutMs);
  } catch (err) {
    primaryError = err;
    // Older API keys/models may only expose generateContent. Retry there before failing.
    try {
      data = await callGenerateContent(model, legacyTextRequest(finalPrompt, system, { maxOutputTokens, temperature }), key, timeoutMs);
    } catch (err2) {
      throw friendlyGeminiError(err2.status === 404 || err2.status === 400 ? err2 : err);
    }
  }

  let text = extractText(data);
  if (!text) {
    // The Interactions endpoint can return an "incomplete" interaction with
    // no output text yet. Retry the classic endpoint before giving up.
    try {
      const legacy = await callGenerateContent(model, legacyTextRequest(finalPrompt, system, { maxOutputTokens, temperature }), key, timeoutMs);
      text = extractText(legacy);
    } catch { /* keep the original error as the reason below */ }
  }
  if (!text) {
    const reason = data?.status || data?.error?.message || primaryError?.message || 'no text returned';
    throw new HttpError(502, `Gemini returned no text (${truncate(String(reason), 200)}). Check the configured text model.`);
  }
  return text;
}

async function cloudflareTextOnce(model, finalPrompt, system, { cfg, maxOutputTokens, temperature, timeoutMs }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: finalPrompt });
  const body = { messages, max_tokens: Math.max(256, Math.min(8192, maxOutputTokens || 2048)) };
  if (temperature !== undefined) body.temperature = temperature;
  const { json } = await cloudflareRequest(model, body, cfg, timeoutMs);
  const text = extractCloudflareText(json);
  if (!text) throw new HttpError(502, `Cloudflare model "${model}" returned no text. Check the model name.`);
  return text;
}

async function generateText({
  prompt, system = '', model, apiKey, maxOutputTokens = 8192, temperature,
  json = false, timeoutMs = 120_000, fallback = true, provider,
} = {}) {
  if (!prompt) throw new HttpError(400, 'Prompt is required.');

  const cfg = await geminiConfig();
  const cf = await cloudflareConfig();
  const pref = provider || (await providerPreference()).text;
  const key = apiKey || cfg.apiKey;

  const finalPrompt = json
    ? `${prompt}\n\nRespond with a single valid JSON document only. No markdown fences, no commentary.`
    : prompt;

  const geminiModel = model && !String(model).startsWith('@cf/') ? model : cfg.textModel;
  const cfModel = model && String(model).startsWith('@cf/') ? model : cf.textModel;

  const geminiCandidates = fallback
    ? [geminiModel, ...TEXT_FALLBACK_MODELS.filter((m) => m !== geminiModel)]
    : [geminiModel];
  const cfCandidates = fallback
    ? [cfModel, ...CF_TEXT_FALLBACK_MODELS.filter((m) => m !== cfModel)]
    : [cfModel];

  const tryGemini = async () => {
    if (!key) throw new HttpError(400, 'Gemini API key is not configured. Add it in API Connections.');
    let lastError;
    for (const candidate of geminiCandidates) {
      try {
        return await requestTextOnce(candidate, finalPrompt, system, { key, maxOutputTokens, temperature, timeoutMs });
      } catch (err) {
        lastError = err;
        // A rejected key, billing block or exhausted quota applies to every model.
        if ([401, 403, 429].includes(err.status)) break;
      }
    }
    throw friendlyGeminiError(lastError);
  };

  const tryCloudflare = async () => {
    if (!cf.configured) {
      throw new HttpError(400, 'Cloudflare Workers AI is not configured. Add the Account ID and API token in API Connections.');
    }
    let lastError;
    for (const candidate of cfCandidates) {
      try {
        return await cloudflareTextOnce(candidate, finalPrompt, system, {
          cfg: cf, maxOutputTokens, temperature, timeoutMs,
        });
      } catch (err) {
        lastError = err;
        if ([401, 429].includes(err.status)) break;
      }
    }
    throw friendlyCloudflareError(lastError);
  };

  if (pref === 'gemini') {
    if (!key) throw new HttpError(400, 'Gemini API key is not configured. Add it in API Connections.');
    return tryGemini();
  }
  if (pref === 'cloudflare') return tryCloudflare();

  // auto: Gemini first when a key exists, then Cloudflare. A billing/permission
  // block from Google falls through instead of failing the whole run.
  let geminiError = null;
  if (key) {
    try { return await tryGemini(); } catch (err) { geminiError = err; }
  }
  if (cf.configured) return tryCloudflare();
  if (geminiError) throw geminiError;
  throw new HttpError(400,
    'No AI provider is configured. Add a Gemini API key or Cloudflare Workers AI credentials in API Connections.');
}

async function generateJson(args = {}) {
  const text = await generateText({ ...args, json: true });
  try {
    return extractJson(text);
  } catch (err) {
    // One repair attempt, cheaper than failing the whole pipeline.
    const repair = await generateText({
      prompt: `Convert the following content into valid JSON only. Keep all data. Do not add commentary.\n\n${truncate(text, 20_000)}`,
      system: 'You repair malformed JSON. Output only JSON.',
      model: args.model,
      json: true,
      provider: args.provider,
      maxOutputTokens: args.maxOutputTokens || 8192,
    });
    return extractJson(repair);
  }
}

async function analyzeImage({ imageBuffer, mime = 'image/png', prompt, provider }) {
  if (!imageBuffer) throw new HttpError(400, 'Image data is required for analysis.');
  const cfg = await geminiConfig();
  const cf = await cloudflareConfig();
  const pref = provider || (await providerPreference()).text;
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const ask = `${prompt}\n\nReturn JSON only.`;

  const tryGemini = async () => {
    if (!cfg.apiKey) throw new HttpError(400, 'Gemini API key is not configured.');
    const legacy = {
      contents: [{
        role: 'user',
        parts: [
          { text: ask },
          { inlineData: { mimeType: mime, data: base64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 4096 },
    };
    const interaction = {
      model: cfg.textModel,
      input: [
        { type: 'text', text: ask },
        { type: 'image', mime_type: mime, data: base64 },
      ],
      generation_config: { max_output_tokens: 4096 },
    };
    let data;
    try {
      data = await callInteractions(interaction, cfg.apiKey, 150_000);
    } catch (err) {
      try {
        data = await callGenerateContent(cfg.textModel, legacy, cfg.apiKey, 150_000);
      } catch { throw friendlyGeminiError(err); }
    }
    const text = extractText(data);
    if (!text) throw new HttpError(502, 'Gemini vision returned no analysis.');
    return text;
  };

  const tryCloudflare = async () => {
    if (!cf.configured) {
      throw new HttpError(400, 'Cloudflare Workers AI is not configured. Add the Account ID and API token in API Connections.');
    }
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
      max_tokens: 2048,
    };
    const { json } = await cloudflareRequest(cf.visionModel, body, cf, 150_000);
    const text = extractCloudflareText(json);
    if (!text) throw new HttpError(502, `Cloudflare vision model "${cf.visionModel}" returned no analysis.`);
    return text;
  };

  let text;
  if (pref === 'cloudflare') {
    text = await tryCloudflare();
  } else {
    // Vision stays on Gemini only — Cloudflare is images-only per user choice.
    text = await tryGemini();
  }

  try { return extractJson(text); } catch { return { raw_analysis: text }; }
}

/**
 * Generate an image with the configured Gemini image model.
 * Tries the current Interactions API first, then the classic generateContent shape.
 */
const IMAGE_FALLBACK_MODELS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

async function requestImageOnce(model, { prompt, aspectRatio, imageSize, apiKey }) {
  const interaction = {
    model,
    input: [{ type: 'text', text: prompt }],
    response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspectRatio, image_size: imageSize },
  };

  let data = null; let primaryError = null;
  try {
    data = await callInteractions(interaction, apiKey, 180_000);
  } catch (err) { primaryError = err; }

  let image = extractImage(data);
  if (!image) {
    const legacy = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio },
      },
    };
    let legacyData = null;
    try {
      legacyData = await callGenerateContent(model, legacy, apiKey, 180_000);
      image = extractImage(legacyData);
    } catch (err) {
      const base = primaryError || err;
      const e = friendlyGeminiError(err);
      if (/not found|unsupported|does not support|no longer available/i.test(String(base?.message)) || primaryError?.status === 404) {
        e.status = 404;
        e.message = `Image generation is not available for model "${model}". ${truncate(String(base?.message), 200)}`;
      }
      throw e;
    }
  }

  if (!image?.data) {
    const hint = primaryError?.message ? ` Provider said: ${truncate(primaryError.message, 240)}` : '';
    throw new HttpError(502,
      `Gemini did not return an image. The configured model "${model}" may not support image generation, `
      + `or the prompt was blocked by safety filters.${hint}`, primaryError?.details);
  }
  return { buffer: Buffer.from(image.data, 'base64'), mime: image.mime || 'image/png', model };
}

async function cloudflareImageOnce(model, { prompt, aspectRatio, cfg }) {
  const body = cloudflareImageBody(prompt, aspectRatio, model);
  const { json, buffer, contentType } = await cloudflareRequest(model, body, cfg, 180_000);
  let bytes = buffer;
  let mime = contentType && /^image\//i.test(contentType) ? contentType.split(';')[0] : '';
  if ((!bytes || !bytes.length) && json) {
    const r = json.result ?? json;
    const b64 = typeof r === 'string' ? r : r?.image || r?.images?.[0] || r?.output?.image;
    if (b64) bytes = Buffer.from(String(b64).replace(/^data:image\/[a-z+]+;base64,/i, ''), 'base64');
  }
  if (!bytes || !bytes.length) {
    throw new HttpError(502,
      `Cloudflare model "${model}" returned no image. Check that the model supports text-to-image generation.`);
  }
  return { buffer: bytes, mime: sniffImageMime(bytes, mime || 'image/png'), model, provider: 'cloudflare' };
}

async function generateImage({ prompt, aspectRatio = '9:16', model, imageSize, provider } = {}) {
  if (!prompt) throw new HttpError(400, 'Prompt is required.');
  const cfg = await geminiConfig();
  const cf = await cloudflareConfig();
  const pref = provider || (await providerPreference()).image;
  const cfRequested = String(model || '').startsWith('@cf/');

  const tryGemini = async () => {
    if (!cfg.apiKey) throw new HttpError(400, 'Gemini API key is not configured. Add it in API Connections.');
    const chosenModel = model && !cfRequested ? model : cfg.imageModel;
    if (!chosenModel) throw new HttpError(400, 'No Gemini image model configured.');
    const candidates = [chosenModel, ...IMAGE_FALLBACK_MODELS.filter((m) => m !== chosenModel)];
    let lastError;
    for (const candidate of candidates) {
      try {
        return await requestImageOnce(candidate, {
          prompt, aspectRatio, imageSize: imageSize || cfg.imageSize || '1K', apiKey: cfg.apiKey,
        });
      } catch (err) {
        lastError = err;
        // Only a retired/unknown model is worth retrying elsewhere. Quota (429)
        // and safety blocks apply to every image model.
        if (err.status !== 404) break;
      }
    }
    throw friendlyGeminiError(lastError);
  };

  const tryCloudflare = async () => {
    if (!cf.configured) {
      throw new HttpError(400, 'Cloudflare Workers AI is not configured. Add the Account ID and API token in API Connections.');
    }
    const chosen = cfRequested ? model : cf.imageModel;
    const candidates = cfRequested ? [chosen] : [chosen, DEFAULT_CF_IMAGE_MODEL].filter((m, i, a) => a.indexOf(m) === i);
    let lastError;
    for (const candidate of candidates) {
      try {
        return await cloudflareImageOnce(candidate, { prompt, aspectRatio, cfg: cf });
      } catch (err) {
        lastError = err;
        // Credentials and daily quota apply to every model; only a bad model name is worth retrying.
        if ([401, 429].includes(err.status)) break;
      }
    }
    throw friendlyCloudflareError(lastError);
  };

  if (pref === 'cloudflare' || cfRequested) return tryCloudflare();
  if (pref === 'gemini') return tryGemini();

  // auto: use the free Cloudflare allocation first, then Gemini when it is
  // configured and Cloudflare is quota-limited or unavailable.
  if (cf.configured) {
    try { return await tryCloudflare(); } catch (err) {
      if (!cfg.apiKey || [401, 403].includes(err.status)) throw err;
      return tryGemini();
    }
  }
  return tryGemini();
}

async function listModels(apiKey) {
  const key = apiKey || (await geminiConfig()).apiKey;
  if (!key) throw new HttpError(400, 'Gemini API key is not configured.');
  const data = await fetchJson(`${API_BASE}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': key }, timeoutMs: 30_000,
  });
  return (data.models || []).map((m) => ({
    name: String(m.name || '').replace(/^models\//, ''),
    methods: m.supportedGenerationMethods || [],
    displayName: m.displayName,
  }));
}

async function testCloudflare(overrides = {}) {
  const base = await cloudflareConfig();
  const cfg = { ...base };
  for (const key of ['accountId', 'apiToken', 'textModel', 'visionModel', 'imageModel']) {
    if (overrides[key]) cfg[key] = overrides[key];
  }
  if (!cfg.accountId || !cfg.apiToken) {
    throw new HttpError(400, 'Enter the Cloudflare Account ID and API token first.');
  }
  const started = Date.now();

  // A cheap text ping proves the token and account ID are valid without
  // spending the Neurons an image generation would cost.
  let sample = '';
  try {
    sample = await cloudflareTextOnce(cfg.textModel, 'Reply with exactly: CONNECTED', '', { cfg, maxOutputTokens: 32 });
  } catch (err) {
    throw friendlyCloudflareError(err);
  }

  return {
    ok: /CONNECTED/i.test(sample) || sample.trim().length > 0,
    textModel: cfg.textModel,
    visionModel: cfg.visionModel,
    imageModel: cfg.imageModel,
    sample: truncate(sample, 120),
    durationMs: Date.now() - started,
    message: `Credentials valid. Image model "${cfg.imageModel}" will generate the food photographs.`,
  };
}

async function testGemini(overrides = {}) {
  const cfg = await geminiConfig();
  const apiKey = overrides.apiKey || cfg.apiKey;
  const textModel = overrides.textModel || cfg.textModel;
  const imageModel = overrides.imageModel || cfg.imageModel;
  if (!apiKey) throw new HttpError(400, 'Enter a Gemini API key first.');
  const started = Date.now();
  let models = [];
  try { models = await listModels(apiKey); } catch (err) { throw friendlyGeminiError(err); }

  const textModels = models.filter((m) => m.methods.includes('generateContent') && !/image|embedding|tts|live|transcribe|robotics|veo|omni/i.test(m.name)).map((m) => m.name);
  const imageModels = models.filter((m) => /image/.test(m.name) && !/embedding/i.test(m.name)).map((m) => m.name);

  let textOk = false; let textError = null; let sample = '';
  try {
    sample = await generateText({
      apiKey, model: textModel, fallback: false, provider: 'gemini',
      prompt: 'Reply with exactly: CONNECTED', maxOutputTokens: 32,
    });
    textOk = /CONNECTED/i.test(sample);
    if (!textOk) textOk = sample.trim().length > 0;
  } catch (err) { textError = err.message; }

  return {
    ok: textOk,
    keyValid: true,
    textModel,
    textModelAvailable: textModels.includes(textModel),
    imageModel,
    imageModelAvailable: imageModels.includes(imageModel),
    imageModels,
    textModels: textModels.slice(0, 60),
    modelCount: models.length,
    sample: truncate(sample, 120),
    textError,
    durationMs: Date.now() - started,
    message: textOk
      ? `Key valid. ${models.length} models available. Text model responded.`
      : `Key is valid but the text model "${textModel}" did not respond: ${textError || 'unknown error'}`,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt helpers                                                      */
/* ------------------------------------------------------------------ */

function renderTemplate(body, vars = {}) {
  return String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(', ');
    return JSON.stringify(v);
  });
}

async function getPromptBody(category, fallback = '') {
  const rows = await query(
    `SELECT body FROM prompts WHERE category = ? ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [category],
  );
  return rows[0]?.body || fallback;
}

async function renderPrompt(category, vars, fallback) {
  const body = await getPromptBody(category, fallback);
  return renderTemplate(body, vars);
}

module.exports = {
  geminiConfig, cloudflareConfig, generateText, generateJson, analyzeImage, generateImage,
  testGemini, testCloudflare, listModels,
  renderTemplate, renderPrompt, getPromptBody, extractJson, extractText, extractImage,
  extractCloudflareText, cloudflareRequest,
  DEFAULT_TEXT_MODEL, DEFAULT_IMAGE_MODEL,
  DEFAULT_CF_TEXT_MODEL, DEFAULT_CF_VISION_MODEL, DEFAULT_CF_IMAGE_MODEL,
  friendlyGeminiError, friendlyCloudflareError,
};
