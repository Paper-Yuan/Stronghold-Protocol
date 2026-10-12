// Direction step of a board placement — the standard Arknights 4-direction deploy wheel (research 09 §1.2 / §6.1 5).
//
// After a legal drop of an operator / summon on a board tile (also its own tile: re-orient in place) — or of a
// directional Art (画卷) — the piece stays on the tile as a ghost and this overlay opens:
//   * a white diamond centred on the tile, ~3 tiles across its diagonal, a smaller inner diamond (the centre
//     dead-zone, ~0.5 tile) and 4 chevrons (UP / RIGHT / DOWN / LEFT);
//   * a red "✕ 点击取消" tag on the diamond's upper-left edge;
//   * press and drag from the centre: past the dead-zone that side's chevron lights and the unit's range grid, rotated
//     to that direction (DESIGN §3), shows as orange striped tiles (view.highlightTiles group 'facing' under the units
//     + a striped SVG layer — slotted between the 3D board canvas and the Pixi canvas when the 3D board is on, so the
//     units stand on the stripes; an overlay otherwise); outside the centre the tooltip "拖回中心区域取消" shows;
//   * on the mirrored right half of the Final Assault prep a screen direction maps to its board direction (RIGHT ↔
//     LEFT, facing.js boardDir): the chevrons follow the finger, the range / model / intent use the board direction;
//   * release outside the centre commits (g.move {uid, to, dir} / g.art {…, dir}); release inside the centre, a tap
//     on ✕, a press outside the diamond or Esc cancels (the piece returns to where it came from). Arrow keys preview a
//     direction and Enter commits it (keyboard alternative) — Enter on a focused ✕ cancels, on any other focused
//     button does nothing while the wheel is open (GitHub #394). Mouse, pen and touch all use pointer events.
//
// View bridge: the field view (render/app.js or the DOM fallback) may implement `tileScreen(row, col)`,
// `holdPiece(uid, tile|null)` and `setPieceDir(uid, dir)` (render/app.js does, DESIGN §9); a view without them falls
// back to the engine's dev hooks (`view.debug.cam / tiles / views / app`) for the same effect (projection of tile corners, pinning
// the dropped piece's view on the target tile, re-orienting its model). All of it is guarded: a missing hook only
// loses the visual, never the interaction.

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { LocalSprite } from './gameComponents.js';
import { DIRS, DIR_LABEL, DEAD_ZONE_TILES, dirFromDelta, dirFromKey, rangeTiles, normDir, boardDir, viewMirrored } from './facing.js';
import { facingSwallows, facingEnter } from './gameLogic.js';
import { settingsStore } from './settings.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const rawOf = (view) => (view && view.raw) || view || null;

/** Range highlight of the wheel / a selected unit (orange, drawn under the units by the render engine). */
export const FACING_STYLE = Object.freeze({ group: 'facing', color: 0xff9c33, fill: 0.36, line: 1 });

// ---- view bridge ---------------------------------------------------------------------------------------------------

/**
 * Screen geometry of a tile's top face, in client px: centre, px per tile at that depth, the 4 corners.
 * @returns {{ x: number, y: number, s: number, poly: Array<[number, number]> } | null}
 */
export function tileScreen(view, row, col) {
  const raw = rawOf(view);
  if (!raw || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  try {
    if (typeof raw.tileScreen === 'function') {
      const r = raw.tileScreen(row, col);
      if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
    }
    const dbg = raw.debug;
    const cam = dbg && dbg.cam;
    const canvas = dbg && dbg.app && dbg.app.view;
    if (cam && typeof cam.project === 'function' && canvas && typeof canvas.getBoundingClientRect === 'function') {
      const z = dbg.tiles && typeof dbg.tiles.heightAt === 'function' ? dbg.tiles.heightAt(row, col) : 0;
      const cr = canvas.getBoundingClientRect();
      const c = cam.project(col, row, z);
      const corner = (dx, dy) => { const p = cam.project(col + dx, row + dy, z); return [cr.left + p.x, cr.top + p.y]; };
      return { x: cr.left + c.x, y: cr.top + c.y, s: c.s, poly: [corner(-0.5, 0.5), corner(0.5, 0.5), corner(0.5, -0.5), corner(-0.5, -0.5)] };
    }
  } catch { /* no geometry: the caller hides its visuals */ }
  return null;
}

/** Per-view pins of the engine fallback (dev hooks): uid → { row, col }. */
const pins = new WeakMap();

function pinLoop(raw) {
  const st = pins.get(raw);
  if (!st || st.raf) return;
  const step = () => {
    st.raf = 0;
    if (!st.map.size) return;
    try {
      const views = raw.debug && raw.debug.views;
      const heightAt = raw.debug && raw.debug.tiles && raw.debug.tiles.heightAt ? (r, c) => raw.debug.tiles.heightAt(r, c) : () => 0;
      for (const [uid, t] of st.map) {
        const v = views && views.get('p:' + uid);
        if (!v || v.destroyed) continue;
        const w = { x: t.col, y: t.row, z: heightAt(t.row, t.col) };
        v._home = w;
        if (!v._tween || v._tween.tx !== w.x || v._tween.ty !== w.y) {
          if (Math.abs(v.x - w.x) + Math.abs(v.y - w.y) > 1e-3) v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: w.x, ty: w.y, tz: w.z, t: 0 };
          else v._tween = null;
        }
        v.lift = 0;
      }
    } catch { /* view torn down */ }
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

/**
 * Keep a dropped piece standing on `tile` while its direction is being chosen / the move is in flight (`tile` null
 * releases it; the caller re-applies the prep state so the piece settles where the server says).
 */
export function holdPiece(view, uid, tile) {
  const raw = rawOf(view);
  if (!raw || !Number.isInteger(uid)) return;
  try {
    if (typeof raw.holdPiece === 'function') { raw.holdPiece(uid, tile || null); return; }
  } catch { return; }
  if (!raw.debug || !raw.debug.views) return;
  let st = pins.get(raw);
  if (!st) { st = { map: new Map(), raf: 0 }; pins.set(raw, st); }
  if (tile && Number.isInteger(tile.row) && Number.isInteger(tile.col)) {
    st.map.set(uid, { row: tile.row, col: tile.col });
    pinLoop(raw);
  } else {
    st.map.delete(uid);
    if (!st.map.size && st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
  }
}

/** Show a piece facing `dir` (live wheel preview, or the stored m.private `dir`). */
export function setPieceDir(view, uid, dir) {
  const raw = rawOf(view);
  if (!raw || !Number.isInteger(uid)) return;
  try {
    if (typeof raw.setPieceDir === 'function') { raw.setPieceDir(uid, normDir(dir)); return; }
    const v = raw.debug && raw.debug.views && raw.debug.views.get('p:' + uid);
    if (v && typeof v.setDir === 'function') v.setDir(normDir(dir));
  } catch { /* cosmetic only */ }
}

/**
 * Apply the stored facing of every own piece (board: `piece.dir`, default RIGHT; bench: RIGHT) to the view, except
 * `skip` (the piece whose direction the wheel is previewing).
 */
export function syncPieceDirs(view, priv, skip = null) {
  if (!view || !priv) return;
  for (const p of Array.isArray(priv.board) ? priv.board : []) if (p && p.uid !== skip) setPieceDir(view, p.uid, p.dir);
  for (const list of [priv.hand, priv.temp]) for (const p of Array.isArray(list) ? list : []) if (p && p.uid !== skip && p.kind !== 'item') setPieceDir(view, p.uid, 'RIGHT');
}

/** Light the rotated range of a piece on (row, col) facing `dir` (no grid / dir clears the style's group). */
export function showRange(view, grid, row, col, dir, style = FACING_STYLE) {
  if (!view || typeof view.highlightTiles !== 'function') return [];
  const tiles = grid && dir ? rangeTiles(grid, row, col, dir) : [];
  try { view.highlightTiles(tiles, style); } catch { /* cosmetic */ }
  return tiles;
}

/** Follow a tile's screen position (the camera may still be moving, the window may resize). */
export function useTileScreen(view, row, col) {
  const [g, setG] = useState(() => tileScreen(view, row, col));
  const last = useRef('');
  useEffect(() => {
    let raf = 0;
    let alive = true;
    // no tile (nothing selected): nothing to follow
    if (!view || !Number.isInteger(row) || !Number.isInteger(col)) { last.current = ''; setG(null); return undefined; }
    // ~30 Hz is plenty for a follower of the camera's glide (CAMERA_MS); a per-rAF getBoundingClientRect +
    // re-projection on a high-refresh display costs real main-thread time during the placement drag
    const WHEEL_FOLLOW_MS = 1000 / 30;
    const tick = () => {
      const t = tileScreen(view, row, col);
      const key = t ? `${t.x.toFixed(1)},${t.y.toFixed(1)},${t.s.toFixed(2)}` : '';
      if (key !== last.current) { last.current = key; setG(t); }
    };
    const loop = () => {
      if (!alive) return;
      tick();
      raf = setTimeout(loop, WHEEL_FOLLOW_MS);
    };
    loop();
    return () => { alive = false; clearTimeout(raf); };
  }, [view, row, col]);
  return g;
}

// ---- the wheel -------------------------------------------------------------------------------------------------------

/** Chevron centre (viewBox units, circle radius = 100) and rotation per direction. */
const CHEV = { UP: [0, -68, -90], RIGHT: [68, 0, 0], DOWN: [0, 68, 90], LEFT: [-68, 0, 180] };

function Chevron({ dir, on }) {
  const [x, y, rot] = CHEV[dir];
  return html`<g class=${cx('fwheel__chev', on && 'is-on')} transform=${`translate(${x} ${y}) rotate(${rot})`}>
    <path d="M-9 -15 L3 0 L-9 15 L-3 15 L9 0 L-3 -15 Z" />
  </g>`;
}

/**
 * The direction wheel overlay (standard circular deploy joystick with 4-way snap).
 * @param {{ view: any, row: number, col: number, grid: Array<[number, number]>|null, name?: string,
 *   onPreview?: (dir: string|null) => void, onCommit: (dir: string) => void, onCancel: () => void }} props
 */
export function FacingWheel({ view, row, col, grid, name = '', onPreview, onCommit, onCancel }) {
  const g = useTileScreen(view, row, col);
  const [dir, setDir] = useState(null);
  const [drag, setDrag] = useState(null); // { id } while a pointer is down
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const live = useRef({});
  const s = g && g.s > 0 ? g.s : 64;
  const half = s * 1.5;              // wheel radius in pixels: ~1.5 tiles
  const dead = s * DEAD_ZONE_TILES;  // centre dead-zone radius
  const mirror = viewMirrored(view) || !!(g && g.mirror);
  const bdir = boardDir(dir, mirror);
  live.current = { g, half, dead, dir, bdir, mirror, onCommit, onCancel, onPreview };

  // preview: model / wedge direction and the rotated range under the units
  const tiles = useRangeHighlight(view, grid, row, col, bdir);
  useEffect(() => { try { onPreview?.(bdir); } catch { /* ignore */ } }, [bdir]);
  useEffect(() => () => { showRange(view, null, row, col, null); }, []);

  const choose = (clientX, clientY) => {
    const L = live.current;
    if (!L.g) return null;
    const dx = clientX - L.g.x;
    const dy = clientY - L.g.y;
    const dist = Math.hypot(dx, dy);
    const maxR = L.half * 0.85;
    const scale = dist > 0 ? Math.min(dist, maxR) / dist : 0;
    // Map knob coordinates into SVG viewBox space (-100..100)
    const svgScale = 100 / L.half;
    setKnob({ x: dx * scale * svgScale, y: dy * scale * svgScale, active: true });

    const d = dirFromDelta(dx, dy, L.dead);
    setDir(d);
    return d;
  };

  const inside = (clientX, clientY) => {
    const L = live.current;
    if (!L.g) return true;
    return Math.hypot(clientX - L.g.x, clientY - L.g.y) <= L.half * 1.6;
  };

  const onDown = (e) => {
    if (e.button != null && e.button !== 0) { e.preventDefault(); return; }
    if (e.target && e.target.closest && e.target.closest('.fwheel__cancel')) return;
    e.preventDefault();
    if (!inside(e.clientX, e.clientY)) { onCancel(); return; }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDrag({ id: e.pointerId });
    choose(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    choose(e.clientX, e.clientY);
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    setDrag(null);
    setKnob({ x: 0, y: 0, active: false });
    const d = choose(e.clientX, e.clientY);
    if (d) onCommit(boardDir(d, live.current.mirror)); else onCancel();
  };
  const onPointerCancel = () => {
    setDrag(null);
    setDir(null);
    setKnob({ x: 0, y: 0, active: false });
  };

  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const L = live.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); L.onCancel(); return; }
      const k = dirFromKey(e.key);
      if (k) { e.preventDefault(); e.stopImmediatePropagation(); setDir(k); return; }
      const enter = facingEnter(e, !!L.dir);
      if (enter) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (enter === 'cancel') L.onCancel();
        else if (enter === 'commit') L.onCommit(L.bdir);
        return;
      }
      if (facingSwallows(e, settingsStore.get().keys)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    try { rootRef.current?.focus({ preventScroll: true }); } catch { /* ignore */ }
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const outside = !!drag && !!dir;
  const box = half * 2;
  const deadR = (DEAD_ZONE_TILES / 1.5) * 100;

  return html`<div ref=${rootRef} tabIndex="-1" class=${cx('fwheel', drag && 'is-pressed', dir && `is-${dir.toLowerCase()}`)} role="dialog" aria-label=${name ? t('选择「{name}」的朝向', { name }) : t('选择朝向')}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onPointerCancel}
      onContextMenu=${(e) => { e.preventDefault(); onCancel(); }}>
    ${g ? html`<${Stripes} tiles=${tiles} view=${view} row=${row} col=${col} />` : null}
    ${g ? html`<div class="fwheel__dia" style=${`left:${g.x}px;top:${g.y}px;width:${box}px;height:${box}px`}>
      <svg class="fwheel__svg" viewBox="-110 -110 220 220" aria-hidden="true">
        <!-- 4 circular sectors with 45° boundaries -->
        <path class=${cx('fwheel__quad', dir === 'RIGHT' && 'is-on')} d="M0 0 L70.71 -70.71 A100 100 0 0 1 70.71 70.71 Z" />
        <path class=${cx('fwheel__quad', dir === 'DOWN' && 'is-on')} d="M0 0 L70.71 70.71 A100 100 0 0 1 -70.71 70.71 Z" />
        <path class=${cx('fwheel__quad', dir === 'LEFT' && 'is-on')} d="M0 0 L-70.71 70.71 A100 100 0 0 1 -70.71 -70.71 Z" />
        <path class=${cx('fwheel__quad', dir === 'UP' && 'is-on')} d="M0 0 L-70.71 -70.71 A100 100 0 0 1 70.71 -70.71 Z" />

        <!-- Wheel outer rings and quadrant dividers -->
        <circle class="fwheel__outer" cx="0" cy="0" r="100" />
        <circle class="fwheel__subring" cx="0" cy="0" r="75" />
        <line class="fwheel__axis" x1="-70.71" y1="-70.71" x2="70.71" y2="70.71" />
        <line class="fwheel__axis" x1="-70.71" y1="70.71" x2="70.71" y2="-70.71" />

        <!-- Direction chevrons -->
        ${DIRS.map((d) => html`<${Chevron} key=${d} dir=${d} on=${dir === d} />`)}

        <!-- Deadzone inner circle -->
        <circle class="fwheel__inner" cx="0" cy="0" r=${deadR} />

        <!-- Dynamic joystick knob & pointer beam when active -->
        ${knob.active ? html`
          <line class="fwheel__stick" x1="0" y1="0" x2=${knob.x} y2=${knob.y} />
          <circle class="fwheel__knob" cx=${knob.x} cy=${knob.y} r="16" />
        ` : null}
      </svg>
      <button type="button" class="fwheel__cancel" onPointerDown=${(e) => e.stopPropagation()}
        onClick=${(e) => { e.stopPropagation(); onCancel(); }} aria-label=${t('点击取消')}>
        <${LocalSprite} name="cancel_icon" class="fwheel__x" fallback=${html`<span class="fwheel__x fwheel__x--txt">✕</span>`} />
        <span>${t('点击取消')}</span>
      </button>
      ${outside ? html`<span class="fwheel__tip" role="status">${t('拖回中心区域取消')}</span>` : null}
      <span class="fwheel__sr" aria-live="polite">${dir ? t('朝向：{dir}', { dir: t(DIR_LABEL[dir]) }) : ''}</span>
    </div>` : null}
  </div>`;
}

/** Keep the view's 'facing' highlight group on the rotated range; returns the tiles. */
function useRangeHighlight(view, grid, row, col, dir) {
  const [tiles, setTiles] = useState([]);
  useLayoutEffect(() => { setTiles(showRange(view, grid, row, col, dir)); }, [view, grid, row, col, dir]);
  return tiles;
}

/**
 * Where the striped range layer goes (client geometry is shared): with the 3D board on, UNDER the transparent Pixi
 * canvas and above the three.js board canvas — the units stand on the stripes like in the original. Otherwise (2D
 * board: the Pixi canvas is opaque; DOM fallback) the stripes are an overlay above the field and skip the piece's
 * own tile. Returns null for the overlay case.
 * @returns {{ host: HTMLElement, before: HTMLElement } | null}
 */
export function stripeMount(view) {
  const raw = rawOf(view);
  try {
    const dbg = raw && raw.debug;
    const canvas = dbg && dbg.app && dbg.app.view;
    const host = canvas && canvas.parentElement;
    if (!host || !dbg.board3d || typeof host.insertBefore !== 'function') return null;
    return { host, before: canvas };
  } catch { return null; }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let stripeSeq = 0;

/** Screen polygons (client px) of range tiles, as SVG `points` strings, offset by (ox, oy). */
export function stripePolys(view, tiles, ox = 0, oy = 0) {
  const out = [];
  for (const [r, c] of tiles) {
    const t = tileScreen(view, r, c);
    if (t && Array.isArray(t.poly) && t.poly.length >= 3) out.push({ k: `${r},${c}`, pts: t.poly.map((p) => `${(p[0] - ox).toFixed(1)},${(p[1] - oy).toFixed(1)}`).join(' ') });
  }
  return out;
}

/**
 * Striped orange range tiles (the official look), re-projected every frame (the camera may still move). The solid
 * orange fill is the render view's highlight group under the units; these are the light stripes on top of it.
 */
function Stripes({ tiles, view, row, col }) {
  const [, setN] = useState(0);
  const mount = stripeMount(view);
  const key = tiles.map((t) => t.join(',')).join(';');
  // under the units (3D board): an imperatively managed <svg> between the two canvases
  useEffect(() => {
    if (!mount || !tiles.length) return undefined;
    const id = `fwheel-stripe-u${++stripeSeq}`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fwheel__stripes fwheel__stripes--under');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none', overflow: 'visible' });
    svg.innerHTML = `<defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + '<rect width="3.5" height="10" fill="rgba(255,178,70,.5)" /></pattern></defs><g></g>';
    const g = svg.lastChild;
    try {
      if (mount.before && mount.before.parentElement === mount.host) {
        mount.host.insertBefore(svg, mount.before);
      } else {
        mount.host.appendChild(svg);
      }
    } catch {
      return undefined;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const hr = mount.host.getBoundingClientRect();
      const polys = stripePolys(view, tiles, hr.left, hr.top);
      const sig = polys.map((p) => p.pts).join('|');
      if (sig !== last) {
        last = sig;
        g.replaceChildren(...polys.map((p) => {
          const el = document.createElementNS(SVG_NS, 'polygon');
          el.setAttribute('points', p.pts);
          el.setAttribute('fill', `url(#${id})`);
          el.setAttribute('stroke', 'rgba(255,176,70,.9)');
          el.setAttribute('stroke-width', '1.5');
          return el;
        }));
      }
    };
    // ~30 Hz re-projection (see useTileScreen): full rAF here re-projected every polygon on each frame of a
    // high-refresh display while the wheel was open
    const STRIPE_FOLLOW_MS = 1000 / 30;
    const loop = () => { tick(); raf = setTimeout(loop, STRIPE_FOLLOW_MS); };
    loop();
    return () => { clearTimeout(raf); svg.remove(); };
  }, [key, view, !!mount]);
  // overlay (2D board / fallback): never over the piece's own tile, so the unit being placed stays visible
  const over = mount ? [] : tiles.filter(([r, c]) => r !== row || c !== col);
  const overKey = over.map((t) => t.join(',')).join(';');
  useEffect(() => {
    if (!over.length) return undefined;
    let raf = 0;
    let last = '';
    const tick = () => {
      const t = tileScreen(view, over[0][0], over[0][1]);
      const k = t ? `${t.x.toFixed(1)},${t.y.toFixed(1)}` : '';
      if (k !== last) { last = k; setN((n) => n + 1); }
    };
    // ~30 Hz (see useTileScreen)
    const STRIPE_FOLLOW_MS = 1000 / 30;
    const loop = () => { tick(); raf = setTimeout(loop, STRIPE_FOLLOW_MS); };
    loop();
    return () => clearTimeout(raf);
  }, [overKey, view]);
  if (!over.length) return null;
  const polys = stripePolys(view, over);
  return html`<svg class="fwheel__stripes" aria-hidden="true">
    <defs>
      <pattern id="fwheel-stripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="3.5" height="10" fill="rgba(255,178,70,.42)" />
      </pattern>
    </defs>
    ${polys.map((p) => html`<polygon key=${p.k} points=${p.pts} fill="url(#fwheel-stripe)" stroke="rgba(255,176,70,.9)" stroke-width="1.5" />`)}
  </svg>`;
}
