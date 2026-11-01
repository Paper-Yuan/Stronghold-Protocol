// test/ui/mode-tools.test.js — 局内 HUD 左上「模式工具」（业主 2026-10-29 的三次改版之后的样子）。
//
// 这一条线把四件事钉在一起（全部模式共用，**不做模式分支**）：
//   ① 左下角落（业主 2026-10-29 第三版）：表情（正方形、logo 居中）→ 设置 → 对话唤出 → 全屏，四颗键等大；
//      全屏在手机端隐藏，窄屏 < 768px 仍是 devices.css 的两行 wrap-reverse；局内「玩法说明」键已删（设置 → 玩法说明）；
//   ② 发言框：只有角落那颗「对话唤出」键能开（全局 Enter 不再开），面板默认隐藏、80% 不透明、层级低于表情盘；
//      标题文字「同盟通讯」已删，弹幕开关缩小 20% 且只在面板唤出后出现；
//   ③ 盟约条：0.3.1 旧版（居中、原生横向滚动；两侧 ‹ › 键已删，补上向上收起 / 两端淡出 / 鼠标拖动；
//      细节在 bond-strip-fold / bond-strip-scroll）；
//   ④ 惊变入口：右上两枚角标删除，锻造器缩成顶栏那一行的**一颗胶囊**（锻造器数 · 击杀数），点开是锻造器自己的
//      两条路（不是页签面板）；已选惊变是左下角那颗独立键，直接挂 jibian.js 的 JibianPanel **单层三页签**
//      （我的惊变 / 敌方惊变 / 惊变羁绊）—— 没有外层页签、不挂一览（业主 2026-10-29 第三次改版）。
// 视图都是纯函数（ui/forge.js ForgeCardsView 等），可以在 Node 里直接画出来看 vnode；带 hooks 的外壳只按源码断言接线。
//
// ui/hud.js 的 ModeToolsPanel / ModeToolsPanelView 仍保留导出（那一版两层页签的面板现在没有挂载点），因为
// test/ui/zhajing-panels.test.js（另一条线在改）仍 import 它；game.js 已经直接挂 JibianPanel，第 ④ 组里按源码钉住。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// data.how the views look their records up (jibianPoolOf reads data.get('config'); the forge cards read shared tables)
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { data } = await import('../../public/js/data.js');
await data.load('config');

const CFG = JSON.parse(read('data/config.json'));
const MODE_ID = 'mode_single_zhajing';
const POOL = CFG.modes[MODE_ID].jibian.pool;
assert.ok(POOL.length > 0, 'the mode pool is in this build');

const { ModeToolsButton, ModeToolsPanelView, JibianHudButton } = await import('../../public/js/ui/hud.js');
const { isJibianRef, JibianPanelView } = await import('../../public/js/ui/jibian.js');

const GAME = read('public/js/screens/game.js');
const HUD = read('public/js/ui/hud.js');
const FORGE = read('public/js/ui/forge.js');
const EMOTES_JS = read('public/js/ui/emotes.js');
const CHAT = read('public/js/ui/chatBox.js');
const CSS = read('public/css/screens/game.css');
const DEV = read('public/css/devices.css');
const EMOTES = read('public/css/emotes.css');

// ---- vnode helpers ----------------------------------------------------------------------------------
const PLAIN = ['ForgeCardsView', 'JibianCodexView'];
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

/** A server-shaped forge block (the same shape test/ui/zhajing-forge.test.js uses). */
const FORGE_BLOCK = {
  count: 2, killsPaid: 40, elites: 1, per: 40,
  forged: { atk: { total: 100, count: 1 } },
  rolled: { rarity: 'epic', picks: ['crit', 'vamp', 'block'] },
};
const JIBIAN_VIEW = {
  cards: [{ key: 'jibian:a', id: 'jibian_a', name: '物理转魔法', desc: '转成法术。', rarity: 'epic' }],
  owned: ['jibian_a'],
};

// =====================================================================================================
// ① 左下角落：表情（正方形）→ 设置 → 对话唤出 → 全屏，窄屏两行 wrap-reverse、手机没有全屏、每个键都有 data-testid
// =====================================================================================================
describe('① the bottom-left corner: 表情 → 设置 → 对话 → 全屏', () => {
  test('one row on wide screens: no flex-wrap in game.css; below 768px devices.css wraps the extra keys above the main three', () => {
    // .gm__corner = absolute left .24rem bottom .24rem, flex, align-items: flex-end, gap .1rem（z-index 130 是本仓
    // 保留的层级，见 ②）
    assert.match(CSS, /\.gm__corner \{ position: absolute; left: \.24rem; bottom: \.24rem; display: flex; align-items: flex-end; gap: \.1rem; z-index: 130; \}/);
    assert.doesNotMatch(CSS.slice(CSS.indexOf('.gm__corner {')), /^\s*flex-wrap/m);
    // 窄屏（< 768px）：两行、wrap-reverse；下排的固定宽度正好是「表情 / 设置 / 对话」三颗等大方键 + 两道缝
    assert.match(DEV, /\.gm__corner \{ flex-wrap: wrap-reverse; align-content: flex-start;\n {4}width: max\(calc\(72px \* var\(--sp-ui, 1\)\), 32px, calc\(3 \* \.56rem \+ \.2rem\)\); \}/);
    assert.match(DEV, /@media \(max-width: 767px\) \{\n {2}\.gm\.is-collapsed \.gm__corner \{ flex-wrap: nowrap; width: auto; \}\n\}/);
  });

  test('the emote key is a square icon key: .56rem, robot logo centred, no 交流 label and no gm__gear class', () => {
    // 正方底板 + grid 居中；图标 .28rem 与设置键的齿轮同大（手机上跟 .gm__gear 一起放大到 34px）
    assert.match(EMOTES, /\.ewheel__btn \{\n {2}position: relative; display: grid; place-items: center;\n {2}width: \.56rem; height: \.56rem; min-width: 0; padding: 0;/);
    assert.match(EMOTES, /\.ewheel__btn \.icon \{ width: \.28rem; height: \.28rem; \}/);
    assert.match(EMOTES, /\.gm__corner \.ewheel__btn \{\n {4}width: max\(\.56rem, 32px, calc\(34px \* var\(--sp-ui, 1\)\)\);/);
    // 渲染：唯一的子元素是官方机器人 logo；没有 has-sprite 长条贴图，也没有可见的 交流 文字
    assert.match(EMOTES_JS, /cx\('ewheel__btn', open && 'is-on', cooling && 'is-cooling'\)/);
    assert.match(EMOTES_JS, /aria-label=\$\{t\('表情'\)\} title=\$\{t\('表情'\)\}/);
    assert.match(EMOTES_JS, /<\\?\$\{GIcon\} name="emote" \/>/);
    // 面板仍然用 has-sprite 贴图；按钮不再有贴图变量 / 长条标签
    assert.doesNotMatch(EMOTES_JS, /btnSprite/);
    assert.doesNotMatch(EMOTES_JS, /--ewheel-btn\b/);
    assert.doesNotMatch(EMOTES_JS, /ewheel__label/);
    // 面板锚点：正方形键的左下角；外框回到官方 313×231（3.13×2.31rem），实高才不会再从按钮顶部往下画
    assert.match(EMOTES, /\.ewheel__panel \{\n {2}position: absolute; left: -\.15rem; bottom: calc\(100% \+ \.02rem\); z-index: 5;/);
    assert.match(EMOTES, /\.ewheel__panel \{[^}]*width: min\(3\.13rem, calc\(100vw - 24px\)\);\n {2}height: min\(2\.31rem, calc\(\(100vw - 24px\) \* 0\.738019\)\);/);
    // 类名里不带设置键的类（`querySelector('.gm__gear')` 必须命中设置键）
    assert.doesNotMatch(EMOTES_JS, /cx\('gm__gear', 'ewheel__btn'/);
  });

  test('the fullscreen key exists on desktop but is hidden on touch phones', () => {
    assert.match(GAME, /<\\?\$\{FullscreenButton\} class="gm__gear gm__fs" \/>/);
    assert.match(DEV, /\.gm__corner \.gm__fs \{ display: none; \}/);
  });

  test('the in-match 玩法说明 key is gone in every mode; 设置 → 玩法说明 is the one entry', () => {
    assert.doesNotMatch(GAME, /gm__guide/);
    assert.doesNotMatch(GAME, /openGuide/, 'the screen no longer imports the guide opener');
    assert.match(read('public/js/ui/settings.js'), /class="set-guide"[^>]*onClick=\$\{\(\) => openGuide\(0\)\}/, 'the settings modal keeps the entry');
  });

  test('every corner key carries a data-testid (the settings key among them)', () => {
    for (const id of ['hud-metrics', 'hud-emoji', 'hud-chat', 'hud-settings']) {
      assert.ok(GAME.includes(`data-testid="${id}"`) || EMOTES_JS.includes(`data-testid="${id}"`), id);
    }
    // …and the settings key really is the first `.gm__gear` in the corner: after the 表情 key (its own component), before
    // the chat / metrics keys — `page.click('.gm__gear')` in the older e2e files still opens 设置
    const corner = GAME.slice(GAME.indexOf('<div class="gm__corner">'), GAME.indexOf('</div>', GAME.indexOf('<div class="gm__corner">')));
    assert.ok(corner.indexOf('data-testid="hud-settings"') > 0);
    assert.ok(corner.indexOf('data-testid="hud-chat"') > corner.indexOf('data-testid="hud-settings"'), 'the chat key sits after 设置');
    assert.ok(corner.indexOf('<${EmoteWheel}') < corner.indexOf('data-testid="hud-settings"'), 'the 表情 key comes first');
    assert.ok(corner.indexOf('data-testid="hud-emoji"') < 0, 'the emote wheel is its own component, not a gm__gear here');
    assert.match(corner, /<\\?\$\{FullscreenButton\} class="gm__gear gm__fs" \/>/, 'and 全屏 closes the row on desktop');
  });
});

// =====================================================================================================
// ② 发言框：角落「对话唤出」键是唯一开关；默认隐藏、80% 不透明、宽度桌面 ≈3.4rem / 手机 61vw，层级低于表情盘
// =====================================================================================================
describe('② the chat panel: the corner key opens it, 80% opaque and wider', () => {
  test('the corner 对话 key toggles the controlled panel (no panel trigger, no bare Enter)', () => {
    assert.match(GAME, /data-testid="hud-chat"[\s\S]{0,320}onClick=\$\{\(\) => setChatOpen\(!chatOpen\)\}/);
    assert.match(GAME, /<\\?\$\{ChatBox\} active=\$\{chatOpen\} onToggle=\$\{setChatOpen\} showTrigger=\$\{false\}/);
    assert.match(GAME, /data-testid="hud-chat"[\s\S]{0,160}aria-label=\$\{t\('打开对话'\)\}/);
    // 这颗键得有可见标识（业主 2026-10-29「对话按钮没有标识」）：speech-bubble icon, defined in components.js
    assert.match(GAME, /<\\?\$\{Icon\} name="chat" \/>/);
    assert.match(read('public/js/ui/components.js'), /chat: \{ d: 'M4 3h16/);
    assert.doesNotMatch(CHAT, /e\.key === 'Enter'/);
    assert.match(CHAT, /e\.key === 'Escape'/);
    // 标题文字「同盟通讯」已删；弹幕键缩小 20% 且默认隐藏（面板唤出后才出现）
    assert.doesNotMatch(CHAT, /t\('同盟通讯'\)/);
    const css = read('public/css/room-chat.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(css, /\.chat-danmaku-mini \{[^}]*display: none;[^}]*height: 14px;[^}]*font: 8px\/1/);
    assert.match(css, /\.gm \.chat-panel\.is-active \.chat-danmaku-mini \{ display: inline-block; \}/);
  });

  test('hidden by default, 80% opaque, width 3.4rem on desktop and a special 61vw / 240px on phones; z-index 2 under the corner layer (130)', () => {
    const css = read('public/css/room-chat.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const plates = [...css.matchAll(/\.gm \.chat-panel \{([^}]*)\}/g)].map((m) => m[1]).filter((b) => /background/.test(b));
    assert.equal(plates.length, 1);
    assert.match(plates[0], /z-index: 2;/);
    assert.match(plates[0], /display: none;/);
    assert.match(plates[0], /width: min\(max\(3\.4rem, 32px, calc\(220px \* var\(--sp-ui, 1\)\)\), 34vw\);/);
    assert.match(plates[0], /background: rgba\(14, 18, 17, \.8\)/);
    assert.match(css, /\.gm \.chat-panel\.is-active \{ display: flex; \}/);
    // 手机端单独一条宽度，不再跟着 34px 的角落键走
    assert.match(css, /@media \(max-width: 767px\), \(max-height: 600px\) and \(pointer: coarse\), \(max-height: 600px\) and \(any-pointer: coarse\) \{\n {2}\.gm \.chat-panel \{\n {4}width: min\(61vw, 240px\);/);
    assert.match(CSS, /\.gm__corner \{[^}]*z-index: 130/);
    assert.match(EMOTES, /\.ewheel__panel \{\n {2}position: absolute;[^}]*z-index: 5;/);
  });
});

// =====================================================================================================
// ③ 盟约条：居中 / 原生横向滚动；两侧 ‹ › 键删除，向上收起、两端淡出、鼠标按住拖动
// =====================================================================================================
describe('③ the bond strip: fold up, fade the overflow, drag with the mouse', () => {
  test('the strip is a centred row that folds up from one bare chevron; there is no 10-slot window', () => {
    const rule = /\.gm__bonds \{([^}]*)\}/.exec(CSS)?.[1] || '';
    assert.match(rule, /left: 50%/);
    assert.match(rule, /transform: translateX\(-50%\)/);
    assert.match(rule, /top: 1\.36rem/);
    assert.match(rule, /max-width: min\(62vw, 46rem\)/);
    // 收起：条体右侧一颗裸箭头（绝对定位，不挤占条体的居中），hidden 后只剩它；旧 10 槽窗口仍然没有
    assert.match(GAME, /<div class=\$\{cx\('gm__bonds', bondsCollapsed && 'is-collapsed'\)\}>\n {8}<div id="match-bond-strip" class="gm__bond-list" hidden=\$\{bondsCollapsed\}>/);
    assert.match(GAME, /class="bonds-toggle" aria-expanded=\$\{!bondsCollapsed\}/);
    assert.match(CSS, /\.gm__bonds \.bonds-toggle \{/);
    assert.match(CSS, /\.gm__bonds \.bonds-toggle \{[^}]*position: absolute;[^}]*left: calc\(100% \+/);
    assert.match(CSS, /\.gm__bond-list\[hidden\] \{ display: none; \}/);
    assert.equal(CSS.includes('--bonds-visible'), false, 'no ten-slot window');
  });

  test('the overflow is the strip\'s own horizontal scroll with edge fades and mouse drag; the ‹ › keys are gone', () => {
    assert.match(CSS, /\.bstrip-scroll \{[^}]*display: flex; align-items: center; min-width: 0; max-width: 100%; gap: \.04rem; cursor: grab;/);
    assert.match(CSS, /\.bstrip-scroll\.is-dragging \{ cursor: grabbing; \}/);
    assert.match(CSS, /\.gm__bonds \.bstrip-scroll \.bstrip \{[^}]*overflow-x: auto/);
    // 过长时两端淡出：data-edge 由 BondScroller 按 scrollLeft / clientWidth / scrollWidth 写
    assert.match(CSS, /\.bstrip-scroll\[data-edge="both"\] \.bstrip \{[^}]*--fade-la: 0; --fade-ra: 0;/);
    assert.match(read('public/js/ui/bondStrip.js'), /const next = left && right \? 'both' : left \? 'left' : right \? 'right' : ''/);
    assert.match(read('public/js/ui/bondStrip.js'), /d\.el\.scrollLeft = d\.left - dx/);
    assert.equal(CSS.includes('.bstrip-scroll__arrow'), false, 'the left/right adjustment keys are deleted');
    assert.match(CSS, /\.bslot \{ position: relative; display: flex; flex-direction: column; align-items: center; width: \.74rem; \}/);
    assert.equal(CSS.includes('--bonds-visible'), false, 'no ten-slot window');
  });
});

// =====================================================================================================
// ④ 锻造器胶囊（顶栏）+ 惊变键（左下角）：业主 2026-10-29 第二次改版 —— 照原版把两件事拆开
// =====================================================================================================
describe('④ the forge capsule (top bar) and the 惊变 corner key', () => {
  test('the capsule shows 锻造器 count · 击杀 count, labelled from existing strings, red dot while undecided', () => {
    const b = ModeToolsButton({ forge: 2, kills: 3, per: 40, rolled: true, open: true, onClick: () => {} });
    assert.equal(b.props['data-testid'], 'zj-tools');
    assert.equal(b.props['aria-expanded'], 'true');
    assert.equal(b.props['aria-haspopup'], 'dialog');
    assert.equal(b.props['title'], '锻造器 2');
    assert.equal(b.props['aria-label'], '锻造器 2');
    assert.equal(byTestId(b, 'zj-tools-forge').props.children, 2);
    assert.equal(byTestId(b, 'zj-tools-kills').props.children, 3);
    assert.ok(byTestId(b, 'zj-tools-dot'), '红点 = rolled != null（还有没决定的锻造器）');
    const decided = ModeToolsButton({ forge: 2, kills: 3, per: 40, rolled: false });
    assert.equal(byTestId(decided, 'zj-tools-dot'), undefined, '选完红点就消失');
    const off = ModeToolsButton({ open: false });
    assert.equal(off.props['aria-expanded'], 'false');
    // 左下角那颗惊变键：与角落键同一颗（.gm__gear 的尺码），有自己的 testid 与文案
    const jb = JibianHudButton({ count: 2, onClick: () => {} });
    assert.equal(jb.props['data-testid'], 'zj-jibian');
    assert.equal(jb.props['aria-label'], '惊变');
    assert.ok(byTestId(jb, 'zj-jibian-n'), '已选数量角标');
  });

  test('the top bar hosts it on ONE row with the difficulty tag (the meta column is vertical)', () => {
    // task-27（业主 2026-10-30）：胶囊进 `.gtop__modeslot`（0 高的独立层），不再是最外层 grid 的那一格 ——
    // 但仍在模式位那一行、仍在难度名右侧，且**只有 modeEntry 在时**才带 has-tools / 挂槽位（官方模式 DOM 不变）。
    assert.match(HUD, /<div class=\$\{cx\('gtop__moderow', modeEntry \? 'has-tools' : null\)\}>\n {10}\$\{pub\?\.difficulty \? html`<\$\{DifficultyTag\} difficulty=\$\{pub\.difficulty\} size="sm" \/>` : null\}\n {10}\$\{modeEntry \? html`<div class="gtop__modeslot">\$\{modeEntry\}<\/div>` : null\}/);
    // 那一行是 grid：[难度名 auto | 1fr]；行本身撑到左格右缘（align-self: stretch），再把顶栏的 gap 也算进来
    assert.match(CSS, /\.gtop__moderow \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\); align-items: center; column-gap: 0;\n {2}align-self: stretch; margin-right: calc\(-1 \* var\(--gtop-gap\)\); min-width: 0; \}/);
    assert.match(CSS, /--gtop-gap: \.2rem;/, 'the top bar gap is one variable, not two copies of .2rem');
    // game.js owns the data and hands the slot in (the TopBar knows nothing about forge / jibian)
    assert.match(GAME, /modeEntry=\$\{forgeInfo \|\| jibianShown \? html`<\$\{ModeToolsButton\} forge=\$\{forgeInfo \? forgeInfo\.count : 0\}/);
    assert.doesNotMatch(HUD, /ForgeButton|JibianButton/, 'the top bar draws the merged entry, not the old buttons');
  });

  test('task-27：胶囊脱出模式行的布局流（0 高槽位 + 绝对定位），模式位回到官方几何', () => {
    // 槽位：仍是第二列（宽度 = 难度名右缘 → 中栏左缘），但高度 0 ⇒ 撑不动模式行；胶囊以槽位中心为锚
    assert.match(CSS, /\.gtop__modeslot \{ grid-column: 2; position: relative; align-self: center; height: 0; min-width: 0; pointer-events: none; \}/);
    assert.match(CSS, /\.gtop__modeslot > \.gm__modetools \{ position: absolute; left: 50%; top: 50%; transform: translate\(-50%, -50%\); pointer-events: auto; \}/);
    // 胶囊自身仍是 ≥32px 的热区按钮（不再参与定高的只是它的布局流位置）
    assert.match(CSS, /\.gm__modetools \{[^}]*min-height: max\(\.44rem, 32px\)/);
  });

  test('业主 2026-10-29 第三次改版 + 当晚两改：细发光边框（不动）+ 细黑线 + 更淡的超浅青绿半透明底 + 深色数字', () => {
    // 业主第二次定调（「是现在这个绿色的描边，但是内部选超级浅色的青绿色且是半透明」）→ 第三次（「背景再淡一点，
    // 同时细白线改黑线」）：描边仍是 rgba(23,217,160,.55) + .08rem 薄荷发光；底推到近白 rgba(246,255,254,.74)；
    // 分隔线由白 .22 改成墨绿黑 rgba(4,26,21,.55)。
    assert.match(CSS, /\.gm__modetools__plate \{[^}]*background: rgba\(246, 255, 254, \.74\);[^}]*border: 1px solid rgba\(23, 217, 160, \.55\);/);
    assert.match(CSS, /\.gm__modetools__plate \{[^}]*box-shadow: 0 0 \.08rem rgba\(23, 217, 160, \.45\)/);
    // 不再是 80% 薄荷实心底（业主第一版要的那种「整块绿」）
    assert.doesNotMatch(CSS, /\.gm__modetools__plate \{[^}]*background: rgba\(23, 217, 160, \.8\);/, 'the mint plate is gone');
    // 半透明：alpha 在 (0, 1) 之间，且是近白的青绿（三通道 ≥ 240，G ≥ B > R）
    const plate = /\.gm__modetools__plate \{([^}]*)\}/.exec(CSS)[1];
    const m = /background: rgba\((\d+), (\d+), (\d+), (\.\d+)\);/.exec(plate);
    assert.ok(m, 'the plate fill is an rgba()');
    const [r, g, b, a] = m.slice(1).map(Number);
    assert.ok(a > 0.3 && a < 1, `the fill is semi-transparent (alpha ${a})`);
    assert.ok(r >= 240 && g >= 250 && b >= 245, `palest cyan-green fill (${r},${g},${b})`);
    assert.ok(g >= b && b > r, 'cyan-green hue: G ≥ B > R');
    // 内里那道细线改成黑线（不再是 rgba(255,255,255,.22) 的细白线，也不是旧的薄荷线）
    assert.match(CSS, /\.gm__modetools__sep \{[^}]*background: rgba\(4, 26, 21, \.55\);/);
    assert.doesNotMatch(CSS, /\.gm__modetools__sep \{[^}]*rgba\(255, 255, 255/, 'the white hairline is gone');
    assert.doesNotMatch(CSS, /\.gm__modetools__sep \{[^}]*rgba\(78, 216, 175/, 'the mint separator is gone');
    // 浅底上的数字 / 图标要清晰 → 深色墨（白字在这个底上会糊）
    assert.match(CSS, /\.gm__modetools__n \{[^}]*color: #03130f;/);
    assert.match(CSS, /\.gm__modetools__icon \{[^}]*color: #06241d;/);
    assert.doesNotMatch(CSS, /\.gm__modetools__n \{[^}]*color: var\(--text-hi\)/, 'no white numbers on the light plate');
  });

  test('视觉高度 ×0.9（32 → 28.8px），点击热区仍 ≥32px：压扁的只有里面那块板子', () => {
    const b = ModeToolsButton({ forge: 2, kills: 3, per: 40, rolled: true });
    // 结构：button（热区）> span.gm__modetools__plate（造型）> 单元格 + 分隔线 + 红点
    assert.equal(b.props['data-testid'], 'zj-tools');
    const plate = byClass(b, 'gm__modetools__plate');
    assert.equal(plate.length, 1, 'the visible pill is one span inside the button');
    assert.equal(byTestId(plate[0], 'zj-tools-forge').props.children, 2);
    assert.equal(byTestId(plate[0], 'zj-tools-kills').props.children, 3);
    assert.ok(byTestId(plate[0], 'zj-tools-dot'), 'the red dot rides on the plate');
    assert.equal(byClass(b, 'gm__modetools__sep').length, 1, 'the inner hairline (dark since the second change)');
    // CSS：外壳 min-height 仍是 32px 的地板，板子高度 = .44rem × 0.9（792×360 上 28.8px）
    assert.match(CSS, /\.gm__modetools \{[^}]*min-height: max\(\.44rem, 32px\)/);
    assert.match(CSS, /\.gm__modetools__plate \{[^}]*height: max\(calc\(\.44rem \* \.9\), 28\.8px\)/);
    assert.doesNotMatch(CSS, /\.gm__modetools__plate \{[^}]*min-height: max\(\.44rem, 32px\)/, 'the plate itself may shrink');
  });

  test('居中位：难度名右缘与中栏左缘的中点 —— CSS 轨道算，不写死 px、不按模式分支', () => {
    // 左格剩余的宽度给 meta；胶囊在那一行的第二列（1fr，task-27 起是 0 高的 .gtop__modeslot）里居中
    assert.match(CSS, /\.gtop__meta \{[^}]*flex: 1 1 auto;/);
    assert.match(CSS, /\.gm__modetools \{ grid-column: 2; justify-self: center;/);
    // 量出来的中点（792×360）写进注释，CSS 本身不含魔法数字
    assert.match(CSS, /难度名右缘 85\.03px、中栏左缘 185\.14px ⇒ 中心 135\.08px/);
    assert.doesNotMatch(CSS, /\.gm__modetools \{[^}]*left: \d+px/, 'no hard-coded px anchor');
  });

  test('（已不挂载）两行写法保留：ui/hud.js ModeToolsPanelView 的三页签仍可单独画出', () => {
    const both = ModeToolsPanelView({ forge: FORGE_BLOCK, jibian: JIBIAN_VIEW, jibianOwn: { owned: ['jibian_a'] }, modeId: MODE_ID });
    assert.equal(both.props['data-testid'], 'zj-tools-panel');
    const tabs = find(both, (v) => v.props?.role === 'tab').map((v) => textOf(v));
    assert.deepEqual(tabs, ['锻造器2', '已选惊变1', '惊变一览1']);
    // forge only: no 惊变 pages; 惊变 only: no forge page
    const forgeOnly = ModeToolsPanelView({ forge: FORGE_BLOCK });
    assert.deepEqual(find(forgeOnly, (v) => v.props?.role === 'tab').map((v) => textOf(v)), ['锻造器2']);
    const jibianOnly = ModeToolsPanelView({ jibian: JIBIAN_VIEW, jibianOwn: { owned: [] }, modeId: MODE_ID });
    assert.deepEqual(find(jibianOnly, (v) => v.props?.role === 'tab').map((v) => textOf(v)), ['已选惊变1', '惊变一览0']);
  });

  test('the 锻造器 page IS ForgeCardsView (same cards, same test ids — no second copy)', () => {
    const page = ModeToolsPanelView({ tab: 'forge', forge: FORGE_BLOCK });
    assert.ok(byTestId(page, 'forge-left'), '剩余');
    assert.equal(byTestId(page, 'forge-left').props.children, 2);
    assert.deepEqual(byClass(page, 'fcard').map((c) => c.props['data-testid']),
      ['forge-card-crit', 'forge-card-vamp', 'forge-card-block']);
    assert.ok(byTestId(page, 'forge-forged'), 'the 已锻造 strip');
    // the footer keeps explaining how to get one (inside the shared renderer, not re-typed by the panel)
    const cardsSrc = FORGE.slice(FORGE.indexOf('export function ForgeCardsView'), FORGE.indexOf('export function ForgedChip('));
    assert.match(cardsSrc, /精锐干员或累计击败 \{n\} 名敌人可获得锻造器/);
    assert.equal((FORGE.match(/data-testid=\$\{`forge-card-/g) || []).length, 1, 'one card renderer, not a copy');
    // the shared renderer is forge.js's, drawn as a plain function (its name is in the pure list)
    const src = FORGE.slice(FORGE.indexOf('export function ForgeCardsView'));
    assert.match(src, /data-testid=\$\{`forge-card-\$\{o\.id\}`\}/);
  });

  test('the 已选惊变 page is JibianTabs, the 一览 page is the codex renderer in its bare form', () => {
    const mine = ModeToolsPanelView({ tab: 'mine', jibian: JIBIAN_VIEW });
    const reused = find(mine, (v) => typeof v.type === 'function' && v.type.name === 'JibianTabs');
    assert.equal(reused.length, 1, 'the three 已选惊变 pages come from ui/jibian.js, not from a copy');
    const codex = ModeToolsPanelView({ tab: 'codex', modeId: MODE_ID, jibianOwn: { owned: ['jibian_a'] } });
    assert.ok(byTestId(codex, 'jibian-codex'), 'the codex page');
    assert.equal(byClass(codex, 'zjcodex__group').length, 5, 'all five rarities of the mode pool');
    // bare = no second .zjpanel shell / scrim / close key inside the page
    assert.equal(byClass(codex, 'zjpanel__scrim').length, 1, 'only the tools panel has a scrim');
    assert.equal(byClass(codex, 'zjpanel__x').length, 1, 'only the tools panel has a close key');
  });

  test('the panel closes from its scrim, its ✕ and the button state the screen owns', () => {
    let closed = 0;
    const page = ModeToolsPanelView({ forge: FORGE_BLOCK, onClose: () => { closed += 1; } });
    byClass(page, 'zjpanel__scrim')[0].props.onClick();
    byClass(page, 'zjpanel__x')[0].props.onClick();
    assert.equal(closed, 2);
    // the wrapper renders nothing while closed, and its page state lives in the component
    assert.match(HUD, /export function ModeToolsPanel\(\{ open = false, onClose = \(\) => \{\}, forge = null, onTake = null,/);
    assert.match(HUD, /if \(!open\) return null;/);
    assert.match(HUD, /const \[tab, setTab\] = useState\('forge'\);/);
    assert.match(HUD, /setPicked\(optId\); onTake\?\.\(optId, rarity\);/);
  });

  test('the capsule opens the two forge panels from game.js; 惊变 keeps its own corner key and panel', () => {
    // rolled != null → 抉择弹窗（ui/forge.js ForgePanel）；否则 → 已锻造属性整合（ForgedPanel）
    assert.match(GAME, /<\$\{ForgePanel\} key=\$\{zjRolledKey\}/);
    assert.match(GAME, /<\$\{ForgedPanel\} entries=\$\{forgeInfo\.forged\} onClose=\$\{closeForgeHud\} \/>/);
    assert.match(GAME, /actions\.forgeTake\(opt\.id, zjForgeCards\.rarity\)/);
    // 顶栏不再挂页签入口：惊变面板由左下角那颗键打开，game.js 直接挂 jibian.js 的 JibianPanel（单层三页签）
    assert.match(GAME, /<\$\{JibianPanel\} jibian=\$\{jibianShown\} enemy=\$\{enemyJibian\}/);
    assert.match(GAME, /watchingName=\$\{jibianWatchName\} onClose=\$\{\(\) => setZjToolsOpen\(false\)\} \/>/);
    assert.doesNotMatch(GAME, /ModeToolsPanel/, 'the two-layer 已选惊变 / 惊变一览 panel is not mounted by the game screen');
    assert.doesNotMatch(GAME, /<\$\{JibianPanel\}[^>]*forge=/, 'no 锻造器 page in the 惊变 panel');
    assert.match(GAME, /<\$\{JibianHudButton\} count=\$\{jibianCount\}/);
    assert.doesNotMatch(HUD, /forgeClose\(\)/);
    // 左下那颗「已锻造」徽标（.gm__forgecol）整段删了：胶囊点开已有整合面板
    assert.doesNotMatch(GAME, /forgecol|ForgedChip/);
  });

  test('面板单层化：JibianPanel 自带 .zjpanel 外壳 + 三页签（已选 / 敌方 / 羁绊），没有外层页签、不挂一览', () => {
    const panel = JibianPanelView({ tab: 'mine', jibian: JIBIAN_VIEW, enemy: { cards: [] }, onClose: () => {} });
    assert.equal(panel.props['data-testid'], 'jibian-panel');
    assert.equal(panel.props.class, 'zjpanel', 'the panel draws its own shell (no outer tools shell)');
    const tabs = find(panel, (v) => v.props?.role === 'tab').map((v) => textOf(v));
    assert.deepEqual(tabs, ['已选惊变1', '敌方惊变0', '惊变羁绊']);
    assert.equal(byClass(panel, 'zjpanel__tabs').length, 1, 'exactly one tab row');
    assert.equal(byClass(panel, 'zjpanel__scrim').length, 1);
    // 一览不再挂：game.js 里没有 codex 的入口，也没有那排 zj-tools-tab-*
    assert.doesNotMatch(GAME, /JibianCodex|zj-tools-tab-/);
    // 观战队友时第一页换成 TA 的惊变（JibianPanel 自己的 watchingName 语义）
    const watch = JibianPanelView({ tab: 'mine', jibian: JIBIAN_VIEW, watchingName: '队友' });
    assert.equal(find(watch, (v) => v.props?.role === 'tab').map((v) => textOf(v))[0], 'TA 的惊变1');
    // 矮屏限高：jibian.css 的 max-height: 84% 在不定高的网格行里不生效，game.css 只对这一个面板补视口上限
    assert.match(CSS, /\.gm \.zjpanel\[data-testid="jibian-panel"\] \.zjpanel__box \{ max-height: calc\(100dvh - \.6rem\); overflow: hidden; \}/);
  });

  test('the right-hand effects column no longer draws 惊变', () => {
    assert.equal(isJibianRef({ id: 'jibian_chixiaojianfa#12' }), true);
    assert.equal(isJibianRef({ id: 'jibian_xuedingedemao' }), true);
    assert.equal(isJibianRef({ id: 'yanShip#3' }), false);
    assert.equal(isJibianRef({ id: 'bounty_1' }), false);
    assert.equal(isJibianRef(null), false);
    assert.equal(isJibianRef({}), false);
    assert.match(GAME, /export function effectsWithoutJibian\(effects\) \{\n {2}return Array\.isArray\(effects\) \? effects\.filter\(\(e\) => !isJibianRef\(e\)\) : effects;\n\}/);
    assert.match(GAME, /<\$\{EffectsList\} effects=\$\{effectsWithoutJibian\(/);
    // …and the shared list is untouched (it serves every other mode)
    assert.doesNotMatch(read('public/js/ui/effectsList.js'), /jibian/i);
  });

  test('no mode branch: the merged entry is gated by DATA (priv.forge / priv.jibian), never by the mode id', () => {
    const at = GAME.indexOf('modeEntry=');
    const line = GAME.slice(at, GAME.indexOf('held=', at));
    assert.ok(at > 0);
    assert.doesNotMatch(line, /difficulty|zhajing|annihilation/);
    assert.doesNotMatch(HUD.slice(HUD.indexOf('export function ModeToolsButton'), HUD.indexOf('export function TopBar')), /zhajing|annihilation/i);
    // 这一整段（难度名 → 胶囊 → 惊变面板）里没有任何按模式分支的选择器
    const block = CSS.slice(CSS.indexOf('.gtop__meta {'), CSS.indexOf('.gm .zjpanel[data-testid="jibian-panel"]'));
    assert.doesNotMatch(block, /data-difficulty/);
  });
});
