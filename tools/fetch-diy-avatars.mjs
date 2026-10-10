// tools/fetch-diy-avatars.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AVATAR_DIR = path.join(ROOT, 'public', 'assets', 'char', 'avatar');
const PORTRAIT_DIR = path.join(ROOT, 'public', 'assets', 'char', 'portrait');

fs.mkdirSync(AVATAR_DIR, { recursive: true });
fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

const backups = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'backups.json'), 'utf8'));
const pool = backups.diy?.ownedPool || [];

console.log(`[fetch-diy-avatars] 准备检查并下载 ${pool.length} 位自选干员头像与立绘...`);

const CDN_BASES = [
  'https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/',
  'https://fastly.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/',
  'https://ghfast.top/https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/',
];

async function downloadFile(relPath, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 100) {
    return true; // 已存在且有效
  }

  for (const base of CDN_BASES) {
    const url = base + relPath;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100) {
          fs.writeFileSync(destPath, buf);
          return true;
        }
      }
    } catch {
      // 切换下一个镜像
    }
  }
  return false;
}

async function run() {
  const tasks = [];
  for (const id of pool) {
    // 基础头像与精二头像
    tasks.push({ rel: `avatar/${id}.png`, dest: path.join(AVATAR_DIR, `${id}.png`), req: true });
    tasks.push({ rel: `avatar/${id}_2.png`, dest: path.join(AVATAR_DIR, `${id}_2.png`), req: false });
    // 基础半身立绘与精二半身立绘
    tasks.push({ rel: `portrait/${id}_1.png`, dest: path.join(PORTRAIT_DIR, `${id}_1.png`), req: true });
    tasks.push({ rel: `portrait/${id}_2.png`, dest: path.join(PORTRAIT_DIR, `${id}_2.png`), req: false });
  }

  console.log(`[fetch-diy-avatars] 总待核对文件数: ${tasks.length}`);
  let okCount = 0;
  let failCount = 0;

  // 16 并发批量下载
  const CONCURRENCY = 16;
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (task) => {
      const ok = await downloadFile(task.rel, task.dest);
      if (ok) {
        okCount++;
      } else if (task.req) {
        failCount++;
        console.warn(`[!] 必需资产获取失败: ${task.rel}`);
      }
    }));
    process.stdout.write(`\r进度: ${Math.min(i + CONCURRENCY, tasks.length)}/${tasks.length} (成功: ${okCount}, 失败: ${failCount})`);
  }
  console.log(`\n[fetch-diy-avatars] 完成! 成功获取: ${okCount}, 关键失败: ${failCount}`);
}

run().catch((err) => {
  console.error('[fetch-diy-avatars] 失败:', err);
  process.exit(1);
});
