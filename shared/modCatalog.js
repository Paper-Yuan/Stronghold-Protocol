// shared/modCatalog.js — the mod catalog contract (CF_MOD_TRI_PLAN.md §0.3, frozen shape).
// Both ends parse the same /mods/index.json; freshness is judged ONLY by per-entry sha256.
// Browser mirror: tools/sync-static-web.mjs copies this to public/shared/modCatalog.js.

/** Where the mod catalog is served from. Same-origin by default (CF front or game server). */
export const MOD_CATALOG_URL = '/mods/index.json';

/** A pack id: letters, digits, '.', '_', '-' (not first), at most 64 — same shape as isPackId. */
const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Integrity and freshness key: exactly 64 lowercase hex chars. */
const SHA256_RE = /^[0-9a-f]{64}$/;

const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/**
 * Parse a raw /mods/index.json body into a catalog `{ version, packs }`.
 * Fail-soft per entry: a malformed entry is dropped (and reported via `dropped` on the
 * returned object under a symbol-free key), never fails the whole catalog — but a body that
 * is not an object yields an empty catalog.
 *
 * A `?v=` query on an entry url is ignored for freshness: sha256 alone decides (§0.3).
 */
export function parseModCatalog(raw) {
  if (!raw || typeof raw !== 'object') return { version: 1, packs: [], dropped: [] };
  const list = Array.isArray(raw.packs) ? raw.packs : [];
  const packs = [];
  const dropped = [];

  for (const e of list) {
    if (!e || typeof e !== 'object') { dropped.push('(not an object)'); continue; }
    const id = str(e.id, 64);
    const sha256 = typeof e.sha256 === 'string' ? e.sha256.trim().toLowerCase() : '';
    const bytes = Number.isInteger(e.bytes) && e.bytes > 0 ? e.bytes : 0;
    const url = str(e.url, 500);
    const minApp = str(e.minApp, 32);
    if (!(PACK_ID_RE.test(id) && SHA256_RE.test(sha256) && bytes > 0 && url && minApp)) {
      dropped.push(id || '(no id)');
      continue;
    }
    packs.push({
      id,
      name: str(e.name, 120) || id,
      version: str(e.version, 32) || '0.0.0',
      minApp,
      sha256,
      bytes,
      url,
      features: Array.isArray(e.features) ? e.features.map((f) => str(f, 60)).filter(Boolean) : [],
    });
  }

  return { version: typeof raw.version === 'number' ? raw.version : 1, packs, dropped };
}

/** Find an entry by id; null when absent. */
export function packById(catalog, id) {
  return catalog?.packs?.find((p) => p.id === id) ?? null;
}

/**
 * Freshness check: a local copy is fresh iff its sha256 equals the catalog entry's.
 * The ONLY freshness source — ?v= query strings and URLs play no part (§0.3).
 */
export function hasFreshPack(entry, localSha256) {
  return typeof localSha256 === 'string' && localSha256.toLowerCase() === entry.sha256;
}

/** The content-addressed R2 key / URL for a pack's zip. */
export function modZipUrl(packId, sha256) {
  return `/mods/${packId}/${sha256}.zip`;
}
export const modZipKey = modZipUrl;

/** True for exactly `/mods/<id>/<64-hex>.zip` — any `?v=` or other query fails the check. */
export function isModZipUrl(url) {
  return typeof url === 'string' && /^\/mods\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[0-9a-f]{64}\.zip$/.test(url);
}

/** The catalog index URL, versioned by its own sha256 (the only ?v= that exists anywhere). */
export function catalogVersionUrl(base, sha256) {
  return `${base}?v=${sha256.slice(0, 12)}`;
}
