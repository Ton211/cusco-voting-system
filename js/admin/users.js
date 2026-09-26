// =====================================================================
//  Admin: staff accounts (admins + superadmins). Superadmins only.
// =====================================================================
(function () {
  let allStaff = [];
  let myRole = null;
  let myUid = null;

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
  const setUserRoleFn = callable('setUserRole');
  const deleteUserFn = callable('deleteUser');

  const $tbody = document.getElementById('usersTableBody');
  const $empty = document.getElementById('emptyState');
  const $search = document.getElementById('searchBox');

  function roleBadge(role) {
    if (role === 'superadmin') return '<span class="badge superadmin">Super Admin</span>';
    if (window.isViewerRole(role)) {
      const label = String(role).charAt(0).toUpperCase() + String(role).slice(1);
      return '<span class="badge scheduled">' + esc(label) + '</span>';
    }
    return '<span class="badge admin">Admin</span>';
  }

  function render(filterText) {
    const q = (filterText || '').toLowerCase().trim();
    const rows = allStaff.filter(function (u) {
      if (!q) return true;
      return [u.fullName, u.email].some(function (v) {
        return String(v || '').toLowerCase().includes(q);
      });
    });
    $empty.classList.toggle('hidden', rows.length > 0);
    $tbody.innerHTML = rows
      .sort(function (a, b) { return (a.fullName || '').localeCompare(b.fullName || ''); })
      .map(function (u) {
        const self = u.uid === myUid ? ' <span class="muted">(you)</span>' : '';
        const isSelf = u.uid === myUid;
        const status = u.status === 'inactive'
          ? '<span class="badge inactive">Inactive</span>'
          : '<span class="badge active">Active</span>';
        return '<tr>' +
          '<td><strong>' + esc(u.fullName) + '</strong>' + self + '</td>' +
          '<td>' + esc(u.email || 'Not set') + '</td>' +
          '<td>' + roleBadge(u.role) + '</td>' +
          '<td>' + status + '</td>' +
          '<td><div class="row-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="role" data-uid="' + esc(u.uid) + '">Role</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="reset" data-uid="' + esc(u.uid) + '">Reset</button>' +
          '<button class="btn btn-sm ' + (u.status === 'inactive' ? 'btn-success-inline' : 'btn-danger-inline') + '" data-action="toggle" data-uid="' + esc(u.uid) + '">' + (u.status === 'inactive' ? 'Activate' : 'Deactivate') + '</button>' +
          (isSelf ? '' : '<button class="btn btn-danger btn-sm" data-action="delete" data-uid="' + esc(u.uid) + '">Delete</button>') +
          '</div></td>' +
          '</tr>';
      })
      .join('');
  }

  async function load() {
    const snap = await DB.collection('users').where('role', 'in', ['admin', 'superadmin', 'director', 'principal', 'dean', 'registrar']).get();
    allStaff = snap.docs.map(function (doc) {
      return Object.assign({ uid: doc.id }, doc.data());
    });
    render($search.value);
  }

  // ---------------------------------------------------------------
  // Create staff
  // ---------------------------------------------------------------
  const $createForm = document.getElementById('createForm');
  document.getElementById('openCreateBtn').addEventListener('click', function () {
    $createForm.reset();
    openModal('createModal');
  });

  $createForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const fullName = document.getElementById('staffName').value.trim();
    const email = document.getElementById('staffEmail').value.trim();
    const role = document.getElementById('staffRole').value || 'admin';
    const pw = document.getElementById('staffPassword').value;
    const pw2 = document.getElementById('staffConfirm').value;
    if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }
    if (pw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    const btn = $createForm.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await registerUser({ fullName: fullName, email: email, password: pw, role: role });
      toast('Staff account created.', 'success');
      closeModal('createModal');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Staff';
    }
  });

  // ---------------------------------------------------------------
  // Row actions
  // ---------------------------------------------------------------
  $tbody.addEventListener('click', async function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const uid = btn.dataset.uid;
    const u = allStaff.find(function (x) { return x.uid === uid; });
    if (!u) return;

    if (btn.dataset.action === 'reset') {
      document.getElementById('resetUid').value = uid;
      document.getElementById('resetFor').textContent = 'Set a new password for ' + u.fullName + ' (' + u.email + ').';
      document.getElementById('resetForm').reset();
      openModal('resetModal');
    } else if (btn.dataset.action === 'role') {
      // View-only staff can only be promoted to full admin here.
      const next = window.isViewerRole(u.role) ? 'admin' : (u.role === 'superadmin' ? 'admin' : 'superadmin');
      const ok = await confirmDialog({ title: 'Change role', message: 'Set ' + u.fullName + ' as ' + next + '?', confirmText: 'Confirm' });
      if (!ok) return;
      try {
        await setUserRoleFn({ uid: uid, role: next });
        toast('Role updated.', 'success');
        await load();
      } catch (err) {
        toast(callFriendly(err).message, 'error');
      }
    } else if (btn.dataset.action === 'toggle') {
      const next = u.status === 'inactive' ? 'active' : 'inactive';
      const ok = await confirmDialog({
        title: next === 'active' ? 'Activate staff' : 'Deactivate staff',
        message: (next === 'active' ? 'Activate ' : 'Deactivate ') + u.fullName + '?',
        confirmText: next === 'active' ? 'Activate' : 'Deactivate',
        danger: next !== 'active'
      });
      if (!ok) return;
      try {
        await updateUser({ uid: uid, status: next });
        toast('Status updated.', 'success');
        await load();
      } catch (err) {
        toast(callFriendly(err).message, 'error');
      }
    } else if (btn.dataset.action === 'delete') {
      if (uid === myUid) { toast('You cannot delete your own account.', 'error'); return; }
      const ok = await confirmDialog({
        title: 'Delete staff',
        message: 'Permanently delete ' + u.fullName + ' (' + (u.email || 'no email') + ')? They will no longer be able to sign in. This cannot be undone.',
        confirmText: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteUserFn({ uid: uid });
        toast('Staff account deleted.', 'success');
        await load();
      } catch (err) {
        toast(callFriendly(err).message, 'error');
      }
    }
  });

  document.getElementById('resetForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const uid = document.getElementById('resetUid').value;
    const pw = document.getElementById('resetPassword').value;
    const pw2 = document.getElementById('resetConfirm').value;
    if (pw !== pw2) { toast('Passwords do not match.', 'error'); return; }
    if (pw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    const btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await resetPasswordFn({ uid: uid, newPassword: pw });
      toast('Password reset successfully.', 'success');
      closeModal('resetModal');
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  $search.addEventListener('input', function () { render($search.value); });

  function plusButtonsCss() {
    const css = document.createElement('style');
    css.textContent = '.btn-success-inline{background:var(--success-soft);color:var(--success);} .btn-danger-inline{background:var(--danger-soft);color:var(--danger);}';
    document.head.appendChild(css);
  }

  qsa('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });
  ['createModal', 'resetModal'].forEach(function (id) {
    const m = document.getElementById(id);
    if (m) m.addEventListener('click', function (e) { if (e.target === m) closeModal(id); });
  });

  window.authPromise.then(function (a) {
    myRole = a.role;
    myUid = a.user ? a.user.uid : null;
    if (myRole !== 'superadmin') {
      document.body.innerHTML = '<main class="content"><div class="alert alert-warn">Only superadmins manage staff accounts.</div></main>';
      return;
    }
    plusButtonsCss();
    return load().then(function () { liveCollections([DB.collection('users').where('role', 'in', ['admin', 'superadmin', 'director', 'principal', 'dean', 'registrar'])], load); });
  }).catch(function (err) {
    toast('Could not load users: ' + friendlyError(err), 'error');
  });
})();
