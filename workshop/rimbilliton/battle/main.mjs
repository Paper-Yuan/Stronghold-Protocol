// workshop/rimbilliton/battle/main.mjs — 雷姆必拓 mod 的**战斗侧**逻辑（`pack.json.server.battle`，DESIGN §28.17）。
//
// 原来这份代码住在引擎的 `server/sim/mod/rimbilliton/rimbilliton.js`。现在它就在包里，通过 `@battle/mod.js`
// （包侧 SDK）把自己注册进官方表 —— 包由此自足，引擎不再含任何 mod 专属代码。
//
// 注册面（一次性挂在模块顶层）：
//   registerBondInstaller      雷姆必拓盟约
//   registerGarrisonInstaller  若叶睦 / 暴行 / 阿米娅 / 莱伊 的战斗特质
//   registerGarrisonReader     珊比 每 5 层减伤
//   registerItemBehaviour      绿叶菜罐头 / “幸福在途”补给包
// （沙地兽召唤物 = 包内 `kits/token_10034_ray_sndbst.js`，走官方 §4.7 通道；休整期那一半见 `meta/main.mjs`。）

import * as S from '@battle/mod.js';
import {
  registerBondInstaller, registerGarrisonInstaller, registerGarrisonReader, registerItemBehaviour, setBattleMark,
  reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag, byUnit, fireGain, garrisonIdsOf,
  bp, isProc, procTags, memberOf, num,
} from '@battle/mod.js';
import { frontOf } from '@sim/dir.js';
import { FORCED_EXIT } from '@sim/constants.js';

/** 每场战斗的额外安装（本 mod 的注册都在模块顶层完成，这里无需每场逻辑）。 */
export function install() {}

// =====================================================================================================================
// 雷姆必拓 核心盟约

/**
 * 雷姆必拓: 3 — the last-deployed 雷姆必拓 operator gains "开拓心": every distinct 雷姆必拓 operator on the field cuts
 * its damage taken by 10 % each; the holder's max HP +(base + per·L) %; its attacks deal extra true damage =
 * (base_true + per_true·L) of its own max HP. 6 — every 雷姆必拓 operator on the field gains ATK (flat) = atk_hp_share
 * of the holder's max HP. The mark follows the most recent deployment; on the holder's death it passes to the most
 * recently deployed surviving 雷姆必拓 operator (research-consistent with "最后上场的1名").
 */
function installRimBilliton(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const st = { holder: null, order: [] };
  // live holder unit, shared with the mod items (幸福在途补给包 reads its max HP): battleStore namespace
  const rt = S.battleStore(battle, 'rimbilliton:rt', () => ({ holder: null }));
  const L = () => S.bondLayers(battle, pid, 'rimBilliton');
  const three = () => reached(battle, pid, 'rimBilliton', bb.power_bond_char_cnt);
  const six = () => reached(battle, pid, 'rimBilliton', bb.ex_bond_char_cnt);
  const rbOnField = () => S.bondMembers(battle, pid, 'rimBilliton', { fieldOnly: true });
  const hpPct = () => num(bb.hp, 0) + num(bb.hp_per_stack, 0) * L();
  const truePct = () => num(bb.true_dmg, 0) + num(bb.true_dmg_per_stack, 0) * L();
  const clearSix = () => {
    for (const m of S.bondMembers(battle, pid, 'rimBilliton')) battle.removeBuff(m, 'bond:rimbilliton:six');
  };
  const refresh = () => {
    const u = st.holder;
    if (!u || !S.onField(u)) { clearSix(); return; }
    // 开拓心 on the holder: damage taken −5 % per distinct 雷姆必拓 on the field, max HP +hpPct()
    battle.addBuff(u, {
      key: 'bond:rimbilliton:heart', persist: true, refresh: 'replace',
      mods: Object.assign(S.directMods({ hp: hpPct() }), { dmgTakenMul: Math.max(0, 1 - num(bb.taken_reduce, 0) * rbOnField().length) }),
    });
    clearSix();
    if (!six()) return;
    // 6: every 雷姆必拓 on the field gets ATK (flat) = atk_hp_share of the holder's current max HP
    const share = num(bb.atk_hp_share, 0) * u.s.maxHp;
    if (!(share > 0)) return;
    for (const m of rbOnField()) {
      battle.addBuff(m, { key: 'bond:rimbilliton:six', persist: true, refresh: 'replace', mods: { atkFlat: share } });
    }
  };
  const setHolder = (u) => {
    if (st.holder === u) { refresh(); writeExtra(); return; }
    if (st.holder) battle.removeBuff(st.holder, 'bond:rimbilliton:heart');
    st.holder = u;
    rt.holder = u;
    refresh();
    writeExtra();
  };
  // 开拓心持有者跨阶段带到休整期（通用通道：setBattleMark → 引擎收进 ps.marks → meta 用 ctx.mark('holder') 读）
  const writeExtra = () => {
    setBattleMark(battle, pid, 'holder', st.holder ? st.holder.defId : null);
  };
  const lastOnField = (exclude) => {
    for (let i = st.order.length - 1; i >= 0; i--) {
      const u = st.order[i];
      if (u !== exclude && u.alive && S.onField(u)) return u;
    }
    return null;
  };
  // 休整期最后摆上场的**雷姆必拓成员**：引擎把整盘的摆放顺序（board 插入序）写进 `input.placementOrder`，
  // 本包从后往前找第一个属于本盟约的棋子（战斗初始部署按列序，与玩家摆放顺序不同，所以顺序要显式带过来）。
  const rbInput = (battle.players || []).find((p) => p.playerId === pid);
  const order = rbInput && rbInput.input && Array.isArray(rbInput.input.placementOrder) ? rbInput.input.placementOrder : [];
  const byUid = new Map(battle.allyUnits.map((u) => [u.uid, u]));
  let prepHolder = null;
  for (let i = order.length - 1; i >= 0; i--) {
    const u = byUid.get(order[i]);
    if (u && memberSet.has(u)) { prepHolder = u; break; }
  }
  battle.on('deploy', ({ unit, initial }) => {
    if (!memberSet.has(unit) || unit.ownerId !== pid) return;
    const idx = st.order.indexOf(unit);
    if (idx >= 0) st.order.splice(idx, 1);
    st.order.push(unit);
    if (!three()) return;
    // 初始部署保持休整期确定的 holder（最后摆上场者）；战斗中的再部署才更新
    if (initial && st.holder) { refresh(); writeExtra(); return; }
    setHolder(unit);
  });
  battle.on('death', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    if (unit === st.holder) {
      const u = lastOnField(unit);
      if (u) setHolder(u);
      else { battle.removeBuff(st.holder, 'bond:rimbilliton:heart'); st.holder = null; rt.holder = null; writeExtra(); }
    } else refresh();
  });
  onLayers(battle, pid, 'rimBilliton', refresh);
  // 初始 holder = 休整期最后摆上场的雷姆必拓干员（若为盟约成员；战斗初始部署保持它，不再按列序覆盖）
  if (prepHolder && memberSet.has(prepHolder)) setHolder(prepHolder);
  // 攻击附带真实伤害 (holder only)
  const onDmg = (ctx) => {
    const u = ctx.source;
    if (!u || u !== st.holder) return;
    const t = ctx.target, dmg = ctx.dmg;
    if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:rimbilliton')) return;
    const pct = truePct();
    if (!(pct > 0)) return;
    battle.dealDamage(u, t, { amount: pct * u.s.maxHp, type: 'true', canDodge: false, tags: ['bond:rimbilliton'] });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

registerBondInstaller('rimBilliton', installRimBilliton);

// =====================================================================================================================
// 战斗侧特质 (IN_BATTLE)

// 若叶睦 "受到伤害时使自身已激活的层数+N（最多M次）"：M = 触发次数上限
registerGarrisonInstaller('act_gar_event_onhurt_add_bond_layer', (battle, list) => {
  const m = byUnit(list);
  battle.on('damaged', ({ target, amount }) => {
    const arr = m.get(target);
    if (!arr || !(amount > 0)) return;
    for (const it of arr) {
      if (num(it.bb.max_count, 0) > 0 && (it.fired || 0) >= num(it.bb.max_count)) continue;
      it.fired = (it.fired || 0) + 1;
      fireGain(battle, it);
    }
  });
});

// 暴行 "若没有陷入过再部署状态，使下个休整期额外获得雷姆必拓干员"
registerGarrisonInstaller('SERVER_ADD_CHAR_NO_REDEPLOY', (battle, list) => {
  const units = new Set(list.map((it) => it.unit));
  const fell = new Set(); // 本场战斗中陷入过再部署（被击倒 / 退场进入再部署计时）的干员
  battle.on('death', ({ unit, reason }) => {
    if (!units.has(unit) || reason === FORCED_EXIT) return; // 联防上一阶段退场的延续不算本场新陷入
    if (Number.isFinite(unit.respawnAt)) fell.add(unit);    // _remove 对非永久退场设置 respawnAt（永久退场保持 Infinity）
  });
  battle.on('battleEnd', () => {
    for (const it of list) {
      const u = it.unit;
      // 未陷入过再部署（上场后未被击倒 / 退场）→ 发放（defId）；否则 null（每场战斗后整体替换，休整期只读到本场的结果）
      setBattleMark(battle, u.ownerId, 'noRedeploy', fell.has(u) ? null : u.defId);
    }
  });
});

// 阿米娅 "其他干员触发的战斗时类效果额外触发N次（每名干员最多M次）"（fireGain 的放大器列表）
registerGarrisonInstaller('SERVER_EXTRA_TRIGGER_BATTLE_EFFECT', (battle, list) => {
  if (!battle._rbAmplifiers) battle._rbAmplifiers = [];
  for (const it of list) battle._rbAmplifiers.push(it);
});

// 莱伊 "战斗开始时复制身前一格/两格内的其他干员的战斗中类效果"
registerGarrisonInstaller('SERVER_COPY_FRONT_EFFECT_BATTLE', (battle, list) => {
  battle.on('battleStart', () => {
    for (const it of list) {
      const u = it.unit;
      if (!S.onField(u)) continue;
      const fc = Math.max(1, num(it.bb.front_count, 1));
      for (let k = 1; k <= fc; k++) {
        const [fr, fcol] = frontOf(u.tileR, u.tileC, u.dir, k);
        const t = S.allyAt(battle, fr, fcol, u.ownerId);
        if (!t || !S.isOp(t) || t === u || !S.onField(t)) continue;
        for (const gid of garrisonIdsOf(t)) {
          const g = S.garrisonRecord(gid);
          if (g && g.eventType === 'IN_BATTLE') battle.rbAddGarrison(u, g);
        }
      }
    }
  });
});

// 珊比 (层数 reader): 每叠加1层，本干员受到的伤害降低 taken_reduce
// applyReader 已先算好 it.k（守卫 + 更新）——这里只按 it.k 应用 buff（与官方 reader case 同款）。
registerGarrisonReader('act_gar_eff_takenReduceByBond', (battle, it) => {
  const k = it.k;
  const u = it.unit;
  const key = `gar:${it.gid}`;
  if (k > 0) S.passiveBuff(battle, u, key, { dmgTakenMul: Math.max(0, 1 - num(it.bb.taken_reduce, 0) * k) });
  else battle.removeBuff(u, key);
});

/** 雷姆必拓 开拓心 holder unit of `pid` (installRimBilliton keeps it in its battleStore), or null. */
const rimbHolder = (battle, pid) => {
  const h = S.battleStore(battle, 'rimbilliton:rt').holder;
  return h && h.ownerId === pid ? h : null;
};

// =====================================================================================================================
// 装备 (battle side)

// 绿叶菜罐头: 受到的伤害 ×dmg_taken_mul — its giveBondId rimBilliton only matters with 变形同构体
// (the carrier then counts as a 雷姆必拓 member; the can alone grants nothing — support unitBonds)
registerItemBehaviour('chess_item_2_08_e', (battle, u, rec, scope) => {
  const p = bp(rec, 'mod_rimbilliton_greens_can');
  const v = p ? num(p.dmg_taken_mul, 1) : 1;
  if (v !== 1) scope.stat('taken', { dmgTakenMul: v });
});

// “幸福在途”补给包: 造成的伤害 ×damage_scale (dmgDealtMul); 若携带者为【雷姆必拓】盟约干员，造成伤害时
// 额外造成1次真实伤害 = true_damage_hp_scale × 开拓心 holder 的生命上限 (bonds/core.js battleStore 'rimbilliton:rt')
registerItemBehaviour('chess_item_6_12_e', (battle, u, rec, scope) => {
  const p = bp(rec, 'mod_rimbilliton_happy_supply');
  if (!p) return;
  const sc = num(p.damage_scale, 1);
  if (sc !== 1) scope.stat('dmg', { dmgDealtMul: sc });
  const hp = num(p.true_damage_hp_scale);
  if (!(hp > 0)) return;
  scope.on('damaged', (c) => {
    if (c.source !== u || isProc(c.dmg) || c.type === 'element' || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
    if (!memberOf(battle, u, 'rimBilliton')) return;
    const h = rimbHolder(battle, u.ownerId);
    if (!h || !h.alive || !S.onField(h)) return;
    battle.dealDamage(u, c.target, { amount: h.s.maxHp * hp, type: 'true', canDodge: false, tags: procTags('happy_supply') });
  });
});
