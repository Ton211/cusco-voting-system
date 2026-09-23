// =====================================================================
//  Voter: voting receipts (proof of vote, never reveals choices)
// =====================================================================
(function () {
  const $body = document.getElementById('receiptBody');

  async function load() {
    const a = window.__auth;
    if (!a.user) return;
    try {
      const [recSnap, eleSnap] = await Promise.all([
        DB.collection('users').doc(a.user.uid).collection('receipts').get(),
        DB.collection('elections').get()
      ]);
      const names = {};
      eleSnap.docs.forEach(function (d) { names[d.id] = d.data().name || d.id; });
      if (!recSnap.docs.length) {
        $body.innerHTML = '<div class="alert alert-info center">No votes recorded yet. Once you vote, your receipt appears here.</div>';
        return;
      }
      $body.innerHTML = recSnap.docs.map(function (d) {
        const r = d.data();
        return '<div class="review-row"><div><span class="pos">' + esc(names[r.electionId] || r.electionId) + '</span>' +
          '<span class="receipt">' + esc(r.receiptId || 'Not set') + '</span></div>' +
          '<span class="badge voted">Voted</span></div>';
      }).join('');
    } catch (err) {
      $body.innerHTML = '<p class="muted center">Could not load receipts: ' + esc(friendlyError(err)) + '</p>';
    }
  }

  window.authPromise.then(function () {
    return load().then(function () { autoLive(load); });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load receipts: ' + esc(friendlyError(err)) + '</p>';
  });
})();
