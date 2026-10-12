import { CACHE_NAME, LEGACY_CACHE, isResourcePath, indexUrl } from './common.js';
import { resourceStep } from './async.js';

/** Advisory only: cached files do not prove a completed core/full preload. Never starts a scan or download. */
export async function hasCachedResources({ caches = globalThis.caches, storage, origin = globalThis.location?.origin || 'http://localhost',
  timeoutMs = 750 } = {}) {
  const fallback = () => {
    try { const p = JSON.parse((storage === undefined ? globalThis.localStorage : storage)?.getItem('sp_preloaded_profiles') || 'null'); return !!(p?.core || p?.full); }
    catch { return false; }
  };
  if (!caches?.keys || !caches?.open) return fallback();
  try {
    return await resourceStep(async signal => {
      const names = await caches.keys();
      for (const name of [CACHE_NAME, LEGACY_CACHE]) {
        if (!names.includes(name)) continue;
        const cache = await caches.open(name);
        if (signal.aborted) return fallback();
        // A title-screen hint must not start a whole-cache enumeration that keeps running after its deadline.
        const index = await cache.match(indexUrl(origin));
        if (signal.aborted) return fallback();
        let doc;try { doc = await index?.json(); } catch {}
        const keys = Object.keys(doc?.files || {}).filter(key => {
          try { const u = new URL(key, origin);return u.origin === origin && isResourcePath(u.pathname); }
          catch { return false; }
        }).slice(0, 3);
        // Older full/core bundles have no hash index, but contain these common, small resources.
        keys.push(...['/fonts/bender-regular.woff2', '/assets/local/map/autochess/tiles.json'].map(path => new URL(path, origin).href));
        for (const key of keys) {
          if (signal.aborted) return fallback();
          if (await cache.match(key)) return true;
        }
      }
      return false;
    }, { timeoutMs, label: '读取资源缓存提示' });
  } catch { return fallback(); }
}
