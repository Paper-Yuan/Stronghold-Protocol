// test/render/feedback1e-splash.test.js — 烛煌 S3 众恶的焚场 "攻击变为群体攻击" is one target + a 1.7 splash (PRTS 备注
// "攻击溅射半径1.7"; community report E1 after 0.1.0). The screen rings splash attacks by sub-profession (fx.js
// SPLASH_SUBS) and 本源术师 is not one, so the kit emits fx 'splash' {x, y, id: main target, src, r: 1.7, element: 'burn'}
// for every landed bolt (test/sim/feedback1e-skillrange.test.js): drawn as a burn-coloured blast of that radius at the
// main target. Against the headless fake PIXI (test/render/fakepixi.js), like fxflame.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

const cam = presetCamera('normal', { width: 1600, height: 900 });
const unit = (id, x, y) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, info: { defId: 'x' }, onHit() {} });

test('烛煌 S3 splash fx: a burn blast of radius 1.7 on the main target (anchored to it), at its spot when it is gone', () => {
  const blaze = unit(1, 3, 10), foe = unit(20, 7, 10);
  const map = new Map([[blaze.id, blaze], [foe.id, foe]]);
  const ctx = fakeViewCtx(fake.P);
  const fx = new FX.FxSystem({
    P: fake.P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 2, loadLevel: () => 0, subProfOf: () => 'primcaster', view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  const calls = [];
  const real = fx.explosion.bind(fx);
  fx.explosion = (x, y, z, r, col, o) => { calls.push({ x, y, r, col }); return real(x, y, z, r, col, o); };
  assert.equal(FX.fxSpec('splash', { element: 'burn' }).a, 'blast');
  fx.simFx('splash', foe.x, foe.y, { x: foe.x, y: foe.y, id: foe.id, src: blaze.id, r: 1.7, element: 'burn' });
  fx.simFx('splash', 9, 11, { x: 9, y: 11, src: blaze.id, r: 1.7, element: 'burn' }); // the target died meanwhile
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => [c.x, c.y, c.r]), [[7, 10, 1.7], [9, 11, 1.7]], 'on the target, then on its spot');
  for (const c of calls) assert.equal(c.col, 0xff7a33, 'burn colour');
  const n = fx.counts.particles;
  assert.ok(n > 0, 'fire and sparks');
  for (let t = 0; t < 2; t += 1 / 120) fx.update(1 / 120);
  assert.ok(fx.counts.particles < n, 'and they burn out');
});
