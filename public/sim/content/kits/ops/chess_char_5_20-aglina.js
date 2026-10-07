// server/sim/content/kits/ops/chess_char_5_20-aglina.js — 安洁莉娜 (char_291_aglina) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import {
  AURA_IV, AURA_DUR, num, talent, skillGrid, batPct, mods, selectedId, lazySkills, whileOn,
} from '../shared/tier5.js';

/** 安洁莉娜 S3 失重: weight (massLevel) reduction while weightless. PRTS: "重量下降一个等级". */
const WEIGHTLESS_MASS = 1;
/** "攻击范围内存在敌人时，技力自然恢复速度+X/秒" (modules DEC-X). */
function enemySpUp(battle, unit, key, sp) {
  if (!(sp > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length) battle.addBuff(unit, { key, duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
  });
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 安洁莉娜 — slower (no normal attack while the skill is off). S3 秘杖·反重力模式 (14/18 s; her SEARCH row widened to
  // ACTIVE_RANGE on its y-4 by the owner's rule of 2026-10-05: an enemy inside the y-4 casts it): every enemy on the
  // field is weightless, skill range, ATK +, 4/5 targets. T1 加速力场: all allies ASPD +7. T2 兼职工作: while the skill is
  // off, all allies regenerate 20 HP/s. Module (elite): longer sluggish (trait bb, profession tunables).
  // S1 秘杖·速充模式 (duration, attack SP): ATK +; she attacks normally with S1 ("技能未开启时无法普通攻击" is only in the
  // S2/S3 texts). S2 秘杖·微粒模式 (duration, SEARCH): attack interval ×base_attack_time ("极大幅度缩短": a positive value
  // described as a shortening is the new interval ratio, the shared/tier1.js batMod convention), each attack damage_scale × ATK arts.
  // Module DEC-X (elite): SP +0.2/s with an enemy in range.
  chess_char_5_20_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const ratioBat = (v) => (num(v) > 0 && num(v) < 1 ? num(v) - 1 : batPct(v, chess));
    const weightless = (battle, unit) => {
      const left = Math.max(0.1, num(unit.skill?.timeLeft, 1));
      for (const e of battle.enemies) {
        if (!e.alive || e.findBuff('aglina:weightless')) continue;
        // 失重: weight −1 level (engine mod `massFlat`; massLevel never drops below 0)
        battle.addBuff(e, { key: 'aglina:weightless', status: 'weightless', visible: true, duration: left, data: { src: unit }, mods: { massFlat: -WEIGHTLESS_MASS } });
      }
    };
    return {
      skills: lazySkills({
        skchr_aglina_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk) }) }),
        skchr_aglina_2: () => ({ kind: 'duration', mods: mods({ batPct: ratioBat(bb.base_attack_time) }), attack: { atkScale: num(bb.damage_scale, 1) } }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { maxTargets: Math.max(1, num(bb['attack@max_target'], 1)) },
        onStart({ battle, unit }) { unit.mem.aglAcc = 0; weightless(battle, unit); battle.fx('weightless', { x: unit.x, y: unit.y, id: unit.id }); },
        onTick({ battle, unit, dt }) { unit.mem.aglAcc += dt; if (unit.mem.aglAcc >= AURA_IV) { unit.mem.aglAcc = 0; weightless(battle, unit); } },
        onEnd({ battle, unit }) {
          for (const e of battle.enemies) { const b = e.findBuff('aglina:weightless'); if (b && b.data.src === unit) battle.removeBuff(e, b); }
        },
      },
      trait: sid === 'skchr_aglina_1' ? undefined : { noAttackUnlessSkill: true },
      install(battle, unit) { enemySpUp(battle, unit, 'aglina:module', num(tm.sp_recovery_per_sec)); },
      talents: [
        { install(battle, unit) { // 加速力场
          const aspd = num(t0.attack_speed);
          if (aspd) whileOn(battle, unit, AURA_IV, () => { for (const a of battle.alliesFor(unit)) battle.addBuff(a, { key: 'aglina:field', duration: AURA_DUR, mods: { aspd } }); });
        } },
        { install(battle, unit) { // 兼职工作
          const hp = num(t1.hp_recovery_per_sec);
          // an HP-regeneration attribute, so 禁疗 does not stop it — PRTS 备注 "生命回复的提供方式为增加目标的'生命回复速度'属性，
          // 不受治疗加成和禁疗影响" (异常效果 禁疗: "增减生命回复速度…的效果不会被识别为治疗类能力"); a 孤立 unit (炎佑) is not
          // selected (Battle.alliesFor)
          if (hp > 0) whileOn(battle, unit, AURA_IV, () => { if (!unit.skill?.active) for (const a of battle.alliesFor(unit)) battle.addBuff(a, { key: 'aglina:parttime', duration: AURA_DUR, mods: { hpRegen: hp } }); });
        } },
      ],
    };
  },
};
