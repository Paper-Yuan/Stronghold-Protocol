// shared/infiniteMode.js — 超限模拟（无限模式）独立规则与数值公式
// 保持 100% 独立解耦，纯 ESM，双端共用。

/** 无限模式专用房间模式标识 */
export const SOLO_INFINITE = 'solo_infinite';

/**
 * 超限模拟单次伤害限额（业主 2026-10-20：99,999,999 → 9,999,999,999）。
 * 这是**单次**伤害的上限，不是总伤害；9,999,999,999 仍在 Number 的安全整数范围内
 * （2^53 ≈ 9.007e15），也远小于 Boss 血池随轮次的增长。
 */
export const BOSS_HIT_LIMIT_INFINITE = 9999999999;

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
 * @param {{ hpMul?: number, atkMul?: number, speedMul?: number, defMul?: number, resMul?: number }} baseR15
 * @returns {{ hpMul: number, atkMul: number, speedMul: number, defMul: number, resMul: number }}
 */
export function enemyInfiniteScale(round, baseR15 = { hpMul: 1, atkMul: 1, speedMul: 1 }) {
  const r = Number(round) || 1;
  const base = {
    hpMul: Number(baseR15.hpMul) || 1,
    atkMul: Number(baseR15.atkMul) || 1,
    speedMul: Number(baseR15.speedMul) || 1,
  };
  if (r <= 15) return { ...base, defMul: 1, resMul: 1 };

  // 业主 2026-10-17：「改成原指数，曲线稍微陡一点点」。
  //
  // 原版最高难度（ABYSS）R1–R15 的倍率是**纯指数**：hp = 1.2^k、atk = 1.1^k，k 基本每 5 回合 +1
  // （R1 k=1 … R15 k=7）。超限以前用的是二次多项式 base×(1+0.12Δ+0.008Δ²)，到 R60 已经比
  // 原版指数高 4.4 倍 —— 等于「原版的加速版」而不是「原版的延长」，玩家强度必然跟不上。
  //
  // 现在改成延续同一条指数，只把每档的底数从 1.2 抬到 1.24（hp）/ 1.12（atk）：
  // 5 回合累计 ×1.71（原版 ×1.49），比原版陡一点，但仍是**同一种曲线形状**，后期不会失控。
  // 业主 2026-10-19：「进入无限轮次时依旧每回合平滑增长，中间不断」。
  //
  // 之前是每 5 回合跳一档（R16–R20 全一样、R21–R25 全一样），玩家打起来是「几轮没变，突然跳一下」。
  // 现在把同一档的倍数摊到 5 个回合上：每回合 ×(1.24^(1/5)) ≈ ×1.0439，
  // R15→R60 的总倍数和原来完全一致（1.24^9），只是曲线变成了连续上升。
  //
  // 业主 2026-10-19：「数值依旧参考最难模式，但我要求一路以指数形式进行，而不是以模拟形式」。
  // 三种量以前各走各的曲线（血量按档复利、攻击另一个底数、速度是线性 1+0.015Δ）——
  // 现在统一成**同一条逐回合指数**：hp ×1.0439、atk ×1.0371、speed ×1.01 每回合，
  // 从绝境 R15 的真实数值接着往上，不再有线性段、也不再有 5 回合台阶。
  const k = Math.max(0, r - 15);
  // 业主 2026-10-20：「攻击力的曲线降低一点，生命力抬高一点」——A 方案。
  //   hp  每回合 ×1.06（从 ×1.05 抬高：R60 32.2 → 49.3 倍）
  //   atk 每回合 ×1.16^(1/5) = ×1.0301（从 1.20^(1/5) 降低，和防御同底数：
  //       R60 10.05 → 7.41 倍）
  //   speed 保持 ×1.01，硬上限 2.5
  // 效果：atk/hp 从 0.31 降到 0.15（R60），威胁从「会被打死」偏向「打不动」。
  const HP_STEP = 1.06;
  const ATK_STEP = Math.pow(1.16, 1 / 5);   // 1.0301
  const DEF_STEP = Math.pow(1.16, 1 / 5);   // 防御 ×1.0301/回合
  const RES_STEP = Math.pow(1.12, 1 / 5);   // 法抗 ×1.0229/回合（成长比防御慢：法抗是百分比，涨太快会免疫）
  const hpMul = base.hpMul * Math.pow(HP_STEP, k);
  const atkMul = base.atkMul * Math.pow(ATK_STEP, k);
  const defMul = Math.pow(DEF_STEP, k);
  const resMul = Math.pow(RES_STEP, k);
  const speedMul = Math.min(2.5, base.speedMul * Math.pow(1.01, k));

  return { hpMul, atkMul, speedMul, defMul, resMul };
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
  // 与杂兵同一条曲线、同样**每回合平滑**（业主 2026-10-19：「中间不断」）。
  // 之前是每 5 回合跳一档（R20–R24 一样、R25–R29 一样），Boss 血量在两次 Boss 战之间完全不变。
  // 与杂兵同一条指数：逐回合复利，不再每 5 回合跳一档。
  // 业主 2026-10-20（A 方案）：Boss 血跟着杂兵一起抬到每回合 ×1.06，
  // 否则杂兵变厚而 Boss 相对变软。
  const k = Math.max(0, r - 15);
  return Math.round(baseHp * Math.pow(1.06, k));
}
