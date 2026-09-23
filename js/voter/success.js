// =====================================================================
//  Vote success page — shows the anonymised receipt reference
// =====================================================================
(function () {
  const $ref = document.getElementById('reference');

  window.authPromise.then(function () {
    let receiptId = null;
    try {
      const raw = sessionStorage.getItem('cusco_receipt');
      if (raw) {
        const parsed = JSON.parse(raw);
        receiptId = parsed.receiptId;
      }
    } catch (e) {}

    if (receiptId) {
      $ref.textContent = receiptId;
    } else {
      // User landed directly (e.g. refreshed). Pull the receipt from Firestore.
      const uid = window.__auth.user.uid;
      DB.collection('elections').where('status', '==', 'active').limit(1).get()
        .then(function (snap) {
          if (!snap.docs.length) { $ref.textContent = '—'; return; }
          const electionId = snap.docs[0].id;
          return DB.collection('users').doc(uid).collection('receipts').doc(electionId).get();
        })
        .then(function (rec) {
          if (rec && rec.exists) $ref.textContent = rec.data().receiptId;
        })
        .catch(function () {});
    }
  });
})();