// test/sim/palsy-trigger.test.js — the engine hook `palsyTrigger` (server/sim/ai.js enemyAttack): fired when a 麻痹 stack
// interrupts an enemy's normal attack (PRTS 真言 备注 "触发麻痹时指的是敌人的攻击被麻痹打断时"), once per interrupt; a
// handler may keep the stack (`keep`) or kill the enemy. 真言's 噤声限域 (kits/ops/op-mantra.js) is its user.
// Run: node --test test/sim/palsy-trigger.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const guard = chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 0, blockCnt: 2, maxHp: 1e6 }, skill: null });
const shooter = enemyRec({ key: 'enemy_shooter', hp: 1e6, atk: 100, bat: 1, range: 3, speed: 0, mass: 0 });

function field(setup) {
  const h = makeBattle({
    defs: { chess: { t_guard: guard }, enemies: { enemy_shooter: shooter } },
    units: [{ chessId: 't_guard', row: 10, col: 5 }], content: 'none', autoFinish: false, setup,
  });
  h.step();
  return h;
}

test('palsyTrigger: one event per interrupted attack, before the stack is used; no event without 麻痹', () => {
  const seen = [];
  const h = field((b) => b.on('palsyTrigger', (c) => seen.push({ t: b.time, stacks: c.buff.stacks, enemy: c.enemy })));
  const e = h.spawn('enemy_shooter', { pos: [10, 7] });
  h.run(3.05);
  assert.equal(seen.length, 0, 'no 麻痹, no event');
  const a0 = e.stats.attacks;
  h.b.applyStatus(e, 'palsy', { value: 2 });
  h.run(2.05);
  assert.deepEqual(seen.map((x) => [x.enemy, x.stacks]), [[e, 2], [e, 1]], 'each interrupt, the stack count before it is used');
  assert.equal(e.stats.attacks, a0, 'both attacks interrupted');
  assert.equal(e.findBuff('palsy'), null);
  h.run(1.1);
  assert.ok(e.stats.attacks > a0, 'attacks again');
  checkInvariants(h.b);
});

test('palsyTrigger: `keep` leaves the stack; a handler that kills the enemy ends its turn', () => {
  let keepNext = true;
  const h = field((b) => b.on('palsyTrigger', (c) => { if (keepNext) { c.keep = true; keepNext = false; } }));
  const e = h.spawn('enemy_shooter', { pos: [10, 7] });
  h.step();
  h.b.applyStatus(e, 'palsy', { value: 1 });
  const a0 = e.stats.attacks;
  h.run(1.1);
  assert.equal(e.findBuff('palsy')?.stacks, 1, 'kept');
  assert.equal(e.stats.attacks, a0, 'still interrupted');
  h.run(1.05);
  assert.equal(e.findBuff('palsy'), null, 'used by the next interrupt');
  assert.equal(e.stats.attacks, a0);
  // a lethal handler
  const h2 = field((b) => b.on('palsyTrigger', (c) => b.kill(c.enemy, null)));
  const e2 = h2.spawn('enemy_shooter', { pos: [10, 7] });
  h2.step();
  h2.b.applyStatus(e2, 'palsy', { value: 3 });
  h2.run(1.2);
  assert.ok(!e2.alive);
  assert.equal(h2.b.errors.length, 0, JSON.stringify(h2.b.errors[0]));
  checkInvariants(h.b);
  checkInvariants(h2.b);
});
