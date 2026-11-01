#!/usr/bin/env node
// tools/patch-assets-local.mjs — 把「本地已有的素材」补进 data/assets.json（**不联网、不下载**）。
//
// WHY. 客户端取图是「记录 id → data/assets.json 的映射 → public/assets/<路径>」：映射里没有该 id 就直接回退成文字。
// 而 `data/assets.json` 历来由 `tools/fetch-assets.mjs` 从**官方四份版本快照**（`data/versions/*`）规划出来
// （`tools/assets/versions.mjs` 的 `versionAssetData`），玩法包内容按设计只并进**默认** `data/`，于是像炸惊/湮灭
// 这类「默认版本专属」的盟约、策略、道具、模式图标、干员三槽**永远进不了清单** —— 图在磁盘上也不会被认（实测：
// `bond/rhodesShip.png` 在、清单里没有）。
//
// 这个工具补的就是那一段：默认 `data/*.json` + `public/assets/namecard/index.json`（名片是通用大厅素材）里
// **本地已经存在**的槽位，按「add-only」合并进 `data/assets.json`。它不下载、不删条目、不改已有取值。
//
// 覆盖的槽位（也是 `docs/ASSETS.md` 的 schema 说明）：
//   bonds[bondId]                     → /assets/bond/<bondId>.png
//   bands[bandId]                     → /assets/band/<bandId>.png
//   items[iconId]                     → /assets/item/<iconId>.png
//   ui['modeIcon/<iconId>']           → /assets/ui/mode/<iconId>.png
//   chars[charId].{avatar,portrait,illust} → /assets/char/{avatar,portrait,illust}/<charId>[_1].png
//   skills[iconId]                    → /assets/skill/<iconId 消毒后>.png（键仍是原始 iconId）
//   skillsById[skillId]               → 同一张图（客户端 skillsById 的二级回退路径，public/js/ui/assetUrls.js）
//   namecards[slug]                   → /assets/namecard/<slug>/preview.webp（名片合集，见 tools/import-namecards.py）
// **不覆盖**：spine（要 CDN 的骨架包，本地没有就是没有）—— 见 `--slots` 的默认值与 docs/ASSETS.md 的说明。
//
// skills 是 2026-10-29 补进来的：炸惊的专属干员（char_4182_oblvns / char_4185_amoris / char_4217_makoto … 9 人）的
// 技能图标图早就在 public/assets/skill/ 里，却不在清单中 —— 因为 fetch-assets 只按四份版本快照规划技能图标，而
// 这几个干员只存在于默认 data/。文件名用 tools/assets/versions.mjs 的同一消毒规则（skcom_powerstrike[3] →
// skcom_powerstrike_3_.png），清单的键仍是原始 iconId（客户端按 iconId 查）。
//
// USAGE
//   node tools/patch-assets-local.mjs                 # 报告会补哪些 key（零写入）
//   node tools/patch-assets-local.mjs --write         # 合并进 data/assets.json（add-only）
//   node tools/patch-assets-local.mjs --write --dry-run 冲突时报错而不是静默
//   node tools/patch-assets-local.mjs --write --slots skills   # 只补技能图标
//   node tools/patch-assets-local.mjs --slots bonds,bands,items,ui,chars,namecards
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { addManifestEntries } from './assets/versions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const PUBLIC = join(ROOT, 'public');
const ALL_SLOTS = Object.freeze(['bonds', 'bands', 'items', 'ui', 'chars', 'skills', 'namecards']);

const args = process.argv.slice(2);
const opt = { write: false, slots: [...ALL_SLOTS], verbose: false, patch: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--write') opt.write = true;
  else if (a === '--verbose') opt.verbose = true;
  else if (a === '--slots') {
    const v = args[++i];
    if (!v) { console.error('--slots needs a comma list'); process.exit(2); }
    const bad = v.split(',').map((s) => s.trim()).filter((s) => s && !ALL_SLOTS.includes(s));
    if (bad.length) { console.error(`unknown slot(s): ${bad.join(', ')} (valid: ${ALL_SLOTS.join(', ')})`); process.exit(2); }
    opt.slots = v.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (a === '--patch') {
    const v = args[++i];
    if (!v) { console.error('--patch needs a file'); process.exit(2); }
    opt.patch = resolve(ROOT, v);
  } else if (a === '--help' || a === '-h') { console.log('usage: node tools/patch-assets-local.mjs [--write] [--slots a,b] [--patch <json>] [--verbose]'); process.exit(0); }
  else { console.error(`unknown option ${a}`); process.exit(2); }
}

const read = (name) => JSON.parse(readFileSync(join(DATA, `${name}.json`), 'utf8'));
const onDisk = (url) => !!url && existsSync(join(PUBLIC, url.replace(/^\//, ''))) && statSync(join(PUBLIC, url.replace(/^\//, ''))).size > 0;
/** 立绘目录已转 WebP（handoff/asset-webp/BACKUP.md）：清单里写的是 `.webp`，PNG 已不在盘上。 */
const CONVERTED_DIRS = ['/assets/char/illust/', '/assets/char/illustration/', '/assets/char/portrait/'];
/** URL of the art file actually on disk: the WebP twin in a converted directory, else the PNG; null when neither. */
const localArt = (url) => {
  if (!url) return null;
  if (/\.png$/i.test(url) && CONVERTED_DIRS.some((d) => url.startsWith(d))) {
    const webp = url.replace(/\.png$/i, '.webp');
    if (onDisk(webp)) return webp;
  }
  return onDisk(url) ? url : null;
};
/** 图标文件名 = iconId 去掉路径/URL 非法字符（与 tools/assets/versions.mjs / plan.mjs 同一规则）。 */
const iconFile = (iconId) => String(iconId).replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';

/** Fill `{key: url}` for every local file that exists; returns the patch subtree plus the "still missing" keys. */
function collect(entries, urlOf, label) {
  const out = {};
  for (const id of entries) {
    const url = urlOf(id);
    if (onDisk(url)) out[id] = url;
    else missing.push(`${label} ${id}`);
  }
  return out;
}

const assets = read('assets');
const patch = {};
const missing = [];
const note = (what, id) => { if (opt.verbose) console.log(`   add ${what} ${id}`); };

if (opt.slots.includes('bonds')) {
  const bonds = read('bonds');
  patch.bonds = collect(Object.keys(bonds), (id) => `/assets/bond/${id}.png`, 'bond');
  for (const id of Object.keys(patch.bonds)) note('bond', id);
}
if (opt.slots.includes('bands')) {
  const bands = read('bands');
  patch.bands = collect(Object.keys(bands), (id) => `/assets/band/${id}.png`, 'band');
  for (const id of Object.keys(patch.bands)) note('band', id);
}
if (opt.slots.includes('items')) {
  const items = read('items');
  const byIcon = new Map();
  for (const it of Object.values(items)) if (it.iconId) byIcon.set(it.iconId, it);
  patch.items = collect([...byIcon.keys()], (iconId) => `/assets/item/${iconId}.png`, 'item');
  for (const id of Object.keys(patch.items)) note('item', id);
}
if (opt.slots.includes('ui')) {
  const config = read('config');
  const slot = {};
  for (const m of Object.values(config.modes || {})) {
    const iconId = m.iconId;
    if (!iconId) continue;
    const key = `modeIcon/${iconId}`;
    const url = `/assets/ui/modeIcon/${iconId}.png`;
    if (onDisk(url)) slot[key] = url;
    else missing.push(`modeIcon ${iconId}`);
  }
  if (Object.keys(slot).length) patch.ui = slot;
  for (const k of Object.keys(slot)) note('ui', k);
}
if (opt.slots.includes('chars')) {
  const chess = read('chess');
  const chars = {};
  const seen = new Set();
  for (const c of Object.values(chess)) {
    const id = c.charId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rec = {};
    for (const [slot, file] of [['avatar', `${id}.png`], ['portrait', `${id}_1.png`], ['illust', `${id}.png`]]) {
      const art = localArt(`/assets/char/${slot}/${file}`);
      if (art) rec[slot] = art;
      else missing.push(`char ${id} ${slot}`);
    }
    if (Object.keys(rec).length) chars[id] = rec;
  }
  if (Object.keys(chars).length) patch.chars = chars;
}
if (opt.slots.includes('skills')) {
  // 技能图标：炸惊/湮灭的专属干员只存在于默认 data/，四份版本快照规划不出它们的技能图标 —— 本地有图就补进清单。
  // 链路上游同 tools/assets/plan.mjs:491：iconId || prefabId || skillId；键用原始 iconId（客户端按它查），文件名消毒。
  const chess = read('chess');
  const skills = {};
  const byId = {};
  const seenSkill = new Set();
  for (const rec of Object.values(chess)) {
    for (const sk of [...(rec.skills || []), ...(rec.skill ? [rec.skill] : [])]) {
      const iconId = sk.iconId || sk.prefabId || sk.skillId;
      if (!iconId || seenSkill.has(iconId)) continue;
      seenSkill.add(iconId);
      const url = `/assets/skill/${iconFile(iconId)}`;
      if (!onDisk(url)) { missing.push(`skill ${iconId}`); continue; }
      skills[iconId] = url;
      if (sk.skillId) byId[sk.skillId] = iconId;
    }
  }
  if (Object.keys(skills).length) patch.skills = skills;
  if (Object.keys(byId).length) patch.skillsById = byId;
  for (const id of Object.keys(skills)) note('skill', id);
}
if (opt.slots.includes('namecards')) {
  const indexPath = join(PUBLIC, 'assets/namecard/index.json');
  if (existsSync(indexPath)) {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    const out = {};
    for (const card of idx.cards || []) {
      const url = card.preview || card.entry || card.side;
      if (onDisk(url)) out[card.id] = url;
      else missing.push(`namecard ${card.id}`);
    }
    if (Object.keys(out).length) patch.namecards = out;
    for (const id of Object.keys(out)) note('namecard', id);
  } else missing.push('namecards (public/assets/namecard/index.json 不存在：先跑 tools/import-namecards.py)');
}

// ---- report ---------------------------------------------------------------------------------------
const added = {};
for (const [slot, map] of Object.entries(patch)) {
  const before = slot === 'ui' || slot === 'namecards' ? (assets[slot] || {}) : (assets[slot] || {});
  const fresh = Object.keys(map).filter((k) => !(k in before));
  if (fresh.length) added[slot] = fresh.length;
}
console.log(`slots: ${opt.slots.join(', ')} | 会新增: ${Object.entries(added).map(([k, v]) => `${k}+${v}`).join(' ') || '（无）'}`);
if (missing.length) {
  console.log(`仍缺图 ${missing.length} 项：`);
  for (const m of missing.slice(0, 40)) console.log('  ·', m);
  if (missing.length > 40) console.log(`  …共 ${missing.length} 项`);
}

if (!opt.write) { console.log('（零写入；加 --write 合并进 data/assets.json）'); process.exit(0); }
const merged = addManifestEntries(assets, patch);
// 合并之后**重算 stats 里与条目数有关的那几项**：stats 只在 tools/fetch-assets.mjs 的 countStats() 里算，
// add-only 补进来的条目（skills / ui 的模式图标 / namecards …）不会自己进 stats，于是
// `test/assets.test.js` 的「manifest 自洽」断言（stats.ui === Object.keys(ui).length）会红 —— 这不是期望过期，是统计漏算。
if (merged && merged.stats && typeof merged.stats === 'object') {
  const count = (o) => Object.keys(o && typeof o === 'object' ? o : {}).length;
  merged.stats = {
    ...merged.stats,
    chars: count(merged.chars), enemies: count(merged.enemies), tokens: count(merged.tokens),
    bonds: count(merged.bonds), items: count(merged.items), bands: count(merged.bands),
    skills: count(merged.skills), modules: count(merged.modules), ui: count(merged.ui),
  };
}
const text = `${JSON.stringify(merged)}\n`;
writeFileSync(opt.patch ?? join(DATA, 'assets.json'), text);
console.log(`wrote ${(opt.patch ?? join(DATA, 'assets.json'))} (${Buffer.byteLength(text)} B)`);

// 2026-10-28: 写完必须把 data/ 同步进 public/data/ —— 客户端读的是 `public/data/assets.json`（`data.get('assets')`）。
// 曾漏跑一次同步：新条目客户端看不到、图标继续回退文字，而两份只差 4.7 KB，肉眼完全看不出来（靠 e2e 量体积才发现）。
// 这里强制调一次 `tools/sync-static-web.mjs`，从源头消灭「改完忘了同步」。
const sync = spawnSync(process.execPath, [join(DATA, '..', 'tools', 'sync-static-web.mjs')], { stdio: 'inherit' });
if (sync.status !== 0) {
  console.error('[patch-assets-local] ✘ 同步 public/data 失败：客户端会读到旧清单，请手动跑 node tools/sync-static-web.mjs');
  process.exit(1);
}
