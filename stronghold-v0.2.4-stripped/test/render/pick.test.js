// test/render/pick.test.js — render/pick.js, the one picking rule of every "which unit is under the pointer" path (user
// playtest #4 item 1: "地上都画好了一个一个方格，点击对应方格就选中那个方格的人物就行" — a press on a tile selects the unit on
// that tile). Checked on the geometry of the official cameras (render/projection.js presetCamera + pickTile: prep and
// battle at 1920×1080 and 1280×720, raised tops first): units in adjacent rows and columns, on raised high ground, on
// the bench (row 7) and the temporary bench (row 8); and the battle rule for walking / flying enemies (ground position,
// drawn body).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presetCamera, pickTile } from '../../public/js/render/projection.js';
import { pickOnTile, pickBattle, ENEMY_REACH, AREA_PICK, hitRectAt } from '../../public/js/render/pick.js';
import { hitRect } from '../../server/sim/body.js';
import { unitDepthKey } from '../../public/js/render/units.js';
import { TILE_H } from '../../public/js/render/style.js';
import { GEO } from '../../shared/constants.js';

const CAMS = [['prep', 1920, 1080], ['prep', 1280, 720], ['normal', 1920, 1080], ['normal', 1280, 720]];

/** A board on camera `kind`: tile heights (`raised` = [[r, c, z]…]), units standing on tiles, the ground under a point. */
function board(kind, W, H, raised = []) {
  const cam = presetCamera(kind, { width: W, height: H });
  const hz = new Map(raised.map(([r, c, z]) => [`${r},${c}`, z]));
  const heightAt = (r, c) => hz.get(`${r},${c}`) || 0;
  const levels = [...new Set([0, ...raised.map((x) => x[2])])];
  const ground = (x, y) => { const t = pickTile(cam, x, y, heightAt, levels); return t && { row: t.row, col: t.col, x: t.x, y: t.y }; };
  const unit = (key, row, col) => ({ key, tile: { row, col }, x: col, y: row, depth: unitDepthKey(cam, col, row) });
  /** Screen point of a spot on the top face of tile (row, col): (u, v) ∈ [−0.5, 0.5] across / along the tile. */
  const spot = (row, col, u = 0, v = 0) => cam.project(col + u, row + v, heightAt(row, col));
  return { cam, heightAt, ground, unit, spot };
}

/** Spots inside a tile's top face: the centre and near its four edges and corners (0.4 of a tile out). */
const SPOTS = [[0, 0], [-0.4, 0], [0.4, 0], [0, -0.4], [0, 0.4], [-0.4, -0.4], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4]];

describe('pickOnTile: a press on a tile selects the unit on that tile (official cameras)', () => {
  for (const [kind, W, H] of CAMS) {
    test(`${kind} ${W}×${H}: a 3×3 block of units, the back row on high ground — every spot of a tile is its unit's`, () => {
      // rows 9–11 × cols 3–5; row 11 raised like the ranged high ground (TILE_H.wall)
      const B = board(kind, W, H, [[11, 3, TILE_H.wall], [11, 4, TILE_H.wall], [11, 5, TILE_H.wall]]);
      const units = [];
      for (let r = 9; r <= 11; r++) for (let c = 3; c <= 5; c++) units.push(B.unit(`${r},${c}`, r, c));
      for (const u of units) {
        for (const [du, dv] of SPOTS) {
          const p = B.spot(u.tile.row, u.tile.col, du, dv);
          assert.equal(pickOnTile(units, B.ground(p.x, p.y))?.key, u.key, `tile ${u.key} at (${du}, ${dv})`);
        }
      }
    });

    test(`${kind} ${W}×${H}: a press on a unit's head (drawn over the tile behind) is a press on that tile`, () => {
      const B = board(kind, W, H);
      const front = B.unit('front', 9, 4), behind = B.unit('behind', 10, 4);
      const p = B.spot(9, 4);
      const head = { x: p.x, y: p.y - 1.0 * p.s }; // a chibi is ~1.27 tiles tall, rows only ~0.85 tile apart on screen
      assert.deepEqual([B.ground(head.x, head.y).row, B.ground(head.x, head.y).col], [10, 4], 'premise: the head is over row 10');
      assert.equal(pickOnTile([front, behind], B.ground(head.x, head.y)).key, 'behind');
      assert.equal(pickOnTile([front], B.ground(head.x, head.y)), null, 'an empty tile selects nothing');
      const feet = B.spot(10, 4);
      assert.equal(pickOnTile([front, behind], B.ground(feet.x, feet.y)).key, 'behind', 'its own tile, where the front one\'s head is drawn');
    });
  }

  test('the bench (row 7) and the temporary bench (row 8): raised pads, one piece per slot', () => {
    const pads = [];
    for (let c = 0; c < GEO.HAND_SIZE; c++) pads.push([GEO.HAND_ROW, c, TILE_H.bench]);
    for (let i = 0; i < GEO.TEMP_SIZE; i++) pads.push([GEO.TEMP_ROW, GEO.TEMP_C0 + i, TILE_H.bench]);
    for (const [W, H] of [[1920, 1080], [1280, 720], [844, 390]]) {
      const B = board('prep', W, H, pads);
      const units = pads.map(([r, c]) => B.unit(`${r},${c}`, r, c));
      // a board unit right in front of the temp row and behind nothing
      units.push(B.unit('9,5', 9, 5));
      for (const u of units) {
        for (const [du, dv] of SPOTS) {
          const p = B.spot(u.tile.row, u.tile.col, du * 0.9, dv * 0.9);
          assert.equal(pickOnTile(units, B.ground(p.x, p.y))?.key, u.key, `${W}×${H} slot ${u.key} at (${du}, ${dv})`);
        }
      }
    }
  });

  test('several on one tile (pen clusters, a held piece): the nearest to the pointer\'s point, ties the front-most', () => {
    const t = { row: 15, col: 9 };
    const a = { key: 'a', tile: t, x: 8.8, y: 15.15, depth: 1 }, b = { key: 'b', tile: t, x: 9.2, y: 15.15, depth: 1 }, c = { key: 'c', tile: t, x: 9, y: 14.8, depth: 2 };
    assert.equal(pickOnTile([a, b, c], { ...t, x: 8.75, y: 15.2 }).key, 'a');
    assert.equal(pickOnTile([a, b, c], { ...t, x: 9.3, y: 15.1 }).key, 'b');
    assert.equal(pickOnTile([a, b, c], { ...t, x: 9, y: 14.7 }).key, 'c');
    const d = { key: 'd', tile: t, x: 9, y: 15, depth: 5 }, e = { key: 'e', tile: t, x: 9, y: 15, depth: 3 };
    assert.equal(pickOnTile([e, d], { ...t, x: 9.1, y: 15 }).key, 'd', 'same spot: the front-most');
    assert.equal(pickOnTile([e, d], t).key, 'd', 'no point on the tile: the front-most');
  });

  test('bad input: nothing', () => {
    const u = { tile: { row: 1, col: 1 }, x: 1, y: 1 };
    assert.equal(pickOnTile([u], null), null);
    assert.equal(pickOnTile([u], { row: 1.5, col: 1 }), null);
    assert.equal(pickOnTile(null, { row: 1, col: 1 }), null);
    assert.equal(pickOnTile([null, { x: 1, y: 1 }, { tile: null, x: 1, y: 1 }], { row: 1, col: 1 }), null);
    assert.equal(pickOnTile([u], { row: 1, col: 2 }), null);
  });
});

describe('pickBattle: allies by their tile, walking enemies by their ground position or drawn body, flying ones by their body', () => {
  const ally = (key, row, col, depth = 0) => ({ key, tile: { row, col }, x: col, y: row, depth });
  const foe = (key, x, y, depth = 0) => ({ key, tile: null, x, y, depth });
  const at = (x, y) => ({ row: Math.round(y), col: Math.round(x), x, y });

  test('an ally on the tile under the pointer; an empty tile with no enemy near: nothing', () => {
    const A = ally('A', 10, 4);
    assert.equal(pickBattle([A], at(4.3, 10.4), 0, 0).key, 'A');
    assert.equal(pickBattle([A], at(4.3, 10.6), 0, 0), null, 'the tile behind');
    assert.equal(pickBattle([A], null, 0, 0), null, 'off the grid');
  });

  test(`an enemy within ${ENEMY_REACH} tile of the pointer's ground point, the nearest of several`, () => {
    const e1 = foe('e1', 6.3, 12.1), e2 = foe('e2', 6.9, 12.0);
    assert.equal(pickBattle([e1, e2], at(6.4, 12.2), 0, 0).key, 'e1');
    assert.equal(pickBattle([e1, e2], at(6.8, 11.9), 0, 0).key, 'e2');
    assert.equal(pickBattle([e1], at(6.3 + ENEMY_REACH - 0.01, 12.1), 0, 0).key, 'e1');
    assert.equal(pickBattle([e1], at(6.3 + ENEMY_REACH + 0.01, 12.1), 0, 0), null, 'too far');
  });

  test('an ally\'s tile and an enemy both there (a blocked enemy at the edge of the blocker\'s tile): the nearer, ties the ally', () => {
    const A = ally('A', 10, 5), e = foe('e', 5.45, 10);
    assert.equal(pickBattle([A, e], at(5.05, 10.05), 0, 0).key, 'A', 'the tile centre: the operator');
    assert.equal(pickBattle([A, e], at(5.42, 10.02), 0, 0).key, 'e', 'on the enemy');
    assert.equal(pickBattle([e, A], at(5.225, 10), 0, 0).key, 'A', 'halfway: the ally');
    assert.equal(pickBattle([A, e], at(5.8, 10), 0, 0).key, 'e', 'the next tile: only the enemy is near');
  });

  test('a flying enemy: its drawn body (feet to head) within the reach × its px per tile, on screen', () => {
    const f = { key: 'f', tile: null, x: 7, y: 11, fly: true, body: { x: 500, top: 260, feet: 340, s: 80 } };
    const A = ally('A', 11, 7);
    assert.equal(pickBattle([f], null, 510, 330).key, 'f', 'off any tile under it');
    assert.equal(pickBattle([f], null, 505, 265).key, 'f', 'its head');
    assert.equal(pickBattle([f], at(7, 11), 500 + ENEMY_REACH * 80 + 2, 300), null, 'the ground position does not count');
    assert.equal(pickBattle([f], null, 500, 340 + ENEMY_REACH * 80 + 2), null, 'below its feet, beyond the reach');
    assert.equal(pickBattle([f, A], at(7.4, 11.3), 505, 305).key, 'f', 'on the flyer, over an ally\'s tile');
    assert.equal(pickBattle([f, A], at(7.02, 11), 500, 340 + 0.2 * 80).key, 'A', 'the ally\'s tile centre, the flyer 0.2 tile away: the ally is nearer');
  });

  test('a walking enemy: its drawn body counts too — a press on a tall enemy\'s / a boss\'s torso or head picks it', () => {
    // a boss 2.4 tiles tall standing at (8, 12): its torso is drawn ~1.2 tiles above its feet, over the ground ~1 tile
    // behind it — beyond the ground reach, on its body
    const boss = { key: 'boss', tile: null, x: 8, y: 12, body: { x: 600, top: 600 - 2.4 * 90, feet: 600, s: 90 } };
    assert.equal(pickBattle([boss], at(8.05, 13.1), 605, 600 - 1.2 * 90).key, 'boss', 'its torso');
    assert.equal(pickBattle([boss], at(8, 13.8), 598, 600 - 2.3 * 90).key, 'boss', 'its head');
    assert.equal(pickBattle([boss], at(8.3, 12.2), 700, 610).key, 'boss', 'at its feet (the ground rule)');
    assert.equal(pickBattle([boss], at(8, 14.5), 600 + 0.7 * 90, 600 - 1.2 * 90), null, 'beside its body, beyond the reach');
    // an ally on the tile its head is drawn over: the ally's tile centre stays the ally's, the head the enemy's
    const e = { key: 'e', tile: null, x: 5, y: 10, body: { x: 400, top: 400 - 1.2 * 80, feet: 400, s: 80 } };
    const A = ally('A', 11, 5);
    assert.equal(pickBattle([A, e], at(5, 11), 400 + 0.3 * 80, 400 - 1.1 * 80).key, 'A', 'the ally\'s tile centre, 0.3 tile beside the head');
    assert.equal(pickBattle([A, e], at(5, 10.6), 400, 400 - 1.0 * 80).key, 'e', 'on the enemy\'s head (over the near edge of that tile)');
  });

  test('a huge boss (user playtest #5 item 10): a press anywhere on its hit area picks it; allies on their tile and nearer enemies win', () => {
    // 假想敌：胄 at (3,10): 4.95 × 2.95 up 1 → rows 3–5 × cols 8–12 (the sim's rectangle, server/sim/body.js)
    const HA = { w: 4.95, h: 2.95, dx: 0, dy: 1 };
    const area = hitRectAt(10, 3, HA);
    assert.deepEqual(area, hitRect({ x: 10, y: 3, hitArea: HA }), 'the same rectangle as the sim');
    assert.equal(hitRectAt(10, 3, null), null);
    const boss = { key: 'boss', tile: null, x: 10, y: 3, area, body: { x: 600, top: 600 - 3 * 90, feet: 600, s: 90 } };
    const far = [2000, 2000]; // pointer far from its drawn body line on screen: only the ground area counts
    for (const [x, y] of [[8, 3], [12.4, 5.4], [7.6, 4], [10, 5]]) assert.equal(pickBattle([boss], at(x, y), ...far)?.key, 'boss', `(${x},${y}) on the area`);
    for (const [x, y] of [[7.4, 4], [10, 5.6], [9, 2.3], [12.6, 3]]) assert.equal(pickBattle([boss], at(x, y), ...far), null, `(${x},${y}) off the area`);
    const A = ally('A', 4, 8), e = foe('e', 11, 4.2);
    assert.equal(pickBattle([boss, A], at(8.3, 4.3), ...far).key, 'A', 'an ally on the fence tile inside the area');
    assert.equal(pickBattle([boss, A], at(9.2, 4.3), ...far).key, 'boss', 'the next tile: the boss');
    assert.equal(pickBattle([boss, e], at(11.2, 4.1), ...far).key, 'e', 'a regular enemy near the pointer');
    assert.ok(AREA_PICK > Math.SQRT1_2 && AREA_PICK > ENEMY_REACH);
    // a flying unit never uses a ground area
    assert.equal(pickBattle([{ ...boss, fly: true }], at(9, 4), ...far), null);
    // the drawn body: an upright box from its feet to its head, hw tiles either side (its px per tile) — off the grid
    // too
    const big = { ...boss, body: { ...boss.body, hw: 2.475 } };
    assert.equal(pickBattle([big], null, 600 + 2.2 * 90, 600 - 2.8 * 90)?.key, 'boss', 'its shoulder, far from the centre line');
    assert.equal(pickBattle([boss], null, 600 + 2.2 * 90, 600 - 2.8 * 90), null, 'without hw: the centre line only');
    assert.equal(pickBattle([big], null, 600 + 2.6 * 90, 600 - 1 * 90), null, 'beside the box');
    assert.equal(pickBattle([big], null, 600 + 1.5 * 90, 600 - 3.8 * 90), null, 'above its head (beyond the line reach too)');
    assert.equal(pickBattle([big, A], at(8.1, 4.1), 600 - 2 * 90, 600 - 1 * 90).key, 'A', 'the ally on its tile inside the box');
  });

  test('bad input: nothing', () => {
    assert.equal(pickBattle(null, at(1, 1), 0, 0), null);
    assert.equal(pickBattle([null, foe('x', NaN, 1), { key: 'y', tile: null, x: 1, y: 1, fly: true, body: { x: 1, top: 0, feet: 1, s: 0 } }], at(1, 1), 1, 1), null);
  });
});
