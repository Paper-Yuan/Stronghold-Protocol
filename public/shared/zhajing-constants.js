// shared/zhajing-constants.js — 炸惊模拟 (ZHAJING) 自己的常量。
//
// Why this file exists: shared/constants.js is the one file every mod overwrites (盟约模拟 / 测试模拟 / 湮灭模拟 / 炸惊模拟
// 都改它)。重装任何一个 mod 都会把它换掉，而炸惊模拟的 gamedata / lobby / 客户端都 import 这几个导出 —— 少一个导出，
// 服务器直接起不来。照 shared/annihilation-constants.js 的做法，把炸惊的常量放在这个独立模块里。
//
// 炸惊模拟不是 shared/constants.js 的 `DIFFICULTIES` 里的一员（那一份是官方四档，界面用它在房间页画 4 张难度卡；
// 往里加会多出第五、六张）。它靠 `difficulty: 'ZHAJING'` 与两条 modeId 区分，所以常量放在这里，由协议校验显式认这一支。
//
// 显示名（难度名/颜色）走 shared/constants.js 的 DIFFICULTY_NAMES / DIFFICULTY_COLORS（房间页与结算页按 difficulty 取），
// 那两处各有一项 ZHAJING —— 那边是界面文案表，不是难度枚举。

/** `mode_{single,multi}_zhajing` 的 difficulty 值；它不是官方四档之一（见上）。 */
export const ZHAJING_DIFFICULTY = 'ZHAJING';

/** 炸惊模拟的两条 modeId（`data/config.json modes` 的键）。 */
export const ZHAJING_MODE_IDS = Object.freeze(['mode_single_zhajing', 'mode_multi_zhajing']);

/**
 * Whether a modeId belongs to 炸惊模拟.
 * @param {unknown} modeId e.g. 'mode_multi_zhajing'
 * @returns {boolean}
 */
export function isZhajingMode(modeId) {
  return typeof modeId === 'string' && ZHAJING_MODE_IDS.includes(modeId);
}

/**
 * Whether a mode record's `difficulty` is 炸惊模拟's. Use this on a mode record / `GameData.difficulty`; use
 * isZhajingMode on a modeId.
 * @param {unknown} difficulty e.g. 'ZHAJING'
 * @returns {boolean}
 */
export function isZhajingDifficulty(difficulty) {
  return difficulty === ZHAJING_DIFFICULTY;
}
