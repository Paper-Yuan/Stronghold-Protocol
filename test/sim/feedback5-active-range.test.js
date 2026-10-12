// test/sim/feedback5-active-range.test.js — the owner's rule of 2026-10-05 (a deliberate deviation, like DESIGN §21.29):
// a MANUAL skill on the basic strategy whose attack range while it runs strictly contains the operator's own range casts
// as soon as an enemy (a heal skill: an injured ally) is inside that larger range — trigger ACTIVE_RANGE, resolved by
// tools/build-data.mjs resolveTrigger (customRangeGrid = the running range) and checked every tick by server/sim/skills.js.
// Community report: 「有的干员开技能后的攻击范围比平时攻击范围大，但是怪走到平时的攻击范围内才会开技能」.
// The owner's further decisions of the same day: the rule also replaces the SEARCH row ("在初始攻击范围内存在敌人时释放技能":
// 薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2, 安洁莉娜 S3) and covers 深巡 S2 on top of its §21.29 DEFAULT (its 3-2 over her
// 2-2: test/sim/feedback1-tank-triggers.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';

const ds = getDefaultSource();
const BASE = [[0, 0], [0, 1]];                                   // 1-1
const WIDE = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [-1, 1]];  // strictly contains 1-1
const op = (o = {}) => chessRec({
  id: 't_op', rangeGrid: BASE, ...o,
  skill: { spCost: 1, initSp: 1, duration: 5, trigger: { rule: 'ACTIVE_RANGE', rawRule: 'DEFAULT', customRangeGrid: WIDE }, ...(o.skill || {}) },
});
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const arena = (o = {}) => makeBattle({
  defs: { chess: { t_op: op(o.chess), t_ally: chessRec({ id: 't_ally', skill: null, stats: { maxHp: 1e4 } }) }, enemies: { e: dummy('e'), f: dummy('f', { motion: 'FLY' }) } },
  units: [{ chessId: 't_op', row: 10, col: 4, dir: 'RIGHT' }, ...(o.units || [])], enemies: o.enemies || [],
  hooks: ['skillStart', 'attack'], captureNoisy: true, autoFinish: false, timeLimit: 30, seed: 3, content: 'generic',
});
const casts = (h, u) => h.hooksOf('skillStart').filter((c) => c.unit === u);
const done = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); checkInvariants(h.b); };

test('ACTIVE_RANGE: an enemy inside the running range only casts the skill at once (no attack); nobody, or an enemy outside it, does not', () => {
  // (10,7) = [0,3]: the running range only — out of reach of the 1-1 attack
  const h = arena({ enemies: [{ key: 'e', pos: [10, 7] }] });
  const u = h.unit('t_op');
  assert.equal(u.skill.rule, 'ACTIVE_RANGE');
  assert.ok(h.runUntil(() => casts(h, u).length > 0, 2), 'cast');
  assert.equal(casts(h, u)[0].reason, 'ACTIVE_RANGE');
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u).length, 0, 'before any attack (DEFAULT would wait for one)');
  done(h);
  const none = arena();
  none.run(5);
  assert.equal(casts(none, none.unit('t_op')).length, 0, 'no enemy: no cast');
  done(none);
  const far = arena({ enemies: [{ key: 'e', pos: [10, 8] }] });   // [0,4]: outside the running range too
  far.run(5);
  assert.equal(casts(far, far.unit('t_op')).length, 0, 'an enemy outside the running range: no cast');
  done(far);
});

test('ACTIVE_RANGE: the DEFAULT condition on the larger range — no flyer for a ground-only unit; the permanent 攻击距离 grows it', () => {
  const fly = arena({ enemies: [{ key: 'f', pos: [10, 7], route: 2 }] });
  fly.run(5);
  assert.equal(casts(fly, fly.unit('t_op')).length, 0, 'a melee unit cannot target the flyer: no cast');
  done(fly);
  // [0,4] is in the running range grown by a permanent rangeExtend +1 (modules / talents "攻击距离+1": baseRangeExtend)
  const ext = arena({ enemies: [{ key: 'e', pos: [10, 8] }] });
  const u = ext.unit('t_op');
  ext.step();
  ext.b.addBuff(u, { key: 'test:range', mods: { rangeExtend: 1 }, persist: true });
  assert.ok(ext.runUntil(() => casts(ext, u).length > 0, 2), 'cast on the grown range');
  done(ext);
});

test('ACTIVE_RANGE heal skill: an injured ally inside the running range only casts it; a healthy one does not', () => {
  const medic = { profession: 'MEDIC', subProfessionId: 'physician', rangeGrid: BASE, skill: { trigger: { rule: 'ACTIVE_RANGE', rawRule: 'DEFAULT', customRangeGrid: WIDE } } };
  const h = arena({ chess: medic, units: [{ chessId: 't_ally', row: 10, col: 7 }] });
  const u = h.unit('t_op'), a = h.unit('t_ally');
  h.run(3);
  assert.equal(casts(h, u).length, 0, 'nobody to heal: no cast');
  a.hp = a.s.maxHp / 2;
  assert.ok(h.runUntil(() => casts(h, u).length > 0, 2), 'an injured ally at [0,3]: cast');
  done(h);
});

test('real data: 莫斯提马 S3 序时之匙 (3-15 over her 3-6) casts on its running range; 白面鸮 S2 脑啡肽 (y-7 over y-2, a heal) resolves to it too', () => {
  const MOST = 'chess_char_4_02_a', PLOSIS = 'chess_char_4_21_a';
  const d = ds.getChess(MOST);
  assert.equal(d.skill.trigger.rule, 'ACTIVE_RANGE');
  assert.equal(ds.getChess(PLOSIS).skill.trigger.rule, 'ACTIVE_RANGE');
  // an enemy on a field tile of 3-15 that 3-6 lacks (she stands at (10,3) facing right)
  const base = new Set(absoluteRangeKeys(d.rangeGrid, 10, 3, 'RIGHT', 0));
  const k = absoluteRangeKeys(d.skill.trigger.grid, 10, 3, 'RIGHT', 0).find((x) => !base.has(x) && ((x / COLS) | 0) >= 9 && ((x / COLS) | 0) <= 12);
  assert.ok(k != null);
  const h = makeBattle({
    defs: { enemies: { e: dummy('e') } }, units: [{ chessId: MOST, row: 10, col: 3, dir: 'RIGHT' }],
    enemies: [{ key: 'e', pos: [(k / COLS) | 0, k % COLS] }], hooks: ['skillStart'], autoFinish: false, timeLimit: 30,
  });
  const u = h.unit(MOST);
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2), '莫斯提马 S3 cast');
  assert.equal(casts(h, u)[0].reason, 'ACTIVE_RANGE');
  done(h);
});

test('real data: the SEARCH row widened — 安洁莉娜 S3 秘杖·反重力模式 (y-4 over her y-2) casts on an enemy of the y-4 only, no attack needed; her S2 (no range change) keeps SEARCH on the y-2', () => {
  const AGL = 'chess_char_5_20_a';
  const idx = (sid) => ds.getChess(AGL).raw.skills.find((s) => s.skillId === sid).index;
  const s3 = ds.getChess(AGL, { skillIndex: idx('skchr_aglina_3') }).skill, s2 = ds.getChess(AGL, { skillIndex: idx('skchr_aglina_2') }).skill;
  assert.equal(s3.trigger.rule, 'ACTIVE_RANGE');
  assert.deepEqual(s3.trigger.grid, s3.rangeGrid, 'the trigger grid is the y-4 she attacks with');
  assert.equal(s2.trigger.rule, 'SEARCH');
  // (10,6) = [0,3]: on the y-4, not on her y-2
  for (const [sid, want] of [['skchr_aglina_3', 1], ['skchr_aglina_2', 0]]) {
    const h = makeBattle({
      defs: { enemies: { e: dummy('e') } }, units: [{ chessId: AGL, row: 10, col: 3, dir: 'RIGHT', skillIndex: idx(sid) }],
      enemies: [{ key: 'e', pos: [10, 6] }], hooks: ['skillStart'], autoFinish: false, timeLimit: 30,
    });
    const u = h.unit(AGL);
    h.step();
    u.skill.gainSp(1000);
    h.run(4);
    assert.equal(casts(h, u).length, want, `${sid}: ${want ? 'cast on the y-4' : 'the enemy is outside the initial y-2'}`);
    if (want) assert.equal(casts(h, u)[0].reason, 'ACTIVE_RANGE');
    done(h);
  }
});
