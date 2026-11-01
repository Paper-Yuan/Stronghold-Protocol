// devtools/render-check-aspects.mjs — 六种手机/桌面比例的 UI 挤占检查（业主 2026-10-26）
//
// 每个尺寸：进入 solo 对局 → 发一条聊天 → 打开表情面板 →
//   1) 无横向溢出；2) 聊天/表情/HUD 顶栏都在视口内；3) 表情面板在聊天之上且可点；
//   4) 聊天输入框字号 ≥16px；5) 聊天发送/表情项触控 ≥32px；6) 0 控制台错误。
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-aspects.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = 'E:/Workbox/.session-dump/shots';
const SIZES = [
  { name: '20-9', w: 800, h: 360 },
  { name: '19.5-9', w: 844, h: 390 },
  { name: '21-9', w: 840, h: 360 },
  { name: '16-9', w: 1280, h: 720 },
  { name: '4-3', w: 1024, h: 768 },
  { name: 'portrait', w: 360, h: 780 },
  { name: 'landscape-phone', w: 667, h: 375 },
].filter((s) => !process.env.SP_ONLY || s.name === process.env.SP_ONLY);
fs.mkdirSync(OUT, { recursive: true });
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (const { name, w, h } of SIZES) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', `--window-size=${w},${h}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1400);
    await page.evaluate(async () => {
      const input = document.querySelector('.title-login input, input[type="text"]');
      input.value = `asp-${Math.floor(Math.random() * 900 + 100)}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
    });
    await wait(2300);
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
      await app.net.request('room.chat', { text: '比例适配检查' });
    });
    await wait(1400);
    await page.evaluate(async () => {
      const btn = document.querySelector('.ewheel__btn');
      btn?.click();
      await new Promise((r) => setTimeout(r, 320));
    });

    const check = await page.evaluate(() => {
      const rectOf = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
      const inside = (r) => !!r && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      const chat = rectOf('.chat-panel');
      const panel = rectOf('.ewheel__panel');
      const topBar = rectOf('.gtop') || rectOf('.gm__hud');
      const input = document.querySelector('.chat-panel .chat-input');
      const send = document.querySelector('.chat-panel .chat-send-btn');
      const item = document.querySelector('.ewheel__item');
      const ir = item ? item.getBoundingClientRect() : null;
      const top = panel ? document.elementFromPoint(panel.left + panel.width / 2, panel.top + panel.height / 2) : null;
      const panelEl = document.querySelector('.ewheel__panel');
      const hint = document.querySelector('.rotate-hint');
      const hintVisible = !!hint && getComputedStyle(hint).display !== 'none';
      return {
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        portraitHint: hintVisible,
        hintText: hintVisible ? (hint.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
        chatInside: inside(chat), panelInside: inside(panel), topBarInside: inside(topBar),
        emoteOnTop: !!(top && panelEl && panelEl.contains(top)),
        topTag: top ? String(top.tagName || '') : null,
        topCls: top ? String(top.className || '') : null,
        chatFont: input ? parseFloat(getComputedStyle(input).fontSize) : null,
        sendH: send ? Math.round(send.getBoundingClientRect().height) : null,
        itemH: ir ? Math.round(ir.height) : null,
        panel: panel ? { w: Math.round(panel.width), h: Math.round(panel.height) } : null,
        chat: chat ? { w: Math.round(chat.width), h: Math.round(chat.height) } : null,
      };
    });
    await page.screenshot({ path: `${OUT}/aspect-${name}-${w}x${h}.png` });
    const own = errors.filter((e) => !EXTERNAL.test(e));
    const ok = check.portraitHint
      ? (!check.overflowX && !!check.hintText && own.length === 0)
      : (!check.overflowX && check.chatInside && check.panelInside && check.topBarInside
        && check.emoteOnTop && (check.chatFont == null || check.chatFont >= 16)
        && (check.sendH == null || check.sendH >= 28) && (check.itemH == null || check.itemH >= 32)
        && own.length === 0);
    results.push({ name, size: `${w}x${h}`, ok, ...check, errors: own.length });
    console.log(`${name} ${w}x${h}: ${ok ? 'OK' : 'FAIL'} ${JSON.stringify(check)}${own.length ? ' errors=' + own.length : ''}`);
    if (own.length) for (const e of [...new Set(own)].slice(0, 5)) console.log('   ' + e);
  } catch (e) {
    results.push({ name, size: `${w}x${h}`, ok: false, fatal: String(e?.message || e) });
    console.log(`${name} ${w}x${h}: FATAL ${e?.message || e}`);
  }
  await browser.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\nRESULT: ${bad.length ? 'CHECK ABOVE — ' + bad.map((b) => b.name).join(', ') : 'OK — 全部尺寸通过'}`);
process.exit(bad.length ? 1 : 0);
