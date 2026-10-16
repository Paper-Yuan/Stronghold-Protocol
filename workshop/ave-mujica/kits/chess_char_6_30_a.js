// workshop/ave-mujica/kits/chess_char_6_30_a.js — 丰川祥子/Oblivionis（颂乐人偶 mod）
// 领主 (WARRIOR lord): 近战, 远程攻击, 可同时攻击2名敌人, 物伤/法伤。
// S1 新月的苏醒 (charges ×2): 对范围内一名敌人依次演奏8个音符，造成依次递减的法术伤害。
// S2 满月的舞会 (toggle): 攻击力+atkMul、攻击速度+aspd，攻击变为造成法术伤害的二连击。
// S3 残月的余响 (duration): 攻击范围扩大，攻击变为造成 atk_scale 法伤的4连击。
// T1 颂乐音符: 「每存在一个音符，成员无视敌人 def_pen 防御 / res_pen 法抗（最多 max_stack 层）」由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）实现：祥子每造成一次敌人伤害记一个音符（寿命 3 s [ASSUMED]），按在场音符数给成员穿透。
// T2 毋畏遗忘: 「造成伤害时 Fever+3」由本包盟约安装器（battle/main.mjs）负责，本 kit 不重复。
// 模组 LOR-Y「无言的约定」: 「攻击范围内存在 2 名及以上敌人时攻击速度+12」由引擎 traitMods.js 读取
//   trait.moduleDesc + trait.bb.attack_speed 生效，无需 kit。
import { num, skillBbOf } from '@kit/tier1.js';

const S1 = 'skchr_am_oblivionis_1';
const S2 = 'skchr_am_oblivionis_3'; // 满月的舞会 (图标 am_oblivionis_3)
const S3 = 'skchr_am_oblivionis_2'; // 残月的余响 (图标 am_oblivionis_2)

export default (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const b3 = skillBbOf(chess, S3);
  const scales = Array.isArray(b1.scales) && b1.scales.length ? b1.scales : [0.5, 0.46, 0.38, 0.29, 0.21, 0.17, 0.08, 0.03];
  const s1 = {
    kind: 'charges',
    charges: num(b1.charges, 2),
    onStart({ battle, unit }) {
      const list = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
      const e = list && list.length ? list[0] : null;
      if (!e || !e.alive) return;
      for (const sc of scales) {
        if (!e.alive) break;
        battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:oblivionis'] });
      }
    },
  };
  const s2 = {
    kind: 'toggle',
    mods: { atkMul: num(b2.atkMul, 1.4), aspd: num(b2.aspd, 60) },
    attack: { hits: Math.max(1, Math.floor(num(b2.hits, 2))), dmgType: 'arts', atkScale: 1 },
  };
  const s3 = {
    kind: 'duration',
    duration: num(b3.duration, 25),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b3.rangeExtend, 1))) },
    attack: { hits: Math.max(1, Math.floor(num(b3.hits, 4))), dmgType: 'arts', atkScale: num(b3.atk_scale, 1.4) },
  };
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2, [S3]: s3 },
    talents: [],
  };
};