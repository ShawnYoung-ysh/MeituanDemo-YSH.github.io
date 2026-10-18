// User-provided strings become text nodes; this helper never parses HTML.
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}

export function button(label, action, className = 'button') {
  const node = el('button', { type: 'button', class: className }, label);
  node.addEventListener('click', action);
  return node;
}

export function confirmReset() {
  return new Promise(resolve => {
    const dialog = el('dialog', { class: 'confirm-dialog', 'aria-labelledby': 'reset-title', 'aria-describedby': 'reset-description' });
    const cancel = button('保留当前记录', () => dialog.close('cancel'), 'button button-secondary');
    cancel.setAttribute('autofocus', '');
    dialog.append(
      el('h2', { id: 'reset-title' }, '重置本机演示？'),
      el('p', { id: 'reset-description' }, '这会替换本机的任务、评价和信用记录，恢复默认身份，并重新生成样例时间。其他网站的数据不受影响。'),
      el('div', { class: 'dialog-actions' }, cancel, button('确认重置', () => dialog.close('confirm'), 'button button-danger')),
    );
    dialog.addEventListener('close', () => { const confirmed = dialog.returnValue === 'confirm'; dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.remove();
      resolve(window.confirm('重置本机演示？将替换任务、评价和信用记录并恢复默认身份。'));
    }
  });
}
