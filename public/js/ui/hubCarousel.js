// 轮播图 — a standalone module: up to CAROUSEL_MAX pictures, 6 轮播预设 and 16 转场效果, the two-layer stage,
// its page indicator, and the whole 轮播 panel of the 大厅背景 dialog. Nothing here knows about the hub's procedural
// skyline or its single custom picture: the slideshow keeps its own IndexedDB database ('sp-hub-carousel') and its
// own localStorage pref ('hub.carousel'), and it is driven by the caller, so it can be mounted anywhere —
// ui/hubBackdrop.js simply imports useCarousel / CarouselStage / CarouselPanel and composes them into the lobby.
//
// Pictures never leave the device: each picked file is downscaled in this browser and stored as a Blob; only the
// order (a list of ids) and the settings go into the pref.
import { html } from './components.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';
import { toast } from './toasts.js';
import { isImageFile, shrinkPicture } from './pictureFile.js';

export const CAROUSEL_MAX = 20;
const CAR_EDGE = 1920; // a slideshow never needs more than this on the hub's own canvas
const CAR_FILE = 30 * 1024 * 1024; // per picked file
const CAR_BYTES = 2.4 * 1024 * 1024; // above this the re-encode gets harder, so 20 slides stay a sane size on disk
const CAR_ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
export const CAROUSEL_MODES = ['single', 'carousel'];
const PREF_KEY = 'hub.carousel';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The 转场效果 of the slideshow; hint is what the panel says about the one you picked. */
export const CAROUSEL_TRANSITIONS = [
  { id: 'fade', name: '淡入淡出', en: 'FADE', hint: '上一张留在原地，下一张淡入压上来 —— 最稳妥的转场。' },
  { id: 'slide', name: '横向推移', en: 'SLIDE', hint: '两张一起横向推过去，方向随上一张 / 下一张。' },
  { id: 'slidev', name: '纵向推移', en: 'PUSH UP', hint: '两张一起向上推，适合竖构图或风景组。' },
  { id: 'cover', name: '覆盖滑入', en: 'COVER', hint: '下一张带一道边缘光，压在上一张上面滑进来。' },
  { id: 'zoomin', name: '放大淡入', en: 'ZOOM IN', hint: '下一张由小放大淡入。' },
  { id: 'zoomout', name: '收缩落位', en: 'ZOOM OUT', hint: '下一张从放大状态收缩到位。' },
  { id: 'ken', name: '电影运镜', en: 'KEN BURNS', hint: '配合「缓慢推近」：图片边播边慢慢推近，静态图也有运镜感。' },
  { id: 'blur', name: '模糊溶解', en: 'BLUR DISSOLVE', hint: '由虚到实溶解进来，可以和「模糊」滑杆叠加。' },
  { id: 'flip', name: '翻转', en: 'FLIP', hint: '绕竖轴转过来，像翻一张卡片。' },
  { id: 'cube', name: '立方旋转', en: 'CUBE', hint: '两张像立方体的两个相邻面一起转。' },
  { id: 'wipe', name: '斜切擦除', en: 'DIAGONAL WIPE', hint: '一道斜线从左到右擦出下一张。' },
  { id: 'shutter', name: '百叶窗', en: 'SHUTTER', hint: '八条竖幅依次展开，把下一张拼出来。' },
  { id: 'split', name: '中心展开', en: 'CENTER REVEAL', hint: '下一张从画面正中向外展开。' },
  { id: 'glitch', name: '战术干扰', en: 'GLITCH', hint: '错位闪切，和大厅的扫描线、雷达同一味道。' },
  { id: 'none', name: '直接切换', en: 'CUT', hint: '不做动画，到时间就换下一张。' },
  { id: 'random', name: '随机转场', en: 'RANDOM', hint: '每换一张随机挑一种效果（不会挑到「直接切换」）；同一张在重绘时保持同样的选择。' },
];
const TRANS_IDS = CAROUSEL_TRANSITIONS.map((x) => x.id);

/** 轮播预设: one click sets the transition, its length, the interval and the slow zoom together. */
export const CAROUSEL_PRESETS = [
  { id: 'soft', name: '柔和', en: 'SOFT', to: { transition: { id: 'fade', dur: 1600, zoom: true, zoomLevel: 1.08 }, carousel: { interval: 16, shuffle: false } } },
  { id: 'film', name: '电影', en: 'CINEMA', to: { transition: { id: 'ken', dur: 1800, zoom: true, zoomLevel: 1.18 }, carousel: { interval: 12, shuffle: false } } },
  { id: 'flow', name: '流畅', en: 'FLOW', to: { transition: { id: 'slide', dur: 900, zoom: false }, carousel: { interval: 9, shuffle: false } } },
  { id: 'tact', name: '战术', en: 'TACTICAL', to: { transition: { id: 'glitch', dur: 700, zoom: false }, carousel: { interval: 8, shuffle: false } } },
  { id: 'show', name: '炫技', en: 'SHOWY', to: { transition: { id: 'cube', dur: 1100, zoom: false }, carousel: { interval: 7, shuffle: true } } },
  { id: 'snap', name: '快切', en: 'SNAP', to: { transition: { id: 'none', dur: 300, zoom: false }, carousel: { interval: 3, shuffle: true } } },
];
const PRESET_IDS = CAROUSEL_PRESETS.map((x) => x.id);

/** The pool 随机转场 picks from: every effect except itself and 直接切换. */
const RANDOM_POOL = TRANS_IDS.filter((id) => id !== 'random' && id !== 'none');
/** A stable pick for one slide: the same picture keeps the same effect across re-renders, a new page rolls again. */
function pickRandomTrans(ids, pos) {
  const key = String(ids[pos % Math.max(1, ids.length)] || '') + ':' + pos + ':sp';
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return RANDOM_POOL[h % RANDOM_POOL.length];
}
const transName = (id) => (CAROUSEL_TRANSITIONS.find((x) => x.id === id) || CAROUSEL_TRANSITIONS[0]).name;

/** The slideshow's own pref, sanitised — a device that never used it simply gets the defaults. */
export function loadCarouselPref() {
  const raw = loadPref(PREF_KEY, null);
  const o = raw && typeof raw === 'object' ? raw : {};
  const tr = o.transition && typeof o.transition === 'object' ? o.transition : {};
  const list = Array.isArray(o.list) ? o.list.filter((x) => x && typeof x.id === 'string').slice(0, CAROUSEL_MAX) : [];
  return {
    mode: CAROUSEL_MODES.includes(o.mode) ? o.mode : 'single',
    list: list.map((x) => ({ id: x.id, name: typeof x.name === 'string' ? x.name.slice(0, 60) : '' })),
    interval: clamp(num(o.interval, 12), 2, 120),
    shuffle: o.shuffle === true,
    loop: o.loop !== false,
    paused: o.paused === true,
    transition: {
      id: TRANS_IDS.includes(tr.id) ? tr.id : 'fade',
      dur: clamp(num(tr.dur, 1200), 200, 4000),
      zoom: tr.zoom !== false,
      zoomLevel: clamp(num(tr.zoomLevel, 1.16), 1.02, 1.5),
    },
    preset: PRESET_IDS.includes(o.preset) ? o.preset : null,
  };
}

/**
 * One-time move off the first cut, which kept the slideshow inside the backdrop's own pref ('hub.backdrop') and
 * inside its database ('sp-hub-backdrop', store 'carousel'). Runs before anything reads the new pref, and is a
 * no-op on a device that only ever used this module.
 */
function migrateLegacyPrefs() {
  try {
    if (globalThis.localStorage?.getItem('sp.pref.' + PREF_KEY) != null) return;
    const raw = globalThis.localStorage?.getItem('sp.pref.hub.backdrop');
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || (!o.carousel && !o.transition && o.mode === undefined)) return;
    const car = o.carousel && typeof o.carousel === 'object' ? o.carousel : {};
    savePref(PREF_KEY, {
      mode: o.mode, list: car.list, interval: car.interval, shuffle: car.shuffle, loop: car.loop, paused: car.paused,
      transition: o.transition, preset: o.preset,
    });
    delete o.mode; delete o.carousel; delete o.transition; delete o.preset;
    savePref('hub.backdrop', o);
  } catch { /* a pref we cannot read is simply left alone */ }
}
migrateLegacyPrefs();

// ---- the slide store: this module's own IndexedDB (Blobs, no base64 bloat, no localStorage quota) ----------------
const DB_NAME = 'sp-hub-carousel';
const DB_VERSION = 1;
const SLIDES = 'slides';
// the first cut kept the slides inside the backdrop's database; migrateLegacySlides() moves them out of it
const LEGACY_DB = 'sp-hub-backdrop';
const LEGACY_VERSION = 2;
const LEGACY_STORE = 'carousel';

function openDb(name, version, store, keyPath) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('no indexedDB')); return; }
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, keyPath ? { keyPath } : undefined);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}
function withStore(mode, fn) {
  return openDb(DB_NAME, DB_VERSION, SLIDES, 'id').then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SLIDES, mode);
    const rq = fn(tx.objectStore(SLIDES));
    tx.oncomplete = () => { db.close(); resolve(rq ? rq.result : undefined); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}
const getAll = () => withStore('readonly', (s) => s.getAll());
const putRow = (row) => withStore('readwrite', (s) => s.put(row));
const delRow = (id) => withStore('readwrite', (s) => s.delete(id));
const clearAll = () => withStore('readwrite', (s) => s.clear());

/** A short plain-text id for a slide (it also lives in the localStorage pref, so no odd characters). */
function slideId() {
  let s = '';
  for (let i = 0; i < 12; i++) s += CAR_ID_CHARS[(Math.random() * CAR_ID_CHARS.length) | 0];
  return Date.now().toString(36) + s;
}

/**
 * Move the slides out of the backdrop's database (the first cut kept them in a store named 'carousel' there).
 * Silent when there is nothing to move, which is the case on any device that only ever used this module.
 */
async function migrateLegacySlides() {
  let rows = null;
  try {
    const db = await openDb(LEGACY_DB, LEGACY_VERSION, LEGACY_STORE, 'id');
    rows = await new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(LEGACY_STORE)) { db.close(); resolve(null); return; }
      const tx = db.transaction(LEGACY_STORE, 'readonly');
      const rq = tx.objectStore(LEGACY_STORE).getAll();
      tx.oncomplete = () => { db.close(); resolve(rq.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  } catch { return; }
  if (!Array.isArray(rows) || !rows.length) return;
  try {
    for (const r of rows) if (r && typeof r.id === 'string' && r.blob instanceof Blob) await putRow(r);
    // the copies are in: empty the legacy store so the pictures are not kept twice
    const db = await openDb(LEGACY_DB, LEGACY_VERSION, LEGACY_STORE, 'id');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LEGACY_STORE, 'readwrite');
      tx.objectStore(LEGACY_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  } catch { /* the originals stay where they are; the next visit tries again */ }
}

/** A slide's Blob: downscaled for a slideshow, and re-encoded harder when the file is a monster. */
const shrinkSlide = (file) => shrinkPicture(file, CAR_EDGE, file.size > CAR_BYTES ? 0.72 : 0.84);

/**
 * The slideshow runner: which slide is on screen, which way it came from, when the next one is due, the transition to
 * play and the transport (the strip's thumbnails, arrow keys and Space). The caller's 'shuffle' setting
 * permutes the order from the slide ids, so a reload keeps the same run.
 */
function useCarouselRunner(pref, n, ids, update, motion) {
  const [pos, setPos] = useState(0);
  const [dir, setDir] = useState(1);
  const order = useMemo(() => {
    const a = Array.from({ length: n }, (_, i) => i);
    if (!pref.shuffle || n < 2) return a;
    let h = 2166136261;
    for (const x of pref.list) for (let i = 0; i < x.id.length; i++) h = Math.imul(h ^ x.id.charCodeAt(i), 16777619) >>> 0;
    const rnd = shuffleRng(h || 1);
    for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }, [n, pref.shuffle, pref.list]);
  const at = n ? clamp(pos, 0, n - 1) : 0;
  const rowIdx = n ? order[at] : -1;
  const prevIdx = n ? order[(at - dir + n) % n] : -1;
  const intervalMs = clamp(num(pref.interval, 12), 2, 120) * 1000;
  const playing = pref.mode === 'carousel' && n > 1 && !pref.paused && pref.loop;
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => { setDir(1); setPos((p) => (clamp(p, 0, n - 1) + 1) % n); }, intervalMs);
    return () => clearTimeout(t);
  }, [playing, at, n, intervalMs]);
  const go = (step) => { if (!n) return; setDir(step > 0 ? 1 : -1); setPos((p) => (clamp(p, 0, n - 1) + step + n) % n); };
  /** Jump straight to one slide: `row` is the index into the caller's stored list, i.e. one thumbnail of the strip. */
  const goTo = (row) => {
    if (!n) return;
    const p = order.indexOf(row);
    if (p < 0 || p === at) return;
    setDir(p > at ? 1 : -1);
    setPos(p);
  };
  // 换页不再由「点大厅」触发：轮播图面板里的缩略图点哪张就切到哪张（car.goTo），大厅本身保持安静。
  // ArrowLeft / ArrowRight turn the pages and Space pauses, with the dialog closed and no field focused
  useEffect(() => {
    if (pref.mode !== 'carousel' || n < 1) return undefined;
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== ' ' && e.code !== 'Space') return;
      const el = e.target;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      if (document.body && document.body.classList.contains('hub-dialog-open')) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else update({ paused: !pref.paused });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [pref.mode, n, pref.paused]);
  const paused = pref.mode === 'carousel' && n > 1 && !!pref.paused;
  const want = motion ? pref.transition.id : 'none';
  // 随机转场 resolves to one concrete effect per slide, so the CSS only ever sees a real name
  const resolved = want === 'random' ? pickRandomTrans(ids, at) : want;
  return {
    order, pos: at, n, rowIdx, prevIdx, dir, playing, paused, go, goTo,
    setPaused: (v) => update({ paused: !!v }),
    intervalMs,
    transId: resolved, wantRandom: pref.transition.id === 'random',
    dur: motion ? clamp(num(pref.transition.dur, 1200), 200, 4000) : 0,
    zoom: motion && pref.transition.zoom,
    zoomLevel: clamp(num(pref.transition.zoomLevel, 1.16), 1.02, 1.5),
  };
}
/** A tiny deterministic generator for the shuffle order (no Math.random: a reload keeps the same run). */
function shuffleRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * The slideshow's public hook — this is all a caller needs.
 * @param {{ motion?: boolean }} [options] motion: the host's 动态效果 switch; off collapses every 转场 to a cut.
 * @returns {{ pref: object, update: Function, ready: boolean, stored: {id,name}[], urls: string[],
 *             add: Function, remove: Function, move: Function, clear: Function, car: object }}
 */
export function useCarousel(options = {}) {
  const motion = options.motion !== false;
  const [pref, setPref] = useState(loadCarouselPref);
  /** patch is a whole-pref object or a function of the latest pref: every write goes through here. */
  const update = (patch) => setPref((p) => {
    const next = typeof patch === 'function' ? { ...p, ...patch(p) } : { ...p, ...patch };
    savePref(PREF_KEY, next);
    return next;
  });

  const [blobs, setBlobs] = useState(() => new Map()); // slide id -> Blob (the pref only keeps the order)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      await migrateLegacySlides();
      try {
        const rows = await getAll();
        if (dead || !Array.isArray(rows)) return;
        const m = new Map();
        for (const r of rows) if (r && typeof r.id === 'string' && r.blob instanceof Blob) m.set(r.id, r.blob);
        setBlobs(m);
      } catch { /* nothing readable: the slideshow simply starts empty */ }
      finally { if (!dead) setReady(true); }
    })();
    return () => { dead = true; };
  }, []);

  const stored = useMemo(() => pref.list.filter((x) => blobs.has(x.id)), [pref.list, blobs]);
  /** Object URLs of the slides, keyed by id — state, so a slide that just arrived repaints the stage. */
  const [urlMap, setUrlMap] = useState(() => new Map());
  useEffect(() => {
    setUrlMap((m) => {
      let next = null;
      for (const x of stored) if (!m.has(x.id) && blobs.has(x.id)) {
        next = next || new Map(m);
        next.set(x.id, URL.createObjectURL(blobs.get(x.id)));
      }
      return next || m;
    });
  }, [stored, blobs]);
  // a slide that left the list for good: its URL is revoked once the outgoing layer had time to fade away
  useEffect(() => {
    const live = new Set(stored.map((x) => x.id));
    const gone = [...urlMap.keys()].filter((id) => !live.has(id));
    if (!gone.length) return undefined;
    const t = setTimeout(() => setUrlMap((m) => {
      const next = new Map(m);
      for (const id of gone) if (next.has(id)) { URL.revokeObjectURL(next.get(id)); next.delete(id); }
      return next;
    }), 8000);
    return () => clearTimeout(t);
  }, [stored, urlMap]);
  /** Index-aligned with stored: a slide whose URL is not ready yet holds its place with an empty string. */
  const urls = useMemo(() => stored.map((x) => urlMap.get(x.id) || ''), [stored, urlMap]);

  /** @returns {Promise<{added:number, failed:number, dropped:number}>} */
  const add = async (files) => {
    const picked = files.slice(0, Math.max(0, CAROUSEL_MAX - pref.list.length));
    let added = 0; let failed = 0;
    const rows = [];
    for (const f of picked) {
      try {
        const id = slideId();
        const blob = await shrinkSlide(f);
        try { await putRow({ id, blob, name: String(f.name || '').slice(0, 60), added: Date.now() }); }
        catch { await delRow(id).catch(() => {}); failed += 1; continue; }
        setBlobs((m) => { const n = new Map(m); n.set(id, blob); return n; });
        rows.push({ id, name: String(f.name || '').slice(0, 60) });
        added += 1;
      } catch { failed += 1; }
    }
    if (rows.length) update((p) => ({ list: [...p.list, ...rows].slice(0, CAROUSEL_MAX) }));
    return { added, failed, dropped: files.length - picked.length };
  };
  const remove = async (id) => {
    try { await delRow(id); } catch { /* nothing stored */ }
    update((p) => ({ list: p.list.filter((x) => x.id !== id) }));
  };
  /** Move a slide one slot forward / back: a reorder never touches the bytes. */
  const move = (id, by) => update((p) => {
    const i = p.list.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= p.list.length) return {};
    const list = [...p.list];
    list.splice(j, 0, list.splice(i, 1)[0]);
    return { list };
  });
  const clear = async () => {
    try { await clearAll(); } catch { /* nothing stored */ }
    setBlobs(new Map());
    update({ list: [] });
  };
  const ids = useMemo(() => pref.list.map((x) => x.id), [pref.list]);
  const car = useCarouselRunner(pref, stored.length, ids, update, motion);
  return { pref, update, ready, stored, urls, add, remove, move, clear, car };
}

/** The picture rides on the inner element, so a transition owns the outer layer untouched. */
const picVars = (url, blur) => '--car-img:' + (url ? 'url("' + url + '")' : 'none') + ';--car-blur:' + (blur || 0) + 'px';

/**
 * The slideshow: two stacked layers (the outgoing one and the incoming one) and a page indicator.
 * Every 转场 is a CSS animation on the incoming layer, keyed by the slide, so it restarts on each change; the
 * outgoing layer freezes at the end of its own animation, which is exactly what it looked like a moment ago.
 * The layer itself never takes a click (whatever is stacked above it stays usable): 换页靠 轮播图 面板里的缩略图，
 * 点哪一张就切到哪一张，也可以按 ← / → 与空格。
 */
export function CarouselStage({ car, urls, blur = 0, dim = 0, overlay = false }) {
  const { n, rowIdx, prevIdx } = car;
  if (!n || !urls.length) return null;
  const cur = urls[Math.min(rowIdx, urls.length - 1)] || null;
  const prev = n > 1 ? (urls[Math.min(prevIdx, urls.length - 1)] || null) : null;
  const vars = '--car-dur:' + car.dur + 'ms;--car-int:' + car.intervalMs + 'ms;--car-zoom:' + car.zoomLevel;
  return html`<div class="hub-bg__car" data-trans=${car.transId} data-dir=${car.dir > 0 ? 'next' : 'prev'}
      data-motion=${car.dur ? 'on' : 'off'} data-zoom=${car.zoom ? 'on' : 'off'} data-play=${car.playing ? 'on' : 'off'}
      data-pages=${n > 1 ? 'on' : 'off'} style=${vars} aria-hidden="true">
    ${prev && cur && prev !== cur ? html`<div key=${'out' + prevIdx} class="hub-bg__slide is-out"><i style=${picVars(prev, blur)}></i></div>` : null}
    <div key=${'in' + rowIdx} class="hub-bg__slide is-in" data-blank=${cur ? 'no' : 'yes'}><i style=${picVars(cur || '', blur)}></i>
      ${car.transId === 'shutter' && car.dur ? html`<span class="hub-bg__louvers">${Array.from({ length: 8 }, (_, i) => html`<b key=${i} style=${'--lv:' + i}></b>`)}</span>` : null}
    </div>
    <div class="hub-bg__shade" style=${'opacity:' + dim / 100}></div>
    ${overlay ? html`<div class="hub-bg__grid"></div><div class="hub-bg__dots"></div>` : null}
    ${n > 1 ? html`<div class="hub-car">
      <span class="hub-car__n num">${car.pos + 1}/${n}</span>
      <span class="hub-car__dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => html`<i key=${i} class=${i === car.pos ? 'is-on' : ''}></i>`)}</span>
      <span class="hub-car__bar" aria-hidden="true"><b key=${'bar' + car.pos}></b></span>
      <span class="hub-car__hint num">${car.paused ? '已暂停 · 空格继续' : '点缩略图切换 · ← → 换页 · 空格暂停'}</span>
      ${car.wantRandom ? html`<span class="hub-car__trans">${transName(car.transId)}</span>` : null}
    </div>` : null}
  </div>`;
}

/** The slideshow glyph of the 单张 / 轮播 switch: three stacked frames. */
export function CarouselGlyph() {
  return html`<svg class="bgset__modeicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M3 6h13v12H3zm14.4 1.8h2.6v8.4h-2.6zM1.6 8.4h1v7.2h-1z" />
    <path fill="currentColor" fill-rule="evenodd" d="M5 8h9v8H5zm2.2 2v4l3.8-2z" />
  </svg>`;
}

/**
 * The 轮播图 settings panel: the slide strip and its CRUD, the transport, the 轮播预设, the 转场效果 (including
 * 随机转场) and the rhythm switches. It is self-contained — pass it what useCarousel() returned:
 *
 *   const slideshow = useCarousel({ motion: pref.motion });
 *   ... html`<${CarouselPanel} slideshow=${slideshow} />`
 *
 * The host's own look (dim / blur / overlay) stays with the host: this panel only edits the slideshow.
 */
export function CarouselPanel({ slideshow }) {
  const { pref, update, stored, urls, add, remove, move, clear, car } = slideshow;
  const manyRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const browseMany = () => manyRef.current?.click();
  const onMany = async (e) => {
    const input = e.currentTarget;
    const all = [...(input.files || [])];
    input.value = '';
    if (!all.length) return;
    const pics = all.filter(isImageFile);
    const tooBig = pics.filter((f) => f.size > CAR_FILE).length;
    const ok = pics.filter((f) => f.size <= CAR_FILE);
    if (!ok.length) { toast(all.length > pics.length ? '所选文件里没有图片' : '这些图片都太大（单张上限 30MB）', 'warn'); return; }
    setBusy(true);
    try {
      const r = await add(ok);
      const bits = [];
      if (r.added) bits.push('已加入 ' + r.added + ' 张');
      if (r.dropped) bits.push('超出 ' + CAROUSEL_MAX + ' 张上限，忽略 ' + r.dropped + ' 张');
      if (r.failed + tooBig) bits.push((r.failed + tooBig) + ' 张没能加入');
      if (r.added) {
        if (pref.mode !== 'carousel') update({ mode: 'carousel' });
        toast(bits.join('；'), 'info');
      } else toast(bits.join('；') || '没有图片被加入', 'warn');
    } finally {
      setBusy(false);
    }
  };
  /** A 预设 sets transition + length + interval + zoom at once; picking it again re-applies it. */
  const applyPreset = (p) => {
    update({ mode: 'carousel', preset: p.id, transition: { ...pref.transition, ...p.to.transition }, ...p.to.carousel });
    toast('已套用「' + p.name + '」预设', 'info');
  };
  const setTr = (patch) => update({ preset: null, transition: { ...pref.transition, ...patch } });
  const tr = pref.transition;
  const hint = (CAROUSEL_TRANSITIONS.find((x) => x.id === tr.id) || CAROUSEL_TRANSITIONS[0]).hint;
  const missing = pref.list.length - stored.length;
  return html`<div class="bgset__panel bgset__panel--car">
    <input ref=${manyRef} type="file" accept="image/*" multiple hidden onChange=${onMany} />
    <div class="bgset__carhead">
      <span class="bgset__count"><b class="num">${stored.length}</b><span>/${CAROUSEL_MAX} 张</span>
        ${missing > 0 ? html`<span class="bgset__warn">（${missing} 张在本浏览器里找不到了）</span>` : null}
      </span>
      <span class="bgset__row">
        <button type="button" class="btn btn--secondary btn--sm" disabled=${busy} onClick=${browseMany}>
          <span class="btn__label">${busy ? '处理中…' : '添加图片'}</span></button>
        <button type="button" class="btn btn--ghost btn--sm" disabled=${busy || !stored.length} onClick=${() => clear()}>
          <span class="btn__label">清空</span></button>
      </span>
    </div>
    ${stored.length ? html`<div class="bgset__strip" role="list" aria-label="轮播图片顺序">
      ${stored.map((x, i) => html`<div key=${x.id} role="listitem" title=${(x.name || '') + '（点这一张就切到它）'}
          class=${'bgset__thumb' + (car.order[car.pos] === i ? ' is-playing' : '')}
          style=${'background-image:url("' + (urls[i] || '') + '")'}
          onClick=${(e) => { if (e.target && e.target.closest && e.target.closest('.bgset__thumb-acts')) return; car.goTo(i); }}>
        <span class="bgset__thumb-n num">${i + 1}</span>
        <span class="bgset__thumb-acts">
          <button type="button" title="前移" disabled=${i === 0} onClick=${() => move(x.id, -1)}>◀</button>
          <button type="button" title="后移" disabled=${i === stored.length - 1} onClick=${() => move(x.id, 1)}>▶</button>
          <button type="button" title="移除这张" onClick=${() => remove(x.id)}>×</button>
        </span>
      </div>`)}
    </div>` : html`<button type="button" class="bgset__drop" onClick=${browseMany}>
      <span class="bgset__plus">+</span><span>添加图片（可一次多选，最多 ${CAROUSEL_MAX} 张）</span>
    </button>`}

    ${stored.length > 1 ? html`<div class="bgset__transport">
      <button type="button" class="btn btn--ghost btn--sm" onClick=${() => car.go(-1)}><span class="btn__label">◀ 上一张</span></button>
      <button type="button" class="btn btn--secondary btn--sm" onClick=${() => car.setPaused(!car.paused)}>
        <span class="btn__label">${car.paused ? '继续播放' : '暂停轮播'}</span></button>
      <button type="button" class="btn btn--ghost btn--sm" onClick=${() => car.go(1)}><span class="btn__label">下一张 ▶</span></button>
    </div>` : null}

    <div class="bgset__group" role="radiogroup" aria-label="轮播预设">
      <span class="bgset__label">轮播预设</span>
      <div class="bgset__presetrow">
        ${CAROUSEL_PRESETS.map((p) => html`<button key=${p.id} type="button" role="radio" aria-checked=${pref.preset === p.id ? 'true' : 'false'}
            class=${'bgset__preset' + (pref.preset === p.id ? ' is-selected' : '')} onClick=${() => applyPreset(p)}>
          <span class="bgset__tname">${p.name}</span><span class="bgset__ten">${p.en}</span>
        </button>`)}
      </div>
    </div>

    <div class="bgset__group" role="radiogroup" aria-label="转场效果">
      <span class="bgset__label">转场效果${car.dur ? '' : '（动态效果已关闭）'}</span>
      <div class="bgset__transgrid">
        ${CAROUSEL_TRANSITIONS.map((x) => html`<button key=${x.id} type="button" role="radio" aria-checked=${tr.id === x.id ? 'true' : 'false'}
            class=${'bgset__transbtn' + (tr.id === x.id ? ' is-selected' : '')}
            onClick=${() => { setTr({ id: x.id }); if (car.n > 1) car.go(1); }}>
          <span class="bgset__tname">${x.name}</span><span class="bgset__ten">${x.en}</span>
        </button>`)}
      </div>
      <p class="bgset__note">${hint}${tr.id === 'random' && car.n > 0 ? '（本次：' + transName(car.transId) + '）' : ''}</p>
    </div>

    <label class="bgset__slider"><span>间隔</span>
      <input type="range" min="2" max="120" step="1" value=${pref.interval}
        onInput=${(e) => update({ interval: Number(e.currentTarget.value) })} />
      <b class="num">${pref.interval}s</b></label>
    <label class="bgset__slider"><span>转场时长</span>
      <input type="range" min="200" max="4000" step="100" value=${tr.dur}
        onInput=${(e) => setTr({ dur: Number(e.currentTarget.value) })} />
      <b class="num">${(tr.dur / 1000).toFixed(1)}s</b></label>
    <label class="bgset__check"><input type="checkbox" checked=${pref.loop}
      onChange=${(e) => update({ loop: e.currentTarget.checked })} /><span>自动轮播（关闭后停在当前这张）</span></label>
    <label class="bgset__check"><input type="checkbox" checked=${pref.shuffle}
      onChange=${(e) => update({ preset: null, shuffle: e.currentTarget.checked })} /><span>随机顺序</span></label>
    <label class="bgset__check"><input type="checkbox" checked=${tr.zoom}
      onChange=${(e) => setTr({ zoom: e.currentTarget.checked })} /><span>缓慢推近（Ken Burns）</span></label>
    ${tr.zoom ? html`<label class="bgset__slider"><span>推近</span>
      <input type="range" min="1.02" max="1.5" step="0.01" value=${tr.zoomLevel}
        onInput=${(e) => setTr({ zoomLevel: Number(e.currentTarget.value) })} />
      <b class="num">${Math.round((tr.zoomLevel - 1) * 100)}%</b></label>` : null}
  </div>`;
}
