// GitHub #82 (second part): the hand rules of PRTS 卫戍协议/帮助 §手牌区 — "手牌区域分为10个常规手牌区和5个临时手牌区。当
// 常规手牌区全满无空位时，玩家将无法执行使手牌溢出的操作" ("例如招募/购入等通常情况下会增加手牌的操作") and "溢出单位会自动
// 进入临时手牌区，常规手牌区出现空位时自动移入".
//   * a full regular hand refuses every purchase and reward pick — also one whose copy would complete a merge at once
//     (the reporter's first-hand check in the official game; BWIKI 盟约 "无法进行涉及到整备区的操作（购买、撤回等）")
//   * a free regular slot pulls a temp piece in at once (PlayerState._fillHandFromTemp, run by every recompute): after a
//     sale, a deployment from the hand, a merge that consumed hand copies, an item destroyed / equipped from the hand, a
//     summon stack removed with its owner. The temp row empties right → left (the order it fills) [ASSUMED]; each piece
//     takes the hand's next free slot right → left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier, legalTileFor } from './harness.js';

/** Plain equipment (no equip / merge side effects), all different: hand fillers that never merge with each other. */
const PLAIN = Object.values(DATA.items)
  .filter((i) => i.itemType === 'EQUIP' && !i.isGolden && i.kind === 'passive')
  .map((i) => i.itemId ?? i.id).filter(Boolean);

/** Solo 标准 (untimed) PREP R1 with an empty board and hand, 100 funds, a known stage. */
function prep(seed) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

/** Fill every free hand slot with plain equipment (skipping `skip` ids). */
function fillHand(ps, skip = []) {
  const ids = PLAIN.filter((id) => !skip.includes(id));
  let k = 0;
  while (ps.hand.some((x) => x == null)) giveItem(ps.m, ps, ids[k++]);
}

const mergeable = (m) => chessOfTier(1, (c) => c.position === 'MELEE').find((id) => m.pool.has(id) && m.gd.mergeCount(id) === 3);

test('a full hand refuses a purchase / pick that would complete a merge (chess, item, reward); nothing is spent', () => {
  const { m, ps } = prep(8201);
  const id = mergeable(m);
  give(m, ps, id, 'hand', 0);
  give(m, ps, id, 'hand', 1);
  const twin = PLAIN[0];
  giveItem(m, ps, twin, 'hand', 2);
  fillHand(ps, [twin]);
  assert.ok(ps.completesChessMerge(id) && ps.completesItemMerge(twin));
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
  const itemSlot = ps.shop.slots.findIndex((s, i) => i > 0 && s && s.kind === 'item');
  ps.shop.slots[itemSlot] = { kind: 'item', id: twin, basePrice: 2, frozen: false, sold: false };
  const left = m.pool.left(id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { error: ERR.HAND_FULL }, 'the third copy of a held pair');
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: itemSlot }), { error: ERR.HAND_FULL }, 'an item whose twin is in the hand');
  ps.pushRewardOffer('merge', { ids: [id] });
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { error: ERR.HAND_FULL }, 'a merge-completing reward pick');
  assert.equal(ps.funds, 100, 'nothing spent');
  assert.equal(m.pool.left(id), left, 'no copy taken');
  assert.ok(!ps.shop.slots[0].sold && !ps.shop.slots[itemSlot].sold);
  assert.equal(ps.countCopies(m.gd.baseIdOf(id)), 2, 'no merge');
  // a free slot (an item destroyed) lets the purchase through: it completes the merge, the elite goes to the hand
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: ps.hand[9].uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.id === m.gd.goldenIdOf(id)), 'the elite in the hand');
  assert.equal(ps.hand.filter(Boolean).length, 8, '10 − the destroyed item − 2 copies + the elite');
  checkInvariants(m);
  m.dispose();
});

test('selling / destroying from a full hand pulls the temp pieces in, rightmost first, into the freed slot; Ready follows', () => {
  const { m, ps } = prep(8202);
  const sold = give(m, ps, chessOfTier(2).find((x) => m.pool.has(x)), 'hand', 4);
  fillHand(ps);
  const ids = chessOfTier(3).filter((x) => m.pool.has(x));
  const first = give(m, ps, ids[0], 'temp', 4); // the first overflow takes the rightmost temp slot (stow → freeSlot)
  const second = give(m, ps, ids[1], 'temp', 3);
  assert.ok(ps.temp.includes(first) && ps.temp.includes(second), 'a full hand: both wait in temp');
  assert.equal(ps.privateView().canReady, false);
  checkInvariants(m);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: sold.uid }), { ok: true });
  assert.equal(ps.hand[4], first, 'the rightmost temp piece moves into the freed slot');
  assert.ok(ps.temp.includes(second) && !ps.temp.includes(first));
  assert.equal(ps._tempDue.has(first.uid), false, 'no longer due at the prep deadline');
  assert.equal(ps.privateView().canReady, false, 'one left in temp');
  checkInvariants(m);
  const item = ps.hand[7];
  assert.equal(item.kind, 'item');
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: item.uid }), { ok: true });
  assert.equal(ps.hand[7], second);
  assert.ok(ps.tempEmpty);
  assert.equal(ps.privateView().canReady, true);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  checkInvariants(m);
  m.dispose();
});

test('deploying a card from a full hand, or equipping an item from it, pulls a temp piece into the freed slot', () => {
  const { m, ps } = prep(8203);
  const id = chessOfTier(1, (c) => c.position === 'MELEE' && !m.gd.placeableTokens(c.chessId).length).find((x) => m.pool.has(x));
  const card = give(m, ps, id, 'hand', 9);
  fillHand(ps);
  const t1 = give(m, ps, chessOfTier(2).find((x) => m.pool.has(x)), 'temp', 4);
  const t2 = giveItem(m, ps, PLAIN[PLAIN.length - 1], 'temp', 3);
  const [r, c] = legalTileFor(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: card.uid, to: { area: 'board', row: r, col: c } }), { ok: true });
  assert.equal(ps.hand[9], t1, 'the deployed card\'s slot took the temp piece');
  checkInvariants(m);
  const it = ps.hand[0];
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: card.uid }), { ok: true });
  assert.equal(ps.hand[0], t2, 'the equipped item\'s slot took the temp piece');
  assert.ok(ps.tempEmpty);
  checkInvariants(m);
  m.dispose();
});

test('a gain that merges two hand copies: the elite takes one freed slot, the other pulls a temp piece in', () => {
  const { m, ps } = prep(8204);
  const id = mergeable(m);
  give(m, ps, id, 'hand', 0);
  give(m, ps, id, 'hand', 1);
  fillHand(ps);
  const ids = chessOfTier(3).filter((x) => m.pool.has(x));
  const t1 = give(m, ps, ids[0], 'temp', 4);
  const t2 = give(m, ps, ids[1], 'temp', 3);
  const elite = ps.acquireChess(id, { source: 'grant' });
  assert.ok(elite && m.gd.isGolden(elite.id));
  assert.equal(ps.hand[1], elite, 'the elite: the hand\'s next free slot (right → left)');
  assert.equal(ps.hand[0], t1, 'the other freed slot: the rightmost temp piece');
  assert.deepEqual(ps.temp.filter(Boolean), [t2], 'the hand is full again: the other waits');
  checkInvariants(m);
  m.dispose();
});

test('selling a deployed summoner removes its summon stack from the hand: that slot pulls a temp piece in', () => {
  const { m, ps } = prep(8205);
  const owner = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && m.pool.has(c.chessId) && m.gd.placeableTokens(c.chessId).length && legalTileFor(m, ps, c.chessId));
  assert.ok(owner, 'a chess with a manually deployable summon');
  const op = give(m, ps, owner.chessId, 'board', legalTileFor(m, ps, owner.chessId));
  const stackAt = ps.hand.findIndex((p) => p && p.kind === 'token' && p.ownerUid === op.uid);
  assert.ok(stackAt >= 0, 'its summon stack joined the hand');
  fillHand(ps);
  const t = give(m, ps, chessOfTier(2).find((x) => m.pool.has(x)), 'temp', 4);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: op.uid }), { ok: true });
  assert.equal(ps.hand[stackAt], t, 'the stack\'s slot took the temp piece');
  assert.ok(ps.tempEmpty);
  checkInvariants(m);
  m.dispose();
});
