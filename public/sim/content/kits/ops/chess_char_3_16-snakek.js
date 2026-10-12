// server/sim/content/kits/ops/chess_char_3_16-snakek.js — 蛇屠箱 (char_150_snakek) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, traitBb, altSkills, statSkill, whileTrue } from '../shared/tier3.js';

export default {
  // ---- 3_16 蛇屠箱 · 铁卫 — S2 壳状防御: stops attacking, block +1, DEF +, regen; 防御专精: DEF +;
  //      精锐 module PRO-X: DEF + while blocking
  chess_char_3_16_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const kit = {
      skill: {
        kind: 'duration',
        mods: { defPct: num(bb.def), blockCnt: num(bb.block_cnt), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) },
        attack: { noAttack: true },
      },
      // S1 防御力强化·β型 (TAKE_DAMAGE): DEF + (she keeps attacking)
      skills: altSkills(chess, d, bb, { 'skcom_def_up[2]': statSkill }),
      talents: [{ install(battle, unit) { battle.addBuff(unit, { key: 'talent:snakek_def', mods: { defPct: num(t0.def) }, persist: true, allowDead: true }); } }],
    };
    if (num(tb.def) > 0) kit.install = (battle, unit) => whileTrue(battle, unit, 'trait:snakek_block', () => unit.blocking.length > 0, { defPct: num(tb.def) });
    return kit;
  },
};
