// server/loadGuard.js — dynamic admission guard: periodic load sampling and a three-tier circuit breaker.
//
// The 2+2G production box (docs/OPTIMIZATION_AND_PR_PLAN.md §2.1) collapses at 160–180 online players long before
// the OS-wide CPU/RAM numbers look saturated: the Node worker is single-threaded, so one busy core hides in the
// 2-core average. This module samples, every `intervalMs`, what actually predicts collapse:
//   * online players and the Equivalent Load Score (un-preloaded web streamers cost 8x — see lobby.welcomeInfo);
//   * CPU percent over the full sample interval (admin.js getCpuUsagePercent resets its baseline on every call:
//     calling it once per 2 s window here turns that "since last call" metric into a real periodic average);
//   * event-loop lag (perf_hooks.monitorEventLoopDelay mean over the window) — the honest "single core saturated"
//     signal for a single-threaded server;
//   * free system memory.
// The tiers gate NEW hello sessions only (server/net.js): nobody is ever kicked, reconnects with a known token
// always pass, and static asset traffic (the preload pipeline) is untouched — it never goes through `hello`.
//
//   green  — everything below the warn thresholds: normal admission.
//   yellow — approaching capacity: admission stays open (a warning hint rides the welcome frame instead).
//   red    — one of the hard limits tripped: brand-new sessions get ERR.BUSY with a friendly queue message.

import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getCpuUsagePercent } from './admin.js';

/** Tunables (override via the LoadGuard constructor options). */
export const LOAD_GUARD_DEFAULTS = Object.freeze({
  intervalMs: 2000,   // sampling cadence; 0 = manual sampling only (tests)
  onlineWarn: 160,    // yellow when online players reach this
  onlineRed: 200,     // red (circuit breaker) at this many online players
  elsWarn: 160,       // yellow when the Equivalent Load Score reaches this
  elsRed: 200,        // red at this ELS
  cpuWarnPct: 80,     // yellow above this interval-averaged CPU percent
  cpuRedPct: 88,      // red above this (the worker's core is effectively saturated)
  lagWarnMs: 60,      // yellow above this mean event-loop delay
  lagRedMs: 120,      // red above this — command latency is the first casualty
});

/**
 * Pure tier evaluation, exported for tests: the most severe matching tier wins (red beats yellow beats green).
 * @param {{ onlineCount: number, loadScore: number, cpuPercent: number, lagMs: number }} m
 * @param {Partial<typeof LOAD_GUARD_DEFAULTS>} [t] thresholds
 * @returns {'green'|'yellow'|'red'}
 */
export function evaluateTier({ onlineCount, loadScore, cpuPercent, lagMs }, t = LOAD_GUARD_DEFAULTS) {
  if (onlineCount >= t.onlineRed || loadScore >= t.elsRed || cpuPercent >= t.cpuRedPct || lagMs >= t.lagRedMs) return 'red';
  if (onlineCount >= t.onlineWarn || loadScore >= t.elsWarn || cpuPercent >= t.cpuWarnPct || lagMs >= t.lagWarnMs) return 'yellow';
  return 'green';
}

/**
 * @typedef {object} LoadSample
 * @property {'green'|'yellow'|'red'} status
 * @property {number} onlineCount
 * @property {number} loadScore
 * @property {number} cpuPercent
 * @property {number} lagMs
 * @property {number} freeMemMb
 * @property {number} at ms epoch of the sample
 */

export class LoadGuard {
  /**
   * @param {{ registry?: { byPlayerId?: Map<string, any> }, log?: object, options?: Partial<typeof LOAD_GUARD_DEFAULTS>,
   *           intervalMs?: number }} [opts]
   */
  constructor({ registry, log = { info() {}, warn() {}, error() {} }, options = {} } = {}) {
    this.registry = registry || null;
    this.log = log;
    this.opts = { ...LOAD_GUARD_DEFAULTS, ...options };
    /** @type {LoadSample} */
    this._lastSample = { status: 'green', onlineCount: 0, loadScore: 0, cpuPercent: 0, lagMs: 0, freeMemMb: 0, at: 0 };
    this._monitor = monitorEventLoopDelay({ resolution: 20 });
    this._monitor.enable();
    /** true once at least one sample() ran — a fresh guard has no CPU/lag window yet, so it stays green */
    this._sampled = false;
    if (this.opts.intervalMs > 0 && process.env.NODE_ENV !== 'test') {
      this._timer = setInterval(() => this.sample(), this.opts.intervalMs);
      this._timer.unref?.();
    }
  }

  /** Online players and ELS with the same weights as lobby.welcomeInfo (single source of truth kept in sync by tests). */
  onlineCountAndScore() {
    let androidFull = 0; let webFull = 0; let webCore = 0; let webStream = 0;
    if (this.registry?.byPlayerId) {
      for (const s of this.registry.byPlayerId.values()) {
        if (!s.connected) continue;
        const b = s.client?.bundle;
        if (b === 'full' || b === 'android_full') androidFull++;
        else if (b === 'web_full') webFull++;
        else if (b === 'web_core' || b === 'core' || b === 'preloaded') webCore++;
        else webStream++;
      }
    }
    const onlineCount = androidFull + webFull + webCore + webStream;
    const loadScore = Math.round((androidFull * 1.0 + webFull * 1.0 + webCore * 1.5 + webStream * 8.0) * 10) / 10;
    return { onlineCount, loadScore };
  }

  /** Take one sample now (also the periodic callback). @returns {LoadSample} */
  sample() {
    const { onlineCount, loadScore } = this.onlineCountAndScore();
    // getCpuUsagePercent measures "since its previous call": calling it only here (and nowhere else in the
    // interval) yields the true window average; a first-ever call has no baseline and returns a short-window value.
    const cpuPercent = this._sampled ? getCpuUsagePercent() : 0;
    let lagMs = 0;
    try {
      const mean = this._monitor.mean();
      this._monitor.reset();
      lagMs = Number.isFinite(mean) ? Math.round((mean / 1e6) * 10) / 10 : 0;
    } catch { lagMs = 0; }
    const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    this._sampled = true;
    const prev = this._lastSample.status;
    this._lastSample = {
      status: evaluateTier({ onlineCount, loadScore, cpuPercent, lagMs }, this.opts),
      onlineCount, loadScore, cpuPercent, lagMs, freeMemMb,
      at: Date.now(),
    };
    if (prev !== this._lastSample.status) {
      const line = `[loadGuard] ${prev} -> ${this._lastSample.status} (online ${onlineCount}, ELS ${loadScore}, cpu ${cpuPercent}%, lag ${lagMs}ms)`;
      (this._lastSample.status === 'red' ? this.log.warn : this.log.info).call(this.log, line);
    }
    return this._lastSample;
  }

  /** Is admission circuit-broken right now? A guard that never sampled (fresh boot) never blocks. */
  get blocked() { return this._sampled && this._lastSample.status === 'red'; }

  /** Small summary for the welcome frame / lobby.stats — a handful of bytes. */
  summary() {
    const s = this._lastSample;
    return { status: s.status, onlineCount: s.onlineCount, score: s.loadScore, cpuPercent: s.cpuPercent, lagMs: s.lagMs };
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    try { this._monitor.disable(); } catch { /* ignore */ }
  }
}
