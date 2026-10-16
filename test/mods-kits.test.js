// test/mods-kits.test.js — public/js/battle/modKits.js: the browser half of the room-mod kit injection (W-C).
//
// The server hands `battle.opts.kits` straight to the sim; a browser cannot receive a function, so the BattleSpec
// carries `modules` (server/sim/spec.js modModules) and the page imports them itself. What this file pins is the
// CONTRACT a hostile spec cannot break: only server-rooted paths are ever imported, malformed entries are ignored,
// and an absent list costs nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadModuleKits } from '../public/js/battle/modKits.js';

test('no modules at all: an empty result, never a throw', async () => {
  for (const v of [undefined, null, [], 'x', 7, {}]) assert.deepEqual(await loadModuleKits(v), {});
});

test('only server-rooted paths are imported', async () => {
  // 远程 URL / data: URL 一律不 import：规格里的 url 只允许是同源的绝对路径（server/sim/spec.js 的第一道闸门也是这条）
  const out = await loadModuleKits([
    { id: 'a', url: 'http://evil.example/x.js' },
    { id: 'b', url: 'https://evil.example/x.js' },
    { id: 'c', url: 'data:text/javascript,export default 1' },
    { id: 'd', url: '//evil.example/x.js' },
    { id: 'e', url: 'x.js' },
    null, undefined, 'x', 7,
  ]);
  assert.deepEqual(out, {});
});

test('a module that cannot be imported is skipped, not fatal', async () => {
  // 这条路径在 Node 里不存在：import 失败被吞成 null，同一个 URL 不会重复尝试
  const out = await loadModuleKits([{ id: 'chess_x', pack: 'p', url: '/definitely/not/here.js' }]);
  assert.deepEqual(out, {});
});
