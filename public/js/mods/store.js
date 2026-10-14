// public/js/mods/store.js — WHERE a downloaded mod file is kept on the client (W-C).
//
// The point of this module is the SEAM, not the storage: a client mod cache has three real backends (OPFS, IndexedDB,
// memory) and the choice between them depends on a browser this code cannot test in. So the store is an interface —
// `has / read / write / remove / list / usage` — and every backend implements exactly that. Node tests inject the memory
// backend and exercise the whole download/verify path (public/js/mods/sync.js) without a DOM, and the OPFS / IndexedDB
// backends are only ever constructed when they are actually available.
//
// Nothing here touches `navigator`, `indexedDB` or `localStorage` at import time: every reference is inside a function,
// behind a `globalThis` check. `import ... from './store.js'` in plain Node must not throw, and it does not.
//
// Key layout (shared with the server's route, server/http/mods.js):
//
//     mods/<pack id>/<path inside the pack>        e.g. mods/alpha-pack/kits/chess_ws_x.js
//
// so `read('mods/alpha-pack/chess.json')` reads exactly the file the catalogue lists as `chess.json`.

/** The key prefix every mod file lives under. */
export const MOD_PREFIX = 'mods/';

/** The key of one catalogue file: `mods/<pack id>/<path>`. @param {string} packId @param {string} path */
export const modKey = (packId, path) => `${MOD_PREFIX}${packId}/${path}`;

/**
 * Whether `key` is a path this store accepts: a non-empty string, no `..`, no backslash, no absolute path. The same
 * rule the server applies to a pack file (server/modCatalog.js safeRelPath), applied to a key rather than a URL: a key
 * that escaped its own prefix would make `list('mods/a/')` and `remove` lie about what they touch.
 * @param {unknown} key
 * @returns {boolean}
 */
export function safeModKey(key) {
  if (typeof key !== 'string' || !key.length || key.length > 1024) return false;
  if (key.includes('\0') || key.includes('\\') || key.startsWith('/')) return false;
  return !key.split('/').some((seg) => seg === '' || seg === '..' || seg === '.');
}

/** A stored value as a byte view, whatever the backend handed back (ArrayBuffer, any TypedArray, Buffer, string). */
function asBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

/** The size of a value in bytes (for `usage`, which must not need the bytes themselves). */
function sizeOf(value) {
  return value == null ? 0 : asBytes(value).length;
}

// ---------------------------------------------------------------------------------------------------------------
// memory backend — the fallback, and what every Node test uses

/**
 * The in-memory backend: a Map, nothing else. It is the LAST fallback in `openStore()` (a browser with neither OPFS
 * nor IndexedDB, and any Node process), and the backend the tests inject, so the logic under test is the logic that
 * runs when a client really has nowhere to put a file.
 * @returns {{ name: string, has: (key: string) => Promise<boolean>, read: (key: string) => Promise<Uint8Array|null>,
 *   write: (key: string, bytes: any) => Promise<void>, remove: (key: string) => Promise<void>,
 *   list: (prefix?: string) => Promise<string[]>, usage: () => Promise<{ bytes: number, files: number }> }}
 */
export function createMemoryBackend() {
  /** @type {Map<string, Uint8Array>} */
  const map = new Map();
  return {
    name: 'memory',
    async has(key) { return map.has(key); },
    async read(key) { return map.has(key) ? map.get(key).slice() : null; },
    async write(key, bytes) { map.set(key, asBytes(bytes).slice()); },
    async remove(key) { map.delete(key); },
    async list(prefix = '') { return [...map.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async usage() {
      let bytes = 0;
      for (const v of map.values()) bytes += v.length;
      return { bytes, files: map.size };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// IndexedDB backend — the middle fallback

/** The database name/version. One store, `files`, keyed by the mod key. */
const IDB_NAME = 'sp-mods';
const IDB_VERSION = 1;
const IDB_STORE = 'files';

/**
 * The IndexedDB backend (used when OPFS is missing but IndexedDB is not — the common case on an older WebView).
 *
 * Values go in as the raw `ArrayBuffer` of the bytes, which is what IndexedDB can store structurally without a copy
 * step. `list` uses the store's own key order (`getAllKeys`), so it never walks anything.
 * @returns {any}
 */
export function createIndexedDbBackend() {
  /** @type {Promise<any>|null} */
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      });
    }
    return dbPromise;
  };
  /** Run one transaction and resolve with its request's result. */
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB request failed'));
    });
  };
  return {
    name: 'indexeddb',
    async has(key) { return (await run('readonly', (s) => s.getKey(key))) !== undefined; },
    async read(key) {
      const value = await run('readonly', (s) => s.get(key));
      return value == null ? null : asBytes(value).slice();
    },
    async write(key, bytes) {
      // store a standalone ArrayBuffer: a view into a larger buffer would persist the whole buffer
      const view = asBytes(bytes);
      const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      await run('readwrite', (s) => s.put(copy, key));
    },
    async remove(key) { await run('readwrite', (s) => s.delete(key)); },
    async list(prefix = '') { return (await run('readonly', (s) => s.getAllKeys())).map(String).filter((k) => k.startsWith(prefix)).sort(); },
    async usage() {
      const keys = await run('readonly', (s) => s.getAllKeys());
      let bytes = 0;
      for (const k of keys) bytes += sizeOf(await run('readonly', (s) => s.get(k)));
      return { bytes, files: keys.length };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// OPFS backend — the first choice

/**
 * The OPFS backend: the browser's own file system, which is the right place for a pack's assets (they are files, they
 * can be hundreds of MB, and a `Blob` from a file handle can be handed straight to an `<img>` / `<audio>` without a
 * copy through JS).
 *
 * Everything is resolved through `navigator.storage.getDirectory()`, so the store is per-origin and survives a reload.
 * `list` walks the tree — there is no key listing in OPFS — and returns the same slash-separated keys the other two
 * backends use, so a caller cannot tell which backend it is on.
 * @returns {any}
 */
export function createOpfsBackend() {
  const root = async () => {
    const storage = globalThis.navigator?.storage;
    if (!storage || typeof storage.getDirectory !== 'function') throw new Error('OPFS is not available');
    return storage.getDirectory();
  };
  /** Resolve a key to `{ dir, name }`, creating the intermediate directories. */
  const locate = async (key, create) => {
    const parts = key.split('/');
    const name = parts.pop();
    let dir = await root();
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, name };
  };
  return {
    name: 'opfs',
    async has(key) {
      try {
        const { dir, name } = await locate(key, false);
        await dir.getFileHandle(name);
        return true;
      } catch { return false; }
    },
    async read(key) {
      try {
        const { dir, name } = await locate(key, false);
        const file = await (await dir.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch { return null; }
    },
    async write(key, bytes) {
      const { dir, name } = await locate(key, true);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      // a fresh copy: some browsers reject writing a view whose buffer is shared
      await writable.write(asBytes(bytes).slice());
      await writable.close();
    },
    async remove(key) {
      const parts = key.split('/');
      const name = parts.pop();
      try {
        let dir = await root();
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
        await dir.removeEntry(name);
      } catch { /* the file (or its folder) is already gone: removing is idempotent */ }
    },
    async list(prefix = '') {
      /** @type {string[]} */
      const out = [];
      const walk = async (dir, at) => {
        // `for await` over a directory handle is the OPFS listing API; a backend without it just returns nothing
        if (typeof dir.entries !== 'function') return;
        for await (const [name, handle] of dir.entries()) {
          const key = `${at}${name}`;
          if (handle.kind === 'directory') await walk(handle, `${key}/`);
          else out.push(key);
        }
      };
      await walk(await root(), '');
      return out.filter((k) => k.startsWith(prefix)).sort();
    },
    async usage() {
      const keys = await this.list('');
      let bytes = 0;
      for (const k of keys) bytes += sizeOf(await this.read(k));
      return { bytes, files: keys.length };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// the store a caller actually uses

/**
 * Wrap a backend into the store API, so the checks live in ONE place instead of in every backend.
 * @param {any} backend
 */
export function createStore(backend) {
  /** @param {string} key */
  const check = (key) => {
    if (!safeModKey(key)) throw new Error(`unsafe mod key: ${JSON.stringify(key)}`);
  };
  return {
    /** Which backend this is (`opfs` / `indexeddb` / `memory`) — for a UI that wants to say where files go. */
    backend: backend.name,
    /** @param {string} key */
    async has(key) { check(key); return !!(await backend.has(key)); },
    /**
     * The bytes of `key`, or null when it is not stored.
     * @param {string} key
     * @returns {Promise<Uint8Array|null>}
     */
    async read(key) { check(key); return backend.read(key); },
    /** @param {string} key @param {any} bytes */
    async write(key, bytes) { check(key); return backend.write(key, bytes); },
    /** @param {string} key */
    async remove(key) { check(key); return backend.remove(key); },
    /**
     * The keys under `prefix` (default: everything), sorted.
     * @param {string} [prefix]
     * @returns {Promise<string[]>}
     */
    async list(prefix = '') { return backend.list(prefix); },
    /**
     * How much is stored: `{ bytes, files }` over the whole store.
     * @returns {Promise<{ bytes: number, files: number }>}
     */
    async usage() { return backend.usage(); },
  };
}

/** Whether OPFS is usable in this runtime (a function, never a top-level probe). */
export function hasOpfs() {
  try {
    return typeof globalThis.navigator?.storage?.getDirectory === 'function'
      && typeof globalThis.FileSystemFileHandle?.prototype?.createWritable === 'function';
  } catch { return false; }
}

/** Whether IndexedDB is usable in this runtime. */
export function hasIndexedDb() {
  try { return typeof globalThis.indexedDB?.open === 'function'; } catch { return false; }
}

/**
 * The store for this runtime: OPFS first, IndexedDB second, memory last — never throws.
 *
 * `prefer` pins one backend (a UI preference, or a test that wants a specific one). A backend that cannot even be
 * CONSTRUCTED falls through to the next, so a browser whose OPFS exists but is broken (a private window, a locked-down
 * WebView) still gets a working cache instead of an exception on boot.
 * @param {'opfs'|'indexeddb'|'memory'} [prefer]
 * @returns {ReturnType<typeof createStore>}
 */
export function openStore(prefer) {
  const order = prefer ? [prefer] : ['opfs', 'indexeddb', 'memory'];
  for (const name of order) {
    try {
      if (name === 'opfs' && hasOpfs()) return createStore(createOpfsBackend());
      if (name === 'indexeddb' && hasIndexedDb()) return createStore(createIndexedDbBackend());
      if (name === 'memory') return createStore(createMemoryBackend());
    } catch { /* try the next backend */ }
  }
  return createStore(createMemoryBackend());
}
