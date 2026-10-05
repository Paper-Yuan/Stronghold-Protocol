// src/board.js — sp-lobby-board PURE CORE: the online-lobby room board ("房间牌").
//
// ZERO EGRESS: this file never calls fetch / XMLHttpRequest / WebSocket and never dials or probes a
// submitted URL — url validation below is SYNTAX-ONLY (WHATWG URL parsing + the deny table copied
// from tools/apk/overlay/sp-connect.mjs). The test suite stubs globalThis.fetch and asserts 0 calls.
// ZERO CF DEPENDENCY: no imports at all, so `node --test` can exercise the core directly with the
// in-memory adapter while src/index.js runs the exact same code on a Durable Object.
//
// CONTRACT (rainya-compatible, additive fields only):
//   list(now?, {visitorKey?, ip?}) -> { ok:true, now, ttlSec:600, visitors, rooms:[ { code, serverId,
//                serverName, note, ageSec, leftSec, url?, server, difficulty?, mode?, status?,
//                occupied?, capacity? } ] }   (v5.2: visitors = 120s 窗口内去重的大厅访客数；
//                直播字段全部为加法、缺省不输出；`now` is epoch ms)
//   add(input, now?)        -> { ok:true, added:<entry>, token } | { ok:false, error, message? }
//   remove(input, now?)     -> { ok:true, removed:{code,serverId} } | { ok:false, error, message? }
//   update(input, now?)     -> { ok:true, updated:{code,serverId,note,+直播字段} } | { ok:false, error, message? }
//                              (token + serverId must both match; v5.2 起除 note 外还可改
//                               mode/status/occupied/capacity —— 只覆盖本次带上者；TTL 永不刷新)
//
// STATE ADAPTER (supplied by the caller; async or sync, always awaited):
//   get(key) -> value | undefined
//   put(key, value)                  value must be structured-cloneable
//   delete(key)
//   list()   -> Map<key, value>      (any iterable of [key, value] pairs is accepted)
// Keys owned by this core:  room:<CODE>  (one entry)   rate:<ip>  (recent accepted timestamps).
// All read-modify-write happens inside one awaited request; the Durable Object input gate serializes
// requests for the singleton instance, so no advisory locking is needed.

export const TTL_SEC = 600;
export const TTL_MS = TTL_SEC * 1000;

/** Room-code alphabet, upper-case, no I/O (matches the shell/lobby client `^[A-HJ-NP-Z]{4}$`). */
export const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export const NOTE_MAX = 40; // characters (code points) after control-char stripping
/** v5.2：房主自报的直播字段（全员可见；非法值忽略，绝不因此拒绝整条提交）。 */
export const LIVE_STATUS = ['waiting', 'full', 'playing', 'closed'];
export const MODE_MAX = 12;
export const SEATS_MAX = 8;
/** v5.2：大厅访客窗口 —— 面板 60s 轮询一次，120s 窗口内按（设备号优先，IP 兜底）去重。 */
export const VISIT_WINDOW_MS = 120_000;
export const VISIT_KEY_MAX = 40;
export const SERVER_ID_MAX = 64;
export const SERVER_NAME_MAX = 64;
export const URL_MAX = 512;

/** Per-IP submission rate: accepted adds in a sliding 60 s window. */
export const IP_RATE_MAX = 10;
export const IP_RATE_WINDOW_MS = 60_000;
/** Same-code debounce: a live entry younger than this refuses a re-submit. */
export const CODE_DEBOUNCE_MS = 30_000;
/** Per-IP live (unexpired) entry cap. */
export const IP_ROOMS_MAX = 5;

/** Token = 128 bits, lowercase hex (32 chars). */
export const TOKEN_BYTES = 16;

/**
 * Reserved serverId / serverName values — client-internal / placeholder identifiers that are NOT
 * real joinable servers:
 *   sp-phone-host  the phone's local bridge service id; some clients upload it, producing a ghost
 *                  room that is visible to everyone but nobody can join (the 127.0.0.1 private URL
 *                  is already rejected by normalizeRoomUrl, but url-less submissions used to pass)
 *   local / auto   offline / "auto pick" placeholders
 * Compared trim()'d and lower-cased (case-insensitive), exact match only; add() rejects with
 * BAD_SERVER. Exported for tests/docs; the internal Set is the lookup table.
 */
export const RESERVED_SERVER_IDS = Object.freeze(['sp-phone-host', 'local', 'auto']);
const RESERVED_SERVER_SET = new Set(RESERVED_SERVER_IDS);
const isReservedServerField = (value) => RESERVED_SERVER_SET.has(String(value).trim().toLowerCase());

/**
 * Optional room difficulty (ADDITIVE, rainya-compatible) — display/filter only. Same whitelist as
 * the match queue's `DIFFS` (src/match.js; duplicated because this core has zero imports). A value
 * outside the whitelist is silently IGNORED (never an error) so old/new clients stay compatible;
 * it never affects visibility, rate limiting or the code debounce.
 */
export const DIFFICULTIES = Object.freeze(['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
const DIFFICULTY_SET = new Set(DIFFICULTIES);

const ROOM_PREFIX = 'room:';
const RATE_PREFIX = 'rate:';
const VISIT_PREFIX = 'visit:'; // v5.2 大厅访客（搭车计数，零额外请求）
const roomKey = (code) => ROOM_PREFIX + code;
const rateKey = (ip) => RATE_PREFIX + ip;

// --------------------------------------------------------------------------------------------------
// Host deny table — identical to tools/apk/overlay/sp-connect.mjs (the shell's /ws egress guard) so
// the board and the client agree on what "not a public target" means. The WHATWG URL parser runs
// first, so octal / hex / decimal / short-form IPv4 literals are already canonicalised to a strict
// dotted quad before this table sees them.
// --------------------------------------------------------------------------------------------------

/** @returns {number[] | null} [a,b,c,d] for a strict dotted quad, else null. */
function parseIPv4(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** @returns {number[] | null} eight 16-bit groups for an IPv6 literal (brackets optional), else null. */
function parseIPv6(text) {
  let s = String(text).trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (!s || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (chunk) => {
    if (!chunk) return [];
    const out = [];
    for (const piece of chunk.split(':')) {
      if (piece.includes('.')) {
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (head === null || tail === null) return null;
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // '::' must compress at least one group
    groups = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  return groups.length === 8 ? groups : null;
}

/** Deny table for IPv4 (peer-agnostic): loopback, private, link-local, CGNAT, reserved, multicast. */
function isDeniedV4(a, b, c) {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay anycast (deprecated)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  return false;
}

/** Deny table for IPv6 (mapped/compatible/NAT64 literals are checked against the IPv4 table). */
function isDeniedV6(g) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return true; // ::1
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::/96 (unspecified / compat / IPv4-compatible)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isDeniedV4(g6 >> 8, g6 & 0xff, g7 >> 8); // ::ffff:a.b.c.d
  }
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0) {
    return isDeniedV4(g6 >> 8, g6 & 0xff, g7 >> 8); // 64:ff9b::/96 NAT64
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

/** Strip brackets / trailing root dots; lowercase. */
function normalizeHostname(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  while (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

/** @returns {string | null} a human reason when the hostname must never be dialed, else null. */
export function targetHostDenyReason(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return 'empty host';
  const v4 = parseIPv4(h);
  if (v4) return isDeniedV4(v4[0], v4[1], v4[2]) ? 'IPv4 target is loopback/private/reserved' : null;
  if (h.includes(':')) {
    const groups = parseIPv6(h);
    if (!groups) return 'invalid IPv6 literal';
    return isDeniedV6(groups) ? 'IPv6 target is loopback/private/reserved' : null;
  }
  if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return 'localhost is not a remote target';
  if (h.endsWith('.localhost')) return '*.localhost is not a remote target';
  if (h.endsWith('.local')) return '.local is not a remote target';
  if (h.endsWith('.internal')) return '.internal is not a remote target';
  return null;
}

// ---- serverId/serverName 主机校验（纯语法，零出站） ------------------------------------------------
//
// 审计④：身份字段历史上只做 sanitizeField（控制字符 + 长度），提交 serverId:"127.0.0.1:3000"
// 或 "localhost" 会照单全收并公开展示。这里复用 targetHostDenyReason 的 deny 表，但只对
// 「看起来像主机 / URL」的值生效：
//   - 带 scheme（http://…）→ 交给 WHATWG URL 解析器取 hostname（顺带把 0x7f000001 /
//     0177.0.0.1 / 2130706433 / 127.1 等变体规范化为严格点分四段）后查表；
//   - [ipv6][:port]（方括号形式）→ 拆掉方括号与端口后直接查表（parseIPv6 覆盖映射/NAT64 形态）；
//   - host[:port]（单冒号端口写法）→ 拆掉端口，先判定「像主机」再查表；
//   - 其余一律视为普通文本放行：合法清单 id（xiaolubao / raiya 等无点）、中文站名、含冒号的
//     叙述文本都不在环回/私网表内，自然通过。（sp-phone-host 在 host deny 层同样放行，但 add()
//     另用 RESERVED_SERVER_IDS 拦截，见下。）

/** @returns {boolean} true when the text plausibly names a host: dotted quad/domain, a pure-numeric
 *  or 0x-hex IPv4 variant, or a loopback alias. Plain ids / Chinese names never match. */
function isHostLike(text) {
  const h = String(text || '').trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;
  if (h.includes('.')) return true; // 域名 / 点分 IPv4（含八进制、短形等带点变体）
  if (/^\d+$/.test(h)) return true; // 纯数字：WHATWG 视作十进制整数 IPv4（2130706433 → 127.0.0.1）
  if (/^0x[0-9a-f]+$/.test(h)) return true; // 0x 前缀十六进制 IPv4（0x7f000001 → 127.0.0.1）
  return false;
}

/**
 * @param {string} value  已通过 sanitizeField 的非空身份字段值
 * @returns {string | null} 拒绝原因（人类可读），放行返回 null
 */
export function serverFieldDenyReason(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // 1) 带 scheme：解析出 hostname 再查表（解析失败 = 不是 URL，当普通文本放行）
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.hostname && isDeniedTargetHost(url.hostname)) return 'server field looks like a loopback/private URL';
    } catch { /* fall through: not a parseable URL */ }
    return null;
  }
  // 2) 方括号 IPv6（可带端口）：拆掉括号/端口后直接查表
  const v6 = /^\[(.+)\](?::\d{1,5})?$/.exec(raw);
  if (v6) {
    return isDeniedTargetHost(v6[1]) ? 'server field looks like a loopback/private address' : null;
  }
  // 3) 拆端口：只认单冒号 + 数字端口的 host:port 写法；含冒号但不是该形态（如叙述文本）放行
  let host = raw;
  const port = /^([^:]+):(\d{1,5})$/.exec(host);
  if (port) host = port[1];
  // 4) 只有「像主机」的值才查表；先经 WHATWG 规范化（与 url 校验同款），解析失败退回原文
  if (!isHostLike(host)) return null;
  let canonical = host;
  try {
    canonical = new URL('http://' + host).hostname || host;
  } catch { /* 不是合法主机形态：保留原文查表 */ }
  if (isDeniedTargetHost(canonical)) {
    return 'server field looks like a loopback/private address';
  }
  return null;
}

/** @returns {boolean} true when the hostname is in the deny table. */
export function isDeniedTargetHost(hostname) {
  return targetHostDenyReason(hostname) !== null;
}

// --------------------------------------------------------------------------------------------------
// Field validation / sanitisation (pure, no I/O)
// --------------------------------------------------------------------------------------------------

/** Upper-case + trim; @returns {string | null} the canonical code or null when invalid. */
export function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

function stripControl(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, '');
}

function clipCodePoints(s, max) {
  const points = Array.from(s);
  return points.length > max ? points.slice(0, max).join('') : s;
}

/** Required server identity field: control chars stripped, trimmed, 1..max chars, else null. */
function sanitizeField(value, max) {
  if (value === undefined || value === null) return null;
  const s = stripControl(value).trim();
  if (!s) return null;
  return Array.from(s).length > max ? null : s;
}

/** Cosmetic note: control chars stripped, trimmed, truncated to NOTE_MAX code points. */
export function sanitizeNote(value) {
  if (value === undefined || value === null) return '';
  return clipCodePoints(stripControl(value).trim(), NOTE_MAX);
}

/**
 * Optional difficulty tag: trim + upper-case, must be in DIFFICULTIES. Anything else (wrong type,
 * unknown value, empty) returns null and the field is simply omitted — never an error, and never
 * a gate on visibility / rate limiting / debounce.
 * @returns {string | null} canonical difficulty, or null when absent/not whitelisted.
 */
export function normalizeDifficulty(value) {
  if (typeof value !== 'string') return null;
  const d = value.trim().toUpperCase();
  return DIFFICULTY_SET.has(d) ? d : null;
}

/** v5.2：房主自报的直播字段（mode/status/occupied/capacity，全部可选）。 */
function sanitizeLiveFields(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  const mode = sanitizeField(src.mode, MODE_MAX) || '';
  if (mode === 'coop' || mode === 'solo') out.mode = mode;
  const status = (sanitizeField(src.status, 12) || '').toLowerCase();
  if (LIVE_STATUS.includes(status)) out.status = status;
  if (Number.isInteger(src.occupied) && src.occupied >= 0 && src.occupied <= SEATS_MAX) out.occupied = src.occupied;
  if (Number.isInteger(src.capacity) && src.capacity >= 1 && src.capacity <= SEATS_MAX) out.capacity = src.capacity;
  return out;
}

/** v5.2：访客键（设备号或 IP）——控制字符剥除、限长、字符集 [A-Za-z0-9_.:-]（IP 的点/冒号要放行）。 */
export function sanitizeVisitorKey(value) {
  const s = stripControl(value === undefined || value === null ? '' : value).trim().slice(0, VISIT_KEY_MAX);
  return /^[A-Za-z0-9_.:-]+$/.test(s) ? s : '';
}

/**
 * Optional room url: http(s), <= URL_MAX chars, no userinfo, public host (deny table above).
 * @param {unknown} value
 * @returns {string | null} canonical href, or null when the value is not acceptable.
 */
export function normalizeRoomUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > URL_MAX) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null; // credentials must never ride the board
  if (!url.hostname) return null;
  if (url.port === '0') return null;
  if (isDeniedTargetHost(url.hostname)) return null;
  return url.href;
}

// --------------------------------------------------------------------------------------------------
// Entry helpers
// --------------------------------------------------------------------------------------------------

function fail(error, message) {
  return message ? { ok: false, error, message } : { ok: false, error };
}

function normalizeIp(value) {
  const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  return s ? s.slice(0, 64) : 'unknown';
}

const ipOf = (entry) => (typeof entry.ip === 'string' && entry.ip ? entry.ip : 'unknown');

/** Minimal forward-compatible shape check for stored entries (never touches unknown extra fields). */
function isRoomEntry(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.code === 'string'
    && CODE_RE.test(value.code)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && typeof value.token === 'string'
    && value.token.length > 0,
  );
}

function isExpired(entry, t) {
  return t - entry.createdAt >= TTL_MS;
}

/** Public entry view: rainya fields + additive serverId/serverName; token/ip/createdAt never leak. */
function toPublic(entry, t) {
  const ageSec = Math.max(0, Math.floor((t - entry.createdAt) / 1000));
  const out = {
    code: entry.code,
    server: typeof entry.serverName === 'string' ? entry.serverName : '',
    serverId: typeof entry.serverId === 'string' ? entry.serverId : '',
    serverName: typeof entry.serverName === 'string' ? entry.serverName : '',
    note: typeof entry.note === 'string' ? entry.note : '',
    ageSec,
    leftSec: Math.max(0, TTL_SEC - ageSec),
  };
  if (typeof entry.url === 'string' && entry.url) out.url = entry.url;
  if (typeof entry.difficulty === 'string' && entry.difficulty) out.difficulty = entry.difficulty;
  // v5.2 直播字段（加法；缺省不输出）
  if (typeof entry.mode === 'string' && entry.mode) out.mode = entry.mode;
  if (typeof entry.status === 'string' && entry.status) out.status = entry.status;
  if (Number.isInteger(entry.occupied)) out.occupied = entry.occupied;
  if (Number.isInteger(entry.capacity)) out.capacity = entry.capacity;
  return out;
}

function makeToken(random) {
  let bytes;
  if (typeof random === 'function') {
    bytes = random(TOKEN_BYTES);
  } else {
    const webcrypto = globalThis.crypto;
    if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
      throw new Error('board: webcrypto unavailable — cannot mint a token');
    }
    bytes = new Uint8Array(TOKEN_BYTES);
    webcrypto.getRandomValues(bytes);
  }
  const arr = Array.from(bytes || []);
  if (arr.length !== TOKEN_BYTES || arr.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new Error('board: random seam must return 16 bytes');
  }
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --------------------------------------------------------------------------------------------------
// Core factory
// --------------------------------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {{get: Function, put: Function, delete: Function, list: Function}} options.state
 * @param {(() => number) | number} [options.now]      clock seam (default Date.now)
 * @param {(n: number) => ArrayLike<number>} [options.random]  token seam (default webcrypto)
 */
export function createBoard({ state, now, random } = {}) {
  if (!state
    || typeof state.get !== 'function'
    || typeof state.put !== 'function'
    || typeof state.delete !== 'function'
    || typeof state.list !== 'function') {
    throw new TypeError('createBoard: state adapter must provide get/put/delete/list');
  }

  const clock = typeof now === 'function'
    ? () => Number(now())
    : Number.isFinite(now) ? () => Number(now) : () => Date.now();
  const at = (nowArg) => (Number.isFinite(nowArg) ? Number(nowArg) : clock());

  /** Load live entries, prune expired rooms / stale rate buckets / expired visitors.
   *  @returns {Promise<{rooms: object[], byCode: Map<string, object>, visitorKeys: Set<string>}>} */
  async function scan(t) {
    const listed = await state.list();
    const pairs = listed instanceof Map
      ? listed.entries()
      : (listed && typeof listed[Symbol.iterator] === 'function' ? listed : []);
    const rooms = [];
    const byCode = new Map();
    const visitorKeys = new Set(); // v5.2
    for (const pair of pairs) {
      if (!pair) continue;
      const key = pair[0];
      const value = pair[1];
      if (typeof key !== 'string') continue;
      if (key.startsWith(ROOM_PREFIX)) {
        if (!isRoomEntry(value)) {
          await state.delete(key);
          continue;
        }
        if (isExpired(value, t)) {
          await state.delete(key);
          continue;
        }
        rooms.push(value);
        byCode.set(value.code, value);
      } else if (key.startsWith(RATE_PREFIX)) {
        const kept = Array.isArray(value)
          ? value.filter((ts) => Number.isFinite(ts) && t - ts >= 0 && t - ts < IP_RATE_WINDOW_MS)
          : [];
        if (kept.length === 0) await state.delete(key);
        else if (kept.length !== value.length) await state.put(key, kept);
      } else if (key.startsWith(VISIT_PREFIX)) {
        // v5.2：窗口外的访客过期即清；存活者进集合供本次计数
        if (!Number.isFinite(value) || t - value >= VISIT_WINDOW_MS || t - value < 0) {
          await state.delete(key);
        } else {
          visitorKeys.add(key.slice(VISIT_PREFIX.length));
        }
      }
    }
    return { rooms, byCode, visitorKeys };
  }

  /** rainya-shaped board payload; expired entries are dropped (and pruned) here.
   *  v5.2：`opts.visitorKey`（设备号优先、IP 兜底）在**同一次请求里**记一个大厅访客，
   *  响应带 `visitors`（120s 窗口内去重）——「用户提交当前进度」零额外请求。 */
  async function list(nowArg, opts) {
    const t = at(nowArg);
    const { rooms, visitorKeys } = await scan(t);
    const visitorKey = sanitizeVisitorKey((opts && opts.visitorKey) || '')
      || sanitizeVisitorKey((opts && opts.ip) || '');
    if (visitorKey) {
      // 每次轮询都刷新时间戳：活跃访客始终留在窗口内（1 次写/轮询，与 60s 节奏同量级）
      visitorKeys.add(visitorKey);
      await state.put(VISIT_PREFIX + visitorKey, t);
    }
    rooms.sort((a, b) => b.createdAt - a.createdAt || (a.code < b.code ? -1 : 1)); // newest first
    return { ok: true, now: t, ttlSec: TTL_SEC, visitors: visitorKeys.size, rooms: rooms.map((entry) => toPublic(entry, t)) };
  }

  /**
   * Submit (or, after the 30 s debounce, re-submit) a room.
   * A present url that fails validation rejects the WHOLE submission (never silently dropped).
   */
  async function add(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

    const code = normalizeCode(raw.code);
    if (!code) return fail('BAD_CODE', 'code must match ^[A-HJ-NP-Z]{4}$ (upper-cased first)');

    const serverId = sanitizeField(raw.serverId, SERVER_ID_MAX);
    const serverName = sanitizeField(raw.serverName, SERVER_NAME_MAX);
    if (!serverId || !serverName) {
      return fail('BAD_SERVER', `serverId (1..${SERVER_ID_MAX}) and serverName (1..${SERVER_NAME_MAX}) are required`);
    }
    // 审计④：身份字段也不得携带环回/私网主机（此处两字段均已通过 sanitizeField，非空）
    const hostDeny = serverFieldDenyReason(serverId) || serverFieldDenyReason(serverName);
    if (hostDeny) {
      return fail('BAD_SERVER', 'serverId/serverName must not be a loopback/private address');
    }
    // 保留字：手机本机服务等内部 id 公开上传会造出「全服可见但谁也进不去」的幽灵房
    // （trim + 大小写不敏感，精确匹配；见 RESERVED_SERVER_IDS 注释）
    if (isReservedServerField(serverId) || isReservedServerField(serverName)) {
      return fail('BAD_SERVER', `serverId/serverName must not be a reserved placeholder (${RESERVED_SERVER_IDS.join('/')})`);
    }

    let url = null;
    if (raw.url !== undefined && raw.url !== null) {
      if (typeof raw.url !== 'string') return fail('BAD_URL', 'url must be a string');
      if (raw.url.trim() !== '') {
        url = normalizeRoomUrl(raw.url);
        if (!url) {
          return fail('BAD_URL', `url must be http(s), <= ${URL_MAX} chars, public host, no userinfo`);
        }
      }
    }

    const note = sanitizeNote(raw.note);
    // 可选难度：白名单外一律静默忽略（向后兼容旧客户端），绝不影响可见性/限流/防抖
    const difficulty = normalizeDifficulty(raw.difficulty);
    const ip = normalizeIp(raw.ip);

    const { rooms, byCode } = await scan(t);
    const existing = byCode.get(code);

    // Same-code debounce: a live entry younger than CODE_DEBOUNCE_MS refuses a re-submit. Older live
    // entries are replaced (and their token invalidated) instead of duplicated.
    if (existing && t - existing.createdAt < CODE_DEBOUNCE_MS) {
      return fail('DEBOUNCED', `code ${code} was submitted ${Math.floor((t - existing.createdAt) / 1000)}s ago; wait ${CODE_DEBOUNCE_MS / 1000}s`);
    }

    // Per-IP sliding-window rate limit (accepted adds only).
    const rk = rateKey(ip);
    const storedRate = await state.get(rk);
    const recent = (Array.isArray(storedRate) ? storedRate : [])
      .filter((ts) => Number.isFinite(ts) && t - ts >= 0 && t - ts < IP_RATE_WINDOW_MS);
    if (recent.length >= IP_RATE_MAX) {
      return fail('RATE_LIMITED', `at most ${IP_RATE_MAX} submissions per ${IP_RATE_WINDOW_MS / 1000}s per IP`);
    }

    // Per-IP live-entry cap; replacing your own entry does not grow the count.
    const liveForIp = rooms.filter((entry) => ipOf(entry) === ip).length;
    const grows = existing && ipOf(existing) === ip ? 0 : 1;
    if (liveForIp + grows > IP_ROOMS_MAX) {
      return fail('LIMIT_REACHED', `at most ${IP_ROOMS_MAX} live rooms per IP`);
    }

    const token = makeToken(random);
    const entry = { code, serverId, serverName, note, url, ip, token, createdAt: t, ...sanitizeLiveFields(raw) };
    if (difficulty) entry.difficulty = difficulty; // additive, display-only; absent stays absent
    await state.put(roomKey(code), entry);
    recent.push(t);
    await state.put(rk, recent.slice(-IP_RATE_MAX));
    return { ok: true, added: toPublic(entry, t), token };
  }

  /**
   * Destroy a room. The token stored with the entry must match, as must the submitting serverId.
   * @returns {Promise<{ok:true, removed:{code,serverId}} | {ok:false, error:string, message?:string}>}
   */
  async function remove(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

    const code = normalizeCode(raw.code);
    if (!code) return fail('BAD_CODE', 'code must match ^[A-HJ-NP-Z]{4}$ (upper-cased first)');

    const serverId = sanitizeField(raw.serverId, SERVER_ID_MAX);
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';

    const stored = await state.get(roomKey(code));
    if (!isRoomEntry(stored) || isExpired(stored, t)) {
      if (stored !== undefined && stored !== null) await state.delete(roomKey(code));
      return fail('NOT_FOUND', 'no live room for this code');
    }
    if (!token || token !== stored.token || !serverId || serverId !== stored.serverId) {
      return fail('FORBIDDEN', 'token / serverId do not match this room');
    }
    await state.delete(roomKey(code));
    return { ok: true, removed: { code, serverId: stored.serverId } };
  }

  /**
   * Edit a live room's note and/or its live fields (v5.2: mode/status/occupied/capacity — only the
   * ones carried in this call are overwritten; a note is always written, missing/blank = cleared,
   * matching add()). Ownership predicate is identical to remove(): the stored token AND the stored
   * serverId must match exactly. Every other field (createdAt, url, token, ip, difficulty) is left
   * untouched — createdAt in particular is preserved, so the TTL is NOT refreshed by an edit.
   * Rate limiting: intentionally no new bucket — reaching the mutation already requires matching
   * token+serverId (proof of ownership), exactly like remove(); failed attempts write nothing.
   * @returns {Promise<{ok:true, updated:{code,serverId,note, ...live} } | {ok:false, error:string, message?:string}>}
   */
  async function update(input, nowArg) {
    const t = at(nowArg);
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

    const code = normalizeCode(raw.code);
    if (!code) return fail('BAD_CODE', 'code must match ^[A-HJ-NP-Z]{4}$ (upper-cased first)');

    const serverId = sanitizeField(raw.serverId, SERVER_ID_MAX);
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';

    const stored = await state.get(roomKey(code));
    if (!isRoomEntry(stored) || isExpired(stored, t)) {
      if (stored !== undefined && stored !== null) await state.delete(roomKey(code));
      return fail('NOT_FOUND', 'no live room for this code');
    }
    if (!token || token !== stored.token || !serverId || serverId !== stored.serverId) {
      return fail('FORBIDDEN', 'token / serverId do not match this room');
    }

    // note 语义保持 v5.1（缺省/空白 = 清空）；v5.2 追加直播字段：只覆盖「本次带上」的那些，
    // 不刷新 TTL，也不动 createdAt/url/token/ip/difficulty。
    const note = sanitizeNote(raw.note);
    const live = sanitizeLiveFields(raw);
    await state.put(roomKey(code), { ...stored, note, ...live });
    return { ok: true, updated: { code, serverId: stored.serverId, note, ...live } };
  }

  return { list, add, remove, update };
}
