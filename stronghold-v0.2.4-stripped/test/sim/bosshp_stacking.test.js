// "终极 leaders die in seconds" (user report after playtest #6): the percentage attribute bonuses of the 卫戍 systems
// compounded. PRTS 卫戍协议：盟约 下半/PRTS盟约记录: "盟约效果，策略效果，装备效果提供的属性加成均为直接乘算"; PRTS 游戏数据基础
// 属性基本公式: 直接乘算 values are SUMMED — D_t = t₁ + … + tₙ, A = (A₀ + D_p)(1 + D_t) — and PRTS 作战机制 X₂ = X₁(1 + b₁% +
// b₂%) with a skill's "攻击力+X%" in the same sum. v2.5 gave every bond / strategy / item its own ×(1 + x) (atkMul), so
// with many layers a ranged operator under 精准 + 独行 + 卡西米尔 + an item + a 特质 dealt ×74 instead of ×12 of its ATK.
// Now: content/support directMods → atkPct / defPct / hpPct (constants.js DIRECT_BONUS_STACKING 'add'); the 炎佑 ×1.5
// ("提升至1.5倍") and the char_attribute_mul 特质 (a rune on the chess's base attributes) stay multipliers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, flatStage, checkInvariants } from '../helpers/battleHarness.js';
import { directMods } from '../../server/sim/content/support/index.js';
import { bondBb } from '../../server/sim/content/bonds/addon/battle.js';
import { DIRECT_BONUS_STACKING } from '../../server/sim/constants.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg ?? ''} expected ${b}, got ${a}`);
const bond = (tier, layers = 0, count = 2) => ({ count, active: tier > 0, tier, layers });
const HAMMER = 'chess_item_1_01_e_a'; // 维式重锤 攻击力+15%
const BLADE = 'chess_item_3_07_e_a';  // 阿戈尔重刃 攻击力+40%

test('directMods: 直接乘算 ratios go to the additive percentage bucket (zeros dropped, extras merged)', () => {
  assert.equal(DIRECT_BONUS_STACKING, 'add');
  assert.deepEqual(directMods({ atk: 0.3, def: 0.2, hp: -0.1 }), { atkPct: 0.3, defPct: 0.2, hpPct: -0.1 });
  assert.deepEqual(directMods({ atk: 0, hp: NaN }), {});
  assert.deepEqual(directMods({ def: 0.5 }, { redeployMul: 0.7 }), { defPct: 0.5, redeployMul: 0.7 });
});

test('bonds + equipment + a skill ATK%: one sum (精准 L100 +130 %, 独行 +60 %, two items +55 %, skill +50 %)', () => {
  const pre = bondBb('preciShip'), solo = bondBb('soloShip');
  const preci = pre.base_atk + pre.atk_per_stack * 100;
  const defs = { chess: { s_op: chessRec({ id: 's_op', bonds: ['preciShip', 'soloShip'], profession: 'SNIPER', skill: null }) } };
  const h = makeBattle({
    defs, units: [{ chessId: 's_op', row: 10, col: 3, items: [HAMMER, BLADE] }],
    bonds: { preciShip: bond(1, 100), soloShip: bond(1, 0, 1) },
  });
  h.step();
  const u = h.unit('s_op');
  const sum = 1 + preci + solo.atk + 0.15 + 0.4;
  close(u.s.atk, 500 * sum, 'bonds and items add up');
  h.b.addBuff(u, { key: 'test:skill', mods: { atkPct: 0.5 } }); // a skill's "攻击力+50%" (直接乘算 too)
  close(u.s.atk, 500 * (sum + 0.5), 'the skill joins the same sum');
  const v25 = 500 * (1 + preci) * (1 + solo.atk) * 1.15 * 1.4 * 1.5; // the v2.5 product (each source its own multiplier)
  assert.ok(u.s.atk < v25 / 1.8, `far below the v2.5 product ${v25}`);
  close(u.s.maxHp, 2000 * (1 + solo.max_hp), '独行 HP');
  checkInvariants(h.b);
});

test('strategy + bonds add up: 阿米娅 众志合一 (3 active bonds: +20 % ATK / HP) with 精准 and 绝技 (elite)', () => {
  const pre = bondBb('preciShip'), sunt = bondBb('suntShip');
  const defs = { chess: { e_op: chessRec({ id: 'e_op', bonds: ['preciShip'], profession: 'SNIPER', skill: null, golden: true }) } };
  const h = makeBattle({
    defs, bandId: 'band_amiya', units: [{ chessId: 'e_op', row: 10, col: 3 }],
    bonds: { preciShip: bond(1, 50), suntShip: bond(1, 0, 2), steadShip: bond(1, 0) },
  });
  h.step();
  const u = h.unit('e_op');
  const want = 1 + pre.base_atk + pre.atk_per_stack * 50 + sunt.power_atk + 0.2;
  close(u.s.atk, 500 * want, 'one 直接乘算 sum');
  checkInvariants(h.b);
});

test('a leader sharing the pool takes the summed ATK: one normal hit of a stacked operator (精准 L600 + 独行 + 2 items)', () => {
  const pre = bondBb('preciShip'), solo = bondBb('soloShip');
  const defs = {
    chess: { s_op: chessRec({ id: 's_op', bonds: ['preciShip', 'soloShip'], profession: 'SNIPER', skill: null, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }) },
    enemies: { enemy_stack_leader: { ...enemyRec({ key: 'enemy_stack_leader', hp: 600000, speed: 0, dmgType: 'none' }), rank: 'BOSS', hitArea: { w: 4.95, h: 2.95, dx: 0, dy: 1 } } },
  };
  const pool = new SharedBossPool(3600000);
  const h = makeBattle({
    defs, kind: 'boss', stage: flatStage(), sharedBoss: pool, autoFinish: false,
    units: [{ chessId: 's_op', row: 10, col: 6, items: [HAMMER, BLADE] }],
    bonds: { preciShip: bond(1, 600), soloShip: bond(1, 0, 1) },
    enemies: [{ key: 'enemy_stack_leader', pos: [3, 10], route: { motion: 'WALK', start: [3, 10], end: [3, 10], checkpoints: [] }, tag: 'boss' }],
  });
  const hits = [];
  h.b.on('damaged', (c) => { if (c.target.bossPool && c.dmg.isAttack) hits.push(c.amount); }, { priority: -1e9 });
  h.runUntil(() => hits.length >= 1, 10);
  const atk = 500 * (1 + pre.base_atk + pre.atk_per_stack * 600 + solo.atk + 0.15 + 0.4);
  assert.ok(hits.length >= 1, 'the operator hits the leader');
  close(hits[0], atk, 'DEF 0: one hit = the summed ATK');
  close(pool.maxHp - pool.hp, hits.reduce((s, x) => s + x, 0), 'the pool lost exactly the hits');
  assert.ok(hits[0] < 500 * (1 + pre.base_atk + pre.atk_per_stack * 600) * (1 + solo.atk) * 1.15 * 1.4 / 2, 'v2.5 compounded this to more than twice as much');
  checkInvariants(h.b);
});
