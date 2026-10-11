// server/sim/content/kits/ops/chess_char_3_15-vodfox.js — 巫恋 (char_254_vodfox) kit, tier 3 (hidden).
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { releaseSkillSummon } from '../../tokens.js';
import { num, defOf, talentBb, aura } from '../shared/tier3.js';

export default {
  // ---- 3_15 巫恋 · 削弱者 (hidden) — S2 诅咒娃娃 "获得一个诅咒娃娃（最多可库存1个）": the doll is a hand piece the player
  //      places (user playtest #6; PRTS 卫戍协议/帮助); each cast gives one and the placed piece takes the field on its
  //      own tile (tokens.js releaseSkillSummon: not at the battle start; not placed ⇒ no doll); its token kit keeps the
  //      3×3 ATK/DEF aura (the token skill's bb) for 15 s; 溃败暗示: low-HP enemies fragile
  chess_char_3_15_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tokenId = chess?.skill?.overrideTokenKey ?? (d.tokens || []).find((t) => /doll/.test(String(t))) ?? 'token_10006_vodfox_doll';
    return {
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) { releaseSkillSummon(battle, unit, tokenId); },
      },
      talents: [{ install(battle, unit) {
        aura(battle, unit, {
          key: 'talent:weak_fragile', side: 'enemy', tiles: () => unit.rangeKeySet, filter: (e) => e.hpRatio < num(t0.hp_ratio, 0.4),
          mods: { dmgTakenMul: num(t0.damage_scale, 1) }, interval: 0.1,
        });
      } }],
    };
  },
};
