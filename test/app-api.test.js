// test/app-api.test.js — the launcher/Android-facing endpoints (server/http/appApi.js):
//   GET /api/app/version   the version + hot-update patchUrl the Android host reads before downloadAndApplyPatch
//   GET /api/app/patch.zip the patch itself (dist/patch.zip, else public/patch.zip; 404 = "no patch yet", not an error)
//   GET /lan/room?code=    the same-Wi-Fi / virtual-LAN room probe (android/.../NetworkUtils.kt probeRoom)
//
// The point of the last one is its GATE, not its payload: only a request from a private / virtual-network address is
// answered at all, so a public client cannot even learn whether this machine hosts room XXXX. That gate is unit-tested
// over the address forms the Android side and the virtual-LAN tools actually use (RFC1918, CGNAT 100.64/10, ULA).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { startServer } from '../server/index.js';
import { StubMatch as Match } from '../server/match/StubMatch.js';
import { isPrivateAddress } from '../server/http/appApi.js';
import { APP_VERSION } from '../shared/constants.js';
import { TestClient } from './helpers/wsClient.js';

describe('app api (version / patch / lan probe)', () => {
  let srv;
  const base = () => `http://127.0.0.1:${srv.port}`;
  const log = { info() {}, warn() {}, debug() {}, error() {} };

  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: Match }); });
  after(async () => { await srv?.close(); });

  test('GET /api/app/version describes the server and where the patch lives', async () => {
    const res = await fetch(`${base()}/api/app/version`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.app, APP_VERSION);
    assert.equal(typeof body.build, 'string');
    assert.ok(body.build.length > 0, 'a build tag rides along (same one /healthz reports)');
    assert.equal(typeof body.serverNow, 'number');
    assert.equal(body.hotUpdate.supported, true);
    assert.equal(body.hotUpdate.patchUrl, '/api/app/patch.zip');
    assert.equal(body.hotUpdate.bundleVersion, body.build);
  });

  test('GET /api/version is the same answer (the alias older clients use)', async () => {
    const body = await (await fetch(`${base()}/api/version`)).json();
    assert.equal(body.app, APP_VERSION);
    assert.equal(body.hotUpdate.patchUrl, '/api/app/patch.zip');
  });

  test('the patch endpoint answers a zip when a patch exists and 404 when none was built', async () => {
    const res = await fetch(`${base()}/api/app/patch.zip`, { method: 'HEAD' });
    const built = existsSync(new URL('../dist/patch.zip', import.meta.url))
      || existsSync(new URL('../public/patch.zip', import.meta.url));
    if (!built) { assert.equal(res.status, 404, 'no patch yet is a normal state'); return; }
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.ok(Number(res.headers.get('content-length')) > 0);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('a method other than GET/HEAD is refused, not answered', async () => {
    const res = await fetch(`${base()}/api/app/version`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  });

  test('the LAN probe answers for an open co-op room and for nothing else', async () => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    try {
      const w = await c.hello('LanProbe');
      c.id = w.playerId;
      assert.equal((await fetch(`${base()}/lan/room?code=ZZZZ`)).status, 404, 'unknown code');
      await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      const coop = await c.waitFor('room.state', (s) => !!s.code, 4000);
      const res = await fetch(`${base()}/lan/room?code=${coop.code.toLowerCase()}`);
      assert.equal(res.status, 200, 'the code is matched case-insensitively, like room.join');
      const body = await res.json();
      assert.deepEqual(body, { ok: true, code: coop.code, mode: 'coop', difficulty: coop.difficulty, seats: 4, humans: 1, inMatch: false });
      await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      const solo = await c.waitFor('room.state', (s) => s.mode === 'solo' && !!s.code, 4000);
      assert.equal((await fetch(`${base()}/lan/room?code=${solo.code}`)).status, 404, 'a solo room is nobody else business');
    } finally { await c.terminate().catch(() => {}); }
  });
});

describe('the private-address gate', () => {
  test('accepts the addresses a same-Wi-Fi or virtual-LAN peer can have', () => {
    for (const a of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.7', '172.16.0.9', '172.31.255.254',
      '100.64.0.1', '100.100.5.5', '100.127.255.1', '169.254.3.4', '::ffff:192.168.1.7', 'fd00::1', 'fc12::9']) {
      assert.equal(isPrivateAddress(a), true, a);
    }
  });

  test('refuses a public address (and the CGNAT range ends where it should)', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '203.0.113.7', '172.15.0.1', '172.32.0.1', '100.63.255.255',
      '100.128.0.1', '11.0.0.1', '2001:4860:4860::8888', '', null, undefined]) {
      assert.equal(isPrivateAddress(a), false, String(a));
    }
  });
});
