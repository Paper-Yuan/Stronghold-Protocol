// tmp/zjov-measure.mjs — 炸惊三选一（.zjov / .zjcard）双端量测 + 截图（临时脚本，用完删）
//
//   SP_BASE=http://127.0.0.1:3170 SP_TAG=before node tmp/zjov-measure.mjs
//
// 流程：大厅 → room.create(solo, ZHAJING) → .rs-go → .brief-go → 跳过策略草稿 → 关敌方惊变揭晓 → R1 三选一
// 每个视口 dump 每张卡与其字段的 getBoundingClientRect、行数、是否被 line-clamp 截断，并截图。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3170';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
const TAG = process.env.SP_TAG || 'measure';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = (process.env.SP_VIEWPORT || '792x360,1920x1080').split(',').map((s) => s.split('x').map(Number));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const report = {};

async function enterLobby(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  for (let i = 0; i < 4; i++) {
    if (await p.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await p.evaluate(async () => {
      const i = document.querySelector('.title-login input, input[type="text"]');
      if (i && !i.value) { i.value = `zjov-${Math.floor(Math.random() * 9000 + 1000)}`; i.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2000);
  }
  return p.evaluate(() => !!document.querySelector('.mode-card'));
}

for (const [vw, vh] of VIEWPORTS) {
  const tag = `${vw}x${vh}`;
  const errors = [];
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh, hasTouch: vw <= 900, isMobile: vw <= 900, deviceScaleFactor: 1 });
  // 每个视口都要一条**新身份**：上一局留下的 match 会让 room.create 回 ERROR「模拟已开始」，页面也会直接 resume 到局内。
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const lobby = await enterLobby(page);
  console.log(`[${tag}] lobby:`, lobby);
  const created = await page.evaluate(async () => {
    const m = await import('/js/net.js');
    const r = await m.net.request('room.create', { mode: 'solo', difficulty: 'ZHAJING' });
    return { t: r?.t, code: r?.code, mode: r?.room?.mode ?? null };
  });
  console.log(`[${tag}] room.create:`, JSON.stringify(created));
  await page.waitForSelector('.rs-pill', { visible: true, timeout: 25000 });
  await wait(700);
  await page.click('.rs-go');
  await page.waitForSelector('.screen.brief', { visible: true, timeout: 30000 });
  await wait(900);
  await page.evaluate(() => document.querySelector('.brief-go')?.click());

  let found = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const st = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      return {
        phase: globalThis.__SP__?.store.get()?.match?.public?.phase ?? null,
        screen: q('.screen.draft') ? 'draft' : q('.screen.brief') ? 'brief' : q('.gm__hud') ? 'game' : q('.rs-pill') ? 'room' : 'other',
        reveal: !!q('[data-testid="jibian-reveal"]'),
        zjov: !!q('.zjov'),
        bands: document.querySelectorAll('.dband').length,
        draftConfirm: !!q('.draft-confirm') && !q('.draft-confirm[disabled]'),
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      };
    });
    if (st.zjov) { found = true; break; }
    if (st.reveal) { await page.evaluate(() => document.querySelector('[data-testid="jibian-reveal"]')?.click()); await wait(450); continue; }
    if (st.bands && !st.draftConfirm) { await page.evaluate(() => document.querySelector('.dband:not(.is-taken)')?.click()); await wait(500); continue; }
    if (st.draftConfirm) { await page.evaluate(() => document.querySelector('.draft-confirm')?.click()); await wait(700); continue; }
    console.log(`[${tag}] waiting:`, JSON.stringify(st));
    await wait(900);
  }
  if (!found) { console.log(`[${tag}] NO .zjov — aborting this viewport`); report[tag] = { error: 'no overlay', errors }; await page.close(); continue; }

  await wait(700);
  const dump = await page.evaluate(() => {
    const px = (v) => Math.round(v * 10) / 10;
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: px(b.left), y: px(b.top), w: px(b.width), h: px(b.height), inView: b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5 }; };
    const lines = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 0;
      const clamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') || 'none';
      const display = cs.display;
      let lineList = [];
      if (display === 'block' || display === 'flow-root') lineList = [el.clientHeight];
      // 用 Range 逐行读真实行框（inline 也一样）
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const tops = [];
      for (const r of rects) if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
      return {
        h: px(el.getBoundingClientRect().height), lh: px(lh),
        lineCount: tops.length || (lh ? Math.round(el.getBoundingClientRect().height / lh) : null),
        clamp, overflow: cs.overflow, textOverflow: cs.textOverflow, ws: cs.whiteSpace,
        scrollH: el.scrollHeight, clientH: el.clientHeight,
        clipped: el.scrollHeight > el.clientHeight + 1,
        font: cs.fontSize,
      };
    };
    const cardDump = (el, i) => {
      const q = (s) => el.querySelector(s);
      const bonds = [...el.querySelectorAll('.zjcard__bondbox')].map((b) => ({
        name: b.querySelector('.zjcard__bondname')?.textContent?.trim() ?? null,
        rect: rect(b),
        effect: lines(b.querySelector('.zjcard__bondeffect')),
      }));
      const reroll = el.parentElement?.querySelector('.zjcard__reroll');
      return {
        idx: i,
        testid: el.getAttribute('data-testid'),
        rarity: el.getAttribute('data-rarity'),
        card: rect(el),
        wrap: rect(el.parentElement),
        icon: rect(q('.zjcard__icon')),
        name: { text: q('.zjcard__name')?.textContent?.trim() ?? null, ...lines(q('.zjcard__name')) },
        rarityChip: rect(q('.zjcard__rarity')),
        desc: { text: (q('.zjcard__desc')?.textContent || '').trim(), ...lines(q('.zjcard__desc')) },
        bondblocks: rect(q('.zjcard__bondblocks')),
        bondboxes: bonds,
        bondHints: [...el.querySelectorAll('.zjcard__bond')].map((x) => ({ text: x.textContent.trim(), ...rect(x) })),
        flavor: (() => { const f = q('.zjcard__flavor'); if (!f) return null; const cs = getComputedStyle(f); return { text: f.textContent.trim(), display: cs.display, ...lines(f) }; })(),
        confirmInCard: rect(q('.zjcard__confirm')),
        reroll: reroll ? { ...rect(reroll), h: px(reroll.getBoundingClientRect().height), disabled: !!reroll.disabled, text: reroll.textContent.replace(/\s+/g, ' ').trim() } : null,
        // 卡内字段顺序（DOM 序）
        order: [...el.children].map((c) => c.className.split(/\s+/).filter((k) => k && k.startsWith('zjcard__'))[0] || c.tagName.toLowerCase()),
      };
    };
    const ov = document.querySelector('.zjov');
    const grid = document.querySelector('.zjov__grid');
    const cards = [...document.querySelectorAll('.zjcard')];
    const head = document.querySelector('.zjov__head');
    const confirm = document.querySelector('[data-testid="jibian-confirm"]');
    const state = document.querySelector('.zjov__state');
    const rootCs = getComputedStyle(document.documentElement);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      rootFontSize: rootCs.fontSize,
      tVar: getComputedStyle(document.body).getPropertyValue('--t').trim() || rootCs.getPropertyValue('--t').trim(),
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overlay: rect(ov),
      head: rect(head),
      title: { text: document.querySelector('.zjov__title')?.textContent?.trim() ?? null },
      sub: { text: document.querySelector('.zjov__sub')?.textContent?.trim() ?? null, ...lines(document.querySelector('.zjov__sub')) },
      confirm: confirm ? { ...rect(confirm), h: px(confirm.getBoundingClientRect().height), w: px(confirm.getBoundingClientRect().width), text: confirm.textContent.trim() } : null,
      state: state ? { ...rect(state), text: state.textContent.replace(/\s+/g, ' ').trim() } : null,
      grid: grid ? { ...rect(grid), cols: getComputedStyle(grid).gridTemplateColumns, gap: getComputedStyle(grid).columnGap, overflowX: getComputedStyle(grid).overflowX, overflowY: getComputedStyle(grid).overflowY, scrollH: grid.scrollHeight, clientH: grid.clientHeight, scrolls: grid.scrollHeight > grid.clientHeight + 1 } : null,
      cardCount: cards.length,
      cards: cards.map(cardDump),
    };
  });
  const file = `${OUT}/zjov-${TAG}-${tag}.png`;
  await page.screenshot({ path: file });
  dump.errors = errors;
  dump.shot = file;
  report[tag] = dump;
  console.log(`[${tag}] dump written, shot=${file}, errors=${errors.length}`);
  await page.close();
}

await browser.close();
const outJson = process.env.SP_JSON || 'tmp/zjov-dump.json';
let prev = {};
try { prev = JSON.parse(fs.readFileSync(outJson, 'utf8')); } catch { /* first run */ }
fs.writeFileSync(outJson, JSON.stringify({ ...prev, ...report }, null, 2), 'utf8');
console.log('json:', outJson);
