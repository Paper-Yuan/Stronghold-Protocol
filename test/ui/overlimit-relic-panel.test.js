// test/ui/overlimit-relic-panel.test.js — 超限模拟局内「已选饰品」按钮 + 面板（业主 2026-10-31；入口同日改名）。
//
// 业主口径：**照抄炸惊的「惊变一览」那颗键与面板**，不接在盟约条旁；只 gate 在超限（`m.private.relicsOverlimit`
// 由服务端按 `Match.isInfinite` = shared/infiniteMode.js 的 isInfiniteMode(room.mode) 下发），普通 / 湮灭 / 炸惊
// 一帧不变。业主 2026-10-31 批准两条新 msgid：按钮叫 `t('已选饰品')`（与顶栏老 traits「本局词条」徽标区分，老徽标
// 不动），空态用 `t('还没有选过词条')`（之前借用 `t('无')`）；面板抬头仍是既有 `t('词条')` / `t('关闭')`。
//
// 契约：
//   ① 超限局画那颗键（.gm__gear.gm__relics）、非超限局不画（私有视图没有 relicsOverlimit ⇒ overlimitRelicsOf = null）；
//   ② 角标数字 = picked.length；0 条不画角标（与炸惊 JibianHudButton 同一个取舍：键留着、面板给空态）；
//   ③ 面板列出全部 picked、顺序 = picked 顺序；每行 图标 + 词条名 + 编号 + 分组色条（data-group → --zj-r）；
//   ④ 空 picked 的空态用新 msgid「还没有选过词条」；
//   ⑤ 点击开合（game.js 的开关状态）+ 遮罩 / ✕ / Esc 关闭。
// 视图都是纯函数（与 test/ui/overlimit-relics.test.js 同一套 vnode 读法）；带 hooks 的外壳与接线按源码断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { data } = await import('../../public/js/data.js');
await data.load('relicsOverlimit');
const { OverlimitRelicPanelView, overlimitRelicsOf, pickedRelicRows } = await import('../../public/js/ui/overlimitRelics.js');
const { RelicHudButton } = await import('../../public/js/ui/hud.js');

const ENTRIES = JSON.parse(read('data/relicsOverlimit.json')).entries;
const GAME = read('public/js/screens/game.js');
const RELICS = read('public/js/ui/overlimitRelics.js');
const CSS = read('public/css/screens/game.css');
const OWN_CSS = read('public/css/screens/overlimitRelics.css');
const JIBIAN_CSS = read('public/css/screens/jibian.css');
const VIEWS = read('server/match/player/views.js');

// ---- vnode helpers ----------------------------------------------------------------------------------
// 只走本文件画的纯视图；Img / Icon / GIcon 是带 hooks 的组件，当叶子读 props（与 test/ui/overlimit-relics.test.js 一样）
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

/** 服务端的 `m.private.relicsOverlimit`（server/match/match/relicDraft.js relicsOverlimitView）。 */
const RELIC_VIEW = { picked: ['LC-001', 'FGO-01', 'LC-003'], pool: ['SP-01'], nextAt: [8, 12, 16] };

// =====================================================================================================
// ① 只在超限局渲染：门是 m.private.relicsOverlimit（服务端只对 Match.isInfinite 下发）
// =====================================================================================================
test('① 超限局画「已选饰品」键（.gm__gear.gm__relics），非超限局一帧不变', () => {
  const btn = RelicHudButton({ count: 0, open: false, onClick: () => {} });
  assert.ok(hasClass(btn, 'gm__gear'), '尺寸 / 描边 / 背景全部复用 .gm__gear（32px 地板在 devices.css）');
  assert.ok(hasClass(btn, 'gm__relics'), '自己的按下态与角标类，与 .gm__jibian 同一个写法');
  assert.equal(btn.type, 'button');
  assert.equal(btn.props['data-testid'], 'zj-relics');
  assert.equal(btn.props['aria-label'], '已选饰品', '业主 2026-10-31 定稿的新 msgid（与顶栏老 traits「本局词条」徽标区分）');
  assert.equal(btn.props.title, '已选饰品');
  assert.equal(btn.props['aria-haspopup'], 'dialog');
  assert.equal(btn.props['aria-expanded'], 'false');
  assert.ok(hasClass(RelicHudButton({ count: 0, open: true }), 'is-on'), '开着 = is-on（炸惊那颗的按下态）');

  // 门：只有超限局的私有视图带 relicsOverlimit
  assert.deepEqual(overlimitRelicsOf({ relicsOverlimit: RELIC_VIEW }).picked, RELIC_VIEW.picked);
  assert.equal(overlimitRelicsOf(null), null);
  assert.equal(overlimitRelicsOf(undefined), null);
  assert.equal(overlimitRelicsOf({}), null, '普通 / 湮灭 / 炸惊的私有视图没这个键 → 键与面板都不画');
  assert.equal(overlimitRelicsOf({ jibian: { cards: [] }, relics: { owned: [] }, forge: { count: 1 } }), null, '炸惊 / 湮灭的键都在，也没有词条');
  assert.equal(overlimitRelicsOf({ relicsOverlimit: {} }).picked.length, 0, '形状不对时按空列表走（面板给空态，不炸）');

  // 服务端的 gate 就是这一条（isInfiniteMode(room.mode) → Match.isInfinite）
  assert.match(VIEWS, /this\.m && this\.m\.isInfinite && typeof this\.m\.relicsOverlimitView === 'function'[\s\S]{0,80}relicsOverlimit:/,
    'player/views.js 只在超限局把这把钥匙发给端上');
  assert.match(read('server/match/Match.js'), /this\.isInfinite = isInfiniteMode\(opts\.mode\)/);
  const inf = read('shared/infiniteMode.js');
  assert.match(inf, /mode === SOLO_INFINITE \|\| mode === COOP_INFINITE/);

  // screens/game.js：键挂在左下角那一行（与设置 / 对话 / 惊变同一排），门是 overlimitRelics
  const corner = GAME.slice(GAME.indexOf('<div class="gm__corner">'), GAME.indexOf('<${AiTakeoverPanel} />'));
  assert.ok(corner.includes('<${JibianHudButton}'), '同一排里已经有炸惊那颗键（照抄的邻居）');
  assert.match(corner, /overlimitRelics \? html`<\$\{RelicHudButton\} count=\$\{relicPicked\.length\} open=\$\{relicPanelOpen\}/,
    '超限局才画，且是同一排里的一颗角落键');
  assert.match(GAME, /const overlimitRelics = overlimitRelicsOf\(spectator \? null : priv\);/);
  // 面板同门：overlimitRelics 没了（换模式 / 掉线重连没有 priv）面板跟着不画
  assert.match(GAME, /relicPanelOpen && overlimitRelics \? html`<\$\{OverlimitRelicPanel\} picked=\$\{relicPicked\}/);
});

// =====================================================================================================
// ② 角标数 = picked 长度；0 条不画角标（与炸惊同一个取舍）
// =====================================================================================================
test('② 角标 = 已选条数；0 条不画角标，键仍在（炸惊那颗的取舍）', () => {
  const picked = overlimitRelicsOf({ relicsOverlimit: RELIC_VIEW }).picked;
  assert.equal(picked.length, 3);
  const three = byTestId(RelicHudButton({ count: picked.length }), 'zj-relics-n');
  assert.equal(textOf(three), '3', '徽标数字 = picked.length');
  assert.ok(hasClass(three, 'gm__relics__n') && hasClass(three, 'num'));
  assert.equal(byTestId(RelicHudButton({ count: 0 }), 'zj-relics-n'), undefined, '0 条 → 不画徽标（不画 0）');
  assert.equal(byTestId(RelicHudButton({ count: -5 }), 'zj-relics-n'), undefined, '负数也当 0');
  assert.equal(textOf(byTestId(RelicHudButton({ count: 12 }), 'zj-relics-n')), '12', '两位数原样');
  // 与炸惊那颗逐条对齐（同一个角标量：位置 / 字号 / 行高 / 配色）
  const jibianRule = /\.gm__jibian__n \{[^}]*\}/.exec(CSS)[0];
  const relicRule = /\.gm__relics__n \{[^}]*\}/.exec(CSS)[0];
  assert.equal(relicRule.replace(/__relics__n/, '__X__'), jibianRule.replace(/__jibian__n/, '__X__'),
    '角标规则与 .gm__jibian__n 逐字同量，只换类名');
  assert.equal(/\.gm__relics\.is-on \{[^}]*\}/.exec(CSS)[0].replace('relics', 'X'), /\.gm__jibian\.is-on \{[^}]*\}/.exec(CSS)[0].replace('jibian', 'X'));
  // 接线：count 直接来自 picked.length
  assert.match(GAME, /count=\$\{relicPicked\.length\}/);
  assert.match(GAME, /const relicPicked = overlimitRelics \? overlimitRelics\.picked : \[\];/);
});

// =====================================================================================================
// ③ 面板列出全部 picked，顺序 = picked 顺序（每行 图标 + 名 + 编号 + 分组色条）
// =====================================================================================================
test('③ 面板：全部 picked、顺序稳定、每行图标 / 名 / 编号 / 分组色条', () => {
  const picked = ['LC-001', 'FGO-01', 'LC-003'];
  const tree = OverlimitRelicPanelView({ picked, onClose: () => {} });
  const panel = byTestId(tree, 'overlimit-relic-panel');
  assert.ok(panel, '面板本体');
  assert.ok(hasClass(panel, 'zjpanel'), '外壳就是炸惊面板的 .zjpanel（同一套 .zjpanel__box / __head / __body）');
  assert.ok(hasClass(panel, 'zjpanel--relics'), '词条修饰类（分组色条挂在这下面）');
  assert.equal(panel.props['aria-label'], '词条');
  assert.equal(textOf(byClass(tree, 'zjpanel__title')[0]), '词条', '抬头是既有 msgid');
  assert.equal(textOf(byClass(tree, 'zjpanel__micro')[0]), 'OVERLIMIT // RELICS', '眉题是技术字，不是 i18n 词条');
  assert.equal(textOf(byTestId(tree, 'overlimit-relic-total')), '3', '抬头右侧合计 = 已选条数');

  const rows = byClass(tree, 'zjsel');
  assert.equal(rows.length, 3, 'picked 有几条就有几行');
  assert.deepEqual(rows.map((r) => r.props['data-group']), ['lc', 'fgo', 'lc'], '分组随行下发（数据里的 group）');
  assert.deepEqual(byClass(tree, 'zjsel__name').map(textOf), ['竟然是炎鳞？！', '旧き過去を紡ぐ糸', '要不要来杯震颤爆发？'],
    '词条名逐字来自 data/relicsOverlimit.json，顺序 = picked 顺序');
  assert.deepEqual(byClass(tree, 'zjsel__rarity').map(textOf), picked, '编号是数据，不翻译');
  // 图标：表里每一条都有 icon，画 <img src=数据路径>；行里只有一个 Img
  const imgs = rows.map((r) => find(r, (v) => v.type?.name === 'Img')[0]);
  assert.deepEqual(imgs.map((v) => v.props?.src), picked.map((id) => ENTRIES.find((e) => e.id === id).icon));
  assert.ok(imgs.every((v) => v.props.fallback != null), '每行都带占位符回落（GIcon bolt）');

  // 顺序稳定：反过来传 picked，行序跟着反过来（不排序、不按表里的顺序重排）
  const reversed = OverlimitRelicPanelView({ picked: [...picked].reverse() });
  assert.deepEqual(byClass(reversed, 'zjsel__rarity').map(textOf), [...picked].reverse());
  // 查不到的 id 原样回显（不编名字 / 分组 / 图标）
  const unknown = OverlimitRelicPanelView({ picked: ['LC-999'] });
  assert.equal(textOf(byClass(unknown, 'zjsel__name')[0]), 'LC-999');
  assert.equal(byClass(unknown, 'zjsel')[0].props['data-group'], null);
  const unkImg = find(unknown, (v) => v.type?.name === 'Img')[0];
  assert.equal(unkImg.props.src, null, '没有 icon → src 保持 null，Img 直接落回占位符');
  assert.equal(typeof unkImg.props.fallback, 'object', '占位符 = GIcon bolt（不新增文案 / DOM）');
  // 同一份数据经 pickedRelicRows 还原（game.js 之外唯一的连线点）
  assert.deepEqual(pickedRelicRows(ENTRIES, picked).map((r) => r.id), picked);
});

// =====================================================================================================
// ④ 空 picked 的空态：既有 msgid
// =====================================================================================================
test('④ 空态：一条 picked 都没有时给「还没有选过词条」', () => {
  const tree = OverlimitRelicPanelView({ picked: [] });
  assert.equal(byClass(tree, 'zjsel').length, 0);
  const none = byTestId(tree, 'overlimit-relic-empty');
  assert.ok(none, '空态节点');
  assert.ok(hasClass(none, 'zjpanel__none'), '炸惊面板同一个空态样式');
  assert.equal(textOf(none), '还没有选过词条', '业主 2026-10-31 定稿的新 msgid（之前借的是 t(\'无\')）');
  assert.equal(textOf(byTestId(tree, 'overlimit-relic-total')), '0');
  // 纪律守卫：这两块界面用的每个 msgid 都必须在四语包里真的存在（新批的两条也算在内）
  const used = [...RELICS.matchAll(/(?<![\w$.])t\('([^']+)'\)/g)].map((m) => m[1]);
  const pack = JSON.parse(read('public/i18n/en.json'));
  const strings = pack.strings || pack;
  assert.ok(used.length > 0);
  for (const key of used) assert.ok(Object.prototype.hasOwnProperty.call(strings, key), `t('${key}') 必须是既有 msgid`);
  assert.ok(used.includes('还没有选过词条'), '空态就是那条新 msgid');
});

// =====================================================================================================
// ⑤ 点击开合 / 遮罩 · ✕ · Esc 关闭
// =====================================================================================================
test('⑤ 点击开合：按钮只发开关，面板只报关闭；遮罩 / ✕ / Esc 都能关', () => {
  // 按钮：onClick 原样转发（开合状态在 screens/game.js，与炸惊那颗同一个分法）
  let clicks = 0;
  RelicHudButton({ count: 3, open: true, onClick: () => { clicks += 1; } }).props.onClick();
  assert.equal(clicks, 1);
  assert.equal(RelicHudButton({ count: 3, open: true }).props['aria-expanded'], 'true');
  assert.match(GAME, /onClick=\$\{\(\) => setRelicPanelOpen\(!relicPanelOpen\)\}/, '点一下开、再点一下关');
  assert.match(GAME, /onClose=\$\{\(\) => setRelicPanelOpen\(false\)\}/);

  // 面板：遮罩与 ✕ 都走 onClose
  let closed = 0;
  const onClose = () => { closed += 1; };
  const tree = OverlimitRelicPanelView({ picked: RELIC_VIEW.picked, onClose });
  byClass(tree, 'zjpanel__scrim')[0].props.onClick();
  assert.equal(closed, 1, '点外（遮罩）关闭');
  byTestId(tree, 'overlimit-relic-close').props.onClick();
  assert.equal(closed, 2, '右上角 ✕ 关闭');
  assert.equal(byTestId(tree, 'overlimit-relic-close').props['aria-label'], '关闭');
  assert.equal(byClass(tree, 'zjpanel__box')[0].props.onClick, undefined, '点面板本体不关');

  // Esc：hooks 外壳挂 window 的 keydown（与 ui/jibian.js 的浮层同一写法），卸载时摘掉
  assert.match(RELICS, /export function OverlimitRelicPanel\(/);
  assert.match(RELICS, /window\.addEventListener\('keydown', onKey\)/);
  assert.match(RELICS, /e\.key === 'Escape'[\s\S]{0,40}closeRef\.current\(\)/);
  assert.match(RELICS, /return \(\) => window\.removeEventListener\('keydown', onKey\)/);
  // 词条表到货后重画一次（名字 / 图标 / 分组都在 data/relicsOverlimit.json 里）
  assert.match(RELICS, /useData\('relicsOverlimit'\)/);
});

// =====================================================================================================
// 双端与遮挡：尺寸全部走 jibian.css 的同一套量；矮屏限高、面板不溢出、不压左下角那一排键
// =====================================================================================================
test('双端：版式全部继承炸惊面板（--zj-u / max() 地板），矮屏限高进视口，✕ 有 32px 触控地板', () => {
  // 行 / 壳 / 正文的版式只在 jibian.css 里（本文件不复制第二份），补充表只有三条覆盖
  for (const sel of ['.zjpanel {', '.zjpanel__box {', '.zjpanel__head {', '.zjpanel__body {', '.zjsel {']) {
    assert.ok(JIBIAN_CSS.includes(sel), `${sel} 来自 jibian.css（与炸惊同一套）`);
  }
  assert.doesNotMatch(OWN_CSS, /\.zjsel \{/, '补充表不改行版式本体');
  assert.match(OWN_CSS, /\.gm \.zjpanel--relics \.zjpanel__box \{ max-height: calc\(100dvh - \.6rem\); overflow: hidden; \}/,
    '792×360：外壳限高进视口，正文 .zjpanel__body 自己滚');
  assert.match(JIBIAN_CSS, /\.zjpanel__body \{[^}]*overflow: auto;/);
  assert.match(OWN_CSS, /\.zjpanel--relics \.zjpanel__x \{ width: max\(\.44rem, 32px\); height: max\(\.44rem, 32px\); \}/,
    '唯一的可点件（✕）最小边 32px');
  // 键本身：.gm__gear 的 32px 地板 + devices.css 随界面大小的上限
  assert.match(read('public/css/devices.css'), /\.gm__gear \{ width: max\(\.56rem, 32px, calc\(34px \* var\(--sp-ui, 1\)\)\); height: max\(\.56rem, 32px, calc\(34px \* var\(--sp-ui, 1\)\)\); \}/);
  // 左下角那一排在面板之上（z-index 130 > 86），即使面板铺满也不会把角落键埋掉
  const cornerZ = Number(/\.gm__corner \{ position: absolute;[^}]*z-index: (\d+);/.exec(CSS)[1]);
  const panelZ = Number(/\.zjpanel \{ position: fixed; inset: 0; z-index: (\d+);/.exec(JIBIAN_CSS)[1]);
  assert.ok(cornerZ > panelZ, `角落键 ${cornerZ} 在面板 ${panelZ} 之上`);
  // 分组色条：与本模式三选一卡面的颜色表逐字相同（六个分组，一个不多、一个不少）
  const groupColors = (css, sel) => {
    const out = {};
    for (const chunk of css.split('}')) {
      if (!chunk.includes(sel)) continue;
      const color = /--zj-r: (#[0-9a-f]{6});/.exec(chunk);
      if (!color) continue;
      for (const m of chunk.matchAll(/data-group="?(\w+)"?/g)) out[m[1]] = color[1];
    }
    return out;
  };
  const cards = groupColors(OWN_CSS, '.zjcard[');
  const rows = groupColors(OWN_CSS, '.zjsel[');
  assert.deepEqual(rows, cards, '分组色条与卡面同一套颜色');
  // 七组：饰品六组 + 负面词条那组（neg，业主 2026-10-31 第二批）
  assert.deepEqual(Object.keys(rows).sort(), ['ex', 'fgo', 'fgoSP', 'fgoX', 'lc', 'neg', 'sp'], '六组饰品 + 负面组全覆盖');
  // 与炸惊那颗键的样式同量（位置 / 尺寸都由 .gm__gear 给，自己只加角标）
  assert.equal(/\.gm__relics \{ [^}]*\}/.exec(CSS)[0].replace('relics', 'X'), /\.gm__jibian \{ [^}]*\}/.exec(CSS)[0].replace('jibian', 'X'));
});
