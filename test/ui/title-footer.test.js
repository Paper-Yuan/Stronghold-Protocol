// test/ui/title-footer.test.js — 首页底栏的结构守卫（业主口径 2026-10-29）。
//
// 为什么要有这个文件：底栏结构（--legal / --meta / --thanks 三行 → 两行、感谢名单的左下起点、版本号回到右下）
// 在上一轮**没有任何测试覆盖** —— 全仓 grep `.title-foot__row--*` / `.title-thanks` / `.title-foot__meta` 零命中，
// 于是「感谢名单独占第三行、手机上压住插件按钮、版本号被挤到中间行右侧」就这么溜进去了。这里只做静态断言
// （照 test/ui/ban-picker.test.js 的手法，不求值模板、不开浏览器），钉住三件事：
//   1. 两行结构：--legal 在上、--thanks 在下，--meta 这一行不再存在；
//   2. 最后一行 = 感谢名单（行首，贴左下角）+ .title-foot__meta（行尾，贴右下角），版本号是 meta 的最后一项；
//   3. 长度与动效：桌面 32%（曾是 46%）、手机 46vw（曾是 72vw）、不居中、滚动 ≥ 44 s、减动效块还在。
// 它守不住像素位置（那要浏览器），但能守住「结构被改回去」这一类回归。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const title = read('public/js/screens/title.js');
const css = read('public/css/screens/title.css');

/** The footer's template text, from `<footer class="title-foot">` to its `</footer>` (the only footer on the screen). */
const footer = (() => {
  const start = title.indexOf('<footer class="title-foot">');
  assert.ok(start > 0, 'the title screen still has a .title-foot footer');
  const end = title.indexOf('</footer>', start);
  assert.ok(end > start, 'that footer closes');
  return title.slice(start, end);
})();

test('the footer is TWO rows: --legal above --thanks, and the --meta row is gone', () => {
  const legal = footer.indexOf('title-foot__row--legal');
  const thanks = footer.indexOf('title-foot__row--thanks');
  assert.ok(legal > 0, 'the legal row exists');
  assert.ok(thanks > 0, 'the thanks row exists');
  assert.ok(legal < thanks, '--legal stays above --thanks (the plugins button must never sit under the ticker)');
  // 上一轮把 meta 单独提成一行；那一行正是版本号离开右下、底栏长高的来源
  assert.equal(footer.includes('title-foot__row--meta'), false, 'no --meta row any more (the meta block rides the --thanks row)');
  assert.equal(css.includes('title-foot__row--meta'), false, 'and no leftover --meta rule in title.css');
  // 底栏里只有这两个行 div（防止有人把感谢名单再拆出去）
  assert.equal((footer.match(/class="title-foot__row/g) || []).length, 2, 'exactly two footer rows');
});

test('the last row is 感谢名单 + version meta: version is the LAST item, so it sits in the bottom-right corner', () => {
  const row = footer.slice(footer.indexOf('title-foot__row--thanks'));
  const marquee = row.indexOf('<${ThanksMarquee} />');
  const meta = row.indexOf('class="title-foot__meta"');
  assert.ok(marquee > 0, 'the thanks ticker is on the last row');
  assert.ok(meta > marquee, 'the meta block follows the ticker (space-between puts it at the right edge)');
  // meta 内部顺序：项目仓库 → 开发版标签 → 版本号（版本号必须最后一项，贴右下角；也是 /arg/ 彩蛋的入口）
  const inner = row.slice(meta);
  const repo = inner.indexOf('class="title-repo"');
  const dev = inner.indexOf('class="title-dev"');
  const egg = inner.indexOf('class="title-egg"');
  assert.ok(repo > 0, 'the 项目仓库 link lives in the meta block');
  assert.ok(dev > repo, 'the development tag comes after the repo link');
  assert.ok(egg > dev, 'the version label is the last item of the meta block');
  assert.match(inner, /v\$\{APP_VERSION\}/, 'the version string itself is still there');
  // 插件按钮留在 --legal（上一轮的回归就是它被感谢名单压住）
  assert.ok(footer.slice(0, footer.indexOf('title-foot__row--thanks')).includes('data-testid="title-plugins"'),
    'the plugins button stays in the --legal row');
});

test('the row pins both ends: space-between + nowrap, the meta keeps its width but may still wrap', () => {
  assert.match(css, /\.title-foot__row--thanks \{ justify-content: space-between; align-items: flex-end; flex-wrap: nowrap;/,
    'the last row spreads its two ends and never wraps the version onto a second line');
  // flex: 0 1 auto（不是 none）: 桌面上 meta 拿到自己的自然宽度；手机 + 特大文字时它才允许收窄，把内容折到第二行，
  // 而不是把版本号挤出屏幕（审计 §5.5 的窄屏风险）。
  assert.match(css, /\.title-foot__row--thanks \.title-foot__meta \{ flex: 0 1 auto; min-width: 0; \}/,
    'the meta keeps its natural width but may shrink and wrap inside itself');
  // 桌面：32%（曾是 46%）+ 22rem 上限；名单仍然贴行首，起点就是左下角
  assert.match(css, /\.title-foot__row--thanks \.title-thanks \{ flex: 1 1 auto; min-width: 0; max-width: min\(22rem, 32%\); margin-top: 0; \}/,
    'desktop: 32 % of the footer row');
  assert.equal(/max-width:\s*46%/.test(css), false, 'the old 46 % desktop length is gone');
});

test('a phone: 46 vw (was 72 vw), still starting at the left edge — not centred', () => {
  const block = css.slice(css.indexOf('@media (max-width: 520px), (max-height: 520px)'));
  assert.ok(block.length > 0, 'the phone media query is there');
  const body = block.slice(0, block.indexOf('}\n}') + 3);
  assert.match(body, /\.title-foot__row--thanks \.title-thanks \{ width: auto; max-width: 46vw; margin-top: 0; \}/,
    'phone: 46 vw of ticker');
  assert.equal(body.includes('72vw'), false, 'the old 72 vw length is gone');
  assert.equal(/\.title-foot__row--thanks \{ justify-content: center/.test(body), false,
    'a centred ticker does not start in the bottom-left corner');
});

test('the crawl stays slow enough to read, and 减动效 still stops it', () => {
  const m = /animation: thanks-scroll (\d+)s linear infinite/.exec(css);
  assert.ok(m, 'the ticker still scrolls');
  assert.ok(Number(m[1]) >= 44, `${m[1]}s: a 32 % / 46 vw window needs ≥ 44 s, or names fly past unread`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.title-thanks__track \{ animation: none; \}/,
    'prefers-reduced-motion still stops the track');
});
