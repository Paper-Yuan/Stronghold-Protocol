// test/sim/feedback5-ulpia-revive-home.test.js — community report of 2026-10-06 (item 28) 「乌尔比安3技能期间死亡会留在3技能位移后
// 的位置复活，应回到初始部署位复活」 and the owner's decision of 2026-10-07: 乌尔比安 knocked out while his S3 必须开辟的通路 has
// moved him onto the anchor tile lies — and comes back — on his deployment tile. A deliberate deviation from the PRTS rule
// every other operator keeps (PRTS 卫戍协议/帮助 「原地留下一个“倒地干员”…满足再部署条件时…自动部署至该位置」: where it fell,
// Battle._layBody, DESIGN §21.24), narrowly for that 【移动】 (Unit.downAtHome, set by kits/ops/chess_char_5_05-ulpia.js).
// Run: node --test test/sim/feedback5-ulpia-revive-home.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const ULPIA = 'chess_char_5_05_a';
const DUMMY = { enemy_anchor_dummy: enemyRec({ key: 'enemy_anchor_dummy', hp: 1e9, speed: 0, mass: 0, atk: 0 }) };
const kill = (b, u) => b.dealDamage(null, u, { amount: 1e9, type: 'true' });
/** The tile b.snap's `down` entry of `u` names ([id, respawnAt, respawnTime, state, row, col]): where the client draws it. */
const downTile = (b, u) => (b.snapshot().down || []).find((d) => d[0] === u.id)?.slice(4) ?? null;

/** 乌尔比安 on (10, 3) of the flat field casts S3 at an enemy parked on (10, 7): he moves onto the anchor tile. */
function movedByS3({ items } = {}) {
  const h = makeBattle({
    stageId: 'flat', seed: 5, autoFinish: false, timeLimit: 300, defs: { enemies: DUMMY },
    units: [{ chessId: ULPIA, row: 10, col: 3, ...(items ? { items } : null) }],
  });
  h.step();
  const u = h.unit(ULPIA);
  const home = [u.tileR, u.tileC];
  h.spawn('enemy_anchor_dummy', { pos: [10, 7] });
  h.step();
  u.skill.gainSp(999, 'test');
  if (!u.skill.active) assert.ok(u.skill.activate('test'), 'S3 cast');
  h.run(0.2);
  assert.ok(u.alive && u.skill.active, 'S3 runs');
  const landed = [u.tileR, u.tileC];
  assert.deepEqual(home, [10, 3]);
  assert.deepEqual(landed, [10, 7], 'moved onto the anchor tile');
  return { h, u, home, landed };
}

test('knocked out during S3, 乌尔比安 lies on his deployment tile and redeploys there, not on the anchor tile (until 0.2.0: where he fell)', () => {
  const { h, u, home, landed } = movedByS3();
  kill(h.b, u);
  assert.ok(h.b.isDown(u), 'knocked out');
  assert.deepEqual(h.b.restTile(u), home, 'he lies on his deployment tile');
  assert.deepEqual(downTile(h.b, u), home, 'the client draws him there');
  assert.equal(h.b.isReservedTile(...home), true, 'his deployment tile is held for him');
  assert.equal(h.b.isReservedTile(...landed), false, 'the anchor tile is free');
  assert.equal(h.b.allyUnits.filter((a) => a.kind === 'token' && a.alive).length, 0, 'the 从不混淆的方向 marker is gone with the skill');
  assert.ok(h.runUntil(() => u.alive, 120), 'he redeploys');
  assert.deepEqual([u.tileR, u.tileC], home, 'on his deployment tile');
  assert.equal(u.downAtHome, false, 'a new deployment: the next knock-out follows the rule again');
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []);
});

test('revived by M3茧甲 during S3 (CB1: a knock-out and an immediate free redeploy where he lies), he stands on his deployment tile', () => {
  const { h, u, home } = movedByS3({ items: ['chess_item_4_12_e_a'] });
  kill(h.b, u);
  assert.ok(u.alive, 'revived at once');
  assert.deepEqual([u.tileR, u.tileC], home, 'on his deployment tile');
  checkInvariants(h.b);
});

test('narrow: after S3 has ended (and taken him back) and for any other moved operator, a knock-out keeps the PRTS rule — where it fell', () => {
  // S3 over: the 【返回】 brings him home, the flag is gone
  const { h, u, home } = movedByS3();
  assert.ok(h.runUntil(() => !u.skill.active, 40), 'S3 ends');
  assert.deepEqual([u.tileR, u.tileC], home, 'back home (【返回】)');
  assert.equal(u.downAtHome, false);
  // a 突袭 member that jumped next to an enemy and fell there lies there (feedback1f-downed-tile.test.js has the full rule)
  const rec = chessRec({ id: 'r_mover', bonds: ['raidShip'], profession: 'WARRIOR', skill: null });
  const g = makeBattle({
    stageId: 'flat', seed: 5, autoFinish: false, timeLimit: 120, bonds: { raidShip: { count: 1, active: true, tier: 1, layers: 0 } },
    defs: { chess: { r_mover: rec }, enemies: DUMMY }, units: [{ chessId: 'r_mover', row: 12, col: 3 }],
    enemies: [{ key: 'enemy_anchor_dummy', pos: [10, 8] }],
  });
  const m = g.unit('r_mover');
  assert.ok(g.runUntil(() => m.alive && m.deployed && (m.tileR !== 12 || m.tileC !== 3), 30), 'the member jumped');
  const fell = [m.tileR, m.tileC];
  kill(g.b, m);
  assert.deepEqual(g.b.restTile(m), fell, 'it lies where it fell');
  checkInvariants(g.b);
});
