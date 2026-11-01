// server/sim/content/kits/shared/mujica.js — the helpers the five 颂乐人偶 kits of 炸惊模拟 share (移动音符、命中事件、
// 鼓舞、治疗选择). Kit contract and rules: ../README.md; the tier helpers this file builds on: ./tier1.js.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of `modref/v2.1/server/sim/content/kits/shared/mujica.js` (75 lines).
// The Fever state itself is NOT here: it is `content/mujica.js` (the engine-cards worker's port of the pack's module —
// PRTS 丰川祥子 / Fever, 2026-10-22), and these kits only read it (`addFever` / `isFeverActive`) and re-export
// `isMujica` / `ensureMujica` from it, so no kit owns a Fever rule of its own.
//
// ADAPTATIONS to 0.3.3 (each one is why this file is not a byte copy):
//   * `b.fx('mujicaSound', { bank })` — the pack's audio-bank trigger — is NOT ported: 0.3.3 has no sim-driven sound kind
//     (`test/render/boardart.test.js` requires every literal kind in server/sim to be a client FX_KIND, and the bank names
//     are client assets). `strike()` therefore always emits the existing 'aoe' kind and carries the pack's projectile id
//     in its payload instead of a 'mujicaImpact' kind, so a client can bind the visual later: visual-only, no gameplay.
//   * `u.rangeKeySet` (a Set, 0.3.3) sits next to `u.rangeKeys` (an array): `inRange` reads the Set when present.
//   * `b.blockedTargets(u, profile)` takes the merged profile exactly as the pack calls it; 0.3.3's canTargetEnemy reads
//     `canHitFly` / `groundOnly` off it, so the kit's options pass through unchanged.
//   * `b.emit('attack', …)` carries `{ attacker, targets, isSkill }` (0.3.3; the pack added an `attackId`), and
//     `u.skill.onAttackPerformed(targets, isSkill)` is the same call.
import { num, enemiesInGrid as gridEnemies, talentBb, moduleBb } from './tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';
import { aggregateMods } from '../../../buffs.js';
import { isMujica, ensureMujica } from '../../mujica.js';

export { num, talentBb, moduleBb, isMujica, ensureMujica };

/**
 * Targetable enemies of `grid` (null ⇒ the unit's live range), the enemies it BLOCKS first: a melee 颂乐人偶 stands on her
 * own tile's [0,0] and a blocked enemy is on another tile, so the pack's attack loops ask for "everything I can reach"
 * rather than "everything inside rangeKeys" (identical when she blocks nothing).
 */
export function enemiesInGrid(b, u, grid = null, options = {}) {
  const found = gridEnemies(b, u, grid, { ...options, n: 0 });
  const blocked = b.blockedTargets(u, { ...u.profile, ...options });
  const targets = [...blocked, ...found.filter((e) => !blocked.includes(e))];
  return options.n > 0 ? targets.slice(0, options.n) : targets;
}

/** Alive, deployed, not hidden — the pack's `live`, same three fields (a 替身 / 召唤物 counts by them alone). */
export const live = (u) => !!(u?.alive && u.deployed && !u.hidden);

/** The other 颂乐人偶 of `u`'s player still on the field (Fever's 成员 set — the pack's `mates`). */
export const mates = (b, u) => b.allyUnits.filter((a) => live(a) && a.ownerId === u.ownerId && isMujica(a));

export const charId = (u) => u?.def?.charId;
export const skillId = (chess) => chess.skill?.skillId;
/** A skill's own record (any of the chess's three), else the selected one when it is that skill. */
export const skillData = (chess, id) => (chess.skills || []).find((s) => s.skillId === id) || (chess.skill?.skillId === id ? chess.skill : {});
export const bbOf = (chess, id) => skillData(chess, id).bb || {};

/** Hold `mods` on every target for one aura tick (0.35 s, refreshed while the source keeps it) — the pack's `aura`. */
export function aura(b, source, key, targets, mods) {
  for (const target of targets) b.addBuff(target, { key: `${key}:${source.id}`, source, mods, duration: 0.35, refresh: 'replace' });
}

/**
 * 鼓舞: `value` flat ATK / DEF on `target`, divided by the target's own stat multipliers so the buff reads as the number
 * the skill text gives (PRTS: 三角初华's 鼓舞 is a flat share of HER attack, not scaled again by the target's buffs).
 * A stronger buff from another source is kept (同名取最高).
 */
export function inspire(b, source, target, value, stat = 'atk') {
  if (!(value > 0) || !live(target) || target.mem.noInspire) return;
  const key = stat === 'atk' ? 'inspire' : 'inspire:def';
  const current = target.findBuff(key);
  if (current?.data?.src !== source.id && current?.data?.val > value && current.timeLeft > 0.1) return;
  const { add, mul } = aggregateMods(target.buffs.filter((x) => x.key !== key));
  const factor = Math.max(0, 1 + (add[`${stat}Pct`] ?? 0)) * (mul[`${stat}Mul`] ?? 1);
  b.addBuff(target, { key, source, duration: 0.35, refresh: 'replace', mods: { [`${stat}Flat`]: factor > 1e-6 ? value / factor : value }, data: { src: source.id, val: value } });
}

/** May `u` attack right now (the pack's gate: alive, no 缴械 / 替身切换 in progress). */
export function canAttack(u) { return live(u) && u.canAct && !u.s.flags.disarm && !u.trait.dollSwitching; }

/**
 * One attack of `u` on `targets`, announced like the engine's own (ai.js `performAttack`): `beforeAttack`, the 首次接敌
 * event, one `atk` event per victim and `attack` after the hits. The kits call it because their hits are scheduled
 * (`b.after`) inside one swing, which the engine's own attack loop cannot express.
 */
export function attackEvent(b, u, targets, fn, isSkill = !!u.skill?.active) {
  const c = { attacker: u, targets, isSkill, profile: u.profile };
  b.emit('beforeAttack', c);
  if (!live(u)) return;
  u.lastAttackAt = b.time; u.stats.attacks++;
  const attackId = ++b._attackSeq;
  const selected = (c.targets || []).filter(live);
  if (selected.length && !u.mem.engaged) { u.mem.engaged = true; b._ev(['engage', u.id]); }
  for (const t of selected) b._ev(['atk', u.id, t.id, 'none']);
  fn(selected, attackId);
  b.emit('attack', { attacker: u, targets: selected, isSkill });
  u.skill?.onAttackPerformed(selected, isSkill);
}

/**
 * One hit of a scheduled swing: `scale` × ATK on `target` (may be null: the blow lands on `point` / the tile in front),
 * a ground splash of `splashScale` × the same amount inside `splash` tiles, the `mujicaStrike` hook (T1 应召而至) and one
 * 'aoe' fx — the pack's `strike`, with the projectile id carried in the payload instead of a bespoke fx kind (see header).
 */
export function strike(b, u, target, scale, { type = 'phys', attackId, skill = !!u.skill?.active, splash = 0, splashScale = 0.5, point = null, projectile = null } = {}) {
  const amount = u.s.atk * u.s.atkScaleMul * scale;
  const pos = target || point || (() => { const [dr, dc] = dirVec(u.dir); return { x: u.x + dc, y: u.y + dr }; })();
  if (target) b.dealDamage(u, target, { amount, type, isAttack: true, isSkill: skill, attackId, tags: ['mujica'] });
  if (splash > 0) for (const e of b.enemiesInRadius(pos.x, pos.y, splash)) {
    if (e === target || e.isFlying) continue;
    b.dealDamage(u, e, { amount: amount * splashScale, type, isAttack: true, isSkill: skill, isSplash: true, attackId, tags: ['mujica'] });
  }
  b.emit('mujicaStrike', { unit: u, attackId });
  // A simulated tile strike keeps its original projectile for the renderer even when no enemy was hit.
  b.fx('aoe', { x: pos.x, y: pos.y, radius: splash || 0.3, id: u.id, skill: u.skill?.id, ...(projectile ? { projectile } : {}) });
}

/**
 * The kits' own attack loop: one swing every `interval` s (a number or a getter), started only while `canAttack` holds.
 * `action()` returns false for "nothing to hit this tick" (no cooldown is kept then). `mem.mujicaAttackReset` drops the
 * cooldown at once (八幡海铃 S2 "立即").
 */
export function fixedLoop(b, u, interval, action) {
  let cooldown = 0;
  b.on('tick', ({ dt }) => {
    if (!live(u)) { cooldown = 0; return; }
    if (u.mem.mujicaAttackReset) { cooldown = 0; u.mem.mujicaAttackReset = false; }
    if (!canAttack(u)) return;
    if (cooldown > 0) cooldown -= dt;
    if (cooldown > 1e-9) return;
    if (action() !== false) cooldown += Math.max(0.05, typeof interval === 'function' ? interval() : interval);
    else cooldown = 0;
  }, { owner: u });
}

/** Is `target` on a tile of `u`'s current range? (the pack's `inRange`: 三角初华's 第一天賦 / S1 judge by tile) */
export function inRange(u, target) { return !!u.rangeKeySet?.has(target.tileR * COLS + target.tileC); }

/**
 * The ally a 颂乐人偶 healer should heal: lowest HP ratio first, never a 禁疗 / 无法被友方治疗 one, `u` included;
 * `preferSakiko` puts 丰川祥子 (char_4182_oblvns) first among equals — PRTS 三角初华 S2 / 第一天賦 "优先治疗丰川祥子".
 */
export function healTarget(b, u, preferSakiko = false) {
  const candidates = b.alliesInGrid(u).filter((a) => a.hp < a.s.maxHp - 1e-9 && !a.s.flags.healFree && (a === u || (!a.profile?.noHeal && !a.s.flags.noHeal)));
  candidates.sort((a, z) => (preferSakiko ? Number(charId(z) === 'char_4182_oblvns') - Number(charId(a) === 'char_4182_oblvns') : 0) || a.hpRatio - z.hpRatio || z.aggroSeq - a.aggroSeq);
  return candidates[0] || null;
}
