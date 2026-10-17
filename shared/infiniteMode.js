// shared/infiniteMode.js — 超限模拟（无限模式）独立规则与数值公式
// 保持 100% 独立解耦，纯 ESM，双端共用。

/** 无限模式专用房间模式标识 */
export const SOLO_INFINITE = 'solo_infinite';

/** 超限模拟单次伤害限额（99,999,999，防止溢出 32 位整型） */
export const BOSS_HIT_LIMIT_INFINITE = 99999999;

/** 理论最大轮次 */
export const INFINITE_MAX_ROUND = 9999;

/** 物理最小攻击间隔（秒）：15 次/秒上限，防止高攻速爆帧 */
export const MIN_ATTACK_INTERVAL_SEC = 0.066;

/**
 * 判定当前模式是否为超限模拟
 * @param {string} mode
 * @returns {boolean}
 */
/**
 * 「独占单人」的房间模式：`solo` 与 `solo_infinite`（超限模拟）。房间的座位上限、能否加入、能否加 AI、
 * 续局窗口这些判定都必须走它 —— 之前它们写成 `mode === 'solo'`，于是超限模拟被当成同盟房：能被别人加入、
 * 能加 AI 队友、对外报 4 个座位（owner 报告：进超限模拟结果进了同盟房）。
 * @param {string|undefined|null} mode
 * @returns {boolean}
 */
export function isSoloRoomMode(mode) {
  return mode === 'solo' || mode === SOLO_INFINITE;
}

/**
 * @param {string|undefined|null} mode
 * @returns {boolean}
 */
export function isInfiniteMode(mode) {
  return mode === SOLO_INFINITE;
}

/**
 * 随着波次计算敌方控制抗性 (Tenacity Scaling)
 * R <= 15: 0% 抗性（遵循原版）
 * R >= 16: 每波递增 2%，最高 75%
 * @param {number} round
 * @returns {number} 0.0 ~ 0.75
 */
export function getInfiniteCcResist(round) {
  const r = Number(round) || 1;
  if (r <= 15) return 0;
  return Math.min(0.75, 0.02 * (r - 15));
}

/**
 * R16+ 敌方属性指数膨胀公式
 * @param {number} round
 * @param {{ hpMul?: number, atkMul?: number, speedMul?: number }} baseR15
 * @returns {{ hpMul: number, atkMul: number, speedMul: number }}
 */
export function enemyInfiniteScale(round, baseR15 = { hpMul: 2.5, atkMul: 1.8, speedMul: 1.15 }) {
  const r = Number(round) || 1;
  if (r <= 15) {
    return {
      hpMul: Number(baseR15.hpMul) || 1,
      atkMul: Number(baseR15.atkMul) || 1,
      speedMul: Number(baseR15.speedMul) || 1,
    };
  }
  const delta = r - 15;
  // 生命值多项式+指数混合膨胀
  const hpMul = (Number(baseR15.hpMul) || 2.5) * (1 + 0.12 * delta + 0.008 * delta * delta);
  // 攻击力平滑线性递增
  const atkMul = (Number(baseR15.atkMul) || 1.8) * (1 + 0.08 * delta);
  // 移动速度硬上限限制在 2.5，防止敌人瞬移进门无法防御
  const speedMul = Math.min(2.5, (Number(baseR15.speedMul) || 1.15) * (1 + 0.015 * delta));

  return { hpMul, atkMul, speedMul };
}

/**
 * R16+ Boss 领袖生命值递增计算
 * @param {number} baseHp
 * @param {number} round
 * @returns {number}
 */
export function getInfiniteBossHp(baseHp, round) {
  const r = Number(round) || 15;
  if (r <= 15) return baseHp;
  // 逐回合平滑复利（业主 2026-10-17 定：原来是「每 5 回合跳一档 ×1.35」，
  // R19→R20 血量直接翻倍、R24→R25 却一动不动，手感是突然变硬而不是逐渐变硬）。
  // 每回合 ×1.06，5 回合累计 ×1.338，与原来 ×1.35 同量级，但曲线连续、没有跳档。
  // 注意不要在外面再套 Math.round 到 1.x 量级的倍率上（那会把相邻两档并成同一档）。
  return Math.round(baseHp * Math.pow(1.06, Math.max(0, r - 15)));
}
