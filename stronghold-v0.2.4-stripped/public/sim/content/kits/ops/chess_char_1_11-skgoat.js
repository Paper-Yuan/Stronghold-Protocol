// server/sim/content/kits/ops/chess_char_1_11-skgoat.js — 地灵 (char_183_skgoat) kit, tier 1 (hidden).
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_11 地灵 (hidden) 攻击力强化·β型: ATK +atk. Elite 地质勘探: trait 停顿 +sluggish s (module trait 1.2 s included).
  chess_char_1_11_a: (bb, chess) => {
    const add = num(talentBb(chess, 0).sluggish);
    const kit = { skill: { kind: 'duration', mods: { atkPct: num(bb.atk) } } };
    if (add > 0) kit.trait = { onHitStatus: { key: 'sluggish', duration: num(traitBb(chess).sluggish, 0.8) + add } };
    return kit;
  },
};
