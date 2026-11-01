// test/match/contract.test.js — 超限风险契约（业主 2026-10-26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchBoss, BOSS_CONTRACTS } from '../../server/match/match/bossRounds.js';
import { ERR } from '../../shared/constants.js';

function ctx(over = {}) {
  const wave = {
    timeLimit: 180,
    spawns: [
      { time: 3, enemyKey: 'enemy_9017_achunt_2', tag: 'boss', mods: { atkMul: 1.5 }, preview: { boss: true } },
      { time: 4.5, enemyKey: 'enemy_1007_slime', mods: { atkMul: 1.5 }, preview: { boss: false } },
    ],
  };
  return {
    isInfinite: true, phase: 'PREP', round: 40, contractOffer: null, contract: null,
    bossWaves: [{ wave }], traitBonusReroll: 0, markPublic() {},
    ...over,
  };
}
const offer = () => ({ round: 40, cards: BOSS_CONTRACTS.map((c) => ({ ...c })) });
const ps = () => ({ alive: true, playerId: 'p', funds: 3, dirty() {} });

test('契约池三个选项，带奖励文案', () => {
  assert.deepEqual(BOSS_CONTRACTS.map((c) => c.id), ['elite', 'time', 'aspd']);
  assert.ok(BOSS_CONTRACTS.every((c) => c.reward));
});

test('offerBossContract：非 Boss 轮不给；Boss 轮给一次三选一', () => {
  const c = ctx({ isInfiniteBossRound: () => true });
  // 直接调用原型方法，isInfiniteBossRound 是模块内函数：用真实 round 20 触发
  const r20 = ctx({ round: 20 });
  const o1 = MatchBoss.prototype.offerBossContract.call(r20);
  assert.equal(o1.cards.length, 3);
  const o2 = MatchBoss.prototype.offerBossContract.call(r20);
  assert.equal(o2, o1, '同一轮重复调用返回同一个 offer');
  const r16 = ctx({ round: 16 });
  assert.equal(MatchBoss.prototype.offerBossContract.call(r16), null, 'R16 不是 Boss 轮');
  void c;
});

test('chooseContract：普通模式 / 无 offer / 非 PREP 都拒绝', () => {
  assert.equal(MatchBoss.prototype.chooseContract.call(ctx({ isInfinite: false }), ps(), 'elite').error, ERR.WRONG_PHASE);
  assert.equal(MatchBoss.prototype.chooseContract.call(ctx(), ps(), 'elite').error, ERR.WRONG_PHASE);
  assert.equal(MatchBoss.prototype.chooseContract.call(ctx({ contractOffer: offer(), phase: 'COMBAT' }), ps(), 'elite').error, ERR.WRONG_PHASE);
});

test('elite：加 1 只精英、资金 +2、offer 清空', () => {
  const c = ctx({ contractOffer: offer(), round: 40 });
  const p = ps();
  const before = c.bossWaves[0].wave.spawns.length;
  assert.equal(MatchBoss.prototype.chooseContract.call(c, p, 'elite').ok, true);
  assert.equal(c.bossWaves[0].wave.spawns.length, before + 1);
  assert.equal(c.bossWaves[0].wave.spawns.at(-1).preview.elite, true);
  assert.equal(p.funds, 5);
  assert.deepEqual(c.contract, { id: 'elite', round: 40 });
  assert.equal(c.contractOffer, null);
});

test('time：时限压到 90 秒', () => {
  const c = ctx({ contractOffer: offer(), round: 40 });
  const p = ps();
  assert.equal(MatchBoss.prototype.chooseContract.call(c, p, 'time').ok, true);
  assert.equal(c.bossWaves[0].wave.timeLimit, 90);
  assert.equal(p.funds, 5);
});

test('aspd：Boss 攻击 ×1.2，重抽 +1', () => {
  const c = ctx({ contractOffer: offer(), round: 40 });
  const p = ps();
  assert.equal(MatchBoss.prototype.chooseContract.call(c, p, 'aspd').ok, true);
  assert.ok(Math.abs(c.bossWaves[0].wave.spawns[0].mods.atkMul - 1.8) < 1e-9);
  assert.equal(c.traitBonusReroll, 1);
  assert.equal(p.funds, 3, 'aspd 不给资金');
});

test('none：不签，offer 清空，波次不变', () => {
  const c = ctx({ contractOffer: offer(), round: 40 });
  const wave = c.bossWaves[0].wave;
  const before = JSON.stringify(wave.spawns);
  assert.equal(MatchBoss.prototype.chooseContract.call(c, ps(), 'none').ok, true);
  assert.equal(c.contract.id, 'none');
  assert.equal(JSON.stringify(wave.spawns), before);
});

test('未知 id 拒绝', () => {
  const c = ctx({ contractOffer: offer(), round: 40 });
  assert.equal(MatchBoss.prototype.chooseContract.call(c, ps(), 'nope').error, ERR.BAD_TARGET);
});
