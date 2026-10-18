import { button, el } from '../components/dom.js';
import { taskCard } from '../components/taskCard.js';
import { taskTimeline } from '../components/taskTimeline.js';
import { TASK_STATUS_LABELS } from '../services/taskService.js';

export const createMyTasksState = () => ({ role: 'publisher', status: '', scrollY: 0 });

export function renderMyTasksPage(session, service, { signal, myTasksState: state, onPersistence, onTaskOrigin }) {
  const page = el('div', { class: 'page my-tasks-page' });
  const roles = el('div', { class: 'role-switch', role: 'group', 'aria-label': '我的任务角色' });
  const status = el('select', { id: 'my-task-status' });
  const count = el('p', { class: 'result-count', role: 'status', 'aria-live': 'polite' });
  const results = el('div', { class: 'task-grid' });
  let request = 0;
  let firstResult = true;
  let signature;
  const roleButtons = ['publisher', 'runner'].map(role => {
    const node = button(role === 'publisher' ? '我发布的' : '我接的', () => {
      state.role = role; state.scrollY = 0; sync(); void refresh();
    }, 'category-filter');
    roles.append(node);
    return [role, node];
  });
  function sync() { roleButtons.forEach(([role, node]) => node.setAttribute('aria-pressed', String(state.role === role))); }
  async function refresh() {
    if (signal.aborted) return;
    const version = ++request;
    results.setAttribute('aria-busy', 'true');
    const result = await service.listMyTasks({ role: state.role, status: state.status });
    if (signal.aborted || version !== request) return;
    results.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      signature = undefined;
      count.textContent = '任务加载失败';
      results.replaceChildren(el('div', { class: 'empty-state' }, el('p', {}, result.error.message), button('重新加载', () => { void refresh(); })));
      return;
    }
    const data = result.data;
    onPersistence(data.persistence);
    const countText = `当前 ${data.tasks.length} 条 · ${state.role === 'publisher' ? '我发布的' : '我接的'}共 ${data.total} 条`;
    if (count.textContent !== countText) count.textContent = countText;
    const options = [['', '全部状态'], ...Object.entries(TASK_STATUS_LABELS)];
    // Keep the native select intact during periodic refresh, preserving focus.
    if (!status.options.length) status.append(...options.map(([key, label]) => el('option', { value: key }, label)));
    options.forEach(([key, label], index) => { status.options[index].textContent = `${label}（${key ? data.counts[key] : data.total}）`; });
    status.value = state.status;
    const nextSignature = JSON.stringify([data.tasks, state.role, state.status]);
    if (signature !== nextSignature) {
      const expanded = new Set(Array.from(results.querySelectorAll('details[open]')).map(node => node.dataset.task));
      results.replaceChildren(...(data.tasks.length ? data.tasks.map(task => {
        const card = taskCard(task);
        card.classList.add('history-card');
        card.querySelector('a').addEventListener('click', () => onTaskOrigin('tasks'));
        card.append(el('details', { class: 'card-timeline', 'data-task': task.id, open: expanded.has(task.id) },
          el('summary', {}, '查看进度时间线'), taskTimeline(task.timeline)));
        return card;
      }) : [el('div', { class: 'empty-state' }, el('h2', {}, state.status ? '这个状态下暂无任务' : state.role === 'publisher' ? '还没有发布任务' : '还没有接下任务'),
        el('p', { class: 'muted' }, state.status ? '可以查看全部状态，已有历史记录会保留。' : '这里展示当前演示身份参与的任务，退出接单后不再列入“我接的”。'),
        state.status ? button('查看全部状态', () => { state.status = ''; void refresh(); }, 'button button-secondary')
          : el('a', { href: state.role === 'publisher' ? '#/publish' : '#/hall', class: 'button' }, state.role === 'publisher' ? '发布任务' : '去大厅接单'))]));
      signature = nextSignature;
    }
    if (firstResult) {
      firstResult = false;
      requestAnimationFrame(() => { if (!signal.aborted) window.scrollTo({ top: state.scrollY, behavior: 'instant' }); });
    }
  }
  status.addEventListener('change', () => { state.status = status.value; state.scrollY = 0; void refresh(); });
  page.append(el('div', { class: 'page-heading' }, el('h1', { tabindex: '-1' }, '我的任务'),
    el('p', { class: 'muted' }, `${session.activeUser.nickname} · 进行中的任务优先，历史记录随时可查。`)),
    el('section', { class: 'panel', 'aria-label': '筛选我的任务' }, roles, el('label', { for: 'my-task-status' }, '任务状态'), status), count, results);
  sync();
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 15000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); }, { signal });
  if (signal.aborted) clearInterval(timer); else void refresh();
  return page;
}
