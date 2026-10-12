// shared/i18nData.js — the localized game-data overlay (data/i18n/<lang>.json): its format, written by
// tools/build-i18n.mjs and applied by public/js/data.js (also usable under Node).
//
//   { version: 1, lang: 'en', meta: { … sources, coverage … },
//     names: { <Chinese name>: <name> },                       // every translated game-data name (ticker / toast args)
//     files: { <data file>: { <record id>: RecordOverlay } } }
//
// A RecordOverlay mirrors the record of data/<file>.json: a string leaf replaces the Chinese string at the same path,
// an object recurses, an array is index-aligned (null = keep the Chinese entry). `_h` (on every record overlay) holds
// the 2-character hash (textHash2) of each Chinese string a leaf replaces, in walk order (object keys in their order,
// array entries by index, `_h` itself skipped). A record that is a plain string (config `seasonName`) has { _s, _h }. A leaf whose Chinese source no longer hashes the same — data/*.json was
// rebuilt after the overlay — is not applied: the player sees the current Chinese text rather than a stale translation.
//
// Language packs (shared/i18nPacks.js): a language's game texts may come from several overlays — the pack's own, its
// base's, a fallback's (English) — applied per text: `applyFileOverlay(json, overlay, onto)` checks each leaf against
// the Chinese `json` and writes it over `onto` (what the overlays of lower priority made), so applying them from the
// last of the chain to the first leaves, for every text, the best overlay that has it (public/js/data.js).

export const OVERLAY_VERSION = 1;

/**
 * 32-bit FNV-1a of a string, as 2 base-36 characters (1296 buckets): the per-leaf staleness check.
 * @param {string} s
 * @returns {string}
 */
export function textHash2(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 1296).toString(36).padStart(2, '0');
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Visit every string leaf of a record overlay in walk order.
 * @param {any} ov record overlay (or a sub-tree of it)
 * @param {(path: (string|number)[], text: string) => void} visit
 * @param {(string|number)[]} [path]
 */
export function walkOverlay(ov, visit, path = []) {
  if (typeof ov === 'string') { visit(path, ov); return; }
  if (Array.isArray(ov)) {
    for (let i = 0; i < ov.length; i++) if (ov[i] != null) walkOverlay(ov[i], visit, [...path, i]);
    return;
  }
  if (isObj(ov)) {
    for (const k of Object.keys(ov)) {
      if (path.length === 0 && k === '_h') continue;
      walkOverlay(ov[k], visit, [...path, k]);
    }
  }
}

/**
 * The value at a path of a record, or undefined.
 * @param {any} base
 * @param {(string|number)[]} path
 */
export function getPath(base, path) {
  let cur = base;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** A path as a lookup key (an array record's top-level indexes become object keys, so numbers and strings match). */
const pathKey = (path) => path.map(String).join('\u0000');

/**
 * Build a record overlay from its leaves (the build tool): sets each `en` at its path and computes `_h` from the
 * Chinese sources in the final walk order. A record that is itself an array (config `tips`, `titles` …) gets an object
 * overlay keyed by index ("0", "1" …: integer keys keep index order).
 * @param {{ path: (string|number)[], zh: string, en: string }[]} leaves
 * @returns {any|null} null when there is no leaf
 */
export function buildRecordOverlay(leaves) {
  if (!leaves.length) return null;
  // a record that is a plain string (config `seasonName`): { _s, _h }
  if (leaves.length === 1 && leaves[0].path.length === 0) return { _s: leaves[0].en, _h: textHash2(leaves[0].zh) };
  /** @type {any} */
  const root = {};
  const zhAt = new Map();
  for (const { path, zh, en } of leaves) {
    let cur = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      const nextIsIndex = typeof path[i + 1] === 'number';
      if (cur[k] == null) cur[k] = nextIsIndex ? [] : {};
      cur = cur[k];
    }
    cur[path[path.length - 1]] = en;
    zhAt.set(pathKey(path), zh);
  }
  // sparse arrays → explicit nulls (JSON has no holes)
  const fill = (v) => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = v[i] === undefined ? null : fill(v[i]); return v; }
    if (isObj(v)) { for (const k of Object.keys(v)) v[k] = fill(v[k]); return v; }
    return v;
  };
  fill(root);
  let h = '';
  walkOverlay(root, (path) => { h += textHash2(zhAt.get(pathKey(path)) ?? ''); });
  return { ...root, _h: h };
}

/**
 * Apply a record overlay to a Chinese record: a copy that shares every untouched branch (copy-on-write), with each leaf
 * whose Chinese source still matches its hash replaced. The input record is never modified. `onto` (default: the
 * record itself) is what the replaced leaves are written over — the record as overlays of lower priority left it — while
 * the hashes are always checked against the Chinese `base`.
 * @param {any} base
 * @param {any} ov
 * @param {any} [onto]
 * @returns {{ value: any, applied: number, stale: number }}
 */
export function applyRecordOverlay(base, ov, onto = base) {
  if (isObj(ov) && typeof ov._s === 'string') {
    const ok = typeof base === 'string' && textHash2(base) === ov._h;
    return { value: ok ? ov._s : onto, applied: ok ? 1 : 0, stale: ok ? 0 : 1 };
  }
  if (!isObj(ov) || base == null || typeof base !== 'object') return { value: onto, applied: 0, stale: 0 };
  const hashes = typeof ov._h === 'string' ? ov._h : '';
  let i = 0;
  let applied = 0;
  let stale = 0;
  // b: the Chinese at this path (hash check); t: the target at this path (same shape: overlays replace strings only)
  const rec = (b, t, o, depth) => {
    if (typeof o === 'string') {
      const want = hashes.slice(i * 2, i * 2 + 2);
      i++;
      if (typeof b === 'string' && want && textHash2(b) === want) { applied++; return o; }
      stale++;
      return t;
    }
    if (Array.isArray(o)) {
      if (!Array.isArray(b) || !Array.isArray(t)) { walkOverlay(o, () => { i++; stale++; }); return t; }
      let out = t;
      for (let k = 0; k < o.length; k++) {
        if (o[k] == null) continue;
        const nv = rec(b[k], t[k], o[k], depth + 1);
        if (nv !== t[k]) { if (out === t) out = t.slice(); out[k] = nv; }
      }
      return out;
    }
    if (isObj(o)) {
      if (b == null || typeof b !== 'object' || t == null || typeof t !== 'object') { walkOverlay(o, () => { i++; stale++; }); return t; }
      // an array record's overlay is keyed by index (see buildRecordOverlay)
      const arr = Array.isArray(b);
      let out = t;
      for (const k of Object.keys(o)) {
        if (depth === 0 && k === '_h') continue;
        const at = arr ? (/^\d+$/.test(k) ? Number(k) : -1) : k;
        const cur = at === -1 ? undefined : b[at];
        const tcur = at === -1 ? undefined : t[at];
        const nv = rec(cur, tcur, o[k], depth + 1);
        if (at !== -1 && nv !== tcur) { if (out === t) out = Array.isArray(t) ? t.slice() : { ...t }; out[at] = nv; }
      }
      return out;
    }
    return t;
  };
  const value = rec(base, onto, ov, 0);
  return { value, applied, stale };
}

/**
 * Apply a file's overlay to a whole data file (the `{ id: record }` maps of data/*.json; other shapes are returned
 * unchanged). Untouched records are shared with the input. `onto`: see applyRecordOverlay (a whole file).
 * @param {any} json the Chinese file
 * @param {Record<string, any> | null | undefined} fileOverlay `files[<name>]` of the overlay
 * @param {any} [onto] the file as overlays of lower priority left it (default: the Chinese file)
 * @returns {{ value: any, applied: number, stale: number }}
 */
export function applyFileOverlay(json, fileOverlay, onto = json) {
  if (!isObj(json) || !isObj(fileOverlay) || !isObj(onto)) return { value: onto, applied: 0, stale: 0 };
  let out = onto;
  let applied = 0;
  let stale = 0;
  for (const [id, ov] of Object.entries(fileOverlay)) {
    if (!Object.prototype.hasOwnProperty.call(json, id)) continue;
    const r = applyRecordOverlay(json[id], ov, onto[id]);
    applied += r.applied;
    stale += r.stale;
    if (r.value !== onto[id]) { if (out === onto) out = { ...onto }; out[id] = r.value; }
  }
  return { value: out, applied, stale };
}
