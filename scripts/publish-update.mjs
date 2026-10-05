#!/usr/bin/env node
/**
 * scripts/publish-update.mjs
 *
 * Cloudflare R2 热更新包生成与自动化发布工具。
 * 1. 打包精简 Web + Server 资源 (不含 60MB libnode.so)，体积约 15~25MB。
 * 2. 计算 SHA-256 哈希值与大小。
 * 3. 生成 manifest.json 与 apk/latest.json。
 * 4. 支持输出到本地目录或一键同步至 Cloudflare R2 存储桶。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

// 解析 CLI 参数
const args = process.argv.slice(2);
function getArg(name, def = null) {
  const prefix = `--${name}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return def;
}
const doUpload = args.includes('--upload');
const outDir = path.resolve(getArg('out-dir', path.join(ROOT, 'dist', 'r2')));
const cdnBase = (getArg('cdn-base', process.env.R2_CDN_BASE || 'https://cdn.example.com')).replace(/\/+$/, '');
const bucketName = getArg('bucket', process.env.R2_BUCKET_NAME || 'stronghold-dist');

// 获取当前 git commit hash
let gitHash = 'unknown';
try {
  const g = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (g.status === 0 && g.stdout) gitHash = g.stdout.trim();
} catch {}

const appVersion = pkg.version || '0.1.3';
const buildTag = `${appVersion}-${gitHash}`;

console.log('======================================================');
console.log('  卫戍协议：盟约 · Cloudflare R2 热更新包打包发布工具');
console.log('======================================================');
console.log(`  应用版本   : v${appVersion}`);
console.log(`  Build Tag  : ${buildTag}`);
console.log(`  输出目录   : ${outDir}`);
console.log(`  CDN Base   : ${cdnBase}`);
console.log('------------------------------------------------------');

const stagingDir = path.join(ROOT, '.cache', 'r2-bundle-staging');
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

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

console.log('[1/4] 正在归集 Web 与服务端核心运行时...');
copyRecursive(path.join(ROOT, 'server'), path.join(stagingDir, 'server'));
copyRecursive(path.join(ROOT, 'shared'), path.join(stagingDir, 'shared'));
copyRecursive(path.join(ROOT, 'data'), path.join(stagingDir, 'data'));
copyRecursive(path.join(ROOT, 'public'), path.join(stagingDir, 'public'));
copyRecursive(path.join(ROOT, 'package.json'), path.join(stagingDir, 'package.json'));

// 复制许可证
const licensesDir = path.join(stagingDir, 'licenses');
fs.mkdirSync(licensesDir, { recursive: true });
if (fs.existsSync(path.join(ROOT, 'LICENSE'))) fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(licensesDir, 'LICENSE.txt'));
if (fs.existsSync(path.join(ROOT, 'NOTICE.md'))) fs.copyFileSync(path.join(ROOT, 'NOTICE.md'), path.join(licensesDir, 'NOTICE.txt'));
if (fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'))) {
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(licensesDir, 'THIRD-PARTY-NOTICES.txt'));
  const pubLic = path.join(stagingDir, 'public', 'licenses');
  fs.mkdirSync(pubLic, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(pubLic, 'THIRD-PARTY-NOTICES.txt'));
}

// 嵌入生产 node_modules
console.log('[2/4] 归集生产依赖 (ws, preact, htm, pixi.js, pixi-spine, three)...');
const prodModules = ['ws', 'preact', 'htm', 'pixi.js', 'pixi-spine', 'three'];
fs.mkdirSync(path.join(stagingDir, 'node_modules'), { recursive: true });
for (const mod of prodModules) {
  const modPath = path.join(ROOT, 'node_modules', mod);
  if (fs.existsSync(modPath)) {
    copyRecursive(modPath, path.join(stagingDir, 'node_modules', mod));
  }
}

// 压缩为 zip
fs.mkdirSync(path.join(outDir, 'bundles'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'apk'), { recursive: true });

const bundleZipName = `bundle-${buildTag}.zip`;
const bundleZipPath = path.join(outDir, 'bundles', bundleZipName);

console.log(`[3/4] 正在压缩热更包到 ${bundleZipPath}...`);
const pyZipScript = `
import zipfile, os, sys

staging = sys.argv[1]
target = sys.argv[2]

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, staging)
            z.write(full_path, rel_path)
`;
const pyRes = spawnSync('python', ['-c', pyZipScript, stagingDir, bundleZipPath], { stdio: 'inherit' });
if (pyRes.status !== 0) {
  console.error('✘ 压缩失败！');
  process.exit(1);
}

// 计算 SHA256 与文件大小
const bundleBuf = fs.readFileSync(bundleZipPath);
const bundleSha256 = crypto.createHash('sha256').update(bundleBuf).digest('hex');
const bundleSize = bundleBuf.length;

console.log(`  ✔ Bundle 大小: ${(bundleSize / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  ✔ SHA-256    : ${bundleSha256}`);

// 生成 manifest.json
console.log('[4/4] 正在生成 manifest.json 与 apk/latest.json...');
const manifest = {
  buildTag,
  appVersion,
  minApk: 1,
  bundleUrl: `${cdnBase}/bundles/${bundleZipName}`,
  bundleSha256,
  bundleSize,
  changelog: `卫戍协议：盟约 v${appVersion} 运行时更新 (${gitHash})`,
  updatedAt: new Date().toISOString()
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const apkInfo = {
  versionCode: 1,
  versionName: appVersion,
  minApk: 1,
  downloadUrl: `${cdnBase}/apk/Stronghold-v${appVersion}.apk`,
  changelog: `卫戍协议：盟约 安卓独立端 v${appVersion}`,
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(outDir, 'apk', 'latest.json'), JSON.stringify(apkInfo, null, 2), 'utf8');

// 清理 staging
fs.rmSync(stagingDir, { recursive: true, force: true });

console.log('\n------------------------------------------------------');
console.log('✔ 本地热更新发布物生成完毕！');
console.log(`  - 清单文件: ${path.join(outDir, 'manifest.json')}`);
console.log(`  - 壳版本号: ${path.join(outDir, 'apk', 'latest.json')}`);
console.log(`  - 热更子包: ${bundleZipPath}`);
console.log('------------------------------------------------------');

// 上传到 Cloudflare R2
if (doUpload) {
  console.log(`\n正在上传发布物至 Cloudflare R2 存储桶: ${bucketName}...`);
  try {
    // 检查 wrangler CLI 是否可用
    const filesToUpload = [
      { local: path.join(outDir, 'manifest.json'), remote: 'manifest.json' },
      { local: path.join(outDir, 'apk', 'latest.json'), remote: 'apk/latest.json' },
      { local: bundleZipPath, remote: `bundles/${bundleZipName}` }
    ];
    for (const f of filesToUpload) {
      console.log(`  ↑ 上传 ${f.remote}...`);
      const putRes = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucketName}/${f.remote}`, '--file', f.local], {
        stdio: 'inherit',
        shell: true
      });
      if (putRes.status !== 0) {
        console.warn(`  [!] 上传 ${f.remote} 遇到问题，请检查 wrangler r2 凭证。`);
      }
    }
    console.log('✔ R2 同步完成！');
  } catch (err) {
    console.error('✘ 上传过程发生异常:', err.message);
  }
} else {
  console.log('\n💡 提示: 若要直接上传到 Cloudflare R2，可执行:');
  console.log(`  node scripts/publish-update.mjs --upload --bucket=${bucketName} --cdn-base=${cdnBase}`);
}
