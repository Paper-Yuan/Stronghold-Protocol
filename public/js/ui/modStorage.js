// public/js/ui/modStorage.js — Client-Side Unified Mod Storage Engine.
// Adheres strictly to docs/MOD_STORAGE_SPEC.md: IndexedDB persistence for offline/sandbox mods.

const DB_NAME = 'sp_mod_storage';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_FILES = 'files';

class ModStorageService {
  constructor() {
    this.dbPromise = null;
    this.blobUrlCache = new Map(); // key -> objectUrl
  }

  async getDB() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          // Compound key: [packId, path]
          const store = db.createObjectStore(STORE_FILES, { keyPath: ['packId', 'path'] });
          store.createIndex('by_pack', 'packId', { unique: false });
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

  /**
   * Save a fully parsed mod pack into IndexedDB.
   * @param {Object} meta Mod metadata (id, name, version, features, etc.)
   * @param {Map<string, Uint8Array|string|Object>} files Map of relativePath -> content
   */
  async saveMod(meta, files = new Map()) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_FILES], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      const filesStore = tx.objectStore(STORE_FILES);

      const recordMeta = {
        ...meta,
        installTime: Date.now(),
        enabled: meta.enabled !== false
      };
      metaStore.put(recordMeta);

      for (const [path, content] of files.entries()) {
        filesStore.put({
          packId: meta.id,
          path,
          content
        });
      }

      tx.oncomplete = () => {
        this._updateLocalActiveIndex(meta.id, recordMeta.enabled);
        resolve(recordMeta);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * List all locally installed mods.
   * @returns {Promise<Array<Object>>}
   */
  async listMods() {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /**
   * Toggle mod enabled state.
   */
  async toggleMod(packId, enabled) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      const getReq = store.get(packId);
      getReq.onsuccess = () => {
        const data = getReq.result;
        if (!data) return reject(new Error('Mod not found: ' + packId));
        data.enabled = !!enabled;
        store.put(data);
      };
      tx.oncomplete = () => {
        this._updateLocalActiveIndex(packId, enabled);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Remove a mod and all its files completely.
   */
  async removeMod(packId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_FILES], 'readwrite');
      tx.objectStore(STORE_META).delete(packId);

      const filesStore = tx.objectStore(STORE_FILES);
      const index = filesStore.index('by_pack');
      const req = index.openKeyCursor(IDBKeyRange.only(packId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          filesStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        this._updateLocalActiveIndex(packId, false, true);
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Fetch active overlays (JSON data) for offline / sandbox merge.
   * @returns {Promise<Record<string, any>>} section -> merged json
   */
  async getActiveOverlays() {
    const mods = await this.listMods();
    const activeMods = mods.filter(m => m.enabled);
    if (!activeMods.length) return {};

    const db = await this.getDB();
    const overlays = {};

    for (const mod of activeMods) {
      const files = await this._getPackJsonFiles(db, mod.id);
      for (const [section, content] of Object.entries(files)) {
        if (!overlays[section]) overlays[section] = content;
        else {
          // Shallow overlay merge
          if (Array.isArray(overlays[section]) && Array.isArray(content)) {
            overlays[section] = [...overlays[section], ...content];
          } else if (typeof overlays[section] === 'object' && typeof content === 'object') {
            overlays[section] = { ...overlays[section], ...content };
          }
        }
      }
    }
    return overlays;
  }

  async _getPackJsonFiles(db, packId) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const index = tx.objectStore(STORE_FILES).index('by_pack');
      const req = index.openCursor(IDBKeyRange.only(packId));
      const res = {};
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const { path, content } = cursor.value;
          if (path.endsWith('.json')) {
            const section = path.replace(/^.*[\\/]/, '').replace('.json', '');
            try {
              res[section] = typeof content === 'string' ? JSON.parse(content) : content;
            } catch {}
          }
          cursor.continue();
        } else {
          resolve(res);
        }
      };
      req.onerror = () => resolve({});
    });
  }

  _updateLocalActiveIndex(packId, enabled, isDelete = false) {
    try {
      const raw = localStorage.getItem('sp.active_packs') || '[]';
      let list = JSON.parse(raw);
      list = list.filter(id => id !== packId);
      if (enabled && !isDelete) {
        list.push(packId);
      }
      localStorage.setItem('sp.active_packs', JSON.stringify(list));
    } catch {}
  }
}

export const modStorage = new ModStorageService();
