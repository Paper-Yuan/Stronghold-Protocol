// workshop/columbia/battle/main.mjs — 哥伦比亚 mod 的**战斗侧**逻辑（`pack.json.server.battle`，DESIGN §28.17）。
//
// 原来这份代码住在引擎的 `server/sim/mod/columbia/columbia.js`。现在它就在包里，通过 `@battle/mod.js`（包侧 SDK）
// 把自己注册进官方表 —— 包由此自足，引擎不再含任何 mod 专属代码。休整期那一半见 `meta/main.mjs`。
//
// 注册面（一次性挂在模块顶层）：
//   registerBondInstaller      哥伦比亚盟约（<战斗开始时> 携带装备数量×攻击力）
//   registerItemBehaviour      同行者（无视防御/法抗）/ 源石辅助仪（已继承装备的数值）
//   registerGarrisonInstaller  谬因 / 星极 / 锡兰 / 卡夫卡 / 刻刀 的战斗侧特质
//
// 源石辅助仪（chess_item_6_13_e，T6）：
//   * `params.slot_cap` 由引擎的装备容量开口子读取（shared/equipSlots.js —— server/match 与客户端 placement.js/
//     detailPanel.js 两端同源），普通 +2 / 进阶 +4。
//   * <进入休整期时> 把携带者**其余装备**的数值汇总吸收到本装备上（可叠加），随后用 ctx.destroyPiece 就地销毁；
//     吸收结果写在携带者棋子的 `piece.meta.data.columbia`（ctx.setPieceData），随战斗输入进 `u.pieceData`，
//     由本文件里的 item behaviour 按「1 + 每层 2.5%/5% × 哥伦比亚层数」缩放后挂到携带者身上。
//   * 被销毁的装备若带 `giveBondId`（配合变形同构体才生效的那种），盟约记进 `columbia.bondSources`；携带者**当前**装备着
//     变形同构体时才写进 `piece.meta.data.bondGrants`（引擎当成变形同构体授予，server/match/bondsMeta.js pieceBonds、
//     support/index.js unitBonds）—— 先吸收、后补装变形同构体也能生效，换掉变形同构体则随之失效。

import * as S from '@battle/mod.js';
import {
  registerBondInstaller, onLayers, registerItemBehaviour, addShieldLayer, registerGarrisonInstaller, setBattleMark, num,
} from '@battle/mod.js';
import { FORCED_EXIT } from '@sim/constants.js';

/** 每场战斗的额外安装（本 mod 的注册都在模块顶层完成，这里无需每场逻辑）。 */
export function install() {}

const BOND = 'columbiaShip';

// =====================================================================================================================
// 战斗侧：盟约【哥伦比亚】

/**
 * <战斗开始时>【哥伦比亚】干员获得「携带装备数量 × (20% + 0.1%×层)」的攻击力。
 *
 * 口径（业主 spec，2026-10-11）：
 *   * 「携带装备数量」= 该干员**实际装备**的件数 + 盟约的「视为额外携带了1件装备」（`extra_carry`，
 *     每 `extra_carry_per_layer`(=50) 层再 +1）—— 是**计数**，不是真实格位；真实格位来自源石辅助仪的「装备格+2/+4」。
 *   * 百分比随层数走（`atk_per_item` + `atk_per_item_per`×L），层数变化时重算（`onLayers`）。
 */
function installColumbia(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const L = () => S.bondLayers(battle, pid, BOND);
  const perItem = () => num(bb.atk_per_item, 0.1) + num(bb.atk_per_item_per, 0) * L();
  const extraCarry = () => num(bb.extra_carry, 1) + Math.floor(L() / Math.max(1, num(bb.extra_carry_per_layer, 50)));
  /** 场上成员 → 计数；「视为额外携带」只在有成员时给。 */
  const refresh = () => {
    const on = new Set(S.bondMembers(battle, pid, BOND, { fieldOnly: true }));
    const pct = perItem();
    const extra = extraCarry();
    for (const u of on) {
      const carried = (Array.isArray(u.items) ? u.items.length : 0) + extra;
      const mods = S.directMods({ atk: carried * pct });
      battle.addBuff(u, { key: 'bond:columbia:atk', persist: true, refresh: 'replace', mods });
    }
    for (const u of S.bondMembers(battle, pid, BOND)) if (!on.has(u)) battle.removeBuff(u, 'bond:columbia:atk');
  };
  onLayers(battle, pid, BOND, refresh);
  battle.on('deploy', ({ unit }) => { if (memberSet.has(unit)) refresh(); });
  battle.on('death', () => refresh());
  refresh();
}

registerBondInstaller(BOND, installColumbia);

// =====================================================================================================================
// 同行者：造成的伤害无视敌人 10%/20% 防御力与法术抗性

/**
 * `def_penetrate` / `magic_resist_penetrate` → 引擎的 `defIgnorePct` / `resIgnorePct`（`sim/content/choices.js:321-322`
 * 是同一套映射；`sim/damage.js` 里 `effD = max(0, D×(1−defIgnorePct) − defIgnoreFlat)`）。
 * 自己接是因为通用装备面板（`items/battle.js statMods`）只认 `magic_resist_penetrate`，不认 `def_penetrate`。
 *
 * ⚠ 注册键必须是**buff 键**（items.json 的 `bbStr.key`，这里是 `mod_col_fellow`），不是 item key：`installItem`
 * 先过 `hasBattleEffect(rec)`，而它只认 STAT_BUFFS / BY_BUFF / EXTRA_BUFFS 里的**buff 键** —— 用 item key 注册
 * （`chess_item_4_13_e`）会落进 EXTRA_ITEMS，但 `hasBattleEffect` 为 false 时 `installItem` 直接返回，
 * 这段行为永远不会执行。buff 键注册的回调签名是 `(battle, u, p, scope)`，`p` 就是 `{ ...bb, ...bbStr }`。
 */
registerItemBehaviour('mod_col_fellow', (battle, u, p, scope) => {
  if (!p) return;
  const dp = num(p.def_penetrate, 0);
  const rp = num(p.magic_resist_penetrate, 0);
  if (dp > 0 || rp > 0) scope.stat('pen', { defIgnorePct: dp, resIgnorePct: rp });
});

// =====================================================================================================================
// 源石辅助仪：已继承装备的数值（休整期汇总、战斗侧按层数缩放挂到携带者身上）

/** 汇总进「已继承」的数值键（与 items/battle.js 的 statMods 同一套，另加 def_penetrate）。 */
const NUM_KEYS = ['atk', 'def', 'hp', 'aspd', 'resFlat', 'redeploy', 'spRecovery', 'resIgnorePct', 'defIgnorePct', 'taunt'];
const zeroNumbers = () => ({ atk: 0, def: 0, hp: 0, aspd: 0, resFlat: 0, redeploy: 0, spRecovery: 0, resIgnorePct: 0, defIgnorePct: 0, taunt: 0 });
/** item key：id 去掉 `_a` / `_b` 后缀。 */
const keyOfItem = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

/** 一件装备记录里可继承的数值（每个 buff 的 `{ ...bb, ...bbStr }` 累加）。 */
function itemNumbers(rec) {
  const out = zeroNumbers();
  for (const b of S.buffsOf(rec)) {
    const p = b.p;
    out.atk += num(p.atk, 0);
    out.def += num(p.def, 0);
    out.hp += num(p.max_hp, 0);
    out.aspd += num(p.attack_speed, 0);
    out.resFlat += num(p.magic_resistance, 0);
    out.redeploy += num(p.respawn_time, 0);
    out.spRecovery += num(p.sp_recovery_per_sec, 0);
    out.resIgnorePct += num(p.magic_resist_penetrate, 0);
    out.defIgnorePct += num(p.def_penetrate, 0);
    out.taunt += num(p.taunt_level, 0);
  }
  return out;
}

function addNumbers(a, b) {
  const out = zeroNumbers();
  for (const k of NUM_KEYS) out[k] = num(a && a[k], 0) + num(b && b[k], 0);
  return out;
}

/**
 * 汇总数值 → 战斗属性 mods（按 scale 缩放；与 items/battle.js statMods 同一套映射）。
 *
 * **加成只作用于正面数值**：负面数值按原值继承，不吃加成比例 —— 业主规则 2026-10-12「继承的负面效果
 * （如 源石溶剂 的每秒流失生命、阿戈尔重刃 的攻击速度-10）不会享受到继承效果加成比例」。同一函数也服务于
 * 谬因特质的「携带装备基础数值增加0.1%」，那里同一条规矩：数值增加的百分比不放大负面数值。
 */
function scaledMods(raw, scale) {
  /** 正面数值 × scale，负面数值原样（0 也原样）。 */
  const gain = (v) => (v > 0 ? v * scale : v);
  const m = S.directMods({ atk: gain(num(raw.atk)), def: gain(num(raw.def)), hp: Math.max(-0.99, gain(num(raw.hp))) });
  const put = (k, v) => { if (typeof v === 'number' && Number.isFinite(v) && v !== 0) m[k] = v; };
  put('aspd', gain(num(raw.aspd)));
  put('resFlat', gain(num(raw.resFlat)));
  put('spRecoveryFlat', gain(num(raw.spRecovery)));
  put('resIgnorePct', gain(num(raw.resIgnorePct)));
  put('defIgnorePct', gain(num(raw.defIgnorePct)));
  put('taunt', gain(num(raw.taunt)));
  const re = gain(num(raw.redeploy));
  if (re) m.redeployMul = Math.max(0, 1 + re);
  return m;
}

/**
 * 源石辅助仪的战斗侧：读取携带者 `u.pieceData.columbia.mods`（休整期吸收的数值），按「1 + inherit_ratio_per_layer ×
 * 【哥伦比亚】层数」缩放后挂在携带者身上；层数变化时重算（onLayers）。
 *
 * 注册键是 **buff 键** `mod_col_pldevice`（items.json 的 `bbStr.key`），不是 item key —— 理由见上面 同行者 那段
 * 注释（`installItem` 的 `hasBattleEffect` 只看 buff 键）。回调签名 `(battle, u, p, scope)`，`p` 即装备参数。
 */
registerItemBehaviour('mod_col_pldevice', (battle, u, p, scope) => {
  const raw = u.pieceData && u.pieceData.columbia ? u.pieceData.columbia.mods : null;
  if (!raw) return;
  const perLayer = num(p && p.inherit_ratio_per_layer, 0);
  const apply = () => {
    const m = scaledMods(raw, 1 + perLayer * S.bondLayers(battle, u.ownerId, BOND));
    if (Object.keys(m).length) scope.stat('absorb', m);
    else battle.removeBuff(u, scope.key('absorb'));
  };
  apply();
  onLayers(battle, u.ownerId, BOND, apply);
});

// =====================================================================================================================
// 干员特质（战斗侧 IN_BATTLE）

/** 「使该干员已激活的盟约层数+N」：遍历它自己所属的盟约逐个加层（单位：层）。 */
function gainOwnBondLayers(battle, u, n, { requireActive = true } = {}) {
  let total = 0;
  for (const b of S.unitBonds(u)) {
    total += S.gainLayers(battle, { playerId: u.ownerId, bonds: b, n, requireActive, source: u, reason: 'garrison' });
  }
  return total;
}

/**
 * 谬因：「<战斗中>【哥伦比亚】每叠加N层，自身携带的装备基础数值增加0.1%；攻击速度提升自身携带装备数量×X%」。
 * 把携带者的装备数值汇总，按 `bb.add × floor(层数 / bb.divide_num)` 额外挂一层加成；攻击速度另按
 * `bb.aspd_per_item × 件数`（单位「点」，×100 → 百分比）叠加，与层数无关。层数变化时重算（onLayers）。
 */
registerGarrisonInstaller('COL_EQUIP_BASE_BY_BOND_LAYER', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!S.isOp(u)) continue;
    const per = Math.max(1, num(it.bb.divide_num, 10));
    const add = num(it.bb.add, 0.001);
    const aspdPer = num(it.bb.aspd_per_item, 0) * 100;
    const key = `gar:${it.gid}`;
    const apply = () => {
      const items = S.itemsOf(u);
      const steps = Math.floor(S.bondLayers(battle, u.ownerId, BOND) / per);
      let sum = zeroNumbers();
      for (const id of items) { const r = S.itemRecord(id); if (r) sum = addNumbers(sum, itemNumbers(r)); }
      const mods = steps > 0 ? scaledMods(sum, add * steps) : {};
      if (aspdPer > 0 && items.length) mods.aspd = num(mods.aspd, 0) + items.length * aspdPer;
      if (Object.keys(mods).length) S.passiveBuff(battle, u, key, mods);
      else battle.removeBuff(u, key);
    };
    apply();
    onLayers(battle, u.ownerId, BOND, apply);
  }
});

/**
 * 星极：「<战斗开始时>自身与周围8格干员获得N层护盾（可叠加，【哥伦比亚】每X层+1）」+
 * 「<战斗中>开启技能时，使**自身周围八格干员**已激活的盟约层数+N（最多M次）」（不含自身）。
 */
registerGarrisonInstaller('COL_SHIELD_AND_SKILL_LAYER', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!S.isOp(u)) continue;
    const base = Math.max(0, Math.floor(num(it.bb.shield, 1)));
    const div = Math.max(1, num(it.bb.shield_div, 20));
    const per = Math.max(1, num(it.bb.layer, 2));
    const max = Math.max(1, Math.floor(num(it.bb.max, 2)));
    const shieldKey = `gar:${it.gid}:shield`;
    let fired = 0;
    battle.on('battleStart', () => {
      if (!S.onField(u)) return;
      const k = base + Math.floor(S.bondLayers(battle, u.ownerId, BOND) / div);
      if (!(k > 0)) return;
      const targets = [u, ...S.alliesAround(battle, u, S.N8)];
      for (const t of targets) { if (!t || !t.alive) continue; for (let i = 0; i < k; i++) addShieldLayer(battle, t, shieldKey, k); }
    }, { once: true });
    battle.on('skillStart', (c) => {
      if (c.unit !== u || fired >= max) return;
      fired++;
      // 「自身周围八格干员」不含自身：只对周围八格逐个加层。
      for (const t of S.alliesAround(battle, u, S.N8)) if (t && t.alive) gainOwnBondLayers(battle, t, per, { requireActive: true });
    });
  }
});

/** 锡兰：「<战斗中>开启技能时，使自身与身前一格干员的已激活盟约层数+N（最多M次）」。 */
registerGarrisonInstaller('COL_SKILL_SELF_FRONT_LAYER', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!S.isOp(u)) continue;
    const n = Math.max(1, num(it.bb.count, 4));
    const max = Math.max(1, Math.floor(num(it.bb.max, 1)));
    let fired = 0;
    battle.on('skillStart', (c) => {
      if (c.unit !== u || fired >= max) return;
      fired++;
      const targets = [u];
      const [fr, fc] = S.frontTile(u);
      const f = S.allyAt(battle, fr, fc, u.ownerId);
      if (f && S.isOp(f) && f !== u) targets.push(f);
      for (const t of targets) gainOwnBondLayers(battle, t, n, { requireActive: true });
    });
  }
});

/**
 * 卡夫卡：「<部署时>使已激活的【哥伦比亚】层数+N」+
 * 「<战斗中>若没有陷入过再部署状态，使下个休整期获得1件随机X阶装备」。
 * 跨阶段走**战斗 → 休整期的通用通道**：battleEnd 用 `setBattleMark(battle, pid, 'equipTier', <阶数|null>)` 写，
 * 引擎收进 `ps.marks`，休整期特质用 `ctx.mark('equipTier')` 读（见 kafkaPrepEquip）。
 */
registerGarrisonInstaller('COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!S.isOp(u)) continue;
    const layer = Math.max(1, num(it.bb.layer, 1));
    const tier = Math.max(1, Math.floor(num(it.bb.item_tier, 1)));
    let fell = false;
    battle.on('deploy', (c) => { if (c.unit === u) S.gainLayers(battle, { playerId: u.ownerId, bonds: BOND, n: layer, requireActive: true, source: u, reason: 'garrison' }); });
    battle.on('death', (c) => { if (c.unit === u && c.reason !== FORCED_EXIT && Number.isFinite(u.respawnAt)) fell = true; });
    battle.on('battleEnd', () => { setBattleMark(battle, u.ownerId, 'equipTier', fell ? null : tier); });
  }
});

/** 刻刀：「<战斗开始时>自身所属盟约层数+N（无需激活盟约）」。 */
registerGarrisonInstaller('COL_START_OWN_BOND_NOACT', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!S.isOp(u)) continue;
    const n = Math.max(1, num(it.bb.count, 1));
    battle.on('battleStart', () => { if (S.onField(u)) gainOwnBondLayers(battle, u, n, { requireActive: false }); }, { once: true });
  }
});
