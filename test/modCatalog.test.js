// test/modCatalog.test.js — D1-1 acceptance: parse positive/negative, freshness-by-sha256-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModCatalog, packById, MOD_CATALOG_URL } from '../shared/modCatalog.js';

const GOOD_SHA = 'a'.repeat(64);
const GOOD_SHA_B = 'b'.repeat(64);

function entry(over = {}) {
  return {
    id: 'fanpack',
    name: '同人内容包',
    version: '1.0.0',
    minApp: '>=0.2.0',
    sha256: GOOD_SHA,
    bytes: 12345,
    url: '/mods/fanpack/' + GOOD_SHA + '.zip',
    features: ['新盟约', '新装备'],
    ...over,
  };
}

test('parseModCatalog 接受合法条目（https 与相对 url 均收）', () => {
  for (const url of ['/mods/fanpack/' + GOOD_SHA + '.zip', 'https://cdn.example.com/mods/fanpack/' + GOOD_SHA + '.zip']) {
    const c = parseModCatalog({ version: 1, packs: [entry({ url })] });
    assert.equal(c.packs.length, 1);
    assert.equal(c.packs[0].id, 'fanpack');
    assert.equal(c.packs[0].sha256, GOOD_SHA);
    assert.equal(c.packs[0].url, url);
  }
});

test('parseModCatalog 负向：坏 sha256 / 非正 bytes / 缺 url / 缺 minApp / 坏 id → 整条丢弃不炸', () => {
  const bad = [
    entry({ sha256: 'XYZ' }),                 // not 64-hex
    entry({ sha256: '' }),
    entry({ bytes: 0 }),
    entry({ bytes: -5 }),
    entry({ bytes: 12.5 }),                   // non-integer
    entry({ url: '' }),
    entry({ minApp: '' }),
    entry({ id: '_leading-dash' }),            // invalid first char
    entry({ id: '' }),
  ];
  const c = parseModCatalog({ version: 1, packs: bad });
  assert.equal(c.packs.length, 0, 'every malformed entry is dropped');
  assert.equal(c.dropped.length, bad.length);
});

test('parseModCatalog 负向：非对象 body / packs 非数组 → 空目录不炸', () => {
  assert.deepEqual(parseModCatalog(null).packs, []);
  assert.deepEqual(parseModCatalog('string').packs, []);
  assert.deepEqual(parseModCatalog({ packs: 'nope' }).packs, []);
  assert.deepEqual(parseModCatalog({}).packs, []);
});

test('sha256 宽容口径：大写 hex 归一为小写后接受（写库与判鲜统一用小写）', () => {
  const c = parseModCatalog({ packs: [entry({ sha256: 'A'.repeat(64) })] });
  assert.equal(c.packs.length, 1);
  assert.equal(c.packs[0].sha256, 'a'.repeat(64), 'uppercase hex normalized to lowercase');
});

test('判鲜只认 sha256：url 带 ?v= 不参与，sha256 相同即鲜（catalog 条目形状不动 url 本身）', () => {
  const c = parseModCatalog({ version: 1, packs: [entry({ url: '/mods/fanpack/' + GOOD_SHA + '.zip?v=abc' })] });
  assert.equal(c.packs[0].url, '/mods/fanpack/' + GOOD_SHA + '.zip?v=abc', 'url preserved verbatim');
  // freshness comparisons are the consumer's job (planPackFetch), tested in modStorage suite;
  // here we pin the contract that parse itself never rewrites or strips the url.
});

test('packById 命中与未命中；缺省字段补默认（name→id, version→0.0.0）', () => {
  const c = parseModCatalog({ version: 1, packs: [entry({ name: undefined, version: undefined, features: 'nope' })] });
  const p = packById(c, 'fanpack');
  assert.ok(p);
  assert.equal(p.name, 'fanpack', 'name falls back to id');
  assert.equal(p.version, '0.0.0');
  assert.deepEqual(p.features, []);
  assert.equal(packById(c, 'absent'), null);
  assert.equal(packById(null, 'x'), null);
});

test('MOD_CATALOG_URL 端点冻结为 /mods/index.json（§0.3）', () => {
  assert.equal(MOD_CATALOG_URL, '/mods/index.json');
});
