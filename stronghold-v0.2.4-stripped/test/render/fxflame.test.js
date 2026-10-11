// test/render/fxflame.test.js — 炎佑's 祛恶之焰 as a continuous jet of fire (render/fx.js _flame; user playtest #4 item 12
// "官方是一段持续时间的喷火"). The sim (server/sim/content/tokens.js yanyouKit) emits one fx 'yanyouFlame'
// {x, y, id: dragon, target, r, n, dur: 1} per game second of the channel; the renderer keeps ONE jet per dragon that each
// tick re-aims and extends, so the ticks join into a stream from the dragon onto its locked target with a burning disc
// of radius r around the target. It used to be the generic 'buff' sparkle once per second.
// Against the headless fake PIXI (test/render/fakepixi.js), like fxproj.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

const DT = 1 / 120;
const cam = presetCamera('normal', { width: 1600, height: 900 });
const unit = (id, x, y, o = {}) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, info: { defId: 'x' }, onHit() {}, ...o });

function makeFx(views, ts = 2) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  const map = new Map(views.map((v) => [v.id, v]));
  const fx = new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => ts, loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, map };
}
const run = (fx, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) fx.update(DT); };
/** One sim tick of the channel (the event tokens.js emits). */
const tick = (fx, dragon, target, r = 1) => fx.simFx('yanyouFlame', target.x, target.y, { x: target.x, y: target.y, id: dragon.id, target: target.id, r, n: 1, dur: 1 });

describe('炎佑 祛恶之焰: one continuous jet of fire (user playtest #4 item 12)', () => {
  test('its own archetype (no longer the one-off buff sparkle)', () => {
    assert.equal(FX.FX_KINDS.yanyouFlame.a, 'flame');
    assert.equal(FX.fxSpec('yanyouFlame').a, 'flame');
  });

  test('the 1 s ticks join into one stream that burns while they come and ends after the last one', () => {
    const dragon = unit(40, 6.2, 10.1, { hover: 0.32 }), foe = unit(20, 6, 10);
    const { fx } = makeFx([dragon, foe]);
    for (let s = 0; s < 6; s++) {        // 6 game s of channel at the 2× clock: a tick every 0.5 real s
      tick(fx, dragon, foe);
      assert.equal(fx.flames.length, 1, `tick ${s}: still one jet`);
      run(fx, 0.5);
      assert.equal(fx.flames.length, 1, `between ticks ${s} and ${s + 1} the jet keeps burning`);
      const F = fx.flames[0];
      assert.ok(F.disc.alpha > 0.2 && F.edge.alpha > 0.2, 'the burning disc shows');
    }
    assert.ok(fx.counts.particles > 20, 'fire streams from the dragon and rises from the disc');
    run(fx, 0.3);
    assert.equal(fx.flames.length, 0, 'no tick came: the jet goes out within FLAME_TAIL');
  });

  test('the disc follows the locked target; a new tick re-aims the same jet', () => {
    const dragon = unit(40, 3, 10, { hover: 0.32 }), a = unit(20, 3.2, 10), b = unit(21, 5, 11);
    const { fx } = makeFx([dragon, a, b]);
    tick(fx, dragon, a);
    run(fx, 0.1);
    const F = fx.flames[0];
    const at0 = { x: F.disc.position.x, y: F.disc.position.y };
    a.x = 4.2;                            // the target walks on: the disc goes with it
    run(fx, 0.1);
    assert.ok(F.disc.position.x > at0.x + 20, `disc follows the target (${at0.x} → ${F.disc.position.x})`);
    tick(fx, dragon, b);                  // the next tick aims at another enemy: the same jet, re-aimed
    run(fx, 0.1);
    assert.equal(fx.flames.length, 1);
    assert.equal(fx.flames[0], F);
    assert.equal(F.tgt, 21);
    assert.equal(F.r, 1);
  });

  test('the dragon gone (knocked out, left the field) puts its jet out at once; clear() drops every jet', () => {
    const dragon = unit(40, 3, 10), foe = unit(20, 3.2, 10);
    const { fx, map } = makeFx([dragon, foe]);
    tick(fx, dragon, foe);
    run(fx, 0.05);
    assert.equal(fx.flames.length, 1);
    map.delete(40);
    run(fx, 0.05);
    assert.equal(fx.flames.length, 0, 'no dragon, no fire');
    map.set(40, dragon);
    tick(fx, dragon, foe);
    const disc = fx.flames[0].disc;
    fx.clear();
    assert.equal(fx.flames.length, 0);
    assert.ok(disc.destroyed, 'its sprites are freed');
  });

  test('two dragons (9 炎) burn two jets; a target that died keeps the jet on its last spot until it fades', () => {
    const d1 = unit(40, 3, 10), d2 = unit(41, 3, 10.8), foe = unit(20, 3.2, 10);
    const { fx, map } = makeFx([d1, d2, foe]);
    tick(fx, d1, foe); tick(fx, d2, foe);
    assert.equal(fx.flames.length, 2);
    run(fx, 0.1);
    const x = fx.flames[0].x;
    map.delete(20);                        // killed
    run(fx, 0.1);
    assert.equal(fx.flames[0].x, x, 'stays where the target was');
    run(fx, 0.6);
    assert.equal(fx.flames.length, 0);
  });
});
