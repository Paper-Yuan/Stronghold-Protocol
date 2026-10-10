// test/packCache.test.js — D1-6 acceptance: disk cache round-trip, fail-closed, freshness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { ensurePackCached, loadPackSections, hasFreshCache } from '../server/mod/packCache.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- reuse the minimal zip builder from modZip.test.js (kept local to stay self-contained) ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(members, method = 8) {
  const chunks = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const nameB = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = method === 0 ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameB, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(method, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameB]));
    offset += 30 + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const PACK_JSON = JSON.stringify({ id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0' });
const CHESS = JSON.stringify([{ chessId: 'chess_demo_1', name: '演示棋子' }]);
const KIT_SRC = 'export const kit = {};';

function zipBuffer() { return buildZip({ 'pack.json': PACK_JSON, 'chess.json': CHESS, 'kits/ops/demo.js': KIT_SRC }); }
function shaOf(buf) { return createHash('sha256').update(buf).digest('hex'); }
function entryFor(buf, over = {}) {
  const sha = shaOf(buf);
  return { id: 'demo', name: '演示包', version: '1.0.0', sha256: sha, bytes: buf.length, url: 'test://demo.zip', features: [], ...over };
}
function fetchServing(buf) {
  return async () => new Response(buf, { status: 200, headers: { 'content-type': 'application/zip' } });
}

test('ensurePackCached 首次下载落盘，二次同 sha 零下载；loadPackSections 与浏览器同形状', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  const buf = zipBuffer();
  const entry = entryFor(buf);
  let hits = 0;
  const fetchImpl = async () => { hits++; return fetchServing(buf)(); };

  const r1 = await ensurePackCached(entry, { cacheRoot, fetchImpl });
  assert.equal(r1.cached, true);
  assert.equal(hits, 1);

  const r2 = await ensurePackCached(entry, { cacheRoot, fetchImpl });
  assert.equal(r2.cached, false, 'same sha → no re-download');
  assert.equal(hits, 1);

  const out = await loadPackSections(cacheRoot, 'demo');
  assert.equal(out.meta.id, 'demo');
  assert.deepEqual(out.sections.chess, JSON.parse(CHESS));
  assert.equal(out.kits['demo.js'], KIT_SRC, 'kit kept as source string, not executed');
  assert.ok(await hasFreshCache(cacheRoot, entry));
  await rm(cacheRoot, { recursive: true, force: true });
});

test('ensurePackCached fail-closed：sha256 不符 → 抛错且不留半成品目录', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  const buf = zipBuffer();
  const tampered = entryFor(buf, { sha256: 'f'.repeat(64) });
  await assert.rejects(() => ensurePackCached(tampered, { cacheRoot, fetchImpl: fetchServing(buf) }), /校验失败/);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(cacheRoot, 'demo')), false, 'no half-written dir left behind');
  assert.equal(existsSync(join(cacheRoot, 'demo--incoming')), false, 'incoming dir cleaned');
  await rm(cacheRoot, { recursive: true, force: true });
});

test('ensurePackCached：sha 变更（新版本）→ 重新下载并替换缓存', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  const buf1 = zipBuffer();
  const e1 = entryFor(buf1);
  await ensurePackCached(e1, { cacheRoot, fetchImpl: fetchServing(buf1) });
  assert.ok(await hasFreshCache(cacheRoot, e1));

  const buf2 = buildZip({ 'pack.json': PACK_JSON, 'chess.json': JSON.stringify([{ chessId: 'chess_demo_2' }]) });
  const e2 = entryFor(buf2);
  const r = await ensurePackCached(e2, { cacheRoot, fetchImpl: fetchServing(buf2) });
  assert.equal(r.cached, true, 'stale → re-downloaded');
  assert.ok(await hasFreshCache(cacheRoot, e2));
  assert.equal(await hasFreshCache(cacheRoot, e1), false, 'old sha no longer fresh');
  const out = await loadPackSections(cacheRoot, 'demo');
  assert.equal(out.sections.chess[0].chessId, 'chess_demo_2');
  await rm(cacheRoot, { recursive: true, force: true });
});

test('ensurePackCached：HTTP 失败 → 抛错不落盘', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'modcache-'));
  const buf = zipBuffer();
  const entry = entryFor(buf);
  const fail404 = async () => new Response('nope', { status: 404 });
  await assert.rejects(() => ensurePackCached(entry, { cacheRoot, fetchImpl: fail404 }), /HTTP 404/);
  await rm(cacheRoot, { recursive: true, force: true });
});
