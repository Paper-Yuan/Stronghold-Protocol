// server/sim/content/kits/ops/chess_zj_60_4-yukari.js — 岳羽由加莉 (char_4219_yukari) kit, 炸惊模拟 chess_zj_60_4_a.
// Kit contract and rules: ../README.md; the helpers of tier 1: ../shared/tier1.js.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/op-yukari.js` (180 lines), re-keyed on the 炸惊棋库's
// own chess id (the pack registered it under the charId — see kits/index.js ZHAJING_KIT_FILES).
//   5★ SUPPORT / supportiveranger (游击手), RANGED, range 3-1 (10 tiles), BAT 2.1, 费 16, arts normal attack.
//   特性 "可以使用触发型效果协助作战": 0.3.3 has no generic 触发型效果 mechanism (`triggerEffect` appears nowhere), so S2
//     implements it itself: a marker buff on the allies + a `skillStart` listener that hands out the damage buff.
//   T0 治愈之风 (bb max_target 3, heal_scale 1): "技能结束后" heals herself and up to `max_target` operators in range for
//     `heal_scale` × ATK — her OWN skill only (`skillEnd` is a global hook: the pack measured a 结城理 cast healing 4 times
//     before the `ctx.unit !== unit` guard).
//   S1 龙卷箭 (instant, 32/5): the record's own numbers — three arrows at `multi_atk_scale` 0.55 × ATK arts each, then one
//     `final_atk_scale` 2.5 × ATK arts burst with `levitate` 1.5 s on every victim.
//     [ASSUMED] the hit times ARROW_AT / BURST_AT are the pack's measurement of char_4219_yukari.skel hits.Skill_1
//     (1.533 / 1.833 / 2.133 / 3.367 s); the data carries no timing.
//   S2 明镜止水 (instant, 45/10): up to `max_target` 3 allies (结城理 first, then 术师) get a trigger marker; when a marked
//     ally casts, it gains `damage_up` 0.15 damage for `duration` 15 s. "伤害提升" is ALL damage here (unlike 术法充盈): the
//     record says 造成伤害提升, not 术法, so `dmgDealtMul` is the multiplier — arts-only would be `artsDealtMul`.
import { num, talentBb } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_yukari_1';
const S2 = 'skchr_yukari_2';

/** S1's three arrows and the finishing burst (s from the cast) — char_4219_yukari.skel hits.Skill_1 [ASSUMED]. */
const ARROW_AT = Object.freeze([1.533, 1.833, 2.133]);
const BURST_AT = 3.367;
/** Radius of S1's finishing burst (tiles). */
const BURST_RADIUS = 1.5;
/** The trigger marker on an ally, and the damage buff it hands out when that ally casts. */
const TRIGGER_KEY = 'yukari:trigger';
const BOOST_KEY = 'yukari:boost';
/** Arts damage reaches air units: an empty profile for the range queries. */
const ANY = Object.freeze({ canHitFly: true });

const bbOf = (chess, id) => (chess?.skills ?? []).find((s) => s && s.skillId === id)?.bb ?? {};

export default {
  chess_zj_60_4_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2);
    const grid = chess?.rangeGrid ?? [];
    const keysOf = (unit) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
    return {
      skills: {
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const cands = battle.enemiesInKeys(keysOf(unit), unit, ANY);
            if (!cands.length) return;
            sortEnemyTargets(battle, unit, cands, null);
            const target = cands[0];
            const atk = unit.s.atk;
            const multi = num(b1.multi_atk_scale, 0.55);
            const final = num(b1.final_atk_scale, 2.5);
            const lev = num(b1.levitate, 1.5);
            for (const at of ARROW_AT) {
              battle.after(at, () => {
                if (!unit.alive || !unit.deployed) return;
                const e = target && target.alive ? target : null;
                if (!e) return;
                battle.fx('slash', { x: e.x, y: e.y, id: unit.id, n: 1, skill: 'yukari:arrow' });
                battle.dealDamage(unit, e, { amount: atk * multi, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'arrow'] });
              }, { owner: unit });
            }
            // the finishing burst: 范围法术伤害 + 浮空 every victim
            battle.after(BURST_AT, () => {
              if (!unit.alive || !unit.deployed) return;
              const e = target && target.alive ? target : null;
              const cx = e ? e.x : unit.x, cy = e ? e.y : unit.y;
              const list = (e ? [e, ...battle.foesInRadius(cx, cy, BURST_RADIUS).filter((x) => x !== e)] : []).filter((v) => v && v.alive);
              if (!list.length) return;
              battle.fx('blink', { x: cx, y: cy, id: unit.id, skill: 'yukari:burst' });
              for (const v of list) {
                battle.dealDamage(unit, v, { amount: atk * final, type: 'arts', isSkill: true, canDodge: false, isSplash: v !== e, tags: ['skill', 'burst'] });
                if (v.alive && lev > 0) battle.applyStatus(v, 'levitate', { duration: lev, source: unit });
              }
            }, { owner: unit });
          },
        },
        [S2]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const maxTarget = Math.max(1, Math.floor(num(b2.max_target, 3)));
            const dur = num(b2.duration, 15);
            const up = num(b2.damage_up, 0.15);
            if (!(up > 0)) return;
            // "优先选择结城理、术师干员": 结城理, then CASTERs, then the rest
            const cands = battle.alliesInRadius(unit.x, unit.y, 99).filter((a) => a && a.alive && a.deployed && a.kind === 'op');
            const pri = (a) => {
              if (String(a.def?.charId ?? '') === 'char_4217_makoto') return 0;
              return a.def?.profession === 'CASTER' ? 1 : 2;
            };
            cands.sort((a, z) => pri(a) - pri(z) || a.id - z.id);
            for (const a of cands.slice(0, maxTarget)) {
              battle.addBuff(a, { key: TRIGGER_KEY, persist: true, allowDead: true, data: { source: unit.id, dur, up }, tags: ['talent', 'trigger'] });
              battle.fx('buff', { x: a.x, y: a.y, id: a.id, skill: 'yukari:mirror' });
            }
          },
        },
      },
      talents: [{
        install(battle, unit) {
          const maxTarget = Math.max(1, Math.floor(num(t0.max_target, 3)));
          const healScale = num(t0.heal_scale, 1);
          // 治愈之风: after HER skill ends, heal herself and the most hurt `max_target` operators of the range
          battle.on('skillEnd', (ctx) => {
            if (ctx?.unit !== unit) return;
            if (!unit.alive || !unit.deployed) return;
            const amount = unit.s.atk * healScale;
            if (!(amount > 0)) return;
            const list = [unit, ...battle.alliesInRadius(unit.x, unit.y, 99).filter((a) => a !== unit)];
            list.sort((a, z) => (a.hpRatio ?? 1) - (z.hpRatio ?? 1));
            for (const a of list.slice(0, maxTarget)) if (a && a.alive && a.deployed) battle.heal(unit, a, amount, { source: unit });
          }, { owner: unit });
          // the trigger effect: a marked ally that casts gains the damage buff
          battle.on('skillStart', (ctx) => {
            const a = ctx && ctx.unit;
            if (!a || !a.alive || a === unit) return;
            const mark = a.findBuff ? a.findBuff(TRIGGER_KEY) : null;
            if (!mark) return;
            const d = mark.data || {};
            const dur = num(d.dur, 15), up = num(d.up, 0.15);
            if (!(up > 0)) return;
            battle.addBuff(a, { key: BOOST_KEY, duration: dur, mods: { dmgDealtMul: 1 + up }, tags: ['talent', 'trigger'] });
            battle.fx('buff', { x: a.x, y: a.y, id: a.id, skill: 'yukari:trigger' });
          }, { owner: unit });
        },
      }],
    };
  },
};
