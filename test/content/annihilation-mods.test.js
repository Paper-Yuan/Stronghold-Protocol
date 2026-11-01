// test/content/annihilation-mods.test.js — 湮灭模拟（difficulty: 'ANNIHILATION'）的两个内容 mod。
//
// 每条效果都由**房间开关**（`gd.annMod(name)` / `battle.flags.annMods`）单独开门：
//   ① 阿戈尔加强（modref/mods/egir-buff）→ `egirBuff`
//   ② `chess[].annBonds`（罗德岛 / 卡兹戴尔）→ 各按自己的 `rhodesShip` / `kazdelShip`
//   ③ 通讯机 / 寻呼模块（modref/mods/comms-priority）→ `commsPriority`
// 开关的读写口径（2026-10-29 定稿）：缺省表在 shared/annihilation-constants.js —— `rhodesShip` / `kazdelShip` **默认开**，
// egirBuff / commsPriority 默认关；`battle.flags.annMods` 只带**显式**键（true 与 false 都带），缺省由 `annModOn` 兜。
// 所以本文件的开关矩阵有两个不同的「关」：
//   · 没有 `flags.annMods` 键 / 空对象 = **房间没动过设置** ⇒ 两条盟约**在**、另外两条关（默认口径）；
//   · `{ rhodesShip: false, kazdelShip: false }` = **真的全关** ⇒ 与「这批 mod 不存在」逐字节相同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, hashOf } from '../helpers/battleHarness.js';
import {
  annBondsOf, annBondsFor, annModOn, bondActive, bondLayers, gainLayers, isAnnihilationBattle, isMember, unitBonds,
} from '../../server/sim/content/support/index.js';
import { pieceBonds } from '../../server/match/bondsMeta.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';

const ANN = 'mode_single_annihilation';
const NORMAL = 'mode_multi_normal';
const EGIR = ['chess_char_1_04_a', 'chess_char_2_07_a', 'chess_char_3_05_a', 'chess_char_3_09_a', 'chess_char_4_09_a'];
const EGIR_STATE = { egirShip: { active: true, count: 5, tier: 2, layers: 100 } };

/**
 * 5 名【阿戈尔】干员、阿戈尔 100 层。`annMods` 是房间的**显式**开关（不传 = 房间没动过设置：两条盟约按缺省开，
 * egirBuff / commsPriority 关）。要「真的全关」得显式写 `{ rhodesShip: false, kazdelShip: false }`。
 * 摆位照 test/content/bonds_core.test.js 的「阿戈尔 5」用例：一人一行/隔列 —— 谁都吞噬不到谁，
 * 否则开局吞噬会先消耗复活名额，测不到「首次被击倒」。
 */
function egirBattle(modeId, annMods = null) {
  return makeBattle({
    units: EGIR.map((chessId, i) => ({ chessId, row: 9 + (i % 4), col: 3 + 2 * Math.floor(i / 4) })),
    seed: 7,
    modeId,
    bonds: EGIR_STATE,
    flags: annMods ? { startOpCooldown: 0, annMods } : { startOpCooldown: 0 },
    autoFinish: false,
    timeLimit: 600,
    captureNoisy: false,
  });
}

const EGIR_ON = { egirBuff: true };

test('isAnnihilationBattle：只认湮灭的两个 mode id（或显式 flag）', () => {
  assert.equal(isAnnihilationBattle({ modeId: ANN }), true);
  assert.equal(isAnnihilationBattle({ modeId: 'mode_multi_annihilation' }), true);
  assert.equal(isAnnihilationBattle({ modeId: NORMAL }), false);
  assert.equal(isAnnihilationBattle({ modeId: 'mode_single_zhajing' }), false);
  assert.equal(isAnnihilationBattle({ modeId: 'mode_single_hard' }), false);
  assert.equal(isAnnihilationBattle({ modeId: NORMAL, flags: { annihilation: true } }), true);
  assert.equal(isAnnihilationBattle(null), false);
});

test('阿戈尔①：开 egirBuff → 每名成员的基础面板攻击力 += 0.5×当前层数（固定加算）', () => {
  const on = egirBattle(ANN, EGIR_ON); on.step(1);
  const off = egirBattle(NORMAL); off.step(1);
  const L = bondLayers(on.b, 'p1', 'egirShip');
  assert.ok(L >= 100, `层数含开局吞噬：${L}`);
  const expected = 0.5 * L;
  for (const id of EGIR) {
    const a = on.unit(id), b = off.unit(id);
    assert.ok(a && b, `${id} 在场`);
    assert.ok(Math.abs((a.base.atk - b.base.atk) - expected) < 1e-9, `${id}: base.atk ${b.base.atk} → ${a.base.atk}（期望 +${expected}）`);
    // 是**基础面板**、不是乘区：有效攻击力随之抬高
    assert.ok(a.s.atk > b.s.atk, `${id}: s.atk ${b.s.atk} → ${a.s.atk}`);
  }
  assert.equal(on.b.errorCount, 0);
});

test('阿戈尔①反向：关掉 egirBuff（含官方四档）不加基础面板攻击力（逐字节不变）', () => {
  const a = egirBattle(NORMAL); a.step(1);
  const again = egirBattle(NORMAL); again.step(1);
  for (const id of EGIR) assert.equal(a.unit(id).base.atk, again.unit(id).base.atk);
  // 官方模式下的 base.atk 就是记录里的白值（没有 +50 那一笔）
  for (const id of EGIR) assert.ok(Math.abs(a.unit(id).base.atk - a.unit(id).def.stats.atk) < 1e-9, `${id} 白值未被改写`);
});

test('阿戈尔：生命公式与原版一致（湮灭不碰 HP 桶）', () => {
  const on = egirBattle(ANN, EGIR_ON); on.step(1);
  const off = egirBattle(NORMAL); off.step(1);
  for (const id of EGIR) {
    const a = on.unit(id), b = off.unit(id);
    assert.ok(Math.abs(a.s.maxHp - b.s.maxHp) < 1e-6, `${id}: maxHp ${b.s.maxHp} → ${a.s.maxHp}`);
    // 100 层 → base_max_hp 0.35 + 0.01×100 = 135% 加成（与模式无关）
    assert.ok(a.s.maxHp > a.base.maxHp, `${id} 吃到了层数 HP`);
  }
});

test('阿戈尔②：开 egirBuff 且 5 名档首次被击倒立即复活 → 额外 +50 攻速（关掉则没有）', () => {
  for (const [modeId, mods, want] of [[ANN, EGIR_ON, 50], [ANN, null, null], [NORMAL, EGIR_ON, null]]) {
    const h = egirBattle(modeId, mods);
    h.step(1);
    const u = h.unit(EGIR[0]);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true', canDodge: false, sourceless: true, tags: ['test'] });
    h.step(0.2);
    assert.equal(u.alive, true, `${modeId}/${JSON.stringify(mods)}: 官方复活逻辑把成员救了起来`);
    const buff = u.findBuff('bond:egir:revive-aspd');
    if (want == null) assert.ok(!buff, `${modeId}/${JSON.stringify(mods)}: 不该有复活攻速`);
    else {
      assert.ok(buff, `${modeId}: 复活攻速 buff 在`);
      assert.equal(buff.mods.aspd, want);
    }
    assert.equal(h.b.errorCount, 0);
  }
});

test('annBonds：缺省开时湮灭局的棋就拿到两条盟约；显式 false 才一条都没有；官方/炸惊永远没有', () => {
  const def = { bonds: ['yanShip'], raw: { annBonds: ['rhodesShip', 'kazdelShip'] } };
  const u = { kind: 'op', def, items: [], ownerId: 'p1' };
  assert.deepEqual(annBondsOf(def), ['rhodesShip', 'kazdelShip']);

  const ann = { modeId: ANN, players: [], allyUnits: [u], getPlayer: () => ({ bonds: {} }), flags: { annMods: { rhodesShip: true, kazdelShip: true } } };
  assert.deepEqual(annBondsFor(ann, def), ['rhodesShip', 'kazdelShip']);
  assert.deepEqual([...unitBonds(u, ann)], ['yanShip', 'rhodesShip', 'kazdelShip']);
  assert.equal(isMember(ann, u, 'rhodesShip'), true);

  // 模式不对（官方四档 / 炸惊）：即使有人误传开关也不并入
  for (const other of [{ modeId: NORMAL }, { modeId: 'mode_single_zhajing' }]) {
    const b = { ...other, flags: { annMods: { rhodesShip: true, kazdelShip: true } } };
    assert.deepEqual([...unitBonds({ ...u }, b)], ['yanShip'], `${other.modeId} 不并入 annBonds`);
    assert.equal(isMember({ ...b, allyUnits: [u], getPlayer: () => ({ bonds: {} }) }, u, 'rhodesShip'), false);
  }
  // 湮灭局、房间没动过设置（缺 annMods 键 / 空对象）：两条盟约按**缺省开**并入
  for (const flags of [{}, { annMods: {} }, undefined]) {
    const b = { modeId: ANN, ...(flags ? { flags } : {}) };
    assert.deepEqual([...unitBonds({ ...u }, b)], ['yanShip', 'rhodesShip', 'kazdelShip'], `${JSON.stringify(b)} 缺省开`);
    assert.deepEqual(annBondsFor(b, def), ['rhodesShip', 'kazdelShip']);
  }
  // 真的全关只能显式写 false：此时与「这批 mod 不存在」一样
  for (const annMods of [{ rhodesShip: false, kazdelShip: false }]) {
    const b = { modeId: ANN, flags: { annMods } };
    assert.deepEqual([...unitBonds({ ...u }, b)], ['yanShip'], `${JSON.stringify(annMods)} 全关`);
    assert.equal(annBondsFor(b, def).length, 0);
  }
  // 没传 battle 的调用方（老代码）行为不变
  assert.deepEqual([...unitBonds({ ...u })], ['yanShip']);
});

test('annBonds 各按自己的开关：显式关掉 kazdelShip 时只剩 rhodesShip（反之亦然）', () => {
  const def = { bonds: ['yanShip'], raw: { annBonds: ['rhodesShip', 'kazdelShip'] } };
  const u = { kind: 'op', def, items: [], ownerId: 'p1' };
  // 缺省两条都开 ⇒ 想只留一条必须把另一条显式关掉
  const rhodes = { modeId: ANN, flags: { annMods: { kazdelShip: false } } };
  const kazdel = { modeId: ANN, flags: { annMods: { rhodesShip: false } } };
  assert.deepEqual([...unitBonds({ ...u }, rhodes)], ['yanShip', 'rhodesShip']);
  assert.deepEqual([...unitBonds({ ...u }, kazdel)], ['yanShip', 'kazdelShip']);
  assert.equal(annModOn(rhodes, 'rhodesShip'), true, '没写过 ⇒ 缺省开');
  assert.equal(annModOn(rhodes, 'kazdelShip'), false, '显式 false 压过缺省');
  assert.equal(annModOn({ modeId: ANN, flags: {} }, 'rhodesShip'), true, '没有 flags.annMods 键也按缺省开');
});

// 两条新盟约（rhodesShip / kazdelShip）本轮**只做记录 + 计数/激活/档位 + 卡面展示，不做效果**（lead 2026-10-28 裁决）：
// 它们的 bb 里 sp_interval / regen_* / storm_* / true_damage_scale / bonus_attack_speed 在本仓一个读点都没有，
// 半套效果比没有更糟。所以这里断言的是「计得进、层数涨得了、但一条 buff 都没有」。
test('新盟约 rhodesShip / kazdelShip：湮灭局计进人数与层数，但**不施加任何 buff**', () => {
  const def = { bonds: ['yanShip'], raw: { annBonds: ['rhodesShip', 'kazdelShip'] } };
  const u = { kind: 'op', def, items: [], ownerId: 'p1', buffs: [] };
  const state = { rhodesShip: { active: true, count: 3, tier: 1, layers: 7 }, kazdelShip: { active: false, count: 1, tier: 0, layers: 0 } };
  const battle = {
    modeId: ANN,
    flags: { layerGainsEnabled: true, annMods: { rhodesShip: true, kazdelShip: true } },
    players: [{ playerId: 'p1', bonds: state }],
    allyUnits: [u],
    getPlayer: (pid) => (pid === 'p1' ? { playerId: 'p1', bonds: state } : null),
    addLayers: (pid, bond, n) => { const st = state[bond]; if (!st) return 0; st.layers += n; return n; },
  };

  // 计进成员（annBonds 只在湮灭局 + 对应开关打开时并入）
  assert.ok(unitBonds(u, battle).includes('rhodesShip'));
  assert.ok(unitBonds(u, battle).includes('kazdelShip'));
  // 激活与档位由通用引擎跑（记录与 thresholds 由数据侧提供；这里给的是玩家状态）
  assert.equal(bondActive(battle, 'p1', 'rhodesShip'), true);
  assert.equal(bondActive(battle, 'p1', 'kazdelShip'), false);
  assert.equal(bondLayers(battle, 'p1', 'rhodesShip'), 7);
  // 层数涨得了（走官方 gainLayers 通道，不需要任何新代码）
  gainLayers(battle, { playerId: 'p1', bonds: 'rhodesShip', n: 5, requireActive: true, reason: 'bond' });
  assert.equal(bondLayers(battle, 'p1', 'rhodesShip'), 12);
  // 但**没有效果**：我们没有任何 buff 施加（本模块不含 rhodesShip/kazdelShip 的 install/buff 分支）
  assert.deepEqual(u.buffs.filter((b) => /rhodes|kazdel/.test(String(b.key))), []);
});

test('annBonds（整备侧 pieceBonds）：模式门 + 每条盟约自己的开关', () => {
  const chess = { bonds: ['yanShip'], annBonds: ['rhodesShip', 'kazdelShip'] };
  const mkGd = (annihilation, mods = []) => ({
    annihilation,
    annMod: (name) => mods.includes(name),
    chess: () => chess,
    item: () => null,
    bond: (id) => ({ id }),
    zjCombos: null,
  });
  const all = ['rhodesShip', 'kazdelShip'];
  assert.deepEqual(pieceBonds(mkGd({ fog: {} }, all), { id: 'x' }), ['yanShip', 'rhodesShip', 'kazdelShip']);
  // 只开一条
  assert.deepEqual(pieceBonds(mkGd({ fog: {} }, ['rhodesShip']), { id: 'x' }), ['yanShip', 'rhodesShip']);
  // 开关全关 / 没有开关接口
  assert.deepEqual(pieceBonds(mkGd({ fog: {} }), { id: 'x' }), ['yanShip']);
  assert.deepEqual(pieceBonds({ ...mkGd({ fog: {} }), annMod: undefined }, { id: 'x' }), ['yanShip']);
  // 模式不对
  assert.deepEqual(pieceBonds(mkGd(null, all), { id: 'x' }), ['yanShip']);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 通讯机 / 寻呼模块（comms-priority）：核心盟约优先只在房间开关 annMods.commsPriority 打开时出现

/** 一个只会记账的 ctx：`rollChess` 记下被请求的 `bond` / `filter`，并返回一个假棋子 id。 */
function commsCtx({ commsPriority = false, annihilation = { fog: {} } } = {}) {
  const rolls = [];
  const gd = {
    annihilation,
    annMod: (name) => name === 'commsPriority' && commsPriority === true,
    bond: (id) => ({ id, isCore: id === 'yanShip' || id === 'egirShip', bondOrder: id === 'yanShip' ? 1 : 5 }),
    bondIds: ['yanShip', 'egirShip', 'preciShip'],
    item: () => ({ name: '简易通讯机' }),
    chess: (id) => ({ id, bonds: ['yanShip'] }),
  };
  const ctx = {
    gd,
    m: {},
    pieceBonds: () => ['preciShip', 'yanShip', 'egirShip'],
    layers: (id) => (id === 'egirShip' ? 40 : id === 'yanShip' ? 7 : 0),
    rollChess: (opts) => { rolls.push(opts); return `chess_${rolls.length}`; },
    grantChess: () => true,
    offerChess: () => true,
    shopLevel: () => 6,
    rng: Object.assign(() => 0.5, { pick: (arr) => arr[0] }),
    toast: () => {},
  };
  return { ctx, rolls, gd };
}

/** 取内置处理器：用真实 registerBuiltins 注册一个只带该 buff 的假 item 记录。 */
function builtinHandler(buffKey) {
  const reg = new MetaRegistry();
  registerBuiltins(reg, { items: { chess_item_probe_e: { buffs: [{ key: buffKey, bb: {} }] } } });
  return reg.get('item:chess_item_probe_e');
}

test('通讯机（开 commsPriority）：按「层数最高的核心盟约」优先抽人', () => {
  const h = builtinHandler('use_equip_reward_char_chess_with_same_bond');
  assert.ok(h && typeof h.onEquip === 'function');
  const { ctx, rolls } = commsCtx({ commsPriority: true });
  h.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
  // 核心盟约里 egirShip 层数(40) > yanShip(7) ⇒ 先请 egirShip；附加盟约排最后
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].bond, 'egirShip');
  assert.equal(rolls[0].maxTier, 6);
});

test('通讯机（官方四档 / 开关关）：仍走原来的「随机一个同盟约干员」（不请求具体盟约）', () => {
  const h = builtinHandler('use_equip_reward_char_chess_with_same_bond');
  for (const opts of [{ commsPriority: false }, { commsPriority: false, annihilation: null }]) {
    const { ctx, rolls } = commsCtx(opts);
    h.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].bond, undefined, '官方路径按 filter 抽，不指定盟约');
    assert.equal(typeof rolls[0].filter, 'function');
  }
});

test('寻呼模块（开 commsPriority）：同一次报价不重复，且按核心盟约优先', () => {
  const h = builtinHandler('use_equip_reward_special_goods_char_chess');
  assert.ok(h && typeof h.onEquip === 'function');
  const offers = [];
  const { ctx, rolls } = commsCtx({ commsPriority: true });
  ctx.offerChess = (ids) => offers.push(ids);
  ctx.rollChess = (opts) => { rolls.push(opts); return `c${rolls.length}`; };
  h.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
  assert.ok(offers.length === 1 && offers[0].length >= 1, `报了 ${offers.length} 次价`);
  assert.equal(rolls[0].bond, 'egirShip');
  // 第二次起带 filter（不重复）
  if (rolls.length > 1) assert.equal(typeof rolls[1].filter, 'function');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 开关矩阵（2026-10-29 口径）：缺省 = 两条盟约**开**、egirBuff / commsPriority 关；「真的全关」只能显式写 false。

const BOTH_BONDS = { bonds: ['yanShip'], raw: { annBonds: ['rhodesShip', 'kazdelShip'] } };
const ALL_OFF = { rhodesShip: false, kazdelShip: false };

test('开关矩阵① 默认：两条盟约在、egirBuff / commsPriority 仍关（阿戈尔数值与官方局逐字节相同）', () => {
  const dflt = egirBattle(ANN);           // 湮灭局，房间没动过设置（flags 里没有 annMods 键）
  const none = egirBattle(NORMAL);        // 官方四档：同样没有 annMods
  assert.equal(dflt.b.flags.annMods, undefined, '没有显式键时 battle.flags 里根本不长 annMods');
  dflt.step(1); none.step(1);
  // 两条盟约：按 shared 缺省表**开**
  assert.equal(annModOn(dflt.b, 'rhodesShip'), true, '缺省开');
  assert.equal(annModOn(dflt.b, 'kazdelShip'), true, '缺省开');
  assert.deepEqual(annBondsFor(dflt.b, BOTH_BONDS), ['rhodesShip', 'kazdelShip']);
  assert.deepEqual([...unitBonds({ kind: 'op', def: BOTH_BONDS, items: [], ownerId: 'p1' }, dflt.b)], ['yanShip', 'rhodesShip', 'kazdelShip']);
  // 另两条内容开关：缺省仍关
  assert.equal(annModOn(dflt.b, 'egirBuff'), false);
  assert.equal(annModOn(dflt.b, 'commsPriority'), false);
  // 阿戈尔没被加强：base.atk 就是白值（没有 +0.5×层数 那一笔），也没有复活攻速
  for (const id of EGIR) {
    assert.ok(Math.abs(dflt.unit(id).base.atk - dflt.unit(id).def.stats.atk) < 1e-9, `${id} 白值未被改写`);
    assert.ok(!dflt.unit(id).findBuff('bond:egir:revive-aspd'), `${id} 没有复活攻速`);
  }
  // 通讯机：走官方随机路径
  const h = builtinHandler('use_equip_reward_char_chess_with_same_bond');
  const { ctx, rolls } = commsCtx({ commsPriority: false });
  h.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
  assert.equal(rolls[0].bond, undefined);
  // 确定性（同一输入两遍哈希一致）；没用上的两条 mod 不影响阿戈尔数值
  assert.equal(hashOf(dflt.snapshot()), hashOf(egirBattle(ANN).step(1).snapshot()));
  for (const id of EGIR) assert.ok(Math.abs(dflt.unit(id).base.atk - none.unit(id).base.atk) < 1e-9);
});

test('开关矩阵①反向 显式全关：两条盟约也不在，与「这批 mod 不存在」逐字节相同', () => {
  const off = egirBattle(ANN, ALL_OFF);
  const none = egirBattle(NORMAL);
  assert.deepEqual({ ...off.b.flags.annMods }, ALL_OFF, '显式 false 会原样进 flags');
  off.step(1); none.step(1);
  assert.equal(annModOn(off.b, 'rhodesShip'), false, '显式 false 压过缺省');
  assert.deepEqual(annBondsFor(off.b, BOTH_BONDS), []);
  assert.deepEqual([...unitBonds({ kind: 'op', def: BOTH_BONDS, items: [], ownerId: 'p1' }, off.b)], ['yanShip']);
  for (const id of EGIR) {
    assert.ok(Math.abs(off.unit(id).base.atk - off.unit(id).def.stats.atk) < 1e-9, `${id} 白值未被改写`);
    assert.ok(Math.abs(off.unit(id).base.atk - none.unit(id).base.atk) < 1e-9, `${id} 与官方局同值`);
  }
  assert.equal(hashOf(off.snapshot()), hashOf(egirBattle(ANN, ALL_OFF).step(1).snapshot()));
});

test('开关矩阵② 只开 egirBuff：阿戈尔生效，通讯机仍关，两条盟约按缺省**在**', () => {
  const h = egirBattle(ANN, EGIR_ON);
  h.step(1);
  const u = h.unit(EGIR[0]);
  const L = bondLayers(h.b, 'p1', 'egirShip');
  assert.ok(Math.abs((u.base.atk - u.def.stats.atk) - 0.5 * L) < 1e-9, '阿戈尔攻击力生效');
  assert.equal(annModOn(h.b, 'egirBuff'), true);
  assert.equal(annModOn(h.b, 'commsPriority'), false);
  // 没写过的两条盟约开关 ⇒ 缺省开（挂这两条盟约的棋真的会拿到它们）
  assert.equal(annModOn(h.b, 'rhodesShip'), true);
  assert.equal(annModOn(h.b, 'kazdelShip'), true);
  assert.deepEqual(annBondsFor(h.b, BOTH_BONDS), ['rhodesShip', 'kazdelShip']);
  // 通讯机仍走官方
  const handler = builtinHandler('use_equip_reward_char_chess_with_same_bond');
  const { ctx, rolls } = commsCtx({ commsPriority: false });
  handler.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
  assert.equal(rolls[0].bond, undefined);
  // 想连同两条盟约一起关掉：显式 false
  const off = egirBattle(ANN, { ...EGIR_ON, ...ALL_OFF });
  assert.deepEqual(annBondsFor(off.b, BOTH_BONDS), [], '显式 false 才关');
});

test('开关矩阵③ 只开 commsPriority：通讯机生效，阿戈尔仍关，两条盟约按缺省**在**', () => {
  const h = egirBattle(ANN, { commsPriority: true });
  h.step(1);
  for (const id of EGIR) {
    assert.ok(Math.abs(h.unit(id).base.atk - h.unit(id).def.stats.atk) < 1e-9, `${id} 阿戈尔不生效`);
  }
  const handler = builtinHandler('use_equip_reward_char_chess_with_same_bond');
  const { ctx, rolls } = commsCtx({ commsPriority: true });
  handler.onEquip(ctx, { item: { id: 'chess_item_probe_e', uid: 'u1' }, target: { uid: 'p1' } });
  assert.equal(rolls[0].bond, 'egirShip', '通讯机走核心盟约优先');
  assert.deepEqual(annBondsFor(h.b, BOTH_BONDS), ['rhodesShip', 'kazdelShip'], '另两条开关不受 commsPriority 影响');
});

test('开关矩阵④ 关掉 kazdelShip：只剩挂 rhodesShip 的棋拿到它（一条一条地关）', () => {
  const b = { modeId: ANN, flags: { annMods: { kazdelShip: false } } };
  assert.deepEqual(annBondsFor(b, BOTH_BONDS), ['rhodesShip'], 'rhodesShip 是缺省开，只被关掉的是 kazdelShip');
  assert.deepEqual([...unitBonds({ kind: 'op', def: BOTH_BONDS, items: [], ownerId: 'p1' }, b)], ['yanShip', 'rhodesShip']);
  // 数据侧「只挂 kazdelShip」的棋：它自己那条被关了 ⇒ 拿不到；反过来没关的时候拿得到
  const kazdelOnly = { bonds: ['yanShip'], raw: { annBonds: ['kazdelShip'] } };
  assert.deepEqual(annBondsFor(b, kazdelOnly), []);
  assert.deepEqual(annBondsFor({ modeId: ANN, flags: {} }, kazdelOnly), ['kazdelShip'], '缺省开的时候拿得到');
  // 显式全开 = 缺省，两条都在
  assert.deepEqual(annBondsFor({ modeId: ANN, flags: { annMods: { rhodesShip: true, kazdelShip: true } } }, BOTH_BONDS),
    ['rhodesShip', 'kazdelShip']);
});

test('开关矩阵⑤ 官方四档 / 炸惊：四条内容开关一律 false，两条盟约一条都不并入', () => {
  for (const modeId of [NORMAL, 'mode_single_zhajing', 'mode_single_hard']) {
    const h = egirBattle(modeId);
    h.step(1);
    assert.equal(h.b.errorCount, 0, `${modeId} 无错误`);
    for (const name of ['egirBuff', 'commsPriority', 'rhodesShip', 'kazdelShip']) {
      assert.equal(annModOn(h.b, name), false, `${modeId}: ${name} 恒 false（模式门在前）`);
    }
    for (const id of EGIR) assert.ok(Math.abs(h.unit(id).base.atk - h.unit(id).def.stats.atk) < 1e-9);
  }
  // 连 flags 都没有的裸对象也不崩；但缺省的「开」只在湮灭局里成立
  assert.equal(annModOn({}, 'egirBuff'), false);
  assert.equal(annModOn({}, 'rhodesShip'), false, '没有 modeId ⇒ 不是湮灭局 ⇒ 缺省开也不成立');
  assert.equal(annModOn({ flags: {} }, 'egirBuff'), false);
  // 湮灭局、没有 flags：按缺省开；想关就得显式 false
  assert.deepEqual(annBondsFor({ modeId: ANN }, BOTH_BONDS), ['rhodesShip', 'kazdelShip']);
  assert.deepEqual(annBondsFor({ modeId: ANN, flags: { annMods: ALL_OFF } }, BOTH_BONDS), []);
});
