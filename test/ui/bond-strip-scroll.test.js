// test/ui/bond-strip-scroll.test.js — 局内盟约栏的横向滑动。
//
// bondStrip.js 一直有滑动的**意图**（左右渐隐的 updateMask、把竖直滚轮转成 scrollLeft 的 onWheel、ResizeObserver

// 重算），但它作用在一个**不可滚动**的盒子上：css 里没有任何 overflow-x，滚轮是空操作、触摸也无从滑，溢出到右边的

// 盟约圆盘被遮罩裁掉 —— 看得见「还有」，够不着。这个测试钉住 CSS 侧的那一半，同时钉住「盟约栏不挡棋盘」的不变式：

// 条体自身 pointer-events: none（playtest2 item 8 的成果），只有圆盘/＋N/收起按钮是命中目标，所以拖拽手势只会从圆盘

// 上起手，条体那一片空盒子仍然让棋盘上的棋子可点可拖。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('the in-match bond strip scrolls horizontally', () => {
  const css = read('public/css/screens/game.css');
  const js = read('public/js/ui/bondStrip.js');

  test('.bstrip is a real scroll container, without a scrollbar', () => {
    // 独立的那条规则（`.gm__bonds .bstrip { pointer-events: none; }` 也含 `.bstrip {`，先跳过它）
    const rule = /\n\.bstrip \{\s*display: flex([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(rule, /overflow-x:\s*auto/, 'the masks and the wheel handler need something to scroll');
    assert.match(rule, /overscroll-behavior-x:\s*contain/, 'the gesture must not chain to the page');
    assert.match(rule, /scrollbar-width:\s*none/);
    assert.match(css, /\.bstrip::-webkit-scrollbar \{ display: none; \}/);
  });

  test('the strip still never blocks the board: only the discs take the pointer', () => {
    assert.match(css, /\.gm__bonds > \*, \.gm__bonds \.bstrip \{ pointer-events: none; \}/);
    assert.match(css, /\.gm__bonds \.bslot, \.gm__bonds \.bstrip__more \{ pointer-events: auto; \}/);
  });

  test('a vertical wheel pans it, and the fade masks follow scrollLeft', () => {
    assert.match(js, /Math\.abs\(e\.deltaX\) < Math\.abs\(e\.deltaY\)/);
    assert.match(js, /scrollRef\.current\.scrollLeft \+= e\.deltaY/);
    assert.match(js, /el\.scrollWidth > el\.clientWidth \+ 4/, 'the mask only shows when it overflows');
    assert.match(js, /el\.addEventListener\('scroll', onScroll/, 'the mask must follow the scroll');
  });
});
