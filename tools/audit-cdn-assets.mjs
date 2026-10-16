// tools/audit-cdn-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = process.cwd();
const cdnConfigPath = path.join(ROOT, 'public', 'data', 'cdn-resource-config.json');
const assetsJsonPath = path.join(ROOT, 'data', 'assets.json');
const skinsJsonPath = path.join(ROOT, 'data', 'skins.json');
const skinsInstalledPath = path.join(ROOT, 'data', 'skins-installed.json');
const skinVoicesJsonPath = path.join(ROOT, 'data', 'skin-voices.json');

console.log('=== STARTING AUDIT OF CDN ASSETS & VOICES ===\n');

const cdnConfig = JSON.parse(fs.readFileSync(cdnConfigPath, 'utf8'));
const cdnFiles = new Set(Object.keys(cdnConfig.files));
console.log(`[CDN Config] Total registered files: ${cdnFiles.size}`);

const assets = JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8'));
const skinsData = JSON.parse(fs.readFileSync(skinsJsonPath, 'utf8'));
const installedSkins = new Set(JSON.parse(fs.readFileSync(skinsInstalledPath, 'utf8')));
const skinVoicesData = JSON.parse(fs.readFileSync(skinVoicesJsonPath, 'utf8'));

// 1. 检查皮肤资源 (Skin Avatars, Portraits, Spines)
console.log('\n--- 1. 皮肤资源排查 ---');
let totalSkinsInCatalogue = 0;
let missingSkinAvatarsInCdn = [];
let missingSkinSpinesInCdn = [];
let missingSkinInstalledSpines = [];

// 遍历 skins.chars
for (const [charId, skinList] of Object.entries(skinsData.chars || {})) {
  for (const s of skinList) {
    totalSkinsInCatalogue++;
    const skinId = s.id;
    const stem = skinId.replace(/@/g, '_').replace(/#/g, '_');
    
    // 头像通常在 /assets/char/skin_avatar/<stem>.png
    const avatarPath = `/assets/char/skin_avatar/${stem}.png`;
    if (!cdnFiles.has(avatarPath)) {
      missingSkinAvatarsInCdn.push({ skinId, avatarPath });
    }

    // Spine 模型通常在 /assets/spine/op/<charId>/<stem>/ 或类似
    // 检查 assets.chars 中是否已安装此皮肤
    const charAsset = assets.chars?.[charId];
    if (charAsset?.skins?.[skinId]) {
      const skinEntry = charAsset.skins[skinId];
      if (skinEntry.spine?.front) {
        const { skel, atlas, textures } = skinEntry.spine.front;
        const requiredFiles = [skel, atlas, ...(textures || [])];
        for (const rf of requiredFiles) {
          if (!cdnFiles.has(rf)) {
            missingSkinSpinesInCdn.push({ skinId, file: rf });
          }
        }
      }
    } else if (installedSkins.has(skinId)) {
      missingSkinInstalledSpines.push(skinId);
    }
  }
}

console.log(`皮肤总计 (data/skins.json): ${totalSkinsInCatalogue}`);
console.log(`已标记安装皮肤 (skins-installed.json): ${installedSkins.size}`);
console.log(`CDN 缺失的皮肤头像数量: ${missingSkinAvatarsInCdn.length}`);
if (missingSkinAvatarsInCdn.length > 0) {
  console.log('  示例缺失皮肤头像 (前 5):', missingSkinAvatarsInCdn.slice(0, 5));
}
console.log(`已配置在 assets.json 的皮肤中，CDN 缺失的 Spine 文件数: ${missingSkinSpinesInCdn.length}`);
if (missingSkinSpinesInCdn.length > 0) {
  console.log('  示例缺失 Spine 文件 (前 5):', missingSkinSpinesInCdn.slice(0, 5));
}

// 2. 检查语音资源 (Voice Assets)
console.log('\n--- 2. 全语言语音排查 ---');
const voiceLangs = ['voice', 'voiceJp', 'voiceEn', 'voiceKr', 'voiceCustom'];
const voiceStats = {};

for (const langKey of voiceLangs) {
  const langGroup = assets.audio?.[langKey] || {};
  let totalPaths = 0;
  let missingInCdn = 0;
  let missingPaths = [];

  for (const [charKey, charVoice] of Object.entries(langGroup)) {
    // charVoice 可能是字符串、数组或对象
    function collectPaths(val) {
      if (!val) return;
      if (typeof val === 'string') {
        totalPaths++;
        if (!cdnFiles.has(val)) {
          missingInCdn++;
          missingPaths.push(val);
        }
      } else if (Array.isArray(val)) {
        val.forEach(collectPaths);
      } else if (typeof val === 'object') {
        Object.values(val).forEach(collectPaths);
      }
    }
    collectPaths(charVoice);
  }

  voiceStats[langKey] = {
    total: totalPaths,
    inCdn: totalPaths - missingInCdn,
    missing: missingInCdn,
    sampleMissing: missingPaths.slice(0, 3)
  };
}

console.table(voiceStats);

// 3. 检查本地磁盘语音与 CDN 配置的对比
console.log('\n--- 3. 本地已有语音与 CDN 登记对比 ---');
const localVoiceDir = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const localLangDirs = fs.existsSync(localVoiceDir) ? fs.readdirSync(localVoiceDir) : [];

function scanDirFiles(dir, prefix = '') {
  let res = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const rel = prefix ? `${prefix}/${item}` : item;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      res = res.concat(scanDirFiles(full, rel));
    } else if (stat.isFile()) {
      res.push(rel);
    }
  }
  return res;
}

const localVoiceStats = {};
for (const lDir of localLangDirs) {
  const p = path.join(localVoiceDir, lDir);
  if (fs.statSync(p).isDirectory()) {
    const files = scanDirFiles(p, `/assets/audio/voice/${lDir}`);
    const missingInCdn = files.filter(f => !cdnFiles.has(f));
    localVoiceStats[lDir] = {
      localFileCount: files.length,
      registeredInCdn: files.length - missingInCdn.length,
      unregisteredInCdn: missingInCdn.length,
      sampleUnregistered: missingInCdn.slice(0, 2)
    };
  }
}
console.table(localVoiceStats);

// 4. 检查皮肤专属语音 (skin-voices.json & assets.audio.skinVoice*)
console.log('\n--- 4. 皮肤专属语音 (Skin Voices) 排查 ---');
let skinVoiceTotal = 0;
let skinVoiceMissingCdn = 0;
let skinVoiceMissingList = [];

for (const [skinKey, slots] of Object.entries(skinVoicesData)) {
  for (const [slot, val] of Object.entries(slots)) {
    const paths = Array.isArray(val) ? val : [val];
    for (const p of paths) {
      if (typeof p === 'string' && p.startsWith('/assets/')) {
        skinVoiceTotal++;
        if (!cdnFiles.has(p)) {
          skinVoiceMissingCdn++;
          skinVoiceMissingList.push({ skinKey, slot, path: p });
        }
      }
    }
  }
}

console.log(`skin-voices.json 中包含的皮肤特色语音文件数: ${skinVoiceTotal}`);
console.log(`在 CDN 配置文件中缺失的数量: ${skinVoiceMissingCdn}`);
if (skinVoiceMissingList.length > 0) {
  console.log('示例缺失的皮肤专属语音 (前 10):');
  skinVoiceMissingList.slice(0, 10).forEach(item => {
    console.log(`  [${item.skinKey}] (${item.slot}) -> ${item.path}`);
  });
}

// 检查 assets.audio 中的 skinVoice, skinVoiceJp, skinVoiceEn, skinVoiceKr
const skinVoiceLangs = ['skinVoice', 'skinVoiceJp', 'skinVoiceEn', 'skinVoiceKr'];
console.log('\n--- 5. assets.audio.skinVoice* 各语言专属皮肤语音排查 ---');
for (const svk of skinVoiceLangs) {
  const group = assets.audio?.[svk] || {};
  let total = 0;
  let missing = 0;
  for (const [sk, slots] of Object.entries(group)) {
    for (const [slot, val] of Object.entries(slots)) {
      const paths = Array.isArray(val) ? val : [val];
      for (const p of paths) {
        if (typeof p === 'string' && p.startsWith('/assets/')) {
          total++;
          if (!cdnFiles.has(p)) {
            missing++;
          }
        }
      }
    }
  }
  console.log(`  ${svk.padEnd(16)}: 总计 ${total} 条, CDN 缺失: ${missing} 条`);
}

