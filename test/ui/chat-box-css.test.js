// test/ui/chat-box-css.test.js — 聊天面板的样式与位置（房间 + 局内）。
//
// ChatBox（public/js/ui/chatBox.js）是上游 0.3.0 的组件，合并时 index.html 把 room-chat.css / room-voice.css 的 <link>
// 弄丢了，于是这个面板**一个样式都没有**：没有定位、没有尺寸，按文档流随便落在界面里（用户：房间聊天的位置不对）。
// 这里钉住三件事：样式表真的被引入、面板按本仓库旧聊天面板的位置定位、以及房间界面确实挂了这个组件。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('the chat panel is styled and placed', () => {
  const html = read('public/index.html');
  const css = read('public/css/room-chat.css');
  const room = read('public/js/screens/room.js');

  test('index.html loads the chat and voice stylesheets again', () => {
    assert.match(html, /<link rel="stylesheet" href="\/css\/room-chat\.css" \/>/);
    assert.match(html, /<link rel="stylesheet" href="\/css\/room-voice\.css" \/>/);
  });

  test('the panel sits bottom-left like the repository own chat did, and the trigger keeps a 44px target', () => {
    const panel = /\.chat-panel \{([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(panel, /position:\s*fixed/, 'a chat that scrolls away with the page is the bug being fixed');
    assert.match(panel, /left:\s*16px/);
    assert.match(panel, /bottom:\s*16px/);
    assert.match(panel, /width:\s*230px/);
    assert.match(panel, /z-index:\s*110/, 'under the emote panel (ewheel__panel is 120)');
    // 房间那份仍是「日志常显、收起只去掉输入行」；局内自 2026-10-29 第三版起整块默认隐藏（见末尾那条断言）
    assert.match(css, /\.chat-panel:not\(\.is-active\) \.chat-form \{ display: none; \}/);
    assert.doesNotMatch(css, /\.chat-panel:not\(\.is-active\) \.chat-log \{ display: none; \}/);
    // 半收起 = 只留一行；局内让开角落按钮那一行
    assert.match(css, /\.chat-panel\.is-collapsed \.chat-log \{ max-height: 34px; \}/);
    assert.match(css, /\.gm \.chat-panel \{\s*left: \.24rem; bottom: \.9rem;/, 'above the four corner buttons');
    // 面板不吃指针（只有控件接收点击，日志区域穿透到棋盘）
    assert.match(css, /\.chat-panel \{[^}]*pointer-events: none/);
    assert.match(css, /\.chat-panel \.chat-log \{ pointer-events: none; \}/);
    // 局内那份：隐藏 / 唤出、80% 不透明、宽度按桌面 3.4rem（手机单独 61vw / 240px）、日志可滑动（一条一行 / 5 行 / 半收起 3 行）
    assert.match(css, /\.gm \.chat-panel \{[^}]*display: none/);
    assert.match(css, /\.gm \.chat-panel \{[^}]*width: min\(max\(3\.4rem, 32px, calc\(220px \* var\(--sp-ui, 1\)\)\), 34vw\)/);
    assert.match(css, /\.gm \.chat-panel \{[^}]*background: rgba\(14, 18, 17, \.8\)/);
    assert.match(css, /\.gm \.chat-panel \.chat-log \{[^}]*overflow-y: auto; pointer-events: auto/);
    assert.match(css, /\.gm \.chat-panel \.chat-log \{[^}]*max-height: 96px/);
    assert.match(css, /\.gm \.chat-panel\.is-collapsed \.chat-log \{ max-height: 54px; \}/);
    assert.match(css, /\.gm \.chat-panel \.chat-item \{[^}]*white-space: nowrap/);
    assert.match(css, /\.chat-panel \.chat-header-bar[\s\S]{0,220}pointer-events: auto/);
    assert.match(css, /\.chat-panel \.chat-send-btn \{ pointer-events: auto; \}/);
    // 手机端单独一条：角落键只有 34px，聊天框不能跟着键宽
    assert.match(css, /\.gm \.chat-panel \{\n {4}width: min\(61vw, 240px\);/);
    // 唤出对话按键 = 出输入框（按钮在标题栏里，不再是固定圆点）
    const trig = /\.chat-trigger-btn \{([^}]*)\}/.exec(css)?.[1] || '';
    assert.doesNotMatch(trig, /position:\s*fixed/);
    assert.match(css, /\.chat-trigger-btn::before \{[^}]*44px/, 'the touch target, on a phone');
  });

  test('the room screen mounts the repository own draggable chat, the match keeps this one', () => {
    assert.match(room, /import \{ mountRoomChat \} from '\.\.\/ui\/roomChat\.js'/);
    assert.match(room, /useEffect\(\(\) => mountRoomChat\(\), \[\]\)/);
    assert.doesNotMatch(room, /<\$\{ChatBox\}/, 'the room does not use the in-match panel');
    const game = read('public/js/screens/game.js');
    assert.match(game, /<\$\{ChatBox\} active=/, 'in a match the fixed log is ChatBox');
    // 可拖动那套的样式（.spchat）必须在，且带着拖动/收起/位置记忆的实现
    assert.match(css, /\.spchat__panel \{/);
    assert.match(css, /\.spchat__toggle \{/, 'the summon button');
    const chat = read('public/js/ui/roomChat.js');
    assert.match(chat, /sp\.chat\.toggle\.position\.v1/, 'drag position is remembered');
  });

  test('the log clears when the room changes (leaving included), not only on room.closed', async () => {
    const { roomIdentityChanged } = await import('../../public/js/store.js');
    assert.equal(roomIdentityChanged({ code: 'ABCD' }, { code: 'ABCD' }), false, 'same room: keep the log');
    assert.equal(roomIdentityChanged({ code: 'ABCD' }, { code: 'WXYZ' }), true, 'another room');
    assert.equal(roomIdentityChanged({ code: 'ABCD' }, null), true, 'left the room');
    assert.equal(roomIdentityChanged(null, null), false);
    assert.equal(roomIdentityChanged(undefined, { code: 'ABCD' }), true);
    const main = read('public/js/main.js');
    assert.match(main, /if \(roomIdentityChanged\(prev\.room, s\.room\)\) clearChat\(\);/);
  });

  test('the seat classes the component emits have colours', () => {
    for (const c of ['seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-spec']) {
      assert.ok(css.includes(`.chat-seat.${c}`), `.chat-seat.${c}`);
    }
  });
  test('the in-match panel: hidden by default, 80% opaque plate, the LAST .gm .chat-panel rule wins, under the emote panel', () => {
    // 业主 2026-10-29 第三版：聊天框不再常显、也不再全透明 —— 点「对话唤出」键后浮出 80% 不透明底板。
    // 历史坑（透明版时代）：文件里更早的一条 .gm .chat-panel 写了 transparent，却被文件末尾同名同特异性的规则覆盖，
    // 而旧测试只断言「文件里存在」。这里仍取**最后一条**（只允许一条声明 background）断言，坑再犯就会红。
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies = [...plain.matchAll(/\.gm \.chat-panel \{([^}]*)\}/g)].map((m) => m[1]);
    const plates = bodies.filter((b) => /background/.test(b));
    assert.equal(plates.length, 1, 'exactly one .gm .chat-panel rule declares a background');
    const body = plates[0];
    assert.match(body, /display: none;/, 'nothing on screen until the corner key is pressed');
    assert.match(plain, /\.gm \.chat-panel\.is-active \{ display: flex; \}/);
    assert.match(body, /background: rgba\(14, 18, 17, \.8\)/, '80% opaque, not a fully transparent log');
    assert.match(body, /border-color: rgba\(255, 255, 255, \.12\)/);
    assert.match(body, /box-shadow: 0 4px 18px #0006/);
    assert.match(body, /backdrop-filter: none/);
    assert.doesNotMatch(body, /background: transparent/);
    // 层级必须低于表情盘：局内聊天 z-index 2 < .gm__corner 的 130（表情盘在角落那层里，emotes.css 里是 5）
    assert.match(body, /z-index: 2;/);
    assert.match(read('public/css/screens/game.css'), /\.gm__corner \{[^}]*z-index: 130/);
    assert.match(read('public/css/emotes.css'), /\.ewheel__panel \{\n {2}position: absolute;[^}]*z-index: 5;/);
  });

  test('the corner key is the one trigger: no global Enter, no trigger button in the panel, no auto-close on blur', () => {
    const panel = read('public/js/ui/chatBox.js');
    assert.doesNotMatch(panel, /e\.key === 'Enter'/, 'a bare Enter must not open the panel (it belongs to the facing wheel)');
    assert.match(panel, /e\.key === 'Escape'/, 'Esc still closes');
    assert.doesNotMatch(panel, /onBlur=/, 'blur no longer toggles the panel off under the corner key');
    const game = read('public/js/screens/game.js');
    assert.match(game, /data-testid="hud-chat"/, 'the corner 交流 key');
    assert.match(game, /<\\?\$\{ChatBox\} active=\$\{chatOpen\} onToggle=\$\{setChatOpen\} showTrigger=\$\{false\}/);
  });
});
