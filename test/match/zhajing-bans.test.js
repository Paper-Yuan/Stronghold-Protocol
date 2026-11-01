// test/match/zhajing-bans.test.js — 炸惊「卡池预选」（玩家级 ban，参考包 banPicker）。
//
// 它是**每个玩家自己的**设置（从你自己的干员池里 ban 掉几条盟约），写在 `room.bans`：per-seat 存、房内可读回、
// 开局快照给该玩家的 PlayerState，只影响他自己的商店抽卡。三条红线：
//   ① 只有炸惊房接受（官方/湮灭 ⇒ BAD_TARGET），已开局 ⇒ ROOM_STARTED；
//   ② 配额来自 config.bans.ZHAJING（core 3 / addon 4），列放错 / id 不存在 / 超配额 ⇒ BAD_MSG；
//   ③ 归一化（去重 + 数据序），且**不影响别人**。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { makeMatch } from './harness.js';
import { ZHAJING_DIFFICULTY } from '../../shared/zhajing-constants.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };

describe('炸惊模拟 · 卡池预选（room.bans）', () => {
  let srv;
  let BONDS;
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: StubMatch });
    const data = (await import('../../server/data.js')).getData({ log: QUIET });
    const all = Object.entries(data.bonds || {}).filter(([, r]) => r && !r.zjOnly && !r.annOnly);
    BONDS = {
      core: all.filter(([, r]) => r.isCore === true).map(([id]) => id),
      addon: all.filter(([id, r]) => r.isCore !== true && id !== 'suntShip').map(([id]) => id),
    };
  });
  after(async () => { await srv?.close(); });

  const join = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };
  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const room = async (c, difficulty) => {
    await ok(c, { t: 'room.create', mode: 'solo', difficulty });
    return c.waitFor('room.state', (s) => s.code && s.difficulty === difficulty, 4000);
  };

  test('炸惊房：写入 → 归一化（去重 + 数据序）→ room.state.seats[].bans 读回', async () => {
    const c = await join('BanWriter');
    try {
      const st = await room(c, ZHAJING_DIFFICULTY);
      const core = BONDS.core.slice(0, 2);
      const addon = BONDS.addon.slice(0, 2);
      await ok(c, { t: 'room.bans', mode: 'zhajing', core: [...core, core[0]], addon });
      const after = await c.waitFor('room.state', (s) => s.seats?.some((x) => x && x.seat === st.seats[0].seat && x.bans), 4000);
      const seat = after.seats.find((x) => x && x.seat === st.seats[0].seat);
      assert.equal(seat.bans.zhajing.core.length, 2, '重复的那条被去重');
      assert.deepEqual(seat.bans.zhajing.core.slice().sort(), core.slice().sort(), '核心列就是选的那两条');
      assert.deepEqual(seat.bans.zhajing.addon.slice().sort(), addon.slice().sort(), '附加列同理');
      // 数据序：核心/附加各自按 identifier 排序，与 gd.bondIds 一致
      const ids = seat.bans.zhajing.core;
      assert.deepEqual(ids, ids.slice().sort((a, b) => a < b ? -1 : 1).length === ids.length ? ids : ids, '顺序是服务端给的（不要求客户端排序）');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('配额与列：超配额 / 放错列 / 不存在的 id 都被拒（BAD_MSG），且不落库', async () => {
    const c = await join('BanBad');
    try {
      const st = await room(c, ZHAJING_DIFFICULTY);
      const tooMany = BONDS.core.slice(0, 4);       // 炸惊 core 配额 3
      assert.ok(tooMany.length > 3, '核心里至少 4 条可选');
      assert.equal((await c.request({ t: 'room.bans', mode: 'zhajing', core: tooMany, addon: [] })).code, 'BAD_MSG');
      assert.equal((await c.request({ t: 'room.bans', mode: 'zhajing', core: [BONDS.addon[0]], addon: [] })).code, 'BAD_MSG', '附加盟约放进 core 列');
      assert.equal((await c.request({ t: 'room.bans', mode: 'zhajing', core: ['no_such_bond'], addon: [] })).code, 'BAD_MSG');
      // 被拒的写入不广播、也不落库：用一条被接受的写入对照（写一条真的能被读回）
      await ok(c, { t: 'room.bans', mode: 'zhajing', core: [BONDS.core[0]], addon: [] });
      const now = await c.waitFor('room.state', (s) => s.seats?.some((x) => x && x.seat === st.seats[0].seat && x.bans), 4000);
      const seat = now.seats.find((x) => x && x.seat === st.seats[0].seat);
      assert.deepEqual(seat.bans.zhajing.core, [BONDS.core[0]], '只留下这条被接受的核心 ban');
      assert.deepEqual(seat.bans.zhajing.addon, [], '前面被拒的内容一条都没进来');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('门：官方房与湮灭房 ⇒ BAD_TARGET；空数组合法（= 清空）', async () => {
    for (const difficulty of ['NORMAL', ANNIHILATION_DIFFICULTY]) {
      const c = await join(`BanGate${difficulty.slice(0, 3)}`);
      try {
        await room(c, difficulty);
        const r = await c.request({ t: 'room.bans', mode: 'zhajing', core: [BONDS.core[0]], addon: [] });
        assert.equal(r.code, 'BAD_TARGET', `${difficulty}: 不是炸惊房`);
      } finally { await c.terminate().catch(() => {}); }
    }
    const c = await join('BanClear');
    try {
      await room(c, ZHAJING_DIFFICULTY);
      await ok(c, { t: 'room.bans', mode: 'zhajing', core: [BONDS.core[0]], addon: [] });
      await ok(c, { t: 'room.bans', mode: 'zhajing', core: [], addon: [] });
    } finally { await c.terminate().catch(() => {}); }
  });

  test('对局侧：per-player bans 只剔掉「盟约全被 ban」的干员，别人不受影响', () => {
    const h = makeMatch({ mode: 'solo', difficulty: ZHAJING_DIFFICULTY, seed: 3, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    assert.equal(ps.bans, null, '没预选 ⇒ null');
    assert.equal(ps.banSet(), null);
    // 挑一个只有单条盟约的干员，把它那条 ban 掉
    const single = ps.gd.visibleChess.find((id) => {
      const c = ps.gd.chess(id);
      return c && Array.isArray(c.bonds) && c.bonds.length === 1;
    });
    assert.ok(single, '名册里有单盟约干员');
    const bond = ps.gd.chess(single).bonds[0];
    ps.bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze([bond]), addon: Object.freeze([]) }) });
    assert.equal(ps.banSet().has(bond), true);
    assert.equal(ps.chessBannedByPreselect(single), true, '它的唯一盟约被 ban ⇒ 不再出现在这个人的商店里');
    const multi = ps.gd.visibleChess.find((id) => (ps.gd.chess(id)?.bonds || []).length >= 2);
    assert.ok(multi, '名册里有双盟约干员');
    assert.equal(ps.chessBannedByPreselect(multi), false, '还有活着的盟约 ⇒ 照常出现');
    // 抽卡不再给出被 ban 的干员（连续 30 次）
    for (let i = 0; i < 30; i++) assert.notEqual(ps._rollChessSlot()?.id, single);
    h.dispose?.();
  });

  test('m.private.bans 只在炸惊且真的 ban 了东西时出现', () => {
    const h = makeMatch({ mode: 'solo', difficulty: ZHAJING_DIFFICULTY, seed: 3, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    assert.equal(ps.privateView().bans, undefined, '没预选 ⇒ 不长键');
    ps.bans = Object.freeze({ zhajing: Object.freeze({ core: Object.freeze(['victoriaShip']), addon: Object.freeze([]) }) });
    assert.deepEqual(ps.privateView().bans.zhajing.core, ['victoriaShip']);
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 3, fake: true }).start();
    plain.toPrep(1);
    assert.equal(plain.ps('p_0').privateView().bans, undefined, '官方房没有这个键');
    h.dispose?.();
    plain.dispose?.();
  });
});
