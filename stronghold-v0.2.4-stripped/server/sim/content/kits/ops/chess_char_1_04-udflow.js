// server/sim/content/kits/ops/chess_char_1_04-udflow.js — 深巡 (char_4137_udflow) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, moduleOn, installReveal, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_04 深巡 行动能力剥夺: longer line range (skill grid), ATK +atk, ASPD +attack_speed, fin darts pierce
  // attack@max_target enemies on the line and cause attack@sluggish s of 停顿.
  // 技能策略 (DESIGN §21.29, PR #12): the official 下半 class row hands every MANUAL 重装 skill TAKE_DAMAGE, which makes a
  // 2-2 ranged 哨戒铁卫 wait until something hits her — in practice until she blocks (GitHub issue #4). By the owner's
  // deliberate deviation from that row (2026-10-03, community feedback) this offensive ranged skill takes the basic
  // strategy (tools/build-data.mjs TRIGGER_DEVIATIONS: DEFAULT, rawRule keeps the official TAKE_DAMAGE), and since 0.2.0
  // the owner's ACTIVE_RANGE rule on top of it (2026-10-05): its running range 3-2 strictly contains her 2-2, so it casts
  // as soon as an enemy is inside the 3-2 — the data rule (rule ACTIVE_RANGE, customRangeGrid the 3-2), which this spec
  // reads (PR #12's DEFAULT line is gone: it would have kept the 2-2).
  // 细胞活性抑制剂: attacks inflict `damage` arts per `interval` s for `duration` s (damage_seamonster vs 【海怪】).
  // Elite module (SPT-X): stealth of enemies inside the range is cancelled.
  // Alternate S1 侵袭破坏应对 (重装 ⇒ TAKE_DAMAGE trigger from data): ATK +atk, DEF +def.
  chess_char_1_04_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const s1 = skillBbOf(chess, 'skchr_udflow_1');
    return {
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null, maxTargets: num(bb['attack@max_target'], 1) },
        attack: { onHitStatus: { key: 'sluggish', duration: num(bb['attack@sluggish'], 1) } },
      },
      skills: { skchr_udflow_1: { kind: 'duration', mods: { atkPct: num(s1.atk), defPct: num(s1.def) } } },
      talents: [{ install(battle, unit) {
        const dur = num(t.duration), iv = num(t.interval, 1);
        if (!(dur > 0) || !(num(t.damage) > 0)) return;
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg?.isAttack || ctx.target.side !== 'enemy' || !ctx.target.alive) return;
          const sea = (ctx.target.def?.tags || []).includes('seamonster');
          const amount = sea ? num(t.damage_seamonster, num(t.damage) * 2) : num(t.damage);
          battle.addBuff(ctx.target, {
            key: `udflow:dot:${unit.id}`, duration: dur, interval: iv, refresh: 'extend', source: unit, visible: false,
            onTick: ({ battle: b, unit: e }) => b.dealDamage(unit, e, { amount, type: 'arts', canDodge: false, tags: ['dot'] }),
          });
        }, { owner: unit });
      } }],
      install(battle, unit) { if (moduleOn(chess) && chess.isGolden) installReveal(battle, unit); },
    };
  },
};
