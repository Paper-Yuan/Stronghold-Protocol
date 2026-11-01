#!/usr/bin/env node
// tools/infinite-anchor-pairs.mjs — 超限「锚定分析」：固定 1 条大盟约，交叉 2 条副盟约的全部组合。
//
// 只读脚本：不改 data / server / public / test，只写 .cache 中间 JSON 与 handoff 产物。
//
// 口径（与 handoff/OVERLIMIT-3BOND-DPS.md 的 v2 一致，便于横向对比）：
//   * 池子从 data/bonds.json 现读：8 条 isCore（再剔除 zjOnly / annOnly）+ 精准/迅捷/灵巧/奥术/不屈 5 条小盟约。
//   * 锚 = 8 条大盟约之一；搭档 = 剩余 12 条里的 C(12,2)=66 组 → 8×66 = 528 组，全量真 sim，不抽样。
//   * 8 格棋盘按 activeCount 分格：锚永远拿分格表的第一档（6/5/4/3），两条搭档分后两档，且两条搭档的档位互换
//     各试一次（共 9 套分格），都跑一次 R30，取 DPS 最高的那套（= 玩家会组的队），再用它跑完整 21 个回合点。
//   * 交集优先：能同时计入多条盟约的干员先上；场上每条盟约的 count = 真实携带人数，不足 activeCount 就不激活
//     （引擎只看 active 标志，白送 buff 会让「0 人上场的盟约」也生效——这是 v2 修正过的坑）。
//   * 装备：每名干员 1 件维式重锤 chess_item_1_01_e_a（与 tools/infinite-teams.mjs 同口径）。
//   * 木桩：1e12 血、rank ELITE（叙拉古的 +0.5% 最大生命真伤因此被引擎的「精英/首领 250 万」封顶）。
//   * 超限加强：flags.overlimit = true（业主 8f2a3ffa 的五条只在超限局生效）。
//   * 层数：R15 = 大 400 / 小 150，R16 起每回合 +50；R1–R15 取线性累积（v2 的 [估计] 口径）。
//
// ---- 业主 2026-10-31 批准的「重做整张锚定表」：三处口径（默认全开 = 本表中线与 handoff/OVERLIMIT-ANCHOR-FINAL.md）----
//   ① tier：`bondState()` 用真机 `tierFor()`（达到几个 thresholds），**不按人数硬算**，并由 `assertTierCaliber()` 在启动时钉死。
//      （旧版 `count>=4 → tier2` 会让 `bonds/core.js reached()` 的 `bondTier >= idx+1` 捷径在锚只占 4 格时白送 6 人档。）
//   ② 池子（`--pool official`，默认）：只取官方记录，剔除 `zhajing: true` 的炸惊叠加记录与 `annihilation: true` 的歼星记录。
//      同一名干员在 data 里有两条记录（官方 + 炸惊），`bonds` 一样但 **baseId / charId 不同**，旧口径按 baseId 去重去不掉，
//      于是同一人能占两格、人数与伤害都白拿一份（旧拉特兰 Top1 的 8 人里 3 组重复：蕾缪安 / 圣聆初雪 / 莫斯提马）。
//      启动时打印「池子人数 + 重复 baseId 数 + 重复干员(charId) 数」，重复数非 0 直接抛。
//   ③ 摆位（`--layout block`，默认）：旧摆位 row10 col3–10 的第 6–8 人压在木桩墙 row9–11 col8–10 上（0 距离输出）。
//      合法摆位 = 贴墙两列 col7 / col6（row 9–12，8 格互不重合、都不在木桩墙上），近战优先拿 col7 的贴脸位。
//      启动时断言「没有任何单位与木桩格重合」，实战中对每场 `allies()` 的真实 `tileR/tileC` 再数一遍，必须为 0。
//   复现旧表用 `--pool legacy --layout row`；复现「只修 tier」用 `--pool legacy --layout row`（tier 已固定为 tierFor）。
//
// ---- 业主 2026-10-31 的三条新口径（默认全关，保持上面这份旧口径逐字节不变）----
//   1. 外援主 C（`--mvc <diyChessId>`）：每套队伍 = 7 名常驻 + 1 名「自选干员」，并把它**按锚重新归类**。
//      引擎真实路径（不是伪造 bonds 计数）：自选干员是 data/chess.json 里 isDiy 的槽位（chess_char_6_diy1_b），
//      由 backups.json `diy.operators[charId].bonds` 决定它自己的盟约；**转职**走「变形同构体」——
//      chess_item_6_09_e_b 有 `canGiveBond: true`，官方档（items ≥ 2，其中一件 canGiveBond 必须存在，见
//      shared/plugins/rules.js grantedBondsByMorph）让携带者额外获得**另一件装备 giveBondId 写的盟约**。
//      所以外援主 C 带 [锚的族装备, 变形同构体] 两件 → unitBonds 里真的出现锚（support.isMember 判成员、
//      bonds/core.js 的 members 用的就是它），count 也按真实成员 +1。设 --mvc-pick/--mvc-skill 选人。
//      默认 pick：维什戴尔 char_1035_wisdel，skill 2「爆裂黎明」（72 名合法自选里单兵 DPS 最高，见报告 §2）。
//   2. 维多利亚金锤（`--gold-hammer`）：凡 data bonds 含 victoriaShip 的干员，普锤 chess_item_1_01_e_a
//      换成进阶 chess_item_1_01_e_b（攻击力 +15% → +25%；维多利亚 6 人档的 atk_normal_equip/atk_golden_equip
//      也按金件多给）。外援主 C 在维多利亚阵容里同样带金锤（它转职后就是维多利亚成员）。
//   3. 拉特兰锁精准：本脚本不锁搭档（66 组照跑），只在导出里标出「含 preciShip 的最好一组」，
//      报告里同时给「旧 Top1 搭档（谢拉格+奥术）」的数，两种读法都能核。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../test/helpers/battleHarness.js';
// 档位口径必须与真机同源：bondsMeta.tierFor = 「达到了几个 thresholds」（count≥3 → 1，count≥6 → 2 …）。
// 旧版这里按人数硬算（count>=4 → tier 2），配上 core.js reached() 的 `bondTier >= idx+1` 捷径，
// 锚只占 4 格时 6 人档会被白送（拉特兰/叙拉古/卡西米尔 thresholds 都是 [3,6]）。
import { tierFor } from '../server/match/bondsMeta.js';
// 官方池的边界就是官方难度的可见口径（server/match/gamedata.js），直接复用，不自己写一份判定。
import { isOfficialVisibleChess } from '../server/match/gamedata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8'));
const chess = read('chess');
const bonds = read('bonds');
const backups = read('backups');

// ---- 命令行 ----
const ARGV = process.argv.slice(2);
const NO_VALUE = new Set(['--gold-hammer']);
const opt = (name, def = null) => {
  const i = ARGV.indexOf('--' + name);
  return i >= 0 && ARGV[i + 1] != null && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : (i >= 0 ? '' : def);
};
const has = (name) => ARGV.includes('--' + name);
/** 位置参数 = 只跑这些锚（逗号分隔），与旧用法 `node tools/infinite-anchor-pairs.mjs kjeragShip` 相同。 */
const ANCHORS_ARG = (() => {
  const out = [];
  for (let i = 0; i < ARGV.length; i++) {
    const a = ARGV[i];
    if (a.startsWith('--')) { if (!NO_VALUE.has(a)) i++; continue; }
    out.push(a);
  }
  return out.length ? out.join(',').split(',') : null;
})();

const ITEM = 'chess_item_1_01_e_a';   // 维式重锤（普）
const GOLD_ITEM = 'chess_item_1_01_e_b'; // 维式重锤（进阶）；业主 2026-10-31：维多利亚全员金锤
const MORPH = 'chess_item_6_09_e_b';  // 变形同构体（canGiveBond）—— 转职所需的那件
const MAJOR = Object.keys(bonds).filter((id) => bonds[id].isCore && !bonds[id].zjOnly && !bonds[id].annOnly);
const MINOR5 = ['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'indomShip'];
const POOL = [...MAJOR, ...MINOR5];
if (MAJOR.length !== 8) throw new Error('expected 8 core bonds, got ' + MAJOR.length);

// ---- 口径开关 ②③（业主 2026-10-31 批准的重做；缺省 = 官方池 + 合法摆位）----
const POOL_MODE = opt('pool', 'official');   // official（默认）| legacy（旧口径：不滤炸惊/歼星记录）
const LAYOUT_MODE = opt('layout', 'block');  // block（默认）| row（旧摆位 row 10 / col 3–10）
if (!['official', 'legacy'].includes(POOL_MODE)) throw new Error('--pool 只能是 official / legacy');
if (!['block', 'row'].includes(LAYOUT_MODE)) throw new Error('--layout 只能是 block / row');

/**
 * 官方池：data/chess.json 里同一名干员有两条记录 —— 官方记录，和一条 `zhajing: true` 的炸惊叠加记录
 * （另有 26 条 `annihilation: true` 的歼星记录）。两边的 `bonds` 完全一样，但 **baseId / charId 不同**，
 * 旧口径按 baseId 去重根本去不掉，于是同一名干员能占两个格子、人数与伤害都白拿一份
 * （旧拉特兰 Top1 的 8 人里有 3 组重复：蕾缪安 / 圣聆初雪 / 莫斯提马）。
 *
 * 边界直接用 server/match/gamedata.js 的 `isOfficialVisibleChess`（官方难度可见 = 官方池），
 * 但按「**干员**」判定而不是按「记录」判定，因为本表一直用同一名干员的精锐形态 `_b` 上场：
 *   1. `OFFICIAL_CHARS` = 有一条官方可见非精锐记录的干员（isOfficialVisibleChess 原文，一个字不改）；
 *   2. 池子里只收 `visible === true`、非 zhajing / annihilation、且 charId 在 `OFFICIAL_CHARS` 里的记录，
 *      同一 baseId 仍优先 `_b`（精锐）。这样 `_b` 的满配口径不动，只把炸惊副本踢出去。
 * 注意有些炸惊副本并没有 `zhajing` 标记（锏 chess_zj_91_b、斯卡蒂 chess_zj_pure_a、锡人 chess_zj_13_b），
 * 它们的 `visible === false` —— 只按 zhajing 标记过滤会漏掉这 3 名干员，所以三条一起判。
 */
const OFFICIAL_CHARS = new Set(
  Object.keys(chess).filter((k) => isOfficialVisibleChess(chess[k])).map((k) => chess[k].charId),
);
const officialOk = (c) => POOL_MODE === 'legacy' || (
  c.visible === true && c.zhajing !== true && c.annihilation !== true && OFFICIAL_CHARS.has(c.charId)
);

/** 每条大盟约的「族装备」：唯一一件 giveBondId = 该盟约的可用装备（data/items.json），转职时给外援主 C 带。 */
const ANCHOR_ITEM = {
  victoriaShip: ITEM,
  sargonShip: 'chess_item_2_04_e_a',
  siracusaShip: 'chess_item_3_01_e_a',
  yanShip: 'chess_item_3_04_e_a',
  egirShip: 'chess_item_3_07_e_a',
  kazimierzShip: 'chess_item_4_07_e_a',
  lateranoShip: 'chess_item_4_08_e_a',
  kjeragShip: 'chess_item_5_02_e_a',
};

// ---- 口径开关（旧口径 = 三个都关）----
const MVC_SLOT = opt('mvc', null);            // 例：--mvc chess_char_6_diy1_b（tier-6 精英自选槽）
const MVC_PICK = opt('mvc-pick', 'char_1035_wisdel');
const MVC_SKILL = Number(opt('mvc-skill', '2'));
const GOLD_HAMMER = has('gold-hammer');
const TAG = opt('tag', MVC_SLOT ? 'with-mvc' : null);
const MAIN = { mvc: !!MVC_SLOT, gold: GOLD_HAMMER };
if (MVC_SLOT) {
  const s = backups.diy?.slots ?? {};
  const base = Object.keys(s).find((id) => id === MVC_SLOT || s[id]?.goldenId === MVC_SLOT);
  if (!base) throw new Error('--mvc: 不是自选槽位 id: ' + MVC_SLOT);
  const ops = backups.diy?.operators?.[MVC_PICK]?.bonds;
  if (!Array.isArray(ops)) throw new Error('--mvc-pick: 不是自选可选干员: ' + MVC_PICK);
}

// ---- 回合网格：21 点（R1–R16 逐回合 + R20/25/30/35/40），v2 同网格
const GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 30, 35, 40];

// ---- 层数（v2 §2.3 的 [估计] 口径）
function layersOf(round) {
  const major = round <= 15 ? Math.round(400 * round / 15) : 400 + (round - 15) * 50;
  const minor = round <= 15 ? Math.round(150 * round / 15) : 150 + (round - 15) * 50;
  return { major, minor };
}

// ---- 干员索引：每条盟约的可用干员（同 baseId 只留精英 _b；排除 DIY / 隐藏 / 炸惊·歼星记录）
const membersOf = {};
for (const id of POOL) {
  const byBase = new Map();
  for (const k of Object.keys(chess)) {
    const c = chess[k];
    if (!Array.isArray(c.bonds) || !c.bonds.includes(id)) continue;
    if (c.isDiy || c.isHidden) continue;
    if (!officialOk(c)) continue;
    const base = c.baseId || k;
    const cur = byBase.get(base);
    if (!cur || (k.endsWith('_b') && !cur.endsWith('_b'))) byBase.set(base, k);
  }
  membersOf[id] = [...byBase.values()];
}
const carries = (id, b) => Array.isArray(chess[id]?.bonds) && chess[id].bonds.includes(b);
const statScore = (id) => {
  const s = chess[id].stats || {};
  return (Number(s.atk) || 0) * (1 + (Number(s.aspd) || 100) / 100);
};

/**
 * 池子自检（业主 2026-10-31）：池子人数、**重复 baseId 数**、重复干员（charId）数。
 * 炸惊叠加记录与官方记录 baseId 不同，所以「重复 baseId」在旧口径下也是 0 —— 真正的症状是
 * **同一名干员（同 charId / 同 name）在一个池子里出现两次**，这个数在旧口径下是 11（拉特兰）/ 8–13（其余锚）。
 * 两个数都打印；非 0 时官方池直接抛。
 */
function poolAudit() {
  const rows = [];
  let dupBase = 0, dupChar = 0;
  for (const id of POOL) {
    const bases = membersOf[id].map((k) => chess[k].baseId || k);
    const chars = membersOf[id].map((k) => chess[k].charId || k);
    const countDup = (arr) => {
      const seen = new Set(); let n = 0;
      for (const v of arr) { if (seen.has(v)) n++; else seen.add(v); }
      return n;
    };
    const b = countDup(bases), c = countDup(chars);
    dupBase += b; dupChar += c;
    rows.push({ bond: id, pool: membersOf[id].length, dupBase: b, dupChar: c, members: membersOf[id] });
  }
  return { rows, dupBase, dupChar };
}
const POOL_AUDIT = poolAudit();
if (POOL_MODE === 'official' && (POOL_AUDIT.dupBase || POOL_AUDIT.dupChar)) {
  throw new Error('池子口径断言失败：官方池里出现重复 baseId=' + POOL_AUDIT.dupBase + ' / 重复干员=' + POOL_AUDIT.dupChar);
}

/** 一件装备：维多利亚成员在 --gold-hammer 下换进阶锤，其余普锤（旧口径逐字节相同）。 */
function itemsFor(id, mode) {
  const vic = Array.isArray(chess[id]?.bonds) && chess[id].bonds.includes('victoriaShip');
  return [mode?.gold && vic ? GOLD_ITEM : ITEM];
}

/** 外援主 C 的槽位（自选干员）：base id + 是否精英档（`_b`）。 */
const MVC_SLOT_INFO = (() => {
  if (!MVC_SLOT) return null;
  const s = backups.diy?.slots ?? {};
  const base = Object.keys(s).find((id) => id === MVC_SLOT || s[id]?.goldenId === MVC_SLOT);
  return { base, elite: base !== MVC_SLOT, tier: s[base]?.tier ?? 6 };
})();

/**
 * 外援主 C 的「转职后」盟约：自选记录自己的 bonds（backups.json `diy.operators[charId].bonds`，
 * shared/diy.js diyRecordOf 就是这么取的）∪ 锚（由 [锚族装备 + 变形同构体] 经 grantedBondsByMorph 授予）。
 * 这就是引擎里 unitBonds(u) 的结果，所以 count 用它算，不额外编数。
 */
const mvcBondsOf = (anchor) => [...new Set([...(backups.diy?.operators?.[MVC_PICK]?.bonds ?? []), anchor])];

/** 外援主 C 的装备：锚族装备（维多利亚在 --gold-hammer 下是金锤）+ 变形同构体（转职必需）。 */
const mvcItemsOf = (anchor, mode) => [
  mode?.gold && anchor === 'victoriaShip' ? GOLD_ITEM : (ANCHOR_ITEM[anchor] ?? ITEM),
  MORPH,
];

/** 外援主 C 的 units[] 条目（harness 的 diy 入口 = 生产路径 simdata getChess(slot, { diy })）。 */
function mvcUnit(anchor, pos, mode) {
  return {
    diy: { slot: MVC_SLOT_INFO.base, charId: MVC_PICK, skillIndex: MVC_SKILL },
    elite: MVC_SLOT_INFO.elite,
    row: pos[0], col: pos[1], items: mvcItemsOf(anchor, mode),
  };
}

// ---- 阵容：按格数分配（交集优先，余位补满），与 v2 的 rosterFor 相同；带外援时上限 7 名常驻
function rosterFor(combo, alloc, cap = 8) {
  const need = {};
  combo.forEach((b, i) => { if (alloc[i] > 0) need[b] = alloc[i]; });
  const out = [];
  const covered = {};
  combo.forEach((b) => { covered[b] = 0; });
  const cands = [...new Set(combo.flatMap((b) => membersOf[b]))];
  const cover = (id) => combo.reduce((n, b) => n + (need[b] > 0 && carries(id, b) && covered[b] < need[b] ? 1 : 0), 0);
  cands.sort((a, b) => (cover(b) - cover(a)) || (statScore(b) - statScore(a)));
  for (const id of cands) {
    if (out.length >= cap) break;
    if (cover(id) <= 0) continue;
    out.push(id);
    for (const b of combo) if (need[b] > 0 && carries(id, b) && covered[b] < need[b]) covered[b]++;
  }
  for (const b of combo) {
    const want = need[b] || 0;
    if (covered[b] >= want) continue;
    const rest = membersOf[b].filter((id) => !out.includes(id)).sort((x, y) => statScore(y) - statScore(x));
    for (const id of rest) {
      if (covered[b] >= want || out.length >= cap) break;
      out.push(id); covered[b]++;
    }
  }
  if (out.length < cap) {
    const filler = [...new Set(combo.flatMap((b) => membersOf[b]))]
      .filter((id) => !out.includes(id)).sort((x, y) => statScore(y) - statScore(x));
    for (const id of filler) { if (out.length >= cap) break; out.push(id); }
  }
  return out;
}

const ALWAYS = ['suntShip'];
const needOf = (b) => Number(bonds[b]?.activeCount) || Number(bonds[b]?.thresholds?.[0]) || 2;
/**
 * 一条盟约的战斗输入状态。
 * `tier` **必须**用真机的 tierFor（达到几个 thresholds），不能按人数硬算：
 * 拉特兰/叙拉古/卡西米尔 thresholds = [3,6]，所以 4 人 = tier 1、6 人 = tier 2。
 * 旧版 `count>=4 → 2` 会让 `core.js reached()` 的 `bondTier >= idx+1` 捷径在锚占 4 格时放行 6 人档。
 */
const bondState = (id, count, layers) => ({
  count, active: true, tier: tierFor(bonds[id], count), layers,
});

// ---- 口径断言：把「4 人只有 tier 1」这个事实钉住，任何人再把 tier 改回按人数硬算都会在启动时炸掉 ----
function assertTierCaliber() {
  const pinned = [
    ['lateranoShip', 3, 1], ['lateranoShip', 4, 1], ['lateranoShip', 5, 1], ['lateranoShip', 6, 2],
    ['siracusaShip', 4, 1], ['kazimierzShip', 4, 1], ['kjeragShip', 4, 1],
    ['egirShip', 5, 2], ['yanShip', 6, 2], ['yanShip', 9, 3],
    ['preciShip', 2, 1], ['preciShip', 3, 2], ['skillfulShip', 2, 1], ['arcaneShip', 3, 2],
    ['suntShip', 3, 1],
  ];
  for (const [id, count, want] of pinned) {
    const got = bondState(id, count, 0).tier;
    if (got !== want) throw new Error(`tier 口径断言失败：${id} ${count} 人 → tier ${got}，真机 tierFor 应为 ${want}`);
  }
  // 再逐条 × 0–8 人与真机函数对拍：thresholds 数据将来若变，断言仍要求同源，不会悄悄漂移。
  for (const id of POOL) {
    for (let n = 0; n <= 8; n++) {
      const a = bondState(id, n, 0).tier, b = tierFor(bonds[id], n);
      if (a !== b) throw new Error(`tier 口径与 tierFor 不一致：${id} ${n} 人 → ${a} vs ${b}`);
    }
  }
}
assertTierCaliber();

// ---- 口径 ③：合法摆位（业主 2026-10-31 批准）----
// 木桩墙 = row 9–11 × col 8–10（9 格）。旧摆位 row 10 / col 3–10 里的第 6–8 人（col 8/9/10）**就站在木桩格上**，
// 相当于 0 距离输出——真实对局不可能这样部署，而且恰好给「远程多」的阵容白送收益。
// 合法摆位 = 贴住木桩墙的紧凑两列 col 7 / col 6（row 9–12）：8 个格子互不重合、都不在木桩墙上，
// 近战优先拿 col 7 的贴脸位（否则近战够不到木桩，会像 kjerag 早期那样测出 0）。
const WALL_TILES = (() => {
  const out = [];
  for (let r = 9; r <= 11; r++) for (let c = 8; c <= 10; c++) out.push([r, c]);
  return out;
})();
const WALL_KEY = new Set(WALL_TILES.map((p) => p.join(',')));
const BLOCK_TILES = [[9, 7], [10, 7], [11, 7], [12, 7], [9, 6], [10, 6], [11, 6], [12, 6]];

/**
 * 一队单位的落格。`melee[i]` = 第 i 个单位是否近战。
 * block = 贴墙两列（近战按原顺序优先占 col 7 的四格，远程排后面）；row = 旧摆位 row 10 / col 3+i。
 */
function placementOf(melee) {
  if (LAYOUT_MODE === 'row') return melee.map((_, i) => [10, 3 + i]);
  const order = melee.map((m, i) => ({ i, m: m ? 0 : 1 })).sort((a, b) => a.m - b.m || a.i - b.i);
  const out = new Array(melee.length);
  order.forEach((o, k) => { out[o.i] = BLOCK_TILES[k] ?? [10, 3 + k]; });
  return out;
}

/** 实测重合计数：每场战斗后对真实 `tileR/tileC` 与木桩格求交，任何人都不许站在木桩上。 */
let LAYOUT_OVERLAPS = 0;
let LAYOUT_BATTLES = 0;

/** 启动断言：1–8 人的所有摆位都互不重合、都不在木桩墙上；然后打印「与木桩格重合的单位数 = 0」。 */
function assertLegalLayout() {
  const bad = [];
  for (let n = 1; n <= BLOCK_TILES.length; n++) {
    for (const test of [Array.from({ length: n }, (_, i) => i % 2 === 0), Array.from({ length: n }, () => false)]) {
      const pos = placementOf(test);
      if (new Set(pos.map((p) => p.join(','))).size !== n) bad.push(`n=${n} 有重合格`);
      for (const p of pos) if (WALL_KEY.has(p.join(','))) bad.push(`n=${n} 站在木桩格 ${p}`);
    }
  }
  const probe = LAYOUT_MODE === 'row' ? null : placementOf(Array.from({ length: 8 }, () => true));
  return { bad, probe };
}
const LAYOUT_AUDIT = assertLegalLayout();
if (LAYOUT_MODE === 'block' && LAYOUT_AUDIT.bad.length) {
  throw new Error('摆位断言失败：' + LAYOUT_AUDIT.bad.slice(0, 3).join('；'));
}

// ---- 三处口径的自检日志（业主 2026-10-31：跑全量之前必须先把这三行贴出来）----
console.log('== 三处口径自检 ==');
console.log('  ① tier：bondState = tierFor(bonds[id], count)，assertTierCaliber() 通过'
  + '（13 条盟约 × 0–8 人 + 15 个手写用例与真机对拍）');
console.log('  ② 池子口径 pool=' + POOL_MODE + '：' + (POOL_MODE === 'legacy'
  ? '旧口径（不滤 zhajing / annihilation / 炸惊副本）'
  : '官方池（isOfficialVisibleChess 可见干员；剔除 zhajing / annihilation / visible:false 炸惊副本，保留 _b 精锐形态）'));
console.log('     池子人数（13 条盟约）：' + POOL_AUDIT.rows.map((r) => r.bond + '=' + r.pool).join(' '));
console.log('     池子合计 ' + POOL_AUDIT.rows.reduce((n, r) => n + r.pool, 0) + ' 名 ｜ 重复 baseId 数 = '
  + POOL_AUDIT.dupBase + ' ｜ 重复干员(charId) 数 = ' + POOL_AUDIT.dupChar);
console.log('  ③ 摆位 layout=' + LAYOUT_MODE + '：' + (LAYOUT_MODE === 'row'
  ? '旧摆位 row 10 / col 3–10（与木桩墙 row9–11 × col8–10 有重叠）'
  : '合法摆位 贴墙两列 col7 / col6（row 9–12），近战优先贴脸'));
console.log('     8 格：' + (LAYOUT_MODE === 'row' ? 'row10 col3..10' : BLOCK_TILES.map((p) => 'r' + p[0] + 'c' + p[1]).join(' ')));
console.log('     与木桩格重合的单位数 = ' + LAYOUT_AUDIT.bad.length
  + (LAYOUT_AUDIT.bad.length ? '（' + LAYOUT_AUDIT.bad.slice(0, 3).join('；') + '，这是旧摆位的样子）' : ''));

/**
 * 盟约状态：大盟约吃大层数、小盟约吃小层数；count < activeCount ⇒ 不激活（不给白送 buff）。
 * 外援主 C 的 count 只加给「它转职后真的属于」的那条盟约（mvcBondsOf），其余盟约不受影响。
 */
function statesFor(combo, counts, round) {
  const { major, minor } = layersOf(round);
  const st = {};
  for (const b of combo) {
    const n = counts[b] || 0;
    const s = bondState(b, n, MAJOR.includes(b) ? major : minor);
    if (n < needOf(b)) s.active = false;
    st[b] = s;
  }
  for (const b of ALWAYS) st[b] = bondState(b, 3, minor);
  return st;
}

/** 一局 60s 木桩战。 */
function field(roster, st, mode, anchor) {
  const cap = mode?.mvc ? 7 : 8;
  const ids = roster.slice(0, cap);
  const melee = ids.map((id) => chess[id]?.position === 'MELEE');
  if (mode?.mvc) melee.push(false);                    // 外援主 C 是远程主 C，排远程那一档
  const pos = placementOf(melee);
  const units = ids.map((id, i) => ({ chessId: id, row: pos[i][0], col: pos[i][1], items: itemsFor(id, mode) }));
  if (mode?.mvc) units.push(mvcUnit(anchor, pos[units.length], mode));
  // rank ELITE —— 见 tools/infinite-teams.mjs 的注释：让叙拉古 0.5% 最大生命真伤吃 250 万封顶，否则 1e12 木桩单次 50 亿。
  const dummy = enemyRec({ key: 'e_dps', hp: 1e12, speed: 0, mass: 0, atk: 0, rank: 'ELITE' });
  const wall = [];
  for (let r = 9; r <= 11; r++) for (let c = 8; c <= 10; c++) wall.push({ key: dummy.key, pos: [r, c] });
  const h = makeBattle({
    defs: { enemies: { [dummy.key]: dummy } },
    units, enemies: wall,
    timeLimit: 60, autoFinish: false, seed: 7,
    bonds: st,
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, overlimit: true },
  });
  h.step();
  const allies = h.allies();
  // 口径 ③ 的实战自检：真实格子（tileR/tileC）与木桩格求交，必须 0。
  // 只数玩家部署的干员（`kind === 'op'`）：召唤物 / 装置（夕的龙、诗怀雅的陷阱）本来就落在敌人格上，
  // 那是技能效果，不是摆位。
  LAYOUT_BATTLES++;
  for (const u of allies) if (u.kind === 'op' && WALL_KEY.has(u.tileR + ',' + u.tileC)) LAYOUT_OVERLAPS++;
  let physLine = Infinity, artsLine = Infinity;
  for (const u of allies) {
    if (u.kind !== 'op') continue;
    const hp = Number(u.s.maxHp) || 0;
    if (!(hp > 0)) continue;
    const def = Number(u.s.def) || 0;
    const res = Math.min(95, Number(u.s.res) || 0);
    physLine = Math.min(physLine, hp + def);
    artsLine = Math.min(artsLine, hp * 100 / Math.max(5, 100 - res));
  }
  h.run(60);
  const r = h.b.result().perPlayer.p1 || {};
  return { dps: (r.damageDealt || 0) / 60, hps: (r.healingDone || 0) / 60, physLine: physLine === Infinity ? 0 : physLine, artsLine: artsLine === Infinity ? 0 : artsLine, n: allies.length };
}

/** 场上每条盟约的真实携带人数；外援主 C 只给它转职后的盟约 +1。 */
function countsFor(roster, combo, anchor, mode) {
  const counts = {};
  const extra = mode?.mvc ? mvcBondsOf(anchor) : [];
  for (const b of combo) {
    counts[b] = roster.filter((id) => carries(id, b)).length + (extra.includes(b) ? 1 : 0);
  }
  return counts;
}

function runOne(combo, alloc, round, mode = MAIN, anchor = combo[0]) {
  const roster = rosterFor(combo, alloc, mode?.mvc ? 7 : 8);
  const counts = countsFor(roster, combo, anchor, mode);
  const d = field(roster, statesFor(combo, counts, round), mode, anchor);
  return { ...d, counts, roster };
}

// ---- 单条基线：锚自己 8 人（锚 6 格；带 --mvc 时是 7 常驻 + 1 外援），用来画每格小图的虚线基线
const baseline = {};
for (const m of MAJOR) {
  const rounds = {};
  for (const rd of GRID) {
    const r = runOne([m], [6], rd, MAIN, m);
    rounds[rd] = { dps: r.dps, hps: r.hps, physLine: r.physLine, artsLine: r.artsLine, n: r.n, counts: r.counts };
  }
  baseline[m] = rounds;
}

// 搭档排序用单条强度：同为大盟约比 R30 单条，大盟约整体优先于小盟约，小盟约按任务给的顺序
const baseR30 = (id) => baseline[id]?.[30]?.dps ?? 0;
const partnerRank = (a, b) => {
  const am = MAJOR.includes(a), bm = MAJOR.includes(b);
  if (am !== bm) return am ? -1 : 1;
  if (am) return baseR30(b) - baseR30(a);
  return MINOR5.indexOf(a) - MINOR5.indexOf(b);
};

// 9 套分格（锚永远拿第一档 = 主投资；后两档给两条搭档，并把两条搭档的档位互换各试一次，
// 避免「按名字顺序」决定谁拿 3 格——否则一对搭档只要顺序靠后就永远试不到它的最优分格）。
const PATTERNS = (() => {
  const base = [[6, 2, 0], [5, 3, 0], [4, 4, 0], [3, 3, 2], [6, 0, 2], [4, 2, 2]];
  const all = [];
  for (const p of base) { all.push(p); all.push([p[0], p[2], p[1]]); }
  const seen = new Set();
  return all.filter((p) => { const k = p.join('/'); if (seen.has(k)) return false; seen.add(k); return true; });
})();

const t0 = Date.now();
const rows = [];
let done = 0;
const ONLY = ANCHORS_ARG;
const ANCHORS = ONLY || MAJOR;
const TOTAL = ANCHORS.length * 66;
for (const anchor of ANCHORS) {
  const partners = POOL.filter((b) => b !== anchor);
  for (let i = 0; i < partners.length; i++) {
    for (let j = i + 1; j < partners.length; j++) {
      const [p1, p2] = [partners[i], partners[j]].sort(partnerRank);
      const combo = [anchor, p1, p2];
      // 1) 9 套分格，R30 取最优（并列时保留第一套 = 锚拿 6 格）。
      //    必须两条搭档都真的有人上场（counts > 0），否则这套分格只是「锚 + 另一条搭档」的二人转，
      //    名义上的第二条搭档 0 人、等于没交叉（v2 的 6 套分格里也踩过这个坑）。
      let best = null;
      let fallback = null;
      for (const pattern of PATTERNS) {
        const r = runOne(combo, pattern, 30, MAIN, anchor);
        const both = (r.counts[p1] || 0) > 0 && (r.counts[p2] || 0) > 0;
        if (!fallback || r.dps > fallback.dps) fallback = { pattern, dps: r.dps, roster: r.roster, counts: r.counts, r };
        if (!both) continue;
        if (!best || r.dps > best.dps) best = { pattern, dps: r.dps, roster: r.roster, counts: r.counts, r };
      }
      best = best || fallback;
      // 2) 用最优分格跑满 21 点（R30 复用上面的结果）
      const rounds = {};
      for (const rd of GRID) {
        if (rd === 30) {
          rounds[rd] = { dps: best.r.dps, hps: best.r.hps, physLine: best.r.physLine, artsLine: best.r.artsLine, n: best.r.n };
          continue;
        }
        const r = runOne(combo, best.pattern, rd, MAIN, anchor);
        rounds[rd] = { dps: r.dps, hps: r.hps, physLine: r.physLine, artsLine: r.artsLine, n: r.n };
      }
      rows.push({ anchor, partners: [p1, p2], alloc: best.pattern, counts: best.counts, roster: best.roster, rounds });
      done++;
      if (done % 10 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`  ${done}/${TOTAL}  ${el.toFixed(0)}s  预计总 ${(el / done * TOTAL).toFixed(0)}s`);
      }
    }
  }
  console.log('  ' + anchor + ' 完成（66 组）');
}

// ---- 锚内名次（R40 降序；并列按 R30 再按名字，保证确定性）
for (const anchor of ANCHORS) {
  const list = rows.filter((r) => r.anchor === anchor);
  list.sort((a, b) => (b.rounds[40].dps - a.rounds[40].dps)
    || (b.rounds[30].dps - a.rounds[30].dps)
    || a.partners.join('+').localeCompare(b.partners.join('+')));
  list.forEach((r, i) => { r.rank = i + 1; });
}

// ---- 归因消融：每锚 Top1 在「有/无外援」×「有/无金锤」四格里各跑 R10/20/30/40。
// 主口径那一格直接复用扫描结果，另外三格现跑（8 锚 × 3 × 4 = 96 局，成本很小）。
const ABL = [10, 20, 30, 40];
const ablation = {};
if (MVC_SLOT || GOLD_HAMMER) {
  const variants = {
    both: MAIN,
    noMvc: { mvc: false, gold: MAIN.gold },
    noGold: { mvc: MAIN.mvc, gold: false },
    neither: { mvc: false, gold: false },
  };
  for (const anchor of ANCHORS) {
    const top = rows.filter((r) => r.anchor === anchor).sort((a, b) => a.rank - b.rank)[0];
    if (!top) continue;
    const out = {};
    for (const [name, mode] of Object.entries(variants)) {
      const perRound = {};
      for (const rd of ABL) {
        const r = mode === MAIN && rd === 30
          ? { dps: top.rounds[30].dps, n: top.rounds[30].n }
          : runOne([anchor, ...top.partners], top.alloc, rd, mode, anchor);
        perRound[rd] = { dps: r.dps, n: r.n };
      }
      out[name] = perRound;
    }
    ablation[anchor] = { partners: top.partners, alloc: top.alloc, rounds: out };
  }
  console.log('  归因消融完成（' + Object.keys(ablation).length + ' 锚）');
}

const NAME = (id) => bonds[id]?.name || id;
fs.mkdirSync(path.join(ROOT, '.cache', 'o3'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.cache', 'o3', TAG ? `anchor-${TAG}.json` : 'anchor-pairs.json'), JSON.stringify({
  major: MAJOR, minor: MINOR5, grid: GRID, item: ITEM, goldItem: GOLD_ITEM, morph: MORPH,
  mvc: MVC_SLOT ? { slot: MVC_SLOT, pick: MVC_PICK, skill: MVC_SKILL, base: MVC_SLOT_INFO.base, elite: MVC_SLOT_INFO.elite, bonds: backups.diy?.operators?.[MVC_PICK]?.bonds ?? [], anchorItem: ANCHOR_ITEM } : null,
  goldHammer: GOLD_HAMMER,
  poolMode: POOL_MODE, layoutMode: LAYOUT_MODE,
  poolAudit: { rows: POOL_AUDIT.rows.map(({ bond, pool, dupBase, dupChar }) => ({ bond, pool, dupBase, dupChar })), dupBase: POOL_AUDIT.dupBase, dupChar: POOL_AUDIT.dupChar },
  layout: { tiles: LAYOUT_MODE === 'block' ? BLOCK_TILES : null, wall: WALL_TILES, overlaps: LAYOUT_OVERLAPS, battles: LAYOUT_BATTLES },
  baseline, rows, ablation,
  names: Object.fromEntries(Object.keys(bonds).map((k) => [k, bonds[k].name])),
}, null, 0), 'utf8');

// ---- CSV：每行一个锚 × 一对搭档（528 行；--mvc 时多一列 mvc）+ 口径列 split / pool / layout
const head = ['anchor', 'partner1', 'partner2'];
if (MVC_SLOT) head.push('mvc');
head.push('split', 'R10', 'R20', 'R30', 'R40', 'rank', 'pool', 'layout');
const lines = [head.join(',')];
for (const anchor of ANCHORS) {
  for (const r of rows.filter((x) => x.anchor === anchor).sort((a, b) => a.rank - b.rank)) {
    const mid = [anchor, r.partners[0], r.partners[1]];
    if (MVC_SLOT) mid.push(MVC_SLOT);
    mid.push(r.alloc.join('/'));
    lines.push([...mid,
      Math.round(r.rounds[10].dps), Math.round(r.rounds[20].dps), Math.round(r.rounds[30].dps), Math.round(r.rounds[40].dps), r.rank,
      POOL_MODE, LAYOUT_MODE].join(','));
  }
}
const CSV_OUT = path.join(ROOT, 'handoff', TAG ? `overlimit-anchor-${TAG}.csv` : 'overlimit-anchor-best-pairs.csv');
if (ONLY) console.log('  [部分运行] 不写 ' + path.relative(ROOT, CSV_OUT));
else fs.writeFileSync(CSV_OUT, lines.join('\n') + '\n', 'utf8');

// ---- 跑完再打一次三处口径自检（摆位是逐场实测计数，不是启动时的一次性推断）
console.log('\n== 三处口径自检（跑完复核）==');
console.log('  ① tier：tierFor 断言通过（' + POOL.length + ' 条盟约 × 0–8 人 + ' + 15 + ' 个手写用例）');
console.log('  ② 池子：' + POOL_MODE + '，合计 ' + POOL_AUDIT.rows.reduce((n, r) => n + r.pool, 0)
  + ' 名，重复 baseId = ' + POOL_AUDIT.dupBase + '，重复干员(charId) = ' + POOL_AUDIT.dupChar);
console.log('  ③ 摆位：' + LAYOUT_MODE + '，' + LAYOUT_BATTLES + ' 场战斗里与木桩格重合的单位数 = ' + LAYOUT_OVERLAPS);
if (LAYOUT_MODE === 'block' && LAYOUT_OVERLAPS !== 0) throw new Error('摆位实战断言失败：' + LAYOUT_OVERLAPS + ' 个单位站在木桩格上');

// ---- 控制台摘要
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
for (const anchor of ANCHORS) {
  const list = rows.filter((r) => r.anchor === anchor).sort((a, b) => a.rank - b.rank);
  const bas = baseline[anchor][40].dps;
  console.log('\n== ' + NAME(anchor) + ' (' + anchor + ')  基线 ' + fmt(bas) + ' ==');
  for (const r of list.slice(0, 5)) {
    console.log('  #' + r.rank + '  ' + (NAME(r.partners[0]) + ' + ' + NAME(r.partners[1])).padEnd(24)
      + ' R10=' + fmt(r.rounds[10].dps).padStart(8) + ' R20=' + fmt(r.rounds[20].dps).padStart(8)
      + ' R30=' + fmt(r.rounds[30].dps).padStart(8) + ' R40=' + fmt(r.rounds[40].dps).padStart(8)
      + '  分格 ' + r.alloc.join('/'));
  }
  for (const r of list.slice(-3)) {
    console.log('  #' + r.rank + '  ' + (NAME(r.partners[0]) + ' + ' + NAME(r.partners[1])).padEnd(24)
      + ' R40=' + fmt(r.rounds[40].dps).padStart(8) + '  分格 ' + r.alloc.join('/'));
  }
}
console.log('\n528 组完成，总耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
