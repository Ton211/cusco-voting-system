# CUSCO Voting System — MVP

A plain HTML/CSS/JS voting system on **Firebase** (Auth + Firestore + Storage +
Cloud Functions), hosted on **Cloudflare Pages**.

- One election active at a time
- One vote per voter per election — enforced **server-side** in a Firestore
  transaction (a voter cannot vote twice, even with scripts or extra tabs)
- Ballots are recorded as **anonymised aggregates**; voter identities are never
  linked to choices. Voters get a **reference number** that proves their vote
  was recorded without revealing *who* they voted for
- Three roles: **Super Admin**, **Admin**, **Voter** (via Auth custom claims)

## Project structure

```
/
├── index.html                 Landing
├── login.html                 Voter sign-in (email + password)
├── sys/cuscostaff9f2k41.html            Hidden staff sign-in (admins only, unadvertised)
├── package.json               npm start — local static server
├── scripts/
│   └── static-server.js       Zero-dependency dev server (free port)
├── css/style.css
├── js/
│   ├── firebase-config.js     <- PUT YOUR FIREBASE CONFIG HERE (when ready)
│   ├── firebase-init.js
│   ├── utils.js
│   ├── auth-guard.js          Role-based page access
│   ├── login.js
│   ├── admin-common.js
│   ├── voter-common.js
│   ├── admin/*.js
│   └── voter/*.js
├── admin/                     dashboard, voters, candidates, elections, results
├── voter/                     dashboard, vote, review, success
├── functions/
│   └── index.js               User lifecycle + secure createVote transaction
├── firestore.rules
├── storage.rules
├── firestore.indexes.json
└── firebase.json              Deploy config (rules + functions)
```

## Quick start — view the site (no Firebase needed)

```bash
npm install    # nothing to install for the frontend — it's pure HTML/CSS/JS
npm start      # serves the site on the first free port starting at 8080
```

`npm start` picks a free port automatically and prints the URL (usually
`http://localhost:8080`). The pages render, but **login/voting requires
Firebase**, which is not configured yet — set that up in section 1 whenever
you're ready.

## 1. Firebase setup (do this when you're ready)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   create a project.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → Create in production mode.
4. **Storage** → Create (default rules).
5. **Project settings → Your apps → Register app → Web** (</>).
   Copy the config object into `js/firebase-config.js`.
6. Upgrade to the **Blaze (pay-as-you-go) plan** — required for Cloud Functions.

To test against the local emulator suite later, see the commented block in
`js/firebase-init.js` (open pages with `?emulator=1` to activate it).

## 2. Install the Firebase CLI (when deploying)

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your real project
cd functions && npm install && cd ..
```

## 3. Deploy rules + backend

```bash
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only functions
```

## 4. Create the first Super Admin

No one has admin powers yet, so use the one-time `bootstrapSuperAdmin` function.
Simplest option — **Firebase console → Cloud Functions → `bootstrapSuperAdmin`
→ “Run pod”/TEST** (it does not require a signed-in caller; it is safe because
it refuses to run once any Super Admin exists).

Alternative — a one-off script using the Admin SDK directly (same logic):
create the Auth user, `setCustomUserClaims(uid, { role: 'superadmin' })`, then
write the `users/{uid}` document (`role: 'superadmin'`, `status: 'active'`).

Afterwards, use the Voters page (as Super Admin) to create **Admins** and
**Voters**, and call `setUserRole` if you ever need to grant/revoke roles.

## 5. The daily flow

1. **Admin → Elections** — create an election (name, window, status) and add
   ballot positions (President, Secretary, …).
2. **Admin → Candidates** — register candidates per position + photo.
3. **Admin → Voters** — register voters (emails + password). A Voter ID is
   auto-generated.
4. **Admin → Elections → Open** — voter sign-in opens the ballot.
5. **Voter → login** (their email + password) → *Start Voting* → select →
   *Review* → *Submit Vote* → reference number shown.
   **Admins sign in through the hidden staff portal** at
   `sys/cuscostaff9f2k41.html` — it is never linked from the public pages, and the
   public voter login rejects staff accounts.
6. **Admin → Results** — per-position counts, total votes, turnout.

## 6. Hosting on Cloudflare Pages

```bash
git init && git add . && git commit -m "MVP"
# push to a GitHub repo, then:
# Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
# Build command: (none)   →  Output directory: /   (static site root)
```

If you open the site later, remember **outbound requests from Cloudflare Pages /
the voters’ browsers go straight to the Firebase SDK endpoints** — you do not
need Firebase Hosting.

## 7. Security model (what is protected how)

| Threat | Protection |
|---|---|
| Voter votes twice | `createVote` Cloud Function runs inside a **Firestore transaction** that checks `votedIn`; the votes doc is **client-unwritable** in rules |
| Voter reads all voters | Rules: users are readable only by the owner or an admin |
| Voter reads vote totals | Rules: `votes` is read+write blocked for non-admins |
| Voter modifies candidates / elections / votes / own `votedIn` | Rules block every non-admin write; `votes` is entirely client-write-blocked |
| Admin forges votes | `votes` writes are `false` for *everyone* — only the Admin SDK (functions) can touch them |
| Voter changes their own role | Roles live in **Auth custom claims** (not in the profile doc); a voter cannot update claims |
| Ballot leak to admins | Only aggregate counts are stored. Receipts link voter → election, never voter → choice |
| Inactive account votes | Function rejects `status !== 'active'`; deactivation also disables the Auth account |
| Admin login path guessed | Admin sign-in lives at an **unadvertised** staff URL (`sys/cuscostaff9f2k41.html`); the public login page steers staff away, and admin routes serve no login form directly |

## 8. Local development (npm)

```bash
npm install
npm start        # full emulator stack + the static site
```

No `firebase init` needed — everything is already wired in `firebase.json`,
`scripts/dev.js` (auto free-port selection) and `js/firebase-init.js` (auto
emulator routing). Relevant npm scripts:

| Command | What it does |
|---|---|
| `npm start` | boots Auth, Firestore, Storage, Functions + Hosting on the first **free** ports |
| `npm run bootstrap` | creates the first Super Admin, using the ports from `npm start` |
| `npm run serve` | alias for `npm start` |
| `npm run deploy:rules` | pushes Firestore + Storage rules |
| `npm run deploy:functions` | deploys the Cloud Functions |

## 9. Out of scope for the MVP (future work)

SMS OTP, mobile app, multiple simultaneous elections, multiple organisations,
live public results, biometrics, complex reporting, offline voting, advanced
audit trails, CSV import/export.

## Notes

- One election is **active** at a time; opening one auto-closes the others
  (enforced in `saveElection`).
- Ballot positions use deterministic IDs (`<electionId>_<index>`); re-saving
  positions after candidates are linked will detach those candidates — set up
  positions *before* registering candidates.
- Voters log in with their **email**, not their Voter ID (Firebase Auth uses
  emails; the Voter ID is used for reporting/lookup).