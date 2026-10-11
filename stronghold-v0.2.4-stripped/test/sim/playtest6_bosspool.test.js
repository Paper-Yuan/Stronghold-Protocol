// User playtest #6 item 5 — "图中的boss没有血量了但是不死，还在战斗，直到超时我们的生命被扣完才结束，但是最后的判定仍是胜利"
// (绝境 co-op Final Assault on act2autochess_m01, client-side combat: the HUD read 0.0 %, the leader kept fighting until
// the overtime drain took the team LP, and the result still said 胜利).
//
// Cause (reproduced in real matches, test/match/playtest6-bosspool.test.js): the shared pool's float arithmetic. The
// server subtracts each field's reported damage per player (Match._creditBoss); the pieces add up to the report only
// in exact arithmetic, so the server pool can keep float dust (e.g. 40000 − 12345.6 − 7654.3 − 20000.1 = 3.6e-12). The
// browser's LocalBossPool shows `server hp − (cum − acked)`: with 3.6e-12 left, every hit adds 3.6e-12 to a cumulative
// counter of 40000 — less than half its ulp, so `cum` never changes, the pool never reaches 0, the leader never dies
// and nothing more is reported. The same absorption stalls a killing hit whose `cum + rest` rounds down.
//
// Rule now (server/sim/constants.js BOSS_POOL_MIN_HP): a shared pool holding less than 1 HP is empty — the hit that
// would leave less takes the rest (SharedBossPool, LocalBossPool), and a pool reading below 1 HP is 0 (LocalBossPool),
// so a leader whose pool shows 0 is dead on every field at once and the fight ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalBossPool, buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { SharedBossPool, CreditPool } from '../../server/match/finalAssault.js';
import * as SIM_CONST from '../../server/sim/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildBossWave, setupMatchWaves } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { GEO } from '../../shared/constants.js';
import { getData } from '../../server/data.js';

const { BOSS_POOL_MIN_HP } = SIM_CONST;
const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
/** The stalled state a real 2-human 绝境 match reached (boss_2 at 5 % pool, seed 7): server hp, acked = local cum. */
const STALL = Object.freeze({ max: 40000, serverHp: 3.637978807091713e-12, cum: 40000 });

test('BOSS_POOL_MIN_HP is 1 (HP counts in whole points on every display)', () => {
  assert.equal(BOSS_POOL_MIN_HP, 1);
});

test('SharedBossPool: per-player credits that add up to the pool leave no float dust; a hit leaving < 1 HP takes the rest', () => {
  const p = new SharedBossPool(40000);
  assert.equal(p.damage('p_0', 12345.6), 12345.6);
  assert.equal(p.damage('p_1', 7654.3), 7654.3);
  p.damage('p_0', 20000.1); // 40000 − 12345.6 − 7654.3 − 20000.1 = 3.637978807091713e-12 in doubles
  assert.equal(p.hp, 0, 'empty, not 3.6e-12');
  assert.equal(p.damage('p_1', 5), 0, 'nothing more to deal');
  const q = new SharedBossPool(1000);
  q.damage('p_0', 998.7);
  assert.ok(Math.abs(q.hp - 1.3) < 1e-9, '1.3 HP is a living leader');
  assert.ok(Math.abs(q.damage('p_1', 0.5) - 1.3) < 1e-9, 'the hit that would leave 0.8 HP takes the rest (credited to it)');
  assert.equal(q.hp, 0);
  assert.ok(Math.abs(q.byPlayer.get('p_1') - 1.3) < 1e-9);
  // a takeover's crediting wrapper goes through the same rule
  const r = new SharedBossPool(500);
  r.damage('p_0', 100); // what the client reported before the server took its field over
  const cp = new CreditPool(r, { acked: 100 });
  cp.damage('p_0', 100); // re-simulated damage the client already reported: nothing new
  assert.equal(r.hp, 400);
  cp.damage('p_0', 399.5);
  assert.equal(r.hp, 0, '0.5 HP left is empty');
});

test('LocalBossPool: the stalled state of the real match reads 0 HP (dead), not float dust', () => {
  const pool = new LocalBossPool(STALL.max);
  pool.cum = STALL.cum;
  pool.byPlayer = { p_0: 25000, p_1: 15000 };
  pool.sync(STALL.serverHp, STALL.cum);
  assert.equal(pool.hp, 0, 'less than 1 HP left = empty');
  assert.equal(pool.damage('p_0', 5000), 0);
  assert.equal(pool.cum, STALL.cum);
});

test('LocalBossPool: a killing hit empties the pool whatever the float alignment of server hp and local damage', () => {
  let stuck = 0;
  for (let k = 0; k < 400; k++) {
    const p = new LocalBossPool(1800000);
    p.damage('p_0', 1799000.123 + k * 0.0137);
    const A = p.cum;
    // a server remnant whose granularity differs from the local counter's (the other field / per-player crediting)
    p.sync(1800000 - A + (k % 7) * 1.1e-13, A);
    for (let hits = 0; p.hp > 0 && hits < 50; hits++) p.damage('p_1', 5000);
    if (p.hp !== 0) stuck++;
  }
  assert.equal(stuck, 0, 'no pool stays alive on float dust');
  // below 1 HP reads 0; the rest of a normal pool is untouched
  const p = new LocalBossPool(100);
  p.damage('p_0', 99.2);
  assert.equal(p.hp, 0, '0.8 HP left reads 0');
  const q = new LocalBossPool(100);
  q.damage('p_0', 98.5);
  assert.ok(Math.abs(q.hp - 1.5) < 1e-9);
  assert.equal(q.damage('p_0', 0.7), 1.5, 'the hit that would leave 0.8 HP takes the rest');
  assert.equal(q.hp, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// every leader, on a real boss field (co-op pair template, 绝境)

const gd = new GameData(DATA, 'mode_multi_hard');
const setup = setupMatchWaves(gd, createRng(3));
const PLAYERS = [
  { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {}, playerEffects: [] },
  { playerId: 'p_1', seat: 1, side: 'R', colOffset: 8, units: [], bonds: {}, playerEffects: [] },
];
const BOSSES = ['boss_1', 'boss_2', 'boss_3', 'boss_4', 'boss_5', 'boss_6', 'boss_7', 'boss_8', 'boss_9', 'boss_10'];

function bossBattle(bossId, sharedBoss) {
  const wave = buildBossWave(gd, createRng(1), setup.factions, 14, { bossId, solo: false });
  const max = sharedBoss ? sharedBoss.maxHp : gd.boss(bossId).bloodPoint.HARD;
  const spec = buildBattleSpec({
    battleId: `t.${bossId}`, fieldId: 'b1', kind: 'boss', seed: 11, modeId: 'mode_multi_hard', round: 14, stageId: 'act2autochess_m01',
    rect: { ...GEO.BOSS_RECT }, timeLimit: null, players: PLAYERS, spawns: wave.spawns.filter((s) => s && gd.enemy(s.enemyKey)),
    routes: wave.routes, flags: { layerGainsEnabled: false, ...gd.dp }, enemyOverrides: wave.overrides, waveId: wave.templateId,
    bossId, boss: { poolHp: max, poolMax: max },
  });
  const b = createBattleFromSpec(spec, undefined, { sharedBoss, recordEvents: false, quiet: true });
  for (let i = 0; i < 30 * 90 && !b.enemies.some((e) => e.alive && e.isBoss); i++) b.step();
  const leaders = b.enemies.filter((e) => e.alive && e.isBoss);
  assert.ok(leaders.length > 0, `${bossId}: the leader spawned`);
  return { b, leaders, spec };
}

for (const bossId of BOSSES) {
  test(`${bossId}: client field — a pool left with float dust means a dead leader at once and a 'cleared' field`, () => {
    const { b, spec } = bossBattle(bossId, null);
    const pool = b.sharedBoss;
    assert.ok(pool instanceof LocalBossPool, 'the browser pool');
    // the real stalled state: everything this field dealt is acknowledged, the server holds 3.6e-12
    pool.cum = spec.boss.poolMax;
    pool.byPlayer = { p_0: spec.boss.poolMax };
    pool.sync(STALL.serverHp, pool.cum);
    const leader = b.enemies.find((e) => e.alive && e.isBoss);
    b.dealDamage(null, leader, { amount: 5000, type: 'true' }); // an operator's hit
    for (let i = 0; i < 3 && !b.finished; i++) b.step();
    assert.equal(b.finished, true, `${bossId}: the field ended`);
    assert.equal(b.reason, 'cleared');
    assert.deepEqual(b.enemies.filter((e) => e.alive && e.isBoss).map((e) => e.defId), [], 'every copy of the leader is down');
    assert.equal(b.snapshot().boss.hp, 0);
  });

  test(`${bossId}: server field — the hit that would leave less than 1 HP kills the leader at once`, () => {
    const max = gd.boss(bossId).bloodPoint.HARD;
    const pool = new SharedBossPool(max);
    const { b } = bossBattle(bossId, pool);
    const leader = b.enemies.find((e) => e.alive && e.isBoss);
    // the team already dealt all but 250000 (one hit of the whole pool would be cancelled by 限伤, BOSS_HIT_LIMIT 300000)
    const rest = 250000;
    pool.damage('p_1', max - rest);
    const dealt = b.dealDamage(null, leader, { amount: 1e9, type: 'true', mul: (rest - 0.4) / 1e9 });
    assert.ok(dealt > rest - 1, `${bossId}: the hit took the rest of the pool (${dealt} of ${rest})`);
    assert.equal(pool.hp, 0, 'not 0.4 HP: nobody would ever see it and no hit may be needed to finish it');
    for (let i = 0; i < 3 && !b.finished; i++) b.step();
    assert.equal(b.finished, true);
    assert.equal(b.reason, 'cleared');
    assert.deepEqual(b.enemies.filter((e) => e.alive && e.isBoss).map((e) => e.defId), []);
  });
}
