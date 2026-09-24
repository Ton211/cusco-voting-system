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
      return { id: d.id, electionId: x.electionId, positionId: x.positionId, name: x.name, photo: x.photo || null, status: x.status };
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
        '<button class="btn btn-danger-outline btn-sm" data-action="delete" data-id="' + esc(c.id) + '">Delete</button>' +
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
    document.getElementById('candStatus').value = c.status;
    openModal('candidateModal');
  }

  async function uploadPhoto(file) {
    if (!file) return null;
    if (file.size > 2 * 1024 * 1024) throw new Error('Photo must be 2 MB or smaller.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = 'candidate-photos/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    // Timeout so a stalled Storage upload can never leave the form stuck on "Saving…".
    const putPromise = FB_STORAGE.ref(filePath).put(file);
    const timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('Photo upload timed out. Check your connection and Storage rules, then try again without a photo.')); }, 60000);
    });
    await Promise.race([putPromise, timeoutPromise]);
    return await FB_STORAGE.ref(filePath).getDownloadURL();
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error(message)); }, ms);
      })
    ]);
  }

  $form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('candDocId').value;
    const data = {
      electionId: $electionSelect.value,
      positionId: $positionSelect.value,
      name: document.getElementById('candName').value.trim(),
      status: document.getElementById('candStatus').value
    };
    if (!data.electionId || !data.positionId) { toast('Select an election and a position.', 'error'); return; }
    if (!data.name) { toast('Enter a candidate name.', 'error'); return; }

    const btn = $form.querySelector('button[type=submit]');
    const originalText = id ? 'Save Changes' : 'Save Candidate';
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const file = document.getElementById('candPhoto').files[0];
      if (file) data.photo = await uploadPhoto(file);

      if (id) {
        await withTimeout(
          DB.collection('candidates').doc(id).update(data),
          30000,
          'Update timed out. Check your connection and Firestore rules, then refresh to see if it saved.'
        );
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await withTimeout(
          DB.collection('candidates').add(data),
          30000,
          'Save timed out. Check your connection and Firestore rules, then refresh to see if the candidate was added.'
        );
      }
      // Success: close + confirm BEFORE refreshing, so a slow/failed
      // refresh can never leave the form stuck on "Saving…" or hide
      // the fact that the write actually succeeded.
      closeModal('candidateModal');
      toast(id ? 'Candidate updated.' : 'Candidate registered.', 'success');
      try {
        await loadMeta();
        render($search.value.toLowerCase().trim());
      } catch (refreshErr) {
        console.error('Candidate saved but list refresh failed:', refreshErr);
        toast('Saved, but the list could not refresh: ' + friendlyError(refreshErr), 'error');
      }
    } catch (err) {
      console.error('Candidate save failed:', err);
      toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // ---------------------------------------------------------------
  // Toggle status + delete
  // ---------------------------------------------------------------
  async function deleteCandidate(id) {
    const c = allCandidates.find(function (x) { return x.id === id; });
    if (!c) return;
    const ok = await confirmDialog({
      title: 'Delete candidate',
      message: 'Permanently delete "' + c.name + '"? This cannot be undone.',
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      // Never delete a candidate once voting has started: their votes
      // would disappear from the results view. Deactivate instead.
      const election = elections.find(function (x) { return x.id === c.electionId; });
      const votesSnap = await DB.collection('votes').doc(c.electionId).get().catch(function () { return null; });
      const votesCast = votesSnap && votesSnap.exists ? (votesSnap.data().totalVotes || 0) : 0;
      if ((election && election.status === 'active') || votesCast > 0) {
        toast('Votes have already started for this election. Deactivate the candidate instead of deleting.', 'error');
        return;
      }
      if (c.photo) {
        try { await FB_STORAGE.refFromURL(c.photo).delete(); } catch (photoErr) { /* photo already gone */ }
      }
      await DB.collection('candidates').doc(c.id).delete();
      toast('Candidate deleted.', 'success');
      await loadMeta();
      render($search.value.toLowerCase().trim());
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  }

  $tbody.addEventListener('click', async function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') { openEdit(btn.dataset.id); return; }
    if (btn.dataset.action === 'delete') { deleteCandidate(btn.dataset.id); return; }
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
    // Real-time: any candidate/election/position change re-renders at once.
    liveCollections([DB.collection('elections'), DB.collection('positions'), DB.collection('candidates')], refresh);
  }).catch(function (err) {
    toast('Could not load candidates: ' + friendlyError(err), 'error');
  });
})();