// test/sim/feedback5-groundbind.test.js — the 缚地 status (0.2.0, O20: 予愿安洁莉娜 S2, kits/ops/op-aglna2.js): gamedata_const
// ba.groundbind "目标变为地面单位，无法移动；使部分近地悬浮敌人掉落；对重量大于3的单位持续时间减半" — server/sim/buffs.js STATUS
// `groundbind` (flag `groundbind` + `noMove`), units.js Unit.isFlying (a 缚地 enemy is a ground unit unless a 浮空 lifts it),
// battle/status.js applyStatus (浮空 lands on a 缚地 data flyer — PRTS 异常效果 "若单位数据上为飞行单位且不持有缚地异常…则Buff
// 取消"; the weight halving), the 抵抗 list, and the two hovering enemies whose PRTS text names it (content/enemies:
// 掠海漂移体 爬行模式, 吉兆飞鳞 晕眩模式).
// Run: node --test test/sim/feedback5-groundbind.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { STATUS, RESIST_STATUSES, FLAG_KEYS } from '../../server/sim/buffs.js';

const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const ENEMIES = {
  enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e9, speed: 0, mass: 0, motion: 'FLY' }),
  enemy_flywalk: enemyRec({ key: 'enemy_flywalk', hp: 1e9, speed: 0.6, mass: 0, motion: 'FLY' }),
  enemy_flyheavy: enemyRec({ key: 'enemy_flyheavy', hp: 1e9, speed: 0, mass: 4, motion: 'FLY' }),
};

function arena(units = []) {
  const h = makeBattle({ defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed: 3, flags: { dpPerSec: 0 }, units });
  h.step();
  return h;
}

test('缚地 is a catalogue status: flag groundbind + noMove, move ×0, one of 抵抗\'s statuses', () => {
  assert.deepEqual(STATUS.groundbind, { flags: { groundbind: true, noMove: true }, mods: { moveMul: 0 } });
  assert.ok(FLAG_KEYS.includes('groundbind'));
  assert.ok(RESIST_STATUSES.has('groundbind'));
});

test('缚地: an air unit is a ground unit (melee operators hit it) and cannot move; half as long on weight > 3; 抵抗 shortens it; 浮空 lands on a 缚地 flyer; back in the air when it ends', () => {
  const h = arena([{ uid: 1, chessId: 'chess_char_1_02_a', row: 9, col: 4 }]);
  const yak = h.unit(1);
  const fl = h.spawn('enemy_flywalk', { routeIndex: 2 });
  h.run(0.5);
  assert.equal(fl.isFlying, true);
  assert.equal(h.b.applyStatus(fl, 'levitate', { duration: 3 }), false, 'a data flyer takes no 浮空');
  assert.ok(h.b.applyStatus(fl, 'groundbind', { duration: 5 }));
  assert.deepEqual([fl.isFlying, !!fl.s.flags.noMove, fl.s.moveSpeed], [false, true, 0], 'ground unit, rooted');
  const x0 = fl.x;
  h.run(1);
  approx(fl.x, x0, 'it does not move');
  assert.ok(h.b.applyStatus(fl, 'levitate', { duration: 2 }), '浮空 lands on a 缚地 flyer');
  assert.equal(fl.isFlying, true, 'levitated: an air unit again');
  // a melee operator (ground-only, range: his own tile) hits a 缚地 flyer on his tile — and blocks it, a ground unit now
  const near = h.spawn('enemy_fly', { pos: [9, 4] });
  h.run(1);
  assert.equal(yak.stats.dmg, 0, '角峰 cannot hit the flyer');
  h.b.applyStatus(near, 'groundbind', { duration: 10 });
  assert.ok(h.runUntil(() => yak.stats.dmg > 0, 5), '缚地: a ground unit he can hit');
  assert.equal(near.blockedBy, yak, 'and block');
  // halving and 抵抗
  const heavy = h.spawn('enemy_flyheavy', { pos: [10, 9] });
  h.b.applyStatus(heavy, 'groundbind', { duration: 10 });
  approx(heavy.findBuff('groundbind').timeLeft, 5, 'weight 4: half');
  const res = h.spawn('enemy_fly', { pos: [11, 9] });
  h.b.applyStatus(res, 'resist', { duration: 99, value: 0.5 });
  h.b.applyStatus(res, 'groundbind', { duration: 10 });
  approx(res.findBuff('groundbind').timeLeft, 5, '抵抗 halves it');
  h.run(6);
  assert.equal(res.isFlying, true, 'back in the air when it ends');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('the hovering enemies (PRTS "受…缚地影响后"): 掠海漂移体 drops to its 爬行模式 for good; 吉兆飞鳞 is down while the 缚地 holds', () => {
  const h = arena();
  const sy = h.spawn('enemy_2025_syufo', { pos: [12, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const pa = h.spawn('enemy_10045_parrot', { pos: [12, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(sy.isFlying && pa.isFlying, 'both hover');
  h.b.applyStatus(sy, 'groundbind', { duration: 4 });
  h.b.applyStatus(pa, 'groundbind', { duration: 20 });
  h.step();
  assert.equal(sy.form, 'crawl', '掠海漂移体: 爬行模式');
  assert.equal(pa.isFlying, false, '吉兆飞鳞: down');
  h.run(10);
  assert.equal(sy.isFlying, false, '掠海漂移体 stays down for good');
  assert.equal(pa.isFlying, false, '吉兆飞鳞 down while the 缚地 holds (its 8 s stun over)');
  h.run(12);
  assert.equal(pa.isFlying, true, '吉兆飞鳞 floats again once nothing holds it');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});
