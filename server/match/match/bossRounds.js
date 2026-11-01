// server/match/match/bossRounds.js — Match methods: the Final Assault / Hidden Core (the rules:
// server/match/finalAssault.js) — the boss fields and the shared pool; client-side boss fields (plausibility budgets on
// the field clock, cumulative credits, handovers, the boss clock, the end: pool 0 → victory, team LP 0 → defeat);
// b.pool; the merged team LP and its shares; the overtime drain; bounties after a boss field; then the Hidden Core or
// RESULT.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { buildBossWave, bountySpawns } from '../waves.js';
import { bossPoolHp, SharedBossPool, CreditPool, hiddenEligible, BOSS_HIT_STEPS } from '../finalAssault.js';
import { FieldRunner, HeadlessPacer, syntheticResult, BOSS_SILENCE_MS, CATCHUP_TICKS_PER_INTERVAL , GAME_SPEED } from '../fields.js';
import { FLOW_TICKER_PRIORITY, BOSS_CLOCK_MS, DELAYS } from './common.js';
import { OK, fail } from './common.js';
import { ERR } from '../../../shared/constants.js';
import { wantsTraitDraft } from './traitDraft.js';
import { wantsRelicDraft } from './relicDraft.js';
import { buildInfiniteBossWave, isInfiniteBossRound } from '../infiniteWaves.js';
import { partyBossHpMul } from '../../../shared/infiniteMode.js';

/** 双 Boss 第二阶段的预警时长（业主 2026-10-21）：2.6 秒全屏红色过场。 */
export const BOSS_PHASE2_WARN_MS = 2600;

/**
 * 超限风险契约（业主 2026-10-26）：Boss 轮前的 PREP 三选一，加码换资源。
 * 只影响**本轮** Boss 波；不选就是常规开战。
 */
export const BOSS_CONTRACTS = Object.freeze([
  Object.freeze({ id: 'elite', name: '加一只精英', text: 'Boss 轮额外出现 1 只随机精英敌人。', reward: '资金 +2' }),
  Object.freeze({ id: 'time', name: '限时 90 秒', text: 'Boss 轮时限缩短到 90 秒，超时按漏怪处理。', reward: '资金 +2' }),
  Object.freeze({ id: 'aspd', name: '敌方攻速 +20%', text: 'Boss 与随从攻击力 +20%，持续整轮。', reward: '重抽 +1' }),
]);

/** b.pool broadcasts at most this often (ms). */
const POOL_MIN_GAP_MS = 250;
/**
 * Final Assault / Hidden Core under client-side combat: m.public (boss HP, team LP, field progress) at most this often
 * (ms) — b.pool (≤ 4 Hz) already carries the exact pool / team LP, so a boss b.progress never re-marks the whole
 * public state.
 */
const BOSS_PUBLIC_MS = 1000;
/** How long the match waits for a boss field's b.result after it forced the end (real ms, × timerScale). */
const BOSS_RESULT_GRACE_MS = 6000;
/**
 * Plausibility of a boss field's client reports (b.progress bossDmg / leaks, the b.result damage), on the SERVER's
 * field clock — so no single frame decides the Final Assault: the credited pool damage of one field stays ≤ the whole
 * pool per BOSS_MIN_CLEAR_GS game seconds (20 % of the pool per game second; the balance model's fastest mean kills
 * take ≈ 18–20 s at ≈ 5 %/s per field, docs/BALANCE.md §3), the credited LP cost ≤ BOSS_LP_BURST + BOSS_LP_PER_GS per
 * game second (a leader's "扣除所有目标生命" comes after ≥ 200 s). Reports are cumulative: what exceeds the budget is
 * credited later as the budget grows (the boss clock re-applies the latest report), never lost — a 'cleared' b.result
 * whose report covers the pool waits for it too (`heldResult`; 999-layer kills take 2–4 game s), it is not handed over.
 */
const BOSS_MIN_CLEAR_GS = 5;
const BOSS_LP_BURST = 10;
const BOSS_LP_PER_GS = 1;

export class MatchBoss {
  /**
   * 合并团队生命值：把每位存活玩家的当前 LP 加起来作为团队血池，并记下各自进场时的 LP
   * （结算按份额分配用 `ps.lpAtFinal`）。
   *
   * 上游把它抽成方法，`testCommands.js` 的「跳到隐秘核心」也要调它 —— 本地这份之前只有内联写法，
   * 于是 `g.test` 的 hidden 跳轮会抛 `this._openTeamLp is not a function`。
   */
  _openTeamLp() {
    const alive = this.alivePlayers();
    this.teamLp = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
    for (const ps of alive) ps.lpAtFinal = Math.max(0, ps.lp);
  }

  startFinalAssault(hidden) {
    const alive = this.alivePlayers();
    if (!alive.length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    this.phase = hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT;
    this.lastResults = new Map();
    if (!hidden) this._openTeamLp();
    // 超限的 Boss 轮由 buildInfiniteBossWave 按档位挑 Boss（R20→最弱档、R25→次档…），
    // 而 this.bossId 是开局时定的那一个（普通模式的 R14 领袖）。两者不一致会让
    // 「场上刷出来的 Boss」和「血池/血条对应的 Boss」是两个不同的东西 —— 业主 2026-10-19
    // 「进入第 20 轮次，boss 没有正确加载」就是这个。超限时以波次里的那个 Boss 为准。
    const waveBoss = this.isInfinite && !hidden && this.bossWaves && this.bossWaves[0] && this.bossWaves[0].wave
      ? (this.bossWaves[0].wave.primaryBoss || null) : null;
    const bossId = hidden ? this.hiddenBossId : (waveBoss || this.bossId);
    // 超限 Boss 词缀（业主 2026-10-26）：固化本轮的那一个，第二阶段重开时复用
    const roundAffix = !hidden && this.isInfinite && this.bossWaves && this.bossWaves[0] && this.bossWaves[0].wave
      ? (this.bossWaves[0].wave.affix || null) : null;
    if (roundAffix) this.roundBossAffix = roundAffix;
    // BOSS_HIT tickers ("对敌方领袖造成的伤害超过20% / 50% / 80%"): the player's damage to THIS leader over its pool —
    // the pool's own per-player tally, one pool per boss round. stats.bossDamage (the result's 领袖伤害) adds up both
    // rounds, so it would credit the Final Assault's damage to the hidden leader ("隐藏boss还没打就出了50%播报").
    const hitSteps = new Map();
    // 只有超限局把 round 传下去（→ bossPoolHp 才乘 Boss 血量成长）；普通模式 round 为 undefined，行为不变。
    // 超限·同盟（业主 2026-10-26）：Boss 血池按在场人数放大（2 人 1.6×、3 人 2.2×、4 人 2.8×）；单人恒为 1
    const partyHp = this.isInfinite && this.mode === 'coop' ? partyBossHpMul(alive.length) : 1;
    const pool = new SharedBossPool(bossPoolHp(this.gd, bossId, alive.length, this.isInfinite ? this.round : undefined) * partyHp, {
      onHit: (pid, dmg) => {
        const ps = this.players.get(pid);
        if (!ps) return;
        ps.stats.bossDamage += dmg;
        const share = (pool.byPlayer.get(pid) || 0) / pool.maxHp;
        const done = hitSteps.get(pid) || 0;
        let reached = done;
        BOSS_HIT_STEPS.forEach((s, i) => { if (share >= s) reached = Math.max(reached, i + 1); });
        if (reached > done) {
          hitSteps.set(pid, reached);
          this.tickerFor('BOSS_HIT', [ps.name], { playerId: pid, param: String(BOSS_HIT_STEPS[reached - 1]) });
        }
      },
    });
    this.bossPool = pool;
    const groups = this._drawBossPairs();
    const reuse = this.bossWaves && this.bossWaves.length === groups.length && this.bossWaves.every((w, i) => w.players.join() === groups[i].map((p) => p.playerId).join());
    this.fields = groups.map((g, i) => {
      const solo = this.isSolo || g.length === 1;
      const wave = reuse ? this.bossWaves[i].wave : buildBossWave(this.gd, this.rngWaves, this.factions, this.round, { bossId, solo, plan: this.jibianPlan, jibian: this.enemyJibianCards });
      // one spawn list per field, shared by the field's players' onBattleStart handlers (edit it in place)
      const spawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
      // 鸭爵「神秘顾客」(#839): the draw reads this copy — the field's wave before the bounties, exactly what the bot
      // rehearsal passes (bot.js bossCandidateOpts). Bounty units are per player, so drawing from the list below would
      // give each player of the pair a different count / unit / enemy.
      const waveSpawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
      // bounties with battles left (a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES) follow their player into the
      // boss field, on the player's half
      g.forEach((ps, j) => {
        for (const b of bountySpawns(this.gd, this.round, wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: j === 0 ? 'L' : 'R' })) spawns.push(b);
      });
      const inputs = g.map((ps, j) => {
        const input = ps.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
        input.lpForBoss = this.teamLp;
        // `side` + `routes`: the player's half of a pair field (spawn-list edits for one player, e.g. 鸭爵's swap)
        const ev = { input, kind: hidden ? 'hidden' : 'boss', round: this.round, spawns, waveSpawns, routes: wave.routes, side: g.length > 1 ? (j === 0 ? 'L' : 'R') : null };
        this.dispatch(ps, 'onBattleStart', ev);
        return ev.input && typeof ev.input === 'object' ? ev.input : input;
      });
      const fieldId = `b${i + 1}`;
      // 炸惊模拟「锻造器」: a boss / hidden field is shared by the pair, so the summary travels per player
      // (`flags.forgeByPlayer`); null when nobody forged, which leaves the flags object exactly as it was.
      const forgeByPlayer = this._forgeByPlayer(g.map((p) => p.playerId));
      const bopts = {
        seed: deriveSeed(this.seed, `${fieldId}:${this.round}`),
        kind: hidden ? 'hidden' : 'boss',
        modeId: this.modeId,
        round: this.round,
        stageId: this.stageId,
        rect: { ...GEO.BOSS_RECT },
        timeLimit: Infinity,
        players: inputs,
        spawns: this._sanitizeSpawns(spawns),
        routes: wave.routes,
        sharedBoss: this.bossPool,
        // the round's enemy effects for the leaders' mid-fight summons (server/sim/content/bosses.js summonMods)
        // 湮灭模拟: the mode's own flags — a boss/hidden field carries the 致命级 terrain and the chaotic targeting, no fog
        // 炸惊模拟: layer gains stay ON during a boss / hidden field (`!!gd.zhajing` — the reference build's rule); every
        // other mode keeps the official `false`. flags.layerGainsEnabled gates Battle.addLayers and the settle bound.
        flags: { layerGainsEnabled: !!this.gd.zhajing, ...this.gd.dp, enemyScale: this.gd.enemyScale(this.round), ...(this.isInfinite ? { overlimit: true } : {}), ...(this.traitFlagBundle ? this.traitFlagBundle() : {}), ...(this.gd.annihilation ? this.gd.annihilationFlags(hidden ? 'hidden' : 'boss', this.round) : null), ...(this.gd.zhajingFlags ? this.gd.zhajingFlags() : null), ...(this.enemyJibianCards && this.enemyJibianCards.length ? { enemyJibian: this.enemyJibianCards.slice() } : null), ...(forgeByPlayer ? { forgeByPlayer } : null) },
        fieldId,
        enemyOverrides: wave.overrides,
        waveId: wave.templateId,
        bossId,
      };
      if (this.clientCombat) return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), opts: bopts, battle: null, live: true };
      const battle = this.newBattle(bopts);
      try {
        battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
        // leader "扣除目标生命" effects (boss_7 Doom, 斥退 …: server/sim/content/bosses.js lpLoss) hit the team pool
        battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
      } catch (e) { this.reportError('boss leak hook', e); }
      return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), battle, live: true };
    });
    // 超限：Boss 轮也按玩家的持久偏好提速（业主 2026-10-21）；休整期仍是基准速。
    if (this.isInfinite) this.gameSpeed = GAME_SPEED * (this.infiniteSpeedPref || 1);
    this.overtimeApplied = 0;
    // HUD: the boss level's countdown (maxPlayTime, 120 real s — the battle goes on past it) and the moment the
    // overtime drain starts (150 real s), both on the field clock
    // 业主 2026-10-20：
    //   · 倒计时显示的永远是关卡自己的秒数（120 秒），不随 1×/2× 变
    //   · 扣血（overtime / bossTurnHpReduceTime 150 秒）也必须按**真实秒**走 ——
    //     以前超限只改了倒计时、没改扣血，扣血仍按「游戏秒」算，于是 2× 时
    //     要等 300 秒真实时间才开始扣血，玩家看到的是「倒计时正常但扣血时间不对」。
    // 现在超限把两者都按真实秒：deadline = now + 120 s，overtimeAt = now + 150 s。
    // 业主 2026-10-26：Boss 轮的倒计时与扣血也按当前倍速折算（与普通战斗同一规则）。
    // 之前超限固定按真实秒，2× 时 120 秒倒计时却只打 60 秒的战斗，结算/扣血都偏晚。
    // 2026-10-30（OVERLIMIT.md F2）：超限 R20/25/30… 的 120 s 以前拿不到（gd.overlimit 死开关，levelTime=null），
    // 所以 deadline 一直是 0；现在由 gd.bossLevelTime 的超限分支给出（R20=120、R25=130、R30=140…）。
    const clockDiv = this.gameSpeed;
    const onClock = (realS) => this.sched.now() + Math.round(((realS * this.gd.combatTimeScale) / clockDiv) * 1000);
    const levelTime = this.gd.bossLevelTime(this.round);
    /**
     * 超限 R20/25/30… 的关卡秒数是 gamedata.bossLevelTime 的**超限分支合成**出来的（R20=120 s、每档 +10 s），
     * config 里没有这些回合行。普通 R14/R15（以及任何非超限局）都不是合成时钟，行为逐字节不变。
     * 加时起点仍按官方 bossOvertimeAfter（150 真实秒）：修倒计时之前（levelTime 为 null）扣血就是 150 s 开始的，
     * 这里不顺手把它提前 30 秒 —— 本次只补倒计时，不动压力。
     */
    const synthBossClock = this.isInfinite && isInfiniteBossRound(this.round);
    // 记录本场“游戏秒”基准，切倍速时由 _reclockForSpeed 用剩余游戏秒重算。
    // _reclockForSpeed 的 remaining 是**游戏秒**：合成的 Boss 时钟要先把真实秒换算成游戏秒，
    // 否则切 2× 时会把 120 s 的倒计时按混用单位缩到 30 s（以前 levelTime 为 null，这条分支根本走不到）。
    this._combatLimit = synthBossClock ? levelTime * this.gd.combatTimeScale : levelTime;
    this._combatStartAt = this.sched.now();
    this._bossClockDiv = clockDiv;
    // Maintainer 2026-10-10: only teams with an AI teammate keep the extra grace after the visible countdown.
    // Freeze this choice for the fight; a disconnect / host transfer cannot change its LP clock midway.
    const team = this.order.filter((p) => !p.left);
    this.bossOvertimeStartReal = team.length > 1 && team.some((p) => p.isBot)
      ? this.gd.bossOvertimeAfterReal
      : synthBossClock ? this.gd.bossOvertimeAfterReal : (levelTime || this.gd.bossOvertimeAfterReal);
    this.deadline = this.sched.instant || !levelTime ? 0 : onClock(levelTime);
    this.overtimeAt = this.sched.instant ? 0 : onClock(this.bossOvertimeStartReal);
    // 切换倍速时重算扣血时刻：保留“扣血相对关卡结束的额外游戏秒”（合成时钟同样按游戏秒记）
    this._overtimeGapGt = Math.max(0, (this.bossOvertimeStartReal - (levelTime || 0)) * (synthBossClock ? this.gd.combatTimeScale : 1));
    if (this.clientCombat) { this._startFinalClient(hidden); return; }
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._bossTick(runner),
      onDone: (runner) => this._finalDone(runner, hidden),
    });
    this.runner.start();
  }

  _startFinalClient(hidden) {
    const pool = this.bossPool;
    const recs = this.fields.map((x) => this._ccField({ fieldId: x.fieldId, kind: x.kind, players: x.players, opts: x.opts, boss: { poolHp: pool.hp, poolMax: pool.maxHp } }));
    this._finalEnding = null;
    this._bossStartAt = this.sched.now();
    this.watchers.clear();
    if (!recs.some((f) => this._authorityFor(f))) {
      // nobody to simulate on a client: the server runs every boss field (FieldRunner, no streaming)
      this.fields = recs;
      for (const f of recs) {
        f.mode = 'server';
        // a CreditPool with nothing acknowledged credits everything; it counts this field's damage for b.pool `acked`
        f.credit = new CreditPool(pool);
        f.battle = this._specBattle(f.spec, { sharedBoss: f.credit });
        try {
          f.battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
          f.battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
        } catch (e) { this.reportError('boss leak hook', e); }
      }
      this._watchBossFields(recs);
      this.markPublic();
      this.runner = new FieldRunner(this, recs, {
        onTick: (runner) => this._bossTick(runner),
        onDone: (runner) => this._finalDone(runner, hidden),
        emit: false,
      });
      this.runner.start();
      return;
    }
    this._launch(recs);
    this._watchBossFields(recs);
    this.markPublic();
    this._broadcastPool(true);
    this._bossClockOn = true;
    this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
  }

  /** The most shared-pool damage a boss field's client reports may have credited by now (server field clock). */
  _bossDmgBudget(f) {
    return this.bossPool ? (this.bossPool.maxHp * this._fieldElapsed(f)) / BOSS_MIN_CLEAR_GS : 0;
  }

  /** The most team LP a boss field's client reports may have cost by now (server field clock). */
  _bossLpBudget(f) {
    return BOSS_LP_BURST + BOSS_LP_PER_GS * this._fieldElapsed(f);
  }

  /**
   * A boss field's shared-pool damage, as reported cumulatively by its client (`by`: per player) — credited up to the
   * plausibility budget of the field clock; the rest is credited by later reports / the boss clock (`bossReported`).
   */
  _creditBoss(f, cum, by) {
    const pool = this.bossPool;
    const reported = Number(cum);
    // the team LP ran out first: the run failed at that moment (PRTS "…使目标生命值扣除至0，则无视倒计时直接失败"), so
    // damage reported afterwards — in flight, or rounded up in the final b.result — changes nothing (user playtest #6)
    if (!pool || !Number.isFinite(reported) || this._finalEnding === 'forced') return;
    if (!f.bossReported || reported > f.bossReported.cum) f.bossReported = { cum: reported, by: by && typeof by === 'object' ? { ...by } : null };
    const c = Math.min(reported, this._bossDmgBudget(f));
    if (!(c > f.bossAcked)) return;
    const delta = c - f.bossAcked;
    f.bossAcked = c;
    let attributed = 0;
    if (by && typeof by === 'object') {
      for (const pid of f.players) {
        const v = Number(by[pid]);
        const prev = f.bossBy[pid] || 0;
        if (!Number.isFinite(v) || v <= prev) continue;
        const d = Math.min(delta - attributed, v - prev);
        if (d > 0) { f.bossBy[pid] = prev + d; pool.damage(pid, d); attributed += d; }
      }
    }
    if (delta - attributed > 0) {
      const pid = by ? null : f.players[0];
      if (pid) f.bossBy[pid] = (f.bossBy[pid] || 0) + (delta - attributed);
      pool.damage(pid, delta - attributed);
    }
  }

  /** A boss field's LP cost (leaks × lpr + leader LP effects): `cumulative` totals from its client, deltas from the server run. */
  _creditLp(f, amount, cumulative = false) {
    let n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    if (cumulative) {
      // a client's cumulative report: credited up to the field clock's plausibility budget (the rest later)
      if (n > f.lpReported) f.lpReported = n;
      n = Math.min(n, this._bossLpBudget(f));
      if (n <= f.lpAcked) return;
      const d = n - f.lpAcked;
      f.lpAcked = n;
      this._teamLpLoss(d);
      return;
    }
    const before = f.lpCum;
    f.lpCum += n;
    const credit = Math.max(0, f.lpCum - Math.max(before, f.lpAcked));
    if (credit > 0) this._teamLpLoss(credit);
  }

  /**
   * The authority's per-player split of the LP its field's enemy leaks cost (b.progress `leaksBy`: cumulative, per player,
   * the leader's own LP effects not in it) — the highest value seen per player. The field's perfect-payout bounties are
   * paid only where the final result agrees with it (`_bossLeaksAgree`).
   */
  _noteLeaksBy(f, by) {
    if (!by || typeof by !== 'object') return;
    if (!f.leaksBy) f.leaksBy = {};
    for (const pid of f.players) {
      const v = Number(by[pid]);
      if (Number.isFinite(v) && v > (f.leaksBy[pid] || 0)) f.leaksBy[pid] = v;
    }
  }

  /**
   * Whether a boss field's b.result may be believed about one player's leaks before a perfect-payout bounty pays: the
   * result comes from a client (a server run is the truth itself) and does not contradict what that client reported while
   * it fought — LP it asked the team to pay must have been split into the players' own leaks and the leader's effects
   * (b.progress `leaksBy`; reports without the split explain nothing), and the player's leaked list must show at least the
   * leak LP reported for it (a leak is never moved to the other seat or dropped). A modified authority can still lie in
   * both; what the server cannot see it cannot check (the boss path never re-simulates).
   */
  _bossLeaksAgree(f, res, pid) {
    if (!f.cc || f.resultSource !== 'client') return true;
    if (f.lpReported > 1e-9 && !f.leaksBy) return false;
    const shown = ((res.perPlayer[pid] && res.perPlayer[pid].leaked) || []).reduce((n, l) => n + (Number.isFinite(l.lpr) && l.lpr >= 0 ? l.lpr : 1), 0);
    return shown + 1e-6 >= ((f.leaksBy && f.leaksBy[pid]) || 0);
  }

  /** The server runs a boss field in real time (no client left): credits only what exceeds the client's reports. */
  _bossServerRun(f) {
    const credit = new CreditPool(this.bossPool, { acked: f.bossAcked, ackedBy: f.bossBy });
    const battle = this._specBattle(f.spec, { sharedBoss: credit });
    f.battle = battle;
    f.credit = credit;
    f.lpCum = 0;
    try {
      battle.on('enemyLeak', (ctx) => { const e = ctx && ctx.enemy; if (e) this._creditLp(f, Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1); }, { priority: -1000, owner: 'match' });
      battle.on('lpLoss', (ctx) => this._creditLp(f, ctx && ctx.amount), { priority: -1000, owner: 'match' });
    } catch (e) { this.reportError('boss leak hook', e); }
    if (!this.pacer) this.pacer = new HeadlessPacer(this);
    const entry = this.pacer.add({
      battle,
      onDone: () => {
        if (f.done) return;
        let res = null;
        try { res = battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        this._fieldDone(f);
        this._checkFinalEnd();
      },
      onTick: () => this._checkFinalEnd(),
    });
    const gt = this._fieldElapsed(f);
    // the fast-forward to the field clock is spread over the pacing intervals on a real host (virtual time: at once)
    if (gt > 0 && !entry.done) this.pacer.skipTo(entry, gt, { budgetTicks: this.sched.virtual ? Infinity : CATCHUP_TICKS_PER_INTERVAL });
  }

  /**
   * A boss field's authority left, went silent or sent an implausible result (`demote`: never its authority again):
   * its partner (a replica already running) takes over, else the server.
   */
  _bossHandover(f, why, { demote = false } = {}) {
    if (f.done || f.mode !== 'client' || f.heldResult) return; // a held 'cleared' result is in: nothing left to run
    const prev = f.authority;
    if (demote && prev) f.demoted.add(prev);
    const next = this._authorityFor(f, prev);
    if (next) {
      f.authority = next;
      f.lastProgressAt = this.sched.now();
      if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
      this._sendStart(next, f);
      return;
    }
    this._runOnServer(f, why);
  }

  _bossClockTick() {
    this._bossClock = null;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.paused) return; // re-armed by _resume
    const now = this.sched.now();
    this._applyOvertime(((now - this._bossStartAt) / 1000) * this.gameSpeed);
    for (const f of this.fields) {
      // reports held back by the plausibility budget are credited as the field clock advances
      if (f.cc && !f.done && f.mode === 'client') {
        if (f.bossReported && f.bossReported.cum > f.bossAcked) this._creditBoss(f, f.bossReported.cum, f.bossReported.by);
        if (f.lpReported > f.lpAcked) this._creditLp(f, f.lpReported, true);
      }
      if (f.cc && !f.done && f.mode === 'client' && !f.heldResult && now - f.lastProgressAt > BOSS_SILENCE_MS) {
        this.log.info?.(`[match ${this.roomCode}] ${f.fieldId}: no progress from ${f.authority} — handing the field over`);
        this._bossHandover(f, 'silent');
      }
    }
    this._checkFinalEnd();
    this._broadcastPool(false);
    if (this.fields.some((f) => f.cc && !f.done)) this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    else this._bossClockOn = false;
  }

  /** Pool depleted → victory; team LP 0 → defeat: every boss field is ended. */
  _checkFinalEnd() {
    if (this._finalEnding || !this.bossPool || !this.fields.some((f) => f.cc)) return;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.bossPool.hp <= 0) this._endFinal('cleared');
    else if (this.teamLp != null && this.teamLp <= 0) this._endFinal('forced');
  }

  _endFinal(reason) {
    if (this._finalEnding) return;
    this._finalEnding = reason;
    this._broadcastPool(true);
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      if (f.mode === 'server' && f.battle) {
        try { f.battle.forceEnd('forced'); } catch (e) { this.reportError('boss forceEnd', e); }
        let res = null;
        try { res = f.battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        continue; // _fieldDone below (after every field was told)
      }
      for (const pid of this._humansShowing(f)) this.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason });
      if (f.heldResult) {
        // its authority already reported 'cleared' (_onResult): that result completes the field
        f.result = f.heldResult;
        this._bossResultDamage(f, f.result);
        f.resultSource = 'client';
        continue; // _fieldDone below
      }
      f.waitTimer = this.later(this.scaled(BOSS_RESULT_GRACE_MS), () => {
        f.waitTimer = null;
        if (f.done) return;
        f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) });
        this._fieldDone(f);
      });
    }
    if (this.pacer) { this.pacer.stop(); this.pacer = null; }
    for (const f of this.fields) if (f.cc && !f.done && (f.mode === 'server' || f.heldResult)) this._fieldDone(f);
  }

  /** b.pool { hp, max, teamLp, acked } to everyone (≤ 4 Hz; `force` skips the dedupe, never the rate). */
  _broadcastPool(force) {
    if (!this.bossPool || this.disposed) return;
    const now = this.sched.now();
    if (now - this._lastPoolAt < POOL_MIN_GAP_MS) {
      if (!this._poolTimer) {
        this._poolTimer = this.later(Math.max(1, POOL_MIN_GAP_MS - (now - this._lastPoolAt)), () => { this._poolTimer = null; this._broadcastPool(force); });
      }
      return;
    }
    // exact numbers: a client shows `hp − (its cumulative damage − acked)` and ends its battle as 'cleared' when that
    // reaches 0 — rounded values could show 0 while the server's pool still holds a fraction of a point
    // a server-run field (no client left, or none at all): what its battle has put into the pool so far — a display
    // replica (a reconnecting / watching human) subtracts only its local damage beyond that from the server hp
    const acked = {};
    for (const f of this.fields) if (f.cc) acked[f.fieldId] = f.mode === 'server' && f.credit ? Math.max(f.bossAcked, f.credit.cum) : f.bossAcked;
    const msg = {
      t: 'b.pool', hp: Math.max(0, this.bossPool.hp), max: this.bossPool.maxHp,
      teamLp: this.teamLp == null ? null : Math.max(0, Math.round(this.teamLp)), acked,
    };
    const key = JSON.stringify(msg);
    if (!force && key === this._lastPoolKey) return;
    this._lastPoolKey = key;
    this._lastPoolAt = now;
    this.broadcast(msg);
  }

  /**
   * Bounties after a boss field: kill-bounty coins and — when `perfect` — the coins of every perfect-payout bounty (a
   * 战术特训 card: PRTS "若各自行动阶段就达成完美作战，获得N资金", the same sum SETTLE pays after a normal battle) go to
   * pending funds (spent in the Hidden Core's prep), and every bounty used one of its battles, exactly like SETTLE does
   * for normal rounds.
   * @param {boolean} perfect the player's own field was perfect and the team won (`_finishFinal`)
   */
  _settleBossBounties(ps, pp, perfect) {
    let coins = Math.max(0, Math.trunc(Number(pp.coins) || 0));
    if (perfect) for (const b of ps.bounties) if (b.card.payout === 'perfect') coins += b.card.coin;
    if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
    if (!ps.bounties.length) return;
    for (const b of ps.bounties) b.roundsLeft--;
    ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
    ps.dirty();
  }

  _bossLeak(enemy) {
    if (!enemy || this.teamLp == null) return;
    // lifePointReduce from data: 0 for harmless enemies (e.g. 装置 / unharmful escorts), 1 when absent
    const lpr = Number.isFinite(enemy.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1;
    this._teamLpLoss(lpr);
  }

  _teamLpLoss(amount) {
    const n = Number(amount);
    if (this.teamLp == null || !Number.isFinite(n) || !(n > 0)) return;
    this.teamLp = Math.max(0, this.teamLp - n);
    if (this._bossLazyPublic()) { this._bossPublic(); return; }
    this._syncTeamLp();
    this.markPublic();
  }

  /** Boss rounds under client-side combat: m.public / the per-player LP shares refresh at ~1 Hz (b.pool is live). */
  _bossLazyPublic() {
    return this.clientCombat && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.fields.some((f) => f.cc);
  }

  /** Throttled (BOSS_PUBLIC_MS) refresh of m.public and the players' LP shares during a boss round. */
  _bossPublic() {
    if (this._bossPubTimer || this.disposed || this.ended) return;
    const wait = Math.max(0, BOSS_PUBLIC_MS - (this.sched.now() - this._bossPubAt));
    this._bossPubTimer = this.later(wait, () => {
      this._bossPubTimer = null;
      this._bossPubAt = this.sched.now();
      this._syncTeamLp();
      this.markPublic();
    });
  }

  /**
   * The merged team LP (Final Assault / Hidden Core, research 01 §9) written back to the alive players as shares of
   * what each brought in (`lpAtFinal`, largest remainder, ties → seat), so m.public / m.private / m.result never show
   * the pre-merge LP of a team that lost LP in the boss fight (Σ alive lp = round(teamLp)).
   */
  _syncTeamLp() {
    if (this.teamLp == null) return;
    const alive = this.alivePlayers().filter((p) => p.lpAtFinal != null);
    if (!alive.length) return;
    const total = Math.max(0, Math.round(this.teamLp));
    const base = alive.reduce((s, p) => s + Math.max(0, p.lpAtFinal), 0);
    const rows = alive.map((p) => {
      const v = base > 0 ? (total * Math.max(0, p.lpAtFinal)) / base : total / alive.length;
      const n = Math.floor(v + 1e-9);
      return { p, n, frac: v - n };
    });
    let left = total - rows.reduce((s, x) => s + x.n, 0);
    for (const x of rows.slice().sort((a, b) => b.frac - a.frac || a.p.seat - b.p.seat)) {
      if (left <= 0) break;
      x.n++;
      left--;
    }
    for (const x of rows) if (x.p.lp !== x.n) { x.p.lp = x.n; x.p.dirty(); }
  }

  /**
   * Overtime drain on the boss field clock (`gt` game seconds): 1 team LP per real second from the 150 real-second mark
   * (bossTurnHpReduceTime, gamedata.js bossOvertimeDue).
   */
  _applyOvertime(gt) {
    // 普通局的战场时钟是「游戏秒」（combatTimeScale 口径），bossOvertimeDue 直接吃它。
    //
    // 超限局不一样：那边的倒计时与扣血起点都是**真实秒**（startFinalAssault 的 onClock），
    // 而战场时钟按 gameSpeed 推进（2× 时 4 游戏秒/真实秒）。再拿 gt 去折算会差一倍，
    // 所以超限直接用真实时钟算：过了 overtimeAt 就每秒扣 bossOvertimeDrainReal。
    const due = this.isInfinite
      ? (() => {
        const at = Number(this.overtimeAt) || 0;
        const now = this.sched.now();
        const over = at > 0 ? Math.floor((now - at) / 1000) : 0;
        return over >= 1 ? over * this.gd.bossOvertimeDrainReal : 0;
      })()
      : this.gd.bossOvertimeDue(gt, this.bossOvertimeStartReal);
    if (due > this.overtimeApplied) {
      const loss = due - this.overtimeApplied;
      this.overtimeApplied = due;
      this._teamLpLoss(loss);
    }
  }

  _bossTick(runner) {
    this._applyOvertime(runner.time);
    if (this.teamLp <= 0 && this.bossPool.hp > 0) runner.forceAll('forced');
    // client-side combat with every boss field on the server: humans that reconnect / watch run display replicas
    // whose LocalBossPool follows b.pool
    if (this.fields.some((f) => f.cc)) { this._broadcastPool(false); this._bossPublic(); }
    else if (runner.ticks % 6 === 0) this.markPublic();
    if (runner.ticks % 30 === 0) this.flush();
  }

  _finalDone(runner, hidden) { this._finishFinal(hidden, (f) => runner.resultOf(f)); }

  /** Every boss field is over: stats, bounties, then the Hidden Core or RESULT. */
  _finishFinal(hidden, resultOf) {
    if (this.phase !== (hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT)) return;
    this._stopClientCombat();
    // the end condition the server registered first decides (client-side combat: _endFinal — pool 0 → victory, team LP 0
    // → defeat); a boss field's final result may never turn a defeat into a victory (user playtest #6 item 5)
    const victory = this._finalEnding ? this._finalEnding === 'cleared' : this.bossPool.hp <= 0;
    // 超限档案（业主 2026-10-26）：Boss 击杀与最高盟约层数，只在无限模式记录
    if (this.isInfinite) {
      this._trackInfiniteLayers();
      if (victory && !hidden) this._trackInfiniteBossKill();
    }
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      f.live = false;
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        const ps = this.players.get(pid);
        if (pp) this.lastResults.set(pid, pp);
        if (pp && ps) {
          ps.stats.dmgDealt += Number(pp.damageDealt) || 0;
          ps.stats.kills += Number(pp.killed) || 0;
          ps.creditedKills += creditedKillsOf(pp);
          ps.dirty(); // m.private.stats
          this._charDamageTickers(ps, pp);
        }
        if (pp && ps) {
          // the own battle counts as perfect when the team won, the result is a real one (not the stand-in of a field that
          // never reported) and the player's own field let no counted enemy through [ASSUMED: the boss battle is a battle
          // of the player's own — "下场作战" — so a perfect-payout card pays as after a normal one]
          const perfect = victory && !res.synthetic && pp.perfect === true && !(pp.leaked || []).some((l) => l && l.counted !== false)
            && this._bossLeaksAgree(f, res, pid);
          this._settleBossBounties(ps, pp, perfect);
        }
        if (pp && ps) this.dispatch(ps, 'onBattleResult', { result: pp, lpLoss: 0, perfect: !!pp.perfect, boss: true });
      }
    }
    this._syncTeamLp();
    this.deadline = 0;
    this.overtimeAt = 0;
    this.markPublic();
    this.runner = null;
    if (!hidden) {
      // 业主 2026-10-21：超限双 Boss 轮（R45+）——击败主 Boss 后不结算，
      // 先进 2.6 秒的全屏预警，再换一个「按当前难度曲线重算血量」的副 Boss 血池。
      if (this.isInfinite && victory && this._doubleBossPending(victory)) {
        this._enterBossPhase2();
        return;
      }
      if (this.isInfinite && victory) {
        // 业主 2026-10-19：「击败无限轮次的 boss 后及时显示词条选择」。
        // 以前是 SETTLE(3s) → startRound(ROUND_START 2s) → afterRoundStart → TRAIT_DRAFT，一共 5 秒空等。
        // 现在打完 Boss 直接进下一回合，并把 ROUND_START 的等待压到最短 —— 词条卡几乎是立刻弹出的。
        this.later(this.scaled(800), () => {
          this.bossPool = null;
          // 超限「词条」（业主 2026-10-31）：Boss 轮之后先开一次**词条三选一**（SP/EX/FGO + 未被选走的 LC 的全池），
          // 选完 finishRelicDraft 再回来走下面既有的词条抉择（TRAIT_DRAFT），这样两套三选一不会挤在同一个时点。
          if (wantsRelicDraft(this, this.round + 1)) {
            this._relicPendingRound = this.round + 1;
            if (this.enterRelicDraft(this.round + 1)) return;
            this._relicPendingRound = null;
          }
          // 业主 2026-10-20：词条抉择在「Boss 轮结束、下一轮还没进」的时点切入 ——
          // 以前是先 startRound(21) 再弹，界面上的回合计已经跳到 21 了。
          // 现在先开词条，选完由 finishTraitDraft 调 startRound(21)，选中的怪正好进下一轮。
          if (wantsTraitDraft(this, this.round + 1)) {
            this._traitPendingRound = this.round + 1;
            this._traitDoneRound = this.round;
            if (this.enterTraitDraft(this.round + 1)) return;
          }
          this.startRound(this.round + 1);
        });
        return;
      }
      // 湮灭模拟: the pair this Final Assault belongs to (蚀流 3+ has several, 无尽湮灭 endlessly more); every other mode
      // keeps reading gd.hiddenRound exactly as before
      const hiddenRound = this.gd.annihilation && this.gd.hiddenAfter ? this.gd.hiddenAfter(this.round) : this.gd.hiddenRound;
      // 无尽湮灭: the queue is the rule — a won Final Assault always opens its Hidden Core, the layer-sum gate does not apply
      // (otherwise the endless run would end at the first boss won without 350 layers)
      const eligible = victory && !!hiddenRound
        && ((this.gd.annihilation && this.gd.endless === true) || (!!this.hiddenBossId && hiddenEligible(this.gd, { layerSum: this.hiddenLayerSum, teamLp: this.teamLp })));
      this.later(this.scaled(DELAYS.SETTLE), () => {
        if (eligible) {
          this.hiddenReached = true;
          this.bossPool = null;
          this.tickerText('隐秘核心已解锁', FLOW_TICKER_PRIORITY);
          this.startRound(hiddenRound);
        } else {
          this.finish({ victory, reason: victory ? 'victory' : 'defeat' });
        }
      });
    } else {
      if (this.isInfinite && victory) {
        this.later(this.scaled(DELAYS.SETTLE), () => {
          this.bossPool = null;
          this.startRound(this.round + 1);
        });
        return;
      }
      // 湮灭模拟（蚀流 3+ / 无尽）: the run has more than one Boss/Hidden-Core pair — a won Hidden Core only closes its
      // chapter. The last pair (gd.isLastHidden) still ends the run and 无尽湮灭 has no last one; every other mode's gd
      // has no isLastHidden, so it keeps finishing right here exactly as before.
      if (victory && this.gd.annihilation && this.gd.isLastHidden && !this.gd.isLastHidden(this.round)) {
        this.later(this.scaled(DELAYS.SETTLE), () => {
          this.hiddenReached = false;
          this.hiddenLayerSum = 0;
          this.bossPool = null;
          this._finalEnding = null;
          this.tickerText(this.gd.isBossRound?.(this.round + 1) ? '下一段最终攻势' : '作战继续', FLOW_TICKER_PRIORITY);
          this.startRound(this.round + 1);
        });
        return;
      }
      this.later(this.scaled(DELAYS.SETTLE), () => this.finish({ victory: true, hiddenCleared: victory, reason: 'victory' }));
    }
  }

  /**
   * 超限风险契约：Boss 轮 PREP 时给出三选一（每轮一次）。由 prep.js 的 enterPrep 调用。
   */
  offerBossContract() {
    if (!this.isInfinite || !isInfiniteBossRound(this.round)) return null;
    if (this.contractOffer && this.contractOffer.round === this.round) return this.contractOffer;
    if (this.contract && this.contract.round === this.round) return null; // 本轮已经选过
    this.contractOffer = {
      round: this.round,
      cards: BOSS_CONTRACTS.map((c) => ({ id: c.id, name: c.name, text: c.text, reward: c.reward })),
    };
    return this.contractOffer;
  }

  /**
   * g.contract { id }：选择/放弃本轮契约。'none' = 不签。
   * 只改本轮 Boss 波（bossWaves[0].wave），奖励直接发到玩家。
   */
  chooseContract(ps, id) {
    if (!this.isInfinite) return fail(ERR.WRONG_PHASE);
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const offer = this.contractOffer;
    if (!offer || offer.round !== this.round) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (id !== 'none') {
      const card = BOSS_CONTRACTS.find((c) => c.id === id);
      if (!card) return fail(ERR.BAD_TARGET);
      const wave = this.bossWaves && this.bossWaves[0] && this.bossWaves[0].wave;
      if (!wave || !Array.isArray(wave.spawns)) return fail(ERR.WRONG_PHASE);
      if (id === 'elite') {
        const base = wave.spawns.find((s) => s && s.tag !== 'boss' && !(s.preview && s.preview.boss))
          || { enemyKey: 'enemy_1007_slime', routeIndex: 0, mods: { hpMul: 1, atkMul: 1, speedMul: 1 } };
        wave.spawns.push({
          time: 8, enemyKey: base.enemyKey, routeIndex: Number.isInteger(base.routeIndex) ? base.routeIndex : 1,
          count: 1, interval: 0, mods: { ...(base.mods || {}) }, preview: { fly: false, elite: true, boss: false },
        });
        ps.funds = (Number(ps.funds) || 0) + 2;
      } else if (id === 'time') {
        wave.timeLimit = Math.min(Number(wave.timeLimit) || 180, 90);
        ps.funds = (Number(ps.funds) || 0) + 2;
      } else if (id === 'aspd') {
        for (const s of wave.spawns) {
          if (!s || (s.tag !== 'boss' && !(s.preview && s.preview.boss))) continue;
          s.mods = { ...(s.mods || {}), atkMul: (Number(s.mods && s.mods.atkMul) || 1) * 1.2 };
        }
        this.traitBonusReroll = (this.traitBonusReroll || 0) + 1;
      }
      if (typeof ps.dirty === 'function') ps.dirty();
      this.contract = { id, round: this.round };
    } else {
      this.contract = { id: 'none', round: this.round };
    }
    this.contractOffer = null;
    this.markPublic();
    return OK;
  }

  /**
   * 超限档案：记录一次 Boss 击杀（主/副阶段各一次；同一回合同一阶段只记一次）。
   * 只在胜利且非隐秘核心时调用；`this.bossWaves[0].wave.primaryBoss` 在第二阶段就是副 Boss。
   */
  _trackInfiniteBossKill() {
    const w = this.bossWaves && this.bossWaves[0] && this.bossWaves[0].wave;
    const bossId = (w && w.primaryBoss) || this.bossId;
    const phase = this.bossPhaseNo || 1;
    const key = `${this.round}:${phase}`;
    if (!Array.isArray(this.infiniteBossKills)) this.infiniteBossKills = [];
    if (this.infiniteBossKills.some((k) => k.key === key)) return;
    const rec = this.gd && typeof this.gd.boss === 'function' ? this.gd.boss(bossId) : null;
    this.infiniteBossKills.push({ key, round: this.round, phase, id: bossId, name: (rec && rec.name) || bossId });
  }

  /** 超限档案：记下每个盟约见过的最高层数（每回合结算与 Boss 结算各取一次）。 */
  _trackInfiniteLayers() {
    if (!this.maxLayersSeen || typeof this.maxLayersSeen !== 'object') this.maxLayersSeen = {};
    for (const ps of this.players.values()) {
      const layers = ps && ps.layers;
      if (!layers || typeof layers !== 'object') continue;
      for (const [id, n] of Object.entries(layers)) {
        const v = Number(n) || 0;
        if (v > (this.maxLayersSeen[id] || 0)) this.maxLayersSeen[id] = v;
      }
    }
  }

  /** 双 Boss 轮还有第二阶段吗（业主 2026-10-21）。 */
  _doubleBossPending(victory) {    if (!victory) return false;
    if (this.bossPhaseNo >= 2) return false;
    const w = this.bossWaves && this.bossWaves[0] && this.bossWaves[0].wave;
    return !!(w && w.isDouble && w.secondaryBoss);
  }

  /** 进入第二阶段：2.6 秒全屏预警，然后换副 Boss 血池重开一场 Boss 战。 */
  _enterBossPhase2() {
    this.phase = PHASE.BOSS_PHASE2_WARN;
    this.deadline = 0;
    this.overtimeAt = 0;
    this.bossPhaseNo = 2;
    this._stopClientCombat();
    this.markPublic();
    this.later(BOSS_PHASE2_WARN_MS, () => {
      if (this.phase !== PHASE.BOSS_PHASE2_WARN) return;
      this._startBossPhase2Battle();
    });
  }

  /** 用副 Boss 重建波次与血池，把战斗重新开起来。 */
  _startBossPhase2Battle() {
    const groups = this.bossPairs && this.bossPairs.length
      ? this.bossPairs
      : [this.alivePlayers().map((q) => q.playerId)];
    this.bossWaves = groups.map((g) => ({
      players: g.slice(),
      wave: buildInfiniteBossWave(this.gd, this.rngWaves, this.round,
        this._infiniteRoutes(this.round, GEO.BOSS_RECT), { phase: 2, affix: this.roundBossAffix || null }),
    }));
    this.lastResults = new Map();
    this._finalEnding = null;
    this.overtimeApplied = 0;
    this.startFinalAssault(false);
  }

}
