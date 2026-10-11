import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createResourceIndex } from '../server/resources.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
const swCode = await fs.readFile(path.join(root, 'public/resource-sw.js'), 'utf8');
const configBytes = await fs.readFile(path.join(root, 'data/cdn-resource-config.json'));
function worker(fetcher) {
  const entries = new Map();
  const cache = {
    async match(key) { return entries.get(String(key.url || key))?.clone(); },
    async put(key, response) { entries.set(String(key.url || key), response.clone()); },
  };
  const scope = vm.createContext({
    URL, Response, Headers, Request, TextDecoder, TextEncoder, Uint8Array, DataView, Set, Map,
    crypto: webcrypto, fetch: fetcher, caches: { open: async () => cache },
    self: { location: new URL('http://localhost/game/resource-sw.js'), addEventListener() {} },
  });
  vm.runInContext(swCode.replace(/\}\)\(\);\s*$/, 'globalThis.__workerTest = {loadCdnConfig, handleCdnRequest, configSHA256: CDN_CONFIG_SHA256, setConfig(config) {configPromise = Promise.resolve(config);}}; })();'), scope);
  return { scope: scope.__workerTest, cache, handle: request => scope.__workerTest.handleCdnRequest(request) };
}

test('CDN-only manifest matches the distributed pack and rejects an altered inventory', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-manifest-'));
  try {
    const frozenManifest = path.join(temp, 'manifest.json');
    const expected = JSON.parse(await fs.readFile(path.join(root, 'data/resource-manifest-frozen.json'), 'utf8'));
    await fs.writeFile(frozenManifest, JSON.stringify(expected));
    const resources = createResourceIndex({ dataDir: temp, publicDir: temp, frozenManifest });
    const result = await resources.get();
    assert.deepEqual(result.manifest, expected);
    assert.equal(result.manifest.count, 13889);
    assert.equal(result.manifest.version, 'f3216bd82a48');
    expected.files[0].size++;
    await fs.writeFile(frozenManifest, JSON.stringify(expected)); resources.reset();
    await assert.rejects(resources.get(), /Invalid frozen resource manifest/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('classic worker validates the full pinned CDN catalog from a /game/ deployment', async () => {
  const requests = [];
  const { scope } = worker(async url => {
    requests.push(String(url));
    return new Response(configBytes, { headers: { 'Content-Type': 'application/json' } });
  });
  const catalog = await scope.loadCdnConfig();
  assert.deepEqual(requests, ['http://localhost/game/data/cdn-resource-config.json']);
  assert.equal(catalog.version, 'f3216bd82a48');
  assert.equal(Object.keys(catalog.files).length, 13889);
  assert.equal(sha(configBytes), scope.configSHA256);
});

test('old validated packs reuse unchanged bytes and replace stale assets before serving ranges', async () => {
  const unchanged = Buffer.from('unchanged-art');
  const replacement = Buffer.from('new-art-contents');
  const hash = bytes => sha(bytes, 'sha1').slice(0, 12);
  const files = {
    '/assets/unchanged.png': [hash(unchanged), unchanged.length, 'assets/unchanged.png', sha(unchanged)],
    '/assets/changed.png': [hash(replacement), replacement.length, 'assets/changed.png', sha(replacement)],
  };
  const requests = [];
  const { scope, cache, handle } = worker(async url => {
    requests.push(String(url));
    assert.equal(new URL(url).pathname, '/assets/changed.png');
    return new Response(replacement, { headers: { 'Content-Type': 'image/png' } });
  });
  scope.setConfig({ version: 'f3216bd82a48', base: 'https://weishucdn.jiangjiangze.icu', files });
  await cache.put('http://localhost/__sp-imported-resource-pack__', new Response(JSON.stringify({ format: 1, source: 'local-file', manifest: '02a466edd43d', count: 13079 })));
  await cache.put('http://localhost/assets/unchanged.png', new Response(unchanged, { headers: { 'X-SP-Resource': '1', 'X-SP-Resource-Hash': hash(unchanged) } }));
  await cache.put('http://localhost/assets/changed.png', new Response('old-art', { headers: { 'X-SP-Resource': '1', 'X-SP-Resource-Hash': hash(Buffer.from('old-art')) } }));
  assert.equal(await (await handle(new Request('http://localhost/assets/unchanged.png'))).text(), 'unchanged-art');
  assert.equal(requests.length, 0);
  const range = await handle(new Request('http://localhost/assets/changed.png', { headers: { Range: 'bytes=0-6' } }));
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'new-art');
  assert.equal(requests.length, 1);
  assert.equal((await cache.match('http://localhost/assets/changed.png')).headers.get('X-SP-Resource-Hash'), hash(replacement));
  assert.equal(await (await handle(new Request('http://localhost/assets/changed.png'))).text(), 'new-art-contents');
  assert.equal(requests.length, 1);
  assert.equal((await handle(new Request('http://localhost/assets/unlisted.png'))).status, 404);
});
