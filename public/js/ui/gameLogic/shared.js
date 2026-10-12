// ui/gameLogic/shared.js — small helpers and seat order. Public names are re-exported from ../gameLogic.js.

// ---- small helpers -------------------------------------------------------------------------------

export const isObj = (v) => !!v && typeof v === 'object';
export const int = (v, d = 0) => (Number.isInteger(v) ? v : d);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Stable key of a board tile. */
export const tileKey = (row, col) => `${row},${col}`;

/** Players sorted by seat (nulls dropped). */
export function sortedPlayers(pub) {
  const list = Array.isArray(pub?.players) ? pub.players.filter(isObj) : [];
  return [...list].sort((a, b) => int(a.seat, 99) - int(b.seat, 99));
}

/**
 * The config's rounds row the current round's timers come from.
 * @param {any} pub m.public
 * @param {any} config data/config.json
 * @returns {any|null}
 */
export function roundCfgRow(pub, config) {
  const modes = isObj(config?.modes) ? config.modes : null;
  const mode = modes ? modes[pub?.modeId] : null;
  const rounds = isObj(mode?.rounds) ? mode.rounds : null;
  if (!rounds || !isObj(pub)) return null;
  return isObj(rounds[String(pub.round)]) ? rounds[String(pub.round)] : null;
}
