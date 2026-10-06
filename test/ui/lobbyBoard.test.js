import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateHost,
  formatLeftTime,
  isRoomPublic,
  saveRoomToken,
  removeRoomToken,
} from '../../public/js/ui/lobbyBoard.js';

test('lobbyBoard: isPrivateHost distinguishes private vs public origins', () => {
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('localhost'), true);
  assert.equal(isPrivateHost('192.168.1.100'), true);
  assert.equal(isPrivateHost('10.0.0.5'), true);
  assert.equal(isPrivateHost('172.16.0.1'), true);
  assert.equal(isPrivateHost('172.31.255.255'), true);
  assert.equal(isPrivateHost('0.0.0.0'), true);

  // Public hosts
  assert.equal(isPrivateHost('game.rainya.me'), false);
  assert.equal(isPrivateHost('sp-lobby.jiangjiangze.icu'), false);
  assert.equal(isPrivateHost('8.8.8.8'), false);
  assert.equal(isPrivateHost('172.32.0.1'), false);
});

test('lobbyBoard: formatLeftTime formats seconds into mm:ss', () => {
  assert.equal(formatLeftTime(0), '0:00');
  assert.equal(formatLeftTime(5), '0:05');
  assert.equal(formatLeftTime(59), '0:59');
  assert.equal(formatLeftTime(60), '1:00');
  assert.equal(formatLeftTime(65), '1:05');
  assert.equal(formatLeftTime(600), '10:00');
});

test('lobbyBoard: token persistence and public status', () => {
  // Mock localStorage in node environment if needed
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  }

  const code = 'ABCD';
  assert.equal(isRoomPublic(code), false);

  saveRoomToken(code, 'mock-token-1234');
  assert.equal(isRoomPublic(code), true);

  removeRoomToken(code);
  assert.equal(isRoomPublic(code), false);
});
