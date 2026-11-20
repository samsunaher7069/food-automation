'use strict';

const { fetchJson, HttpError, truncate } = require('./util');
const { getConnection, getSettings, query } = require('./db');

const API_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const API_REVISION = process.env.GEMINI_API_REVISION || '2026-05-20';
const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

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

function friendlyGeminiError(err) {
  const msg = String(err?.message || err);
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(msg)) {
    return new HttpError(401, 'Gemini rejected the API key. Update the key in API Connections.', err?.details);
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return new HttpError(429, 'Gemini quota exhausted for this key/model. Check your plan or try another model.', err?.details);
  }
  if (/not found|NOT_FOUND|does not support|unsupported/i.test(msg)) {
    return new HttpError(400, `Gemini model is unavailable: ${truncate(msg, 240)}`, err?.details);
  }
  return err;
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

async function generateText({ prompt, system = '', model, apiKey, maxOutputTokens = 8192, temperature, json = false, timeoutMs = 120_000 } = {}) {
  const cfg = await geminiConfig();
  const chosenModel = model || cfg.textModel;
  const key = apiKey || cfg.apiKey;
  if (!key) throw new HttpError(400, 'Gemini API key is not configured. Add it in API Connections.');
  if (!prompt) throw new HttpError(400, 'Prompt is required.');

  const finalPrompt = json
    ? `${prompt}\n\nRespond with a single valid JSON document only. No markdown fences, no commentary.`
    : prompt;

  const body = {
    model: chosenModel,
    input: finalPrompt,
    ...(system ? { system_instruction: system } : {}),
    generation_config: { max_output_tokens: maxOutputTokens },
  };

  let data;
  let lastError;
  try {
    data = await callInteractions(body, key, timeoutMs);
  } catch (err) {
    lastError = err;
    // Older API keys/models may only expose generateContent. Retry there before failing.
    try {
      data = await callGenerateContent(chosenModel, legacyTextRequest(finalPrompt, system, { maxOutputTokens, temperature }), key, timeoutMs);
    } catch (err2) {
      throw friendlyGeminiError(err2.status === 404 || err2.status === 400 ? err2 : err);
    }
  }

  const text = extractText(data);
  if (!text) {
    const reason = data?.status || data?.error?.message || 'no text returned';
    throw new HttpError(502, `Gemini returned no text (${truncate(String(reason), 200)}). Check the configured text model.`);
  }
  return text;
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
      maxOutputTokens: args.maxOutputTokens || 8192,
    });
    return extractJson(repair);
  }
}

async function analyzeImage({ imageBuffer, mime = 'image/png', prompt }) {
  const cfg = await geminiConfig();
  if (!cfg.apiKey) throw new HttpError(400, 'Gemini API key is not configured.');
  if (!imageBuffer) throw new HttpError(400, 'Image data is required for analysis.');
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const legacy = {
    contents: [{
      role: 'user',
      parts: [
        { text: `${prompt}\n\nReturn JSON only.` },
        { inlineData: { mimeType: mime, data: base64 } },
      ],
    }],
    generationConfig: { maxOutputTokens: 4096 },
  };

  const interaction = {
    model: cfg.textModel,
    input: [
      { type: 'text', text: `${prompt}\n\nReturn JSON only.` },
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
  try { return extractJson(text); } catch { return { raw_analysis: text }; }
}

/**
 * Generate an image with the configured Gemini image model.
 * Tries the current Interactions API first, then the classic generateContent shape.
 */
async function generateImage({ prompt, aspectRatio = '2:3', model, imageSize } = {}) {
  const cfg = await geminiConfig();
  if (!cfg.apiKey) throw new HttpError(400, 'Gemini API key is not configured.');
  const chosenModel = model || cfg.imageModel;
  if (!chosenModel) throw new HttpError(400, 'No Gemini image model configured.');

  const interaction = {
    model: chosenModel,
    input: [{ type: 'text', text: prompt }],
    response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspectRatio, image_size: imageSize || cfg.imageSize || '1K' },
  };

  let data = null; let primaryError = null;
  try {
    data = await callInteractions(interaction, cfg.apiKey, 180_000);
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
    try {
      const legacyData = await callGenerateContent(chosenModel, legacy, cfg.apiKey, 180_000);
      image = extractImage(legacyData);
    } catch (err) {
      const base = primaryError || err;
      const e = friendlyGeminiError(err);
      if (/not found|unsupported|does not support/i.test(String(base?.message)) || primaryError?.status === 404) {
        throw new HttpError(400,
          `Image generation is not available for model "${chosenModel}". `
          + 'Use an image-capable model (gemini-3.1-flash-image, gemini-nano-banana-2.1, gemini-2.5-flash-image) '
          + 'that your API key can access, then try again.', base?.details);
      }
      throw e;
    }
  }

  if (!image?.data) {
    const hint = primaryError?.message ? ` Provider said: ${truncate(primaryError.message, 240)}` : '';
    throw new HttpError(502,
      `Gemini did not return an image. The configured model "${chosenModel}" may not support image generation, `
      + `or the prompt was blocked by safety filters.${hint}`, primaryError?.details);
  }
  return { buffer: Buffer.from(image.data, 'base64'), mime: image.mime || 'image/png', model: chosenModel };
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
      apiKey, model: textModel,
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
  geminiConfig, generateText, generateJson, analyzeImage, generateImage, testGemini, listModels,
  renderTemplate, renderPrompt, getPromptBody, extractJson, extractText, extractImage,
  DEFAULT_TEXT_MODEL, DEFAULT_IMAGE_MODEL, friendlyGeminiError,
};
