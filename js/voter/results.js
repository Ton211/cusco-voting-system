// =====================================================================
//  Voter: election results (same look as the admin Results page)
//  Election selector + position cards with winner/leading badges and
//  inline candidate bars. Tallies are aggregate only — ballots stay
//  anonymous. Refreshes in real time as votes come in.
// =====================================================================
(function () {
  const $select = document.getElementById('resultsElection');
  const $body = document.getElementById('resultsBody');

  let selectedElection = null;

  async function loadSelect() {
    const eSnap = await DB.collection('elections').get();
    const elections = eSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, name: x.name, status: x.status };
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    $select.innerHTML =
      '<option value="">Select an election…</option>' +
      elections.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');

    // Auto pick so results show at once: the election from ?election=
    // first, then the active election, else the single election when
    // only one exists.
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

  async function loadElection(electionId, silent) {
    if (!silent) $body.innerHTML = '<div class="empty">Loading…</div>';

    const [electionSnap, positionsSnap, candidatesSnap, votesSnap] = await Promise.all([
      DB.collection('elections').doc(electionId).get(),
      DB.collection('positions').where('electionId', '==', electionId).get(),
      DB.collection('candidates').where('electionId', '==', electionId).get(),
      DB.collection('votes').doc(electionId).get().catch(function () { return null; })
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
      candidatesByPosition[x.positionId].push({ id: d.id, name: x.name, photo: x.photo || null, status: x.status });
    });

    const votes = votesSnap && votesSnap.exists ? (votesSnap.data() || {}) : {};
    const results = votes.results || {};
    const totalVotes = votes.totalVotes || 0;

    const summary =
      '<div class="stat-grid mb-12">' +
      '<div class="stat"><div class="num green">' + fmtNum(totalVotes) + '</div><div class="label">Votes Cast</div></div>' +
      '<div class="stat"><div class="num">' + fmtNum(positions.length) + '</div><div class="label">Positions</div></div>' +
      '</div>';

    if (!positions.length) {
      $body.innerHTML = summary + '<div class="empty">No positions defined for this election.</div>';
      return;
    }

    // Position cards in the same style as the admin side: vote total on
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
            id: c.id, name: c.name, photo: c.photo,
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
    await loadSelect();
    // Real-time: votes or candidate changes re-render at once.
    liveCollections(
      [DB.collection('elections'), DB.collection('positions'), DB.collection('candidates'), DB.collection('votes')],
      function () {
        if (selectedElection) return loadElection(selectedElection.id, true);
      }
    );
  }).catch(function (err) {
    toast('Could not load elections: ' + friendlyError(err), 'error');
  });
})();
