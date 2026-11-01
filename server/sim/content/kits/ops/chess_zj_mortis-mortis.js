// server/sim/content/kits/ops/chess_zj_mortis-mortis.js — 若叶睦 (char_4183_mortis) kit, 炸惊模拟 chess_zj_mortis_a.
// Helpers of the five 颂乐人偶 kits: ../shared/mujica.js; kit contract and rules: ../README.md.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/chess_zj_mortis.js` (72 lines). Record facts: tier 5,
// SPECIAL / dollkeeper, MELEE, canHitFly false, range [[0,0],[0,1]], BAT 1.2.
//   特性 (dollkeeper, professions.js): the <替身> switch itself. Her <替身> makes no attack ("<替身>不攻击") — the kit's
//   `dollNoAttack` — and the trait carries no numbers here (the pack's `tb.max_hp` / `tb.def` reads find nothing on this
//   record except the talent's own blackboard: T0 def 0.24 arrives as `defPct` on the <替身> buff).
//   T0 另一个"她" (damage_resistance 0.3, dark_damage_mul_factor 0.5, def 0.24, prob 0.2, delta_time 1):
//     · 30 % of every phys / arts HP damage she takes becomes 凋亡 element damage at HALF that amount (the pack's hpDamage
//       conversion; on 0.3.3 it is `dealElementDamage`, the element pipeline — `type: 'element'` is not a dealDamage kind);
//     · the <替身> takes DEF +24 % (a buff laid on `dollSwap` form 'doll'), and
//     · a 颂乐人偶 member's strike has `prob` to shorten the <替身>'s remaining time by `delta_time` s.
//   T1 毋畏死亡 (cnt 3, max_hp 0.1): every damage / element damage she TAKES grants 3 Fever; 颂乐人偶 members get max HP +10 %.
//   S1 多首野兽 (14 s, 26/10, TAKE_DAMAGE): DEF +65 %, block +2, and 更容易被攻击 (`taunt` 1); while it runs the <替身> keeps
//     blocking and benefits even after she is knocked out ("直到<替身>退场") — the pack's `mem.mortisShield` + the
//     `dollSwap` handler that re-lays the buff on the <替身>.
//   S2 破坏与滋养 (15 s, 27/7, the 9-tile 2-1 grid): each attack is three `attack@atk_scale` 0.75 arts shots on RANDOM
//     enemies of the range, and every hit on an enemy costs her `value` 20 arts damage of her own (tag `mortis-self`).
//   0.3.3 adaptations: the "took damage" hook is `damaged` (the pack's `damageAttempt`; 0.3.3 has none), and the 30 %
//   conversion runs on `hpDamage`, whose `amount` a handler may lower.
import { addFever } from '../../mujica.js';
import { traitBb } from '../shared/tier1.js';
import {
  num, talentBb, bbOf, skillData, live, mates, ensureMujica, enemiesInGrid, aura, attackEvent, strike, fixedLoop,
} from '../shared/mujica.js';

export default {
  chess_zj_mortis_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = traitBb(chess);
    const b1 = bbOf(chess, 'skchr_mortis_1'), b2 = bbOf(chess, 'skchr_mortis_2');
    return {
      trait: { noAttack: true, dollNoAttack: true },
      skills: {
        skchr_mortis_1: {
          kind: 'duration',
          trigger: 'TAKE_DAMAGE',
          mods: { defPct: num(b1.def), blockCnt: num(b1.block_cnt, 2), taunt: num(b1.taunt_level, 1) },
          onStart({ unit }) { unit.mem.mortisShield = true; },
          // "技能期间被击倒后，<替身>也能阻挡敌人且享受技能效果，直到<替身>退场": the flag survives the switch itself
          onEnd({ unit, reason }) { if (reason !== 'substitute') unit.mem.mortisShield = false; },
        },
        skchr_mortis_2: {
          kind: 'duration',
          targeting: { rangeGrid: skillData(chess, 'skchr_mortis_2').rangeGrid },
          mods: { batPct: num(b2.base_attack_time) / Math.max(0.1, chess.stats.bat) },
        },
      },
      install(b, u) {
        ensureMujica(b);
        // T1: 颂乐人偶 members' max HP +10 %
        b.every(0.25, () => { if (live(u)) aura(b, u, 'mujica:mortis:hp', mates(b, u), { hpPct: num(t1.max_hp, 0.1) }); }, { owner: u });
        // T1: taking damage (or element damage) grants Fever
        b.on('damaged', (c) => { if (c.target === u && live(u)) addFever(b, u, num(t1.cnt, 3)); }, { owner: u });
        // T0: 30 % of phys / arts HP damage turns into 凋亡 element damage at half the amount
        b.on('hpDamage', (c) => {
          if (c.target !== u || !['phys', 'arts'].includes(c.dmg.type) || !(c.amount > 0)) return;
          const converted = c.amount * num(t0.damage_resistance, 0.3);
          c.amount -= converted;
          b.dealElementDamage({ source: u, target: u, element: 'apoptosis', amount: converted * num(t0.dark_damage_mul_factor, 0.5), tags: ['talent', 'mortis-conversion'] });
        }, { owner: u, priority: -1000 });
        // T0 / S1: the <替身>'s own buffs; a 颂乐人偶 strike may shorten the <替身>
        b.on('dollSwap', ({ unit, form }) => {
          if (unit !== u) return;
          if (form) {
            b.addBuff(u, { key: 'mujica:mortis:doll', mods: { defPct: num(t0.def), hpMul: 1 + num(tb.max_hp) } });
            if (u.mem.mortisShield) {
              // the <替身>'s own 0 block is raised for S1: "+2 on top of the substitute's 0"
              const substitute = u.findBuff('trait:substitute');
              if (substitute) { substitute.mods.blockCnt = -2; u.markDirty(); }
              b.addBuff(u, { key: 'mujica:mortis:shield', mods: { defPct: num(b1.def), blockCnt: num(b1.block_cnt, 2), taunt: num(b1.taunt_level, 1) } });
            }
          } else {
            b.removeBuff(u, 'mujica:mortis:doll'); b.removeBuff(u, 'mujica:mortis:shield'); u.mem.mortisShield = false;
          }
        }, { owner: u });
        b.on('mujicaStrike', ({ unit: source }) => {
          if (!live(u) || !u.trait.doll || !source || source.ownerId !== u.ownerId || !mates(b, u).includes(source)) return;
          const doll = u.findBuff('trait:substitute');
          if (doll && b.rng() < num(t0.prob, 0.2)) doll.timeLeft = Math.max(0, doll.timeLeft - num(t0.delta_time, 1));
        }, { owner: u });
        // S2: "每次攻击到敌人时自身受到 20 点法术伤害"
        b.on('damaged', (c) => {
          if (c.source !== u || !live(u) || !u.skill?.active || u.skill.id !== 'skchr_mortis_2' || c.target.side !== 'enemy') return;
          if (!(c.amount > 0) || c.type === 'element' || (c.dmg.tags || []).includes('mortis-self')) return;
          b.dealDamage(u, u, { amount: num(b2.value, 20), type: 'arts', canDodge: false, tags: ['skill', 'mortis-self'] });
        }, { owner: u });
        fixedLoop(b, u, () => u.s.interval, () => {
          if (u.trait.doll) return false;
          const targets = enemiesInGrid(b, u, null, { groundOnly: true, canHitFly: false });
          if (!targets.length) return false;
          const s2 = u.skill?.active && u.skill.id === 'skchr_mortis_2';
          const deployment = u.deploySeq;
          attackEvent(b, u, targets.slice(0, 1), (chosen, attackId) => {
            const n = s2 ? 3 : 1;
            for (let i = 0; i < n; i++) b.after((s2 ? 1 / 3 + i / 10 : 13 / 30) * u.s.interval / (s2 ? 0.9 : 1.2), () => {
              if (!live(u) || deployment !== u.deploySeq || u.trait.doll || !u.canAct || u.s.flags.disarm) return;
              const now = enemiesInGrid(b, u, null, { groundOnly: true, canHitFly: false });
              // S2 "随机攻击范围内的目标"; the normal swing keeps the target it picked
              const e = s2 ? (now.length ? b.rng.pick(now) : null) : (live(chosen[0]) ? chosen[0] : now[0]);
              if (e) strike(b, u, e, s2 ? num(b2['attack@atk_scale']) : 1, { attackId, type: s2 ? 'arts' : 'phys', skill: s2 });
            }, { owner: u });
          }, s2);
        });
      },
    };
  },
};
