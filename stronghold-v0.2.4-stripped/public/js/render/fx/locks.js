// public/js/render/fx/locks.js — FxSystem lock reticles.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { SHOT_HEIGHT, bodyZ } from './camera.js';
import { FX_KINDS } from './kinds.js';
import { easeOut } from './limits.js';
import { UF } from '../../../../shared/constants.js';

/**
 * Lock reticle: how long (game s) a lock outlives the last sign of its shooter's S3 going on — its latest lock, shell or
 * bombard (a lock whose shell / shot never comes) — its fade-out (real s), and the most reticles kept at once (a long
 * S3: ammo grants / reloads lock far more than the 5 base shots, ≤ 33 shells).
 */
const LOCK_T = 5, LOCK_FADE = 0.2, MAX_LOCKS = 48;

export class FxLocks {
  // ---- lock-on reticles (蕾缪安) -------------------------------------------------------------------------------

  /**
   * fx 'lock': a reticle on the locked enemy (following its view; at the last spot once it is gone) until its shell
   * lands (mortar / _landed) or the aimed shot fires ('crit' from the same shooter); at most LOCK_T game seconds after
   * the shooter's last lock / shell / bombard (_touchLocks). A held lock (`hold`: 蕾缪安 S3, whose skill waits with its
   * bullets and locks while nothing is in range) waits as long as its shooter's skill runs (the view's UF.SKILL), its
   * LOCK_T counted from the skill's end.
   */
  _lock(view, src, x, y, z, hold = false) {
    let L = this.lockFree.pop();
    if (!L) {
      const P = this.P;
      const ring = new P.Sprite(this.tex.reticle);
      ring.anchor.set(0.5);
      ring.blendMode = P.BLEND_MODES.ADD;
      const core = new P.Sprite(this.tex.glow);
      core.anchor.set(0.5);
      core.blendMode = P.BLEND_MODES.ADD;
      this.projLayer.addChild(ring, core);
      L = { ring, core };
    }
    L.view = view; L.id = view ? view.id : null; L.src = src ?? null; L.x = x; L.y = y; L.z = z;
    L.t = 0; L.idle = 0; L.max = LOCK_T / this._ts(); L.out = -1; L.shell = false; L.sx = x; L.sy = y; L.hold = !!hold;
    L.ring.tint = L.core.tint = FX_KINDS.lock.c;
    L.ring.alpha = L.core.alpha = 0;
    L.ring.visible = L.core.visible = true;
    this.locks.push(L);
    if (this.locks.length > MAX_LOCKS) this._freeLock(this.locks.shift());
    return L;
  }

  /** Shooter `src` is still at it (a new lock, a shell, a bombard): its live locks restart their LOCK_T wait. */
  _touchLocks(src) {
    if (src == null) return;
    for (const L of this.locks) if (L.src === src) L.idle = 0;
  }

  /** The live lock of shooter `src` nearest to (x, y) within `within` tiles (`free`: only one no shell took yet). */
  _nearestLock(src, x, y, within, free) {
    let best = null, bd = Infinity;
    for (const L of this.locks) {
      if (L.out >= 0 || (free && L.shell) || (src != null && L.src != null && L.src !== src)) continue;
      const d = Math.hypot(L.x - x, L.y - y);
      if (d < bd - 1e-9) { bd = d; best = L; }
    }
    return best && bd <= within ? best : null;
  }

  /** Fade a lock out (it pops outwards as it goes). */
  _releaseLock(L) { if (L && L.out < 0) L.out = 0; }

  _freeLock(L) {
    L.ring.visible = L.core.visible = false;
    L.view = null;
    this.lockFree.push(L);
  }

  _updateLocks(dt) {
    if (!this.locks.length) return;
    const cam = this.ctx.cam();
    let w = 0;
    for (const L of this.locks) {
      L.t += dt;
      L.idle += dt;
      if (L.out < 0 && L.idle >= L.max) L.out = 0;
      // the shooter knocked out / withdrawn: the sim fires no more shells — only a shell already in the air still lands;
      // a held lock waits while its shooter's skill runs (蕾缪安 S3 with nothing in range: its bullets and locks wait)
      if (L.out < 0 && !L.shell && L.src != null && this.ctx.view) {
        const sv = this._viewOf(L.src);
        if (!sv || sv.alive === false) L.out = 0;
        else if (L.hold && (sv.flags & UF.SKILL)) L.idle = 0;
      }
      if (L.out >= 0) { L.out += dt; if (L.out >= LOCK_FADE) { this._freeLock(L); continue; } }
      const v = L.view;
      if (v && !v.destroyed && v.alive !== false) { L.x = v.x; L.y = v.y; L.z = bodyZ(cam, v, SHOT_HEIGHT.aim); }
      const p = cam.project(L.x, L.y, L.z, this._p);
      const s = p.s;
      const out = L.out >= 0 ? L.out / LOCK_FADE : 0;
      const pop = L.t < 0.16 ? 1.7 - 0.7 * easeOut(L.t / 0.16) : 1 + 0.05 * Math.sin(L.t * 9);
      const a = (L.out >= 0 ? 1 - out : Math.min(1, L.t / 0.06));
      L.ring.position.set(p.x, p.y);
      L.ring.rotation = L.t * 1.8;
      L.ring.scale.set((s * 0.95 * pop * (1 + out * 0.6)) / 128);
      L.ring.alpha = 0.95 * a;
      L.core.position.set(p.x, p.y);
      L.core.scale.set(((s * 0.4) / 128) * (1 + 0.25 * Math.sin(L.t * 14)));
      L.core.alpha = 0.7 * a;
      this.locks[w++] = L;
    }
    this.locks.length = w;
  }
}
