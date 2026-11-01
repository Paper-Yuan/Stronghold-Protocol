// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard), the personal bounty choice of the Art 教鞭 (offerBountyChoice / pickPersonalChoice /
// autoPickPersonalChoice: held by the player inside PREP — no phase, no timer of its own) and the rolls the meta effects
// ask for — bounties (addBounty), item ids (rollItemId) and choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty, bountyCard, ownedJibianIds, jibianDraftCards } from '../choices.js';
import { RELIC_CARD_FAMILY } from '../relicsOverlimit.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { OK, fail, DELAYS } from './common.js';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    const alive = this.alivePlayers();
    const jibian = this.gd.spPhaseKind && this.gd.spPhaseKind(this.round) === 'jibian' ? this.gd.jibian() : null;
    /**
     * 炸惊模拟 惊变「死亡回归」(jibian_siwanghuigui): the round it rewound to re-runs, but its 惊变 draft belongs to the
     * player who triggered the rewind ALONE — everybody else goes straight to their prep (the reference build: its
     * `messaging._deathReturnRewind` sets `m._jibianSoloPick` and its enterSpDraft consumes it). The marker is CONSUMED here
     * (one round only) and only narrows a 惊变 draft: any other family re-runs with the whole table, so a stale marker can
     * never hide an ordinary 机变 from the room.
     */
    const soloPid = typeof this._jibianSoloPick === 'string' ? this._jibianSoloPick : null;
    this._jibianSoloPick = null;
    const soloPs = soloPid ? this.players.get(soloPid) : null;
    const participants = jibian && soloPs && soloPs.alive ? [soloPs] : alive;
    // 炸惊模拟 规则5: the 惊变阶段 drafts from the mode's own card pool (choices.jibianDraftCards through
    // generateDraft's `jibian` family). `sp.cards` keeps its shape — but it is the hand of the player whose TURN it is:
    // every time the turn passes, `_dealJibianFor` re-deals `jibian.cards` (3) for that player (the reference build's
    // per-player pools; keeping one array means the client needs no change). A card LEAVES the pool only when it is
    // picked (`sp.jibian.claimed`); the ones merely offered go back, exactly like the reference's 「抽到没选中的卡回牌库」.
    // Every other family passes none of this and behaves as before.
    const draft = generateDraft(this.gd, this.rngDraft, this.round, {
      stageId: this.stageId,
      bondAvailable: (bondId) => this.bondLive(bondId),
      itemAvailable: id => this.itemPool.canGain(id),
      ...(jibian ? { exclude: this._jibianOwnedAll(), noCoreBond: this._jibianNoCoreAll() } : null),
    });
    if (!draft || !participants.length) { this.beforePrepOffers(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = participants.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
    order = this.humansFirst(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay
    const untimed = this.soloUntimed;
    this.sp = {
      ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0,
      ...(jibian ? { jibian: { ...jibian, claimed: new Set() }, dealtFor: null, handTaken: new Set(), rerolledBy: {} } : null),
    };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
    // 炸惊模拟: `m.private.jibian.rerollsLeft` is computed from `this.sp` (jibianRerollsLeft), which did not exist a
    // moment ago — without this push the draft's first frame carries the stale 0 and the client's 重抽 key renders
    // disabled for the whole draft (found on a real screen, 2026-10-28). Every other family's private view does not
    // read `sp`, so only the 惊变 draft pays this extra push.
    if (jibian) for (const ps of alive) this.markPrivate(ps);
  }

  /**
   * 炸惊模拟: hand `ps` its own offer of `jibian.cards` (3) 惊变 cards — run every time the draft's turn moves to a
   * player who has not been dealt yet. Excluded: the ids this player already owns and every card somebody already PICKED
   * (`sp.jibian.claimed`); the cards of the previous player's offer simply go back to the pool.
   * Keeps `sp.cards` (the client reads it) and the per-hand slot bookkeeping (`handTaken`, so an idx is free again in the
   * next hand while `taken` stays the room-wide "who picked slot N" record the views show).
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {boolean} whether a hand was dealt
   */
  _dealJibianFor(ps) {
    const s = this.sp;
    if (!s || !s.jibian || !ps) return false;
    const jb = s.jibian;
    const exclude = this._jibianOwned(ps);
    for (const id of jb.claimed || []) exclude.add(id);
    const n = Math.max(1, Math.trunc(Number(jb.cards) || 3));
    const cards = jibianDraftCards(this.gd, this.rngDraft, n, exclude, { noCoreBond: this._jibianNoCore(ps) }) || [];
    // `rerolled: false` on every card of a FRESH hand (owner 2026-10-19, 每张卡各能刷新一次): the flag is the record that
    // this slot's card is already the product of a redraw, so the guard never has to compare slots across hands.
    s.cards = cards.map((c, i) => ({ ...c, idx: i, family: 'jibian', rerolled: false }));
    s.handTaken = new Set();
    // a fresh hand is a fresh budget: the ids redrawn away in the previous hand of this draft say nothing about these cards
    if (s.rerolledBy) s.rerolledBy[ps.playerId] = new Set();
    s.dealtFor = ps.playerId;
    return s.cards.length > 0;
  }

  /**
   * 炸惊模拟: the 惊变 ids a player already owns — the ids that must not be offered again. A player without 惊变 owns
   * none, and outside 炸惊 the callers never ask (every one of them is gated on the draft being a 惊变 draft).
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {Set<string>}
   */
  _jibianOwned(ps) { return ownedJibianIds(ps); }

  /** The union over the players of this draft — one room-wide pool, so a card nobody can be offered twice is dropped. */
  _jibianOwnedAll() {
    const out = new Set();
    for (const ps of this.alivePlayers()) for (const id of this._jibianOwned(ps)) out.add(id);
    return out;
  }

  /**
   * 隐藏规则 (never shown in the UI): has this player NO active core bond (`data/bonds.json` isCore)? True then raises
   * the 「带核心盟约的传说惊变」 share to `jibian().noCoreBondLegendWeight` (choices.jibianDraftCards).
   * @param {import('../PlayerState.js').PlayerState} ps
   */
  _jibianNoCore(ps) {
    const bonds = ps && ps.bonds;
    if (!bonds || typeof bonds !== 'object') return true;
    for (const [id, b] of Object.entries(bonds)) {
      if (!b || b.active !== true) continue;
      const rec = this.gd.bond(id);
      if (rec && rec.isCore === true) return false;
    }
    return true;
  }

  /** The rule above for the whole draft: only a room where nobody holds a core bond gets the boost. */
  _jibianNoCoreAll() { return this.alivePlayers().every((ps) => this._jibianNoCore(ps)); }

  /**
   * 炸惊模拟 规则5/6 — 重抽一张已摆出的惊变. **每张卡各能刷新一次** (owner 2026-10-19, the reference build's `spReroll`): the
   * budget `modes[*].jibian.rerolls` is no longer a per-draft total — a hand of `jibian.cards` (3) cards may redraw each of
   * its cards once, so the old `used.size >= rerolls` test (4) is gone (it also refused the 5th card of a bigger hand and
   * mis-read the data field as a room-wide budget). The record is per CARD ID, not per slot: a redrawn card carries
   * `rerolled: true` (so its slot cannot be redrawn again) and the id it replaced is kept in `rerolledBy`, so a re-dealt
   * hand in the same draft is not mistaken for "already redrawn". The new card keeps the slot (`idx`) so nothing on the
   * client has to move, and it is drawn with the same exclusions as the first hand (the player's owned ids + the cards
   * currently on the table), so a redraw never hands out a duplicate.
   *
   * Reached from `g.cardRefresh { idx }` (shared/protocol.js → match/intents.js). Error contract the client keys on:
   *   BAD_TARGET — not a ZHAJING 惊变 draft (so a normal match's `g.cardRefresh` is refused, never silently accepted),
   *                not this player's turn, an out-of-range slot, or the slot is already taken;
   *   ALREADY    — this card was already redrawn (or the player already picked its card for this draft);
   *   RATE       — kept for the shape of the contract; the per-card rule never runs out of budget.
   * @param {import('../PlayerState.js').PlayerState} ps @param {number} idx
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  refreshSpCard(ps, idx) {
    const s = this.sp;
    // The mode gate comes first: a normal match must be refused (BAD_TARGET) rather than fall through to a phase error.
    if (!this.gd || this.gd.zhajing !== true) return fail(ERR.BAD_TARGET);
    if (this.phase !== PHASE.SP_DRAFT || !s || !s.jibian) return fail(ERR.BAD_TARGET);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (s.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= s.cards.length) return fail(ERR.BAD_TARGET);
    const used = (s.rerolledBy[ps.playerId] ||= new Set());
    // this hand's slots (a picked slot is closed, a re-dealt hand opens its own 0..n-1 again)
    const closed = s.handTaken ? s.handTaken.has(idx) : s.taken[idx] != null;
    const card = s.cards[idx];
    if (!card || closed) return fail(ERR.BAD_TARGET);
    // 每张卡一次: the slot's current card already being a redraw (`rerolled`) or the card itself having been redrawn away
    // in this hand. Both are "you may not do this again", not "out of budget" — so ALREADY, like a second pick.
    if (card.rerolled === true || used.has(card.id)) return fail(ERR.ALREADY);
    const exclude = this._jibianOwned(ps);
    for (const c of s.cards) if (c && c.id) exclude.add(c.id);
    const next = jibianDraftCards(this.gd, this.rngDraft, 1, exclude, { noCoreBond: this._jibianNoCore(ps) });
    if (!next || !next.length) return fail(ERR.BAD_TARGET);
    s.cards[idx] = { ...next[0], idx, family: 'jibian', rerolled: true };
    used.add(card.id);
    this.markPublic();
    this.markPrivate(ps);
    return OK;
  }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    return s.order[s.idx] ?? null;
  }

  /**
   * Is `card` still on the table? A 惊变 hand is re-dealt per player, so its slots are free again for the next player:
   * `sp.handTaken` (this hand) decides, while `sp.taken` stays the room-wide slot→playerId record the views show. Every
   * other family keeps the original `taken[idx]` rule.
   */
  spCardAvailable(card) {
    if (!card) return false;
    const s = this.sp;
    const taken = s && s.jibian ? (s.handTaken ? s.handTaken.has(card.idx) : false) : s?.taken[card.idx] != null;
    if (taken) return false;
    return card.kind !== 'item' || this.itemPool.canGain(card.id);
  }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (s.idx < s.order.length) { // loop-cap: draft order
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    // 炸惊模拟: a new player's turn = a fresh 3-card hand for THAT player (the reference build's per-player pool). Only
    // when the turn actually moves to somebody who has not been dealt this draft, so repeated startSpTurn() calls inside
    // one turn (a pick, a reroll) never re-roll the hand under the player's cursor.
    const turnPs = s.idx < s.order.length ? this.players.get(s.order[s.idx]) : null;
    if (turnPs && s.jibian && s.dealtFor !== turnPs.playerId) this._dealJibianFor(turnPs);
    const available = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = this.isSolo && this.gd.config.version?.rules?.soloTimed ? 150 : first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  scheduleSpBot() {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp) return;
      const ps = this.players.get(this.spTurn());
      if (!ps || !ps.botControlled) return;
      const avail = this.sp.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
      if (!avail.length) return;
      // 超限词条（server/match/match/relicDraft.js）: 机器人没有可评估的数值模型（还剩 FGO-SP 一条 `impl: 'pending'` 的桩）——
      // 直接拿第一张可选卡，保证 AI 托管的席位不会卡在这个阶段（untimed 的三选一没有超时兜底）。
      if (this.sp.family === RELIC_CARD_FAMILY) { this._applyCard(ps, avail[0]); return; }
      const fallback = () => this._applyCard(ps, this.bot.pickCard(this, ps, this.sp.cards, avail));
      if (this.bot.decide?.(this, ps, { kind: 'card',
        valid: () => this.phase === PHASE.SP_DRAFT && token === this._turnToken,
        complete: () => this.sp?.picks[ps.playerId] != null, fallback })) return;
      fallback();
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx])) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx])) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    // the slot of THIS hand is closed (a re-dealt hand has its own slots; see spCardAvailable)
    if (s.handTaken) s.handTaken.add(idx);
    // 炸惊模拟: a PICKED 惊变 leaves the pool for the rest of the draft (the ones merely offered go back — `_dealJibianFor`
    // excludes only `claimed`, i.e. what somebody actually took).
    if (s.jibian && card.id) s.jibian.claimed.add(card.id);
    // 超限模拟「词条」（server/match/match/relicDraft.js）: the relic draft rides this same phase and the same `g.choice`
    // intent, but a relic is not a choices.json card — applyCard has nothing to say about it. It is only RECORDED
    // (impl: 'pending' stubs, 业主 2026-10-31), and the record lives in match/relicDraft.js takeOverlimitRelic.
    if (s.family === RELIC_CARD_FAMILY) {
      this.takeOverlimitRelic(ps, card);
    } else {
      try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    }
    this.markPrivate(ps);
    this.markPublic();
    // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it) — a relic has no bounty
    if (s.family !== RELIC_CARD_FAMILY) onPickCard(this, ps, card);
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    // 超限模拟「词条」: 同一个阶段复用，收尾交给词条那一条链（它再决定是进机变还是进整备）
    if (this.sp && this.sp.family === RELIC_CARD_FAMILY) { this.finishRelicDraft(); return; }
    this.beforePrepOffers();
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — the card becomes a bounty on its next battles. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? this.bot.pickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items.
   * `also` (pool_equip_kathe: 突变细胞) joins the draw even though it is shopExcluded. The shop item slot does not
   * read it. `pick` still drops ids that `canGain` refuses, so an empty shop item stays out and an uncapped `also`
   * id can still be drawn. `exclude` removes ids before sampling (Cathy's match-long allowance / distinct choices). */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const pick = (ids, weights = null) => this.itemPool.pick(rng, ids.filter((id) => !exclude.includes(id)), weights);
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && this.itemPool.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return pick(pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return pick(withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return pick(withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return pick(list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * `ban` (the drawing player's 卡池预选 filter, PlayerState.chessBanFilter) drops every chess whose bonds are all banned
   * from ALL THREE chess shapes — the 奖池 was the third draw path the panel did not reach (audit rules §1/§5.5). null
   * (nothing banned, every other mode) ⇒ no extra test, the same draw as before.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, exclude = [], ban = null, ps = null } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    // 队内共用 / 队间独立 (TWELVE_PLAYER_MODE §2): the drawing player's TEAM pool above MAX_SEATS; `this.pool` (the
    // match's single shared pool) in a 4-seat room, whose draws stay byte-identical.
    const pool = typeof this.poolFor === 'function' ? this.poolFor(ps) : this.pool;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl, exclude });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const allowed = typeof ban === 'function' ? ban : null;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      if (allowed && !allowed(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !pool.has(base) || pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond)))
          && (!allowed || allowed(cid)),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
