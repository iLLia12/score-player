// Zero-dependency static server for the sheet music player.
// Usage: node server.js   (serves on http://localhost:3333)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3333;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SCORES_DIR = path.join(ROOT, 'scores');
const ALPHATAB_DIR = path.join(ROOT, 'node_modules', '@coderline', 'alphatab', 'dist');
const SOUNDFONT_DIR = path.join(ROOT, 'soundfonts');

const SCORE_EXT = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.gp7', '.musicxml', '.xml', '.mxl', '.atex', '.tex', '.cap'];
const MAX_UPLOAD = 50 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
};

// Resolve a URL path inside a base directory, refusing path traversal.
function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(data));
}

function listScores(res) {
  fs.readdir(SCORES_DIR, { withFileTypes: true }, (err, entries) => {
    if (err) return json(res, 200, []);
    const files = entries
      .filter((e) => e.isFile() && SCORE_EXT.includes(path.extname(e.name).toLowerCase()))
      .map((e) => {
        const st = fs.statSync(path.join(SCORES_DIR, e.name));
        return { name: e.name, size: st.size, modified: st.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    json(res, 200, files);
  });
}

function uploadScore(req, res, rawName) {
  const name = path.basename(decodeURIComponent(rawName)).replace(/[^\w .()\-]/g, '_');
  if (!name || !SCORE_EXT.includes(path.extname(name).toLowerCase())) {
    return json(res, 400, { error: 'Unsupported file type' });
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) {
      json(res, 413, { error: 'File too large' });
      req.destroy();
    } else chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    fs.writeFile(path.join(SCORES_DIR, name), Buffer.concat(chunks), (err) => {
      if (err) return json(res, 500, { error: err.message });
      json(res, 200, { name });
    });
  });
}

http
  .createServer((req, res) => {
    if (process.env.DEBUG) console.log(req.method, req.url);
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/scores' && req.method === 'GET') return listScores(res);
    if (p.startsWith('/api/scores/') && req.method === 'PUT') return uploadScore(req, res, p.slice('/api/scores/'.length));
    if (p.startsWith('/api/scores/') && req.method === 'DELETE') {
      const file = safeJoin(SCORES_DIR, '/' + path.basename(decodeURIComponent(p.slice('/api/scores/'.length))));
      if (!file) return notFound(res);
      return fs.unlink(file, (err) => (err ? notFound(res) : json(res, 200, { ok: true })));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);

    let file;
    if (p.startsWith('/alphatab/')) file = safeJoin(ALPHATAB_DIR, p.slice('/alphatab'.length));
    else if (p.startsWith('/scores/')) file = safeJoin(SCORES_DIR, p.slice('/scores'.length));
    else if (p.startsWith('/soundfonts/')) file = safeJoin(SOUNDFONT_DIR, p.slice('/soundfonts'.length));
    else file = safeJoin(PUBLIC_DIR, p === '/' ? '/index.html' : p);

    if (!file) return notFound(res);
    sendFile(res, file);
  })
  .listen(PORT, () => {
    console.log(`🎼 Sheet music player running at http://localhost:${PORT}`);
  });
