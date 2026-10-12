// server/sim/content/kits/ops/chess_char_1_02-yak.js — 角峰 (char_199_yak) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, statBuff, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_02 角峰 抗寒体质: HP +max_hp, DEF +def, RES ×(1+magic_resistance). 雪原卫士: RES +magic_resistance (flat).
  // Alternate S1 体能强化 (重装 ⇒ TAKE_DAMAGE trigger from data): HP +max_hp, +hp_recovery_per_sec HP per second
  // (the 生命回复速度 attribute). Elite module PRO-Y (block 4) is a stat of the module (attr blockCnt).
  chess_char_1_02_a: (bb, chess) => {
    const s1 = skillBbOf(chess, 'skchr_yak_1');
    return {
      skill: { kind: 'duration', mods: { hpPct: num(bb.max_hp), defPct: num(bb.def), resMul: 1 + num(bb.magic_resistance) } },
      skills: { skchr_yak_1: { kind: 'duration', mods: { hpPct: num(s1.max_hp), hpRegen: num(s1.hp_recovery_per_sec) } } },
      talents: [{ install(battle, unit) { statBuff(battle, unit, 'talent:yak', { resFlat: num(talentBb(chess, 0).magic_resistance) }); } }],
    };
  },
};
