// test/modZip.test.js — D1-5/C1-1 acceptance: zip reader guards + unpack contract.
// Builds real minimal zips with node:zlib (stored + deflated members) — no fixtures on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { sanitizeZipPath, unpackModZip } from '../shared/modZip.js';

// --- minimal zip builder -------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a zip from { name → content(Buffer|string) }, using the given method per entry. */
function buildZip(members, method = 8) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const nameB = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = method === 0 ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);          // mtime
    local.writeUInt16LE(0x21, 12);       // mdate (any valid)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameB, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameB]));
    offset += 30 + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...chunks, cdBuf, eocd]));
}

const PACK_JSON = JSON.stringify({ id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0' });
const CHESS_JSON = JSON.stringify([{ chessId: 'chess_demo_1', name: '演示棋子', tier: 1 }]);
const KIT_SRC = 'export const kit = {}; // never executed by unpack';

test('sanitizeZipPath：合法路径过、遍历/绝对/反斜杠/冒号/控制字符拒', () => {
  assert.equal(sanitizeZipPath('pack.json'), 'pack.json');
  assert.equal(sanitizeZipPath('art/bond_a.png'), 'art/bond_a.png');
  assert.equal(sanitizeZipPath('../escape.json'), null);
  assert.equal(sanitizeZipPath('..\\escape.json'), null);
  assert.equal(sanitizeZipPath('/abs.json'), null);
  assert.equal(sanitizeZipPath('C:/abs.json'), null);
  assert.equal(sanitizeZipPath('bad\u0000.json'), null);
});

test('unpackModZip：stored 与 deflate 两种成员都解出，产出 {meta,sections,kits,art}', async () => {
  for (const method of [0, 8]) {
    const zip = buildZip({
      'pack.json': PACK_JSON,
      'chess.json': CHESS_JSON,
      'kits/ops/demo.js': KIT_SRC,
      'art/bond_demo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    }, method);
    const out = await unpackModZip(zip);
    assert.equal(out.meta.id, 'demo');
    assert.deepEqual(out.sections.chess, JSON.parse(CHESS_JSON));
    assert.equal(out.kits['demo.js'], KIT_SRC, 'kit kept as source string');
    assert.ok(out.art['bond_demo.png'] instanceof Uint8Array);
    assert.ok(!('records' in out.sections), 'absent sections stay absent');
  }
});

test('unpackModZip：单层根目录布局（my-mod/pack.json）同样识别', async () => {
  const zip = buildZip({ 'my-mod/pack.json': PACK_JSON, 'my-mod/chess.json': CHESS_JSON });
  const out = await unpackModZip(zip);
  assert.equal(out.meta.id, 'demo');
  assert.ok(out.sections.chess);
});

test('unpackModZip fail-closed：段 JSON 坏 → throw，不静默跳段', async () => {
  const zip = buildZip({ 'pack.json': PACK_JSON, 'chess.json': '{not json' });
  await assert.rejects(() => unpackModZip(zip), /JSON|parse/i);
});

test('unpackModZip fail-closed：非法路径条目 → throw', async () => {
  const zip = buildZip({ '../evil.json': 'x' });
  await assert.rejects(() => unpackModZip(zip), /非法路径/);
});

test('zip 炸弹护栏：条目数超 maxEntries → 拒绝', async () => {
  const members = {};
  for (let i = 0; i < 5; i++) members['f' + i + '.json'] = 'x';
  const zip = buildZip(members);
  await assert.rejects(() => import('../shared/modZip.js').then(m => m.extractZipToMap(zip, { maxEntries: 4 })), /条目数超上限/);
});

test('zip 炸弹护栏：非 zip 字节 → 明确报错', async () => {
  const { extractZipToMap } = await import('../shared/modZip.js');
  const notZip = new TextEncoder().encode('this is not a zip at all, definitely not');
  await assert.rejects(() => extractZipToMap(notZip), /ZIP|中央目录/);
});
