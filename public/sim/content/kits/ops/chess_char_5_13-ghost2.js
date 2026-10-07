// server/sim/content/kits/ops/chess_char_5_13-ghost2.js — 归溟幽灵鲨 (char_1023_ghost2) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import {
  AURA_IV, AURA_DUR, num, talent, traitBb, skillGrid, batPct, mods, isAbyssal, isOp, selectedId, lazySkills, whileOn,
} from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 归溟幽灵鲨 — dollkeeper (professions.js installDollkeeper: the 替身 form, its switch animations, 阻回). Her <替身> makes
  // no normal attack (PRTS 特性备注 "<替身>不进行普通攻击") and so casts no skill (kit trait `dollNoAttack`).
  // S2 生存的渴望 (15/17 s): ATK/ASPD +, HP never below 1 (PRTS 备注: 不死 — a lethal hit does not switch her meanwhile);
  // when it ends she switches to the 替身 at once (PRTS 修正 "技能结束后立刻切换为<替身>", the text's 视为被击倒: no lethal
  // HP loss, so no 不死 / 复活 effect takes it). T1 拥抱自我: the 替身 slows nearby enemies −40 % and deals 40 % ATK
  // arts/s to them (PRTS 备注 "伤害与减速不可对空": ground enemies only) — once it fights (not during its switch
  // animation). T2 阿戈尔的深邃: Abyssal Hunters in the team max HP +20 %. Module (elite): substitute ATK +15 %.
  // S1 生存的技巧 (duration): swaps HP ratios with the other operator of the skill area (周围) with the lowest HP ratio,
  // ATK +. S3 生存的重压 (duration): BAT +1 s, hits every blocked enemy, ATK +, max HP +; an attacked enemy whose HP ratio
  // is ≥ hers takes attack@atk_scale_ex × ATK phys more, otherwise she loses attack@hp_ratio of her max HP.
  // Module PUM-Y (elite): substitute max HP +20 %.
  chess_char_5_13_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const aroundGrid = chess?.trait?.rangeGrid ?? [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
    return {
      skills: lazySkills({
        skchr_ghost2_1: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          onStart({ battle, unit }) {
            const t = battle.unitsInGrid(unit, skillGrid(chess, def) ?? aroundGrid, { side: 'ally' }).filter((a) => a !== unit && isOp(a) && a.hp > 0)
              .sort((a, b) => a.hpRatio - b.hpRatio || a.id - b.id)[0];
            if (!t) return;
            const mine = unit.hpRatio, theirs = t.hpRatio;
            unit.hp = Math.max(1, Math.min(unit.s.maxHp, unit.s.maxHp * theirs));
            t.hp = Math.max(1, Math.min(t.s.maxHp, t.s.maxHp * mine));
            battle.fx('hpShare', { x: t.x, y: t.y, id: unit.id, to: t.id });
          },
        }),
        skchr_ghost2_3: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), hpPct: num(bb.max_hp), batPct: batPct(bb.base_attack_time, chess) }),
          attack: {
            hitAllBlocked: true,
            onEachHit({ battle, unit, target, kind }) {
              if (kind !== 'main' || !target || target.side !== 'enemy') return;
              if (unit.mem.ghostHeavy?.get(target)) {
                if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb['attack@atk_scale_ex']), type: 'phys', isSkill: true, tags: ['skill', 'ghost2Weight'] });
              } else if (unit.alive) battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio']), { source: unit });
            },
          },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
        // "技能结束后立刻切换为<替身>": nothing when the skill ended with her (death) or by her switch to the 替身, or she
        // already is one
        onEnd({ battle, unit, reason }) {
          if (reason === 'death' || reason === 'substitute' || !unit.alive || !unit.deployed || unit.trait.doll) return;
          battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
        },
      },
      trait: { dollNoAttack: true },
      talents: [
        { install(battle, unit) { // 拥抱自我 (the 替身 fighting: not during a switch animation)
          const slow = num(t0.move_speed), scale = num(t0.atk_scale);
          whileOn(battle, unit, AURA_IV, () => {
            if (!unit.trait.doll || unit.trait.dollSwitching || !slow) return;
            for (const e of battle.unitsInGrid(unit, aroundGrid, { side: 'enemy' })) if (!e.isFlying) battle.addBuff(e, { key: 'ghost2:embrace', duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + slow) } });
          });
          whileOn(battle, unit, 1, () => {
            if (!unit.trait.doll || unit.trait.dollSwitching || !(scale > 0)) return;
            for (const e of battle.unitsInGrid(unit, aroundGrid, { side: 'enemy' })) if (!e.isFlying) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'embrace'] });
          });
        } },
        { install(battle, unit) { // 阿戈尔的深邃
          const hp = num(t1.max_hp);
          if (!hp) return;
          battle.on('battleStart', () => {
            for (const a of battle.getPlayer(unit.ownerId)?.units ?? []) if (isOp(a) && isAbyssal(a)) battle.addBuff(a, { key: 'ghost2:abyss', mods: { hpPct: hp }, persist: true, allowDead: true });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S2: HP never below 1 while it runs
        if (!sid || sid === 'skchr_ghost2_2') battle.on('fatal', (c) => { if (c.unit === unit && unit.skill?.active) c.prevented = true; }, { owner: unit, priority: 10 });
        if (sid === 'skchr_ghost2_3') { // S3: 生命比例高于或等于自身 — judged when the attack starts
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active) return;
            unit.mem.ghostHeavy = new Map(c.targets.filter(Boolean).map((t) => [t, t.hpRatio >= unit.hpRatio - 1e-9]));
          }, { owner: unit, priority: -100 });
        }
        const hpUp = num(tb.max_hp); // PUM-Y: 替身…生命值提升
        if (hpUp) whileOn(battle, unit, 0.2, () => { if (unit.trait.doll) battle.addBuff(unit, { key: 'ghost2:moduleY', duration: 0.3, mods: { hpPct: hpUp } }); });
        const atk = num(tb.atk);
        if (atk) {
          whileOn(battle, unit, 0.2, () => {
            if (unit.trait.doll) battle.addBuff(unit, { key: 'ghost2:module', duration: 0.3, mods: { atkPct: atk } });
          });
        }
      },
    };
  },
};
