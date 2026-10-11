// server/sim/content/kits/ops/chess_char_1_03-leizi.js — 惊蛰 (char_306_leizi) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { CHAIN_RADIUS } from '../../../constants.js';
import { num, talentBb, traitBb, onHitBy, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_03 惊蛰 初雷: ATK +atk, chain jumps lose no damage. 通流无阻: vs unblocked enemies ATK ×atk_scale (every jump).
  // Alternate S1 攻击力强化·γ型: ATK +atk (the chain keeps its falloff). Elite module CHA-X (4 jumps, −10 %, 0.8 s 停顿)
  // is the chain profile of the module trait (professions.js TUNE.chain).
  chess_char_1_03_a: (bb, chess) => {
    const scale = num(talentBb(chess, 0).atk_scale, 1);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: {} },
      skills: { 'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, 'skcom_atk_up[3]').atk) } } },
      talents: [{ install(battle, unit) {
        if (scale !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && !target.blockedBy) dmg.amount *= scale; });
      } }],
      install(battle, unit) {
        // the chain shape (count / sluggish, elite module included) comes from the resolved chain profile
        const ch = unit.profile.chain || { count: num(traitBb(chess)['attack@max_target'], 3), radius: CHAIN_RADIUS, sluggish: num(traitBb(chess)['attack@sluggish'], 0.5) };
        if (unit.skill && unit.skill.spec.attack) unit.skill.spec.attack.chain = { ...ch, falloff: 0 };
      },
    };
  },
};
