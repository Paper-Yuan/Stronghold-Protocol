// Player report F5 after the 0.1.0 release, client side: b.snap `down` entries carry the tile a knocked-out operator
// lies on ([id, respawnAt, respawnTime, state, row, col] — where it fell, or its own home when it fell on another board
// piece's home: PRTS 卫戍协议/帮助 "若干员被击倒的位置为其他干员或召唤物的初始位置，则在被击倒后，尝试返回其自身的初始
// 位置"; sim Battle._layBody). render/interp.js keeps them and render/units.js draws the knocked-down view on that tile
// (headless fake PIXI, test/render/fakepixi.js); older 4-element entries keep the view where it is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

let fake, UnitView, DOWN_STATE, groundZ;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, DOWN_STATE, groundZ } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const view = (info = {}) => new UnitView(fakeViewCtx(fake.P, { cam }), { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT', ...info });
const frames = (v, n) => { for (let i = 0; i < n; i++) v.update(1 / 60, cam(), i / 60); };

test('interp keeps the body tile of a `down` entry (integers only); a 4-element entry stays as it was', () => {
  const s = normalizeSnapshot({ t: 2, units: [], down: [[7, 20, 18, 0, 9, 8], [8, 21, 18, 0], [9, 22, 18, 0, 9.5, 'x']] });
  assert.deepEqual(s.down, [[7, 20, 18, 0, 9, 8], [8, 21, 18, 0], [9, 22, 18, 0]]);
  const buf = new SnapshotBuffer({ delay: 0 });
  buf.push({ t: 1, units: [], down: [[7, 20, 18, 0, 10, 3]] }, 0);
  assert.deepEqual(buf.downAt(1), [[7, 20, 18, 0, 10, 3]]);
});

test('the knocked-down view is drawn on the tile the entry names: a body back on its home moves there', () => {
  const v = view({ x: 6, y: 12 });  // fell on another piece's home (12,6)
  frames(v, 2);
  v.setDown([1, 30, 20, DOWN_STATE.COUNTING, 10, 3], 10); // it lies on its own home (10,3)
  assert.equal(v.alive, false);
  assert.deepEqual([v.x, v.y], [3, 10]);
  frames(v, 30);
  assert.equal(v.z, groundZ(v.ctx, 3, 10), 'on that tile\'s ground');
  assert.ok(v._downRing.root.visible, 'its ring follows');
  // a 4-element entry (an older feed) leaves it where it is
  const w = view({ id: 2, x: 4, y: 11 });
  frames(w, 2);
  w.setDown([2, 30, 20, DOWN_STATE.COUNTING], 10);
  assert.deepEqual([w.x, w.y], [4, 11]);
});

test('end to end: the sim\'s snapshot names the tile the body lies on, the view follows it', () => {
  const op = (id) => chessRec({ id, profession: 'WARRIOR', skill: null });
  const h = makeBattle({ defs: { chess: { e_a: op('e_a'), e_b: op('e_b') } }, units: [{ chessId: 'e_a', row: 12, col: 3 }, { chessId: 'e_b', row: 10, col: 3 }], content: 'none', autoFinish: false });
  h.step();
  const b = h.b, A = h.unit('e_a'), B = h.unit('e_b');
  b.retreat(A, { reason: 'raid' });
  b.redeploy(A, { free: true, tile: [11, 6] });
  b.retreat(B, { reason: 'raid' });
  b.redeploy(B, { free: true, tile: [12, 3] }); // on A's home
  const v = view({ id: B.id, x: B.x, y: B.y });
  frames(v, 2);
  b.kill(B);
  const d = normalizeSnapshot(b.snapshot()).down.find((e) => e[0] === B.id);
  assert.deepEqual(d.slice(4), [10, 3], 'back on its own home');
  v.setDown(d, b.time);
  assert.deepEqual([v.x, v.y], [3, 10]);
});
