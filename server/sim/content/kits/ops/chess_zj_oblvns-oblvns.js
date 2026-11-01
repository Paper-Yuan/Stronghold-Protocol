// server/sim/content/kits/ops/chess_zj_oblvns-oblvns.js — 丰川祥子 (char_4182_oblvns) kit, 炸惊模拟 chess_zj_oblvns_a.
// Helpers of the five 颂乐人偶 kits: ../shared/mujica.js; her note system: ../shared/mujicaNotes.js; kit contract and
// rules: ../README.md.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/chess_zj_oblvns.js` (89 lines). Record facts: tier 6,
// WARRIOR / lord, MELEE, canHitFly true, ATK 673, BAT 1.3, range 8 tiles; the record has no modules.
//   特性 "可以进行远程攻击，但此时攻击力降低至80%" (trait bb atk_scale 0.8): her attack IS a note (`noAttack`, the note does
//     the damage), and a note launched while she blocks nothing deals `rangedScale` 0.8 of her ATK — the pack's `ranged()`.
//   T0 颂乐音符 (def_penetrate_ratio 0.03, magic_resist_penetrate_ratio 0.02, max_cnt 10, delay 1, attack@angle 20): every
//     note in flight gives 颂乐人偶 members 3 % DEF ignore and 2 % RES ignore, up to `max_cnt` 10 notes.
//   T1 毋畏遗忘 (enable 1, attack_speed 16, cnt 3): damage dealt grants `cnt` 3 Fever; a 颂乐人偶 member whose own range
//     overlaps hers extends it by their tiles; and allies in HER range get ASPD +16.
//   S1 新月的苏醒 (instant, 4 SP, chargeable): eight notes whose scales fall 65 % → 4 % (`atk_scale`, `atk_scale_2` …
//     `atk_scale_8`), fanned `angle` 15° apart; a full charge auto-casts it (the pack's `fixedLoop`).
//   S2 满月的舞会 (instant, 5 SP): toggles the instrument — 钢琴 (ATK +60 %, faster, piercing physical notes) / 风琴 (ASPD
//     +80, arts notes) — as her `form` (`oblvns_s2_a` / `oblvns_s2_b`); during Fever it is a double shot.
//   S3 残月的余响 (25 s, 47/28, the 16-tile range): two piano and two organ notes per attack, `atk_scale` 1.55 each, the
//     physical ones at the highest-RES enemy and the arts ones at the highest-DEF enemy.
//   0.3.3 adaptations: the instrument's clip set is emitted as the 'phase' fx with `form` (this repository's form mechanism —
//   the pack's 'setForm' kind does not exist), and her `opCooling` guard is the engine's own accessor (`skill.opCooling`).
import { addFever, isFeverActive } from '../../mujica.js';
import { installNotes } from '../shared/mujicaNotes.js';
import { traitBb } from '../shared/tier1.js';
import {
  num, talentBb, bbOf, skillData, live, mates, isMujica, ensureMujica, enemiesInGrid, aura, attackEvent, fixedLoop,
} from '../shared/mujica.js';

export default {
  chess_zj_oblvns_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = traitBb(chess);
    const b1 = bbOf(chess, 'skchr_oblvns_1'), b2 = bbOf(chess, 'skchr_oblvns_2'), b3 = bbOf(chess, 'skchr_oblvns_3');
    const moduleRanged = chess.module?.active && chess.module.level >= 2;
    /** 特性: a note launched while she blocks nothing deals `atk_scale` 0.8 of her ATK (her S3 / 风琴 halves excepted). */
    const ranged = (u, on) => (moduleRanged && (on || u.skill?.id === 'skchr_oblvns_2') ? 1 : num(tb.atk_scale, 0.8));
    /** The instrument's clip set (`render/units.js` FORMS): 'oblvns_s2_a' piano, 'oblvns_s2_b' organ. */
    const setForm = (b, u, form) => {
      if (u.form === form) return;
      u.form = form;
      b.fx('phase', { x: u.x, y: u.y, id: u.id, kind: form, form });
    };
    return {
      trait: { noAttack: true },
      skills: {
        skchr_oblvns_1: {
          kind: 'instant',
          onStart({ battle: b, unit: u }) {
            // eight notes, 65 % → 4 % (`atk_scale`, then `atk_scale_2` … `atk_scale_8`), fanned by `angle` 15°
            const target = enemiesInGrid(b, u)[0] || null;
            for (let i = 0; i < 8; i++) {
              u.mem.mujicaLaunch?.({
                target, scale: num(b1[i === 0 ? 'atk_scale' : `atk_scale_${i + 1}`]), type: 'arts', kind: 's1', color: 'organ',
                projectile: `projectile_chr_oblvns_s1_${i + 1}`, angle: (-13.125 + 3.75 * i) * Math.PI / 180,
                rangedScale: ranged(u, true), isSkill: true,
              });
            }
          },
        },
        skchr_oblvns_2: {
          kind: 'instant',
          trigger: 'SP_FULL',
          onStart({ battle: b, unit: u }) {
            if (isFeverActive(b, u)) return; // a full Fever cast does not switch the running instrument
            u.mem.mujicaOrgan = !u.mem.mujicaOrgan;
            setForm(b, u, u.mem.mujicaOrgan ? 'oblvns_s2_b' : 'oblvns_s2_a');
          },
        },
        skchr_oblvns_3: {
          kind: 'duration',
          targeting: { rangeGrid: skillData(chess, 'skchr_oblvns_3').rangeGrid },
          mods: { aspd: num(b3['attack@attack_speed']) },
        },
      },
      install(b, u) {
        ensureMujica(b);
        const launch = u.mem.mujicaLaunch = installNotes(b, u);
        const switchSkill = u.skill?.id === 'skchr_oblvns_2';
        u.mem.mujicaSwitchSkill = switchSkill;
        const initial = () => { if (switchSkill) { u.mem.mujicaOrgan = false; setForm(b, u, 'oblvns_s2_a'); } };
        b.on('deploy', ({ unit, move }) => { if (unit === u && !move) initial(); }, { owner: u });
        b.every(0.25, () => {
          if (!live(u)) return;
          // S2's instrument aura: 钢琴 ATK +60 %, 风琴 ASPD +80
          if (switchSkill) aura(b, u, 'mujica:instrument', [u], u.mem.mujicaOrgan ? { aspd: num(b2['attack@attack_speed']) } : { atkPct: num(b2['attack@atk']) });
          // T1: an overlapping 颂乐人偶 member's range extends hers, and allies in her range get ASPD
          if (num(t1.enable) > 0) {
            const original = new Set(u.baseRangeKeys || []), extra = new Set();
            for (const a of mates(b, u)) {
              if (a === u) continue;
              const keys = a.def.charId === 'char_4182_oblvns' ? (a.baseRangeKeys || []) : (a.rangeKeys || []);
              if (keys.some((k) => original.has(k))) for (const k of keys) extra.add(k);
            }
            b.setExtraRange(u, [...extra]);
            aura(b, u, 'mujica:oblvns:speed', b.alliesInGrid(u), { aspd: num(t1.attack_speed) });
          }
          // the trait's conditional ASPD line
          if (num(tb.attack_speed) > 0 && enemiesInGrid(b, u).length >= 2) aura(b, u, 'mujica:oblvns:module', [u], { aspd: tb.attack_speed });
        }, { owner: u });
        b.on('hit', (c) => {
          if (c.source === u && c.target.side === 'enemy') addFever(b, u, num(t1.cnt, 3));
          if (!live(u) || !isMujica(c.source) || c.source.ownerId !== u.ownerId || c.target.side !== 'enemy') return;
          // T0: every note in flight ignores DEF / RES for members (max 10 notes)
          const count = Math.min(num(t0.max_cnt, 10), u.mem.mujicaNotes.length);
          c.dmg.defIgnorePct += count * num(t0.def_penetrate_ratio);
          c.dmg.resIgnorePct += count * num(t0.magic_resist_penetrate_ratio);
        }, { owner: u });
        fixedLoop(b, u, () => u.s.interval, () => {
          const targets = enemiesInGrid(b, u), on = u.skill?.active, s3 = on && u.skill.id === 'skchr_oblvns_3';
          attackEvent(b, u, targets.slice(0, 1), (selected, attackId) => {
            const deployment = u.deploySeq;
            b.after((s3 ? 0.2 : 8 / 30) * u.s.interval / 1.3, () => {
              if (!live(u) || u.deploySeq !== deployment || !u.canAct || u.s.flags.disarm) return;
              const now = enemiesInGrid(b, u), target = live(selected[0]) ? selected[0] : now[0] || null;
              if (s3) {
                // the physical notes chase the highest-RES enemy, the arts notes the highest-DEF one
                const phys = [...now].sort((a, z) => z.s.res - a.s.res || a.spawnSeq - z.spawnSeq)[0] || null;
                const arts = [...now].sort((a, z) => z.s.def - a.s.def || a.spawnSeq - z.spawnSeq)[0] || null;
                for (let i = 0; i < 2; i++) {
                  launch({ target: phys, scale: num(b3['attack@atk_scale']), type: 'phys', kind: 's3', color: 'piano', rangedScale: ranged(u, true), isSkill: true, attackId });
                  launch({ target: arts, scale: num(b3['attack@atk_scale']), type: 'arts', kind: 's3', color: 'organ', rangedScale: ranged(u, true), isSkill: true, attackId });
                }
              } else if (switchSkill) {
                const organ = !!u.mem.mujicaOrgan;
                const n = isFeverActive(b, u) ? 2 : 1; // "Fever期间变为当前音色的二连击"
                for (let i = 0; i < n; i++) launch({ target, type: organ ? 'arts' : 'phys', kind: organ ? 'organ' : 'piano', rangedScale: ranged(u, true), isSkill: true, attackId });
              } else launch({ target, rangedScale: ranged(u, false), attackId });
            }, { owner: u });
          }, on || switchSkill);
          // "充能至最大层数时自动释放一次"
          const sk = u.skill;
          if (sk?.id === 'skchr_oblvns_1' && sk.charges >= sk.maxCharges && !sk.active && !sk.opCooling) sk.activate('mujica-full');
        });
      },
    };
  },
};
