// test/render/projection.test.js — camera math: projection ↔ unprojection round trips, perspective
// properties, framing presets (the official configBlackBoard cameras, fitted against official screenshots), lerp,
// tile picking with raised tiles, and the three.js PerspectiveCamera equivalence the 3D board relies on (every tile
// centre projected through both layers lands on the same pixel).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Camera, fitCamera, presetCamera, lerpCamera, pickTile, tileQuad, normRect, CAMERA_PRESETS, easeInOutCubic,
  OFFICIAL, OFFICIAL_PARAMS, officialCamera, parseCameraParam, threeCameraParams, syncThreeCamera, clearHud,
} from '../../public/js/render/projection.js';
import * as THREE from 'three';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('Camera', () => {
  test('project → unproject round trip on several planes and tilts', () => {
    for (const tilt of [0, 20, 36, 55]) {
      for (const dist of [8, 16, 40]) {
        const cam = new Camera({ tx: 7, ty: 10, tilt, dist, scale: 70, cx: 640, cy: 360 });
        for (let i = 0; i < 200; i++) {
          const x = -2 + (i * 7.31) % 24, y = -1 + (i * 3.77) % 20, z = [0, 0.18, 0.42, 1.3][i % 4];
          if (cam.depthOf(x, y, z) < 0.5) continue; // behind / at the camera: not invertible (depth is clamped)
          const p = cam.project(x, y, z);
          const w = cam.unproject(p.x, p.y, z);
          assert.ok(w, `unproject null for ${x},${y},${z}`);
          assert.ok(near(w.x, x, 1e-6) && near(w.y, y, 1e-6), `round trip ${x},${y},${z} tilt ${tilt} → ${w.x},${w.y}`);
        }
      }
    }
  });

  test('target maps to (cx, cy) and scale is px per unit at the target', () => {
    const cam = new Camera({ tx: 5, ty: 10, tilt: 36, dist: 16, scale: 50, cx: 300, cy: 200 });
    const p = cam.project(5, 10, 0);
    assert.ok(near(p.x, 300) && near(p.y, 200));
    assert.ok(near(p.s, 50));
    const q = cam.project(6, 10, 0);
    assert.ok(near(q.x - p.x, 50, 1e-9));
  });

  test('farther rows are narrower and higher on screen; heights go up', () => {
    const cam = new Camera({ tx: 5, ty: 10, tilt: 36, dist: 16, scale: 60, cx: 500, cy: 400 });
    const w = (row) => cam.project(5.5, row, 0).x - cam.project(4.5, row, 0).x;
    assert.ok(w(12) < w(9), 'row 12 narrower than row 9');
    assert.ok(w(9) < w(7), 'row 9 narrower than row 7');
    const ratio = w(7) / w(12);
    assert.ok(ratio > 1.1 && ratio < 1.35, `row 7 / row 12 width ratio ${ratio} ≈ 1.2 like the original`);
    assert.ok(cam.project(5, 12, 0).y < cam.project(5, 9, 0).y, 'far rows are higher');
    assert.ok(cam.project(5, 10, 1).y < cam.project(5, 10, 0).y, 'z up is screen up');
    // tile depth foreshortening: a tile is shorter than it is wide
    const h = cam.project(5, 9.5, 0).y - cam.project(5, 10.5, 0).y;
    assert.ok(h > 0.6 * w(10) && h < 0.95 * w(10), `tile aspect ${h / w(10)}`);
  });

  test('top-down (tilt 0) is an orthographic-like square grid at the target depth', () => {
    const cam = new Camera({ tx: 0, ty: 0, tilt: 0, dist: 10, scale: 40, cx: 0, cy: 0 });
    const a = cam.project(1, 0, 0), b = cam.project(0, 1, 0);
    assert.ok(near(a.x, 40) && near(a.y, 0));
    assert.ok(near(b.x, 0) && near(b.y, -40));
  });

  test('unproject returns null for rays that miss the plane (above the horizon)', () => {
    const cam = new Camera({ tx: 0, ty: 0, tilt: 60, dist: 10, scale: 40, cx: 0, cy: 0 });
    // far above the screen: ray goes above the horizon
    assert.equal(cam.unproject(0, -1e6, 0), null);
    // plane above the camera is never hit looking down
    assert.equal(cam.unproject(0, 0, 100), null);
  });

  test('points behind the camera do not produce NaN', () => {
    const cam = new Camera({ tx: 0, ty: 0, tilt: 36, dist: 5, scale: 40, cx: 0, cy: 0 });
    const p = cam.project(0, -50, 0);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.s));
  });

  test('constructor sanitises bad input; copy/clone/params', () => {
    const cam = new Camera({ tx: NaN, tilt: 999, dist: -3, scale: 0 });
    assert.ok(Number.isFinite(cam.tx));
    assert.ok(cam.tilt <= 80 && cam.dist >= 1 && cam.scale > 0);
    const b = new Camera({ tx: 3, ty: 4, scale: 9, cx: 1, cy: 2 });
    const c = cam.clone().copy(b);
    assert.deepEqual(c.params(), b.params());
    assert.notEqual(c, b);
  });
});

describe('framing', () => {
  const vp = { width: 1920, height: 1080 };

  function bounds(cam, rect, margin = 0, headroom = 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [rect.c0 - 0.5 - margin, rect.c1 + 0.5 + margin]) for (const y of [rect.r0 - 0.5 - margin, rect.r1 + 0.5 + margin]) for (const z of [0, headroom]) {
      const p = cam.project(x, y, z);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  }

  test('fitCamera keeps the rect (+headroom) inside the padded viewport and touches one axis', () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [800, 1200], [3440, 1440]]) {
      for (const kind of Object.keys(CAMERA_PRESETS)) {
        const P = CAMERA_PRESETS[kind];
        const pad = { top: 90, bottom: 180, left: 120, right: 40 };
        const cam = fitCamera(P.rect, { width: w, height: h, padding: pad }, { margin: P.margin, headroom: P.headroom, tilt: P.tilt, dist: P.dist });
        const b = bounds(cam, P.rect, P.margin, P.headroom);
        const tol = 0.5;
        assert.ok(b.minX >= pad.left - tol && b.maxX <= w - pad.right + tol, `${kind} ${w}x${h} x ${b.minX}..${b.maxX}`);
        assert.ok(b.minY >= pad.top - tol && b.maxY <= h - pad.bottom + tol, `${kind} ${w}x${h} y ${b.minY}..${b.maxY}`);
        const fillX = (b.maxX - b.minX) / (w - pad.left - pad.right);
        const fillY = (b.maxY - b.minY) / (h - pad.top - pad.bottom);
        if (cam.scale < 360) assert.ok(Math.max(fillX, fillY) > 0.99, `${kind} ${w}x${h} fills one axis (${fillX}, ${fillY})`);
        // centred on the free axis
        const cxMid = (b.minX + b.maxX) / 2, cyMid = (b.minY + b.maxY) / 2;
        assert.ok(near(cxMid, pad.left + (w - pad.left - pad.right) / 2, 1e-6));
        assert.ok(near(cyMid, pad.top + (h - pad.top - pad.bottom) / 2, 1e-6));
      }
    }
  });

  test('presets (official framing): unite is wider than normal; boss shows its field; prep includes the hand row', () => {
    const n = presetCamera('normal', vp), u = presetCamera('unite', vp), b = presetCamera('boss', vp), p = presetCamera('prep', vp);
    assert.ok(u.scale < n.scale);
    const inView = (cam, x, y) => { const q = cam.project(x, y, 0); return q.x >= 0 && q.x <= vp.width && q.y >= 0 && q.y <= vp.height; };
    // 全景 of the boss field: the playable rows 1–5 × cols 2–18 (the official view crops the outer bench corners)
    for (let c = 2; c <= 18; c++) for (let r = 1; r <= 5; r++) assert.ok(inView(b, c, r), `boss ${r},${c}`);
    // 联防 全景 = mid_battle_camera_param (0,0,−4.22) exactly like the official client: at 16:9 the view ends at col
    // ≈1.73 / 18.27 on row 9, so the E (9,2) and the gate (9,18) sit at the screen edges (centres x ≈ 31 / 1889 of
    // 1920) with the outer part of their cubes cut — official framing, not to be "fixed" by re-fitting the rect
    assert.ok(near(u.project(2, 9, 0).x, 31.3, 0.5) && near(u.project(18, 9, 0).x, 1888.7, 0.5));
    for (let c = 2; c <= 18; c++) for (const r of [9, 12]) assert.ok(inView(u, c, r), `unite ${r},${c}`);
    for (let c = 0; c <= 10; c++) for (const r of [7, 8, 9, 12]) assert.ok(inView(p, c, r), `prep ${r},${c}`);
    // the official battle camera frames the playable part of the field (cols 2–10: E at col 2, the gates at col 10)
    for (let c = 2; c <= 10; c++) for (const r of [9, 12]) assert.ok(inView(n, c, r), `normal ${r},${c}`);
    assert.ok(!inView(n, 5, 2), 'normal camera does not show the boss field');
    // unknown kind falls back to normal; explicit rect overrides
    assert.deepEqual(presetCamera('???', vp).params(), n.params());
    const half = presetCamera('boss', vp, { half: true, side: 'R' });
    const q = half.project(18, 3, 0);
    assert.ok(q.x > 0 && q.x < vp.width);
    assert.ok(half.project(0, 3, 0).x < 0, 'left half off screen when framing the right half');
    // the preview pen camera shows the whole pen (rows 14–18 × cols 7–13)
    const pen = presetCamera('pen', vp);
    for (let c = 7; c <= 13; c++) for (const r of [14, 18]) assert.ok(inView(pen, c, r), `pen ${r},${c}`);
    // shop collapsed: the prepare camera is closer than the shop one
    assert.ok(presetCamera('prep', vp, { shop: false }).scale > p.scale);
    // Final Assault prep on the boss rows uses the boss shop cameras (left / right)
    const bp = presetCamera('prep', vp, { rect: { r0: 0, r1: 5, c0: 0, c1: 10 }, side: 'R' });
    assert.ok(inView(bp, 15, 3) && bp.tx > 14 && !inView(bp, 3, 3), 'right boss prep camera frames the right half');
  });

  test('official cameras reproduce the official screenshots (tile seams of a 1920×1079 shop view)', () => {
    // act1autochess_m06 (上半, same configBlackBoard), shop panel open → left_shop_camera_param; seams measured by
    // eye on the official screenshot (bahamut a7a712…): (x = col boundary, y = row boundary) → screen px
    const cam = presetCamera('prep', { width: 1920, height: 1079 });
    const seams = [[6.5, 11.5, 1099.3, 326], [7.5, 11.5, 1199.3, 326], [8.5, 11.5, 1299.3, 326], [6.5, 10.5, 1101.7, 408],
      [7.5, 10.5, 1205, 409], [8.5, 10.5, 1306.7, 410], [4.5, 9.5, 888, 501], [6.5, 9.5, 1104, 501], [3.5, 9.5, 776, 501]];
    let sq = 0;
    for (const [x, y, sx, sy] of seams) { const p = cam.project(x, y, 0); sq += (p.x - sx) ** 2 + (p.y - sy) ** 2; }
    const rms = Math.sqrt(sq / seams.length);
    assert.ok(rms < 5, `rms ${rms.toFixed(2)} px`);
    // the camera itself: pitch 30°, vertical FOV 40°, principal point at the centre, standard view + shop param
    assert.equal(cam.tilt, OFFICIAL.pitch);
    assert.ok(near(2 * Math.atan(1079 / 2 / (cam.scale * cam.dist)) / (Math.PI / 180), OFFICIAL.fovY, 1e-9));
    assert.deepEqual([cam.cx, cam.cy], [960, 539.5]);
    const pos = cam.position();
    assert.ok(near(pos.x, 5.17, 1e-9) && near(pos.y, 2.44, 1e-9) && near(pos.z, 11.53, 1e-9), JSON.stringify(pos));
  });

  test('officialCamera / parseCameraParam: data-driven params, narrow screens back off, garbage is safe', () => {
    assert.deepEqual(parseCameraParam('(-4.67,0.3,-2.46,1)'), [-4.67, 0.3, -2.46, 1]);
    assert.deepEqual(parseCameraParam([1, 2, 3]), [1, 2, 3, 1]);
    assert.equal(parseCameraParam('(a,b)'), null);
    assert.equal(parseCameraParam(null), null);
    for (const k of Object.keys(OFFICIAL_PARAMS)) assert.ok(parseCameraParam(OFFICIAL_PARAMS[k]), k);
    // stage.config overrides the defaults (same keys as configBlackBoard)
    const moved = presetCamera('normal', vp, { config: { left_battle_camera_param: '(0,1.91,-0.6,1)' } });
    assert.ok(near(moved.tx, 10), 'param x = col − 10');
    // 4:3 backs the camera off (smaller tiles than a 16:9 screen of the same height)
    const wide = officialCamera(OFFICIAL_PARAMS.left_battle_camera_param, { width: 1440, height: 810 });
    const tall = officialCamera(OFFICIAL_PARAMS.left_battle_camera_param, { width: 1080, height: 810 });
    assert.ok(tall.scale < wide.scale && tall.position().z > wide.position().z);
    // portrait: the fitted fallback keeps the whole field on screen
    const port = presetCamera('normal', { width: 700, height: 1400 });
    for (let c = 0; c <= 10; c++) assert.ok(port.project(c, 9, 0).x > 0 && port.project(c, 9, 0).x < 700, `portrait col ${c}`);
    for (const v of Object.values(officialCamera('garbage', { width: NaN, height: 0 }).params())) assert.ok(Number.isFinite(v));
  });

  test('tiny / degenerate viewports never produce NaN', () => {
    const cam = fitCamera({ r0: 9, r1: 12, c0: 0, c1: 10 }, { width: 0, height: NaN, padding: { top: 5000 } });
    for (const v of Object.values(cam.params())) assert.ok(Number.isFinite(v));
  });

  test('normRect swaps and clamps', () => {
    assert.deepEqual(normRect({ r0: 12, r1: 9, c0: 30, c1: -4 }), { r0: 9, r1: 12, c0: 0, c1: 20 });
    assert.deepEqual(normRect(null), { r0: 0, r1: 18, c0: 0, c1: 20 });
  });

  test('lerpCamera endpoints and midpoint; ease', () => {
    const a = presetCamera('prep', vp), b = presetCamera('boss', vp);
    const s0 = lerpCamera(a, b, 0).params(), ap = a.params();
    for (const k of Object.keys(ap)) assert.ok(near(s0[k], ap[k], 1e-9), k);
    const e = lerpCamera(a, b, 1).params(), bp = b.params();
    for (const k of Object.keys(bp)) assert.ok(near(e[k], bp[k], 1e-9), k);
    const m = lerpCamera(a, b, 0.5);
    assert.ok(near(m.scale, Math.sqrt(a.scale * b.scale), 1e-9), 'scale lerps in log space');
    assert.equal(easeInOutCubic(0), 0); assert.equal(easeInOutCubic(1), 1); assert.ok(near(easeInOutCubic(0.5), 0.5));
    assert.ok(easeInOutCubic(0.25) < 0.25 && easeInOutCubic(0.75) > 0.75);
  });
});

describe('pickTile / tileQuad', () => {
  const cam = presetCamera('prep', { width: 1600, height: 900 });
  const heights = (r, c) => (r === 7 ? 0.18 : r === 10 && c === 4 ? 0.42 : 0);
  const levels = [0.42, 0.18, 0];

  test('centres of every tile pick back the same tile (low, bench and raised)', () => {
    for (let r = 7; r <= 12; r++) for (let c = 0; c <= 10; c++) {
      const z = heights(r, c);
      const p = cam.project(c, r, z);
      const t = pickTile(cam, p.x, p.y, heights, levels);
      assert.ok(t, `tile ${r},${c}`);
      assert.deepEqual([t.row, t.col], [r, c], `pick ${r},${c}`);
    }
  });

  test('the top face of a raised tile wins over the ground tile behind it', () => {
    // a point on the raised top near its far edge projects over the ground of the row behind
    const p = cam.project(4, 10.45, 0.42);
    const ground = cam.unproject(p.x, p.y, 0);
    assert.equal(Math.round(ground.y), 11, 'ground ray hits the row behind');
    const t = pickTile(cam, p.x, p.y, heights, levels);
    assert.deepEqual([t.row, t.col], [10, 4]);
  });

  test('off-grid points return null', () => {
    const far = cam.project(-5, 10, 0);
    assert.equal(pickTile(cam, far.x, far.y, heights, levels), null);
    assert.equal(pickTile(cam, 800, -1e6, heights, levels), null);
  });

  test('tileQuad is a trapezoid narrower at the far edge', () => {
    const q = tileQuad(cam, 10, 5);
    const nearW = q[1].x - q[0].x, farW = q[2].x - q[3].x;
    assert.ok(nearW > farW && farW > 0);
    assert.ok(q[3].y < q[0].y);
  });
});

describe('HUD clearance of the prep views (user playtest #5 item 9)', () => {
  // the in-match HUD in rem (ui/fieldHost.js HUD_REM): the bond strip ends 2.16rem below the top, the shop bar starts
  // 2.64rem + 3 px above the bottom; the root font size is clamp(40px, min(W / 19.2, H / 10.8), 240px) (css/theme.css)
  const hudAt = (w, h) => {
    const rem = Math.max(40, Math.min(w / 19.2, h / 10.8, 240));
    return { top: 2.16 * rem, bottom: 2.64 * rem + 3 };
  };
  const band = (cam, kind) => {
    const k = CAMERA_PRESETS[kind].keep;
    return { near: cam.project(cam.tx, k.near, k.zNear).y, far: cam.project(cam.tx, k.far, k.zFar).y };
  };
  // phones in landscape (CSS px): iPhone 12–15 (19.5:9), iPhone Pro Max, Galaxy S20+ / 2400×1080 (20:9), 800×360,
  // Xperia 21:9, 924×424, 740×360, and the user's Android: its screenshot is 2772×1272 px with the page drawn right of
  // a 141 px black cutout band, i.e. 2631×1272 px at DPR ≈ 3.48 → 756×366 (its exit and 准备就绪 buttons match
  // to ±1 px there), and 798×366 if the page also covered the cutout
  const PHONES = [[844, 390], [932, 430], [915, 412], [914, 411], [800, 360], [960, 411], [756, 366], [798, 366], [924, 424], [740, 360]];
  const DESKTOPS = [[1920, 1080], [1680, 1050], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [2560, 1440],
    [3840, 2160], [2560, 1080], [3440, 1440], [1600, 1200], [1180, 820], [1024, 768], [1920, 1200]];
  const cams = (kind, w, h, hud) => (kind === 'bossPrep' ? ['L', 'R'] : ['L']).map((side) => [side, presetCamera(kind, { width: w, height: h }, { side, hud })]);

  test('reproduction: the official shop camera puts the bench under the shop bar on phones (844×390: ~11 px, 800×360: ~19 px, 756×366 as on the user\'s Android: ~17 px)', () => {
    for (const [w, h] of [[844, 390], [800, 360], [756, 366]]) {
      for (const kind of ['prep', 'bossPrep']) {
        const b = band(presetCamera(kind, { width: w, height: h }), kind);
        assert.ok(b.near > h - hudAt(w, h).bottom + 8, `${kind} ${w}×${h}: bench edge ${b.near} vs shop bar ${h - hudAt(w, h).bottom}`);
      }
    }
  });

  test('with the HUD bands the bench clears the shop bar and the back row the bond strip, as large as fits', () => {
    for (const [w, h] of PHONES) {
      const hud = hudAt(w, h);
      const top = hud.top, bottom = h - hud.bottom;
      for (const kind of ['prep', 'bossPrep']) {
        for (const [side, cam] of cams(kind, w, h, hud)) {
          const off = presetCamera(kind, { width: w, height: h }, { side });
          const b = band(cam, kind), b0 = band(off, kind);
          const tag = `${kind}/${side} ${w}×${h}`;
          assert.ok(b.near <= bottom + 1e-6, `${tag}: bench edge ${b.near} above the shop bar ${bottom}`);
          assert.ok(b.far >= top - 1e-6, `${tag}: back row ${b.far} below the bond strip ${top}`);
          // the official perspective (a 2D pan / zoom of the image): same pinhole, pitch and target
          for (const k of ['tx', 'ty', 'tz', 'tilt', 'dist']) assert.equal(cam[k], off[k], `${tag}: ${k}`);
          const f = cam.scale / off.scale;
          assert.ok(f <= 1 + 1e-12 && f > 0.8, `${tag}: zoom ${f}`);
          // zoomed out only as far as needed: the band then fills the space between the HUD bands less 1 px each end
          if (f < 1 - 1e-9) assert.ok(near(b.near - b.far, bottom - top - 2, 1e-6), `${tag}: fills the free space`);
          else assert.ok(near(b.near - b.far, b0.near - b0.far, 1e-6), `${tag}: pan only`);
        }
      }
    }
  });

  test('desktop viewports keep the official prep camera (16:9 is flush: bench on the shop bar, back row under the strip)', () => {
    for (const [w, h] of DESKTOPS) {
      const hud = hudAt(w, h);
      assert.deepEqual(presetCamera('prep', { width: w, height: h }, { hud }).params(), presetCamera('prep', { width: w, height: h }).params(), `prep ${w}×${h}`);
      // the Final Assault bench sits up to 1.2 px lower (under the bar's top edge at 16:9): nudged up < 3 px, no zoom
      for (const [side, cam] of cams('bossPrep', w, h, hud)) {
        const off = presetCamera('bossPrep', { width: w, height: h }, { side });
        assert.equal(cam.scale, off.scale, `bossPrep/${side} ${w}×${h}: no zoom`);
        assert.ok(cam.cy <= off.cy && off.cy - cam.cy < 3, `bossPrep/${side} ${w}×${h}: nudge ${off.cy - cam.cy}`);
      }
    }
    // other camera kinds ignore the HUD bands; the fitted (portrait) prep camera too
    for (const kind of ['normal', 'unite', 'boss', 'pen']) {
      assert.deepEqual(presetCamera(kind, { width: 844, height: 390 }, { hud: hudAt(844, 390) }).params(), presetCamera(kind, { width: 844, height: 390 }).params(), kind);
    }
    assert.deepEqual(presetCamera('prep', { width: 390, height: 844 }, { hud: hudAt(390, 844) }).params(), presetCamera('prep', { width: 390, height: 844 }).params(), 'portrait');
  });

  test('clearHud: unchanged when clear, pan when the band fits, zoom about the centre when it does not; garbage-safe', () => {
    const vp = { width: 1000, height: 500 };
    const keep = { near: 6.5, zNear: 0.16, far: 12.5, zFar: 0.42 };
    const cam = presetCamera('prep', vp);
    const b0 = band(cam, 'prep');
    const bandH = b0.near - b0.far;
    assert.equal(clearHud(cam, { top: b0.far - 10, bottom: vp.height - b0.near - 10 }, keep, vp), cam, 'clear → same object');
    assert.equal(clearHud(cam, { top: b0.far + 0.4, bottom: vp.height - b0.near + 0.4 }, keep, vp), cam, '≤ 0.5 px overlap is clear');
    // the bottom band reaches 30 px over the bench, 60 px free above: pan up by 31 px (1 px gap), no zoom
    const pan = clearHud(cam, { top: b0.far - 60, bottom: vp.height - b0.near + 30 }, keep, vp);
    assert.equal(pan.scale, cam.scale);
    assert.equal(pan.cx, cam.cx);
    assert.ok(near(pan.cy - cam.cy, -31, 1e-9), `pan ${pan.cy - cam.cy}`);
    // 5 px over the bench and only 6 px above the back row: the gap shrinks to half the spare pixel
    const tight = clearHud(cam, { top: b0.far - 6, bottom: vp.height - b0.near + 5 }, keep, vp);
    assert.equal(tight.scale, cam.scale);
    assert.ok(near(tight.cy - cam.cy, -5.5, 1e-9), `tight ${tight.cy - cam.cy}`);
    // top band over the back row: pan down
    const down = clearHud(cam, { top: b0.far + 20, bottom: 0 }, keep, vp);
    assert.ok(near(down.cy - cam.cy, 21, 1e-9));
    // both: zoom out about the centre column to fill [top + 1, H − bottom − 1]
    const hud = { top: b0.far + 20, bottom: vp.height - b0.near + 20 };
    const z = clearHud(cam, hud, keep, vp);
    const f = (bandH - 42) / bandH;
    assert.ok(near(z.scale / cam.scale, f, 1e-9), `zoom ${z.scale / cam.scale}`);
    const bz = band(z, 'prep');
    assert.ok(near(bz.far, hud.top + 1, 1e-6) && near(bz.near, vp.height - hud.bottom - 1, 1e-6));
    const c0 = cam.project(0, 9, 0), c1 = z.project(0, 9, 0);
    assert.ok(near(c1.x - vp.width / 2, f * (c0.x - vp.width / 2), 1e-6), 'x shrinks towards the centre');
    assert.ok(near(c1.s, f * c0.s, 1e-9), 'px per tile scales by f');
    // no usable space / bad input: the official camera
    for (const bad of [null, 'x', { top: 300, bottom: 300 }, { top: NaN, bottom: -5 }]) {
      const out = clearHud(cam, bad, keep, vp);
      assert.ok(out === cam || out.params().scale === cam.scale, JSON.stringify(bad));
      for (const v of Object.values(out.params())) assert.ok(Number.isFinite(v));
    }
    assert.equal(clearHud(cam, hud, null, vp), cam);
  });

  test('an adjusted camera picks, projects and lerps like any other (bench, raised and low tiles; three.js too)', () => {
    const heights = (r, c) => (r === 7 ? 0.16 : r === 12 && c === 4 ? 0.42 : 0);
    for (const [w, h] of [[844, 390], [800, 360]]) {
      const cam = presetCamera('prep', { width: w, height: h }, { hud: hudAt(w, h) });
      for (let r = 7; r <= 12; r++) for (let c = 0; c <= 10; c++) {
        const p = cam.project(c, r, heights(r, c));
        const t = pickTile(cam, p.x, p.y, heights, [0.42, 0.16, 0]);
        assert.deepEqual([t.row, t.col], [r, c], `${w}×${h} pick ${r},${c}`);
      }
      const three = syncThreeCamera(cam, new THREE.PerspectiveCamera(), w, h);
      const v = new THREE.Vector3();
      let worst = 0;
      for (let r = 0; r < 19; r++) for (let c = 0; c < 21; c++) {
        if (cam.depthOf(c, r, 0) < 0.5) continue;
        const p = cam.project(c, r, 0);
        v.set(c, r, 0).project(three);
        worst = Math.max(worst, Math.abs((v.x + 1) / 2 * w - p.x), Math.abs((1 - v.y) / 2 * h - p.y));
      }
      assert.ok(worst < 1e-6, `${w}×${h} three.js: ${worst} px`);
      const m = lerpCamera(presetCamera('normal', { width: w, height: h }), cam, 1).params();
      for (const [k, x] of Object.entries(cam.params())) assert.ok(near(m[k], x, 1e-9), k);
    }
  });
});

describe('three.js PerspectiveCamera equivalence (the 3D board layer)', () => {
  const kinds = ['prep', 'normal', 'unite', 'boss', 'pen', 'bossPrep'];

  test('every tile centre (ground and raised) projects to the same pixel through Camera and THREE', () => {
    for (const [W, H] of [[1920, 1080], [1280, 720], [1600, 1000], [900, 1300]]) {
      for (const kind of kinds) {
        const cam = presetCamera(kind, { width: W, height: H, padding: { top: 90, bottom: 180, left: 120, right: 40 } });
        const three = syncThreeCamera(cam, new THREE.PerspectiveCamera(), W, H);
        let worst = 0;
        const v = new THREE.Vector3();
        for (let r = 0; r < 19; r++) for (let c = 0; c < 21; c++) for (const z of [0, 0.16, 0.42]) {
          if (cam.depthOf(c, r, z) < 0.5) continue;
          const p = cam.project(c, r, z);
          v.set(c, r, z).project(three);
          const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
          worst = Math.max(worst, Math.abs(sx - p.x), Math.abs(sy - p.y));
        }
        assert.ok(worst < 1e-6, `${kind} ${W}×${H}: ${worst} px`);
      }
    }
  });

  test('screen → world agrees too (three ray vs Camera.unproject), lens shift included', () => {
    const W = 1280, H = 720;
    const cam = fitCamera({ r0: 9, r1: 12, c0: 0, c1: 10 }, { width: W, height: H, padding: { top: 200, left: 300 } });
    const three = syncThreeCamera(cam, new THREE.PerspectiveCamera(), W, H);
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    for (const [sx, sy] of [[640, 360], [100, 600], [1200, 150], [333, 444]]) {
      ray.setFromCamera(new THREE.Vector2((sx / W) * 2 - 1, 1 - (sy / H) * 2), three);
      assert.ok(ray.ray.intersectPlane(plane, hit));
      const w = cam.unproject(sx, sy, 0);
      assert.ok(near(w.x, hit.x, 1e-6) && near(w.y, hit.y, 1e-6), `${sx},${sy}`);
    }
  });

  test('threeCameraParams: fov / aspect / position / view offset', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const p = threeCameraParams(cam, 1920, 1080);
    assert.ok(near(p.fov, OFFICIAL.fovY, 1e-9));
    assert.ok(near(p.aspect, 1920 / 1080));
    assert.deepEqual(p.view, { fullWidth: 1920, fullHeight: 1080, offsetX: 0, offsetY: 0, width: 1920, height: 1080 });
    const pos = cam.position();
    assert.deepEqual(p.position.map((x) => Math.round(x * 1e9) / 1e9), [pos.x, pos.y, pos.z].map((x) => Math.round(x * 1e9) / 1e9));
    assert.ok(p.near > 0 && p.far > p.near);
  });
});
