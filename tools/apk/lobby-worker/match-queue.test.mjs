// match-queue.test.mjs — unit tests for the sp-lobby cross-server match queue core (src/match.js).
//   node --test tools/apk/lobby-worker/match-queue.test.mjs
//
// The core is exercised with an in-memory state adapter + a deterministic clock and random seam,
// exactly the code the Durable Object runs (index.js only adds the HTTP/CORS shell + alarms).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, DIFFS, GROUP_SIZE, MAX_QUEUE, IP_OPS_MAX, QUEUE_TTL_MS, MATCH_TTL_MS, ROOM_TTL_MS }
  from './src/match.js';

function memState() {
  const map = new Map();
  return {
    get: (k) => map.get(k),
    put: (k, v) => { map.set(k, v); },
    delete: (k) => { map.delete(k); },
    list: () => new Map(map),
    _map: map,
  };
}

function makeHarness() {
  const state = memState();
  const clock = { t: 1_000_000 };
  let seq = 0;
  const core = createMatch({
    state,
    now: () => clock.t,
    random: (len) => Array.from({ length: len }, () => (++seq) & 0xff),
  });
  return { core, state, clock };
}

const join = (core, difficulty, kind = 'local', serverId = '', ip = '1.1.1.1', app = '') =>
  core.enqueue({ difficulty, venue: { kind, serverId }, ip, app });

test('enqueue: difficulty and venue validation', async () => {
  const { core } = makeHarness();
  assert.equal((await join(core, 'EASY')).error, 'BAD_DIFFICULTY');
  assert.equal((await core.enqueue({ difficulty: 'HARD', venue: { kind: 'phone' }, ip: 'a' })).error, 'BAD_VENUE');
  assert.equal((await core.enqueue({ difficulty: 'HARD', venue: { kind: 'public' }, ip: 'a' })).error, 'BAD_VENUE');
  const ok = await join(core, 'hard', 'public', 'stronghold2');
  assert.equal(ok.ok, true);
  assert.equal(ok.state, 'waiting');
  assert.equal(ok.need, GROUP_SIZE);
  assert.equal(ok.difficulty, 'HARD', 'difficulty is normalised to upper case');
});

test('grouping: the 4th same-difficulty waiter is matched; public venue wins the host seat', async () => {
  const { core } = makeHarness();
  const a = await join(core, 'HARD', 'local', '', '10.0.0.1'); // oldest, local venue
  const b = await join(core, 'HARD', 'local', '', '10.0.0.2');
  const c = await join(core, 'HARD', 'public', 'stronghold', '10.0.0.3'); // the only public venue
  const d = await join(core, 'HARD', 'local', '', '10.0.0.4'); // completes the group
  assert.equal(a.state, 'waiting');
  assert.equal(b.state, 'waiting');
  assert.equal(c.state, 'waiting');
  assert.equal(d.state, 'matched', 'the 4th joins the group immediately');
  assert.equal(d.role, 'guest', 'a local-venue completer is a guest');
  assert.equal(d.size, 4);
  assert.equal(d.room, null);
  assert.equal(d.members, undefined, 'guests never see the member list');

  const sc = await core.status({ id: c.id, token: c.token });
  assert.equal(sc.state, 'matched');
  assert.equal(sc.role, 'host', 'the earliest public-venue member hosts (公开服优先)');
  assert.equal(sc.matchId, d.matchId);
  assert.ok(Array.isArray(sc.members) && sc.members.length === 4, 'the host sees the member list');

  const sa = await core.status({ id: a.id, token: a.token });
  assert.equal(sa.role, 'guest');
  assert.equal(sa.matchId, d.matchId);
});

test('grouping: difficulties never mix; hosting falls back to the oldest member', async () => {
  const { core } = makeHarness();
  const firstHard = await join(core, 'HARD', 'local', '', '10.0.0.1');
  await join(core, 'NORMAL', 'public', 'x', '10.0.0.2');
  await join(core, 'HARD', 'local', '', '10.0.0.3');
  const fourth = await join(core, 'HARD', 'local', '', '10.0.0.4'); // only 3 HARD → still waiting
  assert.equal(fourth.state, 'waiting');
  const normal2 = await join(core, 'NORMAL', 'local', '', '10.0.0.5');
  assert.equal(normal2.state, 'waiting', 'the NORMAL bucket has only 2 waiters');
  // finish the HARD bucket
  const hard4 = await join(core, 'HARD', 'local', '', '10.0.0.6');
  assert.equal(hard4.state, 'matched');
  assert.equal(hard4.role, 'guest', 'with no public venue the oldest member hosts, not the completer');
  assert.equal(hard4.size, 4);
  assert.equal((await core.status({ id: firstHard.id, token: firstHard.token })).role, 'host',
    'no public venue → the oldest member hosts');
  assert.equal((await core.status({ id: fourth.id, token: fourth.token })).role, 'guest');
});

test('version-agnostic: differing app values still group (非 app 也配对)', async () => {
  const { core } = makeHarness();
  await join(core, 'ABYSS', 'local', '', '10.0.0.1', '0.1.2');
  await join(core, 'ABYSS', 'local', '', '10.0.0.2', '0.1.3');
  await join(core, 'ABYSS', 'local', '', '10.0.0.3', '0.2.0');
  const last = await join(core, 'ABYSS', 'local', '', '10.0.0.4', '0.1.0');
  assert.equal(last.state, 'matched');
  assert.equal(last.size, 4);
});

test('room handoff: only the host with the right token can post; guests then read it', async () => {
  const { core } = makeHarness();
  const host = await join(core, 'HARD', 'local', '', '10.0.0.1'); // oldest → host
  const guest = await join(core, 'HARD', 'local', '', '10.0.0.2');
  await join(core, 'HARD', 'local', '', '10.0.0.3');
  const last = await join(core, 'HARD', 'local', '', '10.0.0.4');
  assert.equal(last.state, 'matched');
  assert.equal((await core.status({ id: host.id, token: host.token })).role, 'host');

  assert.equal((await core.status({ id: guest.id, token: guest.token })).room, null);

  assert.equal((await core.setRoom({ id: guest.id, token: guest.token, code: 'ABCD', serverId: 's' })).error, 'FORBIDDEN',
    'a guest cannot post the room');
  assert.equal((await core.setRoom({ id: host.id, token: 'wrong', code: 'ABCD', serverId: 's' })).error, 'FORBIDDEN');
  assert.equal((await core.setRoom({ id: host.id, token: host.token, code: 'ab1', serverId: 's' })).error, 'BAD_CODE');
  assert.equal((await core.setRoom({ id: host.id, token: host.token, code: 'ABCD', serverId: '' })).error, 'BAD_SERVER');

  const posted = await core.setRoom({
    id: host.id, token: host.token, code: 'ABCD', serverId: 'stronghold2', url: 'https://example.com/?room=ABCD',
  });
  assert.equal(posted.ok, true);
  assert.equal(posted.room.code, 'ABCD');

  const seen = await core.status({ id: guest.id, token: guest.token });
  assert.equal(seen.room.code, 'ABCD');
  assert.equal(seen.room.serverId, 'stronghold2');
  assert.equal(seen.room.venueKind, 'local');
});

test('cancel: entries leave cleanly; with no room the seat passes and the last member tears it down', async () => {
  const { core } = makeHarness();
  const solo = await join(core, 'FUNNY', 'local', '', '10.0.0.9');
  assert.equal((await core.cancel({ id: solo.id, token: 'nope' })).error, 'FORBIDDEN');
  assert.equal((await core.cancel({ id: solo.id, token: solo.token })).removed, 'queue');
  assert.equal((await core.status({ id: solo.id })).state, 'expired');

  const a = await join(core, 'HARD', 'local', '', '10.0.0.1'); // oldest → host
  const b = await join(core, 'HARD', 'local', '', '10.0.0.2');
  const c = await join(core, 'HARD', 'local', '', '10.0.0.3');
  const d = await join(core, 'HARD', 'local', '', '10.0.0.4');
  assert.equal(d.state, 'matched');
  assert.equal((await core.status({ id: a.id, token: a.token })).role, 'host');

  // the host leaves before a room exists: the seat passes to the oldest remaining member
  assert.equal((await core.cancel({ id: a.id, token: a.token })).removed, 'member');
  assert.equal((await core.status({ id: a.id })).state, 'expired');
  const nb = await core.status({ id: b.id, token: b.token });
  assert.equal(nb.state, 'matched');
  assert.equal(nb.role, 'host', 'the seat passes to the oldest remaining member');

  // the rest leave one by one; the last one tears the record down
  assert.equal((await core.cancel({ id: b.id, token: b.token })).removed, 'member');
  assert.equal((await core.cancel({ id: c.id, token: c.token })).removed, 'member');
  assert.equal((await core.cancel({ id: d.id, token: d.token })).removed, 'match', 'the last member dissolves it');
  assert.equal((await core.sweep()).pending, false);
});

test('ttl: waiting entries expire after QUEUE_TTL_MS; room-less matches dissolve after MATCH_TTL_MS', async () => {
  const { core, clock } = makeHarness();
  const a = await join(core, 'HARD', 'local', '', '10.0.0.1');
  clock.t += QUEUE_TTL_MS - 1;
  assert.equal((await core.status({ id: a.id, token: a.token })).state, 'waiting');
  clock.t += 2;
  assert.equal((await core.status({ id: a.id, token: a.token })).state, 'expired');

  const b = await join(core, 'NORMAL', 'local', '', '10.0.0.2');
  await join(core, 'NORMAL', 'local', '', '10.0.0.3');
  await join(core, 'NORMAL', 'local', '', '10.0.0.4');
  const last = await join(core, 'NORMAL', 'local', '', '10.0.0.5');
  assert.equal(last.state, 'matched');
  clock.t += MATCH_TTL_MS + 1;
  assert.equal((await core.status({ id: b.id, token: b.token })).state, 'expired');
  const swept = await core.sweep();
  assert.equal(swept.pending, false, 'nothing lingers after the sweep');

  // a posted room stretches the record's life to ROOM_TTL_MS
  const h1 = await join(core, 'ABYSS', 'local', '', '10.0.0.6'); // oldest → host
  await join(core, 'ABYSS', 'local', '', '10.0.0.7');
  await join(core, 'ABYSS', 'local', '', '10.0.0.8');
  await join(core, 'ABYSS', 'local', '', '10.0.0.9');
  await core.setRoom({ id: h1.id, token: h1.token, code: 'WXYZ', serverId: 's' });
  clock.t += MATCH_TTL_MS + 1;
  assert.equal((await core.status({ id: h1.id, token: h1.token })).state, 'matched',
    'with a room the record survives past MATCH_TTL_MS');
  clock.t += ROOM_TTL_MS;
  assert.equal((await core.status({ id: h1.id, token: h1.token })).state, 'expired');
});

test('limits: per-IP op rate limit and the queue cap', async () => {
  const { core } = makeHarness();
  for (let i = 0; i < IP_OPS_MAX; i++) {
    const r = await join(core, 'HARD', 'local', '', '10.9.9.9'); // every 4th response is 'matched'
    assert.equal(r.ok, true);
  }
  const limited = await join(core, 'HARD', 'local', '', '10.9.9.9');
  assert.equal(limited.error, 'RATE_LIMITED');

  // the cap counts live waiters (seeded directly — 4 same-difficulty entries would group)
  const { core: core2, state: state2 } = makeHarness();
  for (let i = 0; i < MAX_QUEUE; i++) {
    await state2.put('q:seed' + i, {
      id: 'seed' + i,
      token: 'x',
      difficulty: DIFFS[i % DIFFS.length],
      venue: { kind: 'local', serverId: '' },
      app: '',
      ip: '10.0.0.1',
      joinedAt: 1_000_000,
    });
  }
  const capped = await join(core2, 'HARD', 'local', '', '10.5.5.5');
  assert.equal(capped.error, 'LIMIT_REACHED');
});

test('status: unknown handle reports expired, mismatched token is refused', async () => {
  const { core } = makeHarness();
  assert.equal((await core.status({ id: 'deadbeef' })).state, 'expired');
  const a = await join(core, 'HARD', 'local', '', '10.0.0.1');
  assert.equal((await core.status({ id: a.id, token: 'x' })).error, 'FORBIDDEN');
});
