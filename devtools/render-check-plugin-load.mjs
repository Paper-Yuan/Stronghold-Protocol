// devtools/render-check-plugin-load.mjs — 手机端把脚本 mod 真正装进房间（不是只看布局）
//
// 前置：测试服用沙箱脚本启动：
//   $env:PORT='3017'; $env:SP_PLUGIN_SCRIPTS='sandbox'; node server/index.js
// （plugins/release-script 需要有效 lock：node tools/plugin.mjs pack release-script）
//
// 流程：进大厅 → 直接 room.create(coop) → 点房间顶部的插件标签 → 在插件面板里打开 release-script 的开关 →
// 等房间 content 生效，读 room.plugins / room.content / 开关状态。手机视口下同时检查面板不横向溢出。
//
//   SP_BASE=http://127.0.0.1:3017 SP_VIEWPORT=667x375 node devtools/render-check-plugin-load.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3017';
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
await wait(1800);
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = `mod-${Math.floor(Math.random() * 900 + 100)}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2600);

const created = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    return true;
  } catch (e) { return String(e?.message || e); }
});
console.log('room.create:', created);
await wait(1800);

const tag = await page.evaluate(() => {
  const el = document.querySelector('.plugtag');
  if (!el) return null;
  const before = el.textContent.trim();
  el.click();
  return before;
});
console.log('plugin tag:', tag);
await wait(1200);

const row = await page.evaluate(() => {
  const li = document.querySelector('[data-plugin="release-script"]');
  if (!li) return null;
  const sw = li.querySelector('button[role="switch"]');
  const r = li.getBoundingClientRect();
  return {
    text: (li.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
    rowHeight: Math.round(r.height),
    hasSwitch: !!sw,
    disabled: sw ? sw.disabled : null,
    checked: sw ? sw.getAttribute('aria-checked') : null,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
});
console.log('release-script row:', JSON.stringify(row));

if (row?.hasSwitch && row.disabled === false) {
  await page.evaluate(() => document.querySelector('[data-plugin="release-script"] button[role="switch"]')?.click());
  await wait(3500);
}
await page.screenshot({ path: `${OUT}/12-plugin-load-${vw}x${vh}.png` });

const after = await page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const li = document.querySelector('[data-plugin="release-script"]');
  const sw = li?.querySelector('button[role="switch"]');
  return {
    checked: sw ? sw.getAttribute('aria-checked') : null,
    roomPlugins: s.room?.plugins ?? null,
    content: s.room?.content ? {
      cs: s.room.content.cs, vanilla: s.room.content.vanilla,
      plugins: (s.room.content.plugins || []).map((p) => p.id),
      execution: s.room.content.execution ?? null,
    } : null,
    inMatch: s.room?.inMatch ?? null,
    errors: [],
  };
});
console.log('after toggle:', JSON.stringify(after));

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const ok = !!row && row.hasSwitch && row.disabled === false && !row.overflowX
  && after.checked === 'true'
  && after.content && after.content.vanilla === false
  && (after.content.plugins || []).includes('release-script')
  && own.length === 0;
console.log('\nRESULT:', ok
  ? `OK — release-script 已在 ${vw}×${vh} 通过插件面板装进房间（content 生效）`
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
