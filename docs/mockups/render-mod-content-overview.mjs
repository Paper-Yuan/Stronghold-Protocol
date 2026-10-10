// docs/mockups/render-mod-content-overview.mjs — 「装备图鉴 / 盟约与策略 各端改进 UI」总览（一张拼图）
//
// 与 render-mod-overview.mjs 同一路数：**本脚本不重新渲染界面**，只把已经产出的四张单图
// 拼成一张带小标题、端口图例与提案说明的总览图。四张单图分别由：
//   docs/mockups/render-mod-equipment-ui.mjs  → mod-ui-equipment-{web,phone}.png
//   docs/mockups/render-mod-alliances-ui.mjs  → mod-ui-alliances-{web,phone}.png
//
// 版面令牌仍取自游戏自己的样式表（public/css/*.css + public/fonts/fonts.css），
// 所以总览自身的底色 / 描边 / 强调色 / 字体与游戏内一致。
//
// 拼合原则：**按四张图的实际像素尺寸 1:1 落版，不裁切、不拉伸**（Web 1920×1080 满宽，
// 手机 844×390 靠左；右侧空白用于放该图的小标题说明）。画布固定宽 1920，高按内容自适应（≥1200）。
//
// 图上的 ①②③④⑤ 圆标 = 该处靠哪个**端口**适配；端口名与 docs/MOD_UI_ADAPTATION_PLAN.md
// §5「留给 mod 的端口清单」逐字一致，圆标落点与文案照两份渲染脚本里图例的实际写法（以图上为准）。
//
// 用法：node docs/mockups/render-mod-content-overview.mjs   （Windows 自动探测 Chrome；或设 CHROME_PATH）
// 产物：docs/mockups/mod-ui-overview.png   宽 1920 × 高自适应（≥1200）
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, pngSize } from '../../tools/crop-board-atlas.mjs';

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

// ---- 四张单图（必须先由两份 render-mod-*-ui.mjs 生成；缺任何一张就如实报错，不伪造） ------------------

const SHOTS = [
  {
    k: 'eq-web', file: 'mod-ui-equipment-web.png',
    topic: '装备图鉴', platform: '桌面端 Web',
    w: 1920, h: 1080, cls: 'sp-hover sp-fs',
    cap: '左筛选 + 阶级段网格 + 右详情，普通 / 精锐并排。根字号 <code>1rem = 100px</code>。'
      + '内容 = 官方 59 件 ∪ 包内 5 件（普通/精锐成对共 10 条记录），同一条 <code>data.list(\'items\')</code>、同一张卡。',
  },
  {
    k: 'eq-phone', file: 'mod-ui-equipment-phone.png',
    topic: '装备图鉴', platform: '安卓横屏',
    w: 844, h: 390, cls: 'sp-touch sp-coarse sp-no-hover',
    cap: '筛选收成一行、详情走抽屉。根字号照根字号下限 <code>1rem ≈ 36px</code>，网格只露约 1.5 行。',
  },
  {
    k: 'al-web', file: 'mod-ui-alliances-web.png',
    topic: '盟约与策略总览', platform: '桌面端 Web',
    w: 1920, h: 1080, cls: 'sp-hover sp-fs',
    cap: '核心 / 附加两组网格 + 盟约详情（层数、成员、相关装备）。内容 = 官方 23 条 ∪ 包内 2 条'
      + '（卡兹戴尔 / 罗德岛，均 <code>isCore:true</code>），同一条 <code>data.list(\'bonds\')</code>。',
  },
  {
    k: 'al-phone', file: 'mod-ui-alliances-phone.png',
    topic: '盟约与策略总览', platform: '安卓横屏',
    w: 844, h: 390, cls: 'sp-touch sp-coarse sp-no-hover',
    cap: '抽屉式详情；底部图例条先量高再给网格留净空，包盟约卡不会被压住。',
  },
];
const ORDER = ['eq-web', 'eq-phone', 'al-web', 'al-phone'];

const missing = SHOTS.filter((s) => !existsSync(path.join(HERE, s.file))).map((s) => s.file);
if (missing.length) {
  console.error(`缺单图：${missing.join(', ')}\n请先跑：node docs/mockups/render-mod-equipment-ui.mjs 与 render-mod-alliances-ui.mjs`);
  process.exit(1);
}
// 单图实际尺寸与声明不符也如实报错（本脚本按实际像素落版，不缩放）
for (const s of SHOTS) {
  const { w, h } = pngSize(readFileSync(path.join(HERE, s.file)));
  if (w !== s.w || h !== s.h) {
    console.error(`单图尺寸与声明不符：${s.file} 实际 ${w}×${h}，脚本声明 ${s.w}×${s.h}`);
    process.exit(1);
  }
}
const src = (k) => furl(path.join(HERE, SHOTS.find((s) => s.k === k).file));

// ---- 真实样式表 -------------------------------------------------------------------------------------

const css = [
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=Oxanium:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap">`,
  ...['css/theme.css', 'css/components.css', 'css/devices.css', 'fonts/fonts.css']
    .map((rel) => `<link rel="stylesheet" href="${furl(path.join(PUB, rel))}">`),
].join('\n');

// ---- 总览自身的版面（只用游戏令牌与字体；px 尺寸便于阅读） ------------------------------------------

const sheetCss = `
* { box-sizing: border-box; }
body { margin: 0; overflow: visible; height: auto; font-size: 15px; line-height: 1.6; }
.sheet { width: 1920px; background: var(--bg-0); position: relative; }
.sheet::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(70% 40% at 12% 0%, rgba(78,216,175,.07), transparent 60%),
              radial-gradient(50% 30% at 100% 8%, rgba(52,184,216,.05), transparent 60%); }
.sheet > * { position: relative; }
.hd { padding: 34px 40px 28px; background: linear-gradient(180deg, #0f1312, #0a0d0c); border-bottom: 1px solid var(--line); }
.hd h1 { font-size: 30px; font-weight: 900; letter-spacing: .02em; }
.hd h1 small { display: block; margin-top: 10px; font-size: 14px; font-weight: 400; color: var(--text-lo); line-height: 1.75; }
.hd .micro { display: block; margin-bottom: 10px; }
.lede { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.tag { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; font-size: 12.5px; color: var(--text-md);
  background: rgba(255,255,255,.03); border: 1px solid var(--line); }
.tag i { width: 8px; height: 8px; display: block; }
.tag--real i { background: var(--mint-500); } .tag--real { border-color: rgba(78,216,175,.4); }
.tag--plan i { background: var(--gold); } .tag--plan { border-color: rgba(255,198,0,.4); }
.micro { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-dim); letter-spacing: .03em; }
.micro--mint { color: var(--mint-400); }

.shot { margin-top: 26px; }
.shot__hd { display: flex; align-items: center; gap: 13px; padding: 14px 40px 12px;
  background: linear-gradient(180deg, var(--bg-2), var(--bg-1)); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.shot__no { display: grid; place-items: center; width: 26px; height: 26px; font-family: var(--font-num); font-size: 14px;
  font-weight: 700; background: var(--mint-500); color: #06110d;
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%); }
.shot__hd h2 { font-size: 20px; font-weight: 900; letter-spacing: .01em; }
.shot__hd h2 small { margin-left: 8px; font-size: 14px; font-weight: 400; color: var(--text-lo); }
.shot__hd .spacer { flex: 1; }
.shot__hd .meta { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-md); }
.shot__hd .meta code { font-family: var(--font-mono); font-size: 12.5px; color: var(--mint-400);
  background: rgba(78,216,175,.08); padding: 2px 7px; }

.frame { background: var(--bg-0); line-height: 0; }
.frame--full { width: 1920px; border-top: 1px solid var(--line-2); border-bottom: 1px solid var(--line-2); }
.frame--full img { display: block; width: 1920px; height: auto; }
.row { display: flex; gap: 30px; align-items: flex-start; padding: 18px 40px 4px; }
.frame--phone { flex: 0 0 844px; width: 844px; border-radius: 12px; overflow: hidden;
  box-shadow: 0 0 0 1px var(--line-3), 0 8px 24px rgba(0,0,0,.4); }
.frame--phone img { display: block; width: 844px; height: auto; }
.cap { font-size: 13px; color: var(--text-lo); line-height: 1.75; }
.row .cap { flex: 1; min-width: 0; padding-top: 4px; }
.shot > .cap { padding: 10px 40px 0; }
.cap b { color: var(--text-md); }
.cap code, .lg code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }

.panel { margin: 26px 40px 0; border: 1px solid var(--line); background: var(--bg-1); }
.panel__hd { display: flex; align-items: center; gap: 12px; padding: 13px 18px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.panel__hd h2 { display: flex; align-items: baseline; gap: 10px; font-size: 17px; font-weight: 900; letter-spacing: .04em; }
.panel__hd h2::before { content: ''; align-self: center; width: 5px; height: 20px; background: var(--mint-500); }
.panel__hd .spacer { flex: 1; }
.panel__body { padding: 14px 18px 16px; }

.lg-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 30px; }
.lg-group h4 { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; font-size: 14px; color: var(--text-hi); }
.lg-group h4 .micro { font-size: 12px; }
.lg { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; align-items: start; margin-bottom: 9px; font-size: 13px; }
.lg > b { display: grid; place-items: center; width: 24px; height: 24px; font-family: var(--font-num); font-size: 13px;
  background: var(--mint-500); color: #06110d;
  clip-path: polygon(27% 0, 73% 0, 100% 27%, 100% 73%, 73% 100%, 27% 100%, 0 73%, 0 27%); }
.lg--p2 > b { background: var(--gold); color: #1a1400; }
.lg--p3 > b { background: var(--ice); color: #06202f; }
.lg--p4 > b { background: var(--amber); color: #1a1400; }
.lg--p5 > b { background: #c9a2ff; color: #180a2b; }
.lg .k { color: var(--text-hi); font-weight: 700; }
.lg .v { color: var(--text-lo); }
.lg-note { margin-top: 6px; padding-top: 12px; border-top: 1px dashed var(--line-2); font-size: 13px; color: var(--text-md); line-height: 1.8; }
.lg-note code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }
.lg-note b { color: var(--text-hi); }

.plan { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 30px; }
.plan h4 { margin-bottom: 9px; font-size: 14px; }
.plan .todo h4 { color: var(--gold); } .plan .done h4 { color: var(--mint-400); }
.plan ul { list-style: none; }
.plan li { position: relative; padding-left: 19px; margin-bottom: 7px; font-size: 13px; color: var(--text-md); line-height: 1.7; }
.plan li::before { position: absolute; left: 0; top: 0; }
.plan .todo li::before { content: '○'; color: var(--gold); }
.plan .done li::before { content: '✓'; color: var(--mint-400); }
.plan code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }
.plan b { color: var(--text-hi); }
.plan .warn { display: block; margin-top: 10px; padding: 9px 12px; font-size: 13px; color: var(--text-md);
  background: rgba(255,198,0,.06); border: 1px solid rgba(255,198,0,.3); }
.plan .warn b { color: var(--gold); }

.pack { display: flex; flex-wrap: wrap; gap: 10px 26px; font-size: 13px; color: var(--text-md); line-height: 1.8; }
.pack .kv { display: flex; gap: 8px; align-items: baseline; }
.pack .kv b { color: var(--text-hi); }
.pack code { font-family: var(--font-mono); font-size: 12px; color: var(--mint-400); background: rgba(78,216,175,.08); padding: 1px 5px; }
.pack .lead { flex-basis: 100%; color: var(--text-lo); }

.foot { display: flex; justify-content: space-between; gap: 20px; padding: 26px 40px 34px; font-size: 12.5px; color: var(--text-dim); }
.foot code { font-family: var(--font-mono); color: var(--text-lo); }
`;

// ---- 端口图例（端口名逐字取自 docs/MOD_UI_ADAPTATION_PLAN.md §5；圆标与文案照两份渲染脚本的图例） ----

const PORT_LEGEND = [
  {
    head: '装备图鉴', sub: 'mod-ui-equipment-{web,phone}.png',
    rows: [
      ['p1', '阶/层号口', '阶级 chip 与分段由 <code>data.list(\'items\')</code> 实际出现过的 tier 派生（不再写死 <code>TIERS=[1..6]</code>）；排序固定 tier→shopSortId→name。'],
      ['p2', '盟约枚举口', '盟约候选项由行上的 <code>giveBondId</code> 反推（<code>usedBonds</code>），所以包内的 <b>卡兹戴尔 / 罗德岛</b> 自己长进筛选条，顺序也由数据决定。'],
      ['p3', '数据段合并口 + 美术清单口', '包内 5 件与官方 59 件同一条列表、同一张卡、同一套阶色；图标同源（<code>items[iconId||trapId]</code>），包美术由 overlay 并进 <code>assets.json</code>。'],
      ['p4', 'giveBondBiasOnly 口', '官方件带上 <code>giveBondId</code> 后归入盟约筛选与卡上标签；<code>giveBondBiasOnly</code> 的（官方 5_09 / 6_01…6_07 / 6_11 与包内件）只标「仅归类」，不当作盟约成员。'],
    ],
  },
  {
    head: '盟约与策略总览', sub: 'mod-ui-alliances-{web,phone}.png',
    rows: [
      ['p1', '数据段合并口 + 盟约枚举口', '包内 <b>卡兹戴尔 / 罗德岛</b> 与官方 23 条盟约同一条 <code>data.list(\'bonds\')</code>、同一张卡；界面不写死盟约 id / 总数 / 顺序。'],
      ['p2', '核心/附加口', '分组只读记录上的 <code>isCore</code>（不维护「哪些是核心」的 id 清单）——两条包内盟约 <code>isCore:true</code>，自己落进「核心盟约」组。'],
      ['p3', '成员查询口', '成员表 <code>visibleMembers ?? members</code>，查不到的 id 静默丢行；这里 = <b>官方成员 ∪ 包内干员</b>，包内干员带「包」徽标（版式与官方成员一致）。'],
      ['p4', '美术清单口', '包徽记/包道具 art 由 overlay 并进 <code>assets.bonds / assets.items</code>，文件落 <code>public/assets/pack/</code>；不写死 sprite 路径、不按 id 分支。'],
      ['p5', '图标取数口', '取数按 <code>bondId</code> / <code>trapId|iconId</code> 查表，缺图回落字形 —— <b>陨星</b> 立绘不在 <code>assets.chars</code> 清单（该段不随包下发），落成名字首字「陨」。'],
    ],
  },
];

const mk = (k) => `<b>${({ p1: '①', p2: '②', p3: '③', p4: '④', p5: '⑤' })[k]}</b>`;
const legendHtml = PORT_LEGEND.map((g) => `<div class="lg-group">
  <h4>${g.head}<span class="micro">${g.sub}</span></h4>
  ${g.rows.map(([k, name, v]) => `<div class="lg lg--${k}">${mk(k)}<div><span class="k">${name}</span> <span class="v">${v}</span></div></div>`).join('')}
</div>`).join('');

const shotSection = (s, i) => {
  const meta = `${s.w}×${s.h} · <code>${s.cls}</code>`;
  const head = `<header class="shot__hd"><span class="shot__no">${i + 1}</span>
    <h2>${s.topic}<small>· ${s.platform}</small></h2><span class="spacer"></span>
    <span class="meta">${meta}</span></header>`;
  if (s.w >= 1600) {
    return `<section class="shot" data-shot="${s.k}">${head}
      <div class="frame frame--full"><img src="${src(s.k)}" alt="${s.topic} · ${s.platform}"></div>
      <p class="cap">${s.cap}</p></section>`;
  }
  return `<section class="shot" data-shot="${s.k}">${head}
    <div class="row"><div class="frame frame--phone"><img src="${src(s.k)}" alt="${s.topic} · ${s.platform}"></div>
    <p class="cap">${s.cap}</p></div></section>`;
};

const SHEET = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>装备 / 盟约 各端改进 UI 总览</title>
${css}
<style>${sheetCss}</style></head><body><div class="sheet">

<div class="hd">
  <span class="micro micro--mint">EQUIPMENT CODEX ⊕ ALLIANCE CODEX · DUAL-PLATFORM UI OVERVIEW</span>
  <h1>装备 / 盟约 各端改进 UI · 总览
    <small>四张单图拼成一张：<b>只做拼合与注记，不重新渲染界面</b>。Web 在上、手机端在下，逐张带小标题（尺寸 + 端类）。<br>
    样式令牌与字体取自游戏自己的样式表；四张单图本身由 <code>render-mod-equipment-ui.mjs</code> / <code>render-mod-alliances-ui.mjs</code> 产出。</small>
  </h1>
  <div class="lede">
    <span class="tag tag--plan"><i></i>装备图鉴 / 盟约策略页 = 提案（本期 0 生产代码改动）</span>
    <span class="tag tag--real"><i></i>内容包已加载：参考 mod 的真实包内容</span>
    <span class="tag">令牌 / 字体取自游戏样式表</span>
  </div>
</div>

${ORDER.map((k, i) => shotSection(SHOTS.find((s) => s.k === k), i)).join('\n')}

<section class="panel">
  <header class="panel__hd"><h2>⑤ 端口图例</h2><span class="spacer"></span>
    <span class="micro">①②③… 圆标 = 该处靠哪个端口适配 · 端口名逐字取自 MOD_UI_ADAPTATION_PLAN.md §5</span></header>
  <div class="panel__body">
    <div class="lg-groups">${legendHtml}</div>
    <div class="lg-note">图例条里另行文字列出、未单独打圆标的端口：
      <b>挂载点口</b>（入口 = 大厅 · 房间 · 简报，各在「干员调配」「查看装备」旁）·
      <b>样式骨架口</b>（<code>.lo-* / .eq-*</code> 复用同一骨架）·
      <b>枚举可缺项口</b>（缺项落原始值或省略，如 <code>countMode=BOARD_AND_DECK</code> 原样印出、<code>MANI</code> 无阶段标签）·
      <b>阶/层号口</b>（层号 ≤6 用八角 sprite、&gt;6 写 +N）·
      <b>giveBondBiasOnly 口</b>（biasOnly 装备只标「仅归类」、不算盟约成员）。
      两份单图脚本的图例文案与本节一致，本总览照抄，未新增端口名。</div>
  </div>
</section>

<section class="panel">
  <header class="panel__hd"><h2>⑥ 提案状态：哪几处还没实现</h2><span class="spacer"></span>
    <span class="micro">本期没有改动任何生产代码</span></header>
  <div class="panel__body">
    <div class="plan">
      <div class="todo">
        <h4>提案（仓库里还不存在）</h4>
        <ul>
          <li><b>装备图鉴</b>：<code>public/js/screens/equipment.js</code> + <code>public/css/screens/equipment.css</code> 全仓 0 命中。</li>
          <li><b>盟约与策略总览</b>：<code>public/js/screens/alliances.js</code> + <code>public/css/screens/alliances.css</code> 全仓 0 命中；<code>public/index.html</code> 也未挂这两条 <code>&lt;link&gt;</code>。</li>
          <li><b>端口侧未落地</b>：数据段合并口（新建 <code>shared/customContent.js</code>）、静态 overlay 口、包注册表口（新建 <code>server/packs.js</code>）、包类型表、覆盖层段集合口、美术清单口、美术拷贝口（新建 <code>public/assets/pack/</code>）、阶/层号口的数据派生改动、挂载点口的三处入口按钮。</li>
          <li><b>入口未接线</b>：<code>main.js</code> 的 Host、<code>lobby.js / room.js / briefing.js</code> 的入口按钮都还是提案。</li>
        </ul>
      </div>
      <div class="done">
        <h4>已存在（非提案，界面复用它）</h4>
        <ul>
          <li><b>图标取数口</b>：<code>public/js/ui/assetUrls.js:100-102,110-115</code>。</li>
          <li><b>自动关闭口</b>：<code>public/js/screens/loadout.js:664 shouldAutoClose(...)</code>。</li>
          <li><b>样式骨架口</b>：<code>public/css/screens/loadout.css</code> 的 <code>.lo-*</code>（已有 138 个类）。</li>
          <li>单图渲染只对尚未实现的界面注入 DOM；风格基线全部取自仓库现有样式表与字体。</li>
        </ul>
        <span class="warn"><b>结论</b>：装备图鉴与盟约策略页<b>都还是提案</b>——本期未改任何生产代码，四张图是「按提案重建的版面」，不是仓库现成界面的截图。</span>
      </div>
    </div>
  </div>
</section>

<section class="panel">
  <header class="panel__hd"><h2>⑦ 内容包来源</h2><span class="spacer"></span>
    <span class="micro">四张图都是「内容包加载之后」的状态</span></header>
  <div class="panel__body">
    <div class="pack">
      <span class="lead">四张图展示的是 <b>内容包加载之后</b> 的界面：数据 = 官方数据 ∪ 参考 mod 的真实包内容，不是占位假数据。</span>
      <span class="kv"><b>参考 mod</b><code>E:/Workbox/mod-inspect/fanpack-mod</code>（<code>payload/packs/fanpack</code>）</span>
      <span class="kv"><b>包内盟约</b>卡兹戴尔 <code>kazdelShip</code> / 罗德岛 <code>rhodesShip</code>（均 <code>isCore:true</code>）</span>
      <span class="kv"><b>包内装备</b>萨卡兹的断角 / 提卡兹之根 / 罗德岛抑制环 / 罗德岛特制源石弧 / M3利爪（普通·精锐成对，共 10 条记录）</span>
      <span class="kv"><b>包内美术</b><code>bond_kazdelShip</code> / <code>bond_rhodesShip</code> / <code>trap_c_01…04</code>（6 张，落 <code>public/assets/pack/</code>）</span>
    </div>
  </div>
</section>

<div class="foot">
  <span>单图：<code>render-mod-equipment-ui.mjs</code> / <code>render-mod-alliances-ui.mjs</code>；本总览：<code>render-mod-content-overview.mjs</code></span>
  <span>端口清单：<code>docs/MOD_UI_ADAPTATION_PLAN.md</code> §5</span>
</div>

</div></body></html>`;

// ---- 渲染 -------------------------------------------------------------------------------------------

const TMP = path.join(os.tmpdir(), `sp-mod-content-overview-${process.pid}.html`);
writeFileSync(TMP, SHEET, 'utf8');
const OUT = path.join(HERE, 'mod-ui-overview.png');

const waitImages = (page) => page.evaluate(() => Promise.all(Array.from(document.images)
  .map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));

const report = { imgs: 0, broken: 0, offPage: [], frames: [], panels: [], w: 0, h: 0, fonts: [] };
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
    // 用 Range 量**内容**盒（不含块级元素的 padding），否则满宽 .cap 的内边距会被误判出界
    const contentRect = (el) => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); };
    for (const el of document.querySelectorAll('.shot__hd *, .cap, .panel *, .foot *')) {
      const r = contentRect(el);
      if (r.width > 0 && (r.right > 1913 || r.left < 7)) {
        offPage.push(`${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    // 文档坐标 = 像素坐标（dsf=1，clip 从 0,0 起）
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      imgs: imgs.length,
      broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
      // 每个画框：装的是哪张图、实际自然尺寸、落版尺寸（用于判拉伸/裁切）
      frames: Array.from(document.querySelectorAll('.frame')).map((f) => {
        const img = f.querySelector('img');
        const s = img?.getAttribute('src') || '';
        return {
          file: decodeURIComponent(s.split('/').pop() || ''),
          natW: img?.naturalWidth || 0, natH: img?.naturalHeight || 0,
          ...rect(f), img: rect(img),
        };
      }),
      // 注记面板（图例 / 提案 / 来源 / 页眉页脚）的盒子，用于判「是否压住图」
      panels: Array.from(document.querySelectorAll('.hd, .panel, .foot, .shot__hd')).map((p) => ({ cls: (p.className || '').split(' ')[0], ...rect(p) })),
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
const { w, h } = pngSize(buf);
const png = decodePng(buf);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 区域墨量 = 与区域中位亮度差 >12 的像素占比（背景是平的，文字/描边/色块都算墨） */
const inkOf = (x0, y0, x1, y1) => {
  const vals = [];
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
    const o = (y * w + x) * 4; vals.push(lum(png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]));
  }
  if (!vals.length) return 0;
  vals.sort((a, b2) => a - b2); const med = vals[vals.length >> 1];
  let n = 0; for (const v of vals) if (Math.abs(v - med) > 12) n++;
  return +(n / vals.length).toFixed(4);
};
const bands = Array.from({ length: 10 }, (_, i) =>
  inkOf(0, Math.floor((h * i) / 10), w, Math.floor((h * (i + 1)) / 10)));

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 每张单图：装的是期望图、落版 1:1（无拉伸）、完全在画布内（无裁切）、那格真画出东西（非空白）
const expected = SHOTS.map((s) => s.file);
const cellInk = report.frames.map((f) => ({ ...f, ink: inkOf(f.x, f.y, f.x + f.w, f.y + f.h) }));
const wrongFile = cellInk.filter((f) => !expected.includes(f.file)).map((f) => f.file);
const notShown = expected.filter((n) => !cellInk.some((f) => f.file === n));
const stretched = cellInk.filter((f) => Math.abs(f.img.w - f.natW) > 1 || Math.abs(f.img.h - f.natH) > 1)
  .map((f) => `${f.file} ${f.natW}×${f.natH}→${f.img.w}×${f.img.h}`);
// 裁切 = 图片自身矩形越出画布，或被画框 overflow:hidden 切掉（img 比画框内容区大）
const cropped = cellInk.filter((f) => f.img.x < 0 || f.img.y < 0 || f.img.x + f.img.w > w || f.img.y + f.img.h > h
  || f.img.x < f.x || f.img.y < f.y || f.img.x + f.img.w > f.x + f.w || f.img.y + f.img.h > f.y + f.h)
  .map((f) => f.file);
const blank = cellInk.filter((f) => f.ink < 0.01).map((f) => f.file);
const covered = report.panels.filter((p) => cellInk.some((f) => overlap(p, f)))
  .map((p) => `${p.cls}@${p.x},${p.y}..${p.y + p.h}`);

const problems = [];
if (report.broken) problems.push(`${report.broken} 张图未加载`);
if (report.offPage.length) problems.push(`出界：${report.offPage.join(' ')}`);
if (wrongFile.length) problems.push(`画框装了非预期图：${wrongFile.join(', ')}`);
if (notShown.length) problems.push(`未上总览：${notShown.join(', ')}`);
if (stretched.length) problems.push(`拉伸变形：${stretched.join(' | ')}`);
if (cropped.length) problems.push(`裁切/溢出：${cropped.join(', ')}`);
if (blank.length) problems.push(`空白画框：${blank.join(', ')}`);
if (covered.length) problems.push(`注记面板压住图：${covered.join(' ')}`);
if (w !== 1920) problems.push(`画布宽 ${w} ≠ 1920`);
if (h < 1200) problems.push(`画布高 ${h} < 1200`);
if (bands.some((v) => v < 0.0005)) problems.push('存在空条带');

console.log('\n== 自检 ==');
console.log(` 画布 ${w}×${h}（要求宽 1920 / 高 ≥1200）| 单图 ${cellInk.length} | 图片 ${report.imgs}（未加载 ${report.broken}）`);
console.log(' 单图实际尺寸与落版尺寸（缩放应恒为 1.000）:');
for (const f of cellInk) {
  const sx = (f.img.w / f.natW).toFixed(3), sy = (f.img.h / f.natH).toFixed(3);
  console.log(`   ${f.file.padEnd(30)} 实际 ${String(f.natW).padStart(4)}×${String(f.natH).padStart(4)}`
    + ` → 落版 ${String(f.img.w).padStart(4)}×${String(f.img.h).padStart(4)} @${f.img.x},${f.img.y}  缩放 ${sx}×${sy}  墨量 ${f.ink}`);
}
console.log(` 拉伸/裁切: ${stretched.length || cropped.length ? `拉伸[${stretched.join(' ')}] 裁切[${cropped.join(' ')}]` : '无（四张均 1:1，且在画布内）'}`);
console.log(` 注记面板压住图: ${covered.length ? covered.join(' ') : '无（页眉/小标题/图例/说明均在图的上下方，无重叠）'}`);
console.log(` 出界 ${report.offPage.length ? report.offPage.join(' ') : 'none'}`);
console.log(` 已注册字体: ${report.fonts.join(' / ') || '（无）'}`);
console.log(` 10 条带墨量: ${bands.join(' ')}  min=${Math.min(...bands)}`);
console.log(` 产物 mod-ui-overview.png: ${w}×${h}, ${Math.round(buf.length / 1024)} KB`);
console.log(problems.length ? `\n ${problems.length} 项未通过：\n  - ${problems.join('\n  - ')}` : '\n 全部通过');
console.log(' 注意：几何与像素证据不能替代审美判断，仍建议人工过目一眼。');
process.exitCode = problems.length ? 1 : 0;
