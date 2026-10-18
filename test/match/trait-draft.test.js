// test/match/trait-draft.test.js — 超限「词条抉择」的抽卡与结算（业主 2026-10-18）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../server/sim/rng.js';
import {
  TRAITS, MONSTERS, SPECIALS, SPECIAL_MOBS, RANK_WEIGHT,
  drawTraitCards, traitFlags, TRAIT_SETTLE,
} from '../../server/match/traits.js';

test('词条池：正面 13 条、负面 14 条，每条都有 id / 名字 / 正文', () => {
  assert.equal(TRAITS.pos.length, 13);
  assert.equal(TRAITS.neg.length, 14);
  for (const list of [TRAITS.pos, TRAITS.neg]) {
    for (const t of list) {
      assert.ok(typeof t.id === 'string' && t.id);
      assert.ok(typeof t.name === 'string' && t.name);
      assert.ok(typeof t.text === 'string' && t.text);
    }
  }
  // 不和是业主点名要的那条
  assert.ok(TRAITS.neg.some((t) => t.id === 'discord'));
});

test('怪物池：悬赏 ≥ 3 的野怪在随机池里，另 3 只特化怪只在特化卡出现', () => {
  assert.equal(MONSTERS.NORMAL.length, 1);
  assert.equal(MONSTERS.ELITE.length, 25);
  assert.equal(MONSTERS.BOSS.length, 6);
  const total = MONSTERS.NORMAL.length + MONSTERS.ELITE.length + MONSTERS.BOSS.length;
  assert.equal(total + SPECIAL_MOBS.length, 35, '32 随机 + 3 特化 = 35（鸭爵套牌是策略单位，已排除）');
  // 特化怪不进普通随机池
  const all = [...MONSTERS.NORMAL, ...MONSTERS.ELITE, ...MONSTERS.BOSS].map((m) => m.key);
  for (const k of SPECIAL_MOBS) assert.ok(!all.includes(k), k + ' 不该在普通池里');
});

test('抽卡：三张互不重复，词条互不重复，特化怪不重复出现', () => {
  const rng = createRng(20261018);
  for (let i = 0; i < 400; i++) {
    for (const polarity of ['pos', 'neg']) {
      const cards = drawTraitCards(rng, polarity);
      assert.equal(cards.length, 3);
      const mobs = cards.map((c) => c.mob);
      assert.equal(new Set(mobs).size, 3, '怪物重复');
      const traits = cards.map((c) => c.traitId);
      assert.equal(new Set(traits).size, 3, '词条重复');
      if (cards.some((c) => c.special)) {
        assert.equal(mobs.filter((m) => SPECIAL_MOBS.includes(m)).length, 1, '特化怪只能出现一次');
      }
    }
  }
});

test('抽卡：等级权重是 5 / 25 / 70（先定等级再取怪）', () => {
  const rng = createRng(7);
  const rank = { NORMAL: 0, ELITE: 0, BOSS: 0 };
  const byKey = new Map();
  for (const [r, list] of Object.entries(MONSTERS)) for (const m of list) byKey.set(m.key, r);
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    for (const c of drawTraitCards(rng, 'pos')) {
      if (c.special) continue;
      const r = byKey.get(c.mob);
      if (r) { rank[r]++; n++; }
    }
  }
  const pct = (k) => (rank[k] / n) * 100;
  assert.ok(Math.abs(pct('BOSS') - 70) < 6, 'BOSS ' + pct('BOSS').toFixed(1));
  assert.ok(Math.abs(pct('ELITE') - 25) < 6, 'ELITE ' + pct('ELITE').toFixed(1));
  assert.ok(pct('NORMAL') < 12, 'NORMAL ' + pct('NORMAL').toFixed(1));
  assert.equal(Object.values(RANK_WEIGHT).reduce((a, b) => a + b, 0), 100);
});

test('词条 → flags：静态修正只映射已实现的键', () => {
  assert.deepEqual(traitFlags('guard'), { allyDefMul: 1.2, allyResAdd: 8 });
  assert.deepEqual(traitFlags('assault'), { allyAtkMul: 1.25 });
  assert.deepEqual(traitFlags('weak'), { allyAtkMul: 0.8 });
  assert.deepEqual(traitFlags('breach'), { enemyDefMul: 0.85, enemyResAdd: -6 });
  assert.ok('allyAtkByMissingHp' in traitFlags('bloodlust'), '浴血要带实时重算的键');
  assert.deepEqual(traitFlags('cluster'), {}, '集群是匹配层行为，不在 flags 里');
});

test('词条 → 每回合行为：富足 / 贫乏 / 再起 / 苛责 / 共栖 / 离散 / 集群 / 不和 / 蜂拥', () => {
  assert.equal(TRAIT_SETTLE.wealth.funds, 1);
  assert.equal(TRAIT_SETTLE.poor.funds, -1);
  assert.equal(TRAIT_SETTLE.revive.lpOnPerfect, 1);
  assert.equal(TRAIT_SETTLE.harsh.lpOnNotPerfect, -1);
  assert.equal(TRAIT_SETTLE.symbiosis.layerBonus, 1);
  assert.equal(TRAIT_SETTLE.scatter.layerBonus, -1);
  assert.equal(TRAIT_SETTLE.cluster.giveItem, 'chess_item_6_09_e_a');
  assert.deepEqual(TRAIT_SETTLE.discord.stripLayers, { bonds: 3, layers: 10 });
  assert.equal(TRAIT_SETTLE.swarm.addElite, 1);
});

test('特化：三个都有自己的标题与概率 20%', () => {
  assert.deepEqual(Object.keys(SPECIALS).sort(), ['mdrock', 'reid', 'xi']);
  for (const [id, sp] of Object.entries(SPECIALS)) {
    assert.ok(sp.title && sp.desc && sp.mob, id);
    assert.equal(sp.chance, 0.2, id);
    assert.ok(sp.desc.length > 20, id + ' 的描述太短');
  }
});
