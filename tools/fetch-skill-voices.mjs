import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_FILE = path.join(ROOT, '.cache', 'skill_voice_download_plan.json');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const MANIFEST_PATH = path.join(ROOT, 'data', 'assets.json');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function download(url, dest, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      https.get(url, (res) => {
        if (res.statusCode === 200) {
          const stream = fs.createWriteStream(dest);
          res.pipe(stream);
          stream.on('finish', () => stream.close(resolve));
          stream.on('error', (err) => {
            fs.unlink(dest, () => {});
            if (left > 0) setTimeout(() => attempt(left - 1), 500);
            else reject(err);
          });
        } else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, dest, left).then(resolve, reject);
        } else {
          res.resume();
          if (left > 0 && res.statusCode >= 500) {
            setTimeout(() => attempt(left - 1), 800);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        }
      }).on('error', (err) => {
        if (left > 0) setTimeout(() => attempt(left - 1), 800);
        else reject(err);
      });
    };
    attempt(retries);
  });
}

async function main() {
  if (!fs.existsSync(PLAN_FILE)) {
    console.error('[fetch-skill-voices] 未找到下载计划文件:', PLAN_FILE);
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  console.log(`[fetch-skill-voices] 开始抓取 ${plan.length} 条干员技能官方台词 (S1/S2/S3)...`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  const failedList = [];
  const concurrency = 16;

  async function worker(items) {
    for (const item of items) {
      const dest = path.join(OUT_DIR, item.file);
      try {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 500) {
          skipped++;
          completed++;
          totalBytes += fs.statSync(dest).size;
          continue;
        }
        await download(item.url, dest);
        const sz = fs.statSync(dest).size;
        totalBytes += sz;
        completed++;
      } catch (err) {
        failed++;
        failedList.push({ id: item.charId, slot: item.slot, err: err.message });
      }
      if (completed % 15 === 0 || completed === plan.length) {
        process.stdout.write(`进度: ${completed}/${plan.length} (跳过: ${skipped}, 失败: ${failed}, 累计: ${(totalBytes / 1024 / 1024).toFixed(2)} MB)\r`);
      }
    }
  }

  const chunks = Array.from({ length: concurrency }, () => []);
  plan.forEach((item, idx) => chunks[idx % concurrency].push(item));

  await Promise.all(chunks.map(worker));
  console.log(`\n✔ 抓取完成: 成功 ${completed - skipped} 个, 已有跳过 ${skipped} 个, 失败 ${failed} 个, 总体积: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (failedList.length > 0) {
    console.warn(`[fetch-skill-voices] 警告: ${failedList.length} 条音频未能下载 (可能该干员无对应槽位台词):`);
    console.warn(failedList.slice(0, 5));
  }

  // 同步写入 data/assets.json
  console.log('[fetch-skill-voices] 正在同步技能台词清单至 data/assets.json...');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.audio) manifest.audio = {};
  if (!manifest.audio.voice) manifest.audio.voice = {};

  let registered = 0;
  for (const item of plan) {
    const dest = path.join(OUT_DIR, item.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) {
      const relPath = `/assets/audio/voice/${item.file}`;
      manifest.audio.voice[`${item.charId}:${item.slot}`] = relPath;
      registered++;
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');
  console.log(`✔ 清单已更新: 成功注册 ${registered} 条技能台词至 data/assets.json`);
}

main().catch(console.error);
