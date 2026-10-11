// server/sim/content/kits/ops/chess_char_5_18-gvial2.js — 百炼嘉维尔 (char_1026_gvial2) kit, tier 5 (hidden).
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { num, talent, traitBb, skillGrid, mods, whileOn } from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 百炼嘉维尔 — S2 链锯强袭 (33/36 s): skill range, ATK/DEF +; hits on unblocked enemies drag them in front of her.
  // T1 战地巨斧: ATK/DEF +10 %, +4 % per extra blocked enemy. T2 医学背景: healing received +20 % (+40 % below 50 %).
  // Module (elite): ×1.1 vs blocked enemies.
  chess_char_5_18_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const force = num(bb['attack@force'], 1);
    const blockedMul = num(tb.atk_scale);
    return {
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: {
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy' || target.blockedBy) return;
            battle.pullToFront(target, unit, force); // the official 力度 − 重量 pull (Battle.pullToFront)
          },
        },
      },
      trait: blockedMul > 1 ? { dmgMul: (b, u, t) => (t && t.blockedBy ? blockedMul : 1) } : undefined,
      talents: [
        { install(battle, unit) { // 战地巨斧
          const apply = () => {
            const extra = Math.max(0, unit.blocking.length - 1);
            if (unit.mem.axeN === extra && unit.findBuff('gvial2:axe')) return;
            unit.mem.axeN = extra;
            battle.addBuff(unit, { key: 'gvial2:axe', mods: mods({ atkPct: num(t0.atk) + num(t0.atk_add) * extra, defPct: num(t0.def) + num(t0.def_add) * extra }) });
          };
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.axeN = -1; apply(); } }, { owner: unit });
          whileOn(battle, unit, 0.2, apply);
        } },
        { install(battle, unit) { // 医学背景
          battle.on('heal', (c) => {
            if (c.target !== unit) return;
            c.amount *= unit.hpRatio < num(t1.hp_ratio, 0.5) ? num(t1.heal_scale_2, 1) : num(t1.heal_scale_1, 1);
          }, { owner: unit });
        } },
      ],
    };
  },
};
