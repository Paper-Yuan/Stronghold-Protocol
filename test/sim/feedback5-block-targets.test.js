// test/sim/feedback5-block-targets.test.js — "同时攻击阻挡的所有敌人" takes up to the block count of targets (the queued 0.2.0
// question; PRTS 分支特性信息 强攻手 / 重剑手 / 推击手 "普通攻击最大目标数等于阻挡数（不会低于1）", PRTS 作战机制 §AOE伤害判定 "锁定人数的无
// 弹道AOE攻击（例如近卫分支“强攻手”）…在抬手时选取范围内的全体目标（不超过其攻击目标上限）"; the client's selector flag
// _limitedMaxTargetNumToBlockedCnt) — server/sim/ai.js acquireTargets / targetCount (`hitAllBlocked`). Until 0.2.0 it struck
// the enemies it blocked only (one in range when it blocked none).
// Run: node --test test/sim/feedback5-block-targets.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

// a 强攻手 (block 3) whose range is its tile and the three ahead
const CENT = chessRec({ id: 't_cent', subProfessionId: 'centurion', stats: { maxHp: 1e6, atk: 100, def: 1e4, blockCnt: 3, bat: 1 }, skill: null, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] });
const dummy = (key) => enemyRec({ key, hp: 1e9, speed: 0, atk: 0 });

/** The targets of its first attack, with enemies at `at` ([row, col] each). */
function firstAttack(at, setup = null) {
  const h = makeBattle({
    defs: { chess: { t_cent: CENT }, enemies: { e: dummy('e') } }, units: [{ chessId: 't_cent', row: 10, col: 5 }],
    enemies: at.map((pos) => ({ key: 'e', pos })), content: 'none', autoFinish: false, timeLimit: 30, hooks: ['attack'], captureNoisy: true,
    setup,
  });
  const u = h.unit('t_cent');
  assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 3));
  const atk = h.hooksOf('attack').find((c) => c.attacker === u);
  checkInvariants(h.b);
  return { h, u, targets: atk.targets };
}

test('blocking one enemy with two more in its range: one attack strikes all three (up to its block count, the blocked one first)', () => {
  const { u, targets } = firstAttack([[10, 5], [10, 6], [10, 7]]);
  assert.equal(u.blocking.length, 1, 'it blocks the one on its tile');
  assert.equal(targets.length, 3);
  assert.equal(targets[0], u.blocking[0], 'the blocked enemy first');
});

test('blocking none: up to its block count from the range; never more than the block count; never fewer than 1', () => {
  const free = firstAttack([[10, 6], [10, 7], [10, 8]]);
  assert.equal(free.u.blocking.length, 0);
  assert.equal(free.targets.length, 3, 'three in range, none blocked: three targets');
  const crowd = firstAttack([[10, 5], [10, 6], [10, 6], [10, 7], [10, 7], [10, 8]]);
  assert.equal(crowd.targets.length, 3, 'six in reach: its block count of them');
  assert.ok(crowd.u.blocking.every((e) => crowd.targets.includes(e)), 'every enemy it blocks among them');
  const zero = firstAttack([[10, 6], [10, 7]], (b) => {
    b.on('deploy', (c) => { if (c.unit.defId === 't_cent') b.addBuff(c.unit, { key: 'test:noBlock', mods: { blockCnt: -99 } }); });
  });
  assert.equal(zero.targets.length, 1, 'block count 0: still one target (不会低于1)');
});
