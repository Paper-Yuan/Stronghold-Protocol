#!/usr/bin/env node
/**
 * scripts/publish-update.mjs — Cloudflare R2 hot-update packager / publisher.
 *
 * Default output is a LEAN bundle: server + shared + data + the web code, without public/assets.
 * The 361 MB of spine/portrait/BGM already lives in the APK (assets/app_bundle.zip) and changes far
 * less often than code, so a hot update only has to move code: ~15 MB instead of 300 MB.
 * UpdateManager carries the installed public/assets across the atomic swap; pass --full when the art
 * itself changed and you want a self-contained package.
 *
 *   node scripts/publish-update.mjs                     # build into dist/r2
 *   node scripts/publish-update.mjs --full              # include public/assets
 *   node scripts/publish-update.mjs --upload --bucket=stronghold-dist --cdn-base=https://cdn.example.net
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { computeBuildTag } from '../tools/build-tag.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// --- CLI -----------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, def = null) {
  const prefix = `--${name}=`;
  for (const a of args) if (a.startsWith(prefix)) return a.slice(prefix.length);
  return def;
}
const doUpload = args.includes('--upload');
const includeAssets = args.includes('--full');
const outDir = path.resolve(getArg('out-dir', path.join(ROOT, 'dist', 'r2')));
const cdnBase = (getArg('cdn-base', process.env.R2_CDN_BASE || 'https://cdn.example.com')).replace(/\/+$/, '');
const bucketName = getArg('bucket', process.env.R2_BUCKET_NAME || 'stronghold-dist');
const minApk = Number(getArg('min-apk', process.env.R2_MIN_APK || '1'));

// public/ subdirectories that never belong in a bundle: the copyrighted art mirror and the local-only
// recordings.
const PUBLIC_SKIP_ALWAYS = new Set(['dev']);
// Never swept in even if they appear inside a copied tree.
const SKIP_DIR_NAMES = new Set(['.git', '.cache', 'dist', 'dist-i18n', 'node_modules', '__pycache__']);

const buildTag = computeBuildTag(ROOT, pkg.version);

console.log('======================================================');
console.log('  卫戍协议：盟约 · Cloudflare R2 热更新包打包发布工具');
console.log('======================================================');
console.log(`  应用版本   : v${pkg.version}`);
console.log(`  Build Tag  : ${buildTag}`);
console.log(`  打包范围   : ${includeAssets ? '全量（含 public/assets）' : '精简（不含 public/assets）'}`);
console.log(`  输出目录   : ${outDir}`);
console.log(`  CDN Base   : ${cdnBase}`);
console.log('------------------------------------------------------');

const stagingDir = path.join(ROOT, '.cache', 'r2-bundle-staging');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

function copyTree(src, dest, skipDirs = null) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return;
  }
  if (!stat.isDirectory()) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (skipDirs && skipDirs.has(entry)) continue;
    if (SKIP_DIR_NAMES.has(entry)) continue;
    copyTree(path.join(src, entry), path.join(dest, entry), skipDirs);
  }
}

console.log('[1/4] 正在归集 Web 与服务端核心运行时...');
copyTree(path.join(ROOT, 'server'), path.join(stagingDir, 'server'));
copyTree(path.join(ROOT, 'shared'), path.join(stagingDir, 'shared'));
copyTree(path.join(ROOT, 'data'), path.join(stagingDir, 'data'));
copyTree(path.join(ROOT, 'public'), path.join(stagingDir, 'public'), includeAssets
  ? PUBLIC_SKIP_ALWAYS
  : new Set([...PUBLIC_SKIP_ALWAYS, 'assets']));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(stagingDir, 'package.json'));

// The same license gate tools/bundle-android.mjs runs for the APK (P0-2): a lean bundle still
// distributes these files, so slimming can never quietly drop the notices.
const licensesDir = path.join(stagingDir, 'licenses');
fs.mkdirSync(licensesDir, { recursive: true });
const copyNotice = (from, to) => {
  if (fs.existsSync(path.join(ROOT, from))) fs.copyFileSync(path.join(ROOT, from), path.join(licensesDir, to));
};
copyNotice('LICENSE', 'LICENSE.txt');
copyNotice('NOTICE.md', 'NOTICE.txt');
copyNotice('THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.txt');
if (fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'))) {
  const publicLicenses = path.join(stagingDir, 'public', 'licenses');
  fs.mkdirSync(publicLicenses, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(publicLicenses, 'THIRD-PARTY-NOTICES.txt'));
}

console.log('[2/4] 归集生产依赖 (ws, preact, htm, pixi.js, pixi-spine, three)...');
const prodModules = ['ws', 'preact', 'htm', 'pixi.js', 'pixi-spine', 'three'];
fs.mkdirSync(path.join(stagingDir, 'node_modules'), { recursive: true });
for (const mod of prodModules) {
  const modPath = path.join(ROOT, 'node_modules', mod);
  if (!fs.existsSync(modPath)) continue;
  fs.cpSync(modPath, path.join(stagingDir, 'node_modules', mod), { recursive: true });
}

fs.mkdirSync(path.join(outDir, 'bundles'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'apk'), { recursive: true });

const bundleZipName = `bundle-${buildTag}${includeAssets ? '-full' : ''}.zip`;
const bundleZipPath = path.join(outDir, 'bundles', bundleZipName);

console.log(`[3/4] 正在压缩热更包到 ${bundleZipPath}...`);
// Sorted walk + forward-slash arcnames: os.sep-relative names on Windows would land in the zip as
// "server\\index.js", and the device-side unzip would create literal backslash files instead of
// directories. Sorting also keeps the digest stable when rebuilding an unchanged tree.
const pyZipScript = `
import zipfile, os, sys

staging = sys.argv[1]
target = sys.argv[2]

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        dirs.sort()
        for name in sorted(files):
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, staging).replace(os.sep, '/')
            z.write(full_path, rel_path)
`;
if (spawnSync('python', ['-c', pyZipScript, stagingDir, bundleZipPath], { stdio: 'inherit' }).status !== 0) {
  console.error('✘ 压缩失败！');
  process.exit(1);
}

const pyVerifyScript = `
import zipfile, sys

required = [
    'licenses/THIRD-PARTY-NOTICES.txt',
    'licenses/LICENSE.txt',
    'node_modules/ws/LICENSE',
    'node_modules/preact/LICENSE',
    'node_modules/htm/LICENSE',
    'node_modules/pixi.js/LICENSE',
    'node_modules/pixi-spine/SPINE-LICENSE',
    'node_modules/three/LICENSE',
]
with zipfile.ZipFile(sys.argv[1], 'r') as z:
    names = set(z.namelist())
    missing = [f for f in required if f not in names]
    if missing:
        print('ERROR: 热更包缺少许可证文件: %s' % missing, file=sys.stderr)
        sys.exit(1)
    print('[publish-update] %d 个许可证声明已在包内核对。' % len(required))
`;
if (spawnSync('python', ['-c', pyVerifyScript, bundleZipPath], { stdio: 'inherit' }).status !== 0) {
  console.error('✘ [publish-update] 许可证打包门禁校验失败！');
  process.exit(1);
}

// Streamed hash: a --full bundle is 300 MB+ and must not be pulled into memory.
function streamSha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

const bundleSha256 = streamSha256(bundleZipPath);
const bundleSize = fs.statSync(bundleZipPath).size;

console.log(`  ✔ Bundle 大小: ${(bundleSize / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  ✔ SHA-256    : ${bundleSha256}`);

console.log('[4/4] 正在生成 manifest.json 与 apk/latest.json...');
const manifest = {
  buildTag,
  appVersion: pkg.version,
  minApk: Number.isInteger(minApk) && minApk > 0 ? minApk : 1,
  bundleUrl: `${cdnBase}/bundles/${bundleZipName}`,
  bundleSha256,
  bundleSize,
  // false = the client must carry its installed public/assets across the swap (see UpdateManager).
  includesAssets: includeAssets,
  changelog: `卫戍协议：盟约 v${pkg.version} 运行时更新 (${buildTag})`,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const apkInfo = {
  versionCode: 1,
  versionName: pkg.version,
  minApk: manifest.minApk,
  downloadUrl: `${cdnBase}/apk/Stronghold-v${pkg.version}.apk`,
  changelog: `卫戍协议：盟约 安卓独立端 v${pkg.version}`,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'apk', 'latest.json'), JSON.stringify(apkInfo, null, 2), 'utf8');

fs.rmSync(stagingDir, { recursive: true, force: true });

console.log('\n------------------------------------------------------');
console.log('✔ 本地热更新发布物生成完毕！');
console.log(`  - 清单文件: ${path.join(outDir, 'manifest.json')}`);
console.log(`  - 壳版本号: ${path.join(outDir, 'apk', 'latest.json')}`);
console.log(`  - 热更子包: ${bundleZipPath}`);
console.log('------------------------------------------------------');

if (doUpload) {
  console.log(`\n正在上传发布物至 Cloudflare R2 存储桶: ${bucketName}...`);
  const filesToUpload = [
    { local: path.join(outDir, 'manifest.json'), remote: 'manifest.json' },
    { local: path.join(outDir, 'apk', 'latest.json'), remote: 'apk/latest.json' },
    { local: bundleZipPath, remote: `bundles/${bundleZipName}` },
  ];
  for (const f of filesToUpload) {
    console.log(`  ↑ 上传 ${f.remote}...`);
    const putRes = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucketName}/${f.remote}`, '--file', f.local], {
      stdio: 'inherit',
      shell: true,
    });
    if (putRes.status !== 0) {
      console.error(`  ✘ 上传 ${f.remote} 失败，请检查 wrangler 登录状态与桶名。`);
      process.exitCode = 1;
    }
  }
  if (process.exitCode !== 1) console.log('✔ R2 同步完成！');
} else {
  console.log('\n💡 提示: 若要直接上传到 Cloudflare R2，可执行:');
  console.log(`  node scripts/publish-update.mjs --upload --bucket=${bucketName} --cdn-base=${cdnBase}`);
}
