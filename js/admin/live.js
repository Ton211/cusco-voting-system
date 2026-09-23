// =====================================================================
//  Admin: live voting graphs
//  Position cards for the open election. Opening a card shows a live
//  bar graph per candidate that refreshes every few seconds while
//  voting is in progress. Blank when no election is open.
// =====================================================================
(function () {
  const $status = document.getElementById('liveStatus');
  const $badge = document.getElementById('liveBadge');
  const $grid = document.getElementById('positionGrid');
  const $blank = document.getElementById('blankCard');
  const $graphTitle = document.getElementById('graphTitle');
  const $graphMeta = document.getElementById('graphMeta');
  const $graphBody = document.getElementById('graphBody');
  const $graphModal = document.getElementById('graphModal');

  const POLL_MS = 3000;

  let election = null;
  let positions = [];
  let candidatesByPos = {};
  let results = {};
  let totalVotes = 0;
  let openPosId = null;
  let timer = null;
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
    if (openPosId) renderGraph();
  }

  function renderBlank() {
    countdownTarget = 0;
    $status.textContent = 'No open election. Live graphs appear here once voting opens.';
    $badge.innerHTML = '<span class="badge draft">Offline</span>';
    $grid.innerHTML = '';
    $blank.classList.remove('hidden');
    if (openPosId) { openPosId = null; closeModal('graphModal'); }
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
    if (openPosId) { openPosId = null; closeModal('graphModal'); }
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
        '<div class="stat pos-card" data-pos="' + esc(pos.id) + '" role="button" tabindex="0">' +
        '<div class="num">' + fmtNum(votes) + '</div>' +
        '<div class="label"><strong>' + esc(pos.name) + '</strong></div>' +
        '<div class="label">' + cands.length + ' candidate' + (cands.length === 1 ? '' : 's') +
        (leader ? ' · Leading: <strong>' + esc(leader.name) + '</strong>' : ' · No votes yet') + '</div>' +
        '<div class="label" style="margin-top:8px;"><span class="btn btn-outline btn-sm">View live graph</span></div>' +
        '</div>'
      );
    }).join('') + '</div>';
  }

  function renderGraph() {
    const pos = positions.find(function (p) { return p.id === openPosId; });
    if (!pos) return;
    const cands = (candidatesByPos[pos.id] || []).map(function (c) {
      return { cand: c, votes: ((results[pos.id] || {})[c.id]) || 0 };
    }).sort(function (a, b) { return b.votes - a.votes; });
    const posTotal = cands.reduce(function (sum, r) { return sum + r.votes; }, 0);
    const top = cands.length && cands[0].votes > 0 ? cands[0].votes : 0;

    $graphTitle.textContent = pos.name + ' · Live';
    $graphMeta.textContent = fmtNum(posTotal) + ' vote' + (posTotal === 1 ? '' : 's') + ' in this position · ' + esc(election.name);

    if (!cands.length) {
      $graphBody.innerHTML = '<div class="empty">No candidates in this position yet.</div>';
      return;
    }

    $graphBody.innerHTML = cands.map(function (r) {
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

  $grid.addEventListener('click', function (ev) {
    const card = ev.target.closest('.pos-card');
    if (!card) return;
    openPosId = card.dataset.pos;
    renderGraph();
    openModal('graphModal');
  });
  $grid.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = ev.target.closest('.pos-card');
    if (!card) return;
    ev.preventDefault();
    openPosId = card.dataset.pos;
    renderGraph();
    openModal('graphModal');
  });

  qsa('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeModal(b.dataset.close); });
  });
  $graphModal.addEventListener('click', function (e) {
    if (e.target === $graphModal) { openPosId = null; closeModal('graphModal'); }
  });

  // Own poller (not autoLive): the graph must keep refreshing while
  // its modal is open, which autoLive deliberately skips.
  window.authPromise.then(function () {
    return refresh().catch(function (err) {
      $status.textContent = 'Could not load live data.';
      toast('Could not load live data: ' + friendlyError(err), 'error');
    });
  }).then(function () {
    timer = setInterval(function () { refresh().catch(function () {}); }, POLL_MS);
    countdownTimer = setInterval(tickCountdown, 1000);
    window.addEventListener('beforeunload', function () {
      if (timer) clearInterval(timer);
      if (countdownTimer) clearInterval(countdownTimer);
    });
  });
})();
