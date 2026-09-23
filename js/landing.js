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
    const norm = v.toUpperCase().replace(/\s+/g, '');
    const local = norm.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return local + '@cusco.student';
  }

  // Already signed in? Send to the right portal.
  if (window.authPromise) {
    window.authPromise.then(function (a) {
      if (!a || !a.user) return;
      if (a.role === 'voter') location.replace('/voter/dashboard.html');
      else if (a.role === 'admin' || a.role === 'superadmin') location.replace('/admin/dashboard.html');
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

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      const username = String(admInput.value || '').trim();
      const password = String(pwInput.value || '');
      if (!username || !password) { showError('Enter your adm number and password.'); return; }
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
