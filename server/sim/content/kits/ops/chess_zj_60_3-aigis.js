// server/sim/content/kits/ops/chess_zj_60_3-aigis.js — 埃癸斯 (char_4218_aigis) kit, 炸惊模拟 chess_zj_60_3_a.
// Kit contract and rules: ../README.md; the helpers of tier 1: ../shared/tier1.js.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/op-aigis.js` (203 lines), re-keyed on the 炸惊棋库's
// own chess id (the pack registered it under the charId — see kits/index.js ZHAJING_KIT_FILES).
//   5★ SNIPER / skybreaker (裂空炮手), RANGED, range 3-6 (9 tiles), BAT 2.1, 费 22.
//   特性 "部署后起飞，起飞后只攻击空中敌人；技能开启时降落且攻击造成群体物理伤害":
//     · 起飞 = the `liftoff` + `blockFly` flags (buffs.js: liftoff is an ally flag; damage.js liftoffEvades keeps ground
//       attacks off her; blocking.js lets her block flyers only). Same technique as 蒂比 / 安洁莉娜 in this repository.
//     · "只攻击空中敌人" = the kit's `trait.canAttack` (ai.js reads `prof.canAttack`): the engine has `groundOnly` but no
//       reverse switch, so the gate is written here — airborne and no flyer in range ⇒ no attack, which also means she never
//       fires on the ground.
//     · "技能开启时降落" = the skills' `onStart` drops the flag; "攻击造成群体物理伤害" = S1's splash.
//   T1 反暗影特殊压制兵装 (bb damage_scale 1.12, damage_resistance 0.12): physical damage dealt ×1.12 (trait `dmgMul`),
//     physical damage taken ×0.88 (a standing `physTakenMul` buff).
//   S1 启动狂宴模式 (20 s, 30/10): ATK +70 %, DEF +30 %, RANDOM targets in range, 10 s 晕眩 after it ends.
//   S2 全弹发射 (instant, 30/10): `times` 6 missiles of `atk_scale` 1.0 × ATK phys at the locked target, then a kick on the
//     target and everything within 1.5 tiles for `kick_atk_scale` 2.1 × ATK phys. She never moves: the official ability's
//     `Kick` is a projectile fired from her muzzle (the pack measured that `moveRedeploy` made her visibly redeploy).
//   [ASSUMED] (both from the pack): the missile times MISSILE_AT are char_4218_aigis.skel hits.Skill_2_Begin, and both
//   skills use the SEARCH trigger — the record's own rule is DEFAULT ("about to attack"), which a 起飞 unit with no flyer in
//   range NEVER satisfies: it would never cast, never land, deadlock (the pack measured 0 casts in 30 s).
//   Two 0.3.3 adaptations: `targeting.random` is not a priority this engine knows (sortEnemyTargets has no 'random'), so
//   the random pick is a `beforeAttack` shuffle; and there is no 'land' fx kind (the takeoff kind carries `air: false`).
//   NOT IMPLEMENTED — the trait's second half "技能开启时…攻击造成群体物理伤害": 0.3.3 has no `skybreaker` subprofession
//   (professions.js has no such key, so the record falls back to the base SNIPER profile: ranged phys, canHitFly), and the
//   data carries no splash radius, so the pack's own omission is kept rather than inventing a number. The 起飞 half IS
//   implemented (the deploy hook + the air gate below); the splash needs either a `skybreaker` profession entry
//   (server/sim/professions.js — engine's file, reported) or a data value, after which one `attack: { splashRadius }` on
//   the two skills finishes the trait.
import { num, talentBb, statBuff } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_aigis_1';
const S2 = 'skchr_aigis_2';

/** 起飞 (ba.liftoff): ground attacks evade her, she blocks flyers only. */
const LIFTOFF = Object.freeze({ liftoff: true, blockFly: true });
/** The airborne state's buff key. */
const AIR_KEY = 'aigis:air';
/** An air-reaching target profile ("只攻击空中敌人" asks whether a FLYER is among the candidates). */
const AIR = Object.freeze({ canHitFly: true });
/** S2's six missiles (s from the cast) — char_4218_aigis.skel hits.Skill_2_Begin [ASSUMED]. */
const MISSILE_AT = Object.freeze([0.667, 0.8, 0.933, 1.067, 1.2, 1.333]);

const bbOf = (chess, id) => (chess?.skills ?? []).find((s) => s && s.skillId === id)?.bb ?? {};

export default {
  chess_zj_60_3_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2);
    const dmgScale = num(t0.damage_scale, 1);
    const dmgResist = num(t0.damage_resistance, 0);
    const missileTimes = Math.max(1, Math.floor(num(b2.times, MISSILE_AT.length)));
    const rGrid = chess?.rangeGrid ?? [];
    /**
     * "起飞后只攻击空中敌人": the kit's `trait` merges onto the unit's PROFILE (players.js resolveProfile), which ai.js
     * reads as `prof.canAttack`. It must be a pure function of (battle, unit): the profile is built once per unit, so
     * changing `unit.trait` inside install() would come too late.
     */
    const airGate = (b, u) => {
      if (!u.mem.aigisAir) return true; // landed: attacks as usual
      const keys = absoluteRangeKeys(rGrid, u.tileR, u.tileC, u.dir, 0);
      return b.enemiesInKeys(keys, u, AIR).some((e) => e.isFlying);
    };
    return {
      trait: {
        ...(dmgScale !== 1 ? { dmgMul: (b, u, t) => (t && t.side === 'enemy' ? dmgScale : 1) } : {}),
        canAttack: airGate,
      },
      skills: {
        [S1]: {
          kind: 'duration',
          duration: num(b1.duration, 20),
          trigger: { rule: 'SEARCH' }, // see the [ASSUMED] note: DEFAULT would deadlock a grounded-in-air unit
          mods: { atkPct: num(b1.atk, 0), defPct: num(b1.def, 0) },
          onStart({ battle, unit }) {
            land(battle, unit);
            unit.mem.aigisAir = false;
          },
          onEnd({ battle, unit }) {
            const stun = num(b1.stun, 0);
            if (stun > 0) battle.applyStatus(unit, 'stun', { duration: stun, source: unit, force: true });
            takeOff(battle, unit); // 部署后起飞 is the standing state; S1 only lands for its duration
            unit.mem.aigisAir = true;
          },
        },
        [S2]: {
          kind: 'instant',
          trigger: { rule: 'SEARCH' },
          onStart({ battle, unit }) {
            land(battle, unit);
            unit.mem.aigisAir = false;
            // every early return has to put her back in the air: S2 has no onEnd to fall back on
            try {
              const cands = battle.enemiesInKeys(absoluteRangeKeys(rGrid, unit.tileR, unit.tileC, unit.dir, 0), unit, AIR);
              if (!cands.length) return;
              sortEnemyTargets(battle, unit, cands, null);
              const target = cands[0];
              const atk = unit.s.atk;
              const atkScale = num(b2.atk_scale, 1);
              const kickScale = num(b2.kick_atk_scale, 2.1);
              for (let i = 0; i < missileTimes; i++) {
                const at = MISSILE_AT[Math.min(i, MISSILE_AT.length - 1)];
                battle.after(at, () => {
                  if (!unit.alive || !unit.deployed) return;
                  const e = target && target.alive ? target : null;
                  if (!e) return;
                  battle.dealDamage(unit, e, { amount: atk * atkScale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'missile'] });
                }, { owner: unit });
              }
              // the kick: a projectile that lands ON THE TARGET — she does not move, the splash is centred on it
              const kickAt = MISSILE_AT[Math.min(missileTimes, MISSILE_AT.length - 1)] + 0.3;
              battle.after(kickAt, () => {
                if (!unit.alive || !unit.deployed) return;
                const e = target && target.alive ? target : null;
                if (!e) return;
                battle.fx('blink', { x: e.x, y: e.y, id: unit.id, target: e.id });
                const around = [e, ...battle.foesInRadius(e.x, e.y, 1.5).filter((x) => x !== e)];
                for (const v of around) {
                  if (!v || !v.alive) continue;
                  battle.dealDamage(unit, v, { amount: unit.s.atk * kickScale, type: 'phys', isSkill: true, canDodge: false, isSplash: v !== e, tags: ['skill', 'kick'] });
                }
              }, { owner: unit });
            } finally {
              takeOff(battle, unit);
              unit.mem.aigisAir = true;
            }
          },
        },
      },
      talents: [{
        install(battle, unit) {
          if (dmgResist > 0) statBuff(battle, unit, 'talent:aigis:resist', { physTakenMul: 1 - dmgResist });
          // 部署后起飞: every deployment enters the airborne state
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            takeOff(battle, unit);
            unit.mem.aigisAir = true;
          }, { owner: unit });
          // S1 "随机攻击范围内的目标": the engine has no random 索敌 priority, so the attack's target order is shuffled here
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active || unit.skill.id !== S1) return;
            if (c.targets && c.targets.length > 1) c.targets = battle.rng.shuffle(c.targets.slice());
          }, { owner: unit, priority: -100 });
        },
      }],
    };
  },
};

/** 起飞: release the ground enemies she blocked, take the liftoff flags, one fx. */
function takeOff(battle, unit) {
  battle.releaseBlocked(unit);
  battle.addBuff(unit, { key: AIR_KEY, flags: { ...LIFTOFF }, persist: true, allowDead: true });
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id, air: true });
}

/** 降落: drop the liftoff flags (0.3.3 has no 'land' fx kind: the takeoff kind carries `air: false`). */
function land(battle, unit) {
  battle.removeBuff(unit, AIR_KEY);
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id, air: false });
}
