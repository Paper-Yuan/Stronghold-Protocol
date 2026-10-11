// Stage selection per match (waves.js setupMatchWaves; user playtest: "三局都是同一张地图"). Official mode data
// (data/config.json modes[].stages, stage weight 50 each):
//   * 标准模拟 (FUNNY, solo & co-op) and 入门协议 use ONLY 战场#01 (act1autochess_m01) — official, kept: the lobby's default
//     difficulty is 标准, so back-to-back 标准 matches always play 战场#01;
//   * 险境模拟 (NORMAL) picks uniformly among 8 stages (战场#01–#08), 绝境 / 终极 (HARD / ABYSS) among 7 (no 战场#01),
//     with the match seed (Match: createRng(deriveSeed(seed, 'setup')), a fresh random seed per lobby match).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves } from '../../server/match/waves.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';
import { DATA, makeMatch } from './harness.js';

const M01 = 'act1autochess_m01';
const REST = ['act1autochess_m02', 'act1autochess_m03', 'act1autochess_m04', 'act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04'];
const pick = (modeId, seed) => setupMatchWaves(new GameData(DATA, modeId), createRng(deriveSeed(seed >>> 0, 'setup'))).stageId;

test('mode stage lists: 标准 / 入门 = 战场#01 only; 险境 = 8 stages; 绝境 / 终极 = 7 (no 战场#01); all weight 50', () => {
  const stagesOf = (m) => DATA.config.modes[m].stages.slice().sort();
  for (const t of ['single', 'multi']) {
    assert.deepEqual(stagesOf(`mode_${t}_funny`), [M01], `${t} 标准`);
    assert.deepEqual(stagesOf(`mode_${t}_normal`), [M01, ...REST].sort(), `${t} 险境`);
    assert.deepEqual(stagesOf(`mode_${t}_hard`), REST.slice().sort(), `${t} 绝境`);
    assert.deepEqual(stagesOf(`mode_${t}_abyss`), REST.slice().sort(), `${t} 终极`);
  }
  assert.deepEqual(stagesOf('mode_training_1'), [M01]);
  for (const id of [M01, ...REST]) assert.ok(DATA.stages[id].active && DATA.stages[id].weight === 50, id);
});

test('险境 / 绝境 / 终极: the match seed picks uniformly among the mode stages; 标准 always 战场#01', () => {
  const N = 1600;
  for (const t of ['single', 'multi']) {
    for (const d of ['normal', 'hard', 'abyss']) {
      const modeId = `mode_${t}_${d}`;
      const list = DATA.config.modes[modeId].stages;
      const count = new Map(list.map((s) => [s, 0]));
      for (let i = 0; i < N; i++) {
        const s = pick(modeId, Math.imul(i + 1, 2654435761));
        assert.ok(count.has(s), `${modeId}: ${s}`);
        count.set(s, count.get(s) + 1);
      }
      const exp = N / list.length;
      for (const [s, n] of count) assert.ok(n > exp * 0.75 && n < exp * 1.25, `${modeId} ${s}: ${n} of ${N} (uniform ≈ ${exp.toFixed(0)})`);
    }
    for (let i = 0; i < 50; i++) assert.equal(pick(`mode_${t}_funny`, i * 7919 + 1), M01, `${t} 标准`);
  }
});

test('different match seeds give different stages (no fixed map), the same seed the same stage', () => {
  // consecutive lobby seeds are independent uint32 draws: 3 matches in a row on one stage is ~1/64 in 险境
  let same3 = 0, runs = 0;
  for (let i = 0; i < 300; i += 3, runs++) {
    const a = pick('mode_multi_normal', i * 104729 + 17), b = pick('mode_multi_normal', (i + 1) * 104729 + 17), c = pick('mode_multi_normal', (i + 2) * 104729 + 17);
    if (a === b && b === c) same3++;
  }
  assert.ok(same3 <= 6, `${same3} of ${runs} triples on one stage`);
  const first10 = new Set(Array.from({ length: 10 }, (_, i) => pick('mode_single_hard', 1000 + i)));
  assert.ok(first10.size >= 4, `${first10.size} stages over 10 seeds`);
  assert.equal(pick('mode_multi_abyss', 424242), pick('mode_multi_abyss', 424242));
});

test('Match: the stage comes from the match seed (险境 co-op / 绝境 solo vary, 标准 fixed)', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, fake: true });
    assert.equal(h.m.stageId, pick('mode_multi_normal', seed), `seed ${seed}`);
    seen.add(h.m.stageId);
  }
  assert.ok(seen.size >= 4, `${seen.size} stages over 12 co-op 险境 matches`);
  const solo = new Set();
  for (let seed = 1; seed <= 12; seed++) solo.add(makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true }).m.stageId);
  assert.ok(solo.size >= 4 && !solo.has(M01), `solo 绝境: ${[...solo].join(' ')}`);
  for (let seed = 1; seed <= 6; seed++) assert.equal(makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed, fake: true }).m.stageId, M01);
});
