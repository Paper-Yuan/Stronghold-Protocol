// ui/gameLogic/standIn.js — 补位 stand-ins in the match UI (0.2.0, the approved plan — owner's decision 2026-10-05).
// Re-exported from ../gameLogic.js.
//
// A chess the player marked as not owned (干员持有) is SHOWN as its official stand-in wherever the player's copy of it
// appears — the shop and reward cards, the hand (整备区) and 临时整备区 pieces, the board, the detail card, the result
// screen, a teammate's prep scouting and bond popups — the owner's first-hand recall of the official mode, 2026-10-06
// (it reverses the first 0.2.0 build, where cards and the bench kept the chess's art and name with a 「替补：X」 badge).
// Only what is shown changes: the record (shared/standIn.js standInRecord over data/backups.json — the one the sim
// fields) keeps the chess's identity — ids, tier, bonds, 特质, price, merge — so every rule still reads the chess; its
// body — portrait / avatar, name, class, model, 特性, stats, range, skill, talents, module — is the stand-in's; a small
// 「替补」 mark (standInLabel) and the replaced operator's name on the detail card (standInForText) tell which chess it
// is. Whose pieces: the player's own come from m.private.standIns (the list the seat had when the match started — the
// server's, not this browser's current setting, which applies from the next match); another player's units say it
// themselves (UnitInfo `standInFor`: the sim's, Match.prepFieldMeta's for scouting, the m.result lineups).

import { standInRecord } from '../../../../shared/standIn.js';
import { resolveLoadout } from '../../../../shared/protocol.js';
import { chessLoadout } from './loadout.js';
import { isObj } from './shared.js';
import { t } from '../../../../shared/i18n.js';

/** Base chess ids the player fields as stand-ins in this match (m.private.standIns; [] when absent). */
export function standInIds(priv) {
  const list = isObj(priv) && Array.isArray(priv.standIns) ? priv.standIns : [];
  return list.filter((x) => typeof x === 'string');
}

/** Whether the player's own piece / card of chess record `chess` (normal or elite) fields its stand-in. */
export function fieldsStandIn(priv, chess) {
  if (!isObj(chess) || typeof chess.chessId !== 'string') return false;
  const ids = standInIds(priv);
  return ids.length > 0 && ids.includes(chess.baseId || chess.chessId);
}

/** Per backups object: chess record → composed stand-in record (or null). */
const CACHE = new WeakMap();

/**
 * The composed 补位 record of a chess record (shared/standIn.js standInRecord: the chess's identity, the stand-in's
 * body; `standInFor` = the replaced charId), cached per data object; null for a PRESET / 自选 chess or missing data.
 * A composed record is its own stand-in (a lookup that already hands out stand-in records stays idempotent).
 * @param {any} chess data/chess.json record @param {any} backups data/backups.json
 */
export function standInOf(chess, backups) {
  if (!isObj(chess)) return null;
  if (typeof chess.standInFor === 'string' && chess.standInFor) return chess;
  if (!isObj(backups)) return null;
  let m = CACHE.get(backups);
  if (!m) { m = new WeakMap(); CACHE.set(backups, m); }
  if (m.has(chess)) return m.get(chess);
  let rec;
  try { rec = standInRecord(chess, backups); } catch { rec = null; }
  m.set(chess, rec);
  return rec;
}

/**
 * The stand-in record the player's own card / piece of `chess` shows (the player fields its stand-in: m.private
 * standIns), or null.
 * @param {any} chess @param {any} priv m.private @param {any} backups
 */
export function ownStandIn(chess, priv, backups) {
  return fieldsStandIn(priv, chess) ? standInOf(chess, backups) : null;
}

/**
 * The stand-in record the card of a chess shows for this viewer, or null: a unit / lineup entry that carries
 * `standInFor` (another player's — the sim's UnitInfo, prep scouting, m.result), else the player's own piece / card
 * (m.private standIns).
 * @param {any} chess @param {{ priv?: any, unit?: any, backups?: any }} o
 */
export function cardStandIn(chess, { priv = null, unit = null, backups = null } = {}) {
  if (!isObj(chess)) return null;
  const mine = unit ? typeof unit.standInFor === 'string' && !!unit.standInFor : fieldsStandIn(priv, chess);
  return mine ? standInOf(chess, backups) : null;
}

/**
 * The stand-in a bond popup's member row of base chess `chess` shows for the board `priv`, or null: a chess the player
 * fields as its stand-in (m.private.standIns — any copy, in play or not, as the shop shows it), or one whose piece on a
 * teammate's board says it is a stand-in (ui/watchBonds.js ownerBoard: the units' `standInFor`).
 * @param {any} priv m.private, or a teammate's board ({ board, hand, temp } of pieces with `standInFor`)
 * @param {any} chess the member's chess record @param {any} backups
 * @param {(id: string) => any} [getChess] the pieces' records (their base ids)
 */
export function memberStandIn(priv, chess, backups, getChess = () => null) {
  if (!isObj(chess) || typeof chess.chessId !== 'string') return null;
  if (fieldsStandIn(priv, chess)) return standInOf(chess, backups);
  const base = chess.baseId || chess.chessId;
  const baseOf = (id) => getChess(id)?.baseId || (typeof id === 'string' ? id.replace(/_b$/, '_a') : id);
  for (const list of [priv?.board, priv?.hand, priv?.temp]) {
    for (const p of Array.isArray(list) ? list : []) {
      if (isObj(p) && typeof p.standInFor === 'string' && p.standInFor && baseOf(p.id) === base) return standInOf(chess, backups);
    }
  }
  return null;
}

/** id → stand-in record (else the chess record): the lookup a stand-in's loadout / options resolve against. */
export function standInGetter(getChess, backups) {
  return (id) => {
    const c = getChess(id);
    return standInOf(c, backups) || c;
  };
}

/**
 * The skill / module / record a stand-in fights with (chessLoadout of the composed record, no player loadout —
 * "对于补位干员其技能不可更改"): its backup skill, the elite's backup module (or none).
 * @param {any} rec standInOf(...) @param {(id: string) => any} getChess @param {any} backups
 */
export function standInLoadout(rec, getChess, backups) {
  return rec ? chessLoadout(rec, null, standInGetter(getChess, backups)) : null;
}

/**
 * The record the player's own piece of `chess` is deployed with — the stand-in record when the player fields its
 * stand-in, else the chess as the player's loadout makes it (chessLoadout `.record`): its range (board overlay, deploy
 * wheel), its position (legal tiles), the board model.
 * @param {any} chess @param {any} priv m.private @param {(id: string) => any} getChess @param {any} backups
 */
export function deployedRecord(chess, priv, getChess, backups) {
  if (!isObj(chess)) return chess;
  if (fieldsStandIn(priv, chess)) {
    const si = standInOf(chess, backups);
    if (si) return standInLoadout(si, getChess, backups)?.record || si;
  }
  return chessLoadout(chess, priv?.loadout ?? null, getChess)?.record || chess;
}

/**
 * The module id a deployed piece carries: a stand-in's backup module, else the player's loadout. (The 高台 rule no
 * longer reads it: since the owner's decision of 2026-10-05 it is the trait, whatever the module — shared/highGround.js.)
 */
export function deployedModuleId(chess, priv, getChess, backups) {
  if (!isObj(chess)) return null;
  try {
    if (fieldsStandIn(priv, chess)) {
      const si = standInOf(chess, backups);
      if (si) return resolveLoadout(null, si, standInGetter(getChess, backups))?.moduleId ?? null;
    }
    return resolveLoadout(priv?.loadout ?? null, chess, getChess)?.moduleId ?? null;
  } catch { return null; }
}

/** The small 「替补」 mark of a stand-in record (null without one): cards, the own pieces' tags, thumbnails. */
export function standInLabel(rec) {
  return isObj(rec) && rec.standInFor ? t('替补') : null;
}

/** The replaced operator's line of a stand-in's detail card: 「银灰的替补」 (`chessName` = the chess's own name). */
export function standInForText(chessName) {
  return t('{name}的替补', { name: chessName || '' });
}

/** The 「替补」 mark's title: which chess the stand-in fields for, and what stays the chess's ('' without a stand-in). */
export function standInTip(rec, chessName) {
  return isObj(rec) && rec.standInFor ? t('未持有{name}：由替补干员 {standIn} 上场（盟约、特质、阶级与价格不变）', { name: chessName || '', standIn: rec.name || '' }) : '';
}
