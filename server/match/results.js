// server/match/results.js — settlement (RESULT): per-player results, titles (评语), trophies and rewards
// (DESIGN §6.1, research 06 §10.4–§10.6, data/config.json titles/titleRule/trophies/rewards).
//
// roundsPassed (per player): eliminated in round k ⇒ k − 1; alive at the end ⇒ bossRound on a win (+1 when the
// Hidden Core was cleared), bossRound − 1 when the Final Assault was lost. Rewards and trophies follow each player's
// OWN rounds passed (research 06 §6 / §10.4): the Hidden-Core trophy row and a row's `victory` only for the players
// still in at the end — a teammate eliminated (or departed) earlier keeps the table value of its own rounds.
// Titles: every config.titles entry (with data/tuning.json `titles` overrides, gamedata.js) has { stat, rule:
// 'max'|'min', onlyOnWin? }. 'max' titles: candidates are the players with a positive stat, ranked high → low.
// 'min' titles (坚若磐石 "目标生命值损失最少" = least LP lost): every player still alive at the end is a candidate,
// ranked low → high (the eliminated lost everything). Candidates are ranked by the player's rank for that stat
// (0 = best), then by closeness to the best value, then title order, then seat; greedy assignment gives each player
// ≤ 1 title and uses each title ≤ once (config.titleRule [ASSUMED]).

import { bondList } from './bondsMeta.js';
import { boardOrder } from './board.js';

const STAT_OF = {
  bossDamage: (ps) => ps.stats.bossDamage,
  activatedLayers: (ps) => ps.activatedLayers(),
  lpRemaining: (ps) => (ps.alive ? Math.max(0, ps.lpAtFinal ?? ps.lp) : 0),
  lpLost: (ps) => Math.max(0, Number(ps.stats.lpLost) || 0),
  merges: (ps) => ps.stats.merges,
  itemsEquipped: (ps) => ps.stats.itemsEquipped,
  fundsSpent: (ps) => ps.stats.gold,
};

export function assignTitles(gd, players, victory) {
  const titles = Array.isArray(gd.titles) ? gd.titles : Array.isArray(gd.config.titles) ? gd.config.titles : [];
  const cands = [];
  titles.forEach((t, ti) => {
    if (!t || typeof t.stat !== 'string' || !Object.hasOwn(STAT_OF, t.stat)) return;
    if (t.onlyOnWin && !victory) return;
    if (t.rule === 'min') {
      const vals = players.filter((ps) => ps.alive).map((ps) => ({ ps, v: Math.max(0, Number(STAT_OF[t.stat](ps)) || 0) }));
      if (!vals.length) return;
      const best = Math.min(...vals.map((x) => x.v));
      const sorted = vals.slice().sort((a, b) => a.v - b.v);
      for (const { ps, v } of vals) cands.push({ ps, t, ti, rank: sorted.findIndex((x) => x.v === v), rel: (best + 1) / (v + 1) });
      return;
    }
    const vals = players.map((ps) => ({ ps, v: Number(STAT_OF[t.stat](ps)) || 0 }));
    const best = Math.max(0, ...vals.map((x) => x.v));
    if (best <= 0) return;
    const sorted = vals.slice().sort((a, b) => b.v - a.v);
    for (const { ps, v } of vals) {
      if (v <= 0) continue;
      const rank = sorted.findIndex((x) => x.v === v);
      cands.push({ ps, t, ti, rank, rel: v / best });
    }
  });
  cands.sort((a, b) => a.rank - b.rank || b.rel - a.rel || a.ti - b.ti || a.ps.seat - b.ps.seat);
  const out = new Map();
  const used = new Set();
  for (const c of cands) {
    if (out.has(c.ps.playerId) || used.has(c.t.id)) continue;
    out.set(c.ps.playerId, { id: c.t.id, name: c.t.name, picId: c.t.picId, text: c.t.text });
    used.add(c.t.id);
  }
  return out;
}

function trophiesFor(gd, roundsPassed, hiddenCleared) {
  const tr = gd.config.trophies;
  if (!tr || gd.isSolo) return 0;
  let n = 0;
  if (Array.isArray(tr.byRoundsPassed)) {
    for (const row of tr.byRoundsPassed) {
      if (roundsPassed <= row.maxRound) { n = Number(row[gd.difficulty]) || 0; break; }
    }
  }
  if (hiddenCleared && tr.hiddenCore && Number.isFinite(tr.hiddenCore[gd.difficulty])) n = tr.hiddenCore[gd.difficulty];
  return n;
}

function rewardFor(gd, roundsPassed) {
  const rw = gd.config.rewards;
  if (!rw || !Array.isArray(rw.baseByRoundsPassed)) return 0;
  const row = rw.baseByRoundsPassed.filter((r) => r.round <= roundsPassed).pop();
  if (!row) return 0;
  const df = (rw.difficultyFactor && rw.difficultyFactor[gd.difficulty]) || 1;
  const mf = (rw.modeFactor && rw.modeFactor[gd.isSolo ? 'SINGLE' : 'MULTI']) || 1;
  return Math.round(row.count * df * mf);
}

/**
 * 超限档案（业主 2026-10-26）：只在 solo_infinite 的 m.result 上出现。
 * 普通模式的 result 不调用它，字节保持不变。
 * @param {import('./Match.js').Match} m
 * @param {any} gd
 */
export function overlimitArchive(m, gd) {
  const kills = Array.isArray(m.infiniteBossKills) ? m.infiniteBossKills : [];
  const layers = Object.entries(m.maxLayersSeen && typeof m.maxLayersSeen === 'object' ? m.maxLayersSeen : {})
    .map(([id, n]) => ({ id, name: gd.bond(id)?.name || id, layers: Math.round(Number(n) || 0) }))
    .filter((x) => x.layers > 0)
    .sort((a, b) => b.layers - a.layers);
  return {
    maxRound: Math.max(Number(m.round) || 0, ...kills.map((k) => Number(k.round) || 0), 0),
    partySize: Array.isArray(m.order) ? m.order.length : (m.players?.size || 1),
    bossKills: kills.map(({ key, ...k }) => k), // key 只用于服务端去重
    traitMods: (Array.isArray(m.traitMods) ? m.traitMods : []).map((t) => ({
      round: t.round, id: t.id, name: t.name, polarity: t.polarity,
      ...(typeof t.text === 'string' ? { text: t.text } : {}),
    })),
    maxLayers: layers.slice(0, 6),
    bestBond: layers[0] || null,
  };
}

/**
 * @param {import('./Match.js').Match} m
 * @param {{ victory: boolean, hiddenReached: boolean, hiddenCleared: boolean, reason: string }} outcome
 */
export function buildResult(m, outcome) {
  const gd = m.gd;
  const { victory, hiddenReached, hiddenCleared } = outcome;
  const players = [...m.players.values()].sort((a, b) => a.seat - b.seat);
  const titles = assignTitles(gd, players.filter(ps => !Number.isInteger(ps.aiTakeoverRound)), victory);
  // 无尽湮灭 (蚀流 6) 没有「满回合」：gd.bossRound 只是第一章的那一对（14），拿它封顶会把一场跑到 R40 的局报成 13 回合。
  // 其它模式（含超限）的 bossRound 是终点，仍然封顶。victory 在无尽里不可达（赢了首领也继续，gd.continueAfterBoss）。
  //
  // 超限（solo_infinite / coop_infinite）同样没有终点：一局停在第 R 回合，就是打到了第 R 回合。
  // 以前沿用 gd.bossRound（14）封顶 —— R37 的撤退局报 roundsPassed=14，而同一次结算里的
  // overlimit.maxRound=37，两个分数打架（docs/proposals/OVERLIMIT.md §2 F3）。现在整条绕过 bossRound，
  // 与 overlimitArchive 的 maxRound 同一个数；普通模式的算式逐字节不变。
  const infinite = m.isInfinite === true;
  const roundCap = gd.endless || infinite ? m.round : Math.min(m.round, gd.bossRound);
  const teamRounds = infinite
    ? Math.max(0, Number(m.round) || 0)
    : victory ? gd.bossRound + (hiddenCleared ? 1 : 0) : Math.max(0, roundCap - 1);
  const rows = players.map((ps) => {
    const roundsPassed = !ps.alive && ps.eliminatedRound != null ? Math.max(0, ps.eliminatedRound - 1) : teamRounds;
    const lineup = boardOrder(ps.board).filter((x) => x.piece.kind === 'chess').map(({ r, c, piece }) => {
      const e = { id: piece.id, golden: gd.isGolden(piece.id), tier: gd.tierOf(piece.id), row: r, col: c, items: (piece.items || []).map((i) => i.id) };
      // 0.2.0 自选编队: a DIY slot's pick — the result screen names and draws the operator (shared/diy.js diyRecord)
      const pick = typeof ps.diyPickOf === 'function' ? ps.diyPickOf(piece.id) : null;
      if (pick) e.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
      // 0.2.0 补位: a chess this player fielded as its stand-in — the result screen draws the stand-in (the owner's recall
      // of the official mode, 2026-10-06); `standInFor` = the replaced operator's charId, like the sim's UnitInfo
      const si = typeof ps.fieldsStandIn === 'function' && ps.fieldsStandIn(piece.id) ? gd.standIn(piece.id) : null;
      if (si && si.standInFor) e.standInFor = si.standInFor;
      return e;
    });
    // the team's clear counts for the players still in; an eliminated / departed teammate did not pass the boss round
    const cleared = victory && ps.alive;
    return {
      playerId: ps.playerId,
      seat: ps.seat,
      name: ps.name,
      isBot: ps.isBot,
      ...(Number.isInteger(ps.aiTakeoverRound) ? { aiTakeoverRound: ps.aiTakeoverRound } : {}),
      left: ps.left,
      alive: ps.alive,
      victory: cleared,
      roundsPassed,
      creditedKills: ps.creditedKills,
      eliminatedRound: ps.eliminatedRound,
      lp: Math.max(0, ps.lp),
      bandId: ps.bandId,
      lineup,
      bonds: bondList(gd, ps.bonds).filter((b) => b.active || b.layers > 0),
      stats: {
        dmgDealt: Math.round(ps.stats.dmgDealt), kills: ps.stats.kills, leaks: ps.stats.leaks, gold: ps.stats.gold,
        refreshes: ps.stats.refreshes, merges: ps.stats.merges, itemsEquipped: ps.stats.itemsEquipped,
        bossDamage: Math.round(ps.stats.bossDamage), activatedLayers: ps.activatedLayers(), lpLost: ps.stats.lpLost,
        perfectRounds: ps.stats.perfectRounds,
      },
      title: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? null : titles.get(ps.playerId) ?? null,
      trophies: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? 0 : trophiesFor(gd, roundsPassed, cleared && hiddenCleared),
      reward: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? 0 : rewardFor(gd, roundsPassed),
    };
  });
  const out = {
    t: 'm.result',
    victory,
    roundsPassed: teamRounds,
    hiddenReached,
    hiddenCleared,
    reason: outcome.reason,
    // the merged Final Assault pool (null before round 14); players[].lp are the alive players' shares of it
    teamLp: m.teamLp != null ? Math.max(0, Math.round(m.teamLp)) : null,
    modeId: m.modeId,
    difficulty: m.difficulty,
    stageId: m.stageId,
    // a non-default official version's match (DESIGN §35.23): its registry id — the page records and draws the settlement
    // with that version even when it never saw the room (the lobby's replay after a kick / grace timeout); absent for
    // the default, so its result stays byte-identical
    ...(m.version ? { version: m.version } : {}),
    bossId: m.bossId,
    hiddenBossId: m.hiddenBossId,
    seed: m.seed,
    durationMs: Math.max(0, m.sched.now() - m.startedAt),
    players: rows,
  };
  // 无尽湮灭 (蚀流 6) 没有「满回合」：m.result 本身不带 lastRound，客户端 normalizeResult 只能落 14 兜底。
  // 历史记录回放（public/js/ui/stats.js recordToResult）拿不到 m.public，只能靠这一行认出「这是无尽局」，
  // 否则结算页会给一场没有终点的局写「/14」。只有无尽局有这一行：官方模式 gd.endless 恒为 false（gamedata.js
  // endless 读 mode.difficulty === ANNIHILATION_DIFFICULTY），它们的 m.result 仍然逐字节不变。
  if (gd.endless) out.endless = true;
  // 超限档案（业主 2026-10-26）：只在无限模式出现；普通模式没有这个键，result 字节不变
  if (m.isInfinite) out.overlimit = overlimitArchive(m, gd);
  // A test match is marked on the settlement the replay stores. The keys are absent otherwise, so a normal
  // result stays byte-identical. Test results award nothing and are never persisted by the client.
  if (m.test === true) {
    out.test = true;
    out.testActions = m.testActions | 0;
    if (m.testReplayable === false) out.testReplayable = false;
  }
  return out;
}
