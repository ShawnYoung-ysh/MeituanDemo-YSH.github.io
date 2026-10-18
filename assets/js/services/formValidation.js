export const TASK_FORM_FIELDS = ['category', 'title', 'description', 'pickupLocationId', 'dropoffLocationId', 'deadlineAt', 'reward', 'goodsBudget'];

// Parse decimal text before converting to Number; never round a floating-point price.
export function parseMoneyCents(value, { optional = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (optional && text === '') return 0;
  if (text.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(max) ? Number(cents) : null;
}

export function formatLocalDeadline(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDeadline(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return NaN;
  return date.getTime();
}

export function validateTaskForm(form, { now, campusId, categories, locations }) {
  const fields = {};
  if (!form || typeof form !== 'object' || Array.isArray(form)) return { ok: false, fields: { title: '请填写任务表单。' } };
  const title = typeof form.title === 'string' ? form.title.trim() : '';
  const description = typeof form.description === 'string' ? form.description.trim() : '';
  if (!categories.some(item => item.id === form.category)) fields.category = '请选择任务类别。';
  if (title.length < 4 || title.length > 60) fields.title = '标题请填写 4–60 字，不能只含空格。';
  if (description.length < 10 || description.length > 500) fields.description = '任务说明请填写 10–500 字，不能只含空格。';
  for (const [key, label] of [['pickupLocationId', '取件地点'], ['dropoffLocationId', '送达地点']]) {
    if (!locations.some(item => item.id === form[key] && item.campusId === campusId)) fields[key] = `请选择当前校区的${label}。`;
  }
  if (!Number.isSafeInteger(form.deadlineAt) || form.deadlineAt < now + 10 * 60000 || form.deadlineAt > now + 24 * 3600000) {
    fields.deadlineAt = '截止时间须距提交时刻至少 10 分钟，且不超过 24 小时。';
  }
  const rewardCents = parseMoneyCents(form.reward, { max: 5000 });
  const goodsBudgetCents = parseMoneyCents(form.goodsBudget ?? '', { optional: true });
  if (rewardCents === null) fields.reward = '酬谢请填写 0–50 元，最多两位小数，例如 3.50。';
  if (goodsBudgetCents === null) fields.goodsBudget = '商品预算请填写非负金额，最多两位小数；不需要可留空。';
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data: {
    category: form.category, title, description, pickupLocationId: form.pickupLocationId,
    dropoffLocationId: form.dropoffLocationId, deadlineAt: form.deadlineAt, rewardCents, goodsBudgetCents,
  } };
}
