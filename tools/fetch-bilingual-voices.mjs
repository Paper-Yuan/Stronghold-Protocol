#!/usr/bin/env node
// tools/fetch-bilingual-voices.mjs
// Concurrently downloads JP (Japanese) and CN (Chinese) battle voice files
// for all playable operators across all 12 combat slots from ArknightsAssets2 dump.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_EXCEL = path.join(ROOT, '.cache', 'gamedata', 'excel', 'charword_table.json');
const ASSETS_PATH = path.join(ROOT, 'data', 'assets.json');
const VOICE_ROOT = path.join(ROOT, 'public', 'assets', 'audio', 'voice');

const RAW_VOICE_BASE = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/';

const VOICE_SLOTS = {
  BATTLE_START: 'start',
  BATTLE_FACE_ENEMY: 'faceEnemy',
  BATTLE_SELECT: 'select',
  BATTLE_PLACE: 'place',
  BATTLE_SKILL_1: 'skill1',
  BATTLE_SKILL_2: 'skill2',
  BATTLE_SKILL_3: 'skill3',
  BATTLE_SKILL_4: 'skill4',
  FOUR_STAR: 'resultFour',
  THREE_STAR: 'resultThree',
  TWO_STAR: 'resultTwo',
  LOSE: 'resultLose',
};

const LANG_DIRS = {
  jp: 'voice',
  cn: 'voice_cn',
};

function downloadFile(url, dest, retries = 3) {
  return new Promise((resolve, reject) => {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const attempt = (left) => {
      https.get(url, (res) => {
        if (res.statusCode === 200) {
          const stream = fs.createWriteStream(dest);
          res.pipe(stream);
          stream.on('finish', () => stream.close(resolve));
          stream.on('error', (err) => {
            try { fs.unlinkSync(dest); } catch {}
            if (left > 1) setTimeout(() => attempt(left - 1), 500);
            else reject(err);
          });
        } else if (res.statusCode === 404) {
          // Voice file might legitimately not exist for this operator/variant in upstream dump
          res.resume();
          resolve(false);
        } else {
          res.resume();
          if (left > 1) setTimeout(() => attempt(left - 1), 1000);
          else reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
      }).on('error', (err) => {
        if (left > 1) setTimeout(() => attempt(left - 1), 1000);
        else reject(err);
      });
    };

    attempt(retries);
  });
}

export async function buildVoicePlan() {
  if (!fs.existsSync(CACHE_EXCEL)) {
    // Fallback: build queue directly from committed data/assets.json
    const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
    const voice = assets.audio?.voice || { jp: {}, cn: {} };
    const voiceStructure = voice;
    const downloadQueue = [];
    const registeredUrls = new Set();
    for (const lang of ['jp', 'cn']) {
      const remoteDir = LANG_DIRS[lang];
      for (const [charId, slots] of Object.entries(voice[lang] || {})) {
        for (const [slot, val] of Object.entries(slots)) {
          const urls = Array.isArray(val) ? val : [val];
          for (const u of urls) {
            const prefix = `/assets/audio/voice/${lang}/`;
            if (!u.startsWith(prefix)) continue;
            const relFile = u.slice(prefix.length);
            const url = `${RAW_VOICE_BASE}${remoteDir}/${relFile}`;
            const dest = path.join(VOICE_ROOT, lang, ...relFile.split('/'));
            const key = `${lang}:${relFile}`;
            if (!registeredUrls.has(key)) {
              registeredUrls.add(key);
              downloadQueue.push({ lang, charId, relFile, url, dest });
            }
          }
        }
      }
    }
    return { voiceStructure, downloadQueue };
  }
  const charword = JSON.parse(fs.readFileSync(CACHE_EXCEL, 'utf8'));
  const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
  const chars = assets.chars || {};

  const words = charword.charWords || {};
  // charId -> slot -> array of fileRel ('char_1028_texas2/cn_019.mp3')
  const voiceStructure = { jp: {}, cn: {} };
  const downloadQueue = [];
  const registeredUrls = new Set();

  for (const e of Object.values(words)) {
    if (!e || typeof e !== 'object') continue;
    const charId = e.charId;
    const slot = VOICE_SLOTS[e.placeType];
    const vid = e.voiceId;
    if (!charId || !slot || !chars[charId] || !vid || !vid.startsWith('CN_')) continue;
    if (e.wordKey !== charId) continue;
    if (!e.voiceAsset) continue;

    const parts = e.voiceAsset.split('/');
    if (parts.length !== 2) continue;
    const voiceFileName = `${parts[1].toLowerCase()}.mp3`;
    const relFile = `${parts[0]}/${voiceFileName}`;

    for (const lang of ['jp', 'cn']) {
      if (!voiceStructure[lang][charId]) voiceStructure[lang][charId] = {};
      if (!voiceStructure[lang][charId][slot]) voiceStructure[lang][charId][slot] = [];

      const webPath = `/assets/audio/voice/${lang}/${relFile}`;
      if (!voiceStructure[lang][charId][slot].includes(webPath)) {
        voiceStructure[lang][charId][slot].push(webPath);
      }

      const remoteDir = LANG_DIRS[lang];
      const url = `${RAW_VOICE_BASE}${remoteDir}/${relFile}`;
      const dest = path.join(VOICE_ROOT, lang, parts[0], voiceFileName);

      const key = `${lang}:${relFile}`;
      if (!registeredUrls.has(key)) {
        registeredUrls.add(key);
        downloadQueue.push({ lang, charId, relFile, url, dest });
      }
    }
  }

  // Sort and deduplicate structure slots (arrays of 1 element converted to single string for compact JSON)
  for (const lang of ['jp', 'cn']) {
    for (const charId of Object.keys(voiceStructure[lang])) {
      for (const slot of Object.keys(voiceStructure[lang][charId])) {
        const arr = voiceStructure[lang][charId][slot];
        if (arr.length === 1) {
          voiceStructure[lang][charId][slot] = arr[0];
        }
      }
    }
  }

  return { voiceStructure, downloadQueue };
}

async function main() {
  console.log('[fetch-bilingual-voices] 解析干员 12 战斗槽位与双语计划...');
  const { voiceStructure, downloadQueue } = await buildVoicePlan();
  console.log(`[fetch-bilingual-voices] 计划抓取条目数: ${downloadQueue.length} (JP + CN)`);

  let completed = 0;
  let skipped = 0;
  let downloaded = 0;
  let failed = 0;
  let totalBytes = 0;
  const concurrency = 20;

  async function worker(items) {
    for (const item of items) {
      try {
        if (fs.existsSync(item.dest) && fs.statSync(item.dest).size > 1000) {
          skipped++;
          completed++;
          totalBytes += fs.statSync(item.dest).size;
          continue;
        }

        const ok = await downloadFile(item.url, item.dest);
        if (ok !== false && fs.existsSync(item.dest) && fs.statSync(item.dest).size > 500) {
          downloaded++;
          totalBytes += fs.statSync(item.dest).size;
        } else {
          failed++;
        }
        completed++;
      } catch (err) {
        failed++;
        completed++;
      }

      if (completed % 25 === 0 || completed === downloadQueue.length) {
        const mb = (totalBytes / 1024 / 1024).toFixed(2);
        process.stdout.write(`进度: ${completed}/${downloadQueue.length} (跳过: ${skipped}, 新下: ${downloaded}, 失败: ${failed}, 磁盘: ${mb} MB)\r`);
      }
    }
  }

  const chunks = Array.from({ length: concurrency }, () => []);
  downloadQueue.forEach((item, idx) => chunks[idx % concurrency].push(item));

  const start = Date.now();
  await Promise.all(chunks.map(worker));
  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[fetch-bilingual-voices] 下载完成! 耗时: ${dur}s, 跳过: ${skipped}, 新下: ${downloaded}, 失败: ${failed}, 总磁盘: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  // Write out plan structure cache for manifest sync
  const planOut = path.join(ROOT, '.cache', 'bilingual_voice_structure.json');
  fs.writeFileSync(planOut, JSON.stringify(voiceStructure, null, 2), 'utf8');
  console.log(`[fetch-bilingual-voices] 语音结构已缓存至 ${planOut}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
