// =====================================================================
//  Admin: live voting graphs
//  Position cards for the open election, each with its live bar graph
//  embedded inline so results are visible immediately — no clicking.
//  Graphs refresh in real time while voting is in progress.
//  Blank when no election is open.
// =====================================================================
(function () {
  const $status = document.getElementById('liveStatus');
  const $badge = document.getElementById('liveBadge');
  const $grid = document.getElementById('positionGrid');
  const $blank = document.getElementById('blankCard');

  let election = null;
  let positions = [];
  let candidatesByPos = {};
  let results = {};
  let totalVotes = 0;
  let countdownTarget = 0;
  let countdownTimer = null;

  function posVotes(posId) {
    const m = results[posId] || {};
    return Object.keys(m).reduce(function (sum, cid) { return sum + (m[cid] || 0); }, 0);
  }

  function leaderOf(posId) {
    const list = candidatesByPos[posId] || [];
    let best = null;
    list.forEach(function (c) {
      const n = ((results[posId] || {})[c.id]) || 0;
      if (!best || n > best.votes) best = { name: c.name, votes: n };
    });
    return best && best.votes > 0 ? best : null;
  }

  async function refresh() {
    if (document.hidden) return;
    const [aSnap, sSnap] = await Promise.all([
      DB.collection('elections').where('status', '==', 'active').limit(1).get(),
      DB.collection('elections').where('status', '==', 'scheduled').get().catch(function () { return null; })
    ]);
    if (!aSnap.docs.length) {
      election = null;
      // No open election: show the next scheduled one with a countdown.
      let upcoming = null;
      if (sSnap) {
        let best = 0;
        sSnap.docs.forEach(function (x) {
          const v = x.data() || {};
          const startMs = tsToDate(v.startTime).getTime() || 0;
          if (!startMs) return;
          if (!upcoming || startMs < best) { upcoming = Object.assign({ id: x.id }, v); best = startMs; }
        });
      }
      if (upcoming) renderUpcoming(upcoming);
      else renderBlank();
      return;
    }
    const d = aSnap.docs[0];
    election = Object.assign({ id: d.id }, d.data());

    const [pSnap, cSnap, vSnap] = await Promise.all([
      DB.collection('positions').where('electionId', '==', election.id).get(),
      DB.collection('candidates').where('electionId', '==', election.id).get(),
      DB.collection('votes').doc(election.id).get().catch(function () { return null; })
    ]);

    positions = pSnap.docs.map(function (x) {
      const v = x.data();
      return { id: x.id, name: v.name, order: v.order || 0 };
    }).sort(function (a, b) { return a.order - b.order; });

    candidatesByPos = {};
    cSnap.docs.forEach(function (x) {
      const v = x.data();
      if (!v.positionId || v.status !== 'active') return;
      if (!candidatesByPos[v.positionId]) candidatesByPos[v.positionId] = [];
      candidatesByPos[v.positionId].push({ id: x.id, name: v.name, photo: v.photo || null });
    });

    const vData = vSnap && vSnap.exists ? (vSnap.data() || {}) : {};
    results = vData.results || {};
    totalVotes = vData.totalVotes || 0;

    renderLive();
  }

  function renderBlank() {
    countdownTarget = 0;
    $status.textContent = '';
    $badge.innerHTML = '<span class="badge draft">Offline</span>';
    $grid.innerHTML = '';
    $blank.classList.remove('hidden');
  }

  function fmtCountdown(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return (d > 0 ? d + 'd ' : '') + pad(h) + ':' + pad(m) + ':' + pad(sec);
  }

  function tickCountdown() {
    const el = document.getElementById('countdownClock');
    if (!el || !countdownTarget) return;
    const diff = countdownTarget - Date.now();
    el.textContent = diff > 0 ? fmtCountdown(diff) : 'Opening now...';
  }

  function renderUpcoming(up) {
    const startMs = tsToDate(up.startTime).getTime() || 0;
    const endMs = tsToDate(up.endTime).getTime() || 0;
    const nowMs = Date.now();
    $blank.classList.add('hidden');
    $badge.innerHTML = '<span class="badge scheduled">Upcoming</span>';
    countdownTarget = startMs;
    if (endMs && nowMs > endMs) {
      $status.textContent = 'Upcoming election: ' + up.name;
      $grid.innerHTML = '<div class="card"><div class="empty">This election window has ended. It is closing...</div></div>';
      return;
    }
    $status.textContent = 'Upcoming election: ' + up.name + ' · Starts ' + fmtDateTime(up.startTime) + ' · Ends ' + fmtDateTime(up.endTime);
    $grid.innerHTML =
      '<div class="card center">' +
      '<p class="muted text-sm">Voting opens in</p>' +
      '<div id="countdownClock" class="countdown">Loading...</div>' +
      '<p class="muted text-sm mt-16">Election: <strong>' + esc(up.name) + '</strong></p>' +
      '</div>';
    tickCountdown();
  }

  // Inline bar rows for a position card: same markup as the modal
  // graph so the live results are visible without any click.
  function barRows(posId) {
    const cands = (candidatesByPos[posId] || []).map(function (c) {
      return { cand: c, votes: ((results[posId] || {})[c.id]) || 0 };
    }).sort(function (a, b) { return b.votes - a.votes; });
    const posTotal = cands.reduce(function (sum, r) { return sum + r.votes; }, 0);
    const top = cands.length && cands[0].votes > 0 ? cands[0].votes : 0;
    if (!cands.length) {
      return '<div class="empty">No candidates in this position yet.</div>';
    }
    return cands.map(function (r) {
      const pct = posTotal ? Math.round((r.votes / posTotal) * 100) : 0;
      const photo = r.cand.photo
        ? '<img class="avatar" src="' + esc(r.cand.photo) + '" alt="" style="object-fit:cover;">'
        : '<span class="avatar">' + esc(initials(r.cand.name)) + '</span>';
      const lead = top && r.votes === top ? ' <span class="badge active">Leading</span>' : '';
      return (
        '<div class="graph-row">' +
        '<div class="graph-meta">' +
        '<span class="graph-cand">' + photo + '<span><strong>' + esc(r.cand.name) + '</strong>' + lead + '</span></span>' +
        '<span><span class="graph-count">' + fmtNum(r.votes) + '</span> <span class="graph-pct">' + pct + '%</span></span>' +
        '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div>' +
        '</div>'
      );
    }).join('');
  }

  function renderLive() {
    $status.textContent = election.name + ' · ' + fmtNum(totalVotes) + ' vote' + (totalVotes === 1 ? '' : 's') + ' cast so far.';
    $badge.innerHTML = '<span class="badge active-running">Live</span>';
    $blank.classList.add('hidden');

    if (!positions.length) {
      $grid.innerHTML = '<div class="card"><div class="empty">No ballot positions defined for this election yet.</div></div>';
      return;
    }

    $grid.innerHTML = '<div class="stat-grid">' + positions.map(function (pos) {
      const cands = candidatesByPos[pos.id] || [];
      const votes = posVotes(pos.id);
      const leader = leaderOf(pos.id);
      return (
        '<div class="stat pos-card" data-pos="' + esc(pos.id) + '">' +
        '<div class="num">' + fmtNum(votes) + '</div>' +
        '<div class="label"><strong>' + esc(pos.name) + '</strong></div>' +
        '<div class="label">' + cands.length + ' candidate' + (cands.length === 1 ? '' : 's') +
        (leader ? ' · Leading: <strong>' + esc(leader.name) + '</strong>' : ' · No votes yet') + '</div>' +
        '<div class="live-bars" style="margin-top:12px;text-align:left;">' + barRows(pos.id) + '</div>' +
        '</div>'
      );
    }).join('') + '</div>';
  }

  // Real-time sync: snapshots refresh the inline graphs the moment
  // votes change. The 1s countdown clock stays on its own timer.
  window.authPromise.then(function () {
    return refresh().catch(function (err) {
      $status.textContent = 'Could not load live data.';
      toast('Could not load live data: ' + friendlyError(err), 'error');
    });
  }).then(function () {
    liveCollections(
      [DB.collection('elections'), DB.collection('positions'), DB.collection('candidates'), DB.collection('votes')],
      function () { return refresh().catch(function () {}); }
    );
    countdownTimer = setInterval(tickCountdown, 1000);
    window.addEventListener('beforeunload', function () {
      if (countdownTimer) clearInterval(countdownTimer);
    });
  });
})();
