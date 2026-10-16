// server/match/infiniteWaves.js — 超限模拟 R16+ 无限波次与双 Boss 生成器
// 纯 ESM，独立模块，不污染常规波次逻辑。

import { weightedPick } from './waves.js';
import { enemyInfiniteScale, getInfiniteBossHp } from '../../shared/infiniteMode.js';
import { createRng, deriveSeed } from '../sim/rng.js';

/**
 * 判断当前轮次是否为 Boss 关
 * R16 起每 5 回合一次 Boss 战（R20, R25, R30 ...）
 * @param {number} round
 * @returns {boolean}
 */
export function isInfiniteBossRound(round) {
  const r = Number(round) || 1;
  return r >= 16 && r % 5 === 0;
}

/**
 * 判断当前轮次是否为双 Boss 关
 * R45 起 Boss 轮出现双 Boss 协同
 * @param {number} round
 * @returns {boolean}
 */
export function isInfiniteDoubleBossRound(round) {
  const r = Number(round) || 1;
  return isInfiniteBossRound(r) && r >= 45;
}

/**
 * 为超限模拟生成 R16+ 的普通怪潮
 * @param {object} gd GameData
 * @param {function} rng
 * @param {number} round
 * @returns {object} wave descriptor
 */
export function buildInfiniteNormalWave(gd, rng, round) {
  const r = Number(round) || 16;
  const baseScale = gd.enemyScale(15) || { hpMul: 2.5, atkMul: 1.8, speedMul: 1.15 };
  const scale = enemyInfiniteScale(r, baseScale);

  // 从官方怪池中收集候选敌人
  const normalKeys = [];
  const eliteKeys = [];
  const flyKeys = [];

  const enemies = gd.data?.enemies || {};
  for (const [key, e] of Object.entries(enemies)) {
    if (e.rank === 'BOSS') continue;
    if (e.motion === 'FLY') flyKeys.push(key);
    else if (e.rank === 'ELITE') eliteKeys.push(key);
    else normalKeys.push(key);
  }

  // 兜底保护
  if (!normalKeys.length) normalKeys.push('enemy_1001_sgrunt');
  if (!eliteKeys.length) eliteKeys.push('enemy_1008_shield');
  if (!flyKeys.length) flyKeys.push('enemy_1027_flyfish');

  const pickKey = (arr) => arr[Math.floor(rng() * arr.length)];

  // 随波次递增怪物数量（35 ~ 60 只）
  const baseCount = Math.min(60, 32 + Math.floor((r - 15) * 1.5));
  const spawns = [];

  let curTime = 2.0;
  for (let i = 0; i < baseCount; i++) {
    const isFly = rng() < 0.25;
    const isElite = rng() < 0.2;
    const enemyKey = isFly ? pickKey(flyKeys) : (isElite ? pickKey(eliteKeys) : pickKey(normalKeys));

    spawns.push({
      time: curTime,
      enemyKey,
      routeIndex: i % 3,
      count: 1,
      interval: 0,
      mods: {
        hpMul: scale.hpMul,
        atkMul: scale.atkMul,
        speedMul: scale.speedMul,
      },
      preview: {
        fly: isFly,
        elite: isElite,
        boss: false,
      },
    });

    curTime += Math.max(0.6, 2.2 - (r - 15) * 0.05);
  }

  return {
    round: r,
    spawns,
    routes: [
      { checkpoints: [[16, 2], [16, 18], [2, 18], [2, 2]] },
      { checkpoints: [[18, 5], [10, 5], [10, 15], [2, 15]] },
      { checkpoints: [[18, 15], [12, 15], [12, 5], [2, 5]] },
    ],
    scale,
  };
}

/**
 * 为超限模拟生成 R16+ 的 Boss 关
 * @param {object} gd GameData
 * @param {function} rng
 * @param {number} round
 * @returns {object}
 */
export function buildInfiniteBossWave(gd, rng, round) {
  const r = Number(round) || 20;
  const bw = gd.bossWeights(false) || [];
  const primaryBoss = bw.length ? weightedPick(rng, bw) : 'boss_01_crowns';
  const isDouble = isInfiniteDoubleBossRound(r);

  const secondaryBoss = isDouble
    ? (bw.length > 1 ? weightedPick(rng, bw.filter(([k]) => k !== primaryBoss)) : primaryBoss)
    : null;

  const baseScale = gd.enemyScale(15) || { hpMul: 2.5, atkMul: 1.8, speedMul: 1.15 };
  const scale = enemyInfiniteScale(r, baseScale);

  const spawns = [
    {
      time: 3.0,
      enemyKey: primaryBoss,
      routeIndex: 0,
      count: 1,
      interval: 0,
      mods: {
        atkMul: scale.atkMul,
        speedMul: scale.speedMul,
      },
      preview: { fly: false, elite: false, boss: true },
    },
  ];

  if (isDouble && secondaryBoss) {
    spawns.push({
      time: 6.0,
      enemyKey: secondaryBoss,
      routeIndex: 1,
      count: 1,
      interval: 0,
      mods: {
        atkMul: scale.atkMul,
        speedMul: scale.speedMul,
      },
      preview: { fly: false, elite: false, boss: true },
    });
  }

  return {
    round: r,
    primaryBoss,
    secondaryBoss,
    isDouble,
    spawns,
    routes: [
      { checkpoints: [[16, 9], [9, 9], [2, 9]] },
      { checkpoints: [[16, 11], [9, 11], [2, 11]] },
    ],
    scale,
  };
}
