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
    // 日志常显：收起只去掉输入行，不再整块藏起来
    assert.match(css, /\.chat-panel:not\(\.is-active\) \.chat-form \{ display: none; \}/);
    assert.doesNotMatch(css, /\.chat-panel:not\(\.is-active\) \.chat-log \{ display: none; \}/);
    // 半收起 = 只留一行；局内让开角落按钮那一列
    assert.match(css, /\.chat-panel\.is-collapsed \.chat-log \{ max-height: 34px; \}/);
    assert.match(css, /\.gm \.chat-panel \{\s*left: \.24rem; bottom: \.9rem;/, 'above the four corner buttons');
    // 更透明 + 不吃指针（只有控件接收点击，日志区域穿透到棋盘）
    assert.match(css, /\.chat-panel \{[^}]*background: rgba\(14, 18, 17, \.52\)/);
    assert.match(css, /\.chat-panel \{[^}]*pointer-events: none/);
    assert.match(css, /\.chat-panel \.chat-log \{ pointer-events: none; \}/);
    // 局内那份是全透明、窄、可滑动的（一条一行 / 5 行 / 半收起 3 行）
    assert.match(css, /\.gm \.chat-panel \{[^}]*background: transparent/);
    assert.match(css, /\.gm \.chat-panel \{[^}]*width: 2\.5rem/);
    assert.match(css, /\.gm \.chat-panel \.chat-log \{[^}]*overflow-y: auto; pointer-events: auto/);
    assert.match(css, /\.gm \.chat-panel \.chat-log \{[^}]*max-height: 80px/);
    assert.match(css, /\.gm \.chat-panel\.is-collapsed \.chat-log \{ max-height: 48px; \}/);
    assert.match(css, /\.gm \.chat-panel \.chat-item \{[^}]*white-space: nowrap/);
    assert.match(css, /\.chat-panel \.chat-header-bar[\s\S]{0,220}pointer-events: auto/);
    assert.match(css, /\.chat-panel \.chat-send-btn \{ pointer-events: auto; \}/);
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
});

describe('the in-match bond strip is centred', () => {
  test('.gm__bonds carries symmetric insets', () => {
    const css = read('public/css/screens/game.css');
    assert.match(css, /\.gm__bonds \{ position: absolute; left: 2\.5rem; top: 1\.36rem; right: 2\.5rem;/);
  });
});
