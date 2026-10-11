// 4-direction facing in the engine (DESIGN §3 "Facing (corrected)", research 09 §1.2 / §6.1): server/sim/dir.js math,
// rotated range grids (+ rangeExtend before rotating), unit dir from the battle input, the Final Assault right-side
// mirror (RIGHT ↔ LEFT, UP / DOWN kept), UnitInfo.dir, and every engine-level front / side helper (professions,
// skill trigger grids, token placement grids, support geometry, kit helpers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRS, DIR_VEC, normDir, rotateOffset, toLocal, hSign, mirrorDir, oppositeDir, perpendicular, dirFromDelta, frontOf, offsetTile,
} from '../../server/sim/dir.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { findSummonTile } from '../../server/sim/content/tokens.js';
import { frontTile, sideTiles, alliesAround, N4 } from '../../server/sim/content/support/index.js';
import { freeTileAround } from '../../server/sim/content/kits/shared/tier1.js';
import { DIRS as PROTOCOL_DIRS } from '../../shared/protocol.js';

const K = (r, c) => r * COLS + c;
const tilesOf = (keys) => keys.map((k) => [Math.floor(k / COLS), k % COLS]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const sorted = (list) => list.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const dummy = (key = 'e_d', o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, ...o });

test('dir.js: the DATA.md rotation RIGHT (dr,dc) · UP (dc,−dr) · LEFT (−dr,−dc) · DOWN (−dc,dr), inverse and helpers', () => {
  assert.deepEqual([...DIRS], ['UP', 'RIGHT', 'DOWN', 'LEFT']);
  assert.deepEqual([...PROTOCOL_DIRS], [...DIRS], 'shared/protocol.js lists the same directions');
  assert.deepEqual(rotateOffset(2, 3, 'RIGHT'), [2, 3]);
  assert.deepEqual(rotateOffset(2, 3, 'UP'), [3, -2]);
  assert.deepEqual(rotateOffset(2, 3, 'LEFT'), [-2, -3]);
  assert.deepEqual(rotateOffset(2, 3, 'DOWN'), [-3, 2]);
  // the forward cell [0, 1] becomes the direction vector (row 0 = bottom: UP = +row)
  for (const d of DIRS) assert.deepEqual(rotateOffset(0, 1, d), [...DIR_VEC[d]], d);
  for (const d of DIRS) for (const [dr, dc] of [[0, 0], [1, 2], [-3, 1], [2, -2]]) {
    const [ar, ac] = rotateOffset(dr, dc, d);
    assert.deepEqual(toLocal(ar, ac, d), [dr, dc], `toLocal inverts rotateOffset (${d})`);
  }
  assert.equal(normDir('up'), 'UP');
  assert.equal(normDir(-1), 'LEFT');
  assert.equal(normDir(1), 'RIGHT');
  assert.equal(normDir('NORTH'), 'RIGHT');
  assert.equal(normDir(undefined, 'DOWN'), 'DOWN');
  assert.deepEqual(DIRS.map(hSign), [1, 1, 1, -1], 'horizontal sign only for sprite flipping');
  assert.deepEqual(DIRS.map(mirrorDir), ['UP', 'LEFT', 'DOWN', 'RIGHT'], 'FA mirror: RIGHT ↔ LEFT, UP / DOWN kept');
  assert.deepEqual(DIRS.map(oppositeDir), ['DOWN', 'LEFT', 'UP', 'RIGHT']);
  assert.ok(perpendicular('UP', 'LEFT') && !perpendicular('UP', 'DOWN'));
  assert.equal(dirFromDelta(1, 0), 'UP');
  assert.equal(dirFromDelta(0, -2), 'LEFT');
  assert.equal(dirFromDelta(-1, 0), 'DOWN');
  assert.equal(dirFromDelta(0, 0, 'LEFT'), 'LEFT');
  assert.deepEqual(frontOf(10, 5, 'DOWN', 2), [8, 5]);
  assert.deepEqual(frontOf(10, 5, 'UP', -1), [9, 5], 'k < 0: behind');
  assert.deepEqual(offsetTile(10, 5, 1, 0, 'UP'), [10, 4], 'the left hand of an UP unit is the left column');
});

test('absoluteRangeKeys rotates the facing-RIGHT grid; rangeExtend goes along +dCol before rotating', () => {
  const grid = [[0, 1], [1, 2]];
  assert.deepEqual(tilesOf(absoluteRangeKeys(grid, 10, 5, 'RIGHT')), sorted([[10, 6], [11, 7]]));
  assert.deepEqual(tilesOf(absoluteRangeKeys(grid, 10, 5, 'UP')), sorted([[11, 5], [12, 4]]));
  assert.deepEqual(tilesOf(absoluteRangeKeys(grid, 10, 5, 'LEFT')), sorted([[10, 4], [9, 3]]));
  assert.deepEqual(tilesOf(absoluteRangeKeys(grid, 10, 5, 'DOWN')), sorted([[9, 5], [8, 6]]));
  // legacy facing signs still work (−1 = LEFT)
  assert.deepEqual(absoluteRangeKeys(grid, 10, 5, -1), absoluteRangeKeys(grid, 10, 5, 'LEFT'));
  // +1 forward tile per row, then rotated: a 2-tile line facing UP / DOWN becomes 3 tiles along the column
  const line = [[0, 0], [0, 1]];
  assert.deepEqual(tilesOf(absoluteRangeKeys(line, 10, 5, 'UP', 1)), [[10, 5], [11, 5], [12, 5]]);
  assert.deepEqual(tilesOf(absoluteRangeKeys(line, 10, 5, 'DOWN', 1)), [[8, 5], [9, 5], [10, 5]]);
  assert.deepEqual(tilesOf(absoluteRangeKeys(line, 10, 5, 'LEFT', 2)), [[10, 2], [10, 3], [10, 4], [10, 5]]);
});

test('units take `dir` from the battle input (default RIGHT): rotated rangeKeys, derived facing sign, UnitInfo.dir', () => {
  const rec = chessRec({ id: 't_sn', profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1], [0, 2]], skill: null });
  const h = makeBattle({
    defs: { chess: { t_sn: rec, t_sn2: { ...rec, chessId: 't_sn2', baseId: 't_sn2' }, t_sn3: { ...rec, chessId: 't_sn3', baseId: 't_sn3' }, t_sn4: { ...rec, chessId: 't_sn4', baseId: 't_sn4' } } },
    units: [
      { chessId: 't_sn', row: 10, col: 3, dir: 'UP' }, { chessId: 't_sn2', row: 10, col: 6, dir: 'LEFT' },
      { chessId: 't_sn3', row: 12, col: 8, dir: 'DOWN' }, { chessId: 't_sn4', row: 9, col: 8 },
    ],
  });
  h.step();
  const [up, left, down, def] = ['t_sn', 't_sn2', 't_sn3', 't_sn4'].map((id) => h.unit(id));
  assert.deepEqual([up.dir, left.dir, down.dir, def.dir], ['UP', 'LEFT', 'DOWN', 'RIGHT']);
  assert.deepEqual([up.facing, left.facing, down.facing, def.facing], [1, -1, 1, 1], 'facing = horizontal sign only');
  assert.deepEqual(up.fwd, [1, 0]);
  assert.deepEqual(tilesOf(up.rangeKeys), [[10, 3], [11, 3], [12, 3]]);
  assert.deepEqual(tilesOf(left.rangeKeys), [[10, 4], [10, 5], [10, 6]]);
  assert.deepEqual(tilesOf(down.rangeKeys), [[10, 8], [11, 8], [12, 8]]);
  assert.deepEqual(tilesOf(down.baseRangeKeys), [[10, 8], [11, 8], [12, 8]], 'the initial (trigger) range is rotated too');
  const info = h.b.fieldMeta().units.find((u) => u.defId === 't_sn');
  assert.equal(info.dir, 'UP');
  assert.equal(h.b.fieldMeta().units.find((u) => u.defId === 't_sn2').facing, -1);
  checkInvariants(h.b);
});

test('a unit only hits enemies inside its rotated range (DOWN-facing sniper shoots the row below)', () => {
  const rec = chessRec({ id: 't_sn', profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1]], skill: null, stats: { atk: 100 } });
  const run = (dir) => {
    const h = makeBattle({ defs: { chess: { t_sn: rec }, enemies: { e_d: dummy() } }, units: [{ chessId: 't_sn', row: 11, col: 4, dir }], enemies: [{ key: 'e_d', pos: [10, 4] }], autoFinish: false, timeLimit: 10 });
    h.run(3);
    return h.hooksOf('attack').length;
  };
  assert.ok(run('DOWN') > 0, 'facing DOWN: the enemy below is in range');
  assert.equal(run('RIGHT'), 0, 'facing RIGHT: out of range');
  assert.equal(run('UP'), 0, 'facing UP: out of range');
});

test('Final Assault right side: col c → 20 − c with RIGHT ↔ LEFT, UP / DOWN unchanged', () => {
  const rec = chessRec({ id: 't_a', profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1]], skill: null });
  const defs = { chess: { t_a: rec, t_b: { ...rec, chessId: 't_b', baseId: 't_b' }, t_c: { ...rec, chessId: 't_c', baseId: 't_c' } } };
  const units = [{ uid: 1, kind: 'chess', chessId: 't_a', row: 10, col: 4, dir: 'RIGHT' }, { uid: 2, kind: 'chess', chessId: 't_b', row: 11, col: 5, dir: 'UP' }, { uid: 3, kind: 'chess', chessId: 't_c', row: 12, col: 6, dir: 'LEFT' }];
  const h = makeBattle({ kind: 'boss', defs, players: [
    { playerId: 'L', seat: 0, side: 'L', colOffset: 0, units: units.map((u) => ({ ...u })) },
    { playerId: 'R', seat: 1, side: 'R', colOffset: 8, units: units.map((u) => ({ ...u, uid: u.uid + 10 })) },
  ] });
  h.step();
  const of = (pid, id) => h.b.allyUnits.find((u) => u.ownerId === pid && u.defId === id);
  assert.deepEqual([of('L', 't_a').tileR, of('L', 't_a').tileC, of('L', 't_a').dir], [3, 4, 'RIGHT']);
  assert.deepEqual([of('R', 't_a').tileR, of('R', 't_a').tileC, of('R', 't_a').dir], [3, 16, 'LEFT']);
  assert.deepEqual([of('R', 't_b').tileC, of('R', 't_b').dir], [15, 'UP'], 'UP stays UP');
  assert.deepEqual([of('R', 't_c').tileC, of('R', 't_c').dir], [14, 'RIGHT'], 'LEFT becomes RIGHT');
  assert.deepEqual(tilesOf(of('R', 't_a').rangeKeys), [[3, 15], [3, 16]], 'the mirrored range points at the centre');
  assert.equal(h.b.getPlayer('R').dir, 'LEFT', 'default direction of the mirrored side');
  assert.equal(h.b.mapDir(h.b.getPlayer('R'), 'DOWN'), 'DOWN');
  assert.equal(h.b.mapDir(h.b.getPlayer('R'), 'RIGHT', true), 'RIGHT', 'field coordinates are taken as they are');
  checkInvariants(h.b);
});

test('professions: 领主 (lord) full damage only on its own tile and the tile in FRONT along its direction', () => {
  const rec = chessRec({ id: 't_lord', profession: 'WARRIOR', subProfessionId: 'lord', rangeGrid: [[1, 0], [0, 0], [0, 1], [0, 2], [-1, 0]], skill: null });
  const h = makeBattle({ defs: { chess: { t_lord: rec } }, units: [{ chessId: 't_lord', row: 10, col: 4, dir: 'UP' }] });
  h.step();
  const u = h.unit('t_lord');
  const at = (r, c) => u.profile.dmgMul(h.b, u, { x: c, y: r, blockedBy: null });
  assert.equal(at(11, 4), 1, 'the tile in front (above) of an UP-facing lord');
  assert.equal(at(10, 4), 1, 'its own tile');
  assert.ok(at(10, 5) < 1, 'the tile to its right is not in front');
  assert.ok(at(12, 4) < 1, 'two tiles ahead: ranged');
});

test('professions: 行刑者 (reaperrange) front bonus follows the direction (own line, at or ahead)', () => {
  const rec = chessRec({ id: 't_rr', profession: 'SNIPER', subProfessionId: 'reaperrange', rangeGrid: [[0, 0], [0, 1], [0, 2]], skill: null });
  const h = makeBattle({ defs: { chess: { t_rr: rec } }, units: [{ chessId: 't_rr', row: 11, col: 4, dir: 'DOWN' }] });
  h.step();
  const u = h.unit('t_rr');
  u.profile = { ...u.profile, frontGrid: null };
  const at = (r, c) => u.profile.dmgMul(h.b, u, { x: c, y: r });
  assert.ok(at(10, 4) > 1, 'below a DOWN-facing unit: its front line');
  assert.equal(at(12, 4), 1, 'behind it: no bonus');
  assert.equal(at(11, 5), 1, 'beside it: no bonus');
});

test('skill CUSTOM_RANGE trigger grids are rotated with the unit', () => {
  const rec = chessRec({
    id: 't_trig', profession: 'SNIPER', rangeGrid: [[0, 0]],
    skill: { kind: 'instant', spCost: 1, initSp: 1, durationType: 'NONE', trigger: { rule: 'CUSTOM_RANGE', grid: [[0, 1], [0, 2]] } },
  });
  const run = (dir) => {
    const h = makeBattle({ defs: { chess: { t_trig: rec }, enemies: { e_d: dummy() } }, units: [{ chessId: 't_trig', row: 9, col: 4, dir }], enemies: [{ key: 'e_d', pos: [11, 4] }], autoFinish: false, timeLimit: 5 });
    h.run(2);
    return h.hooksOf('skillStart').length;
  };
  assert.ok(run('UP') > 0, 'UP: the enemy two tiles above triggers the skill');
  assert.equal(run('RIGHT'), 0, 'RIGHT: nothing in the trigger grid');
});

test('token placement grids (findSummonTile) and support geometry follow the owner direction', () => {
  const rec = chessRec({ id: 't_o', profession: 'SUPPORT', rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({ defs: { chess: { t_o: rec, t_n: { ...rec, chessId: 't_n', baseId: 't_n' }, t_s: { ...rec, chessId: 't_s', baseId: 't_s' } } },
    units: [{ chessId: 't_o', row: 10, col: 4, dir: 'UP' }, { chessId: 't_n', row: 11, col: 4 }, { chessId: 't_s', row: 10, col: 3 }] });
  h.step();
  const o = h.unit('t_o');
  assert.deepEqual(findSummonTile(h.b, o, 'near', { grid: [[0, 2]], at: { x: 4, y: 12 } }), [12, 4], 'grid offset [0,2] = two tiles above');
  assert.deepEqual(frontTile(o), [11, 4]);
  assert.deepEqual(frontTile(o, -1), [9, 4]);
  assert.deepEqual(sideTiles(o), [[10, 3], [10, 5]], 'left hand, right hand');
  assert.deepEqual(alliesAround(h.b, o, [[0, 1]]).map((a) => a.defId), ['t_n'], 'relative [0,1] = in front');
  assert.deepEqual(alliesAround(h.b, o, [[1, 0]]).map((a) => a.defId), ['t_s'], 'relative [1,0] = the left hand');
  assert.equal(alliesAround(h.b, o, N4).length, 2);
  // tier1 freeTileAround: front first
  assert.deepEqual(freeTileAround(h.b, o, (r, c) => !(r === 11 && c === 4 && h.b.unitAt(r, c))), [11, 3], 'front first (occupied by t_n)');
  assert.deepEqual(freeTileAround(h.b, o, (r, c) => !(r === 11 && c === 4)), [11, 3], 'then front-left (its left hand is the lower column)');
  checkInvariants(h.b);
});

test('spawnToken inherits the owner direction unless given; spawnDevice takes opts.dir', () => {
  const rec = chessRec({ id: 't_o', profession: 'SUPPORT', rangeGrid: [[0, 0], [0, 1]], skill: null });
  const tok = { id: 'tok_t', name: 'tok', position: 'ALL', stats: { maxHp: 100, atk: 0, def: 0, res: 0, aspd: 100, bat: 1, blockCnt: 0, cost: 0, respawnTime: 0 }, rangeGrid: [[0, 0], [0, 1]] };
  const h = makeBattle({ defs: { chess: { t_o: rec } }, units: [{ chessId: 't_o', row: 10, col: 4, dir: 'DOWN' }] });
  h.step();
  const o = h.unit('t_o');
  const a = h.b.spawnToken(o, 'tok_t', 11, 6, { def: tok });
  assert.equal(a.dir, 'DOWN');
  assert.deepEqual(tilesOf(a.rangeKeys), [[10, 6], [11, 6]]);
  const b = h.b.spawnToken(o, 'tok_t', 12, 6, { def: tok, dir: 'LEFT' });
  assert.equal(b.dir, 'LEFT');
  const c = h.b.spawnToken(o, 'tok_t', 12, 7, { def: tok, facing: -1 });
  assert.equal(c.dir, 'LEFT', 'legacy facing −1 ⇒ LEFT');
  const d = h.b.spawnDevice('dev_t', 9, 7, { dir: 'UP' });
  assert.equal(d.dir, 'UP');
  checkInvariants(h.b);
});

test('the legacy facing setter maps ±1 to RIGHT / LEFT (content that still assigns facing)', () => {
  const rec = chessRec({ id: 't_o', rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({ defs: { chess: { t_o: rec } }, units: [{ chessId: 't_o', row: 10, col: 4, dir: 'UP' }] });
  h.step();
  const u = h.unit('t_o');
  u.facing = -1;
  assert.equal(u.dir, 'LEFT');
  u.facing = 1;
  assert.equal(u.dir, 'RIGHT');
  assert.equal(K(10, 4), u.tileR * COLS + u.tileC);
});
