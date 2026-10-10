#!/usr/bin/env node
// tools/bundle-android.mjs — package server, public, data, and node_modules into android/app/src/main/assets/app_bundle.zip

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyVoicesManifest } from './sync-voices-manifest.mjs';
import { zipDir, zipEntryNames, rewriteCapabilities } from '../scripts/pack/_lib.mjs';

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

// --capabilities <file>: variant build (无限/, docs/ANDROID.md §9). After staging, rewrite both
// capabilities.js copies from the JSON payload (the established rewriteCapabilities patcher), so
// the variant's feature set becomes a physical property of the shipped bytes — the repo source
// files are never touched.
const capFlagIdx = process.argv.indexOf('--capabilities');
if (capFlagIdx >= 0) {
  const capFile = process.argv[capFlagIdx + 1];
  if (!capFile || !fs.existsSync(capFile)) {
    console.error(`✘ [bundle-android] --capabilities 需要一个存在的 JSON 文件，得到: ${capFile || '(缺失)'}`);
    process.exit(1);
  }
  let payload;
  try { payload = JSON.parse(fs.readFileSync(capFile, 'utf8')); } catch (err) {
    console.error(`✘ [bundle-android] capabilities JSON 解析失败: ${err.message}`);
    process.exit(1);
  }
  const KNOWN = ['endless', 'mods', 'multiplayer'];
  const unknown = Object.keys(payload).filter((k) => !KNOWN.includes(k));
  const badValues = KNOWN.filter((k) => k in payload && typeof payload[k] !== 'boolean');
  if (unknown.length || badValues.length) {
    console.error(`✘ [bundle-android] capabilities 载荷非法: 未知键 [${unknown.join(', ')}]，非布尔值 [${badValues.join(', ')}]`);
    process.exit(1);
  }
  // 全量键一起传：改写结果只由变体定义决定，不随源文件当前值的漂移而漂移。
  // 内核已不再声明的能力位（如 endless 被整体移除）自动跳过并提示——变体定义允许与内核短暂错位。
  const values = { endless: true, mods: true, multiplayer: true, ...payload };
  for (const rel of ['shared/capabilities.js', 'public/shared/capabilities.js']) {
    const dest = path.join(STAGING_DIR, ...rel.split('/'));
    const src = fs.readFileSync(dest, 'utf8');
    const present = KNOWN.filter((k) => new RegExp(`^\\s*${k}:\\s*(?:true|false),`, 'm').test(src));
    const ignored = Object.keys(payload).filter((k) => !present.includes(k));
    if (ignored.length) {
      console.warn(`[bundle-android] ⚠ 变体定义里的能力位在 capabilities.js 中不存在，已忽略: ${ignored.join(', ')}`);
    }
    if (!present.length) {
      console.error(`✘ [bundle-android] capabilities 改写失败（源文件里没有任何能力位行，形态变化？）: ${rel}`);
      process.exit(1);
    }
    const rewritten = rewriteCapabilities(src, values);
    if (!rewritten) {
      console.error(`✘ [bundle-android] capabilities 改写失败（键缺失或源文件形态变化）: ${rel}`);
      process.exit(1);
    }
    fs.writeFileSync(dest, rewritten, 'utf8');
    // fail-closed 自检：改写后的文件必须逐键命中期望值，否则这个变体包就是静默错包。
    for (const k of present) {
      if (!new RegExp(`^\\s*${k}: ${values[k]},`, 'm').test(rewritten)) {
        console.error(`✘ [bundle-android] 变体自检失败: ${rel} 的 ${k} 不是 ${values[k]}`);
        process.exit(1);
      }
    }
  }
  console.log(`[bundle-android] 变体能力位已写入暂存副本并自检通过: ${JSON.stringify(payload)}`);
}

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

// 3. Compress into app_bundle.zip（纯 Node 写入器，见 scripts/pack/_lib.mjs —— 不再依赖 python）
fs.mkdirSync(ANDROID_ASSETS_DIR, { recursive: true });
console.log(`[bundle-android] Creating zip archive at ${ZIP_TARGET}...`);

// rootName: null —— 解压到 filesDir/bundle 后 public/、server/、data/ 要直接躺在根下，不能多一层目录。
const zipInfo = zipDir(STAGING_DIR, ZIP_TARGET, { rootName: null });
console.log(`[bundle-android] Compressed ${zipInfo.files} files: ${(zipInfo.bytes / 1048576).toFixed(1)} MB -> ${(zipInfo.zipBytes / 1048576).toFixed(1)} MB`);

// P0-2 Gate: Verify license files exist inside the generated zip archive
console.log('[bundle-android] Verifying license files gate inside app_bundle.zip...');
const REQUIRED_LICENSES = [
  'licenses/THIRD-PARTY-NOTICES.txt',
  'licenses/LICENSE.txt',
  'node_modules/ws/LICENSE',
  'node_modules/preact/LICENSE',
  'node_modules/htm/LICENSE',
  'node_modules/pixi.js/LICENSE',
  'node_modules/pixi-spine/SPINE-LICENSE',
  'node_modules/three/LICENSE',
];
// 条目名统一成 `/` 分隔再比对（zipDir 写的就是 `/`，这里只是防御手工放进来的包）。
const bundleNames = new Set(zipEntryNames(ZIP_TARGET).map((n) => n.replace(/\\/g, '/')));
const missingLicenses = REQUIRED_LICENSES.filter((f) => !bundleNames.has(f));
if (missingLicenses.length) {
  console.error(`✘ [bundle-android] 许可证打包门禁校验失败！缺少: ${missingLicenses.join(', ')}`);
  process.exit(1);
}
console.log(`[bundle-android] All ${REQUIRED_LICENSES.length} required license notices verified in app_bundle.zip.`);

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
