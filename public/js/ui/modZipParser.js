// public/js/ui/modZipParser.js — Zero-dependency client-side ZIP inspector for mods.
// Uses Web Streams API DecompressionStream('deflate-raw') supported across all modern browsers.

/**
 * Parse a mod zip archive from File or ArrayBuffer.
 * Extracts pack.json, manifest.json, README.md and basic archive statistics.
 * @param {File|Blob|ArrayBuffer} fileOrBuffer
 * @returns {Promise<{
 *   id: string, name: string, version: string, app: string,
 *   credits: string, summary: string, readme: string|null,
 *   features: string[], fileCount: number, totalBytes: number,
 *   packJson: object|null, manifestJson: object|null
 * }>}
 */
export async function parseModZip(fileOrBuffer) {
  const arrayBuffer = fileOrBuffer instanceof ArrayBuffer
    ? fileOrBuffer
    : await fileOrBuffer.arrayBuffer();
  const view = new DataView(arrayBuffer);
  const len = arrayBuffer.byteLength;

  // 1. Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  const minOffset = Math.max(0, len - 65557);
  for (let i = len - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('无效的 ZIP 文件格式（未找到中央目录定位标记）');
  }

  const cdCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  // 2. Parse Central Directory headers
  const entries = {};
  let cur = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(cur, true) !== 0x02014b50) break;
    const method = view.getUint16(cur + 10, true);
    const compSize = view.getUint32(cur + 20, true);
    const uncompSize = view.getUint32(cur + 24, true);
    const nameLen = view.getUint16(cur + 28, true);
    const extraLen = view.getUint16(cur + 30, true);
    const commentLen = view.getUint16(cur + 32, true);
    const localHeaderOffset = view.getUint32(cur + 42, true);

    const nameBytes = new Uint8Array(arrayBuffer, cur + 46, nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    entries[name] = { method, compSize, uncompSize, localHeaderOffset };
    cur += 46 + nameLen + extraLen + commentLen;
  }

  // 3. Helper to decompress and read text file
  async function readText(targetName) {
    const keys = Object.keys(entries);
    let targetKey = keys.find((k) => k === targetName || k.endsWith('/' + targetName));
    if (!targetKey) return null;
    const entry = entries[targetKey];
    const localCur = entry.localHeaderOffset;
    const localNameLen = view.getUint16(localCur + 26, true);
    const localExtraLen = view.getUint16(localCur + 28, true);
    const dataOffset = localCur + 30 + localNameLen + localExtraLen;
    const data = new Uint8Array(arrayBuffer, dataOffset, entry.compSize);

    if (entry.method === 0) {
      return new TextDecoder('utf-8').decode(data);
    }
    if (entry.method === 8) {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder('utf-8').decode(decompressed);
      }
    }
    return null;
  }

  // 4. Extract metadata
  let packJson = null;
  let manifestJson = null;
  let readme = null;

  try {
    const r = await readText('pack.json');
    if (r) packJson = JSON.parse(r);
  } catch {}

  try {
    const r = await readText('manifest.json');
    if (r) manifestJson = JSON.parse(r);
  } catch {}

  try {
    readme = await readText('README.md');
  } catch {}

  const name = packJson?.name || manifestJson?.name || '未知模组';
  const id = packJson?.id || manifestJson?.mod || manifestJson?.pack || 'mod';
  const version = packJson?.version || manifestJson?.version || '1.0.0';
  const app = packJson?.app || manifestJson?.app || '>=0.2.0';
  const credits = packJson?.credits || manifestJson?.credits || '社区同人作品';

  // 5. Extract features and summary from README or metadata
  const features = [];
  let summary = '';

  if (readme) {
    // Extract key bullets from README
    const lines = readme.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('* **') || trimmed.startsWith('- **')) {
        features.push(trimmed.replace(/^[*\-]\s*\*\*/, '').replace(/\*\*[:：]?\s*/, '：').replace(/\*\*$/, ''));
      }
    }
    // Extract main intro
    const introLines = [];
    let collecting = false;
    for (const line of lines) {
      if (line.startsWith('# ')) {
        collecting = true;
        continue;
      }
      if (line.startsWith('## ')) break;
      if (collecting && line.trim()) {
        introLines.push(line.trim());
      }
    }
    summary = introLines.join(' ');
  }

  if (!summary) {
    summary = packJson?._doc || `包含 ${Object.keys(entries).length} 个文件的自定义模组扩展包。`;
  }

  if (!features.length) {
    if (entries['fanpack-mod/payload/data/chess.json'] || entries['packs/fanpack/chess.json']) {
      features.push('自定义干员与棋子扩展');
    }
    if (entries['fanpack-mod/payload/data/items.json'] || entries['packs/fanpack/records.json']) {
      features.push('自定义装备与盟约效果');
    }
  }

  return {
    id,
    name,
    version,
    app,
    credits,
    summary,
    readme,
    features,
    fileCount: Object.keys(entries).length,
    totalBytes: len,
    packJson,
    manifestJson,
  };
}
