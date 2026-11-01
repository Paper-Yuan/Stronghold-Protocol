// test/content/overlimit_hitcount.test.js — 超限模拟（`flags.overlimit`）「次数怪」的血量豁免。
//
// 口径：次数怪的 maxHp 就是「要被打几次」（server/sim/attack/health.js：带 hitCount / hitCountArts 的目标每段伤害
// 只扣 1 点），所以它不参与关卡 / 回合的敌方血量倍率 —— 与炸惊同口径（server/sim/content/ejibian.js 的 pinBase：
// `if (Number.isFinite(maxHp) && !isHitCount(e)) b.maxHp = …`）。
//   · 落点：server/sim/content/enemies/archetypes.js 的 `times()`（14 个频次 / 器物 key 的 spawn）。敌方倍率本身仍由
//     server/sim/battle/spawns.js 的 `def.maxHp × mods.hpMul` 生效（mods 来自 server/match/infiniteWaves.js 的超限曲线），
//     豁免只把「次数」的基数换回 def 的原始 maxHp；atk / def / res / speed 照常放大。
//   · 只在超限局生效：没有 `flags.overlimit` 时同一条记录仍按 hpMul 放大（普通 / 湮灭 / 炸惊一帧不变）。
//   · Boss 召唤物（bosses.js 的 刺胄之弹 / 余音，spawn 后 `setHits(e, e.base.maxHp)`）不经过 `times()`，本豁免碰不到它们。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { enemyInfiniteScale } from '../../shared/infiniteMode.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

/**
 * 超限 R30 的敌方倍率：绝境 R15 的数值接 ×1.06/回合（R16+，shared/infiniteMode.js enemyInfiniteScale）。
 * 绝境 R15 的 hp 3.5831808 / atk 1.9487 由 test/match/overlimit-audit.test.js 钉住 —— R30 ≈ hp ×8.587、atk ×3.042。
 */
const R30 = enemyInfiniteScale(30, () => ({ hpMul: 3.5831808, atkMul: 1.9487, speedMul: 1.15 }));
const MODS = { hpMul: R30.hpMul, atkMul: R30.atkMul, speedMul: R30.speedMul, defMul: R30.defMul, resMul: R30.resMul };
const OL = { overlimit: true };

/**
 * 青铜镜（enemy_1200_msfjin）：数据的 maxHp 30 = 要挨 30 段伤害。14 个器物 key 的数据 atk 全是 0，所以测试把同一条
 * 记录的 atk / def / res 覆盖成非零值（key 不变 ⇒ `times()` 这套 kit 照旧挂在它身上），用来观察「其余属性照常放大」。
 */
const MIRROR = 'enemy_1200_msfjin';
const MIRROR_HP = 30, MIRROR_ATK = 120, MIRROR_DEF = 40, MIRROR_RES = 10;
const DEFS = {
  enemies: {
    [MIRROR]: enemyRec({ key: MIRROR, hp: MIRROR_HP, atk: MIRROR_ATK, def: MIRROR_DEF, res: MIRROR_RES, speed: 0.5, bat: 1 }),
    enemy_test_plain: enemyRec({ key: 'enemy_test_plain', hp: 2000, atk: 100, speed: 0 }),
  },
};

/** Spawn `key` with `mods` in a battle with `flags`, one tick, and return the enemy. */
function spawnOne({ key = MIRROR, flags = {}, mods = null, defs = DEFS } = {}) {
  const h = makeBattle({ defs, enemies: [{ key, mods }], flags });
  h.step(1);
  const e = h.enemy(key);
  assert.ok(e && e.alive, `${key} spawned`);
  return { h, e };
}

// ---------------------------------------------------------------------------------------------------------------------
// 1 · 超限 R30：次数不变，其余属性照常放大

test('超限 R30 次数怪: maxHp (= 受击次数) is the ordinary-mode count; atk / def / res / speed still × the round', () => {
  const plain = spawnOne();
  const ol = spawnOne({ flags: OL, mods: MODS });
  assert.equal(ol.e.s.maxHp, plain.e.s.maxHp, '超限 R30 的次数 == 普通模式下同一条记录的次数');
  assert.equal(ol.e.s.maxHp, MIRROR_HP, '还是 30 次（R30 的 ×8.587 不进次数）');
  assert.equal(ol.e.hp, MIRROR_HP, '满血上场');
  assert.ok(ol.e.findBuff('ab:hitCount'), '仍然是次数怪：每段伤害只扣 1 点');
  // 其余属性照常吃回合倍率（确认豁免只动 maxHp）
  assert.ok(ol.e.s.atk > plain.e.s.atk, `超限 atk ${ol.e.s.atk} > 普通 ${plain.e.s.atk}`);
  close(ol.e.s.atk, MIRROR_ATK * R30.atkMul, 1e-9, 'atk × the round');
  close(ol.e.s.def, MIRROR_DEF * R30.defMul, 1e-9, 'def × the round');
  close(ol.e.s.res, MIRROR_RES * R30.resMul, 1e-9, 'res × the round');
  close(ol.e.s.moveSpeed, 0.5 * R30.speedMul, 1e-9, 'speed × the round');
  checkInvariants(plain.h.b);
  checkInvariants(ol.h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 2 · 非超限局一帧不变：同一条记录 + 同样的 mods 仍按 hpMul 放大

test('without flags.overlimit the same record still takes hpMul (ordinary / 湮灭 / 炸惊 unchanged)', () => {
  const { h, e } = spawnOne({ mods: MODS });
  assert.equal(e.s.maxHp, Math.round(MIRROR_HP * R30.hpMul), '30 次 × 8.587 = 258 次（老行为）');
  assert.equal(e.s.maxHp, 258);
  assert.ok(e.findBuff('ab:hitCount'));
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 3 · 真实出场路径：器物是「击杀召唤」出来的，孩子的次数同样豁免（mods 随 spawnChildren 继承）

test('超限: a death-spawned 器物 inherits its parent\'s mods but not the round\'s hit count', () => {
  const run = (flags, mods) => {
    const h = makeBattle({ enemies: [{ key: 'enemy_1199_sfjin', mods }], flags }); // 身观 · death: 1 青铜镜
    h.step(1);
    const parent = h.enemy('enemy_1199_sfjin');
    assert.ok(parent, '身观 spawned');
    h.b.kill(parent, null);
    h.step(1);
    const kid = h.b.enemies.find((e) => e.alive && e.defId === MIRROR);
    assert.ok(kid, '青铜镜 spawned on death');
    return { h, kid };
  };
  const base = run({}, null);              // 普通模式的同一条记录（无回合倍率）
  const plain = run({}, MODS);             // 非超限局 + 超限 R30 的 mods：老行为（一帧不变）
  const ol = run(OL, MODS);                // 超限局 + 同 mods
  assert.equal(ol.kid.mods.hpMul, MODS.hpMul, '孩子的 mods 继承父级（血量倍率仍随 spawnChildren 走）');
  assert.equal(plain.kid.mods.hpMul, MODS.hpMul);
  assert.equal(base.kid.s.maxHp, MIRROR_HP);
  assert.equal(ol.kid.s.maxHp, base.kid.s.maxHp, '超限 R30 的次数 == 普通模式同记录的次数');
  assert.equal(plain.kid.s.maxHp, Math.round(MIRROR_HP * R30.hpMul), '非超限局：孩子的次数照旧 × 8.587');
  checkInvariants(base.h.b);
  checkInvariants(plain.h.b);
  checkInvariants(ol.h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 4 · 豁免没误伤：非次数怪在超限下仍然被放大

test('超限: a non-hit-count enemy still gets its maxHp scaled', () => {
  const plain = spawnOne({ key: 'enemy_test_plain' });
  const ol = spawnOne({ key: 'enemy_test_plain', flags: OL, mods: MODS });
  assert.equal(plain.e.s.maxHp, 2000);
  close(ol.e.s.maxHp, 2000 * R30.hpMul, 1e-9, '非次数怪：2000 × 8.587');
  assert.ok(ol.e.s.maxHp > plain.e.s.maxHp, '仍然被放大');
  assert.ok(!ol.e.findBuff('ab:hitCount'), '不是次数怪');
  assert.equal(ol.e.hp, ol.e.s.maxHp, '满血上场');
  checkInvariants(ol.h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 5 · Boss 召唤物不动（设计意图）：bosses.js:500 / :976 在 spawn 之后 `setHits(e, e.base.maxHp)`，次数要跟回合倍率。
//     刺胄之弹（enemy_9016_acstmr，数据 8 次）/ 余音（enemy_9023_acdums，数据 10 次）都不在 TIMES_KITS 里，
//     不经过 times()，所以超限豁免碰不到它们 —— 直接 spawn 这两条记录就是它们自己的 kit 在跑。

test('超限: boss parts that setHits(e.base.maxHp) keep the round\'s hit count (bosses.js:500/:976 untouched)', () => {
  for (const [key, dataHits] of [['enemy_9016_acstmr', 8], ['enemy_9023_acdums', 10]]) {
    const plain = spawnOne({ key, mods: MODS });
    const ol = spawnOne({ key, flags: OL, mods: MODS });
    assert.equal(plain.e.s.maxHp, Math.round(dataHits * R30.hpMul), `${key}: 非超限局仍 × 8.587`);
    assert.equal(ol.e.s.maxHp, Math.round(dataHits * R30.hpMul), `${key}: 超限局同样 × 8.587（Boss 召唤物照旧）`);
    assert.ok(ol.e.findBuff('ab:hitCount'), `${key}: 是次数怪`);
    checkInvariants(plain.h.b);
    checkInvariants(ol.h.b);
  }
});
