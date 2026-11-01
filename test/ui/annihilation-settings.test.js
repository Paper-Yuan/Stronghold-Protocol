// test/ui/annihilation-settings.test.js — 湮灭模拟二级页的「功能设置」面板（业主 2026-10-28 晚，Part B 最后一件）
//
//   入口：**湮灭的主题大厅**（与「规则」同一排）`data-testid="extension-feature-settings"`；
//   面板：`data-testid="ann-feature-settings"`，8 行开关 —— 4 条规则（RULE_SWITCHES，`true` = 取 `options[1]`，
//   每行直接借规则表自己的 `phrase[option]`，零新字面量）+ 4 条内容（`ANN_CONTENT_NAMES`，新词条已由 Lead 补进四包）。
//   写：房主 `room.setAnnMods { annMods }`（全量八键，长名 `commsPriority`）；建房时由 `room.create { annMods }` 带初值。
//   读：`room.state.annMods`（**显式**键，true 与 false 都发；缺省不进表）+ `shared/annihilation-constants.js` 的
//       `ANN_MOD_DEFAULT_ON`（罗德岛 / 卡兹戴尔默认开）；非湮灭房连这个入口都不出现。
//   engine-core 2026-10-28 回执：非房主 NOT_HOST / 已开局 ROOM_STARTED / 观战 SPECTATOR / 非湮灭房 BAD_TARGET，
//   一律不发 toast；**下一局生效**（页脚用既有词条写着）。
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

const { annModRows, annModsWire, AnnSettingsView, ANN_CONTENT_LABELS, sendAnnMods } = await import('../../public/js/ui/annihilationSettings.js');
const { RULE_SWITCHES } = await import('../../shared/plugins/rules.js');
const { ANN_RULE_NAMES, ANN_CONTENT_NAMES, isAnnMods } = await import('../../shared/protocol.js');
const { ExtensionThemeHall } = await import('../../public/js/screens/extensionThemeHall.js');
const { extensionModeById, ExtensionHall } = await import('../../public/js/screens/extensionModes.js');
const { Modal } = await import('../../public/js/ui/components.js');
// P1-1 湮灭第三档（干员调配）：与炸惊档同一套档位机具，只是 mode 不同
const { loadoutStore, setLoadoutMode, setEntries, closeLoadout, ANN_LOADOUT_PREF } = await import('../../public/js/ui/loadoutSync.js');

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LOBBY_SRC = read('public/js/screens/lobby.js');
const LOBBY_CSS = read('public/css/screens/lobby.css');
// 左下那两枚入口（ExtThemeDock）在它里面；dock 带 hooks，Node 里只能读源码（见 P1-1 那条的注释）
const THEME_HALL_SRC = read('public/js/screens/extensionThemeHall.js');

// ---- vnode helpers ----------------------------------------------------------------------------------
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

// =====================================================================================================
// ① 入口：只在湮灭的二级页
// =====================================================================================================
test('入口: 只在湮灭的主题大厅（与 规则/功能设置 同一排），炸惊与筹备中的条目都没有', () => {
  const ann = extensionModeById('annihilation');
  assert.equal(ann.featureSettings, true, 'the entry declares it, like poolEdit / rules');
  assert.equal(extensionModeById('zhajing').featureSettings, undefined, '炸惊 does not');
  const themeAnn = ExtensionThemeHall({ mode: ann, onFeatureSettings: () => {} });
  const btn = byTestId(themeAnn, 'extension-feature-settings');
  assert.ok(btn, 'the entry button is on the annihilation theme screen');
  assert.equal(btn.type, 'button');
  assert.equal(textOf(btn), '功能设置');
  const calls = [];
  byTestId(ExtensionThemeHall({ mode: ann, onFeatureSettings: (id) => calls.push(id) }), 'extension-feature-settings').props.onClick();
  assert.deepEqual(calls, ['annihilation']);
  // 不在列表页脚、也不在炸惊那一屏
  assert.equal(byTestId(ExtensionHall({ selected: 'annihilation', onClose: () => {} }), 'extension-feature-settings'), undefined);
  assert.equal(byTestId(ExtensionThemeHall({ mode: extensionModeById('zhajing') }), 'extension-feature-settings'), undefined);
  // 与「规则」同一排（同一次 map 里的 .ext-theme__guide 按钮）；玩法包二级页不再有「卡池调整」
  assert.ok(find(themeAnn, (v) => hasClass(v, 'ext-theme__feat')).length === 1);
});

// =====================================================================================================
// ② 8 行开关：4 条规则（借规则表的措辞）+ 4 条内容
// =====================================================================================================
test('8 行开关: 上 4 行取 RULE_SWITCHES 的 phrase[options[1]]（零新字面量），下 4 行用已补的四条内容词条', () => {
  const rows = annModRows({});
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => r.id), ['shopBias', 'prepLoadout', 'morphPairing', 'unequip', 'egirBuff', 'commsPriority', 'rhodesShip', 'kazdelShip']);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.kind), ['rule', 'rule', 'rule', 'rule']);
  assert.deepEqual(rows.slice(4).map((r) => r.kind), ['content', 'content', 'content', 'content']);
  // 规则行的说明就是规则表自己那半句（改数据/改文案时两边同源）
  assert.deepEqual(rows.slice(0, 4).map((r) => r.label), ANN_RULE_NAMES.map((n) => {
    const spec = RULE_SWITCHES[n];
    return spec.phrase[spec.options[1]];
  }));
  assert.ok(rows.slice(0, 4).every((r) => typeof r.label === 'string' && r.label.length > 0));
  // 内容行的四条（2026-10-29：两条盟约的战斗效果已接，标签去掉「（仅计数与展示）」后缀）
  assert.deepEqual(rows.slice(4).map((r) => r.label), ['阿戈尔加强', '通讯机与寻呼模块', '罗德岛盟约', '卡兹戴尔盟约']);
  assert.deepEqual(Object.keys(ANN_CONTENT_LABELS), ANN_CONTENT_NAMES);
  // 缺省：6 关 + 2 开（`{}.rhodesShip` / `.kazdelShip` 走 shared 的 ANN_MOD_DEFAULT_ON）
  assert.deepEqual(annModRows({}).map((r) => r.on), [false, false, false, false, false, false, true, true]);
  assert.deepEqual(annModRows({}).filter((r) => r.on).map((r) => r.id), ['rhodesShip', 'kazdelShip'], '没写过的两条按缺省开');
  // 显式键压缺省：开一条规则仍只是那条 + 两条默认开；显式 false 能把默认开的那条关掉
  const on = annModRows({ shopBias: true, egirBuff: true });
  assert.deepEqual(on.filter((r) => r.on).map((r) => r.id), ['shopBias', 'egirBuff', 'rhodesShip', 'kazdelShip']);
  assert.deepEqual(annModRows({ rhodesShip: false, kazdelShip: false }).filter((r) => r.on).map((r) => r.id), [], '显式 false 全关');
  // 未知键不影响（服务端会丢）
  assert.deepEqual(annModRows({ bogus: true }).filter((r) => r.on).map((r) => r.id), ['rhodesShip', 'kazdelShip']);
});

test('面板: 项目 Modal、8 个 role=switch、页脚写着「下一局生效」、计数跟着走', () => {
  const rows = annModRows({ unequal: true, morPairing: true });
  const view = AnnSettingsView({ rows, onToggle: () => {} });
  assert.equal(view.type, Modal, 'the project Modal (Esc / focus trap / focus restored)');
  const root = byTestId(view, 'ann-feature-settings');
  assert.ok(root, 'the panel hook');
  const switches = find(view, (v) => v.props?.role === 'switch');
  assert.equal(switches.length, 8, 'eight rows');
  assert.deepEqual(switches.map((s) => s.props['data-testid']), ['ann-mod-shopBias', 'ann-mod-prepLoadout', 'ann-mod-morphPairing', 'ann-mod-unequip', 'ann-mod-egirBuff', 'ann-mod-commsPriority', 'ann-mod-rhodesShip', 'ann-mod-kazdelShip']);
  // 缺省 6 关 + 2 开：规则四条与 egirBuff / commsPriority 关，两条盟约按 shared 缺省开
  assert.deepEqual(switches.map((s) => s.props['aria-checked']), ['false', 'false', 'false', 'false', 'false', 'false', 'true', 'true']);
  assert.equal(byTestId(view, 'ann-mod-count').props.children, 2, '缺省就已开着两条');
  // 点一行：回调带 id 与目标状态
  const calls = [];
  const wired = AnnSettingsView({ rows, onToggle: (id, on) => calls.push([id, on]) });
  byTestId(wired, 'ann-mod-unequip').props.onClick();
  assert.deepEqual(calls, [['unequip', true]]);
  // 再开两条规则 ⇒ 4 开（两条盟约 + 这两条），计数跟上，标签就是规则表那句
  const two = AnnSettingsView({ rows: annModRows({ unequip: true, morphPairing: true }) });
  assert.deepEqual(find(two, (v) => v.props?.role === 'switch').map((s) => s.props['aria-checked']).filter((x) => x === 'true').length, 4);
  assert.equal(byTestId(two, 'ann-mod-count').props.children, 4);
  assert.deepEqual(find(two, (v) => v.props?.role === 'switch').filter((s) => s.props['aria-checked'] === 'true').map((s) => s.props['data-testid']),
    ['ann-mod-morphPairing', 'ann-mod-unequip', 'ann-mod-rhodesShip', 'ann-mod-kazdelShip'], '开着的是这两条规则 + 两条默认开的盟约');
  assert.ok(textOf(two).includes(RULE_SWITCHES.unequip.phrase.allow));
  assert.ok(textOf(two).includes(RULE_SWITCHES.morphPairing.phrase.plus));
  // 页脚：既有词条「下一局生效」+ 确认
  assert.ok(textOf(two).includes('下一局生效'), 'the switch takes effect NEXT match (engine-core)');
  assert.equal(textOf(byTestId(two, 'ann-mod-save')), '确认');
});

// =====================================================================================================
// ③ 只读 / 发送形状
// =====================================================================================================
test('只读: 非房主 / 已开局时整排 disabled，并给一句既有提示（由创建者设置）', () => {
  const view = AnnSettingsView({ rows: annModRows({ shopBias: true }), readOnly: true, hint: '由创建者设置' });
  const switches = find(view, (v) => v.props?.role === 'switch');
  assert.deepEqual(switches.map((s) => s.props.disabled), new Array(8).fill(true));
  assert.equal(byTestId(view, 'ann-mod-save').props.disabled, true);
  assert.ok(textOf(view).includes('由创建者设置'), 'an existing msgid, not a new one');
  // 只读时点行不回调
  const calls = [];
  const wired = AnnSettingsView({ rows: annModRows({}), readOnly: true, onToggle: (id) => calls.push(id) });
  byTestId(wired, 'ann-mod-shopBias').props.onClick();
  assert.deepEqual(calls, []);
  // 大厅侧：只读条件是「非房主 || 已开局」，提示就是那句
  assert.match(LOBBY_SRC, /const annLocked = !!liveRoom && \(liveRoom\.inMatch === true \|\| \(!!liveRoom\.hostId && liveRoom\.hostId !== identity\.playerId\)\);/);
  assert.match(LOBBY_SRC, /readOnly=\$\{!online \|\| annLocked\}/);
  assert.match(LOBBY_SRC, /hint=\$\{annLocked \? t\('由创建者设置'\) : null\}/);
});

test('发送形状: 全量八个键、长名 commsPriority、房主 room.setAnnMods；建房从 room.create.annMods 带初值', () => {
  const wire = annModsWire({ shopBias: true, egirGibberish: true, comms: true });
  assert.deepEqual(Object.keys(wire).sort(), ['commsPriority', 'egirBuff', 'kazdelShip', 'morphPairing', 'prepLoadout', 'rhodesShip', 'shopBias', 'unequip'].sort());
  assert.equal(wire.shopBias, true);
  assert.equal(wire.commsPriority, false, 'the alias is never sent: only the long name');
  assert.equal('comms' in wire, false);
  assert.ok(isAnnMods(wire), 'the protocol accepts the full object');
  // 每个值都是布尔（全量覆盖，服务端只留 true）
  assert.ok(Object.values(wire).every((v) => typeof v === 'boolean'));
  // net 形状：一颗消息、八个键、长名
  const sent = [];
  const fakeNet = { request: (t, fields) => { sent.push([t, fields]); return Promise.resolve({ ok: true }); } };
  void sendAnnMods(fakeNet, { unequip: true });
  assert.deepEqual(sent[0][0], 'room.setAnnMods');
  assert.deepEqual(sent[0][1], { annMods: annModsWire({ unequip: true }) });
  // 大厅侧源码：建房带 annMods（空则不带，老行为逐字节不变）；房内走 setAnnMods
  assert.match(LOBBY_SRC, /\.\.\.\(Object\.keys\(extAnnMods\)\.length \? \{ annMods: annModsWire\(extAnnMods\) \} : null\),/);
  assert.match(LOBBY_SRC, /if \(inRoom\) \{ try \{ await sendAnnMods\(net, annModsShown\); \} catch \(err\) \{ toastError\(err\); return; \} \}/);
  // 读回：room.state.annMods（非湮灭房没有这个键）
  assert.match(LOBBY_SRC, /const annModsShown = \(liveRoom && liveRoom\.annMods\) \|\| extAnnMods;/);
});

// =====================================================================================================
// ④ 矮屏 / 减动效 / 视觉
// =====================================================================================================
test('矮屏与减动效: ≤520 高列表自己滚、开关 28px；开关的过渡在 reduce 块里归零', () => {
  const short = (() => {
    for (let at = LOBBY_CSS.indexOf('@media (max-height: 520px)'); at > 0; at = LOBBY_CSS.indexOf('@media (max-height: 520px)', at + 1)) {
      const open = LOBBY_CSS.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < LOBBY_CSS.length; i += 1) {
        if (LOBBY_CSS[i] === '{') depth += 1;
        else if (LOBBY_CSS[i] === '}') { depth -= 1; if (depth === 0) { const body = LOBBY_CSS.slice(open + 1, i); if (body.includes('.annmods__list')) return body; break; } }
      }
    }
    return null;
  })();
  assert.ok(short, 'a short-screen block for the panel');
  assert.match(short, /\.annmods__list \{ max-height: 46vh; \}/);
  assert.match(short, /\.annmods__sw \{ min-height: max\(\.36rem, 28px\); \}/);
  // 触摸地板：整行开关 ≥32px，保存键 ≥32px（≤32px 的地板裸写 px，ui-size 的守卫要求）
  assert.match(LOBBY_CSS, /\.annmods__sw \{[^}]*min-height: max\(\.4rem, 32px\);/);
  assert.match(LOBBY_CSS, /\.annmods__save \{[^}]*min-height: max\(\.44rem, 32px, calc\(44px \* var\(--sp-ui, 1\)\)\);/);
  // 开关的过渡只有 --t-fast 的两条，没有动画；面板本身没有 @keyframes
  const block = LOBBY_CSS.slice(LOBBY_CSS.indexOf('.annmods__body'));
  assert.match(block, /\.annmods__track \{[^}]*transition: background var\(--t-fast\), border-color var\(--t-fast\);/);
  assert.doesNotMatch(block, /animation:/, 'the panel has no animation of its own');
  // 减动效块点名滑块的过渡（位移在这一屏唯一的"动"）
  const reduceAt = LOBBY_CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceAt > 0);
  assert.match(LOBBY_CSS.slice(reduceAt), /\.annmods__track, \.annmods__track i \{ transition: none; \}/);
  // 颜色：开=玩法包绿，关=中性
  assert.match(block, /\.annmods__sw\[aria-checked="true"\] \.annmods__track i \{ background: #17d9a0;/);
});

// ---- P1-1 湮灭第三档（干员调配）------------------------------------------------------------------------
// 注：左下那两枚入口在 `ExtThemeDock` 里，它带 useState —— Node 里不能像纯视图那样直接实例化（hook 上下文不存在），
// 所以这里断的是「主题大厅把 mode / onPoolEdit 交给这个 dock」+ dock 自己的那一小段源码（testid、文案、顺序、onClick）。
test('P1-1 湮灭档: 入口是二级页左下的「干员调配」（不再有「卡池调整」），进的是既有干员调配的湮灭档', () => {
  const ann = extensionModeById('annihilation');
  assert.equal(ann.poolEdit, true, 'the entry declares its own pool tier');
  const theme = ExtensionThemeHall({ mode: ann, onPoolEdit: () => {} });
  // 角落只在 poolEdit 的条目上出现，里面装的就是那个 dock：主题大厅把它自己的 onPoolEdit 原样交下去
  const dock = find(theme, (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeDock')[0];
  assert.ok(dock, 'the corner dock exists on the annihilation theme screen');
  assert.equal(dock.props.mode.id, 'annihilation', 'dock 拿到的是湮灭这一条');
  assert.equal(typeof dock.props.onPoolEdit, 'function', '主题大厅把自己的 onPoolEdit 交给 dock');
  // dock 里那颗键：testid / class / 文案 / 点击 → onPoolEdit(mode.id)；S.W.E.E.P. 报告在它上面
  // （只看 dock 自己那一段源码：文件头的注释里也提到过 ext-loadout）
  const dockSrc = THEME_HALL_SRC.slice(THEME_HALL_SRC.indexOf('function ExtThemeDock'), THEME_HALL_SRC.indexOf('export function ExtensionThemeHall'));
  assert.ok(dockSrc.length > 0, 'the dock component is there');
  assert.match(dockSrc, /<button type="button" class="ext-theme__loadout" data-testid="ext-loadout"[\s\S]{0,200}?onClick=\$\{\(\) => onPoolEdit\(mode\.id\)\}/);
  assert.match(dockSrc, /<span class="ext-theme__loadout-label">\$\{t\('干员调配'\)\}<\/span>/);
  assert.deepEqual([...dockSrc.matchAll(/data-testid="(ext-sweep|ext-loadout)"/g)].map((m) => m[1]), ['ext-sweep', 'ext-loadout'],
    'S.W.E.E.P.报告 在上、干员调配 在下');
  // 同宽：两枚都撑满 dock（grid + width:100%），不靠一个个写死宽度
  assert.match(LOBBY_CSS, /\.ext-theme__dock \{[^}]*justify-items: stretch/s);
  assert.match(LOBBY_CSS, /\.ext-theme__dock > button \{[^}]*width: 100%/s);
  // 2026-10-29：与它重复的「卡池调整」已删 —— 二级页上既没有 testid，也没有那四个字
  assert.equal(byTestId(theme, 'extension-pool-edit'), undefined, '「卡池调整」不再渲染');
  assert.ok(!textOf(theme).includes('卡池调整'), '二级页不再出现「卡池调整」');
  const calls = [];
  const wired = ExtensionThemeHall({ mode: ann, onPoolEdit: (id) => calls.push(id) });
  find(wired, (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeDock')[0].props.onPoolEdit('annihilation');
  assert.deepEqual(calls, ['annihilation'], 'the button reports which play set it belongs to');
  // 大厅按 id 分工：湮灭 → annihilation 档，其它 → 炸惊档
  assert.match(LOBBY_SRC, /onPoolEdit=\$\{\(id\) => openLoadout\('ext', null, 'loadout', id === 'annihilation' \? 'annihilation' : 'zhajing'\)\}/);
});

test('P1-1 湮灭档: 三档互不污染，保存发 room.loadout { mode:"annihilation" }，卸模组走 module:"none"', () => {
  const st0 = loadoutStore.get();
  const normalBefore = JSON.parse(JSON.stringify(st0.entries));
  assert.equal(typeof ANN_LOADOUT_PREF, 'string');
  assert.match(ANN_LOADOUT_PREF, /^loadout\.ann/);
  // 进入湮灭档：普通档停到 normalEntries，视图换成湮灭档自己的（不预填 —— 名册是房间自己的官方名册）
  setLoadoutMode('annihilation');
  assert.equal(loadoutStore.get().mode, 'annihilation');
  assert.deepEqual(loadoutStore.get().normalEntries, normalBefore, 'the official map is parked untouched');
  assert.deepEqual(loadoutStore.get().entries, loadoutStore.get().annEntries, 'the annihilation tier shows its own map');
  // 在湮灭档里改一张：落 annEntries，不碰普通档，也不碰炸惊档
  setEntries({ chess_4231_clemnt: { skill: 1, module: 'none' } });
  assert.deepEqual(loadoutStore.get().annEntries, { chess_4231_clemnt: { skill: 1, module: 'none' } });
  assert.deepEqual(loadoutStore.get().normalEntries, normalBefore);
  assert.deepEqual(loadoutStore.get().zjEntries, st0.zjEntries, 'the zhajing tier is untouched');
  // 关掉：普通档回位，湮灭那份被停靠
  closeLoadout();
  assert.equal(loadoutStore.get().mode, 'normal');
  assert.deepEqual(loadoutStore.get().entries, normalBefore);
  assert.deepEqual(loadoutStore.get().annEntries, { chess_4231_clemnt: { skill: 1, module: 'none' } });
  // 源码：发送形状与门（非湮灭房由服务端 BAD_TARGET，客户端只在自己的档里发）
  const sync = read('public/js/ui/loadoutSync.js');
  assert.match(sync, /await net\.request\('room\.loadout', \{ mode: 'annihilation', entries \}\);/);
  assert.match(sync, /export function setAnnEntries\(entries\)/);
  assert.match(sync, /if \(loadoutStore\.get\(\)\.mode === 'annihilation'\) return setAnnEntries\(entries\);/);
  assert.match(sync, /export async function flushAnnLoadout\(\)/);
  // 收尾：别把测试留下的档带出去
  setLoadoutMode('annihilation');
  setEntries({});
  setLoadoutMode('normal');
  assert.deepEqual(loadoutStore.get().entries, normalBefore);
});
