#!/usr/bin/env node
// scripts/build-android.mjs — One-command build script for Stronghold Protocol Android APK

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const IS_WIN = process.platform === 'win32';

console.log('======================================================');
console.log('  卫戍协议：盟约 · Android APK 打包构建工具');
console.log('======================================================\n');

// P2-2: Non-ASCII project path warning
if (/[^\x00-\x7F]/.test(ROOT)) {
  console.warn('------------------------------------------------------');
  console.warn(`[!] 警告: 当前工程根目录路径含有非 ASCII 字符:`);
  console.warn(`    ${ROOT}`);
  console.warn(`    在 Windows 命令行下可能导致 Gradle 输出乱码或产生文件锁死。`);
  console.warn(`    若遇到 mergeDebugResources 报 "另一个程序正在使用此文件"，`);
  console.warn(`    请在 android 目录运行: gradlew.bat --stop 释放 Gradle Daemon 锁，`);
  console.warn(`    或建议将代码克隆至纯英文字符短路径下构建。`);
  console.warn('------------------------------------------------------\n');
}

// P0-1: Record baseline git status to verify zero unexpected tracked file modifications
function getGitStatus() {
  try {
    const res = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    if (res.status === 0) return res.stdout.trim();
  } catch { /* ignore if git unavailable */ }
  return null;
}
const gitStatusBefore = getGitStatus();

// P1-1: Verify native dependencies sha256 checksums before building
console.log('[0/2] 正在校验原生动态库 (Native Binaries) 哈希与来源清单...');
const nativeDepsPath = path.join(ANDROID_DIR, 'NATIVE_DEPS.json');
if (!fs.existsSync(nativeDepsPath)) {
  console.error(`✘ 找不到原生依赖清单: ${nativeDepsPath}`);
  process.exit(1);
}

try {
  const nativeDeps = JSON.parse(fs.readFileSync(nativeDepsPath, 'utf8'));
  for (const lib of nativeDeps.libraries || []) {
    const fullPath = path.join(ANDROID_DIR, lib.path);
    if (!fs.existsSync(fullPath)) {
      console.error(`✘ 原生库文件缺失: ${lib.path} (${fullPath})`);
      process.exit(1);
    }
    const buf = fs.readFileSync(fullPath);
    const actualHash = crypto.createHash('sha256').update(buf).digest('hex');
    if (actualHash.toLowerCase() !== lib.sha256.toLowerCase()) {
      console.error(`✘ 原生库哈希校验失败: ${lib.name} [${lib.abi}]`);
      console.error(`  期望哈希: ${lib.sha256}`);
      console.error(`  实际哈希: ${actualHash}`);
      process.exit(1);
    }
    if (!lib.url || !lib.url.startsWith('https://')) {
      console.error(`✘ 原生库来源 URL 不合规 (必须为 https): ${lib.url}`);
      process.exit(1);
    }
    console.log(`  ✔ [${lib.abi}] ${lib.name} (${(lib.size / 1024 / 1024).toFixed(1)} MB) sha256 校验通过`);
  }
} catch (err) {
  console.error('✘ 原生库清单解析或校验异常:', err.message);
  process.exit(1);
}

// 1. Bundle web client and backend scripts
console.log('\n[1/2] 正在打包 Web 资源与服务端脚本到 Android 资源包...');
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
  console.error('\n✘ Gradle 构建失败。若出现文件被占用锁冲突，请在 android 目录运行: gradlew.bat --stop');
  process.exit(1);
}

// P0-1 Acceptance Gate: Ensure git status of tracked files remained untouched
if (gitStatusBefore !== null) {
  const gitStatusAfter = getGitStatus();
  if (gitStatusBefore !== gitStatusAfter) {
    console.error('\n✘ [P0-1 门禁失败] 打包过程意外修改了 Git 跟踪文件或产生了新的未跟踪文件！');
    console.error('--- 差异排查 ---');
    console.error('构建前状态:\n' + gitStatusBefore);
    console.error('构建后状态:\n' + gitStatusAfter);
    process.exit(1);
  }
  console.log('✔ [P0-1 门禁通过] 打包过程未污染或修改任何 Git 工作树文件。');
}

if (fs.existsSync(apkOutput)) {
  const stat = fs.statSync(apkOutput);
  console.log('\n✔ 构建完成！');
  console.log(`  APK 路径: ${apkOutput}`);
  console.log(`  文件大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} else {
  console.log('\n✔ Gradle 运行成功，请前往 android/app/build/outputs/apk/ 查看产物。');
}
