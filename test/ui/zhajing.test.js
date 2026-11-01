// test/ui/zhajing.test.js — 炸惊模拟 (ZHAJING) 的客户端三块：惊变三选一浮层、已选惊变面板（我方 / 敌方 / 羁绊）、规则速览。
//
// 契约（与 engine-core / data 对齐，2026-10-28）：
//   * 抽卡是普通 SP_DRAFT（`m.public.sp.family === 'jibian'`），选卡走既有 `g.choice { idx }` —— 本轮没有专用消息；
//     重抽（`g.cardRefresh`）协议还没进 shared/protocol.js，所以浮层不画重抽按钮。
//   * 已选惊变 = `m.private.jibian = { cards, owned, rerollsLeft }`；敌方惊变 = `m.public.enemyJibian.cards`（本局已抽到的
//     全部，含 round）。羁绊读 /data/jibianBonds.json（{ bonds: [...] }）。
//   * 规则页的每一条数字都从 data/config.json 的炸惊 mode 现算 —— 所以这里断言的是「跟着数据走」，不是照抄包内数值。
// Hook-free views 直接当函数画（与 test/ui/extension-modes.test.js 同一套 vnode 读法）。
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

const { data } = await import('../../public/js/data.js');
await data.load('config');
await data.load('bonds');
await data.load('jibianBonds');
const { JibianDraftView, JibianPanelView, JibianTabs, RARITY_NAMES, jibianRarity, resolveJibianArt, jibianCardBonds } = await import('../../public/js/ui/jibian.js');
const { spTap, cardPickable } = await import('../../public/js/ui/choiceOverlay.js');
/** The stateful wrapper (`JibianOverlay`) is hooks-based, so its wiring is read as text — the same as the repo's other
 *  「the view is a function, the step machine is the component」 pairs. */
const JIBIAN_SRC = readFileSync(path.join(ROOT, 'public/js/ui/jibian.js'), 'utf8');
const { zhajingRules, zhajingMode } = await import('../../public/js/ui/zhajingRules.js');
const { difficultyInfo } = await import('../../public/js/screens/lobby.js');
const { shopBlockReason } = await import('../../public/js/ui/gameLogic/shop.js');
const { phaseBanner, prepCapsuleLabel, draftFamilyOf, isJibianDraft } = await import('../../public/js/ui/gameLogic/phases.js');
const { PHASE } = await import('../../shared/constants.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');

const CFG = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
const MODE = CFG.modes.mode_single_zhajing;

// ---- vnode helpers ----------------------------------------------------------------------------------
// The two card views are hook-free functions, so they can be drawn here; BondTab/useState ones are not (their `<div>`s
// would need a renderer), which is why the panel's bond page is asserted through its shell only.
const PLAIN = ['JibianCard', 'SelectedCard', 'JibianBondBlocks'];
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

/** A 惊变 draft as the server publishes it (three cards, solo → untimed, my turn). */
const draft = (over = {}) => normalizeSp({
  family: 'jibian', name: '惊变阶段', desc: '选择一项惊变', untimed: true, turn: 'me', order: ['me'], picks: {},
  cards: [
    { idx: 0, kind: 'jibian', id: 'jibian_wulizhuanmofa', name: '物理转魔法', desc: '你的干员造成的伤害变为法术伤害。', rarity: 'epic', flavor: '代价是另一种算法。' },
    { idx: 1, kind: 'jibian', id: 'jibian_chunyinzidan', name: '春音子弹', desc: '攻击力 +30%。', rarity: 'rare' },
    { idx: 2, kind: 'jibian', id: 'jibian_jinjiuzhibei', name: '进酒之杯', desc: '获得 3 点资金。', rarity: 'hidden', bonds: [{ name: '集成战略爱好者', have: 1, tiers: [3, 6] }] },
  ],
  ...over,
});

// ---- 三选一浮层 --------------------------------------------------------------------------------------
test('惊变三选一: 一张卡一张卡地画（名称 / 稀有度 / 描述 / flavor / 图），两步确认后才发 g.choice', () => {
  const picked = [];
  const sp = draft();
  const view = (o = {}) => JibianDraftView({ sp, myId: 'me', solo: true, onTap: (i) => picked.push(['tap', i]), onPick: (i) => picked.push(i), ...o });
  const tree = view();
  assert.ok(tree, 'the overlay draws');
  const dialog = byTestId(tree, 'jibian-overlay');
  assert.equal(dialog.props.role, 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.ok(textOf(tree).includes('惊变阶段'), 'its own name, not 机变');

  const cards = find(tree, (v) => hasClass(v, 'zjcard'));
  assert.equal(cards.length, sp.cards.length, 'one card per offered 惊变');
  // 三档稀有度各自上色，名字取自卡面（正文是 RichText 组件，读它的 props）
  assert.deepEqual(cards.map((c) => c.props['data-rarity']), ['epic', 'rare', 'hidden']);
  assert.deepEqual(cards.map((c) => c.props['data-testid']), ['jibian-card-0', 'jibian-card-1', 'jibian-card-2']);
  assert.equal(textOf(byClass(cards[0], 'zjcard__name')[0]), '物理转魔法');
  assert.equal(textOf(byClass(cards[0], 'zjcard__rarity')[0]), RARITY_NAMES.epic, 'the rarity word is printed');
  assert.equal(byClass(cards[0], 'zjcard__desc')[0].props.text, '你的干员造成的伤害变为法术伤害。', 'the card\'s own text (RichText)');
  assert.equal(textOf(byClass(cards[0], 'zjcard__flavor')[0]), '代价是另一种算法。', 'the grey flavour line (the cards\' own)');
  assert.equal(textOf(byClass(cards[2], 'zjcard__bond')[0]), '集成战略爱好者 1/3', 'the 羁绊 hint of a card that has one');

  // 第一步：点一张卡只是「选中」，不发消息；卡抬起并写 确认选择 / 再次点击，顶栏出现确认键
  assert.equal(cards[0].props.disabled, false);
  cards[0].props.onClick();
  assert.deepEqual(picked, [['tap', 0]], 'a first tap only selects');
  const armed = view({ armed: 1 });
  assert.ok(hasClass(find(armed, (v) => hasClass(v, 'zjcard'))[1], 'is-armed'), 'the selected card lifts');
  assert.equal(textOf(byClass(find(armed, (v) => hasClass(v, 'zjcard'))[1], 'zjcard__confirm')[0]), '确认选择再次点击');
  assert.equal(byTestId(armed, 'jibian-confirm').props.title, '确认选择「春音子弹」（再次点击卡牌亦可）');
  assert.equal(find(armed, (v) => hasClass(v, 'zjcard'))[0].props['aria-pressed'], 'false', 'the others are not armed');
  // 第二步：确认键 / 再次点同一张才真的发 g.choice（状态机用的是机变那套 spTap）
  let armedIdx = null;
  const sent = [];
  const tap = (idx) => {
    const card = sp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armedIdx, idx, cardPickable(sp, card, { myId: 'me', solo: true, busyIdx: null }));
    armedIdx = r.armed;
    if (r.pick != null) sent.push(r.pick);
  };
  tap(0);
  assert.deepEqual(sent, [], '点一次不发消息');
  tap(0);
  assert.deepEqual(sent, [0], '再点同一张才发');
  armedIdx = null;
  tap(1);
  tap(2);
  assert.deepEqual(sent, [0], '换一张只是改选中，也不发');
  view({ armed: 1, onConfirm: () => sent.push('confirm') }).props.children;
  assert.deepEqual(sent, [0], '确认键由状态机发出，view 自身不发');
  // 组件本身接的就是这套两步状态机（hooks 组件，读源码断言；与机变 ChoiceOverlay 同一套 spTap / armedCard）
  assert.match(JIBIAN_SRC, /const r = spTap\(armed, idx, cardPickable\(sp, card, \{ myId, solo, busyIdx \}\)\);/);
  assert.match(JIBIAN_SRC, /if \(r\.pick != null\) onPick\(r\.pick\);/);
  assert.match(JIBIAN_SRC, /onConfirm=\$\{\(\) => \{ if \(armed != null\) tap\(armed\); \}\}/);
  // 选中可以取消（点别处 / Esc）
  const disarmed = [];
  view({ armed: 1, onDisarm: () => disarmed.push(1) }).props.onPointerDown({ target: { closest: () => null } });
  assert.deepEqual(disarmed, [1], 'a press outside the cards drops the selection');

  // my turn is said out loud, and a pick in flight disables the cards again
  assert.ok(textOf(tree).includes('当前轮到你决策'));
  const busy = view({ busyIdx: 1 });
  assert.deepEqual(find(busy, (v) => hasClass(v, 'zjcard')).map((c) => c.props.disabled), [true, true, true]);
  assert.equal(find(busy, (v) => hasClass(v, 'zjcard__busy')).length, 1, 'the in-flight card says 选择中');
  assert.equal(textOf(find(busy, (v) => hasClass(v, 'zjcard__busy'))[0]), '选择中');

  // after my pick the overlay says so and nothing is pickable any more
  const done = view({ sp: draft({ picks: { me: 1 }, taken: { 1: 'me' } }), onTap: () => {} });
  assert.ok(textOf(done).includes('已完成选择'));

  // not my turn (co-op): the cards are dark and the head names the wait
  const coop = view({ sp: draft({ turn: 'other', order: ['other', 'me'] }), solo: false });
  assert.deepEqual(find(coop, (v) => hasClass(v, 'zjcard')).map((c) => c.props.disabled), [true, true, true]);
  assert.ok(textOf(coop).includes('正在决策…'));

  // a plain 机变 draft is NOT this overlay
  assert.equal(JibianDraftView({ sp: normalizeSp({ family: 'tactic', cards: [{ id: 'tactic_a' }] }), myId: 'me', solo: true }), null);
  assert.equal(JibianDraftView({ sp: null, myId: 'me', solo: true }), null);
});

test('竖版竖卡: 每张卡写明「这属于哪个惊变羁绊」（名 + effect 全文），不属于任何羁绊就不画块，绝不编', () => {
  const table = data.get('jibianBonds').bonds;
  const rec = (id) => table.find((b) => b.id === id);
  const sp = draft({
    cards: [
      // 卡上的 bond: 'yanShip' 是**盟约** —— 业主 2026-10-29：补充不写盟约，写这张卡属于哪条惊变羁绊
      { idx: 0, kind: 'jibian', id: 'jibian_chixiaojianfa', name: '赤霄剑法', desc: '弱点伤害。', rarity: 'legend', bond: 'yanShip' },
      // 只有 iconBond（mujicaShip）的星河战舰：同样按卡片 id 反查 → 开始吧，今夜的假面舞会
      { idx: 1, kind: 'jibian', id: 'jibian_yinhezhanjian', name: '银河战舰', desc: '三张卡之一。', rarity: 'hidden', iconBond: 'mujicaShip' },
      // 同一张卡可以同时属于几条羁绊（高卢纸票：集成战略爱好者 + 出老千 + 真·投资人）
      { idx: 2, kind: 'jibian', id: 'jibian_gaoluzhipiao', name: '高卢纸票', desc: '三条羁绊之一。', rarity: 'epic' },
    ],
  });
  const view = JibianDraftView({ sp, myId: 'me', solo: true });
  const cards = find(view, (v) => hasClass(v, 'zjcard'));
  assert.equal(cards.length, 3, 'three vertical cards draw at once');
  // ① jibian_chixiaojianfa → 惊动军方，effect 逐字来自 data/jibianBonds.json
  assert.equal(textOf(byClass(cards[0], 'zjcard__bondname')[0]), '惊动军方');
  assert.equal(byClass(cards[0], 'zjcard__bondbox')[0].props['data-bond'], 'army_alert');
  assert.equal(byClass(cards[0], 'zjcard__bondeffect')[0].props.text, rec('army_alert').effect, 'the bond effect, verbatim');
  assert.equal(textOf(byClass(cards[0], 'zjcard__bondtag')[0]), '惊变羁绊', 'the block says what it is');
  assert.equal(byClass(cards[0], 'zjcard__bondblocks')[0].props['data-bonds'], 'army_alert');
  assert.equal(textOf(byClass(cards[0], 'zjcard__bondtiers')[0]), '2', 'the tier thresholds ride along');
  // ② 银河战舰 → 开始吧，今夜的假面舞会（iconBond 的 mujicaShip 只是盟约，不参与反查）
  assert.equal(textOf(byClass(cards[1], 'zjcard__bondname')[0]), '开始吧，今夜的假面舞会');
  assert.equal(byClass(cards[1], 'zjcard__bondbox')[0].props['data-bond'], 'ave_mujica');
  assert.equal(byClass(cards[1], 'zjcard__bondeffect')[0].props.text, rec('ave_mujica').effect, 'the whole Fever text');
  // ③ 三条羁绊各画一块，名字与顺序照表
  assert.deepEqual(byClass(cards[2], 'zjcard__bondname').map((v) => textOf(v)), ['集成战略爱好者', '出老千', '真·投资人']);
  assert.deepEqual(byClass(cards[2], 'zjcard__bondbox').map((v) => v.props['data-bond']), ['roguelike_fan', 'cheat', 'true_investor']);
  assert.equal(byClass(cards[2], 'zjcard__bondblocks')[0].props['data-bonds'], 'roguelike_fan cheat true_investor');
  // ④ 不属于任何羁绊的卡（死亡回归）不画羁绊块；没有 id 的卡也不画
  const plain = find(JibianDraftView({ sp: draft({ cards: [{ idx: 0, kind: 'jibian', id: 'jibian_siwanghuigui', name: '死亡回归', desc: '甲', rarity: 'normal' }] }), myId: 'me', solo: true }), (v) => hasClass(v, 'zjcard'));
  assert.equal(byClass(plain[0], 'zjcard__bondblocks').length, 0, 'no membership → no block (never invented)');
  // ⑤ 反查的键就是卡片 id：effectId / id / key 都认，bond / iconBond 不参与
  assert.deepEqual(jibianCardBonds({ id: 'jibian_cengshudaluan' }).map((b) => b.name), ['层数厨']);
  assert.deepEqual(jibianCardBonds({ effectId: 'jibian_chixiaojianfa', bond: 'yanShip', iconBond: 'mujicaShip' }).map((b) => b.name), ['惊动军方']);
  assert.deepEqual(jibianCardBonds({ key: 'jibian:jibian_yinhezhanjian' }).map((b) => b.id), ['ave_mujica'], 'the jibian: prefix is stripped');
  assert.deepEqual(jibianCardBonds({ key: 'jibian:nope' }), [], 'not a member → empty');
  assert.deepEqual(jibianCardBonds({ bond: 'yanShip' }), [], 'a 盟约 id alone is not a 惊变羁绊');
  assert.deepEqual(jibianCardBonds({}), []);
  assert.deepEqual(jibianCardBonds(null), []);
  // ⑥ 池子里 63 张有归属、36 张没有 —— 面板/卡面都不许给后者补一句话
  const pool = CFG.modes.mode_single_zhajing.jibian.pool;
  const hit = pool.filter((c) => jibianCardBonds(c).length > 0);
  assert.equal(pool.length, 99);
  assert.equal(hit.length, 63, '63 of the 99 pool cards belong to a 惊变羁绊');
  assert.equal(new Set(hit.flatMap((c) => jibianCardBonds(c).map((b) => b.id))).size, 18, 'all 18 羁绊 are reachable from the pool');
});

test('惊变: 稀有度五档（普通 / 稀有 / 史诗 / 传说 / 隐秘），未知值读作普通；盟约惊变画盟约头像', () => {
  assert.deepEqual(Object.keys(RARITY_NAMES), ['normal', 'rare', 'epic', 'legend', 'hidden']);
  assert.equal(jibianRarity({ rarity: 'legend' }), 'legend');
  assert.equal(jibianRarity({ rarity: 'nope' }), 'normal');
  assert.equal(jibianRarity({}), 'normal');
  const art = resolveJibianArt(data.get('assets'), { id: 'jibian_x', iconBond: 'yanShip' });
  assert.equal(art.whiteGlyph, true, 'a 盟约惊变 draws the bond portrait, whitened in CSS');
});

// ---- 已选惊变面板 --------------------------------------------------------------------------------------
test('已选惊变: 局内只有**单行三页签**（已选惊变 / 敌方惊变 / 惊变羁绊），逐页都有自己的空状态', () => {
  // nothing picked yet: three tabs, both lists empty, each with its own sentence
  const empty = JibianPanelView({ jibian: { cards: [], owned: [], rerollsLeft: 4 }, enemy: null });
  assert.ok(byTestId(empty, 'jibian-panel'));
  const tabs = find(empty, (v) => v.props?.role === 'tab');
  // 两张列表页的标签后面跟着张数（羁绊页没有数字可数）；首标签复用既有键 t('已选惊变')（业主 2026-10-29）
  assert.deepEqual(tabs.map((x) => textOf(x)), ['已选惊变0', '敌方惊变0', '惊变羁绊']);
  assert.deepEqual(tabs.map((x) => x.props['data-testid']), ['jibian-tab-mine', 'jibian-tab-enemy', 'jibian-tab-bond']);
  assert.equal(tabs[0].props['aria-selected'], 'true', 'the own list opens first');
  // 单层：只有一组 tablist，没有「惊变一览」页（一览在局外，另一任务）；也没有第二行页签
  assert.equal(find(empty, (v) => v.props?.role === 'tablist').length, 1, 'one tab row, not two');
  assert.equal(tabs.length, 3);
  assert.ok(!textOf(empty).includes('惊变一览'), 'the codex is not an in-match page any more');
  assert.doesNotMatch(JIBIAN_SRC, /t\('我方已选'\)|t\('我的惊变'\)/, 'reuse the existing 已选惊变 key (no new i18n string)');
  assert.ok(textOf(byTestId(empty, 'jibian-mine-empty')).includes('还没有选过惊变'));
  // 敌方页（R1 之前没有卡）：它自己的空状态
  assert.ok(textOf(byTestId(JibianPanelView({ tab: 'enemy', jibian: { cards: [], owned: [] }, enemy: { cards: [] } }), 'jibian-enemy-empty'))
    .includes('本局没有敌方惊变'));
  // 羁绊页在数据没到（data.jibianBonds 还没 load 完）时是空的：这里只钉住「这一页存在、并且不会抛」
  assert.ok(byTestId(JibianPanelView({ tab: 'bond', jibian: { cards: [], owned: [] } }), 'jibian-panel'));

  // my cards: **横行**（一行一张）—— 左图 | 名称 + 稀有度 + 已选标记一行，描述与羁绊在其后；行数就是卡数
  const mine = JibianPanelView({
    jibian: { cards: [{ key: 'jibian:a', id: 'jibian_a', name: '物理转魔法', desc: '转成法术。', rarity: 'epic', flavor: '代价。' }], owned: ['jibian_a'], rerollsLeft: 3 },
    enemy: { round: 1, cards: [{ round: 1, id: 'ejibian_quanjunchuji', name: '全军出击', desc: '出怪量翻倍。', rarity: 'legend' }] },
  });
  const mineRows = byTestId(mine, 'jibian-mine');
  assert.ok(mineRows, 'the own list');
  assert.equal(byClass(mineRows, 'zjsel').length, 1, 'one row per picked 惊变');
  assert.equal(byTestId(mine, 'jibian-row-mine').props['data-rarity'], 'epic', 'the row keeps its rarity stripe');
  assert.equal(textOf(byClass(mineRows, 'zjsel__name')[0]), '物理转魔法');
  assert.equal(textOf(byClass(mineRows, 'zjsel__rarity')[0]), RARITY_NAMES.epic, 'rarity rides on the head line');
  assert.equal(textOf(byClass(mineRows, 'zjsel__mark')[0]), '已选', 'the 已选 marker of an own row');
  assert.equal(textOf(byClass(mineRows, 'zjsel__desc')[0]), '转成法术。', 'the description is a one-line strip');
  assert.equal(byClass(mineRows, 'zjsel__desc')[0].props.title, '转成法术。', 'the whole text rides on title');
  // 抬头写 t('惊变')，不再与首标签 t('已选惊变') 同一句话（业主 2026-10-29）
  assert.equal(textOf(byClass(mine, 'zjpanel__title')[0]), '惊变');
  assert.equal(find(mine, (v) => v.props?.role === 'tab')[1].props['aria-selected'], 'false');

  // the enemy page: every card drawn so far, each with the round it was drawn in, one row each
  const enemyPage = JibianPanelView({ tab: 'enemy', jibian: { cards: [], owned: [] }, enemy: { round: 6, cards: [
    { round: 1, id: 'ejibian_quanjunchuji', name: '全军出击', desc: '出怪量翻倍。', rarity: 'legend' },
    { round: 6, id: 'ejibian_jiangshiweicheng', name: '丧尸围城', desc: '出怪量 ×2。', rarity: 'epic' },
  ] } });
  const cells = byClass(enemyPage, 'zjpanel__cell');
  assert.equal(cells.length, 2, 'both draws are listed, not only the newest');
  assert.deepEqual(cells.map((c) => textOf(byClass(c, 'zjpanel__round')[0])), ['R1', 'R6']);
  assert.equal(textOf(byClass(cells[1], 'zjsel__name')[0]), '丧尸围城');
  assert.equal(textOf(byClass(cells[1], 'zjsel__mark')[0]), '敌方惊变', 'enemy rows are marked as such');
  assert.equal(byClass(cells[1], 'zjsel').length, 1, 'a round badge + one row, not a cell above a card');
  assert.equal(byClass(enemyPage, 'zjcard__bondblocks').length, 0, '敌方卡的 id 不在惊变羁绊表里 → 不画羁绊块');
  assert.equal(byClass(enemyPage, 'zjsel__bonds').length, 0, 'and the row strip carries no bond chip either');

  // a watching name is shown (the caller hands the watched seat in); its first tab names the watched seat
  const watch = JibianPanelView({ jibian: { cards: [], owned: [] }, watchingName: '某位博士' });
  assert.ok(textOf(watch).includes('某位博士'));
  assert.equal(textOf(find(watch, (v) => v.props?.role === 'tab')[0]), 'TA 的惊变0');

  // 「已选惊变」不再是右上角的一枚 .zjbtn 角标（业主 2026-10-29）：局内入口是左下角那颗独立键（zj-jibian）
  // 或顶栏的模式工具胶囊。角标组件已删，面板本体（JibianPanelView / JibianTabs）仍然是这一页的渲染函数。
  assert.equal(typeof JibianTabs, 'function', 'the three 已选惊变 pages are still a renderable component');
  assert.doesNotMatch(JIBIAN_SRC, /class="zjbtn|zjbtn--codex/, 'the corner .zjbtn entries are gone');
});

test('已选惊变: 我方行的「补充」同样是惊变羁绊（名 + tiers 同行，effect 全文在 title 里），逐字来自 data/jibianBonds.json', () => {
  const table = data.get('jibianBonds').bonds;
  const rec = (id) => table.find((b) => b.id === id);
  const view = JibianPanelView({
    jibian: { cards: [
      { key: 'jibian:jibian_cengshudaluan', id: 'jibian_cengshudaluan', name: '层数大乱', desc: '层数。', rarity: 'legend' },
      { key: 'jibian:jibian_siwanghuigui', id: 'jibian_siwanghuigui', name: '死亡回归', desc: '回档。', rarity: 'normal' },
    ], owned: ['jibian_cengshudaluan'] },
    enemy: null,
  });
  // 层数大乱 → 层数厨；名与 tiers 同在一枚小片里（横行），effect 不再撑成竖卡的高块
  const chips = byClass(view, 'zjsel__bonds');
  assert.equal(chips.length, 1, 'only the card that belongs to a 惊变羁绊 gets a chip');
  assert.equal(chips[0].props['data-bonds'], 'layers_fan');
  assert.equal(textOf(byClass(view, 'zjsel__bondname')[0]), '层数厨');
  assert.equal(textOf(byClass(view, 'zjsel__bondtiers')[0]), rec('layers_fan').tiers.join(' / '), 'the tier threshold rides on the same chip');
  // effect **全文**改挂 title：小片自己一份、整行再一份（手机没有 hover，整行 title 是唯一的全文入口）
  assert.equal(byClass(view, 'zjsel__bond')[0].props.title, rec('layers_fan').effect);
  assert.equal(rec('layers_fan').effect, '你的所有盟约层数叠加时获得的层数翻倍。');
  assert.ok(byTestId(view, 'jibian-row-mine'), 'the own rows are addressable rows');
  const rows = byClass(view, 'zjsel');
  assert.equal(rows.length, 2, 'one row per card');
  assert.equal(rows[0].props['data-testid'], 'jibian-row-mine');
  assert.ok(rows[0].props.title.includes(rec('layers_fan').effect), 'the whole effect text rides on the row title');
  assert.ok(rows[0].props.title.includes('层数厨'), 'and so does the bond name');
  // 横行里没有竖卡的羁绊高块，也没有会撑高的 effect 段落
  assert.equal(byClass(view, 'zjcard__bondblocks').length, 0);
  assert.equal(byClass(view, 'zjcard__bondeffect').length, 0);
});

// ---- 规则页 ------------------------------------------------------------------------------------------
test('规则速览: 每一条数字都从本仓 config 的炸惊 mode 现算（不是包内那份速览的数值）', () => {
  const mode = zhajingMode();
  assert.ok(mode, 'the play set\'s mode record is in this build');
  assert.equal(mode.code, 'AC-8');
  const rows = zhajingRules();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.text]));
  assert.deepEqual(rows.map((r) => r.key), ['bench', 'equip', 'mine', 'enemy', 'pool', 'scale', 'bans', 'rounds', 'phases']);

  // 待部署区：mode.economy.benchSize（0.3.3 全局是 10）
  assert.ok(byKey.bench.includes(String(MODE.economy.benchSize)), byKey.bench);
  assert.ok(byKey.equip.includes(String(MODE.economy.equipPerChess)), byKey.equip);
  // 我方惊变：spPhaseKinds 里 kind = jibian 的回合 / 每次几张 / 重抽次数
  const jibianRounds = Object.entries(MODE.spPhaseKinds).filter(([, k]) => k === 'jibian').map(([r]) => r).join(' / ');
  assert.ok(byKey.mine.includes(jibianRounds), `${byKey.mine} names the 惊变 rounds (${jibianRounds})`);
  assert.ok(byKey.mine.includes(String(MODE.jibian.cards)));
  assert.ok(byKey.mine.includes(String(MODE.jibian.rerolls)));
  // 敌方惊变：rounds 与池子大小
  assert.ok(byKey.enemy.includes(MODE.enemyJibian.rounds.join(' / ')));
  assert.ok(byKey.enemy.includes(String(MODE.enemyJibian.pool.length)));
  assert.ok(byKey.pool.includes(String(MODE.jibian.pool.length)));
  // 白值膨胀三项
  for (const v of [MODE.allyScale.hp, MODE.allyScale.def, MODE.allyScale.atk]) assert.ok(byKey.scale.includes(String(v)), byKey.scale);
  // 禁选：bans.ZHAJING 的 core / addon
  assert.ok(byKey.bans.includes(String(CFG.bans.ZHAJING.core)));
  assert.ok(byKey.bans.includes(String(CFG.bans.ZHAJING.addon)));
  for (const id of MODE.inactiveBondIds) {
    const name = data.lookup('bonds', id).name;
    assert.ok(byKey.bans.includes(name), `the ban list names ${name}`);
  }
  // 回合与首领
  assert.ok(byKey.rounds.includes(String(MODE.lastRound)));
  assert.ok(byKey.rounds.includes(String(MODE.bossRound)));

  // no mode record → no rows (a page of invented numbers is worse than an empty one)
  assert.deepEqual(zhajingRules({ cfg: { modes: {} } }), []);
});

// ---- 惊变阶段的识别（family 兜底） ---------------------------------------------------------------------
test('惊变阶段识别: 顶层 family 丢了也认（卡上带 family），横幅与 HUD 胶囊都写「惊变阶段」而不是「机变阶段」', () => {
  const cards = [{ idx: 0, family: 'jibian', id: 'jibian_a', name: '卡A' }];
  // ① 顶层 family 正常
  assert.equal(draftFamilyOf({ sp: { family: 'jibian', cards } }), 'jibian');
  assert.equal(isJibianDraft({ sp: { family: 'jibian', cards } }), true);
  // ② 顶层丢了，第一张卡带着（服务端 choices.js 给每张卡都盖 family）—— 仍然算惊变
  assert.equal(draftFamilyOf({ sp: { cards } }), 'jibian');
  assert.equal(isJibianDraft({ sp: { cards } }), true);
  // ③ 普通机变 / 没有草稿
  assert.equal(isJibianDraft({ sp: { family: 'tactic', cards: [{ idx: 0, family: 'tactic' }] } }), false);
  assert.equal(isJibianDraft({ sp: null }), false);
  assert.equal(isJibianDraft(null), false);
  assert.equal(draftFamilyOf({ sp: { cards: [] } }), null);

  // ④ 横幅：同一相位，两种家族两套字（真机 667×375 上写着 CONTINGENCY / 机变阶段的那张图就是这条的红）
  const jib = phaseBanner(PHASE.SP_DRAFT, { round: 1, sp: { cards } });
  assert.equal(jib.title, '惊变阶段');
  assert.equal(jib.micro, 'MUTATION');
  assert.equal(jib.sub, '选择一项');
  const plain = phaseBanner(PHASE.SP_DRAFT, { round: 3, sp: { family: 'tactic', cards: [] } });
  assert.equal(plain.title, '机变阶段');
  assert.equal(plain.micro, 'CONTINGENCY');
  assert.equal(plain.sub, '依次选择机变');
  // ⑤ HUD 胶囊同样分（给了 pub 才知道是哪一种）
  assert.equal(prepCapsuleLabel(PHASE.SP_DRAFT, { sp: { cards } }), '惊变阶段');
  assert.equal(prepCapsuleLabel(PHASE.SP_DRAFT, { sp: { family: 'tactic' } }), '机变阶段');
  assert.equal(prepCapsuleLabel(PHASE.SP_DRAFT), '机变阶段', 'without pub the generic label stays');
  assert.equal(prepCapsuleLabel(PHASE.PREP, { sp: { cards } }), '休息一下');
});

// ---- 房内与局内接线 ------------------------------------------------------------------------------------
test('房内: difficultyInfo 认得 ZHAJING（代号 AC-8、玩法包自己的简介、回合数），且不进官方四档', () => {
  const info = difficultyInfo('solo', 'ZHAJING');
  assert.equal(info.code, 'AC-8');
  assert.equal(info.desc, MODE.desc);
  assert.equal(info.rounds, MODE.lastRound);
  assert.equal(info.stageNote, `战场随机（共${MODE.stages.length}张）`);
  assert.equal(difficultyInfo('coop', 'ZHAJING').code, 'AC-8', 'both parties read the same play set');
  // 蚀流不是它的：房间页的档位胶囊只在 ANNIHILATION 出现（room.js 的门），difficultyInfo 也不会给它 30 / ∞
  assert.ok(!String(difficultyInfo('solo', 'ZHAJING').rounds).includes('∞'));
});

test('准备就绪: 惊变草稿没选完时被拦住（照藏品那条的写法）', () => {
  const priv = { canReady: true, relics: null };
  assert.equal(shopBlockReason('ready', { priv, editable: true }), null);
  assert.equal(shopBlockReason('ready', { priv, editable: true, jibianDraft: true }), '请先完成惊变选择');
  // 藏品那条仍然先说话（两个草稿不会同时开，但顺序不能变）
  assert.equal(shopBlockReason('ready', { priv: { ...priv, relics: { draft: { cards: [] } } }, editable: true, jibianDraft: true }), '请先完成藏品选择');
});
