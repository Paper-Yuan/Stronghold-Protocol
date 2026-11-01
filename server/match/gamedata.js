// server/match/gamedata.js — typed, defaulted view of data/*.json for the match engine.
//
// Every lookup is an own-property lookup (ids come from client intents) that never throws and returns null for
// unknown ids. Tunables come from data/config.json with the documented defaults (research 00-INDEX §2–§8) when a
// key is missing, so a partial data set (tests, data being regenerated) still yields a working match.
//
// No custom balance (DESIGN §14 corrections, research 08 §6): enemy numbers are the official ones — the PRTS
// per-round enemyScale table of data/config.json, the leader pool = bloodPoint per player alive at the fight's start
// (bossPoolShareOf). data/tuning.json only overrides result titles:
//   titles[titleId]                                                { stat?, rule? } merged over config.titles
// (the former enemyHpMul / enemyAtkMul / enemySpeedMul / bossHpMul / flyPlaceholders knobs were removed; a tuning file
// that still carries them is ignored).

import { getConfig, getMode } from '../data.js';
import { ANNIHILATION_DIFFICULTY, EROSION_ENDLESS, EROSION_MAX } from '../../shared/annihilation-constants.js';
import { ANN_CONTENT_NAMES, ANN_RULE_NAMES } from '../../shared/protocol.js';
import { RULE_SWITCHES } from '../../shared/plugins/rules.js';
import { isZhajingDifficulty, isZhajingMode } from '../../shared/zhajing-constants.js';
import { isShopItem } from '../sim/simdata.js';
import { zjBondView, zjEquipCombos, overlayBondView } from '../../shared/zjBonds.js';
import { mergeData } from '../../shared/plugins/dataUtils.js';
import { standInRecord } from '../../shared/standIn.js';
import { MAX_OFFER_SLOTS } from './player/common.js';

const own = (map, id) => (map && typeof map === 'object' && typeof id === 'string' && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null);
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

/**
 * 湮灭模拟里**默认开启**的两条内容 mod（业主 2026-10-29）：名单与「显式压缺省」的判据都在
 * `shared/annihilation-constants.js`（整备侧 / 战斗侧 / 客户端共用的唯一来源），这里只做转发，避免第二真源。
 */
import { ANN_MOD_DEFAULT_ON, annModOn } from '../../shared/annihilation-constants.js';
export { ANN_MOD_DEFAULT_ON, annModOn };

/** 官方可见棋的判据（`visibleChess` 的官方分支与 `annihilationRoster` 共用一份，别再抄第二遍）。 */
export const isOfficialVisibleChess = (c) => !!c && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true
  && Number.isInteger(c.tier) && c.visible === true && c.zhajing !== true;

/**
 * 属于**内容 mod 开关**的 `annOnly` 盟约：数据里就是 rhodesShip / kazdelShip 两条（名字同时是 `ANN_CONTENT_NAMES` 的成员，
 * 所以「盟约 id = 开关名」是数据给的，不是这里写死的）。
 * @param {Record<string, any>} bonds 合并后的盟约视图（`annOnly` 记录在场）
 * @returns {string[]}
 */
export function annModBonds(bonds) {
  const all = bonds && typeof bonds === 'object' ? bonds : {};
  return Object.keys(all).filter((id) => all[id] && all[id].annOnly === true && ANN_CONTENT_NAMES.includes(id));
}

/**
 * 湮灭模拟的「干员调配」名册 / 卡池：官方可见棋，加上**内容 mod 自带的干员**，去掉**只由已关闭的 mod 带进来**的那些。
 * 判据只有数据：
 *   · 官方记录（`isOfficialVisibleChess`）：`chess[id].annBonds` 里指向 `annModBonds` 的边 = 该 mod 给的成员资格；
 *     至少一条边还开着就留下（chess_char_4_25_a 同时挂在两条盟约上，所以只关一条时它仍在名册里）；
 *   · mod 自带的干员（`chess[id].annihilation === true`，docs/research/20 的 13 名）：官方池永远看不见它们
 *     （`visible: false`），只有一条 `annBonds` 边还开着才进名册。
 * 两条 mod 缺省开 ⇒ 默认名册 = 官方 112 + 26 条 = 138。`server/lobby.js` 的 `room.loadout { mode: 'annihilation' }`
 * 校验与 `GameData.visibleChess` 都走这里，两条口径不会漂。
 * @param {Record<string, any>} chess data/chess.json
 * @param {Record<string, any>} bonds 合并后的盟约视图
 * @param {Record<string, boolean> | null | undefined} [annMods] the room's explicit switches
 * @returns {string[]} sorted chess ids
 */
export function annihilationRoster(chess, bonds, annMods) {
  const modBonds = annModBonds(bonds);
  const on = new Set(modBonds.filter((id) => annModOn(annMods, id)));
  const all = chess && typeof chess === 'object' ? chess : {};
  return Object.keys(all).filter((id) => {
    const c = all[id];
    if (!c) return false;
    const brought = Array.isArray(c.annBonds) ? c.annBonds.filter((b) => modBonds.includes(b)) : [];
    // 内容 mod 自带的干员：官方池看不见（visible: false），名册只认它自己的 annBonds 边 —— 与官方记录同一套过滤，
    // 只是把 `isOfficialVisibleChess` 的 visible 那一条换成了 `annihilation`（那个函数本身一个字都不改）。
    if (c.annihilation === true) {
      if (c.isGolden || c.isDiy || c.isHidden || c.grantOnly === true || !Number.isInteger(c.tier)) return false;
      return brought.some((b) => on.has(b));
    }
    if (!isOfficialVisibleChess(c)) return false;
    return brought.length === 0 || brought.some((b) => on.has(b));
  }).sort();
}

/**
 * 一件装备是不是属于某个**已关闭**的湮灭内容 mod：它的 `giveBondId` / `requiresBondId` 指向 `annOnly` 盟约，而那条盟约的
 * 开关是关的。数据里现在还没有这两个 mod 的 4 件装备（docs/ANNIHILATION-MODS.md §2.1 的 `_c_01_e`…`_c_04_e`），所以默认
 * 数据下一件都不命中；数据一补齐，开关就自动接管，不用再改这里。
 * @param {any} item data/items.json 的一条记录
 * @param {Record<string, any>} bonds 合并后的盟约视图
 * @param {Record<string, boolean> | null | undefined} [annMods] the room's explicit switches
 * @returns {boolean}
 */
export function itemAnnModOff(item, bonds, annMods) {
  if (!item || typeof item !== 'object') return false;
  const modBonds = annModBonds(bonds);
  for (const key of ['giveBondId', 'requiresBondId']) {
    const id = item[key];
    if (typeof id === 'string' && modBonds.includes(id) && !annModOn(annMods, id)) return true;
  }
  return false;
}

export const DEFAULTS = Object.freeze({
  income: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 12, 12, 12, 12],
  incomeCap: 12,
  chessPrice: { 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 },
  sellPrice: 1,
  refreshPrice: 1,
  poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 },
  mergeCount: 3,
  goldenCopies: 3,
  itemMergeCount: 2,
  benchSize: 10,
  tempSize: 5,
  deployCap: 8,
  equipPerChess: 2,
  maxArtsPerRound: 2,
  rewardOffer: { count: 3, tierOffset: 1, maxTier: 6, price: 0 },
  upgradePrices: [5, 8, 11, 12, 13],
  maxShopLevel: 6,
  shopSlots: { 1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 }, 4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 } },
  defaultBandId: 'band_bldsk',
  defaultStartLp: 28,
  lpCapPerRound: 10,
  bossOvertimeAfter: 150,
  bossOvertimeDrainPerSec: 1,
  hiddenCore: { single: 350, multi: 1200, minTeamLpExclusive: 1, difficulties: ['NORMAL', 'HARD', 'ABYSS'] },
  dp: { init: 10, perSec: 1, max: 99 },
  unite: { maxHelpers: 2, templates: { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' } },
  timers: { infoCheck: 25, bandDraft: 50, bandTurn: 30, battleCheck: 3, spFirst: 30, spTurn: 16 },
  bans: { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 }, ZHAJING: { core: 3, addon: 4 } },
  bandDraft: { skipsPerPlayer: 1, timeoutBandId: 'band_bldsk' },
  leftoverFundsKeptByBands: ['band_cannot'],
});

/** Game seconds per real second of a battle (forced 2×): combat limits in data are real seconds (combatTimeLimit). */
export const COMBAT_TIME_SCALE = 2;

/**
 * Multiplier of bloodPoint[difficulty] for the shared leader pool (DESIGN §20.10, §25.13.4), from config bossHpScale —
 * each key from the mode's entry first, then the global one; the defaults are the current rule:
 *   solo   `solo` (1: the table value — one player's share);
 *   co-op  `perPlayer` true (the owner's decision of 2026-10-06, adopting PR #209 by @qingjingshenghuo): `coop` (1) × the
 *          players alive when the fight starts — bots and AI 托管 seats count, eliminated and departed seats do not —
 *          at most `aliveFull` (4); a count left out means a full team;
 *          `perPlayer` false: the fixed pool of 0.1.x (「保持固定血量」, restorable with `solo` 0.25): `coop` whatever the
 *          count, × min(alive, aliveFull) / aliveFull with `aliveScaling`.
 * @param {object|null|undefined} modeScale config.modes[modeId].bossHpScale
 * @param {object|null|undefined} cfgScale config.bossHpScale
 * @param {boolean} isSolo
 * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
 * @returns {number}
 */
export function bossPoolShareOf(modeScale, cfgScale, isSolo, aliveCount) {
  const ms = modeScale && typeof modeScale === 'object' ? modeScale : {};
  const cs = cfgScale && typeof cfgScale === 'object' ? cfgScale : {};
  const pick = (k, d) => (Number.isFinite(ms[k]) && ms[k] > 0 ? ms[k] : Number.isFinite(cs[k]) && cs[k] > 0 ? cs[k] : d);
  const flag = (k, d) => (typeof ms[k] === 'boolean' ? ms[k] : typeof cs[k] === 'boolean' ? cs[k] : d);
  if (isSolo) return pick('solo', 1);
  const full = Math.max(1, Math.floor(pick('aliveFull', 4)));
  const n = Number(aliveCount);
  const alive = Number.isFinite(n) && n >= 1 ? Math.min(full, Math.floor(n)) : full;
  if (flag('perPlayer', true)) return pick('coop', 1) * alive;
  return pick('coop', 1) * (flag('aliveScaling', false) ? alive / full : 1);
}

/** Strip the _a/_b suffix of an item id (the registry key of an item family). */
export const itemKey = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

/**
 * 无尽湮灭 (蚀流 6): how much every decision raises the escalation once the relic catalogue is exhausted — allies' ATK/HP
 * and the enemies' HP/ATK/DEF, per decision (server/match/relics.js applyEndlessEscalation). 0.2 = +20 %.
 */
export const ENDLESS_ESCALATION_STEP = 0.2;

/**
 * The boss / hidden-core queue. Every tier up to 蚀流 5 keeps the pairs the mode's own schedule knows (report §2.6); 无尽
 * turns the tail into "30回合后每经过3个回合出boss、隐秘核心": one Final Assault every ENDLESS_BOSS_EVERY rounds, its Hidden
 * Core right behind it (R33/34, R36/37 …). The run itself is unbounded — the table is materialised ENDLESS_PAIR_HORIZON
 * rounds ahead and the pairs past it are derived arithmetically (nextBossRound / pairOfRound).
 */
const ENDLESS_BOSS_EVERY = 3;
const ENDLESS_PAIR_HORIZON = 600;
/** 蚀流 5's four chapters (14/15, 19/20, 24/25, 29/30) — also the base 无尽湮灭 extends. */
const ENDLESS_BASE_PAIRS = Object.freeze([[14, 15], [19, 20], [24, 25], [29, 30]]);
/** 蚀流 3–4 add the 90-round chapter's first pair (R14/15) to the 19/20 one. */
const EROSION_3_PAIRS = Object.freeze([[14, 15], [19, 20]]);

/**
 * 蚀流 1–30: the enemy exponent ladder — attack 1.2^e, health 1.25^e (solo) / 1.3^e (alliance); index = round − 1.
 * R1–R30 read these tables unchanged, and every round past them continues the same "one step every two rounds" rule
 * through erosionTailExponent — 无尽湮灭 simply never leaves that tail. 独立模式's health ladder is the attack one.
 */
const EROSION_ATK_EXP = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21];
const EROSION_HP_EXP_COOP = [1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21];
/**
 * The exponent past the table's end: continue from its last step (21), +1 every 2 rounds —
 * R31/32 = 22, R33/34 = 23, R35/36 = 24 … with no end (that tail is what 无尽湮灭 runs on).
 * @param {number} i index = round − 1
 * @returns {number}
 */
const erosionTailExponent = (i) => EROSION_ATK_EXP[EROSION_ATK_EXP.length - 1] + Math.floor((i - EROSION_ATK_EXP.length) / 2) + 1;

/**
 * 蚀流 `round`'s enemy exponent e: the tables above up to R30, erosionTailExponent after it.
 * @param {number} round
 * @param {boolean} [coop] the alliance ladder (1.3 health)
 * @returns {number}
 */
export const erosionExponent = (round, coop = false) => {
  const i = Math.max(0, Math.floor((Number(round) || 1) - 1));
  const table = coop ? EROSION_HP_EXP_COOP : EROSION_ATK_EXP;
  return i < table.length ? table[i] : erosionTailExponent(i);
};

/**
 * 无尽湮灭's 决策 (SP / 机变) cadence: up to R29 the mode's own rule stands (a 决策 after every even round, drafted on the
 * odd round after it), after it one opens every ENDLESS_DECISION_EVERY rounds — R33, R37, R41 …
 */
const ENDLESS_DECISION_UNTIL = 29;
const ENDLESS_DECISION_EVERY = 4;

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   * @param {{ erosion?: number }} [opts] 湮灭模拟's 蚀流 tier (Match passes the room's picked level)
   */
  constructor(data, modeId, opts = {}) {
    this.raw = data && typeof data === 'object' ? data : {};
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    /**
     * 超限模拟（solo_infinite / coop_infinite）：R1–R15 的敌人数值改用同队型的绝境表，Boss 轮自带倒计时。
     * Match 构造时按 `this.isInfinite` 传入（Match.js），其它任何直接 new GameData 的调用（工具 / 测试 / 普通对局）
     * 缺省仍是 false —— 超限口径不会漏进普通模式。
     *
     * 以前这里是 `this.overlimit = false` 且**全仓没有第二处赋值**：下面 bossLevelTime / baseEnemyScale 两处
     * `this.overlimit` 分支从没跑过（docs/proposals/OVERLIMIT.md §2 F1），于是超限 Boss 轮 deadline=0。
     */
    this.overlimit = !!(opts && typeof opts === 'object' && opts.overlimit === true);
    this.mode = getMode(modeId, this.raw) || {};
    /**
     * 湮灭模拟's 蚀流 tier (1..EROSION_MAX; 6 = 无尽湮灭, shared/annihilation-constants.js). Only the ANNIHILATION modes
     * read it: every other mode stays at 1 whatever the caller passes, so a stray `erosion` can never switch an official
     * mode onto an erosion path. Anything that is not an integer in 1..EROSION_MAX — missing, 0, 7, '3', NaN, a null
     * `opts` — is silently 1: the chain Room.erosion → Match opts.erosion → here drops a bad value without throwing
     * (report 湮灭模拟 §2.4 / §6 坑 B; Match.js already clamps, this is the second line of defence).
     */
    const erosion = opts && typeof opts === 'object' ? opts.erosion : undefined;
    this.erosion = this.mode.difficulty === ANNIHILATION_DIFFICULTY && Number.isInteger(erosion) && erosion >= 1 && erosion <= EROSION_MAX ? erosion : 1;
    /**
     * 湮灭专属 mod 的房间级开关 (docs/ANNIHILATION-MODS.md §2.3.3): `{ shopBias?, prepLoadout?, morphPairing?, unequip?,
     * egirBuff?, commsPriority?, rhodesShip?, kazdelShip? }`, booleans, `true` = on, `false` = 显式关掉一条缺省开的 mod.
     * A ROOM setting, never part of the content set (it does not enter `cs`). Read only in an ANNIHILATION room — every
     * other mode ignores it, so a stray value can never switch an official or 炸惊 match onto a mod path (the same rule
     * `erosion` follows above). 玩家没写过的名字这里**不出现**：缺省由 `annModOn` / `annMod` 算（两条内容 mod 缺省开）。
     * `comms` is normalised to `commsPriority`; unknown names are dropped (the protocol refuses them already — this is the
     * second line of defence for matches built directly in tests).
     * @type {Readonly<Record<string, boolean>>}
     */
    const annModsIn = opts && typeof opts === 'object' && opts.annMods && typeof opts.annMods === 'object' ? opts.annMods : null;
    const annMods = {};
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY && annModsIn) {
      for (const [k, v] of Object.entries(annModsIn)) {
        const name = k === 'comms' ? 'commsPriority' : k;
        // `true` 与 `false` 都留下：显式 `false` 是「关掉一条默认开启的 mod」（ANN_MOD_DEFAULT_ON）唯一的表达方式，
        // 丢掉它就等于没法关。没写过的名字仍然什么都不存（缺省在 annModOn / annMod 里算）。
        if (typeof v === 'boolean' && (ANN_RULE_NAMES.includes(name) || ANN_CONTENT_NAMES.includes(name))) annMods[name] = v;
      }
    }
    this.annMods = Object.freeze(annMods);
    /**
     * The mode's own `annRules` (config.modes[*].annRules): a data-side way to ship a mode with some of the four rule
     * switches already on. Absent everywhere today (the owner's decision is a room setting), read here so the precedence
     * has its slot: official default → mode.annRules → room annMods → plugin content rules (strongest).
     */
    this._annRules = this.mode.annihilation && this.mode.annRules && typeof this.mode.annRules === 'object' ? this.mode.annRules : {};
    /** The room's content rules (the plugin content set's `rules`; Match passes `this.rules`) — STRONGEST in rulesOf. */
    this._contentRules = opts && typeof opts === 'object' && opts.contentRules && typeof opts.contentRules === 'object' ? opts.contentRules : null;
    // Mode-level globals inherit field by field; the vanilla mode never changes its config object.
    const overrides = Object.fromEntries(Object.keys(this.config).filter(k => k !== 'modes' && Object.hasOwn(this.mode, k)).map(k => [k, this.mode[k]]));
    if (Object.keys(overrides).length) this.config = mergeData(this.config, overrides);
    this.economy = this.config.economy && typeof this.config.economy === 'object' ? this.config.economy : {};
    const chess = this.raw.chess && typeof this.raw.chess === 'object' ? this.raw.chess : {};
    this._chess = chess;
    this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
    // Fixed operator gifts are unlimited outputs, but every produced normal/advanced item still occupies 1/2 copies
    // (card-pool experiment BV1eLXXBqEgF, maintainer-confirmed 2026-10-11). Random subset gifts are not exempt.
    this._fixedGiftItems = new Set(Object.values(this.raw.garrisons || {})
      .filter(g => g.effectKey === 'SERVER_GAIN_EQUIP').map(g => g.bbStr?.chess).filter(id => this._items[id]));
    /**
     * 炸惊模拟 (拓展玩法模式 ZHAJING, handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2): ONE mode flag, every hook on top of it.
     * It is `difficulty === 'ZHAJING'` (or a zhajing mode id), never a separate data set: the zhajing records sit in
     * data/*.json carrying `zhajing: true` / `zjOnly: true` / a `zj` block and every collector in this class filters
     * them out again for every other mode, so the official four difficulties (solo and 同盟) read exactly what they read
     * before the records existed. The constants live in shared/zhajing-constants.js (never in DIFFICULTIES: that list
     * draws the four official difficulty cards).
     */
    this.zhajing = isZhajingMode(this.modeId) || isZhajingDifficulty(this.mode.difficulty);
    const zhajing = this.zhajing;
    this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
    /**
     * 炸惊模拟的盟约覆盖层 (shared/zjBonds.js)：`data/bonds.json` 里带 `zj` 块的盟约，在炸惊下换成合并后的记录
     * （阈值、数值袋、buff、文案…都可能是炸惊专用）。只换 `this._bonds`，`this.raw.bonds` 保持原样，所以其它模式
     * 以及任何直接读原始数据的地方都不受影响。战斗模拟侧另有一份注入（sim 的 `battle.zj`），两边走同一个合并函数。
     */
    // 装备组合表要先从带 `zj` 块的原始记录里取，合并之后 `zj` 就被丢掉了（bondsMeta 的 pieceBonds 用它）
    this.zjCombos = zhajing ? zjEquipCombos(this._bonds) : null;
    // 炸惊：合并覆盖块；其它难度：只把 `zj` 键剥掉（记录逐字节等于改动前，也不会把覆盖块漏给客户端）
    this._bonds = zjBondView(this._bonds, { merge: zhajing });
    // 湮灭模拟 (the eight mods of 2026-10-28, docs/ANNIHILATION-MODS.md): the `ann` overlay merges ONLY in an
    // annihilation mode; every other mode (the official four, training, 炸惊) gets the block stripped and the two
    // `annOnly` bonds (rhodesShip / kazdelShip) dropped, so its bond list stays byte-identical — the same rule the `zj`
    // layer above follows (shared/zjBonds.js overlayBondView, devtools/check-mode-isolation.mjs).
    this._bonds = overlayBondView(this._bonds, 'ann', { merge: this.annihilation !== null });
    // 超限模拟 (solo_infinite / coop_infinite, 业主 2026-10-31): the `inf` overlay merges ONLY while `this.overlimit` is
    // on — a bond's text then gains its 超限专属 lines (原版原文一字不改，只追加)；every other mode strips the block and
    // keeps the record byte-identical (the same rule the `zj` / `ann` layers above follow). Text only: the numbers live in
    // the battle side (server/sim/content/bonds/core.js 的具名常量), so no 模式 can pick up an accidental value from here.
    this._bonds = overlayBondView(this._bonds, 'inf', { merge: this.overlimit });
    /** 湮灭模拟：这条实例的模式判定（官方四档 / 炸惊 / 训练一律 false） */
    const annMode = this.annihilation !== null;
    /**
     * 湮灭模拟里被房间开关**关掉**的 `annOnly` 盟约（两条内容 mod 缺省开，所以默认是空集）。关掉的那条从 `bondIds` /
     * `bond()` 里消失，于是「两条 mod 都关」的湮灭局在盟约视图上与官方基线逐字节一致（docs「全关 = 官方行为」）。
     * `this._bonds` 本身保持完整：`annihilationRoster` / `itemAnnModOff` 要靠它认出「哪些边是 mod 带进来的」。
     * @type {Set<string>}
     */
    this._annModsOff = new Set(annMode ? annModBonds(this._bonds).filter((id) => !annModOn(this.annMods, id)) : []);
    /**
     * visible, shop-eligible base (normal) chess ids. 炸惊模拟 uses its own roster instead: the `zhajing: true` records
     * generated from the roster, which carry `visible: false` so every other mode's filter keeps excluding them.
     * 湮灭模拟：两条内容 mod 带进来的棋跟着房间开关（`annihilationRoster`，与 lobby 的 room.loadout 校验同一份口径）——
     * 两条 mod 缺省开，所以默认名册 = 官方 112 条 + mod 自带的 26 条 = 138；关掉一条才减。
     */
    this.visibleChess = (annMode ? annihilationRoster(chess, this._bonds, this.annMods) : Object.keys(chess).filter((id) => {
      const c = chess[id];
      // 重岳 / 白铁 (chess_zj_chyue_*, chess_zj_ironmn_*) come only from a strategy's grant (「祀」,
      // `grant(..., { requirePool: false })`), never from the pool, a refresh or the shop. The reference build excludes
      // `grantOnly` here and 炸惊模拟's roster carries those four records, so this clause is what keeps them out of the
      // ZHAJING shop (found by devtools/check-mode-isolation.mjs: the roster was 99 instead of 97).
      if (!c || c.isGolden || c.isDiy || c.isHidden || c.grantOnly === true || !Number.isInteger(c.tier)) return false;
      return zhajing ? c.zhajing === true : (c.visible === true && c.zhajing !== true);
    })).sort();
    /**
     * Shop item ids by tier (sim/simdata.js isShopItem: normal EQUIP, not hidden, not effect-only — the special
     * 维式重锤 and 突变细胞 are never sold). Every shop-item draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId). A pool's `also` list
     * (pool_equip_kathe: 突变细胞, #631) is appended there and is not in this table, so the shop slot still never sells it.
     */
    this.shopItemsByTier = {};
    for (const [id, it] of Object.entries(this._items)) {
      if (!isShopItem(it)) continue;
      // 炸惊专属装备（S.E.E.S 袖章、谜の假面… `zjOnly: true`）不出现在普通 / 终极的商店与装备池
      if (it.zjOnly === true && !zhajing) continue;
      // 湮灭专属装备（`annOnly: true`，两条新盟约「每 100 层发一件」的奖励装）不出现在任何非湮灭局；
      // 与 zjOnly 对称。**这一条同时是官方 golden 的护栏**：它们一旦漏进官方池，`tools/golden.mjs` 的
      // EQUIPS 游标就会整体错位（2026-10-29 实测 42+8+20 个场景位移）。
      if (it.annOnly === true && !annMode) continue;
      // 湮灭模拟：mod 自带的装备（`giveBondId` / `requiresBondId` 指向该 mod 的新盟约）跟着房间开关 —— 关掉就不进
      // 商店 / 装备池，与名册同一条口径（缺省开，显式 false 才关）。
      if (annMode && itemAnnModOff(it, this._bonds, this.annMods)) continue;
      (this.shopItemsByTier[it.tier] ||= []).push(id);
    }
    for (const k of Object.keys(this.shopItemsByTier)) this.shopItemsByTier[k].sort();
    this.bondIds = Object.keys(this._bonds).filter((id) => !this._annModsOff.has(id))
      .sort((a, b) => (numOr(this._bonds[a].identifier, 99) - numOr(this._bonds[b].identifier, 99)) || (a < b ? -1 : 1));
    this.modeInactiveBonds = new Set(Array.isArray(this.mode.inactiveBondIds) ? this.mode.inactiveBondIds : []);
    /** bandBondIds memo */
    this._bandBonds = new Map();
    this.inactiveEnemies = new Set(Array.isArray(this.mode.inactiveEnemyKeys) ? this.mode.inactiveEnemyKeys : []);
    /** data/tuning.json (titles only, see the header) */
    this.tuning = this.raw.tuning && typeof this.raw.tuning === 'object' ? this.raw.tuning : {};
    /** standIn memo: chess id → composed 补位 record | null */
    this._standIns = new Map();
  }

  /**
   * Leader HP pool multiplier — always 1 (no custom balance). Kept for callers written against the old tuning layer
   * (finalAssault.bossPoolHp); use `bossPoolHp` / `bossPoolShare` for the official pool.
   * @deprecated
   */
  bossHpMul(bossId) { // eslint-disable-line no-unused-vars
    return 1;
  }

  /**
   * Shared leader HP pool (DESIGN §20.10, §25.13.4): ONE pool for every boss field of the match (official tip "最终攻势中，
   * 所有人将一起对敌方领袖造成伤害"; the mirrored copies of a pair field share it — notice 5114 "两侧的敌方领袖共享生命值
   * （敌方领袖的总生命值不变）", which is about those copies). Size = bloodPoint[difficulty] × bossPoolShare: the table value
   * per player alive when the fight starts (the owner's decision of 2026-10-06, PR #209; it replaces the fixed pool of
   * 「保持固定血量」, which config bossHpScale restores — bossPoolShareOf); `aliveCount` omitted ⇒ a full team. Leaders are
   * never scaled by enemyScale ("领袖单位于服务器的生命值加成不受上述加成影响").
   * @param {string} bossId
   * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
   * @returns {number}
   */
  bossPoolHp(bossId, aliveCount, round) {
    const boss = this.boss(bossId);
    const diff = this.difficulty;
    let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
    if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
    if (base == null) base = 500000;
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount)));
  }

  /**
   * Multiplier of bloodPoint for the leader pool (see bossPoolHp; the rule and the config keys: bossPoolShareOf).
   * @param {number} [aliveCount]
   */
  bossPoolShare(aliveCount) {
    return bossPoolShareOf(this.mode.bossHpScale, this.config.bossHpScale, this.isSolo, aliveCount);
  }

  /** config.titles with the tuning overrides (stat / rule per title id) merged in. */
  get titles() {
    const list = Array.isArray(this.config.titles) ? this.config.titles : [];
    const ov = this.tuning.titles && typeof this.tuning.titles === 'object' ? this.tuning.titles : {};
    return list.map((t) => {
      if (!t || typeof t.id !== 'string' || !Object.hasOwn(ov, t.id) || !ov[t.id] || typeof ov[t.id] !== 'object') return t;
      const o = ov[t.id];
      const out = { ...t };
      if (typeof o.stat === 'string') out.stat = o.stat;
      if (o.rule === 'max' || o.rule === 'min') out.rule = o.rule;
      return out;
    });
  }

  // ---- ids ------------------------------------------------------------------------------------------

  chess(id) { return own(this._chess, id); }
  item(id) { return own(this._items, id); }
  bond(id) { return this._annModsOff.has(id) ? null : own(this._bonds, id); }
  band(id) { return own(this.raw.bands, id); }
  garrison(id) { return own(this.raw.garrisons, id); }
  effect(id) { return own(this.raw.effects, id); }
  enemy(key) { return own(this.raw.enemies, key); }
  wave(id) { return own(this.raw.waves, id); }
  stage(id) { return own(this.raw.stages, id); }
  boss(id) { return own(this.raw.bosses, id); }
  token(id) { return own(this.raw.tokens, id); }
  get choices() { return this.raw.choices && typeof this.raw.choices === 'object' ? this.raw.choices : {}; }
  get factions() { return this.raw.factions && typeof this.raw.factions === 'object' ? this.raw.factions : {}; }

  /**
   * 超限模拟「词条」（饰品）表（data/relicsOverlimit.json，业主 2026-10-31）。**只在超限局可见**：`overlimit` 关着时
   * 恒为 null，于是普通 / 湮灭 / 炸惊的任何一个读取点都拿不到它（与 `zj` / `ann` / `inf` 覆盖块同一条边界纪律）。
   * 表缺失（旧数据、版本档、离线夹具）同样返回 null —— 调用方必须能空跑，词条三选一只是不出现。
   * @returns {{ weights: Record<string, any>, counts: Record<string, number>, entries: any[] }|null}
   */
  get relicsOverlimit() {
    if (!this.overlimit) return null;
    const t = this.raw.relicsOverlimit;
    if (!t || typeof t !== 'object' || !Array.isArray(t.entries) || !t.entries.length) return null;
    return t;
  }

  /**
   * 超限模拟「负面词条」表（data/relicsOverlimitNegative.json，业主 2026-10-31 第二批，与 36 条饰品词条并列）。
   * 与 `relicsOverlimit` 同一条边界：`overlimit` 关着 ⇒ null（普通 / 湮灭 / 炸惊拿不到），表缺失 / 旧数据也 ⇒ null。
   * @returns {{ group: string, count: number, entries: any[] }|null}
   */
  get relicsOverlimitNegative() {
    if (!this.overlimit) return null;
    const t = this.raw.relicsOverlimitNegative;
    if (!t || typeof t !== 'object' || !Array.isArray(t.entries) || !t.entries.length) return null;
    return t;
  }

  /**
   * The 补位 record of chess `id` (normal or elite; DATA.md §18): shared/standIn.js standInRecord over data/backups.json
   * — the chess's identity (ids, tier, bonds, 特质, price, merge) with its official stand-in's body (stats, range, skills
   * with the backup skill as the default, talents, module, art, `standInFor`). Null for a PRESET / 自选 chess, an unknown
   * id or data without backups.json. Memoized (frozen records).
   * @param {string} id
   * @returns {object|null}
   */
  standIn(id) {
    if (typeof id !== 'string') return null;
    if (this._standIns.has(id)) return this._standIns.get(id);
    const c = this.chess(id);
    const backups = this.raw.backups && typeof this.raw.backups === 'object' ? this.raw.backups : null;
    let rec;
    try { rec = c && backups ? standInRecord(c, backups) : null; } catch { rec = null; }
    if (rec) Object.freeze(rec);
    this._standIns.set(id, rec);
    return rec;
  }

  /** Normal (base) chess id of a chess id (golden → base). */
  baseIdOf(id) {
    const c = this.chess(id);
    if (!c) return typeof id === 'string' ? id.replace(/_b$/, '_a') : null;
    return c.baseId || (c.isGolden ? id.replace(/_b$/, '_a') : id);
  }

  goldenIdOf(id) {
    const c = this.chess(this.baseIdOf(id));
    if (c && c.goldenId && this.chess(c.goldenId)) return c.goldenId;
    const alt = typeof id === 'string' ? id.replace(/_a$/, '_b') : null;
    return alt && this.chess(alt) ? alt : null;
  }

  isGolden(id) { const c = this.chess(id) || this.item(id); return !!(c && c.isGolden); }

  tierOf(id) {
    const c = this.chess(id) || this.item(id);
    return c && Number.isInteger(c.tier) ? c.tier : 1;
  }

  // ---- economy --------------------------------------------------------------------------------------

  income(round) {
    const arr = Array.isArray(this.economy.income) ? this.economy.income : DEFAULTS.income;
    const cap = numOr(this.economy.incomeCap, DEFAULTS.incomeCap);
    const v = arr[round];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return Math.max(0, Math.min(cap, 3 + round));
  }

  chessPrice(id) {
    const c = this.chess(id);
    const override = this.mode.economy?.chessPrice?.[this.tierOf(id)]?.[c?.isGolden ? 'golden' : 'normal'];
    if (Number.isFinite(override) && override >= 0) return override;
    if (c && Number.isFinite(c.price) && c.price >= 0) return c.price;
    const tier = this.tierOf(id);
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    const golden = c && c.isGolden;
    if (row && typeof row === 'object') return numOr(golden ? row.golden : row.normal, DEFAULTS.chessPrice[tier] ?? 3);
    return DEFAULTS.chessPrice[tier] ?? 3;
  }

  sellPrice(id) {
    const c = this.chess(id);
    const override = this.mode.economy?.chessSell?.[this.tierOf(id)]?.[c?.isGolden ? 'golden' : 'normal'];
    if (Number.isFinite(override) && override >= 0) return override;
    if (c && Number.isFinite(c.sellPrice) && c.sellPrice >= 0) return c.sellPrice;
    const tier = this.tierOf(id);
    const row = this.economy.chessSell && this.economy.chessSell[tier];
    if (row && typeof row === 'object') return numOr(c && c.isGolden ? row.golden : row.normal, DEFAULTS.sellPrice);
    return DEFAULTS.sellPrice;
  }

  itemPrice(id) {
    const it = this.item(id);
    return it && Number.isFinite(it.price) && it.price >= 0 ? it.price : 2;
  }

  get refreshPrice() { return Math.max(0, numOr(this.economy.refreshPrice, DEFAULTS.refreshPrice)); }
  get benchSize() { return posIntOr(this.economy.benchSize, DEFAULTS.benchSize); }
  get tempSize() { return posIntOr(this.economy.tempSize, DEFAULTS.tempSize); }
  get deployCap() { return posIntOr(this.economy.deployCap, DEFAULTS.deployCap); }
  /**
   * Equipment slots per operator. 无尽湮灭: 干员装备道具数量无限制 — Infinity, so items.js never takes an item off a
   * carrier to make room (player/items.js compares the used slots against policy.slotCap(this value)).
   */
  get equipPerChess() {
    if (this.endless) return Infinity;
    return posIntOr(this.economy.equipPerChess, DEFAULTS.equipPerChess);
  }
  /**
   * 无尽湮灭: 盟约叠层无层限制 — the layer writers take the gain whole instead of clamping it through
   * shared/constants.js layerGainRoom (player/economy.js addLayers).
   */
  get unlimitedLayers() { return this.endless; }
  get maxArtsPerRound() { return posIntOr(this.economy.maxArtsPerRound, DEFAULTS.maxArtsPerRound); }
  get goldenCopies() { return posIntOr(this.economy.goldenCopies, DEFAULTS.goldenCopies); }
  get itemMergeCount() { return posIntOr(this.economy.itemMergeCount, DEFAULTS.itemMergeCount); }
  get leftoverKeptBands() {
    const ids = Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands;
    const extra = Object.values(this.raw.bands || {}).filter(b => b.effectRef && ids.includes(b.effectRef)).map(b => b.bandId);
    return extra.length ? [...ids, ...extra] : ids;
  }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      // (an offer shows at most MAX_OFFER_SLOTS: a larger count — a data plugin's — only rolled for slots nobody sees)
      count: Math.min(MAX_OFFER_SLOTS, posIntOr(r.count, DEFAULTS.rewardOffer.count)),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /**
   * Copies of a base chess in the shared pool — and, for a DIY slot, of a slotted 自选 piece in its player's own stock
   * (player/diy.js buildDiyStock).
   */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = ov && Number.isInteger(ov[baseId]) && ov[baseId] >= 0 ? ov[baseId] : pc?.[tier];
    const base = Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
    // Co-op doubles the single-player counts: the measured shared pool (shared by the whole team, independent of team
    // size) and each player's private 自选 stock alike — the maintainer's decision of 2026-10-15 (GitHub #650): with
    // the shared pool doubled and the 自选 stock not, a 自选 operator was diluted in the copy-weighted rolls.
    const multiplier = this.isSolo ? 1 : posIntOr(this.economy.coopPoolMultiplier, 1);
    return base * multiplier;
  }

  /** Normal equipment copies in the shared pool; effect-only items have no shop stock limit. */
  itemPoolCopies(id) {
    const base = this.baseIdOf(id), rec = this.item(base);
    if (!rec || !isShopItem(rec)) return null;
    // 特性专属产出装备无上限（缪缪变形同构体、耶拉谢拉格不融冰）：cap 为 null，left 恒为 Infinity ——
    // 它既不占库存、释放时也不归还（2026-10-16 ab33db70 的规则；r40a 早两天的 cap===3 期望已被它取代）。
    if (base === 'chess_item_6_09_e_a' || base === 'chess_item_5_02_e_a') return null;
    const count = this.economy.itemPoolCopiesOverrides?.[base] ?? this.economy.itemPoolCopies?.[rec.tier];
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  /** Whether a fixed trait gift may be produced beyond stock (including the advanced version of that item). */
  isUnlimitedGiftItem(id) { return this._fixedGiftItems.has(this.baseIdOf(id)); }

  /** Copies needed to merge (0 = never merges: golden chess). */
  mergeCount(id) {
    const c = this.chess(id);
    if (!c || c.isGolden) return 0;
    if (Number.isInteger(c.upgradeNum) && c.upgradeNum > 0) return c.upgradeNum;
    const ov = this.economy.mergeCountOverrides;
    if (ov && Number.isInteger(ov[id])) return ov[id];
    return posIntOr(this.economy.mergeCount, DEFAULTS.mergeCount);
  }

  // ---- mode -----------------------------------------------------------------------------------------

  get isSolo() {
    if (typeof this.isSoloOverride === 'boolean') return this.isSoloOverride;
    return this.mode.type === 'SINGLE' || /^mode_single_/.test(this.modeId || '');
  }
  get difficulty() { return this.mode.difficulty || (this.modeId ? String(this.modeId).split('_').pop().toUpperCase() : 'NORMAL'); }

  /**
   * The mode's own battle rules (config.modes[m].annihilation — 湮灭模拟), or null for every official mode:
   *   fog            { afterReal, rampReal, maxRatio, targets } — the toxic fog (server/sim/content/hazard.js): it rises
   *                  afterReal REAL seconds into a battle and its damage climbs for rampReal seconds up to maxRatio of a
   *                  unit's MAX HP per second; `targets` 'all' also poisons enemies, 'allies' (the default) only the
   *                  player's half
   *   terrainLethal  factor on every stage mechanic's numbers (devices.js; 5 = 致命级)
   *   chaosTargeting enemies pick their target at random instead of blocker → taunt → latest deployed
   * Defaults mirror the mode's data; `afterReal` is read from the data (the data worker's 60 s) and falls back to the
   * 30 s the fan build used before the block carried the number.
   */
  get annihilation() {
    const a = this.mode.annihilation && typeof this.mode.annihilation === 'object' ? this.mode.annihilation : null;
    if (!a) return null;
    const fog = a.fog && typeof a.fog === 'object' ? a.fog : null;
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
    return {
      fog: fog ? {
        afterReal: num(fog.afterReal, 30),
        rampReal: num(fog.rampReal, 20),
        maxRatio: Math.min(1, num(fog.maxRatio, 0.2)),
        targets: fog.targets === 'all' ? 'all' : 'allies',
      } : null,
      terrainLethal: num(a.terrainLethal, 1),
      chaosTargeting: a.chaosTargeting === true,
    };
  }

  /**
   * The battle flags a mode adds on top of its DP knobs (Battle opts.flags; the sim reads them, the client runs the same
   * spec), or null when the mode adds none. 湮灭模拟: the fog on every normal / 联防 map of rounds before the Final
   * Assault (the Final Assault's own round and the Hidden Core are exempt), the 致命级 stage mechanics and the enemies'
   * chaotic targeting — all in GAME seconds, so the client and the server agree whatever the battle speed.
   * 无尽湮灭: no fog anywhere — the endless run is already the pressure.
   * @param {'normal'|'unite'|'boss'|'hidden'} kind
   * @param {number} round the match round the field belongs to
   * @returns {{ terrainLethal?: number, chaosTargeting?: boolean, fog?: { at: number, ramp: number, ratio: number, targets?: 'all' } }|null}
   */
  annihilationFlags(kind, round) {
    const a = this.annihilation;
    if (!a) return null;
    /** @type {{ terrainLethal: number, chaosTargeting: boolean, fog?: { at: number, ramp: number, ratio: number, targets?: 'all' } }} */
    const out = { terrainLethal: a.terrainLethal, chaosTargeting: a.chaosTargeting };
    const fogOff = this.endless || kind === 'boss' || kind === 'hidden' || Number(round) >= this.bossRound;
    if (a.fog && !fogOff) {
      out.fog = {
        at: a.fog.afterReal * this.combatTimeScale,
        ramp: a.fog.rampReal * this.combatTimeScale,
        ratio: a.fog.maxRatio,
        ...(a.fog.targets === 'all' ? { targets: 'all' } : {}),
      };
    }
    // 湮灭专属 mod 的内容开关送进战场 (docs/ANNIHILATION-MODS.md §2.2b): the sim cannot see the room, so the battle flags
    // carry them (`battle.flags.annMods.egirBuff` …). Omitted when the room has no explicit key, so every official / 炸惊
    // field keeps exactly the flags object it has today. **显式 boolean 全带**（`true` 与 `false`）：默认开启的两条由
    // shared/annihilation-constants 的缺省表兜底，而「用户把默认开启的那条关掉」只有把 `false` 带进战场才生效
    // （sim 侧 `annModOn` 是「显式压缺省」）。
    const explicit = Object.fromEntries(Object.entries(this.annMods || {}).filter(([, v]) => typeof v === 'boolean'));
    if (Object.keys(explicit).length) out.annMods = Object.freeze(explicit);
    return out;
  }

  // ---- 炸惊模拟 (ZHAJING) ---------------------------------------------------------------------------
  //
  // Every getter below is null / empty unless `this.zhajing` (the mode flag, see the constructor). Nothing here is read
  // by an official mode, and no official mode's data carries the fields, so this block is inert for the vanilla four
  // difficulties (handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2 — the same shape as `annihilation`).

  /**
   * 炸惊模拟 规则9: the mode's blanket ×ATK / ×DEF / ×max HP on every operator the player fields, folded into the
   * operator's 白值 (shared/zhajingBase.js; server/sim/battle/players.js applies it to `unit.base`, the client's 干员调配
   * screen shows the same numbers). null for every other mode.
   * @returns {{ hp: number, def: number, atk: number } | null}
   */
  get allyScale() {
    if (!this.zhajing) return null;
    const a = this.mode.allyScale;
    if (!a || typeof a !== 'object') return null;
    const hp = Math.max(0, numOr(a.hp, 1));
    const def = Math.max(0, numOr(a.def, 1));
    const atk = Math.max(0, numOr(a.atk, 1));
    if (hp === 1 && def === 1 && atk === 1) return null;
    return { hp, def, atk };
  }

  /**
   * 炸惊模拟 规则1: per-bond layer cap of this mode (config modes[*].bondLayerCap; null ⇒ the global BOND_LAYER_CAP of
   * shared/constants.js, 999). Passed to the battle as `flags.bondLayerCap`.
   * @returns {number | null}
   */
  get bondLayerCap() { return this.zhajing ? posIntOr(this.mode.bondLayerCap, null) : null; }

  /** The mode's 特殊阶段 kind table (`config.modes[ZHAJING].spPhaseKinds`: round → 'jibian' | 'express' | 'bountyHigh'). */
  spPhaseKinds() {
    const m = this.mode.spPhaseKinds;
    return this.zhajing && m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  }

  /**
   * 炸惊模拟 规则5/6: which special phase a 机变 round runs — 'jibian' (惊变阶段: three 惊变 cards, pick one) or
   * 'express' (企鹅物流的快递, which replaces 悬赏决策) or 'bountyHigh'. null ⇒ the ordinary weighted draw over
   * choices.json's families (and null for every mode that is not ZHAJING).
   * @param {number} round
   * @returns {string | null}
   */
  spPhaseKind(round) {
    const map = this.spPhaseKinds();
    if (!map) return null;
    const v = map[String(round)];
    return typeof v === 'string' && v ? v : null;
  }

  /**
   * 规则5: the 惊变阶段's own rules — `cards` offered, `rarityWeights` (普通 45 / 稀有 25 / 史诗 20 / 传说 10, rolled
   * FIRST, then a random card of that rarity), `rerolls` (how often one offered card may be redrawn) and `pool` (the
   * cards themselves; empty until the data supplies them, and an empty pool makes the phase fall through to the prep).
   * null for every mode that is not ZHAJING (and for a ZHAJING mode without the block).
   */
  jibian() {
    if (!this.zhajing) return null;
    const j = this.mode.jibian;
    if (!j || typeof j !== 'object') return null;
    const weights = [];
    const w = j.rarityWeights && typeof j.rarityWeights === 'object' ? j.rarityWeights : {};
    // 我方惊变五档（隐秘 hidden 是 2026-10-25 加的一档）：权重键与卡面 rarity 都可能是 'hidden'，这里必须放行，
    // 否则抽卡时又回落整池、卡面品质与卡不符。
    for (const r of ['normal', 'rare', 'epic', 'legend', 'hidden']) {
      const v = Math.max(0, numOr(w[r], 0));
      if (v > 0) weights.push([r, v]);
    }
    const pool = Array.isArray(j.pool) ? j.pool.filter((c) => c && typeof c === 'object') : [];
    const base = weights.length ? weights : [['normal', 35], ['rare', 30], ['epic', 20], ['legend', 10], ['hidden', 5]];
    return {
      cards: posIntOr(j.cards, 3),
      rerolls: Math.max(0, Math.trunc(numOr(j.rerolls, 1))),
      rarityWeights: base,
      /**
       * 隐藏规则: a player with NO active core bond draws a 「带核心盟约的传说惊变」 at `noCoreBondLegendWeight` %
       * (default 30) instead of the plain legend share. Only that class of card is affected; every other card keeps
       * the rarityWeights draw (choices.jibianDraftCards).
       */
      noCoreBondLegendWeight: Math.max(0, Math.min(100, Math.round(numOr(j.noCoreBondLegendWeight, 30)))),
      pool,
    };
  }

  /**
   * 炸惊模拟 规则14: the 敌方惊变 drawn automatically at the start of round 1 and 6 — ONE card for the whole room, a
   * match-long global enemy buff. `rarityWeights` are rolled first, then a card of that rarity; an empty pool skips the
   * reveal and the round starts as before. null ⇒ the mode has no 敌方惊变 (every other difficulty, and a ZHAJING mode
   * without the block).
   * @returns {{ round: number, rounds: number[], rarityWeights: Array<[string, number]>, pool: any[], flickerMs: number, resultMs: number } | null}
   */
  enemyJibian() {
    if (!this.zhajing) return null;
    const j = this.mode.enemyJibian;
    if (!j || typeof j !== 'object' || j.enabled === false) return null;
    const weights = [];
    const w = j.rarityWeights && typeof j.rarityWeights === 'object' ? j.rarityWeights : {};
    for (const r of ['normal', 'rare', 'epic', 'legend']) {
      const v = Math.max(0, numOr(w[r], 0));
      if (v > 0) weights.push([r, v]);
    }
    const pool = Array.isArray(j.pool) ? j.pool.filter((c) => c && typeof c === 'object') : [];
    // 「1.6回合抽取敌方惊变」= 第 1 与第 6 回合各出一次（`rounds`）；`round` 保留兼容只写单回合的旧配置。
    const round = Math.max(1, Math.trunc(numOr(j.round, 1)));
    const rounds = Array.isArray(j.rounds)
      ? [...new Set(j.rounds.map((n) => Math.trunc(numOr(n, 0))).filter((n) => n >= 1))].sort((a, b) => a - b)
      : [];
    // 隐秘惊变 (owner 2026-10-24): the extra draw before the Hidden Core — ONE guaranteed 「隐秘」 rarity card from
    // `hidden.pool` PLUS one ordinary pool card, at the prep of `gd.hiddenRound`. A cleaned view like the rest, so a data
    // addition has to be passed through here explicitly or the phase silently sees nothing.
    const hiddenRaw = j.hidden && typeof j.hidden === 'object' ? j.hidden : null;
    const hidden = hiddenRaw ? {
      enabled: hiddenRaw.enabled !== false,
      label: typeof hiddenRaw.label === 'string' && hiddenRaw.label ? hiddenRaw.label : '隐秘惊变', // i18n-ignore: data label
      pool: Array.isArray(hiddenRaw.pool) ? hiddenRaw.pool.filter((c) => c && typeof c === 'object') : [],
      flickerMs: Math.max(0, Math.trunc(numOr(hiddenRaw.flickerMs, numOr(j.flickerMs, 3000)))),
      resultMs: Math.max(0, Math.trunc(numOr(hiddenRaw.resultMs, numOr(j.resultMs, 3000)))),
    } : null;
    return {
      round,
      rounds: rounds.length ? rounds : [round],
      rarityWeights: weights.length ? weights : [['normal', 45], ['rare', 25], ['epic', 20], ['legend', 10]],
      pool,
      flickerMs: Math.max(0, Math.trunc(numOr(j.flickerMs, 3000))),
      resultMs: Math.max(0, Math.trunc(numOr(j.resultMs, 3000))),
      hidden,
    };
  }

  /**
   * 规则6: the equips the 企鹅物流的快递 phase offers — the items carrying a `giveBondId`, i.e. the ones that turn a
   * 变形同构体 wearer into a member of their bond (转职). Repeatable, so the draw is with replacement.
   * @returns {string[]}
   */
  expressPool() {
    const list = this.zhajing ? this.mode.expressPool : null;
    if (!Array.isArray(list)) return [];
    const groups = this.expressGroups();
    // 用户 2026-10-11：维多利亚战锤合并成一格 —— 组标记（"group:xxx"）本身没有 item 记录，要按组放行
    return list.filter((id) => typeof id === 'string' && (this.item(id) || Array.isArray(groups[id])));
  }

  /** 规则6: the 快递池's 「组合格」 — `{ "group:victoriaHammer": [五种战锤 id] }`; one of them is drawn after the slot. */
  expressGroups() {
    const g = this.zhajing ? this.mode.expressGroups : null;
    return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
  }

  /** 规则6: how many equips the 快递 phase offers at once (default 6). */
  expressCards() { return posIntOr(this.zhajing ? this.mode.expressCards : null, 6); }

  /**
   * The record of the SAME operator in this mode's roster (`chess_zj_*` records, `baseId` pointing at themselves).
   *
   * `data/choices.json` pools are written with plain-modern ids (松果池 `pool_char_pinus`, 歌蕾蒂娅池
   * `pool_chess_glady`), and handing out a plain record inside 炸惊 gives a same-named piece whose `baseId` is
   * different — it can never merge into the elite of the zhajing card it sits next to ("三个灰毫放在一起没精锐").
   * Grant through this mapping instead (by charId + golden), which returns the id unchanged when it does not apply:
   * not zhajing, already a roster record, an unknown id, or no roster record for that character.
   * @param {string} id
   * @returns {string}
   */
  chessInRoster(id) {
    const rec = this.chess(id);
    if (!rec || !this.zhajing || rec.zhajing === true || !rec.charId) return id;
    if (!this._zjByChar) {
      const m = new Map();
      for (const [cid, c] of Object.entries(this._chess)) {
        if (!c || c.zhajing !== true || !c.charId) continue;
        m.set(`${c.charId}|${c.isGolden ? 1 : 0}`, cid);
      }
      this._zjByChar = m;
    }
    return this._zjByChar.get(`${rec.charId}|${rec.isGolden ? 1 : 0}`) || id;
  }

  /**
   * The 炸惊 block a battle needs (rides on `spec.flags`, exactly like `annihilationFlags`): the 白值 scale and the
   * mode's layer cap. null for every mode that is not ZHAJING — an official mode's flags object does not grow a key.
   * @returns {{ allyScale?: { hp: number, def: number, atk: number }, bondLayerCap?: number } | null}
   */
  zhajingFlags() {
    if (!this.zhajing) return null;
    const out = {};
    const as = this.allyScale;
    if (as) out.allyScale = as;
    const cap = this.bondLayerCap;
    if (cap) out.bondLayerCap = cap;
    return out;
  }

  // ---- 湮灭专属 mod（docs/ANNIHILATION-MODS.md §2.2）------------------------------------------------

  /**
   * One of the four RULE switches as THIS room reads it (docs/ANNIHILATION-MODS.md §2.2a). Precedence, lowest first:
   *   ① the official default — `RULE_SWITCHES[name].options[0]`;
   *   ② the mode's `annRules` (data-side; absent today);
   *   ③ the room's `annMods` (`true` = take `options[1]`);
   *   ④ the plugin content set's `rules[name]` — STRONGEST, so a content plugin keeps overriding whatever the room chose
   *      (the priority every existing plugin already relies on).
   * Only an ANNIHILATION match has ②/③; for every other mode this returns exactly what `ruleOption(contentRules, name)`
   * returned before, so the official four difficulties and 炸惊 are byte-identical.
   * @param {'shopBias'|'prepLoadout'|'morphPairing'|'unequip'} name
   * @returns {string} one of that switch's `options`
   */
  rulesOf(name) {
    const spec = Object.prototype.hasOwnProperty.call(RULE_SWITCHES, name) ? RULE_SWITCHES[name] : null;
    const fallback = spec ? spec.options[0] : null;
    if (!spec) return fallback;
    let value = fallback;
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY) {
      const fromMode = this._annRules && this._annRules[name];
      if (typeof fromMode === 'string' && spec.options.includes(fromMode)) value = fromMode;
      if (this.annMods[name] === true) value = spec.options[1];
    }
    // ④ the plugin content set wins — a declared option is validated by the plugin loader; an unrecognised one falls back.
    const fromContent = this._contentRules && this._contentRules[name];
    if (typeof fromContent === 'string' && spec.options.includes(fromContent)) return fromContent;
    return value;
  }

  /**
   * One of the four CONTENT mods (`egirBuff` / `commsPriority` / `rhodesShip` / `kazdelShip`) — booleans that are NOT
   * `RULE_SWITCHES` members, so reading them through `rulesOf` would always answer the official default and the mod would
   * be silently dead (docs/ANNIHILATION-MODS.md §2.2a: 「用 rulesOf 读永远是空（静默 bug）」).
   * 缺省：`ANN_MOD_DEFAULT_ON` 的两条（罗德岛 / 卡兹戴尔新盟约）**开**，其余关；房间的显式值（`true` / `false`）压过缺省，
   * 所以 `{ kazdelShip: false }` 能真的把它关掉（`normalizeAnnMods` 会把 `false` 留下来，见 server/lobby.js）。
   * @param {'egirBuff'|'commsPriority'|'rhodesShip'|'kazdelShip'|'comms'} name
   * @returns {boolean}
   */
  annMod(name) {
    if (this.mode.difficulty !== ANNIHILATION_DIFFICULTY) return false;
    return annModOn(this.annMods, name);
  }

  /**
   * The 蚀流 6 · 无尽湮灭 flag: the run has no last round, no toxic fog, no banned bonds and no weight on the random rolls.
   */
  get endless() { return this.mode.difficulty === ANNIHILATION_DIFFICULTY && this.erosion >= EROSION_ENDLESS; }

  /**
   * 蚀流 6 · 无尽湮灭 has no mode-imposed last round — the run ends only when every player is eliminated (the match's own
   * check). 蚀流 5 plays the extended 30-round table; every tier below it keeps the mode's own 19.
   */
  get lastRound() {
    if (this.endless) return null;
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY && this.erosion >= 5) return 30;
    if (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0) return this.mode.lastRound;
    return this.modeId === 'mode_single_funny' ? 9 : 14;
  }
  /**
   * The Final Assault round. 蚀流 5 moves it to R29 (R30, the run's last hidden core, follows it); 无尽湮灭 has no single
   * one to announce, so the view publishes the first chapter's — the per-round answer is bossRoundFor(r).
   */
  get bossRound() {
    if (this.endless) return ENDLESS_BASE_PAIRS[0][0];
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY && this.erosion >= 5) return 29;
    return Number.isInteger(this.mode.bossRound) && this.mode.bossRound > 0 ? this.mode.bossRound : this.lastRound;
  }
  /** The Hidden Core round (R30 at 蚀流 5; the first chapter's at 无尽湮灭 — the per-round answer is hiddenRoundFor(r)). */
  get hiddenRound() {
    if (this.endless) return ENDLESS_BASE_PAIRS[0][1];
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY && this.erosion >= 5) return 30;
    return Number.isInteger(this.mode.hiddenRound) && this.mode.hiddenRound > 0 ? this.mode.hiddenRound : null;
  }
  get maxShopLevel() { return posIntOr(this.mode.maxShopLevel, DEFAULTS.maxShopLevel); }

  /**
   * The boss / hidden-core queue of the run: each pair is one Final Assault followed by its Hidden Core. The match and the
   * public view walk it instead of comparing the single bossRound/hiddenRound, which is why 蚀流 3+ can have several
   * chapters: e1–2 one pair, e3–4 two, e5 four, 无尽湮灭 the four then one every 3 rounds (report §2.6).
   * A mode that is not ANNIHILATION keeps the one pair its bossRound/hiddenRound fields describe.
   * @returns {Array<[number, number]>}
   */
  bossHiddenPairs() {
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY) {
      if (this.endless) return this._endlessPairs();
      if (this.erosion >= 5) return ENDLESS_BASE_PAIRS.map((p) => p.slice());
      if (this.erosion >= 3) return EROSION_3_PAIRS.map((p) => p.slice());
      return this.bossRound && this.hiddenRound ? [[this.bossRound, this.hiddenRound]] : [[19, 20]];
    }
    return this.bossRound && this.hiddenRound ? [[this.bossRound, this.hiddenRound]] : [];
  }
  /**
   * 无尽湮灭's queue (memoised): 蚀流 5's four pairs, then one pair every ENDLESS_BOSS_EVERY rounds from the first round
   * after R30 — R30 is that tier's last hidden core, so the next Final Assault is R33 (Hidden Core R34), then R36/37 …
   * up to ENDLESS_PAIR_HORIZON. isLastHidden never calls the horizon the end and nextBossRound derives the next pair
   * arithmetically once the table runs out.
   * @returns {Array<[number, number]>}
   */
  _endlessPairs() {
    if (this._pairs) return this._pairs;
    const out = ENDLESS_BASE_PAIRS.map((p) => p.slice());
    const lastHidden = ENDLESS_BASE_PAIRS[ENDLESS_BASE_PAIRS.length - 1][1];
    for (let boss = lastHidden + ENDLESS_BOSS_EVERY; boss <= ENDLESS_PAIR_HORIZON; boss += ENDLESS_BOSS_EVERY) out.push([boss, boss + 1]);
    this._pairs = out;
    return out;
  }
  /** Memoised on the endless path: roundCfg / the public view ask these per round and the endless table is 194 pairs. */
  bossRounds() {
    if (this.endless) return (this._bossRounds ||= this._endlessPairs().map((p) => p[0]));
    return this.bossHiddenPairs().map((p) => p[0]);
  }
  hiddenRounds() {
    if (this.endless) return (this._hiddenRounds ||= this._endlessPairs().map((p) => p[1]));
    return this.bossHiddenPairs().map((p) => p[1]).filter((n) => Number.isInteger(n));
  }
  isBossRound(r) { return this.bossRounds().includes(Number(r)); }
  isHiddenRound(r) { return this.hiddenRounds().includes(Number(r)); }
  /** The Hidden Core behind Final Assault `bossRound` (null when that round opens no chapter). */
  hiddenAfter(bossRound) { const p = this.bossHiddenPairs().find((x) => x[0] === Number(bossRound)); return p ? p[1] : null; }
  /** The Final Assault after Hidden Core `hiddenRound` (null on the run's last chapter). */
  nextBossRound(hiddenRound) {
    const pairs = this.bossHiddenPairs();
    const i = pairs.findIndex((p) => p[1] === Number(hiddenRound));
    if (i >= 0 && pairs[i + 1]) return pairs[i + 1][0];
    // 无尽湮灭: past the materialised table the cadence continues arithmetically (hidden h → the boss of the next pair)
    if (this.endless && i >= 0) return Number(hiddenRound) - 1 + ENDLESS_BOSS_EVERY;
    return null;
  }
  /** Whether Hidden Core `r` closes the run. 无尽湮灭: never — a hidden core always leads on to the next boss. */
  isLastHidden(r) {
    if (this.endless) return false;
    const h = this.hiddenRounds();
    return h.length > 0 && Number(r) === h[h.length - 1];
  }
  /** The chapter round `r` belongs to ({ boss, hidden }): its own pair, else the next one still to come. */
  pairOfRound(r) {
    const n = Number(r) || 0;
    const pairs = this.bossHiddenPairs();
    for (const [boss, hidden] of pairs) {
      if (n === boss || n === hidden) return { boss, hidden };
      if (n < boss) return { boss, hidden };
    }
    const last = pairs[pairs.length - 1];
    if (!last) return null;
    // 无尽湮灭: the next pair after the table's last one, by the same cadence. Below it the queue simply has no round
    // after its last pair (the run ends at lastRound), so the last chapter is the answer.
    return this.endless ? { boss: last[0] + ENDLESS_BOSS_EVERY, hidden: last[1] + ENDLESS_BOSS_EVERY } : { boss: last[0], hidden: last[1] };
  }
  /** The Final Assault that closes the chapter round `r` is in (the public view's per-round bossRound). */
  bossRoundFor(r) { const p = this.pairOfRound(r); return p ? p.boss : this.bossRound; }
  /** The Hidden Core round of that chapter (the public view's per-round hiddenRound). */
  hiddenRoundFor(r) { const p = this.pairOfRound(r); return p ? p.hidden : this.hiddenRound; }

  /**
   * Every leader template the mode knows: its Final Assault leaders (rounds.19) and its Hidden Core ones (rounds.20)
   * merged into one map. 无尽湮灭 draws its leader from the whole pool, so every boss id has to resolve on every boss and
   * hidden-core round (waves.js buildBossWave falls back to the map's first entry otherwise).
   * @param {Record<string, any>} rounds
   * @returns {Record<string, any>}
   */
  _allBossTemplates(rounds) {
    const a = rounds && rounds['19'] && rounds['19'].bossTemplates && typeof rounds['19'].bossTemplates === 'object' ? rounds['19'].bossTemplates : {};
    const b = rounds && rounds['20'] && rounds['20'].bossTemplates && typeof rounds['20'].bossTemplates === 'object' ? rounds['20'].bossTemplates : {};
    return { ...a, ...b };
  }

  /**
   * The round level's config. The mode's data only carries R1–R20, so 湮灭模拟 repeats its chapters: every Final Assault
   * replays the R19 level and every Hidden Core the R20 one (carrying that chapter's own isBoss/isHidden marks), and the
   * normal rounds past R20 cycle the R14–R18 level set with combat / level time pinned to 115 s — that cycle is what
   * 无尽湮灭 runs on forever. A mode that is not ANNIHILATION gets its own row (or null) exactly as before.
   */
  roundCfg(r) {
    const rounds = this.mode.rounds;
    const base = rounds && typeof rounds === 'object' && rounds[String(r)] && typeof rounds[String(r)] === 'object' ? rounds[String(r)] : null;
    if (this.mode.difficulty !== ANNIHILATION_DIFFICULTY || !rounds || typeof rounds !== 'object') return base;
    const bossCfg = rounds['19'];
    const hiddenCfg = rounds['20'];
    if (this.isBossRound(r)) {
      if (this.endless && bossCfg) return { ...bossCfg, bossTemplates: this._allBossTemplates(rounds), isBoss: true, isHidden: false };
      if (Number(r) === 19) return bossCfg || base;
      if (bossCfg) return { ...bossCfg, isBoss: true, isHidden: false };
    }
    if (this.isHiddenRound(r)) {
      if (this.endless && hiddenCfg) return { ...hiddenCfg, bossTemplates: this._allBossTemplates(rounds), isBoss: true, isHidden: true };
      if (Number(r) === 20) return hiddenCfg || base;
      if (hiddenCfg) return { ...hiddenCfg, isBoss: true, isHidden: true };
    }
    // normal rounds from R21 on cycle the R14–R18 level set (蚀流 5 and the endless tail)
    if (this.erosion >= 5 && Number(r) >= 21) {
      const pick = rounds[String(14 + ((Number(r) - 21) % 5))] || rounds['16'];
      if (!pick || typeof pick !== 'object') return base;
      return { ...pick, bossTemplates: null, isBoss: false, isHidden: false, combatTimeLimit: 115, levelMaxPlayTime: 115, isSpPrepare: false };
    }
    return base;
  }

  /**
   * Whether round `r` opens a 决策 (the SP / 机变 draft) — the one question the match asks (phases.js through spRounds,
   * the public view's spRound flag, the test commands). 湮灭模拟 drafts after every even round, so the draft opens on the
   * odd round after it; a Hidden Core never has one (there is no prep board to draft for) while a Final Assault keeps it.
   * 无尽湮灭 keeps that cadence up to R29 and then opens one every ENDLESS_DECISION_EVERY rounds.
   * @param {number} r
   * @returns {boolean}
   */
  isSpRound(r) {
    const n = Number(r) || 0;
    if (this.mode.difficulty !== ANNIHILATION_DIFFICULTY) {
      return (Array.isArray(this.mode.spRounds) ? this.mode.spRounds : []).includes(n);
    }
    if (n < 3 || n % 2 !== 1) return false;
    if (this.endless) {
      if (n <= ENDLESS_DECISION_UNTIL) return true;
      return n > ENDLESS_DECISION_UNTIL + 1 && (n - ENDLESS_DECISION_UNTIL) % ENDLESS_DECISION_EVERY === 0;
    }
    if (this.isHiddenRound(n)) return false;
    return n < (this.hiddenRound || this.lastRound + 1);
  }

  /**
   * The 决策 rounds the mode knows. A mode that is not ANNIHILATION reads its own data list; 湮灭模拟 derives them, and the
   * list is bounded — 无尽湮灭's cadence never ends, so the live answer is isSpRound (this is for previews and tests).
   * @returns {number[]}
   */
  spRounds() {
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY) {
      if (this.endless) {
        const out = [];
        for (let r = 3; r <= ENDLESS_DECISION_UNTIL; r += 2) out.push(r);
        for (let r = ENDLESS_DECISION_UNTIL + ENDLESS_DECISION_EVERY; r <= ENDLESS_PAIR_HORIZON; r += ENDLESS_DECISION_EVERY) out.push(r);
        return out;
      }
      const end = this.hiddenRound || this.lastRound + 1;
      const out = [];
      for (let r = 3; r < end; r += 2) out.push(r);
      return out;
    }
    const listed = Array.isArray(this.mode.spRounds) ? this.mode.spRounds.filter((n) => Number.isInteger(n)) : [];
    // 炸惊模拟: `spPhaseKinds` 本身就是回合表。data 只写 kind 表而漏写 `spRounds` 时，特殊阶段永远不进门
    // （phases.js 用 `spRounds().includes(round)` 判断入口）—— 这是「静默失效」的典型，所以这里从 kind 表派生。
    if (!listed.length) {
      const kinds = this.spPhaseKinds();
      if (kinds) return Object.keys(kinds).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    }
    return listed;
  }

  upgradePrices() {
    const arr = Array.isArray(this.mode.upgradePrices) ? this.mode.upgradePrices : DEFAULTS.upgradePrices;
    return arr.map((v) => Math.max(0, numOr(v, 99)));
  }

  /** Base price to go from `level` to level+1 (null at max). */
  upgradeBase(level) {
    if (level >= this.maxShopLevel) return null;
    const arr = this.upgradePrices();
    return arr[level - 1] ?? 99;
  }

  shopSlots(level) {
    const s = this.mode.shopSlots && this.mode.shopSlots[String(level)];
    const d = DEFAULTS.shopSlots[level] || DEFAULTS.shopSlots[6];
    if (!s || typeof s !== 'object') return { ...d };
    const chess = Number.isInteger(s.chess) && s.chess >= 0 ? s.chess : d.chess;
    const item = Number.isInteger(s.item) && s.item >= 0 ? s.item : d.item;
    return { chess: Math.min(chess, 8), item: Math.min(item, 4) };
  }

  /** Real-second prep timer for round r (null = untimed). */
  prepTime(r) {
    const rc = this.roundCfg(r);
    if (!rc) return this.isSolo ? null : 90;
    const v = rc.prepTime;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** The round level's `maxPlayTime` (config rounds[r].combatTimeLimit) as data gives it — REAL seconds. */
  combatTimeLimitReal(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.combatTimeLimit : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    const m = this.mode.combatTimeLimit && this.mode.combatTimeLimit[String(r)];
    return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 60;
  }

  /**
   * Combat time limit of round r in GAME seconds (what the Battle and 联防 use): maxPlayTime × the forced battle speed
   * (config.combatTimeScale, default COMBAT_TIME_SCALE 2). `maxPlayTime` counts real seconds of the 2× battle: read
   * as game seconds, the rounds' own spawn schedules would not fit (R2 spawns its last flyer at 43 s of a 45 s limit,
   * R3 at 62 s of 55 s — enemies that can never be killed, or never spawn), while × 2 every limit is ≈ the last spawn +
   * one flyer crossing (R2 43 + 44 ≈ 90, R3 62 + 44 ≈ 110, R5 38 + 67 ≈ 110). docs/BALANCE.md §2.1.
   */
  combatTimeLimit(r) {
    return this.combatTimeLimitReal(r) * this.combatTimeScale;
  }

  /** Game seconds per real second of a battle (config.combatTimeScale, default COMBAT_TIME_SCALE 2). */
  get combatTimeScale() {
    const k = numOr(this.config.combatTimeScale, COMBAT_TIME_SCALE);
    return k > 0 ? k : COMBAT_TIME_SCALE;
  }

  /**
   * The boss round level's `maxPlayTime` (config rounds[r].levelMaxPlayTime, 120) in REAL seconds — the countdown of
   * the Final Assault / Hidden Core. It is not a hard stop there ("计时结束后战斗仍然会继续", research 01 §10); null
   * when the data has none.
   */
  bossLevelTime(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.levelMaxPlayTime : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    // 业主 2026-10-20：超限的 Boss 轮（R20/25/30…）在 config 里没有自己的回合行，
    // 沿用 R14 最终攻势的 120 秒，并按档位每往后一档 +10 秒（R20=120、R25=130、R30=140…）。
    // 这条分支以前是死代码（F1：gd.overlimit 从未置位）→ bossRounds 拿到 null → deadline=0，
    // 超限 Boss 轮顶栏没有倒计时，而 150 真实秒后 LP 照扣。现在由 Match 传 overlimit 点亮。
    if (this.overlimit) {
      // 只给**真正的无限 Boss 轮**（R16 起每 5 回合；R20/25/30…）合成时钟，规则与
      // infiniteWaves.isInfiniteBossRound 一致。R16–R19 这类普通轮必须是 null（它们有自己的战斗时限，
      // 读这里会凭空多出一个「Boss 关倒计时」）。
      const rr = Math.round(Number(r) || 0);
      if (!(rr >= 16 && rr % 5 === 0)) return null;
      const base = this.bossLevelTimeBase();
      if (!(base > 0)) return null;
      const step = Math.max(0, Math.floor((rr - 20) / 5));
      return base + step * 10;
    }
    return null;
  }

  /** 超限 Boss 轮的基准时限：取最终攻势那一关的 levelMaxPlayTime（config rounds[bossRound]）。 */
  bossLevelTimeBase() {
    const rc = this.roundCfg(this.bossRound || 14);
    const v = rc ? rc.levelMaxPlayTime : undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 120;
  }

  /**
   * Official enemy multipliers of round r (config enemyScale: the PRTS table + 终极 speed ×1.15 from R3). `supplyHpMul`
   * (only when ≠ 1: co-op 终极 R5–R15) = the share of hpMul from 补给线 / 补给线II (config `supplyHp`), effects whose
   * `enemy_exclude` leaves out the 14 器物 hit-count keys — they take hpMul / supplyHpMul (archetypes.js `times`).
   */
  baseEnemyScale(r) {
    // 超限模拟（界面上叫「绝境模拟」）的 R1–R15 用**绝境**的数值曲线（业主 2026-10-19）。
    // 它的 modeId 在真实超限房里已经是 mode_single_abyss / mode_multi_abyss（大厅传 difficulty: ABYSS），
    // 但工具 / 测试路径会拿 HARD 造超限局：HARD 的曲线是每 4 回合跳一档、R1 只有 ×0.8，
    // 打起来前 15 回合几乎不涨；绝境是 R1 ×1.2、几乎每回合都在涨，才配得上「超限」。
    // 只查**同队型**的绝境表（单人 mode_single_abyss / 同盟 mode_multi_abyss）：
    // 同盟不会拿到单人的数值，缺表时退回本模式自己的表（不凭空造表）。
    const table = this.overlimit ? (this.overlimitEnemyScale() || this.mode.enemyScale) : this.mode.enemyScale;
    const e = table && table[String(r)];
    if (!e || typeof e !== 'object') return { hpMul: 1, atkMul: 1, speedMul: 1 };
    const supply = numOr(e.supplyHp, 1);
    return {
      hpMul: Math.max(0.01, numOr(e.hp, 1)),
      atkMul: Math.max(0, numOr(e.atk, 1)),
      speedMul: Math.max(0.01, numOr(e.speed, 1)),
      ...(supply > 0 && supply !== 1 ? { supplyHpMul: supply } : {}),
    };
  }

  /**
   * 超限用的绝境曲线表：**同队型**的 mode_single_abyss / mode_multi_abyss（config.modes）。
   * 缺表（数据裁剪 / 老版本）返回 null，调用方退回本模式自己的 enemyScale。
   * @returns {Record<string, object> | null}
   */
  overlimitEnemyScale() {
    const modes = this.config && this.config.modes && typeof this.config.modes === 'object' ? this.config.modes : null;
    const rec = modes && modes[this.isSolo ? 'mode_single_abyss' : 'mode_multi_abyss'];
    const table = rec && rec.enemyScale;
    return table && typeof table === 'object' ? table : null;
  }

  /** Enemy multipliers of round r = the official table (baseEnemyScale; no custom multiplier), except 湮灭模拟. */
  enemyScale(r) {
    // 湮灭模拟/蚀流: attack 1.2^e, health 1.25^e (solo) / 1.3^e (alliance), ×1.2 from 蚀流 3 (the tier's +20 % rule).
    // The mode's static enemyScale table stops at R20 and would flatten out past it, so the exponent ladder replaces the
    // table outright — erosionExponent is the R1–R30 table plus its endless tail (one step every two rounds). Speed keeps
    // the base mode's "×1.15 from R3". A mode that is not ANNIHILATION never enters this branch.
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY) {
      const atkE = erosionExponent(r);
      const hpE = erosionExponent(r, !this.isSolo);
      const boost = this.erosion >= 3 ? 1.2 : 1;
      return {
        hpMul: Math.pow(this.isSolo ? 1.25 : 1.3, hpE) * boost,
        atkMul: Math.pow(1.2, atkE) * boost,
        speedMul: Number(r) >= 3 ? 1.15 : 1,
      };
    }
    const base = this.baseEnemyScale(r);
    // 业主 2026-10-21 曾提过「超限每回合 ×1.19 补血量」，但那是一条**不能接**的阶梯，已删除：
    // 接上开关后实测 hpMul = 3.5832 × 1.19^(r−1) —— R16 ×48.7、R20 ×97.6、R60 ×102,690，
    // 而同一份数据上 R16+ 真正在用的 enemyInfiniteScale 是 ×3.80 / ×4.80 / ×33.73
    // （docs/proposals/OVERLIMIT.md §1.5，本次修复的临时探针复测一致）。
    // R16+ 的敌人曲线由 infiniteWaves 自己乘 enemyInfiniteScale（普通波与 Boss 波都乘），
    // 所以这里返回官方表就是设计口径：表只到 R15，R16+ 即 ×1（Boss 随从 flags.enemyScale 也读这条）。
    return base;
  }

  timer(key) {
    const t = this.config.timers && this.config.timers[key];
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : DEFAULTS.timers[key] ?? 10;
  }

  get lpCapPerRound() { return posIntOr(this.config.lpCapPerRound, DEFAULTS.lpCapPerRound); }
  /**
   * Boss overtime (`bossTurnHpReduceTime` 150 / 1 LP per second): a server turn timer of turnInfoDataDict like
   * prepPhaseTime, so REAL seconds on the same clock as the boss level's 120 s maxPlayTime (combat limits are real
   * seconds, docs/BALANCE.md §2.1) — the level countdown runs out first, the battle continues, and the merged team LP
   * drains 1 per real second from the 150 s mark (research 01 §10, 06 §11.7). Read as game seconds the drain would
   * start at 75 real s (45 s before the countdown ends) at 2 LP per real second.
   */
  get bossOvertimeAfterReal() { return Math.max(0, numOr(this.config.bossOvertimeAfter, DEFAULTS.bossOvertimeAfter)); }
  /** Team LP drained per REAL second of overtime. */
  get bossOvertimeDrainReal() { return Math.max(0, numOr(this.config.bossOvertimeDrainPerSec, DEFAULTS.bossOvertimeDrainPerSec)); }
  /** Overtime start in GAME seconds of a boss field clock (150 real s × the forced 2× = 300). */
  get bossOvertimeAfter() { return this.bossOvertimeAfterReal * this.combatTimeScale; }
  /** Team LP drained per GAME second of overtime (1 per real second = 0.5 per game second). */
  get bossOvertimeDrain() { return this.bossOvertimeDrainReal / this.combatTimeScale; }
  /**
   * Team LP the overtime drain has taken when a boss field clock reads `gt` game seconds: bossOvertimeDrainReal per
   * whole REAL second past bossOvertimeAfterReal (the first point at 151 real s).
   */
  bossOvertimeDue(gt, afterReal = this.bossOvertimeAfterReal) {
    const over = (Number(gt) || 0) / this.combatTimeScale - afterReal;
    return over >= 1 ? Math.floor(over) * this.bossOvertimeDrainReal : 0;
  }
  get dp() {
    const d = this.config.dp && typeof this.config.dp === 'object' ? this.config.dp : {};
    return { dpInit: numOr(d.init, 10), dpPerSec: numOr(d.perSec, 1), dpMax: numOr(d.max, 99) };
  }
  get unite() {
    const u = this.config.unite && typeof this.config.unite === 'object' ? this.config.unite : {};
    return {
      maxHelpers: posIntOr(u.maxHelpers, DEFAULTS.unite.maxHelpers),
      templates: u.templates && typeof u.templates === 'object' ? u.templates : DEFAULTS.unite.templates,
    };
  }
  /**
   * factions.generation with the mode's own overrides merged over it — every rule in server/match/waves.js reads this one
   * object (specialEnemyNum types among the involveRandom ones, maxLevelCnt round slots). A mode without an override hands
   * back factions.generation itself, so an official mode's generation is byte-identical to before.
   * 湮灭模拟: 4 enemy types and 20 round slots, 5 / 30 from 蚀流 5, and 无尽湮灭 fields every randomizable type.
   */
  get generation() {
    const base = this.factions && this.factions.generation && typeof this.factions.generation === 'object' ? this.factions.generation : {};
    const over = this.mode.generation && typeof this.mode.generation === 'object' ? this.mode.generation : null;
    if (this.mode.difficulty !== ANNIHILATION_DIFFICULTY) return over ? { ...base, ...over } : base;
    const g = over ? { ...base, ...over } : { ...base };
    if (this.endless) {
      // 无尽湮灭: 怪物种类增加至所有怪物种类 — every randomizable type, every round
      const types = this.factions && this.factions.types && typeof this.factions.types === 'object' ? this.factions.types : {};
      const all = Object.values(types).filter((t) => t && t.involveRandom).length;
      return { ...g, maxLevelCnt: 30, specialEnemyNum: Math.max(1, all) };
    }
    return { ...g, maxLevelCnt: this.erosion >= 5 ? 30 : 20, specialEnemyNum: this.erosion >= 5 ? 5 : 4 };
  }

  get hiddenCore() {
    const h = this.config.hiddenCore && typeof this.config.hiddenCore === 'object' ? this.config.hiddenCore : {};
    return {
      single: numOr(h.single, DEFAULTS.hiddenCore.single),
      multi: numOr(h.multi, DEFAULTS.hiddenCore.multi),
      minTeamLpExclusive: numOr(h.minTeamLpExclusive, DEFAULTS.hiddenCore.minTeamLpExclusive),
      difficulties: Array.isArray(h.difficulties) ? h.difficulties : DEFAULTS.hiddenCore.difficulties,
    };
  }
  /**
   * Bond bans of a difficulty. 无尽湮灭 bans nothing (所有盟约干员不禁用); the 蚀流 tiers derive the counts from the mode's
   * own eligible pool instead of the fixed 5/7 of config.bans:
   *   蚀流 1–4  core / addon = ceil(total / 3), never below 5
   *   蚀流 5    core / addon = ceil(total / 2), no floor — the largest pressure the ladder knows
   * "core" is the whole core catalogue, "addon" every add-on bond except 绝技 (suntShip); pool.js drawDisabledBonds
   * samples from the same eligible pool, so the fraction and the draw agree.
   */
  bans(difficulty) {
    if (this.endless) return { core: 0, addon: 0 };
    if (this.mode.difficulty === ANNIHILATION_DIFFICULTY) {
      const core = this.bondIds.filter((id) => { const bond = this.bond(id); return !!(bond && bond.isCore); }).length;
      const addon = this.bondIds.filter((id) => { const bond = this.bond(id); return !!(bond && !bond.isCore && id !== 'suntShip'); }).length;
      const divisor = this.erosion >= 5 ? 2 : 3;
      const count = (n) => Math.max(divisor === 3 ? 5 : 0, Math.ceil(n / divisor));
      return { core: count(core), addon: count(addon) };
    }
    const b = this.config.bans && this.config.bans[difficulty];
    const d = DEFAULTS.bans[difficulty] || { core: 0, addon: 0 };
    if (!b || typeof b !== 'object') return { ...d };
    return { core: Number.isInteger(b.core) && b.core >= 0 ? b.core : d.core, addon: Number.isInteger(b.addon) && b.addon >= 0 ? b.addon : d.addon };
  }
  get bandDraft() {
    const b = this.config.bandDraft && typeof this.config.bandDraft === 'object' ? this.config.bandDraft : {};
    return {
      skipsPerPlayer: Number.isInteger(b.skipsPerPlayer) && b.skipsPerPlayer >= 0 ? b.skipsPerPlayer : DEFAULTS.bandDraft.skipsPerPlayer,
      timeoutBandId: typeof b.timeoutBandId === 'string' && this.band(b.timeoutBandId) ? b.timeoutBandId : this.defaultBandId,
    };
  }

  /**
   * Bosses weights for the boss round / hidden round. 无尽湮灭: 全随机 — the data's own weights are ignored and every leader
   * the merged table can field is equally likely, because the run keeps drawing leaders for hundreds of rounds.
   */
  bossWeights(hidden = false) {
    if (this.endless) {
      const rounds = this.mode.rounds && typeof this.mode.rounds === 'object' ? this.mode.rounds : null;
      return (rounds ? Object.keys(this._allBossTemplates(rounds)) : []).filter((id) => this.boss(id)).map((id) => [id, 1]);
    }
    const w = hidden ? this.mode.hiddenBossWeights : this.mode.bossWeights;
    return w && typeof w === 'object' ? Object.entries(w).filter(([id, v]) => this.boss(id) && Number(v) > 0) : [];
  }

  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
    // 惊变专属策略（data/bands.json `zjOnly: true`，例如「祀」）：只在炸惊模拟里出现（其他难度完全看不到）
    if (b.zjOnly === true && !this.zhajing) return false;
    const list = Array.isArray(b.modeTypeList) ? b.modeTypeList : null;
    if (!list) return true;
    return list.includes(this.isSolo ? 'SINGLE' : 'MULTI');
  }

  bandIds() {
    const bands = this.raw.bands && typeof this.raw.bands === 'object' ? this.raw.bands : {};
    return Object.keys(bands).filter((id) => this.bandAllowed(id)).sort((a, b) => numOr(bands[a].sortId, 99) - numOr(bands[b].sortId, 99) || (a < b ? -1 : 1));
  }

  startLp(bandId) {
    const b = this.band(bandId);
    return b && Number.isInteger(b.totalHp) && b.totalHp > 0 ? b.totalHp : this.defaultStartLp;
  }

  /**
   * The bonds a strategy's mechanic is built around (DESIGN §21.26): bands.json `bondIds`, written at build time by
   * shared/bandBonds.js from the band's own text and blackboards (潘格尼尼 → 拉特兰, 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔 …) —
   * the field the strategy draft's 本局禁用 mark reads too. Known bond ids in data order; [] for an unknown band, one tied to
   * no bond (华法琳, 阿米娅 …) or data without the field. The bot never picks a strategy tied to a bond the mode switches
   * off (bot.js botPickBand).
   * @param {string} bandId
   * @returns {string[]}
   */
  bandBondIds(bandId) {
    if (this._bandBonds.has(bandId)) return this._bandBonds.get(bandId);
    const listed = this.band(bandId)?.bondIds;
    const set = new Set(Array.isArray(listed) ? listed : []);
    const out = Object.freeze(this.bondIds.filter((id) => set.has(id)));
    this._bandBonds.set(bandId, out);
    return out;
  }

  /**
   * Placeable (hand) tokens a chess sends to the hand when placed on the board: [{ tokenId, count }] — its manually
   * deployable summons (tokens.json `placeable`: 医疗探机, 诅咒娃娃, 海嗣, 狼群, 流形, 爬行号·防护单元; user playtest #6)
   * that the chess makes under `loadout` ({ skillIndex } from shared/protocol.js resolveLoadout; absent ⇒ its default
   * skill): the owner variant's `sources` (`bySkill[skillIndex]` for a non-default skill) name a talent or a skill —
   * 赫默 / 巫恋 on S1 make no drone / doll. `count` = the summon's deploy limit (PRTS 卫戍协议/帮助 "根据召唤物部署数量
   * 上限（非初始持有量），发送等量召唤物至手牌区": 凯瑟琳 2 of her 3 devices).
   */
  placeableTokens(chessId, loadout = null) {
    const c = this.chess(chessId);
    if (!c || !Array.isArray(c.tokens)) return [];
    const out = [];
    for (const tid of c.tokens) {
      const t = this.token(tid);
      if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
      const vs = t.variants && typeof t.variants === 'object' ? t.variants : {};
      const v = vs[chessId] ?? vs[String(chessId).replace(/_b$/, '_a')] ?? null;
      if (v) {
        const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
        const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
        if (!src.includes('talent') && !src.includes('skill')) continue;
      }
      const count = posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1));
      out.push({ tokenId: tid, count: Math.min(count, 9) });
    }
    return out;
  }
}
