// docs/mockups/render-mod-overview.mjs — 「内置内容包 + 房主选择」界面总览（一张拼图）
//
// 与 render-mod-loader.mjs 的关系：那张脚本跑真服务器、出 8 张实景图（mod-1..mod-8）；
// 本脚本**不重新渲染界面**，只把已有的实景图拼成一张带编号与图例的总览图，
// 用法同 docs/mockups/README.md 里 fusion-dual-platform.png 之于 fusion-1..4。
//
// 版面令牌仍取自游戏自己的样式表（public/css/theme.css 等 + public/fonts/fonts.css），
// 所以图里的底色 / 描边 / 强调色 / 字体与游戏内一致。
//
// 前提：先跑 `node docs/mockups/render-mod-loader.mjs` 生成 mod-1..mod-8。
// 用法：node docs/mockups/render-mod-overview.mjs   （Windows 自动探测 Chrome；或设置 CHROME_PATH）
// 产物：docs/mockups/mod-overview.png
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng } from '../../tools/crop-board-atlas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUB = path.join(ROOT, 'public');
const furl = (p) => pathToFileURL(p).href;

if (!process.env.CHROME_PATH) {
  const hit = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;
const puppeteer = (await import('puppeteer-core')).default;
if (!CHROME || !existsSync(CHROME)) {
  console.error('未找到 Chrome：请设置 CHROME_PATH 环境变量');
  process.exit(1);
}

// ---- 实景图（必须先由 render-mod-loader.mjs 生成） ---------------------------------------------------

const SHOTS = {
  lobbyClosed: 'mod-1-lobby-packs.png',
  lobbyOpen: 'mod-7-lobby-packs-open.png',
  phoneClosed: 'mod-2-lobby-packs-phone.png',
  phoneOpen: 'mod-8-lobby-packs-phone-open.png',
  badge: 'mod-3-room-badge.png',
  adminPool: 'mod-4-admin-pool.png',
  settings: 'mod-5-settings-packs.png',
  room: 'mod-6-room-packs.png',
};
const missing = Object.values(SHOTS).filter((f) => !existsSync(path.join(HERE, f)));
if (missing.length) {
  console.error(`缺实景图：${missing.join(', ')}\n请先跑：node docs/mockups/render-mod-loader.mjs`);
  process.exit(1);
}
const src = (k) => furl(path.join(HERE, SHOTS[k]));

// ---- 真实样式表 -------------------------------------------------------------------------------------

const css = [
  // 游戏自己的样式表与字体（--font-cjk 以 Noto Sans SC 打头，故一并引入，和 fusion 参考图保持一致）
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">`,
  ...['css/theme.css', 'css/components.css', 'css/devices.css', 'fonts/fonts.css']
    .map((rel) => `<link rel="stylesheet" href="${furl(path.join(PUB, rel))}">`),
].join('\n');

// ---- 总览图自身的版面（只用游戏令牌与字体，px 尺寸便于阅读） ----------------------------------------

const sheetCss = `
body { overflow: visible; height: auto; font-size: 15px; line-height: 1.6; }
.sheet { width: 1920px; padding: 0 40px 40px; background: var(--bg-0); position: relative; }
.sheet::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(70% 40% at 12% 0%, rgba(78,216,175,.07), transparent 60%),
              radial-gradient(50% 30% at 100% 8%, rgba(52,184,216,.05), transparent 60%); }
.sheet > * { position: relative; }
.hd { padding: 34px 34px 28px; margin: 0 -40px 30px; background: linear-gradient(180deg, #0f1312, #0a0d0c);
  border-bottom: 1px solid var(--line); }
.hd h1 { font-size: 30px; font-weight: 900; letter-spacing: .02em; }
.hd h1 small { display: block; margin-top: 10px; font-size: 14px; font-weight: 400; color: var(--text-lo); line-height: 1.75; }
.hd .micro { display: block; margin-bottom: 10px; }
.lede { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.tag { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; font-size: 12.5px; color: var(--text-md);
  background: rgba(255,255,255,.03); border: 1px solid var(--line); }
.tag i { width: 8px; height: 8px; display: block; }
.tag--real i { background: var(--mint-500); } .tag--real { border-color: rgba(78,216,175,.4); }
.tag--plan i { background: var(--gold); } .tag--plan { border-color: rgba(255,198,0,.4); }
.panel { margin-top: 30px; border: 1px solid var(--line); background: var(--bg-1); }
.panel__hd { display: flex; align-items: center; gap: 12px; padding: 13px 18px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.panel__hd h2 { display: flex; align-items: baseline; gap: 10px; font-size: 17px; font-weight: 900; letter-spacing: .04em; }
.panel__hd h2::before { content: ''; align-self: center; width: 5px; height: 20px; background: var(--mint-500); }
.panel__hd .spacer { flex: 1; }
.duo { display: flex; gap: 20px; align-items: flex-start; padding: 18px; }
.col { flex: 1; min-width: 0; }
.col__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13.5px; color: var(--text-md); }
.col__hd b { font-size: 14.5px; color: var(--text-hi); }
.col__hd .micro { margin-left: auto; }
.frame { border: 1px solid var(--line-2); background: var(--bg-0); overflow: hidden; position: relative; line-height: 0; }
.frame img { display: block; width: 100%; height: auto; }
.frame--phone { border-radius: 12px; border-width: 2px; border-color: var(--line-3); max-width: 844px; }
.cap { margin-top: 9px; font-size: 12.5px; color: var(--text-lo); line-height: 1.6; }
.cap b { color: var(--text-md); }
.cap code, .legend code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }
.legend { display: flex; flex-direction: column; gap: 9px; padding: 16px 18px; }
.lg { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 11px; align-items: start; font-size: 13.5px; color: var(--text-md); }
.lg b { display: grid; place-items: center; width: 22px; height: 22px; font-family: var(--font-num); font-size: 12.5px; background: var(--mint-500); color: #06110d;
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%); }
.lg--warn b { background: var(--gold); color: #1a1400; }
.rules { display: flex; gap: 26px; padding: 16px 18px 4px; }
.rules__col { flex: 1; }
.rules__col h4 { margin-bottom: 9px; font-size: 13.5px; }
.rules__col.do h4 { color: var(--mint-400); } .rules__col.dont h4 { color: var(--red-premium); }
.rules__col ul { list-style: none; }
.rules__col li { position: relative; padding-left: 19px; margin-bottom: 7px; font-size: 13px; color: var(--text-md); line-height: 1.65; }
.rules__col li::before { position: absolute; left: 0; top: 0; }
.rules__col.do li::before { content: '✓'; color: var(--mint-400); }
.rules__col.dont li::before { content: '✕'; color: var(--red-premium); }
.foot { display: flex; justify-content: space-between; gap: 20px; margin-top: 28px; font-size: 12.5px; color: var(--text-dim); }
`;

const duo = (a, b) => `<div class="duo">
  <div class="col">
    <div class="col__hd"><b>${a.t}</b><span class="micro">${a.tag}</span></div>
    <div class="frame${a.phone ? ' frame--phone' : ''}"><img src="${src(a.k)}" alt=""></div>
    <p class="cap">${a.cap}</p>
  </div>
  <div class="col">
    <div class="col__hd"><b>${b.t}</b><span class="micro">${b.tag}</span></div>
    <div class="frame${b.phone ? ' frame--phone' : ''}"><img src="${src(b.k)}" alt=""></div>
    <p class="cap">${b.cap}</p>
  </div>
</div>`;

const panel = (n, title, micro, body) => `<section class="panel">
  <header class="panel__hd"><h2>${n} ${title}</h2><span class="spacer"></span><span class="micro">${micro}</span></header>
  ${body}
</section>`;

const SHEET = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>内置内容包界面总览</title>
${css}
<style>${sheetCss}</style></head><body class="sheet-host"><div class="sheet">

<div class="hd">
  <span class="micro micro--mint">CONTENT PACKS ⊕ HOST SELECTION · UI OVERVIEW</span>
  <h1>内置内容包 + 房主选择 · 界面总览
    <small>八张**实景图**拼成一张：每张都由真服务器 + 真前端渲染，只对尚未实现的新 UI 注入 DOM，
    样式令牌与字体取自游戏自己的样式表。<br>
    <b>图里的内容包 UI 目前是提案</b>——本仓库只有 manifest 层（<code>shared/packs.js</code>），
    <code>server/packs.js</code> / <code>tools/packs.mjs</code> / <code>public/js/ui/lang.js</code> 等运行时并不存在。</small>
  </h1>
  <div class="lede">
    <span class="tag tag--real"><i></i>实景图：真服务器 + 真前端</span>
    <span class="tag tag--plan"><i></i>内容包 UI 本身尚未实现（提案）</span>
    <span class="tag">令牌 / 字体取自游戏样式表</span>
  </div>
</div>

${panel('①', '大厅 · 桌面 1920×1080', 'LOBBY · WEB', duo(
  { k: 'lobbyClosed', t: '收起（默认）', tag: 'DEFAULT', cap: '<b>创建框只放 公开/私密</b>；「内容包」是它正下方一行可展开的二级菜单。默认收起——所以大厅左栏不会被常驻面板折行。' },
  { k: 'lobbyOpen', t: '展开', tag: 'OPEN', cap: '展开体：3 个内置包（勾选态 / 类型 / 版本）＋「未勾选即原版，公开匹配锁原版」的说明。' },
))}

${panel('②', '大厅 · 安卓横屏 844×390', 'LOBBY · ANDROID', duo(
  { k: 'phoneClosed', t: '收起（默认）', tag: 'DEFAULT', phone: true, cap: '1rem = 40px（根字号下限）。收起时整行仅 15px 高，与创建框一起落在首屏。' },
  { k: 'phoneOpen', t: '展开', tag: 'OPEN', phone: true, cap: '展开体 65px，仍在 844×390 首屏内（不需要滚动）——这是手机端最容易溢出的版面。' },
))}

${panel('③', '匹配弹窗 · 房间卡徽标', 'MATCHMAKING', duo(
  { k: 'badge', t: '加入前可见', tag: 'BEFORE JOIN', cap: '房间卡上带 <b>🧩 内容包 ×N</b> 徽标与包名列表，加入前就知道这局用了什么。' },
  { k: 'room', t: '房间内 · 房主选择器', tag: 'IN ROOM', cap: '房间条左侧列出本局内容包（所有人可见）；房主的「🧩 内容包」按钮展开选择器——<b>这里才是真正改的地方</b>。' },
))}

${panel('④', '运营端与玩家端', 'ADMIN ⊕ PLAYER', duo(
  { k: 'adminPool', t: '管理后台 · 内容包池', tag: '/ADMIN', cap: '运营端决定池子：可用 / 停用，以及<b>校验拒绝原因</b>（fail-closed，坏包跳过并报告，服务器继续跑）。<b>后台是整页截图，所以这一格比邻格高。</b>' },
  { k: 'settings', t: '设置 · 只读行', tag: 'SETTINGS', cap: '玩家端只读：本版本内置了哪些包。本局启用哪些由房主在房间内决定，此处仅供查看。' },
))}

${panel('⑤', '两级控制模型', 'TWO-LEVEL CONTROL', `
  <div class="legend">
    <div class="lg"><b>1</b><span><b>运营端（<code>/admin</code>）决定池子</b>：哪些内置包可以被选用。池子之外的选择不存在。</span></div>
    <div class="lg"><b>2</b><span><b>房主在建房时决定本局启用哪些</b>（房间内选择器，<code>mod-6</code>）。改动在开局前生效。</span></div>
    <div class="lg"><b>3</b><span><b>公开匹配锁原版</b>：不经过房主选择的对局一律按原版内容跑。</span></div>
    <div class="lg lg--warn"><b>!</b><span><b>包是服务器权威的，不是每玩家各装一份</b>：一局里大家内容一致，靠的是「都在同一台服上」。PACKS.md 把「握手带内容 hash」列为待办。</span></div>
  </div>
  <div class="rules">
    <div class="rules__col do"><h4>应当</h4><ul>
      <li>覆盖层放在 <code>shared/</code> / <code>server/</code> 共享层——Web 与 APK 自动同时覆盖，不写两套。</li>
      <li>默认只做加法；要覆盖官方 id 必须显式声明 <code>overrides</code>，否则拒绝并报告。</li>
      <li>校验复用真引擎，分层：格式 → 语义 → 真引擎 → 每种内容一层。</li>
    </ul></div>
    <div class="rules__col dont"><h4>不要</h4><ul>
      <li>不要把<b>皮肤 / 立绘</b>当内容包——那是游戏内功能；只有当包<b>新增了干员</b>时，它才自带这些干员的立绘。</li>
      <li>不要把常驻展开的独立面板放回大厅左栏——会折行。</li>
      <li>不要连上游的 <code>data/*.json</code> / golden 一起拿——那是另一份上游快照。</li>
    </ul></div>
  </div>
`)}

<div class="foot">
  <span>实景图由 <code>render-mod-loader.mjs</code> 生成；本总览由 <code>render-mod-overview.mjs</code> 拼合</span>
  <span>缺件清单与恢复代价：E:\\Workbox\\PACK_RUNTIME_GAP_REVIEW.md</span>
</div>

</div></body></html>`;

// ---- 渲染 -------------------------------------------------------------------------------------------

const TMP = path.join(os.tmpdir(), `sp-mod-overview-${process.pid}.html`);
writeFileSync(TMP, SHEET, 'utf8');
const OUT = path.join(HERE, 'mod-overview.png');

const waitImages = (page) => page.evaluate(() => Promise.all(Array.from(document.images)
  .map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));

const report = { imgs: 0, broken: 0, offPage: [], frames: 0, panels: 0, w: 0, h: 0 };
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--font-render-hinting=none', '--allow-file-access-from-files', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
  await page.goto(furl(TMP), { waitUntil: 'load' });
  await waitImages(page);
  await page.evaluate(() => (document.fonts?.ready || Promise.resolve()));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const info = await page.evaluate(() => {
    const imgs = Array.from(document.images);
    const offPage = [];
    for (const el of document.querySelectorAll('.panel *, .foot *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > 1913 || r.left < 7)) {
        offPage.push(`${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return {
      imgs: imgs.length,
      broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
      // 每个画框的文档坐标 + 它装的是哪张图（deviceScaleFactor=1 且 clip 从 0,0 起，故文档坐标即像素坐标）
      frames: Array.from(document.querySelectorAll('.frame')).map((f) => {
        const r = f.getBoundingClientRect();
        const s = f.querySelector('img')?.getAttribute('src') || '';
        return {
          file: decodeURIComponent(s.split('/').pop() || ''),
          x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY),
          w: Math.round(r.width), h: Math.round(r.height),
        };
      }),
      panels: document.querySelectorAll('.panel').length,
      fonts: [...new Set(Array.from(document.fonts).map((f) => f.family))].sort(),
      offPage: [...new Set(offPage)].slice(0, 10),
      w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
    };
  });
  Object.assign(report, info);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1920, height: info.h }, captureBeyondViewport: true });
} finally {
  await browser.close();
  rmSync(TMP, { force: true });
}

// ---- 自检（本模型读不了图，故用几何 + 像素证据替代目视） --------------------------------------------

const buf = readFileSync(OUT);
const { w, h } = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
const png = decodePng(buf);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 区域墨量 = 与区域中位亮度差 >12 的像素占比（背景是平的，文字/描边/色块都算墨） */
const inkOf = (x0, y0, x1, y1) => {
  const vals = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * w + x) * 4; vals.push(lum(png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]));
  }
  vals.sort((a, b2) => a - b2); const med = vals[vals.length >> 1];
  let n = 0; for (const v of vals) if (Math.abs(v - med) > 12) n++;
  return +(n / vals.length).toFixed(4);
};
const bands = Array.from({ length: 10 }, (_, i) =>
  inkOf(0, Math.floor((h * i) / 10), w, Math.floor((h * (i + 1)) / 10)));

// 每一格必须：装的是期望的那张实景图，且那一格真的画出了东西（不是空白）
const expected = new Set(Object.values(SHOTS));
const cellInk = report.frames.map((f) => ({ ...f, ink: inkOf(f.x, f.y, f.x + f.w, f.y + f.h) }));
const wrongFile = cellInk.filter((f) => !expected.has(f.file)).map((f) => f.file);
const blank = cellInk.filter((f) => f.ink < 0.01).map((f) => f.file);
const notShown = [...expected].filter((n) => !cellInk.some((f) => f.file === n));

const problems = [];
if (report.broken) problems.push(`${report.broken} 张图未加载`);
if (report.offPage.length) problems.push(`出界：${report.offPage.join(' ')}`);
if (wrongFile.length) problems.push(`画框装了非预期图：${wrongFile.join(', ')}`);
if (blank.length) problems.push(`空白画框：${blank.join(', ')}`);
if (notShown.length) problems.push(`未上总览：${notShown.join(', ')}`);
if (bands.some((v) => v === 0)) problems.push('存在空条带');

console.log('\n== 自检 ==');
console.log(` 面板 ${report.panels} | 画框 ${cellInk.length} | 图片 ${report.imgs}（未加载 ${report.broken}）`);
for (const f of cellInk) console.log(`   ${f.file.padEnd(34)} ${String(f.w).padStart(4)}x${String(f.h).padStart(4)} @${f.x},${f.y}  墨量 ${f.ink}`);
console.log(` 出界 ${report.offPage.length ? report.offPage.join(' ') : 'none'}`);
console.log(` 已注册字体: ${report.fonts.join(' / ') || '（无）'}`);
console.log(` 产物 mod-overview.png: ${w}x${h}, ${Math.round(buf.length / 1024)} KB`);
console.log(` 10 条带墨量: ${bands.join(' ')}  min=${Math.min(...bands)}`);
console.log(problems.length ? `\n ${problems.length} 项未通过：\n  - ${problems.join('\n  - ')}` : '\n 全部通过');
console.log(' 注意：几何与像素证据不能替代审美判断，仍建议人工过目一眼。');
process.exitCode = problems.length ? 1 : 0;
