// shared/packs.js — content packs (docs/PACKS.md): one manifest format, one registry, one index for every kind of
// add-on content (the owner's decision of 2026-10-07: the language pack is the first type of a general mechanism). A
// pack is a manifest plus its files. Type "lang" (language packs, shared/i18nPacks.js) is the first and, in 0.2.0, the
// only type that loads; "assets" (art / audio / font replacements, client side) and "data" (data patches the server
// applies at start) are planned: their manifests already parse, a server lists them as not supported yet, and each will
// plug in as its entry in PACK_TYPES plus its loader (docs/PACKS.md "Adding a pack type"). No Node builtin: the
// browser, the server (server/packs.js) and the tools share it.
//
// Two layouts, read by the same registry (server/packs.js) and listed alike:
//   packs/<id>/pack.json + its files   a folder pack — any type; the manifest names its files (`files`)
//   public/i18n/<code>.json            a single-file language pack — its manifest is the file's `_meta` block
//                                      (+ data/i18n/<code>.json, its game texts, when present)
//
// Manifest (pack.json, or `_meta` of a single-file language pack; every field but type / lang optional):
//   id            a folder pack: its folder name; a single-file language pack: its language code (a manifest that names
//                 another id is reported; the place decides). Letters, digits, '.', '_', '-', ≤ 64; unique across types
//   type          "lang" (a single-file language pack may leave it out); planned: "assets", "data"
//   version       the pack's own version (e.g. "1.2.0")
//   app           the app versions it is made for, a range: ">=0.2.0", ">=0.2.0 <0.3.0", "0.2.x", "^0.2.0", "~0.2.1", "*"
//                 (a pre-release such as 0.2.0-dev counts as its release). Outside it a language pack still loads —
//                 what it lacks falls back — and is flagged `compatible: false`
//   name          the pack's name in its own language (a language pack: the language's own name, shown in the menu)
//   englishName   its English name
//   authors       a string or a list;  credits  free text;  license  an SPDX id or free text
//   files         a folder pack: role → path inside the folder (type "lang": { "ui": "ui.json", "data": "data.json" })
//   …             the type's own fields (type "lang": lang, base, fallback, complete, machineTranslated, numberUnits —
//                 shared/i18nPacks.js; a machineTranslated that is not a boolean is warned about and reads as false)
//
// Index (GET /packs/index.json — the server's live list; `node tools/packs.mjs index` writes packs/index.json for a
// static host): { version: 1, app: "<the server's app version>", packs: [entry …] } — the packs of supported types,
// sorted by type then id. An entry: id, type, name, englishName, version?, app?, compatible, authors?, credits?,
// license?, files (role → URL on this server) and the type's fields; a language entry: lang, base?, fallback,
// complete?, machineTranslated?, numberUnits?, strings (how many translations its UI file holds).

import { APP_VERSION } from './constants.js';
import { SOURCE_LANG, canonicalLang, isLangCode, languageName, langFields } from './i18nPacks.js';

export const PACK_INDEX_VERSION = 1;
/** A folder pack's manifest file. */
export const PACK_MANIFEST = 'pack.json';
/** The index file next to the pack folders (packs/index.json, URL /packs/index.json). */
export const PACK_INDEX_FILE = 'index.json';
/** Where pack folders are served (server/http/static.js): /packs/<id>/<file>. */
export const PACKS_URL = '/packs/';

/**
 * @typedef {{ required?: boolean, ext: string[] }} FileRole a role of a folder pack's `files`
 * @typedef {{ status: 'supported' | 'planned', summary: string, live?: boolean, files?: Record<string, FileRole> }} PackType
 *   live: a server picks up its changes without a restart (lang: the client loads packs on demand; data will not —
 *   the simulation's data is fixed at start). files: the roles a folder pack of the type names, with the extensions a
 *   server may serve for them (nothing else in a pack folder is ever served)
 */

/** @type {Readonly<Record<string, PackType>>} the pack types (docs/PACKS.md "Adding a pack type") */
export const PACK_TYPES = Object.freeze({
  lang: Object.freeze({
    status: 'supported', live: true, summary: 'a language: UI strings and, optionally, game texts',
    files: Object.freeze({ ui: Object.freeze({ required: true, ext: ['.json'] }), data: Object.freeze({ ext: ['.json'] }) }),
  }),
  assets: Object.freeze({ status: 'planned', summary: 'art, audio and font replacements, client side' }),
  data: Object.freeze({ status: 'planned', summary: 'data patches the server applies at start' }),
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/** A pack id: letters, digits, '.', '_', '-' (not first), at most 64. @param {unknown} v */
export const isPackId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);

/**
 * A path inside a pack folder ('ui.json', 'img/a.png'): relative, '/'-separated, no '.' / '..' / hidden / empty segment,
 * plain characters only.
 * @param {unknown} rel
 */
export const isPackPath = (rel) => typeof rel === 'string' && rel.length <= 200 && /^[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/.test(rel)
  && rel.split('/').every((s) => s.trim() === s && s && !s.startsWith('.'));

const extOf = (rel) => { const m = /\.[A-Za-z0-9]+$/.exec(rel); return m ? m[0].toLowerCase() : ''; };

// ---- app version ranges -------------------------------------------------------------------------------------------

/** [major, minor, patch] of a version ('0.2.0-dev' → [0, 2, 0]: a pre-release counts as its release), or null. */
const versionCore = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One comparator of a range as [op, version] bounds, or null when it is not one. */
function bounds(c) {
  if (c === '*' || c === 'x') return [];
  const m = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(c);
  if (!m) return null;
  const [, op = '', a, b, d] = m;
  const wild = (s) => s === undefined || /^[xX*]$/.test(s);
  const M = Number(a);
  const N = wild(b) ? 0 : Number(b);
  const P = wild(d) ? 0 : Number(d);
  const partial = wild(b) ? 1 : wild(d) ? 2 : 3; // how many parts were given
  const lo = [M, N, P];
  if (op === '^') return [['>=', lo], ['<', M > 0 ? [M + 1, 0, 0] : partial >= 2 ? [0, N + 1, 0] : [1, 0, 0]]];
  if (op === '~') return [['>=', lo], ['<', partial >= 2 ? [M, N + 1, 0] : [M + 1, 0, 0]]];
  if (op === '' || op === '=') {
    if (partial === 3) return [['=', lo]];
    return [['>=', lo], ['<', partial === 2 ? [M, N + 1, 0] : [M + 1, 0, 0]]];
  }
  return [[op, lo]];
}

/** Whether `range` is a version range this file understands (an empty one is). @param {unknown} range */
export function isVersionRange(range) {
  const r = String(range ?? '').trim();
  if (!r) return true;
  return r.split('||').every((alt) => alt.trim().split(/\s+/).every((c) => bounds(c) !== null));
}

/**
 * Whether an app version is in a pack's `app` range (see the header). An empty range, an unreadable range or version
 * counts as a match: the range is advice, the pack's loader decides what an incompatible pack means.
 * @param {unknown} range
 * @param {unknown} [version] default: this build's APP_VERSION
 */
export function appVersionMatches(range, version = APP_VERSION) {
  const v = versionCore(version);
  const r = String(range ?? '').trim();
  if (!v || !r || !isVersionRange(r)) return true;
  return r.split('||').some((alt) => alt.trim().split(/\s+/).every((c) => bounds(c).every(([op, b]) => {
    const d = cmp(v, b);
    return op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : op === '<' ? d < 0 : d === 0;
  })));
}

// ---- manifests ----------------------------------------------------------------------------------------------------

/**
 * @typedef {{ id: string, type: string, name: string, englishName: string, version: string, app: string,
 *   compatible: boolean, authors: string[], credits: string, license: string, files: Record<string, string>,
 *   lang?: string, base?: string|null, fallback?: string[], complete?: boolean, machineTranslated?: boolean,
 *   numberUnits?: string[]|null }} PackManifest
 */

/**
 * Read a manifest: the common fields, the type's fields, a folder pack's file roles. `problems` keep the pack from
 * loading (manifest null); `warnings` do not.
 * @param {unknown} raw pack.json, or the `_meta` of a single-file language pack (undefined: none)
 * @param {{ id: string, type?: string, lang?: string, folder?: boolean, app?: string }} ctx
 *   id: the folder name / the file's code; type: the type of the layout (a single-file language pack: 'lang');
 *   lang: a single file's language code; folder: a folder pack (its `files` are read); app: the app version
 * @returns {{ manifest: PackManifest | null, problems: string[], warnings: string[] }}
 */
export function normalizeManifest(raw, ctx) {
  const problems = [];
  const warnings = [];
  if (raw !== undefined && !isObj(raw)) problems.push('the manifest is not a JSON object');
  const m = isObj(raw) ? /** @type {any} */ (raw) : {};
  const type = str(m.type, 20) || ctx.type || '';
  const kind = Object.prototype.hasOwnProperty.call(PACK_TYPES, type) ? PACK_TYPES[type] : null;
  if (!type) problems.push('no "type"');
  else if (!kind) problems.push(`unknown type "${type}" (known: ${Object.keys(PACK_TYPES).join(', ')})`);
  if (ctx.type && type !== ctx.type) problems.push(`"type": "${type}" where a ${ctx.type} pack belongs`);
  const id = ctx.id;
  if (!isPackId(id)) problems.push(`"${id}" is not a pack id (letters, digits, . _ -)`);
  if (m.id !== undefined && m.id !== id) warnings.push(`"id": "${m.id}" is not "${id}" (the folder or file name decides)`);
  const range = str(m.app, 60);
  if (range && !isVersionRange(range)) warnings.push(`"app": "${range}" is not a version range (">=0.2.0", "0.2.x" …)`);
  const app = ctx.app ?? APP_VERSION;
  const compatible = appVersionMatches(range, app);
  if (!compatible) warnings.push(`made for app ${range}; this is ${app}`);
  const authors = (Array.isArray(m.authors) ? m.authors : typeof m.authors === 'string' ? [m.authors] : []).map((a) => str(a)).filter(Boolean).slice(0, 32);
  /** @type {PackManifest} */
  const out = {
    id, type, name: str(m.name, 60), englishName: str(m.englishName, 60), version: str(m.version, 40), app: range, compatible,
    authors, credits: str(m.credits, 500), license: str(m.license, 100), files: {},
  };
  if (type === 'lang') {
    const code = ctx.lang || canonicalLang(m.lang);
    if (ctx.lang && m.lang !== undefined && canonicalLang(m.lang) !== ctx.lang) warnings.push(`"lang": "${m.lang}" is not its file's code ${ctx.lang}`);
    if (!code) problems.push(m.lang === undefined ? 'no "lang" (the language code)' : `"lang": "${m.lang}" is not a language code`);
    else if (code === SOURCE_LANG) problems.push('"zh" is the source language (the msgids), never a pack');
    else {
      if (m.lang !== undefined && !isLangCode(m.lang) && !ctx.lang) warnings.push(`"lang": "${m.lang}" read as ${code}`);
      Object.assign(out, langFields(code, m));
      // anything but true reads as false: say so when another value was meant
      const mt = m.machineTranslated;
      if (mt !== undefined && typeof mt !== 'boolean') warnings.push(`"machineTranslated": ${String(JSON.stringify(mt)).slice(0, 40)} is not true or false (read as false)`);
      out.name ||= languageName(code);
      out.englishName ||= languageName(code, 'en');
    }
  }
  out.name ||= id;
  out.englishName ||= out.name;
  if (ctx.folder && kind && kind.files) {
    const given = isObj(m.files) ? m.files : {};
    for (const [role, spec] of Object.entries(kind.files)) {
      const rel = given[role];
      if (rel === undefined || rel === null || rel === '') { if (spec.required) problems.push(`no "files.${role}"`); continue; }
      if (!isPackPath(rel)) problems.push(`"files.${role}": "${rel}" is not a path inside the pack folder`);
      else if (!spec.ext.includes(extOf(rel))) problems.push(`"files.${role}" must be a ${spec.ext.join(' / ')} file`);
      else out.files[role] = rel;
    }
    for (const role of Object.keys(given)) if (!kind.files[role]) warnings.push(`"files.${role}" is not a role of a ${type} pack (ignored)`);
  }
  return { manifest: problems.length ? null : out, problems, warnings };
}

// ---- the index ----------------------------------------------------------------------------------------------------

/**
 * The index entry of a pack (what a client may know): its manifest without the folder paths, `files` as URLs, plus the
 * type's extras (a language pack: `strings`).
 * @param {PackManifest} manifest
 * @param {{ files: Record<string, string>, strings?: number }} extra files: role → URL
 */
export function packIndexEntry(manifest, extra) {
  /** @type {Record<string, unknown>} */
  const e = { id: manifest.id, type: manifest.type, name: manifest.name, englishName: manifest.englishName };
  if (manifest.version) e.version = manifest.version;
  if (manifest.app) e.app = manifest.app;
  e.compatible = manifest.compatible;
  if (manifest.authors.length) e.authors = manifest.authors;
  if (manifest.credits) e.credits = manifest.credits;
  if (manifest.license) e.license = manifest.license;
  if (manifest.type === 'lang') {
    e.lang = manifest.lang;
    if (manifest.base !== undefined) e.base = manifest.base;
    e.fallback = manifest.fallback || [];
    if (manifest.complete) e.complete = true;
    if (manifest.machineTranslated) e.machineTranslated = true;
    if (manifest.numberUnits) e.numberUnits = manifest.numberUnits;
    e.strings = extra.strings ?? 0;
  }
  e.files = { ...extra.files };
  return e;
}

/**
 * The index body from the entries of supported packs (packIndexEntry), sorted by type then id.
 * @param {Record<string, unknown>[]} entries
 * @param {{ app?: string }} [opts]
 */
export function buildPackIndex(entries, { app = APP_VERSION } = {}) {
  const key = (e) => `${e.type}\u0000${e.id}`;
  return { version: PACK_INDEX_VERSION, app, packs: [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) };
}

/** A URL a client may fetch from an index: a path on this server ('/…', never '//host' or a scheme). */
const isLocalUrl = (u) => typeof u === 'string' && /^\/(?!\/)[^\s\\]*$/.test(u) && u.length <= 300;

/**
 * Read a received index (the client): the entries of supported types whose fields check out; anything else is dropped.
 * Optionally only one type.
 * @param {unknown} json
 * @param {string} [type]
 * @returns {Record<string, any>[]}
 */
export function readPackIndex(json, type) {
  const list = isObj(json) && Array.isArray(/** @type {any} */ (json).packs) ? /** @type {any} */ (json).packs : [];
  const out = [];
  for (const e of list) {
    if (!isObj(e) || !isPackId(e.id) || PACK_TYPES[e.type]?.status !== 'supported' || (type && e.type !== type)) continue;
    const files = {};
    for (const [role, url] of Object.entries(isObj(e.files) ? e.files : {})) if (isLocalUrl(url)) files[role] = url;
    if (e.type === 'lang' && (!isLangCode(e.lang) || e.lang === SOURCE_LANG || !files.ui)) continue;
    out.push({ ...e, files });
  }
  return out;
}

/**
 * The language a client registers for a language entry of the index (shared/i18n.js registerLangs).
 * @param {Record<string, any>} e a 'lang' entry of readPackIndex
 * @returns {import('./i18nPacks.js').LangMeta}
 */
export function langMetaOf(e) {
  const f = langFields(e.lang, e);
  return {
    ...f,
    code: e.lang,
    name: str(e.name, 60) || languageName(e.lang),
    englishName: str(e.englishName, 60) || languageName(e.lang, 'en'),
    authors: Array.isArray(e.authors) ? e.authors.map((a) => str(a)).filter(Boolean).slice(0, 32) : [],
    version: str(e.version, 40),
    app: str(e.app, 60),
    compatible: e.compatible !== false,
    strings: Number.isFinite(e.strings) ? e.strings : undefined,
    data: !!e.files?.data,
    ui: e.files?.ui,
    dataUrl: e.files?.data,
    packId: e.id,
  };
}
