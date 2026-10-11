// User playtest #6 item 5 (HUD part) — the boss bar read "0.0%" while the leader kept fighting. The leader's death is a
// sim / match fix (test/match/playtest6-bosspool.test.js: a pool never holds less than 1 HP, so 0 on the HUD means the
// leader is down); the bar itself now (ui/gameLogic.js bossPctText, ui/hud.js PhaseCapsule)
//   * never reads 0.0 % while the leader has HP left (a sliver reads "<0.1%"),
//   * shows the live pool of the battle on screen (its snapshot: the local simulation's own damage on top of b.pool)
//     before the ~1 Hz m.public.bossHp, which lagged the leader's death.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';

const { bossPctText, bossFrac } = await import('../../public/js/ui/gameLogic.js');
const { PhaseCapsule } = await import('../../public/js/ui/hud.js');

/** The text of a vnode tree in document order. */
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const barText = (vnode) => {
  for (const v of walk(vnode)) if (typeof v.props?.class === 'string' && v.props.class.includes('bossbar__txt')) return textOf(v);
  return null;
};

test('bossPctText: whole percents from 10 %, one decimal below, never 0.0 % for a living leader', () => {
  assert.equal(bossPctText(1), '100%');
  assert.equal(bossPctText(0.456), '46%');
  assert.equal(bossPctText(0.1), '10%');
  assert.equal(bossPctText(0.0934), '9.3%');
  assert.equal(bossPctText(0.001), '0.1%');
  assert.equal(bossPctText(800 / 1800000), '<0.1%', 'the user\'s screenshot: a leader a few hundred HP from death');
  assert.equal(bossPctText(1 / 3600000), '<0.1%', 'the last HP point of the largest pool');
  assert.equal(bossPctText(0), '0.0%', 'only a leader that is down reads 0.0 %');
  assert.equal(bossPctText(null), null);
  assert.equal(bossPctText(NaN), null);
  assert.equal(bossPctText(bossFrac({ hp: 1, max: 1800000 })), '<0.1%');
});

test('PhaseCapsule: the live pool of the battle on screen wins over the ~1 Hz m.public value', () => {
  const pub = { phase: PHASE.FINAL_ASSAULT, bossHp: { hp: 900, max: 1800000 } };
  // the local battle already saw the leader die (its snapshot pool is 0): the bar says so at once
  assert.equal(barText(PhaseCapsule({ pub, hud: { killed: 15, total: 20, boss: { hp: 0, max: 1800000 } } })), '0.0%');
  // a living leader never reads 0.0 %
  assert.equal(barText(PhaseCapsule({ pub, hud: { killed: 15, total: 20, boss: { hp: 700, max: 1800000 } } })), '<0.1%');
  // no snapshot yet (the battle is loading): m.public
  assert.equal(barText(PhaseCapsule({ pub, hud: null })), '0.1%', '900 of 1 800 000 = 0.05 %');
  assert.equal(barText(PhaseCapsule({ pub: { phase: PHASE.FINAL_ASSAULT, bossHp: { hp: 900000, max: 1800000 } }, hud: { killed: 1, total: 20, boss: null } })), '50%');
  assert.equal(barText(PhaseCapsule({ pub: { phase: PHASE.FINAL_ASSAULT }, hud: null })), '敌方领袖');
});
