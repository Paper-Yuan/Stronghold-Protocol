// devtools/render-check-annihilation-room.mjs — 湮灭模拟的真机自查：房内蚀流选择器 → 开局 → 简报 → 策略草稿 →
// 协议启动！ → PREP 的 R1 藏品三选一（.rlov）→ 选完 canReady → 准备就绪 → 局内蚀流角标（.gm__erosion）
//
//   这一份是 handoff/ANNIHILATION-CLIENT-2026-10-27.md §4.1 的验收脚本：它把「大厅 → 房 → 开局 → 简报 → 策略草稿 →
//   R1 三选一 → 选完能准备就绪」整条路真的点一遍，并把每一步的 phase / 屏幕 / 覆盖层写进日志。上一版只把局内那两步
//   当信息打印（停在 BAND_DRAFT），所以 ① 浮层是否在 R1 出现、② 选卡后 canReady 是否转真、③ 角标文案，从来没被确认过。
//
//   建房不走大厅第三张卡，直接从页面里发 room.create（条目待接入时开始键是暗的）：
//     room.create { mode:'solo', difficulty:'ANNIHILATION', erosion:4 }
//   蚀流档位用 SP_EROSION 选（1–6；6 = 无尽湮灭，此时 lastRound 为 null，脚本顺带断言 DOM 里没有 undefined/NaN）。
//
//   SP_BASE=http://127.0.0.1:3000 node devtools/render-check-annihilation-room.mjs
//   SP_BASE=http://127.0.0.1:3000 SP_EROSION=6 SP_VIEWPORT=1280x720 node devtools/render-check-annihilation-room.mjs
//
//   需要 danger-full-access：puppeteer 要 spawn Chrome（沙箱下是 spawn EPERM）。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
const EROSION = Math.min(6, Math.max(1, Math.round(Number(process.env.SP_EROSION) || 4)));
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.round(Number(n) || 0));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh, hasTouch: vw <= 900, isMobile: vw <= 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/** title screen → lobby */
async function enterLobby(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  for (let i = 0; i < 3; i++) {
    if (await p.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await p.evaluate(async () => {
      const i = document.querySelector('.title-login input, input[type="text"]');
      if (i && !i.value) { i.value = `ann-${Math.floor(Math.random() * 900 + 100)}`; i.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2000);
  }
  return p.evaluate(() => !!document.querySelector('.mode-card'));
}

const okLobby = await enterLobby(page);
console.log('lobby:', okLobby);

// ---- 建房 ---------------------------------------------------------------
const created = await page.evaluate(async (erosion) => {
  const m = await import('/js/net.js');
  const r = await m.net.request('room.create', { mode: 'solo', difficulty: 'ANNIHILATION', erosion });
  return { t: r?.t, code: r?.code };
}, EROSION);
console.log('room.create:', JSON.stringify(created), `erosion=${EROSION}`);
await page.waitForSelector('.rs-pill', { visible: true, timeout: 20000 });
await wait(900);

const room = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.rs-erosion__chip')];
  const diff = document.querySelector('.rs-pill__diff');
  return {
    state: (() => { const r = globalThis.__SP__?.store.get().room; return { mode: r?.mode, difficulty: r?.difficulty, erosion: r?.erosion }; })(),
    chips: chips.map((c) => ({ tier: c.dataset.tier, on: c.classList.contains('is-on'), disabled: c.disabled, text: c.textContent.trim() })),
    diffText: diff?.textContent?.trim() ?? null,
    inView: chips.every((c) => { const b = c.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log('room:', JSON.stringify(room));
await page.screenshot({ path: `${OUT}/annihilation-room-${vw}x${vh}.png` });

// ---- 改档：非 6 档时点 6 档（房主开局前可改） ---------------------------------
// SP_BUMP=0 跳过改档，让本局就按 SP_EROSION 跑（角标写档位数字的那条路）；缺省改档，本局跑 6 档（无尽角标 + lastRound null）。
const doBump = EROSION !== 6 && process.env.SP_BUMP !== '0';
const startErosion = doBump ? 6 : EROSION;
let bumped = null;
if (doBump) {
  const chip6 = await page.$('.rs-erosion__chip[data-tier="6"]');
  if (chip6) {
    await chip6.click();
    await wait(1200);
    bumped = await page.evaluate(() => {
      const r = globalThis.__SP__?.store.get().room;
      return { erosion: r?.erosion, on: document.querySelector('.rs-erosion__chip.is-on')?.dataset.tier ?? null };
    });
  }
  console.log('setErosion 6:', JSON.stringify(bumped));
}

// ---- 开局 → 简报 → 策略草稿 → 协议启动！ → R1 三选一 --------------------------
/** one observation of the client: phase, screen, and every overlay/button the walk touches */
async function observe() {
  return page.evaluate(() => {
    const st = globalThis.__SP__?.store.get() || {};
    const pub = st.match?.public ?? null;
    const priv = st.match?.private ?? null;
    const q = (s) => document.querySelector(s);
    const badge = q('.gm__erosion');
    const rlc = [...document.querySelectorAll('.rlov__grid .rlc')];
    const rb = q('.readybtn');
    return {
      phase: pub?.phase ?? null,
      round: pub?.round ?? null,
      screen: q('.screen.draft') ? 'draft' : q('.screen.brief') ? 'brief' : q('.gm__hud') ? 'game' : q('.rs-pill') ? 'room' : 'other',
      lastRound: pub?.lastRound ?? null,
      endless: pub?.endless ?? null,
      erosion: pub?.erosion ?? null,
      roomStart: !!q('.rs-go'),
      briefGo: !!q('.brief-go'),
      bands: document.querySelectorAll('.dband').length,
      draftConfirm: !!q('.draft-confirm') && !q('.draft-confirm[disabled]'),
      lrov: !!q('.rlov'),
      lrovTitle: q('.rlov__title')?.textContent?.trim() ?? null,
      slotStart: !!q('.slot__start'),
      slotSkip: !!q('.slot__skip'),
      cards: rlc.length,
      armed: rlc.findIndex((c) => c.classList.contains('is-armed')),
      pos: !!q('.rlpos'),
      posOk: !!q('.rlpos__ok'),
      dialog: q('.modal__box') ? (q('.modal__box').textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null,
      badge: badge ? { text: badge.textContent.replace(/\s+/g, ' ').trim(), cls: badge.className } : null,
      canReady: priv?.canReady ?? null,
      ready: priv?.ready ?? null,
      readyBtn: rb ? { text: rb.textContent.replace(/\s+/g, ' ').trim(), disabled: !!rb.disabled } : null,
      relicDraft: priv?.relics?.draft ? { kind: priv.relics.draft.kind, cards: priv.relics.draft.cards?.length ?? 0 } : null,
      relics: priv?.relics?.owned?.length ?? null,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 4000),
    };
  });
}

/** click the first matching selector in the page (returns the selector that worked) */
async function clickOne(selectors) {
  return page.evaluate((list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && !el.disabled) { el.click(); return sel; }
    }
    return null;
  }, selectors);
}

const trail = [];
let sawRelic = null;      // the R1 1-of-3 overlay as first seen
let picked = null;        // { at, cards } after a successful pick
let readyHit = null;      // after clicking 准备就绪
let drawAt = 0;           // when 启动藏品抽取 was clicked（外层时钟，只作对照）
let drawMs = 0;           // 点「启动」→ 三张卡出现（页面内 performance.now() 量的）
let drawPolledMs = 0;     // 同一段用外层轮询量出来的数（含 700ms 轮询粒度 + 截图/往返，不参与判定）
let drawDelays = [];      // 三张卡的 animation-delay（0s / 0.07s / 0.14s）
let drawStopped = 0;      // data-stopped 的轮数（停轮冲击钩子）
const t0 = Date.now();
while (Date.now() - t0 < 150000) {
  const st = await observe();
  const tick = { at: Date.now() - t0, phase: st.phase, round: st.round, screen: st.screen, act: null };
  // 增益藏品老虎机（z 90）盖在负面三选一（z 88）之上：先收下，才露出三选一（mod 行为一致）
  let act = null;
  if (st.pos) act = await clickOne(['.rlpos__ok', '.rlpos .slot__start', '.rlpos .slot__skip']);
  else if (st.lrov) {
    if (!sawRelic) { sawRelic = { phase: st.phase, round: st.round, title: st.lrovTitle, cards: st.relicDraft?.cards ?? st.cards, draft: st.relicDraft }; console.log('R1 relic overlay:', JSON.stringify(sawRelic)); }
    if (st.slotStart) {
      // 这一段节奏（三只轮 900/1120/1340 + 40 停轮 + 360 揭晓空拍 ≈ 1740ms）比本循环的 700ms 轮询粒度还短，
      // 用「外层 Date.now() − 点击时刻」量会把等待、截图和 evaluate 往返一起算进去（实测 3.2–4.5s，视 dsf 而定）。
      // 所以时钟放在页面里：点击前记 performance.now()，MutationObserver 记每张 .rlc 进 DOM 的时刻；
      // drawMs 之后只用这两个页面内时间戳相减。
      if (!drawAt) {
        const clicked = await page.evaluate(() => {
          const btn = document.querySelector('.rlov .slot__start');
          if (!btn) return false;
          const P = (globalThis.__SP_DRAW__ = { at: performance.now(), cards: [], stopped: 0 });
          new MutationObserver(() => {
            [...document.querySelectorAll('.rlov__grid .rlc')].forEach((el, i) => { if (P.cards[i] == null) P.cards[i] = performance.now(); });
            P.stopped = document.querySelectorAll('.slot__reel[data-stopped]').length;
          }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-stopped'] });
          btn.click();
          return true;
        });
        if (clicked) { drawAt = Date.now(); act = '.rlov .slot__start'; }
      } else act = await clickOne(['.rlov .slot__start']);
    }
    // 「跳过动画」不点：这一轮要量的是自然节奏（900/1120/1340 + 40 + 360 ≈ 1740ms）
    else if (st.cards > 0) {
      // 三张卡出现的时刻：点「启动藏品抽取」→ 这个循环看见卡（900/1120/1340 + 40 + 360 ≈ 1740ms）。
      // 数从页面内探针取，不取外层轮询差：polledMs 只留作对照，判据用的是 ms。
      if (drawAt && !drawMs) {
        drawPolledMs = Date.now() - drawAt;
        const probed = await page.evaluate(() => {
          const P = globalThis.__SP_DRAW__;
          const cards = P ? P.cards.filter((n) => n != null) : [];
          return { at: P ? P.at : null, cards, stopped: document.querySelectorAll('.slot__reel[data-stopped]').length };
        });
        drawMs = probed.at && probed.cards.length ? Math.round(Math.max(...probed.cards) - probed.at) : drawPolledMs;
        drawDelays = await page.evaluate(() => [...document.querySelectorAll('.rlov__grid .rlc')]
          .map((el) => getComputedStyle(el).animationDelay.replace(/,.*$/, '')));
        drawStopped = probed.stopped;
        console.log('draw timing:', JSON.stringify({ ms: drawMs, polledMs: drawPolledMs, stopped: drawStopped, delays: drawDelays }));
      }
      // 两次点击同一张：第一次选中（.is-armed），第二次确认
      act = await clickOne(st.armed >= 0 ? ['.rlov__grid .rlc:nth-child(' + (st.armed + 1) + ')'] : ['.rlov__grid .rlc']);
      if (st.armed >= 0 && act) picked = { at: Date.now() - t0, cards: st.cards, idx: st.armed };
    }
  } else if (!st.phase && st.roomStart) act = await clickOne(['.rs-go']);   // 房内：开始模拟（room.start）
  else if (st.phase === 'INFO_CHECK') act = await clickOne(['.brief-go']);
  else if (st.phase === 'BAND_DRAFT') {
    if (st.draftConfirm) act = await clickOne(['.draft-confirm']);
    else if (st.bands > 0) act = await clickOne(['.dband:not(.is-taken)']);
  } else if (st.phase === 'BATTLE_CHECK') act = 'wait';
  tick.act = act;
  if (act) { trail.push(tick); console.log('act:', JSON.stringify(tick)); }
  // 三选一收下后：canReady 转真 → 点「准备就绪」
  if (!st.lrov && !st.pos && st.canReady === true && st.readyBtn && !st.readyBtn.disabled && st.ready === false && st.phase === 'PREP') {
    const shot = await observe();
    await page.screenshot({ path: `${OUT}/annihilation-game-${vw}x${vh}.png` });
    readyHit = { screen: shot.screen, badge: shot.badge, canReady: shot.canReady, readyBtn: shot.readyBtn, lrov: shot.lrov, cards: sawRelic?.cards ?? 0, text: shot.text };
    const clicked = await clickOne(['.readybtn']);
    // 口袋里有资金时 准备 会先弹出确认框（gameLogic.readyFundsPrompt）：点它的确认键，才算真的发出去
    let dialogSeen = null;
    for (let i = 0; i < 6; i++) {
      await wait(500);
      const d = await page.evaluate(() => {
        const box = document.querySelector('.modal__box');
        return box ? { text: (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) } : null;
      });
      if (!d) break;
      dialogSeen = d.text;
      const okSel = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.modal__actions button')];
        const ok = btns[btns.length - 1];
        if (!ok) return null;
        ok.click();
        return ok.textContent.replace(/\s+/g, ' ').trim();
      });
      console.log('ready dialog:', JSON.stringify({ text: d.text, ok: okSel }));
    }
    await wait(1200);
    const after = await observe();
    readyHit.clicked = clicked;
    readyHit.dialog = dialogSeen;
    readyHit.afterReady = { ready: after.ready, readyBtn: after.readyBtn, phase: after.phase };
    console.log('ready:', JSON.stringify({ clicked, ready: after.ready, phase: after.phase }));
    await page.screenshot({ path: `${OUT}/annihilation-game-ready-${vw}x${vh}.png` });
    break;
  }
  if (st.screen === 'game' && st.lrov && !globalThis.__shotGame) {
    globalThis.__shotGame = true;
    await page.screenshot({ path: `${OUT}/annihilation-relic-${vw}x${vh}.png` });
  }
  await wait(700);
}

const final = await observe();
console.log('final:', JSON.stringify({ phase: final.phase, round: final.round, screen: final.screen, badge: final.badge, canReady: final.canReady, lrov: final.lrov, relics: final.relics, endless: final.endless, lastRound: final.lastRound }));
// 无尽局的回合显示：DOM 里不该出现 undefined / NaN / /null
const badText = /undefined|NaN|\/null/.test(final.text) ? (final.text.match(/.{0,40}(undefined|NaN|\/null).{0,40}/) || [])[0] : null;
console.log('text:', JSON.stringify({ bad: badText, hasRoundbox: final.text.includes('回合') }));

const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length, own.slice(0, 3));
await browser.close();

// ---- 判定 -------------------------------------------------------------------
const badge = readyHit?.badge || final.badge || null;
const badgeText = badge?.text ?? '';
const okChips = room.chips.length === 6
  && room.chips.filter((c) => c.on).length === 1 && room.chips.find((c) => c.on)?.tier === String(EROSION)
  && room.chips[5].text === '∞' && !room.chips[0].disabled
  && room.state.difficulty === 'ANNIHILATION' && room.state.erosion === EROSION
  && room.inView && room.overflowX <= 0;
const okBump = doBump ? !!(bumped && bumped.erosion === 6 && bumped.on === '6') : true;
// ① 浮层真的出现在 R1；② 选完浮层关闭、canReady 转真、准备就绪可点（点下去 ready=true）
const okRelic = !!sawRelic && sawRelic.round === 1 && sawRelic.cards === 3;
const okPicked = !!picked && final.lrov === false && !!readyHit && readyHit.canReady === true
  && readyHit.readyBtn && readyHit.readyBtn.disabled === false && readyHit.afterReady?.ready === true;
// ③ 角标：本局实际档位（改档后是 6）写档位数字，无尽写 ∞ + is-endless
const okBadge = startErosion >= 6
  ? /无尽湮灭/.test(badgeText) && badgeText.includes('∞') && /is-endless/.test(badge?.cls || '')
  : new RegExp(`蚀流\\s*${startErosion}`).test(badgeText) && !/is-endless/.test(badge?.cls || '');
// 无尽局：lastRound 为 null，DOM 文本里不许出现 undefined / NaN / /null
const okText = !badText && (startErosion < 6 || final.lastRound === null);
// 节奏与动效钩子：点「启动藏品抽取」→ 三张卡 ≤2.6s（900+220×2+40+360 = 1740ms；页面内实测 1781ms@dsf1 /
// 1856ms@dsf3，余量给无头环境的合成器），stagger 0 / 70 / 140ms，停轮钩子三只轮都有。
// drawMs 是页面内 performance.now() 的差；外层轮询量同一段会到 3.2–4.5s（700ms 轮询粒度 + 截图 + 往返），那不是产品的时间。
const okTiming = drawMs > 0 && drawMs < 2600
  && JSON.stringify(drawDelays) === JSON.stringify(['0s', '0.07s', '0.14s'])
  && drawStopped === 3;
const ok = okLobby && okChips && okBump && okRelic && okPicked && okBadge && okText && okTiming && own.length === 0;

console.log('\nchecks:', JSON.stringify({ okLobby, okChips, okBump, okRelic, okPicked, okBadge, okText, okTiming, drawMs, drawPolledMs, drawDelays, drawStopped, errors: own.length }));
console.log('RESULT:', ok
  ? `OK — ${vw}×${vh} 蚀流 ${startErosion}：房内胶囊${doBump ? '/改档' : ''}、简报、策略草稿、R1 三选一（${sawRelic?.cards} 选 1，${drawMs}ms 出卡、stagger ${drawDelays.join('/')}）、选完 canReady→准备就绪、角标「${badgeText}」全部通过`
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);
