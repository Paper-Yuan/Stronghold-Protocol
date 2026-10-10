// tools/apply-endless.mjs — 在**目标项目根目录**运行：把无尽模式的数据侧处理做完。
//
//   1) 调用同目录的 patch-endless.mjs，就地给 data/config.json 加上/刷新 8 个无尽模式条目；
//   2) shared/constants.js  →  public/shared/constants.js（浏览器 stand-alone 副本）
//   3) data/config.json     →  public/data/config.json（客户端读取的静态副本）
//
// 只做「无尽相关」的生成与同步，**不**跑完整的 sync-static-web（那会连带覆盖 public/sim 等）。
// 用法：node tools/apply-endless.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const must = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.error(`[apply-endless] 缺少 ${rel} —— 请在项目根目录运行，且已先覆盖 overlay/`); process.exit(1); }
  return p;
};

// 1) 生成无尽模式条目（就地补丁 data/config.json）
must('data/config.json');
console.log('[apply-endless] 1/3 运行 patch-endless.mjs …');
const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'patch-endless.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) { console.error('[apply-endless] patch-endless 失败，退出码', r.status); process.exit(r.status || 1); }

// 2) + 3) 同步副本
const copy = (a, b) => { const src = must(a); fs.mkdirSync(path.dirname(path.join(ROOT, b)), { recursive: true }); fs.copyFileSync(src, path.join(ROOT, b)); console.log(`[apply-endless]   ${a} → ${b}`); };
console.log('[apply-endless] 2/3 同步 shared/constants.js → public/shared/constants.js');
copy('shared/constants.js', 'public/shared/constants.js');
console.log('[apply-endless] 3/3 同步 data/config.json → public/data/config.json');
copy('data/config.json', 'public/data/config.json');

console.log('[apply-endless] 完成。建议接着跑：node tools/endlessscalecheck.mjs');
