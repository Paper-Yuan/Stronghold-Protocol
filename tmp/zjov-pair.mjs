// tmp/zjov-pair.mjs — 同一局、同一手牌，双视口成对量测（临时脚本，用完删）
//
//   SP_BASE=http://127.0.0.1:3170 SP_RUN=before node tmp/zjov-pair.mjs
//   SP_BASE=http://127.0.0.1:3170 SP_RUN=after  node tmp/zjov-pair.mjs
//
// 为什么成对：R1 三选一是随机抽的，两次独立开局拿到的不是同一手牌，行数没法比。这里只开一局，
// 在 1920×1080 量完/截完图后**原地把视口改成 792×360**（同一 DOM、同一文案），再量一次。
// 两档的差异就只剩 CSS 的功劳。视口改回 1920 再量一次，确认是幂等的。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3170';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
const RUN = process.env.SP_RUN || 'run';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 1920, height: 1080, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });

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

/** one reading of 「are we on the draft, and is anything covering it」 */
const stateOf = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const draft = q('.zjov');
  return {
    zjov: !!draft,
    reveal: !!q('[data-testid="jibian-reveal"]'),
    banner: !!q('.mpop--phase, .mpop--round'),
    band: !!q('.dband'),
    confirmDraft: !!q('.draft-confirm'),
    screen: q('.screen.draft') ? 'draft' : q('.screen.brief') ? 'brief' : q('.gm__hud') ? 'game' : q('.rs-pill') ? 'room' : 'other',
  };
});

const measure = () => page.evaluate(() => {
  const px = (v) => Math.round(v * 10) / 10;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: px(b.left), y: px(b.top), w: px(b.width), h: px(b.height), inView: b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5 }; };
  const csOf = (el) => (el ? getComputedStyle(el) : null);
  const fontOf = (el) => (el ? getComputedStyle(el).fontSize : null);
  /** 真实行数（用 Range 的行框 tops）+ clamp 与是否被裁 */
  const lines = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 0;
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const tops = [];
    for (const r of rects) if (!tops.some((t) => Math.abs(t - r.top) < 2)) tops.push(r.top);
    return {
      h: px(el.getBoundingClientRect().height), lh: px(lh), lineCount: tops.length,
      clamp: cs.webkitLineClamp || 'none', clipped: el.scrollHeight > el.clientHeight + 1,
      font: cs.fontSize, display: cs.display, ws: cs.whiteSpace, overflow: cs.overflow,
      text: (el.textContent || '').trim().slice(0, 80),
    };
  };
  const cardDump = (el, i) => {
    const q = (s) => el.querySelector(s);
    const cs = csOf(el);
    return {
      idx: i, rarity: el.getAttribute('data-rarity'), testid: el.getAttribute('data-testid'),
      card: rect(el), wrap: rect(el.parentElement),
      pad: cs.padding, gap: cs.rowGap, minH: cs.minHeight,
      order: [...el.children].filter((c) => c.className && /zjcard__/.test(c.className))
        .map((c) => c.className.split(/\s+/).find((k) => k.startsWith('zjcard__'))),
      icon: rect(q('.zjcard__icon')),
      name: { ...rect(q('.zjcard__name')), font: fontOf(q('.zjcard__name')), text: q('.zjcard__name')?.textContent?.trim() },
      rarityChip: { ...rect(q('.zjcard__rarity')), font: fontOf(q('.zjcard__rarity')) },
      desc: lines(q('.zjcard__desc')),
      bondblocks: rect(q('.zjcard__bondblocks')),
      bondboxes: [...el.querySelectorAll('.zjcard__bondbox')].map((b) => ({
        rect: rect(b),
        name: b.querySelector('.zjcard__bondname')?.textContent?.trim() ?? null,
        nameLines: lines(b.querySelector('.zjcard__bondname'))?.lineCount ?? null,
        effect: lines(b.querySelector('.zjcard__bondeffect')),
      })),
      flavor: lines(q('.zjcard__flavor')),
      armedFooter: rect(q('.zjcard__confirm')),
      reroll: (() => { const r = el.parentElement?.querySelector('.zjcard__reroll'); return r ? { ...rect(r), disabled: !!r.disabled } : null; })(),
    };
  };
  const ov = document.querySelector('.zjov');
  const grid = document.querySelector('.zjov__grid');
  const cardEls = [...document.querySelectorAll('.zjcard')];
  const confirm = document.querySelector('[data-testid="jibian-confirm"]');
  const state = document.querySelector('.zjov__state');
  const rootCs = getComputedStyle(document.documentElement);
  const ovCs = ov ? getComputedStyle(ov) : null;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    rootFontSize: rootCs.fontSize,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    media: { mq900: matchMedia('(max-width: 900px)').matches, mqH520: matchMedia('(max-height: 520px)').matches, coarse: matchMedia('(pointer: coarse)').matches },
    htmlClasses: document.documentElement.className,
    overlay: ov ? { ...rect(ov), inset: [ovCs.top, ovCs.right, ovCs.bottom, ovCs.left].join(' '), padding: ovCs.padding, rows: ovCs.gridTemplateRows } : null,
    head: rect(document.querySelector('.zjov__head')),
    title: { ...rect(document.querySelector('.zjov__title')), font: fontOf(document.querySelector('.zjov__title')), text: document.querySelector('.zjov__title')?.textContent?.trim() },
    sub: lines(document.querySelector('.zjov__sub')),
    present: { sub: !!document.querySelector('.zjov__sub'), title: !!document.querySelector('.zjov__title'), micro: !!document.querySelector('.zjov__micro'), head: !!document.querySelector('.zjov__head'), grid: !!document.querySelector('.zjov__grid'), overlay: !!ov },
    micro: { ...rect(document.querySelector('.zjov__micro')), font: fontOf(document.querySelector('.zjov__micro')) },
    confirm: confirm ? { ...rect(confirm), text: confirm.textContent.trim() } : null,
    state: state ? { ...rect(state), text: state.textContent.replace(/\s+/g, ' ').trim() } : null,
    grid: grid ? { ...rect(grid), cols: getComputedStyle(grid).gridTemplateColumns, colGap: getComputedStyle(grid).columnGap, overflowY: getComputedStyle(grid).overflowY, scrollH: grid.scrollHeight, clientH: grid.clientHeight, scrolls: grid.scrollHeight > grid.clientHeight + 1 } : null,
    cards: cardEls.map(cardDump),
    textHasSubHint: (ov?.textContent || '').includes('点击卡牌选中'),
  };
});

/** 等到 .zjov 真的露出来：没有揭晓浮层、没有回合横幅。路上顺手把策略草稿和揭晓点掉。 */
async function settleDraft() {
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const st = await stateOf();
    if (st.zjov && !st.reveal && !st.banner) return true;
    if (st.reveal) { await page.evaluate(() => document.querySelector('[data-testid="jibian-reveal"]')?.click()); await wait(400); continue; }
    if (st.confirmDraft) { await page.evaluate(() => document.querySelector('.draft-confirm')?.click()); await wait(600); continue; }
    if (st.band) { await page.evaluate(() => document.querySelector('.dband:not(.is-taken)')?.click()); await wait(500); continue; }
    await wait(600);
  }
  return false;
}

const lobby = await enterLobby(page);
console.log('lobby:', lobby);
const created = await page.evaluate(async () => {
  const m = await import('/js/net.js');
  const r = await m.net.request('room.create', { mode: 'solo', difficulty: 'ZHAJING' });
  return { t: r?.t, code: r?.code };
});
console.log('room.create:', JSON.stringify(created));
await page.waitForSelector('.rs-pill', { visible: true, timeout: 25000 });
await wait(700);
await page.click('.rs-go');
await page.waitForSelector('.screen.brief', { visible: true, timeout: 30000 });
await wait(900);
await page.evaluate(() => document.querySelector('.brief-go')?.click());
const ok = await settleDraft();
console.log('draft settled:', ok);

const shots = {};
const out = { run: RUN, errors };

// ---- 桌面 1920×1080 ----
await wait(500);
out.desktop = await measure();
shots.desktop = `${OUT}/zjov-${RUN}-1920x1080.png`;
await page.screenshot({ path: shots.desktop });

// ---- 原地改成手机 792×360 ----
await page.setViewport({ width: 792, height: 360, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await wait(1400);
if (!(await settleDraft())) { await wait(2500); await settleDraft(); }
out.mobile = await measure();
shots.mobile = `${OUT}/zjov-${RUN}-792x360.png`;
await page.screenshot({ path: shots.mobile });

// ---- 两步确认：手机上点一次卡 → 量选中态 → 点确认键 ----
const armed = await page.evaluate(() => {
  const card = document.querySelector('.zjcard');
  if (!card) return null;
  const b = card.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: Math.min(b.top + 40, b.bottom - 8) };
});
if (armed) {
  await page.mouse.click(armed.x, armed.y);
  await wait(600);
  out.mobileArmed = await measure();
  shots.mobileArmed = `${OUT}/zjov-${RUN}-792x360-armed.png`;
  await page.screenshot({ path: shots.mobileArmed });
  const pick = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="jibian-confirm"]');
    if (!btn) return { clicked: false };
    const b = btn.getBoundingClientRect();
    return { clicked: true, x: b.left + b.width / 2, y: b.top + b.height / 2, h: Math.round(b.height * 10) / 10, text: btn.textContent.trim() };
  });
  out.confirmClick = pick;
  if (pick.clicked) {
    await page.mouse.click(pick.x, pick.y);
    await wait(1800);
    out.afterConfirm = await page.evaluate(() => {
      const st = globalThis.__SP__?.store.get() || {};
      return {
        overlay: !!document.querySelector('.zjov'),
        picks: st.match?.public?.sp?.picks ?? null,
        taken: st.match?.public?.sp?.taken ?? null,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      };
    });
    shots.afterConfirm = `${OUT}/zjov-${RUN}-792x360-picked.png`;
    await page.screenshot({ path: shots.afterConfirm });
  }
}

// ---- 改回桌面，确认同一个 DOM 还是同一套版式（幂等）----
await page.setViewport({ width: 1920, height: 1080, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
await wait(900);
out.desktopAgain = await measure();

out.shots = shots;
const jsonPath = `tmp/zjov-pair-${RUN}.json`;
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8');
await browser.close();
console.log('json:', jsonPath, 'shots:', JSON.stringify(shots), 'errors:', errors.length);
