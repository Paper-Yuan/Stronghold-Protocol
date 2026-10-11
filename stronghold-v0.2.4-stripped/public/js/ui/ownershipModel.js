// 干员持有 (operator ownership, 0.2.0 补位) — pure logic of the 干员持有 tab of the 干员调配 overlay (screens/ownership.js),
// shared with the sync (ui/loadoutSync.js) and the tests. The approved plan (owner's decision 2026-10-05): a player marks
// operators as not owned ("下掉"); only the 55 NORMAL chess can be dropped (shared/standIn.js isDroppableChess — the 74
// PRESET chess always field their own operator); default = everything owned; out of match (the next match takes it);
// co-op: the player's own pieces only; no friend borrowing. A dropped chess is deployed and shown as its official
// stand-in (data/backups.json; the owner's recall of 2026-10-06: cards, pieces and the result show the stand-in) while
// its bonds, 特质, tier, price and merge stay the chess's.
//
// The per-browser setting is a sorted list of base chess ids, persisted in localStorage (`sp.pref.ownership` =
// { v: 1, notOwned }) and sent with C2S `room.ownership { notOwned }` (the server keeps the droppable ids and drops the
// rest — shared/protocol.js checkNotOwned — so a stale list never gets refused). 导出 / 导入 use a versioned envelope
// like the loadout presets.

import { checkNotOwned, OWNERSHIP_LIMITS } from '../../../shared/protocol.js';
import { isDroppableChess, standInRecord } from '../../../shared/standIn.js';
import { t } from '../../../shared/i18n.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const OWNERSHIP_PREF = 'ownership';
export const OWNERSHIP_VERSION = 1;
/** `kind` of an exported ownership envelope. */
export const OWNERSHIP_EXPORT_KIND = 'stronghold.ownership';
/** A picked file / pasted payload longer than this is refused before parsing (a real payload is under 4 KB). */
export const OWNERSHIP_IMPORT_MAX_BYTES = 64 * 1024;

const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Structurally valid, deduplicated, sorted ids of a raw list (junk dropped; at most OWNERSHIP_LIMITS.notOwned).
 * @param {any} list
 * @returns {string[]}
 */
export function cleanIds(list) {
  const out = new Set();
  for (const id of Array.isArray(list) ? list : []) {
    if (out.size >= OWNERSHIP_LIMITS.notOwned) break;
    if (typeof id === 'string' && ID_RE.test(id) && !UNSAFE_IDS.has(id)) out.add(id);
  }
  return [...out].sort();
}

/**
 * Parse a stored setting (any junk → []): `{ v, notOwned }` or a bare array from an older build.
 * @param {any} raw
 * @returns {string[]}
 */
export function parseStoredOwnership(raw) {
  if (Array.isArray(raw)) return cleanIds(raw);
  return isObj(raw) ? cleanIds(raw.notOwned) : [];
}

/** Serialised form for localStorage. */
export const toStoredOwnership = (notOwned) => ({ v: OWNERSHIP_VERSION, notOwned: cleanIds(notOwned) });

/**
 * The ids to keep / send against the loaded data: droppable chess only (checkNotOwned), sorted.
 * @param {any} notOwned @param {(id: string) => any} getChess
 * @returns {string[]}
 */
export function sanitizeNotOwned(notOwned, getChess) {
  const res = checkNotOwned(cleanIds(notOwned), getChess);
  return res && res.ok ? res.notOwned : [];
}

/** Whether a chess is owned under a not-owned list (its base id is absent). */
export function isOwned(notOwned, chessId) {
  return !(Array.isArray(notOwned) && notOwned.includes(chessId));
}

/**
 * Toggle one chess: owned ↔ not owned. Returns a new sorted list (the input is not changed).
 * @param {string[]} notOwned @param {string} chessId base chess id
 * @param {boolean} [owned] the wanted state (default: the other one)
 */
export function setOwned(notOwned, chessId, owned = !isOwned(notOwned, chessId)) {
  const set = new Set(cleanIds(notOwned));
  if (owned) set.delete(chessId); else set.add(chessId);
  return [...set].sort();
}

// ---- roster -------------------------------------------------------------------------------------------------------

/**
 * The chess the screen lists: droppable chess in this season's shop (visible), in shop order (tier, shopSortId).
 * @param {any[]} list data.list('chess')
 */
export function ownershipRoster(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => isDroppableChess(c) && c.visible !== false && !c.isHidden)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0) || String(a.chessId).localeCompare(String(b.chessId)));
}

/** The roster grouped by tier: [{ tier, list }] in tier order. */
export function rosterByTier(roster) {
  const by = new Map();
  for (const c of roster) {
    if (!by.has(c.tier)) by.set(c.tier, []);
    by.get(c.tier).push(c);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => ({ tier, list }));
}

/**
 * What the screen shows of a chess's stand-in: the composed record (shared/standIn.js — the stand-in at the chess's
 * normal status with its backup skill) reduced to the card's fields; null without the data.
 * @param {any} chess normal chess record @param {any} backups data/backups.json
 * @returns {{ charId: string, name: string, appellation: string, profession: string, subProfessionName: string,
 *   rarity: number, skill: any, record: any } | null}
 */
export function standInSummary(chess, backups) {
  let rec;
  try { rec = standInRecord(chess, backups); } catch { rec = null; }
  if (!rec) return null;
  return {
    charId: rec.charId, name: rec.name, appellation: rec.appellation || '', profession: rec.profession,
    subProfessionName: rec.subProfessionName || '', rarity: rec.rarity, skill: rec.skill, record: rec,
  };
}

/** Number of listed chess marked as not owned (ids of retired / unknown chess do not count). */
export function notOwnedCount(notOwned, roster) {
  const ids = new Set(Array.isArray(notOwned) ? notOwned : []);
  let n = 0;
  for (const c of roster || []) if (ids.has(c.chessId)) n++;
  return n;
}

// ---- export / import -------------------------------------------------------------------------------------------------

/** Portable payload of a not-owned list, as downloaded / copied by 导出. */
export function exportOwnership(notOwned, { now = Date.now() } = {}) {
  const list = cleanIds(notOwned);
  return {
    kind: OWNERSHIP_EXPORT_KIND,
    v: OWNERSHIP_VERSION,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    count: list.length,
    notOwned: list,
  };
}

/** Pretty JSON of `exportOwnership`. */
export const serializeOwnership = (notOwned, opts) => JSON.stringify(exportOwnership(notOwned, opts), null, 2);

/**
 * Parse an imported list: the envelope, the stored `{ v, notOwned }` form, a bare array of ids, or the text of any of
 * them. STRUCTURAL only — the caller sanitises against the loaded data (sanitizeNotOwned). An envelope may hold an empty
 * list (= every operator owned).
 * @param {any} input payload or text
 * @returns {{ ok: true, notOwned: string[] } | { ok: false, error: string }}
 */
export function parseOwnershipImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > OWNERSHIP_IMPORT_MAX_BYTES) return { ok: false, error: t('内容过长，无法导入') };
    const text = raw.trim();
    if (!text) return { ok: false, error: t('没有可导入的内容') };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: t('无法识别的内容') }; }
  }
  if (Array.isArray(raw)) return { ok: true, notOwned: cleanIds(raw) };
  if (!isObj(raw)) return { ok: false, error: t('无法识别的格式') };
  const v = Number.isInteger(raw.v) ? raw.v : null;
  if (v != null && v > OWNERSHIP_VERSION) return { ok: false, error: t('这份数据来自更新的版本（v{v}），请先更新游戏', { v }) };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== OWNERSHIP_EXPORT_KIND) return { ok: false, error: t('这不是干员持有的数据') };
  if (!Array.isArray(raw.notOwned)) return { ok: false, error: t('里面没有干员持有的数据') };
  return { ok: true, notOwned: cleanIds(raw.notOwned) };
}
