// test/mods-align.test.js — the client mod cache's pure half (public/js/mods/): which data face a battle of a room
// simulates on (align.js roomDataBase, W-B), the URL of one catalogue file (sync.js fileUrl) and the cache-key guard
// (store.js safeModKey). No browser: none of the three touches navigator / indexedDB at import time, and the server
// side of the same contract is /room-data/<digest>/ (server/http/workshopServe.js) plus /mods/file/ (server/http/mods.js).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { roomDataBase, ROOM_DATA_PREFIX, DATA_PREFIX } from '../public/js/mods/align.js';
import { fileUrl } from '../public/js/mods/sync.js';
import { safeModKey, modKey, MOD_PREFIX } from '../public/js/mods/store.js';
import { modDigest } from '../shared/modIdentity.js';

const DIGEST = modDigest([{ id: 'ave-mujica', hash: '0'.repeat(64), layer: 'B', combat: true }]);

describe('roomDataBase (W-B): the data face a battle simulates on', () => {
  test('a room that declared nothing simulates on the process face', () => {
    assert.equal(roomDataBase(null, null), DATA_PREFIX);
    assert.equal(roomDataBase(undefined, { digest: DIGEST }), DATA_PREFIX);
  });

  test('the process set is /data/ (its bytes ARE what /data/ serves)', () => {
    assert.equal(roomDataBase({ digest: DIGEST, packs: [{ id: 'ave-mujica' }] }, { digest: DIGEST }), DATA_PREFIX);
  });

  test('an explicit empty set is the process face on a plain install and its own face on a modded server', () => {
    // 普通安装没有进程集：`vanilla` 就是 /data/（不装任何工坊包的那一份）
    assert.equal(roomDataBase({ digest: 'vanilla', packs: [] }, null), DATA_PREFIX);
    // 模组服务器上 /data/ 是「官方 + 全部已装包」，所以显式空集的房间要纯净官方那一份
    assert.equal(roomDataBase({ digest: 'vanilla', packs: [] }, { digest: DIGEST }), ROOM_DATA_PREFIX + 'vanilla/');
  });

  test('a room with its own set simulates on /room-data/<digest>/', () => {
    assert.equal(roomDataBase({ digest: DIGEST, packs: [{ id: 'ave-mujica' }] }, null), ROOM_DATA_PREFIX + DIGEST + '/');
    assert.equal(roomDataBase({ digest: DIGEST }, { digest: 'vanilla' }), ROOM_DATA_PREFIX + DIGEST + '/');
  });

  test('a digest that is not sha256 hex never becomes a URL', () => {
    for (const bad of ['', 'x', '../data', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), null, 7]) {
      assert.equal(roomDataBase({ digest: bad }, null), DATA_PREFIX, JSON.stringify(bad));
    }
  });
});

test('fileUrl percent-encodes per segment, never the separators', () => {
  assert.equal(fileUrl('ave-mujica', 'kits/chess_char_5_25_a.js'), '/mods/file/ave-mujica/kits/chess_char_5_25_a.js');
  assert.equal(fileUrl('a b', 'x y/z.js'), '/mods/file/a%20b/x%20y/z.js');
  assert.equal(fileUrl('p', 'a/b.js', '/other/'), '/other/p/a/b.js');
});

test('safeModKey accepts a pack file path and refuses anything that escapes its prefix', () => {
  assert.equal(safeModKey(modKey('ave-mujica', 'kits/x.js')), true);
  assert.equal(safeModKey(MOD_PREFIX + 'ave-mujica/README.md'), true);
  for (const bad of ['', '/abs', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'a\u0000b', 'a'.repeat(1025), null, 7]) {
    assert.equal(safeModKey(bad), false, JSON.stringify(bad));
  }
});
