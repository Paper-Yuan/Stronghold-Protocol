// tools/inject-skin-voices.mjs — 把 data/skin-voices.json 的皮肤专属语音并入 data/assets.json。
//
// 本仓库原本只有 fetch-skin-voices.mjs（写 data/skin-voices.json）与 audit-cdn-assets.mjs（读
// assets.audio.skinVoice*），中间这一环一直是空的：清单里的 skinVoice 段没有 writer。这个脚本就是它，
// 与 inject-skins-assets.mjs 同一形状（幂等、只增不减、保持仓库排版）。
//
//   node tools/inject-skin-voices.mjs
//
// data/skin-voices.json 的形状是 { cn|jp|en|kr: { <voice word key>: { <slot>: url|[url] } } }，其中
// voice word key 是皮肤的 skinId 把 '@' 换成 '_'（保留 '#'）。清单里对应的树是 audio.js 的 SKIN_TREES。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICES_PATH = path.join(ROOT, 'data', 'skin-voices.json');
const ASSETS_PATH = path.join(ROOT, 'data', 'assets.json');
/** dub → the manifest tree audio.js reads (public/js/voicePrefs.js SKIN_TREES). */
const TREE = Object.freeze({ cn: 'skinVoice', jp: 'skinVoiceJp', en: 'skinVoiceEn', kr: 'skinVoiceKr' });

const voices = JSON.parse(fs.readFileSync(VOICES_PATH, 'utf8'));
const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
if (!assets.audio || typeof assets.audio !== 'object') {
  console.error('✘ assets.json 缺少 audio 字段');
  process.exit(1);
}

let urls = 0;
const count = (o) => {
  if (typeof o === 'string') return o.startsWith('/assets/') ? 1 : 0;
  if (Array.isArray(o)) return o.reduce((n, x) => n + count(x), 0);
  return o && typeof o === 'object' ? Object.values(o).reduce((n, x) => n + count(x), 0) : 0;
};

for (const [lang, tree] of Object.entries(TREE)) {
  const map = voices[lang];
  if (!map || typeof map !== 'object') continue;
  assets.audio[tree] = map;
  urls += count(map);
}

assets.stats = assets.stats || {};
assets.stats.skinVoiceUrls = urls;

// 仓库约定：2 空格缩进、结尾无换行
fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2), 'utf8');
console.log(`✔ 皮肤专属语音并入清单：${Object.keys(TREE).length} 个语言树 / ${urls} 条 URL（audio.skinVoice*）`);
