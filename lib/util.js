'use strict';

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

function loadEnv() {
  // Node 20.12+ / 24 native .env loader. Never throws when file is absent.
  try { process.loadEnvFile?.('.env'); } catch { /* no .env */ }
}

const ENV = {
  get appUrl() {
    return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  },
  get nodeEnv() { return process.env.NODE_ENV || 'development'; },
  get isProd() { return this.nodeEnv === 'production'; },
};

/* ------------------------------------------------------------------ */
/* Time helpers (timezone aware, no external deps)                     */
/* ------------------------------------------------------------------ */

function zonedParts(date = new Date(), timeZone = 'Asia/Dhaka') {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      weekday: 'short',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      weekday: 'short',
    });
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(hour).padStart(2, '0')}:${p.minute}`,
    minutes: hour * 60 + Number(p.minute),
    weekday: weekdayMap[p.weekday] ?? new Date(date).getUTCDay(),
  };
}

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function minutesToHHMM(m) {
  const v = ((Number(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function dateInZone(date, tz) { return zonedParts(date, tz).date; }

/* ------------------------------------------------------------------ */
/* Crypto helpers                                                      */
/* ------------------------------------------------------------------ */

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch { return false; }
}

const SECRET_KEY = crypto.scryptSync(
  process.env.SECRET_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'antigem-local-development-key',
  'food-automation-secret-v1',
  32,
);

function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptSecret(payload) {
  if (!payload) return '';
  const s = String(payload);
  if (!s.startsWith('v1.')) return s; // backwards compatible plaintext
  try {
    const [, ivB, tagB, dataB] = s.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Network helpers                                                     */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 90_000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const apiMsg = data?.error?.message || data?.message || data?.error_description
        || (typeof data === 'string' ? data : text?.slice(0, 500)) || res.statusText;
      const err = new HttpError(res.status, `${apiMsg || 'Request failed'} (HTTP ${res.status})`, data);
      err.responseText = text?.slice(0, 2000);
      throw err;
    }
    return data ?? {};
  } catch (err) {
    if (err.name === 'AbortError') throw new HttpError(504, `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally { clearTimeout(timer); }
}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

function slugify(str, fallback = 'post') {
  const s = String(str || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return s || fallback;
}

function normalizeTopic(str) {
  return String(str || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(str) {
  const stop = new Set(['the', 'a', 'an', 'and', 'with', 'for', 'of', 'easy', 'best', 'healthy', 'recipe', 'simple', 'quick']);
  return new Set(normalizeTopic(str).split(' ').filter((w) => w.length > 2 && !stop.has(w)));
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function isSimilarTopic(a, b, threshold = 0.62) { return jaccard(a, b) >= threshold; }

function truncate(str, len = 500) {
  const s = String(str || '');
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

function assert(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  loadEnv, ENV, zonedParts, isValidTimezone, minutesToHHMM, hhmmToMinutes, dateInZone,
  sha256, randomToken, hashPassword, verifyPassword, encryptSecret, decryptSecret, maskSecret,
  fetchJson, formEncode, HttpError, slugify, normalizeTopic, tokenSet, jaccard, isSimilarTopic,
  truncate, assert, sleep,
};
