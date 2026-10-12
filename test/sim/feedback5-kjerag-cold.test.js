// Community reports of 2026-10-06 「谢拉格盟约冰冻时间没有随层数正确成长」 and 「谢拉格盟约冰冻敌人有概率在未受到后续干员施加
// 寒冷的情况下，被在无法被任何干员攻击到的地方永控」 (items 7 / 8): the 6-member wind (every 25 s, 寒冷 20 + 0.1 × layers s,
// data/bonds.json kjeragShip) froze an enemy for the rest of the battle from 51 layers on and never below: a second cold
// froze for max(remaining, incoming) and the older cold stayed on for as long, so the next gust always found a cold.
// PRTS 术语释义 寒冷: 「友方寒冷始终需要两两一对产生友方冻结，持续时间取双方之中最高」; 异常效果 COLD 「在特定条件下转变为冻结」 —
// the pair becomes the freeze, no cold is left. A 敌方 cold (on an operator) keeps the old rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);

/** One harmless enemy parked at the gate, out of every operator's reach; 谢拉格 6 at `layers`; seconds frozen per window. */
function windTimeline(layers, until = 200) {
  const h = makeBattle({
    units: [{ chessId: 'chess_char_4_22_a', row: 11, col: 3 }],
    bonds: { kjeragShip: { count: 6, layers, active: true, tier: 2 } },
    enemies: [{ key: 'enemy_park', time: 0, route: 0 }],
    defs: { enemies: { enemy_park: enemyRec({ key: 'enemy_park', hp: 1e9, atk: 0, speed: 0.00001 }) } },
    timeLimit: until, seed: 1, hooks: ['statusApplied'],
  });
  const frozenAt = [];
  while (!h.b.finished && h.b.time < until - 0.1) {
    h.step();
    const e = h.b.enemies[0];
    frozenAt.push([h.b.time, !!(e && e.s.flags.freeze), !!(e && e.findBuff('cold'))]);
  }
  const frozenBetween = (t0, t1) => frozenAt.filter(([t, f]) => t >= t0 && t < t1 && f).length * h.TICK;
  return { h, frozenAt, frozenBetween, at: (t) => frozenAt.find(([x]) => x >= t) };
}

test('谢拉格 wind alone: below 50 layers it never freezes (each 20 + 0.1·L s cold ends before the next gust)', REAL, () => {
  const { frozenBetween } = windTimeline(40, 160);
  assert.equal(frozenBetween(0, 160), 0);
});

test('谢拉格 wind alone at 60 layers: frozen 26 s out of every 50 s, not for the rest of the battle', REAL, () => {
  const { frozenBetween, at } = windTimeline(60);
  // gust 1 (25 s): cold 26 s; gust 2 (50 s): the pair → 26 s freeze, no cold left; gust 3 (75 s): a lone cold, still frozen
  // to 76 s; gust 4 (100 s): the pair again …
  close(frozenBetween(50, 100), 26, 0.2, 'the first freeze lasts the wind cold');
  assert.equal(at(80)[1], false, 'free at 80 s (the parent kept it frozen from 50 s to the end)');
  assert.equal(at(80)[2], true, 'with gust 3\'s lone cold on it');
  assert.equal(at(101)[1], true, 'gust 4 pairs that cold: frozen again');
  close(frozenBetween(100, 150), 26, 0.2);
});

test('谢拉格 wind alone: the frozen share grows with the layers (60 → 26 s, 200 → 40 s per 50 s), all of it from 300 on', REAL, () => {
  close(windTimeline(60).frozenBetween(100, 150), 26, 0.2, '60 layers');
  close(windTimeline(200).frozenBetween(100, 150), 40, 0.2, '200 layers');
  close(windTimeline(300).frozenBetween(100, 150), 50, 0.2, '300 layers: 50 s of cold covers the 50 s cycle');
});

test('友方寒冷: the pair becomes the freeze; a lone cold on a frozen enemy is a cold and does not extend the freeze', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0 }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false, timeLimit: 60, hooks: ['statusApplied'],
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'cold', { duration: 6 });
  h.b.applyStatus(e, 'cold', { duration: 4 });
  close(e.findBuff('freeze').timeLeft, 6, 1e-6, 'max of the pair');
  assert.equal(e.findBuff('cold'), null, 'no cold left');
  h.run(1);
  h.b.applyStatus(e, 'cold', { duration: 10 });
  close(e.findBuff('freeze').timeLeft, 5, 0.05, 'a third cold does not freeze again (it has no partner)');
  close(e.findBuff('cold').timeLeft, 10, 1e-6, 'it waits as a cold');
  h.b.applyStatus(e, 'cold', { duration: 2 });
  close(e.findBuff('freeze').timeLeft, 10, 1e-6, 'a fourth one pairs with it: max(10, 2)');
  assert.equal(e.findBuff('cold'), null);
  assert.equal(h.hooksOf('statusApplied').filter((c) => c.status === 'freeze').length, 2, 'two pairs, two freezes');
});

test('敌方寒冷 on an operator keeps the old rule: the freeze and the longer cold both stay', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_02_a', row: 10, col: 4 }], content: 'none', autoFinish: false, timeLimit: 60 });
  h.step();
  const u = h.unit('chess_char_1_02_a');
  h.b.applyStatus(u, 'cold', { duration: 6 });
  h.b.applyStatus(u, 'cold', { duration: 4 });
  close(u.findBuff('freeze').timeLeft, 6, 1e-6);
  close(u.findBuff('cold').timeLeft, 6, 1e-6);
});
