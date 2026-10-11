// render/fx.js — battle visual effects with pooling and hard caps (DESIGN §9).
//
//   projectiles  b.ev 'atk' by projKind (render/style.js PROJ): sniper tracers with a muzzle flash; arts / heal / enemy
//                orbs with a particle trail; bombs and lobs as shells on an arc with a ground shadow, a smoke trail and
//                an explosion; drone darts; 回环射手 boomerangs that spin out to the target and back to the thrower's
//                current position, gone when caught. Flight times from the sim's projectile speeds (/sim/constants.js
//                PROJECTILE_SPEEDS — the visual lands with the sim's hit), homing on the interpolated target; a burst
//                per kind on arrival; chain lightning (chain / chainHeal) and beams as short-lived jagged lines
//   hits         glow + sparks by damage type; a melee blow adds a slash crescent swept along the blow (attacker →
//                victim) in the hit colour; AoE ground rings for splash attackers
//   numbers      damage numbers (phys orange-white, arts purple, true white, heal green, elements orange) as
//                pooled BitmapText (per font); rapid same-style hits on a target merge into a running total; big hits
//                (≥ 18 % max HP) pop larger; ≤ 4 per target; laid out in screen space against every live number (lanes
//                beside the head, stacked upwards) so numbers of neighbouring units never cover or touch each other;
//                crowded spots get shorter lives (see number())
//   skill        activation burst: flash, a light pillar with a white-hot core, a shockwave + hex ring on the ground,
//                rising motes; while active a slowly turning hex with a soft glow under the unit (+ a few motes)
//   blasts       explosions (fireball, flash, shockwave + coloured ground ring, sparks, smoke; heavy ones add debris
//                and a scorch mark) for blast fx kinds and shell impacts
//   bombard      蕾缪安 S3: fx 'lock' keeps a reticle on the locked enemy until the 'bombard' of the shell fired at it
//                (or LOCK_T game s after the shooter's last lock / shell — a held S3 lock, `hold`, LOCK_T after her skill
//                ends: it waits with its bullets while nothing is in range; the S2 aim lock until the snipe's 'crit'); 'bombardShell' = a shell fired now that
//                lands on the spot after `t` game s — a launch streak leaves the shooter upwards and the shell drops out
//                of the sky onto the spot (a long flight climbs out of her first), a closing warning ring marks the spot
//                meanwhile; 'bombard' is the big explosion at the impact
//   deploy       drop-in ring + pillar; death dissolve embers; crate splinters; element bursts; leak vignette;
//                bond-layer glyph pops and bounty coins (screen space, near the top of the field)
// Sizes are in tiles × the camera's px per tile at the spot, so effects read alike at every resolution and zoom (3D
// board or 2D fallback: both project through the same camera). An fx anchored on a unit (extra.id) follows that
// unit's rendered position when the event happens on it, else it happens at the event's (x, y) (_where).
// Particles live in two ParticleContainers (additive / normal) sharing the FX atlas base texture, so the whole
// particle system costs two draw calls. Every pool has a cap; when full, the oldest entry is recycled. Particle,
// projectile and lock records are pooled (the per-frame emitters allocate nothing). Cosmetic extras — trails, muzzle
// flashes, afterimages, debris, scorch marks, aura motes — are skipped at quality 'low' and under heavy load
// (adaptive load level ≥ 2), and trails yield to bursts near the particle cap (SOFT_CAP).

//
// The bodies live in public/js/render/fx/*.js. Every name this file exported before the split is
// re-exported below, so existing imports keep working. speeds.js is imported first: its dynamic
// import('/sim/constants.js') is the module's one init side effect, as it was at the top of this file.

export { setSimProjectileSpeeds, projSpeed } from './fx/speeds.js';
export { SHOT_HEIGHT, bodyZ } from './fx/camera.js';
export { ensureDamageFonts } from './fx/fonts.js';
export { FX_KINDS, fxSpec, tilesAround, wallTiles } from './fx/kinds.js';
export { FxSystem } from './fx/system.js';
