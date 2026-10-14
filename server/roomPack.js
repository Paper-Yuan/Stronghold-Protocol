// server/roomPack.js — 包声明的**房间级钩子**模块的装载路径（`pack.json.server.room`, DESIGN §28.20）。
// (i18n-ignore-file: 这里的文案是给作者/加载器的错误说明 —— 与 server/battlePack.js、server/match/metaPack.js 同一类，不是客户端界面文案)
//
// 这一类载荷补的是**大厅/房间生命周期**那一块：到今天为止包有四类服务端载荷 —— `server.modules`（进程启动）、
// `server.preDispatch`（一次 HTTP 请求）、`server.meta`（一局的商店/经济）、`server.battle`（战场）—— 但
// **没有任何一样覆盖房间本身**：房间被创建、有人加入或离开、有人加入观战、一局开始或结束、房间被销毁。参考社区插件包
// 就是手改 `server/lobby.js`（+687/-14 行）补的这些行为，这就是那个缺口。
//
// 三层结构，与 `server.battle`（`server/battlePack.js`）同形：
//   * **形状**（`shared/workshop.js parseRoomDecl`）：`{ module }`，包内相对 `.mjs`；
//   * **装载**（本文件 `loadRoomInstallers`，启动时一次）：静态确定性扫描 + import 白名单 → 动态 `import` →
//     有没有 `install` 导出；任何一种失败都让**整包**在同一个裁剪点移出已加载集合（`server/index.js`）；
//   * **装配**（本文件 `createRoomHooks`，每个房间一次）：房间建起来时把这个包自己的那个 `install(room)` 跑一次，
//     之后每个事件逐个钩子 try/catch —— 一个包抛异常只记一行日志（`ROOM_HOOK_THREW`，点名**包 + 钩子**），
//     建房、加入、对局结束照旧完成（与 kits / 战斗逻辑的逐包隔离同一条口径）。
//
// **闸门分类（这一刀的重点）**：房间钩子的契约是**观察与声明**，不是改对局。`install(room)` 拿到的是一个只读的
// 观察面（`id` / `modIds` / `members()` / `spectators()` / `phase()` / `now()` / `on` / `off` / `log`），它**没有**
// store、没有大厅内部对象、没有 HTTP 响应、没有文件系统、没有战场句柄，`on(...)` 的回调**返回值被忽略**。
// 判据是**能力**而不是意图：一件改不了「谁在玩 / 装了什么 / 这一局的结果」的能力，**不要求** `combat: true`
// （`shared/workshop.js` 因此没有 `ROOM_NEEDS_COMBAT`），也**不**把包的层推导推成 combat。反过来 —— 将来这一层若
// 交出任何一件能改这三样中任一样的东西（例如「按包自己的规则拒绝一个人进房」「按包的点名换掉这一局的集合」），
// 那件东西**必须**要求 `combat: true` 并写进 §28.20 的分类规则，因为那时它就不再是观察面了。
//
// 为什么 import 走白名单：与 `server.battle` 同一个理由（辅助函数要能 `import`），但名单**更窄** —— 只有 `@sim/`
// 那三个纯函数模块（`shared/kitImports.js ROOM_IMPORT_FILES`）。之所以**不新开 `@room/` 前缀**：白名单前缀是**两端
// 共用**的一张表（`kitImportMap()` 与 `public/index.html` 的 import map 由 `test/kitImports.test.js` 钉在一起），
// 而这个模块**只在服务端**加载 —— 为一个永不进浏览器的模块在浏览器侧开一个命名空间，正是这一层到处在拒绝的
// 「声明了却没有」。复用 `@sim/` 就够了（§28.20 写明这条选择）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { KIT_FORBIDDEN_GLOBALS, SERVER_CODE_FORBIDDEN_GLOBALS, stripComments, mentionsIdentifier } from '../shared/kitAuthoring.js';
import {
  ROOM_IMPORT_TARGETS, roomImportAllowedText, kitImportDeclarations, kitImportIssues, rewriteKitImports,
} from '../shared/kitImports.js';

/** 仓库根：白名单里的路径是**工作区相对**的（与 `server/battlePack.js` 同一个值）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 房间钩子能订阅的**闭枚举**。写成自由字符串的话，一个拼错的事件名就是一个**永远不会触发的钩子** ——
 * 而 `room.on()` 不抛异常（事件总线不该因为一个名字就炸），所以作者看到的是「注册成功、什么都没发生」，
 * 正是这一层到处在消灭的静默失效。所以名字在这里有唯一一份真相：`on` 只认它们，别的名字**点名**
 * （`ROOM_UNKNOWN_EVENT`）并且**不注册**。
 *
 * 顺序是**生命周期顺序**（也是文档表格的顺序），但订阅顺序与触发顺序无关：每个事件触发时按**包 id 升序**跑
 * （§28.3「id 小的先」），所以同一个事件谁先跑不随目录读取顺序变。
 */
export const ROOM_HOOK_EVENTS = Object.freeze([
  'create',
  'join',
  'spectate',
  'leave',
  'matchStart',
  'matchEnd',
  'matchFailed',
  'dispose',
]);

/** 事件名的集合形式（`on` 的判据）。 */
const EVENT_SET = new Set(ROOM_HOOK_EVENTS);

/**
 * 静态判定一个房间钩子模块的源码，**在 import 之前**（与 `battleSourceIssues` 同一套纪律、同一张表）。
 *
 * 唯一的差别是 import 面：这里只有 `@sim/`（见文件头「为什么 import 走白名单」与 §28.20）。
 * @param {string} source
 * @param {string} packId
 * @returns {Array<{ code: string, reason: string }>}
 */
export function roomSourceIssues(source, packId = '') {
  const text = String(source ?? '');
  const code = stripComments(text);
  const out = [];
  for (const [needle, why] of [...KIT_FORBIDDEN_GLOBALS, ...SERVER_CODE_FORBIDDEN_GLOBALS]) {
    if (mentionsIdentifier(code, needle)) {
      out.push({ code: 'ROOM_BAD_SOURCE', reason: `"${needle}" is not allowed in a server.room module${packId ? ` ("${packId}")` : ''}: ${why}` });
    }
  }
  for (const issue of kitImportIssues(text, kitImportDeclarations(text), { targets: ROOM_IMPORT_TARGETS, allowedText: roomImportAllowedText })) {
    out.push({ code: 'ROOM_BAD_IMPORT', reason: `${issue.reason}（server.room 模块的白名单比 kit 与 server.battle 都窄：只有 @sim/ 那三个纯函数模块 —— 房间钩子是观察面，拿不到战场辅助函数）` });
  }
  return out;
}

/** 一个包声明的房间钩子模块的绝对路径（形状层已经判过「包内相对 + .mjs」）。 */
function moduleAbs(pack) {
  return path.join(pack.dir, ...String(pack.server.room.module).split('/'));
}

/**
 * 启动时一次：把每个**声明了 `server.room`** 的包读出来、扫一遍、import，收下它的 `install`。
 *
 * 顺序按包 id 升序（DESIGN §28.3）：一趟里几个包都要挂钩子时，谁先挂谁的钩子先跑 —— 这个顺序不能随目录读取顺序变。
 * 失败**不抛**：一条 `{ pack, code, reason }` 回到调用方，由它按「一条用不了的声明拒绝整个包」把包裁掉
 * （`server/index.js` 与 `server.preDispatch` / `server.meta` / `server.modules` / `server.battle` 走同一个裁剪点）。
 *
 * 返回的 `installers` 是**服务端专用**的真函数：与 `server.battle` 不同，这一层没有浏览器那一半，所以没有一份
 * 「要送出去的 URL 清单」（也没有 `/workshop-room/` 那样的服务面）—— 房间钩子永远只在服务端进程里跑。
 * @param {{ packs?: Array<any> }} loaded `loadWorkshop(...)`
 * @param {{ log?: any, importModule?: (url: string) => Promise<any> }} [opts]
 * @returns {Promise<{ installers: Array<{ id: string, hash: string, pack: string, install: Function }>,
 *   errors: Array<{ pack: string, code: string, reason: string }> }>}
 */
export async function loadRoomInstallers(loaded, { log = null, importModule = (url) => import(url) } = {}) {
  /** @type {Array<{ id: string, hash: string, pack: string, install: Function }>} */
  const installers = [];
  /** @type {Array<{ pack: string, code: string, reason: string }>} */
  const errors = [];
  const packs = (loaded && Array.isArray(loaded.packs) ? loaded.packs : [])
    .filter((p) => p && p.server && p.server.room)
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const pack of packs) {
    const abs = moduleAbs(pack);
    const rel = String(pack.server.room.module);
    let source;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      errors.push({ pack: pack.id, code: 'ROOM_BAD_MODULE', reason: `server.room.module "${rel}" is not readable: ${e && e.message ? e.message : e}` });
      continue;
    }
    const issues = roomSourceIssues(source, pack.id);
    if (issues.length) {
      errors.push({ pack: pack.id, code: issues[0].code, reason: issues[0].reason });
      log?.warn?.(`[workshop] ${pack.id}: ${issues[0].code}: ${issues[0].reason}`);
      continue;
    }
    // 带包摘要的查询串：包换了一版（目录里的字节变了）就是另一条 URL。`[ASSUMED]` 「改 query 就是另一个模块」这条
    // 行为不是 ES 规范保证的，而是 V8 / Node 那条「缓存键含完整说明符」的既有做法 —— 与 `server/battlePack.js` 的
    // `?v=` 逐字相同，所以两处不会给出不同结论。
    const v = encodeURIComponent(pack.hash || '');
    const decls = kitImportDeclarations(source);
    let mod;
    try {
      // 有白名单 import 时加载**改写过的** `data:` 模块：`data:` 没有目录，相对说明符解不出来，所以先把白名单条目
      // 换成真实 `file:` URL。改写只碰白名单里的说明符，包里的字节（也就是身份哈希的输入）一个都不动。
      mod = decls.length
        ? await importModule(`data:text/javascript;base64,${Buffer.from(rewriteKitImports(source, (file) => pathToFileURL(path.join(ROOT, file)).href, { targets: ROOM_IMPORT_TARGETS }), 'utf8').toString('base64')}#v=${v}`)
        : await importModule(`${pathToFileURL(abs).href}?v=${v}`);
    } catch (e) {
      errors.push({ pack: pack.id, code: 'ROOM_IMPORT_FAILED', reason: `server.room.module "${rel}" failed to load: ${e && e.message ? e.message : e}` });
      continue;
    }
    const install = typeof mod?.install === 'function' ? mod.install : null;
    if (!install) {
      errors.push({ pack: pack.id, code: 'ROOM_NO_INSTALL', reason: `server.room.module "${rel}" does not export an install(room) function` });
      continue;
    }
    installers.push({ id: pack.id, hash: pack.hash || '', pack: pack.id, install });
  }
  return { installers, errors };
}

// ---------------------------------------------------------------------------------------------------------------
// 装配路径：每个房间一次
// ---------------------------------------------------------------------------------------------------------------

/** 一个房间的**只读快照**：与 `room.state` 同形的那几个字段，但**没有任何活对象**。 */
function playerSnap(seat) {
  return Object.freeze({
    playerId: seat.playerId, name: seat.name, seat: seat.seat, isBot: !!seat.isBot,
    ready: !!seat.ready, connected: !!seat.connected && !seat.left, left: !!seat.left,
  });
}

function spectatorSnap(s) {
  return Object.freeze({ playerId: s.playerId, name: s.name, connected: !!s.connected });
}

/** 一个 `human()` 用的空座（`player(seat)` 落在空位上时）。 */
const NO_PLAYER = Object.freeze({ playerId: null, name: null, seat: null, isBot: false, ready: false, connected: false, left: false });

/**
 * 房间级钩子的**总线**：启动时装一次（`server/index.js`），每个房间 `install(room)` 一次。
 *
 * 为什么按**房间**留一张表（`byRoom`）而不是把钩子挂在 Room 实例上：`server/lobby.js` 是大厅的事，包的东西不该
 * 出现在房间对象的公开形状上（`room.toState()` 就是拿 `this.` 拼的），而且一张表让「这个房间装了哪几个包的
 * 钩子」成为可以断言的一件事（测试与 `/healthz` 类的诊断都能问它）。
 *
 * W-B（§28.16）：`install(room)` 只跑**这个房间声明的那几个包**的钩子。房间没声明集合（`room.modIds === null`）
 * 时跑**全部**已装载钩子 —— 那正是今天的行为（进程级那一份），所以「没声明集合的房间与从前逐字节相同」这条
 * 不变量在**没有**包声明 `server.room` 时是「一行都不会跑」：`byRoom` 里根本没有条目。
 *
 * 为什么 `install` 的失败**不**拒绝房间（与装载期的「一条用不了的声明拒绝整个包」相反）：装载期拒的是**包**，
 * 那时房间里还没有任何人；装配期抛的是**包的运行时代码**，而此刻已经有真人坐在里面。所以这里的选择是
 * 「点名 + 这一包退场 + 房间照旧」（与 `server/sim/content/index.js` 逐包 try/catch 同一个口径）。
 * @param {{
 *   installers?: Array<{ id: string, install: Function }>,
 *   log?: any,
 *   now?: () => number,
 * }} opts
 * @returns {{
 *   install: (room: any) => Array<{ pack: string, event: string }>,
 *   fire: (room: any, event: string, payload?: object) => void,
 *   reload: (installers: Array<{ id: string, install: Function }>) => void,
 *   packsFor: (room: any) => string[],
 *   forget: (room: any) => boolean,
 *   stats: () => { installers: number, rooms: number },
 * }}
 */
export function createRoomHooks({ installers = [], log = null, now = Date.now } = {}) {
  /** 当前生效的 installers（`reload` 是编辑器/测试的入口；生产里只在启动时设一次）。 */
  let list = (Array.isArray(installers) ? installers : []).filter((i) => i && typeof i.id === 'string' && typeof i.install === 'function');
  /** @type {Map<string, { installers: Array<any>, fired: Array<{ pack: string, event: string }> }>} */
  const byRoom = new Map();

  /** 一个房间声明的包集合（`null` = 没声明，即进程级那一份）。 */
  const roomIdsOf = (room) => (room && room.modSet && Array.isArray(room.modSet.packs)
    ? new Set(room.modSet.packs.map((p) => p && p.id).filter(Boolean))
    : null);

  /** 这个房间该装哪几个包的钩子（W-B：声明了集合就只装集合里那几个）。 */
  function packsFor(room) {
    const ids = roomIdsOf(room);
    return list.filter((i) => !ids || ids.has(i.id)).map((i) => i.id);
  }

  /** 一条命名日志（`ROOM_HOOK_THREW` 是**唯一**的异常出口，别的都是包自己 `room.log.*` 写的）。 */
  function hookError(pack, event, e) {
    const detail = e && e.message ? e.message : String(e);
    log?.warn?.(`[workshop] ROOM_HOOK_THREW: server.room hook "${event}" of pack "${pack}" threw: ${detail}`);
  }

  /**
   * 造一个包的房间观察面（`install(room)` 的参数）。**边界就是这里有什么**：
   * 逐成员的理由见 DESIGN §28.20 的成员表 —— 一句话一条，没有一件能改对局。
   */
  function hookRoom(packId, room) {
    /** 未登记的订阅（按函数身份去重，`off` 是唯一的取消途径）。 @type {Record<string, Function[]>} */
    const handlers = Object.create(null);
    const frozenPlayers = Object.freeze((room.seats || []).filter(Boolean).map(playerSnap));
    const frozenSpectators = Object.freeze((room.spectators || []).map(spectatorSnap));
    const frozenModIds = room.modIds ? Object.freeze([...room.modIds]) : null;
    const logger = Object.freeze({
      info: (...a) => log?.info?.(`[room ${packId}]`, ...a),
      warn: (...a) => log?.warn?.(`[room ${packId}]`, ...a),
      error: (...a) => log?.error?.(`[room ${packId}]`, ...a),
    });
    const api = {
      // 身份与声明
      id: room.code,
      modIds: frozenModIds,
      // 观察（本包**装载时**的那一份快照）
      players: frozenPlayers,
      spectators: frozenSpectators,
      player: (seat) => frozenPlayers.find((p) => p.seat === seat) || NO_PLAYER,
      phase: () => (room.match ? 'match' : 'lobby'),
      now: () => now(),
      // 订阅 / 退订（本包自己的，永远只在本进程内）
      on(event, fn) {
        if (typeof event !== 'string' || !EVENT_SET.has(event)) {
          hookError(packId, 'on', new Error(`ROOM_UNKNOWN_EVENT: "${String(event)}" is not a room lifecycle event (one of: ${ROOM_HOOK_EVENTS.join(', ')})`));
          return false;
        }
        if (typeof fn !== 'function') {
          hookError(packId, 'on', new Error(`room.on("${event}", fn) needs a function, got ${typeof fn}`));
          return false;
        }
        (handlers[event] || (handlers[event] = [])).push(fn);
        return true;
      },
      off(event, fn) {
        const arr = handlers[event];
        if (!Array.isArray(arr)) return false;
        const i = arr.indexOf(fn);
        if (i < 0) return false;
        arr.splice(i, 1);
        return true;
      },
      log: logger,
    };
    return { api: Object.freeze(api), handlers };
  }

  return {
    /** 换掉生效的 installers（生产里只有启动时那一次；两侧都做一份拷贝，调用方改不到这张表）。 */
    reload(next) {
      list = (Array.isArray(next) ? next : []).filter((i) => i && typeof i.id === 'string' && typeof i.install === 'function');
    },

    /**
     * 一个房间建起来时跑一次：装**这个房间声明的那几个包**的 `install(room)`。
     * @returns {Array<{ pack: string, event: string }>} 装不上的那些（点名用；空 = 全部装上）
     */
    install(room) {
      if (!room || typeof room.code !== 'string' || !room.code) return [];
      if (typeof room.seats === 'undefined' || typeof room.spectators === 'undefined') return [];
      const ids = roomIdsOf(room);
      const chosen = list.filter((i) => !ids || ids.has(i.id));
      // 一个包都没声明房间钩子（或这个房间的集合里一个都没有）⇒ 这张表里连条目都不建：
      // 「干净安装 / 没声明集合的房间与从前逐字节相同」在这里是**可断言的空表**，不是一句承诺。
      if (!chosen.length) return [];
      const installed = [];
      const failed = [];
      for (const entry of chosen) {
        const { api, handlers } = hookRoom(entry.id, room);
        try {
          entry.install(api);
          installed.push({ pack: entry.id, handlers });
        } catch (e) {
          // 一个包装不上只让它自己退场 —— 房间已经建起来了，别的人还在等 room.state。
          hookError(entry.id, 'install', e);
          failed.push({ pack: entry.id, event: 'install' });
        }
      }
      if (installed.length) byRoom.set(room.code, { installers: installed, fired: [] });
      return failed;
    },

    /**
     * 触发一个房间事件。**每个钩子单独 try/catch**：一个包抛异常只记一行（`ROOM_HOOK_THREW`，点名包 + 钩子），
     * 房间照旧工作 —— 建房、加入、对局结束都不会因为一个包而失败。
     *
     * `payload` 会**冻结后**交给钩子（浅冻结：值都是标量），所以钩子改不到引擎递给下一个钩子的那一份。
     * 触发顺序按**包 id 升序**（`install` 时已经排好），同一个房间内的事件顺序就是引擎调用的顺序。
     * @param {any} room
     * @param {string} event
     * @param {object} [payload]
     */
    fire(room, event, payload = null) {
      if (!room || typeof room.code !== 'string') return;
      const bucket = byRoom.get(room.code);
      if (!bucket) return; // 没有包声明 / 这个房间的集合里没有：一次函数调用都不多
      if (!EVENT_SET.has(event)) {
        hookError('(engine)', 'fire', new Error(`ROOM_UNKNOWN_EVENT: "${String(event)}" is not a room lifecycle event (one of: ${ROOM_HOOK_EVENTS.join(', ')})`));
        return;
      }
      const data = payload && typeof payload === 'object' ? Object.freeze({ ...payload }) : Object.freeze({});
      for (const { pack, handlers } of bucket.installers) {
        bucket.fired.push({ pack, event });
        for (const fn of handlers[event] || []) {
          try {
            fn(data);
          } catch (e) {
            hookError(pack, event, e);
          }
        }
      }
    },

    /** 这个房间装了哪几个包的钩子（诊断与测试用）。 */
    packsFor,

    /**
     * 忘掉一个房间的钩子表（`dispose` 事件之后由 `Lobby.disposeRoom` 调）。房间码会被 `genCode` 重新用掉，所以
     * 「房间没了」必须真的把这张表删掉 —— 留一个旧条目的后果是下一个同码的房间继承上一个房间的钩子。
     * @param {any} room
     * @returns {boolean} 之前有没有这个房间
     */
    forget(room) {
      const code = room && typeof room.code === 'string' ? room.code : room;
      return typeof code === 'string' && byRoom.delete(code);
    },

    /** 诊断：装了几个包、几个房间有钩子（`/healthz` 与测试用）。 */
    stats() {
      return { installers: list.length, rooms: byRoom.size };
    },
  };
}
