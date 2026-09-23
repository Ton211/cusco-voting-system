// =====================================================================
//  Admin dashboard: statistics + active election overview
// =====================================================================
(function () {
  const $statGrid = document.getElementById('statGrid');
  const $electionInfo = document.getElementById('electionInfo');
  const $electionStatus = document.getElementById('electionStatusBadge');

  async function load() {
    const votersSnap = await DB.collection('users').where('role', '==', 'voter').get();
    const activeSnap = await DB.collection('elections').where('status', '==', 'active').limit(1).get();
    const totalVoters = votersSnap.size;

    const activeElection = activeSnap.docs.length ? activeSnap.docs[0] : null;
    let candidatesCount = 0;
    let votesCast = 0;

    if (activeElection) {
      const electionId = activeElection.id;
      const d = activeElection.data();

      const [candSnap, votesSnap] = await Promise.all([
        DB.collection('candidates')
          .where('electionId', '==', electionId)
          .where('status', '==', 'active')
          .get(),
        DB.collection('votes').doc(electionId).get().catch(function () { return null; })
      ]);
      candidatesCount = candSnap.size;
      votesCast = votesSnap && votesSnap.exists ? (votesSnap.data().totalVotes || 0) : 0;

      const remaining = Math.max(0, totalVoters - votesCast);
      $electionStatus.innerHTML = '<span class="badge active-running">OPEN</span>';
      $electionInfo.innerHTML =
        '<p><strong>' + esc(d.name) + '</strong></p>' +
        '<p class="muted">' + esc(d.description || 'No description') + '</p>' +
        '<p class="mt-16">Votes cast: <strong>' + fmtNum(votesCast) + '</strong> · ' +
        'Votes remaining: <strong>' + fmtNum(remaining) + '</strong> · ' +
        'Ends: <strong>' + fmtDateTime(d.endTime) + '</strong></p>';
    } else {
      $electionStatus.innerHTML = '<span class="badge draft">No active election</span>';
      $electionInfo.innerHTML =
        '<p class="muted">No election is currently active.</p>' +
        '<div class="mt-16"><a class="btn btn-primary" href="/admin/elections.html">Create or Open an Election</a></div>';
    }

    const turnout = totalVoters ? Math.round((votesCast / totalVoters) * 100) : 0;
    const nums = $statGrid.querySelectorAll('.num');
    nums[0].textContent = fmtNum(totalVoters);
    nums[1].textContent = fmtNum(candidatesCount);
    nums[2].textContent = fmtNum(votesCast);
    nums[3].textContent = turnout + '%';
  }

  window.authPromise.then(function () {
    load().then(function () { autoLive(load); }).catch(function (err) {
      $electionInfo.innerHTML = '<p class="muted">Could not load dashboard data.</p>';
      toast('Could not load dashboard: ' + friendlyError(err), 'error');
    });
  });
})();