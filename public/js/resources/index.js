// Shared resource context and the legacy optional preload controller.
// The mandatory entry gate/cache center use preload.js and the same Cache Storage + download lock.
// This controller remains available to older resourcePanel/syncResources callers.

import { CACHE_PREFIX, MANIFEST_URL, SW_URL, TIER_ESSENTIAL, TIER_REST, checkAbort, formatBytes, validateManifest } from './common.js';
import { ResourceStore } from './store.js';

/** @type {any} */
const state = {
  enabled: false,
  phase: 'off', // off | checking | download | foreign (another tab) | ready | paused | error
  supported: true,
  reason: '',
  done: 0,
  total: 0,
  wanted: 0,
  tier1Done: 0,
  tier1Total: 0,
  tier2Done: 0,
  tier2Total: 0,
  bytes: 0,
  totalBytes: null,
  sized: 0,
  sizedTotal: 0,
  skipped: 0,
  failed: 0,
  complete: false,
  message: '',
  error: false,
  worker: '',
  version: '',
};

const listeners = new Set();
let current = false;
let controller = null;
let contextPromise = null;

/** Subscribe to preload state changes (returns the unsubscribe function). */
export function subscribeResources(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A copy of the current preload state (safe to hand to Preact). */
export function resourceState() {
  return { ...state };
}

function set(patch) {
  const before = JSON.stringify(state); // the state is small and flat: a cheap "did anything change" test
  Object.assign(state, patch);
  if (JSON.stringify(state) === before) return;
  for (const fn of [...listeners]) {
    try { fn(resourceState()); } catch (err) { console.error('[resources] listener failed', err); }
  }
}

/**
 * The counters of one store payload (status / progress / result — store.js emits the same fields for all three), in the
 * names the panel renders. One shape for all three is what keeps a progress update from leaving a field undefined.
 */
const counters = (s) => ({
  done: s.count,
  total: s.total,
  wanted: s.wanted,
  tier1Done: s.tier1Present,
  tier1Total: s.tier1,
  tier2Done: s.tier2Present,
  tier2Total: s.tier2,
  bytes: s.bytes,
  totalBytes: s.totalBytes,
  sized: s.sized,
  sizedTotal: s.sizedTotal,
  skipped: s.skipped,
  complete: s.complete,
  // migration (kept bytes) vs network (fetched bytes): 0 unless a run is/was in flight
  adopted: s.adopted ?? 0,
  downloaded: s.downloaded ?? 0,
});

/** Why this browser cannot keep the resources (empty ⇒ it can). */
export function unsupportedReason() {
  if (!globalThis.isSecureContext) return '需要 HTTPS（或 localhost）才能预载资源';
  if (!globalThis.caches) return '当前浏览器不支持 Cache Storage';
  if (!globalThis.navigator?.serviceWorker) return '当前浏览器不支持 Service Worker';
  return '';
}

/**
 * The preload context: the manifest plus (when this browser can cache) its store. Cached for the session; a failure is
 * retried the next time the player enables the preload.
 */
export function resourceContext() {
  contextPromise ??= (async () => {
    const reason = unsupportedReason();
    if (reason) return { unsupported: reason }; // no point in asking for a list this browser cannot store
    let res;
    try {
      const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10000) : undefined;
      // Revalidate the HTTP cache on every page load. On a wire-level 304 the browser supplies the cached JSON body.
      res = await fetch(MANIFEST_URL, { cache: 'no-cache', signal });
    } catch (err) {
      return { error: `无法读取资源清单：${err?.message || err}` };
    }
    if (!res.ok) return { error: `无法读取资源清单：HTTP ${res.status}` };
    let manifest;
    try {
      manifest = validateManifest(await res.json());
    } catch (err) {
      return { error: String(err?.message || err) };
    }
    if (!manifest.files.length) return { manifest, empty: true };
    return { manifest, store: new ResourceStore(manifest) };
  })().then(ctx => {
    if (!ctx.store) contextPromise = null; // Retry a failed manifest/unsupported attempt from the entry dialog.
    return ctx;
  });
  return contextPromise;
}

export function resetResourceContext() { contextPromise = null; }

/** Register the Service Worker that serves the cached files (downloads work without it). */
async function ensureWorker() {
  const nav = globalThis.navigator;
  if (!nav?.serviceWorker) throw new Error('不支持 Service Worker');
  const reg = await nav.serviceWorker.register(SW_URL, { type: 'classic', scope: '/', updateViaCache: 'none' });
  set({ worker: '' });
  return reg;
}

/** Unregister the worker (nothing to serve from the cache any more). */
async function dropWorker() {
  const nav = globalThis.navigator;
  if (!nav?.serviceWorker) return;
  try {
    for (const reg of await nav.serviceWorker.getRegistrations()) {
      const url = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
      if (url.endsWith(SW_URL)) await reg.unregister();
    }
  } catch { /* the worker is optional */ }
}

/**
 * Turn the preload on or off (idempotent: the settings store fires on every volume change).
 * @param {boolean} enabled
 */
export async function syncResources(enabled) {
  enabled = !!enabled;
  if (enabled === current) { set({ enabled }); return; }
  current = enabled;
  set({ enabled, error: false, message: '' });
  if (!enabled) {
    controller?.abort();
    set({ phase: state.complete ? 'ready' : 'paused', message: state.complete ? '预载已停止；已保存的资源保留，可继续下载或清理缓存。' : '已停止预载。' });
    return;
  }
  return start();
}

/** Continue (or start) the download of an enabled preload. */
export async function startResources() {
  if (!current) return;
  return start();
}

/**
 * The download of one tab at a time (Web Locks): Cache Storage is shared by every tab of the origin, so without this
 * two tabs of the same session would fetch the same ~250 MiB twice. The second tab does not queue behind the first: it
 * reports what is already cached and re-checks when the player comes back to it (`ifAvailable`).
 */
export const DOWNLOAD_LOCK = 'stronghold-resources-preload';

/** Run `job` while holding the download lock; `{ busy: true }` when another tab has it. Unsupported ⇒ just run it. */
async function withDownloadLock(job) {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') return job();
  return locks.request(DOWNLOAD_LOCK, { ifAvailable: true }, async (lock) => (lock ? job() : { busy: true }));
}

/** Another tab owns the download: show what is cached and look again when this tab becomes visible. */
function watchOtherTab(store) {
  if (globalThis.document?.addEventListener) {
    const recheck = () => {
      if (document.visibilityState !== 'visible' || !current) return;
      document.removeEventListener('visibilitychange', recheck);
      void startResources();
    };
    document.addEventListener('visibilitychange', recheck);
  }
  return store.status().then((st) => set({
    ...counters(st), phase: 'foreign', error: false,
    message: st.complete ? '资源已全部预载完成。' : '另一个标签页正在预载⋯回到这个标签页时会自动继续。',
  }));
}

async function start() {
  set({ phase: 'checking', message: '正在检查已保存的资源…', error: false });
  const ctx = await resourceContext();
  if (ctx.error || ctx.unsupported || ctx.empty) {
    const message = ctx.error || ctx.unsupported || '服务器没有可预载的资源';
    set({ phase: 'error', message, error: true, supported: !ctx.unsupported });
    if (ctx.unsupported) void dropWorker();
    return;
  }
  const store = ctx.store;
  set({ supported: true, version: store.manifest.version });
  // registering an already-registered worker is a cheap no-op, so every start can retry a failed one. A failure here
  // does NOT stop the download (the page fills Cache Storage itself) — it only means nothing can be served offline.
  ensureWorker().catch((err) => {
    console.warn('[resources] service worker not registered — the cached assets cannot be served without the network', err);
    set({ worker: `预载服务未启用（${err?.message || err}），资源仍会下载，但不会从本机缓存读取。` });
  });
  const before = await store.status();
  set({ ...counters(before), phase: before.complete ? 'ready' : 'download', message: before.complete ? '资源已全部预载完成。' : '' });
  if (before.complete) { void store.prune(); return; }
  controller = new AbortController();
  const signal = controller.signal;
  const onProgress = (p) => {
    // "整理" instead of "下载" when the files came out of an older cache: nothing is being fetched (store.js 的迁移).
    const message = p.adopted > 0 && p.downloaded === 0 ? '正在整理已保存的资源（无需重新下载）…' : '';
    set({ ...counters(p), phase: 'download', failed: p.failed, error: false, message });
  };
  try {
    // one tab at a time; two passes per tab: what a screen needs in its first second, then the rest (portraits, Spine,
    // board art)
    const outcome = await withDownloadLock(async () => {
      checkAbort(signal);
      await store.download({ tiers: [TIER_ESSENTIAL], signal, onProgress });
      await store.download({ tiers: [TIER_REST], signal, onProgress });
      return { busy: false };
    });
    if (outcome.busy) { await watchOtherTab(store); return; }
    const after = await store.status();
    set({
      ...counters(after),
      phase: 'ready',
      error: false,
      message: after.complete
        ? `资源已全部预载完成（${formatBytes(after.bytes)}）。`
        : `已保存 ${after.count}/${after.total} 个文件；未完成的会在下次开启时重试。`,
    });
    if (after.complete) void store.prune();
  } catch (err) {
    if (err?.name === 'AbortError') {
      const now = await store.status().catch(() => null);
      set({ ...(now ? counters(now) : {}), phase: 'paused', message: current ? '已暂停，可继续下载或清理缓存。' : '已停止预载。' });
      return;
    }
    const message = err?.name === 'QuotaExceededError' || /quota|空间不足/i.test(String(err?.message || ''))
      ? '浏览器存储空间不足：已保存的文件保留，可清理缓存后重试。'
      : `预载失败：${err?.message || err}`;
    const now = await store.status().catch(() => null);
    set({ ...(now ? counters(now) : {}), phase: 'error', message, error: true });
  } finally {
    controller = null;
  }
}

/** Stop downloading (keeps what is cached). */
export function pauseResources() {
  if (controller) {
    controller.abort();
    set({ message: '正在暂停…' });
  }
}

/**
 * Delete every cached resource (all versions) and stop.
 */
export async function clearResources() {
  controller?.abort();
  const ctx = await resourceContext();
  // a run that was mid-file finishes (or aborts) before the caches go away, so nothing lands after the clear
  if (ctx.store?.running) { try { await ctx.store.running; } catch { /* aborted — nothing to keep */ } }
  if (ctx.store) await ctx.store.clear();
  else if (globalThis.caches) {
    const names = await globalThis.caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => globalThis.caches.delete(n)));
  }
  if (!current) await dropWorker();
  set({
    done: 0, tier1Done: 0, tier2Done: 0, bytes: 0, failed: 0, complete: false, error: false,
    phase: current ? 'paused' : 'off',
    message: '已清理预载资源缓存。',
  });
}
