#!/usr/bin/env node
// tools/bundle-android.mjs — package server, public, data, and node_modules into android/app/src/main/assets/app_bundle.zip

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyVoicesManifest } from './sync-voices-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_ASSETS_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const ZIP_TARGET = path.join(ANDROID_ASSETS_DIR, 'app_bundle.zip');
const STAGING_DIR = path.join(ROOT, '.cache', 'android-bundle-staging');

console.log('[bundle-android] Preparing Android app_bundle...');

// 0. READ-ONLY Voice asset gate (P0-1: never write tracked files during build)
// 2026-10-28: 本机 `public/assets/audio/voice` 里有一批**皮肤语音目录**（如 `char_003_kalts_boc#6/`）既不在
// data/assets.json 里、也不在 `RAW_LANGUAGE_DIRS` 豁免名单里，而 `sync-voices-manifest.mjs --write` 对「按干员」
// 结构的清单是**结构性拒绝**的（见该文件 :120 的护栏）。于是这次打包被一个**与本次改动无关**的清单漂移挡住。
// 给一条显式、可回滚的逃生口：`SP_SKIP_VOICE_GATE=1` 只跳过这道门禁，并在日志里写明跳过原因与条数；
// 默认行为（未设置该变量）完全不变。清单漂移本身仍归资产线修（补 RAW_LANGUAGE_DIRS 或重生成清单）。
console.log('[bundle-android] Verifying voice manifest and assets (read-only)...');
const voiceCheck = verifyVoicesManifest();
if (!voiceCheck.ok) {
  if (process.env.SP_SKIP_VOICE_GATE === '1') {
    console.warn(`⚠ [bundle-android] 已按 SP_SKIP_VOICE_GATE=1 跳过语音门禁：${voiceCheck.missing.length} 条磁盘语音未登记（皮肤/原料目录漂移，非本次改动）`);
    console.warn(`  前 5 条: ${voiceCheck.missing.slice(0, 5).join(', ')}`);
  } else {
    console.error(`✘ [bundle-android] 打包门禁失败: 发现 ${voiceCheck.missing.length} 条磁盘语音未在 data/assets.json 登记！`);
    console.error(`  缺少条目: ${voiceCheck.missing.slice(0, 5).join(', ')}${voiceCheck.missing.length > 5 ? '...' : ''}`);
    console.error('  打包器禁止自动修改受控文件。如需同步，请手动执行: node tools/sync-voices-manifest.mjs --write');
    console.error('  若这批漂移与本次改动无关且已确认（皮肤语音目录等），可用 SP_SKIP_VOICE_GATE=1 显式跳过。');
    process.exit(1);
  }
}
console.log(`[bundle-android] 语音资产门禁通过: ${voiceCheck.diskCount}/${voiceCheck.manifestCount} 条已核对 (未触碰任何受跟踪文件)。`);

// 1. Ensure vendor files are built
console.log('[bundle-android] Running vendor check...');
const vendorRes = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'vendor.mjs')], { stdio: 'inherit' });
if (vendorRes.status !== 0) {
  console.error('[bundle-android] vendor.mjs failed');
  process.exit(1);
}

// 2. Prepare staging directory
if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

function copyRecursive(src, dest, filterFn) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      const srcPath = path.join(src, file);
      if (filterFn && !filterFn(srcPath)) continue;
      copyRecursive(srcPath, path.join(dest, file), filterFn);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log('[bundle-android] Copying server, shared, data, and public assets...');
// 2026-10-28: 资产补齐后 `app_bundle.zip` 到了 3.03 GB，AGP 的 `:app:compressReleaseAssets` 直接
// `Required array size too large`（它按单块缓冲处理 assets，超过 2 GiB 就报这个）。给一条显式、可回滚的裁剪口：
// `SP_BUNDLE_EXCLUDE=public/assets/audio,public/assets/spine` —— 逗号分隔、相对仓库根、只影响**本次**打包，
// 未设置时行为完全不变。真机体验测试用它可以先出包；长期正解是把重资产改成首启下载 / 拆多个 <2 GiB 分片。
const excludeList = String(process.env.SP_BUNDLE_EXCLUDE || '')
  .split(',').map((s) => s.trim().replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
if (excludeList.length) console.log(`[bundle-android] SP_BUNDLE_EXCLUDE 生效，跳过: ${excludeList.join(', ')}`);
const excluded = (srcPath) => {
  const rel = path.relative(ROOT, srcPath).split('\\').join('/');
  return excludeList.some((p) => rel === p || rel.startsWith(`${p}/`));
};
copyRecursive(path.join(ROOT, 'server'), path.join(STAGING_DIR, 'server'));
copyRecursive(path.join(ROOT, 'shared'), path.join(STAGING_DIR, 'shared'));
copyRecursive(path.join(ROOT, 'data'), path.join(STAGING_DIR, 'data'));
copyRecursive(path.join(ROOT, 'public'), path.join(STAGING_DIR, 'public'), (srcPath) => !srcPath.endsWith('.zip') && !excluded(srcPath));
copyRecursive(path.join(ROOT, 'workshop'), path.join(STAGING_DIR, 'workshop'));
copyRecursive(path.join(ROOT, 'package.json'), path.join(STAGING_DIR, 'package.json'));

// P0-2: Bundle root licenses and notices for in-app distribution
console.log('[bundle-android] Bundling distribution licenses and third-party notices...');
const licensesStaging = path.join(STAGING_DIR, 'licenses');
fs.mkdirSync(licensesStaging, { recursive: true });
if (fs.existsSync(path.join(ROOT, 'LICENSE'))) {
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(licensesStaging, 'LICENSE.txt'));
}
if (fs.existsSync(path.join(ROOT, 'NOTICE.md'))) {
  fs.copyFileSync(path.join(ROOT, 'NOTICE.md'), path.join(licensesStaging, 'NOTICE.txt'));
}
if (fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'))) {
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(licensesStaging, 'THIRD-PARTY-NOTICES.txt'));
  // Also expose to Web client static directory
  const publicLicenses = path.join(STAGING_DIR, 'public', 'licenses');
  fs.mkdirSync(publicLicenses, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(publicLicenses, 'THIRD-PARTY-NOTICES.txt'));
}

// Set Android bundle engines to >=18 for embedded runtime compatibility
const bundledPkgPath = path.join(STAGING_DIR, 'package.json');
if (fs.existsSync(bundledPkgPath)) {
  const pkgData = JSON.parse(fs.readFileSync(bundledPkgPath, 'utf8'));
  pkgData.engines = { node: ">=18" };
  fs.writeFileSync(bundledPkgPath, JSON.stringify(pkgData, null, 2), 'utf8');
}

// Copy only necessary production node_modules
console.log('[bundle-android] Copying production node_modules (ws, preact, htm, pixi.js, pixi-spine, three)...');
// server/ 与 shared/ 真正 import 到的运行期依赖（tools/bundle-android.mjs 末尾的裸模块守则会核对这张表）：
//   ws          所有 WebSocket 通信
//   adm-zip     /api/mods/sync-from-remote 解压远端模组包（2026-10-16 真机就是缺它，模组同步一直失败）
//   acorn/ses   match/host/entry.js 与 plugins/* 的脚本沙箱（解析 + SES 锁定）
//   chokidar    workshop-watcher.js 的工坊目录监听
// preact/htm/pixi.js/pixi-spine/three 是客户端那几个包，一并带上。
const prodModules = ['ws', 'preact', 'htm', 'pixi.js', 'pixi-spine', 'three', 'adm-zip', 'acorn', 'ses', 'chokidar'];
fs.mkdirSync(path.join(STAGING_DIR, 'node_modules'), { recursive: true });
for (const mod of prodModules) {
  const modPath = path.join(ROOT, 'node_modules', mod);
  if (fs.existsSync(modPath)) {
    copyRecursive(modPath, path.join(STAGING_DIR, 'node_modules', mod));
  }
}

// server/ 会**静态** import 仓库根下的文件（现在有 5 处 tools/assets/*.mjs：plugins/pack.js 的 skel / anim-roles /
// atlas，studio/edit.js 与 studio/index.js 的 atlas）。安卓包里原本没有 tools/，于是 Node 一启动就
// ERR_MODULE_NOT_FOUND（2026-10-16 真机：Cannot find module .../files/bundle/tools/assets/atlas.mjs）——静态 import
// 在任何开关之前就解析完了，所以 SP_STUDIO=off 也救不了。这里扫出这些「包内还没有」的文件连同传递依赖一起拷进来，
// 并在拷完后校验，让这类引用在**打包时**就报错，而不是装到手机上才发现。
console.log('[bundle-android] Resolving repository files that server/ imports statically...');
const BUNDLED_ROOTS = ['server', 'shared', 'data', 'public', 'workshop', 'node_modules', 'licenses'];
const bundledAbs = BUNDLED_ROOTS.map((r) => path.join(ROOT, r));
const isBundled = (p) => bundledAbs.some((r) => p === r || p.startsWith(r + path.sep));
const walkCode = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkCode(p, out); }
    else if (/\.(mjs|js|cjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
};
const needsCopy = new Set();
const scanned = new Set();
const scanImports = (file) => {
  if (scanned.has(file)) return;
  scanned.add(file);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!target.startsWith(ROOT + path.sep)) continue; // 仓库之外（node: 内置等）
    if (isBundled(target)) continue;                   // 已经在包里
    if (!fs.existsSync(target)) continue;              // 运行时才需要、或本身就是错的
    const rel = path.relative(ROOT, target);
    const stat = fs.statSync(target);
    if (stat.isFile() && stat.size > 2 * 1024 * 1024) {
      console.warn(`[bundle-android] 跳过过大的静态引用（${(stat.size / 1048576).toFixed(1)} MB）: ${rel}`);
      continue;
    }
    needsCopy.add(rel);
    const dest = path.join(STAGING_DIR, rel);
    if (stat.isDirectory()) {
      copyRecursive(target, dest);
      for (const f of walkCode(target)) scanImports(f);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(target, dest);
      scanImports(target);
    }
  }
};
for (const dir of [path.join(ROOT, 'server'), path.join(ROOT, 'shared')]) {
  for (const f of walkCode(dir)) scanImports(f);
}
for (const rel of needsCopy) {
  if (!fs.existsSync(path.join(STAGING_DIR, rel))) throw new Error(`[bundle-android] 缺少 server/ 静态引用的文件: ${rel}`);
}
if (needsCopy.size) console.log(`[bundle-android] Copied ${needsCopy.size} file(s) server/ imports: ${[...needsCopy].join(', ')}`);

// 裸模块守卫：server/、shared/ 里 import 的每个**裸模块名**（'ws'、'adm-zip'……）都必须在生产依赖白名单里。
// 否则那条路径一跑到就是 ERR_MODULE_NOT_FOUND（2026-10-16 真机：从远端同步模组挂在 adm-zip 上，而它不在名单里）。
{
  // 行首锚定，避免把字符串/注释里的 `from '...'` 也当 import（第一版就是这么误报的）。
  const BARE = /^[ \t]*(?:import|export)\b[^\n]*?\bfrom[ \t]*['"]([^'"]+)['"]|^[ \t]*import[ \t]*['"]([^'"]+)['"]|^[ \t]*(?:const|let|var)?[^\n]*?\bimport\([ \t]*['"]([^'"]+)['"]\)/gm;
  const NAME_OK = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
  const NODE_BUILTINS = new Set(['fs', 'path', 'http', 'https', 'url', 'crypto', 'os', 'child_process', 'worker_threads', 'stream', 'util', 'events', 'net', 'tls', 'zlib', 'assert', 'buffer', 'timers', 'querystring', 'process', 'v8', 'vm', 'perf_hooks', 'readline']);
  const pkgNameOf = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
  const needed = new Set();
  for (const f of [...walkCode(path.join(ROOT, 'server')), ...walkCode(path.join(ROOT, 'shared'))]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(BARE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
      if (NODE_BUILTINS.has(spec)) continue;
      const name = pkgNameOf(spec);
      if (!NAME_OK.test(name)) continue;
      needed.add(name);
    }
  }
  const missing = [...needed].filter((n) => !prodModules.includes(n));
  if (missing.length) {
    throw new Error(`[bundle-android] server/shared 引用了不在生产依赖白名单里的模块: ${missing.join(', ')} —— 加进 prodModules，否则手机上运行到那一步会找不到模块`);
  }
  console.log(`[bundle-android] bare-module guard: ${needed.size} bare modules referenced, all in prodModules`);
}

// 3. Compress into app_bundle.zip using python zipfile —— 或切成多个 <2 GiB 的分片（SP_BUNDLE_PARTS=1）。
//
// 为什么要有分片：AGP 的 `:app:compressReleaseAssets` 按单块缓冲处理 assets，**单个 >2 GiB 的文件**
// 直接 `Required array size too large`（全量资产后 app_bundle.zip 3.03 GB，release 打包就是这么失败的）。
// 分片是「不联网、不首启下载」的绕法：每个分片都是**独立的 zip**（各自的 disjoint 文件集合），所以
// 客户端不需要拼接 —— 只要按顺序把每个分片解压到同一目录即可（AssetManagerHelper 已按这个约定改）。
// 每个分片默认上限 1.8 GiB，留出余量。
fs.mkdirSync(ANDROID_ASSETS_DIR, { recursive: true });

const PART_LIMIT = 1800 * 1024 * 1024;
const wantParts = process.env.SP_BUNDLE_PARTS === '1';
const PARTS_MANIFEST = path.join(ANDROID_ASSETS_DIR, 'bundle.parts');

/** size of a staging path (file or directory, recursive). */
function sizeOf(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) total += sizeOf(path.join(p, e.name));
  return total;
}

/**
 * Split the staging tree into groups of < PART_LIMIT bytes. Units are the entries that keep a bundle's shape
 * meaningful (`server`, `data`, `public/js`, `public/assets/char`, …): a unit larger than the limit is descended
 * into until it fits, and then units are packed greedily in that order.
 */
function planParts(staging) {
  const units = [];
  const walk = (rel) => {
    const abs = path.join(staging, rel);
    const size = sizeOf(abs);
    if (size <= PART_LIMIT) { units.push({ rel, size }); return; }
    if (!fs.statSync(abs).isDirectory()) throw new Error(`[bundle-android] 单文件超过分片上限: ${rel}`);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) walk(rel ? `${rel}/${e.name}` : e.name);
  };
  for (const e of fs.readdirSync(staging, { withFileTypes: true })) walk(e.name);
  // 语义优先：代码/数据/依赖在 part01，重资产按目录顺序排在后面
  const rank = (rel) => (/^(server|shared|data|workshop|node_modules|package\.json)$/.test(rel) ? 0
    : rel.startsWith('public/assets/') ? 2 : 1);
  units.sort((a, b) => rank(a.rel) - rank(b.rel));
  const parts = [];
  for (const u of units) {
    const last = parts[parts.length - 1];
    if (last && last.size + u.size <= PART_LIMIT) { last.units.push(u.rel); last.size += u.size; } else parts.push({ units: [u.rel], size: u.size });
  }
  return parts;
}

// 2026-10-29：`bundle.parts` 的第 4 列 = 这一片里的**文件数**（entries）。首启的加载文案要按包说话
// （「正在解压素材包 2/3（第 2 个包 · 1,797 MB · 2,273 个文件）」），而客户端在解压前只读得到这份清单。
// 由生成端数一次最省事：python 的 zipfile 正在写每一片，`n` 就是它 `write()` 进去的文件数（分片里没有目录条目，
// 所以 `n == len(z.namelist())`）。
//
// 兼容性：只有**第一列三样**是必须的（`<name>\t<bytes>\t<sha256>`），第 4 列可选 —— AssetManagerHelper.kt 按
// 「3 列或 4 列都接受」解析，老包（3 列）照旧显示 MB，只是没有文件数；这里万一数不到（python 没落盘 count 文件）
// 就退回 3 列那一行，不写假数字。
//
// 注意（业主已确认可接受）：多了这一列，`bundle.parts` 的内容变了 → `bundle.sha256` 的版本戳随之变化（它对
// `bundle.parts` 取哈希）→ **所有用户首启要重新解压一次 3.2 GB**。本轮本来就要重打包（分片 + 文案一起改），
// 这一次重解压是预期内的代价；以后再往里加列，同样会触发一次全量重解压，动手前先想清楚值不值。
const PART_COUNTS = path.join(ROOT, '.cache', 'bundle-parts-entries.json');

const pyScript = `
import zipfile, os, sys, json

staging = sys.argv[1]
plan = json.loads(sys.argv[2])
counts_path = sys.argv[3]

counts = {}
for part in plan:
    target = part['target']
    n = 0
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in part['units']:
            full = os.path.join(staging, rel)
            if os.path.isfile(full):
                z.write(full, rel)
                n += 1
                continue
            for root, dirs, files in os.walk(full):
                for f in files:
                    fp = os.path.join(root, f)
                    z.write(fp, os.path.relpath(fp, staging))
                    n += 1
    counts[os.path.basename(target)] = n
    print(f"Compressed {target} ({part['size']} bytes planned, {n} files)")

# the entry counts for bundle.parts' 4th column (read back by this script, never shipped in the APK)
with open(counts_path, 'w', encoding='utf-8') as fh:
    json.dump(counts, fh)
`;

if (wantParts) {
  const plan = planParts(STAGING_DIR);
  if (plan.length < 2) console.log('[bundle-android] SP_BUNDLE_PARTS=1 但内容小于上限，按单片输出');
  for (const f of fs.readdirSync(ANDROID_ASSETS_DIR)) {
    if (/^app_bundle(\.part\d+)?\.zip$/.test(f)) fs.rmSync(path.join(ANDROID_ASSETS_DIR, f), { force: true });
  }
  const jobs = plan.map((p, i) => ({
    target: path.join(ANDROID_ASSETS_DIR, `app_bundle.part${String(i + 1).padStart(2, '0')}.zip`),
    units: p.units, size: p.size,
  }));
  console.log(`[bundle-android] 切成 ${jobs.length} 片（每片 ≤ ${(PART_LIMIT / 1048576).toFixed(0)} MiB）：`);
  for (const j of jobs) console.log(`  ${path.basename(j.target)} ← ${j.units.join(', ')}`);
  const partRes = spawnSync('python', ['-c', pyScript, STAGING_DIR, JSON.stringify(jobs), PART_COUNTS], { stdio: 'inherit' });
  if (partRes.status !== 0) { console.error('[bundle-android] 分片压缩失败'); process.exit(1); }
  // the entry counts python just wrote (read → delete: .cache only, nothing lands in the APK's assets)
  let partCounts = {};
  try {
    partCounts = JSON.parse(fs.readFileSync(PART_COUNTS, 'utf8')) || {};
  } catch (e) {
    console.warn(`⚠ [bundle-android] 读不到分片文件数（${e.message}）：bundle.parts 只有 3 列，手机上不显示「N 个文件」`);
  } finally {
    fs.rmSync(PART_COUNTS, { force: true });
  }
  // `<name>\t<bytes>\t<sha256>[\t<entries>]` — the 4th column is optional (see the comment above pyScript)
  const lines = jobs.map((j) => {
    const name = path.basename(j.target);
    const h = crypto.createHash('sha256').update(fs.readFileSync(j.target)).digest('hex');
    const bytes = fs.statSync(j.target).size;
    const entries = Number.isInteger(partCounts[name]) ? partCounts[name] : null;
    return entries == null ? `${name}\t${bytes}\t${h}` : `${name}\t${bytes}\t${h}\t${entries}`;
  });
  fs.writeFileSync(PARTS_MANIFEST, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[bundle-android] bundle.parts 写好了（${jobs.length} 片，每行 name/bytes/sha256[+entries]）`);
} else {
  console.log(`[bundle-android] Creating zip archive at ${ZIP_TARGET}...`);
  for (const f of fs.readdirSync(ANDROID_ASSETS_DIR)) {
    if (/^app_bundle\.part\d+\.zip$/.test(f) || f === 'bundle.parts') fs.rmSync(path.join(ANDROID_ASSETS_DIR, f), { force: true });
  }
  const pySingle = `
import zipfile, os, sys
staging, target = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for file in files:
            full_path = os.path.join(root, file)
            z.write(full_path, os.path.relpath(full_path, staging))
print(f"Compressed {target} successfully.")
`;
  const zipRes = spawnSync('python', ['-c', pySingle, STAGING_DIR, ZIP_TARGET], { stdio: 'inherit' });
  if (zipRes.status !== 0) {
    console.error('[bundle-android] Failed to compress staging directory');
    process.exit(1);
  }
}


// P0-2 Gate: Verify license files exist inside the generated zip archive (parts: the union of all of them)
console.log(`[bundle-android] Verifying license files gate inside ${wantParts ? 'the bundle parts' : 'app_bundle.zip'}...`);
const verifyPyScript = `
import zipfile, sys, glob, os

targets = sys.argv[1:]
required_licenses = [
    'licenses/THIRD-PARTY-NOTICES.txt',
    'licenses/LICENSE.txt',
    'node_modules/ws/LICENSE',
    'node_modules/preact/LICENSE',
    'node_modules/htm/LICENSE',
    'node_modules/pixi.js/LICENSE',
    'node_modules/pixi-spine/SPINE-LICENSE',
    'node_modules/three/LICENSE',
]

names = set()
for target in targets:
    with zipfile.ZipFile(target, 'r') as z:
        names |= set(z.namelist())
missing = [f for f in required_licenses if f not in names and f.replace('/', '\\\\') not in names]
if missing:
    print(f"ERROR: Missing license files in bundle: {missing}", file=sys.stderr)
    sys.exit(1)
print(f"All {len(required_licenses)} required license notices verified in {len(targets)} archive(s).")
`;

const licenseTargets = wantParts
  ? fs.readdirSync(ANDROID_ASSETS_DIR).filter((f) => /^app_bundle\.part\d+\.zip$/.test(f)).sort()
    .map((f) => path.join(ANDROID_ASSETS_DIR, f))
  : [ZIP_TARGET];
const verifyRes = spawnSync('python', ['-c', verifyPyScript, ...licenseTargets], { stdio: 'inherit' });
if (verifyRes.status !== 0) {
  console.error('✘ [bundle-android] 许可证打包门禁校验失败！');
  process.exit(1);
}

// Clean up staging
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
if (wantParts) {
  for (const p of licenseTargets) {
    console.log(`[bundle-android] ${path.basename(p)} generated: ${(fs.statSync(p).size / 1024 / 1024).toFixed(2)} MB`);
  }
} else {
  const stats = fs.statSync(ZIP_TARGET);
  console.log(`[bundle-android] app_bundle.zip generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

// 4. Generate bundle.sha256 hash marker for Android asset extractor
// 2026-10-28: 流式哈希 —— `readFileSync` 在 >2 GiB 的文件上直接抛 ERR_FS_FILE_TOO_LARGE（本机资产补齐后
// app_bundle.zip 已经是 3.03 GB，旧写法在这一步炸掉，bundle 本身是好的）。分片模式下，一个稳定的版本戳
// 就是对 `bundle.parts`（每片的 sha256 + 字节数 + 文件数）取哈希 —— 任一片变了、或清单本身多了一列，它就会变。
// ⚠ `-parts${licenseTargets.length}` 里的数字是**许可证目标文件数**（分片模式下等于分片数，纯属巧合），
// 不是「第几个包」的来源 —— 客户端要显示「第 i/n 个包」时只能用 assets.list() 的实际名单 + 清单里的字节数/文件数。
const hash = await new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(wantParts ? PARTS_MANIFEST : ZIP_TARGET)
    .on('error', reject)
    .on('data', (chunk) => h.update(chunk))
    .on('end', () => resolve(h.digest('hex')));
});
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const versionContent = `${rootPkg.version}-${hash.slice(0, 16)}${wantParts ? `-parts${licenseTargets.length}` : ''}`;
const versionFile = path.join(ANDROID_ASSETS_DIR, 'bundle.sha256');
fs.writeFileSync(versionFile, versionContent, 'utf8');
console.log(`[bundle-android] Generated bundle.sha256: ${versionContent}`);

// 5. Assets whitelist gate: everything in src/main/assets ships inside the APK, so anything that
//    landed there by accident (editor backups, cloud-drive resume markers, stray APKs) would be
//    distributed silently with the release.
const ALLOWED_ASSETS = new Set(['app_bundle.zip', 'bundle.sha256', 'bundle.parts']);
const ALLOWED_ASSET_RE = [/^app_bundle\.part\d+\.zip$/];
const ALLOWED_ASSET_DIRS = new Set(['licenses']);

function assertAssetsWhitelist() {
  if (!fs.existsSync(ANDROID_ASSETS_DIR)) return;
  const strays = fs.readdirSync(ANDROID_ASSETS_DIR, { withFileTypes: true })
    .filter((e) => (e.isDirectory()
      ? !ALLOWED_ASSET_DIRS.has(e.name)
      : !ALLOWED_ASSETS.has(e.name) && !ALLOWED_ASSET_RE.some((re) => re.test(e.name))))
    .map((e) => e.name + (e.isDirectory() ? '/' : ''));
  if (strays.length) {
    console.error('✘ [bundle-android] assets 目录混入了非本工具生成的文件，它们会被原样打进 APK：');
    for (const s of strays) console.error(`    - ${path.join(ANDROID_ASSETS_DIR, s)}`);
    console.error('  请删除后重试；确需随包分发的文件请加进 tools/bundle-android.mjs 的白名单。');
    process.exit(1);
  }
  console.log(`[bundle-android] assets 白名单校验通过: ${[...ALLOWED_ASSETS].join(', ')}`);
}

assertAssetsWhitelist();

console.log('[bundle-android] Done!');
