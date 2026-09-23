// =====================================================================
//  Shared helpers for voter pages
// =====================================================================

async function fetchActiveElection() {
  const snap = await DB.collection('elections').where('status', '==', 'active').limit(1).get();
  if (snap.docs.length) {
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  }
  return null;
}

async function fetchNextScheduledElection() {
  // No orderBy here: sorted below so no composite index is ever needed.
  const snap = await DB.collection('elections')
    .where('status', '==', 'scheduled')
    .get();
  if (!snap.docs.length) return null;
  const rows = snap.docs.map(function (d) { return { id: d.id, ...d.data() }; });
  rows.sort(function (a, b) {
    const ta = tsToDate(a.startTime).getTime();
    const tb = tsToDate(b.startTime).getTime();
    return ta - tb;
  });
  return rows[0];
}

function ballotKey(electionId) {
  return 'cusco_ballot_' + electionId;
}