// server/sim/targeting.js — range tests, target filters and priorities (DESIGN §3, §5.5).
//
// Grid ranges: `[dRow, dCol]` offsets relative to facing RIGHT, rotated by the unit's direction (sim/dir.js: RIGHT
// (dr,dc), UP (dc,−dr), LEFT (−dr,−dc), DOWN (−dc,dr); row 0 = bottom). An enemy is in range when the tile containing
// it (round(y), round(x)) is one of the absolute range tiles — a huge enemy (巨型单位) when any tile its hit rectangle
// occupies is (body.js; user playtest #5 item 10). `rangeExtend` (ability_range_forward_extend) adds N tiles
// past the furthest cell of every row, along +dCol BEFORE rotating (DESIGN §3).
// Operator priority: (1) enemies it blocks (every blocker, ranged ones on melee tiles included — user playtest #6
// follow-up "阻挡了就一定要能打到"; Battle.blockedTargets; a healer's heal attack picks injured allies instead, blocking
// or not — ai.js acquireTargets), (2) profile priority (fly/lowDef/…),
// (3) higher enemy taunt, (4) least remaining path distance to the goal, (5) earliest spawned. Air units
// (Unit.isFlying: FLY, 近地悬浮, 浮空) need a profile that can hit them (`canHitFly`, never `groundOnly`). Enemy
// priority: sortAllyTargets. 起飞 (an ally's flag `liftoff`) = 对地规避: no ground enemy selects it (evadesGround).

import { COLS, ROWS } from './constants.js';
import { normDir, rotateOffset } from './dir.js';
import { bodyDist } from './body.js';

/**
 * Build the absolute tile-key list of a grid for a unit standing at (r,c) facing `dir` ('UP'|'RIGHT'|'DOWN'|'LEFT';
 * a legacy facing sign ±1 is read as RIGHT / LEFT).
 */
export function absoluteRangeKeys(grid, r, c, dir, extend = 0) {
  const keys = [];
  const seen = new Set();
  const d = normDir(dir);
  const add = (dr, dc) => {
    const [ar, ac] = rotateOffset(dr, dc, d);
    const rr = r + ar, cc = c + ac;
    if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) return;
    const k = rr * COLS + cc;
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  };
  // kits may hand over junk (a number, a string, [[1,'a']]): ignore anything that is not an integer [dr, dc] pair
  // instead of throwing inside the attack loop every tick
  if (!Array.isArray(grid) || !Number.isInteger(r) || !Number.isInteger(c)) return keys;
  const cells = grid.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]));
  for (const [dr, dc] of cells) add(dr, dc);
  if (extend > 0 && Number.isFinite(extend)) {
    const maxByRow = new Map();
    for (const [dr, dc] of cells) maxByRow.set(dr, Math.max(maxByRow.get(dr) ?? -Infinity, dc));
    for (const [dr, mx] of maxByRow) for (let k = 1; k <= Math.min(extend, COLS); k++) add(dr, mx + k);
  }
  return keys;
}

// extendedGrid(grid, extend): the relative form of absoluteRangeKeys' rangeExtend — one implementation with the card's
// record range (shared/loadoutRecord.js attackRangeGrid), re-exported here for the battle (Battle._refreshRange).
export { extendedGrid } from '../../shared/loadoutRecord.js';

/** Tile key of a unit's current position. */
export function tileKeyOf(u) {
  const r = Math.round(u.y), c = Math.round(u.x);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1;
  return r * COLS + c;
}

/** Can `attacker` (ally) target enemy `e` at all (ignoring range)? */
export function canTargetEnemy(attacker, e, profile) {
  if (!e.alive || e.hidden || !e.deployed) return false;
  const f = e.s.flags;
  if (f.untargetable || (f.sleep && !(profile && profile.hitSleep))) return false;
  if (f.stealth && !f.reveal && !e.blockedBy) return false;
  if (e.isFlying && !(profile && profile.canHitFly)) return false;
  if (profile && profile.groundOnly && e.isFlying) return false;
  return true;
}

/**
 * Can enemy `e` target ally `a`? `ranged` = the attack is a ranged (non-blocked) one. A stealthed ally (隐匿, the
 * 排气格栅 tile) is a target only for the enemy it blocks — PRTS 作战机制 §隐匿 "我方干员并不会因为阻挡而解除隐匿" and 索敌的
 * 概念 "敌人会在自身被干员阻挡情况下强行无视对方可选性发动攻击" (the term text "不阻挡时…" is the short form; 异常效果:
 * "隐匿与'阻挡时解除'没有直接关系"). Devices are never targets (阻隔工事: obstacles nobody can select; “双眼皮”: 迷彩 and
 * off the enemy paths — PRTS). 迷彩 (flag `camou`, term ba.camou "不阻挡时不成为敌方普通攻击的目标") works the same way:
 * PRTS 异常效果 gives both anomalies the note "与'阻挡时解除'没有直接关系" [ASSUMED: enemy skills and splash selectors
 * treat 迷彩 like target selection — officially splash and selectors without a projectile ignore it]. An airborne ally
 * (起飞, flag `liftoff`) is never a target of a ground enemy (evadesGround).
 */
export function canTargetAlly(e, a, ranged) {
  if (!a.alive || !a.deployed || a.hidden || a.kind === 'device') return false;
  const f = a.s.flags;
  if (f.untargetable || f.sleep) return false;
  if (ranged && (f.stealth || f.camou) && e.blockedBy !== a) return false;
  if (f.liftoff && evadesGround(e, a)) return false;
  return true;
}

/**
 * 对地规避 of an airborne ally (起飞, buff flag `liftoff` — 蒂比's skills): true when `src` is an enemy whose 行动方式 is
 * ground, which then cannot select `a` (gamedata_const ba.liftoff "不阻挡地面敌人且不会被地面敌人攻击，可以阻挡飞行敌人";
 * PRTS 术语释义 起飞 "包含对地规避（无法被不同阵营行动方式为地面的单位选中）"; PRTS 异常效果 MOTION_TARGET_FREE, a 无法选择
 * effect that a selector whose 行动方式 is not ground ignores). Flyers, 近地悬浮 and 浮空 enemies (Unit.isFlying — PRTS
 * 行动方式: a hovering unit "是真正的飞行单位", a levitated one is seen as a flyer) still select it; it stays a ground unit
 * itself ("起飞的干员仍然是地面单位"), so they need no 对空 check. Used by every enemy selection (canTargetAlly), the damage
 * pipeline and Battle.applyStatus (a ground enemy's area damage, statuses and hits under way skip it — PRTS 作战机制 "AOE
 * 的判定是对攻击范围内的每个可以被选中的敌人进行判定"), and the content picks and one-shot areas that bypass canTargetAlly
 * (chain / bounce jumps, 周围四格 additions, shells, barrages, 沙狱, death blasts). Not selections, so they still reach it:
 * sourceless damage and DamageInfo / applyStatus `ignoreSelect` — abilities that "无视无法选择" (【污染秽蚀】, 【盲信之誓】,
 * 萨卡兹悖谬暴虐兵长's 暴击 splash), direct picks (碎铳之簧's counter on its attacker: PRTS 异常效果 "'直接选中'的能力…不受这些
 * 仅在选择时生效的异常效果制约"), the blasts of flying units credited to a ground leader (刺胄之弹, 斩胄之剑 / 破胄之锤) and
 * the ticks of a debuff a ground enemy put on it before it took off (出血, 沙狱, burning DoTs, 【自然涌动】: a tick selects
 * nobody). A shot already in flight is refused [ASSUMED] (damage.js).
 */
export function evadesGround(src, a) {
  return !!(a && a.s && a.s.flags.liftoff && src && src.side === 'enemy' && !src.isFlying);
}

const PRIORITY_FNS = {
  fly: (e) => (e.isFlying ? 0 : 1),
  lowDef: (e) => e.s.def,
  highDef: (e) => -e.s.def,
  ranged: (e) => (e.base.rangeRadius > 0 && e.def?.applyWay !== 'MELEE' ? 0 : 1),
  lowestHp: (e) => e.hp,
  highestHp: (e) => -e.hp,
  lowestHpRatio: (e) => e.hpRatio,
  highestAtk: (e) => -e.s.atk,
  boss: (e) => (e.isBoss ? 0 : 1),
  notBurst: (e) => (e.s.flags.burstLock ? 1 : 0),
  ground: (e) => (e.isFlying ? 1 : 0),
};

/**
 * Sort candidate enemies for an attacker (in place) and return them.
 * @param {object} attacker ally unit
 * @param {object[]} cands enemies
 * @param {string|null} priority profile/skill priority key
 */
export function sortEnemyTargets(battle, attacker, cands, priority) {
  if (cands.length <= 1) return cands;
  const pf = priority ? (PRIORITY_FNS[priority] || (priority === 'nearest' || priority === 'farthest' ? null : null)) : null;
  const ax = attacker.x, ay = attacker.y;
  const keyed = cands.map((e) => ({
    e,
    b: e.blockedBy === attacker ? 0 : 1,
    p: pf ? pf(e) : priority === 'nearest' ? bodyDist(e, ax, ay) : priority === 'farthest' ? -bodyDist(e, ax, ay) : 0,
    t: -(e.s.taunt || 0),
    d: battle.remainingDistance(e),
    s: e.spawnSeq,
  }));
  keyed.sort((a, b) => a.b - b.b || a.p - b.p || a.t - b.t || a.d - b.d || a.s - b.s);
  for (let i = 0; i < keyed.length; i++) cands[i] = keyed[i].e;
  return cands;
}

/**
 * Enemy target selection among allies (PRTS 作战机制 索敌, 敌方: "阻挡→特殊优先级→仇恨值（更容易被攻击→…→最后部署的目标→
 * 不容易被攻击）→最早出现"): its blocker first → highest taunt level → latest deployed (`aggroSeq`: the deploy order —
 * Battle.start deploys the operators first and ranks the start-of-battle summons after them). Special priorities
 * (优先攻击…) are the enemies' own content: `e.profile.canTarget` filters, key sorts broken by `aggroCmp`.
 */
export function sortAllyTargets(enemy, cands) {
  if (cands.length <= 1) return cands;
  cands.sort((a, b) => {
    const ba = enemy.blockedBy === a ? 0 : 1, bb = enemy.blockedBy === b ? 0 : 1;
    return ba - bb || aggroCmp(a, b);
  });
  return cands;
}

/**
 * 仇恨值 order of two allies for an enemy (negative ⇒ `a` first): higher taunt level, then the latest deployed
 * (`aggroSeq`). The tie-break after an enemy's special priority (优先攻击防御力最高的… — PRTS 索敌: 特殊优先级 → 仇恨值).
 */
export function aggroCmp(a, b) {
  const ta = a.s.taunt || 0, tb = b.s.taunt || 0;
  if (ta !== tb) return tb - ta;
  return (b.aggroSeq || b.deploySeq) - (a.aggroSeq || a.deploySeq);
}
