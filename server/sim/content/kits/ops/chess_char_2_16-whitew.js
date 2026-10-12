// server/sim/content/kits/ops/chess_char_2_16-whitew.js — 拉普兰德 (char_140_whitew) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, onHitOn } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_16 拉普兰德 狼魂 (AUTO, attack SP): ATK +atk, arts damage, one extra target, ranged attacks no longer reduced.
  // 精神摧毁: attacks disable the target's abilities (silence) for `duration` s. Elite module (LOR-X, trait
  // atk_scale_m): attacks add atk_scale_m × ATK arts damage.
  // S1 日晷 (alt, attack SP, 持续时间无限 ⇒ toggle until she falls): ATK +atk and a `prob` chance to block (抵挡: the
  // damage instance is negated) each physical damage an enemy deals her.
  chess_char_2_16_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const trait = {};
    if (num(t.duration) > 0) trait.onHitStatus = { key: 'silence', duration: num(t.duration) };
    if (num(tb.atk_scale_m) > 0) {
      trait.afterHit = (battle, u, target) => {
        // PRTS 特性备注 "造成预计算的法术附加伤害": 附加伤害 (tag addition — no 叙拉古 6 roll)
        if (target && target.alive && target.side === 'enemy') battle.dealDamage(u, target, { amount: u.s.atk * num(tb.atk_scale_m), type: 'arts', tags: ['module', 'addition'] });
      };
    }
    return {
      trait,
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, targeting: { maxTargets: 2 }, attack: { dmgType: 'arts', dmgMul: () => 1 } },
      skills: {
        skchr_whitew_1: {
          kind: 'toggle', mods: { atkPct: num(bb.atk) },
          onStart({ battle, unit, skill }) {
            if (unit.mem.sundial) battle.off(unit.mem.sundial);
            const p = num(bb.prob);
            unit.mem.sundial = p > 0 ? onHitOn(battle, unit, ({ source, credit, dmg }) => { // 抵挡 is target-side: a 无来源 burst counts via its credit
              const src = source || credit;
              if (!skill.active || dmg.cancel || dmg.type !== 'phys' || !src || src.side !== 'enemy') return;
              if (battle.rng.chance(p)) { dmg.cancel = true; battle.fx('block', { x: unit.x, y: unit.y, id: unit.id }); }
            }, 5) : null;
          },
          onEnd({ battle, unit }) {
            if (unit.mem.sundial) battle.off(unit.mem.sundial);
            unit.mem.sundial = null;
          },
        },
      },
    };
  },
};
