// test/content/feedback5-swire2-self-heal.test.js — 琳琅诗怀雅 S1 仗义疏财 heals herself too (community report of 2026-10-06
// 「干员琳琅诗怀雅不会治疗自己」): 「下一次攻击会为周围八格内血量不足70%的一名友方单位恢复…」 — the client charpack
// (char_1033_swire2, mode S1, ability HealAlly) selects with range x-4 (the 3×3 with her own tile), ally side,
// `_excludeOwner` 0, max HP ratio 0.7, one target. kits/ops/chess_char_3_04-swire2.js used to skip her own tile.
// Run: node --test test/content/feedback5-swire2-self-heal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ds = getDefaultSource();
const ID = 'chess_char_3_04_a', S1 = 'skchr_swire2_1';
const S1_INDEX = ds.rawChess(ID).skills.find((s) => s.skillId === S1).index;
const NEIGHBOUR = 'chess_char_3_16_a';

/** 琳琅诗怀雅 (S1) on (9, 5), an ally on (10, 5); HP ratios set after the deployment; coins to spare. */
function field(herRatio, allyRatio) {
  const h = makeBattle({
    defs: { enemies: { enemy_d: enemyRec({ key: 'enemy_d', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: ID, row: 9, col: 5, skillIndex: S1_INDEX }, { chessId: NEIGHBOUR, row: 10, col: 5 }],
    timeLimit: 60, autoFinish: false, hooks: ['heal'], captureNoisy: true, flags: { dpInit: 60, dpMax: 99 },
  });
  h.step();
  const u = h.unit(ID), ally = h.unit(NEIGHBOUR);
  u.mem.coins = 2;
  u.hp = u.s.maxHp * herRatio;
  ally.hp = ally.s.maxHp * allyRatio;
  h.run(1);
  return { h, u, ally, heals: h.hooksOf('heal').filter((c) => c.source === u) };
}

test('alone below 70 %: a coin heals herself (her own tile is in the x-4 selector)', () => {
  const { h, u, heals } = field(0.5, 1);
  assert.equal(heals.length, 1, 'one heal');
  assert.equal(heals[0].target, u, 'on herself');
  assert.equal(u.mem.coins, 1, 'one coin spent');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('the lowest HP ratio of the 3×3 wins: herself below the neighbour, the neighbour below her; 70 % or more is never healed', () => {
  assert.equal(field(0.4, 0.6).heals[0].target.defId, ID, 'she is lower: herself');
  assert.equal(field(0.6, 0.4).heals[0].target.defId, NEIGHBOUR, 'the neighbour is lower: the neighbour');
  const none = field(0.75, 1);
  assert.equal(none.heals.length, 0, 'not below 70 %: no heal, the coin is kept');
  assert.equal(none.u.mem.coins, 2);
});
