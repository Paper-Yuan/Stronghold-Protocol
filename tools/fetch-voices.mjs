import fs from 'fs';
import path from 'path';
import https from 'https';

const CACHE_FILE = '.cache/voice_plan.json';
const OUT_DIR = 'public/assets/audio/voice';

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.error('Plan file not found:', CACHE_FILE);
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const list = plan.ok || [];
  console.log(`Starting download for ${list.length} Japanese voice files...`);

  let completed = 0;
  let skipped = 0;
  let totalBytes = 0;
  const concurrency = 12;

  async function worker(items) {
    for (const item of items) {
      const dest = path.join(OUT_DIR, `${item.id}.mp3`);
      try {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
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
        console.error(`Failed ${item.id}:`, err.message);
      }
      if (completed % 10 === 0 || completed === list.length) {
        process.stdout.write(`Downloaded: ${completed}/${list.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)\r`);
      }
    }
  }

  // Split into chunks for concurrency
  const chunks = Array.from({ length: concurrency }, () => []);
  list.forEach((item, idx) => chunks[idx % concurrency].push(item));

  await Promise.all(chunks.map(worker));
  console.log(`\nDownload completed: ${completed} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total.`);

  // Update data/assets.json
  console.log('Updating data/assets.json...');
  const manifestPath = 'data/assets.json';
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  if (!manifest.audio.voice) {
    manifest.audio.voice = {};
  }
  
  for (const item of list) {
    const dest = path.join(OUT_DIR, `${item.id}.mp3`);
    if (fs.existsSync(dest)) {
      manifest.audio.voice[item.id] = `/assets/audio/voice/${item.id}.mp3`;
      if (manifest.chars[item.id]) {
        manifest.chars[item.id].voice = `/assets/audio/voice/${item.id}.mp3`;
      }
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log('Manifest updated with Japanese voice entries.');
}

main().catch(console.error);
