// public/js/render/app/view.js — which field a camera shows, and the board box that follows it.

import { AREAS, areaFor } from '../board3d/layout.js';
import { normRect } from '../projection.js';

const VIEW_KINDS = new Set(['prep', 'normal', 'unite', 'boss', 'bossPrep', 'pen']);

/**
 * The field a camera request actually shows — what render/projection.js presetCamera frames: 'hidden' → 'boss';
 * a 'prep' camera asked for the boss rows (Final Assault prep: rect r1 ≤ 6) → 'bossPrep'; unknown kinds → 'normal'.
 * Drives the built 3D area, the drawn 2D rows and the lit rect, so they always match the camera.
 */
export function viewKind(kind, opts) {
  let k = kind === 'hidden' ? 'boss' : kind;
  if (!VIEW_KINDS.has(k)) k = 'normal';
  if (k === 'prep' && opts && opts.rect && normRect(opts.rect).r1 <= 6) k = 'bossPrep';
  return k;
}

/** 3D areas without the enemy preview pen block (the own field / both normal halves); see `boardArea`. */
const AREA_NO_PEN = Object.freeze({
  normal: Object.freeze(AREAS.normal.filter((a) => a.r1 <= 13)),
  unite: Object.freeze(AREAS.unite.filter((a) => a.r1 <= 13)),
});

/**
 * 3D area built for a view kind (viewKind): the enemy preview pen (rows 14–18) only for the 'pen' camera — the prep,
 * battle and 联防 cameras show the field alone (user playtest #2 item 6) with its separator rows 6 and 13 (the row-13
 * devices blow into the field: act2 m01's blowers, user playtest #5 item 6; the boss field's row-6 devices are drawn
 * with the boss field only — board3d/layout.js stageDevices); the boss kinds build the boss field.
 */
export function boardArea(vk) {
  if (vk === 'pen') return AREAS.normal;
  if (vk === 'prep' || vk === 'normal') return AREA_NO_PEN.normal.length ? AREA_NO_PEN.normal : AREAS.normal;
  if (vk === 'unite') return AREA_NO_PEN.unite.length ? AREA_NO_PEN.unite : AREAS.unite;
  return areaFor(vk);
}

/**
 * 2D rows drawn for a view kind: the pen rows (14–18) only for the 'pen' camera; the boss field with the separator
 * and the normal rows behind it as scenery.
 */
export function bandFor(kind) {
  if (kind === 'boss' || kind === 'hidden' || kind === 'bossPrep') return [0, 13];
  return kind === 'pen' ? [6, 18] : [6, 13];
}

/**
 * Active field rows [r0, r1] of a view kind for the 2D board (render/tiles.js `setView` field: drawn rows outside it are
 * dim scenery without devices): the normal / 联防 / prep fields live between the separator walls (rows 6–13, the
 * devices on the row-13 wall included; the row-6 wall's belong to the boss field — tiles.js _stageDevices); the pen
 * camera adds the pen (6–18); the boss field 0–6.
 */
export function fieldRows(kind) {
  return kind === 'boss' || kind === 'hidden' || kind === 'bossPrep' ? [0, 6] : kind === 'pen' ? [6, 18] : [6, 13];
}

/** Are the pen's figures shown for a view kind (a camera flight shows them when either end is the pen)? */
export const penShown = (vk, prevVk = null) => vk === 'pen' || prevVk === 'pen';

/** Is the prep's leader on the boss field shown for a view kind (a flight shows it when either end is the boss-field prep)? */
export const leaderShown = (vk, prevVk = null) => vk === 'bossPrep' || prevVk === 'bossPrep';

/** '2d' | '3d' | 'auto' board preference: `?board=` in the page URL (dev), else the view option. */
export function boardPreference(opt) {
  let q = null;
  try { q = new URLSearchParams(globalThis.location?.search || '').get('board'); } catch { /* no location */ }
  const v = q || opt;
  return v === '2d' || v === '3d' ? v : 'auto';
}

/**
 * A battle device box (render/units.js DeviceView `ctx.createBox()` contract: `{ mesh, update(cam, b), destroy() }`)
 * that follows the board layer: the 3D scene's crate mesh while `board()` returns a BoardScene, else the Pixi box of
 * the 2D board. A board switch mid-battle (lost WebGL context → 2D, or back to 3D) swaps the inner box on the next
 * update instead of leaving the crate on a dead scene. `mesh` is the Pixi mesh (null in 3D: nothing to add to Pixi).
 */
export function switchableBox({ board, pixi }) {
  let inner = null, owner;
  const drop = () => { try { inner?.destroy(); } catch { /* ignore */ } inner = null; owner = undefined; };
  return {
    get mesh() { return inner ? inner.mesh || null : null; },
    get inner() { return inner; },
    update(cam, b) {
      const scene = board() || null;
      if (!inner || owner !== scene || inner.destroyed) {
        drop();
        inner = scene ? scene.createDevice() : pixi();
        owner = scene;
      }
      inner?.update(cam, b);
    },
    destroy: drop,
  };
}
