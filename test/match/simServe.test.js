// The HTTP server serves the battle simulation to browsers (DESIGN §14): /sim/ = server/sim read-only (`.js` only, no
// listings, the Node-only loader excluded), /data.js = the generated browser stand-in of server/data.js, never any other
// server file. The browser-side data injection (simdata.js setSimData / getSimData) is exercised in Node.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, DATA_SHIM_JS } from '../../server/index.js';
import * as simdata from '../../server/sim/simdata.js';

let srv = null;
after(async () => { if (srv) await srv.close(); });

test('/sim/ serves the simulation modules read-only; nothing else of server/ is reachable', async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const get = (p, headers = {}) => fetch(srv.url + p, { redirect: 'manual', headers });
  for (const p of ['/sim/spec.js', '/sim/Battle.js', '/sim/simdata.js', '/sim/constants.js', '/sim/content/index.js', '/sim/content/kits/index.js', '/sim/content/support/index.js']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /^text\/javascript/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', `${p} revalidates (ETag)`);
    assert.ok(r.headers.get('etag'));
    const body = await r.text();
    assert.ok(!/from ['"]node:/.test(body), `${p}: no static node: import`);
  }
  const gz = await get('/sim/Battle.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.status, 200);
  // the Node-only loader stays private under any spelling (case-insensitive host file systems: macOS, Windows)
  for (const p of ['/sim/nodeData.js', '/sim/NODEDATA.JS', '/sim/NodeData.js', '/sim/nodedata.js', '/sim/', '/sim', '/sim/content/', '/sim/content', '/sim/../index.js', '/sim/%2e%2e/index.js', '/sim/..%2fdata.js',
    '/server/index.js', '/server/data.js', '/server/match/Match.js', '/sim/.hidden.js', '/sim/constants.json', '/sim/spec.js/']) {
    const r = await get(p);
    assert.ok(r.status === 404 || r.status === 403 || r.status === 400, `${p} → ${r.status}`);
  }
  const shim = await get('/data.js');
  assert.equal(shim.status, 200);
  assert.match(shim.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await shim.text(), DATA_SHIM_JS);
  assert.match(DATA_SHIM_JS, /from '\.\/sim\/simdata\.js'/, 'the stand-in reads the data injected into the sim');
  const again = await get('/data.js', { 'if-none-match': shim.headers.get('etag') });
  assert.equal(again.status, 304);
});

test('simdata: setSimData injects the default source (browser path) and getSimData serves it', async () => {
  const before = simdata.getSimData();
  try {
    const raw = { chess: { chess_x_a: { chessId: 'chess_x_a', name: 'X', tier: 1, stats: { maxHp: 1234, atk: 5 } } }, enemies: {}, tokens: {}, stages: {}, waves: {} };
    const ds = simdata.setSimData(raw);
    assert.equal(simdata.getSimData(), raw);
    assert.equal(simdata.getDefaultSource(), ds);
    assert.equal(ds.getChess('chess_x_a').stats.maxHp, 1234);
    assert.equal(ds.getChess('chess_char_1_01_a'), null, 'no research fallback once data is injected (both sides resolve ids alike)');
    assert.equal(simdata.hasGeneratedData(), true);
  } finally {
    simdata.setSimData(before);
    await simdata.reloadDataSources();
  }
});
