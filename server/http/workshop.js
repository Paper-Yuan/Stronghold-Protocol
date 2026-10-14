// 创意工坊 (docs/WORKSHOP.md) — the HTTP half of the workshop overlay, moved here by the upstream 0.2.0 port that split
// server/index.js into server/http/*. server/index.js (startServer) builds these three things once per process and hands
// them to createStaticHandler (server/http/static.js), which serves:
//
//   * the /data/<file>.json bodies a pack touches, MERGED (official + packs) — so the browser's data (public/js/data.js)
//     and the server's (server/data.js) are the same object without data/*.json ever being rewritten;
//   * a pack's behaviour layer (kits/<operator id>.js) as an ES module, so the BROWSER runs the very code the server
//     runs — the server re-computes a client's battle with the same kits, so a browser that silently fell back to the
//     generic kit would produce a result the server rejects;
//   * a pack's OWN art under /workshop-assets/<pack>/<path>, read-only and allowlisted by extension.
//
// The repo ships no game assets (they are (c) Hypergryph / Yostar), so a pack that needs a custom sprite, icon or voice
// line carries it: the pack's author is the redistributor, which is why such a pack MUST declare a licence
// (shared/workshop.js ASSETS_NEED_LICENSE).

import fs from 'node:fs';
import path from 'node:path';
import { WORKSHOP_MEDIA_PREFIX, WORKSHOP_RESOURCE_PREFIX, byPackId, workshopI18nFiles } from '../../shared/workshop.js';
import { workshopTouchedFiles, readUiLangFile } from '../workshop.js';
// 保留表只此一处真相：静态 `pack.json.routes` 与动态 `host.route` 两条通道判的都是 routeMount.js 里的那两张表。
import { coreRouteShadow } from './routeMount.js';

/**
 * The `/i18n/<code>.json` bodies the HTTP layer must serve MERGED for a 创意工坊 pack (fanpack G-04,
 * docs/WORKSHOP.md §1.10) — the i18n twin of `buildWorkshopDataFiles`, and deliberately the same shape: one Buffer of
 * `JSON.stringify(merged)` per language any pack adds to, and an **empty map** when no pack declares `i18n`.
 *
 * Why the merge must happen here and not in the pack: the file the client fetches is the language folder's own
 * (`public/i18n/<code>.json`, `public/js/ui/lang.js` reads `/i18n/<code>.json`), and a pack may not rewrite a folder
 * file — the same reason `data/*.json` is never rewritten. So the pack's entries are merged ON THE WAY OUT:
 *   * a key that already exists **keeps the official translation** (`mergeWorkshopI18n`), and the difference is
 *     reported instead of applied;
 *   * `_meta` of the on-disk file is preserved untouched (it is the language manifest the client reads).
 *
 * A language no pack touches is not in the map at all, so the request falls through to the plain static path and a
 * normal install serves byte-for-byte what it served before.
 * @param {ReturnType<import('../workshop.js').loadWorkshop>} workshop
 * @param {{ readBase?: (lang: string) => Record<string, any>|null, log?: object|null }} [opts]
 * @returns {Map<string, Buffer>}
 */
export function buildWorkshopI18nFiles(workshop, { readBase = readUiLangFile, log = null } = {}) {
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  const packs = (workshop && workshop.packs) || [];
  if (!packs.length) return out;
  /** pack id → 它的目录（一份 i18n 文件住在**声明它的那个包**里，不是住在赢家的包里时也一样读自己的）。 */
  const dirs = new Map(packs.map((p) => [p.id, typeof p.dir === 'string' && p.dir ? path.resolve(p.dir) : null]));
  const readFile = (pack, rel) => {
    const dir = dirs.get(pack) || null;
    if (!dir) return null;
    const abs = path.join(dir, ...String(rel).split('/'));
    if (abs === dir || !abs.startsWith(dir + path.sep)) return null;
    try {
      const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
      return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
    } catch {
      return null;
    }
  };
  const { files, conflicts, errors } = workshopI18nFiles(packs, readFile, readBase);
  for (const [lang, merged] of files) out.set(lang, Buffer.from(JSON.stringify(merged), 'utf8'));
  for (const c of conflicts) {
    log?.warn?.(`[workshop] i18n ${c.lang} "${c.key}": kept the existing translation (pack "${c.pack}" wanted ${JSON.stringify(c.packValue)})`);
  }
  for (const e of errors) log?.warn?.(`[workshop] i18n ${e.pack}/${e.lang}: ${e.code}: ${e.reason}`);
  return out;
}

/**
 * The `/data/<file>.json` bodies the HTTP layer must serve MERGED for a 创意工坊 pack (docs/WORKSHOP.md): one Buffer of
 * `JSON.stringify(merged)` per data file any pack touches — and an empty map when no pack is installed, which is the
 * normal case. Serving the merged object (rather than the file on disk) is what keeps the browser's data
 * (public/js/data.js) identical to the server's (server/data.js) without `data/*.json` ever being rewritten.
 * @param {Readonly<Record<string, any>>} data the loaded (already merged) game data
 * @param {ReturnType<import('../workshop.js').loadWorkshop>} workshop
 * @returns {Map<string, Buffer>}
 */
export function buildWorkshopDataFiles(data, workshop) {
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  if (!data || !workshop || !workshop.packs.length) return out;
  for (const file of workshopTouchedFiles(workshop)) {
    if (!Object.hasOwn(data, file) || data[file] == null) continue;
    out.set(file, Buffer.from(JSON.stringify(data[file]), 'utf8'));
  }
  return out;
}

/**
 * 包声明的**战斗逻辑**模块的 URL → 磁盘文件（`server.battle`, DESIGN §28.17）。与 `workshopKitFilesFor` 逐字同形、
 * 同一条纪律：只服务**装载器登记过**的 URL。
 *
 * 与 kits 的唯一差别是包内位置：kit 固定在 `kits/<id>.js`，战斗模块的路径由声明给出
 * （`server.battle.module`，可以是 `battle/main.mjs` 这样的子目录），所以这里从 URL 里解出包内相对路径。
 * @param {Array<{ id: string, pack: string, url: string }>} modules
 * @param {string} workshopDir
 * @returns {Map<string, string>}
 */
export function workshopBattleFilesFor(modules, workshopDir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (typeof workshopDir !== 'string' || workshopDir === '') return out;
  const root = path.resolve(workshopDir);
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!m || typeof m.url !== 'string' || typeof m.pack !== 'string') continue;
    const url = m.url.split('?')[0];
    const marker = `/workshop-battle/${encodeURIComponent(m.pack)}/`;
    const at = url.indexOf(marker);
    if (at < 0) continue;
    const rel = url.slice(at + marker.length).split('/').map((seg) => {
      try { return decodeURIComponent(seg); } catch { return seg; }
    }).join('/');
    // 只在包里解：`..` 与绝对路径一律丢掉（与 `modCatalog` 的 safeRelPath 同一条纪律）。
    const abs = path.join(root, m.pack, ...rel.split('/'));
    const dir = path.join(root, m.pack);
    if (!abs.startsWith(dir + path.sep)) continue;
    out.set(url, abs);
  }
  return out;
}

/**
 * Map each kit module URL to the file on disk that serves it. Built from the LOADED modules only, so a request can
 * never name a path this map does not already hold — the game server must not become a general file server for the
 * sake of the behaviour layer.
 * @param {Array<{ id: string, pack: string, url: string }>} modules
 * @param {string} workshopDir
 * @returns {Map<string, string>}
 */
export function workshopKitFilesFor(modules, workshopDir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  // `workshopDir: null` is a documented way to switch the whole feature off (tests, a "clean" server): there are no
  // packs then, so there are no kit files either — never resolve a path from a missing directory.
  if (typeof workshopDir !== 'string' || workshopDir === '') return out;
  const root = path.resolve(workshopDir);
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!m || typeof m.url !== 'string' || typeof m.pack !== 'string') continue;
    // The route matches the RAW path (the query is split off before serveStatic), so key on the path and drop the
    // `?v=` cache-buster the loader adds.
    const url = m.url.split('?')[0];
    out.set(url, path.join(root, m.pack, 'kits', path.basename(url)));
  }
  return out;
}

/** The URL prefix a pack's own art is served under (`<prefix><pack>/<path inside assets/>`). Shared with the overlay,
 * which writes the identical URLs for a pack's voice lines into the data the client reads. */
export const WORKSHOP_ASSET_PREFIX = WORKSHOP_MEDIA_PREFIX;

/**
 * Map each **C-layer panel module URL** to the file on disk that serves it (`pack.json.client.panels[].module`,
 * DESIGN §28.8). Built from the LOADED panel list only, exactly like `workshopKitFilesFor`: a request can never name a
 * path this map does not already hold, so the registration point does not turn the game server into a file server.
 *
 * The map key is the DECODED path (the loader percent-encodes each module segment, `server/http/static.js` compares
 * against `decodeURIComponent(rawPath)`), and a module whose bytes are not a `.js` file never enters it — the same line
 * `/workshop-assets` draws from the other side (that route serves media and refuses `.js`; this one serves code and
 * serves nothing else).
 * @param {Array<{ pack: string, module: string, url: string }>} panels the list `loadWorkshopPanels` built
 * @param {string} workshopDir
 * @returns {Map<string, string>}
 */
export function workshopPanelFilesFor(panels, workshopDir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  // `workshopDir: null` switches the whole feature off (tests, a clean server): never resolve a path from a missing root.
  if (typeof workshopDir !== 'string' || workshopDir === '') return out;
  const root = path.resolve(workshopDir);
  for (const p of Array.isArray(panels) ? panels : []) {
    if (!p || typeof p.pack !== 'string') continue;
    // 一个面板可能带两条通道：它的模块（`.js`）与它自带的样式表（`.css`，业主裁决 2026-10-10）。两边的判据逐字相同
    // —— 只服务**登记过**的路径，而且那个文件必须在包目录里、扩展名对得上。
    /** @type {Array<[string, string, string]>} */
    const entries = [];
    if (typeof p.url === 'string' && typeof p.module === 'string') entries.push([p.url, p.module, '.js']);
    for (const style of Array.isArray(p.styles) ? p.styles : []) {
      if (style && typeof style.url === 'string' && typeof style.path === 'string') entries.push([style.url, style.path, '.css']);
    }
    for (const [entryUrl, relPath, ext] of entries) {
      const raw = entryUrl.split('?')[0];
      if (!raw.endsWith(ext)) continue;
      let key = raw;
      try { key = decodeURIComponent(raw); } catch { /* an unencoded "%" in the declaration: key on the raw text */ }
      const rel = relPath.split('/');
      const bad = !rel.length || rel.some((s) => !s || s === '..' || s === '.' || s.startsWith('.'))
        || rel[rel.length - 1].length <= ext.length;
      if (bad) continue;
      const dir = path.join(root, p.pack);
      const abs = path.join(dir, ...rel);
      if (abs !== dir && !abs.startsWith(dir + path.sep)) continue;
      out.set(key, abs);
    }
  }
  return out;
}

/**
 * 已装载包 → 它的 `kits/` 目录（§28.18 的服务面）。`/workshop-kits/` 从「只服务登记过的那些 URL」放宽成
 * 「已装载包的 `kits/` 子树里的任意 `.js`」时，路由要拿这张表才知道一个包 id 对应磁盘上的哪个目录。
 *
 * 它只收**已经装载**的包（`loadWorkshop` 的返回值），所以一个没装上的包在路由上不存在 —— 这正是纪律本身：
 * 服务的范围由装载器决定，不由 URL 决定。`dir` 是 `loadWorkshop` 给出的**绝对**路径（`path.resolve` 后再进表，
 * 路由那半才能用 `path.relative` 判断「有没有留在 kits/ 里」）。
 * @param {{ packs?: Array<{ id?: string, dir?: string }> }} loaded
 * @returns {Map<string, string>} 包 id → `<包目录>/kits`（绝对路径）
 */
export function workshopKitDirsFor(loaded) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const p of (loaded && Array.isArray(loaded.packs)) ? loaded.packs : []) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.dir !== 'string' || !p.dir) continue;
    out.set(p.id, path.join(path.resolve(p.dir), 'kits'));
  }
  return out;
}

/**
 * `routes[*].cache` 声明 → 真正的 `Cache-Control` 头。三种语义就是三种，一个不多一个不少（`shared/workshop.js`
 * `ROUTE_CACHE_POLICIES` 是那份闭枚举的唯一来源）：
 *   * `no-cache`（缺省）—— 可以存，但每次都要回来问（`/data/*.json` 那一类「随时会变」的东西）；
 *   * `no-store` —— 根本不存（清单里带凭据 / 一次性数据）；
 *   * `public` —— 公开可缓存一天，与包自己的素材（`/workshop-assets`）同一条策略：一次重新打包才会换内容。
 */
export const ROUTE_CACHE_HEADERS = Object.freeze({
  'no-cache': 'no-cache',
  'no-store': 'no-store',
  'public': 'public, max-age=86400',
});

/**
 * The read-only HTTP routes the installed packs declare (`pack.json.routes`, DESIGN §28.13,
 * docs/WORKSHOP.md §1.9): the declared absolute path → the file inside the pack that serves it.
 *
 * The shape layer (`shared/workshop.js parseRoutesDecl`) already refused everything that is not "an absolute path, a
 * pack-relative `.json`", but this is the **serving** side and it re-judges: the declaration it reads may come from a
 * hand-built loader object or from a pack written against an older schema. Nothing here ever writes, and traversal is
 * structurally impossible — only an exact declared path is answered, and the file is resolved by joining the pack
 * directory with the declared segments and then refusing anything that escapes it. `.js` / `.html` are refused here for
 * the same reason `/workshop-assets` refuses them: this channel is data, not code.
 *
 * Refusals are reported (`errors`) rather than thrown, and a route whose file is missing stays in the map **on
 * purpose**: serving it answers 404 instead of silently falling through to whatever the core static mount happens to
 * have at that path. Two packs declaring the same path: the smaller pack id wins (DESIGN §28.3's rule), and the loser
 * is reported — the same ordering rule the data overlay and the kit loader use.
 *
 * **核心先吃（DESIGN §28.35）。** `static.js` asks this table *before* the core mounts, so a declaration can answer a
 * path the engine itself serves. That is no longer allowed: `coreRouteShadow` (routeMount.js — the same table the
 * dynamic `host.route` channel judges with) decides whether a declared path is one the engine really serves, and such
 * a declaration is **dropped from the map** — the core mount answers, exactly as if the pack had declared nothing. The
 * pack is **not** refused: a published pack that carries a shadowing declaration still installs and runs, only that one
 * declaration stops taking effect, and it is named in `errors` and in a `log.warn` line (never a silent drop). A
 * declaration that merely *sits in* a core namespace without a core file occupying it is kept and reported as a
 * pre-announced displacement.
 *
 * @param {{ packs?: Array<{ id: string, dir?: string, routes?: Array<{ path: string, file: string, cache?: string }> }> }} loaded
 * @param {string|null} workshopDir
 * @param {{ log?: object|null, mount?: Array<{ prefix: string, name?: string, dir?: string }> }} [opts]
 * @returns {{ routes: Map<string, { file: string, cache: string, pack: string }>, errors: Array<{ pack: string, path: string, reason: string }> }}
 */
export function workshopRoutesFor(loaded, workshopDir, { log = null, mount = [] } = {}) {
  /** @type {Map<string, { file: string, cache: string, pack: string }>} */
  const routes = new Map();
  /** @type {Array<{ pack: string, path: string, reason: string }>} */
  const errors = [];
  if (typeof workshopDir !== 'string' || workshopDir === '') return { routes, errors };
  const root = path.resolve(workshopDir);
  // 包 id 次序（DESIGN §28.3 的同一条规则）：一条路径被两个包声明时，谁赢不随装载器 / 调用方给的数组顺序变。
  for (const p of ((loaded && Array.isArray(loaded.packs)) ? loaded.packs : []).slice().sort(byPackId)) {
    if (!p || typeof p.id !== 'string' || !p.id || !Array.isArray(p.routes)) continue;
    const dir = p.dir ? path.resolve(p.dir) : path.join(root, p.id);
    if (dir !== root && !dir.startsWith(root + path.sep)) continue;
    for (const route of p.routes) {
      const rel = route && typeof route.file === 'string' ? route.file : '';
      const at = route && typeof route.path === 'string' ? route.path : String(route && route.path);
      const segments = rel.split('/');
      const bad = !route || typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.length < 2
        || route.path.includes('\\') || route.path.split('/').some((s) => s === '..' || s === '.')
        || path.isAbsolute(rel) || !rel.endsWith('.json') || segments.some((s) => s === '..' || s === '.');
      if (bad) {
        errors.push({ pack: p.id, path: at, reason: 'not a servable route: an absolute HTTP path and a pack-relative .json file (this channel never serves code or markup)' });
        continue;
      }
      const abs = path.join(dir, ...segments);
      if (abs !== dir && !abs.startsWith(dir + path.sep)) {
        errors.push({ pack: p.id, path: at, reason: `"${rel}" resolves outside the pack` });
        continue;
      }
      if (routes.has(route.path)) {
        errors.push({ pack: p.id, path: at, reason: `already declared by pack "${routes.get(route.path).pack}" (the smaller pack id wins, DESIGN §28.3)` });
        continue;
      }
      // 核心先吃（DESIGN §28.35）：引擎真的会服务这条路径 ⇒ 这条声明**不生效**（核心挂载照旧回答），但**不拒包**，
      // 并且响亮点名。判据只此一处（routeMount.js），与动态 `host.route` 通道读同一张保留表。
      //
      // 只有**真的撞上**（`exact` / `file`）才点名。`reserved`（落在引擎命名空间里、而核心今天没有那个文件，例如
      // 已发布的 ws-compression-reference 那条 `/data/ws-compression.json`）刻意**不报**：它今天一切照旧服务，
      // 报它只会让每一次 `/data/<自己的名字>.json` 声明都吐一行，把真正要紧的那一条淹掉 —— 而「将来核心长出这个
      // 文件就让位」是 `coreRouteShadow` 求值的**自动**结果，不需要作者现在做什么。这条立场写在 DESIGN §28.35。
      const shadow = coreRouteShadow(route.path, { mount });
      if (shadow && shadow.kind !== 'reserved') {
        const where = shadow.kind === 'file'
          ? `the core mount "${shadow.mount}" already serves ${shadow.file}`
          : 'the engine answers that exact path before any pack';
        errors.push({ pack: p.id, path: at, reason: `the engine answers this path first — ${where}; the declaration is ignored and the engine's own route serves it (a pack may not shadow a core path, DESIGN §28.35). The pack still loads.` });
        continue;
      }
      let exists = false;
      try { if (fs.statSync(abs).isFile()) exists = true; } catch { /* stays false: the route is kept, serving answers 404 */ }
      if (!exists) errors.push({ pack: p.id, path: at, reason: `"${rel}" is declared in pack.json but missing (the path is still served, as a 404)` });
      routes.set(route.path, {
        file: abs,
        cache: Object.hasOwn(ROUTE_CACHE_HEADERS, route.cache) ? route.cache : 'no-cache',
        pack: p.id,
      });
    }
  }
  for (const e of errors) log?.warn?.(`[workshop] route ${e.pack} ${e.path}: ${e.reason}`);
  return { routes, errors };
}

/**
 * The file types a pack's `assets/` folder may serve. Deliberately an allowlist: this route is reachable by any client,
 * and a `.js` or `.html` there would be code the page could be talked into executing (the kit route exists for code, and
 * it serves only modules the loader registered).
 */
export const WORKSHOP_ASSET_TYPES = Object.freeze(new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.gif', 'image/gif'], ['.svg', 'image/svg+xml'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon'],
  ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'], ['.m4a', 'audio/mp4'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'], ['.otf', 'font/otf'],
  ['.json', 'application/json; charset=utf-8'], ['.atlas', 'text/plain; charset=utf-8'], ['.skel', 'application/octet-stream'],
]));

/**
 * The packs that have an `assets/` folder, keyed by pack id → the pack's directory.
 *
 * A pack's own art is the one thing the repo cannot ship (the game assets are (c) Hypergryph / Yostar and are never
 * committed), so a pack that needs a custom sprite carries it and the client fetches it from here. `license` is REQUIRED
 * for such a pack (shared/workshop.js): the redistributor of the art is the pack's author, and the manifest has to say
 * under what terms — the same stance as docs/WORKSHOP.md §5.
 *
 * @param {{ packs?: Array<{ id: string, dir?: string }> }} loaded `loadWorkshop(...)`
 * @param {string|null} workshopDir
 */
export function workshopAssetsFor(loaded, workshopDir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (typeof workshopDir !== 'string' || workshopDir === '') return out;
  const root = path.resolve(workshopDir);
  for (const p of (loaded && Array.isArray(loaded.packs)) ? loaded.packs : []) {
    if (!p || typeof p.id !== 'string' || !p.id) continue;
    const dir = p.dir ? path.resolve(p.dir) : path.join(root, p.id);
    if (dir !== root && !dir.startsWith(root + path.sep)) continue;
    if (fs.existsSync(path.join(dir, 'assets'))) out.set(p.id, dir);
  }
  return out;
}

/**
 * The **registered URLs** of a pack's declared resource container and manifest (`pack.json.assets`, DESIGN §28.13,
 * docs/WORKSHOP.md §1.9.4): `WORKSHOP_RESOURCE_PREFIX + <pack id> + <declared path>`, built from the LOADED packs only
 * — exactly the stance `workshopPanelFilesFor` and `workshopKitFilesFor` take, and the reason none of these routes can
 * be walked into a file server.
 *
 * Why a map and not a check: a declared path is compared to the request path **as a string**, so `..` cannot build a key
 * that is not in it. Traversal is not a boundary that can be got wrong here, it is a goal that does not exist.
 *
 * Both files are served from the same map and the entry says which is which (`kind`), because the difference matters on
 * the wire: the container is streamed and carries `X-SP-Resource-Sha256` (the digest the loader verified), the manifest
 * is an ordinary small `.json` table.
 *
 * The digest is NOT recomputed here: `assetsIssues` already hashed the container while gating the pack, and hashing a
 * few hundred megabytes twice at boot would be the one cost this feature cannot hide.
 * @param {Array<object>|{ packs?: Array<object> }} packs the loaded packs (`loadWorkshop(...)`) or the array itself
 * @param {string|null} workshopDir
 * @param {{ digests?: Map<string, string>|Record<string, string>|null }} [opts] pack id → verified container digest
 * @returns {Map<string, { kind: 'container'|'manifest', pack: string, file: string, url: string, sha256: string|null }>}
 */
export function workshopResourceFilesFor(packs, workshopDir, { digests = null } = {}) {
  /** @type {Map<string, { kind: 'container'|'manifest', pack: string, file: string, url: string, sha256: string|null }>} */
  const out = new Map();
  // `workshopDir: null` switches the whole workshop off (tests, a clean server): never resolve a path from a missing
  // root — the same rule workshopKitFilesFor / workshopPanelFilesFor / workshopRoutesFor follow.
  if (typeof workshopDir !== 'string' || workshopDir === '') return out;
  const root = path.resolve(workshopDir);
  const list = (packs && Array.isArray(packs.packs)) ? packs.packs : (Array.isArray(packs) ? packs : []);
  const digestOf = (id) => {
    if (!digests) return null;
    return (typeof digests.get === 'function' ? digests.get(id) : digests[id]) || null;
  };
  for (const p of list.slice().sort(byPackId)) {
    if (!p || typeof p.id !== 'string' || !p.id || !p.assets) continue;
    const dir = p.dir ? path.resolve(p.dir) : path.join(root, p.id);
    if (dir !== root && !dir.startsWith(root + path.sep)) continue;
    const hash = typeof p.hash === 'string' ? p.hash : '';
    for (const [kind, rel] of [['container', p.assets.container], ['manifest', p.assets.manifest]]) {
      if (typeof rel !== 'string' || !rel) continue;
      const segments = rel.split('/');
      // The shape layer refused everything else, but this is the SERVING side and it re-judges (it may read a
      // hand-built loader object or a pack written against an older schema) — the same second look every pack-scoped
      // route in this file takes.
      if (segments.some((s) => !s || s === '..' || s === '.' || s.startsWith('.')) || path.isAbsolute(rel)) continue;
      const abs = path.join(dir, ...segments);
      if (abs === dir || !abs.startsWith(dir + path.sep)) continue;
      const url = `${WORKSHOP_RESOURCE_PREFIX}${encodeURIComponent(p.id)}/${segments.map(encodeURIComponent).join('/')}?v=${hash.slice(0, 12)}`;
      out.set(url.split('?')[0], { kind, pack: p.id, file: abs, url, sha256: kind === 'container' ? digestOf(p.id) : null });
    }
  }
  return out;
}

/**
 * `welcome.modAssets` —— 声明了 `assets` 的包的**声明清单**（DESIGN §28.13.5，docs/WORKSHOP.md §1.9.4）。
 *
 * 它是 `modPanels` 的同构物，就同一个理由：客户端要把「哪个包有一份资源容器、去哪儿取、它的字节是哪一份、服务端
 * 对 `/assets` 是什么策略」搞清楚，而这条信息只有服务端有。字段恰好是**声明的那四个**（`pack` 是身份）：
 *
 *   `container` / `manifest`  装载器**注册过**的那两个 URL（带 `?v=<包内容哈希[0:12]>` 缓存键）；
 *   `digest`                  装载期与容器**字节**核对过的 sha256（`assetsIssues`，不重算）。客户端拿它做两件事：
 *                             把导入的字节绑到「服务器验过的那份容器」上，以及在换容器之后判旧缓存作废；
 *   `serverPolicy` / `verify` 归一化后的声明值（缺省已在形状层补成 `"serve"` / `"sha256"`）。
 *
 * 三条纪律：
 *   1. **只有读者才加**：没有任何包声明 `assets` 时返回空数组，`welcome` 里就没有 `modAssets` 这个字段，
 *      客户端因此不 `import` 资源流程、不注册 SW、不多一个请求（B2/B3a 同一条不变量）。
 *   2. **从服务表反推，而不是另算一遍 URL**：`container` / `manifest` 就是 `workshopResourceFilesFor` 给出的那两个
 *      URL。两处各拼一次就是一个会漂移的真相（一个注册了、另一个请求的不是同一个键）。
 *   3. **两个 URL 都在才成一条声明**。少了哪一个（例如手工拼出来的 `packs` 数组绕过了装载器）就没有可用的声明，
 *      宁可不出这一条，也不给客户端半个地址。
 * @param {Map<string, { kind: 'container'|'manifest', pack: string, url: string, sha256: string|null }>|null} files
 *   `workshopResourceFilesFor(...)` 的输出
 * @param {Array<{ id: string, assets?: { serverPolicy: string, verify: string }, assetsDigest?: string }>} packs
 *   `loadWorkshop(...).packs`（只用来读归一化后的两个枚举值与摘要 —— URL 不从这里拼）
 * @returns {Array<{ pack: string, container: string, manifest: string, digest: string, serverPolicy: string, verify: string }>}
 */
export function workshopModAssetsFrom(files, packs) {
  /** @type {Map<string, { container?: any, manifest?: any }>} */
  const byPack = new Map();
  for (const entry of (files && typeof files.values === 'function') ? files.values() : []) {
    if (!entry || typeof entry.pack !== 'string') continue;
    const group = byPack.get(entry.pack) || {};
    group[entry.kind === 'manifest' ? 'manifest' : 'container'] = entry;
    byPack.set(entry.pack, group);
  }
  const byId = new Map(((Array.isArray(packs) ? packs : [])).filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
  /** @type {Array<any>} */
  const out = [];
  // 包 id 次序（DESIGN §28.3 的同一条规则）：列表的顺序不随装载器 / 调用方给的数组顺序变。
  for (const id of [...byPack.keys()].sort()) {
    const group = byPack.get(id);
    const pack = byId.get(id);
    if (!group.container || !group.manifest || !pack || !pack.assets) continue;
    // 摘要必须是**装载器交出来的**那一个（`assetsDigest`）。拿不到它就没有「同一份容器」这句话，不出这一条。
    const digest = typeof group.container.sha256 === 'string' ? group.container.sha256 : (typeof pack.assetsDigest === 'string' ? pack.assetsDigest : '');
    if (!/^[0-9a-f]{64}$/.test(digest)) continue;
    out.push({
      pack: id,
      container: group.container.url,
      manifest: group.manifest.url,
      digest,
      serverPolicy: pack.assets.serverPolicy,
      verify: pack.assets.verify,
      // 作者自备 CDN 的镜像（DESIGN §28.40）：**只在真的声明过时才存在** —— 与 `modPanels` 同一条纪律，没声明
      // `mirrors` 的包这一条 `welcome` 帧与从前逐字节相同。与包内容器摘要不符的那几条已经在装载期被摘掉
      // （`server/workshop.js assetsMirrorIssues`），所以这里交出去的每一条都是**可用的**声明；
      // 至多 `ASSETS_MIRROR_MAX` 条，字段就是形状层判过的那三个。
      ...(Array.isArray(pack.assets.mirrors) && pack.assets.mirrors.length
        ? { mirrors: pack.assets.mirrors.map((m) => ({ id: m.id, base: m.base, sha256: m.sha256 })) }
        : {}),
    });
  }
  return out;
}

/** `/assets/` 与 `/fonts/` —— `cache-only` 只对这两棵树短路：它们正是 `tools/fetch-assets.mjs` 落到
 *  `public/assets/**` 与 `public/fonts/**` 的那两个 git-ignored 目录（`.gitignore` 里点名的那两行）。 */
const CACHE_ONLY_PREFIXES = Object.freeze(['/assets', '/fonts']);
/** 一个请求路径是否落在 `cache-only` 覆盖的两棵树里（`/assets` 与 `/assets/…` 都算，缺尾斜杠的裸挂载也拦）。 */
export function isCacheOnlyPath(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  return CACHE_ONLY_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * The process-wide **`serverPolicy` verdict**, derived from the load-time `assetsIssues` results.
 *
 * Two rules, and both are the whole point of the switch:
 *   * **`cache-only` only when a pack explicitly declares it.** `serve` — the default, and what every pack in this
 *     repository declares — leaves the server byte-for-byte unchanged. There is no environment variable and no global
 *     toggle: the one thing that can turn a deployment into cache-only is a pack's own `pack.json`.
 *   * **Any single `cache-only` declaration wins process-wide, and it is reported loudly.** The policy is a property of
 *     `/assets` and `/fonts` — two trees shared by every pack — not of one pack, so it cannot be scoped to the pack that
 *     asked for it. One pack declaring it therefore changes what every other pack and the core game sees, which is
 *     exactly the kind of surprise that has to appear in the boot log instead of in a bug report.
 * @param {Map<string, string>|Record<string, string>|null} policies pack id → declared `serverPolicy`
 * @param {{ log?: object|null }} [opts]
 * @returns {'serve'|'cache-only'}
 */
export function resourceServerPolicy(policies, { log = null } = {}) {
  const entries = policies && typeof policies.entries === 'function'
    ? [...policies.entries()]
    : Object.entries(policies || {});
  const cacheOnly = entries.filter(([, policy]) => policy === 'cache-only').map(([id]) => id).sort();
  if (!cacheOnly.length) return 'serve';
  log?.info?.(`[workshop] serverPolicy "cache-only" declared by ${cacheOnly.map((id) => `"${id}"`).join(', ')} — /assets/ and /fonts/ now answer 412 for the whole server, and the packs no longer serve them`);
  return 'cache-only';
}
