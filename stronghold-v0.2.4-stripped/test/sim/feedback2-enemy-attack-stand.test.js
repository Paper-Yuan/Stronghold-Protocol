// test/sim/feedback2-enemy-attack-stand.test.js — GitHub #58 「1.1中敌方远程攻击单位在攻击时任会移动」: an unblocked ranged enemy
// stands for each attack's clip — through its wind-up before the strike and the rest of the clip after it — and walks
// on between attacks (the owner's decision of 2026-10-04 from first-hand memory; the clip = data/enemies.json
// `attackAnim`, tools/build-data.mjs from the asset manifest; server/sim/ai.js attackStand). It used to stop only
// ATTACK_PAUSE (0.35 s) after each strike while the client played the attack clip over the whole walk. An enemy with no
// clip known keeps the old 0.35 s (test/sim/combat.test.js); a 「不停止移动」 attacker never stops; a stun cuts the stand.
// Since 0.2.0 (GitHub #187 / #170) every attack has its wind-up — the strike comes at the clip's damage frame after the
// swing starts, also the first one of an enemy whose cooldown ran out before it had a target (it used to strike at once)
// — and a stun before the frame cuts the swing (test/sim/feedback5-enemy-swing.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';
import { TICK, ATTACK_PAUSE } from '../../server/sim/constants.js';
import { attackStand } from '../../server/sim/ai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

/** Positions per tick and attack times of the first enemy, `seconds` long. */
function trace(h, seconds) {
  const log = [], atks = [];
  h.b.on('attack', (c) => { if (c.attacker.side === 'enemy') atks.push(h.b.time); });
  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    h.step();
    const e = h.enemies()[0];
    if (!e) break;
    log.push({ t: h.b.time, x: e.x, y: e.y, moving: e.moving });
  }
  return { log, atks };
}
/** Distance walked between game times t0 and t1 (ticks after t0 up to t1). */
function walked(log, t0, t1) {
  let d = 0;
  for (let i = 1; i < log.length; i++) if (log[i].t > t0 + 1e-9 && log[i].t <= t1 + 1e-9) d += Math.hypot(log[i].x - log[i - 1].x, log[i].y - log[i - 1].y);
  return d;
}

test('data: every enemy with a real attack clip carries it as attackAnim (the clip the client plays, its length and strike frame)', () => {
  const enemies = readJson('data/enemies.json'), assets = readJson('data/assets.json');
  let n = 0;
  for (const [k, e] of Object.entries(enemies)) {
    const sp = assets.enemies[e.spine || k]?.spine;
    const a = sp?.anims?.attack;
    const real = !!a && typeof a.loop === 'string' && a.via !== 'idle' && sp.animations[a.loop] > 0;
    assert.equal(!!e.attackAnim, real, `${k} ${e.name}`);
    if (!real) continue;
    n++;
    assert.equal(e.attackAnim.clip, a.loop, k);
    assert.equal(e.attackAnim.dur, sp.animations[a.loop], k);
    const h = sp.hits?.[a.loop];
    if (Array.isArray(h) && h.length) assert.equal(e.attackAnim.hit, h[0], k);
    assert.equal(e.attackMoves, undefined, `${k}: no enemy of the mode attacks on the move`);
  }
  assert.ok(n > 200, `${n} enemies`);
  // the ranged attackers of the report
  assert.deepEqual(enemies.enemy_1019_jshoot.attackAnim, { clip: 'Attack', dur: 1, hit: 0.533 });
  assert.deepEqual(enemies.enemy_1168_dumage.attackAnim, { clip: 'Attack', dur: 1.2, hit: 0.633 });
});

test('隐形弩手 with an operator in range stands for its 1.0 s Attack clip at every attack (0.533 s wind-up + 0.467 s), then walks', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_3_01_a', row: 10, col: 6, dir: 'RIGHT' }], enemies: [{ key: 'enemy_1019_jshoot', time: 0, route: 0 }],
    seed: 3, timeLimit: 40, autoFinish: false, hooks: ['attack'] });
  const { log, atks } = trace(h, 16);
  assert.ok(atks.length >= 4, `${atks.length} attacks`);
  const e = h.enemy('enemy_1019_jshoot');
  const iv = e.s.interval;
  assert.ok(Math.abs(iv - 2.7) < 1e-9);
  for (const t of atks.slice(1, 3)) {
    // the wind-up (the strike frame at 0.533 s of the clip) and the rest of the clip: no step
    assert.equal(walked(log, t - 0.533 + 2 * TICK, t), 0, `stands through the wind-up before the attack at ${t.toFixed(2)}`);
    assert.equal(walked(log, t, t + 0.467 - TICK), 0, `stands for the rest of the clip after ${t.toFixed(2)}`);
    assert.ok(!log.find((r) => Math.abs(r.t - (t + 0.3)) < TICK / 2).moving, 'drawn standing (not on the move clip)');
    // then it walks until the next wind-up: 2.7 − 1.0 = 1.7 s at 0.9 × 0.5 tiles/s
    const d = walked(log, t + 0.467 + 2 * TICK, t + iv - 0.533 - TICK);
    assert.ok(d > 0.6 && d < 0.8, `walks between the attacks (${d.toFixed(2)} tiles)`);
  }
});

test('the stand shortens with the clip when the attacks come quicker than the clip: an enemy attacking every 1 s with a 2 s clip never walks while it has a target', () => {
  const quick = { ...enemyRec({ key: 'enemy_quick', hp: 1e9, atk: 1, range: 2.5, bat: 1, speed: 1 }), attackAnim: { clip: 'Attack', dur: 2, hit: 1 } };
  const st = attackStand({ def: { attackAnim: { dur: 2, hit: 1 } }, s: { interval: 1 }, profile: {} });
  assert.deepEqual(st, { wind: 0.5, rest: 0.5 });
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 1e9, atk: 0 } }) }, enemies: { enemy_quick: quick } },
    units: [{ chessId: 't_a', row: 10, col: 6 }], enemies: [{ key: 'enemy_quick', pos: [9, 8] }], content: 'none', autoFinish: false, timeLimit: 60, hooks: ['attack'],
  });
  const { log, atks } = trace(h, 6);
  assert.ok(atks.length >= 5, `${atks.length} attacks`);
  assert.equal(walked(log, atks[0], atks.at(-1)), 0, 'stands from the first attack on');
});

test('a 「不停止移动」 attacker (attackMoves) keeps walking through its attacks', () => {
  const rec = (attackMoves) => ({ ...enemyRec({ key: 'enemy_mover', hp: 1e9, atk: 1, range: 2.5, bat: 2, speed: 1 }), attackAnim: { clip: 'Attack', dur: 1.5, hit: 0.5 }, ...(attackMoves ? { attackMoves: true } : {}) });
  const run = (attackMoves) => {
    const h = makeBattle({
      defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 1e9, atk: 0 } }) }, enemies: { enemy_mover: rec(attackMoves) } },
      units: [{ chessId: 't_a', row: 10, col: 6 }], enemies: [{ key: 'enemy_mover', time: 0, route: 0 }], content: 'none', autoFinish: false, timeLimit: 60, hooks: ['attack'],
    });
    return trace(h, 12);
  };
  const moving = run(true), standing = run(false);
  assert.ok(moving.atks.length >= 3 && standing.atks.length >= 3);
  for (const t of moving.atks.slice(0, 3)) assert.ok(walked(moving.log, t - 0.5, t + 1) > 0.6, `walks through the attack at ${t.toFixed(2)}`);
  // (since 0.2.0 the first attack too: its cooldown long over as the target comes into range, it swings from the start —
  // the whole 0.5 s wind-up stood before the strike)
  for (const t of standing.atks.slice(0, 3)) assert.equal(walked(standing.log, t - 0.5 + 2 * TICK, t + 1 - TICK), 0, 'the same enemy without it stands');
});

test('no attack clip known: ATTACK_PAUSE after the strike and no wind-up stand; a stun cuts a stand short', () => {
  assert.deepEqual(attackStand({ def: {}, s: { interval: 2 }, profile: {} }), { wind: 0, rest: ATTACK_PAUSE });
  assert.deepEqual(attackStand({ def: { attackMoves: true, attackAnim: { dur: 2, hit: 1 } }, s: { interval: 2 }, profile: {} }), { wind: 0, rest: 0 });
  const slow = { ...enemyRec({ key: 'enemy_slow', hp: 1e9, atk: 1, range: 2.5, bat: 5, speed: 1 }), attackAnim: { clip: 'Attack', dur: 3, hit: 0.5 } };
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 1e9, atk: 0 } }) }, enemies: { enemy_slow: slow } },
    units: [{ chessId: 't_a', row: 10, col: 6 }], enemies: [{ key: 'enemy_slow', pos: [9, 8] }], content: 'none', autoFinish: false, timeLimit: 60, hooks: ['attack'],
  });
  h.step();
  const e = h.enemy('enemy_slow');
  // (0.2.0: a target in range at once, its cooldown over — it swings at once and strikes at the 0.5 s damage frame; it
  // used to strike in the first tick)
  assert.equal(e.lastAttackAt, -Infinity, 'swinging, not struck yet');
  h.runUntil(() => e.lastAttackAt >= 0, 2);
  assert.ok(Math.abs(e.lastAttackAt - (TICK + 0.5)) < TICK + 1e-6, `struck at the damage frame (${e.lastAttackAt.toFixed(3)})`);
  h.step();
  assert.ok(Math.abs(e.atkStandUntil - (e.lastAttackAt + 2.5)) < 1e-6, 'stands the 2.5 s after the strike');
  h.run(0.5);
  const x0 = e.x;
  h.b.applyStatus(e, 'stun', { duration: 0.5 });
  h.run(0.6);
  assert.equal(e.atkStandUntil, -Infinity, 'the stun ended the stand');
  h.run(0.3);
  assert.notEqual(e.x, x0, 'walks once the stun is over');
});

// review: a stand holds only the walking — a route's WAIT keeps running and DISAPPEAR / APPEAR still happen
// (data/waves.json has 122 WAIT and 99 DISAPPEAR checkpoints); it used to hold every leg, so a wait ran long by each
// clip and never ended for an enemy attacking quicker than its clip
function routeField(key, bat, dur, checkpoints, ally) {
  const rec = { ...enemyRec({ key, hp: 1e9, atk: 1, range: 3, bat, speed: 1 }), attackAnim: { clip: 'Attack', dur, hit: dur / 2 } };
  return makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 1e9, atk: 0, def: 1e6 } }) }, enemies: { [key]: rec } },
    units: ally ? [{ chessId: 't_a', row: 10, col: 7 }] : [], routes: [{ motion: 'WALK', start: [9, 8], end: [9, 2], checkpoints }],
    enemies: [{ key, time: 0, route: 0 }], content: 'none', autoFinish: false, timeLimit: 60, hooks: ['attack'],
  });
}

test('a ranged enemy with a target in range on a WAIT checkpoint leaves when the wait (and its current clip) is over, as without a target', () => {
  const leaves = (bat, dur, ally) => {
    const h = routeField('enemy_waiter', bat, dur, [{ type: 'WAIT', time: 3 }], ally);
    let waited = null, moved = null, x0 = null;
    for (let i = 0; i < Math.round(8 / TICK); i++) {
      h.step();
      const e = h.enemies()[0];
      x0 ??= e.x;
      if (waited == null && e.route.legIdx >= 1) waited = h.b.time;
      if (moved == null && Math.abs(e.x - x0) > 1e-6) moved = h.b.time;
    }
    return { waited, moved, attacks: h.hooksOf('attack').length };
  };
  const free = leaves(2.7, 1, false), sniper = leaves(2.7, 1, true), quick = leaves(1, 2, true);
  assert.equal(free.attacks, 0);
  assert.ok(sniper.attacks >= 2 && quick.attacks >= 5);
  assert.ok(Math.abs(sniper.waited - free.waited) < 1e-9 && Math.abs(quick.waited - free.waited) < 1e-9, `the wait ends at ${free.waited.toFixed(2)} s for all three`);
  // it walks on once the attack clip running at the end of the wait is over (since 0.2.0 the first strike at its 0.5 s
  // damage frame, the next one 2.7 s later at 3.2 s: its clip until 3.7 s; it used to strike at once — until 3.2 s)
  assert.ok(sniper.moved > free.moved && sniper.moved <= 3.7 + 2 * TICK, `leaves at ${sniper.moved?.toFixed(2)} s (no target: ${free.moved.toFixed(2)} s)`);
  assert.equal(quick.moved, null, 'an enemy attacking quicker than its clip stands while the target stays in range');
});

test('DISAPPEAR / APPEAR legs proceed while an enemy stands for its attacks; leaving the field ends the stand', () => {
  const h = routeField('enemy_ghost', 1, 2, [{ type: 'WAIT', time: 1 }, { type: 'DISAPPEAR' }, { type: 'WAIT', time: 1 }, { type: 'APPEAR', pos: [9, 4] }], true);
  let hiddenAt = null, appeared = null;
  for (let i = 0; i < Math.round(4 / TICK); i++) {
    h.step();
    const e = h.enemies()[0];
    if (hiddenAt == null && e.hidden) { hiddenAt = h.b.time; assert.equal(e.atkStandUntil, -Infinity, 'no stand left once hidden'); }
    if (appeared == null && hiddenAt != null && !e.hidden) appeared = { t: h.b.time, x: e.x, y: e.y };
  }
  assert.ok(h.hooksOf('attack').length >= 1, 'it attacked before leaving');
  assert.ok(hiddenAt != null && Math.abs(hiddenAt - 1) < 2 * TICK, `disappears after its 1 s wait (${hiddenAt})`);
  assert.ok(appeared && Math.abs(appeared.t - 2) < 2 * TICK && Math.abs(appeared.x - 4) < 0.05 && appeared.y === 9, `appears on (9,4) 1 s later (${JSON.stringify(appeared)})`);
});
