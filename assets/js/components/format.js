export const localTime = value => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(value);

export const formatMoneyCents = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
