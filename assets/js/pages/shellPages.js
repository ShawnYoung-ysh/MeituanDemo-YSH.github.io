import { el } from '../components/dom.js';
import { renderHallPage } from './hallPage.js';
import { renderPublishPage } from './publishPage.js';
import { renderDetailPage } from './detailPage.js';
import { renderMyTasksPage } from './myTasksPage.js';
import { renderProfilePage } from './profilePage.js';

export async function renderPage(route, session, service, actions) {
  if (route.name === 'hall') return renderHallPage(session, service, actions);
  if (route.name === 'publish') return renderPublishPage(session, service, actions);
  if (route.name === 'me') return renderProfilePage(session, service, actions);
  if (route.name === 'task') return renderDetailPage(route.taskId, service, actions);
  if (route.name === 'tasks') return renderMyTasksPage(session, service, actions);
  return renderMissing('这个页面不存在，请从任务大厅继续。');
}

export function renderMissing(message) {
  return el('div', { class: 'page' }, el('div', { class: 'page-heading' }, el('h1', { tabindex: '-1' }, '未找到内容'), el('p', { class: 'muted' }, message)),
    el('a', { href: '#/hall', class: 'button button-secondary' }, '返回任务大厅'));
}
