// handoff/mobile-overlap-measure.mjs — 手机端两处重叠的量尺（临时脚本，不入库）
//
// 每个视口走一遍：大厅 → 选择拓展玩法 → 主题大厅，把**可见的可点元素**两两求交叠面积
// （max(0,min(r)-max(l)) * max(0,min(b)-max(t))，祖先/自身不算），并记录 rect、滚动量、最小边。
//
//   SP_TAG=before node handoff/mobile-overlap-measure.mjs    # 量并截图 mobile-overlap-before-*.png + before.json
//   SP_TAG=after  node handoff/mobile-overlap-measure.mjs    # 量并截图 mobile-overlap-after-*.png  + after.json
//
// SP_VIEWPORTS 缺省 792x360,667x375,844x390,1280x720,1920x1080（后两档只看桌面 rect 是否逐值不变）。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
const TAG = process.env.SP_TAG || 'before';
const DUMP = process.env.SP_DUMP || `E:/Workbox/系统/handoff/mobile-overlap-${TAG}.json`;
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = (process.env.SP_VIEWPORTS || '792x360,667x375,844x390,1280x720,1920x1080')
  .split(',').map((s) => s.split('x').map((n) => Math.round(Number(n) || 0)));

async function enterLobby(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  for (let i = 0; i < 3; i++) {
    if (await p.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await p.evaluate(async () => {
      const i = document.querySelector('.title-login input, input[type="text"]');
      if (i && !i.value) { i.value = `ov-${Math.floor(Math.random() * 900 + 100)}`; i.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2000);
  }
  return p.evaluate(() => !!document.querySelector('.mode-card'));
}

/** 交叠测量：在页面里跑（root 内可见的可点元素两两求交叠，跳过祖先/后代） */
const NEAR = Number(process.env.SP_NEAR || 8);
const MEASURE = `(sel) => {
  const root = document.querySelector(sel) || document.documentElement;
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => {
    const b = R(el); if (b.width < 1 || b.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < .05) return false;
    return b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight;
  };
  const nodes = [...root.querySelectorAll('button, a[href], [role="button"], input, select, tr[role="row"]')].filter(vis);
  const name = (el) => {
    const td = el.dataset?.testid ? '[' + el.dataset.testid + ']' : '';
    const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 24);
    return (el.className || el.tagName).toString().split(/\\s+/).slice(0, 2).join('.') + td + (txt ? ' "' + txt + '"' : '');
  };
  const pairs = [];
  const near = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = R(a), rb = R(b);
      const w = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const h = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      const area = Math.round(w * h);
      if (area >= 4) {
        pairs.push({ a: name(a), b: name(b), area,
          ra: [Math.round(ra.left), Math.round(ra.top), Math.round(ra.right), Math.round(ra.bottom)],
          rb: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.right), Math.round(rb.bottom)] });
        continue;
      }
      // 上下/左右贴得太近（同一列或同一排、间隙 ≤ 8px）：业主真机说的「看着像叠在一起」
      const colShare = w / Math.max(1, Math.min(ra.right - ra.left, rb.right - rb.left));
      const rowShare = h / Math.max(1, Math.min(ra.bottom - ra.top, rb.bottom - rb.top));
      const gapY = ra.bottom <= rb.top ? rb.top - ra.bottom : ra.top - rb.bottom;
      const gapX = ra.right <= rb.left ? rb.left - ra.right : ra.left - rb.right;
      if (colShare > .5 && gapY >= 0 && gapY <= ${NEAR}) {
        near.push({ a: name(a), b: name(b), axis: 'y', gap: Math.round(gapY),
          ra: [Math.round(ra.left), Math.round(ra.top), Math.round(ra.right), Math.round(ra.bottom)],
          rb: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.right), Math.round(rb.bottom)] });
      } else if (rowShare > .5 && gapX >= 0 && gapX <= ${NEAR}) {
        near.push({ a: name(a), b: name(b), axis: 'x', gap: Math.round(gapX),
          ra: [Math.round(ra.left), Math.round(ra.top), Math.round(ra.right), Math.round(ra.bottom)],
          rb: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.right), Math.round(rb.bottom)] });
      }
    }
  }
  const small = nodes.filter((el) => { const r = R(el); return Math.min(r.width, r.height) < 32; })
    .map((el) => ({ el: name(el), w: Math.round(R(el).width), h: Math.round(R(el).height) }));
  return {
    overlaps: pairs.sort((x, y) => y.area - x.area),
    near: near.sort((x, y) => x.gap - y.gap),
    small,
    scroll: { x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight },
  };
}`;

/** 关键元素的 rect（桌面「逐值不变」的证据） */
const RECTS = `(sel) => {
  const out = {};
  for (const s of sel) {
    const el = document.querySelector(s);
    if (!el) { out[s] = null; continue; }
    const b = el.getBoundingClientRect();
    out[s] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  }
  return out;
}`;

const HALL_SEL = ['.modal__box.ext', '.ext-stage', '.ext-pane', '.ext-list', '.ext-row', '.ext-foot',
  '.ext-foot__start', '.ext-party', '.ext-party__chip', '.ext-tier', '.ext-hero', '.ext-stats'];
const THEME_SEL = ['.ext-theme', '.ext-theme__top', '.ext-theme__title', '.ext-theme__name', '.ext-theme__body',
  '.ext-theme__guide', '.ext-theme__foot', '.ext-theme__pack', '.ext-party', '.ext-party__chip', '.ext-tiers',
  '.ext-tier', '.ext-theme__start', '.ext-theme__corner', '.ext-theme__dock', '.ext-theme__slot', '.ext-theme__loadout'];
const HUB_SEL = ['.hub-stage', '.hub-entries', '.mode-card', '.hub-right', '.hub-plate--loadout', '.lobby-sweep',
  '.hub-side', '.hub-tile', '.hub-entry-wrap', '.hub-entry__group'];

/** evaluate a source-string helper with one argument (puppeteer only injects args into real functions) */
const run = (p, src, arg) => p.evaluate((s, a) => (0, eval)('(' + s + ')')(a), src, arg);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const report = {};
let allOk = true;

for (const [vw, vh] of VIEWPORTS) {
  const tag = `${vw}x${vh}`;
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh, hasTouch: vw <= 900, isMobile: vw <= 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  const okLobby = await enterLobby(page);
  if (process.env.SP_UI) await page.evaluate((v) => document.documentElement.style.setProperty('--sp-ui', v), process.env.SP_UI);
  // SP_CSSOFF=1：把本次新加的移动端间距块从 CSSOM 里删掉 —— 等价于改动前的层叠，用来量「改动前」的 rect
  if (process.env.SP_CSSOFF) await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const r = rules[i];
        if (r.type === CSSRule.MEDIA_RULE && /calc\(\.14rem \+ \d+px\)/.test(r.cssText)) sheet.deleteRule(i);
      }
    }
  });
  await wait(900);
  const hub = await run(page, MEASURE, '.hub-stage');
  const hubRects = await run(page, RECTS, HUB_SEL);
  await page.screenshot({ path: `${OUT}/mobile-overlap-${TAG}-hub-${tag}.png` });

  await page.click('.mode-card[data-mode="ext"]');
  let hall = { overlaps: [], near: [], small: [], scroll: { x: 0, y: 0 } };
  let hallRects = {};
  let theme = { overlaps: [], near: [], small: [], scroll: { x: 0, y: 0 } };
  let themeRects = {};
  try {
    await page.waitForSelector('.modal__box.ext', { visible: true, timeout: 10000 });
    await wait(800);
    hall = await run(page, MEASURE, '.modal__box.ext');
    hallRects = await run(page, RECTS, HALL_SEL);
    await page.screenshot({ path: `${OUT}/mobile-overlap-${TAG}-hall-${tag}.png` });
  } catch (e) { errors.push('hall: ' + e.message); }

  try {
    // SP_MODE=zhajing 时先选中炸惊那一行再进入（两套主题大厅的角落入口数量不同）
    const wantMode = process.env.SP_MODE === 'zhajing' ? 'zhajing' : 'annihilation';
    await page.click(`.ext-row[data-ext="${wantMode}"]`);
    await wait(500);
    await page.click('[data-testid="extension-enter"]');
    await page.waitForSelector('.ext-theme', { visible: true, timeout: 10000 });
    await wait(700);
    theme = await run(page, MEASURE, '.ext-theme');
    themeRects = await run(page, RECTS, THEME_SEL);
    await page.screenshot({ path: `${OUT}/mobile-overlap-${TAG}-theme-${wantMode}-${tag}.png` });
  } catch (e) { errors.push('theme: ' + e.message); }

  report[tag] = { okLobby, hub, hubRects, hall, hallRects, theme, themeRects, errors: errors.slice(0, 3) };
  const fmt = (o) => o.overlaps.length ? JSON.stringify(o.overlaps.slice(0, 6)) : 'none';
  console.log(`[${tag}] hub overlaps:`, fmt(hub), 'scroll:', JSON.stringify(hub.scroll));
  console.log(`[${tag}] hall overlaps:`, fmt(hall), 'scroll:', JSON.stringify(hall.scroll));
  console.log(`[${tag}] theme overlaps:`, fmt(theme), 'scroll:', JSON.stringify(theme.scroll));
  console.log(`[${tag}] near (≤${NEAR}px):`, 'hub', JSON.stringify(hub.near.slice(0, 4)), 'hall', JSON.stringify(hall.near.slice(0, 4)), 'theme', JSON.stringify(theme.near.slice(0, 4)));
  console.log(`[${tag}] <32px targets:`, JSON.stringify([...hub.small, ...hall.small, ...theme.small]));
  if (!okLobby || hub.overlaps.length || hall.overlaps.length || theme.overlaps.length) allOk = false;
  await page.close();
}

fs.writeFileSync(DUMP, JSON.stringify(report, null, 1));
await browser.close();
console.log('\nDUMP:', DUMP);
console.log('RESULT:', allOk ? 'CLEAN' : 'OVERLAPS FOUND');
process.exit(0);
