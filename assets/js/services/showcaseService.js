import { fetchSeed } from '../data/mockRepository.js';
import { copy, DemoError, initializeSnapshot } from '../data/snapshot.js';
import { TASK_STATUS_LABELS } from './taskService.js';
import { profileFor } from './profileSelectors.js';
import { serviceResult } from './result.js';

// A fixed reference for sample conversion, never the visitor's clock or saved session.
const SAMPLE_ANCHOR = Date.parse('2026-10-18T12:00:00+08:00');

export function createShowcaseService({ loadSeed = fetchSeed } = {}) {
  let pending;
  async function readSamples() {
    if (!pending) pending = Promise.resolve().then(loadSeed).then(seed => initializeSnapshot(seed, SAMPLE_ANCHOR).db);
    try { return await pending; }
    catch { pending = undefined; throw new DemoError('SAMPLE_LOAD_FAILED', '样例暂时未能加载，请检查网络后重试。你的体验记录未受影响。'); }
  }
  function describe(task, db) {
    return { ...task, statusLabel: TASK_STATUS_LABELS[task.status],
      categoryLabel: db.categories.find(category => category.id === task.category).name,
      campus: db.campuses.find(campus => campus.id === task.campusId),
      pickup: db.locations.find(location => location.id === task.pickupLocationId),
      dropoff: db.locations.find(location => location.id === task.dropoffLocationId),
      publisher: profileFor(db, task.publisherId), runner: profileFor(db, task.runnerId),
      durationMinutes: Math.round((task.deadlineAt - task.createdAt) / 60000),
      timeline: task.timeline.map(event => ({ ...event,
        elapsedMinutes: Math.round((event.at - task.createdAt) / 60000),
        actorName: db.users.find(user => user.id === event.actorId)?.nickname ?? '系统' })),
      reviews: db.reviews.filter(review => review.taskId === task.id).map(review => ({ ...review,
        authorName: db.users.find(user => user.id === review.authorId).nickname,
        targetName: db.users.find(user => user.id === review.targetUserId).nickname })),
      creditEvent: db.creditEvents.find(event => event.taskId === task.id) ?? null };
  }
  return {
    listExamples: (status = '') => serviceResult(async () => {
      if (status !== '' && !Object.hasOwn(TASK_STATUS_LABELS, status)) throw new DemoError('VALIDATION_ERROR', '请选择有效的样例状态。');
      const db = await readSamples();
      return copy({ tasks: db.tasks.filter(task => !status || task.status === status).map(task => describe(task, db)),
        total: db.tasks.length, users: db.users.length, reviews: db.reviews.length,
        statuses: Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label,
          count: db.tasks.filter(task => task.status === value).length })) });
    }),
    getExample: taskId => serviceResult(async () => {
      const db = await readSamples();
      const task = db.tasks.find(item => item.id === taskId);
      if (!task) throw new DemoError('NOT_FOUND', '没有找到这个固定样例，请返回样例展示选择。');
      return copy(describe(task, db));
    }),
  };
}
