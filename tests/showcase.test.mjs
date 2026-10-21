import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createShowcaseService } from '../assets/js/services/showcaseService.js';
import { createMockRepository } from '../assets/js/data/mockRepository.js';
import { createDemoService } from '../assets/js/services/demoService.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const sampleService = () => createShowcaseService({ loadSeed: async () => seed });

test('fixed examples include all twelve tasks and eight states, without live expiry', async () => {
  const service = sampleService();
  const first = await service.listExamples();
  assert.equal(first.ok, true);
  assert.equal(first.data.total, 12);
  assert.equal(first.data.tasks.length, 12);
  assert.equal(first.data.statuses.length, 8);
  assert.equal(first.data.statuses.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal((await service.listExamples('open')).data.tasks.length, 4);
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse('2040-01-01T00:00:00Z');
    assert.deepEqual((await sampleService().listExamples()).data, first.data);
  } finally { Date.now = originalNow; }
});

test('sample browsing never accesses browser storage and exposes no mutation operations', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let accessed = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { accessed = true; throw new Error('denied'); } });
  try {
    const service = sampleService();
    assert.deepEqual(Object.keys(service).sort(), ['getExample', 'listExamples']);
    assert.equal((await service.listExamples()).ok, true);
    assert.equal((await service.getExample('t001')).ok, true);
    assert.equal(accessed, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('expired interactive records and identity remain byte-for-byte unchanged by browsing', async () => {
  let raw = null;
  let writes = 0;
  const anchor = Date.parse('2026-10-18T12:00:00+08:00');
  const repository = createMockRepository({ loadSeed: async () => seed, now: () => anchor,
    getStorage: () => ({ getItem: () => raw, setItem: (_key, value) => { raw = value; writes++; } }) });
  const interactive = createDemoService(repository, { now: () => anchor + 2 * 86400000 });
  await interactive.initialize();
  await interactive.switchDemoUser('u002');
  assert.equal((await interactive.listTasks()).data.tasks.length, 0);
  const before = raw;
  const beforeWrites = writes;
  const service = sampleService();
  assert.equal((await service.listExamples('open')).data.tasks.length, 4);
  for (const id of ['t001', 't008', 't011', 't012']) assert.equal((await service.getExample(id)).ok, true);
  assert.equal(raw, before);
  assert.equal(writes, beforeWrites);
  assert.equal((await interactive.getSession()).data.activeUser.id, 'u002');
});

test('sample responses are independent copies and cannot mutate the source or later visits', async () => {
  const before = JSON.stringify(seed);
  const service = sampleService();
  const result = await service.getExample('t008');
  assert.equal(result.data.status, 'completed');
  assert.equal(result.data.creditEvent.delta, 2);
  assert.equal(result.data.reviews.length, 2);
  assert.equal(result.data.timeline[0].elapsedMinutes, 0);
  result.data.publisher.nickname = 'changed';
  result.data.timeline.length = 0;
  result.data.reviews[0].rating = 1;
  const again = await service.getExample('t008');
  assert.notEqual(again.data.publisher.nickname, 'changed');
  assert.ok(again.data.timeline.length > 0);
  assert.notEqual(again.data.reviews[0].rating, 1);
  assert.equal(JSON.stringify(seed), before);
});

test('concurrent list and detail reads share one sample load', async () => {
  let loads = 0;
  const service = createShowcaseService({ loadSeed: async () => { loads++; return seed; } });
  const results = await Promise.all([service.listExamples(), service.getExample('t001'), service.getExample('t008')]);
  assert.ok(results.every(result => result.ok));
  assert.equal(loads, 1);
});

test('sample loading and validation failures can retry without resetting any session', async () => {
  for (const networkFailure of [true, false]) {
    let loads = 0;
    const service = createShowcaseService({ loadSeed: async () => {
      loads++;
      if (loads === 1) { if (networkFailure) throw new Error('offline'); return { ...seed, users: [] }; }
      return seed;
    } });
    assert.equal((await service.listExamples()).error.code, 'SAMPLE_LOAD_FAILED');
    assert.equal((await service.listExamples()).data.total, 12);
    assert.equal(loads, 2);
  }
});

test('missing sample IDs and invalid filters return errors without falling through to live tasks', async () => {
  const service = sampleService();
  assert.equal((await service.getExample('user-created-task')).error.code, 'NOT_FOUND');
  assert.equal((await service.listExamples('unknown')).error.code, 'VALIDATION_ERROR');
  assert.equal((await service.listExamples('__proto__')).error.code, 'VALIDATION_ERROR');
  assert.equal((await service.listExamples()).data.total, 12);
});
