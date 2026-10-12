// server/sim/content/kits/ops/chess_char_4_21-plosis.js — 白面鸮 (char_128_plosis) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { num, tbb, grid, batFlat, spAura, alt, applyModuleRange, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 白面鸮 (ringhealer) S2 脑啡肽 — wider range, much faster heals; talent 技力光环 (+0.3 SP/s to all allies)
  chess_char_4_21_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, { 'skcom_heal_up[3]': () => ({ kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } }) }), // S1 治疗强化·γ型
      skill: { kind: 'duration', heal: true, mods: { batPct: batFlat(def, bb.base_attack_time) }, targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) { battle.fx('healField', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec, 0.3), (a) => a.kind !== 'device'); } }],
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module RIN-X (elite default): 攻击范围扩大
    };
  },
});
