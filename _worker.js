// =====================================================================
// CUSCO Voting System: Cloudflare Pages Advanced Mode worker (_worker.js)
//
// Why this file exists:
//  1. This repo contains BOTH a static site (/, /admin/, /voter/, /sys/)
//     AND Firebase Cloud Functions in ./functions/ (Node.js backend for
//     votes, roles, etc.: deployed with `firebase deploy --only functions`).
//  2. Cloudflare Pages would otherwise try to build ./functions/ as
//     "Pages Functions" and fail. When a `_worker.js` file exists at the
//     project root, Pages IGNORES ./functions/ entirely and uses this
//     worker instead: so Firebase backend code deploys separately and
//     the static site deploys here with zero conflicts.
//
// What it does:
//  - Serves all static assets normally (env.ASSETS).
//  - Optionally enforces the 2-URL split:
//      STUDENT_HOST = e.g. vote.cusco.ac.ke   (students only)
//      ADMIN_HOST   = e.g. cusco-staff-9f2k41.cusco.ac.ke (staff only, secret)
//    When both vars are set in Pages → Settings → Environment variables,
//    requests for /admin/* and /sys/* on the STUDENT domain get a 404,
//    so the admin portal only works on the secret admin URL.
//    If the vars are NOT set yet, everything is served on every domain
//    (safe default: you can attach domains first, lock down later).
//  - Re-applies security headers (Pages `_headers` does not apply to
//    responses served through a _worker.js fetch handler, so we do it here).
// =====================================================================

function isAdminPath(pathname) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/sys/')
  );
}

function isPreviewHost(host) {
  return host.endsWith('.pages.dev');
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!headers.has('Permissions-Policy'))
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), fullscreen=(self)');
  if (!headers.has('Cross-Origin-Opener-Policy')) headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS is added by Cloudflare automatically on HTTPS custom domains;
  // setting it here too is harmless.
  if (!headers.has('Strict-Transport-Security'))
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    const studentHost = (env.STUDENT_HOST || '').toLowerCase().trim();
    const adminHost = (env.ADMIN_HOST || '').toLowerCase().trim();

    // --- 2-URL enforcement (only when configured) -------------------
    if (isAdminPath(path) && !isPreviewHost(host)) {
      let block = false;
      if (studentHost && host === studentHost) {
        // Definite student domain → never serve admin portal.
        block = true;
      } else if (!studentHost && adminHost && host !== adminHost) {
        // Only admin host known → any other custom domain is treated
        // as public, so block admin paths there.
        block = true;
      }
      if (block) {
        return withSecurityHeaders(
          new Response('Not found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      }
    }

    // --- Static assets (normal path) --------------------------------
    let response;
    try {
      response = await env.ASSETS.fetch(request);
    } catch (e) {
      return withSecurityHeaders(
        new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      );
    }
    return withSecurityHeaders(response);
  },
};
