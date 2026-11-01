// server/sim/content/kits/ops/chess_zj_amoris-amoris.js — 祐天寺若麦 (char_4185_amoris) kit, 炸惊模拟 chess_zj_amoris_a.
// Helpers of the five 颂乐人偶 kits: ../shared/mujica.js; kit contract and rules: ../README.md.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/chess_zj_amoris.js` (53 lines). The record is the
// 炸惊棋库's own: chess_zj_amoris_a/_b (data/chess.json, `zhajing: true`, `visible: false`) — data facts this kit reads:
//   tier 2, WARRIOR / hammer (撼地者), MELEE, canHitFly false, BAT 1.8, range [[0,0],[0,1]].
//   特性 "攻击使目标周围的其他敌人受到相当于攻击力50%的群体物理伤害" (bb attack@ability_range_radius 1, attack@atk_scale_2 0.5):
//     the splash of EVERY hit — her normal attack included, so the engine's own attack loop is off (`noAttack`) and this
//     kit's loop (`fixedLoop`) is the attack.
//   T1 双利手 "可以进行持续攻击；攻击时10%概率使敌人获得8%脆弱，持续2秒" (prob 0.1, damage_scale 1.08, weak[limit] 2).
//   T2 毋畏爱意 "在场时每秒使Fever+3；Ave Mujica成员的攻击力+9%（+1%）" (interval 1, cnt 3, atk 0.09 at 潜能4+).
//   S1 如焰般热烈 (15 s, hits 23 SP, init 1, DEFAULT): three hits, the 1st 138 % with a wider splash (1.5 tiles), the 2nd
//     and 3rd 20 %.
//   S2 如麦般生长 (24 s, 40 SP, init 21, ACTIVE_RANGE — her range becomes the 3×3 x-4 grid): eight hits, the 1st and 5th
//     107 %, the rest 10 %, each on a RANDOM enemy of the range.
//   [ASSUMED] the pack's hit schedule (times as fractions of one 1.8 s swing: 3 / 8 hits and the tile in front when the
//   range is empty) and its S1 `targeting.rangeGrid = [[0,1]]` with `noRangeExtend` — S1's record carries no rangeGrid, so
//   the pack's forward-only net is kept verbatim rather than re-derived (it never changes the numbers, only whether her own
//   tile counts for the live range while S1 runs).
//   The pack's `mujicaSound` fx calls are audio-bank triggers 0.3.3 has no kind for; the projectile id rides in `strike`'s
//   'aoe' payload instead (see ../shared/mujica.js header).
import { addFever } from '../../mujica.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';
import {
  num, talentBb, moduleBb, bbOf, skillData, live, mates, ensureMujica, enemiesInGrid, aura, attackEvent, strike, fixedLoop,
} from '../shared/mujica.js';

export default {
  chess_zj_amoris_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), mod = moduleBb(chess), tb = chess.trait?.bb || {};
    const b1 = bbOf(chess, 'skchr_amoris_1'), b2 = bbOf(chess, 'skchr_amoris_2');
    return {
      // "可以进行持续攻击": her ordinary attack is this kit's loop, so the engine's own must not run as well.
      trait: { noAttack: true },
      skills: {
        skchr_amoris_1: { kind: 'duration', targeting: { rangeGrid: [[0, 1]], noRangeExtend: true } },
        skchr_amoris_2: { kind: 'duration', targeting: { rangeGrid: skillData(chess, 'skchr_amoris_2').rangeGrid } },
      },
      install(b, u) {
        ensureMujica(b);
        // T2: Fever +cnt every `interval` s ...
        b.every(num(t1.interval, 1), () => { if (live(u)) addFever(b, u, num(t1.cnt, 3)); }, { owner: u });
        // ... and ATK +atk for every 颂乐人偶 of the player (herself included: "Ave Mujica成员").
        b.every(0.25, () => { if (live(u)) aura(b, u, 'mujica:amoris', mates(b, u), { atkPct: num(t1.atk, 0.09) }); }, { owner: u });
        // T1: attack@prob to give the victim `damage_scale − 1` 脆弱 for `weak[limit]` s.
        b.on('hit', (c) => {
          if (c.source !== u || c.target.side !== 'enemy' || !live(u)) return;
          if (b.rng() < num(t0.prob, 0.1)) b.applyStatus(c.target, 'fragile', { value: Math.max(0, num(t0.damage_scale, 1.08) - 1), duration: num(t0['weak[limit]'], 2), source: u });
        }, { owner: u });
        // The swing: the engine's attack exchange, then every hit of it scheduled at the pack's own times.
        fixedLoop(b, u, () => u.s.interval, () => {
          const id = u.skill?.active ? u.skill.id : null;
          const s1 = id === 'skchr_amoris_1', s2 = id === 'skchr_amoris_2';
          const chosen = enemiesInGrid(b, u, null, { groundOnly: true, canHitFly: false });
          const [dr, dc] = dirVec(u.dir);
          // nothing in range and nothing in front of her: no swing this tick (no cooldown is kept)
          if (!chosen.length && (u.tileR + dr < 0 || u.tileR + dr >= 19 || u.tileC + dc < 0 || u.tileC + dc >= COLS)) return false;
          // the hit times as fractions of one swing (the pack's schedule; rate = the swing in units of 1.8 s)
          const times = s2 ? [0.1, 1 / 3, 17 / 30, 0.8, 1, 37 / 30, 44 / 30, 1.7] : s1 ? [8 / 30, 26 / 30, 44 / 30] : [20 / 30];
          const rate = u.s.interval / 1.8;
          const deployment = u.deploySeq;
          attackEvent(b, u, chosen.slice(0, 1), (targets, attackId) => {
            for (let i = 0; i < times.length; i++) b.after(times[i] * rate, () => {
              if (!live(u) || deployment !== u.deploySeq || !u.canAct || u.s.flags.disarm) return;
              const now = enemiesInGrid(b, u, null, { groundOnly: true, canHitFly: false });
              // S2 "随机攻击范围内的目标"; S1 / the normal swing keep the target they picked (the pack's rule)
              const target = s2 ? (now.length ? b.rng.pick(now) : null) : (live(targets[0]) ? targets[0] : now[0] || null);
              // S1's 1st hit "溅射范围扩大"; every other hit uses the 特性's own radius
              const radius = s1 && i === 0 ? 1.5 : num(tb['attack@ability_range_radius'], 1);
              let scale = s2 ? num(i === 0 || i === 4 ? b2['attack@atk_scale_heavy'] : b2['attack@atk_scale_light'])
                : s1 ? num(i === 0 ? b1['attack@atk_scale_heavy'] : b1['attack@atk_scale_light']) : 1;
              // an empty range under S2 still swings: the blow lands on a tile of her own range
              const key = s2 && !target && u.rangeKeys.length ? b.rng.pick(u.rangeKeys) : null;
              const point = key == null ? { x: u.x + dc, y: u.y + dr } : { x: key % COLS, y: Math.floor(key / COLS) };
              const pos = target || point;
              // module (none on this record: moduleBb is {}) / 特性: enemies crowded around the impact take e_002 × the hit
              if (num(mod['attack@e_002_atk_scale'], num(tb.atk_scale_e)) > 0 && b.enemiesInRadius(pos.x, pos.y, radius).filter((e) => !e.isFlying).length >= num(mod['attack@cnt'], num(tb.cnt, 3))) scale *= num(mod['attack@e_002_atk_scale'], tb.atk_scale_e);
              const projectile = s1 || s2 ? `projectile_chr_amoris_s${s2 ? 2 : 1}_${i === 0 || (s2 && i === 4) ? 1 : 2}` : 'projectile_chr_amoris';
              strike(b, u, target, scale, { attackId, skill: s1 || s2, splash: radius, splashScale: num(tb['attack@atk_scale_2'], 0.5), point, projectile });
            }, { owner: u });
          }, s1 || s2);
        });
      },
    };
  },
};
