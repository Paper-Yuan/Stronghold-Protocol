// server/match/player/round.js — PlayerState methods: the round lifecycle the match calls — startRound (income, pending
// coins, the shop, summon stacks topped up), endPrep, eliminate (every copy back to the pool), recompute (legality,
// out-of-range summons, temp pieces into free hand slots, bonds; onActiveBonds when the set of active bonds changed),
// the bond views — and battleInput (the player's PlayerBattleInput: board units with their loadout, their 补位 mark or
// their 自选 pick, carried 联防 state, the reached layers).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { boardOrder, pieceDir } from '../board.js';
import { computeBonds, bondSnapshot, activatedLayers, bondsWithGains } from '../bondsMeta.js';
import { relicModsFor, relicRoundStart } from '../relics.js';
import { negativeBattleList, overlimitBattleList, overlimitCarriedFunds, overlimitKeepsFunds } from '../relicsOverlimit.js';
import { msg } from '../../../shared/i18n.js';

export class PlayerRound {
  startRound(r) {
    // 湮灭模拟 · 藏品: per-round relic upkeep (round LP, counters, 似曾相识棋盒) — annihilation only
    if (this.gd.annihilation) relicRoundStart(this.m, this);
    this.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 };
    this.pendingLayerGains = null; // settled (or lapsed) at the last SETTLE
    if (r > 1) this.shop.upgradePrice = Math.max(0, this.shop.upgradePrice - 1);
    // onIncome handlers may rewrite ev.income / ev.pending (e.g. 老鲤 withholds R1–R2 income until R3)
    const ev = { round: r, income: this.gd.income(r), pending: this.pendingFunds };
    // 炸惊模拟 惊变「惊天魔盗团」(ejibian_jingtianmodaotuan): 「本回合的收入不再计算利息」— the leftover funds of the last
    // round are cleared BEFORE the income is granted, so this round pays the base income only. Gated on the drawn enemy
    // cards (`m.enemyJibianCards`, empty in every mode without 敌方惊变), so no other mode ever zeroes funds.
    const ejCards = this.gd.zhajing && Array.isArray(this.m && this.m.enemyJibianCards) ? this.m.enemyJibianCards : null;
    if (ejCards && ejCards.includes('ejibian_jingtianmodaotuan') && this.funds > 0) this.funds = 0;
    this.pendingFunds = 0;
    this.m.dispatch(this, 'onIncome', ev);
    const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
    this.addFunds(nonNeg(ev.income) + nonNeg(ev.pending), { reason: 'income' });
    // 超限词条（业主 2026-10-18）：富足 / 贫乏 的每回合资金，以及集群给的装备。
    // 普通模式 this.m.traitSettleBundle 不存在 → 整段跳过，行为完全不变。
    const ts = this.m && typeof this.m.traitSettleBundle === 'function' ? this.m.traitSettleBundle() : null;
    // 全 0 / 空数组 = 没有词条（普通模式永远如此），整段跳过
    const tsActive = ts && (ts.funds || (ts.giveItems && ts.giveItems.length));
    if (tsActive) {
      if (ts.funds) this.addFunds(ts.funds > 0 ? ts.funds : 0, { reason: 'trait' });
      if (ts.funds < 0) this.funds = Math.max(0, this.funds + ts.funds);
      for (const itemId of ts.giveItems || []) {
        try { this.acquireItem(itemId, { source: 'trait' }); } catch { /* the pool refused: nothing to do */ }
      }
    }
    // temp is NOT wiped here: the last prep's deadline resolved what the player could act on (endPrep); what overflowed
    // after it (battle-result grants, SETTLE merges, returned equipment) is shown and usable in this prep (tempDue).
    // Queued reward offers (a promotion's pick, a strategy's special refresh, an item offer) are kept until picked —
    // they do not lapse at the prep deadline (PRTS 卫戍协议/帮助: the temporary shop leaves its state when one is bought;
    // community report relayed by the maintainer on 2026-10-15) — so an offer left with 稍后 is shown again in this prep
    this.ready = false;
    // summon stacks removed from temp at the last prep deadline come back (PRTS 卫戍协议/帮助 §手牌区); full hand ⇒ temp
    for (const p of [...this.board.values()]) if (p.kind === 'chess') this.grantTokensFor(p);
    this.rollShop({ keepFrozen: true });
    this.shop.frozen = false;
    for (const s of this.shop.slots) if (s) s.frozen = false;
    this.recompute();
    // 炸惊模拟 惊变「死亡回归」(jibian_siwanghuigui)：**只留一份**快照（回合开始、商店已刷新之后）。
    // 持有该卡才抓（其它模式 / 没抽到的局：`null`，零开销）。存的东西刚好是回滚需要的最小集合：
    //   round  —— 回到哪个回合的整备阶段
    //   shop   —— 三个槽位的 kind/id/price（牌面还原）
    //   uids   —— 此刻场上 / 手里 / 临时区的棋子 uid 集合
    // 「本整备阶段获得的棋子」= 当前 uid **不在**这个集合里的那些（lead 2026-10-28 的简化口径，替代包内
    // `gainedUids` + 第二份 endPrep 快照）。`funds` **刻意不存**：owner 口径是「退回的干员直接回卡池、钱不退」。
    this.deathReturnSnapshot = this.gd.zhajing && typeof this.jibianHas === 'function' && this.jibianHas('jibian_siwanghuigui')
      ? {
        round: r,
        shop: this.shop.slots.map((s) => (s ? { kind: s.kind, id: s.id, price: s.price } : null)),
        uids: new Set([...this.allChess()].map((p) => p && p.uid).filter((u) => Number.isInteger(u))),
      }
      : null;
  }

  /**
   * 炸惊模拟 惊变「死亡回归」—— 被淘汰的那一刻发动：**回到本回合的整备阶段**（不新增 PHASE）。
   * 一局一次（计数器 `jibian:siwanghuigui:used`）；`funds` 不还原；用过的卡保留 ref 但改名改描述。
   * 回合号回退只是**登记意图**（`m._jibianRewindRound`），由 Match 在 settle 推进时消费 —— 见 settle.js 的 afterSettle。
   * @param {{ auto?: boolean }} [o] `auto: true` = 生命归零被动触发（false = 商店栏按钮主动发动）
   * @returns {boolean} 真的发动了吗（true ⇒ 调用方不要淘汰这名玩家）
   */
  deathReturnTrigger({ auto = false } = {}) {
    const key = 'jibian:siwanghuigui:used';
    if (!this.gd.zhajing) return false;                          // 模式门：官方四档 / 湮灭房整条链 no-op
    if (typeof this.jibianHas !== 'function' || !this.jibianHas('jibian_siwanghuigui')) return false;
    if (this.counters && this.counters[key] > 0) return false;   // 一局一次
    const snap = this.deathReturnSnapshot;
    if (!snap) return false;
    if (this.counters) this.counters[key] = 1;
    const round = Number.isInteger(snap.round) ? snap.round : this.m.round;
    const lpAtPress = Math.max(0, Math.trunc(Number(this.lp) || 0));
    this.alive = true;
    this.ready = false;
    this.lp = Math.max(1, lpAtPress) + 3;
    try { this.restoreDeathReturnSnapshot(snap); } catch (e) { this.m.reportError('deathReturn restore', e); }
    this.invalidateDeathReturnCard();
    this.dirty?.();
    // 回合号回退：settle 推进时消费（不在淘汰判定里直接 startRound，避免与结算循环打架）
    this.m._jibianRewindRound = round;
    // 回退到的那一轮如果是**惊变阶段**回合：只让发动者再选一次（其他人直接进整备，不新增 PHASE）。
    // 读与清空都在 spDraft.enterSpDraft（engine-core 已落）。这里**只在真的是惊变回合时**写标记 ——
    // 否则标记会留到下一个 SP 回合，把别人的草稿也收窄成一个人。
    try {
      const spRounds = typeof this.gd.spRounds === 'function' ? this.gd.spRounds() : null;
      const isJibianRound = Array.isArray(spRounds) && spRounds.includes(round)
        && typeof this.gd.spPhaseKind === 'function' && this.gd.spPhaseKind(round) === 'jibian';
      if (isJibianRound) this.m._jibianSoloPick = this.playerId;
    } catch { /* 没有 SP 信息：不写标记（回退后照常全员草稿） */ }
    void auto;
    return true;
  }

  /**
   * 回滚本整备阶段的动作：本整备获得的棋子（uid 不在快照里）退回卡池（**不退钱**）、清挂账、恢复商店三槽。
   * @param {{ round: number, shop: any[], uids: Set<number> }} snap
   */
  restoreDeathReturnSnapshot(snap) {
    const keep = snap && snap.uids instanceof Set ? snap.uids : new Set((snap && snap.uids) || []);
    const gained = (p) => !!p && p.kind === 'chess' && !keep.has(p.uid);
    for (const [uid, p] of [...this.board]) {
      if (!gained(p)) continue;
      try { this.removeTokensOf(uid); } catch { /* 召唤物清不掉不影响回滚 */ }
      try { this.returnCopies(p); } catch { /* 卡池拒绝时不阻断 */ }
      this.board.delete(uid);
    }
    for (let i = 0; i < this.hand.length; i++) {
      const p = this.hand[i];
      if (!gained(p)) continue;
      try { this.returnCopies(p); } catch { /* ignore */ }
      this.hand[i] = null;
    }
    for (let i = 0; i < this.temp.length; i++) {
      const p = this.temp[i];
      if (!gained(p)) continue;
      try { this.returnCopies(p); } catch { /* ignore */ }
      this.temp[i] = null;
    }
    this.pendingFunds = 0;
    if (snap && Array.isArray(snap.shop)) {
      this.shop.slots = snap.shop.map((s) => (s ? { kind: s.kind, id: s.id, price: s.price, frozen: false, sold: false } : null));
    }
    this.ready = false;
    this.recompute();
  }

  /** 用过的「死亡回归」保留 ref 但失效（改文案；两条 i18n 字面量由 lead 批进四包）。 */
  invalidateDeathReturnCard() {
    const e = (this.effects || []).find((x) => x && x.key === 'jibian:jibian_siwanghuigui');
    if (!e) return;
    e.name = msg('死亡回归（已消耗）');
    e.desc = msg('它不再保护你');
    e.iconKind = 'choice';
    e.iconId = null;
  }

  /**
   * Prep deadline (Match.endPrep, after the <休整期结束时> onPrepEnd effects): the temp pieces due at this prep are
   * resolved; what overflowed after Ready or during onPrepEnd stays for the next prep, which `prepsEnded` now names.
   */
  endPrep() {
    this.resolveTemp();
    this.prepsEnded++;
    for (const uid of [...this._tempDue.keys()]) if (!this.temp.some((p) => p && p.uid === uid)) this._tempDue.delete(uid);
    // (queued reward offers stay: they last until picked, startRound)
    this.clearUnfrozenShop();
    // 超限词条 LC-EX1「凤·皇」（业主 2026-10-31）：经费跨回合保留，且保留量 = 上回合留下的 150%。只在超限局、
    // 且这条生效时走这条分支；其它模式 / 没选它时逐字节等于改动前（清零，`leftoverKeptBands` 的坎诺特除外）。
    if (!this.gd.leftoverKeptBands.includes(this.bandId)) {
      if (overlimitKeepsFunds(this.m)) this.funds = overlimitCarriedFunds(this.funds);
      else this.funds = 0;
    }
    this.ready = true;
    this.dirty();
  }

  // `effects` are kept: a 信标 gift still pending is delivered to the teammate at the next round start (builtin_gift is
  // flagged afterElimination — GitHub #86); nothing else of an eliminated player is dispatched.
  eliminate(round) {
    this.alive = false;
    this.ready = false;
    this.eliminatedRound = round;
    const all = [];
    for (const p of this.board.values()) all.push(p);
    for (const p of this.hand) if (p) all.push(p);
    for (const p of this.temp) if (p) all.push(p);
    for (const p of all) {
      this.returnCopies(p);
      if (p.kind === 'item') this.releaseItemStock(p);
      for (const it of p.items || []) this.releaseItemStock(it);
    }
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
    this.personalChoice = null;
    this.shop.slots = [];
    this.funds = 0;
    this.pendingFunds = 0;
    this.recompute();
  }

  recompute() {
    this.deployMap(); // a change of the deploy field (a boss round's prep) marks the legality stale
    if (this._legalityStale) this._evictIllegal();
    this._liftOutOfRange();
    // a free regular hand slot pulls a temp piece in (PRTS 卫戍协议/帮助 §手牌区 "常规手牌区出现空位时自动移入")
    this._fillHandFromTemp();
    // the states the last recompute stored: the change since then is reported once (_reportActiveBonds)
    const before = this.bonds;
    this.bonds = computeBonds(this.gd, this);
    this.dirty();
    this._reportActiveBonds(before, this.bonds);
  }

  /**
   * onActiveBonds (docs/META.md §2.2): the set of active bonds differs between `before` and `after` — every path that
   * changes what the bonds count ends in recompute (a board edit in prep: place, move, swap, withdraw; buys, sells,
   * merges, transformations, temp moves, equipment, effects, an eviction). Bonds that light up pay their owed layer
   * milestones at once (维多利亚's hammers, 远见 / 奇迹's funds — the maintainer's report of 2026-10-15). Each recompute
   * reports the difference to the previous computed state, so a handler's own recompute (a hammer's onGain) reports
   * only what changed after it, and nothing twice. Never for an eliminated player (eliminate clears the board) nor a
   * detached copy (preview.js previewPlayer).
   */
  _reportActiveBonds(before, after) {
    if (!this.alive || typeof this.m.dispatch !== 'function') return;
    if (this.m.players && this.m.players.get(this.playerId) !== this) return;
    const activated = [];
    const deactivated = [];
    for (const id of this.gd.bondIds) {
      const was = !!(before && before[id] && before[id].active);
      const is = !!(after && after[id] && after[id].active);
      if (is && !was) activated.push(id);
      else if (was && !is) deactivated.push(id);
    }
    if (activated.length || deactivated.length) this.m.dispatch(this, 'onActiveBonds', { activated, deactivated });
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains). The 联防 field fights with them too
   * (battleInput `reached`); no other rule reads them.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains, this.gd.bondLayerCap); }

  /**
   * `reached`: the bonds carry the layers this round's own combat reached (bondsView: the pending in-battle gains, capped
   * like settle()) — the 联防 field (unite.js; PRTS 卫戍协议/帮助 §联防阶段 "将以其阵地当前的状态", [ASSUMED] the current
   * state includes those layers, as the strip shows them). The gains stay pending: settle() adds them once.
   */
  battleInput({ side = 'L', colOffset = 0, carry = null, reached = false } = {}) {
    // a terrain change not yet followed by a recompute (a content hook at the prep end) never fields an illegal board
    this.deployMap();
    if (this._legalityStale) this.recompute();
    const units = [];
    for (const { r, c, piece } of boardOrder(this.board)) {
      if (piece.kind === 'chess') {
        const u = { uid: piece.uid, kind: 'chess', chessId: piece.id, row: r, col: c, dir: pieceDir(piece), items: (piece.items || []).map((i) => i.id) };
        const rec = this.gd.chess(piece.id);
        const baseId = (rec && rec.baseId) || piece.id;
        const charId = rec && rec.charId;
        const pick = this.diyPickOf(piece.id);
        const skin = this.skins[baseId] || this.skins[piece.id] || (charId ? this.skins[charId] : null) || (pick ? (this.skins[pick.charId] || this.skins[baseId]) : null) || null;
        if (skin) u.skin = skin;
        if (pick) {
          // 0.2.0 自选编队: a slotted DIY slot fights as its pick (sim getChess(id, { diy }): the operator's body, the pick's
          // skill and module — no loadout fields, docs/SIM.md §12)
          u.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
        } else if (this.fieldsStandIn(piece.id)) {
          // 0.2.0 补位: a chess this player does not own fights as its stand-in (sim getChess(id, { standIn: true }): the
          // backup skill / module — no loadout fields, docs/SIM.md §12)
          u.standIn = true;
        } else {
          // DESIGN §16: the equipped skill / module (elite only) from the loadout (defaults when absent)
          const lo = this.loadoutFor(this.gd.chess(piece.id));
          u.skillIndex = lo.skillIndex;
          u.moduleId = lo.moduleId;
        }
        // 0.2.2: the potential / 练度 of an operator the player owns (the chess as itself, an owned 自选 pick — the player's
        // 干员调配 settings, 潜能 6 / 精英2 Lv.60 by default and for bots; never a stand-in's nor a prototype pick's)
        const cv = u.standIn ? null : this.cultivationFor(this.gd.chess(piece.id));
        if (cv) { u.potential = cv.potential; u.cultivate = cv.cultivate; }
        // 皮肤 (docs/SKINS.md): the appearance this player wears for the operator the piece fields, carried into the sim
        // so it reaches Unit.skin and the snapshot every client draws from. A 自选 slot's own record has no charId (its
        // appearance is the PICK's operator), so the pick's operator decides the key first.
        const skinId = this.skinFor(this.gd.chess(piece.id), pick ? pick.charId : null);
        if (skinId) u.skin = skinId;
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid);
        units.push(u);
      } else if (piece.kind === 'token') {
        const u = { uid: piece.uid, kind: 'token', tokenId: piece.id, row: r, col: c, dir: pieceDir(piece), ownerUid: piece.ownerUid };
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid); // 联防: { sp } (unite.js)
        units.push(u);
      }
    }
    // 湮灭模拟 · 藏品: the mode's battle modifiers (null for every other mode, so their battle input is unchanged)
    const relicMods = this.gd.annihilation ? relicModsFor(this) : null;
    // 超限模拟 · 词条（业主 2026-10-31）：本局生效的词条 id + 选走它的回合。**只在超限局**下发；其它模式连这个键都没有
    // （`overlimitBattleList` 自己也按 `gd.overlimit` 收口）。词条是全队共享的，所以每名玩家拿到同一份。
    const overlimitRelics = overlimitBattleList(this.m);
    // 超限模拟 · 负面词条（业主 2026-10-31 第二批）：另开一个键 `relicsOverlimitNegative: [{ id, at, tier }]`，
    // 与饰品那一份**互不混**（「每拥有一件饰品」这类条文只数饰品，见 relicsOverlimit.js negativeBattleList）。
    const overlimitNegatives = negativeBattleList(this.m);
    return {
      playerId: this.playerId,
      seat: this.seat,
      side,
      colOffset,
      units,
      bonds: bondSnapshot(reached ? this.bondsView() : this.bonds),
      bandId: this.bandId,
      playerEffects: this.effects.filter((e) => e.battle !== false).map((e) => ({
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null, params: e.params ?? null, counter: e.counter ?? null, data: e.data ?? null,
      })),
      // 湮灭模拟 · 藏品: the mode's battle modifiers (null when the player owns none) — the sim reads this in content/relics.js
      ...(relicMods ? { relicMods } : {}),
      // 超限模拟 · 词条: [{ id, at }] — 只在超限局且至少选走一条时出现（content/overlimitRelics.js 读它）
      ...(overlimitRelics.length ? { relicsOverlimit: overlimitRelics } : {}),
      // 超限模拟 · 负面词条: [{ id, at, tier }] — 只在超限局且至少选走一条时出现（content/overlimitNegative.js 读它）
      ...(overlimitNegatives.length ? { relicsOverlimitNegative: overlimitNegatives } : {}),
      deviceOverrides: { ...this.deviceOverrides },
    };
  }
}
