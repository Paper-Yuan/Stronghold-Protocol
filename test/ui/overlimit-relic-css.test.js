// test/ui/overlimit-relic-css.test.js — 超限词条三选一浮层的**样式加载顺序**（业主 2026-10-31 实机 bug 的回归）。
//
// 实机现象（冷启动路径）：超限局里第一次遇到词条三选一，浮层**完全没有版式** —— 只有 220px 高，三张卡是 33px
// 的横条、几乎看不见。开过一次炸惊惊变再回大厅就正常。
//
// 根因：`.zjov` / `.zjcard` 的全部版式与 `--zj-u` 缩放都在 css/screens/jibian.css 里，而那份 CSS 是**按需加载**的
// —— 只有 JibianDraftView / JibianPanel / EnemyJibianRevealView 画过（ui/jibian.js 的 ensureCss）它才进 DOM；
// ui/overlimitRelics.js 的 ensureRelicCss 原来只挂自己的 overlimitRelics.css（那只是覆盖补充，没有 @import），
// public/index.html 也没有全局引用 jibian.css。于是「本局没开过炸惊」时两条链都不成立 → 浮层裸奔。
//
// 本测试盯的就是这条链：**画超限词条浮层**这一个动作，必须让 jibian.css 的 <link> 出现在 <head> 里，并且排在
// overlimitRelics.css **之前**（后者是覆盖补充，顺序反了基本版式会把补充盖掉）。node 测试环境本来没有 DOM，
// 所以这里装一个最小假 document，直接观察 loader 的真实副作用；不依赖先画过惊变浮层。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// 浏览器数据层在 Node 里读真实数据文件（卡面渲染会用到）
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { OverlimitRelicDraftView, ensureRelicCss } = await import('../../public/js/ui/overlimitRelics.js');
const { ensureJibianCss } = await import('../../public/js/ui/jibian.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');

/** 最小假 document：只实现 loader 用到的那几样（head.appendChild / createElement / querySelector('link[data-*]')）。 */
function installFakeDom() {
  const links = [];
  const doc = {
    head: { appendChild(node) { links.push(node); return node; } },
    createElement(tag) { return { tagName: String(tag).toUpperCase(), rel: '', href: '', dataset: {} }; },
    querySelector(sel) {
      const m = /link\[data-([\w-]+)\]/.exec(String(sel));
      if (!m) return null;
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // data-x-y → dataset.xY
      return links.find((l) => l.dataset && l.dataset[key]) || null;
    },
  };
  return { doc, links };
}

/** 服务端发来的词条三选一（solo → untimed，轮到我）。 */
const draft = () => normalizeSp({
  family: 'overlimit', relicKind: 'lc', round: 3, untimed: true, turn: 'me', order: ['me'], picks: {},
  cards: [
    { idx: 0, kind: 'overlimit', id: 'LC-001', name: '竟然是炎鳞？！', desc: '甲', group: 'lc', impl: 'pending' },
    { idx: 1, kind: 'overlimit', id: 'LC-002', name: '红绵花不是白棉花', desc: '乙', group: 'lc', impl: 'pending' },
    { idx: 2, kind: 'overlimit', id: 'LC-003', name: '要不要来杯震颤爆发？', desc: '丙', group: 'lc', impl: 'pending' },
  ],
});

// 注意顺序：这条必须是本文件**第一个**画浮层的测试 —— loader 的 cssLoaded 是模块级一次性的，
// 只有「冷启动」的那一次调用能证明「画词条浮层会把 jibian.css 拉进来」。
test('冷启动：画词条浮层这一步就把 jibian.css 挂进 <head>，且排在 overlimitRelics.css 之前', () => {
  const { doc, links } = installFakeDom();
  const prevDocument = globalThis.document;
  globalThis.document = doc;
  try {
    // 冷启动：此前没有任何惊变浮层 / 面板被画过（jibian.css 不在 DOM 里），直接画词条三选一
    const view = OverlimitRelicDraftView({ sp: draft(), myId: 'me', solo: true });
    assert.ok(view, '浮层本体被画出来');
    // 幂等：再画一次不重复插 link
    OverlimitRelicDraftView({ sp: draft(), myId: 'me', solo: true });
    ensureRelicCss();
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }

  assert.deepEqual(
    links.map((l) => l.href),
    ['/css/screens/jibian.css', '/css/screens/overlimitRelics.css'],
    '画超限词条浮层 ⇒ 先有 jibian.css（版式本体）、再有 overlimitRelics.css（覆盖补充），各一次',
  );
  assert.equal(links[0].rel, 'stylesheet');
  assert.equal(links[0].dataset.jibian, '1', '复用 ui/jibian.js 的 loader —— 同一个标记，不与它的去重打架');
  assert.equal(links[1].dataset.overlimitRelics, '1');
});

test('加载器不复制第二份：overlimitRelics.js 复用 ui/jibian.js 导出的 ensureJibianCss', () => {
  const src = read('public/js/ui/overlimitRelics.js');
  assert.match(src, /import \{ ensureJibianCss \} from '\.\/jibian\.js';/, '走 jibian.js 的导出，而不是自己写一份 loader');
  assert.equal(/link\.href = '\/css\/screens\/jibian\.css'/.test(src), false, 'jibian.css 的地址只在 ui/jibian.js 里出现一次');
  assert.match(src, /ensureRelicCss\(\) \{[\s\S]*ensureJibianCss\(\)[\s\S]*overlimitRelics\.css/,
    'ensureRelicCss 里先 ensureJibianCss()，再挂自己的补充表');
  // 导出确实存在（jibian.js 的 ensureCss 以 ensureJibianCss 的名字外供）
  const jibian = read('public/js/ui/jibian.js');
  assert.match(jibian, /export \{ ensureCss as ensureJibianCss \}/);
  assert.equal(typeof ensureJibianCss, 'function');
  assert.equal(typeof ensureRelicCss, 'function');
});

test('依赖是真的：.zjov / .zjcard 的版式只由 jibian.css 定义，补充表自己没有 @import', () => {
  const jibianCss = read('public/css/screens/jibian.css');
  assert.match(jibianCss, /^\.zjov \{/m, '浮层壳');
  assert.match(jibianCss, /^\.zjcard \{/m, '卡面');
  assert.match(jibianCss, /--zj-u:/, '缩放进位也在这份文件里');
  const own = read('public/css/screens/overlimitRelics.css');
  assert.doesNotMatch(own, /@import/, '补充表不会自己把基本版式拉进来 —— 所以必须由 loader 先挂 jibian.css');
  assert.match(own, /\.zjov--relic/, '补充表只写词条专属的那几条覆盖');
  // 两份文件都在（静态检查里 HTML 不引用它们，全靠 loader）
  assert.doesNotMatch(read('public/index.html'), /jibian\.css|overlimitRelics\.css/, 'index.html 不全局引用 —— 全靠按需 loader');
});
