// test/match/zhajing-drafts.test.js — 炸惊模拟的两条「草稿/抽卡」规则，都是**断了不报错**的那类：
//
//   ① 同盟局的惊变草稿：参考包给**每个玩家一副自己的 3 张牌池**。0.3.3 曾经是「一房一池、轮流挑」，4 人房每人只剩
//      1 张（等于没得选）。现在 `sp.cards` 形状不变，换人时用 `_dealJibianFor` 重发 3 张，`exclude` = 该玩家已拥有 +
//      已被别人**选走**的卡（只是摆在桌上的会回牌库）。所以这里断言「换人 → 新的一手 3 张、且不含上一个人选走的卡」。
//   ② 隐秘惊变：隐秘核心那一回合的整备（`round === gd.hiddenRound`，本仓 R15）额外抽两张 —— 一张保底「隐秘」稀有度 +
//      一张普通池卡；两张都进 `enemyJibianCards`（对隐秘核心战生效），并当回合执行 `applyHiddenMatchCards`。
//      门在 `gd.zhajing` + `enemyJibian.hidden`，所以官方四档/湮灭**一条都不多**。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';

/** 走到 R1 惊变草稿的炸惊局（同盟 traits：humans 个真人座位）。 */
function atDraft({ mode = 'coop', humans = 2 } = {}) {
  const h = makeMatch({ mode, difficulty: 'ZHAJING', humans, seed: 11 }).start();
  const m = h.m;
  assert.ok(h.drive(() => m.phase === 'SP_DRAFT'), `没进 R1 惊变（${m.phase}）`);
  return { h, m };
}

describe('炸惊模拟 · 同盟惊变草稿：每人一手 3 张', () => {
  test('2 人：换人重发 3 张，甲选走的卡不在乙的手里；选走才真正离开牌库', () => {
    const { h, m } = atDraft({ humans: 2 });
    assert.equal(m.sp.family, 'jibian');
    assert.equal(m.sp.cards.length, 3, '首座 3 张');
    const first = m.spTurn();
    assert.equal(m.sp.dealtFor, first, '这一手是发给首座的');
    const picked = m.sp.cards[0];
    assert.deepEqual(m.handle(first, { t: 'g.choice', idx: 0 }), { ok: true });
    const second = m.spTurn();
    assert.ok(second && second !== first, '轮到第二个人');
    assert.equal(m.sp.cards.length, 3, '第二个人自己的一手 3 张（不是「只剩 2 张」）');
    assert.equal(m.sp.dealtFor, second, '换人就换手牌');
    assert.ok(!m.sp.cards.some((c) => c.id === picked.id), '甲选走的卡不在乙手里');
    assert.ok(m.sp.jibian.claimed.has(picked.id), '选走的卡进了 claimed');
    assert.equal(m.sp.handTaken.size, 0, '新的一手还没有任何槽位被关掉');
    h.dispose?.();
  });

  test('4 人：每个座位轮到时都是 3 张（不是「4 人共 4 张、每人 1 张」）', () => {
    const { h, m } = atDraft({ humans: 4 });
    assert.equal(m.sp.cards.length, 3);
    let turn = m.spTurn();
    const pickedIds = [];
    for (let i = 0; i < 4; i++) {
      assert.ok(turn, `第 ${i + 1} 个座位有轮次`);
      assert.equal(m.sp.dealtFor, turn, `第 ${i + 1} 个座位拿到自己的一手`);
      assert.equal(m.sp.cards.length, 3, `第 ${i + 1} 个座位有 3 张可选`);
      for (const id of pickedIds) assert.ok(!m.sp.cards.some((c) => c.id === id), `此前选走的 ${id} 不在这一手`);
      pickedIds.push(m.sp.cards[0].id);
      assert.deepEqual(m.handle(turn, { t: 'g.choice', idx: 0 }), { ok: true });
      turn = m.spTurn();
    }
    assert.deepEqual([...m.sp.jibian.claimed].sort(), pickedIds.slice().sort(), '四个人选走的卡都在 claimed 里');
    h.dispose?.();
  });

  test('重抽只换当前这个人手里的一张，不碰别人的票', () => {
    const { h, m } = atDraft({ humans: 2 });
    const first = m.spTurn();
    assert.deepEqual(m.handle(first, { t: 'g.choice', idx: 0 }), { ok: true });
    const second = m.spTurn();
    const before = m.sp.cards.map((c) => c.id);
    assert.deepEqual(m.handle(second, { t: 'g.cardRefresh', idx: 1 }), { ok: true });
    assert.equal(m.sp.cards.length, 3);
    assert.notEqual(m.sp.cards[1].id, before[1], '第 2 槽换了一张');
    assert.deepEqual([m.sp.cards[0].id, m.sp.cards[2].id], [before[0], before[2]], '其它槽不动');
    assert.equal(m.players.get(second).privateView().jibian.rerollsLeft >= 0, true, '次数可读');
    h.dispose?.();
  });

  test('死亡回归的「只让发动者再选一次」：_jibianSoloPick 收窄惊变草稿并当场消费', () => {
    // 死亡回归把回合退回整备后，重跑的那一轮如果是惊变回合，只让发动者自己再抽一次（包内口径）。标记由
    // PlayerState.deathReturnTrigger 写在 Match 上（`m._jibianSoloPick`），spDraft 读一次并清空。
    const { h, m } = atDraft({ humans: 2 });
    const target = m.sp.order[1];
    h.flushAll();                       // 让第一副草稿先收尾，避免两副叠在一起
    m.round = 1;
    m._jibianSoloPick = target;
    m.enterSpDraft();
    assert.deepEqual(m.sp.order, [target], '只有发动者在这副草稿里');
    assert.equal(m._jibianSoloPick, null, '标记被消费（只生效一轮）');
    assert.equal(m.sp.cards.length, 3, '他自己仍然 3 选 1');
    // 只有一个玩家：选完草稿就收尾，其余人直接进整备
    const idx = m.sp.cards.findIndex((c) => m.spCardAvailable(c));
    assert.ok(idx >= 0, '有可选的槽位');
    assert.deepEqual(m.handle(target, { t: 'g.choice', idx }), { ok: true });
    h.dispose?.();
  });

  test('_jibianSoloPick 指向一个不在场/不存在的玩家时退回全员（不吞掉别人的草稿）', () => {
    const { h, m } = atDraft({ humans: 2 });
    m.round = 1;
    m._jibianSoloPick = 'ghost';
    m.enterSpDraft();
    assert.deepEqual(m.sp.order.slice().sort(), ['p_0', 'p_1'], '全员都在（幽灵玩家不算）');
    assert.equal(m._jibianSoloPick, null, '无效标记同样被清掉');
    h.dispose?.();
  });
});

describe('炸惊模拟 · 隐秘惊变（R15 整备，两张）', () => {
  /** 跑到 R1 的 PREP，再把「当前回合」推到隐秘核心那一轮，手调一次抽卡（不必真跑 15 轮）。 */
  const atHiddenRound = (difficulty = 'ZHAJING') => {
    const h = makeMatch({ mode: 'solo', difficulty, seed: SEED_HIDDEN }).start();
    h.toPrep(1);
    const m = h.m;
    m.round = m.gd.hiddenRound;
    return { h, m };
  };

  test('隐秘核心前抽两张：一张保底「隐秘」+ 一张普通池卡；累计列表带 hidden 标记', () => {
    const { h, m } = atHiddenRound();
    assert.equal(m.gd.zhajing, true);
    assert.equal(m.gd.hiddenRound, 15, '炸惊的隐秘核心在 R15');
    const hiddenCfg = m.gd.enemyJibian().hidden;
    assert.ok(hiddenCfg && hiddenCfg.enabled, '数据有 hidden 块');
    assert.ok(hiddenCfg.pool.length >= 1);

    const before = (m.enemyJibianCards || []).length;
    const drew = m.drawHiddenJibian(15);
    assert.ok(drew && drew.hidden, '抽到了隐秘卡');
    assert.ok(hiddenCfg.pool.some((c) => (c.effectId || c.id) === drew.hidden.id), '来自隐秘池');
    assert.equal(m.enemyJibianCards.length, before + (drew.ordinary ? 2 : 1), '两张（隐秘 + 普通）都进 enemyJibianCards');
    const list = m.enemyJibianList;
    assert.equal(list.filter((c) => c.hidden === true).length, 1, '累计列表里恰好一条 hidden');
    assert.equal(list[list.length - 1].round, 15);
    // m.public 的统一出口
    const pub = m.publicView().enemyJibian;
    assert.equal(pub.hidden, true, '揭晓来自隐秘阶段');
    assert.equal(pub.round, 15);
    assert.ok(pub.cards.some((c) => c.hidden === true), 'cards 里能按 hidden 分组');
    assert.ok(pub.hiddenLabel && pub.hiddenFlickerMs > 0, '隐秘阶段的下发参数');
    // 同一轮只抽一次
    assert.equal(m.drawHiddenJibian(15), null);
    h.dispose?.();
  });

  test('不在隐秘核心那一轮 → 什么都不抽', () => {
    const { h, m } = atHiddenRound();
    const before = (m.enemyJibianCards || []).length;
    assert.equal(m.drawHiddenJibian(14), null, 'R14 是 Final Assault，不是隐秘核心的整备');
    assert.equal((m.enemyJibianCards || []).length, before);
    h.dispose?.();
  });

  test('官方四档 / 湮灭：同一条调用不产生任何卡，m.public 也不长出字段', () => {
    for (const difficulty of ['NORMAL', 'HARD', 'ABYSS', 'ANNIHILATION']) {
      const h = makeMatch({ mode: 'solo', difficulty, seed: 3 }).start();
      h.toPrep(1);
      const m = h.m;
      assert.equal(m.gd.zhajing, false, `${difficulty}: 不是炸惊`);
      assert.equal(m.drawHiddenJibian(m.gd.hiddenRound ?? 15), null, `${difficulty}: 不抽隐秘惊变`);
      assert.deepEqual(m.enemyJibianCards ?? [], [], `${difficulty}: 没有敌方惊变卡`);
      assert.equal(m.publicView().enemyJibian, undefined, `${difficulty}: m.public 不长出 enemyJibian`);
      h.dispose?.();
    }
  });
});

const SEED_HIDDEN = 7;
