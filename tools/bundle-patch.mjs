#!/usr/bin/env node
// tools/bundle-patch.mjs — package lightweight code patch (server, shared, data, and public core) into dist/patch.zip

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PATCH_ZIP = path.join(DIST_DIR, 'patch.zip');
const STAGING_DIR = path.join(ROOT, '.cache', 'patch-bundle-staging');

console.log('[bundle-patch] Preparing lightweight hot update patch...');

if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

function copyRecursive(src, dest, filterFn) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      if (filterFn && !filterFn(srcPath)) continue;
      copyRecursive(srcPath, destPath, filterFn);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 1. Copy server, shared, and data
console.log('[bundle-patch] Copying server, shared, and data...');
copyRecursive(path.join(ROOT, 'server'), path.join(STAGING_DIR, 'server'));
copyRecursive(path.join(ROOT, 'shared'), path.join(STAGING_DIR, 'shared'));
copyRecursive(path.join(ROOT, 'data'), path.join(STAGING_DIR, 'data'));

// 2. Copy public (EXCLUDING heavy assets like audio, spine, char portraits which are already on client)
console.log('[bundle-patch] Copying public web core (js, css, html, config)...');
const publicPatchZip = path.join(ROOT, 'public', 'patch.zip');
if (fs.existsSync(publicPatchZip)) {
  fs.rmSync(publicPatchZip, { force: true });
}

copyRecursive(path.join(ROOT, 'public'), path.join(STAGING_DIR, 'public'), (srcPath) => {
  const norm = srcPath.replace(/\\/g, '/');
  if (norm.endsWith('.zip')) return false;
  // Exclude heavy media assets (audio, spine, char, voice)
  if (norm.includes('/assets/audio')) return false;
  if (norm.includes('/assets/spine')) return false;
  if (norm.includes('/assets/char')) return false;
  if (norm.includes('/assets/voice')) return false;
  return true;
});

// 3. Compress into dist/patch.zip using python
console.log(`[bundle-patch] Compressing into ${PATCH_ZIP}...`);
const pyScript = `
import zipfile, os, sys

staging = sys.argv[1]
target = sys.argv[2]

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, staging)
            z.write(full_path, rel_path)
print(f"Compressed {target} successfully.")
`;

const zipRes = spawnSync('python', ['-c', pyScript, STAGING_DIR, PATCH_ZIP], { stdio: 'inherit' });
if (zipRes.status !== 0) {
  console.error('[bundle-patch] Failed to compress patch archive');
  process.exit(1);
}

const stats = fs.statSync(PATCH_ZIP);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(PATCH_ZIP)).digest('hex');

// Also place a copy in public for direct static serving if needed
fs.copyFileSync(PATCH_ZIP, path.join(ROOT, 'public', 'patch.zip'));

console.log(`[bundle-patch] Patch generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`[bundle-patch] SHA256: ${sha256}`);
console.log('[bundle-patch] Done!');
