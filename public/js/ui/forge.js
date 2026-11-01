// public/js/ui/forge.js — 炸惊模拟「锻造器」（业主 2026-10-14 / 本仓 2026-10-28）：HUD 按钮 / 悬浮窗 / 计数 / 已锻造面板。
//
// 这一层**只负责显示与上报**（与包内 modref/v2.1/public/js/ui/forge.js 同一条纪律）：
//   · 数值表、抽卡、已锻造累计的算法全在 `shared/forgeData.js`（服务端与浏览器同一份，engine-core T11 移植，不另写一份）；
//   · 数量 `count`、已锻造表 `forged`、当前这一组 `rolled` 都是**服务端权威**，随 `m.private.forge` 下发
//     （engine-core 2026-10-28 回执：`{ count, killsPaid, elites, per, forged: { [optId]: { total, count } }, rolled: { rarity, picks[] } | null }`，
//     只在炸惊房出现；官方房 / 湮灭房整个键都不下发 ⇒ 这里也就不画按钮）；
//   · 点一张卡 → `g.forgeTake { optId, rarity }`（两个字段都必须带，服务端会核对 rarity 与 `rolled.rarity` 一致）
//     → 服务端扣数 / 累计 / 抽下一组，回一帧新的 `m.private.forge`，按钮上的数字与已锻造面板跟着变。
//   · 选完之后窗的去留（业主 2026-10-16 定案）：**还有存货就留在原地接下一组，选完最后一个才关**。
//     拿到新的锻造器时**不主动弹窗**（要玩家自己点 HUD 按钮）。
//
// 观战（engine-core）：队友的锻造器在 `m.field.forge`（同形状），本模块不关心来源，调用方传进来即可。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { GIcon } from './gameComponents.js';
import { t, tParts } from '../../../shared/i18n.js';
import { FORGE_RARITY, FORGE_KILLS_PER, forgeOptionById, forgedEntries, forgedText, forgedCount, valueText, valueNote } from '../../../shared/forgeData.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export { FORGE_RARITY, FORGE_KILLS_PER };

let cssLoaded = false;
/** 本模块的样式（与 ui/relics.js / ui/jibian.js 同一个懒加载写法）。 */
function ensureCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-forge]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/forge.css';
  link.dataset.forge = '1';
  document.head.appendChild(link);
}

/** 服务端下发的 forge 块（缺省时给一个空壳，UI 不会崩）。 */
export function forgeOf(forge) {
  return {
    count: Math.max(0, Math.floor(Number(forge && forge.count) || 0)),
    per: Math.max(1, Math.floor(Number(forge && forge.per) || FORGE_KILLS_PER)),
    forged: (forge && forge.forged) || null,   // { [optId]: { total, count } }（也认旧版数组，forgedEntries 三种都认）
    rolled: (forge && forge.rolled) || null,   // { rarity, picks: [optId] }
    killsPaid: Math.max(0, Math.floor(Number(forge && forge.killsPaid) || 0)),
    elites: Math.max(0, Math.floor(Number(forge && forge.elites) || 0)),
  };
}

/** 把服务端的 rolled 展开成卡片数据（选项记录来自共享表）。 */
export function cardsOf(rolled) {
  if (!rolled || !Array.isArray(rolled.picks)) return { rarity: 'normal', picks: [] };
  return { rarity: rolled.rarity, picks: rolled.picks.map((id) => forgeOptionById(id)).filter(Boolean) };
}

/** 悬浮窗的 key：换一组就重挂载 → 重播入场动画。 */
const rollKey = (rolled) => (rolled ? `${rolled.rarity}:${(rolled.picks || []).join(',')}` : '');

const rarityName = (rarity) => (FORGE_RARITY.find((r) => r.id === rarity) || {}).name || '普通';

// ── 本地 UI 状态（只有「开着没开着」和「点了哪张」这类纯界面的事） ─────────────────────────────
const listeners = new Set();
let ui = { open: false, forgedOpen: false, picked: null };
const emit = () => { for (const f of listeners) f(ui); };
const patch = (p) => { ui = { ...ui, ...p }; emit(); };
/** 开「锻造器」悬浮窗。 */
export function forgeOpen() { patch({ open: true, picked: null }); }
/** 关「锻造器」悬浮窗。 */
export function forgeClose() { patch({ open: false }); }
/**
 * 只记「点了哪一张」（抉择弹窗的高亮）：局内胶囊（screens/game.js）把抉择弹窗直接挂在屏幕上，
 * 高亮仍走这一份状态，和 ForgeButtonView 自己那套是同一个字段。换一组 / 重开时传 null 清掉。
 */
export function forgePick(optId) { patch({ picked: optId == null ? null : String(optId) }); }
/** 开/关「已锻造属性」面板。 */
export function forgedToggle(open) { patch({ forgedOpen: open == null ? !ui.forgedOpen : !!open }); }
/** 只读给测试 / 极端情况（离开对局时复位）。 */
export const forgeUi = () => ui;

/** Hook: 订阅界面状态。 */
function useUi() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return ui;
}

/**
 * 怪物杀敌计数器 + 距离下一个锻造器的进度（`m.private.stats.kills` 与 `forge.per`）。
 * @param {{ kills?: number, per?: number, class?: string }} props
 */
export function KillCounter({ kills, per, class: cls = '' } = {}) {
  const k = Math.max(0, Math.floor(Number(kills) || 0));
  const step = Math.max(1, Math.floor(Number(per) || FORGE_KILLS_PER));
  const done = k % step;
  const left = step - done;
  const pct = (done / step) * 100;
  return html`<span class=${cx('kills', cls)} data-testid="forge-kills" title=${tParts('已击败 {n} 名敌人 · 再击败 {left} 名可获得锻造器',
      { n: html`<b>${k}</b>`, left: html`<b>${left}</b>` })}>
    <${Icon} name="sword" class="kills__icon" />
    <b key=${k} class="kills__n num is-bump">${k}</b>
    <span class="kills__sub num">${done}/${step}</span>
    <span class="kills__bar" aria-hidden="true"><i style=${`width:${pct}%`}></i></span>
  </span>`;
}

/**
 * 「锻造器」按钮 + 悬浮窗。数量与卡面都来自 `forge`（服务端权威；没有这个块就不画）。
 * The stateful wrapper (the open/picked flips) — `ForgeButtonView` is the pure half a test draws.
 * @param {{ forge?: any, onTake?: ((optId: string, rarity: string) => void)|null, class?: string }} props
 */
export function ForgeButton({ forge = null, onTake = null, class: cls = '' }) {
  const s = useUi();
  return html`<${ForgeButtonView} forge=${forge} onTake=${onTake} ui=${s} class=${cls} />`;
}

/**
 * The button + its panel, drawn from `ui` (pure: no hooks — test/ui draws it as a function).
 * @param {{ forge?: any, onTake?: ((optId: string, rarity: string) => void)|null, ui?: { open?: boolean, picked?: string|null }, class?: string }} props
 */
export function ForgeButtonView({ forge = null, onTake = null, ui = { open: false, picked: null }, class: cls = '' }) {
  ensureCss();
  const s = { open: ui.open === true, picked: ui.picked ?? null };
  const f = forgeOf(forge);
  const n = f.count;
  const cards = cardsOf(f.rolled);
  return html`<span class=${cx('forge', cls)}>
    <button type="button" class=${cx('forge__btn', n > 0 && 'is-ready', s.open && 'is-on')}
      data-testid="forge-button" aria-label=${t('锻造器')} title=${t('锻造器')}
      aria-disabled=${n > 0 ? 'false' : 'true'}
      onClick=${() => (s.open ? forgeClose() : forgeOpen())}>
      <${GIcon} name="forge" class="forge__icon" />
      <b key=${n} class="forge__n num">${n}</b>
    </button>
    ${s.open && f.rolled && cards.picks.length
      ? html`<${ForgePanelView} key=${rollKey(f.rolled)} rarity=${cards.rarity} picks=${cards.picks}
          left=${n} forged=${f.forged} picked=${s.picked} onClose=${forgeClose}
          onPick=${(opt) => {
            patch({ picked: opt.id });
            onTake?.(opt.id, cards.rarity);
            // 业主 2026-10-16：还有存货就留在原地接下一组（服务端扣数后立刻抽好下一组，下一帧 rolled 换掉 →
            // ForgePanelView 的 key 变了 → 重挂载 → 重播入场），最后一个才关窗。`n` 是点击前这一帧的数量。
            if (n > 1) patch({ picked: null });
            else forgeClose();
          }} />`
      : null}
  </span>`;
}

/**
 * 悬浮窗：同稀有度的三张卡，点一张即选中（✕ / Esc / 遮罩都能关）。
 * The stateful wrapper — `ForgePanelView` is the pure half.
 * @param {{ rarity: string, picks: any[], left: number, forged?: any, onClose: () => void, onPick: (opt: any) => void }} props
 */
export function ForgePanel({ rarity, picks, left, forged = null, onClose, onPick }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [onClose]);
  const s = useUi();
  return html`<${ForgePanelView} rarity=${rarity} picks=${picks} left=${left} forged=${forged} picked=${s.picked}
    onClose=${onClose} onPick=${onPick} />`;
}

/**
 * 悬浮窗的纯视图。
 * @param {{ rarity: string, picks: any[], left: number, forged?: any, picked?: string|null, onClose?: () => void, onPick?: (opt: any) => void }} props
 */
export function ForgePanelView({ rarity, picks = [], left = 0, forged = null, picked = null, onClose = () => {}, onPick = () => {} }) {
  ensureCss();
  return html`<div class="forgeov" role="dialog" aria-label=${t('锻造器')} data-rarity=${rarity} data-testid="forge-panel">
    <div class="forgeov__scrim" onClick=${onClose}></div>
    <div class="forgeov__box">
      <header class="forgeov__head">
        <span class="forgeov__title">${t('锻造器')}</span>
        <span class=${cx('forgeov__rarity', `is-${rarity}`)}>${t(rarityName(rarity))}</span>
        <span class="forgeov__left">${t('剩余')}<b class="num" data-testid="forge-left">${left}</b></span>
        <button type="button" class="forgeov__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}>
          <${GIcon} name="close" />
        </button>
      </header>
      <${ForgeCardsView} meta=${false} rarity=${rarity} picks=${picks} left=${left} forged=${forged} picked=${picked} onPick=${onPick} />
    </div>
  </div>`;
}

/**
 * 锻造器的**正文**（不带 `.forgeov` 外壳）：稀有度 + 剩余、提示、三张卡、已锻造一排、页脚。
 * 悬浮窗（ForgePanelView）与局内「模式工具」面板的「锻造器」页签（ui/hud.js ModeToolsPanelView）共用这一份。
 * `meta: false` = 外壳自己已经在标题栏里画了稀有度与剩余（悬浮窗）。
 * @param {{ rarity: string, picks?: any[], left?: number, forged?: any, picked?: string|null, onPick?: (opt: any) => void, meta?: boolean }} props
 */
export function ForgeCardsView({ rarity, picks = [], left = 0, forged = null, picked = null, onPick = () => {}, meta = true }) {
  ensureCss();
  const has = forgedCount(forged);
  return html`<div class="forgeov__cards" data-rarity=${rarity} data-count=${picks.length}>
    ${meta ? html`<div class="forgeov__head">
      <span class=${cx('forgeov__rarity', `is-${rarity}`)}>${t(rarityName(rarity))}</span>
      <span class="forgeov__left">${t('剩余')}<b class="num" data-testid="forge-left">${left}</b></span>
    </div>` : null}
    ${picks.length ? html`<p class="forgeov__tip">${t('悬停预览，点击确认')}</p>
      <div class="forgeov__grid" data-count=${picks.length}>
        ${picks.map((o, i) => html`<button key=${o.id} type="button" style=${`--i:${i}`}
          class=${cx('fcard', `fcard--${rarity}`, picked === o.id && 'is-picked')}
          data-testid=${`forge-card-${o.id}`} onClick=${() => onPick(o)}>
          <span class="fcard__top">
            <span class="fcard__name">${t(o.name)}</span>
            <${MicroLabel}>${o.id.toUpperCase()}<//>
          </span>
          <span class="fcard__value num">${valueText(o, rarity)}</span>
          ${valueNote(o, rarity) ? html`<span class="fcard__note">${t(valueNote(o, rarity))}</span>` : null}
          ${o.hint ? html`<span class="fcard__hint">${t(o.hint)}</span>` : null}
        </button>`)}
      </div>` : null}
    ${has > 0 ? html`<div class="forgeov__forged" data-testid="forge-forged">
      <span class="forgeov__forgedhead">${t('已锻造')}</span>
      ${forgedEntries(forged).map((e) => html`<span key=${e.id} class="fged__pill">
        <span class="fged__pillname">${t(e.name)}</span>
        <b class="fged__pillval num">${forgedText(e)}</b>
        ${e.count > 1 ? html`<span class="fged__pillcnt num">×${e.count}</span>` : null}
      </span>`)}
    </div>` : null}
    <footer class="forgeov__foot">${tParts('精锐干员或累计击败 {n} 名敌人可获得锻造器',
      { n: html`<b class="num">${FORGE_KILLS_PER}</b>` })}</footer>
  </div>`;
}

/**
 * 「已锻造属性」入口徽标：只在锻造过东西后出现，点开只读面板。
 * @param {{ forge?: any, class?: string }} props
 */
export function ForgedChip({ forge = null, class: cls = '' } = {}) {
  const s = useUi();
  return html`<${ForgedChipView} forge=${forge} ui=${s} class=${cls} />`;
}

/**
 * 徽标的纯视图。
 * @param {{ forge?: any, ui?: { forgedOpen?: boolean }, class?: string }} props
 */
export function ForgedChipView({ forge = null, ui = { forgedOpen: false }, class: cls = '' } = {}) {
  ensureCss();
  const f = forgeOf(forge);
  const n = forgedCount(f.forged);
  if (n <= 0) return null;
  const open = ui.forgedOpen === true;
  return html`<span class=${cx('fged', cls)}>
    <button type="button" class=${cx('fged__chip', open && 'is-on')} data-testid="forged-chip"
      aria-label=${t('已锻造属性')} title=${t('已锻造属性')} onClick=${() => forgedToggle()}>
      <${GIcon} name="forge" class="fged__chipicon" />
      <span class="fged__chiplabel">${t('已锻造')}</span>
      <b class="fged__chipn num">${n}</b>
    </button>
    ${open ? html`<${ForgedPanelView} entries=${f.forged} onClose=${() => forgedToggle(false)} />` : null}
  </span>`;
}

/**
 * 「已锻造属性」只读面板：每项一行 —— 名称 · 累计总加成 · 叠加次数。
 * @param {{ entries?: any, onClose: () => void }} props
 */
export function ForgedPanel({ entries = null, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [onClose]);
  return html`<${ForgedPanelView} entries=${entries} onClose=${onClose} />`;
}

/**
 * the read-only 已锻造 list (pure).
 * @param {{ entries?: any, onClose?: () => void }} props
 */
export function ForgedPanelView({ entries = null, onClose = () => {} }) {
  ensureCss();
  const rows = forgedEntries(entries);
  const stacks = rows.reduce((s2, e) => s2 + (e.count || 0), 0);
  return html`<div class="fgedov" role="dialog" aria-label=${t('已锻造属性')} data-testid="forged-panel">
    <div class="fgedov__scrim" onClick=${onClose}></div>
    <div class="fgedov__box">
      <header class="fgedov__head">
        <span class="fgedov__title">${t('已锻造属性')}</span>
        <span class="fgedov__sub">${tParts('共 {n} 次锻造', { n: html`<b class="num">${stacks}</b>` })}</span>
        <button type="button" class="fgedov__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}>
          <${GIcon} name="close" />
        </button>
      </header>
      <div class="fgedov__body">
        ${rows.length === 0 ? html`<p class="fgedov__empty">${t('还没有锻造过')}</p>` : rows.map((e, i) => html`
          <div key=${e.id} class="fgedov__row" style=${`--i:${i}`}>
            <span class="fgedov__name">${t(e.name)}</span>
            <span class="fgedov__val num">${forgedText(e)}</span>
            <span class="fgedov__cnt num" title=${tParts('叠加 {n} 次', { n: html`<b>${e.count}</b>` })}>×${e.count}</span>
          </div>`)}
      </div>
      <footer class="fgedov__foot">${tParts('精锐干员或累计击败 {n} 名敌人可获得锻造器',
        { n: html`<b class="num">${FORGE_KILLS_PER}</b>` })}</footer>
    </div>
  </div>`;
}
