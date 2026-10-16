// test/infinite-room.test.js — 超限模拟（solo_infinite）必须是**单人房**。
//
// owner 报告：选「超限模拟」进的是同盟房。原因是房间的「独占单人」判定全都写成 `mode === 'solo'` 而超限模拟的
// 标记是 'solo_infinite'（Room 里一直存着它），于是它按同盟房对待：能被别人加入、能加 AI、对外报 4 个座位。
// 现在这些判定统一走 shared/infiniteMode.js 的 isSoloRoomMode(mode)。

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch as Match } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

const log = { info() {}, warn() {}, debug() {}, error() {} };

describe('超限模拟是单人房', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: Match }); });
  after(async () => { await srv?.close(); });

  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
  const join = async (name) => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); const w = await c.hello(name); c.id = w.playerId; return c; };

  test('房间留着 solo_infinite 标记，别人进不来、加不了 AI、座位只有 1 个', async () => {
    const host = await join('InfiniteHost');
    const other = await join('Other');
    try {
      await ok(host, { t: 'room.create', mode: 'solo_infinite', difficulty: 'HARD', modIds: [] });
      const st = await host.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.mode, 'solo_infinite', '房间保留超限模拟的标记（客户端与模拟规则都靠它）');
      assert.equal(st.seats.filter(Boolean).length, 1, '单人房只有 1 个占用座位（槽位数组仍是 4 个）');
      await err(other, { t: 'room.join', code: st.code }, 'ROOM_FULL');
      await err(host, { t: 'room.addBot' }, 'ROOM_FULL');   // lobby.js: 'solo rooms cannot have AI teammates'
      // 房间卡的容量：/api/rooms 只列同盟房（单人房不对外），所以直接问 roomStatus。
      const { roomStatus } = await import('../server/publicApi.js');
      const seat = { playerId: 'p1', name: 'A', ready: false };
      const card = (mode) => roomStatus({ code: 'TEST', mode, seats: [seat, null, null, null], disposed: false }, Date.now());
      assert.equal(card('solo_infinite').capacity, 1, '超限模拟房容量是 1（不是 4）');
      assert.equal(card('solo_infinite').joinable, false, '而且不可加入');
      assert.equal(card('solo').capacity, 1);
      assert.equal(card('coop').capacity, 4);
    } finally { await host.terminate().catch(() => {}); await other.terminate().catch(() => {}); }
  });

  test('普通 solo 与 coop 不受影响', async () => {
    const a = await join('SoloA');
    const b = await join('CoopB');
    try {
      await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      const solo = await a.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(solo.mode, 'solo');
      await ok(b, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const coop = await b.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(coop.mode, 'coop');
      assert.ok(coop.seats.length >= 4, '同盟房仍是 4 个座位');
    } finally { await a.terminate().catch(() => {}); await b.terminate().catch(() => {}); }
  });
});
