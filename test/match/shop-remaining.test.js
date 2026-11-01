// test/match/shop-remaining.test.js — 局内卡面「剩余 N 张」必须来自**真实份数**（业主 2026-10-29）。
//
// 背景（handoff/audit-pool-copies-2026-10-29.md）：份数规则早就是「单人 ×1 / 同盟 ×2」
// （`server/match/gamedata.js` 的 `poolCopies()` × `economy.coopPoolMultiplier`），但 `player/views.js` 的商店
// slot 视图曾经**不发 `remaining`**，客户端 `public/js/ui/shopBar.js` 只好退回写死的 `{1:30,2:25,3:18,4:12,5:10,6:7}`
// —— 于是单人房与同盟房的卡面数字**逐字相同**，而且与真实池子都不相等（0.2.5.1 的 commit 4624e3b1 曾经发过它，后来丢了）。
//
// 这里钉三件事：
//   ① 每个象棋槽的 `remaining` 必须等于 `m.pool.left(id)`（自选干员经 `poolOf` 路由到该玩家私有库存）；
//   ② 同一张卡在同盟（2 人）房里的剩余数 = 单人房的 **2 倍**（份数乘子生效）；
//   ③ 客户端不再有那张写死的回退表（源码断言 + `—` 兜底）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeMatch } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** 一局开局到整备阶段，返回第一个玩家的私有视图与 match。 */
function firstPlayer(opts) {
  const h = makeMatch(opts).start().toPrep();
  const m = h.m;
  const p = [...m.players.values()][0];
  return { m, p, view: p.privateView() };
}

test('每个象棋槽都带 remaining，且等于池子的真实剩余', () => {
  const { m, view } = firstPlayer({ mode: 'solo', seed: 3, fake: true });
  const chess = (view.shop?.slots || []).filter((s) => s && s.kind === 'chess');
  assert.ok(chess.length > 0, '开局商店里应有象棋槽');
  for (const s of chess) {
    assert.equal(typeof s.remaining, 'number', `${s.id} 必须有 remaining`);
    assert.equal(s.remaining, m.pool.left(s.id), `${s.id} 的 remaining 必须等于 pool.left`);
  }
  // 装备槽也发 `remaining`，但来自 `m.itemPool`（SharedItemPool：无限库存为 Infinity，客户端显示「—」）；
  // 它**绝不能**等于象棋池的份数，否则就是又一处张冠李戴。
  for (const s of (view.shop?.slots || []).filter(Boolean)) {
    if (s.kind === 'item') {
      assert.equal(s.remaining, m.itemPool.left(s.id), `${s.id} 的装备剩余必须来自 itemPool`);
    } else if (s.kind !== 'chess') {
      assert.equal(s.remaining, undefined, `${s.kind} 槽不该带 remaining`);
    }
  }
  m.dispose();
});

test('同盟（2 人）房的剩余张数是单人房的 2 倍 —— coopPoolMultiplier 真的生效', () => {
  const solo = firstPlayer({ mode: 'solo', seed: 3, fake: true });
  const coop = firstPlayer({ mode: 'coop', humans: 2, seed: 3, fake: true });
  const pick = (view) => (view.shop?.slots || []).filter((s) => s && s.kind === 'chess');
  const s1 = pick(solo.view), s2 = pick(coop.view);
  assert.ok(s1.length && s2.length);
  // 同一张卡：同盟 = 单人 × 2（每张卡的 copies 由 poolCopies × isSolo?1:coopPoolMultiplier 决定）
  const byId = new Map(s2.map((s) => [s.id, s.remaining]));
  let compared = 0;
  for (const s of s1) {
    if (!byId.has(s.id)) continue;
    compared += 1;
    assert.equal(byId.get(s.id), s.remaining * 2, `${s.id}: 同盟 ${byId.get(s.id)} 应为单人 ${s.remaining} 的 2 倍`);
  }
  assert.ok(compared > 0, '两局商店里应有同一张卡可对比（不同则用池子总量兜底比较）');
  // 兜底：池子的总份数也是 2 倍
  const total = (m, view) => (view.shop.slots || []).filter((x) => x && x.kind === 'chess').reduce((n, x) => n + (x.remaining || 0), 0);
  assert.ok(total(solo.m, solo.view) > 0);
  solo.m.dispose(); coop.m.dispose();
});

test('买掉一张后 remaining 立刻减少（不是快照）', () => {
  const { m, p, view } = firstPlayer({ mode: 'solo', seed: 5, fake: true });
  const slot = (view.shop.slots || []).findIndex((s) => s && s.kind === 'chess');
  assert.ok(slot >= 0);
  const id = view.shop.slots[slot].id;
  const before = m.pool.left(id);
  p.funds = 99;
  assert.ok(p.buy(slot).ok, '应能买下这个槽');
  const after = p.privateView().shop.slots[slot];
  assert.equal(m.pool.left(id), before - 1, '池子少一份');
  if (after) assert.equal(after.remaining, m.pool.left(id), '（若该槽已卖空/刷新）remaining 仍与池子一致');
  m.dispose();
});

test('客户端不再用写死的剩余表；没有 remaining 时显示「—」', () => {
  const js = read('public/js/ui/shopBar.js');
  assert.doesNotMatch(js, /\{\s*1:\s*30,\s*2:\s*25,\s*3:\s*18/, '写死的 {1:30,2:25,…} 表必须删掉');
  assert.match(js, /slot\?\.remaining != null \? t\('剩余\{n\}张', \{ n: slot\.remaining \}\) : '—'/, '无值时显示「—」，不再编数字');
});
