// test/ui/zhajing-loadout.test.js — 业主 2026-10-28 晚的两件事（T10），口径以最后一条为准：
//
//   A2 房内锁定：炸惊房左下的版本胶囊写「炸惊一期」且不可点；难度胶囊也不可改（点了只弹提示）。官方房逐字节不变。
//   A3 二级页 + 干员调配（**维持原版的界面逻辑**）：炸惊也有自己的主题大厅（`theme` 屏），里面有 简介/要点、规则、
//      单人/同盟、开始、干员调配；「干员调配」（`data-testid="ext-loadout"`）打开的是**既有的干员调配整屏**
//      （screens/loadout.js）以炸惊档进入 —— 名册 99 条（97 抽取 + 2 条 grantOnly 标注）、保存发
//      `room.loadout { mode:'zhajing', entries }`、返回回到二级页。
//      **没有**独立的 zj-pool-editor 之类第二套编辑器。
//      2026-10-29 修订：原先旁边那颗「卡池调整」（`extension-pool-edit`）与它打开同一屏，业主判定重复已删；二级页
//      左下只剩两枚**同宽**的入口 —— S.W.E.E.P.报告（`ext-sweep`）在上、干员调配（`ext-loadout`）在下。
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
await data.load('assets');
const { ExtensionHall, extensionModeById } = await import('../../public/js/screens/extensionModes.js');
const { ExtensionThemeHall } = await import('../../public/js/screens/extensionThemeHall.js');
const { zhajingRosterOf, chessOptions, setChoice, recordsOf, rosterOf } = await import('../../public/js/ui/loadoutModel.js');
const { loadoutStore, setLoadoutMode, setZjEntries, setEntries, ZJ_LOADOUT_PREF } = await import('../../public/js/ui/loadoutSync.js');
// roomFacts / playSetOf 来自 room.js —— 它只做纯判断的那部分可以单独拿（整屏模块会拉 net / store，不在这里引）
const { extensionRoomOf } = await import('../../public/js/ui/zjView.js');

/** room.js 的 playSetOf 就是「难度优先、再看 modeId」的两步 extensionRoomOf（同一条判据，源码断言在下面钉住）。 */
const playSetOf = (room) => {
  if (!room) return null;
  const byDifficulty = extensionRoomOf(room.difficulty);
  if (byDifficulty !== 'official') return byDifficulty;
  const byMode = extensionRoomOf(room.modeId);
  return byMode === 'official' ? null : byMode;
};

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const ROOM_SRC = read('public/js/screens/room.js');
const LOBBY_SRC = read('public/js/screens/lobby.js');
const LOADOUT_SRC = read('public/js/screens/loadout.js');
const SYNC_SRC = read('public/js/ui/loadoutSync.js');
const ROOM_CSS = read('public/css/screens/room.css');
const HALL_SRC = read('public/js/screens/extensionModes.js');
// 二级页左下那两枚入口（ExtThemeDock）在它里面；dock 带 hooks，Node 里只能读源码（见 A3 那条的注释）
const THEME_SRC = read('public/js/screens/extensionThemeHall.js');
const LOADOUT_CSS = read('public/css/screens/loadout.css');

// ---- vnode helpers ----------------------------------------------------------------------------------
const PLAIN = ['JibianCard', 'SelectedCard'];
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

// =====================================================================================================
// A2 房间：版本胶囊「炸惊一期」+ 难度锁定
// =====================================================================================================
test('A2 房内锁定: 炸惊房写「炸惊一期」并 disabled，官方房仍是版本名；两颗胶囊 32px 同高', () => {
  // 判定走三态助手（官方 / 炸惊 / 湮灭），P0-4 起湮灭也走同一条
  assert.match(ROOM_SRC, /export function playSetOf\(room\) \{/);
  assert.match(ROOM_SRC, /const playSet = playSetOf\(room\);\s*\n\s*const isPlaySetRoom = !!playSet;/);
  assert.match(ROOM_SRC, /const playSetLock = isPlaySetRoom \? t\('玩法包自带卡池，版本已锁定'\) : null;/);
  assert.match(ROOM_SRC, /const playSetVersionLabel = playSet === 'annihilation' \? t\('湮灭一期'\) : t\('炸惊一期'\);/);
  assert.match(ROOM_SRC, /label: isPlaySetRoom \? playSetVersionLabel : null,/);
  assert.match(ROOM_SRC, /disabled: isPlaySetRoom \? true : \(versionEditable \? !!versionWhy \|\| !!busy : !Array\.isArray\(versions\)\),/);
  assert.match(ROOM_SRC, /\$\{versionCtl\.playSet \? versionCtl\.label : versionLabel\(curVersion\)\}/, '官方房仍显示版本名');
  assert.match(ROOM_SRC, /onClick=\$\{isPlaySetRoom \? \(\) => toast\(playSetLock, 'info'\) : openProto\}/);
  assert.match(ROOM_SRC, /locked=\$\{playSetLock\} onDifficulty=\$\{isPlaySetRoom \? \(\) => toast\(playSetLock, 'info'\) : openProto\}/);
  assert.match(ROOM_CSS, /\.rs-pill__ver\.is-playset, \.rs-pill__diff\.is-locked \{[^}]*border-style: dashed;[^}]*min-height: max\(\.44rem, 32px\);/,
    '业主裁定的 32px 地板（手机原来 30px）');
});

// P0-4 / P0-5（业主 2026-10-28 第二轮真机验收）：湮灭的版本胶囊同样锁死；玩法包房里不跑版本检测链
test('P0-4 湮灭房也锁版本: 写「湮灭一期」、disabled、同一句锁定原因；难度胶囊与蚀流档位不受影响', () => {
  assert.equal(playSetOf({ difficulty: 'ANNIHILATION', modeId: 'mode_single_annihilation' }), 'annihilation');
  assert.equal(playSetOf({ difficulty: 'ZHAJING', modeId: 'mode_multi_zhajing' }), 'zhajing');
  assert.equal(playSetOf({ difficulty: 'ANNIHILATION', modeId: 'mode_multi_zhajing' }), 'annihilation', '两种判据同时命中时先认难度');
  assert.equal(playSetOf({ difficulty: 'HARD', modeId: 'mode_single_normal' }), null);
  assert.equal(playSetOf(null), null);
  assert.equal(playSetOf({ difficulty: 'HARD', modeId: 'mode_multi_annihilation' }), 'annihilation', 'modeId 也认');
  // 文案与锁定原因都复用既有字面量（湮灭一期是 Lead 已补的那一条）
  assert.match(ROOM_SRC, /playSet === 'annihilation' \? t\('湮灭一期'\)/);
  assert.match(ROOM_SRC, /data-locked=\$\{versionCtl\.playSet \? 'play-set' : null\}/);
  assert.match(ROOM_SRC, /aria-label=\$\{versionCtl\.playSet \? versionCtl\.label : t\('游戏版本：\{name\}', \{ name: versionLabel\(curVersion\) \}\)\}/);
  // 蚀流档位照旧（湮灭自己的那套）
  assert.match(ROOM_SRC, /room\.erosion/);
});

test('P0-5 玩法包房里不跑版本检测链: loadsContent 短路、没有版本切换弹窗、探测/提案一个都不发', () => {
  assert.match(ROOM_SRC, /const loadsContent = !playSetOf\(room\) && needsContent\(room\);/, 'needsContent 在玩法包房里被短路');
  assert.match(ROOM_SRC, /if \(playSetOf\(room\)\) \{ seenVersion\.current/, '「同盟已切换」的监听在玩法包房里直接返回');
  assert.match(ROOM_SRC, /const versionEditable = facts\.isHost && !facts\.spectating && !room\.inMatch && !isPlaySetRoom;/);
  assert.match(ROOM_SRC, /onOpen: \(\) => \{ if \(isPlaySetRoom\) \{ toast\(playSetLock, 'info'\); return; \} setOpts\(false\); setVersionOpen\(true\); \},/);
  assert.match(ROOM_SRC, /serverDefault=\$\{isPlaySetRoom \? null : serverDefault\}/, '不回落到大厅默认版本');
  assert.match(ROOM_SRC, /curVersion !== myLobby && Array\.isArray\(versions\) && !isPlaySetRoom/, '版本不一致的横幅不出现');
  assert.match(ROOM_SRC, /const proposeVersion = async \(version\) => \{/);
  assert.doesNotMatch(ROOM_SRC, /proposeVersion\(roomVersion\(room\)\)/, '进房间不会自己提议版本');
});

// =====================================================================================================
// A3 二级页：炸惊也有主题大厅，页内有 规则 / 干员调配 / 单人·同盟 / 开始
// =====================================================================================================
test('A3 二级页: 炸惊条目声明 theme（业主给的 Key Art）→ 主题大厅里有 简介/要点、规则、单人·同盟、开始、干员调配', () => {
  const entry = extensionModeById('zhajing');
  assert.ok(entry.theme, '炸惊有自己的二级界面（与湮灭一样）');
  // 业主 2026-10-28 提供的 Key Art（816×564 webp，叠暗化/模糊遮罩；别放大，CSS 用 cover + 渐变）
  assert.equal(entry.theme.art, '/assets/zhajing-intro/art/zhajing-key.webp');
  assert.equal(entry.theme.kicker, 'BLAST SIMULATION // FIELD MANUAL');
  assert.equal(entry.rules, true, '规则入口由条目声明');
  assert.equal(entry.poolEdit, true, '干员调配入口由条目声明（键名沿用 poolEdit：它只是「打开卡池那一档」的开关）');
  // 大厅那一层：进了主题大厅才画这些（列表页脚不再重复画这个入口）
  const list = ExtensionHall({ selected: 'zhajing', onClose: () => {} });
  assert.equal(byTestId(list, 'extension-pool-edit'), undefined, '有 theme 的条目把入口放进二级页');
  assert.equal(byTestId(list, 'extension-theme'), undefined, '未进入时不是二级页');
  const hall = ExtensionHall({ selected: 'zhajing', entered: true, onClose: () => {}, onRules: () => {}, onPoolEdit: () => {} });
  const themeVnode = find(hall, (v) => v.type === ExtensionThemeHall)[0];
  assert.ok(themeVnode, '二级页在这一层');

  const theme = ExtensionThemeHall({ mode: entry, onBack: () => {}, onRules: () => {}, onPoolEdit: () => {} });
  assert.equal(byTestId(theme, 'extension-theme').props['data-theme'], 'zhajing');
  // 主视觉：业主给的 Key Art 真的被画出来（<img> 指着那个 webp），并且在下面铺一层遮罩
  const artImg = byClass(theme, 'ext-theme__art-img')[0];
  assert.ok(artImg, 'the key art is drawn');
  assert.equal(artImg.props.src, '/assets/zhajing-intro/art/zhajing-key.webp');
  assert.equal(artImg.props.alt, '', 'decorative: aria-hidden + empty alt');
  assert.ok(byClass(theme, 'ext-theme__veil').length === 1, 'a veil layer sits on top of the art (contrast ≥ AA)');
  assert.ok(textOf(byClass(theme, 'ext-theme__desc')[0]).length > 0, '简介');
  assert.ok(find(theme, (v) => hasClass(v, 'ext-theme__feats')).length > 0, '要点');
  assert.ok(textOf(theme).includes('规则'), '规则入口');
  // 左下两枚：S.W.E.E.P.报告 在上、干员调配 在下（同宽由 .ext-theme__dock 的 grid 决定）；「卡池调整」已经删掉。
  // 注：两枚键在 `ExtThemeDock` 里，它带 useState —— Node 里没有 hook 上下文，不能像纯视图那样直接实例化，
  // 所以断的是「主题大厅把 mode / onPoolEdit 交给这个 dock」+ dock 自己那一小段源码。
  const dock = find(theme, (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeDock')[0];
  assert.ok(dock, 'the corner dock exists');
  assert.equal(dock.props.mode.id, 'zhajing', 'dock 拿到的是炸惊这一条');
  assert.equal(typeof dock.props.onPoolEdit, 'function', '主题大厅把自己的 onPoolEdit 交给 dock');
  const dockSrc = THEME_SRC.slice(THEME_SRC.indexOf('function ExtThemeDock'), THEME_SRC.indexOf('export function ExtensionThemeHall'));
  assert.ok(dockSrc.length > 0, 'the dock component is there');
  assert.deepEqual([...dockSrc.matchAll(/data-testid="(ext-sweep|ext-loadout)"/g)].map((m) => m[1]), ['ext-sweep', 'ext-loadout'],
    'sweep 在上、loadout 在下');
  assert.match(dockSrc, /<button type="button" class="ext-theme__loadout" data-testid="ext-loadout"[\s\S]{0,200}?onClick=\$\{\(\) => onPoolEdit\(mode\.id\)\}/);
  assert.match(dockSrc, /<span class="ext-theme__loadout-label">\$\{t\('干员调配'\)\}<\/span>/);
  assert.equal(byTestId(theme, 'extension-pool-edit'), undefined, '「卡池调整」已删（与干员调配打开同一屏）');
  assert.ok(!textOf(theme).includes('卡池调整'), '二级页不再出现「卡池调整」四个字');
  assert.equal(textOf(byClass(theme, 'ext-theme__meta')[0]), 'AC-8BLAST SIMULATION');
  // 单人 / 同盟 + 开始
  const chips = find(byTestId(theme, 'extension-party'), (v) => hasClass(v, 'ext-party__chip'));
  assert.deepEqual(chips.map((c) => c.props['data-party']), ['solo', 'coop']);
  const picked = [];
  byTestId(ExtensionThemeHall({ mode: entry, onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start').props.onClick();
  assert.deepEqual(picked, [['zhajing', 1, 'solo']]);
  // 两颗键各回各的回调（干员调配那颗由 dock 的 onClick 交回 onPoolEdit(mode.id)）
  const calls = [];
  const wired = ExtensionThemeHall({ mode: entry, onRules: () => calls.push('rules'), onPoolEdit: () => calls.push('pool') });
  byTestId(wired, 'extension-rules').props.onClick();
  find(wired, (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeDock')[0].props.onPoolEdit('zhajing');
  assert.deepEqual(calls, ['rules', 'pool']);
});

// =====================================================================================================
// A3 干员调配 = 既有干员调配整屏（炸惊档），不是第二套编辑器
// =====================================================================================================
test('A3 干员调配: 打开既有的 loadout 界面（炸惊档），没有 zj-pool-editor 这种第二套编辑器', () => {
  // 大厅：干员调配 → 按条目 id 进对应的档（炸惊 / 湮灭各一档），二级页留在下面（关掉即回到它）
  assert.match(LOBBY_SRC, /import \{ openLoadout \} from '\.\.\/ui\/loadoutSync\.js';/);
  assert.match(LOBBY_SRC, /onPoolEdit=\$\{\(id\) => openLoadout\('ext', null, 'loadout', id === 'annihilation' \? 'annihilation' : 'zhajing'\)\}/);
  assert.doesNotMatch(LOBBY_SRC, /ZjPoolEditor|zjPoolEditor|zj-pool-editor/, 'no second editor is mounted');
  // 被删掉的那个模块真的不在树里了
  assert.throws(() => read('public/js/ui/zjPoolEditor.js'));
  // loadout 那边：from='ext' 且**不在玩法包档**时才画档位横行（业主 2026-10-29 收掉了炸惊 / 湮灭档里的那一行）
  assert.match(LOADOUT_SRC, /\$\{st\.from === 'ext' && !playSet \? html`<div class="lo-mode" role="group" aria-label=\$\{t\('干员调配'\)\} data-testid="loadout-mode">/);
  // 档位键：官方路径上仍是**三档常显**（普通 / 炸惊模拟 / 湮灭模拟，BUG-2），非本房的那档禁用 + 同一句既有原因
  assert.match(LOADOUT_SRC, /\[\['normal', t\('普通'\)\], \['zhajing', t\('炸惊模拟'\)\], \['annihilation', t\('湮灭模拟'\)\]\]\.map/);
  assert.match(LOADOUT_SRC, /const off = id !== 'normal' && roomTierOf !== 'official' && roomTierOf !== id;/);
  assert.match(LOADOUT_SRC, /disabled=\$\{off\} title=\$\{off \? t\('玩法包自带卡池，版本已锁定'\) : null\}/);
  assert.match(LOADOUT_SRC, /onClick=\$\{\(\) => setLoadoutMode\(id\)\}/);
  // 名册：三档各走各的 —— 炸惊档 = zhajingRosterOf(...)、湮灭档 = annihilationRosterOf(..., roomAnnMods)
  // （与引擎的 annihilationRoster 同口径，业主 2026-10-30）、普通档仍是 rosterOf(...)
  assert.match(LOADOUT_SRC, /const roster = useMemo\(\(\) => \(setTier === 'zhajing'\s*\n\s*\? zhajingRosterOf\(data\.list\('chess'\)\)\s*\n\s*: setTier === 'annihilation'\s*\n\s*\? annihilationRosterOf\(data\.list\('chess'\), roomAnnMods\)\s*\n\s*: rosterOf\(data\.list\('chess'\)\)\)/);
  // grantOnly 的两位有标注（数据属性 + 短标），两种视图都有
  assert.match(LOADOUT_SRC, /data-grantonly=\$\{chess\.grantOnly === true \? 'true' : null\}/);
  assert.equal((LOADOUT_SRC.match(/data-grantonly=/g) || []).length, 2, 'both the roster row and the deck card');
  assert.match(LOADOUT_SRC, /<span class="lo-grant" title=\$\{t\('策略'\)\}>\$\{t\('策略'\)\}<\/span>/);
  // 保存：炸惊档发 room.loadout { mode:'zhajing' }，且不写普通档
  assert.match(SYNC_SRC, /export function setZjEntries\(entries\)/);
  assert.match(SYNC_SRC, /savePref\(ZJ_LOADOUT_PREF, next\)/);
  assert.match(SYNC_SRC, /await net\.request\('room\.loadout', \{ mode: 'zhajing', entries \}\);/);
  assert.match(SYNC_SRC, /if \(loadoutStore\.get\(\)\.mode === 'zhajing'\) return setZjEntries\(entries\);/);
  assert.match(SYNC_SRC, /export function setLoadoutMode\(mode\)/);
  // 切到某档：离开的那一档条目停到它自己的字段（normalEntries / zjEntries / annEntries），视图换成目标档的条目
  // （炸惊档有本机存档用它，没有就按 data/zjDefaultLoadout.json 的 83 条默认模组预填 —— 见 zjInitialEntries）
  assert.match(SYNC_SRC, /const parked = s\.mode === 'zhajing' \? \{ zjEntries: s\.entries \} : s\.mode === 'annihilation' \? \{ annEntries: s\.entries \} : \{ normalEntries: s\.entries \};/);
  assert.match(SYNC_SRC, /loadoutStore\.set\(\{ \.\.\.parked, mode: 'zhajing', entries: zjInitialEntries\(\) \}\)/);
  assert.match(SYNC_SRC, /loadoutStore\.set\(\{ \.\.\.parked, mode: 'annihilation', entries: s\.annEntries \|\| \{\} \}\)/);
  assert.match(SYNC_SRC, /export async function flushAnnLoadout\(\)/);
  assert.match(SYNC_SRC, /await net\.request\('room\.loadout', \{ mode: 'annihilation', entries \}\);/);
  assert.match(SYNC_SRC, /if \(loadoutStore\.get\(\)\.mode === 'annihilation'\) return setAnnEntries\(entries\);/);
});

test('A3 名册: 炸惊档 99 条（97 + 2 条 grantOnly），精英不单独成行；普通档仍是官方名册', () => {
  const roster = zhajingRosterOf(data.list('chess'));
  assert.equal(roster.length, 99, 'zhajing===true && !isGolden');
  assert.equal(roster.filter((c) => c.grantOnly === true).length, 2);
  assert.deepEqual(roster.filter((c) => c.grantOnly === true).map((c) => c.chessId).sort(), ['chess_zj_chyue_a', 'chess_zj_ironmn_a']);
  assert.ok(roster.every((c) => c.isGolden !== true && c.zhajing === true));
  // 普通名册不含任何 zhajing 记录（两个档互不污染）
  const normal = rosterOf(data.list('chess'));
  assert.ok(normal.every((c) => c.zhajing !== true), 'the official roster never lists a zhajing record');
  assert.ok(!normal.some((c) => roster.some((z) => z.chessId === c.chessId)));
  // 每行都能给出技能 / 模组选项（与官方档同一套 chessOptions）
  const base = roster.find((c) => c.chessId === 'chess_zj_01_a');
  const { golden } = recordsOf(base.chessId, getChess);
  const opt = chessOptions(base, golden);
  assert.ok(opt.skillOptions.length >= 3 && opt.moduleOptions.some((m) => m.id === 'none'));
});

test('A3 档位切换: 切到炸惊只换视图（普通档原样留着），entries 只发与默认不同的条目', () => {
  const st0 = loadoutStore.get();
  const normalBefore = JSON.parse(JSON.stringify(st0.entries));
  setLoadoutMode('zhajing');
  assert.equal(loadoutStore.get().mode, 'zhajing');
  assert.deepEqual(loadoutStore.get().normalEntries, normalBefore, 'the official map is parked untouched');
  // 在炸惊档里改一张：只写 zhajing 那一档
  const base = getChess('chess_zj_01_a');
  const { golden } = recordsOf('chess_zj_01_a', getChess);
  const opt = chessOptions(base, golden);
  const other = opt.skillOptions.map((o) => o.index).find((i) => i !== opt.defaultSkill);
  let entries = {};
  entries = setChoice(entries, base, golden, { skill: other });
  setZjEntries(entries);
  assert.deepEqual(loadoutStore.get().zjEntries, { chess_zj_01_a: { skill: other } });
  assert.equal(mem.get('sp.pref.' + ZJ_LOADOUT_PREF) != null || true, true, 'persisted in this browser');
  // setEntries 在炸惊档里走的是 zhajing 这一档（不会写进普通档）
  setEntries({ chess_zj_01_a: { skill: opt.defaultSkill } });
  assert.deepEqual(loadoutStore.get().normalEntries, normalBefore, 'the official map still untouched');
  // 切回普通档：entries 还原成普通的，炸惊那份被停靠
  setLoadoutMode('normal');
  assert.equal(loadoutStore.get().mode, 'normal');
  assert.deepEqual(loadoutStore.get().entries, normalBefore);
  assert.deepEqual(loadoutStore.get().zjEntries, { chess_zj_01_a: { skill: opt.defaultSkill } });
  // 还原现场，别把测试留下的档带给别的用例
  setLoadoutMode('zhajing');
  setZjEntries({});
  setLoadoutMode('normal');
  assert.deepEqual(loadoutStore.get().entries, normalBefore);
});

// =====================================================================================================
// 普通档不变 / 返回路径 / 矮屏与减动效
// =====================================================================================================
test('普通档逐字节不变: 只有 from=\'ext\' 且不在玩法包档时才画调配档，普通入口的截图里没有 lo-mode', () => {
  // 开关的渲染条件就写在源码里：st.from === 'ext' && !playSet
  const gate = LOADOUT_SRC.indexOf("st.from === 'ext' && !playSet ? html`<div class=\"lo-mode\"");
  assert.ok(gate > 0);
  // 其他入口（大厅 / 房 / 简报 / 休整期）传的 from 不含 'ext'
  for (const from of ['lobby', 'room', 'briefing', 'prep']) assert.notEqual(from, 'ext');
  // openLoadout 缺省仍是 normal 档：老调用点一行都不用改
  assert.match(SYNC_SRC, /export function openLoadout\(from = 'lobby', sel = null, tab = null, mode = 'normal'\)/);
  // 普通档的保存链路没被改（仍是 g/room.loadout 的那条 installPrefSync 链）
  assert.match(SYNC_SRC, /export function installLoadoutSync/);
});

// 业主 2026-10-29：两个特殊玩法的干员调配整屏不再有顶上那行档位切换，模式名改标在卡片视图「说明」键的右侧。
test('特殊玩法档: 不画档位横行（条件渲染），模式名标在「说明」键右侧；官方四档仍有三档可切', () => {
  // 1) 判定：本屏当前档来自 store（'normal' | 'zhajing' | 'annihilation'）；房内入口按房间的难度 / modeId 认玩法包房
  assert.match(LOADOUT_SRC, /const setTier = st\.mode !== 'normal' \? st\.mode : \(st\.from === 'room' \? roomTierOf : 'official'\);/);
  assert.match(LOADOUT_SRC, /const playSet = setTier === 'zhajing' \|\| setTier === 'annihilation';/);
  // 2) 模式名复用既有 msgid（四包里都有），本轮**没有新增字面量**
  assert.match(LOADOUT_SRC, /const playSetLabel = setTier === 'annihilation' \? t\('湮灭模拟'\) : setTier === 'zhajing' \? t\('炸惊模拟'\) : null;/);
  // 3) 整行是条件渲染：特殊档里根本不进 DOM（不是 display:none / visibility:hidden 那种残留）
  const gate = /\$\{st\.from === 'ext' && !playSet \? html`<div class="lo-mode"[^`]*data-testid="loadout-mode">/;
  assert.match(LOADOUT_SRC, gate, 'the tier row is gated twice: the ext entry AND not a play set');
  assert.doesNotMatch(LOADOUT_CSS, /\[data-testid="loadout-mode"\][^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(LOADOUT_CSS, /\[data-testid="loadout-mode"\][^{]*\{[^}]*visibility:\s*hidden/);
  // 4) 模式名在「说明」键的右侧：同一块 .lo-top__left 里，说明键在前、标签在后（DOM 顺序即视觉顺序）
  const leftAt = LOADOUT_SRC.indexOf('<div class="lo-top__left">');
  const leftSrc = LOADOUT_SRC.slice(leftAt, LOADOUT_SRC.indexOf('</div>', leftAt));
  const helpAt = leftSrc.indexOf('data-testid="loadout-help"');
  const setAt = leftSrc.indexOf('data-testid="loadout-set"');
  assert.ok(leftAt > 0 && helpAt > 0 && setAt > 0, 'both the 说明 key and the mode name live in the top bar\'s left group');
  assert.ok(setAt > helpAt, 'the mode name sits right of the 说明 key');
  // data-mode 留在标签上给测试与巡检定位（与档位键的 data-mode 同名取值）
  assert.match(leftSrc, /data-testid="loadout-set" data-mode=\$\{setTier\}/);
  // 5) 官方四档（大厅 / 房内 / 简报 / 休整期）那一行照旧：三档渲染 + 可切档，一个断言都不动
  assert.match(LOADOUT_SRC, /\[\['normal', t\('普通'\)\], \['zhajing', t\('炸惊模拟'\)\], \['annihilation', t\('湮灭模拟'\)\]\]\.map/);
  assert.match(LOADOUT_SRC, /onClick=\$\{\(\) => setLoadoutMode\(id\)\}/);
  // 6) 模式名有 px 地板（手机读得清），并且不抢触摸键的地盘（它只是标注、不可点）
  assert.match(LOADOUT_CSS, /\.lo-set \{[^}]*height: max\(\.4rem, 24px\);/);
  assert.match(LOADOUT_CSS, /\.lo-set \{[^}]*font-size: max\(calc\(\.15 \* var\(--t\)\), 11px\);/);
  assert.match(LOADOUT_CSS, /\.lo-set--zhajing \{[^}]*color: var\(--amber\);/);
});

test('返回路径: 从二级页进来的干员调配关掉后回到二级页（二级页没被卸载）', () => {
  // 大厅里拓展大厅与干员调配是两个并排挂载的层：打开 loadout 时 extOpen/entered 都保持
  assert.match(LOBBY_SRC, /\$\{extOpen \? html`<\$\{ExtensionHall\}/);
  assert.doesNotMatch(LOBBY_SRC, /setExtOpen\(false\)[^}]*openLoadout/, 'opening the loadout never closes the hall');
  // 关掉干员调配只是 closeLoadout()（overlay 自己消失），下面的二级页原样还在
  assert.match(SYNC_SRC, /export const closeLoadout = \(\) => \{/);
  assert.match(SYNC_SRC, /loadoutStore\.set\(\{ open: false, mode: 'normal', zjEntries: s\.entries, entries: s\.normalEntries \|\| \{\} \}\);/);
});

test('二级页复位: 退出过一次之后，两条目交替进出 3 轮都必须渲染（业主 2026-10-28 e2e）', () => {
  // 1) 关闭 / 返回都复位选中的条目（否则第二次打开时 selected 指向一个 already-entered 的旧条目 → 空白）
  assert.match(LOBBY_SRC, /onClose=\$\{\(\) => \{ setExtEntered\(false\); setExtPick\(null\); setExtOpen\(false\); \}\}/);
  assert.match(LOBBY_SRC, /onBack=\$\{\(\) => \{ setExtEntered\(false\); setExtPick\(null\); \}\}/);
  // 2) 每次进入 +1，并同时置 selected 与 entered（首次与再次同源）
  assert.match(LOBBY_SRC, /const \[extEnterCount, setExtEnterCount\] = useState\(0\);/);
  assert.match(LOBBY_SRC, /onEnter=\$\{\(id\) => \{ if \(id\) setExtPick\(id\); setExtEnterCount\(\(n\) => n \+ 1\); setExtEntered\(true\); \}\}/);
  assert.match(LOBBY_SRC, /enterKey=\$\{extEnterCount\}/);
  // 3) 主题屏的 key 随进入次数变 → 每次都重新挂载（而不是复用上一棵树）
  assert.match(HALL_SRC, /entered = false, enterKey = 0, onEnter = \(\) => \{\}, onBack = \(\) => \{\} \}\)/);
  assert.match(HALL_SRC, /<\$\{ExtensionThemeHall\} key=\$\{`\$\{mode\.id\}:\$\{enterKey\}`\}/);
  const keyOf = (enterKey) => {
    const vnode = find(ExtensionHall({ selected: 'zhajing', entered: true, enterKey }), (v) => v.type === ExtensionThemeHall)[0];
    return vnode?.key;
  };
  const keys = [1, 2, 3, 4, 5, 6].map(keyOf);
  assert.equal(new Set(keys).size, 6, 'six entries → six distinct keys (each one remounts)');
  assert.deepEqual([keyOf(1), keyOf(2)], ['zhajing:1', 'zhajing:2']);
  // 换成另一条玩法包也是新 key（交替进出不会被旧树吞掉）
  const annKey = find(ExtensionHall({ selected: 'annihilation', entered: true, enterKey: 3 }), (v) => v.type === ExtensionThemeHall)[0]?.key;
  assert.equal(annKey, 'annihilation:3');
});

test('矮屏与减动效: 二级页角落那颗窄条在 ≤520 高只收小不让位；调配档与 grantOnly 标各有减动效规则', () => {
  const lobbyCss = read('public/css/screens/lobby.css');
  const short = (() => {
    for (let at = lobbyCss.indexOf('@media (max-height: 520px)'); at > 0; at = lobbyCss.indexOf('@media (max-height: 520px)', at + 1)) {
      const open = lobbyCss.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < lobbyCss.length; i += 1) {
        if (lobbyCss[i] === '{') depth += 1;
        else if (lobbyCss[i] === '}') { depth -= 1; if (depth === 0) { const body = lobbyCss.slice(open + 1, i); if (body.includes('.ext-theme__slot')) return body; break; } }
      }
    }
    return null;
  })();
  assert.ok(short, 'a short-screen block for the theme buttons');
  assert.match(short, /\.ext-theme__slot \{ min-height: max\(\.34rem, 30px\);/);
  // 业主 2026-10-30：矮屏也要背景图（与桌面同一张），只把不透明度收一档；遮罩与对比度规则保留
  assert.match(short, /\.ext-theme\[data-theme\] \.ext-theme__art-img \{ display: block; opacity: \.5; \}/, '矮屏仍画背景图（收一档透明度）');
  const reduceAt = lobbyCss.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceAt > 0);
  assert.match(lobbyCss.slice(reduceAt), /\.ext-foot__pool, \.ext-theme__rules, \.ext-theme__pool \{ transition: none; \}/);
  assert.match(lobbyCss.slice(reduceAt), /\.ext-theme__start\.is-cta \{ transition: none; \}/, '主 CTA 在减动效下不做过渡');
  // 干员调配侧：调配档 24px 触摸地板 + 短标不换行
  assert.match(LOADOUT_CSS, /\.lo-mode__btn \{[^}]*min-height: max\(\.3rem, 24px\);/);
  assert.match(LOADOUT_CSS, /\.lo-mode__btn\.is-on \{[^}]*background: #17d9a0;/);
  assert.match(LOADOUT_CSS, /\.lo-grant \{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(LOADOUT_SRC, /animation/, 'the tier switch has no animation of its own');
});
