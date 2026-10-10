// test/admin-mod-pipeline.test.js — E3 机器凭证：上传 → 验证 → 发布 全链路过 HTTP，
// 以及发布前置门禁（未验证即发布被拒 409）。CDN 用注入的假客户端，验证跑真实 fork 子进程。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { buildZip } from './helpers/miniZip.js';
import { createCdnClient } from '../server/mod/cdnClient.js';

const PACK_JSON = JSON.stringify({
  id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0', credits: '测试',
  features: ['新盟约'],
  files: { records: 'records.json', art: 'art/index.json' },
});
const RECORDS = JSON.stringify([{ id: 'demoBond', name: '演示盟约', icon: 'art/bond_demo.png' }]);
const ART_INDEX = JSON.stringify({ bond_demo: 'art/bond_demo.png' });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeCdnFetch() {
  const puts = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/cdn/v1/hosted-index.json') {
      return new Response(JSON.stringify({ files: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/api/cdn/upload/put') {
      puts.push(u.searchParams.get('key'));
      return new Response(JSON.stringify({ ok: true, id: `id-${puts.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/api/cdn/upload/kick') {
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 404 });
  };
  return { fetchImpl, puts };
}

function packZip() {
  return buildZip({
    'pack.json': PACK_JSON,
    'records.json': RECORDS,
    'art/index.json': ART_INDEX,
    'art/bond_demo.png': PNG,
    'kits/demo.js': 'export const kit = {};',
  });
}

test('E3：上传 → 验证 → 发布 全链路，且未验证即发布被拒（409）', async (t) => {
  const secret = 'e3-secret';
  const stagingDir = await mkdtemp(join(tmpdir(), 'e3-staging-'));
  const cacheRoot = await mkdtemp(join(tmpdir(), 'e3-cache-'));
  t.after(() => rm(stagingDir, { recursive: true, force: true }));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));

  const { fetchImpl, puts } = fakeCdnFetch();
  const srv = await startServer({
    port: 0, quiet: true, adminSecret: secret,
    modStagingDir: stagingDir, modCacheDir: cacheRoot,
    cdnClient: createCdnClient({ fetchImpl }),
  });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const auth = { Authorization: `Bearer ${secret}` };

  // 1. auth is required on every pipeline endpoint
  for (const [method, p] of [['POST', '/api/admin/mods/x/verify'], ['POST', '/api/admin/mods/x/publish'], ['GET', '/api/admin/mods/catalog']]) {
    const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 401, `${p} requires a token`);
  }

  // 2. upload
  const zip = packZip();
  const up = await (await fetch(`${base}/api/admin/mods/upload`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/zip' }, body: zip,
  })).json();
  assert.equal(up.ok, true);
  const uploadId = up.uploadId;

  // 3. publish BEFORE verify → refused (409), nothing uploaded
  const early = await fetch(`${base}/api/admin/mods/${uploadId}/publish`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(early.status, 409, 'publish without a verification report is refused');
  assert.equal(puts.length, 0, 'a refused publish uploads nothing');

  // 4. verify → real forked five-gate run
  const ver = await (await fetch(`${base}/api/admin/mods/${uploadId}/verify`, { method: 'POST', headers: auth })).json();
  assert.equal(ver.ok, true);
  assert.equal(ver.report.gates.length, 5);
  assert.equal(ver.report.gates[0].status, 'pass', 'gate1 (zip+schema) passes for a well-formed pack');
  assert.equal(ver.report.gates[1].status, 'pass', 'gate2 (ES2020) passes');
  assert.equal(ver.report.gates[2].status, 'pass', 'gate3 (determinism) passes');
  assert.equal(ver.report.gates[3].status, 'pass', 'gate4 (merge) passes');
  assert.ok(['pass', 'skip'].includes(ver.report.gates[4].status), 'gate5 skips without CHROME_PATH');
  assert.ok(['pass', 'pending'].includes(ver.report.overall));
  // the report is on disk for the admin UI to poll
  const onDisk = JSON.parse(await readFile(join(stagingDir, uploadId, 'verify-report.json'), 'utf8'));
  assert.equal(onDisk.gates.length, 5);

  // 5. publish → with a skip in the report (gate5 has no CHROME_PATH here) the C4 policy
  //    refuses first; the admin's explicit allowPending then goes through.
  if (ver.report.overall === 'pending') {
    const refused = await fetch(`${base}/api/admin/mods/${uploadId}/publish`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(refused.status, 409, 'a skip-only verification needs an explicit admin confirmation');
    assert.equal(puts.length, 0, 'the refused publish uploaded nothing');
  }
  const pub = await (await fetch(`${base}/api/admin/mods/${uploadId}/publish`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ allowPending: true }),
  })).json();
  assert.equal(pub.ok, true, `publish succeeds after verification: ${pub.error || ''}`);
  assert.equal(pub.catalogEntry.id, 'demo');
  assert.ok(puts.includes('packs/demo/assets/bond_demo.png'), 'art uploaded');
  assert.ok(puts.some((k) => /^packs\/demo\/[0-9a-f]{64}\.zip$/.test(k)), 'slim zip uploaded');
  assert.ok(!puts.some((k) => k.endsWith('.js')), 'kit js never uploaded');

  // 6. the published catalog is what clients sync
  const cat = await (await fetch(`${base}/api/admin/mods/catalog`, { headers: auth })).json();
  assert.equal(cat.catalog.packs.length, 1);
  assert.equal(cat.catalog.packs[0].id, 'demo');
  const publicCat = await (await fetch(`${base}/mods/index.json`)).json();
  assert.equal(publicCat.packs.length, 1, '/mods/index.json reflects the publish');
  assert.equal(publicCat.packs[0].sha256, pub.catalogEntry.sha256);

  // 7. the receipt now says published
  const st = await (await fetch(`${base}/api/admin/mods/${uploadId}/status`, { headers: auth })).json();
  assert.equal(st.receipt.status, 'published');
});
