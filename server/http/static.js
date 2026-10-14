// server/http/static.js — the static file server (routes.js hands it every GET / HEAD that is not an API route):
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//     /        → public/      (index.html for directories)
//     /data/   → data/        (generated game data)
//     /shared/ → shared/      (ESM shared with the browser)
//     /sim/    → server/sim/  (the battle simulation, read-only, `.js` only — client-side
//                              combat, DESIGN §14; the Node-only loader nodeData.js is not served)
//     /data.js → a generated browser stand-in of server/data.js (the sim's content modules
//                import `../../../data.js`; in the browser it serves the data injected with
//                /sim/simdata.js setSimData). No other server file is ever served.
//     /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 — the same audio files, addressed
//                **without** an extension so download managers (IDM / 迅雷 …) stop popping a
//                "下载文件信息" dialog for every BGM track (media.js, shared/media.js, public/js/media.js)
//     /packs/index.json → the content packs of this server (server/packs.js: the language packs of
//                public/i18n/ and the pack folders of packs/, re-read when they change; never cached)
//     /packs/<id>/<file> → a file of a pack folder — only one its manifest names (server/packs.js servable)
//     /workshop-assets/<pack>/<path> → a 创意工坊 pack's OWN art (server/http/workshop.js): allowlisted extensions,
//                only packs with an assets/ folder, no listings — docs/WORKSHOP.md §5
//     /workshop-kits/<pack>/<id>.js  → a pack's behaviour layer, as an ES module the BROWSER runs (docs/WORKSHOP.md §4).
//                Since DESIGN §28.18 the route also serves the pack's OTHER `kits/**/*.js` files (a loaded pack, any
//                `<rel>` whose resolved path stays under `<packDir>/kits/`, `.js` only), which is what makes a
//                downward relative import inside a kit resolve on both ends — the `kits/` segment is not in the URL,
//                so `./lib/util.js` means `<packDir>/kits/lib/util.js` on disk and
//                `/workshop-kits/<pack>/lib/util.js` on the wire: the same file. `/workshop-battle/` deliberately
//                stays registered-URLs-only: a battle module is loaded from a `data:` URL on the server, where a
//                relative specifier cannot resolve, so the form is refused for it (§28.18's asymmetry).
//     /workshop-panels/<pack>/<module> → a pack's C-layer panel module, likewise an ES module the browser imports
//                (`pack.json.client.panels`, DESIGN §28.8; only URLs `loadWorkshopPanels` registered, `.js` only —
//                this is the code side of the line `/workshop-assets` draws on the media side)
//     /workshop-resources/<pack>/<path> → the container and the flat file table a pack declares in `assets`
//                (DESIGN §28.13; only the two URLs `workshopResourceFilesFor` registered, unregistered / traversal →
//                404, streamed rather than buffered because a container reaches hundreds of MB, and carrying the
//                sha256 the loader verified as `X-SP-Resource-Sha256`)
//     <a path a pack declares>      → the pack's own read-only `.json` route (`pack.json.routes`, DESIGN §28.13; the
//                exact declared path only, with the declared `Cache-Control`, answered before the core mounts)
//     /mod/<pack>/<name>            → a pack's own read-only JSON endpoint (`server.modules[*].uses` includes `route`,
//                DESIGN §28.32): the exact declared path only, computed by the pack's synchronous handler, GET/HEAD,
//                public, `no-store`/`no-cache` only, bounded body. Answered after the static routes and before the
//                core mounts — the namespace rule is what keeps a pack away from every core path.
//     /data/<file>.json              → served MERGED (official + packs) when a pack touches that file
//     /mods/catalog.json, /mods/file/<pack>/<path> → the installed packs and their bytes, for the CLIENT-side mod cache
//                (server/http/mods.js): only a path the catalogue lists, and only inside the pack's own directory
//
// `/assets/` and `/fonts/` answer 412 and never touch the file system when a pack declared
// `assets.serverPolicy: "cache-only"` (DESIGN §28.13.4): the file is supposed to come from the client's own cache.
//
// Traversal & dotfile protection, a directory without its trailing slash → 301, 404 page; an absent
// data/local-assets.json is answered with an empty manifest. Files go out through files.js serveFile.

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { MEDIA_PREFIX } from '../../shared/media.js';
import { splitHashedPath } from '../../shared/assetPaths.js';
import { ROOT, noopLog } from './config.js';
import { sendError, sendJson } from './common.js';
import { MIME, CompressCache, isNotModified, serveFile, serveBuffer } from './files.js';
import { ASSET_INDEX_ROOTS, hashedFileOpts } from './assetIndex.js';
import { serveMedia } from './media.js';
import { createPackRegistry } from '../packs.js';
import { PACKS_URL, PACK_INDEX_FILE } from '../../shared/packs.js';
import { WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES, ROUTE_CACHE_HEADERS, isCacheOnlyPath } from './workshop.js';
import { WORKSHOP_PANEL_PREFIX, WORKSHOP_RESOURCE_PREFIX } from '../../shared/workshop.js';
import { serveMods } from './mods.js';
import { DATA_FILES } from '../data.js';
// 包声明的动态只读端点（`server.modules[*].uses` 含 `route`，DESIGN §28.32）：判据与执行都在 routeMount.js ——
// 静态处理器只负责「逐字命中就交给它」，所以这一层的三个纪律（JSON 可序列化 / 同步 / 有界）不会在别处出现第二份。
import { DYNAMIC_ROUTE_CACHE_HEADERS, runDynamicRoute, coreMounts } from './routeMount.js';

/** Browser stand-in of server/data.js, served at /data.js (see the header). Served byte for byte: its first line names the entry, server/index.js. */
export const DATA_SHIM_JS = `// Generated by server/index.js — browser stand-in for server/data.js (DESIGN §14 client-side combat).
// The simulation's content modules (/sim/content/support/index.js) import getData() from here; it returns the game data
// the page injected with /sim/simdata.js setSimData(data).
import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`;
/** Files under server/sim that are never served (Node-only). */
const SIM_PRIVATE = new Set(['nodedata.js']); // lower-case (compared case-insensitively)
/** 按房间的游戏数据 (W-B): the URL prefix and the digest shape (`shared/modIdentity.js` modDigest = sha256 hex). */
export const ROOM_DATA_PREFIX = '/room-data/';
const ROOM_DIGEST_RE = /^[0-9a-f]{64}$/;
/** 包声明的战斗逻辑模块（`server.battle`, DESIGN §28.17）的 URL 前缀 —— 与 `shared/battlePack` 的默认值同一个字符串。 */
export const WORKSHOP_BATTLE_PREFIX = '/workshop-battle/';

// ---------------------------------------------------------------------------------------------------
// Static file handler
// ---------------------------------------------------------------------------------------------------

/** Optional per-machine art manifest (tools/local-extract) and the empty stand-in served when it is absent. */
const LOCAL_ART_MANIFEST = 'local-assets.json';
const EMPTY_LOCAL_ART = Buffer.from(JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} }));

/**
 * `/workshop-kits/<pack>/<rel>` → `<packDir>/kits/<rel>` (DESIGN §28.18), or null when this URL must not be answered.
 *
 * The three-part gate, in the order that keeps every refusal indistinguishable from a file that is simply not there:
 *   1. the FIRST segment must be a LOADED pack — an uninstalled pack has no directory here at all (the table is built
 *      from `loadWorkshop`'s result), so "another pack's path" is not a special case, it is a lookup miss;
 *   2. `decoded` is already percent-decoded **exactly once** by the caller (`decodeURIComponent`), so `%2e%2e` arrives
 *      here as `..` and is refused as a segment — never re-decoded (a second decode is how `%252e%252e` becomes `..`);
 *   3. the rest must be non-empty `.js`, with no empty / `.` / `..` segment and no backslash, and the resolved path must
 *      stay under `<packDir>/kits/` — via `path.resolve` + `path.relative`, never string prefix matching (a prefix test
 *      accepts `<packDir>/kits-evil/x.js`).
 *
 * Whether the file exists is left to the caller's `readFile`: a miss and a traversal must produce the same 404 body.
 * @param {string} decoded the percent-decoded request path
 * @param {Map<string, string>|null} kitDirs pack id → `<packDir>/kits` (`workshopKitDirsFor`)
 * @returns {string|null} the absolute path, or null
 */
function resolvePackRelativeKit(decoded, kitDirs) {
  if (!kitDirs || !kitDirs.size) return null;
  const rest = decoded.slice('/workshop-kits/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;                                  // no pack segment, or no file segment
  const pack = rest.slice(0, slash);
  const rel = rest.slice(slash + 1);
  const dir = kitDirs.get(pack);
  if (!dir) return null;                                        // unknown / not-loaded pack
  if (!rel.endsWith('.js') || rel.includes('\\')) return null;
  const segments = rel.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  const abs = path.resolve(dir, ...segments);
  const back = path.relative(path.resolve(dir), abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

/**
 * Create the static request handler.
 * @param {{ publicDir: string, dataDir: string, sharedDir: string, simDir?: string, packsDir?: string,
 *   packs?: ReturnType<typeof createPackRegistry>, log?: object,
 *   workshopJson?: Map<string, Buffer>|null, workshopKitFiles?: Map<string, string>|null,
 *   workshopKitDirs?: Map<string, string>|null,
 *   workshopPanelFiles?: Map<string, string>|null, workshopAssets?: Map<string, string>|null,
 *   workshopRoutes?: Map<string, object>|null, workshopResourceFiles?: Map<string, object>|null,
 *   resourcePolicy?: 'serve'|'cache-only' }} dirs
 *   packs: the server's pack registry (default: one over publicDir, dataDir and packsDir — ROOT/packs)
 *   workshop*: the 创意工坊 tables `server/index.js` builds once per process (empty maps on a plain install, and every
 *   workshop branch below is skipped then)
 *   workshopKitDirs: pack id → its `kits/` directory (`workshopKitDirsFor`) — what makes a **relative** kit import
 *   resolvable in the browser (§28.18). Null on a plain install and on a hand-built handler, and then only the
 *   registered kit URLs are servable, exactly as before.
 *   resourcePolicy: `/assets/` + `/fonts/` answer 412 and never reach the file system when a pack declared
 *   `assets.serverPolicy: "cache-only"` (DESIGN §28.13). Defaults to `'serve'` — the pre-B3a behaviour, byte for byte.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, rawPath: string, query: string) => Promise<void>}
 */
export function createStaticHandler({
  publicDir, dataDir, sharedDir, simDir = path.join(ROOT, 'server', 'sim'),
  packsDir = path.join(ROOT, 'packs'), packs = null, log = noopLog,
  // 创意工坊 (server/http/workshop.js): the merged /data bodies, the pack kit modules, the C-layer panel modules, the
  // packs with an assets/ folder, the read-only routes the packs declare (`pack.json.routes`) and the URLs serving a
  // pack's declared resource container / manifest (`pack.json.assets`). All of them are empty maps on a plain install,
  // and every route below is skipped then.
  workshopJson = null, workshopKitFiles = null, workshopKitDirs = null, workshopAssets = null, workshopRoutes = null, workshopPanelFiles = null,
  workshopResourceFiles = null, resourcePolicy = 'serve',
  // 包给**已有语种**补的词条（`pack.json.i18n`, fanpack G-04, docs/WORKSHOP.md §1.10）：`Map<语种, Buffer>`，
  // 「官方 <code>.json + 包的新增键」合并后的体。空 map 时 `/i18n/<code>.json` 走下面普通静态路径 ——
  // 一个包都没声明 i18n 的安装与从前逐字节相同。
  workshopI18n = null,
  // 客户端 mod 本地缓存 (W-C): the catalogue route + the pack-file route (server/http/mods.js). Null on a caller that
  // builds this handler by hand (tests), and skipped then.
  modsJson = null,
  // 按房间的游戏数据 (W-B, DESIGN §28.16): `(digest) => { data } | null` from server/roomAssets.js. Null on a plain
  // install (no packs ⇒ every room runs the process data), and the `/room-data/` branch is skipped then.
  roomData = null,
  // 包声明的战斗逻辑模块（`server.battle`, DESIGN §28.17）的 URL → 磁盘文件。空 map = 没有包声明它，那条路由不服务任何
  // URL（与 `/workshop-kits/` 同一条不变量）。
  workshopBattleFiles = null,
  // 包声明的**动态只读端点**（`server.modules[*].uses` 含 `route`，DESIGN §28.32）：`Map<路径, { handler, cache,
  // pack, module }>`，由 `mountServerModules(...).routes()` 解析出来。空 Map = 没有包声明 `route`，那一段整块跳过。
  modRoutes = null,
  // 作者自备 CDN 的语音素材（DESIGN §28.33）：`Map<"<包id>/<assets 内的相对路径>", 本地缓存文件绝对路径>`，由
  // `server/voiceCdn.js materializeVoiceCdn` 在装载期建好（已经按作者声明的 sha256 核对过）。空 Map = 没有包声明
  // 过 CDN 素材，assets 分支按原来的包内路径走，逐字不变。
  voiceCdn = null,
  // 内容哈希（`server/http/assetIndex.js`）与它服务出来的清单（`server/http/assetViews.js`）：null = 没有索引
  // （`assetIndex: false` / SP_ASSET_INDEX=0），两条 ~hash 路由与两条清单视图整块跳过，行为与从前逐字节相同。
  assetIndex = null, views = null,
}) {
  const registry = packs || createPackRegistry({ publicDir, dataDir, packsDir }, { log: /** @type {any} */ (log) });
  // 挂载表只此一处真相（routeMount.js coreMounts）：`workshopRoutesFor` 判「核心先吃」时读的是**同一份**目录表，
  // 所以「谁先吃」与「谁真的住在这里」不会各说各话。
  const mounts = coreMounts({ publicDir, dataDir, sharedDir, simDir }).map((m) => (
    // the simulation: ES modules only (no directory listings, no other file types, no Node-only loader)
    m.name === 'sim' ? { ...m, only: new Set(['.js']), deny: SIM_PRIVATE } : m
  ));
  const shimBody = Buffer.from(DATA_SHIM_JS);
  const shimTag = `"shim-${shimBody.length.toString(16)}"`;
  const gzipCache = new CompressCache(); // brotli and gzip bodies (files.js)

  return async function serveStatic(req, res, rawPath, query) {
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
      sendError(req, res, 400, '请求地址无效 · Bad request');
      return;
    }
    // /assets/~<hash>/x → /assets/x (the hash decides the cache policy below)
    const hashed = splitHashedPath(decoded);
    const urlHash = hashed.hash;
    decoded = hashed.path;
    // 客户端 mod 本地缓存 (W-C): the catalogue and the pack-file route (server/http/mods.js). `serveMods` answers
    // synchronously, so an unrelated GET still falls through to the mounts below unchanged.
    if (modsJson && serveMods(req, res, decoded, query, modsJson)) return;
    if (decoded === '/data.js') {
      const headers = { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', ETag: shimTag, 'Content-Length': shimBody.length };
      if (isNotModified(req, shimTag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : shimBody);
      return;
    }
    // `assets.serverPolicy: "cache-only"`（DESIGN §28.13, docs/WORKSHOP.md §1.9.4）：一个包声明它要素材只从客户端
    // 自己的缓存取之后，`/assets/` 与 `/fonts/` **不服务、也不回源** —— 直接 412 Precondition Failed，连 stat 都不做
    // （这是刻意的：回源一次就等于那条策略不存在）。它是**部署语义**，所以是进程级的，且只在包显式声明时生效；
    // 没有任何包声明时这个分支的 `resourcePolicy` 是 `'serve'`，函数在这里的行为与 B2 之后逐字节相同。
    if (resourcePolicy === 'cache-only' && isCacheOnlyPath(decoded)) {
      sendError(req, res, 412, '资源需先从客户端导入 · Resource pack required',
        'This server serves /assets and /fonts only from a locally imported resource pack · 本服务器要求先导入完整资源包');
      return;
    }
    // 包声明的只读路由 (`pack.json.routes`, DESIGN §28.13 / docs/WORKSHOP.md §1.9)。刻意放在核心挂载之前：`path`
    // 是作者显式声明的绝对路径，命中它就是命中它 —— 一条声明过的路径不该因为磁盘上恰好有个同名核心文件而变成别的东西
    // （所以「声明了但文件不在」在下面的 stat 里是 404，不是回落）。只读、只 GET/HEAD（routes.js 已挡掉别的动词）、
    // 只 `.json`（server/http/workshop.js workshopRoutesFor 判过），并且**只有精确命中的声明路径**才会被回答 ——
    // 目录穿越在这里不是「被挡住」，而是**没有可以穿越的目标**：`..` 永远拼不出一个已声明的 key。
    if (workshopRoutes && workshopRoutes.size) {
      const route = workshopRoutes.get(decoded);
      if (route) {
        let body;
        try {
          const st = await fsp.stat(route.file);
          if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
          body = await fsp.readFile(route.file);
        } catch (e) {
          if (!e || !['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(e.code)) log.error('[workshop] route read failed', e);
          sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : '');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME['.json'], 'Content-Length': body.length,
          'Cache-Control': ROUTE_CACHE_HEADERS[route.cache] || ROUTE_CACHE_HEADERS['no-cache'],
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
    }
    // 包声明的**动态只读端点**（`server.modules[*].uses` 含 `route`，DESIGN §28.32）：与 `pack.json.routes` 的
    // 静态那一半同一条几何（只答**逐字命中**的声明路径，所以 `..` 没有可以穿越的目标），但内容由包的一个**同步**
    // 回调现算，并且这一层另有四条纪律（挂在 `server/http/routeMount.js`）：路径必须在 `/mod/<包id>/…` 里、
    // 不许落在引擎保留的命名空间里、只有 `no-store`/`no-cache`、回调必须同步返回 JSON 可序列化的值。
    // 顺序刻意排在静态 `routes` **之后**：静态那一半是「一个文件」的一一对应，动态这一半是「一台小函数」，
    // 两条通道都声明同一条路径时静态的赢（`workshopRoutesFor` 的注释解释过那条「声明过的路径就是那条路径」）。
    if (modRoutes && modRoutes.size) {
      const entry = modRoutes.get(decoded);
      if (entry) {
        const result = runDynamicRoute(entry.handler);
        if (!result.ok) {
          log.warn?.(`[workshop] ${entry.pack}/${entry.module} route "${decoded}": ${result.reason}`);
          sendError(req, res, 500, '服务器内部错误 · Internal error');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME['.json'], 'Content-Length': result.body.length,
          'Cache-Control': DYNAMIC_ROUTE_CACHE_HEADERS[entry.cache] || DYNAMIC_ROUTE_CACHE_HEADERS['no-store'],
        });
        res.end(req.method === 'HEAD' ? undefined : result.body);
        return;
      }
    }
    // 按房间的游戏数据（W-B, DESIGN §28.16）：一个**声明了自己模组集合**的房间跑的是「官方 + 它点名的那几个包」，
    // 而 `/data/*.json` 送的是「官方 + 全部已装包」。所以这一局的对局数据从这里取：`/room-data/<摘要>/<文件>.json`。
    // 只有**真的有房间声明过的摘要**会被回答（`createRoomAssets.byDigest`），所以客户端编不出一个组合让服务器去合并 ——
    // 未登记摘要与未登记文件名一律 404，文件名白名单就是 `/data/` 那一份（DATA_FILES）。
    if (roomData && decoded.startsWith(ROOM_DATA_PREFIX) && decoded.endsWith('.json')) {
      const rest = decoded.slice(ROOM_DATA_PREFIX.length);
      const slash = rest.indexOf('/');
      const digest = slash > 0 ? rest.slice(0, slash).toLowerCase() : '';
      const name = slash > 0 ? rest.slice(slash + 1, -'.json'.length) : '';
      const set = ROOM_DIGEST_RE.test(digest) && DATA_FILES.includes(name) ? roomData(digest) : null;
      const rec = set && set.data && Object.hasOwn(set.data, name) ? set.data[name] : null;
      if (rec !== null && rec !== undefined) {
        const buf = Buffer.from(JSON.stringify(rec), 'utf8');
        const tag = `"room-${createHash('sha1').update(digest).update(buf).digest('hex').slice(0, 20)}"`;
        const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: tag, 'Content-Length': buf.length };
        if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : buf);
        return;
      }
      sendError(req, res, 404, '页面不存在 · Not found');
      return;
    }
    // 创意工坊 (docs/WORKSHOP.md): a data file a workshop pack touches is served MERGED (official + packs), so the
    // browser's data (public/js/data.js) and the server's (server/data.js) are the same object. A file no pack touches
    // keeps the plain on-disk path below, so a normal install stays byte-for-byte unchanged.
    if (workshopJson && workshopJson.size && decoded.startsWith('/data/') && decoded.endsWith('.json')) {
      const name = decoded.slice('/data/'.length, -'.json'.length);
      const buf = name && !name.includes('/') ? workshopJson.get(name) : null;
      if (buf) {
        const tag = `"ws-${createHash('sha1').update(buf).digest('hex').slice(0, 20)}"`;
        const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: tag, 'Content-Length': buf.length };
        if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : buf);
        return;
      }
    }
    // 包给**已有语种**补的词条（`pack.json.i18n`, fanpack G-04, docs/WORKSHOP.md §1.10）：`/i18n/<code>.json` 在
    // 有包声明时送**合并体**（官方文件 + 包的新增键，已有键绝不覆盖），与上面 `/data/*.json` 逐字同一条纪律
    // —— 客户端读的就是这个 URL（public/js/ui/lang.js），而 `public/i18n/<code>.json` 一个字节都不改。
    // 没有包声明 i18n 时这张表是空的 ⇒ 请求落到下面的普通静态路径，行为逐字节不变。
    if (workshopI18n && workshopI18n.size && decoded.startsWith('/i18n/') && decoded.endsWith('.json')) {
      const code = decoded.slice('/i18n/'.length, -'.json'.length);
      const buf = code && !code.includes('/') ? workshopI18n.get(code) : null;
      if (buf) {
        const tag = `"ws-i18n-${createHash('sha1').update(buf).digest('hex').slice(0, 20)}"`;
        const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: tag, 'Content-Length': buf.length };
        if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : buf);
        return;
      }
    }
    // 包声明的**战斗逻辑**模块（`pack.json.server.battle`, DESIGN §28.17）：与 `/workshop-kits/` 同一条通道，
    // 但**只服务装载器登记过的 URL**，不放宽成「包内子树」——这是 §28.18 那份不对称的另一半：kit 可以 import 自己的
    // 兄弟文件（`./lib/util.js`），战斗逻辑模块不行（服务端把它当 data: URL 加载，data: 没有目录，相对路径无从解析），
    // 所以它也没有需要「按 URL 解出包内相对路径」的第二个消费者，登记表就是它全部的入口。包内路径可以是子目录，
    // 所以这里的键是完整 URL 而不是文件名。
    if (workshopBattleFiles && workshopBattleFiles.size && decoded.startsWith(WORKSHOP_BATTLE_PREFIX)) {
      const abs = workshopBattleFiles.get(decoded);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] battle module read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 工坊行为层 (docs/WORKSHOP.md §4, DESIGN §28.18): serve a pack's kit module as an ES module, so the BROWSER runs
    // the very code the server runs. Two halves:
    //   * a URL the loader registered → the kit file itself, exactly as before;
    //   * `<包>/<rel>` where `<包>` is a LOADED pack → `<packDir>/kits/<rel>`, so a kit may import its OWN siblings
    //     with a downward relative specifier (`./lib/util.js` → `/workshop-kits/<pack>/lib/util.js`). This is the
    //     geometry §28.18 rests on: on disk that specifier means `<packDir>/kits/lib/util.js` and in the URL it means
    //     `/workshop-kits/<pack>/lib/util.js` — the same file, because the `kits/` segment is not in the URL and this
    //     branch adds it back. A `..` specifier can never agree (`../x.js` would have to walk out of the URL prefix,
    //     which is a different amount of walking than on disk), so `..` stays refused by the verdict AND here.
    // Discipline, unchanged: only a loaded pack, only `.js`, only a regular file, and the resolved path must stay
    // inside `<packDir>/kits/` (decided with `path.resolve` + `path.relative`, never by string prefix matching).
    // Unknown pack, traversal, a non-`.js` file and a missing file all answer the SAME 404 — never reveal existence.
    if (workshopKitFiles && workshopKitFiles.size && decoded.startsWith('/workshop-kits/')) {
      const abs = workshopKitFiles.get(decoded) ?? resolvePackRelativeKit(decoded, workshopKitDirs);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] kit read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 包声明的资源容器与清单（`pack.json.assets`, DESIGN §28.13, docs/WORKSHOP.md §1.9.4）：`/workshop-resources/`
    // 下**只有装载器注册过的两个 URL** 会被回答 —— 未注册 / 穿越 / 不在声明里的路径一律 404，所以目录穿越在这里
    // 不是「被挡住」，而是**没有可以穿越的目标**（键就是那两个 URL 字符串）。与 `/workshop-panels/`、
    // `/workshop-kits/` 同一条纪律，只是这次送的是**字节**：容器可达数百 MB，所以它**流式**出去（`createReadStream`
    // + `pipeline`），绝不整读进内存；清单小，照读。
    // `?v=<hash12>` 是缓存键（与面板模块同一条）：重新打包 = 新 URL，所以 `Cache-Control: no-cache` 足够 —— 浏览器
    // 可以留着，但每次要回来问一次，一次部署也因此能到达已经打开的页面（public/js/ui/buildGuard.js）。
    if (workshopResourceFiles && workshopResourceFiles.size && decoded.startsWith(WORKSHOP_RESOURCE_PREFIX)) {
      const entry = workshopResourceFiles.get(decoded);
      if (!entry) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let st;
      try {
        st = await fsp.stat(entry.file);
        if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      } catch (e) {
        if (!e || !['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(e.code)) log.error('[workshop] resource stat failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      /** @type {Record<string, string|number>} */
      const headers = {
        'Content-Type': entry.kind === 'manifest' ? MIME['.json'] : 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      };
      // The digest the loader verified (`server/workshop.js assetsIssues`), stated on the wire so a downloader can
      // check the bytes it received against the same value the server checked them against — no second hashing pass.
      if (entry.sha256) headers['X-SP-Resource-Sha256'] = entry.sha256;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      try {
        await pipeline(fs.createReadStream(entry.file), res);
      } catch (e) {
        // The headers are gone by now, so the only honest answer is to cut the connection: a truncated body with a
        // 200 and a full Content-Length is exactly what a client cannot detect.
        log.error('[workshop] resource stream failed', e);
        res.destroy();
      }
      return;
    }
    // C 层注册点 (DESIGN §28.8, docs/WORKSHOP.md §1.9.3): a pack's panel module, served as an ES module the BROWSER
    // imports — the twin of the kit route below, and the reason `/workshop-assets` can keep refusing `.js`. Only URLs
    // the loader registered are servable, and only `.js` ones ever entered that map; the request path is the DECODED
    // one, so a module whose name needs percent-encoding is addressed by the same string the loader built.
    //
    // Since the owner's ruling of 2026-10-10 the same route also serves a panel's OWN stylesheets (`.css`): a
    // declaration that brings a whole new component (`chat.css` in the reference pack is 21 KB of it) cannot be
    // expressed as theme variables. Same registration rule, same `?v=` cache-busting, different MIME — and `.css`
    // entering this map is why the check below is an extension pair rather than the single `.js` it used to be.
    const panelExt = decoded.endsWith('.css') ? '.css' : decoded.endsWith('.js') ? '.js' : '';
    if (workshopPanelFiles && workshopPanelFiles.size && decoded.startsWith(WORKSHOP_PANEL_PREFIX) && panelExt) {
      const abs = workshopPanelFiles.get(decoded);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] panel read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      // `no-cache` and not `public`: a panel module is code, and the URL already carries the pack's content hash as
      // `?v=` (a repack means a new URL), so a cached copy can never be stale — but a browser holding one without
      // revalidation is how a deploy reaches an open tab (ui/buildGuard.js).
      const type = panelExt === '.css' ? 'text/css; charset=utf-8' : MIME['.js'];
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 工坊素材 (docs/WORKSHOP.md §5): a pack's OWN art, served read-only from `<pack>/assets/**`. This is the one hole
    // in "the repo ships no game assets": a pack may carry its own (a licence-cleared sprite, a custom icon, a voice
    // line), and the CLIENT has to be able to fetch it or the content cannot render. It is deliberately narrow:
    //   * only the registered packs, and only their `assets/` subtree — never the pack's data, kits or manifest;
    //   * an extension allowlist, so the folder can never serve a script the page would then execute;
    //   * no directory listing, and `..` / dot-segments are refused before the path is built.
    if (workshopAssets && workshopAssets.size && decoded.startsWith(WORKSHOP_ASSET_PREFIX)) {
      const rel = decoded.slice(WORKSHOP_ASSET_PREFIX.length);
      const segments = rel.split('/').filter((s) => s.length > 0);
      const pack = segments.shift();
      const bad = !pack || !workshopAssets.has(pack) || !segments.length
        || segments.some((s) => s === '..' || s === '.' || s.startsWith('.'));
      const ext = bad ? '' : path.extname(segments[segments.length - 1]).toLowerCase();
      // 作者自备 CDN 的语音素材（DESIGN §28.33）：装载期已经按作者声明的 sha256 核对过、落在
      // `<状态目录>/voice-cdn/<sha256>` 的那几条，从这里**替掉**包内路径。键与 URL 逐字同形
      // （`<包id>/<assets 内的相对路径>`），所以客户端看见的 URL 与「素材本来就在包里」时一模一样 ——
      // 没有新路由，也没有任何内置的素材地址（引擎只认 pack.json 里作者写的那条 https URL）。
      const overridden = !bad && ext && voiceCdn && voiceCdn.size ? voiceCdn.get(rel) : null;
      if (!overridden && (bad || !WORKSHOP_ASSET_TYPES.has(ext))) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let abs;
      if (overridden) {
        abs = overridden;
      } else {
        const dir = path.join(workshopAssets.get(pack), 'assets');
        abs = path.join(dir, ...segments);
        if (abs !== dir && !abs.startsWith(dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
      }
      let body;
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) throw new Error('not a file');
        body = await fsp.readFile(abs);
      } catch { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      // a pack's art is immutable in practice (a repack ships a new version) and can be large: cache it like /assets/
      res.writeHead(200, {
        'Content-Type': WORKSHOP_ASSET_TYPES.get(ext) || 'application/octet-stream', 'Content-Length': body.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // Content packs (server/packs.js): the live index, and only the files a pack's manifest names
    if (decoded.startsWith(PACKS_URL)) {
      const parts = decoded.slice(PACKS_URL.length).split('/');
      if (parts.length === 1 && parts[0] === PACK_INDEX_FILE) { sendJson(req, res, 200, registry.index()); return; }
      const abs = parts.length >= 2 && !parts.some((s) => s === '' || s === '.' || s === '..') ? registry.servable(parts[0], parts.slice(1).join('/')) : null;
      const st = abs ? await fsp.stat(abs).catch(() => null) : null;
      if (!st || !st.isFile()) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      await serveFile(req, res, abs, st, 'packs', parts, query, gzipCache, log);
      return;
    }
    // Extension-less audio (download-manager avoidance): /media/bgm/act1 → /assets/audio/bgm/act1.mp3
    if (decoded.startsWith(MEDIA_PREFIX)) {
      await serveMedia(req, res, decoded.slice(MEDIA_PREFIX.length), query, publicDir, gzipCache, log, { urlHash, assetIndex });
      return;
    }
    // The served manifests: every art URL with its content hash (assetViews.js), once the index is ready
    if (views && (decoded === '/data/assets.json' || decoded === '/data/local-assets.json')) {
      const view = await views.get(decoded.slice('/data/'.length));
      if (view) {
        await serveBuffer(req, res, { body: view.body, hash: view.hash, type: MIME['.json'], cacheControl: 'no-cache', key: `view:${decoded}`, cache: gzipCache });
        return;
      }
    }
    // Bare mount paths (e.g. "/data") → treat as the mount directory.
    const mount = mounts.find((m) => decoded.startsWith(m.prefix) || decoded === m.prefix.slice(0, -1)) || mounts[mounts.length - 1];
    const rest = decoded.length > mount.prefix.length ? decoded.slice(mount.prefix.length) : '';
    const segments = rest.split('/').filter((s) => s.length > 0);
    if (segments.some((s) => s === '..' || s === '.')) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
    if (segments.some((s) => s.startsWith('.'))) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
    if (mount.only && (!segments.length || !mount.only.has(path.extname(segments[segments.length - 1]).toLowerCase())
      // (case-insensitive: the host may be Windows / macOS, where NODEDATA.JS opens nodeData.js)
      || (mount.deny && mount.deny.has(segments[segments.length - 1].toLowerCase())))) {
      sendError(req, res, 404, '页面不存在 · Not found');
      return;
    }
    let absPath = path.join(mount.dir, ...segments);
    if (absPath !== mount.dir && !absPath.startsWith(mount.dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }

    let stat;
    let viaDirectory = false;
    try {
      stat = await fsp.stat(absPath);
      if (stat.isDirectory()) {
        if (!decoded.endsWith('/')) {
          // Built from normalized segments (never from the raw path) so "//host" can't become an open redirect.
          const loc = (mount.prefix + segments.map(encodeURIComponent).join('/') + '/').replace(/\/{2,}/g, '/');
          res.writeHead(301, { Location: loc + (query ? `?${query}` : ''), 'Cache-Control': 'no-cache', 'Content-Length': 0 });
          res.end();
          return;
        }
        absPath = path.join(absPath, 'index.html');
        segments.push('index.html');
        viaDirectory = true;
        stat = await fsp.stat(absPath);
      }
      // Not a regular file, or a file addressed like a directory ("/app.js/") → 404.
      if (!stat.isFile() || (decoded.endsWith('/') && !viaDirectory)) {
        throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      }
      if (mount.deny) {
        // the on-disk name decides (case-insensitive file systems, Windows 8.3 short names like NODEDA~1.JS)
        const real = await fsp.realpath(absPath);
        if (mount.deny.has(path.basename(real).toLowerCase())) throw Object.assign(new Error('private'), { code: 'ENOENT' });
      }
    } catch (e) {
      if (e && e.code === 'ENOENT' && mount.name === 'data' && segments.length === 1 && segments[0] === LOCAL_ART_MANIFEST) {
        // Optional local-client art (DESIGN §13): an install without it gets an empty manifest instead of a 404,
        // so browsers don't log an error on every page load. Clients treat empty groups as "no local art".
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', 'Content-Length': EMPTY_LOCAL_ART.length });
        res.end(req.method === 'HEAD' ? undefined : EMPTY_LOCAL_ART);
      } else if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EISDIR' || e.code === 'ENAMETOOLONG')) {
        sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : '');
      } else if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
        sendError(req, res, 403, '禁止访问 · Forbidden');
      } else {
        log.error('[http] stat failed', e);
        sendError(req, res, 500, '服务器内部错误 · Internal error');
      }
      return;
    }
    const indexed = mount.name === 'public' && segments.length > 1 && ASSET_INDEX_ROOTS.includes(segments[0]);
    const opts = indexed ? hashedFileOpts(assetIndex, segments.join('/'), stat, urlHash) : (urlHash ? { cacheControl: 'no-cache' } : {});
    await serveFile(req, res, absPath, stat, mount.name, segments, query, gzipCache, log, opts);
  };
}
