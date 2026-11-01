// 炸惊模拟 (拓展玩法模式 ZHAJING) 新干员 kits — `test/content/zj-ops.test.js`.
//
// The kits of server/sim/content/kits/index.js `ZHAJING_KIT_FILES` field the 炸惊棋库's own chess records
// (data/chess.json `chess_zj_*`, `zhajing: true`, `visible: false`, from docs/research/18-zhaijing-content.json through
// tools/build-data.mjs). These tests field those records the production way and assert NUMBERS read from the records
// (`stats.atk` / `stats.def`, the talent and skill blackboards) — never "it did not throw".
//
// What each block covers (README.md "Testing a kit", fidelity checklist):
//   * the unit takes the ZHAJING kit, not the generic one (`u.kit.generic`, `skillSource`);
//   * at least one exact number per kit: a stat its talent / skill sets, or the exact damage / heal / note count;
//   * the same seed gives the same result (determinism);
//   * 炸惊外不可见: no official difficulty's `visibleChess` ever lists a `chess_zj_*` record, while the ZHAJING roster does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec, hashOf, checkInvariants } from '../helpers/battleHarness.js';
import { ZHAJING_KIT_FILES, ZHAJING_KITS, KITS, KITTED_CHARS, OPERATOR_KITS } from '../../server/sim/content/kits/index.js';
import { GameData } from '../../server/match/gamedata.js';
import { getData } from '../../server/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));

/** The 炸惊 chess ids this file covers (each one is a `ZHAJING_KIT_FILES` entry). */
const ZJ_IDS = ['chess_zj_amoris_a', 'chess_zj_dolris_a', 'chess_zj_mortis_a', 'chess_zj_oblvns_a', 'chess_zj_tmoris_a',
  'chess_zj_60_2_a', 'chess_zj_60_3_a', 'chess_zj_60_4_a', 'chess_zj_60_5_a'];

/** A punching bag with no DEF / RES, so a hit's damage is exactly `ATK × scale` (numbers, not mitigation curves). */
const BAG = 'zj_bag';
const bag = (hp = 1e6) => enemyRec({ key: BAG, hp, def: 0, res: 0, atk: 0, speed: 0.001 });

/** Field 炸惊 chess on the flat stage (rows 9–12) with zero-DEF bags. */
function field(units, { enemies = [], seed = 7 } = {}) {
  return makeBattle({ units, defs: { enemies: { [BAG]: bag() } }, enemies, seed });
}

/** The unit of a 炸惊 chess id, asserting it runs the hand-authored ZHAJING kit. */
function kj(h, chessId) {
  const u = h.unit(chessId);
  assert.ok(u, `${chessId}: fielded`);
  assert.ok(!u.kit.generic, `${chessId}: not the generic kit`);
  assert.equal(u.kit.skillSource, 'skills', `${chessId}: the spec comes from the kit's skills (or no skill at all)`);
  return u;
}

// ---------------------------------------------------------------------------------------------------------------
// 祐天寺若麦 chess_zj_amoris_a (char_4185_amoris, tier 2, WARRIOR/hammer)
// ---------------------------------------------------------------------------------------------------------------
test('zj amoris: T2 毋畏爱意 gives every 颂乐人偶 +9 % ATK — herself included (1027 → 1119.43)', () => {
  const h = field([{ chessId: 'chess_zj_amoris_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_amoris_a');
  assert.equal(u.def.charId, 'char_4185_amoris');
  assert.equal(u.skill.id, 'skchr_amoris_2', 'the record’s default skill');
  h.run(0.5);
  assert.equal(Math.round(u.s.atk * 100) / 100, 1119.43); // 1027 × 1.09 (talent bb.atk 0.09 at 潜能 4+)
});

test('zj amoris: one swing = ATK on the target and 50 % of it on a neighbour inside the 特性 radius', () => {
  // she stands on (10,5) facing RIGHT: range [[0,0],[0,1]] = her tile + (10,6). Two bags stand there, both blocked.
  // seed 2 draws no 脆弱 proc on either bag (T1 is a 10 % roll: its number is the next test), so the hit is exactly ATK
  // and the neighbour exactly half of it.
  const h = field([{ chessId: 'chess_zj_amoris_a', row: 10, col: 5 }], {
    seed: 2, enemies: [{ key: BAG, time: 0, pos: [10, 6] }, { key: BAG, time: 0, pos: [10, 7] }],
  });
  const u = kj(h, 'chess_zj_amoris_a');
  h.run(0.1);
  const before = h.enemies().map((e) => e.hp);
  h.run(1.6); // the swing's hit lands at 20/30 × BAT(1.8) = 1.2 s; the T2 aura has raised ATK to 1119.43 by then
  const atk = u.s.atk;
  assert.equal(Math.round(atk * 100) / 100, 1119.43);
  const dealt = h.enemies().map((e, i) => before[i] - e.hp).sort((x, y) => y - x);
  assert.ok(Math.abs(dealt[0] - atk) < 1e-6, `main target took ${dealt[0]} (expected ${atk})`);
  assert.ok(Math.abs(dealt[1] - atk * 0.5) < 1e-6, `the neighbour took ${dealt[1]} (expected ${atk * 0.5})`);
  checkInvariants(h.b);
});

test('zj amoris T1 双利手: an attack gives 8 % 脆弱 (dmgTakenMul 1.08) for 2 s', () => {
  const h = field([{ chessId: 'chess_zj_amoris_a', row: 10, col: 5 }], { seed: 7, enemies: [{ key: BAG, time: 0, pos: [10, 6] }] });
  h.run(0.05);
  const e = h.enemies()[0];
  assert.ok(h.runUntil(() => e.hasBuff('fragile'), 60), 'a 脆弱 proc inside 60 s (a 10 % roll per hit)');
  const buff = e.findBuff('fragile');
  assert.equal(buff.mods.dmgTakenMul, 1.08); // damage_scale 1.08 − 1
  assert.ok(buff.timeLeft > 0 && buff.timeLeft <= 2 + 1e-9, `weak[limit] 2 s, ${buff.timeLeft} left`);
});

// ---------------------------------------------------------------------------------------------------------------
// 八幡海铃 chess_zj_tmoris_a (char_4186_tmoris, tier 3, SPECIAL/stalker)
// ---------------------------------------------------------------------------------------------------------------
test('zj tmoris: 特性 hits EVERY enemy in range for exactly ATK (the stalker dodge/taunt is the profession’s)', () => {
  const h = field([{ chessId: 'chess_zj_tmoris_a', row: 10, col: 5 }], {
    seed: 3, enemies: [{ key: BAG, time: 0, pos: [10, 6] }, { key: BAG, time: 0, pos: [10, 7] }],
  });
  const u = kj(h, 'chess_zj_tmoris_a');
  h.run(0.05);
  assert.equal(u.s.atk, 685);
  // the stalker profession: 50 % phys / arts dodge (trait bb prob 0.5) + taunt −1, from the record's own trait
  const stalker = u.findBuff('trait:stalker');
  assert.ok(stalker, 'trait:stalker installed by professions.js');
  assert.equal(stalker.mods.dodgePhys, 0.5);
  assert.equal(stalker.mods.dodgeArts, 0.5);
  assert.equal(stalker.mods.taunt, -1);
  // one swing per BAT 3.5 s hits every enemy of the range. T2 multiplies a hit by 1.15 when the victim is 停顿 / 恐惧 —
  // T1's own 21 % 停顿 roll can make that true, so the multiple is asserted instead of a fixed number.
  const before = h.enemies().map((e) => e.hp);
  h.run(3.6);
  const dealt = h.enemies().map((e, i) => (before[i] - e.hp) / u.s.atk);
  for (const d of dealt) assert.ok(Math.abs(d - 1) < 1e-6 || Math.abs(d - 1.15) < 1e-6, `each target took ${d} × ATK (1 or T2's 1.15)`);
});

test('zj tmoris S2 无存之所: 恐惧 1.5 s on everything in range at the cast', () => {
  const h = field([{ chessId: 'chess_zj_tmoris_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0, pos: [10, 6] }] });
  const u = kj(h, 'chess_zj_tmoris_a');
  h.run(0.05);
  const e = h.enemies()[0];
  assert.equal(u.skill.id, 'skchr_tmoris_2');
  assert.ok(u.skill.activate('test', { free: true }), 'S2 cast');
  h.step();
  assert.ok(e.hasBuff('fear'), 'the bag is 恐惧');
  assert.ok(Math.abs(e.findBuff('fear').timeLeft - 1.5) < 0.05, `fear duration 1.5 s, got ${e.findBuff('fear').timeLeft}`);
});

// ---------------------------------------------------------------------------------------------------------------
// 三角初华 chess_zj_dolris_a (char_4184_dolris, tier 4, SUPPORT/bard)
// ---------------------------------------------------------------------------------------------------------------
test('zj dolris S1: allies in range get 鼓舞 = 30 % of her ATK (103.8 of 346)', () => {
  const h = field([{ chessId: 'chess_zj_dolris_a', row: 10, col: 5, skillIndex: 0 }, { chessId: 'chess_zj_amoris_a', row: 10, col: 6 }],
    { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_dolris_a');
  const ally = h.unit('chess_zj_amoris_a');
  h.run(0.05);
  assert.equal(u.skill.id, 'skchr_dolris_1', 'S1 selected by the loadout');
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.run(0.6); // the aura ticks every 0.25 s
  const buff = ally.findBuff('inspire');
  assert.ok(buff, 'the ally carries 鼓舞');
  assert.ok(Math.abs(buff.mods.atkFlat - 346 * 0.3) < 1e-6, `鼓舞 ${buff.mods.atkFlat} (expected ${346 * 0.3})`);
  // 自身不受鼓舞
  assert.equal(u.findBuff('inspire'), null);
});

test('zj dolris 特性: the 吟游者 regen is 10 % of her ATK per second, and S2 stops it', () => {
  const h = field([{ chessId: 'chess_zj_dolris_a', row: 10, col: 5 }, { chessId: 'chess_zj_amoris_a', row: 10, col: 6 }],
    { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_dolris_a');
  const ally = h.unit('chess_zj_amoris_a');
  h.run(0.4);
  const regen = ally.findBuff(`trait:bard:${u.id}`);
  assert.ok(regen, 'the profession keeps bardRegen on an ally in range');
  assert.ok(Math.abs(regen.mods.hpRegen - 346 * 0.1) < 1e-6, `hpRegen ${regen.mods.hpRegen} (expected 34.6)`);
  u.skill.activate('skchr_dolris_2', { free: true });
  h.step();
  assert.equal(ally.findBuff(`trait:bard:${u.id}`), null, 'S2 "技能期间特性不再恢复生命"');
});

// ---------------------------------------------------------------------------------------------------------------
// 若叶睦 chess_zj_mortis_a (char_4183_mortis, tier 5, SPECIAL/dollkeeper)
// ---------------------------------------------------------------------------------------------------------------
test('zj mortis S1 多首野兽: DEF +65 % and block +2 on the record’s own 303 / 2', () => {
  const h = field([{ chessId: 'chess_zj_mortis_a', row: 10, col: 5, skillIndex: 0 }], { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_mortis_a');
  h.run(0.05);
  assert.equal(u.skill.id, 'skchr_mortis_1', 'S1 selected by the loadout');
  const def = u.s.def, block = u.s.blockCnt;
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.step();
  assert.ok(Math.abs(u.s.def - def * 1.65) < 1e-6, `DEF ${u.s.def} (expected ${def * 1.65})`);
  assert.equal(u.s.blockCnt, block + 2);
  assert.equal(u.findBuff('mujica:mortis:doll'), null, 'the <替身> buff is not laid while she is the 本体');
});

test('zj mortis T0 另一个「她」: 30 % of a phys / arts HP damage turns into 凋亡 at half the amount', () => {
  const h = field([{ chessId: 'chess_zj_mortis_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_mortis_a');
  h.run(0.05);
  const hp0 = u.hp, elem0 = u.elem.apoptosis;
  // 法术 damage on her own RES 0: the amount arrives whole, so the 30 % / half split is exact
  h.b.dealDamage(null, u, { amount: 1000, type: 'arts', canDodge: false });
  const hpLoss = hp0 - u.hp;
  const elem = u.elem.apoptosis - elem0;
  assert.ok(Math.abs(hpLoss - 700) < 1e-6, `HP loss ${hpLoss} (expected 700: 30 % converted away)`);
  assert.ok(Math.abs(elem - 150) < 1e-6, `凋亡 gauge ${elem} (expected 150 = 300 × 0.5)`);
});

// ---------------------------------------------------------------------------------------------------------------
// 丰川祥子 chess_zj_oblvns_a (char_4182_oblvns, tier 6, WARRIOR/lord)
// ---------------------------------------------------------------------------------------------------------------
test('zj oblvns S1 新月的苏醒: eight notes, the first at 65 % × the 特性’s 80 %', () => {
  const h = field([{ chessId: 'chess_zj_oblvns_a', row: 10, col: 5, skillIndex: 0 }], { enemies: [{ key: BAG, time: 0, pos: [10, 7] }] });
  const u = kj(h, 'chess_zj_oblvns_a');
  h.run(0.05);
  assert.equal(u.skill.id, 'skchr_oblvns_1');
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.step();
  const notes = u.mem.mujicaNotes;
  assert.equal(notes.length, 8, 'eight 音符');
  assert.ok(Math.abs(notes[0].atk - u.s.atk * 0.65 * 0.8) < 1e-6, `first note ${notes[0].atk} (expected ${u.s.atk * 0.65 * 0.8})`);
  assert.ok(Math.abs(notes[7].atk - u.s.atk * 0.04 * 0.8) < 1e-6, `last note ${notes[7].atk} (expected ${u.s.atk * 0.04 * 0.8})`);
});

test('zj oblvns S2 满月的舞会: 风琴 gives ASPD +80, 钢琴 gives ATK +60 %', () => {
  const h = field([{ chessId: 'chess_zj_oblvns_a', row: 10, col: 5, skillIndex: 1 }], { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_oblvns_a');
  h.run(0.05);
  assert.equal(u.skill.id, 'skchr_oblvns_2', 'S2 selected by the loadout');
  const aspd0 = u.s.aspd, atk0 = u.s.atk;
  assert.ok(u.skill.activate('test', { free: true }), 'S2 cast (piano → organ)');
  assert.equal(u.mem.mujicaOrgan, true);
  assert.equal(u.form, 'oblvns_s2_b');
  h.run(0.6);
  // 风琴's ASPD +80, plus T1 毋畏遗忘's own "攻击范围内干员攻击速度+16" (she stands in her own range)
  assert.ok(Math.abs(u.s.aspd - (aspd0 + 80 + 16)) < 0.5, `ASPD ${u.s.aspd} (expected ${aspd0 + 80 + 16})`);
  assert.ok(u.skill.activate('test', { free: true }), 'S2 cast again (organ → piano)');
  assert.equal(u.form, 'oblvns_s2_a');
  h.run(0.6);
  assert.ok(Math.abs(u.s.atk - atk0 * 1.6) < 0.5, `ATK ${u.s.atk} (expected ${atk0 * 1.6})`);
});

// ---------------------------------------------------------------------------------------------------------------
// 虎狼丸 chess_zj_60_2_a (char_4220_kormr, tier 2, WARRIOR/sword — no skill at all)
// ---------------------------------------------------------------------------------------------------------------
test('zj kormr T1 黑色猎犬: six slashes on the nearest enemy — 5 × 200 % + a 400 % last one', () => {
  const h = field([{ chessId: 'chess_zj_60_2_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0, pos: [10, 6] }] });
  const u = h.unit('chess_zj_60_2_a');
  assert.ok(u && !u.kit.generic, 'kormr runs its ZHAIJING kit');
  assert.equal(u.skill?.noSkill ?? true, true, 'the record has no skill');
  h.run(0.02);
  const e = h.enemies()[0];
  const atk = u.s.atk;
  assert.equal(atk, 242);
  const hp0 = e.hp;
  h.run(2.2); // the slashes land at 0 … 1.7 s
  const total = hp0 - e.hp;
  const expected = atk * (2 * 5 + 4); // atk_scale 2 five times, final_atk_scale 4
  assert.ok(Math.abs(total - expected) < 1e-6, `total ${total} (expected ${expected})`);
  assert.ok(e.hasBuff('fear'), 'the last slash 恐惧 4 s');
});

// ---------------------------------------------------------------------------------------------------------------
// 埃癸斯 chess_zj_60_3_a (char_4218_aigis, tier 4, SNIPER)
// ---------------------------------------------------------------------------------------------------------------
test('zj aigis S1 启动狂宴模式: ATK +70 % and DEF +30 % on the record’s own 882 / 219', () => {
  const h = field([{ chessId: 'chess_zj_60_3_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0 }] });
  const u = kj(h, 'chess_zj_60_3_a');
  h.run(0.3);
  const atk0 = u.s.atk, def0 = u.s.def;
  assert.equal(atk0, 882);
  assert.equal(def0, 219);
  // 起飞: the deploy hook puts her in the air (trait bb: 部署后起飞)
  assert.equal(u.mem.aigisAir, true, 'airborne after the deployment');
  assert.ok(u.findBuff('aigis:air'), 'the liftoff buff');
  // the physical-damage talent (damage_resistance 0.12) is a standing buff
  const resist = u.findBuff('talent:aigis:resist');
  assert.ok(Math.abs(resist.mods.physTakenMul - 0.88) < 1e-9, `physTakenMul ${resist.mods.physTakenMul}`);
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.step();
  assert.ok(Math.abs(u.s.atk - atk0 * 1.7) < 1e-6, `ATK ${u.s.atk} (expected ${atk0 * 1.7})`);
  assert.ok(Math.abs(u.s.def - def0 * 1.3) < 1e-6, `DEF ${u.s.def} (expected ${def0 * 1.3})`);
  assert.equal(u.mem.aigisAir, false, 'S1 lands her');
});

// ---------------------------------------------------------------------------------------------------------------
// 岳羽由加莉 chess_zj_60_4_a (char_4219_yukari, tier 3, SUPPORT)
// ---------------------------------------------------------------------------------------------------------------
test('zj yukari S1 龙卷箭: three 55 % arrows and one 250 % burst, 浮空 1.5 s', () => {
  const h = field([{ chessId: 'chess_zj_60_4_a', row: 10, col: 5, skillIndex: 0 }], { enemies: [{ key: BAG, time: 0, pos: [10, 7] }] });
  const u = kj(h, 'chess_zj_60_4_a');
  h.run(0.05);
  assert.equal(u.skill.id, 'skchr_yukari_1');
  const e = h.enemies()[0];
  const atk = u.s.atk;
  assert.equal(atk, 775);
  // her ordinary attacks also land in that window, so the SKILL's instances are read off a damage listener
  const hits = [];
  h.b.on('damaged', (c) => { if (c.source === u && c.target === e && c.dmg?.isSkill) hits.push(c.amount / atk); });
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.run(3.5); // arrows at 1.533 / 1.833 / 2.133 s, burst at 3.367 s
  const skillHits = hits.sort((a, z) => a - z);
  assert.equal(skillHits.length, 4, `three arrows + one burst, got ${skillHits.length}`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(skillHits[i] - 0.55) < 1e-6, `arrow ${i + 1}: ${skillHits[i]} (expected 0.55)`);
  assert.ok(Math.abs(skillHits[3] - 2.5) < 1e-6, `burst ${skillHits[3]} (expected 2.5)`);
  assert.ok(e.hasBuff('levitate'), 'the burst 浮空s its victims');
});

// ---------------------------------------------------------------------------------------------------------------
// 结城理 chess_zj_60_5_a (char_4217_makoto, tier 5, SPECIAL/dollkeeper)
// ---------------------------------------------------------------------------------------------------------------
test('zj makoto 不羁之力: the <替身> carries the mask — ATK ×1.8, max HP ×1.35, BAT +0.4 s (0.4 / 1.2)', () => {
  const h = field([{ chessId: 'chess_zj_60_5_a', row: 10, col: 5 }], { enemies: [{ key: BAG, time: 0, pos: [10, 6] }] });
  const u = kj(h, 'chess_zj_60_5_a');
  h.run(0.1);
  assert.equal(u.skill.id, 'skchr_makoto_3', 'the record’s default skill');
  const atk0 = u.s.atk, hp0 = u.s.maxHp;
  assert.equal(atk0, 785);
  assert.equal(hp0, 2805);
  assert.ok(u.skill.activate('test', { free: true }), 'S3 cast ("立即切换为<替身>状态作战")');
  h.run(1.4); // the dollkeeper's 1 s switch animation
  assert.equal(u.mem.makotoMask, 'thanatos', 'S3 enters 塔纳托斯');
  assert.equal(u.trait.doll, true, 'the <替身> state is up');
  const buff = u.findBuff('makoto:mask');
  assert.ok(buff, 'the 不羁之力 buff');
  assert.equal(buff.mods.atkPct, 0.8);                    // talent 0 bb.atk
  assert.equal(Math.round(buff.mods.hpMul * 1000) / 1000, 1.35); // 1 + max_hp_t1 0.35 (the substitute's own share is 1)
  assert.ok(Math.abs(buff.mods.batPct - 0.4 / 1.2) < 1e-9, `batPct ${buff.mods.batPct} (expected 0.4 / BAT 1.2)`);
  assert.ok(Math.abs(u.s.atk - atk0 * 1.8) < 1e-6, `ATK ${u.s.atk} (expected ${atk0 * 1.8})`);
  assert.ok(Math.abs(u.s.maxHp - hp0 * 1.35) < 1e-6, `max HP ${u.s.maxHp} (expected ${hp0 * 1.35})`);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 炸惊卫戍特质 (garrison traits) carried by these records — the handlers live in the engine (garrisons/battle.js,
// engine-core's file); these assertions pin the numbers they must produce, so a regression shows up here.
// ---------------------------------------------------------------------------------------------------------------
/** A player whose two 盟约 are active, so a garrison trait's gains can be read off `bonds[id].layers`. */
const BONDS = () => ({ seesShip: { count: 5, active: true, tier: 1, layers: 0 }, swiftShip: { count: 3, active: true, tier: 1, layers: 0 } });

test('zj yukari garrison_zj_60_4_c: a 浮空 gives every active bond +1, seesShip +2 more, once per enemy', () => {
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_4_a', row: 10, col: 5, skillIndex: 0 }],
    defs: { enemies: { [BAG]: bag() } },
    enemies: [{ key: BAG, time: 0, pos: [10, 7] }],
    bonds: BONDS(),
    seed: 5,
  });
  const u = kj(h, 'chess_zj_60_4_a');
  h.run(0.05);
  const e = h.enemies()[0];
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast');
  h.run(3.6); // arrows at 1.533 / 1.833 / 2.133 s, the 浮空 burst at 3.367 s
  assert.ok(e.hasBuff('levitate'), 'the burst 浮空s the bag');
  const bonds = () => h.b.getPlayer('p1').bonds;
  // bb: bond_add_count 1 (every active bond, ONCE per enemy) + also_bond_add_count 2 (seesShip, every time)
  assert.equal(bonds().swiftShip.layers, 1, 'swiftShip +1');
  assert.equal(bonds().seesShip.layers, 3, 'seesShip +1 +2');
  // the same enemy again, after the status ran out: only the unlimited half (seesShip +2) applies
  h.runUntil(() => !e.hasBuff('levitate'), 10);
  assert.ok(u.skill.activate('test', { free: true }), 'S1 cast again');
  h.run(3.6);
  assert.equal(bonds().swiftShip.layers, 1, 'the once-per-enemy half does NOT fire again');
  assert.equal(bonds().seesShip.layers, 5, 'the seesShip half fires again (+2)');
});

test('zj aigis garrison_zj_60_3_c: entering any abnormal state gives every active bond +10 (new entries only)', () => {
  const h = makeBattle({
    units: [{ chessId: 'chess_zj_60_3_a', row: 10, col: 5 }],
    defs: { enemies: { [BAG]: bag() } },
    enemies: [{ key: BAG, time: 0 }],
    bonds: { seesShip: { count: 5, active: true, tier: 1, layers: 0 }, skillfulShip: { count: 3, active: true, tier: 1, layers: 0 } },
    seed: 5,
  });
  const u = kj(h, 'chess_zj_60_3_a');
  h.run(0.05);
  const bonds = () => h.b.getPlayer('p1').bonds;
  assert.equal(bonds().seesShip.layers, 0);
  h.b.applyStatus(u, 'stun', { duration: 3, source: null, force: true });
  h.run(0.1);
  assert.equal(bonds().seesShip.layers, 10, 'seesShip +10');
  assert.equal(bonds().skillfulShip.layers, 10, 'skillfulShip +10');
  // a refresh of the same status (entered === false) earns nothing
  h.b.applyStatus(u, 'stun', { duration: 3, source: null, force: true });
  h.run(0.1);
  assert.equal(bonds().seesShip.layers, 10, 'a refresh does not fire the trait again');
});

// ---------------------------------------------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------------------------------------------
test('zj kits: the same seed gives the same battle', () => {
  const run = () => {
    const h = field([{ chessId: 'chess_zj_amoris_a', row: 10, col: 5 }, { chessId: 'chess_zj_tmoris_a', row: 11, col: 6 }], {
      seed: 11, enemies: [{ key: BAG, time: 0, pos: [10, 6] }, { key: BAG, time: 0.5, pos: [11, 7] }],
    });
    h.run(8);
    return hashOf(h.snapshot());
  };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------------------------------------------------------
// registry + 炸惊外不可见
// ---------------------------------------------------------------------------------------------------------------
test('the registry holds the 炸惊 kits by chess id, and no 自选 slot can field them', () => {
  assert.deepEqual([...ZHAJING_KIT_FILES].sort(), ZJ_IDS.map((id) => `${id.replace(/_a$/, '')}-${CHESS[id].charId.replace(/^char_\d+_/, '')}.js`).sort());
  for (const id of ZJ_IDS) {
    assert.ok(ZHAJING_KITS[id], `${id}: in ZHAJING_KITS`);
    assert.equal(KITS[id], ZHAJING_KITS[id], `${id}: in the merged registry`);
    assert.ok(!Object.hasOwn(OPERATOR_KITS, id), `${id}: not a 自选 operator key`);
    assert.ok(!KITTED_CHARS.includes(CHESS[id].charId), `${id}: its charId is not a 自选 pick`);
  }
});

test('炸惊外不可见: no official difficulty lists a chess_zj_* record, the ZHAJING roster does', () => {
  for (const id of ZJ_IDS) {
    assert.equal(CHESS[id].zhajing, true, `${id}: zhajing`);
    assert.equal(CHESS[id].visible, false, `${id}: visible`);
    for (const modeId of ['mode_single_normal', 'mode_multi_normal', 'mode_single_hard', 'mode_multi_hard', 'mode_single_abyss']) {
      assert.ok(!new GameData(getData(), modeId).visibleChess.includes(id), `${modeId}: lists ${id}`);
    }
  }
  const zj = new GameData(getData(), 'mode_single_zhajing');
  assert.equal(zj.zhajing, true, 'the ZHAJING mode flag');
  for (const id of ZJ_IDS) assert.ok(zj.visibleChess.includes(id), `${id}: missing from the ZHAJING roster`);
  // and the other direction: the official roster never bleeds into the 炸惊 pool
  assert.ok(!zj.visibleChess.some((id) => !id.startsWith('chess_zj_')), 'the ZHAJING roster is the 炸惊 chess only');
});
