// test/match/zhajing-refresh.test.js — 炸惊模拟 · 重抽（`g.cardRefresh { idx }`）的端到端接线。
//
// 这条链**断了不会报错**，只会「按了没反应」，所以这里断言的是链本身而不是算法：
//   shared/protocol.js 的 C2S 'g.cardRefresh'（校验 0..6 整数）
//     → server/match/match/intents.js 的 switch case（少 case = 静默丢弃，handoff §3.1 的坑）
//       → spDraft.refreshSpCard（模式门 + 轮次 + **每张卡各一次** + 排除已拥有/在桌）
//         → m.public.sp 立刻反映新卡（新卡带 rerolled: true）、m.private.jibian.rerollsLeft = 本手牌还能刷的卡数
// 同时钉住「普通局发这个键必须被拒」——不许静默成功，也不许碰本体。
//
// 口径（owner 2026-10-19，方案 A）：`jibian.rerolls`（数据 4）**不再**是每人每阶段的全局预算；手牌里每张卡各能刷新
// 一次，记账按卡片 id（重发手牌不误判），同一槽第二次是 ALREADY（不是 RATE，也不是 BAD_TARGET）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validateC2S } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';

/** 炸惊单人局，走到 R1 的 PREP（R1 的惊变草稿由 harness 自动选完），再重开一副干净的草稿。 */
function openDraft({ mode = 'solo', difficulty = 'ZHAJING', humans = 1 } = {}) {
  const h = makeMatch({ mode, difficulty, humans, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  // R1 自己的草稿在 drive 里被自动选掉了；从「一张都没选」的干净状态重开，断言才有意义。
  ps.effects = ps.effects.filter((e) => !e || !e.jibian);
  m.round = 1;
  m.enterSpDraft();
  return { h, m, ps };
}

const cardIds = (m) => m.sp.cards.map((c) => (c ? c.id : null));

describe('炸惊模拟 · 重抽（g.cardRefresh）', () => {
  test('协议：idx 是 0..6 的整数（同盟牌池最多 6 槽），越界/非整数在 C2S 就被拒', () => {
    assert.equal(validateC2S({ t: 'g.cardRefresh', idx: 0 }), null);
    assert.equal(validateC2S({ t: 'g.cardRefresh', idx: 2 }), null);
    assert.equal(validateC2S({ t: 'g.cardRefresh', idx: 6 }), null);
    assert.match(validateC2S({ t: 'g.cardRefresh', idx: 7 }) ?? '', /bad field idx/);
    assert.match(validateC2S({ t: 'g.cardRefresh', idx: -1 }) ?? '', /bad field idx/);
    assert.match(validateC2S({ t: 'g.cardRefresh', idx: 1.5 }) ?? '', /bad field idx/);
    // 未知消息名照旧被拒（对照组，证明上面测的是真校验）
    assert.match(validateC2S({ t: 'g.cardRefreshed', idx: 0 }) ?? '', /unknown type/);
  });

  test('单人：重抽第 1 槽 → 该槽换卡、新卡带 rerolled、rerollsLeft = 还能刷的卡数、已拥有集合不变、m.public 立刻反映', () => {
    const { h, m, ps } = openDraft();
    const before = cardIds(m);
    const ownedBefore = ps.jibianOwnedIds().slice();
    const left0 = ps.jibianRerollsLeft();
    assert.equal(left0, 3, `一手 3 张，各能刷一次（不是 data 的 rerolls = ${m.sp.jibian.rerolls}）`);
    assert.equal(before.length, 3, '单人 3 选 1');
    assert.deepEqual(m.sp.cards.map((c) => c.rerolled), [false, false, false], '首发每张都带 rerolled: false');

    assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx: 0 }), { ok: true }, 'handler 接受并返回 ok');
    const after = cardIds(m);
    assert.equal(after.length, 3, '槽位数量不变（新卡占用原槽）');
    assert.notEqual(after[0], before[0], '第 1 槽换成了别的卡');
    assert.deepEqual([after[1], after[2]], [before[1], before[2]], '其它槽不动');
    assert.equal(m.sp.cards[0].rerolled, true, '刷出来的卡带 rerolled: true（这张不能再刷）');
    assert.equal(ps.jibianRerollsLeft(), left0 - 1, '还能刷的卡数 −1');
    assert.deepEqual(ps.jibianOwnedIds(), ownedBefore, '重抽不改变「已拥有」集合');
    // 路由 m.public.sp：客户端读的就是它
    const pub = m.publicView();
    assert.deepEqual(pub.sp.cards.map((c) => c.id), after, 'm.public.sp.cards 已刷新');
    assert.equal(pub.sp.cards[0].idx, 0, '卡自带 idx（客户端按 idx 定位）');
    assert.equal(pub.sp.cards[0].rerolled, true, 'm.public.sp.cards 带 rerolled（客户端按它关掉该卡的按钮）');
    assert.equal(pub.sp.cards[1].rerolled, undefined, '没刷过的卡不长这个键');
    h.dispose?.();
  });

  test('一手 3 张各刷一次都成功；同一槽第二次是 ALREADY（不是 RATE / BAD_TARGET）', () => {
    const { h, m, ps } = openDraft();
    for (const idx of [0, 1, 2]) {
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx }), { ok: true }, `第 ${idx + 1} 张可以刷`);
      assert.equal(m.sp.cards[idx].rerolled, true);
    }
    assert.equal(ps.jibianRerollsLeft(), 0, '三张都刷过了');
    for (const idx of [0, 1, 2]) {
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx }), { error: 'ALREADY' }, `第 ${idx + 1} 张不能再刷`);
    }
    assert.equal(m.sp.cards.length, 3);
    h.dispose?.();
  });

  test('data 的 jibian.rerolls 不再是「全局预算」：把它钉成 1，三张卡仍然各能刷一次', () => {
    const { h, m, ps } = openDraft();
    m.sp.jibian.rerolls = 1;
    for (const idx of [0, 1, 2]) {
      assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx }), { ok: true },
        `rerolls = 1 不再是总额度（旧口径会把第 2、3 张判 RATE）`);
    }
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx: 0 }), { error: 'ALREADY' });
    h.dispose?.();
  });

  test('同一 draft 重发手牌：新的一手可以重新刷（记账按卡片 id，不按槽 idx 误判）', () => {
    const { h, m, ps } = openDraft();
    for (const idx of [0, 1, 2]) assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx }), { ok: true });
    assert.equal(ps.jibianRerollsLeft(), 0);
    // 让 startSpTurn 把同一名玩家的手牌重发一次（真实链路上发生在「轮次转回同一人」时，dealtFor 变了才重发）
    m.sp.dealtFor = null;
    m.startSpTurn();
    assert.equal(m.sp.dealtFor, ps.playerId, '手牌已重发');
    assert.deepEqual(m.sp.cards.map((c) => c.rerolled), [false, false, false], '新的一手每张都是 rerolled: false');
    assert.equal(ps.jibianRerollsLeft(), 3, '新的一手重新有 3 次');
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx: 0 }), { ok: true }, '新一手的第 1 张可以刷');
    h.dispose?.();
  });

  test('同盟：只有轮到的玩家能重抽，别人 BAD_TARGET（不绕过 spDraft 的轮次）', () => {
    const { h, m } = openDraft({ mode: 'coop', humans: 2 });
    const turnPid = m.spTurn();
    assert.ok(turnPid, '草稿有当前轮次玩家');
    const other = [...m.players.keys()].find((pid) => pid !== turnPid);
    const before = cardIds(m);
    assert.deepEqual(m.handle(other, { t: 'g.cardRefresh', idx: 0 }), { error: 'BAD_TARGET' }, '非当前轮次者被拒');
    assert.deepEqual(cardIds(m), before, '被拒时不换牌');
    // 不是自己的手牌 ⇒ rerollsLeft = 0（客户端据此把按钮关掉）
    assert.equal(m.players.get(other).jibianRerollsLeft(), 0, '不是自己的手牌时没有可刷的卡');
    assert.deepEqual(m.handle(turnPid, { t: 'g.cardRefresh', idx: 0 }), { ok: true }, '轮到的玩家可以重抽');
    h.dispose?.();
  });

  test('普通局发 g.cardRefresh 必须被拒（BAD_TARGET），且不改任何状态', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    assert.equal(m.gd.zhajing, false);
    const pubBefore = JSON.stringify(m.publicView().sp ?? null);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx: 0 }), { error: 'BAD_TARGET' });
    assert.equal(JSON.stringify(m.publicView().sp ?? null), pubBefore, '普通局什么都不变');
    h.dispose?.();
  });

  test('惊变草稿之外（PREP 常规阶段）也被拒，不会隔空换上一轮的牌', () => {
    const { h, m, ps } = openDraft();
    // 选掉一张，草稿收尾 → 重新回到 PREP
    const idx = m.sp.cards.findIndex((c) => m.spCardAvailable(c));
    assert.ok(idx >= 0);
    m.handle(ps.playerId, { t: 'g.choice', idx });
    h.flushAll();   // the draft closes on the next scheduler turn (startSpTurn's later(0, finishSpDraft))
    assert.notEqual(m.phase, 'SP_DRAFT', '选完就离开草稿阶段');
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.cardRefresh', idx: 0 }), { error: 'BAD_TARGET' });
    h.dispose?.();
  });
});
