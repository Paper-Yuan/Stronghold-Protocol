// test/content/feedback5-we2-garrison90.test.js — 0.2.0 WE2 #30: 塑心's 特质 garrison_90 (bond_actived_maxstack) "<战斗中>
// 开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+1（每场作战至多10层）" (elite +2, at most 20): the per-battle cap is
// the trait's own, whichever bond is the highest at each gain — a change of the highest bond grants no fresh cap
// (server/sim/content/garrisons/battle.js fireGain; PR #178 review).
// Run: node --test test/content/feedback5-we2-garrison90.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const B = (layers = 0) => ({ count: 3, active: true, tier: 1, layers });

/** 塑心's trait on 'op' with one row mate (2 in the row: +2 per skill, elite +4). */
function field(gid, bonds) {
  const chess = { op: { ...chessRec({ id: 'op' }), garrisonIds: [gid] }, m1: { ...chessRec({ id: 'm1' }), garrisonIds: [] } };
  const h = makeBattle({
    seed: 3, bonds, defs: { chess, enemies: {} }, autoFinish: false, timeLimit: 400,
    units: [{ chessId: 'op', row: 10, col: 4 }, { chessId: 'm1', row: 10, col: 6 }],
  });
  h.step(1);
  return h;
}
const skill = (h) => h.b.emit('skillStart', { unit: h.unit('op'), skill: h.unit('op').skill, reason: 'test' });
const gains = (h) => ({ ...h.result().perPlayer.p1.layerGains });

test('#30 塑心 garrison_90: at most 10 (elite 20) layers per battle in all, even when the highest bond changes', () => {
  for (const [gid, per, cap] of [['garrison_90_a', 2, 10], ['garrison_90_b', 4, 20]]) {
    const h = field(gid, { yanShip: B(20), steadShip: B(15) });
    const n1 = Math.floor(cap / per / 2);          // half the cap on 炎 (the highest)
    for (let i = 0; i < n1; i++) skill(h);
    assert.deepEqual(gains(h), { yanShip: n1 * per }, `${gid}: 炎 is the highest`);
    // 坚守 becomes the highest (an outside gain of 30), then many more casts
    assert.equal(h.b.addLayers('p1', 'steadShip', 30, 'test'), 30);
    for (let i = 0; i < 20; i++) skill(h);
    const g = gains(h);
    assert.equal(g.yanShip, n1 * per, `${gid}: 炎 kept its gain`);
    assert.equal(g.steadShip - 30, cap - n1 * per, `${gid}: 坚守 got only what was left of the one cap`);
    checkInvariants(h.b);
  }
});
