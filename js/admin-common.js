// =====================================================================
//  Shared admin panel chrome: sidebar name, active nav, logout,
//  view-only staff limits (director, principal, dean, registrar)
// =====================================================================

// Pages a view-only staff member may open. Everything else in the
// admin portal (students, voters, positions, users) redirects away.
window.VIEWER_PAGES = [
  '/admin/dashboard.html',
  '/admin/candidates.html',
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

    // Plain admins see everything except Users, but edit nothing.
    // (users.js additionally replaces the page for non-superadmins.)
    if (a.role === 'admin') {
      qsa('.sidebar nav a').forEach(function (link) {
        if (link.getAttribute('href') === '/admin/users.html') {
          link.style.display = 'none';
        }
      });
      if (location.pathname === '/admin/users.html') {
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
        const ok = await confirmDialog({ title: 'Log out', message: 'Log out of the CUSCO Voting System?', confirmText: 'Log Out' });
        if (ok) {
          AUTH.signOut().then(function () { location.href = '/sys/cuscostaff9f2k41.html'; });
        }
      });
    }
  });

  // Highlight the current page in the sidebar.
  const links = qsa('.sidebar nav a');
  const here = location.pathname;
  links.forEach(function (link) {
    if (link.getAttribute('href') === here) link.classList.add('active');
  });
})();