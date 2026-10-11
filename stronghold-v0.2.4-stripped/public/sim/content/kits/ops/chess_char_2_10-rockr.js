// server/sim/content/kits/ops/chess_char_2_10-rockr.js — 洛洛 (char_4040_rockr) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { canTargetEnemy } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { num, talentBb, up } from '../shared/tier1.js';
import { onDefaultSkill } from '../shared/tier2.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_10 洛洛 自负此轭: ASPD +attack_speed; the drones lock on their target until it dies or the skill ends.
  // 过载 (term ba.overdrive "技能进行到一半时触发额外效果"): the second half of the duration — ATK +atk and the funnel cap
  // ×scale; when the skill ends she is stunned as long as the overload lasted. 立于磐石: ATK +atk per `interval` s on the
  // field, up to max_stack_cnt stacks.
  // S1 战术咏唱·γ型 (alt): ASPD +attack_speed; the target lock belongs to 自负此轭 only.
  chess_char_2_10_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    const endOverload = (battle, unit) => {
      if (unit.mem.rockFunnel) { unit.profile.funnel = unit.mem.rockFunnel; unit.mem.rockFunnel = null; }
      battle.removeBuff(unit, 'rockr:overload');
    };
    return {
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        onStart({ battle, unit, skill }) {
          unit.mem.rockOverAt = battle.time + skill.duration / 2;
          unit.mem.rockOver = false;
          unit.mem.rockLock = null;
        },
        onTick({ battle, unit }) {
          if (unit.mem.rockOver || battle.time + 1e-9 < unit.mem.rockOverAt) return;
          unit.mem.rockOver = true;
          const f = unit.profile.funnel;
          if (f) { unit.mem.rockFunnel = f; unit.profile.funnel = { ...f, max: f.max * num(bb.scale, 1) }; }
          battle.addBuff(unit, { key: 'rockr:overload', mods: { atkPct: num(bb.atk) }, visible: true, tags: ['skill'] });
          battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit, reason }) {
          const over = unit.mem.rockOver ? battle.time - unit.mem.rockOverAt : 0;
          endOverload(battle, unit);
          unit.mem.rockOver = false;
          unit.mem.rockLock = null;
          if (over > 0 && reason !== 'death' && unit.alive) battle.applyStatus(unit, 'stun', { duration: over, source: unit });
        },
      },
      skills: { 'skcom_magic_rage[3]': { kind: 'duration', mods: { aspd: num(bb.attack_speed) } } },
      talents: [{ install(battle, unit) {
        if (s2) battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const L = unit.mem.rockLock;
          if (L && L.alive && bodyInKeys(L, unit.rangeKeySet) && canTargetEnemy(unit, L, ctx.profile || unit.profile)) ctx.targets = [L];
          else unit.mem.rockLock = ctx.targets[0] ?? null;
        }, { owner: unit });
        const iv = num(t.interval), max = Math.floor(num(t.max_stack_cnt)), v = num(t.atk);
        if (!(iv > 0) || !(max > 0) || !v) return;
        battle.on('tick', () => {
          if (!up(unit)) return;
          const n = Math.min(max, Math.floor((battle.time - unit.deployedAt + 1e-9) / iv));
          const cur = unit.findBuff('rockr:rock');
          if ((cur ? cur.stacks : 0) === n) return;
          if (n > 0) battle.addBuff(unit, { key: 'rockr:rock', mods: { atkPct: v }, stacks: n, maxStacks: max, tags: ['talent'] });
          else battle.removeBuff(unit, 'rockr:rock');
        }, { owner: unit });
      } }],
    };
  },
};
