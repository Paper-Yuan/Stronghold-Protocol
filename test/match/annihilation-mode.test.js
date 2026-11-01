// test/match/annihilation-mode.test.js — 湮灭模拟（拓展模式的首个玩法包）的接线验收。
//
// 这套用例存在的理由只有一个：侵蚀（蚀流 1..6）这五环链**断在任何一环都不会报错**，只会静默降级成「蚀流 1」——
//   room.create.erosion → Room.erosion → room.state.erosion → startMatch → Match.erosion → GameData opts
//   → gd.erosion → gd.endless / bans / generation / roundCfg / bossHiddenPairs → m.publicView().erosion
// 所以这里断言的不是「能开局」，而是**档位真的走到了**：`m.publicView().erosion` 必须等于房主选的那一档。
// （handoff/EXTENSION-MODE-2026-10-26.md §6 坑 B；a/report.md §6。）
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { buildResult } from '../../server/match/results.js';
import { grantRelic, relicPrepStart, relicStackInfo, relicState, relicModsFor, relicRoundStart, relicBountyMul } from '../../server/match/relics.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { ANNIHILATION_DIFFICULTY, EROSION_MAX } from '../../shared/annihilation-constants.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
const data = getData({ log: QUIET });

/** A real match of the play set, built the way tools/golden.mjs builds one (no client combat, virtual time). */
function annihilationMatch(erosion, mode = 'solo') {
  let summary = null;
  const m = new Match({
    roomCode: 'ANN', mode, difficulty: ANNIHILATION_DIFFICULTY, erosion, seed: 'annihilation-1',
    seats: [{ seat: 0, playerId: 'p0', name: 'P0', connected: true }],
    data, log: QUIET, scheduler: new VirtualScheduler(), send: () => true, broadcast: () => {}, onEnd: (s) => { summary = s; },
    clientCombat: false, verify: 'off',
  });
  return { m, summary: () => summary };
}

describe('湮灭模拟 · 蚀流链路（真实 Match）', () => {
  test('m.public 带着房主选的蚀流档位与 endless（断链会静默变成 1）', () => {
    for (const erosion of [1, 2, 3, 4, 5, 6]) {
      const { m } = annihilationMatch(erosion);
      m.start();
      assert.equal(m.erosion, erosion, `Match.erosion = ${erosion}`);
      assert.equal(m.gd.erosion, erosion, `GameData.erosion = ${erosion}`);
      assert.equal(m.publicView().erosion, erosion, `m.publicView().erosion = ${erosion}（客户端与验收都读它）`);
      assert.equal(m.publicView().endless, erosion >= EROSION_MAX, `蚀流 ${erosion}: endless`);
      assert.equal(m.gd.endless, erosion >= EROSION_MAX);
    }
  });

  test('蚀流 6 = 无尽：没有最后一回合，回合由每章一对 Boss 关口组成', () => {
    const { m } = annihilationMatch(6);
    m.start();
    assert.equal(m.publicView().endless, true);
    assert.equal(m.gd.lastRound, null, '无尽局只到全员淘汰，没有最后一回合');
    assert.deepEqual(m.gd.bossHiddenPairs().slice(0, 4), [[14, 15], [19, 20], [24, 25], [29, 30]], '前四章各一对');
    assert.ok(m.gd.bossHiddenPairs().length > 4, '之后按章继续追加');
    // 蚀流 1..5 仍有最后一回合
    for (const e of [1, 4]) {
      const g = annihilationMatch(e).m;
      g.start();
      assert.equal(g.publicView().endless, false, `蚀流 ${e}: 不是无尽`);
      assert.equal(typeof g.gd.lastRound, 'number', `蚀流 ${e}: 有最后一回合`);
    }
  });

  test('蚀流 5：30 回合、Boss 关口 29、隐秘核心 30', () => {
    const { m } = annihilationMatch(5);
    m.start();
    assert.equal(m.gd.lastRound, 30);
    assert.equal(m.gd.bossRound, 29);
    assert.equal(m.gd.hiddenRound, 30);
    assert.equal(m.publicView().bossRound, 29, '对外视图走 bossRoundFor');
    assert.equal(m.publicView().hiddenRound, 30);
  });

  test('无尽局的结算：通过回合按实际回合算，不被第一章的 bossRound(14) 封顶', () => {
    const { m } = annihilationMatch(6);
    m.start();
    assert.equal(m.gd.bossRound, 14, '无尽局的 gd.bossRound 只是第一章那一对');
    m.round = 40;    // 跑到第 40 回合（无尽没有最后一回合，只能到全员淘汰）
    const r = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'defeat' });
    assert.deepEqual(r.players.map((p) => p.roundsPassed), [39], 'R40 出局 = 通过 39 回合，不是被 14 封顶的 13');
    // 非无尽档仍然按 bossRound 封顶：蚀流 4 跑到 R25 也只算到它自己的 Boss 关口
    const { m: m4 } = annihilationMatch(4);
    m4.start();
    assert.equal(m4.gd.endless, false);
    m4.round = 25;
    const capped = buildResult(m4, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'defeat' });
    assert.deepEqual(capped.players.map((p) => p.roundsPassed), [Math.min(25, m4.gd.bossRound) - 1]);
  });

  test('v3.2.0 对齐：n06 休整期扣血 / p20 数值 / 全队发放含 AI', () => {
    // n06 莱塔尼亚权杖（重铸）: 「进入休整期时目标生命-1（最低降至1）」—— relicModsFor 里那条 case 以前是空的，
    // 这条负面从来没生效过。
    const { m } = annihilationMatch(4);
    m.start();
    const ps = [...m.players.values()][0];
    ps.lp = 10;
    grantRelic(m, ps, 'n06');
    relicPrepStart(m, ps);
    assert.equal(ps.lp, 9, 'n06: 休整期目标生命 -1');
    ps.lp = 1;
    relicPrepStart(m, ps);
    assert.equal(ps.lp, 1, 'n06: 最低降到 1，不会把人扣死');
    // 图鉴的「N 层」：回合号读 ps.m.round；ps.round 是每回合计数器对象（player/round.js:17），读它永远是第 1 回合
    assert.equal(typeof ps.round, 'object');
    assert.equal(typeof ps.m.round, 'number');
    // n06 没有「层数」语义，stackInfo 必须是 null（顺手钉住签名没被改坏）
    assert.equal(relicStackInfo(ps, { id: 'n06', fx: { rule: { id: 'lpDrainRest', n: 1 } } }, relicState(ps), null), null);
  });

  test('p20 黑洞协议的 hp 与文案一致（+150%）', () => {
    const p20 = data.relics && data.relics.relics ? data.relics.relics.p20 : null;
    assert.ok(p20, 'p20 在 data/relics.json 里');
    assert.equal(p20.fx.rule.hp, 1.5, '文案写 +150%，数值必须是 1.5（曾误写成 0.5）');
  });

  test('非湮灭模式一点都不受影响（同一份数据、同样的回合表）', () => {
    const m = new Match({
      roomCode: 'NRM', mode: 'solo', difficulty: 'NORMAL', seed: 'normal-1',
      seats: [{ seat: 0, playerId: 'p0', name: 'P0', connected: true }],
      data, log: QUIET, scheduler: new VirtualScheduler(), send: () => true, broadcast: () => {}, onEnd: () => {},
      clientCombat: false, verify: 'off',
    });
    m.start();
    assert.equal(m.gd.erosion, 1, '普通局的侵蚀恒为 1');
    assert.equal(m.gd.endless, false);
    assert.equal(m.gd.lastRound, 14, '官方标准的回合表没被改写');
    assert.equal(m.publicView().erosion, undefined, '普通局的 m.public 不长出 annihilation 字段');
  });
});

// ── v3.2.0 对齐的第二批：悬赏完成信号（p34 / p39）与一次性装备（p43 / p44）─────────────────────────────
// 这批的共同点是「钩子写对了但没有触发点」：p34 的「完成悬赏额外 +1 层」曾挂在 perfect 上（完美作战≠完成悬赏），
// p39 的层数计数器从来没人加过（唯一会加它的 relicOnBattleResult 是死导出），p43/p44 在 items.js 里没有调用点。
describe('湮灭模拟 · 藏品计数器与一次性装备（v3.2.0 对齐）', () => {
  /** 湮灭局的 PREP（harness 的 fake battle 只用来开局，本组用例不跑战斗）。 */
  const annihilation = () => makeMatch({ mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY, fake: true }).start().toPrep();
  /** 数据里所有「装备即销毁」的普通装备（kind 以 consume_on_equip 开头）。 */
  const consumeItems = (m) => Object.keys(m.gd.raw.items).filter((id) => {
    const r = m.gd.raw.items[id];
    return !!(r && !r.isGolden && r.itemType === 'EQUIP' && typeof r.kind === 'string' && r.kind.startsWith('consume_on_equip'));
  });
  /** Put one operator on the board and return it (the carrier of the items below). */
  const carrier = (h) => {
    const m = h.m, ps = h.ps('p_0');
    const chessId = m.gd.visibleChess[0];
    const pos = legalTileFor(m, ps, chessId);
    return { m, ps, unit: give(m, ps, chessId, 'board', pos) };
  };

  test('p34 铿金征鼓：完成悬赏才额外 +1 层（完美作战不算），上限 10', () => {
    const { m, ps } = carrier(annihilation());
    grantRelic(m, ps, 'p34');
    const st = relicState(ps);
    st.counters.atkRoundStacks = 0;
    m.dispatch(ps, 'onBattleResult', { perfect: true, bountyDone: 0, unite: null });
    assert.equal(st.counters.atkRoundStacks, 0, '完美作战但没完成悬赏 → 不额外叠（旧实现会 +1）');
    m.dispatch(ps, 'onBattleResult', { perfect: false, bountyDone: 1, unite: null });
    assert.equal(st.counters.atkRoundStacks, 1, '完成悬赏 → +1 层，即便不是完美作战');
    for (let i = 0; i < 20; i++) m.dispatch(ps, 'onBattleResult', { perfect: false, bountyDone: 1, unite: null });
    assert.equal(st.counters.atkRoundStacks, 10, '文案写「最多叠加 10 次」');
    m.dispose();
  });

  test('p39 仇名录：按「完成悬赏次数」叠攻击（0.2 + 0.2 × 次数，上限 10）', () => {
    const { m, ps } = carrier(annihilation());
    grantRelic(m, ps, 'p39');
    const st = relicState(ps);
    assert.equal(relicModsFor(ps).ally.atk, 0.2, '没完成过悬赏时只有基础 +20%');
    m.dispatch(ps, 'onBattleResult', { perfect: false, bountyDone: 1, unite: null });
    assert.equal(st.counters.bountyDone, 1, '完成一次悬赏记一次');
    assert.equal(st.counters.bountyKills, 1, 'p39 / 图鉴读的旧名（bountyKills）与 bountyDone 同值');
    assert.ok(Math.abs(relicModsFor(ps).ally.atk - 0.4) < 1e-9, '完成 1 次 → +20% +20%');
    for (let i = 0; i < 20; i++) m.dispatch(ps, 'onBattleResult', { perfect: false, bountyDone: 1, unite: null });
    assert.equal(st.counters.bountyDone, 21, '计数器本身不封顶');
    assert.ok(Math.abs(relicModsFor(ps).ally.atk - 2.2) < 1e-9, '叠层封顶 10：0.2 + 0.2 × 10 = 2.2（文案「最高+200%」）');
    m.dispose();
  });

  test('settle 把「完成悬赏」带进派发链：coins>0 或 bountyKills>0 都算一次，没有悬赏就不算', () => {
    const cases = [
      // [label, result, expected bountyDone, expected extra p34 stacks]
      ['悬赏资金入账', { leaked: [], perfect: true, coins: 3, bountyKills: 0, layerGains: {}, killed: 0, damageDealt: 0 }, 1, 1],
      ['悬赏目标被击杀但没结算到资金', { leaked: [], perfect: true, coins: 0, bountyKills: 2, layerGains: {}, killed: 0, damageDealt: 0 }, 1, 1],
      ['完美作战、没有悬赏', { leaked: [], perfect: true, coins: 0, bountyKills: 0, layerGains: {}, killed: 0, damageDealt: 0 }, 0, 0],
    ];
    for (const [label, r, done, stacks] of cases) {
      const { m, ps } = carrier(annihilation());
      grantRelic(m, ps, 'p34');
      grantRelic(m, ps, 'p12');
      const st = relicState(ps);
      st.counters.atkRoundStacks = 0;
      m.lastResults.set(ps.playerId, r);
      m.settle(null, null);
      assert.equal(st.counters.bountyDone || 0, done, `${label}: bountyDone`);
      assert.equal(st.counters.atkRoundStacks, stacks, `${label}: p34 额外叠层`);
      assert.equal(st.counters.survivorStacks || 0, 1, `${label}: p12 照样记一场（同一个载荷）`);
      m.dispose();
    }
  });

  test('p43 复得之轮：一次性装备用掉后补一件，每回合最多 3 次，下回合重置', () => {
    const { m, ps, unit } = carrier(annihilation());
    grantRelic(m, ps, 'p43');
    const st = relicState(ps);
    const itemId = consumeItems(m)[0];
    const handConsumables = () => ps.hand.filter((p) => p && p.kind === 'item' && consumeItems(m).includes(p.id)).length;
    assert.equal(handConsumables(), 0);
    for (let i = 0; i < 4; i++) {
      const piece = giveItem(m, ps, itemId);
      assert.deepEqual(ps.equip(piece.uid, unit.uid), { ok: true }, `第 ${i + 1} 次装备`);
      assert.equal(handConsumables(), Math.min(3, i + 1), `第 ${i + 1} 次用掉后补到 ${Math.min(3, i + 1)} 件（上限 3）`);
    }
    assert.equal(st.counters.refundRound, 3, '本回合已经补了 3 次');
    relicRoundStart(m, ps);
    assert.equal(st.counters.refundRound, 0, '新回合清零');
    const piece = giveItem(m, ps, itemId);
    assert.deepEqual(ps.equip(piece.uid, unit.uid), { ok: true });
    assert.equal(st.counters.refundRound, 1, '新回合又能补');
    m.dispose();
  });

  test('p44 果腹：一次性装备消耗后返还购买价，被动装备不返', () => {
    const { m, ps, unit } = carrier(annihilation());
    grantRelic(m, ps, 'p44');
    // 挑一件「装备时销毁但不碰资金」的，这样返还额就是商店价本身，不会被道具自己的效果干扰
    const itemId = consumeItems(m).find((id) => !/资金/.test(m.gd.raw.items[id].desc || ''));
    const price = m.gd.itemPrice(itemId);
    assert.ok(price > 0);
    ps.funds = 10;
    const before = ps.funds;
    const piece = giveItem(m, ps, itemId);
    assert.deepEqual(ps.equip(piece.uid, unit.uid), { ok: true });
    assert.equal(ps.funds - before, price, `返还 ${price} 资金（净免费）`);
    // 被动装备（不销毁）不该返
    const passiveId = Object.keys(m.gd.raw.items).find((id) => {
      const r = m.gd.raw.items[id];
      return !!(r && !r.isGolden && r.itemType === 'EQUIP' && r.kind === 'passive' && m.itemPool.canGain(id));
    });
    const beforePassive = ps.funds;
    const passive = giveItem(m, ps, passiveId);
    assert.deepEqual(ps.equip(passive.uid, unit.uid), { ok: true });
    assert.equal(ps.funds, beforePassive, '被动装备不会「消耗」，所以不返还');
    m.dispose();
  });

  // n09 酒神的印记（重铸）: v3.2.0 给它加了一条新负面「悬赏资金减半」（fx.postBountyMul 0.5）。代码路径本来就存在
  // （relicBountyMul 会乘 fx.postBountyMul），所以这两条钉的是「数据真的接上了」与「结算真的减半」，不是新逻辑。
  test('n09 酒神的印记（重铸）：悬赏资金减半（relicBountyMul = 0.5）', () => {
    const n09 = data.relics && data.relics.relics ? data.relics.relics.n09 : null;
    assert.ok(n09, 'n09 在 data/relics.json 里');
    assert.equal(n09.fx.postBountyMul, 0.5, '数据里 n09 带 postBountyMul 0.5');
    assert.ok(/悬赏资金减半/.test(n09.desc), '文案里有「悬赏资金减半」');
    const { m, ps } = carrier(annihilation());
    assert.equal(relicBountyMul(ps), 1, '没持有 n09 时悬赏资金不变');
    grantRelic(m, ps, 'n09');
    assert.equal(relicBountyMul(ps), 0.5, '持有 n09 时悬赏资金乘 0.5');
    m.dispose();
  });

  test('n09 酒神的印记（重铸）：有悬赏资金入账的结算把 pendingFunds 减半', () => {
    const bountyResult = () => ({ leaked: [], perfect: true, coins: 4, bountyKills: 0, layerGains: {}, killed: 0, damageDealt: 0 });
    // 对照组：同样一场悬赏、没有 n09 → 4 资金全额入账（证明减半是 n09 干的，不是 settle 变了）
    const plain = carrier(annihilation());
    const plainBefore = plain.ps.pendingFunds;
    plain.m.lastResults.set(plain.ps.playerId, bountyResult());
    plain.m.settle(null, null);
    assert.equal(plain.ps.pendingFunds - plainBefore, 4, '没有 n09：悬赏资金全额入账');
    plain.m.dispose();
    // n09 → 4 × 0.5 = 2（settle 走 Math.round，所以用偶数避免 .5 的取整歧义）
    const { m, ps } = carrier(annihilation());
    grantRelic(m, ps, 'n09');
    const before = ps.pendingFunds;
    m.lastResults.set(ps.playerId, bountyResult());
    m.settle(null, null);
    assert.equal(ps.pendingFunds - before, 2, '持有 n09：4 资金悬赏只入账 2');
    m.dispose();
  });
});

describe('湮灭模拟 · 房间到 Match（服务端链路）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: StubMatch }); });
  after(async () => { await srv?.close(); });

  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const join = async (name) => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); const w = await c.hello(name); c.id = w.playerId; return c; };

  test('room.create 收 erosion，room.state 发出来；只有房主能在开局前改', async () => {
    const host = await join('AnnHost');
    const guest = await join('AnnGuest');
    try {
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 });
      const st = await host.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.mode, 'coop');
      assert.equal(st.difficulty, ANNIHILATION_DIFFICULTY);
      assert.equal(st.erosion, 4, '房主选的档位就在房间状态里');

      await ok(guest, { t: 'room.join', code: st.code });
      const refused = await guest.request({ t: 'room.setErosion', level: 6 });
      assert.equal(refused.t, 'error', '非房主不能改蚀流');

      await ok(host, { t: 'room.setErosion', level: 5 });
      const after = await host.waitFor('room.state', (s) => s.erosion === 5, 4000);
      assert.equal(after.erosion, 5);

      const bad = await host.request({ t: 'room.setErosion', level: EROSION_MAX + 1 });
      assert.equal(bad.t, 'error', '越界档位被协议拒绝');
    } finally { await host.terminate().catch(() => {}); await guest.terminate().catch(() => {}); }
  });

  test('普通难度的房间不接受蚀流（它是玩法包的选项，不是全局设置）', async () => {
    const c = await join('NormalHost');
    try {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      const st = await c.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.erosion, undefined, '普通房间状态里没有 erosion 这个键');
      const r = await c.request({ t: 'room.setErosion', level: 4 });
      assert.equal(r.t, 'error', '普通房间改蚀流被拒绝');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('room.create 不带 erosion 的湮灭房默认蚀流 1（缺参不报错，但也不能是别的档）', async () => {
    const c = await join('DefaultHost');
    try {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY });
      const st = await c.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.erosion, 1);
    } finally { await c.terminate().catch(() => {}); }
  });
});
