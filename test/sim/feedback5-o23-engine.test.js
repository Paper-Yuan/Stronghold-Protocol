// test/sim/feedback5-o23-engine.test.js — the additive engine rule the 0.2.0 自选 kit of 白铁 needs: ally targets
// (Battle.setAllyTarget / allyTargetsInKeys / isAllyTarget, ai.js acquireTargets / performAttack). 白铁's 铁钳号·原型机 is a
// summon of the enemy camp (PRTS 铁钳号·原型机 备注 "该召唤物阵营为敌方") that "可被我方干员攻击但不受伤害": our attacks select a
// registered ally standing on the attacker's range after every enemy (嘲讽等级 −2), ranged attacks fly to it; heals never
// select it; with none registered the attack loop is exactly the old one. Cancelling the damage it takes is the kit's job
// (test/content/op_ironmn.test.js); here a plain guard is registered and takes the hits.
// Run: node --test test/sim/feedback5-o23-engine.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { acquireTargets } from '../../server/sim/ai.js';

const ENEMIES = { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) };
const CHESS = {
  test_guard_a: chessRec({ id: 'test_guard_a', profession: 'WARRIOR', stats: { maxHp: 1e7, atk: 300, def: 0, res: 0 } }),
  test_sniper_a: chessRec({ id: 'test_sniper_a', profession: 'SNIPER', stats: { maxHp: 2000, atk: 200, def: 0, res: 0 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }),
  test_medic_a: chessRec({ id: 'test_medic_a', profession: 'MEDIC', subProf: 'physician', stats: { maxHp: 2000, atk: 100, def: 0, res: 0 }, rangeGrid: [[0, 0], [0, 1], [0, 2]] }),
};

function field() {
  const h = makeBattle({
    defs: { enemies: ENEMIES, chess: CHESS }, timeLimit: 600, autoFinish: false, seed: 3, hooks: ['damaged'], captureNoisy: true,
    units: [
      { uid: 1, chessId: 'test_guard_a', row: 10, col: 4 },    // melee 1-1: (10, 4), (10, 5)
      { uid: 2, chessId: 'test_guard_a', row: 10, col: 5 },    // the ally target
      { uid: 3, chessId: 'test_sniper_a', row: 10, col: 2 },   // ranged: (10, 2) … (10, 5)
      { uid: 4, chessId: 'test_medic_a', row: 10, col: 3 },
    ],
  });
  h.step();
  return { h, guard: h.unit(1), target: h.unit(2), sniper: h.unit(3), medic: h.unit(4) };
}

test('ally targets: none registered ⇒ nobody selects an ally; registered ⇒ the attackers whose range holds it select it, after every enemy', () => {
  const { h, guard, target, sniper, medic } = field();
  assert.equal(h.b.isAllyTarget(target), false);
  assert.deepEqual(acquireTargets(h.b, guard, guard.profile), [], 'not registered: no target');
  assert.ok(h.b.setAllyTarget(target, true));
  assert.ok(h.b.isAllyTarget(target));
  assert.deepEqual(h.b.allyTargetsInKeys(guard.rangeKeys, guard).map((u) => u.id), [target.id]);
  assert.deepEqual(h.b.allyTargetsInKeys(target.rangeKeys, target), [], 'never itself');
  assert.deepEqual(acquireTargets(h.b, guard, guard.profile).map((u) => u.id), [target.id], 'no enemy: the ally target');
  assert.deepEqual(acquireTargets(h.b, medic, medic.profile), [], 'a healer never selects it');
  // an enemy in range comes first; all-in-range / two targets take both
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.step();
  assert.deepEqual(acquireTargets(h.b, guard, guard.profile).map((u) => u.id), [e.id], 'one target: the enemy');
  assert.deepEqual(acquireTargets(h.b, guard, { ...guard.profile, maxTargets: 2 }).map((u) => u.id), [e.id, target.id], 'two: the enemy, then it');
  assert.deepEqual(acquireTargets(h.b, guard, { ...guard.profile, allInRange: true }).map((u) => u.id), [e.id, target.id], 'all in range: both');
  h.b.setAllyTarget(target, false);
  assert.deepEqual(acquireTargets(h.b, guard, { ...guard.profile, maxTargets: 2 }).map((u) => u.id), [e.id], 'dropped: enemies only');
  void sniper;
  checkInvariants(h.b);
});

test('ally targets: attacks on it are real attacks (melee instant, ranged by projectile); off the field it is skipped', () => {
  const { h, guard, target, sniper } = field();
  h.b.setAllyTarget(target, true);
  h.run(3);
  const by = (src) => h.hooksOf('damaged').filter((c) => c.source === src && c.target === target && c.dmg?.isAttack);
  assert.ok(by(guard).length >= 1, 'the guard hits it');
  assert.ok(by(sniper).length >= 1, 'the sniper hits it');
  let flew = false;
  for (let i = 0; i < 90 && !flew; i++) { h.step(); flew = h.b.projectiles.list.some((p) => p.source === sniper && p.target === target); }
  assert.ok(flew, 'by projectile');
  h.b.retreat(target, { reason: 'retreat' });
  h.step();
  assert.deepEqual(h.b.allyTargetsInKeys(guard.rangeKeys, guard), [], 'off the field: skipped while registered');
  assert.ok(h.b.isAllyTarget(target));
  checkInvariants(h.b);
});
