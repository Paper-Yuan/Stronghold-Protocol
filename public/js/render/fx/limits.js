// public/js/render/fx/limits.js — shared fx tunables used by more than one effect module.

const MAX_PARTICLES = { high: 1400, medium: 800, low: 360 };

const SKILL_GOLD = 0xffd45a;

const NO_OPTS = Object.freeze({});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const easeOut = (t) => 1 - (1 - t) * (1 - t);

export { MAX_PARTICLES, SKILL_GOLD, NO_OPTS, clamp, easeOut };
