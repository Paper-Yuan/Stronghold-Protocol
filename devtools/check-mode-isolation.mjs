#!/usr/bin/env node
// devtools/check-mode-isolation.mjs — 全模式矩阵：每个模式「能看到的池子 = 它应有的精确集合」。
//
// 与 devtools/check-zhajing-isolation.mjs 的分工（两个都要跑）：
//   * check-zhajing-isolation.mjs —— **深查**：把 zj 记录从数据里剥掉，官方 11 个 mode 的视图与基线**逐字节**比，
//     回答「炸惊有没有漏进官方」。它只管炸惊。
//   * check-mode-isolation.mjs（本文件）—— **全矩阵**：每个 mode 一行（training / 官方 8 / 湮灭 2 / 炸惊 2），
//     各自的池子尺寸与专属字段 + 三条方向性断言（只有湮灭有藏品与毒雾、只有炸惊有惊变与白值膨胀、官方四档互相同构），
//     外加 data/versions/*（3 个历史版本目录 + 缺省版本）不得长出任何玩法包字段。
//   判据来源：handoff/ZHAJING-COVERAGE.md（验收矩阵）、handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2。
//   node --test 形态见 test/match/mode-isolation-matrix.test.js（同一套判据）。
//
// 用法：node devtools/check-mode-isolation.mjs        （exit 1 = 有越界；矩阵表打到 stdout）
import fs from 'node:fs';
import path from 'node:path';
import { getData, loadData, versionDataDir, VERSION_DATA_FILES, ROOT } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { DIFFICULTIES, modeIdFor } from '../shared/constants.js';
import { SOLO_INFINITE, COOP_INFINITE } from '../shared/infiniteMode.js';
import { DEFAULT_VERSION, VERSIONS } from '../shared/versions.js';

const data = getData();
const modes = data.config?.modes || {};

/** The data with every 炸惊 record removed — what every non-ZHAJING mode must look like (same stripping as the deep check). */
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
const pool = (g) => Object.entries(g.shopItemsByTier).flatMap(([t, ids]) => ids.map((id) => `${t}:${id}`)).sort();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const gates = (g) => [g.zhajing ? 'zhajing' : null, g.annihilation ? 'annihilation' : null, g.jibian() ? 'jibian' : null,
  g.enemyJibian() ? 'enemyJibian' : null, g.allyScale ? 'allyScale' : null, Array.isArray(g.zjCombos) ? 'zjCombos' : null]
  .filter(Boolean).join('+') || '—';

let bad = 0;
const fails = [];
const warns = [];
const fail = (modeId, m) => { bad++; fails.push(`${modeId}: ${m}`); };
const warn = (m) => warns.push(m);

/** The 炸惊 roster as gamedata.js documents its filter, **including the pack's grantOnly rule** (`重岳只能由「祀」策略发放，不进卡池/商店`). */
const zjRoster = Object.keys(data.chess).filter((id) => {
  const c = data.chess[id];
  return c.zhajing === true && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true && Number.isInteger(c.tier);
}).sort();
/** The official roster as the same filter reads it for a non-ZHAJING mode. */
const officialRoster = (d) => Object.keys(d.chess).filter((id) => {
  const c = d.chess[id];
  return c.visible === true && c.zhajing !== true && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
}).sort();
/** 湮灭名册 = 官方名册 + 内容 mod 自带的干员位（`annihilation: true`，默认两条 mod 开）。 */
const annRoster = (d) => [...officialRoster(d), ...Object.keys(d.chess).filter((id) => {
  const c = d.chess[id];
  return c.annihilation === true && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true && Number.isInteger(c.tier);
})].sort();

const rows = [];
const built = {};

for (const modeId of Object.keys(modes).sort()) {
  const mode = modes[modeId];
  const kind = kindOf(mode);
  const g = new GameData(data, modeId);
  built[modeId] = g;
  const gb = new GameData(bare, modeId);
  const sp = g.spRounds();
  const stages = Array.isArray(mode.stages) ? mode.stages : [];

  rows.push({
    modeId, kind, difficulty: g.difficulty,
    chess: g.visibleChess.length, items: pool(g).length, bands: g.bandIds().length, bonds: g.bondIds.length,
    stages: stages.length, sp: sp.length,
    relic: g.annihilation ? 'Y' : '—', fog: g.annihilation?.fog ? 'Y' : '—',
    jibian: g.jibian()?.pool?.length ?? '—',
    ally: g.allyScale ? `${g.allyScale.hp}/${g.allyScale.def}/${g.allyScale.atk}` : '—',
    gates: gates(g),
  });

  // ---- A. 非炸惊模式：zj 记录一条都不许到（与深查同源的三个标记 + 五个门）
  if (kind !== 'zhajing') {
    const zjChess = g.visibleChess.filter((id) => data.chess[id]?.zhajing === true);
    if (zjChess.length) fail(modeId, `${zjChess.length} 条 zhajing 棋进了 visibleChess（${zjChess.slice(0, 3).join(',')}）`);
    const zjItems = pool(g).filter((k) => data.items[k.split(':')[1]]?.zjOnly === true);
    if (zjItems.length) fail(modeId, `${zjItems.length} 条 zjOnly 道具进了商店池`);
    const zjBands = g.bandIds().filter((id) => data.bands[id]?.zjOnly === true);
    if (zjBands.length) fail(modeId, `zjOnly 策略进了 bandIds（${zjBands.join(',')}）`);
    const zjBonds = g.bondIds.filter((id) => data.bonds[id]?.zjOnly === true);
    if (zjBonds.length) fail(modeId, `zjOnly 盟约进了 bondIds（${zjBonds.join(',')}）`);
    const leaked = g.bondIds.filter((id) => g.bond(id) && Object.hasOwn(g.bond(id), 'zj'));
    if (leaked.length) fail(modeId, `${leaked.length} 条盟约把 zj 覆盖块漏给了客户端`);
    for (const [name, v] of [['gd.zhajing', g.zhajing], ['gd.jibian()', g.jibian()], ['gd.enemyJibian()', g.enemyJibian()],
      ['gd.allyScale', g.allyScale], ['gd.zjCombos', g.zjCombos], ['gd.bondLayerCap', g.bondLayerCap], ['gd.spPhaseKinds()', g.spPhaseKinds()]]) {
      if (v !== null && v !== false) fail(modeId, `${name} 非空（应为 null/false）`);
    }
    // 特殊阶段只能是 choices.json 的普通家族：官方/湮灭永远不返回 'jibian'
    for (const r of sp) if (g.spPhaseKind(r) !== null) fail(modeId, `spPhaseKind(${r}) = ${g.spPhaseKind(r)}（非炸惊必须 null）`);
  }

  // ---- B. 官方 8 + 训练：池子与「剥掉 zj」的基线逐项相等
  if (kind === 'official' || kind === 'training') {
    if (!eq(g.visibleChess, gb.visibleChess)) fail(modeId, `visibleChess ${g.visibleChess.length} ≠ 基线 ${gb.visibleChess.length}`);
    if (!eq(g.visibleChess, officialRoster(data))) fail(modeId, `visibleChess ≠ 精确官方名册（${officialRoster(data).length} 条）`);
    if (!eq(pool(g), pool(gb))) fail(modeId, `shopItemsByTier ${pool(g).length} ≠ 基线 ${pool(gb).length}`);
    if (!eq(g.bandIds(), gb.bandIds())) fail(modeId, `bandIds ${g.bandIds().length} ≠ 基线 ${gb.bandIds().length}`);
    if (!eq(g.bondIds, gb.bondIds)) fail(modeId, `bondIds ${g.bondIds.length} ≠ 基线 ${gb.bondIds.length}`);
    for (const id of gb.bondIds) if (!eq(g.bond(id), gb.bond(id))) { fail(modeId, `盟约 ${id} 与基线不同`); break; }
    if (!eq(g.bans(g.difficulty), gb.bans(gb.difficulty))) fail(modeId, 'bans 与基线不同');
    if (!eq(g.bossWeights(false), gb.bossWeights(false))) fail(modeId, 'bossWeights 与基线不同');
    const want = data.config?.bans?.[g.difficulty];
    if (want && !eq(g.bans(g.difficulty), { core: want.core, addon: want.addon })) fail(modeId, `bans ≠ config.bans.${g.difficulty}`);
    if (g.annihilation) fail(modeId, 'gd.annihilation 非 null（官方模式不许有藏品/毒雾）');
    if (g.annihilationFlags('normal', 1) !== null) fail(modeId, 'annihilationFlags() 非 null');
    // spRounds / stages 必须就是该 mode 记录里的那张表
    if (!eq(sp, (mode.spRounds || []).filter((n) => Number.isInteger(n)))) fail(modeId, `spRounds ${JSON.stringify(sp)} ≠ mode 记录`);
    if (!stages.length) fail(modeId, 'stages 为空');
  }

  // ---- C. 湮灭：有藏品 + 毒雾；没有炸惊的门
  if (kind === 'annihilation') {
    if (!g.annihilation) fail(modeId, 'gd.annihilation 为 null（湮灭必须有藏品/毒雾门）');
    if (!g.annihilation?.fog) fail(modeId, 'gd.annihilation.fog 为 null（毒雾配置丢了）');
    if (!g.annihilationFlags('normal', 1)) fail(modeId, 'annihilationFlags() 为 null');
    if (!eq(g.visibleChess, gb.visibleChess)) fail(modeId, 'visibleChess 与 zj-free 基线不同（湮灭不该受 zj 影响）');
    if (!eq(g.visibleChess, annRoster(data))) fail(modeId, `visibleChess ≠ 官方名册 + mod 自带的 13 个干员位（${annRoster(data).length} 条）`);
    if (!eq(pool(g), pool(gb))) fail(modeId, 'shopItemsByTier 与基线不同');
    if (!eq(g.bondIds, gb.bondIds)) fail(modeId, 'bondIds 与基线不同');
    // 蚀流 1 的 bans 由豁免池算出（ceil(total/3)，下限 5），不是 config.bans 的固定值
    const core = g.bondIds.filter((id) => g.bond(id)?.isCore).length;
    const addon = g.bondIds.filter((id) => { const b = g.bond(id); return b && !b.isCore && id !== 'suntShip'; }).length;
    const count = (n) => Math.max(5, Math.ceil(n / 3));
    if (!eq(g.bans(g.difficulty), { core: count(core), addon: count(addon) })) fail(modeId, `bans 不是蚀流 1 公式的结果（${JSON.stringify(g.bans(g.difficulty))}）`);
    // 湮灭的特殊阶段是数据派生的奇数回合
    const end = g.hiddenRound || g.lastRound + 1;
    const want = []; for (let r = 3; r < end; r += 2) want.push(r);
    if (!eq(sp, want)) fail(modeId, `spRounds ${JSON.stringify(sp)} ≠ 派生 ${JSON.stringify(want)}`);
  }

  // ---- D. 炸惊：棋库/惊变/白值膨胀都在，且互不越界
  if (kind === 'zhajing') {
    if (!g.zhajing) fail(modeId, 'gd.zhajing 不为 true');
    if (g.annihilation) fail(modeId, 'gd.annihilation 非 null（炸惊不该有藏品/毒雾）');
    if (!eq(g.visibleChess, zjRoster)) {
      const extra = g.visibleChess.filter((id) => !zjRoster.includes(id));
      const miss = zjRoster.filter((id) => !g.visibleChess.includes(id));
      const grantOnly = extra.filter((id) => data.chess[id]?.grantOnly === true);
      if (grantOnly.length) {
        fail('KNOWN-BUG', `${modeId}: ${grantOnly.length} 条 grantOnly 记录进了炸惊棋库（${grantOnly.join(',')}）—— `
          + '数据仍标 `grantOnly:true`（只由「祀」/自选发放，不进卡池/商店），而 server/match/gamedata.js:204-208 的 visibleChess 过滤已经没有 grantOnly 这一条'
          + '（包内 0.3.1 有；本仓全代码 grantOnly 0 引用）');
      }
      if (extra.length !== grantOnly.length) fail(modeId, `visibleChess 多了 ${extra.filter((x) => !grantOnly.includes(x)).length} 条非 grantOnly 记录：${extra.filter((x) => !grantOnly.includes(x)).join(',')}`);
      if (miss.length) fail(modeId, `visibleChess 少了 ${miss.length} 条：${miss.join(',')}`);
    }
    const stray = g.visibleChess.filter((id) => data.chess[id]?.zhajing !== true);
    if (stray.length) fail(modeId, `${stray.length} 条官方棋混进炸惊棋库（${stray.slice(0, 3).join(',')}）`);
    const jb = g.jibian();
    const ej = g.enemyJibian();
    if (!jb?.pool?.length) fail(modeId, 'gd.jibian() 池为空');
    if (!ej?.pool?.length) fail(modeId, 'gd.enemyJibian() 池为空');
    if (!g.allyScale) fail(modeId, 'gd.allyScale 为 null（白值膨胀丢了）');
    if (!Array.isArray(g.zjCombos)) fail(modeId, 'gd.zjCombos 不是数组（装备组合激活盟约丢了）');
    if (g.bondLayerCap !== 9999) fail(modeId, `gd.bondLayerCap=${g.bondLayerCap}（应为 9999）`);
    const merged = g.bondIds.filter((id) => data.bonds[id]?.zj && !eq(g.bond(id), data.bonds[id]));
    if (!merged.length) fail(modeId, '盟约 zj 覆盖块一条都没合并');
    if (!pool(g).some((k) => data.items[k.split(':')[1]]?.zjOnly === true)) fail(modeId, 'zjOnly 道具没进炸惊商店池');
    if (!g.bandIds().some((id) => data.bands[id]?.zjOnly === true)) fail(modeId, 'zjOnly 策略没进炸惊策略池');
    // spRounds 与 spPhaseKinds 必须一一对齐（漏写 spRounds 会从 kind 表派生，这条钉住两边一致）
    const want = Object.keys(g.spPhaseKinds()).map(Number).sort((a, b) => a - b);
    if (!eq(sp, want)) fail(modeId, `spRounds ${JSON.stringify(sp)} ≠ spPhaseKinds 的键 ${JSON.stringify(want)}`);
    const kindsSeen = new Set(sp.map((r) => g.spPhaseKind(r)));
    for (const k of kindsSeen) if (!['jibian', 'express', 'bountyHigh'].includes(k)) fail(modeId, `spPhaseKind 出现未知家族 ${k}`);
  }
}

// ---------- 方向性断言 ----------
const idsOf = (k) => Object.entries(built).filter(([, g]) => kindOf(g.mode) === k).map(([id]) => id).sort();
{
  const withAnn = Object.entries(built).filter(([, g]) => g.annihilation).map(([id]) => id).sort();
  if (!eq(withAnn, idsOf('annihilation'))) fail('DIRECTION', `有 annihilation 门的 mode 集合 ≠ 湮灭两个：${withAnn.join(',')}`);
  const withJib = Object.entries(built).filter(([, g]) => g.zhajing || g.jibian() || g.allyScale).map(([id]) => id).sort();
  if (!eq(withJib, idsOf('zhajing'))) fail('DIRECTION', `有惊变/白值/棋库门的 mode 集合 ≠ 炸惊两个：${withJib.join(',')}`);
  const official = idsOf('official').concat(idsOf('training'));
  for (const id of official) {
    const g = built[id];
    if (g.annihilation || g.zhajing || g.jibian() || g.allyScale || g.zjCombos) fail('DIRECTION', `${id}: 官方模式长出了玩法包字段`);
  }
}

// 官方四档互相同构：SINGLE×4 与 MULTI×4 各自逐字节相同；跨房型的差异只允许来自 modeTypeList 与 mode 记录字段
const officialIds = Object.keys(modes).filter((id) => kindOf(modes[id]) === 'official').sort();
const VIEW = (g) => ({
  chess: g.visibleChess, items: pool(g), bands: g.bandIds(), bonds: g.bondIds,
  bondRecords: g.bondIds.map((id) => g.bond(id)), bossWeights: g.bossWeights(false),
});
for (const type of ['SINGLE', 'MULTI']) {
  const ids = officialIds.filter((id) => modes[id].type === type);
  const ref = built[ids[0]];
  for (const id of ids.slice(1)) {
    if (!eq(VIEW(built[id]), VIEW(ref))) fail('ISO', `${ids[0]} vs ${id}: 视图不同（${Object.keys(VIEW(ref)).filter((k) => !eq(VIEW(built[id])[k], VIEW(ref)[k])).join(',')}）`);
  }
  // 隐藏 Boss 权重：只有配了 hiddenRound 的难度才有；FUNNY 必须是空
  const withHidden = ids.filter((id) => modes[id].hiddenRound != null);
  const noHidden = ids.filter((id) => modes[id].hiddenRound == null);
  for (const id of noHidden) if (built[id].bossWeights(true).length) fail('ISO', `${id}: 没有 hiddenRound 却列出了隐藏 Boss 权重`);
  if (withHidden.length > 1) {
    const w0 = built[withHidden[0]].bossWeights(true);
    for (const id of withHidden.slice(1)) if (!eq(built[id].bossWeights(true), w0)) fail('ISO', `${withHidden[0]} vs ${id}: 隐藏 Boss 权重不同`);
  }
}
{
  const solo = built[officialIds.find((id) => modes[id].type === 'SINGLE')];
  const coop = built[officialIds.find((id) => modes[id].type === 'MULTI')];
  for (const [name, a, b] of [['visibleChess', solo.visibleChess, coop.visibleChess], ['shopItemsByTier', pool(solo), pool(coop)], ['bondIds', solo.bondIds, coop.bondIds]]) {
    if (!eq(a, b)) fail('ISO', `官方 solo 与 coop 的 ${name} 不同（不应发生）`);
  }
  const soloOnly = solo.bandIds().filter((x) => !coop.bandIds().includes(x));
  const coopOnly = coop.bandIds().filter((x) => !solo.bandIds().includes(x));
  const explained = (list, otherType) => list.every((b) => Array.isArray(data.bands[b]?.modeTypeList) && !data.bands[b].modeTypeList.includes(otherType));
  if (!explained(soloOnly, 'MULTI')) fail('ISO', `solo 独有策略 ${soloOnly.join(',')} 不是 modeTypeList 解释的`);
  if (!explained(coopOnly, 'SINGLE')) fail('ISO', `coop 独有策略 ${coopOnly.join(',')} 不是 modeTypeList 解释的`);
  rows.push({ modeId: '(solo↔coop)', kind: 'diff', difficulty: '—', chess: 0, items: 0, bands: soloOnly.length + coopOnly.length, bonds: 0, stages: 0, sp: 0, relic: '—', fog: '—', jibian: '—', ally: '—', gates: `只允许策略差异：solo +${soloOnly.length} / coop +${coopOnly.length}` });
}

// 超限房：房间级开关，推出的 modeId 必须与 base 房型一致，且模式记录不长 infinite 键
{
  const seen = new Set();
  for (const roomMode of [SOLO_INFINITE, COOP_INFINITE]) {
    for (const d of DIFFICULTIES) {
      const modeId = modeIdFor(roomMode, d);
      const baseId = modeIdFor(roomMode === SOLO_INFINITE ? 'solo' : 'coop', d);
      if (modeId !== baseId) fail('INFINITE', `${roomMode}/${d} → ${modeId}，base 房型给的是 ${baseId}`);
      if (!modes[modeId]) fail('INFINITE', `${modeId} 不在 data/config.json 里`);
      else if (Object.hasOwn(modes[modeId], 'infinite')) fail('INFINITE', `${modeId} 的模式记录长了 infinite 键`);
      seen.add(modeId);
    }
  }
  rows.push({ modeId: '(infinite×4×2)', kind: 'room-flag', difficulty: '—', chess: 0, items: 0, bands: 0, bonds: 0, stages: 0, sp: 0, relic: '—', fog: '—', jibian: '—', ally: '—', gates: `modeId 与 base 相同（${seen.size} 个）` });
}

// ---------- data/versions/*：历史版本目录不得长出任何玩法包字段 ----------
// 缺省版本（act2autochess）就是 data/*.json 本身 —— zj/湮灭的记录**按设计**带标记留在里面，
// 隔离由 gd 的过滤器保证（上面的 A/B/C/D 已经把这件事钉死了）。所以这条规则只对**版本目录**生效。
const versionRows = [];
for (const v of VERSIONS) {
  const dir = versionDataDir(v.id);
  const isDefault = v.id === DEFAULT_VERSION;
  let vd;
  try {
    vd = isDefault ? data : loadData(dir, { expected: VERSION_DATA_FILES });
  } catch (e) {
    fail(v.id, `loadData 失败：${e.message}`);
    continue;
  }
  const vmodes = vd.config?.modes || {};
  let builtModes = 0;
  for (const modeId of Object.keys(vmodes)) {
    const g = new GameData(vd, modeId);
    builtModes++;
    // 缺省版本就是 data/*.json：它按设计带 4 个玩法包 mode，只要求官方/训练模式不长出玩法包字段。
    if (isDefault) {
      if (!vmodes[modeId].jibian && !vmodes[modeId].annihilation && (g.zhajing || g.jibian() || g.allyScale || g.zjCombos || g.annihilation)) {
        fail(v.id, `${modeId}: 官方模式拿到了玩法包门`);
      }
      continue;
    }
    if (g.zhajing || g.jibian() || g.allyScale || g.zjCombos) fail(v.id, `${modeId}: 版本模式拿到了炸惊门`);
    if (g.annihilation) fail(v.id, `${modeId}: 版本模式拿到了湮灭门`);
  }
  const zjChess = Object.values(vd.chess || {}).filter((r) => r && r.zhajing === true).length;
  const zjItems = Object.values(vd.items || {}).filter((r) => r && r.zjOnly === true).length;
  const zjBands = Object.values(vd.bands || {}).filter((r) => r && r.zjOnly === true).length;
  const zjBonds = Object.values(vd.bonds || {}).filter((r) => r && (r.zjOnly === true || r.zj)).length;
  const mirror = fs.existsSync(path.join(dir, 'jibianBonds.json'));
  if (!isDefault) {
    const badModes = Object.entries(vmodes).filter(([, m]) => m.jibian || m.annihilation || m.allyScale).map(([id]) => id);
    if (badModes.length) fail(v.id, `版本数据里有玩法包专属字段的 mode：${badModes.join(',')}`);
    if (zjChess || zjItems || zjBands || zjBonds) fail(v.id, `版本数据里有 zj 记录（chess ${zjChess} / items ${zjItems} / bands ${zjBands} / bonds ${zjBonds}）`);
    if (mirror) fail(v.id, '版本目录里有 jibianBonds.json');
  }
  versionRows.push({
    id: v.id, dir: path.relative(ROOT, dir).split(path.sep).join('/') || '.', isDefault, modes: builtModes,
    chess: Object.keys(vd.chess || {}).length, zj: zjChess + zjItems + zjBands + zjBonds, mirror,
    playSetModes: Object.keys(vmodes).filter((id) => vmodes[id].jibian || vmodes[id].annihilation).length,
  });
}

// ---------- 数据健壮性提醒（不算隔离越界，但要有人认领） ----------
{
  const unreachable = Object.keys(data.chess).filter((id) => id.startsWith('chess_zj_') && !data.chess[id].isGolden && data.chess[id].zhajing !== true);
  if (unreachable.length) warn(`${unreachable.length} 条 chess_zj_* 记录 \`zhajing:false\`：既不在炸惊棋库也不在官方名册，任何模式都抽不到（包内同样如此）：${unreachable.join(',')}`);
}

// ---------- 打印矩阵 ----------
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log(`data: ${Object.keys(data.chess).length} chess / ${Object.keys(data.items).length} items / ${Object.keys(data.bands).length} bands / ${Object.keys(data.bonds).length} bonds`);
console.log(`炸惊棋库 ${zjRoster.length} 条（zhajing:true 的非精锐记录）；官方名册 ${officialRoster(data).length} 条\n`);
console.log(pad('mode', 28) + pad('kind', 12) + pad('diff', 14) + num('chess', 6) + num('items', 7) + num('bands', 7) + num('bonds', 7) + num('stages', 7) + num('spR', 5) + num('relic', 7) + num('fog', 5) + num('jibian', 8) + num('ally', 12) + '  gates');
console.log('-'.repeat(150));
for (const r of rows) {
  console.log(pad(r.modeId, 28) + pad(r.kind, 12) + pad(r.difficulty, 14) + num(r.chess, 6) + num(r.items, 7) + num(r.bands, 7) + num(r.bonds, 7) + num(r.stages, 7) + num(r.sp, 5) + num(r.relic, 7) + num(r.fog, 5) + num(r.jibian, 8) + num(r.ally, 12) + '  ' + r.gates);
}
console.log('\n版本数据（data/versions/*；缺省版本 = data/*，zj 记录按设计留在里面）：');
console.log(pad('version', 26) + pad('dir', 34) + pad('default', 9) + num('modes', 7) + num('chess', 7) + num('zj', 5) + num('playset', 9) + '  jibianBonds.json');
for (const v of versionRows) console.log(pad(v.id, 26) + pad(v.dir, 34) + pad(v.isDefault ? 'yes' : '—', 9) + num(v.modes, 7) + num(v.chess, 7) + num(v.zj, 5) + num(v.playSetModes, 9) + '  ' + (v.mirror ? 'EXISTS' : '—'));

if (warns.length) {
  console.log(`\n=== 提醒 ${warns.length} 条（不算越界）===`);
  for (const w of warns) console.log('  ⚠ ' + w);
}
if (bad) {
  console.log(`\n=== 越界 ${bad} 处 ===`);
  for (const f of fails) console.log('  ✖ ' + f);
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log('\nRESULT: OK — 每个模式的池子都等于它应有的集合；只有湮灭有藏品/毒雾，只有炸惊有惊变/白值膨胀，官方四档互相同构，版本目录无玩法包字段');
