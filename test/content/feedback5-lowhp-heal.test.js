// test/content/feedback5-lowhp-heal.test.js — the module trait "治疗生命值低于50%的友方单位时治疗量提升15%" (PHY-X / GUA-X) compares the
// target's HP the way the client's module buff does (follow-up 19): FilterByTargetHpRatio LT — strictly below — for 瑕光 /
// 古米 / 塞雷娅's GUA-X (set_heal_scale_by_hpratio) and 录武官's PHY-X (reckpr_e_002_tr); LE — at or below — for the template
// heal_scale_up[hpratio][LE] of 华法琳's and 闪灵's PHY-X (and 黍's GUA-X, 凯尔希's PHY-X, already so). The text's 「低于」 is the
// display; the buff templates decide (the local client's [uc]equips.ab prefabs and buff_template_data, read 2026-10-06).
// Run: node --test test/content/feedback5-lowhp-heal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const WALL = chessRec({ id: 't_wall', stats: { maxHp: 1e6, atk: 0, def: 0 }, skill: null });

/** The bonus factor `healer` gives a heal on an ally at `ratio` of its max HP (1 = none). */
function factorAt(unitSpec, ratio) {
  const h = makeBattle({ defs: { chess: { t_wall: WALL } }, units: [unitSpec, { chessId: 't_wall', row: 11, col: 5 }], autoFinish: false, timeLimit: 30, seed: 3 });
  h.step();
  const healer = h.b.allyUnits.find((u) => u.uid === 1), t = h.unit('t_wall');
  t.hp = t.s.maxHp * ratio;
  const before = t.hp;
  const base = 100 * healer.s.healingDealtMul * t.s.healingTakenMul;
  h.b.heal(healer, t, 100);
  checkInvariants(h.b);
  return (t.hp - before) / base;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('LE (heal_scale_up[hpratio][LE]): 华法琳 (tier 4 and 5) and 闪灵 PHY-X heal an ally at exactly 50 % HP ×1.15', () => {
  for (const id of ['chess_char_4_26_b', 'chess_char_5_04_b']) {
    near(factorAt({ uid: 1, chessId: id, row: 10, col: 5 }, 0.5), 1.15, `${id} at 50 %`);
    near(factorAt({ uid: 1, chessId: id, row: 10, col: 5 }, 0.6), 1, `${id} at 60 %`);
  }
  const shining = { uid: 1, diy: { slot: 6, charId: 'char_147_shining', skillIndex: 0, uniEquipId: 'uniequip_003_shining' }, elite: true, row: 10, col: 5 };
  near(factorAt(shining, 0.5), 1.15, '闪灵 PHY-X at 50 %');
  near(factorAt(shining, 0.6), 1, '闪灵 PHY-X at 60 %');
});

test('LT (set_heal_scale_by_hpratio, reckpr_e_002_tr): 塞雷娅 GUA-X and 录武官 PHY-X (tier 4 and 5) give nothing at exactly 50 %, ×1.15 below', () => {
  for (const id of ['chess_char_5_11_b', 'chess_char_4_15_b', 'chess_char_5_23_b']) {
    near(factorAt({ uid: 1, chessId: id, row: 10, col: 5 }, 0.5), 1, `${id} at 50 %`);
    near(factorAt({ uid: 1, chessId: id, row: 10, col: 5 }, 0.49), 1.15, `${id} at 49 %`);
  }
});
