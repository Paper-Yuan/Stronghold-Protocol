// server/sim/content/forge.js — 炸惊模拟「锻造器」的战斗侧（语义移植：modref/v2.1/server/sim/content/forge.js，109 行）。
//
// 做两件事：
//   ① **基础暴击 5%**（用户 2026-10-14「暴击率初始给5%」）—— 已由 match 侧折进干员白值（`s.critRate`），本文件只负责
//      「按 `s.critRate` 掷骰、命中翻倍」的钩子，所以白值与任何 buff 都吃得进去。
//   ② **每名玩家的锻造加成** —— 数值来自 `battle.flags.forge`（engine-core T11 从 `PlayerBattleInput.forge` 传下来，
//      match/player/round.js 用 shared/forgeData.js 的 forgeBattleMods 折算）：{ atk, def, hp, crit, vamp, range, block, sp }。
//
// 九个选项的落点（同参考实现）：atk/def/hp/block/crit/vamp 已折进白值；这里只处理**白值里没有的两项**：
//   · `range` → `rangeExtend`（格） · `sp` → `skill.spCostMul`（倍率，`u.mem` 幂等，deploy 重复触发不会连乘）
//   资金在 match 侧立即到账，不在这里。
// 暴击 / 吸血读单位**实时**的 `s.critRate` / `s.lifesteal`：暴击 = 双倍伤害（`hit` 钩子，`dmg.mul *= 2` + `dmg.crit`
// 标记），吸血 = 造成伤害时按比例回自己血（`damaged` 钩子 + `battle.heal`）。
//
// 开关（与 engine-core T11 的约定）：
//   * `battle.flags.forge` **缺键 ⇒ 本文件与现状逐字节相同**（官方四档、湮灭房、以及没开锻造的炸惊房）。
//   * `battle.zj`（炸惊视图）非空时同样进（基础 5% 暴击的既有口径：`zj` 只在 modeId 含 zhajing 时非 null）。
//   * `flags.forge` 的形状 `[ASSUMED]`：T11 未落地前**两种都认** —— `{ [playerId]: mods }` 或 `{ players: { [playerId]: mods } }`；
//     每个玩家另有 `p.forge` / `p.input.forge` 两条兜底（参考实现踩过「只读 p.forge 恒 undefined」的坑）。
//
// 注册：`server/sim/content/index.js` 的 DOMAIN_NAMES 需要 `'forge'`（engine-core 的写域；未注册时本文件不装，
// 行为与现在逐字节相同）。测试可以直接 `import { install }` 或 `extraContent: [forge]`。
import { num, passiveBuff } from './support/index.js';
import { forgeModsEmpty } from '../../../shared/forgeData.js';

/** 这一玩家的锻造面板加成（同一玩家所有干员共用）。 */
const STATS_KEY = 'forge:stats';
/** `u.mem` 里的幂等标记：spCostMul 只乘一次（deploy 会重复触发）。 */
const SPMUL_KEY = 'forge:spMul';
/** 暴击率 / 吸血的 buff 键（engine 的 buffs.js 没有这两个 mod 键，由本文件的钩子自己求和）。 */
const CRIT_KEY = 'forge:crit';
const VAMP_KEY = 'forge:vamp';
/** 暴击倍率（引擎原本没有暴击机制，这里按双倍实现）。 */
const CRIT_MUL = 2;
/** 基础暴击率（用户 2026-10-14）—— 由 match 侧折进白值，本文件只为文档与测试留常量。 */
export const BASE_CRIT = 0.05;

/**
 * 一个单位的暴击率：`s.critRate`（若数据/引擎将来提供白值）**加上**身上所有 buff 的 `critRate`。
 *
 * 为什么要自己求和：0.3.3 的 `buffs.js` 没有 `critRate` / `lifesteal` 这两个 mod 键（units.js 的 `_recalc` 不聚合它们），
 * 所以 `passiveBuff({ critRate })` 会被静默忽略。惊变「黑闪」也是用同一个键（`jibian:heishan:crit`）加的 +50%，
 * 因此这里统一按「buff 求和」读，两边天然同源、也向后兼容（将来引擎真加了白值聚合，`s.critRate` 那项继续生效）。
 */
function critRateOf(u) {
  let c = num(u && u.s && u.s.critRate, 0);
  for (const b of (u && u.buffs) || []) {
    const v = b && b.mods ? b.mods.critRate : null;
    if (Number.isFinite(v)) c += v;
  }
  return c;
}

/** 一个单位的吸血比例（口径同 critRateOf）。 */
function lifestealOf(u) {
  let v0 = num(u && u.s && u.s.lifesteal, 0);
  for (const b of (u && u.buffs) || []) {
    const v = b && b.mods ? b.mods.lifesteal : null;
    if (Number.isFinite(v)) v0 += v;
  }
  return v0;
}

/**
 * 共享场（Final Assault / 隐秘核心 / 联防）的按玩家索引表 `battle.flags.forgeByPlayer`，没有就 null。
 * 表里**只列出真的锻造过、且在该场的玩家**；某玩家不在表里 = 他在这一场没有加成（不是 0 加算）。
 * @param {any} battle
 */
function forgeByPlayerOf(battle) {
  const m = battle && battle.flags ? battle.flags.forgeByPlayer : null;
  return m && typeof m === 'object' ? m : null;
}

/** 有没有任何一份非空的按玩家加成（决定 forge 要不要装）。 */
function hasForgeByPlayer(battle) {
  const m = forgeByPlayerOf(battle);
  if (!m) return false;
  for (const k of Object.keys(m)) if (m[k] && typeof m[k] === 'object' && !forgeModsEmpty(m[k])) return true;
  return false;
}

/**
 * 一个单位这一场的锻造面板：共享场按 `unit.ownerId` 查（**不用** defId / seat）；普通场用扁平那一份。
 * 两种形状都不存在、或该单位没有那一份 ⇒ null（= 这一场没有加成，一条 buff 都不挂）。
 */
function modsForUnit(battle, u) {
  const byPlayer = forgeByPlayerOf(battle);
  if (byPlayer) {
    const m = u && u.ownerId != null ? byPlayer[u.ownerId] : null;
    if (m && typeof m === 'object' && !forgeModsEmpty(m)) return m;
    // 共享场里不在表里的玩家就是「这一场没有加成」——**不要**回落到扁平那份（那是普通场的形状）。
    return null;
  }
  const flat = battle && battle.flags ? battle.flags.forge : null;
  if (flat && typeof flat === 'object' && !forgeModsEmpty(flat)) return flat;
  return (u && (u.forge || null)) || null;
}

export function install(battle) {
  if (!battle) return;
  // 幂等护栏：`DOMAIN_NAMES` 已经注册了 'forge'，若某个调用方又把它塞进 `extraContent`，两个 install 会让
  // hit 钩子挂两次（一次命中翻四倍）。这里只认第一次。
  if (battle._forgeInstalled) return;
  battle._forgeInstalled = true;
  // 炸惊视图（`battle.zj` 只在 modeId 含 `zhajing` 时非 null）或 T11 的 `flags.forge`：两者都没有 ⇒ 立刻退出，
  // 官方四档 / 湮灭房连一个监听器都不会挂上。
  const zj = !!battle.zj;
  const forgeFlag = !!(battle.flags && battle.flags.forge);
  if (!zj && !forgeFlag && !hasForgeByPlayer(battle)) return;

  // ── ① 基础暴击 5% 已折进白值（match 侧），这里不挂 buff；钩子按 critRateOf() 求和。
  // ── ② 锻造面板：普通场读扁平的 `flags.forge`；共享场（Final Assault / 隐秘核心 / 联防）读按玩家索引的
  //      `flags.forgeByPlayer[unit.ownerId]`。两种形状都可能不存在 ⇒ 视为「无锻造」，一条都不挂。 ────────────
  const byPlayer = forgeByPlayerOf(battle);
  const applyOne = (u) => {
    if (!u || u.kind !== 'op') return;
    const fm = modsForUnit(battle, u);
    if (!fm) return;
    const mods = {};
    if (fm.range) mods.rangeExtend = Math.max(0, Math.round(num(fm.range, 0)));
    if (fm.block) mods.blockCnt = Math.max(0, Math.round(num(fm.block, 0)));
    // crit / vamp：引擎没有这两个 mod 键，所以也挂成 buff，但**由本文件的钩子求和读取**（critRateOf / lifestealOf）。
    const crit = num(fm.crit, 0);
    const vamp = num(fm.vamp, 0);
    // ★ 技力需求走**倍率**（`skill.spCostMul`），不是 `spCostFlat` 绝对减法：后者会把低技力干员减成 0，
    //   引擎按「免费技能」把 charges 拉满、客户端技力条也消失（参考实现的 2026-10-16 修正）。
    //   `spMul` 已夹在 [0.1, 1]；`sp`（旧读法的百分比）不参与计算。
    const spMul = num(fm.spMul, 1);
    const sk = u.skill;
    if (sk && !sk.noSkill && spMul !== 1 && !u.mem[SPMUL_KEY]) {
      u.mem[SPMUL_KEY] = true;
      sk.spCostMul = sk.spCostMul * spMul;
    }
    if (Object.keys(mods).length) passiveBuff(battle, u, STATS_KEY, mods);
    if (crit) passiveBuff(battle, u, CRIT_KEY, { critRate: crit });
    if (vamp) passiveBuff(battle, u, VAMP_KEY, { lifesteal: vamp });
  };
  const applyAll = () => { for (const u of battle.allies()) applyOne(u); };
  applyAll();
  battle.on('deploy', (ctx) => applyOne(ctx && ctx.unit));
  battle.on('battleStart', () => applyAll());

  // ── ③ 战斗级钩子（读实时属性，所以基础 5% 与锻造加成一起算） ─────────────────
  if (!zj && !forgeFlag && !byPlayer) return;

  battle.on('hit', (ctx) => {
    const dmg = ctx && ctx.dmg;
    const s = ctx && (ctx.credit ?? ctx.source);
    const t = ctx && ctx.target;
    if (!dmg || !s || !t || s.side !== 'ally' || t.side !== 'enemy') return;
    const c = critRateOf(s);
    if (c > 0 && battle.rng() < Math.min(1, c)) {
      dmg.mul *= CRIT_MUL;
      // 打标记：damage 事件把它带给客户端（红金数字 + 粒子 + 音效）。惊变「黑闪」的 +3 技力读的就是它，
      // 所以本钩子的 priority 必须高于 -10（默认 0 即可）。
      dmg.crit = true;
    }
  }, { priority: 0 });

  battle.on('damaged', (ctx) => {
    const s = ctx && ctx.source;
    const t = ctx && ctx.target;
    if (!s || !t || s.side !== 'ally' || t.side !== 'enemy') return;
    if (!(ctx.amount > 0) || !s.alive) return;
    const v = lifestealOf(s);
    if (v > 0) battle.heal(s, s, ctx.amount * Math.min(1, v), { self: true });
  });
}

/** prep 侧：锻造面板由 match 折算（shared/forgeData.js forgeBattleMods），本模块没有 prep 钩子。 */
export function registerMeta() { /* no prep-side handlers */ }
