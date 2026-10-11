// render/pen.js — the enemy preview pen of the prep phase (research 09 §2.2, research 08 §4.2, DESIGN §3): where the
// next round's enemies stand, idling and facing left, behind the gates. Pure logic (no PIXI): render/app.js turns the
// layout into idle enemy views.
//
//   const pen = layoutPen(nextEnemies, { stage })   // m.private.nextEnemies (per-action entries with counts)
//   → { figures: [{ key, enemyKey, row, col, x, y, fly, elite, boss, t, zone }], total, shown, sig }
//
// Official algorithm (client AutoChessEnemyPreviewManager, decoded in research 08 §4.2), with the documented choices:
//   * entries sorted by spawn time (`t`, _CompareActionByTime; stable);
//   * thinning: total = Σ count, ratio = min(1, 50 / total); each entry shows max(1, round(count · ratio)) figures,
//     elites and bosses (handbook level ≠ NORMAL) always their full count; normal figures past MAX_PREVIEW (50) are
//     dropped from the latest spawns first (elites / bosses are never dropped);
//   * zones: the pen rect `enemy_place_rect` ((14,7),(18,13)) minus the `previewNotAlloed` row (16) and the two
//     `tile_start` anchors (15,7) / (18,7); every tile belongs to the Manhattan-nearest anchor → lower zone rows 14–15,
//     upper zone rows 17–18 (13 tiles each). Upper-gate enemies → upper zone, lower-gate → lower zone;
//   * tile choice: the k-th figure sent to a zone goes to zoneTiles[clamp(round(k / totalShowCnt · len) − jitter)]
//     (totalShowCnt = min(50, Σ count), jitter ∈ {0, 1}, seeded — `Random.Range(−1, 0)` [ASSUMED both values]); each
//     zone's tiles in ROW-MAJOR order as the client builds them (research 08 §4.2 step 3 [DATA]: low row first, col
//     7 → 13), so the first spawns stand next to the gate anchor and a small zone stays by its gate;
//   * at most PER_TILE (3) figures per tile ([ASSUMED], research 09 §2.2): a full tile passes the figure to the next
//     tile of its zone with room; a zone whose every tile is full stacks the rest on its least-loaded tiles — never in
//     the other gate's zone ("keep the grouping exact: one zone per gate", research 08 §4.2 step 6; only a zone without
//     tiles falls back to any pen tile, m_backUpTiles); figures sharing a tile stand in a small cluster (≤ 6 distinct
//     spots) with a seeded jitter.
// Deterministic for a given preview (the seed is a hash of the entries), so re-sending the same m.private never
// reshuffles the pen.

export const PEN_RECT = Object.freeze({ r0: 14, r1: 18, c0: 7, c1: 13 });
export const MAX_PREVIEW = 50;
export const PER_TILE = 3;

/** Cluster offsets (tiles; x = col, y = row) of 1–6 figures sharing a tile (deeper ones a bit to the right). */
const CLUSTER = Object.freeze([
  Object.freeze([[0, 0]]),
  Object.freeze([[-0.17, 0.13], [0.17, -0.13]]),
  Object.freeze([[-0.22, 0.16], [0.2, 0.18], [-0.02, -0.2]]),
  Object.freeze([[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]]),
  Object.freeze([[-0.25, 0.22], [0.25, 0.22], [0, 0], [-0.25, -0.22], [0.25, -0.22]]),
  Object.freeze([[-0.27, 0.22], [0, 0.26], [0.27, 0.22], [-0.27, -0.22], [0, -0.26], [0.27, -0.22]]),
]);

const isObj = (v) => !!v && typeof v === 'object';

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Parse a configBlackBoard rect "((r0,c0),(r1,c1))" → { r0, r1, c0, c1 } (null when malformed). */
export function parsePenRect(v) {
  if (typeof v !== 'string') return null;
  const n = v.replace(/[()\s]/g, '').split(',').map(Number);
  if (n.length !== 4 || !n.every(Number.isInteger)) return null;
  return { r0: Math.min(n[0], n[2]), r1: Math.max(n[0], n[2]), c0: Math.min(n[1], n[3]), c1: Math.max(n[1], n[3]) };
}

/**
 * The pen's two zones for a stage (defaults when the stage is missing or malformed): `{ rect, lower, upper }`, each
 * zone `{ anchor: [r, c], tiles: [[r, c]…] }` in row-major order (research 08 §4.2: low row first, then col).
 */
export function penZones(stage) {
  const rect = parsePenRect(stage?.config?.enemy_place_rect) || { ...PEN_RECT };
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  const legend = isObj(stage?.tiles) ? stage.tiles : {};
  const glyph = (r, c) => (rows && typeof rows[r] === 'string' ? rows[r][c] : null);
  const anchors = [];
  const cand = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const g = glyph(r, c);
      const def = g ? legend[g] : null;
      if (rows) {
        if (!def) continue;
        if (def.tileKey === 'tile_start') { anchors.push([r, c]); continue; }
        if (def.bb && def.bb.previewNotAlloed) continue;
        if (def.passable && def.passable !== 'ALL') continue;
        cand.push([r, c]);
      } else {
        // no stage: the official layout ((14,7),(18,13)), anchors (15,7) / (18,7), row 16 not allowed
        if (c === rect.c0 && (r === rect.r0 + 1 || r === rect.r1)) { anchors.push([r, c]); continue; }
        if (r === rect.r0 + 2) continue;
        cand.push([r, c]);
      }
    }
  }
  if (!anchors.length) anchors.push([rect.r0 + 1, rect.c0], [rect.r1, rect.c0]);
  anchors.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const zones = anchors.map((a) => ({ anchor: a, tiles: [] }));
  const dist = (a, t) => Math.abs(a[0] - t[0]) + Math.abs(a[1] - t[1]);
  for (const t of cand) {
    let best = zones[0], bd = Infinity;
    for (const z of zones) { const d = dist(z.anchor, t); if (d < bd) { bd = d; best = z; } }
    best.tiles.push(t);
  }
  // row-major, as the client lists them (the candidates are collected row by row; kept explicit for custom rects)
  for (const z of zones) z.tiles.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { rect, lower: zones[0], upper: zones[zones.length - 1], zones };
}

/** Clean, time-sorted entries of an m.private.nextEnemies list. */
export function penEntries(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  list.forEach((e, i) => {
    if (!isObj(e) || typeof e.enemyKey !== 'string' || !e.enemyKey) return;
    const count = Math.max(1, Math.min(200, Math.trunc(Number(e.count) || 1)));
    out.push({
      enemyKey: e.enemyKey, count, gate: e.gate === 'upper' ? 'upper' : 'lower', t: Number.isFinite(Number(e.t)) ? Number(e.t) : 0,
      fly: !!e.fly, boss: !!e.boss || e.tag === 'boss', elite: !!e.elite || !!e.boss || e.tag === 'boss', i,
    });
  });
  out.sort((a, b) => a.t - b.t || a.i - b.i);
  return out;
}

/** Signature of a preview list (unchanged signature ⇒ the pen is left as it is). */
export function penSignature(list) {
  return penEntries(list).map((e) => `${e.enemyKey}:${e.count}:${e.gate[0]}:${e.t}:${e.fly ? 1 : 0}${e.elite ? 1 : 0}${e.boss ? 1 : 0}`).join('|');
}

/**
 * Figures shown per entry after thinning (see header): [{ entry, n }] in spawn order.
 * @param {ReturnType<typeof penEntries>} entries
 */
export function thinPreview(entries, max = MAX_PREVIEW) {
  const total = entries.reduce((s, e) => s + e.count, 0);
  const ratio = total > 0 ? Math.min(1, max / total) : 1;
  const plan = entries.map((e) => ({ entry: e, n: e.elite ? e.count : Math.max(1, Math.round(e.count * ratio)) }));
  let shown = plan.reduce((s, p) => s + p.n, 0);
  // over the cap (rounding, elites): take figures from the biggest normal groups first, so every action keeps a
  // figure while it can; then drop single normal figures from the latest spawns (elites / bosses always stay)
  while (shown > max) {
    let big = null;
    for (const p of plan) if (!p.entry.elite && p.n > 1 && (!big || p.n > big.n)) big = p;
    if (!big) break;
    big.n--;
    shown--;
  }
  for (let i = plan.length - 1; i >= 0 && shown > max; i--) {
    const p = plan[i];
    if (p.entry.elite || !p.n) continue;
    p.n--;
    shown--;
  }
  return plan.filter((p) => p.n > 0);
}

/**
 * Lay the preview out in the pen (see header).
 * @param {Array<object>} list m.private.nextEnemies
 * @param {{ stage?: object, max?: number, perTile?: number }} [opts]
 */
export function layoutPen(list, opts = {}) {
  const entries = penEntries(list);
  const sig = penSignature(list);
  const Z = penZones(opts.stage);
  const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : MAX_PREVIEW;
  const perTile = Number.isInteger(opts.perTile) && opts.perTile > 0 ? opts.perTile : PER_TILE;
  const plan = thinPreview(entries, max);
  const shown = plan.reduce((s, p) => s + p.n, 0);
  const total = entries.reduce((s, e) => s + e.count, 0);
  // the index divisor of the client: totalShowCnt = min(MAX_PREVIEW_CNT, Σ count) (research 08 §4.2 step 2)
  const totalShowCnt = Math.max(1, Math.min(max, total));
  const rand = rng(hashStr(sig) || 1);
  const load = new Map();              // "r,c" → figures on the tile
  const key = (t) => `${t[0]},${t[1]}`;
  const has = (t) => (load.get(key(t)) || 0) < perTile;
  const allTiles = [...Z.lower.tiles, ...Z.upper.tiles];
  const placed = [];
  const kOf = { lower: 0, upper: 0 };
  for (const { entry, n } of plan) {
    const zoneName = entry.gate === 'upper' ? 'upper' : 'lower';
    const zone = Z[zoneName];
    for (let j = 0; j < n; j++) {
      const k = kOf[zoneName]++;
      const len = zone.tiles.length;
      let tile = null;
      if (len) {
        const jitter = rand() < 0.5 ? 1 : 0;
        let idx = Math.round((k / totalShowCnt) * len) - jitter;
        idx = Math.max(0, Math.min(len - 1, idx));
        // a full tile passes the figure on (further along the zone list, then back towards its start)
        for (let d = 0; d < len && !tile; d++) {
          for (const ii of d ? [idx + d, idx - d] : [idx]) if (ii >= 0 && ii < len && has(zone.tiles[ii])) { tile = zone.tiles[ii]; break; }
        }
        // the whole zone is full: stack on its least-loaded tile nearest the index (never in the other gate's zone)
        if (!tile) {
          let best = Infinity;
          for (let ii = 0; ii < len; ii++) {
            const score = (load.get(key(zone.tiles[ii])) || 0) * len + Math.abs(ii - idx);
            if (score < best) { best = score; tile = zone.tiles[ii]; }
          }
        }
      }
      if (!tile) tile = allTiles.find(has) || allTiles[0] || [Z.rect.r0, Z.rect.c1];
      load.set(key(tile), (load.get(key(tile)) || 0) + 1);
      placed.push({ entry, tile, zone: zoneName, slot: 0 });
    }
  }
  // cluster offsets once every tile's final occupancy is known
  const seen = new Map();
  const figures = placed.map((p, idx) => {
    const kk = key(p.tile);
    const cnt = Math.min(CLUSTER.length, load.get(kk) || 1);
    const slot = seen.get(kk) || 0;
    seen.set(kk, slot + 1);
    const off = CLUSTER[cnt - 1][slot % cnt] || [0, 0];
    const jx = (rand() - 0.5) * 0.08, jy = (rand() - 0.5) * 0.08;
    const e = p.entry;
    return {
      key: `${idx}:${e.enemyKey}`, enemyKey: e.enemyKey, row: p.tile[0], col: p.tile[1],
      x: p.tile[1] + off[0] + jx, y: p.tile[0] + off[1] + jy,
      fly: e.fly, elite: e.elite, boss: e.boss, t: e.t, zone: p.zone,
    };
  });
  return { figures, total, shown, sig };
}

/** Whether a tile lies inside the pen rect (rows 14–18 × cols 7–13 by default). */
export function inPen(row, col, rect = PEN_RECT) {
  return row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1;
}

