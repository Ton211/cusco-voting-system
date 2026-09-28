// =====================================================================
//  Admin: settings (overview, own password, staff aliases, system reset)
// =====================================================================
(function () {
  function callable(name) {
    const fn = FB_FUNCTIONS.httpsCallable(name);
    return async function (payload) {
      const res = await fn(payload);
      return res.data;
    };
  }
  const changePwFn = callable('changeOwnPassword');
  const aliasFn = callable('setStaffAlias');
  const resetFn = callable('resetSystem');

  // ---------------------------------------------------------------
  // Overview counts + wipe summary
  // ---------------------------------------------------------------
  async function loadCounts() {
    const [eSnap, pSnap, cSnap, vSnap, sSnap, uSnap] = await Promise.all([
      DB.collection('elections').get(),
      DB.collection('positions').get(),
      DB.collection('candidates').get(),
      DB.collection('votes').get(),
      DB.collection('studentList').get(),
      DB.collection('users').where('role', '==', 'voter').get()
    ]);
    document.getElementById('stElections').textContent = fmtNum(eSnap.size);
    document.getElementById('stPositions').textContent = fmtNum(pSnap.size);
    document.getElementById('stCandidates').textContent = fmtNum(cSnap.size);
    document.getElementById('stVotes').textContent = fmtNum(vSnap.size);
    document.getElementById('stStudents').textContent = fmtNum(sSnap.size);
    document.getElementById('stVoters').textContent = fmtNum(uSnap.size);
    document.getElementById('wipeSummary').textContent =
      'Would wipe right now: ' + fmtNum(eSnap.size) + ' elections, ' +
      fmtNum(pSnap.size) + ' positions, ' + fmtNum(cSnap.size) + ' candidates, ' +
      fmtNum(vSnap.size) + ' vote tallies, ' + fmtNum(sSnap.size) + ' students, ' +
      fmtNum(uSnap.size) + ' voters.';
  }

  async function loadAliases() {
    const $tbody = document.getElementById('aliasListBody');
    const $empty = document.getElementById('aliasEmpty');
    const snap = await DB.collection('settings').doc('staffAlias').collection('aliases').get();
    const rows = snap.docs.map(function (d) {
      const x = d.data() || {};
      return { username: x.username || d.id, email: x.email || '' };
    }).sort(function (a, b) { return a.username.localeCompare(b.username); });
    $empty.classList.toggle('hidden', rows.length > 0);
    $tbody.innerHTML = rows.map(function (r) {
      return '<tr><td><strong>' + esc(r.username) + '</strong></td><td>' + esc(r.email) + '</td></tr>';
    }).join('');
  }

  function refresh() {
    return loadCounts().then(function () {
      if (window.__auth && window.__auth.role === 'superadmin') return loadAliases().catch(function () {});
    });
  }

  // ---------------------------------------------------------------
  // Change own password (every staff role)
  // ---------------------------------------------------------------
  document.getElementById('pwForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const pw = document.getElementById('pwNew').value;
    const pw2 = document.getElementById('pwConfirm').value;
    if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }
    if (pw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    const btn = document.getElementById('pwBtn');
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await changePwFn({ newPassword: pw });
      toast('Password updated.', 'success');
      e.target.reset();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  });

  // ---------------------------------------------------------------
  // Staff username alias (superadmin only)
  // ---------------------------------------------------------------
  document.getElementById('aliasForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('aliasUsername').value.trim();
    const email = document.getElementById('aliasEmail').value.trim();
    if (!username || !email) { toast('Enter a username and an email.', 'error'); return; }
    const btn = document.getElementById('aliasBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await aliasFn({ username: username, email: email });
      toast('Alias saved.', 'success');
      e.target.reset();
      await loadAliases();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Alias';
    }
  });

  // ---------------------------------------------------------------
  // System reset (superadmin only, double-confirmed)
  // ---------------------------------------------------------------
  document.getElementById('resetBtn').addEventListener('click', async function () {
    const first = await confirmDialog({
      title: 'Reset entire system',
      message: 'Permanently delete ALL elections, positions, candidates, votes, students and voter accounts? Staff accounts stay. This cannot be undone.',
      confirmText: 'Continue',
      danger: true
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Final confirmation',
      message: 'Last chance: wipe the whole system and start new?',
      confirmText: 'Wipe everything',
      danger: true
    });
    if (!second) return;
    const btn = document.getElementById('resetBtn');
    btn.disabled = true;
    btn.textContent = 'Wiping…';
    try {
      const res = await resetFn({ confirm: 'RESET' });
      const n = (res && res.counts) || {};
      toast('System reset: ' + (n.voters || 0) + ' voters, ' + (n.elections || 0) +
        ' elections, ' + (n.candidates || 0) + ' candidates, ' +
        (n.students || 0) + ' students removed.', 'success');
      await refresh();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reset Entire System';
    }
  });

  // ---------------------------------------------------------------
  // Wiring: superadmin-only cards stay hidden for plain admins
  // ---------------------------------------------------------------
  window.authPromise.then(function (a) {
    if (!a.user || !a.role) return;
    if (a.role !== 'superadmin') {
      document.getElementById('aliasCard').style.display = 'none';
      document.getElementById('dangerZone').style.display = 'none';
    }
    return refresh().catch(function (err) {
      toast('Could not load settings: ' + friendlyError(err), 'error');
    });
  });
})();
