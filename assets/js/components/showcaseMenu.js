import { button } from './dom.js';
import { TASK_STATUS_LABELS } from '../services/taskService.js';

export function createShowcaseMenu(root, onSelect) {
  const trigger = root.querySelector('summary');
  const panel = root.querySelector('.showcase-menu-panel');
  const options = [['', '全部样例'], ...Object.entries(TASK_STATUS_LABELS)];
  const controls = options.map(([status, label]) => {
    const control = button(label, () => { root.open = false; onSelect(status); }, 'showcase-filter-option');
    control.dataset.status = status;
    control.setAttribute('aria-pressed', 'false');
    return control;
  });
  panel.replaceChildren(...controls);
  function close(restoreFocus = false) {
    root.open = false;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!root.contains(event.target)) close(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.open) { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  return {
    close,
    sync(active, status) {
      if (active) trigger.setAttribute('aria-current', 'page'); else trigger.removeAttribute('aria-current');
      for (const control of controls) control.setAttribute('aria-pressed', String(active && control.dataset.status === status));
    },
  };
}
