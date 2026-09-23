// =====================================================================
//  CUSCO Voting System — Firestore security rules tests
//
//  Run with:  npx firebase emulators:exec --only firestore \
//               "node tests/rules.test.js"
//
//  Covers the Phase 13 attack surface matrix against firestore.rules:
//  server-write-only users/elections, schema-bound positions/candidates,
//  admin-only votes read, pinned settings — each exercised from
//  anonymous, voter and admin contexts.
// =====================================================================

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeAdminApp
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const RULES_PATH = path.resolve(__dirname, '..', 'firestore.rules');
const PROJECT_ID = 'cusco-rules-test';
const FIRESTORE_PORT = 8081;

let env;
let seedDb; // Admin app -> bypasses rules (for seeding)
let anon;
let voterA;
let voterB;
let adminU;

const now = new Date();
const ELECTION = {
  name: 'General Election 2026',
  description: 'Test election',
  startTime: new Date(now.getTime() - 3600 * 1000),
  endTime: new Date(now.getTime() + 24 * 3600 * 1000),
  status: 'active'
};

const results = {};
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results[name] = 'PASS'; console.log('  PASS  ' + name); })
    .catch((err) => { results[name] = 'FAIL'; console.log('  FAIL  ' + name + '  ->  ' + (err && err.message ? err.message : err)); });
}

async function seed() {
  const eId = 'elect_test_1';
  await seedDb.collection('elections').doc(eId).set(ELECTION);
  await seedDb.collection('elections').doc('elect_closed').set(
    Object.assign({}, ELECTION, { status: 'closed', endTime: new Date(now.getTime() - 3600 * 1000) })
  );

  await seedDb.collection('users').doc('voterA').set({
    fullName: 'Voter A', voterId: 'VOT-AAA', email: 'a@test.dev', phone: '',
    gender: 'F', role: 'voter', status: 'active', votedIn: {}, createdAt: now
  });
  await seedDb.collection('users').doc('voterB').set({
    fullName: 'Voter B', voterId: 'VOT-BBB', email: 'b@test.dev', phone: '',
    gender: 'M', role: 'voter', status: 'active', votedIn: {}, createdAt: now
  });
  await seedDb.collection('users').doc('adminU').set({
    fullName: 'Admin U', voterId: 'VOT-ZZZ', email: 'admin@test.dev', phone: '',
    gender: 'O', role: 'admin', status: 'active', votedIn: {}, createdAt: now
  });

  await seedDb.collection('positions').doc(eId + '_0').set({
    electionId: eId, name: 'President', order: 0
  });
  await seedDb.collection('positions').doc(eId + '_1').set({
    electionId: eId, name: 'Secretary', order: 1
  });

  await seedDb.collection('candidates').doc('cand_1_ok').set({
    electionId: eId, positionId: eId + '_0', name: 'Alma',
    description: '', status: 'active', createdAt: now
  });
  await seedDb.collection('candidates').doc('cand_2_ok').set({
    electionId: eId, positionId: eId + '_1', name: 'Beto',
    description: '', status: 'active', createdAt: now
  });

  await seedDb.collection('votes').doc(eId).set({
    totalVotes: 3,
    results: { [eId + '_0']: { cand_1_ok: 3 }, [eId + '_1']: { cand_2_ok: 2 } },
    updatedAt: now
  });

  await seedDb.collection('settings').doc('resultsVisibility').set({
    hideUntilClose: true, electionId: eId, updatedAt: now
  });

  return eId;
}

async function main() {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: FIRESTORE_PORT }
  });

  seedDb = initializeAdminApp({ projectId: PROJECT_ID }).firestore();
  const eId = await seed();

  anon = env.unauthenticatedContext().firestore();
  voterA = env.authenticatedContext('voterA', { role: 'voter' }).firestore();
  voterB = env.authenticatedContext('voterB', { role: 'voter' }).firestore();
  adminU = env.authenticatedContext('adminU', { role: 'admin' }).firestore();

  // ------------------------------------------------------------------
  //  1. Unauthenticated user attempts to access voters
  // ------------------------------------------------------------------
  await test('1  anon cannot read ANY user or list users', async () => {
    await assertFails(anon.collection('users').get());
    await assertFails(anon.collection('users').doc('voterA').get());
  });

  //  2. Normal authenticated user attempts to access voters
  await test('2  voter cannot read other voters (cross-user privacy)', async () => {
    await assertFails(voterA.collection('users').get());
    await assertFails(voterA.collection('users').doc('voterB').get());
    await assertSucceeds(voterA.collection('users').doc('voterA').get());
  });

  //  3. Normal authenticated user attempts to modify voters
  await test('3  voter cannot write ANY user doc (self or others)', async () => {
    await assertFails(voterA.collection('users').doc('voterA').set({ role: 'admin' }));
    await assertFails(voterA.collection('users').doc('voterA').update({ votedIn: {} }));
    await assertFails(voterA.collection('users').doc('voterB').update({ status: 'inactive' }));
    await assertFails(voterA.collection('users').doc('voterB').delete());
  });

  //  4. Normal authenticated user attempts to access votes
  await test('4  voter cannot read the votes/aggregate collection', async () => {
    await assertFails(voterA.collection('votes').get());
    await assertFails(voterA.collection('votes').doc(eId).get());
  });

  //  5. Normal authenticated user attempts to write votes
  await test('5  voter cannot write votes (direct forgery blocked)', async () => {
    await assertFails(voterA.collection('votes').doc(eId).set({ totalVotes: 999 }));
    await assertFails(voterA.collection('votes').doc(eId).update({ totalVotes: 999 }));
    await assertFails(voterA.collection('votes').doc(eId).delete());
  });

  //  6. Normal authenticated user attempts to delete votes
  await test('6  voter/anonymous cannot delete votes', async () => {
    await assertFails(voterA.collection('votes').doc(eId).delete());
    await assertFails(anon.collection('votes').doc(eId).delete());
  });

  //  7. Normal authenticated user attempts to modify results/settings
  await test('7  voter cannot write settings or votes results', async () => {
    await assertFails(voterA.collection('settings').doc('resultsVisibility').set({ hideUntilClose: false }));
    await assertFails(voterA.collection('settings').doc('resultsVisibility').set({
      hideUntilClose: false, electionId: eId, updatedAt: now
    }));
    await assertFails(voterA.collection('votes').doc(eId).set({ totalVotes: 0, results: {} }));
  });

  //  8. Normal authenticated user attempts to become admin
  await test('8  voter cannot escalate role via profile doc or claims doc', async () => {
    await assertFails(voterA.collection('users').doc('voterA').update({ role: 'admin' }));
    await assertFails(voterA.collection('users').doc('voterA').set({ role: 'admin', email: 'a@test.dev' }));
    await assertFails(voterA.collection('settings').doc('roles').set({ voterA: 'admin' }));
  });

  //  9. Admin performs legitimate admin operations
  await test('9  admin CAN read all users (legit admin op)', async () => {
    await assertSucceeds(adminU.collection('users').get());
  });
  await test('9b admin CAN create valid positions', async () => {
    await assertSucceeds(adminU.collection('positions').doc('newpos').set({ electionId: eId, name: 'Treasurer', order: 2 }));
  });
  await test('9c admin CAN create valid candidates', async () => {
    await assertSucceeds(adminU.collection('candidates').doc('cand_new').set({
      electionId: eId, positionId: 'newpos', name: 'Caro',
      description: '', status: 'active', createdAt: now
    }));
  });
  await test('9d admin CAN read votes aggregate (results page)', async () => {
    await assertSucceeds(adminU.collection('votes').doc(eId).get());
  });

  // 10. Voter casts a legitimate vote (client cannot touch votes directly;
  //     the real cast is via the createVote Cloud Function)
  await test('10 voters CAN read their own profile + election + candidates then POST IS FUNCTION-SIDE', async () => {
    await assertSucceeds(voterA.collection('users').doc('voterA').get());
    await assertSucceeds(voterA.collection('elections').doc(eId).get());
    await assertSucceeds(voterA.collection('positions').where('electionId', '==', eId).get());
    await assertSucceeds(voterA.collection('candidates').where('electionId', '==', eId).get());
  });

  // 11. Voter attempts to vote twice  (server-side createVote guards this
  //     with the transaction; direct forged writes are blocked)
  await test('11 voter direct second-vote write blocked', async () => {
    await assertFails(voterA.collection('votes').doc(eId).set({ totalVotes: 4 }));
  });

  // 12. Two simultaneous vote requests  (function-level; rules prevent bypass)
  await test('12 concurrent direct vote writes blocked', async () => {
    const p1 = voterA.collection('votes').doc(eId).set({ totalVotes: 4 });
    const p2 = voterB.collection('votes').doc(eId).set({ totalVotes: 5 });
    await assertFails(Promise.all([p1, p2]));
  });

  // 13. Invalid candidate ID submitted
  await test('13 cannot write a vote referencing an invalid candidate (rules deny ALL vote writes)', async () => {
    await assertFails(voterA.collection('votes').doc(eId).set({ totalVotes: 1, results: { p0: { 'bogus': 1 } } }));
  });

  // 14. Candidate from another election submitted (direct vote write blocked)
  await test('14 direct vote with cross-election candidate blocked', async () => {
    await assertFails(voterA.collection('votes').doc(eId).set({
      totalVotes: 1,
      results: { [eId + '_0']: { cand_wrong_election: 1 } }
    }));
  });

  // 15. Invalid election ID submitted
  await test('15 direct write to a non-existent election vote doc blocked', async () => {
    await assertFails(voterA.collection('votes').doc('elect_does_not_exist').set({ totalVotes: 1 }));
  });

  // 16. Closed election receives a vote (direct write blocked)
  await test('16 direct vote write into closed election blocked', async () => {
    await assertFails(voterA.collection('votes').doc('elect_closed').set({ totalVotes: 1 }));
  });

  // 17. Missing required fields on candidate/position writes
  await test('17 admin candidate/position writes must have required typed fields', async () => {
    await assertFails(adminU.collection('candidates').doc('bad1').set({ electionId: eId, positionId: 'newpos' }));             // no name/status
    await assertFails(adminU.collection('positions').doc('bad2').set({ electionId: eId, name: 'X', order: 'high' }));           // order wrong type
    await assertFails(adminU.collection('candidates').doc('bad3').set({
      electionId: eId, positionId: 'newpos', name: 'X', status: 'bogus', createdAt: now
    }));                                                                                                                       // status not allowed
  });

  // 18. Unexpected fields on admin writes
  await test('18 admin positional writes reject unexpected/extra fields', async () => {
    await assertFails(adminU.collection('positions').doc('bad4').set({
      electionId: eId, name: 'X', order: 1, hackedScore: 1000
    }));
    await assertFails(adminU.collection('candidates').doc('bad5').set({
      electionId: eId, positionId: 'newpos', name: 'X', status: 'active', createdAt: now, secret: 'boom'
    }));
    await assertFails(adminU.collection('settings').doc('resultsVisibility').set({
      hideUntilClose: true, electionId: eId, updatedAt: now, evil: 1
    }));
  });

  // 19. Manipulated voter ID  (identity comes from the Auth token, uid is
  //     not client-controlled in any collection write)
  await test('19 voter cannot act as another uid (session uid fixed by Auth)', async () => {
    await assertFails(voterA.collection('users').doc('voterB').update({ voterId: 'VOT-HAX' }));
    await assertFails(voterA.collection('users').doc('voterB').collection('receipts').doc(eId).set({ receiptId: 'CUSCO-AAAAAA' }));
  });

  // 20. Manipulated election ID  (direct votes write blocked)
  await test('20 cannot forge a votes doc for a vetting election', async () => {
    await assertFails(voterA.collection('votes').doc('elect_fake').set({ totalVotes: 999 }));
  });

  // 21. Manipulated candidate ID  (direct votes write blocked)
  await test('21 cannot forge candidate tallies via votes writes', async () => {
    await assertFails(voterA.collection('votes').doc(eId).update({ 'results.x': { fake: 5 } }));
  });

  // 22. Direct API/function invocation bypassing the frontend
  await test('22 no client can write receipts (function-only)', async () => {
    await assertFails(voterA.collection('users').doc('voterA').collection('receipts').doc(eId).set({ receiptId: 'CUSCO-FAKE' }));
    await assertFails(adminU.collection('users').doc('voterA').collection('receipts').doc(eId).set({ receiptId: 'CUSCO-FAKE' }));
  });

  // 23. Rate-limit abuse  (enforced in the Cloud Functions layer, not rules;
  //     covered by functions code review + function tests)
  await test('23 [documented] rate limits live in Cloud Functions (createVote capped)', async () => {
    // Rules cannot express time-based windows; see functions/index.js RATE_LIMITS.
  });

  // 24. App Check failure  (enforced in Cloud Functions via verifyAppCheck;
  //     rules do not enforce App Check)
  await test('24 [documented] App Check is enforced at the functions layer', async () => {
    // Enabling `CUSCO_APPCHECK_ENFORCE=1` rejects calls without a token
    // inside the Cloud Functions; rules contradict nothing here.
  });

  // 25. Unauthorized result modification
  await test('25 results can only ever be written by the server (votes = false for all)', async () => {
    await assertFails(anon.collection('votes').doc(eId).set({ totalVotes: 1 }));
    await assertFails(voterA.collection('votes').doc(eId).set({ totalVotes: 1 }));
    await assertFails(adminU.collection('votes').doc(eId).set({ totalVotes: 1 }));
    await assertFails(adminU.collection('votes').doc(eId).update({ totalVotes: 1 }));
    await assertSucceeds(adminU.collection('votes').doc(eId).get()); // read-only for admins
  });

  // Extra hardening checks
  await test('X1 users + elections are server-write-only for admins too', async () => {
    await assertFails(adminU.collection('elections').doc(eId).update({ status: 'closed' }));
    await assertFails(adminU.collection('elections').doc('new_elec').set(ELECTION));
    await assertFails(adminU.collection('users').doc('voterA').update({ role: 'admin' }));
    await assertFails(adminU.collection('users').doc('adminU').update({ role: 'superadmin' }));
  });

  await test('X2 candidates binding keys are immutable on update', async () => {
    await assertSucceeds(adminU.collection('candidates').doc('cand_1_ok').update({ name: 'Alma Renamed' }));
    await assertFails(adminU.collection('candidates').doc('cand_1_ok').update({ electionId: 'elect_other' }));
    await assertFails(adminU.collection('candidates').doc('cand_1_ok').update({ positionId: 'other_pos' }));
    await assertSucceeds(adminU.collection('candidates').doc('cand_1_ok').update({ status: 'inactive' }));
  });

  await test('X3 positions binding keys are immutable on update', async () => {
    await assertSucceeds(adminU.collection('positions').doc('newpos').update({ name: 'Treasurer II' }));
    await assertFails(adminU.collection('positions').doc('newpos').update({ electionId: 'elect_other' }));
  });

  await test('X4 settings: only resultsVisibility is writable', async () => {
    await assertFails(adminU.collection('settings').doc('random').set({ x: 1 }));
  });

  await test('X5 unknown collections untouched by clients', async () => {
    await assertFails(voterA.collection('secrets').doc('k').get());
    await assertFails(voterA.collection('secrets').doc('k').set({ x: 1 }));
    await assertFails(anon.collection('anything').get());
  });

  await test('X7 voters read votes only after results release', async () => {
    await seedDb.collection('settings').doc('resultsVisibility').update({ hideUntilClose: false });
    await assertSucceeds(voterA.collection('votes').doc(eId).get());
    await seedDb.collection('settings').doc('resultsVisibility').update({ hideUntilClose: true });
    await assertFails(voterA.collection('votes').doc(eId).get());
  });

  await test('X6 studentList is admin only and validated', async () => {
    await assertFails(anon.collection('studentList').doc('ADM001').get());
    await assertFails(voterA.collection('studentList').doc('ADM001').get());
    await assertFails(voterA.collection('studentList').doc('ADM001').set({ admNumber: 'ADM001', fullName: 'Test', used: false }));
    await assertSucceeds(adminU.collection('studentList').doc('ADM001').set({
      admNumber: 'ADM001', fullName: 'Test Student', used: false, registeredUid: null, importedAt: now, importedBy: 'adminU'
    }));
    await assertFails(adminU.collection('studentList').doc('BAD').set({ admNumber: 'BAD' }));
    await assertSucceeds(adminU.collection('studentList').doc('ADM001').get());
  });

  // ------------------------------------------------------------------
  const pass = Object.values(results).filter((r) => r === 'PASS').length;
  const fail = Object.values(results).filter((r) => r === 'FAIL').length;
  console.log('\n=============================');
  console.log('RULES TESTS: ' + pass + ' passed, ' + fail + ' failed');
  console.log('=============================\n');
  await env.cleanup();
  await seedDb._settings_; // noop to appease linters
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) {
  console.error('fatal:', err);
  process.exit(1);
});