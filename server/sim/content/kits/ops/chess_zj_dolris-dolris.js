// server/sim/content/kits/ops/chess_zj_dolris-dolris.js — 三角初华 (char_4184_dolris) kit, 炸惊模拟 chess_zj_dolris_a.
// Helpers of the five 颂乐人偶 kits: ../shared/mujica.js; kit contract and rules: ../README.md.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/chess_zj_dolris.js` (83 lines). Record facts: tier 4,
// SUPPORT / bard, RANGED, canHitFly false, ATK 346, BAT 1.3; the record's trait bb is `atk_to_hp_recovery_ratio` 0.1.
//   特性 吟游者 ("不攻击，持续恢复范围内所有友军生命（每秒相当于自身攻击力10%的生命），自身不受鼓舞"): the no-attack and
//     the per-second regen are the `bard` profession's (professions.js installBard / bardRegen, ratio from the trait bb);
//     "自身不受鼓舞" is this kit's own `mem.noInspire` + the sweep that removes any 鼓舞 already on her.
//   T1 谎言的假面 (attack@heal_cd 4, attack@heal_scale 0.35): out of combat she heals one ally for 0.35 × ATK every 4 s.
//   T2 毋畏悲伤 (normal_cnt 5, atk_scale 0.3): every heal she gives a 颂乐人偶 grants 5 Fever; a 颂乐人偶 ally's attack on an
//     enemy inside HER range takes 0.3 × ATK arts more (the `dolris-rider` rider, once per hit).
//   S1 我思念的 (30 s, 45/21, range becomes the 21-tile grid): allies' 鼓舞 — ATK +30 % and DEF +30 % — and any ally damage
//     inside her range is answered with a flat 65 HP heal (attack@heal_value_s1), on 丰川祥子 first.
//   S2 我悲悯的 (12 s, 37/12): every `interval` 0.3 s — 0.7 × ATK arts to a RANDOM enemy in range, 0.15 × ATK heal to one
//     ally; 鼓舞 becomes ATK +80 % and the 特性's regen stops ("技能期间特性不再恢复生命").
//   [ASSUMED] the pack's 鼓舞 divisor (inspire() divides by the target's own stat multipliers so the number reads as
//   written) and its "丰川祥子 first" ordering.
//   0.3.3 adaptations: `b.heal(source, target, amount, opts)` is the positional heal; the heal hook is `heal` (the pack's
//   `healed`) with `opts.regen` marking the 吟游者 regen; the module block is empty on this record (no modules).
import { bardRegen } from '../../../professions.js';
import { addFever } from '../../mujica.js';
import { traitBb } from '../shared/tier1.js';
import {
  num, talentBb, moduleBb, bbOf, skillData, live, charId, isMujica, ensureMujica, enemiesInGrid, aura, inspire, fixedLoop,
  healTarget, inRange,
} from '../shared/mujica.js';

export default {
  chess_zj_dolris_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), mod = moduleBb(chess), tb = traitBb(chess);
    const b1 = bbOf(chess, 'skchr_dolris_1'), b2 = bbOf(chess, 'skchr_dolris_2');
    /** A heal of hers: 丰川祥子's share is raised by the module's sp_scale_up (this record has no module: ×1). */
    const heal = (b, u, a, amount) => b.heal(u, a, amount * (charId(a) === 'char_4182_oblvns' ? num(mod.sp_scale_up, 1) : 1));
    return {
      skills: {
        skchr_dolris_1: {
          kind: 'duration',
          trigger: 'SP_FULL',
          targeting: { rangeGrid: skillData(chess, 'skchr_dolris_1').rangeGrid },
        },
        skchr_dolris_2: {
          kind: 'duration',
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            unit.mem.mujicaDolrisPulse = 0;
            // "技能期间特性不再恢复生命": drop the 吟游者 regen the profession keeps on every ally in range
            for (const ally of battle.allyUnits) battle.removeBuff(ally, `trait:bard:${unit.id}`);
          },
          onTick({ battle: b, unit: u, dt }) {
            u.mem.mujicaDolrisPulse += dt;
            const interval = Math.max(0.05, num(b2.interval, 0.3));
            while (u.mem.mujicaDolrisPulse >= interval - 1e-9) {
              u.mem.mujicaDolrisPulse -= interval;
              const foes = enemiesInGrid(b, u);
              const e = foes.length ? b.rng.pick(foes) : null;
              if (e) {
                b.dealDamage(u, e, { amount: u.s.atk * num(b2['attack@atk_scale'], 0.7), type: 'arts', isSkill: true, tags: ['skill', 'dolris'] });
                b.fx('sonic', { x: e.x, y: e.y, id: u.id, skill: 'skchr_dolris_2', radius: 0.4 });
              }
              const a = healTarget(b, u, true);
              if (a) heal(b, u, a, u.s.atk * num(b2['attack@heal_scale'], 0.15));
            }
          },
        },
      },
      trait: {
        noAttack: true,
        install(b, u) {
          u.mem.noInspire = true;
          b.every(0.25, () => {
            if (!live(u)) return;
            // "自身不受鼓舞": drop any 鼓舞 an ally handed her (三角初华's own S1/S2 skip her, this covers the rest)
            for (const x of u.buffs.slice()) if (x.key === 'inspire' || x.key.startsWith('inspire:')) b.removeBuff(u, x);
            const allies = b.alliesInGrid(u), active = u.skill?.active;
            const s2 = active && u.skill.id === 'skchr_dolris_2';
            if (!s2) for (const a of allies) bardRegen(b, u, a, u.s.atk * num(tb.atk_to_hp_recovery_ratio, 0.1));
            if (active) for (const a of allies) {
              if (a === u) continue;
              inspire(b, u, a, u.s.atk * num((s2 ? b2 : b1)['attack@atk']));
              if (!s2) inspire(b, u, a, u.s.def * num(b1['attack@def']), 'def');
            }
            if (num(mod.atk) > 0 && allies.filter((a) => a !== u && a.kind === 'op').length >= num(mod.cnt, 2)) aura(b, u, 'mujica:dolris:module', [u], { atkPct: mod.atk });
          }, { owner: u });
        },
      },
      install(b, u) {
        ensureMujica(b);
        // T1: out of combat, one ally heal every attack@heal_cd s
        fixedLoop(b, u, num(t0['attack@heal_cd'], 4), () => {
          if (u.skill?.active) return false;
          const a = healTarget(b, u);
          if (!a) return false;
          heal(b, u, a, u.s.atk * num(t0['attack@heal_scale'], 0.35));
          u.lastAttackAt = b.time; u.stats.attacks++; b._ev(['atk', u.id, a.id, 'heal']);
          b.emit('attack', { attacker: u, targets: [a], isSkill: false });
          b.emit('mujicaStrike', { unit: u });
        });
        // T2: every heal of a 颂乐人偶 grants Fever (the 吟游者 regen is not a heal: opts.regen)
        b.on('heal', (c) => {
          if (c.source === u && !c.opts?.regen && isMujica(c.target)) addFever(b, u, num(t1.normal_cnt, 5));
        }, { owner: u });
        // S1: an ally hurt inside her range is healed back for the flat attack@heal_value_s1 (丰川祥子 first)
        b.on('hpDamage', (c) => {
          if (!live(u) || !u.skill?.active || u.skill.id !== 'skchr_dolris_1' || !inRange(u, c.target) || c.target.side !== 'ally') return;
          const special = healTarget(b, u, true);
          const a = charId(special) === 'char_4182_oblvns' ? special : c.target;
          heal(b, u, a, num(b1['attack@heal_value_s1']));
        }, { owner: u });
        // T2 rider: a 颂乐人偶 ally's hit on an enemy inside her range takes atk_scale × ATK arts more
        b.on('hit', (c) => {
          if (!live(u) || !isMujica(c.source) || c.source.ownerId !== u.ownerId || c.target.side !== 'enemy' || !inRange(u, c.source)) return;
          if ((c.dmg.tags || []).includes('dolris-rider')) return;
          b.dealDamage(u, c.target, { amount: u.s.atk * num(t1.atk_scale, 0.3), type: 'arts', sourceless: true, tags: ['talent', 'dot', 'dolris-rider'] });
        }, { owner: u });
      },
    };
  },
};
