import { button, el } from '../components/dom.js';
import { localTime, formatMoneyCents } from '../components/format.js';
import { requestTaskAction } from '../components/taskActionDialog.js';
import { TASK_ACTIONS } from '../services/taskRules.js';
import { taskTimeline } from '../components/taskTimeline.js';
import { reviewSection } from '../components/reviewSection.js';

function profileCard(profile, label) {
  return el('section', { class: 'panel detail-profile' }, el('h2', {}, label),
    el('div', { class: 'profile' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, profile.avatarText),
      el('div', {}, el('h3', {}, profile.nickname), el('p', { class: 'muted' }, '虚构资料 · 未进行真实校园认证'))),
    el('div', { class: 'profile-stats' }, el('span', {}, `演示信用 ${profile.credit} 分`),
      el('span', {}, `跑腿完成 ${profile.completedAsRunner} 次`),
      el('span', {}, profile.rating === null ? '暂无评分' : `评分 ${profile.rating.toFixed(1)} / 5（${profile.reviewCount} 条）`)),
    el('p', { class: 'field-hint' }, '信用与评分分开计算。确认完成后，跑腿者获得 +2 信用，最高 100 分；评价不额外加分。'));
}

function stateGuidance(task) {
  if (task.isOverdue) return '任务已超时，仍保持当前进度，不会自动完成或扣分。';
  if (task.status === 'open') return task.acceptBlocker?.message ?? '接单需同校区、演示信用不低于 60 分，且任务尚未截止。';
  return {
    accepted: '已有同学接下任务，等待开始跑腿。',
    in_progress: '跑腿同学正在执行任务，交付后由发布同学确认。',
    awaiting_confirmation: '交付说明已提交，等待发布同学核对并确认。',
    completed: '任务已完成，信用只入账一次。双方可在本页各评价一次，评价不改变信用。',
    cancelled: '发布同学已取消任务，不扣信用。',
    expired: '任务已截止，无法接单。',
    disputed: '已提出异议，演示中待处理，不自动裁决或扣分。',
  }[task.status];
}

export async function renderDetailPage(taskId, service, { signal, onPersistence, actorId, taskOrigin = 'hall' }) {
  const result = await service.getTask(taskId);
  if (!result.ok) return el('div', { class: 'page' }, el('h1', { tabindex: '-1' }, '未找到任务'), el('p', {}, result.error.message), el('a', { href: '#/hall', class: 'button' }, '返回任务大厅'));
  let task = result.data;
  const status = el('span', { class: 'task-state-badge' });
  const guidance = el('p', { class: 'detail-guidance', role: 'status' });
  const page = el('div', { class: 'page detail-page' });
  const body = el('div', { class: 'detail-body' });
  const actionHeading = el('h2', { id: 'task-actions-heading', tabindex: '-1' }, '当前状态与操作');
  const controls = el('div', { class: 'detail-action-controls' });
  const feedback = el('p', { class: 'feedback detail-action-feedback', role: 'status', 'aria-live': 'polite', tabindex: '-1', hidden: true });
  let acting = false;
  let bodySignature;
  let actionSignature;
  const notes = new Map();
  const requests = new Map();
  function lock(value) {
    acting = value;
    controls.setAttribute('aria-busy', String(value));
    controls.querySelectorAll('button').forEach(node => { node.disabled = value; });
  }
  function say(message, isError = false) {
    feedback.textContent = message;
    feedback.className = isError ? 'feedback feedback-error detail-action-feedback' : 'feedback detail-action-feedback';
    feedback.hidden = false;
  }
  async function refresh(force = false) {
    if (signal.aborted || (!force && (acting || document.visibilityState === 'hidden'))) return;
    const next = await service.getTask(taskId);
    if (!signal.aborted && (force || !acting)) {
      if (next.ok) updateState(next.data);
      else say(next.error.message, true);
    }
  }
  async function execute(action) {
    if (acting || signal.aborted) return;
    const selectedTask = task;
    const rule = TASK_ACTIONS[action];
    let restoreActionFocus = false;
    lock(true);
    try {
      let payload = {};
      if (rule.confirm || rule.field) {
        const answer = await requestTaskAction({ action, task: selectedTask, signal, initialNote: notes.get(action) ?? '' });
        if (rule.field) notes.set(action, answer.note);
        if (!answer.confirmed || signal.aborted) {
          restoreActionFocus = true;
          if (!signal.aborted) say('已取消本次操作，任务保持原状。');
          return;
        }
        payload = { confirmed: true, ...(rule.field ? { [rule.field]: answer.note } : {}) };
      }
      const fingerprint = JSON.stringify([action, selectedTask.revision, payload]);
      if (!requests.has(fingerprint)) requests.set(fingerprint, crypto.randomUUID());
      const result = await service.transitionTask({ taskId, actorId, action, expectedRevision: selectedTask.revision, requestId: requests.get(fingerprint), payload });
      if (signal.aborted) return;
      if (!result.ok) {
        await refresh(true);
        say(result.error.message, true);
        feedback.focus({ preventScroll: true });
        return;
      }
      onPersistence(result.data.persistence);
      notes.delete(action);
      // Re-read after success: an idempotent replay may contain an earlier state.
      await refresh(true);
      const messages = { accept: '接单成功，准备好后可开始跑腿。', start: '已开始跑腿。', withdraw: '已退出接单，信用不变。',
        cancel: '任务已取消，信用不变。', submit_completion: '已提交交付说明，等待发布同学确认；信用尚未入账。',
        dispute: '异议已提交，演示中待处理；信用不变。', confirm_completion: '任务已完成。' };
      const award = result.data.creditAward;
      const credit = award ? `跑腿同学信用 ${award.before} → ${award.after}（本次增加 ${award.appliedDelta}，最高 100 分）。` : '';
      say(`${messages[action]}${credit}${result.data.persistence.mode === 'memory' ? '当前为临时会话，刷新可能无法保留。' : ''}`);
      feedback.focus({ preventScroll: true });
    } catch {
      if (!signal.aborted) { await refresh(true); say('操作未完成，请核对当前状态后重试。', true); }
    } finally {
      lock(false);
      if (restoreActionFocus && !signal.aborted) Array.from(controls.querySelectorAll('button')).find(node => node.dataset.action === action)?.focus({ preventScroll: true });
    }
  }
  function updateState(next) {
    task = next;
    status.textContent = `${next.statusLabel}${next.isOverdue ? ' · 已超时' : ''}`;
    guidance.textContent = stateGuidance(next);
    const signature = JSON.stringify([next.revision, next.publisher, next.runner, next.reviewContext]);
    if (bodySignature !== signature) {
      body.replaceChildren(...renderBody(next), reviewSection(next, service, { actorId, signal, onPersistence,
        onReviewed: async message => { await refresh(true); if (!signal.aborted) { say(message); feedback.focus({ preventScroll: true }); } } }));
      bodySignature = signature;
    }
    const nextActions = JSON.stringify([next.revision, next.allowedActions]);
    if (actionSignature !== nextActions) {
      controls.replaceChildren(...next.allowedActions.map(action => {
        const node = button(TASK_ACTIONS[action].label, () => { void execute(action); }, ['cancel', 'withdraw', 'dispute'].includes(action) ? 'button button-danger' : 'button');
        node.dataset.action = action;
        return node;
      }));
      actionSignature = nextActions;
      lock(acting);
    }
    onPersistence(next.persistence);
  }
  page.append(...[el('a', { href: taskOrigin === 'tasks' ? '#/tasks' : '#/hall', class: 'text-link' }, taskOrigin === 'tasks' ? '← 返回我的任务' : '← 返回任务大厅'),
    el('div', { class: 'page-heading' }, el('div', { class: 'detail-title-meta' }, el('span', { class: 'eyebrow' }, task.categoryLabel), status),
      el('h1', { tabindex: '-1' }, task.title), el('p', { class: 'muted small' }, task.campus.name)),
    el('section', { class: 'panel detail-next-step', 'aria-labelledby': 'task-actions-heading' }, actionHeading, guidance, controls, feedback), body]);
  updateState(task);
  if (!signal.aborted) {
    const timer = setInterval(() => { void refresh(); }, 15000);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
    document.addEventListener('visibilitychange', () => { void refresh(); }, { signal });
  }
  return page;
}

function renderBody(task) {
  const timeline = taskTimeline(task.timeline);
  return [el('section', { class: 'panel' }, el('h2', {}, '任务说明'), el('p', { class: 'task-description' }, task.description),
      el('dl', { class: 'details' }, el('dt', {}, '取件地点'), el('dd', {}, task.pickup.name), el('dt', {}, '送达地点'), el('dd', {}, task.dropoff.name),
        el('dt', {}, '截止时间'), el('dd', {}, `${localTime(task.deadlineAt)}（本地时间）`), el('dt', {}, '发布时间'), el('dd', {}, `${localTime(task.createdAt)}（本地时间）`))),
    el('section', { class: 'panel detail-money' }, el('h2', {}, '演示金额'),
      el('dl', { class: 'details' }, el('dt', {}, '跑腿酬谢'), el('dd', {}, `¥${formatMoneyCents(task.rewardCents)}`),
        el('dt', {}, '商品预算'), el('dd', {}, `¥${formatMoneyCents(task.goodsBudgetCents)}`)),
      el('p', { class: 'field-hint' }, '商品预算单独列示，不计入跑腿酬谢。当前仅为演示，不发生支付。')),
    profileCard(task.publisher, '发布同学'), task.runner ? profileCard(task.runner, '跑腿同学') : null,
    task.completionNote ? el('section', { class: 'panel' }, el('h2', {}, '交付说明'), el('p', { class: 'task-description' }, task.completionNote)) : null,
    task.disputeReason ? el('section', { class: 'panel' }, el('h2', {}, '异议待处理'), el('p', { class: 'task-description' }, task.disputeReason), el('p', { class: 'field-hint' }, '演示中待处理，不自动裁决或扣分。')) : null,
    el('section', { class: 'panel' }, el('h2', {}, '任务进度'), timeline)].filter(node => node !== null);
}
