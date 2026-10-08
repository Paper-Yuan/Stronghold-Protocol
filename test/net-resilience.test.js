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

// Admission circuit breaker (docs/OPTIMIZATION_AND_PR_PLAN.md §2.1.2): when the loadGuard is red, brand-new hello
// sessions are refused with ERR.BUSY; a hello carrying a known token (a reconnect) always passes.
test('net resilience: loadGuard red refuses new sessions, reconnect tokens always pass', () => {
  const registry = new SessionRegistry();
  const guard = {
    blocked: true,
    summary: () => ({ status: 'red', onlineCount: 200, score: 200, cpuPercent: 90, lagMs: 130 }),
  };
  const network = new Network({ registry, handler: { onMessage() {} }, loadGuard: guard });
  const mkWs = () => ({ readyState: 1, _socket: { setKeepAlive() {}, setNoDelay() {} }, on() {}, close() {}, terminate() {}, sent: [], send(d) { this.sent.push(String(d)); } });

  // 1. brand-new session: refused with BUSY, no session minted
  const ws1 = mkWs();
  network.handleConnection(ws1, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  network.onFrame(network.conns.get(ws1), JSON.stringify({ t: 'hello', name: '新玩家', rid: 1 }), false);
  const reply1 = JSON.parse(ws1.sent.at(-1));
  assert.equal(reply1.t, 'error');
  assert.equal(reply1.code, 'BUSY');
  assert.match(reply1.detail, /200 在线/);
  assert.equal(registry.size, 0, 'no session was minted');

  // 2. seed an existing session, then reconnect with its token: passes even while red
  guard.blocked = false;
  const ws2 = mkWs();
  network.handleConnection(ws2, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  network.onFrame(network.conns.get(ws2), JSON.stringify({ t: 'hello', name: '老玩家', rid: 2 }), false);
  const welcome = JSON.parse(ws2.sent.at(-1));
  assert.equal(welcome.t, 'welcome');
  assert.ok(welcome.token);
  assert.equal(registry.size, 1);
  // disconnect it (the session survives for the reconnect window)
  network.onClose(network.conns.get(ws2));

  guard.blocked = true;
  const ws3 = mkWs();
  network.handleConnection(ws3, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  network.onFrame(network.conns.get(ws3), JSON.stringify({ t: 'hello', name: '老玩家', token: welcome.token, rid: 3 }), false);
  const resumed = JSON.parse(ws3.sent.at(-1));
  assert.equal(resumed.t, 'welcome');
  assert.equal(resumed.resumed, true, 'token reconnect passes the red gate');
  assert.equal(registry.size, 1, 'no extra session');

  network.close();
});
