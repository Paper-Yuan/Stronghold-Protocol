// test/sim/feedback5-countdown-summons.test.js — the countdown summons (community report of 2026-10-06 「赫默的无人机、浊心
// 斯卡蒂的海嗣等这种召唤物不会受到外来伤害（包括源石地板），也不会被干员治疗，血量随时间减少（血量就类似倒计时条，减少完召唤物就
// 消失）」): the summons that "不会受到攻击" and leave after a fixed time — 医疗探机, 诅咒娃娃, 斯卡蒂的海嗣 and the 自选 ones
// (工程蓄水炮, 沙地兽, “打字机”, 本能的召唤) — hold 无敌 + 禁疗 (PRTS 海嗣 / 沙地兽 「持有禁疗、无敌」, 工程蓄水炮 禁疗; the others
// [ASSUMED] from the report) and their bar (the snapshot's hp) shows the share of their life left (content/tokens.js
// COUNTDOWN_SUMMONS / startCountdown). Until 0.2.0 a 海嗣 on 活性源石 lost 70 of its 100 HP every second and a hurt drone
// drew the medics' heals. The 吟游者 trait (item 32) cannot refill such a bar either: their HP never moves.
// Run: node --test test/sim/feedback5-countdown-summons.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { unitTuple } from '../../server/sim/snapshot.js';
import { COUNTDOWN_SUMMONS } from '../../server/sim/content/tokens.js';

/** [label, owner entry (uid 1), token id, life in s] — every placed countdown summon of the pool and of the 自选 pool. */
const CASES = [
  ['赫默 医疗探机', { chessId: 'chess_char_2_02_a' }, 'token_10000_silent_healrb', 10],
  ['巫恋 诅咒娃娃', { chessId: 'chess_char_3_15_a' }, 'token_10006_vodfox_doll', null],
  ['浊心斯卡蒂 海嗣', { chessId: 'chess_char_6_04_a' }, 'token_10017_skadi2_dedant', 25],
  ['温蒂 工程蓄水炮', { diy: { slot: 5, charId: 'char_400_weedy', skillIndex: 0, uniEquipId: null } }, 'token_10009_weedy_cannon', 20],
  ['莱伊 沙地兽', { diy: { slot: 5, charId: 'char_4117_ray', skillIndex: 0, uniEquipId: null } }, 'token_10034_ray_sndbst', 25],
  ['鸿雪 打字机', { diy: { slot: 5, charId: 'char_4055_bgsnow', skillIndex: 0, uniEquipId: null } }, 'token_10026_bgsnow_subbow', 25],
];

function field(owner, tokenId) {
  const h = makeBattle({
    units: [{ uid: 1, row: 10, col: 3, ...owner }, { uid: 2, kind: 'token', tokenId, ownerUid: 1, row: 10, col: 4 }],
    autoFinish: false, timeLimit: 120, seed: 3, flags: { dpInit: 60, dpMax: 99 },
  });
  h.step();
  return { h, t: h.b.allyUnits.find((u) => u.kind === 'token' && u.defId === tokenId) };
}
const bar = (h, t) => unitTuple(t, h.b.time)[3] / unitTuple(t, h.b.time)[4];

for (const [label, owner, tokenId, lifeWant] of CASES) {
  test(`${label}: 无敌 + 禁疗, no outside damage (活性源石 tick), no heal, a bar that runs down with its life`, () => {
    assert.ok(COUNTDOWN_SUMMONS.has(tokenId));
    const { h, t } = field(owner, tokenId);
    assert.ok(t && t.alive, 'deployed from its piece');
    assert.ok(t.countdown, 'its life is counting down');
    const life = t.countdown.until - t.countdown.from;
    if (lifeWant != null) assert.ok(Math.abs(life - lifeWant) < 1e-6, `life ${life} s`);
    const f = t.s.flags;
    assert.ok(f.invulnerable && f.noHeal && f.healFree, '无敌 + 禁疗');
    // a 活性源石 tick (true, 无来源, 环境) and an enemy-style hit change nothing
    const hp0 = t.hp;
    h.b.dealDamage(null, t, { amount: 70, type: 'true', canDodge: false, tags: ['terrain'] });
    h.b.dealDamage(null, t, { amount: t.s.maxHp * 3, type: 'phys' });
    assert.equal(t.hp, hp0, 'no damage reaches it');
    assert.equal(h.b.heal(h.unit(1), t, 500), 0, 'no heal reaches it');
    // the bar: full at the start, ~3/4 then ~1/4 of the way through, gone at the end
    const from = t.countdown.from;
    h.run(from + life * 0.25 - h.b.time);
    assert.ok(Math.abs(bar(h, t) - 0.75) < 0.05, `a quarter in: ${bar(h, t).toFixed(3)}`);
    h.run(life * 0.5);
    assert.ok(Math.abs(bar(h, t) - 0.25) < 0.05, `three quarters in: ${bar(h, t).toFixed(3)}`);
    assert.equal(t.hp, t.s.maxHp, 'its HP itself never moves');
    h.run(life * 0.25 + 0.2);
    assert.ok(!t.alive, 'it leaves when the bar is empty');
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  });
}

test('a summon that is attacked keeps its HP as HP: 伺夜\'s 狼群 takes damage, is no countdown summon', () => {
  const { h, t } = field({ chessId: 'chess_char_3_19_a' }, 'token_10028_vigil_wolf');
  assert.ok(!COUNTDOWN_SUMMONS.has(t.defId) && t.countdown == null && !t.s.flags.invulnerable);
  h.b.dealDamage(null, t, { amount: 100, type: 'true', canDodge: false, tags: ['terrain'] });
  assert.ok(t.hp < t.s.maxHp);
  assert.equal(unitTuple(t, h.b.time)[3], Math.ceil(t.hp), 'its bar is its HP');
});
