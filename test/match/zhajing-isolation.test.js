// test/match/zhajing-isolation.test.js — 炸惊模拟 (ZHAJING) 的**隔离**断言：主玩法各版本一个字节都不能被污染。
//
// 为什么单独一套：炸惊模拟不是独立数据集，它的记录**就躺在** data/chess.json / items.json / bands.json / bonds.json 里
// 靠标记隔离（handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2）。隔离一旦破，症状是「官方四档的商店里冒出 chess_zj_*」
// 这种**静默错误**——不报错、不掉帧，只是玩法变了。所以这里钉的是不变量，不是某条记录的值。
//
// 基线怎么造（Lead 的明确要求）：**不是**只断言「不含 zhajing 记录」。把 zhajing:true 的 chess 记录从数据里删掉，
// 用剩下的数据再构造一份 GameData，两个池子必须**数组逐项相等**。这样连「官方记录被误标成 zhajing」「顺序变了」
// 「visible 被改」这类错误也一起抓住 —— 只断言「不含」会漏掉 visible:true 的误标。
//
// 依赖（P2 引擎层，gamedata.js）：`visibleChess` / `shopItemsByTier` / `bandAllowed` / `bond()` 的 zhajing 门。
// 这三处没接好时本文件会红，且报错文字点名是哪一处 —— 那是本套用例存在的意义，不是它写错了。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { ZHAJING_DIFFICULTY, ZHAJING_MODE_IDS, isZhajingMode, isZhajingDifficulty } from '../../shared/zhajing-constants.js';
import { jibianBonds } from '../../server/sim/content/jibianBonds.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
const data = getData({ log: QUIET });

/** 官方四档 × 单人与同盟，加湮灭模拟的两条 —— 这些模式一个 zj 记录都不许看见。 */
const OFFICIAL_MODES = Object.freeze([
  'mode_training_1',
  'mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss',
  'mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss',
  'mode_single_annihilation', 'mode_multi_annihilation',
]);

/** 炸惊棋库的标记：`zhajing === true`（包内另有 6 条 chess_zj_* 保留 `zhajing:false`，它们 visible:false，两边都进不去）。 */
const isZjChess = (c) => !!c && c.zhajing === true;

/** 同一份 data，去掉所有 zhajing:true 的棋 —— 主玩法的「无炸惊」基线。 */
function baselineData() {
  const chess = {};
  for (const [id, c] of Object.entries(data.chess)) if (!isZjChess(c)) chess[id] = c;
  return { ...data, chess };
}

const baseline = new GameData(baselineData(), 'mode_single_hard');
const zjIds = new Set(Object.keys(data.chess).filter((id) => isZjChess(data.chess[id])));

describe('炸惊模拟 · 常量', () => {
  test('difficulty 与两条 modeId', () => {
    assert.equal(ZHAJING_DIFFICULTY, 'ZHAJING');
    assert.deepEqual([...ZHAJING_MODE_IDS], ['mode_single_zhajing', 'mode_multi_zhajing']);
    assert.equal(isZhajingMode('mode_multi_zhajing'), true);
    assert.equal(isZhajingMode('mode_single_abyss'), false);
    assert.equal(isZhajingMode(null), false);
    assert.equal(isZhajingDifficulty('ZHAJING'), true);
    assert.equal(isZhajingDifficulty('ANNIHILATION'), false);
  });

  test('两条 mode 记录存在，difficulty 是 ZHAJING，code 不与湮灭撞码', () => {
    for (const modeId of ZHAJING_MODE_IDS) {
      const m = data.config.modes[modeId];
      assert.ok(m, `${modeId} 不在 config.modes 里`);
      assert.equal(m.difficulty, ZHAJING_DIFFICULTY);
      assert.equal(m.code, 'AC-8', `${modeId}: code`);
      assert.equal(m.sortId, 7, `${modeId}: sortId`);
      assert.equal(m.inScope, true, `${modeId}: inScope`);
      // 官方四档 / 湮灭的 code 不许被它覆盖
      assert.notEqual(m.code, data.config.modes.mode_single_annihilation.code);
    }
  });

  test('官方四档的难度卡没有被改动（AC-1…AC-4 仍是那四档）', () => {
    const expected = { mode_single_funny: 'FUNNY', mode_single_normal: 'NORMAL', mode_single_hard: 'HARD', mode_single_abyss: 'ABYSS' };
    const codes = ['AC-1', 'AC-2', 'AC-3', 'AC-4'];
    for (const [modeId, difficulty] of Object.entries(expected)) {
      assert.equal(data.config.modes[modeId].difficulty, difficulty, `${modeId}: difficulty`);
      assert.equal(data.config.modes[modeId].code, codes[['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].indexOf(difficulty)], `${modeId}: code 被改动了`);
    }
  });
});

describe('炸惊模拟 · 主玩法隔离（官方四档 + 同盟/单人 + 湮灭）', () => {
  for (const modeId of OFFICIAL_MODES) {
    test(`${modeId}: 棋池不含任何炸惊记录，且与「无 zj 记录」基线逐项相等`, () => {
      const gd = new GameData(data, modeId);
      const leaked = gd.visibleChess.filter((id) => zjIds.has(id));
      assert.deepEqual(leaked, [], `${modeId}: visibleChess 里出现了炸惊棋 ${leaked.slice(0, 5).join(', ')}`);
      // 逐项相等：连「官方记录被误标 zhajing」「visible 被改」也一起抓
      const gdBase = new GameData(baselineData(), modeId);
      assert.deepEqual(gd.visibleChess, gdBase.visibleChess, `${modeId}: visibleChess 与无 zj 基线不一致`);
      assert.ok(gd.visibleChess.length > 0, `${modeId}: visibleChess 不应为空`);
    });

    test(`${modeId}: 商店道具不含 zjOnly（炸惊专属装备不出现在官方商店）`, () => {
      const gd = new GameData(data, modeId);
      const zjItems = new Set(Object.entries(data.items).filter(([, it]) => it.zjOnly === true).map(([id]) => id));
      const leaked = Object.values(gd.shopItemsByTier).flat().filter((id) => zjItems.has(id));
      assert.deepEqual(leaked, [], `${modeId}: 商店道具里出现了 zjOnly 道具 ${leaked.slice(0, 5).join(', ')}`);
      const base = new GameData(baselineData(), modeId);
      assert.deepEqual(gd.shopItemsByTier, base.shopItemsByTier, `${modeId}: shopItemsByTier 与无 zj 基线不一致`);
    });

    test(`${modeId}: 盟约记录没有 zj 覆盖块泄漏，zjOnly 盟约不可见`, () => {
      const gd = new GameData(data, modeId);
      const leaked = [];
      for (const bondId of gd.bondIds) {
        const rec = gd.bond(bondId);
        if (!rec) continue;
        if ('zj' in rec) leaked.push(bondId);
        if (rec.zjOnly === true) leaked.push(`${bondId}(zjOnly)`);
      }
      assert.deepEqual(leaked, [], `${modeId}: 盟约视图泄漏 ${leaked.slice(0, 5).join(', ')}（要我方 zjBondView(bonds, {merge:false})）`);
      // 一条带 zj 块的既有盟约，官方模式下必须与包内基础记录逐字段相同（覆盖块一律剥掉：
      // zj = 炸惊、ann = 湮灭专属 mod、inf = 超限模拟，三者都只在各自的模式下合并）
      const sample = 'lateranoShip';
      if (data.bonds[sample]?.zj) {
        const plain = { ...data.bonds[sample] };
        delete plain.zj;
        delete plain.ann;
        delete plain.inf;
        assert.deepEqual(gd.bond(sample), plain, `${modeId}: ${sample} 的官方视图应等于去掉 zj 块的原记录`);
      }
    });

    test(`${modeId}: 策略池不含 zjOnly 策略`, () => {
      const gd = new GameData(data, modeId);
      const zjBands = Object.entries(data.bands).filter(([, b]) => b.zjOnly === true).map(([id]) => id);
      for (const bandId of zjBands) {
        assert.equal(gd.bandAllowed(bandId), false, `${modeId}: 可选到炸惊专属策略 ${bandId}`);
        assert.equal(gd.bandIds().includes(bandId), false, `${modeId}: bandIds() 里出现了 ${bandId}`);
      }
    });
  }

  test('官方模式的棋面数量不因炸惊而变（visibleChess 与无 zj 基线同长度）', () => {
    const gd = new GameData(data, 'mode_multi_abyss');
    assert.equal(gd.visibleChess.length, new GameData(baselineData(), 'mode_multi_abyss').visibleChess.length);
    assert.equal(gd.visibleChess.length, baseline.visibleChess.length, '基线本身也应是同一份（构造方式一致性自检）');
  });
});

describe('炸惊模拟 · 炸惊模式自己的池子', () => {
  const gd = new GameData(data, 'mode_single_zhajing');

  test('visibleChess 只含炸惊记录，不混主棋库，且非空', () => {
    assert.ok(gd.visibleChess.length > 0, 'mode_single_zhajing: visibleChess 为空（gamedata 的 zhajing 门没接）');
    const outsiders = gd.visibleChess.filter((id) => !isZjChess(data.chess[id]));
    assert.deepEqual(outsiders, [], `炸惊模式混进了非炸惊棋 ${outsiders.slice(0, 5).join(', ')}`);
    // 主棋库一条都不许出现
    const mainIds = new Set(Object.keys(data.chess).filter((id) => !isZjChess(data.chess[id]) && data.chess[id].visible === true));
    const overlap = gd.visibleChess.filter((id) => mainIds.has(id));
    assert.deepEqual(overlap, [], `炸惊模式混进了主玩法的棋 ${overlap.slice(0, 5).join(', ')}`);
  });

  test('炸惊模式下 zjOnly 道具与策略可见', () => {
    const zjItems = Object.entries(data.items).filter(([, it]) => it.zjOnly === true).map(([id]) => id);
    const shop = new Set(Object.values(gd.shopItemsByTier).flat());
    assert.ok(zjItems.some((id) => shop.has(id)), '炸惊商店里一件 zjOnly 道具都没有（shopItemsByTier 的 zhajing 门没接）');
    const zjBands = Object.entries(data.bands).filter(([, b]) => b.zjOnly === true).map(([id]) => id);
    for (const bandId of zjBands) assert.equal(gd.bandAllowed(bandId), true, `炸惊模式可选不到自己的策略 ${bandId}`);
  });

  test('盟约视图是合并后的（带 zj 覆盖），且 zjOnly 盟约在池子里', () => {
    const bonded = Object.keys(data.bonds).filter((id) => data.bonds[id]?.zj);
    assert.ok(bonded.length >= 16, `带 zj 块的盟约只有 ${bonded.length} 条`);
    const sample = bonded.find((id) => data.bonds[id].zj && !data.bonds[id].zjOnly);
    const merged = gd.bond(sample);
    assert.ok(merged, `炸惊模式下取不到盟约 ${sample}`);
    assert.equal('zj' in merged, false, `${sample}: 合并后的视图仍带 zj 键`);
    for (const [k, v] of Object.entries(data.bonds[sample].zj)) {
      if (k === 'bb' || k === 'bbStr' || k === 'buffs' || k === 'buffsAll') continue;   // 这三处按 zjBonds.js 的规则合并
      if (k === 'desc' || k === 'effectDesc') continue;                                 // Raw 版本跟着换
      assert.deepEqual(merged[k], v, `${sample}.${k} 的 zj 覆盖没生效`);
    }
    for (const id of Object.keys(data.bonds).filter((b) => data.bonds[b]?.zjOnly === true)) {
      assert.ok(gd.bond(id), `炸惊模式下取不到 zjOnly 盟约 ${id}`);
    }
  });
});

describe('炸惊模拟 · 惊变（jibian / enemyJibian）', () => {
  test('两条 mode 的惊变池是 99 + 21 张，参数齐全', () => {
    for (const modeId of ZHAJING_MODE_IDS) {
      const m = data.config.modes[modeId];
      assert.equal(m.jibian.pool.length, 99, `${modeId}: jibian.pool`);
      assert.equal(m.jibian.cards, 3, `${modeId}: jibian.cards 三选一`);
      assert.equal(m.jibian.rerolls, 4, `${modeId}: jibian.rerolls`);
      assert.equal(m.enemyJibian.pool.length, 21, `${modeId}: enemyJibian.pool`);
      assert.deepEqual(m.enemyJibian.rounds, [1, 6], `${modeId}: enemyJibian.rounds`);
      for (const c of [...m.jibian.pool, ...m.enemyJibian.pool]) {
        assert.ok(c.effectId && c.name && typeof c.desc === 'string' && c.rarity, `${modeId}: 卡片字段不全 ${c.effectId}`);
      }
    }
  });

  test('官方模式下读不到惊变池（mode 记录里没有这两个键）', () => {
    for (const modeId of OFFICIAL_MODES) {
      assert.equal(data.config.modes[modeId].jibian, undefined, `${modeId} 带了 jibian`);
      assert.equal(data.config.modes[modeId].enemyJibian, undefined, `${modeId} 带了 enemyJibian`);
    }
  });

  test('data/jibianBonds.json 与引擎表逐条相等（真源是 server/sim/content/jibianBonds.js）', () => {
    const file = data.jibianBonds;
    assert.ok(file, 'data/jibianBonds.json 没被加载（loadData 读 data/*.json，检查文件是否已生成）');
    assert.ok(Array.isArray(file.bonds), 'data/jibianBonds.json 的 bonds 应为数组');
    const engine = jibianBonds().map((b) => ({ id: b.id, name: b.name, tiers: [...b.tiers], members: [...b.members], effect: b.effect }));
    assert.deepEqual(file.bonds, engine, 'data/jibianBonds.json 与引擎表不一致（数据是镜像，改引擎表后要重跑 build-data）');
  });
});
