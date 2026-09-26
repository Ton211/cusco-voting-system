// =====================================================================
//  Small DOM / formatting / toast helpers
// =====================================================================

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

function fmtNum(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-US');
}

function fmtDate(ts) {
  if (!ts) return 'Not set';
  const d = tsToDate(ts);
  return isNaN(d.getTime()) ? 'Not set' : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(ts) {
  if (!ts) return 'Not set';
  const d = tsToDate(ts);
  if (isNaN(d.getTime())) return 'Not set';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function tsToDate(ts) {
  if (ts instanceof Date) return ts;
  if (ts && ts.seconds !== undefined && ts.nanoseconds !== undefined) return new Date(ts.seconds * 1000);
  if (ts && ts._seconds !== undefined) return new Date(ts._seconds * 1000);
  return new Date(ts);
}

// datetime-local input value -> ISO string for storage
function dtLocalToISO(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function shortId(prefix) {
  return (prefix || '') + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---------------------------------------------------------------
//  Toast notifications
// ---------------------------------------------------------------
let toastRoot = null;

function toast(message, type) {
  const TYPES = { success: '#16a34a', error: '#dc2626', info: '#4f46e5', warn: '#d97706' };
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toast-root';
    document.body.appendChild(toastRoot);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderLeftColor = TYPES[type || 'info'];
  t.textContent = message;
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-hide');
    setTimeout(() => t.remove(), 300);
  }, 3600);
}

// ---------------------------------------------------------------
//  Nice error message for Firebase Function / SDK errors
// ---------------------------------------------------------------
function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  const code = err.code || (err.details && err.details.code) || '';
  const map = {
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found for that email.',
    'auth/user-disabled': 'This account has been deactivated.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/invalid-login-credentials': 'Incorrect email or password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/email-already-in-use': 'That email is already registered.',
    'unauthenticated': 'You must be signed in.',
    'permission-denied': 'You do not have permission to do that.',
    'functions/not-found': 'Feature is not deployed yet. Deploy Cloud Functions.'
  };
  const safe = err.message && err.message.includes(':') ? err.message.split(':').slice(1).join(':').trim() : err.message;
  return map[code] || safe || 'Something went wrong.';
}

// Resolve an httpsCallable error into a friendly message + code
function callFriendly(err) {
  if (err && err.details && err.details.error) {
    return { code: err.details.error.code || 'unknown', message: err.details.error.message || err.message || 'Something went wrong.' };
  }
  return { code: err.code || 'unknown', message: friendlyError(err) };
}

// ---------------------------------------------------------------
//  Real-time sync: Firestore snapshot listeners instead of polling.
//
//  Attaches onSnapshot to every ref (collection / query / document).
//  Any change schedules reload() at once (debounced ~400ms so a burst
//  of related writes still causes a single refresh), so the screen
//  updates the moment data changes — no manual refresh, no waiting
//  for the next poll tick.
//
//  Same safety guards as autoLive: while the tab is hidden, a dialog
//  is open, or the user is typing, updates wait and are applied by
//  the 2s safety-net tick instead — forms are never clobbered
//  mid-edit. opts.allowModal skips the modal guard for pages whose
//  open dialog IS the live view (admin Live graphs).
//
//  Returns stop(); also stops automatically on page unload.
// ---------------------------------------------------------------
function liveCollections(refs, reload, opts) {
  const o = opts || {};
  let busy = false;
  let pending = false;
  let stopped = false;
  let debounce = null;
  const unsubs = [];

  function guardsBusy() {
    if (document.hidden) return true;
    if (!o.allowModal && document.querySelector('.modal.modal-open')) return true;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return true;
    return false;
  }

  async function run() {
    if (busy || stopped) return;
    busy = true;
    try { await reload(); } catch (e) {}
    busy = false;
    if (pending && !guardsBusy()) { pending = false; run(); }
  }

  function schedule() {
    if (stopped) return;
    if (busy || guardsBusy()) { pending = true; return; }
    if (debounce) return; // coalesce rapid bursts into one refresh
    debounce = setTimeout(function () {
      debounce = null;
      if (stopped) return;
      if (busy || guardsBusy()) { pending = true; return; }
      run();
    }, 400);
  }

  (refs || []).forEach(function (ref) {
    try {
      unsubs.push(ref.onSnapshot(function () { schedule(); }, function (err) {
        try { console.error('Live sync listener error:', err); } catch (e) {}
      }));
    } catch (err) {
      try { console.error('Live sync subscribe failed:', err); } catch (e) {}
    }
  });

  // Safety net every 2s: apply anything deferred while a dialog was
  // open or the user was typing, and catch any missed event.
  const timer = setInterval(function () {
    if (stopped || document.hidden) return;
    if (pending && !guardsBusy()) { pending = false; run(); }
  }, 2000);

  function stop() {
    stopped = true;
    if (debounce) clearTimeout(debounce);
    if (timer) clearInterval(timer);
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
  }
  window.addEventListener('beforeunload', stop);
  return stop;
}

// ---------------------------------------------------------------
//  Live auto refresh (2s polling with safety guards).
//  Kept as the fallback driver; most pages now use liveCollections
//  (real-time snapshots) above. Re-runs reload() every 2 seconds so
//  data stays accurate without manual refresh. Skips ticks while the
//  tab is hidden, a dialog is open, the user is typing, or a previous
//  tick is still running.
// ---------------------------------------------------------------
function autoLive(reload, ms) {
  const every = ms || 2000;
  let busy = false;
  let timer = null;
  async function tick() {
    if (busy || document.hidden) return;
    if (document.querySelector('.modal.modal-open')) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    busy = true;
    try { await reload(); } catch (e) {}
    busy = false;
  }
  tick();
  timer = setInterval(tick, every);
  window.addEventListener('beforeunload', function () { if (timer) clearInterval(timer); });
  return function stop() { if (timer) clearInterval(timer); };
}

// ---------------------------------------------------------------
//  Shared modal helpers
// ---------------------------------------------------------------
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('modal-open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('modal-open');
}

// ---------------------------------------------------------------
//  Digital confirm dialog (replaces native browser confirm popups).
//  Returns a promise resolving true (confirmed) or false (cancelled).
// ---------------------------------------------------------------
function confirmDialog(opts) {
  const o = opts || {};
  return new Promise(function (resolve) {
    let settled = false;
    const root = document.createElement('div');
    root.className = 'modal modal-open';
    root.innerHTML =
      '<div class="modal-card" style="max-width:420px;">' +
      '<h2>' + esc(o.title || 'Please confirm') + '</h2>' +
      '<p class="muted">' + esc(o.message || 'Are you sure?') + '</p>' +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-ghost" data-x="cancel">Cancel</button>' +
      '<button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-x="ok">' + esc(o.confirmText || 'Confirm') + '</button>' +
      '</div></div>';
    function done(v) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') done(false);
    }
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', function (e) {
      if (e.target === root) { done(false); return; }
      const b = e.target.closest('button[data-x]');
      if (!b) return;
      done(b.dataset.x === 'ok');
    });
    document.body.appendChild(root);
    const okBtn = root.querySelector('button[data-x="ok"]');
    if (okBtn) okBtn.focus();
  });
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w) { return w[0]; })
    .join('')
    .toUpperCase();
}

// =====================================================================
//  Password visibility toggle (eye icon inside password fields)
//  Auto-applied to every input[type=password] on the page.
// =====================================================================
var PW_EYE_SVG = '<svg class="ic-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var PW_EYE_OFF_SVG = '<svg class="ic-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function enhancePasswordFields(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach(function (input) {
    if (input.dataset.pwEnhanced || (input.parentElement && input.parentElement.classList.contains('pw-wrap'))) return;
    input.dataset.pwEnhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = PW_EYE_SVG + PW_EYE_OFF_SVG;
    // Keep focus/caret in the input when the eye is tapped.
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      const eye = btn.querySelector('.ic-eye');
      const eyeOff = btn.querySelector('.ic-eye-off');
      if (eye) eye.style.display = show ? 'none' : '';
      if (eyeOff) eyeOff.style.display = show ? '' : 'none';
    });
    wrap.appendChild(btn);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { enhancePasswordFields(document); });
} else {
  enhancePasswordFields(document);
}