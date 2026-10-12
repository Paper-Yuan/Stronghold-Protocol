'use strict';
// Transport only: the existing game remains authoritative and keeps its sessions.
const http = require('node:http');
const WebSocket = require('ws');
const { createSkinDelta } = require('./skin-delta.cjs');
const MAX_QUEUE = 16 * 1024 * 1024;
function createRelay({ port = 3018, host = '127.0.0.1', upstream = 'ws://127.0.0.1:3035/ws', admission = null } = {}) {
  const peers = new Set();
  let closedLogical = 0, closedWire = 0, errors = 0, skinBytesSaved = 0;
  function stats() {
    let logical = closedLogical, wire = closedWire, compressed = 0, queued = 0;
    for (const p of peers) {
      logical += p.logical;
      wire += Math.max(0, p.front._socket.bytesWritten - p.startBytes);
      if (p.front.extensions.includes('permessage-deflate')) compressed++;
      queued += p.front.bufferedAmount;
    }
    return { ok: true, sockets: peers.size, compressed, logicalBytes: logical,
      wireBytes: wire, savedPercent: logical ? Math.round((1 - wire / logical) * 100) : 0,
      queuedBytes: queued, errors, skinBytesSaved, skinDeltaSockets: [...peers].filter(p => p.front.protocol === 'sp-skin-delta-v1').length };
  }
  const server = http.createServer((req, res) => {
    if (req.url !== '/healthz') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(stats()));
  });
  const wss = new WebSocket.WebSocketServer({ noServer: true, maxPayload: 64 * 1024,
    perMessageDeflate: { serverNoContextTakeover: true, clientNoContextTakeover: true,
      concurrencyLimit: 2, threshold: 1024, zlibDeflateOptions: { level: 1, memLevel: 5 } } });
  server.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== '/ws' || peers.size >= 1024) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, front => {
      front._socket.setNoDelay(true);
      const headers = {};
      // Only values supplied by the trusted local Nginx are forwarded. No payload logging.
      for (const key of ['host', 'origin', 'cookie', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto'])
        if (req.headers[key] != null) headers[key] = req.headers[key];
      const back = new WebSocket(upstream, { headers, perMessageDeflate: false,
        autoPong: false, handshakeTimeout: 5000, maxPayload: MAX_QUEUE });
      const skinDelta = front.protocol === 'sp-skin-delta-v1' ? createSkinDelta() : null;
      const peer = { front, back, logical: 0, startBytes: front._socket.bytesWritten };
      peers.add(peer);
      const guard = admission?.(front, req);
      let waiting = [], waitBytes = 0;
      const safeClose = (ws, code, reason) => {
        if (ws.readyState === WebSocket.CONNECTING) { ws.terminate(); return; }
        if (ws.readyState !== WebSocket.OPEN) return;
        if (code === 1005) ws.close();
        else if (code === 1006) ws.terminate();
        else ws.close(code, reason);
      };
      const transmit = (ws, data, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > MAX_QUEUE) { errors++; front.terminate(); back.terminate(); return; }
        ws.send(data, { binary }, err => { if (err) { errors++; front.terminate(); back.terminate(); } });
      };
      front.on('message', (data, binary) => {
        if (guard?.handle(data, binary)) return;
        if (back.readyState === WebSocket.OPEN) transmit(back, data, binary);
        else if (back.readyState === WebSocket.CONNECTING) {
          waitBytes += data.length;
          if (waitBytes > 64 * 1024) { errors++; front.close(1009); back.terminate(); return; }
          waiting.push([data, binary]);
        }
      });
      back.on('open', () => {
        if (front.readyState !== WebSocket.OPEN) { back.close(); return; }
        for (const [data, binary] of waiting) transmit(back, data, binary);
        waiting = []; waitBytes = 0;
      });
      back.on('message', (data, binary) => {
        const payload = skinDelta && !binary ? skinDelta(data) : data;
        skinBytesSaved += data.length - payload.length;
        peer.logical += payload.length; transmit(front, payload, binary);
      });
      // The real game's heartbeat still checks the browser, rather than the relay answering for it.
      back.on('ping', data => { if (front.readyState === WebSocket.OPEN) front.ping(data); });
      front.on('pong', data => { if (back.readyState === WebSocket.OPEN) back.pong(data); });
      front.on('close', (code, reason) => {
        if (peers.delete(peer)) {
          closedLogical += peer.logical;
          closedWire += Math.max(0, front._socket.bytesWritten - peer.startBytes);
        }
        waiting = []; safeClose(back, code, reason);
      });
      back.on('close', (code, reason) => safeClose(front, code, reason));
      front.on('error', () => { errors++; back.terminate(); });
      back.on('error', () => { errors++; safeClose(front, 1013, 'upstream unavailable'); });
    });
  });
  server.listen(port, host);
  return { server, wss, stats, close: () => { for (const p of peers) { p.front.terminate(); p.back.terminate(); } wss.close();server.close(); } };
}
module.exports = { createRelay };
if (require.main === module) {
  const { admissionFactory } = require('./admission.cjs');
  const policy = require('./admission-files.json');
  const relay = createRelay({ port: Number(process.env.PORT || 3019), host: process.env.RELAY_HOST || '127.0.0.1', upstream: process.env.UPSTREAM || 'ws://127.0.0.1:3035/ws', admission: admissionFactory(policy) });
  const stop = () => { relay.close();setTimeout(() => process.exit(0), 100).unref(); };
  process.on('SIGTERM', stop);process.on('SIGINT', stop);
}
