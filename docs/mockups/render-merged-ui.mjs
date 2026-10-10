// docs/mockups/render-merged-ui.mjs — 「v0.2.2 实装后 · UI 合成参考图」渲染
//
// 用途：把 upstream v0.2.2 的 UI 结构与本分支（feature/v0.2.1-fusion-master）独有的 UI 层合成到一张参考图上，
// 逐屏标注「上游 v0.2.2 结构 / 本地 fusion 保留 / 合并后需重接」，作为合并 Phase 2（UI 重接）的对照依据。
//
// 与 render-mockups.mjs 的区别：那张图是「真实服务器 + 真实前端 + 注入提案 DOM」的实景截图；
// 这张是**设计参考图**——因为 v0.2.2 的干员调配在合并前无法在本分支运行，故用真实主题令牌 + 真实类名 +
// 真实干员数据/立绘重建「合并后」的版面，属示意图（结构/类名/文案取自两边源码，非臆造）。
//
// 用法：node docs/mockups/render-merged-ui.mjs      （Windows 自动探测 Chrome；或设置 CHROME_PATH）
// 产物：docs/mockups/merged-ui-reference.png
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = pathToFileURL(path.join(ROOT, 'public/assets')).href; // file:///E:/Workbox/sp-upgrade-2.1/public/assets

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

// ---- 真实干员数据（取自 data/chess.json + public/assets，不是编的） --------------------------------
const ava = (id) => `${A}/char/avatar/${id}.png`;
const sk = (n) => `${A}/skill/${n}.png`;
const bond = (n) => `${A}/bond/${n}.png`;
const prof = (n) => `${A}/prof/${n}.png`;
const skin = (n) => `${A}/char/skin_avatar/${n}.png`;

const TIER = { 1: '#a8a8a8', 2: '#f2f2f2', 3: '#34e6b2', 4: '#34b8d8', 5: '#f8bf00', 6: '#f88000' };

/** 一行干员（上游 v0.2.2 的 .lo-card 结构）。 */
const OP = [
  { name: '隐现', en: 'INSIDER', tier: 1, prof: '狙击', sub: '速射手', avatar: 'char_498_inside', skills: ['skchr_inside_1', 'skchr_inside_2', null], mod: 'X' },
  { name: '角峰', en: 'MATTERHORN', tier: 1, prof: '重装', sub: '铁卫', avatar: 'char_199_yak', skills: ['skchr_yak_1', 'skchr_yak_2', null], mod: 'Y' },
  { name: '能天使', en: 'EXUSIAI', tier: 3, prof: '狙击', sub: '速射手', avatar: 'char_103_angel', skills: ['skchr_angel_1', 'skchr_angel_2', 'skchr_angel_3'], mod: 'X' },
  { name: '斯卡蒂', en: 'SKADI', tier: 3, prof: '近卫', sub: '无畏者', avatar: 'char_263_skadi', skills: ['skchr_skadi_2', 'skchr_skadi_3', null], mod: 'Y' },
  { name: '圣约送葬人', en: 'EXECUTOR THE PALATINE', tier: 5, prof: '近卫', sub: '收割者', avatar: 'char_1032_excu2', skills: ['skchr_excu2_1', 'skchr_excu2_2', null], mod: 'X', sel: true },
  { name: '蕾缪安', en: 'LEMUE', tier: 6, prof: '狙击', sub: '神射手', avatar: 'char_4193_lemuen', skills: ['skchr_lemuen_1', 'skchr_lemuen_2', 'skchr_lemuen_3'], mod: 'X' },
];

const SEL = OP.find((o) => o.sel);

const img = (src, cls = '') => `<img class="${cls}" src="${src}" loading="eager" onerror="this.style.visibility='hidden'">`;

const skillBtns = (skills) => skills.map((s, i) => (s
  ? `<button class="lo-q lo-q--skill${i === 0 ? ' is-on' : ''}" aria-pressed="${i === 0}"><span class="lo-sicon lo-sicon--q${i === 0 ? ' is-on' : ''}">${img(sk(s))}</span></button>`
  : `<span class="lo-q lo-q--empty" aria-hidden="true"></span>`)).join('');

const modBtns = (type) => `
  <button class="lo-q lo-q--mod" aria-pressed="false"><span class="lo-mglyph lo-mglyph--none lo-mglyph--q"></span></button>
  <button class="lo-q lo-q--mod is-on" aria-pressed="true"><span class="lo-mglyph lo-mglyph--q" data-type="${type}"></span><b class="lo-q__type num">${type}</b></button>`;

const cultSelects = (pot = 6, cul = 3) => `
  <span class="lo-select lo-cult__sel lo-cult__pot"><select aria-label="潜能">${[1, 2, 3, 4, 5, 6].map((n) => `<option${n === pot ? ' selected' : ''}>潜能 ${n}</option>`).join('')}</select></span>
  <span class="lo-select lo-cult__sel lo-cult__tier" title="精英阶段2-60级"><select aria-label="练度">${['未精英化', '精英1', '精英2', '精英2 Lv.60'].map((t, i) => `<option${i === cul ? ' selected' : ''}>${t}</option>`).join('')}</select></span>`;

const row = (o) => `
  <div class="lo-card lo-card--t${o.tier}${o.sel ? ' is-sel' : ''}" style="--tc:${TIER[o.tier]}">
    <button class="lo-card__pick" aria-pressed="${!!o.sel}">
      <span class="lo-card__art">${img(ava(o.avatar))}<span class="tier tier--${o.tier} tier--sm lo-card__tier">${o.tier}</span></span>
      <span class="lo-card__id">
        <span class="lo-card__name">${o.name}</span>
        <span class="lo-card__bonds">${img(bond('egirShip'), 'lo-card__bond')}${img(bond('arcaneShip'), 'lo-card__bond')}</span>
      </span>
    </button>
    <div class="lo-card__skills lo-quick" role="group" aria-label="选择技能">${skillBtns(o.skills)}</div>
    <div class="lo-card__mods lo-quick" role="group" aria-label="选择模组" title="模组仅在精锐形态生效">${modBtns(o.mod)}</div>
    <span class="lo-cult">${cultSelects()}</span>
  </div>`;

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{
  --bg-0:#0c0f0e; --bg-1:#141816; --bg-2:#1e2421; --bg-3:#252c29; --bg-4:#2d3632;
  --line:#2f3a35; --line-2:#3e4b45; --line-3:#58675f;
  --mint-500:#4ed8af; --mint-400:#59f4ca; --mint-glow:#17f9b7; --mint-700:#2a9e7f; --mint-900:#0d2c24; --mint-a10:rgba(78,216,175,.10); --mint-a20:rgba(78,216,175,.20);
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
h1{font-size:30px;font-weight:700;letter-spacing:.01em}
h1 small{display:block;font-size:14px;font-weight:400;color:var(--text-lo);letter-spacing:0;margin-top:6px}
.lede{display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border:1px solid var(--line-2);color:var(--text-md);background:var(--bg-2)}
.tag i{width:8px;height:8px;display:block}
.tag--up i{background:var(--ice)} .tag--local i{background:var(--mint-500)} .tag--join i{background:var(--gold)}
.tag--up{border-color:rgba(159,212,255,.4)} .tag--local{border-color:rgba(78,216,175,.4)} .tag--join{border-color:rgba(255,198,0,.4)}
.panel{margin-top:26px;border:1px solid var(--line);background:var(--bg-1);position:relative}
.panel__hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg-2)}
.panel__hd h2{font-size:17px;font-weight:600}
.panel__hd .spacer{flex:1}
.panel__bd{padding:16px}
.cols{display:flex;gap:22px;align-items:flex-start}
.note{font-size:12.5px;color:var(--text-lo);margin-top:10px;padding-left:14px;border-left:2px solid var(--line-2)}
.note b{color:var(--text-md);font-weight:600}
.callout{position:absolute;display:flex;gap:7px;align-items:flex-start;max-width:330px;font-size:12px;line-height:1.45;
  background:rgba(12,15,14,.94);border:1px solid var(--gold);color:var(--text-md);padding:7px 10px;z-index:5}
.callout b{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 16px;margin-top:1px;
  background:var(--gold);color:#1a1400;font-size:11px;font-weight:700;font-family:var(--font-num)}
.callout--up{border-color:var(--ice)} .callout--up b{background:var(--ice);color:#06202f}
.callout--local{border-color:var(--mint-500)} .callout--local b{background:var(--mint-500);color:#04140f}
/* 图注：小圆标锚在元素角上（不遮内容），文字统一排在下方图例条 */
.marker{position:absolute;top:-9px;right:-9px;width:19px;height:19px;display:flex;align-items:center;justify-content:center;
  font-family:var(--font-num);font-size:12px;font-weight:700;z-index:6;border:1px solid #0c0f0e}
.marker--up{background:var(--ice);color:#06202f}
.marker--local{background:var(--mint-500);color:#04140f}
.marker--join{background:var(--gold);color:#1a1400}
.legend{display:flex;gap:18px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.legend__item{display:flex;gap:9px;align-items:flex-start;flex:1;font-size:12.5px;line-height:1.5;color:var(--text-md)}
.legend__item b{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 18px;margin-top:1px;
  font-family:var(--font-num);font-size:11.5px;font-weight:700}
.legend__item--up b{background:var(--ice);color:#06202f}
.legend__item--local b{background:var(--mint-500);color:#04140f}
.legend__item--join b{background:var(--gold);color:#1a1400}
.legend__item code{color:var(--text-hi);background:var(--bg-3);padding:0 4px}

/* ---- 干员调配（上游 v0.2.2 结构） ---- */
.lo{background:var(--bg-0);border:1px solid var(--line);position:relative}
.lo-top{display:flex;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg-2)}
.lo-top__center{flex:1;display:flex;flex-direction:column;gap:7px;align-items:center}
.lo-top__right{display:flex;align-items:center;gap:9px}
.btn{border:1px solid var(--line-2);background:var(--bg-3);color:var(--text-md);font-family:inherit;font-size:12px;padding:5px 11px;cursor:default}
.btn--ghost{background:transparent} .btn--secondary{background:var(--bg-4)} .btn--primary{background:var(--mint-500);color:#06110d;border-color:var(--mint-500);font-weight:600}
.lo-tabs{display:flex;border:1px solid var(--line-2);background:var(--bg-1)}
.lo-tab{display:flex;align-items:center;gap:7px;padding:6px 15px;font-size:13.5px;color:var(--text-lo);border-right:1px solid var(--line)}
.lo-tab:last-child{border-right:0}
.lo-tab.is-on{background:var(--mint-a10);color:var(--mint-400);box-shadow:inset 0 -2px 0 var(--mint-500)}
.lo-tab__n{font-size:11px;background:var(--bg-3);border:1px solid var(--line-2);padding:0 6px;border-radius:1em;color:var(--text-md)}
.lo-sync{font-size:11.5px;color:var(--mint-500)} .lo-count{font-size:12px;color:var(--text-lo)}
.lo-note{padding:8px 16px;font-size:12px;color:var(--text-lo);border-bottom:1px solid var(--line);background:var(--bg-1)}
.lo-body{display:flex;gap:0}
.lo-roster{flex:1;min-width:0;padding:14px 16px}
.lo-detail{width:560px;flex:0 0 560px;border-left:1px solid var(--line);background:var(--bg-1)}
.lo-filters{display:flex;flex-direction:column;gap:9px;margin-bottom:12px}
.lo-frow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lo-chips{display:flex;gap:6px}
.lo-chip{font-size:12px;padding:4px 12px;border:1px solid var(--line-2);background:var(--bg-2);color:var(--text-lo)}
.lo-chip.is-on{background:var(--mint-a10);border-color:var(--mint-700);color:var(--mint-400)}
.lo-search{margin-left:auto}
.field__box{display:flex;align-items:center;border:1px solid var(--line-2);background:var(--bg-2);padding:4px 12px;width:280px;color:var(--text-dim);font-size:12px}
.lo-select{display:inline-flex;border:1px solid var(--line-2);background:var(--bg-2);color:var(--text-md)}
.lo-select select{border:0;background:transparent;color:inherit;font-family:inherit;font-size:12px;padding:4px 8px;outline:0;-webkit-appearance:none;appearance:none}
.lo-list__head,.lo-card{display:grid;grid-template-columns:minmax(220px,300px) 132px 172px 216px;column-gap:12px;align-items:center;justify-content:start}
.lo-list__head{padding:0 12px 8px;font-size:11.5px;color:var(--text-dim);letter-spacing:.08em}
.lo-list__h--mods small{color:var(--text-dim);opacity:.7;margin-left:4px}
.lo-list__rows{display:flex;flex-direction:column;gap:7px}
.lo-card{padding:8px 12px;background:rgba(255,255,255,.025);border:1px solid var(--line);border-left:3px solid var(--tc)}
.lo-card.is-sel{background:var(--mint-a10);border-color:var(--mint-700);box-shadow:inset 0 0 0 1px rgba(78,216,175,.35)}
.lo-card__pick{display:flex;align-items:center;gap:11px;background:transparent;border:0;color:inherit;font-family:inherit;text-align:left;cursor:default}
.lo-card__art{position:relative;width:44px;height:44px;flex:0 0 44px;background:var(--bg-3);border:1px solid var(--line-2);overflow:hidden}
.lo-card__art img{width:100%;height:100%;object-fit:cover}
.lo-card__tier{position:absolute;right:0;bottom:0;font-size:10px;padding:0 3px;background:var(--tc);color:#0c0f0e;font-weight:700}
.lo-card__id{display:flex;flex-direction:column;gap:2px;min-width:0}
.lo-card__name{font-size:14.5px;font-weight:600}
.lo-card__bonds{display:flex;gap:4px}
.lo-card__bond{width:15px;height:15px;opacity:.8}
.lo-quick{display:flex;gap:6px;align-items:center}
.lo-q{width:34px;height:34px;border:1px solid var(--line-2);background:var(--bg-2);position:relative;display:flex;align-items:center;justify-content:center}
.lo-q.is-on{border-color:var(--mint-500);background:var(--mint-a20);box-shadow:inset 0 0 0 1px var(--mint-500)}
.lo-q--empty{border-style:dashed;opacity:.35}
.lo-sicon img{width:100%;height:100%;object-fit:cover}
.lo-mglyph{width:22px;height:22px;border:1px solid var(--line-3);display:block;background:linear-gradient(135deg,var(--bg-3),var(--bg-4))}
.lo-mglyph--none{border-style:dashed;opacity:.5}
.lo-q__type{position:absolute;right:-5px;bottom:-5px;font-size:9.5px;background:var(--mint-500);color:#06110d;padding:0 3px;font-weight:700}
.lo-cult{display:flex;gap:6px}
.lo-cult__sel select{font-size:11.5px}
.lo-cult__pot select{color:var(--mint-400)}
/* 详情卡 */
.lo-dhead{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--bg-2)}
.lo-dhead__art{width:78px;height:78px;flex:0 0 78px;border:1px solid var(--line-2);background:var(--bg-3);overflow:hidden}
.lo-dhead__art img{width:100%;height:100%;object-fit:cover;object-position:top}
.lo-dhead__info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.lo-dhead__name{font-size:19px;font-weight:700}
.lo-dhead__en{font-size:10.5px;letter-spacing:.16em;color:var(--text-dim)}
.lo-dhead__class{font-size:12px;color:var(--text-md);display:flex;align-items:center;gap:6px}
.lo-dhead__prof{width:17px;height:17px}
.lo-badge{font-size:11px;padding:2px 8px;border:1px solid var(--line-2);color:var(--text-lo);align-self:flex-start}
.lo-badge--changed{border-color:var(--mint-700);color:var(--mint-400);background:var(--mint-a10)}
.lo-detail__body{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
.lo-sec{border:1px solid var(--line);background:var(--bg-2);padding:11px 13px}
.lo-sec__head{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.lo-sec__head h3{font-size:13.5px;font-weight:600}
.lo-sec__head .micro{margin-left:auto}
.lo-cult__row{display:flex;align-items:center;gap:11px;margin-top:7px}
.lo-cult__k{font-size:12px;color:var(--text-lo);width:30px}
.lo-seg{display:flex;border:1px solid var(--line-2);background:var(--bg-1)}
.lo-seg button{border:0;border-right:1px solid var(--line);background:transparent;color:var(--text-lo);font-family:inherit;font-size:12px;padding:4px 12px}
.lo-seg button:last-child{border-right:0}
.lo-seg button.is-on{background:var(--mint-500);color:#06110d;font-weight:600}
.lo-cult__note{font-size:11.5px;color:var(--text-dim);margin-top:9px;line-height:1.5}
.lo-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.lo-stat{border:1px solid var(--line);background:var(--bg-1);padding:6px 9px}
.lo-stat span{display:block;font-size:10.5px;color:var(--text-dim)}
.lo-stat b{font-size:15px;font-weight:600}
/* 皮肤（本地） */
.lo-skins{display:flex;gap:9px;flex-wrap:wrap}
.lo-skin{width:118px;border:1px solid var(--line-2);background:var(--bg-1);padding:6px;display:flex;flex-direction:column;gap:6px}
.lo-skin.is-on{border-color:var(--mint-500);box-shadow:inset 0 0 0 1px var(--mint-500)}
.lo-skin__art{width:100%;height:74px;background:var(--bg-3);overflow:hidden;border:1px solid var(--line)}
.lo-skin__art img{width:100%;height:100%;object-fit:cover}
.lo-skin__name{font-size:12px;font-weight:600;display:block}
.lo-skin__group{font-size:10px;color:var(--text-dim);letter-spacing:.08em}
.lo-skin__badge{font-size:10px;color:var(--mint-400);align-self:flex-start;border:1px solid var(--mint-700);padding:0 5px}

/* ---- 通用小屏块 ---- */
.mini{border:1px solid var(--line);background:var(--bg-0);padding:12px;flex:1;min-width:0}
.mini h4{font-size:12.5px;font-weight:600;margin-bottom:9px;color:var(--text-md)}
.mrow{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px}
.mcard{border:1px solid var(--line-2);background:var(--bg-2);padding:7px 9px;display:flex;align-items:center;gap:9px;font-size:12px}
.mbtn{border:1px solid var(--line-2);background:var(--bg-3);color:var(--text-md);font-size:11.5px;padding:3px 9px}
.mbtn--primary{background:var(--mint-500);color:#06110d;border-color:var(--mint-500);font-weight:600}
.mpill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line-2);background:var(--bg-2);padding:3px 9px;font-size:11.5px;border-radius:1em}
.mdot{width:7px;height:7px;border-radius:50%;background:var(--mint-glow)}
.chat{border:1px solid var(--line-2);background:rgba(12,15,14,.9);width:100%;padding:9px}
.chat-item{font-size:12px;margin-bottom:5px}
.chat-seat{color:var(--mint-glow);font-weight:600}
.chat-seat.p2{color:var(--amber)} .chat-seat.p3{color:#45b7ff}
.chat-form{display:flex;gap:7px;margin-top:8px}
.chat-input{flex:1;border:1px solid var(--line-2);background:var(--bg-2);color:var(--text-dim);font-family:inherit;font-size:11.5px;padding:5px 9px}
.bubble{display:inline-block;background:rgba(30,36,33,.95);border:1px solid var(--line-2);border-left:3px solid var(--mint-500);padding:6px 11px;font-size:12px}
.srvload{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(246,163,41,.5);background:rgba(246,163,41,.12);color:var(--amber);padding:4px 11px;font-size:12px}
.toast{display:flex;align-items:center;gap:9px;border:1px solid var(--line-2);border-left:3px solid var(--amber);background:rgba(16,20,18,.95);padding:8px 12px;font-size:12.5px}
.set-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.set-row:last-child{border-bottom:0}
.set-row__label{font-size:12.5px} .set-row__label .micro{display:block;margin-top:2px}
.set-toggle{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--mint-500);background:var(--mint-a10);color:var(--mint-400);font-size:11.5px;padding:3px 10px}
.set-toggle i{width:22px;height:12px;border-radius:1em;background:var(--mint-500);display:block;position:relative}
.set-toggle i::after{content:'';position:absolute;right:1px;top:1px;width:10px;height:10px;border-radius:50%;background:#06110d}
.set-seg{display:flex;border:1px solid var(--line-2)}
.set-seg button{border:0;border-right:1px solid var(--line);background:transparent;color:var(--text-lo);font-family:inherit;font-size:11.5px;padding:3px 11px}
.set-seg button:last-child{border-right:0}
.set-seg button.is-on{background:var(--mint-500);color:#06110d;font-weight:600}
.scard{width:74px;height:92px;border:1px solid var(--line-2);background:var(--bg-2);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-dim)}
.scard--sold{border-style:dashed;background:repeating-linear-gradient(135deg,rgba(255,255,255,.02) 0 7px,transparent 7px 14px),rgba(8,11,10,.75)}
.scard--empty{background:rgba(8,11,10,.4);border-color:var(--line)}
table.mtx{width:100%;border-collapse:collapse;font-size:12.5px}
table.mtx th,table.mtx td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
table.mtx th{background:var(--bg-2);color:var(--text-md);font-weight:600;font-size:12px}
table.mtx td.k{color:var(--text-hi);font-weight:600;white-space:nowrap}
.pill-src{display:inline-block;font-size:10.5px;padding:1px 7px;border:1px solid;white-space:nowrap}
.pill-src--up{color:var(--ice);border-color:rgba(159,212,255,.45)}
.pill-src--local{color:var(--mint-400);border-color:rgba(78,216,175,.45)}
.pill-src--join{color:var(--gold);border-color:rgba(255,198,0,.45)}
.foot{margin-top:26px;display:flex;justify-content:space-between;align-items:flex-end;color:var(--text-dim);font-size:12px}
</style></head><body>

<h1>v0.2.2 实装后 · UI 合成参考图
  <small>feature/v0.2.1-fusion-master　←　upstream v0.2.2（62eb1134，2026-10-09）　·　183 冲突中 52 个属本地增量，UI 面集中在下列几屏</small>
</h1>
<div class="lede">
  <span class="tag tag--up"><i></i>上游 v0.2.2 结构（合并后为底）</span>
  <span class="tag tag--local"><i></i>本地 fusion 保留（上游没有，直接留下）</span>
  <span class="tag tag--join"><i></i>合并后需重接（两边都动过）</span>
  <span class="tag">示意图：结构/类名/文案取自两边源码，干员与立绘为真实数据</span>
</div>

<!-- ============ ① 干员调配 ============ -->
<section class="panel">
  <header class="panel__hd">
    <h2>① 干员调配 · 合并后</h2>
    <span class="tag tag--up"><i></i>上游 v0.2.2：一干员一行 + 潜能·练度列</span>
    <span class="tag tag--join"><i></i>本地「换装 / SKIN」需重新落位</span>
    <span class="spacer"></span>
    <span class="micro">THE ONE COLLISION — 两边都改过此屏</span>
  </header>
  <div class="panel__bd">
    <div class="lo">
      <div class="lo-top">
        <div><button class="btn btn--ghost">返回</button></div>
        <div class="lo-top__center">
          <span class="micro micro--mint">OPERATOR LOADOUT</span>
          <div class="lo-tabs">
            <button class="lo-tab is-on">干员调配</button>
            <button class="lo-tab">干员持有<span class="lo-tab__n num">71</span></button>
            <button class="lo-tab">自选编队<span class="lo-tab__n num">4</span></button>
          </div>
        </div>
        <div class="lo-top__right">
          <span class="lo-sync">已同步</span>
          <span class="lo-count">已调整 <b class="num">3</b><span class="num" style="color:var(--text-dim)">/112</span></span>
          <button class="btn btn--ghost">导出</button>
          <button class="btn btn--ghost">导入</button>
          <button class="btn btn--secondary">全部恢复默认</button>
        </div>
      </div>
      <p class="lo-note">开始模拟前可调整干员携带的技能与模组，以及潜能与练度；干员的局内等级不可调整</p>
      <div class="lo-body">
        <section class="lo-roster">
          <div class="lo-filters">
            <div class="lo-frow">
              <div class="lo-chips">
                <button class="lo-chip is-on">全部</button>
                <button class="lo-chip">I</button><button class="lo-chip">II</button><button class="lo-chip">III</button>
                <button class="lo-chip">IV</button><button class="lo-chip">V</button><button class="lo-chip">VI</button>
              </div>
              <label class="lo-search"><span class="field__box">搜索干员 / 职业 / 盟约</span></label>
            </div>
            <div class="lo-frow">
              <div class="lo-chips">
                <button class="lo-chip">先锋</button><button class="lo-chip">近卫</button><button class="lo-chip is-on">狙击</button>
                <button class="lo-chip">重装</button><button class="lo-chip">医疗</button><button class="lo-chip">辅助</button>
                <button class="lo-chip">术师</button><button class="lo-chip">特种</button>
              </div>
              <label class="lo-select"><select><option>全部盟约</option></select></label>
              <button class="lo-chip">仅看已调整</button>
            </div>
          </div>
          <div class="lo-list" style="position:relative">
            <span class="marker marker--join">3</span>
            <div class="lo-list__head">
              <span class="lo-list__h lo-list__h--op">干员</span>
              <span class="lo-list__h lo-list__h--skills">技能</span>
              <span class="lo-list__h lo-list__h--mods">模组<small>精锐</small></span>
              <span class="lo-list__h lo-list__h--cult" style="position:relative">潜能 · 练度<span class="marker marker--up">1</span></span>
            </div>
            <div class="lo-list__rows">${OP.map(row).join('')}</div>
          </div>
        </section>
        <aside class="lo-detail">
          <div class="lo-dhead">
            <div class="lo-dhead__art">${img(ava(SEL.avatar))}</div>
            <div class="lo-dhead__info">
              <span class="lo-badge lo-badge--changed">已调整</span>
              <h2 class="lo-dhead__name">${SEL.name}</h2>
              <span class="lo-dhead__en">${SEL.en}</span>
              <span class="lo-dhead__class">${img(prof('battlecard_warrior'), 'lo-dhead__prof')}${SEL.prof} · ${SEL.sub}</span>
              <span class="lo-card__bonds">${img(bond('egirShip'), 'lo-card__bond')}${img(bond('deputShip'), 'lo-card__bond')}</span>
            </div>
            <button class="btn btn--ghost">恢复默认</button>
          </div>
          <div class="lo-detail__body">
            <section class="lo-sec">
              <header class="lo-sec__head"><h3>潜能与练度</h3><span class="lo-badge lo-badge--changed">已调整</span><span class="micro">POTENTIAL</span></header>
              <div class="lo-cult__row"><span class="lo-cult__k">潜能</span>
                <div class="lo-seg">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="${n === 6 ? 'is-on' : ''}"><span class="num">${n}</span></button>`).join('')}</div>
              </div>
              <div class="lo-cult__row"><span class="lo-cult__k">练度</span>
                <div class="lo-seg">${['未精英化', '精英阶段1', '精英阶段2', '精英阶段2-60级'].map((t, i) => `<button class="${i === 3 ? 'is-on' : ''}">${t}</button>`).join('')}</div>
              </div>
              <p class="lo-cult__note">默认满潜能、精英2 Lv.60（满加成）。官方的潜能取你自己的潜能…</p>
            </section>
            <section class="lo-sec">
              <header class="lo-sec__head"><h3>技能</h3><span class="micro">SKILL</span></header>
              <div class="lo-quick">${skillBtns(SEL.skills)}</div>
            </section>
            <section class="lo-sec">
              <header class="lo-sec__head"><h3>局内数值</h3><span class="micro">IN-BATTLE</span></header>
              <div class="lo-stats">
                <div class="lo-stat"><span>攻击力</span><b class="num">1130</b></div>
                <div class="lo-stat"><span>防御力</span><b class="num">402</b></div>
                <div class="lo-stat"><span>生命上限</span><b class="num">3280</b></div>
              </div>
            </section>
            <section class="lo-sec" style="position:relative;border-color:var(--mint-700);background:var(--mint-a10)">
              <span class="marker marker--local">2</span>
              <header class="lo-sec__head"><h3>皮肤</h3><span class="lo-sec__note" style="font-size:11px;color:var(--text-lo)">2 款可选</span><span class="micro micro--mint">SKIN</span></header>
              <div class="lo-skins">
                <div class="lo-skin is-on">
                  <span class="lo-skin__art">${img(ava(SEL.avatar))}</span>
                  <span><b class="lo-skin__name">默认</b><span class="lo-skin__group">DEFAULT</span></span>
                  <span class="lo-skin__badge">已装配</span>
                </div>
                <div class="lo-skin">
                  <span class="lo-skin__art">${img(skin('char_1032_excu2_sale_12'))}</span>
                  <span><b class="lo-skin__name">时装</b><span class="lo-skin__group">SALE / 联动</span></span>
                </div>
                <div class="lo-skin">
                  <span class="lo-skin__art">${img(skin('char_1032_excu2_sanrio_2'))}</span>
                  <span><b class="lo-skin__name">时装</b><span class="lo-skin__group">SANRIO / 联动</span></span>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
    <div class="legend">
      <div class="legend__item legend__item--up"><b>1</b><span><b>「潜能 · 练度」列</b>是<b>上游 v0.2.2 新增</b>（PR #301，行内两个 <code>select</code> + 详情卡分段按钮，默认潜能 6 / 精英2 Lv.60）。合并后由它决定干员战力，本地旧版没有这一列。</span></div>
      <div class="legend__item legend__item--local"><b>2</b><span><b>「皮肤 SKIN」段</b>是<b>本地独有</b>（上游 0 个皮肤文件）。本地原来把它挂在详情面板的「换装」子页；合并后建议就落在详情卡这一段，<code>room.skins</code> 与 <code>skinsStore</code> 原样保留。</span></div>
      <div class="legend__item legend__item--join"><b>3</b><span><b>冲突点</b>：本地旧三列卡片布局 + <code>.lo-dtab</code> 换装子页，被上游的「一干员一行、列对齐」取代 → 取上游版面，把皮肤段搬进详情卡。</span></div>
    </div>
    <p class="note"><b>处置：</b>取上游 <code>public/js/screens/loadout.js</code> + <code>loadout.css</code> + <code>cultivation.js</code>；本地只把 <code>skinPicker.js</code> 的 <code>&lt;SkinSection&gt;</code> 接到详情卡末段，并保留 <code>room.skins</code> 协议与 <code>skinsStore</code>。</p>
  </div>
</section>

<!-- ============ ② 商店 / 战斗 HUD ============ -->
<section class="panel">
  <header class="panel__hd">
    <h2>② 商店栏 · 战斗 HUD · 合并后</h2>
    <span class="tag tag--up"><i></i>上游：空栏位卡 / toast</span>
    <span class="tag tag--local"><i></i>本地：聊天面板 / 气泡 / 负载提示</span>
    <span class="spacer"></span>
    <span class="micro">NO STRUCTURAL COLLISION — 直接叠加</span>
  </header>
  <div class="panel__bd">
    <div class="cols">
      <div class="mini">
        <h4>商店栏（上游 v0.2.2 空栏位）</h4>
        <div class="mrow">
          <div class="scard">干员</div>
          <div class="scard">干员</div>
          <div class="scard scard--sold scard--empty" title="空栏位：刷新或下回合开始时补满"></div>
          <div class="scard scard--sold"><span style="text-align:center"><span class="micro">SOLD OUT</span><br>已招募</span></div>
        </div>
        <p class="note" style="margin-top:8px">调度中心升级开出的空格位渲染为<b>无字空卡</b>（<code>.scard--sold.scard--empty</code>），不可买、不弹提示。</p>
      </div>
      <div class="mini">
        <h4>战斗内聊天（本地独有）</h4>
        <div class="chat">
          <div class="chat-item"><span class="chat-seat">[P1] 博士:</span> <span>左上角补一个减速</span></div>
          <div class="chat-item"><span class="chat-seat p2">[P2] 阿米娅:</span> <span>收到，我守右路</span></div>
          <div class="chat-item"><span class="chat-seat p3">[P3] W:</span> <span>我先撤了换位</span></div>
          <div class="chat-form"><span class="chat-input">输入对话 (Enter发送, Esc取消)...</span><span class="mbtn mbtn--primary">发送</span></div>
        </div>
        <div class="mrow" style="margin-top:9px"><span class="bubble">收到，我守右路</span><span style="font-size:11px;color:var(--text-dim)">← 场上气泡 <code>.ebubble--text</code></span></div>
      </div>
      <div class="mini">
        <h4>全局提示（上游 toast + 本地负载）</h4>
        <div class="toast" style="margin-bottom:10px"><span style="color:var(--amber)">▲</span><span>拟态物质：卡池中已没有溯光星源</span></div>
        <div class="srvload"><span>⚠</span><span>服务器拥挤</span><span class="num">37</span></div>
        <p class="note" style="margin-top:8px">上游 <code>.toast--warn</code> 走 <code>m.toast</code> 帧；本地 <code>.srvload</code> 药丸<b>替换了旧的高载弹窗</b>，只在标题/大厅显示。</p>
      </div>
    </div>
    <p class="note"><b>处置：</b>两者落在不同元素上（<code>.shopbar__cards</code> / <code>.toast-host</code> / <code>.chat-panel</code>），无冲突；上游 toast 组件（<code>ui/toasts.js</code>）直接采纳，本地聊天与负载药丸保留。</p>
  </div>
</section>

<!-- ============ ③ 大厅 / 匹配 ============ -->
<section class="panel">
  <header class="panel__hd">
    <h2>③ 大厅 · 多人匹配 · 合并后</h2>
    <span class="tag tag--local"><i></i>本地独有（上游无撮合实现）</span>
    <span class="spacer"></span>
    <span class="micro">KEEP — 上游只碰 <code>lobby.js</code> 的服务端</span>
  </header>
  <div class="panel__bd">
    <div class="cols">
      <div class="mini" style="flex:0 0 520px">
        <h4>大厅撮合面板</h4>
        <div class="mcard" style="justify-content:space-between">
          <span><b>匹配在线博士</b><br><span style="font-size:11px;color:var(--text-dim)">浏览公开同盟房间并一键加入</span></span>
          <span class="mpill"><span class="mdot"></span><span class="num">21</span></span>
          <span class="mbtn mbtn--primary">多人匹配</span>
        </div>
        <div class="mrow" style="margin-top:10px;color:var(--text-dim);font-size:11px">私密同盟开关（计划中，尚未实现）：</div>
        <div class="set-seg" style="width:100%"><button style="flex:1">公开同盟</button><button class="is-on" style="flex:1">🔒 私密同盟</button></div>
      </div>
      <div class="mini">
        <h4>多人匹配弹窗 <code>.mm-modal</code></h4>
        <div class="mrow">
          <span style="color:var(--mint-500);font-size:19px" class="num">21</span><span style="font-size:11px;color:var(--text-dim)">在线博士</span>
          <span style="margin-left:14px;font-size:19px" class="num">3</span><span style="font-size:11px;color:var(--text-dim)">同盟房间</span>
          <span style="margin-left:14px;font-size:19px" class="num">1</span><span style="font-size:11px;color:var(--text-dim)">进行中对局</span>
        </div>
        <div class="mcard" style="margin-top:8px"><b class="num" style="color:var(--gold)">X7K2QM</b><span>凯尔希</span><span style="font-size:11px;color:var(--diff-hard)">困难</span><span style="font-size:11px;color:var(--text-dim)">4 / 10</span><span style="margin-left:auto"><span class="mbtn mbtn--primary">加入</span></span></div>
        <div class="mcard" style="margin-top:6px"><b class="num" style="color:var(--gold)">P3ND8A</b><span>阿米娅</span><span style="font-size:11px;color:var(--diff-normal)">标准</span><span style="font-size:11px;color:var(--text-dim)">3 / 10</span><span style="margin-left:auto"><span class="mbtn">观战</span></span></div>
      </div>
    </div>
    <p class="note"><b>处置：</b>本地 <code>matchmaking.js</code> / <code>MatchmakingModal</code> / <code>Matchmaker</code> 全部保留；上游对 <code>server/lobby.js</code> 的改动要重接本地 <code>queueMatch</code> 接线。<b>私密房间与快速匹配目前只是计划 + 注入式 mock，未实现。</b></p>
  </div>
</section>

<!-- ============ ④ 设置 / 标题 / 预载 ============ -->
<section class="panel">
  <header class="panel__hd">
    <h2>④ 设置 · 标题页脚 · 资源预载 · 合并后</h2>
    <span class="tag tag--local"><i></i>本地独有</span>
    <span class="spacer"></span>
    <span class="micro">KEEP — 上游设置面板结构不同，需按上游新壳重排</span>
  </header>
  <div class="panel__bd">
    <div class="cols">
      <div class="mini">
        <h4>设置（本地新增两项）</h4>
        <div class="set-row"><span class="set-row__label">动态高刷新率<span class="micro">PREP 120 / BATTLE 60</span></span><span class="set-toggle"><i></i>开启</span></div>
        <div class="set-row"><span class="set-row__label">棋盘视角<span class="micro">BOARD VIEW</span></span><span class="set-seg"><button class="is-on">自动</button><button>3D 全景</button><button>2D 俯视</button></span></div>
        <div class="set-row"><span class="set-row__label">画面质量<span class="micro">QUALITY</span></span><span class="set-seg"><button class="is-on">高</button><button>中</button><button>低</button></span></div>
      </div>
      <div class="mini">
        <h4>标题页脚 / 预载药丸</h4>
        <div style="font-size:11.5px;color:var(--text-lo);line-height:1.7">
          非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有<br>
          <span style="color:var(--text-dim)">B 站 纸鸢安好 · UID 99201674 · 安卓端适配参考 B 站 @Ausevay</span>
        </div>
        <div class="mrow" style="margin-top:11px"><span class="mpill"><span class="mdot"></span>⚡ 预载中 42%</span><span class="micro">v0.2.1 · WEB SIMULATION</span></div>
        <div class="mcard" style="margin-top:9px"><span>⚡ 基础核心包</span><span style="font-size:11px;color:var(--text-dim);margin-left:auto">~93 MB · 2050 文件</span></div>
      </div>
      <div class="mini">
        <h4>两阶段预载（本地）</h4>
        <div class="mrow" style="font-size:12px"><span style="color:var(--mint-400)">✓ 基础包就绪</span><span style="color:var(--text-dim)">·</span><span>⚡ 自动预载中 42%</span></div>
        <div style="height:8px;border:1px solid var(--line-2);background:var(--bg-2);margin:8px 0"><div style="height:100%;width:42%;background:var(--mint-500)"></div></div>
        <div class="mrow"><span class="mbtn mbtn--primary">全量预载 / 管理</span><span class="mbtn">知道了</span></div>
        <p class="note" style="margin-top:8px">Core→Full 自动串行；<b>上游无预载体系</b>，整层保留。</p>
      </div>
    </div>
  </div>
</section>

<!-- ============ ⑤ 归属与接线表 ============ -->
<section class="panel">
  <header class="panel__hd">
    <h2>⑤ 逐屏归属与接线表（合并 Phase 2 依据）</h2>
    <span class="spacer"></span>
    <span class="micro">SOURCE OF TRUTH FOR THE RE-APPLY</span>
  </header>
  <div class="panel__bd">
    <table class="mtx">
      <thead><tr><th style="width:150px">屏幕 / 组件</th><th style="width:120px">归属</th><th style="width:230px">上游 v0.2.2 的关键改动</th><th>合并处置</th></tr></thead>
      <tbody>
        <tr><td class="k">干员调配（列表）</td><td><span class="pill-src pill-src--up">上游结构</span></td><td>一干员一行，列：干员 / 技能 / 模组 / 潜能·练度；旧 <code>.lo-grid</code> 三列卡片删除</td><td><b>取上游</b> <code>screens/loadout.js</code>、<code>loadout.css</code>；本地旧布局弃用</td></tr>
        <tr><td class="k">潜能 / 练度</td><td><span class="pill-src pill-src--up">上游新增</span></td><td>行内两个 <code>select</code> + 详情 <code>.lo-seg--pot/--tier</code>；默认潜能 6 / 精英2 Lv.60；新文件 <code>shared/potential.js</code></td><td><b>取上游</b>；本地无此概念，直接接入</td></tr>
        <tr><td class="k">皮肤 SKIN</td><td><span class="pill-src pill-src--local">本地独有</span></td><td>无（上游 0 个皮肤文件、无 <code>room.skins</code>）</td><td><b>保留并重接</b>：<code>skinPicker.js</code> 段落到详情卡；<code>room.skins</code> 协议与 <code>skinsStore</code> 保留</td></tr>
        <tr><td class="k">自选编队 / 持有</td><td><span class="pill-src pill-src--up">上游结构</span></td><td><code>screens/diy.js</code> picker、<code>room.diy</code> / <code>room.ownership</code>、Esc 关闭修复</td><td><b>取上游</b>；本地同源旧版（blob 溯源为上游旧快照）</td></tr>
        <tr><td class="k">商店栏</td><td><span class="pill-src pill-src--up">上游新增</span></td><td>空栏位 <code>.scard--sold.scard--empty</code>；<code>SOLD OUT</code> 对照</td><td><b>取上游</b>；本地皮肤立绘同步仍是计划，未实现</td></tr>
        <tr><td class="k">战斗内聊天</td><td><span class="pill-src pill-src--local">本地独有</span></td><td>无</td><td><b>保留</b>：<code>ui/chatBox.js</code>、<code>room.chat</code> 协议、<code>.chat-panel</code> 与气泡 CSS</td></tr>
        <tr><td class="k">服务器负载提示</td><td><span class="pill-src pill-src--local">本地独有</span></td><td>无（上游无 <code>loadGuard</code> / <code>MAINTENANCE</code> / <code>BUSY</code>）</td><td><b>保留</b>：<code>ui/serverLoadBadge.js</code>、<code>server/loadGuard.js</code>、<code>Match</code> 节流与 <code>deferFlush</code></td></tr>
        <tr><td class="k">多人匹配 / 大厅</td><td><span class="pill-src pill-src--local">本地独有</span></td><td>上游仅改 <code>server/lobby.js</code> 服务端</td><td><b>保留</b>并重接：<code>matchmaking.js</code> / <code>Matchmaker</code> / <code>MatchmakingModal</code></td></tr>
        <tr><td class="k">资源预载</td><td><span class="pill-src pill-src--local">本地独有</span></td><td>无</td><td><b>保留</b>：<code>ui/preloadModal.js</code>、标题/大厅 pill</td></tr>
        <tr><td class="k">设置 / 标题页脚</td><td><span class="pill-src pill-src--join">两边都动</span></td><td>设置面板壳重排（<code>settings.js</code> / <code>game.css</code>）</td><td><b>取上游壳 + 重接</b>本地两项（动态高刷新率 / 棋盘视角）与页脚 B 站信息</td></tr>
        <tr><td class="k">盟约收起 / 展开</td><td><span class="pill-src pill-src--local">永久黑名单</span></td><td>上游仍带 PR #149（<code>.bonds-toggle</code> / <code>bondsCollapsed</code>）</td><td><b>清除</b>：按 <code>.agents/rules/upstream-sync.md</code> 还原 <code>game.js</code> / <code>game.css</code>，测试保持删除</td></tr>
      </tbody>
    </table>
    <p class="note" style="margin-top:12px"><b>一句话：</b>上游 v0.2.2 拿走「干员调配 + 潜能练度 + 自选 + 空栏位 + toast」的结构；本地留下「皮肤 / 聊天 / 负载提示 / 撮合 / 预载 / 移动端」六层，并把皮肤接进详情卡；PR #149 一律清除。</p>
  </div>
</section>

<div class="foot">
  <span>docs/mockups/merged-ui-reference.png　·　生成：node docs/mockups/render-merged-ui.mjs</span>
  <span>干员数据 data/chess.json　·　立绘/图标 public/assets（真实资源）　·　主题令牌 public/css/theme.css</span>
</div>

</body></html>`;

// ---- 渲染 ---------------------------------------------------------------------------------------
const puppeteer = (await import('puppeteer-core')).default;
if (!CHROME || !existsSync(CHROME)) {
  console.error('未找到 Chrome：请设置 CHROME_PATH 环境变量');
  process.exit(1);
}

const OUT = path.join(HERE, 'merged-ui-reference.png');
// 落成临时 HTML 再 goto：file:// 页面才允许加载 file:// 子资源（立绘/图标），setContent 的 about:blank 会被拦
const TMP = path.join(HERE, '.merged-ui.tmp.html');
writeFileSync(TMP, HTML, 'utf8');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--force-device-scale-factor=1', '--font-render-hinting=none', '--allow-file-access-from-files'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(TMP).href, { waitUntil: 'load' });
  // 等图片（真实立绘/图标）加载完
  await page.evaluate(() => Promise.all(Array.from(document.images).map((im) => im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
  await new Promise((r) => setTimeout(r, 400));
  const info = await page.evaluate(() => {
    const R = (el) => el.getBoundingClientRect();
    const PAGE_W = 1920;
    // 1) 横向溢出 / 出界元素
    const offPage = [];
    for (const el of document.querySelectorAll('.panel *, .foot *')) {
      if (el.classList.contains('callout')) continue;
      const r = R(el);
      if (r.width > 0 && (r.right > PAGE_W - 8 || r.left < 8)) offPage.push(`${el.className || el.tagName}:${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    // 2) 图注圆标：数量 / 尺寸 / 是否落在所属面板内
    const panel = document.querySelector('.panel');
    const pr = R(panel);
    const markers = [...document.querySelectorAll('.marker')].map((m) => {
      const r = R(m);
      return { n: m.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= pr.left && r.right <= pr.right && r.top >= pr.top && r.bottom <= pr.bottom };
    });
    const legendN = document.querySelectorAll('.legend__item').length;
    // 3) 干员行四列对齐（与表头比）
    const colX = (sel) => [...document.querySelectorAll(sel)].map((e) => Math.round(R(e).left));
    const head = colX('.lo-list__head > span');
    const rows = [...document.querySelectorAll('.lo-card')].map((row) => [
      Math.round(R(row.querySelector('.lo-card__pick')).left),
      Math.round(R(row.querySelector('.lo-card__skills')).left),
      Math.round(R(row.querySelector('.lo-card__mods')).left),
      Math.round(R(row.querySelector('.lo-cult')).left),
    ]);
    const colSpread = head.map((h, i) => Math.max(...rows.map((r) => Math.abs(r[i] - h))));
    // 4) 文本被裁切（有 overflow:hidden 且 scrollWidth 超出的元素）
    const clipped = [];
    for (const el of document.querySelectorAll('.panel *')) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
        clipped.push(`${el.className.split(' ')[0]}(${el.scrollWidth}>${el.clientWidth})`);
      }
    }
    return {
      h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth,
      imgs: document.images.length, broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
      panels: document.querySelectorAll('.panel').length,
      offPage: [...new Set(offPage)].slice(0, 12),
      markers, legendN,
      headX: head, colSpread, clipped: [...new Set(clipped)].slice(0, 12),
    };
  });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('== 自检 ==');
  console.log(' 面板:', info.panels, '| 图片:', info.imgs, '| 未加载:', info.broken, '| 页面:', `${info.w}x${info.h}`);
  console.log(' 出界元素:', info.offPage.length ? info.offPage : 'none');
  console.log(' 图注圆标:', info.markers.map((m) => `${m.n}:${m.w}x${m.h}${m.inside ? '' : ' OUT!'}`).join(' '), '| 图例条:', info.legendN);
  console.log(' 表头列 x:', info.headX, '| 各行与表头最大偏差:', info.colSpread);
  console.log(' 文本裁切:', info.clipped.length ? info.clipped : 'none');
} finally {
  await browser.close();
  try { unlinkSync(TMP); } catch { /* ignore */ }
}
const buf = readFileSync(OUT);
console.log(`产物: ${OUT}`);
console.log(`尺寸: ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, ${Math.round(buf.length / 1024)} KB`);
