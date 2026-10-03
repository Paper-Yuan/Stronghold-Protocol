// Prep-effect dispatcher, step 5 (equipped items; server/match/effectsMeta.js): it walks a snapshot of the owned chess
// and of each holder's items, and an item's hook runs only while that item is still equipped on that holder and the
// holder is still owned. Handlers move and destroy pieces mid-walk — 突变细胞 (onBattleResult) transforms its holder and
// sends the equipment back to the hand, normal 博士投影 (onRoundStart) destroys itself and promotes its holder — so the
// live array either skipped the next item on that holder (a splice shifts it under the loop) or ran it with a holder
// that was no longer owned. No shipped item has a second onBattleResult / onRoundStart hook, so a synthetic spy handler
// on an ordinary item (registered in a private registry) stands in for one. DESIGN §21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const QUIET = { warn() {}, error() {}, info() {} };
const A = (k) => `chess_item_${k}_e_a`;
const CELL = A('5_08');
const PROJECTION = A('5_06'); // 博士投影 (normal): promotes its holder at the next round start, then is gone
const SPY = A('1_01');        // any item: carries the synthetic spy handler
const OK = { ok: true };

/** Solo match in PREP R1, everything cleared, with a private registry holding `spy` on SPY. */
function setup(spy, seed = 3) {
  const registry = createRegistry({ log: QUIET });
  registry.item(SPY, spy);
  const h = makeMatch({ mode: 'solo', humans: 1, seed, registry, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  for (const ps of m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0; ps.bandId = null;
    ps.recompute();
  }
  const ps = h.ps('p_0');
  const equip = (item, target) => m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
  return { m, ps, equip };
}
/** Visible normal chess whose 特质 are all IN_BATTLE (no prep-side side effects), sorted. */
const plain = (pred) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE') && pred(c))
  .map((c) => c.chessId).sort();

/** What the spy saw: its holder still owned, and itself still equipped on it. */
function spyCall(ctx) {
  const { piece, holder } = ctx.source;
  return { holderOwned: !!ctx.piece(holder.uid), equipped: (holder.items || []).includes(piece) };
}

test('dispatcher: an item after the 突变细胞 on the same holder is not run with the transformed (gone) holder', () => {
  for (const order of ['cell first', 'spy first']) {
    const calls = [];
    const { m, ps, equip } = setup({ onBattleResult(ctx) { calls.push(spyCall(ctx)); } });
    const cid = plain((c) => c.tier === 2)[0];
    const holder = give(m, ps, cid, 'hand');
    const cell = giveItem(m, ps, CELL);
    const spy = giveItem(m, ps, SPY);
    for (const it of order === 'cell first' ? [cell, spy] : [spy, cell]) assert.deepEqual(equip(it, holder), OK);
    m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
    const chess = ps.hand.filter((p) => p && p.kind === 'chess');
    assert.equal(chess.length, 1, `${order}: the holder was transformed`);
    assert.equal(DATA.chess[chess[0].id].tier, 3);
    assert.ok(ps.hand.some((p) => p && p.uid === spy.uid), `${order}: the spy item is back in the hand`);
    if (order === 'cell first') {
      assert.deepEqual(calls, [], 'its holder was gone when its turn came: not run (it was run with a stale holder)');
    } else {
      assert.deepEqual(calls, [{ holderOwned: true, equipped: true }], 'run once, before the cell, on its owned holder');
    }
  }
});

test('dispatcher: 博士投影 destroying itself at the round start does not skip the next item on its holder', () => {
  for (const order of ['projection first', 'spy first']) {
    const calls = [];
    const { m, ps, equip } = setup({ onRoundStart(ctx) { calls.push({ ...spyCall(ctx), golden: DATA.chess[ctx.source.holder.id].isGolden }); } });
    const cid = plain((c) => c.tier === 2)[0];
    const holder = give(m, ps, cid, 'board', [10, 5]);
    const proj = giveItem(m, ps, PROJECTION);
    const spy = giveItem(m, ps, SPY);
    for (const it of order === 'projection first' ? [proj, spy] : [spy, proj]) assert.deepEqual(equip(it, holder), OK);
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    assert.ok(DATA.chess[holder.id].isGolden, `${order}: 博士投影 promoted its holder`);
    assert.ok(!ps.find(proj.uid), `${order}: 博士投影 is gone`);
    assert.deepEqual(holder.items.map((it) => it.uid), [spy.uid], `${order}: the spy item stays equipped`);
    // the projection's splice shifted the spy item under the live loop: it was skipped
    assert.deepEqual(calls, [{ holderOwned: true, equipped: true, golden: order === 'projection first' }], `${order}: run exactly once`);
  }
});

test('dispatcher: an item whose holder an earlier item\'s handler destroyed is not run', () => {
  const calls = [];
  const registry = createRegistry({ log: QUIET });
  const KILLER = A('1_02');
  let victimUid = null;
  registry.item(KILLER, { onRoundStart(ctx) { if (victimUid != null) ctx.destroyPiece(victimUid); } });
  registry.item(SPY, { onRoundStart(ctx) { calls.push(spyCall(ctx)); } });
  const h = makeMatch({ mode: 'solo', humans: 1, seed: 5, registry, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0; ps.bandId = null; ps.recompute();
  const [c1, c2] = plain((c) => c.tier === 1);
  // board reading order: the killer's holder comes first
  const first = give(m, ps, c1, 'board', [9, 4]);
  const victim = give(m, ps, c2, 'hand');
  victimUid = victim.uid;
  for (const [it, holder] of [[giveItem(m, ps, KILLER), first], [giveItem(m, ps, SPY), victim]]) {
    assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: holder.uid }), OK);
  }
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.ok(!ps.find(victim.uid), 'the victim chess is gone');
  assert.deepEqual(calls, [], 'the spy on the destroyed holder never ran');
});

// QA after the integration: the pairs were taken per holder as the walk reached it, not before step 5 began — an item
// equipped meanwhile onto a holder not yet walked ran in the same dispatch, and an item moved from a holder already
// walked to a later one ran twice. Every [holder, item] pair is now taken before the first item runs.
test('dispatcher: an item equipped during the walk waits for the next dispatch, whichever holder it goes to', () => {
  for (const where of ['a holder walked later (hand)', 'a holder walked earlier (board)']) {
    const calls = [];
    const registry = createRegistry({ log: QUIET });
    const GIVER = A('1_02');
    let target = null, given = null;
    registry.item(GIVER, { onRoundStart(ctx) { if (given) return; given = ctx.grantItem(SPY); ctx.equipDirect(given.uid, target.uid); } });
    registry.item(SPY, { onRoundStart(ctx) { calls.push(ctx.source.piece.uid); } });
    const h = makeMatch({ mode: 'solo', humans: 1, seed: 3, registry, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0; ps.bandId = null; ps.recompute();
    const [c1, c2] = plain((c) => c.tier === 1);
    let giverHolder;
    if (where.includes('later')) { giverHolder = give(m, ps, c1, 'board', [9, 4]); target = give(m, ps, c2, 'hand'); }
    else { target = give(m, ps, c2, 'board', [9, 4]); giverHolder = give(m, ps, c1, 'hand'); }
    assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: giveItem(m, ps, GIVER).uid, targetUid: giverHolder.uid }), OK);
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    assert.ok(given && target.items.some((it) => it.uid === given.uid), `${where}: the spy item was equipped during the walk`);
    assert.deepEqual(calls, [], `${where}: not run in the dispatch that equipped it`);
    m.dispatch(ps, 'onRoundStart', { round: 3 });
    assert.deepEqual(calls, [given.uid], `${where}: run once in the next dispatch`);
  }
});

test('dispatcher: an item moved during the walk from a holder already walked to a later one runs once', () => {
  const calls = [];
  const registry = createRegistry({ log: QUIET });
  const MOVER = A('1_02');
  let first = null, later = null, spy = null, done = false;
  registry.item(SPY, { onRoundStart(ctx) { calls.push(ctx.source.holder.uid); } });
  registry.item(MOVER, { onRoundStart(ctx) { if (done) return; done = true; ctx.destroyPiece(first.uid); ctx.equipDirect(spy.uid, later.uid); } });
  const h = makeMatch({ mode: 'solo', humans: 1, seed: 3, registry, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0; ps.bandId = null; ps.recompute();
  const [c1, c2, c3] = plain((c) => c.tier === 1);
  first = give(m, ps, c1, 'board', [12, 3]);           // walked first (deployment order)
  const moverHolder = give(m, ps, c2, 'board', [9, 3]);
  later = give(m, ps, c3, 'hand');                     // walked last
  spy = giveItem(m, ps, SPY);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: spy.uid, targetUid: first.uid }), OK);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: giveItem(m, ps, MOVER).uid, targetUid: moverHolder.uid }), OK);
  const firstUid = first.uid;
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.ok(done && !ps.find(firstUid) && later.items.includes(spy), 'the spy item was moved to the later holder mid-walk');
  assert.deepEqual(calls, [firstUid], 'run once, on the holder it stood on when its turn came (it ran twice)');
});
