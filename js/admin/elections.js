// =====================================================================
//  Admin: election management + ballot positions editor
// =====================================================================
(function () {
  const elections = [];

  const $list = document.getElementById('electionsList');
  const $form = document.getElementById('electionForm');

  function callable(name) {
    const fn = FB_FUNCTIONS.httpsCallable(name);
    return async function (payload) {
      const res = await fn(payload);
      return res.data;
    };
  }
  const saveElectionFn = callable('saveElection');
  const deleteElectionFn = callable('deleteElection');

  function badgeFor(status) {
    const map = {
      draft: '<span class="badge draft">Draft</span>',
      scheduled: '<span class="badge scheduled">Scheduled</span>',
      active: '<span class="badge active-running">Active</span>',
      closed: '<span class="badge closed">Closed</span>'
    };
    return map[status] || '<span class="badge draft">' + esc(status) + '</span>';
  }

  // ---------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------
  async function load() {
    const eSnap = await DB.collection('elections').get();
    elections.length = 0;

    eSnap.docs.forEach(function (d) {
      const x = d.data();
      elections.push({ id: d.id, name: x.name, startTime: x.startTime, endTime: x.endTime, status: x.status });
    });
    elections.sort(function (a, b) {
      return (b.startTime && a.startTime) ? b.startTime.seconds - a.startTime.seconds : 0;
    });

    render();
  }

  function render() {
    if (!elections.length) {
      $list.innerHTML = '<div class="empty">No elections yet. Click "+ Create Election" to start.</div>';
      return;
    }
    $list.innerHTML = elections.map(function (e) {
      return (
        '<div class="card" data-eid="' + esc(e.id) + '">' +
        '<div class="card-title">' +
        '<span>' + esc(e.name) + ' ' + badgeFor(e.status) + '</span>' +
        '<div class="row-actions">' +
        (e.status === 'active'
          ? '<button class="btn btn-danger-outline btn-sm" data-action="close" data-eid="' + esc(e.id) + '">Close</button>'
          : '<button class="btn btn-outline btn-sm" data-action="open" data-eid="' + esc(e.id) + '">Open</button>') +
        '<button class="btn btn-outline btn-sm" data-action="edit" data-eid="' + esc(e.id) + '">Edit</button>' +
        '<button class="btn btn-danger-outline btn-sm" data-action="delete" data-eid="' + esc(e.id) + '">Delete</button>' +
        '</div>' +
        '</div>' +
        '<div class="muted" style="font-size:13px;">Voting window: <strong>' + fmtDateTime(e.startTime) + '</strong> to <strong>' + fmtDateTime(e.endTime) + '</strong></div>' +
        '</div>'
      );
    }).join('');

    // Danger outline style for Close / Delete buttons.
    ensureStyles();
  }

  function ensureStyles() {
    if (document.getElementById('posStyles')) return;
    const css = document.createElement('style');
    css.id = 'posStyles';
    css.textContent =
      '.btn-danger-outline{border:1px solid var(--danger);color:var(--danger);background:#fff;}' +
      '.btn-danger-outline:hover{background:var(--danger-soft);}';
    document.head.appendChild(css);
  }

  // ---------------------------------------------------------------
  // Row actions (positions live under Candidates now)
  // ---------------------------------------------------------------
  $list.addEventListener('click', function (e) {
    const actionBtn = e.target.closest('button[data-action]');
    if (actionBtn) {
      const eid = actionBtn.dataset.eid;
      const action = actionBtn.dataset.action;
      if (action === 'open' || action === 'close') quickStatus(eid, action === 'open' ? 'active' : 'closed');
      if (action === 'edit') openEdit(eid);
      if (action === 'delete') deleteElection(eid);
    }
  });

  async function deleteElection(eid) {
    const e = elections.find(function (x) { return x.id === eid; });
    if (!e) return;
    const ok = await confirmDialog({ title: 'Delete election', message: 'Delete "' + e.name + '" plus its positions and candidates? Votes already cast in it are removed too.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteElectionFn({ id: eid });
      toast('Election deleted.', 'success');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    }
  }

  // ---------------------------------------------------------------
  // Status quick actions
  // ---------------------------------------------------------------
  async function quickStatus(eid, status) {
    const label = status === 'active' ? 'Open' : 'Close';
    const e = elections.find(function (x) { return x.id === eid; });
    if (!e) return;
    if (status === 'active') {
      const ok = await confirmDialog({ title: 'Open election', message: 'Open "' + e.name + '" for voting? Any other active election will be closed.', confirmText: 'Open' });
      if (!ok) return;
    }
    if (status === 'closed') {
      const ok = await confirmDialog({ title: 'Close election', message: 'Close "' + e.name + '" and stop further voting?', confirmText: 'Close', danger: true });
      if (!ok) return;
    }
    try {
      await saveElectionFn({ id: eid, status: status });
      toast('Election ' + label.toLowerCase() + 'd.', 'success');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    }
  }

  // ---------------------------------------------------------------
  // Create / Edit form
  // ---------------------------------------------------------------
  function resetForm(e) {
    $form.reset();
    document.getElementById('electionDocId').value = '';
    document.getElementById('electionModalTitle').textContent = 'Create Election';
    if (e) {
      document.getElementById('electionDocId').value = e.id;
      document.getElementById('electionModalTitle').textContent = 'Edit Election';
      document.getElementById('eleName').value = e.name;
      const st = tsToDate(e.startTime);
      const en = tsToDate(e.endTime);
      document.getElementById('eleStart').value = toLocalInput(st);
      document.getElementById('eleEnd').value = toLocalInput(en);
      document.getElementById('eleStatus').value = e.status || 'draft';
    }
  }

  function toLocalInput(d) {
    if (isNaN(d.getTime())) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  document.getElementById('openCreateBtn').addEventListener('click', function () { resetForm(null); openModal('electionModal'); });

  function openEdit(eid) {
    const e = elections.find(function (x) { return x.id === eid; });
    if (e) { resetForm(e); openModal('electionModal'); }
  }

  $form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const id = document.getElementById('electionDocId').value;
    const start = document.getElementById('eleStart').value;
    const end = document.getElementById('eleEnd').value;
    const payload = {
      id: id || null,
      name: document.getElementById('eleName').value.trim(),
      startTimeISO: dtLocalToISO(start),
      endTimeISO: dtLocalToISO(end),
      status: document.getElementById('eleStatus').value
    };
    if (!payload.name) { toast('Enter an election name.', 'error'); return; }

    const btn = $form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await saveElectionFn(payload);
      toast(id ? 'Election updated.' : 'Election created.', 'success');
      closeModal('electionModal');
      await load();
    } catch (err) {
      toast(callFriendly(err).message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Election';
    }
  });

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  qsa('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeModal(b.dataset.close); });
  });
  const eleModal = document.getElementById('electionModal');
  eleModal.addEventListener('click', function (e) { if (e.target === eleModal) closeModal('electionModal'); });

  window.authPromise.then(function () {
    return load().then(function () { autoLive(load); });
  }).catch(function (err) {
    $list.innerHTML = '<div class="empty">Could not load elections: ' + esc(friendlyError(err)) + '</div>';
  });
})();