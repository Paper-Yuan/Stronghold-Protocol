// docs/mockups/render-dual-platform.mjs — 「双端对应适配 · Web × Android」参考图渲染
//
// 用途：把「实装后」的 UI 在两个客户端上**对应**地定义下来——不是按尺寸缩放，而是按三层轴对齐：
//   ① 能力层（device.js 特征类，永不用 UA）② 原生桥层（AndroidNative，仅安卓）③ 资源档层（bundle tier，喂服务端熔断）
// 结合 docs/HANDOFF_MATCHMAKING_PRIVATE_ROOMS.md 与 docs/SKIN_SHOP_PORTRAIT_PLAN.md 的双端落地。
//
// 结构/类名/文案取自本仓库源码（device.js / devices.css / net.js / AndroidBridge.kt / settings.js / lobby.js），
// 主题令牌取自 public/css/theme.css，属示意图（非臆造）。
//
// 用法：node docs/mockups/render-dual-platform.mjs
// 产物：docs/mockups/dual-platform-adaptation.png
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = pathToFileURL(path.join(ROOT, 'public/assets')).href;

if (!process.env.CHROME_PATH) {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  const hit = candidates.find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const CHROME = process.env.CHROME_PATH;

const img = (src, cls = '') => `<img class="${cls}" src="${src}" loading="eager" onerror="this.style.visibility='hidden'">`;
const ava = (id) => `${A}/char/avatar/${id}.png`;

// ---- 双端对照表数据（逐屏：Web / 安卓 / 检测机制 / 为什么不是尺寸） -------------------------------
const MATRIX = [
  ['标题页', '预载药丸 + 自动预载通知 + 页脚版本号', '无预载 UI（全量内置）；页脚读 getAppVersion', 'AndroidNative.isNativeApp()', '资源来源不同，不是屏宽'],
  ['大厅 · 创建/加入', '输 6 位密钥或邀请链接', '<b>额外</b>：局域网自动发现，只输密钥', 'AndroidNative.findRoom → window.__onRoomFound', '安卓可被局域网发现'],
  ['房间 · 密钥', '复制邀请链接', '显示本机 IP（getLocalIp）+ 局域网提示', 'AndroidNative.getLocalIp', '安卓是主机'],
  ['设置 · 服务器', '联机服务器 URL（?ws= / localStorage）', '<b>额外</b>：本机服务（打开/重启内嵌 Node）', 'nativeShell ≠ null', '安卓内嵌服务器'],
  ['设置 · 性能', '动态高刷新率：只调页面 ticker（PREP 120 / BATTLE 60）', '同名开关<b>同时</b>调 setHighRefresh 改屏幕刷新率', 'isHighRefresh / setHighRefresh', '安卓能控硬件刷新率'],
  ['设置 · 画质/棋盘', '高/中/低、自动/3D/2D，热防护降 DPR', '同上 + 兼容模式逃生（enableCompatMode）', '—', '共享，安卓多一条逃生'],
  ['战斗 HUD', '安全区 + 44px 触控靶区（sp-coarse）', '同（coarse 必然成立）+ 热防护甩像素', 'sp-coarse / --tap-min', '触摸 vs 鼠标，非尺寸'],
  ['商店卡 · 立绘', '皮肤立绘进 <b>Full 预载档</b>（+35MB，需重测文案）', '皮肤立绘打进 <b>app_bundle.zip</b>（+35MB，需过包体门禁）', 'bundle tier', '分发方式不同'],
  ['聊天面板', '软键盘用 visualViewport 上抬（--kb-inset）', '同（WebView 软键盘）', 'visualViewport', '输入法遮挡'],
  ['朝向轮', '二段式：松手在死区不提交', '同', 'sp-coarse', '触摸误触'],
  ['私密房间', '不出现在公开列表；凭密钥/邀请链接加入', '同上，<b>且可被局域网 findRoom 扫到</b>', 'Room.private + 桥', '双端加入途径不同'],
  ['诊断/自愈', '控制台日志', '原生日志面板 showLogs + reportClientState 上报黑屏', 'nativeShell', 'WebView 黑屏页面无法自述'],
  ['管理后台 /admin', '有（运维用）', '无入口', '—', '仅运维'],
  ['资源预载', 'core → full 两阶段，CacheStorage', '不适用（内置全量）', 'isNativeApp() 提前 return', '资源来源不同'],
];

const rowHtml = (r) => `<tr><td class="k">${r[0]}</td><td class="web">${r[1]}</td><td class="and">${r[2]}</td><td class="mech"><code>${r[3]}</code></td><td class="why">${r[4]}</td></tr>`;

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{
  --bg-0:#0c0f0e; --bg-1:#141816; --bg-2:#1e2421; --bg-3:#252c29; --bg-4:#2d3632;
  --line:#2f3a35; --line-2:#3e4b45; --line-3:#58675f;
  --mint-500:#4ed8af; --mint-400:#59f4ca; --mint-glow:#17f9b7; --mint-700:#2a9e7f; --mint-a10:rgba(78,216,175,.10); --mint-a20:rgba(78,216,175,.20);
  --gold:#ffc600; --amber:#f6a329; --orange:#e85a1a; --red:#e73118; --red-premium:#ff5454; --ice:#9fd4ff;
  --text-hi:#f2f2f2; --text-md:#c3cbc7; --text-lo:#8a948f; --text-dim:#5d6863;
  --font-cjk:'Noto Sans SC','Microsoft YaHei','PingFang SC',sans-serif;
  --font-num:'Rajdhani','Oxanium',var(--font-cjk);
}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;background:var(--bg-0);color:var(--text-hi);font-family:var(--font-cjk);font-size:15px;line-height:1.5;padding:36px 40px 48px}
.num{font-family:var(--font-num);font-variant-numeric:tabular-nums}
.micro{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim)}
.micro--mint{color:var(--mint-500)}
code{color:var(--text-hi);background:var(--bg-3);padding:0 4px;font-size:11.5px}
h1{font-size:30px;font-weight:700}
h1 small{display:block;font-size:14px;font-weight:400;color:var(--text-lo);margin-top:6px;line-height:1.6}
.lede{display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border:1px solid var(--line-2);color:var(--text-md);background:var(--bg-2)}
.tag i{width:8px;height:8px;display:block}
.tag--web i{background:var(--ice)} .tag--and i{background:var(--mint-500)} .tag--both i{background:var(--gold)}
.panel{margin-top:26px;border:1px solid var(--line);background:var(--bg-1)}
.panel__hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg-2)}
.panel__hd h2{font-size:17px;font-weight:600}
.panel__hd .spacer{flex:1}
.panel__bd{padding:16px}
/* 三层模型 */
.axes{display:flex;gap:16px}
.axis{flex:1;border:1px solid var(--line);background:var(--bg-0);padding:14px}
.axis__n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;font-family:var(--font-num);font-weight:700;font-size:13px;background:var(--gold);color:#1a1400;margin-bottom:9px}
.axis h3{font-size:14.5px;font-weight:600;margin-bottom:4px}
.axis__sub{font-size:11.5px;color:var(--text-dim);margin-bottom:10px}
.axis p{font-size:12.5px;color:var(--text-md);line-height:1.6;margin-bottom:9px}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{font-size:11px;padding:2px 8px;border:1px solid var(--line-2);background:var(--bg-2);color:var(--text-lo)}
.chip--mint{border-color:var(--mint-700);color:var(--mint-400)}
.chip--ice{border-color:rgba(159,212,255,.45);color:var(--ice)}
.chip--gold{border-color:rgba(255,198,0,.45);color:var(--gold)}
.side{margin-top:11px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--text-lo)}
.side b{color:var(--text-hi)}
/* 表 */
table.mtx{width:100%;border-collapse:collapse;font-size:12.5px}
table.mtx th,table.mtx td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top;line-height:1.55}
table.mtx th{background:var(--bg-2);color:var(--text-md);font-size:12px;font-weight:600;white-space:nowrap}
table.mtx td.k{color:var(--text-hi);font-weight:600;white-space:nowrap}
table.mtx td.web{color:#cfe6f7} table.mtx td.and{color:#cdf3e5}
table.mtx td.mech{color:var(--text-lo)} table.mtx td.why{color:var(--text-dim);font-size:12px}
table.mtx tbody tr:nth-child(even){background:rgba(255,255,255,.015)}
/* 设备框 */
.devices{display:flex;gap:22px;align-items:flex-start}
.dev{flex:1;border:1px solid var(--line);background:var(--bg-0);padding:14px}
.dev__hd{display:flex;align-items:center;gap:9px;margin-bottom:10px;font-size:12.5px;color:var(--text-md)}
.dev__hd .micro{margin-left:auto}
.frame{position:relative;border:2px solid var(--line-3);background:var(--bg-1);overflow:hidden}
.frame--desktop{aspect-ratio:16/9}
.frame--phone{aspect-ratio:844/390;border-radius:14px}
/* HUD 简化示意 */
.hud{position:absolute;inset:0;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.hud__top{display:flex;align-items:center;gap:8px}
.hud__bar{height:22px;border:1px solid var(--line-2);background:var(--bg-2);display:flex;align-items:center;gap:8px;padding:0 8px;font-size:11px;color:var(--text-lo);flex:1}
.board{flex:1;border:1px solid var(--line-2);background:
  repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 26px),
  repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 26px),rgba(8,11,10,.6);
  position:relative}
.piece{position:absolute;width:26px;height:26px;border:1px solid var(--mint-700);background:var(--bg-3);overflow:hidden}
.piece img{width:100%;height:100%;object-fit:cover}
.hud__bot{display:flex;gap:6px;align-items:flex-end}
.scard{width:46px;height:56px;border:1px solid var(--line-2);background:var(--bg-2);flex:0 0 auto}
.scard--sold{border-style:dashed;background:repeating-linear-gradient(135deg,rgba(255,255,255,.02) 0 6px,transparent 6px 12px),rgba(8,11,10,.7)}
.gm__corner{margin-left:auto;display:flex;gap:5px}
.gbtn{width:24px;height:24px;border:1px solid var(--line-2);background:rgba(8,11,10,.85);color:var(--text-lo);font-size:11px;display:flex;align-items:center;justify-content:center}
.gbtn--mint{border-color:var(--mint-700);color:var(--mint-400)}
.ov{position:absolute;font-size:10.5px;padding:2px 7px;border:1px solid var(--gold);background:rgba(12,15,14,.95);color:var(--gold);z-index:4}
.ov--mint{border-color:var(--mint-500);color:var(--mint-400)}
.ov--ice{border-color:var(--ice);color:var(--ice)}
/* 计划落地 + 规则 */
.two{display:flex;gap:22px;align-items:flex-start}
.plan{flex:1;border:1px solid var(--line);background:var(--bg-0);padding:14px}
.plan h3{font-size:14.5px;font-weight:600;margin-bottom:10px}
.plan h3 .micro{margin-left:8px}
.plan__row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.55}
.plan__row:last-child{border-bottom:0}
.plan__who{flex:0 0 78px;font-weight:600}
.plan__who.web{color:var(--ice)} .plan__who.and{color:var(--mint-400)} .plan__who.both{color:var(--gold)}
.rules{display:flex;gap:18px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.rules__col{flex:1}
.rules__col h4{font-size:12.5px;margin-bottom:8px}
.rules__col.do h4{color:var(--mint-400)} .rules__col.dont h4{color:var(--red-premium)}
.rules__col li{list-style:none;font-size:12.5px;color:var(--text-md);line-height:1.6;margin-bottom:6px;padding-left:18px;position:relative}
.rules__col li::before{position:absolute;left:0;top:0}
.rules__col.do li::before{content:'✓';color:var(--mint-400)}
.rules__col.dont li::before{content:'✕';color:var(--red-premium)}
.foot{margin-top:26px;display:flex;justify-content:space-between;color:var(--text-dim);font-size:12px}
</style></head><body>

<h1>双端对应适配 · Web × Android
  <small>不是按尺寸缩放：两端按三层轴对应——① 能力层（device.js 特征类，永不用 UA 嗅探）　② 原生桥层（AndroidNative，仅安卓）　③ 资源档层（bundle tier，直接喂服务端 loadGuard 熔断）<br>
  结合 docs/HANDOFF_MATCHMAKING_PRIVATE_ROOMS.md（匹配 / 私密房间）与 docs/SKIN_SHOP_PORTRAIT_PLAN.md（皮肤立绘）的双端落地</small>
</h1>
<div class="lede">
  <span class="tag tag--web"><i></i>Web 端：浏览器 / PWA，按需 CDN + 预载分档</span>
  <span class="tag tag--and"><i></i>安卓原生端：WebView + 内嵌 Node，全量内置包</span>
  <span class="tag tag--both"><i></i>跨端共享：能力层与视觉语言</span>
</div>

<!-- ===== ① 三层模型 ===== -->
<section class="panel">
  <header class="panel__hd"><h2>① 双端对应的三层轴</h2><span class="spacer"></span><span class="micro">THE THREE AXES — 适配必须挂在这三层上</span></header>
  <div class="panel__bd">
    <div class="axes">
      <div class="axis">
        <span class="axis__n">1</span>
        <h3>能力层 · CAPABILITY</h3>
        <div class="axis__sub">public/js/ui/device.js → &lt;html&gt; 类，public/css/devices.css 消费</div>
        <p>全部<b>特征探测</b>，绝不 UA 嗅探：驱动安全区、44px 触控靶区、短横屏放大、宽高比适配。</p>
        <div class="chips">
          <span class="chip chip--mint">sp-touch</span><span class="chip chip--mint">sp-coarse</span><span class="chip chip--mint">sp-hover</span>
          <span class="chip chip--mint">sp-fs</span><span class="chip chip--mint">sp-standalone</span><span class="chip chip--mint">sp-reduced-motion</span><span class="chip chip--mint">sp-rotatable</span>
        </div>
        <div class="side"><b>跨端</b>：桌面 Web = fine + hover；手机 Web / 安卓 = coarse + touch。同一套类同时覆盖两端 → 这一层是<b>共享</b>的。</div>
      </div>
      <div class="axis">
        <span class="axis__n">2</span>
        <h3>原生桥层 · NATIVE BRIDGE</h3>
        <div class="axis__sub">AndroidBridge.kt → window.AndroidNative（13 个方法）</div>
        <p>判端只用 <code>AndroidNative.isNativeApp()</code>，不用 UA。</p>
        <div class="chips">
          <span class="chip chip--ice">isNativeApp</span><span class="chip chip--ice">getAppVersion</span><span class="chip chip--ice">getLocalIp</span>
          <span class="chip chip--ice">findRoom → __onRoomFound</span><span class="chip chip--ice">connectToHost</span>
          <span class="chip chip--ice">openServerSettings</span><span class="chip chip--ice">restartLocalServer</span>
          <span class="chip chip--ice">getLogs / showLogs</span><span class="chip chip--ice">reportClientState</span><span class="chip chip--ice">getClientState</span>
          <span class="chip chip--ice">enableCompatMode</span><span class="chip chip--ice">reloadClient</span>
          <span class="chip chip--ice">isHighRefresh / setHighRefresh</span>
        </div>
        <div class="side"><b>仅安卓</b>：局域网发现、本机服务器、原生诊断与自愈、硬件刷新率控制。Web 端对应位置必须<b>隐藏或降级</b>，不能留死按钮。</div>
      </div>
      <div class="axis">
        <span class="axis__n">3</span>
        <h3>资源档层 · BUNDLE TIER</h3>
        <div class="axis__sub">public/js/net.js hello 上报 client = { platform, bundle }</div>
        <p>安卓固定 <code>android_full</code>；Web 按 localStorage <code>sp_preloaded_profiles</code> 分 <code>web_full / web_core / stream</code>。</p>
        <div class="chips">
          <span class="chip chip--gold">android_full · 权重 1.0</span><span class="chip chip--gold">web_full · 1.0</span>
          <span class="chip chip--gold">web_core · 1.5</span><span class="chip chip--gold">stream · 8.0</span>
        </div>
        <div class="side"><b>决定分发与熔断</b>：服务端按档聚合（admin / lobby），<code>loadScore</code> 里 stream 档 = 8 倍负载 → 直接决定 admission 熔断。适配不能只看"是不是手机"，要看<b>档</b>。</div>
      </div>
    </div>
  </div>
</section>

<!-- ===== ② 逐屏双端对照 ===== -->
<section class="panel">
  <header class="panel__hd"><h2>② 逐屏双端对照表（整体适配的正文）</h2><span class="spacer"></span><span class="micro">SURFACE × END — 14 SURFACES</span></header>
  <div class="panel__bd">
    <table class="mtx">
      <thead><tr><th style="width:120px">界面 / 组件</th><th style="width:330px">Web 端</th><th style="width:360px">安卓原生端</th><th style="width:230px">检测机制</th><th>为什么不是"尺寸"</th></tr></thead>
      <tbody>${MATRIX.map(rowHtml).join('')}</tbody>
    </table>
  </div>
</section>

<!-- ===== ③ 同一屏两端 ===== -->
<section class="panel">
  <header class="panel__hd"><h2>③ 同一屏两端：战斗 HUD 的对应落位</h2><span class="spacer"></span><span class="micro">SAME LAYOUT LOGIC, DIFFERENT PLATFORM EXTRAS</span></header>
  <div class="panel__bd">
    <div class="devices">
      <div class="dev">
        <div class="dev__hd"><b>Web 端</b>·1920×1080 · fine pointer + hover<span class="micro">DESKTOP</span></div>
        <div class="frame frame--desktop">
          <div class="hud">
            <div class="hud__top"><span class="hud__bar">博士·凯尔希　第 12 回合　生命 9</span><span class="gbtn">⚙</span><span class="gbtn">📖</span><span class="gbtn">⛶</span></div>
            <div class="board">
              <span class="piece" style="left:16%;top:22%">${img(ava('char_498_inside'))}</span>
              <span class="piece" style="left:34%;top:52%">${img(ava('char_103_angel'))}</span>
              <span class="piece" style="left:56%;top:30%">${img(ava('char_263_skadi'))}</span>
              <span class="ov ov--ice" style="right:10px;bottom:74px">预载药丸 ⚡ 预载中 42%</span>
              <span class="ov" style="left:10px;bottom:74px">聊天面板（Enter 开 / Esc 取消）</span>
            </div>
            <div class="hud__bot">
              <span class="scard"></span><span class="scard"></span><span class="scard scard--sold"></span><span class="scard scard--sold"></span>
              <span class="gm__corner"><span class="gbtn gbtn--mint">交流</span></span>
            </div>
          </div>
        </div>
        <div class="side">鼠标端：hover 提示、右键详情、Esc 关弹窗；<b>预载与离线</b>是本端独有的一等公民（右下药丸 + 管理弹窗）。</div>
      </div>
      <div class="dev">
        <div class="dev__hd"><b>安卓原生端</b>·844×390 横屏 · coarse<span class="micro">PHONE LANDSCAPE</span></div>
        <div class="frame frame--phone">
          <div class="hud">
            <div class="hud__top"><span class="hud__bar">第 12 回合　生命 9</span><span class="gbtn gbtn--mint">⚙</span><span class="gbtn">⛶</span></div>
            <div class="board">
              <span class="piece" style="left:14%;top:26%">${img(ava('char_498_inside'))}</span>
              <span class="piece" style="left:40%;top:48%">${img(ava('char_103_angel'))}</span>
              <span class="ov ov--mint" style="right:8px;top:8px">诊断：showLogs / reportClientState</span>
              <span class="ov" style="left:8px;bottom:66px">长按 520ms = 详情（无右键）</span>
            </div>
            <div class="hud__bot">
              <span class="scard"></span><span class="scard scard--sold"></span><span class="scard scard--sold"></span>
              <span class="gm__corner"><span class="gbtn gbtn--mint">交流</span></span>
            </div>
          </div>
        </div>
        <div class="side">触摸端：44px 靶区（<code>sp-coarse</code>）、长按代右键、安全区避让；<b>无预载 UI</b>（内置全量），改为原生诊断与兼容模式逃生。</div>
      </div>
    </div>
    <div class="rules">
      <div class="rules__col do"><h4>应当</h4>
        <li>判端用 <code>AndroidNative.isNativeApp()</code>；交互尺寸用能力类 <code>sp-coarse / sp-touch</code>；资源档用 <code>bundle tier</code>。</li>
        <li>安卓专属能力在 Web 端<b>隐藏或降级</b>（设置里的"本机服务"、大厅的局域网发现）。</li>
        <li>需要状态的 UI 一律走 Preact 状态（大厅每 4s 广播重渲染）。</li>
      </div>
      <div class="rules__col dont"><h4>不要</h4>
        <li>不要用 <code>innerWidth &lt; 768</code> 判"手机"——安卓平板与桌面窄窗会误判。</li>
        <li>不要用 UA 字符串判端（device.js 明确"never UA-sniffed"）。</li>
        <li>不要把两端差异做成同一个断点里的两条 CSS——那会把平台语义压成尺寸语义。</li>
      </div>
    </div>
  </div>
</section>

<!-- ===== ④ 两个计划的双端落地 ===== -->
<section class="panel">
  <header class="panel__hd"><h2>④ 两个计划的双端落地</h2><span class="spacer"></span><span class="micro">MATCHMAKING / PRIVATE ROOMS ＋ SKIN PORTRAIT</span></header>
  <div class="panel__bd">
    <div class="two">
      <div class="plan">
        <h3>匹配 · 私密房间<span class="micro">HANDOFF_MATCHMAKING_PRIVATE_ROOMS</span></h3>
        <div class="plan__row"><span class="plan__who both">两端同</span><span>快速匹配按钮补进 <code>.mm-modal</code>（复用既有 <code>queueMatch()</code>，服务端 0 改动）；10s 超时 AI 补齐。</span></div>
        <div class="plan__row"><span class="plan__who both">两端同</span><span>私密开关走 <b>Preact 状态</b>（<code>room.create.private</code>，+1 协议行 / +6 服务端行），<b>禁止 DOM 注入</b>——大厅每 4s 广播会冲掉注入节点。</span></div>
        <div class="plan__row"><span class="plan__who web">Web</span><span>私密房不出现在公开列表；加入途径 = <b>6 位密钥 / 邀请链接</b>。</span></div>
        <div class="plan__row"><span class="plan__who and">安卓</span><span>同上，<b>且额外可被局域网 <code>findRoom</code> 扫到</b>（<code>window.__onRoomFound</code>）→ 私密 ≠ 局域网不可见，这点必须在两端语义里写清。</span></div>
        <div class="plan__row"><span class="plan__who both">后台</span><span><code>getRooms()</code> 带 <code>private</code>；房间号后置 <code>🔒 私密</code> 徽标 + 段落标题「私密 N」计数（仅 Web 端有后台）。</span></div>
      </div>
      <div class="plan">
        <h3>皮肤立绘同步<span class="micro">SKIN_SHOP_PORTRAIT_PLAN</span></h3>
        <div class="plan__row"><span class="plan__who both">两端同</span><span>新增 <code>skinPortraitUrl</code> / <code>preferredPortraitUrl</code>；接线 <code>.scard__art</code>（商店）、<code>.dhead__art</code>（详情）、<code>.lo-dhead__art</code>（调配头图）。</span></div>
        <div class="plan__row"><span class="plan__who both">两端同</span><span>DIY 自选 / 替补卡<b>不套皮肤</b>（服务端 <code>freezeSkins</code> 已拒绝）；精锐卡皮肤优先生效（皮肤无精英变体）。</span></div>
        <div class="plan__row"><span class="plan__who web">Web</span><span>271 张皮肤立绘进 <b>Full 预载档</b>（<code>extractUrls</code> 加一行）；体积 <code>~430MB → ~465MB</code>，须重测并更新 <code>preloadModal.js</code> 两处硬编码文案。</span></div>
        <div class="plan__row"><span class="plan__who and">安卓</span><span>同一批 PNG 打进 <code>app_bundle.zip</code>；<b>无预载流程</b>，但要重出包体与 <code>bundle.sha256</code> 校验、过包体门禁（历史上有过 304MB→15MB 的瘦身）。</span></div>
        <div class="plan__row"><span class="plan__who both">取图</span><span>manifest 按<b>存在性注入</b> → 缺图自动回退默认立绘，永不 404（延续 assetUrls.js 的不变量）。</span></div>
      </div>
    </div>
  </div>
</section>

<div class="foot">
  <span>docs/mockups/dual-platform-adaptation.png　·　生成：node docs/mockups/render-dual-platform.mjs</span>
  <span>依据：device.js / devices.css / net.js / AndroidBridge.kt / settings.js / lobby.js / preloadModal.js　·　主题令牌 public/css/theme.css</span>
</div>

</body></html>`;

const OUT = path.join(HERE, 'dual-platform-adaptation.png');
const TMP = path.join(HERE, '.dual-platform.tmp.html');
writeFileSync(TMP, HTML, 'utf8');

const puppeteer = (await import('puppeteer-core')).default;
if (!CHROME || !existsSync(CHROME)) { console.error('未找到 Chrome：请设置 CHROME_PATH'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--force-device-scale-factor=1', '--font-render-hinting=none', '--allow-file-access-from-files'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(TMP).href, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((im) => im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
  await new Promise((r) => setTimeout(r, 400));
  const info = await page.evaluate(() => {
    const R = (el) => el.getBoundingClientRect();
    const PAGE_W = 1920;
    const offPage = [];
    for (const el of document.querySelectorAll('.panel *, .foot *')) {
      const r = R(el);
      if (r.width > 0 && (r.right > PAGE_W - 8 || r.left < 8)) offPage.push(`${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const clipped = [];
    for (const el of document.querySelectorAll('.panel *')) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) clipped.push(`${el.className.toString().split(' ')[0]}`);
    }
    // 设备框：内容是否溢出框体
    const devOverflow = [...document.querySelectorAll('.frame')].map((f) => {
      const fr = R(f);
      let bad = 0;
      for (const c of f.querySelectorAll('*')) { const r = R(c); if (r.width > 0 && (r.bottom > fr.bottom + 1 || r.right > fr.right + 1)) bad++; }
      return `${Math.round(fr.width)}x${Math.round(fr.height)} overflow:${bad}`;
    });
    return {
      w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
      imgs: document.images.length, broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
      panels: document.querySelectorAll('.panel').length,
      axes: document.querySelectorAll('.axis').length,
      rows: document.querySelectorAll('table.mtx tbody tr').length,
      devOverflow,
      offPage: [...new Set(offPage)].slice(0, 10), clipped: [...new Set(clipped)].slice(0, 10),
    };
  });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('== 自检 ==');
  console.log(' 面板:', info.panels, '| 轴:', info.axes, '| 对照行:', info.rows, '| 图片:', info.imgs, '未加载:', info.broken, '| 页面:', `${info.w}x${info.h}`);
  console.log(' 设备框:', info.devOverflow.join(' | '));
  console.log(' 出界元素:', info.offPage.length ? info.offPage : 'none');
  console.log(' 文本裁切:', info.clipped.length ? info.clipped : 'none');
} finally {
  await browser.close();
  try { unlinkSync(TMP); } catch { /* ignore */ }
}
const buf = readFileSync(OUT);
console.log(`产物: ${OUT}`);
console.log(`尺寸: ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, ${Math.round(buf.length / 1024)} KB`);
