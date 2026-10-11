// Official limits on the match side (docs/research/11-limits-official.md): bond layers stop at 999 per bond
// (shared/constants.js BOND_LAYER_CAP: PlayerState.addLayers, the settle of the in-battle gains, the client-result
// check, the invariants) and the boss-hit limit 限伤 (BOSS_HIT_LIMIT 300000) in a real Final Assault / Hidden Core with a
// 999-layer board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP, BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { validateClientResult } from '../../server/match/fields.js';
import { collectViolations } from '../../server/match/invariants.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeMatch, give, legalTileFor, DATA } from './harness.js';
import { planBoard, applyBoard, makeMatch as balanceMatch, withoutTuning } from '../../tools/balance.mjs';
import { buildNormalWave } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

/** A solo match (fake battles) at PREP R1 with an empty layer table; onLayers dispatches are recorded. */
function prepMatch(seed = 71, o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true, ...o }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.layers = {};
  ps.recompute();
  const onLayers = [];
  const dispatch = m.dispatch.bind(m);
  m.dispatch = (p, hook, ev, opts) => { if (hook === 'onLayers') onLayers.push({ ...ev }); return dispatch(p, hook, ev, opts); };
  return { h, m, ps, onLayers };
}

test('PlayerState.addLayers: a gain stops at 999; onLayers reports the clamped count; a gain at the cap adds 0 and dispatches nothing', () => {
  const { m, ps, onLayers } = prepMatch();
  assert.equal(ps.addLayers('yanShip', 1500), BOND_LAYER_CAP);
  assert.equal(ps.layers.yanShip, 999);
  assert.deepEqual(onLayers.map((e) => [e.bondId, e.from, e.to]), [['yanShip', 0, 999]]);
  assert.equal(ps.bonds.yanShip.layers, 999, 'the bond view shows the capped count');
  assert.equal(ps.addLayers('yanShip', 5), 0);
  assert.equal(onLayers.length, 1, 'no onLayers at the cap');
  // each bond on its own
  assert.equal(ps.addLayers('kjeragShip', 40), 40);
  assert.equal(ps.layers.kjeragShip, 40);
  ps.layers.lateranoShip = 996;
  assert.equal(ps.addLayers('lateranoShip', 10), 3);
  assert.equal(ps.layers.lateranoShip, 999);
  // what the client sees: m.private bonds and the public bond list
  const priv = ps.privateView();
  assert.equal(priv.bonds.find((b) => b.bondId === 'yanShip').layers, 999);
  assert.deepEqual(collectViolations(m), []);
  m.dispose();
});

test('a real prep 特质 at the cap: 烛煌 获得时 炎 / 维多利亚 +5 adds 2 to a 997-layer 炎 and 5 to 维多利亚', () => {
  const { m, ps, onLayers } = prepMatch(72);
  ps.layers.yanShip = 997;
  ps.recompute();
  ps.acquireChess('chess_char_5_03_a', { source: 'test' });
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.layers.victoriaShip, 5);
  assert.deepEqual(onLayers.filter((e) => e.bondId === 'yanShip').map((e) => [e.from, e.to]), [[997, 999]]);
  ps.acquireChess('chess_char_5_03_a', { source: 'test' });
  assert.equal(ps.layers.yanShip, 999, 'nothing more');
  assert.equal(ps.layers.victoriaShip, 10);
  assert.equal(onLayers.filter((e) => e.bondId === 'yanShip').length, 1);
  m.dispose();
});

test('settle: in-battle layer gains are clamped at 999 (once at the line, then nothing — no onLayers for a capped bond)', () => {
  const { h, m, ps, onLayers } = prepMatch(73, { script: (b) => (b.kind === 'normal' ? { duration: 1, layerGains: { p_0: { yanShip: 50, kjeragShip: 7 } } } : {}) });
  ps.layers.yanShip = 980;
  ps.recompute();
  onLayers.length = 0;
  h.toPrep(2);
  assert.equal(ps.layers.yanShip, 999, '980 + 50 → 999');
  assert.equal(ps.layers.kjeragShip, 7);
  assert.deepEqual(onLayers.filter((e) => e.reason === 'battle').map((e) => [e.bondId, e.from, e.to]), [['yanShip', 980, 999], ['kjeragShip', 0, 7]]);
  onLayers.length = 0;
  h.toPrep(3);
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.layers.kjeragShip, 14);
  assert.deepEqual(onLayers.filter((e) => e.reason === 'battle').map((e) => e.bondId), ['kjeragShip'], 'the capped bond dispatches nothing');
  h.invariants();
  m.dispose();
});

test('client-result check: a reported layer gain may not pass 999 from the bond\'s starting layers', () => {
  const { m } = prepMatch(74);
  const spec = {
    kind: 'normal', round: 5, timeLimit: 60, spawns: [], flags: { layerGainsEnabled: true },
    players: [{ playerId: 'p_0', units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 990 }, kjeragShip: { count: 2, active: true, tier: 1, layers: 0 } } }],
  };
  const res = (gains) => ({ reason: 'cleared', time: 10, perPlayer: { p_0: { killed: 0, total: 0, leaked: [], perfect: true, layerGains: gains, coins: 0, unitsEnd: [], unitStats: [] } } });
  const ok = validateClientResult(spec, res({ yanShip: 9, kjeragShip: 80 }), { gd: m.gd });
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(ok.result.perPlayer.p_0.layerGains, { yanShip: 9, kjeragShip: 80 });
  assert.deepEqual(validateClientResult(spec, res({ yanShip: 10 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, '990 + 10 > 999');
  assert.deepEqual(validateClientResult(spec, res({ kjeragShip: 81 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, 'the per-round bound 60 + 4·5 still holds');
  const capped = { ...spec, players: [{ ...spec.players[0], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 999 } } }] };
  assert.deepEqual(validateClientResult(capped, res({ yanShip: 1 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, 'a capped bond gains nothing');
  assert.equal(validateClientResult(capped, res({ yanShip: 0 }), { gd: m.gd }).ok, true);
  m.dispose();
});

test('invariants: a bond above 999 is a violation (no writer may pass the cap)', () => {
  const { m, ps } = prepMatch(75);
  ps.layers.yanShip = 1000;
  ps.recompute();
  assert.ok(collectViolations(m).some((v) => /yanShip layers 1000/.test(v)));
  ps.layers.yanShip = 999;
  ps.recompute();
  assert.deepEqual(collectViolations(m), []);
  m.dispose();
});

// ---- a real Final Assault (and Hidden Core) with a 999-layer board ----------------------------------------------

const YAN = ['chess_char_6_15_a', 'chess_char_5_12_a', 'chess_char_4_17_a', 'chess_char_3_03_a'];
/** Every enemy takes ×K damage — a stand-in for the 999-layer debuffs of a real board (谢拉格 ×11.34 vs cold / frozen,
 * 奥术 ×11.19 arts taken): with 炎 at 999 (ATK ×10.22) the hits land far past 300000. Once `relentAfter` leader hits
 * were cancelled the leaders lose the stand-in so the fight can finish. */
const K = 2000;
function limitBattleClass(log, relentAfter = 6) {
  return class extends Battle {
    constructor(opts) {
      const user = opts.setup;
      super({ ...opts, setup: (b) => {
        if (typeof user === 'function') user(b);
        if (b.kind !== 'boss' && b.kind !== 'hidden') return;
        const rec = { kind: b.kind, battle: b, caps: [], leaderHits: [], credits: [], relented: false };
        log.push(rec);
        const fx0 = b.fx.bind(b);
        b.fx = (k, p) => {
          if (k === 'hitCap') {
            rec.caps.push(p.n);
            if (!rec.relented && rec.caps.length >= relentAfter) {
              rec.relented = true;
              b.after(0, () => { for (const e of b.enemies) if (e.isBoss) b.removeBuff(e, 'test:999debuffs'); });
            }
          }
          return fx0(k, p);
        };
        b.on('enemySpawn', ({ enemy }) => { if (!(enemy.isBoss && rec.relented)) b.addBuff(enemy, { key: 'test:999debuffs', mods: { dmgTakenMul: K } }); });
        b.on('damaged', (c) => {
          if (!c.target || !c.target.isBoss || c.type === 'element') return;
          rec.leaderHits.push(c.amount);
        }, { priority: -1000 });
        if (b.sharedBoss) {
          const pool = b.sharedBoss;
          const dmg = pool.damage.bind(pool);
          pool.damage = (pid, amount) => { rec.credits.push(amount); return dmg(pid, amount); };
        }
      } });
    }
  };
}

test('Final Assault + Hidden Core with a 999-layer 炎 board (real sim, server-run): every leader hit of ≥ 300000 deals 0 and nothing of it reaches the pool; the hits under the line win', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 76, fake: true, captureFrames: false, script: (b) => (b.kind === 'normal' ? { duration: 1 } : {}) });
  const m = h.m;
  m.bossId = 'boss_6';       // 阿利斯泰尔 walks into the board
  m.hiddenBossId = 'boss_9'; // 假想敌：铳 (完全形态) with its three springs
  m.gd.bossHpMul = () => 0.1; // pools the 4-operator board clears once the stand-in debuff leaves the leaders
  h.start();
  h.toPrep(14);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  const used = new Set();
  for (const id of YAN) {
    const at = legalTileFor(m, ps, id, used);
    used.add(`${at[0]},${at[1]}`);
    give(m, ps, id, 'board', at);
  }
  const before = ps.layers.yanShip || 0;
  assert.equal(ps.addLayers('yanShip', 5000), 999 - before);
  assert.equal(ps.layers.yanShip, 999);
  ps.recompute();
  assert.ok(ps.bonds.yanShip.active, '炎 is active');
  ps.lp = 200;
  const log = [];
  m.BattleClass = limitBattleClass(log);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT || h.ended != null);
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);
  h.drive(() => h.ended != null, { maxSteps: 8e6 }); // the Final Assault, the Hidden Core's prep (999 activated layers > 350) and fight
  const end = h.ended;
  assert.ok(end, `the match ended (${m.phase} R${m.round})`);
  assert.ok(log.length >= 1, 'a real boss field ran');
  const fa = log[0];
  assert.equal(fa.kind, 'boss');
  const input = fa.battle.getPlayer('p_0');
  assert.equal(input.bonds.yanShip.layers, 999, 'the battle got the capped count');
  const op = fa.battle.allyUnits.find((u) => u.kind === 'op' && u.defId === YAN[0]);
  assert.ok(op, 'the operator fought');
  for (const rec of log) {
    assert.ok(rec.caps.length > 0, `${rec.kind}: hits past the line were cancelled (${rec.caps.length})`);
    assert.ok(rec.caps.every((n) => n >= BOSS_HIT_LIMIT));
    assert.ok(rec.leaderHits.every((a) => Math.ceil(a) < BOSS_HIT_LIMIT), `${rec.kind}: no leader hit of ≥ 300000 landed (max ${Math.max(0, ...rec.leaderHits)})`);
    assert.ok(rec.credits.every((a) => a < BOSS_HIT_LIMIT), `${rec.kind}: nothing ≥ 300000 reached the shared pool`);
    assert.ok(rec.leaderHits.length > 0, `${rec.kind}: hits under the line landed`);
    assert.equal(rec.battle.sharedBoss.hp, 0, `${rec.kind}: the pool was emptied by those`);
    assert.equal(rec.battle.reason, 'cleared');
  }
  assert.equal(end.victory, true, 'the board still won once its hits stayed under the line');
  assert.equal(m.errorCount, 0);
  m.dispose();
});

// ---- the dev tools write layers too: they stop at the cap like every gain ---------------------------------------

test('tools/balance.mjs applyBoard: any --profile keeps every bond ≤ 999 (the R14 core bond at ×20 sits at the cap)', () => {
  const m = balanceMatch({ data: withoutTuning(DATA), mode: 'coop', difficulty: 'HARD', seed: 9, players: 1, rehearsal: 0 });
  const r = 14;
  m.round = r;
  m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, r);
  const rng = createRng(314);
  const plan = planBoard(m, r, rng, { profile: 20 });
  const ps = m.order[0];
  applyBoard(m, ps, plan, r, rng, { profile: 20 });
  assert.ok(plan.core, 'a core bond');
  assert.equal(ps.layers[plan.core], BOND_LAYER_CAP, 'core curve 150 × 20 → 999');
  for (const [id, v] of Object.entries(ps.layers)) assert.ok(v > 0 && v <= BOND_LAYER_CAP, `${id} ${v}`);
  assert.deepEqual(collectViolations(m).filter((v) => /layers/.test(v)), []);
  m.dispose();
});

test('tools/matchrun.mjs --layers 2000 --check: the boost stops at 999 (no invariant violation through the Hidden Core)', () => {
  const tool = fileURLToPath(new URL('../../tools/matchrun.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [tool, '--mode', 'solo', '--difficulty', 'HARD', '--lp', '500', '--layers', '2000', '--check', '--rehearsal', '0', '--seed', '1'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr.slice(-2000));
  assert.match(r.stdout, /no violations/);
  assert.doesNotMatch(r.stdout, /layers \d{4}/);
});
