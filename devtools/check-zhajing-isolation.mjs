#!/usr/bin/env node
// devtools/check-zhajing-isolation.mjs — 炸惊模拟 (ZHAJING) 的隔离自查。
//
// 一句话题目：**把 zj 记录从数据里删掉，官方每个模式的视图应当逐字节不变。**
//
// 为什么需要它：炸惊不是独立数据集，它是同一份 data/*.json 里带标记的记录（`chess.zhajing: true` /
// `items|bands|bonds.zjOnly: true` / 盟约的 `zj` 覆盖块，见 handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2）。
// 隔离靠的是每个收集器都按标记过滤，而**漏一处不会报错**——只是官方模式悄悄多出一批卡 / 一件装备 / 一条策略。
// 这个脚本把「剥离后的基线」与「真实数据」两个 `GameData` 并排比，任何一处漏过滤都会在这里红。
//
// 四组检查：
//   A. 官方 11 个 mode：`visibleChess` / `shopItemsByTier` / `bondIds`（含逐条 `bond()`）/ `bans` / `bossWeights`
//      与「剥掉 zj 记录」的基线**逐字节相同**；
//   B. 官方 mode 拿不到任何 zj 记录（`zhajing` 棋、`zjOnly` 道具、`zjOnly` 盟约、`zj` 键）；
//   C. ZHAJING 两个 mode：roster 只含 zj 棋、惊变池非空、盟约覆盖已合并、`allyScale` 在；
//   D. data/versions/*（官方历史版本）里 0 条 zj 记录（进了就会改它们的 `cs`，所有版本房存档/回放失效）。
//
// 用法：node devtools/check-zhajing-isolation.mjs    （exit 1 = 隔离破了）
//
// 姊妹脚本：devtools/check-mode-isolation.mjs —— **全矩阵**版（每个 mode 一行：棋库/道具/策略/盟约/藏品/毒雾/惊变/白值，
// 外加「只有湮灭有藏品与毒雾」「只有炸惊有惊变与白值膨胀」「官方四档互相同构」三条方向性断言，以及 3 个版本目录）。
// 本文件管**炸惊 vs 官方**的逐字节深查，那边管**全模式两两之间**的集合与门；两个都要跑。
// node --test 形态：test/match/mode-isolation-matrix.test.js。
import fs from 'node:fs';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';

const data = getData();

/** The same data with every 炸惊 record removed — what the official modes must look like. */
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

const OFFICIAL = [
  'mode_training_1', 'mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss',
  'mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss',
  'mode_single_annihilation', 'mode_multi_annihilation',
];
const ZHAJING = ['mode_single_zhajing', 'mode_multi_zhajing'];

let bad = 0;
const fail = (m) => { bad++; console.log('  ✖ ' + m); };
const ok = (m) => console.log('  ✔ ' + m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== A. 官方模式：真实数据 vs 剥掉 zj 记录的基线 ===');
for (const modeId of OFFICIAL) {
  if (!data.config?.modes?.[modeId]) { console.log(`  (skip ${modeId}: not in this data set)`); continue; }
  const a = new GameData(data, modeId);
  const b = new GameData(bare, modeId);
  const rows = [];
  if (!eq(a.visibleChess, b.visibleChess)) rows.push(`visibleChess ${a.visibleChess.length} vs ${b.visibleChess.length}`);
  const pool = (g) => Object.values(g.shopItemsByTier).flat().sort().join();
  if (pool(a) !== pool(b)) rows.push('shopItemsByTier pool');
  if (a.bondIds.join() !== b.bondIds.join()) rows.push('bondIds');
  for (const id of b.bondIds) {
    if (!eq(a.bond(id), b.bond(id))) { rows.push(`bond ${id} differs`); break; }
  }
  if (!eq(a.bans(a.difficulty), b.bans(b.difficulty))) rows.push('bans');
  if (!eq(a.bossWeights(false), b.bossWeights(false))) rows.push('bossWeights');
  if (rows.length) { console.log(`  ${modeId}:`); rows.forEach((r) => fail(r)); }
  else ok(`${modeId} 逐字节相同（visible ${a.visibleChess.length} / bonds ${a.bondIds.length}）`);
}

console.log('\n=== B. 官方模式拿不到任何 zj 记录 ===');
{
  const before = bad;
  for (const modeId of OFFICIAL) {
    if (!data.config?.modes?.[modeId]) continue;
    const g = new GameData(data, modeId);
    const leakedChess = g.visibleChess.filter((id) => data.chess[id]?.zhajing === true);
    if (leakedChess.length) fail(`${modeId}: ${leakedChess.length} 条 zhajing 棋进了 visibleChess（如 ${leakedChess[0]}）`);
    const leakedItems = Object.values(g.shopItemsByTier).flat().filter((id) => data.items[id]?.zjOnly === true);
    if (leakedItems.length) fail(`${modeId}: ${leakedItems.length} 条 zjOnly 道具进了商店池`);
    const leakedBonds = g.bondIds.filter((id) => data.bonds[id]?.zjOnly === true);
    if (leakedBonds.length) fail(`${modeId}: zjOnly 盟约进了 bondIds（${leakedBonds.join(',')}）`);
    const leakedZj = g.bondIds.filter((id) => g.bond(id) && Object.hasOwn(g.bond(id), 'zj'));
    if (leakedZj.length) fail(`${modeId}: ${leakedZj.length} 条盟约把 zj 覆盖块漏给了客户端`);
  }
  if (bad === before) ok('没有一条 zj 记录能从官方模式走到');
}

console.log('\n=== C. ZHAJING 两个模式 ===');
for (const modeId of ZHAJING) {
  if (!data.config?.modes?.[modeId]) { fail(`${modeId}: 不在 data/config.json 里`); continue; }
  const g = new GameData(data, modeId);
  console.log(`  ${modeId}: difficulty=${g.difficulty} zhajing=${g.zhajing} lastRound=${g.lastRound} bossRound=${g.bossRound}`);
  console.log(`    visibleChess=${g.visibleChess.length}`);
  if (!g.zhajing) fail(`${modeId}: gd.zhajing 不是 true`);
  if (!g.visibleChess.length) fail(`${modeId}: roster 为空`);
  const stray = g.visibleChess.filter((id) => data.chess[id]?.zhajing !== true);
  if (stray.length) fail(`${modeId}: ${stray.length} 条官方棋混进了 zj roster（如 ${stray[0]}）`);
  const jb = g.jibian?.();
  const ej = g.enemyJibian?.();
  console.log(`    jibian pool=${jb?.pool?.length ?? 'null'} / enemyJibian pool=${ej?.pool?.length ?? 'null'} / rounds=${JSON.stringify(ej?.rounds)}`);
  if (!jb?.pool?.length) fail(`${modeId}: 惊变池为空（整备侧的 3 选 1 会永远抽不到卡）`);
  const merged = g.bondIds.filter((id) => data.bonds[id]?.zj && !eq(g.bond(id), data.bonds[id]));
  console.log(`    已合并 zj 覆盖块的盟约：${merged.length}`);
  if (!merged.length) fail(`${modeId}: 盟约 zj 覆盖层没合并`);
  console.log(`    allyScale=${JSON.stringify(g.allyScale)}`);
  if (!g.allyScale) fail(`${modeId}: allyScale 缺失`);
}

console.log('\n=== D. data/versions/*（官方历史版本）不得有 zj 记录 ===');
{
  const dirs = fs.existsSync('data/versions') ? fs.readdirSync('data/versions') : [];
  if (!dirs.length) console.log('  （没有 data/versions 目录）');
  for (const d of dirs) {
    const p = `data/versions/${d}/chess.json`;
    if (!fs.existsSync(p)) { console.log(`  ${d}: 没有 chess.json`); continue; }
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    const zj = Object.values(m).filter((r) => r && r.zhajing === true).length;
    const hasMirror = fs.existsSync(`data/versions/${d}/jibianBonds.json`);
    if (zj || hasMirror) fail(`${d}: ${zj} 条 zhajing 棋 / jibianBonds.json ${hasMirror ? '存在' : '不存在'}`);
    else ok(`${d}: 0 条 zj 记录（${Object.keys(m).length} 条 chess）`);
  }
}

console.log(bad ? `\nFAILED: ${bad} 处隔离破损` : '\nOK: 隔离成立（官方模式逐字节不变，ZHAJING 自成一池）');
process.exit(bad ? 1 : 0);
