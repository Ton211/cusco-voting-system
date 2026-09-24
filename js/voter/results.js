// =====================================================================
//  Voter: released results (visible only after the admin releases them)
// =====================================================================
(function () {
  const $body = document.getElementById('resultsBody');

  async function load() {
    try {
      const visSnap = await DB.collection('settings').doc('resultsVisibility').get();
      const vis = visSnap.exists ? visSnap.data() : {};
      if (vis.hideUntilClose !== false) {
        $body.innerHTML = '<div class="alert alert-info center">Results are hidden until the election closes. Check back after voting ends.</div>';
        return;
      }
      const [eleSnap, posSnap, candSnap, voteSnap] = await Promise.all([
        DB.collection('elections').get(),
        DB.collection('positions').get(),
        DB.collection('candidates').get(),
        DB.collection('votes').get()
      ]);
      const elections = eleSnap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      const positions = {};
      posSnap.docs.forEach(function (d) {
        const p = d.data();
        if (!positions[p.electionId]) positions[p.electionId] = [];
        positions[p.electionId].push(Object.assign({ id: d.id }, p));
      });
      Object.keys(positions).forEach(function (k) {
        positions[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      });
      const candNames = {};
      candSnap.docs.forEach(function (d) { candNames[d.id] = d.data().name || d.id; });
      const votes = {};
      voteSnap.docs.forEach(function (d) { votes[d.id] = d.data(); });

      const shown = elections.filter(function (e) { return votes[e.id]; });
      if (!shown.length) {
        $body.innerHTML = '<div class="alert alert-info center">No released results yet.</div>';
        return;
      }
      $body.innerHTML = shown.map(function (e) {
        const v = votes[e.id] || {};
        const total = v.totalVotes || 0;
        const blocks = (positions[e.id] || []).map(function (p) {
          const tally = ((v.results || {})[p.id]) || {};
          const ids = Object.keys(tally);
          if (!ids.length) return '<p class="muted" style="font-size:13px; margin-top:10px;">Position: <strong>' + esc(p.name) + '</strong> has no votes yet.</p>';
          const max = Math.max.apply(null, ids.map(function (c) { return tally[c] || 0; }).concat([0]));
          const rows = ids
            .sort(function (a, b) { return (tally[b] || 0) - (tally[a] || 0); })
            .map(function (c) {
              const n = tally[c] || 0;
              const pct = max ? Math.round((n / max) * 100) : 0;
              const share = total ? Math.round((n / total) * 100) : 0;
              return '<div style="margin-bottom:8px;"><div class="review-row" style="border:0; padding:4px 0;"><span class="sel">Candidate: <strong>' + esc(candNames[c] || c) + '</strong></span><strong>' + n + ' votes (' + share + '%)</strong></div>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>';
            }).join('');
          return '<h3 style="font-size:15px; margin:14px 0 8px;">Position: ' + esc(p.name) + '</h3>' + rows;
        }).join('');
        return '<div class="card" style="margin-bottom:14px;"><div class="card-title"><span>' + esc(e.name) + '</span><span class="badge active">Total votes: ' + total + '</span></div>' +
          '<p class="muted" style="font-size:13px; margin-bottom:6px;">Total votes cast in this election: <strong>' + total + '</strong></p>' + blocks + '</div>';
      }).join('');
    } catch (err) {
      $body.innerHTML = '<p class="muted center">Could not load results: ' + esc(friendlyError(err)) + '</p>';
    }
  }

  window.authPromise.then(function () {
    return load().then(function () {
      // Real-time: released votes or visibility changes appear at once.
      liveCollections(
        [DB.collection('settings').doc('resultsVisibility'), DB.collection('elections'), DB.collection('positions'), DB.collection('candidates'), DB.collection('votes')],
        load
      );
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load results: ' + esc(friendlyError(err)) + '</p>';
  });
})();
