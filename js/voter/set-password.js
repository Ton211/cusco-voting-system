// First-login password change: adm number -> own private password.
(function () {
  const form = document.getElementById('setPwForm');
  const pw1 = document.getElementById('newPassword');
  const pw2 = document.getElementById('confirmPassword');
  const errorBox = document.getElementById('errorBox');
  const saveBtn = document.getElementById('saveBtn');

  function showError(m) {
    errorBox.textContent = m;
    errorBox.style.display = 'block';
  }
  function clearError() { errorBox.style.display = 'none'; }

  document.getElementById('logoutLink').addEventListener('click', function (e) {
    e.preventDefault();
    AUTH.signOut().then(function () { location.replace('/'); });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();
    const a = String(pw1.value || '');
    const b = String(pw2.value || '');
    if (a.length < 6) { showError('Password must be at least 6 characters.'); return; }
    if (a !== b) { showError('Passwords do not match.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const fn = FB_FUNCTIONS.httpsCallable('changeOwnPassword');
      await fn({ newPassword: a });
      // Pull the cleared flag into the token so the dashboard opens at once.
      try { await AUTH.currentUser.getIdToken(true); } catch (e) {}
      location.replace('/voter/dashboard.html');
    } catch (err) {
      showError(friendlyError(err));
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Password and Continue';
    }
  });
})();
