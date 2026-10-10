// docs/mockups/render-mod-alliances-ui.mjs — 「盟约与策略总览」装内容包之后的改进版 UI 图
//
// 与 render-mod-equipment-ui.mjs 同一路数（那支是姊妹脚本，本文件直接复用它的骨架：数据合并、样式注入、
// 端类设置、视口尺寸、圆标落点、末尾结构化自检）。本分支里这个界面**还不存在**（`public/js/screens/alliances.js`
// 与 `public/css/screens/alliances.css` 全仓 0 命中，见 docs/MOD_UI_ADAPTATION_PLAN.md §3.2），所以按「参考图」
// 的做法重建版面——**样式表、类名、字体、尺寸全部取自仓库源码**，唯一不是真的东西是「这段代码还没写」：
//
//   风格基线  public/css/{theme,components,devices}.css + public/css/screens/{loadout,game-panels}.css（本分支）
//            + [mod] payload/public/css/screens/equipment.css（`.eq-*` 共用骨架，65 行，原样载入）
//            + [mod] payload/public/css/screens/alliances.css（`.al-*` 本屏自有块，91 行，原样载入）
//            + public/fonts/fonts.css（Bender / Novecento Wide + Noto Sans SC）
//   版面结构  [mod] payload/public/js/screens/alliances.js 的 .lo / .lo-top / .lo-note / .lo-body / .lo-roster /
//            .al-tabs / .lo-filters / .lo-grid / .al-group / .lo-card（BondCard / BandCard）/ .eq-detail（BondDetail /
//            BandDetail）/ .eq-eff / .al-layerrow / .al-members / .al-item / .al-bondchip
//   数据      public/data/{bonds,chess,items,garrisons,bands,assets}.json（官方 23 盟约 / 266 棋子 / 115 装备 /
//            249 特质 / 40 策略）
//            + [mod] payload/packs/fanpack/records.json（包内 2 条新盟约 卡兹戴尔/罗德岛 + 9 件装备 + 34 条特质
//              + assets 覆盖）与 payload/packs/fanpack/chess.json（包内棋子 40 条，其中 26 条是新增 id）
//            + [mod] payload/packs/fanpack/art/*.png（包内 6 张美术：bond_kazdelShip / bond_rhodesShip / trap_c_01..04）
//
// 合并语义照 shared/customContent.js + server customOverlay：bonds/items/garrisons/chess 整条替换式并集，
// assets 只并 items/bonds 两段 + 包美术清单；**assets.chars 不并**（所以包内棋子若引用了清单里没有的立绘，
// 就落到 ui/gameComponents.js:109 UnitThumb 的名字字形兜底——这是真实的缺字段兜底，不是画的）。
//
// 尺寸不手写：根字号 = clamp(24px, min(100vw/19.2, 100svh/10.8), 240px)，Web 1920×1080 → 1rem = 100px，
// 安卓横屏 844×390 → 1rem ≈ 36.1px（实测值由自检打印）。`<html>` 端类照 ui/device.js 打：
// Web = `sp-hover sp-fs`，安卓 = `sp-touch sp-coarse sp-no-hover`。两趟各出一张 1:1 的整屏图。
//
// 图上的 ①..⑤ 圆标 = 这一处靠哪个**端口**（端口名与 docs/MOD_UI_ADAPTATION_PLAN.md §5 的表一致）适配；
// 图例条里另有「入口（挂载点口）」与「样式骨架口 / 枚举可缺项口 / 阶·层号口 / giveBondBiasOnly 口」的说明。
//
// 用法：node docs/mockups/render-mod-alliances-ui.mjs   （Windows 自动探测 Chrome；或设 CHROME_PATH）
//      包目录默认取 <repo>/../mod-inspect/fanpack-mod，可用 FANPACK_DIR 覆盖。
// 产物：docs/mockups/mod-ui-alliances-web.png   1920×1080
//       docs/mockups/mod-ui-alliances-phone.png  844×390
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
const OFFICIAL_BONDS = readJson(path.join(PUB, 'data/bonds.json'));        // {bondId: rec}
const OFFICIAL_CHESS = readJson(path.join(PUB, 'data/chess.json'));        // {chessId: rec}
const OFFICIAL_ITEMS = readJson(path.join(PUB, 'data/items.json'));        // {id: rec}
const OFFICIAL_GARRISONS = readJson(path.join(PUB, 'data/garrisons.json')); // {garrisonId: rec}
const OFFICIAL_BANDS = readJson(path.join(PUB, 'data/bands.json'));        // {bandId: rec}
const OFFICIAL_ASSETS = readJson(path.join(PUB, 'data/assets.json'));
const RECORDS = readJson(path.join(PACKS_DIR, 'records.json'));
const PACK_CHESS = readJson(path.join(PACKS_DIR, 'chess.json')).chess;
const ART_INDEX = readJson(path.join(PACKS_DIR, 'art/index.json'));

// ---- 合并（就是 shared/customContent.js + server customOverlay 要做的事，见方案 §5「数据段合并口」） ----

const BONDS = { ...OFFICIAL_BONDS, ...RECORDS.bonds };
const ITEMS = { ...OFFICIAL_ITEMS, ...RECORDS.items };
const GARRISONS = { ...OFFICIAL_GARRISONS, ...RECORDS.garrisons };
const CHESS = { ...OFFICIAL_CHESS, ...PACK_CHESS };
const ASSETS = {
  ...OFFICIAL_ASSETS,
  items: { ...OFFICIAL_ASSETS.items, ...RECORDS.assets.items },
  bonds: { ...OFFICIAL_ASSETS.bonds, ...RECORDS.assets.bonds },
  // 注意：chars 不并 —— 与 [mod] server/index.js customOverlay 一致（只并 items/bonds + 包美术）
};
const PACK_BOND_IDS = Object.keys(RECORDS.bonds).filter((id) => !OFFICIAL_BONDS[id]);   // 包新增盟约
const PACK_CHESS_IDS = Object.keys(PACK_CHESS).filter((id) => !OFFICIAL_CHESS[id]);     // 包新增棋子
const PACK_ITEM_IDS = Object.keys(RECORDS.items);
const PACK_GARRISON_IDS = Object.keys(RECORDS.garrisons);

// ---- 美术取数（assetUrls.js:100 bondIconUrl / :110 itemIconUrl / :187 特质图标 的等价物 + 缺图回落） ---

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
const bondIcon = (id) => assetUrl(ASSETS.bonds?.[id]);
const itemIcon = (it) => assetUrl(ASSETS.items?.[it?.iconId] || ASSETS.items?.[it?.trapId]);
const bandIcon = (id) => assetUrl(ASSETS.bands?.[id]);
const uiIcon = (key) => assetUrl(ASSETS.ui?.[key]);
const tierSprite = (t) => uiIcon(`shopCard/img_chess_level_${Math.max(1, Math.min(6, Number(t) | 0 || 1))}`);
/** chessAvatarUrl 的等价物（assets.chars 不并，所以包内新棋子可能没有立绘 → null → 名字字形兜底）。 */
function chessAvatar(c) {
  const chars = ASSETS.chars || {};
  const id = (c?.assets?.avatar) || c?.charId;
  if (!id) return null;
  if (id.endsWith('_2') && !chars[id]) {
    const base = chars[id.slice(0, -2)];
    return assetUrl((base && base.avatarE2) || (base && base.avatar));
  }
  return assetUrl((chars[id] && chars[id].avatar) || (c?.charId ? chars[c.charId]?.avatar : null));
}

// ---- 纯函数模型（照 [mod] alliances.js:59-170 抄；枚举表故意保留缺项，好让兜底在图上可见） -----------

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** 生效阶段（[mod] alliances.js:153）——只认 BATTLE/ALL，调和 的 MANI 无标签（§5「枚举可缺项口」）。 */
const PHASE_NAMES = { BATTLE: '战斗中生效', ALL: '全程生效' };
/** 模式（[mod] alliances.js:155）。 */
const MODE_NAMES = { LOCAL: '本地模式', SINGLE: '独立模拟', MULTI: '同盟模拟' };
/** 计数方式（[mod] alliances.js:157）——缺 BOARD_AND_DECK / BOARD_ALL_CHESS，会原样印出枚举值。 */
const COUNT_NAMES = { BOARD: '场上', HAND: '手牌', DECK: '待部署区', GLOBAL: '全局' };

const ord = (b) => (Number.isFinite(b.bondOrder) ? b.bondOrder : 99);
/** 核心盟约 first（bondOrder，缺记 99），再附加盟约 —— [mod] alliances.js:60-66。 */
function bondRows(bonds) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => b && b.bondId);
  const core = list.filter((b) => b.isCore).sort((a, b) => ord(a) - ord(b));
  const add = list.filter((b) => !b.isCore).sort((a, b) => ord(a) - ord(b));
  return [...core, ...add].map((bond) => ({ bond, isCore: !!bond.isCore }));
}
/** 策略排序：sortId，再 bandId —— [mod] alliances.js:69-75。 */
function bandRows(bands) {
  const sid = (b) => (Number.isFinite(b?.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && b.bandId)
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0))
    .map((band) => ({ band }));
}
/** 层号：thresholds，或 1..maxCount；>6 走 +N —— [mod] alliances.js:78-83。 */
function bondLayers(bond) {
  const th = Array.isArray(bond?.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  const max = Number.isFinite(bond?.maxCount) && bond.maxCount > 0 ? bond.maxCount : null;
  const top = Math.max(th.length, max ? Math.min(max, 10) : 1, 1);
  return Array.from({ length: top + 1 }, (_, i) => i);
}
/** 每层的成员门槛 + 结算后的效果文本（ui/richText.js formatBondEffect）—— [mod] alliances.js:89-92。 */
function bondLayerTexts(bond) {
  const th = Array.isArray(bond?.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  return bondLayers(bond).map((layer) => ({ layer, need: layer > 0 ? (th[layer - 1] ?? null) : null, text: formatBondEffect(bond, layer) }));
}
/** 成员：visibleMembers ?? members，查不到静默丢行（filter(Boolean)），tier→shopSortId→name —— :100-105。 */
function bondMembers(bond, lookup) {
  const ids = bond?.visibleMembers?.length ? bond.visibleMembers : bond?.members || [];
  const byTier = (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0)
    || String(a.name).localeCompare(String(b.name), 'zh');
  return (Array.isArray(ids) ? ids : []).map((id) => lookup(id)).filter(Boolean).sort(byTier);
}
/** 相关装备：!isGolden && giveBondId === bondId —— [mod] alliances.js:108-112。 */
function bondEquipment(bondId, items) {
  return (Array.isArray(items) ? items : []).filter((i) => i && !i.isGolden && i.giveBondId === bondId)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0)
      || String(a.name).localeCompare(String(b.name), 'zh'));
}
/** 成员的官/包归属：不在官方 chess 里的就是包内干员（「官方成员 ∪ 包内干员」的并集语义）。 */
const isPackChess = (id) => !OFFICIAL_CHESS[id];

// ---- richText 的两件替身（照 public/js/ui/richText.js 抄） -----------------------------------------

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
/** formatPlaceholder（richText.js:127-145）。 */
function formatPlaceholder(value, fmt = '0') {
  const v = Number(value);
  if (!Number.isFinite(v)) return '?';
  const f = typeof fmt === 'string' ? fmt : '0';
  const pct = f.endsWith('%');
  const core = pct ? f.slice(0, -1) : f;
  const dot = core.indexOf('.');
  const decimals = dot >= 0 ? Math.min(4, core.length - dot - 1) : 0;
  const n = pct ? v * 100 : v;
  const fixed = n.toFixed(decimals);
  const clean = Number(fixed) === 0 ? (0).toFixed(decimals) : fixed;
  return pct ? `${clean}%` : clean;
}
/** formatBondEffect（richText.js:166-185）：{i:fmt} = bb[base] + bb[perStack] × layers。 */
function formatBondEffect(bond, layers = 0) {
  if (!bond || typeof bond !== 'object') return '';
  const src = bond.effectDescRaw || bond.effectDesc || '';
  const params = Array.isArray(bond.effectDescParams) ? bond.effectDescParams : [];
  const bb = bond.bb && typeof bond.bb === 'object' ? bond.bb : {};
  const L = Number.isFinite(Number(layers)) ? Math.max(0, Number(layers)) : 0;
  const values = []; const formats = [];
  for (const p of params) {
    if (!p || !Number.isInteger(p.index)) continue;
    const base = Number(bb[p.base]) || 0;
    const per = Number(bb[p.perStack]) || 0;
    const chance = /prob/i.test(`${p.base}|${p.perStack}`);
    values[p.index] = chance ? Math.max(0, Math.min(1, base + per * L)) : base + per * L;
    formats[p.index] = p.format || '0';
  }
  return String(src).replace(/\{(\d{1,2})(?::([^{}]{1,12}))?\}/g, (whole, idx, fmt) => {
    const i = Number(idx);
    const v = values[i];
    if (v == null) return whole;
    if (typeof v === 'string') return v;
    return formatPlaceholder(v, formats[i] || fmt || '0');
  });
}
/** garrisonTypeIconKey（ui/detailPanel.js:311-316）：缺 eventTypeIcon 时按触发回落 —— 缺字段兜底。 */
const EVENT_ICON = {
  IN_BATTLE: 's_icon_battle', SERVER_GAIN: 's_icon_bond', SERVER_PREP_START: 's_icon_bond',
  SERVER_PREP_FIN: 's_icon_bond', SERVER_CHESS_SOLD: 's_icon_gold', SERVER_PRICE: 's_icon_gold',
  SERVER_REFRESH_SHOP: 's_icon_gold',
};
function garrisonTypeIconKey(g) {
  const k = g && typeof g.eventTypeIcon === 'string' ? g.eventTypeIcon : '';
  if (/^icon_[a-z]+$/.test(k)) return `s_${k}`;
  return EVENT_ICON[g?.eventType] || 's_icon_bond';
}

// ---- 小工具 -----------------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICONS = {
  check: { d: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z' },
  crown: { d: 'M3 7l4.6 4.2L12 4l4.4 7.2L21 7l-1.8 10H4.8zM5 19h14v2H5z' },
  sword: { d: 'M20 3h1v4L10.4 17.6l1.4 1.4-1.4 1.4-2.1-2.1-3.5 3.5-1.4-1.4 3.5-3.5L4.8 14.8l1.4-1.4 1.4 1.4L18 4z' },
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
/** TierChip（components.js:195-201）的等价物：官方八角 sprite，`tier--img`；extra 传额外类名（如 uthumb__tier）。 */
const tierChip = (t, size = 'sm', extra = '') => {
  const n = Math.max(1, Math.min(6, Number(t) | 0 || 1));
  const src = tierSprite(n);
  return `<span class="tier tier--${n} tier--${size}${src ? ' tier--img' : ''}${extra ? ` ${extra}` : ''}" aria-label="${n}阶">`
    + (src ? `<img src="${esc(src)}" alt="">` : ROMAN[n]) + '</span>';
};
/** 层号块（[mod] alliances.js:162-170 LayerChip）：≤6 用八角 sprite，>6 写 +N。 */
function layerChip(layer, need) {
  if (!layer) return `<span class="al-layer al-layer--0 is-sm"><span class="al-layer__k">基础</span></span>`;
  return `<span class="al-layer is-sm"${need != null ? ` title="${need} 名成员"` : ''}>`
    + (layer <= 6 ? tierChip(layer, 'sm') : `<span class="al-layer__k">${ROMAN[layer] || `+${layer}`}</span>`)
    + (need != null ? `<span class="al-layer__n num">${need} 名</span>` : '') + '</span>';
}
/** 盟约标签（[mod] alliances.js:173-177 BondTag / :198-204 的 icon）。 */
function bondTag(bond, { large = false, short = false } = {}) {
  if (!bond) return `<span class="eq-bond is-none">${short ? '—' : '无盟约'}</span>`;
  const ic = bondIcon(bond.bondId);
  return `<span class="eq-bond${large ? ' eq-bond--lg' : ''}">`
    + (ic ? `<img class="eq-bond__icon" src="${esc(ic)}" alt="">` : svgIcon('crown', 'eq-bond__icon'))
    + `<span>${esc(bond.name)}</span></span>`;
}

// ---- 屏内标记（真实类名，取自 [mod] alliances.js / alliances.css / equipment.css） -------------------

/** 盟约卡（[mod] alliances.js:180-194 BondCard）——包内盟约与官方盟约走同一个函数、同一张卡。 */
function bondCard(row, selId) {
  const b = row.bond;
  const th = Array.isArray(b.thresholds) ? b.thresholds : [];
  const ic = bondIcon(b.bondId);
  return `<button type="button" class="lo-card al-card al-card--bond${row.isCore ? ' al-card--core' : ''}${b.bondId === selId ? ' is-sel' : ''}"`
    + ` data-bond="${esc(b.bondId)}" data-pack="${PACK_BOND_IDS.includes(b.bondId) ? 1 : 0}"`
    + ` aria-pressed="${b.bondId === selId ? 'true' : 'false'}">`
    + '<span class="lo-card__art">'
    + (ic ? `<img src="${esc(ic)}" alt="${esc(b.name)}">` : `<span class="lo-card__glyph">${svgIcon('crown')}</span>`)
    + '</span>'
    + `<span class="lo-card__name">${esc(b.name)}</span>`
    + '<span class="lo-card__kit al-card__meta">'
    + `<span class="al-kind ${row.isCore ? 'is-core' : 'is-add'}">${row.isCore ? '核心' : '附加'}</span>`
    + (th.length ? `<span class="al-card__th num">${th.join(' / ')}</span>` : '')
    + '</span></button>';
}
/** 策略卡（[mod] alliances.js:197-208 BandCard）。 */
function bandCard(row, selId) {
  const b = row.band;
  const ic = bandIcon(b.bandId);
  return `<button type="button" class="lo-card al-card al-card--band${b.bandId === selId ? ' is-sel' : ''}"`
    + ` data-band="${esc(b.bandId)}" aria-pressed="${b.bandId === selId ? 'true' : 'false'}">`
    + '<span class="lo-card__art">'
    + `<span class="bandicon bandicon--md"><img src="${esc(ic || '')}" alt=""></span>`
    + '</span>'
    + `<span class="lo-card__name">${esc(b.name)}</span>`
    + '<span class="lo-card__kit al-card__meta">'
    + `<span class="al-card__eff">${esc(b.effectName || '')}</span>`
    + `<span class="al-card__hp">${esc(b.totalHp)}</span>`
    + '</span></button>';
}
/** 成员行（[mod] alliances.js:211-217 MemberRow）＋「包」徽标（并集语义可见）＋ 头像缺图兜底。 */
function memberRow(c) {
  const pack = isPackChess(c.chessId);
  const av = chessAvatar(c);
  const glyph = [...(c.name || '?')][0] || '?';
  const t = Math.max(1, Math.min(6, c.tier | 0 || 1));
  return `<div class="al-member" data-chess="${esc(c.chessId)}" data-pack="${pack ? 1 : 0}"`
    + ` data-avatar="${av ? 'ok' : 'fallback'}" title="${esc(c.name)} · ${esc(c.appellation || '')}">`
    + `<span class="uthumb uthumb--sm uthumb--chess uthumb--t${t}">`
    + `<span class="uthumb__art">${av ? `<img src="${esc(av)}" alt="">` : `<span class="uthumb__glyph">${esc(glyph)}</span>`}</span>`
    // 与真实 UnitThumb 一致：缩略图自带的迷你阶标挂 `uthumb__tier`，被 `.al-member .uthumb__tier{display:none}` 隐掉
    + tierChip(t, 'sm', 'uthumb__tier') + '</span>'
    + `<span class="al-member__name">${esc(c.name)}</span>`
    + tierChip(c.tier, 'sm')
    + (pack ? '<span class="lo-badge lo-badge--plain al-pack">包</span>' : '')
    + '</div>';
}
/** 特质块（ui/detailPanel.js:319-329 GarrisonBlock 的等价物）——eventTypeIcon + eventTypeDesc + descRaw。 */
function garrisonBlock(g, owner) {
  const icon = uiIcon(`garrisonTypeIcon/${garrisonTypeIconKey(g)}`);
  const desc = g.descRaw || g.desc;               // 缺 descRaw → 回落 desc
  return '<section class="dgarrison" data-garrison="' + esc(g.garrisonId || '') + '">'
    + '<div class="dgarrison__head"><span class="dgarrison__k">特质</span>'
    + '<span class="dgarrison__type">'
    + (icon ? `<img class="dgarrison__icon" src="${esc(icon)}" alt="">` : svgIcon('warn', 'dgarrison__icon'))
    + `${esc(g.eventTypeDesc || '')}</span>`   // 缺 eventTypeDesc → 留空
    + (owner ? `<span class="al-gar__owner">${esc(owner)}</span>` : '')
    + (PACK_GARRISON_IDS.includes(g.garrisonId) ? '<span class="lo-badge lo-badge--plain al-pack">包</span>' : '')
    + '</div>'
    + `<p class="dgarrison__text">${desc ? rich(desc) : '<span class="t-dim">—</span>'}</p>`
    + '</section>';
}
/** 效果块（[mod] alliances.js:245-251）。 */
function effectSection(label, micro, inner) {
  return `<section class="eq-eff" aria-label="${esc(label)}">`
    + `<div class="eq-eff__head"><span class="eq-eff__k">${esc(label)}</span><span class="eq-eff__micro">${esc(micro)}</span></div>`
    + inner + '</section>';
}
/** 右栏详情（[mod] alliances.js:220-271 BondDetail）。 */
function bondDetail(row, sel) {
  const b = row.bond;
  const th = Array.isArray(b.thresholds) ? b.thresholds : [];
  const layers = bondLayerTexts(b);
  const members = bondMembers(b, (id) => CHESS[id]);
  const equips = bondEquipment(b.bondId, Object.values(ITEMS));
  const count = [COUNT_NAMES[b.countMode] || b.countMode || '场上', b.countsHand ? '含手牌' : null, b.countsGoldenOnly ? '只算精锐' : null]
    .filter(Boolean).join(' · ');
  const disc = bondIcon(b.bondId);
  const memberGarrisons = [];
  for (const c of members) for (const gid of c.garrisonIds || []) if (GARRISONS[gid]) memberGarrisons.push({ g: GARRISONS[gid], owner: c.name });
  // 图上只摆包内特质（4 条），其余用计数说明；这样「包字段」与「成员并集」在图上都看得见
  const packGars = memberGarrisons.filter((x) => PACK_GARRISON_IDS.includes(x.g.garrisonId)).slice(0, 3);
  return '<div class="eq-detail al-detail">'
    + '<header class="eq-detail__head">'
    + `<span class="eq-detail__art al-detail__disc${row.isCore ? ' is-core' : ''}">`
    + (disc ? `<img src="${esc(disc)}" alt="${esc(b.name)}">` : `<span class="lo-card__glyph">${svgIcon('crown')}</span>`)
    + '</span>'
    + '<div class="eq-detail__id">'
    + `<span class="micro micro--mint">${row.isCore ? 'CORE BOND // 核心盟约' : 'ADD-ON BOND // 附加盟约'}</span>`
    + `<h2 class="eq-detail__name">${esc(b.name)}</h2>`
    + '<div class="eq-detail__tags">'
    + `<span class="eq-meta">计数 <b>${esc(count)}</b></span>`
    + (PHASE_NAMES[b.activeType] ? `<span class="eq-meta">${esc(PHASE_NAMES[b.activeType])}</span>` : '')
    + (th.length ? `<span class="eq-meta">阈值 <b class="num">${th.join(' / ')}</b></span>` : '')
    + (b.maxCount ? `<span class="eq-meta">层数上限 <b class="num">${b.maxCount}</b></span>` : '')
    + (b.noStack ? `<span class="eq-meta is-warn">${svgIcon('warn')}层数不叠加（取最高）</span>` : '')
    + `<span class="eq-meta ${PACK_BOND_IDS.includes(b.bondId) ? 'is-pack' : 't-dim'}">${PACK_BOND_IDS.includes(b.bondId) ? '内容包盟约' : '官方盟约'}</span>`
    + '</div></div></header>'
    + effectSection('效果', b.effectName || 'EFFECT',
      layers.map((l) => `<div class="al-layerrow${l.layer === 0 ? ' is-base' : ''}">${layerChip(l.layer, l.need)}`
        + `<p class="eq-eff__text">${l.text ? rich(l.text) : '<span class="t-dim">—</span>'}</p></div>`).join(''))
    + (b.descRaw || b.desc ? effectSection('完整描述', 'FULL TEXT', `<p class="eq-eff__text">${rich(b.descRaw || b.desc)}</p>`) : '')
    + (equips.length ? effectSection('相关装备', 'EQUIPMENT',
      `<div class="al-items">${equips.map((it) => {
        const ic = itemIcon(it);
        return `<button type="button" class="al-item" data-item="${esc(it.id)}" data-pack="${PACK_ITEM_IDS.includes(it.id) ? 1 : 0}" title="在装备总览里查看">`
          + (ic ? `<img class="al-item__icon" src="${esc(ic)}" alt="">` : svgIcon('book', 'al-item__icon'))
          + `<span class="al-item__name">${esc(it.name)}</span>${tierChip(it.tier, 'sm')}</button>`;
      }).join('')}</div>`) : '')
    + effectSection('成员', String(members.length),
      members.length
        ? `<div class="al-members">${members.map(memberRow).join('')}</div>`
          + `<p class="al-note">成员表 = 官方成员 ∪ 包内干员（带「包」徽标的来自内容包）；查不到的 id 静默丢行。</p>`
        : '<p class="eq-eff__text t-dim">没有成员记录</p>')
    + (packGars.length ? effectSection('成员特质', 'GARRISONS',
      `<div class="al-gars">${packGars.map((x) => garrisonBlock(x.g, x.owner)).join('')}</div>`
      + `<p class="al-note">eventTypeIcon 缺项 → 按触发回落 <code>s_icon_bond</code>；eventTypeDesc 缺项 → 留空；descRaw 缺项 → 回落 desc。</p>`) : '')
    + (sel ? '' : '')
    + '</div>';
}

// ---- 屏（[mod] alliances.js:354-463 AllianceScreen，去掉 Preact 外壳） --------------------------------

const BOND_LIST = bondRows(Object.values(BONDS));
const BANDS = bandRows(Object.values(OFFICIAL_BANDS));
const CORE = BOND_LIST.filter((r) => r.isCore);
const ADD = BOND_LIST.filter((r) => !r.isCore);
const SEL_ID = 'kazdelShip';                    // 包内核心盟约：一次把「包盟约、包美术、成员并集、包特质」摆出来
const SEL = BOND_LIST.find((r) => r.bond.bondId === SEL_ID) || CORE[0];
const SEL_BAND_ID = 'band_duyaoy';
const SEL_BAND = BANDS.find((r) => r.band.bandId === SEL_BAND_ID) || BANDS[0];
const PHASES = [...new Set(BOND_LIST.map((r) => r.bond.activeType).filter((k) => PHASE_NAMES[k]))];
const MODES = [...new Set(Object.values(OFFICIAL_BANDS).flatMap((b) => b.modeTypeList || []))];

function bondFilters() {
  const coreChips = [['全部', true], ['核心盟约', false], ['附加盟约', false]]
    .map(([lbl, on]) => `<button type="button" class="lo-chip${on ? ' is-on' : ''}">${lbl}</button>`).join('');
  const phaseChips = [`<button type="button" class="lo-chip is-on">全部阶段</button>`]
    .concat(PHASES.map((k) => `<button type="button" class="lo-chip">${PHASE_NAMES[k]}</button>`)).join('');
  return '<div class="lo-filters eq-filters">'
    + `<div class="lo-frow"><div class="lo-chips" role="group" aria-label="盟约类型">${coreChips}</div>`
    + '<label class="field field--sm lo-search"><span class="field__box brackets">' + svgIcon('search', 'field__icon')
    + '<input class="field__input" placeholder="搜索盟约 / 效果 / 成员" readonly></span></label></div>'
    + `<div class="lo-frow"><div class="lo-chips" role="group" aria-label="生效阶段">${phaseChips}</div>`
    + `<span class="micro">阶段候选 ${PHASES.length} · 由 activeType 派生（调和 MANI 无标签，故不出现）</span></div>`
    + '</div>';
}
function tabs() {
  return '<div class="lo-chips al-tabs" role="tablist" aria-label="分类">'
    + `<button type="button" role="tab" class="lo-chip al-tab is-on" aria-selected="true" data-tab="bonds">${svgIcon('crown')}盟约 <span class="num">${BOND_LIST.length}</span></button>`
    + `<button type="button" role="tab" class="lo-chip al-tab" aria-selected="false" data-tab="bands">${svgIcon('sword')}策略 <span class="num">${BANDS.length}</span></button>`
    + '</div>';
}
function bondGrid() {
  const group = (k, n) => `<div class="al-group" role="presentation"><span class="al-group__k">${k}</span><span class="al-group__n num">${n}</span></div>`;
  return '<div class="lo-grid al-grid al-grid--bonds" role="listbox" aria-label="盟约列表" id="al-grid">'
    + group('核心盟约', CORE.length) + CORE.map((r) => bondCard(r, SEL_ID)).join('')
    + group('附加盟约', ADD.length) + ADD.map((r) => bondCard(r, SEL_ID)).join('')
    + '</div>';
}
/** 整屏（[mod] alliances.js:412-462）。 */
function screen(opts) {
  return '<div class="lo eq al" role="dialog" aria-modal="true" aria-label="盟约与策略总览">'
    + '<div class="lo__bg" aria-hidden="true"></div>'
    + '<header class="lo-top">'
    + `<div class="lo-top__left"><button type="button" class="btn btn--ghost btn--md lo-back">${svgIcon('chevronLeft')}<span class="btn__label">返回</span></button></div>`
    + `<div class="lo-top__center"><span class="micro micro--mint">BONDS &amp; STRATEGIES</span>`
    + `<h1 class="lo-top__title">${svgIcon('crown', 'lo-top__icon')}盟约与策略总览</h1></div>`
    + `<div class="lo-top__right"><span class="lo-count">已收录 <b class="num">${BOND_LIST.length}</b><span class="num t-dim">/${BOND_LIST.length}</span></span></div>`
    + '</header>'
    + `<p class="lo-note">${svgIcon('info')}盟约按层数（阈值）生效，层数由场上成员数决定；策略在开局前选定，决定初始生命值与额外规则。`
    + '装了内容包后，包内盟约、干员、装备与特质与官方内容走同一条列表、同一张卡。</p>'
    + `<main class="lo-body${opts.detailOnly ? ' is-detail' : ''}">`
    + `<section class="lo-roster eq-list">${tabs()}${bondFilters()}${bondGrid()}</section>`
    + `<div class="lo-detail-wrap">${bondDetail(SEL)}</div>`
    + '</main></div>';
}
// ---- 图上的注记面板：详情列太长，一屏放不下，所以把「成员」「成员特质」「策略」三段各摆一块 ----

/** 成员段（官方 ∪ 包内干员）——[mod] alliances.js:264-269。 */
function membersBlock(showNote) {
  const members = bondMembers(SEL.bond, (id) => CHESS[id]);
  return effectSection('成员', String(members.length), `<div class="al-members">${members.map(memberRow).join('')}</div>`
    + (showNote ? '<p class="al-note">带「包」徽标的是包内干员（<code>chess_char_9_*</code>，官方 chess 里没有）；'
      + '查不到的成员 id 静默丢行；<b>陨星</b>的立绘不在 <code>assets.chars</code> 清单里 → 落名字首字字形。</p>' : ''));
}
/** 成员特质段（eventTypeIcon + eventTypeDesc + descRaw）——ui/detailPanel.js:319-329。 */
function garrisonsBlock(n, showNote) {
  const gars = [];
  for (const c of bondMembers(SEL.bond, (id) => CHESS[id])) {
    for (const gid of c.garrisonIds || []) if (GARRISONS[gid] && PACK_GARRISON_IDS.includes(gid)) gars.push({ g: GARRISONS[gid], owner: c.name });
  }
  if (!gars.length) return '';
  return effectSection('成员特质', 'GARRISONS', `<div class="al-gars">${gars.slice(0, n).map((x) => garrisonBlock(x.g, x.owner)).join('')}</div>`
    + (showNote ? '<p class="al-note"><code>eventTypeIcon</code> 缺项 → 按触发回落 <code>s_icon_bond</code>；'
      + '<code>eventTypeDesc</code> 缺项 → 留空；<code>descRaw</code> 缺项 → 回落 <code>desc</code>。</p>' : ''));
}
/** 策略段（同一入口的另一个 tab）：模式 / 初始生命值 / descRaw 文案 / 相关盟约 —— [mod] alliances.js:274-310。 */
function strategyBlock() {
  const b = SEL_BAND.band;
  const modes = (b.modeTypeList || []).map((k) => MODE_NAMES[k] || k);
  const bonds = (b.bondIds || []).map((id) => BONDS[id]).filter(Boolean);
  const ic = bandIcon(b.bandId);
  return '<section class="eq-eff" aria-label="策略">'
    + '<div class="eq-eff__head"><span class="eq-eff__k">策略 tab</span><span class="eq-eff__micro">STRATEGY</span></div>'
    + '<div class="bp__row">'
    + `<span class="bandicon bandicon--sm">${ic ? `<img src="${esc(ic)}" alt="">` : ''}</span>`
    + `<b class="bp__name">${esc(b.name)}</b>`
    + `<span class="eq-meta">初始生命值 <b class="num">${esc(b.totalHp)}</b></span>`
    + (modes.length ? `<span class="eq-meta">${esc(modes.join(' · '))}</span>` : '')
    + '</div>'
    + `<p class="eq-eff__text">${rich(b.descRaw || b.desc || '—')}</p>`
    + (bonds.length ? `<div class="al-items">${bonds.map((bd) => `<span class="al-bondchip${bd.isCore ? ' is-core' : ''}">`
      + `${esc(bd.name)}</span>`).join('')}</div>` : '')
    + '<p class="al-note">策略共 ' + BANDS.length + ' 条，同一入口的另一个 tab；这条没有 <code>unlockDesc</code> → 「解锁」整段省略。</p>'
    + '</section>';
}
/** Web：详情列下半（成员）——接在真实详情列下面，盖住的正是被滚动裁掉的那一段。 */
const drawer = () => '<div id="drawer">' + membersBlock(false) + '</div>';
/** 手机：右侧抽屉 = 详情列下半（成员 + 特质）。 */
const phoneDrawer = () => '<div id="drawer">'
  + '<div class="dw__cap"><b>详情列（下半）</b><span class="micro">MEMBERS &amp; GARRISONS</span>'
  + `<span class="dw__name">${esc(SEL.bond.name)}</span></div>`
  + membersBlock(true) + garrisonsBlock(1, false) + '</div>';
/** Web：列表下方的两块（成员特质 | 策略文案）。 */
const sidePanel = () => '<div id="bandpanel">'
  + '<div class="dw__cap"><b>详情列（末段）</b><span class="micro">GARRISONS &amp; STRATEGY</span>'
  + '<span class="dw__name">成员特质与策略文案</span></div>'
  + '<div class="dw2col">' + garrisonsBlock(1, true) + strategyBlock() + '</div>'
  + '<p class="al-note">成员表（官方成员 ∪ 包内干员）见右侧「详情列（下半）」；包内干员带「包」徽标，'
  + '查不到的成员 id 静默丢行，<b>陨星</b> 的立绘不在 <code>assets.chars</code> 清单里 → 落名字首字字形。</p>'
  + '</div>';
// ---- 真实样式表 -------------------------------------------------------------------------------------

const readCss = (...p) => readFileSync(path.join(...p), 'utf8');
const cssParts = [
  readCss(PUB, 'css/theme.css'),
  readCss(PUB, 'css/components.css'),
  readCss(PUB, 'css/devices.css'),
  readCss(PUB, 'css/screens/loadout.css'),      // .lo-* 骨架（方案 §5「样式骨架口」）
  readCss(PUB, 'css/screens/game-panels.css'),  // RichText .rt-* / .uthumb / .bandicon / .dgarrison
  readCss(PACK_DIR, 'payload/public/css/screens/equipment.css'),  // [mod] .eq-* 共用骨架，原样载入
  readCss(PACK_DIR, 'payload/public/css/screens/alliances.css'),  // [mod] .al-* 本屏块，原样载入
];
const EQ_CSS = cssParts[5];
const AL_CSS = cssParts[6];
const FONTS_CSS = readCss(PUB, 'fonts/fonts.css').replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);

// 图自己的东西（不含任何配色/间距的再设计）：① 端类与动画复位；② 图例与圆标这一层注记；
// ③ 详情列/网格的底部净空，好让最后一行不被图例条压住；④ 抽屉（手机趟）与策略面板（Web 趟）这两块注记面板。
const FIG_CSS = `
html, body { height: 100%; overflow: hidden; }
.lo { animation: none; }
/* 图例条是图自己的注记层：把它的高度从版面里让出来，网格/详情就不会钻到图例条底下 */
.lo-body { padding-bottom: calc(.22rem + var(--fig-clear, 0px)); }
.lo-grid, .eq-detail { padding-bottom: .2rem; }
/* 手机趟：列表只露左侧一条，卡片列数收成 8 列，好让两条包盟约落在「核心盟约」第 2 行左侧、不被右侧抽屉盖住 */
.fig-phone .lo-grid { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.al-pack { margin-left: auto; color: var(--gold-2); border-color: rgba(242, 189, 62, .5); }
.al-gar__owner { margin-left: .06rem; font-size: max(.11rem, 8px); color: var(--text-dim); }
.al-note { margin: .06rem 0 0; font-size: max(.12rem, 9px); line-height: 1.5; color: var(--text-dim); }
.al-note code, #fig-legend code { font-family: var(--font-mono); color: var(--mint-400); }
.eq-meta.is-pack { color: var(--gold-2); }
#drawer, #bandpanel {
  position: fixed; z-index: 118; display: flex; flex-direction: column; gap: .08rem; overflow: auto;
  padding: .1rem .12rem .12rem; background: rgba(10, 13, 12, .975);
  border: 1px solid var(--line-2); box-shadow: 0 .06rem .28rem rgba(0, 0, 0, .6);
}
.dw__cap { display: flex; align-items: center; gap: .1rem; padding-bottom: .05rem; border-bottom: 1px solid var(--line); }
.dw__cap b { font-size: max(.15rem, 10px); font-weight: 700; color: var(--mint-400); letter-spacing: .06em; }
.dw__cap .dw__name { margin-left: auto; font-size: max(.13rem, 9px); color: var(--text-lo); }
#drawer .eq-eff, #bandpanel .eq-eff { padding: .07rem .1rem .08rem; }
#drawer .al-members { grid-template-columns: repeat(auto-fill, minmax(max(1.5rem, 92px), 1fr)); }
.al-gars { display: grid; grid-template-columns: repeat(auto-fit, minmax(max(3rem, 200px), 1fr)); gap: .08rem; }
.bp__row { display: flex; align-items: center; gap: .1rem; flex-wrap: wrap; }
.bp__name { font-size: max(.22rem, 13px); font-weight: 900; letter-spacing: .06em; color: var(--text-hi); }
.dw2col { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem; align-items: start; }
#fig-legend {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 120;
  display: flex; flex-direction: column; gap: var(--lg-gap, 4px); padding: var(--lg-pad, 9px 16px 10px);
  background: rgba(8, 10, 9, .95); border-top: 1px solid var(--line-2);
  font-family: var(--font-cjk); font-size: var(--lg-fs, 12px); line-height: 1.45; color: var(--text-md);
}
#fig-legend .lg-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0 16px; }
#fig-legend .lg { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 7px; align-items: start; }
#fig-legend .lg > b {
  display: grid; place-items: center; width: 18px; height: 18px; margin-top: 1px;
  font-family: var(--font-num); font-size: 11px; font-weight: 700; color: #06110d; background: var(--mint-500);
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%);
}
#fig-legend .lg--p2 > b { background: var(--gold); color: #1a1400; }
#fig-legend .lg--p3 > b { background: var(--ice); color: #06202f; }
#fig-legend .lg--p4 > b { background: var(--amber); color: #1a1400; }
#fig-legend .lg--p5 > b { background: #c9a2ff; color: #180a2b; }
#fig-legend .lg__k { color: var(--text-hi); font-weight: 700; }
#fig-legend .lg__v { color: var(--text-lo); }
#fig-legend .lg-cap {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 5px; border-top: 1px solid var(--line); color: var(--text-lo);
}
#fig-legend .lg-cap b { color: var(--text-hi); }
#fig-legend .btn { pointer-events: none; }
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
.mk--p5 { background: #c9a2ff; color: #180a2b; }
`;
const REAL_CSS = [...cssParts, FONTS_CSS, FIG_CSS].join('\n');

// ---- 端口图例（端口名与 docs/MOD_UI_ADAPTATION_PLAN.md §5 的表一致） --------------------------------

const LEGEND = [
  ['p1', '数据段合并口 + 盟约枚举口',
    '包内 <b>卡兹戴尔 / 罗德岛</b> 与官方 23 条盟约同一条 <code>data.list(\'bonds\')</code>、同一张卡；界面不写死盟约 id / 总数 / 顺序。',
    '包内 2 条盟约与官方同一条列表、同一张卡'],
  ['p2', '核心/附加口',
    '分组只读记录上的 <code>isCore</code>（不维护「哪些是核心」的 id 清单）——两条包内盟约 <code>isCore:true</code>，自己落进「核心盟约」组。',
    '分组只读 isCore，包内核心盟约自动进「核心盟约」组'],
  ['p3', '成员查询口',
    '成员表 <code>visibleMembers ?? members</code>，查不到的 id 静默丢行；这里 = <b>官方成员 ∪ 包内干员</b>，包内干员带「包」徽标（版式与官方成员一致）。',
    '成员表 = 官方成员 ∪ 包内干员（包干员带「包」徽标）'],
  ['p4', '美术清单口',
    '包徽记/包道具 art 由 overlay 并进 <code>assets.bonds / assets.items</code>，文件落 <code>public/assets/pack/</code>；不写死 sprite 路径、不按 id 分支。',
    '包美术经 assets 覆盖 + /assets/pack/，与官方同框'],
  ['p5', '图标取数口',
    '取数按 <code>bondId</code> / <code>trapId|iconId</code> 查表，缺图回落字形 —— <b>陨星</b> 立绘不在 <code>assets.chars</code> 清单（该段不随包下发），落成名字首字「陨」。',
    '缺图回落名字字形（陨星），不当破图'],
];
const MK_N = { p1: '①', p2: '②', p3: '③', p4: '④', p5: '⑤' };
const legendHtml = (short) => {
  const items = LEGEND.map(([k, name, long, brief]) =>
    `<div class="lg lg--${k}"><b>${MK_N[k]}</b>`
    + `<div><span class="lg__k">${name}</span> <span class="lg__v">${short ? brief : long}</span></div></div>`).join('');
  const entries = '<button type="button" class="btn btn--secondary btn--sm">' + svgIcon('crown', 'btn__icon')
    + '<span class="btn__label">盟约与策略</span></button>'
    + '<span>入口 = 大厅 · 房间 · 简报（挂载点口，各在「干员调配」「查看装备」旁）</span>';
  const rest = '<b>样式骨架口</b> <code>.lo-* / .eq-*</code> 复用同一骨架；'
    + '<b>阶/层号口</b> 层号 ≤6 用八角 sprite、&gt;6 写 +N；'
    + '<b>枚举可缺项口</b> 缺项落原始值或省略（远见 <code>countMode=BOARD_AND_DECK</code> 原样印出、调和 <code>MANI</code> 无阶段标签）；'
    + '<b>giveBondBiasOnly 口</b> biasOnly 装备只标「仅归类」、不算盟约成员。';
  return `<div class="lg-grid">${items}</div>`
    + `<div class="lg-cap"><b>入口（挂载点口）</b>${entries}</div>`
    + (short ? '' : `<div class="lg-cap">${rest}</div>`);
};

// ---- 页面 -------------------------------------------------------------------------------------------

const htmlFor = (p) => `<!doctype html><html lang="zh-CN" class="${p.cls}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">
<title>alliances codex</title>
<style>:root{--mk-s:${p.mk}px;--lg-fs:${p.lg}px;--lg-gap:${p.legend === 'short' ? '3px' : '5px'};--lg-pad:${p.legend === 'short' ? '5px 10px 6px' : '9px 16px 10px'}}</style>
<style>${REAL_CSS}</style></head>
<body class="${(p.figClass || '').trim()}"><div id="app-root">${screen(p)}</div>
${p.panels()}
<div id="mk-layer"></div><div id="fig-legend">${legendHtml(p.legend === 'short')}</div></body></html>`;

const TMP = path.join(HERE, '.alliances-tmp');
mkdirSync(TMP, { recursive: true });

const waitImages = (page) => page.evaluate(() => Promise.all(Array.from(document.images)
  .map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));

// 图上的注记：图例条先落位量高度 → 给网格/详情留净空 → 量圆标落点（全部由真实 DOM 的 getBoundingClientRect 推出）。
const ANCHOR = {
  tl: (r) => [r.left, r.top], tr: (r) => [r.right, r.top],
  bl: (r) => [r.left, r.bottom], br: (r) => [r.right, r.bottom],
  lm: (r) => [r.left, r.top + r.height / 2], rm: (r) => [r.right, r.top + r.height / 2],
};
const G1 = '.lo-grid .al-card[data-bond="kazdelShip"]';
const G2 = '.lo-grid .al-group';
const DISC = '.eq-detail__art';
const D_MEMB = '#drawer .al-members .al-member[data-chess="chess_char_9_09_a"]';
const D_FALL = '#drawer .al-members .al-member[data-chess="chess_char_9_02_a"]';
const D_GAR = '#drawer .eq-eff[aria-label="成员特质"]';
const MARKERS_WEB = [
  ['p1', '①', G1, 'tl', -6, -6],
  ['p2', '②', G2, 'lm', 12, 0],
  ['p3', '③', D_MEMB, 'rm', 12, 0],
  ['p4', '④', DISC, 'tr', 10, -6],
  ['p5', '⑤', D_FALL, 'rm', 12, 0],
];
const MARKERS_PHONE = [
  ['p1', '①', G1, 'tl', -6, -6],
  ['p2', '②', G2, 'lm', 10, 0],
  ['p3', '③', D_MEMB, 'rm', 10, 0],
  ['p4', '④', D_FALL, 'rm', 10, 0],
  ['p5', '⑤', D_GAR, 'tr', 8, -6],
];

async function decorate(page, markers) {
  return page.evaluate((markers) => {
    const ANCHOR = {
      tl: (r) => [r.left, r.top], tr: (r) => [r.right, r.top],
      bl: (r) => [r.left, r.bottom], br: (r) => [r.right, r.bottom],
      lm: (r) => [r.left, r.top + r.height / 2], rm: (r) => [r.right, r.top + r.height / 2],
    };
    const legend = document.getElementById('fig-legend');
    document.documentElement.style.setProperty('--fig-clear', `${Math.round(legend.getBoundingClientRect().height) + 6}px`);
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
      const pad = 40;
      placed.push({
        key, n, sel, rect: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) },
        inside: x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad,
      });
    }
    return {
      placed, legendH: Math.round(legend.getBoundingClientRect().height),
      htmlClass: document.documentElement.className,
      lgFs: getComputedStyle(legend).fontSize,
      lgRows: [...legend.querySelectorAll('.lg')].map((e) => Math.round(e.getBoundingClientRect().height)),
    };
  }, markers);
}

const AUDIT = (page) => page.evaluate(() => {
  const S = '.lo ';
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) }; };
  const box = (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
  const vis = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : !!e.offsetParent);
  const cards = [...document.querySelectorAll(S + '.al-card[data-bond]')];
  const zero = [...document.querySelectorAll(`${S}.al-card, ${S}.lo-chip, ${S}.al-group, ${S}.eq-bond, ${S}.eq-detail__art, ${S}.eq-eff, ${S}.al-layerrow, ${S}.al-member, ${S}.al-layer, #drawer .al-member, #drawer .dgarrison, #bandpanel .eq-eff`)]
    .filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && (r.width < 1 || r.height < 1); }).length;
  const clipped = [...document.querySelectorAll(`${S}.eq-detail__name, ${S}.al-group__k, ${S}.eq-eff__k, ${S}.al-member__name, ${S}.lo-card__name, #drawer .al-member__name`)]
    .filter((e) => getComputedStyle(e).textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 1)
    .map((e) => (e.textContent || '').trim().slice(0, 10));
  const detail = document.querySelector(S + '.eq-detail');
  const grid = document.querySelector(S + '.lo-grid');
  const drawer = document.getElementById('drawer');
  const bandpanel = document.getElementById('bandpanel');
  const scope = drawer || document.querySelector(S + '.lo-detail-wrap') || document;
  const members = [...scope.querySelectorAll('.al-members .al-member')];
  const panels = [drawer, bandpanel].filter(Boolean).map((p) => ({ id: p.id, ...rect(p) }));
  const overlap = (a, b) => !(a.r <= b.x || a.x >= b.r || a.b <= b.y || a.y >= b.b);
  const packCards = cards.filter((c) => c.dataset.pack === '1').map((c) => ({ id: c.dataset.bond, ...rect(c) }));
  const inViewport = (r) => r.b >= 0 && r.y <= innerHeight && r.r >= 0 && r.x <= innerWidth;
  return {
    bonds: cards.length,
    packBonds: document.querySelectorAll(S + '.al-card[data-pack="1"]').length,
    packBondsShown: packCards.filter(inViewport).length,
    groups: document.querySelectorAll(S + '.al-group').length,
    tabs: document.querySelectorAll(S + '.al-tab').length,
    filters: box(document.querySelector(S + '.lo-filters')),
    grid: box(grid),
    gridBox: grid ? rect(grid) : null,
    detailW: detail ? Math.round(detail.getBoundingClientRect().width) : 0,
    detailScroll: detail ? detail.scrollHeight - detail.clientHeight : null,
    layers: document.querySelectorAll(S + '.al-layerrow').length,
    layerChips: document.querySelectorAll(S + '.al-layer').length,
    members: members.length,
    packMembers: members.filter((m) => m.dataset.pack === '1').length,
    fallbackMembers: members.filter((m) => m.dataset.avatar === 'fallback').map((m) => m.dataset.chess),
    memberGlyphs: [...scope.querySelectorAll('.al-member .uthumb__glyph')].map((e) => e.textContent),
    packBadges: scope.querySelectorAll('.al-pack').length,
    equipChips: document.querySelectorAll(S + '.al-item').length,
    packEquip: document.querySelectorAll(S + '.al-item[data-pack="1"]').length,
    // 特质块可能落在详情列抽屉（手机）或策略面板（Web）里 —— 两处都算
    garrisons: document.querySelectorAll('#drawer .dgarrison, #bandpanel .dgarrison').length,
    garrisonIcons: [...document.querySelectorAll('#drawer .dgarrison__icon, #bandpanel .dgarrison__icon')].map((e) => e.tagName),
    garrisonTypes: [...document.querySelectorAll('#drawer .dgarrison__type, #bandpanel .dgarrison__type')].map((e) => (e.textContent || '').trim()),
    richSpans: document.querySelectorAll(`${S}.rt-vup, ${S}.rt-vdown, ${S}.rt-mint, ${S}.rt-note, #drawer .rt-vup, #drawer .rt-vdown, #drawer .rt-mint`).length,
    bandPanel: !!bandpanel,
    bandChips: document.querySelectorAll('#bandpanel .al-bondchip').length,
    panels,
    packCards,
    // 注记面板不许盖住包盟约卡（两条包盟约是这张图的主角）
    packCovered: packCards.filter((c) => panels.some((p) => overlap(c, p))).map((c) => c.id),
    // 底部图例条也不许压住包盟约卡（手机趟网格只露 1.5 行，正是靠上滚把这两张顶上来）
    legendTopNow: Math.round(document.getElementById('fig-legend').getBoundingClientRect().top),
    packCardsUnderLegend: packCards.filter((c) => c.b > Math.round(document.getElementById('fig-legend').getBoundingClientRect().top)).map((c) => c.id),
    // 成员缩略图必须真的画出来：框非零 + 要么有立绘 img、要么有名字字形兜底
    thumbArts: [...scope.querySelectorAll('.al-member .uthumb__art')].map((e) => {
      const r = e.getBoundingClientRect();
      const img = e.querySelector('img');
      const gl = e.querySelector('.uthumb__glyph');
      return { w: Math.round(r.width), h: Math.round(r.height), img: img ? (img.complete && img.naturalWidth > 0) : false, glyph: gl ? gl.textContent : null };
    }),
    // 面板自己不许把内容裁掉（成员表 / 特质段都要看得见）
    panelOverflow: [drawer, bandpanel].filter(Boolean).map((p) => ({ id: p.id, over: p.scrollHeight - p.clientHeight })),
    panelKids: [drawer, bandpanel].filter(Boolean).map((p) => `#${p.id}[`
      + [...p.children].map((c) => `${(c.className || c.tagName).split(' ')[0]}=${Math.round(c.getBoundingClientRect().height)}`).join(',')
      + ']'),
    lastGarrisonBottom: (() => {
      const gs = [...scope.querySelectorAll('.dgarrison')];
      return gs.length ? Math.round(gs[gs.length - 1].getBoundingClientRect().bottom) : null;
    })(),
    lastMemberBottom: (() => {
      const ms = [...scope.querySelectorAll('.al-member')];
      return ms.length ? Math.round(ms[ms.length - 1].getBoundingClientRect().bottom) : null;
    })(),
    // 真实详情列里各段的底边（看注记面板到底盖住了哪一段）
    detailSections: [...document.querySelectorAll(S + '.eq-detail > .eq-eff, ' + S + '.eq-detail > .eq-detail__head')]
      .map((e) => `${e.getAttribute('aria-label') || 'head'}:${Math.round(e.getBoundingClientRect().top)}..${Math.round(e.getBoundingClientRect().bottom)}`),
    // 图例条与网格/详情盒子的关系（几何，不看被滚动裁掉的卡）
    gridBottom: grid ? Math.round(grid.getBoundingClientRect().bottom) : null,
    legendTop: Math.round(document.getElementById('fig-legend').getBoundingClientRect().top),
    offPage: ['.lo-top__left', '.lo-top__center', '.lo-top__right', '.lo-count', '.lo-back', '.lo-filters', '.lo-grid', '.al-tabs', '.eq-detail', '#fig-legend']
      .map((sel) => {
        const e = document.querySelector(sel);
        if (!e) return `${sel}:MISS`;
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) ? `${sel}:${Math.round(r.left)}..${Math.round(r.right)}` : null;
      }).filter(Boolean),
    // 包盟约卡 / 徽记 的几何（交给 Node 侧在 PNG 上量墨）
    packArt: cards.filter((c) => c.dataset.pack === '1').map((c) => {
      const r = c.querySelector('.lo-card__art').getBoundingClientRect();
      return { id: c.dataset.bond, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((g) => g.y >= 0 && g.y + g.h <= innerHeight && g.x >= 0 && g.x + g.w <= innerWidth),
    discArt: (() => {
      const e = document.querySelector(S + '.eq-detail__art');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    visibleCards: cards
      .map((c) => ({ id: c.dataset.bond, pack: c.dataset.pack, ...rect(c) }))
      .filter((c) => c.b >= 0 && c.y <= innerHeight && c.r >= 0 && c.x <= innerWidth && !panels.some((p) => overlap(c, p)))
      .map((c) => `${c.pack === '1' ? '★' : ''}${c.id}`),
    zero, clipped,
  };
});

// ---- 渲染 -------------------------------------------------------------------------------------------

const PASSES = [
  {
    id: 'web', file: 'mod-ui-alliances-web.png', width: 1920, height: 1080, mobile: false,
    cls: 'sp-hover sp-fs', figClass: '', legend: 'long', mk: 22, lg: 12, markers: MARKERS_WEB,
    panels: () => drawer() + sidePanel(),
  },
  {
    // 安卓横屏 844×390：真实的两列布局（列表 592px + 详情 231px）。窄屏里详情列放不下成员表，
    // 所以图上把「详情列下半」摆成右侧抽屉（`.lo-body.is-detail` 的等价物，见 README「窄屏断点」那条），
    // 抽屉盖住详情列与列表右侧，左侧列表仍露出「核心盟约」第 2 行（两条包盟约所在行）。
    id: 'phone', file: 'mod-ui-alliances-phone.png', width: 844, height: 390, mobile: true,
    cls: 'sp-touch sp-coarse sp-no-hover', figClass: ' fig-phone', legend: 'short', mk: 16, lg: 9, markers: MARKERS_PHONE,
    panels: () => phoneDrawer(),
  },
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
      document.documentElement.style.setProperty('--lg-gap', v.gap);
    }, { mk: `${p.mk}px`, lg: `${p.lg}px`, pad: p.legend === 'short' ? '5px 10px 6px' : '9px 16px 10px', gap: p.legend === 'short' ? '3px' : '5px' });
    await page.goto(furl(html), { waitUntil: 'load' });
    await waitImages(page);
    await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // 图里的注记层先落位（面板的位置/尺寸由真实 DOM 推）
    // Web：成员/特质面板压在详情列下半（那里本来就是被滚动裁掉的段落），策略面板压在列表下方；
    // 手机：成员/特质面板摆成右侧抽屉，盖住窄屏详情列与列表右侧，左侧列表仍露两条包盟约。
    await page.evaluate((id) => {
      const legend = document.getElementById('fig-legend');
      const lh = legend.getBoundingClientRect().height;
      const top = document.querySelector('.lo-top').getBoundingClientRect().bottom;
      const dw = document.getElementById('drawer');
      const bp = document.getElementById('bandpanel');
      const roster = document.querySelector('.lo-roster').getBoundingClientRect();
      const detail = document.querySelector('.lo-detail-wrap').getBoundingClientRect();
      if (dw) {
        if (id === 'phone') {
          const w = Math.round(Math.min(innerWidth * 0.68, 580));
          dw.style.width = `${w}px`;
          dw.style.right = '10px';
          dw.style.top = `${Math.round(top + 4)}px`;
          dw.style.bottom = `${Math.round(lh + 8)}px`;
        } else {
          dw.style.left = `${Math.round(detail.left)}px`;
          dw.style.width = `${Math.round(detail.width)}px`;
          dw.style.bottom = `${Math.round(lh + 8)}px`;
        }
      }
      if (bp) {
        // 面板摆在「罗德岛」卡的右侧：横向起点 = 罗德岛卡右缘 + 10，绝不盖住两条包盟约卡
        const rhodes = document.querySelector('.lo-grid .al-card[data-bond="rhodesShip"]');
        const rr = rhodes ? rhodes.getBoundingClientRect() : null;
        const left = Math.round(rr ? Math.max(roster.left, rr.right + 10) : roster.left);
        bp.style.left = `${left}px`;
        bp.style.width = `${Math.round(roster.right - left)}px`;
        bp.style.bottom = `${Math.round(lh + 8)}px`;
      }
    }, p.id);
    // 手机趟：网格只露 1.5 行，两条包盟约卡（核心组第 9/10 张）会落到第 2 行、被底部图例条压住。
    // 把网格上滚到「两条包盟约卡整体露在网格框内」，这样徽记与卡名都看得见（官方卡名的下半行仍可见）。
    if (p.id === 'phone') {
      // 先落定 --fig-clear（图例条高度），否则网格会在 decorate 之后才缩短，滚动量就算错了
      await page.evaluate(() => {
        const legend = document.getElementById('fig-legend');
        document.documentElement.style.setProperty('--fig-clear', `${Math.round(legend.getBoundingClientRect().height) + 6}px`);
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const sc = await page.evaluate(() => {
        const grid = document.querySelector('.lo .lo-grid');
        if (!grid) return { err: 'no grid' };
        const before = grid.scrollTop;
        const cards = [...grid.querySelectorAll('.al-card[data-pack="1"]')];
        const g = grid.getBoundingClientRect();
        const bottom = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
        const need = bottom - (g.bottom - 6);
        if (need > 0) grid.scrollTop += need;
        return { before, after: grid.scrollTop, need, clientH: grid.clientHeight, scrollH: grid.scrollHeight, overflowY: getComputedStyle(grid).overflowY, cards: cards.length };
      });
      console.log('[phone scroll]', JSON.stringify(sc));
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const marks = await decorate(page, p.markers);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const audit = await AUDIT(page);
    const broken = await page.evaluate(() => Array.from(document.querySelectorAll('.lo img, #drawer img, #bandpanel img')).filter((i) => !i.complete || i.naturalWidth === 0).length);
    const rem = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const fonts = await page.evaluate(() => ({
      loaded: [...new Set(Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family))].sort(),
      noto: document.fonts.check('16px "Noto Sans SC"'),
      bender: document.fonts.check('16px "Bender"'),
      novecento: document.fonts.check('16px "Novecento Wide"'),
    }));
    await page.screenshot({ path: path.join(HERE, p.file), clip: { x: 0, y: 0, width: p.width, height: p.height } });
    results.push({ ...p, audit, broken, rem, fonts, marks });
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
console.log(`          + [mod] payload/public/css/screens/equipment.css（.eq-* 共用骨架，${EQ_CSS.length} 字符）`
  + ` + payload/public/css/screens/alliances.css（.al-* 本屏块，${AL_CSS.length} 字符），均原样载入`);
console.log(` 端类/尺寸: ${PASSES.map((p) => `${p.id}=${p.cls}${p.figClass} ${p.width}x${p.height}`).join(' | ')}`);
console.log(` 数据: 官方 bonds ${Object.keys(OFFICIAL_BONDS).length} / chess ${Object.keys(OFFICIAL_CHESS).length} / items ${Object.keys(OFFICIAL_ITEMS).length}`
  + ` / garrisons ${Object.keys(OFFICIAL_GARRISONS).length} / bands ${Object.keys(OFFICIAL_BANDS).length}`
  + `  + 包 bonds ${Object.keys(RECORDS.bonds).length}(新增 ${PACK_BOND_IDS.length}) / items ${PACK_ITEM_IDS.length} / garrisons ${PACK_GARRISON_IDS.length} / chess ${Object.keys(PACK_CHESS).length}(新增 ${PACK_CHESS_IDS.length})`);
console.log(` 合并后: 盟约 ${BOND_LIST.length}（核心 ${CORE.length} / 附加 ${ADD.length}） | 策略 ${BANDS.length} | 棋子 ${Object.keys(CHESS).length}`
  + ` | 包新增盟约 ${PACK_BOND_IDS.join('/')} | 包新增干员 ${PACK_CHESS_IDS.length} 条`);
console.log(` 选中: ${SEL.bond.name}(${SEL.bond.bondId}) isCore ${!!SEL.bond.isCore} 阈值 ${JSON.stringify(SEL.bond.thresholds)} 层 ${bondLayers(SEL.bond).length}`
  + ` | 成员 ${bondMembers(SEL.bond, (id) => CHESS[id]).length}（官方 ${bondMembers(SEL.bond, (id) => CHESS[id]).filter((c) => !isPackChess(c.chessId)).length}`
  + ` / 包 ${bondMembers(SEL.bond, (id) => CHESS[id]).filter((c) => isPackChess(c.chessId)).length}）`
  + ` | 相关装备 ${bondEquipment(SEL.bond.bondId, Object.values(ITEMS)).length} 件（全为包内件）`);
console.log(` 美术未解析（走字形兜底，不是破图）: ${[...new Set(unresolved)].slice(0, 8).join(', ') || 'none'}`
  + `（共 ${new Set(unresolved).size} 个键）`);
const noAvatar = bondMembers(SEL.bond, (id) => CHESS[id]).filter((c) => !chessAvatar(c)).map((c) => c.name);
console.log(` 成员缺立绘（assets.chars 段不随包下发）: ${noAvatar.join(' / ') || 'none'} → UnitThumb 落名字字形`);
for (const r of results) {
  const a = r.audit;
  console.log(` [${r.id}] rem=${r.rem} 字体 Noto=${r.fonts.noto} Bender=${r.fonts.bender} Novecento=${r.fonts.novecento} | 破图 ${r.broken}`);
  console.log(`       盟约卡 ${a.bonds}（包 ${a.packBonds}，视口内包 ${a.packBondsShown}）| 分组 ${a.groups} | tab ${a.tabs}`
    + ` | 筛选 ${a.filters} 网格 ${a.grid} | 详情宽 ${a.detailW} 滚动余量 ${a.detailScroll}`);
  console.log(`       层 ${a.layers}(chip ${a.layerChips}) | 成员 ${a.members}（包 ${a.packMembers}，缺图 ${a.fallbackMembers.length}，字形「${a.memberGlyphs.join('')}」）`
    + ` | 包徽标 ${a.packBadges} | 相关装备 ${a.equipChips}(包 ${a.packEquip}) | 特质 ${a.garrisons}（类型 ${a.garrisonTypes.join('/')}）| 富文本段 ${a.richSpans}`);
  console.log(`       策略面板 ${a.bandPanel}（相关盟约 chip ${a.bandChips}）| 塌陷 ${a.zero} | 文字裁切 ${a.clipped.length ? a.clipped.join('/') : '无'}`);
  console.log(`       注记面板 ${a.panels.map((p) => `#${p.id} ${p.w}x${p.h}@${p.x},${p.y}`).join(' | ') || 'none'}`
    + ` → 盖住包盟约卡 ${a.packCovered.length ? a.packCovered.join('/') : 'none'}`);
  console.log(`       包盟约卡: ${a.packCards.map((c) => `${c.id}@${c.x},${c.y}..${c.b}`).join(' ')} | 图例 top=${a.legendTopNow}`
    + ` → 被图例压住 ${a.packCardsUnderLegend.length ? a.packCardsUnderLegend.join('/') : 'none'}`);
  console.log(`       成员缩略图 ${a.thumbArts.length} 个: ${a.thumbArts.map((t) => `${t.w}x${t.h}${t.img ? '·立绘' : ''}${t.glyph ? `·字形「${t.glyph}」` : ''}`).join(' ')}`);
  const dpan = a.panels.find((p) => p.id === 'drawer');
  console.log(`       面板裁切: ${a.panelOverflow.map((p) => `#${p.id} 溢出${p.over}px`).join(' | ') || 'none'}`
    + ` | 成员末行底 ${a.lastMemberBottom} / 特质末段底 ${a.lastGarrisonBottom} vs 面板底 ${dpan ? dpan.b : '-'}`);
  console.log(`       详情列各段(y): ${a.detailSections.join(' | ')}`);
  console.log(`       面板构成: ${a.panelKids.join(' ')}`);
  console.log(`       圆标落点: ${r.marks.placed.map((m) => `${m.n}@${m.rect ? `${m.rect.x},${m.rect.y}` : 'MISS'}${m.inside === false ? ':OUT' : ''}`).join(' ')}`
    + ` | 图例 ${r.marks.legendH}px(${r.marks.lgFs}) 条目 ${r.marks.lgRows.join('/')} | html.${r.marks.htmlClass}`);
  if (r.broken) problems.push(`${r.id}: 破图 ${r.broken}`);
  if (a.zero) problems.push(`${r.id}: 塌陷 ${a.zero}`);
  if (r.marks.placed.some((m) => !m.rect || m.inside === false)) problems.push(`${r.id}: 圆标未落在目标上`);
  if (!r.fonts.noto || !r.fonts.bender || !r.fonts.novecento) problems.push(`${r.id}: 字体未全加载`);
  if (a.packBonds !== PACK_BOND_IDS.length) problems.push(`${r.id}: 列表里的包盟约卡 ${a.packBonds} ≠ ${PACK_BOND_IDS.length}`);
  if (!a.packBondsShown) problems.push(`${r.id}: 视口内看不到包盟约卡`);
  if (a.packMembers < 1) problems.push(`${r.id}: 成员表里没有包内干员`);
  if (!a.fallbackMembers.length) problems.push(`${r.id}: 没有出现缺图兜底（头像字形）`);
  if (!a.garrisons) problems.push(`${r.id}: 没有特质块（eventTypeIcon/eventTypeDesc/descRaw）`);
  if (!a.richSpans) problems.push(`${r.id}: 没有富文本（descRaw）着色段`);
  const s = pngSize(r.file);
  const png = decodePng(readFileSync(path.join(HERE, r.file)));
  const bands = bandsOf(png);
  console.log(`       ${r.file}: ${s.w}x${s.h}, ${s.kb} KB | 10 条带墨量 ${bands.join(' ')} min=${Math.min(...bands)}`);
  // 包美术真的画出来了（卡面/徽记区域有内容），且图例条没有压住关键内容
  const artInk = [...a.packArt, ...(a.discArt ? [{ id: '详情徽记', ...a.discArt }] : [])]
    .map((g) => `${String(g.id).slice(-14)} ${g.w}x${g.h}@${g.x},${g.y} 墨${inkOfRect(png, g.x, g.y, g.x + g.w, g.y + g.h)}`);
  console.log(`       包美术墨量: ${artInk.join(' | ') || '（无落在视口内的包卡）'}`);
  const covered = a.gridBottom != null && a.gridBottom > a.legendTop;
  console.log(`       图例条 top=${a.legendTop} | 网格底边=${a.gridBottom} → ${covered ? '压住了网格' : '未压住网格/详情'}`);
  console.log(`       视口内盟约卡 ${a.visibleCards.length}（★=包内，已扣除被注记面板盖住的）: ${a.visibleCards.join(' ')}`);
  if (a.offPage.length) problems.push(`${r.id}: 出界 ${a.offPage.join(' ')}`);
  if (a.packCovered.length) problems.push(`${r.id}: 注记面板盖住了包盟约卡 ${a.packCovered.join('/')}`);
  if (a.packCardsUnderLegend.length) problems.push(`${r.id}: 图例条压住了包盟约卡 ${a.packCardsUnderLegend.join('/')}`);
  if (a.thumbArts.some((t) => t.w < 1 || t.h < 1)) problems.push(`${r.id}: 成员缩略图框塌陷`);
  if (a.thumbArts.some((t) => !t.img && !t.glyph)) problems.push(`${r.id}: 成员缩略图既无立绘也无字形`);
  if (a.panelOverflow.some((p) => p.over > 2)) problems.push(`${r.id}: 注记面板内容被裁 ${a.panelOverflow.map((p) => `#${p.id}:${p.over}`).join(',')}`);
  if (dpan && a.lastGarrisonBottom != null && a.lastGarrisonBottom > dpan.b + 1) problems.push(`${r.id}: 特质段落到面板外（${a.lastGarrisonBottom} > ${dpan.b}）`);
  if (dpan && a.lastMemberBottom != null && a.lastMemberBottom > dpan.b + 1) problems.push(`${r.id}: 成员行落到面板外（${a.lastMemberBottom} > ${dpan.b}）`);
  if (a.packArt.some((g) => inkOfRect(png, g.x, g.y, g.x + g.w, g.y + g.h) < 0.03)) problems.push(`${r.id}: 包盟约卡面疑似空白`);
  if (a.discArt && inkOfRect(png, a.discArt.x, a.discArt.y, a.discArt.x + a.discArt.w, a.discArt.y + a.discArt.h) < 0.05) problems.push(`${r.id}: 详情徽记疑似空白`);
  if (covered) problems.push(`${r.id}: 图例条压住了网格`);
  if (s.w !== r.width || s.h !== r.height) problems.push(`${r.file} 尺寸 ${s.w}x${s.h} ≠ ${r.width}x${r.height}`);
  if (bands.some((v) => v === 0)) problems.push(`${r.file}: 存在空条带`);
}
console.log(problems.length ? `\n ${problems.length} 项未通过：\n  - ${problems.join('\n  - ')}` : '\n 全部通过');
console.log(' 注意：几何与像素证据不能替代审美判断，仍建议人工过目一眼。');

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
process.exitCode = problems.length ? 1 : 0;
