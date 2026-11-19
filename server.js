'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { KrzSqliteStore } = require('./db-sqlite');

const PORT = Number(process.env.PORT) || 8000;
const HOST = '127.0.0.1'; // Strictly bound to loopback: One Station Only (No Multi-Tills over network)
const DB_PATH = path.join(__dirname, 'krz_print_pos.sqlite');

const store = new KrzSqliteStore(DB_PATH);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // Enforce local single-station origin only
  const remote = req.socket.remoteAddress;
  if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden: KRZ PRINT POS is configured for Single-Station mode only (No Multi-Tills).');
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/db' && req.method === 'GET') {
    try {
      const state = store.loadState();
      const stats = store.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, state, stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (urlPath === '/api/db' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        store.saveState(data);
        const stats = store.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  const safeUrl = path.normalize(urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  const filePath = path.join(__dirname, safeUrl);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Single-Station Lock: KRZ PRINT POS is already running on http://${HOST}:${PORT}`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`KRZ PRINT POS (Single-Station SQLite Mode) running at http://localhost:${PORT}`);
  console.log(`SQLite Database: ${DB_PATH}`);
});
