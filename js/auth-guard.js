// =====================================================================
//  Auth guard
//  Controls access for every page. The <body> of guarded pages starts
//  with class "auth-hidden" and only becomes visible once access has
//  been verified.
//
//  data-page="admin"  -> admin/superadmin + view-only staff
//                       (director, principal, dean, registrar;
//                       per-page limits enforced in admin-common.js)
//  data-page="voter"  -> voter only
//  data-page="login"        -> shared login
//  data-page="admin-login"  -> separate ADMIN portal login
//  data-page="public"       -> anyone
// =====================================================================

window.__auth = { user: null, role: null };

// View-only staff roles. They use the admin portal but may only see
// dashboard (read-only), candidates, election, live, results, reports.
window.VIEWER_ROLES = ['director', 'principal', 'dean', 'registrar'];
window.isViewerRole = function (role) {
  return window.VIEWER_ROLES.indexOf(role) !== -1;
};

(function () {
  const mode = document.body.dataset.page || 'public';

  // The staff portal is deliberately unadvertised (no link on the landing
  // page) so the admin login path is not trivially discoverable.
  const VOTER_LOGIN = '/';
  const STAFF_LOGIN = '/sys/cuscostaff9f2k41.html';
  const SET_PASSWORD = '/voter/set-password.html';

  function homeForRole(role) {
    if (role === 'voter') return '/voter/dashboard.html';
    if (role === 'admin' || role === 'superadmin' || window.isViewerRole(role)) return '/admin/dashboard.html';
    return VOTER_LOGIN;
  }

  function reveal() {
    document.body.classList.remove('auth-hidden');
  }

  function redirect(url) {
    // Loop breaker: if the browser bounces between pages several times
    // in a few seconds (almost always a stale cached copy of this file
    // fighting the new one), stop redirecting and say so instead of
    // blinking forever.
    try {
      const now = Date.now();
      const log = JSON.parse(sessionStorage.getItem('cusco-rd') || '[]')
        .filter(function (t) { return now - t < 8000; });
      log.push(now);
      sessionStorage.setItem('cusco-rd', JSON.stringify(log));
      if (log.length > 4) {
        sessionStorage.removeItem('cusco-rd');
        document.body.classList.remove('auth-hidden');
        document.body.innerHTML = '<main class="content"><div class="alert alert-error" style="margin:48px auto;max-width:540px;">' +
          '<strong>Page keeps reloading.</strong><br>Your browser is holding old files. ' +
          'Press <strong>Ctrl+Shift+R</strong> (hard refresh), then sign in again.</div></main>';
        return;
      }
    } catch (e) {}
    location.replace(url);
  }

  function applyRole(user, role) {
    window.__auth = { user: user, role: role };
    const ev = new CustomEvent('cusco-auth', { detail: window.__auth });
    document.dispatchEvent(ev);
  }

  const authPromise = new Promise(function (resolve) {
    let settled = false;
    function settle(user, role) {
      if (settled) return;
      settled = true;
      applyRole(user, role);
      resolve({ user: user, role: role });
    }

    AUTH.onAuthStateChanged(function (user) {
      if (!user) {
        if (mode === 'login' || mode === 'admin-login' || mode === 'public') {
          settle(null, null); reveal();
        }
        else redirect(mode === 'admin' ? STAFF_LOGIN : VOTER_LOGIN);
        return;
      }

      // The role lives in the Auth custom claims (set by Cloud Functions).
      // The first-login flag rides there too, so the gate needs no read.
      let mustFromToken = null;
      user.getIdTokenResult().then(function (idr) {
        let role = idr.claims.role || null;
        if (role && idr.claims.mustChangePassword !== undefined) {
          mustFromToken = idr.claims.mustChangePassword === true;
        }

        // Fallback: read from the user's own profile document.
        if (!role || (role === 'voter' && mustFromToken === null)) {
          return DB.collection('users').doc(user.uid).get().then(function (snap) {
            if (snap.exists) {
              role = role || snap.data().role || null;
              if (mustFromToken === null && snap.data().mustChangePassword !== undefined) {
                mustFromToken = snap.data().mustChangePassword === true;
              }
              if (role) user.getIdToken(true); // refresh token so claims update
            }
            return role;
          });
        }
        return role;
      }).then(function (role) {
        // First-login password gate: voters flagged mustChangePassword
        // must set their own password before using the portal.
        function afterGate() {
          settle(user, role);

          if (mode === 'set-password') {
            if (role === 'voter') reveal();
            else redirect(homeForRole(role));
            return;
          }

          // Voter-only login: staff accounts are rejected here and
          // redirected to the staff portal.
          if (mode === 'login') {
            if (role === 'admin' || role === 'superadmin' || window.isViewerRole(role)) {
              AUTH.signOut().then(function () { redirect(STAFF_LOGIN + '?staff=1'); });
            } else {
              redirect(homeForRole(role));
            }
            return;
          }
          if (mode === 'admin-login') {
            redirect(homeForRole(role));
            return;
          }
          if (mode === 'admin') {
            if (role === 'admin' || role === 'superadmin' || window.isViewerRole(role)) reveal();
            else redirect(role === 'voter' ? '/voter/dashboard.html' : STAFF_LOGIN);
            return;
          }
          if (mode === 'voter') {
            if (role === 'voter') reveal();
            else redirect(role ? '/admin/dashboard.html' : VOTER_LOGIN);
            return;
          }
          reveal();
        }

        if (role === 'voter' && mode !== 'set-password' && mode !== 'public') {
          const path = window.location.pathname || '';
          if (path.indexOf('set-password') !== -1) { afterGate(); return; }
          if (mustFromToken !== null) {
            if (mustFromToken) redirect(SET_PASSWORD);
            else afterGate();
            return;
          }
          DB.collection('users').doc(user.uid).get().then(function (snap) {
            const must = snap.exists && snap.data().mustChangePassword === true;
            if (must) redirect(SET_PASSWORD);
            else afterGate();
          }).catch(function () { afterGate(); });
          return;
        }
        afterGate();
      }).catch(function () {
        settle(user, null);
        reveal();
      });
    });
  });

  // Allow page scripts to wait for the guard before doing work.
  window.authPromise = authPromise;
})();