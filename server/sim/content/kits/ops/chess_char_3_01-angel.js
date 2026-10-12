// server/sim/content/kits/ops/chess_char_3_01-angel.js — 能天使 (char_103_angel) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, traitBb, altSkills, instantKindOf, groundAspd, alive, fx } from '../shared/tier3.js';

export default {
  // ---- 3_01 能天使 · 速射手 — S3 过载模式: 5 连射 + 攻击间隔缩短; 快速弹匣 ASPD; 天使的祝福 (self + one random ally)
  //      S1 冲锋模式: next attack = 3 shots × atk_scale; S2 扫射模式: 4 shots × attack@atk_scale per attack for 15 s;
  //      精锐 module MAR-Y: ASPD + while a ground enemy is in range (MAR-X fly × = profession layer)
  chess_char_3_01_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const bless = { atkPct: num(t1.atk), hpPct: num(t1.max_hp) };
    const shots = (v) => Math.max(1, Math.floor(num(v, 1)));
    const kit = {
      skill: {
        kind: 'duration',
        mods: { batPct: num(bb.base_attack_time) },
        attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: Math.max(1, Math.floor(num(bb['attack@times'], 1))) },
      },
      skills: altSkills(chess, d, bb, {
        skchr_angel_1: (s) => ({ kind: instantKindOf(s), attack: { atkScale: num(s.bb.atk_scale, 1), hits: shots(s.bb.times) } }),
        skchr_angel_2: (s) => ({ kind: 'duration', attack: { atkScale: num(s.bb['attack@atk_scale'], 1), hits: shots(s.bb['attack@times']) } }),
      }),
      talents: [
        { install(battle, unit) { battle.addBuff(unit, { key: 'talent:angel_mag', mods: { aspd: num(t0.attack_speed) }, persist: true, allowDead: true }); } },
        { install(battle, unit) {
          battle.addBuff(unit, { key: 'talent:angel_bless', mods: { ...bless }, persist: true, allowDead: true });
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            // after the whole board is deployed (the initial deployment goes one unit after another)
            battle.after(0, () => {
              if (!alive(unit)) return;
              const cands = battle.allies(unit.ownerId).filter((a) => a !== unit && a.kind === 'op' && !a.findBuff('talent:angel_bless_ally'));
              const pick = battle.rng.pick(cands);
              if (!pick) return;
              battle.addBuff(pick, { key: 'talent:angel_bless_ally', mods: { ...bless }, persist: true, source: unit, visible: true });
              fx(battle, 'buff', pick, { src: unit.id, talent: 'angel_bless' });
            }, { owner: unit });
          }, { owner: unit });
        } },
      ],
    };
    // MAR-Y trait "范围内存在地面敌人时攻击速度+8" (bb attack_speed, cnt = ground enemies needed)
    if (num(tb.attack_speed) > 0) kit.install = groundAspd('trait:angel_ground', num(tb.attack_speed), Math.floor(num(tb.cnt, 1)));
    return kit;
  },
};
