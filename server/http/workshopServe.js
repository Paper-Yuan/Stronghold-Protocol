// server/http/workshopServe.js — 创意工坊 (docs/WORKSHOP.md) 与客户端 mod 缓存 (server/http/mods.js) 的 HTTP 层。
//
// 这一层在 server/http/customStatic.js 里**先于**上游的静态挂载被问一次：命中就回答，未命中返回 false，请求原样落到
// 上游的 /assets、/data、/packs 挂载上。所以没有安装任何工坊包的服务器逐字节与上游一致（表全空 ⇒ 每个分支都被跳过）。
//
// 逐条迁移自 server/http/static.js 的 2bed2e7f 版 —— 合并时那个文件整体取了上游实现，整套路由随之丢失。拆成独立文件
// 是有意的：上游重写 static.js 时这里不受影响。
//
// 本文件目前**不含**三段（都属于房间 / 服务端模块的读路径，与「客户端拉取 mod」这条主线无关）：
//   * `/mod/<包id>/…` 动态只读端点（需要 server/http/routeMount.js 的 mountServerModules）
//   * `/room-data/<digest>/<name>.json`（需要 server/roomAssets.js 的房间资源层）
//   * 包自备 CDN 语音的 voiceCdn 覆盖（需要装载器核验过的状态目录）
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

import { MIME, isNotModified } from './files.js';
import { sendError } from './common.js';
import { serveMods, createModsRoute } from './mods.js';
import {
  buildWorkshopDataFiles, buildWorkshopI18nFiles, workshopAssetsFor, workshopBattleFilesFor,
  workshopKitDirsFor, workshopKitFilesFor, workshopPanelFilesFor, workshopResourceFilesFor,
  workshopRoutesFor, WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES, ROUTE_CACHE_HEADERS, isCacheOnlyPath,
} from './workshop.js';
import { WORKSHOP_PANEL_PREFIX, WORKSHOP_RESOURCE_PREFIX } from '../../shared/workshop.js';
import { WORKSHOP_DIR, loadWorkshop, loadWorkshopKits, loadWorkshopPanels } from '../workshop.js';
import { buildModCatalog } from '../modCatalog.js';

/** 包声明的战斗逻辑模块（`pack.json.server.battle`, DESIGN §28.17）的 URL 前缀。 */
export const WORKSHOP_BATTLE_PREFIX = '/workshop-battle/';

/**
 * `/workshop-kits/<pack>/<rel>` → `<packDir>/kits/<rel>` (DESIGN §28.18), or null when this URL must not be answered.
 * 三道闸（2bed2e7f server/http/static.js 原文）：第一段必须是**已装载**的包；`decoded` 已由调用方
 * `decodeURIComponent` 恰好解码一次；其余部分必须是非空 `.js`、无空/`.`/`..` 段、无反斜杠，且解析结果留在
 * `<packDir>/kits/` 之内（用 `path.resolve` + `path.relative` 判，不做字符串前缀比较）。文件在不在由调用方的
 * `readFile` 决定：缺失与穿越给出**同一个** 404。
 * @param {string} decoded
 * @param {Map<string, string>|null} kitDirs pack id → `<packDir>/kits`
 * @returns {string|null}
 */
function resolvePackRelativeKit(decoded, kitDirs) {
  if (!kitDirs || !kitDirs.size) return null;
  const rest = decoded.slice('/workshop-kits/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const pack = rest.slice(0, slash);
  const rel = rest.slice(slash + 1);
  const dir = kitDirs.get(pack);
  if (!dir) return null;
  if (!rel.endsWith('.js') || rel.includes('\\')) return null;
  const segments = rel.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  const abs = path.resolve(dir, ...segments);
  const back = path.relative(path.resolve(dir), abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

/**
 * 装载一次工坊并建好所有服务表（进程级，`server/index.js` 启动时调一次）。
 * @param {{ data?: any, workshopDir?: string, log?: any, mount?: Array<{prefix: string, name?: string, dir?: string}> }} o
 * @returns {Promise<{ tables: object, errors: Array<object> }>}
 */
export async function createWorkshopServe({ data = null, workshopDir = WORKSHOP_DIR, log = console, mount = [] } = {}) {
  const loaded = loadWorkshop(workshopDir, { log });
  const knownIds = new Set([
    ...Object.keys((data && data.chess) || {}),
    ...((loaded.packs || []).flatMap((p) => Object.keys(p.operators || {}))),
  ]);
  const kits = await loadWorkshopKits(loaded, { log, knownIds });
  const panels = loadWorkshopPanels(loaded, { log });
  const catalog = buildModCatalog(loaded);
  const routes = workshopRoutesFor(loaded, workshopDir, { log, mount });
  const tables = {
    modsJson: createModsRoute(loaded, catalog),
    workshopRoutes: routes.routes,
    workshopJson: buildWorkshopDataFiles(data, loaded),
    workshopI18n: buildWorkshopI18nFiles(loaded, { log }),
    workshopBattleFiles: workshopBattleFilesFor(kits.modules, workshopDir),
    workshopKitFiles: workshopKitFilesFor(kits.modules, workshopDir),
    workshopKitDirs: workshopKitDirsFor(loaded),
    workshopPanelFiles: workshopPanelFilesFor(panels, workshopDir),
    workshopResourceFiles: workshopResourceFilesFor(loaded.packs || [], workshopDir),
    workshopAssets: workshopAssetsFor(loaded, workshopDir),
    resourcePolicy: 'serve',
  };
  return { tables, errors: routes.errors, packs: loaded.packs || [], catalog };
}

/**
 * 回答一条工坊 / mod 缓存 URL。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} decoded 已解码的路径
 * @param {string} query
 * @param {object} t createWorkshopServe 的 tables
 * @param {any} [log]
 * @returns {boolean} true = 已在这里回答（可能仍在飞行中）
 */
export function serveWorkshop(req, res, decoded, query, t, log = console) {
  // 客户端 mod 本地缓存 (W-C): the catalogue and the pack-file route. `serveMods` answers synchronously, so an
  // unrelated GET still falls through to the mounts behind this layer unchanged.
  if (t.modsJson && serveMods(req, res, decoded, query, t.modsJson)) return true;
  // `assets.serverPolicy: "cache-only"`（DESIGN §28.13, docs/WORKSHOP.md §1.9.4）：包声明素材只从客户端自己的缓存取，
  // 于是 /assets 与 /fonts **不服务也不回源** —— 直接 412，连 stat 都不做。没有任何包声明时 resourcePolicy 是 'serve'。
  if (t.resourcePolicy === 'cache-only' && isCacheOnlyPath(decoded)) {
    sendError(req, res, 412, '资源需先从客户端导入 · Resource pack required',
      'This server serves /assets and /fonts only from a locally imported resource pack · 本服务器要求先导入完整资源包');
    return true;
  }
  // 包声明的只读路由 (`pack.json.routes`, DESIGN §28.13)。只答**精确命中**的声明路径：`..` 永远拼不出一个已声明的 key，
  // 所以目录穿越在这里不是被挡住而是没有目标。只读、只 GET/HEAD、只 .json（workshopRoutesFor 判过）。
  if (t.workshopRoutes && t.workshopRoutes.size) {
    const route = t.workshopRoutes.get(decoded);
    if (route) {
      const body = fs.existsSync(route.file) && fs.statSync(route.file).isFile() ? fs.readFileSync(route.file) : null;
      if (!body) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return true; }
      res.writeHead(200, {
        'Content-Type': MIME['.json'], 'Content-Length': body.length,
        'Cache-Control': ROUTE_CACHE_HEADERS[route.cache] || ROUTE_CACHE_HEADERS['no-cache'],
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    }
  }
  // 包 touch 过的 /data/<file>.json 送**合并体**（官方 + 包），使浏览器的 data (public/js/data.js) 与服务端的
  // (server/data.js) 是同一个对象；没有包 touch 的文件落到上游挂载，普通安装逐字节不变。
  if (t.workshopJson && t.workshopJson.size && decoded.startsWith('/data/') && decoded.endsWith('.json')) {
    const name = decoded.slice('/data/'.length, -'.json'.length);
    const buf = name && !name.includes('/') ? t.workshopJson.get(name) : null;
    if (buf) return sendBuffer(req, res, buf, 'ws', MIME['.json'], 'no-cache');
  }
  // 包给**已有语种**补的词条 (`pack.json.i18n`, docs/WORKSHOP.md §1.10)：/i18n/<code>.json 送合并体（已有键绝不覆盖），
  // 客户端读的就是这个 URL，而 public/i18n/<code>.json 一个字节都不改。
  if (t.workshopI18n && t.workshopI18n.size && decoded.startsWith('/i18n/') && decoded.endsWith('.json')) {
    const code = decoded.slice('/i18n/'.length, -'.json'.length);
    const buf = code && !code.includes('/') ? t.workshopI18n.get(code) : null;
    if (buf) return sendBuffer(req, res, buf, 'ws-i18n', MIME['.json'], 'no-cache');
  }
  // 包声明的战斗逻辑模块：只服务装载器**登记过的 URL**（不放宽成「包内子树」——它被当作 data: URL 加载，没有目录）。
  if (t.workshopBattleFiles && t.workshopBattleFiles.size && decoded.startsWith(WORKSHOP_BATTLE_PREFIX)) {
    return sendFile(req, res, t.workshopBattleFiles.get(decoded) || null, MIME['.js'], 'no-cache', log, '[workshop] battle module');
  }
  // 工坊行为层 (docs/WORKSHOP.md §4, DESIGN §28.18)：把包的 kit 作为 ES 模块发给**浏览器**。两半：登记过的 URL → kit
  // 文件本身；`<包>/<rel>` 且 <包> 是已装载包 → `<packDir>/kits/<rel>`，于是 kit 可以用向下的相对说明符 import 自己的
  // 兄弟文件（`./lib/util.js` → `/workshop-kits/<pack>/lib/util.js`，同一个文件，因为 `kits/` 那一段不在 URL 里）。
  // 纪律不变：只有已装载的包、只有 .js、只有普通文件，且解析结果留在 `<packDir>/kits/` 内。未知包 / 穿越 / 非 .js /
  // 文件缺失都答**同一个** 404。
  if (t.workshopKitFiles && t.workshopKitFiles.size && decoded.startsWith('/workshop-kits/')) {
    const abs = t.workshopKitFiles.get(decoded) ?? resolvePackRelativeKit(decoded, t.workshopKitDirs);
    return sendFile(req, res, abs, MIME['.js'], 'no-cache', log, '[workshop] kit');
  }
  // 包声明的资源容器与清单 (`pack.json.assets`, DESIGN §28.13)：/workshop-resources/ 下**只有装载器注册过的 URL**
  // 会被回答。容器可达数百 MB，所以**流式**出去（createReadStream + pipeline），绝不整读进内存。
  if (t.workshopResourceFiles && t.workshopResourceFiles.size && decoded.startsWith(WORKSHOP_RESOURCE_PREFIX)) {
    const entry = t.workshopResourceFiles.get(decoded);
    if (!entry) { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
    let st;
    try {
      st = fs.statSync(entry.file);
      if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    } catch (e) {
      if (!e || !['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(e.code)) log.error?.('[workshop] resource stat failed', e);
      sendError(req, res, 404, '页面不存在 · Not found');
      return true;
    }
    /** @type {Record<string, string|number>} */
    const headers = {
      'Content-Type': entry.kind === 'manifest' ? MIME['.json'] : 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    };
    // 装载器核验过的摘要（server/workshop.js assetsIssues）写在线上，下载方可以拿它比对收到的字节。
    if (entry.sha256) headers['X-SP-Resource-Sha256'] = entry.sha256;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    pipeline(fs.createReadStream(entry.file), res).catch((e) => {
      // 响应头已经发出去了，唯一诚实的答案就是断开连接（带 200 与完整 Content-Length 的截断体正是客户端发现不了的）。
      log.error?.('[workshop] resource stream failed', e);
      res.destroy();
    });
    return true;
  }
  // C 层注册点 (DESIGN §28.8)：包的 panel 模块（以及 panel 自带的 .css），作为浏览器 import 的 ES 模块发出 ——
  // 只有装载器登记过的 URL 可服务，且请求路径就是解码后的那一个。`no-cache` 而非 `public`：URL 已带包的 ?v=hash，
  // 重新打包就是新 URL，但浏览器手里那份不回来问一次，部署就够不到已经打开的标签页（ui/buildGuard.js）。
  const panelExt = decoded.endsWith('.css') ? '.css' : decoded.endsWith('.js') ? '.js' : '';
  if (t.workshopPanelFiles && t.workshopPanelFiles.size && decoded.startsWith(WORKSHOP_PANEL_PREFIX) && panelExt) {
    const type = panelExt === '.css' ? 'text/css; charset=utf-8' : MIME['.js'];
    return sendFile(req, res, t.workshopPanelFiles.get(decoded) || null, type, 'no-cache', log, '[workshop] panel');
  }
  // 工坊素材 (docs/WORKSHOP.md §5)：包自带的 art，从 `<pack>/assets/**` 只读发出 —— 「仓库不带游戏素材」上唯一的洞。
  // 刻意窄：只有登记的包、只有它们的 assets/ 子树；扩展名白名单（这个目录永远发不出页面会执行的脚本）；不列目录，
  // `..` 与点段在拼路径之前就被拒。
  if (t.workshopAssets && t.workshopAssets.size && decoded.startsWith(WORKSHOP_ASSET_PREFIX)) {
    const rel = decoded.slice(WORKSHOP_ASSET_PREFIX.length);
    const segments = rel.split('/').filter((s) => s.length > 0);
    const pack = segments.shift();
    const bad = !pack || !t.workshopAssets.has(pack) || !segments.length
      || segments.some((s) => s === '..' || s === '.' || s.startsWith('.'));
    const ext = bad ? '' : path.extname(segments[segments.length - 1]).toLowerCase();
    if (bad || !WORKSHOP_ASSET_TYPES.has(ext)) { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
    const dir = path.join(t.workshopAssets.get(pack), 'assets');
    const abs = path.join(dir, ...segments);
    if (abs !== dir && !abs.startsWith(dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return true; }
    let body;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) throw new Error('not a file');
      body = fs.readFileSync(abs);
    } catch { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
    // 包的 art 实际上是不可变的（重新打包就是新版本）而且可能很大：按 /assets/ 的方式缓存。
    res.writeHead(200, {
      'Content-Type': WORKSHOP_ASSET_TYPES.get(ext) || 'application/octet-stream', 'Content-Length': body.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
  return false;
}

/** 200/304 一个小 Buffer（`/data` 与 `/i18n` 的合并体共用）。 */
function sendBuffer(req, res, buf, tagPrefix, type, cache) {
  const tag = `"${tagPrefix}-${createHash('sha1').update(buf).digest('hex').slice(0, 20)}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: tag, 'Content-Length': buf.length };
  if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return true; }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}

/** 200/404 一个文件（kit / panel / battle 三条 ES 模块通道共用；未知包与缺失文件同一个 404）。 */
function sendFile(req, res, abs, type, cache, log, what) {
  if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
  let body;
  try {
    body = fs.readFileSync(abs);
  } catch (e) {
    log.error?.(`${what} read failed`, e);
    sendError(req, res, 404, '页面不存在 · Not found');
    return true;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
