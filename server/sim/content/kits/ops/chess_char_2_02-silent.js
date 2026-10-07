// server/sim/content/kits/ops/chess_char_2_02-silent.js — 赫默 (char_108_silent) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { releaseSkillSummon } from '../../tokens.js';
import { num, talentBb, traitBb, installAura } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_02 赫默 医疗无人机 (AUTO, heal trigger): "获得一个医疗无人机 / 最多可库存1个无人机；无人机投入战场后治疗周围友军，
  // 10秒后自动销毁" — the 医疗探机 is a hand piece the player places (user playtest #6; PRTS 卫戍协议/帮助): each cast gives
  // one (stock ≤ cnt) and the placed piece takes the field on its own tile (tokens.js releaseSkillSummon: not at the
  // battle start — user playtest #4; not placed ⇒ no drone); it heals around itself and self-destructs after 10 s (token
  // kit). 强化注射: every 【医疗】 operator on the field ASPD +attack_speed. Elite module (PHY-Y): heals on ground units
  // ×heal_scale (module 'none': no bonus).
  // The cast: as soon as the SP is full — the AUTO skill has no cast condition (client skill skchr_silent_2: no
  // `_trigger`, `_allowNoTarget` 1, `_checkHasTargetBeforeDoCast` 0, a RechargeToken action), so the placed drone takes the
  // field the moment S2 is ready (community report of 2026-10-06 「赫默的无人机在2技能好了之后应该秒放」; until 0.2.0 the data's
  // DEFAULT rule with `heal` waited for an injured ally in her range). While the stock is full her SP stops (阻回) until
  // one is spent: `_stopSpWhenTokenIsFull` 1, PRTS 备注 「医疗探机库存达到上限后赫默获得阻回，直到库存被消耗为止」.
  // S1 治疗强化·γ型 (alt): ATK +atk for its duration (no drone).
  chess_char_2_02_a: (bb, chess) => {
    const tokId = chess?.skill?.overrideTokenKey ?? (chess?.tokens ?? [])[0] ?? 'token_10000_silent_healrb';
    const cnt = Math.max(1, Math.floor(num(bb.cnt, 1)));
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: {
        kind: 'instant', heal: true,
        trigger: { rule: 'SP_FULL' },
        onStart({ battle, unit }) { releaseSkillSummon(battle, unit, tokId, { cap: cnt }); },
      },
      install(battle, unit) {
        if (unit.def?.skill?.id !== 'skchr_silent_2') return;
        // 阻回 while the stock is full (refreshed every tick; gone a tick after a drone takes the field)
        battle.on('tick', () => {
          if (!unit.alive || !unit.deployed || !((unit.mem.summonStock?.[tokId] ?? 0) >= cnt)) return;
          battle.addBuff(unit, { key: 'silent:stockFull', duration: 2 * battle.dt, refresh: 'extend', flags: { noSp: true } });
        }, { owner: unit });
      },
      skills: { 'skcom_heal_up[3]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        const v = num(t.attack_speed);
        if (v) installAura(battle, unit, { key: 'talent:silent', value: v, select: (a) => a.kind === 'op' && a.def.profession === 'MEDIC', mods: { aspd: v } });
        if (num(tb.heal_scale, 1) !== 1) {
          battle.on('heal', (ctx) => { if (ctx.source === unit && ctx.target.ground) ctx.amount *= num(tb.heal_scale, 1); }, { owner: unit });
        }
      } }],
    };
  },
};
