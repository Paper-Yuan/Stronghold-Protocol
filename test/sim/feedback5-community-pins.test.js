// test/sim/feedback5-community-pins.test.js — two community reports of 2026-10-06 that this tree already answers, pinned
// (DESIGN §25.14; they pass on the parent commit — nothing changed for them):
//   「敌人在忍冬技能范围内没有开技能，在攻击范围才开」 — 0.1.4 cast her default S3 隐狐之艺 on its official DEFAULT row, i.e.
//     only with an enemy in her 1-tile attack range; 0.2.0's ACTIVE_RANGE (the owner's decision of 2026-10-05, §25.5)
//     casts it with an enemy inside its running range 2-2. S2 坠刃拷问 casts on anything in its 技能范围 3-12
//     (SKILL_RANGE), S1 小施惩戒 (AUTO, no larger range) on her attack.
//   「悬赏敌人枯朽萃聚使徒召唤的枯朽之种被击杀也会获得赏金」 — the seeds come from spawnChildren, which drops the card's
//     bountyId / bountyCoins (0.1.3 §23.25, GitHub #67 / #89-2); killing them never paid on the own field, and since 0.1.3
//     a leaked seed no longer re-enters 联防 carrying the card (≤ 0.1.2 every one paid it again there).
// Run: node --test test/sim/feedback5-community-pins.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { planUnite } from '../../server/match/unite.js';

const ds = getDefaultSource();
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const dummy = (key) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0 });

test('忍冬: S3 casts with an enemy in its 2-2 running range (not only in her attack range), S2 on its 3-12, S1 on her attack', () => {
  const casts = (id, skillId, pos) => {
    const index = ds.rawChess(id).skills.find((s) => s.skillId === skillId).index;
    const h = makeBattle({ seed: 3, autoFinish: false, timeLimit: 60, defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, skillIndex: index }] });
    h.step();
    const u = h.unit(id);
    u.skill.gainSp(999, 'test');
    h.spawn('e', { pos });
    h.run(3);
    done(h);
    return u.skill.activations;
  };
  for (const id of ['chess_char_3_18_a', 'chess_char_3_18_b']) {
    assert.deepEqual(ds.rawChess(id).rangeGrid, [[0, 0], [0, 1]], `${id}: her own range is 1 tile ahead`);
    assert.ok(casts(id, 'skchr_vulpis_3', [10, 6]) >= 1, `${id} S3: an enemy 2 tiles ahead`);
    assert.equal(casts(id, 'skchr_vulpis_3', [10, 7]), 0, `${id} S3: not 3 tiles ahead`);
    for (const pos of [[10, 6], [10, 7], [9, 5]]) assert.equal(casts(id, 'skchr_vulpis_2', pos), 1, `${id} S2 (3-12): ${pos}`);
    assert.equal(casts(id, 'skchr_vulpis_1', [10, 6]), 0, `${id} S1: not out of her attack range`);
    assert.ok(casts(id, 'skchr_vulpis_1', [10, 5]) >= 1, `${id} S1: on her attack`);
  }
});

test('枯朽萃聚使徒 as a bounty: its 枯朽之种 carry no bounty and pay nothing; the body pays once; in 联防 only its own leak carries the card', () => {
  const card = { id: 'enemyeffect_10_8', card: { payout: 'kill', coin: 2, enemyKey: 'enemy_1321_wdarft' } };
  const h = makeBattle({
    autoFinish: false, timeLimit: 200,
    enemies: [{ key: 'enemy_1321_wdarft', route: 2, mods: { hpMul: 1, bountyId: card.id }, bounty: { coins: 2, ownerPlayerId: 'p1' }, tag: 'bounty', ownerPlayerId: 'p1' }],
  });
  assert.ok(h.runUntil(() => h.b.enemies.some((e) => e.alive && e.defId === 'enemy_1269_nhfly'), 30), 'BornBugs cast');
  const seeds = h.b.enemies.filter((e) => e.alive && e.defId === 'enemy_1269_nhfly');
  for (const s of seeds) {
    assert.equal(s.bounty, null);
    assert.ok(!s.mods || (s.mods.bountyId == null && s.mods.bountyCoins == null));
    h.b.kill(s, null);
  }
  assert.deepEqual(h.eventsOf('bounty'), [], 'the seeds pay nothing');
  h.b.kill(h.enemy('enemy_1321_wdarft'), null);
  assert.deepEqual(h.eventsOf('bounty'), [['bounty', 'p1', 2]], 'the body pays once');
  done(h);
  // 联防: the 使徒 and its seeds leak (no operator); only the 使徒 re-enters with the card's bounty
  const h2 = makeBattle({
    autoFinish: true, timeLimit: 200,
    enemies: [{ key: 'enemy_1321_wdarft', route: 2, mods: { hpMul: 1, bountyId: card.id }, bounty: { coins: 2, ownerPlayerId: 'p1' }, tag: 'bounty', ownerPlayerId: 'p1' }],
  });
  h2.runToEnd(200);
  const r = h2.result().perPlayer.p1;
  assert.ok(r.leaked.filter((l) => l.enemyKey === 'enemy_1269_nhfly').length >= 3, 'seeds leaked');
  const seat = (id, s, o = {}) => ({ playerId: id, seat: s, deployCount: o.deployCount ?? 1, bonds: {}, layers: {}, board: new Map(), bounties: o.bounties ?? [] });
  const leaker = seat('p1', 1, { bounties: [card] });
  const helperSeat = seat('H', 0, { deployCount: 3 });
  const m = { isSolo: false, alivePlayers: () => [leaker, helperSeat], gd: { unite: { maxHelpers: 2 }, enemy: (k) => ({ key: k }) } };
  const plan = planUnite(m, new Map([['p1', r], ['H', { perfect: true, leaked: [], unitsEnd: [] }]]));
  assert.deepEqual(plan.leaked.filter((l) => l.bounty).map((l) => [l.enemyKey, l.bounty.coins]), [['enemy_1321_wdarft', 2]]);
});
