import { SW_URL, checkAbort } from './common.js';

/** Register the worker and wait for control in the background; verified entry never waits on this promise. */
export async function activateResourceWorker(signal, nav = globalThis.navigator, timeoutMs = 15000) {
  checkAbort(signal);
  const workers = nav?.serviceWorker;
  if (!workers) throw new Error('当前浏览器不支持离线预载，请使用支持 Service Worker 的浏览器');
  let timer, onChange, onAbort, settled = false;
  try {
    await new Promise((resolve, reject) => {
      onAbort = () => reject(signal?.reason || new DOMException('预载已暂停', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new Error('离线缓存服务启动超时，请重试或刷新页面')), timeoutMs);
      Promise.resolve().then(() => workers.register(SW_URL, { type: 'classic', scope: '/', updateViaCache: 'none' }))
        .then(() => {
          if (settled) return; // A late registration must not install listeners after timeout/pause.
          checkAbort(signal);
          onChange = () => { if (workers.controller?.scriptURL?.endsWith(SW_URL)) resolve(); };
          workers.addEventListener('controllerchange', onChange);
          onChange();
        }).catch(reject);
      if (signal?.aborted) onAbort();
    });
  } finally {
    settled = true;
    clearTimeout(timer);
    if (onChange) workers.removeEventListener('controllerchange', onChange);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
