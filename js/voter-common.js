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
    document.addEventListener('DOMContentLoaded', mountNav);
  } else {
    mountNav();
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