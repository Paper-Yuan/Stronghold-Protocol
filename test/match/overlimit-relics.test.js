// test/match/overlimit-relics.test.js — 超限模拟「词条」（饰品）第一批：数据 / 权重 / 选取流程（业主 2026-10-31）。
//
// 业主定稿的规则（逐条钉在这里）：
//   1. LC-001…007：正常段 R3 与 R8 各一次三选一，**每次都从「还没选过」的 LC 里抽 3 张**，选 1；
//   2. 无限段：每个 Boss 轮（R20/25/30…）之后的下一回合一次三选一，池 = SP + EX + FGO-SP + FGO-Ⅹ + 普通 FGO +
//      **未被选走的 LC**；
//   3. 权重每条：SP 1.8% / FGO-Ⅹ 1.5% / EX 0.02% / FGO-SP 0.01% / 未选 LC 各 1% / 普通 FGO **均分剩余**（rest/N，
//      不是写死 4.753%）；
//   4. 不加刷新（不重掷、无 reroll），已选过的不再出现（无放回），同一条不叠加两份；
//   5. 普通 / 湮灭 / 炸惊一帧不变：`gd.relicsOverlimit` 只在超限局非 null，私有视图也不多那个键。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  RELIC_CARD_FAMILY, RELIC_LC_ROUNDS, RELIC_INVALIDATED_BY, RELIC_NEGATIVE_KIND, activeRelicIds, drawRelicCards,
  invalidatedRelicIds, nextNegativeRounds, nextRelicRounds, overlimitBattleList, overlimitCarriedFunds, overlimitKeepsFunds,
  relicPool, relicRng, relicTable, relicWeightMap, relicWeightTotal,
} from '../../server/match/relicsOverlimit.js';
import { wantsRelicDraft } from '../../server/match/match/relicDraft.js';
import { FGO_SP_ITEM } from '../../server/sim/content/overlimitRelics.js';
import { isShopItem } from '../../server/sim/simdata.js';
import { createRng } from '../../server/sim/rng.js';
import { makeMatch } from './harness.js';

const DATA = JSON.parse(readFileSync(new URL('../../data/relicsOverlimit.json', import.meta.url), 'utf8'));
const GROUP_OF = (g) => DATA.entries.filter((e) => e.group === g);
const byId = new Map(DATA.entries.map((e) => [e.id, e]));

// 把 3 张卡的 id 取出来（服务端 sp.cards 与 m.public.sp.cards 是同一份）
const idsOf = (cards) => (Array.isArray(cards) ? cards.map((c) => c && c.id) : []);

/**
 * 已实装的 impl key：表里的效果 → 实装落点。A 类（业主第二批）29 条，B 类（第三批）6 条，FGO-SP（第四批）1 条。
 * 26 / 10 是派单时的口径；表里逐条点名的其实是 29 条（5 LC + 7 SP + 4 EX + 13 FGO），B 类 7 条里做掉 6 条。
 * FGO-SP 原先留桩的理由是「要发一件本版数据里没有的装备」—— 这件装备（[万色悠滞之核]）第四批已经造出来了
 * （docs/research/25-overlimit-items.json → data/items.json 的 chess_item_ol_01_e_a），所以它不再 pending。
 */
const IMPL = {
  'LC-001': 'burn_pool', 'LC-002': 'bleed', 'LC-003': 'tremor', 'LC-004': 'doom', 'LC-005': 'breath', 'LC-006': 'charge',
  'LC-007': 'rupture',
  'LC-SP1': 'stat_fund', 'LC-SP2': 'gamble', 'LC-SP3': 'sad_gold', 'LC-SP4': 'fire_vuln', 'LC-SP5': 'hp_round',
  'LC-SP6': 'redeploy', 'LC-SP7': 'dhyana',
  'LC-EX1': 'carry_funds', 'LC-EX2': 'weakness', 'LC-EX3': 'price_one', 'LC-EX4': 'none',
  'FGO-01': 'fgo01', 'FGO-02': 'fgo02', 'FGO-03': 'fgo03', 'FGO-04': 'fgo04', 'FGO-05': 'fgo05', 'FGO-06': 'fgo06',
  'FGO-07': 'fgo07', 'FGO-08': 'fgo08', 'FGO-09': 'fgo09', 'FGO-11': 'fgo11', 'FGO-12': 'fgo12', 'FGO-13': 'fgo13',
  'FGO-14': 'fgo14', 'FGO-15': 'fgo15', 'FGO-16': 'fgo16', 'FGO-17': 'fgo17',
  FGO_X: 'fgoX',
  FGO_SP: 'fgoSP',
};
/** 仍是 pending 的条目：本表已经一条都不剩（FGO-SP 第四批做实）。 */
const PENDING = [];

// ---- 1. 数据 --------------------------------------------------------------

test('数据：36 条（LC 7 / SP 7 / EX 4 / 普通 FGO 16 / FGO-Ⅹ / FGO-SP），36 条全部已实装、PENDING 为空', () => {
  assert.equal(DATA.entries.length, 36, '业主表里填好的条目数（AN-001…014 是空占位，不收）');
  assert.deepEqual(
    Object.fromEntries(Object.keys(DATA.counts).sort().map((k) => [k, DATA.counts[k]])),
    { ex: 4, fgo: 16, fgoSP: 1, fgoX: 1, lc: 7, sp: 7 },
  );
  assert.equal(GROUP_OF('lc').length, 7, 'R3/R8 的池子 = 7 条 LC');
  // 编号：表里 FGO-10 那一行就是 FGO-Ⅹ（罗马数字 10），所以普通 FGO 只有 01–09 + 11–17 这 16 条
  assert.equal(byId.has('FGO_X'), true, 'FGO-Ⅹ 的 id 是 FGO_X');
  assert.equal(byId.has('FGO_SP'), true, 'FGO-SP 的 id 是 FGO_SP');
  assert.equal([...byId.keys()].filter((id) => /^FGO-\d+$/.test(id)).length, 16);
  const uniq = new Set(DATA.entries.map((e) => e.id));
  assert.equal(uniq.size, DATA.entries.length, 'id 唯一');
  for (const e of DATA.entries) {
    // 图标（业主 2026-10-31 解图）：null，或者固定形状 /assets/relics/overlimit/<自己的 id>.png。
    // 文件是否真的落盘由 tools/build-data.mjs 的生成期校验负责（public/assets 不入库，这里不读磁盘）。
    if (e.icon != null) assert.equal(e.icon, `/assets/relics/overlimit/${e.id}.png`, `${e.id}: icon 指向自己的图`);
    assert.ok(e.name && e.desc, `${e.id}: 名称与效果文本必须非空`);
    assert.ok(['lc', 'sp', 'ex', 'fgo', 'fgoX', 'fgoSP'].includes(e.group), `${e.id}: group`);
    assert.ok(!String(e.id).startsWith('AN-'), 'AN-* 是空占位，不该进表');
  }
  // impl：逐条钉住「哪一条实装了、落在哪个 key 上」
  const implemented = Object.fromEntries(DATA.entries.filter((e) => e.impl !== 'pending').map((e) => [e.id, e.impl]));
  assert.deepEqual(implemented, IMPL, '36 条的 impl key（A 类 29 + B 类 6 + FGO-SP）');
  assert.deepEqual(
    DATA.entries.filter((e) => e.impl === 'pending').map((e) => e.id).sort(),
    PENDING.slice().sort(),
    'PENDING 为空数组：全表实装，未实装角标一条都不该挂',
  );
  assert.equal(Object.keys(IMPL).length, 36, '实装条数（7 LC + 7 SP + 4 EX + 16 FGO + FGO-Ⅹ + FGO-SP）');
  assert.equal(Object.keys(IMPL).length + PENDING.length, 36, '实装 + 留桩 = 全表');
});

// ---- 2. 权重 --------------------------------------------------------------

test('权重：显式值按组写入、普通 FGO 是 rest（不是写死数字）', () => {
  assert.deepEqual(DATA.weights, { lc: 1, sp: 1.8, ex: 0.02, fgoX: 1.5, fgoSP: 0.01, fgo: 'rest' });
  for (const e of GROUP_OF('sp')) assert.equal(e.weight, 1.8, `${e.id}: SP 每条 1.8%`);
  for (const e of GROUP_OF('ex')) assert.equal(e.weight, 0.02, `${e.id}: EX 每条 0.02%`);
  for (const e of GROUP_OF('lc')) assert.equal(e.weight, 1, `${e.id}: 未选 LC 每条 1%`);
  assert.equal(byId.get('FGO_X').weight, 1.5, 'FGO-Ⅹ 1.5%');
  assert.equal(byId.get('FGO_SP').weight, 0.01, 'FGO-SP 0.01%');
  for (const e of GROUP_OF('fgo')) assert.equal(e.weight, 'rest', `${e.id}: 普通 FGO 均分剩余`);
});

test('权重和 = 100：无限段全池（7 / 5 条未选 LC 两种口径）', () => {
  // 业主口径（5 条未选 LC，即打完 R8 之后）：特殊 19.19%，普通 FGO 每条 80.81/16
  const lcPicked = GROUP_OF('lc').slice(0, 2).map((e) => e.id);
  const after8 = relicPool(DATA, 'infinite', lcPicked);
  assert.equal(after8.length, 34, '36 条 − 选走的 2 条 LC（业主按 17 条普通 FGO 算的是 35，本表实到 16 条）');
  assert.equal(after8.filter((e) => e.group === 'lc').length, 5, '未被选走的 LC 都在池里');
  assert.ok(Math.abs(relicWeightTotal(after8) - 100) < 1e-9, '权重和必须正好 100（rest 兜底）');
  const w8 = relicWeightMap(after8);
  const explicit8 = 5 * 1 + GROUP_OF('sp').length * 1.8 + GROUP_OF('ex').length * 0.02 + 1.5 + 0.01;
  assert.ok(Math.abs(explicit8 - 19.19) < 1e-9, `特殊合计 19.19%（实际 ${explicit8}）`);
  const rest8 = 100 - explicit8;
  assert.ok(Math.abs(rest8 - 80.81) < 1e-9, `rest ${rest8}`);
  for (const e of GROUP_OF('fgo')) assert.ok(Math.abs(w8.get(e.id) - rest8 / 16) < 1e-9, `${e.id}: rest/16（随池子重算）`);

  // 全池（一条都还没选走，7 条 LC）：显式 21.19%，rest 自然变小 —— 「均分」而不是写死百分比
  const full = relicPool(DATA, 'infinite', []);
  assert.equal(full.length, 36);
  assert.ok(Math.abs(relicWeightTotal(full) - 100) < 1e-9);
  const fullW = relicWeightMap(full);
  const explicitFull = 7 * 1 + GROUP_OF('sp').length * 1.8 + GROUP_OF('ex').length * 0.02 + 1.5 + 0.01;
  assert.ok(Math.abs(explicitFull - 21.19) < 1e-9, `全池显式合计 ${explicitFull}`);
  for (const e of GROUP_OF('fgo')) {
    assert.ok(Math.abs(fullW.get(e.id) - (100 - explicitFull) / GROUP_OF('fgo').length) < 1e-9, `${e.id}: rest/16`);
  }

  // 普通 FGO 被选走一条 → 分母变小，每条份额变大（这就是「均分」而不是写死 4.753%）
  const afterFgo = relicPool(DATA, 'infinite', [...lcPicked, GROUP_OF('fgo')[0].id]);
  const wf = relicWeightMap(afterFgo);
  assert.ok(wf.get(GROUP_OF('fgo')[1].id) > w8.get(GROUP_OF('fgo')[1].id), '少一条 FGO，其余每条份额变大');
});

test('LC 池（R3 / R8）：只有没选过的 LC，每条权重相同（等概率三选一）', () => {
  const lc = relicPool(DATA, 'lc', []);
  assert.equal(lc.length, 7);
  assert.ok(lc.every((e) => e.group === 'lc'));
  const w = relicWeightMap(lc);
  assert.equal(new Set([...w.values()]).size, 1, 'LC 之间等权');
  const left = relicPool(DATA, 'lc', [GROUP_OF('lc')[2].id]);
  assert.equal(left.length, 6, '抽走一条少一条');
  assert.equal(left.some((e) => e.id === GROUP_OF('lc')[2].id), false, '已选过的不再出现');
});

// ---- 3. 抽取 --------------------------------------------------------------

test('抽卡：3 张互不相同（无放回），同种子同结果，跨池不消耗别的随机流', () => {
  const pool = relicPool(DATA, 'infinite', []);
  const a = idsOf(drawRelicCards(createRng(12345), pool, 3));
  const b = idsOf(drawRelicCards(createRng(12345), pool, 3));
  assert.deepEqual(a, b, '同种子同结果');
  assert.equal(new Set(a).size, 3, '三张卡互不相同');
  assert.ok(a.every((id) => byId.has(id)));
  // 池子只有 2 条时最多 2 张（不循环、不重复）
  assert.equal(drawRelicCards(createRng(7), pool.slice(0, 2), 3).length, 2);
  // relicRng 与 rngDraft / rngMeta 不是同一条流：salt 不同则序列不同
  const m = { seed: 99 };
  const s1 = [relicRng(m, 'lc:3:0')(), relicRng(m, 'lc:3:0')()];
  const s2 = [relicRng(m, 'infinite:21:2')(), relicRng(m, 'infinite:21:2')()];
  assert.notDeepEqual(s1, s2, 'salt 里带池子与回合');
  assert.deepEqual([relicRng(m, 'lc:3:0')(), relicRng(m, 'lc:3:0')()], s1, 'salt 固定的序列是确定的');
});

// ---- 4. 触发时机（纯函数） -------------------------------------------------

test('触发：R3 / R8 各一次；无限段是 Boss 轮（R20/25…）之后的下一回合；漏掉 Boss 就不给', () => {
  const stub = (over = {}) => ({
    isInfinite: true, relicsOverlimit: { picked: [], negPicked: [], roundsDone: new Set() }, ...over,
  });
  assert.deepEqual([...RELIC_LC_ROUNDS], [3, 8]);
  for (const r of [3, 8]) assert.equal(wantsRelicDraft(stub(), r), true, `R${r} 开 LC 三选一`);
  // R5 / R11 是**负面**词条那两回合（业主 2026-10-31 第二批）：也开三选一，只是池子不同 ——
  // 「抽哪个池」由 relicDraftKind 判（见 test/match/overlimit-negatives.test.js），这里只断言「要开」。
  for (const r of [5, 11]) assert.equal(wantsRelicDraft(stub(), r), true, `R${r} 开负面词条三选一`);
  for (const r of [1, 2, 4, 6, 7, 9, 16, 19, 22]) assert.equal(wantsRelicDraft(stub(), r), false, `R${r} 不开`);
  for (const r of [21, 26, 31]) assert.equal(wantsRelicDraft(stub(), r), true, `R${r} = R${r - 1} Boss 轮之后`);
  for (const r of [20, 25, 30]) assert.equal(wantsRelicDraft(stub(), r), false, 'Boss 轮自己不开');
  // 同一条回合不重复开：roundsDone 挡住
  assert.equal(wantsRelicDraft(stub({ relicsOverlimit: { picked: [], negPicked: [], roundsDone: new Set([3]) } }), 3), false);
  // 领袖没被消灭（settle 记的是上一回合之外的值）就不给词条 —— 与 wantsTraitDraft 同一口径
  assert.equal(wantsRelicDraft(stub({ _infBossClearedRound: 19 }), 21), false);
  assert.equal(wantsRelicDraft(stub({ _infBossClearedRound: 20 }), 21), true);
  // 非超限局一律 false
  assert.equal(wantsRelicDraft(stub({ isInfinite: false }), 3), false);
  assert.equal(wantsRelicDraft(null, 3), false);
});

test('nextAt / nextNegAt：饰品回合与负面回合分开列（无限段按 Boss 轮交替）', () => {
  // 饰品：正常段 LC + 无限段的**饰品**轮（R26 / R36 / R46 …，上一 Boss 轮是 R25/R35/R45）
  assert.deepEqual(nextRelicRounds(1, [], 2), [3, 8, 26, 36]);
  assert.deepEqual(nextRelicRounds(9, [3, 8], 2), [26, 36]);
  assert.deepEqual(nextRelicRounds(3, [3], 1), [8, 26]);
  // 负面：正常段 R5 / R11 + 无限段的**负面**轮（R21 / R31 / R41 …，上一 Boss 轮是 R20/R30/R40）
  assert.deepEqual(nextNegativeRounds(1, [], 2), [5, 11, 21, 31]);
  assert.deepEqual(nextNegativeRounds(3, [3], 2), [5, 11, 21, 31]);
  assert.deepEqual(nextNegativeRounds(12, [3, 5, 8, 11], 2), [21, 31]);
  // 已经开过的回合两边都不再列
  assert.deepEqual(nextNegativeRounds(1, [5], 1), [11, 21]);
});

// ---- 5. 真实对局：R3 → R8 → 无限段 -----------------------------------------

const driveTo = (h, pred, label) => {
  // 无限段的三选一之后还接着既有的词条抉择（TRAIT_DRAFT）：途中替玩家选掉，免得卡在那里
  const traitTurn = () => h.m.phase === 'TRAIT_DRAFT' && typeof h.m.traitTurn === 'function' && h.m.traitTurn() === 'p_0';
  for (let guard = 0; guard < 200; guard++) {
    if (pred()) return h;
    if (h.ended) break;
    h.drive(() => pred() || traitTurn());
    if (pred()) return h;
    if (traitTurn()) { h.m.handle('p_0', { t: 'g.traitChoice', idx: 0 }); continue; }
    break;
  }
  assert.ok(pred(), `${label}（phase ${h.m.phase} R${h.m.round}${h.ended ? ', ended' : ''}）`);
  return h;
};
const relicDraftOn = (h) => h.m.phase === 'SP_DRAFT' && h.m.sp && h.m.sp.family === RELIC_CARD_FAMILY;

test('对局：R3 / R8 各一次 LC 三选一 —— 三张都来自「没选过」的 LC，选完就出局', () => {
  const h = makeMatch({
    mode: 'solo_infinite', difficulty: 'HARD', seed: 21, fake: true,
    script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }), // 假战：每 tick 给 Boss 血池掉血 = 「Boss 打赢」
  }).start();
  h.autoHumans();
  const pid = 'p_0';

  // —— R3 ——
  driveTo(h, () => relicDraftOn(h) && h.m.round === 3, 'R3 应该开词条三选一');
  assert.equal(h.m.sp.relicKind, 'lc', 'R3 的池子是 LC');
  assert.equal(h.m.sp.cards.length, 3, '三选一');
  const r3 = idsOf(h.m.sp.cards);
  assert.equal(new Set(r3).size, 3, '三张不同');
  for (const id of r3) assert.equal(byId.get(id).group, 'lc', `R3 只出 LC（${id}）`);
  // 卡片字段：效果/风味/编号/未实装标记都下发（客户端画 .zjcard 用）
  const card0 = h.m.sp.cards[0];
  assert.equal(card0.kind, 'overlimit');
  assert.equal(card0.impl, byId.get(card0.id).impl, '卡面 impl 就是表里的实装 key（未实装的仍是 pending）');
  assert.equal(typeof card0.name, 'string');
  assert.equal(typeof card0.desc, 'string');
  assert.equal(card0.id, byId.get(card0.id).id);
  // 不加刷新：这个阶段没有重抽预算，g.cardRefresh 直接拒绝（不是惊变 draft）
  assert.equal(h.m.sp.rerollsLeft, undefined, '没有 reroll 预算');
  assert.equal(h.m.refreshSpCard(h.ps(pid), 0).error, 'BAD_TARGET', '词条三选一不支持重抽');
  // 私有视图：picked / pool / nextAt（业主指定的形状）
  const priv = h.ps(pid).privateView();
  assert.deepEqual(priv.relicsOverlimit.picked, [], '还没选');
  assert.equal(priv.relicsOverlimit.pool.length, 36, '无限段池子 = 全表（一条都还没选走）');
  assert.deepEqual(priv.relicsOverlimit.nextAt, [8, 26, 36, 46], '下一个饰品词条回合（剩下的 LC 回合 + 无限段接下来三个饰品轮）');
  assert.deepEqual(priv.relicsOverlimit.nextNegAt, [5, 11, 21, 31, 41], '下一个负面词条回合（R5 / R11 + 无限段接下来三个负面轮）');
  // m.public.sp 带上池子种类与回合（客户端 / 测试的判据）
  const pubFrame = [...h.bc].reverse().find((msg) => msg.t === 'm.public' && msg.sp && msg.sp.family === RELIC_CARD_FAMILY);
  assert.equal(pubFrame.sp.relicKind, 'lc');
  assert.equal(pubFrame.sp.round, 3);

  // 选第一张 → 记进 picked（效果的另一半在 battleInput / content/overlimitRelics.js）
  assert.deepEqual(h.m.handle(pid, { t: 'g.choice', idx: 0 }), { ok: true });
  assert.deepEqual(h.ps(pid).privateView().relicsOverlimit.picked, [r3[0]]);
  assert.deepEqual(h.m.relicPickedLog.map((x) => [x.id, x.impl]), [[r3[0], byId.get(r3[0]).impl]], '选取日志记的是实装 key');
  // 战斗输入：本局生效的词条（战斗侧 content/overlimitRelics.js 只认这个键；at = 选走它的回合）
  assert.deepEqual(h.ps(pid).battleInput().relicsOverlimit, [{ id: r3[0], at: 3 }], 'R3 选到的词条进战斗输入');
  // 同一条不叠加两份：picked 里已经有它，重复记同一 id 会被拒（这里直接调记录函数验证幂等）
  assert.equal(h.m.takeOverlimitRelic(h.ps(pid), { id: r3[0], impl: byId.get(r3[0]).impl }), false, '同一条不叠加两份');
  assert.deepEqual(h.ps(pid).privateView().relicsOverlimit.picked, [r3[0]]);
  // R3 还有机变（mode_single_hard 的 spRounds 有 3）：词条选完接机变，然后才进整备
  const chained = h.run(() => h.ended != null || (h.m.phase === 'SP_DRAFT' && h.m.sp && h.m.sp.family !== RELIC_CARD_FAMILY));
  assert.ok(chained && h.m.sp && h.m.sp.family !== RELIC_CARD_FAMILY, 'R3 的机变照旧开（词条先、机变后，两条链不互相顶掉）');
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 3, 'R3 最终应进整备');
  assert.equal(h.ps(pid).privateView().relicsOverlimit.picked.length, 1);

  // —— R8 ——
  driveTo(h, () => relicDraftOn(h) && h.m.round === 8, 'R8 应该再开一次词条三选一');
  assert.equal(h.m.sp.relicKind, 'lc');
  const r8 = idsOf(h.m.sp.cards);
  assert.equal(r8.length, 3);
  for (const id of r8) assert.equal(byId.get(id).group, 'lc');
  assert.equal(r8.includes(r3[0]), false, 'R3 选走的那条不再出现');
  assert.equal(h.ps(pid).privateView().relicsOverlimit.pool.length, 35, '池子跟着少一条');
  assert.deepEqual(h.ps(pid).privateView().relicsOverlimit.nextAt, [26, 36, 46], 'R8 之后只剩无限段的饰品轮');
  h.m.handle(pid, { t: 'g.choice', idx: 1 });
  assert.equal(h.ps(pid).privateView().relicsOverlimit.picked.length, 2);
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 8, 'R8 没有机变，选完直接进整备');

  // —— 无限段：R20 Boss 轮之后的 R21 是**负面**轮（业主 2026-10-31 第三单的相位），先走掉 ——
  driveTo(h, () => relicDraftOn(h) && h.m.sp.round === 21, 'R20 Boss 轮之后应开负面词条三选一');
  assert.equal(h.m.sp.relicKind, RELIC_NEGATIVE_KIND, 'R21（上一 Boss 轮 R20）= 负面池');
  assert.equal(h.m.round, 20, 'Boss 轮结束、下一回合还没进（与既有的词条抉择同一时点）');
  h.m.handle(pid, { t: 'g.choice', idx: 0 });

  // —— R25 Boss 轮之后的 R26：无限段饰品池（本测试要验的是饰品池的口径） ——
  driveTo(h, () => relicDraftOn(h) && h.m.sp.relicKind === 'infinite', 'R25 Boss 轮之后应开无限段词条三选一');
  assert.equal(h.m.round, 25, 'Boss 轮结束、下一回合还没进（与既有的词条抉择同一时点）');
  assert.equal(h.m.sp.cards.length, 3);
  const inf = idsOf(h.m.sp.cards);
  const pickedBefore = h.ps(pid).privateView().relicsOverlimit.picked.slice();
  for (const id of inf) {
    assert.equal(byId.has(id), true, `${id} 在表里`);
    assert.equal(pickedBefore.includes(id), false, `${id} 已经选过了，不该再出现`);
  }
  // R8 之后池子 = 36 − 2 条 LC = 34（含 5 条未被选走的 LC）
  const pool = relicPool(DATA, 'infinite', pickedBefore);
  assert.equal(pool.length, 34);
  assert.equal(pool.filter((e) => e.group === 'lc').length, 5, '未被选走的 LC 还在池里');
  assert.ok(inf.every((id) => pool.some((e) => e.id === id)), '三张都从这个池子里来');

  h.m.handle(pid, { t: 'g.choice', idx: 0 });
  assert.equal(h.ps(pid).privateView().relicsOverlimit.picked.length, 3);
  // 选完接既有的「词条抉择」（TRAIT_DRAFT）—— 两套三选一串联，不互相顶掉
  h.run(() => h.m.phase === 'TRAIT_DRAFT' || h.ended != null);
  assert.equal(h.m.phase, 'TRAIT_DRAFT', '无限段的词条之后是既有的词条抉择');
  h.m.handle(pid, { t: 'g.traitChoice', idx: 0 });
  assert.ok(['ROUND_START', 'PREP'].includes(h.m.phase), '词条抉择之后进下一回合');
  h.m.dispose();
});

test('普通模式：没有词条 —— gd 不认这张表，也不会开词条三选一', () => {
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, difficulty: 'HARD', seed: 21, fake: true,
      script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
    assert.equal(h.m.isInfinite, false);
    assert.equal(h.m.gd.relicsOverlimit, null, `${mode}: 普通模式的 GameData 看不见词条表`);
    assert.equal(relicTable(h.m.gd), null);
    h.autoHumans();
    driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 3, `${mode}: R3 应进整备`);
    assert.equal(h.bc.some((msg) => msg.t === 'm.public' && msg.sp && msg.sp.family === RELIC_CARD_FAMILY), false,
      `${mode}: 一帧都不许出现词条三选一`);
    assert.equal('relicsOverlimit' in h.ps('p_0').privateView(), false, `${mode}: 私有视图没有这个键`);
    // 战斗输入也不许多出词条键（sim 的 content/overlimitRelics.js 只认这个键）
    assert.equal('relicsOverlimit' in h.ps('p_0').battleInput(), false, `${mode}: battleInput 没有词条键`);
    assert.equal(h.m.relicsOverlimit, undefined, `${mode}: 连状态都没建`);
    h.m.dispose();
  }
});

// ---- 6. 实装（业主 2026-10-31 第二批）：失效条款 / 战斗输入 / 整备侧 ------------------

const infMatch = (seed = 21) => makeMatch({
  mode: 'solo_infinite', difficulty: 'HARD', seed, fake: true,
  script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }),
}).start();

/** 直接摆好本局的词条状态（跳过三选一，专测某一条的整备侧）。 */
const setPicked = (h, ids) => {
  h.m.relicsOverlimit = { picked: ids.slice(), roundsDone: new Set([3, 8]) };
  h.m.relicPickedLog = ids.map((id) => ({ id, group: null, round: 3, impl: 'test' }));
};

test('失效条款：FGO-11 被 FGO-Ⅹ 顶掉、FGO-13 被 FGO-09 顶掉（记录还留着，只是不生效）', () => {
  assert.deepEqual({ ...RELIC_INVALIDATED_BY }, { 'FGO-11': 'FGO_X', 'FGO-13': 'FGO-09' });
  assert.deepEqual(activeRelicIds(['FGO-11']), ['FGO-11'], '没有 Ⅹ 时 FGO-11 正常生效');
  assert.deepEqual(activeRelicIds(['FGO-11', 'FGO_X']), ['FGO_X'], 'FGO-11 失效');
  assert.deepEqual(invalidatedRelicIds(['FGO-11', 'FGO_X']), ['FGO-11'], '但记录还在（只不生效）');
  assert.deepEqual(activeRelicIds(['FGO-13', 'FGO-09']), ['FGO-09'], 'FGO-13 被梅林顶掉');
  assert.deepEqual(invalidatedRelicIds(['FGO-13', 'FGO-09']), ['FGO-13']);
  assert.deepEqual(activeRelicIds(['LC-002', 'FGO-12']), ['LC-002', 'FGO-12'], '无关的组合原样');
  assert.deepEqual(activeRelicIds([]), []);
});

test('battleInput：超限局下发 [{ id, at }]，失效的剔掉；普通模式没有这个键', () => {
  const h = infMatch();
  h.autoHumans();
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 1, 'R1 整备');
  const ps = h.ps('p_0');
  setPicked(h, ['LC-002', 'FGO-11', 'FGO_X', 'LC-SP4']);
  h.m.relicPickedLog = [
    { id: 'LC-002', round: 3, impl: 'bleed' }, { id: 'FGO-11', round: 8, impl: 'fgo11' },
    { id: 'FGO_X', round: 21, impl: 'fgoX' }, { id: 'LC-SP4', round: 21, impl: 'fire_vuln' },
  ];
  assert.deepEqual(ps.battleInput().relicsOverlimit, [
    { id: 'LC-002', at: 3 }, { id: 'FGO_X', at: 21 }, { id: 'LC-SP4', at: 21 },
  ], 'FGO-11 被 Ⅹ 顶掉；at = 选走它的回合');
  // 一条都没选：不下发这个键（sim 侧因此一个监听器都不挂）
  setPicked(h, []);
  assert.equal('relicsOverlimit' in ps.battleInput(), false);
  // 工具函数同口径
  setPicked(h, ['LC-002']);
  assert.deepEqual(overlimitBattleList(h.m), [{ id: 'LC-002', at: 3 }]);
  h.m.dispose();
});

test('整备侧：FGO-09 每回合资金 +2、FGO-14 +1；FGO-17 每回合 2 次免费刷新；LC-EX3 干员价格改 1', () => {
  const h = infMatch(5);
  h.autoHumans();
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 1, 'R1 整备');
  const ps = h.ps('p_0');
  const incomeOf = () => {
    const ev = { round: h.m.round, income: h.m.gd.income(h.m.round), pending: 0 };
    h.m.dispatch(ps, 'onIncome', ev);
    return ev.income;
  };
  setPicked(h, []);
  const base = incomeOf();
  setPicked(h, ['FGO-09']);
  assert.equal(incomeOf() - base, 2, 'FGO-09 每回合 +2');
  setPicked(h, ['FGO-14']);
  assert.equal(incomeOf() - base, 1, 'FGO-14 每回合 +1');
  setPicked(h, ['FGO-09', 'FGO-14']);
  assert.equal(incomeOf() - base, 3, '两条相加');
  // FGO-17：每回合 2 次免费刷新
  ps.shop.freeRefreshes = 0;
  setPicked(h, ['FGO-17']);
  h.m.dispatch(ps, 'onRoundStart', { round: h.m.round });
  assert.equal(ps.shop.freeRefreshes, 2, 'FGO-17 每回合 2 次免费刷新');
  // LC-EX3：调度中心干员的购买价改为 1（全局 handler 排在盟约之前，远见照旧能再减到 0）
  const chessId = 'chess_char_1_02_a';
  assert.ok(h.m.gd.chess(chessId), '测试用的干员记录存在');
  const slot = { kind: 'chess', id: chessId, basePrice: 3 };
  setPicked(h, []);
  assert.equal(ps.priceOf(slot), 3, '没选 LC-EX3：原价');
  setPicked(h, ['LC-EX3']);
  assert.equal(ps.priceOf(slot), 1, 'LC-EX3：干员价格改为 1');
  h.m.dispose();
});

test('整备侧：LC-EX1 经费跨回合保留，保留量为上回合的 150%；没选它照旧清零', () => {
  assert.equal(overlimitCarriedFunds(10), 15);
  assert.equal(overlimitCarriedFunds(7), 10, '向下取整（7 × 1.5 = 10.5 → 10）');
  assert.equal(overlimitCarriedFunds(0), 0);
  const h = infMatch(9);
  h.autoHumans();
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 1, 'R1 整备');
  const ps = h.ps('p_0');
  setPicked(h, []);
  assert.equal(overlimitKeepsFunds(h.m), false);
  ps.funds = 10;
  ps.endPrep();
  assert.equal(ps.funds, 0, '没选 LC-EX1：剩余资金清零（改动前的行为）');
  setPicked(h, ['LC-EX1']);
  assert.equal(overlimitKeepsFunds(h.m), true);
  ps.funds = 10;
  ps.endPrep();
  assert.equal(ps.funds, 15, 'LC-EX1：保留 150%');
  h.m.dispose();
});

test('选取即到账：LC-SP1「并获得 10 资金」在选中的瞬间发给每名存活玩家', () => {
  const h = infMatch(11);
  h.autoHumans();
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 1, 'R1 整备');
  const ps = h.ps('p_0');
  setPicked(h, []);
  const before = ps.funds;
  assert.equal(h.m.takeOverlimitRelic(ps, { id: 'LC-SP1', group: 'sp', impl: 'stat_fund' }), true);
  assert.equal(ps.funds, before + 10, 'LC-SP1 选中的瞬间 +10 资金');
  // 其它条目不会白给钱
  const before2 = ps.funds;
  h.m.takeOverlimitRelic(ps, { id: 'LC-002', group: 'lc', impl: 'bleed' });
  assert.equal(ps.funds, before2, '其它条目不加钱');
  h.m.dispose();
});

test('FGO-SP：选中后发放一件[万色悠滞之核]（ctx.grantItem，一局只发一次；商店不卖）', () => {
  const h = infMatch(13);
  h.autoHumans();
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 1, 'R1 整备');
  const ps = h.ps('p_0');
  const held = () => ps.hand.filter((p) => p && p.id === FGO_SP_ITEM).length;
  const prepStart = () => h.m.dispatch(ps, 'onPrepStart', { round: h.m.round });

  // 没选这条词条：什么都不发（onPrepStart 里那条 global handler 先看 overlimitRelics()）
  setPicked(h, []);
  prepStart();
  assert.equal(held(), 0, '没选 FGO-SP：整备期不发装备');
  // 选中：进入整备期发一件，进手牌（发放走既有 ctx.grantItem，与湮灭盟约奖励装同一条通道）
  setPicked(h, ['FGO_SP']);
  prepStart();
  assert.equal(held(), 1, 'FGO-SP：整备期发放一件[万色悠滞之核]');
  // 一局只发一次（玩家计数器去重；不是每回合补给）
  prepStart();
  assert.equal(held(), 1, '同一条词条只发一次');
  // 装备记录：能解析到、商店 / 装备池都不卖（只能由词条发放），没有精锐形
  const rec = h.m.gd.item(FGO_SP_ITEM);
  assert.ok(rec, 'data/items.json 里有这件装备');
  assert.equal(rec.name, '万色悠滞之核');
  assert.equal(rec.shopExcluded, true);
  assert.equal(isShopItem(rec), false, '商店槽 / 道具补给 / 机密商店 / 装备池都抽不到它');
  for (const ids of Object.values(h.m.gd.shopItemsByTier)) assert.equal(ids.includes(FGO_SP_ITEM), false, '各档商店表里都没有它');
  assert.equal(rec.goldenId, null, '没有精锐形');
  h.m.dispose();
});
