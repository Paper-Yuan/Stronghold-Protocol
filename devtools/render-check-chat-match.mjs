// devtools/render-check-chat-match.mjs — 局内聊天（对局中的 ChatBox）端到端
//
// 流程：大厅 → room.create(solo) → room.start → 等 GameScreen 出现 → 通过 net 发 room.chat →
// 校验左下 .chat-panel 的 .chat-item 与弹幕层文字。手机视口。
//
//   SP_BASE=http://127.0.0.1:3017 SP_VIEWPORT=667x375 node devtools/render-check-chat-match.mjs
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
await wait(1600);
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = `mchat-${Math.floor(Math.random() * 900 + 100)}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);
const started = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
    await new Promise((r) => setTimeout(r, 600));
    await globalThis.__SP__.net.request('room.start', {});
    return true;
  } catch (e) { return String(e?.message || e); }
});
console.log('solo start:', started);
// 单人局：INFO_CHECK 确认 → 策略草稿选一个策略 → 进入 PREP（GameScreen 的 MatchScreen 才挂 ChatBox）
const phases = await page.evaluate(async () => {
  const seen = [];
  const app = globalThis.__SP__;
  for (let i = 0; i < 16; i++) {
    const s = app.store.get();
    const pub = s.match?.public;
    const phase = pub?.phase ?? null;
    seen.push(phase);
    if (document.querySelector('.gm')) break;
    try {
      if (phase === 'INFO_CHECK') await app.net.request('g.infoReady', { setupRevision: pub?.setupRevision ?? 0 });
      else if (phase === 'BAND_DRAFT') {
        const bands = Object.keys(app.data.get('bands') || {});
        if (bands[0]) await app.net.request('g.band', { bandId: bands[0] });
      }
    } catch (e) { seen.push('err:' + (e?.message || e)); }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return seen;
});
console.log('phases:', phases.join(' → '));
await wait(2500);

const mounted = await page.evaluate(() => !!document.querySelector('.gm, .game-screen'));
console.log('game screen:', mounted);
const sent = await page.evaluate(async () => {
  try { await globalThis.__SP__.net.request('room.chat', { text: '局内聊天测试 · hi' }); return true; }
  catch (e) { return String(e?.message || e); }
});
console.log('room.chat:', sent);
await wait(1500);

const out = await page.evaluate(() => {
  const panel = document.querySelector('.chat-panel');
  const items = [...document.querySelectorAll('.chat-panel .chat-item')];
  const layer = document.querySelector('.spchat-danmaku');
  const r = panel?.getBoundingClientRect();
  const last = items.at(-1);
  return {
    panel: !!panel,
    items: items.length,
    lastText: last ? (last.innerText || '').replace(/\s+/g, ' ').trim() : null,
    danmaku: layer ? (layer.innerText || '').trim() : null,
    inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 : false,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    rect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
  };
});
console.log('match chat:', JSON.stringify(out));
// 表情面板必须压在聊天日志之上、且能点到（业主 2026-10-26）
const emote = await page.evaluate(async () => {
  const btn = document.querySelector('.ewheel__btn');
  if (!btn) return { ok: false, why: 'no emote button' };
  btn.click();
  await new Promise((r) => setTimeout(r, 350));
  const panel = document.querySelector('.ewheel__panel');
  if (!panel) return { ok: false, why: 'no emote panel' };
  const r = panel.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const onTop = !!top && panel.contains(top);
  const item = panel.querySelector('.ewheel__item');
  const itemRect = item ? item.getBoundingClientRect() : null;
  const itemTop = itemRect ? document.elementFromPoint(itemRect.left + itemRect.width / 2, itemRect.top + itemRect.height / 2) : null;
  const itemClickable = !!item && !!itemTop && item.contains(itemTop);
  if (item && itemClickable) item.click();
  await new Promise((r) => setTimeout(r, 400));
  return {
    ok: true, onTop, itemClickable,
    closed: !document.querySelector('.ewheel__panel'),
    panel: { w: Math.round(r.width), h: Math.round(r.height) },
  };
});
console.log('emote:', JSON.stringify(emote));
await page.screenshot({ path: `${OUT}/14-chat-match-${vw}x${vh}.png` });

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 12)) console.log('  ' + e);
await browser.close();

const ok = out.panel && out.items >= 1 && /局内聊天测试/.test(out.lastText || '')
  && /局内聊天测试/.test(out.danmaku || '')
  && out.inside && !out.overflowX
  && emote.ok && emote.onTop && emote.itemClickable && emote.closed
  && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 局内聊天/弹幕/表情在 ${vw}×${vh} 端到端可用` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
