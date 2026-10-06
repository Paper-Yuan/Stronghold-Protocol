// Device-testing report (2026-10): tapping a placed operator selected it (underframe + detail, the retreat / direction
// actions) but the camera never moved — on a crowded board the player had to hunt for the piece. Official behaviour: the
// selection eases the camera onto the piece's tile and back to the previous framing on deselect.
//   ui/gameLogic.js selFocusRect (the rect: the piece's tile + SEL_FOCUS_TILES of context, through the prep field's
//   display transform) and SEL_FOCUS_TILE_PX (the fit's cap: a step closer than the shop camera, not a jump onto the
//   model); render/app.js focusTile (the flight, over the shared CAMERA_MS easing — a detour that never touches
//   camKind/camOpts: the shop camera, the Final Assault half, the pen's way back; every setCamera request supersedes it
//   and a resize re-fits); screens/game.js (the effect: own prep board only, board pieces only, restore on deselect).
// The rect / camera math runs DOM-free (render/prepfield.js, render/projection.js); the wiring is pinned on the sources.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selFocusRect, SEL_FOCUS_TILE_PX, SEL_FOCUS_TILES } from '../../public/js/ui/gameLogic.js';
import { IDENTITY, bossPrepField } from '../../public/js/render/prepfield.js';
import { fitCamera, presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

describe('selFocusRect: the rect a selected piece\'s camera frames (gameLogic)', () => {
  test('the tile with SEL_FOCUS_TILES of context on every side', () => {
    assert.deepEqual(selFocusRect(10, 5), { r0: 10 - SEL_FOCUS_TILES.r, r1: 10 + SEL_FOCUS_TILES.r, c0: 5 - SEL_FOCUS_TILES.c, c1: 5 + SEL_FOCUS_TILES.c });
    assert.deepEqual(selFocusRect(9, 2, IDENTITY.toDisp), selFocusRect(9, 2), 'the own board shows board space as is');
  });

  test('the Final Assault prep frames the DISPLAY tile: the right half mirrored (col c → 20 − c)', () => {
    assert.deepEqual(selFocusRect(9, 2, bossPrepField('L').toDisp), { r0: 1, r1: 3, c0: 0, c1: 4 });
    assert.deepEqual(selFocusRect(12, 10, bossPrepField('R').toDisp), { r0: 4, r1: 6, c0: 8, c1: 12 });
  });

  test('null for a malformed tile or one the prep field does not show', () => {
    assert.equal(selFocusRect(1.5, 3), null);
    assert.equal(selFocusRect(9, null, IDENTITY.toDisp), null);
    assert.equal(selFocusRect(9, 2, () => null), null, 'a toDisp that drops the tile');
    assert.equal(selFocusRect(9, 2, () => ({ row: 2 })), null);
  });
});

// The way render/app.js focusTile fits it: the rect in the padded viewport (the current kind's padding keeps the piece
// clear of the top bar and the shop bar), capped at SEL_FOCUS_TILE_PX.
const VIEWPORT = { width: 1280, height: 720 };
const focusCameraOf = (row, col, toDisp = null, vp = VIEWPORT) => {
  const R = selFocusRect(row, col, toDisp);
  assert.ok(R);
  return fitCamera(R, { ...vp, padding: { top: vp.height * 0.1, bottom: vp.height * 0.24, left: Math.min(170, vp.width * 0.09), right: vp.width * 0.05 } },
    { margin: 0.5, headroom: 1.6, maxTilePx: SEL_FOCUS_TILE_PX });
};

describe('the selection focus camera (projection fitCamera, app.js focusTile)', () => {
  const W = VIEWPORT.width, H = VIEWPORT.height;

  test('the piece sits centred in the padded viewport, clear of the HUD bands', () => {
    for (const [row, col] of [[9, 2], [10, 6], [12, 10]]) {
      const cam = focusCameraOf(row, col);
      const p = cam.project(col, row);
      const pl = Math.min(170, W * 0.09), pr = W * 0.05, pt = H * 0.1, pb = H * 0.24;
      assert.ok(Math.abs(p.x - (pl + (W - pl - pr) / 2)) < (W - pl - pr) * 0.25, `(${row},${col}) centred: ${p.x}`);
      assert.ok(p.y > pt && p.y < H - pb, `(${row},${col}) inside the padded band: ${p.y} in [${pt}, ${H - pb}]`);
    }
  });

  test('a step closer than the shop camera, capped at SEL_FOCUS_TILE_PX (never a jump onto the model)', () => {
    const shop = presetCamera('prep', VIEWPORT, { rect: { r0: 7, r1: 12, c0: 0, c1: 10 }, side: 'L' });
    const folded = presetCamera('prep', VIEWPORT, { rect: { r0: 7, r1: 12, c0: 0, c1: 10 }, side: 'L', shop: false });
    for (const [row, col] of [[9, 2], [11, 8]]) {
      const cam = focusCameraOf(row, col);
      const s = cam.scaleAt(col, row);
      assert.ok(s <= SEL_FOCUS_TILE_PX + 1e-6, `capped at ${SEL_FOCUS_TILE_PX} px per tile (${s})`);
      assert.ok(s > shop.scaleAt(col, row) * 1.15, `${s} px per tile vs the shop camera ${shop.scaleAt(col, row)}`);
      assert.ok(s > folded.scaleAt(col, row) * 1.1, `${s} px per tile vs the folded camera ${folded.scaleAt(col, row)}`);
    }
  });

  test('the Final Assault prep: a mirrored-half piece is centred in the padded band like any other (the rect is the mirrored one — gameLogic above)', () => {
    const centre = Math.min(170, W * 0.09) + (W - Math.min(170, W * 0.09) - W * 0.05) / 2; // focusCameraOf's padding, mirrored exactly
    const r = focusCameraOf(12, 10, bossPrepField('R').toDisp);
    const rp = r.project(20 - 10, 12 - 7);
    assert.ok(Math.abs(rp.x - centre) < 1, `the R half's piece centred: ${rp.x} vs ${centre}`);
    const l = focusCameraOf(9, 2, bossPrepField('L').toDisp);
    assert.ok(Math.abs(l.project(2, 2).x - centre) < 1, 'the L half centred too');
  });

  test('a small viewport still fits the piece (the cap is a maximum, the fit a minimum)', () => {
    const cam = focusCameraOf(10, 5, null, { width: 756, height: 366 });
    const p = cam.project(5, 10);
    assert.ok(p.x > 0 && p.x < 756 && p.y > 0 && p.y < 366, `on screen: ${p.x},${p.y}`);
  });
});

describe('wiring', () => {
  test('app.js exposes focusTile as a detour: shared easing, superseded by setCamera, re-fitted on resize', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /import \{ selFocusRect, SEL_FOCUS_TILE_PX \} from '\.\.\/ui\/gameLogic\.js';/);
    assert.match(app, /function flyTo\(target\) \{\n {4}camFrom = cam\.clone\(\);\n {4}camTo = target;\n {4}camT0 = performance\.now\(\);\n {4}camMs = CAMERA_MS;\n {2}\}/, 'the flight shares the camera requests\' easing');
    assert.match(app, /maxTilePx: SEL_FOCUS_TILE_PX/);
    assert.match(app, /selFocusRect\(row, col, prepXf\.toDisp\)/, 'the rect goes through the prep field\'s display transform');
    assert.match(app, /function setCamera\(kind, options\) \{\n {4}if \(destroyed\) return false;\n {4}selFocus = null;/, 'any camera request supersedes the zoom');
    assert.match(app, /const target = selFocus \? selFocusCamera\(selFocus\.row, selFocus\.col, selFocus\.rect\) : targetCamera\(camKind, camOpts\);/, 'a resize re-fits the zoom (with the drag rect when one is pinned)');
    assert.match(app, /\n {4}focusTile,\n/, 'on the view API');
  });

  test('game.js eases to the selected board piece and restores on deselect — own prep only', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /const selFocusRef = useRef\(null\);/);
    assert.match(game, /if \(!view\) return undefined;\n {4}const prev = selFocusRef\.current;\n {4}const t = editable && showPrep && selEntry && selEntry\.area === 'board'/, 'own prep board, board pieces only');
    assert.match(game, /view\.focusTile\?\.\(null\);/, 'deselect: the camera in use again');
    assert.match(game, /view\.focusTile\?\.\(t\.row, t\.col\);/);
    assert.match(game, /\}, \[view, selEntry, editable, showPrep, shopFolded\]\);/, 'a shop fold re-frames and the zoom re-asserts');
  });
});
