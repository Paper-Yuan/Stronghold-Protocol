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
const RELEASE = process.argv.includes('--release');

/** Read `key=value` pairs from android/local.properties (git-ignored; holds sdk.dir and signing creds). */
function readLocalProps() {
  const file = path.join(ANDROID_DIR, 'local.properties');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/);
    // Java properties escaping: a backslash escapes the following char (`C\:\\Users` -> `C:\Users`)
    if (m && !line.startsWith('#')) out[m[1]] = m[2].replace(/\\(.)/g, '$1').trim();
  }
  return out;
}

/** Locate a build-tools executable (zipalign / apksigner), newest installed version first. */
function findBuildTool(name, props) {
  const sdk = props['sdk.dir'] || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const btDir = path.join(sdk, 'build-tools');
  if (!fs.existsSync(btDir)) return null;
  const versions = fs.readdirSync(btDir).sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return 0;
  });
  // apksigner ships as a .bat wrapper, zipalign as a native .exe — try both, then the bare name.
  const exts = IS_WIN ? ['.bat', '.exe', ''] : [''];
  for (const v of versions) {
    for (const ext of exts) {
      const p = path.join(btDir, v, name + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Resolve how to invoke apksigner. The .bat wrapper is unreliable when the shell cwd contains
 * non-ASCII characters (it fails with "找不到指定的路径" on Windows), so prefer the bundled jar
 * running on java when available.
 */
function resolveApksigner(props) {
  const sdk = props['sdk.dir'] || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const btDir = path.join(sdk, 'build-tools');
  if (!fs.existsSync(btDir)) return null;
  const versions = fs.readdirSync(btDir).sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return 0;
  });
  if (spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0) {
    for (const v of versions) {
      const jar = path.join(btDir, v, 'lib', 'apksigner.jar');
      if (fs.existsSync(jar)) return { cmd: 'java', prefix: ['-jar', jar] };
    }
  }
  const bat = findBuildTool('apksigner', props);
  return bat ? { cmd: bat, prefix: [] } : null;
}


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
console.log(`\n[2/3] 正在执行 Gradle 构建 ${RELEASE ? 'release' : 'debug'} APK...`);
const VARIANT = RELEASE ? 'release' : 'debug';
const outDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', VARIANT);
// AGP emits `app-release.apk` when signed via signingConfig, or `app-release-unsigned.apk` when unsigned.
const gradleSignedApk = path.join(outDir, 'app-release.apk');
const unsignedApk = path.join(outDir, 'app-release-unsigned.apk');
const debugApk = path.join(outDir, 'app-debug.apk');
for (const f of [gradleSignedApk, unsignedApk, debugApk]) {
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}
const gradlewCmd = IS_WIN ? path.join(ANDROID_DIR, 'gradlew.bat') : path.join(ANDROID_DIR, 'gradlew');
const gradleArgs = [RELEASE ? 'assembleRelease' : 'assembleDebug'];

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

// 3. Release signing (post-build): zipalign then APK Signature Scheme v1+v2+v3 via build-tools apksigner.
//    必须在 Gradle 之外签：AGP 只按 minSdk 自己决定方案（minSdk 24 时完全不签 v1），而 v1 是少数老设备
//    唯一认的签名。android/app/build.gradle 因此**不设 signingConfig**，Gradle 只产出未签名的
//    app-release-unsigned.apk。密钥库口令只经环境变量传递，不出现在命令行里。
let finalApk = RELEASE ? path.join(outDir, 'Stronghold-Protocol-release.apk') : debugApk;
if (RELEASE) {
  console.log('\n[3/3] 正在对齐并签名 release APK...');
  const props = readLocalProps();
  const creds = {
    storeFile: process.env.SP_STORE_FILE || props.SP_STORE_FILE,
    storePass: process.env.SP_STORE_PASSWORD || props.SP_STORE_PASSWORD,
    alias: process.env.SP_KEY_ALIAS || props.SP_KEY_ALIAS,
    keyPass: process.env.SP_KEY_PASSWORD || props.SP_KEY_PASSWORD,
  };
  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('✘ release 签名配置缺失，无法继续。');
    console.error(`  缺少: ${missing.join(', ')}`);
    console.error('  请在 android/local.properties（已被 git 忽略）中补全，或用同名环境变量提供：');
    console.error('    SP_STORE_FILE=keystore/stronghold-release.keystore');
    console.error('    SP_STORE_PASSWORD=…  SP_KEY_ALIAS=…  SP_KEY_PASSWORD=…');
    console.error('  密钥库请用 keytool 自行生成，不要提交、也不要写进任何受版本控制的文件。');
    process.exit(1);
  }
  const storePath = path.isAbsolute(creds.storeFile) ? creds.storeFile : path.resolve(ANDROID_DIR, creds.storeFile);
  if (!fs.existsSync(storePath)) {
    console.error(`✘ 找不到密钥库: ${storePath}`);
    process.exit(1);
  }
  const zipalign = findBuildTool('zipalign', props);
  const signer = resolveApksigner(props);
  if (!zipalign || !signer) {
    console.error('✘ 未在 Android SDK 中找到 build-tools 的 zipalign / apksigner（或 java），无法签名。');
    process.exit(1);
  }
  // java is exec'd directly; the .bat wrapper needs a shell.
  const signShell = IS_WIN && signer.cmd !== 'java';

  const aligned = path.join(outDir, 'app-release-aligned.apk');
  const signed = path.join(outDir, 'Stronghold-Protocol-release.apk');
  for (const f of [aligned, signed]) if (fs.existsSync(f)) fs.rmSync(f, { force: true });

  if (fs.existsSync(unsignedApk)) {
    // -p: page-align uncompressed .so (required for targetSdk >= 23); 4 = alignment in bytes
    const alignRes = spawnSync(zipalign, ['-f', '-p', '4', unsignedApk, aligned], { stdio: 'inherit', shell: false });
    if (alignRes.status !== 0) {
      console.error('✘ zipalign 失败。');
      process.exit(1);
    }

    const signEnv = { ...process.env, SP_STORE_PASSWORD: creds.storePass, SP_KEY_PASSWORD: creds.keyPass };
    const signRes = spawnSync(signer.cmd, [
      ...signer.prefix,
      'sign',
      '--ks', storePath,
      '--ks-key-alias', creds.alias,
      '--ks-pass', 'env:SP_STORE_PASSWORD',
      '--key-pass', 'env:SP_KEY_PASSWORD',
      // 三种方案显式全开：v1 给老设备，v2 给 Android 7+，v3 支持密钥轮换。
      '--v1-signing-enabled', 'true',
      '--v2-signing-enabled', 'true',
      '--v3-signing-enabled', 'true',
      // 不要 v4：它只服务 adb 增量安装，还会在产物目录旁边留下一个 .idsig 文件。
      '--v4-signing-enabled', 'false',
      '--out', signed,
      aligned,
    ], { stdio: 'inherit', shell: signShell, env: signEnv });
    if (signRes.status !== 0) {
      console.error('✘ apksigner 签名失败。');
      process.exit(1);
    }
  } else if (fs.existsSync(gradleSignedApk)) {
    console.error('✘ Gradle 自己把包签了（android/app/build.gradle 里又被加回了 signingConfig）。');
    console.error('  本脚本要求签名统一由 apksigner 做，且 v1/v2/v3 三种方案全开 —— AGP 按 minSdk 自行决定方案，');
    console.error('  minSdk 24 时它不签 v1，个别老设备会装不上。请去掉 signingConfig 后重试。');
    process.exit(1);
  } else {
    console.error('✘ 未找到构建产物 APK (既无 app-release-unsigned.apk 也无 app-release.apk)。');
    process.exit(1);
  }

  // --min-sdk-version 21 是必须的：apksigner 在 minSdk >= 24 时**跳过 v1 校验**并把 v1 报成 false
  // （签名文件其实在，只是它认为 v2/v3 已足够）。我们要求三种方案齐全，就得让它按"老设备也要能装"来验。
  const verifyRes = spawnSync(signer.cmd, [...signer.prefix, 'verify', '--verbose', '--min-sdk-version', '21', '--print-certs', signed], { encoding: 'utf8', shell: signShell });
  if (verifyRes.status !== 0) {
    console.error('✘ [签名门禁失败] 产出的 APK 未通过 apksigner verify：');
    console.error(verifyRes.stdout || '');
    console.error(verifyRes.stderr || '');
    process.exit(1);
  }
  const verifyOut = verifyRes.stdout || '';
  const schemeOn = (name) => {
    const m = verifyOut.match(new RegExp(`Verified using ${name} scheme[^:]*:\\s*(true|false)`));
    return m ? m[1] === 'true' : false;
  };
  const schemes = { v1: schemeOn('v1'), v2: schemeOn('v2'), v3: schemeOn('v3') };
  if (!schemes.v1 || !schemes.v2 || !schemes.v3) {
    console.error(`✘ [签名门禁失败] 需要 v1+v2+v3 三种签名方案全部生效，实际: ${JSON.stringify(schemes)}`);
    console.error(verifyOut);
    process.exit(1);
  }
  const dn = verifyOut.split(/\r?\n/).find((l) => /certificate DN/.test(l)) || '';
  console.log(`✔ [签名门禁通过] release APK 已通过 apksigner verify，v1+v2+v3 三种方案全部生效。`);
  if (dn) console.log(`  ${dn.trim()}`);
  fs.rmSync(aligned, { force: true });
  finalApk = signed;
} else {
  console.log('\n[3/3] debug 构建，跳过签名步骤。');
}

if (fs.existsSync(finalApk)) {
  const buf = fs.readFileSync(finalApk);
  const stat = fs.statSync(finalApk);
  console.log('\n✔ 构建完成！');
  console.log(`  APK 路径: ${finalApk}`);
  console.log(`  文件大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  SHA-256 : ${crypto.createHash('sha256').update(buf).digest('hex')}`);
  console.log('  （分发时请把 SHA-256 一并公布，玩家可自查下载是否被篡改）');
} else {
  console.log('\n✔ Gradle 运行成功，请前往 android/app/build/outputs/apk/ 查看产物。');
}
