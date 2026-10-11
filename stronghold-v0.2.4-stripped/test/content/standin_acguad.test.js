// test/content/standin_acguad.test.js — the 补位 stand-in Sharp (char_609_acguad, 6★ 近卫·无畏者; kit
// server/sim/content/kits/ops/standin-acguad.js) on every chess it replaces: 忍冬 (tier 3, S3), 银灰 / 百炼嘉维尔 (tier 4,
// S2), 隐德来希 / 归溟幽灵鲨 (tier 5, S3 + DRE-X), 佩佩 (tier 6, S3 + DRE-X), normal (E2 Lv1, skill 4) and elite (E2
// Lv60, skill 7). Every number is read back from data/backups.json (the form of that chess's status).
// Run: node --test test/content/standin_acguad.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitForm } from '../../shared/standIn.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CHAR = 'char_609_acguad';
const UNIT = BACKUPS.units[CHAR];
const formOf = (id) => unitForm(BACKUPS, CHAR, CHESS[id].status);
const skillOf = (id, index) => formOf(id).skills.find((s) => s.index === index);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };

function battle(units, o = {}) {
  return makeBattle({
    defs: { enemies: ENEMIES }, units, timeLimit: o.timeLimit ?? 400, autoFinish: false, seed: o.seed ?? 5,
    flags: { dpPerSec: 0 }, hooks: ['damaged', 'skillStart', 'skillEnd'], captureNoisy: true,
  });
}
/** Damage instances of the unit's attacks (normal or skill). */
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
/** Damage instances per attack (attackId), in order. */
function perAttack(hits) {
  const m = new Map();
  for (const c of hits) m.set(c.dmg.attackId, (m.get(c.dmg.attackId) ?? 0) + 1);
  return [...m.values()];
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('Sharp on every chess it replaces (normal + elite): its body, the chess\'s backup skill, this kit; DRE-X on the tier-5 / 6 elites only', () => {
  const ids = UNIT.standsIn.flatMap((a) => [a, a.replace(/_a$/, '_b')]);
  assert.equal(ids.length, 12);
  const withModule = [];
  for (const id of ids) {
    const c = CHESS[id], form = formOf(id);
    const h = battle([{ chessId: id, row: 10, col: 4, standIn: true }]);
    h.step();
    const u = h.unit(1);
    const sk = form.skills.find((s) => s.index === c.backup.skillIndex);
    assert.deepEqual([u.def.charId, u.def.standInFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [CHAR, c.charId, sk.skillId, false, 'skills'], id);
    const mod = c.backup.uniEquipId && c.status.equipLevel > 0 ? form.modules.find((m) => m.uniEquipId === c.backup.uniEquipId) : null;
    assert.equal(!!u.def.raw.module?.active, !!mod, `${id}: module`);
    if (mod) withModule.push(`${id} L${mod.level}`);
    assert.equal(u.base.atk, form.stats.atk + (mod?.attr.atk ?? 0), `${id}: ATK`);
    assert.equal(u.base.maxHp, form.stats.maxHp + (mod?.attr.maxHp ?? 0), `${id}: max HP`);
    assert.deepEqual([u.profile.attack, u.profile.canHitFly, u.s.blockCnt], ['melee', false, 1], `${id}: melee, ground only, blocks 1`);
    assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${id}: range 1-1`);
    assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${id}: ground enemies can target her`);
    done(h);
  }
  assert.deepEqual(withModule, ['chess_char_5_06_b L1', 'chess_char_5_13_b L1', 'chess_char_6_06_b L3']);
  assert.deepEqual(ids.map((id) => CHESS[id].backup.skillIndex), [2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
});

test('Sharp talents: 隐匿刀刃 ATK + / physical dodge (DRE-X level 3 on 佩佩 精锐: +20 % / 35 %); 寸步不退 ASPD +10 after 30 s on the field, from every deployment', () => {
  const want = { chess_char_4_22_a: [0.15, 0.3], chess_char_5_06_b: [0.15, 0.3], chess_char_6_06_b: [0.2, 0.35] };
  for (const [id, [atk, dodge]] of Object.entries(want)) {
    const h = battle([{ chessId: id, row: 10, col: 4, standIn: true }]);
    h.step();
    const u = h.unit(1);
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb, t1 = u.def.raw.talents.find((t) => t.index === 1).bb;
    assert.deepEqual([t0.atk, t0.prob, t1.interval, t1.attack_speed], [atk, dodge, 30, 10], id);
    approx(u.s.atk, u.base.atk * (1 + atk), `${id}: ATK`);
    approx(u.s.dodgePhys, dodge, `${id}: physical dodge`);
    assert.equal(u.s.dodgeArts, 0, `${id}: no arts dodge`);
    h.run(29.8);
    assert.equal(u.s.aspd, 100, `${id}: not before 30 s`);
    h.run(0.3);
    assert.equal(u.s.aspd, 110, `${id}: ASPD +10 after 30 s`);
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u));
    h.step();
    assert.equal(u.s.aspd, 100, `${id}: a new deployment starts the count again`);
    approx(u.s.dodgePhys, dodge, `${id}: talent 1 survives the redeploy`);
    h.run(30.1);
    assert.equal(u.s.aspd, 110, `${id}: and 30 s later`);
    done(h);
  }
});

test('Sharp S1 快刀 (no chess names it — a 自选 slot may): ATK +25 % / +40 % for 30 s, attack@prob1 (20 %) of the attacks are double hits; cast by its data rule once an enemy is on its 1-1 range', () => {
  for (const id of ['chess_char_3_18_a', 'chess_char_3_18_b']) {
    const sk = skillOf(id, 0);
    const h = battle([{ chessId: id, row: 10, col: 4, standIn: { skillIndex: 0 } }]);
    h.step();
    const u = h.unit(1);
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.equal(u.skill.id, 'skchr_acguad_1');
    assert.equal(u.skill.rule, String(u.def.skill.trigger.rule).toUpperCase(), `${id}: the data trigger`);
    // the roll: one draw per attack with attack@prob1
    const seen = [];
    const hitsFn = u.kit.skill.attack.hitsFn;
    assert.equal(hitsFn({ rng: { chance: (p) => { seen.push(p); return true; } } }, u), 2);
    assert.equal(hitsFn({ rng: { chance: (p) => { seen.push(p); return false; } } }, u), 1);
    assert.deepEqual(seen, [sk.bb['attack@prob1'], sk.bb['attack@prob1']]);
    assert.equal(sk.bb['attack@prob1'], 0.2);
    u.skill.gainSp(999);
    h.run(2);
    assert.equal(u.skill.activations, 0, `${id}: no enemy, no cast`);
    h.spawn('enemy_dummy', { pos: [10, 5] }); // the front tile of her 1-1 range
    assert.ok(h.runUntil(() => u.skill.active, 2), `${id}: cast with an enemy on its range`);
    approx(u.s.atk, u.base.atk * (1 + t0.atk + sk.bb.atk), `${id}: ATK +${sk.bb.atk}`);
    approx(u.skill.timeLeft, sk.duration, `${id}: ${sk.duration} s`, 0.01);
    assert.deepEqual([sk.rangeId, u.liveRangeGrid], ['1-1', formOf(id).rangeGrid], `${id}: its 技能范围 is her own 1-1: the range stays`);
    const n0 = atkHits(h, u).length;
    u.skill.extend(270); // 300 s of 快刀 at 1.5 s per attack: 200 attacks
    h.runUntil(() => !u.skill.active, 400);
    const counts = perAttack(atkHits(h, u).slice(n0).filter((c) => c.dmg.isSkill));
    const doubles = counts.filter((n) => n === 2).length;
    assert.ok(counts.length >= 195 && counts.every((n) => n === 1 || n === 2), `${id}: ${counts.length} attacks, one or two hits each`);
    assert.ok(doubles / counts.length > 0.12 && doubles / counts.length < 0.28, `${id}: ${doubles} / ${counts.length} double hits ≈ 20 %`);
    const n1 = atkHits(h, u).length;
    h.run(15);
    const after = perAttack(atkHits(h, u).slice(n1));
    assert.ok(after.length >= 5 && after.every((n) => n === 1), `${id}: single hits once it ends`);
    approx(u.s.atk, u.base.atk * (1 + t0.atk), `${id}: ATK back`);
    done(h);
  }
});

test('Sharp S2 亮剑 (银灰 / 百炼嘉维尔): DEF to 0 — a DEF bonus too —, max HP +30 % / +40 %, every attack at 160 % / 180 % ATK for 30 s; then all back', () => {
  for (const id of ['chess_char_4_22_a', 'chess_char_4_22_b', 'chess_char_4_23_a', 'chess_char_4_23_b']) {
    const sk = skillOf(id, 1);
    const h = battle([{ chessId: id, row: 10, col: 4, standIn: true }]);
    h.step();
    const u = h.unit(1);
    assert.equal(u.skill.id, 'skchr_acguad_2');
    assert.equal(u.skill.rule, 'DEFAULT');
    h.b.addBuff(u, { key: 'test:def', mods: { defPct: 0.5, defFlat: 100 } });
    const def0 = u.s.def;
    approx(def0, (u.base.def + 100) * 1.5, `${id}: DEF with the test bonus`);
    u.skill.gainSp(999);
    h.spawn('enemy_dummy', { pos: [10, 4] }); // DEF 0, blocked by her
    assert.ok(h.runUntil(() => u.skill.active, 3), `${id}: cast (DEFAULT)`);
    const t = h.b.time;
    assert.equal(u.s.def, 0, `${id}: DEF 降至0`);
    approx(u.s.maxHp, u.base.maxHp * (1 + sk.bb.max_hp), `${id}: max HP +${sk.bb.max_hp}`);
    h.run(4);
    const hits = atkHits(h, u).filter((c) => c.dmg.isSkill);
    assert.ok(hits.length >= 3, `${id}: attacks during the skill`);
    for (const c of hits) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'], `${id}: ${sk.bb['attack@atk_scale'] * 100} % ATK (no module)`);
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    approx(h.b.time - t, sk.duration, `${id}: ${sk.duration} s`, 0.01);
    approx(u.s.def, def0, `${id}: DEF back`);
    approx(u.s.maxHp, u.base.maxHp, `${id}: max HP back`);
    const n = atkHits(h, u).length;
    h.run(4);
    for (const c of atkHits(h, u).slice(n)) approx(c.amount, u.s.atk, `${id}: 100 % after`);
    done(h);
  }
});

test('Sharp S3 力战不竭 (忍冬 / 佩佩 精锐): ATK +30 % / +45 %; one +16 % / +17 % layer before every attack — the first included — up to 8, all lost on a new target; HP never below 1 while it runs', () => {
  for (const id of ['chess_char_3_18_a', 'chess_char_6_06_b']) {
    const sk = skillOf(id, 2), bb = sk.bb;
    assert.equal(bb.max_atk_stack_cnt, 8);
    const h = battle([{ chessId: id, row: 10, col: 4, standIn: true }]);
    h.step();
    const u = h.unit(1);
    assert.equal(u.skill.rule, 'DEFAULT');
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    const dre = u.def.traitBb.atk_scale ?? 1; // 佩佩 精锐: DRE-X 115 % on the blocked enemy
    assert.equal(dre, id.endsWith('_b') ? 1.15 : 1);
    const first = h.spawn('enemy_dummy', { pos: [10, 4] }); // blocked by her
    const second = h.spawn('enemy_dummy', { pos: [10, 5] }); // her front tile, nobody blocks it
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    const t = h.b.time;
    assert.ok(h.runUntil(() => atkHits(h, u).length >= 9, 16));
    const onFirst = atkHits(h, u);
    assert.ok(onFirst.every((c) => c.target === first), `${id}: the blocked enemy first`);
    onFirst.forEach((c, i) => approx(c.amount, u.base.atk * (1 + t0.atk + bb.atk + bb.atk_each_stack * Math.min(i + 1, 8)) * dre, `${id}: attack ${i + 1} has ${Math.min(i + 1, 8)} layer(s)`));
    assert.equal(u.findBuff('acguad:s3stack').stacks, 8, `${id}: at most 8 layers`);
    h.b.kill(first);
    assert.ok(h.runUntil(() => atkHits(h, u).length >= 11, 4));
    const onSecond = atkHits(h, u).slice(9);
    assert.ok(onSecond.every((c) => c.target === second));
    approx(onSecond[0].amount, u.base.atk * (1 + t0.atk + bb.atk + bb.atk_each_stack), `${id}: a new target — one layer again (and no DRE-X: nobody blocks it)`);
    approx(onSecond[1].amount, u.base.atk * (1 + t0.atk + bb.atk + bb.atk_each_stack * 2), `${id}: two`);
    // 不会低于1: a lethal hit and a lethal 流失 both leave 1 HP while it runs
    h.b.dealDamage(null, u, { type: 'true', amount: 1e7 });
    assert.deepEqual([u.alive, u.hp], [true, 1], `${id}: lethal damage`);
    h.b.loseHp(u, 1e7);
    assert.deepEqual([u.alive, u.hp], [true, 1], `${id}: lethal 流失`);
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    approx(h.b.time - t, sk.duration, `${id}: ${sk.duration} s`, 0.01);
    assert.equal(u.findBuff('acguad:s3stack'), null, `${id}: the layers end with the skill`);
    approx(u.s.atk, u.base.atk * (1 + t0.atk), `${id}: ATK back`);
    h.b.dealDamage(null, u, { type: 'true', amount: 1e7 });
    assert.equal(u.alive, false, `${id}: mortal again`);
    done(h);
  }
});

test('Sharp DRE-X (隐德来希 精锐): attacks on an enemy blocked by anyone at 115 % ATK, on an unblocked one at 100 %; module \'none\' and the normal chess: 100 %', () => {
  const run = (units, enemyAt, extra = null) => {
    const h = battle(units);
    h.step();
    const u = h.unit(1);
    if (extra) extra(h, u);
    const e = h.spawn('enemy_dummy', { pos: enemyAt });
    h.run(6); // before S3 can be cast (initSp 30 / cost 46)
    const hits = atkHits(h, u);
    assert.ok(hits.length >= 3 && hits.every((c) => c.target === e && !c.dmg.isSkill));
    done(h);
    return { u, e, ratio: hits[0].amount / u.s.atk };
  };
  const mine = run([{ chessId: 'chess_char_5_06_b', row: 10, col: 4, standIn: true }], [10, 4]);
  assert.equal(mine.e.blockedBy, mine.u);
  approx(mine.ratio, 1.15, 'blocked by her');
  const ally = run([{ chessId: 'chess_char_5_06_b', row: 10, col: 4, standIn: true }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }], [10, 5]);
  assert.equal(ally.e.blockedBy?.defId, 'chess_char_1_02_a');
  approx(ally.ratio, 1.15, 'blocked by the operator in front of her');
  approx(run([{ chessId: 'chess_char_5_06_b', row: 10, col: 4, standIn: true }], [10, 5]).ratio, 1, 'nobody blocks it');
  approx(run([{ chessId: 'chess_char_5_06_b', row: 10, col: 4, standIn: { moduleId: 'none' } }], [10, 4]).ratio, 1, 'module none');
  approx(run([{ chessId: 'chess_char_5_06_a', row: 10, col: 4, standIn: true }], [10, 4]).ratio, 1, 'normal chess: no module');
});

test('Sharp is ground only: an air unit on her tile is never attacked', () => {
  const h = battle([{ chessId: 'chess_char_4_22_b', row: 10, col: 4, standIn: true }]);
  h.step();
  const u = h.unit(1);
  h.spawn('enemy_fly', { pos: [10, 4], route: 2 });
  h.run(8);
  assert.equal(atkHits(h, u).length, 0);
  assert.equal(u.skill.activations, 0, 'S2 (DEFAULT) has nothing to attack');
  done(h);
});
