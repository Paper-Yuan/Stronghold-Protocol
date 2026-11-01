// test/match/annihilation-mods-default.test.js — 湮灭专属 mod：两条新盟约**默认开启**，且开关**实时**决定「干员调配」里
// 看得到哪些干员与装备（业主 2026-10-29 · 引擎侧；docs/ANNIHILATION-MODS.md §2.2 第 7 / 8 行）。
//
// 口径：
//   A. `rhodesShip` / `kazdelShip` 缺省开（gamedata.js 的 `ANN_MOD_DEFAULT_ON`）：房间没写过就用 true，写了 true / false 都
//      按写的算 —— 所以「显式 false 仍可关」；官方四档与炸惊在任何开关组合下逐字节不变（它们连 `annOnly` 盟约都看不到）。
//   B. 开关派生三张表，全部**由数据反推**，本文件不写死一个干员 / 装备 id：
//        visibleChess     官方可见棋 − 只由已关闭 mod 带进来的棋（`chess[id].annBonds` 指向 `annOnly` 盟约的边）
//        shopItemsByTier  去掉 `giveBondId` / `requiresBondId` 指向已关闭 mod 盟约的装备
//        bondIds / bond() 关掉的那条 `annOnly` 盟约整个摘掉（⇒「全关 = 官方行为」）
//      房间改开关 → `room.setAnnMods` 重广播 `room.state` → 下一局 Match 用 room.annMods 造 GameData。
//      客户端要读的是 `room.state.annMods`（只含开着的键）+ 缺省表 `ANN_MOD_DEFAULT_ON`。
//   缓存：三张表都在 GameData 构造期按**该实例**的 annMods 算，没有跨实例缓存（Match 每局新建 GameData，Match.js:359）；
//   最后一组用例交替构造开关不同的实例，钉住「不串味」。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import {
  GameData, ANN_MOD_DEFAULT_ON, annModOn, annihilationRoster, annModBonds, itemAnnModOff,
} from '../../server/match/gamedata.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';
import { RULE_SWITCHES } from '../../shared/plugins/rules.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
const DATA = getData({ log: QUIET });
const CHESS = DATA.chess;
const BONDS = DATA.bonds;

const ANN = 'mode_single_annihilation';
const ANN_COOP = 'mode_multi_annihilation';
/** 官方四档（单 / 同盟）+ 训练 + 炸惊两条：这些模式在任何开关组合下都不许动。 */
const NON_ANNIHILATION_MODES = Object.freeze([
  'mode_training_1',
  'mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss',
  'mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss',
  'mode_single_zhajing', 'mode_multi_zhajing',
]);

const gdOf = (annMods, modeId = ANN) => new GameData(DATA, modeId, annMods === undefined ? {} : { annMods });
/** 官方名册（官方四档的 visibleChess）：112 条。 */
const OFFICIAL_ROSTER = gdOf(undefined, 'mode_single_normal').visibleChess;
/** 数据里属于内容 mod 的两条 `annOnly` 盟约（不写死：从 data/bonds.json 反推） */
const MOD_BONDS = annModBonds(BONDS);
/** mod 自带的干员位（13 个：26 条记录的 `_a` 基础形，docs/research/20）—— 官方四档永远看不见。 */
const ANN_BROUGHT = Object.keys(CHESS).filter((id) => {
  const c = CHESS[id];
  return c && c.annihilation === true && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true && Number.isInteger(c.tier);
}).sort();
/** 某条棋「由 mod 带进来」的边（只算指向 annOnly 盟约的那几条） */
const modEdgesOf = (id) => (Array.isArray(CHESS[id]?.annBonds) ? CHESS[id].annBonds.filter((b) => MOD_BONDS.includes(b)) : []);
/** 关掉 `off` 这些 mod 之后应当仍在名册里的棋：官方棋去掉只由关闭的 mod 带进来的，加上 mod 自带、还有一条边开着的干员位。 */
const expectedRoster = (off = []) => [
  ...OFFICIAL_ROSTER.filter((id) => {
    const edges = modEdgesOf(id);
    return edges.length === 0 || edges.some((b) => !off.includes(b));
  }),
  ...ANN_BROUGHT.filter((id) => modEdgesOf(id).some((b) => !off.includes(b))),
].sort();
const droppedBy = (off = []) => OFFICIAL_ROSTER.filter((id) => !expectedRoster(off).includes(id));
const annDroppedBy = (off = []) => ANN_BROUGHT.filter((id) => !expectedRoster(off).includes(id));

describe('湮灭 mod · 默认开启（A）', () => {
  test('默认名单就是数据里那两条 annOnly 盟约：rhodesShip / kazdelShip 缺省开，其余内容开关缺省关', () => {
    assert.deepEqual([...ANN_MOD_DEFAULT_ON].sort(), [...MOD_BONDS].sort(), '缺省开的就是数据里的两条 annOnly 盟约');
    assert.deepEqual([...MOD_BONDS].sort(), ['kazdelShip', 'rhodesShip'], '数据侧新增 / 改名时这条会先红');
    const gd = gdOf();
    assert.equal(gd.annMod('rhodesShip'), true, '缺省开');
    assert.equal(gd.annMod('kazdelShip'), true, '缺省开');
    assert.equal(gd.annMod('egirBuff'), false, '其余内容开关缺省仍关');
    assert.equal(gd.annMod('commsPriority'), false);
    assert.equal(gd.annMod('comms'), false, 'comms 是别名，缺省同样关');
    assert.deepEqual({ ...gd.annMods }, {}, '缺省不进 annMods（那张表只存房间写过的值）');
    // 四把规则开关的缺省仍是官方档：默认开启的两条不改规则门的语义
    for (const name of Object.keys(RULE_SWITCHES)) {
      assert.equal(gd.rulesOf(name), RULE_SWITCHES[name].options[0], `${name} 缺省仍是官方档`);
    }
  });

  test('房间显式 false 仍可关、显式 true 仍是开；两个键互不影响（annModOn 是唯一的判定口）', () => {
    const rhodesOff = gdOf({ rhodesShip: false });
    assert.equal(rhodesOff.annMod('rhodesShip'), false, '显式 false 关掉了缺省开的 mod');
    assert.equal(rhodesOff.annMod('kazdelShip'), true, '另一条不受影响');
    assert.deepEqual({ ...rhodesOff.annMods }, { rhodesShip: false }, 'false 也留下来（否则「关」没法表达）');
    const bothOff = gdOf({ rhodesShip: false, kazdelShip: false });
    assert.equal(bothOff.annMod('rhodesShip'), false);
    assert.equal(bothOff.annMod('kazdelShip'), false);
    // 纯函数与实例口径一致
    assert.equal(annModOn({ rhodesShip: false }, 'rhodesShip'), false);
    assert.equal(annModOn({}, 'rhodesShip'), true);
    assert.equal(annModOn({ egirBuff: true }, 'egirBuff'), true);
    assert.equal(annModOn(null, 'rhodesShip'), true, '房间没设置 ⇒ 缺省开');
  });

  test('官方四档 / 训练 / 炸惊：任何开关组合下 annMod 恒 false，annMods 不长键', () => {
    const combos = [
      {},
      { rhodesShip: true },
      { rhodesShip: false, kazdelShip: false },
      { rhodesShip: true, kazdelShip: true, egirBuff: true, commsPriority: true, shopBias: true, prepLoadout: true, morphPairing: true, unequip: true },
    ];
    for (const modeId of NON_ANNIHILATION_MODES) {
      const base = gdOf(undefined, modeId);
      for (const annMods of combos) {
        const gd = gdOf(annMods, modeId);
        for (const name of ['rhodesShip', 'kazdelShip', 'egirBuff', 'commsPriority']) {
          assert.equal(gd.annMod(name), false, `${modeId}: ${name} 在非湮灭模式里恒 false`);
        }
        assert.deepEqual({ ...gd.annMods }, {}, `${modeId}: 开关不进非湮灭的 GameData`);
        assert.deepEqual(gd.bondIds, base.bondIds, `${modeId}: 盟约表不变`);
      }
    }
  });
});

describe('湮灭 mod · 开关派生名册与装备池（B）', () => {
  test('visibleChess：缺省 = 官方 112 + mod 自带的 13 个干员位 = 125，关一条只少「只由它带进来」的棋', () => {
    assert.equal(OFFICIAL_ROSTER.length, 112, '官方可见棋 112 条（数据一变就该先在这里响）');
    assert.equal(ANN_BROUGHT.length, 13, 'mod 自带的干员位 13 个（26 条记录的基础形）');
    assert.deepEqual(gdOf().visibleChess, expectedRoster(), '两条 mod 缺省开 ⇒ 官方名册 + mod 干员');
    assert.equal(gdOf().visibleChess.length, 125);
    assert.deepEqual(gdOf({ rhodesShip: true, kazdelShip: true }).visibleChess, expectedRoster(), '显式开也一样');

    for (const off of [['rhodesShip'], ['kazdelShip'], ['rhodesShip', 'kazdelShip']]) {
      const gd = gdOf(Object.fromEntries(off.map((b) => [b, false])));
      assert.deepEqual(gd.visibleChess, expectedRoster(off), `关 ${off.join('+')}：名册 = 官方 − 只由它带进来的棋 + 还有边的 mod 干员`);
      assert.ok(droppedBy(off).every((id) => !gd.visibleChess.includes(id)), `关 ${off.join('+')}：带进来的棋真的没了`);
      assert.ok(annDroppedBy(off).every((id) => !gd.visibleChess.includes(id)), `关 ${off.join('+')}：mod 自带的干员也真的没了`);
    }
    // 只挂 rhodesShip 的棋关 kazdelShip 时不动，反之亦然（two-way 的两条棋也在数据里）
    for (const [off, keep] of [[['kazdelShip'], 'rhodesShip'], [['rhodesShip'], 'kazdelShip']]) {
      const gd = gdOf({ [off[0]]: false });
      const stillThere = [...OFFICIAL_ROSTER, ...ANN_BROUGHT].filter((id) => modEdgesOf(id).includes(keep) && !modEdgesOf(id).includes(off[0]));
      assert.ok(stillThere.length > 0, `数据里应有只挂 ${keep} 的棋`);
      for (const id of stillThere) assert.ok(gd.visibleChess.includes(id), `关 ${off[0]} 不该影响 ${id}（它只挂 ${keep}）`);
    }
  });

  test('同盟湮灭与单人湮灭用同一份名册；全关 = 官方名册（mod 带入的棋全部下线）', () => {
    assert.deepEqual(gdOf(undefined, ANN_COOP).visibleChess, gdOf().visibleChess, 'solo / coop 名册相同');
    const allOff = Object.fromEntries(MOD_BONDS.map((b) => [b, false]));
    assert.deepEqual(gdOf(allOff).visibleChess, expectedRoster(MOD_BONDS), '全关：所有带进来的棋都没了');
    assert.equal(gdOf(allOff).visibleChess.filter((id) => CHESS[id].annihilation === true).length, 0, '全关：mod 自带的 13 个干员位下线');
    assert.ok(droppedBy(MOD_BONDS).length > 0, '数据里确实有只由 mod 带进来的官方棋');
    assert.equal(annDroppedBy(MOD_BONDS).length, 13, '全关：13 个 mod 干员位全部下线');
    assert.deepEqual(gdOf(allOff, ANN_COOP).visibleChess, gdOf(allOff).visibleChess);
  });

  test('annihilationRoster（lobby 校验用的那份）与 GameData.visibleChess 逐项相等 —— 两条口径不会漂', () => {
    const combos = [undefined, {}, { rhodesShip: false }, { kazdelShip: false }, { rhodesShip: false, kazdelShip: false }, { rhodesShip: true, kazdelShip: true }];
    for (const annMods of combos) {
      const gd = gdOf(annMods);
      assert.deepEqual(annihilationRoster(CHESS, BONDS, annMods), gd.visibleChess, `annMods=${JSON.stringify(annMods)}`);
    }
  });

  test('bondIds / bond()：关掉的那条 annOnly 盟约整个摘掉，两条都关就与官方盟约表逐项相同', () => {
    const both = gdOf();
    for (const id of MOD_BONDS) {
      assert.ok(both.bondIds.includes(id), `缺省开：${id} 在盟约表里`);
      assert.ok(both.bond(id), `缺省开：${id} 取得到记录`);
    }
    const rhodesOff = gdOf({ rhodesShip: false });
    assert.ok(!rhodesOff.bondIds.includes('rhodesShip'), '关掉的盟约不在 bondIds 里');
    assert.equal(rhodesOff.bond('rhodesShip'), null, 'bond() 也拿不到（视图与表一致）');
    assert.ok(rhodesOff.bondIds.includes('kazdelShip'), '另一条还在');
    // 全关 = 官方行为：盟约表与官方四档逐项相同
    const allOff = gdOf(Object.fromEntries(MOD_BONDS.map((b) => [b, false])));
    assert.deepEqual(allOff.bondIds, gdOf(undefined, 'mode_single_normal').bondIds, '全关：盟约表回到官方');
    assert.ok(allOff.bondIds.length > 0);
  });

  test('装备池：现网数据里的 mod 装备（annOnly）只在湮灭且开关开着时进池；官方四档一件都看不到', () => {
    // 2026-10-29：数据补齐了（docs/research/20-annihilation-mods.json 的 8 条 chess_item_c_0*_e_*，4 普通 + 4 精英）。
    // 它们是「每 100 层发一件」的奖励装，所以必须 `annOnly: true` + `hideInShop: true` —— 这两条同时是 golden 的护栏
    //（漏一条官方商店池 / golden 的 EQUIPS 游标就整体错位）。
    const real = Object.values(DATA.items || {}).filter((it) => it && (MOD_BONDS.includes(it.giveBondId) || MOD_BONDS.includes(it.requiresBondId)));
    assert.ok(real.length >= 4, `现网数据里应有这两个 mod 的装备（实际 ${real.length} 条）`);
    for (const it of real) {
      assert.equal(it.annOnly, true, `${it.id} 必须标 annOnly`);
      assert.equal(it.hideInShop, true, `${it.id} 是奖励装，不进商店`);
    }
    const ids = real.map((it) => it.id);
    const flat = (tiers) => Object.values(tiers || {}).flat();
    const official = flat(gdOf(undefined, 'mode_single_normal').shopItemsByTier);
    const abyss = flat(gdOf(undefined, 'mode_single_abyss').shopItemsByTier);
    for (const id of ids) {
      assert.ok(!official.includes(id) && !abyss.includes(id), `${id} 不该出现在官方商店池`);
    }
    // 奖励装**不进任何商店池**（湮灭局也一样）：发放走盟约里程碑（卡兹戴尔 `<每叠加100层>` → 断角）/ mod 自己的逻辑，
    // 池子里的 `annOnly` 门由下面那份合成数据守住（那两条没有 hideInShop，是「可售的 mod 装备」）。
    const annPool = flat(gdOf(undefined).shopItemsByTier);
    for (const id of ids) assert.ok(!annPool.includes(id), `${id} 是奖励装，湮灭局（缺省开）的商店池里也不该有它`);
    const offAll = flat(gdOf(Object.fromEntries(MOD_BONDS.map((b) => [b, false]))).shopItemsByTier);
    for (const id of ids) assert.ok(!offAll.includes(id), `${id} 两条 mod 全关后同样不在池里`);

    // 合成一份带装备的数据（id 明显是测试脚手架，不是仓库数据里的 id）：守住 giveBondId / requiresBondId 两条代码路径
    const itemA = { id: 'chess_item_test_mod_e_a', baseId: 'chess_item_test_mod_e_a', itemType: 'EQUIP', tier: 2, price: 3, giveBondId: 'rhodesShip', family: null };
    const itemB = { id: 'chess_item_test_req_e_a', baseId: 'chess_item_test_req_e_a', itemType: 'EQUIP', tier: 2, price: 3, requiresBondId: 'kazdelShip', family: null };
    const data = { ...DATA, items: { ...DATA.items, [itemA.id]: itemA, [itemB.id]: itemB } };
    const at = (annMods) => new GameData(data, ANN, annMods === undefined ? {} : { annMods });
    assert.ok(at().shopItemsByTier[2].includes(itemA.id), '缺省开：giveBondId 的装备在池里');
    assert.ok(at().shopItemsByTier[2].includes(itemB.id), '缺省开：requiresBondId 的装备也在池里');
    const rhodesOff = at({ rhodesShip: false });
    assert.ok(!rhodesOff.shopItemsByTier[2].includes(itemA.id), '关掉 rhodesShip：它的装备立刻消失');
    assert.ok(rhodesOff.shopItemsByTier[2].includes(itemB.id), 'kazdelShip 的装备不受影响');
    assert.ok(!at({ kazdelShip: false }).shopItemsByTier[2].includes(itemB.id), '反过来同样');
    assert.ok(at({ rhodesShip: true }).shopItemsByTier[2].includes(itemA.id), '显式 true 仍然在池里');
    // 工具函数本身（server 侧唯一判据）
    assert.equal(itemAnnModOff(itemA, BONDS, { rhodesShip: false }), true);
    assert.equal(itemAnnModOff(itemA, BONDS, {}), false, '缺省开 ⇒ 不属于「已关闭的 mod」');
  });

  test('缓存不串味：开关不同的两个实例交替构造，各自的三张表始终是自己的那份', () => {
    const on = gdOf({ rhodesShip: true, kazdelShip: true });
    const off = gdOf({ rhodesShip: false, kazdelShip: false });
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(on.visibleChess, expectedRoster(), `第 ${i + 1} 轮：开着的那份不变`);
      assert.deepEqual(off.visibleChess, expectedRoster(MOD_BONDS), `第 ${i + 1} 轮：关着的那份不变`);
      assert.deepEqual(on.bondIds.filter((b) => MOD_BONDS.includes(b)).sort(), [...MOD_BONDS].sort());
      assert.deepEqual(off.bondIds.filter((b) => MOD_BONDS.includes(b)), []);
    }
  });
});

describe('湮灭 mod · 官方四档与炸惊逐字节不变', () => {
  const COMBOS = [
    {},
    { rhodesShip: false, kazdelShip: false },
    { rhodesShip: true, kazdelShip: true },
    { rhodesShip: true, kazdelShip: false, egirBuff: true },
    { shopBias: true, prepLoadout: true, morphPairing: true, unequip: true, egirBuff: true, commsPriority: true, rhodesShip: true, kazdelShip: true },
  ];
  for (const modeId of NON_ANNIHILATION_MODES) {
    test(`${modeId}: visibleChess / shopItemsByTier / bondIds / bond() / flags 与「完全没有 annMods」的基线逐项相等`, () => {
      const base = gdOf(undefined, modeId);
      for (const annMods of COMBOS) {
        const gd = gdOf(annMods, modeId);
        assert.deepEqual(gd.visibleChess, base.visibleChess, `${modeId} ${JSON.stringify(annMods)}: visibleChess`);
        assert.deepEqual(gd.shopItemsByTier, base.shopItemsByTier, `${modeId} ${JSON.stringify(annMods)}: shopItemsByTier`);
        assert.deepEqual(gd.bondIds, base.bondIds, `${modeId} ${JSON.stringify(annMods)}: bondIds`);
        for (const id of MOD_BONDS) assert.equal(gd.bond(id), null, `${modeId}: 取不到 ${id}`);
        assert.deepEqual(gd.annihilationFlags('normal', 1), base.annihilationFlags('normal', 1), `${modeId}: flags`);
      }
    });
  }

  test('炸惊的专属记录一条都没漏进来（开关全开时也一样）', () => {
    const gd = gdOf(COMBOS[COMBOS.length - 1], 'mode_single_zhajing');
    assert.equal(gd.visibleChess.filter((id) => CHESS[id]?.zhajing === true).length, gd.visibleChess.length, '炸惊池只含 zj 记录');
    assert.ok(!gd.visibleChess.some((id) => CHESS[id]?.zhajing !== true), '一条官方棋都没混进来');
  });
});

describe('湮灭 mod · 房间改开关 → 下一局引擎看到新集合', () => {
  /** A real annihilation match carrying the room's switches (the opts path server/lobby.js startMatch uses). */
  function annMatch(annMods) {
    return new Match({
      roomCode: 'ANM', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY, erosion: 1, seed: 'ann-mods-default', annMods,
      seats: [{ seat: 0, playerId: 'p0', name: 'P0', connected: true }],
      data: DATA, log: QUIET, scheduler: new VirtualScheduler(), send: () => true, broadcast: () => {}, onEnd: () => {},
      clientCombat: false, verify: 'off',
    });
  }

  test('Match 把房间的 annMods 带到 GameData：缺省全开，显式 false 的名册立刻少掉那几条', () => {
    const dflt = annMatch(undefined);
    dflt.start();
    assert.equal(dflt.gd.annMod('rhodesShip'), true, '缺省开（Match 没收到开关也一样）');
    assert.deepEqual(dflt.gd.visibleChess, expectedRoster());
    dflt.dispose();

    const off = annMatch({ rhodesShip: false, kazdelShip: false });
    off.start();
    assert.equal(off.gd.annMod('rhodesShip'), false, '房间显式关掉');
    assert.deepEqual(off.gd.visibleChess, expectedRoster(MOD_BONDS), '名册跟着开关');
    assert.equal(off.gd.bond('rhodesShip'), null);
    // 战场侧：显式 boolean 全带（含 false），缺省不进 flags —— sim 侧用同一份 shared 缺省表兜底
    assert.deepEqual({ ...off.gd.annihilationFlags('normal', 1).annMods }, { rhodesShip: false, kazdelShip: false },
      '显式 false 也进 flags（否则「关掉默认开启的那条」到不了 sim）');
    off.dispose();
    assert.equal(Object.hasOwn(gdOf().annihilationFlags('normal', 1), 'annMods'), false,
      '没有显式键时 flags 不长 annMods（缺省由 sim 侧的 shared 表算）');
  });

  test('room.setAnnMods 重广播 room.state，下一局交给 Match 的就是新开关（客户端据此重算）', async () => {
    const captured = [];
    class CaptureMatch extends StubMatch {
      constructor(opts) { super(opts); captured.push(opts); }
    }
    const srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: CaptureMatch });
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    try {
      const w = await c.hello('AnnMods');
      c.id = w.playerId;
      await c.request({ t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY });
      const st0 = await c.waitFor('room.state', (s) => !!s.code, 4000);
      assert.deepEqual(st0.annMods, {}, '房间没写过开关 ⇒ room.state.annMods 是空的（缺省由客户端自带的表算）');

      const ok = await c.request({ t: 'room.setAnnMods', annMods: { rhodesShip: false, kazdelShip: false, egirBuff: true } });
      assert.equal(ok.t, 'ok', JSON.stringify(ok));
      // 重广播：**显式键**原样回显 —— `true` 与 `false` 都发，缺省值不进表（所以整张表 = 玩家写过的那几笔）
      const st1 = await c.waitFor('room.state', (s) => !!s.annMods && s.annMods.egirBuff === true, 3000);
      assert.equal(st1.annMods.rhodesShip, false, '显式关的那条以 false 出现在回显里（客户端据此画成「关」）');
      assert.equal(st1.annMods.kazdelShip, false, '同样以 false 出现');
      assert.deepEqual(st1.annMods, { rhodesShip: false, kazdelShip: false, egirBuff: true }, '回显只有显式键，缺省不进来');

      const start = await c.request({ t: 'room.start' });
      assert.equal(start.t, 'ok', JSON.stringify(start));
      assert.equal(captured.length, 1, '房间起了一局 match');
      // lobby.js 交给 Match 的 opts.annMods 是**存的整张表**（含显式 false）：引擎据此算名册
      assert.deepEqual(captured[0].annMods, { rhodesShip: false, kazdelShip: false, egirBuff: true }, 'Match 收到的是含 false 的整张表');
      const gd = new GameData(DATA, 'mode_single_annihilation', { annMods: captured[0].annMods });
      assert.deepEqual(gd.visibleChess, expectedRoster(MOD_BONDS), '下一局的名册已按新开关收窄');
    } finally {
      await c.terminate().catch(() => {});
      await srv.close();
    }
  });
});
