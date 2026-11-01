// test/match/coop-infinite.test.js — 超限 · 同盟（业主 2026-10-26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInfiniteMode, isSoloRoomMode, partyBossHpMul, partyWaveCountMul } from '../../shared/infiniteMode.js';
import { overlimitArchive } from '../../server/match/results.js';

test('coop_infinite 是超限，但不是独占单人', () => {
  assert.equal(isInfiniteMode('coop_infinite'), true);
  assert.equal(isInfiniteMode('solo_infinite'), true);
  assert.equal(isInfiniteMode('coop'), false);
  assert.equal(isSoloRoomMode('coop_infinite'), false, '同盟超限必须能加入 / 加 AI');
  assert.equal(isSoloRoomMode('solo_infinite'), true);
});

test('人数倍率：Boss 血池 2 人 1.6×、3 人 2.2×、4 人 2.8×', () => {
  assert.equal(partyBossHpMul(1), 1);
  assert.equal(partyBossHpMul(2), 1.6);
  assert.equal(partyBossHpMul(3), 2.2);
  assert.equal(partyBossHpMul(4), 2.8);
  assert.equal(partyBossHpMul(0), 1, '空场按 1');
});

test('人数倍率：普通波次 2 人 1.15×、3 人 1.3×、4 人 1.45×', () => {
  assert.equal(partyWaveCountMul(1), 1);
  assert.equal(partyWaveCountMul(2), 1.15);
  assert.equal(partyWaveCountMul(4), 1.45);
});

test('超限档案带 partySize', () => {
  const gd = { bond: () => null };
  const a = overlimitArchive({ round: 20, order: ['a', 'b', 'c'], infiniteBossKills: [], maxLayersSeen: {} }, gd);
  assert.equal(a.partySize, 3);
  const b = overlimitArchive({ round: 20, players: new Map([['a', {}], ['b', {}]]) }, gd);
  assert.equal(b.partySize, 2, '没有 order 时退回 players.size');
});
