// docs/mockups/render-mockups.mjs — 「匹配 & 私密房间」增量方案实景图渲染
//
// 真实服务器 + 真实前端（真实登录→大厅→弹窗流程）；仅对提案中「尚未实现的新 UI」注入 DOM：
//   1. 大厅创建框上方的 公开/私密 二段开关（复用设置面板 .set-seg 样式）
//   2. 匹配弹窗的「快速匹配」按钮（复用 .btn--primary/.btn--lg）
//   3. 管理后台房间表的 🔒 私密 徽标（mock API 响应，走真实 renderRooms 渲染路径）
//
// 用法：node docs/mockups/render-mockups.mjs      （Windows 自动探测 Chrome；或设置 CHROME_PATH）
// 产物：mock-1-lobby-private-room.png / mock-2-lobby-private-room-phone.png
//       mock-3-matchmaking-modal.png / mock-4-admin-private-rooms.png
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.CHROME_PATH) {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  const hit = candidates.find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}

const { startRealServer, Client, sleep, CHROME } = await import('../../test/e2e/client.mjs');
const puppeteer = (await import('puppeteer-core')).default;
if (!existsSync(CHROME)) {
  console.error('未找到 Chrome：请设置 CHROME_PATH 环境变量');
  process.exit(1);
}

const out = (name) => path.join(HERE, name);
const shot = (page, name) => page.screenshot({ path: out(name) });

/** 诊断：注入元素是否真的可见且落在视口内（本脚本的自动化自检，避免图拍空） */
const rectOf = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    inViewport: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    text: (el.textContent || '').trim().slice(0, 40),
  };
}, sel);

// ---- 提案 UI 注入（自包含函数，序列化进页面执行） ------------------------------------------------

/** 提案 1：大厅创建框上方的 公开/私密 二段开关（复用设置面板 .set-seg） */
const injectPrivateToggle = () => {
  const box = document.querySelector('.create-box');
  if (!box || document.getElementById('mock-privseg')) return;
  const seg = document.createElement('div');
  seg.id = 'mock-privseg';
  seg.className = 'set-seg';
  seg.style.cssText = 'display:flex;width:100%;margin-bottom:.02rem;';
  seg.innerHTML =
    '<button type="button" style="flex:1">公开同盟</button>'
    + '<button type="button" class="is-on" style="flex:1">🔒 私密同盟</button>';
  box.insertBefore(seg, box.firstChild);
  const hint = box.querySelector('.create-box__hint');
  if (hint) hint.textContent = '私密同盟不出现在公开列表：凭密钥或邀请链接加入';
};

/** 提案 2：匹配弹窗统计条下方的「快速匹配」按钮（接线已存在的 queueMatch） */
const injectQuickMatch = () => {
  const body = document.querySelector('.mm-modal__body');
  if (!body || document.getElementById('mock-quickmatch')) return;
  const bar = document.querySelector('.mm-stats-bar');
  const wrap = document.createElement('div');
  wrap.id = 'mock-quickmatch';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:.06rem;margin:.14rem 0 .1rem;';
  wrap.innerHTML =
    '<button type="button" class="btn btn--primary btn--lg btn--block"><span class="btn__label">⚡ 快速匹配 · 系统自动凑齐同盟</span></button>'
    + '<div style="text-align:center;font-size:.13rem;color:var(--text-dim);">按当前模拟方式/难度入队；10 秒内凑不齐由 AI 队友补齐出发</div>';
  if (bar) body.insertBefore(wrap, bar.nextSibling);
  else body.insertBefore(wrap, body.firstChild);
};

/** 让匹配弹窗显示样例公开房间（私密房不会出现在这里——这正是被演示的语义） */
const seedModalRooms = (rooms) => {
  const net = globalThis.__SP__.net;
  const orig = net.request.bind(net);
  const payload = { ok: true, t: 'room.list', online: 21, roomsCount: rooms.length, matchesCount: 1, rooms };
  net.request = (t, ...args) => (t === 'room.list' ? Promise.resolve(payload) : orig(t, ...args));
  const s = globalThis.__SP__.store.get();
  globalThis.__SP__.store.set({ lobbyStats: { ...s.lobbyStats, online: 21, roomsCount: rooms.length, matchesCount: 1, rooms } });
};

const modalRooms = [
  { code: 'X7K2QM', name: '凯尔希', difficulty: 'HARD', humans: 4, maxSeats: 10, inMatch: true },
  { code: 'P3ND8A', name: '阿米娅', difficulty: 'NORMAL', humans: 3, maxSeats: 10, inMatch: false },
  { code: 'M4TY7X', name: 'W', difficulty: 'FUNNY', humans: 2, maxSeats: 10, inMatch: false },
];

// ---- 管理后台 mock 数据（走真实 renderOverview/renderRooms 渲染路径） ------------------------------

const adminOverview = {
  version: { app: '0.2.1-fusion', build: 'a1b2c3d' },
  isDraining: false,
  drainElapsedSec: 0,
  uptime: 6 * 3600 + 42 * 60 + 13,
  network: { sockets: 21, sessions: 24, roomsCount: 4, matchesCount: 2, clients: { androidFull: 3, webFull: 7, webCore: 5, webStream: 6 } },
  system: { cpuPercent: 23.4, loadAvg: [0.42, 0.38, 0.35], processRssMb: 612.4, heapUsedMb: 384.1, heapTotalMb: 512 },
};

const adminRooms = [
  {
    code: 'X7K2QM', mode: 'coop', difficulty: 'HARD', inMatch: true, private: false,
    seats: [
      { name: '凯尔希', isBot: false, client: { bundle: 'web_full' } },
      { name: '阿米娅', isBot: false, client: { bundle: 'android_full' } },
      { name: '博士-凌', isBot: false, client: { bundle: 'web_core' } },
      { name: '博士-澈', isBot: false, client: { bundle: 'web_stream' } },
    ],
    match: { phase: 'COMBAT', round: 12, alivePlayers: [
      { name: '凯尔希', alive: true, lp: 9 }, { name: '阿米娅', alive: true, lp: 6 },
      { name: '博士-凌', alive: false, lp: 0 }, { name: '博士-澈', alive: true, lp: 4 },
    ] },
  },
  {
    code: 'P3ND8A', mode: 'coop', difficulty: 'NORMAL', inMatch: false, private: false,
    seats: [
      { name: '博士-泉', isBot: false, client: { bundle: 'web_stream' } },
      { name: '博士-柚', isBot: false, client: { bundle: 'web_stream' } },
      { name: 'AI-1', isBot: true }, { name: 'AI-2', isBot: true },
    ],
    match: null,
  },
  {
    code: 'Q9WER2', mode: 'coop', difficulty: 'FUNNY', inMatch: false, private: true,
    seats: [
      { name: '博士-岑', isBot: false, client: { bundle: 'web_full' } },
      { name: '博士-岚', isBot: false, client: { bundle: 'web_core' } },
    ],
    match: null,
  },
  {
    code: 'M4TY7X', mode: 'coop', difficulty: 'HARD', inMatch: true, private: true,
    seats: [
      { name: '博士-岚', isBot: false, client: { bundle: 'web_full' } },
      { name: '博士-岑', isBot: false, client: { bundle: 'android_full' } },
      { name: '博士-翎', isBot: false, client: { bundle: 'web_stream' } },
      { name: 'AI-1', isBot: true },
    ],
    match: { phase: 'PREP', round: 3, alivePlayers: [
      { name: '博士-岚', alive: true, lp: 8 }, { name: '博士-岑', alive: true, lp: 8 },
      { name: '博士-翎', alive: true, lp: 7 },
    ] },
  },
];

const PRIVATE_CODES = ['Q9WER2', 'M4TY7X'];

/** 提案 3：房间号列后置 🔒 私密 徽标 + 段落标题「私密 N」计数（正式实现时进 admin.css/admin.js） */
const decorateAdmin = (privateCodes) => {
  const st = document.createElement('style');
  st.textContent = '.adm-badge--purple{background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.4);}';
  document.head.appendChild(st);
  const tbody = document.getElementById('rooms-tbody');
  if (tbody) {
    for (const tr of tbody.rows) {
      const td = tr.cells[0];
      if (!td) continue;
      const code = (td.textContent || '').trim();
      if (!privateCodes.includes(code)) continue;
      td.insertAdjacentHTML('afterbegin', '<span class="adm-badge adm-badge--purple" title="私密同盟：不出现在公开列表，仅凭密钥/邀请链接加入">🔒 私密</span> ');
    }
  }
  const h = document.querySelector('.adm-section__head h2');
  if (h && !h.querySelector('.mock-priv-count')) {
    h.insertAdjacentHTML('beforeend', ` <span class="adm-badge adm-badge--purple mock-priv-count">私密 ${privateCodes.length}</span>`);
  }
};

// ---- 主流程 -------------------------------------------------------------------------------------

const srv = await startRealServer();
const done = [];
const checks = [];
try {
  // ---- 图 1/2/3：真实前端 ----
  const c = new Client(puppeteer, srv.base, 'mockup', { w: 1920, h: 1080 });
  await c.open('/');
  await c.enter('示例博士');
  await c.page.waitForSelector('.btn-create-alliance', { timeout: 20000 });
  await sleep(1200);

  await c.page.evaluate(injectPrivateToggle);
  await sleep(250);
  checks.push(['mock-1 私密开关', await rectOf(c.page, '#mock-privseg')]);
  await shot(c.page, 'mock-1-lobby-private-room.png');
  done.push('mock-1');

  await c.page.evaluate(seedModalRooms, modalRooms);
  await c.click('.btn-matchmaking-open');
  await c.page.waitForSelector('.mm-modal__body', { timeout: 8000 });
  await sleep(350);
  await c.page.evaluate(injectQuickMatch);
  await sleep(250);
  checks.push(['mock-3 快速匹配按钮', await rectOf(c.page, '#mock-quickmatch .btn')]);
  checks.push(['mock-3 房间列表', await rectOf(c.page, '.mm-room-list')]);
  await shot(c.page, 'mock-3-matchmaking-modal.png');
  done.push('mock-3');
  await c.click('.mm-modal__close', null, { optional: true });
  await sleep(300);

  // 手机横屏（844×390，hasTouch 触发 coarse 指针样式）：滚到创建框看开关落位
  await c.page.setViewport({ width: 844, height: 390, hasTouch: true });
  await sleep(700);
  await c.page.evaluate(() => { const b = document.querySelector('.lobby-body'); if (b) b.scrollTop = b.scrollHeight; });
  await sleep(300);
  // Preact 会因大厅广播重渲染并冲掉手工注入的节点（4s 一次）——截图前重新注入
  await c.page.evaluate(injectPrivateToggle);
  await sleep(120);
  checks.push(['mock-2 私密开关(手机)', await rectOf(c.page, '#mock-privseg')]);
  checks.push(['mock-2 创建按钮(手机)', await rectOf(c.page, '.btn-create-alliance')]);
  await shot(c.page, 'mock-2-lobby-private-room-phone.png');
  done.push('mock-2');
  await c.close();

  // ---- 图 4：管理后台（独立页面；mock API 响应 + 冻结轮询，走真实渲染路径） ----
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--force-device-scale-factor=1'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sp_admin_token', 'mockup'); } catch { /* ignore */ } });
    await page.setRequestInterception(true);
    let adminFetches = 0;
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/admin/')) {
        adminFetches += 1;
        // 首轮三请求（overview/rooms/logs）后不再响应：冻结 2s 轮询，保住注入的徽标
        if (adminFetches > 3) return;
        if (u.includes('/api/admin/overview')) return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(adminOverview) });
        if (u.includes('/api/admin/rooms')) return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(adminRooms) });
        if (u.includes('/api/admin/logs')) return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ logs: [] }) });
        return void req.respond({ status: 200, contentType: 'application/json', body: '{}' });
      }
      req.continue();
    });
    await page.goto(`${srv.base}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#rooms-tbody tr').length >= 4, { timeout: 20000 });
    await sleep(250);
    await page.evaluate(decorateAdmin, PRIVATE_CODES);
    await sleep(150);
    checks.push(['mock-4 私密徽标数', await page.evaluate(() => document.querySelectorAll('#rooms-tbody .adm-badge--purple').length)]);
    checks.push(['mock-4 表头计数', await page.evaluate(() => (document.querySelector('.mock-priv-count') || {}).textContent || null)]);
    await page.screenshot({ path: out('mock-4-admin-private-rooms.png'), fullPage: true });
    done.push('mock-4');
  } finally {
    await browser.close();
  }
} finally {
  await srv.stop();
}

// ---- 自检报告 -----------------------------------------------------------------------------------
const pngSize = (name) => {
  const buf = readFileSync(out(name));
  return { kb: Math.round(buf.length / 1024), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
console.log('\n== 自检 ==');
for (const [label, info] of checks) console.log(` ${label}: ${JSON.stringify(info)}`);
for (const n of done) {
  const s = pngSize(`${n === 'mock-1' ? 'mock-1-lobby-private-room' : n === 'mock-2' ? 'mock-2-lobby-private-room-phone' : n === 'mock-3' ? 'mock-3-matchmaking-modal' : 'mock-4-admin-private-rooms'}.png`);
  console.log(` ${n}.png: ${s.w}x${s.h}, ${s.kb} KB`);
}
console.log('实景图已生成:', done.map((n) => `${n}.png`).join(', '));
