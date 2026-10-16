// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>), the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js: the content hash `cs`, DESIGN §32), the visual sets
//                      of cosmetic plugins (/vs/<vs16>/…, plugins/visualSet.js) and their files (/p/<id>/<hash8>/…),
//                      the content sets of gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js — DESIGN §32.6; the
//                      server owner's plugins/config.json: plugins/policy.js; a room's plugins: plugins/roomSets.js; its
//                      match then runs in that set's worker: match/host/)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json, /data/local-assets.json and /data/local-fx.json: every art URL with
//                      its hash segment (/assets/~<hash>/…, immutable when the hash matches); the files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
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
import path from 'node:path';
import { getData, loadData } from './data.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS } from './http/static.js';
// 本仓库的静态层：它包住上游的 static.js，并在其之前加一层创意工坊 / mod 缓存路由 (server/http/workshopServe.js)
import { createStaticHandler } from './http/customStatic.js';
import { createWorkshopServe } from './http/workshopServe.js';
import { createModApi } from './http/modApi.js';
import { mountPlayerAdmin } from './playerAdmin.js';
import { createPublicApi } from './publicApi.js';
import { createAppApi } from './http/appApi.js';
import { APP_VERSION } from '../shared/constants.js';
import { Announcements } from './announcements.js';
import { WORKSHOP_DIR, loadWorkshop, restoreUserPacks } from './workshop.js';
import { applyWorkshop } from '../shared/workshop.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError, sendJson, sendError } from './http/common.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object,
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests)
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  // 创意工坊的数据合并必须在会话栈之前：浏览器读的 /data/* 是「官方 + 包」的合并体（http/workshop.js），
  // 服务端重算、GameData 与对局都必须建立在同一份数据上（本文件 139 行那段注释的原意）。没有包时就是 data 本身。
  const workshopDir = opts.workshopDir || process.env.SP_WORKSHOP || WORKSHOP_DIR;
  // 用户从远端同步下来的包放在解压目录之外，这里在装载前把它们放回去（APK 更新会重解压 bundle）。
  restoreUserPacks(workshopDir, undefined, log);
  const preloadedWorkshop = (() => {
    try { return loadWorkshop(workshopDir, { log }); }
    catch (err) { log.warn?.(`[workshop] 预装载失败，服务端按基准数据处理: ${err && err.message ? err.message : err}`); return null; }
  })();
  const gameData = preloadedWorkshop && Array.isArray(preloadedWorkshop.packs) && preloadedWorkshop.packs.length
    ? applyWorkshop(data, preloadedWorkshop.packs).data
    : data;
  // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
  // like the data the matches use and the build tag below
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
  // whenever their folders change
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost:host, scriptMode });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = assetIndex ? createManifestViews({ dataDir, index: assetIndex, log }) : null;
  // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
  const visual = createVisualSets({ registry: packs, log });
  // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
  // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
  const policy = createPluginPolicy({ pluginsDir, log });
  const contents = createContentSets({ registry: packs, vanillaData: gameData, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
  // an out-of-memory abort in a worker thread ends the whole server)
  const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  const { registry, lobby, network } = createSessionStack(opts, { data: gameData, log, content, plugins: roomSets, hosts });
  // 创意工坊 (docs/WORKSHOP.md, DESIGN §28): 装载一次、建好服务表。仓库里没有 workshop/ 内容时这些表全空，静态层的每个
  // 分支都被跳过 —— 普通安装的行为与上游逐字节一致。装载失败只记一条错误：一台装不上工坊的服务器仍要能开局。
  let workshop = null;
  /** （重新）装载工坊并换掉服务表 —— `POST /api/mods/reload` 与 sync-from-remote 都用它，导入模组因此无需重启。 */
  const loadWorkshopTables = async () => {
    const served = await createWorkshopServe({ data, workshopDir, log, views });
    workshop = served.tables;
    for (const e of served.errors || []) log.warn?.(`[workshop] ${e.pack} ${e.path}: ${e.reason}`);
    return served;
  };
  try {
    const served = await loadWorkshopTables();
  // 房间模组声明 (W-C)：lobby 在工坊装载完成之前就建好了，所以这里把工坊状态挂上去（属性赋值，不重排启动顺序）。
  lobby.workshop = served.workshop;
  if (served.workshop?.mods?.length) log.info(`[workshop] rooms may declare ${served.workshop.mods.length} mod(s): ${served.workshop.mods.map((m) => m.id).join(', ')}`);
    if ((served.packs || []).length) log.info(`[workshop] ${served.packs.length} 个包已装载 · ${(served.catalog?.packs || []).length} 个进入 mod 目录`);
  } catch (e) {
    log.error('[workshop] 创意工坊装载失败，本次以无工坊模式启动', e);
  }
  const modApi = createModApi({ workshopDir, log, reload: loadWorkshopTables });
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, assetIndex, views, visual, contents, workshop });
  // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
  // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  const trustedRuntime = await createTrustedRuntime({registry:packs,log});
  lobby.trustedRuntime = trustedRuntime;
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  // 公开只读 API (server/publicApi.js) 与维护公告 (server/announcements.js)：房间目录、建房链接、ping、公告。
  // 客户端主流程不依赖它们（房间目录页与外部工具在用），但它们是本仓库服务端表面的一部分。
  const announcementFile = opts.announcementsFile !== undefined ? opts.announcementsFile
    : (process.env.SP_ANNOUNCEMENTS_FILE || path.join(ROOT, 'config/announcements.json'));
  const announcements = new Announcements({
    file: announcementFile ? path.resolve(announcementFile) : null,
    broadcast: (msg) => network.broadcast(msg), log, pollMs: opts.announcementPollMs,
  });
  await announcements.start();
  const publicApi = createPublicApi({ lobby, announcements, trustProxy: network.opts.trustProxy, sendJson, sendError });
  // 启动器 / Android 宿主用的只读端点 (server/http/appApi.js)：`/api/app/version`（版本 + 热更 patchUrl）、
  // `/api/app/patch.zip`（dist/ 或 public/ 下的补丁）与 `/lan/room`（局域网房间探针，只答私网/虚拟专网的请求）。
  const appApi = createAppApi({ lobby, buildTag, appVersion: APP_VERSION, rootDir: ROOT, log });
  const traffic = createTrafficCounter();
  const server = http.createServer(createRequestHandler({ serveStatic, modApi, publicApi, appApi, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir), health: { startedAt, network, registry, lobby, content, traffic, assetIndex, views, trusted:trustedRuntime?.health }, log, trustProxy: network.opts.trustProxy, studio, trustedRuntime }));
  server.on('clientError', answerClientError);
  // 管理端 (server/playerAdmin.js): /admin/ 页面与 /admin/api/*（登录、快照、封禁、公告、模组上传/拉取…）。它读
  // config/player-admin/config.json：没有配置时 /admin* 一律 404，其余请求原样转给已有的监听器。
  //
  // 必须挂在 createRequestHandler 之后：它会把 server 上已有的 'request' 监听器**摘下来**、套一层自己的再放回。
  const playerAdmin = await mountPlayerAdmin({ server, network, lobby, registry, log });
  const wss = attachWebSocket(server, { network, log, traffic });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
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
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    assetIndex?.close();
    studio?.close();
    await trustedRuntime?.close();
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
      try { await playerAdmin?.unmount(); } catch (e) { log.error('[shutdown] player admin', e); }
      try { await announcements.stop?.(); } catch (e) { log.error('[shutdown] announcements', e); }
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      network.close();
      assetIndex?.close();
      studio?.close();
      await trustedRuntime?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, traffic, assetIndex, views, studio, playerAdmin, close };
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(startServer);
