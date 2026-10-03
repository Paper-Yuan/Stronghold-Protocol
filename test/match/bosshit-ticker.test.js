// BOSS_HIT tickers ("{0}博士对敌方领袖造成的伤害超过20% / 50% / 80%!", activity_table autoChessData.broadcastList
// comment_boss_hit_1..3, paramList 0.2 / 0.5 / 0.8) — player report after 0.1.0: "隐藏boss还没打就出了造成50%伤害播报".
//
// Reproduced with real bot matches (real sim) that reach the 隐秘核心: the Hidden Core's very first hit (a few dozen
// HP of a 900000 pool) already announced "超过50%". The ticker divided the player's damage of the WHOLE match
// (stats.bossDamage, Final Assault + Hidden Core: the result screen's 领袖伤害) by the hidden leader's pool, so the
// Final Assault's damage counted as damage to the hidden leader. The share is now the player's damage to the current
// leader's pool (SharedBossPool.byPlayer, one pool per boss round) over that pool: each boss round announces its own
// 20 / 50 / 80 % — on server-run fields, under client-side combat and after a server takeover alike. (The browser's
// strip also played a Final Assault line late, into the Hidden Core: test/ui/bosshit-ticker.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { BOSS_HIT_STEPS } from '../../server/match/finalAssault.js';
import { makeMatch, checkInvariants } from './harness.js';

/**
 * A match (fake battles) driven through the Final Assault (one hit clears it) into the Hidden Core, whose fields deal
 * `hiddenDps` (a share of the hidden pool per game second). Every BOSS_HIT ticker is recorded with the phase and the
 * player's real share of the leader in play at that moment (the current pool).
 */
function toHiddenCore({ mode = 'coop', difficulty = 'NORMAL', humans = 1, clientCombat = false, seed = 61, bossId, hiddenBossId, hiddenDps = 0.02, onHidden = null }) {
  const h = makeMatch({ mode, difficulty, humans, seed, fake: true, clientCombat, instant: !clientCombat,
    script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : b.kind === 'hidden' ? { bossDps: b.sharedBoss.maxHp * hiddenDps } : {}) }).start();
  const m = h.m;
  m.bossId = bossId;
  m.hiddenBossId = hiddenBossId;
  const hits = [];
  h.onBroadcast.push((msg) => {
    if (msg.t !== 'm.ticker' || msg.type !== 'BOSS_HIT') return;
    const pool = m.bossPool;
    hits.push({ phase: m.phase, playerId: msg.playerId, text: msg.text, id: msg.id,
      share: pool ? (pool.byPlayer.get(msg.playerId) || 0) / pool.maxHp : null,
      leaderHpPct: pool ? pool.hp / pool.maxHp : null });
  });
  if (clientCombat) h.autoHumans();
  h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound);
  // Σ activated layers above the hidden-core threshold (solo 350 / co-op 1200), every player
  for (const p of m.players.values()) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 601; p.recompute(); }
  h.drive(() => m.phase === PHASE.HIDDEN_CORE || h.ended != null);
  assert.equal(m.phase, PHASE.HIDDEN_CORE, 'reached the Hidden Core');
  if (onHidden) onHidden(h);
  const end = h.runToEnd({ maxSteps: 6e6 });
  return { h, m, end, hits };
}

/** The threshold a BOSS_HIT ticker announces (its config param, from the text: "超过N%"). */
const stepOf = (hit) => Number(/超过(\d+)%/.exec(hit.text)[1]) / 100;

/** Every ticker of `phase` announces at most what the player really dealt to that leader, in rising order, once each. */
function assertTruthful(hits, phase, players) {
  const inPhase = hits.filter((x) => x.phase === phase);
  for (const x of inPhase) {
    assert.ok(x.share + 1e-9 >= stepOf(x), `${phase}: "${x.text}" while ${x.playerId} had dealt ${(x.share * 100).toFixed(2)} % of this leader (leader at ${(x.leaderHpPct * 100).toFixed(2)} %)`);
  }
  for (const pid of players) {
    const steps = inPhase.filter((x) => x.playerId === pid).map(stepOf);
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b), `${phase} ${pid}: rising thresholds`);
    assert.equal(new Set(steps).size, steps.length, `${phase} ${pid}: each threshold once`);
  }
  return inPhase;
}

test('C1 (solo 绝境, server-run fields): the Hidden Core\'s first hit announces nothing — the Final Assault\'s damage is not damage to the hidden leader', () => {
  // the reported case: a Final Assault pool larger than half the hidden leader's — solo 绝境 (HARD): 盐风主教昆图斯 525000,
  // 75 % of 假想敌：铳's 700000, so the old share announced 超过50% at the hidden leader's first hit
  const { m, end, hits } = toHiddenCore({ mode: 'solo', difficulty: 'HARD', bossId: 'boss_4', hiddenBossId: 'boss_9', hiddenDps: 0.01 });
  assert.equal(end.hiddenReached, true);
  const fa = assertTruthful(hits, PHASE.FINAL_ASSAULT, ['p_0']);
  assert.deepEqual(fa.map(stepOf), [0.8], 'the Final Assault cleared by one hit: 80 %');
  const hidden = assertTruthful(hits, PHASE.HIDDEN_CORE, ['p_0']);
  assert.deepEqual(hidden.map(stepOf), BOSS_HIT_STEPS, 'the Hidden Core announces its own 20 / 50 / 80 % as they are reached');
  assert.ok(hidden[0].leaderHpPct <= 0.8 + 1e-9, `the first hidden ticker comes after 20 % of the hidden leader (leader at ${(hidden[0].leaderHpPct * 100).toFixed(2)} %)`);
  // the result screen's 领袖伤害 keeps the whole match: the Final Assault's pool plus the hidden one
  assert.ok(end.players[0].stats.bossDamage > m.bossPool.maxHp, `领袖伤害 ${end.players[0].stats.bossDamage}`);
  checkInvariants(m);
  m.dispose();
});

for (const humans of [2, 4]) {
  test(`C1 (${humans} players, client-side combat): every BOSS_HIT of the Hidden Core matches the player's damage to the hidden leader`, () => {
    const { m, end, hits } = toHiddenCore({ mode: 'coop', difficulty: 'NORMAL', humans, clientCombat: true, seed: 62 + humans, bossId: 'boss_4', hiddenBossId: 'boss_8', hiddenDps: 0.02 });
    assert.equal(end.hiddenReached, true);
    const ids = [...m.players.keys()];
    assertTruthful(hits, PHASE.FINAL_ASSAULT, ids);
    const hidden = assertTruthful(hits, PHASE.HIDDEN_CORE, ids);
    assert.ok(hidden.length > 0, 'the Hidden Core still announces real damage');
    // the stats keep the whole match: the first field player's 领袖伤害 covers both rounds
    const row = end.players.find((p) => p.playerId === ids[0]);
    assert.ok(row.stats.bossDamage > 0);
    checkInvariants(m);
    m.dispose();
  });
}

test('C1 (2 players, server-run fields — SP_COMBAT=server): the hidden pool\'s tickers follow the hidden-core damage only', () => {
  const { m, end, hits } = toHiddenCore({ mode: 'coop', difficulty: 'HARD', humans: 2, clientCombat: false, seed: 66, bossId: 'boss_4', hiddenBossId: 'boss_8', hiddenDps: 0.02 });
  assert.equal(end.hiddenReached, true);
  assertTruthful(hits, PHASE.FINAL_ASSAULT, ['p_0', 'p_1']);
  const hidden = assertTruthful(hits, PHASE.HIDDEN_CORE, ['p_0', 'p_1']);
  // the even split: both players pass 20 % of the hidden leader
  for (const pid of ['p_0', 'p_1']) assert.ok(hidden.some((x) => x.playerId === pid && stepOf(x) === 0.2), `${pid}: 20 %`);
  checkInvariants(m);
  m.dispose();
});

test('C1 (solo, client-side combat, server takeover mid-fight): the re-simulated hidden field\'s credits announce the hidden-core share only', () => {
  let tookOver = false;
  const { m, end, hits } = toHiddenCore({ mode: 'solo', difficulty: 'HARD', clientCombat: true, seed: 67, bossId: 'boss_4', hiddenBossId: 'boss_9', hiddenDps: 0.02,
    onHidden: (h) => {
      h.sched.advance(3000); // the browser reported a few seconds of the fight
      h.m.onDisconnect('p_0');
      tookOver = h.m.fields[0].mode === 'server';
      h.m.onReconnect('p_0');
    } });
  assert.ok(tookOver, 'the server took the hidden field over (CreditPool)');
  assert.equal(end.hiddenReached, true);
  assertTruthful(hits, PHASE.FINAL_ASSAULT, ['p_0']);
  const hidden = assertTruthful(hits, PHASE.HIDDEN_CORE, ['p_0']);
  assert.deepEqual(hidden.map(stepOf), BOSS_HIT_STEPS);
  checkInvariants(m);
  m.dispose();
});
