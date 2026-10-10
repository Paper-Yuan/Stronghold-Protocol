// docs/mockups/render-voice-switch.mjs — 「干员调配 → 语音」每干员语音切换 UI（双端）参考图
//
// 这个界面**已经实现**（public/js/ui/voicePicker.js + public/js/voicePrefs.js + public/css/screens/loadout.css 的
// `.lo-voice*` / `.lo-sheet*` 块），所以本图不是「提案」而是**实景重建**：样式表、类名、字体、尺寸全部取自仓库源码，
// 唯一手写的是版面 HTML —— 它逐类照抄 VoiceView 的产物（同一个 data-* 属性、同一个 class 序列）。
//
//   风格基线  public/css/{theme,components,devices}.css + public/css/screens/loadout.css（本分支）
//            + public/fonts/fonts.css（Bender / Novecento Wide + Noto Sans SC）
//   版面      ui/voicePicker.js 的 VoiceView（桌面 = .lo-select 原生 select；手机 = .lo-voice__pick → .lo-sheet 底部弹出）
//   数据      public/data/{chess,assets,bonds}.json（官方）
//   尺寸      根字号 = clamp(24px, min(100vw/19.2, 100svh/10.8), 240px)：Web 1920×1080 → 1rem = 100px；
//            安卓横屏 844×390 → 1rem ≈ 36.1px。`<html>` 端类照 ui/device.js 打：
//            Web = `sp-hover sp-fs`，安卓 = `sp-touch sp-coarse sp-no-hover`（**绝不用 UA 或宽度**）。
//
// 自检（visual-judge 不可用，见记忆 visual-judge-unavailable）：每趟量出关键元素的实际矩形并打印，
// 手机趟断言底部弹出每一行的命中高度 ≥ 44px（--tap-min）。
//
// 用法：node docs/mockups/render-voice-switch.mjs   （Windows 自动探测 Chrome；或设 CHROME_PATH）
// 产物：docs/mockups/voice-switch-web.png    1920×1080（桌面：原生 select）
//      docs/mockups/voice-switch-phone.png  844×390（手机：整行按钮 + 底部弹出）
//      docs/mockups/voice-switch-dual.png   合成总览（两张图 + 端口说明）
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUB = path.join(ROOT, 'public');
const furl = (p) => pathToFileURL(p).href;

if (!process.env.CHROME_PATH) {
  const hit = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;
if (!CHROME || !existsSync(CHROME)) {
  console.error('找不到 Chrome：设 CHROME_PATH 指向 chrome.exe / chromium。');
  process.exit(1);
}
const puppeteer = (await import('puppeteer-core')).default;

// ---- 数据 ---------------------------------------------------------------------------------------------

const load = (f) => JSON.parse(readFileSync(path.join(PUB, 'data', f), 'utf8'));
const CHESS = load('chess.json');
const ASSETS = load('assets.json');
const BONDS = load('bonds.json');

const SEL_CHAR = 'char_172_svrash'; // 银灰：cn / jp 两条语音都在，图上「此干员单独设置：中文」有对照
const SEL = Object.values(CHESS).find((c) => c.charId === SEL_CHAR && c.tier === 6) || Object.values(CHESS).find((c) => c.charId === SEL_CHAR);
const BOND_IDS = (SEL.bonds || []).slice(0, 2);
const BOND_LIST = BOND_IDS.map((id) => BONDS[id]).filter(Boolean);

const assetUrl = (u) => (u ? furl(path.join(PUB, String(u).replace(/^\/+/, ''))) : null);
const portrait = assetUrl(ASSETS.chars?.[SEL_CHAR]?.portrait || ASSETS.chars?.[SEL_CHAR]?.avatar);
const bondIcon = (id) => assetUrl(ASSETS.bonds?.[id]);

// 名册条上的几张卡（同一屏的上下文；真实头像取自 assets.json）
const ROSTER = (() => {
  const seen = new Set();
  return Object.values(CHESS).filter((c) => {
    if (c.tier !== 6 || !c.visible || !c.charId || c.charId === SEL_CHAR || seen.has(c.charId)) return false;
    seen.add(c.charId); return true;
  }).slice(0, 6);
})();

// ---- 样式（全取仓库源码） -------------------------------------------------------------------------------

const readCss = (...p) => readFileSync(path.join(...p), 'utf8');
const FONTS_CSS = readCss(PUB, 'fonts/fonts.css').replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);
const REAL_CSS = [
  readCss(PUB, 'css/theme.css'),
  readCss(PUB, 'css/components.css'),
  readCss(PUB, 'css/devices.css'),
  readCss(PUB, 'css/screens/loadout.css'),
  FONTS_CSS,
].join('\n');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- 版面（逐类照抄 VoiceView / Detail 的产物） ---------------------------------------------------------

const VOICE_OPTIONS = [
  { value: '', label: '跟随全局', sub: '当前全局：日本語' },
  { value: 'cn', label: '中文', sub: '中文配音' },
  { value: 'jp', label: '日本語', sub: '日语配音（默认）' },
];
const OWN = 'cn';        // 图上这个干员单独设成中文
const EFFECTIVE = 'cn';  // 实际使用：中文

const voiceSection = () => `
  <section class="lo-sec lo-sec--voice" data-testid="voice-section" data-voice-char="${SEL_CHAR}">
    <header class="lo-sec__head">
      <h3><span class="ico ico--mic lo-sec__icon"></span>语音<span class="micro">VOICE</span></h3>
      <span class="lo-sec__note">此干员单独设置</span>
    </header>
    <div class="lo-voice">
      <span class="lo-voice__label">此干员语音</span>
      <span class="lo-select lo-voice__select">
        <select data-voice-select aria-label="此干员语音">
          ${VOICE_OPTIONS.map((o) => `<option value="${o.value}"${o.value === OWN ? ' selected' : ''}>${esc(o.value ? o.label : `${o.label}（日本語）`)}</option>`).join('')}
        </select>
      </span>
      <small class="lo-voice__note">仅保存在此浏览器；缺失的日语语音会回退到中文。</small>
    </div>
  </section>`;

const voiceSectionPhone = () => `
  <section class="lo-sec lo-sec--voice" data-testid="voice-section" data-voice-char="${SEL_CHAR}">
    <header class="lo-sec__head">
      <h3><span class="ico ico--mic lo-sec__icon"></span>语音<span class="micro">VOICE</span></h3>
      <span class="lo-sec__note">此干员单独设置</span>
    </header>
    <div class="lo-voice">
      <span class="lo-voice__label">此干员语音</span>
      <button type="button" class="lo-voice__pick" data-voice-open aria-haspopup="listbox" aria-expanded="true">
        <span class="lo-voice__val">
          <b>中文</b>
          <span class="lo-voice__eff">实际使用：中文</span>
        </span>
        <span class="ico ico--chevron"></span>
      </button>
      <small class="lo-voice__note">仅保存在此浏览器；缺失的日语语音会回退到中文。</small>
    </div>
  </section>`;

const voiceSheet = () => `
  <div class="lo-sheet" role="dialog" aria-modal="true" aria-label="此干员语音" data-voice-sheet>
    <div class="lo-sheet__backdrop"></div>
    <div class="lo-sheet__panel">
      <header class="lo-sheet__head">
        <b>此干员语音</b>
        <button type="button" class="lo-sheet__close" aria-label="关闭"><span class="ico ico--close"></span></button>
      </header>
      <div class="lo-sheet__list" role="listbox" aria-label="此干员语音">
        ${VOICE_OPTIONS.map((o) => `
          <button type="button" role="option" data-voice-opt="${o.value || 'global'}" aria-selected="${o.value === OWN ? 'true' : 'false'}"
            class="lo-sheet__opt${o.value === OWN ? ' is-on' : ''}">
            <span class="lo-sheet__opt-name">${esc(o.label)}</span>
            <span class="lo-sheet__opt-sub">${esc(o.sub)}</span>
            ${o.value === OWN ? '<span class="ico ico--check lo-sheet__opt-mark"></span>' : ''}
          </button>`).join('')}
      </div>
    </div>
  </div>`;

const rosterCard = (c) => `
  <button type="button" class="lo-card lo-card--t${c.tier}">
    <span class="lo-card__art">${(() => { const u = assetUrl(ASSETS.chars?.[c.charId]?.avatar); return u ? `<img src="${u}" alt="">` : ''; })()}</span>
    <span class="lo-card__name">${esc(c.name)}</span>
  </button>`;

const detailPanel = (phone) => `
  <aside class="lo-detail" aria-label="${esc(SEL.name)} 调配">
    <div class="lo-dhead">
      <div class="lo-dhead__art lo-dhead__art--t${SEL.tier}">${portrait ? `<img src="${portrait}" alt="">` : ''}</div>
      <div class="lo-dhead__info">
        <div class="lo-dhead__chips"><span class="lo-chip lo-chip--tier">${SEL.tier}★</span>
          <span class="lo-badge lo-badge--changed">已调整</span></div>
        <h2 class="lo-dhead__name">${esc(SEL.name)}</h2>
        <span class="lo-dhead__en">${esc(SEL.appellation || '')}</span>
        <span class="lo-dhead__class">${esc(SEL.profession || '')}</span>
        <span class="lo-dhead__bonds">${BOND_LIST.map((b) => `<span class="lo-bond">${(() => { const u = bondIcon(b.bondId); return u ? `<img class="lo-bond__icon" src="${u}" alt="">` : '<i class="lo-bond__dot"></i>'; })()}${esc(b.name)}</span>`).join('')}</span>
      </div>
      <button type="button" class="btn btn--ghost btn--sm lo-dhead__reset">恢复默认</button>
    </div>
    <div class="lo-dtabs" role="tablist" aria-label="调配项目">
      <button type="button" role="tab" aria-selected="false" class="lo-dtab">技能 <span class="lo-dtab__en num">SKILL</span></button>
      <button type="button" role="tab" aria-selected="false" class="lo-dtab">模组 <span class="lo-dtab__en num">MODULE</span></button>
      <button type="button" role="tab" aria-selected="false" class="lo-dtab">数值 <span class="lo-dtab__en num">STATS</span></button>
      <button type="button" role="tab" aria-selected="false" class="lo-dtab">换装 <span class="lo-dtab__en num">SKIN</span></button>
      <button type="button" role="tab" aria-selected="true" class="lo-dtab is-on">语音 <span class="lo-dtab__en num">VOICE</span></button>
    </div>
    <div class="lo-detail__body">
      ${phone ? voiceSectionPhone() : voiceSection()}
    </div>
  </aside>`;

const stage = (phone) => `
  <div class="lo">
    <div class="lo-top">
      <button type="button" class="lo-back">返回</button>
      <span class="lo-title">干员调配</span>
    </div>
    <div class="lo-body${phone ? ' is-detail' : ''}">
      <section class="lo-roster">
        <div class="lo-filters"><span class="lo-chip lo-chip--on">全部</span><span class="lo-chip">已调整</span></div>
        <div class="lo-grid">${ROSTER.map(rosterCard).join('')}</div>
      </section>
      <div class="lo-detail-wrap">${detailPanel(phone)}</div>
    </div>
    ${phone ? voiceSheet() : ''}
  </div>`;

const page = (phone) => `<!doctype html><html lang="zh-CN" class="${phone ? 'sp-touch sp-coarse sp-no-hover' : 'sp-hover sp-fs'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>干员调配 · 语音</title>
<style>${REAL_CSS}
html, body { margin: 0; background: var(--bg-0); }
/* 图标：源码用 components.js 的 <Icon>（内联 SVG），这里用同尺寸的方块占位，不改变任何布局尺寸 */
.ico { display: inline-block; width: max(.18rem, 12px); height: max(.18rem, 12px); border: 1px solid var(--mint-700); border-radius: 2px; opacity: .85; }
.ico--mic { width: max(.16rem, 11px); height: max(.16rem, 11px); }
</style></head>
<body>${stage(phone)}</body></html>`;

// ---- 渲染 ---------------------------------------------------------------------------------------------

const TMP = path.join(HERE, '.voice-tmp');
mkdirSync(TMP, { recursive: true });
const htmlFile = (phone) => {
  const f = path.join(TMP, phone ? 'phone.html' : 'web.html');
  writeFileSync(f, page(phone), 'utf8');
  return furl(f);
};

const PASSES = [
  { name: 'web', file: 'voice-switch-web.png', width: 1920, height: 1080, mobile: false, cls: 'sp-hover sp-fs', html: htmlFile(false) },
  { name: 'phone', file: 'voice-switch-phone.png', width: 740, height: 390, mobile: true, cls: 'sp-touch sp-coarse sp-no-hover', html: htmlFile(true) },
];

const audit = (name) => `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const rows = [...document.querySelectorAll('.lo-sheet__opt')].map(r);
  const out = {
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    section: r(document.querySelector('.lo-sec--voice')),
    select: r(document.querySelector('[data-voice-select]')),
    pick: r(document.querySelector('[data-voice-open]')),
    sheet: r(document.querySelector('.lo-sheet__panel')),
    rows,
    note: (document.querySelector('.lo-voice__note') || {}).textContent || null,
    eff: (document.querySelector('.lo-voice__eff') || {}).textContent || null,
  };
  return out;
})()`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
const reports = {};
try {
  for (const p of PASSES) {
    const pageObj = await browser.newPage();
    await pageObj.setViewport({ width: p.width, height: p.height, deviceScaleFactor: 1, isMobile: p.mobile, hasTouch: p.mobile });
    await pageObj.evaluateOnNewDocument((cls) => { document.documentElement.className = cls; }, p.cls);
    await pageObj.goto(p.html, { waitUntil: 'load' });
    await pageObj.evaluate(() => document.fonts && document.fonts.ready);
    await pageObj.evaluate(async () => { await new Promise((r) => setTimeout(r, 120)); });
    const rep = await pageObj.evaluate(audit(p.name));
    reports[p.name] = rep;
    await pageObj.screenshot({ path: path.join(HERE, p.file), clip: { x: 0, y: 0, width: p.width, height: p.height } });
    await pageObj.close();
    console.log(`[${p.name}] rem=${rep.rem}px  section=${JSON.stringify(rep.section)}  select=${JSON.stringify(rep.select)}  pick=${JSON.stringify(rep.pick)}`);
    if (rep.rows.length) console.log(`[${p.name}] sheet rows (h): ${rep.rows.map((x) => x.h).join(', ')}  eff=${JSON.stringify(rep.eff)}`);
  }

  // 自检：手机趟底部弹出每一行 ≥ --tap-min(44px)，桌面趟是原生 select（没有 pick 按钮）
  const ph = reports.phone;
  if (!ph.pick) throw new Error('手机趟没有整行按钮');
  if (ph.select) throw new Error('手机趟不该有原生 select');
  if (ph.rows.length !== 3) throw new Error(`底部弹出应有 3 行，实得 ${ph.rows.length}`);
  const minRow = Math.min(...ph.rows.map((x) => x.h));
  if (minRow < 44) throw new Error(`底部弹出命中区 ${minRow}px < 44px`);
  const web = reports.web;
  if (!web.select) throw new Error('桌面趟没有原生 select');
  if (web.pick) throw new Error('桌面趟不该有整行按钮');
  console.log(`自检通过：手机底部弹出 3 行，最小命中区 ${minRow}px ≥ 44px；桌面原生 select 高 ${web.select.h}px。`);

  // ---- 合成总览 ----
  const sheet = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0a0d0c; color: #e6efec; font-family: "Noto Sans SC", system-ui, sans-serif; padding: 34px 40px 44px; }
  h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: .06em; }
  .sub { color: #8fa39d; font-size: 15px; margin-bottom: 24px; }
  .row { display: flex; gap: 28px; align-items: flex-start; }
  figure { margin: 0; flex: 1 1 0; min-width: 0; }
  figure img { width: 100%; border: 1px solid #2a3a35; display: block; }
  figcaption { margin-top: 10px; font-size: 15px; color: #cfe0da; line-height: 1.6; }
  figcaption b { color: #4ed8af; }
  .rules { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px 34px; font-size: 15px; line-height: 1.7; color: #cfe0da; }
  .rules h2 { margin: 0 0 4px; font-size: 17px; color: #4ed8af; letter-spacing: .04em; }
  code { background: #16211d; padding: 1px 5px; border-radius: 3px; color: #9fe3cd; font-size: 13.5px; }
  </style></head><body>
  <h1>干员调配 → 语音：每干员语音语言切换</h1>
  <div class="sub">同一条全局语言（默认<b>日语</b>）+ 一张按干员的覆盖表（<code>settings.voiceOverrides</code>，仅存本机）。左：Web 1920×1080（<code>sp-hover sp-fs</code>）；右：安卓横屏 740×390（手机布局：详情面板盖住名册）（<code>sp-touch sp-coarse sp-no-hover</code>）。</div>
  <div class="row">
    <figure><img src="${furl(path.join(HERE, 'voice-switch-web.png'))}"><figcaption><b>桌面</b>：原生 <code>&lt;select&gt;</code>，一行放下三档 —— 跟随全局（日本語）/ 中文 / 日本語；当前项即所选。</figcaption></figure>
    <figure><img src="${furl(path.join(HERE, 'voice-switch-phone.png'))}"><figcaption><b>手机</b>：整行按钮（≥44px）→ <b>底部弹出</b>大按钮列表，每行 ≥44px，当前项打勾；<code>sp-coarse</code> 判定，不看 UA / 宽度。</figcaption></figure>
  </div>
  <div class="rules">
    <div><h2>判定与命中区</h2>端类来自 <code>ui/device.js</code> 的特性探测：<code>sp-hover</code> = 桌面增强层，<code>sp-coarse</code> = 触摸层。命中区用 <code>--tap-min: 44px</code>（<code>devices.css</code>）。</div>
    <div><h2>语言与回退</h2>该干员的语言 = 覆盖表里的条目，否则跟随全局；选中的语言缺台词时回退到另一种语言，再退到不分语言的旧扁平结构（<code>audio.js voice()</code>）。</div>
    <div><h2>数据模型</h2><code>public/js/voicePrefs.js</code>：<code>VOICE_LANGS = ['cn','jp']</code>、<code>sanitizeVoiceOverrides</code>（charId 形状 + 语言白名单，上限 512）、<code>voiceLangFor</code>。</div>
    <div><h2>落地位置</h2>干员调配详情面板的第 5 个子页「语音 VOICE」（与 换装 SKIN 并列）；刻意不进 wire 协议（<code>room.loadout</code>），是本机偏好。</div>
  </div>
  </body></html>`;
  const sheetFile = path.join(TMP, 'sheet.html');
  writeFileSync(sheetFile, sheet, 'utf8');
  const sp = await browser.newPage();
  await sp.setViewport({ width: 1760, height: 1180, deviceScaleFactor: 1 });
  await sp.goto(furl(sheetFile), { waitUntil: 'load' });
  await sp.evaluate(async () => { await new Promise((r) => setTimeout(r, 200)); });
  const box = await sp.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await sp.setViewport({ width: 1760, height: Math.min(2400, box.h + 8), deviceScaleFactor: 1 });
  await sp.screenshot({ path: path.join(HERE, 'voice-switch-dual.png') });
  await sp.close();
  console.log(`产物：voice-switch-web.png / voice-switch-phone.png / voice-switch-dual.png（${1760}×${Math.min(2400, box.h + 8)}）`);
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
