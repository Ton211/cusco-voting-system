// =====================================================================
//  Voter dashboard: voter-registration card + elections overview.
//  First-time students land here right after setting their password;
//  if they have not registered as a voter yet and the admin's
//  registration window is open, the card offers one-tap registration
//  with a live closing countdown.
// =====================================================================
(function () {
  const $body = document.getElementById('dashboardBody');

  // Registration countdown target (ms epoch, 0 = none) + ticking clock.
  // One interval for the page; each render re-creates the element with
  // the same id, so the tick keeps working across live refreshes.
  let regTarget = 0;
  let regZeroFiredAt = 0;
  setInterval(function () {
    const el = document.getElementById('voterRegClock');
    if (!el || !regTarget) return;
    const diff = regTarget - Date.now();
    if (diff > 0) {
      el.textContent = fmtCountdownMs(diff);
      el.classList.toggle('countdown-urgent', diff < 5 * 60 * 1000);
    } else if (Date.now() - regZeroFiredAt > 10000) {
      regZeroFiredAt = Date.now();
      el.textContent = '00:00:00';
      // Window just ended: flip it now, then re-render the card.
      const resolver = FB_FUNCTIONS.httpsCallable('resolveElectionState');
      withTimeout(resolver({}), 15000, 'Registration clock')
        .then(function () { return load().catch(function () {}); })
        .catch(function () { return load().catch(function () {}); });
    }
  }, 1000);

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

  // Voter-registration card HTML for this profile + window state.
  // Missing voterRegistered (accounts predating the field) counts as
  // registered, so nobody already in the system gets stuck.
  function regCard(profile, reg) {
    const registered = profile.voterRegistered !== false;
    if (registered) {
      regTarget = 0;
      return '<div class="card center mb-12"><span class="badge active" style="font-size:14px;">&#10003; Registered as a voter</span></div>';
    }
    const status = reg ? String(reg.status || 'closed') : 'closed';
    const startMs = reg && reg.startTime ? tsToDate(reg.startTime).getTime() || 0 : 0;
    const endMs = reg && reg.endTime ? tsToDate(reg.endTime).getTime() || 0 : 0;
    if (status === 'open') {
      regTarget = endMs || 0;
      return '<div class="card center mb-12">' +
        '<div><span class="badge active-running">Voter registration open</span></div>' +
        (endMs
          ? '<div id="voterRegClock" class="countdown" style="font-size:32px;">--:--:--</div>' +
            '<p class="muted text-sm">Registration closes in · Closes <strong>' + esc(fmtDateTime(reg.endTime)) + '</strong></p>'
          : '<p class="muted text-sm mt-16">Registration is open. Complete it now.</p>') +
        '<div class="center mt-16"><button class="btn btn-primary" id="voterRegBtn" type="button">Register as a Voter</button></div>' +
        '</div>';
    }
    regTarget = 0;
    if (status === 'scheduled' && startMs) {
      return '<div class="card center mb-12"><span class="badge scheduled">Voter registration opens ' + esc(fmtDateTime(reg.startTime)) + '</span><p class="muted text-sm mt-16">You can log in as usual, but you cannot register as a voter or vote until registration opens.</p></div>';
    }
    return '<div class="card center mb-12"><span class="badge closed">Voter registration is currently closed</span><p class="muted text-sm mt-16">You can still log in, but you cannot register as a voter or vote until registration opens.</p></div>';
  }

  async function load() {
    // Silent 2s tick guard: skip if a previous load is still running.
    if (load._busy) return;
    load._busy = true;
    try {
    const a = window.__auth;
    if (!a.user) return;

    const [userSnap, electionsSnap, regSnap] = await Promise.all([
      DB.collection('users').doc(a.user.uid).get(),
      DB.collection('elections').get(),
      DB.collection('settings').doc('voterRegistration').get().catch(function () { return null; })
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

    const votedIn = profile.votedIn || {};
    // Voting requires voter registration: accounts with
    // voterRegistered === false can log in and see elections but get no
    // Vote buttons until they register (window open) or an admin
    // registers them. Missing field (legacy) counts as registered.
    const isRegistered = profile.voterRegistered !== false;
    const openUnvoted = isRegistered && elections.some(function (e) {
      return e.status === 'active' && isElectionOpen(e) && votedIn[e.id] !== true;
    });

    let html = regCard(profile, regSnap && regSnap.exists ? regSnap.data() : null) +
      '<div class="card-title">' +
      '<span>Elections</span>' +
      (openUnvoted ? '<a class="btn btn-outline btn-sm" href="/voter/vote.html">Vote Now</a>' : '') +
      '</div>' +
      '<div id="electionsList">';

    if (!elections.length) {
      html += '<div class="empty">No elections yet. Please check back later.</div>';
    } else {
      html += elections.map(function (e) {
        const voted = votedIn[e.id] === true;
        const votable = e.status === 'active' && isElectionOpen(e) && !voted;
        let actions = '';
        if (votable && isRegistered) {
          actions = '<a class="btn btn-primary btn-sm" href="/voter/vote.html">Vote</a>';
        } else if (votable && !isRegistered) {
          actions = '<span class="badge pending">Register as a voter to vote</span>';
        } else if (voted) {
          actions = '<span class="badge active">Voted</span>';
        }
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
          '</div>'
        );
      }).join('');
    }

    html += '</div>';
    $body.innerHTML = html;
    } finally {
      load._busy = false;
    }
  }

  // One-tap voter registration (button is re-created on every render,
  // so delegate from the page body).
  let regBusy = false;
  $body.addEventListener('click', async function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('#voterRegBtn') : null;
    if (!btn || regBusy) return;
    regBusy = true;
    btn.disabled = true;
    btn.textContent = 'Registering…';
    try {
      const fn = FB_FUNCTIONS.httpsCallable('registerAsVoter');
      await withTimeout(fn({}), 25000, 'Registration');
      toast('You are now registered as a voter.', 'success');
      await load();
    } catch (err) {
      toast(friendlyError(err), 'error');
      btn.disabled = false;
      btn.textContent = 'Register as a Voter';
    } finally {
      regBusy = false;
    }
  });

  // Clean any in-progress ballot when returning to the dashboard.
  window.authPromise.then(function () {
    try { sessionStorage.removeItem('cusco_ballot'); } catch (e) {}
    return load().then(function () {
      // Real-time: elections, registration window, or own voter record.
      const uid = window.__auth && window.__auth.user ? window.__auth.user.uid : null;
      const refs = [DB.collection('elections'), DB.collection('settings').doc('voterRegistration')];
      if (uid) {
        refs.push(DB.collection('users').doc(uid));
        refs.push(DB.collection('users').doc(uid).collection('receipts'));
      }
      liveCollections(refs, load, { minIntervalMs: 2000 });
      // Silent 2s safety-net poll so election state stays correct without refresh.
      if (typeof autoLive === 'function') autoLive(load, 2000);
    });
  }).catch(function (err) {
    $body.innerHTML = '<p class="muted center">Could not load elections: ' + esc(friendlyError(err)) + '</p>';
  });
})();
