// test/match/mode-isolation-matrix.test.js — 全模式隔离矩阵：每个模式「能看到的池子 = 它应有的精确集合」。
//
// 判据与 devtools/check-mode-isolation.mjs 同源（那边是可打印矩阵表的 CLI 形态，本文件是 node --test 形态）。
// 更深的逐字节对照（把 zj 记录从数据里剥掉再比）在 devtools/check-zhajing-isolation.mjs；
// 设计依据：handoff/ZHAJING-COVERAGE.md（验收矩阵）与 handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2。
//
// 覆盖的模式：mode_training_1、官方 4 档 × 单人/同盟（8 个）、湮灭 2 个、炸惊 2 个，以及超限房
// （`solo_infinite` / `coop_infinite` 推出的 modeId —— 它们是**房间级开关**，不新增模式记录）。
// 每个模式断言的池子：visibleChess（长度 + 精确集合 + 不含对方棋库）、shopItemsByTier（zjOnly 进不进）、
// bandIds()、bondIds + 逐条 bond()（无 zj 键泄漏）、bans()、bossWeights()、stages、spRounds()/spPhaseKind()。
// 三条方向性断言：① 只有湮灭有藏品/毒雾 ② 只有炸惊有惊变/白值膨胀/炸惊棋库 ③ 官方四档互相同构。
// 外加：data/versions/*（3 个历史版本目录 + 缺省版本）不得长出玩法包字段。
//
// Run: node --test test/match/mode-isolation-matrix.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getData, loadData, versionDataDir, VERSION_DATA_FILES } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { DIFFICULTIES, modeIdFor } from '../../shared/constants.js';
import { SOLO_INFINITE, COOP_INFINITE } from '../../shared/infiniteMode.js';
import { DEFAULT_VERSION, VERSIONS } from '../../shared/versions.js';

const data = getData();
const MODES = data.config.modes;

/** The data with every 炸惊 record removed — what every non-ZHAJING mode must look like. */
function stripped(d) {
  const chess = {};
  for (const [id, r] of Object.entries(d.chess)) if (r.zhajing !== true) chess[id] = r;
  const items = {};
  for (const [id, r] of Object.entries(d.items)) if (r.zjOnly !== true) items[id] = r;
  const bands = {};
  for (const [id, r] of Object.entries(d.bands)) if (r.zjOnly !== true) bands[id] = r;
  const bonds = {};
  for (const [id, r] of Object.entries(d.bonds)) {
    if (r.zjOnly === true) continue;
    const { zj, ...rest } = r;
    bonds[id] = rest;
  }
  return { ...d, chess, items, bands, bonds };
}
const bare = stripped(data);

const kindOf = (mode) => (mode.jibian ? 'zhajing' : mode.annihilation ? 'annihilation' : mode.difficulty === 'TRAINING' ? 'training' : 'official');
/** The shop pool as a flat sorted list of `tier:id`. */
const shopPool = (g) => Object.entries(g.shopItemsByTier).flatMap(([t, ids]) => ids.map((id) => `${t}:${id}`)).sort();

/** The official roster, straight from the documented filter (visible && !zhajing && not golden/diy/hidden && integer tier). */
const OFFICIAL_ROSTER = Object.keys(data.chess).filter((id) => {
  const c = data.chess[id];
  return c.visible === true && c.zhajing !== true && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
}).sort();
/** The 炸惊 roster the data describes: `zhajing: true`, not golden/diy/hidden, and not `grantOnly` (see the KNOWN-BUG test). */
const ZJ_ROSTER = Object.keys(data.chess).filter((id) => {
  const c = data.chess[id];
  return c.zhajing === true && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true && Number.isInteger(c.tier);
}).sort();

const OFFICIAL_IDS = Object.keys(MODES).filter((id) => kindOf(MODES[id]) === 'official').sort();
const ALL_IDS = Object.keys(MODES).sort();

// ---------------------------------------------------------------------------------------------------------------
// 0. 模式清单本身：新增模式必须在这里登记（否则矩阵会「悄悄漏掉一个模式」）
// ---------------------------------------------------------------------------------------------------------------
test('模式清单：13 个 mode，四类齐全（training 1 / 官方 8 / 湮灭 2 / 炸惊 2）', () => {
  const byKind = {};
  for (const id of ALL_IDS) (byKind[kindOf(MODES[id])] ||= []).push(id);
  assert.deepEqual(byKind.training, ['mode_training_1']);
  assert.deepEqual(byKind.official, [
    'mode_multi_abyss', 'mode_multi_funny', 'mode_multi_hard', 'mode_multi_normal',
    'mode_single_abyss', 'mode_single_funny', 'mode_single_hard', 'mode_single_normal',
  ]);
  assert.deepEqual(byKind.annihilation, ['mode_multi_annihilation', 'mode_single_annihilation']);
  assert.deepEqual(byKind.zhajing, ['mode_multi_zhajing', 'mode_single_zhajing']);
  assert.equal(ALL_IDS.length, 13, '模式总数变了：新玩法包要同时在四张表里登记');
});

// ---------------------------------------------------------------------------------------------------------------
// 1. 官方 8 + 训练：池子逐项等于「剥掉 zj 记录」的基线，且一条 zj 记录都不许到
// ---------------------------------------------------------------------------------------------------------------
for (const modeId of [...OFFICIAL_IDS, 'mode_training_1']) {
  test(`${modeId}：官方池子 = 基线（112 棋 / 51 道具 / 40 策略 / 23 盟约），零 zj 泄漏`, () => {
    const g = new GameData(data, modeId);
    const gb = new GameData(bare, modeId);

    assert.equal(g.zhajing, false, 'gd.zhajing');
    assert.deepEqual(g.visibleChess, OFFICIAL_ROSTER, 'visibleChess 必须逐项等于官方名册');
    assert.equal(g.visibleChess.length, 112, '官方可见棋 112 条');
    assert.deepEqual(g.visibleChess, gb.visibleChess, 'visibleChess 与 zj-free 基线逐项相等');
    assert.equal(g.visibleChess.filter((id) => data.chess[id].zhajing === true).length, 0, '零条 zhajing 棋');

    assert.equal(shopPool(g).length, 51, '商店池 51 件');
    assert.deepEqual(shopPool(g), shopPool(gb), '商店池与基线逐项相等');
    assert.equal(shopPool(g).filter((k) => data.items[k.split(':')[1]].zjOnly === true).length, 0, '零件 zjOnly 道具');

    assert.equal(g.bandIds().length, 40, '策略池 40 条');
    assert.deepEqual(g.bandIds(), gb.bandIds(), '策略池与基线逐项相等');
    assert.equal(g.bandIds().filter((b) => data.bands[b].zjOnly === true).length, 0, '零条 zjOnly 策略');

    assert.equal(g.bondIds.length, 23, '盟约 23 条');
    assert.deepEqual(g.bondIds, gb.bondIds, 'bondIds 与基线相等');
    for (const id of g.bondIds) {
      assert.deepEqual(g.bond(id), gb.bond(id), `盟约 ${id} 的记录与基线逐字节相同`);
      assert.equal(Object.hasOwn(g.bond(id), 'zj'), false, `盟约 ${id} 不许带 zj 键`);
    }

    const want = data.config.bans[g.difficulty];
    assert.deepEqual(g.bans(g.difficulty), { core: want.core, addon: want.addon }, `bans = config.bans.${g.difficulty}`);
    assert.deepEqual(g.bossWeights(false), gb.bossWeights(false), 'bossWeights 与基线相等');
    assert.ok(Array.isArray(MODES[modeId].stages) && MODES[modeId].stages.length > 0, 'stages 非空');
    assert.deepEqual(g.spRounds(), (MODES[modeId].spRounds || []).filter((n) => Number.isInteger(n)), 'spRounds = mode 记录');
    for (const r of g.spRounds()) assert.equal(g.spPhaseKind(r), null, `官方模式的 spPhaseKind(${r}) 必须是 null`);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. 湮灭 2 个：有藏品与毒雾门，池子仍与基线一致（zj 不许影响它）
// ---------------------------------------------------------------------------------------------------------------
for (const modeId of ['mode_single_annihilation', 'mode_multi_annihilation']) {
  test(`${modeId}：有藏品/毒雾，池子 = 基线，无惊变门`, () => {
    const g = new GameData(data, modeId);
    const gb = new GameData(bare, modeId);

    assert.equal(g.difficulty, 'ANNIHILATION');
    assert.ok(g.annihilation, 'gd.annihilation 非 null');
    assert.deepEqual(g.annihilation.fog, { afterReal: 60, rampReal: 20, maxRatio: 0.2, targets: 'allies' }, '毒雾配置（真实秒）');
    assert.equal(g.annihilation.terrainLethal, 5);
    assert.equal(g.annihilation.chaosTargeting, true);
    // 战斗 flags 里的是**游戏秒**：× combatTimeScale（客户端与服务端同一份口径）
    assert.equal(g.combatTimeScale, 2, '湮灭的战斗时间倍率');
    assert.deepEqual(g.annihilationFlags('normal', 1), {
      terrainLethal: 5, chaosTargeting: true,
      fog: { at: 60 * g.combatTimeScale, ramp: 20 * g.combatTimeScale, ratio: 0.2 },
    }, '战斗 flags（游戏秒）');
    // 终局攻势与其后的隐藏核心没有毒雾
    assert.equal(g.annihilationFlags('boss', g.bossRound).fog, undefined, 'Boss 轮无毒雾');
    assert.equal(g.annihilationFlags('hidden', g.hiddenRound).fog, undefined, '隐藏核心无毒雾');

    // 湮灭的两条内容 mod 缺省开 ⇒ 名册 = 官方 112 + mod 自带的 13 个干员位（26 条记录的基础形）= 125。
    // 这 13 个位是 `annihilation: true` + `visible: false`，官方四档（上面的 OFFICIAL_ROSTER）永远看不见。
    const ANN_BROUGHT = Object.keys(data.chess).filter((id) => {
      const c = data.chess[id];
      return c.annihilation === true && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
    }).sort();
    assert.deepEqual(g.visibleChess, [...OFFICIAL_ROSTER, ...ANN_BROUGHT].sort(), '湮灭 = 官方名册 + mod 自带干员（默认开关）');
    assert.equal(g.visibleChess.length, 125);
    assert.equal(ANN_BROUGHT.length, 13);
    assert.equal(g.visibleChess.filter((id) => data.chess[id].zhajing === true).length, 0);
    assert.deepEqual(shopPool(g), shopPool(gb), '商店池与基线相等');
    assert.equal(g.bandIds().length, 40);
    assert.deepEqual(g.bondIds, gb.bondIds, 'bondIds 与基线相等');

    // 蚀流 1 的 ban 数由豁免池算出（ceil(total/3)，下限 5），不是 config.bans 的固定值
    const core = g.bondIds.filter((id) => g.bond(id)?.isCore).length;
    const addon = g.bondIds.filter((id) => { const b = g.bond(id); return b && !b.isCore && id !== 'suntShip'; }).length;
    assert.deepEqual(g.bans('ANNIHILATION'), { core: Math.max(5, Math.ceil(core / 3)), addon: Math.max(5, Math.ceil(addon / 3)) }, '蚀流 1 的 bans');

    // 湮灭没有惊变/白值膨胀/战惊棋库
    assert.equal(g.jibian(), null);
    assert.equal(g.enemyJibian(), null);
    assert.equal(g.allyScale, null);
    assert.equal(g.zjCombos, null);
    assert.equal(g.bondLayerCap, null);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 3. 炸惊 2 个：棋库/惊变/白值/装备组合都在，且只有它
// ---------------------------------------------------------------------------------------------------------------
for (const modeId of ['mode_single_zhajing', 'mode_multi_zhajing']) {
  test(`${modeId}：炸惊棋库 97 + 惊变池 99/21 + 白值 3/3/2.5 + zj 覆盖已合并`, () => {
    const g = new GameData(data, modeId);

    assert.equal(g.difficulty, 'ZHAJING');
    assert.equal(g.zhajing, true);
    assert.equal(g.annihilation, null, '炸惊没有藏品/毒雾');

    // 棋库 = 名册（`zhajing: true` 且非 grantOnly）**逐项相等**：grantOnly 的重岳 / 白铁只由「祀」策略发放，
    // 不进卡池/商店（`gamedata.js` 的 visibleChess 已按参考包补上 `c.grantOnly === true` 这一条）。
    assert.equal(g.visibleChess.length, 97, '炸惊棋库 97 条（99 名册 − 2 条 grantOnly）');
    assert.equal(g.visibleChess.filter((id) => data.chess[id].zhajing === true).length, 97, '全部是 zhajing 记录');
    assert.equal(g.visibleChess.filter((id) => data.chess[id].zhajing !== true).length, 0, '零条官方棋混入');
    assert.deepEqual(g.visibleChess, ZJ_ROSTER, '棋库 = 名册（无 grantOnly 记录）');
    for (const id of ['chess_zj_chyue_a', 'chess_zj_ironmn_a']) {
      assert.equal(data.chess[id].grantOnly, true, `${id} 仍是 grantOnly`);
      assert.ok(!g.visibleChess.includes(id), `${id} 不得进炸惊卡池`);
    }

    // 惊变
    const jb = g.jibian();
    const ej = g.enemyJibian();
    assert.equal(jb.pool.length, 99, '我方惊变 99 张');
    assert.equal(ej.pool.length, 21, '敌方惊变 21 张');
    assert.equal(jb.cards, 3);
    assert.equal(jb.rerolls, 4);
    assert.deepEqual(jb.rarityWeights, [['normal', 35], ['rare', 30], ['epic', 20], ['legend', 10], ['hidden', 5]]);
    assert.deepEqual(ej.rounds, [1, 6], '敌方惊变在第 1、6 回合各抽一次');

    // 白值膨胀 / 层数上限 / 装备组合 / 专属策略与道具
    assert.deepEqual(g.allyScale, { hp: 3, def: 3, atk: 2.5 });
    assert.equal(g.bondLayerCap, 9999);
    assert.ok(Array.isArray(g.zjCombos) && g.zjCombos.length > 0, 'zjCombos 非空');
    assert.equal(shopPool(g).length, 53, '炸惊商店池 53 件（官方 51 + 2 件 zjOnly）');
    assert.equal(shopPool(g).filter((k) => data.items[k.split(':')[1]].zjOnly === true).length, 2, '两件 zjOnly 装备在池里');
    assert.equal(g.bandIds().length, 42, '炸惊策略 42 条（官方 40 + 2 条 zjOnly）');
    assert.equal(g.bandIds().filter((b) => data.bands[b].zjOnly === true).length, 2, '两条 zjOnly 策略在池里');
    assert.equal(g.bondIds.length, 28, '炸惊看到全部 28 条盟约');

    // zj 覆盖块：21 条带 zj 的盟约在炸惊视图里被合并，且记录里不再暴露 zj 键
    const overridden = g.bondIds.filter((id) => data.bonds[id].zj);
    assert.equal(overridden.length, 21, '21 条盟约带 zj 覆盖块');
    for (const id of overridden) {
      assert.notDeepEqual(g.bond(id), data.bonds[id], `盟约 ${id} 的视图与原始记录不同（已合并）`);
      assert.equal(Object.hasOwn(g.bond(id), 'zj'), false, `盟约 ${id} 的视图不许暴露 zj 键`);
      assert.deepEqual(g.bond(id).desc, data.bonds[id].zj.desc ?? data.bonds[id].desc, `盟约 ${id} 的文案按 zj 块覆盖`);
    }

    // 特殊阶段：spRounds 与 spPhaseKinds 一一对齐，家族只有三种
    assert.deepEqual(g.spRounds(), [1, 2, 3, 6, 7, 8, 9, 10, 11, 12], '炸惊 10 个特殊阶段');
    assert.deepEqual(Object.keys(g.spPhaseKinds()).map(Number).sort((a, b) => a - b), g.spRounds(), 'spRounds = spPhaseKinds 的键');
    assert.equal(g.spPhaseKind(1), 'jibian');
    assert.equal(g.spPhaseKind(2), 'express');
    assert.equal(g.spPhaseKind(9), 'bountyHigh');
    for (const r of g.spRounds()) assert.ok(['jibian', 'express', 'bountyHigh'].includes(g.spPhaseKind(r)), `round ${r} 的家族`);

    // 战场表（stages 是 mode 记录上的数组，没有 stagePool 这个 getter）：炸惊 7 张，从 m02 起
    assert.deepEqual(MODES[modeId].stages, [
      'act1autochess_m02', 'act1autochess_m03', 'act1autochess_m04',
      'act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04',
    ], '炸惊战场 7 张');
    assert.equal(g.lastRound, 14, '炸惊打到第 14 回合');
    assert.equal(g.bossRound, 14);
    assert.equal(g.hiddenRound, 15);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 4. 三条方向性断言
// ---------------------------------------------------------------------------------------------------------------
test('方向①：只有湮灭有藏品与毒雾', () => {
  const withAnn = ALL_IDS.filter((id) => new GameData(data, id).annihilation).sort();
  assert.deepEqual(withAnn, ['mode_multi_annihilation', 'mode_single_annihilation']);
  for (const id of ALL_IDS) {
    const g = new GameData(data, id);
    assert.equal(g.annihilationFlags('normal', 1) !== null, g.difficulty === 'ANNIHILATION', `${id}: annihilationFlags`);
    if (g.difficulty !== 'ANNIHILATION') assert.equal(g.annihilation, null, `${id}: annihilation`);
  }
});

test('方向②：只有炸惊有惊变 / 白值膨胀 / 炸惊棋库', () => {
  const withZj = ALL_IDS.filter((id) => { const g = new GameData(data, id); return g.zhajing || g.jibian() || g.allyScale; }).sort();
  assert.deepEqual(withZj, ['mode_multi_zhajing', 'mode_single_zhajing']);
  for (const id of ALL_IDS) {
    const g = new GameData(data, id);
    const isZj = MODES[id].difficulty === 'ZHAJING';
    assert.equal(g.zhajing, isZj, `${id}: gd.zhajing`);
    assert.equal(g.jibian() !== null, isZj, `${id}: gd.jibian()`);
    assert.equal(g.enemyJibian() !== null, isZj, `${id}: gd.enemyJibian()`);
    assert.equal(g.allyScale !== null, isZj, `${id}: gd.allyScale`);
    assert.equal(g.zjCombos !== null, isZj, `${id}: gd.zjCombos`);
    assert.equal(g.bondLayerCap !== null, isZj, `${id}: gd.bondLayerCap`);
    assert.equal(g.visibleChess.some((c) => data.chess[c].zhajing === true), isZj, `${id}: 棋库里有 zhajing 记录`);
  }
});

test('方向③：官方四档互相同构（SINGLE×4、MULTI×4 各自逐字节相同；solo↔coop 只允许策略差异）', () => {
  const view = (g) => ({
    chess: g.visibleChess,
    items: shopPool(g),
    bands: g.bandIds(),
    bonds: g.bondIds,
    bondRecords: g.bondIds.map((id) => g.bond(id)),
    bossWeights: g.bossWeights(false),
  });
  for (const type of ['SINGLE', 'MULTI']) {
    const ids = OFFICIAL_IDS.filter((id) => MODES[id].type === type);
    assert.equal(ids.length, 4, `${type} 有 4 档`);
    const ref = new GameData(data, ids[0]);
    for (const id of ids.slice(1)) {
      const g = new GameData(data, id);
      const a = view(g);
      const b = view(ref);
      for (const key of Object.keys(b)) assert.deepEqual(a[key], b[key], `${ids[0]} vs ${id}: ${key} 必须逐字节相同`);
    }
    // 隐藏 Boss 权重只跟着 hiddenRound 走（FUNNY 没有隐藏核心）
    const withHidden = ids.filter((id) => MODES[id].hiddenRound != null);
    const withoutHidden = ids.filter((id) => MODES[id].hiddenRound == null);
    for (const id of withoutHidden) assert.deepEqual(new GameData(data, id).bossWeights(true), [], `${id}: 无隐藏 Boss`);
    const refHidden = new GameData(data, withHidden[0]).bossWeights(true);
    for (const id of withHidden.slice(1)) assert.deepEqual(new GameData(data, id).bossWeights(true), refHidden, `${id}: 隐藏 Boss 权重`);
  }
  const solo = new GameData(data, OFFICIAL_IDS.find((id) => MODES[id].type === 'SINGLE'));
  const coop = new GameData(data, OFFICIAL_IDS.find((id) => MODES[id].type === 'MULTI'));
  assert.deepEqual(solo.visibleChess, coop.visibleChess, 'solo/coop 棋库相同');
  assert.deepEqual(shopPool(solo), shopPool(coop), 'solo/coop 商店池相同');
  assert.deepEqual(solo.bondIds, coop.bondIds, 'solo/coop 盟约相同');
  const soloOnly = solo.bandIds().filter((b) => !coop.bandIds().includes(b));
  const coopOnly = coop.bandIds().filter((b) => !solo.bandIds().includes(b));
  for (const b of soloOnly) assert.ok(!data.bands[b].modeTypeList.includes('MULTI'), `solo 独有策略 ${b} 必须由 modeTypeList 解释`);
  for (const b of coopOnly) assert.ok(!data.bands[b].modeTypeList.includes('SINGLE'), `coop 独有策略 ${b} 必须由 modeTypeList 解释`);
});

// ---------------------------------------------------------------------------------------------------------------
// 5. 超限房：房间级开关，推出的 modeId 与 base 房型一致，不新增模式记录
// ---------------------------------------------------------------------------------------------------------------
test('超限房（solo_infinite / coop_infinite）：推出的 modeId = base 房型，模式记录不长 infinite 键', () => {
  for (const roomMode of [SOLO_INFINITE, COOP_INFINITE]) {
    const base = roomMode === SOLO_INFINITE ? 'solo' : 'coop';
    for (const d of DIFFICULTIES) {
      const modeId = modeIdFor(roomMode, d);
      assert.equal(modeId, modeIdFor(base, d), `${roomMode}/${d} 的 modeId 必须与 ${base} 相同`);
      assert.ok(MODES[modeId], `${modeId} 必须在 data/config.json 里`);
      assert.equal(Object.hasOwn(MODES[modeId], 'infinite'), false, `${modeId} 不许长 infinite 键`);
      // 同一份 gd：超限不改变池子
      const a = new GameData(data, modeIdFor(roomMode, d));
      const b = new GameData(data, modeIdFor(base, d));
      assert.deepEqual(a.visibleChess, b.visibleChess, `${modeId}: 超限与 base 的棋库相同`);
      assert.deepEqual(shopPool(a), shopPool(b), `${modeId}: 超限与 base 的商店池相同`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 6. data/versions/*：3 个历史版本目录不得长出任何玩法包字段（缺省版本 = data/*，zj 记录按设计留在里面）
// ---------------------------------------------------------------------------------------------------------------
test('data/versions/*：三个历史版本目录零 zj 记录、零玩法包 mode、无 jibianBonds.json 镜像', () => {
  const quiet = { warn() {}, info() {}, error() {}, log() {} };
  const checked = [];
  for (const v of VERSIONS) {
    if (v.id === DEFAULT_VERSION) continue;
    const dir = versionDataDir(v.id);
    const vd = loadData(dir, { expected: VERSION_DATA_FILES, log: quiet });
    const vmodes = vd.config.modes;

    const badModes = Object.entries(vmodes).filter(([, m]) => m.jibian || m.annihilation || m.allyScale).map(([id]) => id);
    assert.deepEqual(badModes, [], `${v.id}: 模式记录不许带玩法包字段`);
    assert.deepEqual(Object.keys(vd.chess).filter((id) => vd.chess[id].zhajing === true), [], `${v.id}: 零条 zhajing 棋`);
    assert.deepEqual(Object.keys(vd.items).filter((id) => vd.items[id].zjOnly === true), [], `${v.id}: 零条 zjOnly 道具`);
    assert.deepEqual(Object.keys(vd.bands).filter((id) => vd.bands[id].zjOnly === true), [], `${v.id}: 零条 zjOnly 策略`);
    assert.deepEqual(Object.keys(vd.bonds).filter((id) => vd.bonds[id].zj || vd.bonds[id].zjOnly === true), [], `${v.id}: 盟约没有 zj 块`);
    assert.equal(fs.existsSync(path.join(dir, 'jibianBonds.json')), false, `${v.id}: 不许有 jibianBonds.json`);
    for (const modeId of Object.keys(vmodes)) {
      const g = new GameData(vd, modeId);
      assert.equal(g.zhajing, false, `${v.id}/${modeId}: gd.zhajing`);
      assert.equal(g.jibian(), null, `${v.id}/${modeId}: gd.jibian()`);
      assert.equal(g.allyScale, null, `${v.id}/${modeId}: gd.allyScale`);
      assert.equal(g.annihilation, null, `${v.id}/${modeId}: gd.annihilation`);
      assert.equal(g.visibleChess.filter((id) => vd.chess[id].zhajing === true).length, 0, `${v.id}/${modeId}: 棋库无 zj 记录`);
    }
    checked.push(v.id);
  }
  assert.equal(checked.length, 3, '三个版本目录都检查过');
});

test('缺省版本（data/*）：4 个官方/训练模式仍然干净，玩法包模式只有 4 条', () => {
  const gd = (id) => new GameData(data, id);
  for (const id of [...OFFICIAL_IDS, 'mode_training_1']) {
    const g = gd(id);
    assert.equal(g.zhajing, false, `${id}: 没有 gd.zhajing`);
    assert.equal(g.annihilation, null, `${id}: 没有 gd.annihilation`);
    assert.equal(g.jibian?.(), null, `${id}: 没有惊变池`);
    assert.equal(g.enemyJibian?.(), null, `${id}: 没有敌方惊变`);
    assert.equal(g.allyScale, null, `${id}: 没有白值膨胀`);
    assert.equal(g.zjCombos, null, `${id}: 没有装备组合表`);
  }
  assert.deepEqual(Object.keys(MODES).filter((id) => MODES[id].jibian || MODES[id].annihilation).sort(),
    ['mode_multi_annihilation', 'mode_multi_zhajing', 'mode_single_annihilation', 'mode_single_zhajing']);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. grantOnly 语义（2026-10-28 修复后转正）：重岳 / 白铁 只由「祀」策略发放，不进卡池 / 商店
// ---------------------------------------------------------------------------------------------------------------
// 修之前 `visibleChess` 没有 `c.grantOnly === true` 这一条（参考包 0.3.1 有），于是这 4 条记录进了炸惊商店，
// 玩家可以不拿「祀」就买到重岳 / 白铁。现在由 `gamedata.js` 的过滤器排除，并由这条用例钉住。
test('grantOnly 记录不进炸惊卡池（重岳 / 白铁），但仍在数据里（由策略发放）', () => {
  const g = new GameData(data, 'mode_single_zhajing');
  assert.deepEqual(g.visibleChess, ZJ_ROSTER, '炸惊棋库只含非 grantOnly 记录（97 条）');
  const grantOnly = Object.keys(data.chess).filter((id) => data.chess[id].grantOnly === true);
  assert.deepEqual(grantOnly.sort(), ['chess_zj_chyue_a', 'chess_zj_chyue_b', 'chess_zj_ironmn_a', 'chess_zj_ironmn_b'],
    '这 4 条记录仍在数据里：策略授予（grant(..., { requirePool: false })）不经过 visibleChess');
  for (const id of grantOnly) assert.ok(!g.visibleChess.includes(id), `${id} 不得进卡池`);
});
