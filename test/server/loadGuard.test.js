// test/server/loadGuard.test.js — three-tier admission guard: pure tier evaluation, sampling, breaker semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTier, LoadGuard, LOAD_GUARD_DEFAULTS } from '../../server/loadGuard.js';

const green = { onlineCount: 10, loadScore: 12, cpuPercent: 20, lagMs: 5 };

test('evaluateTier: thresholds', () => {
  assert.equal(evaluateTier(green), 'green');
  assert.equal(evaluateTier({ ...green, onlineCount: 159 }), 'green');
  assert.equal(evaluateTier({ ...green, onlineCount: LOAD_GUARD_DEFAULTS.onlineWarn }), 'yellow');
  assert.equal(evaluateTier({ ...green, onlineCount: LOAD_GUARD_DEFAULTS.onlineRed }), 'red');
  assert.equal(evaluateTier({ ...green, loadScore: LOAD_GUARD_DEFAULTS.elsWarn }), 'yellow');
  assert.equal(evaluateTier({ ...green, loadScore: LOAD_GUARD_DEFAULTS.elsRed }), 'red');
  assert.equal(evaluateTier({ ...green, cpuPercent: 81 }), 'yellow');
  assert.equal(evaluateTier({ ...green, cpuPercent: LOAD_GUARD_DEFAULTS.cpuRedPct }), 'red');
  assert.equal(evaluateTier({ ...green, lagMs: 61 }), 'yellow');
  assert.equal(evaluateTier({ ...green, lagMs: LOAD_GUARD_DEFAULTS.lagRedMs }), 'red');
});

test('evaluateTier: red beats yellow, custom thresholds honored', () => {
  assert.equal(evaluateTier({ onlineCount: 300, cpuPercent: 99, lagMs: 500, loadScore: 500 }), 'red');
  assert.equal(evaluateTier({ onlineCount: 300, cpuPercent: 99, lagMs: 500, loadScore: 500 }), 'red');
  const t = { onlineWarn: 5, onlineRed: 10, elsWarn: 50, elsRed: 100, cpuWarnPct: 50, cpuRedPct: 90, lagWarnMs: 10, lagRedMs: 20 };
  const quiet = { onlineCount: 1, loadScore: 2, cpuPercent: 20, lagMs: 1 };
  assert.equal(evaluateTier({ ...quiet, onlineCount: 5 }, t), 'yellow');
  assert.equal(evaluateTier({ ...quiet, onlineCount: 10 }, t), 'red');
  assert.equal(evaluateTier({ ...quiet, cpuPercent: 51 }, t), 'yellow', 'custom cpu warn threshold');
});

test('LoadGuard: ELS weights match the welcome frame weights (lobby.welcomeInfo)', () => {
  const sessions = new Map();
  const mk = (bundle, connected = true) => ({ connected, client: { bundle } });
  // same mix as an online count of 4: 1 android_full, 1 web_full, 1 web_core, 1 stream
  sessions.set('a', mk('android_full'));
  sessions.set('b', mk('web_full'));
  sessions.set('c', mk('web_core'));
  sessions.set('d', mk('stream'));
  sessions.set('e', mk('web_full', false)); // disconnected sessions never count
  const guard = new LoadGuard({ registry: { byPlayerId: sessions }, options: { intervalMs: 0 } });
  const { onlineCount, loadScore } = guard.onlineCountAndScore();
  assert.equal(onlineCount, 4);
  assert.equal(loadScore, 1 + 1 + 1.5 + 8); // 11.5
});

test('LoadGuard: a fresh guard never blocks (no sample yet); blocked follows the sample tier', () => {
  const guard = new LoadGuard({ options: { intervalMs: 0 } });
  assert.equal(guard.blocked, false, 'never-sampled guard stays green');
  // inject a red sample through the registry: 200+ streamers
  const sessions = new Map();
  for (let i = 0; i < 210; i++) sessions.set('p' + i, { connected: true, client: { bundle: 'stream' } });
  guard.registry = { byPlayerId: sessions };
  const s = guard.sample();
  assert.equal(s.status, 'red');
  assert.equal(guard.blocked, true);
  assert.equal(guard.summary().status, 'red');
  assert.ok(guard.summary().onlineCount >= 200);
  guard.stop();
});

test('LoadGuard: sample transitions are logged once per change', () => {
  const lines = { info: [], warn: [] };
  const log = { info: (...a) => lines.info.push(a.join(' ')), warn: (...a) => lines.warn.push(a.join(' ')), error() {} };
  const guard = new LoadGuard({ log, options: { intervalMs: 0 } });
  guard.sample(); // green baseline
  const sessions = new Map();
  for (let i = 0; i < 170; i++) sessions.set('p' + i, { connected: true, client: { bundle: 'web_full' } });
  guard.registry = { byPlayerId: sessions };
  guard.sample(); // -> yellow
  guard.sample(); // stays yellow: no extra log
  guard.stop();
  assert.equal(lines.info.length, 1);
  assert.match(lines.info[0], /green -> yellow/);
});
