// server/sim/content/kits/ops/chess_char_1_10-sunbr.js — 古米 (char_196_sunbr) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, isMainHit, onHitBy, instantKind, skillRec } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_10 古米 备用军粮 (自动触发, ct charges — an AUTO skill: no 技能策略 applies, it keeps its own rule; PRTS 备注 "此技能
  // 在存在生命值不满的可治疗角色时可触发；技能触发后古米将切换至治疗模式（普通攻击改为治疗技能范围内的一名友方单位），直至古米
  // 完成一次普通攻击的治疗"): cast as soon as a healable ally of the skill range (x-4, herself included) is injured —
  // no enemy needed (user playtest #6: it waited until she engaged) — then her next normal attack heals the most
  // injured ally of the skill range for heal_scale × ATK instead of hitting an enemy; she makes no normal attack until
  // that heal is done. Elite module (GUA-X): targets below hp_ratio HP get ×heal_scale more.
  // 平底锅专精: each attack prob for ATK ×atk_scale and a `stun` s stun (only when that hit lands).
  // Alternate S2 食粮烹制 (PRTS notes: 10 s 缴械 at the start, the real duration is disarm + 30 s, attacks become heals
  // with the attack interval +130 %): cooking for `disarm` s — no attacks, DEF +def; then for the skill's `duration` s
  // she heals the most injured ally inside the skill grid (x-4) for ATK per attack, ATK +atk, base attack time
  // ×(1 + base_attack_time). The GUA-X heal bonus (below hp_ratio: ×heal_scale) applies to these heals too.
  // Trigger: TAKE_DAMAGE (data: the 重装 strategy "不受技能范围影响，受到伤害时释放技能").
  chess_char_1_10_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const S2 = 'skchr_sunbr_2';
    const r2 = skillRec(chess, S2);
    const b2 = r2?.bb ?? {};
    const cook = Math.max(0, num(b2.disarm, 10));
    const cookKey = 'sunbr:cook', serveKey = 'sunbr:serve';
    const healGrid = def?.skill?.rangeGrid ?? null;
    return {
      skills: {
        [S2]: {
          kind: 'duration', duration: cook + Math.max(0, num(r2?.duration, 30)),
          mods: { batPct: Math.max(0, num(b2.base_attack_time)) },
          targeting: { rangeGrid: r2?.rangeGrid ?? def?.skill?.rangeGrid ?? null },
          attack: { dmgType: 'heal', heal: { mode: 'single' } },
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: cookKey, duration: cook, mods: { defPct: num(b2.def) }, flags: { disarm: true }, tags: ['skill'], visible: true });
          },
          onTick({ battle, unit }) {
            if (!unit.findBuff(cookKey) && !unit.findBuff(serveKey)) {
              battle.addBuff(unit, { key: serveKey, mods: { atkPct: num(b2.atk) }, tags: ['skill'] });
              battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'heal' });
            }
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, cookKey);
            battle.removeBuff(unit, serveKey);
          },
        },
      },
      install(battle, unit) {
        if (tb.hp_ratio == null || num(tb.heal_scale, 1) === 1) return;
        // GUA-X on her skill heals (S1's heal-mode attack, S2's attack heals while it runs — herself included, she stands
        // in the grid), never her natural / self regeneration; strictly below hp_ratio (the client's sunbr_e_trait is
        // set_heal_scale_by_hpratio: FilterByTargetHpRatio LT)
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || ctx.opts?.regen || ctx.opts?.self) return;
          if (ctx.target.hpRatio < num(tb.hp_ratio)) ctx.amount *= num(tb.heal_scale, 1);
        }, { owner: unit });
      },
      skill: {
        kind: instantKind(def),
        heal: true,
        ...(healGrid ? { trigger: { rule: 'SKILL_RANGE', grid: healGrid, allies: true }, targeting: { rangeGrid: healGrid } } : {}),
        // the heal-mode attack: the most injured ally of the skill range (acquireTargets, heal profile)
        attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: num(bb.heal_scale, 1), projectile: 'none' },
        onHit({ battle, target }) { if (target) battle.fx('heal', { x: target.x, y: target.y, id: target.id }); },
      },
      talents: [{ install(battle, unit) {
        // the proc is rolled per attack hit; the stun only follows a hit that landed (not dodged / cancelled)
        const procs = new WeakSet();
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!isMainHit(dmg) || !(num(t.prob) > 0) || !battle.rng.chance(num(t.prob))) return;
          dmg.amount *= num(t.atk_scale, 1);
          procs.add(dmg);
          battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
        });
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg || !procs.has(ctx.dmg) || !ctx.target.alive) return;
          procs.delete(ctx.dmg);
          battle.applyStatus(ctx.target, 'stun', { duration: num(t.stun), source: unit });
        }, { owner: unit });
      } }],
    };
  },
};
