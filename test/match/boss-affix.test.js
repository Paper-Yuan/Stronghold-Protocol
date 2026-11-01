// test/match/boss-affix.test.js — 超限 Boss 词缀（业主 2026-10-26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_AFFIXES, drawBossAffix, applyBossAffix } from '../../server/match/bossAffixes.js';

function wave() {
  return {
    round: 20,
    spawns: [
      { time: 3, enemyKey: 'enemy_9017_achunt_2', tag: 'boss', mods: { hpMul: 1, atkMul: 1.5, speedMul: 1 }, preview: { boss: true } },
      { time: 4.5, enemyKey: 'enemy_1007_slime', mods: { hpMul: 1, atkMul: 1.5 }, preview: { boss: false } },
    ],
    scale: { atkMul: 1.5, speedMul: 1 },
  };
}

test('词缀池：狂暴 / 召唤，文案含数值', () => {
  assert.deepEqual(BOSS_AFFIXES.map((a) => a.id), ['berserk', 'summon']);
  assert.match(BOSS_AFFIXES[0].text, /20%/);
  assert.match(BOSS_AFFIXES[1].text, /2/);
});

test('drawBossAffix 用 rng.pick，确定性地取池内一项', () => {
  assert.equal(drawBossAffix({ pick: (a) => a[0] }).id, 'berserk');
  assert.equal(drawBossAffix({ pick: (a) => a[1] }).id, 'summon');
  assert.equal(drawBossAffix(null).id, 'berserk', '没有 rng 时也有默认值');
});

test('狂暴只加强 Boss：攻击 ×1.2、生命 ×1.1，随从不变', () => {
  const w = applyBossAffix(wave(), BOSS_AFFIXES[0]);
  const [boss, mob] = w.spawns;
  assert.ok(Math.abs(boss.mods.atkMul - 1.8) < 1e-9);
  assert.ok(Math.abs(boss.mods.hpMul - 1.1) < 1e-9);
  assert.equal(mob.mods.atkMul, 1.5);
  assert.equal(w.affix.id, 'berserk');
});

test('召唤额外 2 只随从：tag=part、countInTotal=false、不计漏怪', () => {
  const w = applyBossAffix(wave(), BOSS_AFFIXES[1]);
  assert.equal(w.spawns.length, 4);
  const added = w.spawns.slice(2);
  assert.ok(added.every((s) => s.tag === 'part' && s.countInTotal === false && s.preview.boss === false));
  assert.ok(Math.abs(added[0].mods.atkMul - 1.5) < 1e-9, '继承 Boss 波已有随从的 mods');
  assert.equal(w.affix.id, 'summon');
});

test('没有词缀时不改波次', () => {
  const before = wave();
  const after = applyBossAffix(before, null);
  assert.equal(after, before);
  assert.equal(after.spawns.length, 2);
  assert.equal(after.affix, undefined);
});
