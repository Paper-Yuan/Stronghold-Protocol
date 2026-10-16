// workshop/rimbilliton/kits/chess_char_2_20_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Conventions of the tier-2 kits: ../../../content/kits/shared/tier2.js; kit contract and rules:
// server/sim/content/kits/README.md.
//
// 强攻手 (professions.js centurion): 同时攻击阻挡的所有敌人 (hitAllBlocked) — trait 无需代码。
// S2 微差爆破 (MANUAL, SKILL_RANGE on 3-2): 对前方三格范围内至多 max_target 个敌人造成 atk_scale 物理伤害。
// S1 强力击·β型 (AUTO, 攻击回复): 下次攻击的攻击力提高至 atk_scale。
// 天赋 山谷: 周围四格中有两格以上的高地地形时攻击力和防御力 +atk/+def（卫戍协议阶段地图 rows 的 'a' 为 HIGH 高台，
// 近战干员周围出现两格高台时触发；按官方机制实现）。

import { num, talentBb, skillBbOf, toggleBuff } from '@kit/tier1.js';
import { onDefaultSkill } from '@kit/tier2.js';

const S1 = 'skchr_savage_1';
const S2 = 'skchr_savage_2';
/** 周围四格 (Chebyshev-adjacent): 暴行自身的"周围四格". */
const N4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);

export default (bb, chess) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1), b2 = skillBbOf(chess, S2);
    const s2Grid = (chess?.skills ?? []).find((s) => s.skillId === S2)?.rangeGrid ?? null;
    const maxTarget = () => Math.max(1, Math.floor(num(b2.max_target, 4)));
    const burst = {
      kind: 'instant',
      targeting: { rangeGrid: s2Grid ? s2Grid.map((p) => [p[0], p[1]]) : undefined, maxTargets: maxTarget() },
      onStart({ battle, unit }) {
        if (!s2Grid) return;
        let n = maxTarget();
        for (const e of battle.unitsInGrid(unit, s2Grid, { side: 'enemy' })) {
          if (!(n > 0) || !e.alive) continue;
          n--;
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'savageBurst'] });
        }
      },
    };
    return {
      skill: sid === S2 ? burst : { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) } },
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1) } }, // 默认技能 S2 只放顶层 `skill`
      },
      talents: [{ install(battle, unit) { // 山谷: 周围四格两格以上高地 → 攻防 +
        const atk = num(talentBb(chess, 0).atk), def = num(talentBb(chess, 0).def);
        const cnt = num(talentBb(chess, 0).cnt, 2);
        if (!atk && !def) return;
        toggleBuff(battle, unit, 'talent:savage', () => {
          let n = 0;
          for (const [dr, dc] of N4) {
            const t = battle.grid.tile(unit.tileR + dr, unit.tileC + dc);
            if (t && t.height === 'HIGH') n++;
          }
          return n >= cnt;
        }, { atkPct: atk, defPct: def });
      } }],
    };
  }
