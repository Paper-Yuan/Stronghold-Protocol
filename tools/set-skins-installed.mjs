// tools/set-skins-installed.mjs — 决定内置哪些皮肤：data/skins-installed.json
//
// 皮肤的素材（头像 / 立绘小图 / Spine / 全幅立绘 / 语音）都是本地文件，绝不进 git（docs/ASSETS.md）。
// 这个工具只写「清单」：默认收录头像文件已经在磁盘上的皮肤（这样注入进 data/assets.json 的每一套都有可画的图），
// `--all` 收录 docs/research/08-skins.json 的全部皮肤（素材尚未下载时用：之后 fetch-skin-* 会补齐文件）。
//
//   node tools/set-skins-installed.mjs            # 只收头像已存在的
//   node tools/set-skins-installed.mjs --all      # 全部 273 套
//   node tools/set-skins-installed.mjs --check    # 只报告，不写文件
//
// 写入后由 `node tools/inject-skins-assets.mjs` 把清单里的皮肤写进 data/assets.json（构建期，非运行时安装）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH = path.join(ROOT, 'docs', 'research', '08-skins.json');
const OUT = path.join(ROOT, 'data', 'skins-installed.json');
const AVATAR_DIR = path.join(ROOT, 'public', 'assets', 'char', 'skin_avatar');

const args = new Set(process.argv.slice(2));
const wantAll = args.has('--all');
const checkOnly = args.has('--check');

const research = JSON.parse(fs.readFileSync(RESEARCH, 'utf8'));
const rows = [];
let missingAvatar = 0;
for (const [charId, list] of Object.entries(research.skins || {})) {
  for (const skin of list || []) {
    const stem = skin.stem;
    if (!stem) continue;
    const avatar = path.join(AVATAR_DIR, `${stem}.png`);
    const hasAvatar = fs.existsSync(avatar) && fs.statSync(avatar).size > 1000;
    if (!hasAvatar) missingAvatar++;
    if (wantAll || hasAvatar) rows.push({ id: skin.skinId, charId });
  }
}
const installed = [...new Set(rows.map((r) => r.id))].sort();
const chars = new Set(rows.map((r) => r.charId));
console.log(`[skins-installed] research ${Object.keys(research.skins || {}).length} operators / ` +
  `${Object.values(research.skins || {}).reduce((n, l) => n + (l || []).length, 0)} skins; ` +
  `${missingAvatar} without a local avatar`);
console.log(`[skins-installed] ${installed.length} skins on ${chars.size} operators` +
  `${wantAll ? ' (--all)' : ''}${checkOnly ? ' (--check: not written)' : ''}`);
if (checkOnly) process.exit(0);
if (!installed.length) {
  console.error('[skins-installed] refusing to write an empty list (run the fetch-skin-* tools first, or pass --all)');
  process.exit(1);
}
fs.writeFileSync(OUT, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
console.log(`[skins-installed] wrote ${path.relative(ROOT, OUT)}`);
