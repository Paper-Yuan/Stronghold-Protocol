// server/mod/zipWriter.js — minimal zip writer for the mod publish pipeline (Node-only).
// The single implementation: test/helpers/miniZip.js re-exports buildZip from here so the
// test fixtures and the publish pipeline produce byte-compatible archives.
// No dependencies: raw deflate via node:zlib, correct CRC-32 per entry.

import { deflateRawSync } from 'node:zlib';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a zip Buffer from { name → content(Buffer|string) }.
 * @param {Record<string, Buffer|string|Uint8Array>} members
 * @param {0|8} method 0 = stored, 8 = deflate (default)
 */
export function buildZip(members, method = 8) {
  const chunks = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const nameB = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content
      : content instanceof Uint8Array ? Buffer.from(content)
      : Buffer.from(content, 'utf8');
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

/** Recursively read a directory into { relativePath → Buffer } (forward slashes). */
export async function readTree(dir, base = dir) {
  const out = {};
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) Object.assign(out, await readTree(full, base));
    else if (ent.isFile()) out[path.relative(base, full).replace(/\\/g, '/')] = await fsp.readFile(full);
  }
  return out;
}
