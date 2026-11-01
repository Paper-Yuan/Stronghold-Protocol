// test/match/zhajing-e2e.test.js — 炸惊模拟（拓展玩法模式 ZHAJING）的**真实对局**端到端验收。
//
// 与 test/match/zhajing-mode.test.js 的分工：那份钉的是**门**（gd.zhajing 站在正确的一侧、官方四档逐字节等于
// 「没有 zj 记录」的基线）；这份钉的是**链路真的接通**——它跑 server/match/Match.js（真实 Match、真实 data/*.json、
// 真实 Battle 模拟，不是 StubMatch、不是 FakeBattle），用既有的 C2S 消息 g.infoReady / g.band / g.choice / g.ready
// 从大厅开局一路走到 RESULT，中间每一段都用具体数字断言。
//
// 为什么这条链必须单独跑一遍：它每一段断掉都**不抛异常、不报错**，只是静默降级——
//   * 惊变阶段没进门（gd.spPhaseKind / spRounds 派生丢掉）→ m.public.sp 变成别的家族，玩家只是「这回合没抽卡」；
//   * 卡抽到了但 applyDefault 没写 `jibian:` ref → 手里什么都没有，控制台干净，界面上却显示选过了；
//   * 敌方惊变没被消费 → m.public.enemyJibian 根本不出现，客户端那块揭晓浮层永远不弹；
//   * 同盟局不够「每人一手 3 张」→ 有人轮到自己时没牌可选，阶段卡死由计时器兜底。
// 所以断言全部是**具体数字**：3 张卡、owned 的长度、effects 里的 key、回合号、结局的 roundsPassed。
//
// 本轮实测（seed 7，单人，真实 Battle）：INFO_CHECK → BAND_DRAFT → R1 惊变 → R1 战斗/结算 → R2 快递 → …
// → R9 结算（RESULT，roundsPassed 8，reason 'eliminated'）：我方惊变 4 张、敌方惊变 2 张（R1 + R6）、reportError 0。
//
// 本文件抓到过的两个产品缺陷（都已修，各有永久回归用例）：
//   BUG-1 整备区槽位不读 gd.benchSize（10 / 20）→ 每组「整备区槽位 = 数据的 benchSize」；
//   BUG-2 effectsMeta 的 ctx 缺 `effects()` → 5 张惊变卡的整备侧 handler 每次触发都抛异常（只进 log.error）
//         → 每组「惊变卡的整备侧 handler」。
//
// 只读：本文件不启动 ws 服务、不写文件、不依赖 Math.random 或真实时钟（harness 的虚拟调度器）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch, give, legalTileFor } from './harness.js';
import { collectViolations } from '../../server/match/invariants.js';

/** 固定种子：所有断言里的回合号 / 结局都建立在这一条轨迹上。 */
const SEED = 7;

/**
 * 走一局。人类座位的每个决策（infoReady / band / SP 抽卡 / PREP 准备）都由这里代发，并把每一次 `m.handle` 的
 * 返回值收进 `results`——harness 的 drive 只看阶段，这份还要断言「没有任何一次 g.* 被拒绝」（error 即红）。
 * `onPrep(m, ps)` 在每个座位的每个 PREP 里各跑一次（本文件用它把棋盘铺满，好撑到第 6 回合的第二张敌方惊变）。
 * @param {ReturnType<typeof makeMatch>} h
 * @param {{ until?: () => boolean, onPrep?: ((m: any, ps: any) => void) | null, maxSteps?: number, results?: any[] | null }} [o]
 * @returns {boolean} until() 是否成立
 */
function drive(h, { until = () => h.ended != null, onPrep = null, maxSteps = 200000, results = null } = {}) {
  const m = h.m;
  const send = (fn) => {
    const r = fn();
    if (r && r.error) { if (results) results.push(r); }
    return r;
  };
  for (let i = 0; i < maxSteps; i++) {
    if (until()) return true;
    if (h.ended) return !!until();
    for (const ps of m.players.values()) {
      if (ps.isBot || ps.left) continue;
      if (m.phase === 'INFO_CHECK' && !ps.infoReady) send(() => m.handle(ps.playerId, { t: 'g.infoReady' }));
      if (m.phase === 'BAND_DRAFT' && m.draftTurn() === ps.playerId) send(() => m.handle(ps.playerId, { t: 'g.band', bandId: 'band_bldsk' }));
      if (m.phase === 'SP_DRAFT' && m.spTurn() === ps.playerId) {
        const idx = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        if (idx != null) send(() => m.handle(ps.playerId, { t: 'g.choice', idx }));
      }
      if (m.phase === 'PREP' && ps.alive && !ps.ready) {
        if (ps.personalChoice) send(() => m.handle(ps.playerId, { t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id }));
        if (onPrep) onPrep(m, ps);
        if (!ps.tempEmpty) ps.resolveTemp();
        send(() => m.handle(ps.playerId, { t: 'g.ready', ready: true }));
      }
    }
    if (until()) return true;
    if (!h.sched.runNext()) return !!until();
  }
  return !!until();
}

/**
 * 每个 PREP 把棋盘铺满（炸惊卡池字典序前 deployCap 张，放不下的跳过）。炸惊的敌人是官方四档的倍数，空棋盘活不过
 * 两回合；铺满之后同一 seed 稳定打到 R9，于是第 6 回合的第二张敌方惊变也会真的抽出来。
 */
function fillBoard(m, ps) {
  for (const chessId of m.gd.visibleChess.slice(0, ps.deployCap)) {
    if (ps.deployCount >= ps.deployCap) break;
    const tile = legalTileFor(m, ps, chessId);
    if (!tile) continue;
    give(m, ps, chessId, 'board', tile);
  }
}

/** 记一条「阶段:回合:草稿家族」轨迹（只记变化），用来断言这局真的走过了哪些回合。 */
function tracer(m) {
  const trace = [];
  const push = () => {
    const key = `${m.phase}:${m.round}:${m.sp ? m.sp.family : '-'}`;
    if (trace[trace.length - 1] !== key) trace.push(key);
  };
  return { trace, push };
}

/** 一个池子的 effectId 集合（真实数据里 cards[].id 就是 pool[].effectId）。 */
const idsOf = (pool) => new Set(pool.map((c) => c.effectId || c.id || c.key));
/** gd.jibian().pool 的 effectId 集合。 */
const poolIds = (gd) => idsOf(gd.jibian().pool);

// ── 1. R1 的惊变三选一 ────────────────────────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 真实 Match 的 R1 惊变阶段', () => {
  test('m.public.sp 是 family:jibian 的 3 选 1，三张卡都在 gd.jibian().pool 里', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    const m = h.m;
    assert.equal(m.modeId, 'mode_single_zhajing');
    assert.equal(m.gd.zhajing, true, 'ZHAJING 模式门');
    assert.equal(m.gd.spPhaseKind(1), 'jibian', 'R1 的 spPhaseKinds 是 jibian');
    assert.deepEqual(m.gd.spRounds().slice(0, 3), [1, 2, 3], 'spRounds 从 kind 表派生（漏写就是特殊阶段永不进门）');

    assert.ok(drive(h, { until: () => m.phase === 'SP_DRAFT' }), `没有进 R1 的惊变阶段（停在 ${m.phase} R${m.round}）`);
    assert.equal(m.phase, 'SP_DRAFT');
    assert.equal(m.round, 1);

    const pub = m.publicView();
    assert.equal(pub.spRound, true, 'R1 是特殊阶段回合');
    assert.ok(pub.sp, 'm.public 带着本轮的草稿');
    assert.equal(pub.sp.family, 'jibian', 'R1 必须是惊变家族（不是加权抽出来的别的家族）');
    assert.equal(pub.sp.name, '惊变阶段');
    assert.equal(pub.sp.cards.length, 3, 'jibian.cards = 3：3 选 1');
    assert.equal(pub.sp.cards.length, m.gd.jibian().cards);
    assert.equal(pub.sp.turn, 'p_0', '单人局轮到唯一的人类座位');
    assert.equal(pub.sp.untimed, true, '单人局的机变/惊变没有时限（soloUntimed）');
    assert.deepEqual(pub.sp.taken, {}, '还没人选过');
    assert.deepEqual(pub.sp.picks, {});

    const pool = poolIds(m.gd);
    assert.equal(pool.size, 99, 'data/*.json 的惊变池 99 张');
    for (const card of pub.sp.cards) {
      assert.equal(card.kind, 'jibian', `${card.id}: 走 applyDefault 的惊变分支`);
      assert.ok(pool.has(card.id), `${card.id} 来自 gd.jibian().pool`);
      assert.ok(['normal', 'rare', 'epic', 'legend', 'hidden'].includes(card.rarity), `${card.id}: rarity ${card.rarity}`);
      assert.ok(card.name && card.desc, `${card.id}: 卡面有名字与说明`);
    }
    const ids = pub.sp.cards.map((c) => c.id);
    assert.equal(new Set(ids).size, 3, '同一批三张互不重复');

    // 还没选：一张都不在手（已拥有排除逻辑的起点）
    const priv = m.players.get('p_0').privateView();
    assert.deepEqual(priv.jibian.owned, []);
    assert.equal(priv.jibian.cards.length, 0);
    // 每张卡各能刷新一次（owner 2026-10-19）：首屏「还能刷的卡数」= 本手牌张数，不再是 jibian.rerolls 那个总额度
    assert.equal(priv.jibian.rerollsLeft, pub.sp.cards.length, '重抽次数 = 本手牌还能刷的卡数（3）');
    assert.equal(m.gd.jibian().cards, pub.sp.cards.length, '手牌张数来自 jibian.cards');
    m.dispose();
  });
});

// ── 2. g.choice 真的把卡落地 ─────────────────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 选卡落地（g.choice { idx }）', () => {
  test('priv.effects 出现 jibian:<effectId>、priv.jibian.owned 增长、该轮草稿关闭', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    const m = h.m;
    const ps = m.players.get('p_0');
    assert.ok(drive(h, { until: () => m.phase === 'SP_DRAFT' }));
    const card = m.sp.cards[1];
    assert.ok(card && card.id, '草稿第二张');

    const res = m.handle('p_0', { t: 'g.choice', idx: 1 });
    assert.deepEqual(res, { ok: true }, `g.choice 被接受: ${JSON.stringify(res)}`);

    // ① 卡落到 effects 的 `jibian:` 前缀 ref 上（battle: true → 整备/战斗两侧都读得到）
    const refs = ps.effects.filter((e) => e && e.key === `jibian:${card.id}`);
    assert.equal(refs.length, 1, `effects 里有且只有一条 jibian:${card.id}`);
    assert.equal(refs[0].battle, true);
    assert.equal(refs[0].jibian, true, 'jibianView 靠这个标记认卡');
    assert.equal(refs[0].rarity, card.rarity, '品质跟着卡走');
    assert.equal(ps.jibianHas(card.id), true);
    assert.deepEqual(ps.jibianOwnedIds(), [card.id]);
    assert.equal(ps.jibianCount(card.id), 1);

    // ② m.private.jibian（客户端「已选惊变」面板读的那一份）
    const priv = ps.privateView().jibian;
    assert.deepEqual(priv.owned, [card.id], 'owned 立刻可读');
    assert.equal(priv.cards.length, 1);
    assert.equal(priv.cards[0].id, card.id);
    assert.equal(priv.cards[0].key, `jibian:${card.id}`);
    assert.equal(priv.cards[0].name, card.name);

    // ③ 草稿状态：这张被占掉，票记在 picks/taken 上
    assert.equal(m.sp.picks.p_0, 1);
    assert.equal(m.sp.taken[1], 'p_0');
    const pub = m.publicView();
    assert.equal(pub.sp.taken[1], 'p_0');
    assert.equal(pub.sp.picks.p_0, 1);

    // ④ 同一张不能再选一次；然后是「该轮草稿关闭」
    const again = m.handle('p_0', { t: 'g.choice', idx: 1 });
    assert.ok(again && again.error, `同一张不能选第二次: ${JSON.stringify(again)}`);
    assert.notEqual(again.error, 'INTERNAL', '拒绝是业务错误码，不是内部异常');

    assert.ok(drive(h, { until: () => m.phase === 'PREP' && m.round === 1 }), `没走到 R1 PREP（${m.phase}）`);
    assert.equal(m.sp, null, '草稿对象已经关掉');
    assert.equal(m.publicView().sp, undefined, 'm.public.sp 不再下发（阶段不再是 SP_DRAFT）');
    assert.deepEqual(ps.jibianOwnedIds(), [card.id], '关闭之后卡还在手上');
    m.dispose();
  });
});

// ── 3. 一局跑通：R1 惊变 → R2 快递 → 战斗 → 结算 ────────────────────────────────────────────────────────────
describe('炸惊模拟 · 一局跑通（真实 Battle，R1 到 RESULT）', () => {
  test('R1 惊变 → R2 express → 每回合一场真实战斗 → 结算，全程无 INTERNAL / 无 reportError', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    const m = h.m;
    const results = [];
    const { trace, push } = tracer(m);

    const done = drive(h, {
      until: () => { push(); return h.ended != null; },
      onPrep: (mm, ps) => {
        // 每一轮休整期都校一次引擎不变量（BUG-1 修好之后这里全量为空，不再有任何豁免）
        assert.deepEqual(collectViolations(mm), [], `不变量（${mm.phase} R${mm.round}）`);
        fillBoard(mm, ps);
      },
      results,
    });
    assert.ok(done, `对局没跑完（停在 ${m.phase} R${m.round}）`);
    assert.ok(h.ended, 'onEnd 被调用了一次');

    // ① 回合轨迹：R1 惊变 → R2 快递 → 每回合都真的打了一场 → 结算到 RESULT
    assert.equal(trace[0], 'INFO_CHECK:0:-');
    assert.ok(trace.includes('SP_DRAFT:1:jibian'), `R1 惊变: ${trace.join(' | ')}`);
    assert.ok(trace.includes('SP_DRAFT:2:express'), `R2 快递（expressCards 6 张）: ${trace.join(' | ')}`);
    assert.ok(trace.includes('PREP:1:-') && trace.includes('COMBAT:1:-') && trace.includes('SETTLE:1:-'), 'R1 打了一场并结算');
    assert.ok(trace.includes('COMBAT:2:-') && trace.includes('SETTLE:2:-'), 'R2 也打了一场并结算');
    assert.equal(m.phase, 'RESULT');
    assert.equal(m.round, 9, 'seed 7 的实测轨迹：R9 结算');

    // ② 结算数字
    assert.equal(h.endedCount, 1, 'onEnd 只调用一次');
    assert.equal(h.ended.modeId, 'mode_single_zhajing');
    assert.equal(h.ended.difficulty, 'ZHAJING');
    assert.equal(h.ended.reason, 'eliminated');
    assert.equal(h.ended.roundsPassed, 8, 'R9 出局 = 通过 8 回合');
    assert.equal(h.ended.players.length, 1);
    assert.equal(h.ended.players[0].playerId, 'p_0');
    assert.equal(h.ended.players[0].eliminatedRound, 9);

    // ③ 我方的惊变卡：R1/R3/R6/R8 各一张（共 4 张），全程累积不丢
    const ps = m.players.get('p_0');
    assert.equal(ps.jibianOwnedIds().length, 4, `本局共选到 4 张惊变: ${JSON.stringify(ps.jibianOwnedIds())}`);
    assert.equal(ps.effects.filter((e) => e && e.jibian === true).length, 4);

    // ④ 敌方惊变：R1 与 R6 各一张，r.public.enemyJibian.cards 是**整局累计**（重连后也读得到）
    assert.equal(m.enemyJibianCards.length, 2, 'R1 + R6 两张敌方惊变');
    assert.deepEqual(m.enemyJibianList.map((c) => c.round), [1, 6]);
    const ej = m.publicView().enemyJibian;
    assert.ok(ej, 'm.public 带着敌方惊变');
    assert.equal(ej.cards.length, 2, '累计列表两张，不是只留最后一张');
    assert.deepEqual(ej.cards.map((c) => c.id), m.enemyJibianCards);
    assert.equal(new Set(m.enemyJibianCards).size, 2, '两张不是同一张（同池不重复抽）');
    assert.equal(ej.round, 6, '最后一张是 R6 的');

    // ⑤ 全程没有一次 handle 被拒、没有一条 reportError、没有 INTERNAL
    assert.deepEqual(results, [], '没有任何 g.* 被拒绝');
    assert.equal(m.errorCount, 0, 'reportError 一次都没跑');
    assert.deepEqual(m.errors, [], 'm.errors 为空');
    // 曾是 BUG-2：effectsMeta.js 的 ctx 缺 `effects()`，金酒之杯 / 倒转区 / 潘多拉魔盒 / 时光之末 / jibian_325799 的
    // 整备侧 handler 每次触发都抛 "ctx.effects is not a function"，而这条路径**只落 log.error**（不走 reportError，
    // 所以 m.errorCount 仍是 0、引擎不变量不变）。修好之后这里是不带任何过滤器的全量断言；
    // 下一组用例（惊变卡的整备侧 handler）是它的常驻防线。
    assert.deepEqual(h.logs.error, [], 'log.error 没被调用过（reportError 与 meta handler 两条路径都会往这里写）');
    const frames = [...h.sent.map(([, msg]) => msg), ...h.bc];
    assert.equal(frames.filter((msg) => msg && msg.t === 'error').length, 0, '没有任何 error 帧');
    assert.equal(frames.filter((msg) => msg && msg.error === 'INTERNAL').length, 0, '没有 INTERNAL');
    assert.ok(h.sent.filter(([, msg]) => msg.t === 'm.private').length > 0, '客户端确实收到了 m.private');
    m.dispose();
  });
});

// ── 4. 同盟局：每个真人座位都能在本轮选到卡 ──────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 同盟局（mode_multi_zhajing）的惊变草稿', () => {
  test('两个真人座位各自拿到一次选择，甲选完乙的草稿仍在（不是一房一人）', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ZHAJING', humans: 2, seed: 11 }).start();
    const m = h.m;
    assert.equal(m.modeId, 'mode_multi_zhajing');
    assert.equal(m.gd.zhajing, true);
    assert.ok(drive(h, { until: () => m.phase === 'SP_DRAFT' }), `没进 R1 惊变（${m.phase}）`);

    assert.equal(m.sp.family, 'jibian');
    assert.equal(m.alivePlayers().length, 2);
    // minCards = 在场人数：草稿宽度至少一人一张，所以每个座位轮到时都还有牌可选
    assert.equal(m.sp.cards.length, Math.min(6, Math.max(3, 2)), '2 人在场 → 3 张（jibian.cards=3 的底线）');
    assert.equal(m.sp.untimed, false, '同盟局有回合计时');
    assert.deepEqual(m.sp.order.slice().sort(), ['p_0', 'p_1'], '两个真人座位都在选卡顺序里');
    assert.equal(m.publicView().sp.cards.length, 3);

    const first = m.spTurn();
    const second = m.sp.order.find((id) => id !== first);
    assert.ok(first && second);

    // 甲选了第一张
    const r1 = m.handle(first, { t: 'g.choice', idx: 0 });
    assert.deepEqual(r1, { ok: true }, `甲选卡: ${JSON.stringify(r1)}`);
    const pubAfter = m.publicView();
    assert.ok(pubAfter.sp, '甲的选卡没有关掉整个草稿');
    assert.equal(pubAfter.sp.turn, second, '轮到乙');
    assert.equal(pubAfter.sp.taken[0], first);
    assert.equal(m.players.get(first).jibianOwnedIds().length, 1, '甲手上 1 张');
    assert.deepEqual(m.players.get(second).jibianOwnedIds(), [], '乙还没选，手上 0 张');
    assert.equal(m.players.get(second).privateView().jibian.cards.length, 0);

    // 乙上桌时**重新发一手 3 张**（每人一副牌池，参考包口径；`sp.cards` 形状不变，客户端不用改）
    const beforeSecond = m.sp.cards.map((c) => c.id);
    assert.equal(beforeSecond.length, 3, '乙的一手也是 3 张');
    assert.equal(m.sp.dealtFor, second, '这一手是发给乙的');
    assert.ok(m.sp.jibian.claimed.size === 1 && m.sp.jibian.claimed.has(m.players.get(first).jibianOwnedIds()[0]), '甲选走的卡记在 claimed（真正离开牌库）');
    const open = m.sp.cards.filter((c) => m.sp.handTaken.has(c.idx) === false).map((c) => c.idx);
    assert.equal(open.length, 3, '乙自己有 3 张可选（不是「只剩 2 张」）');
    const r2 = m.handle(second, { t: 'g.choice', idx: open[0] });
    assert.deepEqual(r2, { ok: true }, `乙选卡: ${JSON.stringify(r2)}`);
    assert.equal(m.players.get(second).jibianOwnedIds().length, 1, '乙手上也有 1 张');
    assert.notDeepEqual(m.players.get(first).jibianOwnedIds(), m.players.get(second).jibianOwnedIds(), '两张是不同的卡');
    assert.deepEqual(Object.keys(m.sp.picks).sort(), ['p_0', 'p_1'], '两个座位都有票');

    // 草稿在两人都选完之后关闭，进入各自的休整期
    assert.ok(drive(h, { until: () => m.phase === 'PREP' && m.round === 1 }));
    assert.equal(m.sp, null);
    assert.equal(m.publicView().sp, undefined);
    m.dispose();
  });

  test('4 个座位：每个座位轮到时都拿到自己的 3 张，甲选走的卡不在乙的手里', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ZHAJING', humans: 4, seed: 11 }).start();
    const m = h.m;
    assert.ok(drive(h, { until: () => m.phase === 'SP_DRAFT' }));
    assert.equal(m.alivePlayers().length, 4);
    assert.equal(m.sp.family, 'jibian');
    assert.equal(m.sp.cards.length, 3, '每人一手 3 张（jibian.cards），不是「4 人共 4 张」');
    const firstTurn = m.spTurn();
    assert.equal(m.sp.dealtFor, firstTurn);
    assert.equal(new Set(m.sp.order).size, 4, '四个座位都在顺序里');

    const picked = m.sp.cards[0].id;
    assert.deepEqual(m.handle(firstTurn, { t: 'g.choice', idx: 0 }), { ok: true });
    const next = m.spTurn();
    assert.notEqual(next, firstTurn);
    assert.notEqual(next, null, '还有人没选');
    assert.equal(m.sp.cards.length, 3);
    assert.equal(m.sp.dealtFor, next, '换人就换手牌');
    assert.ok(!m.sp.cards.some((c) => c.id === picked), '甲选走的卡不在下一手');
    assert.ok(m.sp.jibian.claimed.has(picked), '选走的卡进了 claimed');
    m.dispose();
  });
});

// ── 5. 敌方惊变：只在炸惊里存在 ──────────────────────────────────────────────────────────────────────────────
describe('炸惊模拟 · 敌方惊变（m.public.enemyJibian）与普通局的对照', () => {
  test('R1 之后出现、带池子与揭晓时长；NORMAL 局根本没有这个键', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    const m = h.m;
    assert.equal(m.publicView().enemyJibian, undefined, '开局（R0）还没抽，不发字段');
    assert.ok(drive(h, { until: () => m.phase === 'SP_DRAFT' }), 'R1 惊变阶段');

    const cfg = m.gd.enemyJibian();
    assert.equal(cfg.rounds.length, 2);
    assert.deepEqual(cfg.rounds, [1, 6]);
    const ej = m.publicView().enemyJibian;
    assert.ok(ej, 'R1 之后 m.public 带上 enemyJibian');
    assert.equal(ej.round, 1, '这一张属于 R1');
    assert.equal(ej.cards.length, 1, '目前累计 1 张');
    assert.equal(ej.cards[0].round, 1);
    assert.ok(idsOf(cfg.pool).has(ej.card.id), `${ej.card.id} 来自敌方惊变池（21 张）`);
    assert.equal(cfg.pool.length, 21);
    assert.equal(ej.pool.length, 21, '整池下发给客户端转盘');
    assert.equal(ej.flickerMs, 3000, '揭晓动画：滚动 3000ms');
    assert.equal(ej.resultMs, 3000, '揭晓动画：定格 3000ms');
    assert.ok(['normal', 'epic', 'legend'].includes(ej.rarity), `rarity ${ej.rarity}`);

    // 普通局：init 时就把字段定死是 null，永远不长出来
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: SEED }).start();
    assert.equal(plain.m.enemyJibian, null, 'Match 字段是 null');
    assert.equal(plain.m.drawEnemyJibian(1), null, '第 1 回合也不抽');
    assert.equal(plain.m.publicView().enemyJibian, undefined, '普通房 m.public 没有 enemyJibian');
    assert.equal(plain.m.drawEnemyJibian(6), null);
    assert.deepEqual(plain.m.enemyJibianCards, [], '普通房一张都没抽');
    m.dispose();
    plain.m.dispose();
  });
});

// ── 6. 惊变卡的整备侧 handler：BUG-2 的永久防线 ─────────────────────────────────────────────────────────────
describe('炸惊模拟 · 惊变卡的整备侧 handler（BUG-2 的永久防线）', () => {
  // BUG-2（已修）：这 5 张卡用 `ctx.effects()` 枚举玩家自己的 EffectRef，而 `server/match/effectsMeta.js` 的 ctx
  // 曾**没有**这个方法（参考包 modref/v2.1/server/match/effectsMeta.js:840 有）。于是它们的 handler 每次触发都抛
  // "ctx.effects is not a function"——卡**完全无效**，而错误只落 `log.error`：不走 `reportError`（`m.errorCount` 仍是 0）、
  // 不动引擎不变量、不动 golden，只有「一局真实 Match」的轨迹才撞得到（seed 7 会抽到金酒之杯）。
  // 这一组逐张把最小 ref 塞进 ps.effects、派发它**真正的钩子**，既断言「不报错」也断言「效果真的发生」。
  const cardRef = (id, name = id) => ({
    id: `t_${id}`, key: `jibian:${id}`, name, desc: '', iconKind: 'choice', iconId: id, counter: null,
    battle: true, params: {}, data: { effectId: id }, jibian: true, rarity: 'normal',
  });
  /** R1 休整期、手上没有任何惊变卡的一局（牌面干净，数值可以写死）。 */
  const cleanPrep = () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    assert.ok(drive(h, { until: () => h.m.phase === 'PREP' && h.m.round === 1 }), '没走到 R1 PREP');
    const ps = h.m.players.get('p_0');
    ps.effects = ps.effects.filter((e) => !e || !e.jibian);
    assert.deepEqual(ps.jibianOwnedIds(), []);
    return { h, m: h.m, ps };
  };
  const jibianRefs = (ps) => ps.effects.filter((e) => e && typeof e.key === 'string' && e.key.startsWith('jibian:'));
  const refOf = (ps, id) => ps.effects.find((e) => e && e.key === `jibian:${id}`) || null;
  const noError = (h) => assert.deepEqual(h.logs.error, [], `handler 抛异常只进 log.error: ${JSON.stringify(h.logs.error)}`);

  test('金酒之杯（onPrepEnd）：按资金算攻速/攻生并写回 ref.params（9 资金 → +7 攻速；62 → +84 与 +120%）', () => {
    const { h, m, ps } = cleanPrep();
    ps.effects.push(cardRef('jibian_jinjiuzhibei', '金酒之杯'));
    ps.funds = 9;
    m.dispatch(ps, 'onPrepEnd', {});
    assert.deepEqual({ ...refOf(ps, 'jibian_jinjiuzhibei').params }, { funds: 9, n: 1, aspd: 7, atkPct: 0, hpPct: 0 },
      '每 5 资金 +7 攻速；不超过 50 资金时没有攻生');
    ps.funds = 62;
    m.dispatch(ps, 'onPrepEnd', {});
    const p = refOf(ps, 'jibian_jinjiuzhibei').params;
    assert.equal(p.funds, 62);
    assert.equal(p.n, 12, 'floor(62 / 5)');
    assert.equal(p.aspd, 84, '7 × 12');
    assert.ok(Math.abs(p.atkPct - 1.2) < 1e-9, `超过 50 资金才给攻生：${p.atkPct}`);
    assert.equal(p.hpPct, p.atkPct, '攻生与生命同一个百分比');
    assert.equal(jibianRefs(ps).length, 1, '写回是原地合并，不新增 ref');
    noError(h);
    m.dispose();
  });

  test('潘多拉魔盒（onChoicePick）：撤掉全部惊变 ref 再重抽 3 张不同的回来（4 → 3）', () => {
    const { h, m, ps } = cleanPrep();
    for (const id of ['jibian_panduolamohe', 'jibian_shiguangzhimo', 'jibian_jinjiuzhibei', 'jibian_325799']) ps.effects.push(cardRef(id));
    const before = jibianRefs(ps).map((e) => e.id);
    assert.equal(before.length, 4);
    m.dispatch(ps, 'onChoicePick', { kind: 'choice', card: { id: 'jibian_panduolamohe' } });
    const after = jibianRefs(ps);
    assert.equal(after.length, 3, '删 4 加 3：换三个随机惊变');
    for (const id of before) assert.equal(ps.effects.some((e) => e.id === id), false, `旧 ref ${id} 应当被撤掉`);
    assert.equal(new Set(after.map((e) => e.data.effectId)).size, 3, '新的三张互不重复');
    for (const e of after) assert.ok(idsOf(m.gd.jibian().pool).has(e.data.effectId), `${e.data.effectId} 来自惊变池`);
    noError(h);
    m.dispose();
  });

  test('时光之末（onWouldEliminate）：ev.saved 置 true 并消耗这张卡', () => {
    const { h, m, ps } = cleanPrep();
    ps.effects.push(cardRef('jibian_shiguangzhimo', '时光之末'));
    const ev = { kind: 'normal', saved: false };
    m.dispatch(ps, 'onWouldEliminate', ev);
    assert.equal(ev.saved, true, '非 Boss 战里救一次（LP 由 settle.eliminateBroken 设成 1，单独 dispatch 不会改 lp）');
    assert.equal(refOf(ps, 'jibian_shiguangzhimo'), null, '触发即消耗');
    // Boss / 隐秘核心局不救（卡面写的是「非 boss 战」）
    ps.effects.push(cardRef('jibian_shiguangzhimo', '时光之末'));
    const boss = { kind: 'boss', saved: false };
    m.dispatch(ps, 'onWouldEliminate', boss);
    assert.equal(boss.saved, false);
    assert.ok(refOf(ps, 'jibian_shiguangzhimo'), 'Boss 局不消耗');
    noError(h);
    m.dispose();
  });

  test('？！325799？！（onRoundStart）：第 8 回合起给一个已激活盟约 +325 层并消耗', () => {
    const { h, m, ps } = cleanPrep();
    ps.effects.push(cardRef('jibian_325799'));
    ps.bonds.yanShip = { count: 3, active: true, tier: 1, layers: 0 };
    ps.layers.yanShip = 0;
    m.dispatch(ps, 'onRoundStart', { round: 7 });
    assert.equal(ps.layers.yanShip, 0, '第 8 回合之前不动');
    assert.ok(refOf(ps, 'jibian_325799'), '卡还在');
    m.dispatch(ps, 'onRoundStart', { round: 8 });
    assert.equal(ps.layers.yanShip, 325, '随机一个已激活盟约 +325 层');
    assert.equal(refOf(ps, 'jibian_325799'), null, '结算后这张卡消失');
    noError(h);
    m.dispose();
  });

  test('倒转区（onRoundStart）：任一盟约到 999 层 → +20 资金并消耗', () => {
    const { h, m, ps } = cleanPrep();
    ps.effects.push(cardRef('jibian_daozhuanqu', '倒转区'));
    ps.layers.yanShip = 998;
    const funds0 = ps.funds;
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    assert.equal(ps.funds, funds0, '没到 999 层不发钱');
    assert.ok(refOf(ps, 'jibian_daozhuanqu'), '任务还没完成');
    ps.layers.yanShip = 999;
    m.dispatch(ps, 'onRoundStart', { round: 3 });
    assert.equal(ps.funds, funds0 + 20, '奖励 20 资金');
    assert.equal(refOf(ps, 'jibian_daozhuanqu'), null, '结算后这张卡消失');
    noError(h);
    m.dispose();
  });
});
// ── 7. 产品缺陷回归（BUG-1 已修：整备区槽位读 gd.benchSize）────────────────────────────────────────────────────
describe('炸惊模拟 · 整备区槽位 = 数据的 benchSize（BUG-1 回归）', () => {
  // BUG-1（已修）：server/match/PlayerState.js 的 `this.hand` 曾固定 `new Array(HAND_SIZE)`（=10），不读 gd.benchSize，
  // 于是炸惊局（数据 economy.benchSize = 20）**开局第一帧**就违反 server/match/invariants.js:65
  // （`ps.hand.length !== gd.benchSize`），collectViolations 报 "p_0: hand has 10 slots"；bot.js 的卖出启发式
  // （gd.benchSize - 1）也永不触发。官方四档/湮灭没有 economy 覆盖块 → 仍是 10，零影响。
  test('整备区槽位数 = 数据的 benchSize（20），开局即是', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start();
    const m = h.m;
    assert.equal(m.gd.raw.config.modes.mode_single_zhajing.economy.benchSize, 20, '数据侧');
    assert.equal(m.gd.benchSize, 20, '模式读出来的');
    assert.equal(m.players.get('p_0').hand.length, 20, '整备区真的有 20 格');
    assert.deepEqual(collectViolations(m), [], '不变量开局即满足（旧实现是 ["p_0: hand has 10 slots"]）');
    m.dispose();
  });

  test('数据侧仍然是 20（这条不 skip：数据没被改坏）', () => {
    const gd = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: SEED }).start().m.gd;
    assert.equal(gd.benchSize, 20, 'mode_*.economy.benchSize = 20');
    assert.equal(gd.economy.benchSize, 20);
    // 炸惊的 20 没有漏进主玩法：官方模式的模式记录不带 economy，benchSize 走 config.economy 的 10
    const normal = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: SEED }).start().m.gd;
    assert.equal(normal.benchSize, 10);
    assert.equal(normal.raw.config.modes.mode_single_normal.economy, undefined, '普通模式的记录里没有 economy 覆盖块');
    assert.equal(normal.raw.config.modes.mode_multi_normal.economy, undefined);
  });
});
