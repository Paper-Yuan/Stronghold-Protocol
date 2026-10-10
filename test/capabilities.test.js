// test/capabilities.test.js — B3：能力位开关与打包期改写的机器凭证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_FEATURES } from '../shared/capabilities.js';
import { rewriteCapabilities } from '../scripts/pack/_lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('LOCAL_FEATURES：源码默认 mods / multiplayer 双开（双端包用），且是冻结对象', () => {
  assert.equal(LOCAL_FEATURES.mods, true);
  assert.equal(LOCAL_FEATURES.multiplayer, true);
  assert.ok(Object.isFrozen(LOCAL_FEATURES));
});

test('LOCAL_FEATURES：不再声明 endless（无尽模式已整体删除）', () => {
  assert.ok(!('endless' in LOCAL_FEATURES));
  const src = readFileSync(join(ROOT, 'shared/capabilities.js'), 'utf8');
  assert.doesNotMatch(src, /endless/i);
});

test('rewriteCapabilities：把 multiplayer 置 false，其余键与注释原样保留', () => {
  const src = readFileSync(join(ROOT, 'shared/capabilities.js'), 'utf8');
  const out = rewriteCapabilities(src, { multiplayer: false });
  assert.ok(out, 'rewrite returns new source');
  assert.match(out, /multiplayer:\s*false/);
  assert.match(out, /mods:\s*true/, 'mods untouched');
  // every non-flag line survives byte-for-byte (comments, exports, JSDoc)
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(multiplayer|mods):/.test(l)).join('\n');
  assert.equal(strip(out), strip(src));
});

test('rewriteCapabilities：源码里没有该开关时返回 null（调用方据此告警）', () => {
  assert.equal(rewriteCapabilities('export const X = 1;', { multiplayer: false }), null);
});

test('变体包产物能力位：暂存副本改写后 LOCAL_FEATURES.multiplayer 为 false（模拟打包器动作）', () => {
  const src = readFileSync(join(ROOT, 'public/shared/capabilities.js'), 'utf8');
  const out = rewriteCapabilities(src, { multiplayer: false });
  assert.ok(out);
  // 从改写后的源码里读出运行值——证明改的是运行期读到的那个常量
  const value = /multiplayer:\s*(true|false)/.exec(out)?.[1];
  assert.equal(value, 'false');
});
