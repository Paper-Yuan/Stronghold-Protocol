// server/match/teams.js — 多队（8 / 12 人房）的对局规则：编制、个体血量、漏怪平摊与三段联防。
//
// 规则原文：docs/TWELVE_PLAYER_MODE.md（业主 2026-10-31 定稿）。这里只实现它写下的东西，没写的一律 [ASSUMED]：
//   §1 编制      seats 0–3 = 队 0，4–7 = 队 1，8–11 = 队 2；每人自己的棋盘，队只决定「卡池共用 / 队内联防 / 观看」。
//   §2 卡池      队内 4 人一个池、队间独立 —— 实现在 SharedPool 的一队一份（Match.teamPools / Match.poolFor）。
//   §3/§5 血量   每人一条个体血条 = 该玩家自己的目标生命值 ps.lp（上限随各自构筑：strategy band 的 startLp），
//                显示值 max(1, floor(hp))，真实归零才倒下转观战（settle.js 的 eliminateBroken 原样复用）。
//   §4 漏怪伤害  d = 本轮全体存活玩家各自的漏怪伤害之和，n = 当前存活人数，每人真实扣 d / n（保留 3 位小数，残差补给
//                最后一名存活玩家，使 Σ每人 == d；不封顶）。
//   §6–§9 联防  按轮判漏 → 队内联防（本队没漏的人里 ≤2 人，helperOrder）→ 全漏队观看 → 跨队联防（成功那队出手）→
//                扣血 / 结算。
//
// 只在 `maxSeats > MAX_SEATS` 的局里跑（Match.multiTeam）；4 人房一个字节都不走这里，仍然用 unite.js 的 planUnite
// 与 settle.js 原来的整数 LP 路径。
//
// [ASSUMED] 本文只写结论，理由在 PR 里：
//   1. 漏怪伤害 `d` 的原始量（§11 第 1 项未定）：取「本轮每名存活玩家自己的漏怪结算量之和」——即 4 人玩法里
//      `min(lpCapPerRound, 该玩家本轮的漏怪 / 联防幸存数)` 的全体求和，再按存活人数平摊。这样 4 人房的一回合与
//      12 人房的一回合是同一个口径，只是不再由漏怪者独自承担。
//   2. 队内池隔离：每队一份与现有 coop 池同规格的 SharedPool（`gd.poolCopies` 原值，不叠加队数），玩家的取/还都走
//      自己的队池（PlayerState.poolOf → Match.poolFor）。
//   3. 跨队联防：出手方取「队号最小的、该轮完全联防成功的那一队」的两位联防者（该队只有 1 人时就是那 1 人）；拦截目标
//      是「该轮没能完全联防成功的那些队仍在场上的漏怪」。全部队都成功 / 没有残余 → 不产生跨队联防，直接结算。
//   4. 跨队联防没有额外时限：沿用本轮战斗的时限（`wave.timeLimit`），§11 第 2 项未定。

import { teamIndexOf, teamCountOf, MAX_SEATS } from '../../shared/constants.js';
import { helperOrder, collectLeaks, uniteSurvivors } from './unite.js';

/** True when this match fields more than one team (a room above MAX_SEATS). */
export function isMultiTeam(m) {
  return !!(m && m.multiTeam === true);
}

/** The team count of a room of `maxSeats` seats (4 → 1, 8 → 2, 12 → 3). */
export function teamCount(m) {
  return teamCountOf(m && m.maxSeats ? m.maxSeats : MAX_SEATS);
}

/** The team index of a player (its seat's team). */
export function teamOf(ps) {
  return teamIndexOf(ps && ps.seat);
}

/**
 * The alive players of every team, in team order and seat order inside a team. A team whose players are all down
 * (eliminated) is still listed — with an empty roster, as the client draws it as a greyed strip.
 * @param {import('./Match.js').Match} m
 * @returns {import('./PlayerState.js').PlayerState[][]}
 */
export function teamRosters(m) {
  const n = teamCount(m);
  const out = Array.from({ length: n }, () => []);
  for (const ps of m.order) {
    const t = teamOf(ps);
    if (t >= 0 && t < n) out[t].push(ps);
  }
  return out;
}

/**
 * The health a bar shows for a player (TWELVE_PLAYER_MODE §5): `max(1, floor(hp))` while the real value is above 0,
 * and 0 once it is down — 0 therefore only ever means "eliminated", never "alive with 0.4 left".
 * @param {import('./PlayerState.js').PlayerState} ps
 * @returns {number}
 */
export function hpDisplay(ps) {
  if (!ps || ps.alive === false) return 0;
  const hp = Number(ps.lp);
  if (!Number.isFinite(hp) || hp <= 0) return 0;
  return Math.max(1, Math.floor(hp));
}

/** The individual HP ceiling the bar is drawn against: the highest value this player's build reached (§3). */
export function hpMaxDisplay(ps) {
  const max = Number(ps && ps.hpMax);
  if (!Number.isFinite(max) || max <= 0) return Math.max(1, hpDisplay(ps));
  return Math.max(1, Math.floor(max));
}

/** Record the ceiling of a player's individual bar (called from the round start; a build may raise it). */
export function trackHpMax(ps) {
  const lp = Number(ps && ps.lp);
  if (!Number.isFinite(lp) || lp <= 0) return;
  if (!Number.isFinite(Number(ps.hpMax)) || lp > Number(ps.hpMax)) ps.hpMax = lp;
}

/**
 * 队内联防 (TWELVE_PLAYER_MODE §7, §9 step 3): one plan per team, the SAME rules the 4-player 联防 uses — helpers are
 * the team's own perfect players chosen by `helperOrder` (≤ maxHelpers, 1 allowed), the leakers' counted leaks re-enter
 * on that team's field, and a team whose four players all leaked fields nobody (no borrowing, §7).
 *
 * Plan shape:
 *   { teams: [{ index, players, leakers, helpers, leaked, notReentered, watch }], anyLeak, anyField }
 * `watch`: the players of an all-leaked team watch the other teams' 队内联防 (§7 末 / §9 step 4).
 * @param {import('./Match.js').Match} m
 * @param {Map<string, object>} results playerId → BattleResult.perPlayer entry
 * @returns {{ teams: object[], anyLeak: boolean, anyField: boolean } | null} null when nobody leaked (no 联防 at all)
 */
export function planTeamUnite(m, results) {
  const rosters = teamRosters(m);
  const teams = [];
  let anyLeak = false;
  let anyField = false;
  for (let i = 0; i < rosters.length; i++) {
    const players = rosters[i].filter((ps) => ps.alive);
    const leakers = [];
    const perfects = [];
    for (const ps of players) {
      const r = results.get(ps.playerId);
      if (!r) continue;
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false);
      if (counted.length > 0) leakers.push(ps);
      else if (r.perfect !== false) perfects.push(ps);
    }
    // §7 末: 本队 4 人全漏 → 不借人（leakers 非空而 perfects 为空 ⇒ 本队不产生联防方，转观看）
    const helpers = leakers.length && perfects.length ? helperOrder(m, perfects, results) : [];
    const { leaked, notReentered } = collectLeaks(m, leakers, results);
    const watch = leakers.length > 0 && helpers.length === 0;
    if (leakers.length) anyLeak = true;
    if (helpers.length) anyField = true;
    teams.push({ index: i, players, leakers, helpers, leaked, notReentered, watch });
  }
  if (!anyLeak) return null;
  return { teams, anyLeak, anyField };
}

/**
 * The survivors a team's 队内联防 battle left — per leaker playerId → enemies still standing (0 = 完全联防成功).
 * @param {object} team the plan's entry for one team
 * @param {object|null} result the team field's BattleResult
 * @returns {Map<string, number>}
 */
export function teamSurvivors(team, result) {
  if (!team) return new Map();
  if (!result || result.synthetic) {
    // No battle ran for this team (all four leaked — §7 末 不借人 — or the field could not be built): everything it leaked
    // is still standing. The same fallback settlement applies to a synthetic 联防 result: the leaker's own counted leaks.
    const out = new Map();
    for (const l of team.leaked || []) out.set(l.sourcePlayerId, (out.get(l.sourcePlayerId) || 0) + 1);
    for (const [pid, n] of team.notReentered) out.set(pid, (out.get(pid) || 0) + n);
    return out;
  }
  // only THIS team's leakers are billed by this field: the wave carries the source player of every enemy, and a team's
  // field only ever takes its own (§7 各自判定、各自联防).
  const owned = new Set((team.leakers || []).map((p) => p.playerId));
  const out = new Map();
  for (const [pid, n] of uniteSurvivors(team, result)) if (owned.has(pid)) out.set(pid, n);
  return out;
}

/** Σ of a survivors map over a team's leakers. */
export function survivorsTotal(team, survivors) {
  if (!team || !survivors) return 0;
  let n = 0;
  for (const ps of team.leakers) n += Math.max(0, survivors.get(ps.playerId) || 0);
  return n;
}

/**
 * §8 跨队联防: who steps in, and against what. Runs once every team's 队内联防 ended (§9 step 5).
 *
 * The executor is the helper pair of a team that fully held (its team's leaks were all destroyed); the targets are the
 * enemies still standing from the teams that did not (an all-leaked team included — it fields no helper of its own, so
 * this is the only 联防 it can receive). No team fully held → no cross-team 联防 at all (§8.1).
 * @param {import('./Match.js').Match} m
 * @param {{ teams: object[] }} plan the team plan
 * @param {Map<number, { result: object|null, survivors: Map<string, number>, total: number }>} outcomes per team
 * @returns {{ helpers: any[], leaked: object[], notReentered: Map<string, number>, source: number } | null}
 */
export function planCrossUnite(m, plan, outcomes) {
  if (!plan || !Array.isArray(plan.teams)) return null;
  let source = null;
  const failed = [];
  for (const team of plan.teams) {
    if (!team.leakers.length) continue; // nothing leaked: nothing to hold, nothing to help
    const o = outcomes.get(team.index);
    const total = o ? o.total : survivorsTotal(team, o && o.survivors);
    if (total === 0 && team.helpers.length) { if (!source) source = team; continue; }
    failed.push(team);
  }
  if (!source || !source.helpers.length) return null; // §8.1: 一队都没完全联防成功 → 不产生跨队联防
  const leaked = [];
  for (const team of failed) {
    const o = outcomes.get(team.index);
    const res = o && o.result;
    if (res && !res.synthetic) {
      for (const pp of Object.values(res.perPlayer || {})) {
        for (const l of (pp && pp.leaked) || []) {
          // the same filter unite.js uniteSurvivors bills: what the wave sent IN from a leaker (no runtime spawns)
          if (!l || l.counted === false || l.uniteRuntime || !l.sourcePlayerId) continue;
          if (!team.leakers.some((ps) => ps.playerId === l.sourcePlayerId)) continue;
          leaked.push({
            enemyKey: l.enemyKey,
            mods: l.mods ? { ...l.mods } : null,
            lpr: l.lpr ?? 1,
            sourcePlayerId: l.sourcePlayerId,
            tag: l.tag ?? null,
            // 跨队联防 keeps paying the leaker's bounty: the helper that kills it collects exactly as in its own field
            bounty: null,
          });
        }
      }
      continue;
    }
    // the team fielded nobody (all four leaked, §7) or its battle could not run: what it leaked is all still standing
    for (const l of team.leaked || []) {
      leaked.push({ enemyKey: l.enemyKey, mods: l.mods ? { ...l.mods } : null, lpr: l.lpr ?? 1, sourcePlayerId: l.sourcePlayerId, tag: l.tag ?? null, bounty: null });
    }
  }
  if (!leaked.length) return null; // every team held: no enemies left to intercept
  return { helpers: source.helpers.slice(), leaked, notReentered: new Map(), source: source.index };
}

/**
 * 血量平摊 (TWELVE_PLAYER_MODE §4): `d` = the round's leak damage — the sum of every alive player's own charge — split
 * by the players alive right now (n). Every share keeps 3 decimals (`Math.round(x*1000)/1000`, the owner's precision of
 * 2026-11-01), and the rounding residue goes to the LAST alive player, so the shares always add up to `d` exactly:
 *   d = 25, n = 12 → eleven × 2.083 + 2.087 (Σ = 25)
 *   d = 6,  n = 12 → twelve × 0.5         (Σ = 6, no residue)
 *   d = 1,  n = 3  → 0.333 + 0.333 + 0.334 (Σ = 1)
 * The display layer is untouched (`hpDisplay` / `lpDisplay`: max(1, floor)).
 * @param {number} d the round's leak damage (not finite / ≤ 0 ⇒ 0)
 * @param {number} n the players alive right now (not an integer > 0 ⇒ nobody is charged)
 * @returns {{ d: number, n: number, shares: number[] }} `shares[i]`: what the i-th alive player (alive order) loses
 */
export function splitLeakDamage(d, n) {
  const damage = Number.isFinite(d) && d > 0 ? d : 0;
  const alive = Number.isInteger(n) && n > 0 ? n : 0;
  if (!alive) return { d: damage, n: 0, shares: [] };
  const each = Math.round((damage / alive) * 1000) / 1000;
  const shares = new Array(alive).fill(each);
  // the residue the others' rounding left: `d` is a sum of whole charges, so its remainder here is exact on the 0.001
  // grid and stays a 3-decimal share; an off-grid `d` keeps the exact remainder instead — the sum is the invariant
  const rest = damage - each * (alive - 1);
  const rounded = Math.round(rest * 1000) / 1000;
  shares[alive - 1] = Math.abs(each * (alive - 1) + rounded - damage) < 1e-9 ? rounded : rest;
  return { d: damage, n: alive, shares };
}


