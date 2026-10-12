// test/lobby-chat.test.js — 房间与局内文字聊天 (room.chat): the protocol schema, the room broadcast (players and
// spectators, the sender included), the in-a-room-only rule, the rate guard and the text hygiene (control characters
// stripped, the line clipped to the server's CHAT_MAX).
//
// Boots a real server in-process on a random port (startServer({ port: 0 }), the lobby.test.js idiom) with the stub
// match: chat needs no match at all — the room is the only channel.

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch as Match } from '../server/match/StubMatch.js';
import { CHAT_MAX } from '../server/lobby.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S, S2C } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    /** Connect + hello; the client gets `.id` and `.token`. */
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}

/** Collects log output; errors are asserted empty unless a test expects them. */
function captureLog() {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
}

const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;

async function createRoom(c) {
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  return c.waitFor('room.state', (s) => s.hostId === c.id);
}
async function joinRoom(c, code) {
  await ok(c, { t: 'room.join', code });
  return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
}

describe('room.chat protocol and the room broadcast', () => {
  let srv;
  let pool;
  const cap = captureLog();

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: Match });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('the protocol validates room.chat in C2S and lists it in S2C', () => {
    assert.equal(validateC2S({ t: 'room.chat', text: '大家好！' }), null);
    assert.equal(validateC2S({ t: 'room.chat', text: 'hello' }), null);
    assert.notEqual(validateC2S({ t: 'room.chat', text: '' }), null, 'empty');
    assert.notEqual(validateC2S({ t: 'room.chat', text: '   ' }), null, 'whitespace only');
    assert.notEqual(validateC2S({ t: 'room.chat', text: 'a'.repeat(121) }), null, 'over the wire bound');
    assert.notEqual(validateC2S({ t: 'room.chat' }), null, 'missing text');
    assert.notEqual(validateC2S({ t: 'room.chat', text: 7 }), null, 'not a string');
    assert.equal(S2C.includes('room.chat'), true);
  });

  test('chat is refused outside a room', async () => {
    const p = await pool.player('SoloDoc');
    await err(p, { t: 'room.chat', text: 'hello' }, ERR.NOT_IN_ROOM);
  });

  test('a line reaches every player in the room, the sender included', async () => {
    const host = await pool.player('HostDoctor');
    const guest = await pool.player('GuestDoctor');

    const roomState = await createRoom(host);
    await joinRoom(guest, roomState.code);

    const pHost = host.waitFor('room.chat', (m) => m.text === '攻打右路！');
    const pGuest = guest.waitFor('room.chat', (m) => m.text === '攻打右路！');
    await ok(host, { t: 'room.chat', text: '攻打右路！' });

    const [mHost, mGuest] = await Promise.all([pHost, pGuest]);
    for (const m of [mHost, mGuest]) {
      assert.equal(m.name, 'HostDoctor');
      assert.equal(m.seat, 0);
      assert.equal(m.isSpectator, false);
      assert.equal(m.text, '攻打右路！');
      assert.equal(m.playerId, host.id);
      assert.ok(Number.isFinite(m.at), 'the line carries a timestamp');
    }

    // and back the other way, with the guest's own seat and name
    const pHost2 = host.waitFor('room.chat', (m) => m.text === '收到');
    const pGuest2 = guest.waitFor('room.chat', (m) => m.text === '收到');
    await ok(guest, { t: 'room.chat', text: '收到' });
    const [mHost2, mGuest2] = await Promise.all([pHost2, pGuest2]);
    assert.equal(mHost2.name, 'GuestDoctor');
    assert.equal(mHost2.seat, 1);
    assert.equal(mGuest2.text, '收到');
  });

  test('a spectator chats too, flagged and with seat -1', async () => {
    const host = await pool.player('HostDoctor');
    const watcher = await pool.player('WatchDoc');
    const roomState = await createRoom(host);

    await ok(watcher, { t: 'room.spectate', code: roomState.code });
    const pSeen = host.waitFor('room.chat', (m) => m.text === '观战中');
    await ok(watcher, { t: 'room.chat', text: '观战中' });
    const m = await pSeen;
    assert.equal(m.name, 'WatchDoc');
    assert.equal(m.seat, -1);
    assert.equal(m.isSpectator, true);
  });

  test('one line per second per session (RATE), and the next second is fine', async () => {
    const p = await pool.player('FastDoc');
    await createRoom(p);
    await ok(p, { t: 'room.chat', text: 'first' });
    await err(p, { t: 'room.chat', text: 'too soon' }, ERR.RATE);
    await new Promise((r) => setTimeout(r, 1100));
    await ok(p, { t: 'room.chat', text: 'later' });
  });

  test('the text is clipped to CHAT_MAX and stripped of control characters', async () => {
    const p = await pool.player('ClipDoc');
    await createRoom(p);

    const long = 'x'.repeat(100);
    const pLong = p.waitFor('room.chat', (m) => m.text.startsWith('x'));
    await ok(p, { t: 'room.chat', text: long });
    assert.equal((await pLong).text.length, CHAT_MAX, `clipped to ${CHAT_MAX}`);

    await new Promise((r) => setTimeout(r, 1100));
    const pCtrl = p.waitFor('room.chat', (m) => m.text === 'ab');
    await ok(p, { t: 'room.chat', text: '  a\x07b\x00  ' });
    assert.equal((await pCtrl).text, 'ab', 'control characters stripped, then trimmed');

    // a line that is nothing but control characters is empty once stripped: the server refuses it
    await new Promise((r) => setTimeout(r, 1100));
    await err(p, { t: 'room.chat', text: '\x01\x02' }, ERR.BAD_MSG);
  });
});
