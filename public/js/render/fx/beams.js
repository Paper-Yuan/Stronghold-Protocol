// public/js/render/fx/beams.js — FxSystem beams and the 炎佑 fire jet.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { SHOT_HEIGHT } from './camera.js';

// 炎佑 fire jet: real s a jet burns past its tick's `dur` (the next 1 game s tick re-aims and extends it before it fades:
// one continuous stream), its fade-out, the most jets at once, the fire colours
const FLAME_TAIL = 0.2, FLAME_FADE = 0.15, MAX_FLAMES = 8;

const FLAME_TINTS = Object.freeze([0xffd27a, 0xffa94d, 0xff8a3d, 0xff5a2a]);

export class FxBeams {
  /** A beam from view `a` to view `b`; `chain`: a bounce, `a` is the previous target (it leaves from its chest). */
  _beam(a, b, color, dur = 0.22, jitter = 1, chain = false) {
    this.beamList.push({ a, b, color, t: 0, dur, jitter, chain, seed: Math.random() * 1000 });
    if (this.beamList.length > 40) this.beamList.shift();
    const q = this._bodyPt(b, SHOT_HEIGHT.aim, this._g);
    this.particle('flare', q.x, q.y, { tint: color, life: 0.16, s0: (q.s / 128) * 0.7, s1: (q.s / 128) * 0.25, a0: 1, a1: 0, rot: Math.random() });
  }

  _updateBeams(dt) {
    const g = this.beams;
    g.clear();
    let w = 0;
    const p = this._p, q = this._q;
    for (const bm of this.beamList) {
      bm.t += dt;
      if (bm.t >= bm.dur || !bm.a || !bm.b) continue;
      // a chain bounce leaves the previous target where the shot met it (its chest), a beam leaves the shooter's hands
      this._bodyPt(bm.a, bm.chain ? SHOT_HEIGHT.aim : SHOT_HEIGHT.launch, p); const px = p.x, py = p.y, s = p.s;
      this._bodyPt(bm.b, SHOT_HEIGHT.aim, q);
      const k = 1 - bm.t / bm.dur;
      const segs = 7;
      // soft glow, coloured body, white-hot core
      for (let pass = 0; pass < 3; pass++) {
        const wd = pass === 0 ? s * 0.16 : pass === 1 ? s * 0.065 : s * 0.026;
        g.lineStyle(Math.max(1, wd), pass === 2 ? 0xffffff : bm.color, (pass === 0 ? 0.22 : pass === 1 ? 0.6 : 0.95) * k);
        g.moveTo(px, py);
        for (let i = 1; i < segs; i++) {
          const f = i / segs;
          const j = Math.sin(bm.seed + i * 12.9 + bm.t * 40) * s * 0.12 * (bm.jitter ?? 1);
          g.lineTo(px + (q.x - px) * f + j, py + (q.y - py) * f - j * 0.5);
        }
        g.lineTo(q.x, q.y);
      }
      this.beamList[w++] = bm;
    }
    this.beamList.length = w;
  }

  // ---- fire jets (炎佑 祛恶之焰) ---------------------------------------------------------------------------------

  /**
   * fx 'yanyouFlame' (sim/content/tokens.js yanyouKit; user playtest #4 item 12 "一段持续时间的喷火"): the sim emits one
   * event per game second of the channel; each keeps the jet of dragon `srcId` burning for `dur` real s + FLAME_TAIL
   * onto its locked target `tgtId` (else the spot (x, y)), so the 1 s ticks join into ONE continuous stream, with a
   * burning disc of radius `r` tiles following the target. One jet per dragon (a new tick re-aims and extends it).
   */
  _flame(srcId, tgtId, x, y, r, col, dur) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let F = srcId != null ? this.flames.find((f) => f.src === srcId) : null;
    if (!F) {
      const P = this.P;
      const disc = new P.Sprite(this.tex.soft);
      disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.alpha = 0;
      const edge = new P.Sprite(this.tex.ring);
      edge.anchor.set(0.5); edge.blendMode = P.BLEND_MODES.ADD; edge.alpha = 0;
      F = { src: srcId, disc, edge, t: 0, end: 0, jet: 0, fire: 0, smoke: 0, seed: Math.random() * 100 };
      this.flames.push(F);
      if (this.flames.length > MAX_FLAMES) this._freeFlame(this.flames.shift());
    }
    F.tgt = tgtId; F.x = x; F.y = y; F.z = this._groundZ(x, y); F.r = r; F.col = col;
    F.end = Math.max(F.end, F.t + dur + FLAME_TAIL);
    F.disc.tint = F.edge.tint = col;
  }

  _freeFlame(F) { F.disc.destroy(); F.edge.destroy(); }

  _updateFlames(dt) {
    if (!this.flames.length) return;
    const cam = this.ctx.cam();
    const g = this.beams;          // drawn after _updateBeams cleared it
    const p = this._p, q = this._q, m = this._g;
    const low = this.quality === 'low';
    let w = 0;
    for (const F of this.flames) {
      F.t += dt;
      const sv = this._viewOf(F.src);
      // the channel is over (no tick kept it going) or the dragon is gone
      if (F.t >= F.end || (F.src != null && this.ctx.view && (!sv || sv.alive === false))) { this._freeFlame(F); continue; }
      const tv = this._viewOf(F.tgt);
      if (tv && tv.alive !== false && Number.isFinite(tv.x) && Number.isFinite(tv.y)) { F.x = tv.x; F.y = tv.y; F.z = tv.z || 0; }
      const fade = Math.min(1, F.t / 0.12, (F.end - F.t) / FLAME_FADE);
      const flick = 0.82 + 0.18 * Math.sin(F.t * 23 + F.seed) * Math.sin(F.t * 7.3);
      // burning disc on the ground around the target
      this._onGround(F.disc, F.y, F.z); this._onGround(F.edge, F.y, F.z);
      cam.project(F.x, F.y, F.z + 0.02, p);
      cam.project(F.x, F.y + F.r, F.z + 0.02, q);
      const cx = p.x, cy = p.y, s = p.s;
      const rx = s * F.r, ry = Math.max(1, cy - q.y);
      F.disc.position.set(cx, cy); F.disc.scale.set((rx * 2) / 128, (ry * 2) / 128); F.disc.alpha = 0.5 * fade * flick;
      F.edge.position.set(cx, cy); F.edge.scale.set((rx * 2.05) / 128, (ry * 2.05) / 128); F.edge.alpha = 0.7 * fade * flick;
      // flame tongues and embers rising from the disc
      F.fire += dt * (low ? 14 : 34) * fade;
      while (F.fire >= 1) {
        F.fire -= 1;
        if (!this._room()) { F.fire = 0; break; }
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.9;
        const px = cx + Math.cos(a) * rx * d, py = cy + Math.sin(a) * ry * d;
        const ember = Math.random() < 0.3;
        const po = this._o();
        po.tint = ember ? 0xffd27a : FLAME_TINTS[(Math.random() * FLAME_TINTS.length) | 0];
        po.vx = (Math.random() - 0.5) * s * 0.3; po.vy = -s * (ember ? 1.6 : 0.9 + Math.random() * 0.6); po.drag = ember ? 0.5 : 1.5;
        po.life = ember ? 0.7 : 0.35 + Math.random() * 0.25;
        po.s0 = (s / 128) * (ember ? 0.06 : 0.28 + Math.random() * 0.12); po.s1 = (s / 128) * (ember ? 0.02 : 0.08);
        po.a0 = 0.9; po.a1 = 0; po.fadeIn = 0.05;
        this.particle(ember ? 'dot' : 'soft', px, py, po);
      }
      if (this.rich) {
        F.smoke += dt * 5 * fade;
        while (F.smoke >= 1) {
          F.smoke -= 1;
          if (!this._room()) { F.smoke = 0; break; }
          const po = this._o();
          po.add = false; po.tint = 0x3a3430; po.vx = (Math.random() - 0.5) * s * 0.2; po.vy = -s * 0.5; po.drag = 1;
          po.life = 0.9; po.s0 = (s / 128) * 0.35; po.s1 = (s / 128) * 0.8; po.a0 = 0.32; po.a1 = 0; po.fadeIn = 0.15;
          this.particle('smoke', cx + (Math.random() - 0.5) * rx, cy - s * 0.2, po);
        }
      }
      // the jet: from the dragon's chest onto the target (its chest; the disc centre without a target view)
      if (sv) {
        this._chest(sv, m);
        const mx = m.x, my = m.y;
        if (tv && tv.alive !== false) this._chest(tv, q); else { q.x = cx; q.y = cy - s * 0.15; }
        const tx = q.x, ty = q.y;
        const segs = 6;
        for (let pass = 0; pass < 3; pass++) {
          const col = pass === 2 ? 0xfff2c0 : pass === 1 ? 0xffb347 : F.col;
          const alpha = (pass === 0 ? 0.3 : pass === 1 ? 0.55 : 0.8) * fade * flick;
          let x0 = mx, y0 = my;
          for (let i = 1; i <= segs; i++) {
            const f = i / segs;
            // widens towards the target (a cone of fire), wobbling
            const wd = s * (pass === 0 ? 0.1 + 0.22 * f : pass === 1 ? 0.05 + 0.1 * f : 0.02 + 0.03 * f);
            const j = i < segs ? Math.sin(F.seed + i * 3.1 + F.t * 30) * s * 0.05 * f : 0;
            const x1 = mx + (tx - mx) * f + j, y1 = my + (ty - my) * f - j * 0.5;
            g.lineStyle(Math.max(1, wd), col, alpha);
            g.moveTo(x0, y0); g.lineTo(x1, y1);
            x0 = x1; y0 = y1;
          }
        }
        // fire puffs streaming along it
        F.jet += dt * (low ? 18 : 42) * fade;
        const T = 0.2;
        while (F.jet >= 1) {
          F.jet -= 1;
          if (!this._room()) { F.jet = 0; break; }
          const a = Math.random() * Math.PI * 2, d = Math.random() * 0.5;
          const gx = tx + Math.cos(a) * rx * d, gy = ty + Math.sin(a) * ry * d;
          const po = this._o();
          po.tint = FLAME_TINTS[(Math.random() * FLAME_TINTS.length) | 0];
          po.vx = (gx - mx) / T; po.vy = (gy - my) / T;
          po.life = T * (0.9 + Math.random() * 0.3);
          po.s0 = (s / 128) * 0.1; po.s1 = (s / 128) * (0.38 + Math.random() * 0.2); po.a0 = 0.85; po.a1 = 0.15;
          this.particle('soft', mx, my, po);
        }
      }
      this.flames[w++] = F;
    }
    this.flames.length = w;
  }
}
