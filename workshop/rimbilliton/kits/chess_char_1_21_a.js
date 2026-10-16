// workshop/rimbilliton/kits/chess_char_1_21_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Conventions of the tier-1 kits: ../../../content/kits/shared/tier1.js; kit contract and rules:
// server/sim/content/kits/README.md.
//
// 领主 (professions.js lord): 可对空、远程攻击但攻击力降低至 80% (rangedScale) — trait 无需代码。
// S1 寒霜枪刃 (AUTO, 时间回复): 下次攻击 atk_scale 物理，命中目标 duration 秒内移动速度 -(move_speed)。
// S2 凝冰枪刃 (MANUAL, 时间回复, 25 s): 攻击速度 +attack_speed；每次攻击命中目标移动速度 -(move_speed)，并有
//   prob 几率使其束缚 debuff 秒（debuff = 束缚, engine `bind`）。
// 天赋 掩护打击 (精英): 攻击范围扩大（talent rangeGrid 替换基础 3-2），攻击间隔 +base_attack_time s。

import { num, talentBb, talentGrid, skillBbOf, statBuff, batMod } from '@kit/tier1.js';
import { onDefaultSkill } from '@kit/tier2.js';

const S1 = 'skchr_frostl_1';
const S2 = 'skchr_frostl_2';
/** 霜叶的减速 (移动速度 -(move_speed)): 一个 moveMul 的直接乘算 buff, 与幽灵鲨替身的减速同款。 */
const slowMods = (v) => ({ moveMul: Math.max(0.05, 1 + v) });

export default (bb, chess) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1);
    const s1 = {
      kind: 'instant',
      attack: {
        atkScale: num(b1.atk_scale, 1),
        onHit({ battle, unit, target }) {
          if (target && target.alive && target.side === 'enemy') {
            battle.addBuff(target, { key: 'skill:frostl:slow', duration: num(b1.duration, 2), mods: slowMods(num(b1.move_speed, 0)) });
          }
        },
      },
    };
    const s2 = {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      attack: {
        onHit({ battle, unit, target }) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          battle.addBuff(target, { key: 'skill:frostl:slow', duration: 2, mods: slowMods(num(bb.move_speed, 0)) });
          if (num(bb.prob, 0) > 0 && battle.rng.chance(num(bb.prob))) battle.applyStatus(target, 'bind', { duration: num(bb.debuff, 0), source: unit });
        },
      },
    };
    return {
      skill: sid === S2 ? s2 : s1,
      skills: { [S1]: s1 }, // 默认技能 S2 只放顶层 `skill`（skillSource 'kit'），`skills` 装替代技能
      talents: [{ install(battle, unit) { // 掩护打击 (精英): 攻击范围扩大 + 攻击间隔 +base_attack_time
        const g = talentGrid(chess, 0);
        if (g && g.length) { unit.rangeGrid = g.map((p) => [p[0], p[1]]); battle.refreshRange(unit); }
        const bat = num(talentBb(chess, 0).base_attack_time, 0);
        if (bat > 0) statBuff(battle, unit, 'talent:frostl:bat', { batPct: batMod(bat, chess) });
      } }],
    };
  }
