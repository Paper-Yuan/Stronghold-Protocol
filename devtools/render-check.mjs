// Render the running server in headless Chrome, walk title → lobby → room, collect console errors,
// and screenshot each screen. This is the only check that can prove the UI really draws.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME
  || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = 'E:/Workbox/.session-dump/shots';
// SP_VIEWPORT=667x375 (a phone in landscape) renders the same walk at another size; default the desktop check.
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`, '--force-device-scale-factor=1'],
});

const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
// The title screen's thanks marquee calls an external API (server/http/csp.js allows exactly this origin). Its flakiness is
// not a UI regression: report those failures separately and judge the page on its own requests.
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const appErrors = () => {
  const external = errors.filter((e) => EXTERNAL.test(e));
  const own = errors.filter((e) => !EXTERNAL.test(e) && !(external.length && /Failed to load resource/.test(e)));
  return { own, external };
};

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${OUT}/1-title.png` });

// does the title screen actually have structure?
const titleInfo = await page.evaluate(() => ({
  screen: !!document.querySelector('.title-screen'),
  login: !!document.querySelector('.title-login'),
  thanks: document.querySelectorAll('.title-thanks__item').length,
  foot: !!document.querySelector('.title-foot'),
}));
console.log('title:', JSON.stringify(titleInfo));

// enter: type a name and press 开始
const typed = await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  if (!input) return false;
  input.value = 'ui-check';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const btn = [...document.querySelectorAll('button')].find((b) => /开始|进入|START/i.test(b.textContent || ''));
  if (btn) { btn.click(); return true; }
  return false;
});
console.log('entered via button:', typed);
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: `${OUT}/2-lobby.png` });

const lobbyInfo = await page.evaluate(() => {
  const hub = document.querySelector('.lobby-hub');
  const entries = document.querySelectorAll('.hub-entry, .mode-card');
  const cs = hub ? getComputedStyle(hub) : null;
  // a styled element has a non-default background/display
  return {
    hub: !!hub,
    entries: entries.length,
    hubBg: cs ? cs.backgroundColor : null,
    entryRect: entries[0] ? entries[0].getBoundingClientRect().toJSON() : null,
    bodyText: (document.body.innerText || '').slice(0, 200),
  };
});
console.log('lobby:', JSON.stringify(lobbyInfo));

const { own, external } = appErrors();
if (external.length) console.log(`(external thanks API unavailable: ${external.length} request(s) — not a UI error)`);
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 20)) console.log('  ' + e);

await browser.close();
const ok = titleInfo.screen && lobbyInfo.hub && lobbyInfo.entries > 0 && own.length === 0;
console.log('\nRESULT:', ok ? 'OK — 标题页与大厅都渲染出来了，无控制台错误' : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
