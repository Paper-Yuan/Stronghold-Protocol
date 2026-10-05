// src/match.js — sp-lobby cross-server alliance-match queue PURE CORE (同盟匹配).
//
// ZERO EGRESS / ZERO CF DEPENDENCY (same rules as board.js): no imports, no fetch, no dialing.
// The Durable Object adapter in index.js runs this exact code; `node --test` exercises it with an
// in-memory state seam (match-queue.test.mjs).
//
// MODEL — queue → 4-group → venue room:
//   enqueue  a waiting entry { id, token, difficulty, venue:{kind, serverId?}, app?, ip, joinedAt }
//   group    the 4 oldest waiters of ONE difficulty form a match; the host is the earliest member
//            whose venue.kind === 'public' (公开服优先), else the oldest member
//   room     the host posts the in-game room code it created on the venue; guests read it via status
//   TTLs     a waiting entry expires after QUEUE_TTL_MS; a match dissolves after MATCH_TTL_MS when
//            no room arrived; once the room is up the record lives ROOM_TTL_MS for the guests
//
// The queue is deliberately version-agnostic (the product decision: 非 app 也配对) — `app` rides
// along for display only and never gates grouping.
//
// STATE ADAPTER (supplied by the caller; async or sync, always awaited):
//   get(key) / put(key, value) / delete(key) / list() -> Map or [key, value][] (same as board.js)
// Keys owned here:  q:<id> (waiting)   m:<matchId> (formed)   i:<memberId> -> matchId   ops:<ip>

// The room URL a host posts is handed to OTHER players' clients, so it must pass the same public-host
// deny table the board applies to submitted URLs (loopback/private/reserved are never shareable).
// board.js is dependency-free too — this stays a pure, test-friendly import.
import { targetHostDenyReason } from './board.js';

export const DIFFS = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const VENUE_KINDS = ['public', 'local', 'custom'];

/** How many searchers make a group (the game's coop room is 4 seats). */
export const GROUP_SIZE = 4;
/** A waiting entry expires after this long without a group. */
export const QUEUE_TTL_MS = 90_000;
/** A formed match without a room dissolves after this long. */
export const MATCH_TTL_MS = 180_000;
/** After the room is posted the record stays readable for this long (guests' join window). */
export const ROOM_TTL_MS = 600_000;
/** Hard cap on simultaneously waiting entries (protects the DO from abuse). */
export const MAX_QUEUE = 60;
/** Accepted POST/DELETE operations per IP per window (status GETs are never rate-limited). */
export const IP_OPS_MAX = 30;
export const IP_OPS_WINDOW_MS = 60_000;
export const SERVER_ID_MAX = 64;
export const APP_MAX = 16;
export const TOKEN_BYTES = 16;
export const ID_BYTES = 8;

const Q = 'q:';
const M = 'm:';
const I = 'i:';
const OPS = 'ops:';

function fail(error, message) {
  return message ? { ok: false, error, message } : { ok: false, error };
}

function normalizeIp(value) {
  const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  return s ? s.slice(0, 64) : 'unknown';
}

function stripControl(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, '');
}

/** Optional identity field: control chars stripped, trimmed, 1..max chars, else ''. */
function sanitizeField(value, max) {
  if (value === undefined || value === null) return '';
  const s = stripControl(value).trim();
  if (!s || Array.from(s).length > max) return '';
  return s;
}

function makeHex(random, bytes) {
  let arr;
  if (typeof random === 'function') {
    arr = Array.from(random(bytes) || []);
  } else {
    const webcrypto = globalThis.crypto;
    if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
      throw new Error('match: webcrypto unavailable — cannot mint ids');
    }
    const buf = new Uint8Array(bytes);
    webcrypto.getRandomValues(buf);
    arr = Array.from(buf);
  }
  if (arr.length !== bytes || arr.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new Error('match: random seam must return the requested byte count');
  }
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isQueueEntry(v) {
  return Boolean(
    v && typeof v === 'object'
    && typeof v.id === 'string' && v.id
    && typeof v.token === 'string' && v.token
    && DIFFS.includes(v.difficulty)
    && typeof v.joinedAt === 'number' && Number.isFinite(v.joinedAt),
  );
}

function isMatchEntry(v) {
  return Boolean(
    v && typeof v === 'object'
    && typeof v.id === 'string' && v.id
    && typeof v.hostId === 'string'
    && Array.isArray(v.members) && v.members.length > 0
    && typeof v.createdAt === 'number' && Number.isFinite(v.createdAt)
    && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt),
  );
}

/** Public view of a waiting entry (token never leaks). */
function publicQueue(entry, t, waiting) {
  return {
    ok: true,
    state: 'waiting',
    id: entry.id,
    difficulty: entry.difficulty,
    waiting: typeof waiting === 'number' ? waiting : undefined,
    need: GROUP_SIZE,
    queuedSec: Math.max(0, Math.floor((t - entry.joinedAt) / 1000)),
  };
}

/** Public view of a formed match for one member. `id` is the caller's OWN handle (stable across
 *  queue → match, so the client keeps one {id, token} pair for status/setRoom/cancel). */
function publicMatch(match, memberId, t) {
  const host = match.hostId === memberId;
  const out = {
    ok: true,
    state: 'matched',
    id: memberId,
    role: host ? 'host' : 'guest',
    matchId: match.id,
    difficulty: match.difficulty,
    size: match.members.length,
    need: GROUP_SIZE,
    room: match.room
      ? {
        code: match.room.code,
        serverId: match.room.serverId,
        url: match.room.url || undefined,
        venueKind: match.room.venueKind,
      }
      : null,
    // the host sees the full member list (useful for the "3/4" style UI); guests only the count
    members: host
      ? match.members.map((m) => ({ id: m.id, venue: m.venue.kind, serverId: m.venue.serverId || '', app: m.app || '' }))
      : undefined,
    ageSec: Math.max(0, Math.floor((t - match.createdAt) / 1000)),
  };
  return out;
}

/**
 * @param {object} options
 * @param {{get: Function, put: Function, delete: Function, list: Function}} options.state
 * @param {(() => number) | number} [options.now]
 * @param {(n: number) => ArrayLike<number>} [options.random]
 */
export function createMatch({ state, now, random } = {}) {
  if (!state
    || typeof state.get !== 'function'
    || typeof state.put !== 'function'
    || typeof state.delete !== 'function'
    || typeof state.list !== 'function') {
    throw new TypeError('createMatch: state adapter must provide get/put/delete/list');
  }

  const clock = typeof now === 'function'
    ? () => Number(now())
    : Number.isFinite(now) ? () => Number(now) : () => Date.now();
  const at = (nowArg) => (Number.isFinite(nowArg) ? Number(nowArg) : clock());

  /** One pass over storage: prune expired entries/matches/op-windows. @returns {Promise<{queue: object[], matches: object[], pending: boolean}>} */
  async function sweep(t) {
    const listed = await state.list();
    const pairs = listed instanceof Map
      ? listed.entries()
      : (listed && typeof listed[Symbol.iterator] === 'function' ? listed : []);
    const queue = [];
    const matches = [];
    const dead = [];
    for (const pair of pairs) {
      if (!pair) continue;
      const key = pair[0];
      const value = pair[1];
      if (typeof key !== 'string') continue;
      if (key.startsWith(Q)) {
        if (!isQueueEntry(value) || t - value.joinedAt >= QUEUE_TTL_MS) dead.push(key);
        else queue.push(value);
      } else if (key.startsWith(M)) {
        if (!isMatchEntry(value) || value.expiresAt <= t) {
          dead.push(key);
          if (isMatchEntry(value)) {
            for (const m of value.members) dead.push(I + m.id);
          }
        } else {
          matches.push(value);
        }
      } else if (key.startsWith(I)) {
        if (typeof value !== 'string' || !value) dead.push(key);
      } else if (key.startsWith(OPS)) {
        const kept = Array.isArray(value)
          ? value.filter((ts) => Number.isFinite(ts) && t - ts >= 0 && t - ts < IP_OPS_WINDOW_MS)
          : [];
        if (!kept.length) dead.push(key);
        else if (kept.length !== value.length) await state.put(key, kept);
      }
    }
    for (const key of dead) await state.delete(key);
    // an index pointing at a swept match is dead too
    const liveIds = new Set(matches.map((m) => m.id));
    for (const pair of pairs) {
      if (!pair || typeof pair[0] !== 'string' || !pair[0].startsWith(I)) continue;
      if (typeof pair[1] === 'string' && !liveIds.has(pair[1])) await state.delete(pair[0]);
    }
    const pending = queue.length > 0 || matches.length > 0;
    return { queue, matches, pending };
  }

  /** Per-IP sliding window over accepted POST/DELETE ops. */
  async function takeOpSlot(ip, t) {
    const key = OPS + ip;
    const stored = await state.get(key);
    const recent = (Array.isArray(stored) ? stored : [])
      .filter((ts) => Number.isFinite(ts) && t - ts >= 0 && t - ts < IP_OPS_WINDOW_MS);
    if (recent.length >= IP_OPS_MAX) return false;
    recent.push(t);
    await state.put(key, recent.slice(-IP_OPS_MAX));
    return true;
  }

  /**
   * Join the queue (or learn you were grouped instantly).
   * input: { difficulty, venue:{kind, serverId?}, app?, ip }
   */
  async function enqueue(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const difficulty = String(raw.difficulty || '').trim().toUpperCase();
    if (!DIFFS.includes(difficulty)) {
      return fail('BAD_DIFFICULTY', `difficulty must be one of ${DIFFS.join('/')}`);
    }
    const venueRaw = raw.venue && typeof raw.venue === 'object' && !Array.isArray(raw.venue) ? raw.venue : {};
    const kind = String(venueRaw.kind || '').trim().toLowerCase();
    if (!VENUE_KINDS.includes(kind)) {
      return fail('BAD_VENUE', `venue.kind must be one of ${VENUE_KINDS.join('/')}`);
    }
    const serverId = sanitizeField(venueRaw.serverId, SERVER_ID_MAX);
    if (kind === 'public' && !serverId) return fail('BAD_VENUE', 'a public venue needs serverId');
    const app = sanitizeField(raw.app, APP_MAX);
    const ip = normalizeIp(raw.ip);

    if (!(await takeOpSlot(ip, t))) {
      return fail('RATE_LIMITED', `at most ${IP_OPS_MAX} match operations per ${IP_OPS_WINDOW_MS / 1000}s`);
    }

    const before = await sweep(t);
    if (before.queue.length >= MAX_QUEUE) return fail('LIMIT_REACHED', 'match queue is full right now');

    const entry = {
      id: makeHex(random, ID_BYTES),
      token: makeHex(random, TOKEN_BYTES),
      difficulty,
      venue: { kind, serverId },
      app,
      ip,
      joinedAt: t,
    };
    await state.put(Q + entry.id, entry);

    // group only waiters of the SAME difficulty; oldest first (fair), exactly GROUP_SIZE
    const bucket = before.queue
      .filter((e) => e.difficulty === difficulty)
      .concat([entry])
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    if (bucket.length >= GROUP_SIZE) {
      const members = bucket.slice(0, GROUP_SIZE);
      const host = members.find((m) => m.venue.kind === 'public') || members[0];
      const match = {
        id: makeHex(random, ID_BYTES),
        difficulty,
        hostId: host.id,
        members: members.map((m) => ({ id: m.id, token: m.token, venue: m.venue, app: m.app, joinedAt: m.joinedAt })),
        room: null,
        createdAt: t,
        expiresAt: t + MATCH_TTL_MS,
      };
      await state.put(M + match.id, match);
      for (const m of members) {
        await state.put(I + m.id, match.id);
        await state.delete(Q + m.id);
      }
      if (members.some((m) => m.id === entry.id)) {
        return { ...publicMatch(match, entry.id, t), token: entry.token };
      }
    }

    const waiting = bucket.length;
    return { ...publicQueue(entry, t, waiting), token: entry.token };
  }

  /** Poll a queue/match handle. input: { id, token? } */
  async function status(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const id = typeof raw.id === 'string' ? raw.id : '';
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';
    if (!id) return fail('BAD_ID', 'id is required');
    await sweep(t);

    const queued = await state.get(Q + id);
    if (isQueueEntry(queued)) {
      if (token && token !== queued.token) return fail('FORBIDDEN', 'token does not match this queue entry');
      const listed = await state.list();
      const pairs = listed instanceof Map ? listed.entries() : (listed || []);
      let waiting = 0;
      for (const pair of pairs) {
        if (pair && typeof pair[0] === 'string' && pair[0].startsWith(Q)
          && isQueueEntry(pair[1]) && pair[1].difficulty === queued.difficulty) waiting++;
      }
      return publicQueue(queued, t, waiting);
    }

    const matchId = await state.get(I + id);
    if (typeof matchId === 'string' && matchId) {
      const match = await state.get(M + matchId);
      if (isMatchEntry(match)) {
        const member = match.members.find((m) => m.id === id);
        if (!member) return { ok: true, state: 'expired' };
        if (token && token !== member.token) return fail('FORBIDDEN', 'token does not match this match');
        return publicMatch(match, id, t);
      }
    }
    return { ok: true, state: 'expired' }; // swept or unknown: the client re-queues
  }

  /** Host posts the in-game room it created on the venue. input: { id, token, code, serverId, url? } */
  async function setRoom(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const id = typeof raw.id === 'string' ? raw.id : '';
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';
    if (!id || !token) return fail('BAD_ID', 'id and token are required');

    const code = String(raw.code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z]{4}$/.test(code)) return fail('BAD_CODE', 'code must match ^[A-HJ-NP-Z]{4}$');
    const serverId = sanitizeField(raw.serverId, SERVER_ID_MAX);
    if (!serverId) return fail('BAD_SERVER', 'serverId is required');
    let url = undefined;
    if (raw.url !== undefined && raw.url !== null && String(raw.url).trim() !== '') {
      try {
        const u = new URL(String(raw.url));
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('BAD_URL', 'url must be http(s)');
        if (targetHostDenyReason(u.hostname)) return fail('BAD_URL', 'url must be a public host');
        url = u.href;
      } catch {
        return fail('BAD_URL', 'url must parse as a URL');
      }
    }

    await sweep(t);
    const matchId = await state.get(I + id);
    const match = typeof matchId === 'string' && matchId ? await state.get(M + matchId) : null;
    if (!isMatchEntry(match)) return fail('NOT_FOUND', 'no live match for this handle');
    if (match.hostId !== id) return fail('FORBIDDEN', 'only the host can post the room');
    const member = match.members.find((m) => m.id === id);
    if (!member || member.token !== token) return fail('FORBIDDEN', 'token does not match this match');

    match.room = { code, serverId, url, venueKind: member.venue.kind };
    match.expiresAt = t + ROOM_TTL_MS;
    await state.put(M + match.id, match);
    return { ok: true, room: match.room, state: 'matched' };
  }

  /** Leave the queue / dissolve a room-less match / drop out of a match with a room. input: { id, token } */
  async function cancel(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const id = typeof raw.id === 'string' ? raw.id : '';
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';
    if (!id || !token) return fail('BAD_ID', 'id and token are required');

    await sweep(t);
    const queued = await state.get(Q + id);
    if (isQueueEntry(queued)) {
      if (queued.token !== token) return fail('FORBIDDEN', 'token does not match this queue entry');
      await state.delete(Q + id);
      return { ok: true, removed: 'queue' };
    }
    const matchId = await state.get(I + id);
    const match = typeof matchId === 'string' && matchId ? await state.get(M + matchId) : null;
    if (!isMatchEntry(match)) return fail('NOT_FOUND', 'no live queue entry or match for this handle');
    const member = match.members.find((m) => m.id === id);
    if (!member || member.token !== token) return fail('FORBIDDEN', 'token does not match this match');
    // Always drop only our own handle: the group survives and the host seat passes to the oldest
    // remaining member — a host who leaves before opening the room must not strand the others.
    await state.delete(I + id);
    match.members = match.members.filter((m) => m.id !== id);
    if (!match.members.length) {
      await state.delete(M + match.id);
      return { ok: true, removed: 'match' };
    }
    if (match.hostId === id) match.hostId = match.members[0].id;
    await state.put(M + match.id, match);
    return { ok: true, removed: 'member' };
  }

  return { enqueue, status, setRoom, cancel, sweep };
}
