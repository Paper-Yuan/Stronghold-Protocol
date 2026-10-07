// server/sim/content/kits/ops/chess_char_1_14-greyy.js — 格雷伊 (char_253_greyy) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_14 格雷伊 静电释放: ASPD +attack_speed, the talent 停顿 lasts talent_scale × longer.
  // 静电场: attacks cause `sluggish` s of 停顿 to the attacked target.
  // Alternate S1 战术咏唱·β型: ASPD +attack_speed (the talent 停顿 keeps its length). Elite module SPC-Y: cost only.
  chess_char_1_14_a: (bb, chess) => {
    const sl = num(talentBb(chess, 0).sluggish);
    return {
      skills: { 'skcom_magic_rage[2]': { kind: 'duration', mods: { aspd: num(skillBbOf(chess, 'skcom_magic_rage[2]').attack_speed) } } },
      trait: sl > 0 ? { onHitStatus: { key: 'sluggish', duration: sl } } : undefined,
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        attack: sl > 0 ? { onHitStatus: { key: 'sluggish', duration: sl * num(bb.talent_scale, 1) } } : {},
      },
    };
  },
};
