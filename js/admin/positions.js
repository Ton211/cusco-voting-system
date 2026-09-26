// =====================================================================
//  Admin: standalone ballot positions
// =====================================================================
(function () {
  let elections = [];
  let allPositions = [];

  const $tbody = document.getElementById('positionsTableBody');
  const $empty = document.getElementById('emptyState');
  const $search = document.getElementById('searchBox');
  const $filter = document.getElementById('electionFilter');
  const $modal = document.getElementById('positionModal');
  const $form = document.getElementById('positionForm');

  function electionName(id) {
    const e = elections.find(function (x) { return x.id === id; });
    return e ? e.name : 'Not set';
  }

  function render() {
    const q = ($search.value || '').toLowerCase().trim();
    const fe = $filter.value || '';
    const rows = allPositions.filter(function (p) {
      if (fe && p.electionId !== fe) return false;
      if (!q) return true;
      return (p.name + ' ' + electionName(p.electionId)).toLowerCase().includes(q);
    });

    const readOnly = window.isReadOnly();
    $empty.classList.toggle('hidden', rows.length > 0);
    $tbody.innerHTML = rows
      .sort(function (a, b) {
        if (a.electionId !== b.electionId) return electionName(a.electionId).localeCompare(electionName(b.electionId));
        return (a.order || 0) - (b.order || 0);
      })
      .map(function (p) {
        const actionCell = readOnly
          ? '<span class="muted">—</span>'
          : '<div class="row-actions">' +
            '<button class="btn btn-outline btn-sm" data-action="edit" data-id="' + esc(p.id) + '">Edit</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="del" data-id="' + esc(p.id) + '">Delete</button>' +
            '</div>';
        return '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + esc(electionName(p.electionId)) + '</td>' +
          '<td>' + esc(p.order || 0) + '</td>' +
          '<td>' + actionCell + '</td>' +
          '</tr>';
      })
      .join('');
  }

  async function load() {
    const [eSnap, pSnap] = await Promise.all([
      DB.collection('elections').get(),
      DB.collection('positions').get()
    ]);
    elections = eSnap.docs.map(function (d) {
      return { id: d.id, name: d.data().name || d.id };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    allPositions = pSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, electionId: x.electionId, name: x.name, order: x.order || 0 };
    });

    const prevFilter = $filter.value;
    $filter.innerHTML = '<option value="">All elections</option>' +
      elections.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
    if (prevFilter && elections.some(function (e) { return e.id === prevFilter; })) $filter.value = prevFilter;

    const sel = document.getElementById('posElection');
    const prevSel = sel.value;
    sel.innerHTML = elections.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
    if (prevSel && elections.some(function (e) { return e.id === prevSel; })) sel.value = prevSel;

    render();
  }

  document.getElementById('openAddBtn').addEventListener('click', function () {
    $form.reset();
    document.getElementById('posDocId').value = '';
    document.getElementById('positionModalTitle').textContent = 'Add Position';
    document.getElementById('posElection').disabled = false;
    openModal('positionModal');
  });

  $form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('posDocId').value;
    const eid = document.getElementById('posElection').value;
    const name = document.getElementById('posName').value.trim();
    if (!eid) { toast('Choose an election.', 'error'); return; }
    if (!name) { toast('Type a position name.', 'error'); return; }

    const btn = document.getElementById('posSubmitBtn');
    btn.disabled = true;
    try {
      if (id) {
        await DB.collection('positions').doc(id).update({ name: name });
        toast('Position updated.', 'success');
      } else {
        const existing = await DB.collection('positions').where('electionId', '==', eid).get();
        await DB.collection('positions').doc(eid + '_' + existing.size).set({
          electionId: eid, name: name, order: existing.size
        });
        toast('Position added.', 'success');
      }
      closeModal('positionModal');
      await load();
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $tbody.addEventListener('click', async function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const p = allPositions.find(function (x) { return x.id === id; });
    if (!p) return;
    if (btn.dataset.action === 'edit') {
      document.getElementById('posDocId').value = p.id;
      document.getElementById('positionModalTitle').textContent = 'Edit Position';
      document.getElementById('posElection').value = p.electionId;
      document.getElementById('posElection').disabled = true;
      document.getElementById('posName').value = p.name;
      openModal('positionModal');
    } else if (btn.dataset.action === 'del') {
      const ok = await confirmDialog({ title: 'Delete position', message: 'Delete "' + p.name + '"? Candidates linked to it stay but lose their slot.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await DB.collection('positions').doc(id).delete();
        toast('Position deleted.', 'success');
        await load();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    }
  });

  $search.addEventListener('input', render);
  $filter.addEventListener('change', render);

  qsa('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });
  $modal.addEventListener('click', function (e) { if (e.target === $modal) closeModal('positionModal'); });

  window.authPromise.then(function () {
    // Read-only staff can see positions but cannot add or edit them.
    window.hideForReadOnly('#openAddBtn');
    return load().then(function () { liveCollections([DB.collection('elections'), DB.collection('positions')], load); });
  }).catch(function (err) {
    toast('Could not load positions: ' + friendlyError(err), 'error');
  });
})();
