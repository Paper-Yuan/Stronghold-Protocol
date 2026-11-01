// test/ui/bond-strip-scroll.test.js — 局内盟约栏的横向滚动（业主 2026-10-29 真机否掉重写后的口径：照 0.3.1 旧版，
// 但两侧的 ‹ › 调整键在 2026-10-29 后续要求里删除）。
//
// 0.3.1（modref/v2.1/public/js/ui/bondStrip.js 的 BondScroller + game.css 的 `.bstrip-scroll` 那一段）的形态，
// 加上业主 2026-10-29 后续要求的三件事：
//   ① 条体居中在顶栏下方，可以从小箭头向上收起（bond-strip-fold.test.js）；
//   ② 盟约多时**没有**两侧的 ‹ › 键：条体自己就是原生横向滚动盒（触屏 / 滚轮 / 触控板），
//      过长时两端用 data-edge 淡出淡入，鼠标可以按住左右拖；没有 10 槽可见窗口；
//   ③ 宽度上限照旧版：min(62vw, 46rem)，< 900px 放宽到 100% − 1.2rem，16:10 / 4:3 收到 100% − 6.2rem；
//   ④ 指针不变式照旧（user playtest #2 item 8）：条体那片空盒子不吃指针，只有圆盘是命中目标。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('the in-match bond strip scrolls natively, with no arrow keys', () => {
  const css = read('public/css/screens/game.css');
  const js = read('public/js/ui/bondStrip.js');

  test('BondScroller: wrapper + edge fades + mouse drag — no ‹ › keys', () => {
    assert.match(js, /<div class="bstrip-scroll" ref=\$\{box\} data-edge=\$\{edge \|\| null\}/, 'the wrapper carries the edge state');
    assert.doesNotMatch(js, /bstrip-scroll__arrow/, 'the two arrow buttons are gone');
    assert.doesNotMatch(js, /向左滚动盟约|向右滚动盟约/, 'and their labels');
    // 过长时两端淡出：scrollLeft / clientWidth / scrollWidth → data-edge
    assert.match(js, /el\.scrollLeft > 1/);
    assert.match(js, /el\.scrollLeft \+ el\.clientWidth < el\.scrollWidth - 1/);
    assert.match(js, /left && right \? 'both' : left \? 'left' : right \? 'right' : ''/);
    assert.match(js, /el\.addEventListener\('scroll', update, \{ passive: true \}\)/);
    assert.match(js, /typeof ResizeObserver === 'function' \? new ResizeObserver/);
    // 鼠标按住左右拖：4px 以内仍是轻点（照常打开弹窗），拖过就把 click 吞掉
    assert.match(js, /e\.pointerType === 'touch'/, 'a touch screen keeps the native pan-x');
    assert.match(js, /Math\.abs\(dx\) > 4/);
    assert.match(js, /d\.el\.scrollLeft = d\.left - dx/);
    assert.match(js, /swallowed\.current = true/);
    assert.match(js, /onClickCapture=\$\{\(e\) => \{ if \(swallowed\.current\)/);
  });

  test('the strip body is the native scroll box (the mouse drag scrolls it, no scroll snap)', () => {
    const rule = /\n\.gm__bonds \.bstrip-scroll \.bstrip \{([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(rule, /overflow-x: auto/, 'a finger / wheel pans it directly');
    assert.match(rule, /overflow-y: hidden/);
    assert.match(rule, /touch-action: pan-x/, 'a finger pans it directly');
    assert.match(rule, /scrollbar-width: thin/);
    // the ring's SVG stroke paints ~7px past the last disc: the horizontal padding keeps it inside the padding
    // box, so a strip that fits reports scrollWidth === clientWidth (no phantom right fade, no 7px drag)
    assert.match(rule, /padding: \.08rem \.2rem; margin: -\.08rem 0;/, 'clip padding offset by margins (#678)');
    assert.match(css, /\.bstrip-scroll \{[^}]*display: flex; align-items: center; min-width: 0; max-width: 100%; gap: \.04rem;/);
    assert.match(css, /\.bstrip-scroll \.bslot \{ flex: none; \}/);
    // the snap and the old fade overlays are gone (the fade is a mask now, the drag moves scrollLeft directly)
    assert.doesNotMatch(js, /scroll-snap|dataset\.edge|EDGE_PX/);
    assert.doesNotMatch(css, /scroll-snap-type|\.gm__bond-list\[data-edge/);
  });

  test('the arrow styles are gone; the edge fades, the fold key and the drag cursor are in', () => {
    assert.doesNotMatch(css, /\.bstrip-scroll__arrow/, 'no arrow button rules, enabled or disabled');
    assert.match(css, /--fade-l: 0px; --fade-r: 0px; --fade-la: 1; --fade-ra: 1;/);
    assert.match(css, /\.bstrip-scroll\[data-edge="left"\] \.bstrip \{[^}]*--fade-la: 0;/);
    assert.match(css, /\.bstrip-scroll\[data-edge="right"\] \.bstrip \{[^}]*--fade-ra: 0;/);
    assert.match(css, /\.gm__bonds \.bonds-toggle \{/);
    assert.match(css, /\.gm__bond-list\[hidden\] \{ display: none; \}/);
    assert.match(css, /\.bstrip-scroll\.is-dragging \{ cursor: grabbing; \}/);
    // the pen / the draft overlay still take the whole strip away
    assert.match(css, /\.gm\.is-pen \.gm__bonds \.bstrip-scroll \*, \.gm\.has-sp \.gm__bonds \.bstrip-scroll \* \{ pointer-events: none; \}/);
  });

  test('the width caps: 62vw / 46rem everywhere; the narrow and 16:10 rules never widen past 62vw', () => {
    const rule = /\.gm__bonds \{([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(rule, /left: 50%/);
    assert.match(rule, /transform: translateX\(-50%\)/);
    assert.match(rule, /top: 1\.36rem/);
    assert.match(rule, /max-width: min\(62vw, 46rem\)/);
    assert.match(rule, /justify-content: center/);
    // 业主 2026-10-29「盟约条太宽了」：窄屏不再放宽到 100% − 1.2rem（手机上会铺满 94%）
    assert.match(css, /@media \(max-width: 900px\) \{\n {2}\.gm__bonds \{ max-width: min\(62vw, calc\(100% - 1\.2rem\)\); \}\n\}/);
    assert.match(css, /@media \(max-aspect-ratio: 16\/10\) \{\n {2}\.gm__bonds \{ max-width: min\(62vw, calc\(100% - 6\.2rem\)\); \}\n\}/);
    // no second width branch from the ten-slot window
    assert.equal(css.includes('100vw - 2 * (44px + .26rem)'), false);
  });

  test('方案 A 的指针不变式保留：空盒子不吃指针，圆盘才是命中目标', () => {
    assert.match(css, /\.gm__bonds > \*, \.gm__bonds \.bstrip \{ pointer-events: none; \}/);
    assert.match(css, /\.gm__bonds \.bslot, \.gm__bonds \.bstrip__more \{ pointer-events: auto; \}/);
    assert.match(css, /\.gm__bonds \.bstrip-scroll \.bstrip \{[^}]*pointer-events: auto;/, '0.3.1 re-enables it on the scroll box itself');
    assert.doesNotMatch(css, /\.gm__bonds > \* \{ pointer-events: auto; \}/);
  });

  test('one shared implementation: no mode / difficulty branch in the strip', () => {
    assert.doesNotMatch(js, /data-difficulty|zhajing|annihilation/i);
    assert.doesNotMatch(css, /\.gm__bonds\[data-(difficulty|mode)/);
  });
});
