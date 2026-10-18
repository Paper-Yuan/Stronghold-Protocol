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
export function buildInfiniteNormalWave(gd, rng, round, routes = null) {
  const r = Number(round) || 16;
  const baseScale = gd.enemyScale(15) || { hpMul: 1, atkMul: 1, speedMul: 1 };
  const scale = enemyInfiniteScale(r, baseScale);

  // 从官方怪池中收集候选敌人
  const normalKeys = [];
  const eliteKeys = [];
  const flyKeys = [];

  const enemies = gd.raw?.enemies || {};
  // 悬赏怪的 key 集合：它们属于「带赏金出场」的那一套（choices.cards.bounty），
  // 不该被普通波次免费刷出来（业主 2026-10-19：「排除」）。
  const bountyKeys = new Set();
  for (const c of (gd.choices && Array.isArray(gd.choices.cards?.bounty) ? gd.choices.cards.bounty : [])) {
    if (c && typeof c.enemyKey === 'string') bountyKeys.add(c.enemyKey);
  }
  // 召唤子怪全集：Boss / 精英召唤出来的那些（_msf*、_vts*、枯朽之种…）。
  // 它们只在被召唤时出场，不该作为普通怪独立刷出来（业主 2026-10-19：「摒弃次数怪和 boss 附带的几个」）。
  const summonChildren = new Set();
  for (const rec of Object.values(enemies)) {
    if (!Array.isArray(rec && rec.summons)) continue;
    for (const sm of rec.summons) {
      const key = typeof sm === 'string' ? sm : (sm && (sm.enemyKey || sm.key));
      if (typeof key === 'string') summonChildren.add(key);
    }
  }
  // Boss 组件（原版模板里 tag:'part' 的那些：「斩胄之剑」「碎铳之簧」「裂管之音」…）：
  // 它们只属于某一场领袖战，不是独立的野怪（业主 2026-10-19：「等级为 boss 组件的东西不要放在普通波次里」）。
  const bossParts = new Set();
  for (const tpl of Object.values(gd.raw?.waves || {})) {
    for (const sp of (Array.isArray(tpl && tpl.spawns) ? tpl.spawns : [])) {
      const key = sp && (sp.key || sp.enemyKey);
      if (key && sp.tag === 'part') bossParts.add(key);
    }
  }
  for (const [key, e] of Object.entries(enemies)) {
    if (e.rank === 'BOSS') continue;              // BOSS 走 Boss 轮
    if (bossParts.has(key)) continue;             // Boss 组件只随领袖出场
    if (bountyKeys.has(key)) continue;            // 悬赏怪走悬赏 / 词条抉择
    if (e.tokenOnly) continue;                    // 召唤物 / 弹体不是独立敌人
    if (summonChildren.has(key)) continue;        // 召唤子怪只由召唤者带出
    if (/_msf|_vts/.test(key)) continue;          // 次数怪（Boss 的分身 / 计数靶）同理
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
      routeIndex: routes && routes.length ? i % routes.length : 0,
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

  // 战斗时限：以前这里没有 timeLimit，combat.js 兜底成 60 秒 ——
  // 而 R16+ 最后一只怪要到 70 秒以上才出场，60 秒一到 _timeout() 把场上所有存活敌人
  // 全部记成漏怪，玩家看到的就是「怪出来了但直接结算漏怪」（业主 2026-10-19）。
  // 现在按出怪节奏算：最后一只的出场时间 + 走完全程的余量。
  const lastSpawn = spawns.length ? Math.max(...spawns.map((x) => Number(x.time) || 0)) : 0;
  const march = 60;   // 从出生点走到终点 + 战斗收尾的余量
  return {
    round: r,
    timeLimit: Math.ceil(lastSpawn + march),
    spawns,
    // 路径**必须来自这一张地图**（业主 2026-10-18：「怪的波次只选择这个地图能出的」）。
    // 以前这里硬编码了三条坐标（[16,2]、[18,5]…），全都在 NORMAL_RECT(9..12, 0..10) 之外，
    // 而且缺 start/end —— normalizeRoute 得到 { start: null, end: null }，怪根本没有出生点，
    // 于是 R16+ 一只怪都刷不出来、回合空转后直接进结算（同时还把「完美作战」判成失败扣 LP）。
    // 现在只接受调用方传进来的 real routes（由 phase 代码从当前 stage / wave 取）；拿不到就不给路径，
    // 让上层用一个「不会静默失败」的明确错误，而不是刷出一堆没有起点的怪。
    routes: Array.isArray(routes) && routes.length ? routes : [],
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
export function buildInfiniteBossWave(gd, rng, round, routes = null) {
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

  const baseScale = gd.enemyScale(15) || { hpMul: 1, atkMul: 1, speedMul: 1 };
  const scale = enemyInfiniteScale(r, baseScale);

  // bossWeights 给的是 **boss id**（boss_9），不是敌人 key（enemy_9017_achunt_2）。
  // 以前直接把 boss id 当 enemyKey 塞进 spawns —— sim 找不到这个敌人，客户端也查不到模型，
  // 于是 R20 的 Boss「完全没显示美术素材、进战后无模型」（业主 2026-10-19）。
  const enemyKeyOf = (bossId) => {
    const rec = gd.boss(bossId);
    return (rec && typeof rec.enemyKey === 'string' && rec.enemyKey) || bossId;
  };
  const spawns = [
    {
      time: 3.0,
      enemyKey: enemyKeyOf(primaryBoss),
      routeIndex: routes && routes.length ? 0 : 0,
      count: 1,
      interval: 0,
      mods: {
        // Boss 的血量由 bossPoolHp 单独算，但 mods.hpMul 必须给一个有限值，
        // 否则预览 / sim 读到 undefined → NaN（业主 2026-10-19 看到的「R20 血量 NaN」）。
        hpMul: 1,
        atkMul: scale.atkMul,
        speedMul: scale.speedMul,
      },
      preview: { fly: false, elite: false, boss: true },
    },
  ];

  // Boss 的随从（data/enemies.json 的 summons）：原版 Boss 轮的模板里会带上它们，
  // 超限是自己组波次，以前只放了 Boss 本体 —— 于是「假想敌：铳」没有碎铳之簧、
  // 「假想敌：胄」没有刺胄之弹（业主 2026-10-19：「boss 生成时也得可以使用他们的能力来招出对应子怪」）。
  const escorts = [];
  for (const bossKey of [primaryBoss, secondaryBoss]) {
    if (!bossKey) continue;
    const ek = enemyKeyOf(bossKey);
    // ① 数据里的 summons（胄 → 刺胄之弹、管 → 侍从…）
    const rec = gd.enemy(ek);
    for (const sm of (rec && Array.isArray(rec.summons)) ? rec.summons : []) {
      const key = typeof sm === 'string' ? sm : (sm && (sm.enemyKey || sm.key));
      if (typeof key === 'string' && !escorts.includes(key)) escorts.push(key);
    }
    // ② 原版 Boss 模板里的随从（铳的「碎铳之簧」只在这里 —— 它的 summons 是空的）
    for (const tpl of Object.values(gd.raw?.waves || {})) {
      const list = Array.isArray(tpl && tpl.spawns) ? tpl.spawns : [];
      const hasBoss = list.some((sp) => sp && (sp.key || sp.enemyKey) === ek);
      if (!hasBoss) continue;
      for (const sp of list) {
        const key = sp && (sp.key || sp.enemyKey);
        if (typeof key !== 'string' || key === ek) continue;
        // 只收「随从」：和 Boss 同一模板、且不是普通杂兵（模板里 Boss 同批出现的都算它的从属）。
        // **tag 必须一起带过来**：碎铳之簧这类是 tag:'part' 的部件，丢了 tag 会让客户端算出
        // counted=false、服务端算出 counted=true，上报的漏怪被判 'uncounted leak' 并触发重模拟（卡死）。
        if (!escorts.some((e2) => e2.key === key)) {
          escorts.push({ key, tag: sp.tag ?? null, countInTotal: sp.countInTotal });
        }
      }
      break;   // 一个 Boss 只取第一个模板
    }
  }
  escorts.forEach((esc, i) => {
    spawns.push({
      time: 4.5 + i * 1.5,
      enemyKey: esc.key,
      // 原模板的 tag（part = 部件，不计入总数、漏了不扣 LP）与 countInTotal 原样保留
      ...(esc.tag ? { tag: esc.tag } : {}),
      ...(esc.countInTotal === false ? { countInTotal: false } : {}),
      routeIndex: (i + 1) % 3,
      count: 1,
      interval: 0,
      mods: { hpMul: 1, atkMul: scale.atkMul, speedMul: scale.speedMul },
      preview: { fly: false, elite: false, boss: false },
    });
  });

  if (isDouble && secondaryBoss) {
    spawns.push({
      time: 6.0,
      enemyKey: enemyKeyOf(secondaryBoss),
      routeIndex: routes && routes.length > 1 ? 1 : 0,
      count: 1,
      interval: 0,
      mods: {
        // Boss 的血量由 bossPoolHp 单独算，但 mods.hpMul 必须给一个有限值，
        // 否则预览 / sim 读到 undefined → NaN（业主 2026-10-19 看到的「R20 血量 NaN」）。
        hpMul: 1,
        atkMul: scale.atkMul,
        speedMul: scale.speedMul,
      },
      preview: { fly: false, elite: false, boss: true },
    });
  }

  // Boss 场同样要给足时限（Boss + 随从 + 收尾），否则 60 秒兜底会把还活着的 Boss 判成漏怪
  const lastBossSpawn = spawns.length ? Math.max(...spawns.map((x) => Number(x.time) || 0)) : 0;
  return {
    round: r,
    primaryBoss,
    secondaryBoss,
    isDouble,
    timeLimit: Math.ceil(lastBossSpawn + 180),
    spawns,
    // 同上：Boss 的路径也必须来自这一张地图（以前硬编码 [16,9] / [16,11]，同样在图外且缺 start/end，
    // 导致 R20 之后的超限 Boss 轮一只 Boss 都刷不出来 —— 业主 2026-10-18「20 轮后没法玩」）。
    routes: Array.isArray(routes) && routes.length ? routes : [],
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
