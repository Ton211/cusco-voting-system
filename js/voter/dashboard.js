// =====================================================================
//  Voter dashboard
// =====================================================================
(function () {
  const $body = document.getElementById('dashboardBody');

  async function load() {
    const a = window.__auth;
    if (!a.user) return;

    const [userSnap, activeElection, scheduledElection] = await Promise.all([
      DB.collection('users').doc(a.user.uid).get(),
      fetchActiveElection(),
      fetchNextScheduledElection()
    ]);

    const profile = userSnap.exists ? userSnap.data() : {};
    const alreadyVotedInThisElection = !!(activeElection && profile.votedIn && profile.votedIn[activeElection.id]);

    let html = '<div class="center-logo mb-12"><h1>' + esc(profile.fullName || a.user.email || '') + '</h1><p>My Voting Portal</p></div>';

    if (!profile.status || profile.status === 'inactive') {
      html += '<div class="center"><p class="muted">Your account is currently inactive. Contact an administrator.</p></div>';
      $body.innerHTML = html;
      return;
    }

    if (!activeElection) {
      if (scheduledElection) {
        html += '<div class="alert alert-warn center"><strong>No election is open right now.</strong><br>Accepting votes ' + fmtDateTime(scheduledElection.startTime) + '  to  ' + fmtDateTime(scheduledElection.endTime) + '</div>';
      } else {
        html += '<div class="alert alert-info center">No election is currently active. Please check back later.</div>';
      }
      $body.innerHTML = html;
      return;
    }

    if (alreadyVotedInThisElection) {
      // Already voted in this election: show the receipt only.
      try {
        const recSnap = await DB.collection('users').doc(a.user.uid).collection('receipts').doc(activeElection.id).get();
        const receipt = recSnap.exists ? recSnap.data().receiptId : null;
        html +=
          '<div class="alert alert-success center mb-12"><strong>You have already voted in this election.</strong></div>' +
          '<div class="center">' +
          (receipt ? '<span class="receipt">' + esc(receipt) + '</span>' : '') +
          '<p class="muted mt-16" style="font-size:13px;">Your vote was recorded at ' + fmtDateTime(profile.lastVotedAt) + '.</p>' +
          '<p class="muted" style="font-size:13px;">One vote per election. Thank you for voting.</p>' +
          '</div>';
      } catch (err) {
        html += '<div class="alert alert-success center mb-12"><strong>You have already voted in this election.</strong></div>';
      }
      $body.innerHTML = html;
      return;
    }

    const openNow = isElectionOpen(activeElection);
    html +=
      '<div class="center-logo mb-12"><p>ACTIVE ELECTION</p><h1 style="font-size:20px; margin-top:4px;">' + esc(activeElection.name) + '</h1></div>';

    if (openNow) {
      html +=
        '<div class="alert alert-success center mb-12">Voting is currently <strong>OPEN</strong> until ' + fmtDateTime(activeElection.endTime) + '.</div>' +
        '<div class="center">' +
        '<a class="btn btn-primary btn-lg" href="/voter/vote.html">Start Voting</a>' +
        '</div>';
    } else {
      const endMs = tsToDate(activeElection.endTime).getTime();
      if (!isNaN(endMs) && Date.now() > endMs) {
        html += '<div class="alert alert-warn center">Voting for this election has closed. Results will be published by the admin.</div>';
      } else {
        html += '<div class="alert alert-warn center">Voting opens ' + fmtDateTime(activeElection.startTime) + ' and closes ' + fmtDateTime(activeElection.endTime) + '.</div>';
      }
    }

    $body.innerHTML = html;
  }

  function isElectionOpen(ele) {
    const now = Date.now();
    const start = tsToDate(ele.startTime).getTime();
    const end = tsToDate(ele.endTime).getTime();
    return now >= start && now <= end;
  }

  // Clean any in-progress ballot when returning to the dashboard.
  window.authPromise.then(function () {
    try { sessionStorage.removeItem('cusco_ballot'); } catch (e) {}
    return load().then(function () {
      // Real-time: profile, receipts, or election changes update at once.
      const uid = window.__auth && window.__auth.user ? window.__auth.user.uid : null;
      const refs = [DB.collection('elections')];
      if (uid) {
        refs.push(DB.collection('users').doc(uid));
        refs.push(DB.collection('users').doc(uid).collection('receipts'));
      }
      liveCollections(refs, load);
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load your portal: ' + esc(friendlyError(err)) + '</p>';
  });
})();