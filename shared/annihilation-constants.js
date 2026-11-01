// shared/annihilation-constants.js — 湮灭模拟自己的常量。
//
// Why this file exists: shared/constants.js is the one file every mod overwrites (同盟模拟 / 测试模拟 / 湮灭模拟 都改它).
// 重装任何一个 mod 都会把它换掉，而湮灭模拟的 gamedata / lobby / protocol / 客户端都 import EROSION_MAX，
// 少一个导出服务器就直接起不来（2026-10-18、10-19、10-20 各撞过一次）。所以蚀流常量放到这个独立模块里，
// 其他 mod 不会碰它。constants.js 里仍然保留同名导出（兼容旧代码）。
export const EROSION_MAX = 6;      // 蚀流 1~6
export const EROSION_ENDLESS = 6;  // 蚀流 6 = 无尽湮灭

// 湮灭模拟不是 shared/constants.js 的 DIFFICULTIES 里的一员（那一份是官方四档，界面用它画 4 张难度卡；往里加会让
// 官方选择器多出第五张）。它靠 `difficulty: 'ANNIHILATION'` + erosion 区分，所以常量放在这里，由协议校验显式认这一支。
export const ANNIHILATION_DIFFICULTY = 'ANNIHILATION';

/**
 * 湮灭专属 mod 里**缺省开启**的两条内容开关（罗德岛盟约 / 卡兹戴尔盟约，2026-10-29 业主口径「默认开启」）。
 * 房间的显式值压过缺省，`{ kazdelShip: false }` 能真的把它关掉（`server/lobby.js normalizeAnnMods` 会把 `false` 留下来）。
 *
 * 这份名单是**两侧共用的唯一来源**：整备侧 `server/match/gamedata.js` 的 `annMod()` / `annihilationFlags()`
 * 与战斗侧 `server/sim/content/bonds/addon/annbonds.js` 都按它判，否则「面板显示开、战斗里没效果」这类静默不一致
 * 没有任何报错。改这里就等于同时改两侧。
 */
export const ANN_MOD_DEFAULT_ON = Object.freeze(['rhodesShip', 'kazdelShip']);

/**
 * 一个内容开关在给定房间开关表下的值：显式 boolean（`true` / `false`）压过缺省，缺省看 {@link ANN_MOD_DEFAULT_ON}。
 * `comms` 视作 `commsPriority`（协议里的旧写法）。
 * @param {Record<string, boolean> | null | undefined} annMods 房间显式开关（`room.annMods` / `battle.flags.annMods`）
 * @param {string} name 内容开关名
 * @returns {boolean}
 */
export function annModOn(annMods, name) {
  const key = name === 'comms' ? 'commsPriority' : name;
  if (annMods && typeof annMods === 'object' && typeof annMods[key] === 'boolean') return annMods[key] === true;
  return ANN_MOD_DEFAULT_ON.includes(key);
}
