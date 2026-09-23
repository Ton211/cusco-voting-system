// =====================================================================
//  CUSCO Voting System — server-side Cloud Functions
//
//  These functions enforce the rules a normal web client must never be
//  able to break:
//    - make Admin SDK calls (using admin, which BYPASSES Firestore rules)
//    - create Auth accounts with a chosen role (custom claims)
//    - count one vote per voter per election atomically (transaction)
//    - keep ballots separate from voter identity
//
//  Region: default (us-central1). Keep this in sync with
//  FIREBASE_FUNCTIONS_REGION in js/firebase-config.js if you change it.
// =====================================================================

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();
const inc = admin.firestore.FieldValue.increment;
const serverNow = admin.firestore.FieldValue.serverTimestamp;

const ROLES = ['voter', 'admin', 'superadmin'];

// ---------------------------------------------------------------------
//  Optionally require a trusted App Check token on callable functions.
//
//  Default is OFF (lenient) so existing users cannot be locked out the
//  moment this function is deployed. Flip CUSCO_APPCHECK_ENFORCE=1 once
//  App Check is proving tokens for every installation (see README).
//
//  When ENFORCE is on, calls without a verified App Check token are
//  rejected. When off, failed App Check just increments a counter so you
//  can observe how many clients are still missing a token before you
//  flip enforcement on.
// ---------------------------------------------------------------------
const APPCHECK_ENFORCE = String(process.env.CUSCO_APPCHECK_ENFORCE || '0') === '1';

function verifyAppCheck(context) {
  const token = context.app && context.app.appCheckToken;
  if (token && token.appId) return true; // verified by the platform
  if (APPCHECK_ENFORCE) {
    throw HttpsError('failed-precondition', 'App Check verification required.');
  }
  return false;
}

// ---------------------------------------------------------------------
//  Lightweight in-memory rate limiting (per warm instance).
//
//  Cloud Functions scale horizontally, so this is a best-effort first
//  line of defense, not a bullet-proof distributed limiter. It is cheap,
//  dependency-free, and stops the common single-client hammering case.
//  For a hard distributed limit, wire up Redis/KV via secret config.
//
//  Locks are keyed by (fn, uid) for authenticated functions and
//  (fn, ip) for unauthenticated ones.
// ---------------------------------------------------------------------
const RATE_LIMITS = {
  createVote: { windowMs: 60 * 1000, max: 6 },
  registerUser: { windowMs: 60 * 60 * 1000, max: 10 },
  resetPassword: { windowMs: 60 * 60 * 1000, max: 15 },
  changeOwnPassword: { windowMs: 60 * 60 * 1000, max: 10 },
  importStudents: { windowMs: 60 * 60 * 1000, max: 20 },
  updateStudent: { windowMs: 60 * 60 * 1000, max: 60 },
  deleteStudent: { windowMs: 60 * 60 * 1000, max: 60 },
  selfRegisterVoter: { windowMs: 60 * 60 * 1000, max: 5 },
  setStaffAlias: { windowMs: 60 * 60 * 1000, max: 10 },
  resolveStaffUsername: { windowMs: 15 * 60 * 1000, max: 10 },
  setUserRole: { windowMs: 60 * 60 * 1000, max: 30 },
  saveElection: { windowMs: 60 * 60 * 1000, max: 60 },
  deleteElection: { windowMs: 60 * 60 * 1000, max: 30 },
  bootstrapSuperAdmin: { windowMs: 60 * 60 * 1000, max: 3 }
};

const rateBuckets = new Map();

function clientIp(context) {
  return (context.rawRequest && (context.rawRequest.ip || context.rawRequest.headers['x-forwarded-for'] || 'unknown')) || 'unknown';
}

function rateLimit(name, key) {
  const cfg = RATE_LIMITS[name];
  if (!cfg) return;
  const now = Date.now();
  const bucket = rateBuckets.get(name + ':' + key) || [];
  // Drop entries older than the window.
  while (bucket.length && bucket[0] <= now - cfg.windowMs) bucket.shift();
  if (bucket.length >= cfg.max) {
    throw HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
  }
  bucket.push(now);
  rateBuckets.set(name + ':' + key, bucket);
}

function HttpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

function requireAuth(context) {
  if (!context.auth) {
    throw HttpsError('unauthenticated', 'You must be signed in.');
  }
  return context.auth.uid;
}

function requireRole(context, roles) {
  requireAuth(context);
  const role = (context.auth.token && context.auth.token.role) || null;
  if (!ROLES.includes(role) || !roles.includes(role)) {
    throw HttpsError('permission-denied', 'You do not have permission to do that.');
  }
  return role;
}

function requireSuperAdmin(context) {
  const role = requireRole(context, ['superadmin']);
  if (role !== 'superadmin') {
    throw HttpsError('permission-denied', 'This action requires a Super Admin.');
  }
  return role;
}

function requireAdmin(context) {
  return requireRole(context, ['admin', 'superadmin']);
}

function randomToken(length) {
  return crypto.randomBytes(length).toString('hex').toUpperCase();
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeVoterId(voterId) {
  return String(voterId || '').trim().toUpperCase();
}

// Adm number is the student username. Stored upper-cased as voterId.
// Login accepts the adm number and maps it to a synthetic email so
// Firebase Auth (email + password) can be kept underneath.
function normalizeAdm(adm) {
  return String(adm || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Firestore document ids cannot contain slashes, but adm numbers can
// (e.g. IJCS/028.26C). The readable adm stays in the admNumber field;
// the doc id is the encoded form. Always use this for studentList refs.
function admDocId(adm) {
  return encodeURIComponent(normalizeAdm(adm));
}

function syntheticEmailForAdm(adm) {
  const norm = normalizeAdm(adm);
  const local = norm.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  return local + '@cusco.student';
}

function isSyntheticEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@cusco.student');
}

async function generateVoterId() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const vid = 'VOT-' + randomToken(3);
    const snap = await db.collection('users').where('voterId', '==', vid).limit(1).get();
    if (snap.empty) return vid;
  }
  return 'VOT-' + Date.now().toString(36).toUpperCase().slice(-5);
}

// ---------------------------------------------------------------------
//  registerUser
//  Admin registers a voter   (role = 'voter' or 'admin')
//  Super Admin may also create admins / super admins
// ---------------------------------------------------------------------
exports.registerUser = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('registerUser', context.auth ? context.auth.uid : clientIp(context));
  const callerRole = requireRole(context, ['admin', 'superadmin']);

  const role = data.role || 'voter';
  if (!ROLES.includes(role)) {
    throw HttpsError('invalid-argument', 'Invalid role.');
  }

  // A plain Admin may only create voters.
  if (role !== 'voter' && callerRole !== 'superadmin') {
    throw HttpsError('permission-denied', 'Only a Super Admin can create admin accounts.');
  }

  const fullName = String(data.fullName || '').trim();
  const phone = String(data.phone || '').trim();
  const gender = String(data.gender || '').trim();
  const emailInput = String(data.email || '').trim().toLowerCase();

  if (!fullName) throw HttpsError('invalid-argument', 'Full name is required.');

  // Adm number is required for voters and doubles as voterId + initial password.
  // Admins created by a superadmin may still use a plain email account.
  let voterId = normalizeAdm(data.voterId || data.admNumber || '');
  let email = emailInput;
  let emailIsSynthetic = false;
  let mustChangePassword = false;
  let password = String(data.password || '');

  if (role === 'voter') {
    if (!voterId) throw HttpsError('invalid-argument', 'Adm number is required.');
    if (voterId.length < 3) throw HttpsError('invalid-argument', 'Adm number looks too short.');
    const dup = await db.collection('users').where('voterId', '==', voterId).limit(1).get();
    if (!dup.empty) throw HttpsError('already-exists', 'That Adm number is already registered.');
    if (!email) {
      email = syntheticEmailForAdm(voterId);
      emailIsSynthetic = true;
    } else {
      if (!isValidEmail(email)) throw HttpsError('invalid-argument', 'A valid email is required.');
    }
    // First-time login uses the adm number as both username and password.
    // Stored upper-cased so first login works regardless of typed case.
    if (!password) password = normalizeAdm(data.voterId || data.admNumber || '');
    if (password.length < 6) {
      throw HttpsError('invalid-argument', 'Adm number must be at least 6 characters to serve as the first password, or supply a longer temporary password.');
    }
    mustChangePassword = true;
  } else {
    // Admin / superadmin accounts keep email login.
    if (!isValidEmail(email)) throw HttpsError('invalid-argument', 'A valid email is required.');
    if (password.length < 6) throw HttpsError('invalid-argument', 'Password must be at least 6 characters.');
    if (!voterId) voterId = await generateVoterId();
    else {
      const dup = await db.collection('users').where('voterId', '==', voterId).limit(1).get();
      if (!dup.empty) throw HttpsError('already-exists', 'That Voter ID is already in use.');
    }
  }

  let uid;
  try {
    const user = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: fullName
    });
    uid = user.uid;
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw HttpsError('already-exists', 'That email is already registered.');
    }
    throw HttpsError('internal', 'Could not create the account: ' + err.message);
  }

  try {
    // mustChangePassword rides in the token so login stays fast (no extra read).
    await admin.auth().setCustomUserClaims(uid, role === 'voter' ? { role: role, mustChangePassword: true } : { role: role });
    await db.collection('users').doc(uid).set({
      fullName: fullName,
      voterId: voterId,
      admNumber: role === 'voter' ? voterId : null,
      email: email,
      emailIsSynthetic: emailIsSynthetic,
      phone: phone,
      gender: gender,
      role: role,
      status: 'active',
      mustChangePassword: mustChangePassword,
      passwordChangedAt: null,
      createdAt: serverNow()
    });
  } catch (err) {
    // Roll back the Auth user if the profile write failed.
    admin.auth().deleteUser(uid).catch(function () {});
    throw HttpsError('internal', 'Could not finish registration: ' + err.message);
  }

  return { uid: uid, voterId: voterId, role: role, mustChangePassword: mustChangePassword };
});

// ---------------------------------------------------------------------
//  updateUser
//  Admin updates a voter/admin profile and can activate/deactivate
// ---------------------------------------------------------------------
exports.updateUser = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('updateUser', context.auth ? context.auth.uid : clientIp(context));
  const callerRole = requireRole(context, ['admin', 'superadmin']);
  const uid = String(data.uid || '');
  if (!uid) throw HttpsError('invalid-argument', 'User id is required.');

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw HttpsError('not-found', 'User not found.');
  const target = userDoc.data();

  // Only a Super Admin may modify a Super Admin.
  if (target.role === 'superadmin' && callerRole !== 'superadmin') {
    throw HttpsError('permission-denied', 'Only a Super Admin may modify another Super Admin.');
  }

  const updates = {};

  if (data.fullName !== undefined) updates.fullName = String(data.fullName).trim();
  if (data.phone !== undefined) updates.phone = String(data.phone).trim();
  if (data.gender !== undefined) updates.gender = String(data.gender).trim();

  if (data.email !== undefined) {
    const email = String(data.email).trim().toLowerCase();
    if (!isValidEmail(email)) throw HttpsError('invalid-argument', 'A valid email is required.');
    if (email !== target.email) {
      try {
        await admin.auth().updateUser(uid, { email: email });
      } catch (err) {
        if (err.code === 'auth/email-already-exists') {
          throw HttpsError('already-exists', 'That email is already in use.');
        }
        throw HttpsError('internal', 'Could not update the email: ' + err.message);
      }
      updates.email = email;
    }
  }

  if (data.status !== undefined) {
    const status = String(data.status).trim();
    if (!['active', 'inactive'].includes(status)) throw HttpsError('invalid-argument', 'Invalid status.');
    try {
      if (status === 'inactive') await admin.auth().updateUser(uid, { disabled: true });
      else await admin.auth().updateUser(uid, { disabled: false });
    } catch (err) {
      throw HttpsError('internal', 'Could not update account status: ' + err.message);
    }
    updates.status = status;
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = serverNow();
    await db.collection('users').doc(uid).update(updates);
  }

  return { ok: true };
});

// ---------------------------------------------------------------------
//  resetPassword
//  A plain Admin must not be able to reset a Super Admin's password
//  (that would be a silent account-takeover path).
// ---------------------------------------------------------------------
exports.resetPassword = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('resetPassword', context.auth ? context.auth.uid : clientIp(context));
  const callerRole = requireRole(context, ['admin', 'superadmin']);
  const uid = String(data.uid || '');
  const password = String(data.newPassword || '');
  if (!uid) throw HttpsError('invalid-argument', 'User id is required.');
  if (password.length < 6) throw HttpsError('invalid-argument', 'Password must be at least 6 characters.');

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw HttpsError('not-found', 'User not found.');
  const target = userDoc.data();

  // Super Admins may reset any user's password.
  // A plain Admin may NOT reset a Super Admin's password (prevents account takeover escalation).
  if (target.role === 'superadmin' && callerRole !== 'superadmin') {
    throw HttpsError('permission-denied', 'Only a Super Admin may reset another Super Admin\'s password.');
  }

  try {
    await admin.auth().updateUser(uid, { password: password });
  } catch (err) {
    throw HttpsError('not-found', 'User not found.');
  }
  // A voter whose password was reset by an admin must pick their own
  // password on next sign in. This keeps plaintext passwords out of the
  // admin panel: admins see only the status flag, never the password.
  if (target.role === 'voter') {
    await admin.auth().setCustomUserClaims(uid, { role: 'voter', mustChangePassword: true });
    await db.collection('users').doc(uid).update({
      mustChangePassword: true,
      passwordChangedAt: null,
      updatedAt: serverNow()
    });
  }
  return { ok: true };
});

// ---------------------------------------------------------------------
//  changeOwnPassword
//  Signed-in user sets their own password. Used for the mandatory
//  first-login password change (adm number -> own password).
// ---------------------------------------------------------------------
exports.changeOwnPassword = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  const uid = requireAuth(context);
  rateLimit('changeOwnPassword', uid);
  const newPassword = String(data.newPassword || '');
  if (newPassword.length < 6) throw HttpsError('invalid-argument', 'Password must be at least 6 characters.');

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw HttpsError('not-found', 'No voter profile found.');
  const profile = userDoc.data();
  if (profile.status !== 'active') throw HttpsError('failed-precondition', 'Your account is inactive.');

  // Do not allow reusing the adm number as the personal password.
  const adm = String(profile.admNumber || profile.voterId || '').trim();
  if (adm && newPassword.trim().toUpperCase() === adm.toUpperCase()) {
    throw HttpsError('invalid-argument', 'Pick a password different from your adm number.');
  }

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
  } catch (err) {
    throw HttpsError('internal', 'Could not update the password: ' + err.message);
  }
  // Refresh token claims too so the next page load skips the gate at once.
  await admin.auth().setCustomUserClaims(uid, { role: profile.role || 'voter', mustChangePassword: false });
  await db.collection('users').doc(uid).update({
    mustChangePassword: false,
    passwordChangedAt: serverNow(),
    updatedAt: serverNow()
  });
  return { ok: true };
});

// ---------------------------------------------------------------------
//  importStudents
//  Admin uploads the official student list (adm + full name). Students
//  can only self-register when their adm number is on this list.
// ---------------------------------------------------------------------
exports.importStudents = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('importStudents', context.auth ? context.auth.uid : clientIp(context));
  requireAdmin(context);

  const list = Array.isArray(data.students) ? data.students : null;
  if (!list || !list.length) throw HttpsError('invalid-argument', 'No students supplied.');
  if (list.length > 500) throw HttpsError('invalid-argument', 'Max 500 students per import.');

  const cleaned = [];
  const seen = new Set();
  for (const row of list) {
    const adm = normalizeAdm(row.admNumber || row.voterId || '');
    const fullName = String(row.fullName || row.name || '').trim();
    if (!adm || adm.length < 3 || adm.length > 20) {
      throw HttpsError('invalid-argument', 'Bad adm number: ' + String(row.admNumber || ''));
    }
    if (!fullName || fullName.length > 100) {
      throw HttpsError('invalid-argument', 'Missing name for adm: ' + adm);
    }
    if (seen.has(adm)) continue;
    seen.add(adm);
    cleaned.push({ adm: adm, fullName: fullName });
  }

  const refs = cleaned.map(function (r) { return db.collection('studentList').doc(admDocId(r.adm)); });
  const existing = await db.getAll.apply(db, refs);
  const batch = db.batch();
  let created = 0;
  let updated = 0;
  cleaned.forEach(function (r, i) {
    const snap = existing[i];
    const wasUsed = snap && snap.exists && snap.data().used === true;
    const wasUid = snap && snap.exists ? (snap.data().registeredUid || null) : null;
    if (snap && snap.exists) updated++;
    else created++;
    batch.set(refs[i], {
      admNumber: r.adm,
      fullName: r.fullName,
      importedAt: serverNow(),
      importedBy: context.auth.uid,
      used: wasUsed,
      registeredUid: wasUid
    }, { merge: true });
  });
  await batch.commit();
  return { created: created, updated: updated, total: cleaned.length };
});

// ---------------------------------------------------------------------
//  updateStudent / deleteStudent (admin only)
//  Adm number is the doc id and stays immutable; only the name is edited.
//  A listed student who already registered cannot be deleted (their login
//  account depends on the entry).
// ---------------------------------------------------------------------
exports.updateStudent = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('updateStudent', context.auth ? context.auth.uid : clientIp(context));
  requireAdmin(context);

  const adm = normalizeAdm(data.admNumber || '');
  const fullName = String(data.fullName || '').trim();
  if (!adm) throw HttpsError('invalid-argument', 'Adm number is required.');
  if (!fullName || fullName.length > 100) throw HttpsError('invalid-argument', 'Full name is required.');

  const ref = db.collection('studentList').doc(admDocId(adm));
  const snap = await ref.get();
  if (!snap.exists) throw HttpsError('not-found', 'Student not found.');
  await ref.set({ fullName: fullName }, { merge: true });
  return { ok: true };
});

exports.deleteStudent = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('deleteStudent', context.auth ? context.auth.uid : clientIp(context));
  requireAdmin(context);

  const adm = normalizeAdm(data.admNumber || '');
  if (!adm) throw HttpsError('invalid-argument', 'Adm number is required.');

  const ref = db.collection('studentList').doc(admDocId(adm));
  const snap = await ref.get();
  if (!snap.exists) throw HttpsError('not-found', 'Student not found.');
  const existing = snap.data();
  if (existing.used === true || existing.registeredUid) {
    throw HttpsError('failed-precondition', 'Already registered students cannot be removed from the list.');
  }
  await ref.delete();
  return { ok: true };
});

// ---------------------------------------------------------------------
//  selfRegisterVoter
//  Public self signup guarded by the admin-imported studentList.
//  Adm must exist on the list and must not already have an account.
// ---------------------------------------------------------------------
exports.selfRegisterVoter = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('selfRegisterVoter', context.auth ? context.auth.uid : clientIp(context));

  const rawAdm = String(data.admNumber || data.voterId || '').trim();
  const adm = normalizeAdm(rawAdm);
  if (!adm || adm.length < 3) throw HttpsError('invalid-argument', 'Enter your adm number.');

  const wlRef = db.collection('studentList').doc(admDocId(adm));
  const wlDoc = await wlRef.get();
  if (!wlDoc.exists) {
    throw HttpsError('not-found', 'Adm number not found. Please visit the admin office for registration.');
  }
  const wl = wlDoc.data();

  const dup = await db.collection('users').where('voterId', '==', adm).limit(1).get();
  if (!dup.empty) throw HttpsError('already-exists', 'Already registered. Please log in with your adm number.');

  if (rawAdm.length < 6 && adm.length < 6) {
    throw HttpsError('invalid-argument', 'This adm number is too short for first login. Please visit the admin office.');
  }

  const fullName = String(wl.fullName || '').trim() || 'Student ' + adm;
  const email = syntheticEmailForAdm(adm);
  const password = rawAdm;

  let uid;
  try {
    const user = await admin.auth().createUser({ email: email, password: password, displayName: fullName });
    uid = user.uid;
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw HttpsError('already-exists', 'Already registered. Please log in with your adm number.');
    }
    throw HttpsError('internal', 'Could not create the account: ' + err.message);
  }

  try {
    await admin.auth().setCustomUserClaims(uid, { role: 'voter', mustChangePassword: true });
    await db.collection('users').doc(uid).set({
      fullName: fullName,
      voterId: adm,
      admNumber: adm,
      email: email,
      emailIsSynthetic: true,
      phone: '',
      gender: '',
      role: 'voter',
      status: 'active',
      mustChangePassword: true,
      passwordChangedAt: null,
      selfRegistered: true,
      createdAt: serverNow()
    });
    await wlRef.set({ used: true, registeredUid: uid }, { merge: true });
  } catch (err) {
    admin.auth().deleteUser(uid).catch(function () {});
    throw HttpsError('internal', 'Could not finish registration: ' + err.message);
  }
  return { ok: true, admNumber: adm };
});

// ---------------------------------------------------------------------
//  setStaffAlias
//  Superadmin maps a staff username (e.g. CUSCO) to a staff Auth email.
//  Passwords are NEVER stored here: the password lives only in Firebase
//  Auth and is set via the Firebase console or resetPassword. This doc
//  only stores the username -> email mapping.
// ---------------------------------------------------------------------
exports.setStaffAlias = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('setStaffAlias', context.auth ? context.auth.uid : clientIp(context));
  requireSuperAdmin(context);

  const username = String(data.username || '').trim().toLowerCase();
  const email = String(data.email || '').trim().toLowerCase();
  if (!username || username.length < 3 || username.length > 30 || !/^[a-z0-9._-]+$/.test(username)) {
    throw HttpsError('invalid-argument', 'Username must be 3-30 chars: letters, numbers, dot, dash, underscore.');
  }
  if (!isValidEmail(email)) throw HttpsError('invalid-argument', 'A valid staff email is required.');

  // Target must be an existing admin/superadmin Auth user.
  let targetUser;
  try {
    targetUser = await admin.auth().getUserByEmail(email);
  } catch (err) {
    throw HttpsError('not-found', 'No Auth account exists for that email. Create it first.');
  }
  const targetDoc = await db.collection('users').doc(targetUser.uid).get();
  const targetRole = targetDoc.exists ? targetDoc.data().role : (targetUser.customClaims || {}).role;
  if (targetRole !== 'admin' && targetRole !== 'superadmin') {
    throw HttpsError('failed-precondition', 'Target account must be an admin or superadmin.');
  }

  await db.collection('settings').doc('staffAlias').collection('aliases').doc(username).set({
    username: username,
    email: email,
    uid: targetUser.uid,
    updatedAt: serverNow()
  });
  return { ok: true, username: username };
});

// ---------------------------------------------------------------------
//  resolveStaffUsername
//  Public, strictly rate-limited username -> email resolver for the
//  hidden staff portal. Returns a generic error to avoid enumerating
//  valid usernames. Password verification still happens via Firebase
//  Auth sign-in on the client.
// ---------------------------------------------------------------------
exports.resolveStaffUsername = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('resolveStaffUsername', clientIp(context));

  const username = String(data.username || '').trim().toLowerCase();
  if (!username || username.length < 3 || username.length > 30) {
    throw HttpsError('invalid-argument', 'Invalid staff credentials.');
  }
  const doc = await db.collection('settings').doc('staffAlias').collection('aliases').doc(username).get();
  if (!doc.exists) throw HttpsError('not-found', 'Invalid staff credentials.');
  return { email: doc.data().email };
});

// ---------------------------------------------------------------------
//  setUserRole  (Super Admin only) — used to grant/revoke admin powers
// ---------------------------------------------------------------------
exports.setUserRole = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('setUserRole', context.auth ? context.auth.uid : clientIp(context));
  requireSuperAdmin(context);
  const uid = String(data.uid || '');
  const role = String(data.role || '');
  if (!ROLES.includes(role)) throw HttpsError('invalid-argument', 'Invalid role.');
  if (!uid) throw HttpsError('invalid-argument', 'User id is required.');

  // Preserve the first-login flag inside the fresh claims.
  const before = await db.collection('users').doc(uid).get();
  const keepMust = before.exists && before.data().mustChangePassword === true;
  await admin.auth().setCustomUserClaims(uid, { role: role, mustChangePassword: keepMust });
  await db.collection('users').doc(uid).update({ role: role, updatedAt: serverNow() });

  // Role evolves immediately for the target user's next token refresh.
  return { ok: true };
});

// ---------------------------------------------------------------------
//  saveElection
//  Create or update an election. Only one election can be ACTIVE at a
//  time — opening one automatically closes any other active election.
// ---------------------------------------------------------------------
exports.saveElection = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('saveElection', context.auth ? context.auth.uid : clientIp(context));
  requireAdmin(context);

  const name = String(data.name || '').trim();
  if (!name) throw HttpsError('invalid-argument', 'Election name is required.');

  const status = String(data.status || 'draft').trim();
  if (!['draft', 'scheduled', 'active', 'closed'].includes(status)) {
    throw HttpsError('invalid-argument', 'Invalid status.');
  }

  const startTime = toTimestamp(data.startTimeISO);
  const endTime = toTimestamp(data.endTimeISO);
  if (!startTime || !endTime) throw HttpsError('invalid-argument', 'Valid start and end times are required.');
  if (endTime <= startTime) throw HttpsError('invalid-argument', 'End time must be after the start time.');

  const fields = {
    name: name,
    description: String(data.description || '').trim(),
    startTime: startTime,
    endTime: endTime,
    status: status,
    updatedAt: serverNow()
  };

  if (data.id) {
    const ref = db.collection('elections').doc(String(data.id));
    const existing = await ref.get();
    if (!existing.exists) throw HttpsError('not-found', 'Election not found.');
    await ref.update(fields);
    await applySingleActiveRule(String(data.id), status);
    return { id: String(data.id) };
  }

  fields.createdAt = serverNow();
  const ref = await db.collection('elections').add(fields);
  await applySingleActiveRule(ref.id, status);
  return { id: ref.id };
});

function toTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return admin.firestore.Timestamp.fromDate(d);
}

// ---------------------------------------------------------------------
//  deleteElection (admin only)
//  Removes the election plus its positions, candidates and aggregate
//  votes doc. Active elections cannot be deleted: close first.
// ---------------------------------------------------------------------
exports.deleteElection = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('deleteElection', context.auth ? context.auth.uid : clientIp(context));
  requireAdmin(context);

  const id = String(data.id || '');
  if (!id) throw HttpsError('invalid-argument', 'Election id is required.');

  const ref = db.collection('elections').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw HttpsError('not-found', 'Election not found.');
  if (snap.data().status === 'active') {
    throw HttpsError('failed-precondition', 'Close an active election before deleting it.');
  }

  const posSnap = await db.collection('positions').where('electionId', '==', id).get();
  const candSnap = await db.collection('candidates').where('electionId', '==', id).get();
  const batch = db.batch();
  batch.delete(ref);
  posSnap.docs.forEach(function (d) { batch.delete(d.ref); });
  candSnap.docs.forEach(function (d) { batch.delete(d.ref); });
  batch.delete(db.collection('votes').doc(id));
  await batch.commit();
  return { ok: true };
});

async function applySingleActiveRule(keepId, newStatus) {
  if (newStatus !== 'active') return;

  const activeSnap = await db.collection('elections').where('status', '==', 'active').get();
  const toClose = activeSnap.docs.filter(function (doc) { return doc.id !== keepId; });
  if (!toClose.length) return;

  const batch = db.batch();
  toClose.forEach(function (doc) {
    batch.update(doc.ref, { status: 'closed', updatedAt: serverNow() });
  });
  await batch.commit();
}

// ---------------------------------------------------------------------
//  createVote  —  the secure one-person/one-vote transaction
//
//  Runs entirely server-side in a Firestore transaction so a voter can
//  never vote twice, even with multiple tabs, scripts or direct writes.
//  The ballot is recorded ONLY as anonymised aggregate counts. A receipt
//  is stored on the voter's profile that proves a vote was recorded but
//  does not reveal the choices.
// ---------------------------------------------------------------------
exports.createVote = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  const uid = requireAuth(context);
  rateLimit('createVote', uid);
  if (!data || typeof data !== 'object') throw HttpsError('invalid-argument', 'Invalid payload.');
  if (Object.keys(data).filter(function (k) { return !['electionId', 'ballot'].includes(k); }).length) {
    throw HttpsError('invalid-argument', 'Unexpected fields are not allowed.');
  }

  const electionId = String(data.electionId || '');

  if (!electionId) throw HttpsError('invalid-argument', 'Election id is required.');
  if (!data.ballot || typeof data.ballot !== 'object' || !Object.keys(data.ballot).length) {
    throw HttpsError('invalid-argument', 'A ballot is required.');
  }

  const userRef = db.collection('users').doc(uid);
  const electionRef = db.collection('elections').doc(electionId);

  const result = await db.runTransaction(async (tx) => {
    // ----- voter checks ---------------------------------------------
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw HttpsError('not-found', 'No voter profile found.');
    const user = userDoc.data();

    if (user.role !== 'voter') throw HttpsError('permission-denied', 'Only voters may cast a vote.');
    if (user.status !== 'active') throw HttpsError('failed-precondition', 'Your account is inactive.');
    if (user.votedIn && user.votedIn[electionId]) {
      throw HttpsError('already-exists', 'You have already voted in this election.');
    }

    // ----- election checks ------------------------------------------
    const electionDoc = await tx.get(electionRef);
    if (!electionDoc.exists) throw HttpsError('not-found', 'Election not found.');
    const election = electionDoc.data();

    if (election.status !== 'active') throw HttpsError('failed-precondition', 'This election is not open for voting.');
    const now = Date.now();
    const startMs = election.startTime ? election.startTime.toMillis() : 0;
    const endMs = election.endTime ? election.endTime.toMillis() : Infinity;
    if (now < startMs) throw HttpsError('failed-precondition', 'This election has not started yet.');
    if (now > endMs) throw HttpsError('failed-precondition', 'This election has closed.');

    // ----- position / candidate validation --------------------------
    // Sorted in code so voting never waits on a composite index.
    const positionsSnap = await tx.get(
      db.collection('positions').where('electionId', '==', electionId)
    );
    const positions = positionsSnap.docs.slice().sort(function (a, b) {
      return (a.data().order || 0) - (b.data().order || 0);
    });
    if (!positions.length) throw HttpsError('failed-precondition', 'No ballot positions defined.');

    const validPositionIds = new Set(positions.map(function (p) { return p.id; }));
    const ballotKeys = Object.keys(data.ballot);
    if (ballotKeys.length !== positions.length) throw HttpsError('invalid-argument', 'Your ballot is incomplete.');

    for (const posId of ballotKeys) {
      if (!validPositionIds.has(posId)) throw HttpsError('invalid-argument', 'Ballot contains an invalid position.');

      const candidateId = String(data.ballot[posId]);
      if (!candidateId) throw HttpsError('invalid-argument', 'A ballot entry is empty.');
      const candDoc = await tx.get(db.collection('candidates').doc(candidateId));
      if (!candDoc.exists) throw HttpsError('invalid-argument', 'A selected candidate no longer exists.');
      const cand = candDoc.data();
      if (cand.electionId !== electionId || cand.positionId !== posId || cand.status !== 'active') {
        throw HttpsError('invalid-argument', 'A selected candidate is not eligible in this election.');
      }
    }

    // ----- record the anonymised vote -------------------------------
    // Nested maps (NOT dotted keys): set() stores dots literally,
    // only update() parses them as paths.
    const voteRef = db.collection('votes').doc(electionId);
    const aggregate = {
      totalVotes: inc(1),
      updatedAt: serverNow(),
      results: {}
    };
    positions.forEach(function (pos) {
      const candId = String(data.ballot[pos.id]);
      if (!aggregate.results[pos.id]) aggregate.results[pos.id] = {};
      aggregate.results[pos.id][candId] = inc(1);
    });
    tx.set(voteRef, aggregate, { merge: true });

    // ----- receipt (proves the vote, reveals nothing about choice) ---
    const receiptId = 'CUSCO-' + randomToken(3);

    // Flag the voter for THIS election only (allows future elections).
    tx.update(userRef, {
      ['votedIn.' + electionId]: true,
      lastVotedAt: serverNow()
    });

    tx.set(userRef.collection('receipts').doc(electionId), {
      electionId: electionId,
      receiptId: receiptId,
      createdAt: serverNow()
    });

    return { receiptId: receiptId };
  });

  return result;
});

// ---------------------------------------------------------------------
//  bootstrapSuperAdmin
//  One-time call to create the very first Super Admin. Safe because it
//  refuses to run once a Super Admin already exists.
// ---------------------------------------------------------------------
exports.bootstrapSuperAdmin = functions.https.onCall(async (data, context) => {
  verifyAppCheck(context);
  rateLimit('bootstrapSuperAdmin', clientIp(context));
  const existing = await db.collection('users').where('role', '==', 'superadmin').limit(1).get();
  if (!existing.empty) {
    throw HttpsError('already-exists', 'A Super Admin already exists. Bootstrap is only for the first account.');
  }

  const fullName = String(data.fullName || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  const phone = String(data.phone || '').trim();
  const gender = String(data.gender || '').trim();

  if (!fullName) throw HttpsError('invalid-argument', 'Full name is required.');
  if (!isValidEmail(email)) throw HttpsError('invalid-argument', 'A valid email is required.');
  if (password.length < 6) throw HttpsError('invalid-argument', 'Password must be at least 6 characters.');

  let uid;
  try {
    const user = await admin.auth().createUser({ email: email, password: password, displayName: fullName });
    uid = user.uid;
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw HttpsError('already-exists', 'That email is already registered.');
    }
    throw HttpsError('internal', 'Could not create the account: ' + err.message);
  }

  const voterId = await generateVoterId();
  await admin.auth().setCustomUserClaims(uid, { role: 'superadmin' });
  await db.collection('users').doc(uid).set({
    fullName: fullName,
    voterId: voterId,
    email: email,
    phone: phone,
    gender: gender,
    role: 'superadmin',
    status: 'active',
    createdAt: serverNow()
  });

  return { uid: uid };
});