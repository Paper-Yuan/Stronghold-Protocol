// server/sim/content/kits/ops/chess_char_1_13-podego.js — 波登可 (char_258_podego) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import {
  num, talentBb, moduleBb, up, enemiesInGrid, enemyInRange, installAura, spTimeBonus, makeZone, skillBbOf,
} from '../shared/tier1.js';

// =================================================================================================================
// tier-local constants that exist nowhere in data

/** Radius (tiles) of 波登可's spore cloud. No blackboard key; PRTS 波登可 备注 "孢子群范围半径为0.9，可对空". */
const SPORE_RADIUS = 0.9;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_13 波登可 孢子扩散: a vial bursts on the current target into a projectile_delay_time s spore cloud (radius 0.9,
  // PRTS 备注, 可对空): enemies inside are 停顿 and lose their abilities (silence) and take atk_scale × ATK arts per second.
  // 园丁: every 【辅助】 operator on the field ATK +atk. Elite module (DEC-X): +sp_recovery_per_sec SP/s with an enemy in range.
  // Alternate S1 花香疗法: ATK +atk, normal attacks heal the most injured ally in range instead (ATK per attack). A heal
  // skill: DEFAULT fires it with an injured ally inside her initial range (research 03 §1.4) — also checked every tick,
  // since she is only "about to attack" with an enemy in range.
  chess_char_1_13_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const spBonus = num(moduleBb(chess).sp_recovery_per_sec);
    const dur = num(bb.projectile_delay_time, 5);
    const S1 = 'skchr_podego_1';
    return {
      skills: {
        [S1]: { kind: 'duration', heal: true, mods: { atkPct: num(skillBbOf(chess, S1).atk) }, attack: { dmgType: 'heal', heal: { mode: 'single' } } },
      },
      install(battle, unit) {
        if (unit.skill?.id !== S1) return;
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!up(unit) || !unit.canAct || !sk.ready || sk.active || sk.opCooling || unit.s.flags.silence) return;
          if (battle.injuredAlliesInKeys(unit.baseRangeKeys || unit.rangeKeys, unit).length) sk.activate('DEFAULT');
        }, { owner: unit });
      },
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const tgt = enemiesInGrid(battle, unit, null, { n: 1 })[0];
          const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
          const atk = unit.s.atk;
          makeZone(battle, unit, {
            x, y, radius: SPORE_RADIUS, duration: dur, skill: 'spores', onPulse(b) {
              for (const e of b.foesInRadius(x, y, SPORE_RADIUS)) {
                if (e.s.flags.untargetable) continue;
                b.applyStatus(e, 'sluggish', { duration: 1.05, source: unit });
                b.applyStatus(e, 'silence', { duration: 1.05, source: unit });
                b.dealDamage(unit, e, { amount: atk * num(bb.atk_scale), type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
              }
            },
          });
        },
      },
      talents: [{ install(battle, unit) {
        const v = num(t.atk);
        if (v) installAura(battle, unit, { key: 'talent:podego', value: v, select: (a) => a.kind === 'op' && a.def.profession === 'SUPPORT', mods: { atkPct: v } });
        spTimeBonus(battle, unit, spBonus, () => enemyInRange(battle, unit));
      } }],
    };
  },
};
