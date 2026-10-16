// server/hostMetrics.js — 包能读到的**只读指标快照**（`server.modules[*].uses` 含 `metrics`）。
// (i18n-ignore-file: 这里的文案是给作者/加载器的错误说明，不是客户端界面文案)
//
// 为什么要有它：`server.modules` 的源码静态扫描禁 `process`（`server/modModules.js serverModuleSourceIssues`），
// 而「这个包报一下内存 / 事件循环延迟」正是那三件原始社区需求里的一条（`/healthz` 加几个字段）。一条**只有禁令
// 没有替代品**的规则会逼作者绕路（`globalThis['pro'+'cess']`），所以这一格给出的就是那个替代品：
//
//   * **是值，不是句柄**：返回一个**深冻结**的普通对象，字段全是有限数或 `null`。没有 `process`、没有
//     `PerformanceObserver`、没有直方图对象、没有定时器句柄、没有函数 —— 包**拿不到任何能改变服务器的东西**，
//     它只能读这一次快照；
//   * **惰性启用**：`monitorEventLoopDelay` 的直方图与采样定时器**只在真有包声明 `uses: ["metrics"]` 时**才建。
//     一个没装这种包的进程里，这个模块除了几个常量什么都没做（干净安装的开销为零）；
//   * **过期就点名，不给一个看起来像真的的旧数**：事件循环被卡住时采样器跑不动，那么 `loop*` 全部是 `null`
//     且 `state` 说 `stale`，同时一行 warn 点名 —— 「不许静默空白」与「不许静默旧值」是同一条纪律的两面。
//
// 采样方式（决定了 `sampleAgeMs` 的语义）：采样器每个 `intervalMs` **读一次百分位并把直方图复位**。所以
// `sampleAgeMs` = 距上一次成功采样多久，而 `loop*` 是**那个窗口内**的延迟（不是进程启动以来的累积值）。
// `elu` 例外：`performance.eventLoopUtilization()` 本身是累积值，没有窗口可言，任何时候都读得到。

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/** 快照的字段闭集（顺序即文档顺序）。**加字段要同时改这里与 docs/design/mod-layer.md 那一节。** */
export const HOST_METRICS_FIELDS = Object.freeze([
  'uptimeSec', 'rss', 'heapUsed', 'elu', 'loopP50', 'loopP95', 'loopP99', 'loopMax', 'sampleAgeMs', 'state',
]);

/** 默认采样窗口（毫秒）。 */
export const HOST_METRICS_INTERVAL_MS = 1000;
/** `monitorEventLoopDelay` 的分辨率（毫秒）。10 ms 是它的默认值，写出来是为了让「为什么会是 10 的倍数」有出处。 */
export const HOST_METRICS_RESOLUTION_MS = 10;
/** 超过这么久没有成功采样，`loop*` 一律 `null` 且 `state` 是 `stale`。 */
export const HOST_METRICS_STALE_MS = 15000;

const noopLog = { warn() {} };

/** @type {{ intervalMs: number, histogram: any|null, timer: any|null, lastSampleAt: number, sample: any|null, warned: boolean }} */
const state = {
  intervalMs: HOST_METRICS_INTERVAL_MS,
  histogram: null,
  timer: null,
  lastSampleAt: 0,
  sample: null,
  warned: false,
};

/** 毫秒（保留 3 位小数）。直方图的百分位是**纳秒**。 */
const nsToMs = (ns) => Math.round((Number(ns) / 1e6) * 1000) / 1000;
/** 有限数或 `null`。保证快照里没有 `NaN` / `Infinity`（它们不是 JSON）。 */
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);

/**
 * 惰性启用（第一次真有人要读数时才建直方图与采样定时器）。多次调用只生效一次。
 * @param {{ intervalMs?: number, resolutionMs?: number }} [opts]
 */
export function enableHostMetrics({ intervalMs = HOST_METRICS_INTERVAL_MS, resolutionMs = HOST_METRICS_RESOLUTION_MS } = {}) {
  if (state.histogram) return;
  state.intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : HOST_METRICS_INTERVAL_MS;
  try {
    state.histogram = monitorEventLoopDelay({ resolution: Number.isFinite(resolutionMs) && resolutionMs > 0 ? resolutionMs : HOST_METRICS_RESOLUTION_MS });
    state.histogram.enable();
  } catch {
    state.histogram = null; // 拿不到直方图时 `loop*` 一律 null、state 是 disabled —— 不假装有数
    return;
  }
  /** 采样：读一次百分位 → 复位 → 记下时刻。`reset()` 之后下一次读的是**新窗口**。 */
  const sampleOnce = () => {
    try {
      state.sample = {
        p50: nsToMs(state.histogram.percentile(50)),
        p95: nsToMs(state.histogram.percentile(95)),
        p99: nsToMs(state.histogram.percentile(99)),
        max: nsToMs(state.histogram.max),
      };
      state.histogram.reset();
      state.lastSampleAt = Date.now();
      state.warned = false;
    } catch { /* 直方图被禁用/关掉了：留着上一份样本，让 sampleAgeMs 自己涨上去 */ }
  };
  sampleOnce();
  state.timer = setInterval(sampleOnce, state.intervalMs);
  // 这个定时器**不该**让进程活着下不来（与 server/net.js 的心跳同一条）。
  state.timer.unref?.();
}

/** 测试用：把所有模块级状态清回「没启用过」。生产代码不调用它。 */
export function resetHostMetrics() {
  if (state.timer) clearInterval(state.timer);
  try { state.histogram?.disable(); } catch { /* already off */ }
  state.histogram = null;
  state.timer = null;
  state.lastSampleAt = 0;
  state.sample = null;
  state.warned = false;
  state.intervalMs = HOST_METRICS_INTERVAL_MS;
}

/**
 * 一次只读快照。
 *
 * 字段与语义：
 *   * `uptimeSec` —— 进程已经跑了多少秒（整数）；
 *   * `rss` / `heapUsed` —— **字节**（`process.memoryUsage()` 的两个字段）；
 *   * `elu` —— 事件循环利用率 [0, 1]（累积，无窗口）；
 *   * `loopP50` / `loopP95` / `loopP99` / `loopMax` —— **毫秒**，最近一个采样窗口内的事件循环延迟；
 *   * `sampleAgeMs` —— 距上一次成功采样多少毫秒（`null` = 从来没采过）；
 *   * `state` —— `ok` | `stale`（样本太旧）| `disabled`（直方图起不来）。
 * 过期时 **`loop*` 四个全是 `null`**，`state` 是 `stale`，并**点名 warn 一次**（不是每请求一行）。
 * @param {{ now?: number, staleMs?: number, log?: object|null }} [opts]
 * @returns {Readonly<{ uptimeSec: number, rss: number|null, heapUsed: number|null, elu: number|null,
 *   loopP50: number|null, loopP95: number|null, loopP99: number|null, loopMax: number|null,
 *   sampleAgeMs: number|null, state: 'ok'|'stale'|'disabled' }>}
 */
export function hostMetrics({ now = Date.now(), staleMs = HOST_METRICS_STALE_MS, log = noopLog } = {}) {
  enableHostMetrics();
  let mem = null;
  try { mem = process.memoryUsage(); } catch { mem = null; }
  let elu = null;
  try { elu = finiteOrNull(performance.eventLoopUtilization().utilization); } catch { elu = null; }
  let uptimeSec = null;
  try { uptimeSec = Math.round(process.uptime()); } catch { uptimeSec = null; }
  const age = state.lastSampleAt ? Math.max(0, now - state.lastSampleAt) : null;
  const stale = state.sample === null || age === null || age > staleMs;
  if (stale && !state.warned) {
    state.warned = true;
    log?.warn?.(`[hostMetrics] event-loop sample is ${age === null ? 'missing' : `${age} ms old`} (limit ${staleMs} ms): every loopP* field answers null with state "stale" rather than a stale number`);
  }
  const loops = stale ? { p50: null, p95: null, p99: null, max: null } : state.sample;
  return Object.freeze({
    uptimeSec: finiteOrNull(uptimeSec),
    rss: mem ? finiteOrNull(mem.rss) : null,
    heapUsed: mem ? finiteOrNull(mem.heapUsed) : null,
    elu,
    loopP50: finiteOrNull(loops.p50),
    loopP95: finiteOrNull(loops.p95),
    loopP99: finiteOrNull(loops.p99),
    loopMax: finiteOrNull(loops.max),
    sampleAgeMs: age,
    state: state.histogram ? (stale ? 'stale' : 'ok') : 'disabled',
  });
}
