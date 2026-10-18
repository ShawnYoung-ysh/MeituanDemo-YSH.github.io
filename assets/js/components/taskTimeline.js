import { el } from './dom.js';
import { localTime } from './format.js';

const eventLabels = { published: '发布任务', accepted: '接下任务', started: '开始跑腿', withdrawn: '退出跑腿',
  completion_submitted: '提交交付说明', completed: '发布者确认完成', cancelled: '取消任务', expired: '任务截止', disputed: '提出异议' };

export function taskTimeline(events) {
  return el('ol', { class: 'task-timeline' }, ...events.map(event => el('li', {},
    el('div', {}, el('strong', {}, eventLabels[event.action] || '任务更新'), el('span', {}, event.actorName)),
    el('time', { datetime: new Date(event.at).toISOString() }, `${localTime(event.at)}（本地时间）`))));
}
