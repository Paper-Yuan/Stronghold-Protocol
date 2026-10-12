import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
const targets = [['local merged', fileURLToPath(new URL('../../public/', import.meta.url))]];
const fake = installFakePixi();
after(() => { fake.restore(); });

const entry = { skel: '/fixture/unit.skel', atlas: '/fixture/unit.atlas', textures: ['/fixture/unit.png'], anims: { idle: 'Idle' }, animations: { Idle: 1 } };
const skeleton = { animations: [{ name: 'Idle' }] };
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(root, side, impostor) {
  const { UnitView } = await import(pathToFileURL(path.join(root, 'js/render/units.js')).href);
  const { presetCamera } = await import(pathToFileURL(path.join(root, 'js/render/projection.js')).href);
  let refs = 0, acquired = 0, frame = 0, draws = 0;
  const atlas = {
    alloc(w, h, options) {
      assert.ok(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0, 'impostor allocation has positive finite dimensions');
      return { w, h, tex: new fake.P.Texture(), clip: !!options?.clip };
    },
    free() {},
    park(obj) { obj.visible = false; },
    unpark(obj) { obj.visible = true; },
    draw(slot, obj, matrix) {
      for (const field of ['a', 'd', 'tx', 'ty']) assert.ok(Number.isFinite(matrix[field]), `impostor ${field} is finite`);
      assert.ok(slot && obj, 'a loaded model is drawn into a valid slot');
      draws++;
    },
  };
  const ctx = fakeViewCtx(fake.P, {
    frameNo: () => frame,
    impostorInterval: () => impostor ? 2 : 0,
    ...(impostor ? { impostors: atlas, renderer: { resolution: 1, render() {} } } : {}),
    assets: {
      picture: () => null,
      image: async () => null,
      spineEntry: () => entry,
      spine: { acquire: async () => { acquired++; refs++; return skeleton; }, release() { refs--; } },
    },
  });
  const view = new UnitView(ctx, { id: `${side}-${impostor}`, side, kind: side === 'ally' ? 'chess' : 'enemy', defId: side === 'ally' ? 'char_fixture' : 'enemy_fixture', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
  await settle(); await settle();
  const cam = presetCamera('normal', { width: 1280, height: 720 });
  const step = () => { view.update(1 / 60, cam, frame / 60); frame++; };
  return { view, step, counts: () => ({ acquired, refs, draws }) };
}

for (const [name, root] of targets) {
  for (const side of ['ally', 'enemy']) {
    for (const impostor of [false, true]) {
      test(`${name}: ${side} ${impostor ? 'impostor' : 'direct'} loaded body has finite transforms`, async () => {
        const { view, step, counts } = await fixture(root, side, impostor);
        try {
          assert.equal(counts().acquired, 1, 'one successful model acquisition');
          assert.equal(view.spineReady, true, 'Spine was actually constructed');
          assert.ok(view.actor?.spine, 'loaded model remains attached to the unit');
          assert.ok(Number.isFinite(view.modelKY) && view.modelKY > 0, 'vertical model scale is initialized');
          // Finish cross-fade; otherwise the fallback diamond can conceal a broken body.
          for (let i = 0; i < 30; i++) step();
          assert.equal(view.culled, false, 'the unit is inside the viewport');
          assert.equal(view.fallback.visible, false, 'the loaded body has replaced the fallback');
          assert.ok(Number.isFinite(view.root.position.x) && Number.isFinite(view.root.position.y), 'body position is finite');
          if (impostor) {
            assert.ok(view.imp?.sprite?.texture, 'impostor sprite has a render slot');
            assert.ok(counts().draws > 0, 'impostor body was rendered');
            assert.ok(Number.isFinite(view.imp.sprite.scale.x) && Number.isFinite(view.imp.sprite.scale.y), 'impostor sprite scale is finite');
            assert.ok(view.imp.sprite.alpha > 0, 'impostor body is visible after cross-fade');
          } else {
            assert.ok(view.imp == null, 'direct path draws the actual Spine model');
            assert.ok(Number.isFinite(view.actor.spine.scale.x) && Math.abs(view.actor.spine.scale.x) > 0, 'horizontal scale is finite and nonzero');
            assert.ok(Number.isFinite(view.actor.spine.scale.y) && view.actor.spine.scale.y > 0, 'vertical scale is finite and positive');
            assert.ok(view.actor.spine.alpha > 0, 'direct body is visible after cross-fade');
          }
        } finally {
          view.destroy();
        }
        assert.equal(counts().refs, 0, 'destroy releases the acquired model');
      });
    }
  }
}
