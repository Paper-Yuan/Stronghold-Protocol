// test/ui/overlimit-relics.test.js — 超限「词条」三选一浮层（业主 2026-10-31）。
//
// 契约：
//   * 它骑在**既有的 SP_DRAFT** 上（`m.public.sp.family === 'overlimit'`），选卡还是 `g.choice { idx }`；
//   * 版式复用炸惊惊变那一套 `.zjov` / `.zjcard`（css/screens/jibian.css + 极小的 overlimitRelics.css），
//     所以这里断言的 class 与惊变浮层是同一族，--zj-u 的缩放也一起继承；
//   * 卡面：名称 / 编号 / 效果（RichText，props.text 逐字）/ 风味 / 图标占位 / 未实装角标；
//   * 没有重抽按钮（业主定稿：不重掷、无 reroll）。
// 纯视图当函数画（与 test/ui/zhajing.test.js 同一套 vnode 读法）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { OverlimitRelicDraftView, pickedRelicRows } = await import('../../public/js/ui/overlimitRelics.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');
const { isOverlimitRelicDraft, phaseBanner, prepCapsuleLabel } = await import('../../public/js/ui/gameLogic/phases.js');
const { PHASE } = await import('../../shared/constants.js');

// ---- vnode helpers ----------------------------------------------------------------------------------
const PLAIN = ['RelicCard', 'Tile', 'Section', 'Hero'];
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && PLAIN.includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

/** 服务端发来的词条三选一（solo → untimed，轮到我）。 */
const draft = (over = {}) => normalizeSp({
  family: 'overlimit', relicKind: 'lc', round: 3, untimed: true, turn: 'me', order: ['me'], picks: {},
  cards: [
    { idx: 0, kind: 'overlimit', id: 'LC-001', name: '竟然是炎鳞？！', desc: '目标处于[灼燃爆发]期间，我方单位对其造成的伤害按 50% 累积。', flavor: '烧伤和灼燃很像吧？那就烧起来！', group: 'lc', impl: 'pending', icon: '/assets/relics/overlimit/LC-001.png' },
    { idx: 1, kind: 'overlimit', id: 'LC-002', name: '红绵花不是白棉花', desc: '我方单位每次造成伤害后，为目标附加 1 层持续 20 秒的[流血]。', flavor: '来点流血笑话，兄弟们', group: 'lc', impl: 'pending' },
    { idx: 2, kind: 'overlimit', id: 'LC-003', name: '要不要来杯震颤爆发？', desc: '我方单位每对目标施加 1 个负面效果，其[震颤] +1 层。', group: 'lc', impl: 'pending' },
  ],
  ...over,
});

test('词条三选一：三张竖卡（名 / 编号 / 效果 / 风味），未实装角标，两段式确认', () => {
  const tapped = [];
  const sp = draft();
  const view = (o = {}) => OverlimitRelicDraftView({ sp, myId: 'me', solo: true, onTap: (i) => tapped.push(i), ...o });

  const tree = view();
  const ov = byClass(tree, 'zjov')[0];
  assert.ok(ov, '浮层本体是 .zjov（与惊变同一个壳）');
  assert.ok(hasClass(ov, 'zjov--relic'), '带词条专用修饰类（分组色条 + 角标规则挂在这下面）');
  assert.equal(textOf(byClass(tree, 'zjov__title')[0]), '词条抉择', '标题用既有 msgid');
  assert.equal(textOf(byClass(tree, 'zjov__micro')[0]), 'OVERLIMIT // RELIC');

  const cards = byClass(tree, 'zjcard');
  assert.equal(cards.length, 3, '三选一');
  assert.deepEqual(cards.map((c) => c.props['data-group']), ['lc', 'lc', 'lc'], '分组随卡下发（服务端 card.group）');
  assert.deepEqual(find(tree, (v) => v.props?.['data-testid'] === 'relic-card-0').length, 1);
  assert.equal(textOf(byClass(tree, 'zjcard__name')[0]), '竟然是炎鳞？！');
  assert.equal(textOf(byClass(tree, 'zjcard__rarity')[0]), 'LC-001', '编号是数据，不翻译');
  assert.equal(byClass(tree, 'zjcard__desc')[0].props.text, '目标处于[灼燃爆发]期间，我方单位对其造成的伤害按 50% 累积。', '效果全文交给 RichText');
  assert.equal(textOf(byClass(tree, 'zjcard__flavor')[0]), '烧伤和灼燃很像吧？那就烧起来！');

  // 图标（业主 2026-10-31 解图）：有 icon 就画 <img src=数据路径>；没有 icon 的卡仍然只画占位符（同一个 Img 的 fallback）。
  const imgs = find(tree, (v) => v.type?.name === 'Img');
  assert.equal(imgs.length, 3, '每张卡一个 Img（有图 → <img>，无图 → 占位符 fallback）');
  assert.equal(imgs[0].props.src, '/assets/relics/overlimit/LC-001.png', '图标路径原样来自数据（服务端 card.icon）');
  assert.equal(imgs[1].props.src, null, '表里没图的卡不硬塞路径：src 保持 null → 落回占位符');
  assert.equal(typeof imgs[1].props.fallback, 'object', '占位符还是原来那个 GIcon（不新增文案 / DOM）');

  // 未实装角标：pending 的卡各一枚，文案是既有 msgid（新字面量要先报业主）
  const badges = byClass(tree, 'zjcard__pending');
  assert.equal(badges.length, 3);
  assert.equal(textOf(badges[0]), '暂不可用');
  assert.equal(byTestId(tree, 'relic-pending-1') != null, true, '每张卡各自的 testid');

  // 没有重抽按钮（业主定稿：不重掷、无 reroll）
  assert.equal(byClass(tree, 'zjcard__reroll').length, 0);

  // 两段式：armed 的卡抬起 + 确认键
  const armed = view({ armed: 1 });
  assert.equal(byClass(armed, 'zjcard')[1].props.class.includes('is-armed'), true);
  assert.equal(byClass(armed, 'zjcard')[0].props.class.includes('is-armed'), false);
  assert.equal(textOf(byClass(armed, 'zjcard__confirm')[0]), '确认选择再次点击');
  assert.equal(byTestId(armed, 'overlimit-relic-confirm') != null, true, '确认键');
  // 点卡 → onTap(idx)（状态机再决定是「选中」还是「确认」）
  byClass(tree, 'zjcard')[2].props.onClick();
  assert.deepEqual(tapped, [2]);
});

test('词条三选一：已实装的卡（impl ≠ pending）不画角标；非词条 family 一律不画', () => {
  const sp = draft({
    cards: [{ idx: 0, kind: 'overlimit', id: 'LC-004', name: '甲', desc: '乙', group: 'lc', impl: 'lc_004' }],
  });
  const tree = OverlimitRelicDraftView({ sp, myId: 'me', solo: true });
  assert.equal(byClass(tree, 'zjcard__pending').length, 0);
  assert.equal(byClass(tree, 'zjcard').length, 1);

  assert.equal(OverlimitRelicDraftView({ sp: normalizeSp({ family: 'jibian', cards: [{ id: 'x' }] }), myId: 'me', solo: true }), null);
  assert.equal(OverlimitRelicDraftView({ sp: normalizeSp({ family: 'tactic', cards: [{ id: 'x' }] }), myId: 'me', solo: true }), null);
  assert.equal(OverlimitRelicDraftView({ sp: null, myId: 'me', solo: true }), null);
});

test('阶段判定与横幅/胶囊：词条三选一不是机变、也不是惊变', () => {
  assert.equal(isOverlimitRelicDraft({ sp: { family: 'overlimit', cards: [] } }), true);
  assert.equal(isOverlimitRelicDraft({ sp: { family: 'jibian', cards: [] } }), false);
  assert.equal(isOverlimitRelicDraft({ sp: { family: 'tactic', cards: [] } }), false);
  assert.equal(isOverlimitRelicDraft(null), false);
  // 卡片自带 family 的帧（服务端 sp.family 缺失时）也能认出来
  assert.equal(isOverlimitRelicDraft({ sp: { cards: [{ family: 'overlimit' }] } }), true);

  const banner = phaseBanner(PHASE.SP_DRAFT, { sp: { family: 'overlimit', cards: [] } });
  assert.equal(banner.title, '词条抉择');
  assert.equal(banner.micro, 'RELIC');
  assert.equal(prepCapsuleLabel(PHASE.SP_DRAFT, { sp: { family: 'overlimit', cards: [] } }), '词条抉择');
  // 既有的二选一不受影响
  assert.equal(phaseBanner(PHASE.SP_DRAFT, { sp: { family: 'jibian', cards: [] } }).title, '惊变阶段');
  assert.equal(phaseBanner(PHASE.SP_DRAFT, { sp: { family: 'tactic', cards: [] } }).title, '机变阶段');
});

test('已选词条：id 列表还原成名字（m.private.relicsOverlimit.picked 只有 id）', () => {
  const entries = JSON.parse(readFileSync(path.join(ROOT, 'data/relicsOverlimit.json'), 'utf8')).entries;
  const rows = pickedRelicRows(entries, ['LC-001', 'FGO-01', 'LC-999']);
  assert.deepEqual(rows.map((r) => r.id), ['LC-001', 'FGO-01', 'LC-999']);
  assert.equal(rows[0].name, entries.find((e) => e.id === 'LC-001').name);
  assert.equal(rows[2].name, 'LC-999', '查不到的 id 原样回显，不编名字');
  assert.deepEqual(pickedRelicRows(entries, null), []);
});

test('S.W.E.E.P. 超限视图的词条页：两段（饰品 36 / 负面词条 17），同一套 sw-sec / sw-tile / sw-detail 版式，措辞只新增「饰品」', async () => {
  const { data } = await import('../../public/js/data.js');
  await data.load('relicsOverlimit');
  await data.load('relicsOverlimitNegative');
  const { RelicsTab, RelicPanel } = await import('../../public/js/screens/sweep.js');
  const entries = JSON.parse(readFileSync(path.join(ROOT, 'data/relicsOverlimit.json'), 'utf8')).entries;
  const negEntries = JSON.parse(readFileSync(path.join(ROOT, 'data/relicsOverlimitNegative.json'), 'utf8')).entries;

  const tab = RelicsTab({ sel: null, onSel: () => {} });
  // 两段各自独立计数、独立顺序：段一 = 36 条饰品（现状），段二 = 17 条负面（业主 2026-10-31 第二批）
  const secNames = byClass(tab, 'sw-sec__name').map(textOf);
  assert.equal(secNames.length, 2, '两段（饰品 / 负面词条）');
  assert.equal(secNames[0].replace(/[[\]0-9]/g, ''), '饰品', '第一段是业主 2026-10-31 第三批定稿的 t(\'饰品\')');
  assert.equal(secNames[1].replace(/[[\]0-9]/g, ''), '负面词条', '第二段一字不动：既有的 t(\'负面词条\')');
  assert.equal(Number(/(\d+)/.exec(secNames[0])[1]), entries.length, '第一段计数 = 36');
  assert.equal(Number(/(\d+)/.exec(secNames[1])[1]), negEntries.length, '第二段计数 = 17');
  assert.equal(entries.length, 36);
  assert.equal(negEntries.length, 17);

  const tiles = byClass(tab, 'sw-tile');
  assert.equal(tiles.length, entries.length + negEntries.length, '一条词条一个瓦片（两段合计）');
  const relicTiles = tiles.slice(0, entries.length);
  const negTiles = tiles.slice(entries.length);
  assert.deepEqual(relicTiles.map((t) => textOf(byClass(t, 'sw-tile__hp')[0])), entries.map((e) => e.id),
    '第一段 = 36 条饰品，顺序 = 表顺序');
  assert.deepEqual(negTiles.map((t) => textOf(byClass(t, 'sw-tile__hp')[0])), negEntries.map((e) => e.id),
    '第二段 = 17 条负面，顺序 = 负面表顺序（切段不串数据）');
  assert.equal(byClass(tab, 'sw-tile--neg').length, negEntries.length, '负面瓦片带自己的修饰类');
  assert.equal(negTiles.every((t) => hasClass(t, 'sw-tile--neg')), true);
  assert.equal(relicTiles.some((t) => hasClass(t, 'sw-tile--neg')), false, '饰品的 36 条外观不变');
  assert.equal(textOf(byClass(tab, 'sw-tile__cap')[0]), entries[0].name);
  assert.equal(textOf(byClass(tab, 'sw-tile__hp')[0]), entries[0].id, '瓦片右下角是词条编号（数据）');

  // 图标（业主 2026-10-31 解图）：有 `icon` 就画 <img>，容器还是原来的圆形 sw-disc（只多一个 art 修饰类给
  // object-fit: cover 用）；没有 `icon`（或加载失败）就落回原来的首字占位 —— 不新增文案 / DOM 结构。
  const discs = byClass(tab, 'sw-disc');
  assert.equal(discs.length, entries.length + negEntries.length, '每条词条一个圆形容器');
  assert.equal(discs[0].props.class, 'sw-disc sw-disc--art', '有图：容器带 art 修饰类');
  const tabImgs = find(tab, (v) => v.type?.name === 'Img');
  assert.equal(tabImgs.length, entries.length + negEntries.length, '每条词条一个 Img');
  assert.equal(tabImgs[0].props.src, entries[0].icon, '图标路径原样来自数据');
  assert.equal(typeof tabImgs[0].props.fallback, 'object', '占位符仍是首字节点');
  // 负面段：每条都有图标（数据里 icon 齐全）或首字回落；容器带 neg 分组色修饰类
  for (let i = 0; i < negEntries.length; i++) {
    const e = negEntries[i];
    const t = negTiles[i];
    const img = find(t, (v) => v.type?.name === 'Img')[0];
    assert.equal(img.props.src, e.icon ?? null, `${e.id}: 图标路径原样来自负面表`);
    assert.equal(textOf(img.props.fallback), [...e.name][0], `${e.id}: 没有图标时回落首字`);
    assert.equal(hasClass(byClass(t, 'sw-disc')[0], 'sw-disc--neg'), true, `${e.id}: 负面用既有的 neg 分组色`);
    assert.equal(byClass(t, 'sw-disc')[0].props.class, e.icon ? 'sw-disc sw-disc--art sw-disc--neg' : 'sw-disc sw-disc--neg');
  }

  // 切段不串数据：选中一条负面，只有那一个瓦片亮；详情面板画的是负面自己的名字 / 分组
  const pickedNeg = RelicsTab({ sel: negEntries[0].id, onSel: () => {} });
  const onTiles = find(pickedNeg, (v) => hasClass(v, 'is-on'));
  assert.equal(onTiles.length, 1, '只有选中的那个瓦片是 on');
  assert.equal(textOf(byClass(onTiles[0], 'sw-tile__hp')[0]), negEntries[0].id);
  const negPanel = RelicPanel({ relic: negEntries[0] });
  assert.equal(textOf(byClass(negPanel, 'sw-hero__name')[0]), negEntries[0].name, '详情抬头是负面词条自己的 name');
  assert.equal(textOf(byClass(negPanel, 'sw-kind')[0]), 'neg', '分组字段原样来自负面表');
  assert.equal(byClass(negPanel, 'sw-pill--ghost').filter((p) => textOf(p).includes('暂不可用')).length, 0, '17 条全部已实装：没有未实装标记');

  // 详情面板左上那块大图（业主 2026-10-31 第三批）：过去 Hero 的 src 恒为 null，所以永远画首字（「竟」）；
  // 现在有 `icon` 就渲染 <img src=数据路径>，与瓦片同一套（圆形容器沿用现状，只多一个 icon 修饰类吃 object-fit: cover），
  // 数据缺 `icon` 才回落首字。两段各抽一条（饰品第一条 + 负面第一条）。
  for (const [e, seg] of [[entries[0], '饰品'], [negEntries[0], '负面词条']]) {
    assert.equal(typeof e.icon, 'string', `${seg} ${e.id}: 数据里有 icon`);
    const panel = RelicPanel({ relic: e });
    const img = find(panel, (v) => v.type?.name === 'Img')[0];
    assert.equal(img.props.src, e.icon, `${seg} ${e.id}: 详情大图是 <img src=数据路径>，不再是首字`);
    assert.equal(hasClass(byClass(panel, 'sw-hero__img')[0], 'sw-hero__img--icon'), true, `${seg} ${e.id}: 圆形容器沿用现状 + icon 修饰类（cover）`);
    const bare = RelicPanel({ relic: { ...e, icon: null } });
    const bareImg = find(bare, (v) => v.type?.name === 'Img')[0];
    assert.equal(bareImg.props.src, null, `${seg} ${e.id}: 没有 icon 就不给 Img 塞路径`);
    assert.equal(textOf(bareImg.props.fallback), [...e.name][0], `${seg} ${e.id}: 没有 icon 才回落首字`);
    assert.equal(hasClass(byClass(bare, 'sw-hero__img')[0], 'sw-hero__img--icon'), false, `${seg} ${e.id}: 没有 icon 不带 icon 修饰类`);
  }

  // 业主 2026-10-31 第三批定稿：第一段的段名改成 `饰品` —— 本单**唯一**新增的 msgid，四语包各 +1；第二段仍走
  // 既有的 t('负面词条')（一字不动），页签 / 抬头仍走既有的 t('词条') / t('词条抉择')。
  const RENAME = { en: 'Relics', ja: '遺物', ko: '유물', 'zh-TW': '飾品' };
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${lang}.json`), 'utf8'));
    for (const k of ['词条', '负面词条']) assert.equal(k in pack, true, `${lang}: 「${k}」是既有键`);
    assert.equal(pack['饰品'], RENAME[lang], `${lang}: 新增的 msgid「饰品」= ${RENAME[lang]}`);
  }
  const SRC = readFileSync(path.join(ROOT, 'public/js/screens/sweep.js'), 'utf8');
  assert.match(SRC, /t\('饰品'\)/, '第一段的段名走新增的 msgid「饰品」');
  assert.match(SRC, /t\('负面词条'\)/, '第二段的段名走既有 msgid');

  // 表里没有 icon 的条目（数据会逐条补图，所以这里临时把一条的 icon 摘掉再还原）
  {
    const doc = data.get('relicsOverlimit');
    const saved = doc.entries[0].icon;
    try {
      doc.entries[0].icon = null;
      const bare = find(RelicsTab({ sel: null, onSel: () => {} }), (v) => v.type?.name === 'Img')[0];
      assert.equal(bare.props.src, null, '没有 icon：不给 Img 塞路径（落回 fallback）');
      assert.equal(textOf(bare.props.fallback), [...entries[0].name][0], '占位是首字');
      assert.equal(byClass(RelicsTab({ sel: null, onSel: () => {} }), 'sw-disc')[0].props.class, 'sw-disc', '没有 icon：容器不带 art 修饰类');
    } finally { doc.entries[0].icon = saved; }
  }

  // pending 集合只从数据里取：B 类逐条实装，pending 会一路减到 0，位置和条数都不许写死。
  const pendingEntries = entries.filter((e) => e.impl === 'pending');
  const pendingMarks = (tree) => byClass(tree, 'sw-pill--ghost').filter((p) => textOf(p).includes('暂不可用'));

  // 每张 pending 词条的详情面板：抬头就是它自己的 name（不再拿 entries[0] 顶替）。
  for (const e of pendingEntries) {
    const pending = RelicPanel({ relic: e });
    assert.equal(textOf(byClass(pending, 'sw-hero__name')[0]), e.name, `pending 词条 ${e.id} 的抬头是它自己的 name`);
    assert.equal(textOf(byClass(pending, 'sw-hero__sub')[0]), e.id, '抬头副行是词条编号（数据）');
    assert.equal(byClass(pending, 'sw-text')[0] != null, true, '效果全文在 sw-text 里');
    assert.equal(pendingMarks(pending).length, 1, '每张 pending 恰好一枚未实装标记');
    assert.ok(byClass(pending, 'sw-pill').some((p) => textOf(p).includes('暂不可用')), '未实装标记用既有 msgid');
  }

  // 全表：未实装标记数 = pending 条数（已实装的卡一枚都不画），与数组位置无关；pending 归零时两侧同为 0。
  const marksTotal = entries.reduce((n, e) => n + pendingMarks(RelicPanel({ relic: e })).length, 0);
  assert.equal(marksTotal, pendingEntries.length, '未实装标记数 = pending 条数');

  // 前向守卫：B 类全部做完（pending = 0）后，词条页不再渲染 pending 区块，这条测试仍然成立。
  if (pendingEntries.length === 0) {
    assert.equal(byClass(tab, 'sw-pending').length, 0, 'pending = 0 时瓦片墙不画 pending 占位块');
    assert.equal(byClass(tab, 'sw-tile--pending').length, 0, 'pending = 0 时瓦片墙没有 pending 瓦片');
    for (const e of entries) {
      const panel = RelicPanel({ relic: e });
      assert.equal(pendingMarks(panel).length, 0, `${e.id} 已实装：详情面板不画未实装标记`);
    }
  }

  assert.equal(RelicPanel({ relic: null }), null);
});
