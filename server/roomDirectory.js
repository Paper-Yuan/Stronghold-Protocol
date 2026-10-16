import { isSoloRoomMode } from '../shared/infiniteMode.js';
import { MAX_SEATS } from '../shared/constants.js';
import { clientAddress, limitKeyOf, TokenBucket } from './net.js';

export function directoryRoom(room) {
  if (!room || room.disposed) return null;
  const seats = room.seats.filter(Boolean);
  const connectedHumans = seats.filter(
    s => !s.isBot && !s.left && s.connected
  ).length;
  return {
    code: room.code,
    mode: room.mode,
    difficulty: room.difficulty,
    random: !!room.random, variant: room.variant,
    visibility: room.visibility === 'public' ? 'public' : 'invite',
    playerCount: seats.length,
    maxPlayers: isSoloRoomMode(room.mode) ? 1 : MAX_SEATS,
    status: room.match ? 'playing' : 'waiting',
    hostName: seats.find(s => s.playerId === room.hostId)?.name || null,
    players: seats.map(s => s.name),
    connectedHumans,
    matching: !!room.matching,
    joinable: room.mode === 'coop' && !room.match &&
      !room.matching && room.freeSeat() >= 0,
    url: '/?room=' + encodeURIComponent(room.code)
  };
}

// Full list exposes public rooms. Known invitation codes resolve private rooms.
export function createRoomDirectoryApi({
  lobby, trustProxy, sendJson, now = Date.now
}) {
  const buckets = new Map();
  let swept = now();
  return (req, res, pathname) => {
    if (!/^\/api\/rooms\/*$/i.test(pathname)) return false;
    res.setHeader('X-SP-Room-Directory', '1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    const at = now();
    if (at - swept >= 60000) {
      for (const [key, value] of buckets) {
        if (at - value.at >= 60000) buckets.delete(key);
      }
      swept = at;
    }
    const key = limitKeyOf(clientAddress(req, trustProxy).ip);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(2, 10, at);
      buckets.set(key, bucket);
    }
    if (!bucket.take(at)) {
      res.setHeader('Retry-After', '1');
      sendJson(req, res, 429, { error: 'RATE_LIMITED' });
      return true;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      sendJson(req, res, 405, {
        error: 'METHOD_NOT_ALLOWED'
      });
      return true;
    }

    const query = new URL(req.url, 'http://localhost').searchParams;
    if (query.has('code')) {
      const code = query.get('code').trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) {
        sendJson(req, res, 400, { ok: false, error: 'INVALID_CODE' });
        return true;
      }
      const room = directoryRoom(lobby.getRoom(code));
      sendJson(req, res, 200, { ok: true, exists: !!room, room });
    } else {
      const rooms = [...lobby.rooms.values()]
        .filter(r => r.visibility === 'public')
        .map(directoryRoom).filter(Boolean);
      sendJson(req, res, 200, { ok: true, count: rooms.length, rooms });
    }
    return true;
  };
}
