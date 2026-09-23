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

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function clearError() {
    errorBox.style.display = 'none';
  }

  function loginEmailForInput(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.indexOf('@') !== -1) return v.toLowerCase();
    const norm = v.toUpperCase().replace(/\s+/g, '');
    const local = norm.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return local + '@cusco.student';
  }

  const isStaffPage = document.body && document.body.dataset && document.body.dataset.page === 'admin-login';

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    const username = emailInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError(isStaffPage ? 'Enter your staff username and password.' : 'Enter your adm number and password.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';

    try {
      let email;
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
          submitBtn.disabled = false;
          submitBtn.textContent = 'Log In';
          return;
        }
      } else {
        email = loginEmailForInput(username);
      }
      await AUTH.signInWithEmailAndPassword(email, password);
      // auth-guard.js observes the auth state change and routes by role.
    } catch (err) {
      // First-login safety net: initial passwords may differ in case from
      // what was typed at registration, so retry other cases for adm logins.
      if (!isStaffPage && username.indexOf('@') === -1) {
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
        showError(friendlyError(last));
      } else {
        showError(friendlyError(err));
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  });

  forgotLink.addEventListener('click', async function (e) {
    e.preventDefault();
    const username = emailInput.value.trim();
    if (!username) {
      showError('Enter your adm number first, then press "Forgot Password?".');
      return;
    }
    if (username.indexOf('@') === -1) {
      showError('Student accounts use adm numbers. Ask your admin to reset your password to your adm number.');
      return;
    }
    try {
      await AUTH.sendPasswordResetEmail(username.toLowerCase());
      toast('Password reset link sent to ' + username + '.', 'success');
    } catch (err) {
      showError(friendlyError(err));
    }
  });

  // ---------------------------------------------------------------
  // Register as voter (whitelist check against admin student list)
  // ---------------------------------------------------------------
  const regForm = document.getElementById('registerForm');
  const regAdm = document.getElementById('regAdm');
  const regBtn = document.getElementById('registerBtn');
  const regBox = document.getElementById('regBox');

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
        showReg('Registration successful. Now log in above with your adm number as both username and password.', false);
        toast('Registration successful. Please log in.', 'success');
        emailInput.value = adm;
        passwordInput.focus();
      } catch (err) {
        const msg = (err && err.message) || '';
        if (msg.indexOf('admin office') !== -1 || (err.details && String(err.details).indexOf('admin office') !== -1)) {
          showReg('Adm number not found. Please visit the admin office for registration.', true);
        } else if (msg.indexOf('Already registered') !== -1) {
          showReg('Already registered. Please log in above with your adm number.', false);
          emailInput.value = adm;
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