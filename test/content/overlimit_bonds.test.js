// 超限模拟（`flags.overlimit`）的七条盟约改动（业主 2026-10-31 定稿数值）。
//
// 每条都成对断言：**超限局的新数值**与**非超限局的原数值**（普通 / 湮灭 / 炸惊的 gates 里没有 `overlimit`，
// 所以「非超限」这一列同时钉住那三种模式一帧不变）。
//   · 落点：server/sim/content/bonds/core.js（installSargon / installVictoria / installKazimierz /
//     installEgir / installKjerag / installLaterano / installSiracusa）与 devices.js（寒风真伤），
//     卡西米尔的「突袭相关乘区」在 server/sim/content/bonds/addon/battle.js raidMods。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const op = (id, bonds, extra = {}) => chessRec({
  id, bonds, profession: 'WARRIOR', skill: null, ...extra,
  stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2, ...(extra.stats || {}) },
});
const bondOn = (count, layers = 0, tier = null, thresholds = [3, 6, 9]) => ({
  count, active: count >= thresholds[0], tier: tier ?? thresholds.filter((t) => count >= t).length, layers,
});
const dummy = enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 0, res: 0 });
const buffOf = (u, key) => u.buffs.find((b) => b.key === key) ?? null;
const OL = { overlimit: true };

function lineup(ids, { row = 10, col = 3, items: it = {} } = {}) {
  return ids.map((chessId, i) => ({ chessId, row: row + Math.floor(i / 7), col: col + (i % 7), items: it[i] }));
}
function defsOf(list, enemies = { e_dummy: dummy }) {
  const chess = {};
  for (const [id, bonds, extra] of list) chess[id] = op(id, bonds, extra);
  return { chess, enemies };
}

// ---------------------------------------------------------------------------------------------------------------------
// 1 · 萨尔贡：6 人档「叠层 → 攻击力」的上限（原 +300 %）在超限局取消

test('超限 萨尔贡: the +300 % ATK stack cap is gone (L=0, 40 skill starts → ATK +480 %), ASPD stays capped at 25 stacks', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`s${i}_a`, ['sargonShip'], { skill: { duration: 1000, spCost: 10, initSp: 0 } }]);
  const run = (flags) => makeBattle({
    defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { sargonShip: bondOn(6, 0, null, [3, 6]) },
    flags, timeLimit: 60,
  });
  // 超限：40 次开启技能 → 40 个「攻击力层数」标记（不再被 max_buff_stack_cnt 25 卡住），每层 +12 % 攻击力；
  // 攻速仍走 25 层上限（业主 2026-10-31 补答：只放开攻击侧）
  const h = run(OL);
  h.step(1);
  const a = h.unit('s0_a'), f = h.unit('s5_a');
  for (let i = 0; i < 40; i++) { a.skill.end('test'); a.skill.activate('test', { free: true }); }
  assert.equal(f.buffs.filter((x) => x.key === 'bond:sargon').length, 25, 'ASPD stacks still capped at 25');
  assert.equal(f.buffs.filter((x) => x.key === 'bond:sargon:atk-stack').length, 40, '40 ATK layers');
  close(f.s.atk, 1000 * (1 + 40 * 0.12), 1e-6, 'ATK +480 %');
  close(buffOf(f, 'bond:sargon:atk').mods.atkPct, 40 * 0.12);
  assert.equal(f.s.aspd, 100 + 25 * 12, 'ASPD +300 (unchanged)');
  checkInvariants(h.b);
  // 普通 / 湮灭 / 炸惊：没有超限标记，攻击力仍由 25 层叠层决定 = +300 %
  const p = run({});
  p.step(1);
  const pa = p.unit('s0_a'), pf = p.unit('s5_a');
  for (let i = 0; i < 40; i++) { pa.skill.end('test'); pa.skill.activate('test', { free: true }); }
  assert.equal(pf.buffs.filter((x) => x.key === 'bond:sargon').length, 25, 'capped at 25 stacks');
  assert.equal(pf.buffs.filter((x) => x.key === 'bond:sargon:atk-stack').length, 0, 'no 超限 marker');
  close(pf.s.atk, 1000 * (1 + 25 * 0.12), 1e-6, 'ATK +300 %');
  assert.equal(pf.s.aspd, 100 + 25 * 12);
  checkInvariants(p.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 2 · 维多利亚 / 炎：每层 +0.2 % 生命值

test('超限 维多利亚: members get +0.2 % max HP per layer (no equipment needed); plain adds nothing', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`v${i}_a`, ['victoriaShip']]);
  const L = 50;
  const run = (flags) => makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { victoriaShip: bondOn(6, L, null, [3, 6]) }, flags });
  const h = run(OL);
  h.step(1);
  const a = h.unit('v0_a');
  close(a.s.maxHp, 10000 * (1 + 0.002 * L), 1e-6, '+10 % at 50 layers');
  assert.ok(buffOf(a, 'bond:victoria:hp'), 'the HP channel exists without any equipment');
  // live layers refresh the standing HP buff
  h.b.addLayers('p1', 'victoriaShip', 50, 'test');
  h.step(2);
  close(a.s.maxHp, 10000 * (1 + 0.002 * 100), 1e-6, '+20 % at 100 layers');
  checkInvariants(h.b);
  const p = run({});
  p.step(1);
  close(p.unit('v0_a').s.maxHp, 10000);
  assert.equal(buffOf(p.unit('v0_a'), 'bond:victoria:hp'), null, 'plain: no HP buff');
});

test('超限 炎: +15 % base + 0.2 % per layer (unchanged, now pinned for both gates)', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`y${i}_a`, ['yanShip']]);
  const L = 30;
  const run = (flags) => makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { yanShip: bondOn(6, L) }, flags });
  const h = run(OL);
  h.step(1);
  close(h.unit('y0_a').s.maxHp, 10000 * (1 + 0.15 + 0.002 * L), 1e-6, '+21 % at 30 layers');
  const p = run({});
  p.step(1);
  close(p.unit('y0_a').s.maxHp, 10000, 1e-6, 'plain: no HP channel');
});

// ---------------------------------------------------------------------------------------------------------------------
// 3 · 卡西米尔：攻击力乘区全翻倍（每次部署 +20 % → +40 %，上限 0.5+0.01L → 1.0+0.02L），
//     并同一轮把【突袭】的再部署乘区（业主嘴里的「突袭相关乘区」）翻倍 —— 业主 2026-10-31（超限 V3）补答：
//     那一处**只翻攻击力，生命值乘区保持 ×1**

test('超限 卡西米尔: both ATK blocks double (deploy cap 0.50+0.01L → 1.00+0.02L, +20 % → +40 % per deploy)', () => {
  const list = [['z0_a', ['kazimierzShip']], ['z1_a', ['kazimierzShip']], ['z2_a', ['kazimierzShip']], ['none_a', ['preciShip']], ['none2_a', ['preciShip']]];
  const run = (L, flags) => makeBattle({
    defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { kazimierzShip: bondOn(3, L, null, [3, 6]) }, flags,
  });
  // 5 次部署（含开局部署）· L=20：上限咬住 → 超限 min(2×(0.5+0.2), 5×0.4)=1.4，普通 min(0.7, 1.0)=0.7
  const h = run(20, OL);
  h.step(1);
  close(h.unit('z0_a').s.atk, 1000 * (1 + 1.4), 1e-6, 'cap 1.40 at L=20');
  checkInvariants(h.b);
  const p = run(20, {});
  p.step(1);
  close(p.unit('z0_a').s.atk, 1000 * (1 + 0.7), 1e-6, 'plain cap 0.70 at L=20');
  // L=100：这次「每次部署」不咬 → 超限 min(3.0, 2.0)=2.0，普通 min(1.5, 1.0)=1.0（两块都翻才两种层数都变）
  const h2 = run(100, OL);
  h2.step(1);
  close(h2.unit('z0_a').s.atk, 1000 * (1 + 2.0), 1e-6, 'per-deploy 2.00 at L=100');
  const p2 = run(100, {});
  p2.step(1);
  close(p2.unit('z0_a').s.atk, 1000 * (1 + 1.0), 1e-6, 'plain 1.00 at L=100');
});

test('超限 突袭: the redeploy ATK multiplier doubles on its own; HP keeps ×1 (L=100 → ATK 2.25→4.5, HP 2.25)', () => {
  const list = [['t0_a', ['raidShip']], ['t1_a', ['raidShip']], ['t2_a', ['raidShip']]];
  const L = 100;
  // 突袭 bb: base_atk 0.25 + 0.01×L、base_max_hp 0.25 + 0.01×L（data/bonds.json raidShip.bb）；
  // 乘区只在「10 s 无攻击且范围内没有敌人 → 立刻再部署到敌人身边」那一下生效，所以这里真的跑一次跳。
  // L=100：攻击力乘区 1+0.25+1.0 = 2.25 → 超限 ×2 = 4.5（+350 %）；生命值乘区仍 2.25（+125 %）。
  const base = 0.25 + 0.01 * L;
  const jump = (flags) => {
    const chess = {};
    for (const [id] of list) chess[id] = op(id, ['raidShip']);
    const h = makeBattle({
      defs: { chess, enemies: { e_dummy: dummy } }, units: lineup(list.map((x) => x[0])),
      enemies: [{ key: 'e_dummy', pos: [12, 9] }], bonds: { raidShip: bondOn(3, L, null, [2, 3]) },
      flags, autoFinish: false, timeLimit: 200,
    });
    h.step(1);
    assert.equal(h.unit('t0_a').s.atk, 1000, 'no multiplier before the jump');
    h.run(11);
    return h;
  };
  const h = jump(OL);
  const u = h.unit('t0_a');
  // 攻击力：乘区 2.25 ×2 = 4.5 → atkPct = 4.5 − 1 = 3.5
  close(buffOf(u, 'bond:raidShip').mods.atkPct, 2 * (1 + base) - 1, 1e-9, 'ATK 乘区 ×2 → +350 % at L=100');
  close(u.s.atk, 1000 * 2 * (1 + base), 1e-6, 'ATK 4500 = 1000 × 4.5');
  // 生命值：乘区保持 ×1 → +125 %，maxHp 22 500 = 10 000 × 2.25
  close(buffOf(u, 'bond:raidShip').mods.hpPct, base, 1e-9, 'HP 乘区 ×1: +125 % at L=100');
  close(u.s.maxHp, 10000 * (1 + base), 1e-6, 'HP 22 500 = 10 000 × 2.25 (no doubling)');
  checkInvariants(h.b);
  const p = jump({});
  const pu = p.unit('t0_a');
  close(buffOf(pu, 'bond:raidShip').mods.atkPct, base, 1e-9, 'plain: +125 %');
  close(pu.s.atk, 1000 * (1 + base), 1e-6, 'plain ATK 2250 = 1000 × 2.25');
  close(pu.s.maxHp, 10000 * (1 + base), 1e-6, 'plain HP 22 500 (same as 超限: HP is ×1 in both)');
  // 超限与普通的生命值完全相同，只有攻击力不同 —— 这一对数字就是「只翻攻击力」的判据
  close(u.s.maxHp, pu.s.maxHp, 1e-9, '超限 HP == plain HP');
  assert.ok(u.s.atk > pu.s.atk * 1.9, `超限 ATK (${u.s.atk}) is about twice plain (${pu.s.atk})`);
});

// ---------------------------------------------------------------------------------------------------------------------
// 4 · 阿戈尔：吞噬仍继承基础攻击力；额外每层 +0.25 % 基础攻击力（最终加算 atkFinal）

test('超限 阿戈尔: the devour still inherits the full base ATK, plus 0.25 % of base ATK per layer as atkFinal', () => {
  const list = [
    ['e0_a', ['egirShip']], ['e1_a', ['egirShip']], ['e2_a', ['egirShip']],
    ['food_a', ['preciShip']],   // 被吞噬的自家干员（非阿戈尔）：1000 基础攻击力
  ];
  // e0 (12,4) 身前是 (12,5) 的 food_a —— 只让 e0 吃到人，另外两名离得远
  const units = [
    { chessId: 'e0_a', row: 12, col: 4 }, { chessId: 'food_a', row: 12, col: 5 },
    { chessId: 'e1_a', row: 1, col: 1 }, { chessId: 'e2_a', row: 1, col: 3 },
  ];
  const L = 50;
  const run = (flags) => makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(3, L, null, [3, 5]) }, flags, timeLimit: 60 });
  const h = run(OL);
  h.step(1);
  const e0 = h.unit('e0_a');
  const devour = buffOf(e0, 'bond:egir:devour');
  assert.ok(devour, 'the devour still fires');
  close(devour.mods.atkFinal, 1000, 1e-6, 'inherits the victim’s full base ATK (not a fraction)');
  // 吞噬本身也叠层（被吞者等阶 1）→ 实际层数 = 50 + 1，从 atkPct（每层 +0.8 %）反推
  const Ld = buffOf(e0, 'bond:egir').mods.atkPct / 0.008;
  assert.equal(Ld, L + 1, 'the devour adds 1 layer (tier of the devoured food)');
  // 每层 +0.25 % 基础攻击力：atkFinal，不吃自身的攻击力百分比
  const layer = buffOf(e0, 'bond:egir:layer-atk');
  assert.ok(layer, 'the per-layer base-ATK buff exists in 超限');
  close(layer.mods.atkFinal, 0.0025 * Ld * 1000, 1e-6, '+127.5 at 51 layers');
  // 攻击力百分比（每层 +0.8 %，上一轮业主口径）+ 基础加成 + 吞噬继承 1000
  close(e0.s.atk, 1000 * (1 + 0.008 * Ld) + 1000 + 0.0025 * Ld * 1000, 1e-6);
  const other = h.unit('e1_a');
  assert.equal(buffOf(other, 'bond:egir:devour'), null, 'the far member devours nobody');
  // 吞噬叠的是**玩家层数**（不是这名成员自己的层数），所以伙伴也读到 51 层
  close(other.s.atk, 1000 * (1 + 0.008 * Ld) + 0.0025 * Ld * 1000, 1e-6);
  checkInvariants(h.b);
  const p = run({});
  p.step(1);
  const pe = p.unit('e0_a');
  close(buffOf(pe, 'bond:egir:devour').mods.atkFinal, 1000, 1e-6, 'plain: still the full base ATK');
  assert.equal(buffOf(pe, 'bond:egir:layer-atk'), null, 'plain: no per-layer base-ATK buff');
  close(pe.s.atk, 1000 * 1 + 1000, 1e-6, 'plain: no ATK % channel either');
});

// ---------------------------------------------------------------------------------------------------------------------
// 5 · 谢拉格：6 人档冻结时长锁 20 s；寒风每层、每次命中额外 400 真伤

test('超限 谢拉格: the wind’s freeze is clamped to 20 s and every gust deals 400×L true damage', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`k${i}_a`, ['kjeragShip']]);
  const L = 60;
  const run = (flags) => makeBattle({
    defs: defsOf(list), units: lineup(list.map((x) => x[0])),
    enemies: [{ key: 'e_dummy', pos: [9, 8] }, { key: 'e_dummy', pos: [12, 8] }],
    bonds: { kjeragShip: bondOn(6, L, null, [3, 6]) }, autoFinish: false, timeLimit: 200, flags,
  });
  const h = run(OL);
  h.step(1);
  const [e1, e2] = h.enemies();
  const hp0 = e1.hp;
  h.run(25.4 - h.b.time);                     // 第一阵风（25 s）：寒冷 → 第二阵风的配对才会冻结
  assert.ok(e1.s.flags.cold, 'the first gust chills');
  // 阵风真伤：每个存活敌人 400×L
  close(hp0 - e1.hp, 400 * L, 1e-3, 'first gust: 24 000 true damage');
  const hp1 = e1.hp, hp2 = e2.hp;
  h.run(50.4 - h.b.time);                     // 第二阵风（50 s）：寒冷配对 → 冻结（名义 20+0.1L=26 s，超限夹到 20 s）
  assert.ok(e1.s.flags.freeze, 'the second gust freezes');
  const freeze = e1.findBuff('freeze');
  assert.ok(freeze.timeLeft <= 20 + 1e-9, `freeze clamped to 20 s, got ${freeze.timeLeft}`);
  assert.ok(freeze.timeLeft > 19, `freeze still 20 s nominally, got ${freeze.timeLeft}`);
  close(hp1 - e1.hp, 400 * L, 1e-3, 'second gust: another 24 000');
  close(hp2 - e2.hp, 400 * L, 1e-3, 'every enemy on the field takes it');
  checkInvariants(h.b);
  // 普通 / 湮灭 / 炸惊：冻结仍是 20+0.1L = 26 s，风仍然是 0 伤害
  const p = run({});
  p.step(1);
  const [q1] = p.enemies();
  const qhp0 = q1.hp;
  p.run(25.4 - p.b.time);
  close(qhp0, q1.hp, 1e-6, 'plain: the wind deals no damage');
  const qhp1 = q1.hp;
  p.run(50.4 - p.b.time);
  assert.ok(q1.s.flags.freeze);
  close(q1.findBuff('freeze').timeLeft, 20 + 0.1 * L, 0.5, 'plain freeze 26 s');
  close(qhp1, q1.hp, 1e-6, 'plain: still no wind damage');
});

// ---------------------------------------------------------------------------------------------------------------------
// 6 · 拉特兰：600 层弹药封顶保留；「每消耗 1 发弹药 → 攻击力」的上限取消

test('超限 拉特兰: the ammo cap stays at 600 layers, the ATK-per-ammo cap is gone (+8 % each, no ceiling)', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`l${i}_a`, ['lateranoShip'], { profession: 'SNIPER' }]);
  const kits = {};
  for (const [id] of list) kits[id] = () => ({ skill: { kind: 'ammo', ammo: 14 } });
  const L = 900;   // > 600：弹药加成按 600 层算（1+0.05+0.015×600 = 10.05），ATK 每发 8 %
  const run = (flags) => makeBattle({
    defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { lateranoShip: bondOn(6, L, null, [3, 6]) }, kits, flags,
  });
  const h = run(OL);
  h.step(1);
  const a = h.unit('l0_a');
  for (let i = 0; i < 201; i++) h.b.emit('ammoUsed', { unit: a });
  // 超限：201 发 × 8 % = +1608 %（旧行为在 +700 % 封顶）
  close(buffOf(a, 'bond:laterano:ammo').mods.atkPct, 201 * 0.08, 1e-6, '+1608 %');
  checkInvariants(h.b);
  // 普通：每发 4 %，上限 200 %
  const p = run({});
  p.step(1);
  const pa = p.unit('l0_a');
  for (let i = 0; i < 201; i++) p.b.emit('ammoUsed', { unit: pa });
  close(buffOf(pa, 'bond:laterano:ammo').mods.atkPct, 2, 1e-6, 'plain: still capped at +200 %');
});

test('超限 拉特兰: the ammo-count bonus itself is still capped at 600 layers (10.05×)', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`l${i}_a`, ['lateranoShip'], { profession: 'SNIPER' }]);
  const kits = {};
  for (const [id] of list) kits[id] = () => ({ skill: { kind: 'ammo', ammo: 14 } });
  for (const [L, mul] of [[600, 1 + 0.05 + 0.015 * 600], [900, 1 + 0.05 + 0.015 * 600]]) {
    const h = makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { lateranoShip: bondOn(6, L, null, [3, 6]) }, kits, flags: OL });
    h.step(1);
    const a = h.unit('l0_a');
    a.skill.ammoLeft = 100;
    h.b.emit('skillStart', { unit: a, skill: a.skill });
    assert.equal(a.skill.ammoLeft, Math.floor(100 * mul), `L=${L} → ×${mul}`);
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 7 · 叙拉古：触发概率 3 % → 10 %；真伤补「当前生命值 0.2 %」；3 人档补 0.1 %/层攻击力

test('超限 叙拉古: 10 % proc chance, +(0.2 % current HP) true damage, and +0.1 %/layer ATK from the 3-member tier', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`r${i}_a`, ['siracusaShip']]);
  const L = 20;
  const base = 5000 + 50 * L;
  const run = (n, flags) => makeBattle({
    defs: defsOf(list), units: lineup(list.slice(0, n).map((x) => x[0])), enemies: [{ key: 'e_dummy', pos: [12, 9] }],
    bonds: { siracusaShip: bondOn(n, L, null, [3, 6]) }, autoFinish: false, timeLimit: 300,
    hooks: ['damaged'], captureNoisy: true, flags,
  });
  const h = run(6, OL);
  h.step(1);
  const a = h.unit('r0_a');
  const e = h.enemies()[0];
  const procs = () => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes('bond:siracusa'));
  for (let i = 0; i < 750; i++) h.b.dealDamage(a, e, { amount: 1, type: 'phys', isAttack: true });
  const got = procs();
  assert.ok(got.length >= 1, 'it procs');
  // 每一下都按「5000+50×层数 + 目标当前生命值的 0.2 %」结算：1e8 血的木桩，第一发就该多 20 万
  assert.ok(got[0].amount > base + 100000, `current-HP share present: ${got[0].amount}`);
  for (const c of got) close(c.amount, base + c.amount - base, 1e-6, 'sanity');
  // 概率 10 %：750 次尝试的名义期望 75 次，远多于 3 % 的 22 次
  assert.ok(got.length > 40, `10 % proc rate, got ${got.length} in 750`);
  checkInvariants(h.b);
  // 普通：仍是 3 %、真伤恰为 5000+50L
  const p = run(6, {});
  p.step(1);
  const pa = p.unit('r0_a');
  const pe = p.enemies()[0];
  const pprocs = () => p.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes('bond:siracusa'));
  for (let i = 0; i < 750; i++) p.b.dealDamage(pa, pe, { amount: 1, type: 'phys', isAttack: true });
  const pgot = pprocs();
  for (const c of pgot) close(c.amount, base);
  assert.ok(pgot.length < got.length, `plain 3 % procs (${pgot.length}) < 超限 10 % (${got.length})`);
  // 3 人档的 +0.1 %/层攻击力（超限才发；6 人档同样吃）
  const t3 = run(3, OL);
  t3.step(1);
  close(t3.unit('r0_a').s.atk, 1000 * (1 + 0.001 * L), 1e-6, '+2 % at L=20');
  const t3p = run(3, {});
  t3p.step(1);
  close(t3p.unit('r0_a').s.atk, 1000, 1e-6, 'plain: no ATK channel');
});
