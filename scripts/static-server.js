// =====================================================================
//  npm start — serve the static site locally on the first free port.
//
//  No dependencies, no Firebase involved: just the HTML/CSS/JS in this
//  folder. Wire up Firebase (js/firebase-config.js) when you're ready.
// =====================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const BLOCKED = ['node_modules', 'functions', 'scripts', '.firebase', '.git'];

// Security headers sent on every response (mirrors the Cloudflare Pages
// _headers file). CSP is kept permissive here (Firebase CDN + inline
// styles) so local dev works the same as production.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

function securityHeaders() {
  return Object.assign({}, SECURITY_HEADERS);
}

const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // Resolve safely inside ROOT.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const top = path.relative(ROOT, filePath).split(path.sep)[0];
  if (BLOCKED.includes(top)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  fs.stat(filePath, function (err, stat) {
    if (err || !stat) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (stat.isDirectory()) {
      fs.readFile(path.join(filePath, 'index.html'), function (err2, data) {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, Object.assign(securityHeaders(), { 'Content-Type': 'text/html; charset=utf-8' }));
        res.end(data);
      });
      return;
    }
    fs.readFile(filePath, function (err3, data) {
      if (err3) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, Object.assign(securityHeaders(), { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' }));
      res.end(data);
    });
  });
});

function isPortFree(port) {
  return new Promise(function (resolve) {
    const tmp = http.createServer();
    tmp.once('error', function () { resolve(false); });
    tmp.once('listening', function () { tmp.close(function () { resolve(true); }); });
    tmp.listen(port, '127.0.0.1');
  });
}

async function start(port) {
  for (let p = port; p < port + 200; p++) {
    if (await isPortFree(p)) {
      server.once('error', function (err) {
        if (err.code === 'EADDRINUSE') {
          start(p + 1);
        }
      });
      server.listen(p, '127.0.0.1', function () {
        server.removeAllListeners('error');
        console.log('\n  CUSCO Voting System — static site');
        console.log('  Open in Chrome:  http://localhost:' + p + '\n');
      });
      return;
    }
  }
  console.error('Could not find a free port starting at ' + port + '.');
  process.exit(1);
}

start(DEFAULT_PORT);