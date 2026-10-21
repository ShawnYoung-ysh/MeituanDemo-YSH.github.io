import { createMockRepository } from './data/mockRepository.js';
import { createDemoService } from './services/demoService.js';
import { startRouter, resolveRoute } from './router.js';
import { button, confirmReset, el } from './components/dom.js';
import { renderPage } from './pages/shellPages.js';
import { createHallState } from './pages/hallPage.js';
import { createPublishDraft, hasDraftContent } from './pages/publishPage.js';
import { createMyTasksState } from './pages/myTasksPage.js';
import { STORAGE_KEY } from './data/snapshot.js';
import { observeServiceErrors } from './services/result.js';
import { createShowcaseService } from './services/showcaseService.js';
import { renderShowcasePage } from './pages/showcasePage.js';
import { createShowcaseMenu } from './components/showcaseMenu.js';

const repository = createMockRepository();
const showcaseService = createShowcaseService();
const showcaseState = { status: '', scrollY: 0 };
const isShowcase = route => ['showcase', 'showcaseTask'].includes(route.name);
const service = observeServiceErrors(createDemoService(repository), error => {
  if (error.code === 'EXTERNAL_CHANGE') showExternalChange();
});
const main = document.querySelector('#main-content');
const banner = document.querySelector('#session-banner');
const intro = document.querySelector('#intro');
const feedback = document.querySelector('#feedback');
const showcaseIntro = document.querySelector('#showcase-intro');
let showcaseNoticeAcknowledged = false;
const showcaseMenu = createShowcaseMenu(document.querySelector('.showcase-menu'), status => {
  rememberScroll();
  showcaseState.status = status;
  showcaseState.scrollY = 0;
  if (resolveRoute(window.location.hash).name === 'showcase') {
    // Do not save the old scroll position over the new filter's starting position.
    displayedRoute = undefined;
    retryPage();
  } else window.location.hash = '#/showcase';
});
const header = document.querySelector('.header');
const navigation = document.querySelector('.bottom-nav');
// Measure both fixed bars so wrapped text, zoom and safe areas never cover content.
function updateShellInsets() {
  document.documentElement.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
  document.documentElement.style.setProperty('--bottom-nav-height', `${navigation.getBoundingClientRect().height}px`);
}
const shellObserver = new ResizeObserver(updateShellInsets);
shellObserver.observe(header);
shellObserver.observe(navigation);
updateShellInsets();
document.querySelector('#intro-confirm').addEventListener('click', () => {
  document.querySelector('#intro-error').hidden = true;
  void perform(() => service.acknowledgeIntro(), '已了解演示说明。');
});
function closeIntro() {
  if (intro.open) intro.close();
}
function closeShowcaseIntro() {
  if (showcaseIntro.open) showcaseIntro.close();
}
document.querySelector('#showcase-confirm').addEventListener('click', () => {
  showcaseNoticeAcknowledged = true;
  closeShowcaseIntro();
  (main.querySelector('h1') ?? main).focus({ preventScroll: true });
});
showcaseIntro.addEventListener('cancel', () => { showcaseNoticeAcknowledged = true; });
function syncIntro(session) {
  document.querySelector('#intro-storage-warning').hidden = session.persistence.mode !== 'memory';
  if (session.introAcknowledged) {
    if (intro.open) { closeIntro(); main.focus({ preventScroll: true }); }
  } else if (!intro.open) intro.showModal();
}
let ready = false;
let busy = false;
let renderVersion = 0;
let lastError = null;
const hallState = createHallState();
const publishDrafts = new Map();
const taskStates = new Map();
let displayedUserId;
let taskOrigin = 'hall';
let externalChange = false;
function getMyTasksState(userId) {
  if (!taskStates.has(userId)) taskStates.set(userId, createMyTasksState());
  return taskStates.get(userId);
}
function rememberScroll() {
  if (displayedRoute === 'showcase') showcaseState.scrollY = window.scrollY;
  if (displayedRoute === 'hall') hallState.scrollY = window.scrollY;
  if (displayedRoute === 'tasks' && displayedUserId) getMyTasksState(displayedUserId).scrollY = window.scrollY;
}
function showExternalChange() {
  if (!externalChange) {
    externalChange = true;
    repository.invalidate(); ready = false;
  }
  // Read-only examples remain available even when another tab changes the session.
  if (isShowcase(resolveRoute(window.location.hash))) return;
  showcaseMenu.sync(false, showcaseState.status);
  closeIntro();
  pageController?.abort(); ++renderVersion;
  closeShowcaseIntro();
  main.inert = true;
  document.querySelector('.bottom-nav').inert = true;
  banner.replaceChildren(el('section', { class: 'notice', role: 'alert' },
    el('p', {}, '其他标签页已更新本机演示记录。请刷新此页后继续，未提交输入可能丢失。'),
    button('刷新并读取最新记录', () => window.location.reload(), 'button button-secondary')));
  banner.querySelector('button').focus();
}
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { if (event.storageArea !== window.localStorage) return; } catch { return; }
  showExternalChange();
});
let publishNotice = null;
function getPublishDraft(userId) {
  if (!publishDrafts.has(userId)) publishDrafts.set(userId, createPublishDraft());
  return publishDrafts.get(userId);
}
window.addEventListener('beforeunload', event => {
  if (Array.from(publishDrafts.values()).some(hasDraftContent)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function onPublished(task, persistence, navigate) {
  const message = persistence.mode === 'memory' ? '发布成功，任务仅保留在当前临时会话中，刷新可能丢失。' : '发布成功，演示任务已保存在当前浏览器。';
  if (navigate) {
    publishNotice = { taskId: task.id, message };
    window.location.hash = `#/task/${encodeURIComponent(task.id)}`;
  } else announce(message);
}
let pageController;
let displayedRoute;
history.scrollRestoration = 'manual';

window.addEventListener('scroll', () => {
  rememberScroll();
}, { passive: true });

const updateEditingState = () => document.body.classList.toggle('is-editing', document.activeElement?.matches('input, textarea') ?? false);
document.addEventListener('focusin', updateEditingState);
document.addEventListener('focusout', () => queueMicrotask(updateEditingState));

function showPersistence(persistence) {
  if (externalChange) return;
  banner.replaceChildren(...(persistence.warning ? [el('p', { class: 'notice', role: 'status' }, persistence.warning.message)] : []));
}

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});

function setBusy(value) {
  busy = value;
  document.querySelector('#app').setAttribute('aria-busy', String(value));
  for (const control of document.querySelectorAll('#app button, #app select')) {
    if (!control.closest('.showcase-menu') && control.id !== 'showcase-confirm') control.disabled = value;
  }
  if (!value && intro.open && document.activeElement === intro) document.querySelector('#intro-confirm').focus({ preventScroll: true });
}

function announce(message, error = false) {
  feedback.textContent = message;
  feedback.className = error ? 'feedback feedback-error' : 'feedback';
  feedback.hidden = !message;
}

function showFailure(error) {
  pageController?.abort();
  ++renderVersion;
  ready = false;
  lastError = error;
  banner.hidden = false;
  showcaseMenu.sync(false, showcaseState.status);
  banner.replaceChildren();
  closeIntro();
  closeShowcaseIntro();
  const recoverable = ['SNAPSHOT_INVALID', 'SCHEMA_UNSUPPORTED'].includes(error.code);
  main.replaceChildren(el('section', { class: 'panel error-panel' },
    el('h1', { tabindex: '-1' }, '暂时无法进入演示'), el('p', {}, error.message),
    button('重试加载', initialize), recoverable ? button('重置演示', reset, 'button button-danger') : null));
}

async function render(focus = false) {
  rememberScroll();
  pageController?.abort();
  const controller = new AbortController();
  pageController = controller;
  const version = ++renderVersion;
  const route = resolveRoute(window.location.hash);
  const examples = isShowcase(route);
  showcaseMenu.sync(examples, showcaseState.status);
  banner.hidden = examples;
  for (const link of document.querySelectorAll('.bottom-nav a')) {
    const active = link.dataset.page === route.name || (route.name === 'task' && link.dataset.page === taskOrigin);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  if (examples) {
    closeIntro();
    main.inert = navigation.inert = false;
    main.replaceChildren(el('p', { class: 'loading', role: 'status' }, '正在加载固定样例…'));
    const page = await renderShowcasePage(route, showcaseService, { state: showcaseState, signal: controller.signal, retry: retryPage });
    if (version !== renderVersion) return;
    main.replaceChildren(page);
    displayedRoute = route.name;
    displayedUserId = undefined;
    document.title = `${page.querySelector('h1')?.textContent ?? '样例展示'} · 校园跑腿互助平台`;
    if (focus) main.querySelector('h1')?.focus({ preventScroll: true });
    if (route.name === 'showcaseTask') window.scrollTo(0, 0);
    if (!showcaseNoticeAcknowledged && !showcaseIntro.open) {
      showcaseMenu.close();
      showcaseIntro.showModal();
    }
    return;
  }
  closeShowcaseIntro();
  if (externalChange) { showExternalChange(); return; }
  if (!ready) return;
  const result = await service.getSession();
  if (version !== renderVersion) return;
  if (!result.ok) { if (result.error.code === 'EXTERNAL_CHANGE') return showExternalChange(); return showFailure(result.error); }
  const session = result.data;
  const page = await renderPage(route, session, service, { actorId: session.activeUser.id, switchUser, reset, hallState, getPublishDraft, onPublished, signal: controller.signal,
    retry: retryPage,
    myTasksState: getMyTasksState(session.activeUser.id), taskOrigin, onTaskOrigin: origin => { taskOrigin = origin; },
    onPersistence: persistence => { if (!controller.signal.aborted) showPersistence(persistence); } });
  if (version !== renderVersion) return;
  const currentSession = await service.getSession();
  if (version !== renderVersion) return;
  showPersistence(currentSession.ok ? currentSession.data.persistence : session.persistence);
  main.replaceChildren(page);
  displayedRoute = route.name;
  displayedUserId = session.activeUser.id;
  document.title = `${page.querySelector('h1')?.textContent ?? '演示'} · 校园跑腿互助平台`;
  if (publishNotice && route.name === 'task' && route.taskId === publishNotice.taskId) {
    announce(publishNotice.message);
    publishNotice = null;
  }
  setBusy(busy);
  if (focus) {
    main.querySelector('h1')?.focus({ preventScroll: true });
    if (!['hall', 'tasks'].includes(route.name)) window.scrollTo(0, 0);
  }
  syncIntro(currentSession.ok ? currentSession.data : session);
}

async function perform(operation, successMessage) {
  if (busy) return;
  setBusy(true);
  try {
    const result = await operation();
    if (externalChange) return;
    if (!result.ok) {
      if (intro.open) {
        const error = document.querySelector('#intro-error');
        error.textContent = result.error.message;
        error.hidden = false;
      } else announce(result.error.message, true);
      return;
    }
    ready = true;
    lastError = null;
    await render();
    if (externalChange) return;
    announce(result.data.persistence.mode === 'memory' ? `${successMessage}当前为临时会话，刷新可能无法保留。` : successMessage);
  } catch {
    announce('页面更新失败，请刷新后重试。', true);
  } finally { setBusy(false); }
}

function switchUser(userId) {
  return perform(() => service.switchDemoUser(userId), '演示身份已切换，任务记录已保留。');
}

async function reset() {
  if (busy) return;
  const previousFocus = document.activeElement;
  setBusy(true);
  const confirmed = await confirmReset();
  setBusy(false);
  if (!confirmed) { announce('已取消重置，当前记录保持不变。'); if (previousFocus?.isConnected && !externalChange) previousFocus.focus(); return; }
  await perform(async () => {
    const result = await service.resetDemo(true);
    if (result.ok) { Object.assign(hallState, createHallState()); taskStates.clear(); publishDrafts.clear(); publishNotice = null; taskOrigin = 'hall'; }
    return result;
  }, '演示已重置，样例时间已重新生成。');
}

async function initialize() {
  if (busy) return;
  setBusy(true);
  main.replaceChildren(el('p', { class: 'loading', role: 'status' }, '正在加载本机演示记录…'));
  announce('');
  try {
    const result = await service.initialize();
    if (externalChange) return;
    if (!result.ok) {
      if (isShowcase(resolveRoute(window.location.hash))) lastError = result.error;
      else showFailure(result.error);
      return;
    }
    ready = true;
    lastError = null;
    await render();
  } catch {
    if (!externalChange) {
      const error = { code: 'INTERNAL_ERROR', message: '页面加载未完成，请重试。' };
      if (isShowcase(resolveRoute(window.location.hash))) lastError = error;
      else showFailure(error);
    }
  } finally { setBusy(false); }
}

function retryPage() {
  const examples = isShowcase(resolveRoute(window.location.hash));
  if (!examples && (!ready || externalChange)) return;
  const pending = render(true);
  const version = renderVersion;
  void pending.catch(() => {
    if ((!examples && externalChange) || version !== renderVersion) return;
    pageController?.abort();
    main.replaceChildren(el('section', { class: 'panel error-panel', role: 'alert' },
      el('h1', { tabindex: '-1' }, '页面暂时无法显示'), el('p', {}, examples ? '可以重试样例，你的体验记录不会改变。' : '请重试此页，本次会话内的发布输入仍会保留。'),
      button('重试此页', retryPage), el('a', { href: examples ? '#/showcase' : '#/hall', class: 'button button-secondary' }, examples ? '返回样例展示' : '返回任务大厅')));
    main.querySelector('h1')?.focus();
  });
}

startRouter(() => {
  const route = resolveRoute(window.location.hash);
  showcaseMenu.close();
  if (!isShowcase(route)) closeShowcaseIntro();
  if (route.name === 'hall') taskOrigin = 'hall';
  announce('');
  if (isShowcase(route) || ready) retryPage();
  else if (externalChange) { banner.hidden = false; showExternalChange(); }
  else if (lastError) { banner.hidden = false; showFailure(lastError); }
  else if (!busy) void initialize();
});
