#!/usr/bin/env node
// tools/sync-voices-manifest.mjs — Verify or synchronize public/assets/audio/voice/*.mp3 with data/assets.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const MANIFEST_PATH = path.join(ROOT, 'data', 'assets.json');

/**
 * Read-only check: verify that all disk voice mp3 files are mapped in data/assets.json.
 * Does NOT touch or write any files.
 * @returns {{ ok: boolean, diskCount: number, manifestCount: number, missing: string[] }}
 */
export function verifyVoicesManifest() {
  if (!fs.existsSync(VOICE_DIR) || !fs.existsSync(MANIFEST_PATH)) {
    return { ok: true, diskCount: 0, manifestCount: 0, missing: [] };
  }

  const diskFiles = fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.mp3')).sort();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const voiceMap = manifest?.audio?.voice || {};

  const missing = [];
  for (const f of diskFiles) {
    const charId = path.basename(f, '.mp3');
    if (!voiceMap[charId]) {
      missing.push(charId);
    }
  }

  return {
    ok: missing.length === 0,
    diskCount: diskFiles.length,
    manifestCount: Object.keys(voiceMap).length,
    missing,
  };
}

/**
 * Explicit sync: update data/assets.json with disk voice entries.
 * Must only be called intentionally (e.g. CLI with --write).
 * @returns {{ count: number, path: string }}
 */
export function syncVoicesManifest() {
  if (!fs.existsSync(VOICE_DIR) || !fs.existsSync(MANIFEST_PATH)) {
    return { count: 0, path: MANIFEST_PATH };
  }

  const diskFiles = fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.mp3')).sort();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  if (!manifest.audio) manifest.audio = {};
  if (!manifest.audio.voice) manifest.audio.voice = {};

  let count = 0;
  for (const f of diskFiles) {
    const charId = path.basename(f, '.mp3');
    const relPath = `/assets/audio/voice/${f}`;
    manifest.audio.voice[charId] = relPath;
    const m = charId.match(/^(.+)_s(\d+)$/);
    if (m) {
      manifest.audio.voice[`${m[1]}:s${m[2]}`] = relPath;
    }
    if (manifest.chars && manifest.chars[charId]) {
      manifest.chars[charId].voice = relPath;
    }
    count++;
  }

  // Preserve compact JSON formatting
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');
  console.log(`[sync-voices-manifest] 已将 ${count} 条语音清单显式同步至 ${MANIFEST_PATH}`);
  return { count, path: MANIFEST_PATH };
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isWrite = process.argv.includes('--write');
  if (isWrite) {
    syncVoicesManifest();
  } else {
    const res = verifyVoicesManifest();
    if (!res.ok) {
      console.error(`✘ [sync-voices-manifest] 校验失败: 发现 ${res.missing.length} 个本地语音未在 data/assets.json 中注册:`);
      console.error(`  缺少: ${res.missing.slice(0, 5).join(', ')}${res.missing.length > 5 ? '...' : ''}`);
      console.error(`  如需同步写入，请运行: node tools/sync-voices-manifest.mjs --write`);
      process.exit(1);
    } else {
      console.log(`✔ [sync-voices-manifest] 语音资产清单校验通过 (磁盘: ${res.diskCount} 条, 清单: ${res.manifestCount} 条)`);
    }
  }
}
