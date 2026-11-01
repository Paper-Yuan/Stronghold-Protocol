// test/match/zhajing-death-return.test.js — 炸惊模拟 惊变「死亡回归」(jibian_siwanghuigui)。
//
// 卡面：「仅一次，若你在某回合战斗阶段结束后因为目标生命降为 0 淘汰，你和你的小队回到此回合整备阶段。」
// 实现（lead 2026-10-28 的简化口径）：**只留一份 startRound 快照**（round / shop 三槽 / 棋子 uid 集合），
// 淘汰判定处询问 → 恢复本整备阶段的动作（获得的棋子回池、不退钱）、lp = 按下时 + 3、登记 `_jibianRewindRound`，
// 由 settle 推进时消费（用同一个回合号重开整备阶段，不新增 PHASE）。
// 反向：官方四档 / 湮灭房 / 没抽到这张卡 → 整条链 no-op，淘汰路径逐字节不变。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';

const CARD = 'jibian_siwanghuigui';
const KEY = `jibian:${CARD}`;

/** 一名玩家的对局，走到 PREP(r)。 */
function atPrep({ difficulty = 'ZHAJING', round = 1 } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty, seed: 7, fake: true }).start();
  h.toPrep(round);
  return h;
}

/** 给玩家一张惊变卡（形状与 choices.addRef 一致，服务端权威字段直接写）。 */
function giveCard(ps, id = CARD) {
  const ref = { id: `jibian:${id}#1`, key: `jibian:${id}`, name: '死亡回归', desc: '回到本回合整备阶段', battle: true, params: {} };
  ps.effects.push(ref);
  return ref;
}

describe('炸惊模拟 · 死亡回归', () => {
  test('发动：回到本回合整备、钱不退、本整备买的棋子回池、lp = 按下时 + 3、一局一次', () => {
    const h = atPrep({ round: 1 });
    const ps = h.ps('p_0');
    giveCard(ps);
    // 下一回合的 startRound 才会抓快照（持有该卡时）
    h.toPrep(2);
    assert.ok(ps.deathReturnSnapshot, '持有该卡 ⇒ 回合开始抓快照');
    assert.equal(ps.deathReturnSnapshot.round, 2);
    const snapUids = new Set(ps.deathReturnSnapshot.uids);
    const shopBefore = ps.shop.slots.map((s) => (s ? s.id : null));
    const fundsBefore = ps.funds;

    // 本整备阶段买一个干员（不在快照 uid 集合里）
    const buyId = h.m.gd.visibleChess.find((id) => !snapUids.has(id));
    assert.ok(ps.acquireChess(buyId, { fromPool: false }), '买到一名干员');
    const gained = [...ps.allChess()].filter((p) => !snapUids.has(p.uid));
    assert.equal(gained.length, 1, '本整备新增 1 名');
    // 商店牌面被打乱（模拟本整备的重刷）
    ps.shop.slots[0] = null;

    // 生命归零 → 淘汰判定处发动
    ps.lp = 0;
    h.m.eliminateBroken();
    assert.equal(ps.alive, true, '没有淘汰');
    assert.equal(ps.lp, 4, 'lp = max(1, 按下时 0) + 3');
    assert.equal(ps.funds, fundsBefore, '资金不还原（owner 口径：钱不退）');
    assert.equal(ps.pendingFunds, 0);
    assert.deepEqual(ps.shop.slots.map((s) => (s ? s.id : null)), shopBefore, '商店三槽还原');
    assert.deepEqual([...ps.allChess()].filter((p) => !snapUids.has(p.uid)).length, 0, '本整备买的棋子回池');
    assert.equal(h.m._jibianRewindRound, 2, '登记回到第 2 回合');
    // 卡保留但失效（msg() 返回 { msgid, params } 形状，两条字面量已由 lead 批进四包）
    const ref = ps.effects.find((e) => e && e.key === KEY);
    assert.equal(ref.name.msgid, '死亡回归（已消耗）');
    assert.equal(ref.desc.msgid, '它不再保护你');

    // settle 推进时消费：同一个回合号重开整备阶段（不是 r+1）
    h.m.afterSettle();
    assert.equal(h.m.round, 2, '回到本回合，而不是推进到 3');
    assert.equal(h.m._jibianRewindRound, null, '标记已消费');

    // 一局一次：再扣到 0 就真的淘汰
    ps.lp = 0;
    h.m.eliminateBroken();
    assert.equal(ps.alive, false, '第二次不再发动');
    assert.equal(ps.counters[`jibian:${CARD}:used`] ?? ps.counters['jibian:siwanghuigui:used'], 1);
    h.dispose?.();
  });

  test('没有这张卡：淘汰路径与现在逐字节一致（链是 no-op）', () => {
    const h = atPrep({ round: 1 });
    const ps = h.ps('p_0');
    assert.equal(ps.deathReturnSnapshot, null, '没卡 ⇒ 连快照都不抓');
    ps.lp = 0;
    h.m.eliminateBroken();
    assert.equal(ps.alive, false, '照常淘汰');
    assert.equal(ps.lp, 0);
    assert.equal(h.m._jibianRewindRound, undefined);
    h.dispose?.();
  });

  test('官方四档 / 湮灭房：一样 no-op（即使误塞了这张卡也只在炸惊生效）', () => {
    for (const difficulty of ['NORMAL', 'ANNIHILATION']) {
      const h = atPrep({ difficulty, round: 1 });
      const ps = h.ps('p_0');
      giveCard(ps);                       // 误塞：官方/湮灭本来抽不到这张卡
      h.toPrep(2);
      assert.equal(ps.deathReturnSnapshot, null, `${difficulty} 不抓快照`);
      ps.lp = 0;
      h.m.eliminateBroken();
      assert.equal(ps.alive, false, `${difficulty} 照常淘汰`);
      h.dispose?.();
    }
  });

  test('boss 轮同样触发（淘汰询问在 settle → eliminateBroken 里，与场次类型无关）', () => {
    const h = atPrep({ round: 1 });
    const ps = h.ps('p_0');
    giveCard(ps);
    h.toPrep(2);
    // boss 轮/隐秘核心的淘汰走的是同一个 settle() → eliminateBroken()（see settle.js:98），
    // 所以这里把玩家状态切到 boss 轮的整备阶段（startRound 会抓那一份快照）再问一次，
    // 验证「回合类型不参与判定」。
    h.m.round = h.m.gd.bossRound;
    ps.startRound(h.m.gd.bossRound);
    assert.equal(ps.deathReturnSnapshot.round, h.m.gd.bossRound, 'boss 轮的快照抓到的是 boss 轮');
    ps.lp = 0;
    assert.equal(ps.deathReturnTrigger({ auto: true }), true, 'boss 轮也发动');
    assert.equal(ps.alive, true);
    assert.equal(ps.lp, 4);
    h.m.afterSettle();
    assert.equal(h.m.round, h.m.gd.bossRound, '回到 boss 轮自己的整备阶段（不推进到下一回合）');
    h.dispose?.();
  });

  test('回退到惊变回合时写 `_jibianSoloPick`（「只让发动者再选一次」由 spDraft 消费）', () => {
    const h = atPrep({ round: 1 });
    const ps = h.ps('p_0');
    giveCard(ps);
    // R1 是惊变回合（config: spPhaseKinds["1"] = 'jibian'）
    h.m.round = 1;
    ps.startRound(1);
    ps.lp = 0;
    assert.equal(ps.deathReturnTrigger({ auto: true }), true);
    assert.equal(h.m._jibianSoloPick, 'p_0', '惊变回合 ⇒ 写标记');
    // R2 是 express（非惊变）：不写，免得把后面的惊变草稿也收窄成一个人
    h.m._jibianSoloPick = null;
    h.m.round = 2;
    ps.counters = {};
    ps.startRound(2);
    ps.lp = 0;
    assert.equal(ps.deathReturnTrigger({ auto: true }), true);
    assert.equal(h.m._jibianSoloPick, null, '非惊变回合 ⇒ 不写标记');
    h.dispose?.();
  });

  test('用过的卡不会再被抽到（它仍在 effects 里 ⇒ 已在草稿排除集合内）', () => {
    const h = atPrep({ round: 1 });
    const ps = h.ps('p_0');
    giveCard(ps);
    h.toPrep(2);
    ps.lp = 0;
    h.m.eliminateBroken();
    assert.ok(typeof h.m._jibianOwned === 'function', '有草稿排除集合');
    assert.equal(h.m._jibianOwned(ps).has(CARD), true, '已拥有 ⇒ 排除在草稿池外');
    h.dispose?.();
  });
});
