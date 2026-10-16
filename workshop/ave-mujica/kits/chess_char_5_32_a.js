// workshop/ave-mujica/kits/chess_char_5_32_a.js — 八幡海铃/Timoris（颂乐人偶 mod）
// 铁卫 (DEFENDER protector): 近战重装, 阻挡2, 物伤。
// S1 颤栗之弦 (charges ×2): 一次5连击，对范围内敌人每次造成 atk×atk_scale 的法术伤害。[ASSUMED]
// S2 无存之所 (duration): 立即使范围内敌人恐惧 fear_dur 秒；期间每秒对范围内敌人造成 atk×dps_scale 法伤。[ASSUMED]
// T1 应召而至: 「被伤害的敌人 21% 概率停顿 3 秒」已由本包盟约安装器（battle/main.mjs 的 Timoris：全员 25%+每层0.1%）统一实现，
//   本 kit 不重复；「技能期间攻击范围扩大」无对应范围数据，未实现。
// T2 毋畏恐惧: Fever（造成停顿 +2）与「在场时成员对停顿/恐惧敌人增伤 dmg_up」为团队效果，由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 AMB-Y「额外训练」: 特性 50%→65% 闪避由 professions.js 的 stalker 规则读取 trait.bb.prob 生效，无需 kit。
import { num, skillBbOf } from '@kit/tier1.js';

const S1 = 'skchr_am_timoris_1';
const S2 = 'skchr_am_timoris_2';

export default (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const s1 = {
    kind: 'charges',
    charges: num(b1.charges, 2),
    attack: {
      hits: Math.max(1, Math.floor(num(b1.hits, 5))),
      atkScale: num(b1.atk_scale, 0.55),
      dmgType: 'arts',
    },
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 15),
    onStart({ battle, unit }) {
      const fd = num(b2.fear_dur, 1.5);
      if (fd > 0) {
        for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
          battle.applyStatus(e, 'fear', { duration: fd, source: unit });
        }
      }
    },
    onTick({ battle, unit, dt }) {
      const tick = (unit._t2 = (unit._t2 || 0) + dt);
      if (tick < 1) return;
      unit._t2 = 0;
      const dps = num(b2.dps_scale, 0.7);
      if (dps <= 0) return;
      for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
        if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dps, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:timoris'] });
      }
    },
  };
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents: [],
  };
};