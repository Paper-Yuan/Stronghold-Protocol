// test/match/zhajing-preselect-scope.test.js — 炸惊「卡池预选」（玩家级 ban）到底管哪些抽取口。
//
// 判据（handoff/audit-rules-2026-10-29.md §1「不生效」清单 + §5.5 验收缺口）：预选**只**过滤「该棋的全部盟约都被禁」的
// 干员，而且这条规则必须覆盖本玩家的**所有抽取口**，不能只有常规商店那一个：
//   ① 常规商店棋位（player/economy.js _rollChessSlot，已有 zhajing-bans.test.js 钉住）；
//   ② 特殊刷新（player/acquire.js pushRewardOffer）；
//   ③ 按盟约的特殊刷新（choices.js `single_special_choice_gain_bond_chess`）；
//   ④ 奖池 / 通用抽取口（match/spDraft.js rollPool 的三种形状 + effectsMeta ctx.rollChess）。
// **装备位不动**：禁选禁的是盟约，道具池是另一个维度（economy.js _rollItemSlot）。
// 并且「没选预选」必须逐字节不变 —— 没有 ban 时 `chessBanFilter()` 返回 null，调用方连 filter 都不传。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { applyCard } from '../../server/match/choices.js';
import { ZHAJING_DIFFICULTY } from '../../shared/zhajing-constants.js';

const zj = (seed = 3) => {
  const h = makeMatch({ mode: 'solo', difficulty: ZHAJING_DIFFICULTY, seed, fake: true }).start();
  h.toPrep(1);
  return h;
};

/** 把所有盟约都禁掉：于是「全部盟约都被禁」的干员 = 名册里每一个有盟约的干员。 */
const banEverything = (ps) => {
  ps.bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze(ps.gd.bondIds.slice()), addon: Object.freeze([]) }) });
  return ps;
};

const withBonds = (ps) => ps.gd.visibleChess.filter((id) => (ps.gd.chess(id)?.bonds || []).length > 0);

describe('炸惊模拟 · 卡池预选的作用范围', () => {
  test('chessBanFilter：没预选 ⇒ null（调用方连 filter 都不传）；全禁 ⇒ 名册里有盟约的干员全被挡', () => {
    const h = zj();
    const ps = h.ps('p_0');
    assert.equal(ps.bans, null);
    assert.equal(ps.chessBanFilter(), null, '没预选：没有 filter，抽取口逐字节不变');
    assert.equal(ps.chessBanFilter?.(), null);
    ps.bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze([]), addon: Object.freeze([]) }) });
    assert.equal(ps.chessBanFilter(), null, '空预选也算没预选');
    banEverything(ps);
    const ban = ps.chessBanFilter();
    assert.equal(typeof ban, 'function');
    for (const id of withBonds(ps)) assert.equal(ban(id), false, `${id} 的盟约全被禁 ⇒ 挡掉`);
    h.dispose?.();
  });

  test('特殊刷新（pushRewardOffer）：被禁的干员不再出现；全禁时只剩没有盟约的棋', () => {
    const h = zj();
    const ps = h.ps('p_0');
    // 目标：特殊刷新那一档（shop.level + rewardOffer().tierOffset）里的**单盟约**干员 —— 禁掉它那条盟约就等于禁掉它
    const ro = ps.gd.rewardOffer();
    const tier = Math.min(ps.shop.level + ro.tierOffset, ro.maxTier);
    const single = ps.gd.visibleChess.find((id) => {
      const c = ps.gd.chess(id);
      return c && c.tier === tier && Array.isArray(c.bonds) && c.bonds.length === 1;
    });
    assert.ok(single, `名册的 T${tier} 里有单盟约干员`);
    const singleBond = ps.gd.chess(single).bonds[0];
    // 对照：没预选时能刷出 offer，且会出现那张单盟约干员
    let seenSingle = false;
    for (let i = 0; i < 60; i++) {
      ps.offers = [];
      const offer = ps.pushRewardOffer('merge');
      if (offer && offer.slots.some((s) => s.id === single)) seenSingle = true;
    }
    assert.ok(seenSingle, '对照：没预选时特殊刷新会给出那张单盟约干员');
    // 只禁它那条盟约 ⇒ 特殊刷新不再出现它（其它干员照旧）
    ps.bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze([singleBond]), addon: Object.freeze([]) }) });
    let anyOffer = 0;
    for (let i = 0; i < 60; i++) {
      ps.offers = [];
      const offer = ps.pushRewardOffer('merge');
      if (!offer) continue;
      anyOffer++;
      assert.ok(!offer.slots.some((s) => s.id === single), `第 ${i + 1} 次特殊刷新给出了被禁的 ${single}`);
    }
    assert.ok(anyOffer > 0, '其它干员照旧能刷出来（不是把整个特殊刷新关掉）');
    // 全禁 ⇒ 有盟约的干员一个都不出现（只剩名册里本来就没有盟约的棋）
    banEverything(ps);
    for (let i = 0; i < 30; i++) {
      ps.offers = [];
      const offer = ps.pushRewardOffer('merge');
      if (!offer) continue;
      for (const s of offer.slots) {
        const bonds = ps.gd.chess(s.id)?.bonds || [];
        assert.equal(bonds.length, 0, `全禁时仍给出了有盟约的 ${s.id}（${bonds.join('/')}）`);
      }
    }
    h.dispose?.();
  });

  test('按盟约的特殊刷新（single_special_choice_gain_bond_chess）：被禁的盟约不再发棋', () => {
    // data/effects.json 的 allybuff_select_7_1 =「你获得1名炎盟约的随机干员棋子」(yanShip)
    const CARD = { id: 'allybuff_select_7_1', kind: 'tactic', family: 'tactic' };
    const idsOf = (ps) => new Set(ps.hand.concat(ps.temp).filter(Boolean).map((p) => p.id));
    const gained = (ps, before) => [...idsOf(ps)].filter((id) => !before.has(id));

    const control = zj();
    const cp = control.ps('p_0');
    const c0 = idsOf(cp);
    applyCard(control.m, cp, CARD);
    const cGained = gained(cp, c0);
    assert.ok(cGained.length >= 1, '对照：没预选时这张卡真的发了一名干员');
    for (const id of cGained) {
      const bonds = cp.gd.chess(id)?.bonds || [];
      assert.ok(bonds.includes('yanShip'), `${id} 是炎盟约的干员（${bonds.join('/')}）`);
    }
    control.dispose?.();

    // 全禁 ⇒ 这张卡抽不到任何干员（它只发炎盟约的棋，而炎盟约的棋全被禁）
    const banned = zj();
    const bp = banned.ps('p_0');
    banEverything(bp);
    const b0 = idsOf(bp);
    applyCard(banned.m, bp, CARD);
    assert.deepEqual(gained(bp, b0), [], '全禁时按盟约的特殊刷新一个干员也发不出来');
    banned.dispose?.();
  });

  test('奖池（spDraft.rollPool 三种形状 + effectsMeta ctx.rollChess）：被禁的干员不再出现', () => {
    const h = zj();
    const ps = h.ps('p_0');
    const m = h.m;
    const ctx = makeCtx(m, ps, { key: 'test' }, 'onPrepEnd');
    const POOLS = ['pool_chess_shop_1_reward', 'pool_chess_shop_3_reward', 'pool_char_later', 'pool_chess_glady'];
    // 对照：没预选时这些池子都能抽到棋
    for (const poolId of POOLS) {
      const got = Array.from({ length: 30 }, () => ctx.rollPool(poolId));
      const hit = got.find((x) => x && x.kind === 'chess');
      assert.ok(hit, `${poolId}: 对照能抽到棋（实际 ${JSON.stringify(got.slice(0, 3))}）`);
    }
    assert.ok(ctx.rollChess({ maxTier: 6 }), '对照：ctx.rollChess 能抽到棋');
    // 全禁 ⇒ 有盟约的干员一个也抽不出来（没有盟约的棋不在这条规则里，照旧可能出）
    banEverything(ps);
    const bonded = (id) => (ps.gd.chess(id)?.bonds || []).length > 0;
    for (const poolId of POOLS) {
      for (let i = 0; i < 25; i++) {
        const got = ctx.rollPool(poolId);
        if (got && got.kind === 'chess') assert.equal(bonded(got.id), false, `${poolId} 在全部盟约被禁时仍抽到 ${got.id}`);
      }
      // spDraft.rollPool 自己的 `ban` 形参同样生效（effectsMeta 就是从这里传进去的）
      for (let i = 0; i < 10; i++) {
        const got = m.rollPool(poolId, { shopLevel: 6, ban: ps.chessBanFilter() });
        if (got && got.kind === 'chess') assert.equal(bonded(got.id), false, `${poolId}（直传 ban）仍抽到 ${got.id}`);
      }
    }
    for (let i = 0; i < 25; i++) {
      const id = ctx.rollChess({ maxTier: 6 });
      if (id) assert.equal(bonded(id), false, `ctx.rollChess 在全部盟约被禁时仍抽到 ${id}`);
    }
    h.dispose?.();
  });

  test('装备位不动：全部盟约被禁时商店装备照旧（禁选禁的是盟约，不是道具池）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    banEverything(ps);
    const items = Array.from({ length: 20 }, () => ps._rollItemSlot());
    assert.ok(items.some((s) => s && s.kind === 'item'), '装备位照旧出货');
    // 商店整体：棋位可以全空，但装备位仍然有货
    ps.shop.level = Math.max(2, ps.shop.level);
    ps.rollShop();
    const kinds = ps.shop.slots.map((s) => s && s.kind);
    assert.ok(kinds.includes('item'), `商店里仍有装备位: ${JSON.stringify(kinds)}`);
    h.dispose?.();
  });

  test('未选预选 ⇒ 逐字节不变：同一 seed 下与「空预选」玩家的抽取序列完全一致', () => {
    const a = zj(11);
    const b = zj(11);
    b.ps('p_0').bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze([]), addon: Object.freeze([]) }) });
    const seq = (h) => {
      const m = h.m;
      const ps = h.ps('p_0');
      const out = [];
      for (let i = 0; i < 20; i++) out.push(m.rollPool('pool_chess_shop_1_reward', { shopLevel: 6 }));
      for (let i = 0; i < 20; i++) out.push(ps._rollChessSlot()?.id ?? null);
      for (let i = 0; i < 20; i++) out.push(makeCtx(m, ps, { key: 'test' }, 'onPrepEnd').rollChess({ maxTier: 6 }));
      return out;
    };
    assert.deepEqual(seq(b), seq(a), '没预选 / 空预选：同一 seed 的抽取序列逐字节相同');
    a.dispose?.();
    b.dispose?.();
  });
});
