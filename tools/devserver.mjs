// Mini-Dev-Server: liefert das Projektverzeichnis auf http://localhost:8787 aus.
// CORS und Private-Network-Header erlauben, die Module zum Testen in einen
// eingeloggten play.kickbase.com-Tab zu laden. Nur lokal binden.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  // Nur fuer tools/icon.html: erzeugte PNG-Icons nach web/icons/ schreiben.
  const save = req.method === 'POST' && req.url.match(/^\/__save\/([a-z0-9-]+\.png)$/);
  if (save) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.join(root, 'web/icons'), { recursive: true });
      fs.writeFileSync(path.join(root, 'web/icons', save[1]), Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  // Nur fuer tools/backtest.mjs: Rohdaten aus einem eingeloggten Tab nach private/
  // (per .gitignore nie im Repo).
  const raw = req.method === 'POST' && req.url.match(/^\/__save\/private\/([a-z0-9-]+\.json)$/);
  if (raw) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.join(root, 'private'), { recursive: true });
      fs.writeFileSync(path.join(root, 'private', raw[1]), Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  // Kickbase-Proxy fuer die Web-App auf localhost (Kickbase erlaubt CORS nur noch
  // fuer play.kickbase.com). Gleiche Regeln wie proxy/worker.js.
  if (req.url.startsWith('/kb/v4/')) return proxyKickbase(req, res);
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (!rel) { res.writeHead(302, { Location: '/dist/web/' }); return res.end(); }
  let file = path.resolve(root, rel);
  if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8787, '127.0.0.1', () => console.log('http://localhost:8787'));

async function proxyKickbase(req, res) {
  const url = new URL(req.url, 'http://x');
  const apiPath = url.pathname.slice('/kb'.length);
  const method = req.method;
  if (!(method === 'GET' || (method === 'POST' && apiPath === '/v4/user/login'))) { res.writeHead(405); return res.end(); }
  const headers = {};
  for (const h of ['authorization', 'content-type', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
  let body;
  if (method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  try {
    const up = await fetch('https://api.kickbase.com' + apiPath + url.search, { method, headers, body });
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502); res.end();
  }
}
