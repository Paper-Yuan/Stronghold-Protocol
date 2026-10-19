// server/match/match/traitDraft.js — 超限模拟的「词条抉择」阶段（业主 2026-10-18）
//
// 只在超限模式出现，且只在「通过 Boss 的下一回合」开：
//   进入 TRAIT_DRAFT → 抽三张卡（每张 = 一只悬赏怪 + 一条词条）→ 玩家选一张
//   → 词条记进 this.traitMods（整局累计）→ 选中的怪进 this.traitSpawn（下一轮出场、不带赏金）
//   → 回到 PREP
//
// 普通模式完全不经过这里（Match.isInfinite 判断）。

import { PHASE, ERR } from '../../../shared/constants.js';
import { drawTraitCards, traitFlags, TRAIT_SETTLE, SPECIAL_STATS, SPECIALS } from '../traits.js';

const OK = { ok: true };
const fail = (error, why) => (why ? { error, why } : { error });

/** 该回合要不要开词条抉择：通过 Boss 的下一回合 */
export function wantsTraitDraft(m, round) {
  if (!m.isInfinite) return false;
  if (round < 16) return false;
  // 上一回合是 Boss 轮 → 这一回合开
  if (!isInfiniteBossRoundSafe(round - 1)) return false;
  // 而且那只领袖必须真的被消灭（漏掉就不给词条）。settle 在推进回合前把结果记在
  // _infBossClearedRound 里 —— 那时 this.wave 还是本轮（带 Boss）的波次。
  if (m._infBossClearedRound != null) return m._infBossClearedRound === round - 1;
  return true;
}

/**
 * 与 server/match/infiniteWaves.js isInfiniteBossRound 同一口径：R20/25/30… 每 5 回合一次。
 * 这里保留一份本地实现，避免匹配层为了一个纯函数再引一次 waves 模块。
 */
function isInfiniteBossRoundSafe(r) {
  return r >= 20 && r % 5 === 0;
}

export class MatchTraitDraft {
  /**
   * 开一次词条抉择。极性按「第几次」奇偶交替：第 1 次正面、第 2 次负面……
   * @param {number} round
   */
  enterTraitDraft(round = this.round) {
    const alive = this.alivePlayers();
    if (!alive.length) { this.enterPrep(); return; }
    const n = (this.traitDraftCount || 0);
    const polarity = n % 2 === 0 ? 'pos' : 'neg';
    const cards = drawTraitCards(this.rngMeta, polarity);
    if (!cards.length) { this.enterPrep(); return; }
    this.phase = PHASE.TRAIT_DRAFT;
    this.trait = { round, polarity, cards, idx: 0, order: alive.map((p) => p.playerId), picks: {} };
    this.setDeadline(0);   // 单人无时限（超限是单人模式）
    this.markPublic();
    return true;
  }

  traitTurn() {
    const t = this.trait;
    if (!t) return null;
    return t.order[t.idx] ?? null;
  }

  /**
   * 主动战术撤退（业主 2026-10-19）：词条抉择界面右下角的按钮，点一下就以**当回合**结算。
   * 只记录已通过的轮次，不算失败，也不继续下一轮。
   * @param {object} ps
   */
  retreatNow(ps) {
    if (this.phase !== PHASE.TRAIT_DRAFT) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    // 以「这一轮的 Boss 已清」作为通过轮次（trait.round 是词条归属的回合）
    const passed = Math.max(0, Math.min(this.round, Number(this.trait && this.trait.round) || this.round));
    this.finish({ victory: true, reason: 'retreat', roundsPassed: passed });
    return OK;
  }

  /**
   * g.traitChoice { idx }: 当前玩家选一张。
   * 记词条 + 记下一轮要出的怪 + 记特化，然后推进到下一个玩家（单人就结束）。
   */
  pickTrait(ps, idx) {
    if (this.phase !== PHASE.TRAIT_DRAFT) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const t = this.trait;
    if (!t) return fail(ERR.WRONG_PHASE);
    if (this.traitTurn() !== ps.playerId) return fail(ERR.BAD_TARGET, 'not your turn');
    if (!Number.isInteger(idx) || idx < 0 || idx >= t.cards.length) return fail(ERR.BAD_TARGET);
    const card = t.cards[idx];

    // ① 词条：整局累计（同一 id 叠层，flags 相乘 / 结算值相加）
    this.traitMods = this.traitMods || [];
    this.traitMods.push({ id: card.traitId, name: card.traitName, polarity: t.polarity, round: this.round });

    // ② 选中的怪：下一轮出场，不结算悬赏金
    this.traitSpawn = this.traitSpawn || [];
    this.traitSpawn.push({ enemyKey: card.mob, name: card.name, round: this.round + 1, special: card.special || null });

    t.picks[ps.playerId] = idx;
    t.idx++;
    if (t.idx >= t.order.length) this.finishTraitDraft();
    else this.markPublic();
    return OK;
  }

  finishTraitDraft() {
    if (this.phase !== PHASE.TRAIT_DRAFT) return;
    this.traitDraftCount = (this.traitDraftCount || 0) + 1;
    this.trait = null;
    this.enterPrep();
  }

  /**
   * 本回合要出场的「词条抉择」怪：每条都是普通 spawn，**不带 bounty 字段**（所以不结算悬赏金）。
   * 时间与路线取这一波的中段，和普通怪混在一起出场。
   * @param {number} round
   */
  traitSpawnFor(round) {
    const list = (this.traitSpawn || []).filter((x) => x.round === round);
    if (!list.length || !this.wave) return [];
    const wave = this.wave;
    const spawns = Array.isArray(wave.spawns) ? wave.spawns : [];
    const mid = spawns.length ? Number(spawns[Math.floor(spawns.length / 2)].time) || 4 : 4;
    return list.map((x, i) => ({
      time: mid + i * 2.5,
      enemyKey: x.enemyKey,
      routeIndex: i % Math.max(1, (wave.routes || []).length),
      count: 1,
      interval: 0,
      mods: {},
      preview: { fly: false, elite: false, boss: true },
      _traitChosen: true,
    }));
  }

  /**
   * 特化怪的 enemyOverrides：把 SPECIAL_STATS 换成 spawns.js 认识的 stats 形状。
   * 只包含本局真的抽到过的特化，且只影响那一只怪。
   * @returns {Record<string, { stats: object }>}
   */
  specialOverrides() {
    const out = {};
    const picked = new Set((this.traitSpawn || []).filter((x) => x.special).map((x) => x.special));
    for (const id of picked) {
      const st = SPECIAL_STATS[id];
      const sp = SPECIALS[id];
      if (!st || !sp) continue;
      const rec = this.gd.enemy(sp.mob) || {};
      const base = rec.stats || rec;   // data/enemies.json 把属性放在 stats 里
      const stats = {};
      if (st.hpMul) stats.maxHp = Math.max(1, Math.round((base.maxHp || 1000) * st.hpMul));
      if (st.atkMul) stats.atk = Math.round((base.atk || 100) * st.atkMul);
      if (st.defMul) stats.def = Math.round((base.def || 0) * st.defMul);
      if (st.resAdd) stats.res = Math.max(0, (base.res || 0) + st.resAdd);
      if (st.aspdAdd) stats.aspd = (base.aspd || 100) + st.aspdAdd;
      if (Object.keys(stats).length) out[sp.mob] = { stats };
    }
    return out;
  }

  /** 本局已累计的词条 flag（每场战斗 newBattle 时合并进 opts.flags） */
  traitFlagBundle() {
    const out = {};
    for (const t of this.traitMods || []) {
      const f = traitFlags(t.id);
      for (const [k, v] of Object.entries(f)) {
        if (k.endsWith('Mul')) out[k] = (out[k] ?? 1) * v;
        else out[k] = (out[k] ?? 0) + v;
      }
    }
    return out;
  }

  /** 本局已累计的每回合行为（资金 / 完美作战 / 层数 / 装备） */
  traitSettleBundle() {
    const out = { funds: 0, lpOnPerfect: 0, lpOnNotPerfect: 0, layerBonus: 0, giveItems: [], stripLayers: null, addElite: 0 };
    for (const t of this.traitMods || []) {
      const s = TRAIT_SETTLE[t.id];
      if (!s) continue;
      if (s.funds) out.funds += s.funds;
      if (s.lpOnPerfect) out.lpOnPerfect += s.lpOnPerfect;
      if (s.lpOnNotPerfect) out.lpOnNotPerfect += s.lpOnNotPerfect;
      if (s.layerBonus) out.layerBonus += s.layerBonus;
      if (s.giveItem) out.giveItems.push(s.giveItem);
      if (s.addElite) out.addElite += s.addElite;
      if (s.stripLayers) out.stripLayers = { ...s.stripLayers };
    }
    return out;
  }
}
