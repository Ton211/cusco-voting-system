// Landing: student Log In with inline first-time setup.
(function () {

  function loginEmailForInput(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.indexOf('@') !== -1) return v.toLowerCase();
    const norm = normalizeAdmInput(v);
    const local = norm.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return local + '@cusco.student';
  }

  // Adm numbers are case-insensitive: ADM001 == adm001 == Adm 001.
  // Normalizing upfront (and showing it in the field) means the very
  // first sign-in attempt uses the right email AND the right first-login
  // password (stored upper-cased server-side), instead of paying for
  // 2-3 sequential network round-trips through the case-retry fallback.
  function normalizeAdmInput(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  // Already signed in? Send to the right portal.
  if (window.authPromise) {
    window.authPromise.then(function (a) {
      if (!a || !a.user) return;
      if (a.role === 'voter') location.replace('/voter/dashboard.html');
      else if (a.role === 'admin' || a.role === 'superadmin' || window.isViewerRole(a.role)) location.replace('/admin/dashboard.html');
    }).catch(function () {});
  }

  // Login form
  const loginForm = document.getElementById('landingLoginForm');
  // After a fresh sign-in the public-page guard only reveals (it never
  // routes), and the top-of-file redirect already ran at page load —
  // so route explicitly here. Without this the button sticks forever
  // on "Logging in…" even with correct credentials.
  async function goAfterLogin() {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log In';
    try {
      const user = AUTH.currentUser;
      const idr = user ? await withTimeout(user.getIdTokenResult(), 10000, 'Sign in') : null;
      const role = idr && idr.claims ? idr.claims.role : null;
      if (role === 'admin' || role === 'superadmin' || window.isViewerRole(role)) {
        location.replace('/admin/dashboard.html');
      } else {
        location.replace('/voter/dashboard.html');
      }
    } catch (e) {
      location.replace('/voter/dashboard.html');
    }
  }
  const admInput = document.getElementById('landingAdm');
  const pwInput = document.getElementById('landingPassword');
  const loginBtn = document.getElementById('landingLoginBtn');
  const errorBox = document.getElementById('landingError');

  // All login errors arrive as side pop-out notices, never inline.
  function showError(m) {
    toast(m, 'error');
  }
  function clearError() { errorBox.style.display = 'none'; }

  // Show the adm upper-cased as they type so students see that
  // ADM001 and adm001 are the same account.
  if (admInput) {
    admInput.addEventListener('input', function () {
      const pos = admInput.selectionStart;
      const norm = normalizeAdmInput(admInput.value);
      if (admInput.value !== norm && norm.indexOf('@') === -1) {
        admInput.value = norm;
        try { admInput.setSelectionRange(pos, pos); } catch (e) {}
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      const rawUsername = String(admInput.value || '').trim();
      let password = String(pwInput.value || '');
      // Adm logins may omit the password: first-timers do not have one
      // yet and go through the student-list check below.
      const isAdmStyle = rawUsername.indexOf('@') === -1;
      if (!rawUsername || (!password && !isAdmStyle)) { showError('Enter your adm number and password.'); return; }
      // Normalize the adm upfront. If the password is just the adm number
      // typed in another case (first login), use the normalized form on
      // the FIRST attempt so login takes 1 request instead of up to 3.
      const username = rawUsername.indexOf('@') !== -1 ? rawUsername : normalizeAdmInput(rawUsername);
      if (username.indexOf('@') === -1 && normalizeAdmInput(password) === username) {
        password = username;
      }
      admInput.value = username;
      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in…';
      const email = loginEmailForInput(username);
      // SUPER-FAST PATH: returning voters (~99% of presses) sign straight
      // in direct to Auth (~0.5s) instead of waiting on the callable
      // pre-check first (cold start 2-15s). The student-list check only
      // runs when needed: empty password (first-timer), or sign-in failed.
      function startPrecheck() {
        try {
          const precheck = FB_FUNCTIONS.httpsCallable('checkStudentExists');
          return withTimeout(precheck({ admNumber: username }), 15000, 'Student check')
            .then(function (res) { return (res && res.data) || null; })
            .catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
      }
      function showFirstTimer() {
        pendingAdm = username;
        pendingEmail = email;
        if (setupWrap) setupWrap.classList.remove('hidden');
        loginForm.style.display = 'none';
        if (loginLinks) loginLinks.style.display = 'none';
        toast('First time here? Set your password below.', 'info');
        if (setupNewPw) setupNewPw.focus();
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
      }
      if (isAdmStyle && !password) {
        // No password yet: cannot sign in, pre-check only.
        // First-time account/password setup is always allowed (even while
        // voter registration is closed) — it only creates the login.
        const st0 = await startPrecheck();
        if (st0 && st0.exists && !st0.alreadyRegistered) { showFirstTimer(); return; }
        if (st0 && !st0.exists) {
          showError('Adm number not found. Please visit the admin office for registration.');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        showError('Enter your password.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
        return;
      }
      if (isAdmStyle && password) {
        // Returning voter likely: fire the pre-check in the BACKGROUND
        // while signing in. Sign-in win = never wait for the callable;
        // sign-in fail = the check result is likely already here
        // (max, not sum — one wave instead of two).
        const bgCheck = startPrecheck();
        let signErr = null;
        try {
          await withTimeout(AUTH.signInWithEmailAndPassword(email, password), 15000, 'Sign in');
          if (bgCheck && bgCheck.catch) bgCheck.catch(function () {});
          await goAfterLogin();
          return; // signed in and routed to the right portal
        } catch (e) { signErr = e; }
        // While Auth is throttling this device, never fire retries: they
        // cannot succeed and only extend the block. Just say to wait.
        if (signErr && signErr.code === 'auth/too-many-requests') {
          toast(friendlyError(signErr), 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        // Legacy adm-as-password accounts (created before the uppercase
        // normalization fix): one quick casing retry while the check runs.
        const upper = String(password || '').toUpperCase();
        const lower = String(password || '').toLowerCase();
        const variants = [];
        if (upper !== password) variants.push(upper);
        if (lower !== password) variants.push(lower);
        let ok = false;
        let last = signErr;
        for (const v of variants) {
          try {
            await withTimeout(AUTH.signInWithEmailAndPassword(email, v), 15000, 'Sign in');
            ok = true;
            break;
          } catch (e2) { last = e2; }
        }
        if (ok) { await goAfterLogin(); return; }
        const st = await bgCheck;
        if (st && st.exists && !st.alreadyRegistered) { showFirstTimer(); return; }
        if (st && !st.exists) {
          showError('Adm number not found. Please visit the admin office for registration.');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        // No account with any password casing and check says registered
        // (or unavailable): show the real Auth error, not a dead end.
        toast(friendlyError(last), 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
        return;
      }
      // Email-style login (or staff): straight to Auth, no pre-check.
      try {
        await withTimeout(AUTH.signInWithEmailAndPassword(email, password), 15000, 'Sign in');
        await goAfterLogin();
      } catch (err) {
        toast(friendlyError(err), 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
      }
    });
  }

  const forgot = document.getElementById('landingForgot');
  if (forgot) {
    // Students cannot self-reset: direct them to the admin desk with a
    // side pop-out notice instead of an inline form error.
    forgot.addEventListener('click', function (e) {
      e.preventDefault();
      toast('Kindly visit the admin desk to reset your password.', 'info');
    });
  }

  // ---------------------------------------------------------------
  // First-time setup: the login panel checks the student list, then
  // "Change Password" saves the chosen password and logs the student
  // straight into their account. This only creates the login — it does
  // NOT register them as a voter. Voter registration happens later on
  // the dashboard while the admin's window is open (or by an admin).
  // ---------------------------------------------------------------
  const setupWrap = document.getElementById('landingSetup');
  const setupForm = document.getElementById('landingSetupForm');
  const setupNewPw = document.getElementById('landingNewPassword');
  const setupConfirmPw = document.getElementById('landingConfirmPassword');
  const setupBtn = document.getElementById('landingSetupBtn');
  const setupBackBtn = document.getElementById('landingSetupBackBtn');
  const loginLinks = document.getElementById('landingLoginLinks');
  const setupBox = document.getElementById('landingSetupBox');
  let pendingAdm = '';
  let pendingEmail = '';
  let setupBusy = false;

  function showSetup(message) {
    toast(message, 'error');
  }

  function alreadyExistsErr(err) {
    const code = String((err && err.code) || '');
    const msg = String((err && err.message) || '');
    const details = String((err && err.details) || '');
    return code.indexOf('already-exists') !== -1 || msg.indexOf('Already registered') !== -1 || details.indexOf('Already registered') !== -1;
  }

  async function offerFirstTimeSetup(adm, admEmail, lastErr) {
    let st = null;
    try {
      const check = FB_FUNCTIONS.httpsCallable('checkStudentExists');
      const res = await withTimeout(check({ admNumber: adm }), 15000, 'Student check');
      st = (res && res.data) || null;
    } catch (e) { st = null; }
    if (st && st.exists && !st.alreadyRegistered) {
      pendingAdm = adm;
      pendingEmail = admEmail;
      // Verified first-timer: swap the login form away so only the
      // set-password block shows.
      if (setupWrap) setupWrap.classList.remove('hidden');
      loginForm.style.display = 'none';
      if (loginLinks) loginLinks.style.display = 'none';
      toast('First time here? Set your password below.', 'info');
      if (setupNewPw) setupNewPw.focus();
      return;
    }
    if (st && !st.exists) {
      showError('Adm number not found. Please visit the admin office for registration.');
      return;
    }
    toast(friendlyError(lastErr), 'error');
  }

  // Back out of first-time setup (e.g. wrong adm typed): bring the
  // login form back and forget the pending adm. Always releases the
  // register button so Back can never leave it stuck.
  function restoreLoginForm() {
    pendingAdm = '';
    pendingEmail = '';
    setupBusy = false;
    if (setupWrap) setupWrap.classList.add('hidden');
    loginForm.style.display = '';
    if (loginLinks) loginLinks.style.display = '';
    if (typeof setupBtn !== 'undefined' && setupBtn) {
      setupBtn.disabled = false;
      setupBtn.textContent = 'Change Password';
    }
    pwInput.value = '';
    admInput.focus();
  }

  if (setupBackBtn) {
    setupBackBtn.addEventListener('click', restoreLoginForm);
  }

  if (setupForm) {
    setupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (setupBusy) return;
      clearError();
      const np = String(setupNewPw.value || '');
      const cp = String(setupConfirmPw.value || '');
      if (!pendingAdm) { showSetup('Enter your adm number above and press Log In first.', true); return; }
      if (np.length < 6) { showSetup('Password must be at least 6 characters.', true); return; }
      if (np !== cp) { showSetup('Passwords do not match.', true); return; }
      if (np.trim().toUpperCase() === normalizeAdmInput(pendingAdm)) {
        showSetup('Pick a password different from your adm number.', true);
        return;
      }
      setupBusy = true;
      setupBtn.disabled = true;
      setupBtn.textContent = 'Saving…';
      try {
        const fn = FB_FUNCTIONS.httpsCallable('selfRegisterVoter');
        await withTimeout(fn({ admNumber: pendingAdm, newPassword: np }), 25000, 'Registration');
      } catch (err) {
        if (alreadyExistsErr(err)) {
          restoreLoginForm();
          showError('Already registered. Please log in with your adm number and password.');
        } else {
          showSetup(friendlyError(err), true);
        }
        setupBtn.disabled = false;
        setupBtn.textContent = 'Change Password';
        setupBusy = false;
        return;
      }
      // Registered with the chosen password: sign in at once so the
      // student lands logged in on their dashboard. Redirect explicitly
      // here (public landing page guard only reveals, it never routes),
      // so the button can never stick on "Saving…".
      setupBtn.textContent = 'Signing you in…';
      try {
        await withTimeout(AUTH.signInWithEmailAndPassword(pendingEmail, np), 15000, 'Sign in');
        toast('Password saved. Welcome!', 'success');
        location.replace('/voter/dashboard.html');
        return;
      } catch (signErr) {
        restoreLoginForm();
        if (signErr && signErr.code === 'auth/too-many-requests') {
          showError('Password saved. Too many attempts right now — wait a few minutes, then log in.');
        } else {
          showError(friendlyError(signErr));
        }
        setupBtn.disabled = false;
        setupBtn.textContent = 'Change Password';
        setupBusy = false;
      }
    });
  }
})();
