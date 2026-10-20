// test/match/infinite-curve.test.js — 超限模拟（solo_infinite）的规则作用域与回合曲线。
//
// 背景（2026-10-17 审计）：Match.isInfinite 读在 6 处、却从来没被赋过值，所以 R16+ 无限波次、
// 双 Boss 轮、限伤放宽、索敌节流这些「超限专属」逻辑此前一行都没跑过。开关接上之后，
// 这条用例负责钉住两件事：
//   1. 作用域：只有 mode === 'solo_infinite' 的局 isInfinite 为真，solo / coop 一律为假
//      —— 超限规则不会漏进普通单机与同盟（这是业主明确要求的边界）。
//   2. 流程：超限局按自己的 bossRound 推进；输了就在那里结束（和普通模式同样的收尾语义），
//      赢了则 bossRounds.js 的 isInfinite 分支把它接着推进到下一回合（不是终局）。
//
// 还没覆盖的一端：R16+ 的无限波次曲线。假战目前赢不了 Boss（bossPool 不会被掏空），
// 所以跑不到 16 回合；等假战能表达「Boss 战胜利」之后，把每 5 回合的波次规模采样补在这里。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

function waveSize(w) {
  const spawns = Array.isArray(w && w.spawns) ? w.spawns : [];
  let n = 0;
  for (const s of spawns) n += Math.max(0, Number(s && s.count) || 0);
  // 「类」= **不同的敌人**（不是 spawn 条目数：普通波次一条 spawn 常常带 count > 1）
  const kinds = new Set(spawns.map((x) => x && x.enemyKey).filter(Boolean)).size;
  return { kinds, entries: spawns.length, total: n };
}

test('超限开关的作用域：只有 solo_infinite 的局 isInfinite 为真', () => {
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, difficulty: 'HARD', seed: 7, fake: true }).start();
    assert.equal(h.m.isInfinite, false, mode + ' 不该点亮超限规则');
    h.m.dispose();
  }
  const h = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', seed: 7, fake: true }).start();
  assert.equal(h.m.isInfinite, true, 'solo_infinite 必须点亮超限规则');
  h.m.dispose();
});

test('超限局按自己的 bossRound 推进，Boss 输掉时在那里结束', () => {
  // 假战自带 bossDps：每 tick 给 sharedBoss 掉血，池一空就 "cleared" —— 用它表达「Boss 战打赢」，
  // 超限局才会走 bossRounds.js 的 isInfinite 分支继续下一回合（而不是收尾）。
  const h = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', seed: 11, fake: true,
    script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
  h.autoHumans();
  const samples = [];
  for (let r = 1; r <= 60; r++) {
    const ok = h.drive(() => h.ended != null || (h.m.phase === 'PREP' && h.m.round === r));
    if (!ok || h.ended) break;
    const size = waveSize(h.m.wave);
    samples.push({ round: r, kinds: size.kinds, entries: size.entries, total: size.total, lp: h.ps('p_0')?.lp ?? null });
  }
  for (const s of samples) console.log('    R' + s.round + '\t怪 ' + String(s.total).padStart(3) + ' 只 / ' + String(s.kinds).padStart(2) + ' 种 / ' + String(s.entries).padStart(2) + ' 条 spawn\tLP ' + s.lp);
  // 前 11 回合必须一路推进（普通单机在前 11 回合也这么走）—— 说明超限没有在开头就断
  assert.ok(samples.length >= 3, '至少推进到 R16 之前要采到几个点');
  // 业主 2026-10-19：波次改成「4–5 种地面 + 2–3 种飞行，每种 4–8 只」，
  // 总数因此会逐回合小幅波动（不再单调递增）。这里守的是：
  //   · 种类数在约定区间（4–5 地面 + 2–3 飞行 = 5–9 种）
  //   · 总数不会塌到「几只怪」或涨到「上百只」
  const inf = samples.filter((x) => x.round >= 16 && x.total > 0);
  assert.ok(inf.length >= 3, '没跑到 R16+ 的无限波次，最后一个采样点 R' + samples[samples.length - 1].round);
  // 业主 2026-10-19：无限普通轮次固定「3 种 × 4–20 只」（12–60 只），
  // 种类数固定 3，数量随波次缓慢增加。
  for (const s2 of inf) {
    // 业主 2026-10-20：每轮 6–7 种（Boss 轮额外多一只领袖 → 7–8 种），
    // 单种 3→6 只，所以总数 18–42 左右。
    const boss = s2.round % 5 === 0;
    const wantKinds = boss ? [7, 8] : [6, 7];
    assert.ok(wantKinds.includes(s2.kinds), 'R' + s2.round + ' 的种类应为 ' + wantKinds.join('/') + '，实际 ' + s2.kinds);
    assert.ok(s2.total >= 15 && s2.total <= 50, 'R' + s2.round + ' 的怪数 ' + s2.total + ' 不在 15–50');
  }
  // 结束只可能发生在 bossRound（这里 14）或更晚；不会在开头莫名结束
  if (h.ended) {
    assert.ok(h.ended.roundsPassed >= 10, '结束得太早：R' + h.ended.roundsPassed);
  }
  h.m.dispose();
});