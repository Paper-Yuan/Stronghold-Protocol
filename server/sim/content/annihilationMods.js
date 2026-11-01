// server/sim/content/annihilationMods.js — 湮灭模拟（difficulty: 'ANNIHILATION'）自己带来的两条盟约语义。
//
// 来源：两个只属于该玩法的 mod（`modref/mods/egir-buff`、`modref/mods/comms-priority`），语义移植而非整文件覆盖。
// **唯一的门是 `isAnnihilationBattle(battle)`（= gd.annihilation 在战斗侧的等价物）**：官方四档与炸惊一律不生效，
// 没有 annihilation 数据的对局连一个 buff 都不会被挂上。
//
// ① 「阿戈尔盟约加强」（egir-buff/battle/main.mjs）：官方 `bonds/core.js installEgir` 的 HP 公式、吞噬（devour）、
//    层数、5 名档的复活名额与复活本身**全部不动**；本模块只补两件官方没有的事：
//      1. <战斗开始时> 所有【阿戈尔】干员获得「当前【阿戈尔】层数 × `ann_atk_per_layer`（默认 0.5）」的**基础面板
//         攻击力**（写 `unit.base.atk`，不是乘区；100 层 = +50 点）。读层数的时机排在官方 devour 之后，所以含本场
//         吞噬叠加的那部分 —— 那正是「战斗开始时」的当前层数。只发一次。
//      2. <在场 5 名不同【阿戈尔】干员>「首次被击倒立即复活」那名干员额外 +`ann_revive_aspd`（默认 50）攻速。
//         引擎没有「复活成功」钩子（官方只在复活时记一条客户端事件 `fxOn('revive')`），所以判据与官方逐字相同：
//         官方 `death` 钩子是 priority 11、本模块是默认 0（更晚），轮到本模块时 `u.alive` 就是「有没有被救起来」；
//         开局吞噬那批由官方在 `battleStart` 里按版面位置救，本模块（注册更晚）在同一个钩子里按同一顺序补。
//
// ② 数值全部**从数据里读**，不写死：`bonds.json` 的 `egirShip` 带 `ann` 覆盖块（与炸惊 `zj` 块同一套合并语义，
//    `shared/zjBonds.js overlayBondRecord`），键为 `ann.bb.ann_atk_per_layer` / `ann.bb.ann_revive_aspd`；
//    缺省时用 0.5 / 50（= mod 的数值），所以数据没落地时行为也已经正确。
//
// 装填顺序（engine-core）：本模块必须在 `bonds`（含 `bonds/core` 的 egir devour）**之后** install，否则读到的层数
// 里没有本场吞噬的那部分。
import {
  bondActive, bondLayers, bondMembers, gameData, isAnnihilationBattle, num, passiveBuff,
} from './support/index.js';
import { overlayBondRecord } from '../../../shared/zjBonds.js';

const BOND = 'egirShip';
/** 「当前层数 × 0.5 的基础面板攻击力」——固定加算（100 层 = +50 点）。数据可覆盖（`ann.bb.ann_atk_per_layer`）。 */
const START_ATK_PER_LAYER = 0.5;
/** 「获得 50 攻速加成」——攻速是**点**（aspd），不是百分比。数据可覆盖（`ann.bb.ann_revive_aspd`）。 */
const REVIVE_ASPD = 50;

/**
 * `egirShip` 的湮灭数值：基础记录 + 它的 `ann` 覆盖块（`bb` 按键合并，与炸惊 `zj` 块同一套规则）。
 * 返回 `{ atkPerLayer, reviveAspd, maxFreeRespawn }`；记录缺失时退回 mod 的数值。
 */
export function annEgirParams(bonds = null) {
  const base = (bonds || (gameData().bonds || {}))[BOND] ?? null;
  if (!base) return { atkPerLayer: START_ATK_PER_LAYER, reviveAspd: REVIVE_ASPD, maxFreeRespawn: 3 };
  const block = base.ann && typeof base.ann === 'object' ? base.ann : null;
  // 合并后的记录用来读 `bb`（基础 bb → ann.bb，ann 的键优先）；覆盖块本身在合并结果里会被剥掉，所以两处都读 bb。
  const merged = block ? overlayBondRecord(base, block, 'ann') : base;
  const bb = { ...(base.bb || {}), ...(merged.bb || {}) };
  return {
    atkPerLayer: num(bb.ann_atk_per_layer, START_ATK_PER_LAYER),
    reviveAspd: num(bb.ann_revive_aspd, REVIVE_ASPD),
    maxFreeRespawn: Math.max(0, Math.floor(num(bb.max_free_respawn_cnt, 3))),
  };
}

export function install(battle) {
  if (!isAnnihilationBattle(battle)) return;            // ← 唯一的门
  if (!battle || !Array.isArray(battle.players)) return;
  const P = annEgirParams();
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!bondActive(battle, pid, BOND)) continue;
    const members = bondMembers(battle, pid, BOND);
    if (!members.length) continue;

    // 1. 战斗开始时的基础面板攻击力（官方 devour 跑完之后的层数）。
    battle.on('battleStart', () => {
      const L = bondLayers(battle, pid, BOND);
      if (!(L > 0)) return;
      const amount = P.atkPerLayer * L;
      if (!(amount > 0)) return;
      for (const u of members) addBaseAtk(u, amount);
    }, { once: true, priority: -1000 });

    // 2. 5 名那一档的复活攻速。
    if (!(P.reviveAspd > 0) || !(P.maxFreeRespawn > 0)) continue;
    const memberSet = new Set(members.filter((u) => u.kind === 'op'));
    const opening = [];      // 开局吞噬期间被击倒的成员：官方等所有吞噬跑完再按位置救
    const seen = new Set();  // 「首次被击倒」只算一次（与官方 knockedOut 同一口径）
    const grant = (u) => { if (u && u.alive && !u.removed) passiveBuff(battle, u, 'mod:egir:reviveAspd', { aspd: P.reviveAspd }); };
    const scan = reviveScan(battle);
    battle.on('battleStart', () => {
      if (!opening.length) return;
      let slots = P.maxFreeRespawn;
      for (const u of opening.splice(0).sort(scan)) {
        if (slots <= 0) break;
        if (u.alive && !u.removed) { grant(u); slots--; }
      }
    }, { once: true, priority: -1000 });
    battle.on('death', (c) => {
      const u = c && c.unit;
      if (!u || c.reason !== 'killed' || c.revivedBy || !memberSet.has(u) || seen.has(u)) return;
      seen.add(u);
      if (battle.time <= 0) { opening.push(u); return; }   // 开局吞噬的窗口：交给上面那个 battleStart 监听器
      grant(u);                                            // 战斗中：官方（priority 11）已经复活过了
    });
  }
}

/** 把 `amount` 加到**基础面板**攻击力上（不是乘区）：`unit.base.atk`，随后让 `s` 重算。 */
function addBaseAtk(u, amount) {
  if (!u || !u.base || !(amount > 0)) return;
  u.base.atk = Math.max(0, num(u.base.atk, 0) + amount);
  if (typeof u.markDirty === 'function') u.markDirty();
  void u.s;   // 触发重算（units.js 的惰性 stats）
}

/** 官方 `egirReviveScan`：按玩家自己看到的版面「更靠左、再更靠下」排序（右侧镜像玩家从场地右边数起）。 */
const boardCol = (battle, u) => ((battle.getPlayer(u.ownerId)?.mirror ? -1 : 1) * u.tileC);
const reviveScan = (battle) => (a, b) => boardCol(battle, a) - boardCol(battle, b) || a.tileR - b.tileR || a.id - b.id;

/** 湮灭专属 mod 没有 prep 侧效果（通讯机 / 寻呼模块的优先规则在 server/match/builtinMeta.js 里就地分支）。 */
export function registerMeta() { /* no prep-side handlers */ }
