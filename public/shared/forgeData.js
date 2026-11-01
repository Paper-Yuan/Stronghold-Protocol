// shared/forgeData.js — 炸惊模拟「锻造器」的数值表与纯函数。
//
// 服务端（server/match/player/acquire.js 的 forgeTake / 计算、server/match/Match.js 的发放计数）与客户端
// （public/js/ui/forge.js 的卡片显示、已锻造面板）**共用这一份**，避免两边数值漂移。纯 ESM、无 Node API。
//
// 数值（业主 2026-10-14 给，2026-10-15 下调过一次）：
//   攻击力   普通 +100 · 史诗 +325 · 传说 +799
//   防御力   普通 +100 · 史诗 +170 · 传说 +300
//   生命     普通 +500 · 史诗 +1200 · 传说 +2500
//   暴击率   普通 +1% · 史诗 +3% · 传说 +6%
//   吸血     普通 +2% · 史诗 +4% · 传说 +6%
//   资金     普通 +1 · 史诗 +2 · 传说 +5
//   攻击距离 传说 +1 格
//   阻挡数   史诗 +1 · 传说 +2
//   技力需求 传说 −10%（按**倍率**进战斗，见 forgeBattleMods 的注释）
// 稀有度「保持最初版的普通/史诗/传说概率」= 把 rare(25) 折进普通（45+25=70）⇒ 普通 70 / 史诗 20 / 传说 10。
//
// 确定性：`drawForge` / `rollRarity` 接受一个 rng（返回 [0,1) 的函数）。**对局里必须传 Match 的种子流
// （m.rngMeta）**，只有客户端的纯展示才允许缺省。

/** 累计击败多少个敌人给一个锻造器（业主 2026-10-15：每 40 个给 1 个）。 */
export const FORGE_KILLS_PER = 40;

/** 三档稀有度 + 权重（百分比）。 */
export const FORGE_RARITY = Object.freeze([
  Object.freeze({ id: 'normal', weight: 70, name: '普通' }),
  Object.freeze({ id: 'epic', weight: 20, name: '史诗' }),
  Object.freeze({ id: 'legend', weight: 10, name: '传说' }),
]);
const RARITY_ORDER = Object.freeze(FORGE_RARITY.map((r) => r.id));
/** rank 越大越稀有（「至少史诗」这类门槛用）。 */
const rankOf = (id) => RARITY_ORDER.indexOf(id);
/** 稀有度 id 是否合法。 */
export const isForgeRarity = (id) => RARITY_ORDER.includes(id);

/**
 * 九种锻造选项。`min` 是它出现的最低稀有度；`unit` 是显示后缀；`value[rarity]` 是每档的实际加成。
 * 形状显式标注是给 `npm run typecheck` 用的：`unit` / `hint` 只有一部分选项有（`crit` / `vamp` / `range` / `sp`
 * 带 `unit`，`range` / `sp` 没有 `hint`），不标的话 tsc 把这张表收成九个对象字面量的联合，
 * `forgedEntries` 里读 `o.unit` 就报「不存在于这个成员上」。
 * @type {ReadonlyArray<Readonly<{
 *   id: string, min: string, name: string,
 *   unit?: string,
 *   value: Readonly<Record<string, { v: number, kind?: string, floor?: number }>>,
 *   hint?: string,
 * }>>}
 */
export const FORGE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'atk', min: 'normal', name: '攻击力', value: { normal: { v: 100 }, epic: { v: 325 }, legend: { v: 799 } }, hint: '全体上阵干员攻击力提升' }),
  Object.freeze({ id: 'def', min: 'normal', name: '防御力', value: { normal: { v: 100 }, epic: { v: 170 }, legend: { v: 300 } }, hint: '全体上阵干员防御力提升' }),
  Object.freeze({ id: 'hp', min: 'normal', name: '生命', value: { normal: { v: 500 }, epic: { v: 1200 }, legend: { v: 2500 } }, hint: '全体上阵干员生命上限提升' }),
  Object.freeze({ id: 'crit', min: 'normal', name: '暴击率', unit: '%', value: { normal: { v: 1 }, epic: { v: 3 }, legend: { v: 6 } }, hint: '全体上阵干员暴击率提升' }),
  Object.freeze({ id: 'vamp', min: 'normal', name: '吸血', unit: '%', value: { normal: { v: 2 }, epic: { v: 4 }, legend: { v: 6 } }, hint: '造成伤害时按比例回复生命' }),
  Object.freeze({ id: 'gold', min: 'normal', name: '资金', value: { normal: { v: 1 }, epic: { v: 2 }, legend: { v: 5 } }, hint: '立刻获得资金' }),
  // 攻击距离只有传说 +1（业主 2026-10-15：原「史诗 +1 / 传说 +2」）
  Object.freeze({ id: 'range', min: 'legend', name: '攻击距离', unit: '格', value: { legend: { v: 1 } } }),
  Object.freeze({ id: 'block', min: 'epic', name: '阻挡数', value: { epic: { v: 1 }, legend: { v: 2 } }, hint: '全体上阵干员阻挡数增加' }),
  Object.freeze({ id: 'sp', min: 'legend', name: '技力需求', unit: '%', value: { legend: { v: -10 } }, hint: '全体上阵干员技能所需技力降低' }),
]);

/** 按 id 取选项（找不到 null）。 */
export const forgeOptionById = (id) => FORGE_OPTIONS.find((o) => o.id === id) || null;

/** 某稀有度能抽到的选项。 */
export const optionsFor = (rarity) => FORGE_OPTIONS.filter((o) => rankOf(rarity) >= rankOf(o.min));

/** 按权重掷一个稀有度（rng 返回 [0,1)；对局里传种子流）。 */
export function rollRarity(rng = Math.random) {
  const total = FORGE_RARITY.reduce((s, r) => s + r.weight, 0);
  let x = rng() * total;
  for (const r of FORGE_RARITY) {
    x -= r.weight;
    if (x < 0) return r.id;
  }
  return FORGE_RARITY[0].id;
}

/**
 * 抽一组：同一稀有度的三张**不重复**选项（池子不足三个时有多少给多少）。
 * @param {() => number} [rng]
 * @returns {{ rarity: string, picks: string[] }} picks 是选项 id（跨进程传得动）
 */
export function drawForge(rng = Math.random) {
  const rarity = rollRarity(rng);
  const pool = optionsFor(rarity).map((o) => o.id);
  const picks = [];
  while (picks.length < 3 && pool.length) {
    const i = Math.floor(rng() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return { rarity, picks };
}

/** 一个选项在某稀有度下实际贡献的数值（`kind: 'forgedPct'` 的按已锻造量折算）。 */
export function amountOf(opt, rarity, forged = {}) {
  const e = opt && opt.value ? opt.value[rarity] : null;
  if (!e) return 0;
  const f = forged || {};
  if (e.kind === 'forgedPct') {
    const base = Number(f[opt.id] && f[opt.id].total) || 0;
    return base > 0 ? Math.round(base * (e.v / 100)) : e.floor;
  }
  return e.v;
}

/**
 * 把一次锻造结算进已锻造表（纯函数，不改入参）。
 * @returns {{ forged: object, delta: number }}
 */
export function applyForgePick(forged = {}, optId, rarity) {
  const f = forged || {};
  const opt = forgeOptionById(optId);
  if (!opt || !opt.value[rarity]) return { forged: f, delta: 0 };
  const delta = amountOf(opt, rarity, f);
  const before = f[optId] || { total: 0, count: 0 };
  return { forged: { ...f, [optId]: { total: before.total + delta, count: before.count + 1 } }, delta };
}

/** 已锻造的条目（有叠过的才出现），按 FORGE_OPTIONS 的顺序。`forged` 允许是 null / 数组。 */
export const forgedEntries = (forged) => {
  if (Array.isArray(forged)) return forged;
  const f = forged || {};
  return FORGE_OPTIONS.filter((o) => f[o.id] && f[o.id].count > 0)
    .map((o) => ({ id: o.id, name: o.name, unit: o.unit || '', total: f[o.id].total, count: f[o.id].count }));
};

/** 累计的数值文本，例如 `+1124` / `+9%` / `+2格` / `-10%`。 */
export function forgedText(e) {
  const sign = e.total > 0 ? '+' : '';
  return `${sign}${e.total}${e.unit}`;
}

/** 已锻造的项数（徽标用）。 */
export const forgedCount = (forged) => forgedEntries(forged).length;

/** 一个选项在某稀有度下的数值文本，例如 `+325` / `+15%` / `+2格`。 */
export function valueText(opt, rarity) {
  const e = opt.value[rarity];
  if (!e) return '—';
  if (e.kind === 'forgedPct') return `+${e.v}%`;
  const sign = e.v > 0 ? '+' : '';
  return `${sign}${e.v}${opt.unit || ''}`;
}

/** 数值下面那行小字（只有 `forgedPct` 档有：已锻造为 0 时的保底）。 */
export function valueNote(opt, rarity) {
  const e = opt.value[rarity];
  return e && e.kind === 'forgedPct' ? `已锻造攻击为 0 时改为 +${e.floor}` : null;
}

/**
 * 已锻造表 → **战斗输入用的扁平数值**（服务端算一次，战斗侧直接铺到干员身上，`flags.forge`）。
 * 七个选项走引擎的加算键，`crit` / `vamp` 引擎没有，由 content/forge.js 用钩子实现。
 * 「技力需求」按**倍率**给（−10 ⇒ `spMul` 0.9）：0.3.3 的 skills.js 是
 * `spCost = floor(baseSpCost * spCostMul + spCostFlat)`，用固定减法会把 ≤10 技力的干员砍成 0（免费技能 + 技力条消失），
 * 所以 `sp` 只留给旧读法，战斗侧请读 `spMul`。
 */
export function forgeBattleMods(forged) {
  const f = forged || {};
  const g = (id) => Number(f[id] && f[id].total) || 0;
  const spPct = g('sp');
  return {
    atk: g('atk'),
    def: g('def'),
    hp: g('hp'),
    crit: g('crit'),
    vamp: g('vamp'),
    range: g('range'),
    block: g('block'),
    sp: spPct,
    spMul: spPct ? Math.min(1, Math.max(0.1, 1 + spPct / 100)) : 1,
  };
}

/** 战斗用的扁平数值是否全为 0（不需要挂任何东西）。 */
export const forgeModsEmpty = (m) => !m || !(m.atk || m.def || m.hp || m.crit || m.vamp || m.range || m.block ||
  (m.spMul && m.spMul !== 1) || m.sp);
