#!/usr/bin/env node
// tools/extract-annihilation-mods.mjs — 湮灭专属 mod 的数据抽取：modref/mods/** → docs/research/20-annihilation-mods.json。
//
// WHAT THIS IS. 8 个"湮灭专属" workshop 包里，只有 3 个带值得进本仓数据的**数据**；另外 5 个只声明 behaviour 开关
// （本仓 shared/plugins/rules.js 已经有那四个开关），数据侧不搬。三个数据包各管一段：
//
//   egir-buff/     bonds.json  阿戈尔(egirShip)的**文案覆盖**：生命值公式 (35+1×层数)% 的说明、新增「战斗开始时按当前
//                              层数获得基础面板攻击力」、5 名那一档的「首次被击倒立刻复活并+50 攻速」。**没有 bb** —— 数值公式
//                              官方本来就有；新增的攻速加成由 battle/main.mjs（pack.json.server.battle）实现，交 engine-cards。
//                  chess.json 6 条 chess：逐条比对后**与本仓完全一致**（egirShip 与第二个盟约本仓已有）→ 不产生 annBonds。
//   rhodes-ship/   payload/packs/rhodes-ship/{records,chess}.json
//                              新盟约 rhodesShip（完整记录）+ 7 条既有盟约的 members/visibleMembers 增量（其实是严格超集）
//                              + 22 条 chess：16 条是本仓没有的干员（chess_char_9_*，整条搬入）+ 6 条既有干员的追加盟约。
//   kazdel-ship/   同上，新盟约 kazdelShip + 5 条既有盟约 members + 18 条 chess（10 条本仓没有）。
//
// 这个脚本把这些**算成 delta**，不做人工搬运：
//   * `bonds`           两条新盟约的完整记录（`annOnly: true`，build-data 打标记）。
//   * `bondAnnOverrides` 既有盟约的 `ann` 覆盖块：`{members, visibleMembers}`（超集，只写增量后的完整表）与 egirShip 的
//                       四个文案字段。与炸惊的 `zj` 块同形（`bb` 走按键合并，这里是整字段替换），引擎侧只在 ANNIHILATION
//                       视图里合并（共享函数由 engine 落地，见报告）。
//   * `chessAnnBonds`   本仓**存在**的 chess 被追加了哪些盟约（棋-id 键）。
//   * `chess`           mod 自带、本仓没有的干员（13 名 × `_a`/`_b` = 26 条，`annihilation: true` + `visible: false`），
//                       逐字段原样搬入；`annBonds` 由盟约自己的 `members` 反推（9_09 / 9_22 同时属两条盟约）。
//   * `garrisons`       上面这些干员引用的卫戍（26 条；`battleRuneKey` 缺省补 null），原样搬入。
//   * `items`           两条盟约的专属装备（`records.items` 里 `giveBondId` 指向本条盟约的那几条）：4 件 ×2 形
//                       （萨卡兹的断角 / 提卡兹之根 / 罗德岛抑制环 / 罗德岛特制源石弧）。卡兹戴尔盟约「<每叠加100层>获得
//                       一件萨卡兹的断角」的 `reward_item` 就是它 —— 没有记录时那条里程碑计得清、发不出去。
//                       包只发 items 不发 effects，所以每件的 effect 记录按 data/effects.json 里**全部 EQUIP 记录的同一
//                       形状**从 item 反推（见 deriveItemEffect 的注释）。
//
// USAGE
//   node tools/extract-annihilation-mods.mjs [--ref <dir>] [--data <dir>] [--out <dir>] [--check]
//     --ref   包里 modref 的根（默认 <repo>/modref/mods）
//     --data   本仓 data 目录，读作「现状基线」（默认 <repo>/data）
//     --out    输出目录（默认 <repo>/docs/research）
//     --check  只算不写
//
// SELECTION IS MARKER BASED, never `pack − data/`: 抽取结果一旦并进 data/，差集就空了，脚本必须能重跑（上一轮的教训）。
// 这里的判据是「包里声明的键」：records.bonds / chess 的 bonds 数组 / egir 的 bonds.json —— 都不依赖 data 的差集，
// data 只用来（a）判断某 id 本仓有没有、（b）算「追加了什么」、（c）判断覆盖块是否真的不同。
//
// DROPPED ON PURPOSE（每个都写进 _doc）：
//   * 美术（art/*.png、asset-additions.json）、install.mjs（49 KB 的工坊安装器）、manifest/pack.json 的工坊元数据；
//   * 包 garrisons / tokens / variants（24+10 条特质、召唤物）：**被搬入干员引用的 26 条卫戍已搬**（2026-10-30）；
//     其余没被引用的（包内别的干员的）跳过并记进 notes.skippedGarrisons；tokens / variants 仍不搬（本仓已有那 3 个召唤物）。
//   * 包 items 里 `giveBondId` 不指向这两条新盟约的（本仓不存在的其它装备）；
//   * 名册里没有记录的干员（`chess_char_4_27_a`：两个包的 chess.json 都没有它）—— 记进 notes.unmatchedBondMembers；
//   * 对既有 chess 的 0.2.6 时代漂移字段（chess_char_6_12 的 tier/price/stats/...、chess_char_4_25/4_26 的
//     chessType/backup、chess_char_2_09 的 garrisonIds）—— 那些是**上游版本漂移**，不是湮灭特性。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 与炸惊导入器共用的归一化（业主 2026-10-30）：唯一实现在 tools/research-normalize.mjs（normalizeImportedTree），
// 这里只加载官方图标集、调用它、把三类结果写进 _extract —— 规则（以及为什么这样归一化）写在那边的文档注释里。
import { officialGarrisonTypeIcons, normalizeImportedTree, normalizeDescPairs } from './research-normalize.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REF_DIR = join(ROOT, 'modref', 'mods');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'docs', 'research');

/** The three mods that carry data this repository can serve, and where their payload lives. */
const DATA_MODS = Object.freeze([
  { id: 'egir-buff', kind: 'egir', dir: 'egir-buff' },
  { id: 'rhodes-ship', kind: 'pack', dir: join('rhodes-ship', 'rhodes-ship-mod', 'payload', 'packs', 'rhodes-ship') },
  { id: 'kazdel-ship', kind: 'pack', dir: join('kazdel-ship', 'kazdel-ship-mod', 'payload', 'packs', 'kazdel-ship') },
]);

/** The five mods with no data to move: behaviour switches this repository already has (shared/plugins/rules.js). */
const BEHAVIOUR_ONLY = Object.freeze(['comms-priority', 'prep-loadout', 'unequip', 'morph-plus', 'shop-bond-bias']);

const args = process.argv.slice(2);
const opt = { ref: REF_DIR, data: DATA_DIR, out: OUT_DIR, check: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ref' || a === '--data' || a === '--out') {
    const v = args[++i];
    if (!v) { console.error(`${a} needs a directory`); process.exit(2); }
    opt[a.slice(2)] = resolve(ROOT, v);
  } else if (a === '--check') opt.check = true;
  else if (a === '--help' || a === '-h') { console.log('usage: node tools/extract-annihilation-mods.mjs [--ref <dir>] [--data <dir>] [--out <dir>] [--check]'); process.exit(0); }
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (!existsSync(opt.ref)) {
  console.error(`mods directory not found: ${opt.ref}\nThe workshop mods are a temporary extraction (modref/, not in git).`);
  process.exit(1);
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const union = (...lists) => [...new Set(lists.flat().filter(Boolean))];

const ours = {
  chess: await readJson(join(opt.data, 'chess.json')),
  bonds: await readJson(join(opt.data, 'bonds.json')),
  garrisons: await readJson(join(opt.data, 'garrisons.json')),
  effects: await readJson(join(opt.data, 'effects.json')),
  // only to read the ABYSS schedule shape the annihilation one is derived from (never to decide "what is new")
  choices: await readJson(join(opt.data, 'choices.json')),
};

/** Load one data mod's payload: `{ bonds, chess, items }` — a pack keeps them under `records.json` / `chess.json`. */
async function loadMod(mod) {
  const dir = join(opt.ref, mod.dir);
  if (mod.kind === 'egir') {
    // egir-buff is a bare overlay: bonds.json = `{ egirShip: {desc, descRaw, effectDesc, effectDescRaw} }`, chess.json = bonds-only patches
    return { bonds: await readJson(join(dir, 'bonds.json')), chess: await readJson(join(dir, 'chess.json')), packBonds: null, items: {} };
  }
  const records = await readJson(join(dir, 'records.json'));
  const chessFile = await readJson(join(dir, 'chess.json'));
  const bonds = {};
  for (const [bondId, rec] of Object.entries(records.bonds || {})) if (bondId !== '_doc') bonds[bondId] = rec;
  return { bonds, chess: chessFile.chess || {}, packBonds: bonds, items: records.items || {}, garrisons: records.garrisons || {} };
}

// ===== extraction ===============================================================================

/** The new bond records: ids that do not exist here yet. */
const newBonds = {};
/** The `ann` overlay blocks of existing bonds. */
const bondAnnOverrides = {};
/** chessId → the bond ids the packs append (existing chess only). */
const chessAnnBonds = {};
/** chessId → the whole record, for operators this repository does not have (the mod brings them). */
const newChess = {};
/** garrisonId → the whole record of a 特质 carried by `newChess` (battleRuneKey filled). */
const newGarrisons = {};
/** itemId → the annihilation-only equipment record (both qualities). */
const items = {};
/** effectId → the derived EQUIP effect record of an item above. */
const itemEffects = {};
const notes = {
  unmatchedBondMembers: {}, skippedGarrisons: {}, droppedChessBonds: {}, skippedItems: {},
  noopOverrides: {}, upstreamDrift: {}, droppedEvidence: {},
};
const sources = {};

/** A record this extractor produced on an earlier run (the marker build-data puts on them). */
const isOwnAnnChess = (c) => !!c && c.annihilation === true;
/** A 卫戍 this extractor produced: its owners name a chess this build brought (a 卫戍 has no marker of its own). */
const isOwnAnnGarrison = (g) => !!g && Array.isArray(g.owners) && g.owners.some((id) => isOwnAnnChess(ours.chess[id]));

// Phase 0 — load every pack, then decide **by marker** which records are "brought by a mod" (never `pack − data/`):
//   · a chess that does not exist here, or that already carries our `annihilation: true` (a re-run);
//   · a bond that does not exist here, or that already carries `annOnly: true` (a re-run).
// The bond member filter and the chess `bonds` filter below both need the UNION, because a pack may name a bond another
// pack brings (9_09 / 9_22 name kazdelShip, which is declared by the kazdel-ship pack).
const payloads = [];
for (const mod of DATA_MODS) payloads.push({ mod, payload: await loadMod(mod) });
const broughtChess = new Set();
for (const { payload } of payloads) {
  for (const [chessId, patch] of Object.entries(payload.chess)) {
    if (chessId === '_doc' || chessId === 'version') continue;
    const cur = ours.chess[chessId];
    if (!cur || isOwnAnnChess(cur)) broughtChess.add(chessId);
  }
}
const broughtBonds = new Set();
for (const { payload } of payloads) {
  for (const [bondId, rec] of Object.entries(payload.bonds)) {
    const cur = ours.bonds[bondId];
    if (!cur || cur.annOnly === true) broughtBonds.add(bondId);
  }
}
const knownChess = new Set([...Object.keys(ours.chess), ...broughtChess]);
const knownBonds = new Set([...Object.keys(ours.bonds), ...broughtBonds]);

for (const { mod, payload } of payloads) {
  sources[mod.id] = [];

  // ---- bonds: a new record, or an `ann` overlay of an existing one ------------------------------------------
  for (const [bondId, rec] of Object.entries(payload.bonds)) {
    const cur = ours.bonds[bondId];
    // Classification is MARKER based, never `pack − data/`: once this content is merged into data/ (it is), a diff against
    // data/ would call every extracted bond an "override" and the re-run would emit an empty map. A bond this build owns is
    // the one carrying `annOnly` (tags this extractor added), so it stays in the "new record" branch forever.
    const ownAnBond = cur?.annOnly === true;
    if (!cur || ownAnBond) {
      if (newBonds[bondId]) throw new Error(`${bondId}: declared by two mods`);
      // 新盟约的 members 里有本仓没有的干员（包自带的名册）：只留「本仓已有 + 本轮搬进来的」id，其余记进 notes
      const keep = (list) => (list || []).filter((id) => knownChess.has(id));
      const dropped = union(rec.members || [], rec.visibleMembers || []).filter((id) => !knownChess.has(id));
      const out = { ...rec, members: keep(rec.members), visibleMembers: keep(rec.visibleMembers) };
      // `annOnly` 是 build-data 认的标记（本仓官方模式下看不见这条盟约）；research 里就写上，便于人工核对
      out.annOnly = true;
      newBonds[bondId] = out;
      // 包内名册里没有记录、也搬不进来的 id（2026-10-30：只剩 chess_char_4_27_a）
      if (dropped.length) notes.unmatchedBondMembers[bondId] = dropped;
      sources[mod.id].push(`records.bonds.${bondId}`);
      continue;
    }
    // 既有盟约：只取**真的不同**的字段。pack 给的是 members/visibleMembers 的完整表（严格超集），egir 给的是四个文案字段
    const ann = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === '_doc') continue;
      const same = JSON.stringify(v) === JSON.stringify(cur[k]);
      if (same) continue;
      if (k === 'members' || k === 'visibleMembers') {
        // 包的表可能含本仓没有的干员：过滤后再与本仓取并集，保证「只增不减」且引用都成立
        const merged = union(cur[k] || [], v.filter((id) => knownChess.has(id)));
        const lost = (cur[k] || []).filter((id) => !merged.includes(id));
        if (lost.length) throw new Error(`${bondId}.${k}: the pack would DROP ${lost.join(', ')} — refusing a lossy override`);
        // 过滤后与本仓一致 ⇒ 这条包只追了本仓没有的干员，覆盖块本身没有信息，不写（否则 _doc 的计数会虚高）
        if (JSON.stringify(merged) === JSON.stringify(cur[k] || [])) {
          (notes.noopOverrides[bondId] ||= []).push(k);
          continue;
        }
        ann[k] = merged;
      } else {
        ann[k] = v;
      }
    }
    if (!Object.keys(ann).length) continue;
    bondAnnOverrides[bondId] = { ...(bondAnnOverrides[bondId] || {}), ...ann };
    sources[mod.id].push(`records.bonds.${bondId} (ann)`);
  }

  // ---- chess: records the mod brings whole, and records it only appends bonds to --------------------------------
  for (const [chessId, patch] of Object.entries(payload.chess)) {
    if (chessId === '_doc' || chessId === 'version') continue;
    const cur = ours.chess[chessId];
    // A record the mod brings (not in this repository, or ours from an earlier run): import it whole. The package's
    // `visible: true` is overridden — this repository's official pool is `visible === true && zhajing !== true`, so a
    // brought record must stay invisible there; `annihilation: true` is the marker every consumer keys on (build-data's
    // merge and `annihilationRoster`), and `annBonds` is derived from the bonds' own `members` below.
    if (!cur || isOwnAnnChess(cur)) {
      if (newChess[chessId]) throw new Error(`${chessId}: declared by two mods`);
      const rec = {};
      for (const [k, v] of Object.entries(patch)) rec[k] = v;
      rec.visible = false;
      rec.annihilation = true;
      // 包内引用、但本仓没有的盟约（阿米娅的 rimBilliton）：留着会让 validate.js 的「bond missing」直接红。丢掉并记录。
      const unknownBonds = (rec.bonds || []).filter((b) => !knownBonds.has(b));
      if (unknownBonds.length) {
        rec.bonds = rec.bonds.filter((b) => !unknownBonds.includes(b));
        notes.droppedChessBonds[chessId] = unknownBonds;
      }
      newChess[chessId] = rec;
      sources[mod.id].push(`chess.${chessId}（新记录：${rec.name}，tier ${rec.tier}）`);
      continue;
    }
    const added = (patch.bonds || []).filter((b) => !(cur.bonds || []).includes(b));
    // 除 bonds 以外的字段差异：一律当上游漂移丢掉（记录下来的目的只是让人能核对，不是搬运）
    const drifted = Object.keys(patch).filter((k) => k !== 'bonds' && JSON.stringify(patch[k]) !== JSON.stringify(cur[k]));
    if (drifted.length) (notes.upstreamDrift[chessId] ||= { mods: [], fields: [] }), notes.upstreamDrift[chessId].mods.push(mod.id), notes.upstreamDrift[chessId].fields.push(...drifted);
    if (!added.length) continue;
    const unknown = added.filter((b) => !knownBonds.has(b));
    if (unknown.length) throw new Error(`${chessId}: the packs append unknown bond(s) ${unknown.join(', ')}`);
    chessAnnBonds[chessId] = union(chessAnnBonds[chessId] || [], added);
    sources[mod.id].push(`chess.${chessId} → ${added.join('+')}`);
  }
  // ---- garrisons: the 特质 the brought chess carry ------------------------------------------------------------
  // A 卫戍 has no marker of its own (the same rule the 炸惊 import follows): selection is "referenced by a chess this
  // build brings". An id this repository already has with an official owner (garrison_04_a/_b of 红豆's official chess)
  // is left untouched; on a re-run the record is already here but its owners name brought chess, so it is re-emitted.
  const broughtGarrisons = new Set();
  for (const rec of Object.values(newChess)) for (const gid of rec.garrisonIds || []) broughtGarrisons.add(gid);
  for (const [garrisonId, rec] of Object.entries(payload.garrisons || {})) {
    if (!broughtGarrisons.has(garrisonId)) { (notes.skippedGarrisons[mod.id] ||= []).push(garrisonId); continue; }
    const cur = ours.garrisons[garrisonId];
    if (cur && !isOwnAnnGarrison(cur)) { (notes.skippedGarrisons[mod.id] ||= []).push(garrisonId); continue; }
    if (newGarrisons[garrisonId]) throw new Error(`${garrisonId}: declared by two mods`);
    // 0.3.3 的每条卫戍都带 battleRuneKey（没有 rune 的为 null）；这 26 条包内记录都没有这个键，补 null 与库里 130 条同值。
    newGarrisons[garrisonId] = 'battleRuneKey' in rec ? rec : { ...rec, battleRuneKey: null };
    sources[mod.id].push(`records.garrisons.${garrisonId}（${rec.eventType}）`);
  }
  // ---- items: the two alliances' own equipment (records.items) -----------------------------------------------
  // 判据同样是**包声明的标记**：`giveBondId` 指向这两条新盟约（`newBonds` 里刚收的那两条，或 data 里已带 `annOnly`
  // 的那两条）—— 重跑时 data 已经是合并后的样子，这条判据仍然成立。包里的其它装备（本仓没有的干员带的）跳过并记进 notes。
  for (const [itemId, rec] of Object.entries(payload.items)) {
    if (itemId === '_doc') continue;
    const bondId = rec && rec.giveBondId;
    const annBond = !!bondId && (newBonds[bondId] !== undefined || ours.bonds[bondId]?.annOnly === true);
    if (!annBond) { (notes.skippedItems[mod.id] ||= []).push(itemId); continue; }
    if (items[itemId]) throw new Error(`${itemId}: declared by two mods`);
    if (rec.itemType !== 'EQUIP') throw new Error(`${itemId}: itemType ${rec.itemType}, expected EQUIP`);
    // `annOnly` 是 build-data 认的标记（官方四档的商店 / 装备池看不见它）；与两条新盟约同一种做法
    items[itemId] = { ...rec, annOnly: true };
    sources[mod.id].push(`records.items.${itemId}（${rec.name}，${rec.isGolden ? '精锐' : '普通'}${rec.trapId}）`);
  }
  if (!sources[mod.id].length) sources[mod.id].push('(no data to move)');
}

// dedupe the drift record (two packs may both patch one chess)
for (const [id, v] of Object.entries(notes.upstreamDrift)) notes.upstreamDrift[id] = { mods: [...new Set(v.mods)], fields: [...new Set(v.fields)] };

// `annBonds` — the annihilation bonds that list a brought chess in their own `members` (the packs write membership on the
// bond, exactly like the two new bonds' `members`; the chess's own `bonds` array is the pack's view for every mode). The
// member lists name the BASE form, so an elite record takes its base's membership; this keeps `members ↔ annBonds`
// consistent in both directions, which test/data.test.js and the isolation suite assert.
for (const [chessId, rec] of Object.entries(newChess)) {
  rec.annBonds = Object.keys(newBonds).filter((b) => {
    const members = Array.isArray(newBonds[b].members) ? newBonds[b].members : [];
    return members.includes(chessId) || (typeof rec.baseId === 'string' && members.includes(rec.baseId));
  }).sort();
  if (!rec.annBonds.length) throw new Error(`${chessId}: no annihilation bond lists it in members — the roster switch would never show it`);
}
// The pack's 0.2.6 builder left the rich markup in a few talent `potBelow` descs (`desc` carried `<$ba.…>` instead of the
// plain text). `desc = richTextPlain(descRaw)` is the repository's rule (docs/DATA.md §0) and the one the 炸惊 importer
// applies to imported chess; it only rewrites entries whose two sides disagree.
const chessDescChanges = [];
for (const [chessId, rec] of Object.entries(newChess)) chessDescChanges.push(...normalizeDescPairs(rec, `chess.${chessId}`));
if (chessDescChanges.length) notes.normalizedChessDesc = chessDescChanges;

// ===== items: golden links, derived effect records, shop exclusion ===============================

/**
 * 每件装备的 effect 记录形状：`data/effects.json` 里**官方**的 EQUIP 记录只有一组 counterType / continuedRound /
 * decoIconId / enemyPrice 与同一组键（下面这段在生成期断言它，形状变了就红，而不是让反推悄悄漂）。
 * 本文件自己派生的那几条（`annOnly`）不在样本里：它们多了 `annOnly` 这个模式标记。
 */
const EQUIP_EFFECT_DEFAULTS = Object.freeze({ counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0 });
{
  const shapes = new Set();
  for (const e of Object.values(ours.effects)) {
    if (!e || e.effectType !== 'EQUIP' || e.annOnly === true || e.zjOnly === true) continue;
    shapes.add(JSON.stringify([e.counterType, e.continuedRound, e.decoIconId, e.enemyPrice, Object.keys(e).join(',')]));
  }
  if (shapes.size !== 1) throw new Error(`data/effects.json: ${shapes.size} different EQUIP effect shapes — a derived item effect needs one rule`);
}

/**
 * 一件装备的 effect 记录。包只发 items、不发 effects（两个包的 records.json 没有 effects 段，modref 里也 grep 不到
 * eff_kazdel_horn / eff_kazdel_eye / eff_rhodes_ring / eff_rhodes_arc），所以按上面断言过的**唯一 EQUIP 形状**从 item
 * 反推：name / desc / descRaw / buffs / params 全部取 item 自己的字段 —— 不是编数值，是把同一份数据换张表放。
 * [ASSUMED] 日后若能从包里拿到真正的 effect 记录且形状不同，以包为准。
 */
function deriveItemEffect(item) {
  return {
    effectId: item.effectId,
    effectType: 'EQUIP',
    name: item.name,
    desc: item.desc,
    descRaw: item.descRaw,
    ...EQUIP_EFFECT_DEFAULTS,
    buffs: (item.buffs || []).map((b) => ({ ...b })),
    params: { ...(item.params || {}) },
    // build-data 认的标记：官方四档的 effect 表不给它开洞（与盟约 / 装备同一种做法）
    annOnly: true,
  };
}

/**
 * 每件装备"从哪来"（写进 `shopExcludedBy`）。本仓没有湮灭专属商店池，而官方四档的商店是从 data/items.json 现算的
 * （gamedata.shopItemsByTier → pool），所以**必须**把这 4 件排除出商店：否则官方四档会多卖 4 件湮灭盟约装备。
 * `shopExcluded` + `shopExcludedBy` 正是官方对这种「不由商店出售的装备」的既有口径（战栗维式重锤 / 突变细胞同款）。
 */
const ITEM_SOURCE = Object.freeze({
  chess_item_c_01_e_a: '【卡兹戴尔】盟约<每叠加100层>获得一件（bonds.kazdelShip 的 bond_layer_added_reward_equip）',
  chess_item_c_02_e_a: '[ASSUMED] 湮灭盟约专属装备；本仓没有湮灭专属商店池，先排除出商店',
  chess_item_c_03_e_a: '[ASSUMED] 湮灭盟约专属装备；本仓没有湮灭专属商店池，先排除出商店',
  chess_item_c_04_e_a: '[ASSUMED] 湮灭盟约专属装备；本仓没有湮灭专属商店池，先排除出商店',
});

for (const itemId of Object.keys(items).sort()) {
  const rec = items[itemId];
  // 精锐形必须与普通形同批进来（否则 baseId / goldenId 悬空，data/items.json 的 golden 链断）
  if (rec.goldenId && !items[rec.goldenId]) throw new Error(`${itemId}: goldenId ${rec.goldenId} not extracted — both qualities must ship`);
  if (rec.upgradeChessId && rec.upgradeChessId !== rec.goldenId) throw new Error(`${itemId}: upgradeChessId ${rec.upgradeChessId} ≠ goldenId ${rec.goldenId}`);
  if (!rec.effectId) throw new Error(`${itemId}: no effectId`);
  const eff = deriveItemEffect(rec);
  const prev = itemEffects[rec.effectId];
  if (!prev) itemEffects[rec.effectId] = eff;
  // 包里精锐形与普通形**共用 effectId**、但数值更高（官方数据是给精锐另开一条 eff_acgarmNNN）。我们的模型一件装备
  // 一条 effect，所以这里取普通形的数值；精锐那条的数值仍在它自己的 items 记录里（引擎读的是 item.buffs，不是 effect）。
  else if (!rec.isGolden && JSON.stringify(prev) !== JSON.stringify(eff)) throw new Error(`${rec.effectId}: two normal items derive different effects`);
  const source = ITEM_SOURCE[rec.isGolden ? rec.baseId : rec.id];
  if (!source) throw new Error(`${itemId}: no shop-exclusion reason (add it to ITEM_SOURCE)`);
  // 两件事一起做，判据才和引擎一致（2026-10-29 Lead 的二分定位）：
  //   · `hideInShop: true` —— 包内普通形写的是 false（它认为自己可售），但这两条盟约的装备是**每 100 层的奖励**
  //     （`bond_layer_added_reward_equip`），不是商品；官方对这种「登记了但商店不卖」的装备用的正是 hideInShop
  //     （精锐形本来就 true）。`sim/simdata.js isShopItem` 认它。
  //   · `annOnly: true`（items 循环里已加）+ `shopExcluded` —— 与炸惊的 `zjOnly` 对称，工具侧（`tools/golden.mjs` 的
  //     EQUIPS 游标）也按这两个标记把非官方装备排除，否则它们会顶掉官方场景里发装备的顺序。
  rec.hideInShop = true;
  rec.shopExcluded = true;
  rec.shopExcludedBy = source;
}

// ===== report + write ============================================================================
const counts = {
  bonds: Object.keys(newBonds).length,
  bondAnnOverrides: Object.keys(bondAnnOverrides).length,
  chessAnnBonds: Object.keys(chessAnnBonds).length,
  chessAnnBondEdges: Object.values(chessAnnBonds).flat().length,
  chess: Object.keys(newChess).length,
  garrisons: Object.keys(newGarrisons).length,
  unmatchedBondMembers: Object.values(notes.unmatchedBondMembers).flat().length,
  droppedChessBonds: Object.values(notes.droppedChessBonds).flat().length,
  items: Object.keys(items).length,
  itemEffects: Object.keys(itemEffects).length,
  skippedItems: Object.values(notes.skippedItems).flat().length,
  skippedGarrisons: Object.values(notes.skippedGarrisons).flat().length,
};

const SOURCE = 'modref/mods/（8 个湮灭专属 workshop 包的本地解压，不是本仓 git 内容）';

const doc = [
  '湮灭专属 mod 的数据 —— 由 tools/extract-annihilation-mods.mjs 从 ' + SOURCE + ' 抽取，',
  'tools/build-data.mjs 合并进 data/bonds.json、data/chess.json、data/garrisons.json、data/items.json 与 data/effects.json',
  '（默认版本；另一版本的目录不动）。',
  '',
  '隔离范式与炸惊模拟一致，但**标记名分开**（因为两者可能同时存在）：',
  '  · 新盟约（rhodesShip / kazdelShip）：`annOnly: true` —— 官方四档与炸惊的 bondIds / bond() 都拿不到它；',
  '  · 既有盟约的覆盖：`bonds[<id>].ann` 块（与炸惊的 `zj` 块同形：只写要覆盖的字段；`members`/`visibleMembers` 是整表替换，',
  '    `bb` 按键合并）—— 只有 ANNIHILATION 视图合并它，其它模式读到逐字节原记录；',
  '  · mod 自带的干员：`chess[<id>].annihilation: true` + `visible: false` —— 与炸惊的 `zhajing: true` 同构：',
  '    官方池的判据（`visible === true && zhajing !== true`）看不见它，`annihilationRoster` 按「它的 `annBonds` 指向的',
  '    mod 开关」决定它进不进湮灭名册；',
  '  · chess 的追加盟约：`chess[<id>].annBonds`（数组）—— 只在 ANNIHILATION 下参与盟约计数；官方模式与炸惊不读；',
  '  · mod 干员的 特质：`garrisons[<id>]` 原样搬运（`battleRuneKey` 缺省补 null）—— 卫戍没有自己的标记，',
  '    只经 `chess[].garrisonIds` 可达（与炸惊的 248 条同一口径）；',
  '  · 盟约专属装备：`items[<id>].annOnly: true`（两条新盟约的 4 件 ×2 形）—— `shopExcluded` 把它们排除出商店，',
  '    所以官方四档的商店与装备池逐字节不变（本仓没有湮灭专属商店池）。',
  '',
  `计数：新盟约 ${counts.bonds}、既有盟约 ann 覆盖 ${counts.bondAnnOverrides} 条（含 egirShip 的 4 个文案字段）、`,
  `chessAnnBonds ${counts.chessAnnBonds} 条棋 / ${counts.chessAnnBondEdges} 条边；mod 自带干员 ${counts.chess} 条 + 特质 ${counts.garrisons} 条；`,
  `盟约成员里仍无记录的悬挂 id ${counts.unmatchedBondMembers} 条；chess 上丢掉的本仓没有的盟约 ${counts.droppedChessBonds} 条；`,
  `盟约专属装备 ${counts.items} 条（4 件 ×2 形）+ 派生 effect 记录 ${counts.itemEffects} 条；包里的其它装备 ${counts.skippedItems} 条（跳过）；`,
  `包里的其它卫戍 ${counts.skippedGarrisons} 条（跳过）。`,
  '',
  '逐来源：',
  ...DATA_MODS.map((m) => `  · ${m.id}（${m.kind === 'pack' ? 'records.json + chess.json' : 'bonds.json + chess.json'}）：${sources[m.id].join('；')}`),
  ...BEHAVIOUR_ONLY.map((id) => `  · ${id}：只声明 behaviour 开关，数据侧不搬（本仓 shared/plugins/rules.js 已有该开关）`),
  '',
  'egirShip 的 `ann` 块只有 4 个文案字段（desc / descRaw / effectDesc / effectDescRaw）：',
  '  生命值公式 (35+1×层数)% 与「吞噬」本身官方已有（bb 不变）；新增的两件事写在 battle/main.mjs 里，交 engine-cards：',
  '  (1) <战斗开始时> 所有【阿戈尔】干员获得「当前层数 × 0.5」的**基础面板攻击力**（固定加算 atkFlat，不吃攻击力百分比）；',
  '  (2) 5 名不同成员那一档：官方复活逻辑真的救起来的那名干员额外 +50 攻速（持续到战斗结束）。',
  '  这两条**没有数据表达**（引擎行为），所以本文件不写 bb —— 若日后要数据化，请连同 battle/main.mjs 的判据一起搬。',
  '',
  '丢掉的（每个都有理由）：',
  '  · 美术（art/*.png、asset-additions.json）、install.mjs（49 KB 工坊安装器）、manifest.json / pack.json 的工坊元数据；',
  '  · 包自带的 tokens / variants：它们挂在包自己的干员上，本仓没有那些单位记录（mod 干员的 3 个召唤物本仓已有）；',
  '  · 包 items 里 `giveBondId` 不指向这两条新盟约的：见 _extract.notes.skippedItems —— 它们是包自带干员的装备；',
  '  · 包内没有被这些新干员引用的卫戍（`garrison_35_*`、`garrison_c_humus_*`、`garrison_c_rosmon_*`、kazdel 的 `garrison_10_*`）：',
  '    见 _extract.notes.skippedGarrisons —— 它们挂在包内没有搬的干员上；',
  '  · 对既有 chess 的**上游版本漂移**字段（包按 gameVersion 0.2.6 构建）：见 _extract.notes.upstreamDrift，例如',
  '    chess_char_6_12 的 tier/price/stats/skills、chess_char_4_25/_26 的 chessType/backup、chess_char_2_09 的 garrisonIds。',
  '    这些**不是**湮灭特性，搬进来等于把 0.3.3 的数据改回 0.2.6。',
  '',
  '**mod 自带的 13 名干员（26 条 chess）与他们的 26 条卫戍**：',
  '  · rhodes-ship：阿斯卡纶 9_09、霜叶 9_11、坚雷 9_13、阿米娅 9_14、煌 9_16、凯尔希 9_18、Mon3tr 9_21、逻各斯 9_22；',
  '  · kazdel-ship：红豆 9_01、陨星 9_02、闪灵 9_04、赫德雷 9_06、维什戴尔 9_10；',
  '  · 每条 `_a` 基础形 + `_b` 精英形；包内 `visible: true` 被改成 `false`，另打 `annihilation: true`；`annBonds` 由',
  '    盟约自己的 `members` 反推（9_09 / 9_22 同时属罗德岛与卡兹戴尔，其余各属一条）；',
  '  · 卫戍（18 + 8 条）原样搬运，`owners` 已指向这些新棋；红豆引用的 `garrison_04_a/_b` 本仓已有（官方红豆的），不覆盖。',
  '  · **`chess_char_4_27_a` 两个包的 chess.json 里都没有记录**（连 `_b` 也没有）→ 搬不了，只进',
  '    `_extract.notes.unmatchedBondMembers.rhodesShip`；它是名册里唯一的悬挂 id。',
  '',
  '**盟约成员与可达性（2026-10-30）**：',
  `  · rhodesShip 包内 14 名成员：本仓 5 名 + 本轮搬入 8 名 = ${Object.keys(newBonds).length ? newBonds.rhodesShip.members.length : 0} 名；`,
  `  · kazdelShip 包内 11 名成员：本仓 4 名 + 本轮搬入 7 名（含 rhodes 包的 9_09 / 9_22）= ${Object.keys(newBonds).length ? newBonds.kazdelShip.members.length : 0} 名；`,
  '  · 阈值仍是包内的 [3,6] / [3,6,9]：6 名档与 9 名档现在**真的能到**（13 ≥ 6、11 ≥ 9）。',
  '',
  '⚠ 两个已知的包内缺口（不在本轮造假）：',
  '  · `chess_char_9_14`（阿米娅）的 `bonds` 引用了 `rimBilliton`，本仓没有这条盟约 → 导入时丢掉该引用并记进',
  '    `_extract.notes.droppedChessBonds`（否则 validate.js 的 bond missing 会让构建失败）；',
  '  · `garrison_c_monstr_gain_*` 的 `bbStr.item` 指向 `chess_item_c_05_e_a`（M3利爪），两个包与本仓都没有这条装备记录 →',
  '    那条特质计得清、发不出（与上一轮 c_01..c_04 的缺口同类）。',
  '',
  '**盟约专属装备（items）—— 4 件 ×2 形，从包里原样抽**：',
  '  · 萨卡兹的断角 chess_item_c_01_e_a/_b（effectId eff_kazdel_horn，trap_c_01）、提卡兹之根 _c_02_（eff_kazdel_eye，trap_c_02，',
  '    由 kazdel-ship 包提供）、罗德岛抑制环 _c_03_（eff_rhodes_ring）、罗德岛特制源石弧 _c_04_（eff_rhodes_arc，由 rhodes-ship 提供）。',
  '  · 它们的 `giveBondId` 分别是 kazdelShip / rhodesShip，所以 build-data 能把它们和盟约一起隔离（`annOnly`）；**卡兹戴尔盟约',
  '    「<每叠加100层>获得一件萨卡兹的断角」的 `reward_item` 就是 chess_item_c_01_e_a** —— 这是本轮补数据缺口的主因：没有这条',
  '    记录时那条里程碑计得清、grantItem 却发不出去（不抛不重试＝静默失效）。',
  '  · **effect 记录是派生的**（包只发 items、不发 effects）：按 data/effects.json 里 115 条 EQUIP 记录**唯一的那个形状**',
  '    （counterType NONE / continuedRound -1 / decoIconId null / enemyPrice 0，生成期断言）从 item 反推 name/desc/descRaw/buffs/params。',
  '  · **不进商店**：这 4 件是**奖励**不是商品（卡兹戴尔的断角每 100 层发一件），所以每件 `hideInShop: true`（包内普通形',
  '    写的是 false）+ `shopExcluded: true` + `shopExcludedBy`（与战栗维式重锤 / 突变细胞同一口径）。两侧判据必须一致：',
  '    引擎侧 `sim/simdata.js isShopItem`（gamedata.shopItemsByTier）与工具侧 `tools/golden.mjs` 的 EQUIPS 游标都读这些标记',
  '    —— 只加 shopExcluded 时 golden 的官方场景会把它们当成可发装备，整条发装备序列错位（2026-10-29 Lead 的二分定位）。',
  '    c_02..c_04 在包内没有发放点，本仓也没有湮灭专属商店池 → `[ASSUMED]` 先排除出商店。要在湮灭局卖它们，需要 gamedata',
  '    给一个带 mod 门的商店池（引擎侧）。',
  '',
  '两条新盟约的 effectId（bondeffect_rhodes / bondeffect_kazdel）在本仓 data/effects.json 里**没有**记录（包里也没有）：',
  '它们的数值在 `buffs[].bb` 里，战斗 rune 键是 act2autochess_bond_eff_rhodes / _kazdel —— 引擎要认这两个键。',
  '因此 shared/plugins/validate.js 对 `annOnly` 记录豁免「effect 必须存在」（与 zjOnly 同一处理）。',
  '',
  '**只写真的有变化的覆盖块**：包给 11 条既有盟约写了 members/visibleMembers，但其中 9 条追加的成员全是本仓没有的干员',
  '（chess_char_9_* 等），过滤后与本仓原表**逐项相同** → 不产出 `ann` 块（见 _extract.notes.noopOverrides）。',
  '真正有变化的两条：`raidShip`（+chess_char_5_06_a）与 `egirShip`（4 个文案字段）。',
  '',
  '**盟誓卡（bondCards）—— 不是从包里抽的，是按既有模板派生的**：包里没有给这两个盟约配任何抉择卡/悬赏卡/驰援卡',
  '（全 `data/*.json` 里提到 rhodesShip/kazdelShip 的只有 bonds 与 chess，见 Lead 2026-10-28 的探针）。',
  '所以按 `data/effects.json` 的 **`allybuff_select_2_7`（玛恩纳的盟誓：单盟约、count 12）** 逐字段克隆出两条：',
  '  · `annbuff_select_bond_rhodes` / `annbuff_select_bond_kazdel`：effectType BUFF_GAIN，',
  '    buff `global_special_choice_bond_addlayer`，`bb.count = 12`，`bbStr.bond_list = <盟约 id>`（该键是**逗号分隔字符串**，',
  '    见 server/match/choices.js:642 —— 不是数组），`decoIconId = icon_team_buff`；两条都带 `annOnly: true`（只有湮灭的卡池收）。',
  '  · 同时在 `choices.cards.tactic` 各加一条 `kind: ally / team: true`。',
  '  为什么不用驰援模板（`single_special_choice_gain_bond_chess`）：它的 handler 按 `c.bonds.includes(bs.bond)` 找棋子',
  '  （choices.js:667），而这两个盟约的成员只写在 `chess[].annBonds` 里（`bonds` 数组没有它们）→ 会**静默发不出棋子**。',
  '  盟誓模板走 `ps.addLayers(bond, count, {requireActive:false})`，无需激活也生效，是这两个盟约唯一能用的模板。',
  '',
  '⚠ 这两张卡要能真的抽到，还需要两件事（数据侧本轮已补第 1 件；第 2 件在引擎）：',
  '  1. `choices.schedule` 里原本没有 `mode_{single,multi}_annihilation` 条目 → `scheduleFor()` 回落到「道具补给」',
  '     （choices.js:117-123），湮灭局的机变**永远不会出战术决策**（实测 R3/5/7/…/19 全是 supply）。本文件的 `schedule`',
  '     段补上了这两条，见下面「湮灭的机变轮次表」。',
  '  2. `Match.bondInPool()` 只认 `c.bonds.includes(bond)`（match/infra.js:98-104），不认 `chess[].annBonds` →',
  '     `bondLive("rhodesShip")` 为 false → 盟誓卡即便有 schedule 也会被 `tacticDraftCards()` 过滤掉。**这条仍是引擎侧**。',
  '',
  '**湮灭的机变轮次表（`schedule`）—— [ASSUMED]，本仓替业主定的**：',
  '  业主诉求是「罗德岛的卡要能抽到」，而官方与包内**都没有**任何湮灭的轮次表（包内 `choices.schedule` 也只有官方四档）。',
  '  所以这里照**官方 ABYSS 的三份 rounds 形状**（R3 悬赏 tier1–4 / R9 悬赏 tier3–6 / R11 悬赏14+机密商店4+战术决策4）',
  '  把它们铺到湮灭自己的机变轮次上（`spRounds` = 从 R3 起、每 2 回合一个、到隐秘核心之前，且 30 回合梯子下高蚀流还会往后延）：',
  '    R3、R5 = ABYSS R3 的形状；R7、R9 = ABYSS R9 的形状；R11、R15、R19 及以后每个机变轮 = ABYSS R11 的混合形状；',
  '    R13、R17 = ABYSS R9 的形状（终局前的危局悬赏）。**战术决策因此出现在 R11 / R15 / R19 及更高蚀流的机变轮**，',
  '    这就是那两张盟誓牌进手牌的入口。轮次键铺满 R3…R29 的每个奇数轮，保证任何蚀流档的 `spRounds()` 都被覆盖。',
  '  非机变轮不写（`scheduleFor` 本来就回落到道具补给，与官方行为一致）。',
].join('\n');

// ===== 盟誓卡（派生，不是抽取）=========================================================================
// 模板 = data/effects.json 的 allybuff_select_2_7（单盟约盟誓、count 12）+ choices.cards.tactic 的同名条目。
// 包里没有这两张卡（见 _doc），所以这里按模板逐字段克隆，只替换 id / 名字 / 盟约 —— 不新造机制、不新造字段。
const CARD_MODEL = 'allybuff_select_2_7';
const BOND_CARDS = Object.freeze([
  { effectId: 'annbuff_select_bond_rhodes', bond: 'rhodesShip', name: '罗德岛的盟誓' },
  { effectId: 'annbuff_select_bond_kazdel', bond: 'kazdelShip', name: '卡兹戴尔的盟誓' },
]);
const modelEffect = ours.effects[CARD_MODEL];
if (!modelEffect) throw new Error(`bond-card model ${CARD_MODEL} missing from ${join(opt.data, 'effects.json')}`);
const bondCards = { effects: {}, tactic: [] };
for (const card of BOND_CARDS) {
  // the bond may be new in this run or already merged by a previous run (`annOnly` marker)
  const bondRec = newBonds[card.bond] ?? (ours.bonds[card.bond]?.annOnly === true ? ours.bonds[card.bond] : null);
  if (!bondRec) throw new Error(`bond card ${card.effectId}: ${card.bond} is neither extracted here nor an annOnly bond`);
  const count = modelEffect.buffs?.[0]?.bb?.count;
  if (!Number.isInteger(count) || count <= 0) throw new Error(`${CARD_MODEL}: no positive buff count to clone`);
  const name = bondRec.name;
  const desc = `你的${name}盟约层数+${count}，若存在其他队友则他们也获得`;
  bondCards.effects[card.effectId] = {
    ...modelEffect,
    effectId: card.effectId,
    name: card.name,
    desc,
    descRaw: `你的${name}盟约层数<@ba.vup>+${count}</>，若存在<@ba.vup>其他队友</>则他们也获得`,
    buffs: (modelEffect.buffs || []).map((b) => ({ ...b, bb: { ...(b.bb || {}), count }, bbStr: { ...(b.bbStr || {}), bond_list: card.bond } })),
    params: { ...(modelEffect.params || {}), count, bond_list: card.bond },
    annOnly: true,
  };
  bondCards.tactic.push({ effectId: card.effectId, name: card.name, desc, kind: 'ally', stageId: null, team: true, annOnly: true });
  sources.bondCards = BOND_CARDS.map((c) => `${c.effectId}（派生自 ${CARD_MODEL}，非包内内容）`);
}
counts.bondCards = bondCards.tactic.length;

// ===== 湮灭的机变轮次表（[ASSUMED] 派生，不是抽取）======================================================
// 形状全部来自**官方 ABYSS 的三份 rounds**（不是我们编的数值）：R3 = 悬赏 tier1–4、R9 = 悬赏 tier3–6、
// R11 = 悬赏14+机密商店4+战术决策4。把它们铺到湮灭自己的机变轮上（R3 起每 2 回合一个），
// 让战术决策在 R11 / R15 / R19… 出现 —— 那两张盟誓牌才有进手牌的入口。
const ABYSS = ours.choices.schedule?.mode_multi_abyss?.rounds;
if (!ABYSS) throw new Error('annihilation schedule: the ABYSS model (choices.schedule.mode_multi_abyss) is missing from data/choices.json');
const shape = (round) => {
  const r = ABYSS[String(round)];
  if (!r) throw new Error(`annihilation schedule: the ABYSS model has no round ${round}`);
  return { families: r.families.map((f) => ({ ...f })), cards: r.cards, supplyTiers: [...(r.supplyTiers || [])] };
};
/** 每 2 回合一个机变轮，R3…R29 的奇数轮全铺满（任何蚀流档的 spRounds() 都被覆盖）。 */
const ODD_ROUNDS = Array.from({ length: 14 }, (_, i) => 3 + i * 2);
const familyFor = (round) => (round <= 5 ? shape(3) : [7, 9, 13, 17].includes(round) ? shape(9) : shape(11));
const schedules = {};
for (const [modeId, cards] of [['mode_single_annihilation', 3], ['mode_multi_annihilation', 6]]) {
  const rounds = {};
  for (const r of ODD_ROUNDS) {
    const s = familyFor(r);
    rounds[String(r)] = { families: s.families, cards, supplyTiers: s.supplyTiers, events: {} };
  }
  schedules[modeId] = { spRounds: ODD_ROUNDS, rounds };
}
counts.scheduleModes = Object.keys(schedules).length;
counts.scheduleRounds = Object.values(schedules).reduce((n, s) => n + Object.keys(s.rounds).length, 0);

// ── 归一化（业主 2026-10-30）──────────────────────────────────────────────────────────────────────────────
// 参考包把换行存成**字面 `\n`**（反斜杠 + n 两个字符）、`descRaw` 里还留着未解析的 `{i:fmt}` 占位符、
// 有的 `descRaw` 甚至漏掉「（每场作战至多N层）」——上一次是**手工**在 docs/research/20-annihilation-mods.json
// 里修的（kazdelShip）。这里把安全的几件接上，让「重导入同一份包」不再把手工修复冲掉：
//   · `desc` 里的字面 `\n` → 真换行（`unescapeNewlines`）；
//   · `restoreBlackboardCapNote`：只有「desc 里有那句上限、descRaw 漏了、bb 里写着同一个 N」时才补；
//   · `eventTypeIcon` 非法值按 `eventTypeDesc` 映射官方四图标（本包目前没有 garrison 记录，留着给以后）。
// ★ 关键：**绝不用 descRaw 覆盖 desc**。包内 desc 是解析好的权威文本，descRaw 才是坏的那一边；
//   两者不一致时再往下看一步：**磁盘上那份 research 里已经手工修好的 descRaw 如果和 desc 对得上，就沿用它**
//   （业主 2026-10-30：重导入不许把手工修复冲掉）；两边都对不上才记进 `_extract.descMismatches`，
//   交给 tools/build-data.mjs 的生成期护栏（那里是 error，会拒绝写盘）——宁可构建失败，也不许静默写坏文案。
// 归一化的实现只有一份：tools/research-normalize.mjs 的 normalizeImportedTree（与炸惊导入器共用同一套规则，
// 文档注释里写着理由）。调用方只负责告诉它「官方图标集」与「磁盘上那份 research」，再收三类结果。
//
// ⚠ skipSections 必须把 `bondAnnOverrides` 也排除（与 import 时同一口径）：那是包内的替换文本片段，desc **不是**
// 由 descRaw 生成的（包内两处文案本身就不一致），按设计由引擎整字段合并；下钻它只会得到假 mismatch。
const NORMALIZE_SKIP = Object.freeze(['_doc', '_extract', 'bondAnnOverrides']);
let garrisonIcons = null;
try {
  garrisonIcons = officialGarrisonTypeIcons(JSON.parse(await readFile(join(opt.data, 'cdn-resource-config.json'), 'utf8')));
} catch {
  console.log('  (data/cdn-resource-config.json 不可读；卫戍图标归一化跳过)');
}
// 磁盘上那份 research（可能带着上一轮的手工修复）：只用来「沿用已修好的 descRaw」，不做别的比较。
// 先看输出目录（原地重跑），没有再看仓库的 docs/research（跑 --out 到临时目录时也要认那份权威文件）。
let previousDoc = null;
for (const dir of [opt.out, OUT_DIR]) {
  if (previousDoc) break;
  try { previousDoc = JSON.parse(await readFile(join(dir, '20-annihilation-mods.json'), 'utf8')); } catch { /* try the next */ }
}

const out = {
  _doc: doc,
  _extract: {
    source: SOURCE,
    generator: 'tools/extract-annihilation-mods.mjs',
    counts,
    sources,
    notes,
    behaviourOnlyMods: BEHAVIOUR_ONLY,
    scheduleModel: { assumed: true, from: 'choices.schedule.mode_multi_abyss（官方 ABYSS 的 R3 / R9 / R11 三份形状）', rounds: ODD_ROUNDS },
  },
  bonds: sorted(newBonds),
  bondAnnOverrides: sorted(bondAnnOverrides),
  chessAnnBonds: sorted(chessAnnBonds),
  chess: sorted(newChess),
  garrisons: sorted(newGarrisons),
  items: { records: sorted(items), effects: sorted(itemEffects) },
  bondCards: { effects: sorted(bondCards.effects), tactic: bondCards.tactic },
  schedule: sorted(schedules),
};

// 归一化（见 tools/research-normalize.mjs 的 normalizeImportedTree）：结果进 _extract，供 build-data 的生成期护栏与人工复核
const norm = normalizeImportedTree(out, { icons: garrisonIcons, previous: previousDoc, skipSections: NORMALIZE_SKIP });
out._extract.descMismatches = norm.mismatches;
if (norm.kept.length) out._extract.descKeptFromDisk = norm.kept;
if (norm.icons.length) out._extract.iconNormalizations = norm.icons;

console.log(`mods: ${DATA_MODS.map((m) => m.id).join(', ')} (+${BEHAVIOUR_ONLY.length} behaviour-only)`);
console.log(`counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
for (const [id, b] of Object.entries(newBonds)) console.log(`  ${id}: members ${b.members.length} / visibleMembers ${b.visibleMembers.length}, thresholds ${JSON.stringify(b.thresholds)}`);
for (const [id, ann] of Object.entries(bondAnnOverrides)) console.log(`  ann ${id}: ${Object.keys(ann).join(', ')}`);
console.log(`  chessAnnBonds: ${Object.entries(chessAnnBonds).map(([c, b]) => `${c}:${b.join('+')}`).join(' ')}`);
console.log(`  chess (mod-brought): ${Object.entries(newChess).map(([c, r]) => `${c}(${r.name}, annBonds=${r.annBonds.join('+')})`).join(' ')}`);
console.log(`  garrisons (mod-brought): ${Object.keys(newGarrisons).join(' ')}`);
if (Object.keys(notes.unmatchedBondMembers).length) console.log(`  unmatchedBondMembers: ${JSON.stringify(notes.unmatchedBondMembers)}`);
if (Object.keys(notes.droppedChessBonds).length) console.log(`  droppedChessBonds: ${JSON.stringify(notes.droppedChessBonds)}`);
console.log(`  items: ${Object.values(items).map((i) => `${i.id}(${i.name}${i.isGolden ? '/' + '精锐' : ''}, ${i.giveBondId})`).join(' ')}`);
console.log(`  item effects: ${Object.keys(itemEffects).join(', ')}`);
console.log(`  归一化: descMismatches=${norm.mismatches.length} kept=${norm.kept.length}${norm.icons.length ? ` icons=${norm.icons.length}` : ''}${garrisonIcons ? '' : ' (no icon set)'}`);

if (opt.check) { console.log('--check: nothing written'); process.exit(0); }
await mkdir(opt.out, { recursive: true });
const text = `${JSON.stringify(out, null, 2)}\n`;
const dest = join(opt.out, '20-annihilation-mods.json');
await writeFile(dest, text);
console.log(`wrote ${dest} (${Buffer.byteLength(text)} B)`);
