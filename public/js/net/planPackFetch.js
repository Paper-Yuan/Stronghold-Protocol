// public/js/net/planPackFetch.js — pure function: decide which packs to (re)fetch.
// Extracted from modStorage per CF_MOD_TRI_PLAN.md §2-D1-2 so it can be unit-tested
// without IndexedDB (no fake-indexeddb dependency).
//
// Freshness rule (§0.3): a local pack is fresh iff its stored sha256 equals the
// catalog entry's sha256. `?v=` on urls plays no part.

/**
 * @param {Record<string, string>} localIndex {packId: sha256} — the local mirror state
 * @param {Array<{id: string, sha256: string}>} catalog entries
 * @returns {{ toFetch: Array<{id, sha256, reason: 'missing'|'stale'}>, stale: string[] }}
 */
export function planPackFetch(localIndex, catalog) {
  const toFetch = [];
  const stale = [];
  for (const entry of catalog) {
    const local = localIndex[entry.id];
    if (local === undefined) {
      toFetch.push({ id: entry.id, sha256: entry.sha256, reason: 'missing' });
    } else if (local !== entry.sha256) {
      toFetch.push({ id: entry.id, sha256: entry.sha256, reason: 'stale' });
      stale.push(entry.id);
    }
  }
  return { toFetch, stale };
}

/**
 * Build the local freshness index from stored meta records.
 * @param {Array<{id: string, sha256: string}>} metas
 * @returns {Record<string, string>} {packId: sha256}
 */
export function buildLocalIndex(metas) {
  const idx = {};
  for (const m of metas) {
    if (m && typeof m.id === 'string' && typeof m.sha256 === 'string') idx[m.id] = m.sha256;
  }
  return idx;
}
