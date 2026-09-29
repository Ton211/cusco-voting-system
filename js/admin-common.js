// =====================================================================
// Shared admin panel chrome: sidebar name, active nav, logout.
// Only admin/superadmin use the portal (view-only roles removed).
// =====================================================================

// Pages a view-only staff member may open. Everything else in the
// admin portal (students, voters, users) redirects away.
window.VIEWER_PAGES = [
  '/admin/dashboard.html',
  '/admin/candidates.html',
  '/admin/positions.html',
  '/admin/elections.html',
  '/admin/live.html',
  '/admin/results.html',
  '/admin/reports.html'
];

window.isViewer = function () {
  return window.isViewerRole((window.__auth || {}).role);
};

// Read-only staff: view-only roles plus the plain admin role.
// Only a superadmin may change anything in the system.
window.isReadOnly = function () {
  const r = (window.__auth || {}).role;
  return r === 'admin' || window.isViewerRole(r);
};

// Hide a control for read-only staff. Safe to call for any role.
window.hideForReadOnly = function (sel) {
  if (!window.isReadOnly()) return;
  qsa(sel).forEach(function (el) { el.style.display = 'none'; });
};



(function () {
  window.authPromise.then(function (a) {
    if (!a.user || !a.role) return;

    const nameEl = document.getElementById('sidebarName');
    if (nameEl) {
      const full = a.user.displayName || a.user.email || 'Admin';
      const short = String(full).split(' ')[0] || 'Admin';
      const label = String(a.role).charAt(0).toUpperCase() + String(a.role).slice(1);
      nameEl.innerHTML = '<strong>' + esc(short) + '</strong><span>' + esc(label) + '</span>';
    }

    // Plain admins see everything except Students, Voters and Users, and
    // edit nothing. (users.js additionally replaces the page for
    // non-superadmins.) Matches both /admin/x and /admin/x.html URLs.
    if (a.role === 'admin') {
      var ADMIN_HIDDEN = ['/admin/students', '/admin/voters', '/admin/users'];
      qsa('.sidebar nav a').forEach(function (link) {
        if (ADMIN_HIDDEN.indexOf(String(link.getAttribute('href')).replace(/\.html$/, '')) !== -1) {
          link.style.display = 'none';
        }
      });
      if (ADMIN_HIDDEN.indexOf(String(location.pathname).replace(/\.html$/, '')) !== -1) {
        location.replace('/admin/dashboard.html');
        return;
      }
    }

    // View-only staff: trim the sidebar to the pages they may see,
    // and bounce them out of any other admin page.
    if (window.isViewerRole(a.role)) {
      qsa('.sidebar nav a').forEach(function (link) {
        if (window.VIEWER_PAGES.indexOf(link.getAttribute('href')) === -1) {
          link.style.display = 'none';
        }
      });
      if (window.VIEWER_PAGES.indexOf(location.pathname) === -1) {
        location.replace('/admin/dashboard.html');
        return;
      }
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        const ok = await confirmDialog({ title: 'Log out', message: 'Log out of the CUSCO Online Voting System?', confirmText: 'Log Out' });
        if (ok) {
          AUTH.signOut().then(function () { location.href = '/sys/cuscostaff9f2k41.html'; });
        }
      });
    }
  });

  // Mobile hamburger drawer (phones/tablets). The toggle button, close
  // button and backdrop are injected here, so without JS the sidebar
  // simply keeps its scrollable top nav row (see style.css).
  // Critical drawer positioning is set inline so the drawer keeps
  // working even with a stale cached stylesheet; style.css adds the
  // polish on top. Only active at phone widths (matchMedia).
  (function initDrawer() {
    var sidebar = document.querySelector('.sidebar');
    var nav = sidebar && sidebar.querySelector('nav');
    if (!sidebar || !nav || !window.matchMedia) return;
    var mq = window.matchMedia('(max-width: 860px)');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '&#9776;';
    sidebar.insertBefore(toggle, sidebar.firstChild);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'drawer-close';
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.textContent = '\u00d7';
    nav.insertBefore(closeBtn, nav.firstChild);

    var user = sidebar.querySelector('.sidebar-user');
    if (user) nav.appendChild(user);

    var scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    scrim.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(22,33,58,.55);z-index:190;';
    document.body.appendChild(scrim);

    function paintMobile(on) {
      document.body.classList.toggle('has-drawer', on);
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
      setOpen(false);
    }

    function setOpen(open) {
      if (!document.body.classList.contains('has-drawer')) open = false;
      document.body.classList.toggle('drawer-open', open);
      if (document.body.classList.contains('has-drawer')) {
        nav.style.transform = open ? 'none' : 'translateX(-105%)';
      } else {
        nav.style.transform = '';
      }
      scrim.style.display = open ? 'block' : 'none';
      sidebar.style.zIndex = open ? '300' : '';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      try { document.body.style.overflow = open ? 'hidden' : ''; } catch (e) {}
    }
    toggle.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('drawer-open'));
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
  })();

  // Highlight the current page in the sidebar.
  const links = qsa('.sidebar nav a');
  const here = location.pathname;
  links.forEach(function (link) {
    if (link.getAttribute('href') === here) link.classList.add('active');
  });
})();