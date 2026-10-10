// User playtest #6 item 5 — "图中的boss没有血量了但是不死，还在战斗，直到超时我们的生命被扣完才结束，但是最后的判定仍是胜利".
// The user's match: 2 humans (the AI teammates eliminated), 绝境, act2autochess_m01, client-side combat, one pair
// field; the HUD read 0.0 %, the leader kept fighting, the overtime drain took the team LP and the result said 胜利.
//
// Reproduced with real matches (real sim, SimClients as the browsers): on v2.4.1 about one boss fight in three stalled.
// The server pool kept float dust from crediting a report per player (40000 − 12345.6 − 7654.3 − 20000.1 = 3.6e-12);
// the authority's LocalBossPool showed exactly that and every hit added 3.6e-12 to a cumulative counter of 40000 —
// absorbed, so its pool never reached 0 and it never reported anything new. The fight ran on until the team LP was 0;
// the verdict then came from the pool after the final b.result, whose per-player damage is rounded: rounding up
// emptied the dust → 胜利 (what the user saw), rounding down → 失败.
//
// Now (sim/constants.js BOSS_POOL_MIN_HP, finalAssault.js SharedBossPool, sim/spec.js LocalBossPool, match/reports.js): a pool
// never holds less than 1 HP (the hit that would leave less takes the rest; a browser pool reading below 1 is 0), so
// the leader dies on every field as soon as the pool shows 0 and the fight ends; the first end condition the server
// registers decides the verdict (pool 0 → victory, team LP 0 → defeat: PRTS 卫戍协议：盟约 下半 "…使目标生命值扣除至0，
// 则无视倒计时直接失败"), and reports arriving after the team LP ran out credit nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

/** A real client-combat match (real sim) of 2 humans to the Final Assault on the user's stage and difficulty. */
function realFinalAssault({ bossId, seed, clientCombat = true }) {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 0, seed, captureFrames: false, clientCombat, pace: 'paced' });
  h.setStage('act2autochess_m01');
  const m = h.m;
  m.bossId = bossId;
  // the autoplay lineups cannot clear a full 绝境 pool: 5 % of the one-player table value (the tuning knob
  // GameData.bossHpMul; the pool counts both players alive since DESIGN §25.13.4, so 2.5 % of it) — the pool's
  // arithmetic, not its size, stalled the fight
  m.gd.bossHpMul = () => 0.025;
  h.autoHumans();
  m.start();
  let last = '';
  h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) { last = k; if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 300; }
    return h.ended != null || m.phase === PHASE.FINAL_ASSAULT;
  }, { maxSteps: 8e6 });
  assert.equal(m.phase, PHASE.FINAL_ASSAULT, `${bossId} seed ${seed}: reached the Final Assault`);
  return h;
}

// (boss, seed) pairs whose fight stalled on v2.4.1: pool < 1 HP within 30 s, then ~11 minutes of overtime drain;
// boss_3 / 11 and boss_10 / 12 ended as a 胜利 after the team LP ran out (the user's report), the others as a 失败
const STALLED = [['boss_1', 12], ['boss_2', 12], ['boss_3', 11], ['boss_10', 12]];

for (const [bossId, seed] of STALLED) {
  test(`#5 real match (client-side combat): ${bossId} seed ${seed} — the leader dies as soon as the shared pool is empty, victory, no overtime`, () => {
    const h = realFinalAssault({ bossId, seed });
    const m = h.m;
    const f = m.fields[0];
    assert.equal(m.fields.length, 1, 'one pair field');
    assert.deepEqual([f.mode, f.authority], ['client', 'p_0']);
    const t0 = h.sched.now();
    const lp0 = m.teamLp;
    const pools = [];
    let emptyAt = null, endAt = null;
    h.onBroadcast.push((msg) => {
      if (msg.t !== 'b.pool') return;
      pools.push(msg.hp);
      if (msg.hp < 1 && emptyAt == null) emptyAt = h.sched.now() - t0;
    });
    h.onSend.push((pid, msg) => { if (msg.t === 'b.end' && endAt == null) endAt = h.sched.now() - t0; });
    h.run(() => m.phase !== PHASE.FINAL_ASSAULT, { maxSteps: 8e6 });
    assert.ok(emptyAt != null, 'the team emptied the pool');
    assert.ok(pools.every((hp) => hp === 0 || hp >= 1), `the pool never holds float dust (${pools.filter((hp) => hp > 0 && hp < 1)})`);
    assert.ok(endAt != null && endAt <= emptyAt, `b.end went out when the pool emptied (${endAt} ms vs ${emptyAt} ms)`);
    assert.equal(m._finalEnding, 'cleared');
    assert.equal(m.overtimeApplied, 0, 'no overtime drain');
    assert.ok(m.teamLp > 0 && m.teamLp >= lp0 - 30, `team LP kept (${lp0} → ${m.teamLp})`);
    const c = h.clients.get('p_0');
    const local = c.battles.get(f.battleId).battle;
    assert.equal(local.reason, 'cleared', 'the authority\'s own battle saw the pool reach 0');
    assert.deepEqual(local.enemies.filter((e) => e.alive && e.isBoss).map((e) => e.defId), [], 'no leader left standing');
    assert.equal(local.sharedBoss.hp, 0);
    m.flush(true);
    const pub = h.lastBc('m.public');
    assert.deepEqual(pub.bossHp, { hp: 0, max: m.bossPool.maxHp });
    const end = h.runToEnd();
    assert.equal(end.victory, true);
    assert.equal(m.errorCount, 0);
    assert.equal(m.verifyStats.rejected, 0);
    m.dispose();
  });
}

test('#5 real match (server-run combat, SP_COMBAT=server): the Final Assault ends when the pool empties, never on float dust', () => {
  const h = realFinalAssault({ bossId: 'boss_3', seed: 11, clientCombat: false });
  const m = h.m;
  const pool = m.bossPool;
  const seen = [];
  const orig = pool.damage.bind(pool);
  pool.damage = (pid, amount) => { const d = orig(pid, amount); seen.push(pool.hp); return d; };
  const end = h.runToEnd();
  assert.ok(seen.length > 0);
  assert.ok(seen.every((hp) => hp === 0 || hp >= 1), 'the pool is 0 or at least 1 HP after every hit');
  assert.equal(pool.hp, 0);
  assert.equal(end.victory, true);
  assert.equal(m.overtimeApplied, 0);
  m.dispose();
});

// ---- the shared pool through the real crediting path (FakeBattle hits a real LocalBossPool; deterministic) ---------

test('#5 client-side combat: a boss dps whose per-player credits used to leave 1.5e-11 in the pool ends the fight when the pool empties', () => {
  for (const dps of [3456.789, 24680.13]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9110, fake: true, clientCombat: true, instant: false,
      script: (b) => (b.kind === 'boss' ? { bossDps: dps } : { duration: 2 }) }).start();
    const m = h.m;
    h.autoHumans();
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    const t0 = h.sched.now();
    const lp0 = m.teamLp;
    let emptyAt = null, endAt = null;
    const pools = [];
    h.onBroadcast.push((msg) => { if (msg.t === 'b.pool') { pools.push(msg.hp); if (msg.hp < 1 && emptyAt == null) emptyAt = h.sched.now() - t0; } });
    h.onSend.push((pid, msg) => { if (msg.t === 'b.end' && endAt == null) endAt = h.sched.now() - t0; });
    h.run(() => m.phase !== PHASE.FINAL_ASSAULT, { maxSteps: 5e6 });
    assert.ok(emptyAt != null, `dps ${dps}: the pool emptied`);
    assert.ok(pools.every((hp) => hp === 0 || hp >= 1), `dps ${dps}: never float dust (${pools.filter((hp) => hp > 0 && hp < 1)})`);
    assert.ok(endAt != null && endAt <= emptyAt, `dps ${dps}: b.end cleared went out with the empty pool (${emptyAt} / ${endAt} ms; v2.4.1 stalled until the drain at ~205 s)`);
    assert.equal(m._finalEnding, 'cleared');
    assert.equal(m.teamLp, lp0, 'no overtime drain');
    const end = h.runToEnd();
    assert.equal(end.victory, true);
    m.dispose();
  }
});

test('#5 verdict: once the team LP runs out the run is lost — a boss field\'s final result can never credit damage or turn it into a victory', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9109, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 0, leakEvents: [{ at: 4, lpr: 1 }] } : { duration: 2 }),
    // the authority's b.result after the forced end reports more boss damage than was ever credited (in flight / rounded)
    perPlayer: { p_0: { tamper: (result, spec) => {
      if (spec.kind !== 'boss') return result;
      for (const pp of Object.values(result.perPlayer)) pp.bossDamage = 1e6;
      return result;
    } } } }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  h.sched.advance(1000);
  m.teamLp = 1; // the last target LP point: the leak at 4 game s takes it
  m.bossPool.hp = 50; // a leader 50 HP from death
  h.run(() => m.phase !== PHASE.FINAL_ASSAULT, { maxSteps: 5e6 });
  assert.equal(m._finalEnding, 'forced', 'the team LP ran out first');
  assert.ok(h.clients.get('p_0').log.some((x) => x.t === 'b.result'), 'the authority reported after b.end forced');
  assert.equal(m.bossPool.hp, 50, 'nothing reported after the forced end is credited');
  const end = h.runToEnd();
  assert.equal(end.victory, false, 'defeat: the team LP reached 0 before the pool');
  assert.equal(end.reason, 'defeat');
  assert.equal(m.teamLp, 0);
  m.dispose();
});
