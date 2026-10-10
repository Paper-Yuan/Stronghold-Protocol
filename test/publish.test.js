// test/publish.test.js — C3 发布链验收（假 CDN，注入 fetch）：验证后拆分 → 素材上 CDN →
// 瘦身 zip → catalog 条目；以及 /mods/index.json 由游戏服务器聚合下发。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, shaOf } from './helpers/miniZip.js';
import { createCdnClient, isAllowedAssetKey } from '../server/mod/cdnClient.js';
import { publishPack } from '../server/mod/publish.js';
import { readCatalog } from '../server/mod/catalogStore.js';
import { startServer } from '../server/index.js';

const PACK_JSON = JSON.stringify({
  id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0', credits: '测试',
  features: ['新盟约', '新装备'],
  files: { records: 'records.json', art: 'art/index.json' },
});
// art reference inside data — must be rewritten to the CDN URL on publish
const RECORDS = JSON.stringify([{ id: 'demoBond', name: '演示盟约', icon: 'art/bond_demo.png' }]);
const ART_INDEX = JSON.stringify({ bond_demo: 'art/bond_demo.png' });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KIT_SRC = 'export const kit = {};';

/** A fake CDN: records PUTs, serves a hosted index, and reports kick. */
function fakeCdn({ index = {} } = {}) {
  const puts = [];
  const calls = { kick: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/cdn/v1/hosted-index.json') {
      return new Response(JSON.stringify({ files: index }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/api/cdn/upload/put') {
      const key = u.searchParams.get('key');
      puts.push({ key, sha256: u.searchParams.get('sha256'), size: Number(u.searchParams.get('size')), body: Buffer.from(opts.body ?? []) });
      return new Response(JSON.stringify({ ok: true, id: `id-${puts.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/api/cdn/upload/kick') {
      calls.kick += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname === '/api/cdn/upload/status') {
      return new Response(JSON.stringify({ staging: [], pending: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 404 });
  };
  return { fetchImpl, puts, calls };
}

async function makeStaging(t, { overall = 'pass', gates } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'modpub-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = buildZip({
    'pack.json': PACK_JSON,
    'records.json': RECORDS,
    'art/index.json': ART_INDEX,
    'art/bond_demo.png': PNG,
    'kits/demo.js': KIT_SRC,
  });
  await writeFile(join(dir, 'pack.zip'), zip);
  const report = {
    packId: 'demo', startedAt: 1, finishedAt: 2, overall,
    gates: gates || [1, 2, 3, 4, 5].map((g) => ({ gate: g, name: `g${g}`, status: g === 5 ? 'pass' : 'pass', detail: '' })),
  };
  await writeFile(join(dir, 'verify-report.json'), JSON.stringify(report));
  await writeFile(join(dir, 'receipt.json'), JSON.stringify({ uploadId: 'demo-upload', sha256: shaOf(zip), bytes: zip.length, stagedAt: 1, status: 'staged' }));
  return { dir, zip };
}

test('cdnClient.isAllowedAssetKey：静态素材与 zip 收，.js/.html/.svg 拒', () => {
  assert.equal(isAllowedAssetKey('packs/demo/assets/bond.png'), true);
  assert.equal(isAllowedAssetKey('packs/demo/abc.zip'), true);
  assert.equal(isAllowedAssetKey('packs/demo/assets/x.atlas'), true);
  assert.equal(isAllowedAssetKey('packs/demo/assets/k.js'), false);
  assert.equal(isAllowedAssetKey('x.html'), false);
  assert.equal(isAllowedAssetKey('x.svg'), false);
});

test('发布前置：无报告 / overall=fail / pending 未放行 → 拒绝', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  const { fetchImpl } = fakeCdn();
  const cdn = createCdnClient({ fetchImpl });

  const noReport = await mkdtemp(join(tmpdir(), 'modnorep-'));
  t.after(() => rm(noReport, { recursive: true, force: true }));
  await writeFile(join(noReport, 'pack.zip'), buildZip({ 'pack.json': PACK_JSON }));
  await assert.rejects(() => publishPack(noReport, { cdn, cacheRoot }), /verify-report/);

  const failed = await makeStaging(t, { overall: 'fail' });
  await assert.rejects(() => publishPack(failed.dir, { cdn, cacheRoot }), /验证未通过/);

  const pending = await makeStaging(t, { overall: 'pending' });
  await assert.rejects(() => publishPack(pending.dir, { cdn, cacheRoot }), /pending/);
});

test('发布链：素材上 CDN（含查重）、瘦身 zip、数据引用改写、kit 不上传、catalog 写入', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  const { dir } = await makeStaging(t);
  const { fetchImpl, puts } = fakeCdn();
  const cdn = createCdnClient({ fetchImpl });

  const { catalogEntry, report } = await publishPack(dir, { cdn, cacheRoot });

  // 1. art went up; kit js never did
  const putKeys = puts.map((p) => p.key);
  assert.ok(putKeys.includes('packs/demo/assets/bond_demo.png'), 'png uploaded');
  assert.ok(putKeys.includes('packs/demo/assets/index.json'), 'art index uploaded');
  assert.ok(!putKeys.some((k) => k.endsWith('.js')), 'kit js must NOT be uploaded to the CDN');

  // 2. slim zip uploaded, content-addressed
  const zipKey = putKeys.find((k) => /^packs\/demo\/[0-9a-f]{64}\.zip$/.test(k));
  assert.ok(zipKey, 'slim zip uploaded under packs/<id>/<sha256>.zip');
  const zipPut = puts.find((p) => p.key === zipKey);
  assert.equal(zipPut.sha256, catalogEntry.sha256, 'catalog sha256 is the slim zip hash');
  assert.equal(catalogEntry.bytes, zipPut.size);
  assert.equal(catalogEntry.url, `https://weishucdn.jiangjiangze.icu/${zipKey}`);

  // 3. catalog entry shape + stored
  assert.equal(catalogEntry.id, 'demo');
  assert.equal(catalogEntry.minApp, '>=0.2.0');
  assert.deepEqual(catalogEntry.features, ['新盟约', '新装备']);
  const stored = await readCatalog(cacheRoot);
  assert.equal(stored.packs.length, 1);
  assert.equal(stored.packs[0].sha256, catalogEntry.sha256);

  // 4. slim zip: art stripped, data rewritten to CDN URLs, kit kept
  const { unpackModZip } = await import('../shared/modZip.js');
  const slim = await unpackModZip(new Uint8Array(zipPut.body));
  assert.equal(slim.art['bond_demo.png'], undefined, 'art no longer inside the pack');
  assert.equal(slim.sections.records[0].icon, 'https://weishucdn.jiangjiangze.icu/packs/demo/assets/bond_demo.png', 'data reference rewritten to CDN URL');
  assert.equal(slim.kits['demo.js'], KIT_SRC, 'kit stays inside the slim zip');
  assert.equal(slim.meta.files.art, undefined, 'local art role dropped from the slim manifest');
  assert.match(slim.meta.assets.base, /^https:\/\/weishucdn\.jiangjiangze\.icu\/packs\/demo\/assets\/$/);

  // 5. report + receipt flipped
  assert.equal(report.zip.key, zipKey);
  const receipt = JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8').catch(() => '{}'));
  assert.equal(receipt.status, 'published');
  const pubReport = JSON.parse(await readFile(join(dir, 'publish-report.json'), 'utf8'));
  assert.equal(pubReport.catalogEntry.sha256, catalogEntry.sha256);
});

test('查重：远程索引已含同 sha256 的素材 → 跳过上传（只上传 zip）', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  const { dir } = await makeStaging(t);
  const index = {
    'packs/demo/assets/bond_demo.png': { sha256: shaOf(PNG) },
    'packs/demo/assets/index.json': { sha256: shaOf(Buffer.from(ART_INDEX, 'utf8')) },
  };
  const { fetchImpl, puts } = fakeCdn({ index });
  const cdn = createCdnClient({ fetchImpl });

  const { report } = await publishPack(dir, { cdn, cacheRoot });
  assert.equal(report.assets.uploaded, 0, 'both art files deduped');
  assert.equal(report.assets.skipped, 2);
  assert.equal(puts.filter((p) => p.key.endsWith('.png')).length, 0, 'no png re-upload');
  assert.ok(puts.some((p) => p.key.endsWith('.zip')), 'the slim zip is still uploaded');
});

test('/mods/index.json：游戏服务器聚合下发 catalog（no-cache）', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  t.after(() => rm(cacheRoot, { recursive: true, force: true }));
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(join(cacheRoot, 'catalog.json'), JSON.stringify({
    version: 1,
    packs: [{ id: 'demo', name: '演示包', version: '1.0.0', minApp: '>=0.2.0', sha256: 'a'.repeat(64), bytes: 10, url: 'https://weishucdn.jiangjiangze.icu/packs/demo/' + 'a'.repeat(64) + '.zip', features: [] }],
  }));

  const srv = await startServer({ port: 0, quiet: true, modCacheDir: cacheRoot });
  t.after(() => srv.close());
  const res = await fetch(`http://127.0.0.1:${srv.port}/mods/index.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'index is never cached (rewritten on publish)');
  const doc = await res.json();
  assert.equal(doc.packs.length, 1);
  assert.equal(doc.packs[0].id, 'demo');
});
