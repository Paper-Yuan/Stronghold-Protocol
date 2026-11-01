// test/content/relic-n19-stun.test.js — 湮灭模拟 n19 「未尽的生命」的晕眩重做 (the Annihilation mod's v3.2.0 fix)
//
// What the relic does now, and why these three cases pin it (handoff/EXTENSION-MODE-2026-10-27.md §7.2, docs/EXTENSION_MODE.md):
//   1. the OPENING batch fires one draw for the whole batch, `count` units, after DEPLOY_PROTECT + 0.05 s — not one draw
//      per deployed unit (the old code re-picked `count` on every `deploy` event, so a 7-unit opening stunned 7 units);
//   2. a mid-battle REDEPLOY stuns only the unit that just came in, for redeployDur — it must not drag bystanders in;
//   3. 【移动】 (`ctx.move`, tiles.js moveRedeploy) is not a redeploy and stuns nobody.
// The `count` growth (1 at acquisition, +perRound per round) is unchanged and pinned by the display test elsewhere; the
// case below checks the opening pick honours it at a later round.
//
// These build a real Battle through test/helpers/battleHarness.js rather than a Match: the relic's battle half reads
// `ps.input.relicMods` (server/sim/content/relics.js), which the harness passes through untouched, so the rule runs
// end-to-end without an annihilation room. That is the only path that reaches the delayed stun at all — the match-level
// tests in test/match/annihilation-mode.test.js never step a Battle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBattle } from '../helpers/battleHarness.js';
import { DEPLOY_PROTECT } from '../../server/sim/constants.js';

/** Two low-tier operators that survive long enough for a deploy effect to land on them. */
const SQUAD = ['chess_char_1_02_a', 'chess_char_1_03_a'];

/** A battle holding `SQUAD` on the field with n19's rule installed for the player, and no enemies to kill them. */
function battleWithN19({ count = 1, perRound = 1, max = 4, dur = 10, redeployDur = 5, fromRound = 1, round = 1 } = {}) {
  const units = SQUAD.map((chessId, i) => ({ chessId, kind: 'chess', col: 5 + i, row: 10, facing: 'RIGHT' }));
  const rule = { count, perRound, max, dur, redeployDur, fromRound };
  // The relic's battle half reads `ps.input.relicMods` at install time (server/sim/content/relics.js), and content is
  // installed in the Battle constructor — so the rule has to ride in on the player input the harness builds, not be
  // attached afterwards by opts.setup (which runs too late).
  const h = makeBattle({
    seed: 11,
    kind: 'normal',
    round,
    units,
    enemies: [],
    timeLimit: 40,
    autoFinish: false,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: units.map((u, i) => ({ uid: i + 1, kind: 'chess', chessId: u.chessId, row: u.row, col: u.col })),
      bonds: {}, bandId: null, playerEffects: [],
      relicMods: { ally: {}, allyElite: {}, rules: { stunOnDeploy: rule } },
    }],
  });
  return h.b;
}

/** The ops on the field that hold a stun status right now (a buff's id is its `key`; `status` is the same for stun). */
function stunned(b) {
  return (b.players[0]?.units ?? []).filter((u) => u.alive && u.deployed && u.buffs.some((x) => x.key === 'stun'));
}

/** Step the battle until `seconds` of game time have passed (step() advances one tick). */
function advance(b, seconds) {
  const until = b.time + seconds;
  while (b.time < until - 1e-9) b.step();
}

test('n19: the opening batch stuns at most `count` units, not one per deployed unit', () => {
  const b = battleWithN19({ count: 1, perRound: 0, max: 4, dur: 10 });
  // the opening batch deploys on the first step; the draw itself is deferred past the deployment animation
  b.step();
  assert.ok(openedUnits(b).length >= 2, 'the field holds a squad to stun');
  assert.equal(stunned(b).length, 0, 'no stun before DEPLOY_PROTECT elapses');
  advance(b, DEPLOY_PROTECT + 0.5);
  assert.equal(stunned(b).length, 1, 'count=1 leaves exactly one operator stunned, whatever the batch size');
  assert.equal(b.errorCount, 0, JSON.stringify(b.errors));
});

test('n19: the opening pick still grows with the round (count 1 → 2 by the next round)', () => {
  const b = battleWithN19({ count: 1, perRound: 1, max: 4, dur: 10, fromRound: 1, round: 2 });
  advance(b, DEPLOY_PROTECT + 0.5);
  assert.equal(stunned(b).length, 2, 'count = 1 + 1 round elapsed = 2');
  assert.equal(b.errorCount, 0, JSON.stringify(b.errors));
});

test('n19: a mid-battle redeploy stuns only that operator, and 【移动】 stuns nobody', () => {
  const b = battleWithN19({ count: 1, perRound: 0, max: 4, dur: 10, redeployDur: 5 });
  advance(b, DEPLOY_PROTECT + 0.5);
  assert.equal(stunned(b).length, 1, 'the opening pick landed');
  // clear the opening stun so a bystander count is unambiguous
  for (const u of openedUnits(b)) b.removeBuff(u, 'stun');
  assert.equal(stunned(b).length, 0, 'stuns cleared before the redeploy case');

  const [a, bystander] = openedUnits(b);
  assert.ok(bystander, 'a second operator stands as the bystander');

  // 移动 is not a redeploy: tiles.js emits { initial: false, move: true } and the relic must ignore it
  b.emit('deploy', { unit: a, initial: false, move: true });
  advance(b, DEPLOY_PROTECT + 0.5);
  assert.equal(stunned(b).length, 0, '【移动】 must not stun anybody');

  // a real redeploy: the unit comes back (a new deploySeq) and only it is stunned
  a.deploySeq = (a.deploySeq || 1) + 1;
  b.emit('deploy', { unit: a, initial: false });
  advance(b, DEPLOY_PROTECT + 0.5);
  const after = stunned(b);
  assert.equal(after.length, 1, 'exactly the redeployed operator is stunned');
  assert.equal(after[0], a, 'and it is that operator, not the bystander');
  const stunBuff = a.buffs.find((x) => x.key === 'stun');
  assert.ok(stunBuff && stunBuff.duration > 0, 'the redeploy stun has a duration');
  assert.equal(b.errorCount, 0, JSON.stringify(b.errors));
});

/** The player's deployed operators (the opening batch). */
function openedUnits(b) {
  return (b.players[0]?.units ?? []).filter((u) => u.alive && u.deployed);
}
