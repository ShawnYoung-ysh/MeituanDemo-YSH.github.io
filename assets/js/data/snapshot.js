export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'campus-errand-demo:v1';

export class DemoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DemoError';
    this.code = code;
    this.field = details.field;
    this.fields = details.fields;
  }
}

export const copy = value => structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => Number.isSafeInteger(value) && value > 0;
const requireValue = condition => {
  if (!condition) throw new DemoError('SNAPSHOT_INVALID', '本机演示记录已损坏。原记录已保留，你可以重试读取，或确认后重置演示。');
};
const indexed = (rows, allowEmpty = false) => {
  requireValue(Array.isArray(rows) && (allowEmpty || rows.length > 0));
  const result = new Map();
  for (const row of rows) {
    requireValue(record(row) && text(row.id) && !result.has(row.id));
    result.set(row.id, row);
  }
  return result;
};

// Validate before rendering or replacing storage, including cross-collection links.
export function validateSnapshot(snapshot) {
  requireValue(record(snapshot));
  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new DemoError('SCHEMA_UNSUPPORTED', '本机记录版本与当前演示不兼容。原记录已保留，请确认后重置演示。');
  }
  requireValue(text(snapshot.datasetVersion) && timestamp(snapshot.initializedAt));
  requireValue(record(snapshot.processedRequests) && record(snapshot.db));
  if (snapshot.preferences !== undefined) {
    requireValue(record(snapshot.preferences) && typeof snapshot.preferences.introAcknowledged === 'boolean');
  }
  const db = snapshot.db;
  requireValue(record(db.meta) && db.meta.schemaVersion === SCHEMA_VERSION && db.meta.fictional === true);
  requireValue(db.meta.datasetVersion === snapshot.datasetVersion && db.meta.storageKey === STORAGE_KEY);
  const campuses = indexed(db.campuses);
  const locations = indexed(db.locations);
  const users = indexed(db.users);
  const categories = indexed(db.categories);
  const tasks = indexed(db.tasks, true);
  indexed(db.reviews, true);
  indexed(db.creditEvents, true);
  requireValue(users.has(snapshot.activeUserId) && users.has(db.meta.defaultUserId));
  for (const campus of campuses.values()) requireValue(text(campus.name) && campus.fictional === true);
  for (const location of locations.values()) requireValue(text(location.name) && campuses.has(location.campusId) && location.fictional === true);
  for (const category of categories.values()) requireValue(text(category.name));
  for (const user of users.values()) {
    requireValue(text(user.nickname) && text(user.avatarText) && campuses.has(user.campusId));
    requireValue(Number.isInteger(user.creditBase) && user.creditBase >= 0 && user.creditBase <= 100);
    requireValue(user.campusVerification === 'demo_unverified');
  }
  const states = new Set(['open', 'accepted', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled', 'expired', 'disputed']);
  const needsRunner = new Set(['accepted', 'in_progress', 'awaiting_confirmation', 'completed', 'disputed']);
  for (const task of tasks.values()) {
    requireValue(states.has(task.status) && categories.has(task.category) && campuses.has(task.campusId));
    requireValue(users.get(task.publisherId)?.campusId === task.campusId);
    requireValue(locations.get(task.pickupLocationId)?.campusId === task.campusId && locations.get(task.dropoffLocationId)?.campusId === task.campusId);
    requireValue(task.runnerId === null || (users.get(task.runnerId)?.campusId === task.campusId && task.runnerId !== task.publisherId));
    requireValue(needsRunner.has(task.status) ? task.runnerId !== null : task.runnerId === null);
    requireValue(text(task.title) && task.title.length >= 4 && task.title.length <= 60);
    requireValue(text(task.description) && task.description.length >= 10 && task.description.length <= 500);
    requireValue(Number.isInteger(task.rewardCents) && task.rewardCents >= 0 && task.rewardCents <= 5000);
    requireValue(Number.isSafeInteger(task.goodsBudgetCents) && task.goodsBudgetCents >= 0);
    requireValue(timestamp(task.createdAt) && timestamp(task.deadlineAt) && timestamp(task.updatedAt));
    requireValue(task.deadlineAt > task.createdAt && task.updatedAt >= task.createdAt);
    requireValue(Number.isSafeInteger(task.revision) && task.revision > 0);
    const events = indexed(task.timeline);
    let previous = task.createdAt;
    for (const event of events.values()) {
      requireValue(text(event.action) && timestamp(event.at) && event.at >= previous && event.at <= task.updatedAt);
      requireValue(event.action === 'expired' ? event.actorId === null : users.has(event.actorId));
      previous = event.at;
    }
    requireValue(task.timeline[0].at === task.createdAt && task.timeline.at(-1).at === task.updatedAt);
    if (['awaiting_confirmation', 'completed', 'disputed'].includes(task.status)) requireValue(text(task.completionNote));
    if (task.status === 'disputed') requireValue(text(task.disputeReason));
  }
  const reviewers = new Set();
  for (const review of db.reviews) {
    const task = tasks.get(review.taskId);
    requireValue(task?.status === 'completed');
    const participants = [task.publisherId, task.runnerId];
    requireValue(participants.includes(review.authorId) && participants.includes(review.targetUserId) && review.authorId !== review.targetUserId);
    requireValue(Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5 && typeof review.comment === 'string');
    requireValue(timestamp(review.createdAt) && review.createdAt >= task.updatedAt);
    const key = JSON.stringify([review.taskId, review.authorId]);
    requireValue(!reviewers.has(key));
    reviewers.add(key);
  }
  const credited = new Set();
  for (const event of db.creditEvents) {
    const task = tasks.get(event.taskId);
    requireValue(task?.status === 'completed' && task.runnerId === event.userId);
    requireValue(event.type === 'task_completed' && event.delta === 2 && event.createdAt === task.updatedAt && !credited.has(event.taskId));
    credited.add(event.taskId);
  }
  for (const task of tasks.values()) if (task.status === 'completed') requireValue(credited.has(task.id));
  for (const [key, request] of Object.entries(snapshot.processedRequests)) {
    if (key.startsWith('addReview:')) {
      requireValue(record(request) && request.operation === 'addReview' && text(request.fingerprint) && users.has(request.actorId));
      const review = db.reviews.find(item => item.id === request.result?.id);
      requireValue(review && request.taskId === review.taskId && request.actorId === review.authorId);
      requireValue(['id', 'taskId', 'authorId', 'targetUserId', 'rating', 'comment', 'createdAt'].every(field => request.result[field] === review[field]));
      continue;
    }
    if (key.startsWith('transitionTask:')) {
      requireValue(record(request) && request.operation === 'transitionTask' && text(request.fingerprint) && users.has(request.actorId));
      const current = tasks.get(request.taskId);
      const result = request.result;
      requireValue(current && record(result) && record(result.task));
      requireValue(['accept', 'cancel', 'start', 'withdraw', 'submit_completion', 'confirm_completion', 'dispute'].includes(request.action));
      requireValue(result.task.id === current.id && states.has(result.task.status) && Number.isSafeInteger(result.task.revision) && result.task.revision > 0 && result.task.revision <= current.revision);
      requireValue(timestamp(result.task.updatedAt) && Array.isArray(result.task.timeline) && result.task.timeline.length > 0);
      const award = result.creditAward;
      requireValue((request.action === 'confirm_completion') === (award !== null));
      requireValue(award === null || (record(award) && users.has(award.userId) && award.delta === 2 && Number.isInteger(award.before) && Number.isInteger(award.after)
        && award.before >= 0 && award.after <= 100 && award.appliedDelta === award.after - award.before && award.appliedDelta >= 0 && award.appliedDelta <= 2));
      continue;
    }
    if (!key.startsWith('createTask:')) continue;
    requireValue(record(request) && request.operation === 'createTask' && text(request.fingerprint));
    requireValue(tasks.get(request.taskId)?.publisherId === request.actorId && users.has(request.actorId));
    const result = request.result;
    requireValue(record(result) && result.id === request.taskId && result.publisherId === request.actorId);
    requireValue(result.status === 'open' && result.revision === 1 && timestamp(result.createdAt));
    requireValue(Array.isArray(result.timeline) && result.timeline.length === 1 && result.timeline[0].action === 'published');
  }
  const checkNoOffsets = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      requireValue(!key.endsWith('OffsetMinutes'));
      checkNoOffsets(child);
    }
  };
  checkNoOffsets(db);
  return snapshot;
}

export function initializeSnapshot(seed, anchor) {
  const db = copy(seed);
  requireValue(record(db) && record(db.meta) && db.meta.timeMode === 'relative-minutes');
  const fields = { createdOffsetMinutes: 'createdAt', deadlineOffsetMinutes: 'deadlineAt', updatedOffsetMinutes: 'updatedAt', atOffsetMinutes: 'at' };
  const convert = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(fields, key)) {
        requireValue(Number.isSafeInteger(child));
        value[fields[key]] = anchor + child * 60000;
        delete value[key];
      } else convert(child);
    }
  };
  convert(db);
  return validateSnapshot({
    schemaVersion: SCHEMA_VERSION, datasetVersion: db.meta.datasetVersion,
    initializedAt: anchor, activeUserId: db.meta.defaultUserId, db,
    processedRequests: {}, preferences: { introAcknowledged: false },
  });
}
