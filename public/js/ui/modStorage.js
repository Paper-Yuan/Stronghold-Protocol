// public/js/ui/modStorage.js — Client-Side Unified Mod Storage Engine.
// v2 (CF_MOD_TRI_PLAN.md §2-D1-2): IndexedDB stores ONLY whole zip Blobs + meta.
// Sections are unpacked in memory on demand (unpackModZip), never persisted.
// Freshness is judged solely by the per-pack sha256 from the mod catalog.

const DB_NAME = 'sp_mod_storage';
const DB_VERSION = 2;
const STORE_META = 'meta';
const STORE_BLOBS = 'blobs';

class ModStorageService {
  constructor() {
    this.dbPromise = null;
  }

  async getDB() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        // v1 stored per-file contents in a 'files' store (indexed by [packId, path]).
        // v2 stores whole zips in 'blobs' (indexed by packId) and unpacks in memory.
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS);
        }
        if (db.objectStoreNames.contains('files')) {
          try { db.deleteObjectStore('files'); } catch {}
        }
        if (tx && db.objectStoreNames.contains(STORE_META)) {
          // v1 meta records were per-file/one-file-at-a-time entries; v2 keys meta by packId.
          // Clear stale v1 metadata wholesale — it is regenerated on first sync.
          try { tx.objectStore(STORE_META).clear(); } catch {}
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.error('[ModStorage] Open DB error:', req.error);
        reject(req.error);
      };
    });
    return this.dbPromise;
  }

  /** Store one whole-pack zip blob under its id. */
  async putBlob(packId, blob) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_BLOBS).put(blob, packId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Retrieve the stored blob for a pack, or null. */
  async getBlob(packId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BLOBS], 'readonly');
      const req = tx.objectStore(STORE_BLOBS).get(packId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Record meta {id, name, version, minApp, sha256, bytes, features, fetchedAt}. */
  async putMeta(meta) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], 'readwrite');
      tx.objectStore(STORE_META).put(meta, meta.id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** All stored meta records. */
  async listMeta() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], 'readonly');
      const req = tx.objectStore(STORE_META).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** Drop one pack's blob + meta. */
  async removePack(packId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_BLOBS, STORE_META], 'readwrite');
      tx.objectStore(STORE_BLOBS).delete(packId);
      tx.objectStore(STORE_META).delete(packId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Ensure the pack's blob matches the catalog sha256. Downloads only when
   * stale or missing. Returns the blob. Never persists a failed download:
   * a failed re-download leaves the previous version in place (downgrade red line).
   */
  async ensurePackBlob(entry, fetchImpl = fetch) {
    const existingMeta = (await this.listMeta()).find(m => m.id === entry.id);
    if (existingMeta && existingMeta.sha256 === entry.sha256) {
      const blob = await this.getBlob(entry.id);
      if (blob) return blob;
    }
    const resp = await fetchImpl(entry.url);
    if (!resp.ok) throw new Error(`下载 mod 包失败 ${entry.id}: HTTP ${resp.status}`);
    const blob = await resp.blob();
    const actual = await this.sha256(blob);
    if (actual !== entry.sha256) {
      throw new Error(`mod 包 ${entry.id} 校验失败: sha256 ${actual} != ${entry.sha256}`);
    }
    await this.putBlob(entry.id, blob);
    await this.putMeta({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      minApp: entry.minApp,
      sha256: entry.sha256,
      bytes: entry.bytes,
      features: entry.features,
      fetchedAt: Date.now(),
    });
    return blob;
  }

  /** Compute the hex SHA-256 of a blob. */
  async sha256(blob) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

export const modStorage = new ModStorageService();
