// test/render/fxwall.test.js — 余 S3 fire wall visual (render/fx.js): the sim's `firewall` fx carries `axis` ('col' for
// a RIGHT / LEFT facing, 'row' for UP / DOWN — sim/content/kits/ops/chess_char_6_03-yu.js); the renderer lights that straight line of
// tiles through his tile, clipped to the battle rect (it used to be a round zone whatever the facing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem, FX_KINDS, wallTiles } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

const RECT = { r0: 9, r1: 12, c0: 0, c1: 10 };

test('wallTiles: his column (axis col) or his row (axis row), clipped to the field rect', () => {
  assert.deepEqual(wallTiles(4, 10, 'col', RECT), [[9, 4], [10, 4], [11, 4], [12, 4]]);
  assert.deepEqual(wallTiles(4.2, 10.4, 'row', RECT), [...Array(11)].map((_, c) => [10, c]));
  assert.deepEqual(wallTiles(20, 3, 'row', { r0: 0, r1: 5, c0: 10, c1: 20 }).map(([, c]) => c), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  // no rect: ±4 tiles, never off the stage
  assert.deepEqual(wallTiles(1, 10, 'row', null), [[10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5]]);
  assert.deepEqual(wallTiles('x', 10, 'col', RECT), []);
});

test('the firewall fx flashes the wall tiles along the event axis', () => {
  assert.equal(FX_KINDS.firewall.a, 'wall');
  const cam = presetCamera('normal', { width: 1280, height: 720 });
  const flashes = [];
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    ctx: { cam: () => cam, heightAt: () => 0, fieldRect: () => RECT, timeScale: () => 2 },
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
    tileFlash: (tiles) => flashes.push(tiles),
    zone() {},
  });
  fx.simFx('firewall', 4, 10, { id: 7, dir: 'UP', axis: 'row' });
  fx.simFx('firewall', 4, 10, { id: 7, dir: 'RIGHT', axis: 'col' });
  fx.simFx('firewall', 4, 10, { id: 7 }); // legacy event without an axis: his column
  assert.deepEqual(flashes[0], wallTiles(4, 10, 'row', RECT));
  assert.deepEqual(flashes[1], [[9, 4], [10, 4], [11, 4], [12, 4]]);
  assert.deepEqual(flashes[2], flashes[1]);
});
