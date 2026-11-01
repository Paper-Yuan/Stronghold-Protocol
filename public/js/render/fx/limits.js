// public/js/render/fx/limits.js — shared fx tunables used by more than one effect module.

// 画面质量五档（2026-10-29 加 ultra/extreme）：`particles.js` 用 `MAX_PARTICLES[quality] || MAX_PARTICLES.high`
// 兜底，所以新档必须在这里有值，否则超清/极致仍停在 1400 的粒子预算上。
const MAX_PARTICLES = { extreme: 2400, ultra: 1800, high: 1400, medium: 800, low: 360 };

const SKILL_GOLD = 0xffd45a;

const NO_OPTS = Object.freeze({});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const easeOut = (t) => 1 - (1 - t) * (1 - t);

export { MAX_PARTICLES, SKILL_GOLD, NO_OPTS, clamp, easeOut };
