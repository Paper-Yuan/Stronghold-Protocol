#!/usr/bin/env node
// tools/shop-odds.mjs — 不同商店等级下「抽到某个干员」的概率。
//
// 抽卡规则（server/match/pool.js roll）：按**剩余份数**加权，tier ≤ 商店等级。
//   P(干员 x) = 该干员剩余份数 / Σ(所有 tier ≤ 等级 的干员剩余份数)
// 注意这是**单次单格**的概率；商店每级有 nChess 个格子，所以「一次刷新至少见到 1 张」= 1−(1−P)^n。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch } from '../test/match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chess = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const gd0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));

// 一个干净的 solo 对局，拿到 pool（份数按开局状态）
const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 3, fake: true }).start();
const m = h.m;
const gd = m.gd;
const pool = m.pool;

const levels = [1, 2, 3, 4, 5, 6];
const slotsOf = (lv) => gd.shopSlots(lv);

// 每个等级的：tier 占比 + 各 tier 干员数
console.log('  商店等级  棋子格  1费   2费   3费   4费   5费   6费');
for (const lv of levels) {
  const shares = pool.tierShares(lv);
  const n = slotsOf(lv).chess;
  const pct = (t) => ((shares[t] || 0) * 100).toFixed(1).padStart(5) + '%';
  console.log('     ' + lv + '        ' + String(n).padStart(2) + '  ' + [1, 2, 3, 4, 5, 6].map(pct).join(' '));
}

// 「抽到指定干员」的概率：默认取几个有代表性的（各 tier 一个）
const byTier = {};
for (const [id, e] of pool.entries) {
  if (e.left <= 0) continue;
  (byTier[e.tier] ||= []).push([id, e.left]);
}
console.log('');
console.log('  各 tier 的剩余份数（每张的份数 × 张数）:');
for (const t of [1, 2, 3, 4, 5, 6]) {
  const list = byTier[t] || [];
  const total = list.reduce((n, [, l]) => n + l, 0);
  console.log('    ' + t + ' 费: ' + list.length + ' 种, 共 ' + total + ' 份' + (list[0] ? '，单张 ' + list[0][1] + ' 份' : ''));
}

// 单个干员在每级的单格概率
const pick = [];
for (const t of [1, 2, 3, 4, 5, 6]) {
  const list = (byTier[t] || []).slice().sort((a, b) => b[1] - a[1]);
  if (list[0]) pick.push([t, list[0][0], list[0][1]]);
}
console.log('');
console.log('  单格概率（每级各取该 tier 份数最多的一个干员）:');
for (const [t, id, left] of pick) {
  const name = chess[id]?.name || id;
  const row = levels.map((lv) => {
    if (lv < t) return '  —  ';
    let total = 0;
    for (const [, e] of pool.entries) if (e.tier <= lv && e.left > 0) total += e.left;
    const p = total > 0 ? left / total : 0;
    const n = slotsOf(lv).chess;
    const atLeast1 = 1 - Math.pow(1 - p, n);
    return (p * 100).toFixed(2) + '%/' + (atLeast1 * 100).toFixed(1) + '%';
  });
  console.log('    ' + String(t) + '费 ' + name.padEnd(10) + ' ' + row.join('  '));
}
console.log('');
console.log('  说明：每列是「单格概率 / 一次刷新至少见到 1 张的概率」');
console.log('  列顺序：Lv1 … Lv6');
h.m.dispose();
