// render/impostor.js — shared render-target atlas for Spine impostors (render/units.js).
//
// Crowded fields render skeletons through impostors (a sprite showing a cached image of the skeleton, refreshed
// every few frames), and skeletons with clipping attachments always do: pixi-spine implements clipping with
// stencil masks, and every mask inside the main (MSAA) pass costs a render-pass break with a full-screen
// load/store on tiled GPUs. Instead of one RenderTexture per unit (one framebuffer switch each), every due
// impostor of a frame is drawn into slots of a few shared atlas pages in ONE render call per page, before the
// main pass starts:
//   page  = RenderTexture (2048² physical px) + a batch container [erasers…, skeletons…]
//   slot  = shelf-packed rect (16 px grid) owned by one unit; erased (ERASE blend quad) then redrawn when due
// Pages are created on demand (≤ MAX_PAGES); when every page is full `alloc` returns null and the unit renders
// directly (still correct, just not batched). A shelf whose last slot is freed is emptied for reuse, and empty shelves
// at the top of a page are given back (a page whose slots are all freed — every battle / prep rebuild — starts over):
// without that, zooming a crowd in and out (the enemy pen camera) left pages full of shelves of stale sizes and the
// next battle's units fell back to one private render target each. Clipped skeletons get slots on small separate "clip" pages: their
// stencil clears break the page's render pass, and the cost of a break scales with the page size.
//
//   const imp = new ImpostorAtlas(renderer)
//   const slot = imp.alloc(w, h)            // CSS px; null when full
//   imp.draw(slot, displayObject, matrixLike { a, d, tx, ty })   // queue for this frame (object must be parked here)
//   imp.park(displayObject) / imp.unpark(displayObject)          // keep skeletons of impostor units in the batch
//   imp.flush()                             // once per frame, after every unit update, before the main render
//   imp.free(slot) ; imp.destroy()

const MAX_PAGES = { main: 3, clip: 2 };
const PAGE_PX = { main: 2048, clip: 1024 };
const GRID = 16;

export class ImpostorAtlas {
  /** @param {any} renderer PIXI renderer */
  constructor(renderer) {
    this.P = globalThis.PIXI;
    this.R = renderer;
    this.res = Math.max(1, Math.min(2, renderer.resolution || 1));
    this.pages = [];
    this.parked = new this.P.Container(); // skeletons of impostor units (never rendered directly)
    this.parked.visible = false;
    this.stats = { pages: 0, slots: 0, drawn: 0, full: 0 };
  }

  /** CSS px per side of a page of `kind`. */
  sizeOf(kind) { return Math.floor(PAGE_PX[kind] / this.res); }

  _page(kind) {
    if (this.pages.filter((p) => p.kind === kind).length >= MAX_PAGES[kind]) return null;
    const P = this.P;
    const size = this.sizeOf(kind);
    const rt = P.RenderTexture.create({ width: size, height: size, resolution: this.res });
    try { rt.framebuffer.enableStencil(); } catch { /* masks fall back to scissor */ }
    const batch = new P.Container();
    const erasers = new P.Container();
    const bodies = new P.Container();
    batch.addChild(erasers, bodies);
    const page = { kind, size, rt, batch, erasers, bodies, shelves: [], nextY: 0, queued: 0, cleared: false, index: this.pages.length };
    this.pages.push(page);
    this.stats.pages = this.pages.length;
    return page;
  }

  /** Allocate a slot of at least w×h CSS px (rounded up to the grid); null when every page is full. */
  alloc(w, h, { clip = false } = {}) {
    const kind = clip ? 'clip' : 'main';
    const W = Math.max(GRID, Math.ceil(w / GRID) * GRID), H = Math.max(GRID, Math.ceil(h / GRID) * GRID);
    if (W > this.sizeOf(kind) || H > this.sizeOf(kind)) return null;
    const pages = this.pages.filter((p) => p.kind === kind);
    for (let i = 0; i <= pages.length; i++) {
      const page = pages[i] || this._page(kind);
      if (!page) break;
      const s = this._allocIn(page, W, H);
      if (s) { this.stats.slots++; return s; }
    }
    this.stats.full++;
    return null;
  }

  _allocIn(page, W, H) {
    // reuse a freed slot of a fitting size first
    for (const sh of page.shelves) {
      if (sh.h < H || sh.h > H * 1.5) continue;
      const k = sh.free.findIndex((f) => f.w >= W && f.w <= W * 1.5);
      if (k >= 0) { const f = sh.free.splice(k, 1)[0]; return this._slot(page, sh, f.x, f.w); }
      if (sh.x + W <= page.size) { const x = sh.x; sh.x += W; return this._slot(page, sh, x, W); }
    }
    if (page.nextY + H > page.size) return null;
    const sh = { y: page.nextY, h: H, x: W, free: [], live: 0 };
    page.nextY += H;
    page.shelves.push(sh);
    return this._slot(page, sh, 0, W);
  }

  _slot(page, sh, x, w) {
    const P = this.P;
    const y = sh.y, h = sh.h;
    const eraser = new P.Sprite(P.Texture.WHITE);
    eraser.blendMode = P.BLEND_MODES.ERASE;
    eraser.position.set(x, y);
    eraser.width = w; eraser.height = h;
    eraser.visible = false;
    page.erasers.addChild(eraser);
    const tex = new P.Texture(page.rt.baseTexture, new P.Rectangle(x, y, w, h));
    sh.live = (sh.live || 0) + 1;
    return { page, shelf: sh, clip: page.kind === 'clip', x, y, w, h, eraser, tex, freed: false };
  }

  free(slot) {
    if (!slot || slot.freed) return;
    slot.freed = true;
    this.stats.slots = Math.max(0, this.stats.slots - 1);
    try { slot.eraser.destroy(); } catch { /* ignore */ }
    try { slot.tex.destroy(false); } catch { /* ignore */ }
    const page = slot.page;
    const sh = slot.shelf && page.shelves.includes(slot.shelf) ? slot.shelf : page.shelves.find((s) => s.y === slot.y);
    if (!sh) return;
    sh.live = Math.max(0, (sh.live || 0) - 1);
    if (sh.live > 0) { sh.free.push({ x: slot.x, w: slot.w }); return; }
    // the shelf's last slot: empty it; empty shelves at the top of the page are given back
    sh.x = 0;
    sh.free.length = 0;
    const L = page.shelves;
    while (L.length && L[L.length - 1].live === 0) {
      const top = L.pop();
      page.nextY = top.y;
    }
  }

  /** Keep a skeleton here while its unit is an impostor (hidden unless drawn this frame). */
  park(obj) { if (obj && obj.parent !== this.parked) this.parked.addChild(obj); obj.visible = false; }
  unpark(obj) { if (obj && obj.parent === this.parked) this.parked.removeChild(obj); if (obj) obj.visible = true; }

  /** Queue `obj` to be drawn into `slot` this frame with the local transform (scale a/d, offset tx/ty in the slot). */
  draw(slot, obj, m) {
    if (!slot || slot.freed || !obj) return;
    const page = slot.page;
    slot.eraser.visible = true;
    obj.position.set(slot.x + m.tx, slot.y + m.ty);
    obj.scale.set(m.a, m.d);
    obj.visible = true;
    if (obj.parent !== page.bodies) page.bodies.addChild(obj);
    page.queued++;
  }

  /** Render every queued slot: one render call per page with queued work. */
  flush() {
    let drawn = 0;
    for (const page of this.pages) {
      if (!page.queued) continue;
      try {
        this.R.render(page.batch, { renderTexture: page.rt, clear: !page.cleared, skipUpdateTransform: false });
        page.cleared = true;
      } catch { /* lost context etc. */ }
      drawn += page.queued;
      page.queued = 0;
      for (const e of page.erasers.children) e.visible = false;
      // back to the parking lot until due again
      for (const b of [...page.bodies.children]) this.park(b);
    }
    this.stats.drawn = drawn;
  }

  destroy() {
    for (const page of this.pages) {
      try { page.batch.destroy({ children: false }); } catch { /* ignore */ }
      try { page.rt.destroy(true); } catch { /* ignore */ }
    }
    this.pages = [];
    try { this.parked.destroy({ children: false }); } catch { /* ignore */ }
  }
}
