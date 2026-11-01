// test/content/annihilation-bonds-effects.test.js — 湮灭模拟（difficulty: 'ANNIHILATION'）两条专属盟约的**完整战斗效果**：
// 罗德岛 rhodesShip / 卡兹戴尔 kazdelShip（server/sim/content/bonds/addon/annbonds.js）。
//
// 数据（data/bonds.json，`annOnly: true`）带 10 + 11 个 `bb` 键（卡兹戴尔多一个 `count`：任务稿写「10+10」，
// 以 data 为准），包内没有处理器（modref v2.1 里 grep 不到 bondeffect_rhodes / bondeffect_kazdel），语义按数值 +
// 卡面文案反推，代码里每一条都用 `[ASSUMED]` 标了。本文件钉住三件事：
//   1. **开关关 = 这两个 mod 不存在**：只有湮灭局 + 该盟约自己的 `annMods` 开关打开才装；关掉时快照与「连记录状态都没有」
//      的那一局**逐字节相同**（hashOf），官方四档 / 炸惊即使误传开关也一字不动。
//   2. **开关开 = 每个 bb 键都有效果**：21 个键逐条数值断言（期望值全部从 data/bonds.json 现算，不抄常数）。
//   3. 静默失效守卫：DOMAIN_NAMES 真的注册了这个 domain；源码里没有 Math.random / 时钟；21 个键都有读点。
//
// 成员 = data 里该盟约的 `members`（也就是 chess.json 里 `annBonds` 含这条盟约的棋），本文件直接读数据摆上去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, hashOf } from '../helpers/battleHarness.js';
import { getData } from '../../server/data.js';
import { MODULES } from '../../server/sim/content/index.js';
import { bondLayers, gainLayers } from '../../server/sim/content/support/index.js';
import { payBreakHorns } from '../../server/sim/content/bonds/addon/annbonds.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const RB = DATA.bonds.rhodesShip.bb;
const KB = DATA.bonds.kazdelShip.bb;
/** 两条盟约的成员（data 里就是 chess.json `annBonds` 的边）。魔王 / 华法琳同属两条，去重后场上 7 人。 */
const RHODES = DATA.bonds.rhodesShip.members.slice();
const KAZDEL = DATA.bonds.kazdelShip.members.slice();
const ALL = [...new Set([...RHODES, ...KAZDEL])];

const ANN = 'mode_single_annihilation';
const NORMAL = 'mode_multi_normal';

/** 两条盟约都「激活」的玩家状态（显式关掉开关时它就是「记录存在但 mod 不存在」的对照）。 */
const BOTH_STATE = Object.freeze({
  rhodesShip: { active: true, count: 6, tier: 2, layers: 0 },
  kazdelShip: { active: true, count: 9, tier: 3, layers: 0 },
});

/** 显式关掉两条（缺省是开启的，所以「关」必须写出来）。 */
const OFF = Object.freeze({ rhodesShip: false, kazdelShip: false });

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** 摆一局：两条盟约的全部成员、可选敌人、可选开关与玩家盟约状态。 */
function mk({ modeId = ANN, bonds = {}, annMods = null, units = ALL, enemies = null, flags = {} } = {}) {
  return makeBattle({
    units: units.map((chessId, i) => ({ chessId, row: 9 + (i % 3), col: 2 + 2 * Math.floor(i / 3) })),
    enemies,
    seed: 7,
    modeId,
    bonds,
    flags: { startOpCooldown: 0, layerGainsEnabled: true, ...(annMods ? { annMods } : {}), ...flags },
    autoFinish: false,
    timeLimit: 600,
    captureNoisy: true,
  });
}

/** 一局里被本模块挂上的 buff（`bond:rhodesShip*` / `bond:kazdelShip*`）。 */
const ourBuffs = (u) => (u ? u.buffs.filter((b) => /^bond:(rhodesShip|kazdelShip)/.test(String(b.key))) : []);

/** 一条会眩晕 10 秒的敌人（40000 hp、0 法抗、不免疫眩晕）。 */
const sponge = () => ({ key: 'enemy_1006_shield_3', time: 0, routeIndex: 0 });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. 两道门：只有湮灭局 + 该盟约自己的开关打开才生效；两条盟约自 2026-10-29 起**缺省开启**

test('门①：官方四档 / 炸惊即使把两个开关都传进来，也一个 buff 都不挂（逐字节等于没有这两个 mod）', () => {
  for (const modeId of [NORMAL, 'mode_single_hard', 'mode_multi_abyss', 'mode_single_zhajing']) {
    const on = mk({ modeId, bonds: BOTH_STATE, annMods: { rhodesShip: true, kazdelShip: true } });
    const base = mk({ modeId, bonds: {}, annMods: null });
    on.run(0.5);
    base.run(0.5);
    for (const u of on.b.allyUnits) assert.deepEqual(ourBuffs(u), [], `${modeId} ${u.defId}: 不该有任何效果`);
    assert.equal(hashOf(on.snapshot()), hashOf(base.snapshot()), `${modeId}: 快照必须逐字节相同`);
    assert.equal(on.b.errorCount, 0);
  }
});

test('缺省开启：湮灭局没写 annMods（gd 只下发显式值）→ 两条盟约照样生效', () => {
  // 真实对局里 `gd.annihilationFlags()` 只放**显式**开关，缺省开启的两条不会出现在 flags 里 —— 必须按缺省开启算
  for (const flags of [undefined, {}, { annMods: {} }]) {
    const h = mk({ bonds: BOTH_STATE, annMods: null, flags: flags ?? {} });
    h.run(0.2);
    const u = h.unit('chess_char_4_26_a');   // 两条盟约的公共成员
    assert.ok(u.findBuff('bond:rhodesShip:stats'), `${JSON.stringify(flags)}: 罗德岛缺省生效`);
    assert.ok(u.findBuff('bond:kazdelShip:aspd'), `${JSON.stringify(flags)}: 卡兹戴尔 6 名档缺省生效`);
  }
});

test('显式 false 才关：两条都关 → 与「这两条盟约的状态根本不存在」逐字节相同', () => {
  const off = mk({ bonds: BOTH_STATE, annMods: { rhodesShip: false, kazdelShip: false } });
  const none = mk({ bonds: {}, annMods: { rhodesShip: false, kazdelShip: false } });
  off.run(1.2);
  none.run(1.2);
  assert.equal(hashOf(off.snapshot()), hashOf(none.snapshot()));
  for (const id of ALL) {
    const a = off.unit(id), b = none.unit(id);
    assert.ok(near(a.s.atk, b.s.atk) && near(a.s.maxHp, b.s.maxHp) && near(a.s.aspd, b.s.aspd), `${id} 白值没被改`);
    assert.deepEqual(ourBuffs(a), [], `${id} 没有 buff`);
  }
  assert.equal(off.b.errorCount, 0);
});

test('两条盟约各按自己的开关：显式关掉一条时另一条照常，两条都关才全哑', () => {
  // 魔王 / 华法琳 同时属于两条盟约，用同一个成员观察两边
  const both = 'chess_char_4_26_a';
  const rhodes = mk({ bonds: BOTH_STATE, annMods: { rhodesShip: true, kazdelShip: false } });
  rhodes.run(0.2);
  const ru = rhodes.unit(both);
  assert.ok(ru.findBuff('bond:rhodesShip:stats'), '罗德岛 3 名档生效');
  assert.equal(ru.findBuff('bond:kazdelShip:aspd'), null, '卡兹戴尔被显式关掉');

  const kazdel = mk({ bonds: BOTH_STATE, annMods: { rhodesShip: false, kazdelShip: true } });
  kazdel.run(0.2);
  const ku = kazdel.unit(both);
  assert.equal(ku.findBuff('bond:rhodesShip:stats'), null, '罗德岛被显式关掉');
  assert.ok(ku.findBuff('bond:kazdelShip:aspd'), '卡兹戴尔 6 名档生效');

  const off = mk({ bonds: BOTH_STATE, annMods: { rhodesShip: false, kazdelShip: false } });
  off.run(0.2);
  assert.deepEqual(ourBuffs(off.unit(both)), [], '两条都关 → 一条 buff 都没有');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. 罗德岛 rhodesShip（bb 10 键）

test('罗德岛 3 名档：base_atk / atk_per_stack / base_max_hp / max_hp_per_stack —— 攻击力与生命按层数线性涨', () => {
  for (const layers of [0, 100]) {
    const on = mk({ bonds: { rhodesShip: { active: true, count: RHODES.length, tier: 1, layers } }, annMods: { rhodesShip: true } });
    const base = mk({ bonds: {}, annMods: null });
    on.run(0.2);
    base.run(0.2);
    const wantAtk = RB.base_atk + RB.atk_per_stack * layers;
    const wantHp = RB.base_max_hp + RB.max_hp_per_stack * layers;
    for (const id of RHODES) {
      const a = on.unit(id), b = base.unit(id);
      const buff = a.findBuff('bond:rhodesShip:stats');
      assert.ok(buff, `${id} 有属性 buff`);
      assert.ok(near(buff.mods.atkPct, wantAtk), `${id} atkPct ${buff.mods.atkPct} ≠ ${wantAtk}`);
      assert.ok(near(buff.mods.hpPct, wantHp), `${id} hpPct ${buff.mods.hpPct} ≠ ${wantHp}`);
      assert.ok(a.s.atk > b.s.atk && a.s.maxHp > b.s.maxHp, `${id} 有效攻击力 / 最大生命都涨了`);
    }
  }
  // 干净的一局（只有一名成员、没有别的光环）上钉「直接乘算」：白值 ×(1 + 百分比)；层数越高越大
  const solo = (layers, annMods) => {
    const h = mk({ units: [RHODES[0]], bonds: { rhodesShip: { active: true, count: 3, tier: 1, layers } }, annMods });
    h.run(0.2);
    return h;
  };
  const at = [0, 100, 400].map((layers) => {
    const on = solo(layers, { rhodesShip: true });
    const base = solo(layers, OFF);
    const a = on.unit(RHODES[0]), b = base.unit(RHODES[0]);
    const wantAtk = RB.base_atk + RB.atk_per_stack * layers;
    const wantHp = RB.base_max_hp + RB.max_hp_per_stack * layers;
    assert.ok(near(a.s.atk, b.s.atk * (1 + wantAtk)), `层数 ${layers}: 攻击力 ${b.s.atk} → ${a.s.atk}（期望 ×${1 + wantAtk}）`);
    assert.ok(near(a.s.maxHp, b.s.maxHp * (1 + wantHp)), `层数 ${layers}: 最大生命 ${b.s.maxHp} → ${a.s.maxHp}`);
    return a.s.atk;
  });
  assert.ok(at[0] < at[1] && at[1] < at[2], '层数越高攻击力越大');
});

test('罗德岛：战斗中叠层 → 属性按新层数重算（layerGain 钩子，读活层数）', () => {
  const h = mk({ bonds: { rhodesShip: { active: true, count: RHODES.length, tier: 1, layers: 0 } }, annMods: { rhodesShip: true } });
  h.run(0.2);
  const u = h.unit(RHODES[0]);
  assert.ok(near(u.findBuff('bond:rhodesShip:stats').mods.atkPct, RB.base_atk), '初始 = base_atk');
  const added = gainLayers(h.b, { playerId: 'p1', bonds: 'rhodesShip', n: 100, requireActive: true, reason: 'bond' });
  assert.equal(added, 100);
  assert.equal(bondLayers(h.b, 'p1', 'rhodesShip'), 100);
  h.run(0.2);   // 层数在 layerGain 之后才记账，所以重算推迟到下一 tick
  assert.ok(near(u.findBuff('bond:rhodesShip:stats').mods.atkPct, RB.base_atk + RB.atk_per_stack * 100), '叠层后 atkPct 追上');
});

test('罗德岛 6 名档（power_bond_char_cnt）：heal_scale —— 受到的治疗效果提升', () => {
  const state = { rhodesShip: { active: true, count: 6, tier: 2, layers: 0 } };
  // 华法琳当治疗者、魔王当目标（休谟斯自身的特性拒收友方治疗，不适合当目标）
  const roster = [RHODES[1], RHODES[2]];
  const target = RHODES[1];
  const on = mk({ bonds: state, annMods: { rhodesShip: true }, units: roster });
  const off = mk({ bonds: state, annMods: OFF, units: roster });
  on.run(0.2);
  off.run(0.2);
  const a = on.unit(target), b = off.unit(target);
  const support = a.findBuff('bond:rhodesShip:support');
  assert.ok(support, '6 名档有 support buff');
  assert.ok(near(support.mods.healingTakenMul, 1 + RB.heal_scale), `healingTakenMul ${support.mods.healingTakenMul}`);
  // 同一笔治疗：开关开 → ×(1 + heal_scale)，关 → 原值
  for (const [h, u, want] of [[on, a, 100 * (1 + RB.heal_scale)], [off, b, 100]]) {
    u.hp = u.s.maxHp * 0.5;
    const healer = h.unit(RHODES[2]);
    const before = u.hp;
    h.b.heal({ source: healer, target: u, amount: 100 });
    const got = u.hp - before;
    assert.ok(near(got, want, 1e-6), `${u === a ? '开' : '关'}: 治疗 100 → 实际 ${got}（期望 ${want}）`);
  }
});

test('罗德岛 6 名档：sp_interval / sp_per_interval —— 每 2 秒 +1 技力（每个场上成员）', () => {
  const state = { rhodesShip: { active: true, count: 6, tier: 2, layers: 0 } };
  const on = mk({ bonds: state, annMods: { rhodesShip: true } });
  const off = mk({ bonds: state, annMods: OFF });
  on.run(0.2);
  off.run(0.2);
  on.hooks.spGain.length = 0;
  off.hooks.spGain.length = 0;
  const iv = RB.sp_interval;
  on.run(iv + 0.05);
  off.run(iv + 0.05);
  const bondGains = on.hooks.spGain.filter((c) => c.reason === 'bond');
  assert.equal(off.hooks.spGain.filter((c) => c.reason === 'bond').length, 0, '开关关 → 没有这条技力');
  const want = Math.round(RB.sp_per_interval);
  assert.ok(bondGains.length >= RHODES.length, `至少每个成员一次（得到 ${bondGains.length} 条）`);
  for (const c of bondGains) assert.equal(c.amount, want, `${c.unit?.defId} 每次 +${want} 技力`);
});

test('罗德岛 6 名档：regen_hp_scale —— 每秒回复 1% 最大生命（引擎的回复速度，不是治疗）', () => {
  const state = { rhodesShip: { active: true, count: 6, tier: 2, layers: 0 } };
  // 单人一局：没有魔王（吟游者）之类会给别人回血的光环，数值可以逐字节比较
  const on = mk({ bonds: state, annMods: { rhodesShip: true }, units: [RHODES[0]] });
  const off = mk({ bonds: state, annMods: OFF, units: [RHODES[0]] });
  on.run(0.2);
  off.run(0.2);
  const a = on.unit(RHODES[0]), b = off.unit(RHODES[0]);
  assert.ok(near(a.s.hpRegen - b.s.hpRegen, a.s.maxHp * RB.regen_hp_scale), `回复速度 ${b.s.hpRegen} → ${a.s.hpRegen}`);
  // 真的在回血
  a.hp = a.s.maxHp * 0.5;
  const before = a.hp;
  on.run(1.05);
  assert.ok(a.hp - before > a.s.maxHp * RB.regen_hp_scale * 0.9, `一秒钟回血 ${a.hp - before}`);
});

test('罗德岛 6 名档：regen_element_scale —— 每秒回复 1% 元素条容量（每条独立）', () => {
  const state = { rhodesShip: { active: true, count: 6, tier: 2, layers: 0 } };
  const on = mk({ bonds: state, annMods: { rhodesShip: true }, units: [RHODES[0]] });
  const off = mk({ bonds: state, annMods: OFF, units: [RHODES[0]] });
  on.run(0.2);
  off.run(0.2);
  for (const h of [on, off]) h.b.dealElementDamage({ source: null, target: h.unit(RHODES[0]), amount: 100, element: 'burn' });
  const a = on.unit(RHODES[0]), b = off.unit(RHODES[0]);
  assert.equal(a.elem.burn, 100);
  const want = a.gaugeMax * RB.regen_element_scale;
  const beforeA = a.elem.burn, beforeB = b.elem.burn;
  on.run(1.05);
  off.run(1.05);
  assert.ok(near(beforeA - a.elem.burn, want, 1e-6), `元素条回复 ${beforeA - a.elem.burn}（期望 ${want}）`);
  assert.equal(b.elem.burn, beforeB, '开关关 → 元素条不回复');
});

test('罗德岛 6 名档的门是 power_bond_char_cnt：只有 3 名（tier 1）时一条 6 名档效果都没有', () => {
  const state = { rhodesShip: { active: true, count: 3, tier: 1, layers: 0 } };
  // 单人一局（休谟斯）：没有吟游者之类会给别人回血的光环，回血速度可以逐字节比较
  const low = mk({ bonds: state, annMods: { rhodesShip: true }, units: [RHODES[0]] });
  const off = mk({ bonds: state, annMods: OFF, units: [RHODES[0]] });
  low.run(2.2);
  off.run(2.2);
  const u = low.unit(RHODES[0]);
  assert.ok(u.findBuff('bond:rhodesShip:stats'), '3 名档的属性还在');
  assert.equal(u.findBuff('bond:rhodesShip:support'), null, '没有 support buff');
  assert.equal(low.hooks.spGain.filter((c) => c.reason === 'bond').length, 0, '没有技力回复');
  assert.equal(u.s.hpRegen, off.unit(RHODES[0]).s.hpRegen, '没有额外的生命回复速度');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. 卡兹戴尔 kazdelShip（bb 10 键）

/** 一局卡兹戴尔 + 一只厚血敌人，用于伤害类断言。 */
function kazdelBattle({ count = 3, tier = 1, layers = 0, annMods = { kazdelShip: true }, extraFlags = {} } = {}) {
  return mk({
    bonds: { kazdelShip: { active: true, count, tier, layers } },
    annMods,
    enemies: [sponge()],
    flags: extraFlags,
  });
}

test('卡兹戴尔 3 名档：base_damage_scale / damage_scale_per_stack —— 对眩晕目标伤害 +20% +0.9%×层数', () => {
  for (const layers of [0, 50]) {
    const h = kazdelBattle({ layers });
    h.run(0.1);
    const u = h.unit(KAZDEL[0]);
    const e = h.enemy('enemy_1006_shield_3');
    h.b.applyStatus(e, 'stun', { duration: 30, source: u });
    const want = 1 + KB.base_damage_scale + KB.damage_scale_per_stack * layers;
    const before = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 1000, type: 'true', canDodge: false });
    assert.ok(near(before - e.hp, 1000 * want, 1e-6), `层数 ${layers}: 扣血 ${before - e.hp}（期望 ${1000 * want}）`);
    assert.equal(h.b.errorCount, 0);
  }
  // 开关关掉：同一笔伤害就是原值
  const off = kazdelBattle({ annMods: OFF });
  off.run(0.1);
  const u = off.unit(KAZDEL[0]);
  const e = off.enemy('enemy_1006_shield_3');
  off.b.applyStatus(e, 'stun', { duration: 30, source: u });
  const before = e.hp;
  off.b.dealDamage({ source: u, target: e, amount: 1000, type: 'true', canDodge: false });
  assert.ok(near(before - e.hp, 1000, 1e-6), '开关关 → 没有加成');
});

test('卡兹戴尔：眩晕 / 停顿 / 束缚 / 不动 四种受控都吃加成，普通目标不吃', () => {
  const h = kazdelBattle({ layers: 0 });
  h.run(0.1);
  const u = h.unit(KAZDEL[0]);
  const want = 1000 * (1 + KB.base_damage_scale);
  /** 每种控制用一个新敌人：同名状态会续时长，混在一起测不准。 */
  const cases = [
    ['眩晕 stun', (e) => h.b.applyStatus(e, 'stun', { duration: 30, source: u })],
    ['停顿 sluggish', (e) => h.b.applyStatus(e, 'sluggish', { duration: 30, source: u })],
    ['束缚 bind', (e) => h.b.applyStatus(e, 'bind', { duration: 30, source: u })],
    ['不动 noMove', (e) => h.b.addBuff(e, { key: 'test:noMove', flags: { noMove: true } })],
    ['普通（对照组）', () => {}],
  ];
  for (const [name, apply] of cases) {
    const e = h.spawn('enemy_1006_shield_3', { time: 0 });
    assert.ok(e, `${name}: 敌人上场`);
    apply(e);
    const expected = name.startsWith('普通') ? 1000 : want;
    const before = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 1000, type: 'true', canDodge: false });
    assert.ok(near(before - e.hp, expected, 1e-6), `${name}: 扣血 ${before - e.hp}（期望 ${expected}）`);
    h.b.kill(e);
  }
});

test('卡兹戴尔 6 名档（power_bond_char_cnt）：bonus_attack_speed —— 成员攻击速度 +50（点）', () => {
  const state = { kazdelShip: { active: true, count: 6, tier: 2, layers: 0 } };
  const on = mk({ bonds: state, annMods: { kazdelShip: true } });
  const off = mk({ bonds: state, annMods: OFF });
  on.run(0.2);
  off.run(0.2);
  for (const id of KAZDEL) {
    const a = on.unit(id), b = off.unit(id);
    const buff = a.findBuff('bond:kazdelShip:aspd');
    assert.ok(buff && buff.mods.aspd === KB.bonus_attack_speed, `${id} aspd 加成 ${buff && buff.mods.aspd}`);
    assert.ok(near(a.s.aspd - b.s.aspd, KB.bonus_attack_speed, 1e-6), `${id} 有效攻速 ${b.s.aspd} → ${a.s.aspd}`);
  }
});

test('卡兹戴尔 6 名档：true_damage_scale —— 普通攻击额外造成 20% 攻击力的真实伤害（溅射不重复）', () => {
  const state = { kazdelShip: { active: true, count: 6, tier: 2, layers: 0 } };
  const on = mk({ bonds: state, annMods: { kazdelShip: true }, enemies: [sponge()], units: KAZDEL });
  on.run(0.2);
  const u = on.unit(KAZDEL[0]);
  const e = on.enemy('enemy_1006_shield_3');
  /** 附加的那一笔真实伤害（按结算前的作者值看，不受目标脆弱之类的倍率影响）。 */
  const tagged = (h) => h.hooks.hit.filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('bond:kazdelShip:true'));
  on.hooks.hit.length = 0;
  on.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true, canDodge: false });
  // 「当前攻击力」按这一击的时点读：伊内丝自己的特性（ines:atkGain）会在这次攻击里抬高她的攻击力
  const want = u.s.atk * KB.true_damage_scale;
  const extra = tagged(on);
  assert.equal(extra.length, 1, `一次普攻只附加一次（得到 ${extra.length}）`);
  assert.equal(extra[0].dmg.type, 'true');
  assert.equal(extra[0].dmg.isAttack, false, '附加的那笔不是攻击（不会再触发自己）');
  assert.ok(near(extra[0].dmg.amount, want, 1e-6), `真实伤害 ${extra[0].dmg.amount}（期望 ${want}）`);
  // 溅射那份不再附加；非攻击伤害（技能 / 环境）也不附加
  on.hooks.hit.length = 0;
  on.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true, isSplash: true, canDodge: false });
  assert.equal(tagged(on).length, 0, '溅射不附加');
  on.hooks.hit.length = 0;
  on.b.dealDamage({ source: u, target: e, amount: 100, type: 'true', isAttack: false, canDodge: false });
  assert.equal(tagged(on).length, 0, '非攻击不附加');
  // 开关关：一笔都不附加
  const off = mk({ bonds: state, annMods: OFF, enemies: [sponge()], units: KAZDEL });
  off.run(0.2);
  off.hooks.hit.length = 0;
  off.b.dealDamage({ source: off.unit(KAZDEL[0]), target: off.enemy('enemy_1006_shield_3'), amount: 100, type: 'phys', isAttack: true, canDodge: false });
  assert.equal(tagged(off).length, 0);
});

test('卡兹戴尔 9 名档（storm_char_cnt）：storm_atk_scale —— 活性源石风暴每秒 20%×攻击力总和 的无来源真实伤害', () => {
  const h = kazdelBattle({ count: 9, tier: 3, layers: 0 });
  h.run(0.2);
  const sum = () => KAZDEL.reduce((n, id) => { const u = h.unit(id); return n + (u.alive && u.deployed ? u.s.atk : 0); }, 0);
  const want = sum() * KB.storm_atk_scale;
  const stormOf = (x) => x.hooks.hit.filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('bond:kazdelShip:storm'));
  h.hooks.hit.length = 0;
  h.run(2.05);
  const storm = stormOf(h);
  assert.equal(storm.length, 2, `2 秒两次（得到 ${storm.length}）`);
  let dealt = 0;
  for (const c of storm) {
    assert.equal(c.source, null, '无来源');
    assert.equal(c.dmg.type, 'true');
    assert.ok(near(c.dmg.amount, want, 1e-6), `每次 ${c.dmg.amount}（期望 ${want}）`);
    dealt += c.dmg.amount;
  }
  // 同一只海绵敌人也在全体成员的普攻射程里，成员自己的攻击同样扣它的血 —— 所以「海绵掉血」不是风暴的读数，
  // 这里只统计风暴这几跳之和（数据里的风暴本来就是每秒一次的全场无来源伤害）。
  assert.ok(near(dealt, want * 2, 1e-6), `两秒风暴共 ${dealt}（期望 ${want * 2}）`);
  assert.equal(h.b.errorCount, 0);
});

test('卡兹戴尔 9 名档：storm_base_damage_scale / storm_damage_scale_per_stack —— 风暴对受控目标再 +10% +0.45%×层数', () => {
  for (const layers of [0, 100]) {
    const h = kazdelBattle({ count: 9, tier: 3, layers });
    h.run(0.2);
    const u = h.unit(KAZDEL[0]);
    const e = h.enemy('enemy_1006_shield_3');
    h.b.applyStatus(e, 'stun', { duration: 60, source: u });
    let sum = 0;
    for (const id of KAZDEL) { const x = h.unit(id); if (x.alive && x.deployed) sum += x.s.atk; }
    const want = sum * KB.storm_atk_scale * (1 + KB.storm_base_damage_scale + KB.storm_damage_scale_per_stack * layers);
    h.hooks.hit.length = 0;
    h.run(1.05);
    const storm = h.hooks.hit.filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('bond:kazdelShip:storm'));
    assert.equal(storm.length, 1, '1 秒一次');
    assert.ok(near(storm[0].dmg.amount, want, 1e-6), `层数 ${layers}: ${storm[0].dmg.amount}（期望 ${want}）`);
  }
});

test('卡兹戴尔 9 名档的门是 storm_char_cnt：6 名档没有风暴', () => {
  const h = kazdelBattle({ count: 6, tier: 2, layers: 0 });
  h.run(0.2);
  h.hooks.hit.length = 0;
  h.run(2.05);
  const storm = h.hooks.hit.filter((c) => c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('bond:kazdelShip:storm'));
  assert.equal(storm.length, 0, '6 名档不召唤风暴');
  assert.ok(h.unit(KAZDEL[0]).findBuff('bond:kazdelShip:aspd'), '6 名档自身的效果还在');
});

test('卡兹戴尔 layer / count：每 100 层发 1 件「萨卡兹的断角」（整备侧计里程碑，物品由数据指定）', () => {
  const rec = DATA.bonds.kazdelShip;
  const reward = rec.buffs.find((b) => b.key === 'bond_layer_added_reward_equip');
  assert.ok(reward, '记录里有断角里程碑');
  assert.equal(reward.bb.layer, KB.layer, 'bb.layer 与里程碑的 layer 是同一个数');
  assert.equal(reward.bb.count, KB.count);

  /** 假 ctx：只记账（计数器 / 发放），数据用真的记录。 */
  const fake = (layers, { active = true, haveItems = null } = {}) => {
    const counters = new Map();
    const granted = [];
    const ctx = {
      bondActive: (id) => active && id === 'kazdelShip',
      layers: (id) => (id === 'kazdelShip' ? layers : 0),
      counter: (k) => counters.get(k) ?? 0,
      setCounter: (k, v) => { counters.set(k, v); },
      grantItem: (id) => { granted.push(id); return haveItems == null ? true : haveItems.has(id); },
      data: DATA,
      gd: { bond: (id) => DATA.bonds[id] ?? null },
    };
    return { ctx, counters, granted };
  };

  const two = fake(250);
  assert.equal(payBreakHorns(two.ctx), 2, '250 层 = 两个里程碑');
  assert.deepEqual(two.granted, [reward.bbStr.reward_item, reward.bbStr.reward_item]);
  // 再调一次不重复发（计数器）
  assert.equal(payBreakHorns(two.ctx), 0);
  assert.equal(two.granted.length, 2);
  // 99 层 = 一件都没有
  const zero = fake(99);
  assert.equal(payBreakHorns(zero.ctx), 0);
  assert.deepEqual(zero.granted, []);
  // 盟约没激活：不发（官方「叠加的盟约…只有在盟约被激活时才会发挥作用」）
  const inactive = fake(300, { active: false });
  assert.equal(payBreakHorns(inactive.ctx), 0);
  assert.deepEqual(inactive.granted, []);
  // 物品不在本仓装备表里（见数据缺口）：里程碑照常计数，发不出去也不抛
  const missing = fake(150, { haveItems: new Set() });
  assert.equal(payBreakHorns(missing.ctx), 0, '发不出去 → 0 件');
  assert.equal(missing.counters.get('bond:kazdelShip:horns'), 1, '但里程碑已经被记下（不会每层重试）');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. 静默失效守卫

test('静默失效守卫：DOMAIN_NAMES 注册了 annbonds（漏一行 = 21 个键全哑且不报错）', () => {
  const names = MODULES.map(([n]) => n);
  assert.ok(names.includes('bonds/addon/annbonds'), `DOMAIN_NAMES 缺 bonds/addon/annbonds: ${names.join(',')}`);
  const mod = MODULES.find(([n]) => n === 'bonds/addon/annbonds')[1];
  assert.equal(typeof mod.install, 'function', 'install 装上了（文件没被 safeImport 吞掉）');
  assert.equal(typeof mod.registerMeta, 'function', 'registerMeta 装上了（断角里程碑）');
  // 排在 bonds 之后：读层数 / 成员时官方的钩子已经先装
  assert.ok(names.indexOf('bonds/addon/annbonds') > names.indexOf('bonds'));
});

test('静默失效守卫：每个 bb 键在源码里都有读点，且没有 Math.random / 时钟', () => {
  // 先剥掉注释再判（文件头的说明里就写着「没有 Math.random」）
  const src = readFileSync(join(ROOT, 'server/sim/content/bonds/addon/annbonds.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const keys = [...Object.keys(RB), ...Object.keys(KB)];
  assert.equal(Object.keys(RB).length, 10, '罗德岛 10 个 bb 键');
  // 卡兹戴尔是 11 个（任务稿写「10+10」，data 里多一个 `count`：断角里程碑每次发几件）
  assert.equal(Object.keys(KB).length, 11, '卡兹戴尔 11 个 bb 键');
  for (const k of keys) assert.ok(src.includes(k), `annbonds.js 没读 ${k}`);
  assert.equal(/Math\.random|Date\.now|performance\.now/.test(src), false, '确定性红线：不能有随机 / 时钟');
});

test('确定性：同一输入跑两遍，快照逐字节相同（含风暴与真实伤害的每一跳）', () => {
  const run = () => {
    const h = mk({ bonds: BOTH_STATE, annMods: { rhodesShip: true, kazdelShip: true }, enemies: [sponge()] });
    h.run(3.2);
    assert.equal(h.b.errorCount, 0);
    return h;
  };
  const a = run(), b = run();
  assert.equal(hashOf(a.snapshot()), hashOf(b.snapshot()));
});
