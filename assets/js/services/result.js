import { DemoError } from '../data/snapshot.js';

export async function serviceResult(operation) {
  try { return { ok: true, data: await operation() }; }
  catch (error) {
    return { ok: false, error: {
      code: error instanceof DemoError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof DemoError ? error.message : '操作未完成，请重试。',
      ...(error instanceof DemoError && error.field ? { field: error.field } : {}),
      ...(error instanceof DemoError && error.fields ? { fields: error.fields } : {}),
    } };
  }
}

// Observe failures from every page without retrying or changing a business result.
export function observeServiceErrors(service, onError) {
  return Object.fromEntries(Object.entries(service).map(([name, operation]) => [name, async (...args) => {
    const result = await operation(...args);
    if (!result.ok) onError(result.error);
    return result;
  }]));
}
