// public/js/mods/sync.js — decide what is missing locally, download it, and PROVE it (W-C).
//
// The client does not need a whole mod to "run" it: the merged game data and the kit modules come from the server per
// room. What it must have LOCALLY is the bulk — a pack's assets and its kit files — plus the pack's own JSON, because
// holding those bytes is the only thing that proves "I really have this mod" (that is what localPackHash() is for).
//
// Three rules shape this module:
//
//   * ONE hash algorithm. The pack hash is rebuilt with `modManifestDigest` from shared/modIdentity.js — the module the
//     SERVER also uses — over the per-file contributions the catalogue carries (server/modCatalog.js). A second
//     implementation here would agree until the day it did not, and then a client would reject a pack it fully holds.
//   * NOTHING browser-specific at import time. `crypto.subtle` is preferred when it exists and the pure-JS sha256 in
//     shared/modIdentity.js is the fallback, so the same code runs in a browser and in a Node test.
//   * A FAILED FILE IS NEVER WRITTEN. Bytes are hashed BEFORE they are stored, so a corrupted download cannot end up in
//     the cache pretending to be the file — the pack is simply reported as incomplete.

import { modDigest, modManifestDigest, sha256Hex } from '../../../shared/modIdentity.js';
import { MOD_PREFIX, modKey } from './store.js';

/** The catalogue URL (server/http/mods.js MODS_CATALOG_URL — the same string, so a typo cannot desync the two). */
export const CATALOG_URL = '/mods/catalog.json';
/** How many files are downloaded at once. Small on purpose: a phone on mobile data must not open 60 sockets. */
export const DEFAULT_CONCURRENCY = 4;
/** How many times ONE file is attempted in total (1 try + 2 retries). */
export const DEFAULT_RETRIES = 2;
/** Give up on one file after this long, so a stalled socket cannot hang the whole sync. */
export const FILE_TIMEOUT_MS = 30000;

const defaultFetch = (...args) => globalThis.fetch(...args);

/**
 * The bytes of `value`, whatever a store handed back.
 * @param {any} value
 * @returns {Uint8Array}
 */
function asBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

/**
 * sha256 of some bytes, lowercase hex.
 *
 * `crypto.subtle.digest` when the runtime has it (a browser: native, fast, and it does not block the main thread for a
 * multi-MB asset). Otherwise the pure-JS sha256 the browser ALSO uses to check a mod digest — so this is one algorithm
 * with two engines, not two algorithms.
 * @param {any} bytes
 * @returns {Promise<string>}
 */
export async function hashBytes(bytes) {
  const view = asBytes(bytes);
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const digest = await subtle.digest('SHA-256', view);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through to the pure implementation */ }
  }
  return sha256Hex(view);
}

/**
 * The URL of one catalogue file: `/mods/file/<pack>/<path>`, each segment percent-encoded.
 *
 * Per segment, not on the whole path — a pack file may live in a subdirectory, and encoding the separators would turn
 * one path into one very strange file name.
 * @param {string} packId
 * @param {string} path
 * @param {string} [prefix]
 * @returns {string}
 */
export function fileUrl(packId, path, prefix = '/mods/file/') {
  return prefix + [packId, ...String(path).split('/')].map(encodeURIComponent).join('/');
}

/**
 * The bytes of one catalogue file from the server.
 * @param {string} url
 * @param {typeof fetch} doFetch
 * @param {number} timeoutMs
 * @returns {Promise<Uint8Array>}
 */
async function fetchBytes(url, doFetch, timeoutMs) {
  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res || res.ok === false) throw new Error(`HTTP ${res ? res.status : '???'} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The files the catalogue lists for one pack, flattened to `{ packId, path, ...file }`. */
function filesOfPack(pack, packId) {
  return (Array.isArray(pack?.files) ? pack.files : [])
    .filter((f) => f && typeof f.path === 'string')
    .map((f) => ({ ...f, packId }));
}

/**
 * What is not in the store yet, as `{ packId, path, bytes, sha256, canonical }` entries.
 *
 * EXISTENCE only: a key that is present counts as present. Verifying a file costs a hash of its bytes, and `sync` does
 * that anyway (it must, to decide whether a download is needed) — doing it twice would make every check read the whole
 * cache. A file whose bytes are WRONG is therefore not "missing" here; it is a file `sync` re-fetches (see sync()).
 *
 * `packIds` is the room's declared set — the one thing this module is driven by: pass the packs the room runs and only
 * those are considered. `null`/`undefined` means "every pack in the catalogue". A pack id the catalogue does not have is
 * skipped (the room names a pack this server does not carry; that is a server-side problem, not a download).
 * @param {{ packs: Array<any> }|null|undefined} catalog `GET /mods/catalog.json`
 * @param {Iterable<string>|null|undefined} packIds
 * @param {ReturnType<import('./store.js').createStore>} store
 * @returns {Promise<Array<{ packId: string, path: string, bytes?: number, sha256: string, canonical?: string }>>}
 */
export async function missing(catalog, packIds, store) {
  const wanted = packIds == null ? null : new Set(packIds);
  /** @type {Array<{ packId: string, path: string, bytes?: number, sha256: string, canonical?: string }>} */
  const out = [];
  for (const pack of Array.isArray(catalog?.packs) ? catalog.packs : []) {
    if (!pack || typeof pack.id !== 'string') continue;
    if (wanted && !wanted.has(pack.id)) continue;
    for (const file of filesOfPack(pack, pack.id)) {
      if (typeof file.sha256 !== 'string') continue; // nothing to verify against: not a file this layer can cache
      if (!(await store.has(modKey(pack.id, file.path)))) out.push(file);
    }
  }
  return out;
}

/**
 * Download and verify the files a room needs.
 *
 * `packIds` (the room's set) decides what is fetched — the catalogue may carry ten packs while the room runs one, and a
 * client must not pull the other nine. A file already stored AND already matching its `sha256` is skipped without a
 * request; a file that is stored but does NOT match is re-fetched (a half-written or corrupted cache entry must heal
 * itself, not be reported as "present").
 *
 * Progress is reported through `onProgress(event)`, one plain object per step (see the report's「W-D 需要的接口」for the
 * shapes): `catalog`, then per pack `pack`, then `file-start` / `file-verified` / `file-done` / `file-skipped` /
 * `file-error`, then `done`. A listener that throws is ignored — progress must never break the download.
 *
 * Returns per pack `{ packId, files, ok, failed: [{ path, reason }] }`. `ok` is the whole answer to "may I mark this pack
 * complete": every file of the pack is stored AND hashed to its catalogue value. A pack whose `hash` disagrees with the
 * hash rebuilt from the stored bytes is NOT ok, whatever the individual files said.
 * @param {{ catalog?: { packs: Array<any> }|null, packIds?: Iterable<string>|null, store: any,
 *   fetch?: typeof fetch, onProgress?: ((event: any) => void)|null, concurrency?: number, retries?: number,
 *   fileTimeoutMs?: number, signal?: AbortSignal|null, urlPrefix?: string }} opts
 * @returns {Promise<{ ok: boolean, packs: Array<{ packId: string, files: number, ok: boolean,
 *   failed: Array<{ path: string, reason: string }> }>, downloaded: number, skipped: number, failed: number }>}
 */
export async function sync({
  catalog = null, packIds = null, store, fetch: doFetch = defaultFetch, onProgress = null,
  concurrency = DEFAULT_CONCURRENCY, retries = DEFAULT_RETRIES, fileTimeoutMs = FILE_TIMEOUT_MS, signal = null,
  urlPrefix = '/mods/file/',
}) {
  const wanted = packIds == null ? null : new Set(packIds);
  const packs = (Array.isArray(catalog?.packs) ? catalog.packs : [])
    .filter((p) => p && typeof p.id === 'string' && (!wanted || wanted.has(p.id)));
  const emit = (event) => { try { onProgress?.(event); } catch { /* a progress listener must not break the sync */ } };

  /** @type {Array<{ packId: string, files: number, ok: boolean, failed: Array<{ path: string, reason: string }> }>} */
  const results = [];
  let downloaded = 0;
  let skipped = 0;
  let failedCount = 0;
  const total = packs.reduce((n, p) => n + (Array.isArray(p.files) ? p.files.length : 0), 0);
  let done = 0;
  let packIndex = 0;
  emit({ type: 'catalog', packs: packs.map((p) => p.id), total });

  for (const pack of packs) {
    packIndex += 1;
    const files = filesOfPack(pack, pack.id);
    emit({ type: 'pack', packId: pack.id, index: packIndex, packs: packs.length, files: files.length });
    /** @type {Array<{ path: string, reason: string }>} */
    const failed = [];
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (signal?.aborted) return;
        const file = files[cursor++];
        if (!file) return;
        const key = modKey(pack.id, file.path);
        emit({ type: 'file-start', packId: pack.id, path: file.path, done, total });
        let ok = false;
        let reason = '';
        for (let attempt = 0; attempt <= retries && !ok; attempt++) {
          if (signal?.aborted) { reason = 'aborted'; break; }
          try {
            // already stored and already correct → no request at all
            if (await store.has(key)) {
              const stored = asBytes(await store.read(key));
              if (await hashBytes(stored) === file.sha256) {
                ok = true;
                skipped += 1;
                emit({ type: 'file-skipped', packId: pack.id, path: file.path, bytes: stored.length, done, total });
                break;
              }
            }
            const bytes = await fetchBytes(fileUrl(pack.id, file.path, urlPrefix), doFetch, fileTimeoutMs);
            const digest = await hashBytes(bytes);
            if (digest !== file.sha256) throw new Error(`sha256 mismatch: got ${digest.slice(0, 12)}… want ${file.sha256.slice(0, 12)}…`);
            await store.write(key, bytes); // only verified bytes ever reach the store
            ok = true;
            downloaded += 1;
            emit({ type: 'file-done', packId: pack.id, path: file.path, bytes: bytes.length, attempt, done, total });
          } catch (err) {
            reason = String(err?.message || err);
            if (attempt < retries) emit({ type: 'file-retry', packId: pack.id, path: file.path, attempt: attempt + 1, reason });
          }
        }
        if (!ok) {
          failed.push({ path: file.path, reason });
          failedCount += 1;
          emit({ type: 'file-error', packId: pack.id, path: file.path, reason, done, total });
        }
        done += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
    // the pack's own verdict: every file present, AND the pack hash rebuilt from the STORED bytes equal to the
    // catalogue's `hash`. The second half is what catches "the server changed a pack under us" and "the catalogue's
    // per-file contributions do not add up to the hash it claims".
    const rebuilt = await localPackHash(pack.id, store, catalog);
    const ok = failed.length === 0 && rebuilt !== null && rebuilt === pack.hash;
    if (!ok && failed.length === 0) failed.push({ path: '*', reason: `pack hash ${rebuilt === null ? '(incomplete)' : rebuilt} does not match the catalogue's ${pack.hash}` });
    results.push({ packId: pack.id, files: files.length, ok, failed });
    emit({ type: 'pack-done', packId: pack.id, ok, failed: failed.length, done, total });
  }

  const summary = { ok: results.every((r) => r.ok), packs: results, downloaded, skipped, failed: failedCount };
  emit({ type: 'done', ...summary, done, total });
  return summary;
}

/**
 * The content hash of one pack, rebuilt from the bytes the client HOLDS — with the server's own algorithm.
 *
 * This is the "prove I really have this mod" primitive. The server computed a pack's `hash` as
 * `modManifestDigest([{ path, hash }])`, where each `hash` is the file's contribution (for `pack.json` and the declared
 * content files: sha256 of the NORMALIZED records; for `kits/*.js` and `assets/**`: sha256 of the bytes). The catalogue
 * carries both halves of that (`sha256` for the bytes, `canonical` for the contribution), so a client rebuilds the same
 * number WITHOUT re-implementing the loader's normalization:
 *
 *     modManifestDigest(files.map((f) => ({ path: f.path, hash: f.canonical })))
 *
 * Every file is read from the store first: a pack with a missing file has no hash at all (`null`), which is the honest
 * answer — a partial pack is not a version of that pack.
 * @param {string} packId
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {{ packs: Array<any> }|null} [catalog] the catalogue entry to read `canonical` from
 * @param {{ verifyBytes?: boolean }} [opts] `verifyBytes` also hashes every stored file and refuses a pack whose bytes
 *   do not match the catalogue's `sha256` — what the ALIGNMENT gate wants (「我真的有这个 mod」must not be a claim about
 *   file names; a corrupted cache entry would otherwise read as complete). Off by default: `sync` has already hashed
 *   everything it downloaded, so its own verdict needs existence only.
 * @returns {Promise<string|null>} lowercase hex, or null when the pack is incomplete / unknown here
 */
export async function localPackHash(packId, store, catalog = null, { verifyBytes = false } = {}) {
  const pack = (Array.isArray(catalog?.packs) ? catalog.packs : []).find((p) => p && p.id === packId);
  if (!pack) return null;
  /** @type {Array<{ path: string, hash: string }>} */
  const pairs = [];
  for (const file of filesOfPack(pack, packId)) {
    if (typeof file.canonical !== 'string') return null; // cannot rebuild the pack hash without the contribution
    const stored = await store.read(modKey(packId, file.path));
    if (stored == null) return null; // a missing file means an incomplete pack, not a different one
    if (verifyBytes && (typeof file.sha256 !== 'string' || await hashBytes(stored) !== file.sha256)) return null;
    pairs.push({ path: file.path, hash: file.canonical });
  }
  return modManifestDigest(pairs);
}

/**
 * The digest of a whole set of locally-held packs — the number a room handshake compares against the server's.
 *
 * `modDigest` (shared/modIdentity.js) is the server's own function over `[id, hash]` pairs; this only supplies the pairs
 * from LOCAL bytes, each `hash` rebuilt by `localPackHash`. `null` when any pack of the set is incomplete, so "I have
 * some of it" can never be mistaken for "I have it".
 * @param {Array<{ id: string, hash: string }>} entries the room's set (id + the hash the server declares)
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {{ packs: Array<any> }|null} [catalog]
 * @returns {Promise<{ digest: string, packs: Array<{ id: string, hash: string }> }|null>}
 */
export async function localSetDigest(entries, store, catalog = null) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;
  /** @type {Array<{ id: string, hash: string }>} */
  const verified = [];
  for (const entry of list) {
    if (!entry || typeof entry.id !== 'string') return null;
    const hash = await localPackHash(entry.id, store, catalog);
    if (hash === null) return null;
    verified.push({ id: entry.id, hash });
  }
  const sorted = [...verified].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { digest: modDigest(sorted), packs: sorted };
}

/** Where the local cache lives, for a UI that wants to show or clear it. Re-exported so callers need one import. */
export { MOD_PREFIX };
