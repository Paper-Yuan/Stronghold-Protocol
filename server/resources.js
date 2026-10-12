// server/resources.js — the optional preload manifest (docs/ASSETS.md「Preload」).
//
// The client can preload every file a match may need into Cache Storage (Service Worker, public/js/resources/*), so
// entering a battle never waits on a download: the art comes from the browser cache.
// That list needs no extra build step: it is derived from the asset manifests this server already serves, and it is
// rewritten exactly like /data/assets.json (SP_ASSETS_CDN, docs/ASSETS.md「CDN」) — so the client preloads from the
// CDN. Local file sizes are added when this install has the files on disk (a CDN-only install simply omits them).
//
// Every entry carries a `hash`: the client stores the files under ONE cache name and replaces a file when its hash
// changes, so an asset update only re-downloads what really changed (docs/ASSETS.md「Preload」) instead of the whole
// ~310 MiB. Hashes come from the manifests themselves — `local-assets.json` entries (written by extract.py) and
// `asset-hashes.json` (tools/asset-hashes.mjs over public/assets + public/fonts). A file without one keeps the old
// set-level rule through a synthetic hash of its source stamp, so a manifest that predates hashing still invalidates.
//
// /data/resource-manifest.json:
//   { format: 1, version: '<digest of every url|hash>', count, tier1, sized, totalBytes,
//     files: [ { url, tier, size?, hash } … ] }   // sorted: essential tier first, then by URL

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export const RESOURCE_MANIFEST_FILE = 'resource-manifest.json';
/** Per-file content hashes of the fetched assets, written by tools/asset-hashes.mjs (optional). */
export const ASSET_HASHES_FILE = 'asset-hashes.json';
export const RESOURCES_FORMAT = 1;
/** A hash as the client accepts it (hex digests, the `syn-` fallback, a plain `sha1-…` label). */
export const HASH_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Short digest of anything — 12 hex characters is plenty to notice a changed file, and keeps the manifest small. */
export function shortHash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
}
/** A single cached file may never exceed this (a broken manifest cannot make a browser store something huge). */
export const MAX_FILE_BYTES = 24 * 1024 * 1024;
/** Essential: fonts, UI, icons, avatars, audio — what a screen needs in its first second. */
export const TIER_ESSENTIAL = 1;
/** The rest: portraits, Spine models, local-client board art — big, fetched in the background. */
export const TIER_REST = 2;

/** Extension → MIME type. Mirrored by the client (public/js/resources/common.js) for URL validation. */
export const RESOURCE_MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  atlas: 'text/plain; charset=utf-8',
  obj: 'text/plain; charset=utf-8',
  skel: 'application/octet-stream',
  bin: 'application/octet-stream',
});

/** MIME type of a resource URL, or null when the extension is not a resource type. */
export function resourceType(url) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(url || ''));
  return m ? RESOURCE_MIME[m[1].toLowerCase()] || null : null;
}

/** Whether a URL path is served from the asset trees the preload may cache. */
export function isResourcePath(pathname) {
  const p = String(pathname || '');
  if (p.startsWith('/build/')) return false;
  return /\/(?:assets|fonts)\//.test(p);
}

/**
 * Whether a manifest string is a file the client may request: a site path (`/assets/…`, `/fonts/…`) or an absolute
 * http(s) URL (the CDN shape), with a known resource extension and no query/control characters.
 */
export function validateResourceUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false;
  if (/[\s?#\\"'<>\u0000-\u001f]/.test(url)) return false;
  let pathname = url;
  if (!url.startsWith('/') || url.startsWith('//')) {
    if (!/^https?:\/\//i.test(url)) return false;
    try { pathname = new URL(url).pathname; } catch { return false; }
  }
  return isResourcePath(pathname) && !!resourceType(pathname);
}

const TIER_ESSENTIAL_SECTIONS = new Set(['ui', 'prof', 'bonds', 'items', 'bands', 'skills', 'audio', 'fonts']);

/**
 * Preload tier of a manifest entry, from its key path (`chars.char_002_amiya.spine.front.skel`). Operators, tokens and
 * enemies are split by role — their avatars/icons are essential, portraits and Spine models are the bulk; local-client
 * art is essential only for the board (`map`), and the 玩法说明 pages are background whatever screen they hang off.
 * Everything else in an unknown section defaults to the background tier: the fast path must stay fast even if the
 * manifest grows a new section.
 */
export function tierForPath(keyPath) {
  const p = String(keyPath || '');
  const head = p.split('.')[0];
  if (head === 'chars' || head === 'tokens' || head === 'enemies') return /(^|\.)(?:spine|portrait)/.test(p) ? TIER_REST : TIER_ESSENTIAL;
  if (head === 'local') return /(^|\.)map(\.|$)/.test(p) ? TIER_ESSENTIAL : TIER_REST;
  // The 19 玩法说明 pages (ui.guide/…) are full screenshots behind their own screen: the fast path is what a battle needs
  // in its first second. The battle emotes (ui.emoticon/…) are part of the match UI and stay essential with the rest of ui.
  if (/^ui\.guide(?:\/|\.|$)/.test(p)) return TIER_REST;
  return TIER_ESSENTIAL_SECTIONS.has(head) ? TIER_ESSENTIAL : TIER_REST;
}

/**
 * Every resource file of the asset manifests, deduplicated (a file keeps its lowest tier) and sorted essential-first.
 * `source` says which manifest listed it ('web' | 'local'): the fallback hash of an unhashed file depends on it, so a
 * regenerated local extraction cannot invalidate the fetched assets and vice versa.
 * @param {any} assets parsed data/assets.json (already CDN-rewritten)
 * @param {any} local parsed data/local-assets.json, optional
 * @returns {{ url: string, tier: number, source: 'web' | 'local' }[]}
 */
export function collectResourceFiles(assets, local) {
  /** @type {Map<string, { tier: number, source: 'web' | 'local' }>} */
  const byUrl = new Map();
  const walk = (node, keyPath, source) => {
    if (typeof node === 'string') {
      if (!validateResourceUrl(node)) return;
      const tier = tierForPath(keyPath);
      const prev = byUrl.get(node);
      if (prev == null || tier < prev.tier) byUrl.set(node, { tier, source });
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${keyPath}.${i}`, source);
      return;
    }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, keyPath ? `${keyPath}.${k}` : k, source);
  };
  for (const [k, v] of Object.entries(assets && typeof assets === 'object' ? assets : {})) {
    if (k === 'stats' || k === 'skillsById') continue; // counters / id maps: no files
    walk(v, k, 'web');
  }
  if (local && typeof local === 'object') walk(local, 'local', 'local');
  return [...byUrl]
    .map(([url, e]) => ({ url, tier: e.tier, source: e.source }))
    .sort((a, b) => a.tier - b.tier || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** Path part of a URL — the key real hashes are matched by (a CDN install rewrites the URLs, not the hash file). */
export function pathKey(url) {
  const s = String(url || '');
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try { return new URL(s).pathname; } catch { return s; }
}

/**
 * Content hashes known for this install, keyed by URL path: every `hash` of `data/local-assets.json`'s groups
 * (extract.py) plus `data/asset-hashes.json` (tools/asset-hashes.mjs over the fetched assets).
 * @param {any} localDoc parsed local-assets.json (may be CDN-rewritten)
 * @param {any} hashesDoc parsed asset-hashes.json, optional
 * @returns {Map<string, string>}
 */
export function collectRealHashes(localDoc, hashesDoc) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const put = (url, hash) => {
    if (typeof url === 'string' && validateResourceUrl(url) && typeof hash === 'string' && HASH_RE.test(hash)) map.set(pathKey(url), hash);
  };
  const groups = localDoc && typeof localDoc === 'object' ? localDoc.groups : null;
  if (groups && typeof groups === 'object') {
    for (const group of Object.values(groups)) {
      if (!group || typeof group !== 'object') continue;
      for (const entry of Object.values(group)) if (entry && typeof entry === 'object') put(entry.path, entry.hash);
    }
  }
  const files = hashesDoc && typeof hashesDoc === 'object' ? hashesDoc.files : null;
  if (files && typeof files === 'object') for (const [url, record] of Object.entries(files))
    put(url, typeof record === 'string' ? record : record?.hash);
  return map;
}

/**
 * The hash of every collected file: the real one when known, otherwise a synthetic value that reproduces the old rule
 * (any change to the source manifest's own hash/mtime invalidates everything of that source).
 * @param {{ url: string, source: string }[]} files
 * @param {Map<string, string>} real
 * @param {{ web: string, local: string }} stamps
 * @param {string} cdnBase serving prefix removed before looking up site-path hash keys
 * @returns {Map<string, string>}
 */
export function resolveHashes(files, real, stamps, cdnBase = '') {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const f of files) {
    const siteUrl = cdnBase && f.url.startsWith(cdnBase + '/') ? f.url.slice(cdnBase.length) : f.url;
    const known = real.get(pathKey(siteUrl)) || real.get(pathKey(f.url));
    out.set(f.url, typeof known === 'string' && known ? known : `syn-${shortHash(`${f.source}|${stamps[f.source] || ''}|${f.url}`)}`);
  }
  return out;
}

/**
 * The manifest body. `sizes` (URL → bytes) is optional: without it the client still preloads, it just reports progress
 * in files instead of bytes.
 */
export function buildResourceManifest({ files, sizes = null, version = 'none', hashes = null }) {
  let totalBytes = 0;
  let sized = 0;
  let tier1 = 0;
  const out = [];
  for (const f of files) {
    const size = sizes ? sizes.get(f.url) : undefined;
    const entry = { url: f.url, tier: f.tier };
    const hash = (hashes ? hashes.get(f.url) : f.hash) || null;
    if (hash) entry.hash = hash;
    if (Number.isSafeInteger(size) && size >= 0) {
      entry.size = size;
      totalBytes += size;
      sized++;
    }
    if (f.tier === TIER_ESSENTIAL) tier1++;
    out.push(entry);
  }
  return {
    format: RESOURCES_FORMAT,
    version: String(version),
    count: out.length,
    tier1,
    sized,
    totalBytes: sized ? totalBytes : null,
    files: out,
  };
}

/**
 * Absolute path of a resource URL inside this install, or null when the URL is not a site path / escapes publicDir.
 * A CDN URL maps back to the same tree (`https://cdn/assets/x.png` → `<publicDir>/assets/x.png`).
 */
export function localPathFor(url, publicDir, cdnBase = '') {
  let p = String(url || '');
  if (cdnBase && p.startsWith(cdnBase)) p = p.slice(cdnBase.length) || '/';
  if (!p.startsWith('/')) return null;
  const root = path.resolve(publicDir);
  const segments = p.slice(1).split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  const abs = path.join(root, ...segments);
  return abs.startsWith(root + path.sep) ? abs : null;
}

/**
 * The served resource manifest, built from the data directory and cached until one of its sources changes.
 * @param {{ dataDir: string, publicDir: string, cdnBase?: string, rewrite?: (v: any) => any,
 *           statFile?: (p: string) => Promise<{ isFile(): boolean, size: number }>, log?: any }} opts
 */
export function createResourceIndex({ dataDir, publicDir, cdnBase = '', rewrite = (v) => v, statFile = (p) => fsp.stat(p), log = null, frozenManifest = '' } = {}) {
  /** @type {{ key: string, body: Buffer, gzip: Buffer, etag: string, mtimeMs: number, manifest: any } | null} */
  let cache = null;

  async function readJson(name) {
    const file = path.join(dataDir, name);
    try {
      const stat = await statFile(file);
      if (!stat.isFile()) return null;
      return { doc: JSON.parse(await fsp.readFile(file, 'utf8')), mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
      throw e;
    }
  }

  /** File sizes of the files present on disk (bounded concurrency: ~4 000 stats of a real install). */
  async function measure(files) {
    const sizes = new Map();
    let next = 0;
    const lanes = Math.min(24, files.length);
    await Promise.all(Array.from({ length: lanes }, async () => {
      for (let i = next++; i < files.length; i = next++) {
        const abs = localPathFor(files[i].url, publicDir, cdnBase);
        if (!abs) continue;
        try {
          const stat = await statFile(abs);
          if (stat.isFile()) sizes.set(files[i].url, stat.size);
        } catch { /* not on disk (CDN-only install) — the client preloads it without a size */ }
      }
    }));
    return sizes;
  }

  async function build() {
    // A CDN-only deployment uses the exact inventory distributed in the local resource pack.
    // Do not infer missing sizes from an app checkout that intentionally excludes the artwork.
    if (frozenManifest) {
      let stat;
      try { stat = await statFile(frozenManifest); }
      catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
      if (stat?.isFile()) {
        const key = `frozen:${stat.mtimeMs}:${stat.size}`;
        if (cache?.key === key) return cache;
        const manifest = JSON.parse(await fsp.readFile(frozenManifest, 'utf8'));
        if (manifest.format !== RESOURCES_FORMAT || !Array.isArray(manifest.files) ||
            manifest.count !== manifest.files.length || manifest.sized !== manifest.count ||
            !manifest.files.every(f => validateResourceUrl(f.url) && /^[0-9a-f]{12}$/.test(f.hash) &&
              Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= MAX_FILE_BYTES && [1, 2].includes(f.tier)) ||
            new Set(manifest.files.map(f => f.url)).size !== manifest.count ||
            manifest.totalBytes !== manifest.files.reduce((n, f) => n + f.size, 0) ||
            manifest.tier1 !== manifest.files.filter(f => f.tier === 1).length ||
            manifest.version !== shortHash(['', ...manifest.files.map(f => `${f.url}|${f.hash}`)].join('\n')))
          throw new Error('Invalid frozen resource manifest');
        const body = Buffer.from(JSON.stringify(manifest));
        cache = { key, body, gzip: zlib.gzipSync(body),
          etag: `"resources-${crypto.createHash('sha256').update(body).digest('hex')}"`,
          mtimeMs: stat.mtimeMs, manifest };
        return cache;
      }
    }
    const assets = await readJson('assets.json');
    const local = await readJson('local-assets.json');
    const hashesDoc = await readJson(ASSET_HASHES_FILE);
    const key = [assets ? `${assets.mtimeMs}:${assets.size}` : '-', local ? `${local.mtimeMs}:${local.size}` : '-',
      hashesDoc ? `${hashesDoc.mtimeMs}:${hashesDoc.size}` : '-', cdnBase].join('|');
    if (cache && cache.key === key) return cache;
    const t0 = Date.now();
    const assetsDoc = assets ? rewrite(assets.doc) : null;
    const localDoc = local ? rewrite(local.doc) : null;
    const files = collectResourceFiles(assetsDoc, localDoc);
    // The full local bundle also has board metadata fetched directly by the renderer.
    // Its generated content inventory covers those files even when a UI manifest omits them.
    const listed = new Set(files.map(f => f.url));
    for (const url of Object.keys(hashesDoc?.doc?.files || {})) {
      if (!validateResourceUrl(url)) continue;
      const rewritten = rewrite(url);
      if (listed.has(rewritten)) continue;
      const tier = /^\/(?:fonts\/|assets\/(?:ui\/|audio\/|local\/map\/))/.test(url) ? TIER_ESSENTIAL : TIER_REST;
      files.push({ url: rewritten, tier, source: 'web' }); listed.add(rewritten);
    }
    files.sort((a,b) => a.tier - b.tier || a.url.localeCompare(b.url));
    const real = collectRealHashes(localDoc, hashesDoc ? hashesDoc.doc : null);
    const stamps = {
      web: assetsDoc && assetsDoc.hash ? assetsDoc.hash : assets ? `m${Math.floor(assets.mtimeMs)}` : 'none',
      local: localDoc && localDoc.hash ? localDoc.hash : local ? `l${Math.floor(local.mtimeMs)}` : 'none',
    };
    const fileHashes = resolveHashes(files, real, stamps, cdnBase);
    // The version is informational now (the client keys its cache per file), but it must still change whenever the set
    // or any hash does — the settings panel and the /healthz-style diagnostics read it.
    const version = shortHash([cdnBase, ...files.map((f) => `${f.url}|${fileHashes.get(f.url)}`)].join('\n'));
    const manifest = buildResourceManifest({ files, sizes: await measure(files), version, hashes: fileHashes });
    const body = Buffer.from(JSON.stringify(manifest));
    // Hash the complete response (including tiers and sizes), so unchanged rebuilds/restarts keep their validator.
    const etag = `"resources-${crypto.createHash('sha256').update(body).digest('hex')}"`;
    cache = { key, body, gzip: zlib.gzipSync(body), etag, mtimeMs: Date.now(), manifest };
    log?.info?.(`[resources] ${manifest.count} file(s), ${manifest.tier1} essential, ${manifest.sized} sized`
      + `${manifest.totalBytes ? `, ${(manifest.totalBytes / 1048576).toFixed(1)} MiB` : ''}, `
      + `${fileHashes.size ? [...fileHashes.values()].filter((h) => !h.startsWith('syn-')).length : 0} hashed`
      + `, version ${version} (${Date.now() - t0} ms)`);
    return cache;
  }

  return {
    /** @returns {Promise<{ body: Buffer, gzip: Buffer, etag: string, mtimeMs: number, manifest: any }>} */
    get: build,
    /** Drop the cache (tests). */
    reset() { cache = null; },
  };
}
