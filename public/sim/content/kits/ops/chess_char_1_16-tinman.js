// server/sim/content/kits/ops/chess_char_1_16-tinman.js — 锡人 (char_4151_tinman) kit, tier 1 (hidden).
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, moduleBb, enemiesInGrid, once, spTimeBonus, makeZone, instantKind } from '../shared/tier1.js';

// =================================================================================================================
// kit builders shared by two chess ids

/**
 * 锡人 “大拉里” (chess_char_1_16 hidden and chess_char_2_19): throw an alchemy unit at the current target —
 * for projectile_delay_time s, ground enemies within projectile_range tiles take atk_scale × ATK arts per second,
 * allies there recover hp_recovery_per_sec_ratio × ATK per second. Elite: 凋敝魂灵 (skill@damage_scale: damage-over-
 * time taken by ground enemies inside a unit ×1.2) and the module's +sp_recovery_per_sec SP while a unit exists.
 * PRTS 锡人 技能2 备注: the unit caches her ATK at the cast, several can exist and their effects add up, and "生命恢复的
 * 提供方式为增加目标的“生命回复速度”属性，不受治疗加成和禁疗影响" — an hpRegen buff per unit on the allies inside it
 * (no heal: 无法被友方治疗 / 禁疗 units get it too), set at each pulse until the next.
 */
export function tinmanKit(bb, chess, def) {
  const dur = num(bb.projectile_delay_time, 10);
  const radius = num(bb.projectile_range, 1.5);
  const dmgScale = num(bb.atk_scale);
  const healRatio = num(bb.hp_recovery_per_sec_ratio);
  const wither = num(talentBb(chess, 1)['skill@damage_scale'], 1);
  const spBonus = num(moduleBb(chess).sp_recovery_per_sec);
  const witherKey = 'tinman:wither';
  return {
    skill: {
      kind: instantKind(def),
      onStart({ battle, unit }) {
        const tgt = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0] ?? enemiesInGrid(battle, unit, null, { n: 1 })[0];
        const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
        const atk = unit.s.atk;
        unit.mem.tinZones = (unit.mem.tinZones ?? 0) + 1;
        const regenKey = `tinman:zone:${unit.id}:${unit.mem.tinZoneSeq = (unit.mem.tinZoneSeq ?? 0) + 1}`;
        makeZone(battle, unit, {
          x, y, radius, duration: dur, skill: 'tinman', onPulse(b) {
            for (const e of b.foesInRadius(x, y, radius)) {
              if (e.isFlying || e.s.flags.untargetable) continue;
              if (wither > 1) b.addBuff(e, { key: witherKey, duration: 1.05, data: { mul: wither }, source: unit });
              b.dealDamage(unit, e, { amount: atk * dmgScale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
            }
            // pulses every second: the buff bridges to the next pulse (two ticks over), the last one ends with the unit
            if (healRatio > 0) {
              for (const a of b.alliesInRadius(x, y, radius, null)) {
                if (b.allySelectable(a, unit)) b.addBuff(a, { key: regenKey, duration: 1 + 2 * b.dt, source: unit, mods: { hpRegen: atk * healRatio } });
              }
            }
          },
          onEnd() { unit.mem.tinZones = Math.max(0, (unit.mem.tinZones ?? 1) - 1); },
        });
      },
    },
    talents: [{ install(battle, unit) {
      if (wither > 1) {
        // "持续伤害" = damage over time only: 'dot'-tagged ticks and the per-second ticks of a necrosis / apoptosis
        // burst — never instantaneous bursts (burn/neural bursts, skill/summon bursts are also tagged 'burst')
        once(battle, witherKey, () => battle.on('hit', (ctx) => {
          if (!ctx.target || ctx.target.side !== 'enemy') return;
          const tags = ctx.dmg.tags || [];
          if (!(tags.includes('dot') || tags.includes('necrosis') || tags.includes('apoptosis'))) return;
          const w = ctx.target.findBuff(witherKey);
          if (w) ctx.dmg.amount *= w.data?.mul ?? 1;
        }));
      }
      spTimeBonus(battle, unit, spBonus, () => (unit.mem.tinZones ?? 0) > 0);
    } }],
  };
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_16 锡人 (hidden tier-1 entry of chess_char_2_19): see tinmanKit.
  chess_char_1_16_a: tinmanKit,
};
