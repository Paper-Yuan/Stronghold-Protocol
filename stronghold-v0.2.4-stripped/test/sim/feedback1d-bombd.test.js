// test/sim/feedback1d-bombd.test.js — community report D4 after 0.1.0 ("敌方无人机暴鸰的炸弹无法正常投放"). 暴鸰
// (enemy_1040_bombd, only from the 悬赏·飞行II / 战术特训·飞行II bounties) did trigger its one bomb, but the damage and the
// blast hit the operator in the very tick of the trigger while the drone flew on with the bomb still hanging under it
// for the rest of its life: nothing ever left the drone. Official (PRTS 暴鸰; the client's battle prefab
// enemy_1040_bombd + projectile_bombd): the cast plays the Attack clip, the bomb leaves on its OnAttack event (0.267 s,
// `_waitForAttackEvent`), flies to the target as a projectile (`_speed` 5, homing, `_ignoreCamouflage`) and explodes
// there on the target and the 8 tiles around it; the cast ends once the bomb has landed, at least 0.667 s after the
// release (`_fireAttackFinishWhenProjectileInvalid`, `_minPostDelayWhenProjectileInvalid`), with the bomb-less Idle_2 as
// its end clip, and its buff bomb_s switches the drone to its bomb-less mode (S1: the *_2 clips) at ×2 speed
// ("技能结束后移速最终提升至200%"). Now (content/enemies.js kitBombd): the drone hovers through the cast; 'atk' kind
// 'droneBomb' + fx 'phase' { kind: 'bombed' } at the release (the view starts the *_2 clips after the Attack clip),
// damage on arrival, the speed-up when the cast ends; a stun before the release interrupts the cast (Boomb
// `_immuneStunWhenAffecting` 0: no bomb leaves a stunned drone; it casts again once free). Also UnitInfo.form for
// 掠海漂移体's crawl.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor, chessOfTier, DATA } from '../match/harness.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { PROJECTILE_SPEEDS, TICK } from '../../server/sim/constants.js';

const KEY = 'enemy_1040_bombd';
const RELEASE = enemiesMod.BOMBD_RELEASE;
const POST = enemiesMod.BOMBD_POST_DELAY;
const ability = (e) => e.mem.ab.list.find((a) => a && a.fire);

/** A real round: solo 绝境 match, real stage and wave, seven real operators, the 悬赏·飞行II bounty (one 暴鸰). */
function realRound(seed = 3, round = 4) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed, fake: false });
  h.start();
  h.toPrep(round);
  const m = h.m, ps = h.ps('p_0');
  let placed = 0;
  for (const id of [...chessOfTier(1), ...chessOfTier(2)]) {
    if (placed >= 7) break;
    const t = legalTileFor(m, ps, id);
    if (!t) continue;
    give(m, ps, id, 'board', t);
    placed++;
  }
  m.addBounty(ps, DATA.choices.cards.bounty.find((c) => c.effectId === 'enemyeffect_10_5'));
  const opts = m._normalOpts(ps);
  assert.ok(opts.spawns.some((s) => s.enemyKey === KEY), 'the bounty adds a 暴鸰 to the real wave');
  return { h, m, b: m.newBattle(opts) };
}

describe('D4 暴鸰: the bomb leaves the drone and lands', () => {
  test('real wave: trigger (hover) → release on the OnAttack frame (atk droneBomb, bomb-less mode) → damage on arrival → cast end: ×2 speed', () => {
    const { m, b } = realRound();
    const log = [];
    let drone = null, castAt = null, hitAt = null, firstHit = null, castPos = null, endPos = null, runAt = null, prev = null;
    const hits = [];
    b.on('damaged', (c) => {
      if (c.source !== drone || !drone) return;
      hits.push({ t: b.time, target: c.target, amount: c.amount ?? c.dmg?.amount, splash: (c.dmg?.tags || []).includes('splash') });
      if (hitAt == null) { hitAt = b.time; firstHit = c.target; }
    });
    while (!b.finished && b.time < 200) {
      prev = drone ? { x: drone.x, y: drone.y } : null;   // where it is when the next tick starts
      b.step();
      if (!drone) drone = b.enemies.find((x) => x.defId === KEY) || null;
      if (drone && castAt == null && (ability(drone)?.casts ?? 0) > 0) {
        castAt = b.time;
        castPos = { x: drone.x, y: drone.y };
        assert.equal(hits.length, 0, 'nothing is hit in the tick of the trigger');
      }
      for (const ev of b.drainEvents()) if (drone && ((ev[0] === 'atk' && ev[1] === drone.id) || (ev[0] === 'fx' && ev[4]?.id === drone.id))) log.push([b.time, ev]);
      if (castAt != null && runAt == null && drone.findBuff('ab:bombRun')) { runAt = b.time; endPos = prev; }
      if (runAt != null && b.time > runAt + 1) break;
      if (castAt != null && b.time > castAt + 5) break;
    }
    assert.ok(drone, 'the drone spawned');
    assert.ok(castAt != null, 'it triggered its bomb near the operators');
    const atk = log.filter(([, ev]) => ev[0] === 'atk');
    assert.equal(atk.length, 1, 'exactly one drop (and never a normal attack)');
    const [relT, relEv] = atk[0];
    assert.equal(relEv[3], 'droneBomb', 'drawn as the drone\'s bomb');
    assert.ok(Math.abs(relT - castAt - RELEASE) < 1e-6, `released ${(relT - castAt).toFixed(3)} s after the trigger (OnAttack, frame 8 of the Attack clip)`);
    const phase = log.find(([, ev]) => ev[0] === 'fx' && ev[1] === 'phase');
    assert.ok(phase && phase[1][4].kind === 'bombed' && Math.abs(phase[0] - relT) < 1e-9, 'the bomb has left the drone: its bomb-less mode from the release');
    if (drone.alive) assert.equal(b.fieldMeta().units.find((u) => u.id === drone.id).form, 'bombed', 'a field opened later draws it bomb-less');
    assert.ok(hitAt != null, 'the bomb lands');
    assert.equal(firstHit.id, relEv[2], 'on the operator it was dropped on');
    assert.ok(hitAt - relT > TICK, `then flies (${(hitAt - relT).toFixed(3)} s at ${PROJECTILE_SPEEDS.droneBomb} tiles/s)`);
    assert.ok(hitAt - relT < 1.2, 'and lands promptly');
    const main = hits.filter((x) => !x.splash);
    assert.equal(main.length, 1, 'one main hit');
    for (const x of hits.filter((y) => y.splash)) {
      assert.ok(Math.max(Math.abs(x.target.tileR - firstHit.tileR), Math.abs(x.target.tileC - firstHit.tileC)) <= 1, 'splash only on the 8 tiles around the target');
    }
    assert.ok(drone.alive, 'the drone outlives its cast in this round');
    const run = drone.findBuff('ab:bombRun');
    assert.equal(run?.mods?.moveMul, DATA.enemies[KEY].skills[0].bb.move_speed, '技能结束后移速最终提升至200%');
    const castEnd = Math.max(hitAt, relT + POST);
    assert.ok(Math.abs(runAt - castEnd) <= TICK + 1e-9, `when the cast ends (${(runAt - castAt).toFixed(3)} s after the trigger; landed ${(hitAt - castAt).toFixed(3)})`);
    assert.ok(Math.hypot(endPos.x - castPos.x, endPos.y - castPos.y) < 1e-9, 'hovering in place through the cast (its Attack clip)');
    assert.ok(Math.hypot(drone.x - endPos.x, drone.y - endPos.y) > 0.5, 'then flies on');
    assert.equal(drone.stats.attacks, 0, 'no normal attack');
    m.dispose();
  });

  const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const arena = (units) => makeBattle({
    content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { t_a: WALL('t_a'), t_b: WALL('t_b'), t_c: WALL('t_c') } },
    kits: { t_a: () => ({ trait: { noAttack: true } }), t_b: () => ({ trait: { noAttack: true } }), t_c: () => ({ trait: { noAttack: true } }) },
    units,
  });
  const put = (h, pos) => h.spawn(KEY, { pos, routeIndex: 0, mods: { speedMul: 0 }, route: 2 });

  test('a target gone mid-flight: the bomb still lands where it was and splashes its neighbours', () => {
    const h = arena([{ chessId: 't_a', row: 10, col: 5 }, { chessId: 't_b', row: 11, col: 5 }]);
    h.step();
    const e = put(h, [10, 7]);
    const [a, bb] = [h.unit('t_a'), h.unit('t_b')];
    h.runUntil(() => (ability(e)?.casts ?? 0) > 0, 5);
    h.run(RELEASE + TICK);
    const rel = h.eventsOf('atk').find((ev) => ev[1] === e.id);
    assert.ok(rel, 'released');
    const tgt = [a, bb].find((u) => u.id === rel[2]);
    const other = tgt === a ? bb : a;
    h.b.retreat(tgt, { reason: 'test', permanent: true });
    h.run(1.5);
    assert.equal(tgt.stats.taken, 0, 'the withdrawn target is not hit');
    assert.ok(other.stats.taken > 0, 'its neighbour takes the splash at the landing point');
  });

  test('the drone killed after the release: the bomb in the air still lands (projectile_bombd keeps flying)', () => {
    const h = arena([{ chessId: 't_a', row: 10, col: 5 }]);
    h.step();
    const e = put(h, [10, 7]);
    h.runUntil(() => (ability(e)?.casts ?? 0) > 0, 5);
    h.run(RELEASE + TICK);
    assert.ok(h.eventsOf('atk').some((ev) => ev[1] === e.id), 'released');
    h.b.kill(e, null);
    h.run(1.5);
    assert.ok(Math.abs(h.unit('t_a').stats.taken - e.s.atk) < 1e-6, 'hit for the ATK it had at the release');
    assert.ok(!e.findBuff('ab:bombRun'), 'a dead drone gets no speed-up');
  });

  test('a stun before the release interrupts the cast: nothing leaves the drone; it casts again once free and drops its one bomb', () => {
    const h = arena([{ chessId: 't_a', row: 10, col: 6 }]);
    h.step();
    const e = put(h, [10, 7]);
    h.runUntil(() => (ability(e)?.casts ?? 0) > 0, 5);
    const castAt = h.b.time;
    assert.ok(h.b.applyStatus(e, 'stun', { duration: 1.5, source: null }), 'stunned mid-cast');
    h.run(1.4);
    const drops = () => h.events.filter((ev) => ev[0] === 'atk' && ev[1] === e.id);
    assert.equal(drops().length, 0, 'no drop from a stunned drone (Boomb `_immuneStunWhenAffecting` 0)');
    assert.ok(!h.events.some((ev) => ev[0] === 'fx' && ev[1] === 'phase' && ev[4]?.id === e.id), 'it keeps its bomb');
    assert.equal(h.unit('t_a').stats.taken, 0);
    assert.ok(!e.findBuff('ab:bombRun'), 'no speed-up');
    h.runUntil(() => drops().length > 0, 3);
    assert.equal(ability(e).casts, 2, 'cast again once the stun is over');
    assert.ok(h.b.time >= castAt + 1.5 + RELEASE - 1e-6, 'after the stun');
    h.run(2);
    assert.equal(drops().length, 1, 'still one bomb in all');
    assert.ok(Math.abs(h.unit('t_a').stats.taken - e.s.atk) < 1e-6, 'and it lands');
    assert.ok(e.findBuff('ab:bombRun'), 'then the speed-up');
  });

  test('the drone killed before the release: no bomb, no mode change', () => {
    const h = arena([{ chessId: 't_a', row: 10, col: 6 }]);
    h.step();
    const e = put(h, [10, 7]);
    h.runUntil(() => (ability(e)?.casts ?? 0) > 0, 5);
    h.b.kill(e, null);
    h.run(2);
    assert.equal(h.unit('t_a').stats.taken, 0);
    assert.ok(!h.events.some((ev) => ev[0] === 'atk' && ev[1] === e.id), 'no drop');
    assert.ok(!h.events.some((ev) => ev[0] === 'fx' && ev[1] === 'phase' && ev[4]?.id === e.id), 'no bomb-less mode');
  });
});

describe('UnitInfo.form: every mode the renderer draws is recorded (a field opened later)', () => {
  test('掠海漂移体 stunned → 爬行模式: UnitInfo.form \'crawl\' (render/units.js FORMS starts a later view on the *_02 clips)', () => {
    const h = makeBattle({ content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 60, captureNoisy: true,
      defs: { chess: { t_a: chessRec({ id: 't_a', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null }) } },
      kits: { t_a: () => ({ trait: { noAttack: true } }) }, units: [{ chessId: 't_a', row: 10, col: 3 }] });
    h.step();
    const e = h.spawn('enemy_2025_syufo', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0, atkMul: 0 } });
    const form = () => h.b.fieldMeta().units.find((u) => u.id === e.id)?.form;
    assert.equal(form(), undefined, 'hovering');
    assert.ok(h.b.applyStatus(e, 'stun', { duration: 0.2, source: null }));
    h.step();
    assert.ok(h.events.some((ev) => ev[0] === 'fx' && ev[1] === 'phase' && ev[4]?.kind === 'crawl'), 'it dropped');
    assert.equal(form(), 'crawl');
  });
});
