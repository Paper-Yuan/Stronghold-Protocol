// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { withBounties } from '../waves.js';
import { planUnite } from '../unite.js';
import { planTeamUnite } from '../teams.js';
import { FieldRunner, DeadBattle , GAME_SPEED } from '../fields.js';
import { DELAYS, FLOW_TICKER_PRIORITY } from './common.js';
import { previewPlayer } from '../preview.js';
import { installInfiniteRule } from '../../sim/infiniteRule.js';

/** 兜底时限：最后一只出场时间 + 走完全程的余量（60 秒太短，超限会误判漏怪）。 */
function estimateTimeLimit(wave) {
  const sp = Array.isArray(wave && wave.spawns) ? wave.spawns : [];
  const last = sp.length ? Math.max(...sp.map((x) => Number(x && x.time) || 0)) : 0;
  return Math.max(60, Math.ceil(last + 60));
}


export class MatchCombat {
  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts,
      // the room's morphPairing for a SERVER-run battle (the spec path adds it in _ccField; this one never goes through a
      // spec). {} unless the room chose plus, so an official battle keeps exactly the options it had.
      ...this._morphBattleOpt(),
      // 房间模组的 kit 注入 (W-C)：只有服务端自己跑的战斗走这里（接管 / 校验 / SP_COMBAT=server）
      ...(this.kits ? { kits: this.kits } : {}), ...(this.tokenKits ? { tokenKits: this.tokenKits } : {}),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    try {
      const battle = new this.BattleClass(full);
      // 超限模拟的性能/规则防护：只有超限局的战斗才装，其他模式拿到的是完全没动过的 engine（2026-10-17）。
      if (this.isInfinite) installInfiniteRule(battle);
      return battle;
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /**
   * 炸惊模拟「锻造器」for a SHARED field (Final Assault / Hidden Core / 联防): those specs carry several players, so the
   * per-player summary travels as `flags.forgeByPlayer = { [playerId]: mods }` instead of the single-player flat
   * `flags.forge` a normal field uses. Only players who actually forged something appear (an empty map is not sent, so a
   * field where nobody forged is byte-identical to before), and only a ZHAJING match reads `ps.forge` at all.
   * `sim/content/forge.js` must accept BOTH shapes (flat `forge` on a normal field, `forgeByPlayer[pid]` on a shared one)
   * and treat a missing key as "no forge".
   * @param {Array<string|null|undefined>} playerIds
   * @returns {Record<string, any> | null}
   */
  _forgeByPlayer(playerIds) {
    if (!this.gd.zhajing) return null;
    const out = {};
    for (const pid of playerIds || []) {
      if (typeof pid !== 'string') continue;
      const ps = this.players.get(pid);
      const f = ps && typeof ps.forgeBattleFlags === 'function' ? ps.forgeBattleFlags() : null;
      if (f && f.forge) out[pid] = f.forge;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps, { preview = false, board = ps.board } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    const spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // 鸭爵「神秘顾客」(#839) draws from the round's OWN wave, never from the re-timed list above: a bounty split moves the
    // units' times, and a per-player order would give each player a different draw. The bot rehearsal passes the same copy
    // (bot.js bossCandidateOpts), so the live field must too (GitHub #839, DESIGN §35.26).
    const waveSpawns = (Array.isArray(wave.spawns) ? wave.spawns : []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    // 超限词条抉择选中的怪：本轮出场，且不带悬赏金（业主 2026-10-18）
    for (const s of (this.traitSpawnFor ? this.traitSpawnFor(this.round) : [])) spawns.push(s);
    const ev = { input, kind: 'normal', round: this.round, spawns, waveSpawns, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.NORMAL_RECT },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      // 超限词条：静态修正合并进 flags（普通模式 this.traitMods 为空，等价于原来的对象）
      // 湮灭模拟: the mode's own battle flags (fog / terrainLethal / chaosTargeting) ride on the normal field. Gated on
      // the mode block, not on the callee: an official mode's flags object stays exactly what it is today.
      // 炸惊模拟「锻造器」: this player's forged summary rides along as `flags.forge` (null when nothing was forged and in
      // every other mode), which is all sim/content/forge.js needs to apply it.
      flags: this._rmSpecFlags({ layerGainsEnabled: true, ...this.gd.dp, ...(this.isInfinite ? { overlimit: true } : {}), ...(this.traitFlagBundle ? this.traitFlagBundle() : {}), ...(this.gd.annihilation ? this.gd.annihilationFlags('normal', this.round) : null), ...(this.gd.zhajingFlags ? this.gd.zhajingFlags() : null), ...(this.enemyJibianCards && this.enemyJibianCards.length ? { enemyJibian: this.enemyJibianCards.slice() } : null), ...(typeof ps.forgeBattleFlags === 'function' ? ps.forgeBattleFlags() : null) }),
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: { ...(wave.overrides || {}), ...(this.specialOverrides ? this.specialOverrides() : {}) },
      waveId: wave.templateId,
    };
  }

  /**
   * The room's `morphPairing` as the BATTLE layer reads it (DESIGN §37.15): `{ morphPairing: 'plus' }` or `{}` — an official
   * spec grows no key, so identity / extra-field tests keep passing. The value comes from `GameData.rulesOf`, i.e. the same
   * precedence every other reader of that switch uses (official default → mode.annRules → room annMods → plugin content
   * rules). `sim/spec.js` writes it into the spec and `sim/battle/players.js` reads `opts.morphPairing` — without this
   * spread the switch stops at the prep side and the battle silently plays the official pairing (caught by
   * test/match/rules.test.js: 「the server writes the room rule into the battle input」).
   * @returns {{ morphPairing?: 'plus' }}
   */
  _morphBattleOpt() {
    return this.gd && typeof this.gd.rulesOf === 'function' && this.gd.rulesOf('morphPairing') === 'plus' ? { morphPairing: 'plus' } : {};
  }

  /**
   * 切换战斗倍速时重算倒计时（业主 2026-10-26）：
   * 已推进的游戏秒 = 真实时间 × 旧倍速；剩余游戏秒按新倍速折算成真实 deadline。
   * 只对正在进行的战斗有效（普通战斗 / Boss 轮都记录 _combatLimit 与 _combatStartAt）。
   */
  _reclockForSpeed(oldSpeed, newSpeed) {
    const now = this.sched.now();
    if (this.sched.instant || this._combatStartAt == null || !this._combatLimit || !(oldSpeed > 0) || !(newSpeed > 0)) return;
    const elapsedGt = ((now - this._combatStartAt) / 1000) * oldSpeed;
    const remaining = Math.max(0, this._combatLimit - elapsedGt);
    this._combatLimit = remaining;
    this._combatStartAt = now;
    if (this.deadline > 0) this.deadline = now + Math.round((remaining / newSpeed) * 1000);
    if (this.overtimeAt > 0) {
      this.overtimeAt = now + Math.round(((remaining + (this._overtimeGapGt || 0)) / newSpeed) * 1000);
    }
    this.markPublic();
  }

  startCombat() {
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    // 超限：作战开始按玩家的持久偏好提速（业主 2026-10-21）。休整期一直是基准速，
    // 进战斗才切到 2×，这样「按钮按了就一直在之后的作战里生效，备战保持原速」。
    if (this.isInfinite) this.gameSpeed = GAME_SPEED * (this.infiniteSpeedPref || 1);
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.fields = alive.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    // 拿不到 timeLimit 时按「怪的数量 × 出怪节奏」估一个，而不是硬编码 60 秒 ——
    // 超限 R16+ 有 33–60 只怪、最后一只 70 秒后才出场，60 秒会把还活着的全判成漏怪。
    const limit = this.wave && Number.isFinite(this.wave.timeLimit) ? this.wave.timeLimit : estimateTimeLimit(this.wave);
    // 业主 2026-10-26：倒计时与推进必须同一倍速。之前超限固定按 1× 算 deadline，
    // 2× 时敌人提前打完、倒计时还剩一半；现在 deadline = 剩余游戏秒 / gameSpeed，
    // 切倍速时由 _reclockForSpeed 重算。普通模式 gameSpeed = GAME_SPEED，结果与原来一致。
    this._combatLimit = limit;
    this._combatStartAt = this.sched.now();
    this.deadline = this.sched.instant ? 0 : this._combatStartAt + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
    this._annihilationFogNotice();
  }

  /**
   * 湮灭模拟: the toxic fog rises `afterReal` seconds into every normal / 联防 field before the Final Assault. The battle
   * sim (sim/content/hazard.js) deals the damage itself; this tells the table when it starts, once per round.
   */
  _annihilationFogNotice() {
    const f = this.gd.annihilation ? this.gd.annihilationFlags('normal', this.round) : null;
    if (!f || !f.fog) return;
    const ms = Math.round((f.fog.at / this.gameSpeed) * 1000);
    this.later(ms, () => {
      if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.UNITE) return;
      for (const ps of this.alivePlayers()) this.toast(ps, 'warn', '毒雾开始侵蚀战场：我方全体单位将持续失去生命值');
      this.tickerText('湮灭模拟：毒雾开始侵蚀战场', FLOW_TICKER_PRIORITY);
    });
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    if (this.isInfinite) this.gameSpeed = GAME_SPEED * (this.infiniteSpeedPref || 1);
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = alive.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    // 拿不到 timeLimit 时按「怪的数量 × 出怪节奏」估一个，而不是硬编码 60 秒 ——
    // 超限 R16+ 有 33–60 只怪、最后一只 70 秒后才出场，60 秒会把还活着的全判成漏怪。
    const limit = this.wave && Number.isFinite(this.wave.timeLimit) ? this.wave.timeLimit : estimateTimeLimit(this.wave);
    // 业主 2026-10-26：倒计时与推进必须同一倍速。之前超限固定按 1× 算 deadline，
    // 2× 时敌人提前打完、倒计时还剩一半；现在 deadline = 剩余游戏秒 / gameSpeed，
    // 切倍速时由 _reclockForSpeed 重算。普通模式 gameSpeed = GAME_SPEED，结果与原来一致。
    this._combatLimit = limit;
    this._combatStartAt = this.sched.now();
    this.deadline = this.sched.instant ? 0 : this._combatStartAt + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    this._annihilationFogNotice();
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    // 多队（8 / 12 人房）: 队内联防 → 观看 → 跨队联防 (docs/TWELVE_PLAYER_MODE.md §9; server/match/teams.js)
    if (this.multiTeam) {
      const teamPlan = planTeamUnite(this, this.lastResults);
      if (teamPlan) this.startTeamUnite(teamPlan);
      else this.settle(null, null);
      return;
    }
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }
}
