// A teammate's operator shows ITS owner's skill / module in the detail card (DESIGN §16), not the viewer's loadout nor
// the defaults: prep scouting (前往查看 → g.watch 'n:<pid>' → m.field prep: true, Match.prepFieldMeta) and the sim's
// UnitInfo in shared fields (联防 / 最终攻势 / an observed battle) carry `skillIndex` / `moduleId` per unit, and the
// game screen's detail card composes them (gameLogic unitLoadout → chessLoadout). Regression: the card showed the
// defaults for every teammate unit (m.field prep units had no loadout; the sim UnitInfo had no module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHASE } from '../../shared/constants.js';
import { checkLoadout, loadoutOptions, MODULE_NONE } from '../../shared/protocol.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { unitLoadout, chessLoadout } from '../../public/js/ui/gameLogic.js';
import { DATA, makeMatch } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const INSIDE = 'chess_char_1_01_a'; // 隐现: S1 / S2 (default S2), elite module MAR-X (uniequip_002_inside) or none
const SWIRE = 'chess_char_3_04_a'; // 琳琅诗怀雅: several elite modules
const wire = (msg) => JSON.parse(JSON.stringify(msg)); // what the scout's browser receives (undefined dropped)

function place(ps, chessId, row, col) {
  const p = ps.newPiece('chess', chessId);
  ps.board.set(`${row},${col}`, p);
  return p;
}
function clearBoard(ps) {
  for (const p of [...ps.board.values()]) ps.returnCopies(p);
  ps.board.clear();
}

test('prep scouting: m.field units carry the scouted player\'s skill / module (the viewer\'s loadout never leaks)', REAL, () => {
  const sg = chess(chess(SWIRE).goldenId);
  const alt = sg.modules.find((x) => !x.isDefault).uniEquipId;
  const lo0 = checkLoadout({ [INSIDE]: { skill: 0, module: MODULE_NONE }, [SWIRE]: { skill: 0, module: alt } }, chess).loadout;
  const lo1 = checkLoadout({ [INSIDE]: { skill: 0 } }, chess).loadout; // p_1: S1 for 隐现, modules on the defaults
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout: lo0 },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, loadout: lo1 },
  ];
  const h = makeMatch({ mode: 'coop', seats, seed: 5 }).start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  clearBoard(p0);
  clearBoard(p1);
  const n = place(p0, INSIDE, 9, 3); // normal: S1, no module
  const g = place(p0, chess(INSIDE).goldenId, 10, 3); // elite: S1 + 不装备
  const s = place(p0, sg.chessId, 11, 3); // elite: S1 + the alternative module
  const plain = Object.values(DATA.chess).find((c) => !c.isGolden && c.visible && !c.isHidden && !c.isDiy && c.chessId !== INSIDE && c.chessId !== SWIRE);
  const pl = place(p0, plain.goldenId, 12, 3); // not in the loadout: defaults
  const t = place(p1, chess(INSIDE).goldenId, 10, 4); // p_1's own elite 隐现: S1 + its default module

  // p_1 scouts p_0 (前往查看 in prep)
  assert.equal(m.phase, PHASE.PREP);
  assert.deepEqual(m.handle('p_1', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
  const meta = wire(h.lastTo('p_1', 'm.field'));
  assert.equal(meta.prep, true);
  const by = new Map(meta.units.map((u) => [u.uid, u]));
  assert.equal(by.get(n.uid).skillIndex, 0);
  assert.ok(!('moduleId' in by.get(n.uid)), 'normal chess have no module');
  assert.deepEqual([by.get(g.uid).skillIndex, by.get(g.uid).moduleId], [0, MODULE_NONE]);
  assert.deepEqual([by.get(s.uid).skillIndex, by.get(s.uid).moduleId], [0, alt]);
  const pg = chess(plain.goldenId);
  const pOpt = loadoutOptions(plain, pg);
  assert.deepEqual([by.get(pl.uid).skillIndex, by.get(pl.uid).moduleId], [pOpt.defaultSkill, pOpt.defaultModule]);
  // exactly what the scouted board fights with (PlayerBattleInput units)
  for (const u of p0.battleInput().units) {
    const v = by.get(u.uid);
    assert.equal(v.skillIndex, u.skillIndex, `${u.chessId}: skill`);
    assert.equal(v.moduleId ?? null, u.moduleId ?? null, `${u.chessId}: module`);
  }

  // the scout's detail card (game.js detailLoadout → unitLoadout → DetailPanel chessLoadout) shows p_0's choice
  const card = (u) => chessLoadout(chess(u.defId), unitLoadout(chess(u.defId), u), chess);
  assert.deepEqual([card(by.get(g.uid)).skillIndex, card(by.get(g.uid)).module.id], [0, MODULE_NONE]);
  assert.equal(card(by.get(g.uid)).changed, true, 'shown as 已调配');
  assert.deepEqual([card(by.get(s.uid)).skillIndex, card(by.get(s.uid)).module.id], [0, alt]);
  assert.equal(card(by.get(n.uid)).skillIndex, 0);
  assert.equal(card(by.get(pl.uid)).changed, false, 'defaults stay defaults');
  // …and p_1's own loadout (隐现 elite on S1 with its default module) does not bleed into p_0's 隐现 cards
  const own = chessLoadout(chess(g.id), p1.loadout, chess);
  assert.equal(own.module.id, 'uniequip_002_inside');
  assert.notEqual(card(by.get(g.uid)).module.id, own.module.id);

  // the other way round: p_0 scouts p_1 → p_1's loadout, not p_0's 不装备
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const u1 = wire(h.lastTo('p_0', 'm.field')).units.find((u) => u.uid === t.uid);
  assert.deepEqual([u1.skillIndex, u1.moduleId], [0, 'uniequip_002_inside']);
  assert.deepEqual([card(u1).skillIndex, card(u1).module.id], [0, 'uniequip_002_inside']);
  m.dispose();
});

test('sim UnitInfo (shared fields): each helper\'s elite carries its own module; normal chess / enemies none', REAL, () => {
  const G = chess(INSIDE).goldenId;
  const h = makeBattle({
    kind: 'unite',
    players: [
      { playerId: 'A', seat: 0, side: 'L', colOffset: 0, units: [
        { uid: 11, kind: 'chess', chessId: G, row: 10, col: 4, skillIndex: 0, moduleId: MODULE_NONE },
        { uid: 12, kind: 'chess', chessId: INSIDE, row: 11, col: 4, skillIndex: 0 },
      ] },
      { playerId: 'B', seat: 1, side: 'L', colOffset: 8, units: [{ uid: 21, kind: 'chess', chessId: G, row: 10, col: 4 }] },
    ],
    enemies: [], autoFinish: false, timeLimit: 10,
  });
  h.step();
  const spawns = new Map(h.eventsOf('spawn').map((e) => [e[1].uid, wire(e[1])]));
  const meta = new Map(wire(h.b.fieldMeta()).units.map((u) => [u.uid, u]));
  for (const src of [spawns, meta]) {
    assert.deepEqual([src.get(11).skillIndex, src.get(11).moduleId, src.get(11).ownerId], [0, MODULE_NONE, 'A']);
    assert.deepEqual([src.get(21).skillIndex, src.get(21).moduleId, src.get(21).ownerId], [1, 'uniequip_002_inside', 'B'], 'B on the defaults');
    assert.equal(src.get(12).skillIndex, 0);
    assert.ok(!('moduleId' in src.get(12)), 'normal chess: no module');
  }
  // A viewer (B) opening A's elite sees S1 + 不装备
  const lo = chessLoadout(chess(G), unitLoadout(chess(G), meta.get(11)), chess);
  assert.deepEqual([lo.skillIndex, lo.module.id, lo.module.none], [0, MODULE_NONE, true]);
  // enemies never carry a loadout
  const en = h.spawn('enemy_1007_slime');
  assert.ok(en);
  h.step();
  const ei = wire(h.eventsOf('spawn').map((e) => e[1]).find((u) => u.side === 'enemy'));
  assert.ok(ei && !('moduleId' in ei) && !('skillIndex' in ei));
});

test('gameLogic unitLoadout: the unit\'s own skill / module keyed by the base chess id; nothing carried → defaults', () => {
  const sk = (index, isDefault = false) => ({ index, skillId: `sk_${index}`, iconId: `sk_${index}`, name: `技能${index}`, isDefault });
  const base = { chessId: 'c_a', baseId: 'c_a', goldenId: 'c_b', isGolden: false, visible: true, skill: sk(2, true), skills: [sk(0), sk(1), sk(2, true)] };
  const gold = { chessId: 'c_b', baseId: 'c_a', isGolden: true, visible: true, skill: sk(2, true), skills: [sk(0), sk(1), sk(2, true)],
    module: { id: 'uniequip_x', name: '模组X', type: 'XYZ-X', active: true },
    modules: [{ uniEquipId: 'uniequip_x', name: '模组X', typeName: 'XYZ-X', isDefault: true }, { uniEquipId: 'uniequip_y', name: '模组Y', typeName: 'XYZ-Y' }] };
  const get = (id) => ({ c_a: base, c_b: gold }[id] || null);
  assert.deepEqual(unitLoadout(gold, { defId: 'c_b', skillIndex: 0, moduleId: 'uniequip_y' }), { c_a: { skill: 0, module: 'uniequip_y' } });
  assert.deepEqual(unitLoadout(base, { defId: 'c_a', skillIndex: 1, moduleId: 'uniequip_y' }), { c_a: { skill: 1 } }, 'a normal chess has no module');
  assert.equal(unitLoadout(base, { defId: 'c_a' }), null, 'nothing carried');
  assert.equal(unitLoadout(base, { skillIndex: -1, moduleId: '' }), null, 'junk ignored');
  assert.equal(unitLoadout(null, { skillIndex: 0 }), null);
  assert.equal(unitLoadout(base, null), null);
  const r = chessLoadout(gold, unitLoadout(gold, { skillIndex: 0, moduleId: 'uniequip_y' }), get);
  assert.deepEqual([r.skill.skillId, r.module.id, r.changed], ['sk_0', 'uniequip_y', true]);
  const d = chessLoadout(gold, unitLoadout(gold, { skillIndex: 2 }), get);
  assert.deepEqual([d.skill.skillId, d.module.id, d.changed], ['sk_2', 'uniequip_x', false], 'no module carried → the default one');
});

test('game.js: a teammate unit\'s detail card uses the unit\'s own loadout (never the viewer\'s, never forced defaults)', () => {
  const src = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  const i = src.indexOf('const detailLoadout = (() => {');
  assert.ok(i > 0, 'detailLoadout present');
  const block = src.slice(i, src.indexOf('})();', i));
  assert.match(block, /unitLoadout\(resolved\.chess, u\)/, 'teammate units → unitLoadout');
  assert.match(block, /owner === myId\)\) return priv\?\.loadout/, 'own units → m.private.loadout');
});
