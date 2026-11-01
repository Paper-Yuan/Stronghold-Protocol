// devtools/render-check-extension-hall.mjs — 拓展模式的入口与大厅自查（2026-10-26）
//
//   大厅：三张模式卡（独立模拟 / 同盟模拟 / 拓展模式）同一行、同高，第三张是霜蓝而不是超限的紫
//   大厅卡的第二行：条目数（「1 个玩法 · 不计入官方战绩」），不是「0 个玩法」
//   拓展模式 → 选择拓展玩法：左档案 40 % / 右列表 60 %、每张卡一行、行高与行距一致（88 / 10、64 / 8、56 / 6）
//   湮灭模拟可开局（2026-10-27：status 已转 ready）：芯片「可开局」、开始写着「开始 湮灭模拟」、档案说「玩法包已就位」
//   大厅只有两个玩法包（湮灭 + 炸惊，两条都是 ready）：两行都可点、都没有「筹备中」的虚线框；「筹备中」那种占位行
//   已随 endless-fire / deep-dive 一起下线（2026-10-29），现在只有 test/ui 里的合成表还会走到它
//   页脚有「单人 / 同盟」与蚀流 1–6 chips（缺省 solo、蚀流 1）
//   开始 → 房：room.create 真的建出 ANNIHILATION 房（SP_PARTY=coop 时 mode 是 coop，对应 mode_multi_annihilation）
//   Esc 关闭后焦点回到大厅第三张卡；三档视口 0 console error、无横向溢出
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-extension-hall.mjs
//   SP_BASE=http://127.0.0.1:3020 SP_VIEWPORT=1280x720 node devtools/render-check-extension-hall.mjs   # 只跑一档
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const OUT = process.env.SP_OUT || 'E:/Workbox/系统/handoff/shots';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PARTY = process.env.SP_PARTY === 'coop' ? 'coop' : 'solo';
const VIEWPORTS = (process.env.SP_VIEWPORT || '1280x720,800x360,667x375')
  .split(',').map((s) => s.split('x').map((n) => Math.round(Number(n) || 0)));

/**
 * Expected row height / list gap of the hall at a viewport (the three steps of lobby.css).
 * The row height is exact; the gap is a floor (`≥`): the phone spacing pass widened it on narrow/short screens
 * (窄屏 +6px / 矮屏 +4px, so a short screen measures 10 where this step says 6), and a larger gap is still the
 * promised spacing — only a smaller one is a regression.
 *
 * The three steps are the product's two exclusive media blocks plus the base rule (public/css/screens/lobby.css):
 *   `@media (max-height: 520px)`                            → row 56 / gap 6   (矮屏)
 *   `@media (max-width: 900px) and (min-height: 521px)`     → row 64 / gap 8   (窄屏)
 *   neither                                                 → row 88 / gap 10  (桌面)
 * Short screens win: the narrow block carries `min-height: 521px`, so a viewport that is both narrow and short
 * (800×360, 667×375) is drawn by the 56 rule and never by the 64 one — hence `h <= 520` is tested first below.
 */
const ladder = ([w, h]) => (h <= 520 ? { row: 56, gap: 6 } : w <= 900 ? { row: 64, gap: 8 } : { row: 88, gap: 10 });

// The ladder itself must resolve all three tiers the way the product does — concrete numbers, one row per tier, so a
// later shuffle of the two conditions (which would silently expect 64 at 800×360) fails here instead of passing quietly.
const LADDER_TIERS = [[[1280, 720], 88], [[800, 360], 56], [[667, 375], 56], [[800, 640], 64]]
  .every(([[w, h], row]) => ladder([w, h]).row === row);

/** title screen → lobby (a fresh page may already be there: the identity is remembered) */
async function enterLobby(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  for (let i = 0; i < 3; i++) {
    if (await p.evaluate(() => !!document.querySelector('.mode-card'))) return true;
    await p.evaluate(async () => {
      const i = document.querySelector('.title-login input, input[type="text"]');
      if (i && !i.value) { i.value = `ext-${Math.floor(Math.random() * 900 + 100)}`; i.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始|进入/.test(b.textContent || ''))?.click();
    });
    await wait(2000);
  }
  return p.evaluate(() => !!document.querySelector('.mode-card'));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
let allOk = true;

for (const [vw, vh] of VIEWPORTS) {
  const tag = `${vw}x${vh}`;
  const errors = [];
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh, hasTouch: vw <= 900, isMobile: vw <= 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const okLobby = await enterLobby(page);
  const hub = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hub-entries .mode-card')];
    const rect = (el) => el.getBoundingClientRect();
    const ext = cards.find((c) => c.dataset.mode === 'ext');
    const coop = cards.find((c) => c.dataset.mode === 'coop');
    return {
      cards: cards.map((c) => c.dataset.mode),
      tops: cards.map((c) => Math.round(rect(c).top)),
      bottoms: cards.map((c) => Math.round(rect(c).bottom)),
      line: (() => { const g = ext?.closest('.hub-entry-wrap')?.querySelector('.hub-entry__group'); const long = g?.querySelector('.hub-entry__long'); return (long || g)?.textContent?.replace(/\s+/g, ' ').trim() ?? null; })(),
      longShown: (() => { const l = ext?.closest('.hub-entry-wrap')?.querySelector('.hub-entry__long'); return l ? getComputedStyle(l).display !== 'none' : null; })(),
      extBorder: ext ? getComputedStyle(ext).borderTopColor : null,
      coopBorder: coop ? getComputedStyle(coop).borderTopColor : null,
      extEn: ext ? getComputedStyle(ext.querySelector('.hub-entry__en')).color : null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inView: cards.every((c) => { const b = rect(c); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }),
    };
  });
  console.log(`[${tag}] hub:`, JSON.stringify(hub));
  await page.screenshot({ path: `${OUT}/extension-hall-lobby-${tag}.png` });

  // 拓展模式 → 选择拓展玩法（真点击：卡片会拿到焦点，Esc 之后才谈得上「焦点回到第三张卡」）
  await page.click('.mode-card[data-mode="ext"]');
  await page.waitForSelector('.modal__box.ext', { visible: true, timeout: 10000 });
  await wait(900);
  const hall = await page.evaluate(() => {
    const box = document.querySelector('.modal__box.ext');
    const rect = (el) => el.getBoundingClientRect();
    const rows = [...box.querySelectorAll('.ext-row')];
    const stage = box.querySelector('.ext-stage');
    const list = box.querySelector('.ext-list');
    const start = box.querySelector('.ext-foot__start');
    const note = box.querySelector('[data-testid="extension-note"]');
    const heights = rows.map((el) => Math.round(rect(el).height));
    const gaps = rows.slice(1).map((el, i) => Math.round(rect(el).top - rect(rows[i]).bottom));
    return {
      title: box.querySelector('.modal__title')?.textContent,
      rows: rows.map((el) => el.dataset.ext),
      statuses: rows.map((el) => el.dataset.status),
      chips: rows.map((el) => el.querySelector('.chip')?.textContent),
      heights, gaps,
      stage: Math.round(rect(stage).width), list: Math.round(rect(list).width),
      // 选中玩法包后的按钮是「进入」（下一步是主题大厅），不是「开始」——单人/同盟与蚀流已经搬进主题大厅
      enter: { text: start?.textContent.trim(), disabled: start?.disabled === true, testid: start?.dataset.testid },
      note: note?.textContent?.trim() ?? null,
      hook: box.querySelector('.ext__body')?.dataset.extension,
      code: box.querySelector('.ext-hero__code')?.textContent,
      selected: box.querySelector('.ext-row.is-selected')?.dataset.ext,
      locked: rows.filter((el) => el.disabled).length,
      dashes: rows.filter((el) => getComputedStyle(el).borderTopStyle === 'dashed').length,
      inside: rows.every((el) => { const b = rect(el); const c = rect(box); return b.left >= c.left - 1 && b.right <= c.right + 1 && b.top >= c.top - 1 && b.bottom <= c.bottom + 1; }),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // the note and the 开始 button must both be inside the box (a tall dossier at 特大 used to push them out)
      footIn: (() => { const b = rect(box.querySelector('.ext-foot')); const c = rect(box); return b.bottom <= c.bottom + 1 && b.top >= c.top - 1; })(),
      leadIn: (() => { const b = rect(box.querySelector('.ext-pane__lead')); const c = rect(box); return b.top >= c.top - 1 && b.bottom <= c.bottom + 1; })(),
    };
  });
  console.log(`[${tag}] hall:`, JSON.stringify(hall));
  await page.screenshot({ path: `${OUT}/extension-hall-${tag}.png` });

  // 进入 → 主题大厅（业主 2026-10-28）：原包主视觉（不息恶火）+ 封面排版，单人/同盟与蚀流、开始都在这一屏
  await page.click('[data-testid="extension-enter"]');
  await page.waitForSelector('.ext-theme', { visible: true, timeout: 10000 });
  await wait(650);
  const theme = await page.evaluate(() => {
    const box = document.querySelector('.ext-theme');
    const rect = (el) => el.getBoundingClientRect();
    const art = box.querySelector('.ext-theme__art-img');
    const start = box.querySelector('[data-testid="extension-start"]');
    const img = art && art.complete && art.naturalWidth > 0;
    return {
      art: art ? { src: art.getAttribute('src'), ok: !!img, w: Math.round(rect(art).width), h: Math.round(rect(art).height) } : null,
      kicker: box.querySelector('.ext-theme__kicker')?.textContent?.trim() ?? null,
      name: box.querySelector('.ext-theme__name')?.textContent?.trim() ?? null,
      meta: box.querySelector('.ext-theme__meta')?.textContent?.trim() ?? null,
      tiers: [...box.querySelectorAll('.ext-tier')].map((el) => el.dataset.tier),
      tiersOn: box.querySelector('.ext-tier.is-on')?.dataset.tier ?? null,
      party: [...box.querySelectorAll('.ext-party__chip')].map((el) => ({ id: el.dataset.party, on: el.classList.contains('is-on'), pressed: el.getAttribute('aria-pressed') })),
      start: { text: start?.textContent.trim(), disabled: start?.disabled === true },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      footIn: (() => { const f = rect(box.querySelector('.ext-theme__foot')); const c = rect(box); return f.bottom <= c.bottom + 1 && f.top >= c.top - 1; })(),
    };
  });
  console.log(`[${tag}] theme:`, JSON.stringify(theme));
  await page.screenshot({ path: `${OUT}/extension-theme-${tag}.png` });
  // ‹ 回到列表：后面的 Esc 用例仍然从列表开始
  await page.click('[data-testid="extension-theme-back"]');
  await page.waitForSelector('.ext-list', { visible: true, timeout: 10000 });
  await wait(400);

  // Esc 关闭 → 焦点回到第三张卡
  await page.keyboard.press('Escape');
  await wait(400);
  const back = await page.evaluate(() => ({
    closed: !document.querySelector('.modal__box.ext'),
    focus: document.activeElement?.dataset?.mode ?? document.activeElement?.className ?? null,
  }));
  console.log(`[${tag}] closed:`, JSON.stringify(back));

  // 开始 → 房：点真的开始键，看 room.create 建出的是不是湮灭房（SP_PARTY=coop 验同盟形态 → mode_multi_annihilation）
  let room = null;
  if (process.env.SP_SKIP_ROOM !== '1') {
    await page.click('.mode-card[data-mode="ext"]');
    await page.waitForSelector('.modal__box.ext', { visible: true, timeout: 10000 });
    await wait(700);
    await page.click('[data-testid="extension-enter"]');
    await page.waitForSelector('.ext-theme', { visible: true, timeout: 10000 });
    await wait(500);
    if (PARTY === 'coop') { await page.click('.ext-party__chip[data-party="coop"]'); await wait(400); }
    await page.click('.ext-tier[data-tier="6"]');  // 顺带选一个非缺省档位：它必须落进 room.create.erosion
    await wait(300);
    await page.click('[data-testid="extension-start"]');
    await page.waitForSelector('.rs-pill', { visible: true, timeout: 25000 });
    await wait(900);
    room = await page.evaluate(() => {
      const r = globalThis.__SP__?.store.get().room;
      const chips = [...document.querySelectorAll('.rs-erosion__chip')];
      return {
        mode: r?.mode, difficulty: r?.difficulty, erosion: r?.erosion,
        pill: document.querySelector('.rs-pill__diff')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        chips: chips.length, on: chips.find((c) => c.classList.contains('is-on'))?.dataset.tier ?? null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    console.log(`[${tag}] room:`, JSON.stringify(room));
    await page.screenshot({ path: `${OUT}/extension-hall-room-${PARTY}-${tag}.png` });
    // 离开房间：同一个浏览器的几档视口共用 localStorage，房主留在房里会把下一页直接带进房间
    await page.evaluate(async () => { const m = await import('/js/net.js'); return m.net.request('room.leave', {}).catch(() => null); });
    try { await page.waitForSelector('.mode-card', { visible: true, timeout: 15000 }); } catch { /* the next viewport reports it */ }
    await wait(600);
  }

  const want = ladder([vw, vh]);
  const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
  console.log(`[${tag}] ladder:`, JSON.stringify(want), 'tiersOk:', LADDER_TIERS);
  console.log(`[${tag}] errors:`, own.length, own.slice(0, 3));

  const ok = okLobby
    && LADDER_TIERS
    && JSON.stringify(hub.cards) === JSON.stringify(['solo', 'coop', 'ext'])
    && new Set(hub.tops).size === 1 && new Set(hub.bottoms).size === 1
    && hub.inView && hub.overflowX <= 0
    && /个玩法/.test(hub.line || '') && !/^0 /.test(hub.line || '')
    && hub.extBorder !== hub.coopBorder
    && hall.title === '选择拓展玩法'
    // only two play sets remain — annihilation + zhajing; the endless-fire / deep-dive placeholders were removed 2026-10-29
    && JSON.stringify(hall.rows) === JSON.stringify(['annihilation', 'zhajing'])
    // both entries are status: 'ready' in EXTENSION_MODES — the shipped catalogue has no placeholder left
    && JSON.stringify(hall.statuses) === JSON.stringify(['ready', 'ready'])
    // …so both chips read STATUS.ready.text (「可开局」); 「筹备中」 is only reachable from a test's synthetic table now
    && JSON.stringify(hall.chips) === JSON.stringify(['可开局', '可开局'])
    && new Set(hall.heights).size === 1 && hall.heights[0] === want.row
    && hall.gaps.every((g) => g >= want.gap)
    && Math.abs(hall.stage / (hall.stage + hall.list) - 0.4) < 0.03
    && hall.enter.disabled === false && hall.enter.text === '进入' && hall.enter.testid === 'extension-enter'
    && /玩法包已就位/.test(hall.note || '')
    && theme.name === '湮灭模拟' && /ANNIHILATION/.test(theme.kicker || '') && /AC-5/.test(theme.meta || '')
    && !!theme.art && theme.art.ok && theme.art.w > 0 && theme.art.h > 0     // 原包主视觉真的被加载出来
    && JSON.stringify(theme.tiers) === JSON.stringify(['1','2','3','4','5','6']) && theme.tiersOn === '1'
    && JSON.stringify(theme.party.map((p) => p.id)) === JSON.stringify(['solo', 'coop'])
    && theme.party[0].on && !theme.party[1].on && theme.party[0].pressed === 'true'
    && theme.start.disabled === false && theme.start.text === '开始 湮灭模拟'
    && theme.footIn && theme.overflowX <= 0
    && hall.hook === 'annihilation' && hall.code === 'AC-5' && hall.selected === 'annihilation'
    // 0 is the expectation, not "don't care": with no placeholder row left nothing is disabled and no row draws the
    // dashed「筹备中」border — a placeholder reappearing without a catalogue entry behind it fails right here
    && hall.locked === 0 && hall.dashes === 0
    && hall.inside && hall.footIn && hall.leadIn && hall.overflowX <= 0
    && back.closed && back.focus === 'ext'
    && (process.env.SP_SKIP_ROOM === '1' || (room && room.mode === PARTY && room.difficulty === 'ANNIHILATION'
      && room.erosion === 6 && room.on === '6' && room.chips === 6 && room.overflowX <= 0))
    && own.length === 0;
  console.log(`[${tag}] RESULT:`, ok ? 'OK' : 'CHECK ABOVE');
  if (!ok) allOk = false;
  await page.close();
}

await browser.close();
console.log('\nRESULT:', allOk ? `OK — ${VIEWPORTS.map(([w, h]) => `${w}×${h}`).join(' / ')}：三卡同排、大厅版式、可开局状态、单人/同盟与蚀流、开始→${PARTY} 房都对` : 'CHECK ABOVE');
process.exit(allOk ? 0 : 1);
