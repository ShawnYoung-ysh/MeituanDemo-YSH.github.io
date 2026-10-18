import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const db = JSON.parse(await readFile(new URL('../mock/db.json', import.meta.url), 'utf8'));
const index = (rows, label) => {
  assert(Array.isArray(rows) && rows.length > 0, `${label}: 非空数组`);
  const map = new Map();
  for (const row of rows) {
    assert(typeof row.id === 'string' && row.id.length && !map.has(row.id), `${label}: ID 缺失或重复`);
    map.set(row.id, row);
  }
  return map;
};
const campuses = index(db.campuses, '校区');
const locations = index(db.locations, '地点');
const users = index(db.users, '用户');
const categories = index(db.categories, '类别');
const tasks = index(db.tasks, '任务');
index(db.reviews, '评价');
index(db.creditEvents, '信用事件');
assert.equal(db.meta.schemaVersion, 1);
assert.equal(db.meta.fictional, true);
assert.equal(db.meta.timeMode, 'relative-minutes');
assert(users.has(db.meta.defaultUserId), '默认用户不存在');
for (const campus of campuses.values()) assert.equal(campus.fictional, true);
for (const location of locations.values()) assert(campuses.has(location.campusId) && location.fictional === true, `地点 ${location.id} 校区或虚构标记错误`);
for (const user of users.values()) {
  assert(campuses.has(user.campusId), `用户 ${user.id} 校区不存在`);
  assert(Number.isInteger(user.creditBase) && user.creditBase >= 0 && user.creditBase <= 100, '信用基数错误');
  assert.equal(user.campusVerification, 'demo_unverified', 'Mock 不能伪称校园认证');
}
const endAction = { open: 'published', accepted: 'accepted', in_progress: 'started', awaiting_confirmation: 'completion_submitted', completed: 'completed', cancelled: 'cancelled', expired: 'expired', disputed: 'disputed' };
const needsRunner = new Set(['accepted', 'in_progress', 'awaiting_confirmation', 'completed', 'disputed']);
for (const task of tasks.values()) {
  assert(Object.hasOwn(endAction, task.status), `任务 ${task.id} 状态未知`);
  assert(categories.has(task.category), '类别不存在');
  assert.equal(users.get(task.publisherId)?.campusId, task.campusId, '发布者校区错误');
  assert.equal(locations.get(task.pickupLocationId)?.campusId, task.campusId, '取件地点错误');
  assert.equal(locations.get(task.dropoffLocationId)?.campusId, task.campusId, '送达地点错误');
  if (needsRunner.has(task.status)) {
    assert.equal(users.get(task.runnerId)?.campusId, task.campusId, '接单者或校区错误');
    assert.notEqual(task.runnerId, task.publisherId, '不能自己接单');
  } else assert.equal(task.runnerId, null, '当前种子中的未接单或取消任务应无接单者');
  assert(task.title.length >= 4 && task.title.length <= 60 && task.description.length >= 10 && task.description.length <= 500, '标题/描述长度错误');
  assert(Number.isInteger(task.rewardCents) && task.rewardCents >= 0 && task.rewardCents <= 5000, '酬谢金额错误');
  assert(Number.isInteger(task.goodsBudgetCents) && task.goodsBudgetCents >= 0, '商品预算错误');
  for (const key of ['createdOffsetMinutes', 'deadlineOffsetMinutes', 'updatedOffsetMinutes']) assert(Number.isInteger(task[key]), `时间字段 ${key} 错误`);
  assert(task.deadlineOffsetMinutes > task.createdOffsetMinutes, '截止早于发布');
  assert(Number.isInteger(task.revision) && task.revision > 0, 'revision 错误');
  index(task.timeline, `任务 ${task.id} 时间线`);
  assert.equal(task.timeline[0].action, 'published');
  assert.equal(task.timeline[0].atOffsetMinutes, task.createdOffsetMinutes);
  assert.equal(task.timeline.at(-1).action, endAction[task.status]);
  assert.equal(task.timeline.at(-1).atOffsetMinutes, task.updatedOffsetMinutes);
  let previous = -Infinity;
  for (const event of task.timeline) {
    assert(Number.isInteger(event.atOffsetMinutes) && event.atOffsetMinutes >= previous && event.atOffsetMinutes <= 0, '时间线顺序错误');
    if (event.action === 'expired') assert.equal(event.actorId, null);
    else assert([task.publisherId, task.runnerId].includes(event.actorId) && users.has(event.actorId), '时间线执行人不是参与者');
    previous = event.atOffsetMinutes;
  }
  if (task.status === 'expired') assert(task.deadlineOffsetMinutes <= 0);
  if (task.status === 'open') assert(task.deadlineOffsetMinutes > 0);
  if (['awaiting_confirmation', 'completed', 'disputed'].includes(task.status)) assert(task.completionNote?.length > 0);
  if (task.status === 'disputed') assert(task.disputeReason?.length > 0);
}
const reviewers = new Set();
for (const review of db.reviews) {
  const task = tasks.get(review.taskId);
  assert(task?.status === 'completed', '只有完成任务可以评价');
  const participants = [task.publisherId, task.runnerId];
  assert(participants.includes(review.authorId) && participants.includes(review.targetUserId) && review.authorId !== review.targetUserId, '评价双方错误');
  const key = `${review.taskId}:${review.authorId}`;
  assert(!reviewers.has(key), '评价重复'); reviewers.add(key);
  assert(Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5, '评分错误');
  assert(Number.isInteger(review.createdOffsetMinutes) && review.createdOffsetMinutes >= task.updatedOffsetMinutes && review.createdOffsetMinutes <= 0, '评价时间错误');
}
const credited = new Set();
for (const event of db.creditEvents) {
  const task = tasks.get(event.taskId);
  assert(task?.status === 'completed' && task.runnerId === event.userId, '信用事件关联错误');
  assert.equal(event.type, 'task_completed'); assert.equal(event.delta, 2);
  assert.equal(event.createdOffsetMinutes, task.updatedOffsetMinutes, '信用事件应与确认完成一起产生');
  assert(!credited.has(event.taskId), '信用重复发放'); credited.add(event.taskId);
}
for (const task of tasks.values()) if (task.status === 'completed') assert(credited.has(task.id), '已完成任务缺少信用事件');
console.log(`PASS Mock：${users.size} 个用户、${tasks.size} 个任务、${db.reviews.length} 条评价、${credited.size} 条信用事件；关联、角色、状态、时间、金额与唯一性检查通过。`);
