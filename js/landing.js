// Landing: Log In / Register as a voter toggle + credential forms.
(function () {
  const showLoginBtn = document.getElementById('showLoginBtn');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const loginCard = document.getElementById('loginCard');
  const registerCard = document.getElementById('registerCard');

  function show(which) {
    const login = which !== 'register';
    if (loginCard) loginCard.classList.toggle('hidden', !login);
    if (registerCard) registerCard.classList.toggle('hidden', login);
    const trigger = document.getElementById('registerTrigger');
    if (trigger) trigger.classList.toggle('hidden', !login);
  }

  if (showLoginBtn) showLoginBtn.addEventListener('click', function (e) { if (e) e.preventDefault(); show('login'); });
  if (showRegisterBtn) showRegisterBtn.addEventListener('click', function (e) { if (e) e.preventDefault(); show('register'); });

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

  function showError(m) {
    errorBox.textContent = m;
    errorBox.style.display = 'block';
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
      if (!rawUsername || !password) { showError('Enter your adm number and password.'); return; }
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
      try {
        await AUTH.signInWithEmailAndPassword(email, password);
      } catch (err) {
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
        showError(friendlyError(last));
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
      }
    });
  }

  const forgot = document.getElementById('landingForgot');
  if (forgot) {
    forgot.addEventListener('click', function (e) {
      e.preventDefault();
      const username = String(admInput.value || '').trim();
      if (!username) { showError('Enter your adm number first.'); return; }
      if (username.indexOf('@') === -1) {
        showError('Student accounts use adm numbers. Ask your admin to reset your password to your adm number.');
        return;
      }
      AUTH.sendPasswordResetEmail(username.toLowerCase()).then(function () {
        toast('Password reset link sent.', 'success');
      }).catch(function (err) { showError(friendlyError(err)); });
    });
  }

  // Register form
  const regForm = document.getElementById('landingRegisterForm');
  const regAdm = document.getElementById('landingRegAdm');
  const regBtn = document.getElementById('landingRegisterBtn');
  const regBox = document.getElementById('landingRegBox');

  function showReg(message, isError) {
    regBox.textContent = message;
    regBox.style.display = 'block';
    regBox.style.background = isError ? 'var(--danger-soft)' : 'var(--success-soft)';
    regBox.style.color = isError ? 'var(--danger)' : 'var(--success)';
  }

  if (regForm) {
    regForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      const adm = String(regAdm.value || '').trim();
      if (!adm) { showReg('Enter your adm number to register.', true); return; }
      regBtn.disabled = true;
      regBtn.textContent = 'Checking…';
      try {
        const fn = FB_FUNCTIONS.httpsCallable('selfRegisterVoter');
        await fn({ admNumber: adm });
        showReg('Registration successful. Tap Log In above and sign in with your adm number as both username and password.', false);
        toast('Registration successful. Please log in.', 'success');
        show('login');
        admInput.value = adm;
        pwInput.focus();
      } catch (err) {
        const msg = String((err && err.message) || '');
        if (msg.indexOf('admin office') !== -1) {
          showReg('Adm number not found. Please visit the admin office for registration.', true);
        } else if (msg.indexOf('Already registered') !== -1) {
          showReg('Already registered. Tap Log In above and sign in.', false);
          show('login');
          admInput.value = adm;
        } else {
          showReg(friendlyError(err), true);
        }
      } finally {
        regBtn.disabled = false;
        regBtn.textContent = 'Register';
      }
    });
  }
})();
