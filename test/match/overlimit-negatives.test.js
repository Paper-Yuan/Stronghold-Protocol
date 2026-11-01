// test/match/overlimit-negatives.test.js — 超限模拟「负面词条」第二批：数据 / 池子 / 抽取 / 档位 / 权重 / 回合判据 / 真实对局
// （业主 2026-10-31 第二批 + 第三单：分档 / 权重 / 放回 / 无限段相位）。
//
// 业主口径（逐条钉在这里）：
//   A. 档位**按回合过滤**（不是抽到该条时随机取一档）：
//        · R5 / R11                      → 只出 Ⅰ 档的条目（无挡位条目不在池子里）；
//        · 无限段 R50 之前               → Ⅱ 档 + 无挡位条目；
//        · 无限段 R50 之后（含 R50）     → Ⅲ 档 + 无挡位条目。
//   B. 权重与放回：有挡位 1.0、抽中后**留在池里**（可反复抽）；无挡位 0.5（有挡位的一半）、抽中后**移出池子**。
//      同一次三选一的三张不重复、不加刷新。
//   B′. 空选修复：已拥有且档位**不低于本次**的条目不再进候选（R5 选走 D01(Ⅰ) 后 R11 不再出现 D01@Ⅰ）；
//      更高档仍可出现（R45 的 D01@Ⅱ 仍在候选里，用于升档覆盖）。
//   C. 无限段相位＝**按 Boss 轮交替**：R20 / R30 / R40 那三次抽负面（R21 / R31 / R41），
//      R25 / R35 / R45 那三次抽饰品（R26 / R36 / R46）。8 次无限三选一里负面恰 4 次。
//
// 另：两个池子**互不混**（负面池只从负面表里抽、饰品池只从 36 条表里抽，两条随机流的 salt 也不同）；
// 普通 / 湮灭 / 炸惊一帧不变（负面表只在超限局可见，私有视图 / 战斗输入都不多那个键）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NEGATIVE_EVEN_MODE, NEGATIVE_GROUP, NEGATIVE_LATE_FROM, NEGATIVE_PLAIN_WEIGHT, NEGATIVE_ROUNDS,
  NEGATIVE_TIER_WEIGHT, RELIC_CARD_FAMILY, RELIC_NEGATIVE_KIND,
  drawNegativeCards, isNegativeInfiniteRound, negativeBattleList, negativeCardView, negativeEntry, negativeHasTiers,
  negativePickedIds, negativePool, negativeRng, negativeTable, negativeTierIndexForRound, negativeTierOf, negativeWeightOf,
  nextNegativeRounds, nextRelicRounds, relicDraftKind, relicTable,
} from '../../server/match/relicsOverlimit.js';
import { wantsRelicDraft } from '../../server/match/match/relicDraft.js';
import { createRng } from '../../server/sim/rng.js';
import { makeMatch } from './harness.js';

const DATA = JSON.parse(readFileSync(new URL('../../data/relicsOverlimitNegative.json', import.meta.url), 'utf8'));
const RELICS = JSON.parse(readFileSync(new URL('../../data/relicsOverlimit.json', import.meta.url), 'utf8'));
const byId = new Map(DATA.entries.map((e) => [e.id, e]));
const RELIC_IDS = new Set(RELICS.entries.map((e) => e.id));
const idsOf = (cards) => (Array.isArray(cards) ? cards.map((c) => c && c.id) : []);
const TIERED = DATA.entries.filter((e) => e.tiers.length > 0).map((e) => e.id);
const PLAIN = DATA.entries.filter((e) => e.tiers.length === 0).map((e) => e.id);

/** 表里逐条的实装 key（业主表的 17 行，与 docs/research/24-overlimit-negative-relics.json 一一对应）。 */
const IMPL = {
  'LC-D01': 'fund_cut', 'LC-D02': 'enemy_base_stats', 'LC-D03': 'enemy_dmg', 'LC-D04': 'enemy_atk_hp',
  'LC-D05': 'enemy_hp', 'LC-D06': 'enemy_tough', 'LC-D07': 'enemy_atk_ramp', 'LC-D08': 'enemy_def_ramp',
  'LC-D09': 'enemy_bulk', 'LC-D10': 'undying_hits', 'LC-D11': 'enemy_glass_cannon', 'LC-D12': 'palm',
  'LC-D13': 'noise_panic', 'LC-D14': 'grave_needle', 'LC-D15': 'future_dodge', 'LC-D16A': 'pest_atk',
  'LC-D16B': 'pest_def',
};

// ---- 1. 数据 --------------------------------------------------------------

test('数据：业主表实到 17 行（D01–D15 + D16A/D16B），组 = neg，17 条全部已实装', () => {
  // 表里是 17 行数据（文件名写「16 项」：把「攻击害虫 / 防御害虫」合并成一项数才是 16）；见 research 的 note
  assert.equal(DATA.entries.length, 17);
  assert.equal(DATA.group, 'neg');
  assert.equal(DATA.count, 17);
  const uniq = new Set(DATA.entries.map((e) => e.id));
  assert.equal(uniq.size, 17, 'id 唯一');
  for (const e of DATA.entries) {
    assert.equal(e.group, 'neg', `${e.id}: 负面表只有一组`);
    // 表里没有权重列 ⇒ 生成期固定 weight: 1；真正的抽取权重由 negativeWeightOf 按「有无档位」给出（1.0 / 0.5）
    assert.equal(e.weight, 1, `${e.id}: 数据里的 weight 是占位（1），不是抽取权重`);
    assert.ok(e.name && e.desc, `${e.id}: 名称与效果文本非空`);
    assert.equal(e.icon, `/assets/relics/overlimit-negative/${e.id}.png`, `${e.id}: 图标指向自己（DISPIMG 已解出）`);
    assert.equal(Array.isArray(e.tiers), true);
    assert.equal(RELIC_IDS.has(e.id), false, '负面 id 不与饰品表的 id 撞');
  }
  const implemented = Object.fromEntries(DATA.entries.map((e) => [e.id, e.impl]));
  assert.deepEqual(implemented, IMPL, '17 条逐条的实装 key');
  assert.equal(DATA.entries.filter((e) => e.impl === 'pending').length, 0, '本批 17 条全部实装，没有留桩');
  // 档位：D01…D08 三档（Ⅰ/Ⅱ/Ⅲ），D09…D16B 没有档位
  assert.deepEqual(TIERED, ['LC-D01', 'LC-D02', 'LC-D03', 'LC-D04', 'LC-D05', 'LC-D06', 'LC-D07', 'LC-D08']);
  assert.equal(PLAIN.length, 9, 'D09…D16B 共 9 条无挡位条目');
  for (const e of DATA.entries.filter((x) => x.tiers.length)) {
    assert.deepEqual(e.tiers.map((t) => t.label), ['Ⅰ', 'Ⅱ', 'Ⅲ'], `${e.id}: 三档`);
    assert.equal(negativeHasTiers(e), true);
    assert.equal(negativeWeightOf(e), NEGATIVE_TIER_WEIGHT, `${e.id}: 有挡位 = 权重 1.0`);
  }
  for (const e of DATA.entries.filter((x) => !x.tiers.length)) {
    assert.equal(negativeHasTiers(e), false);
    assert.equal(negativeWeightOf(e), NEGATIVE_PLAIN_WEIGHT, `${e.id}: 无挡位 = 权重 0.5`);
  }
  assert.equal(NEGATIVE_TIER_WEIGHT, 1);
  assert.equal(NEGATIVE_PLAIN_WEIGHT, 0.5, '无挡位是有挡位的一半');
  // 表里的数值逐条对齐（Ⅰ < Ⅱ < Ⅲ 的方向）
  assert.deepEqual(DATA.entries.find((e) => e.id === 'LC-D01').tiers.map((t) => t.v.funds), [-2, -4, -6]);
  assert.deepEqual(DATA.entries.find((e) => e.id === 'LC-D05').tiers.map((t) => t.v.hp), [0.25, 0.4, 0.6]);
  assert.deepEqual(DATA.entries.find((e) => e.id === 'LC-D07').tiers.map((t) => t.v.to), [1.3, 1.7, 2.1]);
});

test('可见性：负面表只在超限局（gd.overlimit）可见，普通 / 湮灭 / 炸惊拿不到', () => {
  const inf = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', seed: 3, fake: true }).start();
  assert.notEqual(inf.m.gd.relicsOverlimitNegative, null);
  assert.equal(negativeTable(inf.m.gd).entries.length, 17);
  assert.equal(negativeEntry(inf.m.gd, 'LC-D15').impl, 'future_dodge');
  assert.equal(negativeEntry(inf.m.gd, 'LC-001'), null, '饰品 id 不在负面表里');
  inf.m.dispose();
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, difficulty: 'HARD', seed: 3, fake: true }).start();
    assert.equal(h.m.gd.relicsOverlimitNegative, null, `${mode}: GameData 看不见负面表`);
    assert.equal(negativeTable(h.m.gd), null);
    assert.deepEqual(negativePickedIds(h.m), []);
    h.m.dispose();
  }
});

// ---- 2. 回合判据（C 表：无限段按 Boss 轮交替） ------------------------------

test('判据：R5 / R11 抽负面；无限段按 Boss 轮交替 —— R21/R31/R41 负面，R26/R36/R46 饰品', () => {
  assert.deepEqual([...NEGATIVE_ROUNDS], [5, 11]);
  assert.equal(NEGATIVE_EVEN_MODE, 'boss', '采用「按 Boss 轮交替」的判据（业主 2026-10-31 第三单确认）');
  const kind = (r) => relicDraftKind({}, r);
  assert.equal(kind(3), 'lc', 'R3 仍是饰品 LC');
  assert.equal(kind(5), RELIC_NEGATIVE_KIND, 'R5 = 负面');
  assert.equal(kind(8), 'lc', 'R8 仍是饰品 LC');
  assert.equal(kind(11), RELIC_NEGATIVE_KIND, 'R11 = 负面');
  for (const r of [1, 2, 4, 6, 7, 9, 10, 12, 19, 20, 22]) assert.equal(kind(r), null, `R${r} 没有三选一`);
  // 无限段：每个 Boss 轮之后的下一回合一次，按 Boss 轮交替（R20/30/40 → 负面；R25/35/45 → 饰品）
  assert.equal(kind(21), RELIC_NEGATIVE_KIND, 'R21（上一 Boss 轮 R20）= 负面');
  assert.equal(kind(26), 'infinite', 'R26（上一 Boss 轮 R25）= 饰品');
  assert.equal(kind(31), RELIC_NEGATIVE_KIND, 'R31（R30）= 负面');
  assert.equal(kind(36), 'infinite', 'R36（R35）= 饰品');
  assert.equal(kind(41), RELIC_NEGATIVE_KIND, 'R41（R40）= 负面');
  assert.equal(kind(46), 'infinite', 'R46（R45）= 饰品');
  assert.equal(kind(51), RELIC_NEGATIVE_KIND, 'R51（R50）= 负面');
  assert.equal(kind(56), 'infinite', 'R56（R55）= 饰品');
  // 8 次无限三选一里负面恰 4 次，且**具体回合号**就是上表那四个
  const inf = [21, 26, 31, 36, 41, 46, 51, 56];
  assert.deepEqual(inf.filter((r) => kind(r) === RELIC_NEGATIVE_KIND), [21, 31, 41, 51]);
  assert.deepEqual(inf.filter((r) => kind(r) === 'infinite'), [26, 36, 46, 56]);
  assert.equal(inf.filter((r) => kind(r) === RELIC_NEGATIVE_KIND).length, 4, '半数是负面，另一半仍是饰品');
  // isNegativeInfiniteRound 与 kind 同口径
  for (const r of [21, 31, 41, 51]) assert.equal(isNegativeInfiniteRound(r), true, `R${r} 是负面轮`);
  for (const r of [26, 36, 46, 56]) assert.equal(isNegativeInfiniteRound(r), false, `R${r} 是饰品轮`);
  assert.equal(isNegativeInfiniteRound(25), false, 'Boss 轮自己不开三选一');
  assert.equal(isNegativeInfiniteRound(20), false);
  assert.equal(isNegativeInfiniteRound(23), false, '不是 Boss 轮之后的回合');
  // wantsRelicDraft：R5 / R11 也要开（抽哪个池由 relicDraftKind 决定）
  const stub = (over = {}) => ({ isInfinite: true, relicsOverlimit: { picked: [], negPicked: [], roundsDone: new Set() }, ...over });
  for (const r of [5, 11]) assert.equal(wantsRelicDraft(stub(), r), true, `R${r} 要开三选一`);
  assert.equal(wantsRelicDraft(stub(), 6), false);
  assert.equal(wantsRelicDraft(stub({ isInfinite: false }), 5), false, '非超限局永远不开');
  // 提示：饰品回合与负面回合分开列，且各自跟着相位走
  assert.deepEqual(nextRelicRounds(1, [], 1), [3, 8, 26]);
  assert.deepEqual(nextNegativeRounds(1, [], 1), [5, 11, 21]);
  assert.deepEqual(nextNegativeRounds(12, [3, 5, 8, 11], 2), [21, 31]);
});

// ---- 3. 池子 / 档位 / 权重 / 放回 -----------------------------------------

test('池子：有挡位恒留池里、无挡位抽中即出池；阶段按 A 表过滤', () => {
  const negTable = negativeTable({ relicsOverlimitNegative: DATA });
  // 全量口径（round 省略，私有视图用）
  assert.equal(negativePool(negTable, []).length, 17);
  assert.ok(negativePool(negTable, []).every((e) => e.group === NEGATIVE_GROUP));
  assert.ok(negativePool(negTable, []).every((e) => !RELIC_IDS.has(e.id)), '负面池里没有一个饰品 id');
  // R5 / R11：只有 Ⅰ 档的 8 条，无挡位条目根本不在池子里
  const r5 = negativePool(negTable, new Set(), 5).map((e) => e.id);
  assert.deepEqual(r5, TIERED, 'R5 的候选 = 恰好那 8 条有挡位条目');
  assert.deepEqual(negativePool(negTable, new Set(), 11).map((e) => e.id), TIERED, 'R11 同口径');
  // R50 前：Ⅱ 档 + 无挡位；R50 起：Ⅲ 档 + 无挡位（候选集合相同，档位不同）
  const early = negativePool(negTable, new Set(), 45).map((e) => e.id);
  assert.equal(early.length, 17, 'Ⅱ 档 8 条 + 无挡位 9 条');
  assert.deepEqual(early.filter((id) => byId.get(id).tiers.length === 0), PLAIN);
  assert.deepEqual(negativePool(negTable, new Set(), 55).map((e) => e.id), early, 'Ⅲ 阶段同样是 8 + 9');
  assert.equal(NEGATIVE_LATE_FROM, 50, 'R50 是「之后（含）」的那一回合');
  // 放回：无挡位抽中即出池；有挡位抽中后仍在池里（同一阶段、跨阶段都还在）
  const noTier = PLAIN[0];
  assert.equal(negativePool(negTable, [noTier], 45).some((e) => e.id === noTier), false, '无挡位抽中后不再出现');
  assert.equal(negativePool(negTable, [noTier]).some((e) => e.id === noTier), false, '全量口径同样剔除');
  assert.equal(negativePool(negTable, [noTier], 45).length, 16);
  for (const id of ['LC-D01', 'LC-D03']) {
    assert.equal(negativePool(negTable, [id], 45).some((e) => e.id === id), true, `${id}: 有挡位留在池里`);
    assert.equal(negativePool(negTable, [id], 55).some((e) => e.id === id), true, `${id}: 跨阶段也还在`);
    assert.equal(negativePool(negTable, [id], 5).some((e) => e.id === id), true);
    assert.equal(negativePool(negTable, [id]).length, 17, '有挡位被选走不减少全量池');
  }
  // 饰品池那边同样看不到负面 id
  const relicTableData = relicTable({ relicsOverlimit: RELICS });
  assert.ok(relicTableData.entries.every((e) => !byId.has(e.id)));
  // 随机流也不同：同一个种子，两条 salt 出来的序列不一样
  const m = { seed: 42 };
  assert.notDeepEqual([negativeRng(m, 'negative:5:0')()], [createRng(1)()]);
  assert.deepEqual([negativeRng(m, 'a')(), negativeRng(m, 'a')()], [negativeRng(m, 'a')(), negativeRng(m, 'a')()], '同 salt 确定');
});

test('空选修复 B′：R5 选走 D01(Ⅰ) 后 R11 不再出现 D01@Ⅰ；R45 的 D01@Ⅱ 仍可出现（升档）', () => {
  const negTable = negativeTable({ relicsOverlimitNegative: DATA });
  // `picked` 用 `negPicked` 的原样形状（id + 档位）—— 生产入口 relicDraft 就是这么传的
  const r5Picked = [{ id: 'LC-D01', tier: 0 }];
  // R5 刚选完：同档也不再出现（同一条不可能连着抽两次）
  assert.equal(negativePool(negTable, r5Picked, 5).some((e) => e.id === 'LC-D01'), false);
  // R11（同是 Ⅰ 档）：候选里不再有 D01@Ⅰ → 点了不会空选
  assert.equal(negativePool(negTable, r5Picked, 11).some((e) => e.id === 'LC-D01'), false, 'R11 的候选里没有 D01@Ⅰ');
  assert.equal(negativePool(negTable, r5Picked, 11).length, TIERED.length - 1, 'R11 候选 = 8 − 1');
  assert.deepEqual(negativePool(negTable, r5Picked, 11).map((e) => e.id), TIERED.filter((id) => id !== 'LC-D01'), '其余 7 条原样');
  // 高档仍可出现：R45 = Ⅱ、R55 = Ⅲ 都是升档覆盖，D01 还在候选里
  assert.equal(negativePool(negTable, r5Picked, 45).some((e) => e.id === 'LC-D01'), true, 'R45 的 D01@Ⅱ 仍可出现');
  assert.equal(negativePool(negTable, r5Picked, 45).length, 17);
  assert.equal(negativePool(negTable, r5Picked, 55).some((e) => e.id === 'LC-D01'), true, 'R55 的 D01@Ⅲ 也在');
  // Ⅱ 档已拥有：R45 同档剔除，R55（Ⅲ）仍可升档
  const t2 = [{ id: 'LC-D01', tier: 1 }];
  assert.equal(negativePool(negTable, t2, 45).some((e) => e.id === 'LC-D01'), false);
  assert.equal(negativePool(negTable, t2, 55).some((e) => e.id === 'LC-D01'), true);
  // 只影响被选走的那条：其余有挡位条目照常（池子不因一个人缩水）
  assert.equal(negativePool(negTable, r5Picked, 11).filter((e) => negativeHasTiers(e)).length, TIERED.length - 1);
  // 纯 id（没档位）无从判断：沿用旧口径留在池里（全量预览 / 旧调用方），行为不回归
  assert.equal(negativePool(negTable, ['LC-D01'], 11).some((e) => e.id === 'LC-D01'), true);
  assert.equal(negativePool(negTable, ['LC-D01']).length, 17);
  // 三张仍然互不相同，也不会抽到被剔除的那条
  const cards = drawNegativeCards(createRng(20261031), negativePool(negTable, r5Picked, 11), 3);
  assert.equal(cards.length, 3);
  assert.equal(new Set(idsOf(cards)).size, 3);
  assert.equal(idsOf(cards).includes('LC-D01'), false);
});

test('抽取：同一次三选一的三张互不相同、同种子同结果；池子不足时不循环', () => {
  const pool = negativePool(negativeTable({ relicsOverlimitNegative: DATA }), [], 45);
  const a = idsOf(drawNegativeCards(createRng(12345), pool, 3));
  const b = idsOf(drawNegativeCards(createRng(12345), pool, 3));
  assert.deepEqual(a, b, '同种子同结果');
  assert.equal(new Set(a).size, 3, '三张卡互不相同（一次抽三张不同条目）');
  assert.ok(a.every((id) => byId.has(id)));
  assert.equal(drawNegativeCards(createRng(7), pool.slice(0, 2), 3).length, 2, '池子只有 2 条时最多 2 张');
  // 抽 17 张 = 全池一条不落（这一手内不重复）
  const all = idsOf(drawNegativeCards(createRng(99), pool, 17));
  assert.equal(new Set(all).size, 17);
});

test('档位 A 表：按回合过滤，不再随机取档 —— R5/R11 = Ⅰ、R50 前 = Ⅱ、R50 起 = Ⅲ', () => {
  const d01 = byId.get('LC-D01');
  // 回合 → 档位序号
  assert.deepEqual([5, 11].map(negativeTierIndexForRound), [0, 0], 'R5 / R11 只出 Ⅰ 档');
  assert.deepEqual([21, 41, 45, 46, 49].map(negativeTierIndexForRound), [1, 1, 1, 1, 1], '无限段 R50 前 = Ⅱ 档');
  assert.deepEqual([50, 51, 55, 56].map(negativeTierIndexForRound), [2, 2, 2, 2], 'R50 起（含 R50）= Ⅲ 档');
  // D01 在四个时点上的数值：−2 / −2 / −4 / −6
  assert.deepEqual(negativeTierOf(d01, 5), { index: 0, label: 'Ⅰ', v: { funds: -2 } });
  assert.deepEqual(negativeTierOf(d01, 11), { index: 0, label: 'Ⅰ', v: { funds: -2 } });
  assert.deepEqual(negativeTierOf(d01, 45), { index: 1, label: 'Ⅱ', v: { funds: -4 } });
  assert.deepEqual(negativeTierOf(d01, 55), { index: 2, label: 'Ⅲ', v: { funds: -6 } });
  // 不再随机：同一回合反复问，答案一模一样（不消耗任何随机数）
  for (const r of [5, 45, 55]) {
    const first = negativeTierOf(d01, r);
    for (let i = 0; i < 5; i++) assert.deepEqual(negativeTierOf(d01, r), first, `R${r} 的档位是确定的`);
  }
  // 8 条有挡位条目逐条对齐表里的三档
  for (const id of TIERED) {
    for (const [round, index] of [[5, 0], [45, 1], [55, 2]]) {
      assert.deepEqual(negativeTierOf(byId.get(id), round), {
        index, label: ['Ⅰ', 'Ⅱ', 'Ⅲ'][index], v: byId.get(id).tiers[index].v,
      }, `${id} @ R${round}`);
    }
  }
  // 无挡位条目：tier = null（不论回合）
  for (const id of PLAIN) {
    for (const r of [5, 45, 55]) assert.equal(negativeTierOf(byId.get(id), r), null, `${id} 没有档位`);
  }
  // 卡面：negative / group / 档位三个字段都下发（客户端据此换警示色 / 眉题）
  const card = negativeCardView(d01, 2, negativeTierOf(d01, 45));
  assert.equal(card.kind, 'overlimit');
  assert.equal(card.negative, true);
  assert.equal(card.group, 'neg');
  assert.equal(card.idx, 2);
  assert.equal(card.tier, null, 'generic 的 tier 字段不抢（留给别的 family 的数字档位）');
  assert.equal(card.tierLabel, 'Ⅱ');
  assert.equal(card.tierIndex, 1);
  assert.deepEqual(card.tierValues, { funds: -4 });
  assert.equal(card.icon, '/assets/relics/overlimit-negative/LC-D01.png');
  assert.equal(negativeCardView(byId.get('LC-D09'), 0, null).tierLabel, null);
});

test('权重 B 表：有挡位 1.0 / 无挡位 0.5 —— 大样本下被抽中的次数比 ≈ 2:1', () => {
  // 拿一对等价候选（一条有挡位、一条无挡位）把权重本身钉死：2 : 1 的期望与条数无关
  const tiered = { id: 'T', tiers: [{ label: 'Ⅰ', v: { a: 1 } }] };
  const plain = { id: 'P', tiers: [] };
  const rng = createRng(20261031);
  const N = 6000;
  let t = 0;
  let p = 0;
  for (let i = 0; i < N; i++) {
    const [c] = drawNegativeCards(rng, [tiered, plain], 1);
    if (c && c.id === 'T') t++;
    else if (c && c.id === 'P') p++;
  }
  assert.equal(t + p, N, '每次都抽到一张');
  const ratio = t / p;
  assert.ok(ratio > 1.8 && ratio < 2.2, `有挡位 : 无挡位 ≈ 2 : 1（实测 ${ratio.toFixed(3)}，样本 ${N}）`);
  // 真实池子（8 条 1.0 + 9 条 0.5）上的期望比 = 8 : 4.5，同样落在「明显偏向有挡位」这一侧
  const pool = negativePool(negativeTable({ relicsOverlimitNegative: DATA }), [], 45);
  const w = pool.reduce((n, e) => n + negativeWeightOf(e), 0);
  assert.equal(w, TIERED.length * NEGATIVE_TIER_WEIGHT + PLAIN.length * NEGATIVE_PLAIN_WEIGHT, '池子权重合计 = 8×1.0 + 9×0.5');
});

test('放回 B 表：构造多次抽取 —— 无挡位抽中后不再出现，有挡位可以反复抽中', () => {
  const negTable = negativeTable({ relicsOverlimitNegative: DATA });
  const picked = new Set();
  const seenAfterPick = new Map();   // 已经被选走之后，又在候选里出现过的次数
  const appearances = new Map();     // 总共被抽中几次
  for (let i = 0; i < 60; i++) {
    const pool = negativePool(negTable, picked, 45);
    const cards = drawNegativeCards(createRng(5000 + i), pool, 3);
    for (const c of cards) {
      appearances.set(c.id, (appearances.get(c.id) || 0) + 1);
      if (picked.has(c.id)) seenAfterPick.set(c.id, (seenAfterPick.get(c.id) || 0) + 1);
    }
    const chosen = cards[0];
    assert.ok(chosen, `第 ${i} 次三选一抽到卡`);
    // 只有无挡位条目会被「选走即出池」；有挡位的选走也留在池里
    if (!negativeHasTiers(chosen)) picked.add(chosen.id);
  }
  const pickedPlain = [...picked].filter((id) => !negativeHasTiers(byId.get(id)));
  assert.ok(pickedPlain.length >= 5, `60 次抽取里选走了若干无挡位条目（${pickedPlain.length}）`);
  for (const id of pickedPlain) {
    assert.equal(seenAfterPick.get(id) || 0, 0, `${id}: 无挡位抽中后不再出现在后续候选里`);
  }
  // 有挡位：反复抽中（8 条池子里出现多次）
  const tieredHits = TIERED.map((id) => appearances.get(id) || 0);
  assert.ok(Math.max(...tieredHits) >= 3, `有挡位条目可以再次抽中（最多 ${Math.max(...tieredHits)} 次）`);
  assert.ok(tieredHits.every((n) => n > 0), '8 条有挡位条目都被抽到过（池子不缩）');
  // 有挡位被选走之后仍然在候选里（上一条已用累计量钉住，这里直接看池子）
  const tieredPicked = new Set(['LC-D01', 'LC-D02']);
  assert.ok(negativePool(negTable, tieredPicked, 45).some((e) => e.id === 'LC-D01'));
});

// ---- 4. 真实对局 ----------------------------------------------------------

/** 打到 `pred` 成立；途中遇到既有的词条抉择（TRAIT_DRAFT）就替玩家选第一张（单人局）。 */
const driveTo = (h, pred, label) => {
  const traitTurn = () => h.m.phase === 'TRAIT_DRAFT' && h.m.traitTurn() === 'p_0';
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

const infMatch = (seed = 21) => makeMatch({
  mode: 'solo_infinite', difficulty: 'HARD', seed, fake: true,
  script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }),
}).start();

test('对局：R5 / R11 只出 Ⅰ 档（D01 = −2，不是 −4 / −6），3 选 1、不加刷新', () => {
  const h = infMatch();
  h.autoHumans();
  const pid = 'p_0';

  // —— R5：第一次负面三选一 ——
  driveTo(h, () => relicDraftOn(h) && h.m.round === 5, 'R5 应该开负面词条三选一');
  assert.equal(h.m.sp.relicKind, RELIC_NEGATIVE_KIND, 'R5 的池子是负面池');
  assert.equal(h.m.sp.negative, true, 'sp.negative 让客户端换警示色 / 眉题');
  assert.equal(h.m.sp.cards.length, 3, '三选一');
  const r5 = idsOf(h.m.sp.cards);
  assert.equal(new Set(r5).size, 3, '三张不同（这一手内不重复）');
  for (const id of r5) assert.ok(byId.has(id), `${id} 来自负面表（不是饰品表：${RELIC_IDS.has(id) ? '撞了' : 'ok'}）`);
  // A 表：R5 只出 Ⅰ 档 —— 每一张都是 Ⅰ 档数值，且都不是无挡位条目
  for (const c of h.m.sp.cards) {
    assert.equal(c.negative, true);
    assert.equal(c.group, 'neg');
    assert.equal(c.impl, byId.get(c.id).impl);
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.desc, 'string');
    assert.equal(c.tierIndex, 0, `${c.id}: R5 只有 Ⅰ 档`);
    assert.equal(c.tierLabel, 'Ⅰ');
    assert.deepEqual(c.tierValues, byId.get(c.id).tiers[0].v, `${c.id}: Ⅰ 档就是表里第一个数`);
    if (c.id === 'LC-D01') assert.equal(c.tierValues.funds, -2, 'D01 在 R5 是 −2（不是 −4 / −6）');
  }
  // 不加刷新：与饰品词条同一个阶段，没有 reroll 预算
  assert.equal(h.m.sp.rerollsLeft, undefined);
  assert.equal(h.m.refreshSpCard(h.ps(pid), 0).error, 'BAD_TARGET', '负面三选一不支持重抽');
  // 私有视图：两段分开（饰品 picked / 负面 negPicked）；有挡位留在池里，所以池子还是 17
  const priv = h.ps(pid).privateView().relicsOverlimit;
  const relicBefore = priv.picked.slice();
  assert.equal(relicBefore.length, 1, 'R3 已经选走一条饰品（h.drive 自动选）');
  assert.deepEqual(priv.negPicked, [], '负面那一段还是空的');
  assert.equal(priv.negPool.length, 17, '负面池 = 全表');
  // m.public.sp 带上 negative：客户端据此画警示色
  const pubFrame = [...h.bc].reverse().find((msg) => msg.t === 'm.public' && msg.sp && msg.sp.family === RELIC_CARD_FAMILY);
  assert.equal(pubFrame.sp.relicKind, RELIC_NEGATIVE_KIND);
  assert.equal(pubFrame.sp.negative, true);
  assert.equal(pubFrame.sp.round, 5);

  // 选第一张 → 记进 negPicked（id + 档位 0），战斗输入另开一个键
  assert.deepEqual(h.m.handle(pid, { t: 'g.choice', idx: 0 }), { ok: true });
  const negPriv = h.ps(pid).privateView().relicsOverlimit;
  assert.deepEqual(negPriv.negPicked, [{ id: r5[0], tier: 0 }]);
  assert.equal(negPriv.negPool.length, 17, '有挡位抽中后留在池里（B 表），池子不缩');
  assert.deepEqual(negPriv.picked, relicBefore, '负面不进饰品那一段（「每拥有一件饰品」只数饰品）');
  const log = h.m.relicPickedLog.filter((x) => x.neg === true);
  assert.deepEqual(log.map((x) => [x.id, x.impl, x.round, x.tier]), [[r5[0], byId.get(r5[0]).impl, 5, 0]]);
  const input = h.ps(pid).battleInput();
  assert.deepEqual(input.relicsOverlimitNegative.map((x) => [x.id, x.tier]), [[r5[0], 0]], '负面词条进战斗输入（另一个键）');
  assert.equal(input.relicsOverlimitNegative[0].at, 5);
  assert.deepEqual(input.relicsOverlimit.map((x) => x.id), relicBefore, '饰品那个键只有饰品（两池不混）');
  // 同一条同一档再来一次：不叠加两份（[ASSUMED]：重复抽到同档按「已拥有」处理）
  assert.equal(h.m.takeNegativeRelic(h.ps(pid), { id: r5[0], negative: true, tierIndex: 0 }), false);
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 5, 'R5 选完直接进整备');

  // —— R11：第二次负面三选一，仍然是 Ⅰ 档；R5 选走的那条同档条目已从候选里剔除（不空选） ——
  driveTo(h, () => relicDraftOn(h) && h.m.round === 11, 'R11 应该开第二次负面三选一');
  assert.equal(h.m.sp.relicKind, RELIC_NEGATIVE_KIND);
  const r11 = idsOf(h.m.sp.cards);
  assert.equal(r11.length, 3);
  for (const c of h.m.sp.cards) assert.equal(c.tierIndex, 0, `${c.id}: R11 也是 Ⅰ 档`);
  for (const id of r11) assert.ok(byId.has(id));
  assert.equal(r11.includes(r5[0]), false, `R11 的候选里不再出现 R5 已选走的 ${r5[0]}@Ⅰ（否则点了等于空选）`);
  h.m.handle(pid, { t: 'g.choice', idx: 0 });
  assert.equal(h.ps(pid).privateView().relicsOverlimit.negPicked.length, 2);
  driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 11, 'R11 选完进整备');
  h.m.dispose();
});

test('对局：无限段相位 —— R21 抽负面（Ⅱ 档）、R26 抽饰品（两池不混、按 Boss 轮交替）', () => {
  const h = infMatch(21);
  h.autoHumans();
  const pid = 'p_0';

  // 正常段两回合的负面先选掉（R5 / R11），再看无限段
  driveTo(h, () => relicDraftOn(h) && h.m.round === 5, 'R5');
  const r5Id = h.m.sp.cards[0].id;
  h.m.handle(pid, { t: 'g.choice', idx: 0 });
  driveTo(h, () => relicDraftOn(h) && h.m.round === 11, 'R11');
  // R11 也是 Ⅰ 档：R5 选走的那条同档已被剔除（B′），三张都是新的
  h.m.handle(pid, { t: 'g.choice', idx: h.m.sp.cards.findIndex((c) => c.id !== r5Id) });
  const negPicked = h.ps(pid).privateView().relicsOverlimit.negPicked.map((x) => x.id);
  assert.equal(negPicked.length, 2);

  // —— R21（R20 Boss 轮之后）：负面池 ——
  // 注意：无限段的三选一在 Boss 轮结算时开（`m.round` 还是 20），要看的是 `sp.round`（= 21）。
  driveTo(h, () => relicDraftOn(h) && h.m.sp.round === 21, 'R20 Boss 轮之后应开负面三选一');
  assert.equal(h.m.sp.relicKind, RELIC_NEGATIVE_KIND, 'R21（上一 Boss 轮 R20）= 负面池');
  assert.equal(h.m.sp.negative, true);
  const r21 = idsOf(h.m.sp.cards);
  assert.equal(r21.length, 3);
  for (const c of h.m.sp.cards) {
    assert.ok(byId.has(c.id), `${c.id} 来自负面表`);
    assert.equal(RELIC_IDS.has(c.id), false);
    // A 表：无限段 R50 前 = Ⅱ 档；无挡位条目 tier 为 null
    if (byId.get(c.id).tiers.length) {
      assert.equal(c.tierIndex, 1, `${c.id}: R21 是 Ⅱ 档`);
      assert.equal(c.tierLabel, 'Ⅱ');
      assert.deepEqual(c.tierValues, byId.get(c.id).tiers[1].v);
      if (c.id === 'LC-D01') assert.equal(c.tierValues.funds, -4, 'D01 在 R21（R50 前）是 Ⅱ 档 −4');
    } else {
      assert.equal(c.tierIndex, null, `${c.id}: 无挡位条目没有档位`);
    }
  }
  // 选一张：无挡位条目选走后出池（池子 −1），有挡位选走后留在池里（池子不变）
  const plainIdx = h.m.sp.cards.findIndex((c) => byId.get(c.id).tiers.length === 0);
  const beforePool = h.ps(pid).privateView().relicsOverlimit.negPool.length;
  const pickIdx = plainIdx >= 0 ? plainIdx : 0;
  h.m.handle(pid, { t: 'g.choice', idx: pickIdx });
  const after = h.ps(pid).privateView().relicsOverlimit;
  const pickedR21 = r21[pickIdx];
  if (plainIdx >= 0) {
    assert.equal(after.negPool.length, beforePool - 1, `${pickedR21}: 无挡位抽中即出池`);
    assert.equal(after.negPool.includes(pickedR21), false);
  } else {
    assert.equal(after.negPool.length, beforePool, `${pickedR21}: 有挡位留在池里`);
    assert.equal(after.negPool.includes(pickedR21), true);
  }
  // R21 之后接既有的词条抉择（TRAIT_DRAFT），driveTo 会替玩家选掉

  // —— R26（R25 Boss 轮之后）：饰品池 ——
  driveTo(h, () => relicDraftOn(h) && h.m.sp.round === 26, 'R25 Boss 轮之后应开饰品三选一');
  assert.equal(h.m.sp.relicKind, 'infinite', 'R26（上一 Boss 轮 R25）= 饰品池');
  assert.equal(h.m.sp.negative, false, '内部标记是 false');
  // 下发到端上的 m.public.sp **没有** negative 这个键（饰品池的帧与改动前逐字节一致）
  const relicFrame = [...h.bc].reverse().find((msg) => msg.t === 'm.public' && msg.sp && msg.sp.family === RELIC_CARD_FAMILY);
  assert.equal('negative' in relicFrame.sp, false, '饰品池的 m.public.sp 不多 negative 键');
  const r26 = idsOf(h.m.sp.cards);
  for (const id of r26) {
    assert.ok(RELIC_IDS.has(id), `${id} 来自 36 条饰品表`);
    assert.equal(byId.has(id), false, '饰品池不会出负面 id（两池不混）');
  }
  h.m.handle(pid, { t: 'g.choice', idx: 0 });
  const priv = h.ps(pid).privateView().relicsOverlimit;
  assert.equal(priv.negPicked.length, 3, 'R5 / R11 / R21 三条负面');
  assert.equal(priv.picked.length, 3, 'R3 / R8 / R26 三条饰品（R3、R8 由 h.drive 自动选）');
  // 战斗输入：两份分开、互不混
  const input = h.ps(pid).battleInput();
  assert.equal(input.relicsOverlimit.length, 3);
  assert.equal(input.relicsOverlimitNegative.length, 3);
  assert.equal(input.relicsOverlimit.some((x) => byId.has(x.id)), false, '饰品键里没有负面 id');
  assert.equal(input.relicsOverlimitNegative.some((x) => RELIC_IDS.has(x.id)), false, '负面键里没有饰品 id');
  assert.deepEqual(negativeBattleList(h.m).map((x) => x.id), priv.negPicked.map((x) => x.id));
  h.m.dispose();
});

test('对局：R50 前 / 后的无限段负面 —— R41 = Ⅱ 档、R51 = Ⅲ 档（D01 = −4 / −6）', () => {
  // 直接开这三选一（不必真的打到第 40 多回合）：档位只由回合决定，与怎么开无关。
  // 负面轮是 R21 / R31 / R41 / R51 …；R46 是饰品轮（不在本表里），所以「R50 前」由 R41 代表。
  for (const [round, index, label] of [[21, 1, 'Ⅱ'], [41, 1, 'Ⅱ'], [51, 2, 'Ⅲ'], [61, 2, 'Ⅲ']]) {
    const h = infMatch(7);
    h.autoHumans();
    assert.equal(h.m.enterRelicDraft(round), true, `R${round} 应该能开负面三选一`);
    assert.equal(h.m.sp.relicKind, RELIC_NEGATIVE_KIND, `R${round}（上一 Boss 轮 R${round - 1}）= 负面池`);
    assert.equal(h.m.sp.round, round);
    for (const c of h.m.sp.cards) {
      if (!byId.get(c.id).tiers.length) {
        assert.equal(c.tierIndex, null, `${c.id}: 无挡位条目没有档位`);
        continue;
      }
      assert.equal(c.tierIndex, index, `R${round} 的 ${c.id} 是 ${label} 档`);
      assert.deepEqual(c.tierValues, byId.get(c.id).tiers[index].v);
      if (c.id === 'LC-D01') assert.equal(c.tierValues.funds, index === 1 ? -4 : -6, `D01 @ R${round} = ${index === 1 ? -4 : -6}`);
    }
    h.m.dispose();
  }
  // 业主点名的两个回合号（R45 = R50 前、R55 = R50 后）在判据上就是 Ⅱ / Ⅲ
  const d01 = byId.get('LC-D01');
  assert.equal(negativeTierOf(d01, 45).v.funds, -4, 'R45（R50 前）抽到 D01 = Ⅱ 档 −4');
  assert.equal(negativeTierOf(d01, 55).v.funds, -6, 'R55（R50 后）抽到 D01 = Ⅲ 档 −6');
});

test('对局：同一条有挡位负面再次抽中时升到更高的档位（不叠加两份）', () => {
  const h = infMatch(9);
  h.autoHumans();
  const ps = h.ps('p_0');
  // Ⅱ 期抽到 D01（−4）
  assert.equal(h.m.takeNegativeRelic(ps, { id: 'LC-D01', negative: true, tierIndex: 1, impl: 'fund_cut' }), true);
  assert.deepEqual(h.m.relicsOverlimit.negPicked, [{ id: 'LC-D01', tier: 1 }]);
  // 同一档再来：按「已拥有」处理，不改数值
  assert.equal(h.m.takeNegativeRelic(ps, { id: 'LC-D01', negative: true, tierIndex: 1, impl: 'fund_cut' }), false);
  assert.deepEqual(h.m.relicsOverlimit.negPicked, [{ id: 'LC-D01', tier: 1 }]);
  // Ⅲ 期再抽到：升到 Ⅲ（−6），记录仍只有一条
  assert.equal(h.m.takeNegativeRelic(ps, { id: 'LC-D01', negative: true, tierIndex: 2, impl: 'fund_cut' }), true);
  assert.deepEqual(h.m.relicsOverlimit.negPicked, [{ id: 'LC-D01', tier: 2 }]);
  // 无挡位条目没有档位可比，重复选走一律拒绝
  assert.equal(h.m.takeNegativeRelic(ps, { id: 'LC-D09', negative: true, tierIndex: null, impl: 'enemy_bulk' }), true);
  assert.equal(h.m.takeNegativeRelic(ps, { id: 'LC-D09', negative: true, tierIndex: null, impl: 'enemy_bulk' }), false);
  assert.deepEqual(negativeBattleList(h.m).map((x) => [x.id, x.tier]), [['LC-D01', 2], ['LC-D09', null]]);
  h.m.dispose();
});

test('普通模式：一张负面表都看不见 —— 不开负面三选一、私有视图与战斗输入都不多键', () => {
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, difficulty: 'HARD', seed: 21, fake: true,
      script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
    assert.equal(h.m.isInfinite, false);
    h.autoHumans();
    driveTo(h, () => h.m.phase === 'PREP' && h.m.round === 5, `${mode}: R5 应进整备`);
    assert.equal(h.bc.some((msg) => msg.t === 'm.public' && msg.sp && msg.sp.family === RELIC_CARD_FAMILY), false,
      `${mode}: 一帧都不许出现词条三选一`);
    assert.equal('relicsOverlimit' in h.ps('p_0').privateView(), false, `${mode}: 私有视图没有词条键`);
    assert.equal('relicsOverlimitNegative' in h.ps('p_0').battleInput(), false, `${mode}: 战斗输入没有负面键`);
    h.m.dispose();
  }
});
