// server/sim/content/kits/ops/chess_char_4_14-lionhd.js — 莱恩哈特 (char_373_lionhd) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  num, tbb, grid, targetsInRange, whileDeployed, toggleBuff, resCut, alt, applyModuleRange, withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 莱恩哈特 (splashcaster) S2 解构与爆破 — charges: 170 % arts to all in the wider range + RES −8 % for 6 s; 破片杀伤
  chess_char_4_14_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const g = grid(def.skill?.rangeGrid);
    const mr = num(bb.magic_resistance, 0);
    return {
      skills: alt(def, { 'skcom_atk_up[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }) }), // S1 攻击力强化·γ型
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) {
          for (const e of targetsInRange(battle, unit)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.7), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            // 同名效果取最高: one RES cut per enemy (the strongest), never one per 莱恩哈特
            if (e.alive && mr) battle.applyStrongest(e, 'lionhd:res', { duration: num(bb.duration, 6), value: mr, mods: resCut, source: unit });
          }
          battle.fx('explosion', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [{ install(battle, unit) { // 破片杀伤: ATK +4 % per enemy in range (≤ 5)
        whileDeployed(battle, unit, 0.1, () => {
          const n = Math.min(num(t0.max_valid_stack_cnt, 5), targetsInRange(battle, unit).length);
          toggleBuff(battle, unit, 'lionhd:t1', n > 0, { atkPct: num(t0.atk, 0.04) * n });
        });
      } }],
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module SPC-X (elite default): 攻击范围扩大
    };
  },
});
