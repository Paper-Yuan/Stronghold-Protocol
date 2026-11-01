// devtools/render-check-chat-live.mjs — 真实服务器上的房间聊天 + 弹幕（手机视口）
//
// 前置：普通测试服即可（不需要插件）：
//   $env:PORT='3016'; node server/index.js
// 流程：进大厅 → room.create(coop) → 点开房间聊天（手机默认收起）→ 通过 net 发 room.chat →
// 校验日志气泡、弹幕层文字、无控制台错误。
//
//   SP_BASE=http://127.0.0.1:3016 SP_VIEWPORT=667x375 node devtools/render-check-chat-live.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3016';
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
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = `chat-${Math.floor(Math.random() * 900 + 100)}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);
const created = await page.evaluate(async () => {
  try { await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }); return true; }
  catch (e) { return String(e?.message || e); }
});
console.log('room.create:', created);
await wait(1500);

const opened = await page.evaluate(() => {
  const panel = document.querySelector('.spchat__panel');
  if (!panel || panel.hidden) { document.querySelector('.spchat__toggle')?.click(); return true; }
  return false;
});
console.log('opened panel:', opened);
await wait(500);

const sent = await page.evaluate(async () => {
  try { await globalThis.__SP__.net.request('room.chat', { text: '手机端聊天测试 · hello' }); return true; }
  catch (e) { return String(e?.message || e); }
});
console.log('room.chat:', sent);
await wait(1200);

const out = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.spchat__row')];
  const last = rows.at(-1);
  const layer = document.querySelector('.spchat-danmaku');
  const panel = document.querySelector('.spchat__panel');
  const r = panel?.getBoundingClientRect();
  return {
    rows: rows.length,
    lastText: last ? (last.innerText || '').replace(/\s+/g, ' ').trim() : null,
    danmaku: layer ? (layer.innerText || '').trim() : null,
    inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 : false,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    panel: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
  };
});
console.log('chat:', JSON.stringify(out));
await page.screenshot({ path: `${OUT}/13-chat-live-${vw}x${vh}.png` });

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const ok = out.rows >= 1 && /手机端聊天测试/.test(out.lastText || '')
  && /手机端聊天测试/.test(out.danmaku || '')
  && out.inside && !out.overflowX && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 房间聊天与弹幕在 ${vw}×${vh} 端到端可用` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
