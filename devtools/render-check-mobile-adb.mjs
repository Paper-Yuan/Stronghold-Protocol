// devtools/render-check-mobile-adb.mjs — 真机（Android + Chrome over adb）自查
//
// 与 render-check-*.mjs 的区别只有一个：那批脚本用 puppeteer.launch 开**本机** Chrome 并伪造视口；
// 这个脚本用 `puppeteer.connect` 接**手机上的** Chrome（CDP over adb），所以量到的是真机的视口、真机的字体、
// 真机的触控尺寸。查的是「手机端这条入口能不能走」：
//
//   ① 标题页 → 大厅（三张卡、第三张是拓展模式、不横向溢出）
//   ② 拓展模式 → 选择拓展玩法（两条目：湮灭 / 炸惊，没有 missing 行）
//   ③ 触控地板：蚀流 / 形态 chip 与开始键的可点区域 ≥ 24×24 CSS px（本仓的地板）
//   ④ 开始 → 房（room.create 带 difficulty=ANNIHILATION，房内出现蚀流胶囊）
//   ⑤ 全程 0 console error / 0 pageerror（外部字体与感谢名单接口除外）
//
// 2026-10-28 晚扩到「本轮新增的 9 块面板」（面板逻辑抽在 devtools/lib/zhajing-panels.mjs，与桌面四档共用）：
//   hall / theme-zhajing / theme-ann / pool-zhajing / pool-ann / ban-picker / card-art / profile / icons
//   每步落一张 handoff/shots/mobile-adb-<step>.png，并给 PASS / FAIL / KNOWN 三态；**KNOWN = 客户端还没落**（不计红），
//   FAIL 才红。一步失败不中断整体：全部跑完后一次性打印清单。
//
//   # 幂等：先停掉 App（它可能占着前台/端口），再用**同一条命令**做 reverse + forward + 起页面
//   $ADB = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
//   & $ADB shell am force-stop com.paper.stronghold
//   & $ADB reverse tcp:3000 tcp:3000
//   & $ADB forward tcp:9222 localabstract:chrome_devtools_remote
//   & $ADB shell am start -a android.intent.action.VIEW -d http://127.0.0.1:3000/ com.android.chrome
//   $env:SP_CDP="http://127.0.0.1:9222"; $env:SP_BASE="http://127.0.0.1:3000"; node devtools/render-check-mobile-adb.mjs
//
//   设备不在线时脚本以 exit 2 收场（不是红，是「没设备」）。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { runZhajingPanels, summarize } from './lib/zhajing-panels.mjs';

const CDP = process.env.SP_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.env.SP_TAG || 'phone';
const TOUCH_FLOOR = 24; // CSS px — lobby.css / room.css 的触控地板

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const pages = await browser.pages();
// 手机上常常留着好几个标签页：优先挑**当前可见**的那一个，否则会驱动一个后台页（渲染/定时器都被节流）。
const visible = [];
for (const p of pages) {
  const vis = await p.evaluate(() => document.visibilityState).catch(() => 'unknown');
  if (vis === 'visible') visible.push(p);
}
const page = visible.find((p) => (p.url() || '').startsWith(BASE)) || visible[0] || pages.find((p) => (p.url() || '').startsWith(BASE)) || pages[0];
if (!page) throw new Error('no page on the device');
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
// 这个脚本只接真机：连上本机 Chrome（端口被别的进程占着、adb forward 静默失败）时必须立刻停手，
// 否则会去点别人浏览器里的页面。
const ua = await page.evaluate(() => navigator.userAgent);
if (!/Android/i.test(ua)) {
  console.error(`[${TAG}] not a phone: UA is "${ua}" — check that adb forward points at the device (and the port is free)`);
  await browser.disconnect();
  process.exit(2);
}

/** 每步截图（业主随时可回看）：handoff/shots/mobile-adb-<step>.png。 */
const shot = async (name) => {
  try { await page.screenshot({ path: `${OUT}/mobile-adb-${name}.png` }); } catch { /* 页面没了就跳过 */ }
};

/** 标题页 → 大厅：身份记在 localStorage，第二次跑就已经在大厅。 */
async function enterLobby() {
  await wait(1200);
  // 不在大厅（停在标题页或上一轮留下的房间里）就重新进站：身份记在 localStorage，重进直接落大厅
  if (!(await page.evaluate(() => !!document.querySelector('.mode-card')))) {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1800);
  }
  for (let i = 0; i < 3; i++) {
    if (await page.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await page.evaluate(async () => {
      const input = document.querySelector('.title-login input, input[type="text"]');
      if (input && !input.value) {
        input.value = 'mobile-' + Math.floor(Math.random() * 900 + 100);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 150));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2200);
  }
  return page.evaluate(() => !!document.querySelector('.mode-card'));
}

/** 可点区域（含 :before/:after 的命中区按元素盒算）与是否在视口内。 */
const boxes = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
  const b = el.getBoundingClientRect();
  return { w: Math.round(b.width), h: Math.round(b.height), inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
}), sel);

const view = await page.evaluate(() => ({
  url: location.href,
  w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ua: navigator.userAgent,
}));
console.log(`[${TAG}] viewport:`, JSON.stringify(view));

const okLobby = await enterLobby();
const hub = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.hub-entries .mode-card')];
  return {
    cards: cards.map((c) => c.dataset.mode),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    inView: cards.every((c) => { const b = c.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }),
  };
});
console.log(`[${TAG}] hub:`, JSON.stringify(hub));
await page.screenshot({ path: `${OUT}/mobile-${TAG}-lobby.png` });

await page.click('.mode-card[data-mode="ext"]');
await page.waitForSelector('.modal__box.ext', { visible: true, timeout: 15000 });
await wait(800);
const hall = await page.evaluate(() => {
  const box = document.querySelector('.modal__box.ext');
  const rows = [...box.querySelectorAll('.ext-row')];
  const start = box.querySelector('.ext-foot__start');
  return {
    title: box.querySelector('.modal__title')?.textContent,
    rows: rows.map((el) => el.dataset.ext),
    statuses: rows.map((el) => el.dataset.status),
    chips: rows.map((el) => el.querySelector('.chip')?.textContent),
    start: { text: start?.textContent.trim(), disabled: start?.disabled === true },
    tiers: [...box.querySelectorAll('.ext-tier')].map((el) => el.dataset.tier),
    party: [...box.querySelectorAll('.ext-party__chip')].map((el) => el.dataset.party),
    selected: box.querySelector('.ext-row.is-selected')?.dataset.ext,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // 矮屏（手机横屏）最容易出问题的一处：页脚必须整个在弹层里
    footIn: (() => {
      const f = box.querySelector('.ext-foot').getBoundingClientRect();
      const c = box.getBoundingClientRect();
      return f.bottom <= c.bottom + 1 && f.top >= c.top - 1;
    })(),
  };
});
console.log(`[${TAG}] hall:`, JSON.stringify(hall));
await page.screenshot({ path: `${OUT}/mobile-${TAG}-hall.png` });

// 进入 → 主题大厅（业主 2026-10-28）：原包主视觉 + 单人/同盟 + 蚀流 + 开始，触控地板在真机上量
await page.click('[data-testid="extension-enter"]');
await page.waitForSelector('.ext-theme', { visible: true, timeout: 15000 });
await wait(700);
const theme = await page.evaluate(() => {
  const box = document.querySelector('.ext-theme');
  const art = box.querySelector('.ext-theme__art-img');
  return {
    name: box.querySelector('.ext-theme__name')?.textContent?.trim() ?? null,
    kicker: box.querySelector('.ext-theme__kicker')?.textContent?.trim() ?? null,
    meta: box.querySelector('.ext-theme__meta')?.textContent?.trim() ?? null,
    artOk: !!(art && art.complete && art.naturalWidth > 0),
    tiers: [...box.querySelectorAll('.ext-tier')].map((el) => el.dataset.tier),
    party: [...box.querySelectorAll('.ext-party__chip')].map((el) => el.dataset.party),
    start: box.querySelector('[data-testid="extension-start"]')?.textContent.trim() ?? null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    footIn: (() => {
      const f = box.querySelector('.ext-theme__foot').getBoundingClientRect();
      const c = box.getBoundingClientRect();
      return f.bottom <= c.bottom + 1 && f.top >= c.top - 1;
    })(),
  };
});
console.log(`[${TAG}] theme:`, JSON.stringify(theme));
await page.screenshot({ path: `${OUT}/mobile-${TAG}-theme.png` });

const tierBoxes = await boxes('.ext-theme .ext-tier');
const partyBoxes = await boxes('.ext-theme .ext-party__chip');
const startBoxes = await boxes('.ext-theme__start');
console.log(`[${TAG}] touch:`, JSON.stringify({
  tier: tierBoxes.map((b) => `${b.w}x${b.h}${b.inView ? '' : '(off-view)'}`),
  party: partyBoxes.map((b) => `${b.w}x${b.h}${b.inView ? '' : '(off-view)'}`),
  start: startBoxes.map((b) => `${b.w}x${b.h}${b.inView ? '' : '(off-view)'}`),
}));

// 开始 → 房：真机上点一次开始，看 room.create 建出的是不是湮灭房
await page.click('[data-testid="extension-start"]');
await page.waitForSelector('.rs-pill', { visible: true, timeout: 30000 });
await wait(900);
const room = await page.evaluate(() => {
  const r = globalThis.__SP__?.store.get().room;
  const chips = [...document.querySelectorAll('.rs-erosion__chip')];
  return {
    mode: r?.mode, difficulty: r?.difficulty, erosion: r?.erosion,
    pill: document.querySelector('.rs-pill__diff')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    chips: chips.length,
    on: chips.find((c) => c.classList.contains('is-on'))?.dataset.tier ?? null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log(`[${TAG}] room:`, JSON.stringify(room));
await page.screenshot({ path: `${OUT}/mobile-${TAG}-room.png` });
// 收尾：离开房间（否则下一次跑会直接进房，找不到大厅卡）。room.leave 没生效时退回「重新加载」，
// 身份记在 localStorage，重新进站直接落在大厅。
const left = await page.evaluate(async () => {
  const m = await import('/js/net.js');
  return m.net.request('room.leave', {}).then(() => true).catch(() => false);
});
try { await page.waitForSelector('.mode-card', { visible: true, timeout: 12000 }); } catch { /* fall back below */ }
let backToHub = await page.evaluate(() => !!document.querySelector('.mode-card'));
if (!backToHub) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1800);
  backToHub = await page.evaluate(() => !!document.querySelector('.mode-card'));
}
console.log(`[${TAG}] leave:`, JSON.stringify({ requested: left, backToHub }));

const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log(`[${TAG}] errors:`, own.length, own.slice(0, 4));
console.log(`[${TAG}] backToHub:`, backToHub);

// ---- 本轮新增的 9 块面板（大厅两条目 / 二级页 / 干员调配（原「卡池调整」，2026-10-29 并入）/ ban-picker / 名片立绘 / 个人资料 / 图标）---
// 面板逻辑与桌面四档共用 devtools/lib/zhajing-panels.mjs；一步失败不中断，全部跑完再报 PASS/FAIL/KNOWN。
if (!backToHub) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(1800);
}
const panelSteps = await runZhajingPanels({ page, shot, label: TAG });
const panelSum = summarize(panelSteps);
console.log(`[${TAG}] panels:`, panelSum.table.join(' | '));
for (const line of panelSum.fails) console.log(`[${TAG}] panel FAIL: ${line}`);
for (const line of panelSum.knowns) console.log(`[${TAG}] panel KNOWN: ${line}`);

/** 老的四步断言（保留）。 */
const touchOk = (list) => list.length > 0 && list.every((b) => b.w >= TOUCH_FLOOR && b.h >= TOUCH_FLOOR && b.inView);
const legacyOk = okLobby
  && JSON.stringify(hub.cards) === JSON.stringify(['solo', 'coop', 'ext'])
  && hub.inView && hub.overflowX <= 0
  && hall.title === '选择拓展玩法'
  && JSON.stringify(hall.rows) === JSON.stringify(['annihilation', 'zhajing'])
  && JSON.stringify(hall.statuses) === JSON.stringify(['ready', 'ready'])
  && JSON.stringify(hall.chips) === JSON.stringify(['可开局', '可开局'])
  && hall.selected === 'annihilation'
  && hall.footIn && hall.overflowX <= 0
  && theme.name === '湮灭模拟' && /ANNIHILATION/.test(theme.kicker || '') && /AC-5/.test(theme.meta || '')
  && theme.artOk
  && JSON.stringify(theme.tiers) === JSON.stringify(['1', '2', '3', '4', '5', '6'])
  && JSON.stringify(theme.party) === JSON.stringify(['solo', 'coop'])
  && theme.start === '开始 湮灭模拟'
  && theme.footIn && theme.overflowX <= 0
  && touchOk(tierBoxes) && touchOk(partyBoxes) && touchOk(startBoxes)
  && room && room.difficulty === 'ANNIHILATION' && room.mode === 'solo' && room.erosion === 1
  && room.chips === 6 && room.on === '1' && room.overflowX <= 0
  && own.length === 0;
const ok = legacyOk && panelSum.ok;
console.log(`[${TAG}] legacy:`, legacyOk ? 'OK' : 'CHECK ABOVE');
console.log(`[${TAG}] panels:`, panelSum.ok ? `OK（PASS ${panelSum.pass} / KNOWN ${panelSum.known}）` : `FAIL ${panelSum.fail}`);
console.log(`[${TAG}] RESULT:`, ok ? 'OK' : 'CHECK ABOVE');
await browser.disconnect();
process.exit(ok ? 0 : 1);
