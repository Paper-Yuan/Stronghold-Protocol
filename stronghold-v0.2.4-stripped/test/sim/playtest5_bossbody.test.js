// User playtest #5 item 10 — "大体型的关底boss实际受击判定范围很小，是不是就一格，跟官方原版不一样，原版是很大的一片区域".
//
// Official (PRTS enemy pages, 天赋 "巨型单位：受击判定区域为长4.95、宽2.95的长方形，向上偏移1.0"; 假想敌：管 隐秘核心 also
// "向右偏移1.0"; 卫戍协议：盟约 下半/PRTS盟约记录: the season's 阿利斯泰尔 / “萨米的意志” have the same 4.95 × 2.95, up 1) and
// PRTS 作战机制 "巨型BOSS单位的每一个占据的格子都可以让其本身通过格子判定": a huge boss is hit anywhere on its rectangle —
// every tile it occupies counts for grid ranges, radius effects measure to the rectangle. Regular enemies are
// unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { bodyKeys, bodyDist, bodyInKeys, bodyOnTile, bodyTileReach, hitRect, normHitArea } from '../../server/sim/body.js';
import { COLS } from '../../server/sim/constants.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const tiles = (keys) => keys.map((k) => [Math.floor(k / COLS), k % COLS]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const block = (r0, r1, c0, c1) => { const o = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) o.push([r, c]); return o; };

test('data: the huge bosses carry the PRTS hit areas, everything else is a point', () => {
  const want = {
    enemy_9013_acstmk: { w: 4.95, h: 2.95, dx: 0, dy: 1 }, enemy_9013_acstmk_2: { w: 4.95, h: 2.95, dx: 0, dy: 1 },
    enemy_9021_acduml: { w: 4.95, h: 2.95, dx: 0, dy: 1 }, enemy_9021_acduml_2: { w: 4.95, h: 2.95, dx: 1, dy: 1 },
    enemy_1521_dslily: { w: 4.95, h: 2.95, dx: 0, dy: 1 }, enemy_9032_aclionk: { w: 4.95, h: 2.95, dx: 0, dy: 1 },
    enemy_9033_acdeer: { w: 4.95, h: 2.95, dx: 0, dy: 1 },
  };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(E[k].hitArea, v, k);
  const others = Object.keys(E).filter((k) => E[k].hitArea && !want[k]);
  assert.deepEqual(others, [], 'no other enemy is huge (假想敌：铳 / 卢西恩 / the parts are regular)');
  for (const k of ['enemy_9017_achunt', 'enemy_9017_achunt_2', 'enemy_2016_csphtm', 'enemy_9014_acstma', 'enemy_9022_acdumm']) assert.equal(E[k].hitArea, undefined, k);
  assert.equal(normHitArea({ w: 0, h: 1 }), null);
  assert.equal(normHitArea(null), null);
});

test('geometry: 4.95 × 2.95 up 1 at the boss tile (3,10) occupies rows 3–5 × cols 8–12; 管 (隐秘核心) at (3,9) the same block', () => {
  const boss = { x: 10, y: 3, hitArea: normHitArea(E.enemy_9013_acstmk.hitArea) };
  assert.deepEqual(tiles(bodyKeys(boss)), block(3, 5, 8, 12));
  const pipe2 = { x: 9, y: 3, hitArea: normHitArea(E.enemy_9021_acduml_2.hitArea) };
  assert.deepEqual(tiles(bodyKeys(pipe2)), block(3, 5, 8, 12));
  assert.ok(bodyOnTile(boss, 5, 12) && bodyOnTile(boss, 3, 8) && !bodyOnTile(boss, 2, 10) && !bodyOnTile(boss, 4, 13));
  const R = hitRect(boss);
  assert.deepEqual([R.x0, R.x1, R.y0, R.y1].map((v) => +v.toFixed(3)), [7.525, 12.475, 2.525, 5.475]);
  assert.equal(bodyDist(boss, 10, 4), 0, 'inside');
  assert.ok(Math.abs(bodyDist(boss, 13.475, 4) - 1) < 1e-9, '1 tile right of the edge');
  assert.equal(bodyTileReach(boss, 4, 13), 1);
  assert.equal(bodyTileReach(boss, 4, 12), 0);
  // a regular enemy is its position's tile / a point
  const e = { x: 6.4, y: 9.6 };
  assert.deepEqual(tiles(bodyKeys(e)), [[10, 6]]);
  assert.ok(bodyInKeys(e, new Set([10 * COLS + 6])) && !bodyInKeys(e, [10 * COLS + 7]));
  assert.ok(Math.abs(bodyDist(e, 6.4, 10.6) - 1) < 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------
// battles

const HUGE = { ...enemyRec({ key: 'enemy_huge', hp: 1e8, speed: 0, rank: 'BOSS' }), hitArea: { w: 4.95, h: 2.95, dx: 0, dy: 1 } };
const SMALL = enemyRec({ key: 'enemy_small', hp: 1e8, speed: 0 });
const blade = (id, rangeGrid = [[0, 0], [0, 1]]) => chessRec({ id, stats: { atk: 100, blockCnt: 0, maxHp: 1e7 }, rangeGrid, skill: null });

function bossField(units, key, pos = [3, 10], extra = {}) {
  const h = makeBattle({
    kind: 'boss', content: 'none', autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { t_edge: blade('t_edge'), t_far: blade('t_far'), t_aoe: extra.aoe ?? blade('t_aoe') }, enemies: { enemy_huge: HUGE, enemy_small: SMALL } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', units: units.map((u, i) => ({ uid: i + 1, kind: 'chess', ...u })), bonds: {} }],
  });
  h.step();
  const e = h.spawn(key, { pos, routeIndex: 0 });
  return { h, e };
}
const hitsOn = (h, e, u) => h.hooksOf('damaged').filter((c) => c.target === e && c.source === u).length;

test('#10: an operator whose range touches only the edge of the boss area hits it (and not a regular enemy there)', () => {
  // (4,7) facing RIGHT covers (4,7),(4,8) — (4,8) is the left column of the boss body; the boss's own tile (3,10) is
  // far
  for (const [key, expectHit] of [['enemy_huge', true], ['enemy_small', false]]) {
    const { h, e } = bossField([{ chessId: 't_edge', row: 4, col: 7, dir: 'RIGHT' }], key);
    const u = h.unit('t_edge');
    h.run(5);
    assert.equal(hitsOn(h, e, u) > 0, expectHit, `${key}: ${hitsOn(h, e, u)} hits`);
    checkInvariants(h.b);
  }
});

test('#10: every tile of the 5 × 3 body counts; one tile outside it does not', () => {
  // a 1-tile range operator (its own tile only) on the boss's corner tiles (5,12) and (3,8) hits; on (2,9) (below it) /
  // (4,13) (right of it) it does not
  const one = [[0, 0]];
  for (const [r, c, want] of [[5, 12, true], [3, 8, true], [5, 8, true], [4, 13, false], [2, 9, false]]) {
    const h = makeBattle({
      kind: 'boss', content: 'none', autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      defs: { chess: { t_one: blade('t_one', one) }, enemies: { enemy_huge: HUGE } },
      players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', units: [{ uid: 1, kind: 'chess', chessId: 't_one', row: r, col: c }], bonds: {} }],
    });
    h.step();
    const e = h.spawn('enemy_huge', { pos: [3, 10], routeIndex: 0 });
    h.run(4);
    assert.equal(hitsOn(h, e, h.unit('t_one')) > 0, want, `(${r},${c})`);
  }
});

test('#10: radius effects reach the body — an AoE 1 tile beyond the rectangle edge hits it, a regular enemy there is not hit', () => {
  for (const [key, want] of [['enemy_huge', 1], ['enemy_small', 0]]) {
    const { h, e } = bossField([], key);
    const got = h.b.enemiesInRadius(13.475, 4, 1.0).filter((x) => x === e).length;
    assert.equal(got, want, key);
    assert.equal(h.b.enemiesInRadius(13.6, 4, 1.0).filter((x) => x === e).length, 0, `${key}: beyond reach`);
    // splash around a target is a 中点判定 (PRTS 作战机制): by position, the body does not count
    assert.equal(h.b.enemiesInRadius(13.475, 4, 1.0, true).filter((x) => x === e).length, 0, `${key}: centre-point radius`);
    assert.equal(h.b.enemiesInRadius(11, 3, 1.0, true).filter((x) => x === e).length, 1, `${key}: its position within r`);
  }
});

test('#10 (follow-up): an operator\'s splash on an escort next to the huge boss does not reach the boss (中点判定)', () => {
  // escort at (2,9): 0.525 below the boss rectangle (rows 2.525–5.475), 1.41 from the boss's position (3,10). A splash
  // caster targeting only the escort (range: its tile) splashes 1.1 around it — by PRTS 作战机制 "中点判定…酒神1天赋的1.3
  // 溅射半径" the boss (centre 1.41 away) is not hit; a regular enemy 1.0 away from the escort is
  const aoe = chessRec({ id: 't_aoe', profession: 'CASTER', subProfessionId: 'splashcaster', dmgType: 'arts', stats: { atk: 100, blockCnt: 0, maxHp: 1e7 }, rangeGrid: [[0, 3]], skill: null });
  const { h, e } = bossField([{ chessId: 't_aoe', row: 2, col: 6, dir: 'RIGHT' }], 'enemy_huge', [3, 10], { aoe });
  const esc = h.spawn('enemy_small', { pos: [2, 9], routeIndex: 0 });
  const near = h.spawn('enemy_small', { pos: [2, 10], routeIndex: 0 });
  const u = h.unit('t_aoe');
  assert.ok(h.runUntil(() => hitsOn(h, esc, u) > 0, 10), 'the caster hits the escort');
  h.run(3);
  assert.ok(hitsOn(h, near, u) > 0, 'a regular enemy 1.0 from the escort takes the splash');
  assert.equal(hitsOn(h, e, u), 0, 'the huge boss (position 1.41 away, body 0.53 away) takes none');
  checkInvariants(h.b);
});

test('#10: the enemy index lists a huge enemy once per query and unitsInGrid sees its body', () => {
  const { h, e } = bossField([{ chessId: 't_far', row: 4, col: 3, dir: 'RIGHT' }], 'enemy_huge');
  h.step();
  const all = [];
  for (let r = 0; r <= 5; r++) for (let c = 0; c <= 20; c++) all.push(r * COLS + c);
  const u = h.unit('t_far');
  assert.deepEqual(h.b.enemiesInKeys(all, u, { canHitFly: true }).map((x) => x.id), [e.id]);
  assert.deepEqual(h.b.unitsInGrid(u, [[0, 5]]).map((x) => x.id), [e.id], '(4,8) is on the body');
  assert.deepEqual(h.b.unitsInGrid(u, [[0, 4]]).map((x) => x.id), [], '(4,7) is not');
});

test('#10: the real 假想敌：胄 on the real boss stage — an operator on the 1×3 fence left of the pipe block hits it', () => {
  // act2autochess_m01 boss field: floor cols 9–11 rows 3–5 framed by fence tiles (b, deployable) at cols 8 and 12;
  // the boss stands at (3,10). A melee operator on the fence (4,8) facing RIGHT covers (4,8),(4,9) — both on the boss
  // body.
  const h = makeBattle({
    kind: 'boss', stageId: 'act2autochess_m01', content: 'none', autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { t_edge: blade('t_edge') } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', units: [{ uid: 1, kind: 'chess', chessId: 't_edge', row: 4, col: 8, dir: 'RIGHT' }], bonds: {} }],
  });
  h.step();
  const boss = h.spawn('enemy_9013_acstmk', { pos: [3, 10], routeIndex: 0, tag: 'boss', mods: { speedMul: 0 } });
  assert.ok(boss.hitArea, 'the boss unit carries its hit area');
  const u = h.unit('t_edge');
  assert.equal(u.tileR, 4);
  h.run(6);
  assert.ok(hitsOn(h, boss, u) > 0, 'hits the boss');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 自缚 + 无法被阻挡 — every 巨型单位 page lists "{{异常效果|自缚}} … 不可阻挡 / 无法被阻挡" (PRTS 假想敌：胄 / 假想敌：管 /
// 盐风主教昆图斯 / 阿利斯泰尔，帝国余晖 / “萨米的意志”; 异常效果 自缚 = 无法移动, not recognised as 束缚). The hit area moves
// with the boss, so a boss that walked would drag its 5 × 3 body off the pipe block (reviewer: the co-op 昆图斯 walked its
// route (3,10) → (2,2) and leaked at ≈ 280 game s).

const HUGE_TEMPLATES = [
  ['act1autochess_h07_01_s', 'enemy_9013_acstmk'], ['act1autochess_h07_03_s', 'enemy_9021_acduml'],
  ['act1autochess_h07_04_s', 'enemy_1521_dslily'], ['act1autochess_h07_06_s', 'enemy_9032_aclionk'],
  ['act1autochess_h07_07_s', 'enemy_9033_acdeer'], ['act1autochess_h08_01_s', 'enemy_9013_acstmk_2'],
  ['act1autochess_h08_03_s', 'enemy_9021_acduml_2'],
];
const realBoss = (waveTemplate, units = [], timeLimit = 60, two = false) => makeBattle({
  kind: 'boss', stageId: 'act2autochess_m01', waveTemplate, content: 'full', autoFinish: false, timeLimit, hooks: ['enemyLeak'],
  players: [
    { playerId: 'p1', seat: 0, side: 'L', coords: 'field', units, bonds: {} },
    ...(two ? [{ playerId: 'p2', seat: 1, side: 'R', coords: 'field', units: [], bonds: {} }] : []),
  ],
});

test('#10: every huge boss is 自缚 and unblockable (PRTS 天赋) — in its real template, from its spawn', async () => {
  const { SELF_BOUND } = await import('../../server/sim/content/bosses.js');
  assert.deepEqual([...SELF_BOUND].sort(), Object.keys(E).filter((k) => E[k].hitArea).sort(), 'the 巨型单位 are exactly the 自缚 leaders');
  for (const [tpl, key] of HUGE_TEMPLATES) {
    const h = realBoss(tpl);
    h.run(2); // 管 spawns at 1 s
    const e = h.b.enemies.find((x) => x.defId === key);
    assert.ok(e, `${tpl}: ${key} spawned`);
    assert.ok(e.s.flags.noMove && e.s.flags.unblockable, `${key}: 自缚 + 无法被阻挡`);
    assert.ok(!e.s.flags.bind, `${key}: 自缚 is not recognised as 束缚`);
  }
});

test('#10: the co-op 盐风主教昆图斯 stays on its pipe block (its route would walk it to (2,2)) and never leaks', () => {
  const h = realBoss('act1autochess_h07_04', [], 900, true);
  h.run(1);
  const bosses = h.b.enemies.filter((e) => e.defId === 'enemy_1521_dslily');
  const at = bosses.map((e) => [e.x, e.y]);
  h.run(400);
  const q = h.b.enemies.filter((e) => e.defId === 'enemy_1521_dslily');
  assert.ok(q.length >= 1 && q.every((e) => e.alive), 'still on the field');
  for (const [i, e] of bosses.entries()) assert.deepEqual([e.x, e.y], at[i], `copy ${i} did not move`);
  assert.equal(h.hooksOf('enemyLeak').filter((c) => c.enemy && c.enemy.defId === 'enemy_1521_dslily').length, 0, 'no leak');
  checkInvariants(h.b);
});

test('#10: an operator standing on the boss (a free-capacity blocker in contact) does not block it', () => {
  const op = chessRec({ id: 't_wall', stats: { atk: 10, blockCnt: 3, maxHp: 1e9, def: 5000 }, rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({
    kind: 'boss', stageId: 'act2autochess_m01', content: 'full', autoFinish: false, timeLimit: 60, defs: { chess: { t_wall: op } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', units: [{ uid: 1, kind: 'chess', chessId: 't_wall', row: 4, col: 8, dir: 'RIGHT' }], bonds: {} }],
  });
  h.step();
  const u = h.unit('t_wall');
  const boss = h.spawn('enemy_1521_dslily', { pos: [u.tileR, u.tileC], routeIndex: 0, tag: 'boss' });
  h.run(3);
  assert.equal(boss.blockedBy, null);
  assert.equal(u.blocking.length, 0);
  assert.deepEqual([boss.y, boss.x], [u.tileR, u.tileC], 'and it does not walk away either');
});

test('docs: SIM.md / DATA.md describe the hit areas and the block radius (user playtest #5)', () => {
  const SIM = fs.readFileSync(new URL('../../docs/SIM.md', import.meta.url), 'utf8');
  const DATA_MD = fs.readFileSync(new URL('../../docs/DATA.md', import.meta.url), 'utf8');
  assert.match(SIM, /body\.js/);
  assert.match(SIM, /受击判定区域为长4\.95、宽2\.95的长方形，向上偏移1\.0/);
  assert.match(SIM, /BLOCK_RADIUS`: ground 0\.7071/);
  assert.match(SIM, /Battle\.blockedTargets/);
  assert.match(SIM, /自缚 \+ 无法被阻挡[\s\S]{0,80}SELF_BOUND/);
  assert.match(DATA_MD, /\| `hitArea` \|/);
});
