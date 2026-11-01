// test/ui/zhajing-forge.test.js — 炸惊模拟 T13 的三件（2026-10-28 晚）
//
//   ① 锻造器 UI（业主 2026-10-14；engine-core T11 落地）：HUD 按钮 + 悬浮窗 + 计数 + 已锻造面板。
//      数据只来自 `m.private.forge { count, killsPaid, elites, per, forged, rolled }`（服务端权威，engine-core 回执），
//      点一张卡发 `g.forgeTake { optId, rarity }`（两个字段都必须带，rarity 与 `rolled.rarity` 一致）；
//      还有存货就留在原地接下一组，最后一个才关；拿到新锻造器不主动弹窗；`gd.zhajing` 之外不画按钮。
//   ② 观战队友惊变：面板显示被观战者的惊变（数据 = 效果栏那份 `field.effects`，零新协议），「我方」页变「TA 的惊变」。
//   ③ 炸惊档预填：`data/zjDefaultLoadout.json` 的 `byBaseId`（83 条 `_a`）——本机无存档时预填，等于记录默认值的条目
//      不产生（与「只发非默认项」一致）。
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

const { data, getChess } = await import('../../public/js/data.js');
await data.load('chess');
await data.load('config');
await data.load('zjDefaultLoadout');
const F = await import('../../public/js/ui/forge.js');
const { ForgeButtonView, ForgedChipView, ForgedPanelView, KillCounter, forgeOf, cardsOf, forgeUi, forgeOpen, forgeClose, forgedToggle } = F;
const { FORGE_RARITY, FORGE_KILLS_PER, FORGE_OPTIONS, forgedEntries } = await import('../../shared/forgeData.js');
const { jibianFromEffects, JibianPanelView } = await import('../../public/js/ui/jibian.js');
const { zhajingRosterOf, zjPrefillEntries, recordsOf, chessOptions, effectiveChoice, setChoice } = await import('../../public/js/ui/loadoutModel.js');

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const GAME_SRC = read('public/js/screens/game.js');
const ACTIONS_SRC = read('public/js/ui/gameActions.js');
const FORGE_CSS = read('public/css/screens/forge.css');
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'data/zjDefaultLoadout.json'), 'utf8'));

// ---- vnode helpers ----------------------------------------------------------------------------------
const PLAIN = ['ForgeButtonView', 'ForgePanelView', 'ForgeCardsView', 'ForgedChipView', 'ForgedPanelView', 'KillCounter'];
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && PLAIN.includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));
const reset = () => { forgeClose(); forgedToggle(false); };

/** A server-shaped forge block (engine-core 2026-10-28). */
const forgeOfServer = (over = {}) => ({
  count: 1, killsPaid: 40, elites: 1, per: FORGE_KILLS_PER,
  forged: { atk: { total: 100, count: 1 } },
  rolled: { rarity: 'normal', picks: ['atk', 'def', 'hp'][0] ? ['atk', 'def', 'hp'] : [] },
  ...over,
});

// =====================================================================================================
// ① 锻造器：只在炸惊出现 / 计数 / 已锻造 / 点击 / 接下一组 / 空态
// =====================================================================================================
test('锻造器: 按钮只在有 m.private.forge 时画（game.js 的门），没有这个块就没有按钮', () => {
  // game.js 用 `forgeInfo`（= forgeOf(priv.forge) 存在）当门；官方房 / 湮灭房整块不下发 ⇒ 不进这个分支
  assert.match(GAME_SRC, /const forgeOwn = !spectator && priv && priv\.forge \? priv\.forge : null;/);
  assert.match(GAME_SRC, /const forgeInfo = forgeShown \? forgeOf\(forgeShown\) : null;/);
  // 业主 2026-10-29：左侧那枚「已锻造」徽标已删除 —— 胶囊点开的整合面板（ForgedPanel）是唯一入口
  assert.doesNotMatch(GAME_SRC, /gm__forgecol/);
  assert.match(GAME_SRC, /modeEntry=\$\{forgeInfo \|\| jibianShown \? html`<\$\{ModeToolsButton\}/);
  // 零件本身对空输入是安全的：0 个、没有 rolled
  const empty = forgeOf(null);
  assert.deepEqual([empty.count, empty.per, empty.rolled], [0, FORGE_KILLS_PER, null]);
  assert.deepEqual(cardsOf(null), { rarity: 'normal', picks: [] });
  const view = ForgeButtonView({ forge: null, ui: { open: false, picked: null } });
  assert.equal(byTestId(view, 'forge-button').props['aria-disabled'], 'true');
  assert.equal(byTestId(view, 'forge-panel'), undefined, 'no stock → nothing to pick');
});

test('锻造器: 计数就在按钮上；开着且有 rolled 才是悬浮窗；三张卡来自共享表', () => {
  reset();
  const forge = forgeOfServer({ count: 3 });
  const view = ForgeButtonView({ forge, ui: { open: true, picked: null } });
  assert.ok(textOf(byTestId(view, 'forge-button')).includes('3'), 'the count badge');
  const panel = byTestId(view, 'forge-panel');
  assert.ok(panel, 'the panel is drawn while open');
  assert.equal(byTestId(view, 'forge-left').props.children, 3, '剩余 = 手里还有几个');
  assert.equal(textOf(panel).includes('普通'), true, 'the rarity name comes from shared/forgeData');
  const cards = find(panel, (v) => typeof v.props?.class === 'string' && v.props.class.split(/\s+/).includes('fcard'));
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.props['data-testid']), ['forge-card-atk', 'forge-card-def', 'forge-card-hp']);
  for (const c of cards) assert.ok(textOf(c).length > 0, 'name + value + hint are printed');
  // 已锻造那一排（服务端 forged map → forgedEntries）
  const forged = byTestId(panel, 'forge-forged');
  assert.ok(forged, 'the 已锻造 strip');
  assert.equal(textOf(forged).includes('已锻造'), true);
  assert.equal(FORGED_PILLS(forged).length, 1);
  function FORGED_PILLS(tree) { return find(tree, (v) => hasClass(v, 'fged__pill')); }
  // 空态：count 0 + rolled null → 按钮在，窗不开；已锻造面板给空话
  const idle = ForgeButtonView({ forge: forgeOfServer({ count: 0, rolled: null }), ui: { open: true, picked: null } });
  assert.equal(byTestId(idle, 'forge-panel'), undefined);
  assert.ok(textOf(ForgedPanelView({ entries: null })).includes('还没有锻造过'));
});

test('锻造器: 点一张卡发 g.forgeTake { optId, rarity }（rarity 必带）', () => {
  reset();
  const taken = [];
  const forge = forgeOfServer({ count: 2, rolled: { rarity: 'epic', picks: ['crit', 'vamp', 'block'] } });
  const view = ForgeButtonView({ forge, ui: { open: true, picked: null }, onTake: (optId, rarity) => taken.push([optId, rarity]) });
  byTestId(view, 'forge-card-vamp').props.onClick();
  assert.deepEqual(taken, [['vamp', 'epic']], 'the panel reports the card id and ITS rarity');
  // 动作层：一条消息，两个字段
  assert.match(ACTIONS_SRC, /forgeTake: \(optId, rarity\) => act\('g\.forgeTake', \{ optId, rarity \}, \{ sfx: 'pick' \}\),/);
  // 协议层只收三档
  assert.deepEqual(FORGE_RARITY.map((r) => r.id), ['normal', 'epic', 'legend']);
});

test('锻造器: 还有存货就留在原地接下一组，最后一个才关窗；拿到新的不主动弹', () => {
  reset();
  // 手里 2 个：点一张之后窗仍然开着（等下一帧 rolled 换组），picked 被清掉
  forgeOpen();
  const two = ForgeButtonView({ forge: forgeOfServer({ count: 2 }), ui: forgeUi(), onTake: () => {} });
  byTestId(two, 'forge-card-atk').props.onClick();
  assert.deepEqual([forgeUi().open, forgeUi().picked], [true, null], 'still open, selection cleared for the next group');
  // 手里 1 个：点了就关
  forgeOpen();
  const one = ForgeButtonView({ forge: forgeOfServer({ count: 1 }), ui: forgeUi(), onTake: () => {} });
  byTestId(one, 'forge-card-atk').props.onClick();
  assert.equal(forgeUi().open, false, 'the last one closes the window');
  // 拿到新的锻造器不会自己开窗：窗只由玩家点按钮（或这里的 forgeOpen）打开
  reset();
  assert.equal(forgeUi().open, false);
  const idle = ForgeButtonView({ forge: forgeOfServer({ count: 3 }), ui: forgeUi() });
  assert.equal(forgeUi().open, false, 'a new forge never opens the window by itself');
  assert.equal(byTestId(idle, 'forge-panel'), undefined);
});

test('锻造器: 击杀计数器读 stats.kills 与 forge.per；已锻造徽标只在锻造过后出现', () => {
  const kill = KillCounter({ kills: 57, per: FORGE_KILLS_PER });
  assert.equal(byTestId(kill, 'forge-kills') != null, true);
  assert.ok(textOf(kill).includes('57'));
  assert.ok(textOf(kill).includes(`${57 % FORGE_KILLS_PER}/${FORGE_KILLS_PER}`), 'the 本档/每档 read-out');
  // tooltip 是那句「再击败 m 名」——tParts 的富文本插了 <b>，所以拼起来看
  assert.ok(textOf(kill.props.title).includes('再击败'), 'the tooltip sentence');
  assert.ok(textOf(kill.props.title).includes(String(FORGE_KILLS_PER - (57 % FORGE_KILLS_PER))));
  // 徽标：没锻造过 = null；锻造过 = 有 chip，点开只读面板
  assert.equal(ForgedChipView({ forge: null, ui: { forgedOpen: false } }), null);
  const chip = ForgedChipView({ forge: forgeOfServer(), ui: { forgedOpen: true } });
  assert.ok(byTestId(chip, 'forged-chip'));
  const panel = byTestId(chip, 'forged-panel');
  assert.ok(panel, 'the read-only panel');
  const rows = find(panel, (v) => hasClass(v, 'fgedov__row'));
  assert.equal(rows.length, forgedEntries(forgeOfServer().forged).length);
  assert.ok(textOf(panel).includes('共')); // 共 {n} 次锻造
});

// =====================================================================================================
// ② 观战队友惊变
// =====================================================================================================
test('观战: 队友的惊变从 field.effects 读出来，「我方」页变「TA 的惊变」，自己的 private 不动', () => {
  const modeId = 'mode_single_zhajing';
  const pool = data.get('config').modes[modeId].jibian.pool;
  const card = pool[0];
  const cardId = card.effectId || card.id;
  // 观战通道：一条惊变 ref（id = `<cardId>#<uid>`）、一条别的效果（策略）、一条重复的惊变
  const effects = [
    { id: `${cardId}#7`, name: card.name, desc: card.desc, iconKind: 'choice', iconId: cardId },
    { id: 'band_x#3', name: '某策略', desc: '', iconKind: 'band', iconId: 'band_x' },
    { id: `${cardId}#9`, name: card.name, desc: card.desc },
  ];
  const watched = jibianFromEffects(effects, modeId);
  assert.equal(watched.cards.length, 1, 'only 惊变 refs, de-duplicated');
  assert.equal(watched.cards[0].id, cardId);
  assert.equal(watched.cards[0].rarity, card.rarity, 'rarity/flavour come from the mode pool');
  assert.deepEqual(watched.owned, [cardId]);
  // 面板：观战时第一页是「TA 的惊变」，敌方/羁绊不变
  const panel = JibianPanelView({ jibian: watched, watchingName: '某位博士', enemy: { cards: [] } });
  const tabs = find(panel, (v) => v.props?.role === 'tab');
  assert.deepEqual(tabs.map((x) => textOf(x).replace(/\d+$/, '')), ['TA 的惊变', '敌方惊变', '惊变羁绊']);
  assert.equal(textOf(panel).includes('某位博士'), true, 'the watched name in the head');
  // 自己的面板仍是「我的惊变」
  const own = JibianPanelView({ jibian: watched, enemy: null });
  assert.equal(find(own, (v) => v.props?.role === 'tab')[0].props['aria-selected'], 'true');
  assert.ok(textOf(find(own, (v) => v.props?.role === 'tab')[0]).startsWith('已选惊变'));
  // game.js 的口径：观战时看被观战者，否则看自己
  assert.match(GAME_SRC, /const watchJibian = watchPid && Array\.isArray\(field\?\.effects\) \? jibianFromEffects\(field\.effects, pub\?\.modeId\) : null;/);
  assert.match(GAME_SRC, /const jibianShown = watchJibian \|\| jibianOwn;/);
  assert.match(GAME_SRC, /const jibianWatchName = watchJibian \? \(watchName \|\| '—'\) : null;/);
  assert.match(GAME_SRC, /watchingName=\$\{jibianWatchName\}/);
});

// =====================================================================================================
// ③ 炸惊档预填
// =====================================================================================================
test('预填: zjDefaultLoadout 的 83 条按名册折成 entries，等于记录默认值的条目一个都不留', () => {
  assert.equal(DATA.count, Object.keys(DATA.byBaseId).length);
  assert.equal(DATA.count, 83, 'data T14: 83 条（84 里那条没打 zhajing 标记的被滤掉）');
  const roster = zhajingRosterOf(data.list('chess'));
  const entries = zjPrefillEntries(DATA.byBaseId, roster, getChess);
  const ids = Object.keys(entries);
  assert.ok(ids.length > 0, 'something is prefilled');
  assert.ok(ids.length <= DATA.count);
  // 只收名册里的棋子位，且每个 id 都是 _a（base）形态
  const rosterIds = new Set(roster.map((c) => c.chessId));
  for (const id of ids) { assert.ok(rosterIds.has(id), `${id} is in the 99-record roster`); assert.match(id, /_a$/); }
  // 每条只带与默认不同的字段，并且模组对该干员合法
  for (const [id, e] of Object.entries(entries)) {
    const { base, golden } = recordsOf(id, getChess);
    const opt = chessOptions(base, golden);
    const cur = effectiveChoice({ [id]: e }, base, golden);
    if ('module' in e) { assert.ok(opt.modules.includes(e.module)); assert.notEqual(e.module, opt.defaultModule, `${id}: the default module is not stored`); }
    if ('skill' in e) { assert.notEqual(e.skill, opt.defaultSkill); }
    assert.equal(cur.changed, true, `${id}: a prefilled entry IS a change (else it should have been dropped)`);
  }
  // 与 setChoice 同一条语义：再设回默认值就消失
  const sample = ids[0];
  const { base, golden } = recordsOf(sample, getChess);
  const opt = chessOptions(base, golden);
  const back = setChoice({ [sample]: entries[sample] }, base, golden, { module: opt.defaultModule });
  assert.deepEqual(back, {}, 'back to the record default drops the entry (server checkLoadout agrees)');
  // 名册外的 id 被忽略
  assert.deepEqual(zjPrefillEntries({ chess_normal_a: { module: 'x' } }, roster, getChess), {});
});

test('预填: 本机有存档时以玩家为准；预填只喂炸惊档（普通档不读这张表）', () => {
  const sync = read('public/js/ui/loadoutSync.js');
  assert.match(sync, /function zjInitialEntries\(\) \{/);
  assert.match(sync, /const saved = loadoutStore\.get\(\)\.zjEntries \|\| \{\};\n  if \(Object\.keys\(saved\)\.length\) return saved;/);
  assert.match(sync, /const doc = data\.get\('zjDefaultLoadout'\);/);
  assert.match(sync, /if \(!doc \|\| typeof doc !== 'object' \|\| !doc\.byBaseId\) return saved;/);
  // 只在换到炸惊档时用（P1-1 起换档统一走 parked + target 的写法）
  assert.match(sync, /if \(want === 'zhajing'\) \{\n    data\.load\('zjDefaultLoadout'\);\n    loadoutStore\.set\(\{ \.\.\.parked, mode: 'zhajing', entries: zjInitialEntries\(\) \}\);/);
  // 预填那一段不碰 byChar / 官方档的持久化（它只是给炸惊档准备一份视图）
  const body = sync.slice(sync.indexOf('function zjInitialEntries()'), sync.indexOf('/**\n * Open the 干员调配 overlay'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body, /byChar|LOADOUT_PREF|setEntries/, 'the official loadout never runs through it');
  // data 层认得这个文件（不存在 = null，不画假数据）
  const dataSrc = read('public/js/data.js');
  assert.match(dataSrc, /zjDefaultLoadout: 'zjDefaultLoadout\.json',/);
});

// =====================================================================================================
// ④ 版式：真机两档与减动效（CSS 契约）
// =====================================================================================================
test('版式: HUD 一列在**左上**（业主 2026-10-28 验收）、矮屏从底部抬起、字号与触摸地板、减动效归零', () => {
  // 包里 .forge 与 .kills 同在左上区：我们原来错放在右上，这一条钉住它在左侧
  assert.match(FORGE_CSS, /\.gm__forgecol \{ position: absolute; left: 18px; top: calc\(92px \+ 1\.12rem \+ \.14rem\);/);
  assert.match(FORGE_CSS, /@media \(max-width: 760px\) \{ \.gm__forgecol \{ top: auto; bottom: calc\(210px \+ 1rem\); left: 12px; \} \}/);
  assert.doesNotMatch(FORGE_CSS, /\.gm__forgecol \{[^}]*right:/, 'never the right corner again');
  // 颜色照包里：主色是 token，三档稀有度是包里那三个确切值
  assert.match(FORGE_CSS, /\.forge__btn \{[^}]*color: var\(--mint-500\);/);
  assert.match(FORGE_CSS, /\.forge__n \{[^}]*background: var\(--mint-500\);/);
  assert.doesNotMatch(FORGE_CSS, /#17d9a0|#9fb6c6|#a879ff|#f2bd3e/, 'no hard-coded play-set green / old rarity hexes');
  assert.match(FORGE_CSS, /\.fcard \{ --fr: #9fb0ab;/);
  assert.match(FORGE_CSS, /\.fcard--epic \{ --fr: #b07dff; \}/);
  assert.match(FORGE_CSS, /\.fcard--legend \{ --fr: #ffc24b; \}/);
  // 包里的交互态：hover 上浮 / 按下回弹 / 图标转 12° / aria-disabled 降透明
  assert.match(FORGE_CSS, /\.forge__btn:hover \{[^}]*transform: translateY\(-\.015rem\);/);
  assert.match(FORGE_CSS, /\.forge__btn:active \{ transform: scale\(\.97\); \}/);
  assert.match(FORGE_CSS, /\.forge__btn:hover \.forge__icon \{ transform: rotate\(-12deg\) scale\(1\.1\); \}/);
  assert.match(FORGE_CSS, /\.forge__btn\[aria-disabled="true"\] \{ opacity: \.62; \}/);
  // 悬浮窗照包里：z-index 40 + 遮罩 rgba(4,7,6,.72)
  assert.match(FORGE_CSS, /\.forgeov \{ position: fixed; inset: 0; z-index: 40; display: grid; place-items: center;/);
  assert.match(FORGE_CSS, /\.forgeov__scrim \{ position: absolute; inset: 0; background: rgba\(4, 7, 6, \.72\); \}/);
  // 触摸地板：按钮 32px、徽标/窗口关闭键 24px
  assert.match(FORGE_CSS, /\.forge__btn \{[^}]*min-height: max\(\.44rem, 32px\);/);
  assert.match(FORGE_CSS, /\.fged__chip \{[^}]*min-height: max\(\.36rem, 24px\);/);
  assert.match(FORGE_CSS, /\.forgeov__x \{[^}]*width: max\(\.4rem, 24px\); height: max\(\.4rem, 24px\);/);
  // 字号都有像素地板
  const sizes = [...FORGE_CSS.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 12, `${sizes.length} font-size declarations`);
  assert.deepEqual(sizes.filter((v) => !/^max\(\d+px, calc\([\d.]+ \* var\(--t\)\)\)$/.test(v)), []);
  // 矮屏：卡片仍三列、提示行让位、窗口自己滚
  assert.match(FORGE_CSS, /@media \(max-height: 520px\) \{[\s\S]*?\.fcard__hint \{ display: none; \}/);
  // 减动效：抬升与过渡归零（写在文件末尾）
  const reduceAt = FORGE_CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceAt > 0);
  const reduceBlock = FORGE_CSS.slice(reduceAt);
  assert.match(reduceBlock, /\.fcard, \.fcard:hover \{ transform: none; transition: none; \}/);
  // 这一块里的 animation 只允许是 none（锻造器自己没有入场动画）
  for (const m of reduceBlock.matchAll(/animation:\s*([^;]+);/g)) assert.equal(m[1].trim(), 'none');
});

test('画法: 锻造器读共享数值表（不自己抄一份），面板上的稀有度/数值都由它折算', () => {
  const src = read('public/js/ui/forge.js');
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/shared\/forgeData\.js'/);
  assert.doesNotMatch(src, /value:\s*\{\s*normal:/, 'no second copy of the value table');
  // 九种选项都在共享表里（UI 只按 id 取）
  assert.equal(FORGE_OPTIONS.length, 9, 'shared/forgeData.js FORGE_OPTIONS');
  reset();
});
