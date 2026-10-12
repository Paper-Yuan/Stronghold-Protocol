// The Final Assault / Hidden Core leader pool = bloodPoint[difficulty] × the players alive when the fight starts (solo
// × 1) — the owner's decision of 2026-10-06, adopting PR #209 by @qingjingshenghuo (these tests are ported from it);
// it replaces the fixed pool of 「保持固定血量」 (DESIGN §20.9 / §20.10), which config bossHpScale still restores
// (DESIGN §25.13.4, server/match/gamedata.js bossPoolShareOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp, SharedBossPool } from '../../server/match/finalAssault.js';
import { makeBattle } from '../helpers/battleHarness.js';

const DIFFS = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];

test('every leader and difficulty: bloodPoint × the players alive (co-op), × 1 solo', () => {
  for (const difficulty of DIFFS) {
    const gd = new GameData(DATA, `mode_multi_${difficulty.toLowerCase()}`);
    const solo = new GameData(DATA, `mode_single_${difficulty.toLowerCase()}`);
    for (const id of Object.keys(DATA.bosses)) {
      const base = DATA.bosses[id].bloodPoint[difficulty];
      for (const n of [1, 2, 3, 4]) assert.equal(bossPoolHp(gd, id, n), base * n, `${id} ${difficulty} ×${n}`);
      assert.equal(bossPoolHp(solo, id, 1), base, `${id} ${difficulty} solo`);
    }
  }
});

for (const hidden of [false, true]) {
  test(`R${hidden ? 15 : 14}: the round's pool leaves out two departed players`, () => {
    const h = makeMatch({ humans: 4, difficulty: 'HARD', fake: true, instant: false }).start();
    h.toPrep(1);
    const m = h.m;
    m.onLeave('p_2');
    m.onLeave('p_3');
    assert.equal(m.alivePlayers().length, 2);
    assert.equal(h.ps('p_2').alive, false);
    m.round = hidden ? 15 : 14;
    m.teamLp = 50;
    m.bossId = 'boss_1';
    m.hiddenBossId = 'boss_9';
    m._planBossWaves();
    m.startFinalAssault(hidden);
    const id = hidden ? m.hiddenBossId : m.bossId;
    assert.equal(m.bossPool.maxHp, DATA.bosses[id].bloodPoint.HARD * 2);
    m.dispose();
  });
}

test('disconnected players (AI 托管) and bots count; an eliminated player does not', () => {
  const h = makeMatch({ humans: 3, bots: 1, fake: true, instant: false }).start();
  h.toPrep(1);
  h.m.onDisconnect('p_1');
  h.ps('p_2').eliminate(1);
  h.m.round = 14;
  h.m._planBossWaves();
  h.m.startFinalAssault(false);
  assert.equal(h.m.alivePlayers().length, 3);
  assert.equal(h.m.bossPool.maxHp, h.m.gd.boss(h.m.bossId).bloodPoint.NORMAL * 3);
  h.m.dispose();
});

test('config restores the fixed pool of 0.1.x (perPlayer false, solo 0.25) — GameData and the plain-object fallback agree', () => {
  const data = structuredClone(DATA);
  data.config.bossHpScale = { ...data.config.bossHpScale, perPlayer: false, solo: 0.25 };
  for (const modeId of ['mode_single_abyss', 'mode_multi_abyss']) {
    const gd = new GameData(data, modeId);
    const base = data.bosses.boss_8.bloodPoint.ABYSS;
    const expected = gd.isSolo ? base * 0.25 : base;
    for (const n of [1, 2, 3, 4]) {
      assert.equal(gd.bossPoolHp('boss_8', n), expected, `${modeId} ×${n}`);
      assert.equal(bossPoolHp(gd, 'boss_8', n), expected);
      // a caller's game-data object without bossPoolShare reads the same config through bossPoolShareOf
      const plain = { boss: (id) => gd.boss(id), difficulty: gd.difficulty, mode: gd.mode, config: gd.config, isSolo: gd.isSolo };
      assert.equal(bossPoolHp(plain, 'boss_8', n), expected);
    }
  }
  // and the per-player rule through the same fallback
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const plain = { boss: (id) => gd.boss(id), difficulty: gd.difficulty, mode: gd.mode, config: gd.config, isSolo: false };
  assert.equal(bossPoolHp(plain, 'boss_8', 3), DATA.bosses.boss_8.bloodPoint.ABYSS * 3);
});

test('only the leader\'s pool scales: escorts and the Hidden Core\'s parts keep their stats', () => {
  for (const kind of ['boss', 'hidden']) {
    const bossKey = kind === 'boss' ? 'enemy_9013_acstmk' : 'enemy_9013_acstmk_2';
    const snapshot = (n) => {
      const h = makeBattle({
        kind, content: 'none', sharedBoss: new SharedBossPool(7200000 * n), autoFinish: false,
        enemies: [{ key: bossKey, tag: 'boss', pos: [3, 10] }, { key: 'enemy_1427_lrnazg', pos: [2, 10] }, { key: 'enemy_9014_acstma', pos: [4, 10] }],
      });
      h.step();
      return [bossKey, 'enemy_1427_lrnazg', 'enemy_9014_acstma'].map((key) => {
        const e = h.enemy(key);
        assert.ok(e, `spawned ${key}`);
        return { hp: e.s.maxHp, atk: e.s.atk, def: e.s.def };
      });
    };
    const one = snapshot(1), four = snapshot(4);
    assert.equal(four[0].hp, one[0].hp * 4, `${kind}: the leader shows the pool`);
    assert.equal(four[0].atk, one[0].atk);
    assert.equal(four[0].def, one[0].def);
    assert.deepEqual(four.slice(1), one.slice(1), `${kind}: escort and part unchanged`);
  }
});
