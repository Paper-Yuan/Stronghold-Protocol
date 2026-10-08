import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const SKILL_DIR = path.join(PUBLIC, 'assets', 'skill');

fs.mkdirSync(SKILL_DIR, { recursive: true });

const backups = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'backups.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const pool = backups.diy?.ownedPool || [];

function downloadBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const proto = url.startsWith('https:') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location, timeoutMs).then(resolve);
      }
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Ensure it's not a small 404 HTML text (e.g. from jsDelivr 404 page)
        if (buf.length > 500 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
          resolve(buf);
        } else {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function downloadWithFallbacks(urls, targetPath) {
  for (const u of urls) {
    const buf = await downloadBuffer(u);
    if (buf && buf.length > 0) {
      fs.writeFileSync(targetPath, buf);
      return true;
    }
  }
  return false;
}

async function main() {
  console.log('Collecting all unique skills...');
  const allSkills = new Map();
  for (const charId of pool) {
    const unit = backups.units?.[charId];
    if (!unit || !unit.forms) continue;
    for (const formKey of Object.keys(unit.forms)) {
      const f = unit.forms[formKey];
      if (!f || !f.skills) continue;
      for (const s of f.skills) {
        const skillId = s.skillId;
        const iconId = s.iconId || s.prefabId || skillId;
        if (!allSkills.has(skillId)) {
          allSkills.set(skillId, { charId, skillId, iconId, name: s.name });
        }
      }
    }
  }

  const skillsList = Array.from(allSkills.values());
  console.log(`Found ${skillsList.length} unique skills. Starting download...`);

  let downloaded = 0;
  let reused = 0;

  for (let i = 0; i < skillsList.length; i += 10) {
    const batch = skillsList.slice(i, i + 10);
    await Promise.all(batch.map(async (sk) => {
      const targetFile1 = path.join(SKILL_DIR, `${sk.iconId}.png`);
      const targetFile2 = path.join(SKILL_DIR, `${sk.skillId}.png`);

      const urls = [
        `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/skill/skill_icon_${encodeURIComponent(sk.iconId)}.png`,
        `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/skill/skill_icon_${encodeURIComponent(sk.skillId)}.png`,
        `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/skill/skill_icon_${encodeURIComponent(sk.iconId)}.png`,
        `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/skill/skill_icon_${encodeURIComponent(sk.skillId)}.png`,
        `https://ghfast.top/https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/skill/skill_icon_${encodeURIComponent(sk.iconId)}.png`,
        `https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/skill/skill_icon_${encodeURIComponent(sk.iconId)}.png`,
      ];

      const ok = await downloadWithFallbacks(urls, targetFile1);
      if (ok) {
        downloaded++;
        try { fs.copyFileSync(targetFile1, targetFile2); } catch {}
      } else {
        reused++;
      }

      if (!assets.skills) assets.skills = {};
      if (!assets.skillsById) assets.skillsById = {};
      assets.skills[sk.iconId] = `/assets/skill/${sk.iconId}.png`;
      assets.skills[sk.skillId] = `/assets/skill/${sk.skillId}.png`;
      assets.skillsById[sk.skillId] = sk.iconId;
    }));
    process.stdout.write(`\rProgress: ${Math.min(i + 10, skillsList.length)}/${skillsList.length}`);
  }

  console.log(`\nDownload completed. Downloaded: ${downloaded}, Fallback kept: ${reused}`);
  fs.writeFileSync(path.join(ROOT, 'data', 'assets.json'), JSON.stringify(assets, null, 2), 'utf8');
  console.log('assets.json updated successfully.');
}

main().catch(console.error);
