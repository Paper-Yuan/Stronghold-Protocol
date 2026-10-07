// server/sim/content/kits/ops/standin-acnipe.js — Stormeye (char_611_acnipe) 补位 stand-in kit: 6★ 速射手 for 空弦 (T3, S3),
// 莫斯提马 (T4, S2), 百炼嘉维尔 / 妮芙 (T5, S3 + MAR-X) and 蕾缪安 / 异客 (T6, S3 + MAR-X); every skill at every form.
// Kit contract and the stand-in rules: ../README.md ("Stand-in kits").
//
// Sources: data/backups.json (character_table / skill_table / battle_equip_table at E2 Lv1 rank 4 and E2 Lv60 rank 7)
// and the client's battle data (charpack char_611_acnipe, battle/buff_template_data.json — the templates quoted below).
// - 速射手 trait 优先攻击空中单位 (data `targetPriority` 'fly', `canHitFly`); module MAR-X "攻击空中单位时攻击力提升至110%"
//   (trait atk_scale 1.1, template acnipe_e_002_trait: CheckMotionMode FLY → AtkScaleUp on every damage calculation) is
//   the fastshot profile's own (professions.js fastshot `flyScale` from the trait blackboard): no kit code. The module's
//   HP / ATK are in the stats; at level 3 it raises 风坠 to 190 % (the composed talents).
// - T1 风坠 "攻击时有25%的概率攻击力提升至180%" — acnipe_t_1: ON_CALCULATE_DAMAGE → Dice(prob) → AtkScaleUp(atk_scale): a roll
//   on EVERY damage instance of an attack (each target, each hit of S3's double hit), ATK × atk_scale before DEF / RES.
//   S3 raises `prob` to its talent@prob.
// - T2 风雨欲来 "自身未进行攻击时，技力回复速度+0.2/秒" (sp_recovery_per_sec, delay 2): +0.2 SP/s once she has made no attack
//   for `delay` s — [ASSUMED] the reading of `delay` (no text or PRTS note gives it), counted from her deployment too.
// - S1 破空: ATK +atk, ASPD +attack_speed, 无视 def_penetrate_fixed DEF (defIgnoreFlat) for its 20 s.
// - S2 心手合一 (自动触发, 持续时间无限): ATK +atk and attack@max_target targets until she is knocked out (a toggle). Trigger:
//   the data's DEFAULT — an AUTO attack buff waits for her next attack like 能天使 S3 / 乌尔比安 S2 (W5C's AUTO audit:
//   "attack modes / attack buffs" keep waiting); being endless it changes nothing but the moment of the cast.
// - S3 旋臂: attack@max_target targets, attack@times hits each (二连击), 风坠 at talent@prob; and "攻击目标生命值高于90%时额外
//   造成1次伤害": the S3 attack carries acnipe_s_3[extra] (`_onlyFeedActiveBuffToFirstOne`: the first hit of the double hit
//   only) — FilterByTargetHpRatio GE attack@hp_ratio, then AdvancedApplyDamage PHYSICAL attack@atk_scale_extra × ATK with
//   `_emitSourceOnCalculateDamage` false: one extra physical instance per target per attack, which neither 风坠 nor the
//   MAR-X trait touches (no isAttack: no "攻击时" effect sees it). [ASSUMED] the HP ratio is read when that first hit lands,
//   before its damage (as 异客's 机理分析 kit reads it; the order of the buff and the hit is not in the data).

import { num, talentBb, skillRec, spTimeBonus } from '../shared/tier1.js';

const S1 = 'skchr_acnipe_1';
const S2 = 'skchr_acnipe_2';
const S3 = 'skchr_acnipe_3';
/** Tag of S3's extra damage instance (not an attack: 风坠 skips it). */
const EXTRA = 'acnipe:extra';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));
const s3On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S3);

export default {
  char_611_acnipe: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed), defIgnoreFlat: num(b1.def_penetrate_fixed) } },
        [S2]: { kind: 'toggle', mods: { atkPct: num(b2.atk) }, targeting: { maxTargets: count(b2['attack@max_target'], 2) } },
        [S3]: {
          kind: 'duration',
          targeting: { maxTargets: count(b3['attack@max_target'], 3) },
          attack: {
            hits: count(b3['attack@times'], 2),
            // the extra instance, after the attack's hits on that target (marked by the install's first-hit check)
            onEachHit({ battle, unit, target, kind }) {
              const due = unit.mem.acnipeExtra;
              if (kind !== 'main' || !due || !due.has(target)) return;
              due.delete(target);
              if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * num(b3['attack@atk_scale_extra'], 1), type: 'phys', isSkill: true, tags: ['skill', EXTRA] });
            },
          },
        },
      },
      talents: [
        { install(battle, unit) { // 风坠: every damage instance of an attack rolls
          const scale = num(t0.atk_scale, 1), base = num(t0.prob);
          if (!(scale > 0) || scale === 1) return;
          battle.on('hit', (ctx) => {
            const d = ctx.dmg;
            if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy' || !d.isAttack || d.type === 'element' || (d.tags || []).includes(EXTRA)) return;
            const p = s3On(unit) ? num(b3['talent@prob'], base) : base;
            if (p > 0 && battle.rng.chance(p)) d.amount *= scale;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 风雨欲来: no attack for `delay` s (her deployment counts as the start) ⇒ +SP/s
          const delay = num(t1.delay, 0);
          spTimeBonus(battle, unit, num(t1.sp_recovery_per_sec), () => battle.time - Math.max(unit.lastAttackAt, unit.deployedAt) >= delay - 1e-9);
        } },
      ],
      install(battle, unit) {
        if (unit.skill?.id !== S3) return;
        // S3 [extra]: the first hit of each attack on a target checks its HP ratio before that hit's damage
        const ratio = num(b3['attack@hp_ratio'], 0.9);
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || d.isSplash || !s3On(unit)) return;
          const seen = unit.mem.acnipeSeen ??= new WeakMap();
          if (d.attackId && seen.get(t) === d.attackId) return;
          seen.set(t, d.attackId);
          if (t.hpRatio >= ratio - 1e-9) (unit.mem.acnipeExtra ??= new Set()).add(t);
        }, { owner: unit });
      },
    };
  },
};
