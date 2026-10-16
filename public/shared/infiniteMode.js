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
  const delta = r - 15;
  // 每 5 轮遭遇一次 Boss，每次血量增长 35% ~ 50%
  return Math.round(baseHp * Math.pow(1.35, Math.floor(delta / 5) + 1));
}
