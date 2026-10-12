// public/js/resources/store.js — the preload store: downloads the manifest's files into Cache Storage and reports what
// is already there (docs/ASSETS.md「Preload」).
//
// One cache (`CACHE_NAME`) holds every asset, whatever manifest it came from, and each file's *hash* decides whether the
// stored bytes are still current: an asset update re-downloads the changed files only (~310 MiB → a few MiB), and a
// re-run of the extraction or a redeploy with unchanged art costs nothing. The hashes of the stored files live in one
// index entry inside that cache, written as the run advances — an interrupted run keeps the progress it flushed.
//
// The page does the downloading (a plain `fetch` per file, stored with `cache.put`), so a page without a Service Worker
// still builds the cache and only *serving it from the cache* needs one. Files are fetched with `cache: 'no-store'` on
// purpose: they are stored in Cache Storage, and letting the HTTP cache keep a second copy would double the disk the
// browser needs (~250 MiB of art). Everything is injected (`caches`, `fetcher`) so this module is unit-testable.

import {
  CACHE_NAME, CACHE_PREFIX, LEGACY_CACHE, CONTENT_HASH_RE, MAX_FILE_BYTES, TIER_ESSENTIAL, TIER_REST, absoluteUrl, indexUrl, checkAbort, isQuotaError,
} from './common.js';
import { resourceStep } from './async.js';
import { fetchResource } from './routing.js';


/** Files above this are downloaded one at a time (a 20 MiB Spine texture should not race three others). */
const BIG_FILE_BYTES = 4 << 20;
/** Failures kept for the UI (the count is always exact). */
const MAX_FAILURES = 10;
/** Successful files between two index writes (a flush is one put of a few KiB; 64 keeps an abort at ~1 % loss). */
const INDEX_FLUSH_EVERY = 64;

/**
 * The 12-hex SHA-1 of a response body — the same digest the server puts in the manifest (tools/asset-hashes.mjs,
 * tools/local-extract/extract.py). WebCrypto has no streaming digest, so one file is read at a time (Big files go
 * through the single big-file lane, so at most one of them is ever in memory).
 * @param {Response} response
 * @returns {Promise<string|null>} null when the browser cannot hash (no WebCrypto, an unreadable body)
 */
async function digestOf(response) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const bits = await subtle.digest('SHA-1', await response.clone().arrayBuffer());
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    return null;
  }
}

export class ResourceStore {
  /**
   * @param {{ files: { url: string, tier: number, size?: number, hash?: string }[], version: string, totalBytes?: number|null }} manifest
   * @param {{ caches?: any, fetcher?: typeof fetch, origin?: string, smallLanes?: number, bigLanes?: number,
   *           now?: () => number }} [opts]
   */
  constructor(manifest, { caches = globalThis.caches, fetcher = fetchResource, origin, smallLanes = 4, bigLanes = 1, now = () => Date.now(), pruneOnComplete = true, fileTimeoutMs = 60000, cacheTimeoutMs = 15000 } = {}) {
    this.manifest = manifest;
    this.files = Array.isArray(manifest.files) ? manifest.files : [];
    this.caches = caches;
    this.fetcher = fetcher;
    this.origin = origin || globalThis.location?.origin || 'http://localhost';
    this.smallLanes = Math.max(1, smallLanes);
    this.bigLanes = Math.max(1, bigLanes);
    this.now = now;
    this.pruneOnComplete = pruneOnComplete;
    this.fileTimeoutMs = fileTimeoutMs; this.cacheTimeoutMs = cacheTimeoutMs;
    this.cacheName = CACHE_NAME;
    /** @type {Promise<any> | null} */
    this.running = null;
  }

  /** Cache key (absolute URL) of a manifest entry. */
  keyOf(url) {
    return absoluteUrl(url, this.origin) || String(url);
  }

  /**
   * The hashes of what this cache holds: `<absolute url>` → hash. A missing or unreadable index means "nothing is
   * verified", i.e. every entry is fetched again — what the first run of this version and a cleared cache need.
   * @param {any} cache
   */
  async #readIndex(cache, signal) {
    let doc = null;
    const res = await cache.match(indexUrl(this.origin));
    checkAbort(signal);
    try {
      if (res) doc = await res.json();
    } catch (err) { if (!(err instanceof SyntaxError)) throw err; }
    checkAbort(signal);
    const files = doc && typeof doc === 'object' && doc.files && typeof doc.files === 'object' ? doc.files : null;
    return { manifest: typeof doc?.manifest === 'string' ? doc.manifest : '', files: files ? { ...files } : {} };
  }

  /** Write the index entry (the only synthetic entry of the cache; the worker never answers it: not /assets|/fonts). */
  async #writeIndex(cache, files, manifest) {
    const body = JSON.stringify({ version: 1, manifest: String(manifest || ''), files });
    await resourceStep(() => cache.put(indexUrl(this.origin), new Response(body, { headers: { 'Content-Type': 'application/json' } })),
      { timeoutMs: this.cacheTimeoutMs, label: '保存资源进度' });
  }

  /** A file this store will fetch: small enough to be worth caching (a huge one is skipped, never fails the run). */
  eligible(file) {
    return !(Number.isSafeInteger(file.size) && file.size > MAX_FILE_BYTES);
  }

  /** The response we store: original type, `Accept-Ranges` (the worker answers ranges) and our marker. */
  storable(response) {
    const headers = new Headers();
    const type = response.headers.get('content-type');
    if (type) headers.set('Content-Type', type);
    // A stored body must never claim a length it does not have: `fetch` hands us the DECODED body, so a compressed
    // transfer's Content-Length (372 for a 100 000-byte gzipped .skel) would describe the wrong bytes and the browser
    // would truncate it. Keep the header only when the response was not content-encoded — there it is exactly the
    // length we store (and DevTools' Cache Storage view can show a size instead of 0).
    if (!response.headers.get('content-encoding')) {
      const len = Number(response.headers.get('content-length'));
      if (Number.isSafeInteger(len) && len >= 0) headers.set('Content-Length', String(len));
    }
    headers.set('Accept-Ranges', 'bytes');
    headers.set('X-SP-Resource', '1');
    return new Response(response.body, { status: 200, statusText: 'OK', headers });
  }

  /**
   * What is already cached *and current*: `present` holds the absolute URLs whose stored bytes match the manifest's
   * hash, plus every counter the settings panel shows. An entry of another revision (or with no index record yet) does
   * not count, which is what makes the next run fetch it again.
   */
  status({ signal, onProgress } = {}) {
    const controller = new AbortController(), onAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return this.#status({ signal: controller.signal, onProgress }).catch(err => {
      controller.abort(err); // A failed probe stops its sibling lanes from starting any more work.
      throw err;
    }).finally(() => signal?.removeEventListener('abort', onAbort));
  }
  async #status({ signal, onProgress }) {
    const io = (task, label) => resourceStep(task, { signal, timeoutMs: this.cacheTimeoutMs, label });
    const cache = await io(() => this.caches.open(this.cacheName), '打开本机缓存');
    checkAbort(signal);
    const index = await io(s => this.#readIndex(cache, s), '读取资源进度');
    checkAbort(signal);
    const present = new Set(), counters = this.#tally(present);
    let checked = 0, lastReport = 0;
    const report = () => { lastReport = this.now();onProgress?.({ ...counters, checked, present, phase: 'scan', complete: false }); };
    report();
    // Never enumerate a whole 13k-entry cache in one uninterruptible keys() call. A matching index only
    // selects candidates: check the actual response still exists, without reading/hashing its body again.
    for (let start = 0; start < this.files.length; start += 128) {
      checkAbort(signal);
      const batch = this.files.slice(start, start + 128); let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, batch.length) }, async () => {
        for (let i = next++; i < batch.length; i = next++) {
          checkAbort(signal);
          const file = batch[i], key = this.keyOf(file.url);
          const indexed = !file.hash || index.files[key] === file.hash;
          const hit = indexed && await io(() => cache.match(key), '检查单个缓存文件');
          // Presence checks do not consume cached bodies. Release their stream handles immediately,
          // rather than retaining thousands of texture/audio streams until a browser GC happens.
          hit?.body?.cancel().catch(() => {});
          checkAbort(signal);
          if (hit) {
            present.add(key);
            if (file.tier === TIER_ESSENTIAL) counters.tier1Present++; else counters.tier2Present++;
            if (this.eligible(file)) {
              counters.count++;
              if (Number.isSafeInteger(file.size)) { counters.bytes += file.size; counters.sized++; }
            }
          }
          checked++;
          if (checked === Math.min(8, this.files.length) || this.now() - lastReport >= 120) report();
        }
      }));
      checkAbort(signal); report();
      // Yield the main thread so the progress bar, Close and profile controls stay responsive.
      if (start + 128 < this.files.length) await io(() => new Promise(resolve => setTimeout(resolve, 0)), '检查缓存');
    }
    checkAbort(signal);
    return { ...this.#tally(present), checked, present };
  }

  /** Caches of earlier builds this app wrote: their entries carry no hash record and are verified before being kept. */
  async #olderCaches() {
    const names = (await this.caches.keys()) || [];
    return names.filter((n) => (n.startsWith(CACHE_PREFIX) && n !== this.cacheName) || n === LEGACY_CACHE);
  }

  /** Fetch a file and hand back a storable response (an opaque or empty or failed answer throws). */
  async #fetchStorable(url, signal) {
    const res = await this.fetcher(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
    if (res.type === 'opaque' || !res.body) throw new Error('响应不可读取（缺少 CORS 头或空响应）');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  /**
   * Rescue a file from a cache of the previous layout instead of downloading it again: hash the stored bytes and, when
   * they are exactly the revision this manifest wants, move the entry into the current cache. A mismatching entry is
   * dropped (the caller downloads the right bytes next) so a stale copy can never shadow the fresh one.
   * @returns {Promise<boolean>} true when the file needed no network at all
   */
  async #adopt(file, cache, older, signal) {
    if (!older.length || !file.hash || !CONTENT_HASH_RE.test(file.hash)) return false; // nothing to compare against
    const key = this.keyOf(file.url);
    for (const name of older) {
      const other = await this.caches.open(name);
      const hit = await other.match(key);
      if (!hit) continue;
      if ((await digestOf(hit)) === file.hash) {
        checkAbort(signal);
        await cache.put(key, hit); // same bytes, now in the current cache…
        checkAbort(signal);
        await other.delete(key); // …and gone from the old one: never two copies, never a stale shadow
        return true;
      }
      // Preserve an unverified old entry; another legacy cache can still contain the current bytes.
    }
    return false;
  }

  /** Counters for a set of cached URLs (shared by status() and clear(), which must not re-create a cache). */
  #tally(present) {
    const total = this.files.length;
    let count = 0;
    let bytes = 0;
    let sized = 0;
    let skipped = 0;
    let tier1 = 0;
    let tier1Present = 0;
    let tier2 = 0;
    let tier2Present = 0;
    for (const f of this.files) {
      const hit = present.has(this.keyOf(f.url));
      if (f.tier === TIER_ESSENTIAL) { tier1++; if (hit) tier1Present++; } else { tier2++; if (hit) tier2Present++; }
      if (!this.eligible(f)) { skipped++; continue; }
      if (hit) {
        count++;
        if (Number.isSafeInteger(f.size)) { bytes += f.size; sized++; }
      }
    }
    const wanted = total - skipped;
    return {
      version: this.manifest.version,
      cacheName: this.cacheName,
      count,
      total,
      wanted,
      skipped,
      bytes,
      totalBytes: Number.isSafeInteger(this.manifest.totalBytes) ? this.manifest.totalBytes : null,
      sized,
      sizedTotal: Number.isSafeInteger(this.manifest.sized) ? this.manifest.sized : null,
      tier1,
      tier1Present,
      tier2,
      tier2Present,
      complete: wanted > 0 && count >= wanted,
    };
  }

  /**
   * Download every missing file (essential tier first). Aborting the signal stops within one file; single file failures
   * are collected instead, so one broken file cannot waste a whole run.
   * @param {{ signal?: AbortSignal, onProgress?: (p: any) => void, tiers?: number[] }} [opts]
   */
  download({ signal, onProgress, onScan, tiers = [TIER_ESSENTIAL, TIER_REST] } = {}) {
    return Promise.reject(new Error('必须导入完整资源包；QQ 群 1074985123'));
  }

  // Kept for legacy pack tooling; players use local import or the approved CDN.
  // eslint-disable-next-line no-unused-private-class-members
  async #download({ signal, onProgress, onScan, tiers }) {
    const wanted = new Set(tiers);
    const io = (task, label) => resourceStep(task, { signal, timeoutMs: this.cacheTimeoutMs, label });
    const cache = await io(() => this.caches.open(this.cacheName), '打开本机缓存');
    const index = await io(() => this.#readIndex(cache), '读取资源进度');
    const start = await this.status({ signal, onProgress: onScan });
    checkAbort(signal);
    const work = this.files.filter((f) => wanted.has(f.tier) && this.eligible(f) && !start.present.has(this.keyOf(f.url)));
    let done = start.count;
    let bytes = start.bytes;
    let sized = start.sized;
    let failed = 0;
    let tier1Done = start.tier1Present;
    let tier2Done = start.tier2Present;
    let pendingFlush = 0;
    // Migration and network traffic are reported separately: the panel says "整理已保存的资源" while nothing is fetched.
    let adopted = 0;
    let downloaded = 0;
    /** @type {{ url: string, message: string }[]} */
    const failures = [];
    let lastEmit = 0;
    // Exactly the counters of status(): the UI maps one shape for both, so a field can never be missing mid-run.
    const progress = (current = null) => ({
      phase: 'download', count: done, total: start.total, wanted: start.wanted, skipped: start.skipped,
      bytes, totalBytes: start.totalBytes, sized, sizedTotal: start.sizedTotal,
      tier1: start.tier1, tier1Present: tier1Done, tier2: start.tier2, tier2Present: tier2Done,
      complete: false, failed, failures: failures.slice(), current, adopted, downloaded,
    });
    const emit = (current = null, force = false) => {
      if (!onProgress) return;
      const t = this.now();
      if (!force && t - lastEmit < 120) return;
      lastEmit = t;
      onProgress(progress(current));
    };
    emit(null, true);
    if (work.length) {
      // the manifest is sorted essential-first, so a plain order keeps tier 1 ahead of tier 2
      const small = [];
      const big = [];
      for (const f of work) (Number.isSafeInteger(f.size) && f.size > BIG_FILE_BYTES ? big : small).push(f);
      // Caches of the pre-hash layout: their entries are verified (and moved) before anything is fetched.
      const older = await io(() => this.#olderCaches(), '读取已有预载缓存');
      const one = async (file) => {
        checkAbort(signal);
        const key = this.keyOf(file.url);
        try {
          emit(file.url);
          const reused = await resourceStep(async fileSignal => {
            if (await this.#adopt(file, cache, older, fileSignal)) return true;
            let res = await this.#fetchStorable(key, fileSignal);
            // `cache: 'no-store'` bypasses the HTTP cache, not Cache Storage: a Service Worker of an older build may
            // answer this fetch out of its own cache (and a stale one at that). Verify the bytes against the manifest
            // hash and, when they disagree, ask again on a URL no cache entry can match — the worker matches full URLs.
            // A second mismatch remains a failed file: unverified bytes must never satisfy the entry gate.
            if (file.hash && CONTENT_HASH_RE.test(file.hash)) {
              const seen = await digestOf(res);
              if (seen && seen !== file.hash) {
                res = await this.#fetchStorable(`${key}${key.includes('?') ? '&' : '?'}sp=${file.hash}`, fileSignal);
                if ((await digestOf(res)) !== file.hash) throw new Error('资源校验不一致，请重试');
              }
              if (!seen) throw new Error('浏览器无法校验资源，请重试');
            }
            // Consume even synthetic-hash bodies within the deadline; headers alone are not a finished download.
            const bytes = await res.arrayBuffer(); checkAbort(fileSignal);
            await cache.put(key, this.storable(new Response(bytes, { headers: res.headers })));
            checkAbort(fileSignal);
            return false;
          }, { signal, timeoutMs: this.fileTimeoutMs, label: `资源 ${file.url.split('/').pop()} 下载或校验` });
          checkAbort(signal);
          if (reused) adopted++; else downloaded++;
          // The file is current only once the index says so: a run stopped before its next flush re-fetches this one.
          if (file.hash) {
            index.files[key] = file.hash;
            if (++pendingFlush >= INDEX_FLUSH_EVERY) { pendingFlush = 0; await this.#writeIndex(cache, index.files, this.manifest.version); }
          }
          done++;
          if (file.tier === TIER_ESSENTIAL) tier1Done++; else tier2Done++;
          if (Number.isSafeInteger(file.size)) { bytes += file.size; sized++; }
        } catch (err) {
          checkAbort(signal); // an abort wins over a per-file error: the run is being stopped
          if (isQuotaError(err)) {
            const quota = new Error('quota exceeded');
            quota.name = 'QuotaExceededError';
            quota.cause = err;
            throw quota;
          }
          failed++;
          if (failures.length < MAX_FAILURES) failures.push({ url: file.url, message: String(err?.message || err) });
        }
        emit(file.url);
      };
      const drain = async (list, lanes) => {
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(lanes, list.length) }, async () => {
          for (let i = next++; i < list.length; i = next++) await one(list[i]);
        }));
      };
      try {
        await drain(small, this.smallLanes);
        await drain(big, this.bigLanes);
        checkAbort(signal);
      } finally {
        // Flush on every exit — an abort or a quota failure included: the files stored so far must count as current
        // next time. A failing write only costs re-downloading them.
        try { await this.#writeIndex(cache, index.files, this.manifest.version); emit(null, true); } catch { /* out of storage: the run is already failing */ }
      }
    } else {
      checkAbort(signal);
    }
    const after = await this.status({ signal });
    const result = { ...after, phase: 'ready', failed, failures: failures.slice(), adopted, downloaded };
    onProgress?.(result);
    // Only a complete set may drop anything: a partial run never deletes files it did not replace.
    if (result.complete && this.pruneOnComplete) await io(() => this.prune(false), '整理资源缓存');
    return result;
  }
  /** Delete every cache this app owns, of every version — 「清理缓存」 in the settings panel. Never re-creates one. */
  async clear() {
    if (this.caches?.keys) {
      const names = await this.caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) || n === LEGACY_CACHE).map((n) => this.caches.delete(n)));
    }
    return { ...this.#tally(new Set()), present: new Set() };
  }

  /** Drop the caches of other versions (a new asset manifest frees the files of the previous one). */
  async pruneOld() {
    const names = (await this.caches.keys()) || [];
    const stale = names.filter((n) => (n.startsWith(CACHE_PREFIX) && n !== this.cacheName) || n === LEGACY_CACHE);
    await Promise.all(stale.map((n) => this.caches.delete(n)));
    return stale;
  }

  /**
   * Delete cached entries that the manifest no longer lists (a file that was renamed or dropped would otherwise sit in
   * the cache forever, and its index record with it). Older caches are only cleaned up once they held no serviceable
   * entry at all — i.e. after the migration of this run moved or dropped what it could.
   */
  async pruneStale() {
    const cache = await this.caches.open(this.cacheName);
    const wanted = new Set(this.files.map((f) => this.keyOf(f.url)));
    const indexKey = indexUrl(this.origin);
    const keys = await cache.keys();
    const doomed = keys.filter((k) => k.url !== indexKey && !wanted.has(k.url));
    if (!doomed.length) return 0;
    await Promise.all(doomed.map((k) => cache.delete(k)));
    const index = await this.#readIndex(cache);
    for (const k of doomed) delete index.files[k.url];
    await this.#writeIndex(cache, index.files, this.manifest.version);
    return doomed.length;
  }

  /**
   * Housekeeping after a complete run: other caches (the version-named layout of earlier builds) and the entries this
   * manifest dropped. `includeStale: false` is used from a download, where the cache was just brought up to date.
   */
  async prune(includeStale = true) {
    const caches = await this.pruneOld();
    const files = includeStale ? await this.pruneStale() : 0;
    return { caches, files };
  }
}
