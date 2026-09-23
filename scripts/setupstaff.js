// Setup helper: create staff Auth user + username alias.
// Secrets are NEVER hardcoded here. Values come from env vars or prompts.
// Needs a service account key pointed by GOOGLE_APPLICATION_CREDENTIALS.
// Usage (PowerShell):
//   $env:STAFF_EMAIL="staff@example.org"
//   $env:STAFF_USERNAME="cusco"
//   $env:STAFF_PASSWORD="use-a-strong-password-once"
//   $env:STAFF_NAME="CUSCO"
//   node scripts/setup-staff.js
const admin = require('firebase-admin');
const readline = require('readline');

function ask(q, hide) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(function (resolve) {
    if (!hide) {
      rl.question(q, function (a) { rl.close(); resolve(a); });
    } else {
      // Simple hidden prompt (no echo on most terminals is complex; read normally).
      rl.question(q, function (a) { rl.close(); resolve(a); });
    }
  });
}

async function main() {
  let email = process.env.STAFF_EMAIL || '';
  let username = (process.env.STAFF_USERNAME || '').toLowerCase();
  let password = process.env.STAFF_PASSWORD || '';
  let name = process.env.STAFF_NAME || 'CUSCO';

  if (!email) email = String(await ask('Staff email: ')).trim().toLowerCase();
  if (!username) username = String(await ask('Staff username [cusco]: ')).trim().toLowerCase() || 'cusco';
  if (!password) password = String(await ask('Temp staff password (typed only here, never saved): ', true)).trim();
  if (!name) name = 'CUSCO';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Give a valid staff email.');
  if (!/^[a-z0-9._-]+$/.test(username) || username.length < 3) throw new Error('Bad username.');
  if (password.length < 6) throw new Error('Password must be 6+ chars.');

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to your service account key first.');
  }
  admin.initializeApp();
  const db = admin.firestore();

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: password, displayName: name });
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      user = await admin.auth().createUser({ email: email, password: password, displayName: name });
    } else throw e;
  }
  await admin.auth().setCustomUserClaims(user.uid, { role: 'superadmin' });
  await db.collection('users').doc(user.uid).set({
    fullName: name,
    voterId: 'STAFF',
    email: email,
    role: 'superadmin',
    status: 'active',
    mustChangePassword: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection('settings').doc('staffAlias').collection('aliases').doc(username).set({
    username: username,
    email: email,
    uid: user.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log('OK. Alias set: ' + username + ' -> ' + email);
  console.log('Sign in at /sys/cuscostaff9f2k41.html with the username plus the password you just typed.');
}

main().catch(function (e) { console.error('FAILED: ' + e.message); process.exit(1); });
