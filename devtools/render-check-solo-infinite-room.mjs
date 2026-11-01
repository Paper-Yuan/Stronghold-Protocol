// devtools/render-check-solo-infinite-room.mjs — 单人超限房间显示复现
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-solo-infinite-room.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);
await page.evaluate(async () => {
  const i = document.querySelector('.title-login input, input[type="text"]');
  i.value = `si-${Math.floor(Math.random() * 900 + 100)}`;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2500);
const created = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.create', { mode: 'solo_infinite', difficulty: 'ABYSS' });
    await new Promise((r) => setTimeout(r, 900));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
await wait(600);
const room = await page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 600);
  return {
    mode: s.room?.mode,
    seats: (s.room?.seats || []).filter(Boolean).length,
    seatSlots: (s.room?.seats || []).length,
    hostId: s.room?.hostId,
    modeId: s.match?.public?.modeId ?? null,
    hasAI: (s.room?.seats || []).some((x) => x && x.isBot),
    text,
  };
});
console.log('created:', JSON.stringify(created));
console.log('room:', JSON.stringify(room, null, 2));
await page.screenshot({ path: 'E:/Workbox/.session-dump/shots/solo-infinite-room.png' });
console.log('errors:', errors.length);
await browser.close();
