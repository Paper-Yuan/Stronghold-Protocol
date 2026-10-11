// Community report of 2026-10-06 「Touch策略给的医疗干员会跟炎盟约的炎祐冲突，无法同时出场」 (item 23): the 炎 bond's 炎佑 and the
// 外勤医疗 map character spawn at the same battle start; the 炎佑's free-tile search (tokens.js airTile: void tiles nearest the
// half's centre) took the medic's stage slot (data/stages.json mapChars, (10, 2)) on 战场#08 涨潮控制 (and 战场#07 with two
// 炎佑), so the medic found its tile taken and never stood. The map characters' positions are held for them now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const YAN = ['chess_char_1_03', 'chess_char_2_04', 'chess_char_3_03', 'chess_char_3_04', 'chess_char_4_15', 'chess_char_4_17', 'chess_char_5_03', 'chess_char_5_12', 'chess_char_6_03'];
const TILES = [[9, 3], [9, 4], [10, 3], [10, 4], [11, 3], [11, 4], [9, 5], [11, 5], [10, 5]];

function tokensAt(stageId, n, elite = false) {
  const h = makeBattle({
    stageId, units: YAN.slice(0, n).map((id, i) => ({ chessId: `${id}_${elite && i < 2 ? 'b' : 'a'}`, row: TILES[i][0], col: TILES[i][1] })),
    bonds: { yanShip: { count: n, layers: 1, active: true, tier: n >= 9 ? 3 : 2 } }, bandId: 'band_amedic', timeLimit: 10, seed: 1, autoFinish: false,
  });
  h.step(3);
  const toks = h.b.allyUnits.filter((u) => u.kind === 'token' && u.alive);
  return {
    yan: toks.filter((u) => u.defId === 'enemy_9012_acloon'),
    medic: toks.find((u) => u.defId === 'char_605_cmedic' || u.defId === 'char_613_acmedc') ?? null,
  };
}

test('战场#08 涨潮控制: the 炎佑 and 外勤医疗\'s medic both stand, the medic on its own slot', REAL, () => {
  const t = tokensAt('act2autochess_m04', 6);
  assert.equal(t.yan.length, 1);
  assert.ok(t.medic, 'the medic stands (the parent: none — the 炎佑 sat on (10, 2))');
  assert.deepEqual([t.medic.tileR, t.medic.tileC], [10, 2]);
  assert.ok(!(t.yan[0].tileR === 10 && t.yan[0].tileC === 2));
  const touch = tokensAt('act2autochess_m04', 6, true);
  assert.equal(touch.medic?.defId, 'char_613_acmedc', 'two elites: Touch, on the same slot');
});

test('9 炎: two 炎佑 and the medic on every season map', REAL, () => {
  for (const stageId of ['act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04']) {
    const t = tokensAt(stageId, 9);
    assert.equal(t.yan.length, 2, stageId);
    assert.ok(t.medic, `${stageId}: the medic stands`);
  }
});
