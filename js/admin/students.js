// =====================================================================
//  Admin: student list (whitelist for self registration)
// =====================================================================
(function () {
  function callable(name) {
    const fn = FB_FUNCTIONS.httpsCallable(name);
    return async function (payload) {
      const res = await fn(payload);
      return res.data;
    };
  }
  const importStudentsFn = callable('importStudents');
  const updateStudentFn = callable('updateStudent');
  const deleteStudentFn = callable('deleteStudent');

  let allStudents = [];
  const $body = document.getElementById('studentTableBody');
  const $empty = document.getElementById('studentEmpty');
  const $search = document.getElementById('studentSearchBox');

  function render(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    const rows = allStudents.filter(function (s) {
      if (!q) return true;
      return [s.admNumber, s.fullName].some(function (v) {
        return String(v || '').toLowerCase().includes(q);
      });
    });
    if ($empty) $empty.classList.toggle('hidden', rows.length > 0);
    if (!$body) return;
    const readOnly = window.isReadOnly();
    $body.innerHTML = rows
      .sort(function (a, b) { return String(a.admNumber || '').localeCompare(String(b.admNumber || '')); })
      .map(function (s) {
        const state = s.used ? '<span class="badge active">Registered</span>' : '<span class="badge pending">Not yet registered</span>';
        const actionCell = readOnly
          ? '<span class="muted">—</span>'
          : '<div class="row-actions">' +
            '<button class="btn btn-outline btn-sm" data-action="edit" data-adm="' + esc(s.admNumber || '') + '">Edit</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="del" data-adm="' + esc(s.admNumber || '') + '">Delete</button>' +
            '</div>';
        return '<tr><td><strong>' + esc(s.admNumber || '') + '</strong></td><td>' + esc(s.fullName || '') + '</td><td>' + state + '</td>' +
          '<td>' + actionCell + '</td></tr>';
      })
      .join('');
  }

  async function load() {
    try {
      const snap = await DB.collection('studentList').get();
      allStudents = snap.docs.map(function (doc) { return doc.data(); });
    } catch (e) { allStudents = []; }
    render($search ? $search.value : '');
  }

  function parseStudentLines(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      const t = String(line || '').trim();
      if (!t) return;
      const parts = t.split(/[,;\t]+/);
      if (parts.length < 2) return;
      const adm = String(parts[0] || '').trim();
      const name = parts.slice(1).join(' ').trim();
      if (adm && name) out.push({ admNumber: adm, fullName: name });
    });
    return out;
  }

  if ($search) $search.addEventListener('input', function () { render($search.value); });

  const $importText = document.getElementById('importText');
  const $importFile = document.getElementById('importFile');
  const $doImport = document.getElementById('doImportBtn');

  const openBtn = document.getElementById('openImportBtn');
  if (openBtn) {
    openBtn.addEventListener('click', function () {
      if ($importText) $importText.value = '';
      if ($importFile) $importFile.value = '';
      openModal('importModal');
    });
  }
  if ($importFile) {
    $importFile.addEventListener('change', function () {
      const f = $importFile.files && $importFile.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () { $importText.value = String(r.result || ''); };
      r.readAsText(f);
    });
  }
  if ($doImport) {
    $doImport.addEventListener('click', async function () {
      const rows = parseStudentLines($importText.value);
      if (!rows.length) { toast('Nothing to import. Paste lines like ADM001, Jane Doe.', 'error'); return; }
      $doImport.disabled = true;
      $doImport.textContent = 'Importing…';
      try {
        const res = await importStudentsFn({ students: rows });
        rows.forEach(function (r) {
          const norm = String(r.admNumber || '').trim().toUpperCase().replace(/\s+/g, '');
          allStudents = allStudents.filter(function (x) { return x.admNumber !== norm; });
          allStudents.unshift({ admNumber: norm, fullName: r.fullName, used: false });
        });
        render($search && $search.value);
        toast('Imported ' + res.total + ' students (' + res.created + ' new).', 'success');
        closeModal('importModal');
        await load();
      } catch (err) {
        toast(callFriendly(err).message, 'error');
      } finally {
        $doImport.disabled = false;
        $doImport.textContent = 'Import';
      }
    });
  }

  const openAdd = document.getElementById('openAddBtn');
  const addAdm = document.getElementById('addAdm');
  const addName = document.getElementById('addName');
  const doAdd = document.getElementById('doAddBtn');
  if (openAdd) {
    openAdd.addEventListener('click', function () {
      if (addAdm) addAdm.value = '';
      if (addName) addName.value = '';
      openModal('addModal');
    });
  }
  if (doAdd) {
    doAdd.addEventListener('click', async function () {
      const adm = String(addAdm.value || '').trim();
      const name = String(addName.value || '').trim();
      if (!adm || !name) { toast('Enter adm number plus full name.', 'error'); return; }
      doAdd.disabled = true;
      doAdd.textContent = 'Adding…';
      try {
        const res = await importStudentsFn({ students: [{ admNumber: adm, fullName: name }] });
        // Show at once: paint the row immediately, then reconcile with server.
        const norm = String(adm || '').trim().toUpperCase().replace(/\s+/g, '');
        allStudents = allStudents.filter(function (x) { return x.admNumber !== norm; });
        allStudents.unshift({ admNumber: norm, fullName: name, used: false });
        render($search && $search.value);
        toast('Student added (' + res.total + ' saved).', 'success');
        closeModal('addModal');
        await load();
      } catch (err) {
        try { console.error('addStudent failed', err); } catch (e) {}
        const info = callFriendly(err);
        toast(info.message + ' [' + (err.code || info.code || 'unknown') + ']', 'error');
      } finally {
        doAdd.disabled = false;
        doAdd.textContent = 'Add';
      }
    });
  }

  let editAdm = '';
  if ($body) {
    $body.addEventListener('click', async function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const adm = btn.dataset.adm || '';
      if (btn.dataset.action === 'edit') {
        const s = allStudents.find(function (x) { return x.admNumber === adm; });
        editAdm = adm;
        document.getElementById('editStudentFor').textContent = adm + ': ' + ((s && s.fullName) || '');
        document.getElementById('editStudentName').value = (s && s.fullName) || '';
        openModal('editStudentModal');
      } else if (btn.dataset.action === 'del') {
        const ok = await confirmDialog({ title: 'Delete student', message: 'Permanently delete ' + adm + ' from the system, including their voter login if they registered? Add them again later to let them return.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
          const res = await deleteStudentFn({ admNumber: adm });
          toast(res && res.removedVoter ? 'Student and voter login deleted.' : 'Student deleted.', 'success');
          await load();
        } catch (err) {
          toast(callFriendly(err).message, 'error');
        }
      }
    });
  }
  const doEdit = document.getElementById('doEditStudentBtn');
  if (doEdit) {
    doEdit.addEventListener('click', async function () {
      const name = String(document.getElementById('editStudentName').value || '').trim();
      if (!name) { toast('Enter the full name.', 'error'); return; }
      doEdit.disabled = true;
      try {
        await updateStudentFn({ admNumber: editAdm, fullName: name });
        toast('Changes saved.', 'success');
        closeModal('editStudentModal');
        await load();
      } catch (err) {
        toast(callFriendly(err).message, 'error');
      } finally {
        doEdit.disabled = false;
      }
    });
  }

  qsa('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });
  ['importModal', 'addModal', 'editStudentModal'].forEach(function (id) {
    const m = document.getElementById(id);
    if (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m) closeModal(id);
      });
    }
  });

  // ---------------------------------------------------------------
  // Voter registration window (admin schedules / opens / closes).
  // Students register on their dashboard only while it is open; the
  // window auto-flips at its boundaries via resolveElectionState +
  // the 1-minute scheduler, and the countdown below ticks each second.
  // ---------------------------------------------------------------
  const setRegFn = callable('setVoterRegistration');
  const $regBadge = document.getElementById('regStatusBadge');
  const $regText = document.getElementById('regWindowText');
  const $regCountWrap = document.getElementById('regCountdownWrap');
  const $regClock = document.getElementById('regCountdown');
  const $regClockLabel = document.getElementById('regCountdownLabel');
  const $regStart = document.getElementById('regStart');
  const $regEnd = document.getElementById('regEnd');
  let regTarget = 0; // ms epoch the countdown runs toward (0 = none)
  let regZeroFiredAt = 0;

  function toLocalInput(ts) {
    const d = tsToDate(ts);
    if (!d || isNaN(d.getTime())) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderRegWindow(reg) {
    const status = reg ? String(reg.status || 'closed') : 'closed';
    const startMs = reg && reg.startTime ? tsToDate(reg.startTime).getTime() || 0 : 0;
    const endMs = reg && reg.endTime ? tsToDate(reg.endTime).getTime() || 0 : 0;
    if ($regBadge) {
      if (status === 'open') $regBadge.innerHTML = '<span class="badge active-running">Open</span>';
      else if (status === 'scheduled') $regBadge.innerHTML = '<span class="badge scheduled">Scheduled</span>';
      else $regBadge.innerHTML = '<span class="badge closed">Closed</span>';
    }
    if ($regStart && startMs) $regStart.value = toLocalInput(reg.startTime);
    if ($regEnd && endMs) $regEnd.value = toLocalInput(reg.endTime);
    if (status === 'open') {
      if ($regText) $regText.textContent = endMs
        ? 'Registration is OPEN. Students can register as voters until ' + fmtDateTime(reg.endTime) + '.'
        : 'Registration is OPEN. Students can register as voters.';
      regTarget = endMs || 0;
      if ($regClockLabel) $regClockLabel.textContent = endMs ? 'Registration closes in' : '';
    } else if (status === 'scheduled') {
      if ($regText) $regText.textContent = 'Registration opens ' + (startMs ? fmtDateTime(reg.startTime) : 'soon') +
        (endMs ? ' and closes ' + fmtDateTime(reg.endTime) + '.' : '.');
      regTarget = startMs || 0;
      if ($regClockLabel) $regClockLabel.textContent = startMs ? 'Registration opens in' : '';
    } else {
      if ($regText) $regText.textContent = 'Registration is CLOSED. Students cannot register as voters until you open it.';
      regTarget = 0;
    }
    if ($regCountWrap) $regCountWrap.classList.toggle('hidden', !regTarget);
    tickRegClock();
  }

  function tickRegClock() {
    if (!$regClock || !regTarget) return;
    const diff = regTarget - Date.now();
    if (diff > 0) {
      $regClock.textContent = fmtCountdownMs(diff);
      $regClock.classList.toggle('countdown-urgent', diff < 5 * 60 * 1000);
    } else {
      $regClock.textContent = '00:00:00';
      if (Date.now() - regZeroFiredAt > 10000) {
        regZeroFiredAt = Date.now();
        // Boundary just passed: flip the window now, then re-read.
        const resolver = FB_FUNCTIONS.httpsCallable('resolveElectionState');
        withTimeout(resolver({}), 15000, 'Registration clock')
          .then(function () { return loadRegWindow(); })
          .catch(function () { return loadRegWindow(); });
      }
    }
  }
  setInterval(tickRegClock, 1000);

  async function loadRegWindow() {
    try {
      // Nudge the clock first so a due open/close applies instantly.
      try {
        const resolver = FB_FUNCTIONS.httpsCallable('resolveElectionState');
        const res = await withTimeout(resolver({}), 15000, 'Registration clock');
        if (res && res.data && res.data.registration) {
          const r = res.data.registration;
          renderRegWindow({ status: r.status, startTime: r.startMs ? new Date(r.startMs) : null, endTime: r.endMs ? new Date(r.endMs) : null });
          return;
        }
      } catch (e) {}
      const snap = await DB.collection('settings').doc('voterRegistration').get();
      renderRegWindow(snap.exists ? snap.data() : null);
    } catch (e) {
      if ($regText) $regText.textContent = 'Could not load registration status.';
    }
  }

  function isoOrNull(input) {
    const v = String((input && input.value) || '').trim();
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const $regOpenBtn = document.getElementById('regOpenBtn');
  const $regScheduleBtn = document.getElementById('regScheduleBtn');
  const $regCloseBtn = document.getElementById('regCloseBtn');
  if ($regOpenBtn) $regOpenBtn.addEventListener('click', async function () {
    $regOpenBtn.disabled = true;
    try {
      const payload = { action: 'open' };
      const endIso = isoOrNull($regEnd);
      if (endIso) payload.endTimeISO = endIso;
      await setRegFn(payload);
      toast('Voter registration is now open.', 'success');
      await loadRegWindow();
    } catch (err) { const e = callFriendly(err); toast(e.message + ' [' + e.code + ']', 'error'); }
    finally { $regOpenBtn.disabled = false; }
  });
  if ($regScheduleBtn) $regScheduleBtn.addEventListener('click', async function () {
    const startIso = isoOrNull($regStart);
    const endIso = isoOrNull($regEnd);
    if (!startIso || !endIso) { toast('Pick both an opening and a closing time.', 'error'); return; }
    $regScheduleBtn.disabled = true;
    try {
      await setRegFn({ action: 'schedule', startTimeISO: startIso, endTimeISO: endIso });
      toast('Registration schedule saved.', 'success');
      await loadRegWindow();
    } catch (err) { const e = callFriendly(err); toast(e.message + ' [' + e.code + ']', 'error'); }
    finally { $regScheduleBtn.disabled = false; }
  });
  if ($regCloseBtn) $regCloseBtn.addEventListener('click', async function () {
    const ok = await confirmDialog({ title: 'Close registration', message: 'Close voter registration now? Students will no longer be able to register as voters.', confirmText: 'Close', danger: true });
    if (!ok) return;
    $regCloseBtn.disabled = true;
    try {
      await setRegFn({ action: 'close' });
      toast('Voter registration is now closed.', 'success');
      await loadRegWindow();
    } catch (err) { const e = callFriendly(err); toast(e.message + ' [' + e.code + ']', 'error'); }
    finally { $regCloseBtn.disabled = false; }
  });

  window.authPromise.then(function () {
    // Read-only staff can see the list but cannot add, import or edit.
    window.hideForReadOnly('#openAddBtn');
    window.hideForReadOnly('#openImportBtn');
    loadRegWindow();
    return load().then(function () { liveCollections([DB.collection('studentList'), DB.collection('settings').doc('voterRegistration')], function () { load(); loadRegWindow(); }, { minIntervalMs: 15000 }); });
  }).catch(function (err) {
    toast('Could not load students: ' + friendlyError(err), 'error');
  });
})();
