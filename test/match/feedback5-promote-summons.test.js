// Promote in place (升华 / 博士投影: PlayerState.promote) of a 自选 summoner standing on the board tops its summon stacks up
// to the ELITE's deploy limit, like an elite merged onto a tile (_mergeChess → grantTokensFor). 0.2.0 review round 17:
// 麦哲伦 with SUM-Y fields 3 drones as a normal piece and 4 as an elite; the promote used to leave the hand at 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { makeMatch, legalTileFor } from './harness.js';

const REAL = { skip: !hasGeneratedData() && 'needs the generated data (npm run build-data)' };
const T6B = 'chess_char_6_diy2_a';
const MGLLAN = 'char_248_mgllan';
const SUM_Y = 'uniequip_003_mgllan';

/** Summon copies of `uid` the player holds: placed on the board plus the stacks in the hand and 临时整备区. */
function summonsOf(ps, uid) {
  let n = 0;
  for (const p of [...ps.board.values(), ...ps.hand, ...ps.temp]) if (p && p.kind === 'token' && p.ownerUid === uid) n += p.count || 1;
  return n;
}

test('a promoted 自选 summoner on the board gets the elite\'s summon count (麦哲伦 SUM-Y: 3 → 4 drones)', REAL, () => {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T6B]: { charId: MGLLAN, skillIndex: 0, uniEquipId: SUM_Y } } }];
  const h = makeMatch({ mode: 'solo', seats, seed: 21 }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.initDiyStock(new Set());
    const piece = ps.acquireChess(T6B, { source: 'buy' });
    assert.ok(piece, 'the 自选 麦哲伦 was gained');
    const tile = legalTileFor(h.m, ps, piece.id);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] }, dir: 'RIGHT' }), { ok: true });
    const limit = (p) => ps.gd.placeableTokens(p.id, ps.loadoutFor(ps.gd.chess(p.id))).reduce((a, t) => a + t.count, 0);
    const normal = limit(piece);
    assert.equal(summonsOf(ps, piece.uid), normal, 'placing the normal piece brings its own count');
    assert.equal(ps.promote(piece), true);
    const elite = limit(piece);
    assert.ok(elite > normal, `the elite's limit (${elite}) is above the normal one (${normal})`);
    assert.equal(summonsOf(ps, piece.uid), elite, 'the promote tops the stacks up to the elite limit');
  } finally { h.m.dispose(); }
});
