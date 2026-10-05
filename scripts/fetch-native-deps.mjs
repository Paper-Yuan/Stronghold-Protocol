#!/usr/bin/env node
// scripts/fetch-native-deps.mjs — Fetch the Android native dependencies instead of
// keeping them in git. Produces (idempotently, unless --force):
//
//   android/app/src/main/jniLibs/<abi>/libnode.so          nodejs-mobile v18.20.4 prebuilt runtime
//   android/app/src/main/jniLibs/<abi>/libc++_shared.so    copied from the LOCAL Android NDK
//   android/app/src/main/cpp/include/node/                 Node headers for the JNI glue
//
// Sources:
//   - https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip
//     (downloaded into android/third_party/ and verified against android/NATIVE_DEPS.json)
//   - $ANDROID_HOME/ndk/<latest>/.../sysroot/usr/lib/<triple>/libc++_shared.so
//     (libnode.so links the NDK's shared C++ runtime, so it must ship next to it)
//
// Usage: node scripts/fetch-native-deps.mjs [--force]
//   The download prefers curl (uses the system cert store, so it keeps working when TLS
//   is intercepted by security software) and falls back to the built-in fetch API.

import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const JNILIBS = join(ANDROID, 'app', 'src', 'main', 'jniLibs');
const CPP_INCLUDE = join(ANDROID, 'app', 'src', 'main', 'cpp', 'include');
const THIRD_PARTY = join(ANDROID, 'third_party');
const NATIVE_DEPS = join(ANDROID, 'NATIVE_DEPS.json');

const NODEJS_MOBILE_VERSION = '18.20.4';
const NODEJS_MOBILE_TAG = `v${NODEJS_MOBILE_VERSION}`;
const NODEJS_MOBILE_URL =
  `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/${NODEJS_MOBILE_TAG}/nodejs-mobile-${NODEJS_MOBILE_TAG}-android.zip`;
const ZIP_PATH = join(THIRD_PARTY, `nodejs-mobile-${NODEJS_MOBILE_TAG}-android.zip`);
const EXTRACT_DIR = join(THIRD_PARTY, `nodejs-mobile-${NODEJS_MOBILE_TAG}-android`);

const ABIS = ['arm64-v8a', 'x86_64'];
const FORCE = process.argv.includes('--force');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Read the expected libnode.so sha256 per ABI from android/NATIVE_DEPS.json. */
function expectedLibnodeShas() {
  const manifest = JSON.parse(readFileSync(NATIVE_DEPS, 'utf8'));
  const shas = {};
  for (const lib of manifest.libraries || []) {
    if (lib.name === 'libnode.so' && ABIS.includes(lib.abi)) shas[lib.abi] = lib.sha256.toLowerCase();
  }
  for (const abi of ABIS) {
    if (!shas[abi]) throw new Error(`NATIVE_DEPS.json has no libnode.so entry for ${abi}`);
  }
  return shas;
}

/**
 * Download url -> dest. Prefers curl (ships with Windows 10+/macOS/Linux and validates
 * against the system cert store, which keeps working when TLS is intercepted by security
 * software); falls back to global fetch (Node 18+), which follows redirects.
 * Downloads land in a `.part` sibling and are renamed into place only on success, so a
 * truncated transfer can never poison the cache; an interrupted `.part` is resumed.
 */
function downloadWithCurl(url, dest) {
  const part = dest + '.part';
  mkdirSync(dirname(dest), { recursive: true });
  // --speed-limit/--speed-time abort connections that stall instead of hanging forever
  const curlOpts = ['-fSL', '--retry', '3', '--speed-limit', '5120', '--speed-time', '60'];
  if (existsSync(part)) {
    try {
      // resume where the previous attempt stopped (curl exits 33 if ranges are unsupported)
      execFileSync('curl', [...curlOpts, '-C', '-', '-o', part, url], { stdio: 'inherit' });
      renameSync(part, dest);
      return;
    } catch (err) {
      if (err.status !== 33) throw err;
    }
  }
  execFileSync('curl', [...curlOpts, '-o', part, url], { stdio: 'inherit' });
  renameSync(part, dest);
}

async function downloadWithFetch(url, dest) {
  const part = dest + '.part';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(part, buf);
  renameSync(part, dest);
}

async function download(url, dest) {
  try {
    downloadWithCurl(url, dest);
  } catch (err) {
    if (err.code === 'ENOENT') return downloadWithFetch(url, dest); // curl not installed
    throw err;
  }
}

/** Cheap zip sanity check: an End Of Central Directory record must exist near the file end. */
function zipLooksValid(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, 65535 + 22);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.lastIndexOf('PK\x05\x06') !== -1;
  } finally {
    closeSync(fd);
  }
}

function extractZip(zipPath, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Force -LiteralPath "${zipPath}" -DestinationPath "${dest}"`]);
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dest]);
  }
}

/** The zip may extract with a nested top-level directory — find the dir that contains bin/. */
function resolvePayloadDir() {
  if (existsSync(join(EXTRACT_DIR, 'bin'))) return EXTRACT_DIR;
  if (!existsSync(EXTRACT_DIR)) return null;
  const nested = readdirSync(EXTRACT_DIR).find((d) => existsSync(join(EXTRACT_DIR, d, 'bin')));
  return nested ? join(EXTRACT_DIR, nested) : null;
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const f = join(from, name);
    if (statSync(f).isDirectory()) copyDir(f, join(to, name));
    else copyFileSync(f, join(to, name));
  }
}

/** libnode.so links the NDK's shared C++ runtime — ship libc++_shared.so next to it. */
function syncStl() {
  const outs = ABIS.map((abi) => join(JNILIBS, abi, 'libc++_shared.so'));
  if (!FORCE && outs.every(existsSync)) {
    console.log('[stl] libc++_shared.so already present, skipping');
    return;
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    throw new Error('ANDROID_HOME is not set — cannot locate the NDK libc++_shared.so. ' +
      'Set ANDROID_HOME to your Android SDK (it contains ndk/<version>/).');
  }
  const ndkRoot = join(sdk, 'ndk');
  const versions = existsSync(ndkRoot) ? readdirSync(ndkRoot).sort().reverse() : [];
  if (!versions.length) throw new Error(`No NDK found under ${ndkRoot}`);
  const hostTag = process.platform === 'win32' ? 'windows-x86_64'
    : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const sysroot = join(ndkRoot, versions[0], 'toolchains', 'llvm', 'prebuilt', hostTag, 'sysroot', 'usr', 'lib');
  const triples = { 'arm64-v8a': 'aarch64-linux-android', 'x86_64': 'x86_64-linux-android' };
  for (const abi of ABIS) {
    const from = join(sysroot, triples[abi], 'libc++_shared.so');
    if (!existsSync(from)) throw new Error(`libc++_shared.so not found for ${abi} at ${from}`);
    const to = join(JNILIBS, abi, 'libc++_shared.so');
    mkdirSync(join(JNILIBS, abi), { recursive: true });
    copyFileSync(from, to);
    console.log(`[stl] ${abi}: libc++_shared.so copied from NDK ${versions[0]} (sha256 ${sha256(to)})`);
  }
}

async function main() {
  const expected = expectedLibnodeShas();

  // ---- overall skip: everything already in place and matching? ----
  const libnodeOk = ABIS.every((abi) => {
    const so = join(JNILIBS, abi, 'libnode.so');
    return existsSync(so) && sha256(so) === expected[abi];
  });
  const headersOk = existsSync(join(CPP_INCLUDE, 'node', 'node.h'));
  const stlOk = ABIS.every((abi) => existsSync(join(JNILIBS, abi, 'libc++_shared.so')));
  if (!FORCE && libnodeOk && headersOk && stlOk) {
    console.log('[fetch-native] all native deps already present and matching — nothing to do');
    return;
  }

  // ---- 1. download the nodejs-mobile zip if needed ----
  if (existsSync(ZIP_PATH)) {
    if (zipLooksValid(ZIP_PATH)) {
      console.log('[fetch-native] zip already downloaded, skipping download');
    } else {
      // keep the bytes: move the broken file to .part so the next download can resume it
      console.warn('[fetch-native] existing zip is corrupt/truncated — will re-download (resuming where possible)');
      const part = ZIP_PATH + '.part';
      rmSync(part, { force: true });
      renameSync(ZIP_PATH, part);
    }
  }
  if (!existsSync(ZIP_PATH)) {
    console.log(`[fetch-native] downloading ${NODEJS_MOBILE_URL}`);
    try {
      await download(NODEJS_MOBILE_URL, ZIP_PATH);
    } catch (err) {
      throw new Error(`Download failed (${err.message}). Manually place the zip at ${ZIP_PATH} and re-run.`);
    }
  }

  // ---- 2. extract ----
  let src = resolvePayloadDir();
  if (!src) {
    console.log('[fetch-native] extracting nodejs-mobile runtime ...');
    if (existsSync(EXTRACT_DIR)) rmSync(EXTRACT_DIR, { recursive: true, force: true });
    extractZip(ZIP_PATH, EXTRACT_DIR);
    src = resolvePayloadDir();
  }
  if (!src) throw new Error(`libnode.so payload not found after extracting ${ZIP_PATH}`);

  // ---- 3. libnode.so per ABI, verified against NATIVE_DEPS.json ----
  for (const abi of ABIS) {
    const from = join(src, 'bin', abi, 'libnode.so');
    if (!existsSync(from)) throw new Error(`libnode.so not found for ${abi} in ${src}`);
    const to = join(JNILIBS, abi, 'libnode.so');
    if (!FORCE && existsSync(to) && sha256(to) === expected[abi]) {
      console.log(`[libnode] ${abi}: already present, skipping`);
      continue;
    }
    mkdirSync(join(JNILIBS, abi), { recursive: true });
    copyFileSync(from, to);
    const actual = sha256(to);
    if (actual !== expected[abi]) {
      console.warn(`[libnode] WARN sha256 mismatch for ${abi}:`);
      console.warn(`  expected: ${expected[abi]}`);
      console.warn(`  actual  : ${actual}`);
    } else {
      console.log(`[libnode] ${abi}: sha256 ok (${actual})`);
    }
  }

  // ---- 4. Node headers (zip include/node/* -> cpp/include/node/) ----
  if (!FORCE && headersOk) {
    console.log('[headers] already present, skipping');
  } else {
    const from = join(src, 'include', 'node');
    if (!existsSync(from)) throw new Error(`Node headers not found at ${from}`);
    copyDir(from, join(CPP_INCLUDE, 'node'));
    console.log('[headers] copied into android/app/src/main/cpp/include/node/');
  }

  // ---- 5. libc++_shared.so from the local NDK ----
  syncStl();

  console.log('[fetch-native] done');
}

main().catch((err) => {
  console.error('[fetch-native] FAILED:', err.message);
  process.exit(1);
});
