# CUSCO Voting System Production Security Report

## Audit Scope

This report records security posture after hardening across Phases 3 to 17. Coverage includes Firestore rules, Cloud Functions callable endpoints, frontend JavaScript, storage rules, Cloudflare Pages headers, secrets management and dependency hygiene.

## Changes Applied

### 1 Cloud Functions Hardening

1. resetPassword guard: Added superadmin target protection. A plain admin can no longer reset a superadmin password, preventing account takeover escalation. The function now checks target role equals superadmin and caller role is not superadmin and then refuses with permission denied.

2. Rate limiting: In memory per instance rate limits are wired on all callable functions for vote creation, user registration, password reset, role setting, election saving and bootstrap. These give best effort throttling while a distributed solution using Redis or KV is planned.

3. App Check: Firebase App Check is set with ReCaptcha Enterprise placeholder key. Debug mode is on for development. Enforcement using env flag CUSCO_APPCHECK_ENFORCE equals 1 is recorded and can be turned on once token coverage is proven.

### 2 Firestore Rules

1. users collection: Set to server write only. Owners and admins may read own profile, but no client writes are allowed at rule level. All user changes go through Cloud Functions for registration, update and vote creation.

2. elections collection: Set to server write only. Only saveElection Cloud Function may create or update elections, keeping one active election invariant. Direct admin writes are blocked at rule level.

3. Schema validation: Position, candidate and settings writes are checked with rule helpers for valid position write, valid candidate write and valid settings write. These limit allowed keys, field types and cross record rules for example candidate position must match its election.

4. Global deny: catch all match ensures any unmatched path stays closed.

### 3 Storage Rules

1. candidate photos: Content type check limited to image types such as png, jpeg, webp, gif, avif, bmp. Octet stream fallback is kept for edge cases but is watched. Size limit stays at 2 MB maximum.

### 4 Cloudflare Pages Headers

1. headers file: Placed at project root with security headers including X Content Type Options nosniff, X Frame Options DENY, Referrer Policy strict origin when cross origin, Permissions Policy limiting camera microphone geolocation, Strict Transport Security, Cross Origin Opener Policy same origin, plus Content Security Policy allowing Firebase CDN, gstatic, google, functions endpoint and blob for lazy loading.

### 5 Secrets and Configuration

1. gitignore: Extended to cover service account JSON files, env files, Firebase auth export dumps and log files. No credentials or secrets are committed.

2. firebase json: Points to correct rules and storage rule files. Region alignment kept with functions region.

### 6 Production Cleanup

1. Debug logs removed from working tree including emulator error log, emulator output log and firestore debug log.

2. README drift noted for future refresh.

3. Inline scripts in staff portal page recorded for move to external JS files to stay CSP friendly.

### 7 Dependency Review

1. npm audit production check returns zero issues.

2. firebase admin 12.7.0, firebase functions 4.9.0, frontend Firebase 10.12.2 are current generation with no critical flagged issues.

## Remaining Items

1. App Check enforcement needs ReCaptcha key rollout and slow enablement.

2. Rate limiting moves from in memory per instance to distributed solution using Redis or KV with secret config.

3. Storage octet stream edge case stays watched.

4. Bootstrap superadmin on fresh DB needs rate limit and App Check gate, recorded as inert because superadmin already exists.

5. CSP move for inline scripts in admin pages planned after App Check enforcement.

## Security Posture Summary

System now keeps server side authority for all critical data changes. Clients may read results and election state but cannot forge votes, change user profiles or bypass one active election rule. Auth custom claims stay source of truth for access, with profile docs as read only mirrors. Rate limiting and App Check add depth at functions layer. Storage and Firestore rules limit writes to checked schemas. Headers and CSP harden delivery.

Left risk centers on App Check rollout pace, distributed rate limit build and bootstrap path on fresh DB use, all recorded and actionable.
