// server/sim/content/kits/ops/chess_char_3_03-swire.js — 诗怀雅 (char_308_swire) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, altSkills, gridKeys, copyGrid, NINE, aura } from '../shared/tier3.js';

export default {
  // ---- 3_03 诗怀雅 · 教官 — S2 协同作战: ATK +, first talent ×talent_scale; 近距离作战指导 melee ATK aura
  //      S1 指挥调度: the talent covers the skill's range (x-1 normal / x-2 elite) at ×talent_scale while it runs
  chess_char_3_03_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? NINE;
    const scale = num(bb.talent_scale, 1);
    // "第一天赋生效范围扩大" (talent_range_flag): the selected skill's range replaces the talent's while it is active
    const skillTGrid = num(bb.talent_range_flag) > 0 ? copyGrid(d.skill?.rangeGrid) : null;
    const refresh = ({ unit }) => unit.mem.swireAura?.();
    return {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        onStart: refresh,
        onEnd: refresh,
      },
      skills: altSkills(chess, d, bb, {
        skchr_swire_1: () => ({ kind: 'duration', onStart: refresh, onEnd: refresh }),
      }),
      talents: [{ install(battle, unit) {
        unit.mem.swireAura = aura(battle, unit, {
          key: 'talent:swire_guide', side: 'ally', tiles: () => gridKeys(skillTGrid && unit.skill?.active ? skillTGrid : tGrid, unit),
          filter: (a) => String(a.def?.position ?? 'MELEE').toUpperCase() === 'MELEE',
          mods: () => ({ atkPct: num(t0.atk) * (unit.skill?.active ? scale : 1) }),
        });
      } }],
    };
  },
};
