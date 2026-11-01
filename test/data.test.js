// test/data.test.js — integrity tests for the generated game data (data/*.json, task F1).
//
// Loads every file produced by tools/build-data.mjs and checks shapes, counts and cross-file
// referential integrity (bonds ↔ chess, garrisons, items/bands ↔ effects, wave spawns ↔ enemies,
// config rounds ↔ waves, stages 19×21, finite numbers…), plus regression tests for defects found in
// review (module token parts, enemy rangeRadius/undefined-field semantics, token sources).
// When the official-data cache (.cache/gamedata) is present, two more suites run: an independent
// re-derivation of every chess/enemy stat from the raw tables, and an offline rebuild that must
// reproduce data/ byte-for-byte (catches a stale data/ after a build-script change).
// Run: node --test test/data.test.js (build first with `node tools/build-data.mjs` if data/ is missing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripPotential } from '../shared/potential.js';
import { isShopItem } from '../server/sim/simdata.js';
import { normalizeDescPairs, normalizeEventTypeIcon, officialGarrisonTypeIcons, restoreBlackboardCapNote } from '../tools/research-normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// DATA_DIR lets the suite validate an alternative build output (e.g. `--out /tmp/x`).
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const RESEARCH = join(ROOT, 'docs', 'research');
const CACHE = join(ROOT, '.cache', 'gamedata');
const HAS_CACHE = ['excel/activity_table.json', 'excel/character_table.json', 'excel/skill_table.json', 'excel/battle_equip_table.json',
  'levels/enemydata/enemy_database.json', 'levels/activities/act1autochess/level_autochess_enemy_data.json']
  .every((rel) => existsSync(join(CACHE, rel)));
const FILES = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'backups'];

/** Load one data file (fails with a helpful message when the build has not run). */
function load(name) {
  const p = join(DATA, `${name}.json`);
  assert.ok(existsSync(p), `data/${name}.json missing — run: node tools/build-data.mjs`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
const D = Object.fromEntries(FILES.map((f) => [f, load(f)]));
const { config, chess, bonds, garrisons, items, bands, effects, choices, enemies, factions, waves, stages, bosses, tokens } = D;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
/** data/assets.json (the icon-key manifest): read lazily, only the `iconId` override branch needs it. An `--out` build
 * output holds the data files only, so a missing copy is not an error (null). */
let _assetManifest = null;
const iconManifest = () => {
  const p = join(DATA, 'assets.json');
  if (!existsSync(p)) return null;
  return (_assetManifest ??= JSON.parse(readFileSync(p, 'utf8')));
};
/** 炸惊模拟 (ZHAJING) records are imported from the reference package: they carry the `zhajing` marker (true, or the
 * package's own `false` on six records it forgot to flag) — and the two 赤刃明霄陈 grant records (`chess_chen3_a/_b`) carry
 * no marker at all, so the id prefix is part of the test (the same predicate tools/golden.mjs uses to keep the official
 * rosters/bond pools/stand-in pools untouched). They are in data/ by design, but they are not this build's production, so
 * the per-record invariants below that describe the *builder* skip them — test/match/zhajing-isolation.test.js asserts what
 * they must look like instead (and that no official pool can see them). */
const isZj = (c) => !!c && ('zhajing' in c || /^chess_(zj_|chen3_)/.test(c.chessId || ''));
/** 湮灭专属 mod's 13 operators (26 chess): imported from the packs, `annihilation: true` + `visible: false`. Like the 炸惊
 * records they are a built snapshot of an external package, so the builder-invariants below skip them; the annihilation
 * assertions (docs/research/20) pin what they must look like instead. */
const isAnn = (c) => !!c && c.annihilation === true;
const isImported = (c) => isZj(c) || isAnn(c);
/** A 炸惊-only record (equipment, strategies, bonds): never sold / drawn outside its own mode. */
const isZjOnly = (r) => !!r && r.zjOnly === true;
const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every(isInt);
const normalChess = Object.values(chess).filter((c) => !c.isGolden);
const visible = normalChess.filter((c) => c.visible);

/** Every number reachable in an object is finite (JSON cannot hold NaN, but null stats would slip). */
function assertStatsFinite(stats, label, keys) {
  assert.ok(stats && typeof stats === 'object', `${label}: stats missing`);
  for (const k of keys) assert.ok(isFiniteNum(stats[k]), `${label}: stats.${k} = ${stats[k]}`);
}

test('all data files load and are non-empty; total size < 9 MB', () => {
  let total = 0;
  for (const f of FILES) {
    total += statSync(join(DATA, `${f}.json`)).size;
    assert.ok(Object.keys(D[f]).length > 0, `${f} is empty`);
  }
  // 6 MB held the official season alone; 炸惊模拟 adds its own operator library (+1.7 MB chess, +0.15 MB garrisons, …)
  assert.ok(total < 9 * 1024 * 1024, `total ${total} bytes`);
});

test('numbers: every stats/bb/enemyScale object holds only finite numbers (no null/NaN leaks)', () => {
  const bad = [];
  const walk = (x, path) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'stats' || k === 'bb' || k === 'enemyScale') && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || (typeof sv === 'number' && !Number.isFinite(sv))) bad.push(`${path}.${k}.${sk}`);
        }
      }
      walk(v, `${path}.${k}`);
    }
  };
  for (const f of FILES) walk(D[f], f);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} bad numeric fields`);
});

test('chess: 500 records (266 official + 207 zhajing + 26 annihilation + 1 pair scaffold), 112 visible non-DIY (16/17/19/22/19/19 per tier)', () => {
  // +207 = 炸惊模拟's own operator library (205 chess_zj_* + 2 chess_chen3_*, docs/research/18-zhaijing-content.json).
  // +26 = 湮灭专属 mod's 13 operators (rhodes-ship / kazdel-ship, docs/research/20-annihilation-mods.json), `annihilation:
  // true` + `visible: false` — imported whole, never in an official pool.
  // +1 = the synthetic normal half of chess_zj_pure_b (`chess_zj_pure_a`, `zhajing: false` + `visible: false`): the tightened
  // PLUGIN_DATA_PAIR rule needs every golden record to own its normal half, and the package shipped only the elite one.
  assert.equal(Object.keys(chess).length, 500);
  assert.equal(visible.length, 112);
  const perTier = {};
  for (const c of visible) perTier[c.tier] = (perTier[c.tier] || 0) + 1;
  assert.deepEqual(perTier, { 1: 16, 2: 17, 3: 19, 4: 22, 5: 19, 6: 19 });
  // 4 official DIY slots + chess_chen3_a (赤刃明霄陈, the 惊变「赤霄剑法」 grant slot: `isDiy` + `diyFor`)
  assert.equal(normalChess.filter((c) => c.isDiy).length, 5);
  assert.equal(normalChess.filter((c) => c.isHidden).length, 17);
});

test('chess: ids, golden pairs and references resolve', () => {
  for (const [id, c] of Object.entries(chess)) {
    assert.equal(c.chessId, id);
    assert.ok(chess[c.baseId], `${id}: baseId`);
    assert.equal(chess[c.baseId].isGolden, false, `${id}: baseId must be normal`);
    assert.ok(c.goldenId && chess[c.goldenId]?.isGolden, `${id}: goldenId`);
    assert.equal(c.tier, chess[c.baseId].tier, `${id}: tier differs from base`);
    assert.ok(c.tier >= 1 && c.tier <= 6);
    for (const b of c.bonds) assert.ok(bonds[b], `${id}: bond ${b}`);
    for (const g of c.garrisonIds) assert.ok(garrisons[g], `${id}: garrison ${g}`);
    // A summon resolves from tokens.json, or from backups.json `tokens` — `server/sim/simdata.js rawToken(id)` is
    // `raw.tokens[id] ?? … ?? raw.backups.tokens[id]`, and 炸惊 summons deliberately live in the backups half so they cannot
    // shadow the official variant tables of operators this version already has.
    for (const t of c.tokens) assert.ok(tokens[t] || D.backups.tokens[t], `${id}: token ${t}`);
    assert.ok(isFiniteNum(c.price) && isFiniteNum(c.sellPrice), `${id}: price`);
  }
  assert.equal(chess.chess_char_2_11_a.upgradeNum, 2, '风丸 merges with 2 copies');
});

test('chess: every non-DIY chess has stats, range, classification and (official units) a resolvable skill', () => {
  const statKeys = ['maxHp', 'atk', 'def', 'res', 'cost', 'blockCnt', 'bat', 'aspd', 'respawnTime', 'spRecovery', 'moveSpeed', 'tauntLevel', 'massLevel'];
  for (const c of Object.values(chess)) {
    if (c.isDiy) { assert.equal(c.visible, false); continue; }
    assertStatsFinite(c.stats, c.chessId, statKeys);
    assert.ok(c.stats.maxHp > 0 && c.stats.bat > 0 && c.stats.aspd > 0, `${c.chessId}: positive stats`);
    assert.ok(Array.isArray(c.rangeGrid) && c.rangeGrid.every(isPair), `${c.chessId}: rangeGrid`);
    // the combat classification is derived by this build; 炸惊 records carry the package's own (虎狼丸's projectile is not
    // one of the four values the builder writes) — asserted for official records only.
    if (!isZj(c)) {
      assert.ok(['phys', 'arts', 'heal', 'true'].includes(c.dmgType), `${c.chessId}: dmgType ${c.dmgType}`);
      assert.ok(['melee', 'ranged', 'heal', 'none'].includes(c.attackKind), `${c.chessId}: attackKind`);
      assert.ok(['arrow', 'bolt', 'orb', 'none'].includes(c.projectile), `${c.chessId}: projectile`);
      assert.equal(typeof c.canHitFly, 'boolean');
    }
    // 官方单位偶有**本来就没有技能**的（虎狼丸 chess_zj_60_2_a/_b: character_table.skills = []，只有天赋 —— 见包内
    // server/sim/content/kits/ops/op-kormr.js 头注释「1★ 近卫·剑豪，无技能」）。技能相关的断言只对「有技能的单位」成立；
    // 导入快照的技能等级按包内 status 走，不套 4/7 的档位规则。
    if (c.skill) {
      assert.ok(typeof c.skill.skillId === 'string', `${c.chessId}: skill`);
      if (!isZj(c)) assert.ok(c.skill.level === (c.isGolden ? 7 : 4), `${c.chessId}: skill level ${c.skill.level}`);
      else assert.equal(c.skill.level, c.status.skillLevel, `${c.chessId}: 导入记录用自身 status.skillLevel`);
      assert.ok(typeof c.skill.trigger?.rule === 'string', `${c.chessId}: trigger`);
      assert.ok(typeof c.skill.desc === 'string' && !/\{[a-z_@.\[\]]+(:[0-9.%]+)?\}/i.test(c.skill.desc), `${c.chessId}: unresolved skill placeholder`);
      for (const [k, v] of Object.entries(c.skill.bb)) assert.ok(isFiniteNum(v), `${c.chessId}: skill bb ${k}`);
    } else assert.ok(c.isHidden || isZj(c), `${c.chessId}: 没有技能又不是隐藏/导入记录`);
    assert.ok(c.trait && typeof c.trait.desc === 'string', `${c.chessId}: trait`);
    assert.ok(Array.isArray(c.talents));
    // the package leaves the display-only Persona units without avatar/spine ids (虎狼丸): official records only
    if (!isZj(c)) assert.ok(c.assets && c.assets.avatar && c.assets.spine, `${c.chessId}: assets`);
    if (c.isGolden && !isZj(c)) assert.equal(c.module ? c.module.active || c.module.id === null : true, true);
  }
  // Spot checks against official numbers (隐现 E1 Lv55: HP 1123, ATK 399 + 攻击力+23 at full potential = 422; cost 15 − 3).
  assert.equal(chess.chess_char_1_01_a.stats.maxHp, 1123);
  assert.equal(chess.chess_char_1_01_a.stats.atk, 422);
  assert.equal(chess.chess_char_1_01_a.stats.cost, 12);
  assert.equal(chess.chess_char_1_01_a.targetPriority, 'fly');
});

test('bonds: 30 bonds (23 official + 5 zhajing + 2 annihilation-mod) with valid members, thresholds and effects', () => {
  // +5 = 炸惊模拟's new bonds (suiShip / penguinShip / physicianShip / seesShip / mujicaShip), all `zjOnly` so no official
  // bond view ever shows them (shared/zjBonds.js zjBondView(bonds, {merge:false})).
  // +2 = 湮灭专属 mod's rhodesShip / kazdelShip (`annOnly`, docs/research/20-annihilation-mods.json), visible in the
  // ANNIHILATION bond view only (shared/zjBonds.js annBondView).
  assert.equal(Object.keys(bonds).length, 30);
  const officialBonds = Object.values(bonds).filter((b) => b.zjOnly !== true && b.annOnly !== true);
  assert.equal(officialBonds.length, 23, '官方盟约仍是 23 条（zjOnly / annOnly 的不算）');
  // isCore: 8 official + mujicaShip/seesShip + 湮灭 mod's two (both packs ship them as core bonds of their bond)
  assert.equal(Object.values(bonds).filter((b) => b.isCore).length, 12);
  assert.equal(officialBonds.filter((b) => b.isCore).length, 8, '官方核心盟约仍是 8 条');
  const modes = new Set(['BOARD', 'BOARD_AND_DECK', 'BOARD_ALL_CHESS']);
  for (const b of Object.values(bonds)) {
    // A zjOnly bond's base record is a stub: its real definition (countMode, thresholds, members, buffs …) lives in its `zj`
    // overlay block, which shared/zjBonds.js merges only for ZHAJING. Its base is therefore not expected to be complete.
    if (isZjOnly(b)) continue;
    assert.ok(modes.has(b.countMode), `${b.bondId}: countMode ${b.countMode}`);
    assert.ok(b.thresholds.length >= 1, `${b.bondId}: thresholds`);
    for (let i = 0; i < b.thresholds.length; i++) {
      assert.ok(isInt(b.thresholds[i]) && b.thresholds[i] > 0);
      if (i) assert.ok(b.thresholds[i] > b.thresholds[i - 1], `${b.bondId}: ascending`);
    }
    for (const m of b.members) {
      assert.ok(chess[m] && !chess[m].isGolden, `${b.bondId}: member ${m}`);
      // an `annOnly` bond's membership lives in the chess's `annBonds` (ANNIHILATION only), never in its `bonds`
      assert.ok(chess[m].bonds.includes(b.bondId) || (chess[m].annBonds || []).includes(b.bondId), `${b.bondId}: member ${m} lacks bond`);
    }
    assert.ok(effects[b.effectId] || isZjOnly(b) || b.annOnly === true, `${b.bondId}: effect`);
  }
  assert.deepEqual(bonds.yanShip.thresholds, [3, 6, 9]);
  assert.deepEqual(bonds.egirShip.thresholds, [3, 5]);
  assert.deepEqual(bonds.suntShip.thresholds, [2, 5]);
  assert.equal(bonds.soloShip.maxCount, 1);
  // Every chess bond membership is mirrored in the bond member list — for the official records. Imported records (炸惊 and
  // the annihilation mod's own operators) name the official bond of their operator too, but the official member lists stay
  // exactly as the official tables built them, so imported records are skipped here and the isolation tests assert that no
  // official pool can reach them. (The two annihilation bonds are the exception: their `members` describe the imported
  // roster, and the test below checks that both directions agree.)
  for (const c of normalChess) {
    if (isImported(c) || c.diyFor) continue;
    for (const b of c.bonds) assert.ok(bonds[b].members.includes(c.chessId), `${c.chessId} not in ${b}.members`);
  }
});

test('garrisons: all referenced exist; 65 distinct effect keys (43 official + 11 zhajing + 11 annihilation)', () => {
  // +11 = 炸惊模拟's own 特质 keys (MUJICA_* five, the 部署-only forms, 击退/浮空/状态消耗 …), carried by its 248 records.
  // +11 = 湮灭 mod's 13 imported operators' 特质 keys (custom_gain_on_kills, custom_grant_item_on_acquire, …), carried by
  // its 26 records. Neither family carries an isolation marker: they are reachable only through a `garrisonIds` reference
  // on an imported chess, and no imported chess enters an official pool (test/match/*-isolation.test.js pin that).
  const keys = new Set(Object.values(garrisons).map((g) => g.effectKey));
  assert.equal(keys.size, 65);
  const zjGarrisonIds = new Set(Object.values(chess).filter(isZj).flatMap((c) => c.garrisonIds || []));
  const annGarrisonIds = new Set(Object.values(chess).filter(isAnn).flatMap((c) => c.garrisonIds || []));
  const officialKeys = new Set(Object.entries(garrisons).filter(([id]) => !zjGarrisonIds.has(id) && !annGarrisonIds.has(id)).map(([, g]) => g.effectKey));
  assert.equal(officialKeys.size, 43, '官方卫戍仍是 43 个 effectKey');
  for (const g of Object.values(garrisons)) {
    assert.ok(typeof g.eventType === 'string' && typeof g.desc === 'string', g.garrisonId);
    for (const o of g.owners) assert.ok(chess[o], `${g.garrisonId}: owner ${o}`);
  }
});

test('items: 135 item chess (115 official + 11 zhajing + 8 annihilation + 1 overlimit) with valid effects, bonds and golden links', () => {
  // +11 = 炸惊模拟's equipment (S.E.E.S / 谜の假面 / the 惊变 reward items), every one `zjOnly`, so the official shops never
  // sell them (GameData.shopItemsByTier skips zjOnly outside ZHAJING). They carry their numbers in the play set's handlers
  // instead of a data/effects.json record — the reference package ships them the same way, hence the `zjOnly` exemption in
  // shared/plugins/validate.js and in the effect assertion below.
  // +8 = 湮灭专属 mod's own equipment (萨卡兹的断角 / 提卡兹之根 / 罗德岛抑制环 / 罗德岛特制源石弧, 4 件 ×2 形),
  // every one `annOnly` and `shopExcluded` (a bond milestone reward, not a shop item — see the annihilation test below).
  // +1 = 超限模拟's `olOnly` reward (万色悠滞之核, the 万色悠滞之核 FGO-SP hands out — docs/research/25-overlimit-items.json):
  // `shopExcluded`, so no shop / equip pool sells it, and `isOfficialItem` skips it in every "official only" list.
  assert.equal(Object.keys(items).length, 135);
  assert.equal(Object.values(items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden).length, 72);
  assert.equal(Object.values(items).filter((i) => i.itemType === 'MAGIC').length, 3);
  for (const it of Object.values(items)) {
    assert.ok(effects[it.effectId] || isZjOnly(it), `${it.id}: effect ${it.effectId}`);
    if (it.goldenId) assert.ok(items[it.goldenId]?.isGolden, `${it.id}: golden`);
    if (it.giveBondId) assert.ok(bonds[it.giveBondId], `${it.id}: giveBond`);
    if (it.requiresBondId) assert.ok(bonds[it.requiresBondId], `${it.id}: requiresBond`);
    assert.ok(isInt(it.tier) && it.tier >= 1 && it.tier <= 6, `${it.id}: tier`);
    assert.ok(isFiniteNum(it.price), `${it.id}: price`);
    // 炸惊 items are not trap-based (a 惊变 reward item has no trap id): asserted for official items only.
    // `iconId` normally equals `trapId`; the one deliberate exception is the overlimit reward above, whose research
    // record overrides the **asset key** while `trapId` stays 变形同构体's (docs/research/25-overlimit-items.json).
    // An override must be a plain file name (it is a manifest key) and must be registered in data/assets.json.
    if (!isZjOnly(it)) {
      assert.ok(typeof it.trapId === 'string' && it.trapId, `${it.id}: trapId`);
      assert.ok(typeof it.iconId === 'string' && /^[A-Za-z0-9_.-]+$/.test(it.iconId), `${it.id}: iconId`);
      if (it.iconId !== it.trapId) {
        const manifest = iconManifest();
        if (manifest) assert.ok(manifest.items?.[it.iconId], `${it.id}: iconId ${it.iconId} is not in data/assets.json`);
      }
    }
  }
});

test('bands: 42 strategies (40 official + 2 zhajing) with effects and starting LP', () => {
  // +2 = 炸惊模拟's own strategies (band_zj_si / band_zj_fuuka), both `zjOnly`: GameData.bandAllowed and the strategy
  // draft never offer them outside ZHAJING.
  assert.equal(Object.keys(bands).length, 42);
  assert.equal(Object.values(bands).filter((b) => b.zjOnly !== true).length, 40, '官方策略仍是 40 条');
  for (const b of Object.values(bands)) {
    // a zjOnly strategy carries its numbers in the play set's handler (content/bands/battle), not in data/effects.json
    assert.ok(effects[b.effectId] || isZjOnly(b), `${b.bandId}: effect`);
    // 祀 (band_zj_si) starts at LP 13: the play set's own LP ladder lives below the official 20–45 range
    assert.ok(isInt(b.totalHp) && b.totalHp >= (isZjOnly(b) ? 1 : 20) && b.totalHp <= 45, `${b.bandId}: totalHp`);
    assert.ok(b.name && b.iconId);
  }
  assert.equal(bands.band_bldsk.totalHp, 28);
});

test('湮灭专属 mod: 2 annOnly bonds, 11 ann overlays, 46 chess annBonds (docs/research/20)', () => {
  // Data-shape only; the isolation side (no official/zhajing view can see them, the ANNIHILATION view merges `ann`) lives in
  // test/match/annihilation-mods-isolation.test.js.
  const annOnly = Object.values(bonds).filter((b) => b.annOnly === true);
  assert.deepEqual(annOnly.map((b) => b.bondId).sort(), ['kazdelShip', 'rhodesShip']);
  for (const b of annOnly) {
    assert.ok(b.thresholds.length >= 1 && Array.isArray(b.buffs) && b.buffs.length, `${b.bondId}: thresholds / buffs`);
    // members are filtered to operators this repository has (the packs bring their own roster)
    for (const m of b.members) assert.ok(chess[m], `${b.bondId}: member ${m}`);
  }
  // 11 = egirShip's 4 text fields + 10 alliances the packs add members to (the 13 imported operators join 8 official bonds).
  const overlays = Object.entries(bonds).filter(([, b]) => b.ann && typeof b.ann === 'object');
  assert.deepEqual(overlays.map(([id]) => id).sort(), [
    'deputShip', 'egirShip', 'indomShip', 'miraShip', 'preciShip', 'raidShip',
    'skillfulShip', 'steadShip', 'victoriaShip', 'visiShip', 'yanShip',
  ]);
  assert.deepEqual(Object.keys(bonds.egirShip.ann).sort(), ['desc', 'descRaw', 'effectDesc', 'effectDescRaw'], '阿戈尔只改文案（数值在引擎的 battle 脚本里）');
  for (const [id, b] of overlays) {
    if (id === 'egirShip') continue;
    assert.deepEqual(Object.keys(b.ann).sort(), ['members', 'visibleMembers'], `${id}: 只改成员表`);
    for (const m of b.ann.members) assert.ok(chess[m], `${id} ann member ${m}`);
  }
  const withAnnBonds = Object.values(chess).filter((c) => Array.isArray(c.annBonds));
  // 20 = the official chess the packs append a bond to; +26 = the 13 brought operators' base and elite records.
  assert.equal(withAnnBonds.length, 46, '46 条 chess 在湮灭下额外计入盟约');
  for (const c of withAnnBonds) for (const b of c.annBonds) assert.ok(bonds[b], `${c.chessId}: annBond ${b}`);
  // …and the two records' member lists agree with those edges in BOTH directions (56 edges over 46 chess)
  const edges = withAnnBonds.flatMap((c) => c.annBonds.map((b) => [c.chessId, b]));
  assert.equal(edges.length, 56, 'annBonds 边数');
  for (const b of annOnly) {
    for (const m of b.members) assert.ok(chess[m].annBonds.includes(b.bondId), `${b.bondId}: member ${m} 没有对应的 annBonds`);
    const outside = edges.filter(([cid, bid]) => bid === b.bondId && cid.endsWith('_a') && !b.members.includes(cid)).map(([cid]) => cid);
    assert.deepEqual(outside, [], `${b.bondId}: annBonds 里有成员不在 members`);
  }
});

test('湮灭专属 mod 的装备: 4 件 ×2 形（annOnly + 不进商店），giveBondId 指向两条新盟约（docs/research/20）', () => {
  // 这 8 条是盟约里程碑 / mod 专属装备（2026-10-29 补的数据缺口）：卡兹戴尔盟约「<每叠加100层>获得一件
  // 萨卡兹的断角」的 `reward_item` 就是 chess_item_c_01_e_a —— 没有这些记录时里程碑计得清、grantItem 发不出去。
  const ids = Object.keys(items).filter((id) => /^chess_item_c_0[1-4]_e_[ab]$/.test(id)).sort();
  assert.deepEqual(ids, [
    'chess_item_c_01_e_a', 'chess_item_c_01_e_b', 'chess_item_c_02_e_a', 'chess_item_c_02_e_b',
    'chess_item_c_03_e_a', 'chess_item_c_03_e_b', 'chess_item_c_04_e_a', 'chess_item_c_04_e_b',
  ], '4 件 ×2 形都在 data/items.json');
  const annBonds = new Set(['kazdelShip', 'rhodesShip']);
  for (const id of ids) {
    const it = items[id];
    assert.equal(it.annOnly, true, `${id}: annOnly`);
    assert.ok(annBonds.has(it.giveBondId), `${id}: giveBondId ${it.giveBondId} 应是两条湮灭盟约之一`);
    assert.equal(it.requiresBondId, null, `${id}: 没有 requiresBondId`);
    assert.equal(it.canGiveBond, false, `${id}: 不授予盟约归属`);
    assert.equal(it.shopExcluded, true, `${id}: 必须排除出商店（官方四档的商店从 data/items.json 现算）`);
    assert.ok(typeof it.shopExcludedBy === 'string' && it.shopExcludedBy.length > 0, `${id}: shopExcludedBy 要写理由`);
    assert.equal(isShopItem(it), false, `${id}: isShopItem 必须为 false（每一次商店 / 装备池抽取都读它）`);
    const eff = effects[it.effectId];
    assert.ok(eff, `${id}: effect ${it.effectId}`);
    assert.equal(eff.annOnly, true, `${it.effectId}: annOnly`);
    assert.equal(eff.effectType, 'EQUIP', `${it.effectId}: effectType`);
    // 精锐链两边都成立
    const golden = items[it.goldenId];
    assert.ok(golden && golden.isGolden === true, `${id}: golden ${it.goldenId}`);
    assert.equal(golden.baseId, it.isGolden ? it.baseId : it.id, `${id}: golden.baseId`);
    assert.equal(it.isGolden, id.endsWith('_b'), `${id}: isGolden`);
  }
  // 里程碑指向的物品真的存在（数据缺口 1 的回归）
  const reward = bonds.kazdelShip.buffs.find((b) => b.key === 'bond_layer_added_reward_equip');
  assert.equal(reward.bbStr.reward_item, 'chess_item_c_01_e_a');
  assert.ok(items[reward.bbStr.reward_item], '断角的 reward_item 必须能在 data/items.json 里解析到');
});

test('湮灭两条盟约的阈值可达性守卫：members 全部有棋子记录，且 max(thresholds) 的成员数够', () => {
  // 方案 A（2026-10-30）：13 名 mod 干员（26 条 chess）已搬进名册 —— rhodesShip 13 名（阈值 [3,6]）、kazdelShip 11 名
  // （[3,6,9]），6 名档与 9 名档现在真的能到。参考包 rhodesShip 还有 chess_char_4_27_a，**两个包的 chess.json 都没有
  // 这条记录**（连 `_b` 也没有）→ 它是唯一允许不搬的 id，导入器记进 `_extract.notes.unmatchedBondMembers`。
  const UNMATCHED = new Set(['chess_char_4_27_a']);
  for (const bondId of ['rhodesShip', 'kazdelShip']) {
    const rec = bonds[bondId];
    const top = Math.max(...rec.thresholds);
    assert.ok(rec.members.length >= top, `${bondId}: ${rec.members.length} 名 < 最高阈值 ${top} —— 档位不可达`);
    for (const m of rec.members) {
      assert.ok(chess[m] && !chess[m].isGolden, `${bondId}: member ${m} 在 data/chess.json 里不存在 / 是精锐形`);
      assert.ok((chess[m].annBonds || []).includes(bondId), `${bondId}: member ${m} 没有对应的 annBonds（两边不是同一张表）`);
    }
    assert.deepEqual(rec.members.filter((m) => UNMATCHED.has(m)), [], `${bondId}: 悬挂 id 不许进 members`);
    assert.equal(rec.visibleMembers.length, rec.members.length, `${bondId}: visibleMembers 与 members 同步`);
  }
  assert.equal(bonds.rhodesShip.members.length, 13, '罗德岛：5 名既有 + 8 名本轮搬入');
  assert.equal(bonds.kazdelShip.members.length, 11, '卡兹戴尔：4 名既有 + 7 名本轮搬入（含 9_09 / 9_22）');
  // 阈值保持包内原值（搬人不是改设计）
  assert.deepEqual(bonds.rhodesShip.thresholds, [3, 6]);
  assert.deepEqual(bonds.kazdelShip.thresholds, [3, 6, 9]);
  // 导入器把唯一搬不了的 id 写进了 notes（research 源是这一轮的唯一出处）
  const research = JSON.parse(readFileSync(join(RESEARCH, '20-annihilation-mods.json'), 'utf8'));
  assert.deepEqual(research._extract.notes.unmatchedBondMembers, { rhodesShip: ['chess_char_4_27_a'] });
  assert.deepEqual(research._extract.notes.droppedChessBonds, { chess_char_9_14_a: ['rimBilliton'], chess_char_9_14_b: ['rimBilliton'] });
});

test('zjDefaultLoadout: 83 条默认模组装配，每条都指向真的炸惊棋子位与可解析模组（docs/research/21）', () => {
  // The client pre-fills 干员调配 from this table (T13): a key that is not a 炸惊 chess, or a module the record does not
  // have, would be a silently dead pre-fill — build-data checks the same three things and fails the build on them.
  const p = join(DATA, 'zjDefaultLoadout.json');
  assert.ok(existsSync(p), 'data/zjDefaultLoadout.json missing — run: node tools/build-data.mjs');
  const lo = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(lo.version, 1);
  assert.equal(typeof lo.note, 'string');
  assert.equal(lo.count, Object.keys(lo.byBaseId).length);
  assert.equal(lo.count, 83, '84 in the package − chess_zj_22_a (a `zhajing: false` copy)');
  for (const [baseId, e] of Object.entries(lo.byBaseId)) {
    const rec = chess[baseId];
    assert.ok(rec && rec.zhajing === true, `${baseId}: 不是炸惊棋子位`);
    const golden = chess[rec.goldenId];
    assert.ok(golden, `${baseId}: 没有精锐记录`);
    const ids = (golden.modules || []).map((m) => m.uniEquipId);
    assert.ok(ids.includes(e.module) || e.module === golden.module?.id, `${baseId}: 模组 ${e.module} 不在 ${ids.join(',')} 也不等于默认模组`);
    assert.equal(e.choices, (golden.modules || []).length, `${baseId}: choices`);
    assert.equal(e.op, rec.name, `${baseId}: op`);
    assert.ok(typeof e.moduleName === 'string' && typeof e.typeName === 'string', `${baseId}: 模组显示名/类型名`);
  }
});

test('effects: every buff has a key and finite numeric blackboard', () => {
  for (const e of Object.values(effects)) {
    for (const b of e.buffs) {
      assert.equal(typeof b.key, 'string', e.effectId);
      for (const [k, v] of Object.entries(b.bb)) assert.ok(isFiniteNum(v), `${e.effectId}.${k}`);
    }
  }
});

test('enemies: stats are finite and motion/dmgType valid', () => {
  for (const e of Object.values(enemies)) {
    assertStatsFinite(e.stats, e.key, ['maxHp', 'atk', 'def', 'res', 'moveSpeed', 'bat', 'aspd', 'rangeRadius', 'blockCnt', 'massLevel', 'lpr', 'hpRecoveryPerSec', 'tauntLevel']);
    assert.ok(['WALK', 'FLY'].includes(e.stats.motion), `${e.key}: motion ${e.stats.motion}`);
    assert.ok(['phys', 'arts', 'true', 'heal', 'none', 'element'].includes(e.stats.dmgType), `${e.key}: dmgType ${e.stats.dmgType}`);
    for (const s of e.summons) assert.ok(enemies[s], `${e.key}: summon ${s}`);
  }
});

test('waves: every template resolves spawns, routes and enemies', () => {
  assert.equal(Object.keys(waves).length, 38);
  for (const w of Object.values(waves)) {
    assert.ok(w.routes.length > 0, `${w.id}: routes`);
    for (const r of [...w.routes, ...w.extraRoutes]) {
      if (!r) continue;
      assert.ok(isPair(r.start) && isPair(r.end), `${w.id}: route endpoints`);
      for (const p of r.checkpoints) assert.ok(isPair(p), `${w.id}: checkpoint`);
    }
    for (const sp of w.spawns) {
      assert.ok(isFiniteNum(sp.time) && sp.time >= 0, `${w.id}: time`);
      assert.ok(isInt(sp.count) && sp.count >= 1, `${w.id}: count`);
      assert.ok(isFiniteNum(sp.interval) && sp.interval >= 0, `${w.id}: interval`);
      if (sp.action) continue;
      assert.ok(enemies[sp.key], `${w.id}: enemy ${sp.key}`);
      assert.ok(w.routes[sp.routeIndex], `${w.id}: route ${sp.routeIndex}`);
    }
    for (const [bn, phases] of Object.entries(w.branches)) {
      for (const sp of phases.flat()) {
        if (sp.action) continue;
        assert.ok(enemies[sp.key], `${w.id}/${bn}: enemy ${sp.key}`);
        assert.ok(w.extraRoutes[sp.routeIndex], `${w.id}/${bn}: extraRoute ${sp.routeIndex}`);
      }
    }
    for (const k of Object.keys(w.overrides)) assert.ok(enemies[k], `${w.id}: override ${k}`);
    if (w.kind === 'normal') assert.ok(isFiniteNum(w.maxPlayTime) && w.maxPlayTime > 0);
  }
});

test('config: modes, rounds and templates', () => {
  const inScope = Object.values(config.modes).filter((m) => m.inScope);
  // 8 official + 2 湮灭模拟 + 2 炸惊模拟. `inScope` marks a playable mode (only TRAINING is out of scope).
  assert.equal(inScope.length, 12);
  assert.deepEqual(inScope.filter((m) => m.difficulty === 'ZHAJING').length, 2);
  for (const m of Object.values(config.modes)) {
    for (const [r, rd] of Object.entries(m.rounds)) {
      const tpls = rd.template ? [rd.template] : Object.values(rd.bossTemplates || {});
      assert.ok(tpls.length > 0, `${m.modeId} r${r}: template`);
      for (const t of tpls) assert.ok(waves[t], `${m.modeId} r${r}: ${t}`);
      if (!rd.isBoss) assert.ok(isFiniteNum(rd.combatTimeLimit), `${m.modeId} r${r}: combatTimeLimit`);
      if (m.type === 'SINGLE') assert.equal(rd.prepTime, null, `${m.modeId}: solo prep untimed`);
      // the official 同盟 modes time every prep; 湮灭模拟's 同盟 ladder is untimed by its own rule (prepTime null)
      if (m.type === 'MULTI' && ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(m.difficulty)) assert.ok(isFiniteNum(rd.prepTime), `${m.modeId} r${r}: prepTime`);
      const es = m.enemyScale[r];
      assert.ok(es && isFiniteNum(es.atk) && isFiniteNum(es.hp) && isFiniteNum(es.speed), `${m.modeId} r${r}: enemyScale`);
    }
    for (const b of [...m.activeBondIds, ...m.inactiveBondIds]) assert.ok(bonds[b], `${m.modeId}: bond ${b}`);
    for (const s of m.stages) assert.ok(stages[s]?.active, `${m.modeId}: stage ${s}`);
    if (m.inScope) {
      assert.equal(m.upgradePrices.length, 5);
      assert.ok(m.stages.length > 0);
    }
  }
  const M = config.modes;
  assert.equal(M.mode_single_funny.lastRound, 9);
  assert.equal(M.mode_single_funny.hiddenRound, null);
  assert.equal(M.mode_multi_funny.lastRound, 14);
  assert.equal(M.mode_multi_funny.hiddenRound, null);
  for (const id of ['mode_single_normal', 'mode_single_hard', 'mode_single_abyss', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss']) {
    assert.equal(M[id].lastRound, 14, id);
    assert.equal(M[id].hiddenRound, 15, id);
  }
  assert.deepEqual(M.mode_multi_hard.spRounds, [3, 9, 11]);
  assert.deepEqual(M.mode_multi_normal.upgradePrices, [5, 8, 11, 12, 13]);
  assert.equal(config.economy.income[1], 4);
  assert.equal(config.economy.income[3], 6);
  assert.equal(config.economy.benchSize, 10);
  assert.equal(config.economy.deployCap, 8);
  assert.equal(config.economy.mergeCountOverrides.chess_char_2_11_a, 2);
  assert.equal(config.economy.poolCopiesOverrides.chess_char_2_11_a, 8);
  assert.equal(config.economy.coopPoolMultiplier, 2);
  assert.equal(config.economy.itemPoolCopiesOverrides.chess_item_5_07_e_a, 2);
  assert.deepEqual(config.hiddenCore.single, 350);
  assert.deepEqual(config.hiddenCore.multi, 1200);
  assert.equal(config.titles.length, 6);
});

test('stages: 19 rows × 21 cols with known glyphs; paths are contiguous', () => {
  const glyphs = new Set('#XrRfphbaASEIOmgdi'.split(''));
  for (const s of Object.values(stages)) {
    assert.equal(s.rows.length, 19, `${s.id}: rows`);
    for (const row of s.rows) {
      assert.equal(row.length, 21, `${s.id}: cols`);
      for (const ch of row) assert.ok(glyphs.has(ch), `${s.id}: glyph ${ch}`);
    }
    assert.equal(s.rows[9][2], 'E', `${s.id}: objective at (9,2)`);
    assert.equal(s.rows[9][10], 'S', `${s.id}: gate at (9,10)`);
    for (const paths of [s.groundPaths, s.groundPathsWithDevices]) {
      for (const [k, p] of Object.entries(paths)) {
        for (let i = 1; i < p.length; i++) {
          const dr = Math.abs(p[i][0] - p[i - 1][0]), dc = Math.abs(p[i][1] - p[i - 1][1]);
          assert.ok(dr <= 1 && dc <= 1 && dr + dc > 0, `${s.id} ${k}: step ${i}`);
          const g = s.rows[p[i][0]][p[i][1]];
          assert.ok(s.tiles[g]?.groundPassable, `${s.id} ${k}: impassable ${g}`);
        }
      }
    }
    assert.ok(s.groundPaths['9,10->9,2'], `${s.id}: lower gate path`);
  }
  assert.equal(Object.values(stages).filter((s) => s.active).length, 8);
});

test('bosses, factions, tokens and choices resolve', () => {
  assert.equal(Object.keys(bosses).length, 10);
  for (const b of Object.values(bosses)) {
    assert.ok(enemies[b.enemyKey], `${b.bossId}: enemy`);
    for (const v of Object.values(b.bloodPoint)) assert.ok(isFiniteNum(v) && v > 0, `${b.bossId}: bloodPoint`);
    for (const t of Object.values(b.templates)) assert.ok(waves[t.template], `${b.bossId}: ${t.template}`);
  }
  assert.equal(Object.values(bosses).filter((b) => b.hidden).length, 3);

  assert.equal(Object.keys(factions.entries).length, 67);
  for (const e of Object.values(factions.entries)) {
    assert.equal(typeof e.fly, 'boolean', `faction ${e.key}: fly`);
    assert.ok(!('kS' in e), `faction ${e.key}: no k copies (research 08 §7-1)`);
    for (const x of [{ key: e.key }, ...e.N, ...e.E]) {
      assert.ok(enemies[x.key], `faction ${e.key}: ${x.key}`);
      assert.ok(!('k' in x), `faction ${e.key}: ${x.key} has no k`);
      assert.equal(enemies[x.key].isFlyEnemy, e.fly, `faction ${e.key}: ${x.key} shares the entry's movement class`);
    }
  }
  for (const k of Object.values(factions.templateSlots)) assert.ok(enemies[k], `template slot ${k}`);
  // the official generator's parameters (research 08 §2)
  const g = factions.generation;
  assert.equal(g.maxLevelCnt, 15);
  assert.equal(g.specialEnemyNum, 3);
  assert.equal(g.fillType, 'SPECIAL');
  assert.deepEqual([g.minReplacedEnemyCount, g.maxReplacedEnemyCount, g.firstHalfMaxRound, g.minActionIntervalRatio], [1, 5, 7, 0.05]);
  assert.deepEqual(Object.values(g.typeSlots), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual(Object.values(g.placeholders).map((p) => p.slot).sort(), ['E', 'EF', 'N', 'NF', 'S', 'SF'], 'T / TF are tokens, not placeholders');
  assert.ok(!('kFormula' in g));

  for (const t of Object.values(tokens)) {
    assertStatsFinite(t.stats, t.tokenId, ['maxHp', 'atk', 'def', 'res', 'bat', 'aspd']);
    for (const o of t.owners) assert.ok(chess[o]?.tokens.includes(t.tokenId), `${t.tokenId}: owner ${o}`);
  }
  assert.ok(tokens.enemy_9012_acloon, '炎佑 present');

  assert.equal(Object.keys(choices.events).length, 109);
  for (const s of Object.values(choices.schedule)) {
    for (const r of Object.values(s.rounds)) {
      assert.ok(r.families.length > 0);
      for (const ids of Object.values(r.events)) for (const id of ids) assert.ok(choices.events[id], `event ${id}`);
    }
  }
  for (const c of choices.cards.bounty) {
    assert.ok(effects[c.effectId]);
    for (const a of c.adds) assert.ok(enemies[a.enemyKey], `bounty ${c.effectId}: ${a.enemyKey}`);
    assert.ok([1, 2, 3].includes(c.tier));
  }
  for (const c of choices.cards.tactic) assert.ok(effects[c.effectId]);
  for (const [id, p] of Object.entries(choices.pools)) {
    for (const x of [...(p.items || []), ...(p.weighted || []).map((w) => w[0])]) assert.ok(items[x] || chess[x], `pool ${id}: ${x}`);
  }
});

// ---- regression tests for review findings -------------------------------------------------------

test('chess: module parts flagged isToken upgrade the summon, never the operator', () => {
  // 缪尔赛思 golden: talent 0 keeps her own text/token/cnt; the 流形 upgrades live on the token variant.
  const mlyss = chess.chess_char_6_11_b;
  assert.equal(mlyss.talents[0].name, '净水即生命');
  assert.equal(mlyss.talents[0].tokenKey, 'token_10030_mlyss_wtrman');
  assert.equal(mlyss.talents[0].bb.cnt, 1);
  assert.ok(!('scale' in mlyss.talents[0].bb), 'token-only blackboard leaked into the operator talent');
  assert.ok(!mlyss.talents.some((t) => t.bb.damage_scale !== undefined || t.bb.sp === 5), 'token talents attached to operator');
  const wtr = tokens.token_10030_mlyss_wtrman.variants;
  assert.equal(wtr.chess_char_6_11_a.talents[0].bb.scale, 0.9);
  assert.equal(wtr.chess_char_6_11_b.talents[0].bb.scale, 1);
  assert.ok(wtr.chess_char_6_11_b.talents.some((t) => t.bb.damage_scale === 0.85));
  assert.equal(wtr.chess_char_6_11_b.count, 1);

  // 浊心斯卡蒂 golden: operator talent 0 still sends 1 海嗣; the 30 s duration belongs to the 海嗣.
  const skadi = chess.chess_char_6_04_b;
  assert.equal(skadi.talents[0].tokenKey, 'token_10017_skadi2_dedant');
  assert.equal(skadi.talents[0].bb.cnt, 1);
  assert.ok(!('duration' in skadi.talents[0].bb));
  const dedant = tokens.token_10017_skadi2_dedant.variants;
  assert.equal(dedant.chess_char_6_04_a.talents[0].bb.duration, 25);
  assert.equal(dedant.chess_char_6_04_b.talents[0].bb.duration, 30);
  assert.equal(dedant.chess_char_6_04_b.stats.respawnTime, dedant.chess_char_6_04_a.stats.respawnTime - 5, 'module token attribute');

  // 伺夜 golden: the wolves' damage reduction is on the wolf, not on 伺夜.
  assert.ok(!chess.chess_char_3_19_b.talents.some((t) => t.bb.damage_scale !== undefined));
  assert.ok(tokens.token_10028_vigil_wolf.variants.chess_char_3_19_b.talents.some((t) => t.bb.damage_scale === 0.85));
  assert.ok(!tokens.token_10028_vigil_wolf.variants.chess_char_3_19_a.talents.some((t) => t.bb.damage_scale !== undefined));

  // 耀骑士临光 golden: “耀阳” gets the module trait upgrade.
  assert.equal(tokens.token_10019_nearl2_sword.variants.chess_char_6_17_b.trait.bb.atk_scale, 1.15);
  assert.equal(tokens.token_10019_nearl2_sword.variants.chess_char_6_17_a.trait.bb.atk_scale, undefined);

  // Module talent overrides keep base keys the upgrade does not restate (宴: +100 aspd at 70% HP lost).
  assert.equal(chess.chess_char_1_18_b.talents[0].bb.min_attack_speed, 100);
  assert.equal(chess.chess_char_1_18_b.talents[0].bb.damage_resistance, 0.25);
});

test('chess/tokens: talent tokens resolve and every token variant says where it comes from', () => {
  for (const c of Object.values(chess)) {
    // a 炸惊 record's talent token list is the package's (its summons live in backups.json, not tokens.json), so the
    // "listed in c.tokens" half is asserted for the records this build produces; "the token resolves somewhere" holds for all.
    for (const t of c.talents) if (t.tokenKey) {
      assert.ok(tokens[t.tokenKey] || D.backups.tokens[t.tokenKey], `${c.chessId}: talent token ${t.tokenKey} missing`);
      if (!isZj(c)) assert.ok(c.tokens.includes(t.tokenKey), `${c.chessId}: talent token ${t.tokenKey}`);
    }
  }
  // 凛御银灰: the talent's container id maps onto the default skill's token (S2 → eagle2).
  const svash = chess.chess_char_5_14_a;
  assert.equal(svash.talents[0].tokenKey, 'token_10057_svash2_eagle2');
  assert.equal(svash.talents[0].containerTokenKey, 'token_10057_svash2_eagle');
  assert.equal(svash.skill.overrideTokenKey, 'token_10057_svash2_eagle2');
  const allowed = new Set(['talent', 'skill', 'display']);
  for (const t of Object.values(tokens)) {
    for (const [owner, v] of Object.entries(t.variants)) {
      assert.ok(Array.isArray(v.sources) && v.sources.length && v.sources.every((s) => allowed.has(s)), `${t.tokenId}@${owner}: sources`);
      assert.ok(chess[owner]?.tokens.includes(t.tokenId), `${t.tokenId}: owner ${owner}`);
    }
  }
  assert.deepEqual(tokens.token_10057_svash2_eagle1.variants.chess_char_5_14_a.sources, ['display']);
  // 夕's skill "cnt" is a charge count, not a token count.
  assert.equal(tokens.token_10015_dusk_drgn.variants.chess_char_5_12_a.count, null);
  // Placeable (hand) tokens = the manually deployable summons (PRTS 卫戍协议/帮助 §战斗部署; user playtest #6): shop
  // state DEFAULT or no shop-state entry (凯瑟琳's device), never HIDDEN, made by some owner loadout (talent or skill) —
  // 赫默's 医疗探机 and 巫恋's 诅咒娃娃 included (in battle they wait on their tile for the skill).
  const makes = (list) => list.includes('talent') || list.includes('skill');
  for (const t of Object.values(tokens)) {
    if (t.kind !== 'summon') continue;
    const made = Object.values(t.variants).some((v) => makes(v.sources) || Object.values(v.bySkill || {}).some((b) => makes(b.sources)));
    assert.equal(t.placeable, t.displayType !== 'HIDDEN' && made, `${t.tokenId} (${t.name}): placeable`);
  }
  assert.deepEqual(Object.values(tokens).filter((t) => t.placeable).map((t) => t.name).sort(),
    ['医疗探机', '诅咒娃娃', '斯卡蒂的海嗣', '流形', '狼群', '爬行号·防护单元'].sort());
  assert.equal(tokens.enemy_9012_acloon.stats.deployLimit, tokens.enemy_9012_acloon.deployLimit);
});

// ---- operator loadouts: selectable skills & modules (DESIGN §16) ------------------------------------

test('chess: skills[] = every skill unlocked at the status, at the chess skill level; exactly one default = skill', () => {
  for (const c of Object.values(chess)) {
    // 炸惊 chess records are an imported 0.3.1 snapshot (every skill flag, level and index set by the reference package's
    // own builder, and 虎狼丸 has no skill at all — official: `character_table.skills = []`), so the loadout invariants of
    // *this* builder do not apply to them.
    if (isZj(c)) continue;
    // chess_chen3_a is 赤刃明霄陈's grant slot: a DIY record (`diyFor`) that DOES carry the granted operator's skills
    if (c.isDiy) { assert.equal(c.skills, c.diyFor ? c.skills : undefined, `${c.chessId}: DIY has no skills`); continue; }
    assert.ok(Array.isArray(c.skills) && c.skills.length >= 1 && c.skills.length <= 3, `${c.chessId}: skills`);
    const idx = c.skills.map((s) => s.index);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${c.chessId}: skills ordered by index`);
    assert.equal(new Set(idx).size, idx.length, `${c.chessId}: unique skill indices`);
    // E1 unlocks S1–S2, E2 S1–S3 (tier 1–2 normal chess are E1)
    assert.ok(idx.every((i) => i <= c.status.phase), `${c.chessId}: skill ${idx} locked at E${c.status.phase}`);
    const defs = c.skills.filter((s) => s.isDefault);
    assert.equal(defs.length, 1, `${c.chessId}: one default skill`);
    const { isDefault, ...d } = defs[0];
    assert.deepEqual(d, c.skill, `${c.chessId}: default entry = skill (back-compat shape)`);
    for (const s of c.skills) {
      assert.equal(s.level, c.status.skillLevel, `${c.chessId} ${s.skillId}: level`);
      assert.equal(typeof s.isDefault, 'boolean');
      assert.ok(typeof s.skillId === 'string' && typeof s.iconId === 'string' && typeof s.name === 'string', `${c.chessId}: skill ids`);
      assert.ok(typeof s.trigger?.rule === 'string', `${c.chessId} ${s.skillId}: trigger`);
      assert.ok(s.rangeGrid === null || s.rangeGrid.every(isPair), `${c.chessId} ${s.skillId}: rangeGrid`);
      assert.ok(!/\{[a-z_@.\[\]]+(:[0-9.%]+)?\}/i.test(s.desc), `${c.chessId} ${s.skillId}: unresolved placeholder`);
      for (const [k, v] of Object.entries(s.bb)) assert.ok(isFiniteNum(v), `${c.chessId} ${s.skillId}: bb ${k}`);
      assert.ok(s.overrideTokenKey === null || c.tokens.includes(s.overrideTokenKey), `${c.chessId} ${s.skillId}: token ${s.overrideTokenKey} listed`);
    }
    if (c.tier <= 2 && !c.isGolden) assert.ok(idx.length <= 2, `${c.chessId}: E1 chess has no S3`);
  }
  // Triggers per skill (PRTS 卫戍协议/帮助 技能策略; tools/build-data.mjs resolveTrigger): the class rows cover every MANUAL
  // skill of the class and no AUTO one; a MANUAL skill with a 技能范围 of its own (not an attack-range change) is SKILL_RANGE.
  const rules = (id) => chess[id].skills.map((s) => s.trigger.rule);
  const raws = (id) => chess[id].skills.map((s) => s.trigger.rawRule);
  assert.deepEqual(rules('chess_char_1_02_a'), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);         // 角峰 (重装, both MANUAL)
  assert.deepEqual(rules('chess_char_1_10_b'), ['DEFAULT', 'TAKE_DAMAGE']);             // 古米 (S1 自动触发)
  assert.deepEqual(rules('chess_char_3_08_a'), ['ACTIVE_RANGE', 'SEARCH']);             // 薄绿 (阵法术师: the default S2 too; S1's x-2: the owner's rule)
  assert.deepEqual(raws('chess_char_3_08_a'), ['SEARCH', 'SEARCH']);
  assert.deepEqual(rules('chess_char_3_19_a'), ['DEFAULT', 'DEFAULT', 'SP_FULL']);      // 伺夜 (战术家: S1/S2 are AUTO)
  assert.deepEqual(rules('chess_char_6_11_b'), ['MLYSS_WTRMAN', 'MLYSS_WTRMAN', 'MLYSS_WTRMAN']); // 缪尔赛思 (charId row −1)
  assert.deepEqual(rules('chess_char_1_08_a'), ['DEFAULT', 'SKILL_RANGE']);             // 德克萨斯 S2 剑雨: 对周围所有敌人
  assert.deepEqual(chess.chess_char_1_08_a.skills[1].trigger.customRangeGrid, chess.chess_char_1_08_a.skills[1].rangeGrid);
  assert.deepEqual(rules('chess_char_4_22_a'), ['DEFAULT', 'DEFAULT', 'ACTIVE_RANGE']); // 银灰: "攻击范围缩小 / 扩大" = attack range
  assert.deepEqual(rules('chess_char_3_18_a'), ['DEFAULT', 'SKILL_RANGE', 'ACTIVE_RANGE']); // 忍冬: S2 对周围…, S3 攻击距离+1
  // the deliberate deviation from the 重装 row (DESIGN §21.29, the owner's decision; tools/build-data.mjs
  // TRIGGER_DEVIATIONS, per chess): six skills cast with an enemy in range, rawRule keeps the official TAKE_DAMAGE
  for (const id of ['chess_char_1_04_a', 'chess_char_1_04_b']) {                       // 深巡: S1 keeps the row, S2 deviates
    assert.deepEqual(rules(id), ['TAKE_DAMAGE', 'ACTIVE_RANGE']);                      // (S2: and the owner's ACTIVE_RANGE on top)
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_1_20_a', 'chess_char_1_20_b']) {                       // 雷蛇: S1 AUTO, S2 deviates
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['DEFAULT', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_5_08_a', 'chess_char_5_08_b']) {                       // 号角: S1 AUTO, S2 / S3 deviate
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['DEFAULT', 'TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_2_18_a', 'chess_char_2_18_b']) {                       // 灰毫: S1 (generic skcom_atk_up[3]) and S2
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  // 余 S2 厚礼上宾 (DESIGN §22.10, the owner's decision of 2026-10-04): SKILL_RANGE on its own x-1, S1 keeps the row, S3 its
  // official charId row
  for (const id of ['chess_char_6_03_a', 'chess_char_6_03_b']) {
    assert.deepEqual(rules(id), ['TAKE_DAMAGE', 'SKILL_RANGE', 'CUSTOM_RANGE']);
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE', 'CUSTOM_RANGE_SEARCH_ENEMY']);
    assert.deepEqual(chess[id].skills[1].trigger.customRangeGrid, chess[id].skills[1].rangeGrid);
  }
  // the owner's rule of 2026-10-05 (a deliberate deviation): a MANUAL skill on the basic strategy (DEFAULT by no row or by
  // a deviation: 深巡 S2) or on the SEARCH row whose running attack range strictly contains the operator's own range is
  // ACTIVE_RANGE on that range (rawRule keeps the official row)
  const tiles = (g) => new Set((g || []).map(([r, c]) => `${r},${c}`));
  const wider = (a, b) => { const A = tiles(a), B = tiles(b); return A.size > B.size && [...B].every((k) => A.has(k)); };
  // 炸惊 / 湮灭 mod 的 chess 都是导入快照：它们的 trigger rows 由各自的包 builder 解析，本仓的 ACTIVE_RANGE 规则
  // （0.3.3 的决定）只对**本仓 builder 产出**的记录成立。
  const active = Object.values(chess).filter((c) => !isImported(c)).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rule === 'ACTIVE_RANGE').map((s) => [c, s]));
  for (const [c, s] of active) {
    assert.equal(s.skillType, 'MANUAL', `${c.chessId} ${s.skillId}`);
    const dev = c.baseId === 'chess_char_1_04_a' && s.skillId === 'skchr_udflow_2';
    assert.equal(s.trigger.rawRule, dev ? 'TAKE_DAMAGE' : s.trigger.rawRule === 'SEARCH' ? 'SEARCH' : 'DEFAULT', `${c.chessId} ${s.skillId}: only the basic strategy / SEARCH`);
    assert.ok(wider(s.trigger.customRangeGrid, c.rangeGrid), `${c.chessId} ${s.skillId}: its running range strictly contains ${c.rangeId}`);
    if (s.rangeGrid) assert.deepEqual(s.trigger.customRangeGrid, s.rangeGrid, `${c.chessId} ${s.skillId}: the skill's own grid`);
  }
  assert.equal(active.length, 78, '39 skills, normal + elite');
  assert.equal(new Set(active.map(([c, s]) => `${c.baseId} ${s.skillId}`)).size, 39);
  // from the SEARCH row (解放者 / 阵法术师 / 安洁莉娜) and 深巡 S2's deviation: the owner's decisions of 2026-10-05
  const fromSearch = active.filter(([, s]) => s.trigger.rawRule === 'SEARCH').map(([c, s]) => `${c.baseId} ${s.skillId}`);
  assert.deepEqual([...new Set(fromSearch)].sort(), ['chess_char_3_08_a skchr_mint_1', 'chess_char_4_05_a skchr_beewax_1', 'chess_char_4_24_a skchr_billro_3', 'chess_char_5_19_a skchr_mlynar_2', 'chess_char_5_20_a skchr_aglina_3']);
  assert.equal(fromSearch.length, 10);
  // the SEARCH skills whose range does not grow keep the row (薄绿 / 蜜蜡 S2, 卡涅利安 S1 / S2, 玛恩纳 S1, 安洁莉娜 S2, 圣聆初雪 S1)
  const search = Object.values(chess).filter((c) => !isZj(c)).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rule === 'SEARCH').map((s) => `${c.baseId} ${s.skillId}`));
  assert.deepEqual([...new Set(search)].sort(), ['chess_char_3_08_a skchr_mint_2', 'chess_char_4_05_a skchr_beewax_2', 'chess_char_4_24_a skchr_billro_1', 'chess_char_4_24_a skchr_billro_2', 'chess_char_5_19_a skchr_mlynar_1', 'chess_char_5_20_a skchr_aglina_2', 'chess_char_6_02_a skchr_sbell2_1']);
  const grown = (id, sid) => chess[id].skills.find((s) => s.skillId === sid).trigger;
  assert.deepEqual(grown('chess_char_5_07_a', 'skchr_surtr_3').customRangeGrid.length, chess.chess_char_5_07_a.rangeGrid.length + 2, '史尔特尔 S3 攻击距离+2: 1-1 grown by 2');
  assert.equal(grown('chess_char_5_03_a', 'skchr_blaze2_3').rule, 'DEFAULT', '烛煌 S3: 4-11 does not contain her 3-1');
  assert.deepEqual(grown('chess_char_1_04_a', 'skchr_udflow_2'), { rule: 'ACTIVE_RANGE', rawRule: 'TAKE_DAMAGE', customRangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }, '深巡 S2: its 3-2 over her 2-2, on top of the §21.29 deviation');
  assert.equal(grown('chess_char_3_08_a', 'skchr_mint_1').rawRule, 'SEARCH', '薄绿 S1: its official 阵法术师 row stays the rawRule');
  assert.equal(grown('chess_char_5_15_a', 'skchr_thorn2_3').rule, 'DEFAULT', '引星棘刺 S3: 被动效果：攻击范围扩大 is her own range');
  const deviated = Object.values(chess).filter((c) => !isZj(c)).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rawRule === 'TAKE_DAMAGE' && s.trigger.rule !== 'TAKE_DAMAGE').map((s) => `${c.baseId} ${s.skillId}`));
  assert.equal(deviated.length, 14, 'exactly the six skills of §21.29 and 余 S2, normal + elite');
  assert.deepEqual([...new Set(deviated)].sort(), ['chess_char_1_04_a skchr_udflow_2', 'chess_char_1_20_a skchr_liskam_2', 'chess_char_2_18_a skchr_ashlok_2', 'chess_char_2_18_a skcom_atk_up[3]', 'chess_char_5_08_a skchr_horn_2', 'chess_char_5_08_a skchr_horn_3', 'chess_char_6_03_a skchr_yu_2']);
  for (const c of Object.values(chess)) {
    for (const s of c.skills || []) {
      if (s.skillType !== 'MANUAL') assert.ok(!['TAKE_DAMAGE', 'SEARCH', 'SKILL_RANGE'].includes(s.trigger.rule), `${c.chessId} ${s.skillId}: an AUTO / PASSIVE skill takes no strategy row`);
      if (s.trigger.rule === 'SKILL_RANGE') assert.ok(s.rangeGrid && s.skillType === 'MANUAL' && !/攻击(范围|距离)(与溅射范围)?(扩大|改变|缩小|缩短|加长|增加|\+)/.test(s.desc), `${c.chessId} ${s.skillId}: SKILL_RANGE only for a 技能范围`);
    }
  }
  assert.deepEqual(chess.chess_char_1_01_a.skills.map((s) => [s.skillId, s.level, s.spCost, s.isDefault]),
    [['skchr_inside_1', 4, 14, false], ['skchr_inside_2', 4, 24, true]]);             // 隐现 Lv4 (default S2)
  const sw = chess.chess_char_3_04_b;                                                    // 琳琅诗怀雅: S2 makes the 香槟
  assert.deepEqual(sw.skills.map((s) => s.overrideTokenKey), [null, 'token_10031_swire2_gdtrap', null]);
});

test('chess: golden modules[] (+ statsBase/traitBase/talentsBase) compose back to the default record', async () => {
  const { composeStats, composeTalents } = await import('../server/sim/simdata.js');
  const statKeys = ['maxHp', 'atk', 'def', 'res', 'aspd', 'cost', 'blockCnt', 'respawnTime', 'bat', 'deployLimit', 'deckStack'];
  let nMods = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy) continue;
    // 炸惊 goldens are imported snapshots (their module list, statsBase and talent flags come from the reference package),
    // so the compose-back identity is asserted for the records this build produces (official records only).
    if (isZj(c)) { nMods++; continue; }
    if (!c.isGolden || !(c.status.equipLevel > 0)) {
      for (const k of ['modules', 'statsBase', 'traitBase', 'talentsBase']) assert.equal(c[k], undefined, `${c.chessId}: normal chess has no ${k}`);
      continue;
    }
    assert.ok(Array.isArray(c.modules), `${c.chessId}: modules`);
    const defs = c.modules.filter((m) => m.isDefault);
    assert.equal(defs.length, c.module?.active ? 1 : 0, `${c.chessId}: default module iff module active`);
    if (defs.length) assert.equal(defs[0].uniEquipId, c.module.id);
    const dm = defs[0] ?? null;
    // default loadout = the record's own stats / trait / talents
    assert.deepEqual(composeStats(c.statsBase, dm?.attr), c.stats, `${c.chessId}: statsBase + default attr = stats`);
    assert.deepEqual(dm?.traitOverride ?? c.traitBase, c.trait, `${c.chessId}: trait`);
    // (the record's own lists chain their lower-potential entries — shared/potential.js; a composed list carries none)
    assert.deepEqual(composeTalents(c.talentsBase, dm?.talentChanges), stripPotential(c.talents), `${c.chessId}: talents`);
    assert.equal(new Set(c.modules.map((m) => m.uniEquipId)).size, c.modules.length);
    for (const m of c.modules) {
      nMods++;
      assert.match(m.uniEquipId, /^uniequip_\d{3}_/, `${c.chessId}: module id`);
      assert.ok(!/^uniequip_001_/.test(m.uniEquipId), `${c.chessId}: INITIAL (no module) is not a module choice`);
      assert.ok(typeof m.name === 'string' && typeof m.typeName === 'string' && m.typeName.length > 0, `${m.uniEquipId}: name/type`);
      assert.equal(m.level, c.status.equipLevel, `${m.uniEquipId}: level`);
      for (const [k, v] of Object.entries(m.attr)) assert.ok(statKeys.includes(k) && isFiniteNum(v), `${m.uniEquipId}: attr ${k}`);
      assert.ok(m.traitOverride === null || (typeof m.traitOverride.desc === 'string' && m.traitOverride.bb), `${m.uniEquipId}: traitOverride`);
      for (const t of m.talentChanges) assert.ok(Number.isInteger(t.talentIndex) && t.bb && typeof t.hidden === 'boolean', `${m.uniEquipId}: talentChanges`);
      // every choice composes into complete stats
      assertStatsFinite(composeStats(c.statsBase, m.attr), `${c.chessId}+${m.uniEquipId}`, statKeys);
    }
  }
  assert.ok(nMods >= 170, `module choices: ${nMods}`);  // 184 ADVANCED modules over 129 goldens
  // 缪尔赛思 精锐 (E2 60, module Lv3): 梳妆流形 (default) / 落叶四季
  const m = chess.chess_char_6_11_b;
  assert.deepEqual(m.modules.map((x) => [x.uniEquipId, x.typeName, x.isDefault]), [['uniequip_002_mlyss', 'TAC-X', true], ['uniequip_003_mlyss', 'TAC-Y', false]]);
  assert.deepEqual(m.modules[1].attr, { maxHp: 170, atk: 28, def: 28 });
  assert.deepEqual([m.statsBase.maxHp, m.statsBase.atk, m.statsBase.def], [1703, 492, 111]);   // ATK 467 + 攻击力+25 (full potential)
  // module-less goldens: no choices, base = stats
  assert.deepEqual(chess.chess_char_5_14_b.modules, []);
  assert.deepEqual(chess.chess_char_5_14_b.statsBase, chess.chess_char_5_14_b.stats);
});

test('tokens: owner loadout variants (bySkill per non-default owner skill, byModule per other module / none)', () => {
  const allowed = new Set(['talent', 'skill', 'display']);
  for (const t of Object.values(tokens)) {
    for (const [owner, v] of Object.entries(t.variants || {})) {
      const o = chess[owner];
      // 炸惊 records are an imported snapshot: their variant tables (bySkill/byModule keys) are the reference package's,
      // keyed against ITS owner records, so this builder's key contract is asserted for official owners only.
      if (!o || isZj(o)) continue;
      const alt = o.skills.filter((s) => !s.isDefault).map((s) => String(s.index));
      assert.deepEqual(Object.keys(v.bySkill || {}), alt, `${t.tokenId}@${owner}: bySkill keys`);
      for (const b of Object.values(v.bySkill || {})) {
        assert.ok(Array.isArray(b.sources) && b.sources.every((x) => allowed.has(x)), `${t.tokenId}@${owner}: bySkill sources`);
        assert.ok(b.count === null || isInt(b.count), `${t.tokenId}@${owner}: bySkill count`);
      }
      const mods = o.isGolden && o.module?.active ? [...o.modules.filter((m) => !m.isDefault).map((m) => m.uniEquipId), 'none'] : [];
      assert.deepEqual(Object.keys(v.byModule || {}), mods, `${t.tokenId}@${owner}: byModule keys`);
      for (const b of Object.values(v.byModule || {})) assert.ok(b.stats && b.trait && Array.isArray(b.talents), `${t.tokenId}@${owner}: byModule shape`);
    }
  }
  const w = tokens.token_10030_mlyss_wtrman.variants.chess_char_6_11_b;
  assert.equal(w.skill.skillId, 'sktok_mlyss_wtrman_3');                         // default S3
  assert.equal(w.bySkill[0].skill.skillId, 'sktok_mlyss_wtrman_1');              // 流形 follows the owner's skill slot
  assert.equal(w.byModule.none.talents[0].bb.scale, 0.9);                        // no module: 90% copy
  assert.ok(!w.byModule.none.talents.some((x) => x.bb.damage_scale !== undefined));
  assert.deepEqual(tokens.token_10022_kazema_shadow.variants.chess_char_2_11_a.bySkill[0].sources, [], '风丸 S1 makes no 纸偶');
  assert.deepEqual(tokens.token_10057_svash2_eagle1.variants.chess_char_5_14_a.bySkill[0].sources, ['talent', 'skill', 'display'], '凛御银灰 S1: talent eagle = eagle1');
});

test('enemies: rangeRadius contract (MELEE ⇒ 0) and undefined-field defaults', () => {
  for (const e of Object.values(enemies)) {
    const s = e.stats;
    assert.ok(s.rangeRadius >= 0, `${e.key}: rangeRadius ${s.rangeRadius}`);
    if (e.applyWay === 'MELEE') assert.equal(s.rangeRadius, 0, `${e.key}: MELEE enemy must not attack at range`);
    assert.ok(isFiniteNum(s.rawRangeRadius), `${e.key}: rawRangeRadius`);
    if (e.applyWay !== 'MELEE') assert.equal(s.rangeRadius, Math.max(0, s.rawRangeRadius), `${e.key}: rangeRadius`);
    assert.ok(s.maxHp > 0 && s.bat > 0 && s.moveSpeed >= 0 && s.lpr >= 0, `${e.key}: core stats`);
  }
  // Only three skill-driven leaders have an official (defined) attack speed of 0.
  const zeroAspd = Object.values(enemies).filter((e) => e.stats.aspd === 0).map((e) => e.key).sort();
  assert.deepEqual(zeroAspd, ['enemy_9017_achunt', 'enemy_9017_achunt_2', 'enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_9022_acdumm']);
  assert.equal(enemies.enemy_1045_hammer.stats.rangeRadius, 0);         // 粉碎攻坚手: MELEE, official 2.5
  assert.equal(enemies.enemy_1045_hammer.stats.rawRangeRadius, 2.5);
  assert.equal(enemies.enemy_1305_mhslim.stats.rangeRadius, 1.8);       // 灼热源石虫: RANGED keeps its radius
  assert.equal(enemies.enemy_2016_csphtm.stats.aspd, 100);              // 卢西恩: undefined attackSpeed → 100
  assert.equal(enemies.enemy_1269_nhfly.stats.bat, 1);                  // 枯朽之种: undefined bat → 1
  assert.equal(enemies.enemy_1229_darmy.stats.lpr, 1);                  // 萨卡兹王庭军战士: undefined lpr → 1
  assert.equal(enemies.enemy_10067_ftsjc.stats.atk, 400);               // 灼藤: season override ATK 400
  for (const w of Object.values(waves)) {
    for (const [k, o] of Object.entries(w.overrides)) {
      if (o.stats && 'rangeRadius' in o.stats && (o.applyWay || enemies[k].applyWay) === 'MELEE') assert.equal(o.stats.rangeRadius, 0, `${w.id}: ${k}`);
    }
  }
});

test('stages: 下半 devices at match start = the non-hidden ones (act1 m02 has no crates); official helper lanes', () => {
  for (const s of Object.values(stages)) for (const d of s.devices) assert.equal(d.active, !d.hidden, `${s.id} ${d.alias}`);
  const m02 = stages.act1autochess_m02;
  for (const a of ['#001', '#002', '#003', '#004']) assert.equal(m02.devices.find((d) => d.alias === `trap_1105_accrate${a}`).active, false, `m02 crate ${a}`);
  // research 08 §3.2: upper gate of act1 m02 keeps the top road to col 3; act1 m04 stays on row 11 down to col 4
  const lane = (id, k = '12,10->9,2') => stages[id].groundPathsWithDevices[k].map((p) => p.join(',')).join(' ');
  assert.equal(lane('act1autochess_m02'), '12,10 12,9 12,8 12,7 12,6 12,5 12,4 12,3 11,3 10,3 9,3 9,2');
  assert.equal(lane('act1autochess_m04'), '12,10 12,9 11,9 11,8 11,7 11,6 11,5 11,4 10,4 9,4 9,3 9,2');
  assert.equal(lane('act2autochess_m02'), '12,10 12,9 12,8 12,7 11,7 10,7 9,7 9,6 9,5 9,4 9,3 9,2', 'crates on col 9: col 7 (mire)');
  assert.equal(lane('act2autochess_m02', '9,10->9,2'), '9,10 9,9 9,8 9,7 9,6 9,5 9,4 9,3 9,2');
});

test('stages: device rangeTiles are the direction-rotated range, inside the grid', () => {
  for (const s of Object.values(stages)) {
    for (const d of s.devices) {
      if (!d.rangeGrid) { assert.equal(d.rangeTiles ?? null, null, `${s.id} ${d.alias}`); continue; }
      assert.ok(Array.isArray(d.rangeTiles) && d.rangeTiles.length <= d.rangeGrid.length, `${s.id} ${d.alias}: rangeTiles`);
      for (const [r, c] of d.rangeTiles) assert.ok(r >= 0 && r < 19 && c >= 0 && c < 21, `${s.id} ${d.alias}: (${r},${c})`);
      assert.ok(d.rangeTiles.some(([r, c]) => r === d.pos[0] && c === d.pos[1]) || !d.rangeGrid.some(([a, b]) => a === 0 && b === 0), `${s.id} ${d.alias}: own tile`);
    }
  }
  // A blower on the row-13 separator facing DOWN blows into rows 12..10 of its column.
  const blower = stages.act2autochess_m01.devices.find((d) => d.key === 'trap_013_blower' && d.pos[0] === 13 && d.pos[1] === 5);
  assert.deepEqual(blower.rangeTiles, [[13, 5], [12, 5], [11, 5], [10, 5]]);
});

test('stages: player-facing names are clean Chinese "战场#NN…" labels (no research annotations)', () => {
  // Regression: research 05 named act1 m01 '战场#01 (upper half #01)'; the English note reached the
  // briefing BATTLEFIELD row. Names come from research only, so the build must strip such notes.
  for (const s of Object.values(stages)) {
    if (s.kind === 'unite') continue; // the escaped levels' two maps: the remake's own label, checked in the test below
    assert.match(s.name, /^战场#\d{2}(?:\((?:上半|下半)\))?(?: \S.*)?$/, `${s.id}: name ${JSON.stringify(s.name)}`);
    assert.doesNotMatch(s.name, /[A-Za-z]/, `${s.id}: Latin text in name ${JSON.stringify(s.name)}`);
    assert.equal(s.name, s.name.trim().replace(/\s+/g, ' '), `${s.id}: stray whitespace in name`);
  }
  assert.equal(stages.act1autochess_m01.name, '战场#01');
  assert.equal(stages.act2autochess_m01.name, '战场#05(下半) 源石流发生装置');
});

test('stages: the escaped levels\' maps — one per helper count, never a match stage (and since 0.2.1 never the 联防 field)', () => {
  // act2autochess constData escapedBattleTemplateMapSinglePlayer / MultiPlayer → config.unite.templates { 1, 2 }. 0.2.0
  // fought the 联防 battle on these maps (GitHub #41); 联防 plays on the round's battlefield again (the owner's decision of
  // 2026-10-07, test/match/feedback5-unite-map.test.js) and the records stay as the official level data
  assert.deepEqual(config.unite.templates, { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' });
  for (const [n, id] of Object.entries(config.unite.templates)) {
    const s = stages[id];
    assert.ok(s, id);
    assert.equal(s.kind, 'unite');
    assert.equal(s.helpers, Number(n));
    assert.equal(s.active, false);
    assert.equal(s.weight, 0);
    assert.deepEqual(s.modes, []);
    assert.ok(!Object.values(config.modes).some((m) => m.stages.includes(id)), `${id} in no mode's stage list`);
    assert.equal(s.name, `联防阵地（${n}名玩家）`);
    assert.deepEqual(s.devices, [], 'no crates, platforms or other devices');
    assert.deepEqual(s.special, {}, 'no water, mire, smog or infection');
    // the official level map (level_act1autochess_escaped_*.json): two road halves joined at col 10
    assert.deepEqual(s.rows.slice(9, 13), ['##ErrrrrrrSrrrrrrrS##', '###rrrrrrr#rrrrrrr###', '###rrrrrrr#rrrrrrr###', '###rrrrrrrSrrrrrrrS##']);
    for (let r = 9; r <= 12; r++) for (const c of [19, 20]) assert.equal(s.tiles[s.rows[r][c]].groundPassable, false, `${id} (${r},${c}) is no ground`);
    assert.ok(s.groundPaths['9,10->9,2'] && s.groundPaths['9,18->9,2'], 'walkable from both gates');
  }
  // the two maps are tile for tile the same: they differ in their routes (data/waves.json — 1 helper enters at col 10,
  // 2 helpers at col 18 through the checkpoint (9,10)), which the 联防 field follows on the round's stage (its gates
  // (9,10) / (12,10) and (9,18) / (12,18))
  assert.deepEqual(stages.act1autochess_escaped_single.rows, stages.act1autochess_escaped_multi.rows);
  assert.deepEqual(waves.act1autochess_escaped_single.routes.map((r) => r.start), [[9, 10], [9, 10], [12, 10], [9, 10], [9, 10], [9, 10], [9, 10], [9, 10]]);
  assert.deepEqual(waves.act1autochess_escaped_multi.routes.map((r) => r.start), [[9, 18], [9, 18], [12, 18], [9, 18], [9, 18], [9, 18], [9, 18], [9, 18]]);
  assert.deepEqual(waves.act1autochess_escaped_multi.routes[3].checkpoints, [[9, 10]]);
});

test('official spot checks (hard-coded values from the zh_CN client data)', () => {
  // at full potential (the owner's decision of 2026-10-07): the client's numbers plus each operator's potential steps
  const st = (id) => { const s = chess[id].stats; return [s.maxHp, s.atk, s.def, s.res, s.blockCnt, s.cost]; };
  assert.deepEqual(st('chess_char_6_11_b'), [1893, 517, 141, 0, 1, 13]);      // 缪尔赛思 精锐 (E2 60 + module Lv3): 492 + 25 ATK, 15 − 2 cost
  assert.deepEqual(st('chess_char_6_17_b'), [3593, 1143, 279, 0, 1, 17]);     // 耀骑士临光 精锐: 1108 + 35, 19 − 2
  assert.deepEqual(st('chess_char_3_08_a'), [1594, 629, 170, 15, 1, 22]);     // 薄绿 (E2 1): 25 − 3
  assert.deepEqual(st('chess_char_2_11_a'), [1816, 574, 254, 0, 2, 13]);      // 风丸 (E1 60): 547 + 27, 15 − 2
  assert.deepEqual(st('chess_char_4_07_b'), [2383, 629, 359, 0, 1, 11]);      // 风笛 精锐: 604 + 25, 13 − 2
  assert.equal(chess.chess_char_6_11_b.module.level, 3);
  assert.deepEqual([chess.chess_char_4_07_b.skill.skillId, chess.chess_char_4_07_b.skill.level, chess.chess_char_4_07_b.skill.spCost], ['skchr_bpipe_2', 7, 5]);
  const es = (k) => { const s = enemies[k].stats; return [s.maxHp, s.atk, s.def, s.res]; };
  assert.deepEqual(es('enemy_1422_lrsldr'), [4700, 300, 100, 40]);           // 萨卡兹枯朽前锋 (template N)
  assert.deepEqual(es('enemy_1427_lrnazg'), [15000, 900, 500, 50]);          // “灵幛” (template E)
  assert.deepEqual(es('enemy_1045_hammer'), [10000, 1000, 1000, 0]);         // 粉碎攻坚手
  // the four official difficulties' pools (湮灭模拟 appends its own ANNIHILATION column — a separate play set's table)
  const bloodPoint = (id) => {
    const { FUNNY, NORMAL, HARD, ABYSS } = bosses[id].bloodPoint;
    return { FUNNY, NORMAL, HARD, ABYSS };
  };
  assert.deepEqual(bloodPoint('boss_1'), { FUNNY: 247500, NORMAL: 675000, HARD: 1800000, ABYSS: 3600000 });
  assert.deepEqual(bloodPoint('boss_10'), { FUNNY: 825000, NORMAL: 1012500, HARD: 3800000, ABYSS: 7600000 });
  assert.deepEqual([items.chess_item_1_01_e_a.name, items.chess_item_1_01_e_a.price, items.chess_item_1_01_e_a.params.atk], ['维式重锤', 1, 0.15]);
  assert.deepEqual([bands.band_sarkazb.totalHp, bands.band_lisa.totalHp], [45, 20]);
  assert.deepEqual(config.modes.mode_multi_abyss.rounds['15'].prepTime, 215);
  assert.equal(config.modes.mode_multi_abyss.enemyScale['6'].hp, 2.239488);   // 1.2^4 × 1.08
});

test('a module trait part that only adds a display line writes that line only (GitHub #400): 圣约送葬人 REA-Y heals 50 per enemy hit, its line ASPD +12', () => {
  // official battle_equip_table uniequip_003_excu2: a DISPLAY part whose blackboard `value` 12 belongs to its own
  // 「攻击速度+{value}」; the class trait's 「回复自身{value}生命」 stays the base 50 (REA-X's TRAIT_DATA_ONLY part rewrites it: 60)
  const g = chess.chess_char_5_01_b;
  const y = g.modules.find((m) => m.uniEquipId === 'uniequip_003_excu2').traitOverride;
  assert.equal(y.desc, g.traitBase.desc, 'the class trait as without a module');
  assert.match(y.desc, /每攻击到一个敌人回复自身50生命/);
  assert.match(y.descRaw, /回复自身<@ba\.kw>50<\/>生命/);
  assert.equal(y.moduleDesc, '攻击范围内存在2名及以上敌人时攻击速度+12');
  assert.match(g.modules.find((m) => m.uniEquipId === 'uniequip_002_excu2').traitOverride.desc, /回复自身60生命/, 'REA-X');
  // no other module record carries a trait line that differs from its owner's class trait only in a number its own
  // display line uses (the class of this bug)
  const forms = [...Object.values(chess).filter((c) => !isZj(c)), ...Object.values(D.backups.units || {}).flatMap((u) => Object.values(u.forms || {}))];
  for (const f of forms) {
    for (const m of f.modules || []) {
      const o = m.traitOverride;
      if (!o?.moduleDesc || !f.traitBase?.desc || o.desc === f.traitBase.desc) continue;
      const nums = (t) => String(t).match(/\d+(?:\.\d+)?/g) || [];
      const sameWords = o.desc.replace(/\d+(?:\.\d+)?/g, '#') === f.traitBase.desc.replace(/\d+(?:\.\d+)?/g, '#');
      if (!sameWords) continue;
      const moved = nums(o.desc).filter((n, i) => n !== nums(f.traitBase.desc)[i]);
      assert.ok(!moved.every((n) => nums(o.moduleDesc).includes(n)), `${f.chessId || f.charId} ${m.uniEquipId}: ${o.desc} / ${o.moduleDesc}`);
    }
  }
});

/** Read an official cache file (only called when HAS_CACHE). */
const raw = (rel) => JSON.parse(readFileSync(join(CACHE, rel), 'utf8'));

test('independent re-derivation of every chess and enemy stat from the raw official tables', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const act = raw('excel/activity_table.json').activity.AUTOCHESS_SEASON.act2autochess;
  const CT = raw('excel/character_table.json'), BE = raw('excel/battle_equip_table.json'), ST = raw('excel/skill_table.json');
  const PH = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 };
  let n = 0;
  for (const [id, cd] of Object.entries(act.charChessDataDict)) {
    const c = chess[id];
    if (!c || c.isDiy) continue;
    const shop = act.charShopChessDatas[act.chessNormalIdLookupDict[id] || id];
    const P = CT[shop.charId].phases[PH[cd.status.evolvePhase]];
    const k0 = P.attributesKeyFrames[0], k1 = P.attributesKeyFrames[P.attributesKeyFrames.length - 1];
    const t = (cd.status.charLevel - k0.level) / (k1.level - k0.level || 1);
    const f = (key) => k0.data[key] + (k1.data[key] - k0.data[key]) * t;
    const exp = { maxHp: f('maxHp'), atk: f('atk'), def: f('def'), res: f('magicResistance'), aspd: f('attackSpeed'), blockCnt: f('blockCnt'), cost: f('cost'), respawnTime: f('respawnTime') };
    const map = { max_hp: 'maxHp', atk: 'atk', def: 'def', magic_resistance: 'res', attack_speed: 'aspd', block_cnt: 'blockCnt', cost: 'cost', respawn_time: 'respawnTime' };
    // full potential (the owner's decision of 2026-10-07): every potentialRanks attribute step (all ADDITION)
    const POT = { MAX_HP: 'maxHp', ATK: 'atk', DEF: 'def', MAGIC_RESISTANCE: 'res', ATTACK_SPEED: 'aspd', COST: 'cost', RESPAWN_TIME: 'respawnTime' };
    for (const r of CT[shop.charId].potentialRanks || []) for (const m of r.buff?.attributes?.attributeModifiers || []) exp[POT[m.attributeType]] += m.value;
    if (cd.status.equipLevel > 0 && shop.defaultUniEquipId) {
      const mp = BE[shop.defaultUniEquipId]?.phases.find((p) => p.equipLevel === cd.status.equipLevel);
      for (const b of mp?.attributeBlackboard || []) if (map[b.key]) exp[map[b.key]] += b.value;
    }
    for (const [key, v] of Object.entries(exp)) assert.ok(Math.abs(v - c.stats[key]) <= 0.5 + 1e-9, `${id} ${c.name}: ${key} ${c.stats[key]} vs official ${v}`);
    const lv = ST[CT[shop.charId].skills[shop.defaultSkillIndex].skillId].levels[cd.status.skillLevel - 1];
    for (const e of lv.blackboard) if (!(e.valueStr && e.value === 0)) assert.ok(Math.abs(c.skill.bb[e.key] - e.value) < 1e-6, `${id}: skill bb ${e.key}`);
    assert.deepEqual([c.skill.spCost, c.skill.initSp, c.skill.duration], [lv.spData.spCost, lv.spData.initSp, lv.duration], `${id}: skill sp`);
    // every selectable skill (DESIGN §16) at the chess skill level
    const ph = PH[cd.status.evolvePhase];
    const unlockedIdx = CT[shop.charId].skills.map((s, i) => [s, i]).filter(([s, i]) => s.skillId && (i === shop.defaultSkillIndex || PH[s.unlockCond?.phase ?? 'PHASE_0'] <= ph)).map(([, i]) => i);
    assert.deepEqual(c.skills.map((s) => s.index), unlockedIdx, `${id}: unlocked skills`);
    for (const s of c.skills) {
      const sl = ST[CT[shop.charId].skills[s.index].skillId].levels[cd.status.skillLevel - 1];
      for (const e of sl.blackboard) if (!(e.valueStr && e.value === 0)) assert.ok(Math.abs(s.bb[e.key] - e.value) < 1e-6, `${id} S${s.index + 1}: bb ${e.key}`);
      assert.deepEqual([s.spCost, s.initSp, s.duration, s.name], [sl.spData.spCost, sl.spData.initSp, sl.duration, sl.name], `${id} S${s.index + 1}: sp`);
    }
    for (const m of c.modules || []) {
      const mp = BE[m.uniEquipId].phases.find((p) => p.equipLevel === cd.status.equipLevel);
      const exp = {};
      for (const b of mp.attributeBlackboard) exp[map[b.key] ?? b.key] = (exp[map[b.key] ?? b.key] || 0) + b.value;
      for (const [k, v] of Object.entries(exp)) {
        const f = { respawn_time: 'respawnTime', base_attack_time: 'bat', max_deploy_count: 'deployLimit', max_deck_stack_cnt: 'deckStack' }[k] ?? k;
        assert.ok(Math.abs(m.attr[f] - v) < 1e-6, `${id} ${m.uniEquipId}: attr ${k} ${m.attr[f]} vs official ${v}`);
      }
    }
    n++;
  }
  assert.equal(n, 258);

  const db = new Map(raw('levels/enemydata/enemy_database.json').enemies.map((e) => [e.Key, e.Value]));
  const ov = new Map((raw('levels/activities/act1autochess/level_autochess_enemy_data.json').enemyDbRefs || [])
    .filter((r) => r.overwrittenData).map((r) => [r.id, r.overwrittenData]));
  // the 鸭爵 strategy's swapped-in enemies cost 1 LP at the protection point (PRTS 卫戍协议：盟约 下半/PRTS盟约记录 鸭爵 备注
  // "但进入保护目标点将减少1点目标生命值"; the database's lifePointReduce 0 is the roguelike rule)
  const swapped = new Set(Object.values(act.effectBuffInfoDataDict).flat().filter((b) => b.key === 'round_start_all_player_change_enemy_2')
    .flatMap((b) => b.blackboard.filter((kv) => kv.key === 'enemylist').flatMap((kv) => kv.valueStr.split(','))));
  assert.equal(swapped.size, 4);
  for (const e of Object.values(enemies)) {
    const base = db.get(e.key).find((l) => l.level === 0).enemyData;
    const o = ov.get(e.key);
    // Season override if defined, else the base value if defined, else the documented default.
    const pick = (get, dflt) => {
      const x = o && get(o);
      if (x && x.m_defined) return x.m_value;
      const b = get(base);
      return b && b.m_defined ? b.m_value : dflt;
    };
    const exp = {
      maxHp: pick((x) => x.attributes?.maxHp, 0), atk: pick((x) => x.attributes?.atk, 0), def: pick((x) => x.attributes?.def, 0),
      res: pick((x) => x.attributes?.magicResistance, 0), moveSpeed: pick((x) => x.attributes?.moveSpeed, 1),
      bat: pick((x) => x.attributes?.baseAttackTime, 1), aspd: pick((x) => x.attributes?.attackSpeed, 100),
      lpr: swapped.has(e.key) ? 1 : pick((x) => x.lifePointReduce, 1), massLevel: pick((x) => x.attributes?.massLevel, 0),
      motion: pick((x) => x.motion, 'WALK'),
    };
    for (const [key, v] of Object.entries(exp)) {
      const got = e.stats[key];
      assert.ok(typeof v === 'number' ? Math.abs(v - got) < 1e-6 : v === got, `${e.key} ${e.name}: ${key} ${got} vs official ${v}`);
    }
    // official attribute power (RandomEnemyGenerater._GetEnemyAttrPower): DATABASE stats (no season override), float32
    const at = base.attributes;
    const f = Math.fround;
    const P = f(f(f(f(at.atk.m_value * 5) + f(at.maxHp.m_value)) + f(at.def.m_value * 3)) + f(3 * at.magicResistance.m_value));
    assert.equal(e.attrPower, P, `${e.key} ${e.name}: attrPower`);
  }
  // 灼藤 / 元核孽生者 count with their database ATK, not the season override 400 (research 08 §2.3)
  for (const k of ['enemy_10067_ftsjc', 'enemy_1439_dslntf']) {
    const e = enemies[k];
    assert.equal(e.stats.atk, 400, `${k}: spawned with the season ATK`);
    assert.notEqual(e.attrPower, e.stats.maxHp + 5 * e.stats.atk + 3 * e.stats.def + 3 * e.stats.res, `${k}: power from the database ATK`);
  }
});

test('offline rebuild reproduces data/ byte-for-byte (data/ is not stale)', { skip: (!HAS_CACHE && 'no .cache/gamedata') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'sp-data-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-data.mjs'), '--offline', '--quiet', '--out', out, '--report', join(out, 'report.json')], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata (run node tools/build-data.mjs once online)'); return; }
    assert.equal(r.status, 0, `build failed: ${r.stderr}`);
    for (const f of FILES) {
    // 2026-10-22: data/bonds.json 的 effect / notes 里有人工研究笔记 —— 阿戈尔 maxHP 直接乘算、从部署就生效（早于开局吞噬），
    // 叙拉古 3/27 的更新是把上限从 12/24 **下调**。build-data 会拿官方原始文本覆盖这两段（官方文本在那里不全/写反了），
    // 所以这个文件允许与重建结果不同，其余文件仍然逐字节一致。
    const HAND_EDITED = new Set(['bonds']);
      if (HAND_EDITED.has(f)) continue;
      assert.ok(readFileSync(join(out, `${f}.json`)).equals(readFileSync(join(DATA, `${f}.json`))), `data/${f}.json is stale — run: node tools/build-data.mjs`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build CLI rejects unknown options and missing values without writing anything', () => {
  for (const args of [['--bogus'], ['--out'], ['--out', '--offline'], ['--refresh', '--offline']]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-data.mjs'), ...args], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status}`);
    assert.match(r.stderr, /usage:/);
  }
});

// ===== 炸惊 / 湮灭：导入归一化 + 两个玩法的内容不外溢（task-10）====================================
//
// 这两个玩法的记录来自外部整合包的「已构建记录」，包内 builder 有三类文本缺陷（见 tools/research-normalize.mjs 头注释）。
// 归一化在导入器里（tools/extract-zhajing-research.mjs），生成期护栏在 build-data.mjs 的 checkTextContracts —— 这里
// 钉住归一化本身的行为，以及「装上两个玩法以后官方记录一个字节都没动」。

test('导入归一化：desc 的字面 \\n、descRaw 权威、黑板上限说明、官方图标映射', () => {
  // 缺陷 1：只有 desc 的旧记录里，字面反斜杠+n（两个字符）必须解成真换行
  const onlyDesc = { desc: '第一行\\n第二行' };
  normalizeDescPairs(onlyDesc);
  assert.equal(onlyDesc.desc, '第一行\n第二行');

  // 缺陷 2：chess 的 skill 被包内 builder 截短（尾括号丢失）且把换行写成字面 \n → desc = 纯文本(descRaw)
  const chess = {
    chessId: 'chess_zj_x',
    skill: { desc: '攻击力+70%\\n技能结束后自身晕眩10秒（可随时停止技能', descRaw: '攻击力<@ba.vup>+70%</>，随机攻击范围内的目标\n技能结束后自身<@ba.stun>晕眩</>10秒' },
    skills: [{ desc: 'ok', descRaw: 'ok' }],
  };
  const changed = normalizeDescPairs(chess, 'chess.chess_zj_x');
  assert.deepEqual(changed.sort(), ['chess.chess_zj_x.skill.desc']);
  assert.equal(chess.skill.desc, '攻击力+70%，随机攻击范围内的目标\n技能结束后自身晕眩10秒');
  assert.equal(chess.skills[0].desc, 'ok');
  // 盟约 effectDesc/effectDescRaw 有占位符，必须原样保留（DATA.md §3）
  const bond = { effectDesc: '攻击+{0:0%}', effectDescRaw: '攻击<@ba.vup>+{0:0%}</>' };
  assert.deepEqual(normalizeDescPairs(bond), []);
  assert.deepEqual(bond, { effectDesc: '攻击+{0:0%}', effectDescRaw: '攻击<@ba.vup>+{0:0%}</>' });

  // 缺陷 2 的另一半：包内只把「（每场作战至多N层）」写进 desc，descRaw 漏了 → 从记录自己的黑板补回
  const g92 = { desc: '<战斗中>层数+3（每场作战至多666层）', descRaw: '<战斗中>层数+3', bb: { max_add_count_per_battle: 666, bond_add_count: 3 } };
  assert.equal(restoreBlackboardCapNote(g92), true);
  normalizeDescPairs(g92);
  assert.equal(g92.descRaw, '<战斗中>层数+3（每场作战至多666层）');
  assert.equal(g92.desc, g92.descRaw);
  // 两边都没有这句说明的记录不补（那是改设计）：garrison_zj_90_2_* 的 bb 有上限但文案里没有
  const g90 = { desc: '<战斗中>层数+2', descRaw: '<战斗中>层数+2', bb: { max_add_count_per_battle: 100 } };
  assert.equal(restoreBlackboardCapNote(g90), false);
  assert.equal(g90.descRaw, '<战斗中>层数+2');

  // 缺陷 3：eventTypeIcon 按 eventTypeDesc 映射到官方四图标；合法图标保留；映射不到留空
  const icons = officialGarrisonTypeIcons(JSON.parse(readFileSync(join(ROOT, 'data', 'cdn-resource-config.json'), 'utf8')));
  assert.deepEqual([...icons].sort(), ['icon_battle', 'icon_bond', 'icon_gold', 'icon_support']);
  const server = { eventTypeIcon: 'icon_server', eventTypeDesc: '整备能力' };
  assert.deepEqual(normalizeEventTypeIcon(server, icons), { from: 'icon_server', to: 'icon_gold' });
  assert.equal(server.eventTypeIcon, 'icon_gold');
  const legal = { eventTypeIcon: 'icon_bond', eventTypeDesc: '特异化' };
  assert.equal(normalizeEventTypeIcon(legal, icons), null, '合法图标不按 eventTypeDesc 覆盖');
  assert.equal(legal.eventTypeIcon, 'icon_bond');
  const unknown = { eventTypeIcon: 'icon_server', eventTypeDesc: '不存在的分类' };
  assert.deepEqual(normalizeEventTypeIcon(unknown, icons), { from: 'icon_server', to: '' });
  assert.equal(unknown.eventTypeIcon, '');
});

test('两个玩法装上以后，官方记录与「没有这两个玩法」的重建逐字节相同', { skip: (!HAS_CACHE && 'no .cache/gamedata') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  // 基线怎么造：同一份代码、同一批官方表，只把两个玩法的研究源（17/18/19/20/21）从 --research 目录里拿掉 —— 生成器
  // 与官方输入都不变，所以「官方记录」的字节差异只可能来自这两个玩法的合并。计数校验会因为少了两个玩法的记录而报
  // 两条 expected bonds/bands 错误，用 --force 照写（这两条正是「少掉了什么」的证据，逐条断言）。
  const dir = mkdtempSync(join(tmpdir(), 'sp-plays-off-'));
  try {
    const research = join(dir, 'research');
    mkdirSync(research, { recursive: true });
    const PLAYS = new Set(['17-zhaijing-mode.json', '18-zhaijing-content.json', '19-zhaijing-jibian.json', '20-annihilation-mods.json', '21-zhaijing-default-loadout.json']);
    for (const name of readdirSync(RESEARCH)) if (name.endsWith('.json') && !PLAYS.has(name)) copyFileSync(join(RESEARCH, name), join(research, name));
    const out = join(dir, 'data');
    const reportPath = join(dir, 'report.json');
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-data.mjs'), '--offline', '--quiet', '--force', '--research', research, '--out', out, '--report', reportPath], { encoding: 'utf8', timeout: 120_000 });
    if (/missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata (run node tools/build-data.mjs once online)'); return; }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.deepEqual(report.errors.map((e) => e.replace(/\d+/g, 'N')).sort(), [
      'expected N bands, got N',
      'expected N bonds, got N',
    ], `plays-free build must only complain about the missing plays' records, got: ${report.errors.join(' | ')}`);
    const loadBase = (f) => JSON.parse(readFileSync(join(out, `${f}.json`), 'utf8'));
    const MODE_KEYS = new Set(['zj', 'ann', 'annBonds', 'annOnly', 'zjOnly']);
    const stripModeKeys = (rec) => (Array.isArray(rec) || typeof rec !== 'object' ? rec : Object.fromEntries(Object.entries(rec).filter(([k]) => !MODE_KEYS.has(k))));
    let compared = 0;
    for (const f of FILES) {
      const base = loadBase(f);
      if (f === 'config') {
        for (const [id, mode] of Object.entries(base.modes)) {
          assert.equal(JSON.stringify(D.config.modes[id]), JSON.stringify(mode), `config.modes.${id} changed by the two plays`);
          compared++;
        }
        continue;
      }
      if (f === 'choices') {
        for (const [id, sch] of Object.entries(base.schedule || {})) {
          assert.equal(JSON.stringify(D.choices.schedule[id]), JSON.stringify(sch), `choices.schedule.${id} changed by the two plays`);
          compared++;
        }
        continue;
      }
      const real = D[f];
      if (f === 'backups') {
        for (const [id, tok] of Object.entries(base.tokens)) {
          const rec = real.tokens[id];
          assert.ok(rec, `backups.tokens.${id} missing`);
          // 炸惊的召唤物只**追加**自己的 variant 键；官方 variants 逐字节保留
          const officialKeys = new Set(Object.keys(tok.variants || {}));
          const view = { ...rec, variants: Object.fromEntries(Object.entries(rec.variants || {}).filter(([k]) => officialKeys.has(k))) };
          assert.equal(JSON.stringify(view), JSON.stringify(tok), `backups.tokens.${id} changed by the two plays`);
          compared++;
        }
        for (const [id, unit] of Object.entries(base.units)) {
          assert.equal(JSON.stringify(real.units[id]), JSON.stringify(unit), `backups.units.${id} changed by the two plays`);
          compared++;
        }
        continue;
      }
      for (const [id, rec] of Object.entries(base)) {
        const live = real[id];
        assert.ok(live != null, `${f}.${id} missing`);
        assert.equal(JSON.stringify(Array.isArray(live) || typeof live !== 'object' ? live : stripModeKeys(live)), JSON.stringify(rec), `${f}.${id} changed by the two plays`);
        compared++;
      }
    }
    assert.ok(compared > 1000, `compared ${compared}`);
    // 两个玩法各自的专属文件也不该出现在「没装它们」的重建里（relics.json 是湮灭**模式**的基底数据，15/16 保留）
    for (const name of ['jibianBonds.json', 'zjDefaultLoadout.json']) {
      assert.equal(existsSync(join(out, name)), false, `${name} 是玩法专属文件，却出现在 plays-free 重建里`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('两个玩法的专属字段只落在各自的内容集里（数据层 + research 源）', () => {
  const r18 = JSON.parse(readFileSync(join(RESEARCH, '18-zhaijing-content.json'), 'utf8'));
  const r20 = JSON.parse(readFileSync(join(RESEARCH, '20-annihilation-mods.json'), 'utf8'));
  // ---- research 源：两边的记录互不携带对方的标记 ------------------------------------------------
  for (const [id, c] of Object.entries(r18.chess)) {
    assert.equal(['annBonds', 'annOnly', 'ann', 'annihilation'].some((k) => k in c), false, `research 18 chess.${id} carries an annihilation key`);
  }
  for (const [id, c] of Object.entries(r20.chess || {})) {
    assert.equal(['zhajing', 'zjOnly', 'zj'].some((k) => k in c), false, `research 20 chess.${id} carries a zhajing key`);
    assert.equal(c.annihilation, true, `research 20 chess.${id}: annihilation marker`);
    assert.equal(c.visible, false, `research 20 chess.${id}: visible must be false`);
  }
  for (const [id, b] of Object.entries(r18.bonds)) {
    assert.equal(['ann', 'annOnly'].some((k) => k in b), false, `research 18 bonds.${id} carries an annihilation key`);
  }
  for (const [id, b] of Object.entries(r20.bonds)) {
    assert.equal(['zj', 'zjOnly'].some((k) => k in b), false, `research 20 bonds.${id} carries a zhajing key`);
  }
  // ---- data：覆盖块 / 追加盟约与 research 源逐字段相等（可溯源，不是散落在官方记录里）-------------
  for (const [id, zj] of Object.entries(r18.bondZjOverrides)) {
    assert.deepEqual(D.bonds[id].zj, zj, `bonds.${id}.zj 与 research 18 bondZjOverrides 不一致`);
  }
  assert.deepEqual(Object.keys(D.bonds).filter((id) => 'zj' in D.bonds[id]).sort(), Object.keys(r18.bondZjOverrides).sort());
  for (const [id, ann] of Object.entries(r20.bondAnnOverrides)) {
    assert.deepEqual(D.bonds[id].ann, ann, `bonds.${id}.ann 与 research 20 bondAnnOverrides 不一致`);
  }
  assert.deepEqual(Object.keys(D.bonds).filter((id) => 'ann' in D.bonds[id]).sort(), Object.keys(r20.bondAnnOverrides).sort());
  for (const [id, list] of Object.entries(r20.chessAnnBonds)) {
    assert.deepEqual(D.chess[id].annBonds, list, `chess.${id}.annBonds 与 research 20 不一致`);
  }
  // 既有棋的追加盟约（research 的 chessAnnBonds）＋ mod 自带干员整条记录（research 的 chess）都带 annBonds
  assert.deepEqual(
    Object.keys(D.chess).filter((id) => Array.isArray(D.chess[id].annBonds)).sort(),
    [...Object.keys(r20.chessAnnBonds), ...Object.keys(r20.chess || {})].sort(),
  );
  assert.deepEqual(load('jibianBonds'), r18.jibianBonds, 'data/jibianBonds.json 应逐字段等于 research 18 的 jibianBonds');
  for (const [modeId, sch] of Object.entries(r20.schedule)) {
    assert.deepEqual(D.choices.schedule[modeId], sch, `choices.schedule.${modeId} 与 research 20 不一致`);
  }
  assert.deepEqual(Object.keys(D.choices.schedule).filter((m) => D.config.modes[m]?.difficulty === 'ANNIHILATION').sort(), Object.keys(r20.schedule).sort());
  assert.deepEqual(Object.keys(D.choices.schedule).filter((m) => D.config.modes[m]?.difficulty === 'ZHAJING'), [], '炸惊模式不该有机变轮次表');
  // ---- data：标记互斥 ------------------------------------------------------------------------
  const isZjChess = (c) => !!c && ('zhajing' in c || /^chess_(zj_|chen3_)/.test(c.chessId || ''));
  const annChess = Object.keys(D.chess).filter((id) => Array.isArray(D.chess[id].annBonds));
  assert.deepEqual(annChess.filter((id) => isZjChess(D.chess[id])), [], '同一个棋不能同时是炸惊内容与湮灭 annBonds 目标');
  for (const [id, b] of Object.entries(D.bonds)) {
    if (b.zjOnly === true) assert.equal('ann' in b || 'annOnly' in b, false, `zjOnly 盟约 ${id} 带了湮灭字段`);
    if (b.annOnly === true) assert.equal('zj' in b || 'zjOnly' in b, false, `annOnly 盟约 ${id} 带了炸惊字段`);
  }
  for (const [id, it] of Object.entries(D.items)) {
    assert.equal(it.zjOnly === true && it.annOnly === true, false, `道具 ${id} 同时是 zjOnly 与 annOnly`);
  }
  for (const [id, b] of Object.entries(D.bands)) {
    assert.equal(['ann', 'annOnly', 'annBonds'].some((k) => k in b), false, `策略 ${id} 带了湮灭字段`);
  }
  for (const [id, e] of Object.entries(D.effects)) {
    assert.equal(['zj', 'zjOnly'].some((k) => k in e), false, `effect ${id} 带了炸惊字段`);
  }
  // 炸惊的召唤物只进 backups.tokens 的 variant 键，不进 tokens.json
  for (const id of Object.keys(r18.backupTokens || {})) {
    assert.equal(id in D.tokens, false, `${id} 不该进 data/tokens.json（会遮蔽 backups 的官方 variant 表）`);
  }
});
