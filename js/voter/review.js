// =====================================================================
//  Review + submit vote (server-enforced one-vote rule via Cloud Function)
// =====================================================================
(function () {
  const $rows = document.getElementById('reviewRows');
  const $electionName = document.getElementById('reviewElectionName');
  const $confirmBtn = document.getElementById('confirmBtn');
  const $submitBtn = document.getElementById('submitBtn');

  const createVote = FB_FUNCTIONS.httpsCallable('createVote');

  let draft = null;

  function readDraft() {
    try {
      const raw = sessionStorage.getItem('cusco_ballot');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function render() {
    draft = readDraft();
    if (!draft || !draft.electionId || !draft.ballot) {
      location.replace('/voter/vote.html');
      return;
    }

    $electionName.textContent = draft.electionName || 'Not set';
    $rows.innerHTML = Object.keys(draft.ballot).map(function (posId) {
      const posName = (draft.positionNames && draft.positionNames[posId]) || 'Position';
      const candName = (draft.candidateNames && draft.candidateNames[posId]) || 'Not set';
      return (
        '<div class="review-row">' +
        '<div><span class="pos">' + esc(posName) + '</span><span class="sel">' + esc(candName) + '</span></div>' +
        '<span class="badge active">Selected</span>' +
        '</div>'
      );
    }).join('') || '<p class="muted">No selections found.</p>';
  }

  document.getElementById('backBtn').addEventListener('click', function () {
    history.back();
  });

  $submitBtn.addEventListener('click', function () {
    openModal('confirmModal');
  });

  document.getElementById('cancelBtn').addEventListener('click', function () {
    closeModal('confirmModal');
  });

  $confirmBtn.addEventListener('click', async function () {
    $confirmBtn.disabled = true;
    $confirmBtn.textContent = 'Submitting…';
    try {
      const res = await createVote({
        electionId: draft.electionId,
        ballot: draft.ballot
      });
      const receiptId = res.data.receiptId;
      sessionStorage.setItem('cusco_receipt', JSON.stringify({ electionId: draft.electionId, receiptId: receiptId }));
      sessionStorage.removeItem('cusco_ballot');
      location.replace('/voter/success.html');
    } catch (err) {
      $confirmBtn.disabled = false;
      $confirmBtn.textContent = 'Confirm Vote';

      let msg = friendlyError(err);
      let code = err.code || (err.details && err.details.error && err.details.error.code) || '';
      // Surface the message thrown inside the Cloud Function:
      const inner = err.details && err.details.error && err.details.error.message;
      if (inner) msg = inner;

      if (code === 'already-exists' || code === 'already-voted' || /already voted|already voted/i.test(msg)) {
        sessionStorage.removeItem('cusco_ballot');
        location.replace('/voter/dashboard.html');
        return;
      }
      toast(msg, 'error');
    }
  });

  window.authPromise.then(render);
})();