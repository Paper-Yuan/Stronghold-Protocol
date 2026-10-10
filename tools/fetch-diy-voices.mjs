// tools/fetch-diy-voices.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_VOICE_BASE = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/';
const GH_PROXY = 'https://ghproxy.net/';
const VOICE_ROOT = path.join(ROOT, 'public', 'assets', 'audio', 'voice');

import { exec } from 'node:child_process';

function getGitOutput(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function main() {
  const assetsOut = await getGitOutput('git show 6499f4b3:data/assets.json');
  const up = JSON.parse(assetsOut);
  
  let backupsOut = await getGitOutput('git show upstream/master:data/backups.json');
  if (backupsOut.charCodeAt(0) === 0xFEFF) backupsOut = backupsOut.slice(1);
  const backups = JSON.parse(backupsOut);
  const owned = backups.diy ? backups.diy.ownedPool : [];

  const tasks = [];
  for (const charId of owned) {
    const slots = up.audio?.voice?.[charId] || {};
    for (const [slot, val] of Object.entries(slots)) {
      const urls = Array.isArray(val) ? val : [val];
      for (const u of urls) {
        const parts = u.replace('/assets/audio/voice/', '').split('/');
        const lang = parts[0];
        const char = parts[1];
        const file = parts[2];
        const remoteDir = lang === 'cn' ? 'voice_cn' : 'voice';
        const remoteUrl = `${RAW_VOICE_BASE}${remoteDir}/${char}/${file}`;
        const proxyUrl = `${GH_PROXY}${remoteUrl}`;
        const localDest = path.join(VOICE_ROOT, lang, char, file);

        tasks.push({
          charId,
          lang,
          dest: localDest,
          urls: [proxyUrl, remoteUrl],
        });
      }
    }
  }

  console.log(`[voice-fetch] 准备下载 71 位自选干员语音，总任务数: ${tasks.length}`);

  let skipped = 0;
  let downloaded = 0;
  let failed = 0;
  const toDownload = [];

  for (const t of tasks) {
    if (fs.existsSync(t.dest) && fs.statSync(t.dest).size > 1000) {
      skipped++;
    } else {
      toDownload.push(t);
    }
  }

  console.log(`[voice-fetch] 已存在: ${skipped}, 待下载: ${toDownload.length}`);

  async function downloadOne(t) {
    const parent = path.dirname(t.dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

    for (const url of t.urls) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Stronghold-Sync/1.0' } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 500) {
            fs.writeFileSync(t.dest, buf);
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  const CONCURRENCY = 16;
  let index = 0;
  async function worker() {
    while (index < toDownload.length) {
      const item = toDownload[index++];
      const ok = await downloadOne(item);
      if (ok) downloaded++;
      else failed++;
      if ((downloaded + failed) % 100 === 0 || (downloaded + failed) === toDownload.length) {
        console.log(`[voice-fetch] 进度: ${downloaded + failed}/${toDownload.length} (成功: ${downloaded}, 失败: ${failed})`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`[voice-fetch] 完成! 成功: ${downloaded}, 已存在: ${skipped}, 失败: ${failed}`);
}

main().catch(console.error);
