// Player report F2 after 0.1.0 (2026-10-03): with 休露丝 【雪域礼赠】 ("每回合购买的首名<谢拉格>干员消耗资金为1",
// band_sciurus first_buy_in_round_char_price_change {price 1, bond kjeragShip}) a <谢拉格> taken for free — the promotion
// reward's 3-choose-1 after a merge, an item's pick-one offer or grant — was said to use up the round's discount. Checked
// through real intents (g.buy / g.reward / g.equip on a real Match with the real registry): only a shop purchase (g.buy →
// onBuy) counts; every free acquisition leaves the discount for the next <谢拉格> bought. Same rule for 玛恩纳 【业务指标】
// ("每购买一名<卡西米尔>干员，下回合开始时资金+1"). Pinned here (the report did not reproduce on 0.1.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, DATA } from './harness.js';

const OK = { ok: true };
const KJ = (id) => !!(DATA.chess[id] && DATA.chess[id].bonds.includes('kjeragShip'));
const slot = (id) => ({ kind: 'chess', id, basePrice: DATA.chess[id].tier === 1 ? 2 : DATA.chess[id].tier <= 4 ? 3 : 4, frozen: false, sold: false });
const NOT_KJ_T1 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && !c.bonds.includes('kjeragShip') && !c.bonds.includes('kazimierzShip')).chessId;

/** Solo match at R1 prep with an empty board, 50 funds, shop level 3 and `band`; the shop = `shop` chess ids. */
function setup(band, shop) {
  const h = makeMatch({ mode: 'solo', humans: 1, seed: 3 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.offers.length = 0;
  ps.funds = 50; ps.counters = {}; ps.pendingFunds = 0; ps.shop.level = 3; ps.bandId = band;
  ps.shop.slots = shop.map(slot);
  ps.recompute();
  const viewPrice = (i) => { m.flush(true); return h.lastTo('p_0', 'm.private').shop.slots[i].price; };
  return { h, m, ps, viewPrice };
}

/** After a free acquisition: the shop's <谢拉格> at `i` still costs 1 (server and m.private), a purchase pays 1, the next costs full. */
function discountIntact({ m, ps, viewPrice }, i, j, what) {
  assert.equal(ps.priceOf(ps.shop.slots[i]), 1, `${what}: the shop <谢拉格> still costs 1`);
  assert.equal(viewPrice(i), 1, `${what}: m.private shows 1`);
  const f0 = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: i }), OK);
  assert.equal(f0 - ps.funds, 1, `${what}: the first <谢拉格> bought pays 1`);
  assert.equal(ps.priceOf(ps.shop.slots[j]), ps.shop.slots[j].basePrice, `${what}: the second <谢拉格> of the round costs full`);
}

test('F2 休露丝: a <谢拉格> taken from the promotion reward after a merge keeps the round\'s discount', () => {
  const s = setup('band_sciurus', ['chess_char_3_11_a', 'chess_char_3_14_a', NOT_KJ_T1]);
  give(s.m, s.ps, NOT_KJ_T1); give(s.m, s.ps, NOT_KJ_T1);
  assert.deepEqual(s.m.handle('p_0', { t: 'g.buy', slot: 2 }), OK, 'the third copy merges');
  const offer = s.ps.offers[0];
  assert.ok(offer && offer.source === 'merge', 'promotion reward');
  if (!offer.slots.some((x) => KJ(x.id))) offer.slots[0].id = 'chess_char_3_20_a';
  const idx = offer.slots.findIndex((x) => KJ(x.id));
  assert.deepEqual(s.m.handle('p_0', { t: 'g.reward', idx }), OK);
  assert.ok(s.ps.hand.some((p) => p && p.kind === 'chess' && KJ(p.id)), 'the <谢拉格> joined the hand');
  discountIntact(s, 0, 1, 'promotion reward');
});

test('F2 休露丝: 寻呼模块\'s pick-one and the free grants of items (拟态物质, 紧急调度券, 简易通讯机) keep the discount', () => {
  // 寻呼模块 on 银灰 (only <谢拉格>): three <谢拉格> ≤ shop level offered, one taken for free
  {
    const s = setup('band_sciurus', ['chess_char_3_11_a', 'chess_char_3_14_a']);
    const t = give(s.m, s.ps, 'chess_char_4_22_a');
    const it = giveItem(s.m, s.ps, 'chess_item_4_01_e_a');
    assert.deepEqual(s.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: t.uid }), OK);
    const offer = s.ps.offers[0];
    assert.ok(offer && offer.slots.length && offer.slots.every((x) => KJ(x.id)), `寻呼模块 offers <谢拉格> (${offer && offer.slots.map((x) => x.id)})`);
    assert.deepEqual(s.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
    discountIntact(s, 0, 1, '寻呼模块');
  }
  // 拟态物质 on one of two 角峰: the third 角峰 (a merge) and its promotion reward
  {
    const s = setup('band_sciurus', ['chess_char_3_11_a', 'chess_char_3_14_a']);
    give(s.m, s.ps, 'chess_char_1_02_a');
    const t = give(s.m, s.ps, 'chess_char_1_02_a');
    const it = giveItem(s.m, s.ps, 'chess_item_5_05_e_a');
    assert.deepEqual(s.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: t.uid }), OK);
    assert.ok([...s.ps.hand, ...s.ps.board.values()].some((p) => p && p.id === 'chess_char_1_02_b'), 'elite 角峰');
    const offer = s.ps.offers[0];
    if (!offer.slots.some((x) => KJ(x.id))) offer.slots[0].id = 'chess_char_3_20_a';
    assert.deepEqual(s.m.handle('p_0', { t: 'g.reward', idx: offer.slots.findIndex((x) => KJ(x.id)) }), OK);
    discountIntact(s, 0, 1, '拟态物质');
  }
  // 紧急调度券: a shop operator taken for free (here one of three <谢拉格>)
  {
    const s = setup('band_sciurus', ['chess_char_3_11_a', 'chess_char_3_14_a', 'chess_char_3_20_a']);
    const t = give(s.m, s.ps, NOT_KJ_T1);
    const it = giveItem(s.m, s.ps, 'chess_item_2_02_e_a');
    assert.deepEqual(s.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: t.uid }), OK);
    const left = s.ps.shop.slots.map((x, i) => (x && !x.sold ? i : -1)).filter((i) => i >= 0);
    assert.equal(left.length, 2, 'one shop operator taken');
    discountIntact(s, left[0], left[1], '紧急调度券');
  }
  // 简易通讯机 on 银灰: a random <谢拉格> granted
  {
    const s = setup('band_sciurus', ['chess_char_3_11_a', 'chess_char_3_14_a']);
    const t = give(s.m, s.ps, 'chess_char_4_22_a');
    const it = giveItem(s.m, s.ps, 'chess_item_2_06_e_a');
    assert.deepEqual(s.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: t.uid }), OK);
    assert.equal(s.ps.hand.filter((p) => p && p.kind === 'chess' && KJ(p.id)).length, 2, 'a <谢拉格> granted');
    discountIntact(s, 0, 1, '简易通讯机');
  }
});

test('F2 玛恩纳 业务指标: only a shop purchase of a <卡西米尔> pays the next round\'s +1 (a free reward pick does not)', () => {
  const kz = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 3 && c.bonds.includes('kazimierzShip')).map((c) => c.chessId);
  const s = setup('band_mlynar', [kz[0], kz[1], NOT_KJ_T1]);
  s.ps.pushRewardOffer('merge', { ids: [kz[2] ?? kz[0]] });
  assert.deepEqual(s.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
  assert.equal(s.ps.pendingFunds, 0, 'a free <卡西米尔> pays nothing');
  assert.deepEqual(s.m.handle('p_0', { t: 'g.buy', slot: 0 }), OK);
  assert.equal(s.ps.pendingFunds, 1, 'a bought <卡西米尔>: +1 next round');
});
