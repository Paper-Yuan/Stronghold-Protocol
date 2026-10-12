// test/match/standin-ownership.test.js — 0.2.0 补位 end to end on the server (the approved plan, owner's decision
// 2026-10-05): the not-owned list (room.ownership → seats[].notOwned) is checked leniently, fixed for the match and
// applied to that player's own pieces only — the chess keeps its identity for the rules (bonds, price, merge) and its
// battle unit is the official stand-in (PlayerBattleInput `standIn: true`: the stand-in's body, skill, talents, module,
// range, position), in the player's own field, the 联防 field and the boss fields alike, client-run and server-run
// identical; what shows the piece shows the stand-in (the owner's recall of the official mode, 2026-10-06): prep
// scouting (board and bench), the m.result lineup (`standInFor`), the elite and gift tickers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C2S, validateC2S, checkNotOwned, OWNERSHIP_LIMITS, checkLoadout } from '../../shared/protocol.js';
import { isDroppableChess, standInRecord } from '../../shared/standIn.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { placeClass } from '../../server/match/board.js';
import { PHASE, GEO } from '../../shared/constants.js';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const wire = (msg) => JSON.parse(JSON.stringify(msg));

const SILVER = 'chess_char_4_22_a'; // 银灰 (NORMAL) → Sharp S2, melee
const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (NORMAL, RANGED, summons 流形) → 郁金香 S3 + SOL-X, melee
const SARIA = 'chess_char_5_11_a'; // 塞雷娅 (NORMAL, MELEE) → Touch S3 + PHY-X, ranged
const CATHY = 'chess_char_4_11_a'; // 凯瑟琳 (PRESET): never droppable
const INSIDE = 'chess_char_1_01_a'; // 隐现 (PRESET) with a loadout choice

test('droppable chess = the 55 NORMAL base chess; checkNotOwned keeps those, drops the rest; the wire validator is structural', () => {
  const all = Object.values(DATA.chess);
  const drop = all.filter(isDroppableChess);
  assert.equal(drop.length, 55);
  assert.ok(drop.every((c) => c.chessType === 'NORMAL' && !c.isGolden && c.backup.charId !== c.charId));
  assert.equal(all.filter((c) => c.chessType === 'PRESET' && isDroppableChess(c)).length, 0, 'PRESET always fields its own operator');
  assert.equal(drop.filter((c) => c.visible).length, 53, '53 in this season\'s shop (2 retired forms are hidden)');
  const res = checkNotOwned([SARIA, SILVER, SILVER, CATHY, chess(SILVER).goldenId, 'chess_char_9_99_a', 'chess_diy_5_1_a', MLYSS], chess);
  assert.deepEqual(res, { ok: true, notOwned: [SILVER, SARIA, MLYSS].sort(), dropped: 5 });
  assert.deepEqual(checkNotOwned([], chess), { ok: true, notOwned: [], dropped: 0 });
  for (const bad of [null, {}, 'x', [1], ['a b'], new Array(OWNERSHIP_LIMITS.notOwned + 1).fill(SILVER)]) {
    assert.equal(checkNotOwned(bad, chess).error, 'BAD_MSG', JSON.stringify(bad)?.slice(0, 40));
  }
  assert.ok(C2S['room.ownership']);
  assert.equal(validateC2S({ t: 'room.ownership', notOwned: [SILVER, 'whatever_id'] }), null);
  assert.match(validateC2S({ t: 'room.ownership', notOwned: { a: 1 } }), /bad field notOwned/);
  assert.match(validateC2S({ t: 'room.ownership' }), /bad field notOwned/);
});

/** A co-op match: p_0 does not own 银灰 / 缪尔赛思 / 塞雷娅 (+ junk), p_1 owns everything, the bot never drops. */
function ownershipMatch(extra = {}) {
  const loadout = checkLoadout({ [INSIDE]: { skill: 0 } }, chess).loadout;
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout, notOwned: [SILVER, MLYSS, SARIA, CATHY, 'junk_id'] },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
    { seat: 2, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true, notOwned: [SILVER] },
  ];
  return makeMatch({ mode: 'coop', seats, seed: 11, ...extra });
}
function clearBoard(ps) {
  for (const p of [...ps.board.values()]) ps.returnCopies(p);
  ps.board.clear();
  for (let i = 0; i < ps.hand.length; i++) if (ps.hand[i]) { ps.returnCopies(ps.hand[i]); ps.hand[i] = null; }
  ps.recompute();
}

test('seats[].notOwned → PlayerState.standIns (re-checked, frozen; bots own everything); m.private.standIns', REAL, () => {
  const h = ownershipMatch().start();
  const p0 = h.ps('p_0');
  assert.deepEqual([...p0.standIns], [SILVER, SARIA, MLYSS].sort());
  assert.ok(Object.isFrozen(p0.standIns));
  assert.deepEqual([...h.ps('p_1').standIns], []);
  assert.deepEqual([...h.ps('ai_0').standIns], [], 'bots own every operator');
  h.m.flush(true);
  assert.deepEqual(h.lastTo('p_0', 'm.private').standIns, [SILVER, SARIA, MLYSS].sort());
  assert.deepEqual(h.lastTo('p_1', 'm.private').standIns, []);
  // a malformed list (stale client) changes nothing; a later call cannot happen through the protocol during a match
  assert.equal(p0.setNotOwned({ bad: true }), false);
  assert.equal(p0.standIns.length, 3);
  h.m.dispose();
});

test('a not-owned chess keeps its identity and fights as the stand-in: backup selection over the loadout, the stand-in\'s position, no summons', REAL, () => {
  const h = ownershipMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  for (const [id, body, skill] of [[SILVER, 'char_609_acguad', 1], [chess(SILVER).goldenId, 'char_609_acguad', 1], [MLYSS, 'char_608_acpion', 2]]) {
    const rec = chess(id);
    assert.ok(p0.fieldsStandIn(rec) && p0.fieldsStandIn(id), id);
    assert.ok(!p1.fieldsStandIn(rec), 'only the player who dropped it');
    const f = p0.fieldRecord(rec);
    assert.equal(f.charId, body);
    assert.equal(f.standInFor, rec.charId);
    assert.deepEqual([f.chessId, f.tier, f.price, f.bonds], [rec.chessId, rec.tier, rec.price, rec.bonds], 'identity kept');
    assert.equal(p0.loadoutFor(rec).skillIndex, skill, 'the backup skill');
    assert.equal(p1.fieldRecord(rec), rec);
  }
  // the elite's module is the backup's (郁金香 SOL-X on 缪尔赛思's elite), never the player's loadout
  assert.equal(p0.loadoutFor(chess(chess(MLYSS).goldenId)).moduleId, chess(chess(MLYSS).goldenId).backup.uniEquipId);
  assert.equal(p0.loadoutFor(chess(INSIDE)).skillIndex, 0, 'an owned chess keeps its loadout');
  // placement class = the deployed body's position (缪尔赛思 RANGED → 郁金香 melee; 塞雷娅 MELEE → Touch ranged)
  assert.equal(placeClass(p1, chess(MLYSS)), 'ranged');
  assert.equal(placeClass(p0, chess(MLYSS)), 'melee');
  assert.equal(placeClass(p1, chess(SARIA)), 'melee');
  assert.equal(placeClass(p0, chess(SARIA)), 'ranged');
  // summons: an owned 缪尔赛思 on the board sends her 流形 to the hand; a stand-in makes none (none of the 17 has one)
  clearBoard(p0);
  clearBoard(p1);
  const t0 = legalTileFor(m, p0, MLYSS);
  const t1 = legalTileFor(m, p1, MLYSS);
  give(m, p0, MLYSS, 'board', t0);
  give(m, p1, MLYSS, 'board', t1);
  const tokens = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'token').map((p) => p.id);
  assert.deepEqual(tokens(p1), ['token_10030_mlyss_wtrman']);
  assert.deepEqual(tokens(p0), []);
  // identity rules still read the chess: sell price, bonds
  assert.equal(p0.gd.sellPrice(MLYSS), chess(MLYSS).sellPrice);
  for (const b of chess(MLYSS).bonds) assert.ok(p0.bonds[b] && p0.bonds[b].count >= 1, `bond ${b} counts the stand-in`);
  h.invariants();
  m.dispose();
});

/** The browser's DataSource (battle/runner.js loadBrowserSim): own JSON copies of the data files, backups included. */
function browserSource() {
  const copy = (v) => JSON.parse(JSON.stringify(v));
  return new DataSource({ chess: copy(DATA.chess), enemies: copy(DATA.enemies), tokens: copy(DATA.tokens), stages: copy(DATA.stages), waves: copy(DATA.waves), backups: copy(DATA.backups) }, null);
}

test('battleInput: the player\'s not-owned chess carries standIn: true (no loadout fields); client-run and server-run battles are identical', REAL, () => {
  const h = ownershipMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clearBoard(p0);
  const sg = chess(SILVER).goldenId;
  const a = give(m, p0, sg, 'board', legalTileFor(m, p0, sg));
  const b = give(m, p0, INSIDE, 'board', legalTileFor(m, p0, INSIDE));
  const c = give(m, p0, SARIA, 'board', legalTileFor(m, p0, SARIA));
  const input = p0.battleInput();
  const by = new Map(input.units.map((u) => [u.uid, u]));
  assert.equal(by.get(a.uid).standIn, true);
  assert.ok(!('skillIndex' in by.get(a.uid)) && !('moduleId' in by.get(a.uid)), 'a stand-in carries no loadout fields');
  assert.equal(by.get(c.uid).standIn, true);
  assert.ok(!('standIn' in by.get(b.uid)));
  assert.equal(by.get(b.uid).skillIndex, 0, 'the owned chess keeps its loadout');
  // the production spec path keeps the mark; both data sources field the same stand-in and fight the same battle
  const wave = m.wave;
  const spec = wire(buildBattleSpec({
    battleId: 't.1', fieldId: 'n:p_0', kind: 'normal', seed: 77, modeId: m.modeId, round: 1, stageId: m.stageId,
    rect: { ...GEO.NORMAL_RECT }, timeLimit: 40, players: [input], spawns: wave.spawns.map((s) => ({ ...s, ownerPlayerId: 'p_0' })),
    routes: wave.routes, flags: { layerGainsEnabled: true, ...m.gd.dp }, enemyOverrides: wave.overrides ?? {}, content: 'full',
  }));
  assert.equal(spec.players[0].units.find((u) => u.uid === a.uid).standIn, true);
  const run = (ds) => {
    const bt = createBattleFromSpec(wire(spec), ds, { quiet: true, recordEvents: false });
    const u = bt.allyUnits.find((x) => x.uid === a.uid);
    const def = { charId: u.def.charId, standInFor: u.def.standInFor, skill: u.def.skill?.id, bonds: u.def.bonds, name: u.name };
    let n = 0;
    while (!bt.finished && n++ < 30 * 45) bt.step();
    const res = bt.result();
    return { def, time: res.time, killed: res.killed, units: bt.allyUnits.map((x) => [x.uid, x.defId, Math.round(x.hp * 100), x.stats?.dmg | 0, x.skill?.activations ?? null]), rng: bt.rng.state() };
  };
  const server = run(m.ds);
  const client = run(browserSource());
  assert.equal(server.def.charId, 'char_609_acguad');
  assert.equal(server.def.standInFor, chess(sg).charId);
  assert.equal(server.def.skill, standInRecord(chess(sg), DATA.backups).skill.skillId);
  assert.deepEqual(server.def.bonds, chess(sg).bonds);
  assert.deepEqual(client, server, 'the browser\'s battle equals the server\'s');
  m.dispose();
});

test('联防 and the Final Assault field carry each player\'s own marks (p_0 stand-in, p_1 the real operator)', REAL, () => {
  const h = ownershipMatch({ fake: true, clientCombat: true, clients: false }).start();
  const m = h.m;
  // 联防: the helpers' inputs (unite.js uniteBattleOpts → PlayerState.battleInput with carry / reached)
  h.toPrep(1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  clearBoard(p0);
  clearBoard(p1);
  const a0 = give(m, p0, SILVER, 'board', legalTileFor(m, p0, SILVER));
  const a1 = give(m, p1, SILVER, 'board', legalTileFor(m, p1, SILVER));
  const { players } = uniteBattleOpts(m, { helpers: [p0, p1], leaked: [] }, 60);
  const u0 = players.find((p) => p.playerId === 'p_0').units.find((u) => u.uid === a0.uid);
  const u1 = players.find((p) => p.playerId === 'p_1').units.find((u) => u.uid === a1.uid);
  assert.equal(u0.standIn, true);
  assert.ok(!('standIn' in u1) && Number.isInteger(u1.skillIndex));
  m.dispose();

  // the boss field: jump to the Final Assault prep, deploy, and read the field's BattleSpec
  const hb = ownershipMatch({ fake: true, clientCombat: true, clients: false });
  const mb = hb.m;
  const orig = mb.startRound.bind(mb);
  let jumped = false;
  mb.startRound = (r) => { if (!jumped) { jumped = true; return orig(mb.gd.bossRound); } return orig(r); };
  hb.start();
  hb.toPrep(mb.gd.bossRound);
  const b0 = hb.ps('p_0');
  const b1 = hb.ps('p_1');
  clearBoard(b0);
  clearBoard(b1);
  const s0 = give(mb, b0, SARIA, 'board', legalTileFor(mb, b0, SARIA));
  const s1 = give(mb, b1, SARIA, 'board', legalTileFor(mb, b1, SARIA));
  hb.drive(() => mb.phase === PHASE.FINAL_ASSAULT);
  assert.equal(mb.phase, PHASE.FINAL_ASSAULT);
  const units = mb.fields.flatMap((f) => (f.spec ? f.spec.players : [])).flatMap((p) => p.units.map((u) => ({ ...u, owner: p.playerId })));
  const f0 = units.find((u) => u.uid === s0.uid);
  const f1 = units.find((u) => u.uid === s1.uid);
  assert.ok(f0 && f1, 'both deployed on the boss field');
  assert.equal(f0.standIn, true);
  assert.ok(!('standIn' in f1));
  mb.dispose();
});

test('prep scouting (m.field): a teammate\'s stand-in shows the stand-in\'s art on the board and in the hand (standInFor on both)', REAL, () => {
  const h = ownershipMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clearBoard(p0);
  const onBoard = give(m, p0, SILVER, 'board', legalTileFor(m, p0, SILVER));
  const held = give(m, p0, MLYSS, 'hand');
  assert.deepEqual(m.handle('p_1', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
  const meta = wire(h.lastTo('p_1', 'm.field'));
  const by = new Map(meta.units.map((u) => [u.uid, u]));
  const bu = by.get(onBoard.uid);
  assert.deepEqual([bu.defId, bu.name, bu.spine, bu.avatar, bu.standInFor, bu.skillIndex], [SILVER, 'Sharp', 'char_609_acguad', 'char_609_acguad', chess(SILVER).charId, 1]);
  const hu = by.get(held.uid);
  const tulip = m.gd.standIn(MLYSS);
  assert.deepEqual([hu.defId, hu.name, hu.spine, hu.avatar, hu.maxHp, hu.standInFor], [MLYSS, '郁金香', 'char_608_acpion', 'char_608_acpion', tulip.stats.maxHp, chess(MLYSS).charId],
    'the hand shows the stand-in too (the owner\'s recall, 2026-10-06)');
  // an owned chess in the hand keeps its own art
  const p1 = h.ps('p_1');
  const own = give(m, p1, MLYSS, 'hand');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const ou = wire(h.lastTo('p_0', 'm.field')).units.find((u) => u.uid === own.uid);
  assert.deepEqual([ou.name, ou.spine, ou.standInFor], [chess(MLYSS).name, chess(MLYSS).assets.spine, undefined]);
  m.dispose();
});

test('what shows the piece shows the stand-in: the m.result lineup carries standInFor, the elite and gift tickers name the stand-in; the rules keep the chess', REAL, async () => {
  const { buildResult } = await import('../../server/match/results.js');
  const h = ownershipMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  clearBoard(p0);
  clearBoard(p1);
  const a = give(m, p0, SILVER, 'board', legalTileFor(m, p0, SILVER));
  const b = give(m, p0, INSIDE, 'board', legalTileFor(m, p0, INSIDE));
  const c = give(m, p1, SILVER, 'board', legalTileFor(m, p1, SILVER));
  const res = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'defeat' });
  const lineup = (pid) => new Map(res.players.find((x) => x.playerId === pid).lineup.map((e) => [e.id + '@' + e.row + ',' + e.col, e]));
  const l0 = [...lineup('p_0').values()];
  assert.equal(l0.find((e) => e.id === SILVER).standInFor, chess(SILVER).charId, 'p_0 fielded Sharp');
  assert.equal(l0.find((e) => e.id === INSIDE).standInFor, undefined, 'a PRESET chess is itself');
  assert.equal([...lineup('p_1').values()].find((e) => e.id === SILVER).standInFor, undefined, 'p_1 owns 银灰');
  assert.ok([a, b, c].every(Boolean));
  // the elite ticker: three copies merge (a rule of the chess) — the line names what everyone sees
  clearBoard(p0);
  clearBoard(p1);
  const goldName = (ps) => {
    const before = h.bc.length;
    give(m, ps, SILVER, 'hand');
    give(m, ps, SILVER, 'hand');
    ps.acquireChess(SILVER);
    const line = h.bc.slice(before).find((x) => x.t === 'm.ticker' && x.type === 'GOLDEN_CHAR');
    assert.ok(line, `${ps.playerId}: a GOLDEN_CHAR line`);
    assert.ok([...ps.hand, ...ps.temp].some((x) => x && x.id === chess(SILVER).goldenId), 'merged by the chess\'s rule');
    return line.args[1];
  };
  assert.equal(goldName(p0), 'Sharp');
  assert.equal(goldName(p1), chess(chess(SILVER).goldenId).name);
  // a gift (信标's CHAR_GIFT, sent to its receiver only) is named as the receiver sees it
  const { makeCtx } = await import('../../server/match/effectsMeta.js');
  const gift = (ps) => {
    const before = h.sent.length;
    makeCtx(m, ps, { key: 'test' }, 'onPrepStart').giftTicker('P9', SILVER);
    return h.sent.slice(before).find(([id, x]) => id === ps.playerId && x.t === 'm.ticker' && x.type === 'CHAR_GIFT')?.[1].args[1];
  };
  assert.equal(gift(p0), 'Sharp');
  assert.equal(gift(p1), chess(SILVER).name);
  m.dispose();
});
