// =====================================================================
//  Admin: election results
// =====================================================================
(function () {
  const $select = document.getElementById('resultsElection');
  const $body = document.getElementById('resultsBody');
  const $hideToggle = document.getElementById('hideUntilClose');

  let selectedElection = null;

  // ---------------------------------------------------------------
  // Election selector + results-visibility setting
  // ---------------------------------------------------------------
  async function loadSelect() {
    const [eSnap, settingsSnap] = await Promise.all([
      DB.collection('elections').get(),
      DB.collection('settings').doc('resultsVisibility').get().catch(function () { return null; })
    ]);

    const elections = eSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, name: x.name, status: x.status };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    $select.innerHTML =
      '<option value="">Select an election…</option>' +
      elections.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');

    // Same markup on both portals; the toggle is hidden for voters.
    if ($hideToggle) {
      if (settingsSnap && settingsSnap.exists) {
        const s = settingsSnap.data();
        $hideToggle.checked = s.hideUntilClose !== false;
      } else {
        $hideToggle.checked = true;
      }
    }

    // Auto pick so results show at once: the election from ?election=
    // (dashboard deep link) first, then the active election,
    // else the single election when only one exists.
    const params = new URLSearchParams(window.location.search || '');
    const requested = params.get('election');
    const requestedMatch = requested && elections.find(function (e) { return e.id === requested; });
    const active = elections.find(function (e) { return e.status === 'active'; });
    const pick = requestedMatch || active || (elections.length === 1 ? elections[0] : null);
    if (pick) {
      $select.value = pick.id;
      selectedElection = { id: pick.id };
      try {
        await loadElection(pick.id);
      } catch (err) {
        $body.innerHTML = '<div class="empty">Could not load results: ' + esc(friendlyError(err)) + '</div>';
      }
    }
  }

  // Visibility toggle is staff-only; hidden for voters at startup.
  if ($hideToggle) {
  $hideToggle.addEventListener('change', async function () {
    try {
      await DB.collection('settings').doc('resultsVisibility').set({
        hideUntilClose: $hideToggle.checked,
        electionId: selectedElection ? selectedElection.id : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('Results visibility updated.', 'success');
    } catch (err) {
      toast(friendlyError(err), 'error');
      $hideToggle.checked = !$hideToggle.checked;
    }
  });
  }

  // ---------------------------------------------------------------
  // Loading results
  // ---------------------------------------------------------------
  async function loadElection(electionId, silent) {
    if (!silent) $body.innerHTML = '<div class="empty">Loading…</div>';

    // This same file powers the student portal Results page: voters
    // cannot read the voter roster, so the users query is staff-only
    // and their turnout base comes from getPublicStats instead.
    const isVoterView = window.__auth && window.__auth.role === 'voter';
    const [electionSnap, positionsSnap, candidatesSnap, votesSnap, votersSnap] = await Promise.all([
      DB.collection('elections').doc(electionId).get(),
      DB.collection('positions').where('electionId', '==', electionId).get(),
      DB.collection('candidates').where('electionId', '==', electionId).get(),
      DB.collection('votes').doc(electionId).get().catch(function () { return null; }),
      isVoterView ? null : DB.collection('users').where('role', '==', 'voter').get().catch(function () { return null; })
    ]);

    if (!electionSnap.exists) { $body.innerHTML = '<div class="empty">Election not found.</div>'; return; }

    const election = electionSnap.data();
    const positions = positionsSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, name: x.name, order: x.order || 0 };
    }).sort(function (a, b) { return a.order - b.order; });

    const candidatesByPosition = {};
    candidatesSnap.docs.forEach(function (d) {
      const x = d.data();
      if (!candidatesByPosition[x.positionId]) candidatesByPosition[x.positionId] = [];
      candidatesByPosition[x.positionId].push({ id: d.id, name: x.name, photo: x.photo || null, status: x.status, description: x.description || '' });
    });

    const votes = votesSnap && votesSnap.exists ? (votesSnap.data() || {}) : {};
    const results = votes.results || {};
    const totalVotes = votes.totalVotes || 0;
    let totalVoters = votersSnap ? votersSnap.size : 0;
    if (isVoterView) {
      try {
        const stats = await FB_FUNCTIONS.httpsCallable('getPublicStats')({});
        totalVoters = (stats.data && stats.data.activeVoters) || 0;
      } catch (e) { totalVoters = 0; }
    }
    const turnout = totalVoters ? Math.round((totalVotes / totalVoters) * 100) : 0;

    // Summary stats
    const summary =
      '<div class="stat-grid mb-12">' +
      '<div class="stat"><div class="num">' + fmtNum(totalVoters) + '</div><div class="label">Registered Voters</div></div>' +
      '<div class="stat"><div class="num green">' + fmtNum(totalVotes) + '</div><div class="label">Votes Cast</div></div>' +
      '<div class="stat"><div class="num amber">' + turnout + '%</div><div class="label">Turnout</div></div>' +
      '<div class="stat"><div class="num">' + fmtNum(Math.max(0, totalVoters - totalVotes)) + '</div><div class="label">Votes Remaining</div></div>' +
      '</div>';

    if (!positions.length) {
      $body.innerHTML = summary + '<div class="empty">No positions defined for this election.</div>';
      return;
    }

    // Position cards in the same style as the Live page: vote total on
    // top, position name, standing line, then inline candidate bars.
    let html = summary;
    const isClosed = election.status === 'closed';
    const cards = positions.map(function (pos) {
      // Candidates ranked by votes (most first) so opponents always
      // appear in leading order, whether the election is live or closed.
      const list = (candidatesByPosition[pos.id] || [])
        .filter(function (c) { return c.status === 'active'; })
        .map(function (c) {
          return {
            id: c.id, name: c.name, photo: c.photo, status: c.status,
            count: ((results[pos.id] || {})[c.id]) || 0
          };
        })
        .sort(function (a, b) { return b.count - a.count; });

      const posTotal = list.reduce(function (sum, c) { return sum + c.count; }, 0);
      const top = list.length && list[0].count > 0 ? list[0].count : 0;
      const leaders = top ? list.filter(function (c) { return c.count === top; }) : [];
      const tied = leaders.length > 1;
      const leaderNames = leaders.map(function (c) { return c.name; }).join(', ');

      // Standing line: who is leading right now, or who won.
      let standing;
      if (!list.length) {
        standing = 'No candidates yet';
      } else if (!top) {
        standing = 'No votes yet';
      } else if (isClosed) {
        standing = (tied ? 'Tied winners: ' : 'Winner: ') + '<strong>' + esc(leaderNames) + '</strong> · ' + fmtNum(top) + ' votes';
      } else {
        standing = (tied ? 'Tied for lead: ' : 'Leading: ') + '<strong>' + esc(leaderNames) + '</strong> · ' + fmtNum(top) + ' votes';
      }

      const posBadge = isClosed
        ? '<span class="badge admin">Final</span>'
        : (election.status === 'active' ? '<span class="badge active-running">Live</span>' : '<span class="badge scheduled">' + esc(election.status || 'Not open') + '</span>');

      const rows = list.map(function (c) {
        const pct = posTotal ? Math.round((c.count / posTotal) * 100) : 0;
        const photo = c.photo
          ? '<img class="avatar" src="' + esc(c.photo) + '" alt="" style="object-fit:cover;">'
          : '<span class="avatar">' + esc(initials(c.name)) + '</span>';
        let badge = '';
        if (top && c.count === top) {
          if (isClosed) badge = tied ? ' <span class="badge scheduled">Tied winner</span>' : ' <span class="badge active">Winner</span>';
          else badge = tied ? ' <span class="badge scheduled">Tied lead</span>' : ' <span class="badge active">Leading</span>';
        }
        return (
          '<div class="graph-row">' +
          '<div class="graph-meta">' +
          '<span class="graph-cand">' + photo + '<span><strong>' + esc(c.name) + '</strong>' + badge + '</span></span>' +
          '<span><span class="graph-count">' + fmtNum(c.count) + '</span> <span class="graph-pct">' + pct + '%</span></span>' +
          '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div>' +
          '</div>'
        );
      }).join('') || '<div class="empty">No active candidates for this position.</div>';

      return (
        '<div class="stat pos-card">' +
        '<div class="num">' + fmtNum(posTotal) + '</div>' +
        '<div class="label"><strong>' + esc(pos.name) + '</strong> ' + posBadge + '</div>' +
        '<div class="label">' + fmtNum(list.length) + ' candidate' + (list.length === 1 ? '' : 's') + ' · ' + standing + '</div>' +
        '<div class="live-bars" style="margin-top:12px;text-align:left;">' + rows + '</div>' +
        '</div>'
      );
    }).join('');

    html += '<div class="stat-grid">' + cards + '</div>';

    $body.innerHTML = html;
  }

  $select.addEventListener('change', async function () {
    const electionId = this.value;
    if (!electionId) { $body.innerHTML = '<div class="empty">Select an election above to view results.</div>'; return; }
    selectedElection = { id: electionId };
    try {
      await loadElection(electionId);
    } catch (err) {
      $body.innerHTML = '<div class="empty">Could not load results: ' + esc(friendlyError(err)) + '</div>';
    }
  });

  window.authPromise.then(async function () {
    // View-only staff can see results but cannot change visibility.
    // (Admin helper exists on admin pages only, never the portal.)
    if (window.hideForReadOnly) window.hideForReadOnly('#visibilityToggleWrap');
    // Student portal shows the same layout, but the visibility toggle
    // is strictly staff-only: voters must never see or flip it.
    if (window.__auth && window.__auth.role === 'voter') {
      const wrap = document.getElementById('visibilityToggleWrap');
      if (wrap) wrap.style.display = 'none';
      if ($hideToggle) $hideToggle.disabled = true;
    }
    await loadSelect();
    // Real-time: votes, candidates, or settings changes re-render at once.
    // The roster query is staff-only; voters cannot listen to it.
    const liveRefs = [DB.collection('elections'), DB.collection('positions'), DB.collection('candidates'), DB.collection('votes'), DB.collection('settings').doc('resultsVisibility')];
    if (!(window.__auth && window.__auth.role === 'voter')) {
      liveRefs.splice(4, 0, DB.collection('users').where('role', '==', 'voter'));
    }
    liveCollections(
      liveRefs,
      function () {
        if (selectedElection) return loadElection(selectedElection.id, true);
      },
      // Staff view also watches the whole voter roster: coalesce bursts.
      { minIntervalMs: 10000 }
    );
  }).catch(function (err) {
    toast('Could not load elections: ' + friendlyError(err), 'error');
  });
})();