import { CACHE_NAME, isResourcePath, mediaCandidates, rangeResponse, absoluteUrl } from './common.js';
import { RECEIPT_PATH } from './bundle.js';

export async function handleResourceRequest(request, { caches = globalThis.caches } = {}) {
  if (!request || request.method !== 'GET') return null;
  let url;try { url = new URL(request.url); } catch { return null; }
  if (!isResourcePath(url.pathname)) return null;
  const missing = () => new Response('必须导入完整资源包；QQ 群 1074985123', { status: 412,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!caches) return missing();
  try {
    const cache = await caches.open(CACHE_NAME);
    const receipt = await cache.match(absoluteUrl(RECEIPT_PATH, url.origin));
    const doc = await receipt?.json();
    if (doc?.source !== 'local-file' || !Object.prototype.hasOwnProperty.call({"02a466edd43d":13079,"223156dea277":13886,"f3216bd82a48":13889}, doc.manifest) || {"02a466edd43d":13079,"223156dea277":13886,"f3216bd82a48":13889}[doc.manifest] !== doc.count) return missing();
    const candidates = mediaCandidates(url.pathname);
    url.search = '';const directKeys = candidates.length ? candidates.map(p => new URL(p, url).href) : [url.href];
    // encodeURI (board art loader) escapes brackets; URL (pack importer) preserves them.
    // Try both spellings of the same filename, using only the verified local cache.
    const keys = [...new Set(directKeys.flatMap(key => [key, key.replace(/%5B/gi, '[').replace(/%5D/gi, ']')]))];
    for (const key of keys) {
      const hit = await cache.match(key);
      if (!hit || hit.headers.get('X-SP-Resource') !== '1') continue;
      const range = request.headers.get('Range');return range ? await rangeResponse(hit, range) : hit;
    }
    return missing();
  } catch { return missing(); }
}
