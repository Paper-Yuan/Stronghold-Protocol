// server/sim/content/kits/ops/chess_char_2_03-slchan.js — 崖心 (char_173_slchan) kit, tier 2 (hidden).
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, enemiesInGrid, toggleBuff } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_03 崖心 (hidden) 束缚链: up to max_target enemies in the large front grid are dragged (force 1 = 中力; Battle.pullToFront:
  // the official 力度 − 重量 pull — weight ≤ 1 all the way in front of her, 2 a third of the way, 3 barely, ≥ 4 not at all),
  // take atk_scale × ATK true damage and are stunned `stun` s. 雪境猎手: ATK/DEF +atk/+def while not blocking.
  // Elite module (HOK-X, trait value/dist): dragged enemies take `value` arts per `dist` tiles travelled.
  chess_char_2_03_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const force = num(bb.force, 1);
    return {
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const foes = enemiesInGrid(battle, unit, def?.skill?.rangeGrid ?? null, { n: Math.max(1, Math.floor(num(bb.max_target, 1))) });
          for (const e of foes) {
            const sx = e.x, sy = e.y;
            const moved = battle.pullToFront(e, unit, force);
            battle.fx('pull', { x: e.x, y: e.y, id: e.id, fromX: sx, fromY: sy });
            if (moved > 0 && num(tb.value) > 0) {
              battle.dealDamage(unit, e, { amount: num(tb.value) * moved / Math.max(0.01, num(tb.dist, 1)), type: 'arts', isSkill: true, canDodge: false, tags: ['drag'] });
            }
            if (!e.alive) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'true', isSkill: true, tags: ['skill'] });
            if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
          }
        },
      },
      talents: [{ install(battle, unit) {
        if (num(t.atk) || num(t.def)) toggleBuff(battle, unit, 'slchan:hunter', () => unit.blocking.length === 0, { atkPct: num(t.atk), defPct: num(t.def) });
      } }],
    };
  },
};
