// test/content/feedback5-duck-restealth.test.js — the owner's decision of 2026-10-07 (「鸭爵策略产生的泪眼汪汪我想了一下，要不
// 等待个1秒这样再重新隐匿」, after the community report of 2026-10-07 and GitHub #214): the 鸭爵 strategy's swapped-in
// 流泪小子 (spawn tag 'duck', content/bands/meta.js duckReplace) hides again 1 s after a block ends instead of the official
// 0 s (content/enemies/helpers.js DUCK_STEALTH_RESTORE) — a deliberate deviation, so the operators beside the one it
// stuns get a second to hit it. The same enemy anywhere else keeps the official 0 s.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { duckReplace } from '../../server/sim/content/bands/meta.js';
import { TICK } from '../../server/sim/constants.js';
import { enemyStealthed } from '../../server/sim/targeting.js';

const E = JSON.parse(readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const BANDS = JSON.parse(readFileSync(new URL('../../data/bands.json', import.meta.url), 'utf8'));
const DOG = 'enemy_2034_sythef_2';
const BIG = [];
for (let dr = -4; dr <= 4; dr++) for (let dc = -12; dc <= 12; dc++) BIG.push([dr, dc]);
const WALL = chessRec({ id: 'w1', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, blockCnt: 1 }, rangeGrid: [[0, 0]], skill: null });
const GUN = chessRec({ id: 'gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 400, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: BIG, skill: null });

function arena(o = {}) {
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { w1: WALL, gun: GUN } }, kits: { w1: () => ({ trait: { noAttack: true } }) }, ...o,
  });
}

test('the 鸭爵 swap\'s 流泪小子 hides again 1 s after its strike frees it (its stunned blocker lets go), and a ranged operator hits it in that second', () => {
  const h = arena({ units: [{ chessId: 'w1', row: 9, col: 6 }, { chessId: 'gun', row: 11, col: 3 }] });
  h.step();
  const e = h.spawn(DOG, { routeIndex: 0, tag: 'duck', bounty: { coins: 1, ownerPlayerId: 'p1' } });
  assert.equal(e.findBuff('ab:stealth').data.stealthRestore, 1);
  assert.ok(enemyStealthed(e), '隐匿 on its way');
  assert.ok(h.runUntil(() => e.stats.attacks >= 1, 60), 'it strikes its blocker');
  assert.equal(e.blockedBy, null, 'the stunned wall let it go');
  const ts = h.b.time, hp0 = e.hp;
  h.run(1 - 2 * TICK);
  assert.equal(enemyStealthed(e), false, 'still revealed 1 s after (officially 隐匿 at once)');
  assert.ok(e.hp < hp0, 'the sniper hit it in that second');
  h.run(4 * TICK);
  assert.equal(enemyStealthed(e), true, `隐匿 again ${(h.b.time - ts).toFixed(3)} s after the strike`);
  checkInvariants(h.b);
});

test('the same enemy outside the swap keeps the official 0 s: the act2 copy spawned without the tag, and the original 流泪小子 of the bounty card', () => {
  const h = arena({ units: [{ chessId: 'w1', row: 9, col: 6 }] });
  h.step();
  for (const key of [DOG, 'enemy_2034_sythef']) {
    const e = h.spawn(key, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
    assert.equal(e.findBuff('ab:stealth').data.stealthRestore, 0, key);
  }
  const e = h.spawn(DOG, { routeIndex: 0 });
  assert.ok(h.runUntil(() => e.stats.attacks >= 1, 60));
  assert.equal(enemyStealthed(e), true, 'untagged: 隐匿 the moment its strike frees it');
  // a 3 s 隐匿 stays 3 s even when tagged (the rule only lengthens a shorter restore)
  const lurker = h.spawn('enemy_1009_lurker', { pos: [10, 7], routeIndex: 0, tag: 'duck', mods: { speedMul: 0 } });
  assert.equal(lurker.findBuff('ab:stealth').data.stealthRestore, undefined);
});

test('the band\'s own swap (duckReplace) tags the copy, and the battle it builds gives that copy the 1 s', () => {
  const p = BANDS.band_ducklord.params;
  assert.ok(p.enemylist.split(',').includes(DOG));
  const spawns = [{ time: 2, enemyKey: 'enemy_1007_slime', routeIndex: 0, count: 4, interval: 3 }];
  const ctx = { gd: { enemy: (k) => E[k] }, rng: { int: () => 1, shuffle: (a) => a.slice(), pick: (a) => (a.includes(DOG) ? DOG : a[0]) } };
  const out = duckReplace(ctx, spawns, p, 'p1');
  assert.equal(out.length, 1);
  assert.equal(out[0].enemyKey, DOG);
  assert.equal(out[0].tag, 'duck');
  const h = arena({
    enemies: spawns.map((s) => ({ key: s.enemyKey, time: s.time, route: s.routeIndex, count: s.count ?? 1, interval: s.interval ?? 0, tag: s.tag ?? null, bounty: s.bounty ?? null })),
  });
  assert.ok(h.runUntil(() => h.b.enemies.some((x) => x.defId === DOG), 30), 'the copy spawns');
  const dog = h.b.enemies.find((x) => x.defId === DOG);
  assert.equal(dog.tag, 'duck');
  assert.equal(dog.findBuff('ab:stealth').data.stealthRestore, 1);
});
