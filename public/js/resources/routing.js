// Download transport only. Cache keys stay on the game origin, so choosing a mirror never invalidates a preload.
// Only Hong Kong's resource traffic is shared; Hong Kong 2 players download locally. No rooms, data or API traffic moves.
import { isResourceUrl, MAX_FILE_BYTES } from './common.js';

const HONGKONG = 'https://sp.isomer319.xyz';
const HONGKONG2 = 'https://8.218.227.79';

export function mirrorUrl(url, policy, origin) {
  if (origin !== HONGKONG || !policy?.enabled || policy.origin !== HONGKONG2) return null;
  let u;
  try { u = new URL(typeof url === 'string' ? url : url.url, origin); } catch { return null; }
  if (u.origin !== origin || !isResourceUrl(u.pathname)) return null;
  let hash = 2166136261;
  for (const char of u.pathname) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const share = Math.max(0, Math.min(.5, Number(policy.share) || 0));
  if (hash % 10000 >= share * 10000) return null;
  return HONGKONG2 + u.pathname + u.search;
}

export function createResourceRouter({ origin = globalThis.location?.origin, fetcher = (...args) => globalThis.fetch(...args),
  now = () => Date.now(), policyTimeoutMs = 2500, mirrorTimeoutMs = 12000, cooldownMs = 30000 } = {}) {
  let policyPromise, policyAt = 0, failedUntil = 0;
  const policy = async () => {
    if (origin !== HONGKONG) return null;
    if (!policyPromise || now() - policyAt > 60000) {
      policyAt = now();
      policyPromise = (async () => {
        const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), policyTimeoutMs);
        try {
          const response = await fetcher(origin + '/resource-routing.json', { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
          const doc = response.ok ? await response.json() : null;
          return doc?.format === 1 && doc?.origin === HONGKONG2 ? doc : null;
        } catch { return null; } finally { clearTimeout(timer); }
      })();
    }
    return policyPromise;
  };
  const fetch = async (input, init) => {
    const method = init?.method || input?.method || 'GET';
    if (method !== 'GET' || origin !== HONGKONG || failedUntil > now()) return fetcher(input, init);
    const doc = await policy(), target = mirrorUrl(input, doc, origin);
    if (!target) return fetcher(input, init);
    const source = new Request(input, init), ctrl = new AbortController();
    const onAbort = () => ctrl.abort(source.signal.reason);
    source.signal.addEventListener('abort', onAbort, { once: true });
    if (source.signal.aborted) onAbort();
    const timer = setTimeout(() => ctrl.abort(new DOMException('资源镜像下载超时', 'TimeoutError')), mirrorTimeoutMs);
    let reader;
    try {
      const headers = new Headers();
      for (const name of ['Range', 'Accept', 'If-None-Match', 'If-Modified-Since']) {
        if (source.headers.has(name)) headers.set(name, source.headers.get(name));
      }
      const response = await fetcher(target, { method: 'GET', headers, signal: ctrl.signal,
        mode: 'cors', credentials: 'omit', cache: source.cache, redirect: 'error' });
      if (!response.ok) throw new Error('资源镜像不可用');
      // Finish within the deadline before returning: a stream that stops halfway falls back to the original host.
      // A bounded body also prevents an erroneous mirror from exhausting a phone's memory.
      reader = response.body?.getReader();
      const parts = []; let bytes = 0;
      if (reader) for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_FILE_BYTES) throw new Error('资源镜像文件过大');
        parts.push(chunk.value);
      }
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      const buffer = new Uint8Array(bytes);let offset = 0;
      for (const part of parts) { buffer.set(part, offset); offset += part.byteLength; }
      const outHeaders = new Headers(response.headers);
      outHeaders.delete('Content-Encoding');outHeaders.set('Content-Length', String(bytes));
      // Synthetic responses work for both CORS fetches and same-origin no-cors CSS/image requests in the worker.
      return new Response(buffer, { status: response.status, statusText: response.statusText, headers: outHeaders });
    } catch (error) {
      // Cancellation must not wait on a broken upstream stream before trying the original host.
      reader?.cancel().catch(() => {});
      if (source.signal.aborted) throw source.signal.reason;
      failedUntil = now() + cooldownMs;
      return fetcher(input, init);
    } finally { clearTimeout(timer);source.signal.removeEventListener('abort', onAbort); }
  };
  return { fetch, policy };
}

let router;
export function fetchResource(input, init) { router ??= createResourceRouter();return router.fetch(input, init); }

export async function installResourceRouting() {
  if (globalThis.location?.origin !== HONGKONG || !globalThis.isSecureContext) return false;
  router ??= createResourceRouter();
  if (!(await router.policy())?.enabled) return false;
  const { activateResourceWorker } = await import('./worker.js');
  await activateResourceWorker();
  return true;
}
