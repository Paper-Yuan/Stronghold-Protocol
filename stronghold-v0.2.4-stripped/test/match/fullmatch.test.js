// Full matches with the REAL simulation (server/sim/Battle.js) run to RESULT in virtual time with zero errors:
// solo × every difficulty and co-op 2/3/4 (humans on "AI 托管" + AI teammates), 20 seeds each; invariants checked at
// every phase change; every m.public / m.private frame JSON-safe. Plus boosted-LP runs that reach the Final Assault
// with the real sim.
// The co-op configurations live in fullmatch-coop*.test.js (separate files run in parallel).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, checkInvariants } from './harness.js';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
  test(`solo ${difficulty}: ${SEEDS} seeds to RESULT with zero errors`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) runFull({ mode: 'solo', difficulty, humans: 1, bots: 0, seed });
  });
}

test('boosted LP: the real sim reaches the Final Assault (solo FUNNY R9, co-op NORMAL R14) and ends cleanly', () => {
  for (const seed of [1, 2]) {
    const { res } = runFull({ mode: 'solo', difficulty: 'FUNNY', humans: 1, bots: 0, seed, boostLp: 400 });
    assert.ok(res.roundsPassed >= 8, `reached the boss round (${res.roundsPassed})`);
  }
  const { res } = runFull({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, boostLp: 400 });
  assert.ok(res.roundsPassed >= 13);
});

test('determinism: the same seed and inputs give the same match (client-side and server-run combat)', () => {
  const a = runFull({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 2, seed: 4242 }).res;
  const b = runFull({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 2, seed: 4242 }).res;
  const strip = (r) => JSON.stringify({ ...r, durationMs: 0 });
  assert.equal(strip(a), strip(b));
  const c = runFull({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 2, seed: 4243 }).res;
  assert.notEqual(strip(a), strip(c));
  const s1 = runFull({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 2, seed: 4242, clientCombat: false }).res;
  const s2 = runFull({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 2, seed: 4242, clientCombat: false }).res;
  assert.equal(strip(s1), strip(s2));
});

test('server-run fallback (SP_COMBAT=server): solo and co-op matches still run to RESULT with zero errors', () => {
  runFull({ mode: 'solo', difficulty: 'HARD', humans: 1, bots: 0, seed: 77, clientCombat: false });
  runFull({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 78, clientCombat: false });
});

test('degraded data (chess + bands only, no config/waves/stages): a bot match still runs to RESULT without errors', async () => {
  const { DATA } = await import('./harness.js');
  const data = { chess: DATA.chess, bands: DATA.bands, bonds: DATA.bonds };
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 9, data, captureFrames: false, clientCombat: true });
  h.autoHumans();
  h.m.start();
  h.run(() => h.ended != null, { maxSteps: 2e6 });
  assert.ok(h.ended, `ended (${h.m.phase} R${h.m.round})`);
  assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors.slice(0, 2)));
  checkInvariants(h.m);
  h.m.dispose();
});
