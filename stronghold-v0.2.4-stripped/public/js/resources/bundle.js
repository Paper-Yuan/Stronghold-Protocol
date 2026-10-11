import { CACHE_NAME, MAX_FILE_BYTES, RESOURCE_MIME, absoluteUrl, indexUrl, checkAbort } from './common.js';

export const RECEIPT_PATH = '/__sp-imported-resource-pack__';
const MAGIC = 'SPRES001';
const MAX_HEADER = 16 * 1024 * 1024;
const READ_AHEAD_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const hex = bits => [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
// FileReader also covers older mobile file providers without Blob.arrayBuffer().
const readBlob = blob => typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : new Promise((resolve, reject) => {
  const reader = new FileReader();reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('无法读取资源包，请先保存到系统下载文件夹'));
  reader.onabort = () => reject(new DOMException('读取已取消', 'AbortError'));reader.readAsArrayBuffer(blob);
});
export async function importedReceipt(manifest, { caches = globalThis.caches, origin = location.origin } = {}) {
  try {
    const cache = await caches.open(CACHE_NAME), response = await cache.match(absoluteUrl(RECEIPT_PATH, origin));
    const doc = await response?.json();
    return doc?.format === 1 && doc.source === 'local-file' && doc.manifest === manifest.version &&
      doc.count === manifest.files.length ? doc : null;
  } catch { return null; }
}

export async function importResourcePack(file, manifest, { caches = globalThis.caches, origin = location.origin,
  signal, onProgress = () => {} } = {}) {
  if (!file?.slice || !Number.isSafeInteger(file.size) || file.size < 12) throw new Error('请选择 QQ 群提供的 .spresources 完整资源包');
  const first = new Uint8Array(await readBlob(file.slice(0, 12)));
  if (new TextDecoder().decode(first.subarray(0, 8)) !== MAGIC) throw new Error('资源包格式不正确，请导入 QQ 群提供的文件，无需解压');
  const length = new DataView(first.buffer).getUint32(8, true);
  if (!length || length > MAX_HEADER || 12 + length > file.size) throw new Error('资源包头损坏');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(await readBlob(file.slice(12, 12 + length)))); } catch { throw new Error('资源包清单损坏'); }
  const bundled = header?.manifest;
  if (header?.format !== 'sp-resource-pack' || header.version !== 1 || bundled?.version !== manifest.version ||
      !Array.isArray(bundled.files) || bundled.files.length !== manifest.files.length)
    throw new Error('资源包版本不匹配，请到 QQ 群 1074985123 获取当前完整资源包');
  let total = 0;
  for (let i = 0; i < manifest.files.length; i++) {
    const wanted = manifest.files[i], supplied = bundled.files[i];
    if (supplied?.url !== wanted.url || supplied?.size !== wanted.size || supplied?.hash !== wanted.hash ||
        !Number.isSafeInteger(wanted.size) || wanted.size < 0 || wanted.size > MAX_FILE_BYTES || !/^[0-9a-f]{12}$/.test(wanted.hash))
      throw new Error('资源包清单与服务器不一致');
    total += wanted.size;
  }
  if (file.size !== 12 + length + total) throw new Error('资源包不完整，请重新从 QQ 群下载');
  checkAbort(signal);
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(absoluteUrl(RECEIPT_PATH, origin));
  const savedUrls = new Set((await cache.keys()).map(request => request.url));
  const hashes = {}, pending = new Set();let offset = 12 + length, bytes = 0, count = 0, lastReport = 0;
  let windowStart = 0, window = new Uint8Array(), pendingBytes = 0, writeError;
  const started = performance.now();
  const report = current => {
    if (performance.now() - lastReport > 120 || count === manifest.files.length) {
      lastReport = performance.now();onProgress({ count, bytes, current, speedBps: bytes / Math.max(.001, (lastReport - started) / 1000) });
    }
  };
  try {
    for (const f of manifest.files) {
      while (pending.size && (pending.size >= 3 || pendingBytes + f.size > MAX_PENDING_BYTES)) await Promise.race(pending);
      if (writeError) throw writeError;checkAbort(signal);
      const key = absoluteUrl(f.url, origin);
      if (savedUrls.has(key)) {
        const saved = await cache.match(key);
        if (saved?.headers.get('X-SP-Resource-Hash') === f.hash &&
            saved.headers.get('Content-Length') === String(f.size)) {
          const body = await saved.arrayBuffer();checkAbort(signal);
          if (body.byteLength === f.size && hex(await crypto.subtle.digest('SHA-1', body)).slice(0, 12) === f.hash) {
            hashes[key] = f.hash;offset += f.size;bytes += f.size;count++;report(f.url);continue;
          }
        }
      }
      if (offset < windowStart || offset + f.size > windowStart + window.byteLength) {
        windowStart = offset;
        window = new Uint8Array(await readBlob(file.slice(offset, Math.min(file.size, offset + Math.max(READ_AHEAD_BYTES, f.size)))));
      }
      const body = window.subarray(offset - windowStart, offset - windowStart + f.size);offset += f.size;
      const hash = hex(await crypto.subtle.digest('SHA-1', body)).slice(0, 12);
      if (hash !== f.hash) throw new Error(`资源包文件损坏：${f.url.split('/').pop()}，请重新下载完整包`);
      if (writeError) throw writeError;checkAbort(signal);
      const ext = f.url.split('.').pop().toLowerCase();
      const response = new Response(body, { headers: { 'Content-Type': RESOURCE_MIME[ext] || 'application/octet-stream',
        'Content-Length': String(f.size), 'Accept-Ranges': 'bytes', 'X-SP-Resource': '1', 'X-SP-Resource-Hash': f.hash } });
      pendingBytes += f.size;
      // Bound both concurrent writes and their bytes; never retain the whole mobile resource pack.
      const write = Promise.resolve().then(() => cache.put(key, response)).then(() => {
        hashes[key] = f.hash;bytes += f.size;count++;report(f.url);
      }).catch(err => { writeError ||= err; }).finally(() => { pending.delete(write);pendingBytes -= f.size; });
      pending.add(write);
    }
  } finally { await Promise.all([...pending]); }
  if (writeError) throw writeError;
  checkAbort(signal);
  await cache.put(indexUrl(origin), new Response(JSON.stringify({ version: 1, manifest: manifest.version, files: hashes }),
    { headers: { 'Content-Type': 'application/json' } }));
  await cache.put(absoluteUrl(RECEIPT_PATH, origin), new Response(JSON.stringify({ format: 1, source: 'local-file',
    manifest: manifest.version, count: manifest.files.length, importedAt: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  return { count: manifest.files.length, bytes };
}
