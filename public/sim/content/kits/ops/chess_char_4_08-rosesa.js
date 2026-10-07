// server/sim/content/kits/ops/chess_char_4_08-rosesa.js — 瑰盐 (char_4163_rosesa) kit, tier 4 (hidden).
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import {
  AURA, num, tbb, batFlat, keySet, whileDeployed, pulse, skillActive, applyModuleRange, withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 瑰盐 (ringhealer, hidden) S2 绝妙的长效药呀 — allies in range: 20 % of phys/arts damage → 5 s HP loss
  chess_char_4_08_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const scale = num(bb['attack@damage_scale'], 0.8), fin = num(bb['attack@final_duration'], 5), iv = Math.max(0.1, num(bb['attack@interval'], 1));
    return {
      skill: { kind: 'duration', heal: true, mods: { batPct: batFlat(def, bb.base_attack_time) },
        onStart({ battle, unit }) { battle.fx('saltWard', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { // 最好的草药医生: own ATK −5 %, operators in range receive +15 % healing
        battle.addBuff(unit, { key: 'rosesa:t1', mods: { atkPct: num(t0.atk, -0.05) }, persist: true, allowDead: true });
        whileDeployed(battle, unit, AURA, () => {
          for (const a of battle.alliesInGrid(unit)) if (a.kind === 'op') pulse(battle, a, `rosesa:heal:${unit.id}`, { healingTakenMul: num(t0.heal_scale, 1.15) });
        });
      } }],
      install(battle, unit) {
        const deferred = new WeakSet();
        battle.on('hit', (c) => {
          const t = c.target;
          // "友方干员": operators only (summons/devices keep the full hit)
          if (!skillActive(unit) || !unit.alive || t.side !== 'ally' || t.kind !== 'op' || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
          if (!keySet(unit).has(t.tileR * COLS + t.tileC)) return;
          c.dmg.mul *= scale;
          deferred.add(c.dmg);
        }, { owner: unit, priority: -5 });
        battle.on('damaged', (c) => {
          if (!deferred.has(c.dmg) || !(c.amount > 0) || !c.target.alive) return;
          deferred.delete(c.dmg);
          const total = (c.amount * (1 - scale)) / Math.max(1e-6, scale);
          const per = total / Math.max(1, Math.round(fin / iv));
          const src = c.source;
          battle.addBuff(c.target, { key: 'rosesa:dot', refresh: 'independent', maxStacks: 1000, duration: fin + 1e-6, interval: iv,
            onTick: ({ unit: tgt }) => battle.loseHp(tgt, per, { source: src && src.side === 'enemy' ? src : null }) });
        }, { owner: unit });
        // module (elite) RIN-X: 攻击范围扩大 (module range grid)
        applyModuleRange(battle, unit, def);
      },
    };
  },
});
