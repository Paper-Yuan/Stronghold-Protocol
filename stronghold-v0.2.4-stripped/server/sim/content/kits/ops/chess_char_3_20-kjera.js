// server/sim/content/kits/ops/chess_char_3_20-kjera.js — 耶拉 (char_4013_kjera) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { num, defOf, talentBb, altSkills, statSkill, funnelMap, installFunnelPrune } from '../shared/tier3.js';

export default {
  // ---- 3_20 耶拉 · 驭械术师 — S2 心随意动: +1 drone (2 locks; a lone enemy gets both), ATK +, cold procs; 低眉: ATK +
  //      (more with ≥cnt ground tiles in range)
  chess_char_3_20_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const extra = Math.floor(num(bb['attack@cnt'], 0));
    const prob = num(bb['attack@prob'], 0), cold = num(bb['attack@cold'], 0);
    const kit = {
      trait: { dmgMul: funnelMap },
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        attack: { onHit({ battle, unit, target }) {
          if (target && target.alive && cold > 0 && battle.rng.chance(prob)) battle.applyStatus(target, 'cold', { duration: cold, source: unit });
        } },
      },
      // S1 攻击力强化·γ型: ATK + (one drone, the trait ramp as usual)
      skills: altSkills(chess, d, bb, { 'skcom_atk_up[3]': statSkill }),
      install(battle, unit) {
        installFunnelPrune(battle, unit);
        // "浮游单元+1": every drone locks an enemy — with fewer enemies in range than drones, the spare drone joins a
        // lock (both attack it, each hit rolls the cold proc; they ramp in parallel, see funnelMap)
        if (extra > 0) {
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !unit.skill?.active || !ctx.targets.length) return;
            const n = 1 + extra;
            if (ctx.targets.length >= n) return;
            const base = ctx.targets.slice();
            const out = base.slice();
            for (let i = 0; out.length < n; i++) out.push(base[i % base.length]);
            ctx.targets = out;
          }, { owner: unit, priority: -50 });
        }
      },
      talents: [{ install(battle, unit) {
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit) return;
          let low = 0;
          for (const k of unit.baseRangeKeys || []) {
            const r = (k / COLS) | 0, c = k % COLS;
            if (battle.grid.inRect(r, c) && battle.grid.isLow(r, c)) low++;
          }
          const atk = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'talent:kjera_brow', mods: { atkPct: atk } });
        }, { owner: unit });
      } }],
    };
    if (extra > 0) kit.skill.targeting = { maxTargets: 1 + extra };
    return kit;
  },
};
