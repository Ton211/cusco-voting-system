// =====================================================================
//  Admin: election report bridging Users <-> Results
//
//  Necessities covered in one printable / exportable report:
//    1. Electorate        (registered / active / inactive voters)
//    2. Turnout           (votes cast, turnout %, abstention)
//    3. Winners by position (each position and its winner)
//    4. Per-position outcome (candidates ranked, votes, %, winner/tie)
//
//  Counting rule (same as dashboard): one voter == one vote. A voter
//  flagged votedIn[electionId] counts once, no matter how many
//  positions are on the ballot.
// =====================================================================
(function () {
  const $select = document.getElementById('reportElection');
  const $body = document.getElementById('reportBody');
  const $meta = document.getElementById('reportMeta');

  let cache = null; // last built report, reused by CSV export
  let selectedId = null;

  // ---------------------------------------------------------------
  // Election selector
  // ---------------------------------------------------------------
  async function loadSelect() {
    const snap = await DB.collection('elections').get();
    const elections = snap.docs.map(function (d) {
      const x = d.data() || {};
      return { id: d.id, name: x.name || 'Unnamed election', status: x.status || 'draft' };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    $select.innerHTML =
      '<option value="">Select an election…</option>' +
      elections.map(function (e) {
        return '<option value="' + esc(e.id) + '">' + esc(e.name) + ' (' + esc(e.status) + ')</option>';
      }).join('');

    const params = new URLSearchParams(window.location.search || '');
    const requested = params.get('election');
    const active = elections.find(function (e) { return e.status === 'active'; });
    const pick = (requested && elections.find(function (e) { return e.id === requested; })) ||
      active || (elections.length === 1 ? elections[0] : null);
    if (pick) {
      $select.value = pick.id;
      await buildReport(pick.id);
    }
  }

  // ---------------------------------------------------------------
  // Build the full report for one election
  // ---------------------------------------------------------------
  async function buildReport(electionId, silent) {
    selectedId = electionId;
    if (!silent) $body.innerHTML = '<div class="empty">Loading report…</div>';

    const [electionSnap, positionsSnap, candidatesSnap, votesSnap, usersSnap] = await Promise.all([
      DB.collection('elections').doc(electionId).get(),
      DB.collection('positions').where('electionId', '==', electionId).get(),
      DB.collection('candidates').where('electionId', '==', electionId).get(),
      DB.collection('votes').doc(electionId).get().catch(function () { return null; }),
      DB.collection('users').where('role', '==', 'voter').get()
    ]);

    if (!electionSnap.exists) {
      $body.innerHTML = '<div class="empty">Election not found.</div>';
      cache = null;
      return;
    }

    const election = Object.assign({ id: electionId }, electionSnap.data() || {});

    const positions = positionsSnap.docs.map(function (d) {
      const x = d.data() || {};
      return { id: d.id, name: x.name || 'Unnamed position', order: x.order || 0 };
    }).sort(function (a, b) { return a.order - b.order; });

    const candidatesByPos = {};
    candidatesSnap.docs.forEach(function (d) {
      const x = d.data() || {};
      if (!candidatesByPos[x.positionId]) candidatesByPos[x.positionId] = [];
      candidatesByPos[x.positionId].push({
        id: d.id, name: x.name || 'Unnamed', status: x.status || 'active'
      });
    });

    const votes = (votesSnap && votesSnap.exists) ? (votesSnap.data() || {}) : {};
    const results = votes.results || {};
    const serverTotal = votes.totalVotes || 0;

    // ---- electorate + turnout (from users.votedIn, distinct voters) ----
    const voters = usersSnap.docs.map(function (d) {
      const u = d.data() || {};
      return {
        uid: d.id,
        fullName: u.fullName || 'Unnamed',
        admNumber: u.admNumber || u.voterId || 'Not set',
        gender: u.gender || 'Not set',
        status: u.status || 'active',
        voted: !!(u.votedIn && u.votedIn[electionId] === true)
      };
    }).sort(function (a, b) {
      return String(a.fullName).localeCompare(String(b.fullName));
    });

    const registered = voters.length;
    const activeVoters = voters.filter(function (v) { return v.status === 'active'; }).length;
    const inactiveVoters = registered - activeVoters;
    const votedCount = voters.filter(function (v) { return v.voted; }).length;
    const abstained = Math.max(0, registered - votedCount);
    const turnoutAll = registered ? Math.round((votedCount / registered) * 100) : 0;
    const turnoutActive = activeVoters ? Math.min(100, Math.round((votedCount / activeVoters) * 100)) : 0;

    // ---- per-position outcomes ----
    const outcomes = positions.map(function (pos) {
      const list = (candidatesByPos[pos.id] || [])
        .filter(function (c) { return c.status === 'active'; })
        .map(function (c) {
          return { id: c.id, name: c.name, count: ((results[pos.id] || {})[c.id]) || 0 };
        })
        .sort(function (a, b) { return b.count - a.count; });
      const posTotal = list.reduce(function (s, c) { return s + c.count; }, 0);
      const top = list.length && list[0].count > 0 ? list[0].count : 0;
      const leaders = top ? list.filter(function (c) { return c.count === top; }) : [];
      return { position: pos, list: list, total: posTotal, top: top, leaders: leaders };
    });

    cache = {
      election: election, positions: positions, outcomes: outcomes,
      voters: voters, registered: registered, activeVoters: activeVoters,
      inactiveVoters: inactiveVoters, votedCount: votedCount,
      abstained: abstained, turnoutAll: turnoutAll,
      turnoutActive: turnoutActive, serverTotal: serverTotal
    };

    if ($meta) {
      $meta.textContent = '';
      $meta.style.display = 'none';
    }
    var $printName = document.getElementById('printElectionName');
    var $printPeriod = document.getElementById('printElectionPeriod');
    if ($printName) $printName.textContent = election.name || electionId;
    if ($printPeriod) $printPeriod.textContent = fmtDateTime(election.startTime) + ' \u2192 ' + fmtDateTime(election.endTime);
    render();
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  function render() {
    if (!cache) return;
    const c = cache;
    const e = c.election;
    const isClosed = e.status === 'closed';

    const summary =
      '<div class="stat-grid mb-12">' +
      '<div class="stat"><div class="num">' + fmtNum(c.registered) + '</div><div class="label">Registered Voters</div></div>' +
      '<div class="stat"><div class="num">' + fmtNum(c.activeVoters) + '</div><div class="label">Active Voters</div></div>' +
      '<div class="stat"><div class="num green">' + fmtNum(c.votedCount) + '</div><div class="label">Votes Cast</div></div>' +
      '<div class="stat"><div class="num amber">' + c.turnoutAll + '%</div><div class="label">Turnout (of registered)</div></div>' +
      '<div class="stat"><div class="num">' + fmtNum(c.abstained) + '</div><div class="label">Did Not Vote</div></div>' +
      '<div class="stat"><div class="num">' + fmtNum(c.inactiveVoters) + '</div><div class="label">Inactive Accounts</div></div>' +
      '</div>';

    let outcomeHtml;
    if (!c.positions.length) {
      outcomeHtml = '<div class="card"><div class="card-title"><span>Results by position</span></div><div class="empty">No positions defined for this election.</div></div>';
    } else {
      // Dedicated winners summary: one row per position with its winner.
      const winnersRows = c.outcomes.map(function (o) {
        if (!o.list.length) {
          return '<tr><td><strong>' + esc(o.position.name) + '</strong></td>' +
            '<td class="muted">No candidates</td><td>—</td><td>—</td>' +
            '<td><span class="badge draft">No contest</span></td></tr>';
        }
        if (!o.top) {
          return '<tr><td><strong>' + esc(o.position.name) + '</strong></td>' +
            '<td class="muted">No votes yet</td><td>0</td><td>0%</td>' +
            '<td><span class="badge pending">Pending</span></td></tr>';
        }
        const tied = o.leaders.length > 1;
        const names = o.leaders.map(function (l) { return esc(l.name); }).join(', ');
        const pct = o.total ? Math.round((o.top / o.total) * 100) : 0;
        const badge = tied
          ? (isClosed ? '<span class="badge scheduled">Tie — joint winners</span>' : '<span class="badge scheduled">Tied lead</span>')
          : (isClosed ? '<span class="badge active">Winner</span>' : '<span class="badge active">Leading</span>');
        return '<tr><td><strong>' + esc(o.position.name) + '</strong></td>' +
          '<td><strong>' + names + '</strong></td>' +
          '<td>' + fmtNum(o.top) + '</td><td>' + pct + '%</td><td>' + badge + '</td></tr>';
      }).join('');

      const winnersHtml =
        '<div class="card"><div class="card-title"><span>Winners by position</span>' +
        '<span class="muted text-sm">Each position and its winner</span></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Position</th><th>Winner</th><th>Votes</th><th>Share</th><th>Status</th>' +
        '</tr></thead><tbody>' + winnersRows + '</tbody></table></div></div>';

      outcomeHtml = winnersHtml +
        '<div class="card"><div class="card-title"><span>Results by position</span><span class="muted text-sm">' +
        c.positions.length + ' position' + (c.positions.length === 1 ? '' : 's') + '</span></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Position</th><th>Candidate</th><th>Votes</th><th>Share</th><th>Outcome</th>' +
        '</tr></thead><tbody>' +
        c.outcomes.map(function (o) {
          if (!o.list.length) {
            return '<tr><td><strong>' + esc(o.position.name) + '</strong></td><td colspan="4" class="muted">No active candidates.</td></tr>';
          }
          return o.list.map(function (cand) {
            const pct = o.total ? Math.round((cand.count / o.total) * 100) : 0;
            const isLeader = o.top > 0 && cand.count === o.top;
            const tied = isLeader && o.leaders.length > 1;
            let tag = '';
            if (isLeader) {
              if (isClosed) tag = tied ? '<span class="badge scheduled">Tied winner</span>' : '<span class="badge active">Winner</span>';
              else tag = tied ? '<span class="badge scheduled">Tied lead</span>' : '<span class="badge active">Leading</span>';
            }
            return '<tr><td>' + esc(o.position.name) + '</td><td><strong>' +
              esc(cand.name) + '</strong></td><td>' + fmtNum(cand.count) +
              '</td><td>' + pct + '%</td><td>' + tag + '</td></tr>';
          }).join('');
        }).join('') +
        '</tbody></table></div></div>';
    }

    $body.innerHTML = summary + outcomeHtml;
  }

  // ---------------------------------------------------------------
  // CSV export helpers
  // ---------------------------------------------------------------
  function downloadCsv(filename, rows) {
    const csv = rows.map(function (r) {
      return r.map(function (cell) {
        const s = String(cell === null || cell === undefined ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function exportSummary() {
    if (!cache) { toast('Build a report first — select an election.', 'error'); return; }
    const c = cache;
    const e = c.election;
    const rows = [
      ['CUSCO Voting System — Election Report (Users <-> Results)'],
      [],
      ['Metric', 'Value'],
      ['Registered voters', c.registered],
      ['Active voters', c.activeVoters],
      ['Inactive accounts', c.inactiveVoters],
      ['Votes cast (distinct voters)', c.votedCount],
      ['Server total (votes doc)', c.serverTotal],
      ['Did not vote', c.abstained],
      ['Turnout (of registered %)', c.turnoutAll],
      ['Turnout (of active %)', c.turnoutActive],
      [],
      ['Position', 'Winner', 'Winner votes', 'Winner share %', 'Status'],
    ];
    c.outcomes.forEach(function (o) {
      if (!o.list.length) {
        rows.push([o.position.name, '(no candidates)', '', '', 'No contest']);
      } else if (!o.top) {
        rows.push([o.position.name, '(no votes yet)', 0, 0, 'Pending']);
      } else {
        const tied = o.leaders.length > 1;
        const names = o.leaders.map(function (l) { return l.name; }).join('; ');
        const pct = o.total ? Math.round((o.top / o.total) * 100) : 0;
        const status = tied ? 'Tie' : (e.status === 'closed' ? 'Winner' : 'Leading');
        rows.push([o.position.name, names, o.top, pct, status]);
      }
    });
    rows.push(
      [],
      ['Position', 'Candidate', 'Votes', 'Share %', 'Outcome']
    );
    c.outcomes.forEach(function (o) {
      if (!o.list.length) {
        rows.push([o.position.name, '(no active candidates)', 0, 0, '']);
        return;
      }
      o.list.forEach(function (cand) {
        const pct = o.total ? Math.round((cand.count / o.total) * 100) : 0;
        const isLeader = o.top > 0 && cand.count === o.top;
        const outcome = !isLeader ? '' : (o.leaders.length > 1 ? 'Tied' : (e.status === 'closed' ? 'Winner' : 'Leading'));
        rows.push([o.position.name, cand.name, cand.count, pct, outcome]);
      });
    });
    const slug = String(e.name || 'election').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'election';
    downloadCsv('report-summary-' + slug + '.csv', rows);
    toast('Summary CSV downloaded.', 'success');
  }

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  $select.addEventListener('change', async function () {
    if (!this.value) {
      cache = null; selectedId = null;
      $body.innerHTML = '<div class="empty">No report yet — pick an election.</div>';
      if ($meta) { $meta.textContent = 'Select an election above to build the report.'; $meta.style.display = ''; }
      var $pn = document.getElementById('printElectionName');
      var $pd = document.getElementById('printElectionPeriod');
      if ($pn) $pn.textContent = '—';
      if ($pd) $pd.textContent = '—';
      return;
    }
    try {
      await buildReport(this.value);
    } catch (err) {
      $body.innerHTML = '<div class="empty">Could not build report: ' + esc(friendlyError(err)) + '</div>';
    }
  });
  document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
  document.getElementById('csvSummaryBtn').addEventListener('click', exportSummary);

  window.authPromise.then(function () {
    return loadSelect().then(function () {
      liveCollections(
        [DB.collection('elections'), DB.collection('positions'), DB.collection('candidates'), DB.collection('votes'), DB.collection('users').where('role', '==', 'voter')],
        function () { if (selectedId) return buildReport(selectedId, true); }
      );
    });
  }).catch(function (err) {
    toast('Could not load elections: ' + friendlyError(err), 'error');
  });
})();
