// server/modDispatch.js — 包声明的**分发前钩子总线**（`pack.json.server.preDispatch`，DESIGN §28.13，docs/WORKSHOP.md §1.9）。
//
// 这一层只做一件事：把「包声明的钩子」变成一个 `(conn, msg) => boolean` 函数交给 server/net.js，让它在 `onFrame`
// 里、`validateC2S` 之后、`ping`/`hello` 之前被调用（落点与三条约束见 net.js 的那段注释）。返回 true 表示这条
// 消息已被钩子消费，框架不再把它交给大厅。
//
// 四条硬约束，逐条落在下面的代码里：
//
//   1. **不注册第二个 `socket.on('message')`。** 监听器是框架在 net.js 注册的；再注册一个会让同一条消息被处理两次
//      （`room.create` / `g.buy` 这类有副作用的类型是实打实的双执行）。所以钩子是**被调用**的，不是自己抢帧的
//      （`_up/mod4-pack/integration/server/resourceAdmission.mjs` 的文件头把这件事写透了）。测试里有一条
//      `listenerCount('message') === 1` 钉住它。
//   2. **没有包声明就什么都不装。** `createModDispatch` 在没有钩子时返回 `null`，Network 因此拿不到 `preDispatch` /
//      `onConnection` 两个选项 —— `onFrame` 与今天逐字节相同（没有分支进入、没有日志、没有任何对象被创建）。
//   3. **状态按连接隔离。** 每个连接的钩子实例是**各自创建**的（工厂每个连接调用一次），实例只挂在这一条连接的
//      WeakMap 条目上；没有任何跨连接 / 跨房间的可变状态，所以多局并发不会串味。业主裁决明令禁止
//      「开打前设全局、打完恢复」那种写法。
//   4. **注入面刻意小且冻结。** 工厂拿到的是一个 `Object.freeze` 过的依赖对象，键只有
//      `pack` / `policy` / `policyFile` / `intercepts` / `c2s` / `log` / `now` / `send`：没有 `data`、没有 `lobby`、
//      没有 `Match`、没有战斗对象。所以钩子**能做的只有观察、记录、上报、以及否决它被声明的入口消息** ——
//      「不声明 `combat: true` 的包注入不得改变对局结果」在这里是结构性的，而不是靠作者自觉。`c2s` 与 `policy` 是
//      冻结的副本（一个包改不动协议目录，也改不动别的连接看到的策略），`log` 是只转发的门面，`now` 是**注入的**
//      时钟（包的逻辑不读全局时钟；框架自己也不用 RNG、不依赖无序容器的遍历顺序 —— 钩子次序按包 id 排序）。
//
// 钩子的失败姿态：**加载期点名拒绝，运行期不消费**。工厂抛异常或没返回 `preDispatch(conn, msg)` 时，这条连接的
// 这个钩子被记一条 error 并当作不存在；`preDispatch` 抛异常时记一条 error 并当作「没有否决」（消息照常分发）。
// 这是有意的：一道因为自己的 bug 而 fail-closed 的闸门会让一个坏包把所有人的连接挡在门外，而「拒绝这个钩子」是
// 加载期（server/workshop.js loadWorkshopHooks）该做的事 —— 那里一个坏声明是**点名拒绝**的。

import { C2S } from '../shared/protocol.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 交给包工厂的依赖对象的键，一个不多一个不少（测试钉住这份名单）。刻意**没有** data / lobby / Match / 任何对局
 * 对象：注入面就是「这个钩子能碰到什么」的全部答案（见文件头第 4 条）。
 */
export const PRE_DISPATCH_DEPS = Object.freeze([
  'pack', 'policy', 'policyFile', 'intercepts', 'c2s', 'log', 'now', 'send',
]);

/** 冻结的协议目录副本：一个包改不动 `C2S`（进程级可变全局状态），也看不到别的包写了什么。 */
const FROZEN_C2S = Object.freeze(Object.fromEntries(
  Object.entries(C2S).map(([type, spec]) => [type, Object.freeze({
    ...spec,
    ...(Array.isArray(spec.$optional) ? { $optional: Object.freeze([...spec.$optional]) } : {}),
  })]),
));

/** JSON 数据深冻结：策略文件是包给的**数据**，一个连接改它不该让别的连接看见（文件头第 3 条）。 */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** 只转发的日志门面：包拿到的是我们这几个函数，改不动宿主 logger 上的东西。 */
const logFacade = (log) => Object.freeze({
  info: (...a) => log.info?.(...a),
  warn: (...a) => log.warn?.(...a),
  error: (...a) => log.error?.(...a),
  debug: (...a) => log.debug?.(...a),
});

/** 包 id 次序（DESIGN §28.3 的同一条规则）：钩子的调用次序不随发现顺序 / 声明顺序变。 */
const byPackId = (a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : 0);

/**
 * 把加载好的钩子装配成一个 `preDispatch` / `onConnection` 对。
 *
 * @param {{
 *   hooks?: Array<{ pack: string, policy?: object, policyFile?: string, intercepts?: string[], create: Function }> | null,
 *   send: (conn: any, msg: object) => unknown,
 *   log?: { info?: Function, warn?: Function, error?: Function, debug?: Function } | null,
 *   now?: () => number,
 *   c2s?: Record<string, any>,
 * }} opts
 *   `send` 必须是框架自己的发送助手（`(conn, msg) => network.reply(conn, msg)`）：它带背压守卫（server/net.js
 *   sendRaw），包不得自己写 socket —— 那是第二条写路径。
 * @returns {null | { preDispatch: (conn: any, msg: object) => boolean, onConnection: (conn: any) => void,
 *   packs: string[], intercepts: string[] }}
 *   `null` 表示没有任何包声明钩子：调用方据此**不要**给 Network 传这两个选项。
 */
export function createModDispatch({ hooks, send, log = noopLog, now = Date.now, c2s = C2S } = {}) {
  const list = (Array.isArray(hooks) ? hooks : [])
    .filter((h) => h && typeof h.pack === 'string' && typeof h.create === 'function')
    .slice()
    .sort(byPackId);
  if (!list.length) return null;
  if (typeof send !== 'function') throw new TypeError('createModDispatch needs a send(conn, msg) function (the framework send helper)');

  const logger = log ? logFacade(log) : noopLog;
  const catalogue = c2s === C2S ? FROZEN_C2S : deepFreeze(c2s);
  /** 每个钩子一份**冻结**依赖（与连接无关），工厂每个连接用它建一个实例。 */
  const deps = new Map();
  for (const hook of list) {
    deps.set(hook.pack, Object.freeze({
      pack: hook.pack,
      policy: deepFreeze(hook.policy ?? {}),
      policyFile: typeof hook.policyFile === 'string' ? hook.policyFile : null,
      intercepts: Object.freeze([...(hook.intercepts || [])]),
      c2s: catalogue,
      log: logger,
      now,
      send,
    }));
  }

  /** 连接 → (包 id → 钩子实例)。WeakMap：连接被回收时条目跟着走，不留全局登记表。 */
  const perConnection = new WeakMap();

  /** 这条连接的钩子实例（每个连接、每个钩子各建一次；工厂抛异常 = 该钩子在这条连接上不存在）。 */
  function instancesFor(conn) {
    let map = perConnection.get(conn);
    if (map) return map;
    map = new Map();
    for (const hook of list) {
      let inst = null;
      try {
        inst = hook.create(deps.get(hook.pack));
      } catch (e) {
        logger.error(`[mod] ${hook.pack}: server.preDispatch factory threw — the hook is not installed on this connection`, e);
      }
      if (!inst || typeof inst.preDispatch !== 'function') {
        if (inst) logger.error(`[mod] ${hook.pack}: server.preDispatch factory returned no preDispatch(conn, msg) function`);
        inst = null;
      }
      map.set(hook.pack, inst);
    }
    perConnection.set(conn, map);
    return map;
  }

  /** 连接建立时：给每个钩子一次「连接私有的初始化」机会（资源挑战就是在这里发出去的）。 */
  function onConnection(conn) {
    const map = instancesFor(conn);
    for (const hook of list) {
      const inst = map.get(hook.pack);
      if (!inst || typeof inst.onConnection !== 'function') continue;
      try {
        inst.onConnection(conn);
      } catch (e) {
        logger.error(`[mod] ${hook.pack}: preDispatch.onConnection crashed`, e);
      }
    }
  }

  /**
   * 分发前调用（server/net.js onFrame）。**每一条通过协议校验的消息都会走这里**，不只是 `intercepts` 里那些：
   * 钩子总线自己的三个 `resource.*` 类型不在任何 `intercepts` 里（它们不是「进入一局」的入口），却必须到达钩子。
   * `intercepts` 是**钩子自己**用来判断「要不要闸」的名单（框架把它原样注入，并在加载期按协议校验过）。
   * @returns {boolean} true = 这条消息已被消费，不要再交给大厅
   */
  function preDispatch(conn, msg) {
    const map = instancesFor(conn);
    for (const hook of list) {
      const inst = map.get(hook.pack);
      if (!inst) continue;
      let taken = false;
      try {
        taken = inst.preDispatch(conn, msg) === true;
      } catch (e) {
        logger.error(`[mod] ${hook.pack}: preDispatch(${msg && msg.t}) crashed — the message is not consumed`, e);
      }
      if (taken) return true;
    }
    return false;
  }

  // 报告面（日志与测试读它）：装了哪些包、全部 `intercepts` 的并集（去重排序，与 A 段的归一化同一口径）
  const intercepts = [...new Set(list.flatMap((h) => h.intercepts || []))].sort();
  return { preDispatch, onConnection, packs: list.map((h) => h.pack), intercepts };
}
