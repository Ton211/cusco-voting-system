// =====================================================================
//  Admin: voter & admin management
// =====================================================================
(function () {
  let allUsers = [];

  function callable(name) {
    const fn = FB_FUNCTIONS.httpsCallable(name);
    return async function (payload) {
      const res = await fn(payload);
      return res.data;
    };
  }
  const registerUser = callable('registerUser');
  const updateUser = callable('updateUser');
  const resetPasswordFn = callable('resetPassword');
  const importStudentsFn = callable('importStudents');

  const $tbody = document.getElementById('votersTableBody');
  const $empty = document.getElementById('emptyState');
  const $search = document.getElementById('searchBox');
  const $count = document.getElementById('voterCount');
  // This page lists voters only: anyone whose users record carries
  // role voter, including students who self registered. Staff accounts
  // are managed under Users.
  let allStudents = [];
  const $studentBody = document.getElementById('studentTableBody');
  const $studentEmpty = document.getElementById('studentEmpty');
  const $studentSearch = document.getElementById('studentSearchBox');

  function roleBadge(role) {
    if (role === 'superadmin') return '<span class="badge superadmin">Super Admin</span>';
    if (role === 'admin') return '<span class="badge admin">Admin</span>';
    return '<span class="badge voter">Voter</span>';
  }

  function statusBadge(u) {
    const hasVoted = !!(u.votedIn && Object.keys(u.votedIn).length);
    let badge;
    if (hasVoted) badge = '<span class="badge voted">Voted</span>';
    else if (u.status === 'inactive') badge = '<span class="badge inactive">Inactive</span>';
    else badge = '<span class="badge active">Active</span>';
    if (u.role === 'voter' && u.selfRegistered === true) badge += ' <span class="badge admin">Self registered</span>';
    return badge;
  }

  function passwordBadge(u) {
    if (u.role !== 'voter') return '<span class="badge voter">Staff</span>';
    if (u.mustChangePassword === true) return '<span class="badge pending">First login pending</span>';
    return '<span class="badge active">Personal set</span>';
  }

  function render(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    const rows = allUsers.filter(function (u) {
      if (u.role !== 'voter') return false;
      if (!q) return true;
      return [u.voterId, u.admNumber, u.fullName, u.email].some(function (v) {
        return String(v || '').toLowerCase().includes(q);
      });
    });

    $empty.classList.toggle('hidden', rows.length > 0);
    if ($count) {
      $count.textContent = 'Showing ' + rows.length + ' registered voter' + (rows.length === 1 ? '' : 's') + '. List refreshes automatically.';
    }

    const readOnly = window.isReadOnly();
    $tbody.innerHTML = rows
      .sort(function (a, b) { return (a.createdAt ? b.createdAt.seconds - a.createdAt.seconds : 0) || (a.fullName || '').localeCompare(b.fullName || ''); })
      .map(function (u) {
        const actionCell = readOnly
          ? '<button class="btn btn-ghost btn-sm" data-action="view" data-uid="' + esc(u.uid) + '">View</button>'
          : '<div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm" data-action="view" data-uid="' + esc(u.uid) + '">View</button>' +
            '<button class="btn btn-outline btn-sm" data-action="edit" data-uid="' + esc(u.uid) + '">Edit</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="reset" data-uid="' + esc(u.uid) + '">Reset</button>' +
            '<button class="btn btn-sm ' + (u.status === 'inactive' ? 'btn-success-inline' : 'btn-danger-inline') + '" data-action="toggle" data-uid="' + esc(u.uid) + '">' + (u.status === 'inactive' ? 'Activate' : 'Deactivate') + '</button>' +
            '</div>';
        return (
          '<tr>' +
          '<td><strong>' + esc(u.voterId || 'Not set') + '</strong></td>' +
          '<td>' + esc(u.fullName) + '</td>' +
          '<td>' + passwordBadge(u) + '</td>' +
          '<td>' + roleBadge(u.role) + ' ' + statusBadge(u) + '</td>' +
          '<td>' + actionCell + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderStudents(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    const rows = allStudents.filter(function (s) {
      if (!q) return true;
      return [s.admNumber, s.fullName].some(function (v) {
        return String(v || '').toLowerCase().includes(q);
      });
    });
    if ($studentEmpty) $studentEmpty.classList.toggle('hidden', rows.length > 0);
    if (!$studentBody) return;
    $studentBody.innerHTML = rows
      .sort(function (a, b) { return String(a.admNumber || '').localeCompare(String(b.admNumber || '')); })
      .map(function (s) {
        const state = s.used ? '<span class="badge active">Registered</span>' : '<span class="badge pending">Not yet registered</span>';
        return '<tr><td><strong>' + esc(s.admNumber || '') + '</strong></td><td>' + esc(s.fullName || '') + '</td><td>' + state + '</td></tr>';
      })
      .join('');
  }

  async function load() {
    const $loadError = document.getElementById('loadError');
    try {
      const snap = await DB.collection('users').get();
      allUsers = snap.docs.map(function (doc) {
        const d = doc.data();
        return Object.assign({ uid: doc.id }, d);
      });
      if ($loadError) $loadError.style.display = 'none';
    } catch (err) {
      // Never fail silently: a denied or broken query must say so,
      // otherwise the list looks empty and voters look "missing".
      const msg = 'Could not load the voters list: ' + friendlyError(err) + ' Try Refresh, or sign out and sign in again.';
      if ($loadError) { $loadError.textContent = msg; $loadError.style.display = 'block'; }
      throw err;
    }
    render($search.value);
    try {
      const sSnap = await DB.collection('studentList').get();
      allStudents = sSnap.docs.map(function (doc) { return doc.data(); });
    } catch (e) { allStudents = []; }
    renderStudents($studentSearch ? $studentSearch.value : '');
  }

  function parseStudentLines(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      const t = String(line || '').trim();
      if (!t) return;
      // Accept comma, semicolon or tab separated: adm, full name
      const parts = t.split(/[,;\t]+/);
      if (parts.length < 2) return;
      const adm = String(parts[0] || '').trim();
      const name = parts.slice(1).join(' ').trim();
      if (adm && name) out.push({ admNumber: adm, fullName: name });
    });
    return out;
  }

  // ---------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------
  const $registerModal = document.getElementById('registerModal');
  const $registerForm = document.getElementById('registerForm');

  function plusActivateButtonsCss() {
    // (small style tweaks for the inline activate/deactivate buttons)
    const css = document.createElement('style');
    css.textContent = '.btn-success-inline{background:var(--success-soft);color:var(--success);} .btn-danger-inline{background:var(--danger-soft);color:var(--danger);}';
    document.head.appendChild(css);
  }

  function syncRegisterRoleUI() {
    const role = document.getElementById('regRole').value || 'voter';
    const staff = role !== 'voter';
    document.getElementById('staffPwWrap').classList.toggle('hidden', !staff);
    document.getElementById('admHint').classList.toggle('hidden', staff);
    const admLabel = document.querySelector('label[for="regVoterId"]');
    if (admLabel) admLabel.textContent = staff ? 'Staff ID (optional)' : 'Adm number (username + first password)';
  }

  document.getElementById('openRegisterBtn').addEventListener('click', function () {
    $registerForm.reset();
    syncRegisterRoleUI();
    openModal('registerModal');
  });
  document.getElementById('regRole').addEventListener('change', syncRegisterRoleUI);

  $registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const gender = document.getElementById('regGender').value;
    const voterId = document.getElementById('regVoterId').value.trim();
    const role = document.getElementById('regRole').value || 'voter';

    if (role === 'voter' && !voterId) { toast('Adm number is required.', 'error'); return; }
    if (role !== 'voter' && !email) { toast('Email is required for staff accounts.', 'error'); return; }
    let staffPw = '';
    if (role !== 'voter') {
      staffPw = document.getElementById('regPassword').value || '';
      if (staffPw.length < 6) { toast('Staff password must be at least 6 characters.', 'error'); return; }
    }

    const btn = $registerForm.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Registering…';
    try {
      // Voters: adm number is username + first password, no explicit password sent.
      const payload = { fullName, email, phone, gender, voterId, role };
      if (role !== 'voter') payload.password = staffPw;
      const res = await registerUser(payload);
      if (role === 'voter') {
        toast('Voter registered. Adm: ' + (res.voterId || '') + '. First login uses adm as password.', 'success');
      } else {
        toast('Staff registered. Email: ' + email, 'success');
      }
      closeModal('registerModal');
      await load();
    } catch (err) {
      const e = callFriendly(err);
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register Voter';
    }
  });

  // ---------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------
  const $editModal = document.getElementById('editModal');
  const $editForm = document.getElementById('editForm');

  $editForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const uid = document.getElementById('editUid').value;
    const payload = {
      uid,
      fullName: document.getElementById('editFullName').value.trim(),
      email: document.getElementById('editEmail').value.trim(),
      phone: document.getElementById('editPhone').value.trim(),
      gender: document.getElementById('editGender').value
    };
    const btn = $editForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await updateUser(payload);
      toast('Changes saved.', 'success');
      closeModal('editModal');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------
  // View
  // ---------------------------------------------------------------
  const $viewDetails = document.getElementById('viewDetails');

  function openView(uid) {
    const u = allUsers.find(function (x) { return x.uid === uid; });
    if (!u) return;
    $viewDetails.innerHTML =
      '<table class="data">' +
      '<tr><td><span class="muted">Full Name</span></td><td><strong>' + esc(u.fullName) + '</strong></td></tr>' +
      '<tr><td><span class="muted">Adm Number</span></td><td>' + esc(u.voterId || 'Not set') + '</td></tr>' +
      '<tr><td><span class="muted">Gender</span></td><td>' + esc(u.gender || 'Not set') + '</td></tr>' +
      '<tr><td><span class="muted">Role</span></td><td>' + roleBadge(u.role) + '</td></tr>' +
      '<tr><td><span class="muted">Password</span></td><td>' + passwordBadge(u) + '</td></tr>' +
      '<tr><td><span class="muted">Status</span></td><td>' + statusBadge(u) + '</td></tr>' +
      '<tr><td><span class="muted">Registered</span></td><td>' + fmtDateTime(u.createdAt) + '</td></tr>' +
      '</table>';
    openModal('viewModal');
  }

  function openEdit(uid) {
    const u = allUsers.find(function (x) { return x.uid === uid; });
    if (!u) return;
    document.getElementById('editUid').value = u.uid;
    document.getElementById('editFullName').value = u.fullName || '';
    document.getElementById('editEmail').value = u.email || '';
    document.getElementById('editPhone').value = u.phone || '';
    document.getElementById('editGender').value = u.gender || '';
    openModal('editModal');
  }

  // ---------------------------------------------------------------
  // Reset password
  // ---------------------------------------------------------------
  const $resetForm = document.getElementById('resetForm');

  function openReset(uid) {
    const u = allUsers.find(function (x) { return x.uid === uid; });
    if (!u) return;
    document.getElementById('resetUid').value = u.uid;
    if (u.role === 'voter') {
      document.getElementById('resetFor').textContent = 'Reset ' + u.fullName + ' (' + (u.voterId || '') + ') back to adm number. They will set their own password on next login.';
    } else {
      document.getElementById('resetFor').textContent = 'Set a new password for ' + u.fullName + ' (' + u.email + ').';
    }
    $resetForm.reset();
    openModal('resetModal');
  }

  $resetForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const uid = document.getElementById('resetUid').value;
    let pw = document.getElementById('resetPassword').value;
    let pw2 = document.getElementById('resetConfirm').value;
    const target = allUsers.find(function (x) { return x.uid === uid; });
    // Empty reset for a voter means: restore adm number as password + force personal reset.
    const resetToAdm = !!(target && target.role === 'voter' && !pw && !pw2);
    if (resetToAdm) {
      pw = String(target.admNumber || target.voterId || '');
      pw2 = pw;
    }
    if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }
    if (pw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }

    const btn = $resetForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await resetPasswordFn({ uid, newPassword: pw });
      toast(resetToAdm
        ? 'Password reset to the adm number. The voter will be asked to set a new password at next login.'
        : 'Password reset successfully.', 'success');
      closeModal('resetModal');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------
  // Toggle active / deactivate
  // ---------------------------------------------------------------
  $tbody.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const uid = btn.dataset.uid;

    if (action === 'view') openView(uid);
    else if (action === 'edit') openEdit(uid);
    else if (action === 'reset') openReset(uid);
    else if (action === 'toggle') toggleStatus(uid);
  });

  async function toggleStatus(uid) {
    const u = allUsers.find(function (x) { return x.uid === uid; });
    if (!u) return;
    const next = u.status === 'inactive' ? 'active' : 'inactive';
    if (next === 'inactive') {
      const ok = await confirmDialog({ title: 'Deactivate voter', message: 'Deactivate ' + u.fullName + '? They will not be able to sign in or vote.', confirmText: 'Deactivate', danger: true });
      if (!ok) return;
    }
    if (next === 'active') {
      const ok = await confirmDialog({ title: 'Re-activate voter', message: 'Re-activate ' + u.fullName + '?', confirmText: 'Activate' });
      if (!ok) return;
    }
    try {
      await updateUser({ uid, status: next });
      toast(u.fullName + ' is now ' + next + '.', 'success');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    }
  }

  // ---------------------------------------------------------------
  // Misc wiring
  // ---------------------------------------------------------------
  $search.addEventListener('input', function () { render($search.value); });
  if ($studentSearch) $studentSearch.addEventListener('input', function () { renderStudents($studentSearch.value); });
  const $refreshBtn = document.getElementById('refreshBtn');
  if ($refreshBtn) $refreshBtn.addEventListener('click', function () {
    $refreshBtn.disabled = true;
    load().catch(function () {}).then(function () { $refreshBtn.disabled = false; });
  });

  // Import students wiring
  const $importModal = document.getElementById('importModal');
  const $importText = document.getElementById('importText');
  const $importFile = document.getElementById('importFile');
  const $doImport = document.getElementById('doImportBtn');
  const openImport = document.getElementById('openImportBtn');
  if (openImport) {
    openImport.addEventListener('click', function () {
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

  qsa('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });

  // Esc / backdrop close for modals
  [['registerModal'], ['editModal'], ['viewModal'], ['resetModal'], ['importModal']].forEach(function (pair) {
    const m = document.getElementById(pair[0]);
    if (!m) return;
    m.addEventListener('click', function (e) {
      if (e.target === m) closeModal(pair[0]);
    });
  });

  window.authPromise.then(function (a) {
    // Read-only staff can view voters but cannot register or change them.
    window.hideForReadOnly('#openRegisterBtn');
    // Only super admins may grant the admin (or super admin) role.
    if (a.role === 'superadmin') {
      document.getElementById('regRoleWrap').classList.remove('hidden');
      const roleSelect = document.getElementById('regRole');
      roleSelect.innerHTML =
        '<option value="voter">Voter</option>' +
        '<option value="admin">Admin</option>' +
        '<option value="superadmin">Super Admin</option>' +
        '<option value="director">Director (view only)</option>' +
        '<option value="principal">Principal (view only)</option>' +
        '<option value="dean">Dean (view only)</option>' +
        '<option value="registrar">Registrar (view only)</option>';
    }
    plusActivateButtonsCss();
    return load().then(function () { liveCollections([DB.collection('users'), DB.collection('studentList')], load); });
  }).catch(function (err) {
    toast('Could not load voters: ' + friendlyError(err), 'error');
  });
})();