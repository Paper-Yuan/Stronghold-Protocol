// 阿戈尔's devour hands its marker the block count of what it marks, a 伏击客 included (community report of 2026-10-07:
// 「阿戈尔盟约的干员水月在互吃叠buff时阻挡数没有叠」 — checked, not reproduced): PRTS 卫戍协议：盟约 下半/PRTS盟约记录, 阿戈尔 ※
// 「该付与来源获得所有标记单位的基础攻击力（最终加算）和阻挡数」 and 「不会向“自身”/“自身已付与过标记的单位”/“已将标记付与自身的
// 单位”付与自身标记」 (content/bonds/core.js devour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const walker = enemyRec({ key: 'e_walk', hp: 1e7, speed: 0.8, def: 0, res: 0 });
const bonds = { egirShip: { count: 3, active: true, tier: 1, layers: 0 } };
const MIZUKI = 'chess_char_4_09_a', GHOST = 'chess_char_2_07_a', SKADI = 'chess_char_3_05_a', UDFLOW = 'chess_char_1_04_a';
const battle = (units) => makeBattle({ defs: { enemies: { e_walk: walker } }, timeLimit: 60, bonds, units,
  enemies: [{ key: 'e_walk', time: 1, routeIndex: 0, count: 3, interval: 1.5 }] });
const by = (h, uid) => h.b.allyUnits.find((u) => u.uid === uid);
const maxBlocked = (h, u, until = 25) => { let n = 0; h.runUntil(() => { n = Math.max(n, u.blocking?.length || 0); return h.b.time > until; }, until + 5); return n; };

test('水月 (伏击客, base block 0) devouring takes the block count of what he marks — and blocks with it', () => {
  // one row, the route along row 9: 水月 (9,3) → 幽灵鲨 (9,4), both facing the gate side
  const h = battle([{ uid: 1, chessId: MIZUKI, row: 9, col: 3, dir: 'RIGHT' }, { uid: 2, chessId: GHOST, row: 9, col: 4, dir: 'RIGHT' }, { uid: 3, chessId: SKADI, row: 12, col: 1, dir: 'RIGHT' }]);
  const m = by(h, 1);
  assert.equal(m.base.blockCnt, 0);
  h.step(0.1);
  assert.equal(m.s.blockCnt, 2, '幽灵鲨\'s 2');
  assert.equal(maxBlocked(h, m), 2, 'he holds two enemies at once');
  checkInvariants(h.b);
  // elite 水月 eating a 深巡 (block 3)
  const h2 = battle([{ uid: 1, chessId: 'chess_char_4_09_b', row: 9, col: 3, dir: 'RIGHT' }, { uid: 2, chessId: UDFLOW, row: 9, col: 4, dir: 'RIGHT' }, { uid: 3, chessId: SKADI, row: 12, col: 1, dir: 'RIGHT' }]);
  h2.step(0.1);
  assert.equal(by(h2, 1).s.blockCnt, 3);
  assert.equal(maxBlocked(h2, by(h2, 1)), 3);
});

test('水月 through a chain gains every marked unit\'s block; facing an 阿戈尔 that marked him first, he marks nothing back (PRTS)', () => {
  // 水月 → 幽灵鲨 → 斯卡蒂 (facing up): 水月 marks both (2 + 1), 幽灵鲨 marks 斯卡蒂 (2 + 1)
  const h = battle([{ uid: 1, chessId: MIZUKI, row: 9, col: 3, dir: 'RIGHT' }, { uid: 2, chessId: GHOST, row: 9, col: 4, dir: 'RIGHT' }, { uid: 3, chessId: SKADI, row: 9, col: 5, dir: 'UP' }]);
  h.step(0.1);
  assert.deepEqual([by(h, 1).s.blockCnt, by(h, 2).s.blockCnt], [3, 3]);
  // face to face: 幽灵鲨 (further left) marks first; 水月 never marks 「已将标记付与自身的单位」 — no block for him
  const h2 = battle([{ uid: 2, chessId: GHOST, row: 9, col: 2, dir: 'RIGHT' }, { uid: 1, chessId: MIZUKI, row: 9, col: 3, dir: 'LEFT' }, { uid: 3, chessId: SKADI, row: 12, col: 1, dir: 'RIGHT' }]);
  h2.step(0.1);
  assert.equal(by(h2, 2).s.blockCnt, 2, '幽灵鲨 + 水月\'s 0');
  assert.equal(by(h2, 1).s.blockCnt, 0, '水月 gains nothing from the 阿戈尔 that marked him');
});
