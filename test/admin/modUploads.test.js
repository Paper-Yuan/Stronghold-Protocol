// test/admin/modUploads.test.js — C1-5: ModUploadManager unit cases (no HTTP).
// Staging goes to a throwaway temp dir; never the repo's server/.mod-staging.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ModUploadManager } from '../../server/admin/modUploads.js';
import { buildZip, shaOf } from '../helpers/miniZip.js';

const PACK_JSON = JSON.stringify({ id: 'demo', type: 'data', name: '演示', version: '1.0.0', app: '>=0.2.0' });

function reqOf(buf, headers = {}) {
  const req = Readable.from([buf]);
  req.headers = { 'content-type': 'application/zip', 'content-length': String(buf.length), ...headers };
  req.method = 'POST';
  return req;
}

async function withManager(t, opts = {}) {
  const stagingDir = await mkdtemp(join(tmpdir(), 'modstage-'));
  const mgr = new ModUploadManager({ stagingDir, log: () => {}, ...opts });
  t.after(() => rm(stagingDir, { recursive: true, force: true }));
  return { mgr, stagingDir };
}

test('合法 zip → receipt 字段齐全且 pack.zip/receipt.json 落盘', async (t) => {
  const { mgr, stagingDir } = await withManager(t);
  const zip = buildZip({ 'pack.json': PACK_JSON, 'chess.json': '[]' });
  const r = await mgr.receive(reqOf(zip));
  assert.match(r.uploadId, /^[0-9a-f]{12}-\d{14}$/);
  assert.equal(r.sha256, shaOf(zip));
  assert.equal(r.bytes, zip.length);
  assert.equal(r.status, 'staged');
  const persisted = JSON.parse(await readFile(join(stagingDir, r.uploadId, 'receipt.json'), 'utf8'));
  assert.equal(persisted.sha256, r.sha256);
  const zipBytes = await readFile(join(stagingDir, r.uploadId, 'pack.zip'));
  assert.equal(shaOf(zipBytes), r.sha256, 'pack.zip is the verbatim body');
});

test('重复上传同字节 → 幂等返回已有 uploadId，不落第二份', async (t) => {
  const { mgr } = await withManager(t);
  const zip = buildZip({ 'pack.json': PACK_JSON });
  const r1 = await mgr.receive(reqOf(zip));
  const r2 = await mgr.receive(reqOf(zip));
  assert.equal(r2.uploadId, r1.uploadId);
  assert.equal(r2.idempotent, true);
  assert.equal((await mgr.list()).length, 1);
});

test('超限（maxBytes 小于包体）→ 413 抛错且无残留目录', async (t) => {
  const { mgr, stagingDir } = await withManager(t, { maxBytes: 10 });
  const zip = buildZip({ 'pack.json': PACK_JSON });
  await assert.rejects(() => mgr.receive(reqOf(zip)), (e) => e.status === 413);
  const left = (await readdir(stagingDir)).filter((n) => n.startsWith('incoming-'));
  assert.equal(left.length, 0, 'no orphan incoming-* dirs');
});

test('错 Content-Type → 415；application/json 同样拒', async (t) => {
  const { mgr } = await withManager(t);
  const zip = buildZip({ 'pack.json': PACK_JSON });
  await assert.rejects(() => mgr.receive(reqOf(zip, { 'content-type': 'multipart/form-data; boundary=x' })), (e) => e.status === 415);
  await assert.rejects(() => mgr.receive(reqOf(zip, { 'content-type': 'application/json' })), (e) => e.status === 415);
});

test('非 zip 魔数（纯文本 body）→ 400', async (t) => {
  const { mgr } = await withManager(t);
  const text = Buffer.from('this is definitely not a zip file, no PK magic here');
  await assert.rejects(() => mgr.receive(reqOf(text)), (e) => e.status === 400);
});

test('list/get/remove 生命周期', async (t) => {
  const { mgr } = await withManager(t);
  const zip = buildZip({ 'pack.json': PACK_JSON });
  const r = await mgr.receive(reqOf(zip));
  assert.equal((await mgr.list()).length, 1);
  assert.equal((await mgr.get(r.uploadId)).uploadId, r.uploadId);
  assert.equal(await mgr.get('bogus-id-000000'), null);
  assert.equal(await mgr.remove(r.uploadId), true);
  assert.equal((await mgr.list()).length, 0);
});

test('中断流（error 事件）→ 清 incoming-* 孤儿', async (t) => {
  const { mgr, stagingDir } = await withManager(t);
  const req = new Readable({ read() { this.push(Buffer.from([0x50, 0x4b, 0x03, 0x04])); this.destroy(new Error('aborted mid-flight')); } });
  req.headers = { 'content-type': 'application/zip' };
  req.method = 'POST';
  await assert.rejects(() => mgr.receive(req));
  const left = (await readdir(stagingDir)).filter((n) => n.startsWith('incoming-'));
  assert.equal(left.length, 0, 'aborted upload leaves nothing behind');
});
