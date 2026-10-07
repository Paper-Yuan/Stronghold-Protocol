// server/sim/content/kits/ops/chess_char_3_08-mint.js — 薄绿 (char_388_mint) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, traitBb, altSkills, gridKeys, fx, copyGrid, enemiesOn, aura } from '../shared/tier3.js';

export default {
  // ---- 3_08 薄绿 · 阵法术师 — S2 聚能涡旋: each attack strikes every enemy on her range (the trait's 群体法术伤害) and
  //      pushes each one towards her, end-of-skill burst on
  //      every enemy in range; 地质学者: DEF aura (skill off) / less likely targeted (skill on);
  //      精锐 module PLX-X: keeps part of the guard (DEF/RES) while the skill runs
  //      S1 风语: wider range (skill grid), attacks every enemy on it at attack@atk_scale. Auto-cast: the official
  //      rule is the 阵法术师 row SEARCH (PRTS 卫戍协议/帮助 "不受基础策略影响，在初始攻击范围内存在敌人时释放技能"; it covers
  //      every MANUAL skill of the class — user playtest #6) = an enemy inside her INITIAL range, never any enemy on the
  //      field (she would burn the skill on enemies that just spawned). Since 0.2.0 the owner's ACTIVE_RANGE rule
  //      (2026-10-05) widens it: the S1 x-2 strictly contains her x-1, so the data rule is ACTIVE_RANGE on the x-2 (rawRule
  //      SEARCH) — an enemy she can target inside the x-2, every tick — which this spec reads. S2 keeps SEARCH (no range
  //      change).
  chess_char_3_08_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? [[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]];
    const pullForce = num(bb['attack@force'], num(bb.force, 0));
    const endScale = num(bb.atk_scale, 0);
    const keepDef = num(tb['soil_e_002[buff].def'], 0), keepRes = num(tb['soil_e_002[buff].magic_resistance'], 0);
    // every skill: PLX-X keeps part of the guard, 地质学者 taunt −1 while it runs, DEF aura only while it does not
    const guardOn = ({ battle, unit }) => {
      if (keepDef || keepRes) battle.addBuff(unit, { key: 'trait:mint_keep', mods: { defPct: keepDef, resFlat: keepRes } });
      battle.addBuff(unit, { key: 'talent:mint_taunt', mods: { taunt: num(t0.taunt_level, -1) } });
      unit.mem.mintAura?.();
    };
    const guardOff = ({ battle, unit }) => {
      battle.removeBuff(unit, 'trait:mint_keep');
      battle.removeBuff(unit, 'talent:mint_taunt');
      unit.mem.mintAura?.();
    };
    return {
      skills: altSkills(chess, d, bb, {
        skchr_mint_1: (s) => {
          const grid = copyGrid(s.rangeGrid);
          return {
            kind: 'duration',
            attack: { atkScale: num(s.bb['attack@atk_scale'], num(s.bb.atk_scale, 1)) },
            ...(grid ? { targeting: { rangeGrid: grid } } : {}),
            onStart: guardOn,
            onEnd: guardOff,
          };
        },
      }),
      skill: {
        kind: 'duration',
        attack: {
          atkScale: num(bb['attack@atk_scale'], 1),
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy') return;
            // PRTS 备注: "此技能的“拖拽”机制实际为反方向（指向薄绿方向）的推开" — a radial push towards her by the
            // official 力度 − 重量 push distance (小力 vs weight 1: 0.44 tiles), never past her (Battle.push inward). Her
            // attack reaches air units (阵法术师 "攻击时可对空"), but the drones of the mode are 静态刚体 (PRTS 特殊机制): hit,
            // never dragged (player report after 0.1.0, "飞机可以被薄绿的技能拉走")
            if (battle.push(target, pullForce, { from: unit, inward: true }) > 0) fx(battle, 'pull', target, { src: unit.id });
          },
        },
        onStart: guardOn,
        onEnd(ctx) {
          const { battle, unit, reason } = ctx;
          if (reason !== 'death' && unit.alive && endScale > 0) {
            for (const e of enemiesOn(battle, unit, unit.rangeKeys)) battle.dealDamage(unit, e, { amount: unit.s.atk * endScale, type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            fx(battle, 'aoe', unit, { radius: 2, dmgType: 'arts', skill: 'mint_2' });
          }
          guardOff(ctx);
        },
      },
      talents: [{ install(battle, unit) {
        unit.mem.mintAura = aura(battle, unit, {
          key: 'talent:mint_geo', side: 'ally', tiles: () => gridKeys(tGrid, unit), active: () => !unit.skill?.active, mods: { defPct: num(t0.def) },
        });
      } }],
    };
  },
};
