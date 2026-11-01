// server/match/player/economy.js — PlayerState methods: the economy — funds, spending (onSpend), prep-side bond layer
// gains (clamped by layerGainRoom), the shop (onPrice prices, copy-weighted rolls from the shared pool plus the player's
// own 自选 stock — player/diy.js —, freeze) and its intents: g.buy, g.refresh, g.freeze, g.levelUp, g.sell.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { freeSlot } from '../board.js';
import { computeBonds } from '../bondsMeta.js';
import { OK, fail } from './common.js';

export class PlayerEconomy {
  addFunds(n, { reason = '' } = {}) {
    if (!Number.isFinite(n) || n === 0) return 0;
    const v = Math.trunc(n);
    const before = this.funds;
    this.funds = Math.max(0, this.funds + v);
    if (v > 0) this.stats.fundsGained += v;
    this.dirty();
    return this.funds - before;
  }

  spend(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    if (v > this.funds) return false;
    this.funds -= v;
    this.stats.gold += v;
    this.round.spent += v;
    this.dirty();
    return true;
  }

  /** onSpend, dispatched once a payment's action is complete (buy / refresh / levelUp / reward / effect). */
  _afterSpend(amount, reason) {
    if (!(amount > 0)) return;
    this.m.dispatch(this, 'onSpend', { amount, reason, total: this.stats.gold });
  }

  /**
   * Bond layer gain (prep-side). `requireActive` = "使已激活的【X】层数+N". Returns layers added: at most the room left
   * under the bond's cap — BOND_LAYER_CAP (999, shared/constants.js) unless the mode configures its own (`gd.bondLayerCap`,
   * 炸惊模拟 规则1: 9999) — a gain at the cap adds 0 and dispatches nothing.
   */
  addLayers(bondId, n, { requireActive = false, reason = '' } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n) || n <= 0) return 0;
    if (requireActive && !(this.bonds[bondId] && this.bonds[bondId].active)) return 0;
    const before = this.layers[bondId] || 0;
    // 炸惊模拟 规则1: the mode's own per-bond cap (null in every other mode, where `layerGainRoom` keeps the official 999)
    const cap = this.gd.bondLayerCap;
    // 无尽湮灭: 盟约叠层无层限制 — no cap, the gain is taken whole (annihilation only; every official mode keeps the cap)
    const add = this.gd && this.gd.annihilation && this.gd.unlimitedLayers ? Math.floor(n)
      : cap ? Math.max(0, Math.min(Math.floor(n), cap - before)) : layerGainRoom(before, Math.floor(n));
    if (add <= 0) return 0;
    this.layers[bondId] = before + add;
    this.recompute();
    // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
    }
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
    return add;
  }

  /** Effective price of a shop slot after onPrice modifiers (never negative). */
  priceOf(slot) {
    if (!slot) return 0;
    const ev = { slot, kind: slot.kind, id: slot.id, price: slot.basePrice };
    this.m.dispatch(this, 'onPrice', ev, { quiet: true });
    const p = Number(ev.price);
    return Number.isFinite(p) ? Math.max(0, Math.round(p)) : slot.basePrice;
  }

  _rollChessSlot() {
    // the slotted 自选 pieces join the draw once the 调度中心 reaches their slot's level (player/diy.js diyRollEntries)
    // 炸惊模拟 · 卡池预选: this player's OWN bans remove a chess from THEIR draw once every one of its bonds is banned (the
    // same rule the official `drawDisabledBonds` applies at match level). No bans ⇒ the options object is byte-identical to
    // the ordinary roll, so every other mode and every player who never opened the panel draws exactly what they drew.
    const ban = this.chessBanFilter();
    // 队内共用 / 队间独立 (TWELVE_PLAYER_MODE §2): a room above MAX_SEATS draws from this player's TEAM pool
    // (Match.poolFor); a 4-seat room gets `this.m.pool` back, so the roll is byte-identical.
    const id = this.m.poolFor(this).roll(this.m.rngShop, {
      maxTier: this.shop.level,
      extra: this.diyRollEntries(),
      ...(ban ? { filter: ban } : null),
    });
    return id ? { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false } : null;
  }

  _rollItemSlot() {
    // startRound rolls the shop before recompute, so the cached this.bonds can be one round behind.
    // bondBias therefore calls computeBonds at the roll (no rng). The official rule passes null and
    // does not call it, so the shop's rng stays today's two draws.
    let bias = null;
    // GameData.rulesOf: official default → mode.annRules → room annMods → plugin content rules (strongest)
    if (this.gd.rulesOf('shopBias') === 'bondBias') {
      const bonds = computeBonds(this.gd, this);
      bias = new Set();
      for (const [id, st] of Object.entries(bonds)) if (st && st.active) bias.add(id);
    }
    const id = this.m.pool.rollItem(this.m.rngShop, this.shop.level, this.m.itemPool, bias);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * 炸惊模拟 · 卡池预选: the set of bond ids this player banned from their own pool, or null when they banned nothing
   * (every other mode included, where `this.bans` is null).
   * @returns {Set<string> | null}
   */
  banSet() {
    const zj = this.bans && this.bans.zhajing;
    if (!zj) return null;
    const set = new Set([...(zj.core || []), ...(zj.addon || [])]);
    return set.size ? set : null;
  }

  /**
   * Does this player's 卡池预选 remove chess `id` from their own draw? The rule is the official one (`pool.js
   * drawDisabledBonds`): a chess whose bonds are ALL banned never appears; a chess with any live bond still does.
   * @param {string} id
   * @returns {boolean}
   */
  chessBannedByPreselect(id) {
    const set = this.banSet();
    if (!set) return false;
    const c = this.gd.chess(id);
    const bonds = c && Array.isArray(c.bonds) ? c.bonds : [];
    return bonds.length > 0 && bonds.every((b) => set.has(b));
  }

  /**
   * 炸惊模拟 · 卡池预选: the same rule as a `filter` for a shared-pool chess roll (`{ filter }` of pool.roll / a
   * choices.json pool), or **null** when this player banned nothing — every caller then passes no filter at all, so an
   * unbanned player's draw (and every other mode's) stays byte-identical to before the panel existed.
   * Used by every chess draw of this player: the shop's chess slots (economy.js _rollChessSlot), the 特殊刷新
   * (acquire.js pushRewardOffer), the 按盟约 special refresh (choices.js) and the 奖池 / ctx.rollChess
   * (spDraft.js rollPool, effectsMeta.js). The 装备 slot is NOT filtered: bans name 盟约, and the item pool is another
   * dimension.
   * @returns {((id: string) => boolean) | null}
   */
  chessBanFilter() {
    const set = this.banSet();
    if (!set) return null;
    const gd = this.gd;
    return (id) => {
      const c = gd.chess(id);
      const bonds = c && Array.isArray(c.bonds) ? c.bonds : [];
      return !(bonds.length > 0 && bonds.every((b) => set.has(b)));
    };
  }

  /**
   * Reroll the shop. keepFrozen → frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
    if (this._consumeTestShop()) return;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    const oldChess = old.slice(0, layout.chess);
    const oldItems = old.slice(layout.chess);
    const keep = (s, kind) => (keepFrozen && s && s.kind === kind && !s.sold && s.frozen ? { ...s } : null);
    // frozen slots keep their position; sold / empty / unfrozen positions are rerolled
    const slots = [];
    for (let i = 0; i < nChess; i++) slots.push(keep(oldChess[i], 'chess') ?? this._rollChessSlot());
    for (let i = 0; i < nItem; i++) slots.push(keep(oldItems[i], 'item') ?? this._rollItemSlot());
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
  }

  /**
   * A test match's queued next shop (g.test shop) replaces this roll once and draws no rng. Queued layouts are validated by the command; level upgrades stay blocked until the roll consumes the queue.
   * The defensive fallback handles only corrupted internal state.
   * [ASSUMED] The queue replaces frozen slots too. Absent on a normal match, so this returns false immediately.
   * @returns {boolean} true when the queue was applied
   */
  _consumeTestShop() {
    const queued = this._testShopNext;
    if (this.m.test !== true || !queued) return false;
    this._testShopNext = null;
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const ok = Array.isArray(queued) && queued.length === nChess + nItem && queued.every((s, i) => {
      const kind = i < nChess ? 'chess' : 'item';
      return !!s && s.kind === kind && (kind === 'chess' ? !!this.gd.chess(s.id) : !!this.gd.item(s.id));
    });
    if (!ok) return false;
    const slots = queued.map((s) => ({
      kind: s.kind, id: s.id,
      basePrice: s.kind === 'chess' ? this.gd.chessPrice(s.id) : this.gd.itemPrice(s.id),
      frozen: false, sold: false,
    }));
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
    return true;
  }

  /**
   * The 调度中心's upgrade opens the new level's extra slots at once — EMPTY: no card is drawn into them (a `null` slot).
   * The next roll (a manual refresh or the round start) fills them with the other unfrozen slots; the cards already shown
   * stay where they are (chess slots keep their index, the item slot stays after them). Official: the footage of a 1→2
   * upgrade (bilibili BV1AXwuzdEys 1:39, GitHub #332 / PR #333 by @2321Robin) shows the new slot appear and stay empty, and
   * the texts only name the slots — the tutorial's 休整期 page 「升级后将出现更多的商品栏位」, PRTS 帮助 「增加刷新栏位」 —,
   * never a card that comes with them. 0.2.0 drew a card into each new slot instead (item 19 of the community report of
   * 2026-10-06, 「升级商店获得新的商店位时用新卡补上，而不是空着」, one uncorroborated remark; its follow-on, that the new card
   * follows the freeze toggle, was [ASSUMED]); until then the extra slots waited for the next roll as well.
   */
  _openLevelSlots() {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    if (nChess <= layout.chess && nItem <= layout.item) return;
    const chess = old.slice(0, layout.chess);
    const items = old.slice(layout.chess);
    while (chess.length < nChess) chess.push(null); // loop-cap: shopSlots chess max 8
    while (items.length < nItem) items.push(null);
    this.shop.slots = [...chess, ...items];
    this.shop.layout = { chess: chess.length, item: items.length };
  }

  /** Combat start: unfrozen slots are emptied (research 01 A1). */
  clearUnfrozenShop() {
    this.shop.slots = this.shop.slots.map((s) => (s && s.frozen && !s.sold ? s : null));
    this.dirty();
  }

  /**
   * g.buy {slot}. A full regular hand refuses every purchase, also one whose copy would complete a merge at once (PRTS
   * 卫戍协议/帮助 §手牌区 "当常规手牌区全满无空位时，玩家将无法执行使手牌溢出的操作" — "例如招募/购入等通常情况下会增加手牌的
   * 操作"; BWIKI 盟约 "当整备区达到上限后将无法进行涉及到整备区的操作（购买、撤回等）"; GitHub #82: the reporter's first-hand
   * check in the official game, "哪怕是已经有了两个相同干员情况"). Until 0.1.3 such a purchase was let through.
   */
  buy(slotIdx) {
    const g = this._gate(); if (g) return g;
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= this.shop.slots.length) return fail(ERR.BAD_TARGET);
    const slot = this.shop.slots[slotIdx];
    if (!slot) return fail(ERR.BAD_TARGET);
    if (slot.sold) return fail(ERR.SOLD_OUT);
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    const handFull = freeSlot(this.hand) < 0;
    let piece;
    if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      // a DIY slot sells only as this player's own 自选 piece (a slotted slot's record carries `diyFor`)
      if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
      // Already displayed operators stay purchasable after stock runs out (#498; 路标月报#2,
      // BV1eLXXBqEgF 2:50–2:57: nine owned + four shop offers => thirteen owned).
      // acquireChess records every copy, including the deficit; future rolls still exclude empty stock.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireChess(slot.id, { source: 'buy' });
    } else {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      // Already displayed equipment stays purchasable after stock runs out (#624, maintainer 2026-10-14).
      // acquireItem records the debt. Future rolls still exclude empty stock. SOLD_OUT is only this slot, already sold.
      if (handFull) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireItem(slot.id, { source: 'buy', displayed: true });
    }
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  refresh() {
    const g = this._gate(); if (g) return g;
    const free = this.shop.freeRefreshes > 0;
    const price = free ? 0 : this.gd.refreshPrice;
    if (!free && this.funds < price) return fail(ERR.NO_FUNDS);
    if (free) this.shop.freeRefreshes--;
    else this.spend(price);
    // A manual refresh cancels the freeze: the new cards are not frozen (official, the owner's play of 2026-10-14;
    // GitHub #584, DESIGN §32.14.7). A refresh that fails (funds, phase) returns above and leaves the freeze on.
    this.shop.frozen = false;
    this.rollShop({ keepFrozen: false });
    this.stats.refreshes++;
    this.round.refreshes++;
    this.m.dispatch(this, 'onRefresh', { slots: this.shop.slots, free, price });
    this._afterSpend(price, 'refresh');
    this.dirty();
    return OK;
  }

  freeze() {
    const g = this._gate(); if (g) return g;
    this.shop.frozen = !this.shop.frozen;
    for (const s of this.shop.slots) if (s && !s.sold) s.frozen = this.shop.frozen;
    this.dirty();
    return OK;
  }

  levelUp() {
    if (this.m.test === true && this._testShopNext) return fail(ERR.WRONG_PHASE);
    const g = this._gate(); if (g) return g;
    if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
    const price = Math.max(0, this.shop.upgradePrice);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    this.spend(price);
    this.shop.level++;
    this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
    this._openLevelSlots();
    this.m.tickerFor('SHOP_LEVEL', [this.name, String(this.shop.level)], { playerId: this.playerId, param: String(this.shop.level) });
    this.m.dispatch(this, 'onLevelUp', { level: this.shop.level, price });
    this._afterSpend(price, 'levelUp');
    this.dirty();
    return OK;
  }

  sell(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc) return fail(ERR.BAD_TARGET);
    if (loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, loc.piece.kind === 'item' ? 'items cannot be sold' : 'tokens cannot be sold');
    const piece = loc.piece;
    // Returned equipment can always wait in the overflow queue, even when all fifteen visible slots are occupied.
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) this.stow(it, { allowTemp: true });
    piece.items = [];
    this.returnCopies(piece);
    const ev = { piece, gain: this.gd.sellPrice(piece.id) };
    this.m.dispatch(this, 'onSold', ev);
    const gain = Number.isFinite(ev.gain) ? Math.max(0, Math.trunc(ev.gain)) : 1;
    this.addFunds(gain, { reason: 'sell' });
    this.stats.sells++;
    this.round.sells++;
    this.checkItemMerges();
    this.recompute();
    return OK;
  }
}
