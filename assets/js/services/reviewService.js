import { copy, DemoError } from '../data/snapshot.js';
import { serviceResult } from './result.js';
import { profileFor } from './profileSelectors.js';

export function validateReview({ rating, comment } = {}) {
  const fields = {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = '请选择 1–5 星评分。';
  if (typeof comment !== 'string' || comment.trim().length > 300) fields.comment = '评价文字最多 300 字，可留空。';
  return { fields, rating, comment: typeof comment === 'string' ? comment.trim() : '' };
}

export function reviewContextFor(db, task, actorId) {
  const participant = [task.publisherId, task.runnerId].includes(actorId);
  const reviews = db.reviews.filter(review => review.taskId === task.id).map(review => ({ ...review,
    authorName: db.users.find(user => user.id === review.authorId).nickname,
    targetName: db.users.find(user => user.id === review.targetUserId).nickname }));
  const ownReview = reviews.find(review => review.authorId === actorId) ?? null;
  const targetId = participant ? (actorId === task.publisherId ? task.runnerId : task.publisherId) : null;
  return { reviews, ownReview, canReview: task.status === 'completed' && participant && !ownReview,
    target: profileFor(db, targetId),
    reason: task.status !== 'completed' ? '任务完成后，发布同学和跑腿同学各可评价一次。'
      : !participant ? '只有这条任务的发布同学和跑腿同学可以评价。'
        : ownReview ? '你已评价，不能重复提交。' : '双方各可评价一次，评价不改变信用。' };
}

export function createReviewService(repository, { now = Date.now, newId = () => crypto.randomUUID() } = {}) {
  return {
    addReview: input => serviceResult(async () => {
      if (!input || typeof input !== 'object') throw new DemoError('VALIDATION_ERROR', '评价参数不正确。');
      const { taskId, actorId, rating, comment = '', requestId } = input;
      if (typeof taskId !== 'string' || !taskId || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new DemoError('VALIDATION_ERROR', '任务或评价请求标识无效。');
      const fingerprint = JSON.stringify([taskId, actorId, rating, comment]);
      const key = `addReview:${requestId}`;
      const state = await repository.update(next => {
        if (actorId !== next.activeUserId || !next.db.users.some(user => user.id === actorId)) throw new DemoError('FORBIDDEN', '演示身份已变化，请重新打开任务再评价。');
        const task = next.db.tasks.find(item => item.id === taskId);
        if (!task) throw new DemoError('NOT_FOUND', '任务不存在，可能已在重置后移除。');
        if (Object.hasOwn(next.processedRequests, key)) {
          const receipt = next.processedRequests[key];
          if (receipt.fingerprint !== fingerprint || receipt.actorId !== actorId) throw new DemoError('REVISION_CONFLICT', '这次请求已用于其他评价内容。');
          return false;
        }
        if (task.status !== 'completed') throw new DemoError('INVALID_STATE', '任务尚未完成，暂不能评价。');
        if (![task.publisherId, task.runnerId].includes(actorId)) throw new DemoError('FORBIDDEN', '只有任务双方可以评价。');
        if (next.db.reviews.some(review => review.taskId === taskId && review.authorId === actorId)) throw new DemoError('ALREADY_REVIEWED', '你已评价这条任务，不能重复提交。');
        const validated = validateReview({ rating, comment });
        const field = Object.keys(validated.fields)[0];
        if (field) throw new DemoError('VALIDATION_ERROR', validated.fields[field], { field, fields: validated.fields });
        const id = `r-${newId()}`;
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || next.db.reviews.some(review => review.id === id)) throw new DemoError('INTERNAL_ERROR', '评价编号生成失败，请重试。');
        const review = { id, taskId, authorId: actorId, targetUserId: actorId === task.publisherId ? task.runnerId : task.publisherId,
          rating: validated.rating, comment: validated.comment, createdAt: Math.max(now(), task.updatedAt) };
        next.db.reviews.push(review);
        next.processedRequests[key] = { operation: 'addReview', actorId, taskId, fingerprint, result: copy(review) };
        // Reviews never update task revision, completion timestamp or credit events.
      });
      return { review: state.snapshot.processedRequests[key].result, persistence: state.persistence };
    }),
    getProfile: userId => serviceResult(async () => {
      const { snapshot, persistence } = await repository.read();
      const id = userId ?? snapshot.activeUserId;
      const { db } = snapshot;
      const profile = profileFor(db, id);
      if (!profile) throw new DemoError('NOT_FOUND', '未找到这位演示同学。');
      // The append order is booking order, even when the device clock moves back.
      const creditEvents = db.creditEvents.filter(event => event.userId === id);
      let balance = profile.creditBase;
      const entries = creditEvents.map(event => {
        const before = balance;
        balance = Math.min(100, balance + event.delta);
        return { ...event, taskTitle: db.tasks.find(task => task.id === event.taskId).title, before, after: balance, appliedDelta: balance - before };
      }).reverse();
      const reviews = db.reviews.filter(review => review.targetUserId === id)
        .map(review => ({ ...review, authorName: db.users.find(user => user.id === review.authorId).nickname,
          taskTitle: db.tasks.find(task => task.id === review.taskId).title }))
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return { ...profile, campus: db.campuses.find(campus => campus.id === profile.campusId), creditEvents: entries, reviews, persistence };
    }),
  };
}
