// =====================================================================
//  Admin: candidate management
// =====================================================================
(function () {
  let allCandidates = [];
  let elections = [];
  let positionsByElection = {};

  const $tbody = document.getElementById('candidatesTableBody');
  const $empty = document.getElementById('emptyState');
  const $search = document.getElementById('searchBox');
  const $form = document.getElementById('candidateForm');
  const $electionSelect = document.getElementById('candElection');
  const $positionSelect = document.getElementById('candPosition');

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------
  async function loadMeta() {
    const [eSnap, pSnap, cSnap] = await Promise.all([
      DB.collection('elections').get(),
      DB.collection('positions').get(),
      DB.collection('candidates').get()
    ]);
    elections = eSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, name: x.name, status: x.status };
    });
    positionsByElection = {};
    pSnap.docs.forEach(function (d) {
      const x = d.data();
      if (!positionsByElection[x.electionId]) positionsByElection[x.electionId] = [];
      positionsByElection[x.electionId].push({ id: d.id, name: x.name, order: x.order || 0 });
    });
    Object.keys(positionsByElection).forEach(function (k) {
      positionsByElection[k].sort(function (a, b) { return a.order - b.order; });
    });
    allCandidates = cSnap.docs.map(function (d) {
      const x = d.data();
      return { id: d.id, electionId: x.electionId, positionId: x.positionId, name: x.name, photo: x.photo || null, description: x.description || '', status: x.status };
    });

    const prevElection = $electionSelect.value;
    $electionSelect.innerHTML =
      '<option value="">Select election…</option>' +
      elections.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
    if (prevElection && elections.some(function (e) { return e.id === prevElection; })) {
      $electionSelect.value = prevElection;
    }
    if ($electionSelect.value) populatePositions($electionSelect.value);
  }

  function populatePositions(electionId) {
    const list = positionsByElection[electionId] || [];
    $positionSelect.innerHTML =
      '<option value="">Select position…</option>' +
      list.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') +
      (list.length ? '' : '<option value="" disabled>No positions yet. Add them in Elections</option>');
  }

  $electionSelect.addEventListener('change', function () {
    populatePositions(this.value);
  });

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function electionName(id) {
    const e = elections.find(function (x) { return x.id === id; });
    return e ? e.name : 'Not set';
  }

  function positionName(id) {
    let name = null;
    Object.keys(positionsByElection).forEach(function (k) {
      const p = positionsByElection[k].find(function (x) { return x.id === id; });
      if (p) name = p.name;
    });
    return name || 'Not set';
  }

  function render(q) {
    const filtered = allCandidates.filter(function (c) {
      if (!q) return true;
      const hay = (c.name + ' ' + electionName(c.electionId) + ' ' + positionName(c.positionId)).toLowerCase();
      return hay.includes(q);
    });

    $empty.classList.toggle('hidden', filtered.length > 0);

    $tbody.innerHTML = filtered.map(function (c) {
      const photo = c.photo
        ? '<img class="avatar" src="' + esc(c.photo) + '" alt="" style="object-fit:cover;">'
        : '<span class="avatar sm">' + esc(initials(c.name)) + '</span>';
      return (
        '<tr>' +
        '<td>' + photo + '</td>' +
        '<td><strong>' + esc(c.name) + '</strong></td>' +
        '<td>' + esc(positionName(c.positionId)) + '</td>' +
        '<td>' + esc(electionName(c.electionId)) + '</td>' +
        '<td>' + (c.status === 'active' ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn btn-outline btn-sm" data-action="edit" data-id="' + esc(c.id) + '">Edit</button>' +
        '<button class="btn btn-sm ' + (c.status === 'active' ? 'btn-danger-inline' : 'btn-success-inline') + '" data-action="toggle" data-id="' + esc(c.id) + '">' + (c.status === 'active' ? 'Deactivate' : 'Activate') + '</button>' +
        '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  $search.addEventListener('input', function () { render($search.value.toLowerCase().trim()); });

  // ---------------------------------------------------------------
  // Register / Edit
  // ---------------------------------------------------------------
  function resetForm() {
    $form.reset();
    document.getElementById('candDocId').value = '';
    document.getElementById('candPhoto').value = '';
    document.getElementById('candidateModalTitle').textContent = 'Register Candidate';
    document.getElementById('candSubmitBtn').textContent = 'Save Candidate';
    $electionSelect.value = '';
    $positionSelect.innerHTML = '<option value="">Select position…</option>';
  }

  function openRegister() {
    resetForm();
    openModal('candidateModal');
  }

  function openEdit(id) {
    const c = allCandidates.find(function (x) { return x.id === id; });
    if (!c) return;
    resetForm();
    document.getElementById('candDocId').value = c.id;
    document.getElementById('candidateModalTitle').textContent = 'Edit Candidate';
    document.getElementById('candSubmitBtn').textContent = 'Save Changes';
    $electionSelect.value = c.electionId;
    populatePositions(c.electionId);
    $positionSelect.value = c.positionId;
    document.getElementById('candName').value = c.name;
    document.getElementById('candDescription').value = c.description || '';
    document.getElementById('candStatus').value = c.status;
    openModal('candidateModal');
  }

  async function uploadPhoto(file) {
    if (!file) return null;
    if (file.size > 2 * 1024 * 1024) throw new Error('Photo must be 2 MB or smaller.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = 'candidate-photos/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    await FB_STORAGE.ref(filePath).put(file);
    return await FB_STORAGE.ref(filePath).getDownloadURL();
  }

  $form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('candDocId').value;
    const data = {
      electionId: $electionSelect.value,
      positionId: $positionSelect.value,
      name: document.getElementById('candName').value.trim(),
      description: document.getElementById('candDescription').value.trim(),
      status: document.getElementById('candStatus').value
    };
    if (!data.electionId || !data.positionId) { toast('Select an election and a position.', 'error'); return; }
    if (!data.name) { toast('Enter a candidate name.', 'error'); return; }

    const btn = $form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const file = document.getElementById('candPhoto').files[0];
      if (file) data.photo = await uploadPhoto(file);

      if (id) {
        await DB.collection('candidates').doc(id).update(data);
        toast('Candidate updated.', 'success');
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await DB.collection('candidates').add(data);
        toast('Candidate registered.', 'success');
      }
      closeModal('candidateModal');
      await loadMeta();
      render($search.value.toLowerCase().trim());
    } catch (err) {
      toast(friendlyError(err) + (err.message && err.message.includes('2 MB') ? ' ' + err.message : ''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = id ? 'Save Changes' : 'Save Candidate';
    }
  });

  // ---------------------------------------------------------------
  // Toggle status
  // ---------------------------------------------------------------
  $tbody.addEventListener('click', async function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') { openEdit(btn.dataset.id); return; }
    if (btn.dataset.action === 'toggle') {
      const c = allCandidates.find(function (x) { return x.id === btn.dataset.id; });
      if (!c) return;
      const next = c.status === 'active' ? 'inactive' : 'active';
      try {
        await DB.collection('candidates').doc(c.id).update({ status: next });
        await loadMeta();
        render($search.value.toLowerCase().trim());
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    }
  });

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------
  function addBtnStyles() {
    const css = document.createElement('style');
    css.textContent = '.btn-success-inline{background:var(--success-soft);color:var(--success);} .btn-danger-inline{background:var(--danger-soft);color:var(--danger);}';
    document.head.appendChild(css);
  }

  document.getElementById('openRegisterBtn').addEventListener('click', openRegister);
  document.getElementById('emptyRegisterBtn').addEventListener('click', openRegister);

  qsa('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeModal(b.dataset.close); });
  });
  const candModal = document.getElementById('candidateModal');
  candModal.addEventListener('click', function (e) { if (e.target === candModal) closeModal('candidateModal'); });

  function refresh() {
    return loadMeta().then(function () {
      render($search.value.toLowerCase().trim());
    });
  }

  window.authPromise.then(function () {
    addBtnStyles();
    return loadMeta();
  }).then(function () {
    render('');
    autoLive(refresh);
  }).catch(function (err) {
    toast('Could not load candidates: ' + friendlyError(err), 'error');
  });
})();