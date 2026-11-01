// server/sim/content/jibian.js — 炸惊模拟 惊变 (jibian) card content (我方 99 张).
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3). Semantic port of modref/v2.1/server/sim/content/jibian.js. Only the ZHAJING mode
// ever reaches this module: a card arrives as an EffectRef with the key `jibian:<effectId>` (server/match/choices.js),
// and without this file a 惊变 card is a name, a rarity and a flavour line that changes nothing.
//   * battle side — install(battle) reads every `jibian:` ref of every player and applies the card's battle part.
//     Every hook is gated by the picks themselves, so a non-ZHAJING battle (no refs) installs nothing.
//   * prep side — registerMeta(registry) registers one `jibian:<effectId>` handler per card; `onChoicePick` fires
//     exactly once per pick (ctx.source.kind === 'effect'), so it is the "when this card is picked" hook.
// Unlike a 机变 card a 惊变 card has NO data/effects.json record: its numbers are authored here.
//
// ADAPTATIONS to 0.3.3 (the reference pack's own APIs that no longer exist):
//   * `../damage.js` was split: `periodicDamage` now comes from the public settlement entry `../attack.js`.
//   * `u.redeployLocked` is gone; "无法再部署" is `u.respawnAt = Infinity` (battle/deploy.js _checkRedeploys skips it).
//   * `s.critRate` / `dmg.crit` do not exist (the pack's content/forge.js owned them): 黑闪 (jibian_heishan) stays
//     authored but is inert until the 锻造器 lands — see the card's comment.
//   * `battle.jibianChen3WaveCap` is written but no 0.3.3 kit reads it yet (kits/ops/op-chen3.js owns the cap).
//   * support/index.js lost `hasJibian` (and the isMember 惊变 branches); this module exports `hasJibian` so the
//     battle side can ask without importing the 惊变 registry (see the report: isMember needs engine-core wiring).
// RNG: battle.random is `battle.rng` (server/sim/rng.js createRng); prep side uses `ctx.rng`. No Math.random anywhere.

import { directMods, passiveBuff, playerOps, isMember, gainLayers, itemsOf, itemKeyOf } from './support/index.js';
import { bondLayers, activeBondIds } from './support/index.js';
import { spawnYanyou } from './tokens.js';
import { activeBonds, ownedJibianIdsOf } from './jibianBonds.js';
import { periodicDamage } from '../attack.js';
import { weaknessRetype, addShieldLayer } from './items/battle.js';
import { GEO } from '../../../shared/constants.js';
import { MORTIS_BEAST_CARD } from '../../../shared/mujicaJibian.js';

/** EffectRef key prefix of a 惊变 card. */
const P = 'jibian:';

/** Effect id of a `jibian:<id>` ref key (null for anything else). */
const idOf = (key) => (typeof key === 'string' && key.startsWith(P) ? key.slice(P.length) || null : null);

/**
 * Every player's picked 惊变 cards: pid → Map(effectId → times picked). Re-picking the same card stacks (each pick is
 * its own ref), so the counts drive how many times a card's effect applies. 羁绊 progress uses the SET of ids, so a
 * duplicate never advances a bond (test/content/jibian-bonds.test.js).
 */
export function picksOf(battle) {
  const out = new Map();
  for (const ps of (battle && battle.players) || []) {
    const m = new Map();
    for (const ref of ps.playerEffects || []) {
      const id = idOf(ref && ref.key);
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    if (m.size) out.set(ps.playerId, m);
  }
  return out;
}

/** Does player `pid` hold 惊变卡 `effectId`? (battle side; playerEffects carry the key `jibian:<effectId>`.) */
export function hasJibian(battle, pid, effectId) {
  if (pid == null || !effectId) return false;
  for (const ps of (battle && battle.players) || []) {
    if (!ps || ps.playerId !== pid) continue;
    for (const ref of ps.playerEffects || []) if (ref && ref.key === `jibian:${effectId}`) return true;
  }
  return false;
}

/** 寒冷 or 冻结 (the engine's own status flags). */
const chilled = (u) => !!u && !!(u.s && u.s.flags && (u.s.flags.cold || u.s.flags.freeze));

/** 目标是不是站在 `u` 自己的攻击范围格子里（不含技能/内容额外加的那些格）—— 假想敌的"范围外"判定。 */
function inBaseRange(u, t) {
  if (!u || !t || !Number.isInteger(t.tileR) || !Number.isInteger(t.tileC)) return false;
  const keys = u.baseRangeKeys;
  if (!Array.isArray(keys)) return false;
  return keys.includes(t.tileR * GEO.COLS + t.tileC);
}

/** The player a spawned enemy belongs to, else null. */
function enemyOwner(battle, e) {
  if (!e) return null;
  if (e.ownerId != null) return e.ownerId;
  const players = (battle && battle.players) || [];
  return players.length === 1 ? players[0].playerId : null;
}

/** Refs that target ONE named piece: key `effect:jibian:<id>`, `params.uid` = the piece's uid (超大杯). */
function scopedRefs(battle) {
  const out = [];
  for (const ps of (battle && battle.players) || []) {
    for (const ref of ps.playerEffects || []) {
      if (ref && typeof ref.key === 'string' && ref.key.startsWith('effect:' + P)) out.push({ id: ref.key.slice(('effect:' + P).length), params: ref.params || {} });
    }
  }
  return out;
}

/** Refs of ONE 惊变 id whose numbers live in the ref's own `params` (金酒之杯): pid → params[]. */
function refParamsOf(battle, id) {
  const out = new Map();
  for (const ps of (battle && battle.players) || []) {
    const list = [];
    for (const ref of ps.playerEffects || []) {
      if (idOf(ref && ref.key) !== id) continue;
      list.push(ref && ref.params && typeof ref.params === 'object' ? ref.params : {});
    }
    if (list.length) out.set(ps.playerId, list);
  }
  return out;
}

/**
 * 金酒之杯的「所有我方单位」：该玩家场上存活的全部我方单位 —— 干员、召唤物与装置/道具单位（用户 2026-10-13 口径）。
 * 不能用 playerOps()（只收 kind === 'op'）也不能用 battle.allies()（排除 device）。
 */
function ownUnits(battle, pid) {
  const out = [];
  for (const u of (battle && battle.allyUnits) || []) {
    if (!u || u.side !== 'ally' || u.ownerId !== pid) continue;
    if (u.removed || !u.alive || !u.deployed) continue;
    out.push(u);
  }
  return out;
}

/** Operator mods a card puts on EVERY own operator, as a function of how many times it was picked. */
const OP_PASSIVES = [
  ['jibian_qiangqiang', (n) => directMods({ atk: 0.15 * n, def: 0.15 * n, hp: 0.15 * n })],
  ['jibian_daoqiangburu', (n) => directMods({ def: 0.5 * n })],
  ['jibian_moshubiaoyan', (n) => ({ aspd: 70 * n })],
  ['jibian_xunhuanwangfu', (n) => ({ spRecoveryFlat: 1.2 * n })],
  // 玻璃大炮：攻击力 +100%、最高生命 −60%（同为加算区，不会把生命打成负数）
  ['jibian_bolidapao', (n) => directMods({ atk: 1 * n, hp: -0.6 * n })],
];

// =====================================================================================================================
// battle side

/**
 * 火力不足恐惧症（稀有）：你的所有干员开启技能后子弹数翻倍（只作用于 `skill.kind === 'ammo'`）。
 * 优先级 -20：比拉特兰盟约的 +N%（-10）更晚结算，所以是"先算盟约加成、再整体翻倍"。
 */
export function doubleAmmoForJibian(_battle, unit, skill) {
  if (!unit || unit.side !== 'ally') return 0;
  if (!skill || skill.kind !== 'ammo' || !(skill.ammoLeft > 0)) return skill ? skill.ammoLeft || 0 : 0;
  // 同一次技能开启只翻一次；skillEnd 时复位。
  if (skill.jibianHuoliDone) return skill.ammoLeft;
  skill.jibianHuoliDone = true;
  const n = skill.ammoLeft * 2;
  if (!Number.isFinite(n) || n <= skill.ammoLeft) return skill.ammoLeft;
  skill.ammoLeft = n;
  if (Number.isFinite(skill.ammoMax) && skill.ammoMax > 0) skill.ammoMax = Math.max(skill.ammoMax, n);
  return n;
}

/** 「总攻击」发的三个 S.E.E.S 干员：[精锐, 本体]（取第一个存在的）。 */
const SEES_TRIO = Object.freeze([
  ['chess_zj_60_2_b', 'chess_zj_60_2_a'],   // 虎狼丸
  ['chess_zj_60_4_b', 'chess_zj_60_4_a'],   // 岳羽由加莉
  ['chess_zj_60_3_b', 'chess_zj_60_3_a'],   // 埃癸斯
]);

/** 「银河战舰」发的三名颂乐人偶干员：[精锐, 本体]（取第一个存在的）。 */
const GALAXY_TRIO = Object.freeze([
  ['chess_zj_tmoris_b', 'chess_zj_tmoris_a'],   // 八幡海铃
  ['chess_zj_amoris_b', 'chess_zj_amoris_a'],   // 祐天寺若麦
  ['chess_zj_dolris_b', 'chess_zj_dolris_a'],   // 三角初华
]);

// =====================================================================================================================
// 惊变羁绊（战斗侧）：凑齐固定惊变后生效的战斗侧效果。判定见 ./jibianBonds.js，prep 侧效果在 match/effectsMeta.js。

/** 纯视觉体型：多个效果各写一份乘区（1 = 不变），相加后落到 u.visualScale。 */
const setVisScalePart = (u, key, k) => {
  try {
    if (!u) return;
    const mem = (u.mem = u.mem || {});
    const parts = (mem.visScaleParts = mem.visScaleParts || {});
    parts[key] = Number(k) || 1;
    let v = 1;
    for (const p of Object.values(parts)) v += (Number(p) || 1) - 1;
    // 体型范围 0.325 – 7.99（owner 2026-10-26）
    u.visualScale = Math.max(0.325, Math.min(7.99, Math.round(v * 1000) / 1000));
  } catch { /* 视觉失败不影响对局 */ }
};

const BOND_ATTR = (battle, unit, key, mods) => {
  try { battle.addBuff(unit, { key: `jibianbond:${key}`, mods }); } catch { /* 出错不影响对局 */ }
};

/**
 * 把 17 个羁绊里「战斗侧」的部分装上。
 * ★ 2026-10-21（owner）：战场侧的惊变羁绊**只看自己的卡、只作用于自己的单位**（按玩家分别调用）。
 * @param {any} battle @param {Set<string>} owned 已拥有的惊变 effectId @param {any} playerId
 */
export function installJibianBonds(battle, owned, playerId = null) {
  const mine = (u) => !!u && u.side === 'ally' && (playerId == null || u.ownerId === playerId);
  const allies = () => {
    try {
      const list = battle.allies();
      return playerId == null ? list : list.filter((u) => mine(u));
    } catch { return []; }
  };
  let act = [];
  try { act = activeBonds(owned); } catch { act = []; }
  if (!act.length) return;
  const has = (id) => act.some((a) => a.def.id === id);
  const tierOf = (id) => { const a = act.find((x) => x.def.id === id); return a ? a.tier : 0; };

  // 工匠精神（owner 2026-10-25）：每装备 1 个维式战锤系列武器 → 攻击力 +5%（最终乘算）
  if (has('craftsman')) {
    const HAMMERS = new Set(['chess_item_1_01_e', 'chess_item_2_03_e', 'chess_item_3_09_e', 'chess_item_3_10_e', 'chess_item_4_09_e']);
    const apply = (u) => {
      if (!mine(u)) return;
      let cnt = 0;
      for (const id of itemsOf(u)) if (HAMMERS.has(itemKeyOf(id))) cnt++;
      if (cnt > 0) BOND_ATTR(battle, u, 'craftsman', { atkMul: 1 + 0.05 * cnt });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 钢化你心：我方所有干员生命值 +100%（最终乘算 hpMul ×2）
  if (has('steel_heart')) {
    const apply = (u) => { if (mine(u)) BOND_ATTR(battle, u, 'steel_heart', { hpMul: 2 }); };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 现代最强：技能不需要技力、攻击力 +1000%、攻速 +360、攻击距离 +2
  if (has('modern_strongest')) {
    const apply = (u) => {
      if (!mine(u)) return;
      if (u.skill && !u.skill.noSkill) u.skill.spCostMul = 0;
      // 键名必须是 buffs 的 `aspd` / `rangeExtend`（写成 attackSpeed / range 会被静默忽略）。
      // 优先级 -100：晚于六眼（10）执行，否则六眼的 spCostMul=0.1 会把「不再需要技力」覆盖回去。
      BOND_ATTR(battle, u, 'modern', { atkPct: 10, aspd: 360, rangeExtend: 2 });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: -100 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit), { priority: -100 });
    // 引擎把 0 倍率钳到最低 1 点技力：技能结束时补回这 1 点，下一次技能依旧立刻可用。
    battle.on('skillEnd', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || !mine(u)) return;
      const sk = u.skill;
      if (!sk || sk.noSkill || sk.kind === 'passive') return;
      if (Number(sk.spCostMul) !== 0) return;
      sk.gainSp(1, 'bond');
    });
  }

  // 重振荣光：卡西米尔干员 攻击力 +100%（二档翻倍）、攻击距离 +1
  const gloryTier = tierOf('glory');
  if (gloryTier > 0) {
    const mul = gloryTier >= 3 ? 2 : 1;
    const apply = (u) => {
      if (!mine(u)) return;
      const bonds = (u.def && u.def.bonds) || [];
      if (!bonds.includes('kazimierzShip')) return;
      BOND_ATTR(battle, u, 'glory', { atkPct: mul, rangeExtend: 1 });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 共感：开战时把所有我方干员的攻击力拉到「场上最高攻击力」那一档
  if (has('empathy')) {
    battle.on('battleStart', () => {
      const list = allies().filter((u) => u && u.alive !== false);
      if (!list.length) return;
      let top = 0;
      for (const u of list) top = Math.max(top, Number(u.s && u.s.atk) || 0);
      if (!(top > 0)) return;
      for (const u of list) {
        const cur = Number(u.s && u.s.atk) || 0;
        if (cur > 0 && top > cur) BOND_ATTR(battle, u, 'empathy', { atkMul: top / cur });
      }
    }, { priority: 30 });
  }

  // 光荣进化：【阿戈尔】干员基础数值 +300%
  if (has('glorious_evo')) {
    const apply = (u) => {
      if (!mine(u)) return;
      const bonds = (u.def && u.def.bonds) || [];
      if (!bonds.includes('egirShip')) return;
      BOND_ATTR(battle, u, 'evo', { hpMul: 4, atkMul: 4, defMul: 4 });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 伤害转伤害：所有伤害变真实伤害 + 攻击力 +50%
  //   `hit` 钩子在 mitigate 之前、type 在 hit 之后才被读取，所以在这里改 type 才有效；
  //   元素伤害保持元素结算（爆发有自己的通道，强转真伤会绕过元素抗性与爆发逻辑）。
  if (has('dmg2dmg')) {
    const apply = (u) => {
      if (!mine(u)) return;
      BOND_ATTR(battle, u, 'truedmg', { atkPct: 0.5 });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const src = (ctx && (ctx.credit ?? ctx.source)) || null;
      const t = ctx && ctx.target;
      if (!dmg || !src || !t || src.side !== 'ally' || t.side !== 'enemy' || !mine(src)) return;
      if (dmg.type === 'element' || dmg.type === 'elemental' || dmg.type === 'true') return;
      dmg.type = 'true';
    });
  }

  // 因为太怕痛就全点防御力了：一档 防御/法抗 +70%；二档 被阻挡的敌人每秒吃 10% 最大生命真伤。
  // ★ tierOf 返回的是**阈值**（tiers [2,3] → 2 或 3），不是档位序号：二档必须判 >= 3。
  const painTier = tierOf('toopainful');
  if (painTier >= 1) {
    const apply = (u) => {
      if (!mine(u)) return;
      BOND_ATTR(battle, u, 'toopainful', { defMul: 1.7, resMul: 1.7 });
    };
    battle.on('battleStart', () => { for (const u of allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }
  if (painTier >= 3) {
    let acc = 0;
    battle.on('tick', (c) => {
      acc += Number(c && c.dt) || 0;
      if (acc < 1) return;
      acc -= 1;
      for (const u of allies()) {
        if (!mine(u) || !Array.isArray(u.blocking)) continue;
        for (const e of u.blocking) {
          if (!e || !e.alive || !e.s) continue;
          const hp = Number(e.s.maxHp) || 0;
          if (!(hp > 0)) continue;
          try {
            battle.dealDamage(u, e, battle.makeDamage({ amount: hp * 0.1, type: 'true', canDodge: false, tags: ['jibian', 'toopainful'] }));
          } catch { /* 已死亡等：忽略 */ }
        }
      }
    }, { priority: -20 });
  }

  // 待 engine-core 补：great_seal / true_investor / roguelike_fan / cheat —— 前两个要新引擎能力（复活与资金记账），
  // 后两个的 prep 侧定义在 match/effectsMeta.js（战斗侧无需动作）。伟大封印的**战斗侧**已在 install() 里实现。
}

/**
 * 出老千（羁绊）在**战斗内**是否激活：任意玩家的 picks 里凑够 cheat 的成员。
 * （卡面不写这条 —— owner 要求「不用写明」。）
 */
function cheatPicks(battle) {
  try {
    const picks = picksOf(battle);
    const owned = new Set();
    for (const ids of picks.values()) for (const id of ids.keys()) owned.add(id);
    return activeBonds(owned).some((a) => a.def.id === 'cheat');
  } catch { return false; }
}

/** 心之钢的体型倍率：每 10000 最大生命 +3%，上限 +30%（纯视觉）。 */
export function heartsteelScale(maxHp) {
  const hp = Number(maxHp) || 0;
  if (!(hp > 0)) return 1;
  return 1 + Math.min(0.3, Math.floor(hp / 10000) * 0.03);
}

export function install(battle) {
  // 幂等护栏（与 forge.js 同一个形状）：`DOMAIN_NAMES` 已经注册了 'jibian'，若某个调用方又把它塞进
  // `extraContent`（测试 / 插件），第二个 install 会把 hit / attack / kill 这些钩子挂两次 —— 静默的数值翻倍。
  if (battle._jibianInstalled) return;
  battle._jibianInstalled = true;
  const picks = picksOf(battle);
  const scoped = scopedRefs(battle);
  // 金酒之杯的数值不在 picks 里（params：整备阶段结束时由 prep 侧写进 ref），单独取一份
  const cup = refParamsOf(battle, 'jibian_jinjiuzhibei');
  if (!picks.size && !scoped.length && !cup.size) return;
  const count = (pid, id) => (pid == null ? 0 : picks.get(pid)?.get(id) ?? 0);
  const has = (id) => { for (const m of picks.values()) if (m.has(id)) return true; return false; };

  // 龙的传人（传说，owner 2026-10-24）：「炎」盟约不再生成炎佑，改为每 1000 层任意盟约召唤一只炎佑
  //   （攻击力 / 生命值 = 场上该玩家所有干员总和的 30%，上限 9 只）。
  const LONGDE = 'jibian_longdechuanren';
  if (has(LONGDE)) {
    battle.on('battleStart', () => {
      for (const ps of battle.players || []) {
        const pid = ps.playerId;
        if (!count(pid, LONGDE)) continue;
        let layers = 0;
        for (const id of activeBondIds(battle, pid) || []) layers += bondLayers(battle, pid, id);
        const n = Math.min(9, Math.floor(layers / 1000));
        if (n <= 0) continue;
        const ops = (battle.allyUnits || []).filter((u) => u && u.alive && u.side === 'ally' && u.kind === 'op' && u.ownerId === pid);
        if (!ops.length) continue;
        let atk = 0, hp = 0;
        for (const u of ops) { atk += Number(u.s && u.s.atk) || 0; hp += Number(u.s && u.s.maxHp) || 0; }
        if (!(atk > 0) || !(hp > 0)) continue;
        const share = 0.3;
        // 0.3.3 spawnYanyou(battle, playerId, { atk, hp, atkMul, dmgTakenMul, count })：`limit` / `spread` 已由数据
        // 记录自己的 deployLimit 决定，参考包多传的两个键在这里被忽略（等价）。
        const out = spawnYanyou(battle, pid, { atk: atk * share, hp: hp * share, count: n, atkMul: 1, dmgTakenMul: 1 });
        for (const y of out) y.mem.bondYan = true;
      }
    }, { priority: 6 });
  }

  // 回归基本功（传说，owner 2026-10-20）：不再自动回复技力（spRecoveryMul 0），攻击力提升 1000%（atkPct 10 = ×11）。
  if (has('jibian_jibengong')) {
    const KEY = 'jibian:jibengong';
    const apply = (u) => {
      if (!u || u.side !== 'ally') return;
      try { battle.addBuff(u, { key: KEY, mods: { atkPct: 10, spRecoveryMul: 0 } }); } catch { /* 不影响对局 */ }
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 六眼（传说）：「你的所有干员技力消耗-90%」= spCostMul 0.1（技力公式 floor(base × mul + flat)）。
  if (has('jibian_liuyan')) {
    const cheap = (u) => {
      if (!u || u.side !== 'ally') return;
      if (u.skill && !u.skill.noSkill) u.skill.spCostMul = 0.1;
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) cheap(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => cheap(ctx && ctx.unit));
  }

  // 惊变羁绊（战斗侧）：每个玩家各自一份（自己的卡 → 自己的单位），不再并成全队一份
  try {
    for (const [pid, ids] of picks) installJibianBonds(battle, new Set(ids.keys()), pid);
  } catch { /* 不能因为羁绊把对局搞崩 */ }

  // 仇名录（稀有，owner 2026-10-25）：攻击力 +2%，每击倒一名敌人永久额外 +0.2%
  if (has('jibian_chouminglu')) {
    const KEY = 'jibian:chouminglu';
    const kills = new Map();
    const nOf = (pid) => count(pid, 'jibian_chouminglu');
    const apply = (u) => {
      if (!u || u.side !== 'ally' || u.kind !== 'op' || u.ownerId == null) return;
      const n = nOf(u.ownerId);
      if (!(n > 0)) return;
      const atkPct = 0.02 * n + 0.002 * (kills.get(u.ownerId) || 0) * n;
      try { battle.addBuff(u, { key: KEY, mods: { atkPct }, refresh: 'replace', persist: true, allowDead: true }); } catch { /* 不影响对局 */ }
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
    battle.on('kill', (ctx) => {
      const k = ctx && ctx.killer;
      if (!k || k.side !== 'ally' || k.ownerId == null || !(nOf(k.ownerId) > 0)) return;
      kills.set(k.ownerId, (kills.get(k.ownerId) || 0) + 1);
      for (const u of battle.allies()) if (u && u.ownerId === k.ownerId) apply(u);
    });
  }

  // 霸王血铠（稀有，owner 2026-10-26）：获得相当于自身生命值 20% 的额外攻击力
  if (has('jibian_bawangxuekai')) {
    const KEY = 'jibian:bawangxuekai';
    const apply = (u) => {
      if (!u || u.side !== 'ally' || u.kind !== 'op' || u.ownerId == null) return;
      if (!(count(u.ownerId, 'jibian_bawangxuekai') > 0)) return;
      const hp = Number(u.s && u.s.maxHp) || 0;
      const atk = Math.max(0, Math.floor(hp * 0.2));
      if (!(atk > 0)) return;
      try { battle.addBuff(u, { key: KEY, mods: { atkFlat: atk }, refresh: 'replace', persist: true, allowDead: true }); } catch { /* 不影响对局 */ }
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 11 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
    battle.on('layerGain', () => { for (const u of battle.allies()) apply(u); });
  }

  // 心之钢（传说，owner 2026-10-26）：攻击额外造成 700(+3% 最大生命) 物理伤害并永久 +10% 该伤害的最大生命
  //   （每个目标 30s 冷却）；每 10000 最大生命 +3% 体型（纯视觉）。
  if (has('jibian_xinzhigang')) {
    const KEY = 'jibian:xinzhigang';
    const CD = 30, BASE = 700, HP_RATIO = 0.03, GAIN_RATIO = 0.1;
    const last = new Map();   // 目标 uid → 上次触发时间
    const grow = new Map();   // 单位 uid → 累计永久最大生命
    const refreshScale = (u) => {
      if (!u) return;
      setVisScalePart(u, 'heartsteel', heartsteelScale(Number(u.s && u.s.maxHp) || 0));
    };
    const applyHp = (u) => {
      const n = grow.get(u.uid ?? u.id) || 0;
      if (!(n > 0)) return;
      try { battle.addBuff(u, { key: KEY, mods: { hpFlat: n }, refresh: 'replace', persist: true, allowDead: true }); } catch { /* 不影响对局 */ }
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) { applyHp(u); refreshScale(u); } }, { priority: 12 });
    battle.on('deploy', (ctx) => { const u = ctx && ctx.unit; if (u) { applyHp(u); refreshScale(u); } });
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const src = (ctx && (ctx.credit ?? ctx.source)) || null;
      const t = ctx && ctx.target;
      if (!dmg || !src || !t || src.side !== 'ally' || src.kind !== 'op' || t.side !== 'enemy' || !src.alive) return;   // 仅干员
      if (!(count(src.ownerId, 'jibian_xinzhigang') > 0)) return;
      // 附加伤害自己触发的 hit 不再连锁（伤害 tag 是主保险；battle.mem 不是 0.3.3 的字段，故只作兼容读）
      if (Array.isArray(dmg.tags) && dmg.tags.includes('jibian:xinzhigang')) return;
      const tid = t.uid ?? t.id;
      const now = Number(battle.time) || 0;
      const prev = last.get(tid);
      if (prev != null && now - prev < CD) return;
      last.set(tid, now);
      const hp = Number(src.s && src.s.maxHp) || 0;
      const amount = BASE + hp * HP_RATIO;
      try { battle.dealDamage(src, t, { amount, type: 'phys', canDodge: false, tags: ['jibian:xinzhigang'] }); }
      catch { /* 目标已离场等 */ }
      try { battle.fx('heartsteel', { x: src.x, y: src.y, id: src.id, src: src.id }); } catch { /* 音效事件失败不影响伤害 */ }
      const gain = amount * GAIN_RATIO;
      const k = src.uid ?? src.id;
      grow.set(k, (grow.get(k) || 0) + gain);
      applyHp(src);
      try { battle.heal(src, src, gain, { self: true }); } catch { /* ignore */ }
      for (const u of battle.allies()) if (u.ownerId === src.ownerId) refreshScale(u);
    });
  }

  // 火力不足恐惧症：我方干员开技能 → 子弹数翻倍
  if (has('jibian_huolibuzu')) {
    battle.on('skillStart', ({ unit, skill }) => { doubleAmmoForJibian(battle, unit, skill); }, { priority: -20 });
    battle.on('skillEnd', ({ skill }) => { if (skill) skill.jibianHuoliDone = false; });
  }

  // 数万真言（史诗）：技力需求 +100%（spCostMul 2），技能持续期间攻击力 +300%（skillStart/skillEnd 挂 buff）
  if (has('jibian_shuwanzhenyan')) {
    const ATK_KEY = P + 'shuwanzhenyan:atk';
    const bump = (u) => {
      if (!u || u.side !== 'ally') return;
      if (u.skill && !u.skill.noSkill) u.skill.spCostMul = 2;
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) bump(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => bump(ctx && ctx.unit));
    battle.on('skillStart', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.side !== 'ally' || !u.alive) return;
      battle.addBuff(u, { key: ATK_KEY, mods: { atkPct: 3 } });
    });
    battle.on('skillEnd', (ctx) => {
      const u = ctx && ctx.unit;
      if (u) battle.removeBuff(u, ATK_KEY);
    });
  }

  // 无下限术式（传说）：「你的所有干员获得99.9%的闪避」（dodgePhys / dodgeArts 按 1 − Π(1−p) 合成）
  if (has('jibian_wuxiaxian')) {
    const DODGE_KEY = P + 'wuxiaxian';
    const apply = (u) => {
      if (!u || u.side !== 'ally') return;
      passiveBuff(battle, u, `${DODGE_KEY}:${u.uid ?? ''}`, { dodgePhys: 0.999, dodgeArts: 0.999 });
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // ---- 0. per-piece refs (超大杯): only the operator the card named, wherever it stands.
  if (scoped.length) {
    const apply = (u) => {
      if (!u || u.side !== 'ally' || u.uid == null) return;
      for (const s of scoped) {
        if (String(s.params.uid) !== String(u.uid)) continue;
        if (s.id === 'chaodabei') {
          passiveBuff(battle, u, `${P}chaodabei:${u.uid}`, { ...directMods({ atk: Number(s.params.atkPct) || 2 }), spRecoveryFlat: Number(s.params.spRecoveryFlat) || 2 });
        }
      }
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // ---- 0b. 金酒之杯: one buff per operator per pick, from the numbers the prep side wrote into `params`.
  if (cup.size) {
    const apply = (u) => {
      if (!u) return;
      const list = cup.get(u.ownerId);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const p = list[i] || {};
        const aspd = Number.isFinite(p.aspd) ? p.aspd : 0;
        const atk = Number.isFinite(p.atkPct) ? p.atkPct : 0;
        const hp = Number.isFinite(p.hpPct) ? p.hpPct : 0;
        if (!aspd && !atk && !hp) continue;
        passiveBuff(battle, u, `${P}jinjiuzhibei:${i}`, { ...directMods({ atk, hp }), ...(aspd ? { aspd } : {}) });
      }
    };
    battle.on('battleStart', () => {
      for (const pid of cup.keys()) for (const u of ownUnits(battle, pid)) apply(u);
    }, { priority: 10 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // ---- 1. passives on every own operator, from battle start on.
  // priority 10: 晚安教官 / 星界躯体 pick 场上生命最高的干员 by the operator's OWN max HP, so this runs before the
  // battleStart handlers that add HP.
  battle.on('battleStart', () => {
    for (const [pid, ids] of picks) {
      const ops = playerOps(battle, pid);
      for (const u of ops) {
        for (const [id, modsOf] of OP_PASSIVES) {
          const n = ids.get(id) ?? 0;
          if (n > 0) passiveBuff(battle, u, P + id, modsOf(n));
        }
        // 嗜血: "你的干员不再成为友方单位的治疗目标" — 引擎的 noHeal 旗标（自身吸血是 self heal，仍然生效）
        if (ids.has('jibian_shixue')) {
          battle.addBuff(u, { key: P + 'jibian_shixue', flags: { noHeal: true }, persist: true, allowDead: true, refresh: 'replace' });
        }
      }
      // 晚安教官 / 星界躯体: ONE operator (highest max HP on the field at battle start)
      const field = playerOps(battle, pid, { fieldOnly: true });
      if (field.length) {
        let top = field[0];
        for (const u of field) if (u.s.maxHp > top.s.maxHp) top = u;
        const nW = ids.get('jibian_wananjiaoguan') ?? 0;
        const nX = ids.get('jibian_xingjieshenti') ?? 0;
        if (nW > 0) passiveBuff(battle, top, P + 'jibian_wananjiaoguan', { hpPct: 1 * nW, defFlat: 400 * nW, blockCnt: 2 * nW });
        // ★ 2026-10-26（owner）：星界躯体改成「我方每个干员生命值 +150%」
        if (nX > 0) for (const u of field) passiveBuff(battle, u, P + 'jibian_xingjieshenti', { hpPct: 1.5 * nX });
      }
    }
  }, { priority: 10 });

  // ---- 1b. 腐蚀（owner 2026-10-16）: 被阻挡的敌方单位每秒失去 4% 当前防御/法抗。
  if (has('jibian_fushi')) {
    const seen = new WeakSet();
    battle.every(0.5, () => {
      for (const e of battle.enemies) {
        if (!e || !e.alive) continue;
        if (!e.blockedBy) {
          if (e.findBuff && e.findBuff(P + 'jibian_fushi:mod')) battle.removeBuff(e, P + 'jibian_fushi:mod');
          continue;
        }
        if (seen.has(e)) continue;
        seen.add(e);
        battle.addBuff(e, {
          key: P + 'jibian_fushi', duration: Infinity, interval: 1, refresh: 'replace', visible: true,
          onTick: () => {
            if (!e.alive || !e.blockedBy) return;
            const def = Number(e.s && e.s.def), res = Number(e.s && e.s.res);
            if (!(def > 0) && !(res > 0)) return;
            battle.addBuff(e, {
              key: P + 'jibian_fushi:mod', duration: Infinity, refresh: 'replace', visible: false,
              mods: { defFlat: -def * 0.04, resFlat: -res * 0.04 },
            });
          },
        });
      }
    });
  }

  // ---- 1c. 冰霜光环（owner 2026-10-16）: 每 10 秒，你的干员对周围敌人施加寒冷 2s（多次拿按次数缩短间隔）。
  if (has('jibian_shuangguanghuan')) {
    battle.on('battleStart', () => {
      for (const [pid, ids] of picks) {
        const n = ids.get('jibian_shuangguanghuan') ?? 0;
        if (n <= 0) continue;
        const pulse = () => {
          for (const u of playerOps(battle, pid)) {
            if (!u || !u.alive) continue;
            for (const e of battle.foesInRadius(u.x, u.y, 1.5)) battle.applyStatus(e, 'cold', { duration: 2, source: u });
          }
        };
        pulse();
        battle.every(10 / n, pulse);
      }
    }, { priority: 5 });
  }

  // ---- 1d. 大乱斗（owner 2026-10-16）: 战斗开始时你的所有干员部署位置随机改变（只在自己的合法可部署格里洗牌，
  //   近战/远程分开；用 battle.rng ⇒ 同种子可复现）。出老千时不改位置、攻击力加成保留。
  if (has('jibian_daluandou')) {
    const isRangedUnit = (u) => u?.def?.position === 'RANGED' || u?.profile?.attack === 'RANGED';
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) { const j = battle.rng.int(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      return arr;
    };
    battle.on('battleStart', () => {
      for (const [pid, ids] of picks) {
        if (!(ids.get('jibian_daluandou') ?? 0)) continue;
        const noShuffle = cheatPicks(battle);
        if (noShuffle) { for (const u of playerOps(battle, pid)) { if (u && u.alive) passiveBuff(battle, u, P + 'daluandou:atk', { atkMul: 2 }); } continue; }
        const ps = (battle.players || []).find((p) => p && p.playerId === pid);
        if (!ps) continue;
        const melee = [], ranged = [];
        for (let r = 0; r < GEO.ROWS; r++) {
          for (let c = 0; c < GEO.COLS; c++) {
            if (!battle.grid.inRect(r, c) || !battle.onOwnBoard(ps, r, c)) continue;
            if (battle.grid.canStand(r, c, { ranged: false })) melee.push([r, c]);
            else if (battle.grid.canStand(r, c, { ranged: true })) ranged.push([r, c]);
          }
        }
        const ops = playerOps(battle, pid).filter((u) => u && u.alive && !u.removed && u.kind === 'op');
        const mUnits = shuffle(ops.filter((u) => !isRangedUnit(u)));
        const rUnits = shuffle(ops.filter(isRangedUnit));
        const freeM = shuffle(melee.filter(([r, c]) => !battle.isReservedTile(r, c)));
        const freeR = shuffle(ranged.filter(([r, c]) => !battle.isReservedTile(r, c)));
        for (const u of mUnits) { const t = freeM.pop(); if (t) battle.relocate(u, t[0], t[1]); }
        for (const u of rUnits) { const t = freeR.pop(); if (t) battle.relocate(u, t[0], t[1]); }
        // ★ 2026-10-17（用户）：位置被打乱，但攻击力翻倍
        for (const u of ops) passiveBuff(battle, u, P + 'daluandou:atk', { atkMul: 2 });
      }
    }, { priority: 5 });
  }

  // ---- 1e. 薛定谔的猫（owner 2026-10-16）: 战斗开始时每个干员随机「无法被击倒」或「立刻被击倒且无法再部署」。
  //   不死的走 `fatal` 钩子把伤害按回去；处决的走正常 dealDamage，所以「自爆卡车」这类死亡钩子照常触发。
  //   0.3.3：`u.redeployLocked` 已不存在，改写成 `u.respawnAt = Infinity`（_checkRedeploys 便永远不会把它放回来）。
  if (has('jibian_xuedingedemao')) {
    battle.on('battleStart', () => {
      for (const [pid, ids] of picks) {
        if (!(ids.get('jibian_xuedingedemao') ?? 0)) continue;
        for (const u of playerOps(battle, pid)) {
          if (!u || !u.alive) continue;
          const lucky = cheatPicks(battle) ? true : battle.rng() < 0.5;
          u.mem.catLucky = lucky;
          if (!lucky) {
            try {
              battle.dealDamage(null, u, { amount: 1e9, type: 'true', canDodge: false, sourceless: true, tags: ['cat'] });
            } catch { /* 已倒地/不可选中：跳过 */ }
            if (!u.alive) u.respawnAt = Infinity;
          }
        }
      }
    }, { priority: 5 });
    battle.on('fatal', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.side !== 'ally' || !u.mem || !u.mem.catLucky) return;
      ctx.prevented = true;
      if (u.hp < 1) u.hp = 1;
    }, { priority: -999 });
  }

  // ---- 黑闪（jibian_heishan，传说，现代最强）：暴击率 +50 个百分点；每次暴击回 3 技力。
  //   暴击本身由 `server/sim/content/forge.js`（锻造器战斗侧）实现：它在 `hit` 里读 `s.critRate` 掷骰、命中时把
  //   `dmg.mul *= 2` 并置 `dmg.crit`。所以这张卡只做两件事：① 挂 `critRate: 0.5` 的常驻 buff（与锻造器 5% 基础加算）；
  //   ② 注册 priority -10 的 hit 钩子（排在 forge 之后），看到 `dmg.crit` 就给出手者 +3 技力，每次暴击都回、无上限。
  //   生效前提：`battle.flags.forge`（engine-core T11）或炸惊视图 `battle.zj` 非空 —— 否则 forge 不装、`s.critRate`
  //   不会被任何钩子读，这张卡就是惰性的（官方四档 / 湮灭房本来也抽不到它）。
  for (const [pid, ids] of picks) {
    if (!(ids.get('jibian_heishan') ?? 0)) continue;
    const HEISHAN_CRIT = P + 'heishan:crit';
    const applyOne = (u) => {
      if (!u || u.side !== 'ally' || u.removed || u.ownerId !== pid) return;
      const canCrit = u.kind === 'op' || Number(u.s && u.s.critRate) > 0;
      if (!canCrit) return;
      if (typeof u.findBuff === 'function' && u.findBuff(HEISHAN_CRIT)) return;
      battle.addBuff(u, { key: HEISHAN_CRIT, mods: { critRate: 0.5 }, persist: true });
    };
    for (const u of battle.allyUnits) applyOne(u);
    battle.on('deploy', (ctx) => applyOne(ctx && ctx.unit));
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const s = ctx && (ctx.credit ?? ctx.source);
      if (!dmg || !dmg.crit || !s || s.side !== 'ally' || s.ownerId !== pid) return;
      if (s.skill && typeof s.skill.gainSp === 'function') s.skill.gainSp(3, 'jibian');
    }, { priority: -10 });
  }

  // ---- 1e-2. 加入大群 / 叠层手：特质加层发生在 sim 里（gainLayers → battle.addLayers, reason='garrison'），
  //   所以在加层的那一刻处理 —— battle 的 layerGain 钩子。需要的两个 prep 侧事实由 match 写进 jibianFlags。
  {
    const jiaru = has('jibian_jiarudaqun');
    const diec = has('jibian_diecengshou');
    if (jiaru || diec) {
      battle.on('layerGain', (ctx) => {
        const pid = ctx && ctx.playerId;
        if (!pid || !(ctx.n > 0)) return;
        if (!/^garrison(:|$)/.test(String(ctx.reason || ''))) return;
        const ps = (battle.players || []).find((p) => p && p.playerId === pid);
        const flags = (ps && (ps.jibianFlags || (ps.input && ps.input.jibianFlags))) || {};
        const extra = jibianGarrisonExtra(ctx.n, {
          bondId: ctx.bondId,
          jiaru: jiaru && count(pid, 'jibian_jiarudaqun') > 0,
          skadi: !!flags.skadi,
          diecengshou: diec && count(pid, 'jibian_diecengshou') > 0,
          doubler: !!flags.doubler,
        });
        if (extra > 0) ctx.n += extra;
      });
    }
  }

  // ---- 1f. 赤霄剑法（owner 2026-10-16）: 所有干员造成的伤害改为弱点伤害（物理/法术里取目标抗性更低的那种）。
  if (has('jibian_chixiaojianfa')) {
    // 打开赤刃明霄陈三技能剑气波的每击上限（[ASSUMED] kits/ops/op-chen3.js 需读这个 battle 字段）
    battle.jibianChen3WaveCap = 200000000;
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const src = (ctx && (ctx.credit ?? ctx.source)) || null;
      const t = ctx && ctx.target;
      if (!dmg || !src || !t || src.side !== 'ally' || t.side !== 'enemy') return;
      try { weaknessRetype(dmg, src, t); } catch { /* 目标已离场：跳过 */ }
    });
  }

  // ---- 2. 击杀: 罪恶快感（20 技力）
  if (has('jibian_zuiegankuai')) {
    battle.on('kill', (ctx) => {
      const killer = ctx && ctx.killer;
      const victim = ctx && ctx.victim;
      if (!killer || !victim || victim.side !== 'enemy' || killer.side !== 'ally') return;
      const nZ = count(killer.ownerId, 'jibian_zuiegankuai');
      if (nZ > 0 && killer.skill) for (let i = 0; i < nZ; i++) killer.skill.gainSp(20, 'jibian');
    });
  }

  // 坦克引擎（owner 2026-10-26）：击杀 +1 层：体型 +5%、最大生命 +5%，可无限叠加；阵亡损失 65% 层数。
  if (has('jibian_tankeyinqing')) {
    const KEY = P + 'jibian_tankeyinqing:layers';
    const layers = new Map();
    const keyOf = (u) => u.uid ?? u.id;
    const owned = (u) => !!u && u.side === 'ally' && u.kind === 'op' && count(u.ownerId, 'jibian_tankeyinqing') > 0;
    const apply = (u) => {
      if (!owned(u)) return;
      const n = layers.get(keyOf(u)) || 0;
      try { battle.addBuff(u, { key: KEY, mods: { hpPct: 0.05 * n }, refresh: 'replace', persist: true, allowDead: true }); } catch { /* 不影响对局 */ }
      setVisScalePart(u, 'tank', 1 + 0.05 * n);
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 12 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
    battle.on('kill', (ctx) => {
      const k = ctx && ctx.killer;
      if (!k || !owned(k)) return;
      const id = keyOf(k);
      layers.set(id, (layers.get(id) || 0) + 1);
      apply(k);
    });
    battle.on('death', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || !owned(u)) return;
      const id = keyOf(u);
      const n = layers.get(id) || 0;
      if (!(n > 0)) return;
      layers.set(id, Math.floor(n * 0.35));
      apply(u);
    });
  }

  // 缩小引擎（owner 2026-10-26）：击杀 +1 层：体型 -4%、技力恢复 +0.05/s，无限叠加；阵亡损失 65% 层数。
  if (has('jibian_suoxiaoyinqing')) {
    const KEY = P + 'jibian_suoxiaoyinqing:layers';
    const layers = new Map();
    const keyOf = (u) => u.uid ?? u.id;
    const owned = (u) => !!u && u.side === 'ally' && u.kind === 'op' && count(u.ownerId, 'jibian_suoxiaoyinqing') > 0;
    const apply = (u) => {
      if (!owned(u)) return;
      const n = layers.get(keyOf(u)) || 0;
      try { battle.addBuff(u, { key: KEY, mods: { spRecoveryFlat: 0.05 * n }, refresh: 'replace', persist: true, allowDead: true }); } catch { /* 不影响对局 */ }
      setVisScalePart(u, 'shrink', 1 - 0.04 * n);
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 12 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
    battle.on('kill', (ctx) => {
      const k = ctx && ctx.killer;
      if (!k || !owned(k)) return;
      const id = keyOf(k);
      layers.set(id, (layers.get(id) || 0) + 1);
      apply(k);
    });
    battle.on('death', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || !owned(u)) return;
      const id = keyOf(u);
      const n = layers.get(id) || 0;
      if (!(n > 0)) return;
      layers.set(id, Math.floor(n * 0.35));
      apply(u);
    });
  }

  // ---- 3. 攻击后: 踢踏舞（攻速叠层）/ 美国子弹（范围内随机敌人吃 40% 攻击力物理伤害）
  if (has('jibian_titawu') || has('jibian_meiguozidan')) {
    battle.on('attack', (ctx) => {
      const a = ctx && ctx.attacker;
      if (!a || a.side !== 'ally') return;
      const pid = a.ownerId;
      // 踢踏舞: 普通攻击后才叠（技能自身的命中不算普通攻击），每次 +2 攻速 2s，'stack' 刷新计时
      const nT = count(pid, 'jibian_titawu');
      if (nT > 0 && !ctx.isSkill) {
        for (let i = 0; i < nT; i++) battle.addBuff(a, { key: P + 'jibian_titawu', mods: { aspd: 2 }, duration: 2, refresh: 'stack', maxStacks: 1e6 });
      }
      // 美国子弹: 每次攻击（含技能攻击）各发一颗，目标为攻击范围内随机一名敌人
      const nB = count(pid, 'jibian_meiguozidan');
      if (nB > 0) {
        const foes = battle.enemiesInKeys(a.rangeKeys, a, a.profile);
        if (foes.length) {
          for (let i = 0; i < nB; i++) {
            const t = foes[Math.floor(battle.rng() * foes.length) % foes.length];
            if (!t || !t.alive) continue;
            battle.dealDamage(a, t, battle.makeDamage({ amount: a.s.atk * 0.4, type: 'phys', isAttack: true, isProjectile: true, tags: ['jibian'] }));
          }
        }
      }
    });
  }

  // ---- 4. 普通攻击吸血: 吸血习性 (15%) / 嗜血 (25%)。`beforeAttack` 记下这一击是不是技能（伤害管线同步）。
  if (has('jibian_xixuexixing') || has('jibian_shixue')) {
    const inFlight = new Map();
    battle.on('beforeAttack', (ctx) => {
      const a = ctx && ctx.attacker;
      if (a && a.side === 'ally') inFlight.set(a.id, !!ctx.isSkill);
    });
    battle.on('damaged', (ctx) => {
      const s = ctx && ctx.source;
      const t = ctx && ctx.target;
      if (!s || !t || s.side !== 'ally' || t.side !== 'enemy') return;
      if (inFlight.get(s.id)) return;                 // 技能伤害不算普通攻击
      if (!(ctx.amount > 0) || !s.alive) return;
      const nS = count(s.ownerId, 'jibian_shixue');
      const nX = count(s.ownerId, 'jibian_xixuexixing');
      const pct = 0.25 * nS + 0.15 * nX;
      if (pct > 0) battle.heal(s, s, ctx.amount * pct, { self: true });
    });
  }

  // ---- 5. 你摸不到: 开启技能后无敌 1s
  if (has('jibian_nimobudao')) {
    battle.on('skillStart', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.side !== 'ally') return;
      const n = count(u.ownerId, 'jibian_nimobudao');
      if (n > 0) battle.addBuff(u, { key: P + 'jibian_nimobudao', flags: { invulnerable: true }, duration: 1 * n, refresh: 'replace', visible: true });
    });
  }

  // ---- 6. ？！冰？！: 寒冷/冻结持续时间翻倍（+ 卡主专属音效 cue）
  if (has('jibian_bing')) {
    battle.on('beforeStatus', (ctx) => {
      if (!ctx || (ctx.status !== 'cold' && ctx.status !== 'freeze')) return;
      const src = ctx.source;
      if (!src || src.side !== 'ally') return;
      const n = count(src.ownerId, 'jibian_bing');
      if (n <= 0) return;
      if (Number.isFinite(ctx.duration)) ctx.duration *= 1 + n;
      battle.fx('jibianBing', { x: src.x ?? 0, y: src.y ?? 0, id: src.id, owner: src.ownerId, status: ctx.status });
    });
  }

  // ---- 7. per-instance damage multipliers — ？！冰？！ (+50% vs a chilled/frozen target) / 元素大师 (burst ×2)
  if (has('jibian_bing') || has('jibian_yuansudashi')) {
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const s = (ctx && (ctx.credit ?? ctx.source)) || null;
      const t = ctx && ctx.target;
      if (!dmg || !s || !t || s.side !== 'ally' || t.side !== 'enemy') return;
      const nB = count(s.ownerId, 'jibian_bing');
      if (nB > 0 && chilled(t)) dmg.mul *= 1 + 0.5 * nB;
      // 元素大师: 爆发的每一跳都带 'burst' tag（即时命中 / 凋亡每秒 / 侵蚀真伤），所以爆发的伤害全部翻倍
      const nE = count(s.ownerId, 'jibian_yuansudashi');
      if (nE > 0 && Array.isArray(dmg.tags) && dmg.tags.includes('burst')) dmg.mul *= 1 + nE;
    });
  }

  // ---- 8. 文明的存续: 对敌方造成的真实伤害 +200%
  if (has('jibian_wenmingdecunxu')) {
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || !e.alive) return;
      const pid = enemyOwner(battle, e);
      const n = count(pid, 'jibian_wenmingdecunxu');
      if (n > 0) battle.addBuff(e, { key: P + 'jibian_wenmingdecunxu', mods: { trueTakenMul: 1 + 2 * n }, persist: true });
    });
  }

  // ===================================================================================================================
  // 第二批（12 张盟约惊变 + 8 张通用惊变）—— 战斗侧
  // ② 等待雪 / ③ 银质子弹 / ④ 骑士竞技 / ⑤ 老霸道了 / ⑬ 假想敌 / ⑰⑱ 类型转换 都挂在 `hit`（dmg 可变）；
  // ⑨ ？！拉拉？！挂 `kill` + gainLayers；⑯ 自爆卡车挂 `death`；⑬ 假想敌另在 battleStart/deploy 铺额外目标格。
  const NEW_HIT = ['jibian_dengdaixue', 'jibian_chunyinzidan', 'jibian_qishijingji', 'jibian_laobadao',
    'jibian_mofazhuanwuli', 'jibian_wulizhuanmofa', 'jibian_jiaxiangdi'];
  if (NEW_HIT.some((id) => has(id))) {
    // ④ 骑士竞技 需要"这一击锁定了几个目标"：hit/damaged 的 ctx 都没有目标数，只有 ai.js 的 `attack` 钩子有 `targets`。
    const attackTargets = new Map();
    battle.on('attack', (ctx) => {
      const a = ctx && ctx.attacker;
      if (!a || a.side !== 'ally') return;
      attackTargets.set(a.id, Array.isArray(ctx.targets) ? ctx.targets.length : 0);
    });
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const s = (ctx && (ctx.credit ?? ctx.source)) || null;
      const t = ctx && ctx.target;
      if (!dmg || !s || !t || s.side !== 'ally' || t.side !== 'enemy') return;
      const pid = s.ownerId;
      const n = (id) => count(pid, id);
      const isDot = Array.isArray(dmg.tags) && (dmg.tags.includes('dot') || dmg.tags.includes('periodic'));

      // ② 等待雪，埋葬这一切 —— 谢拉格干员造成伤害时 30% 概率 3s 寒冷 + 20% 脆弱
      const nSnow = n('jibian_dengdaixue');
      if (nSnow > 0 && isMember(battle, s, 'kjeragShip') && battle.rng() < 0.3) {
        battle.applyStatus(t, 'cold', { duration: 3, source: s });
        battle.applyStatus(t, 'fragile', { duration: 3, value: 0.2, source: s });
      }
      // ③ 银质子弹 —— 拉特兰干员造成伤害时挂可叠加流血（1% 最大生命/s，单跳 ≤ 20 万，3s）。流血自己的 tick 跳过。
      const nSilver = n('jibian_chunyinzidan');
      if (nSilver > 0 && !isDot && isMember(battle, s, 'lateranoShip')) {
        for (let i = 0; i < nSilver; i++) {
          battle.addBuff(t, {
            key: P + 'chunyinzidan', duration: 3, interval: 1, refresh: 'stack', maxStacks: 1e6, visible: false,
            onTick: ({ battle: b, unit }) => {
              const per = Math.min(200000, (unit.s.maxHp || 0) * 0.01);
              b.dealDamage(s.alive ? s : null, unit, periodicDamage(per));
            },
          });
        }
      }
      // ④ 骑士竞技 —— 仅对一名敌方单位造成伤害时 +400%（×5/张）
      const nJoust = n('jibian_qishijingji');
      if (nJoust > 0 && !isDot && attackTargets.get(s.id) === 1 && isMember(battle, s, 'kazimierzShip')) {
        dmg.mul *= 1 + 4 * nJoust;
      }
      // ⑤ “老霸道了” —— 攻击范围总格数 > 7 时，同时对多名敌人造成伤害的伤害 +325%
      //   （溅射受害者不在 attack 钩子的 targets 里，所以 dmg.isSplash 与 targets > 1 两条都算）
      const nBoss = n('jibian_laobadao');
      if (nBoss > 0 && (dmg.isSplash || (attackTargets.get(s.id) || 0) > 1) && isMember(battle, s, 'kazimierzShip')) {
        const cells = Array.isArray(s.baseRangeKeys) ? s.baseRangeKeys.length : (Array.isArray(s.rangeKeys) ? s.rangeKeys.length : 0);
        if (cells > 7) dmg.mul *= 1 + 3.25 * nBoss;
      }
      // ⑰⑱ 魔法转物理（+30%）/ 物理转魔法 —— 按原始类型判，两张同时在手时不互抵（魔法转物理优先）。
      //   ★ 羁绊「伤害转伤害」已把这次伤害改成真伤时，这两张卡不要再把它转回物理/法术。
      if (dmg.type === 'true') return;
      const origType = dmg.type;
      const nA2P = n('jibian_mofazhuanwuli');
      const nP2A = n('jibian_wulizhuanmofa');
      if (nA2P > 0 && (origType === 'arts' || nP2A > 0)) { dmg.type = 'phys'; dmg.mul *= 1 + 0.3 * nA2P; }
      else if (origType === 'phys' && nP2A > 0) { dmg.type = 'arts'; }
      // ⑬ 假想敌 —— 打的是"攻击范围之外"的敌人，伤害 ×0.3
      const nAir = n('jibian_jiaxiangdi');
      if (nAir > 0 && !isDot && !inBaseRange(s, t)) dmg.mul *= 0.3;
    });
  }

  // ⑬ 假想敌 —— 把每个己方干员的额外目标格铺满全场（索敌仍按引擎优先级）
  if (has('jibian_jiaxiangdi')) {
    const allKeys = [];
    for (let k = 0; k < GEO.ROWS * GEO.COLS; k++) allKeys.push(k);
    const spread = (u) => { if (u && u.side === 'ally' && u.kind === 'op') battle.setExtraRange(u, allKeys); };
    battle.on('battleStart', () => { for (const u of battle.allies()) spread(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => spread(ctx && ctx.unit));
  }

  // ⑨ ？！拉拉？！ —— 【叙拉古】干员击倒敌人时，已激活的【叙拉古】层数 +10
  if (has('jibian_lala')) {
    battle.on('kill', (ctx) => {
      const killer = ctx && ctx.killer;
      const victim = ctx && ctx.victim;
      if (!killer || !victim || victim.side !== 'enemy' || killer.side !== 'ally') return;
      const n = count(killer.ownerId, 'jibian_lala');
      if (n <= 0 || !isMember(battle, killer, 'siracusaShip')) return;
      for (let i = 0; i < n; i++) {
        gainLayers(battle, { playerId: killer.ownerId, bonds: 'siracusaShip', n: 10, requireActive: true, source: killer, reason: P + 'lala' });
      }
    });
  }

  // ⑱ 轻拍背部（稀有，现代最强羁绊）：因阻挡数不足而穿过干员的敌人，每只给该干员 +1 层次数盾
  //   [ASSUMED] 参考包用 `blockFull` 钩子；0.3.3 的 sim 没有这个事件（blocking.js 只发 `blocked`），需要 engine-core 补。
  if (has('jibian_qingpaibeibu')) {
    battle.on('blockFull', (c) => {
      const u = c && c.blocker;
      if (!u || u.kind !== 'op' || !u.s) return;
      if (count(u.ownerId, 'jibian_qingpaibeibu') <= 0) return;
      try { addShieldLayer(battle, u, 'jibian:qingpaibeibu', 999); } catch { /* 盾层出错不影响战斗 */ }
    }, { priority: -10 });
  }

  // ⑲ 折射（史诗，owner 2026-10-19）：所有干员法术抗性 +70
  if (has('jibian_zheshe')) {
    const apply = (u) => {
      if (!u || u.side !== 'ally') return;
      BOND_ATTR(battle, u, 'zheshe', { resFlat: 70 });
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) apply(u); }, { priority: 20 });
    battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  }

  // 鲁莽（普通）：全队攻击力 +200%、攻速 +60；每次攻击 30% 概率打空（本次伤害归零）
  if (has('jibian_lumang')) {
    const LUMANG_KEY = P + 'lumang';
    const applyLumang = (u) => {
      if (!u || u.side !== 'ally') return;
      passiveBuff(battle, u, `${LUMANG_KEY}:${u.uid ?? ''}`, directMods({ atk: 2 }, { aspd: 60 }));
    };
    battle.on('battleStart', () => { for (const u of battle.allies()) applyLumang(u); }, { priority: 10 });
    battle.on('deploy', (ctx) => applyLumang(ctx && ctx.unit));
    battle.on('hit', (ctx) => {
      const dmg = ctx && ctx.dmg;
      const src = ctx && (ctx.credit ?? ctx.source);
      if (!dmg || !src || src.side !== 'ally' || !dmg.isAttack) return;
      if (battle.rng() < 0.3) dmg.mul = 0;
    }, { priority: -50 });
  }

  // ⑰ 伟大封印（传说羁绊：三月五日 + 总攻击）—— 结城理死亡时处决血量最高的敌人，整局一次
  if (has('jibian_sanyuewuri') && has('jibian_zonggongji')) {
    battle.on('death', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.side !== 'ally' || u.kind !== 'op' || !u.s) return;
      const cid = String(u.chessId || u.baseId || u.defId || '');
      if (!cid.startsWith('chess_zj_60_5')) return;      // 只认结城理
      // ★ 按 owner 检查两张卡（队友的卡不能替自己触发）
      if (!(count(u.ownerId, 'jibian_sanyuewuri') > 0 && count(u.ownerId, 'jibian_zonggongji') > 0)) return;
      // ★ 整局（整场比赛）只触发一次 —— 上一次战斗的标记随 battleInput 带进来
      const simP = typeof battle.getPlayer === 'function' ? battle.getPlayer(u.ownerId) : null;
      if (simP && simP.input && simP.input.greatSealUsed) return;
      if (battle.__greatSealUsed) return;
      battle.__greatSealUsed = true;
      battle.__greatSealBan = { playerId: u.ownerId, round: Number(battle.round) || 0 };
      const foes = (battle.enemies || []).filter((e) => e && e.alive !== false && e.s);
      if (!foes.length) return;
      let top = foes[0];
      for (const e of foes) if ((Number(e.s.maxHp) || 0) > (Number(top.s.maxHp) || 0)) top = e;
      try {
        const amount = (Number(top.hp) || Number(top.s.maxHp) || 0) + 1e6;
        battle.dealDamage(u, top, battle.makeDamage({ amount, type: 'true', canDodge: false, tags: ['jibian', 'greatseal'] }));
      } catch { /* 目标已死：忽略 */ }
      try { battle.fx('greatseal', { x: top.x, y: top.y, id: top.id, playerId: u.ownerId }); } catch { /* 不影响处决 */ }
      // 本整备期不能再部署结城理：把标记写到玩家状态上（整备期部署时读它）
      try {
        const ps = (battle.players || []).find((p) => p && p.playerId === u.ownerId);
        const round = Number(battle.round) || 0;
        if (ps) {
          ps.mem = ps.mem || {};
          ps.mem.greatSealBanRound = round;
          if (ps.input && typeof ps.input === 'object') ps.input.greatSealBanRound = round;
          for (const piece of [...(ps.board || []), ...(ps.hand || [])]) {
            const pid = String((piece && (piece.chessId || piece.id)) || '');
            if (pid.startsWith('chess_zj_60_5')) piece.greatSealBanRound = round;
          }
        }
      } catch { /* 标记失败不影响处决 */ }
    }, { priority: 20 });
  }

  // ⑯ 自爆卡车 —— 干员被击倒时对半径 1.5 格的敌人造成 4000% 攻击力的法术伤害
  if (has('jibian_zibaokache')) {
    battle.on('death', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.side !== 'ally' || u.kind !== 'op' || !u.s) return;
      const n = count(u.ownerId, 'jibian_zibaokache');
      if (n <= 0) return;
      const foes = battle.foesInRadius(u.x ?? 0, u.y ?? 0, 1.5, true);
      for (const e of foes) {
        for (let i = 0; i < n; i++) {
          battle.dealDamage(u, e, battle.makeDamage({ amount: (u.s.atk || 0) * 40, type: 'arts', tags: ['jibian'] }));
        }
      }
    });
  }
}

// =====================================================================================================================
// prep side
//
// A `jibian:<id>` ref's onChoicePick fires exactly once, right after the ref is added (choices.js applyCard runs
// `choice:<id>` first, then re-dispatches the hook to the refs; ctx.source.kind is 'effect' on that second run).

/** 立刻获得 N 资金 (捐赠 / 我在马路边捡到一分钱). */
const FUNDS = { jibian_juanzeng: 15, jibian_malubian: 5 };

/** 惊变卡要用到的数据记录 (data/items.json)：奖杯 / 超大杯的道具记录由数据层提供，buff 走 attr_common_global_buff。 */
const ITEM_TROPHY = 'chess_item_jibian_trophy';
const ITEM_CUP = 'chess_item_jibian_chaodabei';
/** 板藤的卖价：起价 / 每回合涨幅 */
const BANTENG_START = 4;
const BANTENG_STEP = 4;

/** 高卢银行支票：三项初始权重（百分点，和 = 99）与固定的 +100 概率（百分点）。 */
const CHEQUE_START = Object.freeze({ up: 33, zero: 33, down: 33 });
const CHEQUE_JACKPOT = 0.1;
const CHEQUE_KILL_GAIN = 2;
const CHEQUE_LEAK_GAIN = 0.5;
const CHEQUE_SAVE_GAIN = 0.5;

/** 金酒之杯：每 5 资金 → 攻速 +7；资金 > 该阈值时每 5 资金再加 10% 攻击 / 生命。 */
const CUP_FUNDS_PER = 5;
const CUP_ASPD_PER = 7;
const CUP_BONUS_FUNDS = 50;
const CUP_ATKHP_PER = 0.1;

/** 极速送达！三档包裹 → 开启后随机的干员**阶**列表。 */
const JISUSONGDA_TIERS = Object.freeze({
  chess_item_jibian_jisusongda_normal: Object.freeze([1, 2, 3, 4]),
  chess_item_jibian_jisusongda_rare: Object.freeze([5]),
  chess_item_jibian_jisusongda_epic: Object.freeze([6]),
});
const JISUSONGDA_ITEM = 'chess_item_jibian_jisusongda_';

/** 精锐蕾缪安 / 耀骑士临光 / 贝洛内 / 克莱门莎 / 玛恩纳：炸惊棋库优先，取不到退回本体或普通表。 */
const LEMUEN_ELITE = ['chess_zj_78_b', 'chess_char_6_01_b'];
const NEARL_ELITE = ['chess_zj_89_b', 'chess_char_6_17_b'];
const BELONE_ELITE = ['chess_zj_76_b', 'chess_zj_76_a'];
const CLEMENTIA_ELITE = ['chess_zj_51_b', 'chess_zj_51_a'];
const MLYNAR_ELITE = ['chess_zj_75_b', 'chess_zj_75_a', 'chess_char_5_19_b', 'chess_char_5_19_a'];
/** 红松骑士团四名成员：[炸惊记录, 普通记录]。 */
const PINUS_GRANT = Object.freeze([
  ['chess_zj_15_a', 'chess_char_1_19_a'],   // 野鬃
  ['chess_zj_29_a', 'chess_char_2_18_a'],   // 灰毫
  ['chess_zj_61_a', 'chess_char_4_20_a'],   // 远牙
  ['chess_zj_60_a', 'chess_char_4_19_a'],   // 焰尾
]);

/** 浊心斯卡蒂 (加入大群: "当你获得了浊心斯卡蒂时此惊变效果翻倍"): 本体/精锐 + 炸惊变体. */
export const SKADI_CORRUPTED = Object.freeze(['chess_char_6_04_a', 'chess_char_6_04_b', 'chess_zj_81_a', 'chess_zj_81_b']);

/**
 * 「加入大群」/「叠层手」对**卫戍特质**（reason = garrison）加层的额外层数；0 = 不加。
 *   加入大群（仅【阿戈尔】egirShip）：+100%；拥有浊心斯卡蒂时效果翻倍 → 合计 ×3（额外 +2 份）。
 *   叠层手（所有盟约，仅生效期内）：再补一份 → ×2。两张卡各加自己那一份（加法，不是互相乘）。
 */
export function jibianGarrisonExtra(n, o = {}) {
  const base = Number(n) || 0;
  if (!(base > 0)) return 0;
  let extra = 0;
  if (o.jiaru && o.bondId === 'egirShip') extra += base * (o.skadi ? 2 : 1);
  if (o.diecengshou && o.doubler) extra += base;
  return extra;
}

/** ctx.counter 的键 (玩家级、跨回合持久)。全部带 `jibian:` 前缀。 */
const K = {
  freeChess: P + 'zhebeiwuqing:chess',
  freeItem: P + 'zhebeiwuqing:item',
  debtFrom: P + 'chaoqianxiaofei:from',
  debtTo: P + 'chaoqianxiaofei:to',
  banteng: P + 'banteng:value',
  layersUntil: P + 'diecengshou:until',
  specialTier: P + 'zishen:tier',
  vicCharge: P + 'weiduoliyademimi:charge',
  vicRefresh: P + 'weiduoliyademimi:pending',
  vicDiscount: P + 'weiduoliyademimi:discount',
  seq: P + 'seq',
  chequeW10: P + 'gaoluzhipiao:w10',
  chequeW0: P + 'gaoluzhipiao:w0',
  chequeWm10: P + 'gaoluzhipiao:wm10',
  chequeValue: P + 'gaoluzhipiao:value',
  touziPending: P + 'touziweilai:pending',
  jizhongyidian: P + 'jizhongyidian:until',
  pinusNoSell: P + 'hongsongqishituan:nosell',
  yanguoLast: P + 'yanguoyouji:last',
  devPay: P + 'emoxieyue:pay',
  mysCharge: P + 'shenmishangdian:charge',
  mysNext: P + 'shenmishangdian:next',
  mysPending: P + 'shenmishangdian:pending',
  cengFirst: P + 'cengshudaluan:first',
};

/** 这一次 onChoicePick 是不是「刚抽到这张卡」(choices.js 先跑 choice:<id>、再跑 ref 上的钩子). */
const justPicked = (ctx) => !!(ctx && ctx.source && ctx.source.kind === 'effect');

/** 惊变卡池 (mode 配置的 jibian.pool), 排除只会在「第二次抽取」出现的卡与快手。 */
function cardPool(ctx) {
  const modes = (ctx.data && ctx.data.config && ctx.data.config.modes) || {};
  const md = modes[ctx.modeId] || {};
  const pool = md.jibian && Array.isArray(md.jibian.pool) ? md.jibian.pool : [];
  return pool.filter((c) => c && c.effectId && !c.secondDrawOnly && c.effectId !== 'jibian_kuaishou');
}

/** 玩家的干员 (整备区 / 临时区 / 场上) —— 「随机一名干员」的样本. */
function ownPieces(ctx) {
  const out = [];
  for (const list of [ctx.board(), ctx.hand(), ctx.temp()]) for (const p of list || []) if (p && p.kind === 'chess') out.push(p);
  return out;
}

/** 随机取一个 (ctx.rng 是 meta 专用流, 和商店/战斗的随机互不干扰). */
const pick1 = (ctx, arr) => (arr && arr.length ? arr[Math.min(arr.length - 1, Math.floor(ctx.rng() * arr.length))] : null);

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** 高卢银行支票的三项当前权重（写不出有效的一组时退回初始 33/33/33）。 */
function chequeWeights(ctx) {
  const up = finite(ctx.counter(K.chequeW10), 0);
  const zero = finite(ctx.counter(K.chequeW0), 0);
  const down = finite(ctx.counter(K.chequeWm10), 0);
  if (!(up + zero + down > 0)) return { up: CHEQUE_START.up, zero: CHEQUE_START.zero, down: CHEQUE_START.down };
  return { up: Math.max(0, up), zero: Math.max(0, zero), down: Math.max(0, down) };
}

/** 把三项权重写回计数器。 */
function chequeStore(ctx, w) {
  ctx.setCounter(K.chequeW10, w.up);
  ctx.setCounter(K.chequeW0, w.zero);
  ctx.setCounter(K.chequeWm10, w.down);
}

/**
 * 掷出本次提现的状态：先看固定的 0.1% (+100)，再在 +10 / 0 / -10 三项里按各自权重归一化抽。
 * 四项初始权重 33/33/33/0.1 之和是 99.1，归一化让「+100 恰为 0.1%」与「三项之和不被 0.9 的余量带偏」同时成立。
 */
function chequeRoll(ctx, w) {
  const r = ctx.rng() * 100;
  if (r < CHEQUE_JACKPOT) return 100;
  const total = w.up + w.zero + w.down;
  if (!(total > 0)) return 0;
  let x = ((r - CHEQUE_JACKPOT) / (100 - CHEQUE_JACKPOT)) * total;
  if (x < w.up) return 10;
  x -= w.up;
  if (x < w.zero) return 0;
  return -10;
}

/**
 * 给 `key` 加 Δ，并从**另外两项**按当前比例扣掉同样多 —— 保证三项之和不变；某项扣到 0 就停止。
 * 口径：**每个事件各扣一次**（5 次击杀 = 连着做 5 次 Δ=2）。
 */
function chequeAdd(w, key, delta) {
  const out = { up: w.up, zero: w.zero, down: w.down };
  if (!(delta > 0)) return out;
  out[key] = Math.max(0, out[key] + delta);
  const others = key === 'up' ? ['zero', 'down'] : key === 'zero' ? ['up', 'down'] : ['up', 'zero'];
  let left = delta;
  for (let pass = 0; pass < 4 && left > 1e-9; pass++) {
    const avail = others.reduce((s, k) => s + Math.max(0, out[k]), 0);
    if (!(avail > 1e-9)) break;
    let taken = 0;
    for (const k of others) {
      if (!(out[k] > 0)) continue;
      const take = Math.min(out[k], left * (out[k] / avail));
      if (!(take > 0)) continue;
      out[k] -= take;
      taken += take;
    }
    if (!(taken > 0)) break;
    left -= taken;
  }
  for (const k of ['up', 'zero', 'down']) if (out[k] < 1e-9) out[k] = 0;
  return out;
}

/** 出老千（jibian_cheat 羁绊）是否已激活 —— 卡面改写的总开关。 */
function cheatOn(ctx) {
  try {
    const ps = ctx && (ctx.ps || ctx.player);
    return activeBonds(ownedJibianIdsOf(ps)).some((a) => a.def.id === 'cheat');
  } catch { return false; }
}

/**
 * 高卢银行支票：**每个整备阶段开始时**掷一次，把这一掷的增减量**累加**到当前提现金额上（基础 0，扣不到负数）。
 * 权重掷完立刻归回初始 —— 战斗里攒的加成本次结算用掉，只影响下一次。
 */
function chequeSettle(ctx) {
  const w = chequeWeights(ctx);
  // ★ 出老千：+10 的概率变成 99.9%，保留 0.1% 的 +100
  const roll = cheatOn(ctx) ? (ctx.rng() < 0.999 ? 10 : 100) : chequeRoll(ctx, w);
  const prev = Math.max(0, finite(ctx.counter(K.chequeValue), 0));
  ctx.setCounter(K.chequeValue, Math.max(0, prev + roll));
  chequeStore(ctx, CHEQUE_START);
}

/** 高卢银行支票的进度：这一场战斗的击杀 / 漏怪 / 被队友兜住分别把对应结果的概率往上推。 */
function chequeAccrue(ctx, ev) {
  const r = ev && ev.result ? ev.result : null;
  if (!r) return;
  let w = chequeWeights(ctx);
  const kills = Math.max(0, Math.trunc(finite(r.killed, 0)));
  for (let i = 0; i < kills; i++) w = chequeAdd(w, 'up', CHEQUE_KILL_GAIN);
  const leaked = (Array.isArray(r.leaked) ? r.leaked : []).filter((l) => l && l.counted !== false);
  for (let i = 0; i < leaked.length; i++) w = chequeAdd(w, 'down', CHEQUE_LEAK_GAIN);
  const saved = chequeSavedByMates(ctx, ev, leaked);
  for (let i = 0; i < saved; i++) w = chequeAdd(w, 'zero', CHEQUE_SAVE_GAIN);
  chequeStore(ctx, w);
}

/**
 * 「被队友兜住一只怪」——只有联防（unite）里才有这件事：自己**能重新进场**的漏怪数，减去联防打完后仍然活着
 * （perPlayer.leaked 里 sourcePlayerId 是自己）和没来得及进场（unspawned）的那些，剩下的就是队友替你拦下的。
 */
function chequeSavedByMates(ctx, ev, leaked) {
  const unite = ev && ev.unite;
  if (!unite || typeof unite !== 'object') return 0;
  const pid = ctx.playerId;
  const fielded = leaked.filter((l) => ctx.gd.enemy(l.enemyKey)).length;
  if (!(fielded > 0)) return 0;
  let survived = 0;
  for (const pp of Object.values(unite.perPlayer || {})) {
    for (const l of (pp && pp.leaked) || []) if (l && l.counted !== false && l.sourcePlayerId === pid) survived++;
  }
  for (const u of unite.unspawned || []) if (u && u.sourcePlayerId === pid) survived++;
  return Math.max(0, fielded - survived);
}

/**
 * 金酒之杯：**整备阶段结束时**结算一次，把结果写进这张卡自己的 ref `params`（battleInput 会把 params 带进战斗）。
 * 反复结算：每个整备阶段结束时都重算一次，覆盖上一次的数值。
 */
function cupSettle(ctx) {
  const refs = ctx.effects().filter((e) => e.key === P + 'jibian_jinjiuzhibei');
  if (!refs.length) return;
  const funds = Math.max(0, Math.trunc(finite(ctx.funds(), 0)));
  const n = Math.floor(funds / CUP_FUNDS_PER);
  const aspd = CUP_ASPD_PER * n;
  const pct = funds > CUP_BONUS_FUNDS ? CUP_ATKHP_PER * n : 0;
  for (const ref of refs) ctx.addEffect({ id: ref.id, params: { funds, n, aspd, atkPct: pct, hpPct: pct } });
  if (n > 0) ctx.toast(`金酒之杯：${funds} 资金 → 全体攻速 +${aspd}${pct > 0 ? `，攻击力与生命 +${Math.round(pct * 100)}%` : ''}`, 'info');
}

/**
 * 极速送达！的随机干员：**纯按阶随机**（不受商店等级 / 池子余量 / 拥有情况限制）。
 * 取 `gd.visibleChess`（已排除精锐、隐藏变体与自选），先抽阶，该阶空了就往低阶退。
 */
function openPackage(ctx, tiers) {
  const list = (ctx.gd && Array.isArray(ctx.gd.visibleChess) ? ctx.gd.visibleChess : [])
    .filter((id) => {
      const c = ctx.gd.chess(id);
      return !!(c && Number.isInteger(c.tier) && !c.isGolden && !c.isDiy && !c.isHidden);
    });
  if (!list.length) return null;
  const byTier = new Map();
  for (const id of list) {
    const t = ctx.gd.tierOf(id);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(id);
  }
  const wanted = pick1(ctx, tiers);
  const chain = [];
  if (wanted != null) chain.push(wanted);
  for (const t of [...new Set(Array.isArray(tiers) ? tiers : [])].sort((a, b) => b - a)) if (t !== wanted) chain.push(t);
  for (const t of chain) {
    const pool = byTier.get(t);
    if (!pool || !pool.length) continue;
    const id = pick1(ctx, pool);
    if (id) return ctx.grantChess(id, { requirePool: false });
  }
  return null;
}

/**
 * `item:chess_item_jibian_jisusongda_*` 的 onEquip（装备即消耗）：先销毁包裹，再按阶发人。
 * 记录是 `kind = consume_on_equip` 时引擎自己摘掉包裹（ev.consumed === true），那条路这里不再销毁。
 */
function openPackageOnEquip(ctx, ev) {
  const item = (ev && ev.item) || (ctx.source && ctx.source.piece) || null;
  const tiers = (item && JISUSONGDA_TIERS[item.id]) || null;
  if (!item || !tiers) return;
  if (ev && ev.consumed !== true) ctx.destroyPiece(item.uid);
  const got = openPackage(ctx, tiers);
  if (!got) ctx.toast('极速送达！：包裹里没有可获得的干员', 'warn');
}

/** 倒转区: 任务目标是「任一盟约到达 999 层」；奖励 20 资金。 */
const QUEST_LAYERS = 999;
const QUEST_FUNDS = 20;

/** 所有盟约 id —— 读数据表 (层数只写在 ps.layers 上, 一个盟约可以「有层数但当前没激活」). */
function bondIds(ctx) {
  const ids = Object.keys((ctx.data && ctx.data.bonds) || {});
  const seen = new Set(ids);
  for (const id of Object.keys(ctx.bonds() || {})) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  return ids;
}

/** 倒转区的任务结算: 有盟约到 999 层就发 20 资金并撤掉这张卡. 返回是否结算. */
function questDaozhuanqu(ctx) {
  const hit = bondIds(ctx).find((id) => (Number(ctx.layers(id)) || 0) >= QUEST_LAYERS);
  if (!hit) return false;
  ctx.addFunds(QUEST_FUNDS, 'jibian');
  const self = ctx.effects().find((e) => e.key === P + 'jibian_daozhuanqu');
  if (self) ctx.removeEffect(self.id);
  const name = (ctx.gd.bond(hit) || {}).name || hit;
  ctx.toast(`倒转区：${name} 到达 ${QUEST_LAYERS} 层，奖励 ${QUEST_FUNDS} 资金`, 'info');
  return true;
}

/** 按 choices.js addRef 的形状给玩家加一张惊变卡 ref (潘多拉魔盒用). */
function addCardRef(ctx, card) {
  const id = card.effectId;
  ctx.addEffect({
    id: `${P}${id}#${ctx.incCounter(K.seq, 1)}`,
    key: P + id,
    name: card.name || id,
    desc: card.desc || '',
    iconKind: 'choice',
    iconId: id,
    counter: null,
    battle: true,
    params: {},
    data: { effectId: id },
    jibian: true,
    rarity: card.rarity ?? null,
    flavor: card.flavor ?? null,
  });
}

/**
 * 抽到一张惊变卡时要立刻做的事, 按 effectId. registerMeta 把它接到该 ref 的 onChoicePick 上; 潘多拉魔盒也直接调它
 * —— 魔盒开出来的卡必须和正常抽到一样立刻结算, 而那些 ref 是魔盒自己加的, 不会再走一遍 choices.js 的 dispatch.
 */
const ON_PICK = {
  /** 银河战舰 — 三名颂乐人偶干员（**精锐优先**，取不到退回本体），不消耗商店池。 */
  jibian_yinhezhanjian: (ctx) => {
    for (const [elite, base] of GALAXY_TRIO) {
      const id = [elite, base].find((x) => ctx.chessRecord(x));
      if (id) ctx.grantChess(id, { requirePool: false, fromPool: false });
    }
  },
  /** 遗忘女神 — 指定精锐祥子。 */
  jibian_yiwangnvshen: (ctx) => {
    if (ctx.chessRecord('chess_zj_oblvns_b')) ctx.grantChess('chess_zj_oblvns_b', { requirePool: false, fromPool: false });
  },
  /** 谁还有梦想（史诗，owner 2026-10-25）：发一名精锐白铁（维多利亚盟约）。 */
  jibian_shuihaiyoumengxiang: (ctx) => {
    if (ctx.chessRecord('chess_zj_ironmn_b')) ctx.grantChess('chess_zj_ironmn_b', { requirePool: false, fromPool: false });
  },
  /** 多首野兽 — 发一名精锐若叶睦（特质替换与【调和】盟约由 mujicaBond.js / 数据侧处理）。 */
  [MORTIS_BEAST_CARD]: (ctx) => {
    if (ctx.chessRecord('chess_zj_mortis_b')) ctx.grantChess('chess_zj_mortis_b', { requirePool: false, fromPool: false });
  },
  ...Object.fromEntries(Object.entries(FUNDS).map(([id, n]) => [id, (ctx) => ctx.addFunds(n, 'jibian')])),

  /** 这杯我请 — 计数器归零; 真正的免费在 onPrice/onBuy 里. */
  jibian_zhebeiwuqing: (ctx) => { ctx.setCounter(K.freeChess, 0); ctx.setCounter(K.freeItem, 0); },

  /** 超大杯 — 改版后改为【获得一件装备】（奖杯造型），buff 写在道具记录里. */
  jibian_chaodabei: (ctx) => { ctx.grantItem(ITEM_CUP, { toast: false }); },

  /**
   * 超前消费 — 选完**立刻**获得 `3x + 30` 资金（x = 选择时所在回合），之后三个回合（x+1 ~ x+3）整备结算的
   * **资金收入固定为 0**；挂账 pending（悬赏怪等）照发 —— 卡片文案「不受悬赏怪影响」就是这个意思。
   */
  jibian_chaoqianxiaofei: (ctx) => {
    const r = Math.max(1, Number(ctx.round) || 1);
    const sum = 3 * r + 30;
    ctx.setCounter(K.debtFrom, r + 1);
    ctx.setCounter(K.debtTo, r + 3);
    ctx.addFunds(sum, 'jibian');
    ctx.toast(`超前消费：立刻获得 ${sum} 资金，接下来三回合资金收入固定为 0`, 'info');
  },

  /** 板藤 — 只记一个卖价计数器（起价 4、每回合 +4）；卖走商店栏的「出售板藤」键位，不再发道具. */
  jibian_banteng: (ctx) => { ctx.setCounter(K.banteng, BANTENG_START); },

  /** 人才市场 — 从干员池随机一个, 无视等级 (maxTier 6). */
  jibian_rencaishichang: (ctx) => { const id = ctx.rollChess({ maxTier: 6 }); if (id) ctx.grantChess(id); },

  /** 红松骑士团 — 四名成员**各发一个**；并且本回合不能出售干员。 */
  jibian_hongsongqishituan: (ctx) => {
    for (const pair of PINUS_GRANT) {
      const id = pair.find((x) => ctx.chessRecord(x));
      if (id) ctx.grantChess(id, { requirePool: false });
    }
    ctx.setCounter(K.pinusNoSell, ctx.round);
  },

  /** 我从山中来 — 立刻一个精锐蕾缪安. */
  jibian_wocongshanzhonglai: (ctx) => {
    const id = LEMUEN_ELITE.find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  // ---- S.E.E.S 版本新增（只登记 key，效果全在战斗侧 install()）----
  jibian_shuwanzhenyan: () => {},
  jibian_wuxiaxian: () => {},
  jibian_longdechuanren: () => {},

  /** 三月五日（传说）——「你获得一个精锐结城理」。 */
  jibian_sanyuewuri: (ctx) => {
    const id = ['chess_zj_60_5_b', 'chess_zj_60_5_a'].find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  /** 潘多拉魔盒 — 失去所有惊变 (含自己), 换三个**互不重复**的随机惊变, 新卡立刻按正常抽到结算. */
  jibian_panduolamohe: (ctx) => {
    const pool = cardPool(ctx);
    for (const ref of ctx.effects()) if (typeof ref.key === 'string' && ref.key.startsWith(P)) ctx.removeEffect(ref.id);
    if (!pool.length) return;
    const drawn = new Set();
    for (let i = 0; i < 3; i++) {
      const left = pool.filter((c) => c && !drawn.has(c.effectId));
      const card = pick1(ctx, left);
      if (!card) break;
      drawn.add(card.effectId);
      addCardRef(ctx, card);
      const on = ON_PICK[card.effectId];
      if (on) on(ctx);
    }
  },

  /** 快手（隐秘）：选中时由 spDraft 把同批另外两张一起发下；本卡自身无额外效果. */
  jibian_kuaishou: () => {},

  /** ？！325799？！ / 倒转区 — 任务卡, 奖励在 onRoundStart / onLayers 发. */
  jibian_325799: () => {},
  jibian_daozhuanqu: () => {},

  /** “叠层手” — 记下五回合的窗口, 翻倍在 onLayers 做. */
  jibian_diecengshou: (ctx) => { ctx.setCounter(K.layersUntil, ctx.round + 4); },

  /** 老子是冠军他是什么 — 一个奖杯 (+100% 攻击力写在道具记录里). */
  jibian_laozishiguanjun: (ctx) => { ctx.grantItem(ITEM_TROPHY, { toast: false }); },

  // ---- 第二批 ----
  /** 总攻击（史诗）— 获得虎狼丸、岳羽由加莉、埃癸斯（精锐优先）. */
  jibian_zonggongji: (ctx) => {
    for (const [elite, base] of SEES_TRIO) {
      const id = [elite, base].find((x) => ctx.chessRecord(x));
      if (id) ctx.grantChess(id, { requirePool: false });
    }
  },

  /** ？！给给？！ — 立刻一个精锐"贝洛内". */
  jibian_geigei: (ctx) => {
    const id = BELONE_ELITE.find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  /** 魔鬼鱼（稀有）— 立刻获得一个精锐克莱门莎. */
  jibian_moguiyu: (ctx) => {
    const id = CLEMENTIA_ELITE.find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  /** “老霸道了” — 补上文案承诺的「获得一个精锐玛恩纳」（群体伤害 +325% 在 hit 钩子里）. */
  jibian_laobadao: (ctx) => {
    const id = MLYNAR_ELITE.find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  /** 迅捷 / 精准 / 灵巧 / 坚守 — 盟约 +80 层（"无需激活盟约" = 不传 requireActive）. */
  jibian_xunjie: (ctx) => ctx.addLayers('swiftShip', 80, { reason: P + 'xunjie' }),
  jibian_jingzhun: (ctx) => ctx.addLayers('preciShip', 80, { reason: P + 'jingzhun' }),
  jibian_lingqiao: (ctx) => ctx.addLayers('skillfulShip', 80, { reason: P + 'lingqiao' }),
  jibian_jianshou: (ctx) => ctx.addLayers('steadShip', 80, { reason: P + 'jianshou' }),

  /** 高级资深干员 / 资深干员 — 预约："下一次刷新"那次商店槽位全变成随机六/五阶. */
  jibian_gaojizishen: (ctx) => ctx.setCounter(K.specialTier, 6),
  jibian_zishen: (ctx) => ctx.setCounter(K.specialTier, 5),

  /** 骑士竞技 — 「获得一个精锐耀骑士临光」(+400% 那条在 hit 钩子里，见 ④). */
  jibian_qishijingji: (ctx) => {
    const id = NEARL_ELITE.find((x) => ctx.chessRecord(x));
    if (id) ctx.grantChess(id, { requirePool: false });
  },

  /** 纯粹的强大 — 立刻获得特殊的精锐斯卡蒂（记录里已 ×2）. */
  jibian_chuncuideqiangda: (ctx) => {
    if (ctx.chessRecord('chess_zj_pure_b')) ctx.grantChess('chess_zj_pure_b', { requirePool: false });
  },

  /** 投资未来 — 种一个「下个惊变阶段只出史诗/传说」的标记（消费在 choices.js 的 jibianDraftCards）. */
  jibian_touziweilai: (ctx) => ctx.setCounter(K.touziPending, 1),

  /** 集中一点（稀有，层数厨）：接下来三个回合，所有叠层只给层数最高的已激活盟约。 */
  jibian_jizhongyidian: (ctx) => ctx.setCounter(K.jizhongyidian, ctx.round + 3),

  /** “维多利亚的秘密” — 抽到时先给本回合的 1 次特殊刷新（执行走客户端按钮 → onRefresh）. */
  jibian_weiduoliyademimi: (ctx) => ctx.setCounter(K.vicCharge, 1),

  /** 加入大群 / 影分身 / 紧急调派 / 炎国游记 — 常驻钩子；必须在这里登记，registerMeta 按 ON_PICK 的键注册. */
  jibian_jiarudaqun: () => {},
  jibian_yingfenshen: () => {},
  jibian_jinjidiaopai: () => {},

  /** 炎国游记（owner 2026-10-18）：立刻一个无视商店等级的【炎】干员，之后每两回合再给一个. */
  jibian_yanguoyouji: (ctx) => { grantYanOperator(ctx); },
  jibian_touziren: () => {},   // 实现在 match/effectsMeta.js 的 investRepeat（"获得时 ×2"的唯一乘法点）

  // ---- 第三批 ----
  /** 高卢银行支票 — 抽到只把概率归到初始值、金额清 0；第一次掷出在拿到后的第一个整备阶段. */
  jibian_gaoluzhipiao: (ctx) => { chequeStore(ctx, CHEQUE_START); ctx.setCounter(K.chequeValue, 0); },

  /** 金酒之杯 — 结算在 HOOKS.onPrepEnd，但必须在这里登记 key. */
  jibian_jinjiuzhibei: () => {},

  /** 极速送达！ — 抽到一个企鹅物流包裹（EQUIP，装备即消耗）. */
  jibian_jisusongda_normal: (ctx) => { ctx.grantItem(JISUSONGDA_ITEM + 'normal', { toast: false }); },
  jibian_jisusongda_rare: (ctx) => { ctx.grantItem(JISUSONGDA_ITEM + 'rare', { toast: false }); },
  jibian_jisusongda_epic: (ctx) => { ctx.grantItem(JISUSONGDA_ITEM + 'epic', { toast: false }); },

  // 只在 HOOKS 里写条目的卡也必须在这里登记 key，否则 registerMeta 不会注册（静默失效）。
  jibian_shiguangzhimo: () => {},
  jibian_111fuhuoma: () => {},
  jibian_zhuiji: () => {},
  jibian_cengshudaluan: () => {},
  jibian_siwanghuigui: () => {},
  jibian_xuedingedemao: () => {},

  /**
   * 赤霄剑法（传说）：战斗侧在 install()（hit 改写 + 剑气波上限）；发放 = 一张**永久记录**的精锐赤刃明霄陈
   * （`chess_chen3_a` + golden，买不到但可被内容发放）。不能凭记忆写炸惊槽位 id（参考包曾误发成圣聆初雪）。
   */
  jibian_chixiaojianfa: (ctx) => {
    ctx.grantChess('chess_chen3_a', { golden: true, requirePool: false });
  },

  /** 恶魔契约 (传说)：打开 lp 抵扣（economy.spend / canAfford 读这个计数器）. */
  jibian_emoxieyue: (ctx) => ctx.setCounter(K.devPay, 1),

  /** 「神秘」商店 (史诗)：立刻一次特殊刷新，此后每 3 回合一次；商店改写在 HOOKS.onRefresh. */
  jibian_shenmishangdian: (ctx) => {
    ctx.setCounter(K.mysCharge, Math.max(1, ctx.counter(K.mysCharge) || 0));
    if (!(ctx.counter(K.mysNext) > 0)) ctx.setCounter(K.mysNext, (Number(ctx.round) || 1) + 3);
  },

  /** 人事部文件夹（史诗）：可部署人数 +2（deployCap 是三项相加，所以与文档叠加成立）. */
  jibian_renshibuwenjianjia: (ctx) => { ctx.addDeployCap(2); },
};

/** 炎国游记的实际发放（ON_PICK 立刻用一次，之后每 2 回合再调）。 */
function grantYanOperator(ctx) {
  const id = typeof ctx.rollChess === 'function' ? ctx.rollChess({ bond: 'yanShip', maxTier: 6 }) : null;
  if (!id) return false;
  ctx.grantChess(id, { requirePool: false });
  ctx.setCounter(K.yanguoLast, Number(ctx.round) || 1);
  if (typeof ctx.toast === 'function') ctx.toast('【炎国游记】获得一名【炎】盟约干员', 'reward');
  return true;
}

/** 除「抽到时」以外的 prep 钩子, 按 effectId. */
const HOOKS = {
  /** 炎国游记 — 拿到卡之后的每 2 回合补发一个【炎】干员（回合号记在 K.yanguoLast）。 */
  jibian_yanguoyouji: {
    onRoundStart(ctx) {
      const last = Number(ctx.counter(K.yanguoLast)) || 0;
      if (!(last > 0)) return;
      if ((Number(ctx.round) || 1) - last < 2) return;
      grantYanOperator(ctx);
    },
  },

  /** 「神秘」商店 — 每 3 回合充能一次；onRefresh 把这次商店换成"无视商店等级、价格 1~6 随机". */
  jibian_shenmishangdian: {
    onRoundStart(ctx) {
      const r = Number(ctx.round) || 1;
      const next = ctx.counter(K.mysNext);
      if (!(next > 0)) { ctx.setCounter(K.mysNext, r + 3); return; }
      if (r >= next) {
        ctx.setCounter(K.mysCharge, Math.max(1, (ctx.counter(K.mysCharge) || 0) + 1));
        ctx.setCounter(K.mysNext, r + 3);
      }
    },
    onRefresh(ctx) {
      const pend = ctx.counter(K.mysPending);
      if (pend !== 1) return;
      ctx.setCounter(K.mysPending, 0);
      for (const [i, s] of (ctx.shopSlots() || []).entries()) {
        if (!s || s.kind !== 'chess') continue;
        // ★ 无视当前商店等级必须用 rollChessAnyTier（它先在可用阶层里**均匀**选一个再抽）；
        //   出老千：只出 5/6 阶干员，价格固定 1。
        const cheat = cheatOn(ctx);
        const id = cheat
          ? ((typeof ctx.rollChess === 'function' ? ctx.rollChess({ minTier: 5, maxTier: 6 }) : null)
             || (typeof ctx.rollChessAnyTier === 'function' ? ctx.rollChessAnyTier({ maxTier: 6 }) : ctx.rollChess({ maxTier: 6 })))
          : (typeof ctx.rollChessAnyTier === 'function' ? ctx.rollChessAnyTier({ maxTier: 6 }) : ctx.rollChess({ maxTier: 6 }));
        if (id) ctx.setShopSlot(i, { kind: 'chess', id, price: cheat ? 1 : 1 + ctx.rng.int(6) });
      }
      ctx.toast(cheatOn(ctx) ? '“神秘”商店：只出5/6阶，价格1' : '“神秘”商店：本次刷新无视等级，价格随机', 'info');
    },
  },

  /**
   * ？* /）层数/¥）dgxu — 每回合开始时把本模式全部盟约的层数值随机重排（总和不变；未激活的也进池）。
   * 池子只含**可叠加**盟约（noStack === false，层数对不可叠加的 4 个没有任何效果）且排除本局禁用（inactiveBondIds）。
   * ★ ctx.rng 本身就是 rng（可调用且有 .int 等方法），**不是**返回 rng 的函数 —— 写成 ctx.rng().int 会把整张卡静默搞没。
   */
  jibian_cengshudaluan: {
    onRoundStart(ctx, ev) {
      const r = Number(ev && ev.round) || 1;
      if (ctx.counter(K.cengFirst) === r) return;     // 抽到这张卡的当回合不洗
      ctx.setCounter(K.cengFirst, 0);
      let allowed = null;
      try {
        const mode = ctx.gd && ctx.gd.mode && typeof ctx.gd.mode === 'object' ? ctx.gd.mode : null;
        if (mode && Array.isArray(mode.activeBondIds)) allowed = new Set(mode.activeBondIds);
      } catch { /* 无 mode 信息时退回全部 */ }
      const ids = bondIds(ctx).filter((id) => (!allowed || allowed.has(id)) && !ctx.bondNoStack(id));
      if (ids.length < 2) return;
      const vals = ids.map((id) => Number(ctx.layers(id)) || 0);
      const rng = ctx.rng;
      for (let i = vals.length - 1; i > 0; i--) { const k = rng.int(i + 1); const t = vals[i]; vals[i] = vals[k]; vals[k] = t; }
      for (let i = 0; i < ids.length; i++) ctx.setLayers(ids[i], vals[i], { reason: P + 'cengshudaluan' });
      ctx.toast('层数被打乱了……', 'info');
    },
  },

  /**
   * 追忆 (传说) —「你和你的队伍在第十三回合结束时不进入第十四回合，变为进入第十回合整备阶段，之后该惊变失效」。
   * 一次性但**不销毁**：卡保留在惊变列表里，只是失效、不能再触发第二次。
   *
   * 事件：`onRoundWouldStart(ctx, ev)`，`ev = { round }` **可变**；派发点 = `match/match/phases.js` 的
   * `startRound(r)` 第一行（早于 `this.round = r` / `phase = ROUND_START` / `ps.startRound(r)` / 抽敌方惊变 / 出怪），
   * 派发对象 = 存活玩家每人一次。engine-core 侧对改写值做了钳位（只接受 `Number.isInteger(ev.round) && > 0`），
   * 无 handler 时 `startRound` 逐字节不变 —— 所以「卡不在手上」的局零影响。
   * 本卡把 14 改成 10，写进 `jibianConsumed` 保证一局只发生一次（第二次到 13 时卡已消耗）。
   */
  jibian_zhuiji: {
    onRoundWouldStart(ctx, ev) {
      if (!ev || Number(ev.round) !== 14) return;      // 卡面写的"第十三回合结束"= 即将进入第 14 回合
      if (ctx.jibianConsumed?.().has('jibian_zhuiji')) return;
      ev.round = 10;                                    // 改为进入第 10 回合整备阶段
      ctx.markJibianConsumed?.('jibian_zhuiji');        // 记入本局已消耗（也保证不会再抽出第二张）
      ctx.toast('追忆：回到第 10 回合', 'info');
    },
  },

  /** 恶魔契约 — 每回合战斗阶段开始时 +3 目标生命。 */
  jibian_emoxieyue: {
    onBattleResult(ctx) {
      ctx.setCounter(K.devPay, 1);                 // 兜底：跨回合/重连后仍然生效
      ctx.addLp?.(3);
      ctx.toast('恶魔契约：目标生命 +3', 'info');
    },
  },

  /** 111真复活吗哥 — 获得地灵时把她的卫戍效果再追加一次（等价于翻倍，只作用于地灵本人）。 */
  jibian_111fuhuoma: {
    onGain(ctx, ev) {
      if (!ev || ev.kind !== 'chess' || !ev.piece) return;
      const p = ev.piece;
      const rec = ctx.chessRecord?.(p.id || p.baseId) || null;
      const cid = p.charId || rec?.charId || null;
      if (cid !== 'char_183_skgoat') return;              // 只有地灵
      const gs = ctx.garrisonsOf ? (ctx.garrisonsOf(p.uid) || []) : [];
      const n = gs.reduce((a, g) => a + (Number(g && g.bb && g.bb.count) || 0), 0);
      if (!(n > 0)) return;
      for (const b of (ctx.pieceBonds?.(p.uid) || rec?.bonds || ['miraShip', 'visiShip'])) {
        ctx.addLayers(b, n, { requireActive: false });    // 她的卫戍是「无需激活盟约」
      }
      ctx.toast('某个干员的特质改变了……', 'info');
    },
  },

  /**
   * 时光之末（稀有）— 非 boss 战里目标生命降为 0 时不淘汰（+1 目标生命），触发即消耗。
   *
   * 事件：`onWouldEliminate(ctx, ev)`，`ev = { kind: 'normal'|'boss'|'hidden', saved: false }` **可变**；
   * 派发点 = `match/match/settle.js` 的 `eliminateBroken()`（LP ≤ 0 判定内、`ps.eliminate()` 之前），每个候选玩家一次；
   * `kind` 由本轮决定（`isHiddenRound` → hidden、`isBossRound` → boss，否则 normal）。
   * 契约：**只置 `ev.saved`** —— 调用方负责 `continue` 并把 `ps.lp` 设成 1，所以这里**不要** `addLp`（否则 +1/+1）。
   * 无 handler 时 `saved` 保持 false，淘汰路径与原来完全一致。触发即消耗（removeEffect）。
   */
  jibian_shiguangzhimo: {
    onWouldEliminate(ctx, ev) {
      if (ev && (ev.kind === 'boss' || ev.kind === 'hidden')) return;   // 卡面写的是"非boss战"
      ev.saved = true;                                                  // 不淘汰；LP 由 settle 设成 1
      const self = ctx.effects().find((e) => e.key === P + 'jibian_shiguangzhimo');
      if (self) ctx.removeEffect(self.id);
    },
  },

  /** 这杯我请: 每回合首个购买的干员和装备售价为 0（onPrice 只是问价，只有 onBuy 才置位）. */
  jibian_zhebeiwuqing: {
    onRoundStart(ctx) { ctx.setCounter(K.freeChess, 0); ctx.setCounter(K.freeItem, 0); },
    onPrice(ctx, ev) {
      const slot = ev && ev.slot;
      if (!slot || slot.sold) return;
      const item = slot.kind === 'item';
      if (ctx.counter(item ? K.freeItem : K.freeChess) === 0) ctx.setPrice(0);
    },
    onBuy(ctx, ev) {
      const item = ev && ev.kind === 'item';
      ctx.setCounter(item ? K.freeItem : K.freeChess, 1);
    },
  },

  /** 板藤: 卖价 4 起、每回合 +4；套现走商店栏的「出售板藤」键位. */
  jibian_banteng: {
    onRoundStart(ctx) {
      ctx.setCounter(K.banteng, (ctx.counter(K.banteng) || BANTENG_START) + BANTENG_STEP);
    },
  },

  /** 超前消费: x+1 ~ x+3 三个回合的**资金收入**固定为 0（基础收入与利息一起没了；ev.pending 故意不动）. */
  jibian_chaoqianxiaofei: {
    onIncome(ctx, ev) {
      if (!ev) return;
      const r = Number.isFinite(ev.round) ? ev.round : ctx.round;
      const from = ctx.counter(K.debtFrom);
      const to = ctx.counter(K.debtTo);
      if (to <= 0 || r < from || r > to) return;
      ev.income = 0;
    },
  },

  /** ？！325799？！: 活过 7 回合 (第 8 回合开始) → 随机一个已激活盟约 +325 层, 然后这张卡消失. */
  jibian_325799: {
    onRoundStart(ctx, ev) {
      const r = ev && Number.isFinite(ev.round) ? ev.round : ctx.round;
      if (r < 8) return;
      const b = pick1(ctx, Object.keys(ctx.bonds()).filter((id) => ctx.bondActive(id)));
      if (!b) return;                                  // 还没有已激活盟约: 留到下回合再结算
      ctx.addLayers(b, 325, { requireActive: true, reason: P + '325799' });
      const self = ctx.effects().find((e) => e.key === P + 'jibian_325799');
      if (self) ctx.removeEffect(self.id);
      ctx.toast(`325799：${b} 层数 +325`, 'info');
    },
  },

  /** 倒转区: 任一盟约到达 999 层 → 20 资金, 然后这张卡消失. */
  jibian_daozhuanqu: {
    onLayers(ctx) { questDaozhuanqu(ctx); },
    onRoundStart(ctx) { questDaozhuanqu(ctx); },
  },

  /**
   * “叠层手”: 五回合内, 通过特质提高的层数再补一份。
   * ★ 卫戍特质加层时 reason 是 **`'garrison'`（无冒号）**；参考包曾只查 `startsWith('garrison:')` 而永远不成立，
   *   所以这里两种写法都认。
   */
  jibian_diecengshou: {
    onLayers(ctx, ev) {
      const until = ctx.counter(K.layersUntil);
      if (!until || ctx.round > until) return;
      if (!ev || !ev.bondId || !(ev.to > ev.from)) return;
      if (!/^garrison(:|$)/.test(String(ev.reason || ''))) return;
      ctx.addLayers(ev.bondId, ev.to - ev.from, { reason: P + 'diecengshou' });   // 自己补的这份 reason 不同, 不会递归
    },
  },

  /** 加入大群 — 【阿戈尔】干员通过特质提升的层数 +100%；拥有浊心斯卡蒂时再翻倍（总共 ×3）。 */
  jibian_jiarudaqun: {
    onLayers(ctx, ev) {
      if (!ev || !ev.bondId || !(ev.to > ev.from)) return;
      if (ev.bondId !== 'egirShip') return;
      if (!/^garrison(:|$)/.test(String(ev.reason || ''))) return;
      const hasSkadi = ownPieces(ctx).some((p) => p && (SKADI_CORRUPTED.includes(p.id) || SKADI_CORRUPTED.includes(p.baseId)));
      ctx.addLayers(ev.bondId, (ev.to - ev.from) * (hasSkadi ? 2 : 1), { reason: P + 'jiarudaqun' });
    },
  },

  /** 高级资深干员 / 资深干员 — "下一次刷新变为特殊刷新"：消费预约，把干员槽位全换成随机六/五阶. */
  jibian_gaojizishen: {
    onRefresh(ctx) { specialRefreshTier(ctx); },
  },
  jibian_zishen: {
    onRefresh(ctx) { specialRefreshTier(ctx); },
  },

  /**
   * “维多利亚的秘密” — 每回合 1 次特殊刷新：无视商店等级、只出【维多利亚】干员，此次刷新后购买的首个干员 -1 资金。
   */
  jibian_weiduoliyademimi: {
    onRoundStart(ctx) { ctx.setCounter(K.vicCharge, 1); },
    onRefresh(ctx) {
      if (ctx.counter(K.vicRefresh) !== 1) return;
      ctx.setCounter(K.vicRefresh, 0);
      ctx.setCounter(K.vicDiscount, 1);
      for (const [i, s] of (ctx.shopSlots() || []).entries()) {
        if (!s || s.kind !== 'chess') continue;
        const id = ctx.rollChess({ bond: 'victoriaShip', maxTier: 6 });   // maxTier 6 = 无视商店等级
        if (id) ctx.setShopSlot(i, { kind: 'chess', id });
      }
      ctx.toast('维多利亚的秘密：本次刷新只会出现【维多利亚】干员', 'info');
    },
    onPrice(ctx, ev) {
      if (ctx.counter(K.vicDiscount) !== 1) return;
      const slot = ev && ev.slot;
      if (!slot || slot.sold || slot.kind !== 'chess') return;
      ctx.modifyPrice(-1);
    },
    onBuy(ctx, ev) { if (!ev || ev.kind !== 'item') ctx.setCounter(K.vicDiscount, 0); },
  },

  /**
   * “影分身” — 每个已部署干员，对它自己所属的每个盟约，盟约人数 +1。
   * bondCountBonus 是**覆盖式的玩家级整数**，所以每次重算前整表刷新（没有干员的盟约写 0）。
   *
   * 重建时机（**只挂 0.3.3 真实存在的 prep 钩子**）：回合开始 / 整备期结束 / 买 / 卖 / 合并 / 获得。
   * 参考实现还挂了 `onLayout`（摆位/移动后重算），但 0.3.3 的钩子表里没有它、也没有等价的「布局改变」事件
   * （`onActiveBonds` 只在**已激活盟约集合发生变化**时派发，同一块棋盘上挪位不会触发），所以删掉。
   * 影响面：数值上唯一要紧的时刻是 `onPrepEnd`（紧接战斗快照），它已经在了；丢的只是整备期界面里
   * 人数加成的即时刷新（下一次 onRoundStart / onBuy 等会纠正）。见 test/content/jibian-cards.test.js 的
   * 「影分身 onPrepEnd 重算」用例。
   */
  jibian_yingfenshen: {
    onRoundStart(ctx) { fenshenApply(ctx); },
    onPrepEnd(ctx) { fenshenApply(ctx); },
    onBuy(ctx) { fenshenApply(ctx); },
    onSold(ctx) { fenshenApply(ctx); },
    onMerge(ctx) { fenshenApply(ctx); },
    onGain(ctx) { fenshenApply(ctx); },
  },

  /** 紧急调派 — 完美作战时回合结束给一个"不超过当前商店等级、来自盟约层数最高盟约"的干员. */
  jibian_jinjidiaopai: {
    onBattleResult(ctx, ev) {
      if (!ev || ev.perfect !== true) return;
      const layersOf = (id) => Number(ctx.layers(id)) || 0;
      const active = bondIds(ctx).filter((id) => ctx.bondActive(id) && layersOf(id) > 0);
      const pool = active.length ? active : bondIds(ctx).filter((id) => layersOf(id) > 0);
      let top = null;
      let topN = 0;
      for (const id of pool) if (layersOf(id) > topN) { topN = layersOf(id); top = id; }
      if (!top) return;
      const id = ctx.rollChess({ bond: top, maxTier: Math.max(1, ctx.shopLevel() || 1) });
      if (!id) return;
      ctx.grantChess(id);
      const name = (ctx.gd.bond(top) || {}).name || top;
      ctx.toast(`紧急调派：完美作战 → ${name}（${topN} 层）的干员`, 'info');
    },
  },

  /** 高卢银行支票 — 每个整备阶段开始时掷一次；增量由上一场战斗结算. */
  jibian_gaoluzhipiao: {
    onPrepStart(ctx) { chequeSettle(ctx); },
    onBattleResult(ctx, ev) { chequeAccrue(ctx, ev); },
  },

  /** 金酒之杯 — 整备阶段结束时按当时资金结算，结果写进 ref params，供紧接的那场战斗读取。 */
  jibian_jinjiuzhibei: {
    onPrepEnd(ctx) { cupSettle(ctx); },
  },
};

/** 高级/资深干员的"下一次刷新全是 N 阶"（两份注册共用同一段实现，阶数在 K.specialTier 计数器里）。 */
function specialRefreshTier(ctx) {
  const tier = ctx.counter(K.specialTier);
  if (!(tier > 0)) return;
  ctx.setCounter(K.specialTier, 0);
  for (const [i, s] of (ctx.shopSlots() || []).entries()) {
    if (!s || s.kind !== 'chess') continue;
    const id = ctx.rollChess({ tier });
    if (id) ctx.setShopSlot(i, { kind: 'chess', id });
  }
  ctx.toast(`特殊刷新：本次商店全是 ${tier} 阶干员`, 'info');
}

/** “影分身”: 备战区的干员数 → bondCountBonus（覆盖式的玩家级整数）. */
function fenshenApply(ctx) {
  const bonus = new Map();
  for (const p of ctx.board() || []) {
    if (!p || p.kind !== 'chess') continue;
    for (const b of ctx.pieceBonds(p.uid) || []) bonus.set(b, (bonus.get(b) || 0) + 1);
  }
  for (const id of bondIds(ctx)) ctx.setBondCountBonus(id, bonus.get(id) || 0);
}

export function registerMeta(registry) {
  if (!registry || typeof registry.register !== 'function') return;
  for (const [id, onPick] of Object.entries(ON_PICK)) {
    registry.register(P + id, {
      onChoicePick(ctx, ev) {
        if (!justPicked(ctx)) return;   // the 'choice:<id>' run happened before the ref existed
        // choices.js 抽完一张卡会把 onChoicePick 再派发给该玩家的**所有** refs，所以要确认「这次抽的就是自己」。
        if (ev && ev.card) {
          const picked = ev.card.id || ev.card.effectId || null;
          if (picked && picked !== id) return;
        }
        onPick(ctx);
      },
      ...(HOOKS[id] || {}),
    });
  }
  /**
   * 极速送达！的三个包裹：注册 `item:chess_item_jibian_jisusongda_*`（装备即消耗）。
   * 引擎的消耗分支在装备这类道具前会先查 `registry.has('item:'+itemKey(id))`，没有就直接报错 —— 所以必须注册。
   */
  for (const itemId of Object.keys(JISUSONGDA_TIERS)) {
    registry.register(`item:${itemId}`, {
      onEquip(ctx, ev) { openPackageOnEquip(ctx, ev); },
    });
  }
}
