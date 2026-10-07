// test/net-resilience.test.js — 验证网络波动稳定模块与自适应抖动平滑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Net, DEAD_AFTER_MS } from '../public/js/net.js';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Network, SessionRegistry } from '../server/net.js';

class MockSocket {
  constructor() {
    this.readyState = 1; // WS_OPEN
    this.sent = [];
  }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
}

test('net resilience: EMA RTT smoothing and jitter tracking on pong', () => {
  let now = 1000;
  const client = new Net({
    now: () => now,
    timers: { setTimeout, clearTimeout, setInterval, clearInterval },
  });

  client.status = 'online';

  // Sample 1: RTT = 40ms
  now = 1040;
  client._onPong({ t: 'pong', c: 1000, s: 1020 });
  assert.equal(client.ping, 40);
  assert.equal(client.rttEma, 40);
  assert.equal(client.jitter, 0);
  assert.equal(client.quality, 'good');

  // Sample 2: Sudden jitter spike RTT = 160ms
  now = 1260;
  client._onPong({ t: 'pong', c: 1100, s: 1180 });
  assert.equal(client.ping, 160);
  // diff = |160 - 40| = 120. jitter = 0 * 0.75 + 120 * 0.25 = 30
  // rttEma = 40 * 0.75 + 160 * 0.25 = 70
  assert.equal(client.jitter, 30);
  assert.equal(client.rttEma, 70);
  assert.equal(client.quality, 'fair');

  // Sample 3: High latency RTT = 300ms
  now = 1600;
  client._onPong({ t: 'pong', c: 1300, s: 1450 });
  assert.equal(client.ping, 300);
  assert.equal(client.quality, 'poor');

  // Snapshot contains resilience fields
  const snap = client.snapshot();
  assert.equal(snap.ping, 300);
  assert.ok(snap.jitter > 0);
  assert.equal(snap.quality, 'poor');
  client.close();
});

test('net resilience: adaptive heartbeat expands dead timeout when jitter is high', () => {
  let now = 1000;
  const client = new Net({
    now: () => now,
    timers: { setTimeout, clearTimeout, setInterval, clearInterval },
  });

  const mockWs = new MockSocket();
  client.ws = mockWs;
  client.status = 'online';
  client.jitter = 80; // High jitter

  // Send ping at now = 1000
  client._sendPing();
  assert.equal(client._unansweredSince, 1000);

  // At 16 seconds (past normal DEAD_AFTER_MS of 15s, but within adaptive timeout 15000 + 80*8 = 15640ms)
  now = 1000 + 15200;
  client._heartbeat();
  // Socket must STILL be open because jitter expanded the window!
  assert.equal(mockWs.readyState, 1);

  // At 26 seconds (exceeded max adaptive threshold)
  now = 1000 + 26000;
  client._heartbeat();
  assert.equal(mockWs.readyState, 3); // Closed and triggered reconnect
  client.close();
});

test('net resilience: in-flight requests survive transient disconnect and flush on welcome', async () => {
  let now = 1000;
  const client = new Net({
    now: () => now,
    timers: { setTimeout, clearTimeout, setInterval, clearInterval },
  });

  const mockWs = new MockSocket();
  client.ws = mockWs;
  client.status = 'online';
  client.name = 'Doctor';
  client.getToken = () => 'token123';

  // Player sends request while online
  const reqPromise = client.request('room.list');
  assert.equal(client.pendingCount, 1);
  assert.equal(mockWs.sent.length, 1);

  // Abrupt transient socket drop (e.g. mobile 4G/Wi-Fi handover)
  client._onClose({ code: 1006, reason: 'abnormal close' });
  assert.equal(client.status, 'reconnecting');

  // The in-flight request was NOT rejected immediately! It was preserved in queue!
  assert.equal(client.pendingCount, 1);

  // Fresh socket connects and receives welcome
  const newWs = new MockSocket();
  client.ws = newWs;
  client.status = 'handshaking';

  // Server replies welcome
  client._onWelcome({
    t: 'welcome',
    playerId: 'p1',
    token: 'token123',
    name: 'Doctor',
    serverNow: 2000,
  });

  assert.equal(client.status, 'online');
  // Request was flushed to the new socket!
  assert.ok(newWs.sent.length >= 1);
  const flushedMsg = JSON.parse(newWs.sent.find(s => s.includes('room.list')));
  assert.equal(flushedMsg.t, 'room.list');

  // Server responds to flushed request
  client._onMessage(JSON.stringify({ t: 'ok', rid: flushedMsg.rid, rooms: [] }));

  const res = await reqPromise;
  assert.deepEqual(res.rooms, []);
  client.close();
});

test('net resilience: TCP keepalive and nodelay are applied in handleConnection', () => {
  const registry = new SessionRegistry();
  const network = new Network({ registry, handler: { onMessage() {} } });
  let keepAliveCalls = [];
  let noDelayCalls = [];
  const fakeSocket = {
    setKeepAlive(enable, delay) { keepAliveCalls.push({ enable, delay }); },
    setNoDelay(enable) { noDelayCalls.push(enable); },
  };
  const fakeWs = {
    _socket: fakeSocket,
    on() {},
    close() {},
  };
  network.handleConnection(fakeWs, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  assert.deepEqual(keepAliveCalls, [{ enable: true, delay: 5000 }]);
  assert.deepEqual(noDelayCalls, [true]);
  network.close();
});
