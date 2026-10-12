// test/match/diy-bonds.test.js — 0.2.0 自选编队: a 自选 piece is a member of each of its derived bonds (data/backups.json
// diy.operators[charId].bonds — its factions, else 协防; "甄选加入的干员会根据其实际阵营所属分配核心盟约…一个或数个", PRTS 卫戍协议：
// 盟约 下半/PRTS盟约记录) in every place membership is decided: the match's bond counts (bondsMeta through the player's
// data view — BOARD / BOARD_AND_DECK distinct pieces: the normal and elite copies of one slot count once; 煌 counts for
// 炎 and 维多利亚; 绝技 counts a 自选 elite like any elite), the views (m.private / m.public bonds), the battle input's
// bond snapshot, and the sim's bond effects (they read the unit's def.bonds: 叙拉古 on deployment, 协防 ×1.2 / elite ×1.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { makeBattle, checkInvariants as checkBattle } from '../helpers/battleHarness.js';
import { DATA, makeMatch, legalTileFor } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy2_a';
const T6A = 'chess_char_6_diy1_a';
const HUANG = 'char_017_huang'; // 煌: 炎 + 维多利亚 (both from her 隐藏势力)
const CROSLY = 'char_1502_crosly'; // 弑君者: 叙拉古
const SHARP = 'char_609_acguad'; // a prototype: 协防
const OPS = DATA.backups?.diy?.operators ?? {};

function soloMatch() {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }];
  const h = makeMatch({ mode: 'solo', seats, seed: 21 }).start();
  h.toPrep(1);
  return h;
}
/** Slot `picks` for p_0 now (kit list widened for operators whose kit is still being written) and give it stock. */
function slot(h, picks) {
  const p0 = h.ps('p_0');
  assert.equal(p0.setDiy(picks, { kitted: [...KITTED_CHARS, HUANG, CROSLY] }), true);
  p0.initDiyStock(new Set());
  p0.recompute();
  return p0;
}
function deploy(h, ps, id) {
  const p = ps.acquireChess(id, { source: 'buy' });
  const t = legalTileFor(h.m, ps, p.id);
  assert.ok(t, `a tile for ${id}`);
  assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.move', uid: p.uid, to: { area: 'board', row: t[0], col: t[1] } }), { ok: true });
  return p;
}

test('the derived bonds of the data: each owned pick its core bonds or 协防, 煌 alone two, every prototype 协防 (read from the data)', REAL, () => {
  const owned = DATA.backups.diy.ownedPool; // never hard-coded: the pool changes (焰狐龙梓兰 left it as a collab operator)
  const core = new Set(Object.entries(DATA.bonds).filter(([, b]) => b && b.isCore).map(([id]) => id));
  for (const id of owned) {
    const b = OPS[id].bonds;
    assert.ok(b.length >= 1, id);
    assert.ok((b.length === 1 && b[0] === 'emptyShip') || b.every((x) => core.has(x)), `${id}: ${b.join(', ')}`);
  }
  assert.deepEqual(OPS[HUANG].bonds, ['yanShip', 'victoriaShip']);
  assert.deepEqual(owned.filter((id) => OPS[id].bonds.length > 1), [HUANG], '煌 alone has several');
  assert.deepEqual(OPS.char_300_phenxi.bonds, ['lateranoShip']);
  assert.deepEqual(OPS.char_4098_vvana.bonds, ['kazimierzShip']);
  assert.deepEqual(OPS[CROSLY].bonds, ['siracusaShip']);
  for (const id of [...DATA.backups.diy.prototypes[5], ...DATA.backups.diy.prototypes[6]]) assert.deepEqual(OPS[id].bonds, ['emptyShip'], id);
});

test('煌 counts for 炎 and 维多利亚; its normal and elite copies count once; views and the battle input agree', REAL, () => {
  const h = soloMatch();
  const p0 = slot(h, { [T5A]: { charId: HUANG, skillIndex: 0 } });
  const before = { yan: p0.bonds.yanShip?.count ?? 0, vic: p0.bonds.victoriaShip?.count ?? 0 };
  deploy(h, p0, T5A);
  assert.equal(p0.bonds.yanShip.count, before.yan + 1, '炎');
  assert.equal(p0.bonds.victoriaShip.count, before.vic + 1, '维多利亚');
  // a second copy in the hand: still one distinct member (BOARD counts the slot once)
  p0.acquireChess(T5A, { source: 'buy' });
  assert.equal(p0.bonds.yanShip.count, before.yan + 1);
  h.m.flush(true);
  const priv = h.lastTo('p_0', 'm.private');
  assert.equal(priv.bonds.find((b) => b.bondId === 'yanShip').count, before.yan + 1);
  assert.equal(priv.bonds.find((b) => b.bondId === 'victoriaShip').count, before.vic + 1);
  const pub = h.lastBc('m.public');
  assert.equal(pub.players[0].bonds.find((b) => b.bondId === 'victoriaShip').count, before.vic + 1, 'm.public (a teammate\'s strip)');
  const input = p0.battleInput();
  assert.equal(input.bonds.yanShip.count, before.yan + 1, 'the battle input\'s bond snapshot');
  h.invariants();
  h.m.dispose();
});

test('协防: two 自选 prototypes (a tier-5 and a tier-6 slot) enable it; a preset 协防 chess with one too; 绝技 counts 自选 elites', REAL, () => {
  const h = soloMatch();
  const p0 = slot(h, { [T5B]: { charId: SHARP }, [T6A]: { charId: SHARP } });
  assert.ok(!p0.bonds.emptyShip?.active);
  deploy(h, p0, T5B);
  assert.equal(p0.bonds.emptyShip.count, 1);
  deploy(h, p0, T6A);
  assert.equal(p0.bonds.emptyShip.count, 2, 'two slots = two chess (like any operator who is two chess) [ASSUMED]');
  assert.equal(p0.bonds.emptyShip.active, true);
  // 绝技 (BOARD_ALL_CHESS): every elite on the board — a 自选 elite included
  const sunt0 = p0.bonds.suntShip?.count ?? 0;
  deploy(h, p0, 'chess_char_5_diy2_b');
  assert.equal(p0.bonds.suntShip.count, sunt0 + 1);
  h.invariants();
  h.m.dispose();
});

test('sim: a 叙拉古 自选 piece gets 叙拉古\'s deployment buff; a 协防 one the ×1.2 damage (elite ×1.4)', REAL, () => {
  const bonds = { siracusaShip: { count: 3, active: true, tier: 1, layers: 10 }, emptyShip: { count: 2, active: true, tier: 1, layers: 0 } };
  const h = makeBattle({
    units: [
      { diy: { slot: 5, charId: CROSLY, skillIndex: 0 }, row: 10, col: 4 },
      { diy: { slot: T5B, charId: SHARP }, row: 10, col: 6 },
      { diy: { slot: 6, charId: SHARP }, elite: true, row: 11, col: 6 },
    ],
    bonds,
    timeLimit: 10,
  });
  h.run(1);
  const crosly = h.allies().find((u) => u.def?.charId === CROSLY);
  const [normal, elite] = [h.allies().find((u) => u.def?.charId === SHARP && !u.def.golden), h.allies().find((u) => u.def?.charId === SHARP && u.def.golden)];
  assert.ok(crosly && normal && elite, 'the three 自选 pieces are fielded');
  assert.deepEqual(crosly.def.bonds, ['siracusaShip']);
  assert.ok(crosly.hasBuff('bond:siracusa'), '叙拉古: ASPD on deployment');
  assert.ok(!normal.hasBuff('bond:siracusa'), 'not for a non-member');
  const scale = (u) => u.buffs.filter((b) => /empty/i.test(b.key)).map((b) => b.mods?.dmgDealtMul).find((x) => x != null);
  const bb = DATA.bonds.emptyShip;
  assert.ok(bb);
  assert.equal(scale(normal), 1.2, '协防 member ×1.2');
  assert.equal(scale(elite), 1.4, '协防 elite member ×1.4');
  assert.equal(scale(crosly), undefined, '弑君者 is no 协防 member');
  checkBattle(h.b);
});
