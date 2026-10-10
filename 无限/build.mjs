#!/usr/bin/env node
// 无限/build.mjs — 纯单人无尽模式安卓变体（docs/ANDROID.md §9）的一键打包驱动。
//
// 变体的定义只有一句话：主仓库的暂存副本 + 把两份 capabilities.js 改写成
// { endless: true, mods: false, multiplayer: false }（共享内核与主包逐字节一致，
// 仓库源文件永不改动，改写只发生在 tools/bundle-android.mjs 的暂存目录里）。
// Gradle 侧用 -PappIdSuffix=.endless -PversionNameSuffix=-endless 让变体 APK 与主包同机共存。
// 打包器在暂存期对改写结果做逐键自检（fail-closed），这里不再重复校验。
//
// 用法：
//   node 无限/build.mjs              # debug APK → 无限/dist/
//   node 无限/build.mjs --release    # release APK（签名走 scripts/build-android.mjs 的既有流程）
//   node 无限/build.mjs --bundle-only  # 只产出并校验变体 app_bundle.zip，不调 Gradle（快速检查变体内容）
//
// 注意：打包取的是当前工作树（与主包构建一致）——未提交的改动会被带进包里；变体构建
// 会把 android/app/src/main/assets/app_bundle.zip 覆盖为变体内容，下一次主包构建会自动重新生成主包内容。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAPABILITIES = path.join(HERE, 'capabilities.json');
const DIST = path.join(HERE, 'dist');
const RELEASE = process.argv.includes('--release');
const BUNDLE_ONLY = process.argv.includes('--bundle-only');

console.log('======================================================');
console.log('  卫戍协议：盟约 · 无限变体（纯单人无尽）打包');
console.log('======================================================\n');

// 1. 变体 app_bundle.zip（--capabilities 在暂存期改写两份 capabilities.js 并自检）
const bundle = spawnSync(process.execPath,
  [path.join(ROOT, 'tools', 'bundle-android.mjs'), '--capabilities', CAPABILITIES],
  { stdio: 'inherit' });
if (bundle.status !== 0) {
  console.error('✘ 变体 app_bundle.zip 打包失败，请检查上方日志。');
  process.exit(1);
}

if (BUNDLE_ONLY) {
  console.log('\n✔ --bundle-only：变体资源包已生成并自检通过（未调 Gradle）。');
  process.exit(0);
}

// 2. Gradle 构建（同机共存属性在 build-android.mjs 里透传）
const build = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'build-android.mjs'),
  ...(RELEASE ? ['--release'] : []),
  '-PappIdSuffix=.endless',
  '-PversionNameSuffix=-endless',
], { stdio: 'inherit' });
if (build.status !== 0) process.exit(1);

// 3. 产物收进 无限/dist/（带变体名 + SHA256，供分发核对）
const variantDir = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', RELEASE ? 'release' : 'debug');
const candidates = RELEASE
  ? ['Stronghold-Protocol-release.apk']
  : ['app-debug.apk'];
const built = candidates.map((f) => path.join(variantDir, f)).find((p) => fs.existsSync(p));
if (!built) {
  console.error(`✘ 未找到 Gradle 产物（${candidates.join(' / ')}）。`);
  process.exit(1);
}
fs.mkdirSync(DIST, { recursive: true });
const outName = RELEASE ? 'Stronghold-Protocol-Endless-release.apk' : 'Stronghold-Protocol-Endless-debug.apk';
const outApk = path.join(DIST, outName);
fs.copyFileSync(built, outApk);
const buf = fs.readFileSync(outApk);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(path.join(DIST, 'SHA256.txt'), `${sha}  ${outName}\n`, 'utf8');
console.log('\n✔ 无限变体构建完成！');
console.log(`  APK 路径: ${outApk}`);
console.log(`  文件大小: ${(buf.length / 1048576).toFixed(2)} MB`);
console.log(`  SHA-256 : ${sha}`);
console.log(`  校验文件: ${path.join(DIST, 'SHA256.txt')}`);
