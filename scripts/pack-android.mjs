#!/usr/bin/env node
// pack-android.mjs — builds everything the Android shell needs before `gradle assembleDebug`:
//
//   android/app/src/main/assets/core.zip    server/ shared/ data/ public/(code) node_modules/ws package.json
//   android/app/src/main/assets/assets.zip  public/assets/ public/fonts/          (STORED, media is pre-compressed)
//   android/app/src/main/assets/pack.json   { coreSha, assetsSha, coreEntries, assetsEntries, version }
//   android/app/src/main/jniLibs/<abi>/libnode.so   nodejs-mobile v18.20.4 runtime
//   android/app/src/main/cpp/include/node/          node headers for the JNI glue
//
// The shell (android/app/src/main/java/.../AssetInstaller.kt) extracts the archives on
// first launch and skips re-extraction while the recorded SHA-256 matches pack.json, so
// code-only rebuilds never re-extract the 280 MB asset set.
//
// Usage: node scripts/pack-android.mjs [--force]
//   Network note: if your machine MITMs TLS (security software), run with
//   NODE_USE_SYSTEM_CA=1 so the nodejs-mobile download validates against the Windows store.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const ASSETS_DIR = join(ANDROID, 'app', 'src', 'main', 'assets');
const JNILIBS = join(ANDROID, 'app', 'src', 'main', 'jniLibs');
const CPP_INCLUDE = join(ANDROID, 'app', 'src', 'main', 'cpp', 'include');
const THIRD_PARTY = join(ANDROID, 'third_party');
const NODEJS_MOBILE_VERSION = '18.20.4';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

/** Recursively walk a directory; yields relative paths using '/'. */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

const STORE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.ogg', '.mp3', '.m4a', '.wav',
  '.mp4', '.webm', '.skel', '.atlas', '.otf', '.ttf', '.woff', '.woff2', '.zip',
]);

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

/** Minimal ZIP writer: STORED or raw-DEFLATE entries, UTF-8 names. Fits well under zip64 limits. */
class ZipWriter {
  constructor(path) {
    this.path = path;
    this.fd = createWriteStream(path);
    this.offset = 0;
    this.central = [];
  }

  #write(buf) {
    return new Promise((resolve, reject) => {
      this.fd.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  async entry(name, dataBuf, store) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(dataBuf);
    const payload = store ? dataBuf : deflateRawSync(dataBuf, { level: 6 });
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1996-01-01, deterministic)
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
      rec.writeUInt16LE(20, 4);
      rec.writeUInt16LE(20, 6);
      rec.writeUInt16LE(0x0800, 8);
      rec.writeUInt16LE(e.method, 10);
      rec.writeUInt16LE(0, 12);
      rec.writeUInt16LE(0x21, 14);
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

async function buildZip(zipPath, entries) {
  const zw = new ZipWriter(zipPath);
  for (const { name, file, store } of entries) {
    await zw.entry(name, readFileSync(file), store);
  }
  await zw.finish();
  const buf = readFileSync(zipPath);
  return { sha: createHash('sha256').update(buf).digest('hex'), count: entries.length, bytes: buf.length };
}

// -------------------------------------------------------------------- nodejs-mobile

const LIBNODE_SHA256 = {
  // published upstream hashes of the prebuilt runtime (verify after download)
  'arm64-v8a': '7c907316beb6e78e34495926c9ac1befe079369b14650d508ea812929258250c',
  'x86_64': '9acba7e26a1e864f13b78f1b7121773643f3f33a4c6a2fe7d4f63eb06d4d3af1',
};

function extractZip(zipPath, dest) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Force -LiteralPath "${zipPath}" -DestinationPath "${dest}"`]);
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dest]);
  }
}

/** Locate (or download) the nodejs-mobile zip, then place libnode.so + headers into the app. */
function syncLibnode() {
  const soArm = join(JNILIBS, 'arm64-v8a', 'libnode.so');
  const soX64 = join(JNILIBS, 'x86_64', 'libnode.so');
  const headers = join(CPP_INCLUDE, 'node');
  if (existsSync(soArm) && existsSync(soX64) && existsSync(headers) && !FORCE) {
    console.log('[libnode] already present, skipping');
    return;
  }

  const tag = `v${NODEJS_MOBILE_VERSION}`;
  let src = join(THIRD_PARTY, `nodejs-mobile-${tag}-android`);
  const zipPath = join(THIRD_PARTY, `nodejs-mobile-${tag}-android.zip`);
  if (!existsSync(join(src, 'bin'))) {
    // also accept an extraction with a nested top-level directory
    const nested = existsSync(src)
      ? readdirSync(src).find((d) => existsSync(join(src, d, 'bin')))
      : undefined;
    if (nested) {
      src = join(src, nested);
    } else {
      mkdirSync(THIRD_PARTY, { recursive: true });
      if (!existsSync(zipPath)) {
        const url = `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/${tag}/nodejs-mobile-${tag}-android.zip`;
        console.log(`[libnode] downloading ${url}`);
        try {
          execFileSync('curl', ['-sL', '-o', zipPath, url], { stdio: 'inherit' });
        } catch {
          throw new Error('下载失败：手动下载上面的 zip 放到 android/third_party/ 后重跑');
        }
      }
      console.log('[libnode] extracting …');
      if (existsSync(src)) rmSync(src, { recursive: true, force: true });
      extractZip(zipPath, src);
      const nested2 = readdirSync(src).find((d) => existsSync(join(src, d, 'bin')));
      if (nested2) src = join(src, nested2);
    }
  }
  if (!existsSync(join(src, 'bin'))) throw new Error(`libnode.so 未找到于 ${src}`);

  for (const abi of Object.keys(LIBNODE_SHA256)) {
    const from = join(src, 'bin', abi, 'libnode.so');
    const to = join(JNILIBS, abi, 'libnode.so');
    mkdirSync(join(JNILIBS, abi), { recursive: true });
    copyFileSync(from, to);
    const sha = createHash('sha256').update(readFileSync(to)).digest('hex');
    if (sha !== LIBNODE_SHA256[abi]) {
      console.warn(`[libnode] WARN sha256 mismatch for ${abi}: ${sha}`);
    } else {
      console.log(`[libnode] ${abi}: sha256 ok`);
    }
  }

  if (!existsSync(join(CPP_INCLUDE, 'node'))) {
    copyDir(join(src, 'include', 'node'), join(CPP_INCLUDE, 'node'));
    console.log('[libnode] headers copied');
  }
  syncStl();
}

/** libnode.so links the NDK's shared C++ runtime — ship libc++_shared.so next to it. */
function syncStl() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME 未设置，无法定位 NDK 的 libc++_shared.so');
  const ndkRoot = join(sdk, 'ndk');
  const versions = existsSync(ndkRoot) ? readdirSync(ndkRoot).sort().reverse() : [];
  if (!versions.length) throw new Error('未找到 NDK（$ANDROID_HOME/ndk/*）');
  const sysroot = join(ndkRoot, versions[0], 'toolchains', 'llvm', 'prebuilt',
    process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64',
    'sysroot', 'usr', 'lib');
  for (const [abi, triple] of [['arm64-v8a', 'aarch64-linux-android'], ['x86_64', 'x86_64-linux-android']]) {
    const from = join(sysroot, triple, 'libc++_shared.so');
    const to = join(JNILIBS, abi, 'libc++_shared.so');
    mkdirSync(join(JNILIBS, abi), { recursive: true });
    copyFileSync(from, to);
    console.log(`[stl] ${abi}: libc++_shared.so (${versions[0]})`);
  }
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const f = join(from, name);
    if (statSync(f).isDirectory()) copyDir(f, join(to, name));
    else copyFileSync(f, join(to, name));
  }
}

// -------------------------------------------------------------------- main

async function main() {
  console.log(`[pack] root ${ROOT}`);
  mkdirSync(ASSETS_DIR, { recursive: true });

  syncLibnode();

  // ---- collect core entries (code + data; never the heavy media) ----
  const coreFiles = [];
  for (const dir of ['server', 'shared', 'data']) coreFiles.push(...walk(join(ROOT, dir)).map((p) => ({ rel: `${dir}/${p}` })));
  coreFiles.push({ rel: 'package.json' });
  coreFiles.push(...walk(join(ROOT, 'node_modules', 'ws')).map((p) => ({ rel: `node_modules/ws/${p}` })));
  for (const p of walk(join(ROOT, 'public'))) {
    if (p.startsWith('assets/') || p.startsWith('fonts/')) continue;
    coreFiles.push({ rel: `public/${p}` });
  }
  const coreEntries = coreFiles.map(({ rel }) => ({
    name: rel,
    file: join(ROOT, ...rel.split('/')),
    store: STORE_EXT.has(rel.slice(rel.lastIndexOf('.')).toLowerCase()),
  }));

  // ---- asset entries (public/assets + public/fonts), STORED for fast extraction ----
  const assetFiles = [];
  for (const top of ['assets', 'fonts']) {
    const dir = join(ROOT, 'public', top);
    if (!existsSync(dir)) {
      console.warn(`[pack] WARN: public/${top} 不存在 — 先运行 npm run assets 下载素材`);
      continue;
    }
    assetFiles.push(...walk(dir).map((p) => ({ rel: `${top}/${p}` })));
  }
  const assetEntries = assetFiles.map(({ rel }) => ({
    name: rel,
    file: join(ROOT, 'public', ...rel.split('/')),
    store: true,
  }));

  // ---- skip logic: unchanged asset set → keep the old zip ----
  const packPath = join(ASSETS_DIR, 'pack.json');
  const old = existsSync(packPath) ? JSON.parse(readFileSync(packPath, 'utf8')) : null;
  const assetSignature = createHash('sha256')
    .update(assetEntries.map((e) => e.name).join('\n'))
    .digest('hex');

  let coreResult, assetResult;
  coreResult = await buildZip(join(ASSETS_DIR, 'core.zip'), coreEntries);
  console.log(`[pack] core.zip  ${coreResult.count} entries, ${(coreResult.bytes / 1048576).toFixed(1)} MB`);

  if (!FORCE && old && old.assetSignature === assetSignature && existsSync(join(ASSETS_DIR, 'assets.zip'))) {
    assetResult = { sha: old.assetsSha, count: old.assetsEntries, bytes: old.assetsBytes ?? 0 };
    console.log('[pack] assets.zip unchanged — reusing');
  } else {
    assetResult = await buildZip(join(ASSETS_DIR, 'assets.zip'), assetEntries);
    console.log(`[pack] assets.zip  ${assetResult.count} entries, ${(assetResult.bytes / 1048576).toFixed(1)} MB`);
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(packPath, JSON.stringify({
    version: pkg.version,
    builtAt: new Date().toISOString(),
    assetSignature,
    coreSha: coreResult.sha,
    assetsSha: assetResult.sha,
    coreEntries: coreResult.count,
    assetsEntries: assetResult.count,
    assetsBytes: assetResult.bytes,
  }, null, 2));
  console.log('[pack] pack.json written');
}

main().catch((e) => {
  console.error('[pack] FAILED:', e.message);
  process.exit(1);
});
