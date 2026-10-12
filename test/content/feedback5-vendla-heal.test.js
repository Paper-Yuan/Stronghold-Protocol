// test/content/feedback5-vendla-heal.test.js — 刺玫 S2 荆藤庇荫 and her 咒愈师 trait (community report of 2026-10-06
// 「干员刺玫开技能（装备源石药剂）之后不能治疗」): the protégé takes only the trait heal of the S2 counter ("该角色受到攻击时刺玫
// 对目标造成攻击力20%的法术伤害并仅对该角色触发刺玫特性"; en "…and activates her Trait on the ally"; client buff vendla_tr: the
// S2TraitHealRange selector only for a damage whose modifier carries vendla_s_2). Her own attacks keep healing the lowest-HP
// ally in range — herself too (TraitHealRange: _excludeOwner 0). Until 0.2.0 every damage she dealt during the skill healed
// the protégé, so with 源石溶剂 draining her she healed nobody while it ran.
// Run: node --test test/content/feedback5-vendla-heal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const VENDLA = 'chess_char_1_06_a', SOLVENT = 'chess_item_1_05_e_a';
const tank = chessRec({ id: 't_tank', stats: { maxHp: 9000, atk: 0, def: 0 }, skill: null });
const still = (r, c) => ({ motion: 'WALK', start: [r, c], end: [r, c], checkpoints: [] });

/** 刺玫 (+ 源石溶剂) on (10, 4), a high-max-HP ally on (11, 4) — her protégé —, one dummy enemy on (10, 6) hitting `hits`. */
function field({ enemyAtk = 0, hits = null } = {}) {
  const h = makeBattle({
    defs: { chess: { t_tank: tank }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, atk: enemyAtk, speed: 0, range: enemyAtk ? 5 : 0, bat: 1 }) } },
    units: [{ chessId: VENDLA, row: 10, col: 4, items: [SOLVENT] }, { chessId: 't_tank', row: 11, col: 4 }],
    enemies: [{ key: 'e_dummy', time: 0, pos: [10, 6], route: still(10, 6) }],
    autoFinish: false, timeLimit: 60, seed: 3, captureNoisy: true, hooks: ['heal', 'damaged', 'skillStart'],
    setup: hits ? (b) => b.on('beforeAttack', (ctx) => { if (ctx.attacker.side === 'enemy') ctx.targets = [b.allyUnits.find((u) => u.defId === hits)]; }, { priority: 50 }) : null,
  });
  const v = h.unit(VENDLA), tk = h.unit('t_tank');
  h.run(8); // the 源石溶剂 drain has her below full HP
  const sk = v.skill;
  sk.sp = sk.spCost; sk.charges = Math.max(1, sk.charges);
  assert.ok(sk.activate('manual'), 'S2 starts');
  assert.equal(v.mem.protege, tk, 'the protégé is the highest-max-HP ally in range');
  return { h, v, tk, t0: h.b.time };
}

test('during 荆藤庇荫 her attacks heal the most injured ally in range (herself, drained by 源石溶剂), not the full-HP protégé', () => {
  const { h, v, tk, t0 } = field();
  h.run(10);
  assert.ok(v.skill.active, 'still running');
  const heals = h.hooksOf('heal').filter((c) => c.source === v && c.t >= t0 && c.amount > 0);
  assert.ok(heals.length >= 4, `she keeps healing: ${heals.length} heals in 10 s`);
  assert.ok(heals.every((c) => c.target === v), 'every attack heal goes to her — the only injured ally — never to the protégé');
  assert.equal(tk.hp, tk.s.maxHp);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('the S2 counter (a hit on the protégé) heals the protégé; her attacks still heal the lowest-HP ally', () => {
  const { h, v, tk, t0 } = field({ enemyAtk: 300, hits: 't_tank' });
  h.run(8);
  const counters = h.hooksOf('damaged').filter((c) => c.source === v && c.t >= t0 && (c.dmg?.tags || []).includes('counter'));
  assert.ok(counters.length >= 3, 'the enemy hitting the protégé draws counters');
  const heals = h.hooksOf('heal').filter((c) => c.source === v && c.t >= t0);
  const toTank = heals.filter((c) => c.target === tk), toHer = heals.filter((c) => c.target === v);
  assert.ok(toTank.length >= counters.length, `each counter heals the protégé (${toTank.length} heals for ${counters.length} counters)`);
  assert.ok(toHer.length > 0, 'her attacks heal the most injured ally — herself when she is lower than the protégé');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});
