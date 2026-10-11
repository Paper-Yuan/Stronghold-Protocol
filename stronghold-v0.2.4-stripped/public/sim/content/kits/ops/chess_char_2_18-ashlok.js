// server/sim/content/kits/ops/chess_char_2_18-ashlok.js — 灰毫 (char_431_ashlok) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, onHitBy, batMod } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_18 灰毫 攻击力强化·γ型 (DEFAULT, like S2: the owner's deliberate deviation from the 重装 TAKE_DAMAGE row, data
  // TRIGGER_DEVIATIONS, DESIGN §21.29): ATK +atk. 炮术研习: ATK +atk, or +ashlok_t_1.atk when the `cnt` orthogonal
  // tiles around her are all ground (LOW). Elite module (FOR-X, trait atk_scale): vs blocked enemies ATK ×atk_scale.
  // S2 专注轰击 (alt): block count 0 (noBlock: releases what she holds), only ranged (splash) attacks, base attack time
  // +base_attack_time s (−0.4 / −0.5 on 2.8), ATK +atk.
  chess_char_2_18_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) } },
      skills: {
        skchr_ashlok_2: {
          kind: 'duration', mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) }, flags: { noBlock: true },
          attack: { fortress: false, _fortressMelee: false },
        },
      },
      talents: [{ install(battle, unit) {
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          const r = unit.tileR, c = unit.tileC;
          const low = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => battle.grid.isLow(r + dr, c + dc)).length;
          const ground = low >= num(t.cnt, 4);
          const v = ground ? num(t['ashlok_t_1.atk'], num(t.atk)) : num(t.atk);
          if (v) battle.addBuff(unit, { key: 'talent:ashlok', mods: { atkPct: v }, data: { ground }, tags: ['talent'] });
        }, { owner: unit });
        if (num(tb.atk_scale, 1) !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.blockedBy) dmg.amount *= num(tb.atk_scale, 1); });
      } }],
    };
  },
};
