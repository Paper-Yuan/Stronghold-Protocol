// server/sim/content/kits/ops/chess_char_4_09-mizuki.js — 水月 (char_437_mizuki) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  AURA, num, tbb, moduleBb, grid, batFlat, enemiesOnRange, whileDeployed, pulse, toggleBuff, skillActive, isSel, alt,
  instantKind, withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 水月 (stalker) S2 囚徒困境 — faster, +ATK, talent 1 +1 target & bind; talents 创伤性癔症 / 反移情; module slow
  //       S1 唤醒 (charges: next attack 200 %/230 %, talent 1 ×2.0/×2.3); S3 镜花水月 (wider range, ATK up, talent 1 +2
  //       targets & stun; an attack hitting < 3 enemies costs 15 % max HP); modules: AMB-Y 65 % dodge (trait, profession)
  chess_char_4_09_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const S1 = isSel(def, 'skchr_mizuki_1'), S2 = isSel(def, 'skchr_mizuki_2'), S3 = isSel(def, 'skchr_mizuki_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_mizuki_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 2) } }),
        skchr_mizuki_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit }) { battle.fx('ripple', { x: unit.x, y: unit.y, id: unit.id }); },
          onAttack({ battle, unit, targets }) {
            if ((targets || []).filter((e) => e.side === 'enemy').length >= 3) return;
            battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio'], 0.15), { tags: ['skill', 'selfLoss'] }); // (no source: not damage dealt)
          },
        }),
      }),
      skill: { kind: 'duration', mods: { batPct: batFlat(def, bb.base_attack_time), atkPct: num(bb.atk) },
        onStart({ battle, unit }) { battle.fx('dilemma', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [
        { install(battle, unit) { // 创伤性癔症: +50 % ATK arts to the lowest-HP enemy hit (S2 +1 target & bind, S3 +2 & stun, S1 ×2)
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.alive) return;
            const act = skillActive(unit) && (S2 || S3);
            const n = Math.max(1, Math.floor(num(t0['attack@max_target'], 1))) + (act ? Math.floor(num(bb['attack@max_target'], 1)) : 0);
            const mul = S1 && c.isSkill ? num(bb.talent_scale, 2) : 1;
            const list = c.targets.filter((e) => e.alive && e.side === 'enemy').sort((a, b) => a.hp - b.hp || a.id - b.id).slice(0, n);
            for (const e of list) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0['attack@mizuki_t_1.atk_scale'], 0.5) * mul, type: 'arts', tags: ['talent'] });
              if (!act || !e.alive) continue;
              if (S2) battle.applyStatus(e, 'bind', { duration: num(bb['attack@unmovable'], 0.8), source: unit });
              else battle.applyStatus(e, 'stun', { duration: num(bb['attack@stun'], 0.7), source: unit });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 反移情: ATK +10 % while an enemy in range is below 50 % HP
          whileDeployed(battle, unit, 0.1, () => {
            const on = enemiesOnRange(battle, unit).some((e) => e.hpRatio < num(t1.hp_ratio, 0.5));
            toggleBuff(battle, unit, 'mizuki:t2', on, { atkPct: num(t1.atk, 0.1) });
          });
        } },
      ],
      install(battle, unit) {
        const ms = num(mb.move_speed, 0);
        if (ms) whileDeployed(battle, unit, AURA, () => { for (const e of enemiesOnRange(battle, unit)) pulse(battle, e, `mizuki:slow:${unit.id}`, { moveMul: Math.max(0, 1 + ms) }); });
      },
    };
  },
});
