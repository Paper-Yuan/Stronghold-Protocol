// devtools/render-check-infinite-option.mjs — 超限作为难度列表特殊项（紫色）+ 单人建房
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-infinite-option.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.round(Number(n) || 0));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`] });
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);
await page.evaluate(async () => {
  const i = document.querySelector('.title-login input, input[type="text"]');
  i.value = `ifo-${Math.floor(Math.random() * 900 + 100)}`;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);

const modeCards = await page.evaluate(() => [...document.querySelectorAll('.mode-card')].map((b) => b.dataset.mode));
console.log('mode cards:', JSON.stringify(modeCards));

await page.evaluate(() => document.querySelector('.mode-card[data-mode="solo"]')?.click());
await wait(800);
const list = await page.evaluate(() => {
  const sel = (root) => [...document.querySelectorAll(`${root} .diff-card`)];
  const cards = [...sel('.proto-list'), ...sel('.proto-list__special')];
  return cards.map((b) => ({
    d: b.dataset.difficulty,
    special: b.dataset.special || null,
    name: (b.querySelector('.pcard__name') || {}).textContent,
    color: getComputedStyle(b.querySelector('.pcard__name') || b).color,
    cls: b.className,
  }));
});
console.log('difficulty list:', JSON.stringify(list, null, 2));
const geom = await page.evaluate(() => {
  const l = document.querySelector('.proto-list');
  const special = document.querySelector('.proto-list__special .diff-card');
  const r = (el) => { const b = el.getBoundingClientRect(); return { y: Math.round(b.top), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  return {
    fit: document.querySelector('.proto__body')?.dataset.fit || null,
    list: r(l), scrollH: l.scrollHeight, clientH: l.clientHeight,
    special: special ? r(special) : null,
    inView: special ? special.getBoundingClientRect().top >= 0 && special.getBoundingClientRect().bottom <= innerHeight : false,
  };
});
console.log('geom:', JSON.stringify(geom));

// 先截「列表全景」（未选中），证明第 5 项在视口内；再点击它验证选中态与建房
await page.evaluate(() => { const l = document.querySelector('.proto-list'); if (l) l.scrollTop = l.scrollHeight; });
await wait(250);
await page.screenshot({ path: `${OUT}/infinite-option-${vw}x${vh}.png` });
await page.evaluate(() => document.querySelector('.proto-list__special .diff-card')?.click());
await wait(900);
await page.screenshot({ path: `${OUT}/infinite-option-selected-${vw}x${vh}.png` });
const selected = await page.evaluate(() => ({
  difficulty: document.querySelector('.proto__body')?.dataset.difficulty,
  name: (document.querySelector('.proto-brief__name') || {}).textContent,
}));
console.log('selected:', JSON.stringify(selected));

await page.evaluate(() => [...document.querySelectorAll('.proto-start')].find((b) => /开始独立模拟|开始/.test(b.textContent || ''))?.click());
await wait(1600);
const room = await page.evaluate(() => {
  const r = globalThis.__SP__.store.get().room;
  return { mode: r?.mode, difficulty: r?.difficulty, seats: (r?.seats || []).filter(Boolean).length };
});
console.log('room:', JSON.stringify(room));
await page.screenshot({ path: `${OUT}/infinite-room-${vw}x${vh}.png` });

const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length);
await browser.close();

const last = list.find((x) => x.special === 'infinite') || list[list.length - 1];
const ok = modeCards.length === 2 && !modeCards.includes('solo_infinite') && !modeCards.includes('coop_infinite')
  && list.length >= 5 && last && last.special === 'infinite' && /超限/.test(last.name || '')
  && last.cls.includes('is-infinite') && geom.inView
  && selected.difficulty === 'INFINITE'
  && room.mode === 'solo_infinite' && room.seats === 1
  && own.length === 0;
console.log('\nRESULT:', ok ? `OK — ${vw}×${vh}：难度列表末项为紫色「超限模拟」，创建的是单人超限房间（1 座）` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
