// server/roomAssets.js — **按房间物化**这一局要用的游戏数据与行为层（W-B，DESIGN §28.16）。
//
// 今天（W-A 之后）房间能声明自己的模组集合，那个集合会随房间状态发给成员，但**它还没有决定跑什么**：对局拿到的仍是
// 进程级那一份「官方 + 所有已装包」的数据与 kit 映射。W-B 就是把这句话变成事实 —— 声明了集合的房间只跑它声明的
// 那几个包。
//
// 三条性质：
//   * **没声明集合的房间拿到的是进程级那一份本体**（同一个对象，不是一份拷贝）：所以「没声明集合的房间与从前逐字节
//     相同」这句话是可以断言的**对象身份**，而不是一句承诺。声明了**全部**包同样走这一条（合并结果本来就是那一份）。
//   * **按摘要缓存**：同一个集合（同一份摘要）只物化一次。两个房间声明同一套包时共享同一份数据与 kit 映射，
//     所以「按房间」不等于「每局重新合并一遍」。
//   * **物化是纯的**：`applyWorkshop(official, packs)` 不碰输入，结果 `deepFreeze`（与 `server/data.js` 同一条），
//     所以一个房间的对局改不到另一个房间看到的东西。
//
// 官方那一半（`official`）必须**不带工坊叠加**（`loadData(dir, { workshopDir: null })`）：否则「只并这几个包」
// 就无从谈起 —— 别的包的记录已经在里面了。

import { applyWorkshop, workshopSummary } from '../shared/workshop.js';
import { deepFreeze } from './data.js';

/**
 * @param {{
 *   official: Record<string, any>,    官方数据（无工坊叠加）
 *   processData: Record<string, any>, 进程级那一份（官方 + 所有已加载包）
 *   packs: Array<any>,                已加载（且已裁剪）的包
 *   kits: Record<string, Function>,   进程级的 kit 映射（干员键）
 *   kitOwners: Map<string, string>,   kit id → 包 id（`loadWorkshopKits` 的 `owners`）
 *   tokenKits: Record<string, Function>, 进程级的 summon kit 映射（token 键，docs/WORKSHOP.md §4.7）
 *   tokenKitOwners: Map<string, string>,  token kit id → 包 id（`loadWorkshopKits` 的 `tokenOwners`）
 *   modules: Array<any>,              kit 的模块清单（带 `pack`，token 那一半带 `kind: 'token'`）
 *   log?: any,
 * }} opts
 * @returns {{ forRoom: (modSet: { digest: string, packs: Array<{ id: string }> }|null) => { data: any, kits: any, tokenKits: any, modules: any }, size: () => number }}
 */
export function createRoomAssets({ official, processData, packs, kits, kitOwners, tokenKits = null, tokenKitOwners = null, modules, log = null }) {
  const list = Array.isArray(packs) ? packs : [];
  const allIds = new Set(list.map((p) => p.id));
  const processAssets = {
    data: processData,
    kits,
    tokenKits,
    modules: Array.isArray(modules) ? modules : [],
  };
  /** @type {Map<string, { data: any, kits: any, tokenKits: any, modules: any }>} */
  const cache = new Map();
  /** digest → the materialised set (the HTTP face of a room, `/room-data/<digest>/…`). Only real digests land here. */
  const byDigest = new Map();
  const sameAsProcess = (ids) => ids.length === allIds.size && ids.every((id) => allIds.has(id));

  /** 一个包集合是不是**正好**就是进程级那一份（空集合与全集都算）。 */
  function isProcess(ids) { return ids.length === 0 || sameAsProcess(ids); }

  return {
    /**
     * 这一局的数据 / kit / 模块清单。没有声明集合（或声明了全部）时返回**进程级那一份本体**。
     * @param {{ digest: string, packs: Array<{ id: string }> }|null} modSet `Room.modSet`（W-A）
     */
    forRoom(modSet) {
      const ids = modSet && Array.isArray(modSet.packs) ? modSet.packs.map((p) => p && p.id).filter(Boolean) : [];
      if (isProcess(ids)) return processAssets;
      const key = modSet.digest || ids.slice().sort().join(',');
      const hit = cache.get(key);
      if (hit) return hit;
      const chosen = list.filter((p) => ids.includes(p.id));
      const { data: merged, report } = applyWorkshop(official, chosen);
      log?.info?.(`[room-assets] materialised ${chosen.length} pack(s) for a room (${workshopSummary(report)})`);
      for (const e of report.errors) log?.warn?.(`[room-assets] ${e.pack}: ${e.reason}`);
      // 只带这个房间声明的那几个包的 kit：进程级的映射里每个 kit 都记着它的包（`owners` / `tokenOwners`）。
      // 两个键空间各裁各的 —— 合并成一张表就会让「一个房间声明了 A 包」连 B 包的 summon kit 一起带上。
      /** @type {Record<string, Function>} */
      const roomKits = {};
      for (const [id, fn] of Object.entries(kits || {})) {
        const owner = kitOwners && typeof kitOwners.get === 'function' ? kitOwners.get(id) : null;
        if (owner && ids.includes(owner)) roomKits[id] = fn;
      }
      /** @type {Record<string, Function>} */
      const roomTokenKits = {};
      for (const [id, fn] of Object.entries(tokenKits || {})) {
        const owner = tokenKitOwners && typeof tokenKitOwners.get === 'function' ? tokenKitOwners.get(id) : null;
        if (owner && ids.includes(owner)) roomTokenKits[id] = fn;
      }
      const built = {
        data: deepFreeze(merged),
        kits: Object.freeze(roomKits),
        tokenKits: Object.freeze(roomTokenKits),
        modules: Object.freeze((Array.isArray(modules) ? modules : []).filter((m) => m && ids.includes(m.pack))),
      };
      cache.set(key, built);
      if (modSet.digest) byDigest.set(modSet.digest, built);
      return built;
    },
    /**
     * The materialised set of one room digest (`/room-data/<digest>/<file>.json`), or null when no room ever declared
     * it. Only digests a room really declared are answerable: a client cannot make the server merge an arbitrary pack
     * combination by inventing a digest, and the number of caches stays bounded by the number of rooms.
     * @param {string} digest
     * @returns {{ data: any, kits: any, modules: any } | null}
     */
    byDigest(digest) {
      return typeof digest === 'string' && byDigest.has(digest) ? byDigest.get(digest) : null;
    },
    /** 已经物化了几套（诊断与测试用）。 */
    size: () => cache.size,
    /** 其中有几个摘要可以按 URL 取（`/room-data/`）。 */
    digests: () => byDigest.size,
  };
}
