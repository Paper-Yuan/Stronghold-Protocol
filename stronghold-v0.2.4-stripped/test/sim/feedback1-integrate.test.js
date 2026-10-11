// Integration regressions found while merging the feedback1 workstreams (player feedback after 0.1.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });

// A full co-op match (fullmatch-coop3, seed 116) had a 联防 battle end at its time limit while 隐德来希's S3 candles were
// standing: the result listed the 心烛 (enemy_5601_entlec, in no spawn schedule) as a leak and the server rejected the
// honest client's result ('leak key'). A candle follows its original; only the originals count at the limit.
test('隐德来希 S3: candles still standing at the time limit are no leaks (the originals are)', () => {
  const h = makeBattle({
    defs: { enemies: { e_a: dummy('e_a', { hp: 1e6 }), e_b: dummy('e_b', { hp: 2e6 }) } },
    units: [{ chessId: 'chess_char_5_06_a', row: 9, col: 4 }],
    enemies: [{ key: 'e_a', pos: [10, 5] }, { key: 'e_b', pos: [9, 5] }],
    timeLimit: 6,
  });
  const u = h.unit('chess_char_5_06_a');
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'S3 starts');
  assert.ok(h.b.enemies.some((e) => e.alive && e.mem.candleOwner === u), 'candles stand');
  assert.ok(h.runUntil(() => h.b.finished, 10), 'the battle reaches its time limit');
  const r = h.result();
  assert.equal(r.reason, 'timeout');
  const leaked = Object.values(r.perPlayer).flatMap((p) => p.leaked).map((l) => l.enemyKey);
  assert.ok(!leaked.includes('enemy_5601_entlec'), `no candle leak: ${leaked.join(',')}`);
  assert.equal(leaked.filter((k) => /e_a|e_b/.test(k)).length, 2, 'both originals count');
  assert.deepEqual(h.b.errors.map((e) => e.message), []);
  checkInvariants(h.b);
});

// WH (维娜·维多利亚 S3: a 黄金盟誓 on every free melee tile around her) × WC (战场#08's 深水区 refuses deployment): the
// lions go through grid.canStand, so none lands in the water — e.g. 维娜 on (9,5) skips (10,6).
test('维娜·维多利亚 S3 on 战场#08 (涨潮控制): no 黄金盟誓 in the 深水区', () => {
  const VINA = 'chess_char_6_07_a', LION = 'token_10040_siege2_vlion', STAGE = 'act2autochess_m04';
  const st = getDefaultSource().getStage(STAGE);
  const water = new Set();
  st.raw.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (st.raw.tiles[ch]?.tileKey === 'tile_deepsea') water.add(`${r},${c}`); }));
  assert.ok(water.has('10,6') && water.has('11,6') && water.has('12,6'), `the board's pool: ${[...water].join(' ')}`);
  let lions = 0;
  for (const [r, c] of [[9, 5], [11, 5], [10, 5], [10, 7], [11, 7]]) {
    const h = makeBattle({
      stageId: STAGE, defs: { enemies: { e_d: dummy('e_d', { hp: 1e9 }) } },
      units: [{ chessId: VINA, row: r, col: c }], enemies: [{ key: 'e_d', pos: [r, c + 1] }], autoFinish: false, timeLimit: 30,
    });
    h.step();
    const u = h.unit(VINA);
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 8), `S3 at (${r},${c})`);
    const placed = h.b.allyUnits.filter((a) => a.alive && a.defId === LION);
    lions += placed.length;
    for (const l of placed) assert.ok(!water.has(`${l.tileR},${l.tileC}`), `a lion of 维娜 (${r},${c}) in the water at (${l.tileR},${l.tileC})`);
    checkInvariants(h.b);
  }
  assert.ok(lions >= 20, `${lions} lions placed`);
});
