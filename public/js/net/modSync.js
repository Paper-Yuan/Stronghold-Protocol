// public/js/net/modSync.js — silent mod catalog sync at boot (CF_MOD_TRI_PLAN.md §2-D1-4).
// Contract: pull the /mods/index.json catalog (a tiny JSON) on every launch; pack zip
// bytes are fetched ON DEMAND (when a room actually needs them) — the confirmed
// "catalog at boot, zip on demand" model. Freshness is judged only by per-entry sha256.

import { MOD_CATALOG_URL, parseModCatalog } from '../../shared/modCatalog.js';
import { modStorage } from '../ui/modStorage.js';
import { buildLocalIndex } from './planPackFetch.js';

/**
 * Sync the mod catalog into the store. Fire-and-forget safe: never throws to the
 * caller (callers chain .catch for logs); on failure sets ui.modSync.phase='error'
 * and leaves any previous catalog mirror in place (degraded, still usable).
 */
export async function syncModCatalog({ store, fetchImpl = fetch }) {
  store.patch('ui', { modSync: { phase: 'catalog', done: 0, total: 0, error: null } });
  try {
    // The query string only defeats intermediary caches; freshness still comes from
    // each entry's sha256, never from this parameter.
    const bust = Date.now().toString(36);
    const resp = await fetchImpl(`${MOD_CATALOG_URL}?v=${bust}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`catalog HTTP ${resp.status}`);
    const raw = await resp.json();
    const catalog = parseModCatalog(raw);

    // Judge freshness from stored meta only — do NOT pull any pack blobs here.
    const metas = await modStorage.listMeta().catch(() => []);
    const localIndex = buildLocalIndex(metas);
    const fresh = catalog.packs.filter((p) => localIndex[p.id] === p.sha256).length;

    store.set({ modCatalog: { version: catalog.version, packs: catalog.packs, fetchedAt: Date.now() } });
    store.patch('ui', { modSync: { phase: 'ready', done: fresh, total: catalog.packs.length, error: null } });
    return catalog;
  } catch (err) {
    store.patch('ui', { modSync: { phase: 'error', done: 0, total: 0, error: String(err?.message || err) } });
    throw err;
  }
}

/**
 * Ensure all packs a room needs are present and fresh locally (zip on demand).
 * Any failure is a hard error for the room — no silent downgrade to a missing pack.
 */
export async function ensurePacksForRoom(packIds, { store, onProgress, fetchImpl = fetch } = {}) {
  const state = store.get();
  const catalog = state?.modCatalog?.packs ?? [];
  const entries = packIds
    .map((id) => catalog.find((p) => p.id === id))
    .filter(Boolean);
  if (entries.length !== packIds.length) {
    const missing = packIds.filter((id) => !catalog.some((p) => p.id === id));
    throw new Error(`mod 目录缺少包: ${missing.join(', ')}`);
  }

  let done = 0;
  for (const entry of entries) {
    await modStorage.ensurePackBlob(entry, fetchImpl); // throws on download/hash failure
    done += 1;
    if (onProgress) onProgress({ done, total: entries.length, id: entry.id });
  }
  if (store) store.patch('ui', { modSync: { phase: 'ready', done, total: entries.length, error: null } });
  return done;
}
