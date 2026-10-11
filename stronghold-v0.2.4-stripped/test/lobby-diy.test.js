// test/lobby-diy.test.js — room.diy end to end over WebSocket (0.2.0 自选编队): lenient validation (only malformed picks
// are refused; illegal ones are dropped), storage on the session (follows the player into rooms, survives a resume) and
// on the seat, seats[].diy handed to the Match when it starts (bots: none), never to a running match (ROOM_STARTED:
// stored for the next one — the next match takes it), every `welcome` carrying `diyKitted`, and the real match exposing
// the picks as m.private.diy.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { KITTED_CHARS } from '../server/sim/content/kits/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, PHASE } from '../shared/constants.js';

const T5A = 'chess_char_5_diy1_a';
const T6A = 'chess_char_6_diy1_a';
const T6B = 'chess_char_6_diy2_a';
const SIEGE = { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const SHARP = { charId: 'char_609_acguad' };
const SHARP_FULL = { charId: 'char_609_acguad', skillIndex: 2, uniEquipId: 'uniequip_002_acguad' };

class RecordingStub extends StubMatch {
  static instances = [];
  constructor(opts) { super(opts); this.opts = opts; RecordingStub.instances.push(this); }
}

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      c.welcome = w;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
async function createRoom(c, mode = 'coop', difficulty = 'NORMAL') {
  await ok(c, { t: 'room.create', mode, difficulty });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}

describe('room.diy (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingStub, heavyBurst: 12, heavyPerSec: 4 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('welcome lists the operators a 自选 slot may field (the kit registry)', async () => {
    const c = await pool.player('Kit');
    assert.deepEqual(c.welcome.diyKitted, [...KITTED_CHARS]);
    assert.ok(c.welcome.diyKitted.includes(SIEGE.charId));
  });

  test('lenient: malformed picks are BAD_MSG; illegal ones dropped; stored per session and seat; bots none; the next match takes a change', async () => {
    const host = await pool.player('Host');
    await err(host, { t: 'room.diy', picks: [SIEGE] }, ERR.BAD_MSG);
    await err(host, { t: 'room.diy', picks: { [T5A]: { skillIndex: 1 } } }, ERR.BAD_MSG);
    // outside a room: accepted (a prototype off its locked skill, a second slot of the owned operator, junk dropped)
    await ok(host, { t: 'room.diy', picks: { [T5A]: SIEGE, [T6A]: { charId: 'char_609_acguad', skillIndex: 0 }, [T6B]: { charId: SIEGE.charId, skillIndex: 1 }, nope: SHARP } });
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.diy', picks: { [T6A]: SHARP } });
    await ok(guest, { t: 'room.diy', picks: { [T6A]: SHARP, [T5A]: SHARP } }); // re-sent: the latest wins
    await ok(host, { t: 'room.addBot' });
    // the guest drops and resumes: the session keeps its picks
    await guest.terminate();
    const back = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await back.hello('Guest', guest.token);
    await ok(back, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    let seats = RecordingStub.instances.at(-1).opts.seats;
    const by = (id) => seats.find((s) => s.playerId === id);
    assert.deepEqual(by(host.id).diy, { [T5A]: SIEGE });
    assert.ok(Object.isFrozen(by(host.id).diy) && Object.isFrozen(by(host.id).diy[T5A]));
    assert.deepEqual(by(guest.id).diy, { [T5A]: SHARP_FULL, [T6A]: SHARP_FULL }, 'a prototype may fill a tier-5 and a tier-6 slot');
    assert.equal(seats.find((s) => s.isBot).diy, null, 'bots field no 自选 piece');
    // during the match: refused for this match (ROOM_STARTED) but stored for the next one
    const r = await err(host, { t: 'room.diy', picks: { [T6B]: SIEGE } }, ERR.ROOM_STARTED);
    assert.match(r.detail || '', /next match/);
    // the stub ends once every human confirmed the briefing; the room is back in its lobby — the next match takes it
    await ok(host, { t: 'g.infoReady' });
    await ok(back, { t: 'g.infoReady' });
    await host.waitFor('room.state', (s) => !s.inMatch, 5000);
    await ok(back, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    assert.equal(RecordingStub.instances.length, 2);
    seats = RecordingStub.instances.at(-1).opts.seats;
    assert.deepEqual(by(host.id).diy, { [T6B]: SIEGE });
    await back.terminate();
    assert.deepEqual(cap.errors, []);
  });

  test('a spectator\'s picks stay on its session (never on a seat, never handed to the match)', async () => {
    const host = await pool.player('Host2');
    const st = await createRoom(host);
    const spec = await pool.player('Watcher');
    await ok(spec, { t: 'room.spectate', code: st.code });
    await spec.waitFor('room.state', (s) => (s.spectators || []).some((x) => x.playerId === spec.id));
    await ok(spec, { t: 'room.diy', picks: { [T5A]: SIEGE } });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    assert.ok(!seats.some((s) => s.playerId === spec.id));
    assert.equal(seats[0].diy, null);
  });
});

describe('room.diy (lobby + real match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, seedFn: () => 4242 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('the picks the seat had at the start are the match\'s m.private.diy; a change during the briefing waits for the next match', async () => {
    const a = await pool.player('Solo');
    await ok(a, { t: 'room.diy', picks: { [T5A]: SIEGE, [T6A]: SHARP } });
    await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK, 5000);
    const priv = await a.waitFor('m.private', (p) => p.diy && typeof p.diy === 'object', 3000);
    assert.deepEqual(priv.diy, { [T5A]: SIEGE, [T6A]: SHARP_FULL });
    assert.deepEqual(priv.diyBanned, []);
    await err(a, { t: 'room.diy', picks: {} }, ERR.ROOM_STARTED);
    await ok(a, { t: 'g.infoReady' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.BAND_DRAFT, 3000);
    assert.deepEqual(cap.errors, []);
  });
});
