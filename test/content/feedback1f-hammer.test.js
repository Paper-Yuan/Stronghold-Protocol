// Player report F1 after 0.1.0 (2026-10-03): "维多利亚坚固锤子的锁血没生效" — 坚固维式重锤 (chess_item_3_09_e_a / _b):
// "首次受到致命伤害时生命值不低于1，持续8秒" (activity_table act2autochess eff_acarm043 / eff_acgarm043, blackboard
// undeadable_duration 8; PRTS 卫戍协议：盟约 下半/PRTS盟约记录 备注 "持有不死" — 异常效果 不死 UNDEADABLE "重设常规生命值时不会
// 使其低于1"). The lock itself works for every kind of lethal damage (pinned here on synthetic and real operators). One
// ordering fault is fixed: with M3茧甲 equipped before the hammer, its revive ran first at the same priority and the first
// lethal hit showed no lock. PRTS (same page, M3茧甲 / 埃芒加德 / 阿戈尔 备注): "“复活”的实现方式为：受益者因移动之外的原因退场时
// 下次部署的再部署时间和费用归零" — a revive acts on a knock-out (退场), which a 不死 prevents, so the lock always comes first
// (items/battle.js PRIO_RESPAWN). The scope is one lock per DEPLOYMENT (the user's decision, 2026-10-03: "每次部署一次"):
// until then a redeployed carrier had none, the likeliest reading of the report. The lock belongs to the deployment,
// not to the grant (QA after the integration: a hammer lent by 萨尔贡 × 娜仁图亚 came back spent, and its window ended
// with the lend), and an in-place 复活 (M3茧甲, 埃芒加德) is a new deployment — PRTS's 复活 is a 0-time / 0-cost
// redeploy [ASSUMED]. Pinned too: the 阿戈尔 battle-start devour spends the lock of the first deployment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { PRIO_REVIVE, PRIO_RESPAWN, holdsUndying, lendItemEffects, itemGrants } from '../../server/sim/content/items/battle.js';
import { PRIO_BAND_REVIVE } from '../../server/sim/content/bands/battle.js';

const HAMMER = 'chess_item_3_09_e_a';
const HAMMER_B = 'chess_item_3_09_e_b';
const M3 = 'chess_item_4_12_e_a';
const SOLVENT = 'chess_item_1_05_e_a';

/** Synthetic operator: 2000 HP, 500 ATK, 200 DEF, 1 s attacks, 20 s redeploy. */
const op = (id) => chessRec({
  id, profession: 'WARRIOR', bonds: [], tier: 1, rangeGrid: [[0, 0], [0, 1]],
  stats: { maxHp: 2000, atk: 500, def: 200, res: 10, aspd: 100, bat: 1, respawnTime: 20, spRecovery: 1, blockCnt: 2 },
  skill: { spCost: 60, duration: 5, initSp: 0 },
});

/** One synthetic carrier at (10, 4) with `items` and a harmless static dummy at (10, 9). */
function carrier(items) {
  const h = makeBattle({
    defs: { chess: { t_op: op('t_op') }, enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: 't_op', row: 10, col: 4, items }],
    enemies: [{ key: 'e_d', pos: [10, 9] }], timeLimit: 999, autoFinish: false,
  });
  h.step(1);
  return { h, u: h.unit('t_op'), e: h.b.enemies.find((x) => x.alive) };
}

/** fx events of `kind` on `u` (the hammer's lock: 'undying'; M3茧甲: 'revive'). */
function fxLog(h, u) {
  const log = [];
  const fx0 = h.b.fx.bind(h.b);
  h.b.fx = (kind, p) => { if (p && p.id === u.id) log.push([kind, Math.round(h.b.time * 100) / 100, p.src ?? null]); return fx0(kind, p); };
  return log;
}

test('F1 坚固维式重锤: every kind of lethal damage is held at ≥ 1 HP for 8 s (hit, burst, 流失, 无来源, own drain)', () => {
  const kinds = {
    phys: ({ h, u, e }) => h.b.dealDamage(e, u, { amount: 1e7, type: 'phys', canDodge: false }),
    arts: ({ h, u, e }) => h.b.dealDamage(e, u, { amount: 1e7, type: 'arts', canDodge: false }),
    true: ({ h, u, e }) => h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false }),
    sourceless: ({ h, u, e }) => h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false, sourceless: true }),
    // a full 神经 gauge bursts on the carrier: stun, then 1000 无来源 true damage (sim/constants.js ELEMENT)
    burst: ({ h, u, e }) => { u.hp = 5; h.b.dealDamage(e, u, { type: 'element', element: 'neural', amount: 5000 }); },
    hpLoss: ({ h, u, e }) => h.b.loseHp(u, 1e7, { source: e }),
    hpLossSourceless: ({ h, u, e }) => h.b.loseHp(u, 1e7, { source: e, sourceless: true }),
  };
  for (const [name, hit] of Object.entries(kinds)) {
    for (const id of [HAMMER, HAMMER_B]) {
      const c = carrier([id]);
      const log = fxLog(c.h, c.u);
      hit(c);
      assert.ok(c.u.alive && c.u.hp >= 1, `${name} ${id}: the first lethal ${name} leaves ≥ 1 HP`);
      assert.deepEqual(log.filter((x) => x[0] === 'undying').map((x) => x[2]), ['item:hammer'], `${name}: the hammer's lock`);
      c.h.run(7.8);
      for (let i = 0; i < 3; i++) c.h.b.dealDamage(c.e, c.u, { amount: 1e7, type: 'true', canDodge: false });
      assert.ok(c.u.alive && c.u.hp >= 1, `${name} ${id}: still held inside the 8 s`);
      c.h.run(0.4);
      c.h.b.dealDamage(c.e, c.u, { amount: 1e7, type: 'true', canDodge: false });
      assert.equal(c.u.alive, false, `${name} ${id}: knocked out after the 8 s`);
    }
  }
});

test('F1 坚固维式重锤: the carrier\'s own 源石溶剂 drain cannot finish it inside the lock', () => {
  const c = carrier([HAMMER, SOLVENT]);
  c.u.hp = 1;
  c.h.run(1.05); // the drain's first tick (60 per second) is lethal at 1 HP
  assert.ok(c.u.alive && c.u.hp >= 1, 'held by the lock');
  c.h.run(6.5);
  assert.ok(c.u.alive, 'every drain tick inside the 8 s is held');
  c.h.run(2.5);
  assert.equal(c.u.alive, false, 'the first tick after the 8 s knocks it out');
});

// Scope: once per deployment (the user's first-hand memory of the official mode, 2026-10-03: "每次部署一次"; the text
// says only 首次). Before, a carrier knocked out after its lock came back without one — the likeliest reading of
// "锁血没生效" (forced-hammer bot matches, 3 绝境 + 4 困难: 27 of 382 carrier knock-outs came in a later deployment with
// the lock spent).
test('F1 坚固维式重锤: one lock per deployment — the redeploy after a knock-out re-arms it; a new battle too', () => {
  const c = carrier([HAMMER]);
  const log = fxLog(c.h, c.u);
  const hit = () => c.h.b.dealDamage(c.e, c.u, { amount: 1e7, type: 'true', canDodge: false });
  hit();
  assert.ok(c.u.alive);
  c.h.run(8.2);
  hit();
  assert.equal(c.u.alive, false, 'knocked out after the window');
  c.h.runUntil(() => c.u.alive, 60);
  assert.ok(c.u.alive, 'redeployed');
  hit();
  assert.ok(c.u.alive && c.u.hp >= 1 && c.u.hp < 2, 'the second deployment locks again');
  assert.equal(log.filter((x) => x[0] === 'undying').length, 2, 'two locks, one per deployment');
  c.h.run(7.8);
  hit();
  assert.ok(c.u.alive, 'held for the whole 8 s of the second lock');
  c.h.run(0.4);
  hit();
  assert.equal(c.u.alive, false, 'and only once in that deployment');
  const next = carrier([HAMMER]);
  next.h.b.dealDamage(next.e, next.u, { amount: 1e7, type: 'true', canDodge: false });
  assert.ok(next.u.alive && next.u.hp >= 1, 'the next battle locks again');
});

test('F1 坚固维式重锤: a retreat + redeploy (a 突袭 jump) is a new deployment — fresh lock, the old window ends', () => {
  const c = carrier([HAMMER]);
  const hit = () => c.h.b.dealDamage(c.e, c.u, { amount: 1e7, type: 'true', canDodge: false });
  hit();
  assert.ok(c.u.alive && holdsUndying(c.h.b, c.u), 'lock running');
  c.h.run(2);
  c.h.b.retreat(c.u, { reason: 'raid' });
  assert.ok(c.h.b.redeploy(c.u, { free: true, tile: [10, 5], keepSp: true }), 'redeployed one tile on');
  assert.ok(!holdsUndying(c.h.b, c.u), 'the first deployment\'s window ended with it');
  c.h.run(1);
  hit();
  assert.ok(c.u.alive && c.u.hp >= 1 && c.u.hp < 2, 'the new deployment has its own lock');
  c.h.run(8.2);
  hit();
  assert.equal(c.u.alive, false, 'used up for this deployment');
});

// The other way a lock is gone before the enemies hit: the 阿戈尔 battle-start devour ("吞噬身前一格干员对其造成5000点物理
// 伤害") is a lethal hit on the fodder, so a hammer carrier in front of an 阿戈尔 survives it at 1 HP and spends the lock
// of its first deployment at t = 0 (in forced-hammer 绝境 bot matches 10 of 179 locks went this way). Kept: the text calls
// it damage and 异常效果 不死 holds any HP reset at 1 [ASSUMED that the official engine does the same].
test('F1 坚固维式重锤 in front of an 阿戈尔: the battle-start devour spends the lock (fodder kept at 1 HP for 8 s)', () => {
  const g = (id) => chessRec({ id, bonds: ['egirShip'], profession: 'WARRIOR', skill: null, stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2 } });
  const h = makeBattle({
    defs: { chess: { g1_a: g('g1_a'), g2_a: g('g2_a'), g3_a: g('g3_a'), t_op: op('t_op') }, enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: 'g1_a', row: 10, col: 3 }, { chessId: 't_op', row: 10, col: 4, items: [HAMMER] }, { chessId: 'g2_a', row: 12, col: 3 }, { chessId: 'g3_a', row: 12, col: 5 }],
    bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 0 } },
    enemies: [{ key: 'e_d', pos: [9, 9] }], timeLimit: 999, autoFinish: false,
  });
  const u = h.unit('t_op');
  const log = fxLog(h, u);
  h.step(1);
  assert.ok(u.alive && u.hp >= 1 && u.hp < 2, 'devoured (5000 > 2000 HP) but held at 1 HP');
  assert.deepEqual(log.filter((x) => x[0] === 'undying').map((x) => [x[1], x[2]]), [[0, 'item:hammer']], 'the lock fired at t = 0');
  const e = h.b.enemies.find((x) => x.alive);
  h.run(8.2);
  h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false });
  assert.equal(u.alive, false, 'the first enemy kill after the window finds no lock left in that deployment');
});

test('F1 坚固维式重锤 + M3茧甲: the lock comes before the revive whatever the equip order (PRTS: a revive acts on 退场)', () => {
  assert.ok(PRIO_RESPAWN < PRIO_REVIVE && PRIO_RESPAWN > PRIO_BAND_REVIVE, 'revive items: after every 不死, before 埃芒加德');
  for (const items of [[M3, HAMMER], [HAMMER, M3]]) {
    const c = carrier(items);
    const log = fxLog(c.h, c.u);
    const hit = () => c.h.b.dealDamage(c.e, c.u, { amount: 1e7, type: 'true', canDodge: false });
    hit();
    assert.ok(c.u.alive && c.u.hp < 2, `${items}: the first lethal hit is held at 1 HP (lock), not revived to full`);
    assert.deepEqual(log.map((x) => x[0]), ['undying'], `${items}: lock first`);
    c.h.run(8.2);
    hit();
    assert.ok(c.u.alive, `${items}: after the 8 s the 茧甲 revives`);
    assert.equal(Math.round(c.u.hp), 2000, 'full HP');
    assert.deepEqual(log.map((x) => x[0]), ['undying', 'revive']);
    // the revive stands for PRTS's 0-time / 0-cost redeploy: a new deployment, so the lock is armed again
    hit();
    assert.ok(c.u.alive && c.u.hp < 2, `${items}: the revived carrier locks again`);
    assert.deepEqual(log.map((x) => x[0]), ['undying', 'revive', 'undying']);
    c.h.run(8.2);
    hit();
    assert.equal(c.u.alive, false, `${items}: nothing left (one revive, one lock in that deployment)`);
  }
});

// The 埃芒加德 strategy's revive (命结之秘, the first 3 knock-downs of the battle revive at once) stands in place for the same
// redeploy as M3茧甲's: the lock is armed again after it.
test('F1 坚固维式重锤 + 埃芒加德: the band revive re-arms the lock, once per revive', () => {
  const h = makeBattle({
    defs: { chess: { t_op: op('t_op') }, enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: 't_op', row: 10, col: 4, items: [HAMMER] }], bandId: 'band_ermengard',
    enemies: [{ key: 'e_d', pos: [10, 9] }], timeLimit: 999, autoFinish: false,
  });
  h.step(1);
  const u = h.unit('t_op');
  const e = h.b.enemies.find((x) => x.alive);
  const log = fxLog(h, u);
  const hit = () => h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false });
  hit();
  h.run(8.2);
  hit();
  assert.ok(u.alive && Math.round(u.hp) === 2000, 'the band revives the carrier after its first lock');
  hit();
  assert.ok(u.alive && u.hp < 2, 'locked again after the revive');
  h.run(1);
  hit();
  assert.ok(u.alive && u.hp < 2, 'inside the new window');
  assert.deepEqual(log.map((x) => [x[0], x[2]]), [['undying', 'item:hammer'], ['revive', 'band:band_ermengard'], ['undying', 'item:hammer']]);
});

// 萨尔贡 × 娜仁图亚 lends a carrier's items to its neighbours for 60 s (items/battle.js lendItemEffects). The lock belongs to
// the borrower's deployment, not to the lend: a borrower knocked out while lent, whose lend ran out while it was down,
// gets a fresh lock when it is lent the hammer again in its next deployment (QA: it came back spent — the per-grant
// hook that re-armed it was gone with the lend); and a window started through the lend lasts its 8 s after the lend
// ends [ASSUMED: the 异常效果 不死 outlasts its source] (QA: it ended with the lend).
/** A lender carrying the hammer at (10, 4), a borrower (no items) at (11, 4) and a static dummy. */
function lendPair() {
  const h = makeBattle({
    defs: { chess: { t_op: op('t_op'), t_bor: op('t_bor') }, enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: 't_op', row: 10, col: 4, items: [HAMMER] }, { chessId: 't_bor', row: 11, col: 4 }],
    enemies: [{ key: 'e_d', pos: [10, 9] }], timeLimit: 999, autoFinish: false,
  });
  h.step(1);
  return { h, lender: h.unit('t_op'), u: h.unit('t_bor'), e: h.b.enemies.find((x) => x.alive) };
}
const lent = (h, u) => itemGrants(h.b, u).some((g) => g.lent && g.key === 'chess_item_3_09_e');

test('F1 坚固维式重锤 lent by 萨尔贡 × 娜仁图亚: a fresh lock in the next deployment, though the lend ran out while it was down', () => {
  {
    const { h, lender, u, e } = lendPair();
    const log = fxLog(h, u);
    const hit = () => h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false });
    assert.equal(lendItemEffects(h.b, lender, u, { duration: 12 }), 1, 'the hammer is lent');
    hit();
    assert.ok(u.alive && holdsUndying(h.b, u), 'the lent hammer locks');
    h.run(8.2);
    hit();
    assert.equal(u.alive, false, 'knocked out after the window');
    h.run(5);
    assert.ok(!lent(h, u), 'the lend ran out while it was down');
    h.runUntil(() => u.alive, 60);
    assert.ok(u.alive, 'redeployed');
    hit();
    assert.equal(u.alive, false, 'no hammer, no lock');
    h.runUntil(() => u.alive, 60);
    assert.equal(lendItemEffects(h.b, lender, u, { duration: 12 }), 1, 'lent again in this deployment');
    hit();
    assert.ok(u.alive && u.hp < 2, 'a new deployment with the hammer: a fresh lock');
    h.run(8.2);
    lendItemEffects(h.b, lender, u, { duration: 12 });
    hit();
    assert.equal(u.alive, false, 'a lend refreshed in the same deployment does not re-arm it');
    assert.equal(log.filter((x) => x[0] === 'undying').length, 2);
  }
});

test('F1 坚固维式重锤 lent by 萨尔贡 × 娜仁图亚: a window started through the lend lasts its 8 s after the lend ends', () => {
  {
    const { h, lender, u, e } = lendPair();
    const hit = () => h.b.dealDamage(e, u, { amount: 1e7, type: 'true', canDodge: false });
    lendItemEffects(h.b, lender, u, { duration: 3 });
    h.run(2);
    hit();
    assert.ok(u.alive && u.hp < 2, 'locked 1 s before the lend ends');
    h.run(3);
    assert.ok(!lent(h, u), 'the lend is over');
    hit();
    assert.ok(u.alive && holdsUndying(h.b, u), 'still held: the window runs its 8 s');
    h.run(5.2);
    hit();
    assert.equal(u.alive, false, 'knocked out once the 8 s are over');
  }
});

test('F1 坚固维式重锤 on a real operator in a real fight: 角峰 blocking scaled-up real enemies stands 8 s at 1 HP', () => {
  for (const id of [HAMMER, HAMMER_B]) {
    const h = makeBattle({
      stageId: 'flat', seed: 7,
      units: [{ chessId: 'chess_char_1_02_a', row: 9, col: 5, items: [id] }],
      enemies: Array.from({ length: 6 }, (_, i) => ({ key: 'enemy_1422_lrsldr', time: i * 0.5, route: 0, mods: { atkMul: 30, hpMul: 50 } })),
      timeLimit: 120, autoFinish: false,
    });
    const u = h.unit('chess_char_1_02_a');
    const log = fxLog(h, u);
    let out = null;
    h.b.on('death', (c) => { if (c.unit === u && out == null) out = h.b.time; });
    h.runUntil(() => out != null, 60);
    const lock = log.find((x) => x[0] === 'undying');
    assert.ok(lock && lock[2] === 'item:hammer', `${id}: the hammer locked (${JSON.stringify(log)})`);
    assert.ok(out != null && out >= lock[1] + 8 - 1e-6, `${id}: knocked out ${out} ≥ 8 s after the lock at ${lock[1]}`);
  }
});
