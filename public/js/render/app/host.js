// public/js/render/app/host.js — asset lookup, data lookup and GL teardown for one field view.

import { createAssets, assets as defaultAssets } from '../../assets.js';
import { standInRecord } from '../../../../shared/standIn.js';
import { diyRecordOf } from '../../../../shared/diy.js';

/** Wait for optional assets, or stop waiting when this view is cancelled. Shared loads keep running. */
function withTimeout(p, ms, signal) {
  let timer;
  let onAbort;
  const stopped = new Promise((resolve, reject) => {
    if (ms != null) timer = setTimeout(resolve, ms);
    if (signal) {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
  return Promise.race([p, stopped]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Wrap whatever the caller passed as `assets` into the store API of public/js/assets.js. */
function resolveAssets(a) {
  if (a && typeof a === 'object' && typeof a.ready === 'function' && typeof a.spineEntry === 'function') return a;
  if (a && typeof a === 'object' && (a.chars || a.enemies || a.version)) return createAssets({ manifest: a });
  return defaultAssets;
}

function makeData(src) {
  const look = (file, id) => {
    if (id == null || id === '') return null;
    try {
      if (src && typeof src.lookup === 'function') return src.lookup(file, id) || null;
      const m = src && src[file];
      if (m instanceof Map) return m.get(id) || null;
      if (m && typeof m === 'object' && Object.hasOwn(m, id)) return m[id] || null;
    } catch { /* ignore */ }
    return null;
  };
  // Composed records follow both source files, including a version/content change on a live data store.
  const standIns = new Map();
  const backups = () => {
    try { return (src && typeof src.get === 'function' ? src.get('backups') : src && src.backups) || null; } catch { return null; }
  };
  const standIn = (id) => {
    const c = look('chess', id);
    const b = backups();
    if (!c || !b) return null;
    const cached = standIns.get(c);
    if (cached?.backups === b) return cached.rec;
    let rec;
    try { rec = standInRecord(c, b); } catch { rec = null; }
    standIns.set(c, { backups: b, rec });
    return rec;
  };
  // 0.2.0 自选编队: the composed 自选 record of a DIY slot filled with a pick (shared/diy.js over chess.json + backups.json)
  const diys = new Map();
  const chessMap = () => {
    try { return (src && typeof src.get === 'function' ? src.get('chess') : src && src.chess) || null; } catch { return null; }
  };
  const diy = (id, pick) => {
    const c = look('chess', id);
    const b = backups();
    if (!c || !c.isDiy || !b || !pick || typeof pick.charId !== 'string') return null;
    const chess = chessMap();
    const key = `${id}|${pick.charId}|${pick.skillIndex ?? ''}|${pick.uniEquipId ?? ''}`;
    const cached = diys.get(key);
    if (cached?.chess === chess && cached?.backups === b) return cached.rec;
    let rec;
    try { rec = diyRecordOf(c, pick, { chess, backups: b }); } catch { rec = null; }
    if (rec && b.units?.[pick.charId]?.fx) rec = { ...rec, fx: b.units[pick.charId].fx };
    diys.set(key, { chess, backups: b, rec });
    return rec;
  };
  return {
    // (a 自选 operator's summons are data/backups.json tokens, 0.2.0)
    chess: (id) => look('chess', id), token: (id) => look('tokens', id) || (backups()?.tokens && Object.hasOwn(backups().tokens, id) ? backups().tokens[id] : null), item: (id) => look('items', id),
    enemy: (id) => look('enemies', id), stage: (id) => look('stages', id), bond: (id) => look('bonds', id),
    standIn, diy,
  };
}

// ---- 画面质量 tiers (设置「画面质量」: ui/settings.js QUALITY, ui/gameLogic/settings.js QUALITIES) --------------------
//
// A tier is a set of render magnitudes; the one that decides how sharp the field looks is the CANVAS PIXEL RATIO in
// render/app.js dpr() / boardDpr(). TWO ceilings have to be lifted for 超清 (ultra) / 极致 (extreme) to mean anything,
// and this file owns both:
//   1. the tier's own ratio (QUALITY_RES / BOARD_RES below), and
//   2. the two caps dpr() takes its minimum with — `devicePixelRatio`, and 机型兼容's tuning.maxPixelRatio
//      (ui/deviceTuning.js: 1 for a 荣耀 old kernel, 1.25 for a 小米 Dimensity, 1.5 for an unknown 小米 GPU, 2 else).
// A table entry alone can therefore NEVER raise the resolution — `devicePixelRatio` is always in the min, so adding a
// tier and stopping there ships a button that renders exactly like 高 (this is the trap the audit named F1). What makes
// the tiers real is the pair of multipliers beside them:
//   TIER_SS[q]      super-sampling: multiplies the DEVICE DPR, the only way to pass the device's own pixel grid;
//   TIER_CAP_MUL[q] the 机型 ceiling multiplier: a player who explicitly picks 超清 / 极致 outranks the family heuristic
//                   for RESOLUTION (机型兼容 still decides MSAA, the frame cap and force2d — quality does not override
//                   those, so 荣耀旧内核 + 极致 stays at 30 fps and just gets a sharper picture).
// Both are 1 for low / medium / high, and the GPU's own limit is applied to every tier, so the three old tiers keep
// exactly today's numbers:
//   old:  res = min(devicePixelRatio,          table[q],          tuning.maxPixelRatio)
//   now:  res = min(devicePixelRatio * SS[q],  table[q],  tuning.maxPixelRatio * CAP_MUL[q],  gpuResCap(canvas))
// (identical for SS = CAP_MUL = 1, because the GPU limit is far above the device DPR on the screens those tiers
// target; it only ever bites where today's number could not be allocated at all — see gpuResCap).
//
// Costs: fill and video memory grow with res², so 极致 on a 2× desktop is 2.25× the pixels of 高 and on a 4K window it
// is what gpuResCap exists to stop (a 7680-wide backing store is ~132 MB of RGBA per canvas, plus the 3D board's).
// Nothing here sharpens the ART itself: the project ships one baked size per asset (data/assets.json; no
// texture-scale knob), so a tier buys edges, MSAA and particle density, not extra detail.
// MSAA and the 3D shadow-map size are construction-time values (render/app.js :274/:517, board3d scene.js): only the
// resolution of a live view follows a tier change (resize() at render/app.js setSettings).

/** Canvas pixel-ratio ceiling per 画面质量 tier (PIXI). Clamped further by TIER_SS / TIER_CAP_MUL / gpuResCap. */
const QUALITY_RES = { extreme: 4.5, ultra: 3.5, high: 3, medium: 2, low: 1 };

/** Pixel-ratio cap of the 3D board canvas per quality (its fill cost is the PBR board, not the sprites). */
const BOARD_RES = { extreme: 3.5, ultra: 3, high: 2.75, medium: 2, low: 1 };

/**
 * Mobile resolution caps: kept for the tables' shape only — NO renderer reads these two today (render/app.js takes
 * tuning.maxPixelRatio for the phone ceiling instead, ui/deviceTuning.js). Do not grow a feature on them.
 */
const MOBILE_QUALITY_RES = { extreme: 2.75, ultra: 2, high: 1.75, medium: 1.5, low: 1.25 };
const MOBILE_BOARD_RES = { extreme: 2.75, ultra: 2, high: 1.75, medium: 1.5, low: 1.25 };

/** Every 画面质量 value, weakest first — the renderer's whitelist for `view.setSettings({ quality })`. */
const QUALITY_IDS = Object.freeze(['low', 'medium', 'high', 'ultra', 'extreme']);

/**
 * Super-sampling: the multiplier on the device's own DPR. 1 for the three old tiers (no change at all); 超清 / 极致
 * render above the screen's pixel grid and are downscaled by the browser, which sharpens edges and text in the
 * sprites. This is where the "it actually looks better" budget goes — an SS bump is visible immediately, while MSAA
 * (a construction-time flag) only arrives with the next view.
 */
const TIER_SS = { low: 1, medium: 1, high: 1, ultra: 1.25, extreme: 1.5 };

/**
 * The multiplier applied to 机型兼容's ceiling (tuning.maxPixelRatio) for a tier the player picked explicitly.
 * 1 for the three old tiers → bit for bit today's behaviour on every device.
 */
const TIER_CAP_MUL = { low: 1, medium: 1, high: 1, ultra: 1.5, extreme: 2 };

/** Is `quality` at least `min` on the tier ladder (低 < 中 < 高 < 超清 < 极致)? An unknown value counts as 高. */
function qualityAtLeast(quality, min = 'high') {
  const a = QUALITY_IDS.indexOf(QUALITY_IDS.includes(quality) ? quality : 'high');
  const b = QUALITY_IDS.indexOf(min);
  return a >= 0 && b >= 0 && a >= b;
}

/** MAX_RENDERBUFFER_SIZE of this device, 0 = unknown / not a browser (probed once per page, then cached). */
let gpuLimit = 0;
const MAX_RENDERBUFFER_SIZE = 0x84e8; // the GL constant, for a stub context that does not expose it

/**
 * The GPU's ceiling on one canvas' pixel ratio: floor(MAX_RENDERBUFFER_SIZE / max(css width, css height)).
 *
 * Why it is needed: the old three tiers were safe by accident — `devicePixelRatio` in the min kept every backing store
 * inside what the GPU allocates. Super-sampling breaks that guarantee (F8 in the audit): a 1920 × 1080 window at
 * ratio 4 is a 7680 × 4320 renderbuffer, common mobile GPUs cap MAX_RENDERBUFFER_SIZE at 4096, and allocation failure
 * there is a black screen rather than a slow frame. So every tier passes through here.
 *
 * Unknown limit → Infinity (no invention): in Node / the fake PIXI of test/render (no `document`) there is no GPU to
 * ask, and in a browser without WebGL every view falls back to the 2D board anyway. `gl` is the live renderer's
 * context when the caller has one (exact); otherwise one throwaway context is opened and immediately released, the
 * same probe ui/deviceTuning.js probeGpu uses.
 * @param {any} [gl] a live WebGL context, if one exists already
 * @param {number} width CSS pixel width of the canvas
 * @param {number} height CSS pixel height of the canvas
 * @returns {number} the largest usable pixel ratio (≥ 1), or Infinity when unknown
 */
function gpuResCap(gl, width, height) {
  const limit = gpuLimitOf(gl);
  if (!limit) return Infinity;
  const side = Math.max(1, Math.ceil(Math.max(Number(width) || 1, Number(height) || 1)));
  return Math.max(1, Math.floor(limit / side));
}

/** @param {any} [gl] @returns {number} 0 when unknown */
function gpuLimitOf(gl) {
  if (gpuLimit) return gpuLimit;
  let ctx = gl || null;
  let opened = null;
  try {
    if (!ctx) {
      if (typeof globalThis.document === 'undefined') return 0;
      const c = globalThis.document.createElement('canvas');
      ctx = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      opened = ctx;
    }
    if (!ctx || typeof ctx.getParameter !== 'function') return 0;
    const n = Number(ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE ?? MAX_RENDERBUFFER_SIZE));
    if (Number.isFinite(n) && n > 0) gpuLimit = n;
  } catch { /* a locked-down WebView: no cap rather than a broken view */ } finally {
    try { opened?.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch { /* ignore */ }
  }
  return gpuLimit;
}

/**
 * The pixel ratio of one canvas for a 画面质量 tier — the formula render/app.js's dpr() / boardDpr() call.
 * @param {string} quality the stored value ('low'|'medium'|'high'|'ultra'|'extreme'; anything else behaves as 'high')
 * @param {number} width CSS width of the canvas
 * @param {number} height CSS height of the canvas
 * @param {number} cap 机型兼容's ceiling (tuning.maxPixelRatio, ui/deviceTuning.js)
 * @param {Record<string, number>} [table] QUALITY_RES (default) or BOARD_RES
 * @param {any} [gl] the live renderer's GL context, when there is one (see gpuResCap)
 * @returns {number} the ratio (fractional values are legal to PIXI; never below 1)
 */
function tierPixelRatio(quality, width, height, cap, table = QUALITY_RES, gl = null) {
  const q = QUALITY_IDS.includes(quality) ? quality : 'high';
  const t = table || QUALITY_RES;
  const dev = globalThis.devicePixelRatio || 1;
  const byDevice = dev * (TIER_SS[q] || 1);
  const byTier = t[q] || t.high || 2;
  const byCap = (Number.isFinite(cap) && cap > 0 ? cap : dev) * (TIER_CAP_MUL[q] || 1);
  return Math.max(1, Math.min(byDevice, byTier, byCap, gpuResCap(gl, width, height)));
}

/**
 * Before a renderer is destroyed: free its GL copies of every texture / buffer / geometry / framebuffer it
 * uploaded. Module-level textures (FX atlas, tier chips, backdrop, diamonds, Spine pages, PIXI.Texture.WHITE…)
 * outlive the view; PIXI 7 leaves their per-context GL entries and 'dispose' listeners pointing at the dead
 * renderer, which kept every unmounted view's renderer, canvas and WebGL context reachable.
 */
export function releaseGl(renderer) {
  const ts = renderer && renderer.texture;
  if (ts && Array.isArray(ts.managedTextures) && typeof ts.destroyTexture === 'function') {
    for (const bt of ts.managedTextures.slice()) { try { ts.destroyTexture(bt, true); } catch { /* ignore */ } }
    ts.managedTextures.length = 0;
  }
  for (const sys of [renderer?.geometry, renderer?.buffer, renderer?.framebuffer]) {
    try { if (sys && typeof sys.disposeAll === 'function') sys.disposeAll(false); } catch { /* ignore */ }
  }
  // shader programs are cached globally by source (PIXI.utils.ProgramCache) with one GLProgram per context
  const uid = renderer?.CONTEXT_UID, gl = renderer?.gl;
  const programs = globalThis.PIXI?.utils?.ProgramCache;
  if (uid != null && programs && typeof programs === 'object') {
    for (const prog of Object.values(programs)) {
      const g = prog && prog.glPrograms && prog.glPrograms[uid];
      if (!g) continue;
      try { if (gl && g.program) gl.deleteProgram(g.program); } catch { /* ignore */ }
      delete prog.glPrograms[uid];
    }
  }
}

export { withTimeout, resolveAssets, makeData, QUALITY_RES, BOARD_RES, MOBILE_QUALITY_RES, MOBILE_BOARD_RES };
export { QUALITY_IDS, TIER_SS, TIER_CAP_MUL, qualityAtLeast, gpuResCap, tierPixelRatio };
