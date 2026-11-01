// public/js/ui/cardArt.js — 名片立绘微调（业主 2026-10-28 A）
//
// 座位名片现在用的是干员**精二**立绘（`char/illust/<id>.png`）。这一层让它可调：
//   · 版本：精二 = 基础名 `char/illust/<id>.png`；精一 = **同目录同尺寸的全幅立绘** `char/illust/<id>_1.png`
//     （官方 `charId_2b` / `charId_1b` 两套立绘，**必须显式读 `_1`**，用基础名会拿到精二）。
//     两者渲染口径**完全一样**：框里 `object-fit: cover` + 缩放/平移取景，没有「简略图」角标这回事了；
//     `_1` 不存在时 `<img onError>` 退回精二 —— 回落链与以前一致。
//     （`char/illustration/<id>_1.png` 是另一套 ~0.5 MB 的简略图，**名片不再引用**，文件保留给别处用。）
//   · 缩放 0.8–2.0×（滑杆 + 桌面滚轮 + 键盘 ←/→）、框内拖拽平移（`touch-action: none` **只加在框上**）、
//     触屏双指缩放、`重置` 回「精二 / 1.0× / 居中」。
//   · 持久化：本机 pref `room.cardArt` = `{ [charId]: { art, zoom, ox, oy } }`。**刻意不并进 `CARD_PREF`** ——
//     那份是「玩家选了哪个干员」（`room.card { charId, skin }`，服务端已收），改形状会动到同步链；
//     而位置/缩放**服务端字段待定**（engine-core 未给），所以先只存本机，等协议再一起发。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

let cssLoaded = false;
/** 本模块的样式（与 ui/forge.js / ui/jibian.js 同一个懒加载写法；不进 index.html）。 */
export function ensureCardArtCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-cardart]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/card-art.css';
  link.dataset.cardart = '1';
  document.head.appendChild(link);
}

/** 立绘微调的本机 pref（按 charId 分条，互不影响）。 */
export const CARD_ART_PREF = 'room.cardArt';
/** 中立值：精二 / 1.0× / 居中。 */
export const CARD_ART_DEFAULT = Object.freeze({ art: 'e2', zoom: 1, ox: 0, oy: 0 });
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round2 = (v) => Math.round(v * 100) / 100;

/** 一条存下来的立绘设置（坏值一律回中立值）。`ox/oy` 是**框宽的百分比整数**（-100..100），可反复往返。 */
export function normalizeCardArt(v) {
  const o = v && typeof v === 'object' ? v : {};
  // 缺字段 / 坏字段一律回中立值（`clamp(undefined)` 会落到下界，那是 0.8× / -100% 的坑）
  const num = (x, def) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : def);
  return {
    art: o.art === 'e1' ? 'e1' : 'e2',
    zoom: round2(clamp(num(o.zoom, CARD_ART_DEFAULT.zoom), ZOOM_MIN, ZOOM_MAX)),
    ox: Math.round(clamp(num(o.ox, 0), -100, 100)),
    oy: Math.round(clamp(num(o.oy, 0), -100, 100)),
  };
}

function readAll() {
  try {
    const raw = loadPref(CARD_ART_PREF, null);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** 某个干员的立绘设置（没存过 = 中立值）。 */
export const cardArtOf = (charId) => normalizeCardArt(readAll()[charId]);

/**
 * 存某个干员的一处设置：`{ art?, zoom?, ox?, oy? }` 与现值合并后写回。
 * @param {string} charId @param {Partial<{art:'e1'|'e2', zoom:number, ox:number, oy:number}>} patch
 */
export function setCardArt(charId, patch) {
  if (!charId) return;
  const all = readAll();
  const next = { ...all, [charId]: normalizeCardArt({ ...cardArtOf(charId), ...patch }) };
  try { savePref(CARD_ART_PREF, next); } catch { /* 隐私模式：本次会话里仍然生效 */ }
  return next[charId];
}

/** 重置回「精二 / 1.0× / 居中」。 */
export const resetCardArt = (charId) => setCardArt(charId, CARD_ART_DEFAULT);

/**
 * 精一的立绘地址：从精二的 URL 推出来（`…/char/illust/<id>.png` → `…/char/illust/<id>_1.png`，
 * 转成 WebP 之后是 `…/char/illust/<id>.webp` → `…/char/illust/<id>_1.webp`：**只换文件名，扩展名跟着精二走**）。
 * 精一/精二是**同一套全幅立绘**的两个精英阶段（官方 `charId_1b` / `charId_2b`），同目录、同尺寸，
 * 渲染口径也一样（cover + 缩放平移），所以只换文件名。不用素材清单查：清单只登记精二的基础名，
 * 而 `_1` 是同一目录下的孪生文件，按路径推最稳；真不存在时 `<img onError>` 自己退回精二。
 * 皮肤立绘在 `illust/skin/<id>.png`，没有 `_1` 孪生 → 原样返回（精一 = 精二）。
 * @param {string|null} illustE2 `illustUrl(...)` 的结果
 * @param {'e1'|'e2'} art
 */
export function artSrcOf(illustE2, art) {
  if (!illustE2) return null;
  if (art !== 'e1') return illustE2;
  return String(illustE2).replace(/\/illust\/([^/]+)\.(png|webp)$/i, '/illust/$1_1.$2');
}

/** 框内位移的 CSS：`ox/oy` 是框宽的百分比（-100..100）。 */
export const artTransform = (value) => {
  const v = normalizeCardArt(value);
  return `translate(${v.ox}%, ${v.oy}%) scale(${v.zoom})`;
};

/**
 * 立绘调整的**纯视图**（测试直接当函数画；拖拽/滚轮/双指的监听由 `CardArt` 挂）。
 * 精一与精二是同尺寸全图，两者一律 `object-fit: cover`（框比图窄，靠缩放/平移取景）；没有「简略图」角标。
 * @param {{ charId: string, illust?: string|null, value?: any,
 *   onVersion?: (a: 'e1'|'e2') => void, onZoom?: (z: number) => void, onOffset?: (ox: number, oy: number) => void,
 *   onReset?: () => void, onBroken?: () => void, frameRef?: any }} props
 */
export function CardArtView({ charId, illust = null, value = CARD_ART_DEFAULT,
  onVersion = () => {}, onZoom = () => {}, onReset = () => {}, onBroken = () => {}, frameRef = null }) {
  ensureCardArtCss();
  const v = normalizeCardArt(value);
  const src = artSrcOf(illust, v.art);
  return html`<section class="cardart" data-testid="card-art" data-art=${v.art} data-char=${charId || null}>
    <header class="cardart__head">
      <span class="cardart__title">${t('立绘调整')}</span>
      <div class="cardart__ver" role="group" aria-label=${t('立绘')}>
        ${[['e1', t('精一')], ['e2', t('精二')]].map(([id, label]) => html`<button type="button" key=${id}
            class=${`cardart__vbtn${v.art === id ? ' is-on' : ''}`} data-art=${id}
            aria-pressed=${v.art === id ? 'true' : 'false'} onClick=${() => onVersion(id)}>${label}</button>`)}
      </div>
      <button type="button" class="cardart__reset" data-testid="card-art-reset" onClick=${onReset}>${t('重置')}</button>
    </header>
    <div class="cardart__frame" ref=${frameRef} data-testid="card-art-frame" tabindex="0"
        role="application" aria-label=${t('拖拽调整位置')} style="touch-action: none">
      ${src ? html`<img class="cardart__img" src=${src} alt="" draggable=${false}
          style=${`object-fit: cover; transform: ${artTransform(v)};`}
          onError=${() => onBroken()} />`
        : html`<span class="cardart__glyph">${[...(charId || '?')][0]}</span>`}
      <span class="cardart__hint">${t('拖拽调整位置')}</span>
    </div>
    <div class="cardart__zoom">
      <span class="cardart__zlabel">${t('缩放')}</span>
      <input type="range" class="cardart__range" data-testid="card-art-zoom" min=${ZOOM_MIN} max=${ZOOM_MAX} step="0.1"
        value=${v.zoom} aria-label=${t('缩放')}
        onInput=${(e) => onZoom(Number(e.currentTarget.value))} />
      <b class="cardart__znum num">${v.zoom.toFixed(1)}×</b>
    </div>
    <p class="cardart__pos">${t('位置')} <b class="num">${v.ox}</b> / <b class="num">${v.oy}</b></p>
  </section>`;
}

/**
 * 带交互的立绘调整：框内拖拽平移、触屏双指缩放、桌面滚轮缩放、键盘 ←/→ 调缩放。
 * 三处输入的数学都在这里（纯数值），`normalizeCardArt` 负责夹紧 —— 测试直接调 `panTo` / `pinchTo`。
 */
export function panTo(from, dx, dy, box) {
  const w = Math.max(1, Number(box?.w) || 1);
  const h = Math.max(1, Number(box?.h) || 1);
  const base = normalizeCardArt(from);
  return normalizeCardArt({ ...base, ox: base.ox + (dx / w) * 100, oy: base.oy + (dy / h) * 100 });
}

/** 双指缩放：`d0 → d1` 的比例乘在起始缩放上（夹在 0.8–2.0）。 */
export function pinchTo(from, d0, d1) {
  const base = normalizeCardArt(from);
  const ratio = d0 > 0 ? d1 / d0 : 1;
  return normalizeCardArt({ ...base, zoom: base.zoom * ratio });
}

/**
 * @param {{ charId: string, illust?: string|null }} props
 */
export function CardArt({ charId, illust = null }) {
  const [value, setValue] = useState(() => cardArtOf(charId));
  const frameRef = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  const gesture = useRef(null);
  const apply = (patch) => setValue((prev) => { const next = normalizeCardArt({ ...prev, ...patch }); setCardArt(charId, next); return next; });

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof el.addEventListener !== 'function') return undefined;
    const pts = new Map();
    const boxOf = () => {
      const r = el.getBoundingClientRect?.();
      return { w: Math.max(1, r?.width || 300), h: Math.max(1, r?.height || 400) };
    };
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const onDown = (e) => {
      pts.set(e.pointerId ?? 0, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (pts.size === 1) {
        gesture.current = { mode: 'pan', x: e.clientX ?? 0, y: e.clientY ?? 0, box: boxOf(), from: latest.current };
      } else if (pts.size === 2) {
        gesture.current = { mode: 'pinch', d0: spread(), from: latest.current };
      }
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      const id = e.pointerId ?? 0;
      if (!pts.has(id) || !gesture.current) return;
      pts.set(id, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (gesture.current.mode === 'pan' && pts.size === 1) {
        const g = gesture.current;
        const next = panTo(g.from, (e.clientX ?? 0) - g.x, (e.clientY ?? 0) - g.y, g.box);
        setValue(next);
        setCardArt(charId, next);
      } else if (gesture.current.mode === 'pinch' && pts.size === 2) {
        const next = pinchTo(gesture.current.from, gesture.current.d0, spread());
        setValue(next);
        setCardArt(charId, next);
      }
      if (typeof e.preventDefault === 'function') e.preventDefault();
    };
    const onUp = (e) => {
      const id = e.pointerId ?? 0;
      pts.delete(id);
      if (pts.size === 0) gesture.current = null;
      else if (pts.size === 1) {
        const [only] = [...pts.entries()];
        gesture.current = { mode: 'pan', x: only[1].x, y: only[1].y, box: boxOf(), from: latest.current };
      }
    };
    const onWheel = (e) => {
      // 只在框内拦滚轮（passive:false 才拦得住页面滚动），滚轮一格 ±0.1×
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom - Math.sign(e.deltaY) * 0.1 });
    };
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom + (e.key === 'ArrowRight' ? 0.1 : -0.1) });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [charId]);

  return html`<${CardArtView} charId=${charId} illust=${illust} value=${value} frameRef=${frameRef}
    onVersion=${(a) => apply({ art: a })}
    onZoom=${(z) => apply({ zoom: z })}
    onBroken=${() => { if (latest.current.art === 'e1') apply({ art: 'e2' }); }}
    onReset=${() => { setValue(resetCardArt(charId) || CARD_ART_DEFAULT); }} />`;
}

/**
 * 名片上的立绘（房间座位卡 / 大厅名字条共用）：按存下来的设置画，精一/精二都按 `cover` 取景。
 * `_1` 不存在（onError）时退回精二；**精二也失败**才回调 `onError`，交给调用方退回头像框。
 * @param {{ charId: string, illust?: string|null, class?: string, onError?: (() => void)|null }} props
 */
export function CardArtImage({ charId, illust = null, class: cls = '', onError = null }) {
  // 0 = 按 pref 画；1 = 精一的 `_1` 打不开，退到精二；2 = 精二也打不开，让调用方兜底（本组件不画）
  const [stage, setStage] = useState(0);
  ensureCardArtCss();
  const v = cardArtOf(charId);
  const art = stage === 0 && v.art === 'e1' ? 'e1' : 'e2';
  const src = stage >= 2 ? null : artSrcOf(illust, art);
  if (!src) return null;
  const broken = () => {
    if (art === 'e1') { setStage(1); return; }
    setStage(2);
    if (typeof onError === 'function') onError();
  };
  return html`<img class=${`cardart__still ${cls}`} src=${src} alt="" draggable=${false}
    data-art=${art} style=${`object-fit: cover; transform: ${artTransform(v)};`}
    onError=${broken} />`;
}
