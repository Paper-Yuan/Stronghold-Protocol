// Player report after the public 0.1.0 release (relayed, untested by the user): "源石溶剂两个白的合成一个金色的之后又多给一个白的"
// — after two white 源石溶剂 (chess_item_1_05_e_a) merged into the golden one (_b), an extra white appeared.
// Official rule (PRTS 卫戍协议/帮助 §装备; activity_table act2autochess trapChessDataDict upgradeNum 2 → _b): "已拥有2件同一初始
// 装备时，该装备将自动合并为1件进阶品质的同名装备，发送至手牌区"; equipment is removed "在失去该干员（干员出售、销毁、合并等）或
// 装备合并为进阶品质时". Every real PlayerState path that hands the player a second white is replayed here and must end
// with exactly one golden and no white (none duplicates — the report did not reproduce); random intents conserve the
// white-equivalents W + 2·G. The one gap found: equipment a promotion (or an effect that removes an operator) returns
// to the hand skipped the auto-merge — unreachable from a normal state (a pair never exists), closed anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, giveItem, legalTileFor, checkInvariants } from './harness.js';
import { tileKey } from '../../server/match/board.js';
import { applyCard } from '../../server/match/choices.js';
import { makeCtx } from '../../server/match/effectsMeta.js';

const WHITE = 'chess_item_1_05_e_a';
const GOLD = 'chess_item_1_05_e_b';
const OP = 'chess_char_1_17_a';

function prep(seed = 5) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed, fake: true }).start();
  h.toPrep(1);
  const m = h.m, ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.offers.length = 0;
  ps.funds = 99;
  ps.recompute();
  return { h, m, ps };
}
function count(ps) {
  const c = { white: 0, gold: 0 };
  const see = (p) => { if (p && p.kind === 'item') { if (p.id === WHITE) c.white++; if (p.id === GOLD) c.gold++; } };
  for (const p of [...ps.hand, ...ps.temp, ...ps.board.values()]) { see(p); for (const it of (p && p.items) || []) see(it); }
  return c;
}
/** Put item `id` into the shop's first item slot (after the chess slots); returns its slot index. */
function stockItem(ps, id = WHITE) {
  const i = ps.shop.layout ? ps.shop.layout.chess : ps.shop.slots.findIndex((s) => s && s.kind === 'item');
  ps.shop.slots[i] = { kind: 'item', id, basePrice: ps.gd.itemPrice(id), frozen: false, sold: false };
  return i;
}
/** Put chess `id` into shop slot 0. */
function stockChess(ps, id) {
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: ps.gd.chessPrice(id), frozen: false, sold: false };
  return 0;
}
function deploy(m, ps, ids) {
  const used = new Set();
  return ids.map((id) => { const t = legalTileFor(m, ps, id, used); used.add(tileKey(t[0], t[1])); return give(m, ps, id, 'board', t); });
}

test('源石溶剂: the data is the official pair (upgradeNum 2 → the golden _b; 40 % / 60 % ATK, −60 HP/s)', () => {
  const w = DATA.items[WHITE], g = DATA.items[GOLD];
  assert.equal(w.upgradeNum, 2);
  assert.equal(w.upgradeChessId, GOLD);
  assert.equal(w.mergeable, true);
  assert.equal(g.isGolden, true);
  assert.deepEqual([w.params.atk, g.params.atk, w.params.damage, g.params.damage], [0.4, 0.6, 60, 60]);
});

test('源石溶剂: every way to get a second white merges the pair into ONE golden and leaves no white (the player report)', () => {
  const cases = {
    'buy with a white in the hand': ({ m, ps }) => { giveItem(m, ps, WHITE); return m.handle('p_0', { t: 'g.buy', slot: stockItem(ps) }); },
    'buy twice from the shop': ({ m, ps }) => { m.handle('p_0', { t: 'g.buy', slot: stockItem(ps) }); return m.handle('p_0', { t: 'g.buy', slot: stockItem(ps) }); },
    'buy with a white equipped': ({ m, ps }) => {
      const [a] = deploy(m, ps, [OP]);
      const it = giveItem(m, ps, WHITE);
      m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: a.uid });
      return m.handle('p_0', { t: 'g.buy', slot: stockItem(ps) });
    },
    'equip the second on another operator': ({ m, ps }) => {
      const [a, b] = deploy(m, ps, [OP, 'chess_char_2_10_a']);
      const it = giveItem(m, ps, WHITE);
      m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: a.uid });
      const it2 = giveItem(m, ps, WHITE);
      return m.handle('p_0', { t: 'g.equip', itemUid: it2.uid, targetUid: b.uid });
    },
    'equip the second on the same full carrier': ({ m, ps }) => {
      const [a] = deploy(m, ps, [OP]);
      const it = giveItem(m, ps, WHITE);
      const other = giveItem(m, ps, 'chess_item_1_01_e_a');
      m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: a.uid });
      m.handle('p_0', { t: 'g.equip', itemUid: other.uid, targetUid: a.uid });
      // no twin anywhere else: acquire the second white without the auto-merge (the hand) and equip it on the full carrier
      const it2 = ps.newPiece('item', WHITE);
      ps.hand[ps.hand.findIndex((x) => x == null)] = it2;
      return m.handle('p_0', { t: 'g.equip', itemUid: it2.uid, targetUid: a.uid });
    },
    'reward offer pick': ({ m, ps }) => { giveItem(m, ps, WHITE); ps.pushItemOffer([WHITE, WHITE, WHITE]); return m.handle('p_0', { t: 'g.reward', idx: 0 }); },
    '道具补给 card': ({ m, ps }) => { giveItem(m, ps, WHITE); applyCard(m, ps, { kind: 'item', id: WHITE, family: 'supply', name: '源石溶剂' }); return { ok: true }; },
    '列装 rolling two whites': ({ m, ps }) => {
      const roll = m.rollPool;
      m.rollPool = () => ({ kind: 'item', id: WHITE });
      try { applyCard(m, ps, { kind: 'tactic', id: 'allybuff_select_1', family: 'tactic', team: true }); } finally { m.rollPool = roll; }
      return { ok: true };
    },
    '整备 then a white bought next to a white': ({ m, ps }) => {
      giveItem(m, ps, WHITE);
      applyCard(m, ps, { kind: 'tactic', id: 'allybuff_select_5', family: 'tactic' });
      return m.handle('p_0', { t: 'g.buy', slot: stockItem(ps) });
    },
    '画卷 copy of a white carrier': ({ m, ps }) => {
      const [a] = deploy(m, ps, [OP]);
      const it = giveItem(m, ps, WHITE);
      m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: a.uid });
      const art = giveItem(m, ps, 'chess_item_6_02_m');
      const [r, c] = [...ps.board.entries()].find(([, p]) => p === a)[0].split(',').map(Number);
      return m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: r, col: c, dir: 'RIGHT' });
    },
  };
  for (const [name, run] of Object.entries(cases)) {
    const s = prep();
    const res = run(s);
    assert.equal(res.ok, true, `${name}: ${JSON.stringify(res)}`);
    assert.deepEqual(count(s.ps), { white: 0, gold: 1 }, name);
    checkInvariants(s.m);
    s.m.dispose();
  }
});

test('a promotion that returns equipment merges a returned pair (latent: no normal state holds a pair)', () => {
  const { m, ps } = prep();
  const op = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.has(c.chessId) && !m.bannedChess.includes(c.chessId)
    && m.gd.mergeCount(c.chessId) === 3 && !m.gd.placeableTokens(c.chessId).length).chessId;
  const [a, b] = deploy(m, ps, [op, op]);
  // the copies' equipment built directly: a pair never exists in play — every entry path merges it at once
  a.items = [ps.newPiece('item', WHITE)];
  b.items = [ps.newPiece('item', WHITE)];
  ps.recompute();
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: stockChess(ps, op) }), { ok: true });
  assert.ok([...ps.board.values()].some((p) => p.id === DATA.chess[op].goldenId), 'the elite formed');
  assert.deepEqual(count(ps), { white: 0, gold: 1 }, '"干员晋级后已配发装备会回收至整备区" + the auto-merge');
  checkInvariants(m);
});

test('an effect that removes an operator (ctx.destroyPiece) merges a returned pair (latent: no normal state holds a pair)', () => {
  const { m, ps } = prep();
  const [a] = deploy(m, ps, [OP]);
  // built directly: the carrier's white and a white in the hand — every entry path would have merged them at once
  a.items = [ps.newPiece('item', WHITE)];
  ps.hand[ps.hand.findIndex((x) => x == null)] = ps.newPiece('item', WHITE);
  ps.recompute();
  // the path of 突变细胞 / the recruit-and-gift item / the round-start promotion item (builtinMeta, content/items/meta.js)
  const ctx = makeCtx(m, ps, { kind: 'item', key: 'item:test' }, 'onRoundStart');
  assert.equal(ctx.destroyPiece(a.uid), true);
  assert.equal(ps.find(a.uid), null, 'the operator is gone');
  assert.deepEqual(count(ps), { white: 0, gold: 1 }, '"在失去该干员…" returns the equipment, then the auto-merge');
  checkInvariants(m);
  m.dispose();
});

test('random intents around 源石溶剂 (buy, equip / replace, sell, move, destroy) conserve W + 2·G and never leave a pair', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const worth = (ps) => { const c = count(ps); return { ...c, e: c.white + 2 * c.gold }; };
  let checked = 0;
  for (let run = 0; run < 4; run++) {
    const { m, ps } = prep(run + 3);
    const ops = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.has(c.chessId) && !m.bannedChess.includes(c.chessId)).slice(0, 2).map((c) => c.chessId);
    for (let step = 0; step < 150; step++) {
      ps.funds = 50;
      const before = worth(ps);
      const loose = [...ps.hand, ...ps.temp].filter(Boolean);
      const chess = [...loose, ...ps.board.values()].filter((p) => p.kind === 'chess');
      const items = loose.filter((p) => p.kind === 'item');
      const r = rnd();
      let msg = null, expect = 0, rep = null;
      if (r < 0.35) { msg = { t: 'g.buy', slot: stockItem(ps) }; expect = 1; }
      else if (r < 0.5) msg = { t: 'g.buy', slot: stockChess(ps, pick(ops)) };
      else if (r < 0.8 && items.length && chess.length) {
        const it = pick(items), tg = pick(chess);
        rep = (tg.items || []).length >= 2 ? pick(tg.items) : null;
        msg = { t: 'g.equip', itemUid: it.uid, targetUid: tg.uid, ...(rep ? { replaceUid: rep.uid } : {}) };
      }
      else if (r < 0.9 && chess.length) msg = { t: 'g.sell', uid: pick(chess).uid };
      else if (items.length) { const it = pick(items); msg = { t: 'g.destroy', uid: it.uid }; expect = it.id === WHITE ? -1 : it.id === GOLD ? -2 : 0; }
      if (!msg) continue;
      const res = m.handle('p_0', msg);
      if (!res.ok) continue;
      // a replacement destroys the replaced item unless the equip merged instead (the replaced one is still owned)
      if (rep && !ps.find(rep.uid)) expect = rep.id === WHITE ? -1 : rep.id === GOLD ? -2 : 0;
      const after = worth(ps);
      assert.equal(after.e - before.e, expect, `run ${run} step ${step} ${JSON.stringify(msg)}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      assert.ok(after.white <= 1, `run ${run} step ${step}: an unmerged pair`);
      checked++;
    }
    checkInvariants(m);
    m.dispose();
  }
  assert.ok(checked > 150, `${checked} accepted intents`);
});
