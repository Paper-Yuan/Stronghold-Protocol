// test/admin-mod-upload.test.js — C1-5: raw-body upload contract, tested over a live
// startServer instance. Machine-checks the §0.3 frozen contract: the zip IS the body,
// no multipart anywhere, staging lands on disk, auth is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { buildZip, shaOf } from './helpers/miniZip.js';

const PACK_JSON = JSON.stringify({ id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0' });

test('admin mod upload: raw-body contract end to end', async (t) => {
  const secret = 'test-secret-mod-upload';
  // Isolate staging away from the repo's server/.mod-staging (which .gitignore hides
  // but which we still don't want test junk in).
  const stagingDir = await mkdtemp(join(tmpdir(), 'modupload-e2e-'));
  t.after(() => rm(stagingDir, { recursive: true, force: true }));

  const srv = await startServer({ port: 0, quiet: true, adminSecret: secret, modStagingDir: stagingDir });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const auth = { Authorization: `Bearer ${secret}` };

  // 1. No auth → 401
  const unauth = await fetch(`${base}/api/admin/mods/upload`, {
    method: 'POST', headers: { 'content-type': 'application/zip' }, body: buildZip({ 'pack.json': PACK_JSON }),
  });
  assert.equal(unauth.status, 401, 'upload without token is rejected');

  // 2. Real zip as raw body (stored AND deflated members both accepted)
  for (const method of [0, 8]) {
    const zip = buildZip({ 'pack.json': PACK_JSON, 'chess.json': '[{"chessId":"d1"}]' }, method);
    const res = await fetch(`${base}/api/admin/mods/upload`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/zip', 'content-length': String(zip.length) },
      body: zip,
    });
    assert.equal(res.status, 200, `method ${method} upload succeeds`);
    const receipt = await res.json();
    assert.equal(receipt.ok, true);
    assert.equal(receipt.sha256, shaOf(zip), 'server-computed sha matches local recomputation');
    assert.equal(receipt.bytes, zip.length);
  }

  // 3. Multipart shape → 415 (proves the server never parses multipart)
  const zip2 = buildZip({ 'pack.json': PACK_JSON });
  const boundary = '----spmod-test-boundary';
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mod.zip"\r\nContent-Type: application/zip\r\n\r\n`),
    zip2,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const mp = await fetch(`${base}/api/admin/mods/upload`, {
    method: 'POST',
    headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: multipart,
  });
  assert.equal(mp.status, 415, 'multipart body is refused with 415');

  // 4. JSON content-type → 415
  const json = await fetch(`${base}/api/admin/mods/upload`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(json.status, 415);

  // 5. Not a zip (no PK magic) → 400
  const notZip = await fetch(`${base}/api/admin/mods/upload`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/zip' }, body: 'plain text, not zip',
  });
  assert.equal(notZip.status, 400);

  // 6. Idempotency over HTTP: same bytes twice → same uploadId
  const up1 = await (await fetch(`${base}/api/admin/mods/upload`, { method: 'POST', headers: { ...auth, 'content-type': 'application/zip' }, body: zip2 })).json();
  const up2 = await (await fetch(`${base}/api/admin/mods/upload`, { method: 'POST', headers: { ...auth, 'content-type': 'application/zip' }, body: zip2 })).json();
  assert.equal(up2.uploadId, up1.uploadId, 'same bytes → same uploadId');
  assert.equal(up2.idempotent, true);

  // 7. Staged list & status endpoints
  const staged = await (await fetch(`${base}/api/admin/mods/staged`, { headers: auth })).json();
  assert.equal(staged.ok, true);
  assert.ok(Array.isArray(staged.staged) && staged.staged.some((s) => s.uploadId === up1.uploadId));
  const status = await (await fetch(`${base}/api/admin/mods/${up1.uploadId}/status`, { headers: auth })).json();
  assert.equal(status.receipt.sha256, up1.sha256);
  const missing = await fetch(`${base}/api/admin/mods/000000000000-20260101000000/status`, { headers: auth });
  assert.equal(missing.status, 404);
});
