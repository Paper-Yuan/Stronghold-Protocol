// devtools/render-check-mobile-ui.mjs — 手机端的 mod / 脚本控制台可用性
//
// 1) 对局里的 插件面板（把脚本/内容 mod 装进游戏的实际入口）：用代表性 DOM 量列表滚动、行高与 44px 触控目标；
// 2) /studio/console.html（脚本控制台）：量布局是否单列、画布是否在视口内、页面是否横向溢出、密钥输入是否可见。
//
//   SP_BASE=http://127.0.0.1:3016 SP_VIEWPORT=667x375 node devtools/render-check-mobile-ui.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '667x375').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`],
});
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);

const panel = await page.evaluate(async () => {
  const { render } = await import('/vendor/preact.module.js');
  const { html } = await import('/js/ui/components.js');
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999', background: 'rgba(0,0,0,.6)' });
  document.body.append(host);
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => html`<li class="plugrow" key=${i}>
    <span class="plugrow__switch"><button type="button">开</button></span>
    <span class="plugrow__body"><span class="plugrow__name">测试脚本插件 ${i} <b class="plugrow__badge">脚本（沙箱）</b></span>
      <span class="plugrow__meta">v1.0 · 作者 · 非官方</span></span>
  </li>`);
  render(html`<div class="modal__box" style="position:fixed;left:8px;right:8px;top:8px;bottom:8px;overflow:auto">
    <div class="plugpanel"><p class="plugpanel__lead">房间的插件（脚本 / 内容模组）</p>
      <ul class="plugpanel__list">${rows}</ul>
      <div class="plugpanel__modes"><button class="dpick__opt">原版模式</button><button class="dpick__opt">测试模式</button></div>
    </div></div>`, host);
  await new Promise((r) => setTimeout(r, 250));
  const row = host.querySelector('.plugrow');
  const list = host.querySelector('.plugpanel__list');
  const btn = host.querySelector('.plugrow__switch button');
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const r = rect(row), b = rect(btn);
  const res = {
    rowHeight: r ? Math.round(r.height) : 0,
    switchSize: b ? [Math.round(b.width), Math.round(b.height)] : [0, 0],
    maxListHeight: list ? getComputedStyle(list).maxHeight : null,
    scrollable: list ? list.scrollHeight > list.clientHeight : false,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
  host.remove();
  return res;
});
console.log('plugin panel:', JSON.stringify(panel));
await page.screenshot({ path: `${OUT}/10-plugin-panel-${vw}x${vh}.png` });

await page.goto(BASE + '/studio/console.html' + (process.env.SP_STUDIO_KEY ? `#key=${process.env.SP_STUDIO_KEY}` : ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(2600);
const consolePage = await page.evaluate(() => {
  const layout = document.querySelector('.sc-layout');
  const canvas = document.querySelector('.sc-canvas');
  const key = document.querySelector('.sc-key input[type=password]');
  const cs = layout ? getComputedStyle(layout) : null;
  const c = canvas ? canvas.getBoundingClientRect() : null;
  return {
    layout: !!layout,
    columns: cs ? cs.gridTemplateColumns.split(' ').length : 0,
    canvas: c ? { w: Math.round(c.width), h: Math.round(c.height), inside: c.top >= 0 && c.bottom <= innerHeight + 1 } : null,
    key: !!key,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    title: document.title,
  };
});
console.log('studio console:', JSON.stringify(consolePage));
await page.screenshot({ path: `${OUT}/11-studio-console-${vw}x${vh}.png` });

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const ok = panel.rowHeight >= 44 && panel.switchSize[0] >= 44 && panel.switchSize[1] >= 44
  && panel.scrollable && !panel.overflowX
  && consolePage.layout && consolePage.columns === 1 && consolePage.canvas && consolePage.canvas.w > 0
  && !consolePage.overflowX && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 手机端 mod 面板与脚本控制台在 ${vw}×${vh} 可用` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
