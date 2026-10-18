// shared/infiniteMode.js — 超限模拟（无限模式）独立规则与数值公式
// 保持 100% 独立解耦，纯 ESM，双端共用。

/** 无限模式专用房间模式标识 */
export const SOLO_INFINITE = 'solo_infinite';

/** 超限模拟单次伤害限额（99,999,999，防止溢出 32 位整型） */
export const BOSS_HIT_LIMIT_INFINITE = 99999999;

/** 超限模拟里盟约层数的上限（原版与普通模式是 999） */
export const INFINITE_BOND_LAYER_CAP = 9999;

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
export function enemyInfiniteScale(round, baseR15 = { hpMul: 1, atkMul: 1, speedMul: 1 }) {
  const r = Number(round) || 1;
  const base = {
    hpMul: Number(baseR15.hpMul) || 1,
    atkMul: Number(baseR15.atkMul) || 1,
    speedMul: Number(baseR15.speedMul) || 1,
  };
  if (r <= 15) return base;

  // 业主 2026-10-17：「改成原指数，曲线稍微陡一点点」。
  //
  // 原版最高难度（ABYSS）R1–R15 的倍率是**纯指数**：hp = 1.2^k、atk = 1.1^k，k 基本每 5 回合 +1
  // （R1 k=1 … R15 k=7）。超限以前用的是二次多项式 base×(1+0.12Δ+0.008Δ²)，到 R60 已经比
  // 原版指数高 4.4 倍 —— 等于「原版的加速版」而不是「原版的延长」，玩家强度必然跟不上。
  //
  // 现在改成延续同一条指数，只把每档的底数从 1.2 抬到 1.24（hp）/ 1.12（atk）：
  // 5 回合累计 ×1.71（原版 ×1.49），比原版陡一点，但仍是**同一种曲线形状**，后期不会失控。
  const k = Math.max(0, Math.floor((r - 15) / 5)); // R16–R19 → 0，R20–R24 → 1 …
  const HP_STEP = 1.24;
  const ATK_STEP = 1.12;
  const hpMul = base.hpMul * Math.pow(HP_STEP, k);
  const atkMul = base.atkMul * Math.pow(ATK_STEP, k);
  // 移动速度硬上限 2.5：防止敌人瞬移进门无法防御
  const speedMul = Math.min(2.5, base.speedMul * (1 + 0.015 * (r - 15)));

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
  // 与敌人倍率用同一条指数（enemyInfiniteScale 的 1.24 每档），Boss 才不会被杂兵反超。
  // 原版 Boss 血点本身就是「一档 Boss 一个数」，这里把「档」对齐到每 5 回合 +1，
  // 每档 ×1.24 —— 与杂兵同一条曲线，且逐档连续（不再是 1.06 的逐回合复利，也不是更早的 ×1.35 跳档）。
  const k = Math.max(0, Math.floor((r - 15) / 5));
  return Math.round(baseHp * Math.pow(1.24, k));
}
