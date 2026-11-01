// server/match/match/settle.js — Match methods: SETTLE (the LP loss — a leaker's 联防 survivors —, stats, bounty coins,
// the IN_BATTLE layer gains clamped by layerGainRoom, CHAR_DAMAGE tickers, eliminations, the 联防 outcome the SETTLE
// view carries) and RESULT (finish: m.result to every human still here, onEnd).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { uniteSurvivors } from '../unite.js';
import { splitLeakDamage } from '../teams.js';
import { buildResult } from '../results.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onSettle, resetRoundCounters } from '../botEmotes.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { relicBountyMul, relicBountyIncome, relicOnSettle, relicBountyDeploy } from '../relics.js';

export class MatchSettle {
  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    this.runner = null;
    this._stopClientCombat();
    // the pending in-battle gains the views showed become persistent below (alive players) or lapse (DESIGN §20.15)
    for (const ps of this.order) if (ps.pendingLayerGains) { ps.pendingLayerGains = null; ps.dirty(); }
    const cap = this.gd.lpCapPerRound;
    // 多队（8 / 12 人房）: the round's charges come from the three-stage 联防 outcome (Match.uniteCharge) and are split
    // by the players still standing (TWELVE_PLAYER_MODE §4) instead of being charged to the leaker alone.
    const multi = this.multiTeam === true;
    const planHelpers = multi && plan && Array.isArray(plan.teams) ? plan.teams.flatMap((t) => t.helpers) : (plan ? plan.helpers : []);
    const planLeakers = multi && plan && Array.isArray(plan.teams) ? plan.teams.flatMap((t) => t.leakers) : (plan ? plan.leakers : []);
    // a 联防 battle that could not run at all (synthetic result) must not wipe the leakers' losses: charge their own leaks
    const uniteRan = multi
      ? !!(this.uniteCharge && this.uniteCharge.ran)
      : !!(plan && uniteResult && !uniteResult.synthetic);
    const survivors = multi
      ? (uniteRan ? this.uniteCharge.survivors : null)
      : (uniteRan ? uniteSurvivors(plan, uniteResult) : null);
    // The 联防's outcome as data for the SETTLE view (m.public.uniteResult, views.js; GitHub #235, PR #112 by @Convey123):
    // each client pops the official result box from it (ui/gameLogic/phases.js uniteResultBox) — `through` = the leakers'
    // enemies that still got through (uncapped; only decides whether 「全员无伤！」 is true), `losses` = every alive
    // player's own LP charge of this round, the same `loss` deducted below, so the box and the LP bar never disagree. A
    // leaker's own battle leaks are not its charge in a 联防 round, which is why the client cannot work the number out
    // itself. No ticker line: the official reports the outcome in the one dialog. null when no 联防 resolved.
    this.uniteResultView = uniteRan && planLeakers.length ? {
      through: planLeakers.reduce((n, lk) => n + Math.max(0, survivors.get(lk.playerId) || 0), 0),
      helpers: planHelpers.map((p) => p.playerId),
      leakers: planLeakers.map((p) => p.playerId),
      losses: {},
    } : null;
    const alive = this.alivePlayers();
    /**
     * 血量平摊 (TWELVE_PLAYER_MODE §4): `d` = the round's leak damage — every alive player's own charge summed — and each
     * alive player really loses its share of `d` (3 decimals, the residue on the last one, so the shares add up to `d`;
     * teams.js splitLeakDamage). [ASSUMED] the raw `d` is that sum (the rules' §11 item 1 leaves the amount's source
     * open; the 4-player charge is the one quantity this repository has, capped per player like `min(lpCapPerRound, …)`).
     */
    let shares = null;
    if (multi) {
      let d = 0;
      for (const ps of alive) {
        const r0 = this.lastResults.get(ps.playerId) || {};
        const counted0 = (r0.leaked || []).filter((l) => l && l.counted !== false).length;
        d += survivors ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, counted0);
      }
      shares = splitLeakDamage(d, alive.length).shares;
    }
    let shareIdx = 0; // the alive-order index splitLeakDamage allocated, advanced once per player below
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
      const loss = multi ? shares[shareIdx++] : (uniteRan && planLeakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, counted));
      if (this.uniteResultView) this.uniteResultView.losses[ps.playerId] = loss;
      ps.lp -= loss;
      ps.stats.lpLost += loss;
      ps.stats.leaks += counted;
      ps.stats.kills += Number(r.killed) || 0;
      ps.stats.dmgDealt += Number(r.damageDealt) || 0;
      ps.stats.healing += Number(r.healingDone) || 0;
      if (r.perfect !== false && counted === 0) ps.stats.perfectRounds++;
      // bounty coins (own battle + unite kills) are credited to the next prep
      let coins = Math.max(0, Math.trunc(Number(r.coins) || 0));
      const up = uniteResult && uniteResult.perPlayer && uniteResult.perPlayer[ps.playerId];
      if (up) {
        coins += Math.max(0, Math.trunc(Number(up.coins) || 0));
        ps.stats.dmgDealt += Number(up.damageDealt) || 0;
        ps.stats.kills += Number(up.killed) || 0;
      }
      ps.creditedKills += creditedKillsOf(r) + creditedKillsOf(up);
      // 炸惊模拟「锻造器」: reconcile the 「每 FORGE_KILLS_PER 击杀一个」 payout against the accumulated kills (own field +
      // 联防 kills, both added above). Idempotent through `forge.killsPaid`; a no-op outside a ZHAJING match.
      ps.forgeOnKills();
      // perfect-payout bounties (战术特训): own phase perfect
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && counted === 0 && r.perfect !== false) coins += b.card.coin;
      // 悬赏完成（p34 铿金征鼓 / p39 仇名录 / 乌萨斯那条 rule）：一场战斗最多算 1 次，判据是「击杀了悬赏目标」或
      // 「有悬赏资金入账」。必须在 relicBountyMul 之前算 —— 乘数可能把资金压成 0，那不代表悬赏没完成。
      const bountyDone = ((Number(r.bountyKills) || 0) + (up && Number(up.bountyKills) || 0) > 0 || coins > 0) ? 1 : 0;
      // 半洗孤钻 / 追忆仪 / 至宝指环: bounty funds multipliers from the 湮灭藏品 (annihilation only — the official modes keep
      // the plain sum byte for byte)
      if (this.gd.annihilation) coins = Math.round(coins * relicBountyMul(ps));
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      // 无限续杯瓶 / 迷幻的藏宝图: a completed bounty pays the relic's extra funds too
      if (this.gd.annihilation) relicBountyIncome(ps, coins);
      for (const b of ps.bounties) b.roundsLeft--;
      ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
      // IN_BATTLE layer gains (normal battles only), at most the room left under the bond's cap (BOND_LAYER_CAP 999, as
      // the battle's live copy: Battle.addLayers; 炸惊模拟 规则1: the mode's own `gd.bondLayerCap`, 9999); a bond at the
      // cap gains nothing and dispatches nothing
      for (const [bondId, n] of Object.entries(r.layerGains || {})) {
        if (!this.gd.bond(bondId) || !(n > 0)) continue;
        const before = ps.layers[bondId] || 0;
        // 炸惊模拟 规则1: a mode that configures its own per-bond cap (9999) bounds the gain with it instead of the official
        // 999 that `layerGainRoom` enforces process-wide (null in every other mode ⇒ the old line, unchanged)
        const cap = this.gd.bondLayerCap;
        // 无尽湮灭: 盟约叠层无层限制 — the in-battle gains are taken whole, not clamped at BOND_LAYER_CAP
        const add = this.gd.annihilation && this.gd.unlimitedLayers ? Math.floor(n)
          : cap ? Math.max(0, Math.min(Math.floor(n), cap - before)) : layerGainRoom(before, Math.floor(n));
        if (!(add > 0)) continue;
        ps.layers[bondId] = before + add;
        this.dispatch(ps, 'onLayers', { bondId, from: before, to: ps.layers[bondId], reason: 'battle' });
      }
      this._charDamageTickers(ps, r);
      // 湮灭藏品的计数器走这条派发链（server/sim/content/relics.js 的全局 onBattleResult）：p12 生还者合约、
      // p34 铿金征鼓、p39 仇名录、乌萨斯。bountyDone = 本场是否完成悬赏（0/1），别在别处再记一遍。
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: counted === 0 && r.perfect !== false, bountyDone, unite: uniteResult || null });
      // 酒神的印记（重铸）: 每 2 个悬赏目标击杀 +1 部署位（上限 3，鸭爵 / 杜宾 不计）
      if (this.gd.annihilation) {
        relicBountyDeploy(ps, (Number(r.bountyKills) || 0) + (up && Number(up.bountyKills) || 0));
        relicOnSettle(ps);
      }
      ps.recompute();
    }
    this.eliminateBroken();
    this.fields = [];
    this.watchers.clear();
    this.markPublic();
    onSettle(this); // one emote per alive AI per round (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
  }

  /**
   * CHAR_DAMAGE tickers: one per board unit of the battle (its highest threshold); units created in battle (summons,
   * no board uid) count once per unit type (the highest of them) — a result can never announce more units than the
   * lineup has kinds of.
   */
  _charDamageTickers(ps, r) {
    const steps = (Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts : []).filter((b) => b.type === 'CHAR_DAMAGE' && Array.isArray(b.params)).map((b) => Number(b.params[0])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!steps.length) return;
    const board = new Set();
    for (const p of ps.board.values()) board.add(p.uid);
    const best = new Map();
    for (const u of r.unitStats || []) {
      if (!u) continue;
      const key = Number.isInteger(u.uid) && board.has(u.uid) ? `uid:${u.uid}` : `def:${u.defId}`;
      const cur = best.get(key);
      if (!cur || (Number(u.dmg) || 0) > (Number(cur.dmg) || 0)) best.set(key, u);
    }
    for (const u of best.values()) {
      const hit = steps.find((s) => (u.dmg || 0) >= s);
      if (hit) this.tickerFor('CHAR_DAMAGE', [ps.name, u.name || u.defId, String(hit)], { playerId: ps.playerId, param: String(hit) });
    }
  }

  /**
   * Drop every alive player whose LP is already gone. Settlement calls this after the round's LP loss.
   * An accepted test round jump calls the same helper before the next round starts, so LP 0 cannot be
   * written back into a new prep. The LP command itself stays a raw write.
   */
  eliminateBroken() {
    for (const ps of this.alivePlayers()) {
      if (ps.lp <= 0) {
        // 炸惊模拟 惊变「时光之末」(jibian_shiguangzhimo) — `onWouldEliminate`, dispatched BEFORE the elimination so a
        // handler can still change the outcome (`ev.saved = true` ⇒ the player stays with 1 LP). `kind` is the field the
        // round just fought on (normal / boss / hidden) — the card only saves on non-boss rounds. No handler ⇒ saved is
        // false and this loop is exactly what it was.
        const ev = {
          kind: this.gd.isHiddenRound(this.round) ? 'hidden' : this.gd.isBossRound(this.round) ? 'boss' : 'normal',
          saved: false,
        };
        try { this.dispatch(ps, 'onWouldEliminate', ev); } catch (e) { this.reportError('dispatch onWouldEliminate', e); }
        if (ev.saved === true) { ps.lp = 1; continue; }
        // 炸惊模拟 惊变「死亡回归」(jibian_siwanghuigui)：本回合战斗阶段结束后因目标生命归零被淘汰时，
        // 该玩家与小队回到**本回合的整备阶段**（一局一次，不新增 PHASE）。判定与恢复都在 PlayerState 上
        // （`deathReturnTrigger` 抓 `_deathReturnRound`/`_deathReturnLp`、播报、3 秒后 `_deathReturnRewind` 回滚本回合
        // 整备阶段买的干员/商店牌面并 `startRound(r)`；规格见 handoff 报告的「状态清单」）。
        // 这里只做**淘汰判定处的那一次询问**：玩家状态没提供这个方法（官方四档、湮灭房、或 engine-core 尚未接线）时
        // 整行是 no-op，淘汰路径与现在逐字节相同。
        if (typeof ps.deathReturnTrigger === 'function'
          && typeof ps.jibianHas === 'function' && ps.jibianHas('jibian_siwanghuigui')
          && !(ps.counters && ps.counters['jibian:siwanghuigui:used'] > 0)) {
          try { if (ps.deathReturnTrigger({ auto: true })) continue; } catch (e) { this.reportError('deathReturn auto', e); }
        }
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
      }
    }
  }

  afterSettle() {
    // 超限档案：每个普通回合结算时也记一次盟约层数峰值（Boss 轮由 _finishFinal 记）
    if (this.isInfinite && typeof this._trackInfiniteLayers === 'function') this._trackInfiniteLayers();
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    resetRoundCounters(this); // AI bot merge-counter resets each round (server/match/botEmotes.js)
    // 炸惊模拟 惊变「死亡回归」：PlayerState.deathReturnTrigger 只**登记**要回到哪个回合的整备阶段
    // （`_jibianRewindRound`），在这里消费 —— 于是下一次 `startRound` 用同一个回合号重开整备阶段，
    // 而不是推进到 r+1（不新增 PHASE，正常推进路径逐字节不变：没有该标记时仍是 this.round + 1）。
    const rewind = Number.isInteger(this._jibianRewindRound) ? this._jibianRewindRound : null;
    this._jibianRewindRound = null;
    this.startRound(rewind != null ? rewind : this.round + 1);
  }

  finish({ victory, hiddenCleared = false, reason = 'defeat' }) {
    // A command that ends a test match must be audited/counted before publishing its result.
    if (this.test && this._testApplying) { this._testOutcome = { victory, hiddenCleared, reason }; return; }
    if (this.ended || this.disposed) return;
    this.offersDispose();
    this.ended = true;
    this.externalAI?.close();
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } this.runner = null; }
    this._stopClientCombat();
    this.cancel(this._phaseTimer);
    this.cancel(this._turnTimer);
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    for (const f of this.fields) f.live = false;
    this.outcome = { victory: !!victory, hiddenReached: this.hiddenReached, hiddenCleared: !!hiddenCleared, reason };
    let result;
    try {
      result = buildResult(this, this.outcome);
    } catch (e) {
      this.reportError('buildResult', e);
      result = { t: 'm.result', victory: !!victory, roundsPassed: 0, reason, modeId: this.modeId, difficulty: this.difficulty, players: [] };
    }
    if (this.test) {
      result.test = true;
      result.testActions = this.testActions;
      if (this.testReplayable === false) result.testReplayable = false;
    }
    this.lastResultMsg = result;
    this.markPublic();
    try { this.flush(true); } catch (e) { this.reportError('flush', e); }
    // every human still here gets the settlement — the spectator seats the same public rows (none of them their own)
    for (const ps of this._viewers()) this.sendTo(ps.playerId, { ...result, playerId: ps.playerId });
    const { t, ...summary } = result;
    void t;
    summary.errors = this.errorCount;
    try { this.onEndFn(summary); } catch (e) { this.reportError('onEnd', e); }
  }
}
