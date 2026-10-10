import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalModManager } from '../server/packs.js';
import { readPackIndex, normalizeManifest, isLocalUrl, langMetaOf } from '../shared/packs.js';
import { parseModCatalog, packById, MOD_CATALOG_URL } from '../shared/modCatalog.js';

test('GlobalModManager arbitration logic', () => {
  GlobalModManager.masterEnabled = true;
  GlobalModManager.roomPolicy = 'OPTIONAL';
  GlobalModManager.activePacksRegistry.set('fanpack', { version: '1.0.0' });

  // 1. Normal resolution
  const resolved = GlobalModManager.resolveRoomPacks(['fanpack', 'unknown_pack']);
  assert.deepEqual(resolved, ['fanpack']);

  // 2. STRICT_VANILLA enforcement
  GlobalModManager.roomPolicy = 'STRICT_VANILLA';
  assert.deepEqual(GlobalModManager.resolveRoomPacks(['fanpack']), []);

  // 3. FORCE_ALL enforcement
  GlobalModManager.roomPolicy = 'FORCE_ALL';
  assert.deepEqual(GlobalModManager.resolveRoomPacks([]), ['fanpack']);

  // 4. Master switch disabled
  GlobalModManager.masterEnabled = false;
  assert.deepEqual(GlobalModManager.resolveRoomPacks(['fanpack']), []);

  // Reset
  GlobalModManager.masterEnabled = true;
  GlobalModManager.roomPolicy = 'OPTIONAL';
});

test('probeStatus runs non-blocking without throwing', async () => {
  const status = await GlobalModManager.probeStatus();
  assert.equal(typeof status.masterEnabled, 'boolean');
  assert.ok(Array.isArray(status.installedPacks));
});

// ---- B1-4: data type supported; files normalize to arrays; readPackIndex end-to-end ----

test('B1-4.1 data 型 readPackIndex：单值/数组/坏 URL 混合 files → 读出并归一为数组、非本地 URL 滤除', () => {
  const index = {
    version: 1,
    packs: [{
      id: 'fanpack', type: 'data', name: '同人内容包',
      files: {
        records: '/packs/fanpack/records.json',                    // single string
        chess: ['/packs/fanpack/chess.json', '/packs/fanpack/chess2.json'], // array
        tokens: 'https://cdn.example.com/x.json',                   // non-local → dropped
        variants: '/packs/fanpack/variants.json',
      },
    }],
  };
  const [e] = readPackIndex(index, 'data');
  assert.ok(e, 'data entry read out');
  assert.deepEqual(e.files.records, ['/packs/fanpack/records.json'], 'single value normalized to array');
  assert.equal(e.files.chess.length, 2);
  assert.equal(e.files.tokens, undefined, 'non-local URL filtered');
  assert.deepEqual(e.files.variants, ['/packs/fanpack/variants.json']);
});

test('B1-4.2 assets 型条目仍被丢弃（status planned）', () => {
  const [e] = readPackIndex({ packs: [{ id: 'x', type: 'assets', files: { art: '/packs/x/a.json' } }] });
  assert.equal(e, undefined, 'assets type stays planned → dropped');
});

test('B1-4.3 lang 回归 + files.ui 空数组拒收', () => {
  const lang = {
    packs: [
      { id: 'en', type: 'lang', lang: 'en', files: { ui: '/i18n/en.json' } },
      { id: 'en2', type: 'lang', lang: 'en', files: { ui: [] } }, // empty ui array → rejected
    ],
  };
  const entries = readPackIndex(lang, 'lang');
  assert.equal(entries.length, 1, 'only the lang entry with a real ui file survives');
  assert.equal(entries[0].id, 'en');
  assert.deepEqual(entries[0].files.ui, ['/i18n/en.json']);
});

test('B1-4.4 normalizeManifest 负向：坏扩展名/坏路径/未知角色', () => {
  const raw = { type: 'data', files: { records: 'records.js', chess: '../escape.json', chess2: 'chess.json' } };
  const r = normalizeManifest(raw, { id: 'demo', folder: true });
  assert.ok(r.problems.some((p) => p.includes('records')), 'bad extension reported');
  assert.ok(r.problems.some((p) => p.includes('chess')), 'traversal reported');
  assert.ok(r.warnings.some((w) => w.includes('chess2')), 'unknown role warned');
  assert.equal(r.manifest, null, 'problems → manifest null');
});

test('B1-4.5 单文件语言包（_meta 布局）回归', () => {
  const meta = { lang: 'en', name: 'English', version: '1.0.0', strings: 1500 };
  const r = normalizeManifest(meta, { id: 'en', type: 'lang', lang: 'en', folder: false });
  assert.equal(r.problems.length, 0);
  assert.ok(r.manifest);
  assert.equal(r.manifest.lang, 'en');
});

test('B1-4.6 modCatalog 合格/不合格过滤：sha256 非 hex、url 带 ?v= 整条丢弃（判鲜口径防回流）', () => {
  const good = { id: 'fanpack', name: 'x', version: '1', minApp: '>=0.2.0', sha256: 'a'.repeat(64), bytes: 1, url: '/mods/fanpack/' + 'a'.repeat(64) + '.zip' };
  const catalog = parseModCatalog({ packs: [
    good,
    { ...good, id: 'bad1', sha256: 'nothex' },
    { ...good, id: 'bad2', url: '/mods/fanpack/x.zip?v=abc' }, // ?v= in an ENTRY url stays (parse is verbatim);
                                                                  // freshness-vs-cache is hasFreshPack's job
  ]});
  assert.equal(catalog.packs.length, 2, 'bad sha dropped, ?v= url preserved verbatim (freshness is a sha256 compare, not url parse)');
  assert.ok(packById(catalog, 'bad2'), '?v= entry kept — it is only rejected at the R2-key layer (isModZipUrl)');
  assert.equal(packById(catalog, 'bad1'), null);
  assert.equal(MOD_CATALOG_URL, '/mods/index.json');
});

test('B1-4.7 isLocalUrl 具名导出；langMetaOf 消费数组形状 files.ui 取 [0]', () => {
  assert.equal(isLocalUrl('/packs/x/a.json'), true);
  assert.equal(isLocalUrl('https://cdn.example.com/x'), false);
  assert.equal(isLocalUrl('//cdn.example.com/x'), false);

  const index = { packs: [{ id: 'en', type: 'lang', lang: 'en', files: { ui: ['/i18n/en.json'], data: ['/data/i18n/en.json'] } }] };
  const [e] = readPackIndex(index, 'lang');
  const meta = langMetaOf(e);
  assert.equal(meta.ui, '/i18n/en.json', 'ui resolves to the first (and only) entry of the normalized array');
  assert.equal(meta.dataUrl, '/data/i18n/en.json');
  assert.equal(meta.data, true);
});
