// =====================================================================
//  Voter: profile view + own password change
// =====================================================================
(function () {
  const $body = document.getElementById('profileBody');
  const $form = document.getElementById('pwForm');
  const $pwNew = document.getElementById('pwNew');
  const $pwConfirm = document.getElementById('pwConfirm');
  const $pwBtn = document.getElementById('pwBtn');
  const $pwError = document.getElementById('pwError');

  async function load() {
    const a = window.__auth;
    if (!a.user) return;
    try {
      const snap = await DB.collection('users').doc(a.user.uid).get();
      const p = snap.exists ? snap.data() : {};
      $body.innerHTML =
        '<table class="data">' +
        '<tr><td><span class="muted">Full Name</span></td><td><strong>' + esc(p.fullName || a.user.displayName || 'Not set') + '</strong></td></tr>' +
        '<tr><td><span class="muted">Adm Number</span></td><td>' + esc(p.voterId || p.admNumber || 'Not set') + '</td></tr>' +
        '<tr><td><span class="muted">Status</span></td><td>' + esc(p.status || 'active') + '</td></tr>' +
        '</table>';
    } catch (err) {
      $body.innerHTML = '<p class="muted center">Could not load profile: ' + esc(friendlyError(err)) + '</p>';
    }
  }

  $form.addEventListener('submit', async function (e) {
    e.preventDefault();
    $pwError.style.display = 'none';
    const a = String($pwNew.value || '');
    const b = String($pwConfirm.value || '');
    if (a.length < 6) { $pwError.textContent = 'Password must be at least 6 characters.'; $pwError.style.display = 'block'; return; }
    if (a !== b) { $pwError.textContent = 'Passwords do not match.'; $pwError.style.display = 'block'; return; }
    $pwBtn.disabled = true;
    $pwBtn.textContent = 'Saving…';
    try {
      const fn = FB_FUNCTIONS.httpsCallable('changeOwnPassword');
      await fn({ newPassword: a });
      try { await AUTH.currentUser.getIdToken(true); } catch (e2) {}
      toast('Password updated.', 'success');
      $form.reset();
    } catch (err) {
      $pwError.textContent = friendlyError(err);
      $pwError.style.display = 'block';
    } finally {
      $pwBtn.disabled = false;
      $pwBtn.textContent = 'Save New Password';
    }
  });

  window.authPromise.then(function () {
    return load().then(function () {
      // Real-time: profile changes (e.g. by an admin) appear at once.
      // Updates still pause while typing the new password.
      const uid = window.__auth && window.__auth.user ? window.__auth.user.uid : null;
      liveCollections(uid ? [DB.collection('users').doc(uid)] : [], load);
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load profile: ' + esc(friendlyError(err)) + '</p>';
  });
})();
