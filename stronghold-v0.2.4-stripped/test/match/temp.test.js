// 临时整备区 (temp overflow) lifetime (PlayerState tempDue, research 06 §4.3 "直到溢出情况排除才可开始进行作战" /
// "处于临时整备区的调度资源，在进入下一回合后会自动销毁"): a temp piece is resolved at the deadline of the first prep in
// which its player could act on it. What overflows after that — battle-result grants, SETTLE merges, returned
// equipment, <休整期结束时> grants after Ready — survives the round start and is shown and usable in the next prep.
// FakeBattle; the rule auditor (server/match/audit.js) watches every match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { attachAudit } from '../../server/match/audit.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier, legalTileFor } from './harness.js';

/** Plain equipment (no equip / merge side effects): fillers for the hand and the pieces granted by the tests. */
const PLAIN = Object.values(DATA.items)
  .filter((i) => i.itemType === 'EQUIP' && !i.isGolden && i.kind === 'passive')
  .map((i) => i.itemId ?? i.id).filter(Boolean);
const GRANTS = PLAIN.slice(-3);
const FILL = PLAIN.slice(0, 10);

/**
 * Co-op match (2 humans: timed prep, FakeBattle) in PREP R1 with p_0's hand full of plain items and one carrier on the
 * board; `grants(ctx)` runs for p_0 on the hook `hook` (registry global). Audited from the start.
 */
function setup({ seed = 1500, hook = 'onBattleResult', grants = (ctx) => { for (const id of GRANTS.slice(0, 2)) ctx.grantItem(id); } } = {}) {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  let armed = false;
  reg.global('temp_test', { [hook](ctx) { if (armed && ctx.playerId === 'p_0') { armed = false; grants(ctx); } } });
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed, fake: true, registry: reg }).start();
  const audit = attachAudit(h.m);
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const carrierId = chessOfTier(2, (c) => !m.gd.placeableTokens(c.chessId).length).find((id) => m.pool.has(id));
  const carrier = give(m, ps, carrierId, 'board', legalTileFor(m, ps, carrierId));
  for (let i = 0; ps.hand.some((x) => x == null); i++) giveItem(m, ps, FILL[i]);
  return { h, m, ps, audit, carrier, arm: () => { armed = true; } };
}

test('equipment granted after the battle overflows into temp, survives the round start and is usable in the next prep', () => {
  const { h, m, ps, audit, carrier, arm } = setup();
  arm();
  h.drive(() => m.phase === PHASE.SETTLE && m.round === 1);
  const got = ps.temp.filter(Boolean).map((p) => p.id);
  assert.deepEqual(got.sort(), GRANTS.slice(0, 2).sort(), 'the battle-result grants overflowed into temp (full hand)');
  h.toPrep(2);
  const kept = ps.temp.filter(Boolean);
  assert.deepEqual(kept.map((p) => p.id).sort(), GRANTS.slice(0, 2).sort(), 'not wiped at the round start');
  const view = ps.privateView();
  assert.deepEqual(view.temp.filter(Boolean).map((v) => v.uid).sort(), kept.map((p) => p.uid).sort(), 'shown in the temp row');
  assert.equal(view.canReady, false);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { error: ERR.TEMP_NOT_EMPTY }, 'Ready is blocked until the overflow is cleared');
  // usable: equip one straight from temp, destroy the other
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: kept[0].uid, targetUid: carrier.uid }), { ok: true });
  assert.ok(carrier.items.some((it) => it.uid === kept[0].uid), 'equipped from temp');
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: kept[1].uid }), { ok: true });
  assert.ok(ps.tempEmpty && ps.privateView().canReady);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  checkInvariants(m);
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

/** A tier-1 chess of this match's pool without summons (a plain card for the grants). */
const plainChess = (m) => chessOfTier(1, (c) => !m.gd.placeableTokens(c.chessId).length).find((id) => m.pool.has(id) && m.pool.left(id) > 0);

test('a chess granted after the battle can be moved into a freed hand slot; what is left at the next deadline is resolved', () => {
  let T = null;
  const { h, m, ps, audit, arm } = setup({ seed: 1501, grants: (ctx) => { ctx.grantChess(T); ctx.grantItem(GRANTS[2]); } });
  T = plainChess(m);
  const cap = m.pool.cap(T);
  arm();
  h.toPrep(2);
  const chess = ps.temp.find((p) => p && p.kind === 'chess');
  const item = ps.temp.find((p) => p && p.kind === 'item');
  assert.ok(chess && chess.id === T && item && item.id === GRANTS[2], 'both grants waited in temp');
  assert.equal(m.pool.left(T), cap - 1, 'the temp chess holds its pool copy');
  // free a hand slot (destroy a filler) and take the chess into it
  const filler = ps.hand.findIndex((p) => p && p.kind === 'item');
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: ps.hand[filler].uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: chess.uid, to: { area: 'hand', idx: filler } }), { ok: true });
  assert.equal(ps.find(chess.uid).area, 'hand');
  // the item stays unhandled: the R2 deadline (co-op prep is timed) destroys it
  const p1 = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
  assert.ok(m.deadline > h.sched.now());
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(p1.ready && ps.ready);
  assert.ok(ps.tempEmpty, 'resolved at the deadline of the prep it was shown in');
  assert.ok(!ps.find(item.uid), 'the item was destroyed');
  assert.equal(ps.find(chess.uid).area, 'hand', 'the chess taken out of temp is kept');
  assert.equal(m.pool.left(T), cap - 1);
  checkInvariants(m);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('a chess still in temp at the next deadline is sold back: its pool copy returns', () => {
  let T = null;
  const { h, m, ps, audit, arm } = setup({ seed: 1502, grants: (ctx) => { ctx.grantChess(T); } });
  T = plainChess(m);
  const cap = m.pool.cap(T);
  arm();
  h.toPrep(2);
  assert.ok(ps.temp.some((p) => p && p.id === T));
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(ps.tempEmpty);
  assert.equal(m.pool.left(T), cap, 'copy back in the shared pool');
  checkInvariants(m);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('<休整期结束时> grants after Ready overflow into temp and are kept for the next prep (never wiped unseen)', () => {
  const { h, m, ps, audit, arm } = setup({ seed: 1503, hook: 'onPrepEnd' });
  arm();
  // both players ready with empty temps → the prep ends → onPrepEnd grants overflow into p_0's temp
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
  h.run(() => m.phase !== PHASE.PREP);
  assert.equal(ps.temp.filter(Boolean).length, 2, 'the prep-end grants are in temp');
  const uids = ps.temp.filter(Boolean).map((p) => p.uid).sort();
  assert.ok(ps.temp.filter(Boolean).every((p) => ps.tempDue(p) === ps.prepsEnded), 'due at the next prep');
  h.toPrep(2);
  assert.deepEqual(ps.temp.filter(Boolean).map((p) => p.uid).sort(), uids, 'kept through COMBAT, SETTLE and the round start');
  assert.equal(ps.privateView().canReady, false);
  // left alone they expire at this prep's deadline
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(ps.tempEmpty);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('an overflow while ready waits for the next prep; un-readying makes it due at this prep', () => {
  for (const unready of [false, true]) {
    const { h, m, ps, audit } = setup({ seed: 1504 });
    assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
    // a passive gain while p_0 is ready (a teammate's effect, a delayed grant …)
    const got = ps.acquireItem(GRANTS[0], { source: 'test' });
    assert.equal(ps.find(got.uid).area, 'temp');
    assert.equal(ps.tempDue(got), ps.prepsEnded + 1, 'the player could not act on it any more: due at the next prep');
    if (unready) {
      assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: false }), { ok: true });
      assert.equal(ps.tempDue(got), ps.prepsEnded, 'un-ready: it can be handled now, so it is due at this prep');
    }
    m.handle('p_1', { t: 'g.ready', ready: true });
    // still ready: everybody is, so the prep ends at once; un-readied: the deadline ends it
    if (unready) h.sched.advance(m.deadline - h.sched.now() + 1);
    else h.run(() => m.phase !== PHASE.PREP);
    assert.notEqual(m.phase, PHASE.PREP);
    if (unready) assert.ok(!ps.find(got.uid), 'resolved at this deadline');
    else assert.equal(ps.find(got.uid)?.area, 'temp', 'kept for the next prep');
    checkInvariants(m);
    assert.deepEqual(audit.violations, [], `${unready}:\n${audit.violations.join('\n')}`);
    m.dispose();
  }
});

test('an overflow during the prep before Ready expires at that prep\'s deadline (and is due now)', () => {
  const { h, m, ps, audit } = setup({ seed: 1505 });
  const got = ps.acquireItem(GRANTS[1], { source: 'test' });
  assert.equal(ps.find(got.uid).area, 'temp');
  assert.equal(ps.tempDue(got), ps.prepsEnded);
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(!ps.find(got.uid) && ps.tempEmpty);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('the rule auditor flags a temp piece kept past its prep deadline (engine regression guard)', () => {
  const { h, m, ps, audit } = setup({ seed: 1506 });
  ps.resolveTemp = () => {}; // simulated engine bug: the deadline never resolves temp
  ps.acquireItem(GRANTS[1], { source: 'test' });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(audit.violations.some((v) => /p_0: temp piece .* survived its prep end/.test(v)), audit.violations.join('\n'));
  assert.ok(!audit.violations.some((v) => v.includes('p_1')));
  m.dispose();
});

test('a bot clears the temp contents it finds at the start of its prep and readies before the deadline', () => {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  let armed = true;
  reg.global('temp_test', {
    onBattleResult(ctx) {
      if (!armed || ctx.playerId !== 'ai_0') return;
      armed = false;
      for (let i = 0; i < 12; i++) ctx.grantItem(PLAIN[i % PLAIN.length]);
    },
  });
  // two humans: the prep stays timed (a single human is untimed, Match.soloUntimed — user playtest #4 item 3)
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 1507, fake: true, registry: reg }).start();
  const audit = attachAudit(h.m);
  const m = h.m;
  h.toPrep(2);
  const bot = h.ps('ai_0');
  assert.ok(!bot.tempEmpty, 'the bot starts its prep with an overflow');
  const deadline = m.deadline;
  assert.ok(h.run(() => bot.ready || m.phase !== PHASE.PREP));
  assert.ok(bot.ready && h.sched.now() < deadline, 'ready before the deadline');
  assert.ok(bot.tempEmpty);
  checkInvariants(m);
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});
