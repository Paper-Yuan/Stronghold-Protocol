// test/ui/zhajing-panels.test.js — 炸惊模拟局内的三块界面（public/js/ui/jibian.js）：
//   ① 敌方惊变揭晓浮层（R1/R6，先 flickerMs 翻牌、再 resultMs 定格，减动效直出结果，card 为 null 时只画「抽取中」）；
//   ② 惊变一览（本模式全部 99 张，按稀有度分组，已拥有的打勾）；
//   ③ 惊变三选一的「重抽」键（`g.cardRefresh { idx }`，协议由 engine-core 落 —— 键名以 shared/protocol.js 为准）。
// 纯视图部分直接当函数画；带 hooks 的状态机（EnemyJibianReveal / JibianOverlay）用源码断言钉住接线，和
// test/ui/zhajing.test.js 同一个套路。
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
const JIB = await import('../../public/js/ui/jibian.js');
const { EnemyJibianRevealView, flickerPool, JibianCodex, JibianCodexView, jibianPoolOf,
  jibianPoolGroups, JibianDraftView, RARITY_NAMES } = JIB;
/** The HUD's merged 模式工具 button + its panel (业主 2026-10-29: 锻造器 / 已选惊变 / 一览 合成一颗按钮). */
const { ModeToolsButton, JibianHudButton } = await import('../../public/js/ui/hud.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');
const { C2S } = await import('../../shared/protocol.js');

const CFG = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
const MODE_ID = 'mode_single_zhajing';
const POOL = CFG.modes[MODE_ID].jibian.pool;
const SRC = readFileSync(path.join(ROOT, 'public/js/ui/jibian.js'), 'utf8');
const GAME_SRC = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
const ACTIONS_SRC = readFileSync(path.join(ROOT, 'public/js/ui/gameActions.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/jibian.css'), 'utf8');

// ---- vnode helpers ----------------------------------------------------------------------------------
const PLAIN = ['JibianCard', 'SelectedCard', 'JibianBondBlocks', 'JibianCodexView'];
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

/** m.public.enemyJibian as the server publishes it (R1 drew 全军出击; `cards` holds every draw so far). */
const enemyOf = (over = {}) => ({
  round: 1, rarity: 'legend',
  card: { kind: 'jibian', id: 'ejibian_quanjunchuji', name: '全军出击', desc: '出怪量翻倍。', rarity: 'legend', flavor: '都上了。' },
  cards: [{ round: 1, id: 'ejibian_quanjunchuji', name: '全军出击', desc: '出怪量翻倍。', rarity: 'legend' }],
  pool: [
    { id: 'ejibian_qiangqiang', name: '？！强强？！', rarity: 'normal' },
    { id: 'ejibian_quanjunchuji', name: '全军出击', rarity: 'legend' },
    { id: 'ejibian_jiangshiweicheng', name: '丧尸围城', rarity: 'epic' },
  ],
  flickerMs: 3000, resultMs: 3000, ...over,
});

// ---- ① 敌方惊变揭晓 ----------------------------------------------------------------------------------
test('敌方惊变揭晓: 翻牌阶段只轮播牌库（不含刚抽到的这张），定格才出这张卡的全部信息', () => {
  const enemy = enemyOf();
  // flicker: a pool face, never the drawn one; no description yet (that would leak the result early)
  const spinning = EnemyJibianRevealView({ enemy, stage: 'flicker', slot: 0 });
  assert.equal(spinning.props['data-testid'], 'jibian-reveal');
  assert.equal(spinning.props['data-stage'], 'flicker');
  assert.equal(spinning.props['data-round'], 1);
  assert.ok(hasClass(spinning, 'zjrev') || byClass(spinning, 'zjrev').length === 1);
  assert.ok(hasClass(byClass(spinning, 'zjrev')[0], 'is-spinning'), 'the flicker is the spinning state');
  assert.ok(byClass(spinning, 'zjrev__card')[0].props.class.includes('is-spinning'));
  const face = textOf(byClass(spinning, 'zjrev__name')[0]);
  assert.equal(face, '？！强强？！', 'it rolls through the pool');
  assert.equal(byClass(spinning, 'zjrev__desc').length, 0, 'no effect text while spinning');
  assert.notEqual(face, '全军出击', 'the drawn card is NOT on screen before the result');

  // the rotation skips the drawn card entirely (no leak in the last flicker frame either)
  const pool = flickerPool(enemy);
  assert.deepEqual(pool.map((c) => c.id), ['ejibian_qiangqiang', 'ejibian_jiangshiweicheng']);
  assert.equal(EnemyJibianRevealView({ enemy, stage: 'flicker', slot: 1 }).props['data-stage'], 'flicker');

  // result: the drawn card, with its rarity / text / flavour, and the skip hint
  const result = EnemyJibianRevealView({ enemy, stage: 'result' });
  assert.equal(result.props['data-stage'], 'result');
  assert.equal(textOf(byClass(result, 'zjrev__name')[0]), '全军出击');
  assert.equal(textOf(byClass(result, 'zjrev__rarity')[0]), RARITY_NAMES.legend);
  assert.equal(byClass(result, 'zjrev__desc')[0].props.text, '出怪量翻倍。');
  assert.equal(textOf(byClass(result, 'zjrev__flavor')[0]), '都上了。');
  assert.equal(textOf(byClass(result, 'zjrev__skip')[0]), '跳过');
  assert.equal(byClass(result, 'zjrev__skip')[0].type, 'button', '跳过 is a real button (a ≥32 px target of its own)');
  assert.equal(result.props.role, 'dialog');
  assert.equal(result.props['aria-modal'], 'true');
  assert.equal(result.props['aria-label'], '敌方惊变');
});

test('敌方惊变揭晓: card 为 null 时只画「抽取中」，一个字都不泄露', () => {
  const drawing = EnemyJibianRevealView({ enemy: enemyOf({ card: null }), stage: 'result' });
  assert.equal(drawing.props['data-stage'], 'drawing');
  assert.ok(byTestId(drawing, 'jibian-reveal-wait'), 'the waiting plate');
  assert.equal(byClass(drawing, 'zjrev__card').length, 0, 'no card frame at all');
  assert.equal(byClass(drawing, 'zjrev__skip').length, 0, 'nothing to skip yet');
  const text = textOf(drawing);
  for (const leak of ['全军出击', '？！强强？！', '丧尸围城', '出怪量翻倍']) assert.ok(!text.includes(leak), `no early leak: ${leak}`);
  // no enemy at all → no overlay
  assert.equal(EnemyJibianRevealView({ enemy: null }), null);
});

test('敌方惊变揭晓: 减动效没有翻牌这一帧 —— 直接出结果，并且 CSS 把它列进 reduce 名单', () => {
  // the view: a reduced render is never the spinning state, whatever the stage says
  const reduced = EnemyJibianRevealView({ enemy: enemyOf(), stage: 'flicker', reduced: true });
  assert.equal(reduced.props['data-stage'], 'result', 'reduced motion goes straight to the result');
  assert.equal(reduced.props['data-reduced'], 'true');
  assert.equal(byClass(reduced, 'zjrev').filter((v) => v.props.class.includes('is-spinning')).length, 0);
  assert.equal(textOf(byClass(reduced, 'zjrev__name')[0]), '全军出击');

  // the state machine starts at 'result' when reduced (hooks component → source assertion)
  assert.match(SRC, /const isReduced = reduced == null \? \(typeof window !== 'undefined' && reducedMotion\(\)\) : reduced === true;/);
  assert.match(SRC, /const \[stage, setStage\] = useState\(isReduced \? 'result' : 'flicker'\);/);
  assert.match(SRC, /if \(isReduced\) \{ setStage\('result'\); return undefined; \}/);
  // the timing comes from the server's own numbers, and a click/Space/Esc skips a step
  assert.match(SRC, /const flickerMs = Math\.max\(0, Number\(enemy && enemy\.flickerMs\) \|\| 0\);/);
  assert.match(SRC, /const resultMs = Math\.max\(0, Number\(enemy && enemy\.resultMs\) \|\| 0\);/);
  assert.match(SRC, /const skip = \(\) => \{ if \(stage === 'flicker'\) setStage\('result'\); else close\(\); \};/);
  assert.match(SRC, /if \(e\.key === ' ' \|\| e\.key === 'Escape' \|\| e\.key === 'Enter'\)/);

  // CSS: every .zjrev* animation is declared before the reduce block, and the reduce block names the reveal
  const reduceAt = CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceAt > 0);
  for (const sel of ['.zjrev__box', '.zjrev.is-spinning .zjrev__name', '.zjrev[data-stage="result"] .zjrev__card']) {
    assert.ok(CSS.includes(sel), `${sel} is styled`);
  }
  assert.ok(CSS.indexOf('@keyframes zjrev-in') < reduceAt, 'the entrance animation is declared before the reset');
  assert.ok(CSS.indexOf('@keyframes zjrev-flick') < reduceAt, 'the flicker is declared before the reset');
  assert.match(CSS.slice(reduceAt), /\.zjrev__box, \.zjrev\.is-spinning \.zjrev__name, \.zjrev\[data-stage="result"\] \.zjrev__card \{ animation: none; \}/);
  // 矮屏也有它自己的一档：**收窄拉高**（业主 2026-10-29「手机端不要太长，稍窄再拉高一点」；96vw 的横条把词条全挤在
  // 一行）、跳过是 32px 的真按钮
  assert.match(CSS, /@media \(max-height: 520px\) \{[\s\S]*?\.zjrev__box \{ width: min\(12\.4rem, 62vw\); max-width: none;/);
  assert.match(CSS, /@media \(max-height: 520px\) \{[\s\S]*?\.zjrev__skip \{ min-height: max\(\.44rem, 32px\); \}/);
  // 卡面是竖排（图 / 名 / 稀有度 / 描述），不再是「图 | 文」两列
  assert.match(CSS, /\.zjrev__card \{[^}]*display: flex; flex-direction: column;/);
});

test('敌方惊变: 揭晓只在「新抽到」时触发（重连不会把已经抽过的卡重放）', () => {
  assert.match(GAME_SRC, /const enemyDrawKey = enemyJibian && enemyJibian\.card\s*\n?\s*\? `\$\{enemyJibian\.round\}:\$\{Array\.isArray\(enemyJibian\.cards\) \? enemyJibian\.cards\.length : 0\}` : null;/);
  assert.match(GAME_SRC, /const enemySeenRef = useRef\(enemyDrawKey\);/);
  assert.match(GAME_SRC, /if \(enemySeenRef\.current === enemyDrawKey\) return;/);
  assert.match(GAME_SRC, /<\\?\$\{EnemyJibianReveal\} key=\$\{enemyReveal\.key\} enemy=\$\{enemyReveal\}/);
});

// ---- ② 惊变一览 --------------------------------------------------------------------------------------
test('惊变一览: 本模式全部 99 张按稀有度分组，已拥有的打勾，关闭不改变任何东西', () => {
  assert.equal(POOL.length, 99, 'the mode\'s own pool');
  assert.equal(jibianPoolOf(MODE_ID).length, 99, 'read from config, not from any pack data');
  assert.equal(jibianPoolOf('mode_single_normal').length, 0, 'no 惊变 pool outside 炸惊');
  assert.deepEqual(jibianPoolOf(MODE_ID).map((c) => c.effectId).slice(0, 1), [POOL[0].effectId], 'the pool order is kept');

  const owned = [POOL[0].effectId, POOL[3].effectId];
  const view = JibianCodexView({ pool: jibianPoolOf(MODE_ID), owned, onClose: () => {} });
  assert.equal(view.props['data-testid'], 'jibian-codex');
  // groups: five rarities in order, counts add up to the pool, each group's count is its own list length
  const groups = byClass(view, 'zjcodex__group');
  const counts = groups.map((g) => Number(textOf(byTestId(g, `jibian-codex-count-${g.props['data-rarity']}`))));
  assert.equal(counts.reduce((a, b) => a + b, 0), 99, 'all 99 are listed exactly once');
  const expected = jibianPoolGroups(jibianPoolOf(MODE_ID)).map((g) => g.cards.length);
  assert.deepEqual(counts, expected);
  assert.deepEqual(groups.map((g) => g.props['data-rarity']), ['normal', 'rare', 'epic', 'legend', 'hidden']);
  assert.equal(byTestId(view, 'jibian-codex-count-normal').props['data-testid'], 'jibian-codex-count-normal');

  // owned rows carry the tick, the others do not; the header total counts the owned ones
  const ownedRows = byClass(view, 'zjcodex__row').filter((r) => r.props.class.includes('is-owned'));
  assert.equal(ownedRows.length, 2, 'two cards ticked');
  assert.equal(byClass(byClass(view, 'zjcodex__row')[0], 'zjcodex__box')[0].props.children != null, true);
  for (const id of owned) {
    const row = byTestId(view, `jibian-codex-card-${id}`);
    assert.ok(row, `${id} is listed`);
    assert.ok(row.props.class.includes('is-owned'), `${id} is ticked`);
  }
  assert.equal(textOf(byClass(view, 'zjcodex__total')[0]), '2');

  // closing is a pure prop call (the panel never touches the match)
  let closed = 0;
  const withClose = JibianCodexView({ pool: POOL, owned, onClose: () => { closed += 1; } });
  byClass(withClose, 'zjpanel__x')[0].props.onClick();
  assert.equal(closed, 1);
  assert.equal(byClass(view, 'zjpanel__x')[0].props['aria-label'], '关闭');

  // the wrapper resolves the pool from the room's modeId (no fetch, no pack data)
  const wrapped = JibianCodex({ modeId: MODE_ID, owned, onClose: () => {} });
  assert.equal(byClass(wrapped, 'zjcodex__group').length, 5);
  // 顶栏那颗胶囊（业主 2026-10-29 第三次改版：照原版拆开）：左锻造器数、右击杀数，有没决定的锻造器时右上角红点
  const btn = ModeToolsButton({ forge: 2, kills: 37, per: 40, rolled: true, onClick: () => {} });
  assert.equal(btn.props['data-testid'], 'zj-tools');
  assert.equal(btn.props.title, '锻造器 2');
  assert.equal(byTestId(btn, 'zj-tools-forge').props.children, 2);
  assert.equal(byTestId(btn, 'zj-tools-kills').props.children, 37);
  assert.ok(byTestId(btn, 'zj-tools-dot'), 'an undecided forge shows the red dot');
  assert.equal(byTestId(ModeToolsButton({ forge: 2, kills: 37, rolled: false }), 'zj-tools-dot'), undefined,
    'no dot once every forge is decided');
  // 「已选惊变 / 惊变一览」不再进顶栏：左下角那颗独立键（与角落键同尺寸）打开同一个面板
  const jbBtn = JibianHudButton({ count: 2 });
  assert.equal(jbBtn.props['data-testid'], 'zj-jibian');
  assert.equal(byTestId(jbBtn, 'zj-jibian-n').props.children, 2, 'the owned count rides on the key');
  assert.equal(byTestId(JibianHudButton({ count: 0 }), 'zj-jibian-n'), undefined, 'no count chip at zero');
  // …the game screen mounts that one button as the TopBar's modeEntry slot and opens the panel with it (no corner .zjbtn).
  // 业主 2026-10-29 第三次改版：局内**直接挂** ui/jibian.js 的 JibianPanel（单层三页签），没有外层页签、不挂一览。
  assert.match(GAME_SRC, /modeEntry=\$\{forgeInfo \|\| jibianShown \? html`<\$\{ModeToolsButton\}/);
  assert.match(GAME_SRC, /<\$\{JibianPanel\} jibian=\$\{jibianShown\} enemy=\$\{enemyJibian\}/);
  assert.match(GAME_SRC, /<\$\{JibianHudButton\} count=\$\{jibianCount\} open=\$\{zjToolsOpen\}/);
  assert.doesNotMatch(GAME_SRC, /JibianButton|JibianCodexButton|JibianCodexView|<\$\{ModeToolsPanel\}/,
    'the in-match panel is one level: no 一览 page, no second tab row');
  // 一览的渲染器仍然导出（局外页面用），局内不挂它
  assert.equal(typeof JibianCodexView, 'function');
  assert.equal(typeof JibianCodex, 'function');
});

test('惊变一览: 没有牌库时不留一页空白（加载中的一句话），也不会崩', () => {
  const empty = JibianCodexView({ pool: [], owned: [] });
  assert.equal(byClass(empty, 'zjcodex__group').length, 0);
  assert.equal(textOf(byClass(empty, 'zjpanel__none')[0]), '加载中');
  // an owned id that is not in this pool (e.g. a stale save) is simply not listed
  const stale = JibianCodexView({ pool: POOL.slice(0, 2), owned: ['jibian_nope'] });
  assert.equal(byClass(stale, 'zjcodex__row').length, 2);
  assert.equal(byClass(stale, 'zjcodex__row').filter((r) => r.props.class.includes('is-owned')).length, 0);
});

// ---- ③ 重抽 ------------------------------------------------------------------------------------------
const draftSp = (over = {}) => normalizeSp({
  family: 'jibian', name: '惊变阶段', desc: '选择一项惊变', untimed: true, turn: 'me', order: ['me'], picks: {},
  cards: [
    { idx: 0, kind: 'jibian', id: 'jibian_a', name: '卡A', desc: '甲', rarity: 'normal' },
    { idx: 1, kind: 'jibian', id: 'jibian_b', name: '卡B', desc: '乙', rarity: 'rare' },
    { idx: 2, kind: 'jibian', id: 'jibian_c', name: '卡C', desc: '丙', rarity: 'epic' },
  ],
  ...over,
});

test('重抽: 每张卡一个键、显示剩余次数、0 次禁用；点击只报槽位，发消息的是 gameActions 的 g.cardRefresh', () => {
  const asked = [];
  const view = (o = {}) => JibianDraftView({ sp: draftSp(), myId: 'me', solo: true, rerollsLeft: 4, onReroll: (i) => asked.push(i), ...o });

  const tree = view();
  const buttons = find(tree, (v) => hasClass(v, 'zjcard__reroll'));
  assert.equal(buttons.length, 3, 'one reroll per offered card');
  assert.deepEqual(buttons.map((b) => b.props['data-testid']), ['jibian-reroll-0', 'jibian-reroll-1', 'jibian-reroll-2']);
  assert.deepEqual(buttons.map((b) => b.props.disabled), [false, false, false], '4 left: all lit');
  assert.ok(textOf(buttons[0]).includes('重抽'));
  assert.ok(textOf(buttons[0]).includes('4'), 'the remaining count is on the button');
  buttons[1].props.onClick({ stopPropagation: () => {} });
  assert.deepEqual(asked, [1], 'the card reports its own slot');

  // the server's count drives the button: 3 left → 3, 0 left → every card disabled and the click is inert
  assert.ok(textOf(find(view({ rerollsLeft: 3 }), (v) => hasClass(v, 'zjcard__reroll'))[0]).includes('3'));
  const none = find(view({ rerollsLeft: 0 }), (v) => hasClass(v, 'zjcard__reroll'));
  assert.deepEqual(none.map((b) => b.props.disabled), [true, true, true], '0 left: disabled, not hidden');
  const asked2 = [];
  const zero = JibianDraftView({ sp: draftSp(), myId: 'me', solo: true, rerollsLeft: 0, onReroll: (i) => asked2.push(i) });
  find(zero, (v) => hasClass(v, 'zjcard__reroll'))[0].props.onClick({ stopPropagation: () => {} });
  assert.deepEqual(asked2, [], 'a disabled button cannot send');

  // in flight: every reroll is held until the request settles
  const busy = find(view({ rerollBusy: 0 }), (v) => hasClass(v, 'zjcard__reroll'));
  assert.deepEqual(busy.map((b) => b.props.disabled), [true, true, true]);

  // not my turn / already picked: no reroll buttons at all (nothing to redraw)
  assert.equal(find(view({ sp: draftSp({ picks: { me: 1 }, taken: { 1: 'me' } }) }), (v) => hasClass(v, 'zjcard__reroll')).length, 0);
  assert.equal(find(view({ solo: false, sp: draftSp({ turn: 'other', order: ['other', 'me'] }) }), (v) => hasClass(v, 'zjcard__reroll')).length, 0);
  // without the protocol hook the button is not drawn at all (the pre-T5 shape of this overlay)
  assert.equal(find(view({ onReroll: null }), (v) => hasClass(v, 'zjcard__reroll')).length, 0);

  // the request itself: `g.cardRefresh { idx }`, errors toasted from ERR_TEXT by act() (no new string)
  assert.match(ACTIONS_SRC, /cardRefresh: \(idx\) => act\('g\.cardRefresh', \{ idx \}, \{ sfx: 'refresh' \}\),/);
  // …and it is only wired while the protocol actually carries the key: C2S is the single source of truth, so engine-core's
  // T5 flips the button on without another client change (no button that a BAD_MSG would refuse)
  assert.match(GAME_SRC, /onReroll=\$\{C2S\['g\.cardRefresh'\] \? async \(i\) => \{ setJibianRerollBusy\(i\); await actions\.cardRefresh\(i\); setJibianRerollBusy\(null\); \} : null\}/);
  assert.match(GAME_SRC, /import \{ C2S \} from '\.\.\/\.\.\/\.\.\/shared\/protocol\.js';/);
  assert.match(GAME_SRC, /rerollsLeft=\$\{jibianOwn && Number\.isInteger\(jibianOwn\.rerollsLeft\) \? jibianOwn\.rerollsLeft : 0\}/);
  // the protocol note travels with the code (the key name is engine-core's T5)
  assert.match(ACTIONS_SRC, /shared\/protocol\.js/);
  // the gate's subject really exists now (T5 landed): if that entry is renamed or dropped, this client test says so first
  assert.equal(typeof C2S['g.cardRefresh'], 'object', 'shared/protocol.js carries g.cardRefresh');
});
