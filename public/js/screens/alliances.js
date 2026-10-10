// 盟约与策略总览 (Alliance & strategy codex): a read-only overlay in the 装备总览 (screens/equipment.js) style — the
// bond half lists every 盟约 of the season (核心盟约 / 附加盟约, the pack's own two included) with its 层数阈值, 计数方式,
// the effect of every layer (ui/richText.js formatBondEffect), its 成员 (the operators that carry it) and the equipment
// that belongs to it (a click opens 装备总览 on that good); the 策略 half lists every band with its 模式, 初始生命值,
// effect and the bonds it touches (data/bands.json `bondIds`).
//
// Opened from the lobby / room / briefing, right next to 查看装备: openAllianceCodex(from) / <AllianceCodexButton/>;
// <AllianceCodexHost/> is mounted once by main.js (like <LoadoutHost/> / <EquipHost/>). Styles: css/screens/alliances.css
// plus the shared skeleton of loadout.css / equipment.css (.lo / .lo-top / .lo-note / .lo-body / .lo-grid / .lo-card /
// .lo-chip), so the three screens look and behave alike. Keyboard: Esc closes, ←/→ move through the (filtered) list.
//
// The model (bondRows / bandRows / filterBonds / filterBands / bondLayers / bondLayerTexts / bondEquipment) is pure:
// the tests drive it without a DOM.

import { useEffect, useMemo, useRef } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, TextField, Spinner, Fragment, TierChip } from '../ui/components.js';
import { Img, RichText, BandIcon, LpTower, UnitThumb, BondGlyph } from '../ui/gameComponents.js';
import { bondIconUrl, itemIconUrl } from '../ui/assetUrls.js';
import { formatBondEffect } from '../ui/richText.js';
import { data, useData } from '../data.js';
import { createStore, useStore } from '../store.js';
import { shouldAutoClose } from './loadout.js';
import { openEquipCodex } from './equipment.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Codex state (open / origin / tab / selection / filters) — its own store, like the equipment codex's (read-only). */
export const allianceStore = createStore({
  open: false,
  from: null,            // 'lobby' | 'room' | 'briefing'
  tab: 'bonds',          // 'bonds' | 'bands'
  bond: null,            // selected bondId
  band: null,            // selected bandId
  filters: {
    bonds: { core: null, phase: null, query: '' },   // core: true (核心) | false (附加) | null (全部)
    bands: { mode: null, query: '' },                // mode: 'SINGLE' | 'MULTI' | 'LOCAL' | null
  },
});

/** Open the 盟约与策略总览. @param {'lobby'|'room'|'briefing'} from @param {{tab?: string, id?: string|null}} [opts] */
export function openAllianceCodex(from = 'lobby', opts = {}) {
  data.load('bonds');
  data.load('bands');
  data.load('items');
  data.load('chess');
  data.load('assets');
  const tab = opts.tab === 'bands' ? 'bands' : 'bonds';
  allianceStore.set({
    open: true, from, tab,
    ...(opts.id ? (tab === 'bands' ? { band: opts.id } : { bond: opts.id }) : {}),
  });
}
export const closeAllianceCodex = () => allianceStore.set({ open: false });

// ---- model (pure) ---------------------------------------------------------------------------------------------------

/** 核心盟约 first (bondOrder, then data order), then the 附加盟约 (bondOrder, then data order). */
export function bondRows(bonds) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => b && b.bondId);
  const ord = (b) => (Number.isFinite(b.bondOrder) ? b.bondOrder : 99);
  const core = list.filter((b) => b.isCore).sort((a, b) => ord(a) - ord(b));
  const add = list.filter((b) => !b.isCore).sort((a, b) => ord(a) - ord(b));
  return [...core, ...add].map((bond) => ({ bond, isCore: !!bond.isCore }));
}

/** Bands by sortId, then bandId (the order the draft uses — screens/bandDraft.js allowedBands). */
export function bandRows(bands) {
  const sid = (b) => (Number.isFinite(b?.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && b.bandId)
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0))
    .map((band) => ({ band }));
}

/** The layer indices a bond can hold (0 = 未激活 / 基础效果): its thresholds, or 1..maxCount when it has no阈值. */
export function bondLayers(bond) {
  const th = Array.isArray(bond?.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  const max = Number.isFinite(bond?.maxCount) && bond.maxCount > 0 ? bond.maxCount : null;
  const top = Math.max(th.length, max ? Math.min(max, 10) : 1, 1);
  return Array.from({ length: top + 1 }, (_, i) => i);
}

/**
 * One row per layer: the layer index, the member count it needs (`thresholds[i - 1]`, null for the base layer / a
 * threshold-less bond) and the resolved effect text (ui/richText.js formatBondEffect).
 */
export function bondLayerTexts(bond) {
  const th = Array.isArray(bond?.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  return bondLayers(bond).map((layer) => ({ layer, need: layer > 0 ? (th[layer - 1] ?? null) : null, text: formatBondEffect(bond, layer) }));
}

/**
 * The bond's members as chess records, lowest 阶级 first (the pack's merged members included). The member list of the
 * data keeps the client order of the season, which is not ordered by tier — a 3 阶 member may follow a 6 阶 one (炎's
 * 录武官), and a pack piece joins its bonds last (维多利亚's 煌, 4 阶) — so the codex sorts: tier, then the shop order
 * (shopSortId, the order 商店 lists a tier in), then the name.
 */
export function bondMembers(rows, lookup) {
  const ids = rows?.visibleMembers?.length ? rows.visibleMembers : rows?.members || [];
  const byTier = (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0)
    || String(a.name).localeCompare(String(b.name), 'zh');
  return (Array.isArray(ids) ? ids : []).map((id) => lookup(id)).filter(Boolean).sort(byTier);
}

/** The equipment of a bond (items.json `giveBondId`), in the shop order of the equipment codex. */
export function bondEquipment(bondId, items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && !i.isGolden && i.giveBondId === bondId);
  return list.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0)
    || String(a.name).localeCompare(String(b.name), 'zh'));
}

/** The distinct 生效阶段 (bond `activeType`) of a bond list — drives the 阶段 filter (only the labelled ones). */
export function bondPhases(rows) {
  const seen = [];
  for (const r of rows || []) {
    const t = r?.bond?.activeType;
    if (t && PHASE_NAMES[t] && !seen.includes(t)) seen.push(t);
  }
  return seen;
}

/** Bonds passing the filters: 核心 / 附加, 生效阶段 and a free-text query over name, effect name, description, members. */
export function filterBonds(rows, filters = {}, memberNames = {}, phaseName = (t) => t) {
  const q = String(filters.query || '').trim().toLowerCase();
  return (rows || []).filter(({ bond }) => {
    if (filters.core === true && !bond.isCore) return false;
    if (filters.core === false && bond.isCore) return false;
    if (filters.phase && bond.activeType !== filters.phase) return false;
    if (!q) return true;
    const hay = [bond.name, bond.effectName, bond.desc, bond.descRaw, phaseName(bond.activeType), memberNames[bond.bondId]]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** Bands passing the filters: mode (modeTypeList) and a free-text query over name, effect name and description. */
export function filterBands(rows, filters = {}, bondNames = {}) {
  const q = String(filters.query || '').trim().toLowerCase();
  return (rows || []).filter(({ band }) => {
    if (filters.mode && Array.isArray(band.modeTypeList) && !band.modeTypeList.includes(filters.mode)) return false;
    if (!q) return true;
    const bonds = (band.bondIds || []).map((id) => bondNames[id]).filter(Boolean);
    const hay = [band.name, band.effectName, band.desc, band.descRaw, ...bonds].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** 生效阶段 labels of a bond (`activeType`). Only the two the data makes clear are labelled: BATTLE = the bond’s lines all
 * read 战斗开始时/战斗中 (21 bonds) and ALL = 战斗与休整期都生效 (远见 / 奇迹 / 投资人 — their effects live in the shop, see
 * CHANGELOG 0.1.3). Other raw values (调和 is the only MANI one) are neither labelled nor offered as a filter. */
export const PHASE_NAMES = Object.freeze({ BATTLE: N_('战斗中生效'), ALL: N_('全程生效') });
/** 模式 labels of a band (`modeTypeList`). */
export const MODE_NAMES = Object.freeze({ LOCAL: N_('本地模式'), SINGLE: N_('独立模拟'), MULTI: N_('同盟模拟') });
/** 计数方式 labels (bond `countMode` + countsHand / countsGoldenOnly). */
export const COUNT_NAMES = Object.freeze({ BOARD: N_('场上'), HAND: N_('手牌'), DECK: N_('待部署区'), GLOBAL: N_('全局') });

// ---- pieces ---------------------------------------------------------------------------------------------------------

/** Layer chip of a bond layer: the official octagon tier sprite (I / II / III …, 层数) + the members it needs. */
function LayerChip({ layer, need, small }) {
  if (!layer) return html`<span class=${cx('al-layer', 'al-layer--0', small && 'is-sm')}><span class="al-layer__k">${t('基础')}</span></span>`;
  return html`<span class=${cx('al-layer', small && 'is-sm')} title=${need != null ? t('{need} 名成员', { need }) : null}>
    ${layer <= 6
      ? html`<${TierChip} tier=${layer} size="sm" class="al-layer__icon" />`
      : html`<span class="al-layer__k">${ROMAN[layer] || `+${layer}`}</span>`}
    ${need != null ? html`<span class="al-layer__n num">${t('{need} 名', { need })}</span>` : null}
  </span>`;
}

/** The bond disc + name, the shape the 干员调配 card's tags and the popup use. */
function BondTag({ m, bond, large }) {
  return html`<span class=${cx('eq-bond', large && 'eq-bond--lg')}>
    <${Img} src=${bondIconUrl(m, bond.bondId)} class="eq-bond__icon" fallback=${html`<${Icon} name="crown" class="eq-bond__icon" />`} />${bond.name}
  </span>`;
}

/** Codex card of one bond (a core bond gets the mint frame, an add-on one the plain line). */
function BondCard({ row, m, selected, onPick }) {
  const b = row.bond;
  const th = Array.isArray(b.thresholds) ? b.thresholds : [];
  return html`<button type="button" class=${cx('lo-card', 'al-card', 'al-card--bond', row.isCore && 'al-card--core', selected && 'is-sel')}
      data-bond=${b.bondId} aria-pressed=${selected ? 'true' : 'false'} onClick=${() => onPick(b.bondId)}>
    <span class="lo-card__art">
      <${Img} src=${bondIconUrl(m, b.bondId)} fallback=${html`<span class="lo-card__glyph"><${Icon} name="crown" /></span>`} />
    </span>
    <span class="lo-card__name">${b.name}</span>
    <span class="lo-card__kit al-card__meta">
      <span class=${cx('al-kind', row.isCore ? 'is-core' : 'is-add')}>${row.isCore ? t('核心') : t('附加')}</span>
      ${th.length ? html`<span class="al-card__th num">${th.join(' / ')}</span>` : null}
    </span>
  </button>`;
}

/** Codex card of one strategy. */
function BandCard({ row, selected, onPick }) {
  const b = row.band;
  return html`<button type="button" class=${cx('lo-card', 'al-card', 'al-card--band', selected && 'is-sel')}
      data-band=${b.bandId} aria-pressed=${selected ? 'true' : 'false'} onClick=${() => onPick(b.bandId)}>
    <span class="lo-card__art"><${BandIcon} bandId=${b.bandId} size="md" /></span>
    <span class="lo-card__name">${b.name}</span>
    <span class="lo-card__kit al-card__meta">
      <span class="al-card__eff">${b.effectName || ''}</span>
      <${LpTower} value=${b.totalHp} size="xs" class="al-card__hp" />
    </span>
  </button>`;
}

/** A member row of the bond detail: the chess thumb, its name, its tier. */
function MemberRow({ chess }) {
  return html`<div class="al-member" data-chess=${chess.chessId} title=${`${chess.name} · ${chess.appellation || ''}`}>
    <${UnitThumb} kind="chess" id=${chess.chessId} size="sm" />
    <span class="al-member__name">${chess.name}</span>
    <${TierChip} tier=${chess.tier} size="sm" />
  </div>`;
}

/** The selected bond: header facts, the effect of every layer, its members and its equipment. */
function BondDetail({ row, m, items, chessById, onItem }) {
  const b = row.bond;
  const th = Array.isArray(b.thresholds) ? b.thresholds : [];
  const layers = bondLayerTexts(b);
  const members = bondMembers(b, chessById);
  const equips = bondEquipment(b.bondId, items);
  const count = [t(COUNT_NAMES[b.countMode]) || b.countMode || t('场上'), b.countsHand ? t('含手牌') : null, b.countsGoldenOnly ? t('只算精锐') : null]
    .filter(Boolean).join(' · ');
  return html`<div class="eq-detail al-detail">
    <header class="eq-detail__head">
      <span class=${cx('eq-detail__art', 'al-detail__disc', row.isCore && 'is-core')}>
        <${Img} src=${bondIconUrl(m, b.bondId)} fallback=${html`<span class="lo-card__glyph"><${Icon} name="crown" /></span>`} />
      </span>
      <div class="eq-detail__id">
        <${MicroLabel} tone="mint">${row.isCore ? t('CORE BOND // 核心盟约') : t('ADD-ON BOND // 附加盟约')}<//>
        <h2 class="eq-detail__name">${b.name}</h2>
        <div class="eq-detail__tags">
          <span class="eq-meta">${t('计数')} <b>${count}</b></span>
          ${PHASE_NAMES[b.activeType] ? html`<span class="eq-meta">${t(PHASE_NAMES[b.activeType])}</span>` : null}
          ${th.length ? html`<span class="eq-meta">${tParts('阈值 {n} 名成员', { n: html`<b class="num">${th.join(' / ')}</b>` })}</span>` : null}
          ${b.maxCount ? html`<span class="eq-meta">${t('层数上限')} <b class="num">${b.maxCount}</b></span>` : null}
          ${b.noStack ? html`<span class="eq-meta is-warn"><${Icon} name="warn" />${t('层数不叠加（取最高）')}</span>` : null}
        </div>
      </div>
    </header>
    <section class="eq-eff" aria-label=${t('盟约效果')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('效果')}</span><span class="eq-eff__micro">${b.effectName || 'EFFECT'}</span></div>
      ${layers.map((l) => html`<div key=${l.layer} class=${cx('al-layerrow', l.layer === 0 && 'is-base')}>
        <${LayerChip} layer=${l.layer} need=${l.need} small=${true} />
        <${RichText} as="p" text=${l.text || '—'} class="eq-eff__text" />
      </div>`)}
    </section>
    ${b.descRaw || b.desc ? html`<section class="eq-eff" aria-label=${t('完整描述')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('完整描述')}</span><span class="eq-eff__micro">FULL TEXT</span></div>
      <${RichText} as="p" text=${b.descRaw || b.desc} class="eq-eff__text" />
    </section>` : null}
    ${equips.length ? html`<section class="eq-eff" aria-label=${t('相关装备')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('相关装备')}</span><span class="eq-eff__micro">EQUIPMENT</span></div>
      <div class="al-items">${equips.map((it) => html`<button key=${it.id} type="button" class="al-item" data-item=${it.id} onClick=${() => onItem(it.id)} title=${t('在装备总览里查看')}>
        <${Img} src=${itemIconUrl(m, it)} class="al-item__icon" fallback=${html`<${Icon} name="book" class="al-item__icon" />`} />
        <span class="al-item__name">${it.name}</span>
        <${TierChip} tier=${it.tier} size="sm" />
      </button>`)}</div>
    </section>` : null}
    <section class="eq-eff" aria-label=${t('成员')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('成员')}</span><span class="eq-eff__micro num">${members.length}</span></div>
      ${members.length
        ? html`<div class="al-members">${members.map((c) => html`<${MemberRow} key=${c.chessId} chess=${c} />`)}</div>`
        : html`<p class="eq-eff__text t-dim">${t('没有成员记录')}</p>`}
    </section>
  </div>`;
}

/** The selected strategy: mode / 初始生命值 / effect / the bonds it touches. */
function BandDetail({ row, bondById }) {
  const b = row.band;
  const modes = (b.modeTypeList || []).map((k) => t(MODE_NAMES[k]) || k);
  const bonds = (b.bondIds || []).map((id) => bondById(id)).filter(Boolean);
  return html`<div class="eq-detail al-detail">
    <header class="eq-detail__head">
      <span class="eq-detail__art al-detail__disc al-detail__disc--band"><${BandIcon} bandId=${b.bandId} size="xl" /></span>
      <div class="eq-detail__id">
        <${MicroLabel} tone="mint">${t('STRATEGY // 策略')}<//>
        <h2 class="eq-detail__name">${b.name}</h2>
        <div class="eq-detail__tags">
          <span class="eq-meta">${t('初始生命值')} <b class="num">${b.totalHp}</b></span>
          ${modes.length ? html`<span class="eq-meta">${modes.join(' · ')}</span>` : null}
          ${Number.isFinite(b.victorCount) ? html`<span class="eq-meta">${tParts('胜利条件 {n} 名博士存活', { n: html`<b class="num">${b.victorCount}</b>`, count: b.victorCount })}</span>` : null}
          ${Number.isFinite(b.rewardModulus) && b.rewardModulus !== 1 ? html`<span class="eq-meta">${t('奖励系数')} <b class="num">×${b.rewardModulus}</b></span>` : null}
        </div>
      </div>
    </header>
    <section class="eq-eff" aria-label=${t('策略效果')}>
      <div class="eq-eff__head">
        <span class="eq-eff__k">${t('效果')}</span>
        <span class="eq-eff__micro">${b.effectName || 'EFFECT'}</span>
        <${LpTower} value=${b.totalHp} size="sm" class="al-detail__hp" />
      </div>
      <${RichText} as="p" text=${b.descRaw || b.desc || '—'} class="eq-eff__text" />
    </section>
    ${bonds.length ? html`<section class="eq-eff" aria-label=${t('相关盟约')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('相关盟约')}</span><span class="eq-eff__micro">BONDS</span></div>
      <div class="al-items">${bonds.map((bd) => html`<span key=${bd.bondId} class=${cx('al-bondchip', bd.isCore && 'is-core')}>
        <${BondGlyph} bondId=${bd.bondId} class="al-bondchip__icon" />${bd.name}</span>`)}</div>
    </section>` : null}
    ${b.unlockDesc ? html`<section class="eq-eff" aria-label=${t('解锁条件')}>
      <div class="eq-eff__head"><span class="eq-eff__k">${t('解锁')}</span><span class="eq-eff__micro">UNLOCK</span></div>
      <${RichText} as="p" text=${b.unlockDesc} class="eq-eff__text" />
    </section>` : null}
  </div>`;
}

/** Filter bar of the bond tab: 全部 / 核心 / 附加, the 生效阶段 chips (when the data has more than one) and a search box. */
function BondFilters({ filters, phases, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return html`<div class="lo-filters eq-filters">
    <div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${t('盟约类型')}>
        <button type="button" class=${cx('lo-chip', filters.core === null && 'is-on')} onClick=${() => set({ core: null })}>${t('全部')}</button>
        <button type="button" class=${cx('lo-chip', filters.core === true && 'is-on')} aria-pressed=${filters.core === true ? 'true' : 'false'} onClick=${() => set({ core: filters.core === true ? null : true })}>${t('核心盟约')}</button>
        <button type="button" class=${cx('lo-chip', filters.core === false && 'is-on')} aria-pressed=${filters.core === false ? 'true' : 'false'} onClick=${() => set({ core: filters.core === false ? null : false })}>${t('附加盟约')}</button>
      </div>
      <${TextField} size="sm" icon="search" value=${filters.query} placeholder=${t('搜索盟约 / 效果 / 成员')} class="lo-search"
        onInput=${(v) => set({ query: String(v).slice(0, 24) })} />
    </div>
    ${phases.length > 1 ? html`<div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${t('生效阶段')}>
        <button type="button" class=${cx('lo-chip', !filters.phase && 'is-on')} onClick=${() => set({ phase: null })}>${t('全部阶段')}</button>
        ${phases.map((k) => html`<button key=${k} type="button" class=${cx('lo-chip', filters.phase === k && 'is-on')} aria-pressed=${filters.phase === k ? 'true' : 'false'}
          onClick=${() => set({ phase: filters.phase === k ? null : k })}>${t(PHASE_NAMES[k]) || k}</button>`)}
      </div>
    </div>` : null}
  </div>`;
}

/** Filter bar of the strategy tab: the mode chips + a search box. */
function BandFilters({ filters, modes, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return html`<div class="lo-filters eq-filters">
    <div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${t('可用模式')}>
        <button type="button" class=${cx('lo-chip', !filters.mode && 'is-on')} onClick=${() => set({ mode: null })}>${t('全部模式')}</button>
        ${modes.map((k) => html`<button key=${k} type="button" class=${cx('lo-chip', filters.mode === k && 'is-on')} aria-pressed=${filters.mode === k ? 'true' : 'false'}
          onClick=${() => set({ mode: filters.mode === k ? null : k })}>${t(MODE_NAMES[k]) || k}</button>`)}
      </div>
      <${TextField} size="sm" icon="search" value=${filters.query} placeholder=${t('搜索策略 / 效果')} class="lo-search"
        onInput=${(v) => set({ query: String(v).slice(0, 24) })} />
    </div>
  </div>`;
}

// ---- screen ---------------------------------------------------------------------------------------------------------

/** The overlay screen (rendered by <AllianceCodexHost/> while open). */
function AllianceScreen({ st }) {
  const ready = useData('bonds', 'bands', 'items', 'chess', 'assets');
  const m = data.get('assets');
  const bonds = useMemo(() => bondRows(data.list('bonds')), [ready]);
  const bands = useMemo(() => bandRows(data.list('bands')), [ready]);
  const items = useMemo(() => (ready ? data.list('items') : []), [ready]);
  const chessById = useMemo(() => (id) => data.lookup('chess', id), [ready]);
  const bondById = (id) => data.lookup('bonds', id);
  const memberNames = useMemo(() => Object.fromEntries(bonds.map(({ bond }) => {
    const names = bondMembers(bond, (id) => data.lookup('chess', id)).map((c) => c.name);
    return [bond.bondId, names.join(' ')];
  })), [ready, bonds]);
  const bandBondNames = useMemo(() => Object.fromEntries(bonds.map(({ bond }) => [bond.bondId, bond.name])), [ready, bonds]);
  const phases = useMemo(() => bondPhases(bonds), [ready, bonds]);
  const modes = useMemo(() => {
    const seen = [];
    for (const { band } of bands) for (const t of band.modeTypeList || []) if (!seen.includes(t)) seen.push(t);
    return seen;
  }, [ready, bands]);

  const bondsTab = st.tab !== 'bands';
  const listBonds = useMemo(() => filterBonds(bonds, st.filters.bonds, memberNames, (k) => t(PHASE_NAMES[k]) || k), [bonds, st.filters.bonds, memberNames]);
  const listBands = useMemo(() => filterBands(bands, st.filters.bands, bandBondNames), [bands, st.filters.bands, bandBondNames]);
  const ids = bondsTab ? listBonds.map((r) => r.bond.bondId) : listBands.map((r) => r.band.bandId);
  const cur = bondsTab ? st.bond : st.band;
  const selId = cur && ids.includes(cur) ? cur : ids[0] || null;
  const gridRef = useRef(null);
  const total = bondsTab ? bonds.length : bands.length;

  // Esc closes; ←/→ browse the filtered list (not while typing); single-key game shortcuts are swallowed
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return;
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeAllianceCodex(); return; }
      if (typing) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && ids.length) {
        const at = Math.max(0, ids.indexOf(selId));
        const next = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
        allianceStore.set(bondsTab ? { bond: next } : { band: next });
        e.preventDefault();
      }
      if (e.key.length === 1 || e.key === ' ') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ids.join(','), selId, bondsTab]);

  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-${bondsTab ? 'bond' : 'band'}="${selId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selId, ids.length, bondsTab]);

  const setTab = (tab) => allianceStore.set({ tab });
  const selBond = bondsTab ? listBonds.find((r) => r.bond.bondId === selId) || null : null;
  const selBand = bondsTab ? null : listBands.find((r) => r.band.bandId === selId) || null;

  return html`<div class="lo eq al" role="dialog" aria-modal="true" aria-label=${t('盟约与策略总览')}>
    <div class="lo__bg" aria-hidden="true"></div>
    <header class="lo-top">
      <div class="lo-top__left">
        <${Button} variant="ghost" size="md" icon="chevronLeft" class="lo-back" onClick=${closeAllianceCodex} aria-label=${t('返回')} title=${t('返回 (Esc)')}>${t('返回')}<//>
      </div>
      <div class="lo-top__center">
        <${MicroLabel} tone="mint">BONDS & STRATEGIES<//>
        <h1 class="lo-top__title"><${Icon} name="crown" class="lo-top__icon" />${t('盟约与策略总览')}</h1>
      </div>
      <div class="lo-top__right">
        <span class="lo-count">${t('已收录')} <b class="num">${ids.length}</b><span class="num t-dim">/${total}</span></span>
      </div>
    </header>
    <p class="lo-note"><${Icon} name="info" />${t('盟约按层数（阈值）生效，层数由场上成员数决定；策略在开局前选定，决定初始生命值与额外规则。')}</p>
    ${!ready ? html`<div class="lo-loading"><${Spinner} size="sm" />${t('正在载入盟约与策略数据…')}</div>` : html`<main class="lo-body">
      <section class="lo-roster eq-list">
        <div class="lo-chips al-tabs" role="tablist" aria-label=${t('分类')}>
          <button type="button" role="tab" class=${cx('lo-chip', 'al-tab', bondsTab && 'is-on')} aria-selected=${bondsTab ? 'true' : 'false'}
            data-tab="bonds" onClick=${() => setTab('bonds')}><${Icon} name="crown" />${t('盟约')} <span class="num">${bonds.length}</span></button>
          <button type="button" role="tab" class=${cx('lo-chip', 'al-tab', !bondsTab && 'is-on')} aria-selected=${!bondsTab ? 'true' : 'false'}
            data-tab="bands" onClick=${() => setTab('bands')}><${Icon} name="sword" />${t('策略')} <span class="num">${bands.length}</span></button>
        </div>
        ${bondsTab
          ? html`<${BondFilters} filters=${st.filters.bonds} phases=${phases} onChange=${(f) => allianceStore.set({ filters: { ...st.filters, bonds: f } })} />`
          : html`<${BandFilters} filters=${st.filters.bands} modes=${modes} onChange=${(f) => allianceStore.set({ filters: { ...st.filters, bands: f } })} />`}
        <div class=${cx('lo-grid', 'al-grid', bondsTab ? 'al-grid--bonds' : 'al-grid--bands')} role="listbox" aria-label=${bondsTab ? t('盟约列表') : t('策略列表')} ref=${gridRef}>
          ${bondsTab
            ? (listBonds.length
              ? html`<${Fragment}>
                  <div class="al-group" role="presentation"><span class="al-group__k">${t('核心盟约')}</span><span class="al-group__n num">${listBonds.filter((r) => r.isCore).length}</span></div>
                  ${listBonds.filter((r) => r.isCore).map((row) => html`<${BondCard} key=${row.bond.bondId} row=${row} m=${m}
                    selected=${row.bond.bondId === selId} onPick=${(id) => allianceStore.set({ bond: id })} />`)}
                  <div class="al-group" role="presentation"><span class="al-group__k">${t('附加盟约')}</span><span class="al-group__n num">${listBonds.filter((r) => !r.isCore).length}</span></div>
                  ${listBonds.filter((r) => !r.isCore).map((row) => html`<${BondCard} key=${row.bond.bondId} row=${row} m=${m}
                    selected=${row.bond.bondId === selId} onPick=${(id) => allianceStore.set({ bond: id })} />`)}
                <//>`
              : html`<p class="lo-empty t-dim">${t('没有符合条件的盟约')}</p>`)
            : (listBands.length
              ? listBands.map((row) => html`<${BandCard} key=${row.band.bandId} row=${row}
                  selected=${row.band.bandId === selId} onPick=${(id) => allianceStore.set({ band: id })} />`)
              : html`<p class="lo-empty t-dim">${t('没有符合条件的策略')}</p>`)}
        </div>
      </section>
      <div class="lo-detail-wrap">
        ${selBond ? html`<${BondDetail} row=${selBond} m=${m} items=${items} chessById=${chessById}
          onItem=${(id) => openEquipCodex(st.from || 'lobby', id)} />` : null}
        ${selBand ? html`<${BandDetail} row=${selBand} bondById=${bondById} />` : null}
      </div>
    </main>`}
  </div>`;
}

/** Mounted once (main.js): renders the overlay while open — same rules as <EquipHost/>. */
export function AllianceCodexHost() {
  const st = useStore((s) => s, Object.is, allianceStore);
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  const wasInMatch = useRef(inMatch);
  useEffect(() => {
    if (shouldAutoClose(st, phase, inMatch, wasInMatch.current)) closeAllianceCodex();
    wasInMatch.current = inMatch;
  }, [phase, inMatch, st.open]);
  useEffect(() => {
    if (st.open) document.documentElement.classList.add('sp-alliance-open');
    else document.documentElement.classList.remove('sp-alliance-open');
  }, [st.open]);
  if (!st.open) return null;
  return html`<${AllianceScreen} st=${st} />`;
}

/** Entry button (lobby / room / briefing), right next to 查看装备. */
export function AllianceCodexButton({ from = 'lobby', size = 'md', variant = 'secondary', class: cls, label = t('盟约与策略') }) {
  return html`<button type="button" class=${cx('btn', `btn--${variant}`, `btn--${size}`, 'al-entry', cls)} data-testid="alliance-open"
      onClick=${() => openAllianceCodex(from)} title=${t('查看全部盟约（层数、成员、相关装备）与全部策略')}>
    <${Icon} name="crown" class="btn__icon" />
    <span class="btn__label">${label}</span>
  </button>`;
}
