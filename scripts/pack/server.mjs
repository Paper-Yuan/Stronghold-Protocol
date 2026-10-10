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
import { ROOT, DIST, run, banner, human, dirSize, rmrf, assertExists, zipDir, verifyZipUtf8, rewriteCapabilities } from './_lib.mjs';

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

// 服务器包定位为纯联机服：无尽模式与排行榜只由双端提供。
// D6 定稿：入口的剔除发生在**构建期能力位改写**，不是产物正则抠标签——正则跨行匹配产物代码，
// 上游一改模板结构就静默失效。这里把暂存副本里的 public/shared/capabilities.js 改写成
// { endless: false }，浏览器页面因此**连入口都不渲染**（不是渲染了再隐藏），无尽素材也就不再
// 从服务器下发。客户端侧的入口守卫见 public/js/screens/{title,lobby}.js 的 LOCAL_FEATURES.endless。
const capsPath = path.join(outDir, 'public', 'shared', 'capabilities.js');
if (fs.existsSync(capsPath)) {
  const rewritten = rewriteCapabilities(fs.readFileSync(capsPath, 'utf8'), { endless: false });
  if (rewritten === null) {
    console.warn('  ! capabilities.js 未找到 "endless: true"，服务器包的无尽入口开关可能未生效');
  } else {
    fs.writeFileSync(capsPath, rewritten, 'utf8');
    console.log('  ✔ 服务器包能力位改写：LOCAL_FEATURES.endless = false（浏览器页面不渲染无尽入口）');
  }
} else {
  console.warn('  ! 服务器包缺少 public/shared/capabilities.js：无尽入口开关未生效');
}
// 服务器侧仍要摘掉无尽在线化端点与记录文件（这部分属服务器代码层，归无尽出服阶段；能力位管不到）
const srvIndex = path.join(outDir, 'server', 'index.js');
if (fs.existsSync(srvIndex)) {
  let content = fs.readFileSync(srvIndex, 'utf8');
  content = content.replace(/if\s*\(parts\.rawPath\s*===\s*'\/api\/endless\/leaderboard'\)[\s\S]*?return;\s*\}/g, '/* endless leaderboard endpoint disabled in server */');
  fs.writeFileSync(srvIndex, content, 'utf8');
}
// 移除 data/endless-records.json 如果存在
const srvRec = path.join(outDir, 'data', 'endless-records.json');
if (fs.existsSync(srvRec)) {
  fs.rmSync(srvRec, { force: true });
}
// 前端入口不再做产物正则抠标签（上面 capabilities.js 的构建期改写已让入口不渲染）。
// 打包器纪律：只改写暂存副本、不改仓库源文件；只做「按能力位改写」，不做跨行正则。


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
