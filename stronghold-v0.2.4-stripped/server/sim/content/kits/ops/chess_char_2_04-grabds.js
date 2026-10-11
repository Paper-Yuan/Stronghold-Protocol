// server/sim/content/kits/ops/chess_char_2_04-grabds.js — 小满 (char_4122_grabds) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import {
  num, talentBb, moduleBb, traitBb, enemiesInGrid, enemyInRange, statBuff, spTimeBonus, instantKind,
} from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_04 小满 乡音沉沉: stops attacking and puts max_target enemies in range to sleep `sleep` s; afterwards ASPD
  // +attack_speed and attacks max_target enemies. 好好听话: ASPD +attack_speed; vs 【野生动物】 (tag `infection`,
  // "野生的被感染生物") the trait 停顿 lasts +sluggish_addition s. Elite module (DEC-X): +sp_recovery_per_sec SP/s with
  // an enemy in range.
  // S1 竹笛飞声 (alt, 2 charges): the next attack deals atk_scale × ATK arts and hits one more enemy (+1 target).
  chess_char_2_04_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const n = Math.max(1, Math.floor(num(bb.max_target, 1)));
    const sleep = num(bb.sleep);
    return {
      trait: {
        onHitStatus: null,
        canAttack: (battle, u) => !(u.skill?.active && battle.time < (u.mem.grainQuietUntil ?? -1)),
        afterHit(battle, u, target) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const beast = (target.def?.tags || []).includes('infection');
          battle.applyStatus(target, 'sluggish', { duration: num(tb.sluggish, 0.8) + (beast ? num(t.sluggish_addition) : 0), source: u });
        },
      },
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        targeting: { maxTargets: n, rangeGrid: def?.skill?.rangeGrid ?? null },
        onStart({ battle, unit }) {
          unit.mem.grainQuietUntil = battle.time + sleep;
          for (const e of enemiesInGrid(battle, unit, def?.skill?.rangeGrid ?? null, { n })) {
            if (battle.applyStatus(e, 'sleep', { duration: sleep, source: unit })) battle.fx('sleep', { x: e.x, y: e.y, id: e.id });
          }
        },
      },
      skills: {
        skchr_grabds_1: { kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1), dmgType: 'arts' }, mods: { maxTargets: 1 } },
      },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:grabds', { aspd: num(t.attack_speed) });
        spTimeBonus(battle, unit, num(moduleBb(chess).sp_recovery_per_sec), () => enemyInRange(battle, unit));
      } }],
    };
  },
};
