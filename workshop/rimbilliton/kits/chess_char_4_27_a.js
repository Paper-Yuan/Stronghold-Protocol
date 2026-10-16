// workshop/rimbilliton/kits/chess_char_4_27_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Kit contract and rules: server/sim/content/kits/README.md.
//
// 咒愈师 (professions.js installIncantation): 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗 50% 伤害量 —
// trait 无需代码。
// S1 哀恸共情 (MANUAL, 时间回复, 50 s, SKILL_RANGE): 攻击速度 +attack_speed；每次攻击额外治疗自身周围一定范围
//   (技能 rangeGrid) 内所有我方相当于攻击力 heal_scale 的生命。
// S2 慈悲愿景 (MANUAL, 时间回复, 32 s): 立刻对攻击范围内所有敌人进行一次 atk_scale 法术攻击，命中目标 6 s 内攻击速度
//   -(debuff.attack_speed)、移动速度 -(debuff.move_speed)；该次攻击每击中一个敌人获得 atkPct（最多 max_stack_cnt 次）；
//   接下来的伤害类型变为真实且可同时攻击 2 名敌人；整场战斗中只能释放一次。
// 天赋 诚挚期许 (PRTS): 在场时所有友方单位最大生命 +5%，技能期间所有友方单位每秒恢复 1.5% 最大生命。
//   (阶段B手写数据 bb 为空 — 数值来自 PRTS，[ASSUMED] 满潜数值即文本值。)

import { num, talentBb, skillBbOf, up } from '@kit/tier1.js';
import { onDefaultSkill } from '@kit/tier2.js';

const S1 = 'skchr_amiya3_1';
const S2 = 'skchr_amiya3_2';
/** 诚挚期许 (PRTS 阿米娅·咒愈师): 在场 +5 % 最大生命; 技能期间全场每秒恢复 1.5 % 最大生命。 */
const ELITE_HP = 0.05;
const ELITE_REGEN = 0.015;

export default (bb, chess, def) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1);
    const s1Grid = (chess?.skills ?? []).find((s) => s.skillId === S1)?.rangeGrid ?? null;
    const s1 = {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      onHit({ battle, unit }) { // 每次攻击额外治疗自身周围范围内所有我方
        const heal = num(bb.heal_scale, 0);
        if (!(heal > 0) || !s1Grid) return;
        for (const a of battle.unitsInGrid(unit, s1Grid, { side: 'ally' })) {
          if (a.kind === 'op' && a.alive && a.hp > 0) battle.heal(unit, a, unit.s.atk * heal, { tags: ['skill'] });
        }
      },
    };
    const s2 = {
      kind: 'duration',
      attack: { dmgType: 'true', maxTargets: 2 }, // 接下来的伤害类型变为真实且可同时攻击 2 名敌人
      onStart({ battle, unit, skill }) {
        skill.maxCharges = 0; // 整场战斗中该技能只能释放一次: 技力不再能积成充能，技能永久不可再放
        let hits = 0;
        const debuff = {
          dur: num(bb['amiya3_s_2[debuff].duration'], 6),
          aspd: num(bb['amiya3_s_2[debuff].attack_speed'], 0),
          spd: num(bb['amiya3_s_2[debuff].move_speed'], 0),
        };
        for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
          if (!e.alive) continue;
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'amiya3S2'] });
          if (e.alive && e.side === 'enemy') hits++;
          if (debuff.dur > 0 && (debuff.aspd || debuff.spd)) {
            battle.addBuff(e, { key: 'skill:amiya3:s2debuff', duration: debuff.dur, mods: { aspd: debuff.aspd, moveMul: Math.max(0.05, 1 + debuff.spd) }, source: unit });
          }
        }
        const pct = num(bb.atk, 0.2) * Math.min(num(bb.max_stack_cnt, 5), hits);
        if (pct > 0) battle.addBuff(unit, { key: 'skill:amiya3:s2atk', persist: true, mods: { atkPct: pct }, tags: ['skill'] });
      },
    };
    return {
      skill: sid === S2 ? s2 : s1,
      skills: { [S1]: s1 }, // 默认技能 S2 只放顶层 `skill`（skillSource 'kit'）
      talents: [{ install(battle, unit) { // 诚挚期许: 在场所有友方 +5 % 最大生命; 技能期间全场每秒恢复 1.5 %
        battle.every(0.5, () => {
          if (!up(unit)) return;
          const skillOn = !!unit.skill?.active;
          for (const a of battle.allyUnits) {
            if (a.kind !== 'op' || a.ownerId !== unit.ownerId) continue;
            battle.addBuff(a, { key: 'talent:amiya3:field', duration: 0.6, mods: { hpPct: ELITE_HP, ...(skillOn ? { hpRegenRatio: ELITE_REGEN } : {}) }, tags: ['talent'] });
          }
        }, { owner: unit, immediate: true });
      } }],
    };
  }
