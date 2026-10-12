// test/ui/danmaku.test.js — 验证弹幕单例、开关状态持久化与单人/多人模式弹幕展示机制

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal browser globals for testing roomDanmaku
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.children = [];
    this.textContent = '';
    this.parentNode = null;
  }
  setAttribute(k, v) { this[k] = v; }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }
  getBoundingClientRect() { return { width: 100, height: 28 }; }
  animate(keyframes, options) {
    return {
      cancel() {},
      onfinish: null,
    };
  }
}

describe('roomDanmaku behavior in solo and coop', () => {
  let prevWindow, prevDoc, prevLocal;
  const storeMap = new Map();

  beforeEach(() => {
    storeMap.clear();
    globalThis.localStorage = {
      getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
      setItem: (k, v) => storeMap.set(k, String(v)),
    };
    globalThis.document = {
      readyState: 'complete',
      hidden: false,
      body: new MockElement('body'),
      createElement: (tag) => new MockElement(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.window = {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.innerHeight = 720;
    globalThis.innerWidth = 1280;
  });

  test('createRoomDanmaku mounts layer and respects initial localStorage toggle', async () => {
    const { createRoomDanmaku } = await import('../../public/js/ui/roomDanmaku.js');
    const danmaku = createRoomDanmaku();
    assert.equal(danmaku.enabled, true);

    const layer = globalThis.document.body.children.find((c) => c.className === 'spchat-danmaku');
    assert.ok(layer, 'spchat-danmaku layer created');

    danmaku.dispose();
  });

  test('toggle and setEnabled update state and persist to localStorage', async () => {
    const { createRoomDanmaku } = await import('../../public/js/ui/roomDanmaku.js');
    const danmaku = createRoomDanmaku();

    danmaku.toggle();
    assert.equal(danmaku.enabled, false);
    assert.equal(localStorage.getItem('sp.chat.danmaku.enabled'), '0');

    danmaku.setEnabled(true);
    assert.equal(danmaku.enabled, true);
    assert.equal(localStorage.getItem('sp.chat.danmaku.enabled'), '1');

    danmaku.dispose();
  });

  test('show generates danmaku element with message and name for both solo and coop messages', async () => {
    const { createRoomDanmaku } = await import('../../public/js/ui/roomDanmaku.js');
    const danmaku = createRoomDanmaku();
    const layer = globalThis.document.body.children.find((c) => c.className === 'spchat-danmaku');

    // Solo message (mine)
    danmaku.show({ name: '测试博士', text: '单人模式弹幕测试！' }, true);
    assert.equal(layer.children.length, 1);
    assert.equal(layer.children[0].textContent, '测试博士：单人模式弹幕测试！');
    assert.equal(layer.children[0].style.color, '#65f1ca'); // mine highlight

    // Teammate message (not mine)
    danmaku.show({ name: '队友博士', text: '收到，守住中路！' }, false);
    assert.equal(layer.children.length, 2);
    assert.equal(layer.children[1].textContent, '队友博士：收到，守住中路！');
    assert.equal(layer.children[1].style.color, '#ffffff');

    danmaku.clear();
    assert.equal(layer.children.length, 0);
    danmaku.dispose();
  });

  test('getRoomDanmaku returns consistent singleton', async () => {
    const { getRoomDanmaku } = await import('../../public/js/ui/roomDanmaku.js');
    const a = getRoomDanmaku();
    const b = getRoomDanmaku();
    assert.equal(a, b);
  });
});
