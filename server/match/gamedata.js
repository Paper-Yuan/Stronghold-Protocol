// server/match/gamedata.js — typed, defaulted view of data/*.json for the match engine.
//
// Every lookup is an own-property lookup (ids come from client intents) that never throws and returns null for
// unknown ids. Tunables come from data/config.json with the documented defaults (research 00-INDEX §2–§8) when a
// key is missing, so a partial data set (tests, data being regenerated) still yields a working match.
//
// No custom balance (DESIGN §14 corrections, research 08 §6): enemy numbers are the official ones — the PRTS
// per-round enemyScale table of data/config.json, the leader pool = bloodPoint. data/tuning.json only overrides result
// titles:
//   titles[titleId]                                                { stat?, rule? } merged over config.titles
// (the former enemyHpMul / enemyAtkMul / enemySpeedMul / bossHpMul / flyPlaceholders knobs were removed; a tuning file
// that still carries them is ignored).

import { getConfig, getMode } from '../data.js';
import { isShopItem } from '../sim/simdata.js';
import {
  bondLayerCapOf, endlessBaseOf, ENDLESS_BOSS_CYCLE_SCALE, ENDLESS_BOSS_EVERY, ENDLESS_BOSS_STEP, ENDLESS_ENEMY_CYCLE_BOOST,
  ENDLESS_SP_EVERY, isEndlessDifficulty, isEndlessModeId,
} from '../../shared/constants.js';

const own = (map, id) => (map && typeof map === 'object' && typeof id === 'string' && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null);
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

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
  bans: { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 } },
  bandDraft: { skipsPerPlayer: 1, timeoutBandId: 'band_bldsk' },
  leftoverFundsKeptByBands: ['band_cannot'],
});

/** Game seconds per real second of a battle (forced 2×): combat limits in data are real seconds (combatTimeLimit). */
export const COMBAT_TIME_SCALE = 2;

/** Strip the _a/_b suffix of an item id (the registry key of an item family). */
export const itemKey = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   */
  constructor(data, modeId) {
    this.raw = data && typeof data === 'object' ? data : {};
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    this.mode = getMode(modeId, this.raw) || {};
    this.economy = this.config.economy && typeof this.config.economy === 'object' ? this.config.economy : {};
    const chess = this.raw.chess && typeof this.raw.chess === 'object' ? this.raw.chess : {};
    this._chess = chess;
    this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
    this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
    /** visible, shop-eligible base (normal) chess ids */
    this.visibleChess = Object.keys(chess).filter((id) => {
      const c = chess[id];
      return c && c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
    }).sort();
    /**
     * Shop item ids by tier (sim/simdata.js isShopItem: normal EQUIP, not hidden, not effect-only — the special
     * 维式重锤 and 突变细胞 are never sold). Every "shop item" draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId).
     */
    this.shopItemsByTier = {};
    for (const [id, it] of Object.entries(this._items)) {
      if (!isShopItem(it)) continue;
      (this.shopItemsByTier[it.tier] ||= []).push(id);
    }
    for (const k of Object.keys(this.shopItemsByTier)) this.shopItemsByTier[k].sort();
    this.bondIds = Object.keys(this._bonds).sort((a, b) => (numOr(this._bonds[a].identifier, 99) - numOr(this._bonds[b].identifier, 99)) || (a < b ? -1 : 1));
    this.modeInactiveBonds = new Set(Array.isArray(this.mode.inactiveBondIds) ? this.mode.inactiveBondIds : []);
    /** bandBondIds memo */
    this._bandBonds = new Map();
    this.inactiveEnemies = new Set(Array.isArray(this.mode.inactiveEnemyKeys) ? this.mode.inactiveEnemyKeys : []);
    /** data/tuning.json (titles only, see the header) */
    this.tuning = this.raw.tuning && typeof this.raw.tuning === 'object' ? this.raw.tuning : {};
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
   * Official shared leader HP pool (DESIGN §20.10): ONE pool for every boss field of the match (official tip "最终攻势中，
   * 所有人将一起对敌方领袖造成伤害"; the mirrored copies of a pair field share it — notice 5114 "两侧的敌方领袖共享生命值
   * （敌方领袖的总生命值不变）", which is about those copies, not about the number of players). Co-op = bloodPoint
   * [difficulty]; with config bossHpScale.aliveScaling (default false) × alive / aliveFull (4) — 巴哈姆特 12294 "聯機隊友
   * (撤退/死掉)變少，最後boss血條也會變少" is one community note without a proportion, kept off until confirmed (it would
   * shorten fights after eliminations, the opposite of the playtest report); `aliveCount` omitted ⇒ a full team. Solo = bloodPoint ×
   * bossHpScale.solo (0.25 = one player of four, [ASSUMED]). Leaders are never scaled by enemyScale ("领袖单位于服务器的
   * 生命值加成不受上述加成影响").
   * @param {string} bossId
   * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
   * @returns {number}
   */
  bossPoolHp(bossId, aliveCount) {
    const boss = this.boss(bossId);
    const diff = this.difficulty;
    let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
    if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
    if (base == null) base = 500000;
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount)));
  }

  /**
   * Multiplier of bloodPoint for the leader pool (see bossPoolHp): solo = bossHpScale.solo (0.25); co-op = coop (1) ×
   * min(alive, aliveFull) / aliveFull when bossHpScale.aliveScaling (mode entry first, then the global one).
   * @param {number} [aliveCount]
   */
  bossPoolShare(aliveCount) {
    const ms = this.mode.bossHpScale && typeof this.mode.bossHpScale === 'object' ? this.mode.bossHpScale : {};
    const cs = this.config.bossHpScale && typeof this.config.bossHpScale === 'object' ? this.config.bossHpScale : {};
    const pick = (k, d) => (Number.isFinite(ms[k]) && ms[k] > 0 ? ms[k] : Number.isFinite(cs[k]) && cs[k] > 0 ? cs[k] : d);
    if (this.isSolo) return pick('solo', 0.25);
    const scaling = typeof ms.aliveScaling === 'boolean' ? ms.aliveScaling : cs.aliveScaling === true;
    const full = Math.max(1, Math.floor(pick('aliveFull', 4)));
    const n = Number(aliveCount);
    const alive = scaling && Number.isFinite(n) && n >= 1 ? Math.min(full, Math.floor(n)) : full;
    return pick('coop', 1) * (alive / full);
  }

  /**
   * bosses.json `bloodPoint` 取哪一档作为血池基准。无尽模式的难度名 ENDLESS 不在 bloodPoint 的键里，
   * 所以模式条目带了 `bloodPointDifficulty`（默认 NORMAL）指明基准档；其它模式就是自身难度。
   */
  get bossBloodPointDifficulty() {
    return typeof this.mode.bloodPointDifficulty === 'string' && this.mode.bloodPointDifficulty
      ? this.mode.bloodPointDifficulty
      : this.difficulty;
  }

  /**
   * 无尽模式：Boss 血池随 Boss 周期成长的倍率（第 n 次 Boss 战 = 基础 × bossCycleScale^(n-1)）。
   * Boss 序号按 endlessBossIndex（第 14 回合第 1 次，其后每 7 回合一次）。非无尽模式恒为 1（原有血池数值完全不变）。
   */
  endlessBossPoolScale(round) {
    if (!this.isEndless) return 1;
    const idx = this.endlessBossIndex(round);
    if (idx < 1) return 1;
    const k = numOr(this.mode.bossCycleScale, ENDLESS_BOSS_CYCLE_SCALE);
    return Math.pow(k > 1 ? k : ENDLESS_BOSS_CYCLE_SCALE, idx - 1);
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
  bond(id) { return own(this._bonds, id); }
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
    if (c && Number.isFinite(c.price) && c.price >= 0) return c.price;
    const tier = this.tierOf(id);
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    const golden = c && c.isGolden;
    if (row && typeof row === 'object') return numOr(golden ? row.golden : row.normal, DEFAULTS.chessPrice[tier] ?? 3);
    return DEFAULTS.chessPrice[tier] ?? 3;
  }

  sellPrice(id) {
    const c = this.chess(id);
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
  get equipPerChess() { return posIntOr(this.economy.equipPerChess, DEFAULTS.equipPerChess); }
  get maxArtsPerRound() { return posIntOr(this.economy.maxArtsPerRound, DEFAULTS.maxArtsPerRound); }
  get goldenCopies() { return posIntOr(this.economy.goldenCopies, DEFAULTS.goldenCopies); }
  get itemMergeCount() { return posIntOr(this.economy.itemMergeCount, DEFAULTS.itemMergeCount); }
  get leftoverKeptBands() { return Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands; }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      count: posIntOr(r.count, DEFAULTS.rewardOffer.count),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /** Copies of a base chess in the shared pool. */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    if (ov && typeof ov === 'object' && Number.isInteger(ov[baseId]) && ov[baseId] >= 0) return ov[baseId];
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = pc && typeof pc === 'object' ? pc[tier] : undefined;
    return Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
  }

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

  get isSolo() { return this.mode.type === 'SINGLE' || /^mode_single_/.test(this.modeId || ''); }
  get difficulty() { return this.mode.difficulty || (this.modeId ? String(this.modeId).split('_').pop().toUpperCase() : 'NORMAL'); }

  /**
   * 无尽模式 (ENDLESS)：回合无限、波次循环、强度外推、周期性 Boss。运行时规则见 shared/constants.js 的 ENDLESS 段，
   * 数据条目由 tools/endlessMode.mjs 生成。非无尽模式一律走原有逻辑（本类中所有 isEndless 分支都不影响它们）。
   */
  get isEndless() { return isEndlessDifficulty(this.mode.difficulty) || isEndlessModeId(this.modeId); }
  /** 无尽模式**第一次** Boss 的回合（前 14 回合保持官方节奏）。 */
  get endlessBossFirst() { return posIntOr(this.mode.bossFirst, ENDLESS_BOSS_EVERY); }
  /** 无尽模式：第一次 Boss 之后，Boss 与「+1/3 强化」的周期（回合数，默认 7）。 */
  get endlessBossStep() { return posIntOr(this.mode.bossStep, ENDLESS_BOSS_STEP); }
  /** 兼容别名：第一次之后的周期。 */
  get endlessBossEvery() { return this.endlessBossStep; }
  /**
   * 无尽模式：截至回合 r **已经发生**的 Boss 次数（第 14 回合第 1 次，其后每 7 回合一次；未到第一次为 0）。
   * Boss 血池成长与「每次 Boss 后 +1/3」阶梯都按它取档。注意它**不等于** isBossRound：
   * R14–R20 都返回 1（第一次 Boss 已发生），但只有 R14 本身是 Boss 回合。
   */
  endlessBossIndex(r) {
    const n = Number(r);
    if (!Number.isInteger(n)) return 0;
    const first = this.endlessBossFirst;
    if (n < first) return 0;
    return Math.floor((n - first) / this.endlessBossStep) + 1;
  }

  get lastRound() {
    if (this.isEndless) return 0; // 0 = 无限回合（哨兵值；客户端据此显示 ∞）
    if (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0) return this.mode.lastRound;
    return this.modeId === 'mode_single_funny' ? 9 : 14;
  }
  get bossRound() {
    if (this.isEndless) return this.endlessBossFirst; // 第一次 Boss 的回合（其后每 endlessBossStep 回合一次）
    return Number.isInteger(this.mode.bossRound) && this.mode.bossRound > 0 ? this.mode.bossRound : this.lastRound;
  }
  get hiddenRound() {
    if (this.isEndless) return null; // 无尽模式没有隐秘核心
    return Number.isInteger(this.mode.hiddenRound) && this.mode.hiddenRound > 0 ? this.mode.hiddenRound : null;
  }
  get maxShopLevel() { return posIntOr(this.mode.maxShopLevel, DEFAULTS.maxShopLevel); }

  /**
   * 回合 r 是否为 Boss 回合：无尽模式第 14 回合起每 7 回合一次（14、21、28…）；其它模式 = bossRound / hiddenRound。
   */
  isBossRound(r) {
    const n = Number(r);
    if (!Number.isInteger(n) || n < 1) return false;
    if (this.isEndless) {
      if (n < this.endlessBossFirst) return false;
      return (n - this.endlessBossFirst) % this.endlessBossStep === 0;
    }
    return n === this.bossRound || n === this.hiddenRound;
  }

  /**
   * 无尽模式把回合 r 映射到官方回合表的键：
   *   · 前 `endlessBossFirst`(14) 回合直接用表里的同一回合（表必须撑满这 14 回合）；
   *   · 之后每个 `endlessBossStep`(7) 回合的周期复用表的最后 7 个回合 —— R8–R13 的终局段高阶波次 + R14 的 Boss 配置，
   *     于是第 14、21、28… 回合都取到 Boss 配置。非无尽模式不使用本函数。
   */
  endlessWaveKey(r) {
    const first = this.endlessBossFirst;
    const n = Number(r);
    if (!Number.isInteger(n) || n < 1) return 1;
    if (n <= first) return n;
    const step = this.endlessBossStep;
    const pos = ((n - first - 1) % step) + 1;   // 1..step
    if (pos === step) return first;             // Boss 回合 → 表的 Boss 键
    return first - (step - 1) + (pos - 1);      // 普通回合 → 表尾的 (step-1) 个高阶回合
  }

  roundCfg(r) {
    const rounds = this.mode.rounds;
    if (!rounds || typeof rounds !== 'object') return null;
    let key = String(r);
    // 无尽模式：超出配置的回合按上面的规则循环复用（第 14、21、28… 回合都取到 Boss 配置）。
    if (!rounds[key] && this.isEndless) {
      const n = Number(r);
      if (Number.isInteger(n) && n > 0) key = String(this.endlessWaveKey(n));
    }
    const rc = rounds[key];
    return rc && typeof rc === 'object' ? rc : null;
  }

  spRounds() {
    if (this.isEndless) return []; // 无尽模式的机变回合由 isSpRound 周期计算
    return Array.isArray(this.mode.spRounds) ? this.mode.spRounds.filter((n) => Number.isInteger(n)) : [];
  }

  /** 回合 r 是否为机变阶段：无尽模式每 ENDLESS_SP_EVERY 回合一次（Boss 回合除外）。 */
  isSpRound(r) {
    const n = Number(r);
    if (!Number.isInteger(n) || n < 1) return false;
    if (this.isEndless) return !this.isBossRound(n) && n % ENDLESS_SP_EVERY === 0;
    return this.spRounds().includes(n);
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
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** Official enemy multipliers of round r (config enemyScale: the PRTS table + 终极 speed ×1.15 from R3). */
  baseEnemyScale(r) {
    const e = this.mode.enemyScale && this.mode.enemyScale[String(r)];
    if (!e || typeof e !== 'object') return { hpMul: 1, atkMul: 1, speedMul: 1 };
    return {
      hpMul: Math.max(0.01, numOr(e.hp, 1)),
      atkMul: Math.max(0, numOr(e.atk, 1)),
      speedMul: Math.max(0.01, numOr(e.speed, 1)),
    };
  }

  /**
   * Enemy multipliers of round r. The official table for r ≤ its last round; beyond it a normal mode has no numbers
   * (returns 1×), while 无尽模式 keeps growing with the official formula below.
   * 无尽模式在此之上再叠加「每 14 关 +1/3 基础属性」的阶梯（endlessCycleBoost）。
   */
  enemyScale(r) {
    const base = this.baseEnemyScale(r);
    if (!this.isEndless) return base;
    const sc = (this.mode.enemyScale && this.mode.enemyScale[String(r)]) ? base : this.endlessEnemyScale(r);
    return this.endlessCycleBoost(sc, r);
  }

  /**
   * 无尽模式：**第一次 Boss 之后**每经过 `endlessBossStep`(7) 关，怪物「血量 / 攻击」再加强
   * 「基础难度属性的 1/3」—— 第 1–20 关 ×1、第 21–27 关 ×4/3、第 28–34 关 ×5/3 ……
   * 与官方公式外推**叠加**（先算外推再乘本阶梯）。移动速度不变（官方第 15 关后已封顶 1.15）。
   * 非无尽模式恒为原值。
   * @param {{hpMul:number, atkMul:number, speedMul:number}} sc
   * @param {number} r 回合
   */
  endlessCycleBoost(sc, r) {
    const steps = Math.max(0, this.endlessBossIndex(r) - 1);
    if (!steps) return sc;
    const m = 1 + steps * this.endlessEnemyCycleBoost;
    return { hpMul: sc.hpMul * m, atkMul: sc.atkMul * m, speedMul: sc.speedMul };
  }

  /** 每 7 关怪物血量/攻击的加强比例（mode.enemyCycleBoost 可覆盖，默认 1/3）。 */
  get endlessEnemyCycleBoost() {
    const v = numOr(this.mode.enemyCycleBoost, ENDLESS_ENEMY_CYCLE_BOOST);
    return v >= 0 ? v : ENDLESS_ENEMY_CYCLE_BOOST;
  }

  /**
   * 无尽模式：超出官方 enemyScale 表之后的强度外推。沿用官方生成公式
   * `atk = atkBase · 1.1^kAtk`、`hp = hpBase · 1.2^kHp`，其中 kAtk / kHp 按官方表尾部的斜率继续线性增长
   * （表里 mode_*_normal 的 kAtk 从 R1 的 0 增到 R14 的 7，即每回合 ≈0.538）。速度不加成。
   */
  endlessEnemyScale(r) {
    const table = this.mode.enemyScale && typeof this.mode.enemyScale === 'object' ? this.mode.enemyScale : null;
    if (!table) return { hpMul: 1, atkMul: 1, speedMul: 1 };
    const keys = Object.keys(table).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    if (!keys.length) return { hpMul: 1, atkMul: 1, speedMul: 1 };
    const first = keys[0];
    const last = keys[keys.length - 1];
    const e0 = table[String(first)] || {};
    const e1 = table[String(last)] || e0;
    const span = Math.max(1, last - first);
    const dKAtk = (numOr(e1.kAtk, 0) - numOr(e0.kAtk, 0)) / span;
    const dKHp = (numOr(e1.kHp, 0) - numOr(e0.kHp, 0)) / span;
    const over = Math.max(0, Number(r) - last);
    const kAtk = numOr(e1.kAtk, 0) + over * dKAtk;
    const kHp = numOr(e1.kHp, 0) + over * dKHp;
    // atk(first) = atkBase · 1.1^kAtk(first) ⇒ atkBase = atk(first) / 1.1^kAtk(first)（hp 同理）
    const atkBase = numOr(e0.atk, 1) / Math.pow(1.1, numOr(e0.kAtk, 0));
    const hpBase = numOr(e0.hp, 1) / Math.pow(1.2, numOr(e0.kHp, 0));
    return {
      hpMul: Math.max(0.01, hpBase * Math.pow(1.2, kHp)),
      atkMul: Math.max(0, atkBase * Math.pow(1.1, kAtk)),
      speedMul: 1,
    };
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
  bossOvertimeDue(gt) {
    const over = (Number(gt) || 0) / this.combatTimeScale - this.bossOvertimeAfterReal;
    return over >= 1 ? Math.floor(over) * this.bossOvertimeDrainReal : 0;
  }
  get dp() {
    const d = this.config.dp && typeof this.config.dp === 'object' ? this.config.dp : {};
    return { dpInit: numOr(d.init, 10), dpPerSec: numOr(d.perSec, 1), dpMax: numOr(d.max, 99) };
  }
  /** 本局盟约层数上限：无尽 9999，其余 999（shared/constants.js bondLayerCapOf；唯一按模式分流的入口）。 */
  get bondLayerCap() {
    return bondLayerCapOf(this.isEndless);
  }
  /** 传给 Battle 的 flags：DP 三件套 + 本局盟约层数上限（客户端由 spec.flags 拿到同一个值）。 */
  get simFlags() {
    return { ...this.dp, bondLayerCap: this.bondLayerCap };
  }
  get unite() {
    const u = this.config.unite && typeof this.config.unite === 'object' ? this.config.unite : {};
    return {
      maxHelpers: posIntOr(u.maxHelpers, DEFAULTS.unite.maxHelpers),
      templates: u.templates && typeof u.templates === 'object' ? u.templates : DEFAULTS.unite.templates,
    };
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
   * 本局的盟约禁用数（config.bans，键 = 难度名）。无尽模式的难度名是 `ENDLESS_<底难度>`，不在表里：
   * 回退到它底难度那一档（无尽·终极 → ABYSS 的 3/4，无尽·标准 → FUNNY 的 0/1），使四档无尽像四档常规一样有区别。
   * 常规难度不受影响（endlessBaseOf 返回 null，就是自身）。
   */
  bans(difficulty) {
    const base = endlessBaseOf(difficulty);
    const b = (this.config.bans && (this.config.bans[difficulty] || (base && this.config.bans[base]))) || null;
    const d = DEFAULTS.bans[difficulty] || (base && DEFAULTS.bans[base]) || { core: 0, addon: 0 };
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

  /** Bosses weights for the boss round / hidden round. */
  bossWeights(hidden = false) {
    const w = hidden ? this.mode.hiddenBossWeights : this.mode.bossWeights;
    return w && typeof w === 'object' ? Object.entries(w).filter(([id, v]) => this.boss(id) && Number(v) > 0) : [];
  }

  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
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

// bossPoolShareOf: taken from v0.2.3:server/match/gamedata.js during the v0.2.3 narrow merge (upstream code imports it).
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
