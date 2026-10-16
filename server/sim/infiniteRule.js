// server/sim/infiniteRule.js — 超限模拟性能防护与智能控制状态机节流
// 专用于高波次（R16+），防止大量 CC 判定、高频攻击与怪物堆叠导致的 CPU 逻辑阻塞。

import { MIN_ATTACK_INTERVAL_SEC, getInfiniteCcResist } from '../../shared/infiniteMode.js';

export const CC_STATUS_KEYS = new Set([
  'stun', 'freeze', 'sleep', 'silence', 'disarm', 'fear', 'levitate', 'palsy', 'bind', 'cold', 'fragile',
]);

/**
 * 霸体状态键名与持续时长
 */
export const TENACITY_BURST_STATUS = 'cc_immune';
export const TENACITY_BURST_DURATION = 4.0; // 触发霸体持续 4 秒
export const TENACITY_WINDOW_SEC = 10.0;    // 统计滑动窗口 10 秒
export const TENACITY_THRESHOLD_SEC = 6.0; // 累计受控满 6 秒即爆发霸体

/**
 * 在战斗实例上安装超限模拟性能保护
 * @param {import('./Battle.js').Battle} battle
 * @param {object} opts
 */
export function installInfiniteRule(battle, opts = {}) {
  if (!battle) return;
  const round = Number(battle.round) || 1;

  battle.infinite = {
    round,
    ccResist: getInfiniteCcResist(round),
    // 索敌缓存：存活怪 > 25 时生效
    targetingCache: new Map(),
    lastTargetingClearTick: 0,
  };

  // 监听 tick 事件做定期清理
  battle.on('tick', () => {
    // 每 3 帧（0.1s）清空一次索敌缓存
    if (battle.tickCount - battle.infinite.lastTargetingClearTick >= 3) {
      battle.infinite.targetingCache.clear();
      battle.infinite.lastTargetingClearTick = battle.tickCount;
    }
  });
}

/**
 * 拦截无限模式下的控制状态施加（抗性判定与霸体防木桩保护）
 * @param {import('./Battle.js').Battle} battle
 * @param {import('./units.js').Unit} target
 * @param {string} key
 * @param {object} opts
 * @returns {boolean} true 表示拦截拒绝施加
 */
export function shouldBlockInfiniteCc(battle, target, key, opts = {}) {
  if (!battle?.infinite || target?.side !== 'enemy') return false;
  if (!CC_STATUS_KEYS.has(key)) return false;

  // 1. 若目标已有【霸体（cc_immune）】，直接免疫一切控制状态
  if (target.findBuff && target.findBuff(TENACITY_BURST_STATUS)) {
    return true;
  }

  // 2. 波次控制抗性拦截 (Tenacity Scaling)
  const ccResist = battle.infinite.ccResist;
  if (ccResist > 0 && !opts.force) {
    if (battle.rng() < ccResist) {
      return true; // 概率抵抗
    }
  }

  // 3. 精英 / Boss 防木桩霸体保护（Tenacity Burst）
  const isEliteOrBoss = target.isBoss || target.def?.rank === 'ELITE';
  if (isEliteOrBoss) {
    const now = battle.time;
    target._ccHistory ||= [];
    // 清理 10 秒窗口外的历史记录
    target._ccHistory = target._ccHistory.filter((entry) => now - entry.at <= TENACITY_WINDOW_SEC);

    // 记录本次 CC 预计占用的时长
    const dur = Math.min(Number(opts.duration) || 1, 5);
    target._ccHistory.push({ at: now, dur });

    // 计算窗口内累计受控时长
    const totalCcTime = target._ccHistory.reduce((acc, cur) => acc + cur.dur, 0);
    if (totalCcTime >= TENACITY_THRESHOLD_SEC) {
      // 触发霸体：清除当前所有 CC 状态，并获得 4 秒霸体
      for (const ccKey of CC_STATUS_KEYS) {
        battle.removeBuff(target, ccKey);
      }
      battle.addBuff(target, {
        key: TENACITY_BURST_STATUS,
        duration: TENACITY_BURST_DURATION,
        visible: true,
        flags: { cc_immune: true },
      });
      target._ccHistory.length = 0; // 重置窗口
      battle._ev?.(['status', target.id, 'cc_immune', 1]);
      return true; // 拦截本次控制
    }
  }

  return false;
}

/**
 * 攻击间隔安全截断与溢出伤害折算
 * @param {number} interval 原始计算的攻击间隔（秒）
 * @param {number} bat
 * @param {number} aspd
 * @returns {{ interval: number, damageMul: number }}
 */
export function clampAttackInterval(interval, bat = 1, aspd = 100) {
  if (interval <= 0 || !Number.isFinite(interval)) {
    return { interval: MIN_ATTACK_INTERVAL_SEC, damageMul: 1 };
  }
  if (interval < MIN_ATTACK_INTERVAL_SEC) {
    // 攻速溢出：例如 interval 为 0.033s（30次/秒），锁定为 0.066s（15次/秒），伤害加倍
    const damageMul = MIN_ATTACK_INTERVAL_SEC / interval;
    return { interval: MIN_ATTACK_INTERVAL_SEC, damageMul };
  }
  return { interval, damageMul: 1 };
}
