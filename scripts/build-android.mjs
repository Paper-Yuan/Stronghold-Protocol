#!/usr/bin/env node
// scripts/build-android.mjs — One-command build script for Stronghold Protocol Android APK

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const IS_WIN = process.platform === 'win32';

console.log('======================================================');
console.log('  卫戍协议：盟约 · Android APK 打包构建工具');
console.log('======================================================\n');

// 1. Bundle web client and backend scripts
console.log('[1/2] 正在打包 Web 资源与服务端脚本到 Android 资源包...');
const bundleScript = path.join(ROOT, 'tools', 'bundle-android.mjs');
const bundleRes = spawnSync(process.execPath, [bundleScript], { stdio: 'inherit' });
if (bundleRes.status !== 0) {
  console.error('✘ 打包 app_bundle.zip 失败，请检查上方日志。');
  process.exit(1);
}

// 2. Invoke Gradle to assemble APK
console.log('\n[2/2] 正在执行 Gradle 构建 APK...');
const apkOutput = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (fs.existsSync(apkOutput)) {
  fs.rmSync(apkOutput, { force: true });
}
const gradlewCmd = IS_WIN ? path.join(ANDROID_DIR, 'gradlew.bat') : path.join(ANDROID_DIR, 'gradlew');
const gradleArgs = ['assembleDebug'];

// If gradlew doesn't exist, check dists
let finalCmd = gradlewCmd;
if (!fs.existsSync(gradlewCmd)) {
  const defaultDist = path.join(process.env.USERPROFILE || '', '.gradle', 'wrapper', 'dists', 'gradle-8.0.2-all', '25ipb77ce0ypy3f9xdton1ae6', 'gradle-8.0.2', 'bin', IS_WIN ? 'gradle.bat' : 'gradle');
  if (fs.existsSync(defaultDist)) {
    finalCmd = defaultDist;
  }
}

const buildRes = spawnSync(finalCmd, gradleArgs, {
  cwd: ANDROID_DIR,
  stdio: 'inherit',
  shell: IS_WIN
});

if (buildRes.status !== 0) {
  console.error('\n✘ Gradle 构建失败。');
  process.exit(1);
}

if (fs.existsSync(apkOutput)) {
  const stat = fs.statSync(apkOutput);
  console.log('\n✔ 构建完成！');
  console.log(`  APK 路径: ${apkOutput}`);
  console.log(`  文件大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} else {
  console.log('\n✔ Gradle 运行成功，请前往 android/app/build/outputs/apk/ 查看产物。');
}
