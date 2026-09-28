// =====================================================================
//  Shared voter chrome: top bar name + logout
// =====================================================================
(function () {
  // Voter module menu: mounted into every voter top bar automatically.
  const VOTER_NAV = [
    ['Dashboard', '/voter/dashboard.html'],
    ['Live', '/voter/live.html'],
    ['Results', '/voter/results.html'],
    ['Settings', '/voter/settings.html']
  ];

  function mountNav() {
    const bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('voterNav')) return;
    const nav = document.createElement('nav');
    nav.id = 'voterNav';
    nav.className = 'voter-nav';
    const here = location.pathname;
    VOTER_NAV.forEach(function (item) {
      const a = document.createElement('a');
      a.href = item[1];
      a.textContent = item[0];
      if (here === item[1] || (item[1] === '/voter/dashboard.html' && here === '/voter/')) a.className = 'active';
      nav.appendChild(a);
    });
    const right = bar.querySelector('.topbar-right');
    if (right) bar.insertBefore(nav, right);
    else bar.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }

  function ready() {
    mountNav();
    initDrawer();
  }

  // Mobile hamburger drawer (phones/tablets), same pattern as the admin
  // panel: the toggle button, close button and backdrop are injected
  // here, so without JS the top bar simply keeps its scrollable nav row
  // (see style.css). Only active at phone widths (matchMedia).
  function initDrawer() {
    const bar = document.querySelector('.topbar');
    const nav = document.getElementById('voterNav');
    if (!bar || !nav || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 860px)');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '&#9776;';
    bar.insertBefore(toggle, bar.firstChild);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'drawer-close';
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.textContent = '×';
    nav.insertBefore(closeBtn, nav.firstChild);

    // The user/logout block rides inside the drawer on phones and
    // returns to the top bar on wider screens.
    const right = bar.querySelector('.topbar-right');
    const anchor = right ? document.createComment('voter-right-anchor') : null;
    if (right && anchor) bar.insertBefore(anchor, right);

    const scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    scrim.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(22,33,58,.55);z-index:190;';
    document.body.appendChild(scrim);

    function paintMobile(on) {
      document.body.classList.toggle('has-voter-drawer', on);
      nav.style.position = on ? 'fixed' : '';
      nav.style.top = on ? '0' : '';
      nav.style.left = on ? '0' : '';
      nav.style.bottom = on ? '0' : '';
      nav.style.width = on ? 'min(78vw, 300px)' : '';
      nav.style.zIndex = on ? '200' : '';
      nav.style.background = on ? '#16213a' : '';
      nav.style.padding = on ? '12px 14px 20px' : '';
      nav.style.overflowY = on ? 'auto' : '';
      nav.style.transition = on ? 'transform .25s ease' : '';
      if (right) {
        if (on) nav.appendChild(right);
        else if (anchor) bar.insertBefore(right, anchor);
      }
      setOpen(false);
    }

    function setOpen(open) {
      if (!document.body.classList.contains('has-voter-drawer')) open = false;
      document.body.classList.toggle('voter-drawer-open', open);
      if (document.body.classList.contains('has-voter-drawer')) {
        nav.style.transform = open ? 'none' : 'translateX(-105%)';
      } else {
        nav.style.transform = '';
      }
      scrim.style.display = open ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      try { document.body.style.overflow = open ? 'hidden' : ''; } catch (e) {}
    }
    toggle.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('voter-drawer-open'));
    });
    closeBtn.addEventListener('click', function () { setOpen(false); });
    scrim.addEventListener('click', function () { setOpen(false); });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    paintMobile(mq.matches);
    if (mq.addEventListener) { mq.addEventListener('change', function (e) { paintMobile(e.matches); }); }
    else if (mq.addListener) { mq.addListener(function (e) { paintMobile(e.matches); }); }
  }

  window.authPromise.then(function (a) {
    if (!a.user || !a.role) return;

    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = a.user.displayName || a.user.email || 'Voter';

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        const ok = await confirmDialog({ title: 'Log out', message: 'Log out of the CUSCO Voting System?', confirmText: 'Log Out' });
        if (ok) {
          AUTH.signOut().then(function () { location.href = '/'; });
        }
      });
    }
  });
})();