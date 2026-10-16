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
    assert.match(panel, /bottom:\s*96px/);
    assert.match(panel, /width:\s*230px/);
    assert.match(panel, /height:\s*220px/);
    const trig = /\.chat-trigger-btn \{([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(trig, /position:\s*fixed/);
    assert.match(trig, /border-radius:\s*50%/, 'the closed state is a round entry point');
    assert.match(css, /\.chat-trigger-btn::before \{[^}]*width: 44px; height: 44px;/, 'the touch target, not the visible dot');
    assert.match(css, /\.chat-panel:not\(\.is-active\) \{/, 'closed = only the entry point');
  });

  test('the room screen mounts it (uncontrolled: the panel carries its own trigger)', () => {
    assert.match(room, /import \{ ChatBox \} from '\.\.\/ui\/chatBox\.js'/);
    assert.match(room, /<\$\{ChatBox\} \/>/);
    assert.doesNotMatch(room, /<\$\{ChatBox\} active=/, 'the room uses the uncontrolled form');
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
