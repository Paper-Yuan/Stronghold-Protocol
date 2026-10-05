#!/usr/bin/env node
// tools/bundle-android.mjs — package the game for the Android shell into two content-hashed
// archives under android/app/src/main/assets/:
//
//   core.zip    server/ shared/ data/ node_modules/ws package.json licenses/
//               plus public/ EXCLUDING public/assets + public/fonts
//               (DEFLATE for text/data, STORE for media extensions)
//   assets.zip  public/assets/** + public/fonts/**, all STORED
//               (media is pre-compressed, so on-device extraction stays a pure copy)
//   pack.json   { version, coreSha, assetsSha, coreEntries, assetsEntries }
//
// The shell (android/app/src/main/java/com/paper/stronghold/AssetManagerHelper.kt) compares the
// SHA-256 hashes in pack.json against marker files under filesDir/bundle and re-extracts only
// the archives that actually changed, so a code-only app update no longer re-extracts the full
// ~280 MB asset set.
//
// The ZIP writer below is a minimal implementation (local headers + central directory + EOCD,
// CRC-32, UTF-8 name flag, no ZIP64) kept deliberately dependency- and python-free.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { verifyVoicesManifest } from './sync-voices-manifest.mjs';
import { computeBuildTag } from './build-tag.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const CORE_ZIP = path.join(ANDROID_ASSETS_DIR, 'core.zip');
const ASSETS_ZIP = path.join(ANDROID_ASSETS_DIR, 'assets.zip');
const PACK_JSON = path.join(ANDROID_ASSETS_DIR, 'pack.json');

// Media already carries its own (better) compression — STORE it so extraction on the device is
// a pure copy; everything else (code, JSON, tables) is DEFLATEd inside core.zip. assets.zip is
// STORED unconditionally.
const STORE_EXT = new Set([
  '.png', '.jpg', '.webp', '.ogg', '.mp3', '.skel', '.atlas', '.otf', '.ttf', '.woff2', '.zip',
]);

/** Recursively walk a directory; yields relative paths using '/'. */
function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

// -------------------------------------------------------------------- zip writer

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer: STORED or raw-DEFLATE entries, UTF-8 name flag, fixed timestamp so the
 * output is deterministic (same inputs → same SHA-256). Fits well under ZIP64 limits.
 */
class ZipWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.createWriteStream(filePath);
    this.offset = 0;
    this.central = [];
  }

  #write(buf) {
    return new Promise((resolve, reject) => {
      this.fd.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Add one entry; `data` is a Buffer or a file path to read. */
  async entry(name, data, store) {
    const dataBuf = Buffer.isBuffer(data) ? data : fs.readFileSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(dataBuf);
    const payload = store ? dataBuf : deflateRawSync(dataBuf, { level: 6 });
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 name flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date 1996-01-01 (fixed → deterministic output)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    await this.#write(local);
    await this.#write(nameBuf);
    await this.#write(payload);

    this.central.push({ nameBuf, crc, csize: payload.length, usize: dataBuf.length, offset: this.offset, method });
    this.offset += local.length + nameBuf.length + payload.length;
  }

  async finish() {
    const centralStart = this.offset;
    for (const e of this.central) {
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(0x02014b50, 0);
      rec.writeUInt16LE(20, 4); // version made by
      rec.writeUInt16LE(20, 6); // version needed
      rec.writeUInt16LE(0x0800, 8); // UTF-8 name flag
      rec.writeUInt16LE(e.method, 10);
      rec.writeUInt16LE(0, 12); // time
      rec.writeUInt16LE(0x21, 14); // date
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.csize, 20);
      rec.writeUInt32LE(e.usize, 24);
      rec.writeUInt16LE(e.nameBuf.length, 28);
      rec.writeUInt32LE(e.offset, 42);
      await this.#write(rec);
      await this.#write(e.nameBuf);
      this.offset += rec.length + e.nameBuf.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.central.length, 8);
    eocd.writeUInt16LE(this.central.length, 10);
    eocd.writeUInt32LE(this.offset - centralStart, 12);
    eocd.writeUInt32LE(centralStart, 16);
    await this.#write(eocd);
    await new Promise((resolve) => this.fd.end(resolve));
  }
}

/** Pack `entries` ({name, data|file, store}) into `zipPath`; returns sha256/count/size/names. */
async function buildZip(zipPath, entries) {
  const zw = new ZipWriter(zipPath);
  for (const e of entries) await zw.entry(e.name, e.data ?? e.file, e.store);
  await zw.finish();
  const buf = fs.readFileSync(zipPath);
  return {
    sha: crypto.createHash('sha256').update(buf).digest('hex'),
    count: entries.length,
    bytes: buf.length,
    names: zw.central.map((e) => e.nameBuf.toString('utf8')),
  };
}

/**
 * Independent structural read-back: parse the EOCD + central directory of a written zip and
 * return its entry names. Used by the license gate to verify the produced artifact itself.
 */
function readZipNames(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`EOCD not found in ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`corrupt central directory in ${zipPath}`);
    }
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// -------------------------------------------------------------------- main

async function main() {
  console.log('[bundle-android] Preparing Android asset packs (core.zip + assets.zip)...');

  // 0. READ-ONLY voice asset gate (P0-1: never write tracked files during build)
  console.log('[bundle-android] Verifying voice manifest and assets (read-only)...');
  const voiceCheck = verifyVoicesManifest();
  if (!voiceCheck.ok) {
    console.error(`✘ [bundle-android] 打包门禁失败: 发现 ${voiceCheck.missing.length} 条磁盘语音未在 data/assets.json 登记！`);
    console.error(`  缺少条目: ${voiceCheck.missing.slice(0, 5).join(', ')}${voiceCheck.missing.length > 5 ? '...' : ''}`);
    console.error('  打包器禁止自动修改受控文件。如需同步，请手动执行: node tools/sync-voices-manifest.mjs --write');
    process.exit(1);
  }
  console.log(`[bundle-android] 语音资产门禁通过: ${voiceCheck.diskCount}/${voiceCheck.manifestCount} 条已核对 (未触碰任何受跟踪文件)。`);

  // 1. Ensure vendor files are built (client libs land in public/vendor → core.zip)
  console.log('[bundle-android] Running vendor check...');
  const vendorRes = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'vendor.mjs')], { stdio: 'inherit' });
  if (vendorRes.status !== 0) {
    console.error('[bundle-android] vendor.mjs failed');
    process.exit(1);
  }

  // 2. Collect core entries: everything the embedded Node runtime + web client code needs.
  const coreEntries = [];
  for (const dir of ['server', 'shared', 'data']) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) {
      console.error(`[bundle-android] required source directory missing: ${dir}/`);
      process.exit(1);
    }
    for (const rel of walk(src)) {
      coreEntries.push({ name: `${dir}/${rel}`, file: path.join(src, rel), store: STORE_EXT.has(extOf(rel)) });
    }
  }

  // The embedded runtime only serves Node >=18; record that in the shipped package.json.
  const pkgPath = path.join(ROOT, 'package.json');
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkgData.engines = { node: '>=18' };
  coreEntries.push({ name: 'package.json', data: Buffer.from(JSON.stringify(pkgData, null, 2), 'utf8'), store: false });

  // ws is the only node_modules package the embedded server requires at runtime; the client
  // libraries (pixi/preact/htm/three/pixi-spine) ship as minified builds in public/vendor.
  const wsDir = path.join(ROOT, 'node_modules', 'ws');
  if (!fs.existsSync(wsDir)) {
    console.error('[bundle-android] node_modules/ws missing — run npm install first.');
    process.exit(1);
  }
  for (const rel of walk(wsDir)) {
    coreEntries.push({ name: `node_modules/ws/${rel}`, file: path.join(wsDir, rel), store: STORE_EXT.has(extOf(rel)) });
  }

  // public/ minus the two heavy media trees (those go into assets.zip below). The distribution
  // notices are re-added explicitly so they cannot be lost to local working-tree differences.
  const pubDir = path.join(ROOT, 'public');
  if (!fs.existsSync(pubDir)) {
    console.error('[bundle-android] public/ missing — nothing to pack.');
    process.exit(1);
  }
  for (const rel of walk(pubDir)) {
    if (rel.startsWith('assets/') || rel.startsWith('fonts/')) continue;
    if (rel === 'licenses/THIRD-PARTY-NOTICES.txt') continue; // re-added from the root notice below
    coreEntries.push({ name: `public/${rel}`, file: path.join(pubDir, rel), store: STORE_EXT.has(extOf(rel)) });
  }

  // P0-2: bundle root licenses and third-party notices for in-app distribution
  console.log('[bundle-android] Bundling distribution licenses and third-party notices...');
  const licenseEntries = [];
  const addLicense = (name, srcName) => {
    const src = path.join(ROOT, srcName);
    if (fs.existsSync(src)) licenseEntries.push({ name, data: fs.readFileSync(src), store: false });
  };
  addLicense('licenses/LICENSE.txt', 'LICENSE');
  addLicense('licenses/NOTICE.txt', 'NOTICE.md');
  addLicense('licenses/THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.md');
  addLicense('public/licenses/THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.md');
  coreEntries.push(...licenseEntries);

  // 3. Asset entries: the heavy media trees, all STORED (pure-copy install on the device).
  const assetEntries = [];
  const missingMedia = [];
  for (const top of ['assets', 'fonts']) {
    const dir = path.join(ROOT, 'public', top);
    if (!fs.existsSync(dir)) {
      missingMedia.push(`public/${top}`);
      continue;
    }
    for (const rel of walk(dir)) {
      // keep the assets/ … fonts/ … prefix so the staged archive roots line up with public/
      assetEntries.push({ name: `${top}/${rel}`, file: path.join(dir, rel), store: true });
    }
  }
  if (missingMedia.length) {
    console.warn(`[bundle-android] WARN: ${missingMedia.join(', ')} 不存在 — 请先运行素材下载流程；本次 APK 将不含这些资源。`);
  }

  // 4. Write the archives.
  fs.mkdirSync(ANDROID_ASSETS_DIR, { recursive: true });
  // Retire artifacts of the previous single-archive format so they cannot ride along in the APK.
  // (bundle.sha256 is NOT stale: it is regenerated below as the UpdateManager build tag.)
  for (const stale of ['app_bundle.zip']) {
    const stalePath = path.join(ANDROID_ASSETS_DIR, stale);
    if (fs.existsSync(stalePath)) {
      fs.rmSync(stalePath, { force: true });
      console.log(`[bundle-android] Removed stale ${stale}`);
    }
  }

  console.log(`[bundle-android] Writing ${CORE_ZIP} (${coreEntries.length} entries)...`);
  const coreResult = await buildZip(CORE_ZIP, coreEntries);
  console.log(`[bundle-android] core.zip : ${coreResult.count} entries, ${(coreResult.bytes / 1024 / 1024).toFixed(2)} MB`);

  console.log(`[bundle-android] Writing ${ASSETS_ZIP} (${assetEntries.length} entries, stored)...`);
  const assetResult = await buildZip(ASSETS_ZIP, assetEntries);
  console.log(`[bundle-android] assets.zip: ${assetResult.count} entries, ${(assetResult.bytes / 1024 / 1024).toFixed(2)} MB`);

  // P0-2 Gate: verify the license files actually made it into the produced archive.
  console.log('[bundle-android] Verifying license files gate inside core.zip...');
  const REQUIRED_LICENSES = [
    'licenses/LICENSE.txt',
    'licenses/NOTICE.txt',
    'licenses/THIRD-PARTY-NOTICES.txt',
    'public/licenses/THIRD-PARTY-NOTICES.txt',
    'node_modules/ws/LICENSE',
  ];
  const coreNames = readZipNames(CORE_ZIP);
  if (coreNames.length !== coreResult.count) {
    console.error(`✘ [bundle-android] core.zip 结构校验失败: 中心目录含 ${coreNames.length} 项，预期 ${coreResult.count} 项。`);
    process.exit(1);
  }
  const missing = REQUIRED_LICENSES.filter((n) => !coreNames.includes(n));
  if (missing.length) {
    console.error(`✘ [bundle-android] 许可证打包门禁校验失败！缺少: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (readZipNames(ASSETS_ZIP).length !== assetResult.count) {
    console.error('✘ [bundle-android] assets.zip 结构校验失败: 中心目录条目数不符。');
    process.exit(1);
  }
  console.log(`[bundle-android] All ${REQUIRED_LICENSES.length} required license notices verified in core.zip.`);

  // 5. pack.json — content hashes the Android shell uses to skip unchanged archives.
  const packMeta = {
    version: pkgData.version,
    coreSha: coreResult.sha,
    assetsSha: assetResult.sha,
    coreEntries: coreResult.count,
    assetsEntries: assetResult.count,
  };
  fs.writeFileSync(PACK_JSON, JSON.stringify(packMeta, null, 2), 'utf8');
  console.log(`[bundle-android] pack.json: version ${packMeta.version}, core ${packMeta.coreSha.slice(0, 12)}…, assets ${packMeta.assetsSha.slice(0, 12)}…`);

  // 6. bundle.sha256 — the built-in build tag UpdateManager compares against a hot-update
  //    manifest. It MUST come from the same helper as tools/publish-update.mjs (single
  //    source-tree identity), while pack.json above stays the content-hash feed that
  //    AssetManagerHelper uses for incremental local installs.
  const buildTag = computeBuildTag(ROOT, pkgData.version);
  fs.writeFileSync(path.join(ANDROID_ASSETS_DIR, 'bundle.sha256'), buildTag, 'utf8');
  console.log(`[bundle-android] Generated bundle.sha256: ${buildTag}`);

  // 7. Assets whitelist gate: everything in src/main/assets ships inside the APK, so anything
  //    that landed there by accident (editor backups, cloud-drive resume markers, stray APKs)
  //    would be distributed silently with the release.
  const ALLOWED_ASSETS = new Set(['core.zip', 'assets.zip', 'pack.json', 'bundle.sha256']);
  const ALLOWED_ASSET_DIRS = new Set(['licenses']);

  const strays = fs.readdirSync(ANDROID_ASSETS_DIR, { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? !ALLOWED_ASSET_DIRS.has(e.name) : !ALLOWED_ASSETS.has(e.name)))
    .map((e) => e.name + (e.isDirectory() ? '/' : ''));
  if (strays.length) {
    console.error('✘ [bundle-android] assets 目录混入了非本工具生成的文件，它们会被原样打进 APK：');
    for (const s of strays) console.error(`    - ${path.join(ANDROID_ASSETS_DIR, s)}`);
    console.error('  请删除后重试；确需随包分发的文件请加进 tools/bundle-android.mjs 的白名单。');
    process.exit(1);
  }
  console.log(`[bundle-android] assets 白名单校验通过: ${[...ALLOWED_ASSETS].join(', ')}`);

  console.log('[bundle-android] Done!');
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(process.argv[1]);
    const b = fileURLToPath(import.meta.url);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((e) => {
    console.error('[bundle-android] FAILED:', e.message);
    process.exit(1);
  });
}

export { ZipWriter, buildZip, crc32, readZipNames, walk, STORE_EXT };
