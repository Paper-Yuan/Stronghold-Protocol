// workshop/rimbilliton/kits/chess_char_5_25_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Kit contract and rules: server/sim/content/kits/README.md.
//
// 傀儡师 (professions.js installDollkeeper): 受到致命伤时切换成<替身>作战，20 s 后回本尊 — trait 无需代码；kit 只写
//   dollNoAttack（<替身>不进行普通攻击，engine 在替身形态施加减益缴械+沉默）。
// S1 多首野兽 (MANUAL, 时间回复, 14/15 s): 防御 +def、阻挡数 +block_cnt、更容易成为敌人的攻击目标 (taunt)；技能期间
//   被击倒后，<替身>也能阻挡敌人且享受技能效果，直到<替身>退场（dollSwap 进替身时延续 buff，回本尊移除）。
// S2 破坏与滋养 (MANUAL, 时间回复, 15 s): 攻击范围扩大 (rangeGrid 2-1)，攻击间隔略微缩短 (Lv7 base_attack_time)，
//   每次攻击变为 atk_scale 法术伤害的三连发，每次攻击到敌人时自身受到 value 点法术伤害。
// T1 另一个"她": 若叶睦和<替身>受到物理/法术伤害的 damage_resistance 转化为 dark_damage_mul_factor 的凋亡损伤；
//   <替身>不攻击，防御力 +def。[ASSUMED] "Ave Mujica 成员攻击时有 20% 概率使替身持续时间缩短 1 秒" — mod 无乐队成员
//   判定数据，不实现。
// T2 毋畏死亡: 受伤 Fever +cnt；在场时 Ave Mujica 成员生命上限 +max_hp —— 两半都由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，团队判定在那侧，本 kit 不重复。

import { num, talentBb, traitBb, skillBbOf, batMod } from '@kit/tier1.js';
import { onDefaultSkill } from '@kit/tier2.js';

const S1 = 'skchr_mortis_1';
const S2 = 'skchr_mortis_2';
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));

export default (bb, chess, def) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1);
    const s2Grid = (chess?.skills ?? []).find((s) => s.skillId === S2)?.rangeGrid ?? null;
    const s1mods = nz({ defPct: num(b1.def), blockCnt: num(b1.block_cnt), taunt: num(b1.taunt_level) });
    const s1 = {
      kind: 'duration',
      mods: s1mods,
      onStart({ unit }) { unit.mem.mortisS1 = true; },
      // 技能被击倒（替身切换）时以 reason 'substitute' 结束 — 效果延续给替身（见 install 的 dollSwap），不清标记
      onEnd({ unit, reason }) { if (reason !== 'substitute') unit.mem.mortisS1 = false; },
    };
    const s2 = {
      kind: 'duration',
      targeting: s2Grid ? { rangeGrid: s2Grid.map((p) => [p[0], p[1]]) } : undefined,
      // 攻击范围扩大(2-1 > 自身1格) → 按 owner 0.2.0 规则 ACTIVE_RANGE（数据 DEFAULT 有缺，参照莱伊 S3 修正）
      ...(s2Grid ? { trigger: { rule: 'ACTIVE_RANGE', grid: s2Grid.map((p) => [p[0], p[1]]) } } : {}),
      mods: nz({ batPct: batMod(bb.base_attack_time, chess) }),
      attack: {
        dmgType: 'arts',
        atkScale: num(bb['attack@atk_scale'], 1),
        hits: 3, // 三连发
        onEachHit({ battle, unit, target }) {
          const v = num(bb.value, 0);
          if (target && target.alive && target.side === 'enemy' && v > 0) {
            battle.dealDamage(unit, unit, { amount: v, type: 'arts', isSkill: true, tags: ['skill', 'mortis:self'] });
          }
        },
      },
    };
    return {
      trait: { dollNoAttack: true }, // <替身>不攻击
      skill: sid === S2 ? s2 : s1,
      skills: { [S1]: s1 }, // 默认技能 S2 只放顶层 `skill`（skillSource 'kit'）
      talents: [
        { install(battle, unit) { // 另一个"她": 受物理/法术伤害 → 凋亡损伤; 替身防御 +def
          const dr = num(talentBb(chess, 0).damage_resistance, 0), half = num(talentBb(chess, 0).dark_damage_mul_factor, 0.5);
          if (dr > 0) {
            battle.on('damaged', (c) => {
              if (c.target !== unit || (c.type !== 'phys' && c.type !== 'arts') || !(c.amount > 0)) return;
              const fill = c.amount * dr * half;
              if (fill > 0) battle.dealDamage(unit, unit, { type: 'element', element: 'apoptosis', amount: fill, tags: ['talent', 'mortis:apoptosis'] });
            }, { owner: unit });
          }
          const def = num(talentBb(chess, 0).def, 0);
          if (def > 0) {
            battle.every(0.2, () => {
              if (unit.trait.doll) battle.addBuff(unit, { key: 'talent:mortis:dollDef', duration: 0.3, mods: { defPct: def }, tags: ['talent'] });
            }, { owner: unit });
          }
        } },
      ],
      install(battle, unit) {
        // S1: 技能期间被击倒 → <替身>也享受技能效果，直到替身退场（回本尊）
        battle.on('dollSwap', (c) => {
          if (c.unit !== unit) return;
          if (c.form === 'doll' && unit.mem.mortisS1 && Object.keys(s1mods).length) {
            battle.addBuff(unit, { key: 'skill:mortis:s1doll', persist: true, mods: s1mods, tags: ['skill'] });
          } else if (c.form === null) {
            battle.removeBuff(unit, 'skill:mortis:s1doll');
          }
        }, { owner: unit });
      },
    };
  }
