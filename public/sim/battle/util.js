// server/sim/battle/util.js — small helpers shared by the Battle method modules (server/sim/battle/*.js).

/** Finite number or the default (content may pass undefined/NaN/Infinity/strings to helpers). */
export const fin = (v, d) => { const n = typeof v === 'number' ? v : (v == null || v === '' ? NaN : Number(v)); return Number.isFinite(n) ? n : d; };

export function clone(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  return o;
}
