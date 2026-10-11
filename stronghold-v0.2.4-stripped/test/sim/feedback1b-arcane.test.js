// Player report after the public 0.1.0 release (relayed, untested by the user): "奥术盟约不生效". Measured on the real
// product path — a 险境 match's own normal battle (Match._normalOpts: the player's board, bonds, loadouts, the round's
// wave) and the same battle built from its BattleSpec as the browser does (spec.js createBattleFromSpec) — the bond
// works: every member's arts damage puts the 奥术 debuff on its target (×(1.2 + 0.01·L) arts damage taken for 3 s, one
// instance per target, DESIGN §5.3 / §20.10), later arts hits land multiplied, the 3-member tier raises it ×1.4 on
// targets below 50 % HP, and the browser battle is identical. (What a player could see instead — 标准 never activates
// 奥术 — is test/ui/feedback1b-bonds.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor } from '../match/harness.js';
import { tileKey } from '../../server/match/board.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { bondBb } from '../../server/sim/content/bonds/addon/battle.js';

const BB = bondBb('arcaneShip');
const MEMBERS = ['chess_char_1_17_a', 'chess_char_2_10_a', 'chess_char_3_09_a']; // 深靛, 洛洛, 海霓

function setup(ids, seed = 7, round = 5) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed }).start();
  h.toPrep(1);
  h.ps('p_0').lp = 9999;
  h.toPrep(round);
  const m = h.m, ps = h.ps('p_0');
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  const used = new Set();
  for (const id of ids) { const t = legalTileFor(m, ps, id, used); used.add(tileKey(t[0], t[1])); give(m, ps, id, 'board', t); }
  ps.recompute();
  return { m, ps };
}

/** Run a battle; per arts hit of an operator: the 奥术 multiplier on the target when it landed (0 = none). */
function run(b, pid) {
  const hits = [];
  b.on('hit', (c) => {
    if (!c.dmg || c.dmg.type !== 'arts' || !c.source || c.source.kind !== 'op') return;
    const x = c.target.buffs.find((y) => y.key === 'bond:arcaneShip');
    c.dmg.arcane = x ? x.data.value : 0;
    c.dmg.taken = c.target.s.artsTakenMul;
  });
  b.on('damaged', (c) => { if (c.type === 'arts' && c.source && c.source.kind === 'op') hits.push({ mul: c.dmg.arcane, taken: c.dmg.taken, amount: c.amount }); });
  for (let n = 0; !b.finished && n < 30 * 400; n++) b.step();
  const pp = b.result().perPlayer[pid];
  return { hits, killed: pp.killed, dealt: Math.round(pp.damageDealt) };
}

test('奥术 on a real 险境 battle: two members debuff their targets and later arts hits land ×(1.2 + 0.01·L); the browser battle is identical', () => {
  const { m, ps } = setup(MEMBERS.slice(0, 2));
  assert.deepEqual(ps.bonds.arcaneShip, { count: 2, active: true, tier: 1, layers: 0 });
  for (const L of [0, 50]) {
    const opts = m._normalOpts(ps);
    opts.players[0].bonds.arcaneShip.layers = L;
    const srv = run(m.newBattle(opts), ps.playerId);
    const want = BB.base_damage_scale + BB.damage_scale_per_stack * L;
    const boosted = srv.hits.filter((x) => x.mul > 0);
    assert.ok(srv.hits.length >= 30 && boosted.length >= srv.hits.length * 0.6, `L${L}: ${boosted.length}/${srv.hits.length} arts hits on a debuffed target`);
    for (const x of boosted) {
      assert.ok(Math.abs(x.mul - want) < 1e-9, `L${L}: debuff ×${x.mul}, want ×${want}`);
      assert.ok(x.taken >= want - 1e-9, `L${L}: the target took arts ×${x.taken}`);
    }
    // the browser path: the same spec, the same battle
    const spec = buildBattleSpec({ ...opts, stageId: m.stageId, battleId: 't', boss: null });
    const cli = run(createBattleFromSpec(spec, m.ds), ps.playerId);
    assert.deepEqual([cli.killed, cli.dealt, cli.hits.length], [srv.killed, srv.dealt, srv.hits.length], `L${L}: browser = server`);
    // without the bond the same battle has no debuffed hit
    const offOpts = m._normalOpts(ps);
    offOpts.players[0].bonds.arcaneShip = { ...offOpts.players[0].bonds.arcaneShip, active: false, tier: 0 };
    assert.equal(run(m.newBattle(offOpts), ps.playerId).hits.filter((x) => x.mul > 0).length, 0);
  }
  m.dispose();
});

test('奥术 with 3 different members: targets below 50 % HP take ×1.4·(1.2 + 0.01·L) (+68 % at 0 layers); 海霓 adds layers live', () => {
  const { m, ps } = setup(MEMBERS);
  assert.equal(ps.bonds.arcaneShip.tier, 2);
  const res = run(m.newBattle(m._normalOpts(ps)), ps.playerId);
  const base = (L) => BB.base_damage_scale + BB.damage_scale_per_stack * L;
  const seen = res.hits.filter((x) => x.mul > 0).map((x) => x.mul);
  // L = 0 at the start; 海霓 "<战斗中>首次击倒敌人…【奥术】层数+3" raises it during the fight (bonds/addon live layers)
  const match = (v) => [0, 3].flatMap((L) => [['base', L, base(L)], ['low', L, BB.power_weak_scale * base(L)]]).find(([, , w]) => Math.abs(v - w) < 1e-9);
  for (const v of seen) assert.ok(match(v), `unexpected multiplier ×${v}`);
  const kinds = new Set(seen.map((v) => match(v).slice(0, 2).join(':')));
  for (const k of ['base:0', 'low:0', 'base:3', 'low:3']) assert.ok(kinds.has(k), `${k} seen (${[...kinds]})`);
  assert.ok(Math.abs(BB.power_weak_scale * base(0) - 1 - BB.base_damage_scale_show_ex) < 1e-9, 'the shown +68 %');
  m.dispose();
});
