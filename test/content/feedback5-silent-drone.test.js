// test/content/feedback5-silent-drone.test.js — 赫默 S2 医疗无人机 casts as soon as its SP is full (community report of
// 2026-10-06 「赫默的无人机在2技能好了之后应该秒放」): the AUTO skill has no cast condition — client skill skchr_silent_2: no
// `_trigger`, `_allowNoTarget` 1, `_checkHasTargetBeforeDoCast` 0, a RechargeToken action —, so the placed 医疗探机 takes the
// field the moment S2 is ready, injured ally or not. While the stock is full her SP stops (阻回) until it is spent
// (`_stopSpWhenTokenIsFull` 1; PRTS 赫默 S2 备注). Until 0.2.0 the data's DEFAULT rule (+ `heal`) waited for an injured ally.
// Run: node --test test/content/feedback5-silent-drone.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

const SILENT = 'chess_char_2_02_a', DRONE = 'token_10000_silent_healrb';

function field() {
  const h = makeBattle({
    units: [{ chessId: SILENT, row: 10, col: 3 }, { kind: 'token', tokenId: DRONE, row: 11, col: 3, ownerUid: 1 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }],
    autoFinish: false, timeLimit: 120, seed: 3,
  });
  const drones = [], casts = [];
  h.b.on('deploy', (c) => { if (c.unit.defId === DRONE) drones.push(h.b.time); });
  h.b.on('skillStart', (c) => { if (c.unit.defId === SILENT) casts.push(h.b.time); });
  return { h, s: h.unit(SILENT), drones, casts };
}

test('S2 casts the tick its SP is full with nobody injured, and the drone takes the field at once', () => {
  const { h, s, drones, casts } = field();
  h.run(0.1);
  assert.deepEqual(drones.length, 1, 'the placed drone deploys with the board (SKILL_SUMMON_START_DEPLOY)');
  // (the cast comes in the very tick the SP fills: from 0 at the deployment, spCost / spRecovery seconds later)
  const fullAt = s.skill.spCost / s.s.spRecovery;
  h.run(40);
  assert.ok(h.b.allyUnits.every((a) => !a.alive || a.hp >= a.s.maxHp), 'nobody was injured');
  assert.ok(casts.length >= 1, 'it casts with no injured ally anywhere');
  assert.ok(Math.abs(casts[0] - fullAt) < 0.1, `at full SP (${fullAt.toFixed(2)} s; cast ${casts[0].toFixed(2)} s)`);
  assert.ok(drones.some((t) => Math.abs(t - casts[0]) < 0.1), 'the drone deploys at the cast');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('while the stock is full (the previous drone still up) her SP stops; it runs again once the drone deployed', () => {
  const { h, s, drones, casts } = field();
  h.run(5);
  s.skill.sp = s.skill.spCost;
  h.step(2);
  assert.equal(casts.length, 1, 'cast at once');
  assert.equal(s.mem.summonStock[DRONE], 1, 'the drone is still up (10 s): one in stock');
  h.run(6);
  assert.equal(s.skill.sp, 0, '阻回: no SP while the stock is full');
  assert.ok(h.runUntil(() => drones.length >= 2, 10), 'the stocked drone deploys once the first is gone and ready again');
  h.run(3);
  assert.ok(s.skill.sp > 2, `SP runs again (${s.skill.sp.toFixed(2)})`);
});
