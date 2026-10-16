// workshop/rimbilliton/kits/chess_char_2_21_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Conventions of the tier-2 kits: ../../../content/kits/shared/tier2.js; kit contract and rules:
// server/sim/content/kits/README.md.
//
// 医师·群愈师 (professions.js wandermedic): 恢复友方生命并回复元素损伤 (elementHealRatio) — trait 无需代码。
// S1 精神护理 (AUTO, 时间回复, instant): 下次治疗以元素损伤最严重的 2 名干员为目标，并使其 glider_s_1.duration 秒内
//   每秒恢复 ep_heal_ratio × 攻击力的元素损伤。
// S2 振奋 (MANUAL, 时间回复, 25 s): 攻击力 +atk；每次治疗以元素损伤最严重的 attack@max_target 名干员为目标。
// 天赋 集体意识: 攻击范围内的远程干员最大生命值 +max_hp。

import { COLS } from '@sim/constants.js';
import { num, talentBb, skillBbOf, up } from '@kit/tier1.js';
import { onDefaultSkill } from '@kit/tier2.js';

const S1 = 'skchr_glider_1';
const S2 = 'skchr_glider_2';
/** 一单位最高的元素损伤条 (侵蚀 included) — 与哈洛德 重症优先 同款。 */
const elemLoad = (a) => Math.max(a.elem.burn, a.elem.neural, a.elem.necrosis, a.elem.apoptosis, a.elem.erosion ?? 0);
const isRangedOp = (a) => !!a && a.kind === 'op' && a.def?.position === 'RANGED';

export default (bb, chess) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1);
    const s1 = {
      kind: 'instant',
      heal: true,
      attack: { dmgType: 'heal', heal: { mode: 'single' } },
      targeting: { maxTargets: 2 },
      onHit({ battle, unit, target }) {
        const ratio = num(b1['glider_s_1.ep_heal_ratio'], 0);
        if (!target?.alive || target.side !== 'ally' || !(ratio > 0)) return;
        const iv = Math.max(0.05, num(b1['glider_s_1.interval'], 1));
        const times = Math.max(1, Math.floor(num(b1['glider_s_1.duration'], 2) / iv));
        const amount = unit.s.atk * ratio;
        for (let i = 0; i < times; i++) {
          battle.after(i * iv, () => { if (target.alive && target.side === 'ally') battle.reduceElement(target, amount); }, { owner: unit });
        }
      },
    };
    const s2 = {
      kind: 'duration',
      heal: true,
      mods: { atkPct: num(bb.atk) },
      attack: { dmgType: 'heal', heal: { mode: 'single' } },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))) },
    };
    return {
      skill: sid === S2 ? s2 : s1,
      skills: { [S1]: s1 }, // 默认技能 S2 只放顶层 `skill`（skillSource 'kit'）
      talents: [{ install(battle, unit) { // 集体意识: 攻击范围内远程干员最大生命 +max_hp
        const hp = num(talentBb(chess, 0).max_hp, 0);
        if (!(hp > 0)) return;
        battle.every(0.5, () => {
          const keys = unit.rangeKeySet;
          for (const a of battle.allyUnits) {
            if (!isRangedOp(a) || a.ownerId !== unit.ownerId || !keys || !keys.has(a.tileR * COLS + a.tileC)) continue;
            battle.addBuff(a, { key: 'talent:glider:collective', duration: 0.6, mods: { hpPct: hp }, tags: ['talent'] });
          }
        }, { owner: unit, immediate: true });
      } }],
      install(battle, unit) { // 元素损伤最严重的治疗目标顺序 (S1 / S2 都适用)
        const maxN = () => (unit.skill?.id === S2 ? Math.max(1, Math.floor(num(skillBbOf(chess, S2)['attack@max_target'], 2))) : 2);
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !up(unit)) return;
          const cands = Array.isArray(ctx.targets) ? [...ctx.targets] : [];
          cands.sort((a, b) => elemLoad(b) - elemLoad(a) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
          if (cands.length) ctx.targets = cands.slice(0, Math.max(1, maxN()));
        }, { owner: unit });
      },
    };
  }
