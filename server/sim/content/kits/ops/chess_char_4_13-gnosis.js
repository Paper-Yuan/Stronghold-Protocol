// server/sim/content/kits/ops/chess_char_4_13-gnosis.js — 灵知 (char_206_gnosis) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { sortEnemyTargets } from '../../../targeting.js';
import {
  AURA, AURA_DUR, num, tbb, nationOf, enemiesOnRange, targetsInRange, whileDeployed, toggleBuff, skillActive, isSel,
  alt, instantKind, withDefaults,
} from '../shared/tier4.js';

/** Enemy leaders / elites (精英或领袖敌人). */
const isEliteEnemy = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');

export default withDefaults({
  // ===== 灵知 (underminer) S2 零度爆发 — charges: 130 % arts + cold to all in range, charged ⇒ 2nd cold; 坚冰 / 殊途同归
  //       S1 高速思考 (next attack: 2 × 135 %/150 % arts); S3 失温症 (ASPD up, 2 targets — unfrozen first; frozen enemies
  //       in range stay frozen until the skill ends, then take 300 %/400 % arts and thaw); module UMD-Y (一号项目模型):
  //       +0.25 SP/s while an elite / leader enemy is in range
  chess_char_4_13_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S3 = isSel(def, 'skchr_gnosis_3');
    const frozen = (e) => !!e.findBuff('freeze');
    return {
      skills: alt(def, {
        skchr_gnosis_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1.35), hits: 2 } }),
        skchr_gnosis_3: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb.max_target, 2))) },
          onStart({ battle, unit }) { unit.mem.hypothermia = new Set(); battle.fx('coldWind', { x: unit.x, y: unit.y, id: unit.id }); },
          onTick({ battle, unit, skill }) {
            const H = unit.mem.hypothermia;
            if (!H) return;
            // 范围内所有敌人的冻结延长至技能结束
            for (const e of enemiesOnRange(battle, unit)) {
              const f = e.findBuff('freeze');
              if (!f) continue;
              H.add(e.id);
              if (f.timeLeft < skill.timeLeft) { f.timeLeft = skill.timeLeft; f.duration = Math.max(f.duration, skill.timeLeft); }
            }
          },
          onEnd({ battle, unit, reason }) {
            const H = unit.mem.hypothermia;
            unit.mem.hypothermia = null;
            if (!H || reason === 'death' || !unit.alive) return;
            // 技能结束时对所有冻结的敌人造成N%的法术伤害并结束冻结 (the frozen enemies of her range)
            const list = enemiesOnRange(battle, unit).filter(frozen);
            for (const id of H) { const e = battle.unitById(id); if (e && e.alive && frozen(e) && !list.includes(e)) list.push(e); }
            for (const e of list) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 3), type: 'arts', isSkill: true, tags: ['skill', 'shatter'] });
              if (e.alive) battle.removeStatus(e, 'freeze');
            }
            battle.fx('iceSpike', { x: unit.x, y: unit.y, id: unit.id, n: list.length });
          },
        }),
      }),
      install(battle, unit) {
        if (S3) {
          // 优先攻击未冻结的单位 (while S3 runs)
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillActive(unit)) return;
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile);
            for (const e of battle.blockedTargets(unit, c.profile)) if (!cands.includes(e)) cands.push(e); // DESIGN §20.3
            if (cands.length <= 1) return;
            sortEnemyTargets(battle, unit, cands, c.profile?.priority ?? null);
            const n = Math.max(1, Math.floor((c.profile?.maxTargets || 1) + unit.s.maxTargets));
            c.targets = [...cands.filter((e) => !frozen(e)), ...cands.filter(frozen)].slice(0, n);
          }, { owner: unit, priority: 5 });
        }
        const sp = num(tb.sp_recovery_per_sec, 0); // module UMD-Y
        if (sp > 0) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'gnosis:module', enemiesOnRange(battle, unit).some(isEliteEnemy), { spRecoveryFlat: sp }));
      },
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        onStart({ battle, unit, skill }) {
          const charged = skill.maxCharges > 1 && skill.charges + 1 >= skill.maxCharges; // cast with every charge stored
          for (const e of targetsInRange(battle, unit)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.3), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            if (!e.alive) continue;
            battle.applyStatus(e, 'cold', { duration: num(bb.cold, 2.5), source: unit });
            if (charged && e.alive) battle.applyStatus(e, 'cold', { duration: num(bb.cold, 2.5), source: unit });
          }
          battle.fx('frostNova', { x: unit.x, y: unit.y, id: unit.id, charged });
        },
      },
      talents: [
        { install(battle, unit) { // 坚冰: attacks chill 1 s; cold enemies in range fragile 25 %, frozen 50 %
          battle.on('damaged', (c) => {
            if (c.source === unit && c.dmg?.isAttack && !c.dmg.isSplash && c.target.side === 'enemy' && c.target.alive) battle.applyStatus(c.target, 'cold', { duration: num(t0.cold, 1), source: unit });
          }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => {
            for (const e of enemiesOnRange(battle, unit)) {
              const f = e.s.flags;
              const m = f.freeze ? num(t0.damage_scale_freeze, 1.5) : f.cold ? num(t0.damage_scale_cold, 1.25) : 0;
              // 同名效果取最高: one 坚冰 per enemy, the strongest — two 灵知 (a pair / 联防 partner's copy) never compound
              if (m) battle.applyStrongest(e, 'gnosis:fragile', { duration: 0.15, value: m, mods: (v) => ({ dmgTakenMul: v }), source: unit });
            }
          });
        } },
        { install(battle, unit) { // 殊途同归: 10 s after deployment every 谢拉格 operator gains 抵抗 (negative status durations ×0.5)
          // engine `resist` status (applied before a new status lands, so a longer one already running is never
          // shortened; 同名效果不叠加: several 灵知 — or 流明's 抵抗 — never compound)
          const value = Math.min(1, Math.max(0, -num(t1.one_minus_status_resistance, -0.5)));
          whileDeployed(battle, unit, AURA, () => {
            if (battle.time - unit.deployedAt < num(t1.interval, 10) - 1e-9 || !(value > 0)) return;
            for (const a of battle.allies(unit.ownerId)) if (a.kind === 'op' && nationOf(a) === 'kjerag') battle.applyStatus(a, 'resist', { duration: AURA_DUR, value, source: unit });
          });
        } },
      ],
    };
  },
});
