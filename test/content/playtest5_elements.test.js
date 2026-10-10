// User playtest #5 report #3 (operator side, workstream W3a): element damage (元素损伤) dealt by the player side and the
// operator-side gauge modifiers, against the official rules.
//   * 盟约·辅助干员 迭代元素 — every damage she deals attaches 神经 + 灼燃 + 凋亡 (18 % ATK each, 神经 first); the kit used
//     to fill 神经 only (its "first element not bursting" pick was dead: a burst locks every gauge). "造成伤害时": a
//     dodged / fully absorbed hit attaches nothing. Elite RIT-X: ep_damage_ratio_boss vs elite / leader — the talent
//     only.
//   * 菲莱 精锐 PRP-X "阻挡敌人时，自身造成的元素损伤提升15%" — every element fill she deals (a carried 灼燃维式重锤 too);
//     S2 冥河诅咒's counter area = range x-4 (the 3×3 tiles around her, PRTS 备注).
//   * 受到的元素损伤降低 (菲莱 神河谕使, 哈洛德 我即军营, 纯烬艾雅法拉 火山灰疗愈) — a 元素损伤 multiplier on the hit, not
//     elemTakenMul (元素伤害 / 元素脆弱: gamedata_const termDescriptionDict ba.elementfragile "受到的元素伤害提升").
//   * a killing blow attaches no element (迭代元素, 灼燃维式重锤, 炎佑, 妮芙's S2 rider): their `damaged` hooks run before the
//     kill, while the target is `alive` at 0 HP — a fill there used to burst the corpse (a second fatal, 烛煌's heal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { PITHST_ELEMENTS } from '../../server/sim/content/kits/ops/chess_char_1_15-pithst.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';
import { COLS } from '../../server/sim/constants.js';

const SRC = getDefaultSource();
const raw = (id) => SRC.rawChess(id);
const tal = (id, i = 0) => raw(id).talents.filter((t) => t.index !== -1)[i].bb;
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);
const HAMMER = 'chess_item_4_09_e_a'; // 灼燃维式重锤: arts damage attaches 10 % of it as 灼燃损伤
const DEFS = {
  enemies: {
    enemy_w3a: dummy('enemy_w3a'), enemy_w3a_elite: dummy('enemy_w3a_elite', { rank: 'ELITE' }),
    enemy_w3a_hit: dummy('enemy_w3a_hit', { atk: 150, bat: 0.5 }), enemy_w3a_fly: dummy('enemy_w3a_fly', { motion: 'FLY' }),
    enemy_w3a_low: dummy('enemy_w3a_low', { hp: 5 }),
  },
  chess: { t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 5000 }, skill: null }) },
};
const battle = (o) => makeBattle({ defs: DEFS, timeLimit: 120, autoFinish: false, seed: 5, ...o });
const PITH = 'chess_char_1_15_a', PITH_B = 'chess_char_1_15_b';

// ---------------------------------------------------------------------------------------------------------------------
// 盟约·辅助干员

test('#3 盟约·辅助干员: each damage attaches 18 % ATK of 神经, 灼燃 and 凋亡 (in that order); alone, 神经 bursts', () => {
  assert.deepEqual([...PITHST_ELEMENTS], ['neural', 'burn', 'apoptosis']);
  const h = battle({ units: [{ chessId: PITH, row: 10, col: 4 }], enemies: [{ key: 'enemy_w3a', pos: [10, 5] }] });
  const u = h.unit(PITH);
  h.step();
  const e = h.enemy('enemy_w3a');
  const r = tal(PITH).ep_damage_ratio;
  assert.ok(h.runUntil(() => e.elem.neural > 0, 5), 'first hit');
  for (const el of PITHST_ELEMENTS) approx(e.elem[el], u.s.atk * r, `${el} = 18 % ATK`);
  // the three gauges fill together; 神经 is applied first, so it is the one that bursts (PRTS 元素)
  assert.ok(h.runUntil(() => h.hooksOf('elementBurst').length > 0, 40), 'a burst');
  assert.equal(h.hooksOf('elementBurst')[0].element, 'neural');
  assert.equal(h.hooksOf('elementBurst').length, 1, 'the burst locks the other two');
  checkInvariants(h.b);
});

test('#3 盟约·辅助干员: her 灼燃 / 凋亡 complete the gauges her team builds (was: 神经 only)', () => {
  for (const el of ['burn', 'apoptosis']) {
    const h = battle({ units: [{ chessId: PITH, row: 10, col: 4 }], enemies: [{ key: 'enemy_w3a', pos: [10, 8] }] });
    const u = h.unit(PITH);
    h.step();
    const e = h.enemy('enemy_w3a');
    for (const k of Object.keys(e.elem)) e.elem[k] = 0;
    e.elem[el] = 950; // e.g. 余's burn / 塑心's apoptosis so far
    h.b.dealDamage(u, e, { amount: 100, type: 'arts', canDodge: false });
    const b = h.hooksOf('elementBurst').filter((c) => c.target === e);
    assert.equal(b.length, 1, `${el} burst`);
    assert.equal(b[0].element, el);
    const one = u.s.atk * tal(PITH).ep_damage_ratio;
    approx(e.elem.neural, one, '神经 filled first');
    // 灼燃 comes before 凋亡: it fills when 凋亡 bursts; the burst locks 凋亡 when 灼燃 bursts
    if (el === 'apoptosis') approx(e.elem.burn, one, '灼燃 before the 凋亡 burst');
    else assert.equal(e.elem.apoptosis, 0, 'the burst locks the element after it');
  }
});

test('#3 盟约·辅助干员 "造成伤害时": a dodged or fully absorbed hit attaches no element; element damage never re-triggers it', () => {
  for (const guard of [{ key: 't:barrier', shield: 1e9 }, { key: 't:dodge', mods: { dodgeArts: 1 } }]) {
    const h = battle({ units: [{ chessId: PITH, row: 10, col: 4 }], enemies: [{ key: 'enemy_w3a', pos: [10, 5] }] });
    const u = h.unit(PITH);
    h.step();
    const e = h.enemy('enemy_w3a');
    for (const k of Object.keys(e.elem)) e.elem[k] = 0;
    h.b.addBuff(e, guard);
    const atk0 = u.stats.attacks;
    h.run(6);
    assert.ok(u.stats.attacks >= atk0 + 2, 'she attacked');
    assert.equal(e.elem.neural + e.elem.burn + e.elem.apoptosis, 0, `${guard.key}: nothing attached`);
  }
  const h = battle({ units: [{ chessId: PITH, row: 10, col: 4 }], enemies: [{ key: 'enemy_w3a', pos: [10, 8] }] });
  const u = h.unit(PITH);
  h.step();
  const e = h.enemy('enemy_w3a');
  for (const k of Object.keys(e.elem)) e.elem[k] = 0;
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: 10 });
  h.b.dealDamage(u, e, { type: 'elemental', element: 'burn', amount: 10 });
  assert.equal(e.elem.neural, 0, 'element fills / 元素伤害 are not "damage she deals" for 迭代元素');
});

test('#3 盟约·辅助干员 (elite): the RIT-X ratio vs elite enemies is the talent only — a carried 灼燃维式重锤 stays 10 %', () => {
  const h = battle({ units: [{ chessId: PITH_B, row: 10, col: 4, items: [HAMMER] }], enemies: [{ key: 'enemy_w3a_elite', pos: [10, 8] }] });
  const u = h.unit(PITH_B);
  h.step();
  const e = h.enemy('enemy_w3a_elite');
  for (const k of Object.keys(e.elem)) e.elem[k] = 0;
  const t = tal(PITH_B);
  assert.ok(t.ep_damage_ratio_boss > t.ep_damage_ratio);
  h.b.dealDamage(u, e, { amount: 1000, type: 'arts', canDodge: false });
  approx(e.elem.neural, u.s.atk * t.ep_damage_ratio_boss, 'talent ×1.18 vs elite');
  approx(e.elem.burn, u.s.atk * t.ep_damage_ratio_boss + 1000 * 0.1, 'talent + hammer (10 % of the arts damage, no ×1.18)');
});

test('#3 a killing blow attaches no element: no burst on the corpse, one fatal, no 烛煌 熔点引爆 heal', () => {
  const BLAZE = 'chess_char_5_03_a', NYMPH = 'chess_char_5_22_a';
  const cases = [
    ['盟约·辅助干员 迭代元素', [{ chessId: PITH, row: 10, col: 4 }], (h) => h.unit(PITH), {}],
    ['灼燃维式重锤', [{ chessId: 't_guard', row: 10, col: 4, items: [HAMMER] }], (h) => h.unit('t_guard'), {}],
    ['炎佑', [], (h) => spawnYanyou(h.b, 'p1', { atk: 400, hp: 5000 })[0], {}],
    ['妮芙 S2 凋亡', [{ chessId: NYMPH, row: 11, col: 3 }], (h) => h.unit(NYMPH), { isSkill: true, isAttack: true }],
  ];
  for (const [label, units, srcOf, flags] of cases) {
    const h = battle({ units: [...units, { chessId: BLAZE, row: 11, col: 6 }], enemies: [{ key: 'enemy_w3a_low', pos: [10, 12] }] });
    h.step();
    const src = srcOf(h), blaze = h.unit(BLAZE), e = h.enemy('enemy_w3a_low');
    assert.ok(e.alive && src && src.deployed && blaze.deployed, label);
    // 灼燃 / 凋亡 one fill from bursting (a burn burst would trigger 烛煌 熔点引爆); 神经 empty (迭代元素 applies it first)
    for (const k of Object.keys(e.elem)) e.elem[k] = k === 'burn' || k === 'apoptosis' ? 990 : 0;
    blaze.hp = blaze.s.maxHp * 0.5;
    h.b.dealDamage(src, e, { amount: 1000, type: 'arts', canDodge: false, ...flags });
    assert.equal(e.alive, false, `${label}: killed`);
    assert.equal(h.hooksOf('elementBurst').filter((c) => c.target === e).length, 0, `${label}: no burst on the corpse`);
    assert.equal(h.hooksOf('fatal').filter((c) => c.unit === e).length, 1, `${label}: one fatal`);
    assert.equal(h.hooksOf('kill').filter((c) => c.victim === e).length, 1, `${label}: one kill`);
    assert.equal(blaze.hp, blaze.s.maxHp * 0.5, `${label}: no 熔点引爆 heal`);
    checkInvariants(h.b);
  }
  // control: the same hit on a living target still attaches (and bursts)
  const h = battle({ units: [{ chessId: PITH, row: 10, col: 4 }], enemies: [{ key: 'enemy_w3a', pos: [10, 12] }] });
  h.step();
  const u = h.unit(PITH), e = h.enemy('enemy_w3a');
  for (const k of Object.keys(e.elem)) e.elem[k] = k === 'burn' ? 990 : 0;
  h.b.dealDamage(u, e, { amount: 1000, type: 'arts', canDodge: false });
  assert.deepEqual(h.hooksOf('elementBurst').filter((c) => c.target === e).map((c) => c.element), ['burn'], 'alive: 灼燃 bursts');
});

// ---------------------------------------------------------------------------------------------------------------------
// 菲莱

test('#3 菲莱 (elite): PRP-X ×1.15 applies to every element fill she deals while blocking — a carried 灼燃维式重锤 too', () => {
  const id = 'chess_char_3_06_b';
  const scale = raw(id).trait.bb.ep_damage_scale;
  assert.ok(scale > 1);
  for (const [pos, blocking] of [[[10, 5], true], [[10, 8], false]]) {
    const h = battle({ units: [{ chessId: id, row: 10, col: 5, items: [HAMMER] }], enemies: [{ key: 'enemy_w3a', pos }] });
    const u = h.unit(id);
    h.run(0.2);
    const e = h.enemy('enemy_w3a');
    assert.equal(u.blocking.includes(e), blocking);
    for (const k of Object.keys(e.elem)) e.elem[k] = 0;
    h.b.dealDamage(u, e, { amount: 1000, type: 'arts', canDodge: false });
    approx(e.elem.burn, 1000 * 0.1 * (blocking ? scale : 1), blocking ? 'hammer burn ×1.15 while blocking' : 'not blocking: ×1');
  }
});

test('#3 菲莱 S2 冥河诅咒: the counter hits the ground enemies of the 3×3 tiles around her (range x-4), not a 1.5 radius', () => {
  const id = 'chess_char_3_06_a';
  const h = battle({
    units: [{ chessId: id, row: 10, col: 5, carryState: { sp: 999 } }],
    enemies: [
      { key: 'enemy_w3a_hit', pos: [10, 5] },          // blocked, attacks her → the counter
      { key: 'enemy_w3a', pos: [10.45, 6.45] },        // tile (10, 6) of the 3×3, 1.52 tiles away
      { key: 'enemy_w3a', pos: [10, 7] },              // two tiles away
      { key: 'enemy_w3a_fly', pos: [11, 6] },          // flying: not a ground enemy
    ],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 10), 'S2');
  const [near, far] = h.b.enemies.filter((x) => x.defId === 'enemy_w3a').sort((a, b) => a.x - b.x);
  const fly = h.enemy('enemy_w3a_fly');
  const ep = raw(id).skill.bb.ep_damage_ratio;
  assert.ok(h.runUntil(() => near.elem.apoptosis > 0, 10), 'the off-centre enemy of the 3×3 is hit');
  approx(near.elem.apoptosis, u.s.atk * ep, 'apoptosis = ep_damage_ratio × ATK');
  assert.equal(far.elem.apoptosis, 0, 'two tiles away: not hit');
  assert.equal(fly.elem.apoptosis, 0, 'flying: not hit');
});

// ---------------------------------------------------------------------------------------------------------------------
// 受到的元素损伤降低: gauge only

test('#3 纯烬艾雅法拉 火山灰疗愈: allies in range take −12 % 元素损伤 (×talent_scale in S3) — the gauge, not elemTakenMul', () => {
  const id = 'chess_char_6_20_a';
  const h = battle({ units: [{ chessId: id, row: 10, col: 4 }, { chessId: 't_guard', row: 10, col: 5 }] });
  const u = h.unit(id), g = h.unit('t_guard');
  h.run(0.6);
  const er = tal(id, 1).ep_damage_resistance;
  assert.ok(g.findBuff('agoat2:ash'), 'in her range');
  const n0 = g.elem.neural;
  h.b.dealDamage(null, g, { type: 'element', element: 'neural', amount: 100 });
  approx(g.elem.neural - n0, 100 * (1 - er), '−12 %');
  approx(g.s.elemTakenMul, 1, 'no 元素伤害 / 元素脆弱 change');
  // S3 (the default skill): the talent ×talent_scale
  g.hp = g.s.maxHp * 0.5;
  u.skill.sp = u.skill.spCost;
  assert.ok(h.runUntil(() => u.skill.active, 10), 'S3');
  h.run(0.6);
  const b0 = g.elem.burn;
  h.b.dealDamage(null, g, { type: 'element', element: 'burn', amount: 100 });
  approx(g.elem.burn - b0, 100 * Math.max(0, 1 - er * raw(id).skill.bb.talent_scale), 'S3: ×talent_scale');
});

test('#3 纯烬艾雅法拉 氤氲: the bonus heal recovers heal_scale × the trait ep_heal_ratio × ATK of 元素损伤 per stack (was: heal_scale × ATK)', () => {
  const id = 'chess_char_6_20_a';
  // the guard stands outside her range: only the manual heals below reach it
  const h = battle({ units: [{ chessId: id, row: 12, col: 2 }, { chessId: 't_guard', row: 9, col: 10 }] });
  const u = h.unit(id), g = h.unit('t_guard');
  h.step();
  assert.ok(!u.rangeKeySet.has(g.tileR * COLS + g.tileC), 'guard out of her range');
  const t0 = tal(id, 0), ratio = raw(id).trait.bb.ep_heal_ratio;
  assert.ok(ratio > 0 && ratio < 1);
  g.elem.neural = 900;
  h.b.heal(u, g, 1);                       // a normal heal of hers → 1 stack
  const n0 = g.elem.neural;
  h.run(1.01);
  approx(n0 - g.elem.neural, u.s.atk * t0.heal_scale * ratio, 'one stack: 10 % × 50 % ATK');
  h.b.heal(u, g, 1); h.b.heal(u, g, 1);    // 3 stacks (max), the duration refreshed
  const mist = g.findBuff(`agoat2:mist:${u.id}`); // keyed per 纯烬 (two of them keep their own stacks)
  assert.equal(mist.stacks, t0.max_stack_cnt);
  const n1 = g.elem.neural;
  h.run(1.01);
  approx(n1 - g.elem.neural, u.s.atk * t0.heal_scale * ratio * t0.max_stack_cnt, '3 stacks');
});
