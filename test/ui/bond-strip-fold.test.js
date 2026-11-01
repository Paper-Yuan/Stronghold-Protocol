// test/ui/bond-strip-fold.test.js — 局内盟约栏的向上收起（业主 2026-10-29 后续要求：条体右侧一颗裸箭头，收起后只剩它）。
//
// 历史：0.2.x 的「整条 hidden」大收、上一轮重写的「小收」（只留圆盘）都被业主否过；0.3.1 原样则根本没有收起键。
// 现在按最新口径恢复「向上收起」：`.gm__bonds` 仍是顶栏下方居中的一行，右侧多一颗 chevron 键；收起时 `.gm__bond-list`
// 加 hidden，键留在原地（居中），再点展开；从盟约条打开的详情在收起时一并关掉。10 槽窗口 / 小收圆盘不再有。
//
// 横向滚动（原生 + 鼠标拖 + 两端淡出）在 bond-strip-scroll.test.js；这里只守收起。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

describe('the bond strip folds up from one bare chevron', () => {
  const css = read('public/css/screens/game.css');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const js = read('public/js/ui/bondStrip.js');
  const game = read('public/js/screens/game.js');

  test('the list is hidden while collapsed; the toggle carries the state and the labels', () => {
    assert.match(game, /const \[bondsCollapsed, setBondsCollapsed\] = useState\(false\);/);
    assert.match(game, /<div class=\$\{cx\('gm__bonds', bondsCollapsed && 'is-collapsed'\)\}>\n {8}<div id="match-bond-strip" class="gm__bond-list" hidden=\$\{bondsCollapsed\}>/);
    assert.match(game, /class="bonds-toggle" aria-expanded=\$\{!bondsCollapsed\} aria-controls="match-bond-strip"/);
    assert.match(game, /aria-label=\$\{bondsCollapsed \? t\('展开盟约'\) : t\('收起盟约'\)\}/);
    assert.match(game, /<\\?\$\{GIcon\} name=\$\{bondsCollapsed \? 'chevronDown' : 'chevronUp'\} \/>/);
    // collapsing closes a popup opened from the strip; the global Space shortcut must not fire from this key
    assert.match(game, /if \(!bondsCollapsed && bondOpen\?\.from === 'strip'\) setBondOpen\(null\);/);
    assert.match(game, /onKeyDown=\$\{\(e\) => \{ if \(e\.key === ' '\) e\.stopPropagation\(\); \}\}/);
    assert.doesNotMatch(game, /hidden=\$\{true\}|bstrip__fold-handle|bstrip-container/);
    assert.doesNotMatch(js, /localStorage|sp_bonds_collapsed/, 'the fold state lives in the screen, not in localStorage');
  });

  test('the collapsed CSS hides only the list; the old peek knob and ten-slot window are gone', () => {
    assert.match(css, /\.gm__bond-list\[hidden\] \{ display: none; \}/);
    assert.match(css, /\.gm__bonds \.bonds-toggle \{/);
    assert.match(css, /\.gm__bonds \.bonds-toggle \.icon \{/);
    // 收起态只用于把键移回正中（不是旧的「小收」圆盘）
    assert.match(css, /\.gm__bonds\.is-collapsed \.bonds-toggle \{ left: 50%; transform: translateX\(-50%\); \}/);
    for (const token of ['--bonds-peek', '--bslot-w', '--bslot-gap', '--bonds-visible', '--fade-w']) {
      assert.equal(bare.includes(token), false, `${token} left in game.css`);
    }
    // the shop's own fold is `.gm.is-collapsed` and is independent of the bond strip
    assert.doesNotMatch(bare, /\.gm\.is-collapsed \.gm__bonds/);
  });

  test('the strip keeps the 0.3.1 geometry in the open state', () => {
    assert.match(css, /\.gm__bonds \{ position: absolute; left: 50%; transform: translateX\(-50%\); top: 1\.36rem;/);
    assert.match(css, /\.bslot \{ position: relative; display: flex; flex-direction: column; align-items: center; width: \.74rem; \}/);
    assert.match(css, /\.bslot \.bond \{ --disc: \.52rem; \}/);
    // the list is not hidden by default, only through the [hidden] binding
    assert.doesNotMatch(bare, /\.gm__bond-list \{[^}]*display: none/);
  });

  test('the strip still scrolls while open (the ‹ › keys are gone, the native box and the mouse drag stay)', () => {
    assert.doesNotMatch(game, /t\('向左滚动盟约'\)|t\('向右滚动盟约'\)/);
    assert.doesNotMatch(js, /bstrip-scroll__arrow/);
    assert.match(css, /\.gm__bonds \.bstrip-scroll \.bstrip \{[^}]*overflow-x: auto/);
    assert.match(css, /\.bstrip-scroll\.is-dragging \{ cursor: grabbing; \}/);
  });
});
