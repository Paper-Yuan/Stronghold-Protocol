// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB;
//                      refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the content packs (/packs/index.json, /packs/<id>/<file> — the registry is packs.js)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400 / 405, GET /healthz → JSON status, else static
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { send } from './net.js';
import { Announcements } from './announcements.js';
import { AdminService, recordAdminLog } from './admin.js';
import { mountPlayerAdmin } from './playerAdmin.js';
import { createPublicApi } from './publicApi.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';
import { sendJson, sendError, splitUrl } from './http/common.js';
import { netOptionsFrom } from './http/config.js';
export { rewriteAssetPaths } from '../shared/cdn.js';
const MAX_URL_LENGTH = 4096;
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > limit) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function isPrivateAddress(addr) {
  if (!addr) return false;
  const a = String(addr).toLowerCase().replace(/^::ffff:/, '');
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const o1 = +v4[1];
    const o2 = +v4[2];
    return o1 === 10 || o1 === 127 || (o1 === 192 && o2 === 168) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 100 && o2 >= 64 && o2 <= 127) // RFC 6598 CGNAT (Tailscale, ZeroTier, UU 等虚拟专网)
      || (o1 === 169 && o2 === 254);
  }
  return /^f[cd][0-9a-f]{1,2}:/.test(a); // IPv6 unique-local (fc00::/7)
}

import { getData, loadData } from './data.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack } from './http/websocket.js';
import { DATA_SHIM_JS } from './http/static.js';
import { createStaticHandler } from './http/customStatic.js';
import { createPackRegistry } from './packs.js';
import { MIME, COMPRESSIBLE, acceptsGzip, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 * }} [opts]
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPackRegistry>,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir } = serveDirs(opts);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const netOptions = netOptionsFrom(opts);
  const origInfo = log.info;
  const origWarn = log.warn;
  const origError = log.error;
  log.info = (...args) => { recordAdminLog('info', args.map(String).join(' ')); return origInfo?.apply(log, args); };
  log.warn = (...args) => { recordAdminLog('warn', args.map(String).join(' ')); return origWarn?.apply(log, args); };
  log.error = (...args) => { recordAdminLog('error', args.map(String).join(' ')); return origError?.apply(log, args); };

  const { registry, lobby, network } = createSessionStack(opts, { data, log });
  const packs = createPackRegistry({ publicDir, dataDir, packsDir }, { log });
  packs.refresh(true);
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, packsDir, packs, log });
  lobby.network = network;
  const announcementFile = opts.announcementsFile !== undefined ? opts.announcementsFile
    : (process.env.SP_ANNOUNCEMENTS_FILE || path.join(ROOT, 'config/announcements.json'));
  const announcements = new Announcements({ file: announcementFile ? path.resolve(announcementFile) : null,
    broadcast: msg => network.broadcast(msg), log, pollMs: opts.announcementPollMs });
  await announcements.start();
  const serveApi = createPublicApi({ lobby, announcements, trustProxy: netOptions.trustProxy, sendJson, sendError });
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const admin = new AdminService({
    lobby, network, registry, startedAt,
    buildTag: () => buildTag(),
    secret: opts.adminSecret || process.env.ADMIN_SECRET,
  });

  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  });

  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (await serveApi(req, res, parts.rawPath)) return;
    if (parts.rawPath === '/admin' || parts.rawPath === '/admin/') {
      await serveStatic(req, res, '/admin/index.html', parts.query);
      return;
    }
    if (parts.rawPath.startsWith('/api/admin/')) {
      if (!admin.authenticate(req)) {
        sendJson(req, res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }
      if (parts.rawPath === '/api/admin/overview' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(req, res, 200, admin.getOverview());
        return;
      }
      if (parts.rawPath === '/api/admin/rooms' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(req, res, 200, admin.getRooms());
        return;
      }
      if (parts.rawPath === '/api/admin/logs' && (req.method === 'GET' || req.method === 'HEAD')) {
        const since = Number(new URLSearchParams(parts.query).get('since')) || 0;
        sendJson(req, res, 200, admin.getLogs(since));
        return;
      }
      if (parts.rawPath === '/api/admin/broadcast' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const ok = admin.broadcast(body.message);
          sendJson(req, res, 200, { ok });
        } catch {
          sendJson(req, res, 400, { ok: false, error: 'Invalid JSON' });
        }
        return;
      }
      if (parts.rawPath === '/api/admin/drain' && req.method === 'POST') {
        admin.startDrain();
        sendJson(req, res, 200, { ok: true, draining: true });
        return;
      }
      sendJson(req, res, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/metrics') {
      sendJson(req, res, 200, { ok: true, app: APP_VERSION, build: buildTag(),
        sockets: network.connectionCount, online: network.onlineCount, sessions: registry.size,
        ...lobby.stats(), matchmaking: network.matchmakingCounts, memory: process.memoryUsage(),
        announcements: announcements.stats() });
      return;
    }
    if (parts.rawPath === '/healthz') {
      sendJson(req, res, 200, {
        ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
        // older than this reloads itself, so a deploy reaches clients that never reload
        build: buildTag(),
        sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
      });
      return;
    }
    // LAN room probe, so a guest can join with only the 4-letter key: the phone sweeps its own /24 and asks each
    // server it finds whether that room is open. It answers with a yes/no plus seat counts — never a room list, and
    // nothing at all to a peer outside the private ranges, so a public or tunnelled client cannot enumerate codes.
    if (parts.rawPath === '/lan/room') {
      if (!isPrivateAddress(req.socket?.remoteAddress)) { sendError(req, res, 404, '未找到 · Not found'); return; }
      const code = String(new URLSearchParams(parts.query).get('code') || '').toUpperCase();
      const room = /^[A-Z0-9]{4}$/.test(code) ? lobby.getRoom(code) : null;
      if (!room || room.mode !== 'coop') { sendError(req, res, 404, '未找到 · Not found'); return; }
      sendJson(req, res, 200, {
        ok: true, code: room.code, mode: room.mode, difficulty: room.difficulty,
        seats: room.seats.length, humans: room.seats.filter((s) => s && !s.isBot).length, inMatch: !!room.match,
      });
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  server.on('clientError', (err, socket) => {
    if (err && err.code === 'ECONNRESET') { socket.destroy(); return; }
    try {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
    } catch { /* ignore */ }
  });

  const playerAdmin = await mountPlayerAdmin({ server, network, lobby, registry,
    configFile: opts.adminConfigFile || process.env.SP_ADMIN_CONFIG || path.join(ROOT, 'config/player-admin/config.json'),
    announcementFile, publicDir, log });

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false });
  wss.on('connection', (ws, req) => { network.handleConnection(ws, req); announcements.refresh(); send(ws, announcements.message()); });
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    try {
      socket.setKeepAlive(true, 5000);
      socket.setNoDelay(true);
    } catch { /* ignore */ }
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
  } catch (e) {
    await playerAdmin.close();
    await announcements.stop();
    network.close(); // stop heartbeat/sweep timers of the half-built server
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await playerAdmin.close();
      await announcements.stop();
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      network.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, admin, playerAdmin, announcements, packs, close };
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
