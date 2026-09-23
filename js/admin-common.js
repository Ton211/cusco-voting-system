// =====================================================================
//  Shared admin panel chrome: sidebar name, active nav, logout
// =====================================================================
(function () {
  window.authPromise.then(function (a) {
    if (!a.user || !a.role) return;

    const nameEl = document.getElementById('sidebarName');
    if (nameEl) {
      const full = a.user.displayName || a.user.email || 'Admin';
      const short = String(full).split(' ')[0] || 'Admin';
      nameEl.innerHTML = '<strong>' + esc(short) + '</strong><span>' + esc(a.role) + '</span>';
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