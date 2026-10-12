// server/sim/content/kits/ops/chess_char_5_04-bldsk.js — 华法琳 (char_171_bldsk) kit, tier 5 (hidden).
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { HALF_HP, NEVER, num, on, inRange, talent, traitBb, lowHpHealUp } from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 华法琳 — S1 紧急包扎 (charges, attack SP): the next heal on a target below half HP adds hp_ratio × its max HP.
  // T1 血液样本回收: an enemy dying in range → +2 SP to herself and to a random ally in range.
  // Module (elite): heals on allies below 50 % ×1.15.
  chess_char_5_04_a: (bb, chess) => {
    const t0 = talent(chess, 0), tb = traitBb(chess);
    const ratio = num(bb.hp_ratio);
    return {
      skill: {
        kind: 'charges', heal: true, trigger: NEVER,
        onStart({ unit }) { unit.mem.bldskBonus = unit.mem.bldskTarget ?? null; },
      },
      talents: [{ install(battle, unit) { // 血液样本回收
        battle.on('kill', (c) => {
          const v = c.victim;
          if (v.side !== 'enemy' || !on(unit) || !inRange(unit, v)) return;
          unit.skill?.gainSp(num(t0['bldsk_t_1[self].sp']), 'talent');
          const others = battle.alliesInGrid(unit).filter((a) => a !== unit && a.skill && !a.skill.noSkill && a.skill.kind !== 'passive');
          const pick = battle.rng.pick(others);
          if (pick) pick.skill.gainSp(num(t0['bldsk_t_1[rand].sp']), 'talent');
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // the skill only fires for a heal target below half HP: checked right before the heal
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit) return;
          unit.mem.bldskNoSp = false;
          const sk = unit.skill;
          if (!sk || !sk.ready || unit.s.flags.silence) return;
          const t = c.targets[0];
          if (!t || t.side !== 'ally' || !(t.hpRatio < HALF_HP)) return;
          unit.mem.bldskTarget = t;
          // the heal made by the skill recovers no attack SP (engine rule for skill attacks: cost N ⇒ every N+1 heals)
          if (sk.activate('DEFAULT')) unit.mem.bldskNoSp = true;
          unit.mem.bldskTarget = null;
        }, { owner: unit });
        battle.on('spGain', (c) => {
          if (c.unit !== unit || c.reason !== 'attack' || !unit.mem.bldskNoSp) return;
          unit.mem.bldskNoSp = false;
          c.amount = 0;
        }, { owner: unit, priority: 100 });
        battle.on('heal', (c) => { // merged into the same heal
          if (c.source !== unit || c.opts?.regen || !unit.mem.bldskBonus || c.target !== unit.mem.bldskBonus) return; // (not her own 生命回复速度 tick)
          unit.mem.bldskBonus = null;
          // the bonus is part of the same heal: the healer's and the target's healing multipliers apply to it too
          c.amount += c.target.s.maxHp * ratio * num(unit.s.healingDealtMul, 1) * num(c.target.s.healingTakenMul, 1);
          battle.fx('healAoe', { x: c.target.x, y: c.target.y, id: c.target.id, r: 0.5 });
        }, { owner: unit, priority: 10 });
        lowHpHealUp(battle, unit, tb, { atOrBelow: true });   // PHY-X: heal_scale_up[hpratio][LE] (≤)
      },
    };
  },
};
