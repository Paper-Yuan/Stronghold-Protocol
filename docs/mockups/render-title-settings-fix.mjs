// docs/mockups/render-title-settings-fix.mjs — 首页连接行「设置键过大」的修复对照图
//
// 症状（用户报）：安卓端首页的设置键看着太大。实测根因在 public/css/mobile.css：
//   `.sp-coarse .title-settings { width/height: max(.36rem, 36px) }` 把设置键画成 36px 方块，
//   而同一排的全屏键（`.title-fs`）只有 devices.css 的 `.title-fs, .title-settings { .4rem }`；
//   连接行本身 `.title-conn { min-height: .32rem }`。本机（2376×1080 @dpr1.85 ⇒ CSS 1284×584，1rem≈66.9px）
//   实际是：设置键 36px、全屏键 26.8px、整行 21.4px ⇒ 设置键比同排大 1/3、比整行高 1.7 倍。
//
// 本图左右并排：左 = 修复前（注入旧规则），右 = 修复后（真实样式表）。两边的控件矩形都在页面里量出来打印。
// 样式全部取自仓库源码（theme/components/devices/mobile/screens/title.css），版面逐类照抄 title.js 的产物。
//
// 用法：node docs/mockups/render-title-settings-fix.mjs   （Windows 自动探测 Chrome；或设 CHROME_PATH）
// 产物：docs/mockups/title-settings-size.png
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
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;
if (!CHROME || !existsSync(CHROME)) { console.error('找不到 Chrome：设 CHROME_PATH。'); process.exit(1); }
const puppeteer = (await import('puppeteer-core')).default;

const readCss = (...p) => readFileSync(path.join(...p), 'utf8');
const FONTS_CSS = readCss(PUB, 'fonts/fonts.css').replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);
const REAL_CSS = [
  readCss(PUB, 'css/theme.css'),
  readCss(PUB, 'css/components.css'),
  readCss(PUB, 'css/devices.css'),
  readCss(PUB, 'css/mobile.css'),
  readCss(PUB, 'css/screens/title.css'),
  FONTS_CSS,
].join('\n');

// 修复前的旧规则（只影响 .before 那一列，用来并排对照）
const OLD_RULE = `
.sp-coarse .before .title-settings { width: max(.36rem, 36px) !important; height: max(.36rem, 36px) !important; min-width: 36px !important; min-height: 36px !important; }
.sp-coarse .before .title-settings .icon, .sp-coarse .before .title-settings svg { width: 18px !important; height: 18px !important; }
`;

/** 连接行：status-dot + 状态文字 + ping + 玩法说明 + 设置 + 全屏（逐类照抄 title.js:322-329 / 各组件产物）。 */
const connRow = () => `
  <div class="title-conn">
    <span class="status-dot is-on"></span>
    <span>已连接服务器</span>
    <span class="ping ping--low"><span class="ping__icon ico"></span><b class="num">2</b><span>ms</span></span>
    <button type="button" class="btn btn--ghost btn--sm guide-btn title-guide"><span class="ico"></span>玩法说明</button>
    <button type="button" class="btn btn--secondary btn--sm fsbtn title-settings tapx" aria-label="设置" title="设置"><span class="ico ico--gear"></span></button>
    <button type="button" class="btn btn--secondary btn--sm fsbtn title-fs" aria-label="全屏"><span class="ico"></span></button>
  </div>`;

const page = () => `<!doctype html><html lang="zh-CN" class="sp-touch sp-coarse sp-no-hover">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>首页设置键尺寸对照</title>
<style>${REAL_CSS}${OLD_RULE}
html, body { margin: 0; background: #070a09; color: #e6efec; }
.wrap { display: flex; flex-direction: column; gap: 22px; padding: 18px 22px 26px; }
.pane { border: 1px solid #24322d; background: #0b100f; padding: 12px 14px 16px; }
.pane h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: .06em; color: #4ed8af; font-weight: 800; }
.pane.before h2 { color: #ff8a5c; }
.hint { font-size: 12px; color: #8fa39d; margin-top: 8px; }
/* 图标占位（源码是内联 SVG，这里用同尺寸方块，不改任何布局尺寸） */
.ico { display: inline-block; width: max(.16rem, 11px); height: max(.16rem, 11px); border: 1px solid #2a9e7f; border-radius: 2px; opacity: .85; }
.ico--gear { border-radius: 50%; }
</style></head>
<body><div class="wrap">
  <div class="pane before"><h2>修复前：设置键 max(.36rem, 36px)</h2>${connRow()}<div class="hint">设置键明显比同排的全屏键大，也比整行高出一截。</div></div>
  <div class="pane"><h2>修复后：设置键 = 全屏键 = max(.4rem, 26px)</h2>${connRow()}<div class="hint">两个键同尺寸；44px 命中区仍由 devices.css 的 .fsbtn::before 提供。</div></div>
</div></body></html>`;

const measure = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const out = { rem: +parseFloat(getComputedStyle(document.documentElement).fontSize).toFixed(2), panes: [] };
  for (const pane of document.querySelectorAll('.pane')) {
    const row = pane.querySelector('.title-conn');
    const st = pane.querySelector('.title-settings');
    const fs = pane.querySelector('.title-fs');
    const cs = st ? getComputedStyle(st, '::before') : null;
    out.panes.push({
      before: pane.classList.contains('before'),
      row: r(row),
      settings: r(st),
      fullscreen: r(fs),
      hitBefore: cs ? { w: cs.width, h: cs.height } : null,
    });
  }
  return out;
})()`;

const TMP = path.join(HERE, '.title-tmp');
mkdirSync(TMP, { recursive: true });
const f = path.join(TMP, 'p.html');
writeFileSync(f, page(), 'utf8');

const W = 1284, H = 584, DSF = 1.85; // 与设备一致：2376×1080 物理像素 ⇒ CSS 1284×584 @dpr1.85
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: DSF, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => { document.documentElement.className = 'sp-touch sp-coarse sp-no-hover'; });
  await p.goto(furl(f), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts && document.fonts.ready);
  await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 150)); });
  const rep = await p.evaluate(measure);
  console.log('rem =', rep.rem, 'px  (CSS 视口 ' + W + '×' + H + ' @dpr' + DSF + ' ⇒ 物理 ' + Math.round(W * DSF) + '×' + Math.round(H * DSF) + ')');
  for (const pane of rep.panes) {
    console.log(`${pane.before ? '修复前' : '修复后'}: 整行 ${pane.row.h}px | 设置键 ${pane.settings.w}×${pane.settings.h} | 全屏键 ${pane.fullscreen.w}×${pane.fullscreen.h} | 设置键命中区 ${pane.hitBefore ? pane.hitBefore.w + '×' + pane.hitBefore.h : 'n/a'}`);
  }
  const [before, after] = rep.panes;
  if (!(before.settings.h > after.settings.h)) throw new Error('修复后的设置键没有变小？');
  if (Math.abs(after.settings.h - after.fullscreen.h) > 1) throw new Error(`修复后设置键(${after.settings.h})与全屏键(${after.fullscreen.h})仍不一致`);
  if (parseFloat(after.hitBefore.h) < 44) throw new Error(`命中区 ${after.hitBefore.h} < 44px`);
  console.log(`自检通过：设置键 ${before.settings.h}px → ${after.settings.h}px，与全屏键一致；命中区 ${after.hitBefore.h}（≥44px）。`);

  const box = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await p.setViewport({ width: W, height: Math.min(2000, box.h + 4), deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.screenshot({ path: path.join(HERE, 'title-settings-size.png') });
  console.log('产物：docs/mockups/title-settings-size.png');
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
