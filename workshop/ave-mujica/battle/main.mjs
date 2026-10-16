// workshop/ave-mujica/battle/main.mjs — 颂乐人偶/Ave Mujica 的**战斗侧**逻辑（`pack.json.server.battle`，DESIGN §28.17）。
//
// 原来这份代码住在引擎的 `server/sim/mod/ave-mujica/ave-mujica.js`（靠引擎专属的 mod 挂载点加载）。现在它就在包里，
// 通过 `@battle/mod.js`（包侧 SDK）把盟约 / 特质注册进官方表 —— 包由此**自足**，引擎不再含任何 mod 专属代码。
//
// 注册面（一次性挂在模块顶层；本模块在服务端启动时与本浏览器页面各加载一次，所以两端都会注册）：
//   registerBondInstaller  颂乐人偶盟约安装器（5 名成员特质 + Fever 系统）
//   registerGarrisonInstaller  AVEMUJICA_FEVER_KILL / AVEMUJICA_EXTRA_TRIGGER
// 休整期那一半见 `meta/main.mjs`。
//
// 简化假设（见 bonds.json spec.assumed）：
//   * Fever 为每场战斗共享团队值（上限 450）：成员每次普通攻击造成伤害 +FEVER_PER_HIT；
//     三角初华在场 ×fever_ratio，5 人翻倍再 ×2；满 450 触发 20 s Fever 状态：期间成员持续获得大量 SP
//     回复（近似官方「无视技力限制持续释放技能」），且 Fever 不再积累。
//   * 除基础填充外，5 位成员「毋畏X」特质各自的 Fever 增量也已**逐条接线**（数值取各自 chess 记录里的 bb）：
//     祥子 毋畏遗忘 +3/造成伤害、初华 毋畏悲伤 +5/治疗成员、若麦 毋畏爱意 +3/秒在场、
//     海铃 毋畏恐惧 +2/造成停顿、若叶睦 毋畏死亡 +3/自身受伤。这些也走同一套乘数。
//   * 五位成员「毋畏X」特质的**另一半**（2026-10-14 补齐，语义同上、数值同样取自各角色 chess 记录）：
//     初华 攻击范围内成员攻击时附带 bonus_scale ×初华攻击力 的**法术**伤害；海铃 在场时成员对**停顿/恐惧**敌人
//     造成的伤害 ×(1 + dmg_up)；若叶睦 在场时**全体成员**生命上限 +max_hp；祥子「颂乐音符」：场上每存在 1 个音符，
//     成员无视敌人 def_pen 防御 / res_pen 法抗（≤ max_stack 层）。音符寿命 3 s [ASSUMED：数据无该值]。
//   * 「使已激活的盟约层数+1」= 所有已激活盟约（同蜜莓官方写法），含颂乐人偶自身。
//   * 丰川祥子 10%：非成员干员获得 Amoris/Timoris/Mortis 三项战斗效果的 10%（随 5 人翻倍）。
//   * 「可部署干员数量上限+1」在休整期那一半（meta/main.mjs，onBondChange 当帧生效）。

import * as S from '@battle/mod.js';
import {
  registerBondInstaller, registerGarrisonInstaller, reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag, num,
} from '@battle/mod.js';

/** 每场战斗的额外安装（本 mod 的注册都在模块顶层完成，这里无需每场逻辑）。 */
export function install() {}

// =====================================================================================================================
// 颂乐人偶 核心盟约

/** 基础 chess id → 成员角色（丰川祥子 Oblivionis / 三角初华 Doloris / 祐天寺若麦 Amoris / 八幡海铃 Timoris / 若叶睦 Mortis）。 */
const ROLE_BY_CHESS = Object.freeze({
  chess_char_6_30: 'oblivionis',
  chess_char_5_30: 'doloris',
  chess_char_5_31: 'amoris',
  chess_char_5_32: 'timoris',
  chess_char_5_25: 'mortis',
});
const roleOf = (u) => {
  const b = String(u && (u.defId || u.def?.id) || '').replace(/_[ab]$/, '');
  return ROLE_BY_CHESS[b] || null;
};

const FEVER_CAP = 450;
const FEVER_TIME = 20;
const FEVER_PER_HIT = 2;
const FEVER_BUF = 'bond:avemujica:fever';
const FEVER_SP_FLAT = 1000; // Fever 状态下每秒回复的 SP（近似「持续释放技能」）

/**
 * 客户端面板（`ui/fever.js`）读的**实时** Fever 读数：`pid -> { fever, cap, on, until }`。
 * 面板拿不到战场对象，只能靠模块级读数 —— 它按 `battleRunner.currentBattle().spec.workshopBattle` 里那条
 * `/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>` 的**同一 URL** `import()` 本模块（ES module 按 URL
 * 去重 ⇒ 与运行器加载的是同一个实例），于是读得到这张表。只给本机自己那台客户端用；服务端跑战斗时本模块的
 * installer 不在浏览器里执行，这张表就是空的（面板会因此不画）。
 */
export const FEVER_LIVE = { byPid: Object.create(null) };

/**
 * 颂乐人偶: 只要有成员在场即激活（thresholds [1..5]）。成员特质（每层叠加，5 人全部 ×2）：
 *   Amoris   全体颂乐人偶成员 ATK +(amoris_atk + amoris_atk_per·L)
 *   Timoris  成员攻击命中敌人：prob = (timoris_prob + timoris_prob_per·L) 停顿 timoris_dur 秒
 *   Mortis   成员攻击附带凋亡损伤 = (mortis_pct + mortis_pct_per·L) × 攻击力
 *   Doloris  Fever 获得量 ×fever_ratio
 *   Oblivionis 非成员干员获得上述三项效果的 obliv_share（5 人时再 ×2）
 *   Fever 系统见头注释。
 * 成员各自「毋畏X」特质的**另一半**（2026-10-14 补齐）：初华 攻击范围内成员攻击附带 bonus_scale×攻击力 法术伤害；
 *   海铃 在场时成员对停顿/恐惧敌人增伤 dmg_up；若叶睦 在场时全体成员生命上限 +max_hp；
 *   祥子「颂乐音符」成员按场上音符数无视 def_pen 防御 / res_pen 法抗。
 */
function installAveMujica(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
  const L = () => S.bondLayers(battle, pid, 'aveMujica');
  const dbl = () => (reached(battle, pid, 'aveMujica', 5) ? 2 : 1);
  const roles = () => {
    const r = { amoris: false, timoris: false, mortis: false, doloris: false, oblivionis: false };
    for (const u of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      const k = roleOf(u);
      if (k) r[k] = true;
    }
    return r;
  };
  const feverOn = () => battle.time < st.until;
  const allOps = () => S.playerOps(battle, pid, { fieldOnly: true });

  // ---- 「毋畏X」各成员特质各自的 Fever 增量（2026-10-13 逐条接线）----------------------------------------------
  // 数值**逐条取自该干员 chess 记录里那条特质的 bb**（不写死在代码里）：
  //   丰川祥子   毋畏遗忘 bb.fever            3  对敌人造成伤害时（任意伤害来源，含技能）
  //   三角初华   毋畏悲伤 bb.fever            5  治疗【颂乐人偶】成员时
  //   祐天寺若麦 毋畏爱意 bb.fever_per_sec    3  在场时每秒
  //   八幡海铃   毋畏恐惧 bb.fever            2  使敌人停顿（Timoris 减速命中）时
  //   若叶睦     毋畏死亡 bb.cnt              3  自身受到一次伤害或损伤时
  // 这些增量一律走 gainFever() ⇒ 与「成员攻击填充 +2/次」共用同一套乘数（初华 ×fever_ratio、5 人 ×2）。
  const TALENT_NAME = Object.freeze({
    oblivionis: '毋畏遗忘', doloris: '毋畏悲伤', amoris: '毋畏爱意', timoris: '毋畏恐惧', mortis: '毋畏死亡',
  });
  /** 按名字取某个角色那条特质的 `bb`（`u.def.raw.talents`；找不到 ⇒ null）。 */
  const roleTalentBb = (u, role) => {
    const list = u && u.def && u.def.raw && Array.isArray(u.def.raw.talents) ? u.def.raw.talents : null;
    if (!list) return null;
    const t = list.find((x) => x && x.name === TALENT_NAME[role]);
    return t && t.bb && typeof t.bb === 'object' ? t.bb : null;
  };
  /** 该角色**当前在场**成员那条特质里 key 的数值（无该角色 / 不在场 / 无该键 ⇒ 0）。 */
  const traitFever = (role, key) => {
    for (const u of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      if (roleOf(u) === role) return num((roleTalentBb(u, role) || {})[key], 0);
    }
    return 0;
  };
  /** 本场属于某角色的干员（含未上场）—— 用它们各自的任命挂 Fever 钩子。 */
  const roleUnits = (role) => S.playerOps(battle, pid, { fieldOnly: false }).filter((u) => roleOf(u) === role);
  /** 该角色**当前在场**的第一个成员（无 ⇒ null）。 */
  const fieldRole = (role) => S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true }).find((u) => roleOf(u) === role) || null;
  /** 按特质**名字**取 bb（「颂乐音符」等不在 TALENT_NAME 里的用它；`u.def.raw.talents`）。 */
  const talentBbByName = (u, name) => {
    const list = u && u.def && u.def.raw && Array.isArray(u.def.raw.talents) ? u.def.raw.talents : null;
    if (!list) return null;
    const t = list.find((x) => x && x.name === name);
    return t && t.bb && typeof t.bb === 'object' ? t.bb : null;
  };

  // ---- Amoris: 成员 ATK buff（refresh: deploy / layerGain / battleStart）
  const applyAtk = () => {
    const r = roles();
    const d = dbl();
    const pct = (num(bb.amoris_atk, 0.25) + num(bb.amoris_atk_per, 0.0025) * L()) * d;
    const share = num(bb.obliv_share, 0.25) * d;
    for (const u of allOps()) {
      const isM = memberSet.has(u);
      const eff = isM ? pct : (r.oblivionis ? pct * share : 0);
      if (r.amoris && eff > 0) S.passiveBuff(battle, u, 'bond:avemujica:atk', S.directMods({ atk: eff }));
      else battle.removeBuff(u, 'bond:avemujica:atk');
    }
  };
  // ---- Mortis「毋畏死亡」后半：在场时**全体成员**生命上限 +max_hp（原先是单挂自身）
  const applyHp = () => {
    const m = fieldRole('mortis');
    const hp = m ? num((roleTalentBb(m, 'mortis') || {}).max_hp, 0) : 0;
    for (const u of allOps()) {
      if (memberSet.has(u) && hp > 0) S.passiveBuff(battle, u, 'bond:avemujica:hp', S.directMods({ hp }));
      else battle.removeBuff(u, 'bond:avemujica:hp');
    }
  };
  // 团队 buff 一起刷新（成员进出场即时生效）：deploy / death / battleStart / layerGain / 每 0.5 s
  const refreshTeam = () => { applyAtk(); applyHp(); };
  refreshTeam();
  onLayers(battle, pid, 'aveMujica', refreshTeam);
  battle.on('deploy', ({ unit }) => { if (unit.ownerId === pid) refreshTeam(); });
  battle.on('death', ({ unit }) => { if (unit && unit.ownerId === pid) refreshTeam(); });
  battle.on('battleStart', refreshTeam);
  battle.every(0.5, refreshTeam);

  // ---- Timoris / Mortis / Fever 的伤害钩子（对每个己方干员注册；丰川祥子在场时非成员吃 25%）
  /** 把本玩家当前的 Fever 读数写进模块级表（客户端面板读它画积攒进度条）。 */
  const pub = () => {
    FEVER_LIVE.byPid[pid] = { fever: st.fever, cap: FEVER_CAP, on: feverOn(), until: st.until };
  };
  const gainFever = (n) => {
    if (feverOn()) return;
    const r = roles();
    const mult = (r.doloris ? num(bb.fever_ratio, 2) : 1) * dbl();
    st.fever = Math.min(FEVER_CAP, st.fever + n * mult);
    if (st.fever >= FEVER_CAP) {
      st.fever = 0;
      st.until = battle.time + FEVER_TIME;
      // 锚点必须是**一个在场成员**：`fxOn` 的第 3 个参数是锚定单位，传 null 会被 `if (!u) return` 直接吞掉
      // （旧代码就是这么写的 ⇒ 这条特效从来没发射过）。锚一个成员，品红团队光环才会真的画出来。
      const anchor = S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true }).find((m) => !!m) || null;
      if (anchor) S.fxOn(battle, 'fever', anchor, 'bond:avemujica', 'fever', { duration: FEVER_TIME });
    }
    pub();
  };
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!u || !dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:avemujica')) return;
    const r = roles();
    const d = dbl();
    const share = memberSet.has(u) ? 1 : (r.oblivionis ? num(bb.obliv_share, 0.25) * d : 0);
    if (!(share > 0)) return;
    if (r.timoris) {
      const p = (num(bb.timoris_prob, 0.25) + num(bb.timoris_prob_per, 0.0005) * L()) * d * share;
      if (p > 0 && battle.rng() < Math.min(1, p)) {
        battle.applyStatus(t, 'sluggish', { duration: num(bb.timoris_dur, 1), source: u });
        // 八幡海铃「毋畏恐惧」：造成停顿时 Fever +bb.fever
        const nf = traitFever('timoris', 'fever');
        if (nf > 0) gainFever(nf);
      }
    }
    if (r.mortis) {
      const pct = (num(bb.mortis_pct, 0.25) + num(bb.mortis_pct_per, 0.0005) * L()) * d * share;
      if (pct > 0) {
        battle.dealDamage(u, t, { amount: pct * u.s.atk, type: 'element', element: 'apoptosis', canDodge: false, tags: ['bond:avemujica'] });
      }
    }
    // 三角初华「毋畏悲伤」后半：攻击范围内的成员攻击时，附带「初华攻击力 × bonus_scale」的法术伤害
    if (memberSet.has(u) && r.doloris) {
      const dl = fieldRole('doloris');
      const bs = dl ? num((roleTalentBb(dl, 'doloris') || {}).bonus_scale, 0) : 0;
      if (bs > 0 && S.inRange(dl, u)) {
        battle.dealDamage(u, t, { amount: dl.s.atk * bs, type: 'arts', canDodge: false, tags: ['bond:avemujica'] });
      }
    }
    gainFever(FEVER_PER_HIT);
  };
  for (const u of S.playerOps(battle, pid, { fieldOnly: false })) onUnitDamaged(battle, u, onDmg);

  // ---- 八幡海铃「毋畏恐惧」后半：在场时，成员对处于停顿/恐惧的敌人造成的伤害 ×(1 + dmg_up)
  const debuffed = (t) => Array.isArray(t && t.buffs) && t.buffs.some((b) => b && (b.status === 'sluggish' || b.status === 'fear'));
  battle.on('hit', (c) => {
    const dmg = c.dmg, t = c.target;
    if (!dmg || !isEnemyTarget(t) || !memberSet.has(c.source) || !debuffed(t)) return;
    const tm = fieldRole('timoris');
    const v = tm ? num((roleTalentBb(tm, 'timoris') || {}).dmg_up, 0) : 0;
    if (v > 0) dmg.mul *= 1 + v;
  });

  // ---- 丰川祥子「颂乐音符」T1：场上每存在一个音符，成员无视敌人 def_pen 防御 / res_pen 法抗（≤ max_stack）
  // 引擎未建模音符实体：祥子每「演奏」（一次对敌造成伤害的实例）记 1 个音符，NOTE_LIFE 秒后消失
  // [ASSUMED: 数据无音符存活时长，取约 2 个攻击间隔（bat 1.3 s）]。
  const NOTE_BUF = 'bond:avemujica:note';
  const NOTE_LIFE = 3;
  const noteState = S.battleStore(battle, 'avemujica:notes', () => ({ exp: [] }));
  const addNote = () => { const e = noteState.exp; if (e.length < 64) e.push(battle.time + NOTE_LIFE); };
  const noteCount = () => {
    const e = noteState.exp, now = battle.time;
    while (e.length && e[0] <= now) e.shift(); // 入栈时间递增 ⇒ 天然有序
    return e.length;
  };
  const applyNotes = () => {
    const ob = fieldRole('oblivionis');
    const tb = ob ? talentBbByName(ob, '颂乐音符') : null;
    const cap = tb ? Math.max(0, Math.floor(num(tb.max_stack, 0))) : 0;
    const n = cap > 0 ? Math.min(cap, noteCount()) : 0;
    const defPen = tb ? num(tb.def_pen, 0) : 0;
    const resPen = tb ? num(tb.res_pen, 0) : 0;
    const mods = {};
    if (n > 0 && defPen > 0) mods.defIgnorePct = n * defPen;
    if (n > 0 && resPen > 0) mods.resIgnorePct = n * resPen;
    const has = Object.keys(mods).length > 0;
    for (const u of allOps()) {
      if (memberSet.has(u) && has) S.passiveBuff(battle, u, NOTE_BUF, mods);
      else battle.removeBuff(u, NOTE_BUF);
    }
  };
  applyNotes();
  battle.every(0.25, applyNotes);
  // 祥子每造成一次敌人伤害 ⇒ 记一个音符（过滤掉本包自己的附加伤害）
  for (const u of roleUnits('oblivionis')) {
    onUnitDamaged(battle, u, (dctx) => {
      if (!S.onField(u) || !isEnemyTarget(dctx.target) || (dctx.dmg && ownTag(dctx.dmg, 'bond:avemujica'))) return;
      addNote();
    });
  }

  // ---- 各成员「毋畏X」特质各自的 Fever 增量（逐条接线；数值取各自 chess 记录里的 bb）---------------------------
  // 丰川祥子「毋畏遗忘」：对敌人造成**任何**伤害（普攻与技能）时 Fever +bb.fever（与「成员攻击填充 +2」相加）
  for (const u of roleUnits('oblivionis')) {
    const n = num((roleTalentBb(u, 'oblivionis') || {}).fever, 0);
    if (!(n > 0)) continue;
    onUnitDamaged(battle, u, (dctx) => {
      if (!S.onField(u) || !dctx.dmg || !isEnemyTarget(dctx.target) || ownTag(dctx.dmg, 'bond:avemujica')) return;
      gainFever(n);
    });
  }
  // 三角初华「毋畏悲伤」：治疗【颂乐人偶】成员时 Fever +bb.fever
  for (const u of roleUnits('doloris')) {
    const n = num((roleTalentBb(u, 'doloris') || {}).fever, 0);
    if (!(n > 0)) continue;
    battle.on('heal', (hctx) => {
      if (hctx.source !== u || !S.onField(u) || !memberSet.has(hctx.target)) return;
      gainFever(n);
    });
  }
  // 祐天寺若麦「毋畏爱意」：在场时每秒 Fever +bb.fever_per_sec
  for (const u of roleUnits('amoris')) {
    const n = num((roleTalentBb(u, 'amoris') || {}).fever_per_sec, 0);
    if (!(n > 0)) continue;
    battle.every(1, () => { if (S.onField(u)) gainFever(n); }, { owner: u });
  }
  // 若叶睦「毋畏死亡」：自身受到一次伤害或损伤时 Fever +bb.cnt
  for (const u of roleUnits('mortis')) {
    const n = num((roleTalentBb(u, 'mortis') || {}).cnt, 0);
    if (!(n > 0)) continue;
    battle.on('damaged', (dctx) => {
      if (dctx.target !== u || !S.onField(u) || (dctx.dmg && ownTag(dctx.dmg, 'bond:avemujica'))) return;
      gainFever(n);
    });
  }

  // ---- Fever 状态: 每 0.5 s 给在场成员大量 SP 回复（近似持续释放技能）
  battle.every(0.5, () => {
    if (!feverOn()) {
      for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) battle.removeBuff(m, FEVER_BUF);
      pub();
      return;
    }
    for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      if (!m.skill) continue;
      battle.addBuff(m, { key: FEVER_BUF, duration: 0.6, refresh: 'replace', mods: { spRecoveryFlat: FEVER_SP_FLAT } });
    }
    pub();
  }, { immediate: true });

  pub(); // 开场先发一份（面板在第一次 tick 之前也读得到 0/450）
}

registerBondInstaller('aveMujica', installAveMujica);

// =====================================================================================================================
// 干员个人特质（garrisons.json）
//   祥子  AVEMUJICA_FEVER_KILL    <战斗开始时>Fever += 层数×fever_ratio；击倒敌人 → 所有活跃盟约层数 +kill_layers
//                                （max_count 限制本场战斗的触发次数，下一场重新计数）
//   初华  AVEMUJICA_EXTRA_TRIGGER 放大器（extra_trigger 次）+ 源为祥子时所有活跃盟约 +partner_layers（每场 1 次）
//   （海铃 AVEMUJICA_REFRESH_LAYERS / 若麦 AVEMUJICA_PREP_REWARD 是休整期那一半，见 meta/main.mjs）

/** 所有活跃盟约层数 +n（「使所有已激活的盟约层数+…」——同蜜莓官方写法，含颂乐人偶自身）。 */
function addLayersToActive(battle, pid, n, source) {
  const ps = S.player(battle, pid);
  if (!ps || !ps.bonds || !(n > 0)) return;
  for (const [bid, bs] of Object.entries(ps.bonds)) {
    if (!bs || !bs.active) continue;
    S.gainLayers(battle, { playerId: pid, bonds: [bid], n, requireActive: false, source, reason: 'garrison' });
  }
}

registerGarrisonInstaller('AVEMUJICA_FEVER_KILL', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    battle.on('battleStart', () => {
      if (!u || !S.onField(u)) return;
      const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
      const L = S.bondLayers(battle, u.ownerId, 'aveMujica');
      const add = Math.floor(L * S.num(it.bb.fever_ratio, 0.5));
      if (add > 0) st.fever = Math.min(FEVER_CAP, st.fever + add);
    });
    battle.on('kill', ({ killer }) => {
      if (!killer || killer !== u || !S.onField(u)) return;
      // 「（最多N次）」: max_count caps this battle's triggers (the store lives in the battle, so the next fight starts at 0).
      const cap = Math.max(0, Math.floor(S.num(it.bb.max_count, 0)));
      if (cap > 0) {
        const ks = S.battleStore(battle, `avemujica:kill:${u.id}`, () => ({ n: 0 }));
        if (ks.n >= cap) return;
        ks.n++;
      }
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(it.bb.kill_layers, 1))), u);
      // 初华连携: 触发干员为丰川祥子（祥子的击倒特质触发）时, 场上有初华 → 所有活跃盟约 +partner_layers（每场 1 次）
      const st = S.battleStore(battle, 'avemujica:partner', () => ({ used: false }));
      if (st.used) return;
      let partner = null;
      for (const m of S.bondMembers(battle, u.ownerId, 'aveMujica', { fieldOnly: true })) {
        if (roleOf(m) === 'doloris') { partner = m; break; }
      }
      if (!partner) return;
      const g = S.garrisonRecord(partner.def?.raw?.garrisonIds?.[0] || partner.def?.garrisonIds?.[0]);
      if (!g || g.effectKey !== 'AVEMUJICA_EXTRA_TRIGGER') return;
      st.used = true;
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(g.bb.partner_layers, 1))), partner);
    });
  }
});

registerGarrisonInstaller('AVEMUJICA_EXTRA_TRIGGER', (battle, list) => {
  if (!battle._rbAmplifiers) battle._rbAmplifiers = [];
  for (const it of list) {
    const amp = { unit: it.unit, bb: it.bb, usedOnce: false };
    amp.onAmp = (b2, srcIt, src) => {
      if (amp.usedOnce || roleOf(src) !== 'oblivionis') return;
      amp.usedOnce = true; // 每回合（= 每场战斗）1 次
      addLayersToActive(b2, src.ownerId, Math.max(1, Math.floor(S.num(it.bb.partner_layers, 1))), amp.unit);
    };
    battle._rbAmplifiers.push(amp);
  }
});
