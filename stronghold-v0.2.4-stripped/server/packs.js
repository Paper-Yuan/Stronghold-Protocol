// server/packs.js — this server's content packs (docs/PACKS.md; the format: shared/packs.js). Discovers
//
//   * folder packs: packs/<id>/pack.json + the files its manifest names (any type);
//   * single-file language packs: public/i18n/<code>.json (manifest: its `_meta`) + data/i18n/<code>.json when present;
//
// validates them, and answers the pack index (GET /packs/index.json, server/http/static.js) and which pack files may be
// served (GET /packs/<id>/<file>: only a file that the manifest of a supported folder pack names, with its role's
// extension, inside the pack folder — nothing else there, ever; a single-file pack's files are the language folders' own,
// /i18n/ and /data/i18n/). The folders are re-read when something in them changes (checked when the index or a pack
// file is asked for, at most once a second: a few stat calls), so a language pack dropped in shows on the next page
// load — no restart, no build step. A pack of a planned type, a broken manifest, a second pack with the same id or
// language: reported (`skipped`: the start log, `node tools/packs.mjs list`), never served.
//
// Extension point (docs/PACKS.md "Adding a pack type"): a new type gets its PACK_TYPES entry (shared/packs.js) and a
// loader that reads `list(type)` — a client-side type through the index, a server-side one (type "data") once at start
// (`live: false`: the simulation's data is fixed for the life of the process).

import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../shared/constants.js';
import { PACK_TYPES, PACK_MANIFEST, PACKS_URL, normalizeManifest, packIndexEntry, buildPackIndex } from '../shared/packs.js';
import { SOURCE_LANG, isLangCode, countStrings } from '../shared/i18nPacks.js';

/** The language folders' subdirectory (public/i18n/, data/i18n/). */
export const LANG_DIR = 'i18n';
/** Largest manifest / UI file read (bytes): a pack file is small text. */
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const noop = () => {};

/**
 * @typedef {{ rel: string, abs: string, url: string }} PackFile
 * @typedef {{ id: string, type: string, layout: 'file' | 'folder', where: string, supported: boolean,
 *   manifest: import('../shared/packs.js').PackManifest, files: Record<string, PackFile>, strings?: number }} Pack
 * @typedef {{ where: string, problems: string[] }} Skipped
 */

const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
const readDirSorted = (dir) => { try { return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort(); } catch { return []; } };

/** A JSON file of at most MAX_JSON_BYTES, or { error }. */
function readJson(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return { error: 'not a file' };
    if (st.size > MAX_JSON_BYTES) return { error: `larger than ${MAX_JSON_BYTES >> 20} MB` };
    return { json: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { error: e instanceof SyntaxError ? `not valid JSON (${e.message})` : String(e?.code || e?.message || e) };
  }
}

/** Whether `abs` is inside `dir` once symbolic links are resolved (a pack file never leads out of its folder). */
function inside(dir, abs) {
  try {
    const d = fs.realpathSync(dir);
    const f = fs.realpathSync(abs);
    return f.startsWith(d + path.sep);
  } catch { return false; }
}

const fileUrl = (id, rel) => `${PACKS_URL}${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Scan the pack folders once.
 * @param {{ publicDir: string, dataDir: string, packsDir: string }} dirs
 * @param {{ app?: string }} [opts]
 * @returns {{ packs: Pack[], skipped: Skipped[], warnings: { where: string, warning: string }[] }}
 */
export function scanPacks({ publicDir, dataDir, packsDir }, { app = APP_VERSION } = {}) {
  /** @type {Pack[]} */
  const found = [];
  /** @type {Skipped[]} */
  const skipped = [];
  const warnings = [];
  const warn = (where, list) => { for (const w of list) warnings.push({ where, warning: w }); };

  // single-file language packs: public/i18n/<code>.json
  const uiDir = path.join(publicDir, LANG_DIR);
  for (const name of readDirSorted(uiDir)) {
    if (!name.endsWith('.json')) continue;
    const code = name.slice(0, -5);
    const where = `public/${LANG_DIR}/${name}`;
    if (!isLangCode(code)) { skipped.push({ where, problems: [`"${code}" is not a language code in its usual case (en, ja, zh-TW, pt-BR …)`] }); continue; }
    if (code === SOURCE_LANG) { skipped.push({ where, problems: ['"zh" is the source language (the msgids), never a pack'] }); continue; }
    const abs = path.join(uiDir, name);
    const r = readJson(abs);
    if (r.error) { skipped.push({ where, problems: [r.error] }); continue; }
    if (!r.json || typeof r.json !== 'object' || Array.isArray(r.json)) { skipped.push({ where, problems: ['not a JSON object of msgid → translation'] }); continue; }
    const { manifest, problems, warnings: w } = normalizeManifest(r.json._meta, { id: code, type: 'lang', lang: code, app });
    warn(where, w);
    if (!manifest) { skipped.push({ where, problems }); continue; }
    /** @type {Record<string, PackFile>} */
    const files = { ui: { rel: name, abs, url: `/${LANG_DIR}/${name}` } };
    const dataAbs = path.join(dataDir, LANG_DIR, name);
    if (isFile(dataAbs)) files.data = { rel: name, abs: dataAbs, url: `/data/${LANG_DIR}/${name}` };
    found.push({ id: code, type: 'lang', layout: 'file', where, supported: true, manifest, files, strings: countStrings(r.json) });
  }

  // folder packs: packs/<id>/pack.json
  for (const id of readDirSorted(packsDir)) {
    const dir = path.join(packsDir, id);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const where = `packs/${id}/`;
    const man = path.join(dir, PACK_MANIFEST);
    if (!isFile(man)) { skipped.push({ where, problems: [`no ${PACK_MANIFEST}`] }); continue; }
    const r = readJson(man);
    if (r.error) { skipped.push({ where, problems: [`${PACK_MANIFEST}: ${r.error}`] }); continue; }
    const { manifest, problems, warnings: w } = normalizeManifest(r.json, { id, folder: true, app });
    warn(where, w);
    if (!manifest) { skipped.push({ where, problems }); continue; }
    const kind = PACK_TYPES[manifest.type];
    if (kind.status !== 'supported') {
      skipped.push({ where, problems: [`type "${manifest.type}" is planned (${kind.summary}), not loaded by this version`] });
      continue;
    }
    /** @type {Record<string, PackFile>} */
    const files = {};
    const missing = [];
    for (const [role, rel] of Object.entries(manifest.files)) {
      const abs = path.join(dir, ...rel.split('/'));
      if (!isFile(abs)) missing.push(`files.${role}: ${rel} is missing`);
      else if (!inside(dir, abs)) missing.push(`files.${role}: ${rel} leads out of the pack folder`);
      else files[role] = { rel, abs, url: fileUrl(id, rel) };
    }
    if (missing.length) { skipped.push({ where, problems: missing }); continue; }
    /** @type {Pack} */
    const pack = { id, type: manifest.type, layout: 'folder', where, supported: true, manifest, files };
    if (manifest.type === 'lang') {
      const ui = readJson(files.ui.abs);
      if (ui.error || !ui.json || typeof ui.json !== 'object' || Array.isArray(ui.json)) {
        skipped.push({ where, problems: [`files.ui: ${ui.error || 'not a JSON object of msgid → translation'}`] });
        continue;
      }
      pack.strings = countStrings(ui.json);
    }
    found.push(pack);
  }

  // one pack per id (any case: one folder on Windows / macOS) and per language; the language folders' files first
  const packs = [];
  const ids = new Map();
  const langs = new Map();
  for (const p of found) {
    const idKey = p.id.toLowerCase();
    if (ids.has(idKey)) { skipped.push({ where: p.where, problems: [`the id "${p.id}" is taken by ${ids.get(idKey)}`] }); continue; }
    if (p.type === 'lang' && langs.has(p.manifest.lang)) {
      skipped.push({ where: p.where, problems: [`the language ${p.manifest.lang} is already provided by ${langs.get(p.manifest.lang)}`] });
      continue;
    }
    ids.set(idKey, p.where);
    if (p.type === 'lang') langs.set(p.manifest.lang, p.where);
    packs.push(p);
  }
  return { packs, skipped, warnings };
}

/**
 * The index body of scanned packs (shared/packs.js buildPackIndex).
 * @param {Pack[]} packs
 * @param {{ app?: string }} [opts]
 */
export function packIndexOf(packs, { app = APP_VERSION } = {}) {
  const entries = packs.filter((p) => p.supported).map((p) => packIndexEntry(p.manifest, {
    files: Object.fromEntries(Object.entries(p.files).map(([role, f]) => [role, f.url])),
    strings: p.strings,
  }));
  return buildPackIndex(entries, { app });
}

/** What changes when a pack is added, removed or edited: names, sizes and times of the files the scan reads. */
function signature({ publicDir, dataDir, packsDir }) {
  const parts = [];
  const add = (dir, depth, tag, namesOnly = false) => {
    for (const n of readDirSorted(dir)) {
      const abs = path.join(dir, n);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (depth > 0) { parts.push(`${tag}${n}/`); add(abs, depth - 1, `${tag}${n}/`); }
        continue;
      }
      parts.push(namesOnly ? `${tag}${n}` : `${tag}${n}:${st.size}:${Math.floor(st.mtimeMs)}`);
    }
  };
  add(path.join(publicDir, LANG_DIR), 0, 'u:');
  add(path.join(dataDir, LANG_DIR), 0, 'd:', true); // a game-text file only counts by its presence
  add(packsDir, 3, 'p:');
  return parts.join('\n');
}

/**
 * The registry: the scan, re-done when the folders change (see the header).
 * @param {{ publicDir: string, dataDir: string, packsDir: string }} dirs
 * @param {{ log?: { info: Function, warn: Function }, app?: string, recheckMs?: number }} [opts]
 *   recheckMs: how long a scan stays trusted before the folders are looked at again (default 1000; 0 = every call)
 */
export function createPackRegistry(dirs, { log = { info: noop, warn: noop }, app = APP_VERSION, recheckMs = 1000 } = {}) {
  let sig = null;
  let checkedAt = -Infinity;
  /** @type {ReturnType<typeof scanPacks> & { index: ReturnType<typeof packIndexOf>, byId: Map<string, Pack> }} */
  let state = null;
  const told = new Set();
  const tell = (fn, line) => { if (!told.has(line)) { told.add(line); fn(line); } };

  function refresh(force = false) {
    const now = Date.now();
    if (state && !force && now - checkedAt < recheckMs) return state;
    checkedAt = now;
    const s = signature(dirs);
    if (state && s === sig) return state;
    const first = !state;
    sig = s;
    const scan = scanPacks(dirs, { app });
    state = { ...scan, index: packIndexOf(scan.packs, { app }), byId: new Map(scan.packs.map((p) => [p.id, p])) };
    const line = `[packs] ${scan.packs.length ? scan.packs.map((p) => `${p.type} ${p.type === 'lang' ? p.manifest.lang : p.id} (${p.manifest.name})`).join(', ') : 'none'}`;
    if (first || scan.packs.length) tell((m) => log.info(m), line);
    for (const k of scan.skipped) tell((m) => log.warn(m), `[packs] ${k.where} skipped: ${k.problems.join('; ')}`);
    for (const w of scan.warnings) tell((m) => log.warn(m), `[packs] ${w.where}: ${w.warning}`);
    return state;
  }

  return {
    /** Re-read the folders now if they changed (force: even within recheckMs). */
    refresh: (force = false) => { refresh(force); },
    /** The loaded packs, optionally of one type. @param {string} [type] @returns {Pack[]} */
    list: (type) => refresh().packs.filter((p) => !type || p.type === type),
    /** The index body (GET /packs/index.json). */
    index: () => refresh().index,
    /** Packs that were not loaded and why, and the warnings of the loaded ones. */
    report: () => { const s = refresh(); return { skipped: s.skipped, warnings: s.warnings }; },
    /**
     * The file behind /packs/<id>/<rel>, or null: only a file a supported folder pack names.
     * @param {string} id
     * @param {string} rel
     */
    servable(id, rel) {
      const p = refresh().byId.get(id);
      if (!p || !p.supported || p.layout !== 'folder') return null;
      for (const f of Object.values(p.files)) if (f.rel === rel) return f.abs;
      return null;
    },
  };
}
