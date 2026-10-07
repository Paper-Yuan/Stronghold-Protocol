// server/sim/content/kits/ops/standin-acguad.js — Sharp (char_609_acguad, 卫戍协议 6★ 近卫·无畏者) 补位 stand-in kit.
// Stands in for 忍冬 (tier 3, S3), 银灰 / 百炼嘉维尔 (tier 4, S2), 隐德来希 / 归溟幽灵鲨 (tier 5, S3 + DRE-X) and 佩佩
// (tier 6, S3 + DRE-X): data/backups.json `units.char_609_acguad.standsIn`. Kit contract: ../README.md "Stand-in kits".
// Numbers: the blackboards of data/backups.json (skill_table / character_table / battle_equip_table at E2 Lv1 skill
// level 4 and E2 Lv60 skill level 7); what the data does not carry: PRTS Sharp(卫戍协议), cited where used.

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff } from '../shared/tier1.js';

const S1 = 'skchr_acguad_1';
const S2 = 'skchr_acguad_2';
const S3 = 'skchr_acguad_3';
/** 力战不竭's ATK layers: one buff whose stacks are the layers. */
const STACK_KEY = 'acguad:s3stack';

export default {
  // Sharp — talent 1 隐匿刀刃: ATK +atk, physical dodge prob (DRE-X levels 2 / 3 upgrade both). Talent 2 寸步不退: after
  // `interval` s on the field (each deployment), ASPD +attack_speed.
  // S1 快刀: ATK +atk; each attack becomes a double hit with attack@prob1 (data trigger: SKILL_RANGE on its 1-1 range).
  // S2 亮剑: DEF to 0 (no blackboard key: the text "防御力降至0" — a final ×0, so no DEF bonus survives it), max HP
  // +max_hp, every attack at attack@atk_scale.
  // S3 力战不竭: ATK +atk; before each attack +atk_each_stack ATK (one layer, at most max_atk_stack_cnt), all layers lost
  // when the target changes; HP never below 1 while it runs. PRTS 备注: "“每次攻击时获得增益”在每次成功攻击前判定，至少生效1层
  // 增益，持续至技能结束" — the first attack on a target already has one layer, and the layers last until the skill ends.
  // Module DRE-X (trait atk_scale): "攻击被阻挡的敌人时攻击力提升至115%" — an enemy blocked by anyone, as 斯卡蒂's DRE-X.
  // Ground only, ground-targetable (data canHitFly false, no flag). S2 / S3 cast by the data trigger (DEFAULT).
  char_609_acguad: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const blockedScale = num(traitBb(chess).atk_scale, 0);
    const b1 = skillRec(chess, S1)?.bb ?? {}, b2 = skillRec(chess, S2)?.bb ?? {}, b3 = skillRec(chess, S3)?.bb ?? {};
    const doubleProb = num(b1['attack@prob1'], 0.2);
    const layer = num(b3.atk_each_stack, 0), maxLayers = Math.max(1, Math.floor(num(b3.max_atk_stack_cnt, 8)));
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) }, attack: { hitsFn: (battle) => (battle.rng.chance(doubleProb) ? 2 : 1) } },
        [S2]: { kind: 'duration', mods: { defMul: 0, hpPct: num(b2.max_hp) }, attack: { atkScale: num(b2['attack@atk_scale'], 1) } },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          onStart({ battle, unit }) {
            battle.removeBuff(unit, STACK_KEY);
            unit.mem.acguadTarget = null;
            if (unit.mem.acguadUndying) battle.off(unit.mem.acguadUndying);
            // "技能持续期间内干员的生命值始终不会低于1": every HP loss, 流失 included (a kit saver, as 幽灵鲨 S2)
            unit.mem.acguadUndying = battle.on('fatal', (c) => { if (c.unit === unit && unit.skill?.active) c.prevented = true; }, { owner: unit, priority: 10 });
          },
          onEnd({ battle, unit }) {
            if (unit.mem.acguadUndying) battle.off(unit.mem.acguadUndying);
            unit.mem.acguadUndying = null;
            battle.removeBuff(unit, STACK_KEY);
            unit.mem.acguadTarget = null;
          },
        },
      },
      talents: [
        { install(battle, unit) { statBuff(battle, unit, 'acguad:t1', { atkPct: num(t0.atk), dodgePhys: num(t0.prob) }); } },
        { install(battle, unit) {
          const after = num(t1.interval, 30);
          toggleBuff(battle, unit, 'acguad:t2', () => battle.time - unit.deployedAt >= after - 1e-9, { aspd: num(t1.attack_speed) });
        } },
      ],
      trait: blockedScale > 0 ? { dmgMul: (battle, unit, target) => (target && target.blockedBy ? blockedScale : 1) } : undefined,
      install(battle, unit) {
        if (unit.skill?.id !== S3 || !(layer > 0)) return;
        // 力战不竭's layers: decided before every attack the skill makes (after the other beforeAttack handlers, on the
        // attack's final main target); a new target clears them first, so its first attack has one layer
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || !unit.skill.active) return;
          const target = (c.targets || []).find((t) => t && t.alive);
          if (!target) return;
          if (unit.mem.acguadTarget !== target) {
            battle.removeBuff(unit, STACK_KEY);
            unit.mem.acguadTarget = target;
          }
          battle.addBuff(unit, { key: STACK_KEY, mods: { atkPct: layer }, refresh: 'stack', maxStacks: maxLayers, tags: ['skill'] });
        }, { owner: unit, priority: -100 });
      },
    };
  },
};
