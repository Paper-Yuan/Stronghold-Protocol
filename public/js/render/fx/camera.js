// public/js/render/fx/camera.js — shot heights and camera-relative world heights.

/**
 * Shot heights (GitHub #61): where a shot or beam leaves a unit (`launch`, ≈ its hands) and where shots, beams and lock
 * marks meet a unit (`aim`, ≈ its chest), as shares of the drawn model's height above the feet (`_headTiles`). The
 * models are upright screen billboards, so these are heights on screen, solved into world heights through the camera
 * (projection.js liftFor, `bodyZ`): 0.45 × the head height taken as a WORLD height drew at ≈ 18 % of the model under the
 * 30° pitch — shots left the hips and aimed at the targets' hips. [ASSUMED] the shares (a battle chibi's hands / chest;
 * the data has no official muzzle points).
 */
export const SHOT_HEIGHT = Object.freeze({ launch: 0.45, aim: 0.5 });

/** World height of the point `frac` of a unit's drawn model height above its feet (SHOT_HEIGHT), seen through `cam`. */
export function bodyZ(cam, v, frac) {
  const z0 = (v.z || 0) + (v.hover || 0);
  const h = (v._headTiles || 1.2) * frac;
  if (!cam || typeof cam.liftFor !== 'function') return z0 + h;
  const dz = cam.liftFor(v.x, v.y, z0, h * cam.scaleAt(v.x, v.y, z0));
  return Number.isFinite(dz) ? z0 + dz : z0 + h;
}

/** World height just above a unit's feet (where shells land). */
const feetZ = (v) => (v.z || 0) + (v.hover || 0) + 0.2;

/** Cheap fingerprint of a camera's framing (the damage-number layout cache is reused only while it is unchanged). */
const camKey = (c) => (c ? c.tx + c.ty * 1e3 + c.tz * 1e6 + c.tilt * 7.13 + c.dist * 1e4 + c.scale * 3.7e-2 + c.cx * 1.1e-5 + c.cy * 1.3e-8 : 0);

export { feetZ, camKey };
