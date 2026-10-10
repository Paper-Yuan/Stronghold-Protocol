// shared/modZip.js — dual-platform zip reader for mod packs (CF_MOD_TRI_PLAN.md §2-C1-1/D1-5).
// Browser: DecompressionStream('deflate-raw'). Node ≥18: also has DecompressionStream
// globally; when absent (older Node) we lazily fall back to node:zlib via a dynamic
// import guarded by typeof — shared/ must stay browser-loadable (no static node: imports).
//
// Memory contract (§0.3): unpackModZip(buffer) → { meta, sections, kits, art }
//   meta     — parsed pack.json (or null)
//   sections — { <section>: <parsed JSON> } for the CUSTOM_SECTIONS member files
//   kits     — { <filename>: <source string> } — source text only, NEVER executed here
//   art      — { <relative path under art/>: Uint8Array } (browser callers may wrap in Blob)

import { CUSTOM_SECTIONS } from './customContent.js';

const EOCD_MAGIC = 0x06054b50;
const CDFH_MAGIC = 0x02014b50;
const LOCAL_MAGIC = 0x04034b50;

const DEFAULT_LIMITS = { maxEntries: 512, maxTotalUncompBytes: 64 * 1024 * 1024 };
const MAX_JSON_BYTES = 8 * 1024 * 1024; // one JSON member may not exceed 8 MiB uncompressed

const decoder = new TextDecoder('utf-8');

/** Reject path traversal & friends. Returns the normalized path or null. */
export function sanitizeZipPath(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name.includes('..')) return null;
  if (name.includes('\\')) return null;
  if (name.startsWith('/')) return null;
  if (name.includes(':')) return null; // drive letters / URL-ish
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name.replace(/\/+/g, '/');
}

/** Locate the End of Central Directory and return { cdCount, cdOffset }. */
function locateEocd(view, len) {
  const min = Math.max(0, len - 65557);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_MAGIC) {
      return { cdCount: view.getUint16(i + 10, true), cdOffset: view.getUint32(i + 16, true) };
    }
  }
  return null;
}

/** Parse the central directory into { name, method, compSize, uncompSize, localOffset }[]. */
export function listZipEntries(buffer) {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength ?? buffer.length);
  const len = view.byteLength;
  const eocd = locateEocd(view, len);
  if (!eocd) throw new Error('无效的 ZIP 文件格式（未找到中央目录定位标记）');

  const entries = [];
  let cur = eocd.cdOffset;
  for (let i = 0; i < eocd.cdCount; i++) {
    if (view.getUint32(cur, true) !== CDFH_MAGIC) break;
    const method = view.getUint16(cur + 10, true);
    const compSize = view.getUint32(cur + 20, true);
    const uncompSize = view.getUint32(cur + 24, true);
    const nameLen = view.getUint16(cur + 28, true);
    const extraLen = view.getUint16(cur + 30, true);
    const commentLen = view.getUint16(cur + 32, true);
    const localOffset = view.getUint32(cur + 42, true);
    const nameBytes = new Uint8Array(view.buffer, cur + 46, nameLen);
    entries.push({ name: decoder.decode(nameBytes), method, compSize, uncompSize, localOffset });
    cur += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

let zlibInflateRaw = null;
async function loadNodeZlib() {
  if (zlibInflateRaw) return zlibInflateRaw;
  const mod = await import('node:zlib');
  zlibInflateRaw = (u8) => mod.inflateRawSync(u8);
  return zlibInflateRaw;
}

/** Decompress one entry to Uint8Array. method 0 = stored, 8 = deflate-raw. */
export async function readZipEntry(buffer, entry) {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength ?? buffer.length);
  const local = entry.localOffset;
  if (view.getUint32(local, true) !== LOCAL_MAGIC) throw new Error(`zip 本地头魔数不匹配: ${entry.name}`);
  const nameLen = view.getUint16(local + 26, true);
  const extraLen = view.getUint16(local + 28, true);
  const dataOffset = local + 30 + nameLen + extraLen;
  const data = new Uint8Array(view.buffer, dataOffset, entry.compSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();
      const out = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(out);
    }
    const inflate = await loadNodeZlib();
    return inflate(data);
  }
  throw new Error(`不支持的压缩方式 (${entry.method}): ${entry.name}`);
}

/**
 * Extract the whole archive into { name → Uint8Array }, with zip-bomb guards:
 * entry count cap, total uncompressed cap, and a per-entry ratio cap
 * (ratio > 100 AND uncompressed > 1 MiB → reject the archive outright).
 */
export async function extractZipToMap(buffer, limits = {}) {
  const maxEntries = limits.maxEntries ?? DEFAULT_LIMITS.maxEntries;
  const maxTotalUncompBytes = limits.maxTotalUncompBytes ?? DEFAULT_LIMITS.maxTotalUncompBytes;
  const entries = listZipEntries(buffer);
  if (entries.length > maxEntries) throw new Error(`zip 条目数超上限 (${entries.length} > ${maxEntries})`);

  let total = 0;
  const out = new Map();
  for (const entry of entries) {
    if (entry.uncompSize > MAX_JSON_BYTES * 8) throw new Error(`zip 条目解压后过大: ${entry.name}`);
    if (entry.uncompSize > 1024 * 1024 && entry.compSize > 0 && entry.uncompSize / entry.compSize > 100) {
      throw new Error(`zip 可疑压缩比条目（疑似 zip 炸弹）: ${entry.name}`);
    }
    const bytes = await readZipEntry(buffer, entry);
    total += bytes.byteLength;
    if (total > maxTotalUncompBytes) throw new Error(`zip 解压总量超上限 (${total} > ${maxTotalUncompBytes})`);
    out.set(entry.name, bytes);
  }
  return out;
}

function stripRoot(name) {
  // Accept both "pack.json" and "<single-root>/pack.json" layouts.
  const parts = name.split('/');
  return parts.length <= 1 ? name : parts[parts.length - 1];
}

/**
 * Unpack a mod pack zip into the memory contract { meta, sections, kits, art }.
 * JSON members that fail to parse throw (fail-closed). Unknown sections are ignored;
 * kits/ are kept as source strings and NEVER evaluated here.
 */
export async function unpackModZip(buffer) {
  const files = await extractZipToMap(buffer);
  const meta = null;
  const sections = {};
  const kits = {};
  const art = {};

  const byBasename = new Map();
  for (const name of files.keys()) {
    const safe = sanitizeZipPath(name);
    if (safe === null) throw new Error(`zip 内含非法路径: ${name}`);
    byBasename.set(stripRoot(safe), name);
  }

  // pack.json → meta (fail-closed on bad JSON)
  const metaName = byBasename.get('pack.json');
  let parsedMeta = null;
  if (metaName) {
    parsedMeta = JSON.parse(decoder.decode(files.get(metaName)));
  }

  const sectionSet = new Set(CUSTOM_SECTIONS);
  for (const [basename, name] of byBasename) {
    const m = /^([a-z]+)\.json$/i.exec(basename);
    const section = m ? m[1].toLowerCase() : null;
    if (section && sectionSet.has(section)) {
      if (sections[section] !== undefined) throw new Error(`包内重复段文件: ${basename}`);
      if (files.get(name).byteLength > MAX_JSON_BYTES) throw new Error(`段文件过大: ${basename}`);
      sections[section] = JSON.parse(decoder.decode(files.get(name)));
    } else if (/\.js$/i.test(basename)) {
      kits[basename] = decoder.decode(files.get(name));
    } else if (name.includes('art/')) {
      const rel = name.split('art/')[1] || '';
      if (rel) art[rel] = files.get(name);
    }
  }

  return { meta: parsedMeta ?? meta, sections, kits, art };
}
