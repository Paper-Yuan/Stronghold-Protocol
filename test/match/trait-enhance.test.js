// test/match/trait-enhance.test.js — 词条抉择 2.0：重抽 / 跳过 / 锁定（业主 2026-10-26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawTraitCards, TRAITS } from '../../server/match/traits.js';
import { MatchTraitDraft } from '../../server/match/match/traitDraft.js';
import { ERR } from '../../shared/constants.js';

const rng = { pick: (arr) => arr[0], shuffle: (arr) => arr.slice() };

function ctx(over = {}) {
  const trait = {
    round: 20, polarity: 'pos', idx: 0, order: ['p'], picks: {},
    cards: drawTraitCards(rng, 'pos'), rerollsLeft: 1, skips: 0, lockedIdx: null,
  };
  return {
    phase: 'TRAIT_DRAFT', trait, rngMeta: rng, traitSkips: 0, traitLock: null,
    traitMods: [], traitSpawn: [], round: 20, markPublic() {}, finishTraitDraft() { this.finished = true; },
    traitTurn() { return (this.trait && this.trait.order[this.trait.idx]) ?? null; },
    ...over,
  };
}
const ps = () => ({ alive: true, playerId: 'p', funds: 3, dirty() {} });

test('drawTraitCards: 锁定卡必带、放在第一张、同 traitId 不重复', () => {
  const first = drawTraitCards(rng, 'pos');
  const locked = first[1];
  const next = drawTraitCards(rng, 'pos', { locked });
  assert.equal(next.length, 3);
  assert.equal(next[0].traitId, locked.traitId);
  assert.equal(new Set(next.map((c) => c.traitId)).size, 3, '词条不重复');
});

test('rerollTrait: 消耗 1 次重抽，第二次返回 ALREADY，锁定的卡保留', () => {
  const c = ctx();
  c.trait.lockedIdx = 1;
  const lockedId = c.trait.cards[1].traitId;
  const r1 = MatchTraitDraft.prototype.rerollTrait.call(c, ps());
  assert.equal(r1.ok, true);
  assert.equal(c.trait.rerollsLeft, 0);
  assert.equal(c.trait.lockedIdx, 0);
  assert.equal(c.trait.cards[0].traitId, lockedId);
  const r2 = MatchTraitDraft.prototype.rerollTrait.call(c, ps());
  assert.equal(r2.error, ERR.ALREADY);
});

test('lockTrait: 切换锁定/取消，越界返回 BAD_TARGET', () => {
  const c = ctx();
  assert.equal(MatchTraitDraft.prototype.lockTrait.call(c, ps(), 2).ok, true);
  assert.equal(c.trait.lockedIdx, 2);
  assert.equal(MatchTraitDraft.prototype.lockTrait.call(c, ps(), 2).ok, true);
  assert.equal(c.trait.lockedIdx, null);
  assert.equal(MatchTraitDraft.prototype.lockTrait.call(c, ps(), 9).error, ERR.BAD_TARGET);
});

test('pickTrait: 不能选锁定的那张；选完把锁定卡带到下一次', () => {
  const c = ctx();
  c.trait.lockedIdx = 0;
  const lockedCard = c.trait.cards[0];
  assert.equal(MatchTraitDraft.prototype.pickTrait.call(c, ps(), 0).error, ERR.BAD_TARGET);
  const r = MatchTraitDraft.prototype.pickTrait.call(c, ps(), 1);
  assert.equal(r.ok, true);
  assert.equal(c.traitMods.length, 1);
  assert.equal(c.traitMods[0].id, c.trait.cards[1].traitId);
  assert.equal(c.traitLock, lockedCard, '锁定的卡带进下一次');
});

test('skipTrait: 不拿词条、给 1 资金、记一次跳过、结束本次', () => {
  const c = ctx();
  c.trait.lockedIdx = 2;
  const p = ps();
  const r = MatchTraitDraft.prototype.skipTrait.call(c, p);
  assert.equal(r.ok, true);
  assert.equal(p.funds, 4);
  assert.equal(c.traitSkips, 1);
  assert.equal(c.traitMods.length, 0);
  assert.equal(c.traitSpawn.length, 0);
  assert.equal(c.trait.picks.p, -1);
  assert.equal(c.finished, true);
  assert.ok(c.traitLock && c.traitLock.traitId === c.trait.cards[2].traitId);
});

test('跳过/锁定只在 TRAIT_DRAFT 生效', () => {
  const c = ctx({ phase: 'PREP' });
  assert.equal(MatchTraitDraft.prototype.skipTrait.call(c, ps()).error, ERR.WRONG_PHASE);
  assert.equal(MatchTraitDraft.prototype.lockTrait.call(c, ps(), 0).error, ERR.WRONG_PHASE);
  assert.equal(MatchTraitDraft.prototype.rerollTrait.call(c, ps()).error, ERR.WRONG_PHASE);
});

test('词条池仍为正 13 / 负 14', () => {
  assert.equal(TRAITS.pos.length, 13);
  assert.equal(TRAITS.neg.length, 14);
});
