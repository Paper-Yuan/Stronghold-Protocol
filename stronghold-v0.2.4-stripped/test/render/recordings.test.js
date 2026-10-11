// test/render/recordings.test.js — the recorded battles (tools/record-battle.mjs → public/dev/recordings) follow
// the wire format of DESIGN §8.2 exactly, and replay cleanly through the interpolation buffer at real speed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotBuffer } from '../../public/js/render/interp.js';
import { EV } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/dev/recordings');
const indexFile = path.join(DIR, 'index.json');
const has = existsSync(indexFile);
const index = has ? JSON.parse(readFileSync(indexFile, 'utf8')) : [];
const EV_KINDS = new Set(Object.values(EV));

describe('recordings', { skip: !has && 'no recordings (node tools/record-battle.mjs)' }, () => {
  test('index lists normal fields on ≥ 3 stages, a unite and a boss field', () => {
    const kinds = index.map((r) => r.kind);
    assert.ok(new Set(index.filter((r) => r.kind === 'normal').map((r) => r.stageId)).size >= 3);
    assert.ok(kinds.includes('unite'));
    assert.ok(kinds.includes('boss'));
    for (const r of index) assert.ok(existsSync(path.join(DIR, r.file)), r.file);
  });

  for (const meta of index) {
    test(`${meta.name}: wire format (m.field, b.snap, b.ev)`, () => {
      const rec = JSON.parse(readFileSync(path.join(DIR, meta.file), 'utf8'));
      const f = rec.field;
      assert.equal(typeof f.fieldId, 'string');
      assert.equal(f.kind, rec.kind);
      for (const k of ['r0', 'r1', 'c0', 'c1']) assert.ok(Number.isInteger(f.rect[k]));
      assert.ok(Array.isArray(f.units));
      const info = (u) => {
        for (const k of ['id', 'kind', 'side', 'defId', 'x', 'y', 'facing', 'maxHp']) assert.ok(u[k] !== undefined, `UnitInfo.${k}`);
        assert.ok(u.side === 'ally' || u.side === 'enemy');
      };
      f.units.forEach(info);
      let lastT = -Infinity;
      const ids = new Set(f.units.map((u) => u.id));
      for (const fr of rec.frames) {
        const s = fr.snap;
        assert.equal(s.fieldId, f.fieldId);
        assert.ok(s.t > lastT, 'snapshot time strictly increases');
        lastT = s.t;
        for (const u of s.units) {
          assert.equal(u.length, 9);
          for (const v of u) assert.ok(Number.isFinite(v), 'finite tuple values');
          // server/sim/snapshot.js sends ceil(hp) but round(maxHp): hp may exceed maxHp by 1 (the renderer clamps)
          assert.ok(u[3] >= 0 && u[3] <= u[4] + 1, 'hp within maxHp');
          assert.ok(u[1] >= f.rect.c0 - 1 && u[1] <= f.rect.c1 + 1 && u[2] >= f.rect.r0 - 1 && u[2] <= f.rect.r1 + 1, 'inside the rect');
        }
        for (const e of fr.ev) {
          assert.ok(EV_KINDS.has(e[0]), `known event ${e[0]}`);
          if (e[0] === 'spawn') { info(e[1]); ids.add(e[1].id); }
        }
        for (const u of s.units) assert.ok(ids.has(u[0]), `unit ${u[0]} announced (m.field or spawn) before its first snapshot`);
      }
    });

    test(`${meta.name}: replays through SnapshotBuffer at real speed without NaN or jumps`, () => {
      const rec = JSON.parse(readFileSync(path.join(DIR, meta.file), 'utf8'));
      const buf = new SnapshotBuffer();
      const out = new Map();
      const prev = new Map();
      let fi = 0, events = 0;
      const t0 = rec.frames[0].snap.t;
      const end = (rec.frames[rec.frames.length - 1].snap.t - t0) / 2 + 0.5;
      let maxStep = 0;
      for (let real = 0; real < end; real += 1 / 60) {
        while (fi < rec.frames.length && (rec.frames[fi].snap.t - t0) / 2 <= real) {
          buf.push(rec.frames[fi].snap, real);
          buf.pushEvents(rec.frames[fi].ev, real);
          fi++;
        }
        const rt = buf.update(real);
        if (!Number.isFinite(rt)) continue;
        events += buf.takeEvents(rt).length;
        buf.sample(rt, out);
        for (const [id, s] of out) {
          assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.hp), 'finite sample');
          const p = prev.get(id);
          if (p) {
            const d = Math.hypot(s.x - p.x, s.y - p.y);
            if (d < 2.4) maxStep = Math.max(maxStep, d); // teleports / redeploys excluded
          }
          prev.set(id, { x: s.x, y: s.y });
        }
      }
      assert.ok(events > 0);
      assert.ok(Math.abs(buf.rate - 2) < 0.2, `rate ≈ 2 (${buf.rate})`);
      // walking is ≤ ~0.1 tiles per 60 Hz frame; displacements (push/pull, dashes) move up to ~1 tile per snapshot
      // and are spread over ~3 frames by the lerp — anything bigger (but below the teleport cut) would be a bug
      assert.ok(maxStep < 0.6, `smooth motion (max step ${maxStep.toFixed(3)} tiles/frame)`);
    });
  }
});
