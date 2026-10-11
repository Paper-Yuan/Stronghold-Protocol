// Effect registry & dispatcher (effectsMeta.js): keys, hook routing, garrison eventType mapping, 投资人 repeat,
// ctx helpers, error isolation, depth cap, content override of built-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaRegistry, createRegistry, HOOKS, GARRISON_HOOK, MAX_DEPTH } from '../../server/match/effectsMeta.js';
import { registerBuiltins, BUILTIN_EFFECT_KEYS } from '../../server/match/builtinMeta.js';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';

test('registry: key validation, function sugar, last registration wins, helpers', () => {
  const reg = new MetaRegistry();
  assert.throws(() => reg.register('nope', {}), TypeError);
  assert.throws(() => reg.register('band:', {}), TypeError);
  assert.throws(() => reg.register('band:x', 5), TypeError);
  reg.register('band:x', () => 1);
  assert.equal(typeof reg.get('band:x').run, 'function');
  const h2 = { onBuy() {} };
  reg.band('x', h2);
  assert.equal(reg.get('band:x'), h2);
  reg.item('chess_item_1_03_e_b', { onEquip() {} });
  assert.ok(reg.has('item:chess_item_1_03_e'), 'item keys drop the _a/_b suffix');
  reg.global('g', {});
  assert.equal(reg.globals().length, 1);
  assert.equal(reg.get('band:none'), null);
  assert.ok(HOOKS.includes('onBattleStart') && HOOKS.includes('onChoicePick'));
  assert.equal(GARRISON_HOOK.SERVER_PREP_FIN, 'onPrepEnd');
});

test('built-ins register consume-on-equip items by buff key; createRegistry = built-ins + content', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  for (const k of ['item:chess_item_1_03_e', 'item:chess_item_3_12_e', 'item:chess_item_1_04_e', 'item:chess_item_5_06_e', 'item:chess_item_6_08_e', 'item:chess_item_6_02_m']) assert.ok(reg.has(k), k);
  for (const k of BUILTIN_EFFECT_KEYS) assert.ok(reg.has(k), k);
  const full = createRegistry();
  assert.ok(full.has('item:chess_item_1_03_e'));
});

function metaMatch(reg, o = {}) {
  const h = makeMatch({ mode: 'solo', seed: o.seed ?? 70, registry: reg, fake: true, ...o }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.funds = 50;
  ps.recompute();
  return { h, m: h.m, ps };
}

test('dispatch order and hooks: global → band → bond → garrison → item → effect; onPrice/onSold/onBuy/onRefresh/onLevelUp', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  const calls = [];
  reg.global('spy', { onBuy: () => calls.push('global'), onRefresh: () => calls.push('refresh'), onLevelUp: (ctx, ev) => calls.push(`level${ev.level}`) });
  reg.band('band_bldsk', { onBuy: () => calls.push('band') });
  reg.bond('yanShip', { onBuy: () => calls.push('bond') });
  reg.effect('spy', { onBuy: (ctx) => calls.push(`effect:${ctx.source.ref.id}`) });
  // a price modifier (content e.g. 休露丝): chess slots cost 1
  reg.global('price', { onPrice: (ctx, ev) => { if (ev.kind === 'chess') { ctx.modifyPrice(+5); ctx.setPrice(1); } } });
  // selling pays 3 instead of 1
  reg.global('sell', { onSold: (ctx, ev) => { ev.gain = 3; } });
  const { m, ps } = metaMatch(reg);
  ps.effects.push({ id: 'e1', key: 'effect:spy', name: 'spy', battle: false });
  const slot = ps.shop.slots.findIndex((s) => s && s.kind === 'chess');
  assert.equal(ps.privateView().shop.slots[slot].price, 1, 'onPrice is reflected in the view');
  const funds = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot }), { ok: true });
  assert.equal(ps.funds, funds - 1);
  assert.deepEqual(calls, ['global', 'band', 'bond', 'effect:e1']);
  const piece = ps.hand.find(Boolean);
  const f2 = ps.funds;
  m.handle('p_0', { t: 'g.sell', uid: piece.uid });
  assert.equal(ps.funds, f2 + 3);
  m.handle('p_0', { t: 'g.refresh' });
  m.handle('p_0', { t: 'g.levelUp' });
  assert.ok(calls.includes('refresh') && calls.includes('level2'));
  m.dispose();
});

test('garrisons fire on their eventType only; hand pieces skip character_target_inboard; 投资人 doubles 获得时', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  const fired = [];
  const gains = [];
  const gainG = Object.values(DATA.garrisons).find((g) => g.eventType === 'SERVER_GAIN' && g.owners.some((o) => DATA.chess[o] && DATA.chess[o].visible));
  const finG = Object.values(DATA.garrisons).find((g) => g.eventType === 'SERVER_PREP_FIN' && g.bbStr && g.bbStr.conditionkey === 'character_target_inboard' && g.owners.some((o) => DATA.chess[o] && DATA.chess[o].visible && !DATA.chess[o].isGolden));
  reg.garrison(gainG.effectKey, { run: (ctx, ev) => gains.push([ctx.source.garrisonId, ev.piece.id]) });
  reg.garrison(finG.effectKey, { onPrepEnd: (ctx) => fired.push([ctx.source.garrisonId, ctx.source.where]) });
  const { h, m, ps } = metaMatch(reg, { seed: 71 });
  const owner = gainG.owners.find((o) => DATA.chess[o] && DATA.chess[o].visible && !DATA.chess[o].isGolden) || gainG.owners[0];
  ps.acquireChess(owner, { source: 'test' });
  const mine = gains.filter(([gid]) => DATA.chess[owner].garrisonIds.includes(gid));
  assert.ok(mine.length >= 1, 'SERVER_GAIN garrison ran on gain');
  gains.length = 0;
  // 投资人 active → ×2
  ps.bondCountBonus.investShip = 3;
  ps.recompute();
  assert.equal(ps.bonds.investShip.active, true);
  const base = DATA.chess[owner].baseId;
  if (ps.countCopies(base) < 2) {
    ps.acquireChess(owner, { source: 'test' });
    assert.equal(gains.filter(([gid]) => DATA.chess[owner].garrisonIds.includes(gid)).length, 2 * mine.length, '获得时 ×2');
  }
  ps.layers.investShip = 100;
  ps.recompute();
  assert.equal(m.dispatcher.investRepeat(ps), 3);
  // prep-end garrison: board yes, hand no (inboard condition)
  const finOwner = finG.owners.find((o) => DATA.chess[o] && DATA.chess[o].visible && !DATA.chess[o].isGolden);
  for (const p of ps.hand) if (p) ps.returnCopies(p);
  ps.hand.fill(null);
  const onHand = give(m, ps, finOwner);
  m.dispatch(ps, 'onPrepEnd', {});
  assert.equal(fired.length, 0, 'inboard garrison does not fire from the hand');
  const tile = [...ps.deployMap()].find(([, v]) => v === 'melee' || DATA.chess[finOwner].position === 'RANGED')[0].split(',').map(Number);
  ps.hand[ps.hand.indexOf(onHand)] = null;
  ps.board.set(`${tile[0]},${tile[1]}`, onHand);
  m.dispatch(ps, 'onPrepEnd', {});
  assert.deepEqual(fired.map((x) => x[1]), ['board']);
  void h;
  m.dispose();
});

test('ctx helpers: funds, layers (requireActive), grants (pool-aware), effects with counters, teammates, errors isolated', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  let captured = null;
  reg.global('ctx', { onRoundStart: (ctx) => { captured = ctx; } });
  reg.global('boom', { onRefresh: () => { throw new Error('content bug'); } });
  reg.global('loop', { onGain: (ctx) => { ctx.grantItem('chess_item_1_01_e_a'); } });
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 72, registry: reg, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  assert.ok(captured, 'onRoundStart ran');
  const ctx = m.dispatcher && (() => { let c = null; reg.global('grab', { onLevelUp: (x) => { c = x; } }); ps.funds = 50; m.handle('p_0', { t: 'g.levelUp' }); return c; })();
  assert.equal(ctx.playerId, 'p_0');
  const f = ps.funds;
  ctx.addFunds(3);
  assert.equal(ps.funds, f + 3);
  ctx.addFunds(-1000);
  assert.equal(ps.funds, 0, 'funds never go negative');
  assert.equal(ctx.addLayers('yanShip', 5, { requireActive: true }), 0, 'inactive bond: no gain');
  assert.equal(ctx.addLayers('yanShip', 5), 5);
  assert.equal(ctx.layers('yanShip'), 5);
  assert.equal(ctx.addLayers('nope', 5), 0);
  const id = chessOfTier(4).find((c) => m.pool.has(c));
  const left = m.pool.left(id);
  const got = ctx.grantChess(id);
  assert.ok(got && got.id === id);
  assert.equal(m.pool.left(id), left - 1);
  const drained = m.pool.take(id, 100);
  assert.equal(ctx.grantChess(id), null, 'pool empty → the grant fails');
  m.pool.give(id, drained);
  assert.equal(ctx.grantChess('not_a_chess'), null);
  ctx.grantFreeRefresh(2);
  assert.equal(ps.shop.freeRefreshes, 2);
  const ref = ctx.addEffect({ id: 'x1', name: '测试', desc: 'd', iconKind: 'team', counter: 3 });
  assert.equal(ctx.effect('x1'), ref);
  assert.ok(ps.privateView().effects.some((e) => e.id === 'x1' && e.counter === 3));
  ctx.setEffectCounter('x1', 1);
  assert.equal(ref.counter, 1);
  assert.ok(ctx.removeEffect('x1'));
  assert.equal(ctx.teammates().length, 1);
  assert.equal(ctx.teammates()[0].playerId, 'p_1');
  ctx.teammates()[0].addFunds(2);
  // a throwing handler never breaks the intent
  const errs = m.dispatcher.errors;
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
  assert.ok(m.dispatcher.errors > errs);
  // recursive grants are bounded by the depth cap (onGain → grantItem → onGain …)
  ctx.grantItem('chess_item_1_01_e_a');
  assert.ok(MAX_DEPTH >= 4);
  checkInvariants(m);
  m.dispose();
});

test('content overrides a built-in by registering the same key; consume items without a handler are rejected cleanly', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  reg.item('chess_item_1_03_e', { onEquip: (ctx) => ctx.addFunds(100) });
  const { m, ps } = metaMatch(reg, { seed: 73 });
  const a = give(m, ps, chessOfTier(1).find((c) => m.pool.has(c)));
  const coin = giveItem(m, ps, 'chess_item_1_03_e_a');
  ps.funds = 0;
  m.handle('p_0', { t: 'g.equip', itemUid: coin.uid, targetUid: a.uid });
  assert.equal(ps.funds, 100);
  reg.unregister('item:chess_item_4_01_e');
  const pager = giveItem(m, ps, 'chess_item_4_01_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: pager.uid, targetUid: a.uid }), { error: 'BAD_TARGET', detail: 'effect not available' });
  assert.ok(ps.find(pager.uid), 'the item stays in the hand');
  m.dispose();
});

test('onBattleStart may edit the PlayerBattleInput; onBattleResult sees the result', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  const results = [];
  reg.global('battle', {
    onBattleStart: (ctx, ev) => { ev.input.playerEffects.push({ id: 'meta-test', key: null, source: 'team', params: { x: 1 } }); },
    onBattleResult: (ctx, ev) => results.push([ctx.playerId, ev.lpLoss, ev.perfect]),
  });
  const { h, m } = metaMatch(reg, { seed: 74 });
  h.drive(() => m.phase === PHASE.SETTLE);
  const { FakeBattle } = awaitFake;
  const b = FakeBattle.instances.find((x) => x.kind === 'normal');
  assert.ok(b.opts.players[0].playerEffects.some((e) => e.id === 'meta-test'));
  assert.deepEqual(results, [['p_0', 0, true]]);
  m.dispose();
});

const awaitFake = await import('./fakeBattle.js');

test('choice:<id> handler overrides the family default, runs once, and other sources observe the pick', async () => {
  const { applyCard } = await import('../../server/match/choices.js');
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  let own = 0;
  const seen = [];
  reg.choice('allybuff_select_3', { onChoicePick: (ctx, ev) => { own++; ctx.addEffect({ id: 'wealth', key: 'choice:allybuff_select_3', name: '财富', battle: false }); } });
  reg.global('obs', { onChoicePick: (ctx, ev) => seen.push([ctx.playerId, ev.card.id, ev.forTeammate]) });
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 75, registry: reg, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const a = h.ps('p_0');
  const funds = a.funds;
  applyCard(m, a, { kind: 'tactic', id: 'allybuff_select_3', name: '财富', desc: '', team: true, family: 'tactic', idx: 0 });
  assert.equal(own, 2, 'picker + teammate (team card), once each');
  assert.equal(a.funds, funds, 'the default (+1 fund) was replaced by the handler');
  assert.deepEqual(seen, [['p_0', 'allybuff_select_3', false], ['p_1', 'allybuff_select_3', true]]);
  assert.ok(a.effects.some((e) => e.id === 'wealth'));
  m.dispose();
});
