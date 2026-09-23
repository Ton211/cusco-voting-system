# CUSCO Voting System — Security Audit

Written from a full source inspection (frontend, Cloud Functions, Firestore rules,
Storage rules, indexes, config, deps). Not a statement of "everything is secure" —
it is a record of what exists, what is verified safe, and what is not.

Date of audit: 2026-09-18.

---

## 1. Current architecture

- **Frontend**: Plain HTML/CSS/JS (no build step). Firebase **compat SDK 10.12.2**
  loaded from `www.gstatic.com` via CDN `<script>` tags on every page.
- **Hosting**: Static site intended for **Cloudflare Pages** (README). Local dev
  via `scripts/static-server.js` (`npm start`).
- **Backend**: Firebase project `cusco-voting-2026`; Cloud Functions in
  `functions/index.js` (nodejs22, deployed: `bootstrapSuperAdmin`, `createVote`,
  `registerUser`, `resetPassword`, `saveElection`, `setUserRole`, `updateUser`).
- **Auth**: Firebase Auth, Email/Password only. Roles live in **Auth custom claims**
  (`voter` | `admin` | `superadmin`), also mirrored into the `users/{uid}` doc.
- **Data**: Firestore. Candidate photos in Firebase Storage.
- **Pages**:
  - Public: `index.html`, `login.html` (voter), `sys/portal.html` (hidden staff login)
  - Admin: `admin/{dashboard,voters,candidates,elections,results}.html`
  - Voter: `voter/{dashboard,vote,review,success}.html`

### Firestore collections

| Collection | Document shape (observed) |
|---|---|
| `users/{uid}` | fullName, voterId, email, phone, gender, role, status, votedIn (map), lastVotedAt, createdAt, updatedAt |
| `users/{uid}/receipts/{electionId}` | electionId, receiptId (`CUSCO-XXXXXX`), createdAt |
| `elections/{electionId}` | name, description, startTime, endTime, status (draft/scheduled/active/closed), createdAt, updatedAt |
| `positions/{positionId}` | electionId, name, order (positionId = `{electionId}_{n}`) |
| `candidates/{candidateId}` | electionId, positionId, name, photo (storage URL), description, status, createdAt |
| `votes/{electionId}` | totalVotes, results.{positionId}.{candidateId}, updatedAt (aggregates only) |
| `settings/resultsVisibility` | hideUntilClose, electionId, updatedAt |

---

## 2. Who can read / write each collection (AS DEPLOYED)

Source of truth: `firestore.rules` (deployed via `firebase.json`), plus each
client call site verified in `js/`.

| Collection | Read | Write | Verified shift of responsibility |
|---|---|---|---|
| `users/{uid}` | owner or admin | create: superadmin; update: admin; delete: superadmin | **Admins can edit any user doc directly (any field)** |
| `users/*/receipts` | owner or admin | `false` (function only) | Good |
| `elections` | any signed-in | admin | Frontend writes elections ONLY via `saveElection` function |
| `positions` | any signed-in | admin | Frontend writes positions directly (batch) in `elections.js` |
| `candidates` | any signed-in | admin | Frontend writes candidates directly (`candidates.js`) |
| `votes` | admin only | `false` (function only) | **Good — clients can never write votes** |
| `settings` | any signed-in | admin | Frontend writes settings directly (`results.js`) |
| anything else | `false` | `false` | Global deny-all catch-all |

Storage: `candidate-photos/*` read = any signed-in, write = admin. No content/size validation.

---

## 3. Cloud Functions (what each does)

| Function | Trigger | Authz | Notes |
|---|---|---|---|
| `registerUser` | callable | admin/superadmin; only superadmin can mint admin/superadmin | Creates Auth user + claims + profile. Rollback on failure. |
| `updateUser` | callable | admin/superadmin; superadmin targets protected | email, fullName, phone, gender, status (disables Auth account). |
| `resetPassword` | callable | **any admin** | **No superadmin-target guard (see High #5)** |
| `setUserRole` | callable | superadmin only | Sets claims + profile role. |
| `saveElection` | callable | admin/superadmin | Validates name/status/times; enforces *one active election* via post-write close. |
| `createVote` | callable | any authenticated; **voter + active** | Full Firestore **transaction**; server-side one-vote enforcement; aggregate counting; receipt. |
| `bootstrapSuperAdmin` | callable | none (by design) | Refuses to run once a superadmin exists. Inert because auto admin exists — re-check only on fresh DB. |

### createVote — what it actually does (verified in code)

1. `requireAuth` → uid from ID token.
2. Reads `users/{uid}` in the transaction: must exist, `role==='voter'`,
   `status==='active'`, `votedIn[ electionId ]` unset.
3. Reads `elections/{electionId}` in the transaction: must exist,
   `status==='active'`, now inside `[startTime, endTime]`.
4. Loads `positions` for that election, ordered; **ballot key set must match the
   position set exactly** (no extra/missing keys).
5. For every (position → candidate): candidate doc exists, `electionId`,
   `positionId`, `status==='active'` all match.
6. Writes `votes/{electionId}` with `totalVotes: increment(1)` and per-candidate
   `results.<pos>.<cand>` increments (atomically in the transaction).
7. Flags `users/{uid}/votedIn.<electionId> = true`, writes a receipt.
8. Returns server-generated `receiptId`.

This is the correct pattern (server-authoritative, transactional). It does NOT
trust frontend state, disabled buttons, or storage.

---

## 4. Existing security controls (verified)

1. **Votes are client-unwritable** (`allow write: if false`). ✔
2. **`createVote` runs in a Firestore transaction** with eligibility, election
   window, candidate-scope and duplicate-vote checks. ✔
3. **Roles are Auth custom claims**; rules and functions read `request.auth.token.role`
   / `context.auth.token.role`, never client-provided role. ✔
4. **`votes` readable by admin only**; voters never see totals. ✔
5. **Receipts** are owner/admin-readable only and never link a vote to identity. ✔
6. **Global catch-all deny rule**. ✔
7. **`bootstrapSuperAdmin` (classic foot-gun) refuses once a superadmin exists**;
   one already exists in the project. ✔ (with fresh-DB caveat below)
8. **User updates surfaced through `updateUser`** (deactivation also disables the
   Auth account) and the UI uses it. ✔
9. Frontend XSS hygiene: all dynamic HTML uses `esc()` (utils.js). Edits received
   no XSS red flags in this pass.

---

## 5. Vulnerabilities

### Critical

- **C1 — Admin can tamper with `users` directly via rules.** `allow update: if
  isAdmin()` permits an admin to set *any* field on *any* user doc: mark a voter as
  already-voted (`votedIn`), clear the flag to allow a repeat ballot forged through
  a second path, change `status`, or rewrite the mirrored `role` field. Claims still
  gate real access, but the profile doc is used as a client-side fallback and as the
  voter-voted indicator (`isElectionOpen`/vote page read it), so integrity is broken.
  **Fix**: make `users` and `users/*/receipts` server-write-only in rules (the
  frontend already performs all user mutations via functions).

- **C2 — `resetPassword` lets any Admin reset a Super Admin's password.** A plain
  `admin` can call `resetPassword(uid=superadminUid, newPassword=...)` and take over
  the account (an attacker who compromises one admin account escalates to
  superadmin). `updateUser` protects superadmin targets; `resetPassword` does not.
  **Fix**: mirror the target-role guard in `resetPassword`.

### High

- **H1 — `positions` / `candidates` / `settings` accept any admin write with no
  schema validation.** Rules do not constrain field types, allowed keys, or that a
  candidate's `positionId` actually belongs to its `electionId`. Writes by a
  compromised admin can corrupt ballots (e.g., point a candidate at the wrong
  position, drop an election into two simultaneous "active" states through a direct
  `elections` write that bypasses `saveElection`'s single-active close). **Fix**:
  add `isAdmin()` + structural validation (`hasOnly`, type checks), require that
  direct `elections` writes are impossible by making `elections` server-write-only
  (the frontend already uses `saveElection`), and use rule-level `get()` to
  cross-check candidate → position → election.

- **H2 — No App Check anywhere.** Any client can call callable functions /
  Firestore (with stolen Auth creds) without proving it is the real app. This is
  the main missing defense for scripted abuse and credential replay. **Fix**: add
  App Check (web debug mode first, enforcement documented, never lock out users
  before it works).

- **H3 — No rate limiting on any callable.** `createVote`, `registerUser`,
  `resetPassword`, `bootstrapSuperAdmin` can be hammered (cost/denial-of-wallet,
  spam account creation). **Fix**: lightweight per-instance throttling in Cloud
  Functions + document App Check as the proper long-term control.

- **H4 — Multiple active elections possible via direct `elections` write.** Rules
  `allow write: if isAdmin()` let an admin bypass `saveElection`'s
  `applySingleActiveRule`. Only the function centralises the invariant.
  **Fix**: `elections` server-write-only in rules (part of the same change as C1).

- **H5 — Uploaded candidate-photo files are unvalidated server-side.**
  Client code checks size (2 MB) and extension, but Storage rules do not constrain
  content-type/size; an arbitrary file (e.g., an HTML/SVG shell) stored under
  `candidate-photos/` is served to every signed-in user and rendered in
  `<img src=...>`. **Fix**: storage rules on content-type, size, path.

### Medium

- **M1 — Result visibility setting is a single doc read by any signed-in user.**
  `settings/resultsVisibility` is readable by voters (harmless today — it is
  only used by the admin UI), but it exposes `hideUntilClose` state. Low sensitivity;
  tightening to owner/admin would be non-breaking.
- **M2 — `auth-guard.js` fallback trusts mirrored `role` in the profile doc.**
  If custom claims are missing, the guard falls back to `users/{uid}.role` for UI
  routing. Real authorization never depends on it (rules/functions use claims), but
  the fallback can show the admin UI to a voter whose doc says "admin" — actions then
  fail server-side. Keep, but note it is cosmetic, not authorization. (Immutable once
  `users` becomes server-write-only.)
- **M3 — `bootstrapSuperAdmin` is unauthenticated and unthrottled.** Inert today
  (superadmin exists), but on a freshly-created/erased DB anyone could self-bootstrap
  a superadmin before the real operator runs setup. Rate-limit + App Check gate it.
- **M4 — Error messages leak fine-grained state.** `createVote` returns
  distinguishable errors ("not open", "already voted", candidates invalid), and
  `friendlyError` forwards some function messages. Useful for users; combined with
  enumeration this is minor. Acceptable, but keep messages generic enough not to
  expose internal IDs.
- **M5 — No Cloud Storage rules coverage**, no `storage.rules` content checks.
- **M6 — Debug/log files and local artifacts present in the repo root**
  (`emu-err.log`, `emu-out.log`, `firestore-debug.log`). `*.log` is gitignored, but
  they should be removed from the working tree and not deployed.

### Low

- **L1 — No CSP / security headers** (`X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, CSP) for Cloudflare Pages (no `_headers`) or the dev server.
- **L2 — README describes `scripts/dev.js` / `npm run bootstrap` / hosting emulator
  flows that no longer exist** (only `scripts/static-server.js` exists). Docs drift.
- **L3 — `.gitignore` does not cover service-account JSON, env files, or exported
  auth dumps.**
- **L4 — `friendlyError` exposes the "functions not deployed" path.** Minor.
- **L5 — SDK versions**: `firebase-admin@12.7.0`, `firebase-functions@4.9.0`
  (resolved). Both current gen; no known *critical* vuln flagged here, but they
  should be tracked. Frontend pins Firebase 10.12.2.
- **L6 — Dev server has no security headers and no HTTPS.** Cloudflare Pages
  terminates TLS in prod; the local static server is plain HTTP (fine for localhost).

---

## 6. Attack surfaces (summary)

1. Callable functions (direct invocation, creds replay, flooding).
2. Direct Firestore reads/writes by authenticated clients.
3. Storage direct writes/uploads.
4. Static-site delivery (CSP/headers, XSS via stored photo URLs).
5. Admin-console UI (compromised admin → election/ballot tampering).
6. Voter ballot integrity (handled server-side by `createVote`).
7. Credentials (password reset, account takeover, logout/session).

---

## 7. Recommended fixes (by priority)

1. **Park `users` + `receipts` + `elections` as server-write-only** in
   `firestore.rules` (kills C1, H4, closes M2's integrity half). Frontend already
   uses functions for these — verify with the test suite.
2. **Guard superadmin targets in `resetPassword`** (fixes C2).
3. **Schema-validate client-writable collections** (`positions`, `candidates`,
   `settings`) in rules + cross-doc `get()` checks (H1).
4. **App Check** wiring in the frontend + rules/function gating, enabled only after
   verification (H2).
5. **Rate limiting** in Cloud Functions for `createVote`, `registerUser`,
   `resetPassword`, `bootstrapSuperAdmin` (H3).
6. **Storage rules**: constrain `candidate-photos` by size + content-type (H5).
7. **`_headers` (+ CSP) for Cloudflare Pages** and mirror on the dev server (L1).
8. **Cleanup**: remove debug logs, add `.gitignore` entries (M6/L3), refresh README
   drift (L2).
9. **Tests** (emulator): rules coverage + function-level abuse tests from Phase 13.

---

## 8. Files that will change

| File | Change |
|---|---|
| `firestore.rules` | collections → server-only; add validation helpers |
| `functions/index.js` | resetPassword guard; rate limiter; App Check gate |
| `js/firebase-config.js` | App Check provider config (debug token switch) |
| `js/firebase-init.js` | App Check init |
| `sys/portal.html`, all pages | CSP-safe inline script extraction + App Check script tag |
| `storage.rules` | content-type / size / path validation |
| `_headers` (new) | security headers + CSP |
| `.gitignore` | service accounts, env, exports, logs |
| `scripts/static-server.js` | add security headers for local parity |
| `package.json` | dev deps for rules testing |
| `tests/*` (new) | rules + function security tests |

## 9. Changes that could break existing functionality

- Making `users`/`elections` server-write-only **breaks any legacy admin page that
  writes those collections directly**. Verified: admin pages mutate users only via
  functions and elections only via `saveElection`. The **rules test suite** must
  confirm this before deploy, or the admin UI will silently fail.
- CSP `script-src` without `'unsafe-inline'` **blocks inline scripts currently in
  `sys/portal.html`**; that inline script must be moved to a JS file first.
- `candidate-photos` content-type restriction will reject uploads whose MIME type
  the browser reports as `application/octet-stream`; acceptable (image/* accept
  filter already present).
- App Check, if enabled incorrectly, **locks out real users** — it must ship
  gated/debug and be proven before enforcement.

---

*See `PRODUCTION_SECURITY_REPORT.md` for the post-fix status.*