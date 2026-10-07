// server/sim/content/kits/ops/standin-acmedc.js — Touch (char_613_acmedc) 补位 stand-in kit: 5 塞雷娅, 6 塑心 / 纯烬艾雅法拉
// (all S3 恳切福音 + module PHY-X on the elite). Stand-in contract and rules: ../README.md "Stand-in kits".

import { num, traitBb, skillRec } from '../shared/tier1.js';
import { mapCharTalents, touchGospel } from '../../tokens.js';

const S1 = 'skchr_acmedc_1', S2 = 'skchr_acmedc_2', S3 = 'skchr_acmedc_3';
/** S2 宛如天启's "所有医疗干员攻击力+X%" on every medic operator of hers while the skill runs (one per target: 同名 buff). */
const APOCALYPSE_KEY = 'acmedc:apocalypse';

const isMedicOp = (a) => a.kind === 'op' && a.alive && a.deployed && !a.hidden && a.def?.profession === 'MEDIC';

export default {
  // Touch (医师) — skills from data/backups.json (normal E2 Lv1 skill rank 4, elite E2 Lv60 rank 7; skill_table and PRTS
  // Touch(卫戍协议) agree):
  //   S1 慨赠 (20 s): ATK +atk, each heal has an `attack@prob` chance of one extra heal [ASSUMED: of the same target, the
  //      same amount — the text names no other target].
  //   S2 宛如天启 (30 s): her range becomes the 3-10 grid (PRTS 修正: "攻击距离+1" means 攻击范围扩大), she heals
  //      `attack@max_target` targets, every 医疗 operator of hers ATK +`attack@atk` herself included [ASSUMED: her own
  //      player's operators, as 余's "全场所有干员"; summons not].
  //   S3 恳切福音 (40 s): content/tokens.js touchGospel — the one implementation the 外勤医疗 strategy's Touch runs too
  //      (5-2 grid, ATK +atk, 2 targets, ×heal_scale on allies below hp_ratio HP, and an extra heal of 30 % of the main
  //      heal's base on the main target or an orthogonal neighbour — the lowest HP ratio, a full-HP one included — which
  //      takes the ×heal_scale of its own recipient: PRTS 技能3 备注).
  //   Talents 攫升 / 超脱: content/tokens.js mapCharTalents (the strategy's Touch too); the module's 超脱 upgrade (8 SP at
  //      module Lv3) comes with the record's talents.
  //   Module PHY-X (elite, trait addition): "治疗生命值低于50%的友方单位时治疗量提升15%" — every heal of hers on an ally
  //      below `hp_ratio` HP (strictly: "低于"; the client's acmedc_e_tr filters LT) ×`heal_scale` (the trait blackboard). With S3's ×1.35 / ×1.40 it
  //      multiplies (×1.61 at Lv7): both are `heal_scale` blackboards, the 治疗倍率, and PRTS 游戏数据基础 §倍率 says "同种
  //      倍率间叠乘" — no Touch-specific note or buff template exists. S3's extra heal is a heal of hers like any other: its
  //      recipient below `hp_ratio` gets the ×1.15 too (its base is taken before either bonus).
  //   Triggers (data, nothing set here): S1 DEFAULT (an injured ally in her range); S2 / S3 ACTIVE_RANGE — the owner's
  //      rule of 2026-10-05 read for a heal skill: an injured ally inside the running 3-10 / 5-2 range casts.
  char_613_acmedc: (bb, chess, def) => {
    const tb = traitBb(chess);
    const phyScale = num(tb.heal_scale, 1), phyRatio = num(tb.hp_ratio, 0);
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const gospel = r3 ? touchGospel(r3.bb ?? {}, r3) : null;
    const skills = {};
    if (r1) {
      const b1 = r1.bb ?? {};
      const p = num(b1['attack@prob'], 0);
      skills[S1] = {
        kind: 'duration', heal: true,
        mods: { atkPct: num(b1.atk) },
        onHit({ battle, unit, target, heal }) {
          if (!(p > 0) || !target || !(heal > 0) || !battle.rng.chance(p)) return;
          battle.heal(unit, target, heal);
          battle.fx('heal', { x: target.x, y: target.y, id: unit.id });
        },
      };
    }
    if (r2) {
      const b2 = r2.bb ?? {};
      const v = num(b2['attack@atk'], 0);
      const grant = (battle, unit) => {
        for (const a of battle.alliesFor(unit, unit.ownerId)) {
          if (!isMedicOp(a)) continue;
          const cur = a.findBuff(APOCALYPSE_KEY);
          if (cur && (cur.source === unit || (cur.data?.v ?? 0) >= v)) continue; // another Touch's equal or stronger one
          battle.addBuff(a, { key: APOCALYPSE_KEY, mods: { atkPct: v }, source: unit, data: { v }, tags: ['skill'] });
        }
      };
      skills[S2] = {
        kind: 'duration', heal: true,
        targeting: { rangeGrid: r2.rangeGrid, maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 2))) },
        onStart({ battle, unit }) { if (v) grant(battle, unit); },
        // medics deployed (or redeployed) while it runs get it too
        onTick({ battle, unit }) { if (v) grant(battle, unit); },
        onEnd({ battle, unit }) {
          for (const a of battle.allyUnits) if (a.findBuff(APOCALYPSE_KEY)?.source === unit) battle.removeBuff(a, APOCALYPSE_KEY);
        },
      };
    }
    if (gospel) skills[S3] = gospel.skill;
    return {
      skills,
      talents: mapCharTalents(def),
      install(battle, unit) {
        if (phyScale !== 1 && phyRatio > 0) {
          battle.on('heal', (ctx) => {
            if (ctx.source !== unit || !ctx.target || ctx.opts?.regen) return;
            if (ctx.target.hpRatio < phyRatio - 1e-9) ctx.amount *= phyScale;
          }, { owner: unit, priority: 10 });
        }
        if (gospel && def?.skill?.id === S3) gospel.install(battle, unit);
      },
    };
  },
};
