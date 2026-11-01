// test/match/zhajing-mode.test.js — 炸惊模拟（拓展玩法模式 ZHAJING）的引擎层接线验收。
//
// 这套用例钉的是 handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2 的三条线：**模式标记 + 模式门**，不建独立数据集。
// 它存在的理由：这里的每一环**断掉都不报错**，只会静默降级——
//   * `DOMAIN_NAMES` 少写 jibian/ejibian → 惊变内容全哑、抽到的卡什么都不做；
//   * `gd.zhajing` 门漏写 → 官方四档悄悄读到炸惊记录 / 炸惊盟约覆盖漏进普通房；
//   * `withZjView` 只包装配不包 `step()` → 装配期是炸惊盟约、打起来读回基础记录（golden 也不会红）；
//   * `enemyJibian` getter 非 null 但没人消费 → 招牌机制「第 1/6 回合各抽一张」一次也不发生。
// 因此断言的不是「能开局」，而是**门真的站在正确的一侧**：官方四档逐字节等于「没有 zj 记录时」的基线，
// ZHAJING 下池子只含 zj 记录、覆盖真的生效。
//
// 数据现状：`data/*.json` 的 zj 记录由 teammate `data`（tools/build-data.mjs + docs/research/17..19）生成，
// 本轮尚未落地。所以这里用**真实数据 + 注入的 zj 记录**当 fixture：隔离断言比的是「同一份数据去掉 zj 记录」，
// 与数据侧最终生成物无关，等真实数据到位后这套用例照样成立（`BASE` 换成生成后的 data 即可）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { MODULES, jibianBonds } from '../../server/sim/content/index.js';
import { setGameData, bondRecord, zjView, withZjView, unitBonds } from '../../server/sim/content/support/index.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerAllMeta } from '../../server/sim/content/index.js';
import { zjBondView, zjBondIds, zjEquipCombos, equipComboBonds } from '../../shared/zjBonds.js';
import { allyScaleOf, zhajingBaseStats } from '../../shared/zhajingBase.js';
import { generateDraft, jibianDraftCards, ownedJibianIds } from '../../server/match/choices.js';

const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const BASE = getData({ log: QUIET });

/** 官方四档 × 单/同盟 —— 这些模式下 zj 记录必须一条都拿不到。 */
const OFFICIAL = [
  'mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss',
  'mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss',
];

/** 拿真实记录改一份炸惊棋库记录（id / baseId 换成自己的，其余字段照抄，所以商店 / 合并 / 技能都能跑）。 */
function zjChessFrom(id, newId) {
  const c = BASE.chess[id];
  return { ...c, id: newId, baseId: newId, visible: false, zhajing: true };
}

const ZJ_CHESS_PAIRS = [
  ['chess_char_1_01_a', 'chess_zj_test_1_a'],
  ['chess_char_2_01_a', 'chess_zj_test_2_a'],
  ['chess_char_3_01_a', 'chess_zj_test_3_a'],
];
const ZJ_CHESS_IDS = ZJ_CHESS_PAIRS.map(([, zj]) => zj).sort();

/** 两件「炸惊专属装备」+ 一张「组合激活盟约」表要用的真实装备 id。 */
const REAL_ITEMS = Object.keys(BASE.items).filter((id) => {
  const it = BASE.items[id];
  return it && it.itemType === 'EQUIP' && !it.isGolden && Number.isInteger(it.tier) && !it.canGiveBond;
});
const ZJ_ITEM_ID = 'chess_item_zjtest_e_a';
const COMBO_ITEMS = REAL_ITEMS.slice(0, 2);

/** 惊变池：五档各一张，id 是合成的 effectId（真实数据里没有 effects 记录也可以，卡自己带名字/描述）。 */
const JIBIAN_POOL = [
  { effectId: 'jibian_test_normal', name: '炸惊·普通', desc: '普通卡', rarity: 'normal' },
  { effectId: 'jibian_test_rare', name: '炸惊·稀有', desc: '稀有卡', rarity: 'rare' },
  { effectId: 'jibian_test_epic', name: '炸惊·史诗', desc: '史诗卡', rarity: 'epic', flavor: '灰字' },
  { effectId: 'jibian_test_legend', name: '炸惊·传说', desc: '传说卡', rarity: 'legend', bond: 'yanShip' },
  { effectId: 'jibian_test_n2', name: '炸惊·普通二', desc: '普通卡二', rarity: 'normal' },
  { effectId: 'jibian_test_r2', name: '炸惊·稀有二', desc: '稀有卡二', rarity: 'rare' },
  { effectId: 'jibian_test_e2', name: '炸惊·史诗二', desc: '史诗卡二', rarity: 'epic' },
  { effectId: 'jibian_test_l2', name: '炸惊·传说二', desc: '传说卡二', rarity: 'legend' },
];
const ENEMY_JIBIAN_POOL = [
  { effectId: 'ejibian_test_a', name: '敌方A', desc: 'A', rarity: 'normal' },
  { effectId: 'ejibian_test_b', name: '敌方B', desc: 'B', rarity: 'rare' },
];

/**
 * 炸惊 fixture：真实数据 + 两条 mode 记录 + zj 记录。
 * `clean: true` → 同一份数据把 zj 记录 / zj 覆盖块**全部去掉**，作为官方四档的「改动前」基线
 * （数据侧落地真实 zj 记录后，这条基线仍然成立：它由同一份数据现场剥出来，不依赖任何外部文件）。
 */
function stripZjRecord(rec) {
  const copy = { ...rec };
  delete copy.zj;
  // 湮灭专属 mod 的 `ann` 覆盖块（docs/ANNIHILATION-MODS.md）与 `zj` 同一范式：官方四档同样看不到它，
  // 所以基线要一起剥掉，否则「官方 = 去掉玩法包覆盖后的原始记录」这条断言会被数据侧的 ann 块打破。
  delete copy.ann;
  // 超限模拟的 `inf` 覆盖块（solo_infinite / coop_infinite，2026-10-31）同理：只有 `gd.overlimit` 才合并，
  // 官方四档 / 炸惊 / 湮灭的视图里一律剥掉。
  delete copy.inf;
  return copy;
}

function stripZjData(data) {
  const bonds = {};
  for (const [id, rec] of Object.entries(data.bonds || {})) {
    // 玩法包专属盟约（zjOnly = 炸惊，annOnly = 湮灭 mod）在任何官方难度下都不存在
    if (!rec || typeof rec !== 'object' || rec.zjOnly === true || rec.annOnly === true) continue;
    bonds[id] = stripZjRecord(rec);
  }
  const chess = Object.fromEntries(Object.entries(data.chess || {}).filter(([, c]) => !(c && c.zhajing === true)));
  const items = Object.fromEntries(Object.entries(data.items || {}).filter(([, it]) => !(it && it.zjOnly === true)));
  const bands = Object.fromEntries(Object.entries(data.bands || {}).filter(([, b]) => !(b && b.zjOnly === true)));
  return { ...data, chess, items, bands, bonds };
}

function zjFixture({ clean = false } = {}) {
  const source = clean ? stripZjData(BASE) : BASE;
  const chess = { ...source.chess };
  const items = { ...source.items };
  const bands = { ...source.bands };
  let bonds = { ...source.bonds };
  const modes = { ...BASE.config.modes };
  if (!clean) {
    for (const [from, to] of ZJ_CHESS_PAIRS) chess[to] = zjChessFrom(from, to);
    items[ZJ_ITEM_ID] = { id: ZJ_ITEM_ID, name: '炸惊专属装备', itemType: 'EQUIP', kind: 'passive', tier: 3, price: 3, zjOnly: true, desc: '只在炸惊下出售' };
    bands.band_zj_test = { bandId: 'band_zj_test', name: '祀', effectRef: null, totalHp: 30, zjOnly: true, modeTypeList: ['SINGLE', 'MULTI'] };
  }
  // 21 条既有盟约带 zj 覆盖块：这里挑两条断言「合并顺序 / descRaw 联动 / bb 按键合并」。
  bonds = {
    ...bonds,
    yanShip: {
      ...(bonds.yanShip || { identifier: 1, thresholds: [2, 4, 6], isCore: true }),
      ...(clean ? null : {
        zj: {
          thresholds: [1, 2, 3],
          desc: '炸惊·炎：人更多了',
          bb: { atk: 0.25, layer2: 200 },
          buffs: [{ key: 'env_gbuff_new', bb: { atk: 0.25, layer2: 200 }, bbStr: { bond: 'yanShip' } }],
          equipCombo: COMBO_ITEMS,
        },
      }),
    },
    raidShip: {
      ...(bonds.raidShip || { identifier: 2, thresholds: [2, 3, 4], isCore: true }),
      ...(clean ? null : { zj: { desc: '炸惊·突袭' } }),
    },
    ...(clean ? null : {
      zjTestShip: { identifier: 99, thresholds: [2], isCore: false, zjOnly: true, buffs: [{ key: 'env_gbuff_new', bb: { atk: 1 } }] },
    }),
  };
  // 两条 mode 记录（data 侧最终由 docs/research/17-zhaijing-mode.json 生成，字段同名）
  const zjMode = {
    type: 'SINGLE', difficulty: 'ZHAJING', code: 'AC-8', sortId: 7, lastRound: 14,
    allyScale: { atk: 2.5, def: 3, hp: 3 },
    bondLayerCap: 9999,
    bans: { core: 3, addon: 4 },
    // 规则5: 惊变阶段在第 1/2/3/6/7 回合（spPhaseKinds 自己就是回合表 —— gd.spRounds() 从它派生）
    spPhaseKinds: { 1: 'jibian', 2: 'express', 3: 'jibian', 6: 'bountyHigh', 7: 'jibian' },
    jibian: {
      cards: 3, rerolls: 2,
      rarityWeights: { normal: 45, rare: 25, epic: 20, legend: 10 },
      pool: JIBIAN_POOL,
    },
    enemyJibian: {
      enabled: true, rounds: [1, 6],
      rarityWeights: { normal: 45, rare: 25, epic: 20, legend: 10 },
      pool: ENEMY_JIBIAN_POOL, flickerMs: 3000, resultMs: 3000,
    },
    expressPool: COMBO_ITEMS, expressCards: 6,
  };
  return {
    ...BASE,
    chess, items, bands, bonds,
    config: { ...BASE.config, modes: { ...modes, mode_single_zhajing: zjMode, mode_multi_zhajing: { ...zjMode, type: 'MULTI', maxPlayers: 4 } } },
  };
}

const ZJ_DATA = zjFixture();
const CLEAN_DATA = zjFixture({ clean: true });
const gdZj = (id = 'mode_single_zhajing') => new GameData(ZJ_DATA, id);
const json = (v) => JSON.parse(JSON.stringify(v));

// ── 1. 模式标记 ────────────────────────────────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 模式门（gd.zhajing）', () => {
  test('ZHAJING 模式 → zhajing 为 true；官方四档（单/同盟）全为 false', () => {
    assert.equal(gdZj('mode_single_zhajing').zhajing, true);
    assert.equal(gdZj('mode_multi_zhajing').zhajing, true);
    for (const id of OFFICIAL) {
      const gd = new GameData(ZJ_DATA, id);
      assert.equal(gd.zhajing, false, `${id}: 不是炸惊`);
      assert.equal(gd.jibian(), null, `${id}: 没有惊变`);
      assert.equal(gd.enemyJibian(), null, `${id}: 没有敌方惊变`);
      assert.equal(gd.allyScale, null, `${id}: 没有白值膨胀`);
      assert.equal(gd.spPhaseKind(1), null, `${id}: 没有炸惊特殊阶段`);
      assert.equal(gd.zjCombos, null, `${id}: 没有装备组合盟约`);
      assert.equal(gd.bondLayerCap, null);
      assert.equal(gd.chessInRoster('chess_char_1_01_a'), 'chess_char_1_01_a', `${id}: 奖池 id 映射不改写`);
    }
  });

  test('zhajing 也认 modeId（difficulty 缺失时同一道门）', () => {
    const noDiff = { ...ZJ_DATA, config: { ...ZJ_DATA.config, modes: { ...ZJ_DATA.config.modes, mode_single_zhajing: { ...ZJ_DATA.config.modes.mode_single_zhajing, difficulty: undefined } } } };
    assert.equal(new GameData(noDiff, 'mode_single_zhajing').zhajing, true);
  });
});

// ── 2. 隔离：官方四档逐字节等于「没有 zj 记录」的基线 ──────────────────────────────────────────────────────────
describe('炸惊模拟 · 主玩法零位移（四个官方难度 × 单/同盟）', () => {
  const baseline = (id) => new GameData(CLEAN_DATA, id);

  test('visibleChess / shopItemsByTier / bandIds / 盟约记录 与基线逐字节一致', () => {
    for (const id of OFFICIAL) {
      const gd = new GameData(ZJ_DATA, id);
      const base = baseline(id);
      assert.deepEqual(json(gd.visibleChess), json(base.visibleChess), `${id}: visibleChess`);
      assert.deepEqual(json(gd.shopItemsByTier), json(base.shopItemsByTier), `${id}: shopItemsByTier`);
      assert.deepEqual(json(gd.bandIds()), json(base.bandIds()), `${id}: bandIds`);
      for (const bondId of Object.keys(CLEAN_DATA.bonds)) {
        assert.deepEqual(json(gd.bond(bondId)), json(CLEAN_DATA.bonds[bondId]), `${id}: bond(${bondId})`);
      }
      // zjOnly 的记录一条都不在池子里
      assert.ok(!gd.visibleChess.some((cid) => /^chess_zj_test_/.test(cid)), `${id}: 没有炸惊棋`);
      assert.ok(!Object.values(gd.shopItemsByTier).flat().includes(ZJ_ITEM_ID), `${id}: 没有炸惊专属装备`);
      assert.ok(!gd.bandIds().includes('band_zj_test'), `${id}: 没有 zjOnly 策略`);
      // 覆盖块不外泄：客户端拿到的记录里没有 `zj` 键，也没有 zjOnly 盟约
      for (const bondId of gd.bondIds) assert.equal(Object.hasOwn(gd.bond(bondId), 'zj'), false, `${id}: bond(${bondId}) 不带 zj 键`);
      assert.equal(gd.bondIds.includes('zjTestShip'), false, `${id}: 没有 zjOnly 盟约`);
    }
  });

  test('官方四档的炸惊棋记录进了棋表但拿不到（记录本身没被删）', () => {
    const gd = new GameData(ZJ_DATA, 'mode_single_normal');
    assert.ok(gd.chess('chess_zj_test_1_a'), '记录在 data 里（data 侧生成物）');
    assert.equal(gd.visibleChess.includes('chess_zj_test_1_a'), false, '但不在卡池里');
  });
});

// ── 3. 炸惊下：池子只含 zj 记录、盟约覆盖生效 ─────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 只开自己的门', () => {
  test('ZHAJING 的 visibleChess 只含 zj 记录；炸惊专属装备 / 策略只在这里出现', () => {
    const gd = gdZj();
    // 数据侧的真实 zj 棋库 + 本用例注入的 3 条 —— 只要带 zhajing:true 就该在里面，其余一条都不许有
    const expected = Object.keys(ZJ_DATA.chess).filter((id) => {
      const c = ZJ_DATA.chess[id];
      // `grantOnly` 的重岳 / 白铁只由「祀」策略发放，不进卡池（gamedata.js 的 visibleChess 与参考包同一条）
      return c && c.zhajing === true && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true && Number.isInteger(c.tier);
    }).sort();
    assert.deepEqual(json(gd.visibleChess), json(expected));
    for (const id of ZJ_CHESS_IDS) assert.ok(gd.visibleChess.includes(id), `${id} 在炸惊卡池里`);
    assert.ok(Object.values(gd.shopItemsByTier).flat().includes(ZJ_ITEM_ID), '炸惊专属装备在商店池里');
    assert.ok(gd.bandIds().includes('band_zj_test'), 'zjOnly 策略可用');
    assert.ok(gd.bondIds.includes('zjTestShip'), 'zjOnly 盟约在册');
  });

  test('盟约覆盖：阈值 / 文案 Raw 联动 / bb 按键合并 / buffs 按键合并', () => {
    const gd = gdZj();
    const yan = gd.bond('yanShip');
    assert.deepEqual(json(yan.thresholds), [1, 2, 3], 'thresholds 被 zj 覆盖');
    assert.equal(yan.desc, '炸惊·炎：人更多了');
    assert.equal(yan.descRaw, '炸惊·炎：人更多了', 'descRaw 跟着 desc 换（界面读 Raw || 普通）');
    assert.equal(yan.bb.atk, 0.25, 'zj.bb 覆盖顶层数值袋');
    const env = yan.buffs.find((b) => b.key === 'env_gbuff_new');
    assert.equal(env.bb.atk, 0.25, 'zj.bb 也落到 env_gbuff_new 上（战斗引擎读 buffs）');
    assert.equal(env.bb.layer2, 200, 'zj 只写要改的键，基础记录的其它键保留');
    assert.deepEqual(json(env.bb), json(yan.bb), 'env_gbuff_new 与顶层 bb 永远同一份数值');
    assert.equal(Object.hasOwn(yan, 'zj'), false, '合并后 zj 键消失');
    // 第二条：只写 desc 的盟约
    const raid = gd.bond('raidShip');
    assert.equal(raid.desc, '炸惊·突袭');
    assert.equal(raid.descRaw, '炸惊·突袭');
    assert.deepEqual(json(raid.thresholds), json(BASE.bonds.raidShip?.thresholds ?? raid.thresholds), '没写的字段保持原样');
    // 组合表（装备组合激活盟约）只在炸惊下非空；本用例注入的那一条必须在内
    // （数据侧落地真实 equipCombo 后列表会更长，所以按「包含」断言，不按长度）
    const mine = gd.zjCombos.find((c) => c.bondId === 'yanShip');
    assert.ok(mine, 'yanShip 的装备组合在内');
    assert.deepEqual(json(mine.items), json(COMBO_ITEMS.map((i) => i.replace(/_[ab]$/, ''))));
    assert.deepEqual(equipComboBonds(COMBO_ITEMS, [mine]), ['yanShip']);
  });

  test('真实数据里的 zj 覆盖块真的生效（不只是「剥键」）', () => {
    const base = new GameData(ZJ_DATA, 'mode_single_normal');
    const zj = gdZj();
    const withBlock = Object.keys(ZJ_DATA.bonds).filter((id) => {
      const b = ZJ_DATA.bonds[id];
      return b && b.zj && b.zjOnly !== true;
    });
    assert.ok(withBlock.length >= 1, 'data/bonds.json 里至少一条盟约带 zj 块');
    const flipped = withBlock.filter((id) => {
      const a = base.bond(id);
      const b = zj.bond(id);
      if (!a || !b) return false;
      return JSON.stringify(a.bb) !== JSON.stringify(b.bb)
        || JSON.stringify(a.thresholds) !== JSON.stringify(b.thresholds)
        || JSON.stringify(a.buffs) !== JSON.stringify(b.buffs)
        || a.desc !== b.desc;
    });
    assert.ok(flipped.length >= 1, `至少一条覆盖改了数值/文案（实际 ${flipped.length}/${withBlock.length}）`);
    // 官方侧仍是基础记录（同一条盟约）
    for (const id of flipped) assert.deepEqual(json(base.bond(id).bb), json(stripZjRecord(ZJ_DATA.bonds[id]).bb), `${id}: 官方侧没被覆盖`);
  });

  test('白值档 / 层上限 / 特殊阶段 / 奖池 id 映射', () => {
    const gd = gdZj();
    assert.deepEqual(json(gd.allyScale), { hp: 3, def: 3, atk: 2.5 });
    assert.deepEqual(json(gd.zhajingFlags()), { allyScale: { hp: 3, def: 3, atk: 2.5 }, bondLayerCap: 9999 });
    assert.equal(gd.bondLayerCap, 9999);
    assert.equal(gd.spPhaseKind(1), 'jibian');
    assert.equal(gd.spPhaseKind(2), 'express');
    assert.equal(gd.spPhaseKind(6), 'bountyHigh');
    assert.equal(gd.spPhaseKind(4), null);
    // 静默失效的典型：data 只写 spPhaseKinds、漏写 spRounds → 特殊阶段永远不进门。spRounds 必须从 kind 表派生。
    assert.deepEqual(json(gd.spRounds()), [1, 2, 3, 6, 7]);
    // 奖池里的普通 id 映射到本模式棋库里的同角色记录（charId 配平、精锐配平）
    const zjChar = ZJ_DATA.chess[ZJ_CHESS_IDS[0]];
    assert.equal(gd.chessInRoster(zjChar.id), zjChar.id, '本来就是本模式记录 → 原样');
  });

  test('白值折算：atk / def / maxHp 各一档', () => {
    const scale = gdZj().allyScale;
    assert.deepEqual(json(allyScaleOf(scale)), { atk: 2.5, def: 3, hp: 3 });
    const stats = zhajingBaseStats({ atk: 100, def: 50, maxHp: 1000, aspd: 100 }, scale);
    assert.equal(stats.atk, 250);
    assert.equal(stats.def, 150);
    assert.equal(stats.maxHp, 3000);
    assert.equal(stats.aspd, 100, '其它字段原样');
    assert.equal(allyScaleOf({ atk: 1, def: 1, hp: 1 }), null, '三项都是 1 = 不膨胀');
    assert.equal(allyScaleOf(null), null);
  });

  test('白值真的落在 sim 的 unit.base 上（不是最终乘区）', () => {
    const chessId = 'chess_char_1_01_a';
    const plain = makeBattle({ units: [{ chessId, row: 10, col: 5 }] });
    const scaled = makeBattle({ units: [{ chessId, row: 10, col: 5 }], flags: { allyScale: { atk: 2.5, def: 3, hp: 3 } } });
    const a = plain.unit(chessId);
    const b = scaled.unit(chessId);
    assert.ok(a && b);
    assert.equal(b.base.atk, a.base.atk * 2.5);
    assert.equal(b.base.def, a.base.def * 3);
    assert.equal(b.base.maxHp, a.base.maxHp * 3);
  });
});

// ── 4. 惊变抽卡 ───────────────────────────────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 惊变阶段（3 选 1 / 不重复 / 已拥有排除）', () => {
  const rngOf = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  test('jibianDraftCards: 3 张、互不重复、只从池里出', () => {
    const gd = gdZj();
    const cards = jibianDraftCards(gd, rngOf(7), 3, null);
    assert.equal(cards.length, 3);
    const ids = cards.map((c) => c.id);
    assert.equal(new Set(ids).size, 3, '同一批不重复');
    for (const c of cards) assert.ok(JIBIAN_POOL.some((p) => p.effectId === c.id), `${c.id} 来自池子`);
  });

  test('已拥有的惊变不再出现（选过的卡不会第二次进池）', () => {
    const gd = gdZj();
    const owned = new Set(['jibian_test_normal', 'jibian_test_rare', 'jibian_test_epic']);
    const cards = jibianDraftCards(gd, rngOf(9), 3, owned);
    assert.equal(cards.length, 3);
    assert.ok(cards.every((c) => !owned.has(c.id)), '已拥有的一张都不出现');
    const all = new Set(JIBIAN_POOL.map((p) => p.effectId));
    const none = jibianDraftCards(gd, rngOf(9), 3, all);
    assert.equal(none, null, '全拥有 → null（阶段回落，不出空卡）');
  });

  test('generateDraft 在惊变回合直接走 jibian 家族（不跟其它家族加权竞争）', () => {
    const gd = gdZj();
    for (const round of [1, 3, 7]) {
      const draft = generateDraft(gd, rngOf(round), round, {});
      assert.equal(draft.family, 'jibian', `R${round}: 惊变家族`);
      assert.equal(draft.cards.length, 3, `R${round}: 3 选 1`);
      assert.ok(draft.cards.every((c) => c.family === 'jibian'));
    }
    // 官方模式同一回合仍是自己的家族（没有 spPhaseKind → 老路径）
    const official = new GameData(ZJ_DATA, 'mode_single_normal');
    const plain = generateDraft(official, rngOf(3), 3, {});
    assert.notEqual(plain.family, 'jibian');
  });

  test('惊变卡带 rarity / flavor（卡面品质与羁绊提示的数据面）', () => {
    const gd = gdZj();
    const cards = jibianDraftCards(gd, rngOf(11), 3, null);
    for (const c of cards) assert.ok(['normal', 'rare', 'epic', 'legend'].includes(c.rarity), `${c.id}: 有品质`);
    const epic = JIBIAN_POOL.find((p) => p.effectId === 'jibian_test_epic');
    const only = jibianDraftCards(gd, rngOf(3), 1, new Set(JIBIAN_POOL.map((p) => p.effectId).filter((id) => id !== epic.effectId)));
    assert.equal(only[0].flavor, '灰字', '池子条目的 flavor 透传到卡面');
  });

  test('ownedJibianIds 只认 jibian: 前缀的 ref', () => {
    const ps = { effects: [{ key: 'jibian:jibian_a' }, { key: 'jibian:jibian_a' }, { key: 'choice:x' }, { key: 'garrison:y' }] };
    assert.deepEqual([...ownedJibianIds(ps)], ['jibian_a']);
    assert.deepEqual([...ownedJibianIds(null)], []);
  });
});

// ── 5. 真实 Match：重抽上限 / 敌方惊变第 1、6 回合各一次 ─────────────────────────────────────────────────────
describe('炸惊模拟 · 真实对局（Match）', () => {
  /** PREP of R1 with every human decision driven, then reopen a clean 惊变 draft (phase plumbing is not what we test). */
  const openJibianDraft = () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', data: ZJ_DATA, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    // R1's own draft was auto-picked while driving to PREP; start from a clean slate so the assertions are exact.
    ps.effects = ps.effects.filter((e) => !e || !e.jibian);
    m.round = 1;
    m.enterSpDraft();
    return h;
  };

  test('重抽：每张卡各一次（不再有全局预算），换牌保留原槽位、新卡带 rerolled', () => {
    const h = openJibianDraft();
    const m = h.m;
    const ps = h.ps('p_0');
    assert.equal(m.gd.zhajing, true);
    assert.ok(m.sp && m.sp.family === 'jibian', 'R1 进了惊变阶段');
    const before = m.sp.cards.map((c) => c.id);
    const r1 = m.refreshSpCard(ps, 0);
    assert.deepEqual(r1, { ok: true }, '第一次重抽成功');
    assert.equal(m.sp.cards.length, 3, '槽位数量不变');
    assert.ok(!before.slice(1).includes(m.sp.cards[0].id), '换到的不是本批另外两张');
    assert.deepEqual(m.refreshSpCard(ps, 1), { ok: true }, '第二张也各能刷一次');
    // owner 2026-10-19（方案 A）：jibian.rerolls 不再是「每人每阶段 4 次」的全局预算，第 3 张照样能刷
    assert.deepEqual(m.refreshSpCard(ps, 2), { ok: true }, '第三张同样能刷（旧口径在这里 RATE）');
    assert.equal(m.refreshSpCard(ps, 0).error, 'ALREADY', '同一张不能刷第二次');
    assert.equal(ps.jibianRerollsLeft(), 0, '本手牌已无可刷的卡');
    h.dispose?.();
  });

  test('选卡：惊变卡落到 jibian: 前缀的 ref，jibianHas / owned 立即可读', () => {
    const h = openJibianDraft();
    const m = h.m;
    const ps = h.ps('p_0');
    const card = m.sp.cards[0];
    m._applyCard(ps, 0);
    assert.equal(ps.jibianHas(card.id), true, `jibianHas(${card.id})`);
    assert.deepEqual(ps.jibianOwnedIds(), [card.id]);
    const view = ps.jibianView();
    assert.equal(view.cards.length, 1);
    assert.equal(view.cards[0].id, card.id);
    assert.equal(view.cards[0].rarity, card.rarity, '卡面品质随卡走');
    // m.private 上的门：只在炸惊下出现
    assert.ok(ps.privateView().jibian, '炸惊房 m.private 有 jibian');
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true }).start();
    assert.equal(plain.ps('p_0').privateView().jibian, undefined, '普通房没有这个键');
    h.dispose?.();
    plain.dispose?.();
  });

  test('敌方惊变：第 1 / 第 6 回合各抽一次，全场共用、持续整局，m.public 里有累计列表', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', data: ZJ_DATA, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    // R1 由 startRound 抽过；重复调用同一个回合不再抽
    const first = m.enemyJibianCards.length;
    assert.ok(first >= 1, 'R1 已经抽到一张敌方惊变');
    assert.equal(m.drawEnemyJibian(1), null, '同一回合只抽一次');
    assert.equal(m.drawEnemyJibian(4), null, '不在 rounds 里的回合不抽');
    const cards = m.enemyJibianCards.slice();
    const card6 = m.drawEnemyJibian(6);
    assert.ok(card6 && card6.id, 'R6 再抽一张');
    assert.equal(m.enemyJibianCards.length, cards.length + 1);
    assert.equal(m.enemyJibianCards[0], cards[0], '前一张仍在（整局生效）');
    const view = m.publicView().enemyJibian;
    assert.ok(view, 'm.public 有敌方惊变揭晓');
    assert.equal(view.cards.length, 2, '累计列表两张（重连后仍在）');
    assert.deepEqual(view.cards.map((c) => c.id), m.enemyJibianCards);
    assert.ok(view.pool.length >= 1 && view.flickerMs > 0 && view.resultMs > 0, '揭晓动画参数与池子');
    // 官方模式：不抽、不发字段
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true }).start();
    assert.equal(plain.m.drawEnemyJibian(1), null);
    assert.equal(plain.m.publicView().enemyJibian, undefined, '普通房 m.public 不长出 enemyJibian');
    h.dispose?.();
    plain.dispose?.();
  });

  test('隐秘惊变 · 潘多拉·敌：R15 抽到它时再发 3 个敌方惊变（真实抽取路径，非纯函数直调）', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: 7, fake: true, test: true }).start();
    h.toPrep(1);
    const m = h.m;
    const gd = m.gd;
    // 把隐秘池收窄成只有潘多拉：R15 的「保底隐秘卡」必然是它（抽取与记录逻辑一行不动）
    const orig = gd.enemyJibian.bind(gd);
    gd.enemyJibian = () => {
      const ej = orig();
      if (!ej || !ej.hidden) return ej;
      const pool = ej.hidden.pool.filter((c) => (c.effectId || c.id) === 'ejibian_hidden_pandora');
      return pool.length ? { ...ej, hidden: { ...ej.hidden, enabled: true, pool } } : ej;
    };
    const before = m.enemyJibianCards.slice();
    const jump = m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: gd.hiddenRound } });
    assert.ok(jump && jump.ok !== false, `快进到 R${gd.hiddenRound} 被接受: ${JSON.stringify(jump)}`);
    assert.ok(h.drive(() => m.enemyJibianCards.includes('ejibian_hidden_pandora'), { ready: false }), 'R15 抽到了潘多拉');
    const added = m.enemyJibianCards.slice(before.length);
    assert.equal(added.length, 5, `保底（潘多拉）+ 普通 + 潘多拉发的 3 张（实际 ${JSON.stringify(added)}）`);
    const extra = m.enemyJibianCards.slice(-3);
    assert.equal(new Set(extra).size, 3, '潘多拉发的 3 张互不重复');
    assert.ok(!extra.includes('ejibian_hidden_pandora'), '不会把自己再抽出来');
    const list = m.publicView().enemyJibian.cards;
    assert.deepEqual(list.map((c) => c.id), m.enemyJibianCards, 'm.public 与内部列表一致');
    assert.equal(list.filter((c) => c.hidden === true).length, 4, '面板的 hidden 分组 = 保底 1 张 + 潘多拉的 3 张');
    h.dispose?.();
  });

  test('bans.ZHAJING 缺省是 3/4（与官方四档同一档），不靠 data 兜底也不会漏成 0', () => {
    const gd = new GameData({ ...BASE, config: { ...BASE.config, bans: {} } }, 'mode_single_zhajing');
    assert.deepEqual(gd.bans('ZHAJING'), { core: 3, addon: 4 });
  });
});

// ── 6. 静默失效守卫：DOMAIN_NAMES 与注册表 ────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 静默失效守卫（DOMAIN_NAMES / MetaRegistry）', () => {
  test("DOMAIN_NAMES 含 jibian / ejibian / jibianBonds（少一行 = 全哑且不报错）", () => {
    const names = MODULES.map(([n]) => n);
    for (const n of ['jibian', 'ejibian', 'jibianBonds']) assert.ok(names.includes(n), `DOMAIN_NAMES 缺 ${n}`);
    assert.ok(names.indexOf('jibian') > names.indexOf('choices'), 'jibian 在 choices 之后（与参考包同序）');
  });

  test('注册表真的能拿到一张惊变卡的 handler（KEY_RE 放行 jibian: 前缀）', () => {
    const reg = new MetaRegistry();
    registerAllMeta(reg);
    const keys = ['jibian:jibian_touziren', 'jibian:jibian_yanrenhuifei', 'jibian:jibian_duoshouyeshou'];
    let found = 0;
    for (const k of keys) if (reg.get(k)) found++;
    assert.ok(found >= 1, `至少一张惊变卡的 handler 注册成功（实际 ${found}）`);
    assert.equal(reg.has('jibian:jibian_touziren'), reg.get('jibian:jibian_touziren') != null, 'has 与 get 一致');
    // 惊变羁绊的门面（内容文件缺席时是空回答，不会抛）
    assert.deepEqual(jibianBonds.activeBonds([]), []);
    assert.equal(typeof jibianBonds.bondHintsFor('jibian_test_normal', new Set()), 'object');
  });
});

// ── 7. 盟约视图泄漏（Lead 要求的 R-2 守卫）────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · withZjView 不泄漏（先后 / 交替推进）', () => {
  // 让进程级数据单例带上一个 zj 覆盖块：真实数据照旧，只多这一块 —— 于是「合并 / 没合并」可观测。
  const withFixtureData = (fn) => {
    const real = BASE;
    const bonds = {
      ...real.bonds,
      yanShip: { ...real.bonds.yanShip, zj: { thresholds: [1, 2, 3], desc: '炸惊·炎（测试）', buffs: [{ key: 'env_gbuff_new', bb: { atk: 9 } }] } },
    };
    setGameData({ ...real, bonds });
    try { return fn(); } finally { setGameData(real); }
  };

  test('一场 zj 战与一场普通战先后 / 交替推进后：普通战读到的仍是基础记录，且 zjView() 复原为 null', () => {
    withFixtureData(() => {
      const baseThresholds = BASE.bonds.yanShip.thresholds;
      const seen = { normal: [], zj: [] };
      const mk = (modeId, sink) => makeBattle({
        modeId,
        units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }],
        enemies: [{ key: 'enemy_1007_slime', time: 0, route: 0 }],
        hooks: ['tick'],
        setup: (b) => b.on('tick', () => { if (seen[sink].length < 1) seen[sink].push(bondRecord('yanShip').thresholds.slice()); }),
      });
      const normal = mk('mode_single_normal', 'normal');
      const zj = mk('mode_single_zhajing', 'zj');
      for (let i = 0; i < 5; i++) { normal.step(1); assert.equal(zjView(), null, '普通战推进后没有残留视图'); zj.step(1); assert.equal(zjView(), null, 'zj 战推进后视图已复原'); }
      assert.deepEqual(seen.normal[0], baseThresholds, '普通战：基础阈值');
      assert.deepEqual(seen.zj[0], [1, 2, 3], 'zj 战：合并后的阈值（且 step 期间有效 —— 只包装配是不够的）');
      assert.deepEqual(bondRecord('yanShip').thresholds, baseThresholds, '两场都跑完：外部读到基础记录');
      assert.equal(zjView(), null);
    });
  });

  test('zj 战的 unit 缓存不会让普通战读到组合盟约（缓存键带视图前缀）', () => {
    withFixtureData(() => {
      const unit = { kind: 'op', def: { bonds: [] }, items: COMBO_ITEMS.slice(), player: {} };
      const view = { bonds: zjBondView(BASE.bonds) };
      const combos = zjEquipCombos({ ...BASE.bonds, yanShip: { ...BASE.bonds.yanShip, zj: { equipCombo: COMBO_ITEMS } } });
      view.combos = combos;
      const withView = withZjView(view, () => unitBonds(unit));
      const without = unitBonds(unit);
      assert.ok(withView.includes('yanShip'), 'zj 战：装备组合给出盟约');
      assert.deepEqual(without, [], '同一件单位的普通战读不到（缓存键带 zj| 前缀，结果不串）');
    });
  });
});

// ── 8. 盟约覆盖层的纯函数（shared/zjBonds.js 的语义逐条钉住）────────────────────────────────────────────────
describe('shared/zjBonds.js · 合并规则', () => {
  const bonds = {
    a: { identifier: 1, thresholds: [2, 4, 6], desc: 'base', descRaw: 'baseRaw', bb: { atk: 1, layer2: 150 }, buffs: [{ key: 'env_gbuff_new', bb: { atk: 1, layer2: 150 } }, { key: 'other', bb: { x: 1 } }] },
    b: { identifier: 2, zj: { desc: 'zj-desc', buffsAll: [{ key: 'env_gbuff_new', bb: { atk: 2 } }] } },
    c: { identifier: 3, zjOnly: true },
    d: { identifier: 4, zj: { bb: { x: 5 }, buffs: [{ key: 'other', bb: { x: 9 } }], equipCombo: ['i1_a', 'i2_b'] } },
  };

  test('zjBondIds / 合并 / 剥键 / 纯函数不改入参', () => {
    const snapshot = JSON.stringify(bonds);
    assert.deepEqual(zjBondIds(bonds), ['b', 'd']);
    const merged = zjBondView(bonds, { merge: true });
    assert.deepEqual(merged.a, bonds.a, '没有 zj 的记录原样引用');
    assert.equal(merged.b.desc, 'zj-desc');
    assert.equal(merged.b.descRaw, 'zj-desc', 'descRaw 跟着换');
    assert.equal(merged.b.buffs.length, 1, 'buffsAll 整替换');
    assert.deepEqual(merged.b.buffs[0].bb, { atk: 2 }, 'buffsAll 的数值袋原样保留');
    assert.equal(merged.c.zjOnly, true, 'zjOnly 盟约在炸惊下保留');
    assert.deepEqual(merged.d.bb, { x: 5 }, 'zj.bb 合并进顶层数值袋');
    assert.deepEqual(merged.d.buffs[0].bb, { x: 5 }, '按 buff 分派：zj.bb 只覆盖该 buff 本来就有的键（x 9 → 5）');
    const stripped = zjBondView(bonds, { merge: false });
    assert.equal(Object.hasOwn(stripped.a, 'zj'), false);
    assert.equal(Object.hasOwn(stripped.b, 'zj'), false, '普通模式只剥键');
    assert.equal(stripped.c, undefined, 'zjOnly 盟约在普通模式下整条剔除');
    assert.equal(JSON.stringify(bonds), snapshot, '入参未被改写');
    const plain = { x: { identifier: 1 } };
    assert.equal(zjBondView(plain), plain, '一条 zj 都没有时原样返回入参（零拷贝、零位移）');
  });

  test('装备组合表：id 后缀归一、缺一件不激活、去重', () => {
    assert.deepEqual(zjEquipCombos(bonds), [{ bondId: 'd', items: ['i1', 'i2'] }]);
    assert.deepEqual(equipComboBonds(['i1_a', 'i2_b'], zjEquipCombos(bonds)), ['d']);
    assert.deepEqual(equipComboBonds(['i1_b'], zjEquipCombos(bonds)), []);
    assert.deepEqual(equipComboBonds(['i1_a', 'i2_a'], [{ bondId: 'd', items: ['i1', 'i2'] }, { bondId: 'd', items: ['i1'] }]), ['d'], '去重');
  });
});
