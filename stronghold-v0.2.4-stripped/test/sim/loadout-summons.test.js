// test/sim/loadout-summons.test.js — summons follow their owner's operator loadout during the battle (DESIGN §16,
// DATA.md §14): Battle (_createAllyFromInput passes the unit's loadout, _tokenDef / spawnToken / tokenDef use the
// owner's, producesToken refuses summons the selected skill does not make), professions.js (dollkeeper substitute
// token) and content/tokens.js (tokenSources / variantOf with the owner's loadout; the skill-summon fallback also runs
// when only the selected skill falls back to the generic spec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource, getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { Battle } from '../../server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest, jsonClone } from '../../server/sim/spec.js';
import { makeBattle } from '../helpers/battleHarness.js';

const skip = !hasGeneratedData() && 'no generated data (run node tools/build-data.mjs)';
const ds = getDefaultSource();
const C = ds.raw.chess;
const T = ds.raw.tokens;
/** A fresh browser-like DataSource (no research fallback, empty caches). */
const freshDs = () => new DataSource(ds.raw, null);

const MLYSS = 'chess_char_6_11_b', WTRMAN = 'token_10030_mlyss_wtrman';   // 缪尔赛思 精锐: talent summon 流形
const CATHY = 'chess_char_4_11_a', CATSLD = 'token_10041_cathy_catsld';   // 凯瑟琳: talent devices (token skill per slot)
const HEMO = 'chess_char_2_02_a', DRONE = 'token_10000_silent_healrb';    // 赫默: S2 (default) drone, S1 none
const ROSMON = 'chess_char_6_12_a', ROSMON_B = 'chess_char_6_12_b', GEAR = 'token_10012_rosmon_shield'; // 迷迭香: S3 gear
const SWIRE = 'chess_char_3_04_b', TRAP = 'token_10031_swire2_gdtrap';    // 琳琅诗怀雅: S2 (default) bombs, S1/S3 none
const KAZEMA = 'chess_char_2_11_b', SHADOW = 'token_10022_kazema_shadow'; // 风丸 (dollkeeper)

const mk = (playerId, seat, colOffset, units) => ({ playerId, seat, side: 'L', colOffset, units, bonds: {}, playerEffects: [] });
const uniteSpec = (p1, p2, seed = 11) => buildBattleSpec({
  battleId: 'ls', fieldId: 'u:p1', kind: 'unite', seed, modeId: 'mode_multi_normal', round: 4, stageId: 'act2autochess_m01', timeLimit: 60,
  players: [mk('p1', 0, 0, p1), mk('p2', 1, 8, p2)], spawns: [], routes: [],
});
/** A normal-field spec with one player's units and a real wave (act1autochess_01). */
function normalSpec(units, { seed = 4242 } = {}) {
  const tpl = ds.getWave('act1autochess_01');
  const spawns = tpl.spawns.filter((s) => !s.action && !s.slot).map((s) => ({ time: s.time, enemyKey: s.key, routeIndex: s.routeIndex, count: s.count, interval: s.interval }));
  return buildBattleSpec({
    battleId: 'ls1', fieldId: 'n:p1', kind: 'normal', seed, modeId: 'mode_multi_normal', round: 1, stageId: 'act2autochess_m01',
    timeLimit: 90, players: [mk('p1', 0, 0, units)], spawns, routes: tpl.routes, flags: {}, waveId: 'act1autochess_01',
  });
}
const summonsOf = (b, owner, tokenId) => b.allyUnits.filter((u) => u.kind === 'token' && u.uid == null && u.ownerUnit === owner && u.defId === tokenId);
const opOf = (b, pid, uid) => b.allyUnits.find((u) => u.kind === 'op' && u.player.playerId === pid && u.uid === uid);
/** Run until `pred` holds (max `sec` s). */
function runUntil(b, pred, sec = 10) {
  for (let i = 0; i < sec * 30 && !pred() && !b.finished; i++) b.step();
  return pred();
}

test('two players in one field, same chess, different skills / modules: summons spawned mid-battle get each owner\'s variant', { skip }, () => {
  const spec = uniteSpec(
    [{ uid: 1, chessId: MLYSS, row: 10, col: 4, dir: 'RIGHT', skillIndex: 0, moduleId: 'uniequip_003_mlyss' }, { uid: 2, chessId: CATHY, row: 11, col: 4, dir: 'RIGHT', skillIndex: 0 },
      { uid: 3, kind: 'token', tokenId: CATSLD, ownerUid: 2, row: 11, col: 5, dir: 'LEFT' }],
    // p2: MLYSS with another explicit choice, CATHY without loadout fields (= the default, never p1's choice)
    [{ uid: 1, chessId: MLYSS, row: 10, col: 4, dir: 'RIGHT', skillIndex: 1, moduleId: 'none' }, { uid: 2, chessId: CATHY, row: 11, col: 4, dir: 'RIGHT' },
      { uid: 3, kind: 'token', tokenId: CATSLD, ownerUid: 2, row: 11, col: 5, dir: 'LEFT' }],
  );
  const b = createBattleFromSpec(spec, freshDs(), { recordEvents: false, quiet: true });
  assert.deepEqual([...b.data.loadoutConflicts].sort(), [CATHY, MLYSS].sort(), 'id-only lookups would give p2 p1\'s choices');
  const m1 = opOf(b, 'p1', 1), m2 = opOf(b, 'p2', 1), c1 = opOf(b, 'p1', 2), c2 = opOf(b, 'p2', 2);
  // no 流形 piece: the 援军 is summoned during the battle; 凯瑟琳's devices are board pieces (user playtest #6) whose
  // def follows the owner's loadout too
  const piecesOf = (owner) => b.allyUnits.filter((u) => u.kind === 'token' && u.uid != null && u.ownerUnit === owner && u.defId === CATSLD);
  assert.ok(runUntil(b, () => [m1, m2].every((o) => summonsOf(b, o, WTRMAN).length > 0) && [c1, c2].every((o) => piecesOf(o).some((t) => t.alive)), 5), 'every owner summoned');
  const d = freshDs();
  const w1 = summonsOf(b, m1, WTRMAN)[0], w2 = summonsOf(b, m2, WTRMAN)[0];
  assert.equal(w1.def.skill.id, 'sktok_mlyss_wtrman_1', 'p1 流形: its owner\'s S1');
  assert.equal(w2.def.skill.id, 'sktok_mlyss_wtrman_2', 'p2 流形: its owner\'s S2, not p1\'s S1');
  assert.ok(w1.def.talents.some((t) => t.bb.taunt_level === 1), 'p1 流形: module 003 token talent');
  assert.ok(!w2.def.talents.some((t) => t.bb.taunt_level === 1), 'p2 流形 (no module): no module talent');
  assert.deepEqual(w2.def.talents, d.getToken(WTRMAN, MLYSS, { skillIndex: 1, moduleId: 'none' }).talents);
  assert.equal(w2.base.maxHp, d.getToken(WTRMAN, MLYSS, { skillIndex: 1, moduleId: 'none' }).stats.maxHp);
  assert.ok(piecesOf(c1).length === 1 && piecesOf(c2).length === 1);
  for (const t of piecesOf(c1)) assert.equal(t.def.skill.id, 'sktok_cathy_catsld_1', 'p1 devices: S1 token skill');
  for (const t of piecesOf(c2)) assert.equal(t.def.skill.id, 'sktok_cathy_catsld_2', 'p2 devices (default loadout): S2 token skill');
  // Battle.tokenDef / spawnToken (content summons) resolve the owner's loadout as well
  assert.equal(b.tokenDef(WTRMAN, m1).skill.id, 'sktok_mlyss_wtrman_1');
  assert.equal(b.tokenDef(WTRMAN, m2).skill.id, 'sktok_mlyss_wtrman_2');
  assert.equal(b.tokenDef(WTRMAN, MLYSS).skill.id, 'sktok_mlyss_wtrman_1', 'a chess id alone: the view\'s (first) loadout');
  const free = [[9, 5], [9, 6], [12, 5], [12, 6], [9, 7], [12, 7]].map(([r, c]) => [r, c + 8]).find(([r, c]) => !b.unitAt(r, c) && b.grid.canStand(r, c, { ranged: true }));
  const extra = b.spawnToken(m2, WTRMAN, free[0], free[1]);
  assert.ok(extra, 'spawned');
  assert.equal(extra.def.skill.id, 'sktok_mlyss_wtrman_2');
  // deterministic whatever the source's cache state (server re-simulation / the browser sim use their own sources)
  const digest = (src) => resultDigest(createBattleFromSpec(jsonClone(spec), src, { recordEvents: false, quiet: true }).runToEnd(120));
  assert.equal(digest(freshDs()).hash, digest(ds).hash);
});

test('Battle._createAllyFromInput asks the data for the unit\'s own loadout (no field = the default)', { skip }, () => {
  const src = freshDs();
  const calls = [];
  const spy = Object.create(src);
  spy.getChess = (id, lo = null) => { calls.push([id, lo]); return src.getChess(id, lo); };
  const players = [
    mk('p1', 0, 0, [{ uid: 1, chessId: MLYSS, row: 10, col: 4, skillIndex: 0, moduleId: 'uniequip_003_mlyss' }]),
    mk('p2', 1, 8, [{ uid: 1, chessId: MLYSS, row: 10, col: 4 }]),
  ];
  const b = new Battle({ seed: 3, kind: 'unite', stageId: 'act2autochess_m01', timeLimit: 30, players, spawns: [], routes: [], data: spy, recordEvents: false, quiet: true, content: 'none' });
  const mine = calls.filter(([id]) => id === MLYSS);
  assert.deepEqual(mine[0], [MLYSS, { skillIndex: 0, moduleId: 'uniequip_003_mlyss' }]);
  assert.deepEqual(mine[1], [MLYSS, { skillIndex: null, moduleId: null }], 'an entry without fields asks for the default');
  assert.equal(opOf(b, 'p1', 1).def.loadout.moduleId, 'uniequip_003_mlyss');
  assert.equal(opOf(b, 'p2', 1).def.loadout.isDefault, true);
});

test('producesToken / spawnToken: a summon the owner\'s selected skill does not make is refused (data `sources`)', { skip }, () => {
  const run = (skillIndex) => {
    const units = [{ uid: 1, chessId: HEMO, row: 10, col: 5, ...(skillIndex != null ? { skillIndex } : {}) }];
    const h = makeBattle({ players: [mk('p1', 0, 0, units)], data: freshDs(), content: 'none' });
    h.step();
    return [h.b, h.b.allyUnits.find((u) => u.uid === 1)];
  };
  const [b1, s1] = run(0);
  assert.deepEqual(b1.tokenDef(DRONE, s1).sources, ['display'], '赫默 S1: the drone is only displayed');
  assert.equal(b1.producesToken(s1, DRONE), false);
  assert.equal(b1.spawnToken(s1, DRONE, 10, 6), null, 'refused');
  assert.equal(b1.producesToken(s1, TRAP), true, 'another chess\'s token: the data does not tell ⇒ allowed');
  assert.ok(b1.spawnToken(s1, DRONE, 10, 6, { anySource: true }), 'opts.anySource overrides');
  assert.ok(b1.spawnToken(s1, DRONE, 10, 7, { def: { name: 'inline', stats: { maxHp: 10 } } }), 'an inline def is never refused');
  assert.equal(b1.producesToken(b1.getPlayer('p1'), DRONE), true, 'player-owned summons are not policed');
  const [b2, s2] = run(null);
  assert.equal(b2.producesToken(s2, DRONE), true, '赫默 S2 (default) makes the drone');
  assert.ok(b2.spawnToken(s2, DRONE, 10, 6));
  // under the DEFAULT skill the kit stays the authority: 迷迭香 S2 does not make 战术装备 (data), content may still
  const h = makeBattle({ players: [mk('p1', 0, 0, [{ uid: 1, chessId: ROSMON, row: 10, col: 5 }])], data: freshDs(), content: 'none' });
  h.step();
  const r = h.b.allyUnits.find((u) => u.uid === 1);
  assert.equal(h.b.producesToken(r, GEAR), false);
  assert.ok(h.b.spawnToken(r, GEAR, 10, 6), 'default skill: not policed');
});

test('琳琅诗怀雅 (real content): S1 / S3 summon no 香槟炸弹; S2 (default) does', { skip }, () => {
  const bombs = (skillIndex) => {
    const b = createBattleFromSpec(normalSpec([
      { uid: 1, chessId: SWIRE, row: 10, col: 6, dir: 'RIGHT', ...(skillIndex != null ? { skillIndex } : {}) },
      { uid: 2, chessId: 'chess_char_1_02_a', row: 10, col: 5, dir: 'RIGHT' },
    ], { seed: 5 }), freshDs(), { recordEvents: false, quiet: true });
    const seen = new Set();
    for (let i = 0; i < 90 * 30 && !b.finished; i++) { b.step(); for (const u of b.allyUnits) if (u.defId === TRAP) seen.add(u); }
    return seen.size;
  };
  assert.ok(bombs(null) > 0, 'S2 (default): bombs');
  assert.equal(bombs(0), 0, 'S1: none');
  assert.equal(bombs(2), 0, 'S3: none');
});

test('spawnToken guard end to end: a kit install hook written for the default skill summons nothing under a skill that does not make the token', { skip }, () => {
  // an injected kit (independent of the real tier3 kit, which now has its own S1 / S3 specs): its `install` runs under
  // EVERY selected skill and drops a 香槟炸弹 once she stands, as the old 琳琅诗怀雅 kit's default-skill hooks did
  const kit = () => ({
    skill: { kind: 'duration', duration: 5, mods: {} }, talents: [],
    install(battle, unit) {
      battle.on('deploy', (c) => { if (c.unit === unit) battle.after(0.1, () => battle.spawnToken(unit, TRAP, unit.tileR, unit.tileC + 1), { owner: unit }); }, { owner: unit });
    },
  });
  const run = (lo) => {
    const h = makeBattle({ players: [mk('p1', 0, 0, [{ uid: 1, chessId: SWIRE, row: 10, col: 5, ...lo }])], data: freshDs(), kits: { [SWIRE]: kit } });
    h.run(0.5);
    const u = h.b.allyUnits.find((x) => x.uid === 1);
    assert.ok(u.alive && u.deployed);
    return summonsOf(h.b, u, TRAP).length;
  };
  assert.equal(run({}), 1, 'S2 (default): the kit decides');
  assert.equal(run({ skillIndex: 0 }), 0, 'S1: refused');
  assert.equal(run({ skillIndex: 2 }), 0, 'S3: refused');
});

/** 迷迭香 alone on a real normal field (a wave, so the range covers path tiles); returns [harness battle, unit]. */
function rosmon(chessId, lo, kits) {
  const spec = normalSpec([{ uid: 1, chessId, row: 10, col: 6, dir: 'RIGHT', ...lo }], { seed: 9 });
  const b = kits
    ? new Battle({ ...spec, spawns: spec.spawns, data: freshDs(), kits, recordEvents: false, quiet: true })
    : createBattleFromSpec(spec, freshDs(), { recordEvents: false, quiet: true });
  b.step();
  const u = b.allyUnits.find((x) => x.uid === 1);
  assert.ok(u.alive && u.deployed);
  return [b, u];
}

/** 迷迭香 S3 cast once: her two 战术装备 stand inside her attack range on melee tiles with the S3 token skill. */
function assertRosmonS3Gears(b, u) {
  assert.equal(u.skill.id, 'skchr_rosmon_3');
  assert.deepEqual(b.tokenDef(GEAR, u).sources, ['skill', 'display']);
  assert.equal(summonsOf(b, u, GEAR).length, 0);
  assert.ok(u.skill.activate('test', { free: true }));
  b.step();
  const gears = summonsOf(b, u, GEAR);
  assert.equal(gears.length, 2, '"部署两个战术装备"');
  const range = new Set(u.rangeKeys);
  for (const g of gears) {
    assert.ok(g.alive && range.has(g.tileR * 21 + g.tileC), 'inside her attack range');
    assert.ok(b.grid.canStand(g.tileR, g.tileC, { ranged: false }), 'on a melee tile');
    assert.equal(g.def.skill.bb.stun, 2, 'the S3 token skill (stun 2 s)');
  }
}

test('迷迭香 S3 (non-default skill that summons): two 战术装备 at skill start — real content, whichever spec runs it', { skip }, () => {
  // behaviour only: holds while her S3 runs the generic spec + tokens.js fallback AND once a hand-authored S3 lands
  const [b, u] = rosmon(ROSMON, { skillIndex: 2 });
  assertRosmonS3Gears(b, u);
});

test('迷迭香 S3 via the tokens.js fallback: a hand-authored kit without an S3 spec (generic spec for the selected skill)', { skip }, () => {
  // an injected kit, so this path stays covered after the real kit gains `skills.skchr_rosmon_3`
  const [b, u] = rosmon(ROSMON, { skillIndex: 2 }, { [ROSMON]: () => ({ skill: { kind: 'passive' }, talents: [] }) });
  assert.equal(u.kit.generic, undefined, 'a hand-authored kit…');
  assert.equal(u.kit.skillSource, 'generic', '…whose selected skill runs the generic spec');
  assertRosmonS3Gears(b, u);
});

test('迷迭香 S1 / S2 (default) summon no 战术装备; a kit `skills` entry for S3 takes the summon over', { skip }, () => {
  for (const lo of [{ skillIndex: 0 }, {}]) {
    const [b, u] = rosmon(ROSMON, lo);
    assert.ok(u.skill.activate('test', { free: true }));
    b.step();
    assert.equal(summonsOf(b, u, GEAR).length, 0, `S${u.def.loadout.skillIndex + 1}: none`);
  }
  const s3 = { kind: 'duration', duration: 5, mods: {} };
  const [b, u] = rosmon(ROSMON, { skillIndex: 2 }, { [ROSMON]: () => ({ skill: null, skills: { skchr_rosmon_3: s3 }, talents: [] }) });
  assert.equal(u.kit.skillSource, 'skills');
  assert.ok(u.skill.activate('test', { free: true }));
  assert.equal(summonsOf(b, u, GEAR).length, 0, 'the kit\'s own S3 spec: no fallback summon');
});

test('tokens.js variantOf: the deploy limit of a summon follows the owner\'s module (byModule)', { skip }, () => {
  for (const moduleId of ['none', 'uniequip_003_rosmon']) {
    const [b, u] = rosmon(ROSMON_B, { skillIndex: 2, moduleId });
    const v = T[GEAR].variants[ROSMON_B];
    const limit = (moduleId === 'none' ? v.byModule.none : v.byModule[moduleId] ?? v).stats.deployLimit;
    assert.ok(u.skill.activate('test', { free: true }));
    u.skill.end('test');
    b.step();
    assert.ok(u.skill.activate('test', { free: true }));
    const standing = summonsOf(b, u, GEAR).filter((g) => g.alive).length;
    assert.equal(standing, Math.min(4, limit), `${moduleId}: deployLimit ${limit}`);
  }
});

test('tokens.js tokenSources: the generic-kit skill-summon fallback reads the owner loadout (赫默 S1 makes no drone)', { skip }, () => {
  // the drone is a placed piece (user playtest #6): S2 deploys it once with the board (SKILL_SUMMON_START_DEPLOY) and
  // brings it back onto its tile with each cast; S1 never makes one (its piece never deploys)
  const run = (lo, atStart) => {
    const units = [{ uid: 1, chessId: HEMO, row: 10, col: 5, ...lo }, { uid: 2, kind: 'token', tokenId: DRONE, ownerUid: 1, row: 10, col: 6 }];
    const h = makeBattle({ players: [mk('p1', 0, 0, units)], data: freshDs(), kits: { [HEMO]: () => null } });
    h.step();
    const u = h.b.allyUnits.find((x) => x.uid === 1);
    assert.equal(u.kit.generic, true);
    assert.equal(h.b.allyUnits.find((x) => x.uid === 2).alive, atStart, 'with the board: S2 yes, S1 no');
    h.b.producesToken = () => true; // only the fallback's own check decides here
    assert.ok(u.skill.activate('test', { free: true }));
    return h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === DRONE && t.ownerUnit === u && t.alive).length;
  };
  assert.equal(run({}, true), 1, 'S2 (default): the drone');
  assert.equal(run({ skillIndex: 0 }, false), 0, 'S1: none');
});

test('dollkeeper: the substitute token is looked up with the unit\'s own loadout', { skip }, () => {
  const players = [mk('p1', 0, 0, [{ uid: 1, chessId: KAZEMA, row: 10, col: 5, skillIndex: 0, moduleId: 'none' }])];
  const h = makeBattle({ players, data: freshDs() });
  h.step();
  const u = h.b.allyUnits.find((x) => x.uid === 1);
  const calls = [];
  const view = h.b.data;
  const orig = view.getToken.bind(view);
  view.getToken = (...a) => { calls.push(a); return orig(...a); };
  h.b.dealDamage(null, u, { amount: 1e7, type: 'true' });
  assert.ok(u.alive && u.trait.doll, 'substitute');
  const call = calls.find(([id]) => id === SHADOW);
  assert.ok(call, 'the 纸偶 was looked up');
  assert.equal(call[1], KAZEMA);
  assert.equal(call[2], u.def.loadout, 'with the owner\'s loadout');
  assert.equal(call[2].skillIndex, 0);
  assert.equal(call[2].moduleId, 'none');
});
