import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository } from '../assets/js/data/mockRepository.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { createDemoService } from '../assets/js/services/demoService.js';
import { formatLocalDeadline, parseLocalDeadline, parseMoneyCents } from '../assets/js/services/formValidation.js';
import { createPublishDraft, hasDraftContent } from '../assets/js/pages/publishPage.js';
import { formatMoneyCents } from '../assets/js/components/format.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-19T09:00:00+08:00');
const validForm = () => ({ category: 'express', title: '帮取一件虚构包裹', description: '请将演示包裹送到图书馆门口，公共地点交接。',
  pickupLocationId: 'l001', dropoffLocationId: 'l003', deadlineAt: anchor + 3600000, reward: '3.50', goodsBudget: '' });
async function setup({ failWrites = false, initial, newId } = {}) {
  let time = anchor;
  let writes = 0;
  let counter = 0;
  const storage = new Map([[STORAGE_KEY, initial || JSON.stringify(initializeSnapshot(seed, anchor))]]);
  const repository = createMockRepository({ getStorage: () => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes++; if (failWrites) throw new Error('quota'); storage.set(key, value); } }), loadSeed: async () => seed, now: () => time });
  const service = createDemoService(repository, { now: () => time, newId: newId || (() => `test-${++counter}`) });
  assert.equal((await service.initialize()).ok, true);
  const create = (form = validForm(), requestId = 'request-one', actorId = 'u001') => service.createTask({ actorId, form, requestId });
  return { repository, service, create, storage, setTime: at => { time = at; }, getWrites: () => writes };
}

test('decimal amounts convert exactly to integer cents without accepting malformed prices', () => {
  for (const [value, expected] of [['0', 0], ['0.01', 1], ['1.10', 110], ['03.50', 350], [' 50.00 ', 5000]]) assert.equal(parseMoneyCents(value, { max: 5000 }), expected);
  for (const value of ['', ' ', '-1', '1e2', 'NaN', 'Infinity', '.5', '1.', '1.234', '50.01', '1,00', 'abc', 3.5]) assert.equal(parseMoneyCents(value, { max: 5000 }), null);
  assert.equal(parseMoneyCents('', { optional: true }), 0);
  assert.equal(parseMoneyCents('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(parseMoneyCents('90071992547409.92'), null);
  assert.equal(formatMoneyCents(1), '0.01');
  assert.equal(formatMoneyCents(350), '3.50');
  assert.equal(formatMoneyCents(Number.MAX_SAFE_INTEGER), '90071992547409.91');
});

test('datetime-local parses local components, rejects impossible dates, and round-trips without nonstandard date strings', () => {
  const time = new Date(2026, 9, 19, 9, 15).getTime();
  assert.equal(formatLocalDeadline(time), '2026-10-19T09:15');
  assert.equal(parseLocalDeadline(formatLocalDeadline(time)), time);
  for (const value of ['', '2026-02-30T09:00', '2026-10-19 09:00', '2026-10-19T24:00', '2026-13-19T09:00', '2026-10-19T09:00Z']) assert(Number.isNaN(parseLocalDeadline(value)));
});

test('one publication creates an initial task, timeline and idempotency record in one write', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot;
  const result = await f.create({ ...validForm(), title: '  帮取一件虚构包裹  ', description: '  请将演示包裹送到图书馆门口，公共地点交接。  ', goodsBudget: '18.20' });
  assert.equal(result.ok, true);
  const task = result.data.task;
  assert.equal(task.title, '帮取一件虚构包裹');
  assert.equal(task.rewardCents, 350);
  assert.equal(task.goodsBudgetCents, 1820);
  assert.equal(task.campusId, 'c001');
  assert.equal(task.status, 'open');
  assert.equal(task.runnerId, null);
  assert.equal(task.revision, 1);
  assert.equal(task.createdAt, anchor);
  assert.deepEqual(task.timeline, [{ id: `${task.id}-published`, action: 'published', actorId: 'u001', at: anchor }]);
  const after = (await f.repository.read()).snapshot;
  assert.equal(after.db.tasks.length, 13);
  assert.equal(f.getWrites(), 1);
  assert.deepEqual(after.db.creditEvents, before.db.creditEvents);
  assert.deepEqual(after.db.reviews, before.db.reviews);
  assert.equal(after.processedRequests['createTask:request-one'].taskId, task.id);
  assert.equal((await f.service.getTask(task.id)).data.isOwn, true);
  assert((await f.service.listTasks()).data.tasks.some(item => item.id === task.id));
});

test('invalid fields report exact names, preserve the entire snapshot and create no task', async () => {
  for (const [field, value] of [['category', 'unknown'], ['title', '   '], ['title', '字'.repeat(61)], ['description', '太短'], ['description', '字'.repeat(501)],
    ['pickupLocationId', 'missing'], ['dropoffLocationId', 'missing'], ['deadlineAt', anchor], ['deadlineAt', anchor + 24 * 3600000 + 1], ['reward', '0.001'], ['reward', '50.01'], ['goodsBudget', '-1']]) {
    const f = await setup();
    const before = f.storage.get(STORAGE_KEY);
    const result = await f.create({ ...validForm(), [field]: value });
    assert.equal(result.ok, false, `${field}: ${value}`);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.equal(result.error.field, field);
    assert(result.error.fields[field]);
    assert.equal(f.storage.get(STORAGE_KEY), before);
    assert.equal(f.getWrites(), 0);
  }
});

test('title, description, reward and deadline boundaries are inclusive; deadline is rechecked at submission', async () => {
  for (const minutes of [10, 24 * 60]) {
    const f = await setup();
    assert.equal((await f.create({ ...validForm(), title: '字'.repeat(4), description: '字'.repeat(10), deadlineAt: anchor + minutes * 60000, reward: '0' })).ok, true);
  }
  const f = await setup();
  assert.equal((await f.create({ ...validForm(), title: '字'.repeat(60), description: '字'.repeat(500), reward: '50' })).ok, true);
  f.setTime(anchor + 55 * 60000);
  const result = await f.create(validForm(), 'request-too-late');
  assert.equal(result.error.field, 'deadlineAt');
});

test('same request retries, including concurrent calls, return one result without duplicate tasks', async () => {
  const f = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.create()));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal((await f.repository.read()).snapshot.db.tasks.length, 13);
  assert.equal(f.getWrites(), 1);
});

test('retries restore the original result after refresh and expiry without shifting timestamps', async () => {
  const f = await setup();
  const first = await f.create();
  const refreshed = await setup({ initial: f.storage.get(STORAGE_KEY) });
  refreshed.setTime(anchor + 2 * 3600000);
  assert.equal((await refreshed.service.getTask(first.data.task.id)).data.status, 'expired');
  const replay = await refreshed.create();
  assert.deepEqual(replay.data.task, first.data.task);
  assert.equal((await refreshed.repository.read()).snapshot.db.tasks.length, 13);
  assert.equal((await refreshed.service.getTask(first.data.task.id)).data.revision, 2);
});

test('reusing an idempotency key with different content is rejected; new keys allow legitimate new tasks', async () => {
  const f = await setup();
  assert.equal((await f.create()).ok, true);
  const before = f.storage.get(STORAGE_KEY);
  const result = await f.create({ ...validForm(), title: '另一条虚构任务描述' });
  assert.equal(result.error.code, 'REVISION_CONFLICT');
  assert.equal(f.storage.get(STORAGE_KEY), before);
  assert.equal((await f.create(validForm(), 'request-two')).ok, true);
  assert.equal((await f.repository.read()).snapshot.db.tasks.length, 14);
});

test('stale identities and locations outside the current campus cannot publish; low-credit users can', async () => {
  const f = await setup();
  assert.equal((await f.create(validForm(), 'request-stale', 'u002')).error.code, 'FORBIDDEN');
  await f.service.switchDemoUser('u005');
  assert.equal((await f.create(validForm(), 'request-old-user', 'u001')).error.code, 'FORBIDDEN');
  assert.equal((await f.create(validForm(), 'request-low-credit', 'u005')).ok, true);
  const result = await f.create({ ...validForm(), pickupLocationId: 'another-campus-place' }, 'request-place', 'u005');
  assert.equal(result.error.field, 'pickupLocationId');
});

test('storage write failure returns an explicitly temporary publication and does not replace old disk data', async () => {
  const f = await setup({ failWrites: true });
  const before = f.storage.get(STORAGE_KEY);
  const result = await f.create();
  assert.equal(result.ok, true);
  assert.equal(result.data.persistence.mode, 'memory');
  assert.equal(f.storage.get(STORAGE_KEY), before);
  assert.equal((await f.service.getTask(result.data.task.id)).ok, true);
  assert.equal((await f.create()).data.task.id, result.data.task.id);
});

test('HTML stays intact as text data and service input is captured before queued operations', async () => {
  const f = await setup();
  const form = { ...validForm(), title: '<b>虚构任务标题</b>', description: '<script>alert("test-only")</script> 纯文本测试。' };
  const pending = f.create(form);
  form.title = '提交后修改调用者对象';
  const result = await pending;
  assert.equal(result.data.task.title, '<b>虚构任务标题</b>');
  assert.equal((await f.service.getTask(result.data.task.id)).data.description, '<script>alert("test-only")</script> 纯文本测试。');
});

test('invalid request IDs and task ID collisions do not create duplicate tasks', async () => {
  const f = await setup({ newId: () => 'fixed-id' });
  for (const request of ['', 'bad/id', 'short', 'x'.repeat(129)]) assert.equal((await f.create(validForm(), request)).error.code, 'VALIDATION_ERROR');
  assert.equal((await f.create()).ok, true);
  assert.equal((await f.create(validForm(), 'request-other')).error.code, 'INTERNAL_ERROR');
  assert.equal((await f.repository.read()).snapshot.db.tasks.length, 13);
});

test('prefixed request keys cannot modify the object prototype', async () => {
  const f = await setup();
  assert.equal((await f.create(validForm(), '__proto__')).ok, true);
  const requests = (await f.repository.read()).snapshot.processedRequests;
  assert(Object.hasOwn(requests, 'createTask:__proto__'));
  assert.equal(Object.getPrototypeOf(requests), Object.prototype);
});

test('detail derives self, low-credit, expired and already-taken blockers along with profiles and actors', async () => {
  const f = await setup();
  const own = (await f.service.getTask('t001')).data;
  assert.equal(own.acceptBlocker.code, 'SELF_ACCEPT');
  assert.equal(own.publisher.credit, 82);
  assert.equal(own.timeline[0].actorName, '小周（演示）');
  await f.service.switchDemoUser('u005');
  assert.equal((await f.service.getTask('t001')).data.acceptBlocker.code, 'LOW_CREDIT');
  assert.equal((await f.service.getTask('t011')).data.acceptBlocker.code, 'TASK_EXPIRED');
  assert.equal((await f.service.getTask('t005')).data.acceptBlocker.code, 'INVALID_STATE');
  await f.service.switchDemoUser('u002');
  assert.equal((await f.service.getTask('t001')).data.acceptBlocker, null);
});

test('publish metadata and in-memory drafts support current identities without pre-filling fake input', async () => {
  const f = await setup();
  const result = await f.service.getPublishOptions();
  assert.equal(result.data.actor.id, 'u001');
  assert.equal(result.data.categories.length, 4);
  assert.equal(result.data.locations.length, 6);
  const first = createPublishDraft();
  const second = createPublishDraft();
  assert.equal(hasDraftContent(first), false);
  first.values.title = '临时保存的虚构任务';
  assert.equal(hasDraftContent(first), true);
  assert.equal(hasDraftContent(second), false);
});

test('damaged persisted request records require recovery and never silently overwrite the saved session', async () => {
  const f = await setup();
  await f.create();
  const snapshot = JSON.parse(f.storage.get(STORAGE_KEY));
  delete snapshot.processedRequests['createTask:request-one'].result;
  const damaged = JSON.stringify(snapshot);
  let writes = 0;
  const repository = createMockRepository({ getStorage: () => ({ getItem: () => damaged, setItem: () => { writes++; } }) });
  const result = await createDemoService(repository).initialize();
  assert.equal(result.error.code, 'SNAPSHOT_INVALID');
  assert.equal(writes, 0);
});
