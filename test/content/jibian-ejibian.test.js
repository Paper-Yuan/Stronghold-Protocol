// test/content/jibian-ejibian.test.js — 敌方惊变（server/sim/content/ejibian.js）的数值效果与 Match 侧纯函数。
//
// 移植来源：参考包 test/ejibian-sakazi.test.mjs（萨卡兹巫术的进条口径）+ 牌面数值本身。
// 战场侧：卡从 `flags.enemyJibian`（字符串数组）进，出怪时逐只结算；Match 侧：matchJibianPlan / jibianRoll /
// jibianDuckParams / heavenTimeLimit 都是纯函数，直接断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, hashOf } from '../helpers/battleHarness.js';
import {
  cardsOf, heavenTimeLimit, jibianDuckParams, jibianRoll, matchJibianPlan,
} from '../../server/sim/content/ejibian.js';
import { createRng } from '../../server/sim/rng.js';

const OP = 'chess_char_1_01_a';
let seq = 0;

/** 一名干员 + 一只不动的高血敌人；`cards` 进 flags.enemyJibian。 */
function field(cards = [], { seed = 7, enemy = {} } = {}) {
  const key = `ej${seq++}`;
  const h = makeBattle({
    units: [{ chessId: OP, row: 9, col: 6 }],
    enemies: [{ key, time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs: { enemies: { [key]: enemyRec({ key, hp: 1e9, atk: 1000, def: 0, speed: 0, ...enemy }) } },
    seed,
    modeId: 'mode_single_zhajing',
    flags: { startOpCooldown: 0, enemyJibian: cards },
    autoFinish: false,
    timeLimit: 600,
    captureNoisy: false,
  });
  h.step(2);
  return { h, u: h.unit(OP), e: h.enemies()[0] };
}

test('cardsOf：接受数组 / 单张 / 空', () => {
  assert.deepEqual([...cardsOf({ flags: { enemyJibian: ['a', 'b'] } })], ['a', 'b']);
  assert.deepEqual([...cardsOf({ flags: { enemyJibian: 'a' } })], ['a']);
  assert.equal(cardsOf({ flags: {} }).size, 0);
  assert.equal(cardsOf(null).size, 0);
});

test('先发制人 (ejibian_xianfazhiren)：敌方攻速 +90（加算）', () => {
  const off = field([]);
  const on = field(['ejibian_xianfazhiren']);
  assert.equal(off.e.s.aspd, 100);
  assert.equal(on.e.s.aspd, 190);
  assert.equal(on.h.b.errorCount, 0);
});

test('？！强强？！(ejibian_qiangqiang)：敌方三项基础数值 ×1.16', () => {
  const off = field([]);
  const on = field(['ejibian_qiangqiang']);
  for (const k of ['atk', 'def', 'maxHp']) {
    assert.ok(Math.abs(on.e.s[k] - off.e.s[k] * 1.16) < 1e-6, `${k}: ${off.e.s[k]} → ${on.e.s[k]}`);
  }
});

test('质变→量变 (ejibian_zhibianliangbian)：敌方基础数值 ×1.30（2026-10-17 从 1.32 改的）', () => {
  const off = field([]);
  const on = field(['ejibian_zhibianliangbian']);
  assert.ok(Math.abs(on.e.s.atk - off.e.s.atk * 1.3) < 1e-6, `${off.e.s.atk} → ${on.e.s.atk}`);
});

test('通行证 (ejibian_tongxingzheng)：两层次数盾', () => {
  const { e } = field(['ejibian_tongxingzheng']);
  const buff = e.findBuff('ejibian:tongxingzheng');
  assert.ok(buff, '盾 buff 在');
  assert.equal(buff.shieldHits, 2);
});

test('龙刃 (ejibian_longren)：近战伤害 ×3；本来就远程的失去远程攻击（领袖不受影响）', () => {
  const melee = field(['ejibian_longren']);
  const b = melee.e.findBuff('ejibian:longren');
  assert.ok(b, '近战敌人吃到 dmgDealtMul');
  assert.equal(b.mods.dmgDealtMul, 3);
  // 敌人记录默认 applyWay 由 enemyRec 决定；远程的会额外拿到 disarm 旗标
  const ranged = field(['ejibian_longren'], { enemy: { applyWay: 'RANGED' } });
  const off2 = ranged.e.findBuff('ejibian:longren:meleeOnly');
  assert.ok(off2, '远程敌人拿到 meleeOnly');
  assert.equal(off2.flags.disarm, true);
});

// ★ 来源 ejibian-sakazi.test.mjs：敌人打我方 → 目标吃到 10% 凋亡；我方打敌人不误触发
test('萨卡兹巫术 (ejibian_sakaziwushu)：敌方伤害附带 10% 凋亡损伤，我方攻击不触发', () => {
  const DMG = 5000;
  const off = field([]);
  const on = field(['ejibian_sakaziwushu']);
  for (const s of [off, on]) if (s.u.elem) s.u.elem.apoptosis = 0;
  off.h.b.dealDamage(off.e, off.u, { amount: DMG, type: 'phys' }); off.h.step(0.1);
  on.h.b.dealDamage(on.e, on.u, { amount: DMG, type: 'phys' }); on.h.step(0.1);
  assert.equal(off.u.elem.apoptosis, 0, '不带卡时不涨');
  // 10% × 元素吸收（≤10%）→ 进条量落在 [500×0.05, 500] 之间
  assert.ok(on.u.elem.apoptosis > 0, `带卡时涨了：${on.u.elem.apoptosis}`);
  assert.ok(on.u.elem.apoptosis <= DMG * 0.1 + 1e-6, String(on.u.elem.apoptosis));

  // 我方打敌人：敌人身上不该多出凋亡
  const before = on.e.elem ? on.e.elem.apoptosis : 0;
  on.h.b.dealDamage(on.u, on.e, { amount: DMG, type: 'phys' }); on.h.step(0.1);
  assert.equal(on.e.elem ? on.e.elem.apoptosis : 0, before);
});

test('确定性：同 seed 的随机数值惊变（真的假的 / 斗蛐蛐）逐字节相同', () => {
  const run = (seed, card) => {
    const { h, e } = field([card], { seed });
    return hashOf([e.s.atk, e.s.def, e.s.maxHp, e.s.aspd, h.b.errorCount]);
  };
  for (const card of ['ejibian_zhendejiade', 'ejibian_douququ']) {
    assert.equal(run(7, card), run(7, card), `${card} 同 seed 一致`);
  }
  const outcomes = new Set(Array.from({ length: 12 }, (_, i) => run(i + 1, 'ejibian_douququ')));
  assert.ok(outcomes.size > 1, '不同 seed 之间结果不全相同（随机来自 seed）');
});

test('没有敌方惊变的战斗里 install 什么都不装（主玩法零影响）', () => {
  const { h, e } = field([]);
  assert.deepEqual((e.buffs || []).filter((b) => String(b.key).startsWith('ejibian:')), []);
  assert.equal(h.b.errorCount, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Match 侧纯函数

test('matchJibianPlan：出怪量乘区相乘 / 同时进场 / 无卡时返回 null', () => {
  assert.equal(matchJibianPlan(null, 1, []), null);
  const all = matchJibianPlan(null, 1, ['ejibian_liangbianzhibian', 'ejibian_zhibianliangbian', 'ejibian_jiangshiweicheng']);
  assert.ok(Math.abs(all.countMul - 1.4 * 0.6 * 2) < 1e-9, String(all.countMul));
  assert.equal(all.sameTime, false);
  const same = matchJibianPlan(null, 1, ['ejibian_qiangxingdingma']);
  assert.equal(same.sameTime, true);
  assert.equal(same.countMul, 1);
});

test('jibianRoll：同一 rng 状态 + 同一回合 ⇒ 同一结果，且派生流不消耗主流', () => {
  const rng = createRng(1234);
  const before = rng.state();
  const a = jibianRoll(rng, 5);
  assert.equal(rng.state(), before, '派生流不推进主流');
  assert.equal(a, jibianRoll(rng, 5));
  assert.notEqual(a, jibianRoll(rng, 6), '换回合就换结果');
  assert.equal(jibianRoll(null, 5), 1, '没有 rng 时保守返回 1');
});

test('matchJibianPlan 的入职测试（15%）走派生流，同 round 可复现', () => {
  const cards = ['ejibian_ruzhiceshi'];
  const run = () => { const rng = createRng(99); return [1, 2, 3, 4, 5, 6, 7, 8].map((r) => !!matchJibianPlan(rng, r, cards)?.slime); };
  assert.deepEqual(run(), run());
});

test('heavenTimeLimit：有天堂制造时减 80 游戏秒并保底 20', () => {
  assert.equal(heavenTimeLimit({ flags: { enemyJibian: [] } }, 150), 150);
  assert.equal(heavenTimeLimit({ flags: { enemyJibian: ['ejibian_tiantangzhizao'] } }, 150), 70);
  assert.equal(heavenTimeLimit({ flags: { enemyJibian: ['ejibian_tiantangzhizao'] } }, 80), 20);
  assert.equal(heavenTimeLimit({ flags: { enemyJibian: ['ejibian_tiantangzhizao'] } }, 0), 0);
});

test('jibianDuckParams：只在第 7/8 回合 + 有鸭爵卡时拉满概率窗口', () => {
  const p = { min: 0, max: 2, minweight: 0.6, maxweight: 0.99 };
  assert.deepEqual(jibianDuckParams(p, { round: 5, cards: ['ejibian_yajue'] }), p);
  assert.deepEqual(jibianDuckParams(p, { round: 7, cards: ['ejibian_xianfazhiren'] }), p);
  const on = jibianDuckParams(p, { round: 7, cards: ['ejibian_yajue'] });
  assert.equal(on.minweight, 0);
  assert.equal(on.maxweight, 1);
  assert.equal(on.replaceAll, true);
  assert.equal(p.minweight, 0.6, '不改原对象');
});
