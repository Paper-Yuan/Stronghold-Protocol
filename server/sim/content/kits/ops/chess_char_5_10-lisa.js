// server/sim/content/kits/ops/chess_char_5_10-lisa.js — 铃兰 (char_358_lisa) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { AURA_IV, AURA_DUR, num, talent, skillGrid, mods, isOp, lazySkills, whileOn, spAura } from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 铃兰 — S3 狐火渺然 (27/29 s): no attacks, skill range, every enemy in range is sluggish, allies in range recover 9/11 %
  // ATK per second, T2 ×scale_delta_to_one. PRTS 技能3 备注: "生命恢复的提供方式为基于铃兰的攻击力增加目标的“生命回复速度”
  // 属性，不受治疗加成和禁疗影响" and "技能开启第一秒内提供生命回复为0，生命回复速度数额每秒刷新一次" — an hpRegen buff (no heal:
  // 无法被友方治疗 / 禁疗 units get it too), set at each full second of the skill on the allies then in range, none in the
  // first second, removed when the skill ends. T1 技力光环·辅助: Supporters +0.4 SP/s (highest wins).
  // T2 画地为牢: sluggish enemies in range also take +20 % damage for the same time. Module (elite): +0.2 SP/s with an
  // enemy in range.
  chess_char_5_10_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const boost = num(bb.scale_delta_to_one, 1);
    const healRatio = num(bb['attack@atk_to_hp_recovery_ratio']);
    const fragile = num(t1.damage_scale, 1) - 1;
    const foxKey = (unit) => `lisa:fox:${unit.id}`;
    return {
      // S1 全力以赴 (duration): ATK +, ASPD +. S2 儿时的舞乐 (toggle, 持续时间无限): ATK +, 2 targets.
      skills: lazySkills({
        skchr_lisa_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }) }),
        skchr_lisa_2: () => ({ kind: 'toggle', mods: mods({ atkPct: num(bb.atk) }), targeting: { maxTargets: Math.max(1, num(bb['attack@max_target'], 2)) } }),
      }),
      skill: {
        kind: 'duration',
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { noAttack: true },
        onStart({ unit }) { unit.mem.foxSlow = AURA_IV; unit.mem.foxHeal = 0; },
        onTick({ battle, unit, dt }) {
          unit.mem.foxSlow += dt;
          if (unit.mem.foxSlow >= AURA_IV) {
            unit.mem.foxSlow = 0;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) battle.applyStatus(e, 'sluggish', { duration: AURA_DUR, source: unit });
          }
          unit.mem.foxHeal += dt;
          if (unit.mem.foxHeal >= 1) {
            unit.mem.foxHeal -= 1;
            if (!(healRatio > 0)) return;
            // until the next refresh (a little longer, so it never lapses in between; onEnd takes it off)
            const v = unit.s.atk * healRatio;
            for (const a of battle.alliesInGrid(unit)) battle.addBuff(a, { key: foxKey(unit), duration: 1.25, source: unit, mods: { hpRegen: v } });
          }
        },
        onEnd({ battle, unit }) {
          for (const a of battle.allyUnits) if (a.findBuff(foxKey(unit))) battle.removeBuff(a, foxKey(unit));
        },
      },
      talents: [
        { install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec), (a) => isOp(a) && a.def?.profession === 'SUPPORT'); } },
        { install(battle, unit) { // 画地为牢 — PRTS 备注: an aura; every enemy in her range that is 停顿 (whoever caused it)
          // carries the talent's 脆弱 while it stays 停顿 and in range. It is the standard 脆弱 status (same-name: highest wins).
          if (!(fragile > 0)) return;
          whileOn(battle, unit, AURA_IV, () => {
            const v = fragile * (unit.skill?.active ? boost : 1);
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
              if (e.alive && e.findBuff('sluggish')) battle.applyStatus(e, 'fragile', { duration: AURA_DUR, value: v, source: unit });
            }
          });
        } },
      ],
      install(battle, unit) { // module
        const sp = num(tm.sp_recovery_per_sec);
        if (!chess?.isGolden || !(sp > 0)) return;
        whileOn(battle, unit, AURA_IV, () => {
          if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length) battle.addBuff(unit, { key: 'lisa:module', duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
        });
      },
    };
  },
};
