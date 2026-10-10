// test/planPackFetch.test.js — D1-2 acceptance: freshness planning is pure and sha256-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planPackFetch, buildLocalIndex } from '../public/js/net/planPackFetch.js';

const CATALOG = [
  { id: 'fanpack', sha256: 'a'.repeat(64) },
  { id: 'other', sha256: 'b'.repeat(64) },
];

test('空本地 → 全部 missing 待拉', () => {
  const { toFetch, stale } = planPackFetch({}, CATALOG);
  assert.equal(toFetch.length, 2);
  assert.deepEqual(toFetch.map(t => t.reason), ['missing', 'missing']);
  assert.deepEqual(stale, []);
});

test('sha256 相同 → 鲜，不拉；不同 → stale 重拉', () => {
  const local = { fanpack: 'a'.repeat(64), other: 'c'.repeat(64) };
  const { toFetch, stale } = planPackFetch(local, CATALOG);
  assert.equal(toFetch.length, 1);
  assert.equal(toFetch[0].id, 'other');
  assert.equal(toFetch[0].reason, 'stale');
  assert.deepEqual(stale, ['other']);
});

test('全部鲜 → 零拉取', () => {
  const local = { fanpack: 'a'.repeat(64), other: 'b'.repeat(64) };
  const { toFetch, stale } = planPackFetch(local, CATALOG);
  assert.equal(toFetch.length, 0);
  assert.equal(stale.length, 0);
});

test('本地有 catalog 外的包 → 不动它（不在 toFetch，也不算 stale）', () => {
  const local = { fanpack: 'a'.repeat(64), ghost: 'z'.repeat(64) };
  const { toFetch, stale } = planPackFetch(local, CATALOG);
  assert.equal(toFetch.length, 1); // only 'other' (missing)
  assert.equal(toFetch[0].id, 'other');
  assert.ok(!toFetch.some(t => t.id === 'ghost'), 'orphan pack untouched');
  assert.ok(!stale.includes('ghost'));
});

test('buildLocalIndex 从 meta 记录建 {packId: sha256}，跳过坏记录', () => {
  const metas = [
    { id: 'fanpack', sha256: 'a'.repeat(64) },
    { id: 'broken' },                    // no sha256
    null,
    { id: 42, sha256: 'x' },              // non-string id
  ];
  const idx = buildLocalIndex(metas);
  assert.deepEqual(idx, { fanpack: 'a'.repeat(64) });
});
