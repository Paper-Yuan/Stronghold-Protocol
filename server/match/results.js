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
import { RANK_DIFFICULTY } from '../records.js';

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
 * @param {import('./Match.js').Match} m
 * @param {{ victory: boolean, hiddenReached: boolean, hiddenCleared: boolean, reason: string }} outcome
 * @param {{ endlessBest?: Map<string, number>, endlessBestNew?: Set<string> }} [extras] 无尽模式的最高回合记录
 *   （server/records.js）：玩家 → 历史最高回合，以及本局是否刷新纪录。
 */
export function buildResult(m, outcome, extras = {}) {
  const gd = m.gd;
  const { victory, hiddenReached, hiddenCleared } = outcome;
  const endless = !!gd.isEndless;
  const best = extras.endlessBest instanceof Map ? extras.endlessBest : new Map();
  const bestNew = extras.endlessBestNew instanceof Set ? extras.endlessBestNew : new Set();
  const players = [...m.players.values()].sort((a, b) => a.seat - b.seat);
  const titles = assignTitles(gd, players, victory);
  // 无尽模式没有终局：成绩 = 存活过的回合数（第 m.round 回合倒下 ⇒ 通过 m.round − 1 回合）。
  const teamRounds = endless
    ? Math.max(0, m.round - 1)
    : victory ? gd.bossRound + (hiddenCleared ? 1 : 0) : Math.max(0, Math.min(m.round, gd.bossRound) - 1);
  const rows = players.map((ps) => {
    const roundsPassed = endless
      ? (ps.eliminatedRound != null ? Math.max(0, ps.eliminatedRound - 1) : teamRounds)
      : (!ps.alive && ps.eliminatedRound != null ? Math.max(0, ps.eliminatedRound - 1) : teamRounds);
    const lineup = boardOrder(ps.board).filter((x) => x.piece.kind === 'chess').map(({ r, c, piece }) => {
      const e = { id: piece.id, golden: gd.isGolden(piece.id), tier: gd.tierOf(piece.id), row: r, col: c, items: (piece.items || []).map((i) => i.id) };
      // 0.2.0 自选编队: a DIY slot's pick — the result screen names and draws the operator (shared/diy.js diyRecord)
      const pick = typeof ps.diyPickOf === 'function' ? ps.diyPickOf(piece.id) : null;
      if (pick) e.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
      return e;
    });
    // the team's clear counts for the players still in; an eliminated / departed teammate did not pass the boss round
    const cleared = victory && ps.alive;
    return {
      playerId: ps.playerId,
      seat: ps.seat,
      name: ps.name,
      isBot: ps.isBot,
      left: ps.left,
      alive: ps.alive,
      victory: cleared,
      roundsPassed,
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
      title: titles.get(ps.playerId) ?? null,
      // 无尽模式不产出常规奖杯 / 奖励：它只看「最高回合」（server/records.js）。
      trophies: endless ? 0 : trophiesFor(gd, roundsPassed, cleared && hiddenCleared),
      reward: endless ? 0 : rewardFor(gd, roundsPassed),
      ...(endless ? { bestRounds: best.has(ps.playerId) ? best.get(ps.playerId) : null, bestImprovement: bestNew.has(ps.playerId) } : {}),
    };
  });
  return {
    t: 'm.result',
    victory,
    roundsPassed: teamRounds,
    // 无尽模式：本轮存活回合数 + 模式标记（客户端据此切换结算页文案）。
    // ranked：本局难度是否计入排行榜（只有「无尽·终极」上榜，见 server/records.js）——
    // 非终极局没有最高回合记录可显示，结算页据此提示「本难度不计入排行榜」。
    ...(endless ? { endless: true, roundsSurvived: teamRounds, ranked: String(m.difficulty || '') === RANK_DIFFICULTY } : {}),
    hiddenReached,
    hiddenCleared,
    reason: outcome.reason,
    // the merged Final Assault pool (null before round 14); players[].lp are the alive players' shares of it
    teamLp: m.teamLp != null ? Math.max(0, Math.round(m.teamLp)) : null,
    modeId: m.modeId,
    difficulty: m.difficulty,
    stageId: m.stageId,
    bossId: typeof m.bossIdAtRound === 'function' ? m.bossIdAtRound(m.round) : m.bossId,
    hiddenBossId: m.hiddenBossId,
    seed: m.seed,
    durationMs: Math.max(0, m.sched.now() - m.startedAt),
    players: rows,
  };
}
