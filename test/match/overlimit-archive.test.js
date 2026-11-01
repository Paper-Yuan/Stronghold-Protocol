// test/match/overlimit-archive.test.js — 超限档案（业主 2026-10-26）
//
// 只测纯逻辑：Boss 击杀去重、最高盟约层数、traitMods 输出形状；普通模式不输出 overlimit 由 results.js 的
// `if (m.isInfinite)` 保证（这里用源码断言钉住，避免构造完整 Match 夹具）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlimitArchive } from '../../server/match/results.js';
import { MatchBoss } from '../../server/match/match/bossRounds.js';

const resultsSrc = readFileSync(new URL('../../server/match/results.js', import.meta.url), 'utf8');

const gd = {
  bond: (id) => ({ victoriaShip: { name: '维多利亚' }, yanShip: { name: '炎' } }[id] || null),
  boss: (id) => ({ boss_9: { name: '“巨大的丑东西”' }, boss_8: { name: '杰斯顿' } }[id] || null),
};

test('overlimitArchive: 最高回合、Boss 击杀、词条与最高盟约', () => {
  const m = {
    round: 45,
    infiniteBossKills: [
      { key: '45:1', round: 45, phase: 1, id: 'boss_9', name: '“巨大的丑东西”' },
      { key: '45:2', round: 45, phase: 2, id: 'boss_8', name: '杰斯顿' },
    ],
    maxLayersSeen: { victoriaShip: 750, yanShip: 1200, egirShip: 0 },
    traitMods: [
      { id: 'assault', name: '强攻', polarity: 'pos', round: 20, text: '攻击力 +25%' },
      { id: 'weak', name: '虚弱', polarity: 'neg', round: 25 },
    ],
  };
  const a = overlimitArchive(m, gd);
  assert.equal(a.maxRound, 45);
  assert.equal(a.bossKills.length, 2);
  assert.equal('key' in a.bossKills[0], false, '服务端的去重 key 不外泄');
  assert.deepEqual(a.bossKills.map((k) => k.phase), [1, 2]);
  assert.equal(a.maxLayers.length, 2, '0 层不列');
  assert.deepEqual(a.maxLayers.map((x) => x.id), ['yanShip', 'victoriaShip'], '按层数降序');
  assert.deepEqual(a.bestBond, { id: 'yanShip', name: '炎', layers: 1200 });
  assert.equal(a.traitMods.length, 2);
  assert.equal(a.traitMods[0].text, '攻击力 +25%');
  assert.equal('text' in a.traitMods[1], false, '没有正文就不带该字段');
});

test('overlimitArchive: 空档案也给出可用形状', () => {
  const a = overlimitArchive({ round: 20 }, gd);
  assert.equal(a.maxRound, 20);
  assert.deepEqual(a.bossKills, []);
  assert.deepEqual(a.traitMods, []);
  assert.deepEqual(a.maxLayers, []);
  assert.equal(a.bestBond, null);
});

test('Boss 击杀按「回合:阶段」去重，第二阶段取副 Boss', () => {
  const ctx = {
    isInfinite: true, round: 45, bossPhaseNo: 2, bossId: 'boss_8',
    bossWaves: [{ wave: { primaryBoss: 'boss_9' } }], gd, infiniteBossKills: [],
  };
  MatchBoss.prototype._trackInfiniteBossKill.call(ctx);
  MatchBoss.prototype._trackInfiniteBossKill.call(ctx);
  assert.equal(ctx.infiniteBossKills.length, 1);
  assert.equal(ctx.infiniteBossKills[0].phase, 2);
  assert.equal(ctx.infiniteBossKills[0].id, 'boss_9');
  assert.equal(ctx.infiniteBossKills[0].name, '“巨大的丑东西”');
});

test('盟约层数取峰值，不用当前值覆盖', () => {
  const players = new Map([
    ['p1', { layers: { yanShip: 300, victoriaShip: 100 } }],
    ['p2', { layers: { yanShip: 120, egirShip: 50 } }],
  ]);
  const ctx = { players, maxLayersSeen: {} };
  MatchBoss.prototype._trackInfiniteLayers.call(ctx);
  players.get('p1').layers = { yanShip: 50, victoriaShip: 200 };
  MatchBoss.prototype._trackInfiniteLayers.call(ctx);
  assert.deepEqual(ctx.maxLayersSeen, { yanShip: 300, victoriaShip: 200, egirShip: 50 });
});

test('普通模式不会输出 overlimit（源码守卫）', () => {
  assert.match(resultsSrc, /if \(m\.isInfinite\) out\.overlimit = overlimitArchive\(m, gd\);/);
});
