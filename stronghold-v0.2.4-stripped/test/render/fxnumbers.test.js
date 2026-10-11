// test/render/fxnumbers.test.js — damage-number layout of render/fx.js (FxSystem.number / _updateNums) without PIXI:
// numbers of different styles landing on one unit in quick succession must never be drawn on top of each other
// (an arts '41' and a phys '509' 0.1 s apart used to read as one '41509').

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

class FakeText {
  constructor(text) {
    this.text = text;
    this.visible = true;
    this.alpha = 1;
    this.anchor = { set() {} };
    this.scale = { x: 1, set: (v) => { this.scale.x = v; } };
    this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
  }
  destroy() { this.destroyed = true; }
}

function fakeFx(cam) {
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    P: { BitmapText: FakeText },
    ctx: { cam: () => cam, layers: { text: { addChild() {} } }, settings: {} },
    nums: [], numFree: [], time: 0,
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
  });
  return fx;
}

// screen box of a number (BitmapText, anchor 0.5/1, fontSize 24 × scale): digits ≈ 0.55 em wide, ≈ 0.8 em tall
function box(t) {
  const sc = t.text.scale.x;
  const w = String(t.text.text).length * 24 * 0.55 * sc, h = 24 * 0.8 * sc;
  const { x, y } = t.text.position;
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y };
}
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function run(fx, hits, dur = 1.2, dt = 1 / 60) {
  const sorted = [...hits].sort((a, b) => a.t - b.t);
  let worst = null;
  for (let t = 0; t <= dur; t += dt) {
    while (sorted.length && sorted[0].t <= t + 1e-9) {
      const h = sorted.shift();
      fx.number(h.view, h.n, h.style, !!h.big);
    }
    fx._updateNums(dt);
    fx.time += dt;
    const live = fx.nums.filter((n) => n.text.visible && n.text.alpha > 0.35);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (live[i].unit !== live[j].unit) continue;
        if (overlap(box(live[i]), box(live[j]))) worst = worst || { t: +t.toFixed(3), a: live[i].text.text, b: live[j].text.text, A: box(live[i]), B: box(live[j]) };
      }
    }
  }
  return worst;
}

describe('damage numbers on one unit', () => {
  for (const [label, vp] of [['1920×1080', { width: 1920, height: 1080 }], ['1280×720', { width: 1280, height: 720 }]]) {
    test(`an arts and a phys number 0.05–0.3 s apart never overlap (${label})`, () => {
      const cam = presetCamera('normal', vp);
      for (let i = 0; i <= 10; i++) {
        const gap = 0.05 + i * 0.025;
        const fx = fakeFx(cam);
        const drone = { x: 9, y: 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
        const bad = run(fx, [{ view: drone, n: 41, style: 'arts', t: 0 }, { view: drone, n: 509, style: 'phys', t: gap }]);
        assert.equal(bad, null, `gap ${gap.toFixed(3)} s: ${JSON.stringify(bad)}`);
      }
    });
  }

  test('a burst of mixed styles (phys/arts/true/elem/heal) stays readable', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const u = { x: 6, y: 10, z: 0, _headTiles: 1.2, maxHp: 5000 };
    const styles = ['phys', 'arts', 'true', 'elem', 'heal', 'phys', 'arts'];
    const bad = run(fx, styles.map((style, i) => ({ view: u, n: 100 + i * 37, style, t: i * 0.09 })));
    assert.equal(bad, null, JSON.stringify(bad));
  });

  test('a unit under heavy mixed fire (≈ 8 numbers/s, big hits included) keeps its numbers apart', () => {
    for (const [kind, vp] of [['normal', { width: 1920, height: 1080 }], ['normal', { width: 1280, height: 720 }], ['boss', { width: 1920, height: 1080 }]]) {
      const cam = presetCamera(kind, vp);
      const fx = fakeFx(cam);
      const u = { x: 8, y: kind === 'boss' ? 4 : 9, z: 0, _headTiles: 1.2, maxHp: 3000 };
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const dt = 1 / 60;
      let frames = 0, bad = 0;
      const saved = Math.random;
      Math.random = rnd;
      try {
        for (let t = 0; t < 20; t += dt) {
          if (rnd() < dt / 0.3) fx.number(u, Math.floor(rnd() * 3000) + 1, 'phys', rnd() < 0.2);
          if (rnd() < dt / 0.45) fx.number(u, Math.floor(rnd() * 900) + 1, 'arts', rnd() < 0.1);
          if (rnd() < dt / 0.8) fx.number(u, Math.floor(rnd() * 400) + 1, 'heal', false);
          if (rnd() < dt / 1.1) fx.number(u, Math.floor(rnd() * 12000) + 1, 'elem', rnd() < 0.5);
          fx._updateNums(dt);
          fx.time += dt;
          frames++;
          const live = fx.nums.filter((n) => n.text.visible && n.text.alpha > 0.35);
          let hit = false;
          for (let i = 0; i < live.length && !hit; i++) for (let j = i + 1; j < live.length; j++) if (overlap(box(live[i]), box(live[j]))) { hit = true; break; }
          if (hit) bad++;
        }
      } finally { Math.random = saved; }
      assert.ok(bad <= frames * 0.01, `${kind} ${vp.width}: ${bad}/${frames} frames with overlapping numbers`);
    }
  });

  test('same-style hits within the merge window still merge into one number', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const u = { x: 6, y: 10, z: 0, _headTiles: 1.2, maxHp: 5000 };
    fx.number(u, 120, 'phys', false);
    fx._updateNums(0.05); fx.time += 0.05;
    fx.number(u, 80, 'phys', false);
    assert.equal(fx.nums.length, 1);
    assert.equal(fx.nums[0].text.text, '200');
  });

  test('numbers on different units are independent (no stacking lift)', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const a = { x: 4, y: 10, z: 0, _headTiles: 1.2, maxHp: 5000 }, b = { x: 8, y: 10, z: 0, _headTiles: 1.2, maxHp: 5000 };
    fx.number(a, 10, 'phys', false);
    fx.number(b, 10, 'arts', false);
    assert.equal(fx.nums[0].z0, fx.nums[1].z0);
  });

  test('a long column is capped: it never climbs more than a few lines above the head', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const u = { x: 6, y: 10, z: 0, _headTiles: 1.2, maxHp: 5000 };
    for (let i = 0; i < 30; i++) {
      fx.number(u, 10 + i, ['phys', 'arts', 'true', 'elem'][i % 4], false);
      fx._updateNums(0.03); fx.time += 0.03;
    }
    const s = cam.project(u.x, u.y, 0).s;
    const line = 24 * 0.95 * Math.min(1.05, Math.max(0.42, s / 115)) * 1.35;
    for (const n of fx.nums) assert.ok(-n.oy <= line * 5 + 1e-6, `oy ${n.oy} (line ${line})`);
    assert.ok(fx.nums.filter((n) => !n.fading).length <= 4, 'at most 4 live numbers per unit');
  });
});

// every live, readable number against every other one (any unit): boxes must not touch (a 2 px margin — two numbers
// side by side read as one, the '41509' / '201625' screenshots)
function overlapsAll(fx, margin = 2) {
  const live = fx.nums.filter((n) => n.text.visible && n.text.alpha > 0.35);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = box(live[i]), B = box(live[j]);
      if (A.x0 - margin < B.x1 && B.x0 - margin < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) return { a: live[i].text.text, b: live[j].text.text, A, B };
    }
  }
  return null;
}

describe('damage numbers across units (screen-space layout)', () => {
  for (const [label, kind, vp] of [['boss 1920', 'boss', { width: 1920, height: 1080 }], ['normal 1280', 'normal', { width: 1280, height: 720 }]]) {
    test(`a knot of units on one spot (a boss and 4 minions) under rapid mixed hits: numbers never touch (${label})`, () => {
      const cam = presetCamera(kind, vp);
      const fx = fakeFx(cam);
      const y = kind === 'boss' ? 3 : 10;
      const units = [
        { x: 7.2, y, z: 0, _headTiles: 2.2, maxHp: 400000 },
        { x: 7.35, y: y - 0.1, z: 0, _headTiles: 1.0, maxHp: 6000 },
        { x: 7.1, y: y - 0.2, z: 0, _headTiles: 1.0, maxHp: 6000 },
        { x: 7.5, y: y + 0.1, z: 0, _headTiles: 1.2, maxHp: 6000 },
        { x: 8.1, y, z: 0, _headTiles: 1.2, maxHp: 12000 },
      ];
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const dt = 1 / 60;
      let frames = 0, bad = 0, first = null;
      for (let t = 0; t < 15; t += dt) {
        for (let k = 0; k < 3; k++) {
          if (rnd() > dt / 0.1) continue;
          const i = (rnd() * units.length) | 0;
          const boss = i === 0;
          fx.number(units[i], boss ? 2000 + ((rnd() * 200000) | 0) : 40 + ((rnd() * 900) | 0), ['phys', 'arts', 'true', 'elem', 'heal'][(rnd() * 5) | 0], rnd() < 0.15);
        }
        fx._updateNums(dt);
        fx.time += dt;
        frames++;
        const o = overlapsAll(fx);
        if (o) { bad++; first = first || { t: +t.toFixed(2), ...o }; }
      }
      assert.ok(bad <= frames * 0.01, `${bad}/${frames} frames with touching numbers; first ${JSON.stringify(first)}`);
    });
  }

  test("two neighbours hit at once: '41' and '509' are placed apart (never side by side as '41509')", () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    for (let i = 0; i <= 8; i++) {
      const fx = fakeFx(cam);
      const a = { x: 7, y: 10, z: 0, _headTiles: 1.2, maxHp: 3000 }, b = { x: 7 + i * 0.1, y: 10, z: 0, _headTiles: 1.2, maxHp: 3000 };
      fx.number(a, 41, 'arts', false);
      fx._updateNums(0.02); fx.time += 0.02;
      fx.number(b, 509, 'phys', false);
      for (let f = 0; f < 60; f++) {
        fx._updateNums(1 / 60); fx.time += 1 / 60;
        const o = overlapsAll(fx, 4);
        assert.equal(o, null, `offset ${i * 0.1}: ${JSON.stringify(o)}`);
      }
    }
  });

  test('rapid same-style hits merge into a running total that stays up while the hits go on', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const u = { x: 6, y: 10, z: 0, _headTiles: 1.2, maxHp: 50000 };
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      fx.number(u, 100 + i, 'phys', false);
      sum += 100 + i;
      for (let f = 0; f < 6; f++) { fx._updateNums(1 / 60); fx.time += 1 / 60; }
    }
    const phys = fx.nums.filter((n) => n.style === 'phys');
    assert.equal(phys.length, 1);
    assert.equal(phys[0].text.text, String(sum));
    assert.ok(phys[0].end > 0.9, `life extended (${phys[0].end})`);
    // a pause longer than the merge gap starts a new number
    for (let f = 0; f < 24; f++) { fx._updateNums(1 / 60); fx.time += 1 / 60; }
    fx.number(u, 7, 'phys', false);
    assert.equal(fx.nums.filter((n) => n.style === 'phys').length, 2);
  });

  test('crowded spots fade faster; the per-font pools are reused (no new text objects once warm)', () => {
    const cam = presetCamera('unite', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const units = Array.from({ length: 8 }, (_, i) => ({ x: 8 + (i % 4) * 0.4, y: 10 + (i >> 2) * 0.4, z: 0, _headTiles: 1.2, maxHp: 5000 }));
    for (let i = 0; i < 8; i++) fx.number(units[i], 100 + i, 'arts', false);
    const lives = fx.nums.map((n) => n.end);
    assert.ok(Math.min(...lives) < Math.max(...lives), `shorter lives when crowded: ${lives}`);
    let made = 0;
    const Orig = fx.P.BitmapText;
    fx.P.BitmapText = class extends Orig { constructor(...a) { super(...a); made++; } };
    for (let f = 0; f < 120; f++) { fx._updateNums(1 / 60); fx.time += 1 / 60; }
    for (let i = 0; i < 8; i++) fx.number(units[i], 50 + i, 'arts', false);
    assert.equal(made, 0, 'recycled from the arts pool');
  });
});

describe('damage numbers under heavy AoE (review regression: cost per hit, readability)', () => {
  // a projection-counting camera: the layout of the live numbers must happen once per frame, not once per hit
  function countingCam(kind, vp) {
    const cam = presetCamera(kind, vp);
    const project = cam.project.bind(cam);
    cam.calls = 0;
    cam.project = (...a) => { cam.calls++; return project(...a); };
    return cam;
  }
  for (const layout of ['spread', 'knot']) {
    test(`60 enemies (${layout}) hit twice each in one frame, every 0.1 s: O(hits) projections per frame, numbers never touch`, () => {
      const cam = countingCam('unite', { width: 1920, height: 1080 });
      const fx = fakeFx(cam);
      const units = [];
      for (let i = 0; i < 60; i++) {
        units.push(layout === 'knot' ? { x: 12 + (i % 5) * 0.2, y: 10 + ((i / 5) | 0) * 0.1, z: 0, _headTiles: 1.2 } : { x: 1 + (i % 20), y: 9 + ((i / 20) | 0) + 0.3, z: 0, _headTiles: 1.2 });
      }
      const dt = 1 / 60;
      let worstPerHit = 0, bad = 0, frames = 0, maxLive = 0;
      for (let f = 0; f < 240; f++) {
        if (f % 6 === 0) {
          const before = cam.calls;
          for (const u of units) { fx.number(u, 100 + ((f * 7) % 900), 'arts', false); fx.number(u, 50 + ((f * 3) % 500), 'phys', false); }
          worstPerHit = Math.max(worstPerHit, (cam.calls - before) / 120);
        }
        fx._updateNums(dt);
        fx.time += dt;
        frames++;
        maxLive = Math.max(maxLive, fx.nums.length);
        if (overlapsAll(fx)) bad++;
        // every entry of the list is a live number (displaced ones are released at once, never left as obstacles)
        assert.ok(fx.nums.every((n) => n.text.visible), 'no released number stays in the live list');
      }
      // 2 projections for the hit itself + one layout of ≤ 90 live numbers per frame (spread over 120 hits) — the
      // per-hit relayout this replaces cost ≈ 2 + 90 per hit
      assert.ok(worstPerHit < 4, `projections per hit ${worstPerHit.toFixed(2)}`);
      assert.ok(maxLive <= 90, `live numbers ${maxLive}`);
      assert.ok(bad <= frames * 0.02, `${bad}/${frames} frames with touching numbers`);
    });
  }

  test('a merged running total grows its box at once: the next hit of the same frame does not land on its digits', () => {
    const cam = presetCamera('normal', { width: 1920, height: 1080 });
    const fx = fakeFx(cam);
    const a = { x: 6, y: 10, z: 0, _headTiles: 1.2 }, b = { x: 6.35, y: 10, z: 0, _headTiles: 1.2 };
    fx.number(a, 9, 'phys', false);
    fx._updateNums(0.02); fx.time += 0.02;
    const w0 = fx.nums[0]._w;
    fx.number(a, 99990, 'phys', false);           // merges: '99999' (5 digits instead of 1)
    assert.equal(fx.nums.length, 1);
    assert.ok(fx.nums[0]._w > w0 * 2, 'box re-sized with the merge');
    fx.number(b, 777, 'arts', false);             // same frame: laid out against the grown box
    fx._updateNums(0.001); fx.time += 0.001;
    assert.equal(overlapsAll(fx), null);
  });
});
