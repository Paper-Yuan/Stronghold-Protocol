// server/sim/content/kits/ops/chess_char_4_11-cathy.js — 凯瑟琳 (char_4162_cathy) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { CAT_SHIELD_KEY } from '../../tokens.js';
import { AURA, num, whileDeployed, pulse, alt, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 凯瑟琳 (craftsman) S2 战火淬炼 — stops attacking, HP/DEF up, devices give 6 %/s shields; talent 定向支援信号
  //       "携带3个支援装置（最多部署2个）": the 爬行号·防护单元 are hand pieces (2 = the deploy limit) the player places and
  //       turns towards an operator (user playtest #6, PRTS 卫戍协议/帮助 §战斗部署); they deploy with the board and the
  //       token kit (tokens.js catShield) gives the shields — S2 overwrite_ratio per second while this skill runs — so
  //       this kit places nothing (none placed ⇒ no device).
  //       S1 岁月锻打 (passive: she and every other operator holding a device shield ATK/DEF +8 %/+11 %); module CRA-X
  //       carries one more device (talent cnt, data — a spare the hand never shows)
  chess_char_4_11_a: (bb, chess, def) => ({
    skills: alt(def, {
      skchr_cathy_1: () => ({
        kind: 'passive',
        mods: { atkPct: num(bb.s1_atk), defPct: num(bb.s1_def) },
        onStart({ battle, unit }) {
          unit.mem.forgeAura?.cancel();
          unit.mem.forgeAura = whileDeployed(battle, unit, AURA, () => {
            for (const a of battle.allies(unit.ownerId)) {
              if (a === unit || a.kind !== 'op' || !a.findBuff(CAT_SHIELD_KEY)) continue;
              pulse(battle, a, `cathy:forge:${unit.id}`, { atkPct: num(bb.s1_atk), defPct: num(bb.s1_def) });
            }
          });
        },
      }),
    }),
    skill: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp), defPct: num(bb.def) },
      attack: { noAttack: true },
      onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
    },
  }),
});
