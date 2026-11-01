// server/sim/content/bonds/addon/zjbonds.js — 炸惊模拟新增的三个盟约：岁 / 企鹅物流 / 医师。
//
// 原版数据里这三个是 bondType=NORMAL 的空壳（bb={}、buffs=[]），成员只记在 chess 记录的 bonds 里，战斗里没有
// 任何效果。它们的数值与文案全部写在 data/bonds.json 的 `zj` 块里、只在炸惊模拟下合并进来（shared/zjBonds.js），
// 所以这里也只在炸惊下生效 —— 判据是黑板上有没有 `zj_` 前缀的键：其它难度拿到的 bb 里没有这些键，num() 全是 0，
// 整个 install 直接空转（连钩子都不注册）。
//
//   岁 suiShip            2 名：成员攻击力、防御力各 +zj_atk_def_pct（直接乘算）
//                        3 名：成员的攻击额外造成该次伤害 zj_burn_ratio 的灼燃损伤（element：burn）
//                        4 名（天有四时）：成员攻击力额外 +zj_sui_atk_pct；
//                              场上所有干员生命 +zj_all_hp_pct、攻击速度 +zj_aspd、技力恢复 +zj_sp_regen/秒
//   企鹅物流 penguinShip  2 名：场上所有干员再部署时间 ×(1 + zj_redeploy_2)
//                        3 名：再部署时间 ×(1 + zj_redeploy_3)，且部署费用为 0（zj_free_deploy）
//   医师 physicianShip     1 名：成员攻击力 ×(1 + zj_atk_pct)
//
// 这三个盟约在炸惊下都没有随层数变化的数值，所以不需要 layerGain 重算，装一次就够。
// 装配顺序：content/bonds.js 的 PARTS 是 core → addon → mujicaBond；本文件由 addon.js 的 install 在
// addon/battle.js 之后调用（与参考包 addon.js 的 installBattle → installZjBonds 同序），所以它先于 mujicaBond 的
// 战斗侧钩子。颂乐人偶（mujicaShip，也是 zjOnly 盟约）在 mujicaBond.js / mujica.js（engine-cards）/ 本仓的
// support 里实现，不在本文件。
//
// 0.3.3 API 适配：伤害走 `battle.dealElementDamage({ source, target, amount, element })`（参考包用的是旧的位置参数
// `battle.dealDamage(u, tgt, { type:'element' })`，0.3.3 的 attack.js 明确拒绝用 dealDamage 打元素条）。

import {
  num, bondRecord, buffParams, bondTier, isMember, playerOps, passiveBuff, fxOn, directMods, battleStore,
} from '../../support/index.js';

const ID = Object.freeze({ sui: 'suiShip', penguin: 'penguinShip', physician: 'physicianShip' });
const KEY = Object.freeze({
  suiAtkDef: 'bond:suiShip:atkdef',
  suiTianAtk: 'bond:suiShip:tian:atk',
  suiTianAll: 'bond:suiShip:tian:all',
  penguin: 'bond:penguinShip:redeploy',
  physician: 'bond:physicianShip',
});
/** 岁 3 名档的灼燃损伤标记：它自己是元素条伤害，钩子里据此不再二次触发。 */
const BURN_TAG = 'bond:suiShip:burn';
/** 企鹅物流 3 名档暂存的原部署费用（`unit.base.cost`）。 */
const PENGUIN_COST = 'zj:penguin:cost';

/** 每个盟约的「炸惊标记键」：黑板上没有它 = 不是炸惊，这个盟约整个不装（连钩子都不注册）。 */
const MARK = Object.freeze({
  suiShip: 'zj_atk_def_pct',
  penguinShip: 'zj_redeploy_2',
  physicianShip: 'zj_atk_pct',
});

/**
 * 盟约的数值袋：顶层 `bb` 合并 `env_gbuff_new` 黑板。这三个盟约原版 `buffs` 是空的（没有 `env_gbuff_new` 条目），
 * 炸惊的数值只落在合并后的顶层 `bb` 上，所以两边都要读 —— 与 core.js / addon/battle.js 只读黑板不同。
 * @param {string} bondId
 */
const bbOf = (bondId) => {
  const rec = bondRecord(bondId);
  return { ...((rec && rec.bb) || {}), ...(buffParams(rec, 'env_gbuff_new') ?? {}) };
};

/**
 * 把一批干员的部署费用改成 0（deploy.js / tiles.js 都读 `unit.base.cost`），不在名单里的还原。盟约掉档或干员
 * 离场时费用要还回去，所以记一份原值。
 */
function applyFreeCost(battle, ops) {
  const saved = battleStore(battle, PENGUIN_COST, () => new Map());
  const want = new Set(ops);
  for (const [u, cost] of [...saved]) if (!want.has(u)) { u.base.cost = cost; saved.delete(u); }
  for (const u of want) if (!saved.has(u)) { saved.set(u, u.base.cost); u.base.cost = 0; }
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  const states = [];
  for (const p of battle.players) {
    const st = { pid: p.playerId, ops: playerOps(battle, p.playerId), tiers: {}, bb: {}, members: {} };
    for (const id of Object.values(ID)) {
      const t = bondTier(battle, st.pid, id);
      if (t <= 0) continue;
      const bb = bbOf(id);
      // 非炸惊（普通难度拿不到 `zj` 覆盖块）→ 整个盟约不装，其它模式完全不受影响
      if (!Object.hasOwn(bb, MARK[id])) continue;
      st.tiers[id] = t;
      st.bb[id] = bb;
      st.members[id] = new Set(st.ops.filter((u) => isMember(battle, u, id)));
    }
    if (Object.keys(st.tiers).length) states.push(st);
  }
  if (!states.length) return;
  const byPid = Object.create(null);
  for (const st of states) { byPid[st.pid] = st; applyPassives(battle, st); }
  const has = (id, tier = 1) => states.some((st) => (st.tiers[id] ?? 0) >= tier);

  // 岁 3 名档：成员造成的伤害附带 zj_burn_ratio（20%）的灼燃损伤。元素条伤害自己不再触发。
  if (has(ID.sui, 2)) {
    battle.on('damaged', (c) => {
      const u = c.source;
      if (!u || !c.dmg || c.type === 'element' || !(c.amount > 0)) return;
      const st = byPid[u.ownerId];
      if (!st || (st.tiers[ID.sui] ?? 0) < 2 || !st.members[ID.sui].has(u)) return;
      const tgt = c.target;
      if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
      const ratio = num(st.bb[ID.sui].zj_burn_ratio);
      if (!(ratio > 0)) return;
      battle.dealElementDamage({ source: u, target: tgt, amount: c.amount * ratio, element: 'burn', tags: [BURN_TAG] });
    });
  }

  // 天有四时：成员落地时给一次提示（纯表现）
  if (has(ID.sui, 3)) {
    battle.on('deploy', (c) => {
      const u = c.unit;
      const st = u && byPid[u.ownerId];
      if (!st || (st.tiers[ID.sui] ?? 0) < 3 || !st.members[ID.sui].has(u) || u.mem.zjSuiTian) return;
      u.mem.zjSuiTian = true;
      fxOn(battle, 'bondMilestone', u, ID.sui, 'tian');
    });
  }
}

function applyPassives(battle, st) {
  const t = st.tiers;

  // 岁：2 名 攻防 +30%
  if (t[ID.sui]) {
    const bb = st.bb[ID.sui];
    const ad = num(bb.zj_atk_def_pct);
    if (ad > 0) {
      const mods = directMods({ atk: ad, def: ad });
      for (const u of st.members[ID.sui]) passiveBuff(battle, u, KEY.suiAtkDef, mods);
    }
    // 天有四时（4 名）：岁干员攻击力额外 +zj_sui_atk_pct；场上所有干员 生命 / 攻速 / 技力恢复
    if (t[ID.sui] >= 3) {
      const atk = num(bb.zj_sui_atk_pct);
      if (atk > 0) {
        const mods = directMods({ atk });
        for (const u of st.members[ID.sui]) passiveBuff(battle, u, KEY.suiTianAtk, mods);
      }
      const hp = num(bb.zj_all_hp_pct), aspd = num(bb.zj_aspd), sp = num(bb.zj_sp_regen);
      if (hp > 0 || aspd > 0 || sp > 0) {
        const mods = directMods({ hp });
        if (aspd > 0) mods.aspd = aspd;
        if (sp > 0) mods.spRecoveryFlat = sp;
        for (const u of st.ops) passiveBuff(battle, u, KEY.suiTianAll, mods);
      }
    }
  }

  // 企鹅物流：再部署时间 -50% / -75%，3 名档部署费用为 0
  if (t[ID.penguin]) {
    const bb = st.bb[ID.penguin];
    const high = t[ID.penguin] >= 2;
    const m = high ? num(bb.zj_redeploy_3, -0.75) : num(bb.zj_redeploy_2, -0.5);
    const mods = { redeployMul: Math.max(0, 1 + m) };
    for (const u of st.ops) passiveBuff(battle, u, KEY.penguin, mods);
    applyFreeCost(battle, high && num(bb.zj_free_deploy) > 0 ? st.ops : []);
  }

  // 医师：成员攻击力 +60%
  if (t[ID.physician]) {
    const pct = num(st.bb[ID.physician].zj_atk_pct);
    if (pct > 0) {
      const mods = directMods({ atk: pct });
      for (const u of st.members[ID.physician]) passiveBuff(battle, u, KEY.physician, mods);
    }
  }
}
