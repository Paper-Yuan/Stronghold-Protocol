// docs/mockups/render-mod-equipment-ui.mjs — 「装备总览（装备图鉴）」装内容包之后的改进版 UI 图
//
// 与 render-fusion-dual-platform.mjs 同一路数：本分支里这个界面**还不存在**（`public/js/screens/equipment.js`
// 与 `public/css/screens/equipment.css` 全仓 0 命中，见 docs/MOD_UI_ADAPTATION_PLAN.md §3.2），所以按「参考图」
// 的做法重建版面——**样式表、类名、字体、尺寸全部取自仓库源码**，唯一不是真的东西是「这段代码还没写」：
//
//   风格基线  public/css/{theme,components,devices}.css + public/css/screens/{loadout,game-panels}.css（本分支）
//            + [mod] payload/public/css/screens/equipment.css（提案自己的 `.eq-*` 块，65 行，原样载入）
//            + public/fonts/fonts.css（Bender / Novecento Wide + Noto Sans SC）
//   版面结构  [mod] payload/public/js/screens/equipment.js 的 .lo / .lo-top / .lo-note / .lo-body / .lo-filters /
//            .lo-grid / .eq-tier / .lo-card / .eq-detail（EqFilters / EqCard / EqDetail / EqEffect）
//   数据      public/data/{items,bonds,assets}.json（官方）
//            + [mod] payload/packs/fanpack/records.json（包内 5 件装备 / 2 条盟约 / 包美术清单）
//            + [mod] payload/data/items.json 的 20 条修正（tier / giveBondId / giveBondBiasOnly，见方案 §3.3）
//
// 尺寸不手写：根字号 = clamp(24px, min(100vw/19.2, 100svh/10.8), 240px)，Web 1920×1080 → 1rem = 100px，
// 安卓横屏 844×390 → 1rem ≈ 36.1px（实测值由自检打印）。`<html>` 端类照 ui/device.js 打：
// Web = `sp-hover sp-fs`，安卓 = `sp-touch sp-coarse sp-no-hover`。两趟各出一张 1:1 的整屏图。
//
// 图上的 ①②③④ 圆标 = 这一处靠哪个**端口**（端口名与 docs/MOD_UI_ADAPTATION_PLAN.md §5 的表一致）适配。
//
// 用法：node docs/mockups/render-mod-equipment-ui.mjs   （Windows 自动探测 Chrome；或设 CHROME_PATH）
//      包目录默认取 <repo>/../mod-inspect/fanpack-mod，可用 FANPACK_DIR 覆盖。
// 产物：docs/mockups/mod-ui-equipment-web.png   1920×1080
//       docs/mockups/mod-ui-equipment-phone.png  844×390
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng } from '../../tools/crop-board-atlas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUB = path.join(ROOT, 'public');
const furl = (p) => pathToFileURL(p).href;

if (!process.env.CHROME_PATH) {
  const hit = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;
const puppeteer = (await import('puppeteer-core')).default;
if (!CHROME || !existsSync(CHROME)) {
  console.error('未找到 Chrome：请设置 CHROME_PATH 环境变量');
  process.exit(1);
}

// ---- 内容包（真实 fanpack）--------------------------------------------------------------------------

const PACK_DIR = (process.env.FANPACK_DIR
  ? [process.env.FANPACK_DIR]
  : [path.resolve(ROOT, '../mod-inspect/fanpack-mod'), 'E:/Workbox/mod-inspect/fanpack-mod'])
  .find((p) => existsSync(path.join(p, 'payload/packs/fanpack/records.json')));
if (!PACK_DIR) {
  console.error('未找到 fanpack：设 FANPACK_DIR 指向 mod-inspect/fanpack-mod');
  process.exit(1);
}
const PACKS_DIR = path.join(PACK_DIR, 'payload/packs/fanpack');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const OFFICIAL_ITEMS = readJson(path.join(PUB, 'data/items.json'));
const OFFICIAL_BONDS = readJson(path.join(PUB, 'data/bonds.json'));
const OFFICIAL_ASSETS = readJson(path.join(PUB, 'data/assets.json'));
const MOD_ITEMS = readJson(path.join(PACK_DIR, 'payload/data/items.json'));
const RECORDS = readJson(path.join(PACKS_DIR, 'records.json'));
const ART_INDEX = readJson(path.join(PACKS_DIR, 'art/index.json'));

// ---- 合并（就是 shared/customContent.js + server customOverlay 要做的事，见方案 §5「数据段合并口」） ----

const ITEMS = {};
const corrections = [];
for (const [id, rec] of Object.entries(OFFICIAL_ITEMS)) {
  const mod = MOD_ITEMS[id];
  if (mod) {
    const patch = {};
    if (mod.tier !== rec.tier) patch.tier = mod.tier;
    if ((mod.giveBondId || null) !== (rec.giveBondId || null)) patch.giveBondId = mod.giveBondId || null;
    if (!!mod.giveBondBiasOnly !== !!rec.giveBondBiasOnly) patch.giveBondBiasOnly = !!mod.giveBondBiasOnly;
    if (Object.keys(patch).length) { corrections.push({ id, ...patch }); Object.assign(rec, patch); }
  }
  ITEMS[id] = rec;
}
const PACK_ITEM_IDS = Object.keys(RECORDS.items);
for (const [id, rec] of Object.entries(RECORDS.items)) ITEMS[id] = rec;

const BONDS = { ...OFFICIAL_BONDS, ...RECORDS.bonds };
const ASSETS = {
  ...OFFICIAL_ASSETS,
  items: { ...OFFICIAL_ASSETS.items, ...RECORDS.assets.items },
  bonds: { ...OFFICIAL_ASSETS.bonds, ...RECORDS.assets.bonds },
};

// ---- 美术取数（assetUrls.js:100 bondIconUrl / :110 itemIconUrl 的等价物 + 缺图回落） ------------------

const unresolved = [];
function assetFile(url) {
  if (!url) return null;
  const name = String(url).replace(/^\/+/, '');
  let f = null;
  if (name.startsWith('assets/pack/')) {
    const rel = ART_INDEX[name.slice('assets/pack/'.length).replace(/\.png$/, '')];
    f = rel ? path.join(PACKS_DIR, rel) : null;
  } else {
    f = path.join(PUB, name);
  }
  if (!f || !existsSync(f)) { unresolved.push(name); return null; }
  return f;
}
const assetUrl = (url) => { const f = assetFile(url); return f ? furl(f) : null; };
const itemIcon = (it) => assetUrl(ASSETS.items?.[it.iconId] || ASSETS.items?.[it.trapId]);
const bondIcon = (id) => assetUrl(ASSETS.bonds?.[id]);

// ---- 纯函数模型（照 equipment.js:46-112 抄，只把 TIERS 从写死改成数据派生） --------------------------

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];   // equipment.js:23，>6 时回落数字（方案 §5「阶/层号口」）
const cmpItems = (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0)
  || String(a.name).localeCompare(String(b.name), 'zh');
const codexRows = (list, lookup) => (Array.isArray(list) ? list : []).filter((i) => i && !i.isGolden)
  .sort(cmpItems).map((base) => ({ base, golden: (base.goldenId ? lookup(base.goldenId) : null) || null }));
const usedBonds = (rows, bonds) => {
  const used = new Set(rows.map((r) => r?.base?.giveBondId).filter(Boolean));
  return bonds.filter((b) => b && used.has(b.bondId));
};
const groupByTier = (rows) => {
  const by = new Map();
  for (const row of rows) { const t = row?.base?.tier ?? 0; if (!by.has(t)) by.set(t, []); by.get(t).push(row); }
  return [...by.keys()].sort((a, b) => a - b).map((tier) => ({ tier, rows: by.get(tier) }));
};

const ROWS = codexRows(Object.values(ITEMS), (id) => ITEMS[id]);
const BOND_LIST = usedBonds(ROWS, Object.values(BONDS).filter((b) => b && b.bondId));
const BY_BOND = new Map(BOND_LIST.map((b) => [b.bondId, b]));
/** 数据派生的品阶集合（equipment.js:24 的 TIERS=[1..6] 被替换成这一行）。 */
const TIERS = [...new Set(ROWS.map((r) => r.base.tier).filter((t) => t != null))].sort((a, b) => a - b);
const GROUPS = groupByTier(ROWS);

// 图上选中的：包内 提卡兹之根（tier 6 / 卡兹戴尔 / biasOnly）——一次把「包件、包美术、包盟约、仅归类」都摆出来
const SEL_ID = 'chess_item_c_02_e_a';
const SEL = ROWS.find((r) => r.base.id === SEL_ID) || ROWS[ROWS.length - 1];
const SEL_BOND = BY_BOND.get(SEL.base.giveBondId) || null;
const PACK_ROWS = ROWS.filter((r) => PACK_ITEM_IDS.includes(r.base.id));

// ---- 小工具 -----------------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// RichText 的替身：照 ui/richText.js 的 STYLE_CLASS 映射，输出游戏自己的 .rt-* 类（game-panels.css:8-15）
const RT_STYLE = {
  'ba.vup': 'rt-vup', 'ba.vdown': 'rt-vdown', 'ba.rem': 'rt-rem', 'ba.acrem': 'rt-note', 'ba.kw': 'rt-kw',
  'ba.talpu': 'rt-vup', 'autochess.gray': 'rt-note', 'autochess.dgreen': 'rt-mint', 'autochess.green': 'rt-mint',
  'autochess.red': 'rt-vdown', 'autochess.yellow': 'rt-rem', 'eb.key': 'rt-kw', 'eb.danger': 'rt-vdown',
};
const TAG_OPEN = /^<([@$])([A-Za-z0-9_.\-]{1,48})>/;
function rich(src) {
  if (src == null) return '';
  const s = String(src).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  const stack = []; let out = ''; let buf = '';
  const flush = () => {
    if (!buf) return;
    const cls = [...new Set(stack.map((t) => (t.term ? 'rt-term' : (RT_STYLE[t.cls] || 'rt-hl'))))];
    out += cls.length ? `<span class="${cls.join(' ')}">${esc(buf)}</span>` : esc(buf);
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') { flush(); out += '<br>'; i += 1; continue; }
    if (ch === '<') {
      if (s.startsWith('</>', i)) { if (stack.length) { flush(); stack.pop(); } else buf += '</>'; i += 3; continue; }
      const m = TAG_OPEN.exec(s.slice(i, i + 52));
      if (m) { flush(); stack.push({ cls: m[2], term: m[1] === '$' }); i += m[0].length; continue; }
    }
    buf += ch; i += 1;
  }
  flush(); return out;
}

const ICONS = {
  check: { d: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z' },
  crown: { d: 'M3 7l4.6 4.2L12 4l4.4 7.2L21 7l-1.8 10H4.8zM5 19h14v2H5z' },
  search: { d: 'M10 3a7 7 0 0 1 5.6 11.2l5.6 5.6-1.4 1.4-5.6-5.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', eo: true },
  chevronLeft: { d: 'M15.4 5l1.4 1.4-5.6 5.6 5.6 5.6-1.4 1.4-7-7z' },
  book: { d: 'M2 4h7.5A3.5 3.5 0 0 1 12 5.1 3.5 3.5 0 0 1 14.5 4H22v16h-7.5a1.5 1.5 0 0 0-1.5 1.5h-2A1.5 1.5 0 0 0 9.5 20H2zm2 2v12h5.5c.5 0 1 .1 1.5.3V7.5A1.5 1.5 0 0 0 9.5 6zm10.5 0A1.5 1.5 0 0 0 13 7.5v10.8c.5-.2 1-.3 1.5-.3H20V6z', eo: true },
  info: { d: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-3v2h2V7z', eo: true },
  warn: { d: 'M12 2 1 21h22zm-1 7v6h2V9zm0 7.5v2h2v-2z', eo: true },
};
const svgIcon = (name, cls = '') => {
  const ic = ICONS[name];
  return `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ic.d}"${ic.eo ? ' fill-rule="evenodd"' : ''}/></svg>`;
};

// ---- 屏内标记（真实类名，取自 [mod] equipment.js / equipment.css） ------------------------------------

/** 盟约标签：与干员调配卡的 .lo-bond 同源；缺图标回落 crown（equipment.js:131 的 Img fallback）。 */
function bondTag(bond, { large = false, short = false } = {}) {
  if (!bond) return `<span class="eq-bond is-none">${short ? '—' : '无盟约'}</span>`;
  const ic = bondIcon(bond.bondId);
  return `<span class="eq-bond${large ? ' eq-bond--lg' : ''}">`
    + (ic ? `<img class="eq-bond__icon" src="${esc(ic)}" alt="">` : svgIcon('crown', 'eq-bond__icon'))
    + `<span>${esc(bond.name)}</span></span>`;
}
/** 「仅归类」徽标：giveBondBiasOnly 的件归入盟约筛选/标签，但不当作盟约成员（方案 §5「giveBondBiasOnly 口」）。 */
const biasBadge = (small) => `<span class="lo-badge lo-badge--plain eq-bias">${small ? '仅归类' : '仅归类 · 非盟约成员'}</span>`;

function itemArt(it, cls) {
  const ic = itemIcon(it);
  return ic
    ? `<span class="${cls}"><img src="${esc(ic)}" alt="${esc(it.name)}"></span>`
    : `<span class="${cls}"><span class="lo-card__glyph">${svgIcon('book')}</span></span>`;
}

/** 一件装备的卡（equipment.js:138-147 的 EqCard；官方件与包内件走的是同一个函数）。 */
function eqCard(row) {
  const { base } = row;
  const t = base.tier;
  const bond = BY_BOND.get(base.giveBondId) || null;
  return `<button type="button" class="lo-card lo-card--t${t} eq-card${base.id === SEL.base.id ? ' is-sel' : ''}"`
    + ` data-item="${esc(base.id)}" data-pack="${PACK_ITEM_IDS.includes(base.id) ? '1' : '0'}"`
    + ` aria-pressed="${base.id === SEL.base.id ? 'true' : 'false'}">`
    + `<span class="lo-card__art">`
    + (itemIcon(base) ? `<img src="${esc(itemIcon(base))}" alt="${esc(base.name)}">` : `<span class="lo-card__glyph">${svgIcon('book')}</span>`)
    + `<span class="lo-chip lo-chip--tier lo-chip--t${t} lo-card__tier"><span class="num">${ROMAN[t] || t}</span></span>`
    + '</span>'
    + `<span class="lo-card__name">${esc(base.name)}</span>`
    + `<span class="lo-card__kit eq-card__meta">${bondTag(bond, { short: true })}`
    + (base.giveBondBiasOnly ? biasBadge(true) : '') + '</span></button>';
}

/** 普通 / 精锐 效果块（equipment.js:117-125 的 EqEffect）。 */
function eqEffect(k, micro, text, elite) {
  return `<section class="eq-eff${elite ? ' is-elite' : ''}" aria-label="${k}">`
    + `<div class="eq-eff__head"><span class="eq-eff__k">${k}</span><span class="eq-eff__micro">${micro}</span></div>`
    + `<p class="eq-eff__text">${text ? rich(text) : '<span class="t-dim">—</span>'}</p></section>`;
}

/** 右栏详情（equipment.js:150-178 的 EqDetail）。 */
function eqDetail(row) {
  const { base, golden } = row;
  const t = base.tier;
  const bond = BY_BOND.get(base.giveBondId) || null;
  const tags = [
    `<span class="lo-chip lo-chip--tier lo-chip--t${t} eq-tierchip"><span class="num">${ROMAN[t] || t}</span>阶</span>`,
    base.price != null && base.price !== '' ? `<span class="eq-meta">售价 <b class="num">${base.price}</b></span>` : '',
    base.mergeable && base.upgradeNum ? `<span class="eq-meta">合成 ×<b class="num">${base.upgradeNum}</b> 升为精锐</span>` : '',
    base.hideInShop || base.shopExcluded ? `<span class="eq-meta is-warn">${svgIcon('warn')}商店不可售</span>` : '',
  ].filter(Boolean).join('');
  return '<div class="eq-detail">'
    + '<header class="eq-detail__head">'
    + itemArt(base, 'eq-detail__art')
    + '<div class="eq-detail__id">'
    + `<span class="micro micro--mint">EQUIPMENT // ${ROMAN[t] || t}</span>`
    + `<h2 class="eq-detail__name">${esc(base.name)}</h2>`
    + `<div class="eq-detail__tags">${tags}</div>`
    + `<div class="eq-detail__bond"><span class="eq-detail__k">盟约</span>${bondTag(bond, { large: true })}`
    + (base.giveBondBiasOnly ? biasBadge(false) : '') + '</div>'
    + '</div></header>'
    + eqEffect('普通', 'NORMAL', base.descRaw || base.desc, false)
    + (golden
      ? eqEffect('精锐', 'ELITE', golden.descRaw || golden.desc, true)
      : '<section class="eq-eff is-elite is-none" aria-label="精锐"><div class="eq-eff__head">'
        + '<span class="eq-eff__k">精锐</span><span class="eq-eff__micro">ELITE</span></div>'
        + '<p class="eq-eff__text t-dim">这件装备没有精锐（进阶）版本</p></section>')
    + '</div>';
}

/** 筛选条：阶级 chip / 搜索 / 盟约 chip（候选项由 giveBondId 反推）/ 仅看商店可售。 */
function eqFilters(bondUI) {
  const tierChips = [`<button type="button" class="lo-chip is-on">全部</button>`]
    .concat(TIERS.map((n) => `<button type="button" class="lo-chip lo-chip--tier lo-chip--t${n}" title="${n}阶">`
      + `<span class="num">${ROMAN[n] || n}</span></button>`)).join('');
  const bondChips = [`<button type="button" class="lo-chip is-on">全部盟约</button>`,
    `<button type="button" class="lo-chip">无盟约</button>`]
    .concat(BOND_LIST.map((b) => `<button type="button" class="lo-chip eq-bondchip" data-bond="${esc(b.bondId)}">`
      + (bondIcon(b.bondId) ? `<img class="lo-chip__icon" src="${esc(bondIcon(b.bondId))}" alt="">` : svgIcon('crown', 'lo-chip__icon'))
      + `<span class="lo-chip__lbl">${esc(b.name)}</span></button>`)).join('');
  const bondSelect = `<label class="lo-select eq-bondselect"><span class="lo-select__k">盟约</span>`
    + '<select aria-label="按盟约筛选"><option>全部盟约</option><option>无盟约</option>'
    + BOND_LIST.map((b) => `<option>${esc(b.name)}</option>`).join('') + '</select></label>';
  return '<div class="lo-filters eq-filters">'
    + '<div class="lo-frow">'
    + `<div class="lo-chips" role="group" aria-label="阶级">${tierChips}</div>`
    + '<label class="field field--sm lo-search"><span class="field__box brackets">'
    + svgIcon('search', 'field__icon')
    + '<input class="field__input" placeholder="' + (bondUI === 'select' ? '搜索装备 / 盟约' : '搜索装备 / 效果 / 盟约') + '" readonly>'
    + '</span></label></div>'
    + `<div class="lo-frow eq-bondrow">${bondUI === 'select' ? bondSelect : `<div class="lo-chips" role="group" aria-label="盟约">${bondChips}</div>`}</div>`
    + '<div class="lo-frow">'
    + '<button type="button" class="lo-toggle" aria-pressed="false"><i class="lo-toggle__box">'
    + svgIcon('check') + '</i>仅看商店可售</button>'
    + (bondUI === 'chips'
      ? `<span class="micro eq-derived">盟约候选 ${BOND_LIST.length} · 由 giveBondId 反推</span>`
        + `<span class="micro eq-derived">阶级 ${TIERS.map((t) => ROMAN[t] || t).join('/')} · 由数据派生</span>`
      : '')
    + '</div></div>';
}

/** 整屏（equipment.js:254-287 的 EquipScreen，去掉 Preact 外壳）。 */
function screen(bondUI) {
  const grid = GROUPS.map((g) => `<div class="eq-tier" role="presentation" data-tier="${g.tier}">`
    + `<span class="eq-tier__k"><span class="num">${ROMAN[g.tier] || g.tier}</span>阶</span>`
    + `<span class="eq-tier__n num">${g.rows.length} 件</span></div>`
    + g.rows.map(eqCard).join('')).join('');
  return '<div class="lo eq" role="dialog" aria-modal="true" aria-label="装备总览">'
    + '<div class="lo__bg" aria-hidden="true"></div>'
    + '<header class="lo-top">'
    + '<div class="lo-top__left"><button type="button" class="btn btn--ghost btn--md lo-back">'
    + svgIcon('chevronLeft') + '<span class="btn__label">返回</span></button></div>'
    + '<div class="lo-top__center"><span class="micro micro--mint">EQUIPMENT CODEX</span>'
    + `<h1 class="lo-top__title">${svgIcon('book', 'lo-top__icon')}装备总览</h1></div>`
    + '<div class="lo-top__right"><span class="lo-count">已收录 <b class="num">' + ROWS.length + '</b>'
    + `<span class="num t-dim">/${ROWS.length}</span></span></div>`
    + '</header>'
    + `<p class="lo-note">${svgIcon('info')}这里的「普通」是商店原价买到的效果，「精锐」是进阶（合成）后的效果；`
    + '盟约标签表示这件装备所属的大盟约。官方件与内容包件走同一条列表、同一张卡。</p>'
    + '<main class="lo-body">'
    + `<section class="lo-roster eq-list">${eqFilters(bondUI)}`
    + `<div class="lo-grid" role="listbox" aria-label="装备列表" id="eq-grid">${grid}</div></section>`
    + `<div class="lo-detail-wrap">${eqDetail(SEL)}</div>`
    + '</main></div>';
}

// ---- 真实样式表 -------------------------------------------------------------------------------------

const readCss = (...p) => readFileSync(path.join(...p), 'utf8');
const cssParts = [
  readCss(PUB, 'css/theme.css'),
  readCss(PUB, 'css/components.css'),
  readCss(PUB, 'css/devices.css'),
  readCss(PUB, 'css/screens/loadout.css'),      // .lo-* 骨架（方案 §5「样式骨架口」）
  readCss(PUB, 'css/screens/game-panels.css'),  // RichText 的 .rt-* 类
  readCss(PACK_DIR, 'payload/public/css/screens/equipment.css'), // 提案自己的 .eq-* 块（原样载入）
];
const EQUIP_CSS = cssParts[cssParts.length - 1];
const FONTS_CSS = readCss(PUB, 'fonts/fonts.css').replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);

// 图自己的两件事（不含任何配色/间距的再设计）：① 端类与动画复位；② 图例与圆标这一层注记；
// ③ `.lo-grid` 的底部留白，好让最后一行不被图例条压住（注记需要的净空，不改游戏版面本身）。
const FIG_CSS = `
html, body { height: 100%; overflow: hidden; }
.lo { animation: none; }
.lo-grid { padding-bottom: calc(.2rem + var(--fig-clear, 0px)); }
#fig-legend {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 120;
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 18px; padding: var(--lg-pad, 9px 16px 10px);
  background: rgba(8, 10, 9, .94); border-top: 1px solid var(--line-2);
  font-family: var(--font-cjk); font-size: var(--lg-fs, 12px); line-height: 1.45; color: var(--text-md);
}
#fig-legend .lg { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; }
#fig-legend .lg > b {
  display: grid; place-items: center; width: 18px; height: 18px; margin-top: 1px;
  font-family: var(--font-num); font-size: 11px; font-weight: 700; color: #06110d; background: var(--mint-500);
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%);
}
#fig-legend .lg--p2 > b { background: var(--gold); color: #1a1400; }
#fig-legend .lg--p3 > b { background: var(--ice); color: #06202f; }
#fig-legend .lg--p4 > b { background: var(--amber); color: #1a1400; }
#fig-legend .lg__k { color: var(--text-hi); font-weight: 700; }
#fig-legend .lg__v { color: var(--text-lo); }
#fig-legend code { font-family: var(--font-mono); font-size: .94em; color: var(--mint-400); }
#mk-layer { position: fixed; inset: 0; z-index: 130; pointer-events: none; }
.mk {
  position: absolute; width: var(--mk-s, 22px); height: var(--mk-s, 22px); display: grid; place-items: center;
  font-family: var(--font-num); font-size: calc(var(--mk-s, 22px) * .55); font-weight: 700; color: #06110d;
  transform: translate(-50%, -50%); box-shadow: 0 0 0 2px rgba(8, 10, 9, .88);
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%);
}
.mk--p1 { background: var(--mint-500); }
.mk--p2 { background: var(--gold); color: #1a1400; }
.mk--p3 { background: var(--ice); color: #06202f; }
.mk--p4 { background: var(--amber); color: #1a1400; }
`;
const REAL_CSS = [...cssParts, FONTS_CSS, FIG_CSS].join('\n');

// ---- 端口图例（端口名与 docs/MOD_UI_ADAPTATION_PLAN.md §5 的表一致） --------------------------------

const LEGEND = [
  ['p1', '阶 / 层号口', '阶级 chip 与分段由 <code>data.list(\'items\')</code> 实际出现过的 tier 生成（不再写死 <code>TIERS=[1..6]</code>）；'
    + '排序固定 tier→shopSortId→name。', '阶级 chip/分段由数据实际 tier 派生（无写死 TIERS）'],
  ['p2', '盟约枚举口', '盟约候选项由行上的 <code>giveBondId</code> 反推（<code>usedBonds</code>），'
    + '所以包内的 <b>卡兹戴尔 / 罗德岛</b> 自己长进筛选条，顺序也由数据决定。', '候选由 giveBondId 反推，包内盟约自动长进筛选'],
  ['p3', '数据段合并口 + 美术清单口', '包内 5 件与官方 59 件同一条列表、同一张卡、同一套阶色；'
    + '图标同源（<code>items[iconId||trapId]</code>），包美术由 overlay 并进 <code>assets.json</code>。', '包内件与官方件同一条列表、同一张卡'],
  ['p4', 'giveBondBiasOnly 口', '官方件带上 <code>giveBondId</code> 后归入盟约筛选与卡上标签；'
    + '<code>giveBondBiasOnly</code> 的（官方 5_09 / 6_01…6_07 / 6_11 与包内件）只标「仅归类」，不当作盟约成员。',
    '官方件带 giveBondId 后归入盟约；biasOnly 只标「仅归类」'],
];
const MK_N = { p1: '①', p2: '②', p3: '③', p4: '④' };
const legendHtml = (short) => LEGEND.map(([k, name, long, brief]) =>
  `<div class="lg lg--${k}"><b>${MK_N[k]}</b>`
  + `<div><span class="lg__k">${name}</span> <span class="lg__v">${short ? brief : long}</span></div></div>`).join('');

// ---- 页面 -------------------------------------------------------------------------------------------

const htmlFor = (p) => `<!doctype html><html lang="zh-CN" class="${p.cls}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">
<title>equipment codex</title>
<style>:root{--mk-s:${p.mk}px;--lg-fs:${p.lg}px;--lg-pad:${p.legend === 'short' ? '6px 12px 7px' : '9px 16px 10px'}}</style>
<style>${REAL_CSS}</style></head>
<body><div id="app-root">${screen(p.bondUI)}</div>
<div id="mk-layer"></div><div id="fig-legend">${legendHtml(p.legend === 'short')}</div></body></html>`;

const TMP = path.join(HERE, '.equip-tmp');
mkdirSync(TMP, { recursive: true });

const waitImages = (page) => page.evaluate(() => Promise.all(Array.from(document.images)
  .map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));

// 图上的注记：图例条先落位量高度 → 给 .lo-grid 留出净空 → 滚到最后一个阶级段 → 量圆标落点。
// 圆标落点全部由真实 DOM 的 getBoundingClientRect 推出来，不写死坐标；越界会夹回视口内。
const ANCHOR = {
  tl: (r) => [r.left, r.top], tr: (r) => [r.right, r.top],
  bl: (r) => [r.left, r.bottom], br: (r) => [r.right, r.bottom],
  lm: (r) => [r.left, r.top + r.height / 2], rm: (r) => [r.right, r.top + r.height / 2],
};
const TIER_CHIPS = '.eq-filters .lo-chips[aria-label="阶级"]';
const BOND_CHIPS = '.eq-filters .lo-chips[aria-label="盟约"]';
const BOND_SEL = '.eq-filters .eq-bondselect';
const MARKERS_WEB = [
  ['p1', '①', `${TIER_CHIPS} .lo-chip:last-child`, 'rm', 12, 0],
  ['p2', '②', `${BOND_CHIPS} .lo-chip:last-child`, 'rm', 12, 0],
  ['p3', '③', `[data-item="${SEL_ID}"]`, 'tr', -4, 6],
  ['p4', '④', '.eq-detail__bond .eq-bias', 'rm', 14, 0],
];
const MARKERS_PHONE = [
  ['p1', '①', `${TIER_CHIPS} .lo-chip:last-child`, 'rm', 10, 0],
  ['p2', '②', BOND_SEL, 'rm', 10, 0],
  ['p3', '③', `[data-item="${SEL_ID}"]`, 'tr', -4, 6],
  ['p4', '④', '.eq-detail__bond .eq-bias', 'rm', 12, 0],
];

async function decorate(page, markers) {
  return page.evaluate((markers) => {
    const ANCHOR = {
      tl: (r) => [r.left, r.top], tr: (r) => [r.right, r.top],
      bl: (r) => [r.left, r.bottom], br: (r) => [r.right, r.bottom],
      lm: (r) => [r.left, r.top + r.height / 2], rm: (r) => [r.right, r.top + r.height / 2],
    };
    const S = '.lo ';
    const grid = document.querySelector(S + '.lo-grid');
    const legend = document.getElementById('fig-legend');
    document.documentElement.style.setProperty('--fig-clear', `${Math.round(legend.getBoundingClientRect().height) + 6}px`);
    // 滚到底（最后一段是 tier VI，含包内件）；--fig-clear 保证最后一行不落进图例条
    if (grid) grid.scrollTop = grid.scrollHeight;
    // 圆标
    const layer = document.getElementById('mk-layer');
    layer.innerHTML = '';
    const placed = [];
    for (const [key, n, sel, anchor, dx, dy] of markers) {
      const el = document.querySelector(sel);
      if (!el) { placed.push({ key, n, sel, rect: null }); continue; }
      const r = el.getBoundingClientRect();
      const [ax, ay] = (ANCHOR[anchor] || ANCHOR.tl)(r);
      const x = Math.min(innerWidth - 12, Math.max(12, ax + dx));
      const y = Math.min(innerHeight - 12, Math.max(12, ay + dy));
      const s = document.createElement('span');
      s.className = `mk mk--${key}`;
      s.textContent = n;
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      layer.appendChild(s);
      const pad = 30;
      placed.push({
        key, n, sel, rect: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) },
        inside: x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad,
      });
    }
    return { placed, legendH: Math.round(legend.getBoundingClientRect().height), gridScroll: grid ? Math.round(grid.scrollTop) : null,
      htmlClass: document.documentElement.className, lgFs: getComputedStyle(legend).fontSize, lgRows: [...legend.querySelectorAll('.lg')].map((e) => Math.round(e.getBoundingClientRect().height)) };
  }, markers);
}

const AUDIT = (page) => page.evaluate(() => {
  const S = '.lo ';
  const box = (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
  const vis = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : !!e.offsetParent);
  const cards = [...document.querySelectorAll(S + '.eq-card')];
  const zero = [...document.querySelectorAll(`${S}.eq-card, ${S}.lo-chip, ${S}.eq-tier, ${S}.eq-bond, ${S}.eq-detail__art, ${S}.eq-eff`)]
    .filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && (r.width < 1 || r.height < 1); }).length;
  const clipped = [...document.querySelectorAll(`${S}.lo-card__name, ${S}.eq-detail__name, ${S}.eq-tier__k, ${S}.eq-detail__k`)]
    .filter((e) => getComputedStyle(e).textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1)
    .map((e) => (e.textContent || '').trim().slice(0, 12));
  // 卡片名是 .lo-card__name 的 ellipsis（设计如此，手机窄卡必然省略），单独计数，不当缺陷
  const ellipsis = [...document.querySelectorAll(`${S}.lo-card__name`)]
    .filter((e) => e.scrollWidth > e.clientWidth + 1).length;
  const detail = document.querySelector(S + '.eq-detail');
  return {
    rows: cards.length,
    packCards: document.querySelectorAll(`${S}.eq-card[data-pack="1"]`).length,
    packCardsShown: cards.filter((c) => c.dataset.pack === '1' && c.getBoundingClientRect().bottom <= innerHeight + 1
      && c.getBoundingClientRect().top >= -1).length,
    tiers: document.querySelectorAll(S + '.eq-tier').length,
    tierChips: document.querySelectorAll(S + '.lo-chips[aria-label="阶级"] .lo-chip').length,
    bondChips: document.querySelectorAll(S + '.lo-chips[aria-label="盟约"] .lo-chip').length,
    bondOptions: document.querySelectorAll(S + '.eq-bondselect option').length,
    cardArt: cards.slice(0, 3).map((c) => box(c.querySelector('.lo-card__art'))),
    cardH: cards.length ? Math.round(cards[0].getBoundingClientRect().height) : 0,
    bondTags: document.querySelectorAll(S + '.eq-card .eq-bond:not(.is-none)').length,
    biasBadges: document.querySelectorAll(S + '.eq-bias').length,
    effects: document.querySelectorAll(S + '.eq-eff').length,
    filters: box(document.querySelector(S + '.lo-filters')),
    grid: box(document.querySelector(S + '.lo-grid')),
    detailW: detail ? Math.round(detail.getBoundingClientRect().width) : 0,
    detailScroll: detail ? detail.scrollHeight - detail.clientHeight : 0,
    // 包美术真的画出来了吗（不是空框）—— 只收落在视口里的卡面，坐标交给 Node 侧在 PNG 上量墨
    packArt: [...document.querySelectorAll(S + '.eq-card[data-pack="1"]')].map((c) => {
      const r = c.querySelector('.lo-card__art').getBoundingClientRect();
      return { id: c.dataset.item, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((g) => g.y >= 0 && g.y + g.h <= innerHeight && g.x >= 0 && g.x + g.w <= innerWidth),
    detailArt: (() => {
      const e = document.querySelector(S + '.eq-detail__art');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    maxCardBottom: [...document.querySelectorAll(S + '.eq-card')].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0),
    legendTop: Math.round(document.getElementById('fig-legend').getBoundingClientRect().top),
    // 关键件不许出界（右边缘被切）
    offPage: ['.lo-top__left', '.lo-top__center', '.lo-top__right', '.lo-count', '.lo-back', '.eq-filters', '.lo-grid', '.eq-detail']
      .map((sel) => {
        const e = document.querySelector(S + sel);
        if (!e) return `${sel}:MISS`;
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) ? `${sel}:${Math.round(r.left)}..${Math.round(r.right)}` : null;
      }).filter(Boolean),
    visibleCards: [...document.querySelectorAll(S + '.eq-card')]
      .map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.item, pack: c.dataset.pack, x: Math.round(r.left), y: Math.round(r.top), b: Math.round(r.bottom) }; })
      .filter((c) => c.y >= 0 && c.b <= innerHeight).map((c) => `${c.pack === '1' ? '★' : ''}${c.id}`),
    zero, clipped, ellipsis,
  };
});

// ---- 渲染 -------------------------------------------------------------------------------------------

const PASSES = [
  { id: 'web', file: 'mod-ui-equipment-web.png', width: 1920, height: 1080, mobile: false, cls: 'sp-hover sp-fs', bondUI: 'chips', legend: 'long', mk: 22, lg: 12, markers: MARKERS_WEB },
  { id: 'phone', file: 'mod-ui-equipment-phone.png', width: 844, height: 390, mobile: true, cls: 'sp-touch sp-coarse sp-no-hover', bondUI: 'select', legend: 'short', mk: 18, lg: 9, markers: MARKERS_PHONE },
];

const results = [];
for (const p of PASSES) {
  const html = path.join(TMP, `${p.id}.html`);
  writeFileSync(html, htmlFor(p), 'utf8');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: p.width, height: p.height, deviceScaleFactor: 1, isMobile: p.mobile, hasTouch: p.mobile });
    await page.evaluateOnNewDocument((cls) => { document.documentElement.className = cls; }, p.cls);
    await page.evaluateOnNewDocument((v) => {
      document.documentElement.style.setProperty('--mk-s', v.mk);
      document.documentElement.style.setProperty('--lg-fs', v.lg);
      document.documentElement.style.setProperty('--lg-pad', v.pad);
    }, { mk: `${p.mk}px`, lg: `${p.lg}px`, pad: p.legend === 'short' ? '6px 12px 7px' : '9px 16px 10px' });
    await page.goto(furl(html), { waitUntil: 'load' });
    await waitImages(page);
    await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const marks = await decorate(page, p.markers);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const audit = await AUDIT(page);
    const broken = await page.evaluate(() => Array.from(document.querySelectorAll('.lo img')).filter((i) => !i.complete || i.naturalWidth === 0).length);
    const rem = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const fonts = await page.evaluate(() => ({
      loaded: [...new Set(Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family))].sort(),
      noto: document.fonts.check('16px "Noto Sans SC"'),
      bender: document.fonts.check('16px "Bender"'),
      novecento: document.fonts.check('16px "Novecento Wide"'),
    }));
    await page.screenshot({ path: path.join(HERE, p.file), clip: { x: 0, y: 0, width: p.width, height: p.height } });
    // 截图会不会把内层滚动位置冲掉？截图后回读一次，确认图里看到的就是量到的那一屏
    const afterScroll = await page.evaluate(() => {
      const g = document.querySelector('.lo .lo-grid');
      const first = [...document.querySelectorAll('.lo .eq-tier')].find((t) => t.getBoundingClientRect().top >= 0);
      return { scrollTop: g ? Math.round(g.scrollTop) : null, firstTierVisible: first ? first.textContent.trim() : null };
    });
    results.push({ ...p, audit, broken, rem, fonts, marks, afterScroll });
  } finally { await browser.close(); }
}

// ---- 自检（本模型读不了图，故用几何 + 像素证据替代目视） --------------------------------------------

const pngSize = (f) => { const b = readFileSync(path.join(HERE, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: Math.round(b.length / 1024) }; };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** 区域墨量 = 与区域中位亮度差 >12 的像素占比（背景是平的，文字/描边/色块都算墨）。 */
const inkOfRect = (png, x0, y0, x1, y1) => {
  const vals = [];
  for (let y = Math.max(0, y0); y < Math.min(png.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(png.w, x1); x++) {
      const o = (y * png.w + x) * 4; vals.push(lum(png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]));
    }
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b); const med = vals[vals.length >> 1];
  let n = 0; for (const v of vals) if (Math.abs(v - med) > 12) n++;
  return +(n / vals.length).toFixed(4);
};
const bandsOf = (png) => Array.from({ length: 10 }, (_, i) =>
  inkOfRect(png, 0, Math.floor((png.h * i) / 10), png.w, Math.floor((png.h * (i + 1)) / 10)));

const problems = [];
console.log('\n== 自检 ==');
console.log(` 样式来源: public/css/{theme,components,devices,loadout,game-panels}.css + fonts.css（本分支，${cssParts.slice(0, 5).reduce((a, c) => a + c.length, 0)} 字符）`);
console.log(`          + [mod] payload/public/css/screens/equipment.css（.eq-* 提案块，${EQUIP_CSS.length} 字符，原样载入）`);
console.log(` 端类/尺寸: ${PASSES.map((p) => `${p.id}=${p.cls} ${p.width}x${p.height}`).join(' | ')}`);
console.log(` 数据: 官方 items ${Object.keys(OFFICIAL_ITEMS).length} 条 / bonds ${Object.keys(OFFICIAL_BONDS).length} 条`
  + ` + 包 records.json items ${PACK_ITEM_IDS.length} / bonds ${Object.keys(RECORDS.bonds).length} / 美术 ${Object.keys(RECORDS.assets.items).length + Object.keys(RECORDS.assets.bonds).length}`);
console.log(` 官方 20 条修正（[mod] items.json → tier/giveBondId/giveBondBiasOnly）: 应用 ${corrections.length} 条`
  + ` | tier ${corrections.filter((c) => c.tier != null).length} · giveBondId ${corrections.filter((c) => 'giveBondId' in c).length} · biasOnly ${corrections.filter((c) => c.giveBondBiasOnly).length}`);
console.log(` 图鉴行: ${ROWS.length}（官方 ${ROWS.length - PACK_ROWS.length} + 包 ${PACK_ROWS.length}） | 阶 ${TIERS.map((t) => ROMAN[t] || t).join('/')}（数据派生）`
  + ` | 盟约候选 ${BOND_LIST.length}（数据派生，含包 ${BOND_LIST.filter((b) => RECORDS.bonds[b.bondId]).length}）`);
console.log(` 包内件: ${PACK_ROWS.map((r) => `${r.base.name}(t${r.base.tier},${r.base.giveBondId || '无盟约'})`).join(' · ')}`);
console.log(` 美术未解析（走 Img fallback，不是破图）: ${[...new Set(unresolved)].join(', ') || 'none'}`);
console.log(` 选中: ${SEL.base.name}(${SEL.base.id}) tier ${SEL.base.tier} bond ${SEL.base.giveBondId || '无'} biasOnly ${!!SEL.base.giveBondBiasOnly}`);
for (const r of results) {
  const a = r.audit;
  console.log(` [${r.id}] rem=${r.rem} 字体 Noto=${r.fonts.noto} Bender=${r.fonts.bender} Novecento=${r.fonts.novecento} | 破图 ${r.broken}`
    + ` | 卡 ${a.rows}(h${a.cardH}) 包内卡可见 ${a.packCardsShown}/${a.packCards} | 阶段 ${a.tiers} 阶chip ${a.tierChips} 盟约chip ${a.bondChips} 盟约option ${a.bondOptions}`
    + ` | 盟约标签 ${a.bondTags} 仅归类徽标 ${a.biasBadges} 效果块 ${a.effects} | 筛选 ${a.filters} 网格 ${a.grid} 详情宽 ${a.detailW}`
    + ` | 塌陷 ${a.zero} | 文字裁切 ${a.clipped.length ? a.clipped.join('/') : '无'}（卡名省略号 ${a.ellipsis}，设计如此）`);
  console.log(`       圆标落点: ${r.marks.placed.map((m) => `${m.n}@${m.rect ? `${m.rect.x},${m.rect.y}` : 'MISS'}${m.inside === false ? ':OUT' : ''}`).join(' ')}`
    + ` | 图例 ${r.marks.legendH}px(${r.marks.lgFs}) 条目 ${r.marks.lgRows.join('/')} | html.${r.marks.htmlClass} 网格滚到 ${r.marks.gridScroll}`);
  if (r.broken) problems.push(`${r.id}: 破图 ${r.broken}`);
  if (a.zero) problems.push(`${r.id}: 塌陷 ${a.zero}`);
  if (r.marks.placed.some((m) => !m.rect || m.inside === false)) problems.push(`${r.id}: 圆标未落在目标上`);
  if (!r.fonts.noto || !r.fonts.bender || !r.fonts.novecento) problems.push(`${r.id}: 字体未全加载`);
  const s = pngSize(r.file);
  const png = decodePng(readFileSync(path.join(HERE, r.file)));
  const bands = bandsOf(png);
  console.log(`       ${r.file}: ${s.w}x${s.h}, ${s.kb} KB | 10 条带墨量 ${bands.join(' ')} min=${Math.min(...bands)}`);
  // 包美术真的画出来了（卡片图/详情图区域有内容），且图例条没有压住任何一张卡
  const artInk = [...a.packArt, ...(a.detailArt ? [{ id: `详情·${SEL.base.id}`, ...a.detailArt }] : [])]
    .map((g) => `${g.id.slice(-12)} ${g.w}x${g.h}@${g.x},${g.y} 墨${inkOfRect(png, g.x, g.y, g.x + g.w, g.y + g.h)}`);
  console.log(`       包美术墨量: ${artInk.join(' | ')}`);
  const covered = a.maxCardBottom > a.legendTop;
  console.log(`       图例条 top=${a.legendTop} | 最低卡片底边=${Math.round(a.maxCardBottom)} → ${covered ? '压住了卡片' : '未压住任何卡片'}`
    + ` | 出界 ${a.offPage.length ? a.offPage.join(' ') : 'none'}`);
  console.log(`       视口内卡片 ${a.visibleCards.length}（★=包内件）: ${a.visibleCards.join(' ')}`);
  if (a.offPage.length) problems.push(`${r.id}: 出界 ${a.offPage.join(' ')}`);
  if (!a.visibleCards.some((c) => c.startsWith('★'))) problems.push(`${r.id}: 视口内没有包内件`);
  if (a.packArt.some((g) => inkOfRect(png, g.x, g.y, g.x + g.w, g.y + g.h) < 0.05)) problems.push(`${r.id}: 包美术卡面疑似空白`);
  if (covered) problems.push(`${r.id}: 图例条压住了卡片`);
  if (s.w !== r.width || s.h !== r.height) problems.push(`${r.file} 尺寸 ${s.w}x${s.h} ≠ ${r.width}x${r.height}`);
  if (bands.some((v) => v === 0)) problems.push(`${r.file}: 存在空条带`);
}
console.log(problems.length ? `\n ${problems.length} 项未通过：\n  - ${problems.join('\n  - ')}` : '\n 全部通过');
console.log(' 注意：几何与像素证据不能替代审美判断，仍建议人工过目一眼。');

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
process.exitCode = problems.length ? 1 : 0;
