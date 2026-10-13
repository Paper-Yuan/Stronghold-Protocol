// test/ui/sweep.test.js — S.W.E.E.P.报告 (screens/sweep.js): the enemy codex's list (one entry per 图鉴 number, no
// summon-only units), a leader's enemies (the leader, then its escorts) and the letter grades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { enemyGrade, codexEnemies, bossEnemyKeys } from '../../public/js/screens/sweep.js';

const ENEMIES = JSON.parse(readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const BOSSES = JSON.parse(readFileSync(new URL('../../data/bosses.json', import.meta.url), 'utf8'));

test('the codex lists every enemy but the summon-only ones, once per 图鉴 number', () => {
  const list = codexEnemies(Object.values(ENEMIES));
  assert.ok(list.length > 200);
  assert.ok(list.every((e) => !e.tokenOnly));
  const ids = list.map((e) => `${e.handbookIndex}|${e.name}`);
  assert.equal(new Set(ids).size, ids.length);
  // the hidden variant of a leader shares its number: only one of them
  assert.equal(list.filter((e) => e.handbookIndex === 'SP08' && e.name === '假想敌：胄').length, 1);
  // ordered by id
  assert.equal(list[0].key, 'enemy_1000_gopro_2');
  assert.deepEqual(codexEnemies(null), []);
});

test('a leader brings its escorts, the leader first and no key twice', () => {
  const boss = BOSSES.boss_1;
  const keys = bossEnemyKeys(boss);
  assert.equal(keys[0], boss.enemyKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('enemy_1427_lrnazg'));
  assert.ok(keys.every((k) => Object.hasOwn(ENEMIES, k)));
  assert.deepEqual(bossEnemyKeys({ enemyKey: 'x' }), ['x']);
});

test('grades rise with the stat (the attack interval the other way) and say — without a value', () => {
  assert.equal(enemyGrade('maxHp', 800), 'E');
  assert.equal(enemyGrade('maxHp', 22000), 'B+');
  assert.equal(enemyGrade('maxHp', 2500000), 'S');
  assert.equal(enemyGrade('atk', 1900), 'S');
  assert.equal(enemyGrade('def', 800), 'A');
  assert.equal(enemyGrade('res', 0), 'E');
  assert.equal(enemyGrade('interval', 6), 'E');
  assert.equal(enemyGrade('interval', 0.5), 'S');
  assert.equal(enemyGrade('interval', null), '—');
  assert.equal(enemyGrade('moveSpeed', undefined), '—');
  assert.equal(enemyGrade('nope', 5), '—');
});
