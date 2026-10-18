import { copy, DemoError } from '../data/snapshot.js';
import { serviceResult } from './result.js';
import { profileFor, creditFor } from './profileSelectors.js';
import { TASK_FORM_FIELDS, validateTaskForm } from './formValidation.js';
import { allowedTaskActions, assertTaskAction, TASK_ACTIONS } from './taskRules.js';
import { reviewContextFor } from './reviewService.js';

export const TASK_STATUS_LABELS = {
  open: '待接单', accepted: '已接单', in_progress: '跑腿中',
  awaiting_confirmation: '待确认', completed: '已完成', cancelled: '已取消',
  expired: '已截止', disputed: '异议待处理',
};

// Executed inside the repository's serialized snapshot update, never in the UI.
function expireOpenTasks(db, at) {
  let changed = false;
  for (const task of db.tasks) {
    if (task.status !== 'open' || task.deadlineAt > at) continue;
    task.status = 'expired';
    task.revision++;
    task.updatedAt = Math.max(at, task.updatedAt);
    task.timeline.push({ id: `${task.id}-expired-r${task.revision}`, action: 'expired', actorId: null, at: task.updatedAt });
    changed = true;
  }
  return changed;
}

const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');

function describeTask(task, db, actorId, at) {
  const remainingMinutes = Math.max(0, Math.ceil((task.deadlineAt - at) / 60000));
  const actor = db.users.find(user => user.id === actorId);
  let acceptBlocker = null;
  if (task.status === 'expired' || (task.status === 'open' && task.deadlineAt <= at)) acceptBlocker = { code: 'TASK_EXPIRED', message: '任务已截止，无法接单。' };
  else if (task.status !== 'open') acceptBlocker = { code: 'INVALID_STATE', message: '当前任务已不在待接单状态。' };
  else if (task.publisherId === actorId) acceptBlocker = { code: 'SELF_ACCEPT', message: '这是你发布的任务，不能自己接单。' };
  else if (actor.campusId !== task.campusId) acceptBlocker = { code: 'FORBIDDEN', message: '只能接取同一校区的任务。' };
  else if (creditFor(db, actorId) < 60) acceptBlocker = { code: 'LOW_CREDIT', message: '演示信用低于 60 分，暂不能接单；仍可发布任务。' };
  return {
    ...task,
    publisher: profileFor(db, task.publisherId),
    runner: profileFor(db, task.runnerId),
    campus: db.campuses.find(campus => campus.id === task.campusId),
    pickup: db.locations.find(location => location.id === task.pickupLocationId),
    dropoff: db.locations.find(location => location.id === task.dropoffLocationId),
    categoryLabel: db.categories.find(category => category.id === task.category).name,
    statusLabel: TASK_STATUS_LABELS[task.status], isOwn: task.publisherId === actorId,
    remainingMinutes, isUrgent: task.status === 'open' && task.deadlineAt > at && remainingMinutes <= 60,
    isOverdue: ['accepted', 'in_progress', 'awaiting_confirmation'].includes(task.status) && task.deadlineAt <= at,
    acceptBlocker,
    allowedActions: allowedTaskActions(task, db, actorId, at),
    reviewContext: reviewContextFor(db, task, actorId),
    timeline: task.timeline.map(event => ({ ...event, actorName: db.users.find(user => user.id === event.actorId)?.nickname ?? '系统' })),
  };
}

export function createTaskService(repository, { now = Date.now, newId = () => crypto.randomUUID() } = {}) {
  async function currentState() {
    let checkedAt;
    const state = await repository.update(next => {
      checkedAt = now();
      return expireOpenTasks(next.db, checkedAt);
    });
    return { ...state, checkedAt };
  }
  return {
    transitionTask: input => serviceResult(async () => {
      if (!input || typeof input !== 'object') throw new DemoError('VALIDATION_ERROR', '操作参数不正确。');
      const { taskId, actorId, action, expectedRevision, requestId } = input;
      if (typeof taskId !== 'string' || !taskId || typeof action !== 'string' || !Object.hasOwn(TASK_ACTIONS, action)) throw new DemoError('VALIDATION_ERROR', '任务或操作无效。');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new DemoError('VALIDATION_ERROR', '请求标识无效，请重新操作。');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new DemoError('VALIDATION_ERROR', '任务版本无效，请刷新后重试。');
      const payload = copy(input.payload ?? {});
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new DemoError('VALIDATION_ERROR', '操作内容格式不正确。');
      const requestKey = `transitionTask:${requestId}`;
      const fingerprint = JSON.stringify([taskId, actorId, action, expectedRevision, payload.confirmed ?? false, payload.completionNote ?? null, payload.disputeReason ?? null]);
      let failure;
      const state = await repository.update(next => {
        if (next.activeUserId !== actorId || !next.db.users.some(user => user.id === actorId)) throw new DemoError('FORBIDDEN', '演示身份已变化，请重新打开任务再操作。');
        const task = next.db.tasks.find(item => item.id === taskId);
        if (!task) throw new DemoError('NOT_FOUND', '任务不存在，可能已在重置后移除。');
        if (Object.hasOwn(next.processedRequests, requestKey)) {
          const entry = next.processedRequests[requestKey];
          if (entry.operation !== 'transitionTask' || entry.actorId !== actorId || entry.fingerprint !== fingerprint) throw new DemoError('REVISION_CONFLICT', '这次请求已用于其他操作，请核对最新任务状态。');
          return false;
        }
        const checkedAt = now();
        const expired = expireOpenTasks(next.db, checkedAt);
        try {
          if (['accept', 'cancel'].includes(action) && task.status === 'expired') throw new DemoError('TASK_EXPIRED', '任务已截止，无法再接单或取消。');
          if (task.revision !== expectedRevision) throw new DemoError('REVISION_CONFLICT', '任务已更新，请核对当前状态后再操作。');
          const rule = assertTaskAction(task, next.db, actorId, action, checkedAt);
          if (rule.confirm && payload.confirmed !== true) throw new DemoError('CONFIRMATION_REQUIRED', '请先确认这项操作。');
          let note;
          if (rule.field) {
            note = typeof payload[rule.field] === 'string' ? payload[rule.field].trim() : '';
            if (!note || note.length > 500) {
              const message = rule.field === 'completionNote' ? '请填写 1–500 字的交付说明。' : '请填写 1–500 字的异议原因。';
              throw new DemoError('VALIDATION_ERROR', message, { field: rule.field, fields: { [rule.field]: message } });
            }
          }
          const creditId = `credit-${task.id}-completed`;
          if (action === 'confirm_completion' && next.db.creditEvents.some(event => event.taskId === task.id || event.id === creditId)) throw new DemoError('INVALID_STATE', '这条任务已有信用事件，请刷新检查。');
          const creditBefore = action === 'confirm_completion' ? creditFor(next.db, task.runnerId) : null;
          const at = Math.max(checkedAt, task.updatedAt);
          task.status = rule.to;
          task.revision++;
          task.updatedAt = at;
          if (action === 'accept') task.runnerId = actorId;
          if (rule.field) task[rule.field] = note;
          task.timeline.push({ id: `${task.id}-${rule.event}-r${task.revision}`, action: rule.event, actorId, at });
          if (action === 'withdraw') {
            task.runnerId = null;
            if (task.deadlineAt <= checkedAt) {
              task.status = 'expired';
              task.timeline.push({ id: `${task.id}-expired-r${task.revision}`, action: 'expired', actorId: null, at });
            }
          }
          let creditAward = null;
          if (action === 'confirm_completion') {
            next.db.creditEvents.push({ id: creditId, taskId: task.id, userId: task.runnerId, type: 'task_completed', delta: 2, createdAt: at });
            const after = creditFor(next.db, task.runnerId);
            creditAward = { userId: task.runnerId, before: creditBefore, after, delta: 2, appliedDelta: after - creditBefore };
          }
          next.processedRequests[requestKey] = { operation: 'transitionTask', actorId, taskId, action, fingerprint,
            result: { task: copy(task), creditAward } };
        } catch (error) {
          if (!(error instanceof DemoError)) throw error;
          // An expired open task stays expired even when the requested action fails.
          failure = error;
          return expired;
        }
      });
      if (failure) throw failure;
      return { ...state.snapshot.processedRequests[requestKey].result, persistence: state.persistence };
    }),
    getPublishOptions: () => serviceResult(async () => {
      const { snapshot } = await repository.read();
      const { db, activeUserId } = snapshot;
      const actor = profileFor(db, activeUserId);
      return { actor, campus: db.campuses.find(item => item.id === actor.campusId), categories: db.categories,
        locations: db.locations.filter(item => item.campusId === actor.campusId) };
    }),
    createTask: input => serviceResult(async () => {
      if (!input || typeof input !== 'object') throw new DemoError('VALIDATION_ERROR', '发布参数不正确。');
      const { actorId, requestId } = input;
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new DemoError('VALIDATION_ERROR', '发布请求标识无效，请重新提交。');
      if (!input.form || typeof input.form !== 'object' || Array.isArray(input.form)) throw new DemoError('VALIDATION_ERROR', '请填写任务表单。', { field: 'title' });
      const form = copy(input.form);
      const fingerprint = JSON.stringify([actorId, ...TASK_FORM_FIELDS.map(key => form[key] ?? '')]);
      const requestKey = `createTask:${requestId}`;
      const state = await repository.update(next => {
        const actor = next.db.users.find(user => user.id === actorId);
        if (!actor || actorId !== next.activeUserId) throw new DemoError('FORBIDDEN', '演示身份已变化，请返回发布页核对后再提交。');
        if (Object.hasOwn(next.processedRequests, requestKey)) {
          const existing = next.processedRequests[requestKey];
          if (existing.operation !== 'createTask' || existing.actorId !== actorId || existing.fingerprint !== fingerprint) {
            throw new DemoError('REVISION_CONFLICT', '这次请求已用于其他发布内容，请重新提交。');
          }
          return false;
        }
        const at = now();
        const validation = validateTaskForm(form, { now: at, campusId: actor.campusId, categories: next.db.categories, locations: next.db.locations });
        if (!validation.ok) {
          const field = Object.keys(validation.fields)[0];
          throw new DemoError('VALIDATION_ERROR', validation.fields[field], { field, fields: validation.fields });
        }
        const id = `t-${newId()}`;
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || next.db.tasks.some(task => task.id === id)) throw new DemoError('INTERNAL_ERROR', '任务编号生成失败，请重试。');
        const task = { id, campusId: actor.campusId, ...validation.data,
          publisherId: actorId, runnerId: null, status: 'open', createdAt: at, updatedAt: at, revision: 1,
          completionNote: null, disputeReason: null,
          timeline: [{ id: `${id}-published`, action: 'published', actorId, at }] };
        next.db.tasks.push(task);
        next.processedRequests[requestKey] = { operation: 'createTask', actorId, fingerprint, taskId: id, result: copy(task) };
      });
      return { task: state.snapshot.processedRequests[requestKey].result, persistence: state.persistence };
    }),
    listTasks: (filters = {}) => serviceResult(async () => {
      if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new DemoError('VALIDATION_ERROR', '筛选条件格式不正确。');
      for (const key of ['category', 'query', 'pickupLocationId', 'status']) {
        if (filters[key] !== undefined && typeof filters[key] !== 'string') throw new DemoError('VALIDATION_ERROR', '筛选条件应为文字。');
      }
      const { snapshot, persistence, checkedAt } = await currentState();
      const { db, activeUserId } = snapshot;
      const actor = db.users.find(user => user.id === activeUserId);
      const status = filters.status || 'open';
      if (!Object.hasOwn(TASK_STATUS_LABELS, status)) throw new DemoError('VALIDATION_ERROR', '任务状态不正确。');
      const query = normalize(filters.query || '');
      const tasks = db.tasks
        .filter(task => task.campusId === actor.campusId && task.status === status)
        .map(task => describeTask(task, db, activeUserId, checkedAt))
        .filter(task => (!filters.category || task.category === filters.category)
          && (!filters.pickupLocationId || task.pickupLocationId === filters.pickupLocationId)
          && (!query || normalize([task.title, task.description, task.pickup.name, task.dropoff.name, task.categoryLabel].join(' ')).includes(query)))
        .sort((a, b) => a.deadlineAt - b.deadlineAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return {
        tasks, persistence, checkedAt,
        categories: db.categories,
        locations: db.locations.filter(location => location.campusId === actor.campusId),
        totalOpen: db.tasks.filter(task => task.campusId === actor.campusId && task.status === 'open').length,
      };
    }),
    listMyTasks: (filters = {}) => serviceResult(async () => {
      if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new DemoError('VALIDATION_ERROR', '任务筛选格式不正确。');
      const { role = 'publisher', status = '' } = filters;
      if (!['publisher', 'runner'].includes(role) || (status !== '' && !Object.hasOwn(TASK_STATUS_LABELS, status))) throw new DemoError('VALIDATION_ERROR', '任务角色或状态筛选无效。');
      const { snapshot, checkedAt, persistence } = await currentState();
      const { db, activeUserId } = snapshot;
      const mine = db.tasks.filter(task => task[role === 'publisher' ? 'publisherId' : 'runnerId'] === activeUserId);
      const counts = Object.fromEntries(Object.keys(TASK_STATUS_LABELS).map(key => [key, mine.filter(task => task.status === key).length]));
      const terminal = new Set(['completed', 'cancelled', 'expired', 'disputed']);
      const tasks = mine.filter(task => !status || task.status === status)
        .sort((a, b) => Number(terminal.has(a.status)) - Number(terminal.has(b.status)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .map(task => describeTask(task, db, activeUserId, checkedAt));
      return { tasks, counts, total: mine.length, role, status, persistence, checkedAt };
    }),
    getTask: taskId => serviceResult(async () => {
      const { snapshot, checkedAt, persistence } = await currentState();
      const task = snapshot.db.tasks.find(item => item.id === taskId);
      if (!task) throw new DemoError('NOT_FOUND', '这条任务不存在，可能已在重置后移除。');
      return { ...describeTask(task, snapshot.db, snapshot.activeUserId, checkedAt), persistence, checkedAt };
    }),
  };
}
