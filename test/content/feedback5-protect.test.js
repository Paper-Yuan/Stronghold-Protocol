// test/content/feedback5-protect.test.js — 庇护 is one effect per unit whoever grants it (gamedata_const ba.protect / PRTS 术语
// 庇护 "受到的物理和法术伤害降低相应比例（同名效果取最高）"): the older kits — 宴, 余, 缪尔赛思 (chess), 赫拉格, 左乐, 赫德雷 (自选) —
// hold it through the shared key the other 自选 kits use (kits/shared/tier1.js PROTECT / holdProtect → battle.applyStrongest),
// so the strongest value applies instead of a product of every source. 遥's bubbles keep their own key (the client's
// damage_resistance[bonus], which multiplies with the common damage_resistance[inf]).
// Run: node --test test/content/feedback5-protect.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { PROTECT, holdProtect } from '../../server/sim/content/kits/shared/tier1.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ds = getDefaultSource();
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

/** 宴 (elite: 庇护 below hp_ratio) at 20 % HP with nothing to hit her. */
function utage() {
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_18_b', row: 9, col: 5 }], autoFinish: false, timeLimit: 60, seed: 3 });
  h.step();
  const u = h.unit('chess_char_1_18_b');
  u.hp = u.s.maxHp * 0.2;
  h.step();
  return { h, u, dr: ds.rawChess('chess_char_1_18_b').talents.filter((t) => t.index !== -1)[0].bb.damage_resistance };
}
/** Physical damage she takes from a 1000-point hit (her DEF taken off). */
const physTaken = (h, u) => { const hp = u.hp; h.b.dealDamage(null, u, { amount: 1000, type: 'phys', canDodge: false }); const d = hp - u.hp; u.hp = hp; return d; };

test('宴 below her threshold holds the shared 庇护; a stronger one from another source replaces it (no product), a weaker one waits under it', () => {
  const { h, u, dr } = utage();
  assert.ok(dr > 0 && dr < 0.5);
  const b = u.findBuff(PROTECT);
  assert.ok(b && b.source === u && b.data.value === dr, 'her own 庇护, on the shared key');
  const base = 1000 - u.s.def;
  approx(physTaken(h, u), base * (1 - dr), 'hers alone');
  // a stronger 庇护 from another source: the highest counts
  holdProtect(h.b, u, 0.5, 10, { id: 'other' });
  h.step();
  approx(physTaken(h, u), base * (1 - 0.5), 'the stronger one only — not ×(1 − dr) as well');
  assert.equal(u.buffs.filter((x) => x.key === PROTECT).length, 1, 'one 庇护 effect');
  done(h);
  // a weaker one: hers holds
  const w = utage();
  holdProtect(w.h.b, w.u, 0.1, 10, { id: 'other' });
  w.h.step();
  approx(physTaken(w.h, w.u), (1000 - w.u.s.def) * (1 - w.dr), 'hers — the weaker 庇护 waits');
  // back above the threshold her own lapses within a tick; the weaker one resumes for its remaining time
  w.u.hp = w.u.s.maxHp;
  w.h.step(3);
  const after = w.u.findBuff(PROTECT);
  assert.ok(after && after.data.value === 0.1, 'the weaker 庇护 resumed');
  done(w.h);
});

test('余 (blocking), 缪尔赛思\'s melee copies, 赫拉格 / 左乐 (SBL-X, below 50 %) and 赫德雷 (余火之氅) all hold 庇护 on the shared key', () => {
  const src = (f) => readFileSync(new URL(`../../server/sim/content/kits/ops/${f}`, import.meta.url), 'utf8');
  for (const f of ['chess_char_1_18-utage.js', 'chess_char_6_03-yu.js', 'chess_char_6_11-mlyss.js', 'op-helage.js', 'op-zuole.js', 'op-hodrer.js']) {
    assert.match(src(f), /holdProtect\(/, `${f} uses the shared 庇护`);
    assert.doesNotMatch(src(f), /physTakenMul: 1 - dr|dmg\.mul \*= 1 - (dr|protectCut|num\(t\.damage_resistance\))/, `${f}: no private 庇护 multiplier left`);
  }
  // 遥's bubble stays its own effect (damage_resistance[bonus])
  assert.doesNotMatch(src('op-haruka.js'), /holdProtect\(/);
  // 赫拉格 (SBL-X, tier 5) at 40 % HP: his 庇护 on the shared key
  const h = makeBattle({
    defs: { enemies: { e: enemyRec({ key: 'e', hp: 1e9, speed: 0 }) } },
    units: [{ diy: { slot: 5, charId: 'char_188_helage', skillIndex: 0, uniEquipId: 'uniequip_002_helage' }, elite: true, row: 10, col: 5 }],
    autoFinish: false, timeLimit: 30, seed: 3,
  });
  h.step();
  const u = h.b.allyUnits.find((x) => x.def?.charId === 'char_188_helage');
  u.hp = u.s.maxHp * 0.4;
  h.step();
  const b = u.findBuff(PROTECT);
  assert.ok(b && b.source === u && b.data.value === 0.25, 'his SBL-X 庇护');
  u.hp = u.s.maxHp;
  h.step(3);
  assert.equal(u.findBuff(PROTECT), null, 'gone above 50 %');
  done(h);
});

test('0.2.0 WV: no kit keeps its own copy of the shared 庇护 key or mods — 淬羽赫默, 黍, 斥罪, 森蚺, 娜斯提 hold it through holdProtect, 遥\'s bubbles share only the mods', () => {
  const dir = new URL('../../server/sim/content/kits/ops/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(s, /const (PROTECT|protectMods) =|applyStrongest\([^)]*['"]protect['"]|applyStrongest\(\w+, PROTECT\b/, `${f}: the shared tier1.js PROTECT / protectMods / holdProtect`);
  }
  for (const f of ['op-slent2.js', 'op-shu.js', 'op-judge.js', 'op-zumama.js', 'op-nasti.js']) {
    assert.match(readFileSync(new URL(f, dir), 'utf8'), /holdProtect\(/, `${f} uses holdProtect`);
  }
});
