// test/match/fullmatchRun.js — shared runner of the full-match suites (fullmatch*.test.js): a whole match with the REAL
// simulation in virtual time, invariants at every phase change, JSON-safe frames, zero engine errors. Sim / content
// errors ('[sim] …', owned by the sim and content teams) are collected in `simIssues` and reported by the suites.
// Combat is client-side by default (DESIGN §14, the production mode): every human seat is a SimClient that simulates
// its specs and reports b.progress / b.result; honest clients must never be rejected or taken over, and no combat
// frame is streamed. `clientCombat: false` runs the server-run fallback.
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, checkInvariants } from './harness.js';

export const SEEDS = Number(process.env.MATCH_SEEDS || 20);
export const simIssues = new Set();

export function reportSimIssues() {
  if (simIssues.size) console.log(`sim/content errors seen during full matches (not match-engine errors):\n${[...simIssues].slice(0, 20).map((x) => '  ' + x).join('\n')}`);
}

export function runFull({ mode, difficulty, humans, bots, seed, boostLp = null, clientCombat = true, pace = 'instant' }) {
  const h = makeMatch({ mode, difficulty, humans, bots, seed, captureFrames: false, checkFrames: true, clientCombat, pace });
  h.autoHumans();
  const m = h.m;
  m.start();
  let last = '';
  let boosted = false;
  let phases = 0;
  h.run(() => {
    const key = `${m.phase}:${m.round}`;
    if (key !== last) {
      last = key;
      phases++;
      checkInvariants(m);
      if (boostLp && !boosted && m.phase === PHASE.PREP && m.round === 1) {
        boosted = true;
        for (const ps of m.players.values()) ps.lp = boostLp;
      }
    }
    return h.ended != null;
  }, { maxSteps: 5e6 });
  assert.ok(h.ended, `${mode}/${difficulty}/${seed}: match did not end (${m.phase} R${m.round})`);
  assert.equal(h.endedCount, 1);
  assert.equal(m.phase, PHASE.RESULT);
  assert.equal(m.errorCount, 0, `${mode}/${difficulty}/${seed}: match errors ${JSON.stringify(m.errors.slice(0, 2))}`);
  assert.deepEqual(h.sched.errors, []);
  // engine errors must be zero; errors raised inside the simulation / its content ('[sim] …', owned by the sim and
  // content teams) are collected and reported as test diagnostics instead
  const engineErrors = h.logs.error.filter((l) => !l.startsWith('[sim]'));
  assert.deepEqual(engineErrors, [], `${mode}/${difficulty}/${seed}: logged errors`);
  for (const l of h.logs.error) if (l.startsWith('[sim]')) simIssues.add(l.split(' | ')[0].slice(0, 160));
  assert.deepEqual(h.badFrames, [], 'every frame is JSON-safe');
  assert.equal(m.dispatcher.errors, 0);
  checkInvariants(m);
  if (clientCombat) {
    assert.equal(m.verifyStats.rejected, 0, `${mode}/${difficulty}/${seed}: an honest client result was rejected`);
    assert.equal(m.verifyStats.takeovers, 0, `${mode}/${difficulty}/${seed}: unexpected takeover`);
    assert.equal(h.frames, 0, 'no b.snap / b.ev under client-side combat');
    for (const c of h.clients.values()) assert.ok(c.log.some((x) => x.t === 'b.result'), 'every human reported its battles');
  }
  const res = h.lastTo('p_0', 'm.result');
  assert.ok(res && res.playerId === 'p_0');
  assert.ok(phases > 5);
  m.dispose();
  if (h.clients) h.clients.closeAll();
  assert.equal(h.sched.pending(), 0);
  return { h, m, res: h.ended };
}
