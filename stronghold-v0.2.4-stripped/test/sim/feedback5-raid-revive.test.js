// test/sim/feedback5-raid-revive.test.js — community report of 2026-10-06 (item 44) 「突袭盟约的干员如果带被动技能，复活之后不会
// 立马突袭出去，还要等突袭CD」. A 突袭 member counts a running deploy-timed skill ("部署后…秒内": 缄默德克萨斯 S1–S3 …) as 技能
// 就绪 (bonds/addon/battle.js raidPoll, GitHub #49 / #109), so after a redeploy it jumps at once when nothing is in its range.
// PRTS's 复活 (M3茧甲, 埃芒加德) is 退场 + a 0-time / 0-cost redeploy (PRTS 盟约记录 备注) — a new deployment — but the remake
// revived in place: her window, over by then, stayed over and she waited out the 10 s idle time. CB3 started a deploy-timed
// skill again after the in-place revive; since the CB1 merge the 复活 IS that redeploy (content/items/battle.js reviveNow:
// knocked out, back at once, free, on her tile), whose skill reset starts the window anew — the tests hold for both, and
// 不屈's real redeploy already did.
// Run: node --test test/sim/feedback5-raid-revive.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const TEX = 'chess_char_4_16_a';
const DUMMY = { enemy_rv: enemyRec({ key: 'enemy_rv', hp: 1e9, speed: 0, mass: 0, atk: 0 }) };
const RAID = { raidShip: { count: 3, active: true, tier: 1, layers: 10 } };

/**
 * 缄默德克萨斯 (S3, a 6 s deploy-timed skill) in 突袭 with `extra` (items / band): she jumps to a parked enemy, stays past her
 * window, the enemy is removed, she is knocked out with nothing in range, a new enemy parks away from her. Returns how long
 * after the knock-out her next jump comes (null: none within 15 s) and her skill state right after the revive.
 */
function reviveAndJump({ items, bandId = null, bonds = {} }) {
  const h = makeBattle({
    seed: 3, autoFinish: false, timeLimit: 120, hooks: ['deploy', 'death'], defs: { enemies: DUMMY }, bandId,
    bonds: { ...RAID, ...bonds }, enemies: [{ key: 'enemy_rv', pos: [9, 9] }], units: [{ chessId: TEX, row: 12, col: 3, skillIndex: 2, items }],
  });
  h.step();
  const u = h.unit(TEX);
  const jumps = () => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial);
  assert.ok(h.runUntil(() => jumps().length >= 1, 10), 'her first jump');
  h.run(8);
  assert.equal(u.skill.active, false, 'her 6 s window is over');
  for (const e of h.b.enemies.filter((x) => x.alive)) h.b.kill(e, null);
  const t0 = h.b.time;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  h.spawn('enemy_rv', { pos: [12, 9] });
  h.step();
  const state = { alive: u.alive, active: u.skill.active, timeLeft: u.skill.timeLeft };
  const n = jumps().length;
  const jumped = h.runUntil(() => jumps().length > n && u.tileR === 12, 15);
  checkInvariants(h.b);
  return { after: jumped ? h.b.time - t0 : null, state, u, h };
}

test('M3茧甲 / 埃芒加德 revive 缄默德克萨斯 in place: her deploy-timed S3 runs again and she jumps at once (until 0.2.0 only after the 10 s idle)', () => {
  for (const [label, opts] of [['M3茧甲', { items: ['chess_item_4_12_e_a'] }], ['埃芒加德', { bandId: 'band_ermengard' }]]) {
    const { after, state } = reviveAndJump(opts);
    assert.ok(state.alive, `${label}: revived in place`);
    assert.ok(state.active, `${label}: her deploy-timed S3 runs again`);
    assert.ok(after != null && after < 1, `${label}: jumped ${after?.toFixed(2)} s after the knock-out`);
  }
});

test('不屈\'s 立刻重新部署 (a real redeploy) already jumped at once — unchanged', () => {
  const { after } = reviveAndJump({ bonds: { indomShip: { count: 2, active: true, tier: 1, layers: 300 } } });
  assert.ok(after != null && after < 1, `jumped ${after?.toFixed(2)} s after the knock-out`);
});

test('an in-place revive inside the window sets it back to its full length; 砾 revived by M3茧甲 gets a fresh barrier', () => {
  const h = makeBattle({ seed: 3, autoFinish: false, timeLimit: 60, units: [{ chessId: TEX, row: 12, col: 3, skillIndex: 2, items: ['chess_item_4_12_e_a'] }] });
  h.step();
  const u = h.unit(TEX);
  h.run(3);
  assert.ok(u.skill.active && u.skill.timeLeft < u.skill.duration - 2, 'half-way through the window');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  h.step(2);
  assert.ok(u.alive && u.skill.active && u.skill.timeLeft > u.skill.duration - 0.2, `back to the full ${u.skill.duration} s (${u.skill.timeLeft.toFixed(2)})`);
  checkInvariants(h.b);

  const g = makeBattle({ seed: 3, autoFinish: false, timeLimit: 60, units: [{ chessId: 'chess_char_2_12_a', row: 10, col: 4, items: ['chess_item_4_12_e_a'] }] });
  g.step();
  const gr = g.unit('chess_char_2_12_a');
  g.run(12);
  assert.ok(!gr.findBuff('gravel:rats'), 'the deployment barrier has run out');
  g.b.dealDamage(null, gr, { amount: 1e9, type: 'true' });
  g.step(2);
  assert.ok(gr.alive && gr.findBuff('gravel:rats')?.shield > 0, 'a fresh barrier after the revive');
  checkInvariants(g.b);
});
