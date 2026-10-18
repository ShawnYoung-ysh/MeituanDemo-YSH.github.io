import { el } from './dom.js';
import { localTime } from './format.js';
import { validateReview } from '../services/reviewService.js';

export function reviewItem(review) {
  return el('li', { class: 'review-item' },
    el('div', { class: 'review-meta' }, el('strong', {}, `${review.rating} / 5 星`), el('span', {}, `${review.authorName}${review.targetName ? ` → ${review.targetName}` : ''}`)),
    el('p', { class: 'task-description review-comment' }, review.comment || '这位同学只留下了评分。'),
    el('time', { class: 'small muted', datetime: new Date(review.createdAt).toISOString() }, `${localTime(review.createdAt)}（本地时间）`));
}

export function reviewSection(task, service, { actorId, signal, onPersistence, onReviewed }) {
  const context = task.reviewContext;
  const section = el('section', { class: 'panel task-reviews', 'aria-labelledby': 'task-reviews-title' },
    el('h2', { id: 'task-reviews-title' }, '双方评价'), el('p', { class: 'field-hint' }, context.reason));
  section.append(context.reviews.length ? el('ul', { class: 'review-list' }, ...context.reviews.map(reviewItem)) : el('p', { class: 'muted' }, '暂无评价。'));
  if (!context.canReview) return section;
  const form = el('form', { class: 'review-form', novalidate: true, 'aria-label': '评价任务对方' });
  const rating = el('select', { id: 'review-rating', name: 'rating', 'aria-describedby': 'review-rating-error' }, el('option', { value: '' }, '请选择评分'),
    ...[5, 4, 3, 2, 1].map(value => el('option', { value }, `${value} 星`)));
  const comment = el('textarea', { id: 'review-comment', name: 'comment', maxlength: '300', rows: '3', 'aria-describedby': 'review-comment-hint review-comment-error' });
  const errors = Object.fromEntries(['rating', 'comment'].map(field => [field, el('p', { id: `review-${field}-error`, class: 'field-error', hidden: true })]));
  const feedback = el('p', { class: 'feedback', role: 'status', hidden: true, tabindex: '-1' });
  const submit = el('button', { type: 'submit', class: 'button publish-submit' }, '提交评价');
  let pending = false;
  const requests = new Map();
  form.append(el('h3', {}, `评价 ${context.target.nickname}`),
    el('div', { class: 'form-field' }, el('label', { for: 'review-rating' }, '评分（必选）'), rating, errors.rating),
    el('div', { class: 'form-field' }, el('label', { for: 'review-comment' }, '评价文字（选填）'), comment,
      el('p', { id: 'review-comment-hint', class: 'field-hint' }, '最多 300 字，按纯文本展示；提交后不能修改。'), errors.comment), submit, feedback);
  function showErrors(fields) {
    for (const [field, control] of [['rating', rating], ['comment', comment]]) {
      errors[field].textContent = fields[field] ?? ''; errors[field].hidden = !fields[field];
      control.setAttribute('aria-invalid', String(Boolean(fields[field])));
    }
    const first = Object.keys(fields)[0];
    if (first) (first === 'rating' ? rating : comment).focus();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || signal.aborted) return;
    const input = { rating: Number(rating.value), comment: comment.value };
    const validation = validateReview(input);
    showErrors(validation.fields);
    if (Object.keys(validation.fields).length) return;
    const fingerprint = JSON.stringify(input);
    if (!requests.has(fingerprint)) requests.set(fingerprint, crypto.randomUUID());
    pending = true; form.setAttribute('aria-busy', 'true');
    rating.disabled = comment.disabled = submit.disabled = true;
    try {
      const result = await service.addReview({ ...input, actorId, taskId: task.id, requestId: requests.get(fingerprint) });
      if (signal.aborted) return;
      if (!result.ok) {
        rating.disabled = comment.disabled = submit.disabled = false;
        feedback.textContent = result.error.message; feedback.hidden = false; feedback.className = 'feedback feedback-error';
        showErrors(result.error.fields ?? {});
        if (!result.error.fields) feedback.focus({ preventScroll: true });
        if (result.error.code === 'ALREADY_REVIEWED') await onReviewed('你已评价，已更新当前记录。');
        return;
      }
      onPersistence(result.data.persistence);
      await onReviewed(`评价已保存，信用不变。${result.data.persistence.mode === 'memory' ? '当前为临时会话，刷新可能无法保留。' : ''}`);
    } catch {
      if (!signal.aborted) { feedback.textContent = '评价未能提交，请重试。'; feedback.hidden = false; }
    } finally {
      pending = false; form.setAttribute('aria-busy', 'false');
      rating.disabled = comment.disabled = submit.disabled = false;
    }
  });
  section.append(form);
  return section;
}
