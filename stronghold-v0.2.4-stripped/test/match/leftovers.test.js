// Server leftovers (DESIGN §14): battleIds unique across the matches of a room (a late report from the previous match
// is ignored), duplicate b.result idempotent, the Final Assault's m.public throttled to ~1 Hz (b.pool is live), the
// solo pause (g.pause → m.public.paused: field clock, deadlines, boss clock, server pacers frozen), protocol additions
// (g.pause, g.equip replaceUid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { RESULT_GRACE_MS, BOSS_SILENCE_MS } from '../../server/match/fields.js';
import { FakeBattle } from './fakeBattle.js';
import { makeMatch, checkInvariants } from './harness.js';

/** A plausible client result for a spec (FakeBattle stepped to its end, like test/match/simClient.js). */
function fakeResult(m, spec) {
  const b = createBattleFromSpec(spec, m.ds, { BattleClass: FakeBattle, recordEvents: false, quiet: true });
  for (let i = 0; i < 1e5 && !b.finished; i++) b.step();
  return compactResult(b.result());
}

const pub = (h) => { h.m.flush(true); return h.lastBc('m.public'); };

// ---- battleId ---------------------------------------------------------------------------------------------------

test('battleIds carry a per-match prefix (seed + the room\'s match number): a late b.progress / b.result of the previous match is ignored', () => {
  const mk = (matchNo) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 4242, matchNo, fake: true, clientCombat: true, clients: false }).start();
    assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT));
    return h;
  };
  const a = mk(1);
  const b = mk(2);
  const sa = a.lastTo('p_0', 'b.start');
  const sb = b.lastTo('p_0', 'b.start');
  assert.notEqual(sa.battleId, sb.battleId, 'same seed, same field, another match of the room');
  assert.ok(sa.battleId.startsWith(`${(4242).toString(36)}-1.1.`) && sb.battleId.startsWith(`${(4242).toString(36)}-2.1.`), `${sa.battleId} / ${sb.battleId}`);
  assert.deepEqual({ ...sa.spec, battleId: null }, { ...sb.spec, battleId: null }, 'the very same battle otherwise');
  const result = fakeResult(a.m, sa.spec);
  const f = b.m.fields[0];
  // the previous match's reports reach the new match (same socket, same room): ignored, never an error
  assert.deepEqual(b.m.handle('p_0', { t: 'b.progress', battleId: sa.battleId, gt: 5, killed: 1, total: f.progress.total }), { ok: true });
  assert.equal(f.progress.killed, 0);
  assert.deepEqual(b.m.handle('p_0', { t: 'b.result', battleId: sa.battleId, result }), { ok: true });
  assert.equal(f.done, false, 'the stale result did not settle the new match\'s battle');
  assert.deepEqual(b.m.handle('p_0', { t: 'b.result', battleId: sb.battleId, result }), { ok: true });
  assert.equal(f.done, true);
  assert.equal(f.resultSource, 'client');
  a.m.dispose();
  b.m.dispose();
});

test('battleIds: unique within a match, valid protocol ids (≤ 64 chars) even for long player ids; no matchNo ⇒ the seed alone', () => {
  const long = `p_${'x'.repeat(60)}`;
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: long, name: 'L', isBot: false, connected: true }, { seat: 1, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed: 77, fake: true, clientCombat: true, clients: false }).start();
  const ids = new Set();
  for (let r = 1; r <= 3; r++) {
    assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT && h.m.round === r));
    for (const f of h.m.fields) {
      assert.ok(!ids.has(f.battleId), `unique ${f.battleId}`);
      ids.add(f.battleId);
      assert.ok(f.battleId.length <= 64 && f.battleId.startsWith(`${(77).toString(36)}.${r}.`), f.battleId);
      assert.equal(validateC2S({ t: 'b.progress', battleId: f.battleId, gt: 0, killed: 0, total: 0 }), null);
    }
    h.drive(() => h.m.phase === PHASE.PREP || h.ended != null);
  }
  assert.equal(h.m.errorCount, 0);
  h.m.dispose();
});

// ---- duplicate b.result -------------------------------------------------------------------------------------------

test('a duplicate b.result (a re-send after a lost reply) is accepted idempotently: ok, nothing changes', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 4243, fake: true, clientCombat: true, clients: false }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  const start = h.lastTo('p_0', 'b.start');
  const f = m.fields[0];
  const result = fakeResult(m, start.spec);
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: start.battleId, result }), { ok: true });
  assert.equal(f.done, true);
  const kept = f.result;
  const stats = { ...m.verifyStats };
  const lp = m.players.get('p_0').lp;
  for (let i = 0; i < 3; i++) assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: start.battleId, result }), { ok: true });
  assert.equal(f.result, kept);
  assert.deepEqual(m.verifyStats, stats);
  // and once the round moved on
  h.run(() => m.phase === PHASE.SETTLE);
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: start.battleId, result }), { ok: true });
  h.run(() => m.phase === PHASE.PREP);
  assert.equal(m.players.get('p_0').lp, lp - Math.min(10, (kept.perPlayer.p_0.leaked || []).filter((l) => l.counted !== false).length));
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

// ---- Final Assault m.public throttle ------------------------------------------------------------------------------

test('Final Assault: boss b.progress (4 Hz per field) no longer re-marks m.public — ~1 Hz, while b.pool stays ≤ 4 Hz with the exact numbers', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9111, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 300, leakEvents: [{ at: 3, lpr: 2 }, { at: 5, lpr: 1 }] } : { duration: 2 }) }).start();
  const m = h.m;
  h.autoHumans();
  assert.ok(h.drive(() => m.phase === PHASE.FINAL_ASSAULT));
  const pubs = [];
  const pools = [];
  h.onBroadcast.push((msg) => {
    if (msg.t === 'm.public' && msg.phase === PHASE.FINAL_ASSAULT) pubs.push({ at: h.sched.now(), msg });
    if (msg.t === 'b.pool') pools.push(msg);
  });
  const lp0 = m.teamLp;
  const t0 = h.sched.now();
  h.sched.advance(8000);
  const secs = (h.sched.now() - t0) / 1000;
  const progress = h.clients.get('p_0').log.filter((x) => x.t === 'b.progress').length;
  assert.ok(progress >= secs * 3, `the boss field reports at ~4 Hz (${progress})`);
  assert.ok(pubs.length <= secs + 3, `m.public ≈ 1 Hz during the boss fight (${pubs.length} in ${secs} s)`);
  assert.ok(pubs.length >= secs - 2, `…but it keeps following the fight (${pubs.length})`);
  assert.ok(pools.length >= secs * 3, `b.pool stays live (${pools.length})`);
  // the throttled view is at most one period behind: team LP and the players' shares agree with it
  assert.equal(m.teamLp, lp0 - 3);
  h.sched.advance(1100);
  const last = pub(h);
  assert.equal(last.teamLp, Math.round(m.teamLp));
  assert.equal(last.players.filter((p) => p.alive).reduce((s, p) => s + p.lp, 0), Math.round(m.teamLp), 'Σ lp = team LP');
  assert.equal(last.bossHp.hp, Math.max(0, Math.round(m.bossPool.hp)));
  assert.equal(pools[pools.length - 1].teamLp, Math.round(m.teamLp));
  const end = h.runToEnd({ maxSteps: 5e6 });
  assert.ok(end);
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

// ---- solo pause ---------------------------------------------------------------------------------------------------

test('protocol: g.pause { on } and g.equip replaceUid (optional)', () => {
  assert.equal(validateC2S({ t: 'g.pause', on: true }), null);
  assert.equal(validateC2S({ t: 'g.pause', on: false, rid: 3 }), null);
  assert.notEqual(validateC2S({ t: 'g.pause' }), null);
  assert.notEqual(validateC2S({ t: 'g.pause', on: 1 }), null);
  assert.equal(validateC2S({ t: 'g.equip', itemUid: 1, targetUid: 2 }), null);
  assert.equal(validateC2S({ t: 'g.equip', itemUid: 1, targetUid: 2, replaceUid: 3 }), null);
  assert.equal(validateC2S({ t: 'g.equip', itemUid: 1, targetUid: 2, replaceUid: null }), null);
  assert.notEqual(validateC2S({ t: 'g.equip', itemUid: 1, targetUid: 2, replaceUid: 'x' }), null);
  assert.notEqual(validateC2S({ t: 'g.equip', itemUid: 1, targetUid: 2, replaceUid: 0 }), null);
});

test('solo pause: co-op never pauses; solo only while a battle runs; m.public.paused', () => {
  const co = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 5150, fake: true, clientCombat: true, clients: false, instant: false }).start();
  assert.ok(co.drive(() => co.m.phase === PHASE.COMBAT));
  assert.equal(co.m.handle('p_0', { t: 'g.pause', on: true }).error, ERR.WRONG_PHASE);
  assert.equal(pub(co).paused, false);
  co.m.dispose();

  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5151, fake: true, clientCombat: true, clients: false, instant: false }).start();
  const m = h.m;
  assert.equal(pub(h).paused, false, 'always present');
  assert.ok(h.drive(() => m.phase === PHASE.PREP, { ready: false }));
  assert.equal(m.handle('p_0', { t: 'g.pause', on: true }).error, ERR.WRONG_PHASE, 'prep is untimed in solo: nothing to pause');
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  assert.equal(m.paused, false);
  m.dispose();
});

test('solo pause: the field clock, the result deadline and the HUD countdown stand still; resume shifts them by the pause', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5152, fake: true, clientCombat: true, clients: false, instant: false }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  const f = m.fields[0];
  assert.deepEqual([f.mode, f.authority], ['client', 'p_0']);
  const deadline0 = m.deadline;
  const due0 = f.startAt + Math.round((f.spec.timeLimit / m.gameSpeed) * 1000) + RESULT_GRACE_MS;
  h.sched.advance(2000);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true }, 'idempotent');
  assert.equal(pub(h).paused, true);
  const el = m._fieldElapsed(f);
  const PAUSE = 10 * 60 * 1000;
  h.sched.advance(PAUSE);
  assert.equal(m.phase, PHASE.COMBAT);
  assert.deepEqual([f.mode, f.done], ['client', false], 'no takeover while paused (the deadline passed long ago)');
  assert.equal(m._fieldElapsed(f), el, 'the field clock stood still');
  m.onReconnect('p_0'); // a resync while paused: the replica is built at the frozen clock
  assert.equal(h.lastTo('p_0', 'b.start').elapsed, Math.round(el * 1000) / 1000);
  assert.equal(h.lastTo('p_0', 'm.public').paused, true, 'm.public first: the runner is paused before it builds the battle');
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  const p = pub(h);
  assert.equal(p.paused, false);
  assert.equal(p.deadline, deadline0 + PAUSE, 'the countdown resumes where it stopped');
  assert.ok(Math.abs(m._fieldElapsed(f) - el) < 1e-9);
  h.sched.advance(due0 + PAUSE - h.sched.now() - 50);
  assert.equal(f.mode, 'client', 'the result deadline moved by the pause');
  h.sched.advance(100);
  assert.equal(f.mode, 'server', 'then the silent client is taken over');
  assert.equal(m.pausedMs, PAUSE);
  assert.equal(m.errorCount, 0);
  m.dispose();
});

test('solo pause: a disconnect resumes (the server takes the field over); the battle phase ending clears the pause', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5153, fake: true, clientCombat: true, clients: false, instant: false }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  h.sched.advance(5000);
  m.onDisconnect('p_0');
  assert.equal(m.paused, false);
  assert.equal(m.fields[0].mode, 'server');
  assert.equal(pub(h).paused, false);
  m.onReconnect('p_0');
  h.run(() => m.phase === PHASE.PREP);
  assert.equal(m.errorCount, 0);
  m.dispose();

  // the client's result crosses the pause: the phase ends, the pause goes with it
  const h2 = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5154, fake: true, clientCombat: true, clients: false, instant: false }).start();
  const m2 = h2.m;
  assert.ok(h2.drive(() => m2.phase === PHASE.COMBAT));
  const start = h2.lastTo('p_0', 'b.start');
  assert.deepEqual(m2.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  assert.deepEqual(m2.handle('p_0', { t: 'b.result', battleId: start.battleId, result: fakeResult(m2, start.spec) }), { ok: true });
  assert.equal(m2.paused, false);
  assert.equal(pub(h2).paused, false);
  h2.run(() => m2.phase === PHASE.PREP && m2.round === 2);
  assert.equal(m2.handle('p_0', { t: 'g.pause', on: true }).error, ERR.WRONG_PHASE);
  assert.equal(m2.errorCount, 0);
  m2.dispose();
});

test('solo pause in the Final Assault: no overtime drain, no silence handover, the boss clock stops; resume shifts overtimeAt', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5155, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 0 } : { duration: 2 }) }).start();
  const m = h.m;
  h.autoHumans();
  assert.ok(h.drive(() => m.phase === PHASE.FINAL_ASSAULT || h.ended != null, { maxSteps: 5e6 }));
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);
  h.clients.closeAll(); // the browser goes quiet: only the silence watchdog would move the field
  const f = m.fields[0];
  assert.deepEqual([f.mode, f.authority], ['client', 'p_0']);
  h.sched.advance(1000);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  const lp = m.teamLp;
  const overtimeAt = m.overtimeAt;
  const el = m._fieldElapsed(f);
  const PAUSE = 400 * 1000; // far beyond the overtime start (150 s) and the silence watchdog (12 s)
  h.sched.advance(PAUSE);
  assert.equal(m.teamLp, lp, 'no overtime drain while paused');
  assert.equal(f.mode, 'client', 'no silence handover while paused');
  assert.equal(m._fieldElapsed(f), el);
  assert.equal(m._bossClock, null);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  assert.equal(m.overtimeAt, overtimeAt + PAUSE);
  assert.equal(pub(h).overtimeAt, overtimeAt + PAUSE);
  assert.ok(m._bossClock, 'the boss clock runs again');
  h.sched.advance(BOSS_SILENCE_MS + 1000);
  assert.equal(f.mode, 'server', 'the watchdog works again after the resume');
  assert.equal(m.teamLp, lp, 'still before the overtime start on the field clock');
  assert.equal(m.errorCount, 0);
  m.dispose();
});

test('solo pause with server-run combat (SP_COMBAT=server): the FieldRunner does not step while paused', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5156, fake: true, instant: false, script: () => ({ duration: 20 }) }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  h.sched.advance(1000);
  const b = m.fields[0].battle;
  const t = b.time;
  assert.ok(t > 1.5, `running (${t})`);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  h.sched.advance(30000);
  assert.equal(b.time, t);
  assert.equal(m.phase, PHASE.COMBAT);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  h.sched.advance(1000);
  assert.ok(b.time > t + 1.5 && b.time < t + 2.5, `continues at 2× without a catch-up burst (${t} → ${b.time})`);
  h.run(() => m.phase === PHASE.PREP);
  assert.equal(m.errorCount, 0);
  m.dispose();
});
