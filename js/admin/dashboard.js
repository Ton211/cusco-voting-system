// =====================================================================
//  Admin dashboard: statistics + elections overview with actions
//
//  Counting rules (one voter counts as exactly one vote):
//  - Active Voters: users with role voter and status active.
//  - Votes Cast: distinct voters flagged votedIn for the election.
//    A voter who selects candidates in many positions still counts once.
//  - Turnout: votes cast divided by active voters, as a percentage.
// =====================================================================
(function () {
  const $statGrid = document.getElementById('statGrid');
  const $statScope = document.getElementById('statScope');
  const $list = document.getElementById('electionsList');

  function callable(name) {
    const fn = FB_FUNCTIONS.httpsCallable(name);
    return async function (payload) {
      const res = await fn(payload);
      return res.data;
    };
  }
  const saveElectionFn = callable('saveElection');

  function badgeFor(status) {
    const map = {
      draft: '<span class="badge draft">Draft</span>',
      scheduled: '<span class="badge scheduled">Scheduled</span>',
      active: '<span class="badge active-running">Active</span>',
      closed: '<span class="badge closed">Closed</span>'
    };
    return map[status] || '<span class="badge draft">' + esc(status) + '</span>';
  }

  function tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.getTime() || 0;
  }

  function electionStats(elections, castByElection, activeVoters) {
    return elections.map(function (e) {
      const cast = castByElection[e.id] || 0;
      const turnout = activeVoters ? Math.min(100, Math.round((cast / activeVoters) * 100)) : 0;
      return { election: e, cast: cast, turnout: turnout };
    });
  }

  async function load() {
    const [usersSnap, electionsSnap] = await Promise.all([
      DB.collection('users').where('role', '==', 'voter').get(),
      DB.collection('elections').get()
    ]);

    // One pass over voters: active count + per election distinct voters.
    let activeVoters = 0;
    const castByElection = {};
    usersSnap.docs.forEach(function (d) {
      const u = d.data() || {};
      if (u.status === 'active') activeVoters++;
      const votedIn = u.votedIn || {};
      Object.keys(votedIn).forEach(function (eid) {
        if (votedIn[eid] === true) castByElection[eid] = (castByElection[eid] || 0) + 1;
      });
    });

    const elections = electionsSnap.docs.map(function (d) {
      const x = d.data() || {};
      return { id: d.id, name: x.name || 'Unnamed election', startTime: x.startTime, endTime: x.endTime, status: x.status || 'draft' };
    });

    const rank = { active: 0, scheduled: 1, draft: 2, closed: 3 };
    elections.sort(function (a, b) {
      const r = (rank[a.status] === undefined ? 9 : rank[a.status]) - (rank[b.status] === undefined ? 9 : rank[b.status]);
      if (r !== 0) return r;
      return tsMs(b.startTime) - tsMs(a.startTime);
    });

    // Focus election for the headline stats: active, else nearest
    // scheduled, else most recent. Candidates and votes follow it.
    const focus = elections[0] || null;

    let candidatesCount = 0;
    let votesCast = 0;
    if (focus) {
      const candSnap = await DB.collection('candidates')
        .where('electionId', '==', focus.id)
        .where('status', '==', 'active')
        .get()
        .catch(function () { return { size: 0 }; });
      candidatesCount = candSnap.size;
      votesCast = castByElection[focus.id] || 0;
      $statScope.textContent = '';
      $statScope.style.display = 'none';
    } else {
      $statScope.textContent = 'No elections yet. Create one to get started.';
      $statScope.style.display = '';
    }

    const turnout = activeVoters ? Math.min(100, Math.round((votesCast / activeVoters) * 100)) : 0;
    const nums = $statGrid.querySelectorAll('.num');
    nums[0].textContent = fmtNum(activeVoters);
    nums[1].textContent = fmtNum(candidatesCount);
    nums[2].textContent = fmtNum(votesCast);
    nums[3].textContent = turnout + '%';

    renderList(electionStats(elections, castByElection, activeVoters));
  }

  function renderList(rows) {
    const viewer = window.isReadOnly();
    if (!rows.length) {
      $list.innerHTML =
        '<div class="empty">No elections yet.</div>' +
        (viewer ? '' : '<div class="center"><a class="btn btn-primary" href="/admin/elections.html">Create Election</a></div>');
      return;
    }
    $list.innerHTML = rows.map(function (row) {
      const e = row.election;
      const actions = viewer ? '' : (e.status === 'active'
        ? '<button class="btn btn-danger-outline btn-sm" data-action="close" data-eid="' + esc(e.id) + '">Close</button>'
        : '<button class="btn btn-outline btn-sm" data-action="open" data-eid="' + esc(e.id) + '">Open</button>');
      return (
        '<div class="card" data-eid="' + esc(e.id) + '">' +
        '<div class="card-title">' +
        '<span>' + esc(e.name) + ' ' + badgeFor(e.status) + '</span>' +
        '<div class="row-actions">' +
        actions +
        '<a class="btn btn-outline btn-sm" href="/admin/results.html?election=' + encodeURIComponent(e.id) + '">Results</a>' +
        '</div>' +
        '</div>' +
        '<div class="muted text-sm">Voting window: <strong>' + esc(fmtDateTime(e.startTime)) + '</strong> to <strong>' + esc(fmtDateTime(e.endTime)) + '</strong></div>' +
        '<div class="mt-16 text-sm">Votes cast: <strong>' + fmtNum(row.cast) + '</strong> · Turnout: <strong>' + row.turnout + '%</strong></div>' +
        '</div>'
      );
    }).join('');
  }

  $list.addEventListener('click', function (ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const eid = btn.dataset.eid;
    const action = btn.dataset.action;
    if (action === 'open') quickStatus(eid, 'active');
    if (action === 'close') quickStatus(eid, 'closed');
  });

  async function quickStatus(eid, status) {
    const label = status === 'active' ? 'Open' : 'Close';
    const ok = await confirmDialog({
      title: label + ' election',
      message: status === 'active'
        ? 'Open this election for voting? Any other active election will be closed.'
        : 'Close this election and stop further voting?',
      confirmText: label,
      danger: status !== 'active'
    });
    if (!ok) return;
    try {
      // Status only update. The backend merges it over the stored record.
      await saveElectionFn({ id: eid, status: status });
      toast('Election ' + label.toLowerCase() + 'd.', 'success');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    }
  }

  window.authPromise.then(function () {
    // View-only staff see numbers only: no quick actions, no open/close.
    window.hideForReadOnly('#nextStepsCard');
    load().then(function () { liveCollections([DB.collection('users').where('role', '==', 'voter'), DB.collection('elections'), DB.collection('candidates')], load); }).catch(function (err) {
      $list.innerHTML = '<p class="muted">Could not load dashboard data.</p>';
      toast('Could not load dashboard: ' + friendlyError(err), 'error');
    });
  });
})();
