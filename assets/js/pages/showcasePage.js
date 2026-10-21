import { button, el } from '../components/dom.js';
import { formatMoneyCents } from '../components/format.js';

const steps = { published: '发布任务', accepted: '接下任务', started: '开始跑腿', withdrawn: '退出跑腿',
  completion_submitted: '提交交付说明', completed: '发布者确认完成', cancelled: '取消任务', expired: '任务截止', disputed: '提出异议' };

const link = (href, text, className = 'button button-secondary') => el('a', { href, class: className }, text);

function sampleCard(task) {
  return el('article', { class: 'task-card' }, el('a', { href: `#/showcase/${encodeURIComponent(task.id)}`,
    class: 'task-card-link', 'aria-labelledby': `sample-${task.id}` },
    el('div', { class: 'card-top' }, el('span', { class: 'category-name' }, task.categoryLabel),
      el('span', { class: 'task-state-badge' }, `${task.statusLabel}示例`)),
    el('h3', { id: `sample-${task.id}` }, task.title),
    el('p', { class: 'card-description' }, task.description),
    el('dl', { class: 'card-route' }, el('dt', {}, '取'), el('dd', {}, task.pickup.name), el('dt', {}, '送'), el('dd', {}, task.dropoff.name)),
    el('p', { class: 'card-deadline' }, `样例要求：发布后 ${task.durationMinutes} 分钟内送达`),
    el('div', { class: 'card-bottom' }, el('div', { class: 'card-reward' },
      el('strong', {}, `¥${formatMoneyCents(task.rewardCents)}`), el('span', {}, '样例酬谢')), el('span', { class: 'card-entry' }, '浏览案例 →'))));
}

function failure(error, retry) {
  return el('div', { class: 'page' }, el('section', { class: 'panel error-panel', role: 'alert' },
    el('h1', { tabindex: '-1' }, error.code === 'NOT_FOUND' ? '未找到样例' : '样例暂时无法显示'),
    el('p', {}, error.message), error.code === 'NOT_FOUND' ? null : button('重试样例', retry),
    link('#/showcase', '返回样例展示'), link('#/hall', '进入任务大厅')));
}

export async function renderShowcasePage(route, service, { state, signal, retry }) {
  if (route.name === 'showcaseTask') {
    const result = await service.getExample(route.taskId);
    return result.ok ? detail(result.data) : failure(result.error, retry);
  }
  const result = await service.listExamples(state.status);
  if (!result.ok) return failure(result.error, retry);
  const data = result.data;
  const count = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' }, `展示 ${data.tasks.length} 个固定案例`);
  const cards = el('div', { class: 'task-grid' }, ...data.tasks.map(sampleCard));
  const page = el('div', { class: 'page showcase-page' },
    el('div', { class: 'page-heading' }, el('span', { class: 'eyebrow' }, '样例展示 / 校园互助'),
      el('h1', { tabindex: '-1' }, '每一份顺路，都有故事'), el('p', { class: 'muted' }, '从待接单到完成，先看看校园互助的不同模样。')),
    el('section', { 'aria-label': '固定样例列表' }, count, cards),
    el('section', { class: 'panel showcase-cta' }, el('h2', {}, '想亲自试一试？'),
      el('p', { class: 'muted' }, '进入任务大厅，可发布、接单和完成任务。操作只保存在当前浏览器，固定样例不会被改变。'), link('#/hall', '进入可操作体验', 'button')));
  requestAnimationFrame(() => { if (!signal.aborted) window.scrollTo({ top: state.scrollY, behavior: 'instant' }); });
  return page;
}

function detail(task) {
  const profile = (user, label) => el('div', {}, el('dt', {}, label), el('dd', {}, user ? `${user.nickname} · 样例信用 ${user.credit} 分` : '尚无跑腿同学'));
  return el('div', { class: 'page showcase-page' }, link('#/showcase', '← 返回样例展示', 'text-link'),
    el('div', { class: 'page-heading' }, el('div', { class: 'detail-title-meta' }, el('span', { class: 'eyebrow' }, task.categoryLabel),
      el('span', { class: 'task-state-badge' }, `${task.statusLabel}示例`)),
      el('h1', { tabindex: '-1' }, task.title), el('p', { class: 'muted small' }, task.campus.name)),
    el('section', { class: 'panel' }, el('h2', {}, '案例内容'), el('p', { class: 'task-description' }, task.description),
      el('dl', { class: 'details' }, el('dt', {}, '取件地点'), el('dd', {}, task.pickup.name), el('dt', {}, '送达地点'), el('dd', {}, task.dropoff.name),
        el('dt', {}, '样例时限'), el('dd', {}, `发布后 ${task.durationMinutes} 分钟内送达`),
        el('dt', {}, '样例酬谢'), el('dd', {}, `¥${formatMoneyCents(task.rewardCents)}`),
        el('dt', {}, '商品预算'), el('dd', {}, `¥${formatMoneyCents(task.goodsBudgetCents)}（不计入酬谢）`))),
    el('section', { class: 'panel' }, el('h2', {}, '案例中的同学'),
      el('dl', { class: 'showcase-people' }, profile(task.publisher, '发布同学'), profile(task.runner, '跑腿同学'))),
    task.completionNote ? el('section', { class: 'panel' }, el('h2', {}, '样例交付说明'), el('p', { class: 'task-description' }, task.completionNote)) : null,
    task.disputeReason ? el('section', { class: 'panel' }, el('h2', {}, '样例异议原因'), el('p', { class: 'task-description' }, task.disputeReason),
      el('p', { class: 'field-hint' }, '案例停留在异议待处理状态，不自动裁决或扣分。')) : null,
    el('section', { class: 'panel' }, el('h2', {}, '样例进度'), el('p', { class: 'field-hint' }, '以下为固定案例中的相对时间，不是当前任务倒计时。'),
      el('ol', { class: 'task-timeline' }, ...task.timeline.map(event => el('li', {},
        el('div', {}, el('strong', {}, steps[event.action] ?? '任务更新'), el('span', {}, event.actorName)),
        el('span', { class: 'small muted' }, event.elapsedMinutes === 0 ? '样例发布时' : `样例发布后 ${event.elapsedMinutes} 分钟`))))),
    el('section', { class: 'panel' }, el('h2', {}, '样例信用说明'),
      el('p', {}, task.creditEvent ? `此案例已记录完成事件，规则为跑腿者 +${task.creditEvent.delta} 信用，最高 100 分。浏览案例不会再次入账。`
        : '此案例没有完成入账事件。只有发布者确认完成后才增加跑腿者信用，取消、退出和异议不扣分。'),
      el('p', { class: 'field-hint' }, '这些是固定样例中的记录，与当前体验身份无关；评价不增加信用。')),
    el('section', { class: 'panel' }, el('h2', {}, '样例评价'),
      task.reviews.length ? el('ul', { class: 'review-list' }, ...task.reviews.map(review => el('li', {},
        el('strong', {}, `${review.rating} / 5 星`), el('p', { class: 'small muted' }, `${review.authorName} → ${review.targetName}`),
        el('p', { class: 'task-description' }, review.comment)))) : el('p', { class: 'muted' }, '此案例暂无评价。')),
    el('div', { class: 'showcase-actions' }, link('#/showcase', '继续浏览样例'), link('#/hall', '进入可操作体验', 'button')));
}
