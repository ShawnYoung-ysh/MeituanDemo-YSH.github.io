import { DemoError } from '../data/snapshot.js';
import { creditFor } from './profileSelectors.js';

export const TASK_ACTIONS = {
  accept: { label: '接下任务', from: 'open', to: 'accepted', role: 'other', event: 'accepted', confirm: true },
  cancel: { label: '取消任务', from: 'open', to: 'cancelled', role: 'publisher', event: 'cancelled', confirm: true },
  start: { label: '开始跑腿', from: 'accepted', to: 'in_progress', role: 'runner', event: 'started' },
  withdraw: { label: '退出接单', from: 'accepted', to: 'open', role: 'runner', event: 'withdrawn', confirm: true },
  submit_completion: { label: '提交交付说明', from: 'in_progress', to: 'awaiting_confirmation', role: 'runner', event: 'completion_submitted', field: 'completionNote' },
  confirm_completion: { label: '确认完成', from: 'awaiting_confirmation', to: 'completed', role: 'publisher', event: 'completed', confirm: true },
  dispute: { label: '提出异议', from: 'awaiting_confirmation', to: 'disputed', role: 'publisher', event: 'disputed', field: 'disputeReason' },
};

export function assertTaskAction(task, db, actorId, action, at) {
  const rule = TASK_ACTIONS[action];
  if (!Object.hasOwn(TASK_ACTIONS, action)) throw new DemoError('VALIDATION_ERROR', '无法识别这项任务操作。');
  const actor = db.users.find(user => user.id === actorId);
  if (!actor) throw new DemoError('FORBIDDEN', '演示身份无效，请重新选择。');
  if (['accept', 'cancel'].includes(action) && (task.status === 'expired' || (task.status === 'open' && task.deadlineAt <= at))) {
    throw new DemoError('TASK_EXPIRED', action === 'accept' ? '任务已截止，无法接单。' : '任务已截止，无法再取消。');
  }
  if (task.status !== rule.from) throw new DemoError('INVALID_STATE', '任务状态已变化，当前不能执行这项操作。');
  if ((rule.role === 'publisher' && task.publisherId !== actorId) || (rule.role === 'runner' && task.runnerId !== actorId)) {
    throw new DemoError('FORBIDDEN', rule.role === 'publisher' ? '只有这条任务的发布同学可以执行此操作。' : '只有当前跑腿同学可以执行此操作。');
  }
  if (action === 'accept') {
    if (task.publisherId === actorId) throw new DemoError('SELF_ACCEPT', '不能接自己发布的任务。');
    if (task.runnerId !== null) throw new DemoError('INVALID_STATE', '任务已有跑腿同学，不能重复接单。');
    if (actor.campusId !== task.campusId) throw new DemoError('FORBIDDEN', '只能接取同一校区的任务。');
    if (creditFor(db, actorId) < 60) throw new DemoError('LOW_CREDIT', '演示信用低于 60 分，暂不能接单；仍可发布任务。');
  }
  return rule;
}

export function allowedTaskActions(task, db, actorId, at) {
  return Object.keys(TASK_ACTIONS).filter(action => {
    try { assertTaskAction(task, db, actorId, action, at); return true; }
    catch { return false; }
  });
}
