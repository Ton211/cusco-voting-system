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
    $body.innerHTML = rows
      .sort(function (a, b) { return String(a.admNumber || '').localeCompare(String(b.admNumber || '')); })
      .map(function (s) {
        const state = s.used ? '<span class="badge active">Registered</span>' : '<span class="badge pending">Not yet registered</span>';
        return '<tr><td><strong>' + esc(s.admNumber || '') + '</strong></td><td>' + esc(s.fullName || '') + '</td><td>' + state + '</td>' +
          '<td><div class="row-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="edit" data-adm="' + esc(s.admNumber || '') + '">Edit</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="del" data-adm="' + esc(s.admNumber || '') + '">Delete</button>' +
          '</div></td></tr>';
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
        const ok = await confirmDialog({ title: 'Delete student', message: 'Delete ' + adm + ' from the student list?', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
          await deleteStudentFn({ admNumber: adm });
          toast('Student deleted.', 'success');
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

  window.authPromise.then(function () {
    return load().then(function () { autoLive(load); });
  }).catch(function (err) {
    toast('Could not load students: ' + friendlyError(err), 'error');
  });
})();
