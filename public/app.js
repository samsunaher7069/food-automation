/* ==================================================================
   Nourish Studio — frontend application
   Vanilla JS, no build step. All data comes from the real REST API.
   ================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */

  const state = {
    boot: null,
    session: null,
    csrf: null,
    settings: null,
    connections: null,
    selections: null,
    envHints: null,
    meta: { categories: [], imageStyles: [], languages: [], timezones: [], appUrl: '' },
    view: 'dashboard',
    dashboard: null,
    posts: { items: [], total: 0, page: 1, limit: 12, pages: 1, status: 'all', search: '', category: '' },
    scheduled: [],
    analyticsRange: '30',
    analytics: null,
    prompts: { items: [], categories: [], activeId: null, category: 'topic_generation' },
    logs: { items: [], total: 0, page: 1, limit: 30, pages: 1, level: 'all', service: 'all', search: '' },
    automation: null,
    studio: null,
    notifications: 0,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = (v) => esc(v);

  function fmtNum(n) {
    const v = Number(n || 0);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function relTime(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const diff = Date.now() - t;
    if (diff < 45_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
    return fmtDate(iso);
  }

  function imgFor(post) {
    if (!post) return '';
    return post.imageLocalUrl || post.imageUrl || '';
  }

  /* ---------------------------------------------------------------- */
  /* Icons                                                             */
  /* ---------------------------------------------------------------- */

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    message: '<path d="M21 12a8 8 0 01-8 8H7l-4 3V12a8 8 0 018-8h2a8 8 0 018 8z"/><path d="M8 10h8M8 14h5"/>',
    plug: '<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 01-6 6 6 6 0 01-6-6V9zM12 18v3"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M12 15h5"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5"/>',
    play: '<path d="M7 4l13 8-13 8V4z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alert: '<path d="M12 3l9 16H3L12 3z"/><path d="M12 9v5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    external: '<path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z"/>',
    cloud: '<path d="M18 18a4 4 0 00.5-8 6 6 0 00-11.6 1.6A3.5 3.5 0 007 18h11z"/>',
    key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l9-9 3 3-2.5 2.5-2-2M14 9l2 2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    wand: '<path d="M15 4V2M15 10V8M12.5 6.5h-2M19.5 6.5h-2M5 20L19 6M18 16v2M17 17h2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    zap: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    clockFast: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    fire: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-6-9.5-6-9.5S8 10 8 13c-1.5-1-2-2.5-2-2.5S4 13 5 16c1 3.4 3.5 6 7 6z"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
    calendarPlus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/>',
    layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 016.5 22H20v-5"/>',
    leaf: '<path d="M11 20A7 7 0 0120 5c0 7-4 12-9 13"/><path d="M4 21c1-5 4-9 8-11"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8z"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  };

  function icon(name, cls = '') {
    const body = ICONS[name] || ICONS.info;
    return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${body}</svg>`;
  }

  /* ---------------------------------------------------------------- */
  /* API                                                               */
  /* ---------------------------------------------------------------- */

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    const init = { method, headers, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;

    let res;
    try {
      res = await fetch(path, init);
    } catch {
      throw new Error('Network error — the server could not be reached.');
    }
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => '');
    if (!res.ok) {
      if (res.status === 401 && !/\/api\/(login|setup)$/.test(path) && state.session?.authenticated) {
        state.session.authenticated = false;
        renderAuth({ setupRequired: false });
      }
      const msg = (data && data.error) || (typeof data === 'string' && data.slice(0, 300)) || `Request failed (HTTP ${res.status})`;
      // Surface API failures in the browser console (F12 → Console) as a
      // built-in, per-device diagnostics log alongside the in-app Logs view.
      console.error(`[Nourish API] ${method} ${path} → HTTP ${res.status}`, data);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------------------------------------------------------- */
  /* Toast / busy / modal                                              */
  /* ---------------------------------------------------------------- */

  function toast(message, kind = 'info', timeout = 4800) {
    const root = $('#toastRoot');
    if (!root) return;
    const markup = {
      success: icon('check'), error: icon('alert'), info: icon('info'), warn: icon('alert'),
    }[kind] || icon('info');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${markup}<div>${esc(message)}</div>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'all 180ms ease';
      setTimeout(() => el.remove(), 200);
    }, timeout);
  }

  let busyCount = 0;
  function busy(label = 'Working…', sub = '') {
    busyCount++;
    let overlay = $('#busyOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'busyOverlay';
      overlay.className = 'busy-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="busy-card"><span class="spinner"></span><span class="text"><strong>${esc(label)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>`;
    return () => {
      busyCount = Math.max(0, busyCount - 1);
      if (busyCount === 0) overlay.remove();
    };
  }

  async function withBusy(label, sub, fn) {
    const done = busy(label, sub);
    try { return await fn(); } finally { done(); }
  }

  function openModal({ title, subtitle = '', body = '', footer = '', size = '', onMount = null, closeable = true }) {
    const root = $('#modalRoot');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${attr(title)}">
        <div class="modal-head">
          <div class="grow"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          ${closeable ? `<button class="icon-btn modal-close" aria-label="Close">${icon('close')}</button>` : ''}
        </div>
        <div class="modal-body" id="modalBody">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    root.appendChild(overlay);
    const close = () => {
      overlay.remove();
      if (!root.querySelector('.modal-overlay')) document.body.style.overflow = '';
    };
    document.body.style.overflow = 'hidden';
    if (closeable) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      $('.modal-close', overlay)?.addEventListener('click', close);
    }
    overlay._close = close;
    onMount?.(overlay, close);
    setTimeout(() => {
      const focusable = overlay.querySelector('input, select, textarea, button.primary, button');
      focusable?.focus({ preventScroll: true });
    }, 60);
    return { overlay, close };
  }

  function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const m = openModal({
        title,
        body: `<p class="muted" style="font-size:13px;line-height:1.6">${esc(message)}</p>`,
        footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
                 <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
      });
      const finish = (v) => { m.close(); resolve(v); };
      $('[data-act="cancel"]', m.overlay).addEventListener('click', () => finish(false));
      $('[data-act="ok"]', m.overlay).addEventListener('click', () => finish(true));
      m.overlay.addEventListener('click', (e) => { if (e.target === m.overlay) resolve(false); });
    });
  }

  async function copyText(text, label = 'Copied to clipboard') {
    try {
      await navigator.clipboard.writeText(text);
      toast(label, 'success', 2200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(label, 'success', 2200); }
      catch { toast('Could not copy — select the text manually.', 'warn'); }
      ta.remove();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Small render helpers                                              */
  /* ---------------------------------------------------------------- */

  const STATUS = {
    draft: { label: 'Draft', cls: 'b-gray' },
    generated: { label: 'Generated', cls: 'b-blue' },
    scheduled: { label: 'Scheduled', cls: 'b-purple' },
    publishing: { label: 'Publishing', cls: 'b-amber' },
    published: { label: 'Published', cls: 'b-green' },
    partially_published: { label: 'Partial', cls: 'b-amber' },
    failed: { label: 'Failed', cls: 'b-red' },
  };

  function statusBadge(status) {
    const s = STATUS[status] || { label: status || 'Unknown', cls: 'b-gray' };
    return `<span class="badge ${s.cls}">${esc(s.label)}</span>`;
  }

  function platformBadge(kind, status) {
    if (!status || status === 'not_published') return '';
    const map = { published: 'b-green', draft: 'b-blue', failed: 'b-red', publishing: 'b-amber' };
    return `<span class="badge ${map[status] || 'b-gray'}">${kind}</span>`;
  }

  function doneSteps(stage = {}) {
    const order = ['image', 'image_analysis', 'recipe', 'nutrition', 'seo', 'blogger_html', 'content'];
    return order.filter((k) => stage[k]?.status === 'success' || stage[k]?.status === 'warning').length;
  }

  function connectionDot(ok, warn = false) {
    return `<span class="conn-dot ${ok ? 'ok' : warn ? 'warn' : ''}"></span>`;
  }

  /* ---------------------------------------------------------------- */
  /* Auth                                                              */
  /* ---------------------------------------------------------------- */

  function authPoint(text) {
    return `<div class="auth-point">${icon('check')}<span>${esc(text)}</span></div>`;
  }

  function renderAuth({ setupRequired = false, loginRequired = false } = {}) {
    $('#appShell').classList.add('hidden');
    $('#boot').classList.add('hidden');
    const root = $('#authRoot');
    root.classList.remove('hidden');
    const isSetup = Boolean(setupRequired);
    root.innerHTML = `
      <div class="auth-visual">
        <div class="auth-brand">
          <div class="brand-mark">${icon('leaf')}</div>
          <span>Nourish Studio</span>
        </div>
        <div>
          <h1 class="auth-headline">Healthy recipes,<br />written, photographed and <em>published</em>.</h1>
          <p class="auth-sub">One calm studio for AI recipe development, nutrition, Blogger articles and Pinterest pins — on your schedule.</p>
          <div class="auth-points">
            ${authPoint('Gemini writes recipes and creates the food photograph')}
            ${authPoint('Nutrition is calculated from real ingredient quantities')}
            ${authPoint('Blogger first, then Pinterest with the live article URL')}
            ${authPoint('Runs on PostgreSQL with a Render cron worker')}
          </div>
        </div>
        <p class="auth-foot">Self-hosted · Your keys stay on your server · ${esc(new Date().getFullYear())}</p>
      </div>
      <div class="auth-panel">
        <div class="auth-card">
          <h2>${isSetup ? 'Set up your studio' : 'Welcome back'}</h2>
          <p>${isSetup ? 'Create the single owner account. It takes one minute.' : 'Sign in to your content studio.'}</p>
          ${loginRequired ? `<div class="banner info mb-3">${icon('info')}<span>Please sign in to continue.</span></div>` : ''}
          <form id="authForm" autocomplete="on">
            <div class="field mb-2">
              <label for="authUser">Username</label>
              <input type="text" id="authUser" name="username" required minlength="3" maxlength="40"
                autocomplete="username" spellcheck="false" placeholder="e.g. owner" />
            </div>
            <div class="field mb-2">
              <label for="authPass">Password</label>
              <input type="password" id="authPass" name="password" required minlength="8" maxlength="200"
                autocomplete="${isSetup ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" />
              ${isSetup ? '<span class="hint">Use a long, unique password. It is stored as a scrypt hash.</span>' : ''}
            </div>
            ${isSetup ? `
            <div class="field mb-3">
              <label for="authSite">Studio name <span class="dim">(optional)</span></label>
              <input type="text" id="authSite" name="siteName" maxlength="80" placeholder="Nourish Studio" />
            </div>` : ''}
            <button class="btn primary block lg" type="submit" id="authSubmit">
              ${isSetup ? 'Create studio' : 'Sign in'}
            </button>
          </form>
          <div id="authError"></div>
          <p class="auth-alt">${isSetup
            ? 'Already created? <a href="#" id="authSwitch">Sign in instead</a>'
            : 'First time here? <a href="#" id="authSwitch">Run setup</a>'}</p>
        </div>
      </div>`;

    $('#authSwitch')?.addEventListener('click', (e) => {
      e.preventDefault();
      renderAuth({ setupRequired: !isSetup });
    });

    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#authSubmit');
      const username = $('#authUser').value.trim();
      const password = $('#authPass').value;
      const siteName = $('#authSite')?.value.trim();
      btn.disabled = true;
      $('#authError').innerHTML = '';
      try {
        const data = await api(isSetup ? '/api/setup' : '/api/login', {
          method: 'POST', body: { username, password, ...(siteName ? { siteName } : {}) },
        });
        state.csrf = data.csrf;
        state.session = { authenticated: true, user: data.user };
        root.classList.add('hidden');
        await enterApp({ freshSetup: isSetup });
      } catch (err) {
        $('#authError').innerHTML = `<div class="banner error mt-2">${icon('alert')}<span>${esc(err.message)}</span></div>`;
        btn.disabled = false;
      }
    });

    setTimeout(() => $('#authUser')?.focus(), 80);
  }

  /* ---------------------------------------------------------------- */
  /* App shell                                                         */
  /* ---------------------------------------------------------------- */

  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', eyebrow: 'Studio' },
    { id: 'create', label: 'Create post', icon: 'sparkles', eyebrow: 'Content studio' },
    { section: 'Content' },
    { id: 'history', label: 'Post history', icon: 'list', eyebrow: 'Library' },
    { id: 'scheduled', label: 'Scheduled', icon: 'calendar', eyebrow: 'Queue' },
    { id: 'analytics', label: 'Analytics', icon: 'chart', eyebrow: 'Performance' },
    { section: 'Configuration' },
    { id: 'prompts', label: 'Prompt studio', icon: 'message', eyebrow: 'AI control' },
    { id: 'connections', label: 'API connections', icon: 'plug', eyebrow: 'Integrations' },
    { id: 'automation', label: 'Automation', icon: 'repeat', eyebrow: 'Scheduling' },
    { id: 'logs', label: 'Activity logs', icon: 'terminal', eyebrow: 'Diagnostics' },
    { id: 'settings', label: 'Settings', icon: 'settings', eyebrow: 'Studio' },
  ];

  function buildNav() {
    const nav = $('#nav');
    nav.innerHTML = NAV_ITEMS.map((item) => {
      if (item.section) return `<div class="nav-label">${esc(item.section)}</div>`;
      const badge = item.id === 'history' && state.notifications ? `<span class="nav-badge">${state.notifications}</span>` : '';
      return `<button class="nav-link" data-view="${item.id}">
        ${icon(item.icon)}<span>${esc(item.label)}</span>${badge}
      </button>`;
    }).join('');
    if (!nav.dataset.bound) {
      nav.dataset.bound = '1';
      nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (!btn) return;
        go(btn.dataset.view);
        closeNav();
      });
    }
  }

  function syncNav() {
    $$('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    const item = NAV_ITEMS.find((n) => n.id === state.view) || {};
    $('#pageTitle').textContent = item.label || 'Dashboard';
    $('#pageEyebrow').textContent = item.eyebrow || 'Studio';
    document.title = `${item.label || 'Studio'} · ${state.settings?.siteName || 'Nourish Studio'}`;
  }

  function closeNav() {
    $('#sidebar')?.classList.remove('open');
    const scrim = $('#navScrim');
    if (scrim) scrim.hidden = true;
  }

  function openNav() {
    $('#sidebar')?.classList.add('open');
    const scrim = $('#navScrim');
    if (scrim) scrim.hidden = false;
  }

  function go(view, opts = {}) {
    if (!view) view = 'dashboard';
    state.view = view;
    if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
    syncNav();
    renderView();
    $('#view')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderView() {
    const view = $('#view');
    if (!view) return;
    switch (state.view) {
      case 'create': return renderCreate(view);
      case 'history': return renderHistory(view);
      case 'scheduled': return renderScheduled(view);
      case 'analytics': return renderAnalytics(view);
      case 'prompts': return renderPrompts(view);
      case 'connections': return renderConnections(view);
      case 'automation': return renderAutomation(view);
      case 'logs': return renderLogs(view);
      case 'settings': return renderSettings(view);
      default: return renderDashboard(view);
    }
  }

  function applyBranding() {
    const name = state.settings?.siteName || 'Nourish Studio';
    $('#brandName').textContent = name;
    const user = state.session?.user?.username || 'admin';
    $('#userName').textContent = user;
    $('#userAvatar').textContent = user.slice(0, 1).toUpperCase();
    const s = state.settings?.automation || {};
    const pill = $('#autoPill');
    pill.classList.toggle('on', Boolean(s.enabled));
    $('#autoLabel').textContent = s.enabled ? 'Automation on' : 'Automation off';
    $('#autoMeta').textContent = s.enabled
      ? `${s.postsPerDay || 1}/day · ${(s.times || []).slice(0, 2).join(', ') || '09:00'}`
      : 'Tap to configure';
    syncConnectionDots();
  }

  function syncConnectionDots() {
    const c = state.connections;
    const el = $('#connDots');
    if (!el || !c) return;
    el.innerHTML = [
      `<span title="Gemini: ${c.gemini?.configured ? 'configured' : 'missing'}">${connectionDot(c.gemini?.configured)}</span>`,
      `<span title="Blogger: ${c.google?.connected ? 'connected' : c.google?.configured ? 'app configured, not connected' : 'missing'}">${connectionDot(c.google?.connected, c.google?.configured)}</span>`,
      `<span title="Pinterest: ${c.pinterest?.connected ? 'connected' : c.pinterest?.configured ? 'app configured, not connected' : 'missing'}">${connectionDot(c.pinterest?.connected, c.pinterest?.configured)}</span>`,
      `<span title="Cloudinary: ${c.cloudinary?.configured ? 'configured' : 'missing'}">${connectionDot(c.cloudinary?.configured)}</span>`,
    ].join('');
    el.insertAdjacentHTML('beforeend', '');
  }

  async function refreshCore() {
    const [session, settings, connections, dashboard] = await Promise.all([
      api('/api/session'), api('/api/settings'), api('/api/connections'), api('/api/dashboard'),
    ]);
    state.session = session;
    state.csrf = session.csrf || state.csrf;
    state.settings = settings.settings;
    state.meta = {
      categories: settings.categories || [], imageStyles: settings.imageStyles || [],
      languages: settings.languages || [], timezones: settings.timezones || [],
      appUrl: settings.appUrl || '', version: settings.version,
    };
    state.connections = connections.connections;
    state.selections = connections.selections;
    state.envHints = connections.envHints;
    state.dashboard = dashboard;
    state.notifications = (dashboard.stats?.failed || 0);
    buildNav();
    applyBranding();
    syncNav();
    return dashboard;
  }

  async function enterApp({ freshSetup = false } = {}) {
    $('#boot').classList.remove('hidden');
    try {
      await refreshCore();
      $('#boot').classList.add('hidden');
      $('#authRoot').classList.add('hidden');
      $('#appShell').classList.remove('hidden');
      const hash = location.hash.slice(1);
      const start = ['dashboard', 'create', 'history', 'scheduled', 'analytics', 'prompts', 'connections', 'automation', 'logs', 'settings'].includes(hash) ? hash : 'dashboard';
      state.view = start;
      buildNav();
      applyBranding();
      syncNav();
      renderView();
      handleOauthFlash();

      const needsWizard = !state.settings?.setup?.completed;
      if (needsWizard && (freshSetup || start === 'dashboard')) {
        setTimeout(() => openSetupWizard(freshSetup ? 0 : 0), 420);
      }
    } catch (err) {
      $('#boot').innerHTML = `
        <div class="banner error" style="max-width:440px">${icon('alert')}<span>Could not start the app: ${esc(err.message)}</span></div>
        <button class="btn mt-2" onclick="location.reload()">Reload</button>`;
    }
  }

  function handleOauthFlash() {
    const params = new URLSearchParams(location.search);
    const err = params.get('oauth_error');
    const connected = params.get('connected');
    if (err) toast(`OAuth: ${err}`, 'error', 9000);
    if (connected) toast(`${connected === 'blogger' ? 'Blogger' : 'Pinterest'} connected successfully.`, 'success');
    if (params.get('login') === 'required') toast('Sign in to connect an integration.', 'warn');
    if (err || connected || params.has('login')) {
      history.replaceState(null, '', `${location.pathname}#connections`);
      go('connections');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  async function boot() {
    try {
      const data = await api('/api/bootstrap');
      state.boot = data;
      if (!data.authenticated) {
        $('#boot').classList.add('hidden');
        renderAuth({ setupRequired: data.setupRequired });
        return;
      }
      await enterApp();
    } catch (err) {
      $('#boot').innerHTML = `
        <div class="banner error" style="max-width:460px">${icon('alert')}<span>${esc(err.message)}</span></div>
        <button class="btn mt-2" onclick="location.reload()">Retry</button>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildNav();
    $('#menuBtn')?.addEventListener('click', openNav);
    $('#sidebarClose')?.addEventListener('click', closeNav);
    $('#navScrim')?.addEventListener('click', closeNav);
    $('#quickNew')?.addEventListener('click', () => go('create'));
    $('#quickPostNow')?.addEventListener('click', quickPostNow);
    $('#logoutBtn')?.addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch { /* session may already be gone */ }
      location.href = '/';
    });
    $('#autoPill')?.addEventListener('click', async () => {
      if (!state.settings) return go('automation');
      const enabled = !state.settings.automation?.enabled;
      try {
        const res = await api('/api/automation/toggle', { method: 'POST', body: { enabled } });
        state.settings.automation.enabled = res.enabled;
        applyBranding();
        toast(enabled ? 'Automation enabled.' : 'Automation paused.', enabled ? 'success' : 'info');
        if (state.view === 'dashboard' || state.view === 'automation') renderView();
      } catch (err) { toast(err.message, 'error'); }
    });
    window.addEventListener('hashchange', () => {
      const view = location.hash.slice(1);
      if (state.session?.authenticated && view && view !== state.view) {
        state.view = view;
        syncNav();
        renderView();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlays = $$('.modal-overlay');
        if (overlays.length) overlays[overlays.length - 1]._close?.();
      }
    });
    boot();
  });

  async function quickPostNow() {
    if (!state.settings) return;
    const c = state.connections || {};
    const blockers = [];
    if (!c.gemini?.configured) blockers.push('Gemini API key is not configured.');
    if (!state.settings.automation?.autoBlogger && !state.settings.automation?.autoPinterest) blockers.push('Automation has no publishing destination enabled.');
    const confirmed = await confirmDialog({
      title: 'Generate and publish now?',
      message: blockers.length
        ? `This run will create a new AI post and try to publish it. Note: ${blockers.join(' ')} You can still generate the content and publish later.`
        : 'This immediately generates a fresh recipe, photograph, nutrition table and SEO metadata, then publishes to your configured platforms. It counts toward today’s automation limit.',
      confirmLabel: 'Run now',
    });
    if (!confirmed) return;
    const done = busy('Running the studio…', 'Topic → image → recipe → nutrition → SEO → publish');
    try {
      const res = await api('/api/automation/run', { method: 'POST', body: { mode: 'full' } });
      await refreshCore();
      done();
      if (res?.error) {
        toast(res.error, 'error', 9000);
        return;
      }
      if (res?.post) {
        toast(`“${res.post.title || res.post.topic}” ${res.published ? 'published' : 'generated'}.`, 'success', 7000);
        openPostDetail(res.post.id);
      } else if (res?.skipped) {
        toast(res.skipped, 'info', 7000);
      } else {
        toast('Automation tick finished.', 'success');
      }
      if (state.view === 'dashboard' || state.view === 'history' || state.view === 'automation') renderView();
    } catch (err) {
      done();
      toast(err.message, 'error', 9000);
    }
  }

  /* ================================================================ */
  /* DASHBOARD                                                        */
  /* ================================================================ */

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function nextRunLabel(nextRun) {
    if (!nextRun) return 'Automation is paused';
    const when = nextRun.timestamp ? new Date(nextRun.timestamp) : null;
    if (!when || Number.isNaN(when.getTime())) return `${nextRun.date} at ${nextRun.time}`;
    const diff = when.getTime() - Date.now();
    if (diff < 0) return 'Due now';
    if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))} min`;
    if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)} h`;
    return `${fmtDate(when.toISOString())} at ${nextRun.time}`;
  }

  function checkItem(ok, title, detail, action, actionLabel) {
    return `<div class="recent-item">
      <span class="activity-dot ${ok ? 'ok' : 'warn'}" style="margin-top:6px"></span>
      <div class="grow">
        <strong>${esc(title)}</strong>
        <small>${esc(detail)}</small>
      </div>
      ${ok ? '<span class="badge b-green">Ready</span>'
        : `<button class="btn sm" data-goto="${esc(action)}">${esc(actionLabel)}</button>`}
    </div>`;
  }

  async function renderDashboard(root) {
    root.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading your studio…</span></div>`;
    let dash;
    try {
      dash = await api('/api/dashboard');
      state.dashboard = dash;
      state.notifications = dash.stats?.failed || 0;
      const active = $$('.nav-link').find((b) => b.dataset.view === 'history');
      if (active) {
        active.querySelector('.nav-badge')?.remove();
        if (state.notifications) active.insertAdjacentHTML('beforeend', `<span class="nav-badge">${state.notifications}</span>`);
      }
    } catch (err) {
      root.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
      return;
    }

    const s = dash.stats || {};
    const a = dash.automation || {};
    const settings = state.settings || {};
    const c = state.connections || {};
    const recent = dash.recentPosts || [];
    const logs = dash.recentLogs || [];
    const publishedTotal = (s.published || 0) + (s.partiallyPublished || 0);
    const attention = (s.failed || 0) + (s.pendingErrors || 0);
    const setupDone = Boolean(settings.setup?.completed);
    const essential = [
      { ok: c.gemini?.configured, label: 'Gemini API' },
      { ok: c.google?.connected, label: 'Blogger' },
      { ok: c.pinterest?.connected, label: 'Pinterest' },
      { ok: c.cloudinary?.configured, label: 'Cloudinary' },
    ];
    const missing = essential.filter((e) => !e.ok);

    root.innerHTML = `
      <div class="stack" style="gap:18px">
        <section class="hero">
          <div class="hero-copy">
            <span class="eyebrow">${esc(settings.siteName || 'Nourish Studio')} · ${esc(settings.timezone || 'Asia/Dhaka')}</span>
            <h2>${greeting()}, ${esc(state.session?.user?.username || 'chef')}.</h2>
            <p>${a.enabled
              ? `Your studio is generating <strong>${a.postsPerDay || 1} post${(a.postsPerDay || 1) === 1 ? '' : 's'}</strong> per day. Next run ${esc(nextRunLabel(a.nextRun))}.`
              : 'Automation is paused right now. Turn it on to let the studio write, illustrate and publish on a schedule.'}</p>
            <div class="hero-actions">
              <button class="btn primary" data-act="new">${icon('sparkles')} Create a post</button>
              <button class="btn" data-act="run">${icon('zap')} Generate now</button>
              ${a.enabled ? '' : `<button class="btn ghost" data-act="enable">${icon('play')} Enable automation</button>`}
            </div>
          </div>
          <div class="hero-art" aria-hidden="true">
            <svg viewBox="0 0 160 160" fill="none">
              <circle cx="80" cy="80" r="70" stroke="rgba(199,244,100,.16)" stroke-width="1.4"/>
              <circle cx="80" cy="80" r="52" stroke="rgba(199,244,100,.1)" stroke-width="1.4"/>
              <path d="M80 34c24 10 33 29 27 54-24 5-50-9-56-33 5-10 14-17 29-21z" fill="rgba(199,244,100,.14)" stroke="rgba(199,244,100,.5)" stroke-width="1.6"/>
              <path d="M80 126c-15-24-11-46 9-60" stroke="#c7f464" stroke-width="2.4" stroke-linecap="round"/>
              <circle cx="122" cy="44" r="3" fill="#c7f464"/>
              <circle cx="36" cy="112" r="2.4" fill="rgba(199,244,100,.6)"/>
            </svg>
          </div>
        </section>

        <section class="grid cols-4">
          <div class="stat">
            <div class="stat-top"><span class="stat-label">Total posts</span><span class="stat-icon">${icon('layers')}</span></div>
            <div class="stat-value">${fmtNum(s.totalPosts)}</div>
            <div class="stat-foot">${s.drafts || 0} drafts · ${s.scheduled || 0} scheduled</div>
          </div>
          <div class="stat accent">
            <div class="stat-top"><span class="stat-label">Published</span><span class="stat-icon">${icon('send')}</span></div>
            <div class="stat-value">${fmtNum(publishedTotal)}</div>
            <div class="stat-foot"><span class="up">${s.bloggerPublished || 0} Blogger</span> · ${s.pinterestPublished || 0} Pinterest</div>
          </div>
          <div class="stat">
            <div class="stat-top"><span class="stat-label">This month</span><span class="stat-icon">${icon('calendar')}</span></div>
            <div class="stat-value">${fmtNum(s.thisMonth)}</div>
            <div class="stat-foot">${s.today || 0} created today</div>
          </div>
          <div class="stat">
            <div class="stat-top"><span class="stat-label">Needs attention</span><span class="stat-icon">${icon(attention ? 'alert' : 'shield')}</span></div>
            <div class="stat-value">${fmtNum(attention)}</div>
            <div class="stat-foot">${attention ? 'Open history to retry failures' : 'No failures in the queue'}</div>
          </div>
        </section>

        ${missing.length && !setupDone ? `
        <section class="card">
          <div class="card-head">
            <div class="grow"><h3>Finish connecting your studio</h3><div class="sub">${missing.length} of 4 integrations still need attention.</div></div>
            <button class="btn sm" data-goto="connections">Open connections</button>
          </div>
          ${checkItem(c.gemini?.configured, 'Gemini API key', c.gemini?.configured ? 'Configured and ready for text, vision and image models.' : 'Needed for topics, recipes, SEO and food photography.', 'connections', 'Add key')}
          ${checkItem(c.google?.connected, 'Blogger (Google OAuth)', c.google?.connected ? `Connected${c.google?.defaultBlogName ? ` · ${c.google.defaultBlogName}` : ''}` : 'Publish articles with the official Blogger API v3.', 'connections', 'Connect')}
          ${checkItem(c.pinterest?.connected, 'Pinterest (OAuth)', c.pinterest?.connected ? `Connected${c.pinterest?.username ? ` · @${c.pinterest.username}` : ''}` : 'Create Pins that link to your live Blogger article.', 'connections', 'Connect')}
          ${checkItem(c.cloudinary?.configured, 'Cloudinary', c.cloudinary?.configured ? 'Public image hosting is ready for Pinterest.' : 'Pinterest needs a public https image URL.', 'connections', 'Configure')}
        </section>` : ''}

        <section class="run-panel">
          <div class="card">
            <div class="card-head">
              <div class="grow"><h3>Automation</h3><div class="sub">Server-side schedule · ${esc(a.timezone || 'Asia/Dhaka')}</div></div>
              <span class="badge ${a.enabled ? 'b-green' : 'b-gray'}">${a.enabled ? 'Active' : 'Paused'}</span>
            </div>
            <div class="card-body">
              <div class="automation-state">
                <div class="state-orb ${a.enabled ? 'on' : ''}">${icon('repeat')}</div>
                <div class="grow">
                  <strong style="font-size:13.5px">${a.enabled ? 'Studio is on autopilot' : 'Studio is paused'}</strong>
                  <p class="small muted" style="margin-top:2px">${a.enabled
                    ? `Next run ${esc(nextRunLabel(a.nextRun))}${a.manualApproval ? ' · manual approval is on' : ''}`
                    : 'Posts will not be generated automatically until you enable it.'}</p>
                </div>
                <button class="switch ${a.enabled ? 'on' : ''}" data-act="toggle-auto" role="switch" aria-checked="${a.enabled}" aria-label="Toggle automation"></button>
              </div>
              <div class="metric-row">
                <div class="metric"><strong>${a.todayCount || 0}<span class="dim" style="font-size:11px"> / ${a.postsPerDay || 1}</span></strong><span>Today</span></div>
                <div class="metric"><strong>${esc((a.times || []).join(', ') || '09:00')}</strong><span>Slots</span></div>
                <div class="metric"><strong>${a.lastRun ? esc(relTime(a.lastRun.finishedAt)) : '—'}</strong><span>Last run</span></div>
                <div class="metric"><strong>${a.manualApproval ? 'Manual' : 'Auto'}</strong><span>Approval</span></div>
              </div>
              <div class="row mt-3">
                <button class="btn primary sm" data-act="run">${icon('zap')} Run now</button>
                <button class="btn sm" data-goto="automation">${icon('settings')} Configure</button>
                <button class="btn ghost sm" data-goto="scheduled">${icon('calendar')} Queue</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div class="grow"><h3>Integrations</h3><div class="sub">Live status from the server</div></div>
              <button class="btn sm ghost" data-goto="connections">${icon('plug')} Manage</button>
            </div>
            <div class="card-body">
              <div class="conn-strip">
                ${[
                  ['Gemini', c.gemini?.configured, 'gemini'],
                  ['Blogger', c.google?.connected, c.google?.configured ? 'warn' : ''],
                  ['Pinterest', c.pinterest?.connected, c.pinterest?.configured ? 'warn' : ''],
                  ['Cloudinary', c.cloudinary?.configured, 'cloudinary'],
                  ['Nutrition', c.nutrition?.configured, 'nutrition'],
                ].map(([name, ok, stateCls]) => `<button class="conn-chip" data-goto="connections">
                  <span class="dot ${ok ? 'ok' : stateCls === 'warn' ? 'warn' : ''}"></span>${esc(name)}
                  <span class="dim" style="font-size:10px">${ok ? 'ready' : stateCls === 'warn' ? 'app set' : 'missing'}</span>
                </button>`).join('')}
              </div>
              <hr class="divider" />
              <div class="between" style="font-size:12px">
                <span class="muted">Database</span>
                <span class="mono" style="color:#a9bcae">${esc(state.envHints?.database || '—')}</span>
              </div>
              <div class="between mt-2" style="font-size:12px">
                <span class="muted">Cron secret</span>
                <span class="badge ${state.envHints?.hasCronSecret ? 'b-green' : 'b-amber'}">${state.envHints?.hasCronSecret ? 'Configured' : 'Not set'}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="split" style="grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)">
          <div class="card">
            <div class="card-head">
              <div class="grow"><h3>Recent posts</h3><div class="sub">Latest generated content</div></div>
              <button class="btn sm ghost" data-goto="history">View all ${icon('right')}</button>
            </div>
            ${recent.length ? `<div class="recent-list">${recent.map((p) => `
              <button class="recent-item" data-post="${attr(p.id)}" style="width:100%;background:none;border:0;border-top:1px solid var(--border);color:inherit;text-align:left;cursor:pointer">
                ${imgFor(p)
                  ? `<img class="thumb" src="${attr(imgFor(p))}" alt="" loading="lazy" />`
                  : `<span class="thumb placeholder">${icon('image')}</span>`}
                <div class="grow">
                  <strong>${esc(p.title || p.topic)}</strong>
                  <small>${esc(p.category || 'Recipe')} · ${esc(relTime(p.createdAt))}</small>
                </div>
                <div class="row" style="gap:4px">${statusBadge(p.status)}</div>
              </button>`).join('')}</div>`
              : `<div class="empty" style="padding:34px 20px">
                  <div class="empty-icon">${icon('sparkles')}</div>
                  <h3>No posts yet</h3>
                  <p>Create your first recipe and the studio will handle the photograph, nutrition table and article.</p>
                  <button class="btn primary sm" data-act="new">${icon('plus')} Create a post</button>
                </div>`}
          </div>

          <div class="card">
            <div class="card-head">
              <div class="grow"><h3>Activity</h3><div class="sub">Real server events</div></div>
              <button class="btn sm ghost" data-goto="logs">Logs ${icon('right')}</button>
            </div>
            ${logs.length ? `<div>${logs.map((l) => `
              <div class="activity-item">
                <span class="activity-dot ${l.level === 'success' ? 'ok' : l.level === 'error' ? 'err' : l.level === 'warning' ? 'warn' : ''}"></span>
                <div class="grow">
                  <p>${esc(l.message)}</p>
                  <small>${esc(l.service || 'app')}${l.operation ? ` · ${esc(l.operation)}` : ''} · ${esc(relTime(l.created_at))}</small>
                </div>
              </div>`).join('')}</div>`
              : `<div class="empty" style="padding:34px 20px"><p>Activity will appear here as soon as the studio does something.</p></div>`}
          </div>
        </section>
      </div>`;

    root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
    root.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', () => openPostDetail(b.dataset.post)));
    $('[data-act="new"]', root)?.addEventListener('click', () => go('create'));
    $('[data-act="run"]', root)?.addEventListener('click', quickPostNow);
    $('[data-act="enable"]', root)?.addEventListener('click', async () => {
      try {
        await api('/api/automation/toggle', { method: 'POST', body: { enabled: true } });
        toast('Automation enabled.', 'success');
        await refreshCore();
        if (state.view === 'dashboard') renderView();
      } catch (err) { toast(err.message, 'error'); }
    });
    $('[data-act="toggle-auto"]', root)?.addEventListener('click', async () => {
      try {
        const res = await api('/api/automation/toggle', { method: 'POST', body: { enabled: !a.enabled } });
        state.settings.automation.enabled = res.enabled;
        applyBranding();
        if (state.view === 'dashboard') await renderDashboard(root);
        toast(res.enabled ? 'Automation enabled.' : 'Automation paused.', res.enabled ? 'success' : 'info');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ================================================================ */
  /* FIRST-RUN SETUP WIZARD                                           */
  /* ================================================================ */

  function openSetupWizard(initialStep = 0) {
    const total = 4;
    let step = Math.min(initialStep, total - 1);
    let lastTest = null;

    const m = openModal({
      title: '',
      size: '',
      closeable: false,
      body: '<div id="wizardRoot"></div>',
    });
    const modal = m.overlay.querySelector('.modal');
    modal.classList.add('wizard');
    modal.style.maxWidth = '720px';
    modal.querySelector('.modal-head').style.display = 'none';
    modal.querySelector('.modal-body').style.padding = '0';

    const rootEl = $('#wizardRoot', m.overlay);

    function stepsBar() {
      const labels = ['Brand', 'Gemini', 'Accounts', 'Schedule'];
      return `<div class="wizard-steps">${labels.map((l, i) => `
        <div class="wstep ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}">
          <span class="num">${i < step ? '✓' : i + 1}</span>${l}
        </div>`).join('')}</div>`;
    }

    function renderStep() {
      const settings = state.settings || {};
      const a = settings.automation || {};
      const c = state.connections || {};
      let body = '';
      if (step === 0) {
        body = `
          <h3>Welcome aboard</h3>
          <p>Let’s set the identity and defaults for your content studio. You can change everything later in Settings.</p>
          <div class="form-grid">
            <div class="field span-2">
              <label>Studio name</label>
              <input type="text" id="wSite" maxlength="80" value="${attr(settings.siteName || 'Nourish Studio')}" />
            </div>
            <div class="field span-2">
              <label>Tagline</label>
              <input type="text" id="wTag" maxlength="120" value="${attr(settings.tagline || '')}" placeholder="Healthy recipes, made simple" />
            </div>
            <div class="field">
              <label>Timezone</label>
              <select id="wTz">${(state.meta.timezones || ['Asia/Dhaka']).map((tz) => `<option ${tz === settings.timezone ? 'selected' : ''}>${esc(tz)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Niche</label>
              <input type="text" id="wNiche" maxlength="160" value="${attr(settings.niche || 'healthy high-protein food')}" />
            </div>
          </div>`;
      } else if (step === 1) {
        body = `
          <h3>Connect Gemini</h3>
          <p>Gemini writes recipes, SEO metadata and generates the food photograph. Add a key from Google AI Studio — it is encrypted before it is stored.</p>
          <div class="field mb-2">
            <label>API key</label>
            <input type="password" id="wGemini" placeholder="${c.gemini?.configured ? esc(c.gemini.keyMasked || '••••••••') : 'AIza…'}" autocomplete="off" spellcheck="false" />
            <span class="hint">${c.gemini?.configured ? 'A key is already saved. Leave blank to keep it.' : 'Create one at aistudio.google.com/apikey.'}</span>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Text model</label>
              <input type="text" id="wTextModel" value="${attr(c.gemini?.textModel || 'gemini-3.8-flash')}" />
            </div>
            <div class="field">
              <label>Image model</label>
              <input type="text" id="wImageModel" value="${attr(c.gemini?.imageModel || 'gemini-3.1-flash-image')}" />
            </div>
          </div>
          <div class="row mt-3">
            <button class="btn sm" id="wGeminiTest">${icon('zap')} Test connection</button>
            <span class="hint">Optional — you can test later in API Connections.</span>
          </div>
          <div id="wGeminiResult" class="mt-2"></div>`;
      } else if (step === 2) {
        body = `
          <h3>Connect your accounts</h3>
          <p>Publishing uses official OAuth apps. You can connect now or skip and return later — the studio clearly flags anything missing.</p>
          <div class="stack" style="gap:10px">
            <div class="switch-row">
              <div class="conn-logo blogger">${icon('globe')}</div>
              <div class="grow"><strong>Blogger</strong><small>${c.google?.connected ? `Connected${c.google.defaultBlogName ? ` · ${esc(c.google.defaultBlogName)}` : ''}` : 'Requires a Google OAuth client with the Blogger API enabled.'}</small></div>
              ${c.google?.connected ? '<span class="badge b-green">Connected</span>' : `<button class="btn sm" id="wGoogle">Connect</button>`}
            </div>
            <div class="switch-row">
              <div class="conn-logo pinterest">${icon('pin')}</div>
              <div class="grow"><strong>Pinterest</strong><small>${c.pinterest?.connected ? `Connected${c.pinterest.username ? ` · @${esc(c.pinterest.username)}` : ''}` : 'Requires a Pinterest app with boards and pins scopes.'}</small></div>
              ${c.pinterest?.connected ? '<span class="badge b-green">Connected</span>' : `<button class="btn sm" id="wPinterest">Connect</button>`}
            </div>
            <div class="switch-row">
              <div class="conn-logo cloudinary">${icon('cloud')}</div>
              <div class="grow"><strong>Cloudinary</strong><small>${c.cloudinary?.configured ? 'Configured — public image URLs are ready.' : 'Needed for Pinterest, which requires a public https image.'}</small></div>
              ${c.cloudinary?.configured ? '<span class="badge b-green">Ready</span>' : `<button class="btn sm" id="wCloudinary">Configure</button>`}
            </div>
          </div>
          <div class="banner info mt-3">${icon('info')}<span>OAuth opens a new page. If you navigate away, the wizard resumes on your next visit.</span></div>`;
      } else {
        body = `
          <h3>Set the publishing rhythm</h3>
          <p>Pick a realistic cadence. The Render cron worker checks these slots server-side, so it keeps running even if the dashboard is asleep.</p>
          <div class="form-grid">
            <div class="field">
              <label>Posts per day</label>
              <input type="number" id="wPerDay" min="1" max="20" value="${Number(a.postsPerDay) || 1}" />
            </div>
            <div class="field">
              <label>First posting time</label>
              <input type="time" id="wTime" value="${attr((a.times || ['09:00'])[0] || '09:00')}" />
            </div>
          </div>
          <div class="stack mt-3" style="gap:8px">
            <div class="switch-row">
              <div class="grow"><strong>Publish to Blogger automatically</strong><small>Creates the article with recipe schema.</small></div>
              <button class="switch ${a.autoBlogger !== false ? 'on' : ''}" data-wtoggle="autoBlogger" role="switch"></button>
            </div>
            <div class="switch-row">
              <div class="grow"><strong>Create the Pinterest Pin</strong><small>Only runs after a live Blogger URL exists.</small></div>
              <button class="switch ${a.autoPinterest !== false ? 'on' : ''}" data-wtoggle="autoPinterest" role="switch"></button>
            </div>
            <div class="switch-row">
              <div class="grow"><strong>Require manual approval</strong><small>Generate content as drafts; publish yourself.</small></div>
              <button class="switch ${a.manualApproval ? 'on' : ''}" data-wtoggle="manualApproval" role="switch"></button>
            </div>
          </div>
          <div class="banner warn mt-3">${icon('alert')}<span>Automation stays paused until you switch it on after finishing.</span></div>`;
      }

      rootEl.innerHTML = `
        <div class="wizard-head">
          <div class="between">
            <div>
              <span class="eyebrow">Setup · step ${step + 1} of ${total}</span>
              <h2>${step === 0 ? 'Make it yours' : step === 1 ? 'Add the intelligence' : step === 2 ? 'Link publishing' : 'Choose a rhythm'}</h2>
            </div>
            <span class="pill">${icon('shield')} Self-hosted</span>
          </div>
          <div class="wizard-progress"><div style="width:${((step + 1) / total) * 100}%"></div></div>
        </div>
        ${stepsBar()}
        <div class="wizard-body">${body}</div>
        <div class="wizard-foot">
          <div class="left">${step > 0 ? `<button class="btn ghost sm" id="wBack">${icon('left')} Back</button>` : `<button class="btn ghost sm" id="wSkipAll">Skip setup</button>`}</div>
          ${step < total - 1
            ? `<button class="btn primary" id="wNext">Continue ${icon('right')}</button>`
            : `<button class="btn primary" id="wFinish">${icon('check')} Finish setup</button>`}
        </div>`;

      // local toggle state (read from DOM switches at save time)
      rootEl.querySelectorAll('[data-wtoggle]').forEach((sw) => sw.addEventListener('click', () => sw.classList.toggle('on')));

      $('#wBack', rootEl)?.addEventListener('click', () => { step = Math.max(0, step - 1); renderStep(); });
      $('#wSkipAll', rootEl)?.addEventListener('click', async () => { await finishWizard(false); });
      $('#wNext', rootEl)?.addEventListener('click', async () => {
        try {
          await saveWizardStep(step);
          step++;
          renderStep();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#wFinish', rootEl)?.addEventListener('click', async () => {
        try {
          await saveWizardStep(step);
          await finishWizard(true);
        } catch (err) { toast(err.message, 'error'); }
      });

      $('#wGeminiTest', rootEl)?.addEventListener('click', async () => {
        const key = $('#wGemini', rootEl).value.trim();
        const btn = $('#wGeminiTest', rootEl);
        btn.disabled = true;
        $('#wGeminiResult', rootEl).innerHTML = `<div class="banner info">${icon('info')}<span>Testing…</span></div>`;
        try {
          if (key) await api('/api/connections/gemini', { method: 'PUT', body: { apiKey: key } });
          const res = await api('/api/connections/gemini/test', { method: 'POST', body: {} });
          $('#wGeminiResult', rootEl).innerHTML = `<div class="banner ${res.ok ? 'success' : 'error'}">${icon(res.ok ? 'check' : 'alert')}<span>${esc(res.message)}</span></div>`;
        } catch (err) {
          $('#wGeminiResult', rootEl).innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
        } finally { btn.disabled = false; }
      });

      $('#wGoogle', rootEl)?.addEventListener('click', () => { saveWizardStep(step).finally(() => { window.location.href = '/auth/google'; }); });
      $('#wPinterest', rootEl)?.addEventListener('click', () => { saveWizardStep(step).finally(() => { window.location.href = '/auth/pinterest'; }); });
      $('#wCloudinary', rootEl)?.addEventListener('click', () => { m.close(); go('connections'); });
    }

    async function saveWizardStep(s) {
      if (s === 0) {
        const patch = {
          siteName: $('#wSite', rootEl).value.trim() || 'Nourish Studio',
          tagline: $('#wTag', rootEl).value.trim(),
          timezone: $('#wTz', rootEl).value,
          niche: $('#wNiche', rootEl).value.trim(),
        };
        const res = await api('/api/settings', { method: 'PUT', body: patch });
        state.settings = res.settings;
      } else if (s === 1) {
        const key = $('#wGemini', rootEl).value.trim();
        const textModel = $('#wTextModel', rootEl).value.trim();
        const imageModel = $('#wImageModel', rootEl).value.trim();
        if (key || textModel || imageModel) {
          await api('/api/connections/gemini', { method: 'PUT', body: { ...(key ? { apiKey: key } : {}), textModel, imageModel } });
        }
        state.connections = (await api('/api/connections')).connections;
      } else if (s === 2) {
        state.connections = (await api('/api/connections')).connections;
      } else if (s === 3) {
        const autoBlogger = rootEl.querySelector('[data-wtoggle="autoBlogger"]').classList.contains('on');
        const autoPinterest = rootEl.querySelector('[data-wtoggle="autoPinterest"]').classList.contains('on');
        const manualApproval = rootEl.querySelector('[data-wtoggle="manualApproval"]').classList.contains('on');
        const res = await api('/api/settings', {
          method: 'PUT',
          body: {
            automation: {
              postsPerDay: Math.max(1, Math.min(20, Number($('#wPerDay', rootEl).value) || 1)),
              times: [$('#wTime', rootEl).value || '09:00'],
              autoBlogger, autoPinterest, manualApproval,
            },
          },
        });
        state.settings = res.settings;
      }
    }

    async function finishWizard(enable = true) {
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: { setup: { completed: true, step: total } },
        });
        state.settings = res.settings;
        if (enable) {
          // only enable if at least Gemini is configured, otherwise the welcome note explains it
          const conn = await api('/api/connections');
          state.connections = conn.connections;
          if (state.connections?.gemini?.configured) {
            const on = await api('/api/automation/toggle', { method: 'POST', body: { enabled: true } });
            state.settings.automation.enabled = on.enabled;
          } else {
            await api('/api/settings', { method: 'PUT', body: { setup: { completed: true, step: total } } });
          }
        }
        m.close();
        await refreshCore();
        applyBranding();
        go('dashboard');
        toast(enable ? 'Setup complete. Welcome to Nourish Studio.' : 'Setup saved — you can finish any time.', 'success', 6000);
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    renderStep();
  }

  /* ================================================================ */
  /* SHARED POST ACTIONS                                              */
  /* ================================================================ */

  async function publishFlow(post, platforms) {
    const c = state.connections || {};
    if (platforms.includes('blogger') && !state.settings?.blogger?.defaultBlogId) {
      const wants = await confirmDialog({
        title: 'No Blogger blog selected',
        message: 'Open API Connections and choose the destination blog first. Publish this post as a Blogger draft anyway?',
        confirmLabel: 'Open connections',
      });
      if (wants) go('connections');
      return;
    }
    if (platforms.includes('pinterest') && !c.cloudinary?.configured) {
      const proceed = await confirmDialog({
        title: 'Pinterest needs a public image',
        message: 'Cloudinary is not configured, so the generated image only exists on this server. Pinterest will reject a non-public URL. Continue anyway and see the exact provider error?',
        confirmLabel: 'Try anyway',
      });
      if (!proceed) return;
    }
    if (platforms.includes('pinterest') && platforms.length === 1 && !post.bloggerUrl && !state.settings?.publishing?.allowPinterestWithoutBlogger) {
      toast('Pinterest is blocked until the Blogger article URL exists. Publish to Blogger first.', 'warn', 7000);
      return;
    }

    const label = platforms.length === 2 ? 'Blogger + Pinterest' : platforms[0] === 'blogger' ? 'Blogger' : 'Pinterest';
    const ok = await confirmDialog({
      title: `Publish to ${label}?`,
      message: `“${post.title || post.topic}” will be published to ${label}. Existing articles and pins are updated/skipped rather than duplicated.`,
      confirmLabel: 'Publish now',
    });
    if (!ok) return;

    const done = busy(`Publishing to ${label}…`, 'Talking to the official APIs');
    try {
      const res = await api(`/api/posts/${post.id}/publish`, {
        method: 'POST',
        body: { platforms },
      });
      done();
      const fresh = res.post;
      if (res.errors?.length) {
        toast(res.errors.map((e) => `${e.platform}: ${e.error}`).join(' · '), 'error', 12_000);
      } else {
        toast(`Published to ${label}.`, 'success', 6000);
      }
      await refreshCore().catch(() => {});
      if (state.view === 'history' || state.view === 'dashboard') renderView();
      if (state.studio?.post?.id === fresh?.id) { state.studio.post = fresh; renderStudioPreview(); }
      return fresh;
    } catch (err) {
      done();
      toast(err.message, 'error', 12_000);
      return null;
    }
  }

  function scheduleModal(post) {
    const now = new Date(Date.now() + 60 * 60_000);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const m = openModal({
      title: 'Schedule publishing',
      subtitle: post.title || post.topic,
      body: `
        <div class="field mb-2">
          <label>Date &amp; time <span class="dim">(your browser timezone)</span></label>
          <input type="datetime-local" id="schedWhen" value="${local}" />
        </div>
        <div class="field mb-2">
          <label>Destinations</label>
          <div class="row" style="gap:14px">
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="schedBlogger" checked /> Blogger</label>
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="schedPinterest" checked ${post.bloggerUrl ? '' : ''}/> Pinterest</label>
          </div>
          <span class="hint">Pinterest requires a live Blogger URL. If it is not published yet, include Blogger above and it will run first.</span>
        </div>
        <div class="field">
          <label>Note <span class="dim">(optional)</span></label>
          <input type="text" id="schedNote" maxlength="300" placeholder="e.g. Tuesday high-protein slot" />
        </div>`,
      footer: `<button class="btn ghost" data-act="cancel">Cancel</button>
               <button class="btn primary" data-act="save">${icon('calendarPlus')} Schedule</button>`,
    });
    $('[data-act="cancel"]', m.overlay).addEventListener('click', m.close);
    $('[data-act="save"]', m.overlay).addEventListener('click', async () => {
      const when = $('#schedWhen', m.overlay).value;
      const destinations = [];
      if ($('#schedBlogger', m.overlay).checked) destinations.push('blogger');
      if ($('#schedPinterest', m.overlay).checked) destinations.push('pinterest');
      if (!when) return toast('Choose a date and time.', 'warn');
      if (!destinations.length) return toast('Choose at least one destination.', 'warn');
      if (destinations.includes('pinterest') && !destinations.includes('blogger') && !post.bloggerUrl) {
        return toast('Pinterest needs the Blogger URL first. Include Blogger in this schedule.', 'warn', 6000);
      }
      try {
        await api('/api/scheduled', {
          method: 'POST',
          body: {
            postId: post.id,
            scheduledAt: new Date(when).toISOString(),
            destinations,
            note: $('#schedNote', m.overlay).value.trim(),
          },
        });
        m.close();
        toast('Post scheduled.', 'success');
        await refreshCore().catch(() => {});
        if (state.view === 'scheduled' || state.view === 'history') renderView();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function seoBlock(post) {
    const seo = post.recipe?.seo || {};
    return `<div class="field mb-2">
        <label>SEO title <span class="dim">(${esc(String(post.seoTitle || '').length)}/70)</span></label>
        <input type="text" data-edit="seoTitle" maxlength="70" value="${attr(post.seoTitle)}" />
      </div>
      <div class="field mb-2">
        <label>Meta description <span class="dim">(${esc(String(post.description || '').length)}/200)</span></label>
        <textarea data-edit="description" maxlength="300" rows="3">${esc(post.description)}</textarea>
      </div>
      <div class="field mb-2">
        <label>Image alt text</label>
        <input type="text" data-edit="imageAlt" maxlength="300" value="${attr(post.imageAlt)}" />
      </div>
      <div class="grid cols-2">
        <div class="field">
          <label>Pinterest title</label>
          <input type="text" data-edit="pinterestTitle" maxlength="100" value="${attr(post.pinterestTitle)}" />
        </div>
        <div class="field">
          <label>Pinterest tags <span class="dim">(comma separated)</span></label>
          <input type="text" data-edit="pinterestTags" value="${attr((post.pinterestTags || []).join(', '))}" />
        </div>
      </div>
      <div class="field mt-2">
        <label>Pinterest description</label>
        <textarea data-edit="pinterestDescription" maxlength="500" rows="3">${esc(post.pinterestDescription)}</textarea>
      </div>
      <div class="row mt-2" style="gap:6px">
        ${(seo.keywords || post.recipe?.keywords || []).slice(0, 12).map((k) => `<span class="tag">${esc(k)}</span>`).join('') || '<span class="hint">No keywords generated yet.</span>'}
      </div>`;
  }

  function recipeBlock(post) {
    const r = post.recipe;
    if (!r) return `<div class="empty" style="padding:30px"><p>No recipe generated yet. Run the recipe stage first.</p></div>`;
    return `<h3>${esc(r.title)}</h3>
      <p class="muted small">${esc(r.description || '')}</p>
      <div class="meta-grid mt-2">
        <div><span>Prep</span><br />${esc(r.prep_time_minutes)} min</div>
        <div><span>Cook</span><br />${esc(r.cook_time_minutes)} min</div>
        <div><span>Total</span><br />${esc(r.total_time_minutes)} min</div>
        <div><span>Servings</span><br />${esc(r.servings)}</div>
        <div><span>Difficulty</span><br />${esc(r.difficulty)}</div>
        <div><span>Category</span><br />${esc(r.category)}</div>
      </div>
      <h4>Ingredients</h4>
      <ul>${(r.ingredients || []).map((i) => `<li>${esc(`${i.quantity ?? ''} ${i.unit || ''}`.trim())} ${esc(i.item)}${i.notes ? ` <em>(${esc(i.notes)})</em>` : ''}</li>`).join('')}</ul>
      <h4>Instructions</h4>
      <ol>${(r.instructions || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${(r.tips || []).length ? `<h4>Tips</h4><ul>${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${r.storage ? `<h4>Storage</h4><p>${esc(r.storage)}</p>` : ''}
      ${r.meal_prep ? `<h4>Meal prep</h4><p>${esc(r.meal_prep)}</p>` : ''}
      ${(r.substitutions || []).length ? `<h4>Substitutions</h4><ul>${r.substitutions.map((s) => `<li><strong>${esc(s.original)}</strong> → ${esc(s.alternative)}${s.note ? ` — ${esc(s.note)}` : ''}</li>`).join('')}</ul>` : ''}
      ${(r.faq || []).length ? `<h4>FAQ</h4>${r.faq.map((f) => `<p><strong>${esc(f.question)}</strong><br />${esc(f.answer)}</p>`).join('')}` : ''}
      ${r.conclusion ? `<h4>Conclusion</h4><p>${esc(r.conclusion)}</p>` : ''}`;
  }

  function nutritionBlock(post) {
    const n = post.nutrition;
    if (!n) return `<div class="empty" style="padding:30px"><p>Nutrition has not been calculated. It is derived from ingredient quantities, not from the photo.</p></div>`;
    const rows = [
      ['Calories', 'calories', 'kcal'], ['Protein', 'protein', 'g'], ['Carbohydrates', 'carbs', 'g'],
      ['Fat', 'fat', 'g'], ['Saturated fat', 'satfat', 'g'], ['Fiber', 'fiber', 'g'],
      ['Sugar', 'sugar', 'g'], ['Sodium', 'sodium', 'mg'],
    ];
    return `<div class="between mb-2">
        <div><h3 style="margin-bottom:2px">Nutrition</h3><p class="small muted">Per serving · ${esc(n.perServing?.calories ?? '—')} kcal</p></div>
        <span class="badge ${n.confidence === 'high' ? 'b-green' : n.confidence === 'medium' ? 'b-amber' : 'b-red'}">${esc(n.confidence || 'estimate')}</span>
      </div>
      <table class="nutrition-table">
        <thead><tr><th>Nutrient</th><th>Per serving</th><th>Whole recipe</th></tr></thead>
        <tbody>${rows.map(([label, key, unit]) => `<tr><td>${label}</td><td>${esc(n.perServing?.[key] ?? '—')} ${unit}</td><td>${esc(n.total?.[key] ?? '—')} ${unit}</td></tr>`).join('')}</tbody>
      </table>
      <p class="hint mt-2">${esc(n.note || 'Estimated from ingredient quantities using a reference food dataset. Brand and preparation differences apply.')}</p>
      ${(n.unmatched || []).length ? `<div class="banner warn mt-2">${icon('alert')}<span>Unmatched ingredients: ${esc(n.unmatched.join(', '))}. Their contribution is not included.</span></div>` : ''}
      <details class="mt-2"><summary class="small muted" style="cursor:pointer">Ingredient match details</summary>
        <div class="mt-2" style="font-size:11.5px">${(n.ingredients || []).map((i) => `<div class="between" style="border-bottom:1px solid var(--border);padding:3px 0"><span>${esc(i.item || i.name)}</span><span class="mono">${i.matched ? esc(i.matched) : '<span class="dim">unmatched</span>'}</span></div>`).join('')}</div>
      </details>`;
  }

  function analysisBlock(post) {
    const a = post.imageAnalysis;
    if (!a) return `<div class="empty" style="padding:30px"><p>No vision analysis yet. Run the analyse stage to verify the photograph matches the recipe.</p></div>`;
    const entries = Object.entries(a).filter(([, v]) => v !== null && v !== undefined && v !== '');
    return `<h3>Vision analysis</h3><div class="mt-2" style="display:flex;flex-direction:column;gap:8px">
      ${entries.map(([k, v]) => `<div><span class="eyebrow">${esc(k.replace(/_/g, ' '))}</span>
        <div style="margin-top:2px">${Array.isArray(v) ? v.map((x) => `<span class="tag" style="margin:2px">${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join('') : esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div></div>`).join('')}
    </div>`;
  }

  function articleBlock(post) {
    return `<div class="between mb-2">
        <h3 style="margin:0">Blogger article</h3>
        <div class="row" style="gap:6px">
          <span class="badge ${post.bloggerUrl ? 'b-green' : 'b-gray'}">${post.bloggerUrl ? 'Published' : 'Not published'}</span>
          ${post.bloggerUrl ? `<a class="btn sm" href="${attr(post.bloggerUrl)}" target="_blank" rel="noopener">${icon('external')} Open</a>` : ''}
        </div>
      </div>
      ${post.bloggerContent
        ? `<div class="htmllint" style="max-height:340px;overflow:auto">${esc(post.bloggerContent)}</div>`
        : `<div class="empty" style="padding:30px"><p>The article HTML is built after the recipe and nutrition stages. Run “Build article”.</p></div>`}
      <div class="row mt-2">
        <span class="pill">${icon('pin')} ${post.pinterestUrl ? `<a href="${attr(post.pinterestUrl)}" target="_blank" rel="noopener">Pin created</a>` : 'Pin not created'}</span>
        <span class="pill">${icon('globe')} ${esc(post.language || 'English')}</span>
      </div>`;
  }

  function previewPane(post, tab) {
    if (!post) {
      return `<div class="empty" style="padding:30px">
        <div class="empty-icon">${icon('wand')}</div>
        <h3>Your preview appears here</h3>
        <p>Generate an image first, then build the recipe, nutrition and article. Every step is stored in the database.</p>
      </div>`;
    }
    if (tab === 'nutrition') return nutritionBlock(post);
    if (tab === 'seo') return seoBlock(post);
    if (tab === 'article') return articleBlock(post);
    if (tab === 'analysis') return analysisBlock(post);
    return recipeBlock(post);
  }

  async function openPostDetail(id) {
    let data;
    try {
      data = await withBusy('Loading post…', '', () => api(`/api/posts/${id}`));
    } catch (err) { toast(err.message, 'error'); return; }
    const post = data.post;
    let tab = 'recipe';
    let editing = false;

    const m = openModal({
      title: post.title || post.topic,
      subtitle: `${post.category || 'Recipe'} · ${fmtDateTime(post.createdAt)} · ${post.source === 'automation' ? 'automation' : 'manual'}`,
      size: 'xwide',
      body: `<div id="detailBody"></div>`,
    });

    function detailHtml() {
      const stage = post.stageStatus || {};
      const stageList = [
        ['image', 'Food photograph'], ['image_analysis', 'Vision check'], ['recipe', 'Recipe'],
        ['nutrition', 'Nutrition'], ['seo', 'SEO & Pinterest'], ['blogger_html', 'Article HTML'],
      ];
      return `<div class="confirm-grid" style="grid-template-columns:220px minmax(0,1fr);gap:20px">
        <div>
          ${imgFor(post)
            ? `<img class="confirm-img" src="${attr(imgFor(post))}" alt="${attr(post.imageAlt || post.title)}" />`
            : `<div class="confirm-img" style="display:grid;place-items:center;color:#4e6054">${icon('image')}</div>`}
          <div class="row mt-2" style="gap:5px">
            ${statusBadge(post.status)}
            ${platformBadge('Blogger', post.bloggerStatus)}
            ${platformBadge('Pinterest', post.pinterestStatus)}
          </div>
          <div class="confirm-list mt-2">
            <div class="row"><span>Created</span><strong>${esc(fmtDate(post.createdAt))}</strong></div>
            <div class="row"><span>Servings</span><strong>${esc(post.servings)}</strong></div>
            ${post.nutrition ? `<div class="row"><span>Calories</span><strong>${esc(post.nutrition.perServing?.calories ?? '—')} kcal</strong></div>` : ''}
            ${post.nutrition ? `<div class="row"><span>Protein</span><strong>${esc(post.nutrition.perServing?.protein ?? '—')} g</strong></div>` : ''}
            <div class="row"><span>Image</span><strong>${post.isPublicImage ? 'Public (Cloudinary)' : post.imageLocalUrl ? 'Local preview' : 'None'}</strong></div>
          </div>
          <div class="row mt-2" style="gap:5px">
            ${post.bloggerUrl ? `<a class="btn sm" href="${attr(post.bloggerUrl)}" target="_blank" rel="noopener">${icon('external')} Article</a>` : ''}
            ${post.pinterestUrl ? `<a class="btn sm" href="${attr(post.pinterestUrl)}" target="_blank" rel="noopener">${icon('external')} Pin</a>` : ''}
          </div>
          ${post.error ? `<div class="banner error mt-2">${icon('alert')}<span>${esc(post.error)}</span></div>` : ''}
          ${Object.keys(stage).length ? `<div class="mt-2">${stageList.map(([k, label]) => {
            const s = stage[k];
            if (!s) return `<div class="between" style="font-size:10.5px;padding:2px 0"><span class="dim">${label}</span><span class="dim">—</span></div>`;
            return `<div class="between" style="font-size:10.5px;padding:2px 0"><span class="dim">${label}</span><span class="${s.status === 'success' ? 'b-green' : s.status === 'failed' ? 'b-red' : 'b-amber'}" style="padding:0">${esc(s.status)}</span></div>`;
          }).join('')}</div>` : ''}
        </div>
        <div>
          <div class="preview-tabs mb-2">
            ${[['recipe', 'Recipe'], ['nutrition', 'Nutrition'], ['seo', 'SEO'], ['article', 'Article'], ['analysis', 'Analysis']].map(([k, l]) =>
              `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <div class="preview-pane" id="detailPane" style="max-height:56vh">
            ${tab === 'recipe' ? recipeBlock(post) : tab === 'nutrition' ? nutritionBlock(post) : tab === 'seo' ? seoBlock(post) : tab === 'article' ? articleBlock(post) : analysisBlock(post)}
          </div>
          ${tab === 'seo' ? `<div class="row mt-3"><button class="btn primary sm" id="saveSeo">${icon('check')} Save SEO edits</button></div>` : ''}
        </div>
      </div>
      <hr class="divider" />
      <div class="row" style="gap:6px">
        <button class="btn sm" data-d="regen-img">${icon('wand')} New image</button>
        <button class="btn sm" data-d="regen-recipe">${icon('refresh')} New recipe</button>
        <button class="btn sm" data-d="nutrition">${icon('leaf')} Recalculate nutrition</button>
        <button class="btn sm" data-d="seo">${icon('chart')} Regenerate SEO</button>
        <button class="btn sm" data-d="schedule">${icon('calendarPlus')} Schedule</button>
        <button class="btn sm" data-d="duplicate">${icon('copy')} Duplicate</button>
        <button class="btn sm danger" data-d="delete">${icon('trash')} Delete</button>
      </div>`;
    }

    function bindDetail() {
      $$('[data-tab]', m.overlay).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderDetail(); }));
      $('#saveSeo', m.overlay)?.addEventListener('click', async () => {
        const body = {};
        $$('[data-edit]', m.overlay).forEach((inp) => {
          const key = inp.dataset.edit;
          body[key] = key === 'pinterestTags'
            ? inp.value.split(',').map((s) => s.trim()).filter(Boolean) : inp.value;
        });
        try {
          const res = await api(`/api/posts/${post.id}`, { method: 'PUT', body });
          Object.assign(post, res.post);
          toast('SEO fields saved.', 'success');
          renderDetail();
          if (state.studio?.post?.id === post.id) { state.studio.post = res.post; renderStudioPreview(); }
        } catch (err) { toast(err.message, 'error'); }
      });
      $('[data-d="regen-img"]', m.overlay)?.addEventListener('click', () => runDetailStage('regenerate-image', 'Regenerating the photograph…'));
      $('[data-d="regen-recipe"]', m.overlay)?.addEventListener('click', () => runDetailStage('regenerate-recipe', 'Rewriting the recipe…'));
      $('[data-d="nutrition"]', m.overlay)?.addEventListener('click', () => runDetailStage('generate-nutrition', 'Recalculating nutrition…'));
      $('[data-d="seo"]', m.overlay)?.addEventListener('click', () => runDetailStage('generate-seo', 'Regenerating SEO…'));
      $('[data-d="schedule"]', m.overlay)?.addEventListener('click', () => { m.close(); scheduleModal(post); });
      $('[data-d="duplicate"]', m.overlay)?.addEventListener('click', async () => {
        try {
          const res = await api(`/api/posts/${post.id}/duplicate`, { method: 'POST' });
          toast('Post duplicated as a draft.', 'success');
          await refreshCore().catch(() => {});
          if (state.view === 'history') renderView();
          m.close();
          openPostDetail(res.post.id);
        } catch (err) { toast(err.message, 'error'); }
      });
      $('[data-d="delete"]', m.overlay)?.addEventListener('click', async () => {
        const remote = [];
        if (post.bloggerUrl) remote.push('blogger');
        if (post.pinterestUrl) remote.push('pinterest');
        const ok = await confirmDialog({
          title: 'Delete this post?',
          message: remote.length
            ? `This deletes the local record. Optionally also remove the live ${remote.join(' and ')} content.`
            : 'This permanently deletes the local post, its image and publishing records.',
          confirmLabel: 'Delete locally',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api(`/api/posts/${post.id}`, { method: 'DELETE' });
          toast('Post deleted.', 'success');
          m.close();
          await refreshCore().catch(() => {});
          if (state.view === 'history' || state.view === 'dashboard') renderView();
          if (state.studio?.post?.id === post.id) { state.studio.post = null; renderStudioPreview(); }
          if (res.remoteResults?.length) toast(res.remoteResults.map((r) => `${r.platform}: ${r.ok ? 'removed' : r.error}`).join(' · '), 'info', 8000);
        } catch (err) {
          toast(err.message, 'error', 9000);
        }
      });
    }

    async function runDetailStage(endpoint, label) {
      const done = busy(label, 'This can take up to a minute');
      try {
        const res = await api(`/api/posts/${post.id}/${endpoint}`, { method: 'POST', body: {} });
        Object.assign(post, res.post);
        done();
        toast('Stage completed.', 'success');
        renderDetail();
        await refreshCore().catch(() => {});
      } catch (err) { done(); toast(err.message, 'error', 9000); }
    }

    function renderDetail() {
      $('#detailBody', m.overlay).innerHTML = detailHtml();
      bindDetail();
    }
    renderDetail();

    const footer = m.overlay.querySelector('.modal-foot');
    if (!footer) {
      const el = document.createElement('div');
      el.className = 'modal-foot';
      el.innerHTML = `
        <button class="btn ghost left" data-f="retry">${icon('refresh')} Retry</button>
        <button class="btn" data-f="blogger">${icon('globe')} Blogger</button>
        <button class="btn" data-f="pinterest">${icon('pin')} Pinterest</button>
        <button class="btn primary" data-f="both">${icon('send')} Publish both</button>`;
      m.overlay.querySelector('.modal').appendChild(el);
      $('[data-f="retry"]', el).addEventListener('click', async () => {
        try {
          const res = await api(`/api/posts/${post.id}/retry`, { method: 'POST', body: {} });
          Object.assign(post, res.post);
          renderDetail();
          if (res.errors?.length) toast(res.errors.map((e) => `${e.platform}: ${e.error}`).join(' · '), 'error', 12_000);
          else toast('Retry succeeded.', 'success');
        } catch (err) { toast(err.message, 'error', 9000); }
      });
      $('[data-f="blogger"]', el).addEventListener('click', async () => { const p = await publishFlow(post, ['blogger']); if (p) { Object.assign(post, p); renderDetail(); } });
      $('[data-f="pinterest"]', el).addEventListener('click', async () => { const p = await publishFlow(post, ['pinterest']); if (p) { Object.assign(post, p); renderDetail(); } });
      $('[data-f="both"]', el).addEventListener('click', async () => { const p = await publishFlow(post, ['blogger', 'pinterest']); if (p) { Object.assign(post, p); renderDetail(); } });
    }
  }

  /* ================================================================ */
  /* CREATE STUDIO                                                    */
  /* ================================================================ */

  function studioState() {
    if (!state.studio) state.studio = { post: null, tab: 'recipe', lastForm: null };
    return state.studio;
  }

  function renderCreate(root) {
    const st = studioState();
    const settings = state.settings || {};
    const post = st.post;
    const cat = state.meta.categories.length ? state.meta.categories : ['High Protein'];
    const styles = state.meta.imageStyles.length ? state.meta.imageStyles : ['Realistic Food Photography'];
    const langs = state.meta.languages.length ? state.meta.languages : ['English'];
    const goals = post?.nutritionGoals || settings.defaultNutritionGoals || {};

    root.innerHTML = `
      <div class="section-title">
        <div><h2>Content studio</h2><p>One topic becomes a photograph, a tested recipe, a nutrition table and a publish-ready article.</p></div>
        <button class="btn ghost sm" id="studioReset">${icon('plus')} Start blank</button>
      </div>
      <div class="studio-grid">
        <div class="studio-stack">
          <section class="card">
            <div class="card-head">
              <div class="grow"><h3>1 · The idea</h3><div class="sub">Describe the recipe you want, or let Gemini suggest one.</div></div>
              <span class="badge ${post ? 'b-blue' : 'b-gray'}">${post ? 'Draft saved' : 'New'}</span>
            </div>
            <div class="card-body">
              <div class="field mb-3">
                <label for="stTopic">Recipe topic</label>
                <div class="row" style="gap:6px;flex-wrap:nowrap">
                  <input type="text" id="stTopic" maxlength="160" placeholder="e.g. High-protein chicken and broccoli rice bowl"
                    value="${attr(post?.topic || '')}" />
                  <button class="btn" id="stSuggest" title="Ask Gemini for an unused topic">${icon('sparkles')} Suggest</button>
                </div>
                <span class="hint">The studio checks recent topics and avoids close duplicates.</span>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label>Category</label>
                  <select id="stCategory">${cat.map((c) => `<option ${((post?.category || settings.defaultCategory) === c) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
                </div>
                <div class="field">
                  <label>Language</label>
                  <select id="stLanguage">${langs.map((l) => `<option ${((post?.language || settings.language) === l) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
                </div>
                <div class="field">
                  <label>Servings</label>
                  <input type="number" id="stServings" min="1" max="50" value="${attr(post?.servings || settings.defaultServings || 2)}" />
                </div>
                <div class="field">
                  <label>Image style</label>
                  <select id="stStyle">${styles.map((s) => `<option ${((settings.defaultImageStyle) === s) ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
                </div>
              </div>
              <details class="mt-3" ${post ? '' : ''}>
                <summary class="small muted" style="cursor:pointer">Advanced: nutrition goals, custom instructions, image prompt</summary>
                <div class="mt-3">
                  <div class="form-grid three">
                    <div class="field"><label>Calories / serving</label><input type="number" id="stCal" min="0" max="3000" value="${attr(goals.calories ?? '')}" placeholder="e.g. 520" /></div>
                    <div class="field"><label>Protein (g)</label><input type="number" id="stProtein" min="0" max="300" value="${attr(goals.protein ?? '')}" placeholder="40" /></div>
                    <div class="field"><label>Fiber (g)</label><input type="number" id="stFiber" min="0" max="100" value="${attr(goals.fiber ?? '')}" placeholder="10" /></div>
                  </div>
                  <div class="field mt-2">
                    <label>Custom instructions</label>
                    <textarea id="stInstructions" rows="3" maxlength="3000" placeholder="e.g. Keep it under 30 minutes, no dairy, use ingredients available in Bangladesh.">${esc(post?.customInstructions || '')}</textarea>
                  </div>
                  <div class="field mt-2">
                    <label>Image prompt override <span class="dim">(optional)</span></label>
                    <textarea id="stImagePrompt" rows="3" maxlength="4000" placeholder="Leave blank to let the studio build a prompt from the topic and style.">${esc(post?.imagePrompt || '')}</textarea>
                  </div>
                </div>
              </details>
              <hr class="divider" />
              <div class="row">
                <button class="btn primary lg" id="stGenerate">${icon('sparkles')} Generate full post</button>
                <button class="btn" id="stSaveDraft">${icon('book')} Save draft</button>
                <button class="btn ghost" id="stImageOnly">${icon('image')} Image only</button>
                <span class="hint grow" style="text-align:right">Uses your Gemini quota</span>
              </div>
              <div id="studioNotice" class="mt-3"></div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="grow"><h3>2 · Stages</h3><div class="sub">Run any stage independently — results are saved immediately.</div></div>
              <button class="btn sm ghost" id="stRefresh">${icon('refresh')} Refresh</button>
            </div>
            <div class="card-body">
              <div class="stepper" id="studioSteps"></div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="grow"><h3>3 · Publish</h3><div class="sub">Blogger first. Pinterest only uses a live article URL.</div></div>
              ${post ? statusBadge(post.status) : '<span class="badge b-gray">No draft</span>'}
            </div>
            <div class="card-body">
              <div class="row">
                <button class="btn" id="stPublishBlogger" ${post ? '' : 'disabled'}>${icon('globe')} Blogger</button>
                <button class="btn" id="stPublishPinterest" ${post ? '' : 'disabled'}>${icon('pin')} Pinterest</button>
                <button class="btn primary" id="stPublishBoth" ${post ? '' : 'disabled'}>${icon('send')} Publish both</button>
                <button class="btn ghost" id="stSchedule" ${post ? '' : 'disabled'}>${icon('calendarPlus')} Schedule</button>
              </div>
              <div id="studioPublishNote" class="mt-3"></div>
            </div>
          </section>
        </div>

        <div class="studio-preview">
          <section class="card">
            <div class="card-head">
              <div class="grow"><h3>Preview</h3><div class="sub" id="studioPreviewSub">${post ? esc(post.title || post.topic) : 'Nothing generated yet'}</div></div>
            </div>
            <div class="card-body">
              <div class="image-stage" id="studioImageStage">
                ${post && imgFor(post)
                  ? `<img src="${attr(imgFor(post))}" alt="${attr(post.imageAlt || post.title || post.topic)}" />`
                  : `<div class="image-placeholder">${icon('image')}<p>Your food photograph will appear here at 2:3.</p></div>`}
                <div class="image-overlay">
                  <button class="btn sm" id="stUpload">${icon('upload')} Upload</button>
                  <button class="btn sm ghost" id="stRegenImage" ${post ? '' : 'disabled'}>${icon('wand')} ${post && imgFor(post) ? 'Regenerate' : 'Generate'}</button>
                </div>
              </div>
              <input type="file" id="stFile" accept="image/png,image/jpeg,image/webp" class="hidden" />
              <div class="preview-tabs mt-3">
                ${[['recipe', 'Recipe'], ['nutrition', 'Nutrition'], ['seo', 'SEO'], ['article', 'Article'], ['analysis', 'Analysis']].map(([k, l]) =>
                  `<button data-studio-tab="${k}" class="${st.tab === k ? 'active' : ''}">${l}</button>`).join('')}
              </div>
              <div class="preview-pane mt-2" id="studioPane">${previewPane(post, st.tab)}</div>
            </div>
          </section>
        </div>
      </div>`;

    // events
    $('#stSuggest', root).addEventListener('click', suggestTopic);
    $('#stGenerate', root).addEventListener('click', () => generateFull());
    $('#stSaveDraft', root).addEventListener('click', saveDraft);
    $('#stImageOnly', root).addEventListener('click', generateImageOnly);
    $('#stRefresh', root).addEventListener('click', refreshStudio);
    $('#studioReset', root).addEventListener('click', () => {
      state.studio = { post: null, tab: 'recipe' };
      renderView();
    });
    $('#stRegenImage', root).addEventListener('click', regenerateImage);
    $('#stUpload', root).addEventListener('click', () => $('#stFile').click());
    $('#stFile').addEventListener('change', uploadImage);
    root.querySelectorAll('[data-studio-tab]').forEach((b) => b.addEventListener('click', () => {
      studioState().tab = b.dataset.studioTab;
      renderCreate(root);
    }));
    $('#stPublishBlogger', root).addEventListener('click', async () => { const p = await publishFlow(post, ['blogger']); if (p) { st.post = p; renderCreate(root); } });
    $('#stPublishPinterest', root).addEventListener('click', async () => { const p = await publishFlow(post, ['pinterest']); if (p) { st.post = p; renderCreate(root); } });
    $('#stPublishBoth', root).addEventListener('click', async () => { const p = await publishFlow(post, ['blogger', 'pinterest']); if (p) { st.post = p; renderCreate(root); } });
    $('#stSchedule', root).addEventListener('click', () => scheduleModal(post));

    renderStudioSteps();
    renderPublishNote();
  }

  function studioForm() {
    const val = (id) => $(id)?.value?.trim() ?? '';
    return {
      topic: $('#stTopic')?.value.trim() || '',
      category: $('#stCategory')?.value,
      language: $('#stLanguage')?.value,
      servings: Number($('#stServings')?.value) || 2,
      imageStyle: $('#stStyle')?.value,
      customInstructions: $('#stInstructions')?.value.trim() || '',
      imagePrompt: $('#stImagePrompt')?.value.trim() || '',
      nutritionGoals: {
        calories: $('#stCal')?.value ? Number($('#stCal').value) : null,
        protein: $('#stProtein')?.value ? Number($('#stProtein').value) : null,
        fiber: $('#stFiber')?.value ? Number($('#stFiber').value) : null,
      },
    };
  }

  async function suggestTopic() {
    const btn = $('#stSuggest');
    btn.disabled = true;
    try {
      const res = await api('/api/topics/suggest', {
        method: 'POST',
        body: { category: $('#stCategory')?.value, language: $('#stLanguage')?.value },
      });
      $('#stTopic').value = res.topic;
      toast(`Suggested: ${res.topic}`, 'success', 5000);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  }

  function setStudioPost(post) {
    const st = studioState();
    st.post = post;
    state.notifications = Math.max(0, state.notifications);
    renderCreate($('#view'));
  }

  async function saveDraft() {
    const form = studioForm();
    if (!form.topic) return toast('Enter a topic first.', 'warn');
    try {
      const res = await api('/api/posts', { method: 'POST', body: form });
      state.studio.post = res.post;
      toast('Draft saved.', 'success');
      if (res.similarTopics?.length) {
        toast(`Heads up: similar to “${res.similarTopics[0]}”.`, 'warn', 7000);
      }
      renderCreate($('#view'));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function generateFull() {
    const form = studioForm();
    if (!form.topic) return toast('Enter a topic, or tap Suggest.', 'warn');
    if (!state.connections?.gemini?.configured) {
      const goConn = await confirmDialog({
        title: 'Gemini is not configured',
        message: 'The studio needs a Gemini API key before it can generate content. Open API Connections now?',
        confirmLabel: 'Open connections',
      });
      if (goConn) go('connections');
      return;
    }
    const done = busy('Generating your post…', 'Photograph → vision check → recipe → nutrition → SEO → article');
    const notice = $('#studioNotice');
    if (notice) notice.innerHTML = `<div class="banner info">${icon('info')}<span>The full pipeline is running on the server. This can take 30–120 seconds.</span></div>`;
    try {
      const res = await api('/api/posts/generate', {
        method: 'POST',
        body: { ...form, publish: false },
      });
      done();
      state.studio.post = res.post;
      state.studio.tab = 'recipe';
      if (res.post.error) toast(res.post.error, 'warn', 10_000);
      else toast('Post generated. Review it, then publish.', 'success');
      if (res.similarTopics?.length) toast(`Similar existing topic: “${res.similarTopics[0]}”.`, 'warn', 7000);
      await refreshCore().catch(() => {});
      renderCreate($('#view'));
      if (res.post.error) {
        const p = $('#studioNotice');
        if (p) p.innerHTML = `<div class="banner warn">${icon('alert')}<span>${esc(res.post.error)}</span></div>`;
      }
    } catch (err) {
      done();
      toast(err.message, 'error', 12_000);
      if (notice) notice.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
    }
  }

  async function generateImageOnly() {
    const form = studioForm();
    if (!form.topic) return toast('Enter a topic first.', 'warn');
    if (!state.connections?.gemini?.configured) return toast('Configure Gemini first.', 'warn');
    const done = busy('Creating the food photograph…', 'Gemini image model');
    try {
      const res = state.studio?.post?.id
        ? await api(`/api/posts/${state.studio.post.id}/generate-image`, { method: 'POST', body: { prompt: form.imagePrompt || undefined, imageStyle: form.imageStyle } })
        : await api('/api/posts/generate-image', { method: 'POST', body: form });
      done();
      state.studio.post = res.post;
      toast('Image generated.', 'success');
      await refreshCore().catch(() => {});
      renderCreate($('#view'));
    } catch (err) { done(); toast(err.message, 'error', 10_000); }
  }

  async function regenerateImage() {
    const post = state.studio?.post;
    if (!post) return toast('Generate or save a draft first.', 'warn');
    const done = busy('Regenerating the photograph…', 'Previous downstream content will be reset');
    try {
      const res = await api(`/api/posts/${post.id}/regenerate-image`, { method: 'POST', body: {} });
      done();
      state.studio.post = res.post;
      const p2 = state.studio.post;
      if (p2.error) toast(p2.error, 'warn', 8000);
      else toast('New image generated. Re-run recipe and nutrition.', 'success', 6000);
      await refreshCore().catch(() => {});
      renderCreate($('#view'));
    } catch (err) { done(); toast(err.message, 'error', 10_000); }
  }

  async function uploadImage() {
    const file = $('#stFile')?.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) return toast('Image is larger than 12 MB.', 'warn');
    if (!state.studio?.post?.id) return toast('Save a draft before uploading an image.', 'warn');
    const reader = new FileReader();
    reader.onload = async () => {
      const done = busy('Uploading image…', 'Stored locally and sent to Cloudinary if configured');
      try {
        const res = await api(`/api/posts/${state.studio.post.id}/image/upload`, {
          method: 'POST', body: { dataUrl: reader.result },
        });
        done();
        state.studio.post = res.post;
        toast(res.post.error || 'Image uploaded.', res.post.error ? 'warn' : 'success');
        await refreshCore().catch(() => {});
        renderCreate($('#view'));
      } catch (err) { done(); toast(err.message, 'error'); }
    };
    reader.readAsDataURL(file);
  }

  async function refreshStudio() {
    const post = state.studio?.post;
    if (!post) return renderCreate($('#view'));
    try {
      const res = await api(`/api/posts/${post.id}`);
      state.studio.post = res.post;
      renderCreate($('#view'));
      toast('Refreshed.', 'success', 1800);
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderStudioSteps() {
    const el = $('#studioSteps');
    if (!el) return;
    const post = state.studio?.post;
    const stage = post?.stageStatus || {};
    const defs = [
      { key: 'image', label: 'Food photograph', hint: 'Gemini image model · 2:3', endpoint: 'generate-image', rerun: 'regenerate-image' },
      { key: 'image_analysis', label: 'Vision check', hint: 'Verifies the photo matches the topic', endpoint: 'analyze-image' },
      { key: 'recipe', label: 'Recipe', hint: 'Ingredients, steps, tips, FAQ', endpoint: 'generate-recipe' },
      { key: 'nutrition', label: 'Nutrition', hint: 'Calculated from quantities', endpoint: 'generate-nutrition' },
      { key: 'seo', label: 'SEO & Pinterest', hint: 'Titles, description, tags', endpoint: 'generate-seo' },
      { key: 'blogger_html', label: 'Article HTML', hint: 'Recipe schema + responsive layout', endpoint: 'build-article' },
    ];
    el.innerHTML = defs.map((d, i) => {
      const s = stage[d.key] || {};
      const status = s.status || 'idle';
      let numCls = '';
      let mark = i + 1;
      if (status === 'success' || status === 'warning') { numCls = 'done'; mark = '✓'; }
      else if (status === 'running') { numCls = 'running'; mark = '·'; }
      else if (status === 'failed') { numCls = 'failed'; mark = '!'; }
      const needsPost = !post || (d.key !== 'image' && !post.imageLocalUrl && !post.imageUrl);
      const label = status === 'warning' ? 'done with warnings' : status;
      return `<div class="step">
        <div class="step-num ${numCls}">${mark}</div>
        <div class="step-body">
          <div class="grow">
            <strong>${esc(d.label)}</strong>
            <small>${esc(s.error ? s.error : `${d.hint} · ${label === 'idle' ? 'not run' : label}`)}</small>
          </div>
          <button class="btn sm ghost" data-stage="${d.endpoint}" ${needsPost || d.key === 'nutrition' && !post?.recipe ? 'disabled' : ''}>
            ${status === 'success' ? icon('refresh') : icon('play')} ${status === 'success' ? 'Redo' : 'Run'}
          </button>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-stage]').forEach((btn) => btn.addEventListener('click', () => runStudioStage(btn.dataset.stage)));
  }

  async function runStudioStage(endpoint) {
    const post = state.studio?.post;
    if (!post) return toast('Save a draft first.', 'warn');
    const labels = {
      'generate-image': 'Generating the photograph…', 'regenerate-image': 'Regenerating the photograph…',
      'analyze-image': 'Analysing the photograph…', 'generate-recipe': 'Writing the recipe…',
      'generate-nutrition': 'Calculating nutrition…', 'generate-seo': 'Writing SEO metadata…',
      'build-article': 'Building the article HTML…',
    };
    const done = busy(labels[endpoint] || 'Working…', 'Results are saved to the database');
    try {
      const res = await api(`/api/posts/${post.id}/${endpoint}`, { method: 'POST', body: {} });
      done();
      state.studio.post = res.post;
      toast('Stage completed.', 'success');
      await refreshCore().catch(() => {});
      renderCreate($('#view'));
    } catch (err) { done(); toast(err.message, 'error', 10_000); }
  }

  function renderPublishNote() {
    const el = $('#studioPublishNote');
    if (!el) return;
    const post = state.studio?.post;
    if (!post) { el.innerHTML = `<p class="hint">Generate or save a draft to enable publishing.</p>`; return; }
    const c = state.connections || {};
    const notes = [];
    if (!c.gemini?.configured) notes.push(['warn', 'Gemini is not configured — generation will fail until you add a key.']);
    if (!state.settings?.blogger?.defaultBlogId) notes.push(['warn', 'No Blogger blog selected — choose one in API Connections before publishing.']);
    if (!c.cloudinary?.configured) notes.push(['warn', 'Cloudinary is not configured — Pinterest needs a public https image URL.']);
    if (post.imageLocalUrl && !post.isPublicImage) notes.push(['info', 'Image is stored locally. Cloudinary is required to make it public.']);
    if (post.bloggerUrl) notes.push(['success', `Blogger article live: ${post.bloggerUrl}`]);
    if (post.pinterestUrl) notes.push(['success', `Pinterest Pin live: ${post.pinterestUrl}`]);
    if (!notes.length) notes.push(['success', 'All required integrations look ready.']);
    el.innerHTML = notes.map(([kind, text]) => `<div class="banner ${kind} mb-2">${icon(kind === 'warn' ? 'alert' : kind === 'success' ? 'check' : 'info')}<span style="word-break:break-word">${esc(text)}</span></div>`).join('');
  }

  /* ================================================================ */
  /* HISTORY                                                          */
  /* ================================================================ */

  function postCard(post) {
    const image = imgFor(post);
    return `<article class="post-card">
      <button class="post-cover" data-open="${attr(post.id)}" style="border:0;padding:0;cursor:pointer;text-align:left;width:100%" aria-label="Open ${attr(post.title || post.topic)}">
        ${image ? `<img src="${attr(image)}" alt="${attr(post.imageAlt || post.title)}" loading="lazy" />`
          : `<div class="noimg">${icon('image')}</div>`}
        <div class="cover-badges">${statusBadge(post.status)}${platformBadge('Blogger', post.bloggerStatus)}${platformBadge('Pinterest', post.pinterestStatus)}</div>
        ${post.publishedAt ? `<span class="cover-date">${esc(fmtDate(post.publishedAt))}</span>` : ''}
      </button>
      <div class="post-content">
        <h3>${esc(post.title || post.topic)}</h3>
        <div class="post-topic">${esc(post.category || 'Recipe')} · ${esc(post.language || 'English')} · ${esc(post.source === 'automation' ? 'automation' : 'manual')}</div>
        <div class="post-meta">
          <span class="pill" style="padding:2px 7px;font-size:10px">${icon('clock')} ${esc(relTime(post.createdAt))}</span>
          ${post.scheduledAt ? `<span class="pill" style="padding:2px 7px;font-size:10px">${icon('calendar')} ${esc(fmtDateTime(post.scheduledAt))}</span>` : ''}
          ${post.recipe ? `<span class="pill" style="padding:2px 7px;font-size:10px">${icon('leaf')} ${esc(post.nutrition?.perServing?.calories ?? '—')} kcal</span>` : ''}
        </div>
        <div class="post-foot">
          <button class="btn sm" data-open="${attr(post.id)}">Open</button>
          <div class="mini-links">
            ${post.bloggerUrl ? `<a class="icon-btn" href="${attr(post.bloggerUrl)}" target="_blank" rel="noopener" title="Open Blogger article">${icon('globe')}</a>` : ''}
            ${post.pinterestUrl ? `<a class="icon-btn" href="${attr(post.pinterestUrl)}" target="_blank" rel="noopener" title="Open Pinterest Pin">${icon('pin')}</a>` : ''}
          </div>
        </div>
      </div>
    </article>`;
  }

  async function renderHistory(root) {
    const p = state.posts;
    root.innerHTML = `
      <div class="section-title">
        <div><h2>Post history</h2><p>Every draft, generated post and live article, stored in your database.</p></div>
        <button class="btn primary" id="histNew">${icon('plus')} New post</button>
      </div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input type="text" id="histSearch" placeholder="Search title, topic or category…" value="${attr(p.search)}" /></div>
        <div class="seg" id="histStatus">
          ${[['all', 'All'], ['draft', 'Drafts'], ['generated', 'Generated'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed']].map(([k, l]) =>
            `<button data-status="${k}" class="${p.status === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <select id="histCategory" style="max-width:180px">
          <option value="">All categories</option>
          ${(state.meta.categories || []).map((c) => `<option ${p.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button class="btn ghost icon" id="histRefresh" title="Refresh">${icon('refresh')}</button>
      </div>
      <div id="histBody"><div class="loading-block"><span class="spinner lg"></span><span>Loading posts…</span></div></div>`;

    $('#histNew').addEventListener('click', () => go('create'));
    $('#histRefresh').addEventListener('click', () => loadHistory());
    $('#histStatus').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      p.status = b.dataset.status; p.page = 1;
      $$('#histStatus button').forEach((x) => x.classList.toggle('active', x === b));
      loadHistory();
    });
    $('#histCategory').addEventListener('change', (e) => { p.category = e.target.value; p.page = 1; loadHistory(); });
    let timer;
    $('#histSearch').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { p.search = e.target.value.trim(); p.page = 1; loadHistory(); }, 350);
    });

    await loadHistory();

    async function loadHistory() {
      const body = $('#histBody');
      if (!body) return;
      body.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading posts…</span></div>`;
      const q = new URLSearchParams({ page: p.page, limit: p.limit });
      if (p.status !== 'all') q.set('status', p.status);
      if (p.category) q.set('category', p.category);
      if (p.search) q.set('search', p.search);
      try {
        const res = await api(`/api/posts?${q.toString()}`);
        p.items = res.items; p.total = res.total; p.pages = res.pages;
      } catch (err) {
        body.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
        return;
      }
      if (!p.items.length) {
        body.innerHTML = `<div class="card"><div class="empty">
          <div class="empty-icon">${icon(p.search || p.status !== 'all' ? 'search' : 'sparkles')}</div>
          <h3>${p.search || p.status !== 'all' ? 'No posts match these filters' : 'Your library is empty'}</h3>
          <p>${p.search || p.status !== 'all' ? 'Try a different search or status filter.' : 'Create your first recipe and it will appear here with its photograph and nutrition data.'}</p>
          ${p.search || p.status !== 'all' ? `<button class="btn sm" id="histClear">Clear filters</button>` : `<button class="btn primary sm" id="histStart">${icon('plus')} Create a post</button>`}
        </div></div>`;
        $('#histClear')?.addEventListener('click', () => {
          p.status = 'all'; p.search = ''; p.category = ''; p.page = 1;
          $('#histSearch').value = ''; $('#histCategory').value = '';
          $$('#histStatus button').forEach((x) => x.classList.toggle('active', x.dataset.status === 'all'));
          loadHistory();
        });
        $('#histStart')?.addEventListener('click', () => go('create'));
        return;
      }
      const from = (p.page - 1) * p.limit + 1;
      const to = Math.min(p.total, p.page * p.limit);
      body.innerHTML = `
        <div class="post-grid">${p.items.map(postCard).join('')}</div>
        <div class="pager">
          <span class="pager-info">Showing ${from}–${to} of ${p.total} posts</span>
          <div class="pager-controls">
            <button data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>${icon('left')}</button>
            ${pageNumbers(p.page, p.pages).map((n) => n === '…'
              ? '<button disabled>…</button>'
              : `<button data-page="${n}" class="${n === p.page ? 'active' : ''}">${n}</button>`).join('')}
            <button data-page="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''}>${icon('right')}</button>
          </div>
        </div>`;
      body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPostDetail(b.dataset.open)));
      body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
        const n = Number(b.dataset.page);
        if (!n || n === p.page || n < 1 || n > p.pages) return;
        p.page = n;
        loadHistory();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }
  }

  function pageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, current, current - 1, current + 1]);
    const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) out.push('…');
      out.push(n);
      prev = n;
    }
    return out;
  }

  /* ================================================================ */
  /* SCHEDULED                                                        */
  /* ================================================================ */

  const SCHED_STATUS = {
    Scheduled: 'b-purple', Running: 'b-amber', Published: 'b-green', Failed: 'b-red', Cancelled: 'b-gray',
  };

  async function renderScheduled(root) {
    root.innerHTML = `
      <div class="section-title">
        <div><h2>Scheduled queue</h2><p>Server-side jobs. The Render cron worker publishes these even while the dashboard sleeps.</p></div>
        <div class="row">
          <button class="btn ghost" id="schedRefresh">${icon('refresh')} Refresh</button>
          <button class="btn primary" id="schedNew">${icon('plus')} Schedule a post</button>
        </div>
      </div>
      <div id="schedBody"><div class="loading-block"><span class="spinner lg"></span><span>Loading queue…</span></div></div>
      <div class="banner info mt-3">${icon('info')}<span>Schedule times are converted to UTC and stored in PostgreSQL. Duplicate prevention uses a database lock and slot keys, so multiple workers cannot publish the same slot twice.</span></div>`;

    $('#schedRefresh').addEventListener('click', () => load());
    $('#schedNew').addEventListener('click', openSchedulePicker);
    await load();

    async function load() {
      const body = $('#schedBody');
      body.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading queue…</span></div>`;
      try {
        const res = await api('/api/scheduled');
        state.scheduled = res.items;
        body.innerHTML = res.items.length
          ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Post</th><th>When</th><th>Destinations</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
              <tbody>${res.items.map((it) => `
                <tr>
                  <td><button class="post-cell" data-open="${attr(it.postId)}" style="background:none;border:0;color:inherit;cursor:pointer;text-align:left;padding:0">
                    ${imgFor(it.post) ? `<img class="thumb" src="${attr(imgFor(it.post))}" alt="" loading="lazy" />` : `<span class="thumb placeholder">${icon('image')}</span>`}
                    <span><strong>${esc(it.post.title || it.post.topic)}</strong><small>${esc(it.post.topic)}</small></span>
                  </button></td>
                  <td><div class="nowrap">${esc(fmtDateTime(it.scheduledAt))}</div><div class="dim" style="font-size:10.5px">${esc(relTime(it.scheduledAt))}</div></td>
                  <td>${(it.destinations || []).map((d) => `<span class="tag" style="margin:1px">${d === 'blogger' ? icon('globe') : icon('pin')} ${esc(d)}</span>`).join('')}</td>
                  <td><span class="badge ${SCHED_STATUS[it.status] || 'b-gray'}">${esc(it.status)}</span>
                    ${it.note ? `<div class="dim" style="font-size:10px;max-width:180px;white-space:normal;margin-top:3px">${esc(it.note)}</div>` : ''}</td>
                  <td><div class="actions">
                    ${['Scheduled', 'Failed'].includes(it.status) ? `<button class="btn sm" data-now="${attr(it.id)}">${icon('play')} Publish now</button>` : ''}
                    ${it.status === 'Scheduled' ? `<button class="btn sm ghost" data-edit="${attr(it.id)}">${icon('edit')} Edit</button>` : ''}
                    ${['Scheduled', 'Running'].includes(it.status) ? `<button class="btn sm danger" data-cancel="${attr(it.id)}" title="Cancel">${icon('close')}</button>` : ''}
                  </div></td>
                </tr>`).join('')}</tbody>
            </table></div>`
          : `<div class="card"><div class="empty">
              <div class="empty-icon">${icon('calendar')}</div>
              <h3>Nothing in the queue</h3>
              <p>Generate a post, then schedule it for a specific time or let automation publish on its configured daily slot.</p>
              <div class="row"><button class="btn primary sm" id="schedEmptyNew">${icon('plus')} Schedule a post</button>
              <button class="btn sm" id="schedEmptyAuto">${icon('repeat')} Automation</button></div>
            </div></div>`;
        $('#schedEmptyNew')?.addEventListener('click', openSchedulePicker);
        $('#schedEmptyAuto')?.addEventListener('click', () => go('automation'));
        body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPostDetail(b.dataset.open)));
        body.querySelectorAll('[data-now]').forEach((b) => b.addEventListener('click', () => publishScheduledNow(b.dataset.now, b)));
        body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancelScheduled(b.dataset.cancel)));
        body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editScheduled(b.dataset.edit)));
      } catch (err) {
        body.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
      }
    }

    async function publishScheduledNow(id, btn) {
      btn.disabled = true;
      const done = busy('Publishing now…', 'Running the scheduled job');
      try {
        const res = await api(`/api/scheduled/${id}/publish-now`, { method: 'POST', body: {} });
        done();
        toast('Scheduled post published.', 'success');
        await refreshCore().catch(() => {});
        await load();
      } catch (err) { done(); btn.disabled = false; toast(err.message, 'error', 10_000); }
    }

    async function cancelScheduled(id) {
      const ok = await confirmDialog({ title: 'Cancel this schedule?', message: 'The post itself stays in your library. Only the scheduled job is cancelled.', confirmLabel: 'Cancel schedule', danger: true });
      if (!ok) return;
      try {
        await api(`/api/scheduled/${id}`, { method: 'DELETE' });
        toast('Schedule cancelled.', 'success');
        await refreshCore().catch(() => {});
        await load();
      } catch (err) { toast(err.message, 'error'); }
    }

    async function editScheduled(id) {
      const item = state.scheduled.find((i) => i.id === id);
      if (!item) return;
      const d = new Date(item.scheduledAt);
      const pad = (n) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const m = openModal({
        title: 'Edit schedule',
        subtitle: item.post.title || item.post.topic,
        body: `<div class="field mb-2"><label>Date &amp; time</label><input type="datetime-local" id="edWhen" value="${local}" /></div>
          <div class="field mb-2"><label>Destinations</label><div class="row" style="gap:14px">
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="edBlogger" ${item.destinations.includes('blogger') ? 'checked' : ''} /> Blogger</label>
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="edPinterest" ${item.destinations.includes('pinterest') ? 'checked' : ''} /> Pinterest</label>
          </div></div>
          <div class="field"><label>Note</label><input type="text" id="edNote" maxlength="300" value="${attr(item.note || '')}" /></div>`,
        footer: `<button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Save changes</button>`,
      });
      $('[data-act="cancel"]', m.overlay).addEventListener('click', m.close);
      $('[data-act="save"]', m.overlay).addEventListener('click', async () => {
        const destinations = [];
        if ($('#edBlogger', m.overlay).checked) destinations.push('blogger');
        if ($('#edPinterest', m.overlay).checked) destinations.push('pinterest');
        try {
          await api(`/api/scheduled/${id}`, {
            method: 'PUT',
            body: { scheduledAt: new Date($('#edWhen', m.overlay).value).toISOString(), destinations, note: $('#edNote', m.overlay).value },
          });
          m.close();
          toast('Schedule updated.', 'success');
          await load();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    async function openSchedulePicker() {
      let posts = [];
      try {
        const res = await api('/api/posts?status=all&limit=50');
        posts = res.items.filter((x) => !['published'].includes(x.status));
      } catch (err) { toast(err.message, 'error'); return; }
      if (!posts.length) {
        toast('Create a post first, then schedule it.', 'warn');
        go('create');
        return;
      }
      const m = openModal({
        title: 'Schedule a post',
        subtitle: 'Pick a post from your library and a publishing time.',
        body: `<div class="field mb-2"><label>Post</label><select id="pickPost">${posts.map((p) => `<option value="${attr(p.id)}">${esc(p.title || p.topic)} · ${esc(p.status)}</option>`).join('')}</select></div>
          <div id="pickBody"></div>`,
      });
      const body = $('#pickBody', m.overlay);
      const current = () => posts.find((p) => p.id === $('#pickPost', m.overlay).value);
      function renderDetails() {
        const post = current();
        const pad = (n) => String(n).padStart(2, '0');
        const when = new Date(Date.now() + 3_600_000);
        const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
        body.innerHTML = `<div class="field mb-2"><label>When</label><input type="datetime-local" id="pickWhen" value="${local}" /></div>
          <div class="field mb-2"><label>Destinations</label><div class="row" style="gap:14px">
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="pickBlogger" checked /> Blogger</label>
            <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="pickPinterest" ${post?.bloggerUrl || post?.pinterestUrl ? '' : 'checked'} /> Pinterest</label>
          </div><span class="hint">Pinterest requires a live Blogger URL; include Blogger to publish it first.</span></div>
          <div class="field"><label>Note <span class="dim">(optional)</span></label><input type="text" id="pickNote" maxlength="300" /></div>
          <div class="row mt-3"><button class="btn primary" id="pickSave">${icon('calendarPlus')} Schedule</button></div>`;
        $('#pickSave', body).addEventListener('click', async () => {
          const destinations = [];
          if ($('#pickBlogger', body).checked) destinations.push('blogger');
          if ($('#pickPinterest', body).checked) destinations.push('pinterest');
          try {
            await api('/api/scheduled', {
              method: 'POST',
              body: { postId: post.id, scheduledAt: new Date($('#pickWhen', body).value).toISOString(), destinations, note: $('#pickNote', body).value },
            });
            m.close();
            toast('Post scheduled.', 'success');
            await load();
          } catch (err) { toast(err.message, 'error'); }
        });
      }
      $('#pickPost', m.overlay).addEventListener('change', renderDetails);
      renderDetails();
    }
  }

  /* ================================================================ */
  /* ANALYTICS                                                        */
  /* ================================================================ */

  async function renderAnalytics(root) {
    const range = state.analyticsRange;
    root.innerHTML = `
      <div class="section-title">
        <div><h2>Analytics</h2><p>Real counts from your database and, when connected, the official Pinterest API.</p></div>
        <div class="row">
          <div class="range-tabs" id="rangeTabs">
            ${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']].map(([k, l]) => `<button data-range="${k}" class="${range === k ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <button class="btn ghost icon" id="anaRefresh" title="Refresh">${icon('refresh')}</button>
        </div>
      </div>
      <div id="anaBody"><div class="loading-block"><span class="spinner lg"></span><span>Loading analytics…</span></div></div>`;

    $('#rangeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      state.analyticsRange = b.dataset.range;
      $$('#rangeTabs button').forEach((x) => x.classList.toggle('active', x === b));
      load();
    });
    $('#anaRefresh').addEventListener('click', load);
    await load();

    async function load() {
      const body = $('#anaBody');
      body.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading analytics…</span></div>`;
      let a;
      try { a = await api(`/api/analytics?range=${state.analyticsRange}`); }
      catch (err) { body.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`; return; }
      state.analytics = a;
      const t = a.totals || {};
      const rates = a.successRates || {};
      const max = Math.max(1, ...a.daily.map((d) => d.posts));
      const catMax = Math.max(1, ...a.categories.map((c) => c.count));
      const pin = a.pinterest || {};

      body.innerHTML = `
        <div class="grid cols-4">
          <div class="stat"><div class="stat-top"><span class="stat-label">Posts created</span><span class="stat-icon">${icon('layers')}</span></div>
            <div class="stat-value">${fmtNum(t.total)}</div><div class="stat-foot">${esc(a.range === 'all' ? 'all time' : `last ${a.range} days`)}</div></div>
          <div class="stat accent"><div class="stat-top"><span class="stat-label">Fully published</span><span class="stat-icon">${icon('send')}</span></div>
            <div class="stat-value">${fmtNum(t.published)}</div><div class="stat-foot">${t.partiallyPublished || 0} partially published</div></div>
          <div class="stat"><div class="stat-top"><span class="stat-label">Success rate</span><span class="stat-icon">${icon('chart')}</span></div>
            <div class="stat-value">${rates.overall == null ? '—' : `${rates.overall}%`}</div><div class="stat-foot">of all generated posts</div></div>
          <div class="stat"><div class="stat-top"><span class="stat-label">Failed</span><span class="stat-icon">${icon('alert')}</span></div>
            <div class="stat-value">${fmtNum(t.failed)}</div><div class="stat-foot">${t.drafts || 0} drafts waiting</div></div>
        </div>

        <div class="split mt-3" style="grid-template-columns:minmax(0,1.45fr) minmax(0,.85fr)">
          <section class="card">
            <div class="card-head"><div class="grow"><h3>Daily output</h3><div class="sub">Posts created vs. published (UTC days)</div></div>
              <div class="chart-legend"><span><i style="background:rgba(199,244,100,.85)"></i>Created</span><span><i style="background:#7ee2a8"></i>Published</span></div>
            </div>
            <div class="card-body">
              ${a.daily.length ? `<div class="chart">${a.daily.map((d) => `
                <div class="bar-col" title="${esc(d.date)}: ${d.posts} created, ${d.published} published">
                  <div class="bar-fill published" style="height:${(d.published / max) * 100}%;position:absolute;bottom:0;width:45%;left:2.5%;opacity:.9"></div>
                  <div class="bar-fill" style="height:${(d.posts / max) * 100}%;position:absolute;bottom:0;width:45%;right:2.5%"></div>
                </div>`).join('')}</div>
                <div class="bar-labels">${a.daily.map((d, i) => `<span>${a.daily.length > 35 ? (i % 7 === 0 ? d.date.slice(5) : '') : d.date.slice(5)}</span>`).join('')}</div>`
                : `<div class="empty" style="padding:34px"><p>No posts in this range yet.</p></div>`}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div class="grow"><h3>Platform success</h3><div class="sub">Publishing attempts in range</div></div></div>
            <div class="card-body stack" style="gap:18px">
              ${[
                ['Overall', rates.overall, 'All generated posts'],
                ['Blogger', rates.blogger, 'Articles created vs attempts'],
                ['Pinterest', rates.pinterest, 'Pins created vs attempts'],
              ].map(([label, val, hint]) => `
                <div class="kpi-ring">
                  <div class="ring" style="--val:${val ?? 0}" data-label="${val == null ? '—' : `${val}%`}"></div>
                  <div><strong style="font-size:13px">${label}</strong><small>${esc(hint)}</small></div>
                </div>`).join('')}
            </div>
          </section>
        </div>

        <div class="split mt-3">
          <section class="card">
            <div class="card-head"><div class="grow"><h3>Posts by category</h3><div class="sub">Where your content is concentrated</div></div></div>
            <div class="card-body">
              ${a.categories.length ? `<div class="hbar">${a.categories.map((c) => `
                <div class="hbar-row"><span>${esc(c.category)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(c.count / catMax) * 100}%"></div></div><b>${c.count}</b></div>`).join('')}</div>`
                : `<div class="empty" style="padding:28px"><p>No categories yet.</p></div>`}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div class="grow"><h3>Pinterest metrics</h3><div class="sub">Official API · cached 15 minutes</div></div></div>
            <div class="card-body">
              ${pin.available
                ? `<div class="grid cols-2" style="gap:12px">
                    ${[['Impressions', pin.metrics?.impressions], ['Saves', pin.metrics?.saves], ['Pin clicks', pin.metrics?.pinClicks], ['Outbound clicks', pin.metrics?.outboundClicks]].map(([l, v]) => `
                      <div class="stat" style="padding:12px"><span class="stat-label">${l}</span><div class="stat-value" style="font-size:23px;margin-top:5px">${v == null ? '—' : fmtNum(v)}</div></div>`).join('')}
                  </div>
                  <p class="hint mt-2">${esc(pin.note || '')}</p>`
                : `<div class="empty" style="padding:24px">
                    <div class="empty-icon">${icon('pin')}</div>
                    <h3>Pinterest analytics unavailable</h3>
                    <p>${esc(pin.reason || 'Connect Pinterest to load real metrics.')}</p>
                    <button class="btn sm" data-goto="connections">Open connections</button>
                  </div>`}
            </div>
          </section>
        </div>

        <section class="card mt-3">
          <div class="card-head"><div class="grow"><h3>Recently published</h3><div class="sub">Newest live content</div></div>
            <span class="badge b-gray no-dot">Blogger has no public analytics API in v3</span></div>
          ${a.recentPublished?.length ? `<div class="recent-list">${a.recentPublished.map((p) => `
            <div class="recent-item">
              ${p.image_local_url ? `<img class="thumb" src="${attr(p.image_local_url)}" alt="" loading="lazy" />` : `<span class="thumb placeholder">${icon('image')}</span>`}
              <div class="grow"><strong>${esc(p.title || p.topic)}</strong><small>${esc(fmtDateTime(p.published_at))}</small></div>
              <div class="mini-links">
                ${p.blogger_url ? `<a class="icon-btn" href="${attr(p.blogger_url)}" target="_blank" rel="noopener" title="Blogger">${icon('globe')}</a>` : ''}
                ${p.pinterest_url ? `<a class="icon-btn" href="${attr(p.pinterest_url)}" target="_blank" rel="noopener" title="Pinterest">${icon('pin')}</a>` : ''}
              </div>
            </div>`).join('')}</div>`
            : `<div class="empty" style="padding:30px"><p>No published posts in this range.</p></div>`}
        </section>`;

      body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
    }
  }

  /* ================================================================ */
  /* PROMPT STUDIO                                                    */
  /* ================================================================ */

  const PROMPT_LABELS = {
    topic_generation: 'Topic generation',
    image_generation: 'Image generation',
    image_analysis: 'Image analysis',
    recipe_generation: 'Recipe generation',
    nutrition_mapping: 'Nutrition mapping',
    seo_content: 'SEO content',
    blogger_formatting: 'Blogger formatting',
    content_instructions: 'Content instructions',
  };

  function extractVars(body) {
    return [...new Set([...String(body || '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  }

  async function renderPrompts(root) {
    const p = state.prompts;
    root.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading prompts…</span></div>`;
    let res;
    try { res = await api('/api/prompts'); }
    catch (err) { root.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`; return; }
    p.items = res.items;
    p.categories = res.categories;
    if (!p.activeId || !p.items.find((i) => i.id === p.activeId)) {
      const first = p.items.find((i) => i.category === p.category) || p.items[0];
      p.activeId = first?.id || null;
      if (first) p.category = first.category;
    }

    root.innerHTML = `
      <div class="section-title">
        <div><h2>Prompt studio</h2><p>Every AI stage is driven by an editable prompt. Changes apply to the next generation.</p></div>
        <button class="btn primary" id="prNew">${icon('plus')} New prompt</button>
      </div>
      <div class="prompt-layout">
        <section class="card">
          <div class="card-head"><div class="grow"><h3>Prompt library</h3><div class="sub">${p.items.length} prompt${p.items.length === 1 ? '' : 's'}</div></div></div>
          <div class="card-body" style="padding:10px">
            <div class="cat-tabs" id="prCats">
              ${p.categories.map((c) => `<button class="cat-tab ${p.category === c ? 'active' : ''}" data-cat="${c}">${esc(PROMPT_LABELS[c] || c)}</button>`).join('')}
            </div>
            <div class="prompt-list" id="prList"></div>
          </div>
        </section>
        <section class="card" id="prEditor"></section>
      </div>`;

    $('#prCats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      p.category = b.dataset.cat;
      $$('#prCats .cat-tab').forEach((x) => x.classList.toggle('active', x === b));
      const first = p.items.find((i) => i.category === p.category);
      p.activeId = first?.id || null;
      renderList(); renderEditor();
    });
    $('#prNew').addEventListener('click', () => newPrompt());

    function renderList() {
      const list = p.items.filter((i) => i.category === p.category);
      $('#prList').innerHTML = list.length ? list.map((i) => `
        <button class="prompt-item ${i.id === p.activeId ? 'active' : ''}" data-prompt="${attr(i.id)}">
          <strong>${esc(i.name)} ${i.isDefault ? '<span class="badge b-lime no-dot" style="padding:1px 5px;font-size:9px">default</span>' : ''}</strong>
          <small>${esc(PROMPT_LABELS[i.category] || i.category)} · ${esc(extractVars(i.body).length)} vars</small>
        </button>`).join('')
        : `<div class="empty" style="padding:24px 10px"><p>No prompts in this category.</p></div>`;
      $$('[data-prompt]', $('#prList')).forEach((b) => b.addEventListener('click', () => {
        p.activeId = b.dataset.prompt;
        renderList(); renderEditor();
      }));
    }

    function renderEditor() {
      const item = p.items.find((i) => i.id === p.activeId);
      const el = $('#prEditor');
      if (!item) {
        el.innerHTML = `<div class="empty" style="padding:50px"><div class="empty-icon">${icon('message')}</div><h3>Select a prompt</h3><p>Choose a prompt from the library or create a new one for this category.</p></div>`;
        return;
      }
      const vars = extractVars(item.body);
      el.innerHTML = `
        <div class="card-head">
          <div class="grow"><h3>${esc(PROMPT_LABELS[item.category] || item.category)}</h3><div class="sub">Used by the ${esc(item.category.replace(/_/g, ' '))} stage</div></div>
          ${item.isDefault ? '<span class="badge b-lime">Default</span>' : `<button class="btn sm ghost" id="prDefault">${icon('check')} Make default</button>`}
        </div>
        <div class="card-body">
          <div class="field mb-2"><label>Name</label><input type="text" id="prName" maxlength="120" value="${attr(item.name)}" /></div>
          <div class="field">
            <label>Prompt body</label>
            <textarea id="prBody" class="prompt-editor" rows="16" spellcheck="false">${esc(item.body)}</textarea>
            <div class="var-chips" id="prVars">${vars.map((v) => `<button class="var-chip" data-var="${attr(v)}">{{${esc(v)}}}</button>`).join('') || '<span class="hint">No template variables detected.</span>'}</div>
          </div>
          <div class="row mt-3">
            <button class="btn primary" id="prSave">${icon('check')} Save prompt</button>
            <button class="btn" id="prPreview">${icon('eye')} Render preview</button>
            <button class="btn" id="prTest">${icon('zap')} Test with Gemini</button>
            <button class="btn ghost" id="prDuplicate">${icon('copy')} Duplicate</button>
            ${item.isDefault ? '' : `<button class="btn ghost" id="prReset">${icon('refresh')} Reset to built-in</button>`}
            <button class="btn danger" id="prDelete">${icon('trash')}</button>
          </div>
          <div id="prOutput" class="mt-3"></div>
        </div>`;

      $$('#prVars [data-var]').forEach((b) => b.addEventListener('click', () => {
        const ta = $('#prBody');
        const token = `{{${b.dataset.var}}}`;
        const start = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, start) + token + ta.value.slice(ta.selectionEnd ?? start);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + token.length;
      }));

      $('#prSave').addEventListener('click', async () => {
        const body = { name: $('#prName').value.trim(), body: $('#prBody').value, category: item.category };
        if (!body.name || !body.body.trim()) return toast('Name and body are required.', 'warn');
        try {
          await api(`/api/prompts/${item.id}`, { method: 'PUT', body });
          item.name = body.name; item.body = body.body;
          toast('Prompt saved.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#prPreview').addEventListener('click', async () => {
        try {
          const out = await api('/api/prompts/preview', {
            method: 'POST',
            body: { body: $('#prBody').value, variables: sampleVars(item.category) },
          });
          $('#prOutput').innerHTML = `<div class="banner info" style="display:block"><strong style="display:block;margin-bottom:6px">Rendered preview (sample values)</strong><pre class="htmllint" style="margin:0;max-height:260px;overflow:auto">${esc(out.rendered)}</pre></div>`;
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#prTest').addEventListener('click', async () => {
        const btn = $('#prTest');
        btn.disabled = true;
        $('#prOutput').innerHTML = `<div class="banner info">${icon('info')}<span>Calling Gemini with sample variables…</span></div>`;
        try {
          const out = await api('/api/prompts/test', {
            method: 'POST',
            body: { body: $('#prBody').value, variables: sampleVars(item.category) },
          });
          $('#prOutput').innerHTML = `<div class="banner success" style="display:block"><strong style="display:block;margin-bottom:6px">Gemini output · ${esc(out.durationMs)} ms</strong><div style="white-space:pre-wrap;font-size:12px;color:#c8d6ca;max-height:300px;overflow:auto">${esc(out.output)}</div></div>`;
        } catch (err) {
          $('#prOutput').innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
        } finally { btn.disabled = false; }
      });
      $('#prDuplicate')?.addEventListener('click', async () => {
        try {
          const out = await api(`/api/prompts/${item.id}/duplicate`, { method: 'POST' });
          p.activeId = out.id;
          toast('Prompt duplicated.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#prDefault')?.addEventListener('click', async () => {
        try {
          await api(`/api/prompts/${item.id}/default`, { method: 'POST' });
          toast('Default prompt updated.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#prReset')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Reset to built-in?', message: 'The stored body is replaced with the built-in default. Your edits are lost.', confirmLabel: 'Reset', danger: true });
        if (!ok) return;
        try {
          await api(`/api/prompts/${item.id}/reset`, { method: 'POST' });
          toast('Prompt reset.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#prDelete')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete this prompt?', message: 'At least one prompt must remain per category.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try {
          await api(`/api/prompts/${item.id}`, { method: 'DELETE' });
          p.activeId = null;
          toast('Prompt deleted.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    async function newPrompt() {
      const m = openModal({
        title: 'New prompt',
        subtitle: `Category: ${PROMPT_LABELS[p.category] || p.category}`,
        body: `<div class="field mb-2"><label>Name</label><input type="text" id="npName" maxlength="120" placeholder="e.g. My high-protein recipe prompt" /></div>
          <div class="field"><label>Body</label><textarea id="npBody" class="prompt-editor" rows="12" placeholder="Write the instruction. Use {{variables}} for dynamic values."></textarea></div>`,
        footer: `<button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Create prompt</button>`,
      });
      $('[data-act="cancel"]', m.overlay).addEventListener('click', m.close);
      $('[data-act="save"]', m.overlay).addEventListener('click', async () => {
        try {
          const out = await api('/api/prompts', {
            method: 'POST',
            body: { category: p.category, name: $('#npName', m.overlay).value.trim(), body: $('#npBody', m.overlay).value },
          });
          m.close();
          p.activeId = out.id;
          toast('Prompt created.', 'success');
          await reload();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    async function reload() {
      const r = await api('/api/prompts');
      p.items = r.items; p.categories = r.categories;
      renderList(); renderEditor();
    }

    renderList();
    renderEditor();
  }

  function sampleVars(category) {
    const map = {
      topic_generation: { niche: 'healthy high-protein food', category: 'High Protein', count: '5', used_topics: 'none yet', language: 'English' },
      image_generation: { topic: 'High-protein chicken and broccoli rice bowl', food_name: 'chicken and broccoli rice bowl', image_style: 'Realistic Food Photography', custom_instructions: 'None', language: 'English' },
      image_analysis: { topic: 'High-protein chicken and broccoli rice bowl', language: 'English' },
      recipe_generation: { topic: 'High-protein chicken and broccoli rice bowl', language: 'English', category: 'High Protein', servings: '2', nutrition_goals: '{"protein":40}', image_analysis: 'No analysis', custom_instructions: 'None', used_titles: 'none' },
      nutrition_mapping: { ingredients: '200 g chicken breast\n150 g broccoli\n100 g rice' },
      seo_content: { recipe_title: 'High-Protein Chicken and Broccoli Bowl', topic: 'chicken broccoli bowl', category: 'High Protein', description: 'A quick high-protein bowl.', keywords: 'high protein, meal prep', language: 'English' },
      blogger_formatting: { recipe_title: 'High-Protein Chicken and Broccoli Bowl', content: 'Sample content' },
      content_instructions: { site_name: 'Nourish Studio', niche: 'healthy high-protein food', language: 'English' },
    };
    return map[category] || {};
  }

  /* ================================================================ */
  /* CONNECTIONS                                                      */
  /* ================================================================ */

  function copyField(value) {
    return `<div class="copyfield"><code>${esc(value || '—')}</code>
      <button class="icon-btn" data-copy="${attr(value)}" title="Copy">${icon('copy')}</button></div>`;
  }

  function maskPlaceholder(summary, field = 'keyMasked') {
    return summary?.[field] ? ` placeholder="${attr(summary[field])}"` : '';
  }

  function rerenderConnections(root) {
    if (state.view === 'connections') renderConnections(root);
  }

  async function renderConnections(root) {
    root.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Reading connection state…</span></div>`;
    let data;
    try { data = await api('/api/connections'); }
    catch (err) { root.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`; return; }
    state.connections = data.connections;
    state.selections = data.selections;
    state.envHints = data.envHints;
    syncConnectionDots();

    const c = data.connections;
    const env = data.envHints;
    const sel = data.selections;
    const g = c.google || {};
    const pi = c.pinterest || {};
    const gem = c.gemini || {};
    const cloud = c.cloudinary || {};
    const nut = c.nutrition || {};

    root.innerHTML = `
      <div class="section-title">
        <div><h2>API connections</h2><p>Keys are encrypted with AES-256-GCM on the server and never sent back to the browser.</p></div>
        <span class="badge b-gray no-dot">${esc(env.database)}</span>
      </div>

      <div class="grid cols-2" style="align-items:start">
        <section class="card conn-card">
          <div class="conn-head">
            <div class="conn-logo gemini">${icon('sparkles')}</div>
            <div class="grow"><h3>Google Gemini</h3><p>Text, vision and image generation · ${esc(gem.source === 'environment' ? 'key from environment' : gem.configured ? 'key stored in database' : 'not configured')}</p></div>
            <span class="badge ${gem.configured ? 'b-green' : 'b-red'}">${gem.configured ? 'Connected' : 'Missing'}</span>
          </div>
          <div class="conn-body">
            <div class="field"><label>API key</label>
              <input type="password" id="gemKey" autocomplete="off" spellcheck="false" placeholder="${gem.configured ? esc(gem.keyMasked || '••••••••') : 'AIza…'}" />
              <span class="hint">${gem.configured ? 'Leave blank to keep the saved key.' : 'Get a free key at aistudio.google.com/apikey.'}</span></div>
            <div class="grid cols-2">
              <div class="field"><label>Text model</label><input type="text" id="gemText" value="${attr(gem.textModel)}" /></div>
              <div class="field"><label>Image model</label><input type="text" id="gemImage" value="${attr(gem.imageModel)}" /></div>
            </div>
            ${gem.lastTest ? `<div class="hint">Last test ${esc(relTime(gem.verifiedAt || gem.lastTest.at))}: ${gem.lastTest.ok ? 'passed' : 'failed'}${gem.lastTest.message ? ` · ${esc(gem.lastTest.message)}` : ''}</div>` : ''}
          </div>
          <div class="conn-foot">
            <button class="btn sm" data-c="gemTest">${icon('zap')} Test</button>
            <button class="btn sm primary" data-c="gemSave">${icon('check')} Save</button>
            ${gem.configured ? `<button class="btn sm danger" data-c="gemRemove" title="Remove saved key">${icon('trash')}</button>` : ''}
          </div>
        </section>

        <section class="card conn-card">
          <div class="conn-head">
            <div class="conn-logo cloudinary">${icon('cloud')}</div>
            <div class="grow"><h3>Cloudinary</h3><p>Public image hosting · required for Pinterest</p></div>
            <span class="badge ${cloud.configured ? 'b-green' : 'b-amber'}">${cloud.configured ? 'Connected' : 'Optional'}</span>
          </div>
          <div class="conn-body">
            <div class="grid cols-2">
              <div class="field"><label>Cloud name</label><input type="text" id="cloudName" value="${attr(cloud.cloudName || '')}" placeholder="my-cloud" /></div>
              <div class="field"><label>API key</label><input type="text" id="cloudKey" autocomplete="off"${maskPlaceholder(cloud, 'apiKeyMasked')} /></div>
            </div>
            <div class="field"><label>API secret</label><input type="password" id="cloudSecret" autocomplete="off" placeholder="${cloud.configured ? '•••••••• (saved)' : 'Required'}" /></div>
            <div class="hint">Generated images are always saved locally for preview. Cloudinary is used to obtain the public https URL Pinterest requires.</div>
          </div>
          <div class="conn-foot">
            <button class="btn sm" data-c="cloudTest">${icon('zap')} Test</button>
            <button class="btn sm primary" data-c="cloudSave">${icon('check')} Save</button>
            ${cloud.configured ? `<button class="btn sm danger" data-c="cloudRemove">${icon('trash')}</button>` : ''}
          </div>
        </section>
      </div>

      <div class="grid cols-2 mt-3" style="align-items:start">
        <section class="card conn-card">
          <div class="conn-head">
            <div class="conn-logo blogger">${icon('globe')}</div>
            <div class="grow"><h3>Blogger</h3><p>Google OAuth 2.0 · Blogger API v3</p></div>
            <span class="badge ${g.connected ? 'b-green' : g.configured ? 'b-amber' : 'b-red'}">${g.connected ? 'Connected' : g.configured ? 'App ready' : 'Missing'}</span>
          </div>
          <div class="conn-body">
            <div class="field"><label>OAuth client ID</label><input type="text" id="gClient" autocomplete="off"${maskPlaceholder(c.oauthApps?.google, 'clientIdMasked')} placeholder="…apps.googleusercontent.com" /></div>
            <div class="field"><label>OAuth client secret</label><input type="password" id="gSecret" autocomplete="off" placeholder="${c.oauthApps?.google?.configured ? '•••••••• (saved)' : 'Required'}" /></div>
            <div class="field"><label>Redirect URI</label>${copyField(g.redirectUri)}</div>
            ${g.connected ? `<div class="banner success">${icon('check')}<span>Connected${g.defaultBlogName ? ` to <strong>${esc(g.defaultBlogName)}</strong>` : ''}${g.hasRefreshToken ? ' · refresh token stored' : ''}</span></div>` : ''}
            ${g.connected ? `<div class="field"><label>Destination blog</label>
              <div class="saved-prompt-row"><select id="blogSelect"><option value="">Loading blogs…</option></select>
              <button class="btn sm" data-c="blogLoad">${icon('refresh')}</button></div></div>` : ''}
          </div>
          <div class="conn-foot">
            ${g.connected
              ? `<button class="btn sm" data-c="gTest">${icon('zap')} Test</button>
                 <button class="btn sm danger" data-c="gDisconnect">Disconnect</button>`
              : `<button class="btn sm primary" data-c="gConnect" ${c.oauthApps?.google?.configured ? '' : 'disabled'}>${icon('globe')} Connect Google</button>`}
            <button class="btn sm ghost" data-c="gSaveApp">Save app</button>
          </div>
          ${!c.oauthApps?.google?.configured ? `<div class="conn-body" style="padding-top:0"><div class="banner warn">${icon('alert')}<span>Add an OAuth client first. Enable “Blogger API v3” in Google Cloud and register the redirect URI above.</span></div></div>` : ''}
        </section>

        <section class="card conn-card">
          <div class="conn-head">
            <div class="conn-logo pinterest">${icon('pin')}</div>
            <div class="grow"><h3>Pinterest</h3><p>OAuth 2.0 · Pinterest API v5</p></div>
            <span class="badge ${pi.connected ? 'b-green' : pi.configured ? 'b-amber' : 'b-red'}">${pi.connected ? 'Connected' : pi.configured ? 'App ready' : 'Missing'}</span>
          </div>
          <div class="conn-body">
            <div class="field"><label>App ID</label><input type="text" id="pClient" autocomplete="off"${maskPlaceholder(c.oauthApps?.pinterest, 'clientIdMasked')} /></div>
            <div class="field"><label>App secret</label><input type="password" id="pSecret" autocomplete="off" placeholder="${c.oauthApps?.pinterest?.configured ? '•••••••• (saved)' : 'Required'}" /></div>
            <div class="field"><label>Redirect URI</label>${copyField(pi.redirectUri)}</div>
            ${pi.connected ? `<div class="banner success">${icon('check')}<span>Connected${pi.username ? ` as <strong>@${esc(pi.username)}</strong>` : ''}${pi.hasRefreshToken ? ' · refresh token stored' : ''}</span></div>` : ''}
            ${pi.connected ? `<div class="field"><label>Destination board</label>
              <div class="saved-prompt-row"><select id="boardSelect"><option value="">Loading boards…</option></select>
              <button class="btn sm" data-c="boardLoad">${icon('refresh')}</button></div></div>` : ''}
          </div>
          <div class="conn-foot">
            ${pi.connected
              ? `<button class="btn sm" data-c="pTest">${icon('zap')} Test</button>
                 <button class="btn sm danger" data-c="pDisconnect">Disconnect</button>`
              : `<button class="btn sm primary" data-c="pConnect" ${c.oauthApps?.pinterest?.configured ? '' : 'disabled'}>${icon('pin')} Connect Pinterest</button>`}
            <button class="btn sm ghost" data-c="pSaveApp">Save app</button>
          </div>
          ${!c.oauthApps?.pinterest?.configured ? `<div class="conn-body" style="padding-top:0"><div class="banner warn">${icon('alert')}<span>Create a Pinterest app, enable boards/pins scopes, and register the redirect URI above.</span></div></div>` : ''}
        </section>
      </div>

      <section class="card mt-3">
        <div class="conn-head">
          <div class="conn-logo nutrition">${icon('leaf')}</div>
          <div class="grow"><h3>Nutrition provider</h3><p>Nutrition is always computed on the server from ingredient quantities.</p></div>
          <span class="badge ${nut.configured ? 'b-green' : 'b-amber'}">${esc(nut.provider)}</span>
        </div>
        <div class="conn-body">
          <div class="form-grid">
            <div class="field"><label>Provider</label>
              <select id="nutProvider">
                <option value="builtin" ${nut.provider === 'builtin' ? 'selected' : ''}>Built-in reference dataset (no key)</option>
                <option value="usda" ${nut.provider === 'usda' ? 'selected' : ''}>USDA FoodData Central (API key)</option>
                <option value="gemini" ${nut.provider === 'gemini' ? 'selected' : ''}>Gemini ingredient mapping + built-in dataset</option>
              </select>
              <span class="hint">The built-in dataset covers ~100 common ingredients. USDA adds branded and broader foods.</span>
            </div>
            <div class="field"><label>USDA API key <span class="dim">(only for USDA)</span></label>
              <input type="password" id="nutKey" autocomplete="off"${maskPlaceholder(nut, 'usdaKeyMasked')} placeholder="${nut.usdaKeyMasked ? esc(nut.usdaKeyMasked) : 'Optional'}" /></div>
          </div>
          <div class="banner info mt-2">${icon('info')}<span>Image recognition is never used to estimate calories. If an ingredient cannot be matched, it is reported explicitly instead of being guessed.</span></div>
        </div>
        <div class="conn-foot">
          <button class="btn sm" data-c="nutTest">${icon('zap')} Test</button>
          <button class="btn sm primary" data-c="nutSave">${icon('check')} Save</button>
        </div>
      </section>

      <section class="card mt-3">
        <div class="card-head"><div class="grow"><h3>Server configuration</h3><div class="sub">Values read from environment variables — never editable secrets</div></div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>APP_URL</label>${copyField(env.APP_URL || 'http://localhost:3000')}</div>
            <div class="field"><label>Database driver</label>${copyField(env.database)}</div>
            <div class="field"><label>Cron endpoint</label>${copyField(`${env.APP_URL || location.origin}/api/cron/run`)}</div>
            <div class="field"><label>CRON_SECRET</label><div class="copyfield"><code>${env.hasCronSecret ? 'configured' : 'not set'}</code><span class="badge ${env.hasCronSecret ? 'b-green' : 'b-amber'}">${env.hasCronSecret ? 'OK' : 'Set it'}</span></div></div>
          </div>
          <p class="hint mt-2">The external scheduler must send <span class="mono">X-Cron-Secret</span>. render.yaml sets this up automatically for the bundled cron worker.</p>
        </div>
      </section>`;

    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
    bindConnectionActions(root, data);
  }

  function bindConnectionActions(root, data) {
    const c = data.connections;
    const on = (name, fn) => { const el = root.querySelector(`[data-c="${name}"]`); if (el) el.addEventListener('click', fn); };

    on('gemSave', async () => {
      try {
        const body = { apiKey: $('#gemKey').value.trim(), textModel: $('#gemText').value.trim(), imageModel: $('#gemImage').value.trim() };
        if (!body.apiKey) delete body.apiKey;
        await api('/api/connections/gemini', { method: 'PUT', body });
        toast('Gemini settings saved.', 'success');
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error'); }
    });
    on('gemTest', async () => {
      const btn = root.querySelector('[data-c="gemTest"]');
      btn.disabled = true;
      try {
        const body = { apiKey: $('#gemKey').value.trim(), textModel: $('#gemText').value.trim(), imageModel: $('#gemImage').value.trim() };
        if (!body.apiKey) delete body.apiKey;
        if (body.apiKey) await api('/api/connections/gemini', { method: 'PUT', body: { apiKey: body.apiKey, textModel: body.textModel, imageModel: body.imageModel } });
        const res = await api('/api/connections/gemini/test', { method: 'POST', body: {} });
        toast(res.message, res.ok ? 'success' : 'error', 8000);
        await refreshCore();
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error', 8000); btn.disabled = false; }
    });
    on('gemRemove', async () => {
      if (!await confirmDialog({ title: 'Remove Gemini key?', message: 'The saved key is deleted from the database. Content generation will stop until a new key is added.', confirmLabel: 'Remove key', danger: true })) return;
      try { await api('/api/connections/gemini', { method: 'DELETE' }); toast('Key removed.', 'success'); await refreshCore(); rerenderConnections(root); }
      catch (err) { toast(err.message, 'error'); }
    });

    on('cloudSave', async () => {
      try {
        const body = { cloudName: $('#cloudName').value.trim(), apiKey: $('#cloudKey').value.trim(), apiSecret: $('#cloudSecret').value.trim() };
        if (!body.apiKey) delete body.apiKey;
        if (!body.apiSecret) delete body.apiSecret;
        await api('/api/connections/cloudinary', { method: 'PUT', body });
        toast('Cloudinary settings saved.', 'success');
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error'); }
    });
    on('cloudTest', async () => {
      const body = { cloudName: $('#cloudName').value.trim(), apiKey: $('#cloudKey').value.trim(), apiSecret: $('#cloudSecret').value.trim() };
      if (!body.cloudName || !body.apiKey || !body.apiSecret) return toast('Enter cloud name, API key and secret to test.', 'warn');
      try {
        const res = await api('/api/connections/cloudinary/test', { method: 'POST', body });
        toast(res.message || (res.ok ? 'Cloudinary is reachable.' : 'Cloudinary test failed.'), res.ok ? 'success' : 'error', 7000);
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error', 7000); }
    });
    on('cloudRemove', async () => {
      if (!await confirmDialog({ title: 'Remove Cloudinary?', message: 'Pinterest publishing will be blocked until public image hosting is configured again.', confirmLabel: 'Remove', danger: true })) return;
      try { await api('/api/connections/cloudinary', { method: 'DELETE' }); toast('Cloudinary removed.', 'success'); await refreshCore(); rerenderConnections(root); }
      catch (err) { toast(err.message, 'error'); }
    });

    on('gSaveApp', async () => {
      try {
        const body = { clientId: $('#gClient').value.trim(), clientSecret: $('#gSecret').value.trim(), redirectUri: data.connections.google.redirectUri };
        if (!body.clientId) delete body.clientId;
        if (!body.clientSecret) delete body.clientSecret;
        await api('/api/connections/oauth/google', { method: 'PUT', body });
        toast('Google OAuth app saved.', 'success');
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error'); }
    });
    on('pSaveApp', async () => {
      try {
        const body = { clientId: $('#pClient').value.trim(), clientSecret: $('#pSecret').value.trim(), redirectUri: data.connections.pinterest.redirectUri };
        if (!body.clientId) delete body.clientId;
        if (!body.clientSecret) delete body.clientSecret;
        await api('/api/connections/oauth/pinterest', { method: 'PUT', body });
        toast('Pinterest app saved.', 'success');
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error'); }
    });
    on('gConnect', () => { window.location.href = '/auth/google'; });
    on('pConnect', () => { window.location.href = '/auth/pinterest'; });

    on('gTest', async () => {
      try {
        const res = await api('/api/connections/blogger/test', { method: 'POST', body: {} });
        toast(res.message || `Blogger reachable · ${res.blogs?.length || 0} blog(s)`, 'success', 7000);
        await refreshCore();
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error', 8000); }
    });
    on('pTest', async () => {
      try {
        const res = await api('/api/connections/pinterest/test', { method: 'POST', body: {} });
        toast(res.message || `Pinterest reachable · ${res.boards?.length || 0} board(s)`, 'success', 7000);
        await refreshCore();
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error', 8000); }
    });
    on('gDisconnect', async () => {
      if (!await confirmDialog({ title: 'Disconnect Blogger?', message: 'The OAuth tokens are deleted and the default blog selection is cleared. Published articles stay live.', confirmLabel: 'Disconnect', danger: true })) return;
      try { await api('/api/connections/blogger/disconnect', { method: 'POST', body: {} }); toast('Blogger disconnected.', 'success'); await refreshCore(); rerenderConnections(root); }
      catch (err) { toast(err.message, 'error'); }
    });
    on('pDisconnect', async () => {
      if (!await confirmDialog({ title: 'Disconnect Pinterest?', message: 'The OAuth tokens are deleted and the board selection is cleared. Existing Pins stay live.', confirmLabel: 'Disconnect', danger: true })) return;
      try { await api('/api/connections/pinterest/disconnect', { method: 'POST', body: {} }); toast('Pinterest disconnected.', 'success'); await refreshCore(); rerenderConnections(root); }
      catch (err) { toast(err.message, 'error'); }
    });

    on('blogLoad', loadBlogs);
    on('boardLoad', loadBoards);
    if (c.google?.connected) loadBlogs();
    if (c.pinterest?.connected) loadBoards();

    async function loadBlogs() {
      const sel = $('#blogSelect');
      if (!sel) return;
      sel.innerHTML = '<option value="">Loading…</option>';
      try {
        const res = await api('/api/connections/blogger/blogs');
        const blogs = res.blogs || [];
        if (!blogs.length) { sel.innerHTML = '<option value="">No blogs found on this account</option>'; return; }
        sel.innerHTML = blogs.map((b) => `<option value="${attr(b.id)}" data-name="${attr(b.name)}" data-url="${attr(b.url)}" ${b.id === c.google.defaultBlogId ? 'selected' : ''}>${esc(b.name)} · ${esc(b.url)}</option>`).join('');
        sel.onchange = async () => {
          const opt = sel.selectedOptions[0];
          try {
            await api('/api/connections/blogger/select', { method: 'POST', body: { blogId: sel.value, blogName: opt.dataset.name, blogUrl: opt.dataset.url } });
            toast('Destination blog saved.', 'success');
            await refreshCore();
          } catch (err) { toast(err.message, 'error'); }
        };
      } catch (err) {
        sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
      }
    }

    async function loadBoards() {
      const sel = $('#boardSelect');
      if (!sel) return;
      sel.innerHTML = '<option value="">Loading…</option>';
      try {
        const res = await api('/api/connections/pinterest/boards');
        const boards = res.boards || [];
        if (!boards.length) { sel.innerHTML = '<option value="">No boards found on this account</option>'; return; }
        sel.innerHTML = boards.map((b) => `<option value="${attr(b.id)}" data-name="${attr(b.name)}" ${b.id === c.pinterest.defaultBoardId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
        sel.onchange = async () => {
          const opt = sel.selectedOptions[0];
          try {
            await api('/api/connections/pinterest/select', { method: 'POST', body: { boardId: sel.value, boardName: opt.dataset.name } });
            toast('Destination board saved.', 'success');
            await refreshCore();
          } catch (err) { toast(err.message, 'error'); }
        };
      } catch (err) {
        sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
      }
    }

    on('nutSave', async () => {
      try {
        await api('/api/connections/nutrition', {
          method: 'PUT',
          body: { provider: $('#nutProvider').value, usdaKey: $('#nutKey').value.trim() || undefined },
        });
        toast('Nutrition provider saved.', 'success');
        await refreshCore();
        rerenderConnections(root);
      } catch (err) { toast(err.message, 'error'); }
    });
    on('nutTest', async () => {
      try {
        const res = await api('/api/connections/nutrition/test', {
          method: 'POST',
          body: { provider: $('#nutProvider').value, usdaKey: $('#nutKey').value.trim() || undefined },
        });
        toast(res.message || (res.ok ? 'Nutrition provider is ready.' : 'Test failed.'), res.ok ? 'success' : 'error', 7000);
      } catch (err) { toast(err.message, 'error', 7000); }
    });
  }

  /* ================================================================ */
  /* AUTOMATION                                                       */
  /* ================================================================ */

  async function renderAutomation(root) {
    root.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading automation…</span></div>`;
    let data;
    try { data = await api('/api/automation'); }
    catch (err) { root.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`; return; }
    state.automation = data;
    const a = data.automation;
    const settings = state.settings || {};
    const cats = state.meta.categories.length ? state.meta.categories : ['High Protein'];
    const styles = state.meta.imageStyles.length ? state.meta.imageStyles : ['Realistic Food Photography'];
    const langs = state.meta.languages.length ? state.meta.languages : ['English'];
    const localTimes = [...new Set([...(a.times || ['09:00'])])];

    root.innerHTML = `
      <div class="section-title">
        <div><h2>Automation</h2><p>The cron worker reads these settings from PostgreSQL. It does not depend on this browser or an in-memory timer.</p></div>
        <div class="row">
          <span class="badge ${a.enabled ? 'b-green' : 'b-gray'}">${a.enabled ? 'Active' : 'Paused'}</span>
          <button class="btn primary sm" id="autoRun">${icon('zap')} Run now</button>
        </div>
      </div>

      <div class="grid cols-2" style="align-items:start">
        <section class="card">
          <div class="card-head"><div class="grow"><h3>Daily rhythm</h3><div class="sub">${esc(data.timezone)} · today ${data.todayCount || 0}/${a.postsPerDay || 1}</div></div>
            <button class="switch ${a.enabled ? 'on' : ''}" id="autoEnabled" role="switch" aria-checked="${a.enabled}"></button>
          </div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field"><label>Posts per day</label><input type="number" id="autoPerDay" min="1" max="20" value="${attr(a.postsPerDay)}" /></div>
              <div class="field"><label>Minimum gap (minutes)</label><input type="number" id="autoDelay" min="0" max="1440" value="${attr(a.minDelayMinutes)}" /></div>
            </div>
            <div class="field mt-2">
              <label>Posting times <span class="dim">(${esc(data.timezone)})</span></label>
              <div class="row" id="autoTimes" style="gap:6px">
                ${localTimes.map((t) => `<span class="time-chip">${esc(t)}<button data-rmtime="${attr(t)}" title="Remove">${icon('close')}</button></span>`).join('')}
                <input type="time" id="autoNewTime" style="width:120px" />
                <button class="btn sm" id="autoAddTime">${icon('plus')} Add</button>
              </div>
              <span class="hint">Each slot runs once. A DB lock and slot key prevent duplicate runs across workers.</span>
            </div>
            <div class="field mt-2">
              <label>Days</label>
              <div class="day-toggles" id="autoDays">
                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<button class="day-toggle ${a.daysOfWeek?.includes(i) ? 'on' : ''}" data-day="${i}">${d}</button>`).join('')}
              </div>
            </div>
            <div class="field mt-2">
              <label>Slot window</label>
              <div class="input-suffix"><input type="number" id="autoWindow" min="10" max="240" value="${attr(a.slotWindowMinutes || 45)}" /><span class="suffix">min</span></div>
              <span class="hint">How long after the scheduled time a run is still considered due.</span>
            </div>
            <hr class="divider" />
            <div class="stack" style="gap:8px">
              ${[
                ['autoTopic', 'Generate a fresh topic', 'Uses the topic prompt and avoids recent duplicates.'],
                ['autoImage', 'Generate the food photograph', 'Gemini image model · 2:3 vertical.'],
                ['autoContent', 'Write recipe, nutrition, SEO and article', 'The full content pipeline.'],
                ['autoBlogger', 'Publish to Blogger', 'Creates a live article with recipe schema.'],
                ['autoPinterest', 'Create the Pinterest Pin', 'Only after a valid Blogger URL exists.'],
                ['manualApproval', 'Manual approval', 'Generate as a draft instead of publishing.'],
              ].map(([key, title, hint]) => `<div class="switch-row">
                <div class="grow"><strong>${title}</strong><small>${hint}</small></div>
                <button class="switch ${a[key] !== false ? 'on' : ''}" data-atoggle="${key}" role="switch"></button>
              </div>`).join('')}
            </div>
          </div>
        </section>

        <div class="studio-stack">
          <section class="card">
            <div class="card-head"><div class="grow"><h3>Content defaults</h3><div class="sub">Applied to every automated post</div></div></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field"><label>Image style</label>
                  <select id="autoStyle">${styles.map((s) => `<option ${a.imageStyle === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
                <div class="field"><label>Language</label>
                  <select id="autoLang">${langs.map((l) => `<option ${a.language === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
              </div>
              <div class="field mt-2">
                <label>Categories <span class="dim">(one is chosen per post)</span></label>
                <div class="chip-input-grid">
                  ${cats.map((cat) => `<label class="check-chip ${a.categories?.includes(cat) ? 'on' : ''}"><input type="checkbox" data-cat-check="${attr(cat)}" ${a.categories?.includes(cat) ? 'checked' : ''} />${esc(cat)}</label>`).join('')}
                </div>
              </div>
              <div class="form-grid three mt-2">
                <div class="field"><label>Calories goal</label><input type="number" id="autoCal" min="0" value="${attr(a.nutritionGoals?.calories ?? '')}" /></div>
                <div class="field"><label>Protein goal (g)</label><input type="number" id="autoProtein" min="0" value="${attr(a.nutritionGoals?.protein ?? '')}" /></div>
                <div class="field"><label>Fiber goal (g)</label><input type="number" id="autoFiber" min="0" value="${attr(a.nutritionGoals?.fiber ?? '')}" /></div>
              </div>
              <div class="row mt-3">
                <button class="btn primary" id="autoSave">${icon('check')} Save automation</button>
                <button class="btn" id="autoTest">${icon('sparkles')} Generate test post</button>
              </div>
              <p class="hint mt-2">A test post is generated but never published.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div class="grow"><h3>Next run</h3><div class="sub">Computed from your slots</div></div></div>
            <div class="card-body">
              <div class="automation-state">
                <div class="state-orb ${a.enabled ? 'on' : ''}">${icon('clock')}</div>
                <div class="grow">
                  <strong style="font-size:13.5px">${data.nextRun ? esc(`${fmtDate(data.nextRun.timestamp)} at ${data.nextRun.time}`) : 'Automation is paused'}</strong>
                  <p class="small muted" style="margin-top:2px">${data.nextRun ? esc(nextRunLabel(data.nextRun)) : 'Enable the switch to start the schedule.'}</p>
                </div>
              </div>
              <hr class="divider" />
              <div class="between" style="font-size:12px"><span class="muted">Cron worker</span><span class="mono">node server.js worker</span></div>
              <div class="between mt-2" style="font-size:12px"><span class="muted">Render schedule</span><span class="mono">*/15 * * * *</span></div>
              <div class="between mt-2" style="font-size:12px"><span class="muted">Timezone</span><span class="mono">${esc(data.timezone)}</span></div>
              <div class="banner info mt-3">${icon('info')}<span>On Render, the cron service runs independently of the web service. The bundled <span class="mono">render.yaml</span> wires both to the same PostgreSQL database and encryption secret.</span></div>
            </div>
          </section>
        </div>
      </div>

      <section class="card mt-3">
        <div class="card-head"><div class="grow"><h3>Recent automation runs</h3><div class="sub">Stored, not simulated</div></div>
          <button class="btn sm ghost" id="autoRefresh">${icon('refresh')} Refresh</button></div>
        ${data.runs?.length ? `<div class="table-wrap" style="border:0;border-radius:0">
          <table class="data"><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Post</th><th>Detail</th><th>Duration</th></tr></thead>
          <tbody>${data.runs.map((r) => `<tr>
            <td class="nowrap">${esc(fmtDateTime(r.started_at))}</td>
            <td><span class="tag">${esc(r.trigger || r.job_type)}</span></td>
            <td><span class="badge ${r.status === 'Completed' ? 'b-green' : r.status === 'Failed' ? 'b-red' : 'b-amber'}">${esc(r.status)}</span></td>
            <td>${r.post_id ? `<button class="link-btn" data-runpost="${attr(r.post_id)}">Open post</button>` : '—'}</td>
            <td><span class="dim" style="font-size:11px;display:block;max-width:320px;white-space:normal">${esc(r.error || r.scheduled_for || '—')}</span></td>
            <td class="dim nowrap">${r.finished_at ? esc(`${Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)}s`) : '—'}</td>
          </tr>`).join('')}</tbody></table></div>`
          : `<div class="empty" style="padding:34px"><div class="empty-icon">${icon('repeat')}</div><h3>No runs yet</h3><p>Run the pipeline manually or wait for the next scheduled slot.</p></div>`}
      </section>`;

    const times = new Set(localTimes);
    function paintTimes() {
      const wrap = $('#autoTimes');
      const input = $('#autoNewTime');
      const addBtn = $('#autoAddTime');
      const existingButtons = [...wrap.querySelectorAll('[data-rmtime]')].map((b) => b.parentElement);
      existingButtons.forEach((e) => e.remove());
      [...times].sort().forEach((t) => {
        const span = document.createElement('span');
        span.className = 'time-chip';
        span.innerHTML = `${esc(t)}<button data-rmtime="${attr(t)}" title="Remove">${icon('close')}</button>`;
        wrap.insertBefore(span, input);
      });
      wrap.querySelectorAll('[data-rmtime]').forEach((b) => b.addEventListener('click', () => { times.delete(b.dataset.rmtime); paintTimes(); }));
      if (input) input.style.display = '';
      if (addBtn) addBtn.style.display = '';
    }
    paintTimes();
    $('#autoAddTime').addEventListener('click', () => {
      const v = $('#autoNewTime').value;
      if (!v) return toast('Pick a time first.', 'warn');
      times.add(v); $('#autoNewTime').value = ''; paintTimes();
    });
    $$('[data-atoggle]', root).forEach((sw) => sw.addEventListener('click', () => sw.classList.toggle('on')));
    $$('[data-day]', root).forEach((b) => b.addEventListener('click', () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', on);
    }));
    root.querySelectorAll('.check-chip input').forEach((inp) => inp.addEventListener('change', () => inp.closest('.check-chip').classList.toggle('on', inp.checked)));

    async function saveAutomation(showToast = true) {
      const days = $$('#autoDays .day-toggle.on').map((b) => Number(b.dataset.day));
      const categories = $$('[data-cat-check]').filter((i) => i.checked).map((i) => i.dataset.catCheck);
      const body = {
        enabled: $('#autoEnabled').classList.contains('on'),
        postsPerDay: Math.max(1, Math.min(20, Number($('#autoPerDay').value) || 1)),
        minDelayMinutes: Math.max(0, Math.min(1440, Number($('#autoDelay').value) || 0)),
        times: [...times],
        daysOfWeek: days,
        slotWindowMinutes: Math.max(10, Math.min(240, Number($('#autoWindow').value) || 45)),
        imageStyle: $('#autoStyle').value,
        language: $('#autoLang').value,
        categories,
        nutritionGoals: {
          calories: $('#autoCal').value ? Number($('#autoCal').value) : null,
          protein: $('#autoProtein').value ? Number($('#autoProtein').value) : null,
          fiber: $('#autoFiber').value ? Number($('#autoFiber').value) : null,
        },
      };
      for (const sw of $$('[data-atoggle]', root)) body[sw.dataset.atoggle] = sw.classList.contains('on');
      try {
        const res = await api('/api/automation', { method: 'PUT', body });
        state.settings.automation = res.automation;
        applyBranding();
        if (showToast) toast('Automation saved.', 'success');
        return res;
      } catch (err) { toast(err.message, 'error'); return null; }
    }

    $('#autoSave').addEventListener('click', async () => {
      const res = await saveAutomation();
      if (res) { await refreshCore().catch(() => {}); if (state.view === 'automation') renderAutomation(root); }
    });
    $('#autoRefresh').addEventListener('click', () => renderAutomation(root));
    $('#autoRun').addEventListener('click', quickPostNow);
    $('#autoTest').addEventListener('click', async () => {
      const saved = await saveAutomation(false);
      if (!saved) return;
      const ok = await confirmDialog({
        title: 'Generate a test post?',
        message: 'This runs the real AI pipeline with the settings above and consumes Gemini quota. It will not publish anything.',
        confirmLabel: 'Generate',
      });
      if (!ok) return;
      const done = busy('Generating a test post…', 'Real pipeline, no publishing');
      try {
        const res = await api('/api/automation/generate-test', { method: 'POST', body: {} });
        done();
        toast('Test post generated as a draft.', 'success');
        await refreshCore().catch(() => {});
        if (state.view === 'automation') renderAutomation(root);
        openPostDetail(res.post.id);
      } catch (err) { done(); toast(err.message, 'error', 10_000); }
    });
    root.querySelectorAll('[data-runpost]').forEach((b) => b.addEventListener('click', () => openPostDetail(b.dataset.runpost)));
  }

  /* ================================================================ */
  /* LOGS                                                             */
  /* ================================================================ */

  async function renderLogs(root) {
    const l = state.logs;
    root.innerHTML = `
      <div class="section-title">
        <div><h2>Activity logs</h2><p>Every integration call, publish attempt and scheduler decision. Secrets are scrubbed before storage.</p></div>
        <div class="row">
          <button class="btn ghost sm" id="logRefresh">${icon('refresh')} Refresh</button>
          <button class="btn danger sm" id="logClear">${icon('trash')} Clear</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input type="text" id="logSearch" placeholder="Search messages…" value="${attr(l.search)}" /></div>
        <select id="logLevel" style="max-width:150px">
          ${[['all', 'All levels'], ['success', 'Success'], ['warning', 'Warnings'], ['error', 'Errors'], ['info', 'Info']].map(([k, v]) => `<option value="${k}" ${l.level === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="logService" style="max-width:170px"><option value="all">All services</option></select>
        <button class="btn ghost sm" id="logReload">${icon('filter')} Apply</button>
      </div>
      <div id="logBody"><div class="loading-block"><span class="spinner lg"></span><span>Loading logs…</span></div></div>`;

    let timer;
    $('#logSearch').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { l.search = e.target.value.trim(); l.page = 1; load(); }, 350);
    });
    $('#logLevel').addEventListener('change', (e) => { l.level = e.target.value; l.page = 1; load(); });
    $('#logService').addEventListener('change', (e) => { l.service = e.target.value; l.page = 1; load(); });
    $('#logRefresh').addEventListener('click', load);
    $('#logReload').addEventListener('click', load);
    $('#logClear').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Clear activity logs?', message: 'This permanently deletes log entries. Posts, schedules and settings are not affected.', confirmLabel: 'Clear all logs', danger: true });
      if (!ok) return;
      try { await api('/api/logs?all=true', { method: 'DELETE' }); toast('Logs cleared.', 'success'); await load(); }
      catch (err) { toast(err.message, 'error'); }
    });
    await load();

    async function load() {
      const body = $('#logBody');
      body.innerHTML = `<div class="loading-block"><span class="spinner lg"></span><span>Loading logs…</span></div>`;
      const q = new URLSearchParams({ page: l.page, limit: l.limit });
      if (l.level !== 'all') q.set('level', l.level);
      if (l.service !== 'all') q.set('service', l.service);
      if (l.search) q.set('search', l.search);
      try {
        const res = await api(`/api/logs?${q.toString()}`);
        l.items = res.items; l.total = res.total; l.pages = res.pages;
        const serviceSel = $('#logService');
        const current = l.service;
        serviceSel.innerHTML = '<option value="all">All services</option>' + (res.services || []).map((s) => `<option ${current === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
        body.innerHTML = res.items.length ? `
          <div class="card" style="overflow:hidden">
            ${res.items.map((x) => `
              <div class="log-row">
                <span class="ts">${esc(fmtDateTime(x.created_at))}</span>
                <span><span class="badge ${x.level === 'success' ? 'b-green' : x.level === 'error' ? 'b-red' : x.level === 'warning' ? 'b-amber' : 'b-blue'}">${esc(x.level)}</span></span>
                <span class="svc">${esc(x.service || 'app')}</span>
                <span class="msg">${esc(x.message)}${x.operation ? `<br /><span class="op dim">${esc(x.operation)}${x.post_id ? ` · post ${esc(x.post_id.slice(0, 8))}` : ''}</span>` : ''}</span>
                <span class="dur">${x.duration_ms != null ? `${esc(x.duration_ms)} ms` : ''}</span>
              </div>`).join('')}
          </div>
          <div class="pager">
            <span class="pager-info">${l.total} entries · page ${l.page} of ${l.pages}</span>
            <div class="pager-controls">
              <button data-page="${l.page - 1}" ${l.page <= 1 ? 'disabled' : ''}>${icon('left')}</button>
              <button data-page="${l.page + 1}" ${l.page >= l.pages ? 'disabled' : ''}>${icon('right')}</button>
            </div>
          </div>`
          : `<div class="card"><div class="empty"><div class="empty-icon">${icon('terminal')}</div><h3>No log entries</h3><p>${l.search || l.level !== 'all' || l.service !== 'all' ? 'No entries match these filters.' : 'The studio has not performed any actions yet.'}</p></div></div>`;
        body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
          const n = Number(b.dataset.page);
          if (!n || n < 1 || n > l.pages) return;
          l.page = n; load();
        }));
      } catch (err) {
        body.innerHTML = `<div class="banner error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
      }
    }
  }

  /* ================================================================ */
  /* SETTINGS                                                         */
  /* ================================================================ */

  async function renderSettings(root) {
    const settings = state.settings || {};
    const goals = settings.defaultNutritionGoals || {};
    const cats = state.meta.categories.length ? state.meta.categories : ['High Protein'];
    const styles = state.meta.imageStyles.length ? state.meta.imageStyles : ['Realistic Food Photography'];
    const langs = state.meta.languages.length ? state.meta.languages : ['English'];
    const tzs = state.meta.timezones.length ? state.meta.timezones : ['Asia/Dhaka'];

    root.innerHTML = `
      <div class="section-title">
        <div><h2>Settings</h2><p>Studio identity, defaults, publishing rules and owner security.</p></div>
        <button class="btn ghost sm" id="setWizard">${icon('wand')} Re-run setup wizard</button>
      </div>

      <section class="card">
        <div class="card-head"><div class="grow"><h3>Studio identity</h3><div class="sub">Shown in the dashboard and used by prompts</div></div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Studio / site name</label><input type="text" id="setSite" maxlength="80" value="${attr(settings.siteName)}" /></div>
            <div class="field"><label>Tagline</label><input type="text" id="setTag" maxlength="120" value="${attr(settings.tagline)}" /></div>
            <div class="field span-2"><label>Niche / audience</label><input type="text" id="setNiche" maxlength="160" value="${attr(settings.niche)}" />
              <span class="hint">Used by the topic prompt so ideas stay on-brand.</span></div>
            <div class="field"><label>Timezone</label><select id="setTz">${tzs.map((t) => `<option ${settings.timezone === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
            <div class="field"><label>Default language</label><select id="setLang">${langs.map((t) => `<option ${settings.language === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          </div>
        </div>
      </section>

      <section class="card mt-3">
        <div class="card-head"><div class="grow"><h3>Content defaults</h3><div class="sub">Applied when you create a post without overriding fields</div></div></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Default category</label><select id="setCat">${cats.map((c) => `<option ${settings.defaultCategory === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            <div class="field"><label>Default image style</label><select id="setStyle">${styles.map((s) => `<option ${settings.defaultImageStyle === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="field"><label>Default servings</label><input type="number" id="setServings" min="1" max="50" value="${attr(settings.defaultServings)}" /></div>
            <div class="field"><label>Nutrition goal</label>
              <div class="grid cols-2" style="gap:8px">
                <div class="input-suffix"><input type="number" id="setCal" min="0" value="${attr(goals.calories ?? '')}" placeholder="kcal" /><span class="suffix">kcal</span></div>
                <div class="input-suffix"><input type="number" id="setProtein" min="0" value="${attr(goals.protein ?? '')}" placeholder="protein" /><span class="suffix">g</span></div>
              </div>
              <span class="hint">A reference target for recipe design, not a medical prescription.</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card mt-3">
        <div class="card-head"><div class="grow"><h3>Publishing rules</h3><div class="sub">Safety rails around platform ordering</div></div></div>
        <div class="card-body stack" style="gap:10px">
          <div class="switch-row">
            <div class="grow"><strong>Update existing Blogger articles</strong><small>Re-publishing an article updates it instead of creating a duplicate.</small></div>
            <button class="switch ${settings.publishing?.updateExistingBloggerPost ? 'on' : ''}" data-ptoggle="updateExistingBloggerPost" role="switch"></button>
          </div>
          <div class="switch-row">
            <div class="grow"><strong>Allow Pinterest without a Blogger URL</strong><small>Off by default. Pinterest will link to APP_URL instead of the article if enabled.</small></div>
            <button class="switch ${settings.publishing?.allowPinterestWithoutBlogger ? 'on' : ''}" data-ptoggle="allowPinterestWithoutBlogger" role="switch"></button>
          </div>
          <div class="banner warn">${icon('alert')}<span>Pinterest publishing is blocked unless a live Blogger URL exists, or the override above is explicitly enabled.</span></div>
        </div>
      </section>

      <div class="row mt-3">
        <button class="btn primary" id="setSave">${icon('check')} Save settings</button>
        <span class="hint">Changes are saved to PostgreSQL and used by the cron worker immediately.</span>
      </div>

      <div class="split mt-4">
        <section class="card">
          <div class="card-head"><div class="grow"><h3>Owner security</h3><div class="sub">${esc(state.session?.user?.username || 'admin')}</div></div></div>
          <div class="card-body">
            <div class="field mb-2"><label>Current password</label><input type="password" id="pwCurrent" autocomplete="current-password" /></div>
            <div class="form-grid">
              <div class="field"><label>New password</label><input type="password" id="pwNew" autocomplete="new-password" minlength="8" /></div>
              <div class="field"><label>Confirm new password</label><input type="password" id="pwConfirm" autocomplete="new-password" minlength="8" /></div>
            </div>
            <div class="row mt-3"><button class="btn" id="pwSave">${icon('lock')} Change password</button>
              <span class="hint">Other sessions are signed out.</span></div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="grow"><h3>System</h3><div class="sub">Read-only environment information</div></div>
            <span class="badge b-gray no-dot">v${esc(state.meta.version || '1.0.0')}</span></div>
          <div class="card-body">
            <div class="confirm-list">
              <div class="row"><span>Application</span><strong>Nourish Studio</strong></div>
              <div class="row"><span>Database</span><strong>${esc(state.envHints?.database || '—')}</strong></div>
              <div class="row"><span>Public URL</span><strong>${esc(state.envHints?.APP_URL || location.origin)}</strong></div>
              <div class="row"><span>Cron secret</span><strong>${state.envHints?.hasCronSecret ? 'Configured' : 'Not set'}</strong></div>
              <div class="row"><span>Gemini</span><strong>${state.connections?.gemini?.configured ? 'Configured' : 'Missing'}</strong></div>
            </div>
            <hr class="divider" />
            <div class="row">
              <a class="btn sm ghost" href="/health" target="_blank" rel="noopener">${icon('shield')} Health check</a>
              <a class="btn sm ghost" href="/api/cron/run" target="_blank" rel="noopener" onclick="return false" title="Requires the cron secret header">${icon('clock')} Cron endpoint</a>
            </div>
            <p class="hint mt-2">The cron endpoint requires <span class="mono">X-Cron-Secret</span> or an authenticated owner session.</p>
          </div>
        </section>
      </div>`;

    root.querySelectorAll('[data-ptoggle]').forEach((sw) => sw.addEventListener('click', () => sw.classList.toggle('on')));
    $('#setWizard').addEventListener('click', () => openSetupWizard(0));

    $('#setSave').addEventListener('click', async () => {
      const body = {
        siteName: $('#setSite').value.trim(),
        tagline: $('#setTag').value.trim(),
        niche: $('#setNiche').value.trim(),
        timezone: $('#setTz').value,
        language: $('#setLang').value,
        defaultCategory: $('#setCat').value,
        defaultImageStyle: $('#setStyle').value,
        defaultServings: Number($('#setServings').value) || 2,
        defaultNutritionGoals: {
          calories: $('#setCal').value ? Number($('#setCal').value) : null,
          protein: $('#setProtein').value ? Number($('#setProtein').value) : null,
        },
        publishing: {
          updateExistingBloggerPost: $('[data-ptoggle="updateExistingBloggerPost"]').classList.contains('on'),
          allowPinterestWithoutBlogger: $('[data-ptoggle="allowPinterestWithoutBlogger"]').classList.contains('on'),
        },
      };
      try {
        const res = await api('/api/settings', { method: 'PUT', body });
        state.settings = res.settings;
        applyBranding();
        toast('Settings saved.', 'success');
        await refreshCore().catch(() => {});
        if (state.view === 'settings') renderSettings(root);
      } catch (err) { toast(err.message, 'error'); }
    });

    $('#pwSave').addEventListener('click', async () => {
      const current = $('#pwCurrent').value;
      const next = $('#pwNew').value;
      if (newnextShort(next)) return;
      if (next !== $('#pwConfirm').value) return toast('New passwords do not match.', 'warn');
      try {
        await api('/api/settings/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
        toast('Password changed. Other sessions were signed out.', 'success', 6000);
        $('#pwCurrent').value = ''; $('#pwNew').value = ''; $('#pwConfirm').value = '';
      } catch (err) { toast(err.message, 'error'); }
    });
    function newnextShort(v) {
      if (!v || v.length < 8) { toast('New password must be at least 8 characters.', 'warn'); return true; }
      return false;
    }
  }

  /* ================================================================ */
  /* SHARED STUDIO REFRESH                                            */
  /* ================================================================ */

  function renderStudioPreview() {
    if (state.view === 'create' && $('#view')) renderCreate($('#view'));
  }

  /* close IIFE */
})();

