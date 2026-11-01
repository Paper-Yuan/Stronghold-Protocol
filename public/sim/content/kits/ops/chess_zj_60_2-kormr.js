// server/sim/content/kits/ops/chess_zj_60_2-kormr.js — 虎狼丸 (char_4220_kormr) kit, 炸惊模拟 chess_zj_60_2_a.
// Kit contract and rules: ../README.md; the helpers of tier 1: ../shared/tier1.js.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/op-kormr.js` (112 lines), which the pack registered
// under the charId. In this repository the record is the 炸惊棋库's `chess_zj_60_2_a/_b` (data/chess.json, `zhajing`,
// `visible: false`), so the kit is keyed by the CHESS id (kits/index.js ZHAJING_KIT_FILES — a charId key would silently
// fall back to the generic kit, see that list's comment).
//   1★ WARRIOR / sword, **no skill at all** (the record's `skill` is null and `skills` is empty): only the talent.
//   特性 "普通攻击连续造成两次伤害，且不受部署数量限制，但再部署时间极长":
//     · two hits per attack = the `sword` profession default (professions.js `sword: P({ hits: 2 })`) — never restated
//       here, a second `hits` would double it;
//     · 再部署时间极长 = the record's own respawnTime (200 s);
//     · 不受部署数量限制 is NOT a battle rule: it is the 卫戍 trait `garrison_zj_60_2_c` (bb `no_deploy_slot: 1`,
//       "<战斗中>部署后不占用可部署位置") on the record's `garrisonIds`, i.e. the match layer's BOARD_FULL check
//       (server/match/player/placement.js), not this kit — see handoff/ZHAJING-COVERAGE.md and the report on the 炸惊
//       garrison traits.
//   T1 黑色猎犬·I…VI (talents[0] bb): on deployment, `times` (6) slashes on the NEAREST enemy of the talent's `x-1` grid,
//     each `atk_scale` × ATK **arts** damage that cannot be dodged ("无视闪避"), the last one `final_atk_scale` × ATK and
//     `fear` s of 恐惧.
//     [ASSUMED] the schedule SLASH_AT (0 / .3 / .6 / .9 / 1.2 / 1.7 s from the deployment) is the pack's measurement of
//     char_4220_kormr.skel hits.Skill_Loop (6 OnAttack, the last one after a 0.5 s recovery); the data only gives
//     `times: 6`.
import { num, talentBb } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

/** The talent's rangeId `x-1` (the 陈 / 艾丽妮 / 陈3 S3 shape; used by those kits under the same name). */
const X_1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
  [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
/** When the `times` slashes land (s from the deployment) — char_4220_kormr.skel hits.Skill_Loop [ASSUMED]. */
const SLASH_AT = Object.freeze([0, 0.3, 0.6, 0.9, 1.2, 1.7]);
/** Slash visual (the kind 陈's S3 uses). */
const SLASH_FX = 'slash';

/** The talent grid's absolute keys at the unit's facing (no 攻击距离延伸 for a talent). */
const keysOf = (unit, grid) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);

export default {
  chess_zj_60_2_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const times = Math.max(1, Math.floor(num(t0.times, SLASH_AT.length)));
    const atkScale = num(t0.atk_scale, 1);
    const finalScale = num(t0.final_atk_scale, atkScale);
    const fear = num(t0.fear, 0);
    const grid = chess?.talents?.[0]?.rangeGrid ?? X_1;
    return {
      talents: [{
        install(battle, unit) {
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            const seq = unit.deploySeq;
            // `deploySeq` is the identity of ONE deployment (units.js): the harness fires `deploy` when the battle
            // starts and a real match fires it again on a redeploy — without this guard the 6 slashes would land twice.
            if (unit.mem.kormrTalentSeq === seq) return;
            unit.mem.kormrTalentSeq = seq;
            const here = () => unit.alive && unit.deployed && unit.deploySeq === seq;
            /** The NEAREST enemy of the talent grid, re-picked for every slash (the blocked one first: sortEnemyTargets). */
            const nearest = () => {
              const list = battle.enemiesInKeys(keysOf(unit, grid), unit, unit.profile);
              if (!list.length) return null;
              sortEnemyTargets(battle, unit, list, 'nearest');
              return list[0];
            };
            for (let i = 0; i < times; i++) {
              const last = i === times - 1;
              battle.after(SLASH_AT[Math.min(i, SLASH_AT.length - 1)], () => {
                if (!here()) return;
                const e = nearest();
                if (!e) return; // nothing in range: this slash misses, the rest still land ("总计 6 次")
                battle.fx(SLASH_FX, { x: e.x, y: e.y, id: unit.id, n: i, target: e.id, skill: 'kormr:blackdog' });
                battle.dealDamage(unit, e, {
                  amount: unit.s.atk * (last ? finalScale : atkScale),
                  type: 'arts', // the talent says 法术伤害
                  isSkill: true,
                  canDodge: false, // 无视闪避
                  tags: ['skill', 'talent', 'slash'],
                });
                if (last && e.alive && fear > 0) battle.applyStatus(e, 'fear', { duration: fear, source: unit });
              }, { owner: unit });
            }
          }, { owner: unit });
        },
      }],
    };
  },
};
