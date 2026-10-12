// Community report of 2026-10-06 (items 9 / 37) 「卡西米尔和艾芒加德策略似乎有BUG：像砾和瑕光这种死亡和部署的叠层效果，如果有
// 艾芒加德的3次复活似乎是无法触发…只有最后一次真的死了没站起来才叠层了」: 埃芒加德's 命结之秘 (and M3茧甲) revived in place — a
// `fatal` saver — so no 被击倒时 and no 部署时 effect fired. PRTS (卫戍协议：盟约 下半/PRTS盟约记录, 埃芒加德 and M3茧甲 备注):
// "“复活”的实现方式为：受益者因移动之外的原因退场时下次部署的再部署时间和费用归零" — the knock-out stands and the operator
// redeploys at once, free: items/battle.js reviveNow, a `death` hook.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const GRAVEL = 'chess_char_2_12_a';   // 砾: <部署时>已激活的【卡西米尔】+1, <被击倒时>已激活的【不屈】+2
const BLEMISH = 'chess_char_3_12_a';  // 瑕光: <部署时>自身已激活的盟约 +4 (每场作战至多12层)

function setup({ band = 'band_ermengard', items = {} } = {}) {
  const h = makeBattle({
    units: [{ chessId: GRAVEL, row: 9, col: 4, items: items[GRAVEL] }, { chessId: BLEMISH, row: 11, col: 4, items: items[BLEMISH] }],
    bonds: {
      kazimierzShip: { count: 3, layers: 1, active: true, tier: 1 },
      indomShip: { count: 2, layers: 1, active: true, tier: 1 },
      raidShip: { count: 2, layers: 1, active: true, tier: 1 },
    },
    bandId: band,
    enemies: [{ key: 'enemy_far', time: 0, route: 0 }],
    defs: { enemies: { enemy_far: enemyRec({ key: 'enemy_far', hp: 1e9, atk: 0, bat: 99, speed: 0.0001 }) } },
    timeLimit: 120, seed: 3,
  });
  const gains = [];
  h.b.on('layerGain', (c) => gains.push([c.source?.defId, c.bondId, c.n]), { priority: -1000 });
  h.step();
  const kill = (id) => { const u = h.unit(id); h.b.dealDamage(h.b.enemies[0], u, { amount: 1e7, type: 'true', canDodge: false }); return u; };
  const sum = (id, bond) => gains.filter(([s, b]) => s === id && b === bond).reduce((a, [, , n]) => a + n, 0);
  return { h, kill, sum, gains };
}

test('埃芒加德: each of the 3 revives is a knock-out and a deployment — 砾 gains 不屈 +2 and 卡西米尔 +1 every time', REAL, () => {
  const { h, kill, sum } = setup();
  assert.equal(sum(GRAVEL, 'kazimierzShip'), 1, 'the battle-start deployment');
  for (let i = 1; i <= 3; i++) {
    const u = kill(GRAVEL);
    assert.ok(u.alive, `revive ${i}: standing again`);
    assert.equal(sum(GRAVEL, 'indomShip'), 2 * i, `revive ${i}: <被击倒时> 不屈 +2 (the parent: 0 until the 4th)`);
    assert.equal(sum(GRAVEL, 'kazimierzShip'), 1 + i, `revive ${i}: <部署时> 卡西米尔 +1`);
    h.run(0.5);
  }
  assert.deepEqual(h.eventsOf('fx').filter((e) => e[1] === 'revive' && e[4] && e[4].left != null).map((e) => e[4].left), [2, 1, 0], 'the band\'s 3');
});

test('埃芒加德: 瑕光\'s <部署时> +4 to her own active bonds fires on a revive, up to its 12 per battle', REAL, () => {
  const { kill, sum } = setup();
  assert.equal(sum(BLEMISH, 'kazimierzShip'), 4);
  kill(BLEMISH);
  assert.equal(sum(BLEMISH, 'kazimierzShip'), 8, 'first revive');
  assert.equal(sum(BLEMISH, 'raidShip'), 8);
  kill(BLEMISH);
  assert.equal(sum(BLEMISH, 'kazimierzShip'), 12, 'second revive: the cap');
  kill(BLEMISH);
  assert.equal(sum(BLEMISH, 'kazimierzShip'), 12, 'third revive: still 12 (max_add_count_per_battle)');
});

test('埃芒加德: a revive resets the operator like a redeploy (SP back to its initial value, a new deployment)', REAL, () => {
  const { h, kill } = setup();
  const u = h.unit(BLEMISH);
  u.skill.gainSp(3, 'test');
  const seq = u.deploySeq;
  assert.ok(u.skill.sp > u.skill.initSp + 1e-6, `SP charged (${u.skill.sp})`);
  kill(BLEMISH);
  assert.ok(u.deploySeq > seq, 'a new deployment');
  assert.ok(Math.abs(u.skill.sp - u.skill.initSp) < 1e-6, `SP reset to ${u.skill.initSp}, got ${u.skill.sp}`);
  assert.equal(Math.round(u.hp), Math.round(u.s.maxHp), 'full HP');
});

test('M3茧甲: the same 复活 — a knock-out (砾 不屈 +2) and a deployment (卡西米尔 +1), once per battle', REAL, () => {
  const { kill, sum } = setup({ band: null, items: { [GRAVEL]: ['chess_item_4_12_e_a'] } });
  const u = kill(GRAVEL);
  assert.ok(u.alive);
  assert.equal(sum(GRAVEL, 'indomShip'), 2);
  assert.equal(sum(GRAVEL, 'kazimierzShip'), 2);
});
