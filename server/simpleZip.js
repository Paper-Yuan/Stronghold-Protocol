// server/simpleZip.js — Zero-dependency streaming zip generator for mod packaging
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (~crc) >>> 0;
}

export function createZipFromDir(dirPath) {
  const files = [];

  function scan(current, rel = '') {
    const list = fs.readdirSync(current);
    for (const item of list) {
      if (item.startsWith('.')) continue;
      const full = path.join(current, item);
      const fileRel = rel ? `${rel}/${item}` : item;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scan(full, fileRel);
      } else if (stat.isFile()) {
        files.push({ full, rel: fileRel, size: stat.size });
      }
    }
  }

  scan(dirPath);

  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const f of files) {
    const rawData = fs.readFileSync(f.full);
    const compressed = zlib.deflateRawSync(rawData);
    const useCompressed = compressed.length < rawData.length;
    const data = useCompressed ? compressed : rawData;
    const method = useCompressed ? 8 : 0;
    const fileCrc = crc32(rawData);
    const nameBuf = Buffer.from(f.rel.replace(/\\/g, '/'), 'utf8');

    // Local file header: 30 bytes + name
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);         // version needed (2.0)
    lh.writeUInt16LE(0, 6);          // flags
    lh.writeUInt16LE(method, 8);     // compression method
    lh.writeUInt16LE(0, 10);         // mod time
    lh.writeUInt16LE(0, 12);         // mod date
    lh.writeUInt32LE(fileCrc, 14);   // crc-32
    lh.writeUInt32LE(data.length, 18); // compressed size
    lh.writeUInt32LE(rawData.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // name length
    lh.writeUInt16LE(0, 28);         // extra field length
    nameBuf.copy(lh, 30);

    localHeaders.push(lh);
    localHeaders.push(data);

    // Central directory header: 46 bytes + name
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4);         // version made by
    cd.writeUInt16LE(20, 6);         // version needed
    cd.writeUInt16LE(0, 8);          // flags
    cd.writeUInt16LE(method, 10);    // method
    cd.writeUInt16LE(0, 12);         // time
    cd.writeUInt16LE(0, 14);         // date
    cd.writeUInt32LE(fileCrc, 16);   // crc-32
    cd.writeUInt32LE(data.length, 20); // compressed size
    cd.writeUInt32LE(rawData.length, 24); // uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // name len
    cd.writeUInt16LE(0, 30);         // extra len
    cd.writeUInt16LE(0, 32);         // comment len
    cd.writeUInt16LE(0, 34);         // disk start
    cd.writeUInt16LE(0, 36);         // internal attrs
    cd.writeUInt32LE(0, 38);         // external attrs
    cd.writeUInt32LE(offset, 42);    // relative offset of local header
    nameBuf.copy(cd, 46);

    centralHeaders.push(cd);
    offset += lh.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // disk where central dir starts
  eocd.writeUInt16LE(files.length, 8); // total entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // size of central dir
  eocd.writeUInt32LE(centralDirOffset, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20);         // comment len

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Zero-dependency pure JS ZIP extractor using built-in node:zlib
 * Safe against path traversal (Zip Slip)
 * @param {Buffer} buf
 * @param {string} destDir
 */
export function extractZip(buf, destDir) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('无效的 ZIP 数据');
  fs.mkdirSync(destDir, { recursive: true });

  // 1. Locate End of Central Directory Record (0x06054b50)
  let eocdOffset = -1;
  const maxSearch = Math.min(buf.length, 65536 + 22);
  for (let i = buf.length - 22; i >= buf.length - maxSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('未找到 ZIP 目录结束标记 (EOCD)');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let cur = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (cur + 46 > buf.length) break;
    if (buf.readUInt32LE(cur) !== 0x02014b50) break;

    const method = buf.readUInt16LE(cur + 10);
    const compSize = buf.readUInt32LE(cur + 20);
    const uncompSize = buf.readUInt32LE(cur + 24);
    const nameLen = buf.readUInt16LE(cur + 28);
    const extraLen = buf.readUInt16LE(cur + 30);
    const commentLen = buf.readUInt16LE(cur + 32);
    const lhOffset = buf.readUInt32LE(cur + 42);

    const nameStr = buf.toString('utf8', cur + 46, cur + 46 + nameLen);
    cur += 46 + nameLen + extraLen + commentLen;

    // Normalise and prevent Zip Slip
    const safeRel = path.normalize(nameStr).replace(/^(\.\.[\/\\])+/, '');
    const outPath = path.join(destDir, safeRel);
    if (!outPath.startsWith(path.resolve(destDir) + path.sep) && outPath !== path.resolve(destDir)) {
      continue; // Skip dangerous paths
    }

    if (nameStr.endsWith('/') || nameStr.endsWith('\\')) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }

    // Read local header to get true data offset
    if (lhOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(lhOffset) !== 0x04034b50) continue;
    const lhNameLen = buf.readUInt16LE(lhOffset + 26);
    const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
    const dataStart = lhOffset + 30 + lhNameLen + lhExtraLen;
    const dataSlice = buf.subarray(dataStart, dataStart + compSize);

    let extractedData;
    if (method === 0) {
      extractedData = dataSlice;
    } else if (method === 8) {
      extractedData = zlib.inflateRawSync(dataSlice);
    } else {
      // unsupported compression method, skip
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, extractedData);
  }
}

