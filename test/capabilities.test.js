// test/capabilities.test.js — B3：能力位开关与打包期改写的机器凭证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_FEATURES } from '../shared/capabilities.js';
import { rewriteCapabilities } from '../scripts/pack/_lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('LOCAL_FEATURES：源码默认双开（双端包用），且是冻结对象', () => {
  assert.equal(LOCAL_FEATURES.endless, true);
  assert.equal(LOCAL_FEATURES.mods, true);
  assert.ok(Object.isFrozen(LOCAL_FEATURES));
});

test('rewriteCapabilities：把 endless 置 false，其余键与注释原样保留', () => {
  const src = readFileSync(join(ROOT, 'shared/capabilities.js'), 'utf8');
  const out = rewriteCapabilities(src, { endless: false });
  assert.ok(out, 'rewrite returns new source');
  assert.match(out, /endless:\s*false/);
  assert.match(out, /mods:\s*true/, 'mods untouched');
  // every non-flag line survives byte-for-byte (comments, exports, JSDoc)
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(endless|mods):/.test(l)).join('\n');
  assert.equal(strip(out), strip(src));
});

test('rewriteCapabilities：源码里没有该开关时返回 null（调用方据此告警）', () => {
  assert.equal(rewriteCapabilities('export const X = 1;', { endless: false }), null);
});

test('服务器包产物能力位：暂存副本改写后 public/shared/capabilities.js 为 endless:false（模拟打包器动作）', () => {
  const src = readFileSync(join(ROOT, 'public/shared/capabilities.js'), 'utf8');
  const out = rewriteCapabilities(src, { endless: false });
  assert.ok(out);
  // 从改写后的源码里读出运行值——证明改的是运行期读到的那个常量
  const value = /endless:\s*(true|false)/.exec(out)?.[1];
  assert.equal(value, 'false');
});

test('入口守卫：title/lobby 的无尽入口都以 LOCAL_FEATURES.endless 条件渲染（静态断言）', () => {
  const title = readFileSync(join(ROOT, 'public/js/screens/title.js'), 'utf8');
  const lobby = readFileSync(join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
  assert.match(title, /LOCAL_FEATURES\.endless\s*\?[\s\S]{0,400}title-op-endless/, 'title endless button is guarded');
  assert.match(lobby, /LOCAL_FEATURES\.endless\s*\?[\s\S]{0,600}EndlessCard/, 'lobby endless card is guarded');
});
