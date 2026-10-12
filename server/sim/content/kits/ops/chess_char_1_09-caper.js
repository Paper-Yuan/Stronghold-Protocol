// server/sim/content/kits/ops/chess_char_1_09-caper.js — 跃跃 (char_4100_caper) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, cheb, onHitBy, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_09 跃跃 (回环射手: every attack is a boomerang out to the target and back — she attacks again only once it is
  // caught, professions.js loopshooter / ai.js throwBoomerang). 乐趣加倍: ATK +atk, each attack throws `cnt`
  // boomerangs at the target (cnt hits); they fly the same path, so the flight carries cnt hits and all of them are
  // back together ("必须回收全部回旋投掷物才可以进行下一次攻击"). 戏耍随心: prob per hit (each boomerang on its own) for
  // ATK ×atk_scale. Elite module (LPS-X, trait atk_scale): vs enemies on the 8 surrounding tiles ATK ×atk_scale.
  // Alternate S1 强力击·β型 (AUTO, attack SP): the next attack at atk_scale × ATK.
  chess_char_1_09_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const near = num(traitBb(chess).atk_scale, 1);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: { hits: Math.max(1, Math.floor(num(bb.cnt, 1))) } },
      skills: { skchr_caper_1: { kind: 'instant', attack: { atkScale: num(skillBbOf(chess, 'skchr_caper_1').atk_scale, 1) } } },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          if (near !== 1 && cheb(unit, target) <= 1) dmg.amount *= near;
          if (!dmg.isSplash && num(t.prob) > 0 && battle.rng.chance(num(t.prob))) {
            dmg.amount *= num(t.atk_scale, 1);
            battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
          }
        });
      } }],
    };
  },
};
