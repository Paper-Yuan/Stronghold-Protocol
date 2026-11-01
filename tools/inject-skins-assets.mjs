// tools/inject-skins-assets.mjs — 把「已内置」的皮肤与全幅立绘写进 data/assets.json（构建期，不是运行时安装）
//
// 这是 0.1.6 起本地分支的皮肤内置方案（handoff/SKINS-BUILTIN-PLAN.md）：素材由 fetch-skin-* / fetch-illusts 下载到
// public/assets/（git 忽略），这里只把磁盘上确实存在的文件写进 manifest。**不写任何远程 URL** —— manifest 里的每个
// URL 都必须是本机文件，否则离线/局域网/CSP 下就是 404。
//
// 清单：data/skins-installed.json（node tools/set-skins-installed.mjs 生成）。它之外的研究皮肤不注入。
// 文件约定：
//   char/skin_avatar/{stem}.png     皮肤头像（必有才注入该皮肤）
//   char/portrait/{stem}.png        皮肤 180×360 立绘小图（可选）
//   char/illust/{charId}.png        干员全幅立绘（可选，默认皮肤，精二）
//   char/illust/{charId}_1.png      干员精一全幅立绘（可选；有才写 chars[].illustE1）
//   char/illust/skin/{stem}.png     皮肤全幅立绘（可选）
//   spine/op/{charId}/{stem}/{front,back}/{stem}.{skel,atlas,png}   皮肤 Spine（可选）
//   relics/overlimit/{relicId}.png  超限「词条」图标（可选；有才写顶层 relicsOverlimit）
//
// 立绘类目录（char/illust/、char/illustration/、char/portrait/）已转 WebP（业主 2026-10-31，见
// handoff/asset-webp/BACKUP.md 与 docs/ASSETS.md「WebP art」）：上面这些 `.png` 写的是**下载身份**，清单里写的
// 是盘上真实存在的那个扩展名 —— `artUrl()` 优先 `.webp`、缺失才回落 `.png`（13 张低 PSNR 白名单仍是 PNG）。
//
// After a game update re-run: fetch-assets → fetch-skin-* → fetch-illusts → set-skins-installed → this tool.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webpVariant } from './assets/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH_PATH = path.join(ROOT, 'docs', 'research', '08-skins.json');
const INSTALLED_PATH = path.join(ROOT, 'data', 'skins-installed.json');
const ASSETS_PATH = path.join(ROOT, 'data', 'assets.json');
// 超限词条（业主 2026-10-31 手写表的固化）：它的 `icon` 就是 public/assets/relics/overlimit/<id>.png
const RELICS_RESEARCH_PATH = path.join(ROOT, 'docs', 'research', '23-overlimit-relics.json');

const research = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));
const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));

if (!assets.chars) {
  console.error('✘ assets.json 缺少 chars 字段');
  process.exit(1);
}

/** 已内置清单：没有文件时退回「研究目录里头像已存在的皮肤」。 */
function installedIds() {
  if (fs.existsSync(INSTALLED_PATH)) {
    const list = JSON.parse(fs.readFileSync(INSTALLED_PATH, 'utf8'));
    if (Array.isArray(list)) return new Set(list);
  }
  return null;
}

const gate = installedIds();
const ASSETS_ROOT = path.join(ROOT, 'public', 'assets');
const url = (...parts) => `/assets/${parts.join('/')}`;
const fileExists = (...parts) => {
  const p = path.join(ASSETS_ROOT, ...parts);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
};
/**
 * URL of a local art file: for the converted directories (`char/illust/`, `char/illustration/`, `char/portrait/` —
 * handoff/asset-webp/BACKUP.md) the WebP twin when it is on disk, else the PNG. The PNG stays for the 13 whitelist
 * images and for any file reverted after a failed check. null when neither exists.
 */
const artUrl = (...parts) => {
  const webp = webpVariant(ASSETS_ROOT, parts.join('/'));
  if (webp) return url(...webp.split('/'));
  return fileExists(...parts) ? url(...parts) : null;
};

let injected = 0, skippedNoAvatar = 0, injectedWithPortrait = 0, injectedWithSpine = 0, injectedWithIllust = 0;
const chars = new Set();

for (const [charId, list] of Object.entries(research.skins || {})) {
  const rec = assets.chars[charId];
  if (!rec) continue;
  for (const s of list || []) {
    const skinId = s.skinId;
    const stem = s.stem;
    if (!skinId || !stem) continue;
    if (gate && !gate.has(skinId)) continue;
    if (!fileExists('char', 'skin_avatar', `${stem}.png`)) { skippedNoAvatar++; continue; }

    const entry = {
      name: s.name || skinId,
      group: s.group || '',
      avatar: url('char', 'skin_avatar', `${stem}.png`),
    };
    const skinPortrait = artUrl('char', 'portrait', `${stem}.png`);
    if (skinPortrait) {
      entry.portrait = skinPortrait;
      injectedWithPortrait++;
    }
    const skinIllust = artUrl('char', 'illust', 'skin', `${stem}.png`);
    if (skinIllust) {
      entry.illust = skinIllust;
      injectedWithIllust++;
    }

    // Spine 只在骨骼/图集/贴图三件套都在磁盘上时注入；动画元数据沿用干员原皮的解析结果
    const frontBase = path.join(ROOT, 'public', 'assets', 'spine', 'op', charId, stem, 'front', stem);
    const backBase = path.join(ROOT, 'public', 'assets', 'spine', 'op', charId, stem, 'back', stem);
    const hasFront = ['skel', 'atlas', 'png'].every((ext) => fs.existsSync(`${frontBase}.${ext}`));
    if (hasFront) {
      const defaultFront = rec.spine?.front || {};
      const defaultBack = rec.spine?.back || {};
      const spineUrl = (side, ext) => url('spine', 'op', charId, stem, side, `${stem}.${ext}`);
      entry.spine = {
        front: {
          skel: spineUrl('front', 'skel'),
          atlas: spineUrl('front', 'atlas'),
          textures: [spineUrl('front', 'png')],
          pma: false,
          anims: defaultFront.anims || {},
          animations: defaultFront.animations || {},
          events: defaultFront.events || ['OnAttack', 'OnStart'],
          hits: defaultFront.hits || {},
          bounds: defaultFront.bounds || null,
        },
      };
      if (['skel', 'atlas', 'png'].every((ext) => fs.existsSync(`${backBase}.${ext}`))) {
        entry.spine.back = {
          skel: spineUrl('back', 'skel'),
          atlas: spineUrl('back', 'atlas'),
          textures: [spineUrl('back', 'png')],
          pma: false,
          anims: defaultBack.anims || defaultFront.anims || {},
          animations: defaultBack.animations || defaultFront.animations || {},
          events: defaultBack.events || ['OnAttack', 'OnStart'],
          hits: defaultBack.hits || {},
          bounds: defaultBack.bounds || null,
        };
      }
      injectedWithSpine++;
    }

    rec.skins = rec.skins || {};
    rec.skins[skinId] = entry;
    chars.add(charId);
    injected++;
  }
}

// 干员全幅立绘（默认皮肤，详情/预览用）
let charsWithIllust = 0;
let charsWithIllustE1 = 0, staleIllustE1 = 0;
for (const charId of Object.keys(assets.chars)) {
  const illust = artUrl('char', 'illust', `${charId}.png`);
  if (illust) {
    assets.chars[charId].illust = illust;
    charsWithIllust++;
  }
  // 精一（`_1`）全幅立绘：座位名片的 精一/精二 开关按路径直接推 `/assets/char/illust/<id>_1.png`
  // （public/js/ui/cardArt.js artSrcOf），渲染本身不需要清单；但**打包与清理需要**：tools/package.mjs 的
  // listedArtFiles 只遍历本清单里的 URL，fetch-assets 的 orphanFiles 也只认清单/计划引用过的文件 ——
  // 不登记就是「包内不含、--prune 会删」。上游没有 #1 默认外观的干员（char_4231_clemnt）不写，也不留旧值。
  const illustE1 = artUrl('char', 'illust', `${charId}_1.png`);
  if (illustE1) {
    assets.chars[charId].illustE1 = illustE1;
    charsWithIllustE1++;
  } else if (assets.chars[charId].illustE1 !== undefined) {
    delete assets.chars[charId].illustE1;
    staleIllustE1++;
  }
}

// 超限「词条」图标（业主 2026-10-31 从 xlsx 解出的 36 张）：和 illustE1 完全同一个坑 —— 这些图只被
// `data/relicsOverlimit.json` 的 `icon` 引用，下载计划（tools/assets/plan.mjs）从来列不到它们，于是
// `tools/package.mjs` 的 listedArtFiles（只遍历清单里的 URL）不会把它们算进包，`fetch-assets` 的 orphanFiles 还会把
// 它们当孤儿，`--prune` 一次就删光。所以在这里登记成 data/assets.json 的顶层 `relicsOverlimit`（id → 图标 URL）：
// 客户端照旧读 data/relicsOverlimit.json 的 icon，这一段**只服务打包与清理**。文件不在磁盘上（没解素材的机器 / CI）
// 就不写；整个目录都不在时清掉旧值，免得清单指向不存在的文件。
const RELIC_ICON_RE = /^\/assets\/relics\/overlimit\/([A-Za-z0-9_.-]+\.png)$/;
let relicIcons = {};
try {
  const relics = JSON.parse(fs.readFileSync(RELICS_RESEARCH_PATH, 'utf8'));
  for (const e of Array.isArray(relics.entries) ? relics.entries : []) {
    const id = typeof e?.id === 'string' ? e.id.trim() : '';
    const icon = typeof e?.icon === 'string' ? e.icon.trim() : '';
    const m = icon ? RELIC_ICON_RE.exec(icon) : null;
    if (!id || !m || !fileExists('relics', 'overlimit', m[1])) continue;
    relicIcons[id] = icon;
  }
} catch (e) {
  console.warn(`⚠ 读不到 docs/research/23-overlimit-relics.json（${e.message}）：词条图标不进清单`);
  relicIcons = {};
}
const relicsWithIcons = Object.keys(relicIcons).length;
const staleRelicIcons = assets.relicsOverlimit && typeof assets.relicsOverlimit === 'object'
  ? Object.keys(assets.relicsOverlimit).filter((id) => !(id in relicIcons)).length : 0;
if (relicsWithIcons) assets.relicsOverlimit = relicIcons;
else delete assets.relicsOverlimit;

assets.stats = assets.stats || {};
assets.stats.skins = injected;
assets.stats.charsWithSkins = chars.size;
assets.stats.illusts = charsWithIllust;
assets.stats.charsWithIllust = charsWithIllust;
assets.stats.charsWithIllustE1 = charsWithIllustE1;
assets.stats.relicsOverlimit = relicsWithIcons;

fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets), 'utf8');
console.log(`✔ 注入 ${chars.size} 名干员的共 ${injected} 套皮肤（立绘小图 ${injectedWithPortrait}、Spine ${injectedWithSpine}、` +
  `皮肤全幅立绘 ${injectedWithIllust}）；跳过 ${skippedNoAvatar} 套（头像缺失）。` +
  `干员默认全幅立绘 ${charsWithIllust} 张，精一全幅立绘 ${charsWithIllustE1} 张` +
  `${staleIllustE1 ? `（清掉 ${staleIllustE1} 条文件已不在的 illustE1）` : ''}；` +
  `超限词条图标 ${relicsWithIcons} 张` +
  `${staleRelicIcons ? `（清掉 ${staleRelicIcons} 条文件已不在的）` : ''}。`);
