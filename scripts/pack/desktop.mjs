#!/usr/bin/env node
// scripts/pack/desktop.mjs — 电脑端（Windows x64）发布管线（三条管线之一，见 scripts/pack/index.mjs）。
//
//   node scripts/pack/desktop.mjs [--no-node] [--force] [--no-zip] [--out <dir>]
//
// 产物（默认落在 dist/desktop/）：
//   <name>/     开箱即用便携目录（node\ 便携 Node + app\ 游戏本体 + 启动游戏.bat + 法律文件）
//   <name>.zip  同名 ZIP（UTF-8 文件名，含中文的「启动游戏.bat」在资源管理器里不乱码）
//
// 引擎是既有的 scripts/make-windows-bundle.mjs（它只产出目录，不压缩；压缩由本管线统一做）。

import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../shared/constants.js';
import { ROOT, DIST, run, banner, human, dirSize, rmrf, assertExists, zipDir, verifyZipUtf8 } from './_lib.mjs';

const o = { node: true, force: false, zip: true, out: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--no-node') o.node = false;
  else if (a === '--force') o.force = true;
  else if (a === '--no-zip') o.zip = false;
  else if (a === '--out') o.out = path.resolve(process.argv[++i] || '');
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
}

const name = `Stronghold-Protocol-${APP_VERSION}-Windows-x64`;
const outDir = o.out || path.join(DIST, 'desktop', name);
const engine = path.join(ROOT, 'scripts', 'make-windows-bundle.mjs');

assertExists([engine, path.join(ROOT, 'server', 'index.js'), path.join(ROOT, 'public')]);

banner(`电脑端便携包 v${APP_VERSION}${o.node ? '（含便携 Node）' : '（不含 Node）'}`);

rmrf(outDir);
const args = [engine, '--out', outDir];
if (!o.node) args.push('--no-node');
if (o.force) args.push('--force');
run(process.execPath, args);

let zipPath = null;
if (o.zip) {
  zipPath = `${outDir}.zip`;
  banner('压缩 ZIP');
  const r = zipDir(outDir, zipPath, { rootName: path.basename(outDir), onProgress: (n, b) => console.log(`    已压缩 ${n} 个文件 (${human(b)})...`) });
  const chk = verifyZipUtf8(zipPath);
  console.log(`  ✔ ${path.basename(zipPath)}：${r.files} 个文件 / 原始 ${human(r.bytes)} → ${human(r.zipBytes)}（${chk.nonAscii} 个非 ASCII 条目均已标记 UTF-8）`);
}

const total = dirSize(outDir);
banner('完成');
console.log(`  电脑端包目录: ${outDir}`);
console.log(`  文件数/体积 : ${total.files} 个 / ${human(total.bytes)}`);
if (zipPath) console.log(`  ZIP         : ${zipPath}`);
console.log('  启动        : 解压后双击「启动游戏.bat」（本机开服，浏览器自动打开）');
