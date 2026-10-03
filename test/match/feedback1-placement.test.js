// Player reports after the 0.1.0 release, placement legality on the server (PlayerState / board.js), the client's
// mirror (ui/gameLogic.js canPlace / boardTargets = the drag highlights) and the bots:
//   #3 "有水池的那张图干员可以错误的被部署到水里" — 战场#08(下半) 涨潮控制 (act2autochess_m04): the 深水区 (tile_deepsea,
//      board (10–12, 6)) refuses deployment (PRTS 深水区 地形信息 "地形机制：拒绝部署（待补充）"; 特制水上平台
//      "在水上建立可以部署任意单位的平台" on every 深水区 of the season-1 战场#05) although the level's buildableType
//      says ALL.
//   #9 "干员伺夜这样的战术家的战术点能被错误的被放到攻击范围之外" — the tacticians' summons (伺夜's 狼群, 缪尔赛思's 流形)
//      read "只能部署在召唤者攻击范围内" (token description; PRTS 狼群 特性): the piece may only stand on a tile of its
//      owner's attack range (the rotated grid of its board tile and facing). Re-orienting the owner in place keeps the
//      piece while it is still inside, else sends it back to its stack [ASSUMED] (refused, HAND_FULL, when it would have
//      nowhere to go); moving the owner sends it back anyway (PRTS 卫戍协议/帮助 "移动干员时，其所属召唤物全部退场并重置
//      至手牌区") — with no room it leaves the board until the next round start.
// The sim side (突袭 landing tile, tactical point) is test/sim/feedback1-water.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeployMap, canPlace as boardCanPlace, legalTiles, positionClass, tileKey, ownerRangeKeys } from '../../server/match/board.js';
import { ERR } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';
import { botPrep, planLayout } from '../../server/match/bot.js';
import { placementContext, canPlace as clientCanPlace, boardTargets, deployMap as clientDeployMap } from '../../public/js/ui/gameLogic.js';

const STAGE = 'act2autochess_m04';
const WATER = ['10,6', '11,6', '12,6'];
const VIGIL = 'chess_char_3_19_a';
const MLYSS = 'chess_char_6_11_a';
const WOLF = 'token_10028_vigil_wolf';
const MANIFOLD = 'token_10030_mlyss_wtrman';
const MELEE = (c) => c.position === 'MELEE';
const RANGED = (c) => c.position === 'RANGED';

function prep(stageId = STAGE, seed = 11) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}
const move = (m, uid, to, dir) => m.handle('p_0', { t: 'g.move', uid, to, ...(dir ? { dir } : {}) });
const board = (r, c) => ({ area: 'board', row: r, col: c });
const stackOf = (ps, id) => [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'token' && p.id === id) ?? null;
const clientCtx = (m, ps, field = 'normal') => placementContext({
  priv: ps.privateView(), stage: m.stage, editable: true, field,
  getChess: (id) => DATA.chess[id] ?? null, getToken: (id) => DATA.tokens[id] ?? null, getItem: (id) => DATA.items[id] ?? null,
});

// ---------------------------------------------------------------------------------------------------------------------
// #3 the pool

test('#3 board.js: no deploy class on 战场#08\'s 深水区 — normal field, both boss halves; the client\'s map agrees', () => {
  const st = DATA.stages[STAGE];
  const n = buildDeployMap(st);
  for (const k of WATER) assert.equal(n.get(k), undefined, `normal ${k}`);
  assert.equal(n.get('11,5'), 'melee', 'the road beside it stays deployable');
  for (const field of ['bossL', 'bossR']) {
    const b = buildDeployMap(st, { field });
    // boss (3–5, 6) = board (10–12, 6); the right half is mirrored (col 14 → board col 6)
    for (const k of WATER) assert.equal(b.get(k), undefined, `${field} ${k}`);
    assert.deepEqual([...clientDeployMap(st, { field })].sort(), [...b].sort(), `${field}: client = server`);
  }
  assert.deepEqual([...clientDeployMap(st)].sort(), [...n].sort(), 'normal: client = server');
});

test('#3 g.move: neither a melee nor a ranged operator nor a summon goes into the water (BAD_TILE); the client refuses and never lights it', () => {
  const { m, ps } = prep();
  const melee = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)));
  const ranged = give(m, ps, chessOfTier(1, RANGED).find((x) => m.pool.has(x)));
  for (const k of WATER) {
    const [r, c] = k.split(',').map(Number);
    assert.equal(move(m, melee.uid, board(r, c)).error, ERR.BAD_TILE, `melee ${k}`);
    assert.equal(move(m, ranged.uid, board(r, c)).error, ERR.BAD_TILE, `ranged ${k}`);
  }
  // 伺夜 (ranged) beside the pool facing it: her 狼群 (MELEE) may not go into the water either
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(11, 4)), { ok: true });
  const wolf = stackOf(ps, WOLF);
  assert.ok(wolf);
  assert.equal(move(m, wolf.uid, board(11, 6)).error, ERR.BAD_TILE, '狼群 into the water');
  const ctx = clientCtx(m, ps);
  for (const piece of [melee, ranged, wolf]) {
    for (const k of WATER) {
      const [r, c] = k.split(',').map(Number);
      assert.equal(clientCanPlace(ctx, piece.uid, board(r, c)).ok, false, `client ${piece.id} ${k}`);
    }
    const lit = boardTargets(ctx, piece.uid).legal.map(([r, c]) => tileKey(r, c));
    for (const k of WATER) assert.ok(!lit.includes(k), `${piece.id}: ${k} not lit`);
  }
  checkInvariants(m);
  m.dispose();
});

test('#3 act1 m05 (season 1, inactive): a 特制水上平台 makes its 深水区 deployable for any unit; the raw level files agree', () => {
  const st = DATA.stages.act1autochess_m05;
  const map = buildDeployMap(st);
  const platforms = st.devices.filter((d) => d.role === 'waterPlatform' && d.active).map((d) => tileKey(d.pos[0], d.pos[1]));
  for (const k of platforms) {
    const [r, c] = k.split(',').map(Number);
    if (r < 9 || r > 12 || c < 2 || c > 10) continue;
    assert.equal(map.get(k), 'melee', `platform ${k}`);
  }
  assert.deepEqual([...clientDeployMap(st)].sort(), [...map].sort());
});

test('#3 bots never put a piece into the water (layout planner and full bot preps on 战场#08)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed: 5 }).start();
  h.setStage(STAGE);
  let pieces = 0;
  for (let round = 1; round <= 5; round++) {
    h.toPrep(round);
    for (const ps of h.m.players.values()) {
      if (!ps.isBot || !ps.alive) continue;
      if (!ps.ready) botPrep(h.m, ps);
      for (const k of ps.board.keys()) { pieces++; assert.ok(!WATER.includes(k), `R${round} ${ps.playerId}: a piece on ${k}`); }
      const plan = planLayout(h.m, ps, ps.allChess());
      for (const k of plan.values()) assert.ok(!WATER.includes(k), `plan on ${k}`);
    }
  }
  assert.ok(pieces > 10, 'the bots fielded pieces');
  h.invariants();
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// #9 tactical points

test('#9 data: 狼群 and 流形 are owner-range summons (token text "只能部署在召唤者攻击范围内"), no other hand summon is', () => {
  assert.equal(DATA.tokens[WOLF].ownerRange, true);
  assert.equal(DATA.tokens[MANIFOLD].ownerRange, true);
  for (const t of Object.values(DATA.tokens)) if (t.placeable && t.tokenId !== WOLF && t.tokenId !== MANIFOLD) assert.ok(!t.ownerRange, t.name);
});

test('#9 g.move: 伺夜\'s 狼群 only on a tile of her attack range (rotated grid of her tile + facing); outside → BAD_TILE', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  const wolf = stackOf(ps, WOLF);
  const range = ownerRangeKeys(DATA.chess[VIGIL].rangeGrid, 10, 4, 'RIGHT');
  assert.ok(range.has('11,5') && range.has('9,7') && !range.has('10,3') && !range.has('12,4'));
  // behind her / two rows down: outside the 3-row, 4-column range
  for (const [r, c] of [[10, 3], [12, 4], [12, 5], [9, 8]]) assert.equal(move(m, wolf.uid, board(r, c)).error, ERR.BAD_TILE, `outside ${r},${c}`);
  assert.ok(stackOf(ps, WOLF), 'still in the hand');
  assert.deepEqual(move(m, wolf.uid, board(11, 5)), { ok: true }, 'inside the range');
  const placed = ps.board.get('11,5');
  assert.equal(placed.id, WOLF);
  // board → board: a move out of the range is refused too, one inside it is fine
  assert.equal(move(m, placed.uid, board(12, 4)).error, ERR.BAD_TILE);
  assert.deepEqual(move(m, placed.uid, board(9, 6)), { ok: true });
  assert.equal(ps.board.get('9,6'), placed);
  checkInvariants(m);
  m.dispose();
});

test('#9 re-orienting the tactician: a summon still inside the new range stays, one left outside goes back to its stack', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(11, 5)), { ok: true });
  const wolf = ps.board.get('11,5');
  // facing UP the range is rows 10–13 × cols 3–5: (11,5) is still inside
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'UP'), { ok: true });
  assert.equal(ps.board.get('10,4').dir, 'UP');
  assert.equal(ps.board.get('11,5'), wolf, 'still in range: stays');
  // facing LEFT the range is cols 1–4: (11,5) falls outside → back onto its stack in the hand
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'LEFT'), { ok: true });
  assert.equal(ps.board.get('11,5'), undefined, 'outside the new range: lifted');
  const stack = stackOf(ps, WOLF);
  assert.ok(stack && stack.count === 1, 'back in the hand');
  assert.equal(ps.battleInput().units.filter((u) => u.kind === 'token').length, 0);
  checkInvariants(m);
  m.dispose();
});

test('#9 hand and temp full: a re-orientation that would push 狼群 out is refused (HAND_FULL); a move drops it until the next round', () => {
  const { h, m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(11, 5)), { ok: true });
  const wolf = ps.board.get('11,5');
  assert.equal(stackOf(ps, WOLF), null, 'its only copy is placed: no stack left to return onto');
  const toasts = [];
  const toast = m.toast.bind(m);
  m.toast = (p, kind, text) => { toasts.push(text); return toast(p, kind, text); };
  const golden = Object.keys(DATA.items).find((id) => DATA.items[id].isGolden && DATA.items[id].itemType === 'EQUIP');
  while (ps.hand.includes(null)) giveItem(m, ps, golden);
  while (ps.temp.includes(null)) giveItem(m, ps, golden, 'temp');
  // facing LEFT would leave (11,5) outside her range and the wolf has nowhere to go: refused, nothing changes
  assert.equal(move(m, vigil.uid, board(10, 4), 'LEFT').error, ERR.HAND_FULL);
  assert.equal(ps.board.get('10,4').dir, 'RIGHT');
  assert.equal(ps.board.get('11,5'), wolf);
  // facing UP keeps it inside: allowed
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'UP'), { ok: true });
  assert.equal(ps.board.get('11,5'), wolf);
  checkInvariants(m);
  // moving her (her summons go back to the hand; with no room a normal summon stays put) to (9,9) facing RIGHT, whose
  // range (rows 8–10, cols 9–12) leaves the wolf out: it leaves the board — no illegal placement reaches the battle
  assert.deepEqual(move(m, vigil.uid, board(9, 9), 'RIGHT'), { ok: true });
  assert.equal(ps.board.get('11,5'), undefined, 'outside her range with nowhere to go: removed');
  assert.ok(toasts.some((t) => t.includes('狼群') && t.includes('下回合返还')), toasts.join(' / '));
  assert.equal(ps.battleInput().units.filter((u) => u.kind === 'token').length, 0);
  checkInvariants(m);
  // …and its stack comes back at the next round start (grantTokensFor, "干员所属召唤物会于下一回合返还")
  h.toPrep(2);
  assert.ok(stackOf(ps, WOLF), 'the wolf is back in the hand / temp');
  checkInvariants(m);
  m.dispose();
});

test('#9 swaps: a summon dragged onto its tactician, or an operator onto the summon, must leave the summon inside the range', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(10, 5)), { ok: true });
  const wolf = ps.board.get('10,5');
  // wolf onto 伺夜: she would stand on (10,5) facing RIGHT and the wolf behind her on (10,4) — outside → refused
  assert.equal(move(m, wolf.uid, board(10, 4)).error, ERR.BAD_TILE);
  assert.equal(ps.board.get('10,5'), wolf);
  assert.equal(ps.board.get('10,4'), vigil);
  // the wolf on (11,4), right above her: after the swap it is right below her (offset −1, 0) — inside → allowed
  assert.deepEqual(move(m, wolf.uid, board(11, 4)), { ok: true });
  assert.deepEqual(move(m, wolf.uid, board(10, 4)), { ok: true }, 'swap with the owner, still in range');
  assert.equal(ps.board.get('10,4'), wolf);
  assert.equal(ps.board.get('11,4'), vigil);
  // another operator dragged onto the wolf would send the wolf to that operator's tile: outside → refused
  const other = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)));
  assert.deepEqual(move(m, other.uid, board(12, 3)), { ok: true });
  assert.equal(move(m, other.uid, board(10, 4)).error, ERR.BAD_TILE, '(12,3) is outside 伺夜\'s range (she stands on (11,4) now)');
  assert.deepEqual(move(m, other.uid, board(12, 5)), { ok: true });
  assert.deepEqual(move(m, other.uid, board(10, 4)), { ok: true }, '(12,5) is inside: the wolf moves there');
  assert.equal(ps.board.get('12,5'), wolf);
  checkInvariants(m);
  m.dispose();
});

test('#9 the client mirrors it: the drag highlights of 狼群 / 流形 are exactly the free legal tiles of the owner\'s range', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  const mly = give(m, ps, MLYSS);
  assert.deepEqual(move(m, mly.uid, board(12, 8), 'LEFT'), { ok: true });
  const map = buildDeployMap(m.stage);
  for (const [owner, tid, dir, at] of [[vigil, WOLF, 'RIGHT', [10, 4]], [mly, MANIFOLD, 'LEFT', [12, 8]]]) {
    const ctx = clientCtx(m, ps);
    const tok = stackOf(ps, tid);
    assert.ok(tok, tid);
    const range = ownerRangeKeys(DATA.chess[owner.id].rangeGrid, at[0], at[1], dir);
    const pos = positionClass(DATA.tokens[tid]);
    const want = legalTiles(map, pos).map(([r, c]) => tileKey(r, c)).filter((k) => range.has(k) && !ps.board.has(k)).sort();
    const lit = boardTargets(ctx, tok.uid).legal.map(([r, c]) => tileKey(r, c)).sort();
    assert.deepEqual(lit, want, `${tid} highlights`);
    assert.ok(want.length > 0);
    // every lit tile is accepted by the server, every other deployable tile refused
    for (const k of map.keys()) {
      const [r, c] = k.split(',').map(Number);
      if (ps.board.has(k)) continue;
      assert.equal(clientCanPlace(ctx, tok.uid, board(r, c)).ok, lit.includes(k), `client ${tid} ${k}`);
      assert.equal(boardCanPlace(map, pos, r, c) && range.has(k), lit.includes(k));
    }
  }
  // the client's swap rule: 狼群 onto 伺夜 from (10,5) would end behind her → refused
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(10, 5)), { ok: true });
  const ctx = clientCtx(m, ps);
  assert.equal(clientCanPlace(ctx, ps.board.get('10,5').uid, board(10, 4)).ok, false);
  checkInvariants(m);
  m.dispose();
});

test('#9 bots place 狼群 / 流形 only inside their owner\'s range', () => {
  let placed = 0;
  for (const seed of [3, 8, 21]) {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed }).start();
    h.toPrep(2);
    h.setStage(STAGE);
    const bp = h.ps('ai_0');
    for (const p of [...bp.board.values(), ...bp.hand.filter(Boolean)]) if (p.kind === 'chess') bp.returnCopies(p);
    bp.board.clear();
    bp.hand.fill(null);
    bp.recompute();
    give(h.m, bp, 'chess_char_1_10_a'); // 古米: a blocker
    give(h.m, bp, VIGIL);
    give(h.m, bp, MLYSS);
    bp.ready = false;
    botPrep(h.m, bp);
    for (const [k, p] of bp.board) {
      if (p.kind !== 'token') continue;
      const owner = [...bp.board.entries()].find(([, q]) => q.uid === p.ownerUid);
      assert.ok(owner, 'its owner is on the board');
      const [or, oc] = owner[0].split(',').map(Number);
      const range = ownerRangeKeys(DATA.chess[owner[1].id].rangeGrid, or, oc, owner[1].dir || 'RIGHT');
      assert.ok(range.has(k), `seed ${seed}: ${p.id} on ${k} inside ${owner[1].id}'s range`);
      placed++;
    }
    checkInvariants(h.m);
    h.m.dispose();
  }
  assert.ok(placed > 0, 'the bots placed some summons');
});
