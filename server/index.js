// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the content packs (/packs/index.json, /packs/<id>/<file> — the registry is packs.js)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json and /data/local-assets.json: every art URL with its hash segment
//                      (/assets/~<hash>/…, immutable when the hash matches); the committed files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400 / 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { send } from './net.js';
import { Announcements } from './announcements.js';
import { AdminService, recordAdminLog } from './admin.js';
import { mountPlayerAdmin } from './playerAdmin.js';
import { createPublicApi } from './publicApi.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';
import { sendJson, sendError, splitUrl, answerClientError } from './http/common.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom, netOptionsFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { DATA_SHIM_JS } from './http/static.js';
import { createStaticHandler } from './http/customStatic.js';
import { createPackRegistry } from './packs.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { getData, loadData } from './data.js';
import { loadWorkshop, loadWorkshopKits, loadWorkshopPanels, WORKSHOP_DIR } from './workshop.js';
import { createRoomAssets } from './roomAssets.js';
import { buildModCatalog } from './modCatalog.js';
import { createModsRoute } from './http/mods.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';
import { workshopAssetsFor, workshopKitFilesFor, workshopKitDirsFor, workshopResourceFilesFor, buildWorkshopDataFiles, buildWorkshopI18nFiles, workshopBattleFilesFor } from './http/workshop.js';
import { modSetOf } from '../shared/modIdentity.js';
import { createZipFromDir } from './simpleZip.js';

export { rewriteAssetPaths } from '../shared/cdn.js';

const MAX_URL_LENGTH = 4096;

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > limit) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isPrivateAddress(addr) {
  if (!addr) return false;
  const a = String(addr).toLowerCase().replace(/^::ffff:/, '');
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const o1 = +v4[1];
    const o2 = +v4[2];
    return o1 === 10 || o1 === 127 || (o1 === 192 && o2 === 168) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 100 && o2 >= 64 && o2 <= 127) // RFC 6598 CGNAT (Tailscale, ZeroTier, UU 等虚拟专网)
      || (o1 === 169 && o2 === 254);
  }
  return /^f[cd][0-9a-f]{1,2}:/.test(a); // IPv6 unique-local (fc00::/7)
}

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir } = serveDirs(opts);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const netOptions = netOptionsFrom(opts);
  const origInfo = log.info;
  const origWarn = log.warn;
  const origError = log.error;
  log.info = (...args) => { recordAdminLog('info', args.map(String).join(' ')); return origInfo?.apply(log, args); };
  log.warn = (...args) => { recordAdminLog('warn', args.map(String).join(' ')); return origWarn?.apply(log, args); };
  log.error = (...args) => { recordAdminLog('error', args.map(String).join(' ')); return origError?.apply(log, args); };

  // 创意工坊 Workshop 初始化
  const workshopDir = opts.workshopDir || process.env.SP_WORKSHOP || WORKSHOP_DIR;
  const workshopLoaded = loadWorkshop(workshopDir, { log });
  const workshopKits = await loadWorkshopKits(workshopLoaded, {
    log,
    knownIds: new Set([
      ...Object.keys(data.chess || {}),
      ...((workshopLoaded.packs || []).flatMap((p) => Object.keys(p.operators || {}))),
    ]),
  });
  const workshopMods = (workshopLoaded.packs || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    hash: p.hash,
    layer: p.layer,
    combat: !!p.combat,
    operators: Object.keys(p.operators || {}),
  }));
  const roomAssets = createRoomAssets({
    dataDir,
    official: loadData(dataDir, { log, workshopDir: null }),
    processData: data,
    packs: workshopLoaded.packs || [],
    kits: workshopKits.kits,
    kitOwners: workshopKits.owners,
    tokenKits: workshopKits.tokenKits,
    tokenKitOwners: workshopKits.tokenOwners,
    modules: workshopKits.modules,
    log,
  });

  const workshopModSet = workshopMods.length ? modSetOf(workshopMods) : null;
  const workshopState = {
    packs: workshopLoaded.packs,
    mods: workshopMods,
    modSet: workshopModSet,
    kits: workshopKits.kits,
    tokenKits: workshopKits.tokenKits,
    modules: workshopKits.modules,
    roomAssets,
  };

  const { registry, lobby, network } = createSessionStack(opts, { data, log, workshop: workshopState });
  lobby.network = network;

  // content packs (docs/PACKS.md): scanned now — the start log names them — and again whenever their folders change
  const packs = createPackRegistry({ publicDir, dataDir, packsDir }, { log });
  packs.refresh(true);

  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = assetIndex ? createManifestViews({ dataDir, index: assetIndex, log }) : null;
  const workshopKitFiles = workshopKitFilesFor(workshopKits.modules, workshopDir);
  const workshopKitDirs = workshopKitDirsFor(workshopLoaded);
  const workshopAssets = workshopAssetsFor(workshopLoaded, workshopDir);
  const workshopResourceFiles = workshopResourceFilesFor(workshopLoaded.packs, workshopDir);

  const workshopJson = buildWorkshopDataFiles(data, workshopLoaded);
  const workshopI18n = buildWorkshopI18nFiles(workshopLoaded, { log });
  const workshopBattleFiles = workshopBattleFilesFor(workshopKits.modules, workshopDir);
  const roomData = roomAssets ? (digest) => roomAssets.byDigest(digest) : null;

  const cdnBase = process.env.SP_ASSETS_CDN || 'https://downcdn.jiangjiangze.icu';
  const modCatalog = buildModCatalog(workshopLoaded);
  const modsJson = createModsRoute(workshopLoaded, modCatalog);
  const serveStatic = createStaticHandler({
    publicDir, dataDir, sharedDir, packsDir, packs, log, assetIndex, views, cdnBase,
    workshopJson, workshopI18n, workshopBattleFiles, roomData,
    workshopKitFiles, workshopKitDirs, workshopAssets, workshopResourceFiles,
    modsJson,
  });

  const startedAt = Date.now();
  resetBuildTag();
  buildTag();

  const announcementFile = opts.announcementsFile !== undefined ? opts.announcementsFile
    : (process.env.SP_ANNOUNCEMENTS_FILE || path.join(ROOT, 'config/announcements.json'));
  const announcements = new Announcements({
    file: announcementFile ? path.resolve(announcementFile) : null,
    broadcast: (msg) => network.broadcast(msg), log, pollMs: opts.announcementPollMs,
  });
  await announcements.start();

  const serveApi = createPublicApi({ lobby, announcements, trustProxy: netOptions.trustProxy, sendJson, sendError });

  const admin = new AdminService({
    lobby, network, registry, startedAt,
    buildTag: () => buildTag(),
    secret: opts.adminSecret || process.env.ADMIN_SECRET,
  });

  const traffic = createTrafficCounter();
  const upstreamRoutes = createRequestHandler({
    serveStatic,
    health: { startedAt, network, registry, lobby, traffic, assetIndex, views },
    log,
    trustProxy: network.opts.trustProxy,
  });

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }

    (async () => {
      // 1. 公开 API 挂载
      if (await serveApi(req, res, parts.rawPath)) return;

      // 1.0 客户端版本与热更新探测接口 (/api/app/version & /api/version)
      if (parts.rawPath === '/api/app/version' || parts.rawPath === '/api/version') {
        const build = buildTag();
        sendJson(req, res, 200, {
          ok: true,
          app: APP_VERSION,
          build,
          serverNow: Date.now(),
          hotUpdate: {
            supported: true,
            bundleVersion: build,
            patchUrl: `/api/app/patch.zip`,
            changelog: `卫戍协议：盟约 v${APP_VERSION} (Build: ${build}) 运行就绪`,
          },
        });
        return;
      }

      // 1.0.1 客户端热更新补丁下载接口 (/api/app/patch.zip)
      if (parts.rawPath === '/api/app/patch.zip') {
        const patchPath = path.join(ROOT, 'dist', 'patch.zip');
        const altPatchPath = path.join(ROOT, 'public', 'patch.zip');
        const fileToServe = fs.existsSync(patchPath) ? patchPath : (fs.existsSync(altPatchPath) ? altPatchPath : null);
        if (!fileToServe) {
          sendError(req, res, 404, '补丁文件未就绪 · Patch not found');
          return;
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        const stat = fs.statSync(fileToServe);
        res.setHeader('Content-Length', stat.size);
        const stream = fs.createReadStream(fileToServe);
        stream.pipe(res);
        return;
      }

      // 1.1 创意工坊模组清单 (W-C /api/mods & /mods/catalog.json)
      if (parts.rawPath === '/api/mods' || parts.rawPath === '/mods/catalog.json') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (parts.rawPath === '/mods/catalog.json') {
          sendJson(req, res, 200, modCatalog);
          return;
        }

        const wsDir = workshopDir;
        let diskDirs = [];
        try {
          const entries = await fs.promises.readdir(wsDir, { withFileTypes: true });
          diskDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
        } catch {}

        const loaded = loadWorkshop(wsDir, { log });
        const loadedMap = new Map((loaded.packs || []).map((p) => [p.id, p]));
        const packs = [];

        for (const dirName of diskDirs) {
          const p = loadedMap.get(dirName);
          let rawMeta = null;
          try {
            rawMeta = JSON.parse(await fsp.readFile(path.join(wsDir, dirName, 'pack.json'), 'utf8'));
          } catch {}

          const enabled = rawMeta?.enabled !== false && p?.manifest?.enabled !== false;
          const chessKeys = p?.files?.chess ? Object.keys(p.files.chess) : [];
          packs.push({
            id: dirName,
            name: rawMeta?.name || p?.manifest?.name || dirName,
            version: rawMeta?.version || p?.manifest?.version || '1.0.0',
            author: rawMeta?.author || p?.manifest?.author || '未知作者',
            description: rawMeta?.description || rawMeta?.desc || p?.manifest?.description || '暂无描述',
            layer: p?.layer || 'data',
            combat: !!p?.combat,
            enabled,
            hash: p?.hash || '',
            operators: chessKeys,
            downloadUrl: `/api/mods/download?id=${encodeURIComponent(dirName)}`,
          });
        }
        sendJson(req, res, 200, { ok: true, packs, total: packs.length });
        return;
      }

      // 1.2 模组 ZIP 打包下载 (/api/mods/download?id=<modId>)
      if (parts.rawPath === '/api/mods/download') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        const modId = new URL(req.url, 'http://127.0.0.1').searchParams.get('id');
        // 白名单验证：只允许字母、数字、下划线、连字符和点号
        if (!modId || typeof modId !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(modId)) {
          sendError(req, res, 400, '无效的模组标识 · Invalid mod ID');
          return;
        }
        const targetDir = path.join(workshopDir, modId);
        // 路径规范化后验证仍在 workshop 目录内
        const normalizedTarget = path.normalize(targetDir);
        const normalizedWorkshop = path.normalize(workshopDir);
        if (!normalizedTarget.startsWith(normalizedWorkshop + path.sep) && normalizedTarget !== normalizedWorkshop) {
          sendError(req, res, 403, '禁止访问 · Forbidden');
          return;
        }
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
          sendError(req, res, 404, '模组不存在 · Mod not found');
          return;
        }
        try {
          const zipBuf = createZipFromDir(targetDir);
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(modId)}.zip"`,
            'Content-Length': zipBuf.length,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(zipBuf);
        } catch (err) {
          log.error?.('[mods-download] Failed to zip mod', modId, err);
          sendError(req, res, 500, '打包下载失败 · Pack error');
        }
        return;
      }

      // 1.3 模组热重载端点 (/api/mods/reload) — Android 手机导入模组后无需重启服务
      if (parts.rawPath === '/api/mods/reload' && req.method === 'POST') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        try {
          log.info?.('[MOD-RELOAD] Re-scanning workshop directory...');
          
          // 重新加载 workshop 目录
          const freshLoaded = loadWorkshop(workshopDir, { log });
          const freshKits = await loadWorkshopKits(freshLoaded, {
            log,
            knownIds: new Set([
              ...Object.keys(data.chess || {}),
              ...((freshLoaded.packs || []).flatMap((p) => Object.keys(p.operators || {}))),
            ]),
          });
          
          // 重建相关数据结构
          const freshMods = (freshLoaded.packs || []).map((p) => ({
            id: p.id,
            name: p.name || p.id,
            hash: p.hash,
            layer: p.layer,
            combat: !!p.combat,
            operators: Object.keys(p.operators || {}),
          }));
          const freshModSet = freshMods.length ? modSetOf(freshMods) : null;
          const freshCatalog = buildModCatalog(freshLoaded);
          
          log.info?.(`[MOD-RELOAD] ✓ Reloaded ${freshLoaded.packs?.length || 0} packs without restart`);
          
          sendJson(req, res, 200, { 
            ok: true, 
            reloaded: freshLoaded.packs?.length || 0,
            packs: freshMods,
            message: '模组已热重载，无需重启服务 · Mods reloaded successfully' 
          });
        } catch (err) {
          log.error?.('[MOD-RELOAD] Failed:', err);
          sendError(req, res, 500, '模组重载失败 · Reload failed');
        }
        return;
      }

      // 1.4 从远程服务器同步模组到本地 (/api/mods/sync-from-remote)
      if (parts.rawPath === '/api/mods/sync-from-remote' && req.method === 'POST') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { modId, remoteServer } = JSON.parse(body);
            if (!modId || typeof modId !== 'string') {
              return sendJson(req, res, 400, { ok: false, error: 'Missing modId' });
            }
            
            const remoteUrl = remoteServer || 'http://101.37.150.107:3000';
            log.info?.(`[MOD-SYNC] Downloading ${modId} from ${remoteUrl}...`);
            
            // 从远程服务器下载模组 ZIP
            const downloadUrl = `${remoteUrl}/api/mods/download?id=${encodeURIComponent(modId)}`;
            const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
            if (!response.ok) {
              throw new Error(`Remote server returned ${response.status}`);
            }
            
            const buffer = Buffer.from(await response.arrayBuffer());
            const targetDir = path.join(workshopDir, modId);
            
            // 解压到本地 workshop 目录
            if (fs.existsSync(targetDir)) {
              log.warn?.(`[MOD-SYNC] ${modId} already exists, overwriting...`);
              fs.rmSync(targetDir, { recursive: true, force: true });
            }
            
            // 使用 adm-zip 解压
            const AdmZip = (await import('adm-zip')).default;
            const zip = new AdmZip(buffer);
            zip.extractAllTo(targetDir, true);
            
            log.info?.(`[MOD-SYNC] ✓ ${modId} synced successfully`);
            
            // 自动触发热重载
            const freshLoaded = loadWorkshop(workshopDir, { log });
            const freshMods = (freshLoaded.packs || []).map((p) => ({
              id: p.id,
              name: p.name || p.id,
              version: p.version,
            }));
            
            sendJson(req, res, 200, { 
              ok: true, 
              modId,
              message: `模组 ${modId} 已同步并重载成功`,
              packs: freshMods
            });
          } catch (err) {
            log.error?.('[MOD-SYNC] Failed:', err);
            sendJson(req, res, 500, { ok: false, error: err.message });
          }
        });
        return;
      }

      // 2. 管理面板
      if (parts.rawPath === '/admin' || parts.rawPath === '/admin/') {
        await serveStatic(req, res, '/admin/index.html', parts.query);
        return;
      }
      if (parts.rawPath.startsWith('/api/admin/')) {
        if (!admin.authenticate(req)) {
          sendJson(req, res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        if (parts.rawPath === '/api/admin/overview' && (req.method === 'GET' || req.method === 'HEAD')) {
          sendJson(req, res, 200, admin.getOverview());
          return;
        }
        if (parts.rawPath === '/api/admin/rooms' && (req.method === 'GET' || req.method === 'HEAD')) {
          sendJson(req, res, 200, admin.getRooms());
          return;
        }
        if (parts.rawPath === '/api/admin/logs' && (req.method === 'GET' || req.method === 'HEAD')) {
          const since = Number(new URLSearchParams(parts.query).get('since')) || 0;
          sendJson(req, res, 200, admin.getLogs(since));
          return;
        }
        if (parts.rawPath === '/api/admin/broadcast' && req.method === 'POST') {
          try {
            const body = await readJsonBody(req);
            const ok = admin.broadcast(body.message);
            sendJson(req, res, 200, { ok });
          } catch {
            sendJson(req, res, 400, { ok: false, error: 'Invalid JSON' });
          }
          return;
        }
        if (parts.rawPath === '/api/admin/drain' && req.method === 'POST') {
          admin.startDrain();
          sendJson(req, res, 200, { ok: true, draining: true });
          return;
        }
        sendJson(req, res, 404, { ok: false, error: 'Not found' });
        return;
      }

      // 3. 性能与局域网探针
      if (parts.rawPath === '/metrics') {
        sendJson(req, res, 200, {
          ok: true, app: APP_VERSION, build: buildTag(),
          sockets: network.connectionCount, online: network.onlineCount, sessions: registry.size,
          ...lobby.stats(), matchmaking: network.matchmakingCounts, memory: process.memoryUsage(),
          announcements: announcements.stats(),
        });
        return;
      }
      if (parts.rawPath === '/lan/room') {
        if (!isPrivateAddress(req.socket?.remoteAddress)) { sendError(req, res, 404, '未找到 · Not found'); return; }
        const code = String(new URLSearchParams(parts.query).get('code') || '').toUpperCase();
        const room = /^[A-Z0-9]{4}$/.test(code) ? lobby.getRoom(code) : null;
        if (!room || room.mode !== 'coop') { sendError(req, res, 404, '未找到 · Not found'); return; }
        sendJson(req, res, 200, {
          ok: true, code: room.code, mode: room.mode, difficulty: room.difficulty,
          seats: room.seats.length, humans: room.seats.filter((s) => s && !s.isBot).length, inMatch: !!room.match,
        });
        return;
      }

      // 4. 其余请求交由 upstream 0.2.6 统一处理（静态文件、哈希路由、br/gzip、/healthz 等）
      upstreamRoutes(req, res);
    })().catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  });

  server.on('clientError', answerClientError);

  const playerAdmin = await mountPlayerAdmin({
    server, network, lobby, registry,
    configFile: opts.adminConfigFile || process.env.SP_ADMIN_CONFIG || path.join(ROOT, 'config/player-admin/config.json'),
    announcementFile, publicDir, log,
  });

  // 使用 0.2.6 attachWebSocket
  const wss = attachWebSocket(server, { network, log, traffic });
  wss.on('connection', (ws) => {
    announcements.refresh();
    send(ws, announcements.message());
  });

  // The address actually bound.
  let boundHost;
  try {
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
  } catch (e) {
    await playerAdmin.close();
    await announcements.stop();
    network.close();
    assetIndex?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  assetIndex?.start();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await playerAdmin.close();
      await announcements.stop();
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      network.close();
      assetIndex?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return {
    port: actualPort, host: boundHost, url, server, wss, lobby, network,
    registry, packs, traffic, assetIndex, views, admin, playerAdmin, announcements, close,
  };
}

if (isProcessEntry(import.meta.url)) runMain(startServer);
