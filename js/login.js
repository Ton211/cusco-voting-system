// =====================================================================
//  Login page logic (auth guard handles the redirect after sign in)
// =====================================================================
(function () {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorBox = document.getElementById('errorBox');
  const submitBtn = document.getElementById('loginBtn');
  const forgotLink = document.getElementById('forgotLink');

  // All login errors arrive as side pop-out notices, never inline.
  function showError(message) {
    toast(message, 'error');
  }

  function clearError() {
    errorBox.style.display = 'none';
  }

  function loginEmailForInput(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.indexOf('@') !== -1) return v.toLowerCase();
    const norm = normalizeAdmInput(v);
    const local = norm.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return local + '@cusco.student';
  }

  // Adm numbers are case-insensitive: ADM001 == adm001 == Adm 001.
  // Matches functions/index.js normalizeAdm so the client and server
  // always agree, and the first sign-in attempt uses the normalized
  // form instead of paying for case-retry round-trips.
  function normalizeAdmInput(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  const isStaffPage = document.body && document.body.dataset && document.body.dataset.page === 'admin-login';

  // Show the adm upper-cased as they type (student pages only; staff
  // usernames keep their own casing rules server-side).
  if (!isStaffPage && emailInput) {
    emailInput.addEventListener('input', function () {
      const pos = emailInput.selectionStart;
      const norm = normalizeAdmInput(emailInput.value);
      if (emailInput.value !== norm && norm.indexOf('@') === -1) {
        emailInput.value = norm;
        try { emailInput.setSelectionRange(pos, pos); } catch (e) {}
      }
    });
  }
  const defaultBtnText = submitBtn ? submitBtn.textContent : 'Log In';

  function resetBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = defaultBtnText;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    const rawUsername = emailInput.value.trim();
    let password = passwordInput.value;

    // Adm-style student logins may omit the password: first-timers do
    // not have one yet and go through the student-list check below.
    const isAdmStyle = !isStaffPage && rawUsername.indexOf('@') === -1;
    if (!rawUsername || (!password && !isAdmStyle)) {
      showError(isStaffPage ? 'Enter your staff username and password.' : 'Enter your adm number and password.');
      return;
    }

    // Normalize adm upfront (student logins only). If the password is
    // just the adm typed in another case (first login), use the
    // normalized form on the FIRST attempt: 1 request instead of up to 3.
    let username = rawUsername;
    if (!isStaffPage && rawUsername.indexOf('@') === -1) {
      username = normalizeAdmInput(rawUsername);
      if (normalizeAdmInput(password) === username) password = username;
      emailInput.value = username;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';

    // Hoisted so the catch block below (case retries + first-time
    // student-list check) can reuse the same address.
    let email = '';

    // Student adm logins: check the student list FIRST, before any
    // sign-in attempt, so first-timers go straight to setting their
    // password without a failed Auth request (no 400 noise). Only
    // already-registered students reach signInWithEmailAndPassword.
    if (isAdmStyle) {
      let st = null;
      try {
        const precheck = FB_FUNCTIONS.httpsCallable('checkStudentExists');
        const res = await withTimeout(precheck({ admNumber: username }), 15000, 'Student check');
        st = (res && res.data) || null;
      } catch (e) { st = null; }
      if (st && st.exists && !st.alreadyRegistered) {
        pendingAdm = username;
        pendingEmail = loginEmailForInput(username);
        if (setupWrap) setupWrap.classList.remove('hidden');
        form.style.display = 'none';
        if (loginLinks) loginLinks.style.display = 'none';
        toast('First time here? Set your password below to register as a voter.', 'info');
        if (newPwInput) newPwInput.focus();
        submitBtn.disabled = false;
        submitBtn.textContent = defaultBtnText;
        return;
      }
      if (st && !st.exists) {
        showError('Adm number not found. Please visit the admin office for registration.');
        submitBtn.disabled = false;
        submitBtn.textContent = defaultBtnText;
        return;
      }
      if (st && st.alreadyRegistered && !password) {
        showError('Enter your password.');
        submitBtn.disabled = false;
        submitBtn.textContent = defaultBtnText;
        return;
      }
      // Check unavailable (st null): fall through to the sign-in
      // attempt below; the catch block re-checks as a safety net.
    }
    try {
      if (username.indexOf('@') !== -1) {
        email = username.toLowerCase();
      } else if (isStaffPage) {
        // Staff username alias resolved server-side; password itself is
        // never in code, only in Firebase Auth.
        const resolver = FB_FUNCTIONS.httpsCallable('resolveStaffUsername');
        try {
          const res = await resolver({ username: username });
          email = res.data.email;
        } catch (aliasErr) {
          showError('Invalid staff credentials.');
          resetBtn();
          return;
        }
      } else {
        email = loginEmailForInput(username);
      }
      await AUTH.signInWithEmailAndPassword(email, password);
      // auth-guard.js observes the auth state change and routes by role.
    } catch (err) {
      // While Auth is throttling this device, never fire retries: they
      // cannot succeed and only extend the block. Just say to wait.
      if (err && err.code === 'auth/too-many-requests') {
        toast(friendlyError(err), 'error');
      } else if (!isStaffPage && username.indexOf('@') === -1) {
        const variants = [];
        const upper = String(password || '').toUpperCase();
        const lower = String(password || '').toLowerCase();
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
      } else {
        toast(friendlyError(err), 'error');
      }
      submitBtn.disabled = false;
      submitBtn.textContent = defaultBtnText;
    }
  });

  if (forgotLink) {
  // Students cannot self-reset: direct them to the admin desk with a
  // side pop-out notice instead of an inline form error.
  forgotLink.addEventListener('click', function (e) {
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
  const setupWrap = document.getElementById('firstSetup');
  const setupForm = document.getElementById('setupForm');
  const newPwInput = document.getElementById('newPassword');
  const confirmPwInput = document.getElementById('confirmPassword');
  const setupBtn = document.getElementById('setupRegisterBtn');
  const setupBackBtn = document.getElementById('setupBackBtn');
  const loginLinks = document.getElementById('loginLinks');
  const setupBox = document.getElementById('setupBox');
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
      form.style.display = 'none';
      if (loginLinks) loginLinks.style.display = 'none';
      toast('First time here? Set your password below to register as a voter.', 'info');
      if (newPwInput) newPwInput.focus();
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
    form.style.display = '';
    if (loginLinks) loginLinks.style.display = '';
    if (typeof setupBtn !== 'undefined' && setupBtn) {
      setupBtn.disabled = false;
      setupBtn.textContent = 'Register as a voter';
    }
    passwordInput.value = '';
    emailInput.focus();
  }

  if (setupBackBtn) {
    setupBackBtn.addEventListener('click', restoreLoginForm);
  }

  if (setupForm) {
    setupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (setupBusy) return;
      clearError();
      const np = String(newPwInput.value || '');
      const cp = String(confirmPwInput.value || '');
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
      // student lands logged in. Redirect explicitly (never rely on the
      // guard alone) so the button can never stick on "Registering…".
      // Kept separate so a sign-in failure restores the form either way.
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