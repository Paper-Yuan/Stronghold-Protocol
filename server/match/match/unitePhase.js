// server/match/match/unitePhase.js — Match methods: 联防 glue (the rules: server/match/unite.js) — the UNITE phase in
// both modes (the 联防 field from the helpers' carried state and the leakers' enemies), its end, and the leakers' live
// counts (_uniteLeft, user playtest #6 item 7; _uniteTick in the server-run mode).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO, teamIndexOf } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { uniteBattleOpts, uniteSurvivors } from '../unite.js';
import { planCrossUnite, teamSurvivors, survivorsTotal } from '../teams.js';
import { FieldRunner, timelineAt, uniteBillBounds } from '../fields.js';
import { uniteLeft } from '../../sim/spec.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onStartUnite } from '../botEmotes.js';

export class MatchUnite {
  startUnite(plan) {
    if (this.clientCombat) { this._startUniteClient(plan); return; }
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const battle = this.newBattle(this._uniteOpts(plan, limit));
    this.fields = [{ fieldId: 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), battle, live: true }];
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: plan.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
    onStartUnite(this, plan); // an AI helper says "合作愉快" once on the open of a 联防 (enabled by default; SP_BOT_EMOTES=0 silences it)
    this._uniteLeftKey = null;
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._uniteTick(runner),
      onDone: (runner) => {
        if (this.phase !== PHASE.UNITE) return;
        const res = runner.resultOf(this.fields[0]);
        this._collectSimErrors(this.fields[0], res);
        this.fields[0].live = false;
        this.deadline = 0;
        this.markPublic();
        this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plan, res));
      },
    });
    this.runner.start();
  }

  /**
   * Battle options of the 联防 field (helpers' carried end state, the leakers' enemies) on the round's battlefield, its
   * terrain, crates, water, devices and runes included (unite.js header; the owner's decision of 2026-10-07 — 0.2.0's
   * escaped-level map is withdrawn). The field meta and the client-run spec carry the match stageId, so every viewer
   * draws the battlefield the boards stand on.
   */
  _uniteOpts(plan, limit, fieldId = 'u') {
    const { wave, players } = uniteBattleOpts(this, plan, limit);
    // 炸惊模拟「锻造器」: a 联防 field is shared by helpers + leakers, so the per-player summary rides as
    // `flags.forgeByPlayer`; null when nobody forged (the flags object then stays exactly what it was).
    const forgeByPlayer = this._forgeByPlayer((players || []).map((p) => (p && typeof p === 'object' ? p.playerId : p)));
    return {
      seed: deriveSeed(this.seed, `${fieldId === 'u' ? 'u' : fieldId}:${this.round}`),
      kind: 'unite',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.UNITE_RECT },
      timeLimit: limit,
      players,
      spawns: this._sanitizeSpawns(wave.spawns),
      routes: wave.routes,
      sharedBoss: null,
      // 炸惊模拟: a 联战 field keeps its layer gains (`!!gd.zhajing`); every other mode keeps the official `false`.
      flags: this._rmSpecFlags({ layerGainsEnabled: !!this.gd.zhajing, ...this.gd.dp, ...(this.isInfinite ? { overlimit: true } : {}), ...(this.gd.annihilation ? this.gd.annihilationFlags('unite', this.round) : null), ...(this.gd.zhajingFlags ? this.gd.zhajingFlags() : null), ...(this.enemyJibianCards && this.enemyJibianCards.length ? { enemyJibian: this.enemyJibianCards.slice() } : null), ...(forgeByPlayer ? { forgeByPlayer } : null) }),
      fieldId,
      // leaked enemies re-enter with the stats they had: the round template's stat overrides apply again
      enemyOverrides: this.wave && this.wave.overrides ? this.wave.overrides : {},
      waveId: wave.templateId,
    };
  }

  _startUniteClient(plan) {
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const f = this._ccField({ fieldId: 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), opts: this._uniteOpts(plan, limit) });
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this.watchers.clear();
    this._launch([f]);
    // helpers and everyone else (as observers, spectator seats included) simulate the same 联防 spec locally
    for (const ps of this._viewers()) {
      this.watchers.set(ps.playerId, 'u');
      this._sendStart(ps.playerId, f, { watch: !f.players.includes(ps.playerId) });
    }
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: plan.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
  }

  _finishUniteClient() {
    if (this.phase !== PHASE.UNITE) return;
    if (this.multiTeam) {
      // the same callback serves both multi-team stages: the team stage records every team's outcome, the cross stage hands
      // the round over to settlement
      if (this.uniteStage === 'cross') { this._finishMultiUnite(this.fields[0] ? this.fields[0].result : null); return; }
      this._multiUniteFieldsDone((f) => f.result);
      return;
    }
    const f = this.fields[0];
    const res = f.result;
    this._collectSimErrors(f, res);
    this._stopClientCombat();
    f.live = false;
    this.deadline = 0;
    this.markPublic();
    const plan = this.unitePlan;
    this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plan, res));
  }

  // ── 多队（8 / 12 人房）的联防：队内 → 观看 → 跨队 ────────────────────────────────────────────────────────────────
  // 只在 this.multiTeam 时进入（Match.maxSeats > MAX_SEATS）。4 人房走上面的单场流程，一个字节都不经过这里。
  // 时序照 docs/TWELVE_PLAYER_MODE.md §9：一轮结束 → 判漏 → 队内联防（每队自己一块场）→ 全漏队观看（本阶段停在
  // 'watch'，退出条件只看场：没有仍在进行的队内联防场就立刻进跨队，没有任何固定时长）→ 跨队联防（成功那队出手）→
  // 扣血 / 结算。

  /**
   * §9 step 3 — 队内联防: one field PER TEAM, all three running at the same time (exactly as the normal COMBAT phase runs
   * one field per player). A team fields the helpers `planTeamUnite` chose from its own 没漏 players and faces the union of
   * ITS OWN leakers' counted leaks; a team whose four players all leaked fields nobody (§7 末 不借人) and its players go
   * to the 「观看」 step.
   * @param {{ teams: object[] }} plan the team plan (server/match/teams.js planTeamUnite)
   */
  startTeamUnite(plan) {
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    this.uniteStage = 'team';
    this.teamOutcomes = null;
    this.uniteCharge = null;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const teams = plan.teams.filter((t) => t.helpers.length > 0);
    if (!teams.length) {
      // nobody fields a helper (every leaking team lost all four players this round, §7 末 不借人): no 队内联防 field at
      // all — record that, then the viewing stop and the cross-team stage decide the rest
      this.fields = [];
      this.markPublic();
      this._multiUniteFieldsDone(() => null);
      return;
    }
    if (this.clientCombat) {
      const fields = teams.map((t) => this._ccField({
        fieldId: `u${t.index}`, kind: 'unite', players: t.helpers.map((p) => p.playerId), opts: this._uniteOpts(t, limit, `u${t.index}`),
      }));
      this.fields = fields;
      this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
      this.watchers.clear();
      this._launch(fields);
      // every helper plays its own team's field; everybody else (the all-leaked teams' players included, §7 末) watches
      for (const ps of this._viewers()) {
        const own = fields.find((f) => f.players.includes(ps.playerId)) || null;
        const f = own || this._watchTargetField(ps, fields) || fields[0];
        if (!f) continue;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: !own });
      }
    } else {
      this.fields = teams.map((t) => {
        const opts = this._uniteOpts(t, limit, `u${t.index}`);
        return { fieldId: `u${t.index}`, kind: 'unite', players: t.helpers.map((p) => p.playerId), battle: this.newBattle(opts), live: true };
      });
      this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
      this._defaultWatch();
      this.runner = new FieldRunner(this, this.fields, {
        onTick: (runner) => {
          this._uniteTick(runner);
          // §9 step 4 leaves the viewing stop on the fields, never on a clock: the tick that ends the last 队内联防场 ends
          // the stop too (a no-op while the stage is 'team', which is where today's entry point comes from)
          this._leaveUniteWatch();
        },
        onDone: (runner) => {
          if (this.phase !== PHASE.UNITE || this.uniteStage !== 'team') return;
          this._multiUniteFieldsDone((f) => runner.resultOf(f));
        },
      });
      this.runner.start();
    }
    this.markPublic();
    const names = teams.flatMap((t) => t.helpers.map((p) => p.name));
    if (names.length) this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names }), FLOW_TICKER_PRIORITY);
    for (const t of teams) onStartUnite(this, t);
    this._uniteLeftKey = null;
  }

  /**
   * §9 step 3 done: record every team's outcome (its survivors = what settlement will charge that team's leakers), then
   * step into the viewing stop — or straight to the cross-team 联防 when no team is only watching.
   * @param {(f: object) => object|null} resultOf a field's BattleResult
   */
  _multiUniteFieldsDone(resultOf) {
    if (this.phase !== PHASE.UNITE || this.uniteStage !== 'team') return;
    this._recordTeamOutcomes(resultOf);
    this.uniteStage = 'watch';
    this.markPublic();
    // §9 step 4 全漏队观看: the state machine stops here only as long as the 队内联防场 do — `_leaveUniteWatch` leaves it
    // on the tick the last one ends, and the stage's own end is today's only entry point, so that is this tick. No ticker
    // line: the viewing teams are not the ones fighting, m.public.unite carries the stage instead.
    if (this.unitePlan.teams.some((t) => t.watch)) this._leaveUniteWatch();
    else this._startCrossUnite();
  }

  /**
   * Every team's outcome of the team stage — one entry per team that leaked something (`result` its field's result,
   * `survivors` per leaker, `total` their sum). Idempotent enough for its two callers (the stage's end, and the viewing
   * stop's exit when that stop was entered before the stage handed over); a team field that never ran is judged from its
   * own leaks, exactly as `teamSurvivors` does for a synthetic result.
   * @param {(f: object) => object|null} resultOf a field's BattleResult
   */
  _recordTeamOutcomes(resultOf) {
    if (this.clientCombat) this._stopClientCombat();
    const outcomes = new Map();
    for (const team of this.unitePlan.teams) {
      const f = team.helpers.length ? (this.fields.find((x) => x.fieldId === `u${team.index}`) || null) : null;
      if (!f && !team.leakers.length) continue; // a team that leaked nothing has nothing to judge
      const res = f ? resultOf(f) : null;
      if (f) { if (res) this._collectSimErrors(f, res); f.live = false; }
      const survivors = teamSurvivors(team, res);
      outcomes.set(team.index, { result: res || null, survivors, total: survivorsTotal(team, survivors) });
    }
    this.teamOutcomes = outcomes;
    this.deadline = 0;
    this.runner = null;
    for (const f of this.fields) f.live = false;
  }

  /**
   * Whether a 队内联防场 of the team stage is still running. `fields` holds them until `_startCrossUnite` replaces them,
   * so this is the one and only exit condition of §9 step 4's viewing stop (there is no watch duration constant).
   */
  _uniteTeamFieldsRunning() {
    return this.fields.some((f) => f && f.live === true);
  }

  /**
   * Leave the viewing stop (§9 step 4) the moment no 队内联防场 is running any more: the same tick when the stop was
   * entered after the last one ended (today's entry point), and on the tick the last one ends when the stop began earlier
   * (the team runner calls this every tick). Nothing waits on a wall clock and no transition is padded in.
   * @returns {boolean} whether the stop was left
   */
  _leaveUniteWatch() {
    if (this.phase !== PHASE.UNITE || this.uniteStage !== 'watch') return false;
    if (this._uniteTeamFieldsRunning()) return false;
    // the stop existed before the team stage handed over its outcomes: record them now (the fields are over, so their
    // results are final) instead of planning the cross-team 联防 on nothing
    if (!this.teamOutcomes) this._recordTeamOutcomes((f) => this._teamResultOf(f));
    this._startCrossUnite();
    return true;
  }

  /**
   * A finished team field's BattleResult: server-run (its battle) or client-run (the result released to the field). null
   * for a field that has not reported yet — never a partial battle's guess.
   */
  _teamResultOf(f) {
    if (!f) return null;
    if (f.cc) return f.done ? (f.result || null) : null;
    try { return f.battle && f.battle.finished ? f.battle.result() : null; } catch { return null; }
  }

  /**
   * §9 step 5 — 跨队联防: the pair of the team that fully held intercepts what the teams that did not still have standing
   * (a team with no helper of its own included). No team fully held → no cross-team 联防 at all (§8.1) and the round goes
   * straight to 扣血 / 结算. Control is never transferred (§8): the field is the helpers' own board + array.
   */
  _startCrossUnite() {
    if (this.phase !== PHASE.UNITE) return;
    const cross = planCrossUnite(this, this.unitePlan, this.teamOutcomes || new Map());
    if (!cross) { this._finishMultiUnite(null); return; }
    this.crossPlan = cross;
    this.uniteStage = 'cross';
    const limit = this.wave ? this.wave.timeLimit : 60;
    if (this.clientCombat) {
      const f = this._ccField({ fieldId: 'x', kind: 'unite', players: cross.helpers.map((p) => p.playerId), opts: this._uniteOpts(cross, limit, 'x') });
      this.fields = [f];
      this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
      this.watchers.clear();
      this._launch([f]);
      for (const ps of this._viewers()) {
        const own = f.players.includes(ps.playerId) ? f : null;
        const other = own || this._watchTargetField(ps, [f]) || f;
        this.watchers.set(ps.playerId, other.fieldId);
        this._sendStart(ps.playerId, other, { watch: !own });
      }
    } else {
      const opts = this._uniteOpts(cross, limit, 'x');
      const battle = this.newBattle(opts);
      this.fields = [{ fieldId: 'x', kind: 'unite', players: cross.helpers.map((p) => p.playerId), battle, live: true }];
      this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
      this._defaultWatch();
      this.runner = new FieldRunner(this, this.fields, {
        onTick: (runner) => this._uniteTick(runner),
        onDone: (runner) => {
          if (this.phase !== PHASE.UNITE || this.uniteStage !== 'cross') return;
          this._finishMultiUnite(runner.resultOf(this.fields[0]));
        },
      });
      this.runner.start();
    }
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: cross.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
  }

  /**
   * §9 step 6 hands over: the round's survivors per leaker (队内 + 跨队), which settlement charges as `d` and splits by
   * the number of players still standing (§4). Leftovers that never re-entered a field stay charged (the 4-player rule).
   * @param {object|null} crossResult the cross-team field's result (null: no cross-team 联防 ran)
   */
  _finishMultiUnite(crossResult) {
    if (this.phase !== PHASE.UNITE) return;
    if (this.clientCombat) this._stopClientCombat();
    const survivors = new Map();
    for (const o of (this.teamOutcomes || new Map()).values()) {
      for (const [pid, n] of o.survivors) survivors.set(pid, (survivors.get(pid) || 0) + Math.max(0, n));
    }
    if (crossResult && !crossResult.synthetic && this.crossPlan) {
      this._collectSimErrors(this.fields[0], crossResult);
      // the cross field is authoritative for the enemies it took over: what it left standing replaces that player's
      // 队内 count; a leak that never re-entered any field was never on it and stays charged
      const sent = new Map();
      for (const l of this.crossPlan.leaked) sent.set(l.sourcePlayerId, (sent.get(l.sourcePlayerId) || 0) + 1);
      const crossSurv = uniteSurvivors(this.crossPlan, crossResult);
      for (const [pid, n] of sent) {
        const before = survivors.get(pid) || 0;
        // the enemies it took over were those `n` on-field ones; anything beyond them never re-entered and stays charged
        survivors.set(pid, Math.max(0, before - n) + (crossSurv.get(pid) || 0));
      }
    }
    for (const f of this.fields) f.live = false;
    this.fields = [];
    this.runner = null;
    this.deadline = 0;
    this.uniteStage = null;
    this.uniteCharge = { survivors, ran: true };
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(this.unitePlan, crossResult));
  }

  /**
   * 联防 (user playtest #6 item 7; PRTS 卫戍协议/帮助 "防卫失败的玩家可通过上方信息栏确认自身所属敌人的剩余数量"): how many of
   * a leaker's enemies are still standing on the 联防 field — not spawned yet, alive, or through the objective again —
   * plus its leaks that could not re-enter: what settle() charges it (before the per-round cap) if the 联防 ended now.
   * It falls as the helpers strike them down; a split or a summon raises nothing (a 联防 field tags its runtime spawns
   * `uniteRuntime`, spawns.js — they never crossed the leaker's own goal, so they are neither billed nor shown here).
   * Live from the field (client run: the authority's b.progress `left`; server run: the headless timeline on the field
   * clock, or the streamed battle itself), clamped to what the escaped wave sent that leaker (fields.js uniteBillBounds:
   * keySourceCounts only — the same set settlement bills); exact once the field has its result (unite.js
   * uniteSurvivors; a synthetic result charges the own leaks, as settle()). null for anyone but a leaker of the running
   * 联防.
   * @returns {number|null}
   */
  _uniteLeft(ps) {
    if (this.multiTeam) return this._uniteLeftMulti(ps);
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || !ps || !plan.leakers.includes(ps)) return null;
    const f = this.fields.find((x) => x && x.kind === 'unite') || null;
    return this._uniteLeftIn(plan, f, ps);
  }

  /**
   * Which 联防 field a viewer is put on when it is not one of the players fighting there: in a 多队 room its own team's
   * field at the team stage ('u<team>'), the cross-team field at 'cross', and the first field otherwise (a 4-seat room
   * has exactly one, so this is `this.fields[0]` there — byte for byte the old fallback).
   * @param {any} ps
   */
  _uniteFieldFor(ps) {
    if (this.multiTeam && ps) {
      if (this.uniteStage === 'cross') return this.fields.find((f) => f.fieldId === 'x') || this.fields[0] || null;
      const own = this.fields.find((f) => f.fieldId === `u${teamIndexOf(ps.seat)}`);
      if (own) return own;
    }
    return this.fields[0] || null;
  }

  /**
   * Who fights in the 联防 stage running now (a 多队 room): the cross-team pair at 'cross', else every team's helpers of
   * the team stage. [] for anyone else — the viewing stage fields nobody.
   * @returns {string[]}
   */
  _uniteHelpersNow() {
    if (this.uniteStage === 'cross' && this.crossPlan) return this.crossPlan.helpers.map((p) => p.playerId);
    const teams = this.unitePlan && Array.isArray(this.unitePlan.teams) ? this.unitePlan.teams : [];
    return teams.flatMap((t) => t.helpers.map((p) => p.playerId));
  }

  /**
   * 多队版的「剩余漏怪数」: the running stage's plan and field — 'team' the player's own team's field, 'cross' the
   * cross-team field (which took over the failed teams' leftovers). null for anyone who is not a leaker of that plan.
   */
  _uniteLeftMulti(ps) {
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !ps) return null;
    let sub = null;
    let f = null;
    if (this.uniteStage === 'cross') {
      sub = this.crossPlan || null;
      f = this.fields.find((x) => x.fieldId === 'x') || null;
    } else {
      const t = teamIndexOf(ps.seat);
      sub = plan && Array.isArray(plan.teams) ? plan.teams.find((x) => x.index === t) || null : null;
      f = this.fields.find((x) => x.fieldId === `u${t}`) || null;
    }
    if (!sub || !Array.isArray(sub.leakers) || !sub.leakers.includes(ps)) return null;
    return this._uniteLeftIn(sub, f, ps);
  }

  /**
   * The live count itself (4-player field or one team's field — the same rules): see the doc comment above.
   * @param {{ leaked: object[], notReentered: Map<string, number> }} plan @param {object|null} f @param {any} ps
   */
  _uniteLeftIn(plan, f, ps) {
    const pid = ps.playerId;
    let res = null;
    if (f && f.cc) res = f.done ? f.result : null;
    else if (f && f.battle && f.battle.finished) { try { res = f.battle.result(); } catch { res = null; } }
    if (res && res.synthetic) {
      const own = this.lastResults.get(pid);
      return own && Array.isArray(own.leaked) ? own.leaked.filter((l) => l && l.counted !== false).length : 0;
    }
    if (res) return uniteSurvivors(plan, res).get(pid) || 0;
    const sent = plan.leaked.filter((l) => l.sourcePlayerId === pid).length;
    let live = null;
    if (f && f.cc) {
      if (f.mode === 'server' && f.timeline) {
        // the sample is [gt, killed, total, resolved(, left)]: a 联防 sample's `left` is its 5th element
        const sample = timelineAt(f.timeline, this._fieldElapsed(f));
        live = sample && sample[4] && typeof sample[4] === 'object' ? sample[4] : null;
      } else live = f.progress && f.progress.left && typeof f.progress.left === 'object' ? f.progress.left : null;
    } else if (f && f.battle) {
      try { live = uniteLeft(f.battle); } catch { live = null; }
    }
    if (!this._uniteBounds || this._uniteBounds.plan !== plan) this._uniteBounds = { plan, bounds: uniteBillBounds(plan.leaked, this.gd) };
    const bound = this._uniteBounds.bounds.get(pid) ?? sent;
    const standing = live ? Math.min(bound, Math.max(0, Math.trunc(Number(live[pid]) || 0))) : sent;
    return standing + (plan.notReentered.get(pid) || 0);
  }

  /** Server-run 联防 (streaming mode): refresh m.public about once a game second when a leaker's count moved. */
  _uniteTick(runner) {
    const f = runner && runner.fields ? runner.fields[0] : null;
    if (!f || !f.battle || runner.ticks % 30 !== 0) return;
    let key = '';
    try { key = JSON.stringify(uniteLeft(f.battle)); } catch { key = ''; }
    if (key === this._uniteLeftKey) return;
    this._uniteLeftKey = key;
    this.markPublic();
  }
}
