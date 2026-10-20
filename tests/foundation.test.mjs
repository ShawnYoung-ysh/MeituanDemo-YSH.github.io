import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository, fetchSeed } from '../assets/js/data/mockRepository.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { createDemoService } from '../assets/js/services/demoService.js';
import { resolveRoute, startRouter } from '../assets/js/router.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-18T12:00:00+08:00');
function setup({ initial, getFails = false, setFails = false, seedFails = false } = {}) {
  const values = new Map([['other-app', 'keep-me']]);
  if (initial !== undefined) values.set(STORAGE_KEY, initial);
  let time = anchor;
  let loads = 0;
  let writes = 0;
  const storage = {
    getItem: key => { if (getFails) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem: (key, value) => { writes++; if (setFails) throw new Error('quota'); values.set(key, value); },
  };
  const repository = createMockRepository({ getStorage: () => storage, now: () => time,
    loadSeed: async () => { loads++; if (seedFails) throw new Error('offline'); return seed; } });
  return { repository, service: createDemoService(repository, { now: () => time }), values, storage,
    setTime: value => { time = value; }, getLoads: () => loads, getWrites: () => writes };
}

test('first initialization converts every timestamp family once without modifying the seed', async () => {
  const f = setup();
  const original = JSON.stringify(seed);
  const [first, second] = await Promise.all([f.repository.initialize(), f.repository.initialize()]);
  assert.equal(f.getLoads(), 1);
  assert.equal(f.getWrites(), 1);
  assert.deepEqual(first, second);
  const snapshot = first.snapshot;
  assert.equal(snapshot.activeUserId, 'u001');
  assert.equal(snapshot.initializedAt, anchor);
  assert.equal(snapshot.db.tasks[0].deadlineAt, anchor + 40 * 60000);
  assert.equal(snapshot.db.tasks[0].timeline[0].at, anchor - 20 * 60000);
  assert.equal(snapshot.db.reviews[0].createdAt, anchor - 145 * 60000);
  assert.equal(snapshot.db.creditEvents[0].createdAt, anchor - 150 * 60000);
  assert.equal(JSON.stringify(snapshot.db).includes('OffsetMinutes'), false);
  assert.equal(JSON.stringify(seed), original);
});

test('refresh restores identity, task changes, intro choice and anchor even when offline', async () => {
  const f = setup();
  await f.service.initialize();
  await f.service.switchDemoUser('u002');
  await f.service.acknowledgeIntro();
  await f.repository.update(next => { next.db.tasks[0].title = '保留这条任务的演示修改'; });
  const saved = f.values.get(STORAGE_KEY);
  const refreshed = setup({ initial: saved, seedFails: true });
  refreshed.setTime(anchor + 86400000);
  const result = await refreshed.service.initialize();
  assert.equal(result.ok, true);
  assert.equal(result.data.activeUser.id, 'u002');
  assert.equal(result.data.introAcknowledged, true);
  assert.equal(result.data.initializedAt, anchor);
  assert.equal(refreshed.getWrites(), 0, 'restoring the snapshot must not rewrite it');
  assert.equal((await refreshed.service.getTask('t001')).data.title, '保留这条任务的演示修改');
  assert.equal((await refreshed.service.getTask('t001')).data.deadlineAt, anchor + 40 * 60000);
  assert.equal(refreshed.getLoads(), 0);
  assert.equal((await refreshed.service.getTask('t001')).data.status, 'expired');
  assert.equal(refreshed.getWrites(), 1, 'reading an overdue open task persists expiry once');
});

test('intro acknowledgement survives identity changes, sample reset and browser restore', async () => {
  const f = setup();
  await f.service.initialize();
  await f.service.acknowledgeIntro();
  assert.equal((await f.service.switchDemoUser('u002')).data.introAcknowledged, true);
  assert.equal((await f.service.resetDemo(true)).data.introAcknowledged, true);
  const restored = setup({ initial: f.values.get(STORAGE_KEY), seedFails: true });
  assert.equal((await restored.service.initialize()).data.introAcknowledged, true);
});

test('compatible dataset changes preserve the stored session; absent optional preferences are supported', async () => {
  const snapshot = initializeSnapshot(seed, anchor);
  snapshot.datasetVersion = snapshot.db.meta.datasetVersion = 'older-compatible-dataset';
  delete snapshot.preferences;
  const f = setup({ initial: JSON.stringify(snapshot) });
  const result = await f.service.initialize();
  assert.equal(result.ok, true);
  assert.equal(result.data.datasetVersion, 'older-compatible-dataset');
  assert.equal(result.data.introAcknowledged, false);
  assert.equal(f.getLoads(), 0);
});

test('switching identity preserves business collections; unknown identities cannot modify storage', async () => {
  const f = setup();
  await f.service.initialize();
  const before = (await f.repository.read()).snapshot.db;
  const result = await f.service.switchDemoUser('u005');
  assert.equal(result.data.activeUser.credit, 58);
  assert.deepEqual((await f.repository.read()).snapshot.db, before);
  const saved = f.values.get(STORAGE_KEY);
  assert.equal((await f.service.switchDemoUser('missing')).error.code, 'NOT_FOUND');
  assert.equal(f.values.get(STORAGE_KEY), saved);
});

test('reset requires explicit true, restores all records, and preserves other application keys', async () => {
  const f = setup();
  await f.service.initialize();
  await f.service.switchDemoUser('u004');
  await f.repository.update(next => {
    next.db.tasks[0].title = '重置前的一条修改';
    next.processedRequests.example = { ok: true };
  });
  const before = f.values.get(STORAGE_KEY);
  for (const confirmation of [false, undefined, 'true', 1]) {
    assert.equal((await f.service.resetDemo(confirmation)).error.code, 'CONFIRMATION_REQUIRED');
    assert.equal(f.values.get(STORAGE_KEY), before);
  }
  f.setTime(anchor + 3600000);
  const result = await f.service.resetDemo(true);
  assert.equal(result.ok, true);
  assert.equal(result.data.activeUser.id, 'u001');
  assert.equal(result.data.activeUser.credit, 82);
  const snapshot = (await f.repository.read()).snapshot;
  assert.deepEqual(snapshot, initializeSnapshot(seed, anchor + 3600000));
  assert.equal(f.values.get('other-app'), 'keep-me');
});

for (const [label, transform, code] of [
  ['invalid JSON', () => '{broken', 'SNAPSHOT_INVALID'],
  ['incompatible schema', snapshot => JSON.stringify({ ...snapshot, schemaVersion: 99 }), 'SCHEMA_UNSUPPORTED'],
  ['missing collections', snapshot => { delete snapshot.db.tasks; return JSON.stringify(snapshot); }, 'SNAPSHOT_INVALID'],
  ['broken reference', snapshot => { snapshot.db.tasks[0].publisherId = 'missing'; return JSON.stringify(snapshot); }, 'SNAPSHOT_INVALID'],
  ['duplicate credit', snapshot => { snapshot.db.creditEvents.push({ ...snapshot.db.creditEvents[0], id: 'duplicate' }); return JSON.stringify(snapshot); }, 'SNAPSHOT_INVALID'],
  ['invalid timestamp', snapshot => { snapshot.db.tasks[0].deadlineAt = null; return JSON.stringify(snapshot); }, 'SNAPSHOT_INVALID'],
]) {
  test(`${label} is recoverable and never silently overwrites the stored snapshot`, async () => {
    const initial = transform(initializeSnapshot(seed, anchor));
    const f = setup({ initial });
    const result = await f.service.initialize();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(f.values.get(STORAGE_KEY), initial);
    assert.equal(f.getLoads(), 0);
    assert.equal(f.getWrites(), 0);
    assert.equal((await f.service.resetDemo(true)).ok, true);
    assert.equal(JSON.parse(f.values.get(STORAGE_KEY)).schemaVersion, 1);
  });
}

test('storage access denial uses an explicitly temporary in-memory session', async () => {
  const f = setup({ getFails: true });
  const result = await f.service.initialize();
  assert.equal(result.data.persistence.mode, 'memory');
  assert.equal(result.data.persistence.warning.code, 'STORAGE_UNAVAILABLE');
  assert.equal((await f.service.switchDemoUser('u002')).data.activeUser.id, 'u002');
  assert.equal(f.getWrites(), 0);
});

test('even a throwing localStorage getter falls back to memory', async () => {
  const repository = createMockRepository({ getStorage: () => { throw new Error('security'); }, loadSeed: async () => seed, now: () => anchor });
  assert.equal((await repository.initialize()).persistence.mode, 'memory');
});

test('write failure preserves the old snapshot and reports temporary state on mutations and reset', async () => {
  const initial = JSON.stringify(initializeSnapshot(seed, anchor));
  const f = setup({ initial, setFails: true });
  await f.service.initialize();
  const result = await f.service.switchDemoUser('u002');
  assert.equal(result.ok, true);
  assert.equal(result.data.persistence.mode, 'memory');
  assert.equal(result.data.activeUser.id, 'u002');
  assert.equal(f.values.get(STORAGE_KEY), initial);
  assert.equal((await f.service.resetDemo(true)).data.persistence.mode, 'memory');
  assert.equal(f.values.get(STORAGE_KEY), initial);
});

test('a failed seed request can be retried, and a failed reset preserves current state', async () => {
  let offline = true;
  const f = setup();
  const repository = createMockRepository({ getStorage: () => f.storage, now: () => anchor,
    loadSeed: async () => { if (offline) throw new Error('offline'); return seed; } });
  const service = createDemoService(repository);
  assert.equal((await service.initialize()).error.code, 'SEED_LOAD_FAILED');
  assert.equal(f.values.has(STORAGE_KEY), false);
  offline = false;
  assert.equal((await service.initialize()).ok, true);
  await service.switchDemoUser('u002');
  const before = f.values.get(STORAGE_KEY);
  offline = true;
  assert.equal((await service.resetDemo(true)).error.code, 'SEED_LOAD_FAILED');
  assert.equal((await service.getSession()).data.activeUser.id, 'u002');
  assert.equal(f.values.get(STORAGE_KEY), before);
});

test('read results are isolated copies and rejected mutations preserve state', async () => {
  const f = setup();
  await f.service.initialize();
  const before = f.values.get(STORAGE_KEY);
  const result = await f.repository.read();
  result.snapshot.db.tasks.length = 0;
  assert.equal((await f.repository.read()).snapshot.db.tasks.length, 12);
  await assert.rejects(f.repository.update(next => { next.activeUserId = 'unknown'; }));
  assert.equal(f.values.get(STORAGE_KEY), before);
  assert.equal((await f.service.getSession()).data.activeUser.id, 'u001');
});

test('initial derived credit matches the documented fixture and missing task returns NOT_FOUND', async () => {
  const f = setup();
  const result = await f.service.initialize();
  assert.deepEqual(result.data.users.map(user => user.credit), [82, 80, 84, 75, 58]);
  assert.equal((await f.service.getTask('missing')).error.code, 'NOT_FOUND');
});

test('seed fetching resolves under the document subpath and checks HTTP errors', async () => {
  const original = globalThis.fetch;
  try {
    let requested;
    globalThis.fetch = async url => { requested = url.href; return { ok: true, json: async () => seed }; };
    await fetchSeed('https://example.test/MeituanDemo-YSH.github.io/#/me');
    assert.equal(requested, 'https://example.test/MeituanDemo-YSH.github.io/mock/db.json');
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(fetchSeed('https://example.test/project/'), /404/);
  } finally { globalThis.fetch = original; }
});

test('routes handle direct detail URLs, unknown paths and malformed encoding', () => {
  for (const hash of ['', '#', '#/', '#/hall']) assert.deepEqual(resolveRoute(hash), { name: 'hall' });
  for (const name of ['publish', 'tasks', 'me']) assert.deepEqual(resolveRoute(`#/${name}`), { name });
  assert.deepEqual(resolveRoute('#/task/t001'), { name: 'task', taskId: 't001' });
  for (const hash of ['#/missing', '#/task/', '#/task/%E0%A4%A', '#/task/a/b', '#/task/%3Cscript%3E', '#/task/__bad/id']) {
    assert.equal(resolveRoute(hash).name, 'notFound');
  }
});

test('router responds to history hash changes and releases its listener', () => {
  const listeners = new Map();
  const host = { location: { hash: '#/me' }, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  const seen = [];
  const stop = startRouter(route => seen.push(route.name), host);
  host.location.hash = '#/hall';
  listeners.get('hashchange')();
  assert.deepEqual(seen, ['me', 'hall']);
  stop();
  assert.equal(listeners.size, 0);
});
