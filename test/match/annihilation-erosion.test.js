// 湮灭模拟 (Annihilation) — the 蚀流 1–6 erosion ladder inside GameData (server/match/gamedata.js).
//
// The whole play set hangs off `gd.erosion` (Room.erosion → Match opts.erosion → `new GameData(data, modeId,
// { erosion })` → here): the round total, the Final Assault / Hidden Core queue, the enemy curves, the banned bonds and
// the 无尽 rules are each derived from it. This file pins the tier table of the port's research report (§2.6) and, just
// as important, that a mode which is NOT ANNIHILATION keeps the path it took before erosion existed (§2.4, §6 坑 B: a
// broken `erosion` chain must degrade to 蚀流 1 silently, never to a different mode's rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from './harness.js';
import { GameData, erosionExponent } from '../../server/match/gamedata.js';
import { EROSION_ENDLESS, EROSION_MAX } from '../../shared/annihilation-constants.js';

const SINGLE = 'mode_single_annihilation';
const MULTI = 'mode_multi_annihilation';

/** Build the mode's GameData the way Match does (`opts` omitted = the pre-erosion call shape). */
const gdOf = (modeId, erosion) => (erosion === undefined ? new GameData(DATA, modeId) : new GameData(DATA, modeId, { erosion }));

/**
 * §2.6 — the 蚀流 ladder. `pairs` is the Final Assault / Hidden Core queue: [[boss, hidden], …].
 */
const LADDER = [
  { erosion: 1, lastRound: 19, bossRound: 19, hiddenRound: 20, pairs: [[19, 20]] },
  { erosion: 2, lastRound: 19, bossRound: 19, hiddenRound: 20, pairs: [[19, 20]] },
  { erosion: 3, lastRound: 19, bossRound: 19, hiddenRound: 20, pairs: [[14, 15], [19, 20]] },
  { erosion: 4, lastRound: 19, bossRound: 19, hiddenRound: 20, pairs: [[14, 15], [19, 20]] },
  { erosion: 5, lastRound: 30, bossRound: 29, hiddenRound: 30, pairs: [[14, 15], [19, 20], [24, 25], [29, 30]] },
];

/**
 * 蚀流 6 (无尽湮灭) — the four pairs 蚀流 5 knows, then one pair every 3 rounds: "30回合后每经过3个回合出boss、隐秘核心",
 * i.e. R33/34, R36/37, … The run is unbounded; the table is materialised to R600/601.
 */
function endlessPairs() {
  const out = [[14, 15], [19, 20], [24, 25], [29, 30]];
  for (let boss = 33; boss <= 600; boss += 3) out.push([boss, boss + 1]);
  return out;
}

/** The Final Assault that follows a hidden core in the queue (null when the queue ends there). */
function bossAfter(pairs, hiddenRound) {
  const i = pairs.findIndex((p) => p[1] === hiddenRound);
  return i >= 0 && pairs[i + 1] ? pairs[i + 1][0] : null;
}

test('the 蚀流 1–5 ladder: no opts, the room level is read and nothing else changes', () => {
  for (const tier of LADDER) {
    for (const modeId of [SINGLE, MULTI]) {
      const gd = gdOf(modeId, tier.erosion);
      assert.equal(gd.erosion, tier.erosion, `${modeId} e${tier.erosion} erosion`);
      assert.equal(gd.endless, false, `${modeId} e${tier.erosion} is not endless`);
      assert.equal(gd.lastRound, tier.lastRound, `${modeId} e${tier.erosion} lastRound`);
      assert.equal(gd.bossRound, tier.bossRound, `${modeId} e${tier.erosion} bossRound`);
      assert.equal(gd.hiddenRound, tier.hiddenRound, `${modeId} e${tier.erosion} hiddenRound`);
      assert.deepEqual(gd.bossHiddenPairs(), tier.pairs, `${modeId} e${tier.erosion} pairs`);
      assert.deepEqual(gd.bossRounds(), tier.pairs.map((p) => p[0]), `${modeId} e${tier.erosion} bossRounds`);
      assert.deepEqual(gd.hiddenRounds(), tier.pairs.map((p) => p[1]), `${modeId} e${tier.erosion} hiddenRounds`);
      // Only the queue's last hidden core closes the run (at 蚀流 5 that is R30, the end of the 30-round table).
      for (let i = 0; i < tier.pairs.length; i++) {
        assert.equal(gd.isLastHidden(tier.pairs[i][1]), i === tier.pairs.length - 1, `${modeId} e${tier.erosion} isLastHidden R${tier.pairs[i][1]}`);
      }
    }
  }
});

test('the 蚀流 1–5 queue answers every round the match asks about', () => {
  for (const tier of LADDER) {
    const gd = gdOf(SINGLE, tier.erosion);
    for (const [boss, hidden] of tier.pairs) {
      assert.equal(gd.isBossRound(boss), true, `e${tier.erosion} R${boss} is a Final Assault`);
      assert.equal(gd.isHiddenRound(hidden), true, `e${tier.erosion} R${hidden} is a Hidden Core`);
      assert.equal(gd.hiddenAfter(boss), hidden, `e${tier.erosion} R${boss} leads to its hidden core`);
      assert.equal(gd.hiddenAfter(boss + 1), null, `e${tier.erosion} a normal round has no hidden core behind it`);
      assert.deepEqual(gd.pairOfRound(boss), { boss, hidden }, `e${tier.erosion} R${boss} owns its pair`);
      assert.deepEqual(gd.pairOfRound(hidden), { boss, hidden }, `e${tier.erosion} R${hidden} owns its pair`);
      assert.equal(gd.bossRoundFor(boss), boss, `e${tier.erosion} bossRoundFor R${boss}`);
      assert.equal(gd.hiddenRoundFor(hidden), hidden, `e${tier.erosion} hiddenRoundFor R${hidden}`);
      assert.equal(gd.nextBossRound(hidden), bossAfter(tier.pairs, hidden), `e${tier.erosion} next after R${hidden}`);
      // The round right before a chapter resolves to that chapter's pair (the view announces it during prep).
      assert.equal(gd.bossRoundFor(boss - 1), boss, `e${tier.erosion} R${boss - 1} previews R${boss}`);
    }
    // Below 蚀流 6 the queue ends with the run: nothing is scheduled past its last pair.
    const lastHidden = tier.pairs[tier.pairs.length - 1][1];
    assert.equal(gd.isBossRound(lastHidden + 1), false, `e${tier.erosion} no Final Assault past the queue`);
    assert.equal(gd.isHiddenRound(lastHidden + 2), false, `e${tier.erosion} no Hidden Core past the queue`);
  }
});

test('蚀流 6 (无尽湮灭): no last round, the four pairs then one every 3 rounds', () => {
  assert.equal(EROSION_MAX, 6);
  assert.equal(EROSION_ENDLESS, EROSION_MAX, 'the ladder top (6) is the endless tier');
  for (const modeId of [SINGLE, MULTI]) {
    const gd = gdOf(modeId, EROSION_ENDLESS);
    assert.equal(gd.erosion, 6, `${modeId} e6 erosion`);
    assert.equal(gd.endless, true, `${modeId} e6 is endless`);
    assert.equal(gd.lastRound, null, `${modeId} e6 has no mode-imposed last round`);
    assert.equal(gd.bossRound, 14, `${modeId} e6 announces the first chapter`);
    assert.equal(gd.hiddenRound, 15, `${modeId} e6 announces the first chapter's hidden core`);
    const pairs = endlessPairs();
    assert.equal(pairs.length, 194, '4 pairs of 蚀流 5 + one every 3 rounds up to R600/601');
    assert.deepEqual(gd.bossHiddenPairs(), pairs, `${modeId} e6 pairs`);
    assert.deepEqual(gd.bossRounds(), pairs.map((p) => p[0]));
    assert.deepEqual(gd.hiddenRounds(), pairs.map((p) => p[1]));
    for (const r of [14, 33, 36, 99, 600]) assert.equal(gd.isBossRound(r), true, `e6 R${r} is a Final Assault`);
    for (const r of [15, 34, 37, 100, 601]) assert.equal(gd.isHiddenRound(r), true, `e6 R${r} is a Hidden Core`);
    for (const r of [16, 17, 31, 32, 35, 602]) assert.equal(gd.isBossRound(r) || gd.isHiddenRound(r), false, `e6 R${r} is a normal round`);
    // 无尽: a hidden core never ends the run, and past the materialised table the cadence continues arithmetically.
    assert.equal(gd.isLastHidden(601), false, 'e6 a hidden core is never the run\'s last');
    assert.equal(gd.isLastHidden(30), false, 'e6 R30 is a hidden core but not the end');
    assert.equal(gd.nextBossRound(30), 33, 'e6 the chapter after R30 opens at R33');
    assert.equal(gd.nextBossRound(601), 603, 'e6 past the table the next Final Assault is 3 rounds on');
    assert.deepEqual(gd.pairOfRound(602), { boss: 603, hidden: 604 }, 'e6 past the table the pair is derived');
  }
});

test('a mode that is not ANNIHILATION keeps the path it always took', () => {
  const CASES = [
    ['mode_single_normal', 14, 14, 15],
    ['mode_multi_normal', 14, 14, 15],
    ['mode_single_hard', 14, 14, 15],
    ['mode_single_funny', 9, 9, null],
  ];
  for (const [modeId, lastRound, bossRound, hiddenRound] of CASES) {
    // Every call shape: the old two-arg one, an empty opts, and an erosion the mode must ignore.
    for (const opts of [undefined, {}, { erosion: 1 }, { erosion: 3 }, { erosion: EROSION_MAX }]) {
      const gd = opts === undefined ? new GameData(DATA, modeId) : new GameData(DATA, modeId, opts);
      const at = `${modeId} ${JSON.stringify(opts)}`;
      assert.equal(gd.erosion, 1, `${at}: erosion stays 1`);
      assert.equal(gd.endless, false, `${at}: never endless`);
      assert.equal(gd.annihilation, null, `${at}: no annihilation block`);
      assert.equal(gd.annihilationFlags('normal', 5), null, `${at}: no annihilation battle flags`);
      assert.equal(gd.lastRound, lastRound, `${at}: lastRound`);
      assert.equal(gd.bossRound, bossRound, `${at}: bossRound`);
      assert.equal(gd.hiddenRound, hiddenRound, `${at}: hiddenRound`);
      assert.deepEqual(gd.bossHiddenPairs(), hiddenRound ? [[bossRound, hiddenRound]] : [], `${at}: the one pair of the mode`);
      assert.equal(gd.isLastHidden(hiddenRound), hiddenRound != null, `${at}: isLastHidden`);
    }
  }
});

test('an erosion outside 1..EROSION_MAX is silently 1 and never throws', () => {
  const BAD = [undefined, null, 0, -1, 7, 99, '3', '6', 3.5, NaN, Infinity, {}, [], true];
  for (const bad of BAD) {
    for (const opts of [bad, { erosion: bad }, null]) {
      const gd = new GameData(DATA, SINGLE, opts);
      const at = `opts ${JSON.stringify(opts) ?? String(opts)}`;
      assert.equal(gd.erosion, 1, `${at}: erosion falls back to 1`);
      assert.equal(gd.endless, false, `${at}: not endless`);
      assert.equal(gd.lastRound, 19, `${at}: the 蚀流 1 round total`);
      assert.deepEqual(gd.bossHiddenPairs(), [[19, 20]], `${at}: the 蚀流 1 queue`);
    }
  }
  // The accepted domain itself: every integer 1..6 arrives unchanged.
  for (let e = 1; e <= EROSION_MAX; e++) assert.equal(gdOf(SINGLE, e).erosion, e);
  assert.equal(gdOf(SINGLE, EROSION_MAX).endless, true);
  assert.equal(gdOf(SINGLE, EROSION_MAX - 1).endless, false);
});

test('the annihilation block is the mode\'s own, normalised, and null everywhere else', () => {
  const gd = gdOf(SINGLE, 1);
  const block = gd.annihilation;
  assert.ok(block, 'annihilation modes carry the block');
  assert.equal(block.terrainLethal, 5, '致命级 stage mechanics');
  assert.equal(block.chaosTargeting, true, 'enemies pick their targets at random');
  assert.equal(block.fog.afterReal, 60, 'the data\'s rise time (server/sim/content/hazard.js)');
  assert.equal(block.fog.rampReal, 20);
  assert.equal(block.fog.maxRatio, 0.2);
  // The mode's flags are all in GAME seconds for the sim (the field clock runs at the forced battle speed).
  const flags = gd.annihilationFlags('normal', 5);
  assert.equal(flags.terrainLethal, 5);
  assert.equal(flags.chaosTargeting, true);
  assert.deepEqual(flags.fog, { at: block.fog.afterReal * gd.combatTimeScale, ramp: block.fog.rampReal * gd.combatTimeScale, ratio: 0.2 });
  // No fog on a chapter's own battle (the Final Assault / Hidden Core), nor at or past the boss round.
  for (const [kind, round] of [['boss', 19], ['hidden', 20], ['normal', 19], ['normal', 20]]) {
    assert.equal(gd.annihilationFlags(kind, round).fog, undefined, `${kind} R${round} has no fog`);
  }
  assert.ok(gd.annihilationFlags('unite', 4).fog, 'a 联防 field before the Final Assault has fog');
  // 无尽湮灭: the endless run never sees the fog.
  for (const [kind, round] of [['normal', 5], ['normal', 30], ['unite', 3]]) {
    assert.equal(gdOf(SINGLE, EROSION_ENDLESS).annihilationFlags(kind, round).fog, undefined, `e6 ${kind} R${round} has no fog`);
  }
  assert.equal(gdOf('mode_multi_annihilation', 1).annihilation.chaosTargeting, true);
  assert.equal(new GameData(DATA, 'mode_single_normal').annihilation, null);
});

// ---- the rest of the play set: enemy curves, the round table, bans, weights, endless caps ---------------------------

/** The mode's own data row (what the getters are expected to read or override). */
const modeCfg = (modeId) => DATA.config.modes[modeId];

test('erosionExponent: the R1–R30 ladder, then one step every two rounds with no end', () => {
  const CASES = [
    [1, 1, false], [2, 2, false], [3, 2, false], [14, 10, false], [19, 15, false], [20, 16, false],
    [29, 20, false], [30, 21, false], [31, 22, false], [32, 22, false], [33, 23, false], [34, 23, false],
    [35, 24, false], [100, 56, false], [20, 16, true], [29, 20, true], [30, 21, true], [31, 22, true], [33, 23, true],
  ];
  for (const [round, expected, coop] of CASES) {
    assert.equal(erosionExponent(round, coop), expected, `e(${round}${coop ? ', coop' : ''})`);
  }
  let prev = 0;
  for (let r = 1; r <= 400; r++) {
    const e = erosionExponent(r);
    assert.ok(e >= prev, `e(${r}) never falls back`);
    prev = e;
  }
});

test('enemyScale: 1.2^e attack, 1.25^e / 1.3^e health, ×1.2 from 蚀流 3 — and only for ANNIHILATION', () => {
  const e1 = gdOf(SINGLE, 1);
  assert.equal(e1.enemyScale(1).hpMul, Math.pow(1.25, 1));
  assert.equal(e1.enemyScale(1).atkMul, Math.pow(1.2, 1));
  assert.equal(e1.enemyScale(1).speedMul, 1, 'no speed bonus before R3');
  assert.equal(e1.enemyScale(3).hpMul, Math.pow(1.25, 2));
  assert.equal(e1.enemyScale(3).atkMul, Math.pow(1.2, 2));
  assert.equal(e1.enemyScale(3).speedMul, 1.15, 'the base mode\'s ×1.15 from R3 stays');
  // 蚀流 3+: the tier's +20 % on top of both curves
  assert.equal(gdOf(SINGLE, 3).enemyScale(1).hpMul, Math.pow(1.25, 1) * 1.2);
  assert.equal(gdOf(SINGLE, 3).enemyScale(1).atkMul, Math.pow(1.2, 1) * 1.2);
  // the alliance reads the 1.3 ladder on the health side
  assert.equal(gdOf(MULTI, 1).enemyScale(14).hpMul, Math.pow(1.3, 10));
  assert.equal(gdOf(MULTI, 1).enemyScale(14).atkMul, Math.pow(1.2, 10));
  // past R30 the exponent holds for two rounds, then steps
  const e5 = gdOf(SINGLE, 5);
  assert.equal(e5.enemyScale(31).atkMul, e5.enemyScale(32).atkMul);
  assert.ok(e5.enemyScale(33).atkMul > e5.enemyScale(32).atkMul);
  // a mode that is not ANNIHILATION keeps the official table
  const normal = new GameData(DATA, 'mode_multi_normal');
  for (const r of [1, 3, 14]) assert.deepEqual(normal.enemyScale(r), normal.baseEnemyScale(r), `R${r} official curve`);
});

test('roundCfg: chapters replay R19/R20, R21+ cycles R14–R18, 无尽 merges the leader table', () => {
  const modes = modeCfg(SINGLE);
  const e1 = gdOf(SINGLE, 1);
  const e5 = gdOf(SINGLE, 5);
  const e6 = gdOf(SINGLE, 6);
  // below the chapters every row is handed out as it is (same object, no copy)
  for (const r of ['1', '5', '14', '18']) assert.equal(e1.roundCfg(Number(r)), modes.rounds[r], `e1 R${r} is its own row`);
  assert.equal(e1.roundCfg(19), modes.rounds['19'], 'e1 R19 is its own boss row');
  assert.equal(e1.roundCfg(20), modes.rounds['20'], 'e1 R20 is its own hidden row');
  assert.equal(e1.roundCfg(15).isBoss, false, 'e1 R15 is an ordinary round');
  // 蚀流 5 moves the chapters: every pair replays the boss / hidden level
  for (const r of [14, 19, 24, 29]) assert.equal(e5.roundCfg(r).isBoss, true, `e5 R${r} is a Final Assault`);
  for (const r of [15, 20, 25, 30]) assert.equal(e5.roundCfg(r).isHidden, true, `e5 R${r} is a Hidden Core`);
  assert.equal(e5.roundCfg(29).levelMaxPlayTime, modes.rounds['19'].levelMaxPlayTime, 'the boss level\'s own clock');
  // 无尽: the normal rounds cycle the R14–R18 level set with the 115 s limits, and never carry a boss template
  for (const [r, src] of [[31, '14'], [32, '15'], [35, '18'], [38, '16']]) {
    const cfg = e6.roundCfg(r);
    assert.equal(cfg.template, modes.rounds[src].template, `e6 R${r} replays R${src}`);
    assert.equal(cfg.combatTimeLimit, 115, `e6 R${r} combat limit`);
    assert.equal(cfg.levelMaxPlayTime, 115, `e6 R${r} level limit`);
    assert.equal(cfg.isBoss, false);
    assert.equal(cfg.isHidden, false);
    assert.equal(cfg.isSpPrepare, false);
    assert.equal(cfg.bossTemplates, null);
  }
  // 无尽: every boss / hidden round can field any of the merged leaders (7 Final Assault + 3 Hidden Core)
  const all = { ...modes.rounds['19'].bossTemplates, ...modes.rounds['20'].bossTemplates };
  for (const r of [33, 36, 600]) {
    const cfg = e6.roundCfg(r);
    assert.equal(cfg.isBoss, true, `e6 R${r} boss`);
    assert.deepEqual(Object.keys(cfg.bossTemplates).sort(), Object.keys(all).sort(), `e6 R${r} leader table`);
  }
  for (const r of [34, 601]) {
    const cfg = e6.roundCfg(r);
    assert.equal(cfg.isHidden, true, `e6 R${r} hidden`);
    assert.equal(cfg.isBoss, true, `e6 R${r} is a boss-kind level`);
    assert.deepEqual(Object.keys(cfg.bossTemplates).sort(), Object.keys(all).sort(), `e6 R${r} leader table`);
  }
  // a mode that is not ANNIHILATION gets its own row (or null) untouched
  const normal = new GameData(DATA, 'mode_multi_normal');
  for (const r of [5, 14, 21]) assert.equal(normal.roundCfg(r), DATA.config.modes.mode_multi_normal.rounds[String(r)] ?? null, `normal R${r}`);
});

test('isSpRound / spRounds: a 决策 after every even round, then every 4th past R29', () => {
  const e1 = gdOf(SINGLE, 1);
  assert.deepEqual(e1.spRounds(), [3, 5, 7, 9, 11, 13, 15, 17, 19], 'e1 drafts on every odd round before the Hidden Core');
  for (const r of [3, 5, 19]) assert.equal(e1.isSpRound(r), true, `e1 R${r} drafts`);
  for (const r of [2, 4, 20, 21]) assert.equal(e1.isSpRound(r), false, `e1 R${r} does not draft`);
  assert.equal(gdOf(SINGLE, 5).isSpRound(29), true, 'a Final Assault keeps its 决策');
  const e6 = gdOf(SINGLE, 6);
  for (const r of [3, 29, 33, 37, 41, 601]) assert.equal(e6.isSpRound(r), true, `e6 R${r} drafts`);
  for (const r of [4, 31, 35, 39]) assert.equal(e6.isSpRound(r), false, `e6 R${r} does not draft`);
  assert.equal(e6.spRounds().length, 156, 'R3…R29 odd (14) + R33, R37 … R597 (142)');
  assert.equal(e6.spRounds().slice(-1)[0], 597);
  // official modes keep their own data list
  const normal = new GameData(DATA, 'mode_multi_normal');
  assert.deepEqual(normal.spRounds(), [3, 6, 9]);
  assert.equal(normal.isSpRound(3), true);
  assert.equal(normal.isSpRound(4), false);
});

test('generation: the mode overrides merged over factions; every random type at 无尽湮灭', () => {
  const all = Object.values(DATA.factions.types).filter((t) => t && t.involveRandom).length;
  const e1 = gdOf(SINGLE, 1);
  assert.equal(e1.generation.specialEnemyNum, 4, '4 enemy types');
  assert.equal(e1.generation.maxLevelCnt, 20, '20 round slots');
  assert.equal(gdOf(SINGLE, 5).generation.specialEnemyNum, 5);
  assert.equal(gdOf(SINGLE, 5).generation.maxLevelCnt, 30);
  assert.equal(gdOf(SINGLE, 6).generation.specialEnemyNum, Math.max(1, all), '无尽湮灭 fields every randomizable type');
  assert.equal(gdOf(SINGLE, 6).generation.maxLevelCnt, 30);
  // the official generator's other fields survive the merge (waves.js reads them all through this getter)
  assert.equal(e1.generation.fillType, DATA.factions.generation.fillType);
  assert.equal(e1.generation.firstHalfMaxRound, DATA.factions.generation.firstHalfMaxRound);
  // an official mode hands back factions.generation itself — byte-identical generation to before
  const normal = new GameData(DATA, 'mode_multi_normal');
  assert.equal(normal.generation, normal.factions.generation);
});

test('bans: derived from the mode\'s own bond pool, and none at all when endless', () => {
  // 炸惊模拟's 5 bonds (data/bonds.json `zjOnly: true`) only exist inside a ZHAJING room: `GameData.bondIds` drops them
  // for every other mode (`shared/zjBonds.js` zjBondView), so the official pool measured here must skip them as well
  // (handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2).
  const list = Object.values(DATA.bonds).filter((b) => b && typeof b === 'object' && b.bondId && b.zjOnly !== true);
  const core = list.filter((b) => b.isCore === true).length;
  const addon = list.filter((b) => b.isCore !== true && b.bondId !== 'suntShip').length;
  for (const e of [1, 2, 3, 4]) {
    assert.deepEqual(gdOf(SINGLE, e).bans('ANNIHILATION'), { core: Math.max(5, Math.ceil(core / 3)), addon: Math.max(5, Math.ceil(addon / 3)) }, `e${e} bans`);
  }
  assert.deepEqual(gdOf(SINGLE, 5).bans('ANNIHILATION'), { core: Math.ceil(core / 2), addon: Math.ceil(addon / 2) }, 'e5 halves the pool, no floor');
  assert.deepEqual(gdOf(SINGLE, 6).bans('ANNIHILATION'), { core: 0, addon: 0 }, '无尽湮灭 bans no bond');
  // official modes keep config.bans
  const cfg = DATA.config.bans.HARD;
  assert.deepEqual(new GameData(DATA, 'mode_multi_hard').bans('HARD'), { core: cfg.core, addon: cfg.addon });
});

test('bossWeights: the data\'s own weights, and every leader equally likely at 无尽湮灭', () => {
  const modes = modeCfg(SINGLE);
  const e1 = gdOf(SINGLE, 1);
  assert.deepEqual(e1.bossWeights(false), Object.entries(modes.bossWeights).filter(([id, v]) => DATA.bosses[id] && Number(v) > 0));
  const merged = Object.keys({ ...modes.rounds['19'].bossTemplates, ...modes.rounds['20'].bossTemplates }).filter((id) => DATA.bosses[id]);
  assert.equal(merged.length, 10, '7 Final Assault leaders + 3 Hidden Core ones');
  const e6 = gdOf(SINGLE, 6);
  assert.deepEqual(e6.bossWeights(false).map(([id]) => id), merged, '全随机: the whole merged table');
  assert.deepEqual(e6.bossWeights(true).map(([id]) => id), merged, 'the hidden core draws from the same table');
  for (const [, weight] of e6.bossWeights(false)) assert.equal(weight, 1, 'equal weight, the data\'s weights are ignored');
});

test('无尽湮灭: unlimited equipment slots and bond layers; every other tier keeps the official caps', () => {
  const e6 = gdOf(SINGLE, 6);
  assert.equal(e6.equipPerChess, Infinity, '干员装备道具数量无限制');
  assert.equal(e6.unlimitedLayers, true, '盟约叠层无层限制');
  for (const e of [1, 5]) {
    const gd = gdOf(SINGLE, e);
    assert.ok(Number.isFinite(gd.equipPerChess) && gd.equipPerChess > 0, `e${e} keeps a finite equipment cap`);
    assert.equal(gd.unlimitedLayers, false, `e${e} keeps the official layer cap`);
  }
  const normal = new GameData(DATA, 'mode_multi_normal');
  assert.equal(normal.equipPerChess, 2);
  assert.equal(normal.unlimitedLayers, false);
});
