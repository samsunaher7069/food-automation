'use strict';

const crypto = require('node:crypto');
const { fetchJson, formEncode, HttpError, ENV, truncate } = require('./util');
const {
  getConnection, setConnection, patchConnection, deleteConnection, getSettings,
} = require('./db');

/* ================================================================== */
/* CLOUDINARY                                                          */
/* ================================================================== */

async function cloudinaryConfig() {
  const conn = (await getConnection('cloudinary')) || {};
  return {
    cloudName: conn.cloudName || process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: conn.apiKey || process.env.CLOUDINARY_API_KEY || '',
    apiSecret: conn.apiSecret || process.env.CLOUDINARY_API_SECRET || '',
  };
}

function cloudinarySignature(params, apiSecret) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

async function uploadToCloudinary(buffer, { folder = 'food-automation', filename, mime = 'image/png' } = {}) {
  const cfg = await cloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    throw new HttpError(400, 'Cloudinary is not configured. Add cloud name, API key and secret in API Connections.');
  }
  const params = {
    folder,
    timestamp: Math.floor(Date.now() / 1000),
    ...(filename ? { public_id: filename.replace(/\.[a-z0-9]+$/i, '') } : {}),
  };
  const signature = cloudinarySignature(params, cfg.apiSecret);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename || 'image.png');
  form.append('api_key', cfg.apiKey);
  form.append('timestamp', String(params.timestamp));
  form.append('folder', params.folder);
  if (params.public_id) form.append('public_id', params.public_id);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(res.status, `Cloudinary upload failed: ${data?.error?.message || res.statusText}`);
  }
  return {
    url: data.secure_url,
    publicId: data.public_id,
    width: data.width,
    height: data.height,
    format: data.format,
    mime: `image/${data.format || 'png'}`,
  };
}

async function testCloudinary(overrides = {}) {
  const cfg = await cloudinaryConfig();
  const merged = {
    cloudName: overrides.cloudName || cfg.cloudName,
    apiKey: overrides.apiKey || cfg.apiKey,
    apiSecret: overrides.apiSecret || cfg.apiSecret,
  };
  if (!merged.cloudName || !merged.apiKey || !merged.apiSecret) {
    throw new HttpError(400, 'All three Cloudinary credentials are required.');
  }
  // 1x1 transparent-ish PNG for a real upload test.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSFQFAJ0lBgcX1sVJAAAAAElFTkSuQmCC', 'base64');
  const params = { folder: 'food-automation/test', timestamp: Math.floor(Date.now() / 1000) };
  const signature = cloudinarySignature(params, merged.apiSecret);
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'connection-test.png');
  form.append('api_key', merged.apiKey);
  form.append('timestamp', String(params.timestamp));
  form.append('folder', params.folder);
  form.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(merged.cloudName)}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(45_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, `Cloudinary rejected the test upload: ${data?.error?.message || res.statusText}`);
  return { ok: true, cloudName: merged.cloudName, url: data.secure_url, message: 'Test image uploaded successfully.' };
}

/* ================================================================== */
/* OAUTH CREDENTIALS                                                   */
/* ================================================================== */

async function oauthCreds(provider) {
  const conn = (await getConnection(`${provider}_oauth`)) || {};
  if (provider === 'google') {
    return {
      clientId: conn.clientId || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: conn.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: conn.redirectUri || process.env.GOOGLE_REDIRECT_URI || `${ENV.appUrl}/auth/google/callback`,
    };
  }
  return {
    clientId: conn.clientId || process.env.PINTEREST_CLIENT_ID || '',
    clientSecret: conn.clientSecret || process.env.PINTEREST_CLIENT_SECRET || '',
    redirectUri: conn.redirectUri || process.env.PINTEREST_REDIRECT_URI || `${ENV.appUrl}/auth/pinterest/callback`,
  };
}

/* ================================================================== */
/* BLOGGER (Google OAuth 2.0 + Blogger API v3)                         */
/* ================================================================== */

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/blogger';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BLOGGER_API = 'https://www.googleapis.com/blogger/v3';

async function googleAuthUrl(state) {
  const c = await oauthCreds('google');
  if (!c.clientId || !c.clientSecret) {
    throw new HttpError(400, 'Google OAuth client ID/secret are not configured. Add them in API Connections or environment variables.');
  }
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return { url: `${GOOGLE_AUTH_URL}?${params}`, redirectUri: c.redirectUri };
}

async function exchangeGoogleCode(code) {
  const c = await oauthCreds('google');
  if (!c.redirectUri) throw new HttpError(400, 'Google redirect URI is not configured.');
  const data = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      code, client_id: c.clientId, client_secret: c.clientSecret,
      redirect_uri: c.redirectUri, grant_type: 'authorization_code',
    }),
    timeoutMs: 30_000,
  });
  if (!data.access_token) throw new HttpError(502, 'Google did not return an access token.');
  const expiry = Date.now() + Number(data.expires_in || 3600) * 1000;
  const existing = (await getConnection('google')) || {};
  const conn = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || existing.refreshToken || '',
    expiry,
    scope: data.scope,
    tokenType: data.token_type,
    connectedAt: new Date().toISOString(),
  };
  await setConnection('google', conn);
  return conn;
}

async function validGoogleToken({ force = false } = {}) {
  const conn = await getConnection('google');
  if (!conn?.accessToken && !conn?.refreshToken) {
    throw new HttpError(400, 'Blogger is not connected. Connect your Google account first.');
  }
  const expiring = !conn.expiry || Number(conn.expiry) < Date.now() + 90_000;
  if (!force && !expiring) return conn.accessToken;
  if (!conn.refreshToken) {
    if (!expiring) return conn.accessToken;
    throw new HttpError(401, 'Google authorization expired and no refresh token is stored. Reconnect Blogger.');
  }
  const c = await oauthCreds('google');
  const data = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: c.clientId, client_secret: c.clientSecret,
      refresh_token: conn.refreshToken, grant_type: 'refresh_token',
    }),
    timeoutMs: 30_000,
  });
  const accessToken = data.access_token;
  if (!accessToken) throw new HttpError(401, 'Google token refresh failed. Reconnect Blogger.');
  await setConnection('google', {
    ...conn,
    accessToken,
    refreshToken: data.refresh_token || conn.refreshToken,
    expiry: Date.now() + Number(data.expires_in || 3600) * 1000,
    refreshedAt: new Date().toISOString(),
  });
  return accessToken;
}

async function bloggerFetch(pathname, { method = 'GET', body } = {}) {
  const token = await validGoogleToken();
  try {
    return await fetchJson(`${BLOGGER_API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 60_000,
    });
  } catch (err) {
    if (err.status === 401) {
      const fresh = await validGoogleToken({ force: true });
      return fetchJson(`${BLOGGER_API}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${fresh}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        timeoutMs: 60_000,
      });
    }
    throw err;
  }
}

async function listBlogs() {
  const data = await bloggerFetch('/users/self/blogs');
  return (data.items || []).map((b) => ({ id: b.id, name: b.name, url: b.url, posts: b.posts?.totalItems }));
}

async function listBloggerPosts(blogId, maxResults = 25) {
  const data = await bloggerFetch(`/blogs/${encodeURIComponent(blogId)}/posts?maxResults=${maxResults}&status=live`);
  return data.items || [];
}

async function publishBloggerPost({ blogId, title, content, labels = [], isDraft = false }) {
  if (!blogId) throw new HttpError(400, 'No Blogger blog selected.');
  if (!title || !content) throw new HttpError(400, 'Blogger post needs a title and content.');
  const data = await bloggerFetch(`/blogs/${encodeURIComponent(blogId)}/posts?isDraft=${isDraft ? 'true' : 'false'}`, {
    method: 'POST',
    body: { kind: 'blogger#post', title, content, labels },
  });
  return {
    id: data.id,
    url: data.url || data.selfLink,
    status: data.status,
    published: data.published,
    title: data.title,
  };
}

async function updateBloggerPost({ blogId, postId, title, content, labels = [] }) {
  if (!blogId || !postId) throw new HttpError(400, 'Blogger blog and post IDs are required for an update.');
  const data = await bloggerFetch(`/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, {
    method: 'PUT',
    body: { kind: 'blogger#post', id: postId, title, content, labels },
  });
  return { id: data.id, url: data.url || data.selfLink, status: data.status, published: data.published };
}

async function publishBloggerDraft({ blogId, postId }) {
  const data = await bloggerFetch(`/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}/publish`, { method: 'POST' });
  return { id: data.id, url: data.url || data.selfLink, status: data.status, published: data.published };
}

async function getBloggerPost(blogId, postId) {
  return bloggerFetch(`/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`);
}

async function deleteBloggerPost(blogId, postId) {
  const token = await validGoogleToken();
  const res = await fetch(`${BLOGGER_API}/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new HttpError(res.status, `Blogger delete failed: ${text.slice(0, 300) || res.statusText}`);
  }
  return { ok: true };
}

async function testBlogger() {
  const conn = await getConnection('google');
  if (!conn) throw new HttpError(400, 'Blogger is not connected yet.');
  const blogs = await listBlogs();
  const settings = await getSettings();
  const selected = settings.blogger?.defaultBlogId;
  const found = blogs.find((b) => b.id === selected);
  return {
    ok: true,
    blogs,
    selectedBlogId: selected || '',
    selectedBlogName: found?.name || settings.blogger?.defaultBlogName || '',
    message: blogs.length
      ? `${blogs.length} blog(s) available${found ? `; default is "${found.name}"` : '; choose a default blog'}.`
      : 'Connected, but this Google account has no Blogger blogs.',
  };
}

async function disconnectGoogle() {
  await deleteConnection('google');
}

/* ================================================================== */
/* PINTEREST (API v5)                                                  */
/* ================================================================== */

const PINTEREST_API = (process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5').replace(/\/$/, '');
const PINTEREST_SCOPES = 'boards:read,pins:read,pins:write,user_accounts:read';

async function pinterestAuthUrl(state) {
  const c = await oauthCreds('pinterest');
  if (!c.clientId || !c.clientSecret) {
    throw new HttpError(400, 'Pinterest OAuth client ID/secret are not configured. Add them in API Connections or environment variables.');
  }
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: PINTEREST_SCOPES,
    state,
  });
  return { url: `https://www.pinterest.com/oauth/?${params}`, redirectUri: c.redirectUri };
}

async function pinterestTokenRequest(body) {
  const c = await oauthCreds('pinterest');
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  return fetchJson(`${PINTEREST_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(body),
    timeoutMs: 30_000,
  });
}

async function exchangePinterestCode(code) {
  const c = await oauthCreds('pinterest');
  const data = await pinterestTokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: c.redirectUri,
  });
  if (!data.access_token) throw new HttpError(502, 'Pinterest did not return an access token.');
  const expiry = Date.now() + Number(data.expires_in || 30 * 86400) * 1000;
  let account = {};
  try {
    const me = await fetchJson(`${PINTEREST_API}/user_account`, {
      headers: { Authorization: `Bearer ${data.access_token}` }, timeoutMs: 20_000,
    });
    account = { username: me.username, accountType: me.account_type, profileImage: me.profile_image };
  } catch { /* non fatal */ }
  const conn = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiry,
    scope: data.scope,
    account,
    connectedAt: new Date().toISOString(),
  };
  await setConnection('pinterest', conn);
  return conn;
}

async function validPinterestToken({ force = false } = {}) {
  const conn = await getConnection('pinterest');
  if (!conn?.accessToken && !conn?.refreshToken) {
    throw new HttpError(400, 'Pinterest is not connected. Connect Pinterest first.');
  }
  const expiring = !conn.expiry || Number(conn.expiry) < Date.now() + 120_000;
  if (!force && !expiring) return conn.accessToken;
  if (!conn.refreshToken) {
    if (!expiring) return conn.accessToken;
    throw new HttpError(401, 'Pinterest authorization expired. Reconnect Pinterest.');
  }
  try {
    const data = await pinterestTokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refreshToken });
    if (!data.access_token) throw new Error('no token');
    await setConnection('pinterest', {
      ...conn,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || conn.refreshToken,
      expiry: Date.now() + Number(data.expires_in || 30 * 86400) * 1000,
      refreshedAt: new Date().toISOString(),
    });
    return data.access_token;
  } catch (err) {
    if (expiring) throw new HttpError(401, `Pinterest token refresh failed: ${err.message}. Reconnect Pinterest.`);
    return conn.accessToken;
  }
}

async function pinterestFetch(pathname, { method = 'GET', body } = {}) {
  const token = await validPinterestToken();
  try {
    return await fetchJson(`${PINTEREST_API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 60_000,
    });
  } catch (err) {
    if (err.status === 401) {
      const fresh = await validPinterestToken({ force: true });
      return fetchJson(`${PINTEREST_API}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${fresh}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        timeoutMs: 60_000,
      });
    }
    throw err;
  }
}

async function listBoards() {
  const data = await pinterestFetch('/boards?page_size=100');
  return (data.items || []).map((b) => ({
    id: b.id, name: b.name, description: b.description, privacy: b.privacy,
    pinCount: b.pin_count, owner: b.owner?.username,
  }));
}

async function createPinterestPin({ boardId, title, description, link, imageUrl, altText }) {
  if (!boardId) throw new HttpError(400, 'No Pinterest board selected.');
  if (!imageUrl) throw new HttpError(400, 'Pinterest requires a publicly accessible image URL.');
  if (!/^https?:\/\//i.test(imageUrl)) throw new HttpError(400, 'The image URL is not publicly accessible (no https URL). Configure Cloudinary first.');
  const body = {
    board_id: boardId,
    title: String(title || '').slice(0, 100),
    description: String(description || '').slice(0, 500),
    link: link || undefined,
    alt_text: altText ? String(altText).slice(0, 500) : undefined,
    media_source: { source_type: 'image_url', url: imageUrl },
  };
  const data = await pinterestFetch('/pins', { method: 'POST', body });
  return {
    id: data.id,
    url: data.id ? `https://www.pinterest.com/pin/${data.id}/` : '',
    boardId: data.board_id,
    title: data.title,
    link: data.link,
  };
}

async function getPinterestPin(pinId) {
  return pinterestFetch(`/pins/${encodeURIComponent(pinId)}`);
}

async function deletePinterestPin(pinId) {
  const token = await validPinterestToken();
  const res = await fetch(`${PINTEREST_API}/pins/${encodeURIComponent(pinId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new HttpError(res.status, `Pinterest delete failed: ${text.slice(0, 300) || res.statusText}`);
  }
  return { ok: true };
}

async function testPinterest() {
  const conn = await getConnection('pinterest');
  if (!conn) throw new HttpError(400, 'Pinterest is not connected yet.');
  const boards = await listBoards();
  const settings = await getSettings();
  const selected = settings.pinterest?.defaultBoardId;
  const found = boards.find((b) => b.id === selected);
  return {
    ok: true,
    account: conn.account?.username || '',
    boards,
    selectedBoardId: selected || '',
    selectedBoardName: found?.name || settings.pinterest?.defaultBoardName || '',
    message: boards.length
      ? `${boards.length} board(s) available${found ? `; default is "${found.name}"` : '; choose a default board'}.`
      : 'Connected, but no boards were returned. Create a board on Pinterest first.',
  };
}

async function getPinterestAnalytics({ startDate, endDate, metrics = ['IMPRESSION', 'SAVE', 'PIN_CLICK', 'OUTBOUND_CLICK'] }) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    metric_types: metrics.join(','),
  });
  const data = await pinterestFetch(`/user_account/analytics?${params}`);
  return data;
}

async function disconnectPinterest() {
  await deleteConnection('pinterest');
}

/* ================================================================== */
/* NUTRITION PROVIDER TEST                                             */
/* ================================================================== */

async function testNutrition({ provider, apiKey } = {}) {
  if (provider === 'usda') {
    if (!apiKey) throw new HttpError(400, 'USDA FoodData Central API key is required for this provider.');
    const data = await fetchJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'chicken breast', pageSize: 1, dataType: ['SR Legacy'] }),
      timeoutMs: 30_000,
    });
    return {
      ok: true,
      provider: 'usda',
      sample: data?.foods?.[0]?.description || null,
      message: data?.foods?.length ? 'USDA FoodData Central is reachable.' : 'Reachable, but no results returned for the test query.',
    };
  }
  const { FOODS } = require('./nutrition');
  return {
    ok: true,
    provider: 'builtin',
    sampleCount: FOODS.length,
    message: `Built-in dataset ready with ${FOODS.length} common ingredients. No API key required.`,
  };
}

/* ================================================================== */
/* CONNECTION SUMMARY (never returns raw secrets)                      */
/* ================================================================== */

async function connectionSummary() {
  const [gemini, google, pinterest, cloudinary, googleOauth, pinterestOauth, nutrition] = await Promise.all([
    getConnection('gemini'), getConnection('google'), getConnection('pinterest'),
    getConnection('cloudinary'), getConnection('google_oauth'), getConnection('pinterest_oauth'),
    getConnection('nutrition'),
  ]);
  const settings = await getSettings();
  const { maskSecret } = require('./util');
  return {
    gemini: {
      configured: Boolean(gemini?.apiKey || process.env.GEMINI_API_KEY),
      source: gemini?.apiKey ? 'database' : (process.env.GEMINI_API_KEY ? 'environment' : 'none'),
      keyMasked: gemini?.apiKey ? maskSecret(gemini.apiKey) : (process.env.GEMINI_API_KEY ? maskSecret(process.env.GEMINI_API_KEY) : ''),
      textModel: gemini?.textModel || process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
      imageModel: gemini?.imageModel || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
      lastTest: gemini?.lastTest || null,
      verifiedAt: gemini?.verifiedAt || null,
    },
    google: {
      configured: Boolean((await oauthCreds('google')).clientId),
      connected: Boolean(google?.accessToken || google?.refreshToken),
      connectedAt: google?.connectedAt || null,
      hasRefreshToken: Boolean(google?.refreshToken),
      redirectUri: (await oauthCreds('google')).redirectUri,
      defaultBlogId: settings.blogger?.defaultBlogId || '',
      defaultBlogName: settings.blogger?.defaultBlogName || '',
      lastTest: google?.lastTest || null,
    },
    pinterest: {
      configured: Boolean((await oauthCreds('pinterest')).clientId),
      connected: Boolean(pinterest?.accessToken || pinterest?.refreshToken),
      username: pinterest?.account?.username || '',
      connectedAt: pinterest?.connectedAt || null,
      hasRefreshToken: Boolean(pinterest?.refreshToken),
      redirectUri: (await oauthCreds('pinterest')).redirectUri,
      defaultBoardId: settings.pinterest?.defaultBoardId || '',
      defaultBoardName: settings.pinterest?.defaultBoardName || '',
      lastTest: pinterest?.lastTest || null,
    },
    cloudinary: {
      configured: Boolean((await cloudinaryConfig()).cloudName && (await cloudinaryConfig()).apiKey && (await cloudinaryConfig()).apiSecret),
      cloudName: (await cloudinaryConfig()).cloudName || '',
      apiKeyMasked: maskSecret((await cloudinaryConfig()).apiKey),
      source: cloudinary?.cloudName ? 'database' : (process.env.CLOUDINARY_CLOUD_NAME ? 'environment' : 'none'),
      lastTest: cloudinary?.lastTest || null,
    },
    nutrition: {
      provider: settings.nutrition?.provider || 'builtin',
      usdaKeyMasked: maskSecret(nutrition?.usdaKey || process.env.NUTRITION_API_KEY || ''),
      configured: (settings.nutrition?.provider || 'builtin') === 'builtin' || Boolean(nutrition?.usdaKey || process.env.NUTRITION_API_KEY),
      lastTest: nutrition?.lastTest || null,
    },
    oauthApps: {
      google: {
        clientIdMasked: maskSecret((await oauthCreds('google')).clientId),
        configured: Boolean((await oauthCreds('google')).clientId && (await oauthCreds('google')).clientSecret),
      },
      pinterest: {
        clientIdMasked: maskSecret((await oauthCreds('pinterest')).clientId),
        configured: Boolean((await oauthCreds('pinterest')).clientId && (await oauthCreds('pinterest')).clientSecret),
      },
    },
  };
}

module.exports = {
  cloudinaryConfig, uploadToCloudinary, testCloudinary, cloudinarySignature,
  oauthCreds, googleAuthUrl, exchangeGoogleCode, validGoogleToken, listBlogs, listBloggerPosts,
  publishBloggerPost, updateBloggerPost, publishBloggerDraft, getBloggerPost, deleteBloggerPost, testBlogger, disconnectGoogle,
  pinterestAuthUrl, exchangePinterestCode, validPinterestToken, listBoards, createPinterestPin,
  getPinterestPin, deletePinterestPin, testPinterest, getPinterestAnalytics, disconnectPinterest,
  testNutrition, connectionSummary,
};
