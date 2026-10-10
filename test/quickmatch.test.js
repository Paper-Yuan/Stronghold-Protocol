// test/quickmatch.test.js — 验证公开房间、快速匹配与后台遥测
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
      readyState: 1,
      send(data) {
        try { sent.push(JSON.parse(data)); } catch { sent.push(data); }
      },
    },
    sent,
  };
}

test('quickMatch: auto-creates public room if none exists', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'DoctorAlpha');
  registry.byPlayerId.set('p1', s1);

  const res = lobby.onMessage(s1, { t: 'room.quickMatch', mode: 'coop', difficulty: 'NORMAL' });
  assert.equal(res.ok, true);
  assert.ok(s1.roomCode);

  const room = lobby.getRoom(s1.roomCode);
  assert.ok(room);
  assert.equal(room.isPublic, true);
  assert.equal(room.difficulty, 'NORMAL');

  // public rooms list contains this room
  const publicRooms = lobby.listPublicRooms();
  assert.equal(publicRooms.length, 1);
  assert.equal(publicRooms[0].code, room.code);
  assert.equal(publicRooms[0].hostName, 'DoctorAlpha');
  assert.equal(publicRooms[0].humans, 1);
  assert.equal(publicRooms[0].maxSeats, 4);
});

test('quickMatch: joins existing public room with vacancy', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'DoctorAlpha');
  const s2 = createMockSession('p2', 'DoctorBeta');
  registry.byPlayerId.set('p1', s1);
  registry.byPlayerId.set('p2', s2);

  lobby.onMessage(s1, { t: 'room.quickMatch', mode: 'coop', difficulty: 'HARD' });
  const roomCode1 = s1.roomCode;

  // s2 quickMatch with same difficulty should join s1's room
  const res2 = lobby.onMessage(s2, { t: 'room.quickMatch', mode: 'coop', difficulty: 'HARD' });
  assert.equal(res2.ok, true);
  assert.equal(s2.roomCode, roomCode1);

  const room = lobby.getRoom(roomCode1);
  assert.equal(room.seats.filter((s) => s && !s.left).length, 2);
});

test('room.create: can create private room', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  const s1 = createMockSession('p1', 'DoctorSecret');
  registry.byPlayerId.set('p1', s1);

  lobby.onMessage(s1, { t: 'room.create', mode: 'coop', difficulty: 'ABYSS', isPublic: false });
  const room = lobby.getRoom(s1.roomCode);
  assert.equal(room.isPublic, false);

  // private room should not be in public list
  const publicRooms = lobby.listPublicRooms();
  assert.equal(publicRooms.length, 0);

  // but should appear in all rooms list for admin dashboard
  const allRooms = lobby.listAllRooms();
  assert.equal(allRooms.length, 1);
  assert.equal(allRooms[0].isPublic, false);
});
