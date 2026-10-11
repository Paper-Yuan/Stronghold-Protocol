#!/usr/bin/env node
// tools/sync-voices-manifest.mjs — Verify or synchronize public/assets/audio/voice/ with data/assets.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'voice');
const MANIFEST_PATH = path.join(ROOT, 'data', 'assets.json');
const CACHE_STRUCTURE = path.join(ROOT, '.cache', 'bilingual_voice_structure.json');

/**
 * Collect all relative mp3 paths under a directory recursively.
 */
function walkMp3(dir, base = '') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const full = path.join(dir, item);
    const rel = base ? `${base}/${item}` : item;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(walkMp3(full, rel));
    } else if (item.endsWith('.mp3')) {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * Read-only check: verify that all disk voice mp3 files are mapped in data/assets.json.
 * Does NOT touch or write any files.
 * @returns {{ ok: boolean, diskCount: number, manifestCount: number, missing: string[] }}
 */
export function verifyVoicesManifest() {
  if (!fs.existsSync(VOICE_DIR) || !fs.existsSync(MANIFEST_PATH)) {
    return { ok: true, diskCount: 0, manifestCount: 0, missing: [] };
  }

  const diskFiles = walkMp3(VOICE_DIR);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const voice = manifest?.audio?.voice || {};

  // Build a set of all URLs registered in manifest
  const manifestUrls = new Set();
  function collectUrls(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const val of Object.values(obj)) {
      if (typeof val === 'string') {
        manifestUrls.add(val);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string') manifestUrls.add(item);
        }
      } else if (typeof val === 'object') {
        collectUrls(val);
      }
    }
  }
  collectUrls(voice);

  const missing = [];
  for (const rel of diskFiles) {
    const expectedUrl = `/assets/audio/voice/${rel}`;
    // If it's a flat top-level file (e.g. char_xxx.mp3 from earlier single-voice version)
    // or under jp/cn, check if manifest has it
    if (!manifestUrls.has(expectedUrl)) {
      // Also check flat char mapping compatibility
      const baseName = path.basename(rel, '.mp3');
      if (!voice[baseName]) {
        missing.push(rel);
      }
    }
  }

  return {
    ok: missing.length === 0,
    diskCount: diskFiles.length,
    manifestCount: manifestUrls.size,
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

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.audio) manifest.audio = {};

  let structure = null;
  if (fs.existsSync(CACHE_STRUCTURE)) {
    try {
      structure = JSON.parse(fs.readFileSync(CACHE_STRUCTURE, 'utf8'));
    } catch {}
  }

  let count = 0;
  if (structure && (structure.jp || structure.cn)) {
    manifest.audio.voice = {
      jp: structure.jp || {},
      cn: structure.cn || {},
    };

    // Calculate count
    for (const lang of ['jp', 'cn']) {
      for (const charId of Object.keys(manifest.audio.voice[lang] || {})) {
        const slots = manifest.audio.voice[lang][charId];
        for (const v of Object.values(slots)) {
          count += Array.isArray(v) ? v.length : 1;
        }
        // Also provide primary entry in manifest.chars for backwards compatibility
        if (lang === 'jp' && manifest.chars && manifest.chars[charId]) {
          const primary = slots.place || slots.start || slots.skill1;
          const primaryUrl = Array.isArray(primary) ? primary[0] : primary;
          if (primaryUrl) manifest.chars[charId].voice = primaryUrl;
        }
      }
    }
  } else {
    // Fallback: flat or directory scanning
    if (!manifest.audio.voice) manifest.audio.voice = {};
    const diskFiles = walkMp3(VOICE_DIR);
    for (const rel of diskFiles) {
      const relPath = `/assets/audio/voice/${rel}`;
      manifest.audio.voice[rel] = relPath;
      count++;
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');
  console.log(`[sync-voices-manifest] 已将 ${count} 条双语语音清单写入 ${MANIFEST_PATH}`);
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
