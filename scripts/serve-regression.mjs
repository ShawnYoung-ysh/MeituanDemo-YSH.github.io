// Isolated loopback-only fault fixtures. Production HTML never loads this script.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initializeSnapshot } from '../assets/js/data/snapshot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '/MeituanDemo-YSH.github.io/';
const cases = new Set(['normal', 'seed-retry', 'seed-invalid', 'seed-slow', 'reset-fails', 'storage-denied', 'storage-write-fails', 'storage-corrupt', 'schema-unsupported', 'deadline-race', 'initialization-race', 'offline-after-load']);
const attempts = new Map();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const reply = (status, body, type = 'text/plain') => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'Method not allowed');
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(base)) return reply(404, 'Not found');
    const relative = pathname.slice(base.length) || 'index.html';
    if (relative.split(/[\\/]/).some(part => part.startsWith('.')) || !(relative === 'index.html' || relative === 'mock/db.json' || relative.startsWith('assets/'))) return reply(404, 'Not found');
    const file = path.resolve(root, relative);
    if (path.relative(root, file).startsWith('..') || !types[path.extname(file)]) return reply(404, 'Not found');
    const scenario = url.searchParams.get('case') ?? 'normal';
    if (!cases.has(scenario)) return reply(400, 'Unknown regression scenario');
    if (relative === 'mock/db.json') {
      const id = url.searchParams.get('session') ?? 'default';
      const count = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, count);
      // Keep fixture bookkeeping bounded during long manual sessions.
      if (attempts.size > 200) attempts.delete(attempts.keys().next().value);
      if ((scenario === 'seed-retry' && count === 1) || (scenario === 'reset-fails' && count > 1)) return reply(503, 'Injected seed failure');
      if (scenario === 'seed-invalid') return reply(200, '{broken-json', 'application/json');
      if (['seed-slow', 'initialization-race'].includes(scenario)) await new Promise(resolve => setTimeout(resolve, 1800));
    }
    let body = await readFile(file);
    if (relative === 'index.html') {
      const session = randomUUID();
      const run = url.searchParams.get('run') ?? 'default';
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) return reply(400, 'Invalid regression run');
      const otherSnapshot = initializeSnapshot(JSON.parse(await readFile(path.join(root, 'mock/db.json'), 'utf8')), Date.now());
      otherSnapshot.activeUserId = 'u002';
      const prelude = `<script>
        (() => {
          const scenario = ${JSON.stringify(scenario)};
          const session = ${JSON.stringify(session)};
          const originalFetch = window.fetch.bind(window);
          let fetchCount = 0;
          window.fetch = (input, init) => {
            if (scenario === 'offline-after-load' && ++fetchCount > 1) return Promise.reject(new TypeError('Injected data-request offline'));
            const url = new URL(input, document.baseURI);
            if (url.origin === location.origin && url.pathname.endsWith('/mock/db.json')) {
              url.searchParams.set('case', scenario); url.searchParams.set('session', session);
            }
            return originalFetch(url, init);
          };
          const nativeStorage = window.localStorage;
          const prefix = 'regression:' + scenario + ':' + ${JSON.stringify(run)} + ':';
          const key = 'campus-errand-demo:v1';
          if (scenario === 'initialization-race' && nativeStorage.getItem(prefix + key) === null) {
            setTimeout(() => nativeStorage.setItem(prefix + key, ${JSON.stringify(JSON.stringify(otherSnapshot)).replaceAll('<', '\\u003c')}), 150);
          }
          if (nativeStorage.getItem(prefix + key) === null && ['storage-corrupt', 'schema-unsupported'].includes(scenario)) {
            nativeStorage.setItem(prefix + key, scenario === 'storage-corrupt' ? '{broken-json' : JSON.stringify({schemaVersion:999}));
          }
          Object.defineProperty(window, 'localStorage', { configurable: true, get() {
            if (scenario === 'storage-denied') throw new DOMException('Injected storage denial', 'SecurityError');
            return { getItem: name => nativeStorage.getItem(prefix + name), setItem: (name, value) => {
              if (scenario === 'storage-write-fails') throw new DOMException('Injected write failure', 'QuotaExceededError');
              nativeStorage.setItem(prefix + name, value);
            } };
          } });
          if (scenario === 'deadline-race') {
            const originalNow = Date.now.bind(Date);
            Date.now = () => originalNow() + (document.querySelector('.publish-form[aria-busy="true"]') ? 25*3600000 : 0);
          }
          document.addEventListener('DOMContentLoaded', () => {
            const label = document.createElement('p'); label.textContent = '独立故障预检：' + scenario + '（隔离环境，非正式站点）';
            label.className = 'notice'; label.dataset.qaScenario = scenario; document.body.prepend(label);
          });
        })();
      </script>`;
      body = body.toString('utf8').replace('<head>', `<head>${prelude}`);
    }
    reply(200, body, types[path.extname(file)]);
  } catch (error) { reply(error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500, 'Regression fixture could not load'); }
});
server.listen(4174, '127.0.0.1', () => console.log(`独立故障预检：http://127.0.0.1:4174${base}?case=seed-retry`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
