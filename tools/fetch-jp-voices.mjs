import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const JP_VOICE_ROOT = path.join(PUBLIC, 'assets', 'audio', 'voice', 'jp');

const backups = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'backups.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const pool = backups.diy?.ownedPool || [];

function downloadBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location, timeoutMs).then(resolve);
      }
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(buf.length > 500 ? buf : null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function downloadWithFallbacks(urls, targetPath) {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 500) {
    return true;
  }
  for (const u of urls) {
    const buf = await downloadBuffer(u);
    if (buf && buf.length > 0) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buf);
      return true;
    }
  }
  return false;
}

async function main() {
  console.log(`Starting JP voice download for ${pool.length} pool operators...`);
  let totalTasks = 0;
  let downloadedCount = 0;
  let skippedCount = 0;

  const downloadJobs = [];

  for (const charId of pool) {
    const opVoice = assets.audio?.voice?.[charId];
    if (!opVoice) continue;

    for (const [slot, val] of Object.entries(opVoice)) {
      const urls = Array.isArray(val) ? val : [val];
      for (const itemUrl of urls) {
        if (typeof itemUrl !== 'string') continue;
        const fileName = path.basename(itemUrl); // e.g. cn_019.mp3
        const targetPath = path.join(JP_VOICE_ROOT, charId, fileName);
        
        const remoteUrls = [
          `https://ghfast.top/https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/voice/${charId}/${fileName}`,
          `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/voice/${charId}/${fileName}`,
        ];

        downloadJobs.push({ charId, fileName, targetPath, remoteUrls, slot });
      }
    }
  }

  totalTasks = downloadJobs.length;
  console.log(`Total voice lines to check/download: ${totalTasks}`);

  // Download in batches of 16
  const concurrency = 16;
  for (let i = 0; i < downloadJobs.length; i += concurrency) {
    const batch = downloadJobs.slice(i, i + concurrency);
    await Promise.all(batch.map(async (job) => {
      const ok = await downloadWithFallbacks(job.remoteUrls, job.targetPath);
      if (ok) downloadedCount++;
      else {
        // Fallback: if JP voice missing upstream, copy CN voice so there is never silence
        const cnPath = path.join(PUBLIC, 'assets', 'audio', 'voice', 'cn', job.charId, job.fileName);
        if (fs.existsSync(cnPath)) {
          fs.mkdirSync(path.dirname(job.targetPath), { recursive: true });
          fs.copyFileSync(cnPath, job.targetPath);
          skippedCount++;
        }
      }
    }));
    process.stdout.write(`\rProgress: ${Math.min(i + concurrency, totalTasks)}/${totalTasks}`);
  }

  console.log(`\nDownload complete! Downloaded: ${downloadedCount}, CN fallback: ${skippedCount}`);

  // Update assets.json so voice paths for these operators point to /assets/audio/voice/jp/
  for (const charId of pool) {
    const opVoice = assets.audio?.voice?.[charId];
    if (!opVoice) continue;
    const newOpVoice = {};
    for (const [slot, val] of Object.entries(opVoice)) {
      if (Array.isArray(val)) {
        newOpVoice[slot] = val.map((u) => u.replace('/voice/cn/', '/voice/jp/'));
      } else if (typeof val === 'string') {
        newOpVoice[slot] = val.replace('/voice/cn/', '/voice/jp/');
      } else {
        newOpVoice[slot] = val;
      }
    }
    assets.audio.voice[charId] = newOpVoice;
  }

  fs.writeFileSync(path.join(ROOT, 'data', 'assets.json'), JSON.stringify(assets, null, 2), 'utf8');
  console.log('assets.json updated with JP voice paths successfully!');
}

main().catch(console.error);
