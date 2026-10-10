// 装备总览 (Equipment codex): a read-only overlay in the 干员调配 style — every good of every tier ("各个阶级的装备"),
// the bond it belongs to (装备对应的盟约, drawn like the 干员调配 card's bond tags) and its 普通 / 精锐 (进阶) effect side
// by side. Data: data/items.json — a good is the normal record (`isGolden` false) plus its 精锐 record (`goldenId`);
// the pack's own goods arrive through the same merge (server/data.js `{ custom: true }`), so they show up here too.
//
// Opened from the lobby / room / briefing, right next to 干员调配: openEquipCodex(from) / <EquipButton/>; <EquipHost/>
// is mounted once by main.js (like <LoadoutHost/>). Styles: css/screens/equipment.css plus the shared skeleton of
// loadout.css (.lo / .lo-top / .lo-note / .lo-body / .lo-grid / .lo-card / .lo-chip), so the two screens look and
// behave alike. Keyboard: Esc closes, ←/→ move through the (filtered) grid when focus is not in the search field.
//
// The model (codexRows / filterRows / groupByTier / effectTexts) is pure: the tests drive it without a DOM.

import { useEffect, useMemo, useRef } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, TextField, Spinner, Fragment } from '../ui/components.js';
import { Img, RichText } from '../ui/gameComponents.js';
import { itemIconUrl, bondIconUrl } from '../ui/assetUrls.js';
import { data, useData } from '../data.js';
import { createStore, useStore } from '../store.js';
import { shouldAutoClose } from './loadout.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const TIERS = [1, 2, 3, 4, 5, 6];

/** Codex state (open / origin / selection / filters) — its own store, like the loadout's (no server sync: read-only). */
export const equipStore = createStore({
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing'
  sel: null,           // selected good (the normal record's id)
  filters: { tier: null, bond: null, query: '', shopOnly: false },
});

/** Open the 装备总览 screen. @param {'lobby'|'room'|'briefing'} from @param {string|null} [sel] */
export function openEquipCodex(from = 'lobby', sel = null) {
  data.load('items');
  data.load('bonds');
  data.load('assets');
  equipStore.set({ open: true, from, ...(sel ? { sel } : {}) });
}
export const closeEquipCodex = () => equipStore.set({ open: false });

// ---- model (pure) ---------------------------------------------------------------------------------------------------

/** Tier first, then the shop order, then the name. */
export function cmpItems(a, b) {
  return (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0) || String(a.name).localeCompare(String(b.name), 'zh');
}

/**
 * One row per good: the normal record (`isGolden` false) with its 精锐 record resolved through `goldenId`. The hidden
 * ones (`hideInShop` / `shopExcluded`, e.g. the `_m` special-shop goods) are listed too — they are part of the tier's
 * goods; the detail column flags them.
 * @param {any[]} list data/items.json records
 * @param {(id: string) => any} lookup item lookup
 * @returns {{ base: any, golden: any|null }[]}
 */
export function codexRows(list, lookup) {
  const rows = (Array.isArray(list) ? list : []).filter((i) => i && !i.isGolden);
  return [...rows].sort(cmpItems).map((base) => ({ base, golden: (base.goldenId ? lookup(base.goldenId) : null) || null }));
}

/** The 普通 / 精锐 texts of a row (精锐 null when the good has no 进阶 record). */
export function effectTexts(row) {
  const base = row?.base || {};
  const golden = row?.golden || null;
  return {
    normal: base.descRaw || base.desc || '',
    elite: golden ? golden.descRaw || golden.desc || '' : null,
  };
}

/** The bonds a codex list uses, in data order (drives the 盟约 filter; the equipment only touches a few of them). */
export function usedBonds(rows, bonds) {
  const used = new Set((rows || []).map((r) => r?.base?.giveBondId).filter(Boolean));
  return (Array.isArray(bonds) ? bonds : []).filter((b) => b && used.has(b.bondId));
}

/** Filter sentinel of the 无盟约 option (the goods that do not belong to a bond at all). */
export const NO_BOND = '__none';

/**
 * Filter the codex rows: tier, bond (`NO_BOND` = the goods without a bond), shop availability and a free-text query
 * over the name, both effect texts and the bond's name.
 * @param {{ base: any, golden: any|null }[]} rows
 * @param {{ tier?: number|null, bond?: string|null, query?: string, shopOnly?: boolean }} filters
 * @param {Record<string, string>} [bondNames] id → name (the query matches 盟约 too)
 */
export function filterRows(rows, filters = {}, bondNames = {}) {
  const q = String(filters.query || '').trim().toLowerCase();
  return (rows || []).filter(({ base, golden }) => {
    if (filters.tier && base.tier !== filters.tier) return false;
    if (filters.bond === NO_BOND) { if (base.giveBondId) return false; }
    else if (filters.bond && (base.giveBondId || '') !== filters.bond) return false;
    if (filters.shopOnly && (base.hideInShop || base.shopExcluded)) return false;
    if (!q) return true;
    const hay = [base.name, base.desc, golden?.desc, base.giveBondId ? bondNames[base.giveBondId] : '']
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** The tier sections of a filtered list: [{ tier, rows }] in tier order, empty tiers dropped. */
export function groupByTier(rows) {
  const by = new Map();
  for (const row of rows || []) {
    const t = row?.base?.tier ?? 0;
    if (!by.has(t)) by.set(t, []);
    by.get(t).push(row);
  }
  return [...by.keys()].sort((a, b) => a - b).map((tier) => ({ tier, rows: by.get(tier) }));
}

// ---- pieces ---------------------------------------------------------------------------------------------------------

/** One good's 普通 / 精锐 effect block. */
function EqEffect({ k, micro, text, elite }) {
  return html`<section class=${cx('eq-eff', elite && 'is-elite')} aria-label=${k}>
    <div class="eq-eff__head">
      <span class="eq-eff__k">${k}</span>
      <span class="eq-eff__micro">${micro}</span>
    </div>
    <${RichText} as="p" text=${text} class="eq-eff__text" />
  </section>`;
}

/** The bond tag of a good (same sprite + name as the 干员调配 card's tags). */
function BondTag({ m, bond, large, short }) {
  if (!bond) return html`<span class="eq-bond is-none">${short ? '—' : t('无盟约')}</span>`;
  return html`<span class=${cx('eq-bond', large && 'eq-bond--lg')}>
    <${Img} src=${bondIconUrl(m, bond.bondId)} class="eq-bond__icon" fallback=${html`<${Icon} name="crown" class="eq-bond__icon" />`} />${bond.name}
  </span>`;
}

/** Roster-style card of one good (the 干员调配 card's classes: tier frame, icon, name, meta line). */
function EqCard({ row, bond, m, selected, onPick }) {
  const t = row.base.tier;
  return html`<button type="button" class=${cx('lo-card', `lo-card--t${t}`, 'eq-card', selected && 'is-sel')}
      data-item=${row.base.id} aria-pressed=${selected ? 'true' : 'false'} onClick=${() => onPick(row.base.id)}>
    <span class="lo-card__art">
      <${Img} src=${itemIconUrl(m, row.base)} fallback=${html`<span class="lo-card__glyph"><${Icon} name="book" /></span>`} />
      <span class=${cx('lo-card__tier', 'lo-chip', 'lo-chip--tier', `lo-chip--t${t}`)}><span class="num">${ROMAN[t] || t}</span></span>
    </span>
    <span class="lo-card__name">${row.base.name}</span>
    <span class="lo-card__kit eq-card__meta"><${BondTag} m=${m} bond=${bond} short=${true} /></span>
  </button>`;
}

/** The selected good: icon, name, tier / price / merge meta, its bond and the 普通 + 精锐 effects. */
function EqDetail({ row, bond, m }) {
  const { base, golden } = row;
  const eff = effectTexts(row);
  const tier = base.tier;
  return html`<div class="eq-detail">
    <header class="eq-detail__head">
      <span class="eq-detail__art"><${Img} src=${itemIconUrl(m, base)} fallback=${html`<span class="lo-card__glyph"><${Icon} name="book" /></span>`} /></span>
      <div class="eq-detail__id">
        <${MicroLabel} tone="mint">EQUIPMENT // ${ROMAN[tier] || tier}
        <//>
        <h2 class="eq-detail__name">${base.name}</h2>
        <div class="eq-detail__tags">
          <span class=${cx('lo-chip', 'lo-chip--tier', `lo-chip--t${tier}`, 'eq-tierchip')}><span class="num">${ROMAN[tier] || tier}</span>${t('阶')}</span>
          ${base.price != null && base.price !== '' ? html`<span class="eq-meta">${t('售价')} <b class="num">${base.price}</b></span>` : null}
          ${base.mergeable && base.upgradeNum ? html`<span class="eq-meta">${tParts('合成 ×{n} 升为精锐', { n: html`<b class="num">${base.upgradeNum}</b>` })}</span>` : null}
          ${base.hideInShop || base.shopExcluded ? html`<span class="eq-meta is-warn"><${Icon} name="warn" />${t('商店不可售')}</span>` : null}
        </div>
        <div class="eq-detail__bond"><span class="eq-detail__k">${t('盟约')}</span><${BondTag} m=${m} bond=${bond} large=${true} /></div>
      </div>
    </header>
    <${EqEffect} k=${t('普通')} micro="NORMAL" text=${eff.normal} />
    ${golden
      ? html`<${EqEffect} k=${t('精锐')} micro="ELITE" text=${eff.elite} elite=${true} />`
      : html`<section class="eq-eff is-elite is-none" aria-label=${t('精锐')}>
          <div class="eq-eff__head"><span class="eq-eff__k">${t('精锐')}</span><span class="eq-eff__micro">ELITE</span></div>
          <p class="eq-eff__text t-dim">${t('这件装备没有精锐（进阶）版本')}</p>
        </section>`}
  </div>`;
}

/** Filter bar: 阶级 chips, search, the 盟约 select of the bonds the goods use, 仅看商店可售. */
function EqFilters({ filters, bonds, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return html`<div class="lo-filters eq-filters">
    <div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${t('阶级')}>
        <button type="button" class=${cx('lo-chip', !filters.tier && 'is-on')} onClick=${() => set({ tier: null })}>${t('全部')}</button>
        ${TIERS.map((n) => html`<button key=${n} type="button" class=${cx('lo-chip', 'lo-chip--tier', `lo-chip--t${n}`, filters.tier === n && 'is-on')}
          aria-pressed=${filters.tier === n ? 'true' : 'false'} title=${t('{t}阶', { t: n })} onClick=${() => set({ tier: filters.tier === n ? null : n })}><span class="num">${ROMAN[n]}</span></button>`)}
      </div>
      <${TextField} size="sm" icon="search" value=${filters.query} placeholder=${t('搜索装备 / 效果 / 盟约')} class="lo-search"
        onInput=${(v) => set({ query: String(v).slice(0, 24) })} />
    </div>
    <div class="lo-frow">
      <label class="lo-select">
        <span class="lo-select__k">${t('盟约')}</span>
        <select value=${filters.bond || ''} onChange=${(e) => set({ bond: e.currentTarget.value || null })} aria-label=${t('按盟约筛选')}>
          <option value="">${t('全部盟约')}</option>
          <option value=${NO_BOND}>${t('无盟约')}</option>
          ${bonds.map((b) => html`<option key=${b.bondId} value=${b.bondId}>${b.name}</option>`)}
        </select>
      </label>
      <button type="button" class=${cx('lo-toggle', filters.shopOnly && 'is-on')} aria-pressed=${filters.shopOnly ? 'true' : 'false'}
        onClick=${() => set({ shopOnly: !filters.shopOnly })}><i class="lo-toggle__box"><${Icon} name="check" /></i>${t('仅看商店可售')}</button>
    </div>
  </div>`;
}

// ---- screen ---------------------------------------------------------------------------------------------------------

/** The overlay screen (rendered by <EquipHost/> while open). */
function EquipScreen({ st }) {
  const ready = useData('items', 'bonds', 'assets');
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  const m = data.get('assets');
  const rows = useMemo(() => codexRows(data.list('items'), (id) => data.lookup('items', id)), [ready]);
  const bonds = useMemo(() => usedBonds(rows, data.list('bonds')), [ready, rows]);
  const bondNames = useMemo(() => Object.fromEntries(bonds.map((b) => [b.bondId, b.name])), [bonds]);
  const byId = useMemo(() => new Map(bonds.map((b) => [b.bondId, b])), [bonds]);
  const list = filterRows(rows, st.filters, bondNames);
  const groups = groupByTier(list);
  const selId = st.sel && list.some((r) => r.base.id === st.sel) ? st.sel : list[0]?.base.id || null;
  const sel = list.find((r) => r.base.id === selId) || null;
  const gridRef = useRef(null);

  // Esc closes; ←/→ browse the filtered grid (not while typing in the search field); single-key game shortcuts are
  // swallowed while the overlay is open (same rules as 干员调配)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return;
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeEquipCodex(); return; }
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const ids = list.map((r) => r.base.id);
        if (!ids.length) return;
        const cur = Math.max(0, ids.indexOf(st.sel));
        equipStore.set({ sel: ids[(cur + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length] });
        e.preventDefault();
      }
      if (e.key.length === 1 || e.key === ' ') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list, st.sel]);

  // keep the selected card in view
  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-item="${selId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selId, list.length]);

  return html`<div class="lo eq" role="dialog" aria-modal="true" aria-label=${t('装备总览')}>
    <div class="lo__bg" aria-hidden="true"></div>
    <header class="lo-top">
      <div class="lo-top__left">
        <${Button} variant="ghost" size="md" icon="chevronLeft" class="lo-back" onClick=${closeEquipCodex} aria-label=${t('返回')} title=${t('返回 (Esc)')}>${t('返回')}<//>
      </div>
      <div class="lo-top__center">
        <${MicroLabel} tone="mint">EQUIPMENT CODEX<//>
        <h1 class="lo-top__title"><${Icon} name="book" class="lo-top__icon" />${t('装备总览')}</h1>
      </div>
      <div class="lo-top__right">
        <span class="lo-count">${t('已收录')} <b class="num">${list.length}</b><span class="num t-dim">/${rows.length}</span></span>
      </div>
    </header>
    <p class="lo-note"><${Icon} name="info" />${t('这里的「普通」是商店原价买到的效果，「精锐」是进阶（合成）后的效果；盟约标签表示这件装备所属的大盟约。')}</p>
    ${!ready ? html`<div class="lo-loading"><${Spinner} size="sm" />${t('正在载入装备数据（打开页面后仅载入一次）…')}</div>` : html`<main class="lo-body">
      <section class="lo-roster eq-list">
        <${EqFilters} filters=${st.filters} bonds=${bonds} onChange=${(f) => equipStore.set({ filters: f })} />
        <div class="lo-grid" role="listbox" aria-label=${t('装备列表')} ref=${gridRef}>
          ${groups.length ? groups.map((g) => html`<${Fragment} key=${g.tier}>
            <div class="eq-tier" role="presentation">
              <span class="eq-tier__k"><span class="num">${ROMAN[g.tier] || g.tier}</span>${t('阶')}</span>
              <span class="eq-tier__n num">${t('{n} 件', { n: g.rows.length })}</span>
            </div>
            ${g.rows.map((row) => html`<${EqCard} key=${row.base.id} row=${row} m=${m} bond=${byId.get(row.base.giveBondId) || null}
              selected=${row.base.id === selId} onPick=${(id) => equipStore.set({ sel: id })} />`)}
          <//>`) : html`<p class="lo-empty t-dim">${t('没有符合条件的装备')}</p>`}
        </div>
      </section>
      <div class="lo-detail-wrap">
        ${sel ? html`<${EqDetail} row=${sel} m=${m} bond=${byId.get(sel.base.giveBondId) || null} />` : null}
      </div>
    </main>`}
  </div>`;
}

/** Mounted once (main.js): renders the overlay while open — same rules as <LoadoutHost/> (it closes itself when its
 * context moves on: the briefing ended, or a match started while it was opened from the lobby / room). */
export function EquipHost() {
  const st = useStore((s) => s, Object.is, equipStore);
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  const wasInMatch = useRef(inMatch);
  useEffect(() => {
    if (shouldAutoClose(st, phase, inMatch, wasInMatch.current)) closeEquipCodex();
    wasInMatch.current = inMatch;
  }, [phase, inMatch, st.open]);
  useEffect(() => {
    if (st.open) document.documentElement.classList.add('sp-equip-open');
    else document.documentElement.classList.remove('sp-equip-open');
  }, [st.open]);
  if (!st.open) return null;
  return html`<${EquipScreen} st=${st} />`;
}

/** Entry button (lobby / room / briefing), next to 干员调配. */
export function EquipButton({ from = 'lobby', size = 'md', variant = 'secondary', class: cls, label = t('查看装备') }) {
  return html`<button type="button" class=${cx('btn', `btn--${variant}`, `btn--${size}`, 'eq-entry', cls)} data-testid="equip-open"
      onClick=${() => openEquipCodex(from)} title=${t('查看各阶级装备、对应盟约与普通 / 精锐效果')}>
    <${Icon} name="book" class="btn__icon" />
    <span class="btn__label">${label}</span>
  </button>`;
}
