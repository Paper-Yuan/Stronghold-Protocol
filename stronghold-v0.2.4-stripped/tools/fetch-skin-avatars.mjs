// tools/fetch-skin-avatars.mjs — 离线下载全量 174 款皮肤头像并内置到本地
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH_PATH = path.join(ROOT, 'docs', 'research', '08-skins.json');
const TARGET_DIR = path.join(ROOT, 'public', 'assets', 'char', 'skin_avatar');

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const research = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));

// 收集需要下载的皮肤头像任务
const tasks = [];
for (const [charId, skinList] of Object.entries(research.skins || {})) {
  for (const s of skinList) {
    const stem = s.stem;
    const dest = path.join(TARGET_DIR, `${stem}.png`);
    // 构造镜像源：jsdelivr 极速镜像优先，raw.github 作为 fallback
    const rawUrl = s.avatar?.url || '';
    const encodedFilename = rawUrl.split('/').pop() || '';
    const jsdelivrUrl = `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/avatar/${encodedFilename}`;
    tasks.push({
      charId,
      skinId: s.skinId,
      stem,
      dest,
      urls: [jsdelivrUrl, rawUrl].filter(Boolean),
    });
  }
}

console.log(`[skin-avatars] 待检查/下载头像任务总数: ${tasks.length}`);

async function downloadOne(task) {
  if (fs.existsSync(task.dest) && fs.statSync(task.dest).size > 1000) {
    return { status: 'skipped', stem: task.stem };
  }

  for (const url of task.urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Stronghold-Assets-Sync/1.0' } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) {
          fs.writeFileSync(task.dest, buf);
          return { status: 'downloaded', stem: task.stem, size: buf.length };
        }
      }
    } catch {
      // 尝试下一个 URL
    }
  }
  return { status: 'failed', stem: task.stem };
}

async function run() {
  const CONCURRENCY = 10;
  let cursor = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      const task = tasks[idx];
      const res = await downloadOne(task);
      if (res.status === 'downloaded') downloaded++;
      else if (res.status === 'skipped') skipped++;
      else failed++;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`[skin-avatars] 完成: 新下载 ${downloaded}, 已存在 ${skipped}, 失败 ${failed}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
