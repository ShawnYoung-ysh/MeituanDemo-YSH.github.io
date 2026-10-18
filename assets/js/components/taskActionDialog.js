import { button, el } from './dom.js';
import { TASK_ACTIONS } from '../services/taskRules.js';

const dialogText = {
  accept: ['接下这条任务？', '确认后由你负责跑腿。开始前可以退出；演示不会收款或扣款。', '确认接单'],
  cancel: ['取消这条任务？', '取消后任务无法再接单，不增加或扣除信用。', '确认取消任务'],
  withdraw: ['退出这次接单？', '你将不再是当前跑腿者。未截止的任务会重新进入大厅；已截止则显示已截止，不扣信用。', '确认退出接单'],
  submit_completion: ['说明交付情况', '提交后等待发布同学确认，暂不计为完成，也不增加信用。', '提交交付说明'],
  confirm_completion: ['确认已经收到交付？', '任务将变为已完成，并给跑腿同学记录一次 +2 信用，最高 100 分。演示不发生支付。', '确认完成并入账'],
  dispute: ['说明异议原因', '任务将进入“演示中待处理”，不增加信用，也不自动扣分或裁决。', '提交异议'],
};

export function requestTaskAction({ action, task, signal, initialNote = '' }) {
  return new Promise(resolve => {
    const rule = TASK_ACTIONS[action];
    const [title, description, submitLabel] = dialogText[action];
    const dialog = el('dialog', { class: 'confirm-dialog task-action-dialog', 'aria-labelledby': 'task-action-title', 'aria-describedby': 'task-action-description' });
    const note = rule.field ? el('textarea', { id: 'task-action-note', rows: '4', maxlength: '500', 'aria-describedby': 'task-action-note-hint task-action-note-error' }) : null;
    if (note) note.value = initialNote;
    const error = el('p', { id: 'task-action-note-error', class: 'field-error', role: 'alert', hidden: true });
    let settled = false;
    const abort = () => finish(false);
    function finish(confirmed) {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.remove();
      resolve({ confirmed, note: note?.value ?? '' });
    }
    const cancel = button('暂不操作', () => finish(false), 'button button-secondary');
    cancel.setAttribute('autofocus', '');
    dialog.append(el('h2', { id: 'task-action-title' }, title), el('p', { class: 'dialog-task-title' }, task.title),
      el('p', { id: 'task-action-description' }, description));
    if (note) dialog.append(el('div', { class: 'form-field' },
      el('label', { for: 'task-action-note' }, rule.field === 'completionNote' ? '交付说明' : '异议原因'), note,
      el('p', { id: 'task-action-note-hint', class: 'field-hint' }, '必填，1–500 字，按纯文本展示。'), error));
    dialog.append(el('div', { class: 'dialog-actions' }, cancel, button(submitLabel, () => {
      if (note && (!note.value.trim() || note.value.trim().length > 500)) {
        error.textContent = rule.field === 'completionNote' ? '请填写 1–500 字的交付说明。' : '请填写 1–500 字的异议原因。';
        error.hidden = false;
        note.setAttribute('aria-invalid', 'true');
        note.focus();
        return;
      }
      finish(true);
    }, ['cancel', 'withdraw', 'dispute'].includes(action) ? 'button button-danger' : 'button')));
    dialog.addEventListener('close', () => finish(false), { once: true });
    if (signal.aborted) { finish(false); return; }
    signal.addEventListener('abort', abort, { once: true });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('dialog-fallback'); }
    cancel.focus();
  });
}
