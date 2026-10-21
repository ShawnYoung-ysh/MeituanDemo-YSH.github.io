import { button, el } from '../components/dom.js';
import { taskCard } from '../components/taskCard.js';

export const createHallState = () => ({ category: '', query: '', pickupLocationId: '', scrollY: 0 });

export function renderHallPage(session, service, { signal, hallState, onPersistence }) {
  const page = el('div', { class: 'page hall-page' });
  const input = el('input', { type: 'search', id: 'hall-query', name: 'query', maxlength: '100', placeholder: '搜索任务、描述或地点', value: hallState.query, autocomplete: 'off' });
  const searchButton = el('button', { type: 'submit', class: 'button search-button' }, '搜索');
  const form = el('form', { class: 'hall-search', role: 'search', 'aria-label': '搜索校园任务' },
    el('label', { for: 'hall-query', class: 'sr-only' }, '搜索任务'), el('div', { class: 'search-row' }, input, searchButton));
  const categoryGroup = el('div', { class: 'category-filters', role: 'group', 'aria-label': '任务类别' });
  const location = el('select', { id: 'hall-location', name: 'pickupLocationId' });
  const clear = button('清空筛选', clearFilters, 'filter-clear');
  const resultsHeading = el('h2', { id: 'hall-results-title' }, '待接单任务');
  const count = el('p', { class: 'result-count', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const results = el('div', { class: 'task-grid' });
  const filtered = () => Boolean(hallState.query.trim() || hallState.category || hallState.pickupLocationId);
  let request = 0;
  let metadataReady = false;
  let firstResult = true;
  let disposed = signal.aborted;
  let categoryButtons = [];
  let searchTimer;
  let previousSignature;

  function syncControls() {
    categoryButtons.forEach(([id, node]) => node.setAttribute('aria-pressed', String(hallState.category === id)));
    clear.hidden = !filtered();
  }
  function clearFilters() {
    clearTimeout(searchTimer);
    hallState.category = '';
    hallState.query = '';
    hallState.pickupLocationId = '';
    input.value = '';
    location.value = '';
    syncControls();
    void refresh();
  }
  function renderMetadata(data) {
    if (metadataReady) return;
    metadataReady = true;
    for (const category of [{ id: '', name: '全部' }, ...data.categories]) {
      const node = button(category.name, () => {
        clearTimeout(searchTimer);
        hallState.category = category.id;
        hallState.query = input.value;
        syncControls();
        void refresh();
      }, 'category-filter');
      categoryButtons.push([category.id, node]);
      categoryGroup.append(node);
    }
    location.append(el('option', { value: '' }, '全部取件地点'), ...data.locations.map(item => el('option', { value: item.id }, item.name)));
    location.value = hallState.pickupLocationId;
    syncControls();
  }
  async function refresh({ background = false } = {}) {
    if (disposed) return;
    const version = ++request;
    results.setAttribute('aria-busy', 'true');
    if (!background || !metadataReady) {
      previousSignature = undefined;
      count.textContent = '正在查找校园里的互助…';
      results.replaceChildren(el('p', { class: 'loading' }, '正在加载任务…'));
    }
    const result = await service.listTasks({ category: hallState.category, query: hallState.query, pickupLocationId: hallState.pickupLocationId });
    if (disposed || version !== request) return;
    results.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      previousSignature = undefined;
      count.textContent = '任务加载失败';
      results.replaceChildren(el('div', { class: 'empty-state' }, el('h3', {}, '暂时无法加载任务'),
        el('p', {}, result.error.message), button('重新加载', () => { void refresh(); }, 'button button-secondary')));
      return;
    }
    const data = result.data;
    renderMetadata(data);
    onPersistence(data.persistence);
    const countText = filtered() ? `找到 ${data.tasks.length} 条 · 共 ${data.totalOpen} 条待接单` : `共 ${data.tasks.length} 条 · 截止时间由近到远`;
    if (count.textContent !== countText) count.textContent = countText;
    const signature = JSON.stringify([data.tasks, filtered()]);
    // Background checks retain focused cards when their visible data is unchanged.
    if (!background || previousSignature !== signature) {
      const focusedHref = results.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
      results.replaceChildren(...(data.tasks.length ? data.tasks.map(taskCard) : [el('div', { class: 'empty-state' },
      el('span', { class: 'empty-mark', 'aria-hidden': 'true' }, '暂'),
      el('h3', {}, filtered() ? '暂时没有符合条件的任务' : '现在没有待接单任务'),
      el('p', { class: 'muted' }, filtered() ? '换一个类别或地点试试，也可以清空筛选。' : '已接单、已完成和已截止的任务不会出现在这里。可在「我的」确认重置，体验初始场景。'),
      filtered() ? button('清空筛选，查看全部', clearFilters, 'button button-secondary') : el('a', { href: '#/me', class: 'button button-secondary' }, '前往我的'))]));
      if (focusedHref) Array.from(results.querySelectorAll('a')).find(link => link.getAttribute('href') === focusedHref)?.focus({ preventScroll: true });
      previousSignature = signature;
    }
    if (firstResult) {
      firstResult = false;
      const targetY = hallState.scrollY;
      requestAnimationFrame(() => { if (!disposed) window.scrollTo({ top: targetY, behavior: 'instant' }); });
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    clearTimeout(searchTimer);
    hallState.query = input.value;
    syncControls();
    void refresh();
  });
  function scheduleSearch(event) {
    hallState.query = input.value;
    syncControls();
    clearTimeout(searchTimer);
    if (!event.isComposing) searchTimer = setTimeout(() => { void refresh(); }, 250);
  }
  input.addEventListener('input', scheduleSearch);
  input.addEventListener('compositionend', scheduleSearch);
  input.addEventListener('search', () => { if (!input.value) { hallState.query = ''; syncControls(); void refresh(); } });
  location.addEventListener('change', () => { clearTimeout(searchTimer); hallState.pickupLocationId = location.value; hallState.query = input.value; syncControls(); void refresh(); });
  page.append(
    el('section', { class: 'hall-hero' }, el('span', { class: 'eyebrow' }, '校园互助 / 顺路同行'),
      el('h1', { tabindex: '-1' }, '顺路，帮个忙'), el('p', {}, '你的一小段顺路，是同学的一大份方便。'),
      el('p', { class: 'campus-label' }, el('span', { class: 'campus-dot', 'aria-hidden': 'true' }), session.campus.name)),
    el('section', { class: 'showcase-entry', 'aria-label': '浏览固定样例' },
      el('div', {}, el('strong', {}, '随时看看，互助如何发生'), el('p', {}, '固定案例一直都在，浏览不会改变你的体验记录。')),
      el('a', { href: '#/showcase', class: 'button button-secondary' }, '样例展示 →')),
    el('section', { class: 'hall-filters', 'aria-label': '筛选任务' }, form, categoryGroup,
      el('div', { class: 'location-row' }, el('div', {}, el('label', { for: 'hall-location' }, '取件地点'), location), clear)),
    el('section', { class: 'hall-results', 'aria-labelledby': 'hall-results-title' },
      el('div', { class: 'results-heading' }, resultsHeading, el('span', { class: 'small muted' }, '本机演示数据')), count, results),
    el('p', { class: 'hall-footnote' }, '进入详情可接单并查看进度。所有任务和金额均为本机演示，不发生支付。'));
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh({ background: true }); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh({ background: true }); }, { signal });
  signal.addEventListener('abort', () => { disposed = true; clearInterval(timer); clearTimeout(searchTimer); }, { once: true });
  if (disposed) clearInterval(timer); else void refresh();
  return page;
}
