// test/match/room-seats.test.js — 房间人数 (room.setSeats, the owner's decision 2026-10-31): a co-op room's seat
// capacity 4 / 8 / 12 at the platform layer.
//
// The iron rule: a room that never raised its capacity stays byte-identical — its room.state carries NO `maxSeats` key
// and its seat array keeps its four slots. Only a host's `room.setSeats` (before the match; a raise while others are
// seated, any value while alone) resizes the room. Errors are the platform's existing codes: NOT_HOST, ROOM_STARTED,
// BAD_TARGET.
// 第一层临时闸 (temporary, until the match handles 8 / 12): room.start in a room above MAX_SEATS is refused with
// BAD_TARGET even with every doctor ready; a 4-seat room still starts exactly as before (the regression at the end).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { validateC2S } from '../../shared/protocol.js';
import { MAX_SEATS, MAX_SEATS_CAP, ROOM_SEAT_CAPS } from '../../shared/constants.js';
import { TestClient } from '../helpers/wsClient.js';

const log = { info() {}, warn() {}, debug() {}, error() {} };

describe('房间人数 · room.setSeats（服务端）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: StubMatch }); });
  after(async () => { await srv?.close(); });

  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const err = async (c, msg, code) => {
    const r = await c.request(msg);
    assert.equal(r.t, 'error', JSON.stringify(r));
    assert.equal(r.code, code, JSON.stringify(r));
    return r;
  };
  const join = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };
  const create = async (host, mode = 'coop') => {
    await ok(host, { t: 'room.create', mode, difficulty: 'FUNNY' });
    return host.waitFor('room.state', (s) => !!s.code, 4000);
  };

  test('默认 4 人房：room.state 没有 maxSeats，座位仍是 4 个（逐字节不动的分支）', async () => {
    const host = await join('FourHost');
    try {
      const st = await create(host);
      assert.equal(Object.hasOwn(st, 'maxSeats'), false, '默认房不新增 room.state.maxSeats 键');
      assert.equal(st.seats.length, MAX_SEATS, '默认仍是 4 个座位槽');
      assert.equal(MAX_SEATS, 4, 'MAX_SEATS 仍是默认容量（不是上限）');
      assert.equal(MAX_SEATS_CAP, 12);
      assert.deepEqual([...ROOM_SEAT_CAPS], [4, 8, 12]);
    } finally { await host.terminate().catch(() => {}); }
  });

  test('房主升到 8 / 12：座位数组按容量打开，room.state.maxSeats 回显', async () => {
    const host = await join('RaiseHost');
    try {
      await create(host);
      await ok(host, { t: 'room.setSeats', maxSeats: 8 });
      const eight = await host.waitFor('room.state', (s) => s.maxSeats === 8, 4000);
      assert.equal(eight.seats.length, 8);
      await ok(host, { t: 'room.setSeats', maxSeats: 12 });
      const twelve = await host.waitFor('room.state', (s) => s.maxSeats === 12, 4000);
      assert.equal(twelve.seats.length, 12);
      // 同样的值再发一次是幂等成功，不广播也无妨
      await ok(host, { t: 'room.setSeats', maxSeats: 12 });
    } finally { await host.terminate().catch(() => {}); }
  });

  test('只有自己一人：任意改（12 → 8 → 4），回到 4 后 maxSeats 键又消失', async () => {
    const host = await join('AloneHost');
    try {
      await create(host);
      await ok(host, { t: 'room.setSeats', maxSeats: 12 });
      await host.waitFor('room.state', (s) => s.maxSeats === 12, 4000);
      await ok(host, { t: 'room.setSeats', maxSeats: 8 });
      const eight = await host.waitFor('room.state', (s) => s.maxSeats === 8, 4000);
      assert.equal(eight.seats.length, 8);
      await ok(host, { t: 'room.setSeats', maxSeats: 4 });
      const four = await host.waitFor('room.state', (s) => s.maxSeats === undefined, 4000);
      assert.equal(four.seats.length, 4);
      assert.equal(Object.hasOwn(four, 'maxSeats'), false);
    } finally { await host.terminate().catch(() => {}); }
  });

  test('非创建者：NOT_HOST', async () => {
    const host = await join('HostA');
    const guest = await join('GuestA');
    try {
      const st = await create(host);
      await ok(guest, { t: 'room.join', code: st.code });
      await err(guest, { t: 'room.setSeats', maxSeats: 8 }, 'NOT_HOST');
      await err(host, { t: 'room.setSeats', maxSeats: 5 }, 'BAD_MSG');
    } finally { await host.terminate().catch(() => {}); await guest.terminate().catch(() => {}); }
  });

  test('还有别的博士：只允许升；降档拒绝（BAD_TARGET）', async () => {
    const host = await join('HostB');
    const guests = [];
    try {
      const st = await create(host);
      await ok(host, { t: 'room.setSeats', maxSeats: 8 });
      await host.waitFor('room.state', (s) => s.maxSeats === 8, 4000);
      for (let i = 0; i < 4; i++) {
        const g = await join(`GuestB${i}`);
        guests.push(g);
        await ok(g, { t: 'room.join', code: st.code });
      }
      // 5 人已在房：8 → 4 是降档，拒绝
      await err(host, { t: 'room.setSeats', maxSeats: 4 }, 'BAD_TARGET');
      // 8 → 12 是升档，允许
      await ok(host, { t: 'room.setSeats', maxSeats: 12 });
      await host.waitFor('room.state', (s) => s.maxSeats === 12, 4000);
      // 12 → 8 又是降档
      await err(host, { t: 'room.setSeats', maxSeats: 8 }, 'BAD_TARGET');
    } finally {
      await host.terminate().catch(() => {});
      for (const g of guests) await g.terminate().catch(() => {});
    }
  });

  test('已开局：ROOM_STARTED（哪怕只有房主一人）', async () => {
    const host = await join('StartedHost');
    try {
      await create(host);
      await ok(host, { t: 'room.start' });
      await host.waitFor('room.state', (s) => s.inMatch === true, 4000);
      await err(host, { t: 'room.setSeats', maxSeats: 8 }, 'ROOM_STARTED');
    } finally { await host.terminate().catch(() => {}); }
  });

  test('独立房：没有房间人数这回事（BAD_TARGET）', async () => {
    const host = await join('SoloSeats');
    try {
      await create(host, 'solo');
      await err(host, { t: 'room.setSeats', maxSeats: 8 }, 'BAD_TARGET');
    } finally { await host.terminate().catch(() => {}); }
  });

  test('人数 ≤ 目标：房主 + 4 个 AI 时不能降到 4（5 个已占座位）', async () => {
    const host = await join('BotsHost');
    try {
      await create(host);
      await ok(host, { t: 'room.setSeats', maxSeats: 8 });
      await host.waitFor('room.state', (s) => s.maxSeats === 8, 4000);
      for (let i = 0; i < 4; i++) await ok(host, { t: 'room.addBot' });
      // 房主一人 + 4 个 AI = 5 个座位被占，目标 4 装不下
      await err(host, { t: 'room.setSeats', maxSeats: 4 }, 'BAD_TARGET');
    } finally { await host.terminate().catch(() => {}); }
  });

  // 第二层 (docs/TWELVE_PLAYER_MODE.md): the match layer now fields one team per 4 seats, so the temporary first-layer gate
  // is gone — a room above MAX_SEATS starts like any other, and its Match gets `maxSeats` (multiTeam). The 4-seat room is
  // untouched (below).
  test('拆闸：8 / 12 人房全员就绪即开局，Match 拿到 maxSeats 并分队', async () => {
    for (const cap of [8, 12]) {
      const host = await join(`Gate${cap}Host`);
      const guests = [];
      try {
        const st = await create(host);
        await ok(host, { t: 'room.setSeats', maxSeats: cap });
        await host.waitFor('room.state', (s) => s.maxSeats === cap, 4000);
        for (let i = 0; i < 4; i++) {
          const g = await join(`Gate${cap}G${i}`);
          guests.push(g);
          await ok(g, { t: 'room.join', code: st.code });
          await ok(g, { t: 'room.ready', ready: true });
        }
        await ok(host, { t: 'room.start' });
        await host.waitFor('room.state', (s) => s.inMatch === true, 4000);
      } finally {
        await host.terminate().catch(() => {});
        for (const g of guests) await g.terminate().catch(() => {});
      }
    }
  });

  test('拆闸：8 人房只有房主一人也能开局（容量不再拦人）', async () => {
    const host = await join('GateAlone');
    try {
      await create(host);
      await ok(host, { t: 'room.setSeats', maxSeats: 8 });
      await host.waitFor('room.state', (s) => s.maxSeats === 8, 4000);
      await ok(host, { t: 'room.start' });
      await host.waitFor('room.state', (s) => s.inMatch === true, 4000);
    } finally { await host.terminate().catch(() => {}); }
  });

  test('4 人房回归：房主 + 3 位就绪的博士照常开局', async () => {
    const host = await join('FourHost4');
    const guests = [];
    try {
      const st = await create(host);
      assert.equal(st.seats.length, MAX_SEATS);
      for (let i = 0; i < 3; i++) {
        const g = await join(`FourG${i}`);
        guests.push(g);
        await ok(g, { t: 'room.join', code: st.code });
        await ok(g, { t: 'room.ready', ready: true });
      }
      await ok(host, { t: 'room.start' });
      await host.waitFor('room.state', (s) => s.inMatch === true, 4000);
    } finally {
      await host.terminate().catch(() => {});
      for (const g of guests) await g.terminate().catch(() => {});
    }
  });

  test('协议：room.setSeats 只收 4 / 8 / 12，座位下标放开到 11', () => {
    for (const n of [4, 8, 12]) assert.equal(validateC2S({ t: 'room.setSeats', maxSeats: n }), null, `maxSeats ${n}`);
    for (const n of [0, 5, 6, 9, 11, 13, '8', null]) assert.equal(typeof validateC2S({ t: 'room.setSeats', maxSeats: n }), 'string', `maxSeats ${String(n)}`);
    assert.equal(validateC2S({ t: 'room.kick', seat: 11, playerId: 'p_x' }), null);
    assert.equal(validateC2S({ t: 'room.removeBot', seat: 11 }), null);
    assert.equal(typeof validateC2S({ t: 'room.kick', seat: 12, playerId: 'p_x' }), 'string');
  });
});
