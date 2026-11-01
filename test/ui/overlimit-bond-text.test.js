// 超限盟约文案的数值分色（public/js/ui/overlimitBondText.js）—— 业主 2026-11-01：
//   「超限局内显示盟约时也要按同一规则只强调数值片段」，并且「**分色逻辑只有一份**」，局内不许再写一套。
//
// 这个文件钉住四件事：
//   ① 共享模块的分词边界：25→9999、(1+0.25+0.01×层数) → 2×(…)、(5000+50×层数)+目标当前生命值0.2%、纯描述句 0 个数值节点；
//   ② 局内**超限局**的盟约弹窗（ui/bondStrip.js 的 BondPopup）真的渲染出 `olb-num` 节点；
//   ③ **非超限局**（普通 / 湮灭 / 炸惊）0 个 `olb-num`，而且盟约描述的那个节点与改动前**逐字节相同**
//     （和改动前那一行 `<RichText as="p" text=${desc} class="bpop__desc" />` 的 vnode 做 deepEqual）；
//   ④ 同一个输入字符串，sweep 的强化行与局内的盟约描述渲染出的**片段序列与类名** deepEqual。
//
// 渲染不靠浏览器也不靠 DOM：`OverlimitValueLine` 故意不读 hooks，直接调用组件函数就拿得到 vnode 树，
// 所以下面数的是真实的「文本节点 / olb-num 节点」序列，而不是读源码猜。局内那侧渲染的是**真的 BondPopup**
// （真 data/bonds.json；client data store 走 fetch，这里兜到仓库目录，同 test/i18n-server.test.js 的写法）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const BONDS = JSON.parse(read('data/bonds.json'));
const REAL_FETCH = globalThis.fetch;

const { overlimitValueSegments, OverlimitValueLine, OVERLIMIT_NUM_CLASS } = await import('../../public/js/ui/overlimitBondText.js');
const { richTextPlain } = await import('../../public/js/ui/richText.js');
const { RichText } = await import('../../public/js/ui/gameComponents.js');
const { html } = await import('../../public/js/ui/components.js');
const { overlimitBondView } = await import('../../public/js/screens/sweep.js');

let bondMod;
let bondDescNode;

before(async () => {
  // client data store 是单例、走 fetch 读 data/：把 fetch 兜到仓库目录（与 test/i18n-server.test.js 同一套）
  globalThis.fetch = async (url) => {
    const abs = path.join(ROOT, String(url).replace(/^\//, ''));
    if (!existsSync(abs)) return { ok: false, status: 404, json: async () => null };
    const text = readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
  const { data } = await import('../../public/js/data.js');
  await data.loadAll('config', 'chess', 'bonds', 'assets');
  bondMod = await import('../../public/js/ui/bondStrip.js');
  bondDescNode = bondMod.bondDescNode;
});
after(() => { globalThis.fetch = REAL_FETCH; });

// ---- vnode helpers (no DOM: htm/preact vnodes are plain objects) ---------------------------------------

/** 一个 vnode 的直接子节点，拍平成一维。 */
function kids(v) {
  const c = v && v.props ? v.props.children : null;
  if (c == null || typeof c === 'boolean') return [];
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x) => x != null && typeof x !== 'boolean');
}

/** 深度遍历 vnode 树（不调用组件：RichText / OverlimitValueLine 都是 vnode 的 type）。 */
function walk(v, out = []) {
  if (!v || typeof v === 'string' || typeof v === 'number') return out;
  out.push(v);
  for (const k of kids(v)) walk(k, out);
  return out;
}

/**
 * 归一化：一串子节点 → 真实的节点序列。
 *   { kind: 'text', text }  纯文本节点（没有类名 —— 「整句都在强调节点里」因此不可能）
 *   { kind: 'num',  text }  `olb-num` 强调节点
 *   { kind: 'br' }          换行
 * 任何别的元素都会以 kind: 'element:<tag>' 出现（本组件不该产生）。
 */
function nodesOf(children) {
  const out = [];
  const push = (c) => {
    if (Array.isArray(c)) { c.forEach(push); return; }
    if (c == null || typeof c === 'boolean') return;
    if (typeof c === 'string' || typeof c === 'number') { out.push({ kind: 'text', text: String(c) }); return; }
    const cls = c.props && typeof c.props.class === 'string' ? c.props.class : null;
    if (c.type === 'br') { out.push({ kind: 'br' }); return; }
    if (cls && cls.split(/\s+/).includes(OVERLIMIT_NUM_CLASS)) {
      out.push({ kind: 'num', text: kids(c).join('') });
      return;
    }
    out.push({ kind: `element:${String(c.type)}`, text: kids(c).join('') });
  };
  push(children);
  return out;
}

/** 渲染一次共享组件（props 就是各调用方传的那些）；返回归一化后的节点序列。 */
const renderLine = (vnode) => nodesOf(vnode.type(vnode.props).props.children);

/** vnode 的结构（type + props），用于「与改动前逐字节相同」的 deepEqual。 */
function shape(v) {
  const props = { ...(v.props || {}) };
  if (props.children == null) delete props.children;
  return { type: v.type, key: v.key ?? null, props };
}

/** 节点序列按顺序拼回明文（br → \n）。 */
const textOfNodes = (nodes) => nodes.map((n) => (n.kind === 'br' ? '\n' : n.text)).join('');

const DESC = (bondId) => BONDS[bondId].descRaw || BONDS[bondId].desc;

/** 局内那一侧：真的 BondPopup，取出「盟约效果」的描述节点（props.text 就是 descRaw 的那个 bpop__desc）。 */
function popupDescNode(bondId, overlimit) {
  const desc = DESC(bondId);
  const pop = bondMod.BondPopup({
    bondId, entry: null, priv: { board: [], hand: [] }, onClose() {},
    ...(overlimit === undefined ? {} : { overlimit }),
  });
  const nodes = [...walk(pop)].filter((v) => typeof v.props?.class === 'string'
    && v.props.class.split(/\s+/).includes('bpop__desc') && v.props.text === desc);
  assert.equal(nodes.length, 1, `${bondId}: 盟约效果的描述节点只有一个`);
  return nodes[0];
}

const NUMS_OF = (line) => overlimitValueSegments(line).filter((s) => s.num).map((s) => s.text);

// ---- ① 分词 -------------------------------------------------------------------------------------------

test('超限文案分词：一个数值片段 = 一个值表达式（范围 / 括号式子 / +目标当前生命值0.2% / 纯描述句 0 个）', () => {
  // 原版数字 → 超限数字（萨尔贡「至多叠 25 层」改成 9999）：三段各自是一个数
  assert.deepEqual(NUMS_OF('攻击速度+12（至多叠25层）改为至多叠9999层'), ['+12', '25', '9999']);

  // 25→9999：`→` 是范围连接符，整段算一个数（不是两个）
  assert.deepEqual(overlimitValueSegments('攻击力叠层上限由 25→9999'), [
    { text: '攻击力叠层上限由 ', num: false },
    { text: '25→9999', num: true },
  ]);

  // (1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)：卡西米尔【突袭】乘区那一整段
  const range = '(1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)';
  assert.deepEqual(NUMS_OF(`攻击力翻倍（${range}）`), [range]);

  // (5000+50×层数)+目标当前生命值0.2%：式子本身是一个数，`+目标当前生命值` 是描述（不染色），末尾 0.2% 又是一个数
  assert.deepEqual(overlimitValueSegments('造成(5000+50×层数)+目标当前生命值0.2%点真实伤害'), [
    { text: '造成', num: false },
    { text: '(5000+50×层数)', num: true },
    { text: '+目标当前生命值', num: false },
    { text: '0.2%', num: true },
    { text: '点真实伤害', num: false },
  ]);

  // 纯描述句：0 个数值节点（整句就是正文，一个强调节点都不该有）
  const prose = '战斗开始时，【阿戈尔】干员会吞噬身前一格干员并获得其阻挡数。';
  assert.deepEqual(overlimitValueSegments(prose), [{ text: prose, num: false }]);
  const proseNodes = renderLine({ type: OverlimitValueLine, props: { text: prose } });
  assert.equal(proseNodes.filter((n) => n.kind === 'num').length, 0, '纯描述句 0 个数值节点');
  assert.deepEqual(proseNodes, [{ kind: 'text', text: prose }], '整句就是一个纯文本节点');

  // 单独出现的「层数」是描述词、不是数值（只有式子里的因子才染色）
  for (const s of ['（受层数影响）', '层数', '（最终加算，不受攻击力加成影响）']) assert.deepEqual(NUMS_OF(s), [], s);

  // 官方样式标记先剥成明文再切：`<@ba.vup>+15%</>` 里的 +15% 照染，标记本身不留在文本里
  const marked = '攻击力<@ba.vup>+15%</><@autochess.gray>（受层数影响）</>';
  assert.deepEqual(overlimitValueSegments(marked), [
    { text: '攻击力', num: false },
    { text: '+15%', num: true },
    { text: '（受层数影响）', num: false },
  ]);

  // 只切不改字：片段拼回去逐字等于明文
  for (const line of [marked, range, '造成(5000+50×层数)+目标当前生命值0.2%点真实伤害']) {
    assert.equal(overlimitValueSegments(line).map((s) => s.text).join(''), richTextPlain(line), line);
  }

  // 换行是 <br>，不会被并进某个数值节点（局内的描述是多行的）
  assert.deepEqual(renderLine({ type: OverlimitValueLine, props: { text: '第一行+50%\n第二行 6 名' } }), [
    { kind: 'text', text: '第一行' },
    { kind: 'num', text: '+50%' },
    { kind: 'br' },
    { kind: 'text', text: '第二行 ' },
    { kind: 'num', text: '6' },
    { kind: 'text', text: ' 名' },
  ]);
});

// ---- ② 局内 · 超限局 ------------------------------------------------------------------------------------

test('局内超限局：BondPopup 的盟约描述走共享组件，数值片段是 olb-num 节点', () => {
  for (const bondId of ['lateranoShip', 'yanShip', 'siracusaShip', 'kazimierzShip']) {
    const desc = DESC(bondId);
    const node = popupDescNode(bondId, true);
    assert.equal(node.type, OverlimitValueLine, `${bondId}: 描述节点就是共享组件（局内没有第二套）`);
    assert.equal(node.props.class, 'rt bpop__desc', `${bondId}: 版式类名仍是弹窗自己的（.rt 与 RichText 一致）`);
    assert.equal(node.props.text, desc, `${bondId}: 渲染的还是数据里那段原文`);
    const nodes = renderLine(node);
    const want = NUMS_OF(desc);
    assert.ok(want.length > 0, `${bondId}: 这条盟约的描述里有数值`);
    assert.deepEqual(nodes.filter((n) => n.kind === 'num').map((n) => n.text), want, `${bondId}: olb-num 节点与分词一一对应`);
    assert.ok(want.every((s) => /\d/.test(s)), `${bondId}: 只有含数字的片段被染色`);
    // 「只强调数值片段」：正文文本节点存在、不带类名、不含数字；拼回去不丢字
    const text = nodes.filter((n) => n.kind === 'text');
    assert.ok(text.length > 0, `${bondId}: 有正文文本节点（不是整句都在强调节点里）`);
    assert.ok(text.every((n) => !/\d/.test(n.text)), `${bondId}: 正文节点里没有数字`);
    assert.equal(textOfNodes(nodes), richTextPlain(desc), `${bondId}: 不丢字、换行也没丢`);
  }
  // 当前效果那一块不动（业主这一单点名的是「盟约描述」）：仍是 RichText
  const pop = bondMod.BondPopup({ bondId: 'lateranoShip', entry: null, priv: { board: [], hand: [] }, onClose() {}, overlimit: true });
  const sections = [...walk(pop)].filter((v) => typeof v.props?.class === 'string'
    && v.props.class.split(/\s+/).includes('bpop__desc'));
  assert.equal(sections.length, 2, '两块描述：当前效果 + 盟约效果');
  assert.equal(sections[0].type, RichText, '当前效果仍是 RichText（不在这一单的范围）');
  assert.equal(sections[1].type, OverlimitValueLine, '盟约效果是共享组件');
});

// ---- ③ 非超限局 -----------------------------------------------------------------------------------------

test('非超限局（普通 / 湮灭 / 炸惊）：0 个 olb-num，描述节点与改动前逐字节相同', () => {
  const MODES = [['普通（不传 prop）', undefined], ['湮灭', false], ['炸惊', false]];
  const ids = Object.keys(BONDS).filter((k) => BONDS[k] && BONDS[k].bondId && BONDS[k].descRaw
    && BONDS[k].zjOnly !== true && BONDS[k].annOnly !== true).slice(0, 8);
  assert.ok(ids.length >= 5, '挑到几条官方盟约');
  for (const bondId of ids) {
    const desc = DESC(bondId);
    for (const [mode, overlimit] of MODES) {
      const node = popupDescNode(bondId, overlimit);
      // 与改动前那一行 deepEqual：同一个组件（RichText）、同一组 props —— 渲染出来的 DOM 不可能变
      assert.deepEqual(shape(node), shape(html`<${RichText} as="p" text=${desc} class="bpop__desc" />`), `${bondId} ${mode}: 描述节点 = 改动前`);
      // 整个弹窗里一个 olb-num 都没有、也根本不渲染共享组件
      const pop = bondMod.BondPopup({ bondId, entry: null, priv: { board: [], hand: [] }, onClose() {}, ...(overlimit === undefined ? {} : { overlimit }) });
      assert.deepEqual([...walk(pop)].filter((v) => typeof v.props?.class === 'string' && v.props.class.includes(OVERLIMIT_NUM_CLASS)), [],
        `${bondId} ${mode}: 0 个 olb-num`);
      assert.ok(![...walk(pop)].some((v) => v.type === OverlimitValueLine), `${bondId} ${mode}: 不渲染共享组件`);
    }
  }
  // 判据是既有的 m.public.isInfinite（只有超限局为真）；局内那一行就用它
  assert.match(read('public/js/screens/game.js'), /overlimit=\$\{!!pub\?\.isInfinite\}/, '局内按 m.public.isInfinite 判超限');
  assert.match(read('public/js/ui/bondStrip.js'), /\$\{bondDescNode\(b\.descRaw \|\| b\.desc, overlimit\)\}/, '盟约描述就是这个节点');
});

// ---- ④ 两处一致性 ---------------------------------------------------------------------------------------

test('两处一致性：同一条文案，sweep 与局内渲染出的片段序列与类名 deepEqual', () => {
  const inf = Object.keys(BONDS).filter((k) => BONDS[k] && BONDS[k].inf);
  assert.equal(inf.length, 8, '八条 inf 覆盖块');
  for (const bondId of inf) {
    // sweep 渲染的是「超限模拟」那一行，局内渲染的是整段 descRaw —— 两种文案都必须在两处切得一样
    for (const text of [overlimitBondView(BONDS[bondId], true).changes[0], DESC(bondId)]) {
      assert.ok(typeof text === 'string' && text.length > 0, `${bondId}: 有文案`);
      // sweep 侧：BondPanel 的 ValueLine 就是这一句（外层是自己的版式类名 .sw-inf__line）
      const sweepNodes = renderLine({ type: OverlimitValueLine, props: { text, class: 'sw-inf__line' } });
      // 局内侧：BondPopup 的盟约描述入口（真的那条分支），外层是 .rt .bpop__desc
      const gameNodes = renderLine(bondDescNode(text, true));
      assert.deepEqual(gameNodes, sweepNodes, `${bondId}: 片段序列与类名完全相同`);
      assert.ok(sweepNodes.some((n) => n.kind === 'num'), `${bondId}: 两处都染了同一批数值`);
    }
  }
  // 两处的外层类名各不相同（版式归各页面），里层节点完全一致 —— 这正是「分色逻辑只有一份」
  assert.equal(renderLine({ type: OverlimitValueLine, props: { text: NUMS_OF(DESC('yanShip'))[0] } }).length, 1);
  assert.match(read('public/js/screens/sweep.js'), /<\$\{OverlimitValueLine\} text=\$\{text\} class="sw-inf__line" \/>/);
  assert.match(read('public/js/ui/bondStrip.js'), /html`<\$\{OverlimitValueLine\} text=\$\{text\} class="rt bpop__desc" \/>`/);
});

// ---- 分色逻辑只有一份 -----------------------------------------------------------------------------------

test('分色逻辑只有一份：唯一的分词 / 唯一的渲染 / 唯一的一条颜色规则', () => {
  const files = (rel, ext) => {
    const out = [];
    const rec = (dir) => {
      for (const name of readdirSync(path.join(ROOT, dir))) {
        const child = `${dir}/${name}`;
        if (statSync(path.join(ROOT, child)).isDirectory()) rec(child);
        else if (name.endsWith(ext)) out.push(child);
      }
    };
    rec(rel);
    return out;
  };
  const jsFiles = files('public/js', '.js');
  assert.deepEqual(jsFiles.filter((f) => /export function overlimitValueSegments/.test(read(f))),
    ['public/js/ui/overlimitBondText.js'], '分词只在一个文件里定义');
  assert.deepEqual(jsFiles.filter((f) => /export function OverlimitValueLine/.test(read(f))),
    ['public/js/ui/overlimitBondText.js'], '渲染只在一个文件里定义');
  assert.deepEqual(jsFiles.filter((f) => /'olb-num'|"olb-num"/.test(read(f))),
    ['public/js/ui/overlimitBondText.js'], '类名字面量只有一处');
  assert.equal((read('public/js/ui/overlimitBondText.js').match(/export function overlimitValueSegments/g) || []).length, 1);

  // CSS：全仓只有一条 .olb-num 颜色规则，在与上下文无关的共享类里（components.css）；两个页面都不复制第二条
  const cssFiles = files('public/css', '.css');
  assert.deepEqual(cssFiles.filter((f) => /\.olb-num\s*\{[^}]*color:/.test(read(f))),
    ['public/css/components.css'], '颜色规则只有一份');
  assert.equal((read('public/css/components.css').match(/\.olb-num\s*\{/g) || []).length, 1);
  assert.match(read('public/css/components.css'), /\.olb-num \{ color: var\(--mint-400\); \}/);
  for (const f of ['public/css/screens/sweep.css', 'public/css/screens/game-panels.css']) {
    assert.doesNotMatch(read(f), /\.olb-num\s*\{/, `${f}: 不复制第二条颜色规则`);
    assert.doesNotMatch(read(f), /sw-bond__num/, `${f}: 旧的私有强调类名已移除`);
  }
  // 正文色不动：数值节点以外仍是 .bpop__desc 自己的正文色
  assert.match(read('public/css/screens/game-panels.css'),
    /\.bpop__desc \{ font-size: calc\(\.15 \* var\(--t\)\); line-height: 1\.7; color: var\(--text-md\); \}/);
});
