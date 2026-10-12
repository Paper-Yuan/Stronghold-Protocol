// test/sim/feedback5-gravel-double-hit.test.js — community report of 2026-10-06 (item 16.5) 「砾的平A是比较特殊的双判，是两次50%
// 伤害倍率（不是攻击倍率），对频次怪的效率应该比正常干员高，但是现在游戏内还是单次判定」: PRTS 砾 特性备注 "在砾的攻击动作下，每次普通攻击造成
// 两段伤害，但是每段最终只会造成50%的伤害（在计算防御/减伤后，在重设伤害前）；第二段伤害不会触发目标的受击回复". Up to 0.2.0 every attack was
// one instance. Now two instances of 50 % 伤害倍率 (DamageInfo `mul`, after DEF — the profile's `hitDmgMul`, ai.js resolveHit).
// Run: node --test test/sim/feedback5-gravel-double-hit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hitCount } from '../../server/sim/content/enemies/helpers.js';
import { MIN_DAMAGE_RATIO } from '../../server/sim/constants.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6, `${msg}: ${a} vs ${b}`);

/** 砾 on (10,4) facing right, one parked enemy on (10,5); returns her attacks and her damage instances on it. */
function fight(id, enemy, seconds = 5) {
  const h = makeBattle({
    seed: 2, autoFinish: false, timeLimit: 60, captureNoisy: true, hooks: ['damaged', 'attack'],
    defs: { enemies: { enemy_g: enemyRec({ key: 'enemy_g', hp: 1e9, speed: 0, mass: 0, ...enemy }) } },
    units: [{ chessId: id, row: 10, col: 4 }],
  });
  h.step();
  const e = h.spawn('enemy_g', { pos: [10, 5] });
  return { h, e, run: () => h.run(seconds) };
}

test('砾 (normal, elite): every normal attack is two damage instances of 50 % 伤害倍率 after DEF — the same total, not 50 % 攻击倍率', () => {
  for (const id of ['chess_char_2_12_a', 'chess_char_2_12_b']) {
    for (const def of [0, 300, 5000]) {
      const { h, run } = fight(id, { def });
      run();
      const u = h.unit(id);
      const attacks = h.hooksOf('attack').filter((c) => c.attacker === u).length;
      const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
      assert.ok(attacks >= 3, `${id}: she attacks (${attacks})`);
      assert.equal(hits.length, 2 * attacks, `${id} DEF ${def}: two instances per attack`);
      const atk = u.s.atk;
      const full = Math.max(atk - def, MIN_DAMAGE_RATIO * atk);     // one instance of the whole attack, after DEF
      for (const c of hits) near(c.amount, 0.5 * full, `${id} DEF ${def}: each instance is 50 % of the mitigated hit`);
      // first instance of each attack may give 受击回复, the second may not
      const byAttack = new Map();
      for (const c of hits) { const l = byAttack.get(c.dmg.attackId) ?? []; l.push(c); byAttack.set(c.dmg.attackId, l); }
      for (const l of byAttack.values()) assert.deepEqual(l.map((c) => !!c.dmg.noSp), [false, true], `${id}: the second instance carries no 受击回复`);
      checkInvariants(h.b);
    }
  }
});

test('砾 against a 频次 enemy: two counted hits per attack (one before 0.2.0)', () => {
  for (const id of ['chess_char_2_12_a', 'chess_char_2_12_b']) {
    const { h, e, run } = fight(id, { hp: 100 });
    hitCount(h.b, e, true);
    run();
    const u = h.unit(id);
    const attacks = h.hooksOf('attack').filter((c) => c.attacker === u).length;
    assert.ok(attacks >= 3, `${id}: she attacks`);
    assert.equal(100 - e.hp, 2 * attacks, `${id}: 2 per attack`);
    checkInvariants(h.b);
  }
});
