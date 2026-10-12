// server/sim/content/kits/ops/chess_char_1_05-vigna.js — 红豆 (char_290_vigna) kit, tier 1 (hidden).
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, onHitBy, batMod } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_05 红豆 (hidden) 槌音: base attack time +base_attack_time s, ATK +atk. 蛮力穿刺: each attack prob1 (prob2 while the skill
  // runs) for ATK +atk on that attack. Elite module (CHG-Y): vs enemies below hp_ratio HP, ATK ×atk_scale.
  chess_char_1_05_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) } },
      talents: [{ install(battle, unit) {
        const key = 'vigna:proc';
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit) return;
          const p = unit.skill?.active ? num(t.prob2) : num(t.prob1);
          if (p > 0 && battle.rng.chance(p)) {
            battle.addBuff(unit, { key, duration: 0.1, mods: { atkPct: num(t.atk) } });
            battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
          }
        }, { owner: unit });
        // melee hits resolve synchronously inside the attack: the one-attack buff is dropped right after it
        battle.on('attack', (ctx) => { if (ctx.attacker === unit && unit.findBuff(key)) battle.removeBuff(unit, key); }, { owner: unit });
        if (tb.hp_ratio != null && num(tb.atk_scale, 1) !== 1) {
          onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.hpRatio < num(tb.hp_ratio)) dmg.amount *= num(tb.atk_scale, 1); });
        }
      } }],
    };
  },
};
