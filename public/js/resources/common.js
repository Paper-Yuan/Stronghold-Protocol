// public/js/resources/common.js — shared pieces of the optional asset preload (docs/ASSETS.md「Preload」).
//
// No DOM and no Preact: the page (store.js / index.js), the Service Worker (service.js) and the Node tests all import
// this module. It owns the manifest shape, the URL/MIME rules and byte formatting — the same rules the server applies
// when it generates /data/resource-manifest.json (server/resources.js).

/** Cache Storage names this app owns. One cache holds every version: entries are replaced per file (by hash), so an
 * asset update re-downloads the changed files only (docs/ASSETS.md「Preload」). */
export const CACHE_PREFIX = 'stronghold-resources-v1-';
export const CACHE_NAME = CACHE_PREFIX + 'all';
/** Full local fusion package's original cache; migrate verified bytes instead of downloading them again. */
export const LEGACY_CACHE = 'stronghold-assets-v0.2.1';
/** The one synthetic entry of that cache: absolute URL → the hash of the bytes stored for it. */
export const INDEX_PATH = '/__sp-resource-index__';
/** A hash as the server writes it (hex digest, the `syn-` fallback, a `sha1-…` label). */
export const HASH_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** A *content* digest (12 hex of a SHA-1): the only hashes the store can verify against cached bytes. */
export const CONTENT_HASH_RE = /^[0-9a-f]{12}$/;
export const RESOURCES_FORMAT = 1;
/** Never store a single file bigger than this (mirrors server/resources.js). */
export const MAX_FILE_BYTES = 24 * 1024 * 1024;
/** Essential: fonts, UI, icons, avatars, audio — what a screen needs in its first second. */
export const TIER_ESSENTIAL = 1;
/** The rest: portraits, Spine models, local-client board art — big, fetched in the background. */
export const TIER_REST = 2;
export const MANIFEST_URL = '/data/resource-manifest.json';
export const SW_URL = '/resource-sw.js';

/** The extension-less audio route the game asks audio through (`shared/media.js`; a test keeps the two lists identical).
 * The manifest keeps the real `/assets/audio/….mp3` URLs — a plain static host (the CDN) cannot resolve `/media/…` — and
 * the worker maps a `/media/…` request back to the entry it stored (`mediaCandidates`). */
export const MEDIA_PREFIX = '/media/';
/** Extensions a `/media/…` request may resolve to, in the order the server tries them (`shared/media.js AUDIO_EXTS`). */
export const AUDIO_EXTS = Object.freeze(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav']);

/** Extension → MIME type (mirrors server/resources.js; used to validate URLs, responses carry their own type). */
export const RESOURCE_MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  atlas: 'text/plain; charset=utf-8',
  obj: 'text/plain; charset=utf-8',
  skel: 'application/octet-stream',
  bin: 'application/octet-stream',
});

/** MIME type of a resource URL, or null when the extension is not a resource type. */
export function resourceType(url) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(url || ''));
  return m ? RESOURCE_MIME[m[1].toLowerCase()] || null : null;
}

/** Whether a request path belongs to the trees the preload may answer from the cache: the asset/font trees and the
 * extension-less audio route (answered from the stored `/assets/audio/…` entry — `mediaCandidates`). */
export function isResourcePath(pathname) {
  const p = String(pathname || '');
  // Vite calls its output directory "assets" too; bundles use HTTP caching and must bypass this worker entirely.
  if (p.startsWith('/build/')) return false;
  return /\/(?:assets|fonts)\//.test(p) || p.startsWith(MEDIA_PREFIX);
}

/**
 * The canonical files a `/media/…` request may resolve to, as site paths: `/media/bgm/act1` → `/assets/audio/bgm/act1.mp3`
 * (then `.m4a`, …), and `/media/bgm/act1.ogg` → only that one. Mirrors `serveMedia()` in server/index.js, which refuses
 * dot segments and dot-leading or dot-trailing names, so those yield nothing here either.
 * @param {string} pathname
 * @returns {string[]} empty when the path is not that route
 */
export function mediaCandidates(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith(MEDIA_PREFIX)) return [];
  const rest = p.slice(MEDIA_PREFIX.length);
  if (!rest || rest.endsWith('/')) return [];
  const segments = rest.split('/').filter((s) => s.length > 0);
  if (!segments.length || segments.some((s) => s === '.' || s === '..' || s.startsWith('.') || s.endsWith('.'))) return [];
  const last = segments[segments.length - 1];
  const given = AUDIO_EXTS.find((e) => last.toLowerCase().endsWith(e)) || '';
  const stem = given ? last.slice(0, -given.length) : last;
  if (!stem) return [];
  const name = [...segments.slice(0, -1), stem].join('/');
  const order = given ? [given, ...AUDIO_EXTS.filter((e) => e !== given)] : AUDIO_EXTS;
  return order.map((ext) => `/assets/audio/${name}${ext}`);
}

/** A file this client may request and cache: a site path or an absolute http(s) CDN URL with a known extension. */
export function isResourceUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false;
  if (/[\s?#\\"'<>\u0000-\u001f]/.test(url)) return false;
  let pathname = url;
  if (!url.startsWith('/') || url.startsWith('//')) {
    if (!/^https?:\/\//i.test(url)) return false;
    try { pathname = new URL(url).pathname; } catch { return false; }
  }
  // The manifest never carries `/media/…` URLs (the worker maps them to these instead): they name no file a static host
  // can serve, so an entry listing one is a manifest this client will not chase 4 000 times.
  if (pathname.startsWith(MEDIA_PREFIX)) return false;
  return isResourcePath(pathname) && !!resourceType(pathname);
}

/** A version-named cache of the pre-hash layout (`pruneOld()` cleans those up). The store itself uses CACHE_NAME. */
export function cacheName(version) {
  return CACHE_PREFIX + String(version || 'none');
}

/** Absolute URL of a manifest entry (the cache key): `/assets/x.png` → `https://site/assets/x.png`. */
export function absoluteUrl(url, origin = globalThis.location?.origin || 'http://localhost') {
  try { return new URL(String(url), origin).href; } catch { return null; }
}

/** Absolute URL of the preload index entry (`INDEX_PATH` lives in the same cache as the files it describes). */
export function indexUrl(origin = globalThis.location?.origin || 'http://localhost') {
  return absoluteUrl(INDEX_PATH, origin) || INDEX_PATH;
}

/** `1.5 GiB` / `820 KiB` / `900 B` — progress text (binary units, the ones browsers report storage in). */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Validate the manifest the server served. Throws on a shape this client cannot trust (it drives thousands of
 * requests and the cache), so a broken manifest disables the preload instead of hammering the origin.
 * @returns {any} the manifest
 */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || m.format !== RESOURCES_FORMAT) throw new Error('资源清单格式不受支持');
  if (typeof m.version !== 'string' || !m.version) throw new Error('资源清单缺少版本号');
  if (!Array.isArray(m.files)) throw new Error('资源清单缺少文件列表');
  if (m.files.length > 50000) throw new Error('资源清单过大');
  for (const f of m.files) {
    if (!f || typeof f !== 'object' || !isResourceUrl(f.url)) throw new Error(`资源清单条目无效：${String(f && f.url).slice(0, 80)}`);
    if (f.tier !== TIER_ESSENTIAL && f.tier !== TIER_REST) throw new Error(`资源清单条目缺少分层：${f.url.slice(0, 80)}`);
    if (f.size != null && (!Number.isSafeInteger(f.size) || f.size < 0)) throw new Error(`资源大小无效：${f.url.slice(0, 80)}`);
    // Optional: without a hash an entry keeps the old "a new manifest replaces the whole cache" rule.
    if (f.hash != null && (typeof f.hash !== 'string' || !HASH_RE.test(f.hash))) throw new Error(`资源指纹无效：${f.url.slice(0, 80)}`);
  }
  return m;
}

/** Whether an error means "the browser is out of storage" (a quota failure must stop the run, not retry 4 000 times). */
export function isQuotaError(err) {
  if (!err) return false;
  if (err.name === 'QuotaExceededError') return true;
  return /quota|disk|storage.*(?:full|exceed)/i.test(String(err.message || ''));
}

/** An AbortError for a caller-supplied reason (used to stop a run without a thrown DOMException). */
export function abortError(reason = 'aborted') {
  const err = new Error(reason);
  err.name = 'AbortError';
  return err;
}

/** Throw when the signal was aborted (fails fast between two files). */
export function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError(String(signal.reason ?? 'aborted'));
}

/**
 * Reply to a `Range` request from a cached full response (media elements probe/seek with byte ranges; a 200 answer is
 * accepted for plain playback but Safari refuses to seek without 206).
 * @param {Response} response full cached response
 * @param {string} range the request's Range header
 */
export async function rangeResponse(response, range) {
  const data = await response.arrayBuffer();
  const length = data.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || '').trim());
  let start;
  let end;
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, length - Number(m[2]));
    end = m[1] && m[2] ? Math.min(length - 1, Number(m[2])) : length - 1;
  }
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= length) {
    headers.set('Content-Range', `bytes */${length}`);
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(data.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}
