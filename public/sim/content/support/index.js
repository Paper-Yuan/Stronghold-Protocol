// server/sim/content/support/index.js — shared helpers of content wave B (bonds, garrisons, items, bands, choices).
//
// Battle side and prep side read the same frozen game data (server/data.js). Everything here is pure and deterministic;
// battle helpers only go through the public Battle API (docs/SIM.md §6). Wave-B submodules import from this file and
// never edit it; module-specific helpers live in the submodules.
//
// Conventions shared by every wave-B module (details in docs/CONTENT.md):
//   * Attribute bonuses ("+X%" ATK / DEF / max HP) from bonds, bands, equipment, 机变 cards and the per-layer 特质 are
//     "直接乘算" (PRTS 盟约记录; PRTS 游戏数据基础: 直接乘算 values are summed with every other 直接乘算, a skill's "攻击力+X%"
//     included) → `directMods({ atk, def, hp })` = the additive `atkPct` / `defPct` / `hpPct` (constants.js
//     DIRECT_BONUS_STACKING; 'multiply' restores the v2.5 per-source ×(1 + x) `atkMul`). "提升至X%" effects stay
//     multipliers. ASPD stays additive (`aspd`), damage bonuses are `dmgDealtMul`, redeploy changes `redeployMul`.
//   * Match-long passives use `passiveBuff()` (persist + allowDead + replace): idempotent by key, survive death.
//   * Buff keys / fx `src` are namespaced: `bond:<bondId>…`, `item:<itemKey>…`, `gar:<effectKey>…`, `band:<bandId>…`,
//     `choice:<effectId>…`.
//   * IN_BATTLE layer gains go through `gainLayers()` (requireActive, per-source per-battle caps, 魔王-compatible source).
//   * Prep-side facts a battle needs (hand size, operators gained this round, teammates' bands …) arrive in
//     `PlayerBattleInput.contentInfo`, written by the `global:contentb_info` meta handler (support/meta.js).

import { getData } from '../../../data.js';
import { grantedBondsByMorph } from '../../../../shared/plugins/rules.js';
import { RECORD_MAPS } from '../../../../shared/plugins/dataUtils.js';
import { equipComboBonds } from '../../../../shared/zjBonds.js';
// 湮灭内容开关的缺省表（整备侧 gamedata 与这里共用一份；见 shared/annihilation-constants.js 的注释）
import { annModOn as annModOnShared } from '../../../../shared/annihilation-constants.js';
import { COLS, DIRECT_BONUS_STACKING } from '../../constants.js';
import { frontOf, offsetTile } from '../../dir.js';
import { bodyInKeys, bodyDist, bodyInRadius, bodyOnTile, bodyTileReach, bodyInRange } from '../../body.js';

export { COLS };
/** Where an enemy can be hit (a huge enemy's whole hit rectangle, sim/body.js) — for every range test on enemies. */
export { bodyInKeys, bodyDist, bodyInRadius, bodyOnTile, bodyTileReach };

// =====================================================================================================================
// numbers & data

/** Finite number from a number or numeric string, else `d`. */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
const own = (o, k) => (o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

let DATA = null;
/** Frozen data/*.json (process singleton of server/data.js). Never mutate. */
export function gameData() {
  if (!DATA) {
    try { DATA = getData({ log: QUIET }) || {}; } catch { DATA = {}; }
  }
  return DATA;
}
/** Tests only: swap the data object (null → reload the singleton). Also drops derived caches. */
export function setGameData(d) { DATA = d ?? null; CORE = null; EFFECT_ITEMS = new WeakMap(); }

// =====================================================================================================================
// 炸惊模拟的盟约 / 装备视图 (shared/zjBonds.js)
//
// 战斗模拟读的是**进程级单例** `gameData()`（服务端 server/data.js，浏览器是抓下来的 /data/*.json），它不知道房间
// 难度。所以炸惊房间的 Battle 在构造、装内容与每一步推进时临时装上自己的视图，`bondRecord` / `itemRecord` 优先读它；
// 普通房间的视图是 null，读到的仍是单例原样。JS 是单线程的、一步 `step()` 跑完才返回，同一进程里并行的其它难度房间
// 不会读到这份视图（`withZjView` 用 try/finally 复原，嵌套时按栈还原）。
//
// 视图的形状：`{ bonds?, combos? }` —— `bonds` 是合并后的 bonds.json 映射（`zj` 覆盖块已合并），`combos` 是炸惊
// 专用「装备组合激活盟约」表（zjEquipCombos）。

let ZJ = null;
/** Install (or clear, with null) the 炸惊 view. Prefer `withZjView`; this is for tests. */
export function setZjView(v) { ZJ = v && typeof v === 'object' ? v : null; }
/** The 炸惊 view in effect, or null. */
export function zjView() { return ZJ; }
/** Run `fn()` with `view` installed as the 炸惊 view, restoring the previous one afterwards. */
export function withZjView(view, fn) {
  const prev = ZJ;
  ZJ = view && typeof view === 'object' ? view : null;
  try { return fn(); } finally { ZJ = prev; }
}

export const bondRecord = (id) => own((ZJ && ZJ.bonds) || gameData().bonds, id);
export const itemRecord = (id) => own(gameData().items, id);
export const garrisonRecord = (id) => own(gameData().garrisons, id);
export const bandRecord = (id) => own(gameData().bands, id);
/** Behaviour identity, while the concrete record still supplies all numbers. */
export const bandEffectId = id => bandRecord(id)?.effectRef ?? id;
export const effectRecord = (id) => own(gameData().effects, id);
export const chessRecord = (id) => own(gameData().chess, id);
/** Registry key of an item: id without the `_a` / `_b` suffix (Arts have none). */
export const itemKeyOf = (id) => String(itemRecord(id)?.effectRef ?? id ?? '').replace(/_[ab]$/, '');
/** True for golden (进阶) items / elite chess ids. */
export const isGoldenId = (id) => /_b$/.test(String(id ?? ''));

/**
 * Whether `data` (default: the loaded data) is another official version's build (config.version, data/versions/*;
 * DESIGN §35.22.3). Only such data finds hand-written behaviour by charId / effectId: the default data and the plugin
 * content sets built on it carry no config.version and keep the by-id lookups of before versions M0, so a plugin that
 * patches an official record's charId or effectId changes that record, not which kit or item behaviour runs.
 */
export const isVersionData = (data = gameData()) => !!(data && typeof data === 'object' && data.config?.version);

/** Historical season-one semantics; absent version metadata always means today's rules. */
export const isFirstPeriod = (data = gameData()) => isVersionData(data) && data.config.season === 'act1autochess';

/**
 * Whether `id` names an official record of data file `file` (`chess`, `items` …), not a plugin's namespaced one
 * (shared/plugins/dataUtils.js RECORD_MAPS: chess_x_ / item_x_ …).
 */
export const isOfficialId = (file, id) => !String(id ?? '').startsWith(`${RECORD_MAPS[file]?.[0] ?? '\0'}_`);

/**
 * The behaviour of an item is named by the normal record's effectId (versions M0, docs/SIM.md §7.2): another official
 * version reuses item ids for other effects, while an effectId keeps its meaning. A golden record (effectId
 * eff_acgarmNNN) counts as its normal one (baseId); a plugin record follows its effectRef; a plugin record without one
 * (item_x_) has no official behaviour (null). itemKeyOf stays the item's identity (combo partners, buff keys, labels).
 * The dispatchers use it on another version's build only (isVersionData); the default data keeps the item key.
 */
export function itemEffectKey(id) {
  let rec = itemRecord(id);
  if (!rec) return null;
  if (rec.effectRef != null) rec = itemRecord(rec.effectRef);
  else if (!isOfficialId('items', rec.id ?? id)) return null;
  if (rec && rec.baseId && rec.baseId !== rec.id) rec = itemRecord(rec.baseId);
  return typeof rec?.effectId === 'string' ? rec.effectId : null;
}

/**
 * Ids of the official item records of `items` ({ id: record }) whose behaviour is `effectId` (itemEffectKey), in data
 * order: no plugin record (item_x_, or one that carries an effectRef — it copies its base's effectId). `normalOnly`
 * drops the golden records.
 */
export function officialItemIdsWithEffect(items, effectId, { normalOnly = false } = {}) {
  const out = [];
  if (!items || typeof items !== 'object' || typeof effectId !== 'string') return out;
  for (const [id, rec] of Object.entries(items)) {
    if (!rec || typeof rec !== 'object' || rec.effectRef != null || !isOfficialId('items', id)) continue;
    const golden = !!rec.baseId && rec.baseId !== id;
    if (golden ? !normalOnly && own(items, rec.baseId)?.effectId === effectId : rec.effectId === effectId) out.push(id);
  }
  return out;
}

let EFFECT_ITEMS = new WeakMap();
/** officialItemIdsWithEffect over the loaded data (gameData()), cached per data object. */
export function itemIdsWithEffect(effectId, { normalOnly = false } = {}) {
  const d = gameData();
  let m = EFFECT_ITEMS.get(d);
  if (!m) { m = new Map(); EFFECT_ITEMS.set(d, m); }
  const k = `${normalOnly ? 'n' : 'a'}:${effectId}`;
  if (!m.has(k)) m.set(k, Object.freeze(officialItemIdsWithEffect(d.items, effectId, { normalOnly })));
  return m.get(k);
}

/** 突变细胞's effect: 凯瑟琳's one-cell allowance (bands/meta.js, server/match/player/prep.js) counts its normal records. */
export const MUTATION_CELL_EFFECT = 'eff_acarm072';
/** 突变细胞's normal record in the default data: data without config.version (isVersionData) counts it by this id. */
export const MUTATION_CELL_ID = 'chess_item_5_08_e_a';
/**
 * The 突变细胞 ids 凯瑟琳's one-cell allowance counts in `data`: MUTATION_CELL_ID, or on another version's build the
 * official normal records of MUTATION_CELL_EFFECT (上半: chess_item_6_08_e_a).
 */
export const mutationCellIds = (data = gameData()) => (isVersionData(data)
  ? officialItemIdsWithEffect(data.items, MUTATION_CELL_EFFECT, { normalOnly: true }) : [MUTATION_CELL_ID]);
/** Whether item `id` is a 突变细胞 the allowance counts (mutationCellIds). */
export function isMutationCell(id, data = gameData()) {
  if (!isVersionData(data)) return id === MUTATION_CELL_ID;
  const rec = own(data.items, id);
  return !!rec && rec.effectRef == null && isOfficialId('items', id) && rec.effectId === MUTATION_CELL_EFFECT;
}

/**
 * Buffs of a data record (bond / item / band / effect / garrison-like) as `{ key, bbKey, p }` where `key` is the
 * buff key, `bbKey` the `bbStr.key` (battle rune key, may be null) and `p = { ...bb, ...bbStr }`.
 */
export function buffsOf(rec) {
  const out = [];
  for (const b of (rec && Array.isArray(rec.buffs) ? rec.buffs : [])) {
    if (!b || typeof b !== 'object') continue;
    out.push({ key: b.key ?? null, bbKey: b.bbStr && typeof b.bbStr.key === 'string' ? b.bbStr.key : null, p: { ...(b.bb || {}), ...(b.bbStr || {}) } });
  }
  return out;
}

/** `{ ...bb, ...bbStr }` of the first buff of `rec` whose key or bbStr.key equals `key` (or matches a RegExp), else null. */
export function buffParams(rec, key) {
  for (const b of buffsOf(rec)) {
    const hit = key instanceof RegExp ? key.test(b.key ?? '') || key.test(b.bbKey ?? '') : b.key === key || b.bbKey === key;
    if (hit) return b.p;
  }
  return null;
}

let CORE = null;
/** Core (核心, isPower) bond ids. */
export function coreBondIds() {
  if (!CORE) {
    CORE = new Set();
    for (const [id, b] of Object.entries(gameData().bonds || {})) if (b && b.isCore) CORE.add(id);
  }
  return CORE;
}
export const isCoreBond = (id) => coreBondIds().has(id);

// =====================================================================================================================
// battle: players & bonds (live: in-battle layer gains update `battle.getPlayer(pid).bonds[id].layers`)

export const player = (battle, pid) => (battle && pid != null ? battle.getPlayer(pid) : null);
/** Live bond state `{ count, active, tier, layers }` of a player, or null. */
export function bondState(battle, pid, bondId) {
  const b = player(battle, pid)?.bonds?.[bondId];
  return b && typeof b === 'object' ? b : null;
}
/** Tier reached (0 when inactive). */
export function bondTier(battle, pid, bondId) {
  const b = bondState(battle, pid, bondId);
  return b && b.active ? Math.max(1, Math.floor(num(b.tier, 1))) : 0;
}
export const bondActive = (battle, pid, bondId, minTier = 1) => bondTier(battle, pid, bondId) >= minTier;
/** Live layers (also while the bond is inactive). */
export const bondLayers = (battle, pid, bondId) => Math.max(0, num(bondState(battle, pid, bondId)?.layers, 0));
/** Ids of the player's active bonds. */
export function activeBondIds(battle, pid) {
  const out = [];
  const bonds = player(battle, pid)?.bonds;
  if (bonds && typeof bonds === 'object') for (const [id, b] of Object.entries(bonds)) if (b && b.active) out.push(id);
  return out;
}
/** Active bond with the most layers (ties → data order); null when none is active. */
export function topActiveBond(battle, pid) {
  let best = null, bl = -1;
  for (const id of Object.keys(gameData().bonds || {})) {
    if (!bondActive(battle, pid, id)) continue;
    const l = bondLayers(battle, pid, id);
    if (l > bl) { bl = l; best = id; }
  }
  return best;
}

/** Prep-side facts for this player's battle (support/meta.js `global:contentb_info`), or {} when absent (tests). */
export function contentInfo(battle, pid) {
  const ci = player(battle, pid)?.input?.contentInfo;
  return ci && typeof ci === 'object' ? ci : {};
}
/** Alive players' bands (own first), plus a retained Touch team grant; falls back to this battle's players. */
export function matchBands(battle, pid) {
  const mb = contentInfo(battle, pid).matchBands;
  if (Array.isArray(mb) && mb.length) return mb.map(bandEffectId);
  return (battle.players || []).map((p) => bandEffectId(p.bandId)).filter(Boolean);
}

// =====================================================================================================================
// battle: units, membership, items

const EMPTY = Object.freeze([]);
export const isOp = (u) => !!u && u.kind === 'op';
export const onField = (u) => !!u && u.alive && u.deployed;
/** Elite (精锐) chess. */
export const isElite = (u) => !!(u && u.def && (u.def.golden || isGoldenId(u.def.id)));
/** Shop tier (阶) of an operator (tokens: their summoner's tier, else 1). */
export function tierOf(u) {
  if (!u) return 1;
  if (u.kind === 'op') return Math.max(1, Math.floor(num(u.def?.tier ?? u.def?.raw?.tier, 1)));
  if (u.ownerUnit) return tierOf(u.ownerUnit);
  return 1;
}
/**
 * "地面干员": a melee-position (地面位, deploy class MELEE) operator, whatever tile it stands on — the official vocabulary
 * names the deploy class, not the tile (game data: this mode's map card 「可以部署高台干员和地面干员的地面」, 「可将高台干员
 * 部署于其上」, 「所有地面干员阻挡数+2」; PRTS corrected 琴柳's 地面干员 to 地面位干员). Read by 不屈, the 战栗维式重锤 proc and
 * 休谟斯 回收利用 (community report 「不屈盟约效果高台干员也错误的吃到了」, 0.1.3). The tile (`unit.ground`) stays what the
 * enemies' 地面单位 targeting reads.
 */
export const isGroundOp = (u) => isOp(u) && u.def?.position === 'MELEE';
/** Base (normal) chess id of an operator (normal and elite share it). */
export const baseChessId = (u) => u?.def?.baseId ?? String(u?.defId ?? '').replace(/_b$/, '_a');

/** Equipment ids carried by a unit (golden ids when merged). */
export const itemsOf = (u) => (u && Array.isArray(u.items) ? u.items : EMPTY);
export const hasItemKey = (u, key) => itemsOf(u).some((id) => itemKeyOf(id) === key);
export const goldenItemCount = (u) => itemsOf(u).filter(isGoldenId).length;

const BONDS = new WeakMap();

/**
 * Whether this battle runs 湮灭模拟 (`difficulty: 'ANNIHILATION'`) — the one gate every annihilation-only content rule
 * in the sim reads (官方四档与炸惊一律 false). The mode ids are that mode's two `config.modes` entries
 * (`mode_single_annihilation` / `mode_multi_annihilation`); an explicit `battle.flags.annihilation === true` is accepted
 * too, so a derived field / a test can open the same gate.
 * @param {any} battle
 */
export function isAnnihilationBattle(battle) {
  if (!battle) return false;
  if (battle.flags && battle.flags.annihilation === true) return true;
  return /^mode_(single|multi)_annihilation$/.test(String(battle.modeId || ''));
}

/**
 * 湮灭模拟内容开关（房间级 `annMods`）的战斗侧读法：**显式 boolean 压过缺省**，缺省表在
 * `shared/annihilation-constants.js`（`rhodesShip` / `kazdelShip` 默认开）。engine-core 只在房间有显式键时才下发
 * `flags.annMods`，所以「没动过设置的湮灭局」这里读到的 m 是 undefined —— 缺省必须在这里兜住，否则默认开启的
 * 两条盟约在真实对局里会**静默空转**（面板显示开、战斗里没效果，且没有任何报错）。
 * 官方四档 / 炸惊先被模式门挡住，读不到这个键。
 * @param {any} battle @param {string} name
 */
export const annModOn = (battle, name) => {
  if (!battle || !isAnnihilationBattle(battle)) return false;
  const m = battle.flags ? battle.flags.annMods : null;
  return annModOnShared(m, name);
};

/**
 * `chess[].annBonds` 里**真正生效**的那几条：模式门（`isAnnihilationBattle`）之后，每条按**自己的开关**判
 * （`rhodesShip` / `kazdelShip` 各有一个，不是一个总开关）。开关全关 ⇒ `[]`，效果与本字段不存在时逐字节相同。
 * @param {any} battle @param {any} def
 * @returns {string[]}
 */
export function annBondsFor(battle, def) {
  if (!isAnnihilationBattle(battle)) return EMPTY;
  const extra = annBondsOf(def);
  if (!extra.length) return EMPTY;
  return extra.filter((b) => typeof b === 'string' && b && annModOn(battle, b));
}

/** `chess[].annBonds` of a def — the 湮灭模拟-only extra bonds (the caller's gate keeps them out of every other mode). */
export const annBondsOf = (def) => (Array.isArray(def?.raw?.annBonds) ? def.raw.annBonds
  : Array.isArray(def?.annBonds) ? def.annBonds : EMPTY);

/**
 * 内容模块给**某个单位**追加的盟约成员资格（`u.mem.extraBonds`）—— 不是数据字段，是战斗期的一条声明：
 * 写它的模块负责在部署 / 开局把名单刷对（幂等），本文件只负责让 `unitBonds` / `isMember` / `bondMembers`
 * 认这份名单。原版三条来源（棋子自己的 bonds、变形同构体配对、湮灭 annBonds）一条都不走这条路径，所以没人写它时
 * 「这一格」的值逐字节等于改动前。
 *
 * 唯一的使用者：超限词条 FGO-SP 的[万色悠滞之核]（server/sim/content/overlimitRelics.js）——「携带该装备的
 * 我方干员视作拥有 [调和] 盟约」。它不能写成装备记录的 `giveBondId`：那条路要求同时挂着变形同构体（
 * shared/plugins/rules.js grantedBondsByMorph），而词条原文是无条件的；所以由词条本体在战斗侧声明。
 * @param {any} u @returns {string[]}
 */
export function extraBondsOf(u) {
  const list = u && u.mem && Array.isArray(u.mem.extraBonds) ? u.mem.extraBonds : null;
  if (!list || !list.length) return EMPTY;
  return list.filter((b) => typeof b === 'string' && b);
}

/**
 * A unit's own bonds: the chess's data bonds + bonds granted by 变形同构体 (an item with `canGiveBond` worn together
 * with an item that has a `giveBondId`; same rule as server/match/bondsMeta.js pieceBonds). Tokens / enemies: [].
 * Pass `battle` to let the 湮灭模拟 content switches join in (`chess[].annBonds`, each behind its own switch); a caller
 * that omits it gets exactly today's result (the cache key records which variant an entry holds).
 */
export function unitBonds(u, battle = null) {
  if (!isOp(u)) return EMPTY;
  const cached = BONDS.get(u);
  const items = itemsOf(u);
  const plus = u.player?.morphPairing === 'plus';
  const ann = annBondsFor(battle, u.def);
  // 内容模块追加的成员资格（extraBondsOf）：进缓存键，否则「先按无这份名单查过一次」的缓存会盖住后来的声明。
  const extra = extraBondsOf(u);
  // The official key stays items.join('|'), so a cached official result is unchanged (a 炸惊 view never shares a cache
  // entry with a normal battle: the `zj|` prefix; the 湮灭 variant carries the enabled switch names for the same reason).
  const key = (ZJ ? 'zj|' : '') + (ann.length ? `ann:${ann.join(',')}|` : '') + (extra.length ? `extra:${extra.join(',')}|` : '')
    + (plus ? 'plus|' : '') + items.join('|');
  if (cached && cached.key === key) return cached.bonds;
  const out = [...(Array.isArray(u.def?.bonds) ? u.def.bonds : Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : [])];
  // 湮灭模拟: `chess[].annBonds` — 罗德岛 / 卡兹戴尔 这类「只在该模式、且开了对应开关时挂到这个棋子身上」的盟约。
  // 每条按自己的开关判（见 annBondsFor）；开关全关时这里一条都不会进，其它模式连字段都读不到。
  for (const b of ann) if (!out.includes(b)) out.push(b);
  // 内容模块声明的成员资格（见 extraBondsOf）：只收数据里真的存在的盟约。
  for (const b of extra) if (bondRecord(b) && !out.includes(b)) out.push(b);
  for (const b of grantedBondsByMorph(items, (id) => itemRecord(id), { mode: plus ? 'plus' : 'official', bondOk: (id) => !!bondRecord(id) })) {
    if (!out.includes(b)) out.push(b);
  }
  // 炸惊模拟：装备组合激活盟约（shared/zjBonds.js zjEquipCombos）——原版 `giveBondId` 之外的另一条路，
  // 只在装了炸惊视图的战斗里生效（普通战斗 ZJ 为 null）。
  if (ZJ && Array.isArray(ZJ.combos) && ZJ.combos.length && items.length) {
    for (const id of equipComboBonds(items, ZJ.combos)) if (bondRecord(id) && !out.includes(id)) out.push(id);
  }
  const bonds = Object.freeze(out);
  BONDS.set(u, { key, bonds });
  return bonds;
}

/**
 * Does `u` receive the effects of `bondId`? Own bonds (incl. 变形同构体 grants), and — 调和 (maniShip) — an operator
 * of the 调和 bond enjoys every core bond while 调和 is active (research 02 §2.1; callers still check the core bond is
 * active themselves).
 */
export function isMember(battle, u, bondId) {
  const own = unitBonds(u, battle);
  if (own.includes(bondId)) return true;
  // 炸惊模拟 惊变 two cross-module rules (the cards themselves live in content/jibian.js, engine-cards; the battle side
  // asks through hasJibian, so the sim never imports the card registry):
  //   「Belua multorum es capitums.」(jibian_duoshouyeshou): the holder's 若叶睦 counts as a 调和 member;
  //   「炎国人会飞」(jibian_yanrenhuifei): the holder's 【炎】 operators count as 突袭 members.
  // Both are false in a room without those cards (and in every mode that is not ZHAJING, which has no 惊变 at all).
  const zjMortis = !own.includes('maniShip') && hasJibian(battle, u.ownerId, 'jibian_duoshouyeshou')
    && /^chess_zj_mortis_/.test(String(u?.def?.raw?.chessId ?? ''));
  if (bondId === 'maniShip' && zjMortis) return true;
  if (bondId === 'raidShip' && own.includes('yanShip') && hasJibian(battle, u.ownerId, 'jibian_yanrenhuifei')) return true;
  return isCoreBond(bondId) && (own.includes('maniShip') || zjMortis) && bondActive(battle, u.ownerId, 'maniShip');
}

/**
 * Whether player `pid` of `battle` owns 惊变 card `effectId` (炸惊模拟). The data lives in
 * `battle.players[].playerEffects` (`key` = `jibian:<effectId>`, written by the match's choices.applyCard), so every
 * battle-side module can ask directly — **never import the 惊变 module from the sim** (that would drag the whole card
 * registry into every battle). Always false outside a room that drafted 惊变 (an official mode has no such refs).
 * @param {any} battle @param {any} pid @param {string} effectId
 * @returns {boolean}
 */
export function hasJibian(battle, pid, effectId) {
  if (pid == null || !effectId) return false;
  for (const ps of (battle && battle.players) || []) {
    if (!ps || ps.playerId !== pid) continue;
    for (const ref of ps.playerEffects || []) {
      if (ref && ref.key === `jibian:${effectId}`) return true;
    }
  }
  return false;
}

/**
 * Operators (optionally tokens) of player `pid` that receive `bondId`'s effects.
 * opts: { fieldOnly = false (alive & deployed only), tokens = false }
 */
export function bondMembers(battle, pid, bondId, { fieldOnly = false, tokens = false } = {}) {
  const out = [];
  for (const u of battle.allyUnits) {
    if (u.ownerId !== pid) continue;
    if (u.kind !== 'op' && !(tokens && u.kind === 'token')) continue;
    if (fieldOnly && !onField(u)) continue;
    const who = u.kind === 'token' ? u.ownerUnit : u;
    if (who && isMember(battle, who, bondId)) out.push(u);
  }
  return out;
}

/** Operators of a player (every one created from the board, dead or alive unless fieldOnly). */
export function playerOps(battle, pid, { fieldOnly = false } = {}) {
  const out = [];
  for (const u of battle.allyUnits) if (u.kind === 'op' && u.ownerId === pid && (!fieldOnly || onField(u))) out.push(u);
  return out;
}

// =====================================================================================================================
// battle: geometry (tile relations use the unit's direction `dir` (sim/dir.js): "身前" = one step along its forward
// vector; relative offsets [dRow, dCol] are facing-RIGHT and rotated like range grids)

export const N4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
export const N8 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** Tile `k` steps in front of (k < 0: behind) a unit's tile, along its direction. */
export const frontTile = (u, k = 1) => frontOf(u.tileR, u.tileC, u.dir, k);
/** The two tiles beside a unit (perpendicular to its direction): [its left-hand tile, its right-hand tile]. */
export const sideTiles = (u) => [offsetTile(u.tileR, u.tileC, 1, 0, u.dir), offsetTile(u.tileR, u.tileC, -1, 0, u.dir)];
/** Deployed ally on (r, c) owned by `pid` (any owner when pid is null), else null. */
export function allyAt(battle, r, c, pid = null) {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  const u = battle.unitAt(r, c);
  if (!u || u.side !== 'ally' || !u.alive || u.kind === 'device') return null;
  return pid == null || u.ownerId === pid ? u : null;
}
/** Deployed allies of the same owner on the given relative offsets ([dRow, dCol] facing RIGHT, rotated by `u.dir`). */
export function alliesAround(battle, u, offsets = N4) {
  const out = [];
  for (const [dr, dc] of offsets) {
    const [r, c] = offsetTile(u.tileR, u.tileC, dr, dc, u.dir);
    const a = allyAt(battle, r, c, u.ownerId);
    if (a && a !== u) out.push(a);
  }
  return out;
}
/** Deployed operators of the same owner on the unit's row (the unit included). */
export function rowMates(battle, u) {
  const out = [];
  for (const a of battle.allyUnits) if (a.kind === 'op' && a.ownerId === u.ownerId && onField(a) && a.tileR === u.tileR) out.push(a);
  return out;
}
/** Tile key used by range sets (`unit.rangeKeySet`): an ally's tile, an enemy's position tile (range tests: onKeys). */
export const tileKey = (u) => (u.side === 'ally' ? u.tileR * COLS + u.tileC : Math.round(u.y) * COLS + Math.round(u.x));
/** Is `target` on a tile of `keys` (Set or array)? An ally: its tile; an enemy: its body (a huge one: every tile). */
export const onKeys = (target, keys) => {
  if (!target || !keys) return false;
  if (target.side !== 'ally') return bodyInRange(target, keys);
  const k = tileKey(target);
  return keys instanceof Set ? keys.has(k) : keys.includes(k);
};
/** Is `target` inside `u`'s current attack range (grid ranges)? */
export const inRange = (u, target) => !!(u && target && u.rangeKeySet && onKeys(target, u.rangeKeySet));

// =====================================================================================================================
// battle: buffs, fx, per-battle state

/**
 * Buff mods of a 直接乘算 attribute bonus (bonds, bands, equipment, 机变 cards, per-layer 特质): ratios `atk` / `def` /
 * `hp` (+0.3 = "+30%"; negative lowers) → `atkPct` / `defPct` / `hpPct`, summed by the engine with every other additive
 * percentage (constants.js DIRECT_BONUS_STACKING 'add', the official rule); 'multiply' → `atkMul` / `defMul` / `hpMul`
 * = 1 + x (the v2.5 reading). Zero / non-finite parts are left out; `extra` mods are merged in.
 */
export function directMods({ atk = 0, def = 0, hp = 0 } = {}, extra = null) {
  const m = {};
  const put = (pct, mul, v) => {
    if (!(typeof v === 'number' && Number.isFinite(v)) || v === 0) return;
    if (DIRECT_BONUS_STACKING === 'multiply') m[mul] = Math.max(0, 1 + v);
    else m[pct] = v;
  };
  put('atkPct', 'atkMul', atk);
  put('defPct', 'defMul', def);
  put('hpPct', 'hpMul', hp);
  return extra ? Object.assign(m, extra) : m;
}

/** Match-long passive buff (survives death/redeploy; re-adding the same key replaces it — idempotent). */
export function passiveBuff(battle, u, key, mods, extra = {}) {
  return battle.addBuff(u, { key, mods, persist: true, allowDead: true, refresh: 'replace', ...extra });
}

/** Client VFX anchored on a unit: `battle.fx(kind, { x, y, id, src, key, …extra })`. */
export function fxOn(battle, kind, u, src, key, extra = {}) {
  if (!u) return;
  battle.fx(kind, { x: u.x, y: u.y, id: u.id, src, key, ...extra });
}

const STORES = new WeakMap();
/** Per-battle scratch object for namespace `ns` (created with `init()` on first use). */
export function battleStore(battle, ns, init = () => ({})) {
  let m = STORES.get(battle);
  if (!m) { m = new Map(); STORES.set(battle, m); }
  let s = m.get(ns);
  if (s === undefined) { s = init(); m.set(ns, s); }
  return s;
}

// =====================================================================================================================
// battle: IN_BATTLE layer gains

/**
 * Add IN_BATTLE layers (no-op in 联防 / boss / hidden fields: `battle.flags.layerGainsEnabled`).
 *   playerId       receiving player
 *   bonds          bond id or array of ids (each gets `n`)
 *   n              layers per bond (floored)
 *   requireActive  "使已激活的【X】层数+N" (default true); false = "（无需激活盟约）"
 *   source         unit that caused the gain (garrison owner; 魔王's +1 keys on it through the `layerGain` hook)
 *   reason         'garrison' for 特质 gains (魔王 only boosts those), else 'bond' / 'item' / 'band' / 'choice'
 *   cap, capKey    per-battle cap per (capKey, bond) — "每场战斗至多N层"; hook extras (魔王) don't count toward it
 * Returns the layers actually added (sum over bonds).
 */
export function gainLayers(battle, { playerId, bonds, n, requireActive = true, source = null, reason = 'content', cap = Infinity, capKey = null } = {}) {
  if (!battle || !battle.flags || !battle.flags.layerGainsEnabled || playerId == null) return 0;
  const k0 = Math.floor(num(n, 0));
  if (!(k0 > 0)) return 0;
  const list = Array.isArray(bonds) ? bonds : [bonds];
  const caps = capKey != null && Number.isFinite(cap) ? battleStore(battle, 'support:layerCaps', () => new Map()) : null;
  let total = 0;
  for (const b of list) {
    if (typeof b !== 'string' || !b) continue;
    if (requireActive && !bondActive(battle, playerId, b)) continue;
    let k = k0;
    let ck = null;
    if (caps) {
      ck = `${capKey}|${b}`;
      const used = caps.get(ck) ?? 0;
      k = Math.min(k, Math.max(0, Math.floor(cap) - used));
      if (!(k > 0)) continue;
    }
    const added = battle.addLayers(playerId, b, k, reason, { source });
    if (added > 0) {
      total += added;
      if (ck) caps.set(ck, (caps.get(ck) ?? 0) + k);
    }
  }
  return total;
}

/** Layers already added this battle under (capKey, bond) — for tests / UI. */
export function layersUsed(battle, capKey, bondId) {
  return battleStore(battle, 'support:layerCaps', () => new Map()).get(`${capKey}|${bondId}`) ?? 0;
}
