// Official enemy counts (research 08 §2 / §7-1): the client's RandomEnemyGenerater reproduced exactly — fixtures from
// the official PRTS screenshots and from the research script over every special entry × round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave, replacedCount, roundHalfEven, previewOf } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';

const OFFICIAL = JSON.parse(readFileSync(new URL('../fixtures/official-waves.json', import.meta.url), 'utf8')).entries;
const name = (k) => DATA.enemies[k].name;

/** The round's wave with a forced pick (entry key, round). */
function waveOf(gd, entryKey, round) {
  const e = DATA.factions.entries[entryKey];
  const picks = [];
  picks[round] = { round, type: e.type, key: e.key, normal: e.N[0].key, elite: e.E[0].key, fly: e.fly, firstHalf: e.firstHalf };
  return buildNormalWave(gd, createRng(1), { picks }, round);
}
const byName = (w) => {
  const m = {};
  for (const s of w.spawns) m[name(s.enemyKey)] = (m[name(s.enemyKey)] || 0) + s.count;
  return m;
};

test('roundHalfEven is C# Math.Round (banker\'s)', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 4.5, 4.49, 4.51, 4.33, 9.1].map(roundHalfEven), [0, 2, 2, 4, 4, 4, 5, 4, 9]);
});

test('R1 fixtures of the official screenshots (research 08 §2.6): one kind per round, no drones in a ground round', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  assert.deepEqual(byName(waveOf(gd, 'enemy_1325_cbgpro_2', 1)), { 源石虫: 2, 猎狗pro: 4 }, '战场02/07: 高级军用猎狗');
  assert.deepEqual(byName(waveOf(gd, 'enemy_1305_mhslim_2', 1)), { 源石虫: 2, 灼热源石虫: 5 }, '战场04: 炽焰源石虫 (9.1 → cap 5)');
  assert.deepEqual(byName(waveOf(gd, 'enemy_1010_demon_2', 1)), { 源石虫: 2, 萨卡兹刀兵: 3 }, '萨卡兹大剑组长 (2.84 → 3)');
  // a FLY round: the walking N action is dropped, the fly placeholders replaced
  const r3 = waveOf(gd, 'enemy_1355_mrfly', 3);
  assert.deepEqual(byName(r3), { 妖怪: 5, 妖怪MKII: 4 }, 'R3 FLY 护障');
  assert.ok(r3.spawns.every((s) => DATA.enemies[s.enemyKey].isFlyEnemy), 'no walkers in a FLY round');
  const r1fly = waveOf(gd, 'enemy_1355_mrfly', 1);
  assert.ok(r1fly.spawns.some((s) => s.enemyKey === 'enemy_1007_slime') && !r1fly.spawns.some((s) => s.enemyKey === 'enemy_1422_lrsldr'), '战场01: 源石虫 + drones, no ground N');
});

test('the .5 tie: an elite action of 2 × “灵幛” becomes 隐形弩手组长 ×4 (4.5 → 4, banker\'s rounding)', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  assert.equal(replacedCount(gd, 'enemy_1427_lrnazg', 2, 'enemy_1019_jshoot_2'), 4);
  assert.equal(replacedCount(gd, 'enemy_1427_lrnazg', 1, 'enemy_1019_jshoot_2'), 2);
  assert.equal(replacedCount(gd, 'enemy_1422_lrsldr', 10, 'enemy_1005_yokai'), 5, 'cap 5 per action');
  assert.equal(replacedCount(gd, 'enemy_1425_lrcmra', 1, 'enemy_1439_dslntf'), 1, 'floor 1');
});

test('every special entry × round matches the official per-action composition (429 fixtures: kind, count, gate)', () => {
  const gd = new GameData(DATA, 'mode_multi_abyss');
  let n = 0;
  for (const [short, rounds] of Object.entries(OFFICIAL)) {
    for (const [r, want] of Object.entries(rounds)) {
      const w = waveOf(gd, `enemy_${short}`, Number(r));
      const got = w.spawns.map((s) => `${s.actionIndex}:${s.enemyKey.replace('enemy_', '')}:${s.count}:${s.preview.gate === 'upper' ? 'U' : 'L'}`).join(' ');
      assert.equal(got, want, `${short} R${r}`);
      n++;
    }
  }
  assert.equal(n, 429);
});

test('同盟 险境 R3 never exceeds 10 enemies per board (official 6–10; ours used to reach 68)', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  for (const e of Object.values(DATA.factions.entries)) {
    if (!e.firstHalf || gd.inactiveEnemies.has(e.key)) continue;
    const total = waveOf(gd, e.key, 3).spawns.reduce((s, x) => s + x.count, 0);
    assert.ok(total >= 6 && total <= 10, `${e.key}: R3 ${total}`);
  }
});

test('distribution over matches ≈ the official one (research 08 §2.7, 4 000 simulated official matches)', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const official = [0, 4.7, 7.7, 7.7, 10.3, 20.0, 23.2, 26.2, 18.2, 20.3, 22.2, 23.6, 35.0, 37.5];
  const sums = new Array(14).fill(0);
  const N = 300;
  let flyRounds = 0;
  for (let seed = 1; seed <= N; seed++) {
    const setup = setupMatchWaves(gd, createRng(seed * 7919));
    for (let r = 1; r <= 13; r++) {
      const w = buildNormalWave(gd, createRng(seed), setup.factions, r);
      sums[r] += previewOf(w.spawns).reduce((s, e) => s + e.count, 0);
      if (w.pick.fly) flyRounds++;
    }
  }
  for (let r = 1; r <= 13; r++) {
    const avg = sums[r] / N;
    assert.ok(Math.abs(avg - official[r]) <= official[r] * 0.12, `R${r}: avg ${avg.toFixed(1)} vs official ${official[r]}`);
  }
  const share = flyRounds / (N * 13);
  assert.ok(share > 0.06 && share < 0.14, `FLY rounds ${share.toFixed(3)} ≈ 10 %`);
});
