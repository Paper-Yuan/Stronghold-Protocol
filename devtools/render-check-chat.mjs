// devtools/render-check-chat.mjs — 真浏览器验证房间聊天面板（room chat）确实挂载并定位
//
// 只做一件事：进大厅后把 store 切到一个假的 coop 房间（本机为房主），等待 ui/roomChat.js 的 mountRoomChat 反应，
// 然后断言 .spchat__panel 存在、可见、fixed 定位且宽度合理，并截一张图。服务端广播/限流由 test/lobby-chat.test.js 覆盖。
//
//   SP_BASE=http://127.0.0.1:3010 SP_VIEWPORT=667x375 node devtools/render-check-chat.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
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
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const appErrors = () => {
  const external = errors.filter((e) => EXTERNAL.test(e));
  return { own: errors.filter((e) => !EXTERNAL.test(e) && !(external.length && /Failed to load resource/.test(e))), external };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1800);
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = 'chat-check';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''));
  btn?.click();
});
await wait(2600);

const seeded = await page.evaluate(() => {
  const sp = globalThis.__SP__;
  if (!sp?.store) return false;
  const s = sp.store.get();
  const me = s.me;
  if (!me?.playerId) return false;
  sp.store.set({
    session: { ...s.session, entered: true },
    room: {
      t: 'room.state', code: 'CHAT', mode: 'coop', hostId: me.playerId, inMatch: false,
      seats: [{ seat: 0, playerId: me.playerId, name: me.name || 'chat-check', isBot: false, connected: true, ready: false }],
      spectators: [], difficulty: 'NORMAL',
    },
  });
  return true;
});
console.log('seeded fake coop room:', seeded);
await wait(1200);
// 手机/矮屏默认收起成圆点：点开再看面板（桌面本来就是展开的）。
const opened = await page.evaluate(() => {
  const panel = document.querySelector('.spchat__panel');
  if (panel && !panel.hidden) return false;
  document.querySelector('.spchat__toggle')?.click();
  return true;
});
await wait(400);
if (opened) console.log('opened the collapsed chat panel');
await page.screenshot({ path: `${OUT}/7-room-chat-${vw}x${vh}.png` });

const chat = await page.evaluate(() => {
  const panel = document.querySelector('.spchat__panel');
  const toggle = document.querySelector('.spchat__toggle');
  const cs = panel ? getComputedStyle(panel) : null;
  const r = panel ? panel.getBoundingClientRect().toJSON() : null;
  return {
    panel: !!panel,
    visible: !!panel && !panel.hidden && r.width > 0 && r.height > 0,
    position: cs?.position || null,
    width: r?.width || 0,
    height: r?.height || 0,
    toggle: !!toggle,
    insideViewport: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
  };
});
console.log('chat:', JSON.stringify(chat));
const { own, external } = appErrors();
if (external.length) console.log(`(external thanks API unavailable: ${external.length} request(s) — not a UI error)`);
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const ok = chat.panel && chat.visible && chat.position === 'fixed' && chat.toggle && chat.insideViewport && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 房间聊天面板在 ${vw}×${vh} 内可见、fixed、未越界，无控制台错误` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
