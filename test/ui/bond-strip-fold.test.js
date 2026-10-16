// test/ui/bond-strip-fold.test.js — 局内盟约栏的「收起」。
//
// 这里钉住的是**本仓库自己**的收起：垂直抽屉（bstrip-container > bstrip-tray + 把手），收起时托盘向上滑进把手后面、
// 把手图标翻转 180°，勾选状态记在 localStorage 的 sp_bonds_collapsed。上游 0.3.0 带来的左侧裸箭头（.bonds-toggle +

// .gm__bond-list[hidden]）已经删除 —— 两套并存过一段时间，页面同时渲染了两者，外面那层是上游的。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('the bond strip folds with our own vertical drawer', () => {
  const css = read('public/css/screens/game.css');
  const js = read('public/js/ui/bondStrip.js');
  const game = read('public/js/screens/game.js');

  test('the drawer is styled: a tray that slides up, a handle that flips', () => {
    for (const sel of ['.bstrip-container {', '.bstrip-tray {', '.bstrip__fold-handle {', '.bstrip__fold-icon {']) {
      assert.ok(css.includes(sel), `css has ${sel}`);
    }
    assert.match(css, /\.bstrip-container\.is-collapsed \.bstrip-tray \{[^}]*max-height: 0/, 'collapsed = the tray collapses');
    assert.match(css, /\.bstrip-container\.is-collapsed \.bstrip__fold-icon \{ transform: rotate\(180deg\); \}/);
    assert.match(css, /\.gm__bonds \.bstrip__fold-handle \{ pointer-events: auto; \}/, 'and it is still the only extra hit target');
  });

  test('upstream bare-arrow toggle is gone and the strip mounts straight into .gm__bonds', () => {
    assert.doesNotMatch(game, /class="bonds-toggle"/);
    assert.doesNotMatch(game, /id="match-bond-strip"/);
    assert.doesNotMatch(css, /\.bonds-toggle \{/);
    assert.match(game, /<div class="gm__bonds">\s*\n\s*<\$\{BondStrip\}/, 'no wrapper between them');
  });

  test('the folded state is ours: sp_bonds_collapsed, and the handle is labelled 收起盟约 / 展开盟约', () => {
    assert.match(js, /localStorage\.getItem\('sp_bonds_collapsed'\)/);
    assert.match(js, /localStorage\.setItem\('sp_bonds_collapsed'/);
    assert.match(js, /class=\$\{cx\('bstrip-container', collapsed && 'is-collapsed'\)\}/);
    assert.match(js, /class="bstrip__fold-handle"/);
    assert.match(js, /t\('收起盟约'\)/);
    assert.match(js, /t\('展开盟约'\)/);
  });

  test('a strip opened from the drawer still scrolls (the fork had overflow-x as well)', () => {
    const rule = /\n\.bstrip \{\s*display: flex([^}]*)\}/.exec(css)?.[1] || '';
    assert.match(rule, /overflow-x:\s*auto/);
    assert.match(rule, /max-width:\s*min\(11\.2rem, 66vw\)/);
  });
});
