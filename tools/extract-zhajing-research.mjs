#!/usr/bin/env node
// tools/extract-zhajing-research.mjs — 炸惊模拟 (ZHAJING) 内容抽取：整合包构建产物 → docs/research/17..19。
//
// WHAT THIS IS. 炸惊模拟 comes from an external mod package (0.3.1-mod.4). Its `data/*.json` is a *build product* of
// that package's own `tools/build-data.mjs` against a 0.3.1 excel snapshot, so the only honest way to bring its content
// into this repository is to read those files and re-emit them as research inputs — never to copy them into `data/`
// (AGENTS.md: `data/*.json` is generated only) and never to retype records by hand.
//
//   node tools/extract-zhajing-research.mjs [--ref <dir>] [--data <dir>] [--out <dir>] [--report] [--check]
//
//     --ref     the reference package's data directory (default modref/v2.1/data)
//     --data    this repository's data directory, read for the field-alignment comparison (default data)
//     --out     where the research files go (default docs/research)
//     --report  print the per-category field alignment (always printed; --report keeps it machine-readable)
//     --check   extract in memory and print a summary; write nothing (useful to see the numbers again)
//
// SELECTION RULE. 炸惊 content is "every record the package's data has and this repository's data does not", which is
// exact because 0.3.3 and 0.3.1-mod.4 share the same official base records: the package only ever *added* records
// (205 `chess_zj_*` + 2 `chess_chen3_*`, 238 `garrison_zj_*` + 10 `garrison_mujica_*`, 11 items, 15 tokens, 2 bands,
// 5 bonds) plus one `zj` overlay block on existing bonds. The script asserts each selected id really belongs to that
// family, so a future package whose diff is not pure ZHAJING content fails loudly instead of silently importing drift.
//
// FIELD ALIGNMENT (the task's hard requirement). For every category the script compares the selected records' key sets
// with this repository's own records of the same category and reports, per category:
//   * `extra`   — keys the package's records have that 0.3.3 has nowhere. Each one is either kept on purpose (a ported
//                 engine handler reads it: `grantOnly`, `pureStrong`, `diyFor`, `displayTokens`, `zjOnly`, `zhajing`)
//                 or dropped (`form`, `teamId`, `charId`/`isGolden` on tokens, `stackMax`/`stackGroup` on items — no
//                 0.3.3 reader, values recorded in `_doc` so nothing is lost).
//   * `missing` — keys 0.3.3 uses on that category and the package's records lack. Structural ones are filled with the
//                 repository's own default for records that lack them (`battleRuneKey: null`, `shopExcludedBy: null`,
//                 `spec: null`, `variants: {}`, band `victorCount`/`rewardModulus`/`unlockDesc`); the fills that are a
//                 *guess* rather than the observed default are marked `[ASSUMED]` in the emitted `_doc`.
//   * `absent`  — keys 0.3.3 only ever writes conditionally (`potDown`, `placeOnRanged`) and whose absence is itself
//                 meaningful; listed, not filled (see `_doc`).
//
// TEXT / ICON NORMALIZATION (2026-10-29). The package's own 0.3.1 builder emitted three classes of bad text, and this
// extractor used to copy them into docs/research verbatim (23 hand fixes were needed): `desc` newlines stored as the
// two-character escape `\n`, `desc`/`descRaw` disagreeing (the blackboard cap 「（每场作战至多N层）」 lost from descRaw),
// and `eventTypeIcon: "icon_server"` — a name the official icon set does not have. Every imported record now goes through
// tools/research-normalize.mjs (`desc = richTextPlain(descRaw)`, cap note restored from the record's own bb, icon mapped by
// `eventTypeDesc` onto the official set read from data/cdn-resource-config.json). The current research sources are already
// correct, so this pass is a no-op on them; it only bites when that package (or an older one) is imported again. 盟约的
// `zj` 覆盖块 / bond effectDesc 例外，见该模块头注释。
//
// DETERMINISM. No clock, no randomness, sorted ids, 2-space indented JSON with a trailing newline: re-running the
// extractor on the same package reproduces the three files byte for byte.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeDescPairs, normalizeEventTypeIcon, officialGarrisonTypeIcons, restoreBlackboardCapNote } from './research-normalize.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** The reference package's temporary extraction directory (see handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §5.8). */
const REF_DIR = join(ROOT, 'modref', 'v2.1', 'data');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'docs', 'research');

/** Mode-record keys this build does not carry (see the emitted `_doc` for the reason of each). */
const MODE_DROPPED = Object.freeze({
  // dead in the package itself: no JS reference anywhere in modref/v2.1/server, shared or public/js
  bountyCoinMul: '包内零引用（server/shared/public/js 全树 grep 无命中）→ 死字段',
  // no-ops: the value is the identity of what 0.3.3 already does
  damageCap: '0 = 无伤害上限，与 0.3.3 现状同值 → no-op',
});

/**
 * Mode-record keys that move into the record's nested `economy` block. 0.3.3's `gamedata.js` reads these through its
 * economy accessors (`gd.benchSize`, `gd.income`, `gd.chessPrice`, …), and a mode record's `economy` is deep-merged
 * over `config.economy` by the `GameData` constructor, so the nested form is the one that works without a new hook.
 */
const MODE_ECONOMY = Object.freeze([
  ['income', 'income'],
  ['incomeCap', 'incomeCap'],
  ['chessPrice', 'chessPrice'],
  ['benchSize', 'benchSize'],
  ['equipPerChess', 'equipPerChess'],
  ['interest', 'interest'],
]);

/**
 * Chess-record keys the package has and 0.3.3 has nowhere. `keep` = a ported handler reads it; the rest are dropped
 * with their values recorded in the emitted `_doc.chessDroppedKeys`.
 */
const CHESS_KEEP = Object.freeze(['zhajing', 'grantOnly', 'pureStrong', 'diyFor', 'displayTokens']);
const CHESS_DROP = Object.freeze({
  form: '与同记录的 status 完全同值（"2/1/4/0" = phase/level/skillLevel/equipLevel），包内 JS 零引用 → 冗余派生字段',
  teamId: '包内 JS 零引用（mujica 五人由 mujicaShip 盟约的 members / 惊变羁绊计数，不读 chess.teamId）',
});

/** Token-record keys the package has and 0.3.3 has nowhere; both are 0.3.1 build leftovers. */
const TOKEN_DROP = Object.freeze({
  charId: '0.3.3 的 token 记录不带干员 id（归属走 owners / variants）',
  isGolden: '0.3.3 的 token 记录没有 normal/精锐之分',
});

/** Item-record keys the package has and 0.3.3 has nowhere (0.3.1 的堆叠系统，0.3.3 整体没有这个字段). */
const ITEM_DROP = Object.freeze(['stackMax', 'stackGroup']);

const args = process.argv.slice(2);
const opt = { ref: REF_DIR, data: DATA_DIR, out: OUT_DIR, report: false, check: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ref' || a === '--data' || a === '--out') {
    const v = args[++i];
    if (!v) { console.error(`${a} needs a directory`); process.exit(2); }
    opt[a.slice(2)] = resolve(ROOT, v);
  } else if (a === '--report') opt.report = true;
  else if (a === '--check') opt.check = true;
  else if (a === '--help' || a === '-h') { console.log('usage: node tools/extract-zhajing-research.mjs [--ref <dir>] [--data <dir>] [--out <dir>] [--report] [--check]'); process.exit(0); }
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (!existsSync(opt.ref)) {
  console.error(`reference data directory not found: ${opt.ref}\n`
    + 'The 炸惊模拟 package is a temporary extraction (modref/, not in git). Re-extract it, or pass --ref <dir>.');
  process.exit(1);
}

const readJson = async (dir, name) => JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
const readJsonOpt = async (dir, name) => {
  try { return await readJson(dir, name); } catch { return null; }
};
/** Record keys in their original order (deterministic: JSON preserves insertion order). */
const omit = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const sortedIds = (obj) => Object.keys(obj).sort();
const pick = (obj, ids) => Object.fromEntries(sortedIds(obj).filter((id) => ids.has(id)).map((id) => [id, obj[id]]));

/** The ids the package's `name.json` has and this repository's does not (kept for reference: the selection below is marker
 * based on purpose — after a promotion `ref − data/` is empty and a diff-based selection would emit nothing). */
function newIds(ref, ours) { // eslint-disable-line no-unused-vars
  return new Set(Object.keys(ref).filter((id) => !(id in ours)));
}

/**
 * Field alignment of one category: the selected records' key union against the repository's own key union, plus the
 * per-record fills applied for keys the repository treats as mandatory-but-nullable.
 * @returns {{extra: string[], missing: string[], filled: string[]}}
 */
function alignment(ourRecords, newRecords) {
  const ourUnion = new Set();
  for (const rec of Object.values(ourRecords)) for (const k of Object.keys(rec)) ourUnion.add(k);
  const newUnion = new Set();
  for (const rec of Object.values(newRecords)) for (const k of Object.keys(rec)) newUnion.add(k);
  return {
    extra: [...newUnion].filter((k) => !ourUnion.has(k)).sort(),
    missing: [...ourUnion].filter((k) => !newUnion.has(k)).sort(),
    filled: [],
  };
}

/** Keys the emitted records carry that the package's records do not — i.e. what the extractor filled in. */
function filledKeys(pkgMap, emitted) {
  const pkgUnion = new Set();
  for (const rec of Object.values(pkgMap)) for (const k of Object.keys(rec)) pkgUnion.add(k);
  const out = new Set();
  for (const rec of Object.values(emitted)) for (const k of Object.keys(rec)) if (!pkgUnion.has(k)) out.add(k);
  return [...out].sort();
}

/** Assert every selected id matches `re` — a package whose diff is not pure ZHAJING content must fail here. */
function assertFamily(name, ids, re) {
  const bad = [...ids].filter((id) => !re.test(id));
  if (bad.length) throw new Error(`${name}: ${bad.length} record(s) are not ZHAJING content: ${bad.slice(0, 5).join(', ')}`);
}

// ===== extraction ===============================================================================

const ours = {
  chess: await readJson(opt.data, 'chess'),
  garrisons: await readJson(opt.data, 'garrisons'),
  bonds: await readJson(opt.data, 'bonds'),
  items: await readJson(opt.data, 'items'),
  tokens: await readJson(opt.data, 'tokens'),
  bands: await readJson(opt.data, 'bands'),
  config: await readJson(opt.data, 'config'),
  backups: await readJsonOpt(opt.data, 'backups'),
};
const pkg = {
  chess: await readJson(opt.ref, 'chess'),
  garrisons: await readJson(opt.ref, 'garrisons'),
  bonds: await readJson(opt.ref, 'bonds'),
  items: await readJson(opt.ref, 'items'),
  tokens: await readJson(opt.ref, 'tokens'),
  bands: await readJson(opt.ref, 'bands'),
  config: await readJson(opt.ref, 'config'),
  jibianBonds: await readJsonOpt(opt.ref, 'jibianBonds'),
};

const report = {};

// ---- 17: the two mode records + the config increments ------------------------------------------
const MODE_IDS = ['mode_single_zhajing', 'mode_multi_zhajing'];
/**
 * 房间页的模式编号与排序。包内两条 zj mode 写 `AC-5` / `sortId: 6`，与本仓的湮灭模拟**撞码**（湮灭占 AC-5/6，
 * AC-7 被两条占位占用），照搬会让房间页出现两条 AC-5。本仓重编为 AC-8 / sortId 7。
 */
const ZHAJING_CODE = 'AC-8';
const ZHAJING_SORT_ID = 7;
/** 玩家看到的模式名。包内原文带内部构建号（`炸惊模拟（BETAv0.799325）`），见下一条注释。 */
const ZHAJING_NAME = '炸惊模拟';
const modes = {};
for (const modeId of MODE_IDS) {
  const src = pkg.config.modes?.[modeId];
  if (!src) throw new Error(`package config.json has no ${modeId}`);
  if (src.difficulty !== 'ZHAJING') throw new Error(`${modeId}: difficulty ${src.difficulty}, expected ZHAJING`);
  const rec = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'jibian' || k === 'enemyJibian') continue;          // → 19-zhaijing-jibian.json
    if (k in MODE_DROPPED) continue;                              // dead / no-op (see MODE_DROPPED)
    if (k === 'leftoverFundsKept') continue;                      // → economy.leftoverFundsLost (inverted)
    if (MODE_ECONOMY.some(([from]) => from === k)) continue;      // → the nested economy block
    rec[k] = v;
  }
  const economy = {};
  for (const [from, to] of MODE_ECONOMY) if (from in src) economy[to] = src[from];
  // 0.3.3 declares the rule positively (`economy.leftoverFundsLost`); the package declares it as the carry-over flag.
  if ('leftoverFundsKept' in src) economy.leftoverFundsLost = src.leftoverFundsKept !== true;
  rec.economy = economy;
  // 房间页的模式编号（`code`）与排序：包内两条 zj mode 写 AC-5 / sortId 6 —— 那是**从湮灭模拟继承来的撞码**（湮灭占着
  // AC-5/6 与本仓的占位），照搬会让房间页出现两条 AC-5。本仓重编为 AC-8 / sortId 7（AC-5/6/7 已被湮灭与两条占位占用）。
  rec.code = ZHAJING_CODE;
  rec.sortId = ZHAJING_SORT_ID;
  // 模式名去掉包内的内部构建号（包内原文 `炸惊模拟（BETAv0.799325）`）：玩家看到的名字是 `炸惊模拟`，版本号在玩法包一行
  // （`炸惊模拟 v2.1`）已经有了，名字里再带一次内部号是噪音。包内原文记在这里与 _doc，便于回溯。
  rec.name = ZHAJING_NAME;
  // 包内两条记录 `inScope: false`（那是「官方赛季范围」的含义，对玩法包无所谓）。本仓的 inScope 是「可玩的正式模式」：
  // 湮灭模拟两条是 true，只有 TRAINING 是 false，server/studio/authoring.js 的模式列表、test/helpers/versionEquipment.mjs
  // 与 test/client-static.test.js 都按它筛。置 true 与湮灭一致。
  rec.inScope = true;
  modes[modeId] = rec;
}
report.modes = { count: MODE_IDS.length, keys: Object.keys(modes[MODE_IDS[0]]).length };

// ---- 18: the ZHAJING content records -----------------------------------------------------------
// The selection is **marker based**, not `ref − data/`: once this content is merged into data/ (which it now is), a diff
// against data/ is empty and the extractor would emit nothing. The package's own markers are the stable criterion:
//   chess  — carries a `zhajing` key (199 true + the 6 it forgot to flag) + the two 赤刃明霄陈 grant records;
//   garrisons / items — id families (a 卫戍 carries no marker at all);
//   bonds / bands — `zjOnly` (mujicaShip & the 2 strategies) or the package's dead `_zjMembershipOnly` on the other four.
const chessIds = new Set(Object.keys(pkg.chess).filter((id) => pkg.chess[id].zhajing !== undefined || /^chess_chen3_[ab]$/.test(id)));
assertFamily('chess', chessIds, /^chess_(zj_\w+|chen3)_[ab]$/);
const garrisonsIds = new Set(Object.keys(pkg.garrisons).filter((id) => /^garrison_(zj|mujica)_/.test(id)));
// a 卫戍 has up to four forms (_a.._d: normal / golden / the two 部署-only variants) and the 10 mujica ones have none
assertFamily('garrisons', garrisonsIds, /^garrison_(zj|mujica)_\w+$/);
const bondIds = new Set(Object.keys(pkg.bonds).filter((id) => pkg.bonds[id].zjOnly === true || pkg.bonds[id]._zjMembershipOnly === true));
const itemIds = new Set(Object.keys(pkg.items).filter((id) => /^chess_item_(jibian|sees|mujica)_/.test(id)));
assertFamily('items', itemIds, /^chess_item_(jibian|sees|mujica)_\w+$/);
const tokenIds = new Set(Object.keys(pkg.tokens).filter((id) => !(id in ours.tokens)));
assertFamily('tokens', tokenIds, /^token_/);
const bandIds = new Set(Object.keys(pkg.bands).filter((id) => pkg.bands[id].zjOnly === true));
assertFamily('bands', bandIds, /^band_zj_/);

const chess = {};
for (const [id, rec] of Object.entries(pick(pkg.chess, chessIds))) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k in CHESS_DROP) continue;
    out[k] = v;
  }
  chess[id] = out;
}
/**
 * Normalisations the 0.3.3 loadout schema needs and the 0.3.1 build did not always write. None of them changes a number:
 *   1. `skills[]` must contain **exactly one** entry with `isDefault: true`, and it is the entry equal to `skill`
 *      (0.3.3's loadout choice list, docs/DATA.md §2). The package only sometimes wrote the flag.
 *   2. `modules[]` the same: one `isDefault`, the entry equal to `module.id` (§2.2).
 *   3. `module` is `{id, name, type, level, active}`; a few records carry the modules[] entry shape instead (no `id`,
 *      a `uniEquipId`) — give it `id` so the loadout lookup resolves.
 *   4. a chess `tokens` entry the package's own tokens.json does not have either (chess_zj_12's token_10068_kalts2_mtship)
 *      is dropped from the list; a dangling id is not a record this repository can serve.
 * @returns {{[k: string]: any[]}} what was repaired, for the emitted `_doc` / `_extract`
 */
function normalizeChess(map, tokenMaps) {
  const out = { skillsDefault: [], skillFlagStripped: [], noSkill: [], modulesDefault: [], modulesCleared: [], moduleId: [], droppedTokens: [] };
  for (const [id, c] of Object.entries(map)) {
    if (Array.isArray(c.skills) && c.skills.length && !c.skills.some((s) => s && s.isDefault === true)) {
      const hit = c.skills.find((s) => s && s.index === c.skill?.index) ?? c.skills[0];
      if (hit) { hit.isDefault = true; out.skillsDefault.push(id); }
    }
    // 0.3.3 的 `skill` 记录本身**不带** `isDefault`（那个标记只属于 `skills[]` 的对应条目）；包内把整条 skills 条目连同
    // `isDefault` 一起复制进了 `skill`，于是 shared/plugins/validate.js 的「skill 必须等于 default 条目」会判不等。
    if (c.skill && typeof c.skill === 'object' && 'isDefault' in c.skill) {
      delete c.skill.isDefault;
      out.skillFlagStripped.push(id);
    }
    // 官方**本来就没有技能**的单位（`character_table.char_4220_kormr.skills === []`，虎狼丸）：包内也是 `skill: null,
    // skills: []`。0.3.3 的字段语义没错，但 `shared/plugins/validate.js` 的「每条棋都要有 skills」对它是假警报 ——
    // 按 Lead 的裁决（2026-10-28）打显式标记 `noSkill: true`，让校验只对**这一种形状**豁免（不造技能、不删记录：
    // 「纯粹的强大」/「总攻击」按 id 发放它，造技能会在 UI 上多一个假入口，删记录会让卡片静默空发）。
    if (c.skill == null && (c.skills ?? []).length === 0) {
      c.noSkill = true;
      out.noSkill.push(id);
    }
    if (Array.isArray(c.modules) && c.modules.length) {
      // 0.3.3 writes `isDefault` on exactly the entry equal to `module` — and none at all when the record has no default
      // module (`module.id === null` / `active: false`: 蒂比, 凛御银灰). The package sometimes wrote one anyway.
      const want = c.module?.active === true ? (c.module?.id ?? null) : null;
      if (want === null) {
        if (c.modules.some((m) => m && m.isDefault)) {
          for (const m of c.modules) delete m.isDefault;
          out.modulesCleared.push(id);
        }
      } else if (!(c.modules.filter((m) => m && m.isDefault === true).length === 1 && c.modules.some((m) => m && m.isDefault === true && m.uniEquipId === want))) {
        for (const m of c.modules) delete m.isDefault;
        const hit = c.modules.find((m) => m && m.uniEquipId === want) ?? c.modules[0];
        if (hit) hit.isDefault = true;
        out.modulesDefault.push(id);
      }
    }
    if (c.module && typeof c.module === 'object' && !('id' in c.module) && c.module.uniEquipId) {
      c.module = { id: c.module.uniEquipId, ...c.module };
      out.moduleId.push(id);
    }
    if (Array.isArray(c.tokens)) {
      const keep = c.tokens.filter((t) => tokenMaps.some((m) => t in m));
      if (keep.length !== c.tokens.length) {
        out.droppedTokens.push([id, c.tokens.filter((t) => !keep.includes(t))]);
        c.tokens = keep;
      }
    }
  }
  return out;
}
const chessRepairs = normalizeChess(chess, [pkg.tokens, ours.tokens]);
/**
 * 普通/精英配对的收尾 —— 2026-10-28 起 `shared/plugins/validate.js`（`PLUGIN_DATA_PAIR`）对整份默认数据收紧成一条
 * 全量规则：每条记录的 `baseId`/`goldenId` 必须指向**同一对**，`a.upgradeChessId === b.chessId` 且 **`b.upgradeChessId`
 * 必须为 null**（精英不再"升级成自己"）。包内的记录有三处不合（`chess_chen3_b`、`chess_zj_ironmn_b` 的
 * `upgradeChessId` 指向自己；`chess_zj_pure_b` 的 `baseId` 借用了另一对 `chess_zj_34_a`），这里按规则修，而不是手改 JSON：
 *
 *   1. 每条 `isGolden === true` 的记录：`upgradeChessId = null`；
 *   2. 每条精英记录都要有**自己**的普通半身：`_b` → `_a`。缺的时候（`chess_zj_pure_b`：包里只有精英那条）就地从精英
 *      复制一条镜像出来 —— 同 charId / 同 tier / 同 status，去掉只有精英才有的键（`modules` / `statsBase` / `traitBase` /
 *      `talentsBase` / `pureStrong`），`module: null`，`upgradeNum` 取常规的 3；
 *   3. 这条合成出来的 `_a` **不进任何名册**：`zhajing: false` + `visible: false`（官方 112 与炸惊 97/99 都按这两个门筛），
 *      它只是给配对校验用的脚手架 —— 玩家永远看不到它，`server/sim/content/jibian.js` 的「纯粹的强大」照旧按 id 发放
 *      `chess_zj_pure_b`。
 * @returns {{[k: string]: string[]}} 每一类改了哪些 id（进 `_extract` / `_doc`）
 */
function normalizePairs(map) {
  const out = { goldenUpgradeNull: [], synthesizedBase: [], baseUpgradeRepointed: [] };
  for (const [id, c] of Object.entries(map)) {
    if (c.isGolden === true && c.upgradeChessId != null) {
      c.upgradeChessId = null;
      out.goldenUpgradeNull.push(id);
    }
  }
  for (const [id, b] of Object.entries(map)) {
    if (b.isGolden !== true) continue;
    const expected = id.replace(/_b$/, '_a');
    if (expected === id) throw new Error(`${id}: a golden chess id must end in _b`);
    const a = map[expected];
    if (a && a.isGolden === false && a.goldenId === id) {
      if (a.upgradeChessId !== id) { a.upgradeChessId = id; out.baseUpgradeRepointed.push(expected); }
      continue;
    }
    if (a) throw new Error(`${expected}: exists but is not the normal half of ${id} (goldenId ${a.goldenId})`);
    // 就地合成普通半身（镜像精英那条：同 charId / 同 tier / 同 status）
    const base = { ...b };
    for (const k of ['modules', 'statsBase', 'traitBase', 'talentsBase', 'pureStrong']) delete base[k];
    Object.assign(base, {
      chessId: expected, baseId: expected, goldenId: id, isGolden: false,
      upgradeChessId: id, upgradeNum: 3, module: null, zhajing: false, visible: false,
    });
    map[expected] = base;
    b.baseId = expected;
    out.synthesizedBase.push(expected);
  }
  return out;
}
const pairRepairs = normalizePairs(chess);
// Summons. 15 token records are new to tokens.json; three of them are referenced by no 炸惊 chess record at all. Of those,
// token_10002_kalts_mon3tr is already the 补位 summon an operator this version has (data/backups.json `tokens`), so a
// tokens.json copy would be a second, divergent definition of the same summon — left out. The two Persona summons
// (token_makoto_thanatos / _orpheus) exist in neither file and are spawned by that operator's kit, so they are imported.
const zjTokenRefs = new Set();
for (const c of Object.values(chess)) {
  for (const t of c.tokens || []) zjTokenRefs.add(t);
  for (const s of c.skills || []) if (s?.overrideTokenKey) zjTokenRefs.add(s.overrideTokenKey);
  for (const t of c.talents || []) if (t?.tokenKey) zjTokenRefs.add(t.tokenKey);
  for (const t of c.displayTokens || []) zjTokenRefs.add(t);
}
// Idempotence guard: an entry this build previously merged keeps `chess_zj_*` variant keys, so it must NOT be treated as
// "already an official summon of this version" on the next run — otherwise a re-extraction would drop it and data/ would
// stop being byte-reproducible (measured: the two 结城理 Persona summons vanished and backups.json shrank by 3,216 B).
const mergedBefore = (id) => Object.keys(ours.backups?.tokens?.[id]?.variants || {}).some((k) => /^chess_zj_/.test(k));
const skippedTokens = [...tokenIds].filter((id) => !zjTokenRefs.has(id) && ours.backups?.tokens?.[id] && !mergedBefore(id));
for (const id of skippedTokens) tokenIds.delete(id);
const garrisons = {};
for (const [id, rec] of Object.entries(pick(pkg.garrisons, garrisonsIds))) {
  // 0.3.3 的每条卫戍都带 battleRuneKey（战斗 rune 的键；没有 rune 的为 null）。包内 10 条 mujica 卫戍缺这个键，
  // 补 null —— 与库里 130 条同样无 rune 的记录同值，是结构缺省而非假设。
  garrisons[id] = 'battleRuneKey' in rec ? rec : { ...rec, battleRuneKey: null };
}
const bonds = {};
for (const [id, rec] of Object.entries(pick(pkg.bonds, bondIds))) {
  // 包内 4 条新盟约用 `_zjMembershipOnly`（全树零引用的死字段）表达「只在炸惊里存在」，第 5 条用 `zjOnly`。
  // 统一成 `zjOnly: true`：`shared/zjBonds.js zjBondView(bonds, {merge:false})` 正是按它把炸惊专属盟约从主玩法视图里删掉。
  // `zj` 块一律搬到 bondZjOverrides（21 条一处存放，build-data 再逐个挂回记录），记录本身不带，避免两份。
  const out = omit(rec, ['_zjMembershipOnly', 'zj']);
  out.zjOnly = true;
  if (!('spec' in out)) out.spec = null;   // 0.3.3 的 spec 为 research 02 的实现规格，缺省 null
  bonds[id] = out;
}
// 21 条盟约的 `zj` 覆盖块（16 条既有 + 5 条新），逐字节取自包内，按 bondId 排序。
const bondZjOverrides = {};
for (const id of sortedIds(pkg.bonds)) {
  const zj = pkg.bonds[id]?.zj;
  if (zj && typeof zj === 'object') bondZjOverrides[id] = zj;
}
const items = {};
for (const [id, rec] of Object.entries(pick(pkg.items, itemIds))) {
  const out = omit(rec, ITEM_DROP);
  // 包内只有 3 条带 `zjOnly`（S.E.E.S 袖章 / 谜の假面 / 一件 S.E.E.S 武器），另外 8 条（惊变奖励类：奖杯、板藤、
  // 超大杯、超前消费、极速送达 ×3、S.E.E.S 后两件）没有标记 —— 于是它们在**所有模式**的商店里都能被刷到（isShopItem 只看
  // EQUIP / 非精锐 / 非 hidden / 非 shopExcluded）。本仓统一给这 11 条打 `zjOnly: true`：这是架构要求的标记（zj 专属
  // 道具一律 zjOnly），也是包内的疏漏，见 _doc「修正包内漏打的标记」。
  out.zjOnly = true;
  if (!('shopExcludedBy' in out)) out.shopExcludedBy = null;   // 0.3.3：105/115 条为 null
  items[id] = out;
}
const tokens = {};
for (const [id, rec] of Object.entries(pick(pkg.tokens, tokenIds))) {
  const out = omit(rec, Object.keys(TOKEN_DROP));
  // 0.3.3 的每个 token 都带 variants（归属干员 → 供给来源）。包内 3 条 makoto 的 Persona 召唤物没有，补空表：
  // 它们由技能直接生成，不经 chess.tokens 归属 [ASSUMED]。
  if (!('variants' in out)) out.variants = {};
  tokens[id] = out;
}
/**
 * 这 14 条召唤物**不进 `data/tokens.json`，进 `data/backups.json` 的 `tokens`** —— 这是本轮最重要的一条口径。
 *
 * 为什么不进 tokens.json：`server/sim/simdata.js rawToken(id)` 是 `raw.tokens[id] ?? fallback ?? raw.backups.tokens[id]`，
 * tokens.json **优先**。这 12 条里有 8 条本来就在 0.3.3 的 backups.json 里有一份完整记录（那些干员本版就有），另 2 条
 * （结城理的两个 Persona）包内 `op-makoto.js` 注明是 display-only、真正上场的是 backups 里那份。把它们塞进 tokens.json
 * 会**遮蔽** backups 那份的 variant 表（包内表缺 `char_XXXX@2/1/4/0` 等官方 key），主玩法的 DIY/自选召唤物于是解析不到
 * variant —— 实测就是 golden 288 场景全位移（2026-10-28 bisect：只换 tokens.json 即 MISMATCH）。
 *
 * build-data 把它们并进 backups 的对应条目：官方 variants 原样保留，只**追加**炸惊棋键（`chess_zj_76_a` 这类）与包内
 * 自带的键，所以主玩法读到的表逐字段不变。
 */
/** `data/*.json` 的 status key（`2/60/7/3` = phase/level/skillLevel/equipLevel）。 */
const statusKeyOf = (st) => (st ? `${st.phase}/${st.level}/${st.skillLevel}/${st.equipLevel}` : '');

/**
 * 0.3.3 的 token 记录用 **chessId** 做 `owners` 与 `variants` 的键；包内混用了 chessId 与 `charId@status`（那是 0.3.3 里
 * backups.json 的**补位 form 键**）。这里把每个 `charId@status` 键落到「同 charId、同 status 的那条炸惊棋」上 ——
 * 同一个召唤物，换成本仓认的地址；落不到任何记录上的键丢掉（本仓没有对应单位，留着就是悬空引用）。
 * `sources` 必须在改键之后推导（推导读的是 chess 记录）。
 * @returns {{rekeyed: [string, string, string][], dropped: [string, string][], ownersFixed: string[]}}
 */
function normalizeTokenKeys(tokenMap, chessMap) {
  const byForm = new Map();
  for (const c of Object.values(chessMap)) {
    if (c.charId && c.status) byForm.set(`${c.charId}@${statusKeyOf(c.status)}`, c.chessId);
  }
  const out = { rekeyed: [], dropped: [], ownersFixed: [] };
  const resolve = (owner) => (chessMap[owner] ? owner : byForm.get(owner) ?? null);
  for (const [tokenId, rec] of Object.entries(tokenMap)) {
    const variants = {};
    for (const [owner, v] of Object.entries(rec.variants || {})) {
      const target = resolve(owner);
      if (!target) { out.dropped.push([tokenId, owner]); continue; }
      if (target !== owner) out.rekeyed.push([tokenId, owner, target]);
      variants[target] = v;
    }
    rec.variants = variants;
    if (Array.isArray(rec.owners)) {
      const owners = [...new Set(rec.owners.map(resolve).filter(Boolean))].sort();
      if (owners.length !== rec.owners.length || owners.some((o, i) => o !== rec.owners[i])) out.ownersFixed.push(tokenId);
      rec.owners = owners;
    }
  }
  return out;
}
const tokenKeyRepairs = normalizeTokenKeys(tokens, chess);
/**
 * The reference package's 0.3.1 builder left `sources: []` on two 炸惊 summons (token_10065_demetr_dmtpos,
 * token_10071_aglna2_agairp). Derive it from the owners' own records — a skill whose `overrideTokenKey` is this token
 * means 'skill', a talent `tokenKey` means 'talent', a chess's `displayTokens` means 'display'. Derived, not guessed: if
 * nothing names the token the array stays empty and the build's integrity check reports it.
 * @returns {number} how many variants were filled
 */
function fillTokenSources(tokenId, rec, chessMap) {
  let filled = 0;
  for (const [owner, variant] of Object.entries(rec.variants || {})) {
    if (Array.isArray(variant.sources) && variant.sources.length) continue;
    const owners = owner in chessMap ? [chessMap[owner]] : Object.entries(chessMap).filter(([, c]) => c.charId && owner.startsWith(`${c.charId}@`)).map(([, c]) => c);
    const sources = new Set();
    for (const c of owners) {
      if ((c.skills || []).some((s) => s.overrideTokenKey === tokenId)) sources.add('skill');
      if ((c.talents || []).some((t) => t.tokenKey === tokenId)) sources.add('talent');
      if ((c.displayTokens || []).includes(tokenId)) sources.add('display');
    }
    if (sources.size) {
      variant.sources = ['skill', 'talent', 'display'].filter((k) => sources.has(k));
      filled++;
    }
  }
  return filled;
}
const tokenSourcesFilled = {};
for (const [id, rec] of Object.entries(tokens)) {
  const n = fillTokenSources(id, rec, chess);
  if (n) tokenSourcesFilled[id] = n;
}
const bands = {};
for (const [id, rec] of Object.entries(pick(pkg.bands, bandIds))) {
  const out = { ...rec };
  // 0.3.3 的每条策略都带这三项（victorCount 40/40 = 3、rewardModulus 40/40 = 1、unlockDesc 12/40 为 null）；
  // 包内两条炸惊策略没有这些键，按库内缺省补 [ASSUMED]。
  if (!('victorCount' in out)) out.victorCount = 3;
  if (!('rewardModulus' in out)) out.rewardModulus = 1;
  if (!('unlockDesc' in out)) out.unlockDesc = null;
  delete out.bondIds;   // tools/build-data.mjs 用 bandBondIds() 从文案与 blackboard 现算，不取输入
  bands[id] = out;
}
const jibianBondsMirror = Array.isArray(pkg.jibianBonds?.bonds) ? pkg.jibianBonds.bonds : [];
if (!jibianBondsMirror.length) throw new Error('package data/jibianBonds.json has no bonds (惊变羁绊)');
// 惊变羁绊 的**真源是引擎表**，不是包内 data/jibianBonds.json（那只是镜像）：server/sim/content/jibianBonds.js 把 18 条
// 表内联在模块里（浏览器端的本地战斗模拟直接加载它）。data/jibianBonds.json 因此从引擎表生成，并与包内镜像逐条核对；
// 两边不一致时以引擎表为准并告警，因为引擎读的是它。
const ENGINE_BONDS = join(ROOT, 'server', 'sim', 'content', 'jibianBonds.js');
let jibianBonds = jibianBondsMirror;
if (existsSync(ENGINE_BONDS)) {
  const mod = await import(pathToFileURL(ENGINE_BONDS).href);
  if (typeof mod.jibianBonds !== 'function') throw new Error(`${ENGINE_BONDS}: no jibianBonds() export`);
  // the table is frozen and made of frozen records: round-trip through JSON for plain, comparable values
  jibianBonds = JSON.parse(JSON.stringify(mod.jibianBonds()));
  const norm = (list) => JSON.stringify(list.map((b) => ({ id: b.id, name: b.name, tiers: b.tiers, members: b.members, effect: b.effect })));
  if (norm(jibianBonds) !== norm(jibianBondsMirror)) {
    console.warn(`  ! 惊变羁绊: 引擎表与包内 data/jibianBonds.json 不一致（引擎 ${jibianBonds.length} 条 / 包内 ${jibianBondsMirror.length} 条）→ 以引擎表为准`);
  }
}

// ---- 19: 惊变 cards + pool parameters ----------------------------------------------------------
const zjMode = pkg.config.modes.mode_single_zhajing;
const jibian = zjMode.jibian;
const enemyJibian = zjMode.enemyJibian;
if (!jibian || !Array.isArray(jibian.pool)) throw new Error('package mode record has no jibian.pool');
if (!enemyJibian || !Array.isArray(enemyJibian.pool)) throw new Error('package mode record has no enemyJibian.pool');
const jibianPool = jibian.pool;
const enemyPool = enemyJibian.pool;
const { pool: _dropJibianPool, ...jibianParams } = jibian;
const { pool: _dropEnemyPool, ...enemyJibianParams } = enemyJibian;

// ---- text / icon normalization (the three package defects; tools/research-normalize.mjs) --------
// Every record this file emits is passed through the shared normalizer before it is written, so re-importing the same
// (or an older) package cannot put the bad text back into docs/research. The current sources are already normalized by
// hand, so on today's input this pass changes nothing — it is the guard against the *next* import.
const NORMALIZATIONS = { descPairs: [], capNotes: [], eventTypeIcons: [] };
/** The official garrison type icons, derived from the committed CDN resource list (never a hard-coded name list). */
const CDN_CONFIG = join(ROOT, 'data', 'cdn-resource-config.json');
let officialIcons;
try {
  officialIcons = officialGarrisonTypeIcons(JSON.parse(await readFile(CDN_CONFIG, 'utf8')));
} catch (e) {
  throw new Error(`cannot read the official garrison icon set from ${CDN_CONFIG}: ${e.message}`, { cause: e });
}
if (!officialIcons.size) throw new Error(`${CDN_CONFIG}: no assets/ui/garrisonTypeIcon/*.png entry (the official icon set is empty)`);
// Order matters: the blackboard cap note is restored into descRaw FIRST, then desc = plain(descRaw) sees the repaired raw.
for (const [category, map] of Object.entries({ chess, garrisons, bonds, items, backupTokens: tokens, bands })) {
  for (const [id, rec] of Object.entries(map)) {
    if (category === 'garrisons' && restoreBlackboardCapNote(rec)) NORMALIZATIONS.capNotes.push(id);
    normalizeDescPairs(rec, `${category}.${id}`, NORMALIZATIONS.descPairs);
    if (category === 'garrisons') {
      const fix = normalizeEventTypeIcon(rec, officialIcons);
      if (fix) NORMALIZATIONS.eventTypeIcons.push([id, fix.from, fix.to]);
    }
  }
}
// 惊变卡片只有 `desc`（没有 descRaw）：同样解掉字面 `\n`（当前包内 0 处，规则统一）。
for (const [i, card] of [...jibianPool, ...enemyPool].entries()) normalizeDescPairs(card, `jibian.cards[${i}]`, NORMALIZATIONS.descPairs);
// 不归一化的两处（见 tools/research-normalize.mjs 头注释）：map 里的 `bondZjOverrides` 是包内 `zj` 覆盖块的原样片段，
// 以及盟约的 effectDesc/effectDescRaw（占位符由 formatBondEffect 现算，docs/DATA.md §3）。

// ---- alignment report --------------------------------------------------------------------------
report.chess = alignment(ours.chess, chess);
report.garrisons = alignment(ours.garrisons, garrisons);
report.bonds = alignment(ours.bonds, bonds);
report.items = alignment(ours.items, items);
report.tokens = alignment(ours.tokens, tokens);
report.bands = alignment(ours.bands, bands);
report.chess.filled = filledKeys(pkg.chess, chess);
report.garrisons.filled = filledKeys(pkg.garrisons, garrisons);
report.bonds.filled = filledKeys(pkg.bonds, bonds);
report.items.filled = filledKeys(pkg.items, items);
report.tokens.filled = filledKeys(pkg.tokens, tokens);
report.bands.filled = filledKeys(pkg.bands, bands);
const cardKeys = new Set();
for (const c of [...jibianPool, ...enemyPool]) for (const k of Object.keys(c)) cardKeys.add(k);
report.jibianCards = { own: jibianPool.length, enemy: enemyPool.length, bondCount: jibianBonds.length, keys: [...cardKeys].sort() };
// the conditional keys whose absence is meaningful are not "missing", they are absent on purpose
report.chess.absent = ['potDown', 'placeOnRanged'];

const counts = {
  chess: Object.keys(chess).length,
  garrisons: Object.keys(garrisons).length,
  bonds: Object.keys(bonds).length,
  bondZjOverrides: Object.keys(bondZjOverrides).length,
  items: Object.keys(items).length,
  backupTokens: Object.keys(tokens).length,
  bands: Object.keys(bands).length,
  jibianBonds: jibianBonds.length,
  jibianCards: jibianPool.length,
  enemyJibianCards: enemyPool.length,
};
report.counts = counts;

/** The package's own reference-package provenance line shared by the three files. */
const SOURCE = 'modref/v2.1/data（炸惊模拟整合包公开版 v2.1 = Stronghold-Protocol-0.3.1-mod.4 的构建产物）';

const doc17 = [
  '炸惊模拟（ZHAJING）的两条 mode 记录 —— 由 tools/extract-zhajing-research.mjs 从 ' + SOURCE + ' 抽取，',
  'tools/build-data.mjs 合并进 data/config.json 的 config.modes。字段只保留 0.3.3 真实存在（或有 P2 钩子要读）的键。',
  '',
  '迁移（不丢值）：income / incomeCap / chessPrice / benchSize / equipPerChess / interest 六项搬进记录的嵌套 economy 块',
  '（0.3.3 的 gamedata 通过 gd.income() / gd.benchSize / gd.chessPrice() 等 accessor 读 economy，且 GameData 构造时把',
  'mode.economy 深合并到 config.economy 之上 —— 嵌套形态无需新钩子即生效）；leftoverFundsKept:true → economy.leftoverFundsLost:false',
  '（0.3.3 的该键是正向声明，注意不要写成 leftoverFundsLost:true）。',
  '',
  '剥掉的键（值记录在此，将来要吃回来照抄即可）：',
  Object.entries(MODE_DROPPED).map(([k, why]) => `  · ${k}（包内 ${JSON.stringify(zjMode[k])}）：${why}`).join('\n'),
  '  · jibian / enemyJibian：整块搬到 19-zhaijing-jibian.json（卡片内容 + 池级参数），build-data 再拼回 mode 记录。',
  '',
  '原样保留、但 0.3.3 目前还没有读取者的键（P2 引擎层要接的钩子，值不丢）：allyScale、spPhaseKinds、bondLayerCap、',
  'diyEnabled、enemyResMul、enemyCountMul、hiddenBossHpMul、rewardOffer、shopGift、expressPool / expressCards / expressGroups、',
  'morphEquipSlot、bountyAfterPhase。其中 express* / morphEquipSlot / shopGift / rewardOffer 是包内自带玩法系统，',
  '0.3.3 与 P2 的钩子清单里都没有对应落点 —— 保留为「将来可接」的数据，不参与本轮接线。',
  '',
  '⚠ 两条容易抄错的增量：',
  '  · bans.ZHAJING = {core:3, addon:4} —— 以包内 data/config.json 为准。包内 server/match/gamedata.js 的 DEFAULTS 里',
  '    有一份 {core:2, addon:2} 的兜底值，那是「数据缺失时的缺省」，不是数据本身；抄兜底值会让炸惊的禁盟约数量偏小。',
  '  · hiddenCore.difficulties 在包内已经是 ["NORMAL","HARD","ABYSS","ZHAJING"]：本文件只写增量 ["ZHAJING"]，',
  '    build-data 追加到 0.3.3 的 [' + "'NORMAL','HARD','ABYSS'" + '] 之后，结果与包内一致。',
  '· code / sortId 重编：包内两条 zj mode 写 code:"AC-5"、sortId:6 —— 那是从湮灭模拟继承的**撞码**（湮灭占 AC-5、',
  '  本仓 AC-5/6/7 已被湮灭与两条占位占用），照搬会让房间页出现两条 AC-5。本仓改用 code:"AC-8"、sortId:7。',
  '· name 去内部构建号：包内原文是 "炸惊模拟（BETAv0.799325）"，本仓落 "炸惊模拟" —— 玩家看到的名字不该带内部构建号，',
  '  版本号在玩法包那一行（炸惊模拟 v2.1）已经有了（2026-10-28 Lead 裁决）。',
  '· rewards.difficultyFactor 没有 ZHAJING 项：包内也没有（包内表只有 FUNNY/NORMAL/HARD/ABYSS），不臆造；',
  '  0.3.3 读缺失项时按难度回落（见 handoff 报告的确认项）。',
  '· 两条记录的 rounds / enemyScale / bossHpScale 逐字段取自包内（0.3.1 用同一批官方关卡算出的表），',
  '  bossHpScale 比 0.3.3 多 hpMul/atkMul/baseHp/ladder 四个键（包内 boss 血池算法用），0.3.3 的 bossPoolShareOf',
  '  只读 bloodPointKey / unaffectedByEnemyScale，多余键惰性无副作用。',
].join('\n');

const doc18 = [
  '炸惊模拟（ZHAJING）专属内容记录 —— 由 tools/extract-zhajing-research.mjs 从 ' + SOURCE + ' 抽取。',
  'tools/build-data.mjs 把它们并进 data/chess.json / garrisons.json / bonds.json / items.json / tokens.json /',
  'bands.json 与新的 data/jibianBonds.json。隔离靠记录标记，不靠独立数据集：',
  '  · chess：zhajing:true（主玩法 visibleChess 要求 visible===true，天然拿不到）+ 全部 visible:false',
  '  · items / bands：zjOnly:true；bonds：zjOnly:true（5 条新盟约）+ 既有盟约的 zj 覆盖块',
  '',
  `计数：chess ${counts.chess}、garrisons ${counts.garrisons}、bonds ${counts.bonds}、bondZjOverrides ${counts.bondZjOverrides}、`,
  `items ${counts.items}、backupTokens ${counts.backupTokens}、bands ${counts.bands}、jibianBonds ${counts.jibianBonds}。`,
  '',
  '字段对齐（脚本按本仓同类记录的键集逐项比对，详见 _extract.alignment）：',
  '  · chess 多出的键：' + report.chess.extra.join(', ') + '；保留 ' + CHESS_KEEP.join('/') + '（P2/P3 移植的 handler 读它们：',
  '    grantOnly 决定进不进卡池、pureStrong 是「纯粹的强大」斯卡蒂、diyFor 是 DIY 槽位、displayTokens 供 standIn）；',
  '    剥掉 ' + Object.keys(CHESS_DROP).join('/') + '：' + Object.entries(CHESS_DROP).map(([k, w]) => `${k} = ${w}`).join('；'),
  '  · chess 缺的键：placeOnRanged（0.3.3 只按特征文案命中时写入的布尔；缺省时 shared/highGround.js 仍回落到中文文案匹配）——',
  '    potDown（0.3.3 只在「低潜能会改变」时写；207 条里 48 条没有 → 那 48 条在低潜能下与满潜能同值 [ASSUMED]）。',
  '  · garrisons：键集与 0.3.3 完全一致；10 条 garrison_mujica_* 缺 battleRuneKey，补 null（库内同样无 rune 的 130 条的取值）。',
  '  · bonds：包内 4 条新盟约用死字段 _zjMembershipOnly、第 5 条用 zjOnly —— 统一为 zjOnly:true，',
  '    否则那 4 条会漏进主玩法的盟约列表（shared/zjBonds.js zjBondView 只在 zjOnly 上做剥离）。mujicaShip 缺 spec，补 null。',
  '  · items：键集一致；剥掉 stackMax/stackGroup（0.3.1 的堆叠字段，0.3.3 全库没有这个键）；shopExcludedBy 缺省 null。',
  '  · tokens → **backupTokens**：14 条召唤物不进 `data/tokens.json`，进 `data/backups.json` 的 `tokens`（理由见下）；',
  '    剥掉 charId/isGolden（0.3.1 构建遗留，0.3.3 的 token 记录没有）；3 条 makoto Persona 召唤物缺 variants，补 {} [ASSUMED]；',
  '    2 条召唤物（token_10065_demetr_dmtpos / token_10071_aglna2_agairp）包内 `sources: []`，按归属干员的记录现推',
  '    （skill.overrideTokenKey → "skill"）—— 见 _extract.tokenSourcesFilled，推导而非猜测。',
  '    ⚠ 为什么是 backups 而不是 tokens.json：`server/sim/simdata.js rawToken(id)` = `raw.tokens[id] ?? fallback ??',
  '    raw.backups.tokens[id]`，tokens.json **优先**。这 12 条里有 8 条在 0.3.3 的 backups.json 里本来就有完整记录（那些干员',
  '    本版就有），另 2 条（结城理的两个 Persona）包内 op-makoto.js 注明是 display-only、真正上场的是 backups 那份。',
  '    塞进 tokens.json 会遮蔽 backups 的 variant 表（包内表缺 char_XXXX@2/1/4/0 等官方 key）→ 主玩法 DIY 召唤物解析不到',
  '    variant，golden 288 场景全位移（2026-10-28 bisect 实测）。build-data 因此只把这些变体**追加**进 backups 的对应条目，',
  '    官方 variants 一个键都不动。',
  '  · items / bands 的 effectId 在包内自己的 effects.json 里也不存在（eff_jibian_* / eff_sees_* / eff_mujica_* /',
  '    aceffect_band_zj_*）：炸惊专属道具与策略的数值写在玩法自己的 handler 里（server/sim/content/jibian.js、bands/battle），',
  '    不是 data/effects.json 记录。所以 shared/plugins/validate.js 对 zjOnly 记录豁免「effect 必须存在」，',
  '    卡面用记录自带的 desc / effectName（清单见 _extract.boardEffectsMissing）。',
  '  · bands：victorCount/rewardModulus/unlockDesc 缺省 3/1/null [ASSUMED]（库内 40/40、40/40、12/40 的取值）；',
  '    bondIds 由 build-data 的 bandBondIds() 现算，不取输入。',
  '  · 6 条 chess_zj_*（13/22/91 的 a、b）+ 2 条 chess_chen3_*（赤刃明霄陈，惊变「赤霄剑法」按 id 直接发放）没有 zhajing:true，',
  '    与包内一致：它们在包内是 dead 记录（visible:false 且 zhajing!==true，两边池子都进不去）。原样保留，',
  '    要不要补 zhajing:true 见 handoff 报告的待裁决项。',
  '',
  '包内 data/bonds.json.zj-block-recovered.json（900 B，奇迹盟约 zj 块的部分拷贝）未被采用：它缺 descRaw/effectDescRaw、',
  '多一个 layerMilestones，与包内 bonds.json 里 miraShip.zj 的完整块不一致，是包内遗留的半成品。',
  '',
  '普通/精英配对的收尾（2026-10-28，shared/plugins/validate.js 的 PLUGIN_DATA_PAIR 收紧后必须做）：',
  '  · 精英记录的 `upgradeChessId` 一律 null（包内 chess_chen3_b / chess_zj_ironmn_b 写成了指向自己）：',
  `    ${pairRepairs.goldenUpgradeNull.join('、') || '（无）'}；`,
  '  · `chess_zj_pure_b` 原本借用了另一对 `chess_zj_34_a` 当 baseId（镜像违规），补一条合成的普通半身',
  '    `chess_zj_pure_a`（同 charId / 同 tier / 同 status 的镜像，去掉 modules/statsBase/traitBase/talentsBase/pureStrong，',
  '    `module: null`、`upgradeNum: 3`），并把 `pure_b.baseId` 指向它。',
  '    **这条 `_a` 不进任何名册**：`zhajing: false` + `visible: false`（官方 112 / 炸惊 97·99 都按这两个门筛），',
  '    玩家永远看不到它；`server/sim/content/jibian.js` 的「纯粹的强大」照旧按 id 发放 `chess_zj_pure_b`。',
  '',
  '两个跟 0.3.3 字段口径有关的修正（不是上游漂移，是包内快照与 0.3.3 的差异）：',
  `  · \`skill\` 里多带的 \`isDefault\` 删掉（${chessRepairs.skillFlagStripped.join('、') || '（无）'}）：0.3.3 的 \`skill\` 不带这个标记，`,
  '    它只属于 `skills[]` 的对应条目；留着会让「skill 必须等于 default 条目」的校验判不等。',
  `  · **无技能单位**（${chessRepairs.noSkill.join('、') || '（无）'}）打 \`noSkill: true\`：官方 \`character_table\` 里`,
  '    `char_4220_kormr.skills === []`（虎狼丸真的没有技能），包内记录同为 `skill: null, skills: []`。本项目**不造技能**',
  '    （`server/sim/content/kits/ops/op-kormr.js` 头注释即此口径），也不删这对记录（「总攻击」按 id 发放它）——',
  '    所以只加一个显式标记，让 `shared/plugins/validate.js` 的 skills 校验对**恰好这一种形状**豁免。',
  '',
  '文本 / 图标的归一化（tools/research-normalize.mjs，2026-10-29 起每条导入记录都过一遍）：',
  '  · `desc = richTextPlain(descRaw)`（public/js/ui/richText.js 的纯函数，UI 渲染用的就是它）—— 包内 6 条 chess 的',
  '    `skill`/`skills[]` 把换行写成字面 `\\n` 并把 `desc` 截短（尾括号丢失），以 descRaw 为准一次修好；',
  '  · 黑板上限说明补回 `descRaw`：`bb.max_add_count_per_battle` 的「（每场作战至多N层）」包内只写进 `desc`，',
  '    `garrison_zj_92_a/_b` 的 descRaw 漏了它 —— 从记录自己的 desc 尾部把它补回再走 `desc = 纯文本(descRaw)`。',
  '    包里两边都没有这句说明的记录（如 garrison_zj_90_2_*）**不补**（那是改设计，不是归一化）；',
  '  · `eventTypeIcon` 只改**非法值**：官方图标集从 data/cdn-resource-config.json 的 `assets/ui/garrisonTypeIcon/*.png`',
  '    现算（不硬编码），非法名字按 `eventTypeDesc` 映射到官方四图标（整备能力→icon_gold；作战能力→icon_battle；',
  '    单次/持续/休整期叠加→icon_bond；特异化→icon_support），映射不到置空由 UI 按触发时机兜底；合法图标原样保留。',
  '  · **例外**：`bondZjOverrides`（包内 zj 覆盖块的原样片段）与盟约的 `effectDesc/effectDescRaw`（占位符由',
  '    formatBondEffect 现算）不做归一化。本次运行实际改写：desc 对 ${NORMALIZATIONS.descPairs.length} 处、',
  `    补上限说明 ${NORMALIZATIONS.capNotes.length} 条、图标 ${NORMALIZATIONS.eventTypeIcons.length} 处。`,
].join('\n');

const doc19 = [
  '炸惊模拟（ZHAJING）的惊变（jibian）内容 —— 由 tools/extract-zhajing-research.mjs 从 ' + SOURCE +
    ' 的 mode 记录 jibian / enemyJibian 抽取。',
  'tools/build-data.mjs 把它们拼回 config.modes.mode_{single,multi}_zhajing 的 jibian / enemyJibian 字段（池级参数 + pool 卡片数组）。',
  '',
  `我方惊变 ${counts.jibianCards} 张（jibian.pool）、敌方惊变 ${counts.enemyJibianCards} 张（enemyJibian.pool）；`,
  '惊变羁绊（包内独立的 data/jibianBonds.json）放在本文件的 jibianBonds：{ bonds: [{id, name, tiers, members, effect}] }，',
  'build-data 原样写成 data/jibianBonds.json（服务端 loadData 会自动读成 data.jibianBonds，无需改 DATA_FILES）。',
  '',
  '卡片记录字段集（0.3.3 没有同类记录，故以包内全集为准，逐键列出）：' + report.jibianCards.keys.join(', ') + '。',
  '  · rarity：normal / rare / epic / legend / hidden 五档，与 jibian.rarityWeights 的键一致（敌方为 normal / epic / legend）。',
  '  · bond / iconBond：卡面归属的盟约（选到后计入该盟约的盟约计数 / 惊变羁绊）。',
  '  · hidden / secondDrawOnly：包内 UI/抽取规则用的标记（原样保留）。',
  '',
  '池级参数：jibian.cards（每轮抽几张，包内 3）、jibian.rerolls（可重抽次数，4）、jibian.noCoreBondLegendWeight（20）、',
  'jibian.rarityWeights、enemyJibian.rounds（[1,6]，第 1 / 第 6 回合各抽一次）、enemyJibian.rarityWeights、',
  'flickerMs / resultMs（揭示动画时长，客户端用）、hidden / testCards（包内调试开关，原样保留）。',
  '',
  '卡的实际效果不在这里：它们在 server/sim/content/{jibian,ejibian}.js 的 effectId 注册表里（P2 移植）。',
  '本文件只负责卡面（effectId/name/desc/rarity/flavor/bond…）与抽取参数，两者以 effectId 对齐。',
].join('\n');

const files = {
  '17-zhaijing-mode.json': {
    _doc: doc17,
    _extract: {
      source: SOURCE,
      generator: 'tools/extract-zhajing-research.mjs',
      counts: report.modes,
      modeDropped: Object.fromEntries(Object.entries(MODE_DROPPED).map(([k, why]) => [k, { value: zjMode[k], why }])),
      modeMovedToEconomy: Object.fromEntries(MODE_ECONOMY.map(([from, to]) => [from, `economy.${to}`])),
      packageBans: pkg.config.bans?.ZHAJING ?? null,
      gamedataDefaultBans: { ZHAJING: { core: 2, addon: 2 } },
      emittedBans: { ZHAJING: { core: 3, addon: 4 } },
      packageCode: { code: zjMode.code, sortId: zjMode.sortId },
      emittedCode: { code: ZHAJING_CODE, sortId: ZHAJING_SORT_ID },
      packageName: zjMode.name,
      emittedName: ZHAJING_NAME,
      hiddenCorePackage: pkg.config.hiddenCore?.difficulties ?? null,
    },
    modes,
    bans: { ZHAJING: { core: 3, addon: 4 } },
    hiddenCoreDifficulties: ['ZHAJING'],
  },
  '18-zhaijing-content.json': {
    _doc: doc18,
    _extract: {
      source: SOURCE,
      generator: 'tools/extract-zhajing-research.mjs',
      counts,
      alignment: report,
      chessDroppedKeys: CHESS_DROP,
      chessRepairs,
      pairRepairs,
      tokenKeyRepairs,
      skippedTokens,
      normalizations: NORMALIZATIONS,
      tokensDroppedKeys: TOKEN_DROP,
      itemsDroppedKeys: ITEM_DROP,
      tokenSourcesFilled,
      boardEffectsMissing: {
        note: '包内自己的 effects.json 里也没有这些 effectId（eff_jibian_trophy / eff_sees_* / eff_mujica_* / aceffect_band_zj_*）：'
          + '炸惊专属道具与策略的数值写在玩法自己的 handler 里（server/sim/content/jibian.js、bands/battle），不是 data/effects.json 记录。',
        items: Object.entries(items).map(([id, it]) => [id, it.effectId]).filter(([, e]) => e).map(([id, e]) => `${id}→${e}`),
        bands: Object.entries(bands).map(([id, b]) => [id, b.effectId]).filter(([, e]) => e).map(([id, e]) => `${id}→${e}`),
      },
      bondZjRecoveredFileUnused: 'modref/v2.1/data/bonds.json.zj-block-recovered.json',
    },
    // 排序输出：合成的普通半身（chess_zj_pure_a）插在了 map 尾部，重新按 id 排一次以保证确定性
    chess: Object.fromEntries(Object.keys(chess).sort().map((id) => [id, chess[id]])),
    garrisons,
    bonds,
    bondZjOverrides,
    items,
    backupTokens: tokens,
    bands,
    jibianBonds: { bonds: jibianBonds },
  },
  '19-zhaijing-jibian.json': {
    _doc: doc19,
    _extract: { source: SOURCE, generator: 'tools/extract-zhajing-research.mjs', counts: report.jibianCards },
    jibian: { ...jibianParams, pool: jibianPool },
    enemyJibian: { ...enemyJibianParams, pool: enemyPool },
  },
};

// ===== report + write ============================================================================
const line = (s) => console.log(s);
line(`reference: ${opt.ref}`);
line(`counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
for (const cat of ['chess', 'garrisons', 'bonds', 'items', 'tokens', 'bands']) {
  const a = report[cat];
  line(`  ${cat}: extra[${a.extra.join(',') || '-'}] missing[${a.missing.join(',') || '-'}]${a.absent ? ` absent[${a.absent.join(',')}]` : ''} filled[${a.filled.join(',') || '-'}]`);
}
line(`  jibian: own=${report.jibianCards.own} enemy=${report.jibianCards.enemy} bonds=${report.jibianCards.bondCount}`);
line(`  normalized: desc/descRaw ${NORMALIZATIONS.descPairs.length}, cap-note ${NORMALIZATIONS.capNotes.length}, eventTypeIcon ${NORMALIZATIONS.eventTypeIcons.length}`);
if (opt.report) line(JSON.stringify(report, null, 2));

if (opt.check) {
  line('--check: nothing written');
  process.exit(0);
}
await mkdir(opt.out, { recursive: true });
for (const [name, obj] of Object.entries(files)) {
  const text = `${JSON.stringify(obj, null, 2)}\n`;
  await writeFile(join(opt.out, name), text);
  line(`wrote ${join(opt.out, name)} (${Buffer.byteLength(text)} B)`);
}
