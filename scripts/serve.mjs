import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '/MeituanDemo-YSH.github.io/';
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口');

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); };
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return reply(405, 'Method not allowed'); }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname === base.slice(0, -1)) { res.writeHead(302, { Location: base }); return res.end(); }
    if (!pathname.startsWith(base)) return reply(404, 'Not found');
    const requested = pathname.slice(base.length) || 'index.html';
    const segments = requested.split(/[\\/]/);
    if (segments.some(part => part.startsWith('.')) || ['scripts', 'docs', 'artifacts', 'node_modules'].includes(segments[0]) || requested === 'package.json') return reply(404, 'Not found');
    const file = path.resolve(root, requested);
    const relative = path.relative(root, file);
    const type = types[path.extname(file).toLowerCase()];
    if (!type || relative.startsWith('..') || path.isAbsolute(relative)) return reply(404, 'Not found');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    reply(error instanceof URIError ? 400 : error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, 'Unable to serve this path');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`本地预览：http://127.0.0.1:${port}${base}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
