// 多队（8 / 12 人房）—— docs/TWELVE_PLAYER_MODE.md 的对局侧实现：
//   * 编制：8 = 2 队 × 4，12 = 3 队 × 4，按座位下标分队（0–3 / 4–7 / 8–11）
//   * 卡池：队内共用、队间独立（Match.teamPools / Match.poolFor）
//   * 血量：每人一条个体血条，漏怪伤害 d 按当前存活人数 n 平摊，显示 max(1, floor(hp))，归零转观战
//   * 联防：队内（≤2 人，helperOrder）→ 全漏队观看 → 跨队（成功那队出手）→ 扣血 / 结算
// 铁律：4 人房（maxSeats ≤ 4）逐字节不变——最后一组用例专门钉住这一点。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import {
  teamRosters, planTeamUnite, planCrossUnite, teamSurvivors, survivorsTotal,
  splitLeakDamage, hpDisplay, hpMaxDisplay, teamCount, teamOf,
} from '../../server/match/teams.js';
import { teamIndexOf, teamCountOf, MAX_SEATS, TEAM_SIZE } from '../../shared/constants.js';

/** 12 seats: p_0 … p_11 on seats 0 … 11. */
const seats12 = (n = 12) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true }));

/** A normal-field leak script keyed by fieldId ('n:<playerId>'), the unite fields killing everything unless `survivors` says otherwise. */
function scriptLeaks(leaks = {}, survivors = {}) {
  return (b) => {
    if (b.kind === 'unite') return { duration: 2, survivors };
    const fid = b.fieldId || '';
    const pid = fid.startsWith('n:') ? fid.slice(2) : null;
    const n = pid && Number.isInteger(leaks[pid]) ? leaks[pid] : 0;
    return n > 0 ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
  };
}

/** Run a 12/8-seat match up to the COMBAT phase of round 1. */
function toCombat(o = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats12(o.seats ?? 12), seed: 7, fake: true, instant: true, maxSeats: o.seats ?? 12, script: o.script });
  h.start();
  h.drive(() => h.m.phase === 'COMBAT' && h.m.round === 1);
  assert.equal(h.m.phase, 'COMBAT', 'reached COMBAT R1');
  return h;
}

test('编制：8 人 = 2 队 × 4，12 人 = 3 队 × 4，按座位下标分队', () => {
  assert.equal(TEAM_SIZE, 4);
  assert.equal(teamCountOf(4), 1);
  assert.equal(teamCountOf(8), 2);
  assert.equal(teamCountOf(12), 3);
  // 座位下标 → 队
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(teamIndexOf), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);

  const h8 = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats12(8), seed: 7, fake: true, instant: true, maxSeats: 8 });
  assert.equal(h8.m.multiTeam, true);
  assert.equal(h8.m.maxSeats, 8);
  assert.deepEqual(teamRosters(h8.m).map((t) => t.length), [4, 4]);
  assert.equal(teamCount(h8.m), 2);
  const h12 = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats12(12), seed: 7, fake: true, instant: true, maxSeats: 12 });
  assert.deepEqual(teamRosters(h12.m).map((t) => t.length), [4, 4, 4]);
  assert.equal(teamCount(h12.m), 3);
  for (const ps of h12.m.order) assert.equal(teamOf(ps), Math.floor(ps.seat / 4));
});

test('m.public 的队伍与血量：team / hp / hpMax 只在 >4 人的房里出现', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats12(12), seed: 7, fake: true, instant: true, maxSeats: 12 });
  h.start();
  const pub0 = h.m.publicView();
  assert.equal(pub0.maxSeats, 12);
  assert.equal(pub0.teams, 3);
  // 选完策略（= 血量上限按各自构筑落地）之后再看血条
  h.toPrep(1);
  const pub = h.m.publicView();
  for (const p of pub.players) {
    assert.equal(p.team, Math.floor(p.seat / 4));
    // 显示值 = max(1, floor(hp))，上限随各自构筑（strategy band 的 startLp 各不相同）
    assert.equal(p.hp, Math.max(1, Math.floor(p.lp)));
    assert.ok(p.hpMax >= p.hp);
  }
  // 个体的上限确实不同（不同 strategy 的 startLp）
  assert.ok(new Set(pub.players.map((p) => p.hpMax)).size > 1, 'individual HP ceilings differ by build');
});

test('血量显示：max(1, floor(hp))，真实归零才倒下', () => {
  const ps = (lp, alive = true) => ({ lp, alive, hpMax: 10 });
  assert.equal(hpDisplay(ps(3.7)), 3);
  assert.equal(hpDisplay(ps(1.2)), 1);
  assert.equal(hpDisplay(ps(0.4)), 1); // 存活的显示下限是 1：不会出现「显示 0 但还活着」
  assert.equal(hpDisplay(ps(0)), 0); // 归零才倒下
  assert.equal(hpDisplay(ps(0, false)), 0);
  assert.equal(hpMaxDisplay(ps(3, true)), 10);
  assert.equal(hpMaxDisplay({ lp: 2.5, alive: true }), 2); // 没记过上限时退回当前值
});

test('漏怪平摊：每人 3 位小数，残差补给最后一名存活玩家（Σ每人 == d）', () => {
  const sum = (shares) => shares.reduce((a, b) => a + b, 0);
  // d = 25, n = 12 → 11 × 2.083 + 最后一人 2.087 = 25
  const s25 = splitLeakDamage(25, 12);
  assert.equal(s25.d, 25);
  assert.equal(s25.n, 12);
  assert.deepEqual(s25.shares.slice(0, 11), new Array(11).fill(2.083));
  assert.equal(s25.shares[11], 2.087);
  assert.ok(Math.abs(sum(s25.shares) - 25) < 1e-9, `Σ = ${sum(s25.shares)}`);
  // d = 6, n = 12 → 每人 0.5，无残差
  const s6 = splitLeakDamage(6, 12);
  assert.deepEqual(s6.shares, new Array(12).fill(0.5));
  assert.equal(sum(s6.shares), 6);
  // d = 1, n = 3 → 0.333 + 0.333 + 0.334
  const s1 = splitLeakDamage(1, 3);
  assert.deepEqual(s1.shares, [0.333, 0.333, 0.334]);
  assert.equal(sum(s1.shares), 1);
  // d = 0 → 全 0；n = 1 → 一人独得 d
  assert.deepEqual(splitLeakDamage(0, 12).shares, new Array(12).fill(0));
  assert.deepEqual(splitLeakDamage(3, 1).shares, [3]);
  // 每一份都停在第 3 位小数
  for (const v of [...s25.shares, ...s1.shares, ...splitLeakDamage(3, 11).shares]) assert.equal(v, Math.round(v * 1000) / 1000);
  // 没有人活着（n 不合法）⇒ 没有人被扣
  assert.deepEqual(splitLeakDamage(5, 0), { d: 5, n: 0, shares: [] });
});

test('卡池：队内共用、队间独立（12 人房 3 个池，4 人房仍是那一个池）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats12(12), seed: 7, fake: true, instant: true, maxSeats: 12 });
  const m = h.m;
  assert.equal(m.allPools().length, 3);
  const [p0, p3, p4, p8] = ['p_0', 'p_3', 'p_4', 'p_8'].map((id) => h.ps(id));
  assert.equal(m.poolFor(p0), m.poolFor(p3), 'same team ⇒ same pool');
  assert.notEqual(m.poolFor(p0), m.poolFor(p4), 'teams are independent');
  assert.notEqual(m.poolFor(p4), m.poolFor(p8));

  const base = [...m.teamPools[0].entries.keys()].find((id) => m.teamPools[0].cap(id) > 1);
  const before = [0, 1, 2].map((t) => m.teamPools[t].left(base));
  const taken = p0.poolOf(base).take(base, 2);
  assert.equal(taken, 2);
  assert.equal(m.teamPools[0].left(base), before[0] - 2, 'the team pool gave the copies');
  assert.equal(m.teamPools[1].left(base), before[1], 'another team\'s pool is untouched');
  assert.equal(m.teamPools[2].left(base), before[2]);
  assert.equal(m.pool.left(base), m.pool.cap(base), 'the match-level pool is not what a team draws from');

  // 4 人房：still exactly the one shared pool object
  const h4 = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 4, seed: 7, fake: true, instant: true });
  assert.equal(h4.m.multiTeam, false);
  assert.equal(h4.m.teamPools, null);
  assert.equal(h4.m.poolFor(h4.ps('p_0')), h4.m.pool);
  assert.equal(h4.ps('p_0').poolOf('x'), h4.m.pool);
  assert.deepEqual(h4.m.allPools(), [h4.m.pool]);
});

test('队内联防：本队没漏的人里取 ≤2（helperOrder），本队全漏则不借人、转观看', () => {
  const h = toCombat({ script: scriptLeaks({ p_0: 1, p_1: 1, p_2: 1, p_3: 1, p_4: 2, p_8: 1 }) });
  h.run(() => h.m.phase !== 'COMBAT');
  assert.equal(h.m.phase, 'UNITE');
  const plan = h.m.unitePlan;
  const t0 = plan.teams[0];
  const t1 = plan.teams[1];
  const t2 = plan.teams[2];
  // team 0: 全漏 → 不借人，watching
  assert.deepEqual(t0.leakers.map((p) => p.playerId), ['p_0', 'p_1', 'p_2', 'p_3']);
  assert.deepEqual(t0.helpers, []);
  assert.equal(t0.watch, true);
  // team 1: p_4 leaked, p_5/p_6/p_7 perfect → helpers 来自本队，≤2 人
  assert.deepEqual(t1.leakers.map((p) => p.playerId), ['p_4']);
  assert.ok(t1.helpers.length >= 1 && t1.helpers.length <= 2);
  for (const ps of t1.helpers) assert.equal(Math.floor(ps.seat / 4), 1, 'helpers come from the own team only');
  assert.equal(t1.watch, false);
  // team 2: p_8 leaked, 3 perfect → same rule
  assert.equal(t2.leakers.length, 1);
  assert.ok(t2.helpers.length >= 1 && t2.helpers.length <= 2);
  // 只有两支队有联防场（team 0 没有）
  assert.deepEqual(h.m.fields.map((f) => f.fieldId).sort(), ['u1', 'u2']);
  // m.public 的联防信息：队、谁在联防、剩余漏怪数
  const pub = h.m.publicView();
  assert.equal(pub.unite.stage, 'team');
  assert.deepEqual(pub.unite.teams.map((t) => t.watching), [true, false, false]);
  assert.ok(pub.unite.left.p_4 >= 1, 'a leaker\'s remaining enemies are published');
  assert.ok(!pub.unite.helpers.includes('p_0'), 'a team that leaked everybody fields nobody');
});

test('联防三段：队内 → 观看（全漏队，自动推进）→ 跨队，由完全成功的那队出手', () => {
  // team 0 全漏（无联防场）；team 1 的 p_4 漏 2 只、由 p_5/p_6 完全拦下（0 存活）；team 2 的 p_8 漏 1 只、拦不住（1 存活）
  const h = toCombat({
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 1, p_1: 1, p_2: 1, p_3: 1, p_4: 2, p_8: 1 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      // the team stage: u1 holds (0 survivors), u2 does not (p_8's enemy survives); the cross field kills it in the end
      if (b.fieldId === 'u2') return { duration: 2, survivors: { p_8: 1 } };
      return { duration: 2, survivors: {} };
    },
  });
  h.run(() => h.m.phase !== 'COMBAT');
  assert.equal(h.m.phase, 'UNITE');
  assert.equal(h.m.uniteStage, 'team');
  // 队内联防结束 → 观看阶段不看时钟：最后一块队内联防场结束的同一 tick 就进跨队（见「观看没有固定时长」用例），
  // 所以这里看不到停在 watch 的阶段
  h.run(() => h.m.uniteStage !== 'team');
  // team 0 没有联防场（全漏），它的 4 只原样待跨队拦截；team 1 全灭（0），team 2 剩 1
  assert.deepEqual([...(h.m.teamOutcomes || new Map())].map(([k, v]) => [k, v.total]), [[0, 4], [1, 0], [2, 1]]);
  // 出手方 = 完全成功的 team 1 的联防者
  assert.equal(h.m.uniteStage, 'cross');
  const pubCross = h.m.publicView();
  assert.equal(pubCross.unite.stage, 'cross');
  assert.deepEqual(pubCross.unite.teams[0].watching, true);
  const cross = h.m.crossPlan;
  assert.ok(cross, 'a cross-team 联防 was planned');
  assert.equal(cross.source, 1);
  assert.deepEqual(cross.helpers.map((p) => p.playerId), h.m.unitePlan.teams[1].helpers.map((p) => p.playerId));
  // 拦截目标 = 没守住那队（team 2）仍在场的漏怪；team 0 全漏，它的 4 只也在这里被拦
  const sources = new Set(cross.leaked.map((l) => l.sourcePlayerId));
  assert.ok(sources.has('p_8'), 'the failed team\'s leftover is intercepted');
  assert.ok(sources.has('p_0'), 'the all-leaked team\'s leaks are intercepted by the cross-team pair');
  assert.equal(h.m.fields.length, 1);
  assert.equal(h.m.fields[0].fieldId, 'x');
  // 跨队结束 → SETTLE（跨队把残余全灭 ⇒ 本轮 d = 0）
  h.run(() => h.m.phase === 'SETTLE');
  assert.equal(h.m.phase, 'SETTLE');
  const losses = h.m.uniteResultView.losses;
  for (const pid of Object.keys(losses)) assert.equal(losses[pid], 0, `${pid} pays nothing after a full hold`);
});

test('观看（§9 step 4）没有固定时长：队内联防一结束，同一 tick 就进跨队', () => {
  // team 0 全漏（观看）、team 1 / 2 各有一块场。旧实现会在进入 watch 后挂一个 3 s 的 setDeadline；现在退出条件只看场。
  const h = toCombat({
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 1, p_1: 1, p_2: 1, p_3: 1, p_4: 2, p_8: 1 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      return b.fieldId === 'u2' ? { duration: 2, survivors: { p_8: 1 } } : { duration: 2, survivors: {} };
    },
  });
  h.run(() => h.m.phase === 'UNITE' && h.m.uniteStage === 'team');
  assert.ok(h.m.fields.length === 2 && h.m.fields.every((f) => f.live), 'both team fields are still running');
  assert.equal(h.m.crossPlan, null, 'no cross-team 联防 while the team stage fights');
  const t0 = h.sched.now();
  // 逐个调度回调推进：结束队内联防的那一个回调里就已经是 cross（旧的 3 s 定时器会在这里停在 watch）
  let steps = 0;
  while (h.m.phase === 'UNITE' && h.m.uniteStage === 'team') {
    assert.ok(h.sched.runNext(), 'the team stage advances');
    assert.ok(++steps < 1000, 'the team stage is not a timer chain');
  }
  assert.equal(h.m.uniteStage, 'cross', 'the viewing stop never outlives the last team field');
  assert.equal(h.sched.now(), t0, 'no 3 s (nor any clock) between the team stage and the cross stage');
  assert.ok(h.m.crossPlan, 'the cross-team 联防 runs');
  assert.equal(h.m.crossPlan.source, 1);
});

test('观看的退出条件 = 队内联防场全部结束（可控 tick：最后一块场结束的那一 tick 立刻进跨队）', () => {
  // 真实流程里观看的入口就是「最后一块场结束」（上一个用例钉住了同一 tick 退出）。这里把 stage 提前放到 watch —— 即
  // 观看在其他两队还在打时就已经开始 —— 用来验证退出条件本身：还有场在跑就绝不进跨队，最后一块场结束的那一 tick 立刻进。
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seats: seats12(12), seed: 7, fake: true, instant: false, maxSeats: 12,
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 1, p_1: 1, p_2: 1, p_3: 1, p_4: 2, p_8: 1 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      // 两块队内联防场在不同时刻结束：u2（team 2）先，u1（team 1）后
      return b.fieldId === 'u2' ? { duration: 1, survivors: { p_8: 1 } } : { duration: 2, survivors: {} };
    },
  });
  h.start();
  h.drive(() => h.m.phase === 'COMBAT' && h.m.round === 1);
  h.run(() => h.m.phase === 'UNITE');
  assert.equal(h.m.uniteStage, 'team');
  const teamFields = h.m.fields.slice(); // the team stage's own fields (the cross stage replaces m.fields)
  const running = () => teamFields.filter((f) => f.live);
  // 2 队仍在打（u1 / u2），1 队全漏（team 0，没有场 ⇒ 没有可跑的东西）
  assert.deepEqual(running().map((f) => f.fieldId).sort(), ['u1', 'u2']);
  h.m.uniteStage = 'watch'; // 构造：观看已开始，但场还没打完
  assert.equal(h.m._leaveUniteWatch(), false, 'a team field still runs ⇒ the viewing stop does not end');
  assert.equal(h.m.uniteStage, 'watch');
  assert.equal(h.m.crossPlan, null);
  assert.equal(h.m.teamOutcomes, null, 'nothing is judged before the fields end');
  // 逐个调度回调（每个 1/30 s 的 pacing 回调推进 2 个 tick）推进，直到退出观看
  let guard = 0;
  while (h.m.uniteStage === 'watch' && guard++ < 4000) {
    assert.ok(h.sched.runNext(), 'the team fields keep ticking');
    if (running().length) assert.equal(h.m.uniteStage, 'watch', 'still running ⇒ still watching, never a clock');
  }
  assert.ok(guard < 4000, 'the stop ends by itself');
  assert.equal(running().length, 0, 'the last team field ended');
  assert.equal(h.m.uniteStage, 'cross', 'the tick that ended it is the tick of the cross-team 联防');
  // 结局与「场结束时记结果」的那条路径一致：team 0 全漏剩 4、team 1 全拦下 0、team 2 剩 1，出手方是完全成功的 team 1
  assert.deepEqual([...(h.m.teamOutcomes || new Map())].map(([k, v]) => [k, v.total]), [[0, 4], [1, 0], [2, 1]]);
  assert.ok(h.m.crossPlan, 'a cross-team 联防 was planned');
  assert.equal(h.m.crossPlan.source, 1);
});

test('无人完全成功：不产生跨队联防，直接按 d/n 扣血', () => {
  // 队内联防都剩 1 只 ⇒ §8.1 兜底：没有出手方，不产生跨队联防；team 0 全漏 ⇒ 它的 2 只原样计入 d
  const h = toCombat({
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 2, p_4: 2 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      // every team that fields a helper leaves one enemy standing
      return { duration: 2, survivors: { p_0: 1, p_4: 1 } };
    },
  });
  const lp0 = new Map(h.m.order.map((ps) => [ps.playerId, ps.lp]));
  h.run(() => h.m.phase !== 'COMBAT');
  assert.equal(h.m.uniteStage, 'team');
  h.run(() => h.m.phase === 'SETTLE');
  assert.equal(h.m.phase, 'SETTLE');
  assert.equal(h.m.crossPlan, null, 'no cross-team 联防 without a team that fully held');
  // survivors: p_0 1 + p_4 1（各队各剩一只，两支队都没完全成功）= d 2, n = 12 存活 ⇒ 每人 3 位小数的份额，残差归最后一人
  const shares = splitLeakDamage(2, 12).shares;
  const alive = h.m.alivePlayers();
  assert.equal(alive.length, 12);
  for (let i = 0; i < alive.length; i++) {
    const ps = alive[i];
    const before = lp0.get(ps.playerId);
    assert.ok(Math.abs((ps.lp - before) + shares[i]) < 1e-9, `${ps.playerId}: ${before} → ${ps.lp} (expected −${shares[i]})`);
  }
  assert.equal(shares[0], 0.167);
  assert.equal(shares[11], 0.163, 'the rounding residue lands on the last alive player');
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 2) < 1e-9, 'Σ每人 == d');
  const losses = h.m.uniteResultView.losses;
  assert.ok(Math.abs(losses.p_0 - shares[0]) < 1e-9);
  assert.ok(Math.abs(losses.p_7 - shares[7]) < 1e-9, 'everyone alive shares the round, leaker or not');
});

test('倒下后分母变小：每人扣得更多；全部血条归零 ⇒ 判负', () => {
  // 每轮固定：p_0 漏 3、p_4 漏 3，联防一只也拦不下（survivors 全留）⇒ d = 6
  const h = toCombat({
    script: (b) => {
      if (b.kind === 'unite') return { duration: 2, survivors: { p_0: 3, p_4: 3 } };
      const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
      const n = { p_0: 3, p_4: 3 }[pid] || 0;
      return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
    },
  });
  h.ps('p_0').lp = 0.1;   // 撑不住第 1 轮的 6/12 = 0.5
  h.ps('p_1').lp = 30;
  h.ps('p_4').lp = 30;
  const before = new Map(h.m.order.map((ps) => [ps.playerId, ps.lp]));
  h.run(() => h.m.phase !== 'COMBAT');
  h.run(() => h.m.phase === 'SETTLE');
  assert.equal(h.m.phase, 'SETTLE');
  // 第 1 轮：d = 6，n = 12 ⇒ 每人 0.5（整除，无残差）
  assert.equal(splitLeakDamage(6, 12).shares[0], 0.5);
  assert.ok(Math.abs((h.ps('p_1').lp - before.get('p_1')) + 0.5) < 1e-9, 'n = 12 时分摊 6/12 = 0.5');
  assert.equal(h.ps('p_0').alive, false, 'a real HP of 0.1 cannot survive a 0.5 hit');
  assert.ok(h.ps('p_0').lp <= 0);
  // 第 2 轮：p_0 已倒下（它的棋盘不再产怪、不再产漏），n 变成 11 ⇒ 同样的 d 由更少的人摊 ⇒ 每人扣得更多
  const lp1 = new Map(h.m.order.filter((ps) => ps.alive).map((ps) => [ps.playerId, ps.lp]));
  h.drive(() => h.m.phase === 'SETTLE' && h.m.round === 2);
  const aliveNow = h.m.alivePlayers().length;
  assert.equal(aliveNow, 11, 'the downed player no longer shares the round');
  const d2 = 3; // p_0 is gone, so only p_4's 3 survive
  const shares2 = splitLeakDamage(d2, aliveNow).shares;
  // p_4 是存活列表里的第 4 位（p_1, p_2, p_3, p_4 …）
  const i4 = h.m.alivePlayers().findIndex((ps) => ps.playerId === 'p_4');
  assert.ok(Math.abs((h.ps('p_4').lp - lp1.get('p_4')) + shares2[i4]) < 1e-9, `${d2}/${aliveNow} → ${shares2[i4]}`);
  assert.deepEqual([shares2[0], shares2[10]], [0.273, 0.27], '3 位小数，残差 0.003 归最后一名存活玩家');
  assert.ok(Math.abs(shares2.reduce((a, b) => a + b, 0) - d2) < 1e-9, 'Σ每人 == d');
  assert.ok(shares2[0] > 6 / 12 / 2, 'a smaller denominator means a bigger share per player');
});

test('判负：12 条血条全部归零 ⇒ 失败结算（reason eliminated）', () => {
  // 漏怪留在场上（联防一只都没拦下）⇒ 本轮有真实伤害，12 条血条同时归零
  const h = toCombat({ script: (b) => (b.kind === 'unite' ? { duration: 2, survivors: { p_0: 2 } } : (b.fieldId === 'n:p_0' ? { duration: 2, leaks: { p_0: 2 } } : { duration: 2 })) });
  for (const ps of h.m.order) ps.lp = 0.01;
  h.run(() => h.m.phase !== 'COMBAT');
  h.run(() => h.ended != null, { maxSteps: 2e6 });
  assert.ok(h.ended, 'the match ended');
  assert.equal(h.ended.victory, false);
  assert.equal(h.ended.reason, 'eliminated');
  for (const ps of h.m.order) assert.equal(ps.alive, false);
});

test('8 人房：两支队、两块队内联防场，跨队由守住的那一队出手', () => {
  const h = toCombat({
    seats: 8,
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 2, p_6: 1 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      // team 0 holds completely; team 1 leaves its one enemy standing; the cross field ends it
      return b.fieldId === 'u1' ? { duration: 2, survivors: { p_6: 1 } } : { duration: 2, survivors: {} };
    },
  });
  assert.equal(h.m.maxSeats, 8);
  assert.equal(h.m.allPools().length, 2);
  h.run(() => h.m.phase !== 'COMBAT');
  assert.equal(h.m.phase, 'UNITE');
  assert.deepEqual(h.m.fields.map((f) => f.fieldId).sort(), ['u0', 'u1']);
  assert.equal(h.m.publicView().teams, 2);
  h.run(() => h.m.uniteStage === 'cross');
  assert.equal(h.m.crossPlan.source, 0, 'the team that fully held steps in');
  assert.ok(h.m.crossPlan.leaked.some((l) => l.sourcePlayerId === 'p_6'));
  h.run(() => h.m.phase === 'SETTLE');
  // the cross field killed everything: no one pays this round
  for (const v of Object.values(h.m.uniteResultView.losses)) assert.equal(v, 0);
});

test('客户端战斗模式（生产默认）也走同一套多队联防', () => {
  // 生产默认 clientCombat = true：每块联防场由浏览器的 SimClient 跑。这里钉住同一轮流程仍能到 SETTLE，且每块场的
  // 结果按 fieldId 落到各自的队伍上（resultOf(f) 读的是那块场的 result，不是整张场表）。
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seats: seats12(12), seed: 7, fake: true, instant: true, maxSeats: 12, clientCombat: true,
    script: (b) => {
      if (b.kind !== 'unite') {
        const pid = (b.fieldId || '').startsWith('n:') ? b.fieldId.slice(2) : null;
        const n = { p_0: 2, p_4: 1 }[pid] || 0;
        return n ? { duration: 2, leaks: { [pid]: n } } : { duration: 2 };
      }
      // team 0 leaves one standing, team 1 holds: the cross field (which then kills it) must be team 1's pair
      if (b.fieldId === 'u0') return { duration: 2, survivors: { p_0: 1 } };
      return { duration: 2, survivors: {} };
    },
  });
  h.start();
  h.drive(() => h.m.phase === 'COMBAT' && h.m.round === 1);
  h.run(() => h.m.phase !== 'COMBAT');
  assert.equal(h.m.phase, 'UNITE');
  assert.equal(h.m.uniteStage, 'team');
  assert.deepEqual(h.m.fields.map((f) => f.fieldId).sort(), ['u0', 'u1'], 'one client field per team that fields a pair');
  h.run(() => h.m.uniteStage !== 'team');
  // no team lost all four this round ⇒ no viewing stop: straight to the cross-team stage (§9 step 4 only when a
  // team is all-leaked)
  assert.equal(h.m.uniteStage, 'cross');
  assert.deepEqual([...(h.m.teamOutcomes || new Map())].map(([k, v]) => [k, v.total]), [[0, 1], [1, 0]], 'each team\'s own field result');
  assert.equal(h.m.crossPlan.source, 1, 'the team that fully held steps in');
  h.run(() => h.m.phase === 'SETTLE', { maxSteps: 2e6 });
  assert.equal(h.m.phase, 'SETTLE');
  for (const v of Object.values(h.m.uniteResultView.losses)) assert.equal(v, 0);
});

test('4 人房回归：maxSeats ≤ 4 的一切都不进多队分支（m.public 键与顺序不变）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 4, seed: 7, fake: true, instant: true, script: scriptLeaks({ p_0: 1 }) });
  const m = h.m;
  assert.equal(m.multiTeam, false);
  assert.equal(m.maxSeats, MAX_SEATS);
  assert.equal(m.teamPools, null);
  h.start();
  const pub = m.publicView();
  assert.deepEqual(Object.keys(pub), [
    't', 'phase', 'round', 'lastRound', 'deadline', 'serverNow', 'modeId', 'isInfinite', 'bossPhase', 'gameSpeed',
    'speedPref', 'difficulty', 'stageId', 'setupRevision', 'rerollVote', 'factions', 'disabledBonds', 'drawnDisabledBonds',
    'bannedChess', 'bossId', 'hiddenBossId', 'bossRound', 'hiddenRound', 'bossPairs', 'spRound', 'combatMode', 'paused',
    'players', 'fields',
  ]);
  for (const p of pub.players) {
    assert.equal(Object.hasOwn(p, 'team'), false);
    assert.equal(Object.hasOwn(p, 'hp'), false);
    assert.equal(Object.hasOwn(p, 'hpMax'), false);
  }
  // 4 人房的联防仍是单场流程：planUnite 的那一份 plan（helpers / leakers 顶层数组）
  h.drive(() => m.phase === 'COMBAT' && m.round === 1);
  h.run(() => m.phase !== 'COMBAT');
  assert.equal(m.phase, 'UNITE');
  assert.ok(Array.isArray(m.unitePlan.helpers) && Array.isArray(m.unitePlan.leakers));
  assert.equal(m.unitePlan.teams, undefined);
  assert.equal(m.fields.length, 1);
  assert.equal(m.fields[0].fieldId, 'u');
  const pu = m.publicView().unite;
  assert.deepEqual(Object.keys(pu).sort(), ['helpers', 'leakers']);
});
