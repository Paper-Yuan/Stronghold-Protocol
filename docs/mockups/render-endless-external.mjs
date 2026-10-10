// docs/mockups/render-endless-external.mjs — 「外置 mod · 无尽模式（仅单机）」参考图
//
// 两趟渲染，两种图，别混用（约定见 docs/mockups/README.md）：
//
//   ① 实景图（endless-1 / endless-2）：**真服务器 + 真标题屏**，只把「外置 mod 新增的无尽入口」注入 DOM。
//      入口放在主页（标题屏）的登录框内：模式二段开关 + 四档底难度 + 一行说明。类名走游戏自己的
//      .set-seg / .btn--xl（components.css、game.css），所以间距、配色、字重就是实现后的样子。
//
//   ② 参考图（endless-3 / endless-4）：本分支还没有这套 UI，所以用**游戏自己的样式表 + 真实类名**重建版面。
//      版面与文案取自外部补丁仓 stronghold-endless-patch 的真实源码：
//        overlay/public/js/screens/lobby.js      —— EndlessCard（.diff-card--endless）＋ 05 无尽模式 段
//        overlay/public/js/screens/room.js       —— DifficultyPicker 的「无尽」开关（.dpick__opt--endless）
//        overlay/public/js/ui/hud.js             —— 局内顶栏（.gtop / .roundbox），无尽只改一处：lastRound=0 不判隐秘核心
//        overlay/public/js/screens/result.js     —— 结算文案（模拟结束 / 存活回合 / 历史最高 / 新纪录）
//        overlay/public/js/ui/leaderboard.js     —— 无尽排行榜弹窗（.lb-*，CSS 见下方 LEADERBOARD_CSS，逐字取自补丁）
//
// 用法：node docs/mockups/render-endless-external.mjs   （Windows 自动探测 Chrome；或设置 CHROME_PATH）
// 产物：docs/mockups/endless-1-home-solo.png     主页 · 无尽入口（Web 1920×1080）
//       docs/mockups/endless-2-home-phone.png    主页 · 无尽入口（安卓横屏 844×390 @2x）
//       docs/mockups/endless-3-ingame-ui.png     进入后四联（难度选择 / 局内顶栏 / 结算 / 排行榜）
//       docs/mockups/endless-4-dual-vs-server.png 「只做双端 vs 必须服务端」判定表
//       docs/mockups/endless-overview.png        总览
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUB = path.join(ROOT, 'public');
const furl = (p) => pathToFileURL(p).href;
const pubUrl = (p) => (p ? furl(path.join(PUB, String(p).replace(/^\/+/, ''))) : null);

if (!process.env.CHROME_PATH) {
  const hit = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;
if (!CHROME || !existsSync(CHROME)) { console.error('未找到 Chrome：请设置 CHROME_PATH 环境变量'); process.exit(1); }

const puppeteer = (await import('puppeteer-core')).default;

// ---- 真实样式表 -------------------------------------------------------------------------------------

const CSS_FILES = [
  'public/css/theme.css', 'public/css/components.css', 'public/css/devices.css',
  'public/css/screens/title.css', 'public/css/screens/lobby.css', 'public/css/screens/room.css',
  'public/css/screens/result.css', 'public/css/screens/game.css',
];

// 逐字取自补丁仓 overlay/public/css/leaderboard.css（GPL-3.0-or-later，与上游同血统）。
const LEADERBOARD_CSS = readFileSync(path.join(HERE, 'endless-leaderboard.css'), 'utf8');

// 本参考图自己的排版壳与「无尽入口」样式 —— 全部走游戏令牌，不引入新配色。
const MOCK_CSS = `
.sheet { background: #070a09; color: var(--text-hi); padding: .4rem; display: flex; flex-direction: column; gap: .34rem; font-family: var(--font-ui, system-ui); }
.sheet__title { font-size: .3rem; font-weight: 900; letter-spacing: .06em; }
.sheet__title small { margin-left: .12rem; font-size: .14rem; letter-spacing: .24em; color: var(--text-dim); font-weight: 400; }
.sheet__lede { margin: 0; font-size: .16rem; line-height: 1.8; color: var(--text-lo); max-width: 16rem; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .3rem; align-items: start; }
.cell { display: flex; flex-direction: column; gap: .12rem; }
.cell__cap { font-size: .15rem; color: var(--text-lo); letter-spacing: .06em; }
.cell__cap b { color: var(--mint-400); font-weight: 700; }
.cell__body { position: relative; background: #0a0d0c; border: 1px solid var(--line-2); border-radius: .06rem; overflow: hidden; padding: .22rem; }

/* ---- 无尽入口（主页 / 出击前共用） ---- */
.mock-endless { display: flex; flex-direction: column; gap: .1rem; }
.mock-endless__head { display: flex; align-items: center; gap: .08rem; }
.mock-endless__title { font-size: .17rem; font-weight: 700; color: var(--text-hi); }
.mock-endless__title small { margin-left: .06rem; font-size: .1rem; letter-spacing: .16em; color: var(--text-dim); }
.mock-endless__mod { margin-left: auto; font-size: .1rem; color: var(--mint-500); border: 1px solid var(--mint-a35); background: var(--mint-a10); border-radius: .03rem; padding: .01rem .06rem; white-space: nowrap; }
.mock-endless .set-seg { display: flex; width: 100%; }
.mock-endless .set-seg button { flex: 1; min-width: 0; }
.mock-bases { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .05rem; }
.mock-base { height: .34rem; font-size: .14rem; background: #0a0d0c; border: 1px solid var(--line-2); color: var(--text-lo); cursor: pointer; }
.mock-base.is-on { background: var(--mint-500); border-color: var(--mint-500); color: var(--text-on-mint); font-weight: 700; }
.mock-endless__note { margin: 0; font-size: .11rem; line-height: 1.7; color: var(--text-dim); }
.mock-endless__board { align-self: flex-start; }

/* ---- 局内顶栏：.gtop 是 position:absolute，包一层相对容器即可落位 ---- */
.mock-gtop-stage { position: relative; height: 1.2rem; background: linear-gradient(180deg, #121816, #0a0d0c); border-radius: .04rem; overflow: hidden; }
.mock-gtop-stage .gtop { position: absolute; }
.mock-gtop-stage .gtop__center, .mock-gtop-stage .gtop__right { pointer-events: none; }
.mock-roundtag { margin-left: auto; font-size: .13rem; color: var(--violet, #b79cff); border: 1px solid var(--violet-a35, rgba(124, 92, 255, .35)); background: rgba(124, 92, 255, .1); border-radius: .03rem; padding: 0 .06rem; }

/* ---- 结算：只重建 hero 段（.screen.result 是整屏 flex，不整屏搬） ---- */
.mock-result { display: flex; flex-direction: column; gap: .14rem; padding: .3rem .34rem; background: radial-gradient(120% 120% at 12% 0%, rgba(23, 249, 183, .07), transparent 60%), #0a0d0c; }
.mock-result .result__headline { font-size: .8rem; }
.mock-result__foot { display: flex; gap: .16rem; margin-top: .06rem; }
.mock-result__foot .btn { min-width: 2.6rem; }

/* ---- 判定表（不是游戏 UI，用主题令牌画） ---- */
.mx { border-collapse: collapse; width: 100%; font-size: .15rem; }
.mx th, .mx td { text-align: left; padding: .12rem .14rem; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.6; }
.mx th { font-size: .12rem; letter-spacing: .1em; color: var(--text-dim); text-transform: uppercase; font-weight: 400; }
.mx td:first-child { color: var(--text-hi); white-space: nowrap; }
.mx .ok { color: var(--mint-400); }
.mx .no { color: var(--red-premium); }
.mx .mid { color: var(--amber); }
.mx .num { font-family: var(--font-mono, ui-monospace); }
.mx__note { margin: .16rem 0 0; font-size: .14rem; color: var(--text-lo); line-height: 1.8; }
`;

const fontsCss = readFileSync(path.join(PUB, 'fonts/fonts.css'), 'utf8')
  .replace(/url\('\/fonts\//g, `url('${furl(path.join(PUB, 'fonts'))}/`);

const REAL_CSS = [
  ...CSS_FILES.map((rel) => readFileSync(path.join(ROOT, rel), 'utf8')),
  LEADERBOARD_CSS, MOCK_CSS, fontsCss,
].join('\n');

// ---- 主页注入（实景图用；在页面里执行，参数必须可序列化） ------------------------------------------

const injectEndlessHome = (arg) => {
  if (!document.getElementById('mock-endless-css')) {
    const st = document.createElement('style');
    st.id = 'mock-endless-css';
    st.textContent = arg.css;
    document.head.appendChild(st);
  }
  const box = document.querySelector('.title-login');
  if (!box || document.getElementById('mock-endless')) return false;
  const el = document.createElement('div');
  el.id = 'mock-endless';
  el.className = 'mock-endless';
  el.innerHTML = `
    <div class="mock-endless__head">
      <span class="mock-endless__title">无尽模式<small>ENDLESS</small></span>
      <span class="mock-endless__mod">🧩 外置 mod · 无尽 v1.0</span>
    </div>
    <div class="set-seg" role="radiogroup" aria-label="模式">
      <button type="button" role="radio" aria-checked="false">常规模拟</button>
      <button type="button" role="radio" aria-checked="true" class="is-on">无尽模式</button>
    </div>
    <div class="mock-bases" role="radiogroup" aria-label="无尽模式基础难度">
      <button type="button" class="mock-base">标准</button>
      <button type="button" class="mock-base">险境</button>
      <button type="button" class="mock-base">绝境</button>
      <button type="button" class="mock-base is-on">终极</button>
    </div>
    <p class="mock-endless__note">回合数没有上限，每 14 回合迎战一次敌方领袖；<b>仅单人出击</b>，只有「无尽 · 终极」上榜。</p>`;
  box.insertBefore(el, box.firstChild);
  // 登录按钮随模式改名（mod 的实际行为）
  const go = box.querySelector('.btn--xl');
  if (go) go.textContent = '单人出击';
  return true;
};

// ---- 参考图面板（真实类名；文案取自补丁源码） ------------------------------------------------------

const ENDLESS_BASES = [['标准', 'FUNNY'], ['险境', 'NORMAL'], ['绝境', 'HARD'], ['终极', 'ABYSS']];

const lobbyPanel = () => `
  <div class="section-label"><span class="section-label__idx num">05</span>无尽模式<small class="micro">ENDLESS</small></div>
  <div class="diff-list diff-list--endless">
    <button type="button" class="diff-card diff-card--endless is-selected" style="--d-color:#7c5cff" aria-pressed="true">
      <span class="diff-card__bar" aria-hidden="true"></span>
      <span class="diff-card__head">
        <span class="diff-card__glyph" aria-hidden="true">∞</span>
        <span class="diff-card__name">无尽模式</span>
        <span class="diff-card__code num">ENDLESS-ABYSS</span>
        <span class="diff-card__meta"><span class="num">∞</span> 回合</span>
      </span>
      <span class="diff-card__desc">回合数没有上限，坚持越久越好；每 14 回合迎战一次敌方领袖，其后每 7 回合一次。</span>
      <span class="diff-card__effects">
        <span>回合数没有上限</span><span>第 14 回合第一次敌方领袖</span><span>其后每次领袖战后敌方强度 +1/3</span><span>仅单人出击</span>
      </span>
      <span class="diff-card__check" aria-hidden="true">已选定</span>
    </button>
  </div>
  <div class="endless-board"><button type="button" class="btn btn--secondary btn--md">👑 无尽排行榜</button></div>`;

const pickerPanel = () => `
  <div class="dpick" role="radiogroup" aria-label="无尽模式基础难度">
    ${ENDLESS_BASES.map(([name, key]) => `<button type="button" role="radio" aria-checked="${key === 'ABYSS'}"
        class="dpick__opt${key === 'ABYSS' ? ' is-active' : ''}" title="以${name}模拟为底的无尽模式">${name}</button>`).join('')}
    <button type="button" role="radio" aria-checked="true" class="dpick__opt dpick__opt--endless is-active"
      style="--d-color:#7c5cff" title="无尽模式：回合数没有上限，每 14 回合迎战一次敌方领袖。点亮后上面四档即为它的基础难度；再点一次关闭">∞ 无尽</button>
  </div>
  <p class="mock-endless__note" style="margin-top:.12rem">点亮「无尽」后，上面四档即为本次无尽的基础难度（无尽 · 标准 / 险境 / 绝境 / 终极）。</p>
  <ul class="mock-endless__note" style="margin-top:.1rem">
    <li>回合数：<b class="num">∞</b>（没有末回合，也没有隐秘核心）</li>
    <li>第 <b class="num">14</b> 回合第一次敌方领袖，其后每 <b class="num">7</b> 回合一次</li>
    <li>休整期 / 策略选择 / 机变：一律按「合作盟约」计时（单人也有时限）</li>
  </ul>`;

const hudPanel = () => `
  <div class="mock-gtop-stage">
    <header class="gtop">
      <div class="gtop__left">
        <div class="gtop__meta">
          <span class="diff-tag diff-tag--endless" style="--d-color:#7c5cff">无尽 · 终极</span>
        </div>
      </div>
      <div class="gtop__center brackets">
        <div class="roundbox"><span class="roundbox__label">回合</span><b class="roundbox__num num">23</b></div>
        <span class="mock-roundtag">BOSS 回合 · 第 2 次敌方领袖</span>
      </div>
      <div class="gtop__right">
        <div class="gtop__clock"><span class="countdown num">00:42</span></div>
      </div>
    </header>
  </div>
  <p class="mock-endless__note" style="margin-top:.14rem">局内顶栏几乎不变 —— 补丁只改一处：<b>lastRound = 0</b> 时不再把「回合数超过末回合」误判成隐秘核心（<span class="num">??</span>）。回合数持续增长，Boss 回合照常出。</p>`;

const resultPanel = () => `
  <div class="mock-result">
    <h1 class="result__headline">模拟结束</h1>
    <p class="result__sub">无尽模式 · 防线最终被突破</p>
    <div class="result__rounds">
      <span class="result__rlabel">存活回合</span>
      <b class="result__rnum num">23</b>
    </div>
    <p class="result__time t-lo">历史最高 <b class="num">31</b> 回合<span class="result__newrec">· 新纪录</span></p>
    <p class="result__time t-lo">本难度不计入排行榜 —— 仅「无尽 · 终极」上榜</p>
    <div class="mock-result__foot">
      <button type="button" class="btn btn--secondary btn--lg">👑 查看排行榜</button>
      <button type="button" class="btn btn--primary btn--lg">返回</button>
    </div>
  </div>`;

const boardRows = [
  [1, '纸鸢安好', 41, 3, true, '2026-10-08'],
  [2, 'Ausevay', 38, 2, false, '2026-10-07'],
  [3, '示例博士', 31, 5, true, '2026-10-09'],
  [4, 'XiaMo233M', 29, 1, false, '2026-10-06'],
  [5, '无声的雨', 26, 4, false, '2026-10-05'],
  [6, '夜航星', 24, 2, false, '2026-10-04'],
  [7, '北境的雪', 22, 1, true, '2026-10-03'],
  [8, '半盏灯', 19, 6, false, '2026-10-02'],
];
const boardRow = ([rank, name, rounds, runs, solo, date]) => {
  const tone = rank === 1 ? ' lb-row--gold' : rank === 2 ? ' lb-row--silver' : rank === 3 ? ' lb-row--bronze' : '';
  const self = name === '示例博士';
  return `<div class="lb-row${tone}${self ? ' is-self' : ''}">
    <span class="lb-row__rank num">${rank <= 3 ? '👑' : ''}${rank}</span>
    <span class="lb-row__name" title="${name}">${name}${self ? '<span class="lb-row__you">你</span>' : ''}</span>
    <span class="lb-row__rounds num">${rounds}<i>回合</i></span>
    <span class="lb-row__runs num">${runs}<i>局</i></span>
    <span class="lb-row__flags">${solo ? '<span class="lb-tag" title="单人出击">单人</span>' : ''}</span>
    <span class="lb-row__date num">${date}</span>
  </div>`;
};
const boardPanel = () => `
  <div class="lb">
    <p class="lb__intro">无尽模式没有胜负，成绩就是「坚持过的回合数」。按昵称累计历史最高回合，<b>只有「无尽 · 终极」</b>上榜（四档底难度敌方强度不同，成绩不可比）。</p>
    <div class="lb-me">
      <span class="lb-me__rank"><span class="num">87</span></span>
      <span class="lb-me__name">示例博士<span class="lb-row__you" style="margin-left:.06rem">你</span></span>
      <span class="lb-me__rounds num">31<i>回合</i></span>
    </div>
    <div class="lb__bar"><span class="lb__total">共 <span class="num">1 240</span> 位博士上榜<i class="lb__only">仅显示前 30 名 · 榜外仍显示自己的名次</i></span></div>
    <div class="lb__table">
      <div class="lb-row lb-row--head"><span>排名</span><span>博士</span><span>最高回合</span><span>局数</span><span>模式</span><span>日期</span></div>
      <div class="lb__list">${boardRows.map(boardRow).join('')}</div>
    </div>
  </div>`;

const matrixPanel = () => `
  <table class="mx">
    <thead><tr><th>无尽模式需要什么</th><th>双端（Web / APK 客户端）</th><th>服务器</th></tr></thead>
    <tbody>
      <tr><td>主页 / 出击前 入口与难度选择</td><td class="ok">✓ 纯客户端</td><td>—</td></tr>
      <tr><td>局内顶栏 · 结算 · 排行榜弹窗</td><td class="ok">✓ 纯客户端</td><td>—</td></tr>
      <tr><td>「无尽模式」这个模式本身存在</td><td class="no">✗ 客户端没有模式表</td><td class="no">必须：data/config.json 的 <span class="num">mode_single_endless_*</span> ×4</td></tr>
      <tr><td>回合无上限 / 波次循环</td><td class="no">✗ 回合由服务端推进</td><td class="no">必须：<span class="num">server/match/gamedata.js</span></td></tr>
      <tr><td>Boss 排期 R14 起每 7 回合</td><td class="no">✗</td><td class="no">必须：<span class="num">gamedata.js</span> + <span class="num">Match.bossIdAtRound</span></td></tr>
      <tr><td>怪物 hp/atk 每轮 +1/3</td><td class="no">✗</td><td class="no">必须：<span class="num">gamedata.enemyScale</span></td></tr>
      <tr><td>单人也有时限（按合作盟约计时）</td><td class="no">✗ 只读 <span class="num">untimed</span></td><td class="no">必须：<span class="num">Match.soloUntimed</span></td></tr>
      <tr><td>结算的 endless / 存活回合 / 历史最高</td><td class="mid">△ 只是渲染</td><td class="no">必须：<span class="num">results.js</span> + <span class="num">records.js</span></td></tr>
      <tr><td>无尽排行榜数据</td><td class="mid">△ 只是渲染</td><td class="no">必须：<span class="num">GET /api/endless/leaderboard</span></td></tr>
      <tr><td>模组本体分发（谁是权威）</td><td class="ok">✓ 可只发客户端</td><td class="no">✗ 但没服务端就进不去这一局</td></tr>
    </tbody>
  </table>
  <p class="mx__note">结论：<b>UI 可以只做双端，玩法不能。</b>客户端在这套架构里是渲染层 —— <span class="num">public/js</span> 里对 <span class="num">sim/</span> 的唯一引用是 <span class="num">render/fx.js</span> 取弹道速度；连「单机」也是服务端开的 <span class="num">mode_single_*</span> 房间（<span class="num">server/lobby.js</span>）。所以「不做服务器」= 只剩一个点了不动的入口按钮。</p>`;

// ---- 渲染 -------------------------------------------------------------------------------------------

const TMP = path.join(HERE, '.endless-tmp');
mkdirSync(TMP, { recursive: true });
const out = (name) => path.join(HERE, name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARGS = ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'];
const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS });

const pageHtml = (body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap">
<style>${REAL_CSS}</style><title>endless reference</title></head><body>${body}</body></html>`;

const waitReady = async (page) => {
  await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const rectOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 40) };
}, sel);

const checks = [];
const done = [];

// ============ ① 实景：真标题屏 + 注入无尽入口 ============
{
  const { startRealServer, Client } = await import('../../test/e2e/client.mjs');
  const srv = await startRealServer();
  try {
    const c = new Client(puppeteer, srv.base, 'endless-mock', { w: 1920, h: 1080 });
    await c.open('/');
    await c.page.waitForSelector('.title-login', { timeout: 30000 });
    await sleep(1400); // 标题屏动画（rise-in 600ms 延迟 260ms）

    const injected = await c.page.evaluate(injectEndlessHome, { css: MOCK_CSS });
    await sleep(500);
    checks.push(['主页注入成功', injected]);
    checks.push(['入口块几何', await rectOf(c.page, '#mock-endless')]);
    checks.push(['入口是否落在视口内', await c.page.evaluate(() => {
      const el = document.getElementById('mock-endless');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, bottom: Math.round(r.bottom), vh: innerHeight };
    })]);
    checks.push(['模式开关', await rectOf(c.page, '#mock-endless .set-seg')]);
    checks.push(['四档底难度', await rectOf(c.page, '#mock-endless .mock-bases')]);
    checks.push(['底难度 chip 数', await c.page.evaluate(() => document.querySelectorAll('#mock-endless .mock-base').length)]);
    await c.page.screenshot({ path: out('endless-1-home-solo.png') });
    done.push(['endless-1', 'endless-1-home-solo.png']);

    // 安卓横屏：真触摸特征类，dsf 2
    await c.page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await c.page.evaluate(() => { document.documentElement.className = 'sp-touch sp-coarse sp-no-hover'; });
    await sleep(900);
    await c.page.evaluate(injectEndlessHome, { css: MOCK_CSS });
    await sleep(400);
    checks.push(['手机端入口块几何', await rectOf(c.page, '#mock-endless')]);
    checks.push(['手机端 root rem', await c.page.evaluate(() => getComputedStyle(document.documentElement).fontSize)]);
    await c.page.screenshot({ path: out('endless-2-home-phone.png') });
    done.push(['endless-2', 'endless-2-home-phone.png']);
    await c.close();
  } finally { await srv.stop(); }
}

// ============ ② 参考图：进入后四联 ============
{
  const body = `
  <div class="sheet">
    <div>
      <div class="sheet__title">无尽模式（仅单机）· 进入后的 UI<small>IN-MATCH REFERENCE</small></div>
      <p class="sheet__lede">本分支还没有这套 UI：下面四格用<b>游戏自己的样式表 + 补丁仓的真实类名</b>重建版面，
      所以间距、配色、字重就是实现后的样子 —— 唯一不是真的东西是「这段代码还没写」。文案逐字取自
      stronghold-endless-patch 的 lobby.js / room.js / result.js / leaderboard.js。</p>
    </div>
    <div class="grid2">
      <div class="cell"><div class="cell__cap"><b>①</b> 大厅 · 无尽模式卡片（外置 mod 的实际落位）</div><div class="cell__body">${lobbyPanel()}</div></div>
      <div class="cell"><div class="cell__cap"><b>②</b> 出击前 · 难度选择（「无尽」开关 + 四档底难度）</div><div class="cell__body">${pickerPanel()}</div></div>
      <div class="cell"><div class="cell__cap"><b>③</b> 局内顶栏 · 回合 / Boss 回合 / 倒计时</div><div class="cell__body">${hudPanel()}</div></div>
      <div class="cell"><div class="cell__cap"><b>④</b> 结算 · 模拟结束 / 存活回合 / 历史最高</div><div class="cell__body">${resultPanel()}</div></div>
      <div class="cell" style="grid-column:1 / -1"><div class="cell__cap"><b>⑤</b> 无尽排行榜弹窗（只统计「无尽 · 终极」，只显示前 30 名）</div><div class="cell__body">${boardPanel()}</div></div>
    </div>
  </div>`;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(body), { waitUntil: 'load' });
    await waitReady(page);
    checks.push(['参考图 rem', await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)]);
    checks.push(['无尽卡片', await rectOf(page, '.diff-card--endless')]);
    checks.push(['难度选择器', await rectOf(page, '.dpick')]);
    checks.push(['无尽开关', await rectOf(page, '.dpick__opt--endless')]);
    checks.push(['局内顶栏', await rectOf(page, '.mock-gtop-stage .gtop')]);
    checks.push(['结算 headline', await rectOf(page, '.result__headline')]);
    checks.push(['排行榜行数', await page.evaluate(() => document.querySelectorAll('.lb__list .lb-row').length)]);
    checks.push(['排行榜列数', await page.evaluate(() => {
      const r = document.querySelector('.lb__list .lb-row');
      return r ? getComputedStyle(r).gridTemplateColumns.split(' ').length : null;
    })]);
    // 结构自检：有没有元素塌成 0（本模型读不了图时用几何断言代替目视）
    checks.push(['塌成 0 的元素', await page.evaluate(() => {
      const sel = '.diff-card--endless, .dpick__opt, .lb-row, .result__headline, .roundbox__num, .mock-base, .btn';
      return [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width < 1 || r.height < 1; }).length;
    })]);
    const h = await page.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height);
    await page.screenshot({ path: out('endless-3-ingame-ui.png'), clip: { x: 0, y: 0, width: 1920, height: Math.ceil(h) }, captureBeyondViewport: true });
    done.push(['endless-3', 'endless-3-ingame-ui.png']);
  } finally { await browser.close(); }
}

// ============ ③ 参考图：只做双端 vs 必须服务端 ============
{
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(`<div class="sheet">
      <div>
        <div class="sheet__title">「只做双端、不做服务器」可行吗<small>CLIENT-ONLY CHECK</small></div>
        <p class="sheet__lede">这套架构里客户端是<b>渲染层</b>，不是模拟层。逐项对照如下。</p>
      </div>
      ${matrixPanel()}
    </div>`), { waitUntil: 'load' });
    await waitReady(page);
    checks.push(['判定表行数', await page.evaluate(() => document.querySelectorAll('.mx tbody tr').length)]);
    checks.push(['判定表首行', await rectOf(page, '.mx tbody tr')]);
    const h = await page.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height);
    await page.screenshot({ path: out('endless-4-dual-vs-server.png'), clip: { x: 0, y: 0, width: 1920, height: Math.ceil(h) }, captureBeyondViewport: true });
    done.push(['endless-4', 'endless-4-dual-vs-server.png']);
  } finally { await browser.close(); }
}

// ============ ④ 总览 ============
{
  const shot1 = readFileSync(out('endless-1-home-solo.png'));
  const shot2 = readFileSync(out('endless-2-home-phone.png'));
  const shot3 = readFileSync(out('endless-3-ingame-ui.png'));
  const shot4 = readFileSync(out('endless-4-dual-vs-server.png'));
  const b64 = (b) => b.toString('base64');
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(`<div class="sheet">
      <div>
        <div class="sheet__title">外置 mod · 无尽模式（仅单机）<small>ENDLESS · SOLO-ONLY · OVERVIEW</small></div>
        <p class="sheet__lede">① 主页入口是<b>实景图</b>（真服务器 + 真标题屏，只注入 mod 新增的入口）；②③④ 是<b>参考图</b>（真实样式表 + 真实类名重建）。</p>
      </div>
      <div class="cell"><div class="cell__cap"><b>①</b> 主页 · 无尽入口（Web 1920×1080，实景）</div>
        <img src="data:image/png;base64,${b64(shot1)}" style="width:18.4rem;display:block;border:1px solid var(--line-2)"></div>
      <div class="cell" style="width:8.44rem"><div class="cell__cap"><b>②</b> 主页 · 安卓横屏 844×390 @2x（实景）</div>
        <img src="data:image/png;base64,${b64(shot2)}" style="width:8.44rem;display:block;border:1px solid var(--line-2)"></div>
      <div class="cell"><div class="cell__cap"><b>③</b> 进入后 UI（参考图）</div>
        <img src="data:image/png;base64,${b64(shot3)}" style="width:18.4rem;display:block;border:1px solid var(--line-2)"></div>
      <div class="cell"><div class="cell__cap"><b>④</b> 只做双端 vs 必须服务端（参考图）</div>
        <img src="data:image/png;base64,${b64(shot4)}" style="width:18.4rem;display:block;border:1px solid var(--line-2)"></div>
    </div>`), { waitUntil: 'load' });
    await waitReady(page);
    await page.evaluate(() => Promise.all(Array.from(document.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))));
    await waitReady(page);
    checks.push(['总览图裂图数', await page.evaluate(() => Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).length)]);
    const h = await page.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height);
    await page.screenshot({ path: out('endless-overview.png'), clip: { x: 0, y: 0, width: 1920, height: Math.ceil(h) }, captureBeyondViewport: true });
    done.push(['endless-overview', 'endless-overview.png']);
  } finally { await browser.close(); }
}

// ---- 自检报告 -----------------------------------------------------------------------------------
const pngSize = (name) => { const b = readFileSync(out(name)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: Math.round(b.length / 1024) }; };
console.log('\n== 自检 ==');
for (const [label, info] of checks) console.log(` ${label}: ${JSON.stringify(info)}`);
for (const [, f] of done) { const s = pngSize(f); console.log(` ${f}: ${s.w}x${s.h}, ${s.kb} KB`); }
console.log('\n已生成:', done.map(([, f]) => f).join(', '));
