import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository } from '../assets/js/data/mockRepository.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { createDemoService } from '../assets/js/services/demoService.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-19T09:00:00+08:00');
async function setup({ actorId = 'u001', modify, initial, failWrites = false } = {}) {
  let time = anchor;
  let counter = 0;
  let writes = 0;
  const snapshot = initial ? JSON.parse(initial) : initializeSnapshot(seed, anchor);
  if (!initial) snapshot.activeUserId = actorId;
  modify?.(snapshot);
  const storage = new Map([[STORAGE_KEY, JSON.stringify(snapshot)]]);
  const repository = createMockRepository({ now: () => time, loadSeed: async () => seed,
    getStorage: () => ({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { writes++; if (failWrites) throw new Error('quota'); storage.set(key, value); } }) });
  const service = createDemoService(repository, { now: () => time });
  assert.equal((await service.initialize()).ok, true);
  const transition = (taskId, action, expectedRevision, payload = {}, extra = {}) => service.transitionTask({
    taskId, action, expectedRevision, payload, actorId, requestId: `transition-${++counter}`, ...extra });
  return { service, repository, transition, storage, getWrites: () => writes, setTime: value => { time = value; } };
}
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };

test('t001 runs from accept to completed with role switching, five ordered events and one credit award', async () => {
  const f = await setup({ actorId: 'u002' });
  const before = (await f.repository.read()).snapshot;
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, ['accept']);
  assert.equal(ok(await f.transition('t001', 'accept', 1, { confirmed: true })).task.status, 'accepted');
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, ['start', 'withdraw']);
  f.setTime(anchor + 60000);
  assert.equal(ok(await f.transition('t001', 'start', 2)).task.status, 'in_progress');
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, ['submit_completion']);
  f.setTime(anchor + 120000);
  const submitted = ok(await f.transition('t001', 'submit_completion', 3, { completionNote: '  已在约定公共地点交付演示包裹。  ' }));
  assert.equal(submitted.task.status, 'awaiting_confirmation');
  assert.equal(submitted.task.completionNote, '已在约定公共地点交付演示包裹。');
  assert.equal((await f.repository.read()).snapshot.db.creditEvents.length, 2, 'submission must not issue credit');
  await f.service.switchDemoUser('u001');
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, ['confirm_completion', 'dispute']);
  f.setTime(anchor + 180000);
  const completed = ok(await f.transition('t001', 'confirm_completion', 4, { confirmed: true }, { actorId: 'u001' }));
  assert.equal(completed.task.status, 'completed');
  assert.equal(completed.task.revision, 5);
  assert.deepEqual(completed.task.timeline.map(event => event.action), ['published', 'accepted', 'started', 'completion_submitted', 'completed']);
  assert.deepEqual(completed.creditAward, { userId: 'u002', before: 80, after: 82, delta: 2, appliedDelta: 2 });
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, []);
  const after = (await f.repository.read()).snapshot;
  const events = after.db.creditEvents.filter(event => event.taskId === 't001');
  assert.equal(events.length, 1);
  assert.equal(events[0].createdAt, completed.task.updatedAt);
  assert.equal(events[0].userId, 'u002');
  assert.deepEqual(after.db.reviews, before.db.reviews);
});

test('t007 confirmation changes u004 from 75 to 77 in one complete snapshot write', async () => {
  const f = await setup();
  const completed = ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }));
  assert.equal(f.getWrites(), 1);
  const disk = JSON.parse(f.storage.get(STORAGE_KEY));
  assert.equal(disk.db.tasks.find(task => task.id === 't007').status, 'completed');
  assert.equal(disk.db.creditEvents.filter(event => event.taskId === 't007').length, 1);
  assert.equal(Object.keys(disk.processedRequests).length, 1);
  assert.deepEqual(completed.creditAward, { userId: 'u004', before: 75, after: 77, delta: 2, appliedDelta: 2 });
  assert.equal(ok(await f.service.getTask('t007')).runner.credit, 77);
});

test('a newly published task completes end to end while its creation receipt stays replayable', async () => {
  const f = await setup();
  const input = { actorId: 'u001', requestId: 'published-flow-request', form: { category: 'express', title: '虚构新任务完整流程', description: '从公共驿站取演示小包裹，送至图书馆门口。',
    pickupLocationId: 'l001', dropoffLocationId: 'l003', reward: '3.50', goodsBudget: '', deadlineAt: anchor + 3600000 } };
  const created = await f.service.createTask(input);
  const taskId = ok(created).task.id;
  await f.service.switchDemoUser('u002');
  ok(await f.transition(taskId, 'accept', 1, { confirmed: true }, { actorId: 'u002' }));
  ok(await f.transition(taskId, 'start', 2, {}, { actorId: 'u002' }));
  ok(await f.transition(taskId, 'submit_completion', 3, { completionNote: '已完成虚构交付。' }, { actorId: 'u002' }));
  await f.service.switchDemoUser('u001');
  ok(await f.transition(taskId, 'confirm_completion', 4, { confirmed: true }));
  assert.deepEqual(await f.service.createTask(input), created);
  const task = ok(await f.service.getTask(taskId));
  assert.equal(task.status, 'completed');
  assert.equal(task.revision, 5);
  assert.equal(task.runner.credit, 82);
  assert.equal((await f.repository.read()).snapshot.db.creditEvents.filter(event => event.taskId === taskId).length, 1);
});

test('eight concurrent confirmations with the same request return the same result and write once', async () => {
  const f = await setup();
  const input = { taskId: 't007', action: 'confirm_completion', expectedRevision: 4, actorId: 'u001', requestId: 'same-confirmation', payload: { confirmed: true } };
  const results = await Promise.all(Array.from({ length: 8 }, () => f.service.transitionTask(input)));
  results.forEach(result => assert.deepEqual(result, results[0]));
  assert.equal(f.getWrites(), 1);
  assert.equal((await f.repository.read()).snapshot.db.creditEvents.filter(event => event.taskId === 't007').length, 1);
});

test('different request IDs and double acceptance cannot repeat the same state transition', async () => {
  const f = await setup({ actorId: 'u002' });
  const results = await Promise.all([f.transition('t001', 'accept', 1, { confirmed: true }), f.transition('t001', 'accept', 1, { confirmed: true })]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error.code, 'REVISION_CONFLICT');
  assert.equal(ok(await f.service.getTask('t001')).timeline.length, 2);
});

test('different confirmation requests after completion cannot add another credit event', async () => {
  const f = await setup();
  ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }));
  assert.equal((await f.transition('t007', 'confirm_completion', 4, { confirmed: true })).error.code, 'REVISION_CONFLICT');
  assert.equal((await f.transition('t007', 'confirm_completion', 5, { confirmed: true })).error.code, 'INVALID_STATE');
  assert.equal(ok(await f.service.getTask('t007')).runner.credit, 77);
  assert.equal(f.getWrites(), 1);
});

test('confirmation survives refresh and same-key retry without reissuing credit', async () => {
  const f = await setup();
  const input = { taskId: 't007', action: 'confirm_completion', expectedRevision: 4, actorId: 'u001', requestId: 'restore-confirmation', payload: { confirmed: true } };
  const first = await f.service.transitionTask(input);
  const restored = await setup({ initial: f.storage.get(STORAGE_KEY) });
  restored.setTime(anchor + 86400000);
  assert.deepEqual(await restored.service.transitionTask(input), first);
  assert.equal(restored.getWrites(), 0);
  assert.equal(ok(await restored.service.getTask('t007')).runner.credit, 77);
});

test('reusing the same request for different content is rejected without altering the first result', async () => {
  const f = await setup({ actorId: 'u002' });
  ok(await f.transition('t006', 'submit_completion', 3, { completionNote: '已完成虚构交付。' }, { requestId: 'same-delivery-request' }));
  const disk = f.storage.get(STORAGE_KEY);
  assert.equal((await f.transition('t006', 'submit_completion', 3, { completionNote: '另一份说明。' }, { requestId: 'same-delivery-request' })).error.code, 'REVISION_CONFLICT');
  assert.equal(f.storage.get(STORAGE_KEY), disk);
});

test('withdrawal clears runner, preserves history and permits another eligible runner to accept', async () => {
  const f = await setup();
  const withdrawn = ok(await f.transition('t005', 'withdraw', 2, { confirmed: true })).task;
  assert.equal(withdrawn.status, 'open');
  assert.equal(withdrawn.runnerId, null);
  assert.equal(withdrawn.revision, 3);
  assert.equal(withdrawn.timeline.at(-1).action, 'withdrawn');
  assert.equal(withdrawn.timeline.at(-1).actorId, 'u001');
  assert(ok(await f.service.listTasks()).tasks.some(task => task.id === 't005'));
  await f.service.switchDemoUser('u002');
  const reaccepted = ok(await f.transition('t005', 'accept', 3, { confirmed: true }, { actorId: 'u002' })).task;
  assert.equal(reaccepted.runnerId, 'u002');
  await f.service.switchDemoUser('u001');
  assert.equal((await f.transition('t005', 'start', 4)).error.code, 'FORBIDDEN');
});

test('withdrawal exactly at deadline records withdrawal then system expiry without credit changes', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot.db.creditEvents;
  f.setTime(anchor + 60 * 60000);
  const task = ok(await f.transition('t005', 'withdraw', 2, { confirmed: true })).task;
  assert.equal(task.status, 'expired');
  assert.equal(task.runnerId, null);
  assert.equal(task.revision, 3);
  assert.deepEqual(task.timeline.slice(-2).map(event => [event.action, event.actorId]), [['withdrawn', 'u001'], ['expired', null]]);
  assert.deepEqual((await f.repository.read()).snapshot.db.creditEvents, before);
});

test('cancellation before acceptance is terminal and never changes credit', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot.db.creditEvents;
  const result = ok(await f.transition('t001', 'cancel', 1, { confirmed: true }));
  assert.equal(result.task.status, 'cancelled');
  assert.equal(result.creditAward, null);
  assert.deepEqual(ok(await f.service.getTask('t001')).allowedActions, []);
  assert.deepEqual((await f.repository.read()).snapshot.db.creditEvents, before);
});

test('an already accepted task cannot be cancelled by its publisher', async () => {
  const f = await setup({ actorId: 'u003' });
  assert.equal((await f.transition('t005', 'cancel', 2, { confirmed: true })).error.code, 'INVALID_STATE');
  assert.equal(f.getWrites(), 0);
});

test('dispute requires reason, stores plain text and is terminal without automatic credit changes', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot.db.creditEvents;
  const reason = '  <b>虚构资料页数需要核对</b>  ';
  const result = ok(await f.transition('t007', 'dispute', 4, { disputeReason: reason }));
  assert.equal(result.task.status, 'disputed');
  assert.equal(result.task.disputeReason, reason.trim());
  assert.equal(result.task.completionNote, '已在约定公共地点交付（虚构演示）。');
  assert.deepEqual(ok(await f.service.getTask('t007')).allowedActions, []);
  assert.deepEqual((await f.repository.read()).snapshot.db.creditEvents, before);
});

test('notes must contain 1–500 characters and invalid notes preserve data and revision', async () => {
  for (const [actorId, taskId, action, revision, field] of [['u002', 't006', 'submit_completion', 3, 'completionNote'], ['u001', 't007', 'dispute', 4, 'disputeReason']]) {
    for (const value of [undefined, '', '   ', '字'.repeat(501), 123]) {
      const f = await setup({ actorId });
      const before = f.storage.get(STORAGE_KEY);
      const result = await f.transition(taskId, action, revision, { [field]: value });
      assert.equal(result.error.code, 'VALIDATION_ERROR');
      assert.equal(result.error.field, field);
      assert.equal(f.storage.get(STORAGE_KEY), before);
      assert.equal(f.getWrites(), 0);
    }
    const f = await setup({ actorId });
    assert.equal((await f.transition(taskId, action, revision, { [field]: '字'.repeat(500) })).ok, true);
  }
});

test('self acceptance, low credit and every wrong-role transition are rejected without mutation', async () => {
  for (const [actorId, taskId, action, revision, code] of [
    ['u001', 't001', 'accept', 1, 'SELF_ACCEPT'], ['u005', 't001', 'accept', 1, 'LOW_CREDIT'],
    ['u003', 't001', 'cancel', 1, 'FORBIDDEN'], ['u002', 't005', 'start', 2, 'FORBIDDEN'],
    ['u003', 't005', 'withdraw', 2, 'FORBIDDEN'], ['u004', 't006', 'submit_completion', 3, 'FORBIDDEN'],
    ['u004', 't007', 'confirm_completion', 4, 'FORBIDDEN'], ['u002', 't007', 'dispute', 4, 'FORBIDDEN'],
  ]) {
    const f = await setup({ actorId });
    const before = f.storage.get(STORAGE_KEY);
    const result = await f.transition(taskId, action, revision, { confirmed: true, completionNote: '已交付。', disputeReason: '待核对。' });
    assert.equal(result.error.code, code, `${actorId} ${action}`);
    assert.equal(f.storage.get(STORAGE_KEY), before);
    assert.equal(f.getWrites(), 0);
  }
});

test('cross-campus acceptance and spoofed active identities are rejected', async () => {
  const f = await setup({ actorId: 'u100', modify: snapshot => {
    snapshot.db.campuses.push({ id: 'c002', name: '另一虚构校区', fictional: true });
    snapshot.db.users.push({ ...snapshot.db.users[1], id: 'u100', campusId: 'c002' });
    snapshot.activeUserId = 'u100';
  } });
  assert.equal((await f.transition('t001', 'accept', 1, { confirmed: true }, { actorId: 'u100' })).error.code, 'FORBIDDEN');
  assert.equal((await f.transition('t001', 'accept', 1, { confirmed: true }, { actorId: 'u002' })).error.code, 'FORBIDDEN');
  assert.equal(f.getWrites(), 0);
});

test('accept, cancel, withdraw and completion confirmation require explicit boolean confirmation', async () => {
  for (const [taskId, action, revision] of [['t002', 'accept', 1], ['t001', 'cancel', 1], ['t005', 'withdraw', 2], ['t007', 'confirm_completion', 4]]) {
    const f = await setup();
    for (const value of [undefined, false, 'true', 1]) {
      assert.equal((await f.transition(taskId, action, revision, { confirmed: value })).error.code, 'CONFIRMATION_REQUIRED');
      assert.equal(f.getWrites(), 0);
    }
  }
});

test('stale revision and every illegal jump out of completed are rejected', async () => {
  const f = await setup();
  assert.equal((await f.transition('t005', 'start', 1)).error.code, 'REVISION_CONFLICT');
  assert.equal((await f.transition('t005', 'confirm_completion', 2, { confirmed: true })).error.code, 'INVALID_STATE');
  assert.equal((await f.transition('t001', 'submit_completion', 1, { completionNote: '不能跳过接单与开始。' })).error.code, 'INVALID_STATE');
  for (const action of ['accept', 'cancel', 'start', 'withdraw', 'submit_completion', 'confirm_completion', 'dispute']) {
    assert.equal((await f.transition('t008', action, 5, { confirmed: true, completionNote: '已交付。', disputeReason: '需核对。' })).error.code, 'INVALID_STATE');
  }
  assert.equal(f.getWrites(), 0);
});

test('acceptance at cutoff persists expiry once even though the requested action fails', async () => {
  const f = await setup({ actorId: 'u002' });
  f.setTime(anchor + 40 * 60000);
  assert.equal((await f.transition('t001', 'accept', 1, { confirmed: true })).error.code, 'TASK_EXPIRED');
  assert.equal((await f.transition('t001', 'accept', 1, { confirmed: true })).error.code, 'TASK_EXPIRED');
  assert.equal(f.getWrites(), 1);
  const disk = JSON.parse(f.storage.get(STORAGE_KEY)).db.tasks.find(task => task.id === 't001');
  assert.equal(disk.status, 'expired');
  assert.equal(disk.runnerId, null);
  assert.equal(disk.revision, 2);
  assert.equal(disk.timeline.at(-1).actorId, null);
});

test('acceptance just before cutoff works and accepted tasks can start after their deadline', async () => {
  const f = await setup({ actorId: 'u002' });
  f.setTime(anchor + 40 * 60000 - 1);
  ok(await f.transition('t001', 'accept', 1, { confirmed: true }));
  f.setTime(anchor + 50 * 60000);
  ok(await f.transition('t001', 'start', 2));
  const task = ok(await f.service.getTask('t001'));
  assert.equal(task.status, 'in_progress');
  assert.equal(task.isOverdue, true);
});

test('accepted runners below the acceptance credit threshold can still complete their existing work', async () => {
  const f = await setup({ modify: snapshot => { snapshot.db.users.find(user => user.id === 'u001').creditBase = 56; } });
  assert.deepEqual(ok(await f.service.getTask('t005')).allowedActions, ['start', 'withdraw']);
  ok(await f.transition('t005', 'start', 2));
  ok(await f.transition('t005', 'submit_completion', 3, { completionNote: '演示交接已完成。' }));
});

test('credit caps at 100 while the unique event still records the +2 rule', async () => {
  for (const [before, after, appliedDelta] of [[99, 100, 1], [100, 100, 0]]) {
    const f = await setup({ modify: snapshot => { snapshot.db.users.find(user => user.id === 'u004').creditBase = before; } });
    const result = ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }));
    assert.equal(result.creditAward.after, after);
    assert.equal(result.creditAward.appliedDelta, appliedDelta);
    assert.equal((await f.repository.read()).snapshot.db.creditEvents.find(event => event.taskId === 't007').delta, 2);
  }
});

test('storage failure retains complete task and credit in memory and leaves the old disk snapshot untouched', async () => {
  const f = await setup({ failWrites: true });
  const before = f.storage.get(STORAGE_KEY);
  const result = ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }, { requestId: 'memory-confirmation' }));
  assert.equal(result.persistence.mode, 'memory');
  assert.equal(f.storage.get(STORAGE_KEY), before);
  assert.equal(ok(await f.service.getTask('t007')).runner.credit, 77);
  assert.equal((await f.repository.read()).snapshot.db.creditEvents.filter(event => event.taskId === 't007').length, 1);
  assert.equal(ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }, { requestId: 'memory-confirmation' })).task.status, 'completed');
});

test('replayed earlier actions return original results while detail reads preserve the latest state', async () => {
  const f = await setup({ actorId: 'u002' });
  const input = { taskId: 't001', actorId: 'u002', action: 'accept', expectedRevision: 1, requestId: 'earlier-acceptance', payload: { confirmed: true } };
  const original = await f.service.transitionTask(input);
  ok(await f.transition('t001', 'start', 2));
  assert.deepEqual(await f.service.transitionTask(input), original);
  assert.equal(ok(await f.service.getTask('t001')).status, 'in_progress');
});

test('a backwards clock cannot reorder the task timeline or break credit timestamps', async () => {
  const f = await setup({ actorId: 'u002' });
  f.setTime(anchor + 60000);
  ok(await f.transition('t001', 'accept', 1, { confirmed: true }));
  f.setTime(anchor);
  const task = ok(await f.transition('t001', 'start', 2)).task;
  assert(task.timeline.at(-1).at >= task.timeline.at(-2).at);
});

test('malformed transition inputs, missing tasks and corrupted cached records are recoverable', async () => {
  const f = await setup();
  for (const extra of [{ action: '__proto__' }, { expectedRevision: 0 }, { requestId: 'bad/id' }, { payload: [] }]) {
    assert.equal((await f.transition('t007', 'confirm_completion', 4, { confirmed: true }, extra)).error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await f.transition('missing', 'confirm_completion', 4, { confirmed: true })).error.code, 'NOT_FOUND');
  ok(await f.transition('t007', 'confirm_completion', 4, { confirmed: true }, { requestId: '__proto__' }));
  const snapshot = JSON.parse(f.storage.get(STORAGE_KEY));
  assert(Object.hasOwn(snapshot.processedRequests, 'transitionTask:__proto__'));
  delete snapshot.processedRequests['transitionTask:__proto__'].result;
  const damaged = JSON.stringify(snapshot);
  let writes = 0;
  const repo = createMockRepository({ getStorage: () => ({ getItem: () => damaged, setItem: () => { writes++; } }) });
  const result = await createDemoService(repo).initialize();
  assert.equal(result.error.code, 'SNAPSHOT_INVALID');
  assert.equal(writes, 0);
});
