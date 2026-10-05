// src/index.js — sp-lobby-board thin Cloudflare adapter: Module Worker + ONE Durable Object.
//
// EGRESS: board routes have none; the ONLY outbound requests are the community relay below, whose
// upstreams are FROZEN CONSTANTS (the client sends a source KEY, never a URL) — no SSRF surface.
// Every relay request still re-validates scheme + host (see targetHostDenyReason) per the standing
// constraint: http/https only, no loopback/private/reserved targets.
//
// ROUTES
//   OPTIONS *              CORS preflight (204)
//   GET  /api/rooms        rainya-shaped board: { ok, now, ttlSec:600, rooms:[...] }
//   POST /api/rooms        JSON { code, serverId, serverName, note?, url?, difficulty? } -> 201 { ok, added, token }
//   PATCH /api/rooms       JSON { code, serverId, note }  header X-Token      -> 200 { ok, updated }
//                          (only the note changes; createdAt/TTL/url are NOT refreshed)
//   DELETE /api/rooms?code=&serverId=      header X-Token: <token>          -> 200 { ok, removed }
//   GET  /api/community?src=rainya|lunar|rinko   relayed { ok, src, fetchedAt, rooms:[...] }
//   GET  /api/match?id=<handle>            queue/match status for one searcher
//   POST /api/match {difficulty, venue:{kind, serverId?}}    join the cross-server match queue
//   POST /api/match/room {id, code, serverId, url?}          header X-Token — the HOST posts the room
//   DELETE /api/match?id=<handle>          header X-Token — leave the queue / drop out of a match
//   GET  /api/health       { ok:true, now } — stateless liveness probe for deploy self-check
// Board responses carry `cache-control: no-store`; the community relay's 200 uses a short
// `public, max-age=10, s-maxage=10` so edge caching absorbs the 15s client poll, while every error
// path stays `no-store` (never let a 4xx/5xx poison the CDN — the negative-cache lesson).
// Error codes -> HTTP status: BAD_JSON/BAD_CODE/BAD_SERVER/BAD_URL/BAD_SRC/BAD_DIFFICULTY/BAD_VENUE/
// BAD_ID 400, FORBIDDEN 403, NOT_FOUND 404, METHOD_NOT_ALLOWED 405, RATE_LIMITED/DEBOUNCED/
// LIMIT_REACHED 429, INTERNAL 500.

import { createBoard, targetHostDenyReason, CODE_RE, TTL_SEC } from './board.js';
import { createMatch } from './match.js';

/** The single DO instance name — one board for every caller (singleton semantics). */
const BOARD_OBJECT_NAME = 'board';
/** The match queue lives in its OWN Durable Object (idFromName('match')) — queue and board never
 *  share storage, so neither can evict or corrupt the other's entries. */
const MATCH_OBJECT_NAME = 'match';
/** Max accepted JSON body size for POST/PATCH (bytes of the raw request text). */
const BODY_MAX = 8 * 1024;

/**
 * Community relay upstreams — FROZEN constants. The three community sources send no CORS headers
 * (rainya portal OPTIONS 403; lunar/rinko OPTIONS 405), so a browser/WebView page cannot read them
 * cross-origin; this relay is the door. The client only ever sends the KEY (`src`).
 */
const COMMUNITY_SOURCES = Object.freeze({
  rainya: Object.freeze({ url: 'https://game.rainya.me/api/rooms' }),
  lunar: Object.freeze({
    url: 'https://stronghold.lunar.ag/api/rooms',
    host: 'stronghold.lunar.ag',
    serverId: 'lunar',
    serverName: 'Lunar',
  }),
  rinko: Object.freeze({
    url: 'https://xn--rlr.rinko.ai/api/rooms',
    host: 'xn--rlr.rinko.ai',
    serverId: 'rinko',
    serverName: '梨子湖',
  }),
});
/** Relay fetch timeout (tests override via env.RELAY_TIMEOUT_MS). */
const RELAY_TIMEOUT_MS = 4000;
/** Accepted upstream body size ceiling; larger responses are treated as upstream failure. */
const RELAY_MAX_TEXT = 256 * 1024;

/**
 * Map a lunar/rinko live-lobby row into the rainya-shaped row the client already understands.
 * `hostName` is the HOST PLAYER's name, not a server name — it becomes the note, and the fixed
 * station name goes into `server`/`serverName`. `leftSec` is synthetic (live rows have no TTL) so
 * the client's `left > 0` gate keeps working; `live: true` tells the UI to show 「在线」 instead.
 */
function mapLiveRoom(source, row) {
  if (!row || typeof row !== 'object') return null;
  const code = String(row.roomId || '').toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const occupied = Number.isInteger(row.occupied) ? row.occupied : null;
  const capacity = Number.isInteger(row.capacity) ? row.capacity : null;
  const full = occupied !== null && capacity !== null && capacity > 0 && occupied >= capacity;
  const out = {
    code,
    server: source.serverName,
    serverName: source.serverName,
    serverId: source.serverId,
    url: `https://${source.host}/?room=${code}`,
    leftSec: TTL_SEC,
    live: true,
    status: row.inMatch === true ? 'playing' : (full ? 'full' : 'waiting'),
  };
  if (typeof row.hostName === 'string' && row.hostName) out.note = `房主：${row.hostName}`.slice(0, 40);
  if (occupied !== null) out.occupied = occupied;
  if (capacity !== null) out.capacity = capacity;
  if (Number.isInteger(row.connectedHumans)) out.humans = row.connectedHumans;
  if (Number.isInteger(row.spectatorCount)) out.spectators = row.spectatorCount;
  if (typeof row.difficulty === 'string' && row.difficulty) out.difficulty = row.difficulty;
  return out;
}

/** Relay one community source. Returns { status, body, cache } — the caller attaches CORS. */
async function relayCommunity(src, env) {
  const source = Object.prototype.hasOwnProperty.call(COMMUNITY_SOURCES, src) ? COMMUNITY_SOURCES[src] : null;
  if (!source) return { status: 400, body: { ok: false, error: 'BAD_SRC' }, cache: 'no-store' };

  // Defensive validation even though every upstream is a frozen constant: scheme must be https and
  // the host must not be loopback/private/reserved (same deny table the board uses for submitted URLs).
  let target = null;
  try { target = new URL(source.url); } catch { target = null; }
  if (!target || target.protocol !== 'https:' || targetHostDenyReason(target.hostname)) {
    return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };
  }

  const timeoutMs = Number(env && env.RELAY_TIMEOUT_MS) > 0 ? Number(env.RELAY_TIMEOUT_MS) : RELAY_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual', // a 3xx is an upstream failure: never follow to another host
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };
  }
  if (!res.ok) return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };

  let text;
  try { text = await res.text(); } catch {
    return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };
  }
  if (text.length > RELAY_MAX_TEXT) {
    return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };
  }
  let data;
  try { data = JSON.parse(text); } catch {
    return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };
  }

  let rooms;
  if (src === 'rainya') {
    rooms = data && Array.isArray(data.rooms) ? data.rooms : null;
  } else {
    const items = data && Array.isArray(data.items) ? data.items : null;
    rooms = items ? items.map((row) => mapLiveRoom(source, row)).filter(Boolean) : null;
  }
  if (!rooms) return { status: 502, body: { ok: false, error: 'UPSTREAM' }, cache: 'no-store' };

  return {
    status: 200,
    body: { ok: true, src, fetchedAt: Date.now(), rooms },
    cache: 'public, max-age=10, s-maxage=10',
  };
}


const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Content-Type,X-Token,X-Device',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Attach the CORS headers every response must carry (incl. error responses) + a cache policy. */
function withCors(response, cacheControl = 'no-store') {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  headers.set('cache-control', cacheControl);
  return new Response(response.body, { status: response.status, headers });
}

function statusFor(error) {
  switch (error) {
    case 'BAD_JSON':
    case 'BAD_CODE':
    case 'BAD_SERVER':
    case 'BAD_URL':
    case 'BAD_DIFFICULTY':
    case 'BAD_VENUE':
    case 'BAD_ID':
      return 400;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'METHOD_NOT_ALLOWED':
      return 405;
    case 'RATE_LIMITED':
    case 'DEBOUNCED':
    case 'LIMIT_REACHED':
      return 429;
    default:
      return 500;
  }
}

async function readJsonBody(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.length > BODY_MAX) return { ok: false };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/**
 * The Durable Object class: a thin shell holding board state in DO storage (single instance).
 * `state.storage` is the Durable Object storage API (KV-style get/put/delete/list) — NOT the
 * Workers KV product — and the DO input gate serializes requests, so read-modify-write is safe.
 */
export class Board {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    const storage = state.storage;
    this.core = createBoard({
      state: {
        get: (key) => storage.get(key),
        put: (key, value) => storage.put(key, value),
        delete: (key) => storage.delete(key),
        list: () => storage.list(),
      },
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = (request.method || 'GET').toUpperCase();
    try {
      if (url.pathname === '/api/rooms' && method === 'GET') {
        // v5.2：访客搭车计数 —— 设备号（X-Device，页面 60s 轮询带上）优先，IP 兜底
        return json(await this.core.list(undefined, {
          visitorKey: request.headers.get('x-device') || '',
          ip: request.headers.get('x-client-ip') || '',
        }));
      }
      if (url.pathname === '/api/rooms' && method === 'POST') {
        const body = await readJsonBody(request);
        if (!body.ok) return json({ ok: false, error: 'BAD_JSON' }, 400);
        const ip = request.headers.get('x-client-ip') || '';
        const result = await this.core.add({ ...body.value, ip }); // header IP wins over any body field
        return json(result, result.ok ? 201 : statusFor(result.error));
      }
      if (url.pathname === '/api/rooms' && method === 'PATCH') {
        const body = await readJsonBody(request);
        if (!body.ok) return json({ ok: false, error: 'BAD_JSON' }, 400);
        // token comes from the header ONLY (body token, if any, is discarded)
        const result = await this.core.update({
          ...body.value,
          token: request.headers.get('x-token') || '',
        });
        return json(result, result.ok ? 200 : statusFor(result.error));
      }
      if (url.pathname === '/api/rooms' && method === 'DELETE') {
        const result = await this.core.remove({
          code: url.searchParams.get('code') || '',
          serverId: url.searchParams.get('serverId') || '',
          token: request.headers.get('x-token') || '',
        });
        return json(result, result.ok ? 200 : statusFor(result.error));
      }
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return json({ ok: false, error: 'INTERNAL', message: String((error && error.message) || error) }, 500);
    }
  }
}

/**
 * The cross-server match queue Durable Object — a separate singleton (idFromName('match')) running
 * the pure core in src/match.js. A coarse alarm (re-armed on every accepted mutation) sweeps expired
 * queue entries and matches so an abandoned queue does not linger between requests; a failure to arm
 * is never fatal (every request sweeps lazily anyway).
 */
export class MatchQueue {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    const storage = state.storage;
    this.core = createMatch({
      state: {
        get: (key) => storage.get(key),
        put: (key, value) => storage.put(key, value),
        delete: (key) => storage.delete(key),
        list: () => storage.list(),
      },
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = (request.method || 'GET').toUpperCase();
    try {
      if (url.pathname === '/api/match' && method === 'GET') {
        return json(await this.core.status({
          id: url.searchParams.get('id') || '',
          token: request.headers.get('x-token') || '',
        }));
      }
      if (url.pathname === '/api/match' && method === 'POST') {
        const body = await readJsonBody(request);
        if (!body.ok) return json({ ok: false, error: 'BAD_JSON' }, 400);
        const ip = request.headers.get('x-client-ip') || '';
        const result = await this.core.enqueue({ ...body.value, ip });
        if (result.ok) await this.arm();
        return json(result, result.ok ? 201 : statusFor(result.error));
      }
      if (url.pathname === '/api/match/room' && method === 'POST') {
        const body = await readJsonBody(request);
        if (!body.ok) return json({ ok: false, error: 'BAD_JSON' }, 400);
        const result = await this.core.setRoom({
          ...body.value,
          token: request.headers.get('x-token') || body.value.token || '',
        });
        return json(result, result.ok ? 200 : statusFor(result.error));
      }
      if (url.pathname === '/api/match' && method === 'DELETE') {
        const result = await this.core.cancel({
          id: url.searchParams.get('id') || '',
          token: request.headers.get('x-token') || '',
        });
        return json(result, result.ok ? 200 : statusFor(result.error));
      }
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return json({ ok: false, error: 'INTERNAL', message: String((error && error.message) || error) }, 500);
    }
  }

  async alarm() {
    try {
      const swept = await this.core.sweep();
      if (swept.pending) await this.arm();
    } catch { /* an alarm failure must never wedge the queue — requests sweep lazily */ }
  }

  async arm() {
    try {
      await this.state.storage.setAlarm(Date.now() + 30_000);
    } catch { /* alarms unavailable (older runtime): lazy sweeps still cover every request */ }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = (request.method || 'GET').toUpperCase();
    try {
      if (method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

      if (url.pathname === '/api/health') {
        if (method !== 'GET') return withCors(json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405));
        return withCors(json({ ok: true, now: Date.now() })); // stateless — no DO hop
      }

      if (url.pathname === '/api/community') {
        if (method !== 'GET') return withCors(json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405));
        // Strict source whitelist: exactly one `src` key, no extra parameters. Rejecting extras also
        // stops cache-busting query strings from punching holes in the edge cache.
        const keys = [...url.searchParams.keys()];
        const src = keys.length === 1 && keys[0] === 'src' ? url.searchParams.get('src') : '';
        const relayed = await relayCommunity(src, env);
        return withCors(json(relayed.body, relayed.status), relayed.cache);
      }

      if (url.pathname === '/api/match' || url.pathname === '/api/match/room') {
        if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
          return withCors(json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405));
        }
        // Forward to the MATCH queue DO (its own storage); the DO returns the final payload.
        const headers = new Headers();
        headers.set('x-client-ip', request.headers.get('CF-Connecting-IP') || '');
        const token = request.headers.get('X-Token');
        if (token) headers.set('x-token', token);
        let body;
        if (method === 'POST') {
          headers.set('content-type', 'application/json');
          body = await request.text();
        }
        const stub = env.MATCH.get(env.MATCH.idFromName(MATCH_OBJECT_NAME));
        const internal = new Request(`https://match.internal${url.pathname}${url.search}`, { method, headers, body });
        return withCors(await stub.fetch(internal));
      }

      if (url.pathname !== '/api/rooms') {
        return withCors(json({ ok: false, error: 'NOT_FOUND' }, 404));
      }
      if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
        return withCors(json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405));
      }

      // Forward to the singleton DO; the DO returns the final payload, we add the shared headers.
      const headers = new Headers();
      headers.set('x-client-ip', request.headers.get('CF-Connecting-IP') || '');
      const dev = request.headers.get('X-Device');
      if (dev) headers.set('x-device', dev);
      const token = request.headers.get('X-Token');
      if (token) headers.set('x-token', token);
      let body;
      if (method === 'POST' || method === 'PATCH') {
        headers.set('content-type', 'application/json');
        body = await request.text();
      }
      const stub = env.BOARD.get(env.BOARD.idFromName(BOARD_OBJECT_NAME));
      const internal = new Request(`https://board.internal${url.pathname}${url.search}`, { method, headers, body });
      return withCors(await stub.fetch(internal));
    } catch (error) {
      return withCors(json({ ok: false, error: 'INTERNAL', message: String((error && error.message) || error) }, 500));
    }
  },
};
