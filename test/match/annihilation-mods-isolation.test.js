// test/match/annihilation-mods-isolation.test.js — 湮灭专属 mod 数据的**隔离**断言。
//
// 为什么单独一套：8 个 workshop 包里只有 3 个带数据（egir-buff / rhodes-ship / kazdel-ship），它们把自己塞进**既有**的
// data/bonds.json 与 data/chess.json，靠三类标记隔离（docs/research/20-annihilation-mods.json `_doc`）：
//   · 新盟约 `annOnly: true`（rhodesShip / kazdelShip）—— 只有 ANNIHILATION 收；
//   · 既有盟约的 `bonds[id].ann` 覆盖块 —— 只有 ANNIHILATION 合并（shared/zjBonds.js 的泛化合并，与炸惊的 `zj` 同一套规则）；
//   · `chess[id].annBonds` —— 该棋在湮灭下额外计入的盟约。
// 隔离一旦破，症状是「官方四档的盟约列表里冒出罗德岛 / 卡兹戴尔」或「阿戈尔的文案被改」，**不报错、只改玩法**。
//
// 基线怎么造（与 test/match/zhajing-isolation.test.js 同一手法）：把三类标记从数据里剥掉，再构造一份 GameData，
// 两个池子与逐条盟约记录必须**逐项相等**。这样连「ann 块漏给官方视图」「annBonds 混进官方计数」一起抓住。
//
// 依赖（engine 侧，gamedata.js）：`bondIds` / `bond()` 对 `annOnly` 与 `ann` 的门 —— 没接好时本文件会红，报错文字点名是哪一处。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getData, loadData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { annBondView } from '../../shared/zjBonds.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
// DATA_DIR lets this suite run against a build output (`node tools/build-data.mjs --out <dir>`) before it is promoted into
// data/ — the same escape hatch test/data.test.js has.
const data = process.env.DATA_DIR ? loadData(process.env.DATA_DIR, { log: QUIET }) : getData({ log: QUIET });

/** 官方四档 + 训练 + 炸惊的两条：这些模式一个湮灭专属记录都不许看见。 */
const NON_ANNIHILATION_MODES = Object.freeze([
  'mode_training_1',
  'mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss',
  'mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss',
  'mode_single_zhajing', 'mode_multi_zhajing',
]);
const ANNIHILATION_MODES = Object.freeze(['mode_single_annihilation', 'mode_multi_annihilation']);

/** data 去掉「湮灭专属 mod」的三类标记 → 「没装这三个 mod」的基线。mod 自带的 13 名干员（`annihilation: true`）整条
 *  不在 —— 它们和两条新盟约一样，是内容 mod 存在才有的人物。 */
function baselineData() {
  const bonds = {};
  for (const [id, b] of Object.entries(data.bonds)) {
    if (b.annOnly === true) continue; // 新盟约整条不在
    const copy = { ...b };
    delete copy.ann;                  // 覆盖块剥掉（官方视图本来就该是原记录）
    bonds[id] = copy;
  }
  const chess = {};
  for (const [id, c] of Object.entries(data.chess)) {
    if (c.annihilation === true) continue; // mod 自带干员整条不在
    if (!('annBonds' in c)) { chess[id] = c; continue; }
    const copy = { ...c };
    delete copy.annBonds;
    chess[id] = copy;
  }
  return { ...data, bonds, chess };
}

const annBondIds = Object.keys(data.bonds).filter((id) => data.bonds[id]?.annOnly === true);
const annOverrideIds = Object.keys(data.bonds).filter((id) => data.bonds[id]?.ann && typeof data.bonds[id].ann === 'object');
const annChessIds = Object.keys(data.chess).filter((id) => Array.isArray(data.chess[id]?.annBonds));
/** mod 自带的干员位（26 条记录的基础形 = 13 个）—— 只有 mod 装着才存在。 */
const annBroughtIds = Object.keys(data.chess).filter((id) => {
  const c = data.chess[id];
  return c.annihilation === true && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
});

describe('湮灭专属 mod · 数据形状', () => {
  test('两条新盟约、覆盖块与 research 一一对应、46 条 chess 的 annBonds、13 个 mod 干员位（来自 docs/research/20）', () => {
    assert.deepEqual([...annBondIds].sort(), ['kazdelShip', 'rhodesShip']);
    // 覆盖块的名单：2026-10-30 起 13 名 mod 干员进了名册，包内「给既有盟约追加成员」的记录不再被当成 noop 过滤掉，
    // 覆盖块从 2 条（egirShip 文案 + raidShip 成员）变成 11 条（另外 9 条只追加 mod 干员）。
    assert.deepEqual([...annOverrideIds].sort(), [
      'deputShip', 'egirShip', 'indomShip', 'miraShip', 'preciShip', 'raidShip',
      'skillfulShip', 'steadShip', 'victoriaShip', 'visiShip', 'yanShip',
    ]);
    assert.equal(annChessIds.length, 46);
    assert.equal(annBroughtIds.length, 13);
    for (const id of annBroughtIds) {
      const rec = data.chess[id];
      assert.equal(rec.visible, false, `${id}: 官方池不可见`);
      assert.ok(rec.annBonds.length >= 1, `${id}: annBonds`);
    }
    for (const id of annBondIds) {
      const rec = data.bonds[id];
      assert.equal(rec.annOnly, true, `${id}: annOnly`);
      assert.ok(rec.thresholds.length >= 1 && rec.buffs.length >= 1, `${id}: thresholds / buffs`);
      for (const m of rec.members) assert.ok(data.chess[m], `${id}: member ${m} 不在本仓`);
    }
    for (const id of annChessIds) for (const b of data.chess[id].annBonds) assert.ok(data.bonds[b], `${id}: annBond ${b} 不存在`);
  });

  test('egirShip 的 ann 块只有 4 个文案字段；其余覆盖块只加成员，且加的都是本仓存在的棋', () => {
    assert.deepEqual(Object.keys(data.bonds.egirShip.ann).sort(), ['desc', 'descRaw', 'effectDesc', 'effectDescRaw']);
    assert.notEqual(data.bonds.egirShip.ann.desc, data.bonds.egirShip.desc, '阿戈尔的生命值/吞噬文案应被加强');
    const base = new Set(data.bonds.raidShip.members);
    const added = data.bonds.raidShip.ann.members.filter((m) => !base.has(m));
    assert.deepEqual(added, ['chess_char_5_06_a'], 'raidShip 追加 chess_char_5_06_a');
    for (const id of annOverrideIds) {
      if (id === 'egirShip') continue;
      const ov = data.bonds[id].ann;
      assert.deepEqual(Object.keys(ov).sort(), ['members', 'visibleMembers'], `${id}: 覆盖块只有成员表`);
      const b0 = new Set(data.bonds[id].members);
      const extra = ov.members.filter((m) => !b0.has(m));
      assert.ok(extra.length >= 1, `${id}: 覆盖块必须真的追加了成员`);
      for (const m of extra) assert.ok(data.chess[m], `${id}: 追加成员 ${m} 不在本仓`);
    }
  });

  test('官方盟约记录里没有 ann 块、也没有 annOnly 记录（数据层就干净）', () => {
    for (const [id, b] of Object.entries(data.bonds)) {
      if (annOverrideIds.includes(id) || b.annOnly === true) continue;
      assert.equal('ann' in b, false, `${id}: 不该有 ann 块`);
    }
  });
});

describe('湮灭专属 mod · 官方四档与炸惊看不见它', () => {
  for (const modeId of NON_ANNIHILATION_MODES) {
    test(`${modeId}: visibleChess / 商店 / bandIds / bondIds / 逐条 bond() 与「剥掉三类标记」的基线逐项相等`, () => {
      const gd = new GameData(data, modeId);
      const gdBase = new GameData(baselineData(), modeId);
      assert.deepEqual(gd.visibleChess, gdBase.visibleChess, `${modeId}: visibleChess`);
      assert.deepEqual(gd.shopItemsByTier, gdBase.shopItemsByTier, `${modeId}: shopItemsByTier`);
      assert.deepEqual(gd.bandIds(), gdBase.bandIds(), `${modeId}: bandIds`);
      assert.deepEqual(gd.bondIds, gdBase.bondIds, `${modeId}: bondIds 里出现了湮灭专属盟约（gamedata 的 annOnly 门没接）`);
      for (const bondId of gdBase.bondIds) {
        assert.deepEqual(gd.bond(bondId), gdBase.bond(bondId), `${modeId}: bond(${bondId}) 被 ann 块改写了`);
      }
      for (const id of annBondIds) assert.ok(!gd.bond(id), `${modeId}: 能取到湮灭专属盟约 ${id}`);
    });
  }
});

describe('湮灭专属 mod · 湮灭模式收下它', () => {
  for (const modeId of ANNIHILATION_MODES) {
    test(`${modeId}: bondIds 多出两条新盟约，池子其它部分与基线一致`, () => {
      const gd = new GameData(data, modeId);
      const gdBase = new GameData(baselineData(), modeId);
      const extra = gd.bondIds.filter((id) => !gdBase.bondIds.includes(id)).sort();
      assert.deepEqual(extra, ['kazdelShip', 'rhodesShip'], `${modeId}: 湮灭该多出两条新盟约（gamedata 的 annOnly 门没接）`);
      assert.deepEqual(gd.bondIds.filter((id) => gdBase.bondIds.includes(id)), gdBase.bondIds, `${modeId}: 官方盟约一条不能少`);
      // 这两条只影响盟约视图，不动官方的棋池 / 商店 / 策略池；多出来的正是 mod 自带的 13 个干员位。
      const extraChess = gd.visibleChess.filter((id) => !gdBase.visibleChess.includes(id)).sort();
      assert.deepEqual(extraChess, [...annBroughtIds].sort(), `${modeId}: 湮灭比基线多出的只有 mod 干员`);
      assert.deepEqual(gd.visibleChess.filter((id) => gdBase.visibleChess.includes(id)), gdBase.visibleChess, `${modeId}: 官方棋一条不能少`);
      assert.deepEqual(gd.shopItemsByTier, gdBase.shopItemsByTier, `${modeId}: shopItemsByTier`);
      assert.deepEqual(gd.bandIds(), gdBase.bandIds(), `${modeId}: bandIds`);
    });

    test(`${modeId}: 有 ann 块的盟约是合并后的视图，其余盟约与基线逐项相等`, () => {
      const gd = new GameData(data, modeId);
      const gdBase = new GameData(baselineData(), modeId);
      const egir = gd.bond('egirShip');
      assert.ok(egir, 'egirShip 取不到');
      assert.equal(egir.desc, data.bonds.egirShip.ann.desc, '阿戈尔文案应是 ann 块里的加强版');
      assert.equal('ann' in egir, false, '合并后的视图不该带 ann 键');
      const raid = gd.bond('raidShip');
      assert.ok(raid.members.includes('chess_char_5_06_a'), 'raidShip 在湮灭下应收下 chess_char_5_06_a');
      // 11 条覆盖块（egirShip 文案 + 10 条成员表，2026-10-30 起）：视图必须收下它们追加的成员，且都不带 ann 键
      for (const bondId of annOverrideIds) {
        const view = gd.bond(bondId);
        assert.ok(view, `${modeId}: bond(${bondId}) 取不到`);
        assert.equal('ann' in view, false, `${modeId}: bond(${bondId}) 合并后不该带 ann 键`);
        const want = data.bonds[bondId].ann;
        if (want.members) {
          for (const m of want.members) assert.ok(view.members.includes(m), `${modeId}: bond(${bondId}) 应收下 ${m}`);
        }
      }
      for (const bondId of gdBase.bondIds) {
        if (annOverrideIds.includes(bondId)) continue;
        assert.deepEqual(gd.bond(bondId), gdBase.bond(bondId), `${modeId}: bond(${bondId}) 不该被 ann 影响`);
      }
    });

    test(`${modeId}: 两条新盟约的记录本身可读（阈值/成员/buffs 齐全）`, () => {
      const gd = new GameData(data, modeId);
      for (const id of annBondIds) {
        const rec = gd.bond(id);
        assert.ok(rec, `${modeId}: 湮灭下取不到 ${id}`);
        assert.ok(rec.thresholds.length >= 1, `${id}: thresholds`);
        assert.ok(rec.members.length >= rec.thresholds[0], `${id}: 成员数不足第一档`);
        assert.ok(Array.isArray(rec.buffs) && rec.buffs.length, `${id}: buffs`);
      }
    });
  }

  test('共享合并函数 annBondView 与 data 里的 ann 块一致（引擎与数据同一套语义）', () => {
    const view = annBondView(data.bonds);
    for (const id of annOverrideIds) {
      assert.equal('ann' in view[id], false, `${id}: 视图仍带 ann 键`);
      for (const [k, v] of Object.entries(data.bonds[id].ann)) {
        if (k === 'bb' || k === 'bbStr' || k === 'buffs' || k === 'buffsAll') continue; // 按 zjBonds.js 的规则合并
        if (k === 'desc' || k === 'effectDesc') continue;                               // Raw 版本跟着换
        assert.deepEqual(view[id][k], v, `${id}.${k}: ann 覆盖没生效`);
      }
    }
    // 没有 ann 块的官方记录：视图原样引用（不复制、不改）—— 挑一条**真的没有覆盖块**的（2026-10-30 起 yanShip 有了）
    const plain = Object.keys(data.bonds).find((id) => !annOverrideIds.includes(id) && data.bonds[id]?.annOnly !== true && view[id]);
    assert.ok(plain, '至少有一条没有 ann 块的官方盟约');
    assert.equal(view[plain], data.bonds[plain], `${plain}: 视图原样引用`);
  });
});
