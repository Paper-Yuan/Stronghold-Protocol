// docs/mockups/render-fusion-dual-platform.mjs — 融合参考图 · 实装后 UI × 双端适配（含皮肤选择）
//
// 风格基线 = **游戏自己的样式表**，不是另起一套设计稿。上游 v0.2.2 的
//   theme.css / components.css / devices.css / screens/loadout.css / screens/game-panels.css / screens/game-shop.css
// 原样载入（`git show upstream/master:public/css/...`，取不到就退回本地同名文件），再追加本地独有的「皮肤选择」块
// （本地 loadout.css 的 .lo-skins / .lo-skin*），合并后的干员调配屏因此与游戏内渲染同源：同一套令牌、同一套字体
// （Bender / Novecento Wide + Noto Sans SC）、同一套边框与角标。
//
// 版面同样取自真实源码，不是臆造：
//   上游 v0.2.2  js/screens/loadout.js  —— 一干员一行（.lo-list/.lo-card 网格）、潜能·练度（.lo-cult）、详情卡分段
//                js/screens/cultivation.js —— CultivationSelects / CultivationSection
//   本地        js/ui/skinPicker.js     —— <SkinSection> → .lo-skins 单列列表（不是网格）
//   数据        data/{chess,assets,bonds,effects}.json —— 真实干员 / 技能 / 立绘 / 盟约 / 练度文案
//
// 渲染分三趟：① Web 1920×1080（dsf 2）② 安卓 844×390 触摸（dsf 2，sp-touch/sp-coarse/sp-no-hover）③ 合成参考图。
// 尺寸与断点由真实 CSS 决定（根字号 = min(100vw/19.2, 100svh/10.8)，Web 端 1rem = 100px，安卓横屏 1rem = 40px）。
//
// 用法：node docs/mockups/render-fusion-dual-platform.mjs   （Windows 自动探测 Chrome；或设置 CHROME_PATH）
// 产物：docs/mockups/fusion-dual-platform.png（总览）
//       docs/mockups/fusion-1-loadout.png / fusion-2-skin-dual.png / fusion-3-devices.png / fusion-4-matrix.png
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUB = path.join(ROOT, 'public');
const UPSTREAM = 'upstream/master';
const furl = (p) => pathToFileURL(p).href;
const pubUrl = (p) => (p ? furl(path.join(PUB, String(p).replace(/^\/+/, ''))) : null);

if (!process.env.CHROME_PATH) {
  const hit = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;

// ---- 真实数据 ---------------------------------------------------------------------------------------

const readJson = (rel) => JSON.parse(readFileSync(path.join(PUB, 'data', rel), 'utf8'));
const CHESS_ALL = Object.values(readJson('chess.json')).filter((c) => c && c.chessId);
const ASSETS = readJson('assets.json');
const BONDS = Object.values(readJson('bonds.json')).filter((b) => b && b.bondId);
const EFFECTS = Object.values(readJson('effects.json')).filter((e) => e && e.effectId);
const LOCAL = readJson('local-assets.json');

const VISIBLE = CHESS_ALL.filter((c) => c.visible !== false && !c.isHidden && !c.isDiy);
const find = (charId, golden = false) => VISIBLE.find((c) => c.charId === charId && !!c.isGolden === golden);
const bondOf = (id) => BONDS.find((b) => b.bondId === id);
const effectOf = (id) => EFFECTS.find((e) => e.effectId === id);
const localAsset = (group, name) => LOCAL.groups?.[group]?.[name]?.path || null;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const img = (src, cls = '', alt = '') => (src ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(alt)}">` : '');
/** RichText 的简化替身：官方标记 <@ba.vup>x</> → 上色，其余标记剥掉。 */
const rich = (text) => esc(text || '')
  .replace(/&lt;@(?:ba|autochess)\.(?:vup|dgreen|talpu)&gt;([\s\S]*?)&lt;\/&gt;/g, '<b class="t-mint">$1</b>')
  .replace(/&lt;@(?:ba|autochess)\.(?:kw|acrem)&gt;([\s\S]*?)&lt;\/&gt;/g, '<b class="t-gold">$1</b>')
  .replace(/&lt;@(?:ba|autochess)\.[a-z]+&gt;/g, '')
  .replace(/&lt;\/&gt;/g, '')
  .replace(/&lt;[^&]*?&gt;/g, '');
const plain = (text) => String(text || '').replace(/<[^>]*>/g, '');

const tierChip = (t) => pubUrl(ASSETS.ui?.[`shopCard/img_chess_level_${t}`]) || pubUrl(localAsset('ui/battle', `img_chess_level_${t}`));
const tierHtml = (t, size) => `<span class="tier tier--${t} tier--${size} tier--img"><img src="${esc(tierChip(t))}" alt=""></span>`;
const UI = {
  preset: pubUrl(localAsset('ui/outer', 'operator_preset')),
  outline: pubUrl(localAsset('ui/outer', 'image_skill_select_outline')),
  deco: pubUrl(localAsset('ui/outer', 'skill_select_deco')),
  equipNone: pubUrl(localAsset('ui/outer', 'icon_equip_non')),
};

// ---- 干员名单（真实记录：名称 / 职业 / 盟约 / 技能 / 立绘全部来自 data） --------------------------------

const ROSTER_SPEC = ['char_498_inside', 'char_199_yak', 'char_306_leizi', 'char_103_angel', 'char_263_skadi', 'char_1032_excu2', 'char_4193_lemuen'];
const SEL_CHAR = 'char_103_angel';

const AUTO = VISIBLE.filter((c) => !c.isGolden && ASSETS.chars?.[c.charId]?.avatar && (c.skills || []).length === 3);
const roster = [];
for (const charId of ROSTER_SPEC) {
  const c = find(charId) || AUTO.find((x) => x.charId === charId);
  if (c) roster.push(c);
}
for (const c of AUTO) {
  if (roster.length >= 8) break;
  if (!roster.some((r) => r.charId === c.charId)) roster.push(c);
}

const POTENTIALS = [1, 2, 3, 4, 5, 6];
const CULT = ['aceffect_char_1', 'aceffect_char_2', 'aceffect_char_3', 'aceffect_char_4'];
const CULT_SHORT = ['未精英化', '精英1', '精英2', '精英2 Lv.60'];
const cultName = (i) => effectOf(CULT[i])?.name || CULT_SHORT[i];
const cultDesc = (i) => effectOf(CULT[i])?.desc || '';

const SEL = find(SEL_CHAR) || roster.find((c) => c.charId === SEL_CHAR) || roster[0];
const SEL_GOLDEN = SEL.goldenId ? CHESS_ALL.find((c) => c.chessId === SEL.goldenId) : null;
const SEL_SKINS = Object.entries(ASSETS.chars?.[SEL.charId]?.skins || {}).map(([id, s]) => ({ id, ...s }));
const SKIN_EQUIPPED = SEL_SKINS.find((s) => s.id.includes('wild')) || SEL_SKINS[0] || null;

// 每行的展示状态：选中 / 已调整 / 未持有（替补）
const ROW_STATE = {
  [SEL.chessId]: { sel: true, skill: 1 },                       // 能天使：改了技能（S2）→ 已调整
  [find('char_263_skadi')?.chessId]: { potential: 3 },           // 斯卡蒂：改了潜能 → 已调整
  [roster[roster.length - 1].chessId]: { standin: true },        // 最后一行：干员持有里标了未持有
};

const avatarOf = (c) => pubUrl(ASSETS.chars?.[c.charId]?.avatar);
const portraitOf = (c) => {
  const a = c.assets || {};
  const base = ASSETS.chars?.[c.charId];
  const key = a.portrait;
  if (key && key.endsWith('_2') && ASSETS.chars?.[key.slice(0, -2)]) return pubUrl(ASSETS.chars[key.slice(0, -2)].portraitE2 || base?.portrait);
  if (key && key.endsWith('_1') && ASSETS.chars?.[key.slice(0, -2)]) return pubUrl(ASSETS.chars[key.slice(0, -2)].portrait);
  return pubUrl(base?.portrait);
};
const profGlyph = (prof) => pubUrl(ASSETS.prof?.large?.[String(prof || '').toLowerCase()]);
const subProfIcon = (c) => {
  const raw = c.assets?.subProfIcon;
  const id = raw ? raw.replace(/^sub_/, '').replace(/_icon$/, '') : c.subProfessionId;
  return pubUrl(ASSETS.prof?.sub?.[id]);
};
const bondIcon = (id) => pubUrl(ASSETS.bonds?.[id]);
const skillIcon = (rec) => pubUrl(ASSETS.skills?.[rec?.iconId || rec?.skillId] || ASSETS.skills?.[rec?.prefabId]);

// ---- 真实样式表 -------------------------------------------------------------------------------------

function gitShow(rel) {
  try { return execFileSync('git', ['show', `${UPSTREAM}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch { return null; }
}
const CSS_FILES = [
  'public/css/theme.css', 'public/css/components.css', 'public/css/devices.css',
  'public/css/screens/loadout.css', 'public/css/screens/game-panels.css', 'public/css/screens/game-shop.css',
];
const cssParts = [];
let cssFromUpstream = true;
for (const rel of CSS_FILES) {
  const up = gitShow(rel);
  if (up) cssParts.push(up);
  else { cssFromUpstream = false; cssParts.push(readFileSync(path.join(ROOT, rel), 'utf8')); }
}
// 本地独有的「皮肤选择」块：从本地 loadout.css 里整段取出，追加到上游 loadout.css 之后 —— 这就是合并动作本身。
const localLoadout = readFileSync(path.join(PUB, 'css/screens/loadout.css'), 'utf8');
const skinStart = localLoadout.indexOf('/* ---- 皮肤选择');
const skinEnd = localLoadout.indexOf('/* ---- ', skinStart + 10);
const SKIN_CSS = skinStart >= 0 ? localLoadout.slice(skinStart, skinEnd > skinStart ? skinEnd : undefined) : '';
if (!SKIN_CSS) console.warn('警告：本地 loadout.css 里没找到「皮肤选择」块，皮肤段将没有样式');

const fontsCss = readFileSync(path.join(PUB, 'fonts/fonts.css'), 'utf8')
  .replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);

const REAL_CSS = [...cssParts, SKIN_CSS, fontsCss].join('\n');

// ---- 屏内标记（真实类名，取自上游 v0.2.2 / 本地源码） ------------------------------------------------

const skillBtn = (rec, on, size = 'q') => `<button type="button" class="lo-q lo-q--skill${on ? ' is-on' : ''}">
    <span class="lo-sicon lo-sicon--${size}${on ? ' is-on' : ''}">${img(skillIcon(rec))}${on && size !== 'xs' ? img(UI.outline, 'lo-sicon__outline') : ''}</span></button>`;
const modBtn = (letter, on) => `<button type="button" class="lo-q lo-q--mod${on ? ' is-on' : ''}">
    <span class="lo-mglyph lo-mglyph--q"><b class="lo-mglyph__t num">${letter}</b></span><b class="lo-q__type num">${letter}</b></button>`;
const modNoneBtn = () => `<button type="button" class="lo-q lo-q--mod"><span class="lo-mglyph lo-mglyph--none lo-mglyph--q">${img(UI.equipNone)}</span></button>`;

const cultSelects = (st) => {
  const pot = st.potential ?? 6;
  const tier = st.cultivate ?? 3;
  return `<span class="lo-cult">
    <span class="lo-select lo-cult__sel lo-cult__pot${pot !== 6 ? ' is-off' : ''}"><select aria-label="潜能"><option>潜能 ${pot}</option></select></span>
    <span class="lo-select lo-cult__sel lo-cult__tier${tier !== 3 ? ' is-off' : ''}"><select aria-label="练度"><option>${CULT_SHORT[tier]}</option></select></span>
  </span>`;
};

const rosterRow = (c, i) => {
  const st = ROW_STATE[c.chessId] || {};
  const skills = (c.skills || []).slice(0, 3);
  const changed = st.skill != null || st.potential != null;
  return `<div class="lo-card lo-card--t${c.tier}${st.sel ? ' is-sel' : ''}${changed ? ' is-changed' : ''}${st.standin ? ' is-standin' : ''}" data-chess="${c.chessId}" data-row="${i}">
    <button type="button" class="lo-card__pick" aria-pressed="${st.sel ? 'true' : 'false'}" title="${esc(c.name)}">
      <span class="lo-card__art">${img(avatarOf(c))}${tierHtml(c.tier, 'sm')}</span>
      <span class="lo-card__id">
        <span class="lo-card__name">${esc(c.name)}</span>
        <span class="lo-card__bonds">${(c.bonds || []).map((b) => img(bondIcon(b), 'lo-card__bond', bondOf(b)?.name || b)).join('')}</span>
        ${st.standin ? '<span class="lo-card__sub" title="未持有（干员持有）：由替补干员上场">替补</span>' : ''}
      </span>
    </button>
    ${changed ? '<span class="lo-card__flag" aria-label="已调整"></span>' : ''}
    <div class="lo-card__skills lo-quick">${skills.map((s, k) => skillBtn(s, (st.skill ?? 0) === k)).join('')}</div>
    <div class="lo-card__mods lo-quick">${modNoneBtn()}${modBtn('X', true)}</div>
    ${cultSelects(st)}
  </div>`;
};

const skillRow = (rec, i, on) => `<button type="button" role="radio" aria-checked="${on ? 'true' : 'false'}" class="lo-skill${on ? ' is-on' : ''}">
    ${on ? `<span class="lo-skill__deco">${img(UI.deco)}</span>` : ''}
    <span class="lo-sicon lo-sicon--md${on ? ' is-on' : ''}">${img(skillIcon(rec))}${on ? img(UI.outline, 'lo-sicon__outline') : ''}</span>
    <span class="lo-skill__body">
      <span class="lo-skill__head">
        <span class="lo-skill__slot num">S${i + 1}</span>
        <b class="lo-skill__name">${esc(rec.name)}</b>
        ${i === 0 ? '<span class="lo-badge lo-badge--def">默认</span>' : ''}
        ${on ? '<span class="lo-badge lo-badge--on">已装备</span>' : ''}
      </span>
      <span class="lo-skill__tags">
        <span class="lo-sp lo-sp--${rec.spType === 'INCREASE_WHEN_ATTACK' ? 'atk' : rec.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 'def' : 'passive'}">技力</span>
        <span class="lo-tag">初始 <b class="num">${rec.initSp ?? 0}</b></span>
        <span class="lo-tag">消耗 <b class="num">${rec.spCost ?? 0}</b></span>
        ${rec.duration ? `<span class="lo-tag">持续 <b class="num">${rec.duration}</b></span>` : ''}
        ${rec.maxChargeTime > 1 ? `<span class="lo-tag">充能 <b class="num">${rec.maxChargeTime}</b></span>` : ''}
      </span>
      <span class="lo-skill__desc">${rich(rec.descRaw || rec.desc)}</span>
    </span>
  </button>`;

function rangeGrid(grid) {
  if (!Array.isArray(grid) || !grid.length) return '<span class="t-dim">—</span>';
  const cells = new Set();
  let minR = 0, maxR = 0, minC = 0, maxC = 0;
  for (const [r, c] of grid) {
    cells.add(`${r},${c}`);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  const rows = maxR - minR + 1, cols = maxC - minC + 1;
  const out = [];
  for (let r = maxR; r > maxR - rows; r--) {
    for (let c = minC; c < minC + cols; c++) {
      const self = r === 0 && c === 0;
      out.push(`<i class="${cells.has(`${r},${c}`) ? 'on' : ''}${self ? ' self' : ''}"></i>`);
    }
  }
  return `<div class="rgrid" style="grid-template-columns:repeat(${cols},var(--rg))">${out.join('')}</div>`;
}

const statCell = (k, v) => `<div class="dstat"><span class="dstat__k">${k}</span><span class="dstat__row"><b class="dstat__v num">${v}</b></span></div>`;

const statsBlock = (rec) => {
  const s = rec.stats || {};
  const interval = s.bat > 0 && s.aspd > 0 ? (s.bat * 100 / s.aspd).toFixed(2) + 's' : '—';
  return `<div class="dstats-wrap">
    <div class="dstats">
      ${statCell('生命上限', s.maxHp ?? '—')}${statCell('攻击', s.atk ?? '—')}${statCell('防御', s.def ?? '—')}
      ${statCell('法术抗性', s.res ?? 0)}${statCell('攻击间隔', interval)}${statCell('阻挡数', s.blockCnt ?? '—')}
      ${statCell('部署费用', s.cost ?? '—')}${statCell('再部署', s.respawnTime != null ? `${s.respawnTime}s` : '—')}
    </div>
    <div class="drange"><span class="dstat__k">攻击范围</span>${rangeGrid(rec.rangeGrid)}</div>
  </div>`;
};

const skinRow = (s, on, isDefault) => `<button type="button" role="radio" aria-checked="${on ? 'true' : 'false'}" class="lo-skin${isDefault ? ' lo-skin--default' : ''}${on ? ' is-on' : ''}">
    <span class="lo-skin__art">${img(s.art)}</span>
    <span class="lo-skin__text"><b class="lo-skin__name">${esc(s.name)}</b><span class="lo-skin__group">${esc(s.group)}</span></span>
    ${on ? '<span class="lo-skin__badge">已装配</span>' : ''}
  </button>`;

/** 详情卡里的「皮肤」段（本地 ui/skinPicker.js 的 <SkinSection>，落在详情卡末段）。 */
function skinSection() {
  const list = [
    { name: '默认', group: 'DEFAULT', art: avatarOf(SEL) },
    ...SEL_SKINS.map((s) => ({ name: s.name, group: s.group || 'SPECIAL', art: pubUrl(s.avatar) })),
  ];
  return `<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head"><h3>皮肤<span class="micro micro--mint">SKIN</span></h3><span class="lo-sec__note">${SEL_SKINS.length} 款可选</span></header>
    <div class="lo-skins" role="radiogroup" aria-label="选择皮肤">
      ${list.map((s, i) => skinRow(s, i === list.length - 1, i === 0)).join('')}
    </div>
  </section>`;
}

/** 合并后的「干员调配」整屏：上游 v0.2.2 结构 + 本地皮肤段（详情卡末段）。
 *  @param {string} id 舞台 id
 *  @param {{ detail?: boolean }} [opt] detail = 窄屏（≤1000px）的 `.lo-body.is-detail`：详情卡整屏滑出盖住列表 */
function screen(id, opt = {}) {
  const golden = SEL_GOLDEN || SEL;
  const mods = golden.modules || [];
  const selSkills = (golden.skills || SEL.skills || []).slice(0, 3);
  const equipSkill = ROW_STATE[SEL.chessId]?.skill ?? 0;
  const bonds = (SEL.bonds || []).map((b) => `<span class="lo-bond">${img(bondIcon(b), 'lo-bond__icon')}${esc(bondOf(b)?.name || b)}</span>`).join('');
  return `<div class="lo" data-stage="${id}" role="dialog" aria-label="干员调配">
  <div class="lo__bg" aria-hidden="true"></div>
  <header class="lo-top">
    <div class="lo-top__left"><button type="button" class="btn btn--ghost btn--md lo-back">返回</button></div>
    <div class="lo-top__center">
      <span class="micro micro--mint">OPERATOR LOADOUT</span>
      <div class="lo-tabs" role="tablist">
        <button type="button" class="lo-tab is-on" data-tab="loadout">${img(UI.preset, 'lo-top__icon')}干员调配</button>
        <button type="button" class="lo-tab" data-tab="ownership">干员持有<span class="lo-tab__n num">71</span></button>
        <button type="button" class="lo-tab" data-tab="diy">自选编队<span class="lo-tab__n num">4</span></button>
      </div>
    </div>
    <div class="lo-top__right">
      <span class="lo-sync is-ok" role="status">已同步</span>
      <span class="lo-count">已调整 <b class="num">3</b><span class="num t-dim">/${VISIBLE.length}</span></span>
      <button type="button" class="btn btn--ghost btn--sm">导出</button>
      <button type="button" class="btn btn--ghost btn--sm">导入</button>
      <button type="button" class="btn btn--secondary btn--sm">全部恢复默认</button>
    </div>
  </header>
  <p class="lo-note">开始模拟前可调整干员携带的技能与模组，以及潜能与练度；干员的局内等级不可调整</p>
  <main class="lo-body${opt.detail ? ' is-detail' : ''}">
    <section class="lo-roster">
      <div class="lo-filters">
        <div class="lo-frow">
          <div class="lo-chips" role="group" aria-label="阶级">
            <button type="button" class="lo-chip is-on">全部</button>
            ${['I', 'II', 'III', 'IV', 'V', 'VI'].map((r, i) => `<button type="button" class="lo-chip lo-chip--tier lo-chip--t${i + 1}"><span class="num">${r}</span></button>`).join('')}
          </div>
          <label class="lo-search"><span class="field__box">搜索干员 / 职业 / 盟约</span></label>
        </div>
        <div class="lo-frow">
          <div class="lo-chips lo-chips--prof" role="group" aria-label="职业">
            ${['狙击', '近卫', '重装', '医疗', '辅助', '术师', '特种', '先锋'].map((p, i) => `<button type="button" class="lo-chip lo-chip--prof${i === 0 ? ' is-on' : ''}"><span class="lo-chip__lbl">${p}</span></button>`).join('')}
          </div>
          <label class="lo-select"><span class="lo-select__k">盟约</span><select aria-label="按盟约筛选"><option>全部盟约</option></select></label>
          <button type="button" class="lo-toggle"><i class="lo-toggle__box"></i>仅看已调整</button>
        </div>
      </div>
      <div class="lo-list" role="listbox" aria-label="干员列表">
        <div class="lo-list__head" aria-hidden="true">
          <span class="lo-list__h lo-list__h--op">干员</span>
          <span class="lo-list__h lo-list__h--skills">技能</span>
          <span class="lo-list__h lo-list__h--mods">模组<small>精锐</small></span>
          <span class="lo-list__h lo-list__h--cult">潜能 · 练度</span>
        </div>
        <div class="lo-list__rows" role="list">${roster.map(rosterRow).join('')}</div>
      </div>
    </section>
    <div class="lo-detail-wrap">
      <button type="button" class="lo-detail-back tapx">干员列表</button>
      <aside class="lo-detail" aria-label="${esc(SEL.name)} 调配">
        <div class="lo-dhead">
          <div class="lo-dhead__art lo-dhead__art--t${SEL.tier}">${img(portraitOf(SEL_GOLDEN || SEL))}</div>
          <div class="lo-dhead__info">
            <div class="lo-dhead__chips">${tierHtml(SEL.tier, 'md')}<span class="lo-badge lo-badge--changed">已调整</span></div>
            <h2 class="lo-dhead__name">${esc(SEL.name)}</h2>
            <span class="lo-dhead__en">${esc(SEL.appellation || '')}</span>
            <span class="lo-dhead__class">${img(profGlyph(SEL.profession), 'lo-dhead__prof lo-profglyph')}狙击<i class="lo-sep"></i>${img(subProfIcon(SEL), 'lo-dhead__prof')}${esc(SEL.subProfessionName || '')}</span>
            <span class="lo-dhead__bonds">${bonds}</span>
          </div>
          <button type="button" class="btn btn--ghost btn--sm lo-dhead__reset">恢复默认</button>
        </div>
        <div class="lo-detail__body">
          <section class="lo-sec lo-sec--cult" aria-label="潜能与练度">
            <header class="lo-sec__head"><h3>潜能与练度<span class="micro micro--mint">POTENTIAL</span></h3><span class="lo-badge lo-badge--plain">满潜能 · 精英2 Lv.60</span></header>
            <div class="lo-cult__row"><span class="lo-cult__k">潜能</span>
              <div class="lo-seg lo-seg--pot" role="radiogroup">${POTENTIALS.map((n) => `<button type="button" class="${n === 6 ? 'is-on' : ''}"><span class="num">${n}</span></button>`).join('')}</div>
            </div>
            <div class="lo-cult__row"><span class="lo-cult__k">练度</span>
              <div class="lo-seg lo-seg--tier" role="radiogroup">${CULT.map((_, i) => `<button type="button" class="${i === 3 ? 'is-on' : ''}">${esc(cultName(i))}</button>`).join('')}</div>
            </div>
            <p class="lo-cult__eff"><b>${esc(cultName(3))}</b> <span>${esc(cultDesc(3))}</span></p>
            <p class="lo-cult__note">默认满潜能、精英2 Lv.60（满加成）。官方的潜能取你自己的潜能，练度是自持有加成；未持有的特许干员在官方按潜能1、没有加成。</p>
          </section>
          <section class="lo-sec">
            <header class="lo-sec__head"><h3>技能<span class="micro micro--mint">SKILL</span></h3>
              <div class="lo-seg" role="tablist"><button type="button">普通 <span class="num">Lv.7</span></button><button type="button" class="is-on">精锐 <span class="num">Lv.7</span></button></div>
            </header>
            <div class="lo-skills" role="radiogroup" aria-label="选择技能">${selSkills.map((s, i) => skillRow(s, i, i === equipSkill)).join('')}</div>
          </section>
          <section class="lo-sec lo-sec--stats" aria-label="局内数值">
            <header class="lo-sec__head"><h3>局内数值<span class="micro micro--mint">STATS</span></h3>
              <div class="lo-seg" role="tablist"><button type="button">普通</button><button type="button" class="is-on">精锐</button></div>
            </header>
            ${statsBlock(golden)}
            <div class="lo-minfo lo-minfo--kit">
              <div class="lo-minfo__row"><span class="lo-minfo__k">特性</span><span class="lo-minfo__v">${rich(golden.trait?.descRaw || golden.trait?.desc)}</span></div>
              ${(golden.talents || []).filter((t) => !t.hidden).slice(0, 2).map((t) => `<div class="lo-minfo__row"><span class="lo-minfo__k">天赋</span><span class="lo-minfo__v"><b class="lo-minfo__tname">${esc(t.name)}</b>${rich(t.descRaw || t.desc)}</span></div>`).join('')}
            </div>
            <p class="lo-stats__cap">数值含所选模组；含潜能与练度；不含技能发动、装备、盟约等局内加成</p>
          </section>
          ${golden ? `<section class="lo-sec lo-sec--mod">
            <header class="lo-sec__head"><h3>模组<span class="micro micro--mint">MODULE</span></h3><span class="lo-sec__note">仅精锐干员装备 · 模组等级 <b class="num">1</b></span></header>
            <div class="lo-mods" role="radiogroup" aria-label="选择模组">
              <button type="button" class="lo-mod lo-mod--none"><span class="lo-mglyph lo-mglyph--none">${img(UI.equipNone)}</span><span class="lo-mod__text"><span class="lo-mod__type num">NONE</span><b class="lo-mod__name">不装备</b></span></button>
              ${mods.map((mo, i) => `<button type="button" class="lo-mod${i === 0 ? ' is-on' : ''}"><span class="lo-mglyph"><b class="lo-mglyph__t num">${esc(String(mo.typeName || '').replace(/^MAR-/, ''))}</b></span>
                <span class="lo-mod__text"><span class="lo-mod__type num">${esc(mo.typeName || '')}</span><b class="lo-mod__name">${esc(mo.name || mo.uniEquipId)}</b></span>
                ${mo.isDefault ? '<span class="lo-badge lo-badge--def lo-mod__def">默认</span>' : ''}</button>`).join('')}
            </div>
            ${mods[0] ? `<div class="lo-minfo">
              <div class="lo-minfo__title"><span class="lo-minfo__type num">${esc(mods[0].typeName || '')}</span><b>${esc(mods[0].name)}</b><span class="lo-badge lo-badge--def">默认</span></div>
              <div class="lo-minfo__row"><span class="lo-minfo__k">属性</span><span class="lo-minfo__v lo-attrs">${Object.entries(mods[0].attr || {}).map(([k, v]) => `<span class="lo-attr is-up">${esc({ maxHp: '生命上限', atk: '攻击力', def: '防御力', res: '法术抗性', aspd: '攻击速度' }[k] || k)}<b class="num">+${v}</b></span>`).join('')}</span></div>
              <div class="lo-minfo__row"><span class="lo-minfo__k">特性</span><span class="lo-minfo__v">${rich(mods[0].traitOverride?.moduleDescRaw || mods[0].traitOverride?.moduleDesc)}</span></div>
            </div>` : ''}
          </section>` : ''}
          ${skinSection()}
        </div>
      </aside>
    </div>
  </main>
</div>`;
}

/** 商店卡（真实 .scard 结构 + 真实立绘），用于「立绘同步」一条。 */
const shopCard = (src, name, tier, cap) => `<div class="scard scard--t${tier}" style="--tc:var(--tier-${tier})">
    <div class="scard__bg"></div>
    ${img(src, 'scard__art')}
    <div class="scard__body"><span class="scard__name">${esc(name)}</span></div>
    <div class="scard__cap">${esc(cap)}</div>
  </div>`;

// ---- 页面骨架 ---------------------------------------------------------------------------------------

const stageCss = `
/* 参考图专用：把整屏 .lo 放进固定画布，其余一律不动（真实 CSS 决定内部一切） */
html, body { height: auto; overflow: hidden; }
body.sheet-host { height: auto; }
.stage { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; overflow: hidden; isolation: isolate; background: var(--bg-0); }
.stage .lo { position: absolute; inset: 0; animation: none; }
.stage[hidden] { display: none; }
`;

/** 舞台表：id → { detail: 详情卡整屏滑出, scroll: 详情列滚到底（皮肤段） } */
const STAGES = {
  'web-top': {},
  'web-skin': { scroll: true },
  'and-top': {},
  'and-detail': { detail: true },
  'and-skin': { detail: true, scroll: true },
};

const stagesHtml = (ids) => `<style>${REAL_CSS}${stageCss}</style>`
  + ids.map((id) => `<div class="stage" data-stage-host="${id}">${screen(id, STAGES[id])}</div>`).join('');

// ---- 渲染 -------------------------------------------------------------------------------------------

const TMP = path.join(HERE, '.fusion-tmp');
const puppeteer = (await import('puppeteer-core')).default;
if (!CHROME || !existsSync(CHROME)) { console.error('未找到 Chrome：请设置 CHROME_PATH'); process.exit(1); }
mkdirSync(TMP, { recursive: true });

const htmlFor = (ids) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">
<title>fusion reference</title></head><body>${stagesHtml(ids)}</body></html>`;

const TMP_HTML = path.join(TMP, 'stage.html');
const waitImages = (page) => page.evaluate(() => Promise.all(Array.from(document.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))));

/**
 * 一趟渲染：把每个 stage 单独显示后按视口裁切，返回 { file, probes }。
 * @param {{width:number,height:number,dsf:number,mobile:boolean,cls:string,ids:string[],probes:Record<string,string[]>}} opt
 */
async function renderPass(opt) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
  });
  const out = {};
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: opt.width, height: opt.height, deviceScaleFactor: opt.dsf, isMobile: opt.mobile, hasTouch: opt.mobile });
    await page.evaluateOnNewDocument((cls) => { document.documentElement.className = cls; }, opt.cls);
    await page.goto(furl(TMP_HTML), { waitUntil: 'load' });
    await waitImages(page);
    await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    for (const id of opt.ids) {
      await page.evaluate((sid) => {
        document.querySelectorAll('.stage').forEach((s) => { s.hidden = s.dataset.stageHost !== sid; });
        const b = document.querySelector('.stage:not([hidden]) .lo-detail__body');
        if (b) b.scrollTop = 0;
      }, id);
      if (STAGES[id]?.scroll) {
        await page.evaluate(() => {
          const b = document.querySelector('.stage:not([hidden]) .lo-detail__body');
          if (b) b.scrollTop = b.scrollHeight;
        });
      }
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const file = path.join(TMP, `${id}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: opt.width, height: opt.height } });
      const probes = {};
      for (const [name, sel] of Object.entries(opt.probes?.[id] || {})) {
        probes[name] = await page.evaluate((s) => {
          const el = document.querySelector(`.stage:not([hidden]) ${s}`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        }, sel);
      }
      out[id] = { file, probes, broken: await page.evaluate(() => Array.from(document.querySelectorAll('.stage:not([hidden]) img')).filter((i) => !i.complete || i.naturalWidth === 0).length) };
      // 结构自检：本模型读不了图，用几何断言代替目视（元素有没有塌成 0、文字有没有被裁、皮肤行是否成套）
      out[id].audit = await page.evaluate(() => {
        const S = '.stage:not([hidden]) ';
        const box = (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
        const rows = [...document.querySelectorAll(`${S}.lo-card`)];
        const skins = [...document.querySelectorAll(`${S}.lo-skin`)];
        // 只统计"真的被渲染出来但塌成 0"的元素（display:none 的隐藏列不算缺陷）
        const vis = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : !!e.offsetParent);
        const zero = [...document.querySelectorAll(`${S}.lo-card, ${S}.lo-skin, ${S}.lo-skill, ${S}.dstat, ${S}.lo-chip, ${S}.tier`)].filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && (r.width < 1 || r.height < 1); }).length;
        const clipped = [...document.querySelectorAll(`${S}.lo-card__name, ${S}.lo-skin__name, ${S}.lo-sec__head h3, ${S}.lo-dhead__name, ${S}.lo-skill__name`)]
          .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim().slice(0, 14));
        return {
          rows: rows.length,
          rowH: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
          skins: skins.length,
          skinArt: skins.map((s) => box(s.querySelector('.lo-skin__art') || s)),
          skills: document.querySelectorAll(`${S}.lo-skill`).length,
          stats: document.querySelectorAll(`${S}.dstat`).length,
          rangeCells: document.querySelectorAll(`${S}.rgrid i`).length,
          mods: document.querySelectorAll(`${S}.lo-mod`).length,
          tiers: document.querySelectorAll(`${S}.tier img`).length,
          zero,
          clipped,
        };
      });
    }
    out.__fonts = await page.evaluate(() => ({
      loaded: Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family),
      noto: document.fonts.check('16px "Noto Sans SC"'),
      bender: document.fonts.check('16px "Bender"'),
      novecento: document.fonts.check('16px "Novecento Wide"'),
      rem: getComputedStyle(document.documentElement).fontSize,
    }));
  } finally { await browser.close(); }
  return out;
}

// 详情列滚到底：皮肤段（详情卡末段）进入视野
async function scrollDetailToSkin() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(furl(TMP_HTML), { waitUntil: 'load' });
    await waitImages(page);
    const h = await page.evaluate(() => {
      const b = document.querySelector('.lo-detail__body');
      if (!b) return 0;
      b.scrollTop = b.scrollHeight;
      return b.scrollHeight - b.clientHeight;
    });
    return h;
  } finally { await browser.close(); }
}

writeFileSync(TMP_HTML, htmlFor(Object.keys(STAGES)), 'utf8');
const skinScroll = await scrollDetailToSkin();

const PROBES = {
  'web-skin': {
    cult: '.lo-list__head .lo-list__h--cult',
    row: '.lo-card.is-sel .lo-cult',
    skin: '.lo-sec--skin',
    detail: '.lo-detail',
  },
};

const web = await renderPass({ width: 1920, height: 1080, dsf: 2, mobile: false, cls: 'sp-hover sp-fs', ids: ['web-top', 'web-skin'], probes: PROBES });
const and = await renderPass({ width: 844, height: 390, dsf: 2, mobile: true, cls: 'sp-touch sp-coarse sp-no-hover', ids: ['and-top', 'and-detail', 'and-skin'], probes: {} });

// 皮肤段的裁切（两端各自的 .lo-sec--skin，滚到底后可见）
async function cropOf(stageId, viewport, dsf, cls, sel = '.lo-sec--skin') {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.w, height: viewport.h, deviceScaleFactor: dsf, isMobile: !!viewport.mobile, hasTouch: !!viewport.mobile });
    await page.evaluateOnNewDocument((c) => { document.documentElement.className = c; }, cls);
    await page.goto(furl(TMP_HTML), { waitUntil: 'load' });
    await waitImages(page);
    await page.evaluate((sid) => { document.querySelectorAll('.stage').forEach((s) => { s.hidden = s.dataset.stageHost !== sid; }); }, stageId);
    await page.evaluate(() => { const b = document.querySelector('.stage:not([hidden]) .lo-detail__body'); if (b) b.scrollTop = b.scrollHeight; });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = await page.evaluate((s) => {
      const el = document.querySelector(`.stage:not([hidden]) ${s}`);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }, sel);
    const file = path.join(TMP, `${stageId}-detail.png`);
    await page.screenshot({ path: file, clip: box });
    return { file, css: box };
  } finally { await browser.close(); }
}

const webDetail = await cropOf('web-skin', { w: 1920, h: 1080 }, 2, 'sp-hover sp-fs');
const andDetail = await cropOf('and-skin', { w: 844, h: 390, mobile: true }, 2, 'sp-touch sp-coarse sp-no-hover');

// ---- 参考图 -----------------------------------------------------------------------------------------

const S = 1840 / 1920;                    // ① 全屏图在 1840 内容宽里的缩放
const webP = web['web-skin'].probes;
const mark = (n, kind, p, dx = 0, dy = 0) => (p
  ? `<span class="mk mk--${kind}" style="left:${(p.x * S + dx).toFixed(1)}px;top:${(p.y * S + dy).toFixed(1)}px">${n}</span>` : '');

const MATRIX = [
  ['皮肤选择器', '单列列表（<code>.lo-skins</code> flex column）：一行一款，左侧 48px 头像、中间名称+系列、右侧状态标签；hover 提亮', '同一组件、同一列表；<code>.sp-coarse</code> 下控件抬高到 ≥30px 靶区，长按 520ms 预览立绘', '<code>sp-coarse</code> / <code>--tap-min</code>', '触摸 vs 鼠标，不是屏宽'],
  ['皮肤段位置', '详情卡末段（<code>.lo-sec--skin</code>，滚动到底）', '同（同一组件、同一落点）', '—', '两端同一落点'],
  ['潜能 · 练度', '行内两个 <code>select</code>（<code>.lo-cult</code>）+ 详情卡分段按钮（<code>.lo-seg--pot/--tier</code>）', '同', '—', '上游 v0.2.2 新增，两端共享'],
  ['商店卡立绘', '皮肤立绘进 Full 预载档（~430MB → ~465MB，须重测并改 <code>preloadModal.js</code> 两处硬编码）', '同一批 PNG 打进 <code>app_bundle.zip</code>（重出 <code>bundle.sha256</code>、过包体门禁）', 'bundle tier', '分发方式不同'],
  ['DIY / 替补卡', '不套皮肤（服务端 <code>freezeSkins</code> 已拒绝）', '同', '—', '语义一致'],
  ['战斗 HUD', '安全区 + 44px 靶区（<code>devices.css</code>）', '同 + 热防护降 DPR + 原生诊断入口', '<code>sp-coarse</code> / nativeShell', '触摸 vs 鼠标'],
  ['设置 · 性能', '只调页面 ticker（PREP 120 / BATTLE 60）', '同开关还调 <code>setHighRefresh</code> 改屏幕刷新率', '<code>isHighRefresh</code>', '安卓能控硬件'],
  ['大厅 · 加入', '密钥 / 邀请链接', '额外：局域网自动发现，只输密钥', '<code>findRoom</code> → <code>__onRoomFound</code>', '安卓可被局域网发现'],
  ['资源预载', 'core → full 两阶段 + 药丸', '不适用（内置全量）', '<code>isNativeApp()</code> 提前 return', '资源来源不同'],
  ['资源档 · 熔断', '<code>web_full 1.0 / web_core 1.5 / stream 8.0</code> 权重喂 <code>loadGuard</code>', '<code>android_full 1.0</code>，固定档', '<code>hello.client.bundle</code>', '端会改变准入控制'],
];

const legend = (n, kind, txt) => `<div class="lg lg--${kind}"><b>${n}</b><span>${txt}</span></div>`;
const ruleList = (kind, title, items) => `<div class="rules__col ${kind}"><h4>${title}</h4><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;

const sheetCss = `
/* 参考图自身的版面：只用游戏令牌与字体，px 尺寸便于阅读 */
body { overflow: visible; height: auto; font-size: 15px; line-height: 1.6; }
.sheet { width: 1920px; padding: 0 40px 40px; background: var(--bg-0); position: relative; }
.sheet::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(70% 40% at 12% 0%, rgba(78,216,175,.07), transparent 60%),
              radial-gradient(50% 30% at 100% 8%, rgba(52,184,216,.05), transparent 60%); }
.sheet > * { position: relative; }
.hd { padding: 34px 34px 28px; margin: 0 -40px 30px; background: linear-gradient(180deg, #0f1312, #0a0d0c);
  border-bottom: 1px solid var(--line); }
.hd h1 { font-size: 30px; font-weight: 900; letter-spacing: .02em; }
.hd h1 small { display: block; margin-top: 10px; font-size: 14px; font-weight: 400; color: var(--text-lo); line-height: 1.75; }
.hd .micro { display: block; margin-bottom: 10px; }
.lede { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.tag { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; font-size: 12.5px; color: var(--text-md);
  background: rgba(255,255,255,.03); border: 1px solid var(--line); }
.tag i { width: 8px; height: 8px; display: block; }
.tag--up i { background: var(--ice); } .tag--up { border-color: rgba(159,212,255,.4); }
.tag--local i { background: var(--mint-500); } .tag--local { border-color: rgba(78,216,175,.4); }
.tag--join i { background: var(--gold); } .tag--join { border-color: rgba(255,198,0,.4); }
.panel { margin-top: 30px; border: 1px solid var(--line); background: var(--bg-1); }
.panel__hd { display: flex; align-items: center; gap: 12px; padding: 13px 18px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.panel__hd h2 { display: flex; align-items: baseline; gap: 10px; font-size: 17px; font-weight: 900; letter-spacing: .04em; }
.panel__hd h2::before { content: ''; align-self: center; width: 5px; height: 20px; background: var(--mint-500); }
.panel__hd .spacer { flex: 1; }
.panel__bd { padding: 0; }
.panel__bd--pad { padding: 18px; }
.shot { position: relative; line-height: 0; background: var(--bg-0); }
.shot img { display: block; width: 100%; height: auto; }
.shot--bleed { border-bottom: 1px solid var(--line); }
.mk { position: absolute; width: 22px; height: 22px; display: grid; place-items: center; z-index: 5;
  font-family: var(--font-num); font-size: 12.5px; font-weight: 700; color: #06110d;
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%);
  transform: translate(-50%, -50%); }
.mk--up { background: var(--ice); color: #06202f; } .mk--local { background: var(--mint-500); } .mk--join { background: var(--gold); color: #1a1400; }
.legend { display: flex; flex-direction: column; gap: 9px; padding: 16px 18px; }
.lg { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 11px; align-items: start; font-size: 13.5px; color: var(--text-md); }
.lg b { display: grid; place-items: center; width: 22px; height: 22px; font-family: var(--font-num); font-size: 12.5px;
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%); }
.lg--up b { background: var(--ice); color: #06202f; } .lg--local b { background: var(--mint-500); color: #06110d; } .lg--join b { background: var(--gold); color: #1a1400; }
.lg code, .mtx code, .note code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }
.duo { display: flex; gap: 20px; align-items: flex-start; padding: 18px; }
.col { flex: 1; min-width: 0; }
.col__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13.5px; color: var(--text-md); }
.col__hd b { font-size: 14.5px; color: var(--text-hi); }
.col__hd .micro { margin-left: auto; }
.frame { border: 1px solid var(--line-2); background: var(--bg-0); overflow: hidden; position: relative; line-height: 0; }
.frame img { display: block; width: 100%; height: auto; }
.frame--phone { border-radius: 12px; border-width: 2px; border-color: var(--line-3); }
.cap { margin-top: 9px; font-size: 12.5px; color: var(--text-lo); line-height: 1.6; }
.shoprow { display: flex; align-items: center; gap: 18px; padding: 16px 18px; border-top: 1px solid var(--line); }
.scard { position: relative; width: 1.56rem; height: 2.24rem; flex: none; }
.scard__cap { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 2px 0; font-size: 10.5px; text-align: center;
  background: rgba(8,11,10,.86); color: var(--text-lo); }
.arrow { font-family: var(--font-num); font-size: 22px; color: var(--mint-500); }
.note { flex: 1; min-width: 0; font-size: 13px; color: var(--text-md); line-height: 1.75; }
.devices { display: flex; gap: 20px; align-items: flex-start; padding: 18px; }
.mtx { width: 100%; border-collapse: collapse; font-size: 13px; }
.mtx th, .mtx td { border: 1px solid var(--line); padding: 9px 11px; text-align: left; vertical-align: top; line-height: 1.6; }
.mtx th { background: var(--bg-2); color: var(--text-md); font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.mtx td.k { color: var(--text-hi); font-weight: 700; white-space: nowrap; }
.mtx td.web { color: #cfe6f7; } .mtx td.and { color: #cdf3e5; }
.mtx td.mech { color: var(--text-lo); } .mtx td.why { color: var(--text-dim); }
.mtx tbody tr:nth-child(even) { background: rgba(255,255,255,.015); }
.rules { display: flex; gap: 26px; padding: 16px 18px 4px; }
.rules__col { flex: 1; }
.rules__col h4 { margin-bottom: 9px; font-size: 13.5px; }
.rules__col.do h4 { color: var(--mint-400); } .rules__col.dont h4 { color: var(--red-premium); }
.rules__col ul { list-style: none; }
.rules__col li { position: relative; padding-left: 19px; margin-bottom: 7px; font-size: 13px; color: var(--text-md); line-height: 1.65; }
.rules__col li::before { position: absolute; left: 0; top: 0; }
.rules__col.do li::before { content: '✓'; color: var(--mint-400); }
.rules__col.dont li::before { content: '✕'; color: var(--red-premium); }
.foot { display: flex; justify-content: space-between; gap: 20px; margin-top: 28px; font-size: 12.5px; color: var(--text-dim); }
`;

const SHEET = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>融合参考图</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">
<style>${REAL_CSS}${stageCss}${sheetCss}</style></head><body class="sheet-host"><div class="sheet">

<div class="hd brackets">
  <span class="micro micro--mint">FUSION REFERENCE · UPSTREAM v0.2.2 ⊕ LOCAL</span>
  <h1>融合参考图 · 实装后 UI × 双端适配（含皮肤选择）
    <small>左边是「上游 v0.2.2 结构 ⊕ 本地 fusion UI」融合后的版面；右边与下方是同一套 UI 在 Web 端 / 安卓原生端上的对应落位。<br>
    本图不再另起一套设计稿：样式表、类名、字体、尺寸全部取自仓库源码（上游 v0.2.2 的 CSS + 本地皮肤块），干员 / 技能 / 立绘 / 盟约 / 练度文案全部来自 <code>public/data</code>。</small>
  </h1>
  <div class="lede">
    <span class="tag tag--up"><i></i>上游 v0.2.2 结构（合并后为底）</span>
    <span class="tag tag--local"><i></i>本地 fusion 保留（上游没有）</span>
    <span class="tag tag--join"><i></i>融合落点</span>
    <span class="tag">真实样式表 · 真实干员与皮肤 · 真实立绘</span>
  </div>
</div>

<!-- ① 融合总览 -->
<section class="panel">
  <header class="panel__hd"><h2>① 融合总览：干员调配（上游结构 ⊕ 本地皮肤段）</h2>
    <span class="tag tag--up"><i></i>一干员一行 + 潜能·练度列</span>
    <span class="tag tag--local"><i></i>皮肤段落在详情卡末段</span>
    <span class="spacer"></span><span class="micro">1920×1080 · THE FUSION</span></header>
  <div class="panel__bd">
    <div class="shot shot--bleed">
      <img src="${furl(web['web-skin'].file)}" alt="">
      ${mark(1, 'up', webP.cult)}${mark(2, 'local', webP.skin)}${mark(3, 'join', webP.row)}
    </div>
    <div class="legend">
      ${legend(1, 'up', '<b>潜能 · 练度列</b>（<code>.lo-list__h--cult</code> / <code>.lo-cult</code>）= 上游 v0.2.2 新增（PR #301）。合并后由它决定战力：默认满潜能、精英2 Lv.60，改过的一行显示薄荷色 <code>.is-off</code>。')}
      ${legend(2, 'local', '<b>皮肤段</b>（<code>.lo-sec--skin</code>）= 本地独有（上游 0 个皮肤文件）。它是详情卡滚动到末段的最后一段，单列列表一行一款，不用网格。')}
      ${legend(3, 'join', '<b>融合动作</b>：取上游 <code>screens/loadout.js</code> + <code>loadout.css</code> + <code>cultivation.js</code>，把本地 <code>ui/skinPicker.js</code> 的 <code>&lt;SkinSection&gt;</code> 追加进详情卡末段；<code>room.skins</code> 与 <code>skinsStore</code> 原样保留。')}
    </div>
  </div>
</section>

<!-- ② 皮肤选择 · 双端对应 -->
<section class="panel">
  <header class="panel__hd"><h2>② 皮肤选择 · 双端对应</h2>
    <span class="tag tag--local"><i></i>本地独有组件</span>
    <span class="tag tag--join"><i></i>同一组件，两端不同密度</span>
    <span class="spacer"></span><span class="micro">SAME COMPONENT, PER-END DENSITY</span></header>
  <div class="panel__bd">
    <div class="duo">
      <div class="col">
        <div class="col__hd"><b>Web 端</b>·鼠标 / fine pointer<span class="micro">1920×1080 · 1rem = 100px</span></div>
        <div class="frame"><img src="${furl(webDetail.file)}" alt=""></div>
        <p class="cap">详情卡末段原样：<code>.lo-skins</code> 单列（<code>flex-direction: column</code>，不是网格），一行一款 —— 头像 <code>max(.48rem, 36px)</code> = 48px，中间名称 + 系列，右侧「已装配」徽标；hover 提亮、点击装配。段宽 662px（<code>.lo-body</code> 右栏 7rem = 700px）。</p>
      </div>
      <div class="col">
        <div class="col__hd"><b>安卓原生端</b>·触摸 / coarse<span class="micro">844×390 横屏 · 1rem = 40px</span></div>
        <div class="frame"><img src="${furl(andDetail.file)}" alt=""></div>
        <p class="cap">同一组件、同一列表、同一顺序：<code>≤1000px</code> 时详情卡整屏滑出（<code>.lo-body.is-detail</code>），所以这一段反而更宽（828px）；<code>max(.48rem, 36px)</code> 的 px 下限生效 → 头像 36px，<code>.sp-coarse</code> 把控件抬到 ≥30px 靶区，长按 520ms 预览立绘（无 hover）。</p>
      </div>
    </div>
    <div class="shoprow">
      <span class="micro" style="align-self:flex-start">立绘同步<br>SHOP CARD</span>
      ${shopCard(avatarOf(SEL), SEL.name, SEL.tier, '原装立绘')}
      <span class="arrow">→</span>
      ${shopCard(SKIN_EQUIPPED ? pubUrl(SKIN_EQUIPPED.avatar) : avatarOf(SEL), SEL.name, SEL.tier, '皮肤立绘')}
      <div class="note">
        新增 <code>skinPortraitUrl</code> / <code>preferredPortraitUrl</code>，接线 <code>.scard__art</code>（商店）、<code>.dhead__art</code>（详情）、<code>.lo-dhead__art</code>（本屏头图）。
        <b>Web 端</b>立绘进 Full 预载档（约 +35MB，须重测并改 <code>preloadModal.js</code> 两处硬编码文案）；<b>安卓端</b>同一批 PNG 打进 <code>app_bundle.zip</code>（重出 <code>bundle.sha256</code>、过包体门禁）。DIY / 替补卡不套皮肤，两端一致。
      </div>
    </div>
  </div>
</section>

<!-- ③ 同一屏两端 -->
<section class="panel">
  <header class="panel__hd"><h2>③ 同一屏两端：干员调配的对应落位</h2>
    <span class="spacer"></span><span class="micro">SAME LAYOUT LOGIC, PER-END EXTRAS</span></header>
  <div class="panel__bd">
    <div class="devices">
      <div class="col" style="flex:0 0 960px">
        <div class="col__hd"><b>Web 端</b>·1920×1080<span class="micro">DETAIL DOCKED RIGHT</span></div>
        <div class="frame"><img src="${furl(web['web-top'].file)}" alt="" style="width:960px"></div>
        <p class="cap">根字号 <code>min(100vw/19.2, 100svh/10.8)</code> = 100px：<code>.lo-body</code> 两栏，右栏详情卡常驻 7rem = 700px，列表与详情同屏。</p>
      </div>
      <div class="col">
        <div class="col__hd"><b>安卓原生端</b>·844×390 横屏<span class="micro">SAME .lo-body, PHONE BREAKPOINT</span></div>
        <div class="frame frame--phone"><img src="${furl(and['and-top'].file)}" alt=""></div>
        <p class="cap"><b>① 列表态</b>：<code>≤1000px</code>（v0.2.2 把断点从 760px 提到 1000px）列表占满整屏；根字号落到 40px 下限，<code>max-height:520px</code> 收起说明条、压低头图，<code>.sp-coarse</code> 抬高控件靶区，行内的技能 / 模组 / 潜能·练度 就是"快捷选择"。</p>
        <div class="frame frame--phone" style="margin-top:14px"><img src="${furl(and['and-detail'].file)}" alt=""></div>
        <p class="cap"><b>② 详情态</b>：<code>.lo-body.is-detail</code> 把详情卡整屏滑出（列表让位，左上角「干员列表」返回）——Web 端没有这个状态，它是窄屏特有的。</p>
      </div>
    </div>
    <div class="rules">
      ${ruleList('do', '两端一致', [
        '皮肤段在<b>同一落点</b>（详情卡末段），组件与数据源（<code>skinsStore</code> / <code>room.skins</code>）相同。',
        '潜能 · 练度、模组、技能三段的版面与文案两端共享，都是上游 v0.2.2 的那一套。',
        'DIY / 替补卡不套皮肤；manifest 按存在性注入 → 缺图回退默认立绘，永不 404。',
      ])}
      ${ruleList('dont', '两端不同', [
        '列表与详情的相对关系：Web 同屏常驻；窄屏（<code>≤1000px</code>）列表整屏、详情滑出盖住它。',
        '控件靶区与预览手势：Web 是 hover 预览 + 点击；安卓是长按 520ms 预览 + 轻点装配（<code>sp-coarse</code>）。',
        '资源分发：Web 进 Full 预载档；安卓进 <code>app_bundle.zip</code>，并喂给服务端不同的 <code>bundle</code> 档位。',
      ])}
    </div>
  </div>
</section>

<!-- ④ 双端对应表 -->
<section class="panel">
  <header class="panel__hd"><h2>④ 双端对应表（含皮肤行）</h2><span class="spacer"></span><span class="micro">SURFACE × END</span></header>
  <div class="panel__bd panel__bd--pad">
    <table class="mtx">
      <thead><tr><th style="width:118px">界面 / 组件</th><th style="width:340px">Web 端</th><th style="width:356px">安卓原生端</th><th style="width:200px">检测机制</th><th>为什么不是"尺寸"</th></tr></thead>
      <tbody>${MATRIX.map((r) => `<tr><td class="k">${r[0]}</td><td class="web">${r[1]}</td><td class="and">${r[2]}</td><td class="mech">${r[3]}</td><td class="why">${r[4]}</td></tr>`).join('')}</tbody>
    </table>
    <div class="rules">
      ${ruleList('do', '应当', [
        '判端用 <code>AndroidNative.isNativeApp()</code>；交互尺寸用能力类（<code>sp-coarse</code> / <code>sp-touch</code>）；资源档用 bundle tier。',
        '安卓专属能力（局域网发现、本机服务、原生诊断）在 Web 端隐藏或降级，不留死按钮。',
        '需要状态的 UI 一律走 Preact 状态（大厅每 4s 广播重渲染）。',
      ])}
      ${ruleList('dont', '不要', [
        '不要用 <code>innerWidth &lt; 768</code> 判"手机"——安卓平板与桌面窄窗会误判。',
        '不要用 UA 判端（<code>device.js</code> 明确 never UA-sniffed）。',
        '不要把两端差异塞进同一个断点里的两条 CSS——那是把平台语义压成尺寸语义。',
      ])}
    </div>
  </div>
</section>

<div class="foot">
  <span>docs/mockups/fusion-dual-platform.png　·　生成：<code>node docs/mockups/render-fusion-dual-platform.mjs</code></span>
  <span>样式表：上游 v0.2.2 CSS（${cssFromUpstream ? '已从 git 取到' : '未取到，退回本地同名文件'}）+ 本地皮肤块　·　干员/技能/立绘/盟约/练度：public/data</span>
</div>

</div></body></html>`;

const TMP_SHEET = path.join(TMP, 'sheet.html');
writeFileSync(TMP_SHEET, SHEET, 'utf8');

const OUT = path.join(HERE, 'fusion-dual-platform.png');
const SPLIT = [
  ['fusion-1-loadout.png', '① 融合总览'],
  ['fusion-2-skin-dual.png', '② 皮肤选择 · 双端'],
  ['fusion-3-devices.png', '③ 同一屏两端'],
  ['fusion-4-matrix.png', '④ 双端对应表'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
});
const report = { panels: 0, rows: 0, imgs: 0, broken: 0, markers: [], offPage: [], clipped: [], split: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
  await page.goto(furl(TMP_SHEET), { waitUntil: 'load' });
  await waitImages(page);
  await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const info = await page.evaluate(() => {
    const imgs = Array.from(document.images);
    const broken = imgs.filter((i) => !i.complete || i.naturalWidth === 0).length;
    const offPage = [];
    for (const el of document.querySelectorAll('.panel *, .foot *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > 1913 || r.left < 7)) offPage.push(`${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const clipped = [];
    for (const el of document.querySelectorAll('.panel *')) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) clipped.push(el.className.toString().split(' ')[0]);
    }
    const markers = [];
    document.querySelectorAll('.mk').forEach((m) => {
      const r = m.getBoundingClientRect();
      const host = m.closest('.shot, .frame, .duo, .panel');
      const hr = host.getBoundingClientRect();
      markers.push({ n: m.textContent, inside: r.left >= hr.left - 4 && r.right <= hr.right + 4 && r.top >= hr.top - 4 && r.bottom <= hr.bottom + 4 });
    });
    return {
      panels: document.querySelectorAll('.panel').length,
      rows: document.querySelectorAll('.mtx tbody tr').length,
      imgs: imgs.length, broken, markers,
      offPage: [...new Set(offPage)].slice(0, 10), clipped: [...new Set(clipped)].slice(0, 10),
      w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
    };
  });
  Object.assign(report, info);

  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1920, height: info.h }, captureBeyondViewport: true });

  for (let i = 0; i < SPLIT.length; i++) {
    await page.evaluate((k) => { document.querySelectorAll('.panel').forEach((p, j) => { p.style.display = j === k ? '' : 'none'; }); }, i);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // 按内容底边裁切：fullPage 会把短面板托底到视口高，scrollHeight 同样会被托底
    const ch = await page.evaluate(() => {
      const p = document.querySelector('.panel:not([style*="display: none"])');
      const hd = document.querySelector('.hd');
      let bottom = 0;
      for (const el of [hd, p]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        bottom = Math.max(bottom, r.bottom + scrollY);
      }
      return Math.ceil(bottom);
    });
    const f = path.join(HERE, SPLIT[i][0]);
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: ch }, captureBeyondViewport: true });
    const b = readFileSync(f);
    report.split.push({ name: SPLIT[i][0], label: SPLIT[i][1], w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: Math.round(b.length / 1024) });
  }
  await page.evaluate(() => { document.querySelectorAll('.panel').forEach((p) => { p.style.display = ''; }); });
} finally {
  await browser.close();
}

// ---- 自检 -------------------------------------------------------------------------------------------

const pngSize = (f) => { const b = readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: Math.round(b.length / 1024) }; };
const main = pngSize(OUT);

console.log('\n== 自检 ==');
console.log(` 样式来源: ${cssFromUpstream ? 'upstream/master（v0.2.2）' : '本地文件（未取到 upstream）'} | 皮肤块: ${SKIN_CSS.length} 字符`);
console.log(` 干员: ${roster.length} 行 | 选中: ${SEL.name}(${SEL.chessId}) | 皮肤: ${SEL_SKINS.length} 款（${SEL_SKINS.map((s) => s.name).join(' / ')}）`);
console.log(` 详情列滚动量: ${skinScroll}px（皮肤段在详情卡末段）`);
console.log(` 舞台图: ${[...Object.entries({ ...web, ...and })].filter(([k]) => !k.startsWith('__')).map(([k, v]) => `${k}${v.broken ? `(破图${v.broken})` : ''}`).join(' ')}`);
console.log(` 字体: ${JSON.stringify({ ...web.__fonts, loaded: web.__fonts.loaded.length })}`);
for (const [k, v] of Object.entries({ ...web, ...and })) {
  if (k.startsWith('__')) continue;
  const a = v.audit;
  console.log(` [${k}] 破图${v.broken} | 行 ${a.rows}(${a.rowH.join(',')}) | 皮肤行 ${a.skins}(${a.skinArt.join(',')}) | 技能 ${a.skills} 数值格 ${a.stats} 范围格 ${a.rangeCells} 模组 ${a.mods} 阶标 ${a.tiers} | 塌陷 ${a.zero} | 文字裁切 ${a.clipped.length ? a.clipped.join('/') : '无'}`);
}
console.log(` 圆标落点(CSS px): ${JSON.stringify(web['web-skin'].probes)}`);
console.log(` 皮肤段裁切: Web ${webDetail.css.width}x${webDetail.css.height} / 安卓 ${andDetail.css.width}x${andDetail.css.height}（CSS px，输出按 dsf 2 放大）`);
console.log(` 面板: ${report.panels} | 表行: ${report.rows} | 图片: ${report.imgs}（未加载 ${report.broken}）| 页面: ${report.w}x${report.h}`);
console.log(` 图注圆标: ${report.markers.map((m) => `${m.n}${m.inside ? '' : ':OUT'}`).join(' ')}`);
console.log(` 出界: ${report.offPage.length ? report.offPage.join(' ') : 'none'} | 裁切: ${report.clipped.length ? report.clipped.join(' ') : 'none'}`);
for (const s of report.split) console.log(` ${s.label.padEnd(20, '　')} → ${s.name}  ${s.w}x${s.h}, ${s.kb} KB`);
console.log(` 总览: fusion-dual-platform.png  ${main.w}x${main.h}, ${main.kb} KB`);

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
