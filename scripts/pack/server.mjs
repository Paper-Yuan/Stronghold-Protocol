#!/usr/bin/env node
// scripts/pack/server.mjs — 服务器端发布管线（三条管线之一，见 scripts/pack/index.mjs）。
//
//   node scripts/pack/server.mjs [--headless] [--no-deps] [--no-zip] [--tar] [--out <dir>]
//
// 产物（默认落在 dist/server/）：
//   <name>/        可直接部署的服务端目录（server/ shared/ public/ data/ + 生产依赖 + Docker/systemd/启动脚本）
//   <name>.zip     同名 ZIP（UTF-8 文件名）
//   <name>.tar.gz  --tar 时额外产出（Linux 部署常用）
//
// --headless 走 make-headless-server.mjs：剥离 public/assets 的纯逻辑服（供电脑端/手机端全量包用户开服）。
// 引擎仍是仓库里既有的两个构建脚本，这里只负责「选引擎 + 统一输出目录 + 打包 + 自检 + 汇总」。

import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../shared/constants.js';
import { ROOT, DIST, run, banner, human, dirSize, rmrf, assertExists, zipDir, verifyZipUtf8 } from './_lib.mjs';

const o = { headless: false, deps: true, zip: true, tar: false, out: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--headless') o.headless = true;
  else if (a === '--no-deps') o.deps = false;
  else if (a === '--no-zip') o.zip = false;
  else if (a === '--tar') o.tar = true;
  else if (a === '--out') o.out = path.resolve(process.argv[++i] || '');
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
}

const name = `Stronghold-Protocol-${APP_VERSION}-Server${o.headless ? '-Headless' : ''}`;
const outDir = o.out || path.join(DIST, 'server', name);
const engine = path.join(ROOT, 'scripts', o.headless ? 'make-headless-server.mjs' : 'make-server-bundle.mjs');

assertExists([engine, path.join(ROOT, 'server', 'index.js'), path.join(ROOT, 'public')]);

banner(`服务器端发布包${o.headless ? '（纯逻辑 headless）' : ''} v${APP_VERSION}`);
if (!o.headless && !fs.existsSync(path.join(ROOT, 'public', 'assets'))) {
  console.log('  ! public/assets 不存在：包体将缺少素材，先在构建机跑 npm run assets');
}

rmrf(outDir);
const args = [engine, '--out', outDir, '--no-zip'];
if (!o.deps) args.push('--no-deps');
run(process.execPath, args);

// 引擎自己也有一份 zip 逻辑（两个构建脚本都能单独用），这里统一由本管线压缩 + 自检，保证三端形状一致。
let zipPath = null;
if (o.zip) {
  zipPath = `${outDir}.zip`;
  banner('压缩 ZIP');
  const r = zipDir(outDir, zipPath, { rootName: path.basename(outDir), onProgress: (n, b) => console.log(`    已压缩 ${n} 个文件 (${human(b)})...`) });
  const chk = verifyZipUtf8(zipPath);
  console.log(`  ✔ ${path.basename(zipPath)}：${r.files} 个文件 / 原始 ${human(r.bytes)} → ${human(r.zipBytes)}（${chk.nonAscii} 个非 ASCII 条目均已标记 UTF-8）`);
}

if (o.tar) {
  const tarPath = path.join(path.dirname(outDir), `${path.basename(outDir)}.tar.gz`);
  banner('压缩 tar.gz');
  run('tar', ['-czf', tarPath, '-C', path.dirname(outDir), path.basename(outDir)]);
  console.log(`  ✔ ${path.basename(tarPath)}：${human(fs.statSync(tarPath).size)}`);
}

const total = dirSize(outDir);
banner('完成');
console.log(`  服务器端包目录: ${outDir}`);
console.log(`  文件数/体积   : ${total.files} 个 / ${human(total.bytes)}`);
if (zipPath) console.log(`  ZIP           : ${zipPath}`);
console.log(o.headless
  ? '  启动          : 解压后 docker compose up -d，或 ./start.sh（Linux）/ start-windows.bat（Windows Server）'
  : '  启动          : 解压后 docker compose up -d，或 ./start.sh（Linux）/ start-windows.bat（Windows Server）');
