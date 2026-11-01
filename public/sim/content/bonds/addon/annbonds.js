// server/sim/content/bonds/addon/annbonds.js — 湮灭模拟（difficulty: 'ANNIHILATION'）的两个专属盟约：
// 罗德岛 rhodesShip / 卡兹戴尔 kazdelShip。
//
// 来历：这两条盟约是 2026-10-28 从湮灭专属 mod 包里带过来的新记录（`data/bonds.json`，`annOnly: true`），
// 当时只有「计数 / 层数 / 档位 / 卡面」，`bb` 里 20 个键在本仓一个读点都没有（handoff/ZHAJING-SPLIT-2026-10-28.md §11.2、
// §11.4 的挂账）。本文件把 20 个键全部接到既有通道上，不新增机制：
//
//   罗德岛 rhodesShip（bb 10 键）
//     base_atk / atk_per_stack            3 名档：成员的攻击力 + (base_atk + atk_per_stack×层数)（直接乘算 → directMods）
//     base_max_hp / max_hp_per_stack      3 名档：成员的最大生命 + (base_max_hp + max_hp_per_stack×层数)
//     power_bond_char_cnt                 6 名档的门槛（bb 值 6，与记录 thresholds [3,6] 的第二档同一个数）
//     heal_scale                          6 名档：成员**受到的治疗效果** +heal_scale（healingTakenMul）
//     sp_interval / sp_per_interval       6 名档：每 sp_interval 秒回复 sp_per_interval 点技力（battle.every → gainSp）
//     regen_hp_scale                      6 名档：每秒回复 regen_hp_scale×最大生命（hpRegenRatio，引擎的回复速度，不是治疗）
//     regen_element_scale                 6 名档：每秒回复 regen_element_scale×元素条容量（healElement，每一条独立）
//
//   卡兹戴尔 kazdelShip（bb 10 键）
//     base_damage_scale / damage_scale_per_stack  3 名档：对**处于眩晕/停顿/束缚/不动**的敌人造成的伤害 +(base+per×层数)
//     power_bond_char_cnt                         6 名档的门槛（bb 值 6）
//     bonus_attack_speed                          6 名档：成员攻击速度 +bonus_attack_speed（点，不是百分比）
//     true_damage_scale                           6 名档：成员的**普通攻击**额外造成 true_damage_scale×当前攻击力 的真实伤害
//     storm_char_cnt                              9 名档的门槛（bb 值 9）
//     storm_atk_scale                             9 名档：战场中央的「活性源石风暴」每秒对全场敌人造成
//                                                 storm_atk_scale × 所有成员当前攻击力总和 的无来源真实伤害
//     storm_base_damage_scale / storm_damage_scale_per_stack
//                                                 9 名档：风暴对**受控**目标再提高 storm_base + storm_per×层数
//     layer / count                               每 layer 层获得 count 件「萨卡兹的断角」（整备侧，见 registerMeta）
//
// **包内没有处理器**（modref v2.1 里 grep 不到 bondeffect_rhodes / bondeffect_kazdel），所以除卡面文案明确写死的部分
// 之外，每一条都用 `[ASSUMED]` 标出「按数值 + 文案反推」的语义。数值一律从 data 读，代码里不写死倍率。
//
// 两道门（缺一条就会静默改变官方四档 / 炸惊）：
//   ① `isAnnihilationBattle(battle)` —— 只有湮灭的两个 mode id（或显式 flags.annihilation）；
//   ② 该盟约**自己的**内容开关：`shared/annihilation-constants.js` 的 `annModOn(battle.flags.annMods, id)`
//      （显式 boolean 压过缺省；这两条盟约自 2026-10-29 起**缺省开启**，`{ kazdelShip: false }` 才是关）。
//      `battle.flags.annMods` 由 `gd.annihilationFlags()` 下发；整备侧 `gd.annMod()` 读同一份名单，两侧口径一致。
// 成员判据：`isMember()`（读 `unitBonds`，含调和「享受核心盟约」那一支）**或**棋记录自己带这条 `annBonds`
// （`annBondsOf(def)`）。后者是必须的：`support/index.js` 的 `annBondsFor()` 只认显式的 `flags.annMods[name] === true`，
// 而缺省开启的开关不会出现在 flags 里（gd 只下发显式值），只靠 `isMember` 会让缺省开启的两条盟约在真实对局里静默空转。
// 两条路取并集只会比 support 的判据更宽，且都在 ① 之门内，所以官方四档 / 炸惊仍然一条都拿不到。
//
// 【跨层要求】「显式关掉一条默认开启的盟约」要真的在战斗里生效，`gd.annihilationFlags()` 必须把显式 `false` 也写进
// `flags.annMods`（只发 `true` 键的话，sim 这一侧看到的永远是「没提过」= 缺省开启）。本文件按「显式 boolean 压过缺省」
// 读，所以发送侧改一行就能对齐；这是 server/match/gamedata.js 的事，不在本模块里。
//
// 装配：与 zjbonds.js 同类，但由 content/index.js 的 DOMAIN_NAMES 以 `bonds/addon/annbonds` 注册，排在各 domain 末尾，
// 所以晚于 `bonds`（含 bonds/core 的官方钩子）install。整备侧（layer/count 的断角发放）走 registerMeta。
//
// 确定性：没有 Math.random、没有时钟，全部走引擎钩子 / battle.every（模拟时间）与 data 数值。

import {
  annBondsOf, bondLayers, bondRecord, bondTier, buffParams, directMods, isAnnihilationBattle, isMember, num,
  passiveBuff, playerOps,
} from '../../support/index.js';
import { annModOn } from '../../../../../shared/annihilation-constants.js';

const ID = Object.freeze({ rhodes: 'rhodesShip', kazdel: 'kazdelShip' });

/** 战斗侧 buff 键（`bond:` 前缀是 content 的约定）。 */
const KEY = Object.freeze({
  rhodesStats: 'bond:rhodesShip:stats',        // 攻击力 / 最大生命（随层数重算）
  rhodesSupport: 'bond:rhodesShip:support',    // 受到的治疗 + 生命回复速度（6 名档）
  kazdelAspd: 'bond:kazdelShip:aspd',          // 攻击速度（6 名档）
});

/** 卡兹戴尔「攻击附带真实伤害」/ 风暴的伤害标记：自己造成的伤害不再二次触发。 */
const TAG = 'bond:kazdelShip:true';
const STORM_TAG = 'bond:kazdelShip:storm';
/** 断角里程碑（整备侧）的计数器键与缺省物品（= 记录里 `bond_layer_added_reward_equip.bbStr.reward_item`）。 */
const HORN_COUNTER = 'bond:kazdelShip:horns';
const HORN_ITEM = 'chess_item_c_01_e_a';

/**
 * 盟约的数值袋：顶层 `bb` 合并 `env_gbuff_new` 黑板（两条盟约的 buffs[0].bb 与顶层 bb 相同，两处都读才不怕数据搬家）。
 * @param {string} bondId
 */
const bbOf = (bondId) => {
  const rec = bondRecord(bondId);
  return { ...((rec && rec.bb) || {}), ...(buffParams(rec, 'env_gbuff_new') ?? {}) };
};

/**
 * 玩家 `pid` 是否已达到 `bondId` 需要 `cnt` 名成员的档位（与 bonds/core.js 的 `reached` 同口径：先是人数，
 * 再是记录 `thresholds` 里该人数对应的档位下标；缺门槛的版本数据 = 没有这一档）。
 */
function reached(battle, pid, bondId, cnt) {
  const st = battle.getPlayer(pid)?.bonds?.[bondId] ?? null;
  if (!st || !st.active) return false;
  const need = num(cnt, 0);
  if (!(need > 0)) return true;
  if (num(st.count, 0) >= need) return true;
  const th = bondRecord(bondId)?.thresholds;
  const idx = Array.isArray(th) ? th.indexOf(need) : -1;
  return idx >= 0 && bondTier(battle, pid, bondId) >= idx + 1;
}

/** 层数变化后重算（层数在 `layerGain` 钩子里还没记账，所以推迟到下一 tick 读活值）。 */
function onLayers(battle, pid, bondId, fn) {
  const pending = new Set();
  battle.on('layerGain', (c) => {
    if (!c || c.playerId !== pid || c.bondId !== bondId) return;
    if (pending.has(bondId)) return;
    pending.add(bondId);
    battle.after(0, () => { pending.delete(bondId); fn(); });
  }, { priority: -100 });
}

/** 目标是否处于「眩晕 / 停顿 / 束缚 / 不动」之一（卡兹戴尔的伤害加成条件）。 */
function controlled(t) {
  const f = t && t.s ? t.s.flags : null;
  // [ASSUMED] 眩晕取引擎的 s.flags.stun（它自己也把冻结 / 沉睡 / 浮空折进去：都是「无法行动」）；
  // 束缚与「不动」分别看 bind / noMove（bind 也置 noMove，缚地、自缚同样落在 noMove 上）。
  if (f && (f.stun || f.bind || f.noMove)) return true;
  // [ASSUMED] 停顿（sluggish）在引擎里只是一条 moveMul 0.2 的状态 buff，没有专用 flag，按状态键找。
  return Array.isArray(t.buffs) && t.buffs.some((b) => (b.status ?? b.key) === 'sluggish');
}

export function install(battle) {
  if (!isAnnihilationBattle(battle)) return;                  // ① 模式门
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  const sw = battle.flags ? battle.flags.annMods : null;
  const rhodes = annModOn(sw, ID.rhodes);
  const kazdel = annModOn(sw, ID.kazdel);
  if (!rhodes && !kazdel) return;                             // ② 两条都关 = 这两个 mod 不存在
  for (const p of battle.players) {
    if (!p || p.playerId == null) continue;
    const pid = p.playerId;
    const ops = playerOps(battle, pid);
    if (!ops.length) continue;
    if (rhodes) installRhodes(battle, pid, ops);
    if (kazdel) installKazdel(battle, pid, ops);
  }
}

/**
 * 这条盟约的成员：`isMember()` 认得的那批（含调和），并上棋记录 `annBonds` 里点名这条盟约的干员。
 * 后者让缺省开启的盟约不依赖 `flags.annMods` 里那个不会出现的键（见文件头）。
 */
const membersOf = (battle, ops, id) => ops.filter((u) => isMember(battle, u, id) || annBondsOf(u.def).includes(id));

// =====================================================================================================================
// 罗德岛 rhodesShip

function installRhodes(battle, pid, ops) {
  if (bondTier(battle, pid, ID.rhodes) <= 0) return;
  const members = membersOf(battle, ops, ID.rhodes);
  if (!members.length) return;
  const bb = bbOf(ID.rhodes);
  const L = () => bondLayers(battle, pid, ID.rhodes);

  // 3 名档：攻击力 / 最大生命（受层数影响，直接乘算 —— PRTS 的「攻击力+25%」就是百分比加成）。
  const applyStats = () => {
    const mods = directMods({
      atk: num(bb.base_atk) + num(bb.atk_per_stack) * L(),
      hp: num(bb.base_max_hp) + num(bb.max_hp_per_stack) * L(),
    });
    if (!Object.keys(mods).length) return;
    for (const u of members) passiveBuff(battle, u, KEY.rhodesStats, mods);
  };
  applyStats();
  onLayers(battle, pid, ID.rhodes, applyStats);

  // 6 名档（`power_bond_char_cnt`）：受到的治疗、技力、生命与元素损伤回复。
  if (!reached(battle, pid, ID.rhodes, bb.power_bond_char_cnt)) return;

  const heal = num(bb.heal_scale);
  const hpRegen = num(bb.regen_hp_scale);
  const support = {};
  if (heal > 0) support.healingTakenMul = 1 + heal;
  if (hpRegen > 0) support.hpRegenRatio = hpRegen;   // 每秒 hpRegenRatio×最大生命（引擎的回复速度，不是治疗）
  if (Object.keys(support).length) for (const u of members) passiveBuff(battle, u, KEY.rhodesSupport, support);

  // 每 `sp_interval` 秒 +`sp_per_interval` 技力（场上成员的技能条；阻回 / 技能期间由 gainSp 自己判）。
  const iv = num(bb.sp_interval);
  const sp = num(bb.sp_per_interval);
  if (iv > 0 && sp > 0) {
    battle.every(iv, () => {
      for (const u of members) {
        if (!u.alive || !u.deployed || !u.skill) continue;
        u.skill.gainSp(sp, 'bond');
      }
    });
  }

  // 每秒回复元素损伤：`regen_element_scale` × 元素条容量（[ASSUMED] 按容量算，而不是按当前值）。
  const el = num(bb.regen_element_scale);
  if (el > 0) {
    battle.every(1, () => {
      for (const u of members) {
        if (!u.alive || !u.deployed) continue;
        const amount = num(u.gaugeMax, 0) * el;
        if (amount > 0) battle.healElement({ target: u, amount });
      }
    });
  }
}

// =====================================================================================================================
// 卡兹戴尔 kazdelShip

function installKazdel(battle, pid, ops) {
  if (bondTier(battle, pid, ID.kazdel) <= 0) return;
  const members = membersOf(battle, ops, ID.kazdel);
  if (!members.length) return;
  const bb = bbOf(ID.kazdel);
  const L = () => bondLayers(battle, pid, ID.kazdel);
  const memberSet = new Set(members);

  // 3 名档：对处于眩晕 / 停顿 / 束缚 / 不动的敌人造成的伤害提升（受层数影响）。
  // 走 `hit`（结算前）改 dmg.mul —— 与 谢拉格 kjeragShip 的条件伤害同一口径。
  battle.on('hit', (c) => {
    const u = c && c.source;
    if (!u || !memberSet.has(u)) return;
    const t = c.target;
    if (!t || t.side !== 'enemy' || !t.alive || !c.dmg) return;
    const tags = c.dmg.tags;
    if (Array.isArray(tags) && (tags.includes(TAG) || tags.includes(STORM_TAG))) return;   // 自己造成的伤害不再加工
    if (!controlled(t)) return;
    const bonus = num(bb.base_damage_scale) + num(bb.damage_scale_per_stack) * L();
    if (!(bonus > 0)) return;
    c.dmg.mul = num(c.dmg.mul, 1) * (1 + bonus);
  });

  // 6 名档（`power_bond_char_cnt`）：攻击速度 + 攻击附带真实伤害。
  if (!reached(battle, pid, ID.kazdel, bb.power_bond_char_cnt)) return;

  const aspd = num(bb.bonus_attack_speed);
  if (aspd) for (const u of members) passiveBuff(battle, u, KEY.kazdelAspd, { aspd });

  const trueScale = num(bb.true_damage_scale);
  if (trueScale > 0) {
    battle.on('damaged', (c) => {
      const u = c && c.source;
      if (!u || !memberSet.has(u)) return;
      const dmg = c.dmg;
      // [ASSUMED]「攻击附带」的判据与各 kit 的 isMainHit 同口径：isAttack 且不是溅射的那几份（元素条伤害不在此列）。
      // 技能里带 isAttack 的那一击同样算「攻击」；一次攻击只附加一份。
      if (!dmg || !dmg.isAttack || dmg.isSplash || c.type === 'element') return;
      const tags = dmg.tags;
      if (Array.isArray(tags) && (tags.includes(TAG) || tags.includes(STORM_TAG))) return;
      const t = c.target;
      if (!t || t.side !== 'enemy' || !t.alive) return;
      const amount = num(u.s.atk, 0) * trueScale;
      if (!(amount > 0)) return;
      battle.dealDamage({
        source: u, target: t, amount, type: 'true', isAttack: false, canDodge: false, tags: [TAG],
      });
    });
  }

  // 9 名档（`storm_char_cnt`）：战场中央的「活性源石风暴」。
  if (!reached(battle, pid, ID.kazdel, bb.storm_char_cnt)) return;
  const stormScale = num(bb.storm_atk_scale);
  if (!(stormScale > 0)) return;
  const stormBase = num(bb.storm_base_damage_scale);
  const stormPer = num(bb.storm_damage_scale_per_stack);

  battle.on('battleStart', () => {
    const R = battle.rect;
    if (!R) return;
    // [ASSUMED] 数据里没有「活性源石风暴」的装置 / 召唤物记录（data/devices.json 不存在，tokens/enemies 里也没有
    // 同名条目），而它的伤害本身就是「无来源真实伤害」，所以这里按**场地中心的一次性表现 + 每秒一次的场地效果**实现，
    // 不造一个会占格、会被打的单位。
    battle.fx('bondStorm', { x: (R.c0 + R.c1) / 2, y: (R.r0 + R.r1) / 2, src: 'bond:kazdelShip' });
  }, { once: true, priority: -1000 });

  battle.every(1, () => {
    // 「所有【卡兹戴尔】干员当前攻击力总和」：场上活着的成员（阵亡的不算贡献）。
    let total = 0;
    for (const u of members) if (u.alive && u.deployed) total += num(u.s.atk, 0);
    const base = total * stormScale;
    if (!(base > 0)) return;
    const extra = Math.max(0, stormBase + stormPer * L());
    for (const e of battle.enemies) {
      if (!e || !e.alive || e.side !== 'enemy') continue;
      const amount = controlled(e) && extra > 0 ? base * (1 + extra) : base;
      // 无来源真实伤害（PRTS 伤害分类）：source 为 null，不记任何人的伤害统计。
      battle.dealDamage({ source: null, target: e, amount, type: 'true', isAttack: false, canDodge: false, tags: [STORM_TAG] });
    }
  });
}

// =====================================================================================================================
// 整备侧：卡兹戴尔的 `layer` / `count`（每 layer 层获得 count 件「萨卡兹的断角」）
//
// 记录把这条挂在 `buffs[].key = bond_layer_added_reward_equip`（bb `{ layer: 100, count: 1 }`，
// bbStr `{ reward_item: 'chess_item_c_01_e_a' }`），`layerMilestones` 里也写着同一件事。维多利亚的维式重锤
// 走的是同一套（bonds/core.js payHammers：计数器 + 逐件发放），这里的实现照抄那个结构，只是物品由数据指定，
// 不再从 pool 里抽。
//
// **[已补]** 这件装备原来不在本仓的 `data/items.json` 里（0.3.0 的装备表没有萨卡兹的断角），于是里程碑计得清、
// grantItem 却发不出去。2026-10-29 由 tools/extract-annihilation-mods.mjs 从 kazdel-ship 包抽进
// docs/research/20-annihilation-mods.json 的 `items`，再由 tools/build-data.mjs 生成进 data/items.json
// （`annOnly` + `shopExcluded`，官方四档的商店看不见它），本函数因此会真的发出这件装备。
const HORN_HOOKS = Object.freeze(['onLayers', 'onActiveBonds', 'onRoundStart', 'onPrepStart', 'onPrepEnd', 'onBuy', 'onGain', 'onSold', 'onMerge']);

/**
 * 付清卡兹戴尔欠下的「萨卡兹的断角」：层数每过 `layer` 层付一次、每次 `count` 件。
 * 与 payHammers 同口径：盟约未激活不付（官方「叠加的盟约…只有在盟约被激活时才会发挥作用」），
 * 计数器保证每次里程碑只付一次；物品不存在时计到数、发不出去（见上面的数据缺口）。
 * @param {object} ctx effectsMeta 的 ctx
 * @returns {number} 实际发放的件数
 */
export function payBreakHorns(ctx) {
  if (!ctx || typeof ctx.bondActive !== 'function' || !ctx.bondActive(ID.kazdel)) return 0;
  const rec = (ctx.gd && typeof ctx.gd.bond === 'function' ? ctx.gd.bond(ID.kazdel) : null)
    ?? (ctx.data && ctx.data.bonds ? ctx.data.bonds[ID.kazdel] : null);
  const p = buffParams(rec, 'bond_layer_added_reward_equip') ?? null;
  const step = Math.floor(num(p && p.layer, 0));
  if (!p || !(step > 0)) return 0;
  if (typeof ctx.counter !== 'function' || typeof ctx.setCounter !== 'function' || typeof ctx.grantItem !== 'function') return 0;
  const due = Math.floor(num(typeof ctx.layers === 'function' ? ctx.layers(ID.kazdel) : 0, 0) / step);
  const count = Math.max(0, Math.floor(num(p.count, 1)));
  const itemId = typeof p.reward_item === 'string' && p.reward_item ? p.reward_item : HORN_ITEM;
  let granted = 0;
  // 每付一次就重读计数器：grantItem 会派发 onGain，可能重入本函数（照 payHammers 的 100 次护栏）
  for (let guard = 0; guard < 100; guard++) {
    const paid = ctx.counter(HORN_COUNTER);
    if (paid >= due) break;
    ctx.setCounter(HORN_COUNTER, paid + 1);
    for (let i = 0; i < count; i++) {
      if (ctx.grantItem(itemId, { source: 'bond:kazdelShip' })) granted++;
    }
  }
  return granted;
}

/**
 * 整备侧注册：`layer` / `count` 的断角发放。只在 registry 提供 bond() 时挂（测试可以只测 payBreakHorns）。
 * 记录本身是 `annOnly`（非湮灭模式下 gd 会删掉它），加上 `bondActive` 的门，官方四档与炸惊拿不到任何东西。
 */
export function registerMeta(registry) {
  if (!registry || typeof registry.bond !== 'function') return;
  const prev = typeof registry.get === 'function' ? registry.get('bond:kazdelShip') : null;
  const handler = { ...(prev || {}) };
  for (const hook of HORN_HOOKS) {
    const before = prev && typeof prev[hook] === 'function' ? prev[hook] : null;
    handler[hook] = function breakHorns(ctx, ev) {
      if (before) before.call(this, ctx, ev);
      if (hook === 'onLayers' && !(ev && ev.bondId === ID.kazdel)) return;
      payBreakHorns(ctx);
    };
  }
  registry.bond(ID.kazdel, handler);
}
