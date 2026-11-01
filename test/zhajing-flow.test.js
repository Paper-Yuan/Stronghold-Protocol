// test/zhajing-flow.test.js — 炸惊模拟（ZHAJING）的**整链路整合**：真实 ws（server/index.js 起的服务器）+ 大厅 →
// 房间 → 开局 → 惊变草稿 → 选卡，以及「本体 / 湮灭不受影响」的反例。
//
// 与另外两份的分工：
//   * test/match/zhajing-room.test.js —— 建房那一段（难度不被降档、房间不能切进切出）；
//   * test/match/zhajing-e2e.test.js  —— 真实 **Match** 的引擎层一局打通（R1 → 结算）；
//   * 本文件 —— **平台层**：房间状态帧、开局帧、私密帧的**字段形状**，两个真人同房时各自的 m.private，
//     以及普通房 / 湮灭房走同一条链路时形状不变。
//
// 为什么平台层要单独钉：这一段每一环断掉都只是「帧里少一个键」——
//   * `room.create { difficulty:'ZHAJING' }` 被降档 → 房间静默退出玩法包，客户端只看到一张普通卡；
//   * `modeIdFor` 落到官方 modeId → 用官方模式跑炸惊数据（看起来能开，规则全错）；
//   * `m.private` 的 `jibian` 门写错 → 普通房长出玩法包的键（本体被污染），或炸惊房拿不到已选惊变；
//   * 房内 `setErosion` 没挡 → 炸惊房带上蚀流，`room.state.erosion` 凭空出现。
// 这些都不会抛异常，只是「键多了/少了」，所以断言全部落在**字段级**。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

const log = { info() {}, warn() {}, debug() {}, error() {} };
const ZJ = 'ZHAJING';
const NORMAL = 'NORMAL';
const ANN = 'ANNIHILATION';
/** 策略草稿的候选：队友选走的那一个再选会被拒（`bandTaken` → BAD_TARGET），所以按顺序试。 */
const BANDS = ['band_bldsk', 'band_amiya', 'band_duyaoy', 'band_sarkazb', 'band_orchid'];

/** 一个 ws 客户端的三件套：连接、hello（带 token，用于重连）、记下 playerId。 */
async function join(port, name, token) {
  const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
  const w = await c.hello(name, token);
  c.id = w.playerId;
  c.token = w.token;
  return c;
}
const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
  return r;
};
const err = async (c, msg, code) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'error', JSON.stringify(r));
  assert.equal(r.code, code, JSON.stringify(r));
  return r;
};
/** 下一个 room.state（带 code 的那一帧）。 */
const roomState = (c, pred = (s) => !!s.code, ms = 4000) => c.waitFor('room.state', pred, ms);

/**
 * 推着**真实 Match** 的对局往前走：从主客户端读广播的 `m.public`，按阶段自动应答
 * （INFO_CHECK → g.infoReady；BAND_DRAFT → 轮到谁就替谁 `g.band`），`onSp` 决定惊变草稿怎么选。
 * `until(pub)` 成立时返回那一帧。
 * @param {any[]} clients 这个房间里的真人客户端（第一个当「广播读取端」）
 */
async function pump(clients, until, { onSp = null, timeout = 25000 } = {}) {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const primary = clients[0];
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    if (until(last)) return last;
    const pub = await primary.waitFor('m.public', () => true, Math.max(250, deadline - Date.now())).catch(() => null);
    if (!pub) break;
    last = pub;
    if (pub.phase === 'INFO_CHECK') {
      for (const c of clients) await c.request({ t: 'g.infoReady' });
    } else if (pub.phase === 'BAND_DRAFT' && pub.draft && byId.has(pub.draft.turn)) {
      // 队友已经选走的策略不能再选（phases.pickBand → bandTaken → BAD_TARGET），所以按顺序试到被接受为止
      const c = byId.get(pub.draft.turn);
      for (const bandId of BANDS) {
        const r = await c.request({ t: 'g.band', bandId });
        if (r.t === 'ok') break;
      }
    } else if (pub.phase === 'SP_DRAFT' && pub.sp && byId.has(pub.sp.turn) && onSp) {
      await onSp(byId.get(pub.sp.turn), pub);
    }
    if (until(last)) return last;
  }
  assert.ok(until(last), `没等到目标状态（最后一帧：${last ? `${last.phase} R${last.round}` : '无'}）`);
  return last;
}

// ── 1. 平台层：房间 / 开局 / 拒绝 / 重连（StubMatch：帧形状确定，没有引擎噪声）──────────────────────────────
describe('炸惊模拟 · 整链路（ws 平台层，StubMatch）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: StubMatch }); });
  after(async () => { await srv?.close(); });
  const conn = (name, token) => join(srv.port, name, token);

  test('建房：单人 / 同盟都能建 ZHAJING 房，room.state 带 difficulty、不带 erosion', async () => {
    const solo = await conn('ZjSolo');
    const coop = await conn('ZjCoop');
    try {
      await ok(solo, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      const s = await roomState(solo);
      assert.equal(s.mode, 'solo');
      assert.equal(s.difficulty, ZJ, '难度原样保留（降档会静默退出玩法包）');
      assert.equal(Object.hasOwn(s, 'erosion'), false, '炸惊没有蚀流：房间状态不长出 erosion 键');
      assert.equal(s.seats.length, 4, '座位槽数组仍是 4 个');
      assert.equal(s.seats.filter(Boolean).length, 1, '单人房只有 1 个占用座位');
      assert.equal(s.inMatch, false);
      assert.equal(s.hostId, solo.id, '建房者是房主');

      await ok(coop, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const c = await roomState(coop);
      assert.equal(c.mode, 'coop');
      assert.equal(c.difficulty, ZJ);
      assert.equal(Object.hasOwn(c, 'erosion'), false, '同盟炸惊房同样没有 erosion');
      assert.ok(c.seats.length >= 4, '同盟房 4 个座位');
    } finally {
      await solo.terminate().catch(() => {});
      await coop.terminate().catch(() => {});
    }
  });

  test('开局：room.ready + room.start → m.public 的 modeId 是 mode_{single,multi}_zhajing', async () => {
    const soloHost = await conn('ZjStartHost');
    const coopHost = await conn('ZjStartCoop');
    const mate = await conn('ZjStartMate');
    try {
      // 单人
      await ok(soloHost, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      const st = await roomState(soloHost);
      await ok(soloHost, { t: 'room.ready', ready: true });
      const s1 = await roomState(soloHost, (s) => s.seats.some((x) => x && x.playerId === soloHost.id && x.ready === true));
      assert.equal(s1.code, st.code);
      await ok(soloHost, { t: 'room.start' });
      const pub = await soloHost.waitFor('m.public', () => true, 8000);
      assert.equal(pub.phase, 'INFO_CHECK');
      assert.equal(pub.modeId, 'mode_single_zhajing', 'modeIdFor(solo, ZHAJING) 推导出的玩法包模式');
      assert.equal(pub.difficulty, ZJ);
      assert.equal(pub.stub, true, '这个 describe 用的是 StubMatch');
      const priv = await soloHost.waitFor('m.private', () => true, 4000);
      assert.equal(priv.playerId, soloHost.id);
      assert.equal(priv.seat, 0);

      // 同盟（两真人）—— 一个 client 一场对局，所以换一对客户端
      await ok(coopHost, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const st2 = await roomState(coopHost);
      assert.equal(st2.mode, 'coop');
      await ok(mate, { t: 'room.join', code: st2.code });
      await roomState(mate, (s) => s.seats.filter(Boolean).length === 2);
      await ok(coopHost, { t: 'room.ready', ready: true });
      await ok(mate, { t: 'room.ready', ready: true });
      await ok(coopHost, { t: 'room.start' });
      const pub2 = await coopHost.waitFor('m.public', () => true, 8000);
      assert.equal(pub2.modeId, 'mode_multi_zhajing');
      assert.equal(pub2.difficulty, ZJ);
      assert.deepEqual(pub2.players.map((p) => p.playerId).sort(), [coopHost.id, mate.id].sort(), '两个真人都在开局帧里');
      assert.deepEqual(pub2.players.map((p) => p.seat).sort(), [0, 1], '座位 0 / 1');
    } finally {
      await soloHost.terminate().catch(() => {});
      await coopHost.terminate().catch(() => {});
      await mate.terminate().catch(() => {});
    }
  });

  test('房内拒绝：setErosion → BAD_MSG、setMode(玩法包 modeId) → BAD_TARGET、难度枚举进不了协议', async () => {
    // 同盟房：这样第二个客户端能进来，用它收到的 room.state 证明「被拒的请求什么都没改」
    const host = await conn('ZjRefuse');
    const witness = await conn('ZjWitness');
    try {
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const before = await roomState(host);
      // 蚀流是湮灭的选项：炸惊房由 lobby 明确拒绝（协议层放行 1..6，所以是业务错误码 BAD_MSG）
      const e = await err(host, { t: 'room.setErosion', level: 3 }, 'BAD_MSG');
      assert.match(String(e.detail || ''), /erosion/i, 'lobby 的理由：erosion is an annihilation option');
      // setMode: 炸惊房的模式也锁了（2026-10-28 晚的玩法包锁）→ BAD_TARGET，理由由 lobby 给
      const m = await err(host, { t: 'room.setMode', modeId: 'mode_single_zhajing' }, 'BAD_TARGET');
      assert.match(String(m.detail || ''), /play set locks the room mode|not a mode of this room/);
      // 难度是协议层的官方四档枚举：ZHAJING 根本不是合法字段值 → BAD_MSG（连 lobby 都到不了）
      const d = await err(host, { t: 'room.setDifficulty', difficulty: ZJ }, 'BAD_MSG');
      assert.match(String(d.detail || ''), /difficulty/, '协议层拒绝：bad field difficulty');
      // 房间没被这些被拒的请求改动：另一个客户端加入，读它收到的 room.state
      await ok(witness, { t: 'room.join', code: before.code });
      const after = await roomState(witness, (s) => s.seats.filter(Boolean).length === 2, 4000);
      assert.equal(after.difficulty, ZJ, '被拒的 setDifficulty 没有改难度');
      assert.equal(after.mode, 'coop');
      assert.equal(Object.hasOwn(after, 'erosion'), false, '被拒的 setErosion 没有长出 erosion 键');
    } finally {
      await host.terminate().catch(() => {});
      await witness.terminate().catch(() => {});
    }
  });

  test('同盟炸惊房：两个真人各自的 m.private 归各自座位，不串', async () => {
    const a = await conn('ZjSeatA');
    const b = await conn('ZjSeatB');
    try {
      await ok(a, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const st = await roomState(a);
      await ok(b, { t: 'room.join', code: st.code });
      await roomState(b, (s) => s.seats.filter(Boolean).length === 2);
      await ok(a, { t: 'room.ready', ready: true });
      await ok(b, { t: 'room.ready', ready: true });
      await ok(a, { t: 'room.start' });
      const pa = await a.waitFor('m.private', () => true, 8000);
      const pb = await b.waitFor('m.private', () => true, 8000);
      assert.equal(pa.playerId, a.id, 'A 收到的私密帧是 A 的');
      assert.equal(pb.playerId, b.id, 'B 收到的私密帧是 B 的');
      assert.notEqual(pa.seat, pb.seat);
      assert.deepEqual([pa.seat, pb.seat].sort(), [0, 1]);
      assert.deepEqual(pa.board, [], '各自空棋盘');
      assert.deepEqual(pb.board, []);
    } finally {
      await a.terminate().catch(() => {});
      await b.terminate().catch(() => {});
    }
  });

  test('反例：普通 / 湮灭 / 炸惊三种房走同一条链路，room.state 形状只差 erosion 这一个键', async () => {
    const n = await conn('ShapeNormal');
    const ann = await conn('ShapeAnn');
    const zj = await conn('ShapeZj');
    try {
      await ok(n, { t: 'room.create', mode: 'solo', difficulty: NORMAL });
      const sn = await roomState(n);
      await ok(ann, { t: 'room.create', mode: 'solo', difficulty: ANN, erosion: 4 });
      const sa = await roomState(ann);
      await ok(zj, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      const sz = await roomState(zj);

      // 值
      assert.equal(sn.difficulty, NORMAL);
      assert.equal(sa.difficulty, ANN);
      assert.equal(sa.erosion, 4, '湮灭房照旧发布所选档位');
      assert.equal(sz.difficulty, ZJ);
      assert.equal(Object.hasOwn(sn, 'erosion'), false, '普通房没有 erosion');
      assert.equal(Object.hasOwn(sz, 'erosion'), false, '炸惊房没有 erosion');
      // 键集合（三种房型的**全部**差异，别再往下加）：
      //   官方四档  ：——（基准）
      //   炸惊      ：+ version + versionLocked   （业主 2026-10-28：玩法包房的版本由模式锁死，大厅默认改动不影响它）
      //   湮灭      ：+ erosion + annMods + version + versionLocked（同上 + 蚀流档位 + 八个 mod 开关）
      // 版本锁只在玩法包房出现：官方房**既不 version 也不 versionLocked**（默认版本下它本来就不发 version）。
      const keys = (s) => Object.keys(s).sort();
      assert.deepEqual(keys(sz), [...keys(sn), 'version', 'versionLocked'].sort(), '炸惊房只多 version 与 versionLocked');
      assert.deepEqual(keys(sa), [...keys(sn), 'erosion', 'annMods', 'version', 'versionLocked'].sort(), '湮灭房只多 erosion / annMods / version / versionLocked');
      // 玩法包房恒发锁死的版本；官方房不长这两个键
      assert.equal(sz.versionLocked, true, '炸惊房的版本是锁死的');
      assert.equal(sa.versionLocked, true, '湮灭房的版本同样是锁死的');
      assert.equal(typeof sz.version, 'string', '炸惊房总是带上锁死后的版本值');
      assert.equal(typeof sa.version, 'string', '湮灭房同样');
      assert.equal(Object.hasOwn(sn, 'version'), false, '官方房默认版本下不发 version（逐字节不变）');
      assert.equal(Object.hasOwn(sn, 'versionLocked'), false, '官方房不长 versionLocked');
      // mode 都不变
      assert.deepEqual([sn.mode, sa.mode, sz.mode], ['solo', 'solo', 'solo']);
    } finally {
      await n.terminate().catch(() => {});
      await ann.terminate().catch(() => {});
      await zj.terminate().catch(() => {});
    }
  });

  test('炸惊房锁定难度（BAD_TARGET），湮灭房仍可改回官方难度（只锁玩法包，不动湮灭）', async () => {
    // 2026-10-28 晚业主口径：「炸惊锁定难度锁定卡池」→ 炸惊房的难度在 room.create 时确定，房内改不了
    // （server/lobby.js 的 setDifficulty 门）。湮灭房**故意不动**：它的 setDifficulty 仍可把房间改回官方难度，
    // 这是既有规则，本轮只锁炸惊（`docs/EXTENSION_MODE.md §8`）。
    const zj = await conn('DowngradeZj');
    const ann = await conn('DowngradeAnn');
    try {
      await ok(zj, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      const sz0 = await roomState(zj);
      const lock = await err(zj, { t: 'room.setDifficulty', difficulty: NORMAL }, 'BAD_TARGET');
      assert.match(String(lock.detail || ''), /play-set room is locked|locked/);
      // a refused change broadcasts nothing (there is nothing new to send), so the state captured before the message is
      // the state after it: the room is still 炸惊 and its shape is unchanged.
      assert.equal(sz0.difficulty, ZJ, '被拒之后房间仍是炸惊');
      assert.equal(Object.hasOwn(sz0, 'erosion'), false);

      await ok(ann, { t: 'room.create', mode: 'solo', difficulty: ANN, erosion: 5 });
      await roomState(ann);
      await ok(ann, { t: 'room.setDifficulty', difficulty: NORMAL });
      const sa = await roomState(ann, (s) => s.difficulty === NORMAL);
      assert.equal(sa.difficulty, NORMAL);
      assert.equal(Object.hasOwn(sa, 'erosion'), false, '离开湮灭后档位键消失（内部值仍保留）');
    } finally {
      await zj.terminate().catch(() => {});
      await ann.terminate().catch(() => {});
    }
  });

  test('断线重连：同一个 token 回到同一个 playerId，房间状态与开局帧都还能拿到', async () => {
    const host = await conn('ZjResume');
    const mate = await conn('ZjResumeMate');
    let back = null;
    try {
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const st = await roomState(host);
      await ok(mate, { t: 'room.join', code: st.code });
      await roomState(mate, (s) => s.seats.filter(Boolean).length === 2);
      await ok(host, { t: 'room.ready', ready: true });
      await ok(mate, { t: 'room.ready', ready: true });
      await ok(host, { t: 'room.start' });
      await host.waitFor('m.public', () => true, 8000);

      await host.terminate();
      back = await conn('ZjResume', host.token);
      assert.equal(back.id, host.id, 'token 换回同一个 playerId');
      assert.equal(back.token, host.token);
      const st2 = await roomState(back, (s) => !!s.code, 6000);
      assert.equal(st2.code, st.code, '还是那个房间');
      assert.equal(st2.inMatch, true, '对局还在进行');
      assert.equal(st2.difficulty, ZJ);
      assert.equal(Object.hasOwn(st2, 'erosion'), false);
      const pub = await back.waitFor('m.public', () => true, 6000);
      assert.equal(pub.modeId, 'mode_multi_zhajing', '重连后立刻补一份 m.public');
      const priv = await back.waitFor('m.private', () => true, 4000);
      assert.equal(priv.playerId, back.id);
    } finally {
      await host.terminate().catch(() => {});
      await back?.terminate().catch(() => {});
      await mate.terminate().catch(() => {});
    }
  });
});

// ── 2. 真实 Match：m.private 的 jibian 门 + R1 惊变草稿与选卡（ws 全程）────────────────────────────────────
describe('炸惊模拟 · 整链路（ws + 真实 Match）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log }); });
  after(async () => { await srv?.close(); });
  const conn = (name, token) => join(srv.port, name, token);

  test('m.private 的 jibian 只出现在炸惊房：普通房根本没有这个键', async () => {
    const zj = await conn('ZjPrivate');
    const nm = await conn('NmPrivate');
    try {
      await ok(zj, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      await roomState(zj);
      await ok(zj, { t: 'room.ready', ready: true });
      await ok(zj, { t: 'room.start' });
      const zpriv = await zj.waitFor('m.private', () => true, 15000);
      // 真实 Match 的 m.private.jibian（server/match/player/views.js：`gd.zhajing ? { jibian: jibianView() } : {}`）
      assert.ok(zpriv.jibian, '炸惊房的 m.private 带 jibian');
      assert.deepEqual(Object.keys(zpriv.jibian).sort(), ['cards', 'owned', 'rerollsLeft'], '字段集：cards / owned / rerollsLeft');
      assert.deepEqual(zpriv.jibian.owned, []);
      assert.deepEqual(zpriv.jibian.cards, []);
      assert.equal(zpriv.jibian.rerollsLeft, 0, '此刻不在惊变草稿里，重抽次数 0');

      await ok(nm, { t: 'room.create', mode: 'solo', difficulty: NORMAL });
      await roomState(nm);
      await ok(nm, { t: 'room.ready', ready: true });
      await ok(nm, { t: 'room.start' });
      const npriv = await nm.waitFor('m.private', () => true, 15000);
      assert.equal(Object.hasOwn(npriv, 'jibian'), false, '普通房的 m.private 不长出玩法包的键');
      assert.equal(npriv.jibian, undefined);
      const npub = await nm.waitFor('m.public', () => true, 4000);
      assert.equal(Object.hasOwn(npub, 'jibian'), false);
      assert.equal(Object.hasOwn(npub, 'enemyJibian'), false, '普通房的 m.public 也没有敌方惊变');
      assert.equal(npub.modeId, 'mode_single_normal');
    } finally {
      await zj.terminate().catch(() => {});
      await nm.terminate().catch(() => {});
    }
  });

  test('真实 Match 的 R1 惊变草稿经 ws 广播，g.choice 选卡落地到 m.private.jibian', async () => {
    const c = await conn('ZjDraft');
    try {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: ZJ });
      await roomState(c);
      await ok(c, { t: 'room.ready', ready: true });
      await ok(c, { t: 'room.start' });
      // INFO_CHECK → 选策略 → R1：惊变草稿（3 选 1，family jibian）
      const pub = await pump([c], (p) => !!p && p.phase === 'SP_DRAFT');
      assert.equal(pub.round, 1, 'R1 是惊变回合（config spPhaseKinds[1] = jibian）');
      assert.equal(pub.modeId, 'mode_single_zhajing');
      assert.equal(pub.difficulty, ZJ);
      assert.equal(pub.spRound, true);
      assert.ok(pub.sp, 'm.public 带着草稿');
      assert.equal(pub.sp.family, 'jibian', '惊变家族');
      assert.equal(pub.sp.cards.length, 3, '3 选 1');
      assert.equal(pub.sp.turn, c.id, '单人局轮到唯一的人类座位');
      const card = pub.sp.cards[1];
      assert.ok(card && card.id, '第二张卡');
      assert.equal(card.kind, 'jibian');
      assert.ok(card.rarity, '卡面带品质');

      // 选卡：既有消息 g.choice { idx }
      await ok(c, { t: 'g.choice', idx: 1 });
      const priv = await c.waitFor('m.private', (m) => m.jibian && m.jibian.owned.length === 1, 8000);
      assert.deepEqual(priv.jibian.owned, [card.id], 'owned 就是刚选的那张');
      assert.equal(priv.jibian.cards.length, 1);
      assert.equal(priv.jibian.cards[0].id, card.id);
      assert.equal(priv.jibian.cards[0].rarity, card.rarity, '品质随卡进 m.private');
      // 单人局只有一个人：选完这一轮草稿就关掉，帧里不再带 sp（同盟局才停在原地等队友）
      const closed = await c.waitFor('m.public', (m) => m.phase !== 'SP_DRAFT', 12000);
      assert.equal(closed.sp, undefined, '草稿关闭后 m.public 不再下发 sp');
    } finally {
      await c.terminate().catch(() => {});
    }
  });

  test('同盟炸惊（真实 Match）：两个真人各自拿到一手 3 张，选卡互不串', async () => {
    const a = await conn('ZjDraftA');
    const b = await conn('ZjDraftB');
    try {
      await ok(a, { t: 'room.create', mode: 'coop', difficulty: ZJ });
      const st = await roomState(a);
      await ok(b, { t: 'room.join', code: st.code });
      await roomState(b, (s) => s.seats.filter(Boolean).length === 2);
      await ok(a, { t: 'room.ready', ready: true });
      await ok(b, { t: 'room.ready', ready: true });
      await ok(a, { t: 'room.start' });
      const pub = await pump([a, b], (p) => !!p && p.phase === 'SP_DRAFT');
      assert.equal(pub.modeId, 'mode_multi_zhajing');
      assert.equal(pub.sp.family, 'jibian');
      assert.equal(pub.sp.cards.length, 3, '每人一手 3 张（不是「两人共 3 张」）');
      const first = pub.sp.turn;
      const firstClient = first === a.id ? a : b;
      const secondClient = first === a.id ? b : a;
      const picked = pub.sp.cards[0].id;
      await ok(firstClient, { t: 'g.choice', idx: 0 });
      const privFirst = await firstClient.waitFor('m.private', (m) => m.jibian && m.jibian.owned.length === 1, 8000);
      assert.deepEqual(privFirst.jibian.owned, [picked]);
      // 换人：下一位自己的一手 3 张，且不含上一位选走的卡
      const next = await pump([a, b], (p) => !!p && p.phase === 'SP_DRAFT' && p.sp && p.sp.turn !== first, { onSp: null });
      assert.equal(next.sp.turn, secondClient.id, '轮到另一个真人');
      assert.equal(next.sp.cards.length, 3, '换人换手牌');
      assert.ok(!next.sp.cards.some((x) => x.id === picked), '甲选走的卡不在乙的 3 张里');
      const privSecond = await secondClient.waitFor('m.private', (m) => !!m.jibian, 8000);
      assert.deepEqual(privSecond.jibian.owned, [], '乙还没选，owned 仍是空');
      const idx = next.sp.cards.findIndex((x) => x.idx != null);
      await ok(secondClient, { t: 'g.choice', idx: Math.max(0, idx) });
      const privSecond2 = await secondClient.waitFor('m.private', (m) => m.jibian && m.jibian.owned.length === 1, 8000);
      assert.equal(privSecond2.jibian.owned.length, 1);
      assert.notDeepEqual(privSecond2.jibian.owned, privFirst.jibian.owned, '两张是不同的卡');
    } finally {
      await a.terminate().catch(() => {});
      await b.terminate().catch(() => {});
    }
  });
});
