// test/sim/feedback5-enemy-swing.test.js — an enemy's normal attack strikes at its clip's damage frame, and a stun before the
// frame cuts the swing (GitHub #187 point 1 「短轴眩晕无法打断敌人攻击，比如：六卡西米尔、异德三、忍冬三」, #170; PRTS 状态机
// ATTACK / COMBAT "每帧检查异常状态，若有则切换到异常状态的状态", PRTS 异常效果 STUNNED / DISARMED "正在进行的普通攻击将被中断") —
// server/sim/ai.js updateEnemy / enemyAttack / attackWindup. The damage frame is data/enemies.json `attackAnim.hit` (the
// clip's strike frame), shortened with the clip when the attacks come quicker than it; no clip known ⇒ no wind-up.
// Run: node --test test/sim/feedback5-enemy-swing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { TICK } from '../../server/sim/constants.js';
import { attackWindup } from '../../server/sim/ai.js';

const HIT = 0.4;      // the clip's strike frame
const BAT = 2;        // attack interval
const near = (a, b, msg, ticks = 2) => assert.ok(Math.abs(a - b) <= ticks * TICK + 1e-9, `${msg}: ${a.toFixed(3)} vs ${b.toFixed(3)}`);

/** A wall operator and one enemy (melee on the wall's tile — blocked at once —, or ranged 3 tiles away). */
function field({ ranged = false, clip = true } = {}) {
  const rec = {
    ...enemyRec({ key: 'enemy_sw', hp: 1e9, atk: 100, bat: BAT, speed: 0, ...(ranged ? { range: 3 } : null) }),
    ...(clip ? { attackAnim: { clip: 'Attack', dur: 1, hit: HIT } } : null),
  };
  const h = makeBattle({
    defs: { chess: { t_wall: chessRec({ id: 't_wall', stats: { maxHp: 1e9, atk: 0, def: 0 }, skill: null }) }, enemies: { enemy_sw: rec } },
    units: [{ chessId: 't_wall', row: 10, col: 6 }], enemies: [{ key: 'enemy_sw', pos: ranged ? [10, 9] : [10, 6] }],
    content: 'none', autoFinish: false, timeLimit: 60, hooks: ['attack', 'damaged'], captureNoisy: true,
  });
  h.step();
  return { h, e: h.enemy('enemy_sw'), wall: h.unit('t_wall') };
}
const strikes = (h, e) => h.hooksOf('attack').filter((c) => c.attacker === e).map((c) => c.t);
const hits = (h, e) => h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).map((c) => c.t);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

test('attackWindup: the clip\'s strike frame, shortened with the clip when the attacks come quicker than it; 0 with no clip', () => {
  const w = (anim, interval) => attackWindup({ def: { attackAnim: anim }, s: { interval } });
  assert.equal(w({ dur: 1, hit: 0.4 }, 2), 0.4);
  assert.equal(w({ dur: 2, hit: 1 }, 1), 0.5);
  assert.equal(w({ dur: 1 }, 2), 0.5, 'no strike frame named: half the clip');
  assert.equal(w(undefined, 2), 0);
});

test('a blocked enemy swings when its cooldown is over and strikes at the damage frame: the first strike one wind-up after the block (its cooldown long over), then one per attack interval', () => {
  const { h, e } = field();
  const t0 = h.b.time;   // blocked in the first tick
  h.run(4.6);
  const s = strikes(h, e);
  assert.ok(s.length >= 3, `${s.length} strikes`);
  near(s[0], t0 + HIT, 'the first strike: the whole wind-up from the block (it used to land at once)');
  near(s[1] - s[0], BAT, 'then one per interval', 1);
  near(s[2] - s[1], BAT, 'then one per interval', 1);
  assert.deepEqual(hits(h, e), s, 'melee: the damage at the strike');
  done(h);
});

for (const dur of [0.1, 0.2]) {
  test(`a ${dur} s stun before the damage frame cuts the swing: no strike at that frame, the attack starts again from its wind-up after the stun (卡西米尔 6's pulse, 忍冬 S3)`, () => {
    const { h, e } = field();
    assert.ok(h.runUntil(() => strikes(h, e).length === 1, 2));
    const t1 = strikes(h, e)[0];
    // its next swing starts at t1 + BAT − HIT; the stun lands 0.2 s into it
    h.runUntil(() => h.b.time >= t1 + BAT - HIT + 0.2 - 1e-9, 3);
    assert.ok(e.swing, 'swinging');
    const tStun = h.b.time;
    h.b.applyStatus(e, 'stun', { duration: dur });
    h.run(dur + HIT + 0.3);
    const s = strikes(h, e);
    assert.equal(s.filter((t) => t > t1 && t < tStun + dur).length, 0, 'the cut swing never struck');
    near(s[1], tStun + dur + HIT, 'the next strike: the stun, then the whole wind-up again', 3);
    assert.ok(s[1] > t1 + BAT + dur + 0.1, `later than a mere pause of the countdown (${(t1 + BAT + dur).toFixed(2)})`);
    done(h);
  });
}

test('a stun during the cooldown (before the swing) only pauses it; 缴械 cuts a swing like a stun; a strike already made stays made (a ranged shot in flight lands)', () => {
  // the cooldown: a 0.5 s stun 0.5 s after a strike delays the next one by 0.5 s
  const a = field();
  assert.ok(a.h.runUntil(() => strikes(a.h, a.e).length === 1, 2));
  const t1 = strikes(a.h, a.e)[0];
  a.h.run(0.5);
  a.h.b.applyStatus(a.e, 'stun', { duration: 0.5 });
  a.h.run(BAT + 0.3);
  near(strikes(a.h, a.e)[1], t1 + BAT + 0.5, 'paused by the stun, no new wind-up', 3);
  done(a.h);
  // 缴械 mid-swing: the swing is cut, a new one starts once it ends
  const b = field();
  assert.ok(b.h.runUntil(() => strikes(b.h, b.e).length === 1, 2));
  const u1 = strikes(b.h, b.e)[0];
  b.h.runUntil(() => b.h.b.time >= u1 + BAT - HIT + 0.2 - 1e-9, 3);
  const tD = b.h.b.time;
  b.h.b.addBuff(b.e, { key: 'test:disarm', duration: 0.1, flags: { disarm: true } });
  b.h.run(HIT + 0.5);
  near(strikes(b.h, b.e)[1], tD + 0.1 + HIT, '缴械 "正在进行的普通攻击将被中断": the whole wind-up after it', 3);
  done(b.h);
  // ranged: stunned just after the strike — the shot flies on and lands
  const c = field({ ranged: true });
  assert.ok(c.h.runUntil(() => strikes(c.h, c.e).length === 1, 3));
  assert.equal(hits(c.h, c.e).length, 0, 'the shot is in flight');
  c.h.b.applyStatus(c.e, 'stun', { duration: 1 });
  c.h.run(0.6);
  assert.equal(hits(c.h, c.e).length, 1, 'a strike already made is not undone');
  done(c.h);
});

test('no attack clip known: no wind-up — it strikes as its swing starts, so a stun only pauses its cooldown (the rule before 0.2.0)', () => {
  const { h, e } = field({ clip: false });
  assert.equal(attackWindup(e), 0);
  h.step();
  assert.equal(strikes(h, e).length, 1, 'struck in its first tick blocked');
  const t1 = strikes(h, e)[0];
  h.runUntil(() => h.b.time >= t1 + BAT - 0.1 - 1e-9, 3);
  h.b.applyStatus(e, 'stun', { duration: 0.1 });
  h.run(0.5);
  near(strikes(h, e)[1], t1 + BAT + 0.1, 'paused by the stun', 3);
  done(h);
});
