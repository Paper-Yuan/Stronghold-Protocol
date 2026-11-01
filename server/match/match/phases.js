// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: one countdown of BAND_TURN_SECONDS per turn, 队友已选, the highlighted strategy on a timeout, skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { GAME_SPEED } from '../fields.js';
const BASE = GAME_SPEED;
import { GEO } from '../../../shared/constants.js';
import { buildNormalWave, buildBossWave } from '../waves.js';
import { scaleWaveCounts } from '../relics.js';
import { isInfiniteBossRound, buildInfiniteNormalWave, buildInfiniteBossWave, capWaveKinds } from '../infiniteWaves.js';
import { partyWaveCountMul } from '../../../shared/infiniteMode.js';
import { wantsTraitDraft } from './traitDraft.js';
import { wantsRelicDraft } from './relicDraft.js';
import { pairPlayers, bossPairSalt } from '../finalAssault.js';
import { weightedPick } from '../waves.js';
import { jibianCard } from '../choices.js';
import { matchJibianPlan, applyHiddenMatchCards } from '../../sim/content/ejibian.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { botPickBand } from '../bot.js';
import { trackHpMax } from '../teams.js';
import { OK, fail, DELAYS, BAND_TURN_SECONDS } from './common.js';

export class MatchPhases {
  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: the official 25 s guard
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.phase !== PHASE.INFO_CHECK || this.setupVote || this._infoAdvanceTimer) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this.setupVote) this.enterBandDraft();
      });
    }
  }

  /**
   * The strategy draft (user playtest #4 item 4): ONE countdown — every turn has the same clock, BAND_TURN_SECONDS, and
   * m.public.deadline is the current turn's end (= draft.turnDeadline; the step header and the turn indicator show the
   * same number). No separate step cap: the turns bound the step (≤ (seats + skips) × turn). AI seats pick at once. A
   * turn that runs out takes the strategy the player has highlighted (g.bandFocus) while it is free, else the default
   * (timeoutBand). Solo, and any single-human match (soloUntimed): untimed. Solo also keeps seat order and has no skip.
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    let order = this.order.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    order = this.humansFirst(order);
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    this.draft = {
      order, idx: 0, picks: {}, skipsLeft: Object.fromEntries(order.map((pid) => [pid, skips])), untimed, turnDeadline: 0,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    };
    this.setDeadline(0);
    this.startDraftTurn();
    this.markPublic();
  }

  /**
   * The co-op room option 「AI 队友最后选择」 (this.aiPicksLast, GitHub #338): every human seat before every AI seat, each
   * group in the order the draft drew (a stable partition applied AFTER the shuffle — no extra random draw: the order
   * with the option off is unchanged, and with it on every random stream stands where it would without it; only the
   * picks made in the new order can differ). A human is any seat that is not an AI seat (room.addBot): under AI 托管,
   * disconnected or departed it still counts as a human. Used by the strategy draft and the 机变 draft
   * (MatchSpDraft.enterSpDraft).
   * @param {string[]} order playerIds in drawn order
   * @returns {string[]}
   */
  humansFirst(order) {
    if (!this.aiPicksLast) return order;
    const bot = (pid) => !!this.players.get(pid)?.isBot;
    return [...order.filter((pid) => !bot(pid)), ...order.filter(bot)];
  }

  draftTurn() {
    const d = this.draft;
    if (!d) return null;
    return d.order[d.idx] ?? null;
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn() {
    const d = this.draft;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (d.idx < d.order.length && d.picks[d.order[d.idx]]) d.idx++; // loop-cap: draft order
    if (d.idx >= d.order.length) {
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      return;
    }
    const token = ++this._turnToken;
    if (!d.untimed) {
      const ms = this.bandTurnMs();
      d.turnDeadline = this.sched.now() + ms;
      // the step's countdown IS the turn's (one number everywhere)
      this.deadline = d.turnDeadline;
      this._turnTimer = this.later(ms, () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        const pid = this.draftTurn();
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      });
    } else {
      d.turnDeadline = 0;
      this.deadline = 0;
    }
    const cur = this.players.get(this.draftTurn());
    if (cur && cur.botControlled) this.scheduleBandBot();
    this.markPublic();
  }

  /** An AI seat's (or an AI 托管 seat's) turn: it picks at once (user playtest #4 item 4 — nobody waits on the AI). */
  scheduleBandBot() {
    const token = this._turnToken;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
      const ps = this.players.get(this.draftTurn());
      if (!ps || !ps.botControlled) return;
      const fallback = () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        this._applyBand(ps, this.autoBandFor(ps), { dedupe: true });
      };
      // 外部 AI (botStrategy 'external', server/match/externalAI.js): a bot seat's strategy turn must be offered to the
      // controller as a `band` JOB — its legal actions are g.band / g.bandSkip / g.bandFocus (externalAI AI_ACTIONS.band),
      // and external-knowledge / external-ai assert the first job of such a room IS that draft. Without this call the seat
      // is assigned by the legacy heuristic and the controller never sees the draft at all. Built-in strategies have no
      // `decide` (botStrategyContract) and take the fallback immediately, so their behaviour is unchanged.
      if (this.bot.decide?.(this, ps, {
        kind: 'band', key: 'band',
        valid: () => this.phase === PHASE.BAND_DRAFT && token === this._turnToken
          && ps.alive && ps.botControlled && !this.draft?.picks[ps.playerId],
        complete: () => !!this.draft?.picks[ps.playerId],
        fallback,
      })) return;
      fallback();
    });
  }

  /**
   * The strategy an AI seat's band turn takes when no controller answers: the strategy's own `pickBand` (legacy unless a
   * plugin strategy overrides it) with the 队友已选 retry, then the first strategy nobody else holds.
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {string}
   */
  autoBandFor(ps) {
    const pick = typeof this.bot?.pickBand === 'function' ? () => this.bot.pickBand(this, ps) : () => botPickBand(this, ps);
    let id = pick();
    for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = pick();
    if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    return id;
  }

  /**
   * Whether `bandId` was already picked by another player of this draft. Research 09 §5 / DESIGN §14 corrections:
   * the strategy draft marks a teammate's pick as 队友已选 and it cannot be chosen again (co-op). The automatic
   * assignments — a turn that runs out and a departing seat — obey the same rule: see timeoutBand / defaultBand.
   */
  bandTaken(bandId, playerId) {
    const picks = this.draft?.picks || {};
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no teammate holds it, else the
   * first strategy of the mode (sortId order, gd.bandIds) that nobody else picked — never a duplicate (队友已选; the
   * client shows the same choice: public/js/screens/bandDraft.js timeoutBand). Solo drafts have no teammates, so it is
   * always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId)) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || def;
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the draft
   * screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no teammate holds
   * it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const f = this.draft && this.draft.focus instanceof Map ? this.draft.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    if (this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    if (!d || !ps || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn();
  }

  skipBand(ps) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(d.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (d.order.length - d.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    d.skipsLeft[ps.playerId]--;
    d.order.splice(d.idx, 1);
    // the skipper goes to the end; with 「AI 队友最后选择」 to the end of the humans still to pick — behind them, ahead of
    // the AI seats — and to the very end only when no other human is left to pass to [ASSUMED: the option's intent,
    // humans before AI, kept through a skip; no source, a remake option]
    let at = d.order.length;
    if (this.aiPicksLast) {
      for (let j = d.order.length - 1; j >= d.idx; j--) {
        if (!this.players.get(d.order[j])?.isBot) { at = j + 1; break; }
      }
    }
    d.order.splice(at, 0, ps.playerId);
    this.startDraftTurn();
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    for (const ps of this.order) {
      if (!this.draft.picks[ps.playerId]) {
        // one after another in seat order, so each default sees the ones assigned before it (no duplicates)
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    this.enterBattleCheck();
  }

  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.startRound(1), { silent: this.soloUntimed });
    this.markPublic();
  }

  /**
   * @param {number} r the round about to start
   * @param {(() => void) | null} [done] runs once the round has REALLY begun — after its `battleCheck` window closed
   *   (testCommands `g.test round`, which initializes the hidden round's team LP only then).
   */
  startRound(r, done = null) {
    // 炸惊模拟 惊变「追忆」(jibian_zhuiji) — `onRoundWouldStart`: a handler may REWRITE the round that is about to start
    // (its card turns R14 back into R10). Dispatched HERE, inside startRound, before `this.round` is written and before
    // `ps.startRound(r)` — the round number downstream is read from `this.round` / `ps.round`, and startRound has several
    // internal callers (bossRounds ×3, traitDraft, settle), so a dispatch at the call sites would miss some and would see
    // an already-applied round. `ev.round` is mutable; no handler (every mode, and any round without the card) leaves it
    // untouched and the match runs exactly as before.
    let roundNo = r;
    if (this.players && this.players.size) {
      const rev = { round: r };
      for (const ps of this.alivePlayers()) {
        try { this.dispatch(ps, 'onRoundWouldStart', rev); } catch (e) { this.reportError('dispatch onRoundWouldStart', e); }
      }
      if (Number.isInteger(rev.round) && rev.round > 0) roundNo = rev.round;
    }
    r = roundNo;
    // Plugin interaction windows (docs/PLUGINS.md §10b): every round — R1 through the boss rounds — opens its declared
    // `battleCheck` window *before* the round begins, and the round waits for it. The previous round's windows expire
    // here and a queued continuation is dropped, so a test-console round jump cannot resume the old step (offers.js
    // `_closeOffer` / `offersDispose`). Restored from 0.3.1 (commit 9131e788): the merge-era phases.js kept in this file
    // had lost the hook, so `battleCheck` windows never opened and a jump resumed stale continuations.
    for (const w of this.offerWin) this._closeOffer(w);
    this.offersDispose();
    const step = () => { this._startRoundAfterOffers(r); if (typeof done === 'function') done(); };
    if (this.openOfferWindow('battleCheck', r) !== 'open') { step(); return; }
    this._offerResume = step;
  }

  /** The round itself, once its `battleCheck` window (if the content set declares one) has closed. */
  _startRoundAfterOffers(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    // 业主 2026-10-19：「后续无限轮次的游戏速度改为 2 倍速并出现右上角倒计时处提示
    // （但倒计时依旧正常 1 倍速）」。
    // gameSpeed 只影响战斗推进（战斗时限 / 战斗时钟）；休整期的倒计时走的是
    // setDeadline 的秒数，与 gameSpeed 无关，所以倒计时仍是 1 倍速。
    // 业主 2026-10-20：「一倍速和之前的很快的速度一样，二倍速是一倍速两倍」——
    // 基准（1×）就是全模式的 GAME_SPEED=2，2× 是它的 4。R16 前固定 1×。
    // 业主 2026-10-21：按钮是**持久偏好**，只在作战里生效；回合开始（休整期/选人等）
    // 先回到基准速，进 COMBAT / 联防 / Boss 时再按偏好提速。
    if (this.isInfinite) this.gameSpeed = r < 16 ? GAME_SPEED : BASE;
    this.bossPhaseNo = 1;   // 双 Boss 阶段计数每轮重置（业主 2026-10-21）
    this.fields = [];
    this.watchers.clear();
    this.unitePlan = null;
    this.uniteResultView = null;
    // 多队（8 / 12 人房）: the round's three-stage 联防 state is per round (null in a 4-seat room, which never reads it)
    this.uniteStage = null;
    this.teamOutcomes = null;
    this.uniteCharge = null;
    this.crossPlan = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    this.roundBossAffix = null; // 超限 Boss 词缀：每轮重置，startFinalAssault 固化本轮的那一个
    // 炸惊模拟 规则14: the 敌方惊变 of this round (config enemyJibian.rounds: R1 / R6) is drawn BEFORE the wave, so the
    // wave side may read it; it is a no-op (no rng draw, no field) for every mode that is not ZHAJING.
    this.drawEnemyJibian(r);
    // …and the 隐秘惊变 of the Hidden Core's own prep (R15): one guaranteed hidden-rarity card + one ordinary card.
    this.drawHiddenJibian(r);
    // …and its Match-side wave plan (sim/content/ejibian.js matchJibianPlan: count multiplier / everything at once /
    // 入职测试 slime swap). null without drawn cards, so every official wave is built exactly as before.
    this.jibianPlan = this.gd.zhajing && Array.isArray(this.enemyJibianCards) && this.enemyJibianCards.length
      ? matchJibianPlan(this.rngWaves, r, this.enemyJibianCards)
      : null;
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    // 业主 2026-10-20：超限 R20/25/30… 是**真正的 Boss 轮** —— 进 FINAL_ASSAULT，
    // 共享血池、顶部血条、加时倒计时那套全都走。_planBossWaves 里已经是
    // buildInfiniteBossWave（按档位挑 Boss + 无限缩放），不再是「普通波次塞一只领袖」。
    const infBossRound = this.isInfinite && isInfiniteBossRound(r);
    const isBoss = r === this.gd.bossRound || r === this.gd.hiddenRound || infBossRound;
    if (isBoss) {
      this._planBossWaves();
    } else if (this.isInfinite && r >= 16) {
      this.wave = buildInfiniteNormalWave(this.gd, this.rngWaves, r, this._infiniteRoutes(r));
      // 超限·同盟：普通波次数量按人数放大（2 人 1.15×、3 人 1.3×、4 人 1.45×），单人不变
      if (this.mode === 'coop') {
        const mul = partyWaveCountMul(alive.length);
        for (const s of this.wave.spawns || []) {
          const n = Math.max(1, Number(s.count) || 1);
          s.count = Math.max(1, Math.round(n * mul));
        }
      }
    } else {
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, r, { plan: this.jibianPlan, jibian: this.enemyJibianCards });
      // 湮灭模拟: 蚀流 3+ 的 14/15、24/25 是高压精英关 (+25 % enemy count) and 不赦 adds its own share — the relic-side
      // scaler is a no-op for every official mode (no annihilation block, no relics owned).
      if (this.gd.annihilation) scaleWaveCounts(this, this.wave);
      // 超限的前 15 回合收敛到 3 种怪（业主 2026-10-17）；R16 起走上面的无限波次，不设上限。
      if (this.isInfinite) this.wave = capWaveKinds(this.wave, 3, this.rngWaves);
    }
    for (const ps of alive) ps.startRound(r);
    // 多队 (TWELVE_PLAYER_MODE §3): remember the ceiling each individual health bar's build reached this round
    if (this.multiTeam) for (const ps of this.order) trackHpMax(ps);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
    // eliminated humans and spectator seats scout the board of the player they follow through the round's prep, not
    // their own empty board (community report of 2026-10-06, item 56; MatchWatch._followScout)
    for (const ps of this._viewers()) this._followScout(ps);
  }

  /** Stable per-match pairs and their templates, generated before the prep preview / board validation. */
  /**
   * 这一张地图能走的路径（业主 2026-10-18：「怪的波次只选择这个地图能出的啊」）。
   *
   * 无限波次 / 无限 Boss 以前各自硬编码了三条坐标，全都在 NORMAL_RECT 之外、而且缺 start/end，
   * normalizeRoute 之后 start=null → 怪没有出生点 → R16+ 一只都不刷、回合空转直接进结算
   * （顺带把「完美作战」判成失败扣 LP）。这里改从 `gd.stage(stageId).groundPaths` 取真实路径：
   * 键形如 "9,10->9,2"，值是整条折线（含起终点），正好能拼成 { motion, start, end, checkpoints }。
   *
   * 飞行单位另走 FLY：没有现成的空中折线时，用地面路径的起终点直飞（原版飞行怪也是端点进出门）。
   * @returns {Array<{motion:string,start:number[],end:number[],checkpoints:Array}>}
   */
  _infiniteRoutes(round, rect = GEO.NORMAL_RECT) {
    const stage = this.stage || (this.stageId ? this.gd.stage(this.stageId) : null);
    const paths = (stage && (stage.groundPaths || stage.groundPathsWithDevices)) || {};
    const out = [];
    // 只用**落在这一块战场里**的路径（业主 2026-10-19：「路径对吗？」）。
    // stages.json 的 groundPaths 同时包含 0..20 列的联机路径与两半场路径，而单人普通战场是
    // NORMAL_RECT(9..12, 0..10)：不过滤就会刷出起点在 col 18 的怪 —— 出生点在图外，看起来就是
    // 「怪从莫名其妙的地方出来 / 走到地图外面」。
    // 这张图的战场矩形。超限是单人局，普通战场就是 NORMAL_RECT（9..12 行、0..10 列）。
    // 匹配层没有 this.rect（那是 Battle 的字段）；超限是单人局，普通战场的矩形就是 NORMAL_RECT。
    const inRect = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
      && p[0] >= rect.r0 - 0.5 && p[0] <= rect.r1 + 0.5
      && p[1] >= rect.c0 - 0.5 && p[1] <= rect.c1 + 0.5;
    for (const [key, pts] of Object.entries(paths)) {
      if (typeof key !== "string" || !Array.isArray(pts) || pts.length < 2) continue;
      const [from, to] = key.split("->");
      const s = from && from.split(",").map(Number);
      const e = to && to.split(",").map(Number);
      if (!s || !e || !s.every(Number.isFinite) || !e.every(Number.isFinite)) continue;
      // 先按地图筛：**整条折线**（起、终、每一个折点）都必须落在这块战场里。
      // 只查端点不够 —— 有一条路径可以两端都在场内、中间却绕到别的半场去。
      if (!inRect(s) || !inRect(e) || !pts.every(inRect)) continue;
      const mid = pts.slice(1, -1).filter(inRect);
      out.push({ motion: "WALK", start: [s[0], s[1]], end: [e[0], e[1]], checkpoints: mid });
    }
    if (!out.length) return [];
    // 飞行单位：沿最长的地面路径直飞（端点相同），数量够 spawn 轮流用
    const longest = out.reduce((a, b) => (b.checkpoints.length > a.checkpoints.length ? b : a), out[0]);
    // 飞行路径不能是「起点→蓝门」的一条直线 —— 那看起来就是直冲蓝门（业主 2026-10-19）。
    // 原版模板给飞行怪的是自己的折点（act1autochess_01 的 FLY: [9,9],[12,9],[12,7],[9,7]…），
    // 这里沿用地面的折点作为绕行路线，飞行怪照样在空中走 S 形。
    // 飞行路径：给两条（上/下各一条），这样出怪预览也能分出上下路
    const others = out.filter((x) => x !== longest);
    out.push({ motion: "FLY", start: longest.start, end: longest.end, checkpoints: longest.checkpoints.slice() });
    if (others.length) {
      const o = others[0];
      out.push({ motion: "FLY", start: o.start, end: o.end, checkpoints: o.checkpoints.slice() });
    }
    void round;
    return out;
  }

  /**
   * The boss rounds' pairing draw. The Final Assault keeps the salt `boss-pairs` (unchanged since 0.2.5); the Hidden Core
   * draws pairs and sides anew from `boss-pairs:<round>`, so its own prep and field see a new pairing (GitHub #845,
   * DESIGN §35.27, docs/META.md). The Hidden Core round clears the Final Assault's plan when it starts; a re-plan inside
   * the round (a departure during the prep) still starts from the pairs already planned, so the departed player's pair
   * stays whole and only the orphan is paired again (finalAssault.js pairPlayers `previous`).
   */
  _drawBossPairs() {
    const round = this.round;
    if (this.bossPairsRound !== round && round === this.gd.hiddenRound && round !== this.gd.bossRound) this.bossPairs = null;
    const groups = pairPlayers(this.alivePlayers(), createRng(deriveSeed(this.seed, bossPairSalt(this.gd, round))), this.bossPairs);
    this.bossPairs = groups.map((g) => g.map((p) => p.playerId));
    this.bossPairsRound = round;
    return groups;
  }

  _planBossWaves() {
    const r = this.round;
    const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness.
    const groups = this._drawBossPairs();
    this.bossWaves = groups.map((g) => ({
      players: g.map((p) => p.playerId),
      wave: (this.isInfinite && r >= 16)
        ? buildInfiniteBossWave(this.gd, this.rngWaves, r, this._infiniteRoutes(r, GEO.BOSS_RECT))
        : buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1, plan: this.jibianPlan, jibian: this.enemyJibianCards }),
    }));
  }

  /**
   * 玩家自己切换战斗倍速（业主 2026-10-20）：1 = 常速，2 = 双倍。
   * 只改战斗推进（fields.js 的 tick 倍率），倒计时按剩余真实时间等比例换算，
   * 这样切倍速不会凭空多出或少掉时间。
   * @param {object} ps
   * @param {number} speed
   */
  setCombatSpeed(ps, speed) {
    if (!this.isInfinite) return fail(ERR.WRONG_PHASE);
    // 开关上的 1× / 2× 是**相对基准**的说法：1× = 全模式的 GAME_SPEED（原来就这么快），
    // 2× = 它的两倍。内部 gameSpeed 仍是绝对倍率。
    const pref = speed === 2 ? 2 : 1;
    this.infiniteSpeedPref = pref;   // 偏好：之后的每一场作战都按它跑
    // 只在作战阶段立即生效（业主 2026-10-21）：「二倍速按钮按下就一直在之后的作战中生效，
    // 备战时保持原速」。休整期 / 选人 / 结算里点它只改偏好，不动当前 gameSpeed。
    const inBattle = this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE || this.phase === PHASE.FINAL_ASSAULT;
    if (inBattle) {
      const old = this.gameSpeed || BASE;
      this.gameSpeed = BASE * pref;
      // 随切随变（业主 2026-10-26）：按已推进的游戏秒重算剩余倒计时
      if (typeof this._reclockForSpeed === 'function') this._reclockForSpeed(old, this.gameSpeed);
    }
    void ps;
    this.markPublic();
    return OK;
  }

  afterRoundStart() {
    // 超限「词条」（业主 2026-10-31）：R3 / R8 的 LC 三选一，排在同一回合的机变之前 ——
    // 选完由 finishRelicDraft 接回机变（R3 有机变；R8 没有，直接进整备）。
    // 无限段的那一次不走这里（Boss 轮结束的时点在 bossRounds.afterSettle 里直接切入），
    // 但 roundsDone 也挡住了重复触发，所以这条分支对无限段是幂等的。
    if (wantsRelicDraft(this, this.round) && this.enterRelicDraft(this.round)) return;
    // 超限：通过 Boss 的下一回合先开词条抉择（业主 2026-10-18）；普通模式完全不走这里
    // 词条抉择已经在 afterSettle 里开过了（Boss 轮结束的时点），这里不再重复
    if (this._traitDoneRound !== this.round - 1 && wantsTraitDraft(this, this.round)) { this.enterTraitDraft(this.round); return; }
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.beforePrepOffers();
  }

  /**
   * 官方回合开场与它的抽卡／机变先走完，**只有「进入整备」等插件窗口**（上游 phases.js 的同名方法）。
   *
   * 本地这份 phases.js 是合并时保留下来的旧一代，里面没有这个方法，而 spDraft.js（上游一代）
   * 的 finishSpDraft() 调的正是它 —— 缺了它，**任何含机变轮的局都会卡死在 SP_DRAFT**
   * （Draft 选完、spTurn() 返回 null，但阶段永远不推进），实测 R3 就停。
   */
  beforePrepOffers() {
    this.sp = null;
    const step = () => this.enterPrep();
    if (this.openOfferWindow('prep', this.round) !== 'open') { step(); return; }
    this._offerResume = step;
  }

  /**
   * 炸惊模拟 规则14 — 敌方惊变. ONE card is drawn at the START of each configured round (config `enemyJibian.rounds`:
   * 第 1 与第 6 回合), kept for the rest of the match and published through m.public as a reveal (`flickerMs` then
   * `resultMs`, MatchViews). Every later battle spec carries the drawn ids in `flags.enemyJibian`, and
   * sim/content/ejibian.js turns them into the actual enemy-side effects — the match never applies them itself.
   * Gated on `gd.zhajing` + the mode's own `enemyJibian` block, so no other mode draws, consumes rng or publishes.
   * @param {number} round
   * @returns {{ id: string, name: string, desc: string, rarity: string|null } | null}
   */
  drawEnemyJibian(round) {
    if (!this.gd.zhajing) return null;
    const ej = this.gd.enemyJibian();
    if (!ej || !ej.pool.length || !ej.rounds.includes(Number(round))) return null;
    if (!(this.enemyJibianRoundsDone instanceof Set)) this.enemyJibianRoundsDone = new Set();
    if (this.enemyJibianRoundsDone.has(Number(round))) return null;
    this.enemyJibianRoundsDone.add(Number(round));
    const rarity = weightedPick(this.rngWaves, ej.rarityWeights);
    const ofRarity = ej.pool.filter((c) => c && c.rarity === rarity);
    const list = ofRarity.length ? ofRarity : ej.pool;
    const pick = list[Math.min(list.length - 1, Math.floor(this.rngWaves() * list.length))];
    const id = pick && (pick.effectId || pick.id || pick.key);
    if (!id) return null;
    const card = { ...jibianCard(this.gd, pick, rarity), id };
    if (!Array.isArray(this.enemyJibianCards)) this.enemyJibianCards = [];
    this.enemyJibianCards.push(id);
    // every card drawn this match, for the 已选惊变 panel's enemy page (two cards are in force at once: R1 and R6)
    if (!Array.isArray(this.enemyJibianList)) this.enemyJibianList = [];
    this.enemyJibianList.push({
      round: Number(round), id, name: card.name, desc: card.desc, rarity: card.rarity ?? rarity ?? null,
      ...(card.flavor ? { flavor: card.flavor } : null),
    });
    this.enemyJibian = { round: Number(round), rarity: card.rarity ?? rarity ?? null, card };
    this.markPublic();
    return card;
  }

  /**
   * 炸惊模拟 · 隐秘惊变 (owner 2026-10-24): the extra draw at the Hidden Core's own prep (`round === gd.hiddenRound`,
   * R15 for 炸惊). TWO cards land at once and both are in force for that fight:
   *   ① ONE guaranteed card of the `hidden` rarity from `enemyJibian().hidden.pool` (the "保底隐秘卡" — e.g. 打个响指),
   *   ② PLUS one ordinary card drawn with the normal pool / rarity weights.
   * Both are appended to `enemyJibianCards` (so the battle spec's `flags.enemyJibian` carries them) and to
   * `enemyJibianList` with `hidden: true`, so the 已选惊变 panel's enemy page can group them. The hidden card's MATCH-side
   * effect is applied immediately by engine-cards' `applyHiddenMatchCards` (打响指 halves every bond's layers, 诛伏赐死
   * zeroes one bond match-wide) — this method never touches layers itself.
   * Gated on `gd.zhajing` and the mode's `enemyJibian.hidden.enabled`, so every other mode draws nothing, consumes no rng
   * and publishes no field.
   * @param {number} round
   * @returns {{ hidden: any, ordinary: any } | null}
   */
  drawHiddenJibian(round) {
    if (!this.gd.zhajing) return null;
    const ej = this.gd.enemyJibian();
    const hidden = ej && ej.hidden;
    if (!hidden || hidden.enabled === false || !hidden.pool.length) return null;
    const r = Number(round);
    if (r !== this.gd.hiddenRound) return null;
    if (!(this.enemyJibianRoundsDone instanceof Set)) this.enemyJibianRoundsDone = new Set();
    const key = `hidden:${r}`;
    if (this.enemyJibianRoundsDone.has(key)) return null;
    this.enemyJibianRoundsDone.add(key);

    /** Draw one entry of `pool` (a card of `rarity` when the pool has any, else the whole pool). */
    const drawOne = (pool, rarity) => {
      const ofRarity = rarity ? pool.filter((c) => c && c.rarity === rarity) : [];
      const list = ofRarity.length ? ofRarity : pool;
      const pick = list[Math.min(list.length - 1, Math.floor(this.rngWaves() * list.length))];
      const id = pick && (pick.effectId || pick.id || pick.key);
      return id ? { id, card: { ...jibianCard(this.gd, pick, rarity), id }, rarity: rarity ?? null } : null;
    };

    const guarantee = drawOne(hidden.pool, 'hidden');
    if (!guarantee) return null;
    const ordinaryRarity = weightedPick(this.rngWaves, ej.rarityWeights);
    const ordinary = drawOne(ej.pool, ordinaryRarity);

    if (!Array.isArray(this.enemyJibianCards)) this.enemyJibianCards = [];
    if (!Array.isArray(this.enemyJibianList)) this.enemyJibianList = [];
    const record = (entry, isHidden) => {
      this.enemyJibianCards.push(entry.id);
      this.enemyJibianList.push({
        round: r, id: entry.id, name: entry.card.name, desc: entry.card.desc,
        rarity: entry.card.rarity ?? entry.rarity ?? null, hidden: isHidden,
        ...(entry.card.flavor ? { flavor: entry.card.flavor } : null),
      });
    };
    record(guarantee, true);
    if (ordinary) record(ordinary, false);
    this.enemyJibian = {
      round: r, rarity: guarantee.card.rarity ?? 'hidden', card: guarantee.card, hidden: true,
      ...(ordinary ? { ordinaryCard: ordinary.card } : null),
    };
    // The hidden card acts on the MATCH the moment it is drawn (layers), not in the battle spec.
    try { applyHiddenMatchCards(this, [guarantee.id]); } catch (e) { this.reportError('applyHiddenMatchCards', e); }
    this.markPublic();
    return { hidden: guarantee.card, ordinary: ordinary ? ordinary.card : null };
  }
}
