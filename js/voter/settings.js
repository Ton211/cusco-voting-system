// =====================================================================
//  Voter: settings — account details + own password change.
//  All messages arrive as side pop-out notices, never inline.
// =====================================================================
(function () {
  const $body = document.getElementById('settingsBody');
  const $form = document.getElementById('pwForm');
  const $pwNew = document.getElementById('pwNew');
  const $pwConfirm = document.getElementById('pwConfirm');
  const $pwBtn = document.getElementById('pwBtn');

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
      $body.innerHTML = '<p class="muted center">Could not load account details.</p>';
      toast('Could not load account details: ' + friendlyError(err), 'error');
    }
  }

  $form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const a = String($pwNew.value || '');
    const b = String($pwConfirm.value || '');
    if (a.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    if (a !== b) { toast('Passwords do not match.', 'error'); return; }
    $pwBtn.disabled = true;
    $pwBtn.textContent = 'Saving…';
    try {
      const fn = FB_FUNCTIONS.httpsCallable('changeOwnPassword');
      await withTimeout(fn({ newPassword: a }), 25000, 'Password change');
      try { await AUTH.currentUser.getIdToken(true); } catch (e2) {}
      toast('Password updated.', 'success');
      $form.reset();
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      $pwBtn.disabled = false;
      $pwBtn.textContent = 'Save New Password';
    }
  });

  window.authPromise.then(function () {
    return load().then(function () {
      // Real-time: account changes (e.g. by an admin) appear at once.
      // Updates still pause while typing the new password.
      const uid = window.__auth && window.__auth.user ? window.__auth.user.uid : null;
      liveCollections(uid ? [DB.collection('users').doc(uid)] : [], load);
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load account details.</p>';
    toast('Could not load account details: ' + friendlyError(err), 'error');
  });
})();
