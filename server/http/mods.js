// server/http/mods.js — the HTTP half of the CLIENT MOD STORE (W-C): what a browser downloads and caches locally.
//
// Two things live here, and both are deliberately narrow:
//
//   * `GET /mods/catalog.json` — the catalogue (server/modCatalog.js): every installed pack, its identity, and its file
//     list with the hashes a client verifies against. The URL follows the existing `/packs/index.json` precedent
//     (server/packs.js), the "the server publishes an index, the client chooses" pattern this reuses.
//   * `GET /mods/file/<pack>/<path>` — the BYTES of one pack file. A pack's kits and its art already have routes
//     (`/workshop-kits/`, `/workshop-assets/`); this one exists for the pack's own JSON (`pack.json`, `chess.json`) and
//     serves anything else the catalogue lists, so a client can cache the pack whole. ONE row of that list names no file
//     — the reserved container digest (`server/packFiles.js ASSETS_DIGEST_PATH`) — and this route serves the digest text
//     for it, because a client that cannot fetch a row of the identity can never rebuild the pack hash.
//
// A request is served only when BOTH hold: the path is inside the pack directory, and the path is in the pack's file
// list. The second check is the strong one — that list is the loader's identity inventory (DESIGN §28.2 裁决 B), so this
// route can never become a general file server for the game's own tree.
//
// The catalogue is built once per process (the pack set is fixed at load, DESIGN §28.2) and handed in already built:
// `serveMods` does no work per request beyond two map lookups.
//
// (i18n-ignore-file: the error titles are the bilingual `中文 · English` page text of server/http/common.js, not UI
// strings — docs/I18N.md)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { sendError, sendJson } from './common.js';
import { WORKSHOP_ASSET_TYPES } from './workshop.js';
import { modFileAbs } from '../modCatalog.js';
import { ASSETS_DIGEST_PATH, containerDigestBytes } from '../packFiles.js';

/** The catalogue URL, next to `/packs/index.json`. */
export const MODS_CATALOG_URL = '/mods/catalog.json';
/** The route prefix a pack file is fetched from (`<prefix><pack>/<path inside the pack>`). */
export const MOD_FILE_PREFIX = '/mods/file/';

/**
 * What the routes need: the catalogue to publish, and where to read a pack file from.
 * @typedef {{ catalog: { packs: Array<{ id: string, files: Array<{ path: string }> }> }, packs: Map<string, any>,
 *   error: Error|null }} ModsRoutes
 */

/**
 * Build the route table from the loaded workshop and its catalogue.
 *
 * `packs` is keyed by pack id → the `loadWorkshop()` entry, which carries `dir` (the directory a path is resolved
 * inside). The FILE LIST comes from the catalogue (see `filesOf`), so "inside the directory" is answered by the pack
 * entry and "is it a file of this pack" by the very list the client was told about — one answer each, no second opinion.
 * @param {ReturnType<import('../workshop.js').loadWorkshop>|null|undefined} loaded
 * @param {{ packs: Array<{ id: string, files: Array<{ path: string }> }> }} catalog `buildModCatalog(loaded)`
 * @returns {ModsRoutes}
 */
export function createModsRoute(loaded, catalog) {
  /** @type {Map<string, any>} */
  const packs = new Map();
  for (const p of Array.isArray(loaded?.packs) ? loaded.packs : []) {
    if (p && typeof p.id === 'string') packs.set(p.id, p);
  }
  return { catalog, packs, error: null };
}

/**
 * The file list of one pack as a Set — built from the CATALOGUE, so "what the client was told it may fetch" and "what
 * the server will hand over" are the same list by construction.
 * @param {ModsRoutes} routes
 * @param {string} id
 * @returns {Set<string>|null} null when this server has no such pack
 */
function filesOf(routes, id) {
  const entry = routes.catalog.packs.find((p) => p && p.id === id);
  return entry && Array.isArray(entry.files) ? new Set(entry.files.map((f) => f && f.path)) : null;
}

/**
 * Answer a `/mods/...` request, or return false to let the static mounts have it.
 *
 * SYNCHRONOUS on purpose: the caller (server/http/static.js) uses the return value to decide whether to keep routing, so
 * a promise would be truthy and would swallow every unrelated GET. The file read itself is async and is awaited inside;
 * `error` is set (and the response destroyed) if that fails, because the caller cannot await a value it never got.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} decoded the decoded path
 * @param {string} query
 * @param {ModsRoutes} routes
 * @returns {boolean} true when the request is answered here (possibly still in flight)
 */
export function serveMods(req, res, decoded, query, routes) {
  if (decoded === MODS_CATALOG_URL) {
    sendJson(req, res, 200, routes.catalog);
    return true;
  }
  if (!decoded.startsWith(MOD_FILE_PREFIX)) return false;
  const rest = decoded.slice(MOD_FILE_PREFIX.length);
  const slash = rest.indexOf('/');
  // the first segment is the pack id, the remainder is the path inside the pack; an empty half is not a file
  const id = slash < 0 ? '' : rest.slice(0, slash);
  const rel = slash < 0 ? '' : rest.slice(slash + 1);
  const pack = id ? routes.packs.get(id) : null;
  const files = id ? filesOf(routes, id) : null;
  if (!pack || !files || !rel || !files.has(rel)) {
    // "not found" covers a bad pack, an unlisted path and a traversal attempt alike: this route must not tell a caller
    // which of those it was, and the loader would never have listed a path that leaves the pack
    sendError(req, res, 404, '页面不存在 · Not found');
    return true;
  }
  const abs = modFileAbs(pack, rel);
  if (!abs) {
    sendError(req, res, 403, '禁止访问 · Forbidden');
    return true;
  }
  // The ONE row of the download list that has no file of its own: the reserved container digest (server/packFiles.js).
  // `identifyPack` puts that digest into the pack's identity (DESIGN §28.13.5), so a client that cannot fetch the row can
  // never rebuild the pack hash — and then it never proves it holds an asset pack at all. The row's payload is the digest
  // text (64 bytes), uniquely determined by a value the loader verified against the container's real bytes.
  // A real file of the same name WINS: `identifyPack` prefers it, the catalogue then describes THAT file, and the route
  // must hand over its bytes — the existence check is that precedence, not a second opinion about the pack.
  const virtual = rel === ASSETS_DIGEST_PATH && typeof pack.assetsDigest === 'string' && !fs.existsSync(abs)
    ? containerDigestBytes(pack.assetsDigest)
    : null;
  handleFile(req, res, abs, query, virtual).catch((err) => {
    routes.error = err instanceof Error ? err : new Error(String(err));
    if (!res.headersSent) sendError(req, res, 404, '页面不存在 · Not found');
    else res.destroy();
  });
  return true;
}

/**
 * The Content-Type one pack file is served with.
 *
 * A pack's own `assets/` folder is hashed WHOLE by the loader (server/workshop.js identifyPack walks `assets/**` with no
 * extension filter), so a pack really can contain an `assets/evil.js` — and it has to be downloadable, or a client could
 * never rebuild the pack hash. What it must not be is a URL the page could be talked into executing: only the media
 * types `/workshop-assets/` already allows (server/http/workshop.js WORKSHOP_ASSET_TYPES) plus the pack's own JSON are
 * named; everything else is `application/octet-stream`, which a browser downloads and never runs. The response also
 * carries `X-Content-Type-Options: nosniff` on every request (server/http/common.js), so a mislabelled body cannot be
 * sniffed back into a script.
 * @param {string} abs
 * @returns {string}
 */
function contentTypeFor(abs) {
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  // ONLY the allowlist names a type. Falling back to the general MIME table would name `.js` `text/javascript` again,
  // which is exactly the hole this function exists to close.
  return WORKSHOP_ASSET_TYPES.get(ext) || 'application/octet-stream';
}

/**
 * Send one pack file.
 *
 * Deliberately not `serveFile` (server/http/files.js): that helper needs a `stat` the caller has already read, which
 * would put an `await` between the route decision and its answer. A pack file is small and immutable in practice, so the
 * simple read is the honest one. `?v=<hash>` is served immutable — the URL names the exact bytes, which is why the
 * catalogue hands the client that URL — and a bare URL is `no-cache` like `/data/`, so a repacked pack cannot be
 * pinned by a browser that fetched it before the author changed it.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} abs absolute path inside the pack directory (already checked)
 * @param {string} query
 * @param {Buffer|null} [virtual] the bytes to serve INSTEAD of reading `abs` — the reserved container-digest row, whose
 *   path names no file at all (see `serveMods`). `null` for every ordinary pack file.
 */
async function handleFile(req, res, abs, query, virtual = null) {
  const body = virtual || await fsp.readFile(abs);
  const immutable = /(^|&)v=[^&]+/.test(query);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(abs),
    'Content-Length': body.length,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
