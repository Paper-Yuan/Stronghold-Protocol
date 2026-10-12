// test/sim/feedback5-chain-heal.test.js — the 链愈师 heal chain (follow-up 27; PRTS 分支特性信息 链愈师 "跳跃范围为x-4，无特殊说明
// 的场合一次治疗链不会对已跳跃过的单位重复跳跃", "优先跳跃至范围内生命比例最低＞部署时间点最晚的我方单位。可选择满生命我方单位为跳跃目标，
// 但仍受禁疗制约") — server/sim/ai.js chainHealNext / doHeal (莎草's profession chain; Mon3tr's kit uses the same links). It used
// to jump to the most injured ally within 2.5 tiles (never a full-HP one, ties by list order).
// Run: node --test test/sim/feedback5-chain-heal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const GRID = []; for (let r = -2; r <= 2; r++) for (let c = 0; c <= 6; c++) GRID.push([r, c]);
const HEALER = chessRec({ id: 't_chain', profession: 'MEDIC', subProfessionId: 'chainhealer', stats: { maxHp: 1e4, atk: 100, bat: 1 }, skill: null, rangeGrid: GRID });
const wall = (id) => chessRec({ id, stats: { maxHp: 1e4, atk: 0, def: 0 }, skill: null });

/** The healer on (10, 2) and walls at `at` = { id: [row, col, hpRatio] }; returns the chain of its first heal (ids → wall ids). */
function firstChain(at, setup = null) {
  const ids = Object.keys(at);
  const h = makeBattle({
    defs: { chess: { t_chain: HEALER, ...Object.fromEntries(ids.map((id) => [id, wall(id)])) } },
    units: [{ chessId: 't_chain', row: 10, col: 2 }, ...ids.map((id) => ({ chessId: id, row: at[id][0], col: at[id][1] }))],
    content: 'none', autoFinish: false, timeLimit: 30, seed: 3,
  });
  h.step();   // deployed (the healer heals nobody yet: everyone is at full HP)
  for (const id of ids) { const u = h.unit(id); u.hp = u.s.maxHp * at[id][2]; }
  if (setup) setup(h);
  const n0 = h.events.length;
  for (let i = 0; i < 90 && !h.events.slice(n0).some((e) => e[0] === 'atk'); i++) h.step();   // (step drains the events)
  const name = new Map(h.b.allyUnits.map((u) => [u.id, u.defId]));
  const ev = h.events.slice(n0).filter((e) => e[0] === 'atk');
  checkInvariants(h.b);
  return { h, main: name.get(ev.find((e) => e[3] !== 'chainHeal')[2]), jumps: ev.filter((e) => e[3] === 'chainHeal').map((e) => [name.get(e[1]), name.get(e[2])]) };
}

test('the jump reaches the 3×3 around the last one healed (x-4), not an ally two tiles away; each jump goes on from where it landed', () => {
  // A (most injured) on (10, 5); B two tiles right of it (inside 2.5 tiles, outside its 3×3), C on its diagonal
  const r = firstChain({ t_a: [10, 5, 0.5], t_b: [10, 7, 0.6], t_c: [11, 6, 0.7] });
  assert.equal(r.main, 't_a');
  assert.deepEqual(r.jumps, [['t_a', 't_c'], ['t_c', 't_b']], 'A → C (its 3×3) → B (C\'s 3×3); it used to jump A → B → C');
});

test('a full-HP ally is a jump target when no injured one is in reach — healed for nothing, the chain jumps on from it', () => {
  const r = firstChain({ t_a: [10, 5, 0.5], t_d: [10, 6, 1], t_e: [10, 7, 0.6] });
  assert.equal(r.main, 't_a');
  assert.deepEqual(r.jumps, [['t_a', 't_d'], ['t_d', 't_e']], 'A → D (full HP) → E');
  assert.equal(r.h.unit('t_d').hp, r.h.unit('t_d').s.maxHp);
});

test('ties of the HP ratio: the latest deployed first; a 禁疗 unit is never a jump target', () => {
  const tie = firstChain({ t_a: [10, 5, 0.5], t_f: [9, 5, 0.8], t_g: [11, 5, 0.8] });
  const [f, g] = [tie.h.unit('t_f'), tie.h.unit('t_g')];
  const later = f.aggroSeq > g.aggroSeq ? 't_f' : 't_g';
  assert.deepEqual(tie.jumps[0], ['t_a', later], 'the later deployed of the two');
  const banned = firstChain({ t_a: [10, 5, 0.5], t_n: [10, 6, 0.2], t_m: [11, 5, 0.9] }, (h) => {
    h.b.addBuff(h.unit('t_n'), { key: 'test:healFree', status: 'healFree', flags: { noHeal: true, healFree: true } });
  });
  assert.equal(banned.main, 't_a', 'the 禁疗 unit is no main target either');
  assert.deepEqual(banned.jumps[0], ['t_a', 't_m'], 'the 禁疗 unit is skipped');
});
