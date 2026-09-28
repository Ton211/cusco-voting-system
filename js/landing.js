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
      // Check the student list FIRST, before any sign-in attempt, so
      // first-timers go straight to setting their password without a
      // failed Auth request (no 400 noise). Only already-registered
      // students reach signInWithEmailAndPassword.
      if (isAdmStyle) {
        let st = null;
        try {
          const precheck = FB_FUNCTIONS.httpsCallable('checkStudentExists');
          const res = await withTimeout(precheck({ admNumber: username }), 15000, 'Student check');
          st = (res && res.data) || null;
        } catch (e) { st = null; }
        if (st && st.exists && !st.alreadyRegistered) {
          pendingAdm = username;
          pendingEmail = email;
          if (setupWrap) setupWrap.classList.remove('hidden');
          loginForm.style.display = 'none';
          if (loginLinks) loginLinks.style.display = 'none';
          toast('First time here? Set your password below to register as a voter.', 'info');
          if (setupNewPw) setupNewPw.focus();
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        if (st && !st.exists) {
          showError('Adm number not found. Please visit the admin office for registration.');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        if (st && st.alreadyRegistered && !password) {
          showError('Enter your password.');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        // Check unavailable (st null): fall through to the sign-in
        // attempt below; the catch block re-checks as a safety net.
      }
      try {
        await AUTH.signInWithEmailAndPassword(email, password);
      } catch (err) {
        // While Auth is throttling this device, never fire retries: they
        // cannot succeed and only extend the block. Just say to wait.
        if (err && err.code === 'auth/too-many-requests') {
          toast(friendlyError(err), 'error');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
          return;
        }
        const upper = String(password || '').toUpperCase();
        const lower = String(password || '').toLowerCase();
        const variants = [];
        if (upper !== password) variants.push(upper);
        if (lower !== password) variants.push(lower);
        let ok = false;
        let last = err;
        for (const v of variants) {
          try {
            await AUTH.signInWithEmailAndPassword(email, v);
            ok = true;
            break;
          } catch (e2) { last = e2; }
        }
        if (ok) return;
        // No account with any password casing: first-timer? Quickly
        // check the student list and, if listed, ask them to set a
        // password below instead of showing a dead-end error.
        await offerFirstTimeSetup(username, email, last);
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
  // "Register as a voter" saves the chosen password (acts as the
  // password change), confirms the voter registration and logs the
  // student straight into their account.
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
      toast('First time here? Set your password below to register as a voter.', 'info');
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
      setupBtn.textContent = 'Register as a voter';
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
      setupBtn.textContent = 'Registering…';
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
        setupBtn.textContent = 'Register as a voter';
        setupBusy = false;
        return;
      }
      // Registered with the chosen password: sign in at once so the
      // student lands logged in on their dashboard. Redirect explicitly
      // here (public landing page guard only reveals, it never routes),
      // so the button can never stick on "Registering…".
      setupBtn.textContent = 'Signing you in…';
      try {
        await withTimeout(AUTH.signInWithEmailAndPassword(pendingEmail, np), 15000, 'Sign in');
        toast('Registered successfully. Welcome!', 'success');
        location.replace('/voter/dashboard.html');
        return;
      } catch (signErr) {
        restoreLoginForm();
        if (signErr && signErr.code === 'auth/too-many-requests') {
          showError('Registered successfully. Too many attempts right now — wait a few minutes, then log in.');
        } else {
          showError(friendlyError(signErr));
        }
        setupBtn.disabled = false;
        setupBtn.textContent = 'Register as a voter';
        setupBusy = false;
      }
    });
  }
})();
