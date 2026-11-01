// server/match/player/acquire.js — PlayerState methods: gains and merges — copy counts, acquireChess (hand, overflow
// temp queue) and the chess merge (3 copies → the elite, on a consumed deployed copy's tile or in the hand;
// the reward offer), promotion, transformation (突变细胞: a destroy, then a gain), item upgrades, reward / item offers,
// acquireItem and the item merges (2 identical → the golden item; deferred merges at the next prep start).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { hasTraitFor } from '../operatorTraits.js';
import { pieceDir, parseDir, mergeTile } from '../board.js';
import { MAX_OFFER_SLOTS } from './common.js';
import { onMerge } from '../botEmotes.js';
import { ERR } from '../../../shared/constants.js';
import { OK, fail } from './common.js';
import { applyForgePick, drawForge, forgeBattleMods, forgeModsEmpty, forgeOptionById, isForgeRarity, FORGE_KILLS_PER } from '../../../shared/forgeData.js';

export class PlayerAcquire {
  /** Normal copies of a base chess currently owned (board/hand/temp). */
  countCopies(baseId) {
    let n = 0;
    for (const loc of this._chessLocations()) {
      const p = loc.piece;
      if (!this.gd.isGolden(p.id) && this.gd.baseIdOf(p.id) === baseId) n++;
    }
    return n;
  }

  /** Would acquiring one more normal copy of `chessId` complete a merge? */
  completesChessMerge(chessId) {
    const rec = this.gd.chess(chessId);
    if (!rec || rec.isGolden) return false;
    const need = this.gd.mergeCount(chessId);
    if (!(need > 1) || !this.gd.goldenIdOf(chessId)) return false;
    return this.countCopies(this.gd.baseIdOf(chessId)) + 1 >= need;
  }

  /**
   * Acquire a chess (buy, reward, effect grant). Takes pool copies (normal 1, elite goldenCopies) when available,
   * merges immediately when it completes a set, otherwise stows it (hand, overflow temp). Fires onGain (for the
   * elite when a merge happened, research 01 §7 "1+1+2"). Returns the owned piece (the elite after a merge) or null.
   * @param {string} chessId
   * @param {{ source?: string, toTemp?: boolean, fromPool?: boolean, silent?: boolean }} [opts]
   */
  acquireChess(chessId, { source = 'grant', toTemp = false, fromPool = true, silent = false } = {}) {
    const rec = this.gd.chess(chessId);
    // a DIY slot is only ever this player's own 自选 piece: a slot it has not filled has no body (甄选干员) to gain
    if (!rec || (rec.isDiy && !rec.diyFor)) return null;
    const base = this.gd.baseIdOf(chessId);
    const need = rec.isGolden ? this.gd.goldenCopies : 1;
    // the shared pool, or this player's stock of a slotted 自选 piece (player/diy.js poolOf)
    const taken = fromPool ? this.poolOf(base).take(base, need, { overdraw: true }) : 0;
    const piece = this.newPiece('chess', chessId, { poolCopies: taken });
    this.round.gainedChess++;
    let owned = piece;
    if (!rec.isGolden && this.completesChessMerge(chessId)) {
      owned = this._mergeChess(base, piece);
      if (!owned) return null;
    } else {
      this.stow(piece, { allowTemp: true, toTemp });
    }
    this.recompute();
    // [ASSUMED] Custom gain fires for the acquired copy, not the elite produced by a merge.
    // Silent setup acquisitions are still acquisitions; official gain behavior stays unchanged.
    if (hasTraitFor(this.gd, rec.charId)) this.m.dispatch(this, 'onTraitGain', { piece, kind: 'chess', source });
    if (!silent) this.m.dispatch(this, 'onGain', { piece: owned, kind: 'chess', source });
    this.recompute();
    return owned;
  }

  /**
   * Merge `need` normal copies of `baseId` (the incoming, not yet stowed piece first, then temp, hand, board) into
   * the elite — PRTS 卫戍协议/帮助 §干员的获得与精锐化: "发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，
   * 则发送至作战区对应位置）" (the user's playtest #6 follow-up confirms it). The tile (`mergeTile`): when a consumed copy
   * stood on the board the elite takes its tile and facing — of several, the one that deploys first (the left board
   * column first, top to bottom within a column — Battle.start's order) [ASSUMED]. The incoming copy is never deployed (a 突变细胞 transformation
   * destroyed its carrier before the gain: that tile is no copy's). It replaces a deployed copy, so the deploy count
   * never grows. Otherwise the elite goes to the hand, overflow temp — outside PREP too (a SETTLE merge's elite waits in
   * temp through the next prep, tempDue). The copies' equipment returns to the hand ("干员晋级后已配发装备会回收至整备区";
   * overflowing into the expandable temp queue) and an identical normal pair among it merges like any gain
   * (checkItemMerges); their summons are removed, and an elite on the board
   * gets its own summon stack (grantTokensFor: its loadout, like any deployment). Returns the elite piece,
   * or null when the recipe is invalid or there are too few normal copies.
   * @param {string} baseId
   * @param {any} incoming the acquired, not yet stowed copy (null: only owned copies)
   */
  _mergeChess(baseId, incoming) {
    const need = this.gd.mergeCount(baseId);
    const goldenId = this.gd.goldenIdOf(baseId);
    if (!(need > 1) || !goldenId) return null;
    const locs = this._chessLocations().filter((l) => !this.gd.isGolden(l.piece.id) && this.gd.baseIdOf(l.piece.id) === baseId);
    const consumed = [];
    if (incoming) consumed.push({ piece: incoming, area: 'new' });
    for (const l of locs) { if (consumed.length >= need) break; consumed.push(l); }
    if (consumed.length < need) return null;
    let copies = 0;
    const items = [];
    for (const l of consumed) {
      copies += l.piece.poolCopies || 0;
      if (l.area !== 'new') this._detach(l);
      this.removeTokensOf(l.piece.uid);
      for (const it of l.piece.items || []) items.push(it);
      l.piece.items = [];
    }
    // a new piece: this round's per-piece counters start at 0, none is carried over from the copies — a newly merged
    // elite 拉普兰德 is a new 拉普兰德 and fires +8 on its own first manual refresh this round (GitHub #169; the owner's
    // decision of 2026-10-06; pieceRoundCount)
    copies += this.poolOf(baseId).take(baseId, Math.max(0, this.gd.goldenCopies - copies), { overdraw: true });
    const elite = this.newPiece('chess', goldenId, { poolCopies: copies });
    // the copies are gone; a refresh dispatch that saw them still runs their 刷新时 特质 (effectsMeta.js _garrisons, #627)
    for (const l of consumed) if (l.area !== 'new') l.piece.mergedInto = elite.uid;
    const deployed = consumed.filter((l) => l.key && !this.board.has(l.key)).map((l) => ({ key: l.key, dir: pieceDir(l.piece) }));
    const toTile = (t) => { elite.dir = parseDir(t.dir) || 'RIGHT'; this.board.set(t.key, elite); return 'board'; };
    const tile = mergeTile(deployed, (r, c) => this._legal(elite, r, c));
    const where = tile ? toTile(tile) : this.stow(elite, { allowTemp: true });
    for (const it of items) this.stow(it, { allowTemp: true });
    // the returned equipment follows the auto-merge rule like any other gain ("已拥有2件同一初始装备时…自动合并")
    this.checkItemMerges();
    // A deployed elite receives its summon stacks after the returned equipment.
    if (where === 'board') this.grantTokensFor(elite);
    this.stats.merges++;
    this.forgeOnElite();   // 炸惊模拟「锻造器」: a merge that makes an operator elite pays one forge (no-op elsewhere)
    this.pushRewardOffer('merge');
    // (named as everyone sees the elite: a chess this player fields as its stand-in by the stand-in's name — 0.2.0 补位,
    // the owner's recall of the official mode, 2026-10-06 [ASSUMED for the ticker])
    const rec = this.gd.chess(goldenId);
    const shown = rec ? this.fieldRecord(rec) || rec : null;
    this.m.tickerFor('GOLDEN_CHAR', [this.name, shown ? shown.name : goldenId], { playerId: this.playerId });
    this.m.dispatch(this, 'onMerge', { kind: 'chess', piece: elite, baseId, consumed: consumed.map((l) => l.piece.uid), area: where });
    onMerge(this.m, this, { kind: 'chess' }); // AI bot says "害怕" on its 3rd chess merge of a round (enabled by default; SP_BOT_EMOTES=0 silences it)
    return elite;
  }

  /** Promote a normal chess piece to its elite in place (升华, 博士投影). Takes extra pool copies when available. */
  promote(piece) {
    if (!piece || piece.kind !== 'chess' || this.gd.isGolden(piece.id)) return false;
    const goldenId = this.gd.goldenIdOf(piece.id);
    if (!goldenId) return false;
    const base = this.gd.baseIdOf(piece.id);
    const extra = Math.max(0, this.gd.goldenCopies - (piece.poolCopies || 0));
    piece.poolCopies = (piece.poolCopies || 0) + this.poolOf(base).take(base, extra, { overdraw: true });
    piece.id = goldenId;
    this.recompute();
    // an elite on the board tops its summon stacks up to the elite's deploy limit, like an elite merged onto a tile
    // (_mergeChess → grantTokensFor): 麦哲伦 / 令 3 → 4, 望 6 → 7 with their modules (0.2.0 review round 17)
    if ([...this.board.values()].includes(piece)) this.grantTokensFor(piece);
    this.forgeOnElite();   // 炸惊模拟「锻造器」: an in-place promotion to elite pays one forge (no-op elsewhere)
    return true;
  }

  /**
   * Transformation (突变细胞 "战斗结束后，装备者替换为高一阶的随机干员"; PRTS 卫戍协议：盟约 下半/PRTS盟约记录 备注 "生效时，原
   * 干员销毁，获得一名高一阶的随机初始干员（最高六阶）"): a destroy followed by a gain. The carrier is destroyed wherever it
   * stands — a board tile is freed (the deploy count drops), its summons are removed, its pool copies return. Its
   * equipment, the cell included, comes off first (PRTS 卫戍协议/帮助 "在失去该干员（干员出售、销毁、合并等）…时自动卸除"): to
   * the hand, overflowing into temp, auto-merging like any gain. Then `newId` is gained like any other gained operator
   * (acquireChess, onGain source 'transform'): the hand, then the expandable temp queue; it gets no summon card in the hand (only a deployment
   * brings one), and a merge it completes follows the ordinary rule (_mergeChess: the elite on a consumed deployed copy's
   * tile, else the hand — the carrier's freed tile is no copy's). Returned equipment waits in the same queue.
   * Official footage (bilibili BV1vzyVBuEN9, BV1Qkw1zMEoR; pointed out in PR #2): at the
   * next prep the carrier's tile is empty, one more deployment is left and the new operator waits in the 整备区.
   * @param {any} piece the carrier (an owned chess piece)
   * @param {string} newId chess id gained in its place
   * @returns {any} the gained piece (the elite when it completed a merge) or null
   */
  transformChess(piece, newId) {
    const loc = this.find(piece.uid);
    if (!loc || loc.piece.kind !== 'chess' || !this.gd.chess(newId)) return null;
    // Remove the original carrier, its summons, and its pool occupation.
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    const items = piece.items || [];
    piece.items = [];
    this.returnCopies(piece);
    // Returned equipment is stowed. morphSlotPolicy is not applied: this path does not check equip slots
    // (the workshop names a recycle read point this codebase does not have).
    for (const it of items) this.stow(it, { allowTemp: true });
    this.checkItemMerges();
    // The replacement follows the ordinary acquisition path.
    const np = this.acquireChess(newId, { source: 'transform' });
    this.recompute();
    return np;
  }

  /** Normal item → golden version in place (整备). A golden occupies two shared copies and this piece
   * already occupies one, so the upgrade waits when no second copy is free. The caller keeps its charge. */
  upgradeItem(piece) {
    const rec = this.gd.item(piece.id);
    if (!rec || rec.isGolden) return false;
    const gid = rec.upgradeChessId || rec.goldenId;
    if (!gid || !this.gd.item(gid)) return false;
    if (this.m.itemPool.left(piece.id) < 1) return false;
    piece.id = gid;
    this.recompute();
    return true;
  }

  /**
   * Queue a reward offer: `count` DIFFERENT chess of tier min(level + offset, maxTier) at price 0 (pick 1). Each is a
   * copy-weighted roll from the shared pool excluding the ones already drawn; a tier left without another chess tops
   * up from the tier below (user playtest #6 item 19: the official promotion reward never offers one operator twice —
   * the user's first-hand report; the normal shop's slots may repeat). The offer reserves no copies (the pick takes one).
   * The player's slotted 自选 pieces of the reward tier join the draw (player/diy.js diyStockEntries: copies left, then
   * the roll's tier — not the ordinary shop's shopLevel gate). 卫戍协议/帮助 干员晋升 names one temporary refresh one tier
   * above the 调度中心 and no separate pool; the owner decided on 2026-10-12 that the refresh includes 自选 of the newly
   * reached tier. 0.2.0 had [ASSUMED] the shop-level gate on this refresh too (DESIGN §25); §30.23 reverses that.
   * An offer built from explicit `ids` does not roll.
   */
  pushRewardOffer(source = 'merge', { tier = null, ids = null, label = null } = {}) {
    const ro = this.gd.rewardOffer();
    const t = Number.isInteger(tier) ? tier : Math.min(this.shop.level + ro.tierOffset, ro.maxTier);
    // an offer never shows one operator twice, whoever built the list (user playtest #6 item 19)
    let list = Array.isArray(ids) ? [...new Set(ids)].filter((id) => this.gd.chess(id)) : null;
    if (!list) {
      list = [];
      const fresh = (id) => !list.includes(id);
      // 炸惊模拟 · 卡池预选: this player's bans also remove a chess from the 特殊刷新 (they only filtered the shop before,
      // audit rules §1). null when nothing is banned ⇒ the roll is exactly the one this method always made.
      const ban = this.chessBanFilter();
      const pickable = ban ? (id) => fresh(id) && ban(id) : fresh;
      for (let i = 0; i < ro.count; i++) { // loop-cap: rewardOffer().count ≤ MAX_OFFER_SLOTS
        let id = null;
        // 队内共用 / 队间独立 (TWELVE_PLAYER_MODE §2): a room above MAX_SEATS rolls the TEAM pool (Match.poolFor)
        for (let tt = t; tt >= 1 && !id; tt--) id = this.m.poolFor(this).roll(this.m.rngShop, { tier: tt, filter: pickable, extra: this.diyStockEntries() });
        if (id) list.push(id);
      }
    }
    if (!list.length) return null;
    const offer = { tier: t, source, label: typeof label === 'string' && label ? label : null, slots: list.slice(0, MAX_OFFER_SLOTS).map((id) => ({ kind: 'chess', id, price: ro.price, sold: false })) };
    this.offers.push(offer);
    this.dirty();
    return offer;
  }

  /**
   * Queue a free pick-one offer of items (凯瑟琳 定向投放, 娜仁图亚 见者有份); shown as shop.rewardOffer with slots of kind
   * 'item' under its `label` (the effect's name; player report #6 after 0.1.0).
   */
  pushItemOffer(ids, { source = 'effect', tier = null, label = null } = {}) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => this.gd.item(id) && this.m.itemPool.canGain(id)).slice(0, MAX_OFFER_SLOTS);
    if (!list.length) return null;
    const offer = { tier: Number.isInteger(tier) ? tier : null, source, label: typeof label === 'string' && label ? label : null, slots: list.map((id) => ({ kind: 'item', id, price: 0, sold: false })) };
    this.offers.push(offer);
    this.dirty();
    return offer;
  }

  /** Item merge candidates: normal, mergeable, with a golden version. */
  _itemMergeable(id) {
    const rec = this.gd.item(id);
    if (!rec || rec.isGolden || rec.itemType !== 'EQUIP' || !rec.mergeable) return false;
    const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    if (!(n > 1 && n < 100)) return false;
    const gid = rec.upgradeChessId || rec.goldenId;
    return !!(gid && this.gd.item(gid));
  }

  _itemLocations(id) {
    const out = [];
    for (let i = 0; i < this.temp.length; i++) if (this.temp[i] && this.temp[i].kind === 'item' && this.temp[i].id === id) out.push({ piece: this.temp[i], area: 'temp', idx: i });
    for (let i = 0; i < this.hand.length; i++) if (this.hand[i] && this.hand[i].kind === 'item' && this.hand[i].id === id) out.push({ piece: this.hand[i], area: 'hand', idx: i });
    for (const holder of this.allChess()) for (const it of holder.items || []) if (it.id === id) out.push({ piece: it, area: 'equipped', holder });
    return out;
  }

  completesItemMerge(id) {
    if (!this._itemMergeable(id)) return false;
    const rec = this.gd.item(id);
    const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    return this._itemLocations(id).length + 1 >= n;
  }

  /**
   * Acquire an item (buy, supply card, grant). Merges with an identical normal copy (hand/temp/equipped) into the
   * golden item (to the hand). Returns the owned piece or null.
   * `deferMerge` (effectsMeta, while onPrepEnd is on the stack): stow it — hand, else temp — and do not merge in this
   * call, even when an identical normal copy is already owned. The next prep's start runs checkItemMerges. Nothing
   * already equipped is taken off for the fight about to start. Overflow waits in the expandable temp queue.
   * [ASSUMED] every prep-end item grant, not only Victoria's hammer (owner's decision 2026-10-04).
   * `displayed` (a shop slot or a reward offer already on screen, #624): skip the stock refusal and, once the piece
   * is actually kept, record the copies that did not fit (`need` minus `left` before the gain). A failed stow or
   * merge records nothing. Fixed gift families stay unlimited without a debt entry. Every other grant still refuses.
   */
  acquireItem(itemId, { source = 'grant', toTemp = false, silent = false, deferMerge = false, requirePool = true, displayed = false } = {}) {
    const rec = this.gd.item(itemId);
    if (!rec) return null;
    // Only the fixed operator-gift families can overdraw. Several unrelated strategy grants also pass
    // requirePool:false; they must retain their stock limit (for example commercial packaging).
    const unlimitedGift = !requirePool && this.gd.isUnlimitedGiftItem(itemId);
    const pool = this.m.itemPool;
    const leftBefore = pool.left(itemId);
    const need = pool.need(itemId);
    if (!unlimitedGift && !displayed && !pool.canGain(itemId)) {
      this.m.toast(this, 'warn', '装备库存不足，未获得该装备');
      return null;
    }
    let piece = this.newPiece('item', itemId);
    // A prep-end grant may sit beside an identical copy until the next prep. The invariant counts only copies
    // without this mark, so the fight that is about to start is not reported as a missed merge.
    if (deferMerge) piece.deferMerge = true;
    if (!deferMerge && this.completesItemMerge(itemId)) {
      piece = this._mergeItem(itemId, piece);
      if (!piece) return null;
    } else {
      this.stow(piece, { allowTemp: true, toTemp });
    }
    if (displayed && !unlimitedGift) {
      const shortfall = leftBefore === Infinity ? 0 : Math.max(0, need - leftBefore);
      if (shortfall > 0) pool.owe(itemId, shortfall);
    }
    this.recompute();
    if (!silent) this.m.dispatch(this, 'onGain', { piece, kind: 'item', source });
    return piece;
  }

  _mergeItem(itemId, incoming = null) {
    const rec = this.gd.item(itemId);
    const need = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    const locs = this._itemLocations(itemId);
    const consumed = incoming ? [{ piece: incoming, area: 'new' }] : [];
    for (const l of locs) { if (consumed.length >= need) break; consumed.push(l); }
    if (consumed.length < need) return null;
    for (const l of consumed) if (l.area !== 'new') this._detach(l);
    const golden = this.newPiece('item', rec.upgradeChessId || rec.goldenId);
    this.stow(golden, { allowTemp: true });
    this.stats.itemMerges++;
    this.m.dispatch(this, 'onMerge', { kind: 'item', piece: golden, itemId, consumed: consumed.map((l) => l.piece.uid) });
    return golden;
  }

  /** Merge every identical normal item pair currently owned (after equips / returns). */
  checkItemMerges() {
    // Bound the work by the actual inventory, including hidden overflow and equipped items.
    // A fixed twenty-merge limit left large batches of deferred prep-end rewards unmerged.
    const limit = this.hand.length + this.temp.length + this.allChess().reduce((n, p) => n + (p.items || []).length, 0);
    for (let guard = 0; guard < limit; guard++) {
      const counts = new Map();
      const scan = (p) => { if (p && p.kind === 'item' && this._itemMergeable(p.id)) counts.set(p.id, (counts.get(p.id) || 0) + 1); };
      for (const p of this.hand) scan(p);
      for (const p of this.temp) scan(p);
      for (const holder of this.allChess()) for (const it of holder.items || []) scan(it);
      let did = false;
      for (const [id, n] of counts) {
        const rec = this.gd.item(id);
        const need = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
        if (n >= need) { if (this._mergeItem(id, null)) did = true; break; }
      }
      if (!did) return;
    }
  }

  // ---- 炸惊模拟「锻造器」(owner 2026-10-14) -----------------------------------------------------------------------
  //
  // GRANTS: an operator made elite (a 三合一 merge or an in-place promotion) pays one forge, and every whole
  // FORGE_KILLS_PER knock-outs pays one more (reconciled at settlement, idempotent through `killsPaid`).
  // SPEND: Match.forgeTake (`g.forgeTake`) validates the pick against the roll the server drew, records it in `forged`
  // and pays 资金 at once; everything else travels to the battle through `flags.forge` (forgeBattleMods).
  // Every entry point is a no-op outside a ZHAJING match: `this.forge` is null there, so official / 湮灭 rooms are
  // byte-identical to before this mechanic existed.

  /**
   * Hand `n` forges to this player (no roll is drawn here — `forgeRoll()` draws lazily when a client asks).
   * @param {number} [n]
   * @returns {number} how many were granted (0 outside 炸惊)
   */
  grantForge(n = 1) {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    if (!(k > 0) || !this.forge) return 0;
    this.forge.count += k;
    this.dirty();
    return k;
  }

  /**
   * The three cards of the current roll (`{ rarity, picks }`), drawn once and kept until it is spent. Null when the
   * player has no forge; outside 炸惊 there is nothing to roll.
   * @returns {{ rarity: string, picks: string[] } | null}
   */
  forgeRoll() {
    if (!this.forge) return null;
    if (!(this.forge.count > 0)) { this.forge.roll = null; return null; }
    if (!this.forge.roll) {
      // the match's seeded meta stream — never Math.random, so a replayed match draws the same cards
      const rng = this.m && typeof this.m.rngMeta === 'function' ? this.m.rngMeta : null;
      if (!rng) return null;
      this.forge.roll = drawForge(rng);
    }
    return this.forge.roll;
  }

  /** 精锐一名干员 → 一个锻造器。 */
  forgeOnElite() {
    if (!this.forge) return 0;
    this.forge.elites++;
    return this.grantForge(1);
  }

  /**
   * Reconcile the 「每 FORGE_KILLS_PER 击杀」 payout against this player's accumulated kills (settled once per round, the
   * 联防's kills included). Idempotent: `killsPaid` remembers how many whole payouts were already granted.
   */
  forgeOnKills() {
    if (!this.forge) return 0;
    const due = Math.floor((Number(this.stats && this.stats.kills) || 0) / FORGE_KILLS_PER);
    const gain = due - (this.forge.killsPaid || 0);
    if (!(gain > 0)) return 0;
    this.forge.killsPaid = due;
    return this.grantForge(gain);
  }

  /**
   * Pick one card of the current roll (`g.forgeTake`). Validated against the roll the SERVER drew: an `optId`/`rarity`
   * pair that is not on the table is refused, so a client can neither invent a card nor replay an old one.
   * **Fail-closed**: `grantForge()` only adds to the count — the cards are drawn lazily by `forgeRoll()` on the next view
   * push. A message that arrives before that push used to skip both checks (`if (roll && …)`) and take any option of any
   * tier (audit B3, 2026-10-29). The roll is drawn here instead; when the server still has none, the pick is refused.
   * @param {string} optId shared/forgeData.js option id @param {string} rarity this roll's rarity
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  forgeTake(optId, rarity) {
    if (!this.forge) return fail(ERR.BAD_TARGET, 'forge is a ZHAJING mechanic');
    if (!(this.forge.count > 0)) return fail(ERR.RATE, 'no forge left');
    const opt = forgeOptionById(optId);
    if (!opt || !isForgeRarity(rarity) || !opt.value[rarity]) return fail(ERR.BAD_TARGET, 'bad forge option');
    // the roll this pick has to match — drawn now when the grant's view push has not drawn it yet (never Math.random: the
    // match's seeded meta stream, so a replayed match draws the same cards)
    const roll = this.forgeRoll();
    if (!roll) return fail(ERR.RATE, 'no forge roll');
    if (roll.rarity !== rarity) return fail(ERR.BAD_TARGET, 'rarity mismatch');
    if (!Array.isArray(roll.picks) || !roll.picks.includes(optId)) return fail(ERR.BAD_TARGET, 'not in this roll');
    const res = applyForgePick(this.forge.forged || {}, optId, rarity);
    this.forge.forged = res.forged;
    this.forge.count -= 1;
    // the next roll is drawn lazily by forgeRoll(); drop the spent one so the view cannot show a card already taken
    this.forge.roll = this.forge.count > 0 ? (this.m && typeof this.m.rngMeta === 'function' ? drawForge(this.m.rngMeta) : null) : null;
    // 资金 is the one option that pays out at once; the other eight ride into the battle as flags.forge
    if (optId === 'gold' && res.delta > 0) this.addFunds(res.delta, { reason: 'forge' });
    this.dirty();
    return OK;
  }

  /**
   * The battle-side summary of everything this player has forged (`flags.forge`), or null when there is nothing to apply.
   * @returns {{ forge: ReturnType<typeof forgeBattleMods> } | null}
   */
  forgeBattleFlags() {
    if (!this.forge) return null;
    const mods = forgeBattleMods(this.forge.forged);
    return forgeModsEmpty(mods) ? null : { forge: mods };
  }

  /** The `m.private.forge` block: the grant counters, the accumulated table and the current roll. */
  forgeView() {
    if (!this.forge) return null;
    return {
      count: Math.max(0, Math.trunc(Number(this.forge.count) || 0)),
      killsPaid: Math.max(0, Math.trunc(Number(this.forge.killsPaid) || 0)),
      elites: Math.max(0, Math.trunc(Number(this.forge.elites) || 0)),
      per: FORGE_KILLS_PER,
      // the raw table `{ [optId]: { total, count } }` — the client folds it with shared/forgeData.js forgedEntries()
      forged: { ...(this.forge.forged || {}) },
      rolled: this.forgeRoll(),
    };
  }
}
