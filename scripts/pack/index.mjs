#!/usr/bin/env node
// scripts/pack/index.mjs — 三端发布管线入口。
//
//   node scripts/pack/index.mjs <server|desktop|mobile|all> [各自的参数...]
//
//   npm run pack:server    → 服务器端（dist/server/）
//   npm run pack:desktop   → 电脑端  （dist/desktop/）
//   npm run pack:mobile    → 手机端  （dist/mobile/）
//   npm run pack           → all（server + desktop + mobile，顺序执行）
//
// 三条管线各自独立、可单独跑；共用 scripts/pack/_lib.mjs（含纯 Node 的 ZIP 写入器）。
// 参数原样透传给对应管线，例如：
//   node scripts/pack/index.mjs server --headless --tar
//   node scripts/pack/index.mjs desktop --no-node
//   node scripts/pack/index.mjs mobile --release

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINES = { server: 'server.mjs', desktop: 'desktop.mjs', mobile: 'mobile.mjs' };

const target = process.argv[2];
const rest = process.argv.slice(3);

if (!target || target === '-h' || target === '--help') {
  console.log(`用法: node scripts/pack/index.mjs <server|desktop|mobile|all> [参数...]

  server   服务器端部署包      (--headless --no-deps --no-zip --tar --out <dir>)
  desktop  电脑端便携包        (--no-node --force --no-zip --out <dir>)
  mobile   手机端 APK          (--release --out <dir>)
  all      依次构建上面三端

产物统一落在 dist/ 下（已进 .gitignore）。`);
  process.exit(target ? 0 : 1);
}

const targets = target === 'all' ? ['server', 'desktop', 'mobile'] : [target];
for (const t of targets) {
  if (!PIPELINES[t]) {
    console.error(`未知目标: ${t}（可选 server / desktop / mobile / all）`);
    process.exit(1);
  }
}

let failed = [];
for (const t of targets) {
  console.log(`\n${'#'.repeat(70)}\n# 管线: ${t}\n${'#'.repeat(70)}`);
  const r = spawnSync(process.execPath, [path.join(HERE, PIPELINES[t]), ...rest], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed.push(t);
    console.error(`\n✘ ${t} 管线失败（退出码 ${r.status ?? 'signal ' + r.signal}）`);
    if (target !== 'all') process.exit(r.status ?? 1);
  }
}

if (failed.length) {
  console.error(`\n✘ 失败的管线: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n✔ 全部完成: ${targets.join(', ')}`);
