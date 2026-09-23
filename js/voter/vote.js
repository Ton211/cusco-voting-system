// =====================================================================
//  Voting page — one radio per candidate, grouped by position
// =====================================================================
(function () {
  const $body = document.getElementById('voteBody');
  const $continue = document.getElementById('continueBtn');
  const $progress = document.getElementById('voteProgress');
  const $electionName = document.getElementById('voteElectionName');

  let election = null;
  let positions = [];
  const selection = {}; // positionId -> candidateId

  async function load() {
    const a = window.__auth;
    const userSnap = await DB.collection('users').doc(a.user.uid).get();
    const profile = userSnap.exists ? userSnap.data() : {};

    election = await fetchActiveElection();
    if (!election) {
      $body.innerHTML = '<div class="alert alert-warn center">There is no active election right now.</div>';
      return;
    }

    if (profile.votedIn && profile.votedIn[election.id]) {
      location.replace('/voter/dashboard.html');
      return;
    }
    $electionName.textContent = election.name;

    const posSnap = await DB.collection('positions')
      .where('electionId', '==', election.id)
      .get();
    positions = posSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, name: x.name, order: x.order || 0 };
    });
    positions.sort(function (a, b) { return a.order - b.order; });

    if (!positions.length) {
      $body.innerHTML = '<div class="alert alert-warn center">This election has no ballot positions yet. Please try again later.</div>';
      return;
    }

    const candidatesSnap = await DB.collection('candidates')
      .where('electionId', '==', election.id)
      .get();

    const byPosition = {};
    candidatesSnap.docs.forEach(function (d) {
      const x = d.data();
      if (x.positionId && x.status === 'active') {
        if (!byPosition[x.positionId]) byPosition[x.positionId] = [];
        byPosition[x.positionId].push({ id: d.id, name: x.name, photo: x.photo || null, description: x.description || '' });
      }
    });

    $progress.textContent = '0 / ' + positions.length + ' selected';

    $body.innerHTML = positions.map(function (pos, idx) {
      const candidates = byPosition[pos.id] || [];
      const cards = candidates.map(function (c) {
        const photo = c.photo
          ? '<img class="choice-photo" src="' + esc(c.photo) + '" alt="">'
          : '<span class="avatar" style="width:52px;height:52px;font-size:16px;flex:none;">' + esc(initials(c.name)) + '</span>';
        return (
          '<label class="choice-label" data-pos="' + esc(pos.id) + '" data-cand="' + esc(c.id) + '">' +
          '<input type="radio" name="pos_' + esc(pos.id) + '" value="' + esc(c.id) + '">' +
          photo +
          '<span class="choice-meta"><strong>' + esc(c.name) + '</strong>' +
          (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
          '</span>' +
          '</label>'
        );
      }).join('');

      const required = candidates.length ? '' :
        '<p class="muted" style="font-size:13px;">No candidates for this position yet.</p>';

      return (
        '<div class="card" data-position="' + esc(pos.id) + '">' +
        '<div class="step-head"><h2>' + (idx + 1) + '. ' + esc(pos.name) + '</h2></div>' +
        '<div class="choice-grid">' + (cards || required) + '</div>' +
        '</div>'
      );
    }).join('');

    // Track selections
    $body.addEventListener('change', onSelect);
    updateContinue();
  }

  function onSelect(e) {
    if (e.target.type !== 'radio') return;
    const label = e.target.closest('.choice-label');
    const posId = label.dataset.pos;
    const candId = label.dataset.cand;
    selection[posId] = candId;
    qsa('[data-pos="' + posId + '"].choice-label').forEach(function (l) {
      l.classList.toggle('checked', l.dataset.cand === candId);
    });
    updateContinue();
  }

  function updateContinue() {
    const chosen = Object.keys(selection).filter(function (k) {
      return positions.some(function (p) { return p.id === k; });
    }).length;
    $continue.disabled = positions.length === 0 || chosen < positions.length;
    $progress.textContent = chosen + ' / ' + positions.length + ' selected';
  }

  $continue.addEventListener('click', function () {
    const ballot = {};
    positions.forEach(function (p) {
      const cand = selection[p.id];
      if (cand) ballot[p.id] = cand;
    });

    const candidateNames = {};
    const positionNames = {};
    positions.forEach(function (p) {
      positionNames[p.id] = p.name;
      const labels = qsa('[data-pos="' + p.id + '"].choice-label');
      labels.forEach(function (l) {
        if (l.dataset.cand === ballot[p.id]) candidateNames[p.id] = l.querySelector('.choice-meta strong').textContent;
      });
    });

    const data = {
      electionId: election.id,
      electionName: election.name,
      ballot: ballot,
      positionNames: positionNames,
      candidateNames: candidateNames
    };
    sessionStorage.setItem('cusco_ballot', JSON.stringify(data));
    location.href = '/voter/review.html';
  });

  window.authPromise.then(load).catch(function (err) {
    $body.innerHTML = '<div class="alert alert-warn center">Could not load the ballot: ' + esc(friendlyError(err)) + '</div>';
  });
})();