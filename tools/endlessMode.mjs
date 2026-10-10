// tools/endlessMode.mjs — 无尽模式 (ENDLESS) 的配置构造器。
//
// 无尽模式是社区改造模式（非官方）：回合数没有上限，波次循环复用，敌方强度按官方公式持续外推，
// 第 ENDLESS_BOSS_EVERY(14) 回合来第一次「最终攻势」式共享血池 Boss 战，其后每 ENDLESS_BOSS_STEP(7)
// 回合一次（21、28、35…），每次 Boss 之后怪物血量/攻击再 +1/3 基础难度属性（打完继续，不结束）。
//
// 无尽模式有四档难度，各自由对应的常规模式派生（保留其战场、商店、盟约池、敌方强度表、禁用敌人等整套配置），
// 只在回合/难度/结束规则上改写 —— 即「以哪一档常规难度为底」。生成的模式条目 id 为
// `mode_{single,multi}_endless_{funny,normal,hard,abyss}`，难度名 `ENDLESS_<BASE>`（见 shared/constants.js）。
// 回合循环、数值外推、Boss 周期等运行时行为由 server/match/gamedata.js 依据 shared/constants.js 的
// ENDLESS_* 常量实现；本文件只负责生成 data/config.json 里的模式条目。
//
// 被 tools/build-data.mjs（正式构建）与 tools/patch-endless.mjs（就地补丁已有 data/config.json）共用。

import {
  ENDLESS_BOND_LAYER_CAP, ENDLESS_BOSS_CYCLE_SCALE, ENDLESS_BOSS_EVERY, ENDLESS_BOSS_STEP, ENDLESS_DEFAULT_BASE, PICK_DIFFICULTIES,
} from '../shared/constants.js';

/**
 * 无尽模式的默认底难度（没有指明底难度时用哪一档）——同时也是旧的无底 `ENDLESS` 难度所指的档。
 * 一档「底难度」同时决定：enemyScale 敌方强度表、inactiveEnemyKeys 禁用敌人、stages 战场池，
 * 以及 Boss 血池的基准档（bosses.json 的 bloodPoint 键）。
 */
export const ENDLESS_BASE_DIFFICULTY = ENDLESS_DEFAULT_BASE;

/** 无尽模式共用的说明文案（config.modes[].effectDescList）。 */
export const ENDLESS_EFFECT_DESC = [
  '·回合数没有上限，坚持越久越好',
  `·第 ${ENDLESS_BOSS_EVERY} 回合迎战第一次敌方领袖，其后每 ${ENDLESS_BOSS_STEP} 回合一次`,
  '·敌方强度随回合持续增长',
  `·盟约层数上限提升至 ${ENDLESS_BOND_LAYER_CAP}（每 N 层发奖仍按 999 层结算）`,
  '·不产出常规奖励，仅记录最高回合',
];

/** 无尽模式的盟约禁用数（整局以终极模拟为底时的档位；其余档位跟随各自底难度）。 */
export const ENDLESS_BANS = { core: 3, addon: 4 };

/** 归一化一档底难度（未知值退回默认档）。 */
const normalizeBase = (base) => (PICK_DIFFICULTIES.includes(base) ? base : ENDLESS_DEFAULT_BASE);

/** 正数秒数，否则 null。 */
const seconds = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * 由对应的常规模式（同底难度）派生一个无尽模式条目。
 * @param {object} base 对应的 mode_{single,multi}_<底难度>，如 mode_multi_abyss
 * @param {{ type: 'SINGLE'|'MULTI', baseDifficulty?: string, timeSource?: object }} opts
 *   timeSource: 休整期时限的取值来源（缺省 = base）。官方单机数据把每个回合的 prepTime 都写成 null
 *   （「下半独立模拟」没有时限），单机无尽因此会真的无限等待；这里改用同底难度的联机模式（合作盟约）
 *   的回合表补齐 —— 无尽模式一律按合作盟约计时（服务器主人的要求）。
 * @returns {object|null}
 */
export function buildEndlessMode(base, { type, baseDifficulty, timeSource } = {}) {
  if (!base || typeof base !== 'object') return null;
  const t = (type || base.type || 'MULTI') === 'SINGLE' ? 'single' : 'multi';
  const diff = normalizeBase(baseDifficulty);
  const id = `mode_${t}_endless_${diff.toLowerCase()}`;

  const src = base.rounds && typeof base.rounds === 'object' ? base.rounds : {};
  const srcLimit = base.combatTimeLimit && typeof base.combatTimeLimit === 'object' ? base.combatTimeLimit : {};
  const tsRounds = timeSource && timeSource.rounds && typeof timeSource.rounds === 'object' ? timeSource.rounds : null;
  // 官方回合表 = 前 ENDLESS_BOSS_EVERY(14) 回合，第 14 回合是领袖战；更长的回合由 gamedata 循环取用
  // —— 第 14 回合之后每个 ENDLESS_BOSS_STEP(7) 回合的周期复用表的 R8–R13（终局段高阶波次）+ R14（Boss），
  // 即第 14、21、28… 回合都取到 Boss 配置（gamedata.endlessWaveKey）。底难度的回合表必须撑满前 14 回合，
  // 但官方数据里 solo 标准只有 9 回合（其余都是 14 + 隐秘核心）：不足的回合（10..13）按底难度自己的普通回合
  // 从头循环补齐，第 14 回合固定用底难度的领袖回合。
  const normalKeys = [];
  let bossKey = null;
  for (const [k, v] of Object.entries(src)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > ENDLESS_BOSS_EVERY || !v || typeof v !== 'object' || v.isHidden) continue;
    if (v.isBoss) bossKey ??= k;
    else normalKeys.push([n, k]);
  }
  normalKeys.sort((a, b) => a[0] - b[0]);
  const rounds = {};
  const combatTimeLimit = {};
  const put = (r, key) => {
    const rec = src[key];
    if (!rec || typeof rec !== 'object') return;
    // 休整期时限：本档回合表没有 prepTime（官方单机数据一律 null＝不限时）时，取时限来源
    // （同底难度的联机「合作盟约」模式）同一回合的值；两边的写法都试一次，避免回合键不同名。
    let out = rec;
    if (!seconds(rec.prepTime) && tsRounds) {
      const alt = tsRounds[key] || tsRounds[String(r)];
      const altSecs = alt && typeof alt === 'object' ? seconds(alt.prepTime) : null;
      if (altSecs) out = { ...rec, prepTime: altSecs };
    }
    rounds[String(r)] = out;
    const lim = Number.isFinite(srcLimit[key]) ? srcLimit[key] : rec.combatTimeLimit;
    if (Number.isFinite(lim)) combatTimeLimit[String(r)] = lim;
  };
  let fill = 0;
  for (let r = 1; r <= ENDLESS_BOSS_EVERY; r++) {
    if (r === ENDLESS_BOSS_EVERY) { put(r, bossKey || String(r)); continue; }
    const rec = src[String(r)];
    if (rec && !rec.isBoss && !rec.isHidden) { put(r, String(r)); continue; }
    if (normalKeys.length) put(r, normalKeys[fill++ % normalKeys.length][1]);
  }

  return {
    ...base,
    modeId: id,
    name: '无尽模式',
    code: 'AC-ENDLESS',
    sortId: 90,
    difficulty: `ENDLESS_${diff}`,
    inScope: false,
    color: '#7c5cff',
    iconId: base.iconId || null,
    desc: '没有终点的模拟训练：回合无限、敌方强度持续增长，坚持到最后一刻。',
    effectDescList: ENDLESS_EFFECT_DESC,
    unlockText: null,
    // 0 = 无限回合（gamedata.lastRound 的哨兵值）；第一次 Boss 是第 14 回合，其后每 bossStep(7) 回合一次。
    lastRound: 0,
    bossRound: ENDLESS_BOSS_EVERY,
    bossStep: ENDLESS_BOSS_STEP,
    hiddenRound: null,
    rounds,
    // 机变回合在无尽里由 gamedata 按 ENDLESS_SP_EVERY 周期计算，静态列表留空。
    spRounds: [],
    combatTimeLimit,
    hiddenBossWeights: {},
    // 无尽专用：Boss 血池每个周期的成长倍率 + 取 bosses.json 里哪一档 bloodPoint 作基准（= 本条的底难度）。
    bossCycleScale: ENDLESS_BOSS_CYCLE_SCALE,
    bloodPointDifficulty: diff,
  };
}

/**
 * 由现有的 modes 表派生全部无尽模式（四档底难度 × 单人/联机）。
 * @param {Record<string, object>} modes
 * @returns {Record<string, object>}
 */
export function buildEndlessModes(modes) {
  const src = modes && typeof modes === 'object' ? modes : {};
  const out = {};
  for (const [type, t] of [['SINGLE', 'single'], ['MULTI', 'multi']]) {
    for (const baseDiff of PICK_DIFFICULTIES) {
      const base = src[`mode_${t}_${baseDiff.toLowerCase()}`];
      // 时限来源固定取联机（合作盟约）同底难度的回合表：单机数据的 prepTime 全是 null（官方「下半独立模拟」
      // 不限时），无尽模式要按合作盟约计时，所以无论本条是单机还是联机都用联机那份。
      const timeSource = src[`mode_multi_${baseDiff.toLowerCase()}`] || base;
      const m = buildEndlessMode(base, { type, baseDifficulty: baseDiff, timeSource });
      if (m) out[m.modeId] = m;
    }
  }
  return out;
}
