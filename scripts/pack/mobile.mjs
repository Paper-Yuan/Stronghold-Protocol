#!/usr/bin/env node
// scripts/pack/mobile.mjs — 手机端（Android APK）发布管线（三条管线之一，见 scripts/pack/index.mjs）。
//
//   node scripts/pack/mobile.mjs [--release] [--out <dir>]
//
// 产物（默认落在 dist/mobile/）：
//   Stronghold-Protocol-<ver>-android.apk   最终 APK（release 已 zipalign + 签名并 apksigner verify；不带 --release 时文件名带 -debug 后缀）
//   app_bundle.zip                          打进 APK 的 Web+服务端资源包（一并留档，便于比对）
//   SHA256.txt                              APK 的 sha256（分发时随包公布，玩家可自查）
//
// 引擎是既有的 scripts/build-android.mjs（它内部会先跑 tools/bundle-android.mjs 做资源包与语音门禁，再走 Gradle）。
// 需要 Android SDK + JDK；release 还需 android/local.properties 里的签名配置。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_VERSION } from '../../shared/constants.js';
import { ROOT, DIST, run, banner, human, ensureDir, assertExists } from './_lib.mjs';

const o = { release: false, out: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--release') o.release = true;
  else if (a === '--out') o.out = path.resolve(process.argv[++i] || '');
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
}

const engine = path.join(ROOT, 'scripts', 'build-android.mjs');
const androidDir = path.join(ROOT, 'android');
const variant = o.release ? 'release' : 'debug';
const apkIn = o.release
  ? path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'Stronghold-Protocol-release.apk')
  : path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const bundleIn = path.join(androidDir, 'app', 'src', 'main', 'assets', 'app_bundle.zip');

assertExists([engine, androidDir]);

banner(`手机端 APK v${APP_VERSION}（${variant}）`);
if (!fs.existsSync(path.join(androidDir, 'local.properties'))) {
  console.log('  ! android/local.properties 不存在：需要 sdk.dir 才能跑 Gradle；release 还缺签名配置。');
}

const args = [engine];
if (o.release) args.push('--release');
run(process.execPath, args);

if (!fs.existsSync(apkIn)) throw new Error(`Gradle 结束但没找到 APK：${apkIn}`);

const outDir = o.out || path.join(DIST, 'mobile');
ensureDir(outDir);
const apkOut = path.join(outDir, `Stronghold-Protocol-${APP_VERSION}-android${o.release ? '' : '-debug'}.apk`);
fs.copyFileSync(apkIn, apkOut);

const sha = crypto.createHash('sha256').update(fs.readFileSync(apkOut)).digest('hex');
fs.writeFileSync(path.join(outDir, 'SHA256.txt'), `${sha}  ${path.basename(apkOut)}\n`, 'utf8');

let bundleOut = null;
if (fs.existsSync(bundleIn)) {
  bundleOut = path.join(outDir, 'app_bundle.zip');
  fs.copyFileSync(bundleIn, bundleOut);
}

banner('完成');
console.log(`  APK         : ${apkOut} (${human(fs.statSync(apkOut).size)})`);
console.log(`  SHA-256     : ${sha}`);
if (bundleOut) console.log(`  资源包      : ${bundleOut} (${human(fs.statSync(bundleOut).size)})`);
console.log(`  校验文件    : ${path.join(outDir, 'SHA256.txt')}`);
