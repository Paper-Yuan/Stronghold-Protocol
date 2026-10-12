// server/sim/content/kits/ops/chess_char_2_14-flower.js — 调香师 (char_181_flower) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, moduleBb, up } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_14 调香师 精调: ASPD +attack_speed (−50), ATK +atk. 熏衣草: every ally on the field recovers
  // atk_to_hp_recovery_ratio × ATK HP per second — PRTS 天赋备注 "生命恢复的提供方式为增加目标的“生命回复速度”属性（直接加算），
  // 不受治疗加成和禁疗影响": an hpRegen buff, no heal, so 无法被友方治疗 (折桠, 收割者) and 禁疗 units get it too (GitHub #137).
  // Elite module (RIN-Y, hidden attack@max_target): heals 4 allies.
  // S1 治疗强化·β型 (alt): ATK +atk for its duration.
  chess_char_2_14_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const cnt = Math.floor(num(moduleBb(chess)['attack@max_target']));
    return {
      trait: cnt > 0 ? { heal: { mode: 'multi', count: cnt } } : undefined,
      skill: { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } },
      skills: { 'skcom_heal_up[2]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        const r = num(t.atk_to_hp_recovery_ratio);
        if (!(r > 0)) return;
        // one buff per 调香师 (直接加算: two add up), refreshed while she is on the field; it lapses 0.5 s after she leaves
        const key = `flower:lavender:${unit.id}`;
        battle.every(0.25, () => {
          if (!up(unit)) return;
          const v = unit.s.atk * r;
          for (const a of battle.alliesFor(unit)) battle.addBuff(a, { key, duration: 0.5, source: unit, mods: { hpRegen: v }, tags: ['talent'] });
        }, { owner: unit });
      } }],
    };
  },
};
