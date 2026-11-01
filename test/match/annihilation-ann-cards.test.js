// test/match/annihilation-ann-cards.test.js — 湮灭专属 mod 的两张盟誓牌（罗德岛 / 卡兹戴尔）进池与隔离。
//
// 背景：这两条盟约的成员**只**写在 `chess[].annBonds`（没有任何棋的 `bonds` 提到它们），所以
//   ① 池判定（Match.bondInPool）必须把 annBonds 算进去，否则 bondLive 恒 false、牌永远不进战术决策；
//   ② 反过来，牌本身带 `annOnly` 时必须有一道**显式**门，不能只靠「它的盟约没成员所以巧合不进池」——
//      今天 bondInPool 开始认 annBonds 了，一旦漏了这道门，官方局与炸惊局就会冒出湮灭的牌。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { tacticDraftCards } from '../../server/match/choices.js';
import { PHASE } from '../../shared/constants.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';
import { ZHAJING_DIFFICULTY } from '../../shared/zhajing-constants.js';

const R = 'annbuff_select_bond_rhodes';
const K = 'annbuff_select_bond_kazdel';
/** 稳定的伪随机（只为把 200 次抽卡跑成确定序列）。 */
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};

const at = (difficulty, extra = {}) => {
  const h = makeMatch({ mode: 'solo', difficulty, seed: 11, fake: true, ...extra }).start();
  h.toPrep(1);
  return h;
};

describe('湮灭模拟 · 两张盟誓牌（annOnly）进池与隔离', () => {
  test('湮灭房：bondInPool / bondLive 认 annBonds（成员只写在 annBonds 里）', () => {
    const h = at(ANNIHILATION_DIFFICULTY, { erosion: 1, annMods: { rhodesShip: true, kazdelShip: true } });
    assert.equal(h.m.gd.annihilation !== null, true);
    assert.equal(h.m.bondInPool('rhodesShip'), true, '池里有棋子带 annBonds: rhodesShip');
    assert.equal(h.m.bondInPool('kazdelShip'), true);
    assert.equal(h.m.bondLive('rhodesShip'), true, 'bondLive 因此为真（不再是巧合的 false）');
    h.dispose?.();
  });

  test('湮灭房：战术决策能抽到这两张牌', () => {
    const h = at(ANNIHILATION_DIFFICULTY, { erosion: 1, annMods: { rhodesShip: true, kazdelShip: true } });
    const gd = h.m.gd;
    const rng = lcg(7);
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      for (const c of tacticDraftCards(gd, rng, 3, { bondAvailable: (b) => h.m.bondLive(b), round: 11 })) seen.add(c.id || c.effectId);
    }
    assert.equal(seen.has(R), true, `200 次抽取里出现罗德岛盟誓（抽到过：${[...seen].slice(0, 6).join(',')}…）`);
    assert.equal(seen.has(K), true, '卡兹戴尔盟誓同样能抽到');
    h.dispose?.();
  });

  test('官方房与炸惊房：池里没有它们，抽卡也永远抽不到（显式 annOnly 门，而不是巧合）', () => {
    for (const difficulty of ['NORMAL', 'HARD', ZHAJING_DIFFICULTY]) {
      const h = at(difficulty);
      assert.equal(h.m.bondInPool('rhodesShip'), false, `${difficulty}: 池里没有罗德岛成员`);
      assert.equal(h.m.bondLive('rhodesShip'), false);
      // 关键：把 bondAvailable 放开成「永远可用」，模拟「池判定被放宽」的最坏情况 —— 显式门必须仍然拦住
      const rng = lcg(13);
      const seen = new Set();
      for (let i = 0; i < 200; i++) {
        for (const c of tacticDraftCards(h.m.gd, rng, 3, { bondAvailable: () => true, round: 11 })) seen.add(c.id || c.effectId);
      }
      assert.equal(seen.has(R), false, `${difficulty}: 即使池判定放开也抽不到罗德岛盟誓`);
      assert.equal(seen.has(K), false, `${difficulty}: 卡兹戴尔同样抽不到`);
      h.dispose?.();
    }
  });

  test('数据形状：两张牌与两个效果都带 annOnly（这道门的前提）', async () => {
    const data = (await import('../../server/data.js')).getData({ log: { warn() {}, error() {}, info() {} } });
    const cards = (data.choices.cards && data.choices.cards.tactic) || [];
    for (const id of [R, K]) {
      const card = cards.find((c) => c && c.effectId === id);
      assert.ok(card, `${id} 在 choices.cards.tactic 里`);
      assert.equal(card.annOnly, true, `${id} 卡上带 annOnly`);
      const eff = data.effects[id];
      assert.ok(eff, `${id} 的效果记录存在`);
      assert.equal(eff.annOnly, true, `${id} 的效果记录也带 annOnly`);
    }
  });

  test('端到端：选中罗德岛盟誓 → bondLayers 真的 +12（卡 → 效果 → 层数）', async () => {
    const h = at(ANNIHILATION_DIFFICULTY, { erosion: 1, annMods: { rhodesShip: true, kazdelShip: true } });
    const { applyCard, tacticCard } = await import('../../server/match/choices.js');
    const ps = h.ps('p_0');
    const cards = (h.m.gd.choices.cards && h.m.gd.choices.cards.tactic) || [];
    const raw = cards.find((c) => c && c.effectId === R);
    assert.ok(raw, '罗德岛盟誓卡在数据里');
    const before = ps.layers.rhodesShip || 0;
    h.m.guard(() => applyCard(h.m, ps, tacticCard(raw)));
    const after = ps.layers.rhodesShip || 0;
    assert.equal(after - before, 12, `选中后层数 +12（${before} → ${after}）`);
    // 卡兹戴尔同理，且两条互不串
    const kBefore = ps.layers.kazdelShip || 0;
    h.m.guard(() => applyCard(h.m, ps, tacticCard(cards.find((c) => c && c.effectId === K))));
    assert.equal((ps.layers.kazdelShip || 0) - kBefore, 12);
    assert.equal(ps.layers.rhodesShip || 0, after, '罗德岛那条没有被卡兹戴尔的牌改动');
    h.dispose?.();
  });

  /**
   * 推进到第 11 回合的机变草稿，直到**这一手真的给出两张盟誓牌之一**（R11 的家族与候选都是抽出来的）。
   * 用测试命令直接跳到该回合（`g.test round`），省掉先打 10 轮。
   */
  const driveToTactic = (difficulty, extra = {}, want = null) => {
    let tacticSeen = 0;
    let drove = 0;
    let jumped = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const h = makeMatch({ mode: 'solo', difficulty, seed: 200 + seed, fake: true, test: true, ...extra }).start();
      h.toPrep(1);
      const m = h.m;
      const jump = m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 11 } });
      if (!jump || jump.ok === false) { h.dispose?.(); continue; }
      jumped++;
      if (!h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 11)) { h.dispose?.(); continue; }
      drove++;
      if (m.sp && m.sp.family === 'tactic') {
        tacticSeen++;
        const ids = m.sp.cards.map((c) => c.id);
        if (!want || ids.some((id) => want.includes(id))) return { tacticSeen, drove, jumped, h };
      }
      h.dispose?.();
    }
    return { tacticSeen, drove, jumped, h: null };
  };

  test('整回合：R11 的机变真的开到战术决策，选中罗德岛盟誓 → +12 层', () => {
    const got = driveToTactic(ANNIHILATION_DIFFICULTY, { erosion: 1, annMods: { rhodesShip: true, kazdelShip: true } }, [R, K]);
    assert.ok(got.tacticSeen > 0, `至少有一局的 R11 机变是战术决策（jumped ${got.jumped} / drove ${got.drove} / tactic ${got.tacticSeen}）`);
    const h = got.h;
    assert.ok(h, `到过 ${got.tacticSeen} 次战术决策，其中一手给出了盟誓牌`);
    const m = h.m;
    assert.equal(m.sp.family, 'tactic');
    const ids = m.sp.cards.map((c) => c.id);
    const idx = ids.indexOf(R) >= 0 ? ids.indexOf(R) : ids.indexOf(K);
    assert.ok(idx >= 0, `这一手真的给出两张盟誓牌之一（候选：${ids.join(',')}）`);
    const ps = h.ps('p_0');
    const want = ids[idx] === R ? 'rhodesShip' : 'kazdelShip';
    const before = ps.layers[want] || 0;
    const turn = m.spTurn ? m.spTurn() : 'p_0';
    assert.deepEqual(m.handle(turn, { t: 'g.choice', idx }), { ok: true }, '真实选择路径接受这张牌');
    assert.equal((ps.layers[want] || 0) - before, 12, `选中后 ${want} +12 层`);
    h.dispose?.();
  });

  test('整回合对照：官方 NORMAL 与 ZHAJING 的 R11 机变里抽不到这两张牌', () => {
    for (const difficulty of ['NORMAL', ZHAJING_DIFFICULTY]) {
      const found = [];
      for (let seed = 1; seed <= 40; seed++) {
        const h = makeMatch({ mode: 'solo', difficulty, seed: 300 + seed, fake: true, test: true }).start();
        h.toPrep(1);
        const m = h.m;
        if (m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 11 } })?.ok === false) { h.dispose?.(); continue; }
        if (!h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 11)) { h.dispose?.(); continue; }
        if (m.sp && m.sp.family === 'tactic') for (const c of m.sp.cards) if (c.id === R || c.id === K) found.push(c.id);
        h.dispose?.();
      }
      assert.deepEqual(found, [], `${difficulty}: 真实回合的战术决策里从未出现这两张牌`);
    }
  });
});
