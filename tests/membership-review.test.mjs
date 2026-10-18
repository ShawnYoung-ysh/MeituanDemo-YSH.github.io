import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockRepository } from '../assets/js/data/mockRepository.js';
import { initializeSnapshot, STORAGE_KEY } from '../assets/js/data/snapshot.js';
import { createDemoService } from '../assets/js/services/demoService.js';

const seed = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const anchor = Date.parse('2026-10-19T09:00:00+08:00');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };
async function setup({ actorId = 'u001', raw, modify, failWrites = false, time = anchor } = {}) {
  let sequence = 0, writes = 0;
  const snapshot = initializeSnapshot(seed, anchor);
  snapshot.activeUserId = actorId;
  modify?.(snapshot);
  const storage = new Map([[STORAGE_KEY, raw ?? JSON.stringify(snapshot)]]);
  const repository = createMockRepository({ loadSeed: async () => seed, now: () => time,
    getStorage: () => ({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { writes++; if (failWrites) throw Error('quota'); storage.set(key, value); } }) });
  const service = createDemoService(repository, { now: () => time, newId: () => `new-${++sequence}` });
  const initialized = await service.initialize();
  const review = (extra = {}) => service.addReview({ taskId: 't009', actorId, rating: 5, comment: '  谢谢同学。  ', requestId: `review-key-${++sequence}`, ...extra });
  return { service, repository, storage, initialized, review, writes: () => writes };
}

test('my tasks separate publisher and runner, count every state and compose filters', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot;
  for (const role of ['publisher', 'runner']) {
    const data = ok(await f.service.listMyTasks({ role }));
    const expected = before.db.tasks.filter(task => task[role === 'publisher' ? 'publisherId' : 'runnerId'] === 'u001');
    assert.equal(data.total, expected.length);
    assert.deepEqual(data.tasks.map(task => task.id).sort(), expected.map(task => task.id).sort());
    assert.equal(Object.values(data.counts).reduce((a, b) => a + b, 0), data.total);
    for (const status of Object.keys(data.counts)) {
      const filtered = ok(await f.service.listMyTasks({ role, status }));
      assert.equal(filtered.tasks.length, data.counts[status]);
      assert.ok(filtered.tasks.every(task => task.status === status));
      assert.equal(filtered.total, data.total);
    }
  }
});

test('my tasks retain overdue active work and expired history while hall hides them', async () => {
  const f = await setup({ time: anchor + 86400000 });
  const mine = ok(await f.service.listMyTasks());
  assert.ok(mine.tasks.some(task => task.status === 'expired'));
  const runner = ok(await f.service.listMyTasks({ role: 'runner' }));
  assert.ok(runner.tasks.some(task => task.isOverdue));
  assert.equal(ok(await f.service.listTasks()).tasks.length, 0);
});

test('identity controls list scope, withdrawal removes current runner membership and empty lists work', async () => {
  const f = await setup();
  const task = ok(await f.service.getTask('t005'));
  ok(await f.service.transitionTask({ taskId: task.id, actorId: 'u001', action: 'withdraw', expectedRevision: task.revision, requestId: 'withdraw-test', payload: { confirmed: true } }));
  assert.ok(!ok(await f.service.listMyTasks({ role: 'runner' })).tasks.some(task => task.id === 't005'));
  ok(await f.service.switchDemoUser('u005'));
  assert.equal(ok(await f.service.listMyTasks({ role: 'runner' })).total, 0);
  assert.ok(ok(await f.service.listMyTasks()).tasks.every(task => task.publisherId === 'u005'));
  for (const filters of [null, [], { role: 'other' }, { status: '__proto__' }, { status: 2 }]) assert.equal((await f.service.listMyTasks(filters)).error.code, 'VALIDATION_ERROR');
});

test('profiles derive initial credit, both completion counts and received scores independently', async () => {
  const f = await setup();
  const expected = [82, 80, 84, 75, 58];
  const { db } = (await f.repository.read()).snapshot;
  for (let i = 0; i < db.users.length; i++) {
    const profile = ok(await f.service.getProfile(db.users[i].id));
    assert.equal(profile.credit, expected[i]);
    assert.equal(profile.completedAsPublisher, db.tasks.filter(task => task.status === 'completed' && task.publisherId === profile.id).length);
    assert.equal(profile.completedAsRunner, db.tasks.filter(task => task.status === 'completed' && task.runnerId === profile.id).length);
    assert.equal(profile.reviewCount, db.reviews.filter(review => review.targetUserId === profile.id).length);
  }
  const mine = ok(await f.service.getProfile());
  assert.equal(mine.id, 'u001'); assert.equal(mine.rating, 4.5);
  assert.equal(mine.creditEvents[0].after, 82);
  assert.equal(ok(await f.service.getProfile('u005')).rating, null);
  assert.equal((await f.service.getProfile('missing')).error.code, 'NOT_FOUND');
  assert.equal(f.writes(), 0, 'queries must not reissue seeded credit');
});

test('review writes once, trims plain text, derives the other party and never changes task or credit', async () => {
  const f = await setup();
  const before = (await f.repository.read()).snapshot;
  const review = ok(await f.review({ comment: '  <b>谢谢</b>  ' })).review;
  assert.equal(review.targetUserId, 'u003'); assert.equal(review.comment, '<b>谢谢</b>');
  assert.equal(f.writes(), 1);
  const after = (await f.repository.read()).snapshot;
  assert.deepEqual(after.db.tasks, before.db.tasks);
  assert.deepEqual(after.db.creditEvents, before.db.creditEvents);
  assert.equal(after.db.reviews.length, before.db.reviews.length + 1);
  assert.equal(ok(await f.service.getProfile('u003')).rating, 5);
  const context = ok(await f.service.getTask('t009')).reviewContext;
  assert.equal(context.canReview, false); assert.equal(context.ownReview.id, review.id);
});

test('both parties can independently review a new completed task, without overwriting', async () => {
  const f = await setup({ modify: snapshot => { snapshot.db.reviews = []; } });
  const first = ok(await f.review({ taskId: 't008' })).review;
  ok(await f.service.switchDemoUser('u002'));
  const context = ok(await f.service.getTask('t008')).reviewContext;
  assert.equal(context.canReview, true); assert.equal(context.target.id, 'u001');
  const second = ok(await f.review({ taskId: 't008', actorId: 'u002', rating: 3, comment: '' })).review;
  assert.notEqual(first.id, second.id);
  assert.equal(second.targetUserId, 'u001');
  assert.equal(ok(await f.service.getTask('t008')).reviewContext.reviews.length, 2);
  assert.equal(ok(await f.service.getProfile('u001')).rating, 3);
  assert.equal(ok(await f.service.getProfile('u002')).rating, 5);
});

test('eight same-key retries and reloaded retries return the original review with one write', async () => {
  const f = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.review({ requestId: 'same-review-key' })));
  for (const result of results) assert.deepEqual(ok(result), ok(results[0]));
  assert.equal(f.writes(), 1);
  const reloaded = await setup({ raw: f.storage.get(STORAGE_KEY) });
  assert.deepEqual(ok(await reloaded.review({ requestId: 'same-review-key' })).review, ok(results[0]).review);
  assert.equal(reloaded.writes(), 0);
});

test('different requests cannot review twice, and same request with changed content conflicts', async () => {
  const f = await setup();
  ok(await f.review({ requestId: 'original-key' }));
  assert.equal((await f.review()).error.code, 'ALREADY_REVIEWED');
  assert.equal((await f.review({ requestId: 'original-key', rating: 1 })).error.code, 'REVISION_CONFLICT');
  assert.equal(f.writes(), 1);
});

test('nonparticipants, stale identities, incomplete tasks and seed reviews cannot be submitted', async () => {
  const f = await setup();
  assert.equal((await f.review({ taskId: 't008' })).error.code, 'ALREADY_REVIEWED');
  assert.equal((await f.review({ taskId: 't001' })).error.code, 'INVALID_STATE');
  assert.equal((await f.review({ taskId: 'missing' })).error.code, 'NOT_FOUND');
  assert.equal((await f.review({ actorId: 'u003' })).error.code, 'FORBIDDEN');
  ok(await f.service.switchDemoUser('u005'));
  assert.equal((await f.review({ actorId: 'u005' })).error.code, 'FORBIDDEN');
  const context = ok(await f.service.getTask('t009')).reviewContext;
  assert.equal(context.canReview, false); assert.equal(context.ownReview, null);
});

test('rating integers 1–5 and optional text 0–300 are enforced before writes', async () => {
  for (const rating of [0, 6, 1.5, '5', null, true]) {
    const f = await setup();
    assert.equal((await f.review({ rating })).error.field, 'rating'); assert.equal(f.writes(), 0);
  }
  for (const comment of ['x'.repeat(301), null, 123, {}]) {
    const f = await setup();
    assert.equal((await f.review({ comment })).error.field, 'comment'); assert.equal(f.writes(), 0);
  }
  for (const [rating, comment] of [[1, ''], [5, 'x'.repeat(300)], [3, '   ']]) {
    const f = await setup();
    assert.equal(ok(await f.review({ rating, comment })).review.comment, comment.trim());
  }
});

test('review write failure uses memory, preserves saved data and never reissues credit', async () => {
  const f = await setup({ failWrites: true });
  const original = f.storage.get(STORAGE_KEY);
  const result = ok(await f.review());
  assert.equal(result.persistence.mode, 'memory'); assert.equal(f.storage.get(STORAGE_KEY), original);
  assert.equal((await f.repository.read()).snapshot.db.reviews.length, 4);
  assert.equal(ok(await f.service.getProfile()).credit, 82);
});

test('credit ledger explains cap and backwards-clock review keeps completion timestamps valid', async () => {
  const f = await setup({ time: anchor - 86400000, modify: snapshot => { snapshot.db.users.find(user => user.id === 'u001').creditBase = 99; } });
  const profile = ok(await f.service.getProfile());
  assert.equal(profile.credit, 100); assert.equal(profile.creditEvents[0].delta, 2); assert.equal(profile.creditEvents[0].appliedDelta, 1);
  const task = ok(await f.service.getTask('t009'));
  const review = ok(await f.review()).review;
  assert.equal(review.createdAt, task.updatedAt);
  assert.equal(ok(await f.service.getProfile()).credit, 100);
});

test('ledger follows booking order when clock timestamps regress near the credit cap', async () => {
  const f = await setup({ modify: snapshot => {
    snapshot.db.reviews = [];
    snapshot.db.users.find(user => user.id === 'u002').creditBase = 99;
    const task = snapshot.db.tasks.find(task => task.id === 't009');
    task.runnerId = 'u002';
    for (const field of ['createdAt', 'updatedAt', 'deadlineAt']) task[field] -= 3600000;
    task.timeline.forEach(event => { event.at -= 3600000; if (event.actorId === 'u001') event.actorId = 'u002'; });
    const credit = snapshot.db.creditEvents.find(event => event.taskId === 't009');
    credit.userId = 'u002'; credit.createdAt = task.updatedAt;
  } });
  const profile = ok(await f.service.getProfile('u002'));
  assert.deepEqual(profile.creditEvents.map(event => [event.taskId, event.appliedDelta]), [['t009', 0], ['t008', 1]]);
  assert.equal(profile.credit, 100);
});

test('malformed review requests and ID collisions never create a partial record', async () => {
  const f = await setup();
  for (const input of [null, [], {}, { taskId: 't009', requestId: 'bad/id' }]) assert.equal((await f.service.addReview(input)).error.code, 'VALIDATION_ERROR');
  assert.equal(f.writes(), 0);
  const colliding = createDemoService(f.repository, { newId: () => '001' });
  const input = { taskId: 't009', actorId: 'u001', rating: 4, comment: '', requestId: '__proto__' };
  ok(await colliding.addReview(input));
  assert.equal(Object.hasOwn((await f.repository.read()).snapshot.processedRequests, 'addReview:__proto__'), true);
  const original = (await f.repository.read()).snapshot;
  await f.service.switchDemoUser('u002');
  // Remove the existing author review to reach the collision guard on another task.
  await f.repository.update(next => { next.db.reviews = next.db.reviews.filter(review => !(review.taskId === 't008' && review.authorId === 'u002')); });
  assert.equal((await colliding.addReview({ ...input, taskId: 't008', actorId: 'u002', requestId: 'collision-test' })).error.code, 'INTERNAL_ERROR');
  assert.equal((await f.repository.read()).snapshot.db.reviews.length, original.db.reviews.length - 1);
});

test('damaged review receipts are recoverable without silently overwriting saved data', async () => {
  const f = await setup(); ok(await f.review({ requestId: 'receipt-test' }));
  const snapshot = JSON.parse(f.storage.get(STORAGE_KEY));
  snapshot.processedRequests['addReview:receipt-test'].result.rating = 1;
  const raw = JSON.stringify(snapshot);
  const broken = await setup({ raw });
  assert.equal(broken.initialized.error.code, 'SNAPSHOT_INVALID'); assert.equal(broken.storage.get(STORAGE_KEY), raw);
});

test('external edits or removal block stale writes and reset until reload', async () => {
  for (const remove of [false, true]) {
    const f = await setup();
    if (remove) f.storage.delete(STORAGE_KEY);
    else { const snapshot = JSON.parse(f.storage.get(STORAGE_KEY)); snapshot.activeUserId = 'u002'; f.storage.set(STORAGE_KEY, JSON.stringify(snapshot)); }
    const external = f.storage.get(STORAGE_KEY);
    assert.equal((await f.review()).error.code, 'EXTERNAL_CHANGE');
    assert.equal((await f.service.resetDemo(true)).error.code, 'EXTERNAL_CHANGE');
    assert.equal(f.storage.get(STORAGE_KEY), external); assert.equal(f.writes(), 0);
  }
});

test('explicit storage-event invalidation prevents queued reads, mutations and resets', async () => {
  const f = await setup(); f.repository.invalidate();
  assert.equal((await f.service.getSession()).error.code, 'EXTERNAL_CHANGE');
  assert.equal((await f.review()).error.code, 'EXTERNAL_CHANGE');
  assert.equal((await f.service.resetDemo(true)).error.code, 'EXTERNAL_CHANGE');
  assert.equal(f.writes(), 0);
});

test('publish through both reviews stays consistent in hall, membership, profiles, reload and reset', async () => {
  const f = await setup();
  const task = ok(await f.service.createTask({ actorId: 'u001', requestId: 'publish-flow-key', form: { category: 'express', title: '完整主流程演示任务', description: '用于验证发布到双方评价的完整演示主流程。', pickupLocationId: 'l001', dropoffLocationId: 'l003', deadlineAt: anchor + 3600000, reward: '3' } })).task;
  assert.ok(ok(await f.service.listTasks()).tasks.some(item => item.id === task.id));
  assert.ok(ok(await f.service.listMyTasks()).tasks.some(item => item.id === task.id));
  ok(await f.service.switchDemoUser('u002'));
  for (const [index, action, payload] of [[1, 'accept', { confirmed: true }], [2, 'start', {}], [3, 'submit_completion', { completionNote: '已在公共地点完成交付。' }]]) {
    ok(await f.service.transitionTask({ taskId: task.id, actorId: 'u002', action, expectedRevision: index, requestId: `flow-${action}`, payload }));
    assert.ok(ok(await f.service.listMyTasks({ role: 'runner' })).tasks.some(item => item.id === task.id));
  }
  assert.ok(!ok(await f.service.listTasks()).tasks.some(item => item.id === task.id));
  ok(await f.service.switchDemoUser('u001'));
  ok(await f.service.transitionTask({ taskId: task.id, actorId: 'u001', action: 'confirm_completion', expectedRevision: 4, requestId: 'flow-confirm', payload: { confirmed: true } }));
  ok(await f.review({ taskId: task.id }));
  ok(await f.service.switchDemoUser('u002'));
  ok(await f.review({ taskId: task.id, actorId: 'u002', rating: 4 }));
  const restored = await setup({ raw: f.storage.get(STORAGE_KEY) });
  assert.equal(ok(await restored.service.getTask(task.id)).reviewContext.reviews.length, 2);
  assert.equal(ok(await restored.service.getProfile()).credit, 82);
  ok(await restored.service.resetDemo(true));
  const reset = (await restored.repository.read()).snapshot;
  assert.equal(reset.activeUserId, 'u001'); assert.equal(reset.db.tasks.length, 12); assert.equal(reset.db.reviews.length, 3); assert.equal(reset.db.creditEvents.length, 2);
  assert.deepEqual(reset.processedRequests, {});
});
