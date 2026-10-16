import { createRoomDirectoryApi } from './roomDirectory.js';
// Read-only public HTTP APIs. Project only documented fields, never session ids or private match data.
import { createHash } from 'node:crypto';
import { DIFFICULTY_NAMES, MAX_SEATS } from '../shared/constants.js';
import { isSoloRoomMode } from '../shared/infiniteMode.js';
import { clientAddress, limitKeyOf, TokenBucket } from './net.js';

export function roomStatus(room, serverNow) {
  if (!room || room.disposed) return null;
  const inMatch = !!room.match;
  // Read the last published frame: querying must not calculate a new match view or expose unbroadcast progress.
  const pub = inMatch && room.matchCtx?.lastPublic ? JSON.parse(room.matchCtx.lastPublic) : null;
  const players = new Map((pub?.players || []).map((p) => [p.playerId, p]));
  const capacity = isSoloRoomMode(room.mode) ? 1 : MAX_SEATS;
  const seats = room.seats.slice(0, capacity).map((s) => {
    if (!s) return null;
    const p = players.get(s.playerId);
    return {
      seat: s.seat, name: s.name, isBot: !!s.isBot, isHost: s.playerId === room.hostId,
      connected: !!s.connected && !s.left, ready: p ? !!p.ready : !!s.ready,
      ...(p ? { alive: !!p.alive, lp: Number.isFinite(p.lp) ? p.lp : null,
        pendingLp: Number.isFinite(p.pendingLp) ? Math.max(0, p.pendingLp) : 0 } : {}),
    };
  });
  const occupied = seats.filter(Boolean).length;
  const humans = seats.filter((s) => s && !s.isBot).length;
  return {
    code: room.code, mode: room.mode, difficulty: room.difficulty,
    difficultyName: DIFFICULTY_NAMES[room.difficulty] || room.difficulty,
    inMatch, joinable: room.mode === 'coop' && !inMatch && occupied < capacity,
    capacity, occupied, humans, bots: occupied - humans,
    connectedHumans: seats.filter((s) => s && !s.isBot && s.connected).length,
    phase: inMatch ? pub?.phase || room.match.phase || 'LOBBY' : 'LOBBY',
    round: inMatch && Number.isFinite(pub?.round) ? pub.round : 0,
    lastRound: inMatch && Number.isFinite(pub?.lastRound) ? pub.lastRound : null,
    deadline: inMatch && Number.isFinite(pub?.deadline) ? pub.deadline : 0,
    paused: inMatch && !!pub?.paused, seats, serverNow,
  };
}

/** Returns true if this API router handled the request. Address resolution shares the WebSocket TRUST_PROXY rules. */
function botRoomSummary(room) {
  const seats = room.seats.filter(seat => seat && !seat.left);
  const host = room.seatOf(room.hostId);
  return {
    code: room.code, mode: room.mode, difficulty: room.difficulty,
    playerCount: seats.length, maxPlayers: isSoloRoomMode(room.mode) ? 1 : MAX_SEATS,
    status: room.match ? 'playing' : 'waiting',
    hostName: host && !host.left ? host.name : null,
    players: seats.map(seat => seat.name),
    url: '/?room=' + room.code,
  };
}

export function createPublicApi({ lobby, announcements, trustProxy, sendJson, sendError, now = Date.now }) {
  // SP_ROOM_DIRECTORY_V1: list route; existing bot/status APIs remain below.
  const handleRoomDirectory = createRoomDirectoryApi({ lobby, trustProxy, sendJson, now });
  const createBuckets = new Map();
  let createSweptAt = now();
  const buckets = new Map();
  let sweptAt = now();
  let announcementReadAt = now();
  return async (req, res, pathname) => {
    if (handleRoomDirectory(req, res, pathname)) return true;
    if (/^\/api\/rooms(?:\/|$)/i.test(pathname)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const at = now();
      if (at - sweptAt >= 60000) {
        for (const [key, bucket] of buckets) if (at - bucket.at >= 60000) buckets.delete(key);
        sweptAt = at;
      }
      const { ip } = clientAddress(req, trustProxy);
      // Unlike game admission, this query budget also applies to loopback and private networks.
      const key = limitKeyOf(ip);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = new TokenBucket(2, 10, at); buckets.set(key, bucket); }
      if (!bucket.take(at)) {
        res.setHeader('Retry-After', '1');
        sendJson(req, res, 429, { error: 'RATE_LIMITED' });
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(req, res, 405, { error: 'METHOD_NOT_ALLOWED' });
      } else {
        if (pathname === '/api/rooms') {
          const query = new URL(req.url, 'http://localhost').searchParams;
          if (query.has('code')) {
            const code = query.get('code').trim().toUpperCase();
            if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
              sendJson(req, res, 400, { ok: false, error: 'INVALID_CODE' }); return true;
            }
            const room = lobby.getRoom(code);
            const exists = !!room && !room.disposed;
            sendJson(req, res, 200, {
              ok: true, exists, room: exists ? botRoomSummary(room) : null,
            });
          } else {
            const rooms = [...lobby.rooms.values()].filter(room => !room.disposed && !room.private).map(botRoomSummary);
            sendJson(req, res, 200, { ok: true, count: rooms.length, rooms });
          }
          return true;
        }
        const match = /^\/api\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ]{4})\/status$/i.exec(pathname);
        const status = match ? roomStatus(lobby.getRoom(match[1]), at) : null;
        sendJson(req, res, status ? 200 : 404, status || { error: 'ROOM_NOT_FOUND' });
      }
      return true;
    }
    if (pathname === '/api/create_room' || pathname === '/api/create-room') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST, OPTIONS');
        sendJson(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return true;
      }
      const at = now();
      if (at - createSweptAt >= 60000) {
        for (const [key, bucket] of createBuckets)
          if (at - bucket.at > 600000) createBuckets.delete(key);
        createSweptAt = at;
      }
      const ownerKey = limitKeyOf(clientAddress(req, trustProxy).ip);
      let budget = createBuckets.get(ownerKey);
      if (!budget) { budget = new TokenBucket(0.1, 3, at); createBuckets.set(ownerKey, budget); }
      if (!budget.take(at)) {
        res.setHeader('Retry-After', '10');
        sendJson(req, res, 429, { ok: false, error: 'RATE_LIMITED' }); return true;
      }
      let body = {};
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        try {
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > 4096) {
              sendJson(req, res, 413, { ok: false, error: 'BODY_TOO_LARGE' }); return true;
            }
            chunks.push(bytes);
          }
          const text = Buffer.concat(chunks).toString('utf8').trim();
          if (text) body = JSON.parse(text);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
        } catch {
          sendJson(req, res, 400, { ok: false, error: 'INVALID_JSON' }); return true;
        }
      }
      const query = new URL(req.url, 'http://localhost').searchParams;
      const raw = query.get('diff') ?? query.get('difficulty') ?? body.diff ?? body.difficulty ?? 'FUNNY';
      const aliases = {
        '1': 'FUNNY', '标准': 'FUNNY', FUNNY: 'FUNNY',
        '2': 'NORMAL', '险境': 'NORMAL', NORMAL: 'NORMAL',
        '3': 'HARD', '绝境': 'HARD', HARD: 'HARD',
        '4': 'ABYSS', '终极': 'ABYSS', ABYSS: 'ABYSS',
      };
      const key = String(raw).trim().toUpperCase();
      const difficulty = Object.hasOwn(aliases, key) ? aliases[key] : null;
      if (!difficulty) {
        sendJson(req, res, 400, { ok: false, error: 'INVALID_DIFFICULTY' }); return true;
      }
      const room = lobby.createBotRoom({ difficulty, ownerKey });
      if (!room) {
        sendJson(req, res, 503, { ok: false, code: 1, status: 'error', error: 'ROOM_LIMIT' }); return true;
      }
      const code = room.code;
      const url = 'https://sp.isomer319.xyz/?room=' + code;
      const data = {
        roomCode: code, room_code: code, roomId: code, room_id: code,
        code, url, link: url, difficulty: room.difficulty,
      };
      sendJson(req, res, 200, {
        ok: true, code: 0, status: 'success', msg: 'success',
        roomCode: code, room_code: code, roomId: code, room_id: code,
        url, link: url, difficulty: room.difficulty, data,
      });
      return true;
    }
  if (pathname === '/api/ping') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); }
      else if (req.method === 'GET' || req.method === 'HEAD') sendJson(req, res, 200, { ok: true });
      else {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        sendJson(req, res, 405, { error: 'METHOD_NOT_ALLOWED' });
      }
      return true;
    }
    if (pathname === '/api/announcement') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
        return true;
      }
      // Reuse the existing schedule and reload at most once per second for HTTP readers.
      if (now() - announcementReadAt >= 1000) {
        announcementReadAt = now();
        await announcements.reload();
      } else if (announcements.pending) await announcements.pending;
      announcements.refresh();
      const serverTime = announcements.now();
      const active = announcements.lastError ? null : announcements.current;
      let announcement = null;
      if (active) {
        const content = { title: active.title || '维护公告', text: active.text, expiresAt: active.endAt };
        const id = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 24);
        announcement = { id, ...content };
      }
      sendJson(req, res, 200, { announcement, serverTime });
      return true;
    }
    return false;
  };
}
