// =====================================================================
//  Voter dashboard: elections overview, same look as the admin
//  Elections section — status badges (Open / Scheduled / Closed),
//  voting window, votes cast + turnout, and Vote / Results actions.
//  No personal header: just the elections.
// =====================================================================
(function () {
  const $body = document.getElementById('dashboardBody');

  // Active-voter count behind the turnout figures (students cannot read
  // the roster). Cached 60s so real-time refreshes don't hammer it.
  let cachedVoters = null;
  let cachedVotersAt = 0;

  async function getActiveVoters() {
    if (cachedVoters !== null && Date.now() - cachedVotersAt < 60000) return cachedVoters;
    const fn = FB_FUNCTIONS.httpsCallable('getPublicStats');
    const res = await fn({});
    cachedVoters = (res.data && res.data.activeVoters) || 0;
    cachedVotersAt = Date.now();
    return cachedVoters;
  }

  function badgeFor(status) {
    if (status === 'active') return '<span class="badge active-running">Open</span>';
    if (status === 'scheduled') return '<span class="badge scheduled">Scheduled</span>';
    if (status === 'closed') return '<span class="badge closed">Closed</span>';
    return '<span class="badge draft">' + esc(status || 'Draft') + '</span>';
  }

  function isElectionOpen(ele) {
    const now = Date.now();
    const start = tsToDate(ele.startTime).getTime();
    const end = tsToDate(ele.endTime).getTime();
    return now >= start && now <= end;
  }

  async function load() {
    const a = window.__auth;
    if (!a.user) return;

    const [userSnap, electionsSnap, votesSnap] = await Promise.all([
      DB.collection('users').doc(a.user.uid).get(),
      DB.collection('elections').get(),
      DB.collection('votes').get().catch(function () { return null; })
    ]);

    const profile = userSnap.exists ? userSnap.data() : {};
    if (!profile.status || profile.status === 'inactive') {
      $body.innerHTML = '<div class="center"><p class="muted">Your account is currently inactive. Contact an administrator.</p></div>';
      return;
    }

    const elections = electionsSnap.docs.map(function (d) {
      const x = d.data() || {};
      return { id: d.id, name: x.name || 'Unnamed election', startTime: x.startTime, endTime: x.endTime, status: x.status || 'draft' };
    });
    const rank = { active: 0, scheduled: 1, draft: 2, closed: 3 };
    elections.sort(function (x, y) {
      const r = (rank[x.status] === undefined ? 9 : rank[x.status]) - (rank[y.status] === undefined ? 9 : rank[y.status]);
      if (r !== 0) return r;
      return tsToDate(y.startTime).getTime() - tsToDate(x.startTime).getTime();
    });

    const castByElection = {};
    if (votesSnap) {
      votesSnap.docs.forEach(function (d) {
        castByElection[d.id] = (d.data() || {}).totalVotes || 0;
      });
    }

    let activeVoters = 0;
    try {
      activeVoters = await getActiveVoters();
    } catch (e) { activeVoters = 0; }

    const votedIn = profile.votedIn || {};
    const openUnvoted = elections.some(function (e) {
      return e.status === 'active' && isElectionOpen(e) && votedIn[e.id] !== true;
    });

    let html =
      '<div class="card-title">' +
      '<span>Elections</span>' +
      (openUnvoted ? '<a class="btn btn-outline btn-sm" href="/voter/vote.html">Vote Now</a>' : '') +
      '</div>' +
      '<div id="electionsList">';

    if (!elections.length) {
      html += '<div class="empty">No elections yet. Please check back later.</div>';
    } else {
      html += elections.map(function (e) {
        const cast = castByElection[e.id] || 0;
        const turnout = activeVoters ? Math.min(100, Math.round((cast / activeVoters) * 100)) : 0;
        const voted = votedIn[e.id] === true;
        const actions = e.status === 'active' && isElectionOpen(e) && !voted
          ? '<a class="btn btn-primary btn-sm" href="/voter/vote.html">Vote</a>'
          : (voted ? '<span class="badge active">Voted</span>' : '');
        return (
          '<div class="card" data-eid="' + esc(e.id) + '">' +
          '<div class="card-title">' +
          '<span>' + esc(e.name) + ' ' + badgeFor(e.status) + '</span>' +
          '<div class="row-actions">' +
          actions +
          '<a class="btn btn-outline btn-sm" href="/voter/results.html?election=' + encodeURIComponent(e.id) + '">Results</a>' +
          '</div>' +
          '</div>' +
          '<div class="muted text-sm">Voting window: <strong>' + esc(fmtDateTime(e.startTime)) + '</strong> to <strong>' + esc(fmtDateTime(e.endTime)) + '</strong></div>' +
          '<div class="mt-16 text-sm">Votes cast: <strong>' + fmtNum(cast) + '</strong> · Turnout: <strong>' + turnout + '%</strong></div>' +
          '</div>'
        );
      }).join('');
    }

    html += '</div>';
    $body.innerHTML = html;
  }

  // Clean any in-progress ballot when returning to the dashboard.
  window.authPromise.then(function () {
    try { sessionStorage.removeItem('cusco_ballot'); } catch (e) {}
    return load().then(function () {
      // Real-time: elections, tallies, or own voter record update at once.
      const uid = window.__auth && window.__auth.user ? window.__auth.user.uid : null;
      const refs = [DB.collection('elections'), DB.collection('votes')];
      if (uid) {
        refs.push(DB.collection('users').doc(uid));
        refs.push(DB.collection('users').doc(uid).collection('receipts'));
      }
      liveCollections(refs, load);
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load elections: ' + esc(friendlyError(err)) + '</p>';
  });
})();
