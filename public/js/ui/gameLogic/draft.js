// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { PHASE } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * 随机模式: `picks2` (the second round of picks) and `round`/`rounds` (which pick round is running) are
 * normalised alongside — `picks` stays round 1's map and `done` is true only when every round is filled.
 * @param {any} draft
 * @param {any[]} [players]
 * @returns {{ order: string[], turnPid: string|null, picks: Map<string,string>, picks2: Map<string,string>,
 *   skipsLeft: Map<string, number>, done: boolean, round: number, rounds: number }}
 */
export function normalizeDraft(draft, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : ids;
  let turnPid = null;
  if (typeof draft?.turn === 'string') turnPid = draft.turn;
  else if (Number.isInteger(draft?.turn) && draft.turn >= 0 && draft.turn < order.length) turnPid = order[draft.turn];
  const readPicks = (src) => {
    const map = new Map();
    if (Array.isArray(src)) {
      src.forEach((v, i) => {
        if (typeof v === 'string' && order[i]) map.set(order[i], v);
        else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') map.set(v.playerId, v.bandId);
      });
    } else if (isObj(src)) {
      for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) map.set(k, v);
    }
    return map;
  };
  const picks = readPicks(draft?.picks);
  const picks2 = readPicks(draft?.picks2);
  const rounds = Number.isInteger(draft?.rounds) && draft.rounds > 1 ? draft.rounds : 1;
  const round = rounds > 1 && Number.isInteger(draft?.round) && draft.round > 0 ? Math.min(draft.round, rounds) : 1;
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = order.length > 0 && order.every((pid) => picks.has(pid) && (rounds < 2 || picks2.has(pid)));
  return { order, turnPid, picks, picks2, skipsLeft, done, round, rounds };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 */
export function normalizeSp(sp, players = []) {
  if (!isObj(sp)) return null;
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, 6).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  let turnPid = null;
  if (typeof sp.turn === 'string') turnPid = sp.turn;
  else if (Number.isInteger(sp.turn) && sp.turn >= 0 && sp.turn < order.length) turnPid = order[sp.turn];
  const evolution = sp.evolution === true;
  if (evolution) {
    // 阶段质变：各自独立选择，卡不互抢——takenBy 不用于阻断（只有 sp.taken 的卡才算被占用）
    for (const [idx, pid] of takenBy) if (sp.taken == null || !(idx in (sp.taken || {}))) takenBy.delete(idx);
    for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  }
  return {
    family: typeof sp.family === 'string' ? sp.family : null,
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    evolution,
    cards, order, turnPid, pickOf, takenBy, pickedCount: pickOf.size,
  };
}

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  return {
    ...normalizeSp({ family: 'bounty', name: t('教鞭 · 战术特训'), desc: t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {} }),
    id: choice.id,
  };
}
