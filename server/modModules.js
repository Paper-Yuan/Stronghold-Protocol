// server/modModules.js — 包的**服务端模块**载荷（DESIGN §28.14）。
//
// 为什么要有这一类：社区插件包要做的事（停机播报与快照留档、匿名对局统计落盘、给 `/healthz` 加几个字段）**每一条**
// 都与 kit 相反 —— kit 是战斗里的代码，契约明写「不碰文件系统、不碰网络」；这三件件件要写盘、要挂启动钩子、要给一个
// 既有 HTTP 端点加字段。今天它们只能靠**手改引擎文件**（那三个 `.js` 原件就是这么发的）。这一类载荷就是那条不手改的
// 通道。
//
// 与 `server.meta` 的分工：meta 在**对局里**执行（改对局逻辑，必须 `combat: true`），这里的东西**不在对局里**——
// 它挂在启动/停机、`/healthz` 与 `MatchClass` 这三处（`matchClass` 是唯一能碰到对局的那一个，所以只有它要求
// `combat: true`）。
//
// 安全性不来自「禁掉什么」，而来自**只给声明过的那几样**：
//   * `uses` 里的每个挂载点各对应宿主对象上的一个函数；没声明的那个一碰就抛 `MODULE_USE_UNDECLARED`（不是 undefined，
//     一个 undefined 只会变成一行 `TypeError: not a function`，作者看不出是「没声明」还是「拼错了」）；
//   * `write: true` 才拿到 `host.io`，而它被限定在 `<状态目录>/mod/<包id>/`：包自己的目录只读，引擎的目录根本不在
//     门面里（`..` 与绝对路径在这里就被拒）；
//   * 模块的**字节进包的内容哈希**（与 kits / panels / meta 同一条），所以「同一个房间摘要 ⇒ 同一份服务端代码」。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SERVER_MODULE_USES } from '../shared/workshop.js';
import { SERVER_CODE_FORBIDDEN_GLOBALS, stripComments, mentionsIdentifier } from '../shared/kitAuthoring.js';
import { DYNAMIC_ROUTE_CACHE_POLICIES, createDynamicRoutes, dynamicRoutePathIssue } from './http/routeMount.js';
import { hostMetrics } from './hostMetrics.js';

/** 静默的日志替身（装载期不需要日志时用）。 */
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** 状态目录的根：`SP_STATE_DIR` 优先，否则 `<仓库>/var` —— 与那三件原件的 `var/state`、`var/stats` 同一棵树。 */
export function stateRootFor(repoRoot) {
  return process.env.SP_STATE_DIR ? path.resolve(process.env.SP_STATE_DIR) : path.join(repoRoot, 'var');
}

/** 声明过 `write` 的模块拿到的目录：`<状态目录>/mod/<包id>/`（一个包一个，永不与别的包共享）。 */
export function moduleStateDir(stateRoot, packId) {
  return path.join(stateRoot, 'mod', packId);
}

/**
 * `boot(config)` 快照里 `env` 那一段的白名单 —— **只有引擎自己已经在用的 `SP_*` 变量**，一个不多一个不少。
 *
 * 为什么是白名单而不是把 `process.env` 过滤一下：一个包能读到的环境变量越多，它就越像「运维杠杆」—— 作者可以
 * 写「只有 `SP_FOO=1` 时才干活」，于是同一份包字节在两台机器上是两种行为，而 `MOD_SURFACE` 存在的意义就是
 * 「同一份摘要 ⇒ 同一份行为」。这四个名字是**这份名单的扫描范围**（`server/index.js`、`server/modModules.js`、
 * `server/match/Match.js`、`server/match/botEmotes.js`）里真实读过的全部，并且 `test/packServerSurface.test.js`
 * 用**反射源码**把它们钉住：扫描范围内新读一个 `SP_*` 而这份名单没跟上，测试就红。
 *
 * 在扫描范围**之外**读的 `SP_*` 因此是刻意的，不是漏网：`server/accountConfig.js` 的 `SP_ACCOUNTS` /
 * `SP_RECORDS_FILE` 就是例子 —— 「这台服务器开不开账号」正是**不该**让包看见并据此分叉的那种开关。
 */
export const BOOT_CONFIG_ENV_KEYS = Object.freeze(['SP_BOT_EMOTES', 'SP_STAGE', 'SP_STATE_DIR', 'SP_WORKSHOP']);

/**
 * `onBoot` 拿到的**只读配置快照**。
 *
 * 三条性质，都是刻意的：
 *   * **是值不是句柄**：返回一个深冻结的普通对象，没有 `process`、没有 server、没有 getter —— 包**只能观察**，
 *     改不动引擎的任何东西（改一个冻结对象的属性在严格模式 ESM 里直接抛，不是静默无效）；
 *   * **`env` 走白名单**（`BOOT_CONFIG_ENV_KEYS`）：包看得见引擎**自己在用**的那几个 `SP_*`，看不见其余环境变量；
 *   * **包永远不能"声明"启动变量**：这个对象是从 `opts` 与进程环境**读出来**的，`pack.json` 里没有任何一个字段
 *     能往它里面写值。把包声明变成运维杠杆（「这个包要求 `SP_X=1` 才加载」）正是本层拒绝的那条路 —— 业主裁决
 *     「声明式足够」指的是**读**是声明式的，不是让包去设。
 * @param {{ port?: number, host?: string, stateRoot?: string, env?: Record<string, string|undefined> }} src
 * @returns {{ port: number, host: string, stateDir: string, env: Readonly<Record<string, string>> }}
 */
export function bootConfigSnapshot({ port = 0, host = '', stateRoot = '', env = process.env } = {}) {
  /** @type {Record<string, string>} */
  const seen = {};
  for (const key of BOOT_CONFIG_ENV_KEYS) {
    const value = env ? env[key] : undefined;
    if (typeof value === 'string') seen[key] = value;
  }
  return Object.freeze({
    port: Number.isFinite(port) ? port : 0,
    host: typeof host === 'string' ? host : '',
    stateDir: typeof stateRoot === 'string' ? stateRoot : '',
    env: Object.freeze(seen),
  });
}

/** 挂载点拒绝：带错误码，装配层据此点名而不是打一句堆栈。 */
export class ModuleRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModuleRefused';
    this.code = code;
  }
}

/**
 * **被限定在模块自己的状态目录里**的文件门面。三条性质：
 *   * 路径以状态目录为根解析，`..` / 绝对路径 / 空段一律拒（包不能借它读引擎的文件）；
 *   * 目录**按需创建**（第一次写才 mkdir，一个声明了 write 却从没写过的包不在磁盘上留东西）；
 *   * 只暴露少数几个动作，不做通配（没有 `exec`、没有流、没有目录遍历之外的读取）。
 * @param {string} dir 绝对路径（`moduleStateDir`）
 */
function ioFacade(dir) {
  /** 把一个包内相对路径解析到这个目录里。 */
  const resolve = (rel, { forWrite = false } = {}) => {
    if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\')) {
      throw new ModuleRefused('MODULE_IO_BAD_PATH', `"${String(rel)}" must be a relative path with forward slashes`);
    }
    const segments = rel.split('/');
    if (segments.some((s) => !s || s === '.' || s === '..')) {
      throw new ModuleRefused('MODULE_IO_BAD_PATH', `"${rel}" may not contain empty, "." or ".." segments (the facade stays inside this pack's own state directory)`);
    }
    const abs = path.join(dir, ...segments);
    if (abs !== dir && !abs.startsWith(dir + path.sep)) {
      throw new ModuleRefused('MODULE_IO_BAD_PATH', `"${rel}" resolves outside this pack's state directory`);
    }
    if (forWrite) fs.mkdirSync(path.dirname(abs), { recursive: true });
    return abs;
  };
  return Object.freeze({
    /** 这个包自己的状态目录（绝对路径；仅用于日志与诊断）。 */
    dir,
    write(rel, data) { fs.writeFileSync(resolve(rel, { forWrite: true }), data); return true; },
    append(rel, data) { fs.appendFileSync(resolve(rel, { forWrite: true }), data); return true; },
    read(rel) { try { return fs.readFileSync(resolve(rel), 'utf8'); } catch { return null; } },
    exists(rel) { try { return fs.existsSync(resolve(rel)); } catch { return false; } },
    remove(rel) { try { fs.rmSync(resolve(rel)); return true; } catch { return false; } },
    /** 这个目录里的条目名（排序；目录尚不存在时是空数组）。 */
    list() { try { return fs.readdirSync(dir).sort(); } catch { return []; } },
  });
}

/**
 * 一个模块拿到的**宿主对象**。它把「声明了什么」变成「能用什么」，其余的键一律抛。
 *
 * 为什么要抛而不是给 `undefined`：`host.healthz?.(...)` 与 `host.healthz(...)` 的区别只对写代码的人有意义，
 * 而作者看到的是「没生效」；带码的异常会直接说出「你没在 uses 里声明它」。
 */
export function moduleHost({ packId, moduleId, hash, dir, uses, write, stateRoot, log = noopLog, registry = null }) {
  const declared = (use) => Array.isArray(uses) && uses.includes(use);
  const say = (use) => {
    throw new ModuleRefused('MODULE_USE_UNDECLARED',
      `server.modules["${moduleId}"].uses does not include "${use}" — a module gets exactly the mount points it declared (declared: ${(uses || []).join(', ') || 'none'})`);
  };
  const scoped = Object.freeze({
    info: (...a) => log.info?.(`[mod ${packId}/${moduleId}]`, ...a),
    warn: (...a) => log.warn?.(`[mod ${packId}/${moduleId}]`, ...a),
    error: (...a) => log.error?.(`[mod ${packId}/${moduleId}]`, ...a),
  });
  const io = write && stateRoot
    ? ioFacade(moduleStateDir(stateRoot, packId))
    : Object.freeze({
      get dir() { return say('write'); },
      write() { return say('write'); }, append() { return say('write'); }, read() { return say('write'); },
      exists() { return say('write'); }, remove() { return say('write'); }, list() { return say('write'); },
    });
  /** 挂载点的登记处：装载器把这里收到的函数按用途收走（`boot` / `shutdown` / `healthz` / `matchClass` / `route`）。 */
  const mount = (use) => (fn) => {
    if (!declared(use)) say(use);
    if (typeof fn !== 'function') {
      throw new ModuleRefused('MODULE_BAD_HOOK', `server.modules["${moduleId}"].${use}(...) needs a function, got ${typeof fn}`);
    }
    return registry ? registry(use, fn) : true;
  };
  /**
   * 一条**只读、公开**的动态端点（`uses: ["route"]`）。形状判据住在 `server/http/routeMount.js`（唯一真相），
   * 这里只负责「没声明就抛」与把错误变成带码的 `ModuleRefused`（点名到模块，而不是一句 `TypeError`）。
   * `opts.cache` 缺省 `no-store`，只认 `DYNAMIC_ROUTE_CACHE_POLICIES`。
   */
  const route = (pathname, fn, opts = {}) => {
    if (!declared('route')) say('route');
    const issue = dynamicRoutePathIssue(pathname, packId);
    if (issue) throw new ModuleRefused('MODULE_ROUTE_REFUSED', `server.modules["${moduleId}"].route("${String(pathname)}"): ${issue}`);
    if (typeof fn !== 'function') {
      throw new ModuleRefused('MODULE_BAD_HOOK', `server.modules["${moduleId}"].route("${pathname}") needs a function, got ${typeof fn}`);
    }
    const cache = opts && opts.cache !== undefined ? opts.cache : 'no-store';
    if (!DYNAMIC_ROUTE_CACHE_POLICIES.includes(cache)) {
      throw new ModuleRefused('MODULE_ROUTE_REFUSED', `server.modules["${moduleId}"].route("${pathname}"): cache must be one of: ${DYNAMIC_ROUTE_CACHE_POLICIES.join(', ')}`);
    }
    return registry ? registry.route({ path: pathname, handler: fn, cache }) : true;
  };
  return Object.freeze({
    pack: packId,
    module: moduleId,
    hash: hash || '',
    /** 包的目录（只读；要读包内文件用 `io.read` 才走得到，`dir` 只用于诊断）。 */
    dir,
    log: scoped,
    io,
    /** 服务起来之后跑一次（`server/index.js` 在 listen 之后调用）；回调收到一个**冻结的只读配置快照**
     *  （`{ port, host, stateDir, env }`，见 `bootConfigSnapshot`）—— 包只能观察，不能设值。 */
    onBoot: mount('boot'),
    /** 服务停机时跑一次（关闭流程里，失败只记日志，不阻塞停机）。 */
    onShutdown: mount('shutdown'),
    /** 贡献 `/healthz` 的字段：回调返回一个**扁平**的 JSON 对象（值只能是字符串/数字/布尔/null），带大小上限。 */
    healthz: mount('healthz'),
    /** 用一层包装器包住 `MatchClass`（`fn(Base) => Subclass`）；只有这一项要求包声明 `combat: true`。 */
    matchClass: mount('matchClass'),
    /**
     * 一份**只读标量快照**（是值，不是句柄）：`{ uptimeSec, rss, heapUsed, elu, loopP50, loopP95, loopP99,
     * loopMax, sampleAgeMs, state }`。**绝不**交 `process` / 定时器句柄 / 函数 —— 一个包要报内存就是报这个值，
     * 这就是「源码静态扫描禁 `process`」那条规则得以成立的原因（有正当的替代路径，拒绝才不是死路）。
     * 样本过期时 `loop*` 是 `null` 且 `state` 点名（`server/hostMetrics.js`）。没声明就是抛，与 `io` 同一条。
     */
    metrics: declared('metrics') ? (opts) => hostMetrics({ ...(opts || {}), log: log || noopLog }) : () => say('metrics'),
    /** 一条只读动态端点：`route(path, fn, { cache? }?)`，路径必须在 `/mod/<包id>/…` 里。 */
    route,
  });
}

/** `/healthz` 上一个包最多贡献多少个字段 / 多少字节（端点是给运维看的，不是数据通道）。 */
export const HEALTHZ_LIMITS = Object.freeze({ fields: 12, bytes: 2048 });

/** 一个 `healthz` 回调的返回值判据：扁平、标量、有界。`null` 表示「这次没有要说的」（合法，不加字段）。 */
export function checkHealthzFields(value, moduleId) {
  if (value === null || value === undefined) return { ok: true, fields: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `server.modules["${moduleId}"].healthz(...) must return a flat object of scalars (or null)` };
  }
  const keys = Object.keys(value);
  if (keys.length > HEALTHZ_LIMITS.fields) {
    return { ok: false, reason: `server.modules["${moduleId}"].healthz(...) returned ${keys.length} fields (at most ${HEALTHZ_LIMITS.fields})` };
  }
  const out = {};
  for (const key of keys) {
    const v = value[key];
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
      return { ok: false, reason: `server.modules["${moduleId}"].healthz(...)["${key}"] must be a string, number, boolean or null (nested values make /healthz unbounded)` };
    }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      return { ok: false, reason: `server.modules["${moduleId}"].healthz(...)["${key}"] is not a finite number` };
    }
    out[key] = v;
  }
  if (JSON.stringify(out).length > HEALTHZ_LIMITS.bytes) {
    return { ok: false, reason: `server.modules["${moduleId}"].healthz(...) is larger than ${HEALTHZ_LIMITS.bytes} characters` };
  }
  return { ok: true, fields: out };
}

/** 一个声明的服务端模块的绝对路径（形状层已经判过「包内相对 + .mjs」）。 */
function entryAbs(pack, mod) {
  return path.join(pack.dir, ...String(mod.entry).split('/'));
}

/**
 * `server.modules` 源码里**不许出现**的名字。
 *
 * 取 `SERVER_CODE_FORBIDDEN_GLOBALS`（与那三处**同一张共享表**、同一个扫描器），但**去掉 `globalThis` 一格** ——
 * 这一条是实测出来的，不是拍的：
 *   * 这一格的承诺（`shared/modSurface.js`）**逐字**是「无 `process` / `require` / `eval`」，`globalThis` 不在其中；
 *   * 仓库里**已经有一个能用的 `server.modules` 模块**（`test/packMatchMsg.test.js` 的 fixture）用 `globalThis`
 *     与同进程的测试通信 —— 把 `globalThis` 判死会让那个**合法**模块连带整包被裁掉。业主的规矩是「先查有没有现存包
 *     会被新扫描拒，真有 ⇒ 停下报我，别硬装」，所以这里收窄到承诺里那三个名字（+ `new Function`，`eval` 的同一族）。
 *
 * 诚实的一句：这仍然是**启发式，不是沙箱**。`globalThis['pro'+'cess']` 与 `globalThis['ev'+'al']` 绕得过它 —— 那三处
 * （meta / battle / room）也一样绕得过，它们的表里虽然有 `globalThis`，但拼字符串一样能绕。真正兜底的是
 * 「同一份包字节 ⇒ 同一份服务端代码」的内容哈希 + 模块只能拿到 `uses` 里声明过的那几样东西。
 */
const MODULE_FORBIDDEN_GLOBALS = Object.freeze(SERVER_CODE_FORBIDDEN_GLOBALS.filter(([name]) => name !== 'globalThis'));

/**
 * 静态判定一个 `server.modules` 模块的源码，**在 `import()` 之前**。
 *
 * 这一条是**补上的欠账**：`shared/modSurface.js` 的 `server.modules` 那一格从第一天起就写着
 * 「源码过静态确定性扫描（无 `process` / `require` / `eval`）」，而 `loadServerModules` 只检查了「文件读得到」，
 * 就直接 `import()` 进了**服务器自己的进程**。同一个仓库里另外三处（`server/match/metaPack.js`、
 * `server/battlePack.js`、`server/roomPack.js`）都有这道扫描，只有这一处没有 —— 于是这一格从「声明层 ABI」变成了
 * 一条**没有实现的要求**，而 `MOD_SURFACE` 表面清单存在的意义恰恰是「不要有说了不算的承诺」。
 *
 * 判据刻意与那三处**同机制、同来源**：同一份共享表（`shared/kitAuthoring.js`）、同一个扫描器
 * （`stripComments` + `mentionsIdentifier`）、同一个「先判源码再 import」的次序、同一种「一条 `{code, reason}`
 * 回到裁剪点」的失败形状。**唯一的差别是取哪一段名单**：
 *   * 那三处取 `KIT_FORBIDDEN_GLOBALS + SERVER_CODE_FORBIDDEN_GLOBALS`，因为它们跑在**对局循环**里
 *     （`Date.now` / `Math.random` 会让同一个种子在两端打出不同结果）；
 *   * 这里取 `SERVER_CODE_FORBIDDEN_GLOBALS` 那一段（`process` / `globalThis` / `require` / `eval` /
 *     `new Function`）—— 与这一格的承诺**逐字对应**，而 kit 那一段（时钟、随机、DOM、计时器）**故意不取**：
 *     `boot` / `shutdown` / `healthz` 都在对局之外跑，一个给停机快照盖时间戳的模块用 `Date.now` 是正当的，
 *     本层没有任何契约要求它确定（确定性那条线是 `server.battle` / `server.meta` 的事）。
 *     唯一在对局里跑的挂载点是 `matchClass`，而它单独要求 `combat: true`（`MODULES_NEED_COMBAT`），
 *     进的是房间摘要闸门与 golden 那条线 —— 那条线上另有判据，不靠这一份扫描兼职。
 *
 * 这是启发式，不是沙箱（与那三处逐字同一句免责）：真正兜底的是「同一份包字节 ⇒ 同一份服务端代码」的内容哈希、
 * 以及模块只能拿到 `uses` 里声明过的那几样东西。但它必须挡在 import 前面 —— 一个模块的顶层副作用在 import
 * 那一刻就已经发生了。
 *
 * 拒绝的替代路径要能指出来，否则作者只会看到「我的包没了」：读进程信息不要用 `process`，用宿主给的
 * `host.metrics`（`server/hostMetrics.js`，只读标量快照；它正是为这一条存在的）。
 * @param {string} source
 * @param {string} packId
 * @param {string} moduleId
 * @returns {Array<{ code: string, reason: string }>}
 */
export function serverModuleSourceIssues(source, packId = '', moduleId = '') {
  const code = stripComments(String(source ?? ''));
  const out = [];
  for (const [needle, why] of MODULE_FORBIDDEN_GLOBALS) {
    if (mentionsIdentifier(code, needle)) {
      out.push({
        code: 'MODULES_BAD_SOURCE',
        reason: `"${needle}" is not allowed in a server.modules module${packId ? ` ("${packId}/${moduleId}")` : ''}: ${why}. This module is loaded into the server's own process, so the scan runs before the import — read process values through host.metrics (uses: ["metrics"]) instead of the global`,
      });
    }
  }
  return out;
}

/**
 * 启动时一次：把每个声明了 `server.modules` 的包读出来、import，收下它挂上去的东西。
 *
 * 失败**不抛**：一条 `{ pack, code, reason }` 回到调用方，由它按「一条用不了的声明拒绝整个包」把包裁掉
 * （`server/index.js` 与 `server.preDispatch` / `server.meta` 走**同一个裁剪点**）。
 *
 * @param {{ packs?: Array<any> }} loaded `loadWorkshop(...)`
 * @param {{ log?: any, stateRoot?: string, importModule?: (url: string) => Promise<any> }} [opts]
 * @returns {Promise<{ modules: Array<any>, errors: Array<{ pack: string, code: string, reason: string }> }>}
 */
export async function loadServerModules(loaded, { log = noopLog, stateRoot = null, importModule = (url) => import(url) } = {}) {
  const modules = [];
  const errors = [];
  const packs = (loaded && Array.isArray(loaded.packs) ? loaded.packs : [])
    .filter((p) => p && p.server && Array.isArray(p.server.modules) && p.server.modules.length)
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const pack of packs) {
    for (const mod of pack.server.modules) {
      const abs = entryAbs(pack, mod);
      const inPack = abs === pack.dir || abs.startsWith(pack.dir + path.sep);
      let readable = false;
      try { readable = inPack && fs.statSync(abs).isFile(); } catch { /* stays false: no such file */ }
      if (!readable) {
        errors.push({ pack: pack.id, code: 'MODULES_BAD_ENTRY', reason: `server.modules["${mod.id}"].entry "${mod.entry}" is not a readable file inside the pack` });
        continue;
      }
      // **源码静态扫描必须在 `import()` 之前**（与 `server/match/metaPack.js`、`server/battlePack.js`、
      // `server/roomPack.js` 同一个次序）：一个模块的顶层副作用在 import 那一刻就已经发生，扫描只能挡在前面。
      // 判据住在 `serverModuleSourceIssues`（那里解释了为什么这一格只取 `SERVER_CODE_FORBIDDEN_GLOBALS`）。
      let source;
      try {
        source = fs.readFileSync(abs, 'utf8');
      } catch (e) {
        errors.push({ pack: pack.id, code: 'MODULES_BAD_ENTRY', reason: `server.modules["${mod.id}"].entry "${mod.entry}" is not readable: ${e && e.message ? e.message : e}` });
        continue;
      }
      const sourceIssues = serverModuleSourceIssues(source, pack.id, mod.id);
      if (sourceIssues.length) {
        errors.push({ pack: pack.id, code: sourceIssues[0].code, reason: sourceIssues[0].reason });
        log.warn?.(`[workshop] ${sourceIssues[0].code}: ${pack.id}/${mod.id}: ${sourceIssues[0].reason}`);
        continue;
      }
      // 模块 URL 带包摘要：包换了一版（目录里的字节变了）就是另一条 URL，动态 import 缓存不会把旧模块交回来。
      const url = `${pathToFileURL(abs).href}?v=${encodeURIComponent(pack.hash || '')}&m=${encodeURIComponent(mod.id)}`;
      let ns;
      try {
        ns = await importModule(url);
      } catch (e) {
        errors.push({ pack: pack.id, code: 'MODULES_IMPORT_FAILED', reason: `server.modules["${mod.id}"].entry "${mod.entry}" failed to load: ${e && e.message ? e.message : e}` });
        continue;
      }
      if (!ns || typeof ns.registerServer !== 'function') {
        errors.push({ pack: pack.id, code: 'MODULES_NO_REGISTER', reason: `server.modules["${mod.id}"].entry "${mod.entry}" does not export a registerServer(host) function` });
        continue;
      }
      /** @type {{ boot: Function[], shutdown: Function[], healthz: Function[], matchClass: Function[], route: Array<{ path: string, handler: Function, cache: string }> }} */
      const mounted = { boot: [], shutdown: [], healthz: [], matchClass: [], route: [] };
      const host = moduleHost({
        packId: pack.id, moduleId: mod.id, hash: pack.hash, dir: pack.dir,
        uses: mod.uses, write: mod.write, stateRoot, log,
        registry: Object.assign(
          (use, fn) => { mounted[use].push(fn); return true; },
          { route: (entry) => { mounted.route.push(entry); return true; } },
        ),
      });
      try {
        // 同步调用：与官方内容模块同形（`registerMeta(registry)` 也是同步的），所以「注册没注册上」不需要等一个 Promise。
        ns.registerServer(host);
      } catch (e) {
        const code = e instanceof ModuleRefused ? e.code : 'MODULES_REGISTER_THREW';
        errors.push({ pack: pack.id, code, reason: `server.modules["${mod.id}"]: ${e && e.message ? e.message : e}` });
        log.warn?.(`[workshop] ${code}: ${pack.id}/${mod.id}: ${e && e.message ? e.message : e}`);
        continue;
      }
      mounted.uses = mod.uses;
      // 接收通道（`server.modules[].channels`，DESIGN §28.23）：装载结果把它带出来 —— 它是**声明面**的一部分，
      // 归一化清单里已经进过身份哈希，这里让装载结果与那份清单同形（没声明的模块照样不长这个键）。
      const channels = Array.isArray(mod.channels) ? [...mod.channels] : [];
      modules.push({ pack: pack.id, id: mod.id, entry: mod.entry, hash: pack.hash || '', dir: pack.dir, uses: mod.uses, write: mod.write, ...(channels.length ? { channels } : {}), mounted });
    }
  }
  return { modules, errors };
}

/**
 * 把装载结果变成三样东西：启动 / 停机钩子、`/healthz` 的字段、`MatchClass` 的包装器。
 *
 * 顺序按**包 id**（`loadServerModules` 已经排过），所以「多个包同时给 `/healthz` 加字段 / 包同一层 MatchClass」时
 * 结果不随目录读取顺序变（DESIGN §28.3 的同一条规则）。
 */
export function mountServerModules(modules, { log = noopLog, config = null } = {}) {
  const list = Array.isArray(modules) ? modules.slice() : [];
  return {
    /**
     * 服务起来之后：每个挂了 `boot` 的模块跑一次；抛异常只记日志（一个包不该让服务起不来）。
     * 回调收到 `config`（`server/index.js` 传进来的**冻结只读配置快照**，`bootConfigSnapshot` 产出）——
     * 包**只能观察**：这个对象是深冻结的，改动在 ESM 严格模式下直接抛，不是静默无效。
     */
    boot(configOverride = null) {
      const cfg = configOverride || config;
      for (const m of list) {
        for (const fn of m.mounted.boot) {
          try { fn(cfg); } catch (e) { log.error?.(`[workshop] ${m.pack}/${m.id} onBoot threw`, e); }
        }
      }
    },
    /** 停机：与 `boot` 同一条（失败只记日志，不阻塞停机流程）。 */
    shutdown() {
      for (const m of list) {
        for (const fn of m.mounted.shutdown) {
          try { fn(); } catch (e) { log.error?.(`[workshop] ${m.pack}/${m.id} onShutdown threw`, e); }
        }
      }
    },
    /**
     * `/healthz` 的 `modHealth`：`{ "<包id>": { "<字段>": 标量 } }`。按包 id 分组（两个包不能互相盖字段），
     * 返回**空对象**时调用方不加这个键（干净安装的 `/healthz` 字节不变）。
     */
    healthz() {
      /** @type {Record<string, Record<string, any>>} */
      const out = {};
      for (const m of list) {
        for (const fn of m.mounted.healthz) {
          let value;
          try { value = fn(); } catch (e) { log.warn?.(`[workshop] ${m.pack}/${m.id} healthz threw: ${e && e.message ? e.message : e}`); continue; }
          const checked = checkHealthzFields(value, `${m.pack}/${m.id}`);
          if (!checked.ok) { log.warn?.(`[workshop] ${checked.reason}`); continue; }
          if (!checked.fields) continue;
          out[m.pack] = { ...(out[m.pack] || {}), ...checked.fields };
        }
      }
      return out;
    },
    /** `MatchClass` 的包装器：按包 id 次序层层套上（第一个包的包装器在最里层）。 */
    matchClassWrappers() {
      const out = [];
      for (const m of list) for (const fn of m.mounted.matchClass) out.push({ pack: m.pack, id: m.id, fn });
      return out;
    },
    /**
     * 动态只读端点的**解析结果**：`Map<逐字声明的路径, { handler, cache, pack, module }>`。
     *
     * 冲突在这里收敛（注册时只判单条路径的合法性 —— 「自己的命名空间」这条规则让跨包冲突在结构上不可能，
     * 但真发生了也按 DESIGN §28.3「包 id 小的赢 + 点名」处理）。返回**空 Map** 时 `server/http/static.js`
     * 那一段整块跳过 —— 没有包声明 `route` 的安装逐字节不变。
     */
    routes() {
      const reg = createDynamicRoutes();
      for (const m of list) {
        for (const entry of m.mounted.route || []) {
          const r = reg.register({ pack: m.pack, module: m.id, path: entry.path, handler: entry.handler, cache: entry.cache });
          if (!r.ok) log.warn?.(`[workshop] ${m.pack}/${m.id} route "${entry.path}": ${r.reason}`);
        }
      }
      const table = reg.map();
      if (table.size) {
        log.info?.(`[workshop] ${table.size} dynamic route(s) mounted by packs: ${reg.paths().map((p) => `"${p}"`).join(', ')} (read-only, GET/HEAD, public like every other HTTP endpoint of this server)`);
      }
      return table;
    },
  };
}

/** 被允许的挂载点（与形状层的闭枚举同一份；供文档与测试引用）。 */
export const MODULE_USES = SERVER_MODULE_USES;
