// test/matchmaking.test.js — 自动随机匹配与撮合引擎单元测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';

function createMockSession(id, name = `Doctor_${id}`) {
  const sent = [];
  return {
    playerId: id,
    name,
    token: `token_${id}`,
    connected: true,
    roomCode: null,
    addr: '127.0.0.1',
    limitKey: 'local',
    ws: {
      readyState: 1, // OPEN
      send(data) {
        try { sent.push(JSON.parse(data)); } catch { sent.push(data); }
      },
    },
    sent,
  };
}

test('matchmaking: solo queue starts room immediately', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'SoloDoctor');
  registry.byPlayerId.set('p1', s1);

  const res = lobby.onMessage(s1, { t: 'match.queue', mode: 'solo', difficulty: 'NORMAL' });
  assert.equal(res.ok, true);

  // solo 应立即生成房间并下发 match.found 与 room.state
  assert.ok(s1.roomCode, 'session should have roomCode');
  const found = s1.sent.find((m) => m.t === 'match.found');
  assert.ok(found, 'should receive match.found');
  assert.equal(found.mode, 'solo');
  assert.equal(found.difficulty, 'NORMAL');

  const room = lobby.getRoom(s1.roomCode);
  assert.ok(room);
  assert.equal(room.mode, 'solo');
  assert.equal(room.difficulty, 'NORMAL');
  assert.equal(room.seats[0].playerId, 'p1');

  lobby.shutdown();
});

test('matchmaking: 4 coop players in same difficulty form a room', () => {
  let now = 1000;
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, now: () => now });

  const sessions = [
    createMockSession('p1', 'Doctor_1'),
    createMockSession('p2', 'Doctor_2'),
    createMockSession('p3', 'Doctor_3'),
    createMockSession('p4', 'Doctor_4'),
  ];
  sessions.forEach((s) => registry.byPlayerId.set(s.playerId, s));

  // 前 3 人入队
  for (let i = 0; i < 3; i++) {
    const res = lobby.onMessage(sessions[i], { t: 'match.queue', mode: 'coop', difficulty: 'HARD' });
    assert.equal(res.ok, true);
    assert.equal(sessions[i].roomCode, null, 'should wait in queue');
    const statusMsg = sessions[i].sent.find((m) => m.t === 'match.status');
    assert.ok(statusMsg);
    assert.equal(statusMsg.status, 'searching');
  }

  // 第 4 人入队触发满员撮合
  const res4 = lobby.onMessage(sessions[3], { t: 'match.queue', mode: 'coop', difficulty: 'HARD' });
  assert.equal(res4.ok, true);

  // 4 人应分配在同一房间
  const roomCode = sessions[0].roomCode;
  assert.ok(roomCode);
  for (const s of sessions) {
    assert.equal(s.roomCode, roomCode);
    const found = s.sent.find((m) => m.t === 'match.found');
    assert.ok(found);
    assert.equal(found.roomCode, roomCode);
    assert.equal(found.humans, 4);
  }

  const room = lobby.getRoom(roomCode);
  assert.ok(room);
  assert.equal(room.activeHumans().length, 4);
  assert.equal(room.seats.filter((s) => s && s.isBot).length, 0);

  lobby.shutdown();
});

test('matchmaking: timeout with fillBots=true automatically fills AI teammates', () => {
  let currentTime = 10_000;
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, now: () => currentTime });

  const s1 = createMockSession('p1', 'HostDoctor');
  const s2 = createMockSession('p2', 'GuestDoctor');
  registry.byPlayerId.set('p1', s1);
  registry.byPlayerId.set('p2', s2);

  lobby.onMessage(s1, { t: 'match.queue', mode: 'coop', difficulty: 'ABYSS', fillBots: true });
  lobby.onMessage(s2, { t: 'match.queue', mode: 'coop', difficulty: 'ABYSS', fillBots: true });

  assert.equal(s1.roomCode, null);
  assert.equal(s2.roomCode, null);

  // 时间推进 11 秒（超过 10 秒超时门槛）
  currentTime += 11_000;
  lobby.matchmaker.tick();

  // 应当发车
  assert.ok(s1.roomCode);
  assert.equal(s1.roomCode, s2.roomCode);

  const room = lobby.getRoom(s1.roomCode);
  assert.ok(room);
  assert.equal(room.activeHumans().length, 2);
  const bots = room.seats.filter((s) => s && s.isBot);
  assert.equal(bots.length, 2, 'remaining 2 seats should be filled with bots');

  lobby.shutdown();
});

test('matchmaking: cancel queue restores idle state', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'Doctor_1');
  registry.byPlayerId.set('p1', s1);

  lobby.onMessage(s1, { t: 'match.queue', mode: 'coop', difficulty: 'FUNNY' });
  assert.equal(lobby.matchmaker.queue.has('p1'), true);

  const cancelRes = lobby.onMessage(s1, { t: 'match.cancel' });
  assert.equal(cancelRes.ok, true);
  assert.equal(lobby.matchmaker.queue.has('p1'), false);

  const idleMsg = s1.sent.find((m) => m.t === 'match.status' && m.status === 'idle');
  assert.ok(idleMsg);

  lobby.shutdown();
});

test('matchmaking: disconnect automatically removes from queue', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'Doctor_1');
  registry.byPlayerId.set('p1', s1);

  lobby.onMessage(s1, { t: 'match.queue', mode: 'coop', difficulty: 'FUNNY' });
  assert.equal(lobby.matchmaker.queue.has('p1'), true);

  lobby.onDisconnect(s1);
  assert.equal(lobby.matchmaker.queue.has('p1'), false);

  lobby.shutdown();
});

test('matchmaking: room host party queue pulls solo queue player into the room', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const sHost = createMockSession('p_host', 'HostDoctor');
  const sSolo = createMockSession('p_solo', 'SoloDoctor');
  registry.byPlayerId.set('p_host', sHost);
  registry.byPlayerId.set('p_solo', sSolo);

  // 1. 房主建房
  const created = lobby.create(sHost, { mode: 'coop', difficulty: 'HARD' });
  assert.equal(created.ok, true);
  const room = lobby.getRoom(sHost.roomCode);
  assert.ok(room);

  // 2. 房主在房间内开启「匹配队友」
  const qPartyRes = lobby.onMessage(sHost, { t: 'match.queue' });
  assert.equal(qPartyRes.ok, true);
  assert.ok(room.matching, 'room should be in matching state');

  // 3. 散人玩家在大厅匹配 HARD 难度
  lobby.onMessage(sSolo, { t: 'match.queue', mode: 'coop', difficulty: 'HARD' });

  // 4. 散人应直接被拉入该房间
  assert.equal(sSolo.roomCode, room.code);
  assert.equal(room.activeHumans().length, 2);
  const found = sSolo.sent.find((m) => m.t === 'match.found');
  assert.ok(found);
  assert.equal(found.roomCode, room.code);

  lobby.shutdown();
});

test('matchmaking: room.list returns statistics and public alliance rooms', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'Doctor_Host');
  registry.byPlayerId.set('p1', s1);

  // create coop room
  lobby.onMessage(s1, { t: 'room.create', mode: 'coop', difficulty: 'ABYSS' });

  const listRes = lobby.onMessage(s1, { t: 'room.list' });
  assert.equal(listRes.ok, true);
  assert.equal(listRes.t, 'room.list');
  assert.equal(listRes.online, 1);
  assert.equal(listRes.roomsCount, 1);
  assert.equal(listRes.rooms.length, 1);
  assert.equal(listRes.rooms[0].name, 'Doctor_Host');
  assert.equal(listRes.rooms[0].difficulty, 'ABYSS');
  assert.equal(listRes.rooms[0].humans, 1);
  assert.equal(listRes.rooms[0].inMatch, false);

  lobby.shutdown();
});

