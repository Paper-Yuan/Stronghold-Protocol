// test/ui/zhajing-adapt.test.js — 炸惊模拟的**双端适配契约**（2026-10-28，T8；2026-10-31 收成「双端同一套版式」）
//
// 真机矩阵 1920×1080 / 1280×720 / 844×390 / 667×375 的截图与断言在 devtools/render-check-zhajing.mjs；这里钉住
// 真机跑一次抓不到的东西：**三选一在哪个断点都不许有第二套版式**（业主 2026-10-31「手机端炸惊三选一要和电脑端
// 显示一致」）、浮层的定位与层级、触摸地板与字号地板、减动效名单，以及「手机上点不到」的那两处
// （房内工具排隐藏后的「规则」、< 520px 高时的按钮尺寸）。
//
// 三选一的等比缩放只有一个变量 --zj-u = min(1rem, 100svh / 10.8)：16:9 的窗口上它恒等于 1rem（桌面一个像素不动），
// 792×360 的手机横屏（1rem 被 40px 地板撑着，只有 9rem 高）才等于 33.3px。所以本文件对 .zjov / .zjcard 的断言只
// 认这一份声明 + 「两个断点里都不许再出现 .zjcard / .zjov__*」。
//
// 读 CSS 用 test/helpers/uiSize.js 的 unscaled()（把 `max(<rem>, calc(Npx * var(--sp-ui,1)))` 写回设计值），
// 所以断言的数字是**设计尺寸**；`--sp-ui` 的缩放因子由 test/ui/ui-size.test.js 单独守。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unscaled } from '../helpers/uiSize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const JIB = read('public/css/screens/jibian.css');
const ROOM = read('public/css/screens/room.css');
const BRIEF = read('public/css/screens/briefing.css');
const CSS = { 'jibian.css': JIB, 'room.css': ROOM, 'briefing.css': BRIEF };

// ---- CSS helpers (the shape of test/ui/ui-size.test.js) --------------------------------------------
/** Every plain rule as [selector, body], comments stripped, @-rule preludes skipped. */
function* cssRules(src) {
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?<=^|[{}])\s*([^{}@]+)\{([^{}]*)\}/g)) {
    yield [m[1].trim().replace(/\s+/g, ' '), m[2]];
  }
}
const rulesFor = (src, sel) => [...cssRules(src)].filter(([s]) => s.split(',').map((x) => x.trim()).includes(sel));
/** The FIRST rule of `sel` in document order — i.e. the base one (the @media overrides come later in the file). */
const ruleOf = (src, sel) => {
  const hits = rulesFor(src, sel);
  assert.ok(hits.length >= 1, `${sel} is declared`);
  return hits[0][1];
};
/** The balanced body of every @media block whose prelude contains `query`. */
function mediaBlocks(src, query) {
  const out = [];
  for (let at = src.indexOf(`@media ${query}`); at > 0; at = src.indexOf(`@media ${query}`, at + 1)) {
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) { out.push(src.slice(open + 1, i)); break; } }
    }
  }
  return out;
}
/** The first @media block of `query` whose body holds `contains`. */
function mediaBlock(src, query, contains) {
  const hit = mediaBlocks(src, query).find((b) => !contains || b.includes(contains));
  assert.ok(hit, `@media ${query} with ${contains}`);
  return hit;
}
/** A declaration's value, unscaled (so a floor reads as its design px). */
function decl(body, prop) {
  const m = body.match(new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([^;}]+)`));
  assert.ok(m, `${prop} is declared`);
  return unscaled(m[1].trim());
}
const px = (v) => Number((v.match(/^(-?[\d.]+)px$/) || [])[1]);
/** A media block without its comments (the prose names selectors; the code is what ships). */
const code = (block) => block.replace(/\/\*[\s\S]*?\*\//g, '');
/** Whether the value is `max(…, <floor>px, …)` — a balanced-paren scan of the argument list, so a nested
 *  `calc(.44 * var(--zj-u))` is read as one argument (an exact `<floor>px` argument is required, never a substring). */
const hasFloor = (v, floor) => {
  const at = v.indexOf('max(');
  if (at < 0) return false;
  const args = [];
  let depth = 0;
  let start = at + 4;
  for (let i = at + 3; i < v.length; i += 1) {
    const ch = v[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) { args.push(v.slice(start, i).trim()); break; }
    } else if (ch === ',' && depth === 1) { args.push(v.slice(start, i).trim()); start = i + 1; }
  }
  return args.includes(`${floor}px`);
};

// =====================================================================================================
// ① 三档断点：桌面 / 窄屏 / 矮屏各自该长什么样
// =====================================================================================================
test('断点矩阵: 1920/1280 走设计值，≤900 宽仍是三张竖卡并排，≤520 高不再改三选一 —— 三档都有对应规则', () => {
  // 桌面：三张竖卡并排、卡片有设计最小高（几何值一律 × --zj-u，16:9 的窗口上 --zj-u 就是 1rem）、揭晓卡有设计宽
  assert.match(decl(ruleOf(JIB, '.zjov__grid--3'), 'grid-template-columns'), /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.equal(decl(ruleOf(JIB, '.zjcard'), 'min-height'), 'calc(2.4 * var(--zj-u))',
    '240 px at 1rem; on a short phone the same declaration scales with --zj-u');
  assert.match(decl(ruleOf(JIB, '.zjrev__box'), 'width'), /min\(5\.2rem, 88vw\)/);
  // ≤900 宽（手机横屏）：浮层铺满；三张竖卡**来自同一套桌面规则**（业主 2026-10-31「不做单独版式」），
  // 所以这一块里只允许「浮层铺满」一条，卡片 / 网格一个都不许改
  const narrow = mediaBlock(JIB, '(max-width: 900px)', '.zjov');
  assert.match(code(narrow), /\.zjov \{ inset: 0; \}/, 'the overlay spans the whole screen (no left rail)');
  assert.doesNotMatch(code(narrow), /\.zjcard|\.zjov__/, 'no phone-only card layout: the cards come from the shared rules');
  // ≤520 高（横屏手机）：三选一一个字都不改（副标题 / flavor / 标题字号都留着），只收揭晓卡、一览与已选面板
  const short = mediaBlock(JIB, '(max-height: 520px)', '.zjrev__box');
  assert.doesNotMatch(code(short), /\.zjov|\.zjcard/, 'the short screen leaves the draft layout alone');
  // 横向永不滚：真放不下时只允许浮层内部竖着滚（业主 2026-10-29）
  const grid = ruleOf(JIB, '.zjov__grid');
  assert.equal(decl(grid, 'overflow-x'), 'hidden');
  assert.equal(decl(grid, 'overflow-y'), 'auto');
  // 标题的地板还在（矮屏不再给它换一档：同一份声明双端共用）
  assert.equal(px(decl(ruleOf(JIB, '.zjov__title'), 'font-size').replace(/^max\(18px, calc\(\.56 \* var\(--t\)\)\)$/, '18px')), 18);
});

// =====================================================================================================
// ①b 双端同一套版式（业主 2026-10-31）：等比缩放只靠 --zj-u，卡内字段与截断规则只有一份
// =====================================================================================================
test('双端一致: 三选一只靠 --zj-u 按可用高度等比缩放，16:9 上等于 1rem；两个断点里没有第二套卡片版式', () => {
  // 单元：min(1rem, 100vh/10.8) + 一条 svh 覆盖（与 theme.css / devices.css 同一套写法）。
  // 1rem 已经是 min(100vw/19.2, 100vh/10.8) 的地板，所以 16:9 上 --zj-u === 1rem，桌面逐像素不变。
  const ov = ruleOf(JIB, '.zjov');
  const unit = [...ov.matchAll(/--zj-u:\s*min\(1rem, calc\((100(?:s)?vh) \/ 10\.8\)\)/g)].map((m) => m[1]);
  assert.deepEqual(unit, ['100vh', '100svh'], 'one height unit, plain vh then the svh override');
  // 每一条几何尺寸都乘这个单元（padding / gap / 图标 / 最小高 / 阴影），而不是 rem 常量
  const card = ruleOf(JIB, '.zjcard');
  assert.match(card, /gap: calc\(\.12 \* var\(--zj-u\)\)/);
  assert.match(card, /padding: calc\(\.18 \* var\(--zj-u\)\) calc\(\.16 \* var\(--zj-u\)\)/);
  // 卡内字段顺序是同一份 DOM（名称 / 稀有度 + 贴图 / 描述 / 惊变羁绊块 / 羁绊提示 / flavor），
  // 截断规则也只有一份：描述与羁绊效果都没有行数钳制、没有 max-height、没有省略号
  for (const sel of ['.zjcard__desc', '.zjcard__bondeffect']) {
    const body = ruleOf(JIB, sel);
    assert.doesNotMatch(body, /line-clamp|max-height|text-overflow|white-space:\s*nowrap/, `${sel} is never clamped`);
  }
  // 整个文件里 -webkit-line-clamp 只出现在「已选惊变」的横行（.zjsel__desc）上，三选一的卡一条都没有
  const clamps = [...JIB.matchAll(/(?<=[{;])\s*([^{};]*)\{[^{}]*-webkit-line-clamp:\s*(\d+)/g)]
    .map((m) => m[1].trim()).filter((s) => !s.includes('.zjsel'));
  assert.deepEqual(clamps, [], 'no clamp outside the 已选惊变 rows');
  // 字段顺序同理：没有任何 display: none 藏在三选一的副标题 / flavor 上（矮屏曾经把它俩藏掉）
  for (const never of ['.zjov__sub', '.zjcard__flavor', '.zjcard__desc', '.zjcard__bondblocks']) {
    assert.ok(!new RegExp(`\\${never}[^{]*\\{[^}]*display: none`).test(JIB), `${never} is never hidden`);
  }
});

test('矮屏（≤520 高）: 让位的是装饰与说明，三选一的信息一条不漏', () => {
  const short = mediaBlock(JIB, '(max-height: 520px)', '.zjrev__box');
  // 让位：只剩揭晓浮层自己的 flavor —— 三选一的副标题与卡面 flavor 自 2026-10-31 起双端都显示（业主：双端一致）
  assert.match(short, /\.zjrev__flavor \{ display: none; \}/);
  // 保留：名字、描述、稀有度、跳过、重抽 —— 它们一个都不能藏
  for (const keep of ['.zjrev__name', '.zjrev__icon', '.zjrev__box']) assert.ok(short.includes(keep), `${keep} stays styled`);
  for (const never of ['.zjov__sub', '.zjcard__flavor', '.zjcard__name', '.zjcard__desc', '.zjcard__reroll', '.zjrev__skip', '.zjcodex__row']) {
    assert.ok(!new RegExp(`\\${never}[^{]*\\{[^}]*display: none`).test(JIB), `${never} is never hidden`);
  }
  // 揭晓卡在矮屏**收窄拉高**（96vw 的横条改成 ~62vw 的竖卡），名字仍有字号地板
  assert.match(short, /\.zjrev__box \{ width: min\(12\.4rem, 62vw\); max-width: none;/, 'narrower than the old 96vw strip');
  assert.match(short, /\.zjrev__icon \{ width: \.96rem; height: \.96rem; \}/);
  assert.match(decl(short.match(/\.zjrev__name \{[^}]*\}/)[0], 'font-size'), /^max\(15px,/);
  // 一览在矮屏用 2rem 列宽（1.4rem 会把四字名字全吃掉）
  assert.match(short, /\.zjcodex__list \{ grid-template-columns: repeat\(auto-fill, minmax\(2rem, 1fr\)\); \}/);
});

test('惊变羁绊块: 名字换行读完、效果全文不截断；长文案只让浮层竖着滚（overflow-x 恒为 0）；面板页签单行', () => {
  // 块结构：一张卡命中几条羁绊就竖排几块（标签 + 名 + 阈值 + 效果）
  const blocks = ruleOf(JIB, '.zjcard__bondblocks');
  assert.equal(decl(blocks, 'display'), 'flex');
  assert.equal(decl(blocks, 'flex-direction'), 'column');
  // 羁绊名（「开始吧，今夜的假面舞会」）整名换行读完，没有省略号、不压成一行
  const name = ruleOf(JIB, '.zjcard__bondname');
  assert.match(decl(name, 'overflow-wrap'), /anywhere/);
  assert.doesNotMatch(name, /text-overflow|white-space:\s*nowrap/);
  // 效果全文：没有行数钳制、没有 max-height、没有省略号（业主 2026-10-29「羁绊文案很长，要能完整读到」）
  const eff = ruleOf(JIB, '.zjcard__bondeffect');
  assert.doesNotMatch(eff, /line-clamp|max-height|text-overflow|white-space:\s*nowrap/);
  assert.equal(decl(eff, 'overflow-wrap'), 'anywhere');
  // 横向永不滚：浮层唯一的滚动容器是 .zjov__grid，且只有竖向
  assert.equal(decl(ruleOf(JIB, '.zjov__grid'), 'overflow-x'), 'hidden');
  assert.equal(decl(ruleOf(JIB, '.zjov__grid'), 'overflow-y'), 'auto');
  // 局内面板是**单行**三页签：一排、不换行（不再有第二层页签）
  assert.equal(decl(ruleOf(JIB, '.zjpanel__tabs'), 'flex-wrap'), 'nowrap');
  assert.equal(decl(ruleOf(JIB, '.zjpanel__tabs'), 'display'), 'flex');
});

test('房内「规则」在矮屏不被工具排吞掉（手机端唯一阅读入口），且给到 24px 触摸地板', () => {
  // 短屏把整个工具排藏了 —— 这是既有设计（统计/设置/说明在手机上另走）
  const short = mediaBlock(ROOM, '(max-height: 520px)', '.rs-tools');
  assert.match(short, /\.rs-tools, \.rs-key__k \{ display: none; \}/);
  // …但炸惊的「规则」必须留下：容器 display:contents（不占盒）+ 只留它一个子元素
  assert.match(short, /\.rs-tools \{ display: contents; \}/);
  assert.match(short, /\.rs-tools > :not\(\[data-testid="zj-rules"\]\) \{ display: none; \}/);
  // 设计系统的 sm 按钮在短屏只有 14px 高（真机实测），给它 24px 地板（本仓小号触摸目标的地板）
  assert.match(short, /\.rs-tools > \[data-testid="zj-rules"\] \{ min-height: max\(\.44rem, 24px\); \}/);
  // 桌面（>520 高）不动：工具排照常整排显示
  assert.equal(mediaBlocks(ROOM, '(max-height: 520px)').filter((b) => b.includes('.rs-tools { display: contents; }')).length, 1);
});

test('已选惊变面板: **横行**（一行一张），描述/羁绊就地省略、全文进 title，面板正文自己竖滚', () => {
  // 容器：一行一张、竖着排（不再是原来的 auto-fill 多列网格 —— 那是竖卡时代的）
  const grid = ruleOf(JIB, '.zjpanel__grid');
  assert.equal(decl(grid, 'display'), 'flex');
  assert.equal(decl(grid, 'flex-direction'), 'column');
  assert.doesNotMatch(grid, /grid-template-columns/, 'one 惊变 per row, never a column of cards');
  // 一行本身是「左图 | 右文」两列（竖卡才是 flex column）：行高由内容决定，没有固定高
  const row = ruleOf(JIB, '.zjsel');
  assert.equal(decl(row, 'display'), 'grid');
  assert.match(decl(row, 'grid-template-columns'), /auto minmax\(0, 1fr\)/);
  assert.doesNotMatch(row, /flex-direction: column|min-height/, 'a row is content-high, never a tall block');
  // 描述：最多两行 + 省略号（全文在 title 上，见 test/ui/zhajing.test.js）；不换行撑高
  const desc = ruleOf(JIB, '.zjsel__desc');
  const clamp = Number((desc.match(/-webkit-line-clamp:\s*(\d+)/) || [])[1]);
  assert.ok(clamp >= 1 && clamp <= 2, `desc is clamped to 1–2 lines (got ${clamp})`);
  assert.match(decl(desc, 'overflow'), /hidden/);
  // 羁绊：名 + tiers 同一行的一枚小片；effect 全文只在 title 里，没有竖卡那种高块
  assert.equal(decl(ruleOf(JIB, '.zjsel__bonds'), 'flex-wrap'), 'nowrap', 'bond name + tiers stay on one line');
  assert.ok(ruleOf(JIB, '.zjsel__bondtiers').includes('flex: none'));
  assert.doesNotMatch(JIB, /\.zjsel__bondeffect/, 'no tall bond-effect paragraph in the row layout');
  // 面板正文是唯一的滚动容器（竖向），横向永不滚
  assert.equal(decl(ruleOf(JIB, '.zjpanel__body'), 'overflow'), 'auto');
  // 敌方页：轮次徽标是行左边的一列（R1 / R6 不再压在卡上方）
  const cell = ruleOf(JIB, '.zjpanel__cell');
  assert.equal(decl(cell, 'display'), 'grid');
  assert.match(decl(cell, 'grid-template-columns'), /auto minmax\(0, 1fr\)/);
  // ≤900 宽（手机，面板只剩 ~336px）：描述与羁绊各占一整行，羁绊名不被省略号吃掉；
  // 带羁绊的行把描述再收到一行，整行压到面板宽度的一半以下（实测 ~62px vs 168px）
  const narrow = mediaBlock(JIB, '(max-width: 900px)', '.zjsel__bonds');
  assert.match(narrow, /\.zjsel__desc \{ flex: 1 1 100%; \}/);
  assert.match(narrow, /\.zjsel__meta--bonds \.zjsel__desc \{ -webkit-line-clamp: 1; line-clamp: 1; \}/);
  assert.match(narrow, /\.zjsel__bonds \{ flex: 1 1 100%; max-width: 100%; \}/);
});

// =====================================================================================================
// ② 触摸地板：手机上每一个"要点的东西"都不低于 32px（业主 2026-10-29 的竖卡改版验收）
// =====================================================================================================
test('触摸地板: 惊变的所有可点元素在 1rem=40px 的手机上也 ≥ 32px', () => {
  // 「已选惊变 / 惊变一览」那两颗 .zjbtn 角标已删（业主 2026-10-29：并进顶栏左上的一颗「模式工具」按钮，其 24px 地板
  // 在 test/ui/mode-tools.test.js 里守，样式在 game.css 而不在本文件扫的 jibian.css）
  // 本轮竖卡改版里的目标：三选一的「重抽」与揭晓的「跳过」，都是 32px 地板（设计值 .44rem，随 --zj-u 缩）
  for (const [sel, prop] of [['.zjcard__reroll', 'min-height'], ['.zjrev__skip', 'min-height']]) {
    const v = decl(ruleOf(JIB, sel), prop);
    assert.ok(hasFloor(v, 32), `${sel} ${prop}: ${v} keeps a 32 px touch floor`);
    assert.ok(v.includes('calc(.44 * var(--zj-u))') || v.includes('.44rem'), `${sel} ${prop}: the design value (.44) is kept as the larger side`);
  }
  // 既有面板 / 状态位不是本轮目标：24px 地板原样保留
  for (const [sel, prop] of [['.zjpanel__x', 'width'], ['.zjpanel__x', 'height'], ['.zjov__state', 'min-height']]) {
    const v = decl(ruleOf(JIB, sel), prop);
    assert.ok(hasFloor(v, 24), `${sel} ${prop}: ${v} keeps its 24 px floor`);
    assert.ok(v.includes('calc(.44 * var(--zj-u))') || v.includes('.44rem'), `${sel} ${prop}: the design value (.44) is kept as the larger side`);
  }
  // 两步确认的「确认选择」在手机上也有 32px 高（.btn--lg 的设计高 .64rem 在 1rem=40px 时只有 25.6px）：
  // 这是**base** 上的一条共用规则（矮屏块不再单独改它 —— 双端同一份声明）
  const confirm = ruleOf(JIB, '.zjov__confirm');
  assert.ok(hasFloor(decl(confirm, 'min-height'), 32), `the confirm key reaches 32 px: ${decl(confirm, 'min-height')}`);
  assert.ok(decl(confirm, 'font-size').startsWith('max(12px,'), 'and keeps a 12 px label floor');
  const shortDraft = mediaBlock(JIB, '(max-height: 520px)', '.zjrev__box');
  assert.doesNotMatch(code(shortDraft), /\.zjov__confirm/, 'the short screen does not restyle the confirm key');
  // 已选惊变面板的页签不是本轮改版的竖卡目标：既有 24px 地板原样保留
  const tab = decl(ruleOf(JIB, '.zjpanel__tab'), 'min-height');
  assert.ok(hasFloor(tab, 24), `.zjpanel__tab: ${tab} keeps its 24 px floor`);
  // 清单页的行不是可点元素（只读），所以不需要地板 —— 但要确认"没有把它做成可点"的样式
  assert.ok(!/\.zjcodex__row[^{]*\{[^}]*cursor: pointer/.test(JIB), 'the codex rows are read-only');
});

// =====================================================================================================
// ③ 字号地板：手机上 1rem 只有 40px，纯比例会掉到 7px
// =====================================================================================================
test('字号地板: 惊变每个文字元素都有 px 地板（11/12/14/15/16/18px 六档），不跟 --sp-ui 缩', () => {
  const sizes = [...JIB.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 30, `${sizes.length} font-size declarations`);
  const bare = sizes.filter((v) => !/^max\(\d+px, calc\([\d.]+ \* var\(--t\)\)\)$/.test(v));
  assert.deepEqual(bare, [], 'every font-size is max(<N>px, calc(k * --t))');
  // 字号地板不许乘 --sp-ui（读性不随 界面大小 缩）—— ui-size.test.js 也守这一条
  assert.deepEqual(sizes.filter((v) => v.includes('--sp-ui')), []);
  // 手机（--t≈40px）下每个地板都真的生效：地板 ≥ 11px
  const floors = sizes.map((v) => Number((v.match(/^max\((\d+)px/) || [])[1]));
  assert.ok(Math.min(...floors) >= 10, `smallest floor ${Math.min(...floors)}px`);
  assert.ok(Math.max(...floors) >= 16, 'the card name / reveal name keep a 15–16 px floor');
});

// =====================================================================================================
// ④ 层级与定位：揭晓在过场板之上、在真弹窗之下；面板是 fixed
// =====================================================================================================
test('层级: 揭晓浮层压过回合/阶段过场板（--z-banner: 40），又低于真弹窗（80）与已选惊变/一览（86）', () => {
  const theme = read('public/css/theme.css');
  const token = (n) => Number((theme.match(new RegExp(`--${n}:\\s*(\\d+)`)) || [])[1]);
  assert.equal(token('z-banner'), 40);
  assert.equal(token('z-modal'), 80);
  const reveal = ruleOf(JIB, '.zjrev');
  const z = Number(decl(reveal, 'z-index'));
  assert.ok(z > token('z-banner'), `reveal ${z} > 过场板 ${token('z-banner')}（否则「回合 01 · 获得」压在卡上，真机截图 zhajing-844x390 就是这么糊的）`);
  assert.ok(z < token('z-modal'), `reveal ${z} < 弹窗 ${token('z-modal')}`);
  assert.equal(decl(reveal, 'position'), 'fixed', 'a full-screen reveal must not be clipped by the game box');
  const panel = ruleOf(JIB, '.zjpanel');
  assert.equal(decl(panel, 'position'), 'fixed');
  assert.ok(Number(decl(panel, 'z-index')) > token('z-modal'), 'the 已选惊变/一览 panels sit above the plates and the modal layer');
  // 三选一留在 .spov（机变）那一层：它与机变占同一个位置，层级也和机变一致
  assert.equal(Number(decl(ruleOf(JIB, '.zjov'), 'z-index')), 21);
  assert.equal(decl(ruleOf(JIB, '.zjov'), 'position'), 'absolute');
  assert.match(decl(ruleOf(JIB, '.zjov'), 'inset'), /0 0 0 calc\(2\.8 \* var\(--zj-u\)\)/, 'it keeps the left rail, like .spov');
});

test('定位: 局内惊变入口是顶栏那一颗「模式工具」按钮（角标已删，不再有 top:92px / right:18px 的挂点）', () => {
  // 旧口径：两颗 .zjbtn 绝对定位在右上（.zjbtn top 92px / .zjbtn--codex 再低一行，窄屏改 bottom 抬起）—— 业主
  // 2026-10-29 已把它们与锻造器合并成顶栏左上难度名右侧的一颗按钮，所以这里只守「角标真的没了」。
  assert.doesNotMatch(JIB, /\.zjbtn/);
  assert.doesNotMatch(read('public/js/screens/game.js'), /JibianButton|JibianCodexButton/);
});

test('揭晓卡在矮屏/长内容下不溢出视口（max-height + 滚动），否则手机上会切掉描述', () => {
  const box = ruleOf(JIB, '.zjrev__box');
  assert.match(decl(box, 'max-height'), /100%/);
  assert.equal(decl(box, 'overflow'), 'auto');
  assert.match(decl(box, 'width'), /min\(5\.2rem, 88vw\)/, 'never wider than the phone');
});

// =====================================================================================================
// ⑤ 减动效：动画声明都在 reduce 块之前，reduce 块点名每一条动效
// =====================================================================================================
test('减动效: 每一条惊变动画都在 reduce 块之前声明，且 reduce 块逐个点名（含敌方揭晓）', () => {
  const reset = JIB.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reset > 0);
  const before = JIB.slice(0, reset);
  const after = JIB.slice(reset);
  // 声明侧：入场 / 翻牌 / 定格三条 keyframes 都在 reduce 之前
  for (const kf of ['@keyframes zjrev-in', '@keyframes zjrev-flick', '@keyframes zjrev-settle']) {
    assert.ok(before.includes(kf), `${kf} is declared before the reset`);
  }
  for (const anim of ['.zjrev__box', '.zjrev.is-spinning .zjrev__name', '.zjrev[data-stage="result"] .zjrev__card']) {
    assert.ok(after.includes(anim), `the reset names ${anim}`);
  }
  assert.match(after, /\.zjrev__box, \.zjrev\.is-spinning \.zjrev__name, \.zjrev\[data-stage="result"\] \.zjrev__card \{ animation: none; \}/);
  assert.match(after, /\.zjrev\.is-spinning \.zjrev__card \{ filter: none; \}/, 'the blur is motion too');
  // 抬升与位移归零
  assert.match(after, /\.zjcard, \.zjcard\.is-pickable:hover \{ transform: none; transition: none; \}/);
  // 顺序就是行为：reduce 之后不许再有（none 之外的）animation 声明
  const lateAnims = [...after.slice(120).matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'none');
  assert.deepEqual(lateAnims, [], 'no animation is re-declared after the reset');
});

// =====================================================================================================
// ⑥ 简报与规则页（本轮唯一新增的两块版面）
// =====================================================================================================
test('简报「玩法包」一节: 阶段名表换行不溢出，名字跟文字大小走且不裁字', () => {
  const phases = ruleOf(BRIEF, '.brief-zj__phases');
  assert.equal(decl(phases, 'flex-wrap'), 'wrap', 'the 10 phase chips wrap instead of pushing the section out');
  const li = ruleOf(BRIEF, '.brief-zj__phases li');
  assert.ok(li.includes('border'), 'each chip is a boxed pill');
  assert.match(decl(ruleOf(BRIEF, '.brief-zj__desc'), 'text-wrap'), /pretty/);
  // 一节都在 .brief 的内容列里（不越出 brief__main 的宽度）
  assert.ok(ruleOf(BRIEF, '.brief-zj').includes('padding'), 'the section keeps the column padding');
});

test('房内规则表: 行是整行文本（可换行），不靠固定高度切字', () => {
  const row = ruleOf(CSS['room.css'], '.zjrules__row');
  assert.match(decl(row, 'line-height'), /1\.6/);
  assert.match(row, /text-wrap: pretty/, '长句换行不留孤儿字');
  const list = ruleOf(CSS['room.css'], '.zjrules__list');
  assert.equal(decl(list, 'display'), 'flex');
  assert.equal(decl(list, 'flex-direction'), 'column');
});

// =====================================================================================================
// ⑦ 真机脚本自身的契约（它不在 CI 里跑，但参数与产物名是验收物）
// =====================================================================================================
test('真机脚本: 四档缺省视口、SP_CHROME/SP_BASE 缺省、截图命名与 RESULT 行', () => {
  const s = read('devtools/render-check-zhajing.mjs');
  assert.match(s, /SP_VIEWPORT \|\| '1920x1080,1280x720,844x390,667x375'/, 'the four-viewport matrix is the default');
  assert.match(s, /SP_CHROME \|\| 'C:\/Users\/J1825\/AppData\/Local\/Google\/Chrome\/Application\/chrome\.exe'/);
  assert.match(s, /SP_BASE \|\| 'http:\/\/127\.0\.0\.1:3020'/);
  assert.match(s, /zhajing-\$\{tag\}-\$\{step\}\.png/, 'screenshots are named zhajing-<w>x<h>-<step>.png');
  assert.match(s, /RESULT:/, 'it prints a RESULT line');
  // 每一步都截了图（真机证据的清单）。业主 2026-10-29：局内不再有「惊变一览」，那一步搬到大堂二级页，
  // 截图名 `theme-codex`（旧名 `codex` 已随局内那一步一起删掉）。
  for (const step of ['lobby', 'hall', 'room', 'rules', 'brief', 'reveal', 'jibian', 'theme-codex', 'panel']) {
    assert.ok(s.includes(`'${step}'`), `it screenshots the ${step} step`);
  }
});
