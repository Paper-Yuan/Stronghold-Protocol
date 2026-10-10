// server/mod/packCache.js — server-side whole-pack disk cache (CF_MOD_TRI_PLAN.md §2-D1-6).
// Layout under server/.mod-cache/<packId>/:
//   pack.zip          the verbatim verified zip
//   sections/<n>.json one parsed JSON per CUSTOM_SECTIONS member
//   kits/<file>.js    kit source files (loaded only by C2-verified packs, D2 kitScope)
//   meta.json         { id, name, version, sha256, bytes, features, cachedAt }
// loadPackSections() is the single read path D2 consumes; its output shape matches the
// browser-side unpackModZip memory contract (§2-D1 cache-layering table).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unpackModZip } from '../../shared/modZip.js';

export function modCacheRoot(baseDir) {
  return path.join(baseDir || process.cwd(), 'server', '.mod-cache');
}

function packDir(cacheRoot, packId) {
  return path.join(cacheRoot, packId);
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
}

/**
 * Ensure a pack is cached on disk at the catalog sha256. Downloads only when the
 * cached meta is missing or stale. Fail-closed: a failed download/verification
 * removes any half-written directory and never replaces a good older cache.
 */
export async function ensurePackCached(entry, { cacheRoot, fetchImpl = fetch, log = () => {} } = {}) {
  const dir = packDir(cacheRoot, entry.id);
  const metaPath = path.join(dir, 'meta.json');
  const zipPath = path.join(dir, 'pack.zip');

  if (await exists(metaPath)) {
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
      if (meta.sha256 === entry.sha256 && await exists(zipPath)) return { dir, cached: false };
    } catch { /* fall through to re-download */ }
  }

  const tmp = dir + '--incoming';
  await rmrf(tmp);
  try {
    const resp = await fetchImpl(entry.url);
    if (!resp.ok) throw new Error(`下载 mod 包失败 ${entry.id}: HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length !== entry.bytes) throw new Error(`mod 包 ${entry.id} 字节数不符 (${buf.length} != ${entry.bytes})`);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== entry.sha256) throw new Error(`mod 包 ${entry.id} 校验失败: sha256 ${sha} != ${entry.sha256}`);

    const { meta, sections, kits, art } = await unpackModZip(new Uint8Array(buf));

    await fsp.mkdir(path.join(tmp, 'sections'), { recursive: true });
    await fsp.mkdir(path.join(tmp, 'kits'), { recursive: true });
    await fsp.writeFile(zipPath && path.join(tmp, 'pack.zip'), buf);
    for (const [section, json] of Object.entries(sections)) {
      await fsp.writeFile(path.join(tmp, 'sections', `${section}.json`), JSON.stringify(json));
    }
    for (const [name, src] of Object.entries(kits)) {
      await fsp.writeFile(path.join(tmp, 'kits', name), src);
    }
    for (const [rel, bytes] of Object.entries(art)) {
      const dest = path.join(tmp, 'art', rel);
      if (path.resolve(dest).startsWith(path.resolve(path.join(tmp, 'art')))) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, bytes);
      }
    }
    await fsp.writeFile(path.join(tmp, 'meta.json'), JSON.stringify({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      sha256: entry.sha256,
      bytes: entry.bytes,
      features: entry.features,
      cachedAt: Date.now(),
    }));

    // swap in atomically: only replace the good cache after the new one is fully written
    await rmrf(dir);
    await fsp.rename(tmp, dir);
    log(`[mod-cache] cached ${entry.id}@${entry.sha256.slice(0, 12)}`);
    return { dir, cached: true };
  } catch (err) {
    await rmrf(tmp); // never leave half-written state behind
    throw err;
  }
}

/**
 * The single read path for D2: same shape as the browser-side unpackModZip output
 * ({ meta, sections, kits, art }). kits are read as source strings and NOT executed
 * here — loading them is server/mod/kitScope.js's job (C2-verified packs only).
 */
export async function loadPackSections(cacheRoot, packId) {
  const dir = packDir(cacheRoot, packId);
  const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
  const sections = {};
  const sectionsDir = path.join(dir, 'sections');
  if (await exists(sectionsDir)) {
    for (const f of await fsp.readdir(sectionsDir)) {
      if (f.endsWith('.json')) {
        sections[f.slice(0, -5)] = JSON.parse(await fsp.readFile(path.join(sectionsDir, f), 'utf8'));
      }
    }
  }
  const kits = {};
  const kitsDir = path.join(dir, 'kits');
  if (await exists(kitsDir)) {
    for (const f of await fsp.readdir(kitsDir)) {
      if (f.endsWith('.js')) kits[f] = await fsp.readFile(path.join(kitsDir, f), 'utf8');
    }
  }
  const art = {};
  const artDir = path.join(dir, 'art');
  if (await exists(artDir)) {
    const walk = async (d, prefix) => {
      for (const e of await fsp.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p, prefix ? `${prefix}/${e.name}` : e.name);
        else art[prefix ? `${prefix}/${e.name}` : e.name] = new Uint8Array(await fsp.readFile(p));
      }
    };
    await walk(artDir, '');
  }
  return { meta, sections, kits, art };
}

/** Freshness probe without downloading. */
export async function hasFreshCache(cacheRoot, entry) {
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(packDir(cacheRoot, entry.id), 'meta.json'), 'utf8'));
    return meta.sha256 === entry.sha256;
  } catch { return false; }
}
