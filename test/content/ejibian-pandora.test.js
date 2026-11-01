// test/content/ejibian-pandora.test.js — 隐秘惊变「潘多拉·敌」(ejibian_hidden_pandora) 的落点。
//
// 背景（handoff/audit-rules-2026-10-29.md §5.2 R15）：这张卡会被抽到、会出现在「已选惊变 · 敌方」页，但**全仓没有任何
// 引用** —— 抽到等于什么也不做。现在它在 `applyHiddenMatchCards` 里有了 Match 侧落点：
//   「随机获得 3 个敌方惊变，7.99% 为隐秘惊变」→ 3 张不重复、不与本局已在生效的卡重复，7.99% 那一次改抽隐秘池；
//   全部 append 进 `enemyJibianCards` / `enemyJibianList`（hidden: true），于是 R15 那场的 flags.enemyJibian、
//   matchJibianPlan（出怪量 / 同时出怪 / 入质测试）与已选惊变面板都立刻看到它们。
//
// 这里钉的是**语义边界**（都是会静默失效的那几条）：
//   · 独立派生随机流（deriveSeed(seed,'hiddenPandora')）——同一 seed 两次结果相同，且不推动 rngWaves / rngDraft；
//   · **不递归**：这 3 张自己的 Match 侧效果（打个响指 / 诛伏赐死）不在抽取瞬间结算 [ASSUMED]；
//   · 幂等：每局最多发一次；
//   · 潘多拉自己不会被再抽出来（否则是一张什么都不做的空卡）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { applyHiddenMatchCards } from '../../server/sim/content/ejibian.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const gd = new GameData(DATA, 'mode_single_zhajing');
const PANDORA = 'ejibian_hidden_pandora';

/** 一个够用的 Match 替身：applyHiddenMatchCards 只读 gd / seed / round / players 与两个 list。 */
function fakeMatch({ seed = 7, round = 15, layers = { yanShip: 100 } } = {}) {
  const ps = {
    playerId: 'p_0',
    layers: { ...layers },
    setLayers(id, v) { this.layers[id] = v; },
  };
  return {
    gd, seed, round,
    players: new Map([[ps.playerId, ps]]),
    enemyJibianCards: [],
    enemyJibianList: [],
    _ps: ps,
  };
}

const ids = (m) => m.enemyJibianCards.slice();
const poolIds = (list) => new Set(list.map((c) => c && (c.effectId || c.id || c.key)));

test('潘多拉·敌：抽到即再发 3 个敌方惊变，全部进 cards / list（hidden 分组）', () => {
  const m = fakeMatch();
  const ordinary = poolIds(gd.enemyJibian().pool);
  const hidden = poolIds(gd.enemyJibian().hidden.pool);
  applyHiddenMatchCards(m, [PANDORA]);
  const got = ids(m);
  assert.equal(got.length, 3, `3 张：${JSON.stringify(got)}`);
  assert.equal(new Set(got).size, 3, '3 张互不重复');
  for (const id of got) {
    assert.ok(ordinary.has(id) || hidden.has(id), `${id} 来自本模式的敌方惊变池`);
    assert.notEqual(id, PANDORA, '潘多拉自己不会被再抽出来');
  }
  assert.equal(m.enemyJibianList.length, 3, '已选惊变面板的敌方页也拿到 3 条');
  for (const row of m.enemyJibianList) {
    assert.equal(row.hidden, true, '按 hidden 分组');
    assert.equal(row.round, 15, '记在抽到它的那一回合');
    assert.ok(row.name, `${row.id} 带名字（面板要显示）`);
  }
});

test('随机流独立且确定：同一 seed 两次结果相同，不同 seed 会换牌', () => {
  const run = (seed) => { const m = fakeMatch({ seed }); applyHiddenMatchCards(m, [PANDORA]); return ids(m); };
  assert.deepEqual(run(7), run(7), '同 seed 逐字节相同');
  assert.equal(typeof fakeMatch({ seed: 7 })._pandoraRng, 'undefined', '还没抽过时没有流');
  const m = fakeMatch({ seed: 7 });
  applyHiddenMatchCards(m, [PANDORA]);
  assert.equal(typeof m._pandoraRng, 'function', '用 deriveSeed(seed,"hiddenPandora") 自己的流（不是 rngWaves / rngDraft）');
  const outcomes = new Set(Array.from({ length: 8 }, (_, i) => run(i + 1).join(',')));
  assert.ok(outcomes.size > 1, '不同 seed 之间结果不全相同（随机来自 seed）');
});

test('7.99% 的隐秘支路：rng 恒 0 时 3 张全从隐秘池抽', () => {
  const m = fakeMatch();
  m._pandoraRng = () => 0;   // 0 < 0.0799 ⇒ 每一次都走隐秘池；池内取第 0 张
  const hidden = poolIds(gd.enemyJibian().hidden.pool);
  applyHiddenMatchCards(m, [PANDORA]);
  const got = ids(m);
  assert.equal(got.length, 3);
  for (const id of got) assert.ok(hidden.has(id), `${id} 来自隐秘池`);
  assert.equal(got[0], 'ejibian_hidden_snap', '隐秘池第 0 张（确定性）');
});

test('不递归：抽到的 打个响指 / 诛伏赐死 不在抽取瞬间结算 [ASSUMED]', () => {
  const m = fakeMatch({ layers: { yanShip: 100 } });
  m._pandoraRng = () => 0;   // 必中隐秘池 → 第 1 张就是 ejibian_hidden_snap（会把所有盟约层数 ×0.5）
  applyHiddenMatchCards(m, [PANDORA]);
  assert.ok(ids(m).includes('ejibian_hidden_snap'), '确实抽到了打响指');
  assert.equal(m._ps.layers.yanShip, 100, '层数没被它改（不递归触发别的惊变）');
});

test('幂等：同一局再调一次不再发牌', () => {
  const m = fakeMatch();
  applyHiddenMatchCards(m, [PANDORA]);
  const once = ids(m);
  applyHiddenMatchCards(m, [PANDORA]);
  assert.deepEqual(ids(m), once, '第二次调用不追加');
  assert.equal(m.enemyJibianList.length, 3);
});

test('不重复已在生效的卡：本局已抽到的敌方惊变不会被潘多拉再发一次', () => {
  const m = fakeMatch();
  const first = gd.enemyJibian().pool[0].effectId;
  m.enemyJibianCards.push(first);
  m.enemyJibianList.push({ round: 1, id: first, name: 'x', hidden: false });
  applyHiddenMatchCards(m, [PANDORA]);
  assert.equal(ids(m).length, 4, '3 张新卡 + 原有的 1 张');
  assert.equal(ids(m).filter((id) => id === first).length, 1, '原有那张没有被重复');
});

test('对照：抽到的不是潘多拉时什么都不加（其余隐秘卡的 Match 侧行为不变）', () => {
  for (const id of ['ejibian_hidden_snap', 'ejibian_hidden_purge', 'ejibian_hidden_absolute']) {
    const m = fakeMatch();
    applyHiddenMatchCards(m, [id]);
    assert.deepEqual(ids(m), [], `${id} 不发牌`);
    assert.deepEqual(m.enemyJibianList, []);
  }
});
