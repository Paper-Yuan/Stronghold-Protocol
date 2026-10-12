// server/sim/content/kits/ops/chess_char_4_03-kjera.js — 耶拉 (char_4013_kjera) kit, tier 4 (hidden).
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { canTargetEnemy } from '../../../targeting.js';
import { num, tbb, skillActive, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 耶拉 (funnel, hidden) S2 心随意动 — +1 drone locking targets, ATK up, chance to chill; talent 低眉
  chess_char_4_03_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const n = 1 + Math.max(0, Math.floor(num(bb['attack@cnt'], 1)));
    const prob = num(bb['attack@prob'], 0), cold = num(bb['attack@cold'], 0);
    const funnel = (unit) => unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
    return {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        targeting: { maxTargets: n },
        attack: {
          // every drone ramps on its own locked target (trait init/delta/max): the multipliers are queued per target
          // by the beforeAttack hook below (two drones on the same enemy ramp independently)
          dmgMul: (battle, unit, target) => {
            const q = unit.mem.kjeraQueue && unit.mem.kjeraQueue.get(target.id);
            return q && q.length ? q.shift() : funnel(unit).init;
          },
          onHit({ battle, unit, target }) {
            if (target && target.alive && cold > 0 && battle.rng.chance(prob)) battle.applyStatus(target, 'cold', { duration: cold, source: unit });
          },
        },
        onStart({ battle, unit }) { unit.mem.kjeraDrones = []; unit.mem.kjeraQueue = new Map(); battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n }); },
        onEnd({ unit }) { unit.mem.kjeraDrones = []; unit.mem.kjeraQueue = null; },
      },
      talents: [{ install(battle, unit) { // 低眉: ATK +10 %, +16 % with ≥ 2 ground tiles in range
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          let low = 0;
          for (const k of unit.rangeKeys || []) if (battle.grid.isLow((k / COLS) | 0, k % COLS)) low++;
          const v = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'kjera:t1', mods: { atkPct: v } });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // n drones, each locked on its enemy until that enemy dies (while at least one enemy is in her range). A free
        // drone takes an enemy no other drone holds, else doubles up on the best target (a lone enemy/boss gets both).
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || !skillActive(unit)) return;
          const ok = (e) => !!e && e.alive && canTargetEnemy(unit, e, { canHitFly: true });
          const cands = c.targets.filter(ok);
          const drones = unit.mem.kjeraDrones || (unit.mem.kjeraDrones = []);
          const held = new Set();
          for (let i = 0; i < n; i++) { if (drones[i] && ok(drones[i].e)) held.add(drones[i].e); else drones[i] = null; }
          for (let i = 0; i < n; i++) {
            if (drones[i]) continue;
            const e = cands.find((x) => !held.has(x)) ?? cands[0] ?? drones.find((d) => d)?.e;
            if (!e) continue;
            held.add(e);
            drones[i] = { e, scale: null };
          }
          const f = funnel(unit);
          const q = unit.mem.kjeraQueue || (unit.mem.kjeraQueue = new Map());
          const out = [];
          for (const d of drones) {
            if (!d) continue;
            d.scale = d.scale == null ? f.init : Math.min(f.max, d.scale + f.delta);
            out.push(d.e);
            const l = q.get(d.e.id);
            if (l) l.push(d.scale); else q.set(d.e.id, [d.scale]);
          }
          if (out.length) c.targets = out;
        }, { owner: unit, priority: 10 });
        // queued multipliers of shots that never landed (target died mid-flight) are dropped with the target
        battle.on('death', (c) => { if (c.unit.side === 'enemy' && unit.mem.kjeraQueue) unit.mem.kjeraQueue.delete(c.unit.id); }, { owner: unit });
      },
    };
  },
});
