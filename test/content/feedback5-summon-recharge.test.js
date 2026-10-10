// test/content/feedback5-summon-recharge.test.js — one reading of the summoners' charge_token[born] (follow-up 20): the client's
// RechargeToken on the owner's birth runs with timing NORMAL — the summon is ready at once —, while the summon's own
// charge_token[finish] (ON_FINISH) is the timer that runs from its deployment (PRTS 傀影 备注 "部署召唤物后立刻开始计算再部署时间").
// 傀影's 镜中虚影 (op-phatom.js) now reads it as 凯尔希's Mon3tr (op-kalts.js) and the other summoner kits do: when the owner
// is deployed again, a summon still waiting for its own timer comes back at once (paying its cost).
// Run: node --test test/content/feedback5-summon-recharge.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

/** The owner (uid 1, a tier-5 自选 piece) and its placed summon (uid 2). */
function field(charId, tokenId) {
  const h = makeBattle({
    timeLimit: 900, autoFinish: false, seed: 5, flags: { dpInit: 99, dpPerSec: 0, dpMax: 999 },
    units: [{ uid: 1, diy: { slot: 'chess_char_5_diy1_a', charId, skillIndex: 0 }, row: 10, col: 2 }, { uid: 2, kind: 'token', tokenId, ownerUid: 1, row: 10, col: 4 }],
  });
  h.step();
  return { h, u: h.unit(1), t: h.unit(2) };
}

for (const [name, charId, tokenId] of [['傀影 / 镜中虚影', 'char_250_phatom', 'token_10007_phatom_twin'], ['凯尔希 / Mon3tr', 'char_003_kalts', 'token_10002_kalts_mon3tr']]) {
  test(`${name}: the owner's redeployment readies a waiting summon at once (charge_token[born], timing NORMAL); its own timer still holds it while the owner stands`, () => {
    const { h, u, t } = field(charId, tokenId);
    assert.ok(u.alive && t.alive, 'both deployed');
    h.run(2);
    // knocked out with the owner standing: its own timer (from its deployment) holds it
    h.b.kill(t, null);
    h.run(3);
    assert.ok(!t.alive, 'waits for its own timer');
    // the owner leaves and comes back long before that timer has run
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u, { free: true }), 'the owner back');
    const dp = h.b.players[0].dp;
    assert.ok(h.runUntil(() => t.alive, 1), 'the summon comes back at once with the owner');
    assert.ok(h.b.time < 10, `at ${h.b.time.toFixed(2)} s — its own timer (≥ 25 s) has not run`);
    assert.equal(h.b.players[0].dp, dp - t.base.cost, 'paying its cost');
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  });
}
