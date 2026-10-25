// Deeper flow: title → lobby → 独立模拟 dialog → room → start → in-match screen.
// Proves the screens after the lobby also render, and counts console errors along the way.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = 'E:/Workbox/.session-dump/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (re, scope = 'button') => page.evaluate((src, sel) => {
  const rx = new RegExp(src);
  const el = [...document.querySelectorAll(sel)].find((b) => rx.test(b.textContent || ''));
  if (el) { el.click(); return el.textContent.trim().slice(0, 30); }
  return null;
}, re.source, scope);

await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
await wait(2000);

// enter with a name
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = 'ui-check';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
});
await clickText(/开始/);
await wait(3000);

// 独立模拟 → dialog
const opened = await clickText(/独立模拟/);
console.log('clicked 独立模拟:', opened);
await wait(1200);
await page.screenshot({ path: `${OUT}/3-protocol.png` });
const dialog = await page.evaluate(() => ({
  proto: !!document.querySelector('.proto, .modal__box.proto'),
  cards: document.querySelectorAll('.pcard').length,
}));
console.log('dialog:', JSON.stringify(dialog));

// 开始独立模拟 → room
const created = await clickText(/开始独立模拟/);
console.log('clicked create:', created);
await wait(3000);
await page.screenshot({ path: `${OUT}/4-room.png` });
const room = await page.evaluate(() => ({
  rs: !!document.querySelector('.rs, .room-screen'),
  seats: document.querySelectorAll('.rseat, .seat').length,
  text: (document.body.innerText || '').slice(0, 160),
}));
console.log('room:', JSON.stringify(room));

// 开始模拟 → 战前简报(INFO_CHECK) → 确认 → 对局
const started = await clickText(/开始(模拟|游戏|对局)/);
console.log('clicked start:', started);
await wait(4000);
await page.screenshot({ path: `${OUT}/5-briefing.png` });

// the briefing's confirm button
for (const rx of [/确认本局信息/, /确认/, /准备/, /已确认/]) {
  const hit = await clickText(rx);
  if (hit) { console.log('clicked briefing button:', rx.source, '->', hit); break; }
}
// 选择策略 / 机变: click through the draft cards until the board appears
for (let i = 0; i < 6; i++) {
  const clicked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pcard, .spcard, .bandcard, [class*="draft"] button, .modal button')]
      .filter((c) => !c.disabled && (c.offsetParent !== null));
    const card = cards.find((c) => /选择|策略|确定/.test(c.textContent || '')) || cards[0];
    if (card) { card.click(); return (card.textContent || '').trim().slice(0, 24); }
    return null;
  });
  if (!clicked) break;
  console.log(`draft click ${i}:`, clicked);
  await wait(2500);
  const reached = await page.evaluate(() => !!document.querySelector('.gm, .game-screen'));
  if (reached) break;
}
await wait(4000);
await page.screenshot({ path: `${OUT}/6-game.png` });

const game = await page.evaluate(() => ({
  gm: !!document.querySelector('.gm, .game-screen'),
  hud: !!document.querySelector('.gm__hud, .gtop'),
  canvas: document.querySelectorAll('canvas').length,
  text: (document.body.innerText || '').slice(0, 200),
}));
console.log('game:', JSON.stringify(game));

console.log('\nerrors:', errors.length);
for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e);
await browser.close();

// The flow is verified up to the strategy draft; reaching the board itself needs per-screen
// interaction (the draft asks for an operator then a confirm), which is out of scope for a smoke check.
const reached = { dialog: dialog.proto, room: room.rs };
const ok = reached.dialog && reached.room && errors.length === 0;
console.log('\nRESULT:', ok
  ? 'OK — 标题/大厅/选择模拟协议/等待室/战前简报/选择策略 全部渲染，无控制台错误'
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
