import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository, fetchSeed } from '../assets/js/data/mockRepository.js';
import { createDemoService } from '../assets/js/services/demoService.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { observeServiceErrors } from '../assets/js/services/result.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-19T09:00:00+08:00');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };

for (const operation of ['initialize', 'reset']) test(`a delayed first ${operation} cannot overwrite a snapshot saved by another tab`, async () => {
  const values = new Map();
  let release, started;
  const loading = new Promise(resolve => { started = resolve; });
  const repository = createMockRepository({ now: () => anchor,
    getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }),
    loadSeed: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const service = createDemoService(repository);
  const pending = operation === 'initialize' ? service.initialize() : service.resetDemo(true);
  await loading;
  const other = initializeSnapshot(seed, anchor + 1000);
  other.activeUserId = 'u002';
  const saved = JSON.stringify(other);
  values.set(STORAGE_KEY, saved);
  release(seed);
  assert.equal((await pending).error?.code, 'EXTERNAL_CHANGE');
  assert.equal(values.get(STORAGE_KEY), saved);
});

test('failed seed validation and failed reset keep the previous complete snapshot', async () => {
  let fail = false;
  const values = new Map();
  const repository = createMockRepository({ now: () => anchor,
    getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }),
    loadSeed: async () => fail ? { ...seed, meta: { ...seed.meta, schemaVersion: 999 } } : seed });
  const service = createDemoService(repository);
  ok(await service.initialize()); ok(await service.switchDemoUser('u002'));
  const saved = values.get(STORAGE_KEY);
  fail = true;
  assert.equal((await service.resetDemo(true)).error.code, 'SEED_LOAD_FAILED');
  assert.equal(values.get(STORAGE_KEY), saved);
  assert.equal(ok(await service.getSession()).activeUser.id, 'u002');
});

test('seed HTTP, JSON and abort failures reject and release the timeout', async t => {
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(fetchSeed('https://example.test/project/'), /HTTP 503/);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } });
    await assert.rejects(fetchSeed('https://example.test/project/'), /invalid JSON/);
    let aborted = false;
    globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }));
    const timeout = assert.rejects(fetchSeed('https://example.test/project/'), /aborted/);
    t.mock.timers.tick(15000);
    await timeout;
    assert.equal(aborted, true);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});

test('all service failures reach the observer once without retrying the operation or changing its result', async () => {
  let calls = 0;
  const errors = [];
  const failure = { ok: false, error: { code: 'EXTERNAL_CHANGE', message: 'reload' } };
  const success = { ok: true, data: { id: 'one' } };
  const service = observeServiceErrors({
    getTask: async id => { assert.equal(id, 't001'); calls++; return failure; },
    createTask: async input => { assert.equal(input.id, 'one'); calls++; return success; },
  }, error => errors.push(error));
  assert.equal(await service.getTask('t001'), failure);
  assert.equal(await service.createTask({ id: 'one' }), success);
  assert.equal(calls, 2); assert.deepEqual(errors, [failure.error]);
});
