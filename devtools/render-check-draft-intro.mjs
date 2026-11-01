// devtools/render-check-draft-intro.mjs — 「选择策略」过场（pboot/tbanner）位置检查
//
// 进入 solo 局，停在 BAND_DRAFT，量 .pboot / .pcardx / .pboot__title / .tbanner 的矩形并截图。
//   SP_BASE=http://127.0.0.1:3020 SP_VIEWPORT=1280x720 node devtools/render-check-draft-intro.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
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
  input.value = `draft-${Math.floor(Math.random() * 900 + 100)}`;
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
// 只确认信息，不点策略，停在 BAND_DRAFT
await page.evaluate(async () => {
  const app = globalThis.__SP__;
  for (let i = 0; i < 12; i++) {
    const pub = app.store.get().match?.public;
    if (pub?.phase === 'BAND_DRAFT') break;
    if (pub?.phase === 'INFO_CHECK') await app.net.request('g.infoReady', { setupRevision: pub.setupRevision ?? 0 });
    await new Promise((r) => setTimeout(r, 700));
  }
});
await wait(900);

const rect = (s) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
}, s);
const out = {
  phase: await page.evaluate(() => globalThis.__SP__.store.get().match?.public?.phase),
  pboot: await rect('.pboot'),
  stage: await rect('.pboot__stage'),
  card: await rect('.pcardx'),
  title: await rect('.pboot__title'),
  sub: await rect('.pboot__sub'),
  banner: await rect('.tbanner'),
  band: await rect('.tbanner__band'),
  draftMain: await rect('.draft__main'),
};
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: `${OUT}/draft-intro-${vw}x${vh}.png` });
const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length);
await browser.close();

const band = out.band;
const centered = !!band && Math.abs(band.cy - vh / 2) <= 2;
// 横幅动画末段有 translateX(1.2%)（1280 下约 15px），测量时可能仍在播放：给 24px 容差
const inside = !!band && band.x >= -24 && band.y >= -1 && band.x + band.w <= vw + 24 && band.y + band.h <= vh + 1;
const ok = out.phase === 'BAND_DRAFT' && centered && inside && own.length === 0;
console.log('\nRESULT:', ok
  ? `OK — 选择策略横幅在 ${vw}×${vh} 垂直居中（cy ${band.cy} / 中心 ${vh / 2}），未越界`
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
