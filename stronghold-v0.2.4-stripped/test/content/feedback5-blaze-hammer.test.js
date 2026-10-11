// Community report of 2026-10-06 「维多利亚的锁血锤和烛煌的锁血只生效了一个」 (item 5): both work, one after the other. On
// 烛煌's lethal hit her talent 绝处重燃 (kit `fatal` −50: 倒地, 6000 barrier, PRTS 备注 「次数不限」 outside 【重燃】) comes first;
// 坚固维式重锤's once-per-deployment 不死 lock (PRIO_REVIVE −100: consumable savers run last, so a talent's own undying never
// wastes the charge — items/battle.js header, DESIGN §21.21 / §22) waits for a lethal hit while she is 倒地, then holds her
// at 1 HP for 8 s. No source gives that order (the official autochess hammer buff is not in the client's buff templates);
// the owner kept it (the owner's decision of 2026-10-07: 绝处重燃 first, then the lock; DESIGN §25.21.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };

/** 烛煌 (elite) carrying `items`, hit for 3000 true damage every 2 s by a far enemy; the timeline of her savers. */
function run(items) {
  const h = makeBattle({
    units: [{ chessId: 'chess_char_5_03_b', row: 9, col: 4, items }],
    enemies: [{ key: 'enemy_far', time: 0, route: 0 }],
    defs: { enemies: { enemy_far: enemyRec({ key: 'enemy_far', hp: 1e9, atk: 0, bat: 99, speed: 0.0001 }) } },
    timeLimit: 120, seed: 3,
  });
  const u = h.unit('chess_char_5_03_b');
  const out = { downedAt: null, lockAt: null, deathAt: null };
  h.b.every(2, () => { const e = h.b.enemies.find((x) => x.alive); if (e && u.alive) h.b.dealDamage(e, u, { amount: 3000, type: 'true', canDodge: false }); });
  h.b.on('death', (c) => { if (c.unit === u && out.deathAt == null) out.deathAt = h.b.time; }, { priority: -1000 });
  h.step(); // the battle-start deployment
  while (!h.b.finished && h.b.time < 60 && u.alive) {
    h.step();
    if (out.downedAt == null && u.mem.downed) out.downedAt = h.b.time;
    if (out.lockAt == null && u.mem.undyingUntil != null) out.lockAt = h.b.time;
  }
  return out;
}

test('烛煌 + 坚固维式重锤: 绝处重燃 on the first lethal hit, the lock on the next one while 倒地, death 8 s later', REAL, () => {
  const w = run(['chess_item_3_09_e_a']);
  assert.ok(w.downedAt != null && w.downedAt < 2.1, `倒地 at the first lethal hit (2 s), got ${w.downedAt}`);
  assert.ok(w.lockAt != null && w.lockAt > 7.9 && w.lockAt < 8.1, `the lock at the hit that breaks the barrier (8 s), got ${w.lockAt}`);
  assert.ok(Math.abs(w.deathAt - 16) < 0.1, `8 s of 不死, then the next lethal hit (16 s), got ${w.deathAt}`);
  const bare = run([]);
  assert.equal(bare.lockAt, null);
  assert.ok(Math.abs(bare.deathAt - 8) < 0.1, `without the hammer she falls at 8 s, got ${bare.deathAt}`);
});
