import { el } from './dom.js';
import { localTime, formatMoneyCents } from './format.js';

const categoryMarks = { express: '取', shopping: '买', printing: '印', other: '助' };
export { localTime } from './format.js';

export function taskCard(task) {
  const titleId = `task-title-${task.id}`;
  const badge = task.status !== 'open' ? `${task.statusLabel}${task.isOverdue ? ' · 已超时' : ''}`
    : task.isUrgent ? `即将截止 · ${task.remainingMinutes} 分钟` : `剩余 ${task.remainingMinutes} 分钟`;
  return el('article', { class: 'task-card' },
    el('a', { href: `#/task/${encodeURIComponent(task.id)}`, class: 'task-card-link', 'aria-labelledby': titleId },
      el('div', { class: 'card-top' },
        el('span', { class: `category-mark category-${task.category}`, 'aria-hidden': 'true' }, categoryMarks[task.category] ?? '助'),
        el('span', { class: 'category-name' }, task.categoryLabel),
        el('span', { class: task.isUrgent ? 'deadline-badge urgent' : 'deadline-badge' }, badge)),
      el('h3', { id: titleId }, task.title),
      el('p', { class: 'card-description' }, task.description),
      el('dl', { class: 'card-route' },
        el('dt', {}, '取'), el('dd', {}, task.pickup.name),
        el('dt', {}, '送'), el('dd', {}, task.dropoff.name)),
      el('p', { class: 'card-deadline' }, el('time', { datetime: new Date(task.deadlineAt).toISOString() }, `${localTime(task.deadlineAt)} 截止（本地时间）`)),
      el('div', { class: 'card-bottom' },
        el('div', { class: 'card-reward' }, el('strong', {}, `¥${formatMoneyCents(task.rewardCents)}`), el('span', {}, '演示酬谢')),
        el('span', { class: 'card-entry' }, '查看任务 →')),
      task.goodsBudgetCents > 0 ? el('p', { class: 'budget-note' }, `另有商品预算 ¥${formatMoneyCents(task.goodsBudgetCents)} · 不实际支付`) : null,
      el('div', { class: 'card-publisher' }, el('span', {}, task.publisher.nickname),
        el('span', { class: task.isOwn ? 'own-label' : 'muted' }, task.isOwn ? '我发布的' : '演示资料'))));
}
