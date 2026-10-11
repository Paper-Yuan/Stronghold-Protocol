// Minimal WOFF2 encoder/decoder (W3C WOFF 2.0) with *null* table transforms,
// built on Node's zlib Brotli. Used to convert the self-hosted OTF/TTF fonts
// (Bender, Novecento) to .woff2 without adding a dependency.
//
// Encoder: every table is stored untransformed (glyf/loca with transform
// version 3 = null, all other tables version 0 = null), concatenated in
// directory order (tags ascending, loca directly after glyf) and compressed as
// one Brotli stream (font mode, quality 11). The file is padded to 4 bytes.
// Decoder: only what our own encoder produces (null transforms, no metadata),
// used by tests to verify lossless round trips.

import zlib from 'node:zlib';

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const round4 = (n) => (n + 3) & ~3;

/**
 * Encode an unsigned integer as WOFF2 UIntBase128.
 * @param {number} n 0 ≤ n < 2^32
 * @returns {number[]}
 */
export function uintBase128(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`UIntBase128 out of range: ${n}`);
  const bytes = [];
  let v = n;
  do { bytes.unshift(v % 128); v = Math.floor(v / 128); } while (v > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return bytes;
}

function readBase128(buf, pos) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos.i++];
    if (b === undefined) throw new Error('truncated UIntBase128');
    if (i === 0 && b === 0x80) throw new Error('UIntBase128 leading zero');
    v = v * 128 + (b & 0x7f);
    if (v > 0xffffffff) throw new Error('UIntBase128 overflow');
    if (!(b & 0x80)) return v;
  }
  throw new Error('UIntBase128 too long');
}

/**
 * Parse the table directory of an sfnt (OTF/TTF) font.
 * @param {Buffer} sfnt
 * @returns {{ flavor: number, tables: {tag:string, data:Buffer}[] }}
 */
export function readSfnt(sfnt) {
  if (!Buffer.isBuffer(sfnt) || sfnt.length < 12) throw new Error('not an sfnt font');
  const flavor = sfnt.readUInt32BE(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(flavor)) throw new Error('unsupported sfnt flavor (TTC/WOFF?)');
  const numTables = sfnt.readUInt16BE(4);
  if (12 + numTables * 16 > sfnt.length) throw new Error('truncated table directory');
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = sfnt.toString('latin1', rec, rec + 4);
    const offset = sfnt.readUInt32BE(rec + 8);
    const length = sfnt.readUInt32BE(rec + 12);
    if (offset + length > sfnt.length) throw new Error(`table ${tag} out of bounds`);
    tables.push({ tag, data: sfnt.subarray(offset, offset + length) });
  }
  return { flavor, tables };
}

function orderTables(tables) {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const li = sorted.findIndex((t) => t.tag === 'loca');
  const gi = sorted.findIndex((t) => t.tag === 'glyf');
  if (li >= 0 && gi >= 0 && li !== gi + 1) {
    const [loca] = sorted.splice(li, 1);
    sorted.splice(sorted.findIndex((t) => t.tag === 'glyf') + 1, 0, loca);
  }
  return sorted;
}

/**
 * Convert an OTF/TTF font to WOFF2 (null transforms).
 * @param {Buffer} sfnt
 * @returns {Buffer}
 */
export function encodeWoff2(sfnt) {
  const { flavor, tables } = readSfnt(sfnt);
  const ordered = orderTables(tables);
  const hasGlyf = ordered.some((t) => t.tag === 'glyf');
  const hasLoca = ordered.some((t) => t.tag === 'loca');
  if (hasGlyf !== hasLoca) throw new Error('glyf and loca must both be present');
  const dir = [];
  for (const t of ordered) {
    const idx = KNOWN_TAGS.indexOf(t.tag);
    const transform = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0; // null transform
    dir.push((transform << 6) | (idx >= 0 ? idx : 63));
    if (idx < 0) for (let i = 0; i < 4; i++) dir.push(t.tag.charCodeAt(i) & 0xff);
    dir.push(...uintBase128(t.data.length));
  }
  const stream = Buffer.concat(ordered.map((t) => t.data));
  const compressed = zlib.brotliCompressSync(stream, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: stream.length,
    },
  });
  const totalSfntSize = 12 + 16 * ordered.length + ordered.reduce((s, t) => s + round4(t.data.length), 0);
  const unpadded = 48 + dir.length + compressed.length;
  const length = round4(unpadded);
  const out = Buffer.alloc(length);
  out.writeUInt32BE(0x774f4632, 0); // 'wOF2'
  out.writeUInt32BE(flavor, 4);
  out.writeUInt32BE(length, 8);
  out.writeUInt16BE(ordered.length, 12);
  out.writeUInt16BE(0, 14);
  out.writeUInt32BE(totalSfntSize, 16);
  out.writeUInt32BE(compressed.length, 20);
  out.writeUInt16BE(1, 24); // majorVersion
  out.writeUInt16BE(0, 26); // minorVersion
  // meta/priv offsets and lengths stay 0 (bytes 28..47).
  Buffer.from(dir).copy(out, 48);
  compressed.copy(out, 48 + dir.length);
  return out;
}

/**
 * Decode a WOFF2 produced by encodeWoff2 back to its tables (verification helper).
 * @param {Buffer} woff2
 * @returns {{ flavor: number, tables: {tag:string, data:Buffer}[] }}
 * @throws when the file uses transforms/metadata or is malformed
 */
export function decodeWoff2Tables(woff2) {
  if (!Buffer.isBuffer(woff2) || woff2.length < 48 || woff2.readUInt32BE(0) !== 0x774f4632) throw new Error('not a WOFF2 file');
  const flavor = woff2.readUInt32BE(4);
  const length = woff2.readUInt32BE(8);
  if (length !== woff2.length || length % 4 !== 0) throw new Error('bad WOFF2 length');
  const numTables = woff2.readUInt16BE(12);
  const compressedLength = woff2.readUInt32BE(20);
  const pos = { i: 48 };
  const entries = [];
  for (let n = 0; n < numTables; n++) {
    const flags = woff2[pos.i++];
    const idx = flags & 0x3f;
    const transform = flags >> 6;
    let tag;
    if (idx === 63) { tag = woff2.toString('latin1', pos.i, pos.i + 4); pos.i += 4; } else tag = KNOWN_TAGS[idx];
    const origLength = readBase128(woff2, pos);
    const isGlyfLoca = tag === 'glyf' || tag === 'loca';
    if ((isGlyfLoca && transform !== 3) || (!isGlyfLoca && transform !== 0)) throw new Error(`transformed table ${tag} not supported`);
    entries.push({ tag, origLength });
  }
  const end = pos.i + compressedLength;
  if (end > woff2.length || round4(end) !== length) throw new Error('bad compressed block size');
  const stream = zlib.brotliDecompressSync(woff2.subarray(pos.i, end));
  let off = 0;
  const tables = entries.map((e) => {
    const data = stream.subarray(off, off + e.origLength);
    off += e.origLength;
    return { tag: e.tag, data };
  });
  if (off !== stream.length) throw new Error('stream length mismatch');
  return { flavor, tables };
}
