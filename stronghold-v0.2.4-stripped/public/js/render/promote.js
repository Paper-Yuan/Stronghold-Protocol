// public/js/render/promote.js — which prep pieces were just promoted (精锐晋升), for the merge cue of render/app.js setPrep.
//
// A merge replaces the consumed normal copies by ONE new elite piece in the same m.private update: on the board tile of
// the consumed copy that deploys first when a copy was deployed (PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至
// 作战区对应位置"; server board.js mergeTile), else in the hand / temp. So a promotion = a chess piece with a new uid that is
// an elite, while normal copies of the same operator (same baseId) vanished from the previous state. The cue then plays
// on the elite (fx.promote: gold pillar + rings, streaks from the vanished copies) instead of the plain deploy flash.

/**
 * @param {Array<{ uid: number, area: string, piece: any }>} prev entries of the previous setPrep (render/app.js prepPieces)
 * @param {Array<{ uid: number, area: string, piece: any }>} next entries of this setPrep
 * @param {(id: string) => any} chessOf chess record lookup (`baseId`, `isGolden`)
 * @returns {Map<number, Array<{ uid: number, area: string, piece: any }>>} new elite uid → the vanished copies (prev entries)
 */
export function promotionsOf(prev, next, chessOf) {
  const out = new Map();
  if (!Array.isArray(prev) || !prev.length || !Array.isArray(next)) return out;
  const before = new Set(prev.map((e) => e.uid));
  const now = new Set(next.map((e) => e.uid));
  const baseOf = (id) => chessOf(id)?.baseId || id;
  const isElite = (p) => !!(p?.golden || chessOf(p?.id)?.isGolden);
  const gone = prev.filter((e) => e.piece?.kind === 'chess' && !now.has(e.uid) && !isElite(e.piece));
  if (!gone.length) return out;
  const used = new Set();
  for (const e of next) {
    if (e.piece?.kind !== 'chess' || before.has(e.uid) || !isElite(e.piece)) continue;
    const base = baseOf(e.piece.id);
    const copies = gone.filter((g) => !used.has(g.uid) && baseOf(g.piece.id) === base);
    if (!copies.length) continue;
    for (const g of copies) used.add(g.uid);
    out.set(e.uid, copies);
  }
  return out;
}
