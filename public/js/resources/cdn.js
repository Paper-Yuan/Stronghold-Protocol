// Verified, read-only resource mirror for the four-server 02a466 pack.
export const CDN_CONFIG_URL = new URL('../../data/cdn-resource-config.json', import.meta.url).href;
export const CDN_CONFIG_SHA256 = '37cb3dc82932c43f0857b8b0dbdc40ca906f9176bade9852a4ed1264b299c841';
export const CDN_VERSION = 'f3216bd82a48';
export const CDN_CACHE = 'stronghold-resources-v1-all';
let configPromise;
export async function digest(bytes, algorithm = 'SHA-256') {
  return [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function loadCdnConfig() {
  if (!configPromise) configPromise = (async () => {
    const response = await fetch(CDN_CONFIG_URL);
    if (!response.ok || response.type === 'opaque') throw new Error('资源 CDN 暂不可用，可导入 QQ 群资源包备用');
    const bytes = await response.arrayBuffer();
    if (await digest(bytes) !== CDN_CONFIG_SHA256) throw new Error('资源 CDN 配置校验失败');
    const config = JSON.parse(new TextDecoder().decode(bytes));
    if (config.version !== CDN_VERSION || config.base !== 'https://weishucdn.jiangjiangze.icu' || Object.keys(config.files || {}).length !== 13889)
      throw new Error('资源 CDN 版本不匹配');
    return config;
  })().catch(error => { configPromise = null; throw error; });
  return configPromise;
}
export async function cdnResource(path, { signal, fetcher = fetch } = {}) {
  const config = await loadCdnConfig();
  const row = config.files[path];
  if (!row) throw new Error('资源不在当前版本清单中');
  const [hash, size, key, sha256] = row;
  if (!key.startsWith('assets/') && !key.startsWith('fonts/')) throw new Error('资源路径无效');
  const url = config.base + '/' + key.split('/').map(encodeURIComponent).join('/') + '?v=' + sha256.slice(0, 16);
  const response = await fetcher(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!response.ok || response.type === 'opaque') throw new Error('素材下载失败，请重试或使用本地资源包');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== size || await digest(bytes) !== sha256) throw new Error('素材内容校验失败');
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');headers.delete('Content-Range');
  headers.set('Content-Length', String(size));headers.set('X-SP-Resource', '1');headers.set('X-SP-Resource-Hash', hash);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(bytes, { status: 200, headers });
}
export function waitCdnWorker(signal, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const workers = navigator.serviceWorker;
    let interval, timer;
    const ports = new Set();
    const clean = () => { clearInterval(interval);clearTimeout(timer);signal?.removeEventListener('abort', abort);for (const port of ports) port.close(); };
    const abort = () => { clean();reject(signal.reason || new DOMException('已暂停', 'AbortError')); };
    const ping = () => {
      if (!workers?.controller) return;
      const channel = new MessageChannel();ports.add(channel.port1);
      channel.port1.onmessage = event => {
        channel.port1.close();ports.delete(channel.port1);
        if (event.data?.version === CDN_VERSION && event.data?.ready) { clean();resolve(); }
      };
      workers.controller.postMessage({ t: 'sp.cdn.ready' }, [channel.port2]);
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { clean();reject(new Error('资源加载服务未就绪，请手动刷新后重试')); }, timeoutMs);
    interval = setInterval(ping, 1000);ping();if (signal?.aborted) abort();
  });
}
