// Full co-op matches with the REAL simulation (humans on "AI 托管" + AI teammates), MATCH_SEEDS (20) seeds each, to RESULT with
// zero errors — split from fullmatch.test.js so the long co-op runs execute in parallel files.
import { test, after } from 'node:test';
import { SEEDS, runFull, reportSimIssues } from './fullmatchRun.js';

after(reportSimIssues);

for (const [humans, bots, difficulty] of [[4, 0, 'FUNNY']]) {
  test(`co-op ${humans} human(s) + ${bots} AI (${difficulty}): ${SEEDS} seeds to RESULT with zero errors`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) runFull({ mode: 'coop', difficulty, humans, bots, seed: 100 + seed });
  });
}
