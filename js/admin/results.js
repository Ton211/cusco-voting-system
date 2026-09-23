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

    if (settingsSnap && settingsSnap.exists) {
      const s = settingsSnap.data();
      $hideToggle.checked = s.hideUntilClose !== false;
    } else {
      $hideToggle.checked = true;
    }

    // Auto pick so results show at once: active election first,
    // else the single election when only one exists.
    const active = elections.find(function (e) { return e.status === 'active'; });
    const pick = active || (elections.length === 1 ? elections[0] : null);
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

  // ---------------------------------------------------------------
  // Loading results
  // ---------------------------------------------------------------
  async function loadElection(electionId, silent) {
    if (!silent) $body.innerHTML = '<div class="empty">Loading…</div>';

    const [electionSnap, positionsSnap, candidatesSnap, votesSnap, votersSnap] = await Promise.all([
      DB.collection('elections').doc(electionId).get(),
      DB.collection('positions').where('electionId', '==', electionId).get(),
      DB.collection('candidates').where('electionId', '==', electionId).get(),
      DB.collection('votes').doc(electionId).get().catch(function () { return null; }),
      DB.collection('users').where('role', '==', 'voter').get().catch(function () { return null; })
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
    const totalVoters = votersSnap ? votersSnap.size : 0;
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

    let html = summary;
    positions.forEach(function (pos) {
      const list = (candidatesByPosition[pos.id] || []).filter(function (c) { return c.status === 'active'; });

      let max = 1;
      list.forEach(function (c) {
        const n = (results[pos.id] && results[pos.id][c.id]) || 0;
        if (n > max) max = n;
      });

      const posTotal = list.reduce(function (sum, c) { return sum + (((results[pos.id] || {})[c.id]) || 0); }, 0);
      const rows = list.map(function (c) {
        const count = (results[pos.id] && results[pos.id][c.id]) || 0;
        const green = max ? Math.round((count / max) * 100) : 0;
        const red = posTotal ? Math.max(0, 100 - green) : 0;
        const photo = c.photo
          ? '<img class="avatar sm" src="' + esc(c.photo) + '" alt="" style="object-fit:cover; width:30px;height:30px;">'
          : '<span class="avatar sm">' + esc(initials(c.name)) + '</span>';
        let leadBadge = '';
        if (max > 1 && count === max) leadBadge = '<span class="badge active">Leading</span>';
        return (
          '<div class="result-row">' +
          '<div class="row-meta">' +
          '<span style="display:flex;gap:8px;align-items:center;">' + photo + ' <span><strong>' + esc(c.name) + '</strong> ' + leadBadge + '</span></span>' +
          '<span class="count">' + fmtNum(count) + '</span>' +
          '</div>' +
          '<div class="bar-track" style="display:flex;"><div style="height:100%; width:' + green + '%; background:#16a34a;"></div><div style="height:100%; width:' + red + '%; background:#dc2626;"></div></div>' +
          '</div>'
        );
      }).join('');

      html +=
        '<div class="card result-card">' +
        '<div class="card-title"><span>' + esc(pos.name) + '</span><span class="muted">' + fmtNum(list.length) + ' candidate(s)</span></div>' +
        (rows || '<p class="muted">No active candidates for this position.</p>') +
        '</div>';
    });

    html +=
      '<div class="card">' +
      '<div class="card-title"><span>Summary</span></div>' +
      '<p class="muted">Total votes recorded by the server: <strong>' + fmtNum(totalVotes) + '</strong></p>' +
      '<p class="muted mt-16" style="font-size:13px;">Ballots are stored as anonymised aggregates. Individual votes are never linked to voter identities.</p>' +
      '</div>';

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
    await loadSelect();
    autoLive(function () {
      if (selectedElection) return loadElection(selectedElection.id, true);
    });
  }).catch(function (err) {
    toast('Could not load elections: ' + friendlyError(err), 'error');
  });
})();