// test/match/combat-speed.test.js — 超限二倍速随切随变 + 倒计时（业主 2026-10-26）
//
// 只测 _reclockForSpeed 的算术：倒计时 = 剩余游戏秒 / 当前倍速，切换时用已推进的游戏秒结算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchCombat } from '../../server/match/match/combat.js';

function ctx(over = {}) {
  const sched = { now: () => 0, instant: false };
  return {
    sched, _combatLimit: 120, _combatStartAt: 0, deadline: 120000, overtimeAt: 0,
    _overtimeGapGt: 0, markPublic() {},
    ...over,
  };
}

test('1× → 2×：已推进 10 游戏秒，剩余 110 秒按 2× 折半', () => {
  const c = ctx();
  c.sched.now = () => 10000;          // 真实过了 10 秒
  MatchCombat.prototype._reclockForSpeed.call(c, 1, 2);
  assert.equal(c._combatLimit, 110);
  assert.equal(c.deadline, 10000 + 55000);
});

test('2× → 1×：已推进 10 游戏秒，剩余 110 秒按 1× 走', () => {
  const c = ctx();
  c.sched.now = () => 5000;           // 真实 5 秒 × 2 = 10 游戏秒
  MatchCombat.prototype._reclockForSpeed.call(c, 2, 1);
  assert.equal(c._combatLimit, 110);
  assert.equal(c.deadline, 5000 + 110000);
});

test('剩余为 0 时 deadline = 现在（立即结算）', () => {
  const c = ctx();
  c.sched.now = () => 200000;         // 已超过 120 游戏秒
  MatchCombat.prototype._reclockForSpeed.call(c, 1, 2);
  assert.equal(c._combatLimit, 0);
  assert.equal(c.deadline, 200000);
});

test('Boss 轮：overtimeAt 按剩余游戏秒 + 额外宽限重算', () => {
  const c = ctx({ _combatLimit: 120, _combatStartAt: 0, deadline: 120000, overtimeAt: 150000, _overtimeGapGt: 30 });
  c.sched.now = () => 10000;
  MatchCombat.prototype._reclockForSpeed.call(c, 1, 2);
  assert.equal(c._combatLimit, 110);
  assert.equal(c.overtimeAt, 10000 + Math.round(((110 + 30) / 2) * 1000));
});

test('instant 场（无时钟）不重算', () => {
  const c = ctx();
  c.sched.instant = true;
  c.sched.now = () => 10000;
  MatchCombat.prototype._reclockForSpeed.call(c, 1, 2);
  assert.equal(c.deadline, 120000);
  assert.equal(c._combatLimit, 120);
});
