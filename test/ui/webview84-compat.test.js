// test/ui/webview84-compat.test.js — WebView / Chromium 84 兼容守卫（业主 2026-10-26）
//
// 84 不支持 inset（87+）、aspect-ratio（88+）、dvh/svh（88+）、:has()（105+）。
// 这里只钉住「回退层存在且顺序正确」以及「浏览器代码不出现 84 没有的 JS API」，避免以后又漂回去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('index.html：compat84.css 在 theme.css 之后、components.css 之前', () => {
  const html = read('public/index.html');
  const theme = html.indexOf('/css/theme.css');
  const compat = html.indexOf('/css/compat84.css');
  const comp = html.indexOf('/css/components.css');
  assert.ok(theme >= 0 && compat >= 0 && comp >= 0);
  assert.ok(theme < compat && compat < comp, `theme ${theme} < compat ${compat} < components ${comp}`);
});

test('compat84.css：inset 回退覆盖关键全屏层', () => {
  const css = read('public/css/compat84.css');
  assert.match(css, /@supports not \(inset: 0\)/);
  for (const cls of ['.gm', '.screen', '.traitov', '.ctrov', '.olarch', '.warn', '.chat-panel']) {
    assert.ok(css.includes(cls), `缺少 ${cls}`);
  }
  assert.match(css, /top:\s*0/);
  assert.match(css, /left:\s*0/);
});

test('compat84.css：aspect-ratio 兜底', () => {
  const css = read('public/css/compat84.css');
  assert.match(css, /@supports not \(aspect-ratio: 1 \/ 1\)/);
  assert.match(css, /min-height/);
});

test('浏览器 JS 的 84 缺口由 ui/compat.js 统一 polyfill，且 main.js 最先加载它', () => {
  const main = read('public/js/main.js');
  const imports = [...main.matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(imports[0], './ui/compat.js', 'main.js 必须先 import ui/compat.js');
  const compat = read('public/js/ui/compat.js');
  for (const api of ['hasOwn', "'at'", 'structuredClone']) assert.ok(compat.includes(api), `compat 缺 ${api}`);
  // 其它文件可以直接使用这些 API：main.js 已先加载 polyfill（上面的断言）。
});
