// devtools/render-check-bonds.mjs — 盟约条居中 + 下侧向上收起（业主 2026-10-26）
//
// 进入 solo 对局 → 量 .gm__bonds 中心与视口中心 → 点收起 → 列表 hidden、容器变矮、图标向上 →
// 再点展开恢复。手机 / 桌面各跑一次。
//
//   SP_BASE=http://127.0.0.1:3020 SP_VIEWPORT=667x375 node devtools/render-check-bonds.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '667x375').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`],
});
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1500);
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = `bond-${Math.floor(Math.random() * 900 + 100)}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);
await page.evaluate(async () => {
  await globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
  await new Promise((r) => setTimeout(r, 500));
  await globalThis.__SP__.net.request('room.start', {});
});
await wait(1200);
await page.evaluate(async () => {
  const app = globalThis.__SP__;
  for (let i = 0; i < 16; i++) {
    const pub = app.store.get().match?.public;
    if (document.querySelector('.gm')) break;
    try {
      if (pub?.phase === 'INFO_CHECK') await app.net.request('g.infoReady', { setupRevision: pub.setupRevision ?? 0 });
      else if (pub?.phase === 'BAND_DRAFT') {
        const bands = Object.keys(app.data.get('bands') || {});
        if (bands[0]) await app.net.request('g.band', { bandId: bands[0] });
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 900));
  }
});
await wait(2200);
// 等「协议启动」/回合过场结束，避免在过场画面上量 HUD
try {
  await page.waitForFunction(() => !document.querySelector('.pboot'), { timeout: 20000 });
} catch { /* 过场可能更久，继续量 */ }
await wait(600);

const measure = () => page.evaluate(() => {
  const el = document.querySelector('.gm__bonds');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const list = document.querySelector('#match-bond-strip');
  const btn = el.querySelector('.bonds-toggle');
  const icon = btn?.querySelector('svg, .icon');
  const team = document.querySelector('.team')?.getBoundingClientRect();
  const shop = document.querySelector('.shopbar, .gshop')?.getBoundingClientRect();
  const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return {
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    centerDx: Math.round((r.left + r.width / 2) - innerWidth / 2),
    // 2026-10-29：盟约条改成「小收」——不再 `hidden`，而是 `.gm__bonds.is-collapsed`（槽宽缩到 .4rem、只留圆盘）。
    isCollapsed: !!document.querySelector('.gm__bonds.is-collapsed'),
    ariaExpanded: btn?.getAttribute('aria-expanded'),
    icon: icon ? (icon.getAttribute('data-icon') || icon.getAttribute('name') || icon.className?.baseVal || String(icon.className)) : null,
    overlapTeam: overlaps(r, team),
    overlapShop: overlaps(r, shop),
    shopRect: shop ? { x: Math.round(shop.left), y: Math.round(shop.top), w: Math.round(shop.width), h: Math.round(shop.height) } : null,
  };
});

const before = await measure();
console.log('before:', JSON.stringify(before));
await page.screenshot({ path: `${OUT}/bonds-open-${vw}x${vh}.png` });
await page.evaluate(() => document.querySelector('.gm__bonds .bonds-toggle')?.click());
await wait(350);
const collapsed = await measure();
console.log('collapsed:', JSON.stringify(collapsed));
await page.screenshot({ path: `${OUT}/bonds-collapsed-${vw}x${vh}.png` });
await page.evaluate(() => document.querySelector('.gm__bonds .bonds-toggle')?.click());
await wait(350);
const again = await measure();
console.log('again:', JSON.stringify(again));

const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length);
await browser.close();

const nearCenter = Math.abs(before.centerDx) <= 2;
const ok = !!before && nearCenter && !before.isCollapsed && before.ariaExpanded === 'true'
  && collapsed && collapsed.isCollapsed && collapsed.ariaExpanded === 'false'
  && collapsed.rect.h <= before.rect.h && collapsed.centerDx === before.centerDx
  && again && !again.isCollapsed && again.rect.h === before.rect.h
  && !before.overlapTeam && !before.overlapShop
  && own.length === 0;
console.log('\nRESULT:', ok
  ? `OK — 盟约条在 ${vw}×${vh} 底部居中（偏差 ${before.centerDx}px），可下侧向上收起/展开`
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
