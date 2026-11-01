// devtools/render-check-overlimit-preview.mjs — 超限娱乐化原型页的可视/交互自检
//
//   SP_BASE=http://127.0.0.1:3018 SP_VIEWPORT=1280x720 node devtools/render-check-overlimit-preview.mjs
//
// 检查：4 个 tab 可切换、档案 R60 显示 NEW RECORD、词条重抽后卡面变化且次数归零、
// 契约选择后摘要更新、无横向溢出、无控制台错误；每个 tab 截图。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3018';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
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
page.on('response', (r) => { if (r.status() === 404) errors.push('404 ' + r.url()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE + '/dev/overlimit-preview.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(900);

const base = await page.evaluate(() => ({
  title: document.title,
  tabs: document.querySelectorAll('.olo-tab').length,
  views: document.querySelectorAll('.olo-view').length,
  overflowX: document.documentElement.scrollWidth > innerWidth + 1,
}));
console.log('base:', JSON.stringify(base));

async function shot(tab, name) {
  await page.evaluate((t) => document.querySelector(`.olo-tab[data-tab="${t}"]`)?.click(), tab);
  await wait(280);
  await page.screenshot({ path: `${OUT}/olo-${name}-${vw}x${vh}.png` });
  return page.evaluate((t) => {
    const v = document.querySelector(`.olo-view[data-view="${t}"]`);
    return { visible: !!v && getComputedStyle(v).display !== 'none' };
  }, tab);
}
console.log('file tab:', JSON.stringify(await shot('file', 'file')));
await page.evaluate(() => document.querySelector('#file-switch button[data-set="60"]')?.click());
await wait(200);
const file60 = await page.evaluate(() => ({
  round: document.querySelector('#file-round')?.textContent,
  newBadge: getComputedStyle(document.querySelector('#file-new')).display,
  kills: document.querySelectorAll('#file-kills li').length,
}));
console.log('file R60:', JSON.stringify(file60));

console.log('trait tab:', JSON.stringify(await shot('trait', 'trait')));
const before = await page.evaluate(() => [...document.querySelectorAll('.olo-tcard__name')].map((x) => x.textContent));
await page.evaluate(() => document.querySelector('#trait-reroll')?.click());
await wait(300);
const after = await page.evaluate(() => ({
  names: [...document.querySelectorAll('.olo-tcard__name')].map((x) => x.textContent),
  rerollDisabled: document.querySelector('#trait-reroll')?.disabled,
  rerollText: document.querySelector('#trait-reroll')?.textContent,
}));
console.log('reroll:', JSON.stringify({ before, after }));

console.log('affix tab:', JSON.stringify(await shot('affix', 'affix')));
await page.evaluate(() => document.querySelectorAll('#affix-list .olo-affix')[1]?.click());
await wait(200);
const affix = await page.evaluate(() => document.querySelector('#affix-title')?.textContent);
console.log('affix switched:', affix);

console.log('contract tab:', JSON.stringify(await shot('contract', 'contract')));
await page.evaluate(() => document.querySelectorAll('#contract-cards .olo-ccard')[1]?.click());
await wait(200);
const c = await page.evaluate(() => ({
  name: document.querySelector('#contract-name')?.textContent,
  reward: document.querySelector('#contract-reward')?.textContent,
  hud: document.querySelector('#hud-contract')?.textContent,
}));
console.log('contract:', JSON.stringify(c));

const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('\noverflowX:', overflowX, 'errors:', own.length);
for (const e of [...new Set(own)].slice(0, 8)) console.log('  ' + e);
await browser.close();

const ok = base.tabs === 4 && base.views === 4 && !base.overflowX && !overflowX
  && file60.round === '60' && file60.newBadge !== 'none'
  && before.join('|') !== after.names.join('|') && after.rerollDisabled === true
  && affix === '召唤'
  && c.name && c.name !== '未选择' && c.hud.includes(c.name)
  && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 原型页在 ${vw}×${vh} 可切换/可交互、无溢出、0 错误` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
