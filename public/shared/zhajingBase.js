// shared/zhajingBase.js — 炸惊模拟的「基础数值膨胀」折算成干员白值 (config.modes[*].allyScale).
//
// 口径（0.3.x）: allyScale 不是战场上的最终乘区 —— sim 把它折进干员自己的白值:
//
//     白值 = 原白值 × { atk, def, hp }        (只动 atk / def / maxHp)
//
// 于是百分比加成从这个新白值起算, 而且干员调配（炸惊页签）的「局内数值」、局内详情卡和真正的战斗读的是同一份
// 数字 —— 屏幕上写的就是打出来的。战斗侧由 server/sim/battle/players.js 落到 unit.base 上; 客户端由
// ui/gameLogic/loadout.js 的 chessLoadout(opts.allyScale) 落到展示用的 record.stats 上。
//
// 只在炸惊里生效: 模式配置里只有 mode_single_zhajing / mode_multi_zhajing 带 allyScale, 客户端也只在
// 自己的炸惊页签与 difficulty === 'ZHAJING' 的房间里把它传下去。纯函数、无 Node API。

/** 兜底值（data/config.json 的炸惊模式现在就是这一组; 配置缺失时用它）。 */
export const ZHAJING_ALLY_SCALE = Object.freeze({ atk: 2.5, def: 3, hp: 3 });

/**
 * 归一化 allyScale: 只认 ≥0 的有限数, 缺省按 1 算; 三项都是 1（或没有）→ null = 不膨胀。
 * @param {any} scale `{ atk?, def?, hp? }`
 * @returns {{ atk: number, def: number, hp: number } | null}
 */
export function allyScaleOf(scale) {
  if (!scale || typeof scale !== 'object') return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 1);
  const out = { atk: n(scale.atk), def: n(scale.def), hp: n(scale.hp) };
  return out.atk === 1 && out.def === 1 && out.hp === 1 ? null : out;
}

/** 炸惊模式配置里的 allyScale（单/多人同一组）; 配置里没有就退回 ZHAJING_ALLY_SCALE。 */
export function allyScaleFromConfig(cfg) {
  const modes = cfg && typeof cfg === 'object' ? cfg.modes : null;
  const rec = modes && (modes.mode_single_zhajing || modes.mode_multi_zhajing);
  return allyScaleOf(rec && rec.allyScale ? rec.allyScale : ZHAJING_ALLY_SCALE);
}

/**
 * 白值膨胀后的 stats: atk / def / maxHp 各乘一档, 其它字段原样返回（没有倍率时原对象原样返回）。
 * @param {any} stats @param {any} scale
 */
export function zhajingBaseStats(stats, scale) {
  const s = allyScaleOf(scale);
  if (!s || !stats || typeof stats !== 'object') return stats;
  const out = { ...stats };
  if (typeof out.atk === 'number') out.atk *= s.atk;
  if (typeof out.def === 'number') out.def *= s.def;
  if (typeof out.maxHp === 'number') out.maxHp *= s.hp;
  return out;
}

/** 这个 difficulty / modeId 是不是炸惊 (`ZHAJING` / `mode_single_zhajing` …)。 */
export const isZhajing = (v) => /zhajing/i.test(String(v ?? ''));

/**
 * 炸惊模拟的**名册**（「卡池调整」/ loadout 校验用的 id 白名单）：`chess` 映射里带 `zhajing: true` 的**基础**记录
 * （可抽取 + 2 条 grantOnly = 99 条；精锐 `_b` 是独立的 golden 记录、不作条目，模组通过 base 的 `goldenId` 查）。
 * 这些记录都带 `visible: false`（对其它模式不可见），所以官方那份 `checkLoadout` 会一律拒绝 —— 玩法包必须用它自己
 * 的名册校验。过滤条件与该模式 `GameData.visibleChess` 逐字一致，两条口径不会漂。
 * @param {Record<string, any>} chess data/chess.json（或一个内容集的等价值）
 * @returns {Set<string>}
 */
export function zjRosterIds(chess) {
  const out = new Set();
  for (const [id, c] of Object.entries(chess && typeof chess === 'object' ? chess : {})) {
    if (!c || typeof c !== 'object' || c.zhajing !== true) continue;
    if (c.isGolden || c.isDiy || c.isHidden || !Number.isInteger(c.tier)) continue;
    out.add(id);
  }
  return out;
}
