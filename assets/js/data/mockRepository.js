import { copy, DemoError, initializeSnapshot, STORAGE_KEY, validateSnapshot } from './snapshot.js';

export async function fetchSeed(baseURI = document.baseURI) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(new URL('./mock/db.json', baseURI), { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function createMockRepository({ getStorage = () => globalThis.localStorage, loadSeed = fetchSeed, now = Date.now } = {}) {
  let snapshot = null;
  let storage;
  let storageChecked = false;
  let mode = 'persistent';
  let queue = Promise.resolve();
  let persistedRaw = null;
  let invalidated = false;
  const assertCurrent = () => {
    if (invalidated) throw new DemoError('EXTERNAL_CHANGE', '其他标签页已更新演示记录，请刷新此页后继续；未提交输入可能丢失。');
    if (snapshot && mode === 'persistent') {
      let current;
      try { current = storage.getItem(STORAGE_KEY); }
      catch { mode = 'memory'; return; }
      if (current !== persistedRaw) {
        invalidated = true;
        throw new DemoError('EXTERNAL_CHANGE', '其他标签页已更新演示记录，请刷新此页后继续；未提交输入可能丢失。');
      }
    }
  };
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const memoryWarning = '当前为临时会话：修改仅在此页面内有效，刷新可能丢失修改或恢复上次保存的记录。';
  const getPersistence = () => ({ mode, warning: mode === 'memory' ? { code: 'STORAGE_UNAVAILABLE', message: memoryWarning } : null });
  const state = () => ({ snapshot: copy(snapshot), persistence: getPersistence() });
  const accessStorage = () => {
    if (!storageChecked) {
      storageChecked = true;
      try {
        storage = getStorage();
        if (!storage) mode = 'memory';
      } catch { mode = 'memory'; }
    }
    return storage;
  };
  const save = next => {
    assertCurrent();
    validateSnapshot(next);
    const serialized = JSON.stringify(next);
    // One snapshot write; memory is published only after that attempt completes.
    if (mode === 'persistent') {
      try { accessStorage()?.setItem(STORAGE_KEY, serialized); persistedRaw = serialized; }
      catch { mode = 'memory'; }
    }
    snapshot = next;
    return state();
  };
  const freshSnapshot = async () => {
    try {
      const seed = await loadSeed();
      return initializeSnapshot(seed, now());
    } catch {
      throw new DemoError('SEED_LOAD_FAILED', '演示数据未能加载，原有记录未被改动。请检查网络后重试。');
    }
  };
  const requireReady = () => {
    assertCurrent();
    if (!snapshot) throw new DemoError('NOT_READY', '演示尚未就绪，请先加载数据。');
  };
  return {
    invalidate: () => { invalidated = true; },
    initialize: () => serial(async () => {
      assertCurrent();
      if (snapshot) return state();
      const target = accessStorage();
      let raw = null;
      if (mode === 'persistent') {
        try { raw = target.getItem(STORAGE_KEY); }
        catch { mode = 'memory'; }
      }
      if (raw !== null) {
        let restored;
        try { restored = JSON.parse(raw); }
        catch { throw new DemoError('SNAPSHOT_INVALID', '本机演示记录无法读取。原记录已保留，可重试或确认后重置。'); }
        validateSnapshot(restored);
        restored.preferences ??= { introAcknowledged: false };
        snapshot = restored;
        persistedRaw = raw;
        return state();
      }
      return save(await freshSnapshot());
    }),
    read: () => serial(() => { requireReady(); return state(); }),
    update: mutator => serial(() => {
      requireReady();
      const next = copy(snapshot);
      const result = mutator(next);
      if (result && typeof result.then === 'function') throw new Error('Snapshot mutations must be synchronous');
      // A no-op read/expiry scan must not rewrite storage or trigger other tabs.
      if (result === false) return state();
      return save(next);
    }),
    reset: confirmed => serial(async () => {
      assertCurrent();
      if (confirmed !== true) throw new DemoError('CONFIRMATION_REQUIRED', '请先确认重置演示。');
      accessStorage();
      // Prepare first, then replace this key only. Failed downloads preserve old data.
      return save(await freshSnapshot());
    }),
  };
}
