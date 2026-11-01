#!/usr/bin/env node
// tools/fetch-skin-voices.mjs
// 下载「内置皮肤」的战斗槽位语音（中/日/英/韩），并生成 data/skin-voices.json。
//   默认：data/skins-installed.json 里的全部皮肤（skinId 的 @ 换 _ 即 charword_table 的 wordKey）
//   --legacy：0.1.6 的 11 款在场皮肤列表
// 只取 charword_table 里真实存在的 12 个战斗槽位；404 的文件跳过，不写进映射表。
// 消费方：public/js/audio.js voiceLine(..., skin) —— 穿着该外观时优先播放，缺槽回落到干员自己的台词。

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_EXCEL = path.join(ROOT, '.cache', 'gamedata', 'excel', 'charword_table.json');
const VOICE_ROOT = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const RAW_VOICE_BASE = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/';

// 仅下载自走棋对战与面板交互涉及的战斗槽位
const BATTLE_SLOTS = {
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

// 目标：默认取 data/skins-installed.json 的全部内置皮肤（`--legacy` 保留 0.1.6 的 11 款在场列表）。
// charword_table 里没有战斗语音的皮肤会自然落空（0 个任务，或全部 404），不会写坏 data/skin-voices.json。
export const TARGET_SKIN_KEYS = [
  'char_472_pasngr_epoque#17',     // 异客 - 今昔须臾之梦
  'char_4064_mlynar_epoque#28',    // 玛恩纳 - 远路
  'char_1012_skadi2_iteration#2',  // 浊心斯卡蒂 - 红女爵
  'char_249_mlyss_boc#8',          // 缪尔赛思 - 新枝
  'char_1016_agoat2_epoque#34',    // 纯烬艾雅法拉 - 远行前的野餐
  'char_1016_agoat2_epoque#57',    // 纯烬艾雅法拉 - 后来的故事
  'char_1032_excu2_sale#12',       // 圣约送葬人 - 众志归一
  'char_245_cello_sale#12',        // 塑心 - 无我唯识
  'char_1038_whitw2_sale#15',      // 荒芜拉普兰德 - 无序的谦卑
  'char_4134_cetsyr_epoque#50',    // 魔王 - 追悼
  'char_1041_angel2_iteration#6',  // 新约能天使 - 寻翼之歌
];

/** 默认目标：内置清单（skinId 的 `@` 换成 `_`，保留 `#` —— charword_table 的 wordKey 正是这个形式）。 */
function targetKeys() {
  if (process.argv.includes('--legacy')) return TARGET_SKIN_KEYS;
  const file = path.join(ROOT, 'data', 'skins-installed.json');
  if (!fs.existsSync(file)) return TARGET_SKIN_KEYS;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(list) && list.length) {
      return list.filter((x) => typeof x === 'string').map((id) => id.replaceAll('@', '_'));
    }
  } catch { /* fall through */ }
  return TARGET_SKIN_KEYS;
}

const LANG_DIRS = {
  cn: 'voice_cn',
  jp: 'voice',
  en: 'voice_en',
  kr: 'voice_kr',
};

function downloadFile(url, dest, retries = 1) {
  return new Promise((resolve, reject) => {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    const attempt = (left) => {
      const req = https.get(url, (res) => {
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
          res.resume();
          resolve(false);
        } else {
          res.resume();
          if (left > 1) setTimeout(() => attempt(left - 1), 1000);
          else reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
      });
      // a hung request would make a 404-only tail take minutes; fail this attempt quickly
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
      req.on('error', (err) => {
        if (left > 1) setTimeout(() => attempt(left - 1), 1000);
        else reject(err);
      });
    };

    attempt(retries);
  });
}

async function main() {
  if (!fs.existsSync(CACHE_EXCEL)) {
    console.error('charword_table.json not found in cache');
    process.exit(1);
  }

  const charword = JSON.parse(fs.readFileSync(CACHE_EXCEL, 'utf8'));
  const words = Object.values(charword.charWords || {});

  // 1. 整理需下载的条目与皮肤语音字典
  // skinVoices[lang][skinWordKey][slot] = [webUrls]
  const skinVoiceMap = { cn: {}, jp: {}, en: {}, kr: {} };
  const downloadTasks = [];

  for (const skinKey of targetKeys()) {
    const matched = words.filter((w) => w.wordKey === skinKey && BATTLE_SLOTS[w.placeType]);
    for (const w of matched) {
      const slot = BATTLE_SLOTS[w.placeType];
      if (!w.voiceAsset) continue;
      const parts = w.voiceAsset.split('/');
      if (parts.length !== 2) continue;
      const fileName = `${parts[1].toLowerCase()}.mp3`;
      const relPath = `${parts[0]}/${fileName}`;

      for (const lang of ['cn', 'jp', 'en', 'kr']) {
        if (!skinVoiceMap[lang][skinKey]) skinVoiceMap[lang][skinKey] = {};
        if (!skinVoiceMap[lang][skinKey][slot]) skinVoiceMap[lang][skinKey][slot] = [];

        const webPath = `/assets/audio/voice/${lang}/${relPath}`;
        if (!skinVoiceMap[lang][skinKey][slot].includes(webPath)) {
          skinVoiceMap[lang][skinKey][slot].push(webPath);
        }

        const remoteDir = LANG_DIRS[lang];
        // URL 编码处理：# 必须转为 %23
        const encodedRel = `${encodeURIComponent(parts[0])}/${fileName}`;
        const url = `${RAW_VOICE_BASE}${remoteDir}/${encodedRel}`;
        const dest = path.join(VOICE_ROOT, lang, parts[0], fileName);

        downloadTasks.push({ lang, skinKey, relPath, url, dest });
      }
    }
  }

  console.log(`准备下载 ${new Set(downloadTasks.map((t) => t.skinKey)).size} 款皮肤的战斗语音，共 ${downloadTasks.length} 个文件任务...`);

  // 2. 并发下载
  const concurrency = 16;
  let done = 0;
  let skipped = 0;
  let downloaded = 0;
  let failed = 0;

  async function worker(items) {
    for (const item of items) {
      if (fs.existsSync(item.dest) && fs.statSync(item.dest).size > 500) {
        skipped++;
        done++;
        continue;
      }
      try {
        const res = await downloadFile(item.url, item.dest);
        if (res === false) failed++;
        else downloaded++;
      } catch (err) {
        failed++;
      }
      done++;
      if (done % 20 === 0 || done === downloadTasks.length) {
        process.stdout.write(`进度: ${done}/${downloadTasks.length} (新下载: ${downloaded}, 跳过已存在: ${skipped}, 缺漏: ${failed})\r`);
      }
    }
  }

  const chunks = Array.from({ length: concurrency }, () => []);
  downloadTasks.forEach((task, idx) => chunks[idx % concurrency].push(task));
  await Promise.all(chunks.map(worker));

  console.log(`\n下载完成！总计: ${done}, 新下: ${downloaded}, 已存在: ${skipped}, 不存在: ${failed}`);

  // 3. 只保留磁盘上真实存在的文件（404 的语种/槽位宁可缺席，也不要让 audio.js 去请求一个不存在的 URL）
  for (const lang of ['cn', 'jp', 'en', 'kr']) {
    for (const skinKey of Object.keys(skinVoiceMap[lang])) {
      for (const slot of Object.keys(skinVoiceMap[lang][skinKey])) {
        const arr = skinVoiceMap[lang][skinKey][slot]
          .filter((webPath) => fs.existsSync(path.join(ROOT, 'public', webPath)));
        if (!arr.length) { delete skinVoiceMap[lang][skinKey][slot]; continue; }
        if (arr.length === 1) skinVoiceMap[lang][skinKey][slot] = arr[0];
        else skinVoiceMap[lang][skinKey][slot] = arr;
      }
      if (!Object.keys(skinVoiceMap[lang][skinKey]).length) delete skinVoiceMap[lang][skinKey];
    }
  }

  // 保存中间映射产物
  const outPath = path.join(ROOT, 'data', 'skin-voices.json');
  fs.writeFileSync(outPath, JSON.stringify(skinVoiceMap, null, 2), 'utf8');
  console.log(`已生成皮肤专属语音映射表: ${outPath}`);
}

main().catch(console.error);
