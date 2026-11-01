// server/match/relicsOverlimit.js — 超限模拟「词条」（饰品）的池、权重与抽取（业主 2026-10-31）。
//
// 词条表是**生成数据**（data/relicsOverlimit.json，源自 docs/research/23-overlimit-relics.json 的业主手写表），
// 这里只做纯逻辑：取表、算出「当前池子」、算每条在本池里的权重、按权重抽 n 张不重复的卡。**不含任何写死的数值**：
//   · lc / sp / ex / fgoX / fgoSP 的权重来自表里每条的 `weight`（生成期从 `weights` 块写入）；
//   · 普通 fgo 是 `'rest'` = 100 减去本池里其它条目的显式权重之和，再在**本池里剩下的** fgo 条目中等分。
//     「已选走」的 fgo 会离开池子，每条份额随之变大 —— 所以这里从不缓存数字，每次按池子重算（业主原话：
//     不许写死 4.753%）。
//
// 池子两种口径（业主定稿）：
//   'lc'       正常段 R3 / R8：只剩**还没选过**的 LC（7 → 6 → 5）；
//   'infinite' 无限段每轮：SP 7 + EX 4 + FGO-SP + FGO-Ⅹ + 普通 FGO + **未被选走的 LC**，去掉所有已选过的。
//
// 随机一律走 createRng(deriveSeed(seed, salt))（确定性；本仓禁 Math.random）。salt 按「哪一种池 + 第几回合」分，
// 所以同种子同结果，且不会消耗 rngDraft / rngMeta / rngWaves —— 别的系统抽到什么完全不受词条影响。

import { createRng, deriveSeed } from '../sim/rng.js';

/** 正常段开 LC 三选一的回合（业主定稿：R3 与 R8 各一次）。 */
export const RELIC_LC_ROUNDS = Object.freeze([3, 8]);
/** 三选一每次几张。 */
export const RELIC_CARD_COUNT = 3;
/** LC 分组 id（表里的 group）。 */
export const RELIC_LC_GROUP = 'lc';
/** 词条三选一在 m.public.sp 里的 family —— 客户端据此走 .zjov/.zjcard 的词条浮层。 */
export const RELIC_CARD_FAMILY = 'overlimit';
/** 无限段第一轮词条（R20 Boss 轮之后的 R21 起，每 5 回合一次）。 */
export const RELIC_INFINITE_FROM = 21;

/**
 * 词条表（data/relicsOverlimit.json 的校验后视图）。超限局才有；其它模式 / 表还没生成时是 null
 * （GameData.relicsOverlimit 已经按 `overlimit` 开关收口，这里是第二道）。
 * @param {{ relicsOverlimit?: any, overlimit?: boolean }} gd
 * @returns {{ weights: Record<string, any>, counts: Record<string, number>, entries: any[] }|null}
 */
export function relicTable(gd) {
  const t = gd && gd.relicsOverlimit;
  if (!t || typeof t !== 'object' || !Array.isArray(t.entries) || !t.entries.length) return null;
  return t;
}

/** 全表条目（拷贝一层，调用方随意排序）。 */
export function relicEntries(gd) {
  const t = relicTable(gd);
  return t ? t.entries.slice() : [];
}

/** 一条（未知 id → null）。 */
export function relicEntry(gd, id) {
  if (typeof id !== 'string' || !id) return null;
  for (const e of relicEntries(gd)) if (e && e.id === id) return e;
  return null;
}

/**
 * 当前池子（entries 的数组，顺序 = 表顺序，保证确定性）。
 * @param {any} table relicTable(gd)
 * @param {'lc'|'infinite'} kind
 * @param {Set<string>|string[]} picked 本局已选走的 id
 * @returns {any[]}
 */
export function relicPool(table, kind, picked = []) {
  const skip = picked instanceof Set ? picked : new Set(Array.isArray(picked) ? picked : []);
  const entries = table && Array.isArray(table.entries) ? table.entries : [];
  if (kind === RELIC_LC_GROUP) return entries.filter((e) => e && e.group === RELIC_LC_GROUP && !skip.has(e.id));
  // 无限段：所有组都在池里（含未被选走的 LC），已选走的一律不再出现（无放回、同一条不叠加两份）。
  return entries.filter((e) => e && !skip.has(e.id));
}

/**
 * 这个池子里每条词的**权重**（百分比，未归一）。显式权重来自条目自己的 `weight`；
 * `'rest'`（普通 FGO）在本池里均分 `100 − 显式合计`。
 * @param {any[]} pool
 * @returns {Map<string, number>} id → weight（池里每条一条，顺序同 pool）
 */
export function relicWeightMap(pool) {
  const list = Array.isArray(pool) ? pool.filter((e) => e && typeof e.id === 'string') : [];
  let explicit = 0;
  let restCount = 0;
  for (const e of list) {
    if (e.weight === 'rest') restCount++;
    else if (typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0) explicit += e.weight;
  }
  // 数学上 rest 不会为负（生成期已经校验显式合计 < 100%，且池子只是全表的子集）；夹到 0 只是保险。
  const rest = restCount > 0 ? Math.max(0, 100 - explicit) / restCount : 0;
  const out = new Map();
  for (const e of list) out.set(e.id, e.weight === 'rest' ? rest : Math.max(0, Number(e.weight) || 0));
  return out;
}

/** 池子的权重合计（应当恒为 100；测试拿它钉住「权重和 = 100」）。 */
export function relicWeightTotal(pool) {
  let sum = 0;
  for (const w of relicWeightMap(pool).values()) sum += w;
  return sum;
}

/**
 * 从池子里按权重抽 `n` 张**不重复**的卡（这一手内不重复：抽出即从候选里移除）—— 这是「三选一」的正确语义：
 * 三张卡不是三次独立抽取，而是一次抽取三张不同条目。
 * `weightOf` 省略时用 `relicWeightMap`（饰品表的权重）；负面池传自己的 `negativeWeightOf`（有挡位 1.0 / 无挡位 0.5）。
 * @param {() => number} rng createRng(...) 的实例
 * @param {any[]} pool
 * @param {number} [n]
 * @param {((e: any) => number)|null} [weightOf]
 * @returns {any[]}
 */
export function drawRelicCards(rng, pool, n = RELIC_CARD_COUNT, weightOf = null) {
  const left = Array.isArray(pool) ? pool.filter((e) => e && typeof e.id === 'string') : [];
  const want = Math.max(0, Math.min(Math.trunc(Number(n) || 0), left.length));
  const weights = weightOf ? null : relicWeightMap(left);
  const out = [];
  while (out.length < want) {
    const picked = rng.weighted(left, weightOf || ((e) => weights.get(e.id) || 0));
    if (!picked) break;
    out.push(picked);
    const at = left.indexOf(picked);
    if (at >= 0) left.splice(at, 1);
  }
  return out;
}

/**
 * 词条专用随机流：salt 里带池子种类与回合，所以同种子同结果，且与 rngDraft / rngMeta / rngWaves 互不消耗。
 * @param {{ seed?: number }} m
 * @param {string} salt
 */
export function relicRng(m, salt) {
  return createRng(deriveSeed((m && m.seed) || 1, `overlimit-relic:${salt}`));
}

/**
 * 还没开过的**饰品**词条回合（m.private.relicsOverlimit.nextAt）：正常段剩下的 LC 回合 + 无限段接下来的几个
 * **非负面** Boss 轮后回合（R26 / R36 / R46 …；负面轮见下一节的 `nextNegativeRounds` —— 两个池互不混，提示分开列）。
 * 相位 = `isNegativeInfiniteRound`（按 Boss 轮交替：R21/R31/R41 抽负面，R26/R36/R46 抽饰品）。
 * @param {number} round 当前回合
 * @param {Set<number>|number[]} done 已经开过词条的回合
 * @param {number} [count]
 * @returns {number[]} 升序
 */
export function nextRelicRounds(round, done = [], count = 3) {
  const r0 = Number.isInteger(round) && round > 0 ? round : 1;
  const seen = done instanceof Set ? done : new Set(Array.isArray(done) ? done : []);
  const out = [];
  for (const r of RELIC_LC_ROUNDS) if (r >= r0 && !seen.has(r)) out.push(r);
  // 无限段：最小可能回合是 RELIC_INFINITE_FROM（21），之后每 5 回合一次；负面轮属于负面池，跳过
  let r = Math.max(RELIC_INFINITE_FROM, r0);
  while ((r - RELIC_INFINITE_FROM) % 5 !== 0) r++;
  const want = Math.max(0, Math.trunc(Number(count) || 0));
  let n = 0;
  while (n < want && r < RELIC_INFINITE_FROM + 5 * 400) {
    if (!seen.has(r) && !isNegativeInfiniteRound(r)) { out.push(r); n++; }
    r += 5;
  }
  return out;
}

/**
 * 一张词条的三选一卡（服务端 sp.cards 的一项）。`kind: 'overlimit'` 与 family 一起是客户端的判据；
 * `impl: 'pending'` 表示效果还没实装（第一批 36 条全是桩），客户端据此画「未实装」角标。
 * @param {any} entry 表里的一条
 * @param {number} idx
 */
export function relicCardView(entry, idx) {
  return {
    idx,
    kind: 'overlimit',
    id: entry.id,
    name: entry.name,
    desc: entry.desc,
    flavor: typeof entry.flavor === 'string' ? entry.flavor : '',
    group: entry.group,
    impl: typeof entry.impl === 'string' ? entry.impl : 'pending',
    effectColor: entry.effectColor ?? null,
    // 图标：表里是 WPS 的 DISPIMG 嵌入图，已从 xlsx 包内解出并落盘到 public/assets/relics/overlimit/<id>.png
    // （业主 2026-10-31；public/assets/ 不入库，没解图时这里就是 null，客户端落回占位符）
    icon: entry.icon ?? null,
    tier: null,
  };
}

/** 词条的分组名（日志 / 测试用；不是 UI 文案）。 */
export const RELIC_GROUPS = Object.freeze(['lc', 'sp', 'ex', 'fgo', 'fgoX', 'fgoSP']);

// =====================================================================================================================
// 负面词条（业主 2026-10-31 第二批）：**与上面 36 条饰品并列的第二张表**，两个池子互不混
//
// 业主口径（2026-10-31 第三单，权威；三条规则各自对应本节的一段实现）：
//
//   A. 档位**按回合过滤**，不是「抽到该条时随机取一档」（D01…D08 把 Ⅰ/Ⅱ/Ⅲ 写在同一行）：
//        · R5 / R11                      → 只出 **Ⅰ 档**的条目（无挡位条目**不在**这两个池子里）；
//        · 无限段 **R50 之前**           → **Ⅱ 档** + 无挡位条目；
//        · 无限段 **R50 之后（含 R50）** → **Ⅲ 档** + 无挡位条目。
//      落点：`negativeTierIndexForRound(round)`（回合 → 0/1/2）与 `negativeTierOf(entry, round)`（该条在这一档的数值）。
//      所以 R5 抽到 D01 就是 Ⅰ 档 −2，R45 抽到 D01 是 Ⅱ 档 −4，R55 抽到的是 Ⅲ 档 −6。
//
//   B. 权重与放回（负面池专用，复用 `rng.weighted` 那套抽取器）：
//        · 有挡位（Ⅰ/Ⅱ/Ⅲ）：权重 **1.0**，抽中后**留在池里**，可以再次抽中；
//        · 无挡位：权重 **0.5**（有挡位的一半），抽中后**移出池子**，本局不再出现。
//      落点：`negativeWeightOf` / `negativePool(table, picked, round)` / `drawNegativeCards`。
//      同一次三选一的三张仍然互不相同（无放回那一层只作用于这一次抽卡），不加刷新。
//
//   B′. **空选修复**（业主 2026-10-31 第四单）：有挡位条目「留在池里」不等于「同一条同一档还能再抽到」——
//       R5 选走 D01(Ⅰ) 之后，R11 的池子还是 Ⅰ 档，若 D01 又出现，玩家点了 `takeNegativeRelic` 只会回 false
//       （「已拥有」），等于**空选**。所以候选池按**档位**剔除：`picked` 里记了档位的条目，只要「已拥有的档位 ≥
//       本次档位」就不再进候选；**更高档仍会出现**（Ⅰ 已拥有 → Ⅱ/Ⅲ 还能抽到，用于升档覆盖，业主的升档口径）。
//       落点：`negativePool` 的 tiered 分支。`picked` 里的纯 id（没档位）无从判断，保持原样留在池里 —— 兼容
//       「全量剩余池」预览与旧调用方。
//
//   C. 无限段相位＝**按 Boss 轮交替**：R20 / R30 / R40 那三次抽负面（R21 / R31 / R41），
//      R25 / R35 / R45 那三次抽饰品（R26 / R36 / R46）。落点：`NEGATIVE_EVEN_MODE = 'boss'`
//      与 `isNegativeInfiniteRound`；8 次无限三选一里负面恰 4 次。
//
// 两个池子互不混：负面池只从负面表里抽，饰品池只从 36 条表里抽；各自的「已选走」互不相干。
// 三选一仍复用既有通道（同一阶段、同一 `g.choice`、同一个 `relicRng` 分流方式），只 gate 在超限局。
//
// `[ASSUMED]`（业主没写死、这里按最自然的读法实现的几处；改判据只动本节）：
//   · 「留在池里、可反复抽」的**落账**：同一条有挡位词条再次抽中时不叠加两份，而是把它的档位**升到更高的那一档**
//     （Ⅱ 期抽过 D01 = −4，Ⅲ 期又抽到 = −6 覆盖前值，记录仍只有一条）；档位相同或更低时这一张按「已拥有」处理，
//     不改任何数值。见 `match/relicDraft.js takeNegativeRelic`。
//   · 池子是全队共享的（与饰品词条同一口径），所以「无挡位抽出即移出」= 移出全队后续的候选。
//   · R5 / R11 的候选里**不含**无挡位条目：业主三行表里只有无限段那两行写了「+ 无挡位条目」。
//   · D16A / D16B（蜚蠊那对无挡位条目）与其它无挡位条目同待遇：0.5 权重、抽中一次就出池；两条互相点名的
//     「同时拥有…翻倍」只在战斗侧生效，抽取侧没有配对规则。

/** 正常段抽负面词条的回合（业主原话「5、11 回合」）。 */
export const NEGATIVE_ROUNDS = Object.freeze([5, 11]);
/** 负面词条在数据里的 group（负面表只有这一组）。 */
export const NEGATIVE_GROUP = 'neg';
/** 词条三选一的池子种类：负面池（`sp.relicKind` 的第三个取值）。 */
export const RELIC_NEGATIVE_KIND = 'negative';
/**
 * 无限段相位判据：'boss' = 按 Boss 轮交替（R20/R30/R40 之后抽负面，R25/R35/R45 之后抽饰品）。
 * 业主 2026-10-31 第三单确认的口径；'round' 是已经作废的旧读法（抽卡那一回合取偶 → R26/R36 抽负面），留在这里只为
 * 一眼看出改的是哪个常量。
 */
export const NEGATIVE_EVEN_MODE = 'boss';
/** 无限段从这一回合起换成 Ⅲ 档（含本回合；业主：「R50 之后（含 R50）」）。 */
export const NEGATIVE_LATE_FROM = 50;
/** 有挡位负面词条的抽取权重（业主：1.0）。 */
export const NEGATIVE_TIER_WEIGHT = 1;
/** 无挡位负面词条的抽取权重（业主：有挡位的一半）。 */
export const NEGATIVE_PLAIN_WEIGHT = 0.5;

/** 负面词条表（data/relicsOverlimitNegative.json）。超限局才有；表缺失 / 非超限局是 null。 */
export function negativeTable(gd) {
  const t = gd && gd.relicsOverlimitNegative;
  if (!t || typeof t !== 'object' || !Array.isArray(t.entries) || !t.entries.length) return null;
  return t;
}

/** 负面词条的全体条目（拷贝一层）。 */
export function negativeEntries(gd) {
  const t = negativeTable(gd);
  return t ? t.entries.slice() : [];
}

/** 一条负面词条（未知 id → null）。 */
export function negativeEntry(gd, id) {
  if (typeof id !== 'string' || !id) return null;
  for (const e of negativeEntries(gd)) if (e && e.id === id) return e;
  return null;
}

/** 一条负面词条写了几个档位（D01…D08 = 3；D09…D16B = 0）。不是数组 / 空数组一律算 0 档。 */
function negativeTiersOf(entry) {
  return entry && Array.isArray(entry.tiers)
    ? entry.tiers.filter((x) => x && typeof x.label === 'string' && x.v && typeof x.v === 'object')
    : [];
}

/** 一条负面词条有没有档位（业主 A 表：「有挡位」= Ⅰ/Ⅱ/Ⅲ 写在同一条里）。 */
export function negativeHasTiers(entry) {
  return negativeTiersOf(entry).length > 0;
}

/**
 * 回合 → 档位序号（A 表，唯一的判据入口）：
 *   · R5 / R11（正常段）                  → 0（Ⅰ）；
 *   · 无限段 R21…R49                      → 1（Ⅱ）；
 *   · 无限段 R50 起（含 R50）             → 2（Ⅲ）。
 * 早于 R21 的其它回合与非法回合一律按 0 读（正常段只有 R5 / R11 会开负面三选一）。
 * @param {number} round
 * @returns {0|1|2}
 */
export function negativeTierIndexForRound(round) {
  const r = Number(round);
  if (!Number.isInteger(r) || r < 1) return 0;
  if (r >= NEGATIVE_LATE_FROM) return 2;      // 无限段 R50 起：Ⅲ
  if (r >= RELIC_INFINITE_FROM) return 1;     // 无限段 R50 前：Ⅱ
  return 0;                                   // 正常段 R5 / R11：Ⅰ
}

/**
 * 负面池（业主 A / B / B′ 三条规则的唯一口径；顺序 = 表顺序，保证确定性）：
 *   · 有挡位的条目：**只在「本阶段对应的那一档」为候选**，并且抽中后**留在池里**；但**已拥有且档位不低于本次**的
 *     条目会被剔除（B′：R5 选走 D01(Ⅰ) 后 R11 不再出现 D01@Ⅰ，否则玩家点了等于空选）；**更高档仍可出现**
 *     （Ⅰ 已拥有 → R45 的 D01@Ⅱ 仍在候选里，用于升档覆盖）；
 *   · 无挡位的条目：0.5 权重，**抽中即移出**（`picked` 里有它就再不出现）；R5 / R11 的池子里根本没有它们。
 * `round` 省略（null）时算「全量剩余池」：有挡位恒留、无挡位按 `picked` 剔除 —— `m.private.relicsOverlimit.negPool`
 * 就是这个口径（给玩家看「还剩什么」；预览不按回合分档，所以也不做 B′ 的档位剔除）。
 * `picked` 的每一项可以是 `{ id, tier }`（`m.relicsOverlimit.negPicked` 的原样形状），也可以是纯 id / Set；
 * **纯 id 不带档位**，B′ 无从判断，按旧口径留在池里。
 * @param {any} table negativeTable(gd)
 * @param {Set<string>|string[]|({ id: string, tier?: number|null }|string)[]} picked 本局已选走的负面词条
 * @param {number|null} [round] 开三选一的回合；省略 = 不按档位阶段过滤
 * @returns {any[]}
 */
export function negativePool(table, picked = [], round = null) {
  // 已选走：id 集合（无挡位条目出池用）+ 已知的最高档位（B′ 的同档剔除用；纯 id 不进这张表）。
  const skip = new Set();
  const ownedTier = new Map();
  const list = picked instanceof Set ? [...picked] : (Array.isArray(picked) ? picked : []);
  for (const it of list) {
    const id = typeof it === 'string' ? it : (it && typeof it.id === 'string' ? it.id : null);
    if (!id) continue;
    skip.add(id);
    if (it && typeof it === 'object' && Number.isInteger(it.tier)) {
      ownedTier.set(id, Math.max(ownedTier.has(id) ? ownedTier.get(id) : -1, it.tier));
    }
  }
  const entries = table && Array.isArray(table.entries) ? table.entries : [];
  const tier = round == null ? null : negativeTierIndexForRound(round);
  return entries.filter((e) => {
    if (!e || typeof e.id !== 'string') return false;
    if (negativeHasTiers(e)) {
      if (tier == null) return true;                                  // 全量预览：有挡位恒留
      if (tier >= negativeTiersOf(e).length) return false;            // 这一阶段没有它的这一档
      const owned = ownedTier.get(e.id);
      return owned == null || tier > owned;                           // B′：同档/降档剔除，更高档留作升档
    }
    if (tier === 0) return false;                                     // R5 / R11：只用 Ⅰ 档
    return !skip.has(e.id);                                           // 无挡位：抽中即出池
  });
}

/**
 * 一条负面词条在负面池里的抽取权重（业主 B 表）：有挡位 **1.0**、无挡位 **0.5**。
 * @param {any} entry
 * @returns {number}
 */
export function negativeWeightOf(entry) {
  return negativeHasTiers(entry) ? NEGATIVE_TIER_WEIGHT : NEGATIVE_PLAIN_WEIGHT;
}

/**
 * 从负面池里抽 `n` 张**这一手不重复**的卡。抽取器与饰品词条同一套（`rng.weighted`），只是权重换成
 * `negativeWeightOf`（有挡位 1.0 / 无挡位 0.5）—— 不另起一套随机逻辑。
 * @param {() => number} rng @param {any[]} pool @param {number} [n]
 * @returns {any[]}
 */
export function drawNegativeCards(rng, pool, n = RELIC_CARD_COUNT) {
  return drawRelicCards(rng, pool, n, negativeWeightOf);
}

/**
 * 一条负面词条在**这一回合**的档位（A 表）：档位由回合推导，**不随机**。
 * 没写档位的条目（D09…D16B）返回 null；档位序号超过该条自身的档数时夹到最后一档（正常数据不会发生）。
 * @param {any} entry
 * @param {number} round 开三选一的回合（R5 / R11 / R21… / R50+）
 * @returns {{ index: number, label: string, v: Record<string, number> }|null}
 */
export function negativeTierOf(entry, round) {
  const tiers = negativeTiersOf(entry);
  if (!tiers.length) return null;
  const index = Math.min(tiers.length - 1, negativeTierIndexForRound(round));
  const tier = tiers[index];
  return { index, label: tier.label, v: { ...tier.v } };
}

/** 负面词条专用随机流（与饰品词条同一个 deriveSeed 口径，salt 前缀不同 ⇒ 两条流互不消耗）。 */
export function negativeRng(m, salt) {
  return createRng(deriveSeed((m && m.seed) || 1, `overlimit-negative:${salt}`));
}

/**
 * 无限段的「这一回要不要抽负面」判据（C 表，业主 2026-10-31 第三单确认）：
 * 按 Boss 轮交替 —— R20 / R30 / R40 之后的三选一（R21 / R31 / R41）抽负面，
 * R25 / R35 / R45 之后的（R26 / R36 / R46）抽饰品。8 次无限三选一里负面恰 4 次。
 * @param {number} r 开三选一的回合号
 * @returns {boolean}
 */
export function isNegativeInfiniteRound(r) {
  if (!Number.isInteger(r) || r < RELIC_INFINITE_FROM) return false;
  if ((r - RELIC_INFINITE_FROM) % 5 !== 0) return false;   // 不是 Boss 轮之后的三选一回合
  // 'boss' = 上一回合是偶数 Boss 轮（R20/30/40 → R21/31/41）；'round' 是作废的旧读法，只为对齐常量保留。
  return NEGATIVE_EVEN_MODE === 'boss' ? (r - 1) % 2 === 0 : r % 2 === 0;
}

/**
 * 这一回合的三选一抽哪个池：'lc'（R3/R8 饰品）| 'infinite'（无限段饰品）| 'negative'（负面）| null（没有）。
 * @param {any} m @param {number} round
 * @returns {'lc'|'infinite'|'negative'|null}
 */
export function relicDraftKind(m, round) {
  const r = Number(round);
  if (!Number.isInteger(r) || r < 1) return null;
  if (RELIC_LC_ROUNDS.includes(r)) return RELIC_LC_GROUP;
  if (NEGATIVE_ROUNDS.includes(r)) return RELIC_NEGATIVE_KIND;
  if (isNegativeInfiniteRound(r)) return RELIC_NEGATIVE_KIND;
  if (r >= RELIC_INFINITE_FROM && (r - RELIC_INFINITE_FROM) % 5 === 0) return 'infinite';
  return null;
}

/**
 * 还没开过的**负面**词条回合：正常段剩下的 R5 / R11 + 无限段接下来的几个负面轮（与 `nextRelicRounds` 同口径，
 * 两份各算各的 —— 池子互不混，提示也分开）。相位见 `isNegativeInfiniteRound`（按 Boss 轮交替）。
 * @param {number} round @param {Set<number>|number[]} done @param {number} [count]
 * @returns {number[]} 升序
 */
export function nextNegativeRounds(round, done = [], count = 3) {
  const r0 = Number.isInteger(round) && round > 0 ? round : 1;
  const seen = done instanceof Set ? done : new Set(Array.isArray(done) ? done : []);
  const out = [];
  for (const r of NEGATIVE_ROUNDS) if (r >= r0 && !seen.has(r)) out.push(r);
  let r = Math.max(RELIC_INFINITE_FROM, r0);
  while ((r - RELIC_INFINITE_FROM) % 5 !== 0) r++;
  const want = Math.max(0, Math.trunc(Number(count) || 0));
  let n = 0;
  while (n < want && r < RELIC_INFINITE_FROM + 5 * 400) {
    if (!seen.has(r) && isNegativeInfiniteRound(r)) { out.push(r); n++; }
    r += 5;
  }
  return out;
}

/**
 * 一张负面词条的三选一卡。字段与 `relicCardView` 同形（客户端复用同一套 .zjcard），多三个区分字段：
 *   · `negative: true` 与 `group: 'neg'` —— 客户端据此换警示色 / 眉题；
 *   · `tierLabel` / `tierIndex` / `tierValues` —— 这一张抽到的档位（没档位的条目是 null）。**`tier` 仍然是 null**：
 *     那个键是 `cardView` 给别的 family 留的（数字档位），不在这里抢。
 * @param {any} entry 负面表里的一条
 * @param {number} idx
 * @param {{ index: number, label: string, v: Record<string, number> }|null} [tier]
 */
export function negativeCardView(entry, idx, tier = null) {
  return {
    idx,
    kind: 'overlimit',
    negative: true,
    id: entry.id,
    name: entry.name,
    desc: entry.desc,
    flavor: typeof entry.flavor === 'string' ? entry.flavor : '',
    group: NEGATIVE_GROUP,
    impl: typeof entry.impl === 'string' ? entry.impl : 'pending',
    effectColor: entry.effectColor ?? null,
    icon: entry.icon ?? null,
    tier: null,
    tierLabel: tier ? tier.label : null,
    tierIndex: tier ? tier.index : null,
    tierValues: tier ? tier.v : null,
  };
}

/** 本局已选走的负面 id（`m.relicsOverlimit.negPicked` 里的 id；非超限局永远空）。 */
export function negativePickedIds(m) {
  if (!m || !m.gd || m.gd.overlimit !== true) return [];
  const st = m.relicsOverlimit;
  const list = st && Array.isArray(st.negPicked) ? st.negPicked : [];
  return list.map((x) => (typeof x === 'string' ? x : x && x.id)).filter((id) => typeof id === 'string' && id);
}

/**
 * 战斗侧要的负面词条列表：`[{ id, at, tier }]`（`tier` = 档位序号，没档位是 null）。
 * 与饰品的那份**分开一个键**（`relicsOverlimitNegative`），因为「我拥有几件饰品」这类条文（LC-EX1 等）
 * 只该数饰品，不该把负面词条也算进去。`m.relicPickedLog` 里负面条目带 `neg: true`。
 * @param {any} m Match
 * @returns {{ id: string, at: number, tier: number|null }[]}
 */
export function negativeBattleList(m) {
  const st = m && m.relicsOverlimit;
  const list = st && Array.isArray(st.negPicked) ? st.negPicked : [];
  if (!m || !m.gd || m.gd.overlimit !== true || !list.length) return [];
  const log = Array.isArray(m.relicPickedLog) ? m.relicPickedLog : [];
  const at = new Map();
  for (const row of log) if (row && row.neg === true && typeof row.id === 'string' && !at.has(row.id)) at.set(row.id, row.round);
  return list.map((x) => {
    const id = typeof x === 'string' ? x : x && x.id;
    const tier = typeof x === 'object' && x ? x.tier : null;
    const r = at.get(id);
    return { id, at: Number.isInteger(r) && r > 0 ? r : 1, tier: Number.isInteger(tier) ? tier : null };
  }).filter((x) => typeof x.id === 'string' && x.id);
}

// =====================================================================================================================
// 实装（业主 2026-10-31 第二批）：已选词条的「生效集合」与互斥/失效
//
// 词条在**一局之内全队共享**：`m.relicsOverlimit.picked` 是唯一真源（无放回），coop 里也由全队一起选。所以
// 「我方单位」的加成对每一名存活玩家的干员都成立 —— battleInput 把同一份 id 列表发给每名玩家，sim 侧按 ownerId 分派。
//
// 失效条款（表里明写的两句）：
//   · FGO-11 虚妄は闇の娘 …「（选择玛修 FGO-X 饰品后效果失效）」→ 选走 FGO-Ⅹ 后 FGO-11 整条不生效；
//   · FGO-13 彼方にかざす夢の噺 …「（选择梅林 FGO-09 饰品后失效）」→ 选走 FGO-09 后 FGO-13 整条不生效。
// 失效发生在**取用侧**（`activeRelicIds` / battleInput / 整备期钩子），不是把 id 从 picked 里删掉：已选记录、档案、
// S.W.E.E.P. 词条页仍要显示它们（业主口径：选到的东西不会消失，只是效果被顶掉）。
/** 词条 id → 让这条失效的词条 id（表里「（选择…后效果失效）」那两句）。 */
export const RELIC_INVALIDATED_BY = Object.freeze({
  'FGO-11': 'FGO_X',
  'FGO-13': 'FGO-09',
});

/**
 * 本局**真正生效**的词条 id（顺序 = 选取顺序，失效的剔掉）。
 * @param {Iterable<string>} picked 已选走的 id
 * @returns {string[]}
 */
export function activeRelicIds(picked) {
  const list = picked instanceof Set ? [...picked] : Array.isArray(picked) ? picked.slice() : [];
  const owned = new Set(list);
  return list.filter((id) => {
    const off = RELIC_INVALIDATED_BY[id];
    return typeof id === 'string' && !!id && !(off && owned.has(off));
  });
}

/** 本局被失效条款顶掉的词条 id（只用于日志 / 测试 / 报告）。 */
export function invalidatedRelicIds(picked) {
  const list = picked instanceof Set ? [...picked] : Array.isArray(picked) ? picked.slice() : [];
  const owned = new Set(list);
  return list.filter((id) => {
    const off = RELIC_INVALIDATED_BY[id];
    return typeof id === 'string' && !!id && !!off && owned.has(off);
  });
}

/**
 * 一局里已选走的词条 id（`m.relicsOverlimit.picked`；没有就是空数组）。非超限局永远空。
 * @param {any} m Match
 * @returns {string[]}
 */
export function overlimitPickedIds(m) {
  if (!m || !m.gd || m.gd.overlimit !== true) return [];
  const st = m.relicsOverlimit;
  return st && Array.isArray(st.picked) ? st.picked.slice() : [];
}

/**
 * 本局生效的词条 id（已过失效条款）。非超限局永远空数组 —— 所有实装都从这里取，所以普通 / 湮灭 / 炸惊一帧不变。
 * @param {any} m Match
 * @returns {string[]}
 */
export function overlimitActiveIds(m) {
  return activeRelicIds(overlimitPickedIds(m));
}

/** 某个词条这一局是否生效。 */
export function overlimitActive(m, id) {
  return overlimitActiveIds(m).includes(id);
}

/**
 * 战斗侧要的词条列表：`[{ id, at }]`，`at` = 选走它的回合（LC-SP4 / LC-SP5 这类「每回合成长」按它算）。
 * `m.relicPickedLog` 是选取日志（match/match/relicDraft.js takeOverlimitRelic 写的）；缺日志时按 R1 兜底。
 * @param {any} m Match
 * @returns {{ id: string, at: number }[]}
 */
export function overlimitBattleList(m) {
  const ids = overlimitActiveIds(m);
  if (!ids.length) return [];
  const log = Array.isArray(m && m.relicPickedLog) ? m.relicPickedLog : [];
  const at = new Map();
  for (const row of log) if (row && typeof row.id === 'string' && !at.has(row.id)) at.set(row.id, row.round);
  return ids.map((id) => {
    const r = at.get(id);
    return { id, at: Number.isInteger(r) && r > 0 ? r : 1 };
  });
}

// 战斗侧的形状（`{ id, at }[]`）由 `overlimitBattleList` 产出，sim 的 content/overlimitRelics.js 只认
// `PlayerBattleInput.relicsOverlimit` 这个键；非超限局没有这个键。

// =====================================================================================================================
// 整备期（prep side）的词条规则

/** LC-EX1「凤·皇」：跨回合保留的经费 = 上回合留下的 150%（业主表原文）。 */
export const OVERLIMIT_CARRY_RATE = 1.5;

/**
 * 这一局是否「经费跨回合保留」= 生效的 LC-EX1。`endPrep` 原本会把剩余资金清零（`gd.leftoverKeptBands` 的坎诺特
 * 除外），LC-EX1 在这条规则上加一层：不清零，而是按 150% 保留。
 * @param {any} m Match
 * @returns {boolean}
 */
export function overlimitKeepsFunds(m) {
  return overlimitActive(m, 'LC-EX1');
}

/**
 * 上回合留下的资金 → 跨回合实际保留的资金（LC-EX1：150%，向下取整）。
 * @param {number} funds
 * @returns {number}
 */
export function overlimitCarriedFunds(funds) {
  const v = Number(funds);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v * OVERLIMIT_CARRY_RATE);
}
