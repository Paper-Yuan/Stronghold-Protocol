// devtools/render-check-infinite-entry.mjs — 超限模拟的入口自查（2026-10-26）
//
//   单人：大厅 → 独立模拟 → 难度列表最下方的紫色「超限模拟」（带「特殊难度」分隔）→ 建房 = solo_infinite，1 座
//   同盟：选择同盟方式里**没有**单独的「超限 · 同盟」入口（业主 2026-10-28）；建普通同盟房后在房内打开
//   房间：房内 选择模拟协议 的同一张「特殊难度」卡开关超限（room.setInfinite），单人 / 同盟共用这条路
//   左侧画面：超限与其他难度同一张官方立绘（终极的 modeChoice/abyss），不再是自己画的线框
//
//   SP_BASE=http://127.0.0.1:3020 SP_VIEWPORT=1280x720 node devtools/render-check-infinite-entry.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.round(Number(n) || 0));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/** title screen → lobby (a fresh page may already be there: the identity is remembered) */
async function enterLobby(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  for (let i = 0; i < 3; i++) {
    if (await p.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await p.evaluate(async () => {
      const i = document.querySelector('.title-login input, input[type="text"]');
      if (i && !i.value) { i.value = `inf-${Math.floor(Math.random() * 900 + 100)}`; i.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2000);
  }
  return p.evaluate(() => !!document.querySelector('.mode-card'));
}

const geomOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { y: Math.round(b.top), h: Math.round(b.height), bottom: Math.round(b.bottom), inView: b.top >= 0 && b.bottom <= innerHeight };
}, sel);

const okLobby = await enterLobby(page);
console.log('lobby:', okLobby);
const modeCards = await page.evaluate(() => [...document.querySelectorAll('.mode-card')].map((b) => b.dataset.mode));
console.log('mode cards:', JSON.stringify(modeCards));

// ---- 单人：难度列表最下方的特殊项 ---------------------------------------------------------
await page.evaluate(() => document.querySelector('.mode-card[data-mode="solo"]')?.click());
await wait(900);
const solo = await page.evaluate(() => {
  const block = document.querySelector('[data-testid="proto-infinite"]');
  const card = block?.querySelector('.diff-card');
  const name = card?.querySelector('.pcard__name');
  return {
    label: block?.querySelector('.proto-list__special-label')?.textContent ?? null,
    cards: document.querySelectorAll('.proto-list .diff-card').length,
    special: card ? { d: card.dataset.difficulty, special: card.dataset.special, name: name?.textContent, color: getComputedStyle(name).color, cls: card.className } : null,
    rounds: block ? (/∞/.test(block.querySelector('.pcard__meta')?.textContent || '') ? '∞' : (block.querySelector('.pcard__meta')?.textContent || '').slice(0, 12)) : null,
  };
});
console.log('solo entry:', JSON.stringify(solo));
const soloGeom = await geomOf('[data-testid="proto-infinite"] .diff-card');
console.log('solo geom:', JSON.stringify(soloGeom));
await page.screenshot({ path: `${OUT}/infinite-entry-solo-${vw}x${vh}.png` });

await page.evaluate(() => document.querySelector('[data-testid="proto-infinite"] .diff-card')?.click());
await wait(800);
const soloPick = await page.evaluate(() => ({
  difficulty: document.querySelector('.proto__body')?.dataset.difficulty,
  name: document.querySelector('.proto-brief__name')?.textContent,
  meta: document.querySelector('.proto-brief__meta')?.textContent,
}));
console.log('solo picked:', JSON.stringify(soloPick));
await page.screenshot({ path: `${OUT}/infinite-entry-solo-picked-${vw}x${vh}.png` });

await page.evaluate(() => document.querySelector('.proto-start')?.click());
await wait(1800);
const soloRoom = await page.evaluate(() => {
  const r = globalThis.__SP__?.store.get().room;
  return { mode: r?.mode, difficulty: r?.difficulty, seats: (r?.seats || []).filter(Boolean).length, slots: (r?.seats || []).length };
});
console.log('solo room:', JSON.stringify(soloRoom));
await page.screenshot({ path: `${OUT}/infinite-entry-solo-room-${vw}x${vh}.png` });

// ---- 房间里的难度弹窗：不该有超限（room.setDifficulty 只收难度，换 mode 不是它能做的事）---------
let roomDialog = 'skipped (no 难度 pill)';
const dpill = await page.$('.rs-pill__diff');
if (dpill) {
  await dpill.click();
  await wait(700);
  roomDialog = await page.evaluate(() => {
    const proto = document.querySelector('.proto__body');
    return proto
      ? { cards: document.querySelectorAll('.proto-list .diff-card').length, special: !!document.querySelector('[data-testid="proto-infinite"]') }
      : 'no dialog';
  });
  console.log('room difficulty dialog:', JSON.stringify(roomDialog));
  await page.screenshot({ path: `${OUT}/infinite-entry-room-dialog-${vw}x${vh}.png` });
  await page.evaluate(() => document.querySelector('.proto__back')?.click());
  await wait(500);
}

// ---- 同盟：选择同盟方式不再单独列超限；房内用 选择模拟协议 的「特殊难度」开关 ---------------
// leave the solo room first (the page resumes it otherwise) and reload into the hub
await page.evaluate(async () => {
  try { const m = await import('/js/net.js'); await m.net.request('room.leave', {}); } catch { /* already out */ }
});
await wait(800);
const okAlly = await enterLobby(page);
await page.evaluate(() => { [...document.querySelectorAll('.mode-card')].find((b) => b.dataset.mode === 'coop')?.click(); });
await wait(900);
const allyState = await page.evaluate(() => ({
  legacyEntry: !!document.querySelector('[data-testid="alliance-create-infinite"]'),
  createCard: !!document.querySelector('[data-testid="alliance-create"]'),
}));
console.log('ally dialog:', okAlly, JSON.stringify(allyState));
await page.screenshot({ path: `${OUT}/infinite-entry-ally-${vw}x${vh}.png` });

// create a plain co-op room, then turn 超限 on inside it
await page.evaluate(() => document.querySelector('[data-testid="alliance-create"]')?.click());
await wait(2000);
const coopBefore = await page.evaluate(() => {
  const r = globalThis.__SP__?.store.get().room;
  return { mode: r?.mode, difficulty: r?.difficulty, slots: (r?.seats || []).length };
});
console.log('coop room (before):', JSON.stringify(coopBefore));

// the room's own 选择模拟协议: the special card must be there for the host
let coopDialog = 'skipped (no 难度 pill)';
let coopPicked = null;
const cpil = await page.$('.rs-pill__diff');
if (cpil) {
  await cpil.click();
  await wait(800);
  coopDialog = await page.evaluate(() => {
    const proto = document.querySelector('.proto__body');
    return proto
      ? { cards: document.querySelectorAll('.proto-list .diff-card').length, special: !!document.querySelector('[data-testid="proto-infinite"]') }
      : 'no dialog';
  });
  console.log('room difficulty dialog:', JSON.stringify(coopDialog));
  await page.screenshot({ path: `${OUT}/infinite-entry-coop-dialog-${vw}x${vh}.png` });
  // pick the 特殊难度 card, then 确认
  await page.evaluate(() => document.querySelector('[data-testid="proto-infinite"] .diff-card')?.click());
  await wait(700);
  coopPicked = await page.evaluate(() => ({
    difficulty: document.querySelector('.proto__body')?.dataset.difficulty,
    hasArt: !!document.querySelector('.proto__pic svg.has-art'),
    imageHref: document.querySelector('.proto__pic image')?.getAttribute('href') ?? null,
    name: document.querySelector('.proto-brief__name')?.textContent ?? null,
  }));
  console.log('room dialog picked 超限:', JSON.stringify(coopPicked));
  await page.screenshot({ path: `${OUT}/infinite-entry-room-picked-${vw}x${vh}.png` });
  // scoped to the dialog: the room's own 开始模拟 button carries .proto-start too, and clicking that starts the match
  await page.evaluate(() => document.querySelector('.modal__box .proto-start')?.click());
  await wait(1600);
}
const coopAfter = await page.evaluate(() => {
  const r = globalThis.__SP__?.store.get().room;
  const text = document.body.innerText.replace(/\s+/g, ' ');
  return { mode: r?.mode, difficulty: r?.difficulty, slots: (r?.seats || []).length, title: /超限模拟/.test(text), pill: !!document.querySelector('.rs-pill__diff.is-infinite') };
});
console.log('coop room (after):', JSON.stringify(coopAfter));
await page.screenshot({ path: `${OUT}/infinite-entry-coop-room-${vw}x${vh}.png` });
const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length, own.slice(0, 3));
await browser.close();

const ok = okLobby && okAlly
  && modeCards.length === 3 && !modeCards.includes('solo_infinite')
  && solo.cards === 4 && solo.special?.d === 'INFINITE' && solo.special.special === 'infinite' && /超限/.test(solo.special.name || '')
  && solo.special.cls.includes('is-infinite') && /特殊难度/.test(solo.label || '') && solo.rounds === '∞' && soloGeom?.inView
  && soloPick.difficulty === 'INFINITE' && /超限/.test(soloPick.name || '') && /∞/.test(soloPick.meta || '')
  && soloRoom.mode === 'solo_infinite' && soloRoom.seats === 1
  // 单人超限房自己的难度弹窗：同一张「特殊难度」卡，进来就是选中态（房主可以关掉）
  && (roomDialog === 'no dialog' || (roomDialog.cards === 4 && roomDialog.special === true))
  // 同盟：没有旧的单独入口，普通建盟卡还在
  && allyState.createCard === true && allyState.legacyEntry === false
  && coopBefore.mode === 'coop' && coopBefore.slots === 4
  // 房内 选择模拟协议 有「特殊难度」卡（房主可改），选它时左侧是官方立绘
  && coopDialog.special === true && coopDialog.cards === 4
  && coopPicked.difficulty === 'INFINITE' && coopPicked.hasArt === true && /abyss_rhodes_island/.test(coopPicked.imageHref || '')
  // 确认后房间真的成了 coop_infinite；超限是房间 mode 而不是难度，难度保持建盟时的那个
  && coopAfter.mode === 'coop_infinite' && coopAfter.difficulty === coopBefore.difficulty && coopAfter.slots === 4 && coopAfter.pill === true
  && own.length === 0;
console.log('\nRESULT:', ok ? `OK — ${vw}×${vh}：单人入口、同盟无单独入口、房内开关超限（含左侧立绘）都对` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
