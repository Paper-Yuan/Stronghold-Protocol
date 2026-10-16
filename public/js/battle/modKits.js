// public/js/battle/modKits.js — 房间模组包的 **kit 表** (W-C, DESIGN §28.16)。
//
// 战斗规格里的 `modules` 是一份 JSON 安全的 URL 列表（`{ id, pack, url, kind? }`，server/sim/spec.js modModules、
// server/match/Match.js）。浏览器收不到函数，所以这里按那些 URL import 出两张表和规格一起喂给战斗：
// `battle.opts.kits` / `tokenKits`（server/sim/content/index.js 先查注入表，再查内置注册表）。
//
// 两侧的表必须一致：服务端自己跑的那一份（接管 / 校验 / SP_COMBAT=server）用的是同一批包，客户端少一个 kit
// 就意味着这一局双方算出的战报不同，而战报是要被服务端复算校验的（server/match/match/reports.js）。
//
// 缓存按 URL：同一页里每个包只会真的 import 一次，失败的也缓存成 null（下一个包不会重复撞同一面墙）。

/** @type {Map<string, Promise<Function|null>>} */
const cache = new Map();

/**
 * @param {Array<{ id?: unknown, url?: unknown, kind?: unknown }>|null|undefined} modules 规格里的模块列表
 * @returns {Promise<{ kits?: Record<string, Function>, tokenKits?: Record<string, Function> }>} 没有模组时是空对象
 */
export async function loadModuleKits(modules) {
  const list = Array.isArray(modules) ? modules : [];
  if (!list.length) return {};
  /** @type {Record<string, Function>} */
  const kits = {};
  /** @type {Record<string, Function>} */
  const tokenKits = {};
  await Promise.all(list.map(async (m) => {
    if (!m || typeof m.id !== 'string' || typeof m.url !== 'string' || !m.url.startsWith('/')) return;
    let pending = cache.get(m.url);
    if (pending === undefined) {
      pending = import(m.url).then((mod) => (typeof mod?.default === 'function' ? mod.default : null)).catch(() => null);
      cache.set(m.url, pending);
    }
    const fn = await pending;
    if (typeof fn !== 'function') return;
    (m.kind === 'token' ? tokenKits : kits)[m.id] = fn;
  }));
  /** @type {{ kits?: Record<string, Function>, tokenKits?: Record<string, Function> }} */
  const out = {};
  if (Object.keys(kits).length) out.kits = kits;
  if (Object.keys(tokenKits).length) out.tokenKits = tokenKits;
  return out;
}
