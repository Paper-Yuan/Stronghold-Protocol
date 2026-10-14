// server/http/routeMount.js — 包声明的**动态只读端点**（`server.modules[*].uses` 含 `route` + `host.route(path, fn)`）。
// (i18n-ignore-file: 这里的文案是给作者/加载器的错误说明，不是客户端界面文案)
//
// 为什么要有它：`pack.json.routes`（§28.13）已经能让一个包把一个**包内写死的 `.json` 文件**挂到一条绝对路径上，
// 但「这个端点的内容随运行时状态变」（今天的在线人数、这一局的归档标签、包自己攒的计数）表达不出来 —— 作者只能
// 手改 `server/http/static.js`。这一格就是那条不手改的通道，而它刻意**只加一格能力**：一个**同步返回
// JSON 可序列化值**的回调。
//
// 五条纪律（每一條都是为了让「包」不变成「运维杠杆」）：
//   1. **命名空间**：路径必须落在 `/mod/<包id>/…` 里。冲突因此在结构上不存在（包 id 在路径里），
//      核心命名空间也不可能被顶掉 —— 这条规则比任何黑名单都硬：包没有可以点名的位置去放 `/data/support.json`。
//   2. **核心保留路径表**（`RESERVED_ROUTE_PREFIXES`）仍然逐条判一遍。命名空间规则已经覆盖了引擎自己的前缀，
//      这一层是**纵深防御**：将来谁放宽了第 1 条，第 2 条还在；而且它是一份**可被复用的**真相（见文件末尾的
//      说明：既有静态 `routes` 通道的同一件事**不在本批**）。
//   3. **只有 GET / HEAD**。别的方法在 `server/http/routes.js` 就被 405 挡掉，这里再判一次是给「将来谁把静态
//      处理器的入口接宽了」留一道闸。
//   4. **缓存只有 `no-store` / `no-cache`**。刻意**没有** `public`：一个现算的端点说「可以公开缓存一天」几乎
//      总是错的（`pack.json.routes` 有 `public`，因为那里的内容是一个**文件**，重新打包才换；这里的内容每次
//      请求都可能不一样）。默认 `no-store`。
//   5. **认证口径：与引擎其余 HTTP 面逐字一致 —— 没有认证**。这个服务器没有任何需要凭据的 HTTP 端点（`/healthz`
//      是公开的，`/mods` 目录是公开的，`/data/*.json` 是公开的）。所以这一格能给的只有「公开、只读」；
//      一个包**不得**把 `host.route` 当成私有通道（把凭据塞进 URL、靠路径保密）—— 那会在任何一次抓包/转发里失效，
//      而失败的形态是静默的「哦原来谁都能读」。要私有数据就落 `host.io`（包自己的状态目录）。
//
// 另外两条形状约束：
//   * 回调必须**同步**返回（一个 `Promise` 会被点名拒绝，不是 await 它）。原因很实在：这个服务器是单进程单事件
//     循环，一个 `await` 的处理器就是一条能被拖住整台服务器的路，而这一格刻意**不**做每请求隔离。
//   * 序列化后的体有上限（`DYNAMIC_ROUTE_MAX_BYTES`）。`/healthz` 的字段有上限是同一个理由：一条包声明的通道
//     不该能把响应撑到没有边界。

import fs from 'node:fs';
import path from 'node:path';

/**
 * 引擎自己的**逐字** HTTP 端点。包声明的任何一条路径都不得等于它们 —— `/healthz` 与 `/data.js` 是
 * `server/http/routes.js` / `static.js` 在**任何**包之前就吃掉的常量路径。
 */
export const CORE_ROUTE_EXACT = Object.freeze(['/healthz', '/data.js', '/mods/catalog.json']);

/**
 * 引擎自己的顶层 HTTP 命名空间（**目录**：`/data` 与 `/data/x` 都算）。包声明的端点**一个都不能落在里面**。
 *
 * 为什么要分成两份：`/healthz` 是**一条路径**，`/data` 是**一棵树**，判据不同（一份比对、一份前缀比对）。
 * 混在一张扁平表里就得靠「派生」去猜哪条是哪条，而派生表在**前缀语义**上无解（`/packs` 明明是树，
 * `<prefix>.` 那条派生规则却想说它是文件 `/packs.json`）。同一份真相改成显式两组之后，动态通道的
 * `isReservedRoutePath` 与静态 `pack.json.routes` 通道的 `coreRouteShadow` 都从**这里**取，
 * 没有第二份表可以漂移。
 */
export const CORE_ROUTE_PREFIXES = Object.freeze([
  '/ws',
  '/data',
  '/shared',
  '/sim',
  '/i18n',
  '/mods',
  '/media',
  '/packs',
  '/assets',
  '/fonts',
  '/workshop-assets',
  '/workshop-kits',
  '/workshop-panels',
  '/workshop-resources',
  '/workshop-battle',
  '/room-data',
]);

/**
 * 上面两份的并集。**保留表只此一处真相**：动态通道（`dynamicRoutePathIssue`）与静态通道
 * （`shared/workshop.js` 用到的 `coreRouteShadow`）判的都是它。两条通道读的是同一张表，改一处两条一起变
 * （`test/modRoutes.test.js` 有一条断言钉住这件事）。
 */
export const RESERVED_ROUTE_PREFIXES = Object.freeze([...CORE_ROUTE_EXACT, ...CORE_ROUTE_PREFIXES]);

/** 动态端点的命名空间前缀：`/mod/<包id>/…`。 */
export const DYNAMIC_ROUTE_PREFIX = '/mod/';
/** 动态端点允许的 HTTP 方法（其余在 `server/http/routes.js` 已经是 405）。 */
export const DYNAMIC_ROUTE_METHODS = Object.freeze(['GET', 'HEAD']);
/** 动态端点允许的缓存语义。刻意没有 `public`：内容是现算的。 */
export const DYNAMIC_ROUTE_CACHE_POLICIES = Object.freeze(['no-store', 'no-cache']);
/** 一个动态端点响应体的字节上限（与 `/healthz` 的字段上限同一条理由：包声明的通道要有界）。 */
export const DYNAMIC_ROUTE_MAX_BYTES = 64 * 1024;

/** 缓存策略 → `Cache-Control` 头。唯一的真相在这里（`shared/workshop.js` 不参与：这一格没有 pack.json 声明）。 */
export const DYNAMIC_ROUTE_CACHE_HEADERS = Object.freeze({
  'no-store': 'no-store',
  'no-cache': 'no-cache',
});

/** 一条路径是否落在引擎保留的命名空间里（`/data` 与 `/data/x` 都算）。 */
export function isReservedRoutePath(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  // 常量端点：逐字命中，外加 `<端点>.<ext>`（`/data.js` 的旁支）。刻意**不**认 `/healthz/x` —— `/healthz` 是一条
  // 路径，不是一棵树（旧的那张扁平表也是这个语义，这里一字不改）。
  if (CORE_ROUTE_EXACT.some((e) => p === e || p.startsWith(`${e}.`))) return true;
  return CORE_ROUTE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * `pack.json.routes` 的一条声明路径会不会**顶掉引擎自己的路由**（静态通道，DESIGN §28.13/§28.35）。
 *
 * 为什么静态通道也要这一条：`server/http/static.js` 把包声明的路由查在核心挂载**之前**，所以一条声明能回答
 * 一条与核心同名的路径。动态通道（`host.route`）本来就顶不掉（路径必须在 `/mod/<包id>/…` 里），静态通道今天
 * 能顶 —— 这一格把它收成「**核心先吃、包的同名声明不生效**」，并且**不拒包**（已发布的包不会因为多写一条声明
 * 就装不上）。判据只有一条：**引擎自己真的会服务这条路径吗**。
 *
 * 两种「真的会服务」，各自点名：
 *   1. 逐字的常量端点 / 引擎自己的命名空间（上面那两张表）—— 引擎在这些位置上一定先答；
 *   2. 这条路径映射到核心挂载目录里**真的存在的那个文件**（`dataDir` / `sharedDir` / `simDir` / `publicDir`）。
 *
 * 第 2 条刻意是**按文件探**、不是「按前缀一律拦」：那不是同一件事，而且是刻意的选择。今天线上有一条已发布的包
 * （`ws-compression-reference`）声明了 `/data/ws-compression.json` —— 它落在核心命名空间里，但 `data/` 下**没有**
 * 同名文件，所以核心今天**并不**服务那条路径。按前缀一律拦会把这条已发布的包当场打断（快照审计：14 条线上包
 * 里只有这一条声明 `routes`），而它并没有顶掉任何东西。「核心先吃」要防的是**顶掉**，不是「用了 `/data` 这个词」。
 * 副作用是好的：核心将来真的长出 `data/ws-compression.json` 那一天，这条声明**自动**让位给核心，不需要再改一次
 * 规则 —— 那就是「核心先吃」这条不变量本身。
 *
 * @param {string} pathname 声明路径（调用方已判过「绝对路径、无 `..`」）
 * @param {{ mount?: Array<{ prefix: string, name?: string, dir?: string }> }} [core] 核心挂载目录（`server/index.js`
 *   与 `server/http/static.js` 用同一份 `publicDir` / `dataDir` / `sharedDir` / `simDir`）
 * @returns {{ kind: 'exact' } | { kind: 'file', mount: string, file: string } | { kind: 'reserved', prefix: string } | null}
 *   `exact` / `file` = **核心真的先吃**（声明不生效）；`reserved` = 落在引擎命名空间里但核心今天没有那个文件
 *   （声明照常服务，只是预告将来会让位）；`null` = 与核心无关。
 */
export function coreRouteShadow(pathname, { mount = [] } = {}) {
  const p = typeof pathname === 'string' ? pathname : '';
  if (!p.startsWith('/')) return null;
  if (CORE_ROUTE_EXACT.includes(p)) return { kind: 'exact' };
  // 顺序要紧：**先看核心今天是不是真的服务这条路径**（按文件探），再看它只是「用了引擎的命名空间」。
  // 前者是「核心先吃」，后者只是一句预告 —— 把两者混成一条会把没顶掉任何东西的声明也判死（线上有一条包正是
  // 这样：`/data/ws-compression.json`，而 `data/` 下没有同名文件）。
  for (const m of Array.isArray(mount) ? mount : []) {
    if (!m || typeof m.prefix !== 'string' || typeof m.dir !== 'string' || !m.dir) continue;
    if (m.prefix !== '/' && !p.startsWith(m.prefix)) continue;
    const rest = m.prefix === '/' ? p.slice(1) : p.slice(m.prefix.length);
    if (!rest || rest.includes('\\')) continue;
    const segments = rest.split('/').filter((s) => s.length > 0);
    if (!segments.length || segments.some((s) => s === '..' || s === '.')) continue;
    const abs = path.join(path.resolve(m.dir), ...segments);
    try {
      if (fs.statSync(abs).isFile()) return { kind: 'file', mount: m.name || m.prefix, file: abs };
    } catch { /* 这个挂载下没有这个文件 ⇒ 核心不服务这条路径 */ }
  }
  for (const prefix of CORE_ROUTE_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return { kind: 'reserved', prefix };
  }
  return null;
}

/** 包 id / 模块 id 的字符集与 `shared/workshop.js` 的 `PACK_ID_RE` 同一条（路径要能拼出 URL 段）。 */
const SEG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 核心静态挂载的**一份**描述：前缀 → 磁盘目录。`server/http/static.js` 用它建真正的挂载表，
 * `coreRouteShadow` 用同一份判断「核心是不是真的服务这条路径」—— 两张表原来是各写一遍的，那就是必然漂移。
 *
 * `/sim/` 的 `only: .js` / `deny` 由调用方补进来（那两条是**服务**约束，与「这条路径归谁」无关）。
 * @param {{ publicDir: string, dataDir: string, sharedDir: string, simDir: string }} dirs
 */
export function coreMounts({ publicDir, dataDir, sharedDir, simDir }) {
  return [
    { prefix: '/data/', name: 'data', dir: path.resolve(dataDir) },
    { prefix: '/shared/', name: 'shared', dir: path.resolve(sharedDir) },
    { prefix: '/sim/', name: 'sim', dir: path.resolve(simDir) },
    { prefix: '/', name: 'public', dir: path.resolve(publicDir) },
  ];
}

/**
 * 一条路径能不能被 `host.route` 登记。返回 `null` = 可以，否则是给人看的理由。
 * @param {string} pathname
 * @param {string} packId
 * @returns {string|null}
 */
export function dynamicRoutePathIssue(pathname, packId) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.length < 2) {
    return 'the path must be an absolute HTTP path (e.g. "/mod/my-pack/stats.json")';
  }
  if (pathname.includes('\\') || pathname.includes('?') || pathname.includes('#') || pathname.includes('\0')) {
    return 'the path may not contain "\\", "?" or "#" (the engine matches the decoded path, without a query string)';
  }
  if (pathname.split('/').some((seg) => seg === '..' || seg === '.')) {
    return 'the path may not contain "." or ".." segments';
  }
  if (!pathname.startsWith(DYNAMIC_ROUTE_PREFIX)) {
    return `every dynamic route lives under "${DYNAMIC_ROUTE_PREFIX}<pack id>/…" — that is what makes two packs unable to collide and what keeps the engine's own namespaces out of reach (today's read-only channel for a file inside the pack is pack.json.routes)`;
  }
  if (isReservedRoutePath(pathname)) {
    return `"${pathname}" is inside a namespace the engine owns (${RESERVED_ROUTE_PREFIXES.join(', ')}) — a pack may not shadow a core path`;
  }
  const segments = pathname.slice(DYNAMIC_ROUTE_PREFIX.length).split('/').filter((s) => s.length > 0);
  if (!segments.length || segments.length < 2) {
    return `the path must name something inside the pack's own namespace ("${DYNAMIC_ROUTE_PREFIX}${packId}/<name>")`;
  }
  if (!SEG_RE.test(segments[0])) return 'the namespace segment must be a pack id';
  if (packId && segments[0] !== packId) {
    return `the namespace segment is "${segments[0]}" but this module belongs to pack "${packId}" — a pack may only mount inside its own namespace`;
  }
  return null;
}

/**
 * 动态端点的登记处。一个进程一份，由 `server/index.js` 建好交给 `createStaticHandler`。
 *
 * 认路径、不认前缀；键就是**逐字**声明的那条路径（所以 `..` 在这里不是「被挡住」，而是**没有可以穿越的目标**——
 * 与 `pack.json.routes` 同一条几何）。两个包声明同一条路径不可能发生（命名空间里有包 id），真发生了按
 * 「包 id 小的赢 + 点名」处理（DESIGN §28.3 的同一条规则）。
 */
export function createDynamicRoutes() {
  /** @type {Map<string, { handler: Function, cache: string, pack: string, module: string }>} */
  const table = new Map();
  /**
   * @param {{ pack?: string, module?: string, path?: string, handler?: Function, cache?: string }} entry
   * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
   */
  function register({ pack = '', module = '', path: pathname = '', handler = null, cache = undefined } = {}) {
    const issue = dynamicRoutePathIssue(pathname, pack);
    if (issue) return { ok: false, reason: issue };
    if (typeof handler !== 'function') return { ok: false, reason: 'host.route(path, fn) needs a function' };
    const policy = cache === undefined ? 'no-store' : cache;
    if (!DYNAMIC_ROUTE_CACHE_POLICIES.includes(policy)) {
      return { ok: false, reason: `cache must be one of: ${DYNAMIC_ROUTE_CACHE_POLICIES.join(', ')}` };
    }
    const prev = table.get(pathname);
    if (prev && String(prev.pack) <= String(pack)) {
      return { ok: false, reason: `"${pathname}" is already mounted by pack "${prev.pack}" (the smaller pack id wins, DESIGN §28.3)` };
    }
    table.set(pathname, { handler, cache: policy, pack, module });
    return { ok: true, path: pathname };
  }
  return Object.freeze({
    register,
    /** 逐字命中的登记项，或 `undefined`。 */
    get: (pathname) => table.get(pathname),
    size: () => table.size,
    /** 登记过的路径（排序；给启动日志与测试用）。 */
    paths: () => [...table.keys()].sort(),
    /** 底层那张 Map（`server/http/static.js` 直接按 `size` / `get` 用它；键就是逐字声明的路径）。 */
    map: () => table,
  });
}

/**
 * 把一个回调的返回值变成响应体。**同步**、有界、只认 JSON 可序列化的值。
 *
 * 四种失败各自点名（调用方记一行 `log.warn` 并答 500）：不是同步值（`Promise`）、`JSON.stringify` 抛
 * （循环引用 / `BigInt`）、`undefined`（没有可送的东西）、体超过上限。刻意**不**回落到空体 200 ——
 * 「装了但没反应」是本层到处在消灭的那种失败。
 * @param {Function} handler
 * @returns {{ ok: true, body: Buffer } | { ok: false, reason: string }}
 */
export function runDynamicRoute(handler) {
  let value;
  try {
    value = handler();
  } catch (e) {
    return { ok: false, reason: `host.route handler threw: ${e && e.message ? e.message : e}` };
  }
  if (value && typeof value.then === 'function') {
    return { ok: false, reason: 'host.route handlers must return a value synchronously (a Promise is refused: this route is not a per-request sandbox around the server\'s event loop)' };
  }
  if (value === undefined) {
    return { ok: false, reason: 'host.route handler returned undefined — return a JSON-serialisable value (or null)' };
  }
  let text;
  try {
    text = JSON.stringify(value);
  } catch (e) {
    return { ok: false, reason: `host.route handler returned a value that is not JSON-serialisable: ${e && e.message ? e.message : e}` };
  }
  if (typeof text !== 'string') {
    return { ok: false, reason: `host.route handler returned ${typeof value}, which has no JSON form (a function / a symbol / undefined)` };
  }
  const body = Buffer.from(text, 'utf8');
  if (body.length > DYNAMIC_ROUTE_MAX_BYTES) {
    return { ok: false, reason: `host.route response is ${body.length} bytes (at most ${DYNAMIC_ROUTE_MAX_BYTES})` };
  }
  return { ok: true, body };
}
