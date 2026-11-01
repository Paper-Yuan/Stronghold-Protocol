// S.W.E.E.P.报告: the event's report screen (laid out after the event video 2:17 – 3:03; the backdrop is drawn in CSS,
// every picture is the game's own icon or art), opened from the lobby's top bar. Read-only: it shows the season's data
// and changes nothing. Three tabs —
//   盟约报告 — 核心盟约 / 附加盟约 tiles (bonds.json isCore); the left panel: the glyph, the name, 激活所需人数 and the
//              thresholds, the description, 对应干员 (visibleMembers by tier; 替补 on an operator marked 未持有 in 干员持有);
//   策略报告 — the strategies (bands.json) as tiles; the left: icon, name, 初始生命值, the effect, the modes it is offered
//              in and its bonds;
//   敌方资料 — 领袖 (bosses.json, the hidden variants left out) and 战术特训敌人 (factions.json types) tiles; the left: art,
//              name, text and the leader with its escorts / the type's enemies; 查看 opens the enemy codex (全部 / 普通 /
//              精英 / 领袖, a search; per stat the official handbook's letter grade — factions.json handbookLevels, from
//              enemy_handbook_table levelInfoList: E … SS — with the enemy's own number beside it).
// ⓘ opens 玩法说明 at its 进阶图鉴 chapter. The report and the codex are full-screen Modals (focus trap; Esc closes the
// codex first, then the report; the focus returns to the lobby's button). The tab is remembered (sp.pref).
// 原版 / 超限 (业主 2026-10-31，2026-11-01 回填): the header carries one more segmented switch (sw-vars) between ⓘ and the
// tabs. 超限 is NOT a play set (`extension`): it is a difficulty mark on an official mode (`solo_infinite` /
// `flags.overlimit`) that changes numbers, never the bond table — so it rides a separate `variant` prop
// ('official' | 'overlimit', official by default). The overlimit view lists the same 23 bonds, but a bond whose record
// carries the `inf` overlay (data/bonds.json) shows that overlay's 超限模拟 lines: a lit block in the panel with the
// strengthening, read from the data (no copy or number is written in this file). A rewritten bond WITHOUT an `inf` block
// keeps the old dashed placeholder, so 已配置 / 未配置 stay distinguishable. The official view never reads `inf` and is
// byte-for-byte what it was. Inside that block only the numbers are accented (业主 2026-11-01): the line is cut into
// fragments by `overlimitValueSegments` — a value expression (25→9999, +12%, (15+0.2×层数)%, 400×层数, 250万 …) becomes
// an .olb-num node, the prose around it stays body-coloured. The data's own <@ba.vup>…</> markup wraps whole phrases,
// so it is stripped first instead of reused: no whole-sentence tinting, no tag parser.
// The cutting and the rendering both live in ONE module — ui/overlimitBondText.js (`overlimitValueSegments` +
// `OverlimitValueLine`), which the in-match bond popup (ui/bondStrip.js, 超限局) renders too: 业主 2026-11-01
// 「局内显示盟约时也要按同一规则只强调数值片段」，分色逻辑只有一份，这里不许再写一套。Colour: the shared `.olb-num`
// class (css/components.css) — this screen's css carries none.
// Styles: css/screens/sweep.css (sw-*).

import { useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal, roman } from '../ui/components.js';
import { Img, RichText, GIcon } from '../ui/gameComponents.js';
import { OverlimitValueLine } from '../ui/overlimitBondText.js';
import { bondIconUrl, bandIconUrl, enemyIconUrl, factionIconUrl, chessAvatarUrl } from '../ui/assetUrls.js';
import { attackInterval, fmtNum } from '../ui/gameLogic.js';
import { abilityRows } from '../ui/abilityLines.js';
import { data, useData } from '../data.js';
import { contentSet, pageVersion, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, shownVersion } from '../versions.js';
import { useStore, loadPref, savePref } from '../store.js';
import { loadoutStore } from '../ui/loadoutSync.js';
import { openGuide, guidePages } from '../ui/guide.js';
import { officialBonds, officialBands } from '../ui/zjView.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAB_PREF = 'sweep.tab';
const TABS = [
  { id: 'bonds', name: N_('盟约报告'), icon: () => html`<${Icon} name="link" />` },
  { id: 'bands', name: N_('策略报告'), icon: () => html`<${Icon} name="rook" />` },
  { id: 'enemies', name: N_('敌方资料'), icon: () => html`<${GIcon} name="target" />` },
];
const MODE_NAME = { SINGLE: N_('独立模拟'), MULTI: N_('同盟模拟') };
/** 超限视图的第四页：词条（只在「超限」那一侧出现 —— 词条是超限专属，官方视图里没有这张表）。 */
const RELIC_TAB = { id: 'relics', name: N_('词条'), icon: () => html`<${GIcon} name="bolt" />` };const RANK = { NORMAL: N_('普通'), ELITE: N_('精英'), BOSS: N_('领袖') };
const APPLY = { MELEE: N_('近战'), RANGED: N_('远程'), ALL: N_('近战 / 远程'), NONE: N_('不攻击') };
const DMG = { phys: N_('物理'), arts: N_('法术'), heal: N_('治疗') };

// ---- 原版 / 超限 视图 (业主 2026-10-31) --------------------------------------------------------------------------------
// 超限（solo_infinite / coop_infinite）不是玩法包：它是官方模式上的难度标记（`solo_infinite` / `flags.overlimit`），
// 引擎里改的是数值、不改盟约表。所以报告这一侧只需要一个**视图**开关，数据一律不动（官方 23 条仍原样）。
export const SWEEP_VARIANTS = ['official', 'overlimit'];
export const DEFAULT_SWEEP_VARIANT = 'official';
/**
 * 被超限改写的五条大盟约（业主 2026-10-31 点名的五条）。超限视图里它们走 `inf` 覆盖块；**只有**记录不带 `inf`
 * 块时（例如没有超限数据的赛季版本）才回落到虚线占位块 —— 「已配置 / 未配置」由数据而不是名单决定。
 */
export const OVERLIMIT_PENDING_BONDS = Object.freeze(['egirShip', 'lateranoShip', 'victoriaShip', 'sargonShip', 'siracusaShip']);
const PENDING_BONDS = new Set(OVERLIMIT_PENDING_BONDS);

// 超限视图的固定文案（业主 2026-10-31：**不许新增 msgid**；2026-11-01 回填时只改横幅那一句）。
// 所以下面几条**故意**是未进 i18n 的中文字面量，全部集中在这一处；定稿后逐条改成 t('…') 并补 public/i18n/*.json。
// 「原版」不复抄在这里：它是已有 msgid，直接用 t('原版')；强化的标题直接复用已有 msgid t('超限模拟')。
// banner 是函数：N = 报告里带 `inf` 覆盖块（= 强化已配置）的盟约条数，由数据算出来，不写死。
const OVERLIMIT_COPY = {
  label: '超限', // i18n-ignore: 业主这一轮不许新增 msgid（定稿后改 t()）
  banner: (n) => `超限视图 · 已配置 ${n} 条盟约强化`, // i18n-ignore: 事实性横幅，N 由 inf 块计数
  bannerLive: '当前对局使用超限数值', // i18n-ignore: 同上（从超限房进来时才显示）
  pending: '超限专属：待定', // i18n-ignore: 同上（只在 `inf` 块缺失时出现）
};

// 业主 2026-10-31（超限 V2 定稿）：数值被超限改写的盟约，在超限视图里显示成「XXX 超限」（例：维多利亚 超限）。
// 名单 = 上一轮的 5 条占位（阿戈尔 / 拉特兰 / 维多利亚 / 萨尔贡 / 叙拉古）+ 本轮新进 `inf` 覆盖块的 3 条
// （炎 / 卡西米尔 / 谢拉格）—— 这 8 条就是 data/bonds.json 里带 `inf` 块的那 8 条。
// **不新增 msgid**：后缀直接用上面已有的 OVERLIMIT_COPY.label（带 // i18n-ignore 的那条），名字用拼接。
// 位置很关键：这一段必须在 OVERLIMIT_COPY **之后**（displayName 是惰性求值，但把 label 提前读出来会 TDZ）。
export const OVERLIMIT_REWRITTEN_BONDS = Object.freeze([
  ...OVERLIMIT_PENDING_BONDS,
  'yanShip', 'kazimierzShip', 'kjeragShip',
]);
const REWRITTEN_BONDS = new Set(OVERLIMIT_REWRITTEN_BONDS);
/**
 * 超限视图里的盟约名：被改写的盟约 = `名字 + 空格 + 超限`（后缀是已有的 OVERLIMIT_COPY.label，不新增 msgid）；
 * 官方视图（`overlimit === false`）永远回落到数据里的 `name`，逐字节等于改动前。
 * 导出：`test/ui/sweep.test.js` 直接拿它断言「超限视图带后缀 / 官方视图不带」。
 * @param {{ name?: string, bondId?: string }} b
 * @param {boolean} overlimit
 * @returns {string}
 */
export const bondDisplayName = (b, overlimit) => (overlimit && REWRITTEN_BONDS.has(b.bondId) ? `${b.name} ${OVERLIMIT_COPY.label}` : b.name);

/** `data/bonds.json` 的 `inf` 块里，超限专属行的前缀（与 tools/build-data.mjs 的源文件同一词）。 */
export const OVERLIMIT_MARK = '【超限模拟】';

/**
 * 一条盟约在超限视图里的展示数据 —— **全部读 `data/bonds.json` 的 `inf` 覆盖块**，本文件不写死任何文案或数值：
 *   configured 记录有没有 `inf` 块（= 这条强化已配置）；
 *   name       超限视图的名字（`bondDisplayName`；官方视图逐字节回落数据里的 `name`）；
 *   descRaw    描述的基础部分：`inf` 块存的是「原版原文 + 追加的超限行」，所以基础部分仍是原记录的 `descRaw`；
 *   changes    `inf` 块里以 `【超限模拟】` 开头的行，去掉前缀 —— 就是这一条的强化幅度（原版数字 → 超限规则）。
 * 基础 `descRaw` 与 `changes` 拼起来逐字等于 `inf.descRaw`（断言见 test/ui/sweep.test.js）。
 * 官方视图（`overlimit === false`）不读 `inf`：descRaw / name / configured 都与改动前逐字节一致。
 * @param {any} bond data/bonds.json 的一条盟约记录
 * @param {boolean} [overlimit]
 * @returns {{ configured: boolean, name: string, descRaw: string, changes: string[] }}
 */
export function overlimitBondView(bond, overlimit = true) {
  const b = bond || {};
  const inf = overlimit && b.inf && typeof b.inf === 'object' ? b.inf : null;
  const base = String(b.descRaw || b.desc || '');
  const infText = String((inf && (inf.descRaw || inf.desc)) || '');
  const markAt = infText.indexOf(OVERLIMIT_MARK);
  // `inf` 块 = 原版原文 + `\n` + 超限行；去掉超限行前那一个换行，得到与基础记录 descRaw 逐字相同的描述
  const infBase = (markAt >= 0 ? infText.slice(0, markAt) : infText).trimEnd();
  const changes = infText.split('\n').map((s) => s.trim())
    .filter((s) => s.startsWith(OVERLIMIT_MARK))
    .map((s) => s.slice(OVERLIMIT_MARK.length).trim())
    .filter(Boolean);
  return {
    configured: !!inf,
    name: bondDisplayName(b, overlimit),
    // 描述的基础部分直接从 `inf` 块里 `【超限模拟】` 之前截出来（与基础记录的 descRaw 逐字相同）；
    // 极端数据下 `inf` 没有这段时才退回基础记录，仍然不写死字面量
    descRaw: inf ? (infBase || base) : base,
    changes,
  };
}

/**
 * 超限视图里这一条该画虚线占位块还是可点的瓦片：只有**被超限改写、且 `inf` 覆盖块缺失**的五条才是占位。
 * 数据里已有 `inf` 块（默认版本）→ false = 真实瓦片；没有超限数据的赛季版本 → true = 仍显示「超限专属：待定」。
 * @param {any} bond @param {boolean} [overlimit]
 */
export function overlimitBondPending(bond, overlimit = true) {
  return !!overlimit && PENDING_BONDS.has(bond?.bondId) && !overlimitBondView(bond, true).configured;
}

/** 报告里「已配置盟约强化」的条数 = 带 `inf` 覆盖块的盟约数（in 当前输入版本的数据）。 */
export const overlimitConfiguredCount = (bonds) => (Array.isArray(bonds) ? bonds : [])
  .filter((b) => b && b.inf && typeof b.inf === 'object').length;

// ---- 强化行的数值分色（业主 2026-11-01）-----------------------------------------------------------------------------
// 分词与渲染**都不在这一页**：`overlimitValueSegments`（值表达式切段）与 `OverlimitValueLine`（强调节点）住在
// ui/overlimitBondText.js —— 局内的盟约弹窗（ui/bondStrip.js，超限局）渲染同一个组件，所以两处的片段序列与类名
// 不可能走散。切段口径（25→9999 / (15+0.2×层数)% / 单独的「层数」不算数值 …）写在那个文件里，本文件不再复述。

// ---- enemy grades ------------------------------------------------------------------------------------------------------

/**
 * Letter grade of one stat by the official enemy handbook (factions.json `handbookLevels`, generated from
 * enemy_handbook_table `levelInfoList`: ten grades E … SS, each a [min, max) band per stat; `interval` — the attack
 * interval in seconds — grades the other way round). '—' when the enemy has no such value (no attack, no movement) or the
 * value is in no band. [ASSUMED] the bands share their edges: a value on an edge takes the band that starts there.
 * @param {string} key enemies.json stat (maxHp, atk, def, res, moveSpeed, interval, elementRes, elementDmgRes)
 * @param {number|null|undefined} v @param {any[]} [levels] handbookLevels (default: the loaded factions.json)
 * @returns {string}
 */
export function enemyGrade(key, v, levels = data.get('factions')?.handbookLevels) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n) || !Array.isArray(levels)) return '—';
  for (const l of levels) {
    const band = l?.[key];
    if (!Array.isArray(band)) continue;
    const [lo, hi] = band;
    if (n >= lo && (hi == null || n < hi)) return l.level;
  }
  return '—';
}

/**
 * The codex's enemies: every enemy but the summon-only ones, one per 图鉴 number (a hidden boss variant shares its
 * number), by id.
 * @param {any[]} list enemies.json records
 */
export function codexEnemies(list) {
  const seen = new Set();
  const out = [];
  const num = (k) => { const m = /enemy_(\d+)/.exec(k || ''); return m ? Number(m[1]) : 1e9; };
  for (const e of [...(Array.isArray(list) ? list : [])].sort((a, b) => num(a?.key) - num(b?.key) || String(a?.key).localeCompare(String(b?.key)))) {
    if (!e || typeof e.key !== 'string' || e.tokenOnly) continue;
    const id = e.handbookIndex ? `${e.handbookIndex}|${e.name}` : e.key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** Unique enemy keys of a boss: the leader, then its escorts (every template). @param {any} boss bosses.json record */
export function bossEnemyKeys(boss) {
  const keys = [boss?.enemyKey];
  for (const list of Object.values(boss?.escortsByTemplate || {})) for (const e of Array.isArray(list) ? list : []) keys.push(e?.key);
  return [...new Set(keys.filter((k) => typeof k === 'string' && k))];
}

// ---- small pieces ------------------------------------------------------------------------------------------------------

/** The big square at the top of the left panel (bracket corners, a ring behind a glyph or the art).
 * `icon` = the picture is a square game icon that fills the ring (object-fit: cover, like the relic tiles); the box
 * keeps its size and brackets, and a missing / broken picture still falls back to the glyph. */
function Hero({ src, glyph = false, art = false, icon = false, name, sub = null, fallback }) {
  return html`<div class="sw-hero">
    <span class=${cx('sw-hero__box', glyph && 'is-glyph', art && 'is-art')}>
      <i class="sw-hero__c sw-hero__c--tl"></i><i class="sw-hero__c sw-hero__c--br"></i>
      <span class=${cx('sw-hero__img', icon && 'sw-hero__img--icon')}><${Img} src=${src} fallback=${fallback} /></span>
    </span>
    <h3 class="sw-hero__name">${name}</h3>
    ${sub ? html`<span class="sw-hero__sub">${sub}</span>` : null}
  </div>`;
}

/** One tile of the right grid. `cls` is an optional extra modifier (the negative relic segment colours the tile). */
function Tile({ on, onClick, title, kind, children, badge = null, cls = null }) {
  return html`<button type="button" class=${cx('sw-tile', `sw-tile--${kind}`, on && 'is-on', cls)} onClick=${onClick} title=${title} aria-pressed=${on ? 'true' : 'false'}>
    <span class="sw-tile__in">${children}</span>${badge}
  </button>`;
}

/** A section of the right grid: a glyph above `[ name ]`, then its tiles. */
function Section({ name, glyph, children, count = null }) {
  return html`<section class="sw-sec">
    <header class="sw-sec__head">
      <span class="sw-sec__glyph">${glyph}</span>
      <span class="sw-sec__name"><i>[</i>${name}${count != null ? html`<small class="num">${count}</small>` : null}<i>]</i></span>
    </header>
    <div class="sw-sec__grid">${children}</div>
  </section>`;
}

// ---- 原版 / 超限 的壳 (业主 2026-10-31) --------------------------------------------------------------------------------

/**
 * The header's segmented switch: two pills, 原版 / 超限. It changes the view only — no data, no pref (the tab is the only
 * thing the report remembers). The pills are ≥ 32 px tall at every size (a touch target, css/screens/sweep.css).
 * @param {{ value: 'official'|'overlimit', onChange: (v: string) => void }} props
 */
function VariantSwitch({ value, onChange }) {
  const items = [
    { id: 'official', name: t('原版') },
    { id: 'overlimit', name: OVERLIMIT_COPY.label },
  ];
  return html`<div class="sw-vars" role="group" aria-label=${`S.W.E.E.P. ${t('原版')} / ${OVERLIMIT_COPY.label}`}>
    ${items.map((it) => html`<button key=${it.id} type="button" class=${cx('sw-var', value === it.id && 'is-on')}
      aria-pressed=${value === it.id ? 'true' : 'false'} data-variant=${it.id} onClick=${() => onChange(it.id)}>${it.name}</button>`)}
  </div>`;
}

/**
 * The thin band under the header of the overlimit view: 超限视图 · 已配置 N 条盟约强化（N = 带 `inf` 覆盖块的盟约数，
 * 由数据算出）, plus — when the report was opened from an overlimit room — 当前对局使用超限数值.
 * @param {{ live?: boolean, configured?: number|null }} props
 */
function OverlimitBanner({ live = false, configured = null }) {
  const text = Number.isFinite(configured) ? OVERLIMIT_COPY.banner(configured) : OVERLIMIT_COPY.label;
  return html`<div class="sw-banner" role="status" data-variant="overlimit" data-live=${live ? 'true' : 'false'} data-configured=${Number.isFinite(configured) ? configured : 'unknown'}>
    <${Icon} name="warn" class="sw-banner__icon" />
    <span class="sw-banner__txt">${text}</span>
    ${live ? html`<span class="sw-banner__live">${OVERLIMIT_COPY.bannerLive}</span>` : null}
  </div>`;
}

/**
 * The dashed block that stands where one of the five 超限-rewritten bonds' tile would be **when its record has no `inf`
 * overlay** (a season version without overlimit data): the pending label and the bond's name, so it is still clear which
 * one is missing. With the `inf` block present the tile is a real, clickable Tile instead. Not a button: there is
 * nothing to open.
 * @param {{ name: string }} props
 */
function PendingTile({ name }) {
  return html`<div class="sw-tile sw-tile--pending" role="note" title=${name}>
    <span class="sw-tile__in"><span class="sw-pending">${OVERLIMIT_COPY.pending}</span></span>
    <span class="sw-tile__cap">${name}</span>
  </div>`;
}

/** A small enemy thumbnail with its 图鉴 number in the corner. */
function EnemyThumb({ e, m, on = false, onClick = null, size = 'sm' }) {
  const Tag = onClick ? 'button' : 'span';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${cx('sw-eth', `sw-eth--${size}`, on && 'is-on', e.rank === 'BOSS' && 'is-boss', e.rank === 'ELITE' && 'is-elite')}
      onClick=${onClick} title=${e.name}>
    <${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} />
    ${e.handbookIndex ? html`<span class="sw-eth__no">${e.handbookIndex}</span>` : null}
  <//>`;
}

// ---- 盟约报告 ----------------------------------------------------------------------------------------------------------

/**
 * 一条强化幅度（`inf` 块里 `【超限模拟】` 那一行）：数值片段用强调节点，其余是普通正文色（业主 2026-11-01）。
 * 直接用共享模块的 `OverlimitValueLine`（ui/overlimitBondText.js）—— 局内的盟约弹窗渲染的是同一个组件，
 * 本页只负责给它自己的版式类名 `.sw-inf__line`（颜色由共享类 `.olb-num` 负责，见 css/components.css）。
 * @param {{ text: string }} props
 */
function ValueLine({ text }) {
  return html`<${OverlimitValueLine} text=${text} class="sw-inf__line" />`;
}

function BondPanel({ bond, m, notOwned, variant = DEFAULT_SWEEP_VARIANT }) {
  const off = new Set(Array.isArray(notOwned) ? notOwned : []);
  const ids = Array.isArray(bond.visibleMembers) && bond.visibleMembers.length ? bond.visibleMembers : (bond.members || []);
  const members = ids.map((id) => data.lookup('chess', id)).filter(Boolean)
    .sort((a, b) => (b.tier - a.tier) || ((a.shopSortId ?? 0) - (b.shopSortId ?? 0)));
  const anyOff = members.some((c) => off.has(c.chessId));
  const steps = Array.isArray(bond.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  // 超限视图：名字带后缀，描述 / 强化行全部来自 data/bonds.json 的 `inf` 块；官方视图走同一条分支但不读 inf。
  // 强化行放在描述之前、滚动区之外 —— 任何视口下都能直接看到这条的幅度，不需要先滚描述。
  const ov = overlimitBondView(bond, variant === 'overlimit');
  const name = ov.name;
  return html`<div class="sw-detail">
    <${Hero} src=${bondIconUrl(m, bond.bondId)} glyph=${true} name=${name}
      fallback=${html`<span class="sw-hero__txt">${[...(bond.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('激活所需人数')}<b class="num">${bond.activeCount ?? steps[0] ?? '—'}</b></span>
      ${steps.length > 1 ? html`<span class="sw-pill sw-pill--ghost" title=${t('达到这些人数时效果增强')}>${t('档位')}<b class="num">${steps.join(' / ')}</b></span>` : null}
      <span class="sw-kind">${bond.isCore ? t('核心盟约') : t('附加盟约')}</span>
    </div>
    ${ov.changes.length ? html`<section class="sw-inf" data-overlimit="bond">
      <h4 class="sw-text__h sw-inf__h">${t('超限模拟')}</h4>
      ${ov.changes.map((line, i) => html`<${ValueLine} key=${i} text=${line} />`)}
    </section>` : null}
    <div class="sw-text">
      <${RichText} as="p" text=${ov.descRaw} />
    </div>
    ${members.length ? html`<div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${Icon} name="user" />${t('对应干员')}<small class="num">${members.length}</small></span>
        ${anyOff ? html`<span class="sw-box__note"><span class="sw-box__swap" aria-hidden="true">⇄</span>${t('未持有的干员由替补干员上场')}</span>` : null}
      </div>
      <div class="sw-ops">${members.map((c) => html`<span key=${c.chessId} class=${cx('sw-op', `sw-op--t${c.tier}`, off.has(c.chessId) && 'is-standin')}
          title=${c.name}>
        <${Img} src=${chessAvatarUrl(m, c)} fallback=${html`<span class="sw-op__txt">${[...(c.name || '?')][0]}</span>`} />
        <span class="sw-op__tier">${roman(c.tier)}</span>
        ${off.has(c.chessId) ? html`<span class="sw-op__sub">${t('替补')}</span>` : null}
      </span>`)}</div>
    </div>` : null}
  </div>`;
}

/**
 * 盟约报告的瓦片墙。`variant === 'overlimit'` 时只换视图：列表仍是官方那 23 条；带 `inf` 覆盖块的盟约显示
 * 「XXX 超限」并保持可点（详情面板给出 `inf` 块里的强化行），只有五条被改写却没有 `inf` 块的盟约才是虚线占位。
 * 其余盟约与官方视图逐字节相同。
 */
function BondsTab({ m, sel, onSel, modeId = null, variant = DEFAULT_SWEEP_VARIANT }) {
  const all = officialBonds(data.list('bonds'), modeId).filter((b) => b && b.bondId).sort((a, b) => (a.identifier ?? 99) - (b.identifier ?? 99));
  const overlimit = variant === 'overlimit';
  const sections = [
    { id: 'core', name: t('核心盟约'), glyph: html`<${GIcon} name="flag" />`, items: all.filter((b) => b.isCore) },
    { id: 'extra', name: t('附加盟约'), glyph: html`<${Icon} name="link" />`, items: all.filter((b) => !b.isCore) },
  ];
  return sections.map((s) => s.items.length ? html`<${Section} key=${s.id} name=${s.name} glyph=${s.glyph} count=${s.items.length}>
    ${s.items.map((b) => {
      // 超限视图里被改写过的 8 条显示「XXX 超限」；官方视图 = 数据里的原名（逐字节不变）
      const name = bondDisplayName(b, overlimit);
      return overlimitBondPending(b, overlimit)
        ? html`<${PendingTile} key=${b.bondId} name=${name} />`
        : html`<${Tile} key=${b.bondId} kind="bond" on=${sel === b.bondId} onClick=${() => onSel(b.bondId)} title=${name}>
      <span class="sw-disc"><${Img} src=${bondIconUrl(m, b.bondId)} fallback=${html`<span class="sw-disc__txt">${[...(b.name || '?')][0]}</span>`} /></span>
      <span class="sw-tile__cap">${name}</span>
    <//>`;
    })}
  <//>` : null);
}

// ---- 策略报告 ----------------------------------------------------------------------------------------------------------

function BandPanel({ band, m }) {
  const modes = (Array.isArray(band.modeTypeList) ? band.modeTypeList : []).filter((k) => MODE_NAME[k]);
  const bonds = (Array.isArray(band.bondIds) ? band.bondIds : []).map((id) => data.lookup('bonds', id)).filter(Boolean);
  return html`<div class="sw-detail">
    <${Hero} src=${bandIconUrl(m, band.bandId)} art=${true} name=${band.name}
      fallback=${html`<span class="sw-hero__txt">${[...(band.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('初始生命值')}<b class="num">${band.totalHp ?? '—'}</b></span>
      ${modes.map((k) => html`<span key=${k} class="sw-pill sw-pill--ghost">${t(MODE_NAME[k])}</span>`)}
    </div>
    <div class="sw-text">
      ${band.effectName ? html`<h4 class="sw-text__h">${band.effectName}</h4>` : null}
      <${RichText} as="p" text=${band.descRaw || band.desc || ''} />
      ${bonds.length ? html`<p class="sw-text__bonds">${t('相关盟约')}${bonds.map((b) => html`<span key=${b.bondId} class="sw-chip">
        <${Img} src=${bondIconUrl(m, b.bondId)} />${b.name}</span>`)}</p>` : null}
    </div>
  </div>`;
}

function BandsTab({ m, sel, onSel, modeId = null }) {
  // 策略同样按模式的「官方子集」过滤（炸惊专属的 band_zj_fuuka / band_zj_si 只在炸惊房里出现）
  const all = officialBands(data.list('bands'), modeId).filter((b) => b && b.bandId).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
  return html`<${Section} name=${t('策略')} glyph=${html`<${Icon} name="rook" />`} count=${all.length}>
    ${all.map((b) => html`<${Tile} key=${b.bandId} kind="band" on=${sel === b.bandId} onClick=${() => onSel(b.bandId)} title=${b.name}>
      <span class="sw-face"><${Img} src=${bandIconUrl(m, b.bandId)} fallback=${html`<span class="sw-face__txt">${[...(b.name || '?')][0]}</span>`} /></span>
      <span class="sw-tile__cap">${b.name}</span>
      <span class="sw-tile__hp num" title=${t('初始生命值')}>${b.totalHp}</span>
    <//>`)}
  <//>`;
}

// ---- 词条（超限「饰品」+「负面词条」）报告 -------------------------------------------------------------------------------
//
// 业主 2026-10-31：超限视图（头部那组「原版 / 超限」）里也要能看到**词条**这一栏，版式与盟约 / 策略 / 敌方同一套
// （sw-detail + sw-sec + sw-tile），数据只读 data/relicsOverlimit.json（默认版本专属，普通对局不存在这张表）。
// 业主 2026-10-31 第二批：负面词条（data/relicsOverlimitNegative.json，17 条）也进这一页，并且**单独一段**：
//   段一（36 条饰品）+ 段二 `负面词条`（17 条负面），各自按自己的表、自己的顺序、自己的计数；
//   负面段沿用本页的瓦片版式，只把圆环 / 编号染成既有 `neg` 分组色（#ff4d4d，与 ui/overlimitRelics.js 的浮层和
//   已选面板同一套，不新造颜色）。
// 业主 2026-10-31 第三批（定稿）：第一段的段名由 `词条` 改成 **`饰品`** —— 为此新增唯一一条 msgid `饰品`
// （四语包各 +1：en Relics / ja 遺物 / ko 유물 / zh-TW 飾品，与既有「已选饰品」一贯的译法同一套）；
//   第二段 `负面词条` 一字不动；页签与详情抬头仍用既有的 t('词条') / t('词条抉择')，未实装标记暂借 t('暂不可用')。
// 详情大图（同批）：RelicPanel 的 Hero 过去 `src` 恒为 null，那块大图因此永远画首字；现在有 `icon` 就画 <img>
//   （与瓦片同一套 object-fit: cover，圆形容器沿用现状），数据缺 `icon` 或加载失败才回落首字。

/** 词条表（data/relicsOverlimit.json）：{ entries: [...] }，表还没到货时是空数组。 */
const relicEntriesOf = () => {
  const t0 = data.get('relicsOverlimit');
  return t0 && Array.isArray(t0.entries) ? t0.entries.filter((e) => e && typeof e.id === 'string') : [];
};

/** 负面词条表（data/relicsOverlimitNegative.json）：同上；表缺失（非超限版本）时是空数组，负面段就不画。 */
const negativeEntriesOf = () => {
  const t0 = data.get('relicsOverlimitNegative');
  return t0 && Array.isArray(t0.entries) ? t0.entries.filter((e) => e && typeof e.id === 'string') : [];
};

export function RelicPanel({ relic }) {
  if (!relic) return null;
  const pending = relic.impl === 'pending';
  return html`<div class="sw-detail">
    <${Hero} src=${relic.icon || null} icon=${!!relic.icon} glyph=${true} name=${relic.name} sub=${relic.id}
      fallback=${html`<span class="sw-hero__txt">${[...(relic.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('词条')}<b class="num">${relic.id}</b></span>
      ${pending ? html`<span class="sw-pill sw-pill--ghost" title=${t('暂不可用')}>${t('暂不可用')}</span>` : null}
      <span class="sw-kind">${relic.group}</span>
    </div>
    <div class="sw-text">
      <${RichText} as="p" text=${relic.desc || ''} />
      ${relic.flavor ? html`<p class="sw-text__bonds"><span class="sw-chip">${relic.flavor}</span></p>` : null}
    </div>
  </div>`;
}

export function RelicsTab({ sel, onSel }) {
  const all = relicEntriesOf();
  const neg = negativeEntriesOf();
  // 图标（业主 2026-10-31 解图）：数据的 `icon` 是 /assets/relics/overlimit/<词条编号>.png（负面是
  // /assets/relics/overlimit-negative/<编号>.png），有就画 <img>，没有（或加载失败）就落回原来的首字圆形占位 ——
  // 同一个 Img 的 fallback，不新增文案 / DOM；圆形容器与尺寸沿用盟约瓦片的 .sw-disc（64% 宽）。
  // 两段共用 t('饰品') / t('负面词条')：第一段是业主 2026-10-31 第三批新增的 msgid `饰品`（四语包各 +1），
  // 第二段沿用既有的 t('负面词条')；负面瓦片多一个 sw-disc--neg（#ff4d4d 圆环）。
  const tile = (e, negative = false) => html`<${Tile} key=${e.id} kind="bond" cls=${negative ? 'sw-tile--neg' : null}
      on=${sel === e.id} onClick=${() => onSel(e.id)} title=${e.name}>
    <span class=${cx('sw-disc', e.icon && 'sw-disc--art', negative && 'sw-disc--neg')}><${Img} src=${e.icon || null}
      fallback=${html`<span class="sw-disc__txt">${[...(e.name || '?')][0]}</span>`} /></span>
    <span class="sw-tile__cap">${e.name}</span>
    <span class="sw-tile__hp num" title=${e.id}>${e.id}</span>
  <//>`;
  return html`
    <${Section} name=${t('饰品')} glyph=${html`<${GIcon} name="bolt" />`} count=${all.length}>
      ${all.map((e) => tile(e))}
    <//>
    ${neg.length ? html`<${Section} name=${t('负面词条')} glyph=${html`<${GIcon} name="warn" />`} count=${neg.length}>
      ${neg.map((e) => tile(e, true))}
    <//>` : null}`;
}

// ---- 敌方资料 ----------------------------------------------------------------------------------------------------------

/** The enemies tab's entries: { kind: 'boss'|'type', id }. */
const bossList = () => (data.list('bosses') || []).filter((b) => b && b.bossId && !b.hidden).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
const typeList = () => Object.values(data.get('factions')?.types || {}).filter((f) => f && f.type).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
const typeKeys = (f) => [...new Set([...(Array.isArray(f?.pool) ? f.pool : []), ...(Array.isArray(f?.entries) ? f.entries : [])])];

function EnemyPanel({ sel, m, onCodex }) {
  if (sel.kind === 'boss') {
    const boss = data.lookup('bosses', sel.id);
    if (!boss) return null;
    const e = data.lookup('enemies', boss.enemyKey);
    const escorts = bossEnemyKeys(boss).slice(1).map((k) => data.lookup('enemies', k)).filter(Boolean);
    return html`<div class="sw-detail">
      <${Hero} src=${enemyIconUrl(m, boss.enemyKey)} art=${true} name=${boss.name} fallback=${html`<${GIcon} name="skull" />`} />
      <div class="sw-text"><${RichText} as="p" text=${e?.descRaw || e?.desc || ''} /></div>
      <div class="sw-box">
        <div class="sw-box__head">
          <span class="sw-box__k"><${GIcon} name="skull" />${t('敌方领袖')}</span>
          <button type="button" class="sw-look" onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: boss.enemyKey })}><${Icon} name="search" />${t('查看')}</button>
        </div>
        <div class="sw-ethumbs">
          ${e ? html`<${EnemyThumb} e=${e} m=${m} onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: e.key })} />` : null}
          ${escorts.length ? html`<span class="sw-ethumbs__sep">${t('护卫')}</span>` : null}
          ${escorts.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: boss.name, keys: bossEnemyKeys(boss), key: x.key })} />`)}
        </div>
      </div>
    </div>`;
  }
  const f = data.get('factions')?.types?.[sel.id];
  if (!f) return null;
  const list = typeKeys(f).map((k) => data.lookup('enemies', k)).filter(Boolean);
  const keys = codexEnemies(list).map((e) => e.key);
  const shown = keys.map((k) => data.lookup('enemies', k));
  return html`<div class="sw-detail">
    <${Hero} src=${factionIconUrl(m, f.icon)} glyph=${true} name=${f.name} fallback=${html`<${GIcon} name="target" />`} />
    <div class="sw-text"><p class="rt">${f.desc || ''}</p></div>
    <div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${GIcon} name="target" />${t('敌方情报')}<small class="num">${shown.length}</small></span>
        <button type="button" class="sw-look" onClick=${() => onCodex({ title: f.name, keys, key: keys[0] })}><${Icon} name="search" />${t('查看')}</button>
      </div>
      <div class="sw-ethumbs sw-ethumbs--grid">
        ${shown.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: f.name, keys, key: x.key })} />`)}
      </div>
    </div>
  </div>`;
}

function EnemiesTab({ m, sel, onSel, onCodex }) {
  const bosses = bossList();
  const types = typeList();
  const total = codexEnemies(data.list('enemies') || []).length;
  return html`
    <${Section} name=${t('领袖')} glyph=${html`<${GIcon} name="skull" />`} count=${bosses.length}>
      ${bosses.map((b) => html`<${Tile} key=${b.bossId} kind="boss" on=${sel.kind === 'boss' && sel.id === b.bossId} onClick=${() => onSel({ kind: 'boss', id: b.bossId })} title=${b.name}>
        <span class="sw-art"><${Img} src=${enemyIconUrl(m, b.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-tile__cap">${b.name}</span>
      <//>`)}
    <//>
    <${Section} name=${t('战术特训敌人')} glyph=${html`<${GIcon} name="target" />`} count=${types.length}>
      ${types.map((f) => html`<${Tile} key=${f.type} kind="type" on=${sel.kind === 'type' && sel.id === f.type} onClick=${() => onSel({ kind: 'type', id: f.type })} title=${f.name}>
        <span class="sw-glyph"><${Img} src=${factionIconUrl(m, f.icon)} fallback=${html`<${GIcon} name="target" />`} /></span>
        <span class="sw-tile__cap">${String(f.name || f.type).replace(t('特训敌人·'), '')}</span>
      <//>`)}
    <//>
    <button type="button" class="sw-allcodex" onClick=${() => onCodex({ title: null, keys: null, key: null })}>
      <${GIcon} name="skull" /><span><b>${t('敌方图鉴')}</b><small>${t('全部 {n} 种敌人 · 评级与实际数值', { n: total })}</small></span><${Icon} name="chevronRight" />
    </button>`;
}

// ---- the enemy codex ---------------------------------------------------------------------------------------------------

const STAT_ROWS = [
  ['maxHp', N_('生命值'), 'plus'], ['moveSpeed', N_('移动速度'), 'chevrons'],
  ['atk', N_('攻击力'), 'sword'], ['interval', N_('攻击间隔'), 'hourglass'],
  ['def', N_('防御力'), 'shield'], ['elementRes', N_('元素抗性'), 'snow'],
  ['res', N_('法术抗性'), 'bolt'], ['elementDmgRes', N_('损伤抵抗'), 'warn'],
];

function statValue(e, key) {
  const s = e?.stats || {};
  if (key === 'interval' || key === 'atk') {
    if (e?.applyWay === 'NONE' && !(Number(s.atk) > 0)) return null; // never attacks
    return key === 'atk' ? s.atk ?? 0 : attackInterval(s.bat, s.aspd);
  }
  if (key === 'moveSpeed') return Number(s.moveSpeed) > 0 ? s.moveSpeed : null;
  return s[key] ?? 0;
}
function statText(key, v) {
  if (v == null) return '—';
  if (key === 'interval') return `${Math.round(v * 10) / 10}s`;
  if (key === 'moveSpeed') return String(Math.round(v * 100) / 100);
  return fmtNum(v);
}

function CodexDetail({ e, m }) {
  const s = e.stats || {};
  const factions = data.get('factions')?.types || {};
  const types = (Array.isArray(e.acTypes) ? e.acTypes : e.acType ? [e.acType] : []).filter((k) => factions[k]);
  const imm = Object.entries(s.immunities || {}).filter(([, v]) => v).map(([k]) => ({ stun: t('晕眩'), silence: t('沉默'), sleep: t('沉睡'), frozen: t('冻结'), levitate: t('浮空') }[k] || k));
  const abil = abilityRows(e.abilities, false);
  const dmg = (Array.isArray(s.dmgTypes) && s.dmgTypes.length ? s.dmgTypes : [s.dmgType]).filter((k) => DMG[k]).map((k) => t(DMG[k]));
  return html`<div class="sw-cd" key=${e.key}>
    <div class="sw-cd__head">
      <span class="sw-cd__cat">${t(RANK[e.rank] || RANK.NORMAL)}${s.motion === 'FLY' ? ` · ${t('空中')}` : ''}</span>
      <h3 class="sw-cd__name">${e.handbookIndex ? html`<span class="sw-cd__no">${e.handbookIndex}</span>` : null}${e.name}</h3>
      <span class="sw-cd__way">${t(APPLY[e.applyWay] || APPLY.MELEE)}${dmg.length ? ` ${dmg.join(' / ')}` : ''}</span>
      <span class="sw-cd__lp" title=${t('漏过时扣除的目标生命值')}><${Icon} name="rook" /><b class="num">${s.lpr ?? 1}</b></span>
      ${types[0] ? html`<span class="sw-cd__mark" aria-hidden="true"><${Img} src=${factionIconUrl(m, factions[types[0]].icon)} /></span>` : null}
    </div>
    <div class="sw-cd__main">
      <div class="sw-cd__art">
        <span class="sw-cd__img"><${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-cd__mass" title=${t('重量等级：越重越难被推动或拉动')}>${t('重量')}<b class="num">${s.massLevel ?? 0}</b></span>
      </div>
      <div class="sw-cd__stats">${STAT_ROWS.map(([k, label, icon]) => {
        const v = statValue(e, k);
        return html`<span key=${k} class="sw-stat">
          <span class="sw-stat__k"><${GIcon} name=${icon} />${t(label)}</span>
          <small class="sw-stat__v num">${statText(k, v)}</small>
          <b class=${cx('sw-stat__g', `g-${enemyGrade(k, v).replace('+', 'p').replace('—', 'none')}`)}>${enemyGrade(k, v)}</b>
        </span>`;
      })}</div>
    </div>
    ${e.descRaw || e.desc ? html`<${RichText} as="p" text=${e.descRaw || e.desc} class="sw-cd__desc" />` : null}
    ${types.length ? html`<p class="sw-cd__types">${types.map((k) => html`<span key=${k} class="sw-chip"><${Img} src=${factionIconUrl(m, factions[k].icon)} />${factions[k].name}</span>`)}</p>` : null}
    <h4 class="sw-cd__h">${t('能力')}</h4>
    <ul class="sw-cd__abil">
      ${abil.length ? abil.map((a, i) => html`<li key=${i}><${RichText} text=${a.text} /></li>`) : html`<li class="t-dim">${t('无特殊能力')}</li>`}
      ${imm.length ? html`<li>${t('免疫：{list}', { list: imm.join('、') })}</li>` : null}
    </ul>
  </div>`;
}

const RANK_TABS = [['all', N_('全部')], ['NORMAL', N_('普通')], ['ELITE', N_('精英')], ['BOSS', N_('领袖')]];

/** The enemy codex over the report: a list at the left, the detail at the right. */
function EnemyCodex({ open, m, onClose }) {
  const [rank, setRank] = useState('all');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(open.keys);
  const [sel, setSel] = useState(open.key);
  const all = useMemo(() => codexEnemies(data.list('enemies') || []), [data.get('enemies')]);
  const pool = scope ? scope.map((k) => data.lookup('enemies', k)).filter(Boolean) : all;
  const needle = q.trim().toLowerCase();
  const list = pool.filter((e) => (rank === 'all' || e.rank === rank)
    && (!needle || String(e.name || '').toLowerCase().includes(needle) || String(e.handbookIndex || '').toLowerCase().includes(needle)));
  const cur = list.find((e) => e.key === sel) || list[0] || null;
  const counts = Object.fromEntries(RANK_TABS.map(([k]) => [k, pool.filter((e) => k === 'all' || e.rank === k).length]));
  return html`<${Modal} open=${true} onClose=${onClose} class="sw-codex" veilClass="sw-veil" closeOnBackdrop=${false}>
    <div class="sw-codex__top">
      <button type="button" class="sw-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回 (Esc)')}><${Icon} name="chevronLeft" /></button>
      <span class="sw-codex__title">${t('敌方图鉴')}</span>
      ${scope ? html`<button type="button" class="sw-scope" onClick=${() => setScope(null)} title=${t('显示全部敌人')}>${open.title || t('筛选')}<${Icon} name="close" /></button>` : null}
      <label class="sw-search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('名称或编号')} onInput=${(ev) => setQ(ev.currentTarget.value)} /></label>
    </div>
    <div class="sw-codex__body">
      <div class="sw-codex__list">
        ${list.length ? list.map((e) => html`<${EnemyThumb} key=${e.key} e=${e} m=${m} size="md" on=${cur?.key === e.key} onClick=${() => setSel(e.key)} />`)
          : html`<p class="sw-codex__empty">${t('没有符合条件的敌人')}</p>`}
      </div>
      <div class="sw-codex__side">
        <div class="sw-ranks" role="tablist">
          <span class="sw-ranks__n num" title=${t('当前列表')}>${list.length}</span>
          ${RANK_TABS.map(([k, label]) => html`<button key=${k} type="button" role="tab" aria-selected=${rank === k ? 'true' : 'false'} class=${cx(rank === k && 'is-on')}
            disabled=${k !== 'all' && !counts[k]} onClick=${() => setRank(k)}>${t(label)}</button>`)}
        </div>
        ${cur ? html`<${CodexDetail} e=${cur} m=${m} />` : null}
      </div>
    </div>
  <//>`;
}

// ---- the screen --------------------------------------------------------------------------------------------------------

/** First page of 玩法说明's 进阶图鉴 chapter (0 when the pages are not listed). */
function handbookPage() {
  const i = guidePages().findIndex((p) => p.key === 'autochess_handbook_1');
  return i < 0 ? 0 : i;
}

/**
 * The report overlay.
 * `extension`（业主 2026-10-30：「炸惊的 sweep 里没显示对应特色策略」）：这份报告属于哪个玩法包 ——
 * 二級页（extensionThemeHall.js）把 `mode.id` 交进来，于是 策略报告 带上该玩法包的专属策略（炸惊的
 * band_zj_fuuka / band_zj_si），盟约报告带上它的专属盟约（炸惊 5 条 zjOnly / 湮灭 2 条 annOnly）。
 * 大厅里打开时是 null = 官方子集，与改动前逐字节相同。
 * `variant`（业主 2026-10-31）：'official' | 'overlimit'，默认 official —— 超限是官方模式上的难度标记，不是玩法包，
 * 所以不走 `extension`。它只是**开场视图**：打开后头部那组「原版 / 超限」随时可切，只换视图、不动数据。
 * 超限房打开时（大厅判出 `solo_infinite` / 当前难度就是超限）由大厅传 'overlimit'，并因此显示“当前对局使用超限数值”。
 * @param {{ onClose: () => void, extension?: string|null, variant?: 'official'|'overlimit' }} props
 */
export function SweepReport({ onClose, extension = null, variant = DEFAULT_SWEEP_VARIANT }) {
  const filesReady = useData('bonds', 'bands', 'bosses', 'factions', 'enemies', 'chess', 'assets');
  useData('local');
  // 超限词条表（默认版本专属；缺失时词条那一页是空的，所以不进 ready 这道门）；负面词条是它的第二段
  useData('relicsOverlimit');
  useData('relicsOverlimitNegative');
  const version = useStore(shownVersion);
  const content = useStore((s) => s, Object.is, contentSet);
  // useData can already be ready for the PREVIOUS version: content.js keeps that set until the new one checks.
  // Subscribe to the requested version's progress too, and never present the previous set as its report.
  const failed = content.kind === 'version' && content.version === version && content.status === 'failed';
  const ready = filesReady && pageVersion() === version
    && (version === DEFAULT_VERSION || (content.version === version && content.status === 'ready'));
  const m = data.get('assets');
  const modeId = typeof extension === 'string' && extension ? extension : null;
  const notOwned = useStore((s) => s.notOwned, Object.is, loadoutStore);
  const [tab, setTabState] = useState(() => { const v = loadPref(TAB_PREF, 'bonds'); return TABS.some((x) => x.id === v) ? v : 'bonds'; });
  const setTab = (v) => { setTabState(v); savePref(TAB_PREF, v); };
  const [bondSel, setBondSel] = useState(null);
  const [bandSel, setBandSel] = useState(null);
  const [enemySel, setEnemySel] = useState(null);
  const [relicSel, setRelicSel] = useState(null);
  const [codex, setCodex] = useState(null);
  // 原版 / 超限: the prop is the INITIAL view (a lobby / theme hall hands in where the report was opened from); the header's
  // segmented switch then owns it. Uncontrolled on purpose — the report remembers nothing but its tab, and every open
  // mounts a fresh component, so the entry context is applied again each time.
  const [view, setView] = useState(() => (SWEEP_VARIANTS.includes(variant) ? variant : DEFAULT_SWEEP_VARIANT));
  // the report was opened FROM an overlimit room: the banner says so; switching the pill does not change that fact
  const live = (SWEEP_VARIANTS.includes(variant) ? variant : DEFAULT_SWEEP_VARIANT) === 'overlimit';

  // defaults once the data is there: the first tile of each tab
  const bonds = ready ? officialBonds(data.list('bonds'), modeId).filter((b) => b && b.bondId).sort((a, b) => (a.identifier ?? 99) - (b.identifier ?? 99)) : [];
  // 超限视图的横幅说事实：这份报告（当前赛季 / 玩法包）里带 `inf` 覆盖块 = 已配置强化的盟约条数
  const configuredBonds = ready ? overlimitConfiguredCount(bonds) : null;
  const bands = ready ? officialBands(data.list('bands'), modeId).filter((b) => b && b.bandId).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99)) : [];
  const bond = data.lookup('bonds', bondSel) || bonds[0] || null;
  const band = data.lookup('bands', bandSel) || bands[0] || null;
  const firstBoss = ready ? bossList()[0] : null;
  const eSel = enemySel || (firstBoss ? { kind: 'boss', id: firstBoss.bossId } : null);

  let left = null;
  let right;
  // 词条那一页只在超限视图里存在：切回「原版」时，记住的 'relics' 回落成盟约报告（不凭空显示超限专属内容）
  const tabs = view === 'overlimit' ? [...TABS, RELIC_TAB] : TABS;
  const shownTab = tab === RELIC_TAB.id && view !== 'overlimit' ? 'bonds' : tab;
  if (failed) {
    right = html`<div class="sw-loading" role="alert"><p>${t('版本数据校验失败')}</p>
      <${Button} onClick=${retryContentSet}>${t('重试')}<//></div>`;
  } else if (!ready) {
    right = html`<p class="sw-loading">${t('正在读取报告…')}</p>`;
  } else if (shownTab === 'bonds') {
    left = bond ? html`<${BondPanel} key=${bond.bondId} bond=${bond} m=${m} notOwned=${notOwned} variant=${view} />` : null;
    right = html`<${BondsTab} m=${m} modeId=${modeId} variant=${view} sel=${bond?.bondId} onSel=${setBondSel} />`;
  } else if (shownTab === 'bands') {
    left = band ? html`<${BandPanel} key=${band.bandId} band=${band} m=${m} />` : null;
    right = html`<${BandsTab} m=${m} modeId=${modeId} sel=${band?.bandId} onSel=${setBandSel} />`;
  } else if (shownTab === 'relics') {
    // 两段共用同一个选中态：id 各自唯一（LC-001… / LC-D01…），所以先查饰品表、再查负面表，选中的是哪段就画哪段
    const relics = [...relicEntriesOf(), ...negativeEntriesOf()];
    const relic = relics.find((e) => e.id === relicSel) || relics[0] || null;
    left = relic ? html`<${RelicPanel} key=${relic.id} relic=${relic} />` : null;
    right = html`<${RelicsTab} sel=${relic?.id || null} onSel=${setRelicSel} />`;
  } else {
    left = eSel ? html`<${EnemyPanel} key=${`${eSel.kind}:${eSel.id}`} sel=${eSel} m=${m} onCodex=${setCodex} />` : null;
    right = html`<${EnemiesTab} m=${m} sel=${eSel || {}} onSel=${setEnemySel} onCodex=${setCodex} />`;
  }

  // the codex is the report's sibling, not its child: the report's body lifts its children over the backdrop
  // (position: relative), which would pull a nested Modal out of its fixed layer
  return html`<${Modal} open=${true} onClose=${onClose} class="sw" veilClass="sw-veil" closeOnBackdrop=${false}>
    <div class="sw__bg" aria-hidden="true"><i class="sw__mist"></i><i class="sw__lines"></i></div>
    <header class="sw-top">
      <div class="sw-top__left">
        <button type="button" class="sw-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回 (Esc)')}>
          <${Icon} name="chevronLeft" /><span class="sw-back__mark">S.W.E.E.P.</span>
        </button>
        <button type="button" class="sw-info" onClick=${() => openGuide(handbookPage())} aria-label=${t('进阶图鉴')} title=${t('进阶图鉴：敌人类型、盟约、策略与轮选')}><${Icon} name="info" /></button>
        <${VariantSwitch} value=${view} onChange=${setView} />
      </div>
      <nav class="sw-tabs" role="tablist" aria-label=${t('S.W.E.E.P.报告')}>
        ${tabs.map((x) => html`<button key=${x.id} type="button" role="tab" aria-selected=${shownTab === x.id ? 'true' : 'false'} class=${cx('sw-tab', shownTab === x.id && 'is-on')}
          onClick=${() => setTab(x.id)}><span class="sw-tab__icon">${x.icon()}</span><span>${t(x.name)}</span></button>`)}
      </nav>
    </header>
    ${view === 'overlimit' ? html`<${OverlimitBanner} live=${live} configured=${configuredBonds} />` : null}
    <main class="sw-body" data-tab=${shownTab} data-variant=${view}>
      <aside class="sw-left">${left}</aside>
      <div class="sw-right">${right}</div>
    </main>
  <//>
  ${codex ? html`<${EnemyCodex} key=${`${codex.title}|${codex.key}`} open=${codex} m=${m} onClose=${() => setCodex(null)} />` : null}`;
}
