import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository } from '../assets/js/data/mockRepository.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { createDemoService } from '../assets/js/services/demoService.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-19T09:00:00+08:00');
async function setup(change) {
  let time = anchor;
  let writes = 0;
  let failWrites = false;
  const snapshot = initializeSnapshot(seed, anchor);
  change?.(snapshot);
  const storage = new Map([[STORAGE_KEY, JSON.stringify(snapshot)]]);
  const repository = createMockRepository({
    now: () => time, loadSeed: async () => seed,
    getStorage: () => ({ getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { writes++; if (failWrites) throw new Error('quota'); storage.set(key, value); } }),
  });
  const service = createDemoService(repository, { now: () => time });
  assert.equal((await service.initialize()).ok, true);
  return { service, repository, storage, setTime: value => { time = value; },
    getWrites: () => writes, failWrites: () => { failWrites = true; } };
}
const ids = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data.tasks.map(task => task.id); };

test('hall defaults to open tasks ordered by deadline and enriches cards without exposing stale states', async () => {
  const f = await setup();
  const result = await f.service.listTasks();
  assert.deepEqual(ids(result), ['t001', 't002', 't003', 't004']);
  assert.equal(result.data.totalOpen, 4);
  const task = result.data.tasks[0];
  assert.equal(task.categoryLabel, '代取快递');
  assert.equal(task.pickup.name, '北门驿站');
  assert.equal(task.dropoff.name, '学生公寓公共门厅');
  assert.equal(task.isOwn, true);
  assert.equal(task.isUrgent, true);
  assert.equal(task.remainingMinutes, 40);
  assert.equal(f.getWrites(), 0, 'reading unchanged tasks must not rewrite storage');
});

test('category, normalized text and pickup filters compose; clearing all restores the original list', async () => {
  const f = await setup();
  assert.deepEqual(ids(await f.service.listTasks({ category: 'shopping', query: '  不加辣  ', pickupLocationId: 'l002' })), ['t002']);
  assert.deepEqual(ids(await f.service.listTasks({ query: '图书馆门口' })), ['t003', 't004']);
  assert.deepEqual(ids(await f.service.listTasks({ category: 'printing', query: '打印', pickupLocationId: 'l001' })), []);
  assert.deepEqual(ids(await f.service.listTasks({ category: '', query: '', pickupLocationId: '' })), ['t001', 't002', 't003', 't004']);
  assert.deepEqual(ids(await f.service.listTasks({ query: '不会出现的任务' })), []);
  assert.deepEqual(ids(await f.service.listTasks({ pickupLocationId: 'l003' })), [], 'pickup filter must not match dropoff');
});

test('at the exact deadline open tasks expire once, with one revision and timeline event and no credit changes', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot;
  f.setTime(anchor + 40 * 60000 - 1);
  assert.equal((await f.service.getTask('t001')).data.status, 'open');
  f.setTime(anchor + 40 * 60000);
  const results = await Promise.all([f.service.listTasks(), f.service.getTask('t001'), f.service.listTasks()]);
  assert.deepEqual(ids(results[0]), ['t002', 't003', 't004']);
  const task = results[1].data;
  assert.equal(task.status, 'expired');
  assert.equal(task.revision, 2);
  assert.equal(task.updatedAt, anchor + 40 * 60000);
  assert.equal(task.timeline.at(-1).actorId, null);
  assert.equal(task.timeline.at(-1).action, 'expired');
  assert.equal(task.timeline.length, 2);
  assert.equal(f.getWrites(), 1);
  const after = (await f.repository.read()).snapshot;
  assert.deepEqual(after.db.creditEvents, before.db.creditEvents);
  assert.deepEqual(after.db.reviews, before.db.reviews);
  assert.equal(after.initializedAt, before.initializedAt);
});

test('overdue accepted and in-progress tasks retain their state and runner; empty hall keeps history', async () => {
  const f = await setup();
  f.setTime(anchor + 86400000);
  const result = await f.service.listTasks();
  assert.deepEqual(ids(result), []);
  assert.equal(result.data.totalOpen, 0);
  for (const [id, state, runner] of [['t005', 'accepted', 'u001'], ['t006', 'in_progress', 'u002'], ['t007', 'awaiting_confirmation', 'u004']]) {
    const detail = (await f.service.getTask(id)).data;
    assert.equal(detail.status, state);
    assert.equal(detail.runnerId, runner);
    assert.equal(detail.isOverdue, true);
  }
  assert.equal((await f.repository.read()).snapshot.db.tasks.length, 12);
  assert.deepEqual(ids(await f.service.listTasks({ status: 'completed' })), ['t008', 't009']);
});

test('expiration persists across reload without shifting deadlines or adding a second event', async () => {
  const f = await setup();
  f.setTime(anchor + 50 * 60000);
  await f.service.listTasks();
  let writes = 0;
  const repository = createMockRepository({
    getStorage: () => ({ getItem: key => f.storage.get(key), setItem: () => { writes++; } }),
    loadSeed: async () => { throw new Error('must restore offline'); },
  });
  const service = createDemoService(repository, { now: () => anchor + 55 * 60000 });
  assert.equal((await service.initialize()).ok, true);
  const result = await service.getTask('t001');
  assert.equal(result.data.status, 'expired');
  assert.equal(result.data.revision, 2);
  assert.equal(result.data.deadlineAt, anchor + 40 * 60000);
  assert.equal(result.data.timeline.length, 2);
  assert.equal(writes, 0);
});

test('expiration write failure uses temporary state and keeps the previous disk snapshot', async () => {
  const f = await setup();
  const before = f.storage.get(STORAGE_KEY);
  f.failWrites();
  f.setTime(anchor + 40 * 60000);
  const result = await f.service.listTasks();
  assert.equal(result.data.persistence.mode, 'memory');
  assert.equal(result.data.persistence.warning.code, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(ids(result), ['t002', 't003', 't004']);
  assert.equal(f.storage.get(STORAGE_KEY), before);
  assert.equal((await f.service.getTask('t001')).data.revision, 2);
});

test('hall scope, metadata and own-task labels follow the selected campus and identity', async () => {
  const f = await setup(snapshot => {
    snapshot.db.campuses.push({ id: 'c002', name: '另一虚构校区', fictional: true });
    snapshot.db.locations.push({ id: 'l100', name: '另一校区门口', campusId: 'c002', fictional: true });
    snapshot.db.users.push({ ...snapshot.db.users[0], id: 'u100', campusId: 'c002' });
    snapshot.db.tasks.push({ ...structuredClone(snapshot.db.tasks[0]), id: 't100', campusId: 'c002', publisherId: 'u100', pickupLocationId: 'l100', dropoffLocationId: 'l100',
      timeline: [{ id: 't100-e1', action: 'published', actorId: 'u100', at: snapshot.db.tasks[0].createdAt }] });
  });
  assert.equal((await f.service.listTasks()).data.totalOpen, 4);
  await f.service.switchDemoUser('u002');
  assert.equal((await f.service.listTasks()).data.tasks.find(task => task.id === 't001').isOwn, false);
  await f.service.switchDemoUser('u100');
  const result = await f.service.listTasks();
  assert.deepEqual(ids(result), ['t100']);
  assert.deepEqual(result.data.locations.map(location => location.id), ['l100']);
});

test('urgent threshold and subminute rounding do not offer expired tasks', async () => {
  const f = await setup();
  f.setTime(anchor + 30 * 60000 - 1);
  assert.equal((await f.service.getTask('t002')).data.isUrgent, false);
  f.setTime(anchor + 30 * 60000);
  assert.equal((await f.service.getTask('t002')).data.isUrgent, true);
  f.setTime(anchor + 40 * 60000 - 1);
  assert.equal((await f.service.getTask('t001')).data.remainingMinutes, 1);
  f.setTime(anchor + 40 * 60000);
  const expired = (await f.service.getTask('t001')).data;
  assert.equal(expired.remainingMinutes, 0);
  assert.equal(expired.isUrgent, false);
});

test('HTML and long search strings remain plain data and invalid filter types return business errors', async () => {
  const f = await setup();
  assert.deepEqual(ids(await f.service.listTasks({ query: '<script>alert(1)</script>' })), []);
  assert.deepEqual(ids(await f.service.listTasks({ query: '字'.repeat(1000) })), []);
  for (const filter of [null, [], { query: {} }, { status: 'unknown' }, { category: 12 }]) {
    const result = await f.service.listTasks(filter);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
  }
});
