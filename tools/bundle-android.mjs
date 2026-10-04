#!/usr/bin/env node
// tools/bundle-android.mjs — package server, public, data, and node_modules into android/app/src/main/assets/app_bundle.zip

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyVoicesManifest } from './sync-voices-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const ZIP_TARGET = path.join(ANDROID_ASSETS_DIR, 'app_bundle.zip');
const STAGING_DIR = path.join(ROOT, '.cache', 'android-bundle-staging');

console.log('[bundle-android] Preparing Android app_bundle...');

// 0. READ-ONLY Voice asset gate (P0-1: never write tracked files during build)
console.log('[bundle-android] Verifying voice manifest and assets (read-only)...');
const voiceCheck = verifyVoicesManifest();
if (!voiceCheck.ok) {
  console.error(`✘ [bundle-android] 打包门禁失败: 发现 ${voiceCheck.missing.length} 条磁盘语音未在 data/assets.json 登记！`);
  console.error(`  缺少条目: ${voiceCheck.missing.slice(0, 5).join(', ')}${voiceCheck.missing.length > 5 ? '...' : ''}`);
  console.error('  打包器禁止自动修改受控文件。如需同步，请手动执行: node tools/sync-voices-manifest.mjs --write');
  process.exit(1);
}
console.log(`[bundle-android] 语音资产门禁通过: ${voiceCheck.diskCount}/${voiceCheck.manifestCount} 条已核对 (未触碰任何受跟踪文件)。`);

// 1. Ensure vendor files are built
console.log('[bundle-android] Running vendor check...');
const vendorRes = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'vendor.mjs')], { stdio: 'inherit' });
if (vendorRes.status !== 0) {
  console.error('[bundle-android] vendor.mjs failed');
  process.exit(1);
}

// 2. Prepare staging directory
if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log('[bundle-android] Copying server, shared, data, and public assets...');
copyRecursive(path.join(ROOT, 'server'), path.join(STAGING_DIR, 'server'));
copyRecursive(path.join(ROOT, 'shared'), path.join(STAGING_DIR, 'shared'));
copyRecursive(path.join(ROOT, 'data'), path.join(STAGING_DIR, 'data'));
copyRecursive(path.join(ROOT, 'public'), path.join(STAGING_DIR, 'public'));
copyRecursive(path.join(ROOT, 'package.json'), path.join(STAGING_DIR, 'package.json'));

// P0-2: Bundle root licenses and notices for in-app distribution
console.log('[bundle-android] Bundling distribution licenses and third-party notices...');
const licensesStaging = path.join(STAGING_DIR, 'licenses');
fs.mkdirSync(licensesStaging, { recursive: true });
if (fs.existsSync(path.join(ROOT, 'LICENSE'))) {
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(licensesStaging, 'LICENSE.txt'));
}
if (fs.existsSync(path.join(ROOT, 'NOTICE.md'))) {
  fs.copyFileSync(path.join(ROOT, 'NOTICE.md'), path.join(licensesStaging, 'NOTICE.txt'));
}
if (fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'))) {
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(licensesStaging, 'THIRD-PARTY-NOTICES.txt'));
  // Also expose to Web client static directory
  const publicLicenses = path.join(STAGING_DIR, 'public', 'licenses');
  fs.mkdirSync(publicLicenses, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(publicLicenses, 'THIRD-PARTY-NOTICES.txt'));
}

// Set Android bundle engines to >=18 for embedded runtime compatibility
const bundledPkgPath = path.join(STAGING_DIR, 'package.json');
if (fs.existsSync(bundledPkgPath)) {
  const pkgData = JSON.parse(fs.readFileSync(bundledPkgPath, 'utf8'));
  pkgData.engines = { node: ">=18" };
  fs.writeFileSync(bundledPkgPath, JSON.stringify(pkgData, null, 2), 'utf8');
}

// Copy only necessary production node_modules
console.log('[bundle-android] Copying production node_modules (ws, preact, htm, pixi.js, pixi-spine, three)...');
const prodModules = ['ws', 'preact', 'htm', 'pixi.js', 'pixi-spine', 'three'];
fs.mkdirSync(path.join(STAGING_DIR, 'node_modules'), { recursive: true });
for (const mod of prodModules) {
  const modPath = path.join(ROOT, 'node_modules', mod);
  if (fs.existsSync(modPath)) {
    copyRecursive(modPath, path.join(STAGING_DIR, 'node_modules', mod));
  }
}

// 3. Compress into app_bundle.zip using python zipfile
fs.mkdirSync(ANDROID_ASSETS_DIR, { recursive: true });
console.log(`[bundle-android] Creating zip archive at ${ZIP_TARGET}...`);

const pyScript = `
import zipfile, os, sys

staging = sys.argv[1]
target = sys.argv[2]

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, staging)
            z.write(full_path, rel_path)
print(f"Compressed {target} successfully.")
`;

const zipRes = spawnSync('python', ['-c', pyScript, STAGING_DIR, ZIP_TARGET], { stdio: 'inherit' });
if (zipRes.status !== 0) {
  console.error('[bundle-android] Failed to compress staging directory');
  process.exit(1);
}

// P0-2 Gate: Verify license files exist inside the generated zip archive
console.log('[bundle-android] Verifying license files gate inside app_bundle.zip...');
const verifyPyScript = `
import zipfile, sys

target = sys.argv[1]
required_licenses = [
    'licenses/THIRD-PARTY-NOTICES.txt',
    'licenses/LICENSE.txt',
    'node_modules/ws/LICENSE',
    'node_modules/preact/LICENSE',
    'node_modules/htm/LICENSE',
    'node_modules/pixi.js/LICENSE',
    'node_modules/pixi-spine/SPINE-LICENSE',
    'node_modules/three/LICENSE',
]

with zipfile.ZipFile(target, 'r') as z:
    names = set(z.namelist())
    missing = [f for f in required_licenses if f not in names and f.replace('/', '\\\\') not in names]
    if missing:
        print(f"ERROR: Missing license files in bundle: {missing}", file=sys.stderr)
        sys.exit(1)
    print(f"All {len(required_licenses)} required license notices verified in app_bundle.zip.")
`;

const verifyRes = spawnSync('python', ['-c', verifyPyScript, ZIP_TARGET], { stdio: 'inherit' });
if (verifyRes.status !== 0) {
  console.error('✘ [bundle-android] 许可证打包门禁校验失败！');
  process.exit(1);
}

// Clean up staging
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
const stats = fs.statSync(ZIP_TARGET);
console.log(`[bundle-android] app_bundle.zip generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

// 4. Generate bundle.sha256 hash marker for Android asset extractor
const zipBuffer = fs.readFileSync(ZIP_TARGET);
const hash = crypto.createHash('sha256').update(zipBuffer).digest('hex');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const versionContent = `${rootPkg.version}-${hash.slice(0, 16)}`;
const versionFile = path.join(ANDROID_ASSETS_DIR, 'bundle.sha256');
fs.writeFileSync(versionFile, versionContent, 'utf8');
console.log(`[bundle-android] Generated bundle.sha256: ${versionContent}`);

// 5. Assets whitelist gate: everything in src/main/assets ships inside the APK, so anything that
//    landed there by accident (editor backups, cloud-drive resume markers, stray APKs) would be
//    distributed silently with the release.
const ALLOWED_ASSETS = new Set(['app_bundle.zip', 'bundle.sha256']);
const ALLOWED_ASSET_DIRS = new Set(['licenses']);

function assertAssetsWhitelist() {
  if (!fs.existsSync(ANDROID_ASSETS_DIR)) return;
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
}

assertAssetsWhitelist();

console.log('[bundle-android] Done!');
