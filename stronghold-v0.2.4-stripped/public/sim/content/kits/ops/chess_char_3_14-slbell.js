// server/sim/content/kits/ops/chess_char_3_14-slbell.js — 初雪 (char_174_slbell) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, altSkills, aura } from '../shared/tier3.js';

export default {
  // ---- 3_14 初雪 · 削弱者 — S2 自然震慑: DEF/RES shred aura on every enemy in range; 虚弱化: low-HP enemies fragile;
  //      双响: 2 targets
  chess_char_3_14_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const mr = num(bb.magic_resistance, 0);
    const shred = { defPct: num(bb.def) };
    if (mr) {
      if (Math.abs(mr) < 1) shred.resMul = Math.max(0, 1 + mr);
      else shred.resFlat = mr;
    }
    const mt = Math.floor(num(t1['attack@max_target'], 1));
    const kit = {
      skill: {
        kind: 'duration',
        onStart({ battle, unit }) {
          if (!unit.mem.slbellAura) unit.mem.slbellAura = aura(battle, unit, { key: 'skill:slbell_shred', side: 'enemy', interval: 0, tiles: () => unit.rangeKeySet, mods: shred });
          unit.mem.slbellAura();
        },
        onTick({ unit }) { unit.mem.slbellAura?.(); },
        onEnd({ unit }) { unit.mem.slbellAura?.clear(); },
      },
      // S1 传音回响: 2 targets, every enemy in range ASPD + attack_speed (negative) while it runs
      skills: altSkills(chess, d, bb, {
        skchr_slbell_1: (s) => {
          const slow = { aspd: num(s.bb.attack_speed) };
          return {
            kind: 'duration',
            targeting: { maxTargets: Math.max(1, Math.floor(num(s.bb['attack@max_target'], num(s.bb.max_target, 1)))) },
            onStart({ battle, unit }) {
              if (!unit.mem.slbellSlow) unit.mem.slbellSlow = aura(battle, unit, { key: 'skill:slbell_aspd', side: 'enemy', interval: 0, tiles: () => unit.rangeKeySet, mods: slow });
              unit.mem.slbellSlow();
            },
            onTick({ unit }) { unit.mem.slbellSlow?.(); },
            onEnd({ unit }) { unit.mem.slbellSlow?.clear(); },
          };
        },
      }),
      talents: [{ install(battle, unit) {
        aura(battle, unit, {
          key: 'talent:weak_fragile', side: 'enemy', tiles: () => unit.rangeKeySet, filter: (e) => e.hpRatio < num(t0.hp_ratio, 0.4),
          mods: { dmgTakenMul: num(t0.damage_scale, 1) }, interval: 0.1,
        });
      } }],
    };
    if (mt > 1) kit.trait = { maxTargets: mt };
    return kit;
  },
};
