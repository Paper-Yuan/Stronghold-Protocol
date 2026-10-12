// server/sim/content/kits/ops/chess_char_5_16-plosis.js — 白面鸮 (char_128_plosis) kit, tier 5 (hidden).
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { num, talent, skillGrid, batPct, mods, spAura, moduleRangeUp } from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 白面鸮 — ringhealer. S2 脑啡肽 (33/36 s): skill range, BAT −1.8/−1.9 s. T1 技力光环: all allies +0.3 SP/s (highest
  // wins). Module (elite): 攻击范围扩大.
  chess_char_5_16_a: (bb, chess, def) => {
    const t0 = talent(chess, 0);
    return {
      skill: {
        kind: 'duration', heal: true,
        mods: mods({ batPct: batPct(bb.base_attack_time, chess) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
      },
      talents: [{ install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec), () => true); } }],
      install(battle, unit) { moduleRangeUp(battle, unit, chess); },
    };
  },
};
