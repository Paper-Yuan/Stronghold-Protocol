// render/board3d/benchDeck.js — the 整备区 deck height the OFFICIAL SCENE ART draws, per stage and bench row.
//
// The procedural board stands every bench piece on TILE_H.bench (render/style.js = 0.16): its own pads are that high and
// 2D picking (tiles.js heightAt) agrees. An official scene pack (board3d/load.js loadScenePack) draws no such pads — it
// paints its own deck, and that deck is higher than 0.16 in every shipped pack, so a bench piece held at TILE_H.bench
// sinks ~0.30 into the art (render/app.js boardWorld, owner 2026-10-30: 「手牌棋子的脚陷进木台里」).
//
// Measured 2026-10-30 on public/assets/local/scene/*/scene.bin (tools/local-extract scenes.py writes board space:
// x = column, y = row, z = height): the top z of the up-facing triangles inside each tile, per bench row. Row 7 (the
// bench deck, cols 0..9) and row 8 (the EQUIPMENTS band the 炸惊 bench's second row, idx 10..19, sits on):
//
//   stage                 row 7 (deck)   row 8 (band)   notes
//   act1autochess_m01…m07 0.46           0.38           desert packs (bench deck flat at 0.461)
//   act2autochess_m01     0.37           0.37           city pack (flat 0.372)
//   act2autochess_m02/m04 0.46           0.38           desert
//   act2autochess_m03     0.21           0.21           the low deck of that map (flat 0.207)
//
// A stage with no scene pack (or one extracted after this measurement) keeps TILE_H.bench — the procedural pads' own
// height — so the 2D board / a missing-art install never changes.
import { GEO } from '../../../shared/constants.js';

const DECK = GEO.HAND_ROW;

/** @type {Readonly<Record<string, readonly [number, number]>>} stage id → [deck top of row 7, band top of row 8] */
const ART_DECK = Object.freeze({
  act1autochess_m01: Object.freeze([0.46, 0.38]),
  act1autochess_m02: Object.freeze([0.46, 0.38]),
  act1autochess_m03: Object.freeze([0.46, 0.38]),
  act1autochess_m04: Object.freeze([0.46, 0.38]),
  act1autochess_m05: Object.freeze([0.46, 0.38]),
  act1autochess_m06: Object.freeze([0.46, 0.38]),
  act1autochess_m07: Object.freeze([0.46, 0.38]),
  act2autochess_m01: Object.freeze([0.37, 0.37]),
  act2autochess_m02: Object.freeze([0.46, 0.38]),
  act2autochess_m03: Object.freeze([0.21, 0.21]),
  act2autochess_m04: Object.freeze([0.46, 0.38]),
});

/**
 * Deck top (board z) of a bench row of this stage's official scene, or null when the stage has no measured pack (the
 * caller then falls back to TILE_H.bench, the procedural pads' height).
 * @param {string|null|undefined} stageId `data/stages.json` key
 * @param {number} row board row of the bench slot (shared/constants.js benchTileOf)
 * @returns {number|null}
 */
export function benchDeckZ(stageId, row) {
  const e = typeof stageId === 'string' ? ART_DECK[stageId] : null;
  if (!e || !Number.isFinite(row)) return null;
  const i = Math.trunc(row) - DECK;
  return i >= 0 && i < e.length ? e[i] : null;
}
