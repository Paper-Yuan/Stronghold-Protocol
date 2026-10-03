#!/usr/bin/env node
// tools/sync-voices-manifest.mjs — Scan public/assets/audio/voice/*.mp3 and derive audio.voice in data/assets.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const MANIFEST_PATH = path.join(ROOT, 'data', 'assets.json');

export function syncVoicesManifest() {
  if (!fs.existsSync(VOICE_DIR) || !fs.existsSync(MANIFEST_PATH)) {
    return { synced: 0, total: 0 };
  }

  const files = fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.mp3')).sort();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  if (!manifest.audio) manifest.audio = {};
  if (!manifest.audio.voice) manifest.audio.voice = {};

  let count = 0;
  for (const f of files) {
    const charId = path.basename(f, '.mp3');
    const relPath = `/assets/audio/voice/${f}`;
    manifest.audio.voice[charId] = relPath;
    if (manifest.chars && manifest.chars[charId]) {
      manifest.chars[charId].voice = relPath;
    }
    count++;
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');
  console.log(`[sync-voices-manifest] Synchronized ${count} voice entries into data/assets.json`);
  return { synced: count, total: files.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  syncVoicesManifest();
}
