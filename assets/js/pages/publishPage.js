import { button, el } from '../components/dom.js';
import { formatLocalDeadline, parseLocalDeadline, validateTaskForm } from '../services/formValidation.js';

export const createPublishDraft = () => ({
  values: { category: '', title: '', description: '', pickupLocationId: '', dropoffLocationId: '', deadlineAt: '', reward: '', goodsBudget: '' },
  requestId: null, fingerprint: null,
});
export const hasDraftContent = draft => Object.values(draft.values).some(value => value.trim() !== '');

export async function renderPublishPage(session, service, { signal, getPublishDraft, onPublished, onPersistence }) {
  const optionsResult = await service.getPublishOptions();
  if (!optionsResult.ok) return el('div', { class: 'page' }, el('h1', {}, '暂时无法发布'), el('p', {}, optionsResult.error.message), el('a', { href: '#/hall', class: 'button' }, '返回任务大厅'));
  const options = optionsResult.data;
  const draft = getPublishDraft(session.activeUser.id);
  const controls = new Map();
  const errors = new Map();
  const page = el('div', { class: 'page publish-page' });
  const summary = el('p', { class: 'form-summary', role: 'alert', tabindex: '-1', hidden: true });
  const form = el('form', { class: 'publish-form', novalidate: true, 'aria-label': '发布演示任务' });
  let submitting = false;

  function field(name, label, control, hint, required = true) {
    const hintId = `publish-${name}-hint`;
    const errorId = `publish-${name}-error`;
    control.id = `publish-${name}`;
    control.name = name;
    control.value = draft.values[name];
    control.setAttribute('aria-describedby', `${hintId} ${errorId}`);
    if (required) control.setAttribute('required', '');
    controls.set(name, control);
    const error = el('p', { id: errorId, class: 'field-error', hidden: true });
    errors.set(name, error);
    for (const event of ['input', 'change']) control.addEventListener(event, () => {
      draft.values[name] = control.value;
      control.removeAttribute('aria-invalid');
      error.hidden = true;
    });
    return el('div', { class: 'form-field' }, el('label', { for: control.id }, label, required ? el('span', { class: 'required-note' }, ' 必填') : null),
      control, el('p', { id: hintId, class: 'field-hint' }, hint), error);
  }
  const select = (items, placeholder) => el('select', {}, el('option', { value: '' }, placeholder), ...items.map(item => el('option', { value: item.id }, item.name)));
  const deadline = el('input', { type: 'datetime-local', step: '60' });
  const deadlineField = field('deadlineAt', '截止时间（本地时间）', deadline, '距提交时刻 10 分钟至 24 小时。停留较久后，请重新核对时间。');
  function updateDateBounds() {
    const now = Date.now();
    deadline.min = formatLocalDeadline(Math.ceil((now + 10 * 60000) / 60000) * 60000);
    deadline.max = formatLocalDeadline(now + 24 * 3600000);
  }
  updateDateBounds();
  deadline.addEventListener('focus', updateDateBounds);
  const shortcuts = el('div', { class: 'deadline-shortcuts', role: 'group', 'aria-label': '快捷截止时间' },
    ...[[30, '30 分钟后'], [60, '1 小时后'], [120, '2 小时后']].map(([minutes, label]) => button(label, () => {
      deadline.value = formatLocalDeadline(Date.now() + minutes * 60000);
      draft.values.deadlineAt = deadline.value;
      deadline.removeAttribute('aria-invalid');
      errors.get('deadlineAt').hidden = true;
      updateDateBounds();
    }, 'shortcut-button')));
  deadlineField.append(shortcuts);
  const submit = el('button', { type: 'submit', class: 'button publish-submit' }, '发布演示任务');
  const title = el('input', { type: 'text', maxlength: '60', placeholder: '例如：帮取一件小包裹，送到公共门厅' });
  const description = el('textarea', { rows: '5', maxlength: '500', placeholder: '说明物品大小、交接安排和需要注意的事项。请勿填写真实手机号或取件码。' });
  form.append(
    el('section', { class: 'panel form-section', 'aria-label': '任务内容' }, el('h2', {}, '需要什么帮助？'),
      field('category', '任务类别', select(options.categories, '请选择类别'), '选择最接近需求的一类。'),
      field('title', '任务标题', title, '4–60 字，写清楚要做的事。'),
      field('description', '任务说明', description, '10–500 字，仅使用虚构信息；内容将按纯文本展示。')),
    el('section', { class: 'panel form-section', 'aria-label': '地点与时间' }, el('h2', {}, '在哪里，何时送达？'),
      el('p', { class: 'field-hint campus-form-note' }, options.campus.name),
      field('pickupLocationId', '取件地点', select(options.locations, '请选择取件地点'), '从当前演示校区的公共地点中选择。'),
      field('dropoffLocationId', '送达地点', select(options.locations, '请选择送达地点'), '在公共地点完成交接。'), deadlineField),
    el('section', { class: 'panel form-section', 'aria-label': '演示金额' }, el('h2', {}, '酬谢与商品预算'),
      field('reward', '跑腿酬谢（元）', el('input', { type: 'text', inputmode: 'decimal', maxlength: '16', placeholder: '0–50，例如 3.50' }), '0 元也可以。最多两位小数，与商品预算分开计算。'),
      field('goodsBudget', '商品预算（元，可选）', el('input', { type: 'text', inputmode: 'decimal', maxlength: '20', placeholder: '代买或打印费用，不需要可留空' }), '非负金额，最多两位小数；留空按 0 元。演示不会收款或扣款。', false)),
    summary, el('div', { class: 'publish-submit-area' },
      el('p', { class: 'field-hint' }, '发布后仅保存在当前浏览器；存储不可用时会明确提示临时会话。'), submit));
  function showErrors(fields, message) {
    summary.textContent = message || '请检查下方标出的内容，填写后再提交。';
    summary.hidden = false;
    for (const [name, control] of controls) {
      const error = errors.get(name);
      error.textContent = fields[name] || '';
      error.hidden = !fields[name];
      if (fields[name]) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
    }
    const first = controls.get(Object.keys(fields)[0]) || summary;
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || signal.aborted) return;
    controls.forEach((control, name) => { draft.values[name] = control.value; });
    const formData = { ...draft.values, deadlineAt: parseLocalDeadline(deadline.value) };
    const validation = validateTaskForm(formData, { now: Date.now(), campusId: options.actor.campusId, categories: options.categories, locations: options.locations });
    if (!validation.ok) { showErrors(validation.fields); return; }
    const fingerprint = JSON.stringify(formData);
    if (draft.fingerprint !== fingerprint || !draft.requestId) {
      draft.requestId = crypto.randomUUID();
      draft.fingerprint = fingerprint;
    }
    submitting = true;
    summary.hidden = true;
    form.setAttribute('aria-busy', 'true');
    for (const control of form.querySelectorAll('input,textarea,select,button')) control.disabled = true;
    submit.textContent = '正在发布…';
    try {
      const result = await service.createTask({ actorId: options.actor.id, form: formData, requestId: draft.requestId });
      if (!result.ok) {
        if (!signal.aborted) showErrors(result.error.fields || (result.error.field ? { [result.error.field]: result.error.message } : {}), result.error.message);
        return;
      }
      Object.assign(draft, createPublishDraft());
      if (!signal.aborted) onPersistence(result.data.persistence);
      onPublished(result.data.task, result.data.persistence, !signal.aborted);
    } catch {
      if (!signal.aborted) showErrors({}, '发布未能完成，请重试；本次输入已保留。');
    } finally {
      submitting = false;
      form.setAttribute('aria-busy', 'false');
      for (const control of form.querySelectorAll('input,textarea,select,button')) control.disabled = false;
      submit.textContent = '发布演示任务';
      if (!signal.aborted && !summary.hidden) {
        const invalid = form.querySelector('[aria-invalid="true"]');
        (invalid || summary).focus({ preventScroll: true });
        (invalid || summary).scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    }
  });
  page.append(el('div', { class: 'page-heading' }, el('span', { class: 'eyebrow' }, '发布 / 校园互助'), el('h1', { tabindex: '-1' }, '把小事，交给顺路的人'),
    el('p', { class: 'muted' }, `以 ${session.activeUser.nickname} 发布。本次页面会话内切换页面会保留输入，刷新或关闭页面会丢失未提交内容。`)), form);
  return page;
}
