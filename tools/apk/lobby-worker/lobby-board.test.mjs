// lobby-board.test.mjs — node --test for the sp-lobby-board pure core (src/board.js) plus a thin
// adapter pass over src/index.js (Worker routing / CORS / DO dispatch with an in-memory storage).
//
// ZERO-EGRESS ASSERTION: globalThis.fetch is stubbed at load time; any outbound call increments the
// counter and throws. The final test and the `after` hook both require the counter to be 0.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBoard,
  CODE_RE,
  IP_RATE_MAX,
  IP_ROOMS_MAX,
  NOTE_MAX,
  TTL_SEC,
  serverFieldDenyReason,
} from './src/board.js';
import worker, { Board } from './src/index.js';

// --------------------------------------------------------------------------------------------------
// harness
// --------------------------------------------------------------------------------------------------

let fetchCalls = 0;
globalThis.fetch = (...args) => {
  fetchCalls += 1;
  throw new Error(`outbound fetch attempted (must never happen): ${String(args[0])}`);
};
after(() => {
  assert.equal(fetchCalls, 0, `board core/adapter made ${fetchCalls} outbound fetch call(s)`);
});

const T0 = 1_751_000_000_000;
const IP_A = '203.0.113.9';
const IP_B = '203.0.113.10';

/** In-memory state adapter; structured-clones like Durable Object storage does. */
function memoryState() {
  const store = new Map();
  const clone = (value) => structuredClone(value);
  return {
    _store: store,
    async get(key) { return store.has(key) ? clone(store.get(key)) : undefined; },
    async put(key, value) { store.set(key, clone(value)); },
    async delete(key) { store.delete(key); },
    async list() {
      const out = new Map();
      for (const [key, value] of store) out.set(key, clone(value));
      return out;
    },
  };
}

function makeBoard(t0 = T0) {
  const state = memoryState();
  let clock = t0;
  const board = createBoard({ state, now: () => clock });
  return { state, board, set: (t) => { clock = t; } };
}

const addInput = (over = {}) => ({
  code: 'ABCD',
  serverId: 'srv-a',
  serverName: 'raiya服',
  note: 'hello',
  ip: IP_A,
  ...over,
});

const rmInput = (over = {}) => ({ code: 'ABCD', serverId: 'srv-a', token: '', ...over });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // same as CODE_RE: no I, no O
const codeFor = (n) => ALPHABET[Math.floor(n / 26) % 26] + ALPHABET[n % 26] + 'ZZ';

const roomKeys = (state) => [...state._store.keys()].filter((key) => key.startsWith('room:'));

// --------------------------------------------------------------------------------------------------
// contract shape
// --------------------------------------------------------------------------------------------------

test('contract: rainya-compatible listing plus additive serverId/serverName', async () => {
  const { board } = makeBoard();
  const added = await board.add(addInput({ url: 'https://game.example.com:8443/?x=1' }), T0);
  assert.equal(added.ok, true);
  assert.match(added.token, /^[0-9a-f]{32}$/); // 128-bit hex
  assert.deepEqual(added.added, {
    code: 'ABCD',
    server: 'raiya服',
    serverId: 'srv-a',
    serverName: 'raiya服',
    note: 'hello',
    ageSec: 0,
    leftSec: TTL_SEC,
    url: 'https://game.example.com:8443/?x=1',
  });

  const out = await board.list(T0);
  assert.equal(out.ok, true);
  assert.equal(out.now, T0);
  assert.equal(out.ttlSec, 600);
  assert.equal(out.rooms.length, 1);
  const [room] = out.rooms;
  for (const key of ['code', 'server', 'note', 'ageSec', 'leftSec']) {
    assert.ok(key in room, `rainya field ${key} must be present`);
  }
  assert.equal(room.server, room.serverName); // rainya alias
  assert.equal('token' in room, false, 'token must never leak into listings');
  assert.equal('ip' in room, false, 'ip must never leak into listings');
  assert.equal('createdAt' in room, false, 'createdAt is internal');
});

test('contract: empty board and url-less rooms', async () => {
  const { board } = makeBoard();
  const empty = await board.list(T0);
  // v5.2: `visitors` is additive — an unpolled board reports 0
  assert.deepEqual(empty, { ok: true, now: T0, ttlSec: 600, visitors: 0, rooms: [] });

  const r1 = await board.add(addInput({ note: '' }), T0);
  assert.equal(r1.ok, true);
  assert.equal('url' in r1.added, false);
  const r2 = await board.add(addInput({ code: 'ABCE', url: '   ' }), T0 + 1000);
  assert.equal(r2.ok, true, 'blank url counts as absent');
  assert.equal('url' in r2.added, false);
});

// --------------------------------------------------------------------------------------------------
// TTL
// --------------------------------------------------------------------------------------------------

test('TTL: leftSec counts down, expired entries vanish and are pruned from state', async () => {
  const { board, state } = makeBoard();
  await board.add(addInput(), T0);

  const at1s = await board.list(T0 + 1_000);
  assert.equal(at1s.rooms[0].ageSec, 1);
  assert.equal(at1s.rooms[0].leftSec, 599);

  const at599s = await board.list(T0 + 599_000);
  assert.equal(at599s.rooms[0].ageSec, 599);
  assert.equal(at599s.rooms[0].leftSec, 1);

  const at600s = await board.list(T0 + 600_000);
  assert.deepEqual(at600s.rooms, []);
  assert.equal(await state.get('room:ABCD'), undefined, 'expired entry must be deleted');
  assert.deepEqual(roomKeys(state), []);

  const again = await board.add(addInput({ code: 'ABCE' }), T0 + 600_000);
  assert.equal(again.ok, true, 'expiry also lifts the code debounce');
});

// --------------------------------------------------------------------------------------------------
// field validation
// --------------------------------------------------------------------------------------------------

test('code: normalised to upper-case, strict [A-HJ-NP-Z]{4} enforced with nothing written', async () => {
  const { board } = makeBoard();
  const ok = await board.add(addInput({ code: ' abcd ' }), T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.added.code, 'ABCD');

  for (const bad of ['ABCDE', 'ABC', 'AB1D', 'ABID', 'ABOD', 'ABC-', '', null, 42, {}]) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ code: bad }), T0);
    assert.equal(res.ok, false, `code ${JSON.stringify(bad)} must be rejected`);
    assert.equal(res.error, 'BAD_CODE');
    assert.deepEqual(roomKeys(fresh.state), [], 'rejected submissions write nothing');
  }
  assert.equal(CODE_RE.test('ABID'), false);
});

test('serverId/serverName: required, control-char cleaned, length-capped', async () => {
  for (const bad of [
    { serverId: '' },
    { serverName: '' },
    { serverId: undefined },
    { serverName: undefined },
    { serverId: '\u0000\u0000' },
    { serverId: 'x'.repeat(65) },
    { serverName: 'x'.repeat(65) },
  ]) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput(bad), T0);
    assert.equal(res.ok, false, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(res.error, 'BAD_SERVER');
    assert.deepEqual(roomKeys(fresh.state), []);
  }
  const { board } = makeBoard();
  const ok = await board.add(addInput({ serverId: 'srv\u0007-b', serverName: ' raiya 服 ' }), T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.added.serverId, 'srv-b');
  assert.equal(ok.added.serverName, 'raiya 服');
});

test('note: control chars stripped, trimmed, truncated to 40 code points', async () => {
  const { board } = makeBoard();
  const long = 'a\u0000b\u0007c\n\t' + 'x'.repeat(100);
  const res = await board.add(addInput({ note: long }), T0);
  assert.equal(res.ok, true);
  assert.equal(res.added.note, 'abc' + 'x'.repeat(NOTE_MAX - 3));
  assert.equal(Array.from(res.added.note).length, NOTE_MAX);

  const fresh = makeBoard();
  const emoji = await fresh.board.add(addInput({ note: '😀'.repeat(41) }), T0);
  assert.equal(emoji.ok, true);
  assert.equal(Array.from(emoji.added.note).length, 40, 'truncation is surrogate-pair safe');
  assert.equal(emoji.added.note, '😀'.repeat(40));
});

test('difficulty: optional FUNNY|NORMAL|HARD|ABYSS (trim+upper); anything else silently ignored', async () => {
  // 白名单值：trim + 大写归一后随条目输出（加法字段）
  const withDif = await makeBoard();
  const hard = await withDif.board.add(addInput({ difficulty: 'hard' }), T0);
  assert.equal(hard.ok, true);
  assert.equal(hard.added.difficulty, 'HARD');
  const listed = await withDif.board.list(T0);
  assert.equal(listed.rooms[0].difficulty, 'HARD');
  const stored = withDif.state._store.get('room:ABCD');
  assert.equal(stored.difficulty, 'HARD', 'canonical value is what gets stored');

  for (const value of ['FUNNY', 'NORMAL', 'ABYSS', ' abyss ']) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ difficulty: value }), T0);
    assert.equal(res.ok, true, `${value} must be accepted`);
    assert.equal(res.added.difficulty, value.trim().toUpperCase());
  }

  // 非法值：静默忽略（提交照常成功、无该键、不报错），且不影响限流/防抖/可见性
  const fresh = makeBoard();
  const bogus = await fresh.board.add(addInput({ difficulty: 'NIGHTMARE' }), T0);
  assert.equal(bogus.ok, true, 'an unknown difficulty never rejects the submission');
  assert.equal('difficulty' in bogus.added, false, 'ignored difficulty leaves no key on added');
  const out = await fresh.board.list(T0);
  assert.equal(out.rooms.length, 1, 'the room is still fully visible');
  assert.equal('difficulty' in out.rooms[0], false, 'no difficulty key on the listed room');
  assert.equal(out.rooms[0].note, 'hello');
  for (const value of [undefined, null, '', '   ', 42, {}, ['HARD']]) {
    const b = makeBoard();
    const res = await b.board.add(addInput({ difficulty: value }), T0);
    assert.equal(res.ok, true, `difficulty ${JSON.stringify(value)} must be ignored, not rejected`);
    assert.equal('difficulty' in res.added, false, `difficulty ${JSON.stringify(value)} must not appear`);
  }
});

// --------------------------------------------------------------------------------------------------
// serverId/serverName host deny (审计④: 身份字段不得携带环回/私网主机)
// --------------------------------------------------------------------------------------------------

test('serverFieldDenyReason: host-shaped values hit the deny table; plain text passes', () => {
  const denied = [
    '127.0.0.1', // 环回点分四段
    '127.0.0.1:3000', // 环回 + 端口
    'localhost', // 环回别名
    'localhost:3000',
    'LOCALHOST:3000', // 大小写不敏感
    '10.0.0.5', // 10/8 私网
    '10.0.0.5:25565',
    '192.168.1.2:8080', // 192.168/16 私网 + 端口
    '172.16.5.5', // 172.16/12 私网
    '169.254.1.1', // link-local
    '100.64.0.1', // CGNAT
    '[::1]:3000', // IPv6 环回（方括号 + 端口）
    '[::1]',
    '[fe80::1]:80', // IPv6 link-local
    '[fc00::1]', // IPv6 ULA
    '[::ffff:127.0.0.1]', // IPv4-mapped 环回
    'http://127.0.0.1:3000/play', // 带 scheme 的 URL
    'https://localhost/admin',
    'http://10.0.0.5/',
    '2130706433', // 十进制整数 IPv4（点分四段的等价形态）
    '0x7f000001', // 十六进制 IPv4
    '0177.0.0.1', // 八进制 IPv4
    '127.1', // 短形 IPv4
    'foo.localhost', // *.localhost
    'x.local',
    'x.internal',
    'game.rainya.me.', // 结尾根点不影响环回/私网判定（此处公网 → 放行，见下方 allowed）
  ];
  for (const value of denied) {
    const expectDeny = value !== 'game.rainya.me.';
    assert.equal(serverFieldDenyReason(value) !== null, expectDeny, `${JSON.stringify(value)} deny=${expectDeny}`);
  }

  const allowed = [
    'sp-phone-host', // host deny 层放行（无点无端口）；add() 另有保留字拦截，见「reserved」用例
    'xiaolubao', // 签名清单 id（无点）
    'raiya', // 签名清单 id
    'tx-106-55', // 含数字与连字符的清单 id
    'mus5dhdzcc2e3b29',
    'raiya服', // 中文站名
    '小鹿宝 一区', // 含空格的中文叙述
    ' Raiya服 ', // 前后空白（sanitize 后已 trim，此处独立再验）
    'raiya:主服', // 含冒号但不是 host:port
    'v1.2', // 含点但不是合法 IPv4/域名语义上的私网目标（点分但非四段 → 不在 deny 表）
    'game.rainya.me', // 公网域名
    'game.rainya.me:38916', // 公网 host:port（浏览器兜底 location.host 形态）
    'game.rainya.me.', // 结尾根点
    'https://game.rainya.me/play', // 公网 URL
    'https://[2001:4860:4860::8888]/', // 公网 IPv6 URL（Google DNS，不在 deny 表）
    'not a host', // 普通文本
    '1.2', // 点分但非 IPv4、非环回别名
    '2130706433.5', // 含点但不是主机也不是 IPv4
  ];
  for (const value of allowed) {
    assert.equal(serverFieldDenyReason(value), null, `${JSON.stringify(value)} must be allowed`);
  }
});

test('add: serverId/serverName carrying a loopback/private host reject with BAD_SERVER', async () => {
  // 每个用例只污染一个字段，另一个字段保持合法值
  const bad = [
    '127.0.0.1:3000',
    'localhost',
    'localhost:3000',
    '10.0.0.5',
    '192.168.1.2:8080',
    '[::1]:3000',
    '2130706433', // 纯数字十进制 IPv4 整数形态
    'http://127.0.0.1:3000/play',
  ];
  for (const value of bad) {
    for (const field of ['serverId', 'serverName']) {
      const fresh = makeBoard();
      const res = await fresh.board.add(addInput({ [field]: value }), T0);
      assert.equal(res.ok, false, `${field}=${JSON.stringify(value)} must be rejected`);
      assert.equal(res.error, 'BAD_SERVER', `${field}=${JSON.stringify(value)} must fail with BAD_SERVER`);
      assert.match(res.message, /loopback\/private/, `${field}=${JSON.stringify(value)} carries the host-deny message`);
      assert.deepEqual(roomKeys(fresh.state), [], `rejected ${field}=${JSON.stringify(value)} writes nothing`);
    }
  }

  // 合法值照常通过（含空格/中文/公网域名/清单 id/空串语义）；sp-phone-host 现在由保留字规则
  // 拦截（见下方 reserved 用例），不再放在这里
  const good = [
    { serverId: 'tx-106-55', serverName: 'raiya服' },
    { serverId: 'xiaolubao', serverName: '小鹿宝' },
    { serverId: 'raiya', serverName: 'raiya服' },
    { serverId: 'game.rainya.me:38916', serverName: 'raiya服' }, // 浏览器兜底 location.host 形态（公网）
    { serverId: 'srv-a', serverName: 'raiya服', note: '' },
  ];
  let i = 0;
  for (const over of good) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ code: codeFor(i), ...over }), T0);
    assert.equal(res.ok, true, `case #${i} ${JSON.stringify(over)} must be accepted: ${JSON.stringify(res)}`);
    i += 1;
  }
});

// --------------------------------------------------------------------------------------------------
// reserved serverId/serverName (幽灵房防御: sp-phone-host / local / auto)
// --------------------------------------------------------------------------------------------------

test('reserved serverId/serverName: sp-phone-host / local / auto reject with BAD_SERVER', async () => {
  const bad = [
    { serverId: 'sp-phone-host' }, // 手机本机桥接服务内部 id
    { serverId: 'SP-PHONE-HOST' }, // 大小写不敏感
    { serverId: ' sp-phone-host ' }, // trim 后比较
    { serverName: 'sp-phone-host' },
    { serverName: 'LOCAL' }, // serverName 同样拦截
    { serverId: ' auto ' },
    { serverName: 'Auto' },
    { serverId: 'local' },
  ];
  for (const over of bad) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput(over), T0);
    assert.equal(res.ok, false, `${JSON.stringify(over)} must be rejected`);
    assert.equal(res.error, 'BAD_SERVER', `${JSON.stringify(over)} must fail with BAD_SERVER`);
    assert.match(res.message, /reserved/, `${JSON.stringify(over)} carries the reserved reason`);
    assert.deepEqual(roomKeys(fresh.state), [], `rejected ${JSON.stringify(over)} writes nothing`);
  }

  // 回环/私网拒绝与保留字是两套判据，互不干扰
  assert.equal(serverFieldDenyReason('sp-phone-host'), null, 'host deny 层仍放行（由 add() 的保留字拦截）');

  // 相似但不精确命中的 id / 正常公网 id 不受影响（回归）
  const good = ['xiaolubao', 'raiya', 'tx-106-55', 'sp-phone-host-2', 'local2', 'locally', 'auto-join', 'automatic'];
  let i = 0;
  for (const value of good) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ code: codeFor(i), serverId: value, serverName: value }), T0);
    assert.equal(res.ok, true, `${value} must stay accepted: ${JSON.stringify(res)}`);
    assert.equal(res.added.serverId, value);
    i += 1;
  }
});

// --------------------------------------------------------------------------------------------------
// url validation (syntax only — never dialled)
// --------------------------------------------------------------------------------------------------

test('url: public http(s) accepted; loopback/private/userinfo/oversize reject the whole submit', async () => {
  for (const url of ['https://game.example.com/', 'http://game.example.com:8080/a?b=1', 'https://example.com']) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ url }), T0);
    assert.equal(res.ok, true, `${url} should be accepted`);
    assert.equal(typeof res.added.url, 'string');
  }

  const bad = [
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://0x7f000001/', // hex IPv4
    'http://0177.0.0.1/', // octal IPv4
    'http://127.1/', // short-form IPv4
    'http://2130706433/', // decimal integer IPv4
    'http://localhost/',
    'http://localhost./',
    'http://foo.localhost/',
    'http://x.local/',
    'http://x.internal/',
    'http://192.168.1.1/',
    'http://172.16.5.5/',
    'http://172.31.255.255/',
    'http://169.254.1.1/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::2]/',
    'http://user:pw@game.example.com/',
    'http://user@game.example.com/',
    'ftp://game.example.com/',
    'javascript:alert(1)',
    'not a url',
    'https://',
    'https://' + 'a'.repeat(600) + '.example.com/',
  ];
  for (const url of bad) {
    const fresh = makeBoard();
    const res = await fresh.board.add(addInput({ url }), T0);
    assert.equal(res.ok, false, `${url} must be rejected`);
    assert.equal(res.error, 'BAD_URL', `${url} must fail with BAD_URL`);
    const out = await fresh.board.list(T0);
    assert.deepEqual(out.rooms, [], `nothing may be written for ${url}`);
  }

  const base = 'https://game.example.com/';
  const maxUrl = base + 'a'.repeat(512 - base.length);
  assert.equal(maxUrl.length, 512);
  const atCap = makeBoard();
  assert.equal((await atCap.board.add(addInput({ url: maxUrl }), T0)).ok, true, '512 chars is allowed');
  const overCap = makeBoard();
  const over = await overCap.board.add(addInput({ url: maxUrl + 'a' }), T0);
  assert.equal(over.ok, false);
  assert.equal(over.error, 'BAD_URL');
  assert.deepEqual(overCap.state._store.size, 0, 'a bad url never writes any state');

  const nonString = makeBoard();
  const ns = await nonString.board.add(addInput({ url: 42 }), T0);
  assert.equal(ns.ok, false);
  assert.equal(ns.error, 'BAD_URL');
});

// --------------------------------------------------------------------------------------------------
// rate limits
// --------------------------------------------------------------------------------------------------

test(`rate limit: ${IP_RATE_MAX} submissions per IP per sliding minute`, async () => {
  const { board } = makeBoard();
  for (let i = 0; i < IP_RATE_MAX; i += 1) {
    const at = T0 + i * 1_000;
    const added = await board.add(addInput({ code: codeFor(i) }), at);
    assert.equal(added.ok, true, `add #${i + 1} should pass`);
    const removed = await board.remove({ code: codeFor(i), serverId: 'srv-a', token: added.token }, at);
    assert.equal(removed.ok, true); // removal keeps the IP count low: this test isolates the rate rule
  }
  const blocked = await board.add(addInput({ code: codeFor(IP_RATE_MAX) }), T0 + 10_000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'RATE_LIMITED');

  // window slides: once the oldest submission leaves the 60 s window a slot frees up
  const freed = await board.add(addInput({ code: codeFor(IP_RATE_MAX) }), T0 + 61_000);
  assert.equal(freed.ok, true, JSON.stringify(freed));
});

test('code debounce: same code within 30 s refused; after that it replaces (token rotates)', async () => {
  const { board } = makeBoard();
  const first = await board.add(addInput(), T0);
  assert.equal(first.ok, true);

  const dupe = await board.add(addInput({ serverId: 'srv-b', serverName: 'second' }), T0 + 29_000);
  assert.equal(dupe.ok, false);
  assert.equal(dupe.error, 'DEBOUNCED');

  const replaced = await board.add(addInput({ serverId: 'srv-b', serverName: 'second' }), T0 + 30_000);
  assert.equal(replaced.ok, true);
  assert.notEqual(replaced.token, first.token);
  const rooms = await board.list(T0 + 30_000);
  assert.equal(rooms.rooms.length, 1, 'no duplicate codes');
  assert.equal(rooms.rooms[0].serverId, 'srv-b');

  const stale = await board.remove({ code: 'ABCD', serverId: 'srv-a', token: first.token }, T0 + 30_000);
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'FORBIDDEN');
  const live = await board.remove({ code: 'ABCD', serverId: 'srv-b', token: replaced.token }, T0 + 31_000);
  assert.equal(live.ok, true);
});

test(`per-IP cap: at most ${IP_ROOMS_MAX} live rooms, the 6th is LIMIT_REACHED`, async () => {
  const { board } = makeBoard();
  for (let i = 0; i < IP_ROOMS_MAX; i += 1) {
    const res = await board.add(addInput({ code: codeFor(i), ip: IP_B }), T0 + i * 1_000);
    assert.equal(res.ok, true, `room #${i + 1} should pass`);
  }
  const sixth = await board.add(addInput({ code: codeFor(IP_ROOMS_MAX), ip: IP_B }), T0 + 5_000);
  assert.equal(sixth.ok, false);
  assert.equal(sixth.error, 'LIMIT_REACHED');

  const otherIp = await board.add(addInput({ code: codeFor(IP_ROOMS_MAX), ip: '203.0.113.11' }), T0 + 5_000);
  assert.equal(otherIp.ok, true, 'the cap is per IP');

  // entries expire after TTL, freeing the slot again
  const afterExpiry = await board.add(addInput({ code: codeFor(IP_ROOMS_MAX + 1), ip: IP_B }), T0 + 600_000);
  assert.equal(afterExpiry.ok, true);
});

// --------------------------------------------------------------------------------------------------
// removal / token
// --------------------------------------------------------------------------------------------------

test('remove: correct token+serverId only; FORBIDDEN on mismatch; NOT_FOUND when absent/expired', async () => {
  const { board, state } = makeBoard();
  const added = await board.add(addInput(), T0);

  const wrongToken = await board.remove(rmInput({ token: 'f'.repeat(32) }), T0);
  assert.equal(wrongToken.ok, false);
  assert.equal(wrongToken.error, 'FORBIDDEN');
  const noToken = await board.remove(rmInput({ token: '' }), T0);
  assert.equal(noToken.ok, false);
  assert.equal(noToken.error, 'FORBIDDEN');
  const wrongServer = await board.remove(rmInput({ serverId: 'srv-b', token: added.token }), T0);
  assert.equal(wrongServer.ok, false);
  assert.equal(wrongServer.error, 'FORBIDDEN');
  assert.equal((await board.list(T0)).rooms.length, 1, 'failed removals change nothing');

  const unknown = await board.remove(rmInput({ code: 'ZZZZ', token: added.token }), T0);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'NOT_FOUND');

  const ok = await board.remove(rmInput({ token: added.token }), T0 + 1_000);
  assert.deepEqual(ok, { ok: true, removed: { code: 'ABCD', serverId: 'srv-a' } });
  assert.equal(state._store.has('room:ABCD'), false);
  assert.deepEqual((await board.list(T0 + 1_000)).rooms, []);
  const twice = await board.remove(rmInput({ token: added.token }), T0 + 1_000);
  assert.equal(twice.ok, false);
  assert.equal(twice.error, 'NOT_FOUND');

  const expired = makeBoard();
  const exp = await expired.board.add(addInput(), T0);
  const late = await expired.board.remove(rmInput({ token: exp.token }), T0 + 600_000);
  assert.equal(late.ok, false);
  assert.equal(late.error, 'NOT_FOUND');
  assert.deepEqual(roomKeys(expired.state), []);
});

// --------------------------------------------------------------------------------------------------
// note editing (PATCH /api/rooms -> core.update): same ownership as remove; TTL never refreshed
// --------------------------------------------------------------------------------------------------

test('update: token+serverId required, only note changes, TTL/createdAt untouched', async () => {
  const { board, state } = makeBoard();
  const added = await board.add(addInput({ url: 'https://game.example.com/', difficulty: 'HARD' }), T0);
  assert.equal(added.ok, true);

  // wrong token / wrong serverId / empty token → FORBIDDEN (same predicate as remove), nothing changes
  for (const bad of [
    { serverId: 'srv-a', token: 'f'.repeat(32), note: 'x' },
    { serverId: 'srv-b', token: added.token, note: 'x' },
    { serverId: 'srv-a', token: '', note: 'x' },
  ]) {
    const res = await board.update({ code: 'ABCD', ...bad }, T0 + 1_000);
    assert.equal(res.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(res.error, 'FORBIDDEN');
  }
  assert.equal(state._store.get('room:ABCD').note, 'hello', 'failed edits write nothing');

  const ok = await board.update(
    { code: ' abcd ', serverId: 'srv-a', token: added.token, note: '  joint now  ' },
    T0 + 100_000,
  );
  assert.deepEqual(ok, { ok: true, updated: { code: 'ABCD', serverId: 'srv-a', note: 'joint now' } });

  const [room] = (await board.list(T0 + 100_000)).rooms;
  assert.equal(room.note, 'joint now', 'note is what changed'); // trim 语义来自 sanitizeNote
  assert.equal(room.ageSec, 100, 'EDIT MUST NOT REFRESH THE TTL: ageSec still counts from submit');
  assert.equal(room.leftSec, 500);
  // list() must show every other field unchanged
  assert.equal(room.code, 'ABCD');
  assert.equal(room.serverId, 'srv-a');
  assert.equal(room.serverName, 'raiya服');
  assert.equal(room.server, 'raiya服');
  assert.equal(room.url, 'https://game.example.com/');
  assert.equal(room.difficulty, 'HARD', 'update does not touch difficulty');

  const stored = state._store.get('room:ABCD');
  assert.equal(stored.createdAt, T0, 'createdAt preserved');
  assert.equal(stored.token, added.token, 'token preserved (no rotation on edit)');
  assert.equal(stored.url, 'https://game.example.com/');
  assert.equal(stored.ip, IP_A, 'ip preserved');
  assert.equal(stored.difficulty, 'HARD');
});

test('update: note truncated/cleaned to 40 code points; NOT_FOUND when absent or expired', async () => {
  const { board, state } = makeBoard();
  const added = await board.add(addInput(), T0);

  const long = await board.update(
    { code: 'ABCD', serverId: 'srv-a', token: added.token, note: '\u0000go\u0007' + '😀'.repeat(50) + ' \t' },
    T0 + 1_000,
  );
  assert.equal(long.ok, true);
  assert.equal(long.updated.note, 'go' + '😀'.repeat(38), 'control chars stripped, trimmed, 40 code points');
  assert.equal(Array.from(long.updated.note).length, NOTE_MAX);

  // missing/blank note clears it (sanitizeNote('') === ''), matching add()
  const cleared = await board.update({ code: 'ABCD', serverId: 'srv-a', token: added.token }, T0 + 2_000);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.updated.note, '');
  assert.equal((await board.list(T0 + 2_000)).rooms[0].note, '');

  const badCode = await board.update({ code: 'nope', serverId: 'srv-a', token: added.token, note: 'x' }, T0 + 2_000);
  assert.equal(badCode.ok, false);
  assert.equal(badCode.error, 'BAD_CODE');

  const unknown = await board.update({ code: 'ZZZZ', serverId: 'srv-a', token: added.token, note: 'x' }, T0 + 2_000);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'NOT_FOUND');

  const expired = await board.update(
    { code: 'ABCD', serverId: 'srv-a', token: added.token, note: 'late' },
    T0 + 600_000,
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.error, 'NOT_FOUND');
  assert.deepEqual(roomKeys(state), [], 'expired entry is pruned by update');
});

// --------------------------------------------------------------------------------------------------
// adapter (src/index.js): routing, CORS, status mapping, DO dispatch
// --------------------------------------------------------------------------------------------------

function fakeEnv() {
  const storage = memoryState();
  const instance = new Board({ storage }, {});
  return {
    storage,
    env: { BOARD: { idFromName: (name) => `id:${name}`, get: () => ({ fetch: (req) => instance.fetch(req) }) } },
  };
}

async function callWorker(env, path, { method = 'GET', body, token, ip, rawBody } = {}) {
  const headers = new Headers();
  if (ip) headers.set('CF-Connecting-IP', ip);
  if (token) headers.set('X-Token', token);
  if (body !== undefined || rawBody !== undefined) headers.set('content-type', 'application/json');
  const req = new Request(`https://board.example.test${path}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  return { res, status: res.status, body: text ? JSON.parse(text) : null };
}

test('adapter: /api/health and CORS headers on every response', async () => {
  const health = await callWorker({}, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(typeof health.body.now, 'number');
  for (const [name, value] of [
    ['access-control-allow-origin', '*'],
    ['cache-control', 'no-store'],
  ]) {
    assert.equal(health.res.headers.get(name), value, `health must carry ${name}`);
  }

  const preflight = await callWorker({}, '/api/rooms', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.res.headers.get('access-control-allow-origin'), '*');
  assert.equal(preflight.res.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,DELETE,OPTIONS');
  assert.equal(preflight.res.headers.get('access-control-allow-headers'), 'Content-Type,X-Token,X-Device');
  assert.equal(preflight.res.headers.get('cache-control'), 'no-store');

  const missing = await callWorker({}, '/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.res.headers.get('access-control-allow-origin'), '*');

  const method = await callWorker({}, '/api/rooms', { method: 'PUT' });
  assert.equal(method.status, 405);
  assert.equal(method.body.error, 'METHOD_NOT_ALLOWED');
});

test('adapter: POST/GET/DELETE round-trip through the Durable Object + status mapping', async () => {
  const { env, storage } = fakeEnv();

  const created = await callWorker(env, '/api/rooms', {
    method: 'POST',
    ip: '203.0.113.50',
    body: { code: 'wxyz', serverId: 's1', serverName: 'raiya服', note: 'join us', url: 'https://game.example.com/' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.ok, true);
  assert.match(created.body.token, /^[0-9a-f]{32}$/);
  assert.equal(created.body.added.code, 'WXYZ');

  const listed = await callWorker(env, '/api/rooms');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.ttlSec, 600);
  assert.equal(listed.body.rooms.length, 1);
  assert.equal(listed.body.rooms[0].server, 'raiya服');

  const badToken = await callWorker(env, '/api/rooms?code=WXYZ&serverId=s1', { method: 'DELETE', token: 'bad' });
  assert.equal(badToken.status, 403);
  assert.equal(badToken.body.error, 'FORBIDDEN');

  const missingRoom = await callWorker(env, '/api/rooms?code=ZZZZ&serverId=s1', { method: 'DELETE', token: 'x' });
  assert.equal(missingRoom.status, 404);
  assert.equal(missingRoom.body.error, 'NOT_FOUND');

  const deleted = await callWorker(env, '/api/rooms?code=WXYZ&serverId=s1', { method: 'DELETE', token: created.body.token });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { ok: true, removed: { code: 'WXYZ', serverId: 's1' } });
  assert.deepEqual(roomKeys(storage), []);

  const badJson = await callWorker(env, '/api/rooms', { method: 'POST', rawBody: '{not json' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, 'BAD_JSON');

  const badUrl = await callWorker(env, '/api/rooms', {
    method: 'POST',
    ip: '203.0.113.50',
    body: { code: 'WXYZ', serverId: 's1', serverName: 'x', url: 'http://127.0.0.1/' },
  });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.error, 'BAD_URL');

  // per-IP cap maps to 429 through the adapter
  for (let i = 0; i < IP_ROOMS_MAX; i += 1) {
    const res = await callWorker(env, '/api/rooms', {
      method: 'POST',
      ip: '203.0.113.60',
      body: { code: codeFor(i), serverId: 's1', serverName: 'x' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const capped = await callWorker(env, '/api/rooms', {
    method: 'POST',
    ip: '203.0.113.60',
    body: { code: codeFor(IP_ROOMS_MAX), serverId: 's1', serverName: 'x' },
  });
  assert.equal(capped.status, 429);
  assert.equal(capped.body.error, 'LIMIT_REACHED');
});

test('adapter: PATCH /api/rooms edits via X-Token; difficulty rides POST/GET; PUT stays 405', async () => {
  const { env } = fakeEnv();

  const created = await callWorker(env, '/api/rooms', {
    method: 'POST',
    ip: '203.0.113.70',
    body: { code: 'mnpq', serverId: 's1', serverName: 'raiya服', note: 'first', difficulty: 'hard' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.added.difficulty, 'HARD', 'difficulty passes through the adapter');

  const listed0 = await callWorker(env, '/api/rooms');
  assert.equal(listed0.body.rooms[0].difficulty, 'HARD');

  const edited = await callWorker(env, '/api/rooms', {
    method: 'PATCH',
    token: created.body.token, // token travels in the X-Token header
    body: { code: 'MNPQ', serverId: 's1', note: 'second' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body, { ok: true, updated: { code: 'MNPQ', serverId: 's1', note: 'second' } });

  const listed = await callWorker(env, '/api/rooms');
  assert.equal(listed.body.rooms[0].note, 'second');
  assert.equal(listed.body.rooms[0].difficulty, 'HARD', 'PATCH leaves difficulty alone');

  const wrong = await callWorker(env, '/api/rooms', {
    method: 'PATCH',
    token: 'bad',
    body: { code: 'MNPQ', serverId: 's1', note: 'hijack' },
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, 'FORBIDDEN');

  const missing = await callWorker(env, '/api/rooms', {
    method: 'PATCH',
    token: created.body.token,
    body: { code: 'ZZZZ', serverId: 's1', note: 'x' },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'NOT_FOUND');

  const badJson = await callWorker(env, '/api/rooms', { method: 'PATCH', token: created.body.token, rawBody: '{nope' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, 'BAD_JSON');
  const noBody = await callWorker(env, '/api/rooms', { method: 'PATCH', token: created.body.token });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.body.error, 'BAD_JSON');

  // body token is ignored: X-Token is the only token source for PATCH
  const bodyToken = await callWorker(env, '/api/rooms', {
    method: 'PATCH',
    body: { code: 'MNPQ', serverId: 's1', note: 'x', token: created.body.token },
  });
  assert.equal(bodyToken.status, 403, 'a token in the body must NOT authorize a PATCH');
  assert.equal(bodyToken.body.error, 'FORBIDDEN');

  const put = await callWorker(env, '/api/rooms', { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.equal(put.body.error, 'METHOD_NOT_ALLOWED');

  const preflight = await callWorker({}, '/api/rooms', { method: 'OPTIONS' });
  assert.equal(preflight.res.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,DELETE,OPTIONS');
});

// --------------------------------------------------------------------------------------------------
// zero-egress (also enforced by the `after` hook above)
// --------------------------------------------------------------------------------------------------

test('zero egress: no fetch happened across the whole suite', () => {
  assert.equal(fetchCalls, 0);
});

// ---- v5.2：大厅访客（搭车计数）与房主直播字段 ------------------------------------------------------

test('visitors: distinct device keys inside the 120s window, IP fallback, expiry pruned', async () => {
  const { board } = makeBoard();
  await board.add(addInput({ note: '' }), T0);

  const a = await board.list(T0, { visitorKey: 'dev-aaa', ip: '9.9.9.9' });
  assert.equal(a.visitors, 1, 'the caller itself is a visitor');
  const b = await board.list(T0 + 1_000, { visitorKey: 'dev-bbb', ip: '1.1.1.1' });
  assert.equal(b.visitors, 2, 'a different device counts again');
  const again = await board.list(T0 + 2_000, { visitorKey: 'dev-aaa', ip: '9.9.9.9' });
  assert.equal(again.visitors, 2, 'same device inside the window does not double-count');
  const ipOnly = await board.list(T0 + 3_000, { visitorKey: '', ip: '8.8.8.8' });
  assert.equal(ipOnly.visitors, 3, 'missing/!invalid device key falls back to the IP');
  const junk = await board.list(T0 + 4_000, { visitorKey: 'bad key!!', ip: '' });
  assert.equal(junk.visitors, 3, 'malformed visitor keys are ignored');

  // dev-aaa was refreshed at T0+2s, so at T0+121s it is still inside its own 120s window
  const mid = await board.list(T0 + 121_000, { visitorKey: 'dev-new', ip: '' });
  assert.equal(mid.visitors, 3, 'the window slides per key (dev-aaa@2s + 8.8.8.8@3s + dev-new)');
  const after = await board.list(T0 + 125_000, { visitorKey: 'dev-late', ip: '' });
  assert.equal(after.visitors, 2, 'the two old keys have now expired; dev-new + dev-late remain');
  const much = await board.list(T0 + 130_000, { visitorKey: 'dev-later', ip: '' });
  assert.equal(much.visitors, 3, 'each key keeps its own expiry, the rest stay live');
});

test('live fields: add echoes mode/status/occupied/capacity (whitelisted), update patches only what is sent', async () => {
  const { board } = makeBoard();
  const added = await board.add(addInput({
    difficulty: 'hard', mode: 'coop', status: 'waiting', occupied: 2, capacity: 4,
  }), T0);
  assert.equal(added.added.difficulty, 'HARD');
  assert.equal(added.added.mode, 'coop');
  assert.equal(added.added.status, 'waiting');
  assert.equal(added.added.occupied, 2);
  assert.equal(added.added.capacity, 4);

  const junk = await board.add(addInput({
    code: 'FFFF', mode: 'squad', status: 'hidden', occupied: 99, capacity: 0,
  }), T0);
  assert.equal(junk.ok, true, 'illegal live values never reject the submission');
  assert.equal(junk.added.mode, undefined);
  assert.equal(junk.added.status, undefined);
  assert.equal(junk.added.occupied, undefined);
  assert.equal(junk.added.capacity, undefined);

  const upd = await board.update(
    { code: 'ABCD', serverId: 'srv-a', token: added.token, note: '杭州云服', status: 'playing', occupied: 4 },
    T0 + 500,
  );
  assert.equal(upd.ok, true);
  assert.equal(upd.updated.status, 'playing');
  assert.equal(upd.updated.occupied, 4);
  assert.equal(upd.updated.capacity, undefined, '未带的直播字段保持不动的语义在 updated 里体现为缺省');
  const listed = await board.list(T0 + 600);
  const row = listed.rooms.find((r) => r.code === 'ABCD');
  assert.equal(row.note, '杭州云服');
  assert.equal(row.status, 'playing');
  assert.equal(row.occupied, 4);
  assert.equal(row.capacity, 4, 'capacity from add survives an update that does not carry it');
  assert.equal(row.mode, 'coop');
  assert.equal(row.leftSec, 600, 'update never refreshes the TTL');
});

test('visitors: the board payload shape stays additive for old clients', async () => {
  const { board } = makeBoard();
  await board.add(addInput({ note: '' }), T0);
  const out = await board.list(T0);
  assert.equal(out.ok, true);
  assert.ok(Number.isInteger(out.visitors), 'visitors is an integer (0 when nobody polled)');
  assert.equal(out.ttlSec, 600);
  assert.ok(Array.isArray(out.rooms));
});
