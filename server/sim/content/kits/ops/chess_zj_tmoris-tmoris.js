// server/sim/content/kits/ops/chess_zj_tmoris-tmoris.js — 八幡海铃 (char_4186_tmoris) kit, 炸惊模拟 chess_zj_tmoris_a.
// Helpers of the five 颂乐人偶 kits: ../shared/mujica.js; kit contract and rules: ../README.md.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/chess_zj_tmoris.js` (62 lines). Record facts: tier 3,
// SPECIAL / stalker, MELEE, blockCnt 0, BAT 3.5, canHitFly false.
//   特性 "对攻击范围内所有敌人造成伤害 / 拥有50%的物理和法术闪避且不容易成为敌人的攻击目标": the attack-all half is this
//     kit's one swing (every enemy of the range, `noAttack` keeps the engine's own single-target loop off) and the dodge +
//     taunt half is the `stalker` profession's own buff (professions.js `trait:stalker` with the record's trait bb
//     `prob: 0.5` → dodgePhys / dodgeArts 0.5, taunt −1) — so the kit must not add it again.
//   T1 应召而至 (talent bb prob 0.21, sluggish 3, mark 1): her talent's own rangeGrid (the wide 13-tile grid, `mark`) is the
//     attack range while `mark` is set; an attack has `prob` to 停顿 the victim 3 s, which also grants Fever. "对停顿/恐惧
//     中的敌人伤害 +(damage_scale − 1) %" is T2's own line.
//   T2 毋畏恐惧 (damage_scale 1.15, cnt 2): a hit on a 停顿 / 恐惧 enemy deals ×1.15 (the DamageInfo `mul`), and a successful
//     停顿 grants `cnt` Fever.
//   S1 颤栗之弦 (2.1 s, 5/0): five arts strikes of `atk_scale` 0.61 × ATK on everything in range; an ally's cast re-casts
//     it for free ("八幡海铃的技能…" — the record's own line, the pack's `skillStart` relay).
//   S2 无存之所 (15 s, 46/20): instantly 恐惧 1.5 s every enemy in range, then arts damage `attack@atk_scale` 0.78 × ATK to
//     everything in range every `attack@interval` 1 s, and T1's 停顿 chance × `talent_scale` 1.7.
//   [ASSUMED] S1's five hit times (11/30 + i·4/30 s) — the pack's schedule; the record only gives `times: 5`.
//   0.3.3 adaptation: the 恐惧 status key is `fear` (the pack's 'feared' is the immunity name here), and `addFever` counts
//   every 恐惧 attempt (`cnt`), immune targets included, as PRTS requires.
import { addFever } from '../../mujica.js';
import { talentGrid } from '../shared/tier1.js';
import {
  num, talentBb, bbOf, live, isMujica, ensureMujica, enemiesInGrid, attackEvent, fixedLoop,
} from '../shared/mujica.js';

export default {
  chess_zj_tmoris_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, 'skchr_tmoris_1'), b2 = bbOf(chess, 'skchr_tmoris_2');
    // T1 `mark`: the talent's own wide grid replaces her 3-3 attack net while it is set
    const range = num(t0.mark) ? (talentGrid(chess, 0) ?? chess.rangeGrid) : chess.rangeGrid;
    return {
      trait: { noAttack: true },
      skills: {
        skchr_tmoris_1: {
          kind: 'duration',
          targeting: { rangeGrid: range },
          onStart({ battle: b, unit: u, skill }) {
            const activation = skill.activations;
            for (let i = 0; i < num(b1.times, 5); i++) b.after(11 / 30 + i * 4 / 30, () => {
              if (!live(u) || !skill.active || activation !== skill.activations) return;
              const targets = enemiesInGrid(b, u, range, { groundOnly: true, canHitFly: false });
              for (const e of targets) b.dealDamage(u, e, { amount: u.s.atk * num(b1.atk_scale, 0.61), type: 'arts', isSkill: true, tags: ['skill', 'tmoris'] });
              b.emit('mujicaStrike', { unit: u });
              b.fx('sonic', { x: u.x, y: u.y, id: u.id, skill: 'skchr_tmoris_1', radius: 2 });
            }, { owner: u });
          },
        },
        skchr_tmoris_2: {
          kind: 'duration',
          targeting: { rangeGrid: range },
          onStart({ battle: b, unit: u }) {
            u.mem.mujicaAttackReset = true;
            for (const e of enemiesInGrid(b, u, range, { groundOnly: true, canHitFly: false })) {
              b.applyStatus(e, 'fear', { duration: num(b2.fear, 1.5), source: u });
              addFever(b, u, num(t1.cnt, 2)); // a 恐惧 attempt counts even on an immune target (PRTS)
            }
          },
        },
      },
      install(b, u) {
        ensureMujica(b);
        fixedLoop(b, u, () => (u.skill?.active && u.skill.id === 'skchr_tmoris_2' ? num(b2['attack@interval'], 1) : u.s.interval), () => {
          if (u.skill?.active && u.skill.id === 'skchr_tmoris_1') return false; // S1's own five strikes are the attack
          const targets = enemiesInGrid(b, u, null, { groundOnly: true, canHitFly: false });
          if (!targets.length) return false;
          attackEvent(b, u, targets, (chosen, attackId) => {
            const s2 = u.skill?.active && u.skill.id === 'skchr_tmoris_2';
            for (const e of chosen) b.dealDamage(u, e, { amount: u.s.atk * u.s.atkScaleMul * (s2 ? num(b2['attack@atk_scale'], 0.78) : 1), type: s2 ? 'arts' : 'phys', isAttack: true, isSkill: s2, attackId });
            b.emit('mujicaStrike', { unit: u, attackId });
          });
        });
        b.on('hit', (c) => {
          if (!live(u) || c.target.side !== 'enemy') return;
          if (c.source === u) {
            // T1 停顿: prob × S2's talent_scale while S2 runs
            const p = num(t0.prob, 0.21) * (u.skill?.active && u.skill.id === 'skchr_tmoris_2' ? num(b2.talent_scale, 1.7) : 1);
            if (b.rng() < p && b.applyStatus(c.target, 'sluggish', { duration: num(t0.sluggish, 3), source: u })) addFever(b, u, num(t1.cnt, 2));
          }
          // T2: a hit on a 停顿 / 恐惧 enemy deals ×damage_scale
          if (isMujica(c.source) && c.source.ownerId === u.ownerId && (c.target.hasBuff('sluggish') || c.target.hasBuff('fear'))) c.dmg.mul *= num(t1.damage_scale, 1.15);
        }, { owner: u });
        // an ally's cast re-casts S1 for free (the record's own line)
        b.on('skillStart', ({ unit: other }) => {
          if (other === u || !live(u) || !isMujica(other) || other.ownerId !== u.ownerId) return;
          if (u.skill?.id !== 'skchr_tmoris_1' || u.skill.active || !u.canAct || u.s.flags.silence) return;
          u.skill.activate('mujica-bonus', { free: true });
        }, { owner: u });
      },
    };
  },
};
