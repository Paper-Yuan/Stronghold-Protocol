// docs/mockups/render-mod-loader.mjs — 「内置内容包 + 房主选择」增量方案实景图渲染
//
// 真实服务器 + 真实前端（真实登录→大厅→房间流程），仅对提案中「尚未实现的新 UI」注入 DOM，
// 复用的是游戏自己的类名与 CSS 变量（.panel / .set-seg / .btn / .adm-* / --text-hi / --mint-500 …），
// 所以图里的间距、配色、字重就是实现后的样子——唯一不是真的东西是「这段代码还没写」。
//
//   1. 大厅：创建框的「公开/私密」二段开关（沿用 docs/mockups/render-mockups.mjs 的提案）
//      ＋ 创建框正下方的「内容包」**默认收起的二级菜单**（mod 加载位，与房间内同一种交互）
//                                                                  → mod-1(收起) / mod-7(展开) / mod-2、mod-8(安卓横屏 收/展)
//   2. 匹配弹窗房间卡上的内容包徽标（加入前可见）                    → mod-3
//   3. 管理后台新增的「内容包池」区块（运营端池子 + 拒绝原因）       → mod-4
//   4. 设置面板里的只读「本版本内置内容包」行                        → mod-5
//   5. **房间内**：房间条上的内容包清单 + 房主的「内容包」选择器      → mod-6
//
// 用法：node docs/mockups/render-mod-loader.mjs   （Windows 自动探测 Chrome；或设置 CHROME_PATH）
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

/** 诊断：注入元素是否真的可见且落在视口内（避免图拍空） */
const rectOf = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
    display: cs.display, visibility: cs.visibility,
    inViewport: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    text: (el.textContent || '').trim().slice(0, 48),
  };
}, sel);

// ---- 共享样式（全部走游戏自己的 CSS 变量） --------------------------------------------------------

const PACK_CSS = `
.mock-packs__head{display:flex;align-items:center;gap:.07rem;margin-bottom:.08rem}
.mock-packs__head b{font-size:.16rem;font-weight:600;color:var(--text-hi)}
.mock-packs__head small{font-size:.1rem;letter-spacing:.14em;color:var(--text-dim)}
.mock-packs__lock{margin-left:auto;font-size:.11rem;color:var(--mint-500)}
.mock-pack{display:flex;align-items:center;gap:.08rem;padding:.06rem .08rem;font-size:.13rem;color:var(--text-hi);border-top:.01rem solid var(--line)}
.mock-pack:first-of-type{border-top:0}
.mock-pack__box{flex:none;width:.15rem;height:.15rem;border:.01rem solid var(--line-3);border-radius:.03rem;display:grid;place-items:center;font-size:.1rem;color:var(--text-on-mint)}
.mock-pack__box.on{background:var(--mint-500);border-color:var(--mint-500)}
.mock-pack__tag{font-size:.1rem;color:var(--text-dim);border:.01rem solid var(--line-2);border-radius:.03rem;padding:0 .04rem}
.mock-pack__ver{margin-left:auto;font-family:var(--font-mono);font-size:.11rem;color:var(--text-dim)}
.mock-packs__note{margin-top:.07rem;font-size:.11rem;color:var(--text-dim)}
.mock-badge-pack{display:inline-flex;align-items:center;gap:.03rem;font-size:.1rem;color:var(--mint-500);
  border:.01rem solid var(--mint-a35);background:var(--mint-a10);border-radius:.03rem;padding:.005rem .05rem;margin-left:.05rem}
.mock-roombar-packs{display:flex;align-items:center;gap:.05rem;margin-left:.14rem}
.mock-picker{position:absolute;bottom:calc(100% + .08rem);right:0;width:4.4rem;z-index:60;
  background:var(--bg-2);border:.01rem solid var(--line-2);border-radius:.06rem;box-shadow:0 .06rem .24rem rgba(0,0,0,.5);padding:.1rem}
.mock-picker__head{display:flex;align-items:center;margin-bottom:.04rem;font-size:.14rem;font-weight:600;color:var(--text-hi)}
.mock-picker__head small{margin-left:.06rem;font-size:.1rem;letter-spacing:.14em;color:var(--text-dim)}
.mock-picker__foot{margin-top:.08rem;display:flex;gap:.06rem;justify-content:flex-end}
.mock-collapse{margin-top:.08rem;border:.01rem solid var(--line-2);border-radius:.06rem;background:var(--bg-2);overflow:hidden}
.mock-collapse__btn{display:flex;align-items:center;gap:.07rem;width:100%;padding:.07rem .1rem;background:transparent;border:0;cursor:pointer;color:var(--text-hi);font:inherit;text-align:left}
.mock-collapse__title{font-size:.14rem;font-weight:600}
.mock-collapse__title small{margin-left:.06rem;font-size:.1rem;letter-spacing:.14em;color:var(--text-dim)}
.mock-collapse__sum{margin-left:auto;font-size:.11rem;color:var(--mint-500)}
.mock-collapse__chev{font-size:.12rem;color:var(--text-dim)}
.mock-collapse__body{padding:.02rem .1rem .08rem;border-top:.01rem solid var(--line)}
`;

// 内容包 = 带来新内容（干员/敌人/道具/波次…）的包；**皮肤/立绘不是内容包**——那是游戏内功能
// （ui/skinPicker.js + 皮肤商店）。只有当一个包**新增了干员**时，它才自带这些干员的立绘（kind 里的「立绘」）。
const PACKS = [
  { name: '边境 · 新干员包', kind: '数据+kit+立绘', ver: 'v1.2.0', on: true },
  { name: '终末地 · 联动', kind: '数据+kit+立绘', ver: 'v0.4.1', on: true },
  { name: '高难 · 词条强化', kind: '数据', ver: 'v2.0.0', on: false },
];

// ---- 提案 0：创建框的「公开/私密」二段开关（沿用 render-mockups.mjs 的既有提案） -------------------

const injectPrivateToggle = () => {
  const box = document.querySelector('.create-box');
  if (!box || document.getElementById('mock-privseg')) return;
  const seg = document.createElement('div');
  seg.id = 'mock-privseg';
  seg.className = 'set-seg';
  seg.style.cssText = 'display:flex;width:100%;margin-bottom:.02rem;';
  seg.innerHTML = '<button type="button" style="flex:1">公开同盟</button>'
    + '<button type="button" class="is-on" style="flex:1">🔒 私密同盟</button>';
  box.insertBefore(seg, box.firstChild);
  const hint = box.querySelector('.create-box__hint');
  if (hint) hint.textContent = '私密同盟不出现在公开列表：凭密钥或邀请链接加入';
};

// ---- 提案 1：大厅的「内容包」默认收起的二级菜单（mod 加载位的新位置） ----------------------------

const injectPackRow = (arg) => {
  if (!document.getElementById('mock-mod-css')) {
    const st = document.createElement('style');
    st.id = 'mock-mod-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  const box = document.querySelector('.create-box');
  if (!box) return;
  let row = document.getElementById('mock-packrow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'mock-packrow';
    row.className = 'mock-collapse';
    box.insertAdjacentElement('afterend', row);
  }
  const on = arg.packs.filter((p) => p.on);
  row.innerHTML = '<button type="button" class="mock-collapse__btn">'
    + '<span class="mock-collapse__title">内容包 <small>CONTENT PACKS</small></span>'
    + `<span class="mock-collapse__sum">🧩 ${on.length} 项启用</span>`
    + `<span class="mock-collapse__chev">${arg.open ? '▴' : '▾'}</span></button>`
    + `<div class="mock-collapse__body"${arg.open ? '' : ' hidden'}>`
    + arg.packs.map((p) => `<div class="mock-pack"><span class="mock-pack__box${p.on ? ' on' : ''}">${p.on ? '✓' : ''}</span>`
      + `<span>${p.name}</span><span class="mock-pack__tag">${p.kind}</span>`
      + `<span class="mock-pack__ver">${p.ver}</span></div>`).join('')
    + '<div class="mock-packs__note">默认收起；未勾选即原版，公开匹配锁原版。皮肤/立绘属游戏内功能，不在此列。</div>'
    + '</div>';
};

// ---- 提案 2：匹配弹窗房间卡上的内容包徽标 --------------------------------------------------------

const seedModalRooms = (rooms) => {
  const net = globalThis.__SP__.net;
  const orig = net.request.bind(net);
  const payload = { ok: true, t: 'room.list', online: 21, roomsCount: rooms.length, matchesCount: 1, rooms };
  net.request = (t, ...args) => (t === 'room.list' ? Promise.resolve(payload) : orig(t, ...args));
  const s = globalThis.__SP__.store.get();
  globalThis.__SP__.store.set({ lobbyStats: { ...s.lobbyStats, online: 21, roomsCount: rooms.length, matchesCount: 1, rooms } });
};

const modalRooms = [
  { code: 'X7K2QM', name: '凯尔希', difficulty: 'HARD', humans: 4, maxSeats: 10, inMatch: true, packs: ['边境 · 新干员包', '终末地 · 联动'] },
  { code: 'P3ND8A', name: '阿米娅', difficulty: 'NORMAL', humans: 3, maxSeats: 10, inMatch: false, packs: ['高难 · 词条强化'] },
  { code: 'M4TY7X', name: 'W', difficulty: 'FUNNY', humans: 2, maxSeats: 10, inMatch: false, packs: [] },
];

const decorateRoomCards = (arg) => {
  if (!document.getElementById('mock-mod-css')) {
    const st = document.createElement('style');
    st.id = 'mock-mod-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  const list = document.querySelector('.mm-room-list');
  if (!list) return;
  for (const card of list.querySelectorAll('.mm-room-card')) {
    if (card.querySelector('.mock-badge-pack')) continue; // 重试时不重复注入
    const code = (card.querySelector('.mm-room-code')?.textContent || '').trim();
    const room = arg.rooms.find((r) => r.code === code);
    if (!room || !room.packs.length) continue;
    const meta = card.querySelector('.mm-room-meta') || card.querySelector('.mm-room-info') || card;
    meta.insertAdjacentHTML('beforeend', `<span class="mock-badge-pack">🧩 内容包 ×${room.packs.length}</span>`);
    meta.insertAdjacentHTML('afterend',
      `<div style="font-size:.1rem;color:var(--text-dim);padding-left:.05rem;">${room.packs.join(' · ')}</div>`);
  }
};

// ---- 提案 3：管理后台的「内容包池」区块 ----------------------------------------------------------

// 皮肤/立绘不是内容包（游戏内功能）；包只在**新增干员**时自带这些干员的立绘（kind 里的 art）
const POOL = [
  { id: 'frontier', name: '边境 · 新干员包', ver: 'v1.2.0', kind: 'data+kits+art', author: '官方', on: true, status: 'ok' },
  { id: 'endfield', name: '终末地 · 联动', ver: 'v0.4.1', kind: 'data+kits+art', author: '官方', on: true, status: 'ok' },
  { id: 'hardcore', name: '高难 · 词条强化', ver: 'v2.0.0', kind: 'data', author: '社区', on: false, status: 'ok' },
  { id: 'redwinter', name: '赤冬 · 测试包', ver: 'v0.0.9', kind: 'data+kits', author: '社区', on: false, status: 'rejected', reason: 'KIT_IMPORT：包内 kit 引入了外部模块，已按 fail-closed 跳过' },
];

const injectAdminPool = (arg) => {
  if (!document.getElementById('mock-mod-css')) {
    const st = document.createElement('style');
    st.id = 'mock-mod-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  const main = document.getElementById('dashboard');
  const first = main && main.querySelector('.adm-section');
  if (!main || !first || document.getElementById('mock-pool')) return;
  const rows = arg.pool.map((p) => `<tr>
      <td><code>${p.id}</code></td>
      <td>${p.name}</td>
      <td>${p.ver}</td>
      <td><span class="adm-badge adm-badge--cyan">${p.kind}</span></td>
      <td>${p.author}</td>
      <td>${p.on ? '<span class="adm-badge adm-badge--green">已启用</span>' : '<span class="adm-badge">已停用</span>'}</td>
      <td>${p.status === 'ok'
        ? '<span style="color:var(--mint-500)">✓ 校验通过</span>'
        : `<span style="color:#ff8a8a">✕ ${p.reason}</span>`}</td>
    </tr>`).join('');
  const sec = document.createElement('section');
  sec.id = 'mock-pool';
  sec.className = 'adm-section';
  sec.innerHTML = `
    <div class="adm-section__head">
      <h2>内容包池 (<span>${arg.pool.length}</span>)</h2>
      <span class="adm-badge adm-badge--purple">可用 ${arg.pool.filter((p) => p.on).length}</span>
      <span class="adm-badge">被拒 ${arg.pool.filter((p) => p.status !== 'ok').length}</span>
      <span style="margin-left:auto;font-size:12px;opacity:.6">运营端决定池子 · 房主决定本局启用</span>
    </div>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>ID</th><th>名称</th><th>版本</th><th>类型</th><th>作者</th><th>池子状态</th><th>校验</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  first.parentNode.insertBefore(sec, first);
};

// ---- 提案 4：设置面板里的只读「本版本内置内容包」行 ----------------------------------------------

const injectSettingsRow = (arg) => {
  if (!document.getElementById('mock-mod-css')) {
    const st = document.createElement('style');
    st.id = 'mock-mod-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  const list = document.querySelector('.set-list');
  if (!list || document.getElementById('mock-setpacks')) return;
  const hint = list.querySelector('.set-hint');
  const row = document.createElement('div');
  row.id = 'mock-setpacks';
  row.className = 'set-row';
  row.style.cssText = 'display:block;';
  row.innerHTML = '<span class="set-row__label">本版本内置内容包<small style="margin-left:.06rem;font-size:.1rem;letter-spacing:.14em;color:var(--text-dim)">CONTENT PACKS</small></span>'
    + `<div style="margin-top:.06rem;display:flex;flex-wrap:wrap;gap:.05rem;">${arg.pool.filter((p) => p.on).map((p) =>
      `<span class="mock-badge-pack">🧩 ${p.name} <span style="font-family:var(--font-mono)">${p.ver}</span></span>`).join('')}</div>`
    + '<div style="margin-top:.05rem;font-size:.11rem;color:var(--text-dim)">本局启用哪些由房主在房间内决定；此处仅供查看。皮肤/立绘属游戏内功能，不出现在内容包里。</div>';
  if (hint) list.insertBefore(row, hint);
  else list.appendChild(row);
};

// ---- 提案 5：房间内 —— 房间条上的内容包清单 + 房主的选择器 --------------------------------------

const injectRoomPacks = (arg) => {
  if (!document.getElementById('mock-mod-css')) {
    const st = document.createElement('style');
    st.id = 'mock-mod-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  // (a) 房间条左侧：本局内容包（所有人可见）
  const left = document.querySelector('.room-bar__left');
  if (left && !document.getElementById('mock-rbpacks')) {
    const on = arg.packs.filter((p) => p.on);
    const g = document.createElement('div');
    g.id = 'mock-rbpacks';
    g.className = 'mock-roombar-packs';
    g.innerHTML = '<span class="room-bar__label">内容包<span class="micro">CONTENT</span></span>'
      + (on.length
        ? on.map((p) => `<span class="mock-badge-pack">🧩 ${p.name}</span>`).join('')
        : '<span class="t-dim" style="font-size:.11rem">原版</span>');
    left.appendChild(g);
  }
  // (b) 房主操作区：一个「内容包」按钮（默认收起）＋ 展开时的选择器
  const right = document.querySelector('.room-bar__right');
  const actions = document.querySelector('.room-host-actions');
  if (!right || !actions) return;
  if (!document.getElementById('mock-packbtn')) {
    const btn = document.createElement('button');
    btn.id = 'mock-packbtn';
    btn.type = 'button';
    btn.className = 'btn btn--secondary btn--md';
    btn.innerHTML = `<span class="btn__label">🧩 内容包 <span class="mock-collapse__chev">${arg.open ? '▴' : '▾'}</span></span>`;
    actions.appendChild(btn);
  }
  if (!arg.open || document.getElementById('mock-picker')) return;
  right.style.position = 'relative';
  const picker = document.createElement('div');
  picker.id = 'mock-picker';
  picker.className = 'mock-picker';
  picker.innerHTML = '<div class="mock-picker__head">内容包<small>CONTENT PACKS</small>'
    + '<span class="mock-packs__lock" style="margin-left:auto">公开匹配锁原版</span></div>'
    + arg.packs.map((p) => `<div class="mock-pack"><span class="mock-pack__box${p.on ? ' on' : ''}">${p.on ? '✓' : ''}</span>`
      + `<span>${p.name}</span><span class="mock-pack__tag">${p.kind}</span>`
      + `<span class="mock-pack__ver">${p.ver}</span></div>`).join('')
    + '<div class="mock-packs__note">仅房主可改；改动在开局前生效。</div>'
    + '<div class="mock-picker__foot"><button type="button" class="btn btn--ghost btn--sm"><span class="btn__label">取消</span></button>'
    + '<button type="button" class="btn btn--primary btn--sm"><span class="btn__label">应用</span></button></div>';
  right.appendChild(picker);
};

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

// ---- 主流程 -------------------------------------------------------------------------------------

const srv = await startRealServer();
const done = [];
const checks = [];
const CSS = PACK_CSS;
try {
  // ---- 图 1/2/3/6：真实前端 ----
  const c = new Client(puppeteer, srv.base, 'mockup', { w: 1920, h: 1080 });
  await c.open('/');
  await c.enter('示例博士');
  await c.page.waitForSelector('.btn-create-alliance', { timeout: 20000 });
  await sleep(1200);

  // 滚到某元素完整落在视口内（大厅是滚动容器；Preact 重渲染会冲掉注入节点，故滚动后重注入）
  const scrollIntoFrame = async (sel) => {
    for (let i = 0; i < 6; i++) {
      const ok = await c.page.evaluate((sel) => {
        const b = document.querySelector('.lobby-body');
        const el = document.querySelector(sel);
        if (!b || !el) return false;
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= innerHeight) return true;
        b.scrollTop += (r.bottom > innerHeight ? r.bottom - innerHeight + 16 : r.top - 16);
        return false;
      }, sel);
      if (ok) return true;
      await sleep(250);
    }
    return false;
  };
  const injectLobby = async (open) => {
    await c.page.evaluate(injectPrivateToggle);
    await c.page.evaluate(injectPackRow, { css: CSS, packs: PACKS, open });
    await sleep(200);
  };

  // mod-1：创建框（公开/私密）＋ 其下方**默认收起**的「内容包」二级菜单
  await injectLobby(false);
  await scrollIntoFrame('#mock-packrow'); // 二级菜单挂在创建框下方，可能落在视口外
  await injectLobby(false);
  checks.push(['mod-1 公开/私密开关', await rectOf(c.page, '#mock-privseg')]);
  checks.push(['mod-1 内容包二级菜单(收起)', await rectOf(c.page, '#mock-packrow')]);
  checks.push(['mod-1 收起时展开体应隐藏', await c.page.evaluate(() => {
    const b = document.querySelector('#mock-packrow .mock-collapse__body');
    return b ? b.hidden : null;
  })]);
  await shot(c.page, 'mod-1-lobby-packs.png');
  done.push(['mod-1', 'mod-1-lobby-packs.png']);

  // mod-7：同一个二级菜单的展开态
  await injectLobby(true);
  await scrollIntoFrame('#mock-packrow');
  await injectLobby(true);
  checks.push(['mod-7 内容包二级菜单(展开)', await rectOf(c.page, '#mock-packrow')]);
  checks.push(['mod-7 展开体应可见', await c.page.evaluate(() => {
    const b = document.querySelector('#mock-packrow .mock-collapse__body');
    return b ? !b.hidden : null;
  })]);
  await shot(c.page, 'mod-7-lobby-packs-open.png');
  done.push(['mod-7', 'mod-7-lobby-packs-open.png']);

  // 匹配弹窗：房间卡徽标
  await c.page.evaluate(seedModalRooms, modalRooms);
  await c.click('.btn-matchmaking-open');
  await c.page.waitForSelector('.mm-room-list', { timeout: 8000 });
  await sleep(300);
  // 大厅广播每 4s 会重渲染并冲掉注入的节点 —— 重试到徽标真的在为止
  let badgeCount = 0;
  for (let i = 0; i < 4 && badgeCount === 0; i++) {
    await c.page.evaluate(seedModalRooms, modalRooms);
    await sleep(350);
    await c.page.evaluate(decorateRoomCards, { css: CSS, rooms: modalRooms });
    await sleep(150);
    badgeCount = await c.page.evaluate(() => document.querySelectorAll('.mm-room-card .mock-badge-pack').length);
  }
  checks.push(['mod-3 徽标数', badgeCount]);
  await shot(c.page, 'mod-3-room-badge.png');
  done.push(['mod-3', 'mod-3-room-badge.png']);
  await c.click('.mm-modal__close', null, { optional: true });
  await sleep(300);

  // 安卓横屏 844×390：创建框正下方的「内容包」二级菜单（默认收起）
  await c.page.setViewport({ width: 844, height: 390, hasTouch: true });
  await sleep(700);
  await injectLobby(false);
  await c.page.evaluate(() => document.getElementById('mock-packrow')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await injectLobby(false);
  await sleep(150);
  checks.push(['mod-2 公开/私密开关(手机)', await rectOf(c.page, '#mock-privseg')]);
  checks.push(['mod-2 内容包二级菜单(手机,收起)', await rectOf(c.page, '#mock-packrow')]);
  await shot(c.page, 'mod-2-lobby-packs-phone.png');
  done.push(['mod-2', 'mod-2-lobby-packs-phone.png']);

  // mod-8：安卓横屏下同一个二级菜单的展开态（补齐「双端 × 收/展」的最后一格）
  await injectLobby(true);
  await c.page.evaluate(() => document.getElementById('mock-packrow')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await injectLobby(true);
  await sleep(150);
  checks.push(['mod-8 内容包二级菜单(手机,展开)', await rectOf(c.page, '#mock-packrow')]);
  checks.push(['mod-8 展开体应可见', await c.page.evaluate(() => {
    const b = document.querySelector('#mock-packrow .mock-collapse__body');
    return b ? !b.hidden : null;
  })]);
  await shot(c.page, 'mod-8-lobby-packs-phone-open.png');
  done.push(['mod-8', 'mod-8-lobby-packs-phone-open.png']);

  // 房间内：创建同盟 → 房间屏，注入内容包清单 + 房主选择器
  await c.page.setViewport({ width: 1920, height: 1080 });
  await sleep(500);
  await c.click('.btn-create-alliance');
  await c.page.waitForSelector('.room-bar', { timeout: 20000 });
  await sleep(600);
  await c.page.evaluate(injectRoomPacks, { css: CSS, packs: PACKS, open: true });
  await sleep(250);
  checks.push(['mod-6 房间条内容包', await rectOf(c.page, '#mock-rbpacks')]);
  checks.push(['mod-6 房主选择器', await rectOf(c.page, '#mock-picker')]);
  await shot(c.page, 'mod-6-room-packs.png');
  done.push(['mod-6', 'mod-6-room-packs.png']);
  await c.close();

  // ---- 图 5：标题屏设置面板（独立 Client，停在标题屏不开局） ----
  const c2 = new Client(puppeteer, srv.base, 'mockup', { w: 1920, h: 1080 });
  await c2.open('/');
  await c2.page.waitForSelector('.title-settings', { timeout: 20000 });
  await sleep(900);
  await c2.click('.title-settings');
  await c2.page.waitForSelector('.set-list', { timeout: 8000 });
  await sleep(300);
  await c2.page.evaluate(injectSettingsRow, { css: CSS, pool: POOL });
  await sleep(200);
  checks.push(['mod-5 只读内容包行', await rectOf(c2.page, '#mock-setpacks')]);
  await shot(c2.page, 'mod-5-settings-packs.png');
  done.push(['mod-5', 'mod-5-settings-packs.png']);
  await c2.close();

  // ---- 图 4：管理后台（mock API 响应 + 冻结轮询，走真实渲染路径） ----
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
        if (adminFetches > 3) return; // 冻结 2s 轮询，保住注入的区块
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
    await page.evaluate(injectAdminPool, { css: CSS, pool: POOL });
    await sleep(200);
    checks.push(['mod-4 内容包池区块', await rectOf(page, '#mock-pool')]);
    checks.push(['mod-4 池子行数', await page.evaluate(() => document.querySelectorAll('#mock-pool tbody tr').length)]);
    await page.screenshot({ path: out('mod-4-admin-pool.png'), fullPage: true });
    done.push(['mod-4', 'mod-4-admin-pool.png']);
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
for (const [, file] of done) {
  const s = pngSize(file);
  console.log(` ${file}: ${s.w}x${s.h}, ${s.kb} KB`);
}
console.log('实景图已生成:', done.map(([, f]) => f).join(', '));
