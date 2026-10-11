// render/units.js facing display (research 09 §1.2, DESIGN §3 "Facing (corrected)"): a unit's deploy direction picks
// its model (Back for UP when one exists, Front for RIGHT / DOWN, Front mirrored for LEFT), `setDir` re-orients a live
// view (swapping Front ⇄ Back without a fallback flash and keeping every Spine acquire paired with one release), and
// the orange ground wedge of prep board pieces points along the direction on the ground plane.
// Headless: test/render/fakepixi.js stands in for PIXI.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from '../render/fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, UnitView, unitDir;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, unitDir } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });

/** Asset store stub with Front / Back Spine entries and acquire / release bookkeeping. */
function store({ back = true } = {}) {
  const front = { skel: '/s/front.skel', atlas: '/s/front.atlas', anims: { idle: 'Idle' }, animations: { Idle: 1 } };
  const backE = { skel: '/s/back.skel', atlas: '/s/back.atlas', anims: { idle: 'Idle' }, animations: { Idle: 1 } };
  const refs = new Map();
  const log = [];
  return {
    refs, log, front, backE,
    picture: () => null,
    image: async () => null,
    hasBack: () => back,
    spineEntry: (id, o) => { log.push(!!(o && o.back)); return o && o.back && back ? backE : front; },
    spine: {
      acquire: async (e) => { refs.set(e.skel, (refs.get(e.skel) || 0) + 1); return { animations: [{ name: 'Idle' }] }; },
      release: (e) => { refs.set(e.skel, (refs.get(e.skel) || 0) - 1); },
    },
  };
}

function view(info, opts = {}, assets = store()) {
  const ctx = fakeViewCtx(fake.P, { assets, cam });
  return new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', spine: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, ...info }, opts);
}

describe('deploy direction → model', () => {
  test('unitDir: `dir` (any case) wins, else the legacy facing sign', () => {
    assert.equal(unitDir({ dir: 'up' }), 'UP');
    assert.equal(unitDir({ facing: -1 }), 'LEFT');
    assert.equal(unitDir({}), 'RIGHT');
    assert.equal(unitDir({ dir: 'north', facing: -1 }), 'LEFT');
  });

  test('UP loads the Back model; LEFT mirrors the Front one; enemies ignore dir', async () => {
    const s = store();
    const up = view({ dir: 'UP' }, { prep: true }, s);
    await tick(); await tick();
    assert.equal(s.log[0], true, 'Back model requested');
    assert.equal(up.visFacing, 1);
    const left = view({ dir: 'LEFT' }, { prep: true }, s);
    await tick();
    assert.equal(s.log[1], false, 'Front model');
    assert.equal(left.visFacing, -1, 'mirrored');
    const noBack = store({ back: false });
    view({ dir: 'UP' }, {}, noBack);
    assert.equal(noBack.log[0], false, 'no Back model → Front');
    const en = view({ side: 'enemy', kind: 'enemy', dir: 'UP' }, {}, s);
    assert.equal(en.dir, null);
    en.setDir('RIGHT');
    assert.equal(en.visFacing, -1, 'enemies keep their own facing rule');
  });

  test('setDir swaps Front ⇄ Back in place (no fallback flash) and pairs every acquire with a release', async () => {
    const s = store();
    const v = view({ dir: 'RIGHT' }, { prep: true }, s);
    await tick(); await tick();
    assert.ok(v.spineReady);
    const first = v.actor;
    v.setDir('DOWN');
    await tick();
    assert.equal(v.actor, first, 'DOWN keeps the Front model');
    v.setDir('UP');
    assert.equal(v.actor, first, 'the old model stays up while the Back one loads');
    await tick(); await tick();
    assert.notEqual(v.actor, first, 'Back model in place');
    assert.ok(first.spine === null || first.spine?.destroyed !== false, 'previous actor destroyed');
    assert.equal(v.swapT, 1, 'no cross-fade from the fallback diamond');
    assert.equal(s.refs.get('/s/front.skel'), 0, 'Front released');
    assert.equal(s.refs.get('/s/back.skel'), 1);
    // a quick UP → LEFT → UP: superseded loads release themselves
    v.setDir('LEFT');
    v.setDir('UP');
    await tick(); await tick();
    v.destroy();
    await tick(); await tick();
    for (const [k, n] of s.refs) assert.equal(n, 0, `${k} balanced after destroy`);
  });

  test('setFacing(±1) keeps an UP / DOWN operator vertical', () => {
    const v = view({ dir: 'UP' }, {}, store({ back: false }));
    v.setFacing(1);
    assert.equal(v.dir, 'UP');
    v.setFacing(-1);
    assert.equal(v.dir, 'LEFT');
    v.setFacing(1);
    assert.equal(v.dir, 'RIGHT');
  });
});

describe('ground wedge "›" of prep board pieces', () => {
  const angle = (dir) => {
    const v = view({ dir }, { prep: true }, store({ back: false }));
    v._showFacing = true;
    v.update(1 / 60, cam(), 0);
    assert.ok(v.facingArrow && v.facingArrow.visible, 'wedge shown');
    const a = v.facingArrow.rotation;
    const pos = { x: v.facingArrow.position.x, y: v.facingArrow.position.y };
    const c = cam().project(v.x, v.y, 0.01);
    return { a, dx: pos.x - c.x, dy: pos.y - c.y, sx: v.facingArrow.scale.x, sy: v.facingArrow.scale.y };
  };
  test('points along the direction on screen (RIGHT → right, UP → up the board, …) and is foreshortened along it', () => {
    const r = angle('RIGHT'); const l = angle('LEFT'); const u = angle('UP'); const d = angle('DOWN');
    assert.ok(Math.abs(r.a) < 0.05 && r.dx > 0, `RIGHT (${r.a})`);
    assert.ok(Math.abs(Math.abs(l.a) - Math.PI) < 0.05 && l.dx < 0, `LEFT (${l.a})`);
    assert.ok(Math.abs(u.a + Math.PI / 2) < 0.05 && u.dy < 0, `UP points up the screen (${u.a})`);
    assert.ok(Math.abs(d.a - Math.PI / 2) < 0.05 && d.dy > 0, `DOWN (${d.a})`);
    assert.ok(u.sx < r.sx, 'a vertical wedge is shorter along its axis (ground tilt)');
    assert.ok(r.sx > 0 && l.sx > 0, 'no negative scale (rotation does the mirroring)');
  });
  test('setDir re-points the wedge of a live piece', () => {
    const v = view({ dir: 'RIGHT' }, { prep: true }, store({ back: false }));
    v._showFacing = true;
    v.update(1 / 60, cam(), 0);
    v.setDir('LEFT');
    v.update(1 / 60, cam(), 1 / 60);
    assert.ok(Math.abs(Math.abs(v.facingArrow.rotation) - Math.PI) < 0.05);
  });
});

describe('ground wedge in combat (research 09 §1.2: "prep and combat") — review regression', () => {
  test('battle allies show it only when the UnitInfo carries dir; enemies and bench pieces never', () => {
    const withDir = view({ dir: 'UP' }, {}, store({ back: false }));
    withDir.update(1 / 60, cam(), 0);
    assert.ok(withDir.facingArrow && withDir.facingArrow.visible, 'battle ally with dir: wedge');
    assert.ok(Math.abs(withDir.facingArrow.rotation + Math.PI / 2) < 0.05, 'pointing UP');
    const legacy = view({ facing: 1 }, {}, store({ back: false }));
    legacy.update(1 / 60, cam(), 0);
    assert.ok(!legacy.facingArrow || !legacy.facingArrow.visible, 'no dir (legacy ±1 only): no wedge rather than a guessed RIGHT');
    const enemy = view({ side: 'enemy', kind: 'enemy', dir: 'LEFT' }, {}, store({ back: false }));
    enemy.update(1 / 60, cam(), 0);
    assert.ok(!enemy.facingArrow || !enemy.facingArrow.visible, 'enemies: none');
    const bench = view({ dir: 'RIGHT' }, { prep: true }, store({ back: false }));
    bench._showFacing = false;
    bench.update(1 / 60, cam(), 0);
    assert.ok(!bench.facingArrow || !bench.facingArrow.visible, 'own bench piece: none');
  });
});
