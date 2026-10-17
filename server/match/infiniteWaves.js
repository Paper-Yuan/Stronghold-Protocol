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
    // 飞行判定与 waves.js 的 isFlyKey 一致：真实数据把 motion 放在 stats 里（e.motion 是旧字段，永远是 undefined）
    const st = e.stats || {};
    if (e.isFlyEnemy === true || st.motion === 'FLY' || e.motion === 'FLY') flyKeys.push(key);
    else if (e.rank === 'ELITE') eliteKeys.push(key);
    else normalKeys.push(key);
  }

  // 兜底保护：这三条只在怪池被过滤空时才走到（数据没加载 / 全是 BOSS）。以前写的是
  // enemy_1001_sgrunt / enemy_1008_shield / enemy_1027_flyfish —— 这三个 key 在 data/enemies.json 里
  // 一个都不存在，真走到兜底会刷出「不存在的敌人」（2026-10-17 审计发现）。
  if (!normalKeys.length) normalKeys.push('enemy_1000_gopro_2');
  if (!eliteKeys.length) eliteKeys.push('enemy_1006_shield');
  if (!flyKeys.length) flyKeys.push('enemy_1005_yokai');

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
  // 原版是**两个** Boss 池：普通 Boss 轮（bossWeights，HARD 78 万~210 万）与隐秘核心
  // （hiddenBossWeights，280 万~380 万）。超限以前抽的是普通池，于是 R20 抽到 78 万的猩红血钻、
  // R25 又抽到 210 万的昆图斯 —— 需求曲线在 3 倍之间乱跳。业主 2026-10-17：「无限 Boss 只保留更难的池」，
  // 所以这里改用隐秘核心池；万一某个模式的隐秘池是空的，才退回普通池（不会变成没有 Boss）。
  const hiddenPool = (gd.bossWeights(true) || []).slice();
  const pool = hiddenPool.length ? hiddenPool : (gd.bossWeights(false) || []);
  // 池内按血点从弱到强排序，再按「本场第几次 Boss 战」取档 —— 曲线单调往上，不再靠抽签。
  const bloodOf = (id) => {
    const rec = gd.boss(id) || {};
    const bp = rec.bloodPoint || {};
    return Number(bp[gd.difficulty] ?? bp.HARD ?? 0) || 0;
  };
  // 业主 2026-10-17：「无限 Boss 是先简单后难」。池内按血点升序（弱→强），
  // 第 n 次 Boss 战取第 n 档；**不循环**——档位用完之后一直停在最强的那一个，
  // 后面靠 getInfiniteBossHp 的逐回合成长继续加硬。以前用 `bossIndex % pool.length` 会回环，
  // R35 又从最弱的 280 万开始，曲线呈锯齿（实测 R20→R35：2.8M → 3.6M → 3.8M → 2.8M）。
  pool.sort((a, b) => bloodOf(a[0]) - bloodOf(b[0]));
  const tierOf = (i) => pool[Math.min(pool.length - 1, Math.max(0, i))][0];
  const bossIndex = Math.max(0, Math.floor((r - 20) / 5));   // R20→0, R25→1, R30→2 …
  const primaryBoss = pool.length ? tierOf(bossIndex) : 'boss_8';
  const isDouble = isInfiniteDoubleBossRound(r);

  // 双 Boss 轮（R45+）：主 Boss 用当前档，副 Boss 用**次强**那一档（不足两个就同款），
  // 也不回环到弱 Boss —— 双 Boss 只会让这一轮更硬，不会忽然变软。
  const secondaryBoss = isDouble
    ? (pool.length > 1 ? tierOf(Math.max(0, Math.min(pool.length - 2, bossIndex - 1))) : primaryBoss)
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

/**
 * 把一份波次的敌人种类收敛到 n 种（超限模拟的前 15 回合用）。
 *
 * 业主 2026-10-17 的规则：「前面初始的 3 种怪池限制，进入无限波次时不限制怪池」。
 * 普通波次按阵营模板生成，一回合里能刷出十几种怪，前期读不出「这一波是什么套路」；
 * 这里保留波次里最先出现的 n 个种类，其余一律换成这 n 种之一（时间、数量、缩放、路线都不动），
 * 于是 R1–R15 的怪池就只有 3 种，R16 之后交给 buildInfiniteNormalWave，完全不收敛。
 * @param {object} wave buildNormalWave 的返回值
 * @param {number} n 允许的种类数
 * @param {function} rng 0..1 的随机源（与波次同一个，保持可复现）
 * @returns {object} 新的 wave（原对象不动）
 */
export function capWaveKinds(wave, n, rng) {
  const spawns = Array.isArray(wave && wave.spawns) ? wave.spawns : [];
  const keep = [];
  for (const s of spawns) {
    const key = s && s.enemyKey;
    if (!key || keep.includes(key)) continue;
    keep.push(key);
    if (keep.length >= Math.max(1, n)) break;
  }
  if (!keep.length) return wave;
  const out = spawns.map((s) => {
    if (!s || keep.includes(s.enemyKey)) return s;
    const key = keep[Math.min(keep.length - 1, Math.floor(rng() * keep.length))];
    return { ...s, enemyKey: key };
  });
  return { ...wave, spawns: out, kindCap: keep.length };
}
