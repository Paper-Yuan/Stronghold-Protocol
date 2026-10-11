// test/sim/feedback5-catapult-smog.test.js — 自制投石机's 「索敌不受阻挡影响」 (community report of 2026-10-06, item 24, a
// player's report of the official game: 「投石车」敌人如果被蒸汽地板上的干员阻挡会不进行攻击; DESIGN §25.18).
// PRTS 自制投石机 天赋: 「普通攻击为3连击…索敌不受阻挡影响，且不会因丢失目标而结束攻击」. An operator on the 排气格栅 smog
// (战场#07 下半, tile_smog) is 隐匿 for enemy ranged attacks; any other enemy still attacks the operator that blocks it
// ("阻挡优先级最高"), but the catapult's targeting ignores its block, so that blocker is no target: alone, it is not attacked.
// Run: node --test test/sim/feedback5-catapult-smog.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, flatStage, checkInvariants } from '../helpers/battleHarness.js';

const KEY = 'enemy_10162_mnctpt'; // 自制投石机 (RANGED, range 4.0)
const wall = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const other = chessRec({ id: 't_other', profession: 'SNIPER', stats: { atk: 0, maxHp: 1e9, def: 0, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
const kits = { t_wall: () => ({ trait: { noAttack: true } }), t_other: () => ({ trait: { noAttack: true } }) };
const route = { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] };
const shooter = enemyRec({ key: 'enemy_t_shooter', hp: 1e9, atk: 100, range: 3, speed: 1, bat: 2 }); // an ordinary ranged walker

function run({ smog, withOther = false, key = KEY }) {
  const stage = flatStage();
  if (smog) stage.rows[9] = stage.rows[9].slice(0, 6) + 'g' + stage.rows[9].slice(7);   // the blocker's tile (9,6)
  const units = [{ chessId: 't_wall', row: 9, col: 6 }];
  if (withOther) units.push({ chessId: 't_other', row: 11, col: 6 });
  const h = makeBattle({ stage, autoFinish: false, timeLimit: 60, defs: { chess: { t_wall: wall, t_other: other }, enemies: { enemy_t_shooter: shooter } }, kits, units, enemies: [{ key, route }] });
  h.step();
  const e = h.enemy(key);
  assert.ok(h.runUntil(() => e.blockedBy, 30), 'blocked by the wall');
  h.run(20);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
  return { e, h, wall: h.unit('t_wall'), other: withOther ? h.unit('t_other') : null };
}

test('自制投石机 blocked by an operator on the 排气格栅, nobody else in range: no attack', () => {
  const { e, wall: w } = run({ smog: true });
  assert.ok(w.s.flags.stealth, 'the smog tile hides the blocker from ranged attacks');
  assert.equal(e.blockedBy, w);
  assert.equal(e.stats.attacks, 0);
  assert.equal(w.stats.taken, 0);
});

test('自制投石机 blocked on the 排气格栅 shoots another operator in its range instead; off the smog it hits its blocker', () => {
  const a = run({ smog: true, withOther: true });
  assert.ok(a.e.stats.attacks >= 2);
  assert.equal(a.wall.stats.taken, 0, 'the hidden blocker is never its target');
  assert.ok(a.other.stats.taken > 0);
  const b = run({ smog: false });
  assert.ok(b.e.stats.attacks >= 2);
  assert.ok(b.wall.stats.taken > 0, 'a visible blocker is a target as before');
});

test('any other ranged enemy still attacks the operator that blocks it on the 排气格栅 (阻挡优先级最高)', () => {
  const { e, wall: w } = run({ smog: true, key: 'enemy_t_shooter' });
  assert.ok(w.s.flags.stealth);
  assert.ok(e.stats.attacks >= 2 && w.stats.taken > 0);
});
