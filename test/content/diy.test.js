// test/content/diy.test.js — 自选 pieces in battle (DATA.md §18, docs/SIM.md §12): simdata getChess(slotId, { diy }) /
// getDiy, the PlayerBattleInput `diy` field through Battle, the BattleSpec path and the per-battle loadout view, the
// kit lookup by charId (an owned 6★'s operator kit, a prototype's stand-in kit, a 预备干员's generic kit, the generic kit
// for an operator without one), the summons of an owned pick (data/backups.json `tokens`, getToken with the pick as the
// owner's loadout) and the wire info. The 推进之王 kit itself: test/content/op_siege.test.js.
// Run: node --test test/content/diy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants, flatStage, flatRoutes } from '../helpers/battleHarness.js';
import { getDefaultSource, DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { isDiyDef, kitOf } from '../../server/sim/content/index.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const BACKUPS = load('backups');
const SIEGE = 'char_112_siege';
/** An owned 6★ without an operator kit yet (the generic kit's case) — the first of diy.ownedPool, null once all have one. */
const KITLESS = BACKUPS.diy.ownedPool.find((id) => !KITTED_CHARS.includes(id)) ?? null;
const T5 = 'chess_char_5_diy1_a', T6 = 'chess_char_6_diy1_a';
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy') };

function battle(units, o = {}) {
  return makeBattle({ defs: { enemies: ENEMIES }, units, timeLimit: 300, autoFinish: false, seed: o.seed ?? 7, flags: { dpPerSec: 0 }, ...o });
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('getChess(slotId, { diy }): the 自选 def — the slot\'s ids / tier, the pick\'s body, skill, module and bonds; diyFor, charId, loadout.diy, tokenOwner; cached; null for an illegal pick', () => {
  const ds = getDefaultSource();
  const pick = { charId: SIEGE, skillIndex: 0, uniEquipId: 'uniequip_003_siege' };
  const d = ds.getChess('chess_char_6_diy1_b', { diy: pick });
  assert.deepEqual([d.id, d.baseId, d.golden, d.tier, d.charId, d.diyFor, d.name, d.profession], ['chess_char_6_diy1_b', T6, true, 6, SIEGE, T6, '推进之王', 'PIONEER']);
  assert.deepEqual([d.bonds, d.raw.garrisonIds, d.skill.id, d.raw.module.id, d.raw.module.level, d.raw.module.active], [['victoriaShip'], [], 'skcom_charge_cost[3]', 'uniequip_003_siege', 3, true]);
  assert.deepEqual(d.loadout.diy, pick);
  assert.equal(d.tokenOwner, 'char_112_siege@2/60/7/3');
  assert.ok(isDiyDef(d) && Object.isFrozen(d));
  assert.equal(ds.getChess('chess_char_6_diy1_b', { diy: { ...pick } }), d, 'cached per (id, pick)');
  assert.equal(ds.getChess(T6, { diy: { charId: 'char_601_cguard' } }), null, 'a reserve is no tier-6 pick');
  assert.equal(ds.getChess(T5, { diy: { charId: 'char_609_acguad', skillIndex: 0 } }), null, 'a prototype off its locked skill');
  assert.equal(ds.getChess('chess_char_5_01_a', { diy: pick }), null, 'not a slot');
  const proto = ds.getChess(T5, { diy: { charId: 'char_617_sharp2' } });
  assert.deepEqual([proto.skill.id, proto.loadout.diy], ['skchr_sharp2_1', { charId: 'char_617_sharp2', skillIndex: 0, uniEquipId: 'uniequip_002_sharp2' }], '领主·Sharp: S1, its module (inactive on the normal form)');
  assert.equal(proto.raw.module.active, false);
});

test('a battle fields 自选 pieces by their kit: an owned 6★\'s operator kit (keyed by its charId), a prototype\'s stand-in kit, a 预备干员\'s generic kit, the generic kit (+ its exact talents) without a kit', () => {
  // an injected kit keyed by the operator's charId — what kits/ops/op-<codename>.js registers (KITS[charId])
  const siegeKit = () => ({ skills: { skchr_siege_2: { kind: 'charges' } }, talents: [], diyProbe: true });
  const h = battle([
    { diy: { slot: 5, charId: SIEGE, skillIndex: 1 }, row: 10, col: 3 },
    { diy: { slot: 'chess_char_5_diy2_a', charId: 'char_609_acguad' }, elite: true, row: 10, col: 5 },
    { diy: { slot: T6, charId: 'char_617_sharp2' }, elite: true, row: 10, col: 7 },
    ...(KITLESS ? [{ diy: { slot: 'chess_char_6_diy2_a', charId: KITLESS, skillIndex: 2 }, row: 11, col: 3 }] : []),
    { diy: { slot: 'chess_char_6_diy2_a', charId: 'char_601_cguard' }, row: 11, col: 5 },   // illegal at tier 6: never fielded
  ], { kits: { [SIEGE]: siegeKit, chess_char_5_diy1_a: () => { throw new Error('a 自选 piece never runs a kit of its slot id'); } } });
  h.step();
  const [siege, sharp, sharp2, kitless] = [1, 2, 3, 4].map((uid) => h.unit(uid));
  assert.equal(h.unit(KITLESS ? 5 : 4), null, 'an illegal pick fields nothing');
  assert.deepEqual([siege.defId, siege.def.charId, siege.skill.id, siege.kit.diyProbe, siege.kit.skillSource], [T5, SIEGE, 'skchr_siege_2', true, 'skills']);
  assert.equal(kitOf(siege.def, { [T5]: 'slot', chess_char_5_diy1: 'bare', [SIEGE]: 'mine' }), 'mine', 'kitOf: by charId only');
  assert.equal(kitOf(siege.def, { [T5]: 'slot' }), undefined);
  assert.deepEqual([sharp.defId, sharp.def.charId, sharp.skill.id, !!sharp.kit.generic, sharp.kit.skillSource, sharp.def.raw.module.level], ['chess_char_5_diy2_b', 'char_609_acguad', 'skchr_acguad_3', false, 'skills', 1]);
  assert.deepEqual([sharp2.skill.id, !!sharp2.kit.generic, sharp2.def.raw.module.level, sharp2.def.raw.module.active], ['skchr_sharp2_1', false, 3, true], '领主·Sharp at tier 6: S1 + LOR-X stage 3');
  if (KITLESS) {
    assert.deepEqual([kitless.def.charId, kitless.skill.id, !!kitless.kit.generic, kitless.def.bonds],
      [KITLESS, BACKUPS.units[KITLESS].forms['2/1/4/0'].skills[2].skillId, true, BACKUPS.diy.operators[KITLESS].bonds], `${KITLESS} has no kit yet: the generic kit`);
  }
  // the elite reserve uses the generic kit with its exact stat talents (as a 补位 stand-in does)
  const h2 = battle([{ diy: { slot: 5, charId: 'char_601_cguard' }, elite: true, row: 10, col: 3 }]);
  h2.step();
  const g = h2.unit(1);
  assert.deepEqual([g.def.charId, g.skill.id, !!g.kit.generic], ['char_601_cguard', 'skcom_atk_up[3]', true], '预备干员-近卫 at tier 5: S3 攻击力强化·γ型, its 补位 row');
  assert.ok(Math.abs(g.s.atk - g.base.atk * 1.08) < 1e-6, 'its talent 攻击提升 (攻击力+8%) through genericTalents');
  done(h);
  done(h2);
});

test('BattleSpec path: buildBattleSpec keeps a well-formed `diy` (and drops a malformed one); the spec battle fields the 自选 def, with the per-unit pick exact when two players fill one slot id differently', () => {
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_diy1_b', diy: { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege', extra: 1 }, row: 10, col: 4 }] },
    { playerId: 'p2', seat: 1, side: 'L', colOffset: 0, bonds: {}, units: [
      { uid: 1, kind: 'chess', chessId: 'chess_char_5_diy1_b', diy: { charId: 'char_611_acnipe' }, row: 11, col: 4 },
      { uid: 2, kind: 'chess', chessId: 'chess_char_5_diy2_a', diy: { charId: 'not ok!' }, row: 12, col: 4 },
    ] },
  ];
  const spec = buildBattleSpec({ battleId: 'diy', kind: 'normal', seed: 3, stageId: null, players, spawns: [], routes: flatRoutes(), timeLimit: 30 });
  assert.deepEqual(spec.players[0].units[0].diy, { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' }, 'reduced to the pick');
  assert.deepEqual(spec.players[1].units[0].diy, { charId: 'char_611_acnipe' });
  assert.equal('diy' in spec.players[1].units[1], false, 'a malformed pick is dropped');
  // the same players through the harness (a flat stage; the spec carries no stage object): each unit its own pick
  const h = makeBattle({ defs: { enemies: ENEMIES }, players: spec.players, timeLimit: 30, autoFinish: false, stage: flatStage(), flags: { dpPerSec: 0 } });
  h.step();
  const mine = h.b.allyUnits.find((u) => u.ownerId === 'p1' && u.uid === 1);
  const theirs = h.b.allyUnits.find((u) => u.ownerId === 'p2' && u.uid === 1);
  assert.deepEqual([mine.def.charId, mine.skill.id, theirs.def.charId, theirs.skill.id], [SIEGE, 'skchr_siege_3', 'char_611_acnipe', 'skchr_acnipe_3']);
  assert.ok(h.b.data.loadoutConflicts.includes('chess_char_5_diy1_b'), 'the id-only view notes the conflict; each unit still has its own def');
  assert.equal(h.b.allyUnits.some((u) => u.ownerId === 'p2' && u.uid === 2), false, 'a DIY slot without a pick fields nothing');
  done(h);
  // and createBattleFromSpec on a real stage builds the same 自选 def
  const stageId = Object.keys(load('stages')).find((id) => load('stages')[id].kind !== 'unite');
  const b = createBattleFromSpec({ ...spec, stageId, routes: [] }, getDefaultSource(), { quiet: true });
  b.step();
  assert.deepEqual(b.allyUnits.filter((u) => u.kind === 'op').map((u) => [u.ownerId, u.def.charId, u.def.loadout.diy.skillIndex]), [['p1', SIEGE, 2], ['p2', 'char_611_acnipe', 2]]);
});

test('summons of an owned pick: battle.tokenDef resolves the variant of its form and pick (令 at tier 6 elite: S3 makes 弦惊, not 清平)', () => {
  const h = battle([{ diy: { slot: 6, charId: 'char_2023_ling', skillIndex: 2, uniEquipId: 'uniequip_002_ling' }, elite: true, row: 10, col: 4 }]);
  h.step();
  const u = h.unit(1);
  assert.equal(u.def.tokenOwner, 'char_2023_ling@2/60/7/3');
  const rec3 = BACKUPS.tokens.token_10020_ling_soul3;
  const v = rec3.variants['char_2023_ling@2/60/7/3'];
  const t3 = h.b.tokenDef('token_10020_ling_soul3', u);
  assert.deepEqual([t3.id, t3.sources, t3.skill?.id], ['token_10020_ling_soul3', ['skill', 'display'], v.bySkill['2'].skill.skillId]);
  const stats = { ...v.stats, ...(v.byModule?.uniequip_002_ling?.stats ?? {}) };
  assert.deepEqual([t3.stats.maxHp, t3.stats.atk, t3.stats.def], [stats.maxHp, stats.atk, stats.def], 'the form\'s stats with the module\'s token attributes');
  assert.equal(h.b.producesToken(u, 'token_10020_ling_soul3'), true);
  assert.equal(h.b.producesToken(u, 'token_10020_ling_soul1'), false, 'S3 does not make 清平');
  const t1 = h.b.tokenDef('token_10020_ling_soul1', u);
  assert.deepEqual(t1.sources, ['display']);
  // the same token of the normal form (tier 5, no module) is the form's own variant
  const h2 = battle([{ diy: { slot: 5, charId: 'char_2023_ling', skillIndex: 0 }, row: 10, col: 4 }]);
  h2.step();
  const n1 = h2.b.tokenDef('token_10020_ling_soul1', h2.unit(1));
  assert.deepEqual([n1.sources, n1.stats.atk], [['skill', 'display'], BACKUPS.tokens.token_10020_ling_soul1.variants['char_2023_ling@2/1/4/0'].stats.atk]);
  done(h);
  done(h2);
});

test('wire info: a 自选 piece carries its pick (defId = the slot; spine / avatar = the operator\'s; no 补位 mark)', () => {
  const h = battle([{ diy: { slot: 5, charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' }, elite: true, row: 10, col: 4 }]);
  h.step();
  const info = unitInfo(h.unit(1));
  assert.deepEqual([info.defId, info.spine, info.avatar, info.tier, info.golden, info.skillIndex, info.moduleId, info.standInFor],
    ['chess_char_5_diy1_b', SIEGE, `${SIEGE}_2`, 5, true, 2, 'uniequip_002_siege', undefined]);
  assert.deepEqual(info.diy, { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' });
  const plain = battle([{ chessId: 'chess_char_1_02_a', row: 10, col: 4 }]);
  plain.step();
  assert.equal(unitInfo(plain.unit(1)).diy, undefined);
  done(h);
});

test('a DataSource without backups.json fields no 自选 piece (null def), and its plain DIY slot def is unchanged', () => {
  const ds = new DataSource({ chess: { [T5]: load('chess')[T5] } }, null);
  assert.equal(ds.getChess(T5, { diy: { charId: SIEGE, skillIndex: 0 } }), null);
  assert.equal(ds.getChess(T5).name, '甄选干员');
});
