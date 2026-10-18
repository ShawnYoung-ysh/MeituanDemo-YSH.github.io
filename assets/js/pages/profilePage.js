import { button, el, serviceErrorPage } from '../components/dom.js';
import { localTime } from '../components/format.js';
import { reviewItem } from '../components/reviewSection.js';

export async function renderProfilePage(session, service, actions) {
  const result = await service.getProfile();
  if (!result.ok) return serviceErrorPage(result.error, actions.retry);
  const profile = result.data;
  const select = el('select', { id: 'demo-user', name: 'demo-user' }, ...session.users.map(user =>
    el('option', { value: user.id, selected: user.id === profile.id }, `${user.nickname} · 信用 ${user.credit}`)));
  const stat = (value, label) => el('div', {}, el('strong', {}, value), el('span', {}, label));
  const entries = profile.creditEvents;
  actions.onPersistence(profile.persistence);
  return el('div', { class: 'page profile-page' },
    el('div', { class: 'page-heading' }, el('h1', { tabindex: '-1' }, '我的'), el('p', { class: 'muted' }, '每一次靠谱的交付，都有记录。')),
    el('section', { class: 'panel' }, el('div', { class: 'profile' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, profile.avatarText),
      el('div', {}, el('h2', {}, profile.nickname), el('p', {}, '虚构演示资料 · 未进行真实校园认证'))),
      el('p', { class: 'small muted' }, profile.campus.name),
      el('div', { class: 'stats profile-summary' }, stat(`${profile.credit}`, '演示信用 / 100'), stat(`${profile.completedAsPublisher}`, '发布已完成'), stat(`${profile.completedAsRunner}`, '跑腿已完成')),
      el('p', {}, profile.rating === null ? '暂无评分 · 0 条收到的评价' : `收到的评分 ${profile.rating.toFixed(1)} / 5 · ${profile.reviewCount} 条评价`),
      el('p', { class: 'field-hint' }, '完成数量仅统计已完成任务，取消、截止与异议不计入；评分仅统计收到的评价。'),
      profile.credit < 60 ? el('p', { class: 'notice' }, '信用低于 60 分不能接单，仍可发布或管理自己的任务。') : null,
      el('a', { href: '#/tasks', class: 'button button-secondary profile-task-link' }, '管理我的任务')),
    el('section', { class: 'panel', 'aria-labelledby': 'credit-title' }, el('h2', { id: 'credit-title' }, '信用明细'),
      el('p', {}, `虚构历史基数 ${profile.creditBase} 分 + 完成事件 ${entries.reduce((sum, entry) => sum + entry.delta, 0)} 分，封顶后为 ${profile.credit} 分。`),
      el('p', { class: 'field-hint' }, '按入账顺序从新到旧展示。跑腿任务经发布者确认完成后记录 +2；最高 100 分。达到上限时实际增加可能为 0 或 1 分。评价不增加信用；取消、退出和异议不扣分。'),
      entries.length ? el('ul', { class: 'credit-list' }, ...entries.map(entry => el('li', {},
        el('div', { class: 'credit-entry-heading' }, el('strong', {}, `实际 +${entry.appliedDelta}`), el('span', {}, `${entry.before} → ${entry.after}`)),
        el('a', { href: `#/task/${encodeURIComponent(entry.taskId)}`, class: 'text-link' }, entry.taskTitle),
        el('p', { class: 'field-hint' }, `完成事件 +${entry.delta}${entry.appliedDelta < entry.delta ? '，已达到信用上限' : ''} · ${localTime(entry.createdAt)}（本地时间）`))))
        : el('p', { class: 'muted' }, '暂无完成事件，当前信用来自虚构历史基数。')),
    el('section', { class: 'panel', 'aria-labelledby': 'received-reviews-title' }, el('h2', { id: 'received-reviews-title' }, '收到的评价'),
      profile.reviews.length ? el('ul', { class: 'review-list' }, ...profile.reviews.map(review => el('li', { class: 'profile-review' },
        el('a', { href: `#/task/${encodeURIComponent(review.taskId)}`, class: 'text-link' }, review.taskTitle), el('ul', { class: 'review-list' }, reviewItem(review)))))
        : el('p', { class: 'muted' }, '暂无评价，完成任务后双方可在详情中评价。')),
    el('section', { class: 'panel' }, el('h2', {}, '切换演示身份'), el('label', { for: 'demo-user' }, '选择一位演示同学'), select,
      button('切换身份', () => actions.switchUser(select.value)), el('p', { class: 'field-hint' }, '切换保留任务、评价和信用记录；每个身份分别保留本次会话的任务筛选。')),
    el('section', { class: 'panel' }, el('h2', {}, '本机演示记录'),
      el('p', {}, session.persistence.mode === 'persistent' ? '修改保存在当前浏览器，不会同步到其他设备。' : session.persistence.warning.message),
      el('p', { class: 'field-hint' }, `本轮样例生成于 ${localTime(session.initializedAt)}（本地时间）。刷新不会移动截止时间。`), button('重置演示', actions.reset, 'button button-danger')));
}
