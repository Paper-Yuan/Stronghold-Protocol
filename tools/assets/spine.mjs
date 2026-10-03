// Spine model pipeline: download skel/atlas/page PNGs, fetch extra atlas pages,
// normalize atlases (size:/pma:), parse skeletons and resolve animation roles.
// Produces the per-model `spine` entries of data/assets.json.
//
// Enemy models that no dump carries but the local client has (tools/local-extract/
// extract.py ENEMY_SPINES → public/assets/local/spine/enemy/<id>/, optional and
// git-ignored) are an overlay, never the manifest's `spine`: their metadata lives
// in the committed tools/assets/local-enemy-spines.json (loadLocalEnemySpines),
// refreshed from the extracted files by `fetch-assets --local-spines`
// (findLocalEnemyModels + localEnemySpineMeta, read only), so data/assets.json
// is the same with or without the extraction (ASSETS.md "Enemy aliases").

import { readFile, readdir, writeFile, stat, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assetUrl, safeName, urlDir } from './sources.mjs';
import { kindOf, pngSize } from './formats.mjs';
import { atlasInfo, normalizeAtlas } from './atlas.mjs';
import { parseSkel } from './skel.mjs';
import { resolveRoles } from './anim-roles.mjs';

async function fileStat(p) { try { const s = await stat(p); return s.isFile() ? s : null; } catch { return null; } }

/** Where tools/local-extract/extract.py writes enemy Spine models, under public/assets. */
export const LOCAL_ENEMY_SPINE_DIR = 'local/spine/enemy/';
/** Its data/local-assets.json group of an enemy (`spine/enemy/<id>`; the client resolves the file names through it). */
export const localEnemySpineGroup = (id) => `spine/enemy/${id}`;

/**
 * Enemy Spine models extracted from the local client (tools/local-extract/extract.py ENEMY_SPINES): every
 * `local/spine/enemy/<enemyId>/` holding a skeleton, the atlas of the same stem and at least one page PNG.
 * @param {string} root absolute public/assets directory
 * @returns {Promise<Record<string, { dir: string, skel: string, atlas: string, pngs: string[] }>>} paths relative to root
 */
export async function findLocalEnemyModels(root) {
  const out = {};
  let ids = [];
  try { ids = (await readdir(join(root, LOCAL_ENEMY_SPINE_DIR), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const id of ids.sort()) {
    if (!/^enemy_\d+_[a-z0-9_]+$/i.test(id)) continue;
    const dir = `${LOCAL_ENEMY_SPINE_DIR}${id}/`;
    let files = [];
    try { files = (await readdir(join(root, dir))).sort(); } catch { continue; }
    const skel = files.find((f) => f.endsWith('.skel'));
    const stem = skel ? skel.slice(0, -'.skel'.length) : null;
    const pngs = files.filter((f) => f.endsWith('.png'));
    if (!stem || !files.includes(`${stem}.atlas`) || !pngs.length) continue;
    out[id] = { dir, skel: dir + skel, atlas: `${dir}${stem}.atlas`, pngs: pngs.map((f) => dir + f) };
  }
  return out;
}

/**
 * @typedef {{ skel: string, atlas: string, textures: string[], pma: boolean, anims: any, animations: Record<string, number>,
 *   events: string[], hits: Record<string, number[]>, bounds: any }} LocalSpineMeta file names relative to the model's
 *   data/local-assets.json group (localEnemySpineGroup), the rest as a manifest SpineEntry
 */

/**
 * Spine metadata of the extracted enemy models (findLocalEnemyModels), parsed like processModels does — but read only:
 * the atlas is sized / pma-normalized in memory (extract.py already writes it so), nothing on disk changes.
 * @param {string} root absolute public/assets directory
 * @param {Record<string, { dir: string, skel: string, atlas: string, pngs: string[] }>} found
 * @returns {Promise<{ meta: Record<string, LocalSpineMeta>, problems: string[] }>}
 */
export async function localEnemySpineMeta(root, found) {
  const meta = {};
  const problems = [];
  const base = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
  for (const id of Object.keys(found || {}).sort()) {
    const m = found[id];
    try {
      const text = await readFile(join(root, m.atlas), 'utf8');
      const sizes = new Map();
      for (const page of atlasInfo(text).pages) {
        const sz = pngSize(await readFile(join(root, m.dir + page)));
        if (!sz) throw new Error(`invalid page ${page}`);
        sizes.set(page, sz);
      }
      const norm = normalizeAtlas(text, { pageSize: (p) => sizes.get(p) || null, pma: true });
      if (norm.missingSize.length) throw new Error(`cannot size pages ${norm.missingSize.join(',')}`);
      const info = atlasInfo(norm.text);
      if (!info.pages.length) throw new Error('atlas without pages');
      const sk = parseSkel(await readFile(join(root, m.skel)), info.regions);
      if (!sk.animations.length) throw new Error('skeleton has no animations');
      if (sk.missingRegions?.length) problems.push(`${id}: ${sk.missingRegions.length} attachment(s) not in atlas (e.g. ${sk.missingRegions[0]})`);
      meta[id] = {
        skel: base(m.skel), atlas: base(m.atlas), textures: info.pages, pma: true,
        anims: resolveRoles(sk.animations, { skillIndices: [0], durations: sk.durations }),
        animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds,
      };
    } catch (e) {
      problems.push(`${id}: ${e.message}`);
    }
  }
  return { meta, problems };
}

/** Committed metadata of the local-client enemy models: tools/assets/local-enemy-spines.json. */
export const LOCAL_ENEMY_SPINES_FILE = 'tools/assets/local-enemy-spines.json';

/**
 * The `models` of tools/assets/local-enemy-spines.json (enemyId → LocalSpineMeta); {} when the file is missing or bad.
 * @param {string} path absolute path of the file
 * @returns {Promise<Record<string, LocalSpineMeta>>}
 */
export async function loadLocalEnemySpines(path) {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    return j && typeof j.models === 'object' && j.models && !Array.isArray(j.models) ? j.models : {};
  } catch { return {}; }
}

/**
 * @typedef {{ skel: string, atlas: string, textures: string[], pma: boolean, anims: any,
 *   animations: Record<string, number>, events: string[], hits: Record<string, number[]>, bounds: any }} SpineEntry
 */

/**
 * Run the whole Spine pipeline for every planned model.
 * @param {Map<string, any>} models plan.models
 * @param {object} o
 * @param {string} o.root absolute public/assets directory
 * @param {import('./downloader.mjs').Downloader} o.dl
 * @param {string} o.cachePath parse cache JSON path
 * @param {boolean} [o.download] false = only post-process what is on disk
 * @param {(m:string)=>void} [o.log]
 * @returns {Promise<{ entries: Map<string, SpineEntry>, problems: string[] }>}
 */
export async function processModels(models, { root, dl, cachePath, download = true, log = console.log }) {
  const problems = [];
  const list = [...models.values()];
  if (download) {
    const jobs = [];
    for (const m of list) jobs.push(m.skel, m.atlas, ...m.pngs);
    await dl.run(jobs, 'spine');
    // Atlases may reference more pages than the index lists.
    const extra = [];
    for (const m of list) {
      const text = await readFile(join(root, m.atlas.rel), 'utf8').catch(() => null);
      if (!text) continue;
      for (const page of atlasInfo(text).pages) {
        const rel = m.dir + safeName(page);
        if (!m.pngs.some((p) => p.rel === rel)) {
          // Same folder as the atlas actually came from (ledger), then the planned folders.
          const got = dl.ledger.files[m.atlas.rel]?.url;
          const dirs = [...new Set([got ? urlDir(got) : null, m.baseUrl, ...m.atlas.urls.map(urlDir)].filter(Boolean))];
          const a = { rel, urls: dirs.map((d) => d + encodeURIComponent(page)), kind: kindOf(page) };
          m.pngs.push(a);
          extra.push(a);
        }
      }
    }
    if (extra.length) await dl.run(extra, 'spine pages');
  }

  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')) || {}; } catch { cache = {}; }
  const nextCache = {};
  const entries = new Map();
  let parsed = 0; let cached = 0;
  let ledgerDirty = false;
  const t0 = Date.now();
  for (const m of list) {
    const skelAbs = join(root, m.skel.rel);
    const atlasAbs = join(root, m.atlas.rel);
    const skelSt = await fileStat(skelAbs);
    const atlasText = await readFile(atlasAbs, 'utf8').catch(() => null);
    if (!skelSt || !atlasText) { problems.push(`${m.key}: missing ${!skelSt ? 'skel' : 'atlas'}`); continue; }
    // Normalize the atlas against the real page sizes.
    const info0 = atlasInfo(atlasText);
    const sizes = new Map();
    let pagesOk = info0.pages.length > 0;
    for (const page of info0.pages) {
      const buf = await readFile(join(root, m.dir + safeName(page))).catch(() => null);
      const sz = buf ? pngSize(buf) : null;
      if (!sz) { pagesOk = false; problems.push(`${m.key}: missing/invalid page ${page}`); continue; }
      sizes.set(page, sz);
    }
    if (!pagesOk) continue;
    const norm = normalizeAtlas(atlasText, { pageSize: (p) => sizes.get(p) || null, pma: !!m.pma, renamePage: (p) => safeName(p) });
    if (norm.missingSize.length) { problems.push(`${m.key}: cannot size pages ${norm.missingSize.join(',')}`); continue; }
    if (norm.changed) {
      await writeFile(atlasAbs + '.tmp', norm.text);
      await rename(atlasAbs + '.tmp', atlasAbs);
    }
    const atlasSt = await fileStat(atlasAbs);
    const info = atlasInfo(norm.text);
    // Parse the skeleton (cached by file size + mtime).
    const ck = `${m.skel.rel}|${skelSt.size}|${Math.floor(skelSt.mtimeMs)}|${atlasSt?.size}|${Math.floor(atlasSt?.mtimeMs ?? 0)}`;
    let sk = cache[m.skel.rel]?.key === ck ? cache[m.skel.rel].info : null;
    if (sk) cached++;
    else {
      try {
        sk = parseSkel(await readFile(skelAbs), info.regions);
        parsed++;
      } catch (e) {
        // A corrupt skeleton would otherwise be kept forever (its size matches the ledger):
        // delete it and forget it so the next online run downloads it again.
        problems.push(`${m.key}: skel parse failed (${e.message}); deleted, re-run to re-download`);
        try { await unlink(skelAbs); } catch { /* ignore */ }
        if (dl?.ledger?.files) delete dl.ledger.files[m.skel.rel];
        ledgerDirty = true;
        continue;
      }
    }
    nextCache[m.skel.rel] = { key: ck, info: sk };
    if (sk.missingRegions?.length) problems.push(`${m.key}: ${sk.missingRegions.length} attachment(s) not in atlas (e.g. ${sk.missingRegions[0]})`);
    if (!sk.animations.length) { problems.push(`${m.key}: skeleton has no animations`); continue; }
    const anims = resolveRoles(sk.animations, { skillIndices: m.skillIndices, durations: sk.durations });
    entries.set(m.key, {
      skel: assetUrl(m.skel.rel),
      atlas: assetUrl(m.atlas.rel),
      textures: info.pages.map((p) => assetUrl(m.dir + p)),
      pma: !!m.pma,
      anims,
      animations: sk.durations,
      events: sk.events,
      hits: sk.hits,
      bounds: sk.bounds,
    });
    if (Date.now() - t0 > 0 && (parsed + cached) % 100 === 0) log(`[spine] processed ${parsed + cached}/${list.length}`);
  }
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(nextCache));
  if (ledgerDirty && dl?.saveLedger) { try { await dl.saveLedger(); } catch { /* next run re-validates */ } }
  log(`[spine] models ok=${entries.size}/${list.length} (parsed ${parsed}, cached ${cached})`);
  return { entries, problems };
}
