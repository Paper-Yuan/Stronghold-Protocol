// User playtest #6 items 1 and 2 (from a friend): 凯瑟琳's device and 赫默's drone could not be placed by hand. The
// prep side is test/match/playtest6_summons.test.js; this file is the battle side of the placed pieces
// (server/sim/content/tokens.js dockSkillSummons / releaseSkillSummon, Battle.start `deferDeploy`, the summoner
// kits in kits/ops/, the 爬行号·防护单元 token kit):
//   * PRTS 卫戍协议/帮助 §作战阶段: the board summons deploy after the operators; "若战场区初始部署有召唤物，若召唤物在
//     战斗期间退场，将在满足条件后立即原地再部署1个" — a placed piece marks the tile its summon deploys on;
//   * a skill's summon (赫默 医疗探机, 巫恋 诅咒娃娃: "获得一个…") deploys once on its tile at the battle start, for free
//     ("所有手动部署的召唤物，无视所属干员的持有状态…作战开始时立即部署一次", example 赫默's drone; settled by the user
//     after playtest #6 — shared/constants.js SKILL_SUMMON_START_DEPLOY), then waits on its tile and takes the field
//     there each time the owner's skill gives one — also as soon as its owner is back with one in stock;
//     not placed ⇒ it never appears (the hidden 待部署区 deploys nothing by itself);
//   * a talent's summon the owner holds from the start (凯瑟琳 "携带3个支援装置（最多部署2个）") deploys with the board;
//   * not placed: a skill's summon, a device or 海嗣 never appears; the tacticians' 狼群 / 流形 still come as their 援军 on
//     a tactical point (docs/PLAYING.md §4 and docs/SIM.md say exactly this).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';

const REAL = { skip: !hasGeneratedData() };
const guard = (o = {}) => chessRec({ id: 'test_guard', profession: 'WARRIOR', skill: null, stats: { atk: 0, maxHp: 1e5, def: 0, blockCnt: 2 }, ...o });
const SILENCE = 'chess_char_2_02_a';
const CATHY = 'chess_char_4_11_a';
const SHAMARE = 'chess_char_3_15_a';

test('#2 赫默: the placed 医疗探机 deploys once at the start (10 s); each S2 brings it back onto its own tile', REAL, () => {
  const h = makeBattle({
    defs: { chess: { test_guard: guard() } },
    units: [{ chessId: SILENCE, row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 4, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.healDrone, ownerUid: 1, row: 11, col: 4, uid: 3, dir: 'RIGHT' }],
    autoFinish: false, timeLimit: 120, hooks: ['death', 'deploy'],
  });
  h.step();
  const hm = h.unit(SILENCE);
  const piece = h.b.allyUnits.find((u) => u.uid === 3);
  assert.ok(piece, 'the board piece is a unit of the battle');
  assert.equal(piece.alive, true, 'the free start deploy, with the board');
  assert.deepEqual([piece.tileR, piece.tileC], [11, 4]);
  const order = h.hooksOf('deploy').filter((c) => c.initial).map((c) => c.unit);
  assert.ok(order.indexOf(piece) > order.indexOf(hm) && order.indexOf(piece) > order.indexOf(h.unit('test_guard')), 'after the operators');
  assert.equal(hm.skill.activations, 0, 'before any skill: the start deploy ignores the holding');
  assert.ok(h.runUntil(() => !piece.alive, 12));
  assert.ok(Math.abs(piece.deathAt - 10) < 0.1, 'gone after its 10 s');
  assert.equal(h.b.isReservedTile(11, 4), true, 'its tile stays reserved');
  const drones = () => h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.healDrone && u.alive);
  h.unit('test_guard').hp = 1000;
  assert.ok(h.runUntil(() => hm.skill.activations >= 1, 40), 'S2 fires');
  h.step();
  assert.equal(drones().length, 1, 'the drone comes with the skill');
  assert.equal(drones()[0], piece, 'it is the placed piece');
  assert.deepEqual([piece.tileR, piece.tileC], [11, 4], 'on the tile the player chose');
  const t0 = piece.deployedAt;
  assert.ok(h.runUntil(() => !piece.alive, 12));
  assert.ok(Math.abs(piece.deathAt - t0 - 10) < 0.05, 'gone after 10 s');
  assert.equal(h.b.isReservedTile(11, 4), true, 'the tile is still its own');
  // the next S2: back on the same tile
  assert.ok(h.runUntil(() => hm.skill.activations >= 2, 40), 'S2 again');
  h.step();
  assert.equal(piece.alive, true);
  assert.deepEqual([piece.tileR, piece.tileC], [11, 4]);
  assert.equal(drones().length, 1, 'one drone at a time');
  checkInvariants(h.b);
});

test('#2 赫默 without a placed drone piece: S2 fires but no drone appears (it only deploys where a piece was placed)', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_guard: guard() } }, units: [{ chessId: SILENCE, row: 10, col: 3 }, { chessId: 'test_guard', row: 10, col: 4 }], autoFinish: false, timeLimit: 90 });
  h.step();
  const hm = h.unit(SILENCE);
  h.unit('test_guard').hp = 1000;
  assert.ok(h.runUntil(() => hm.skill.activations >= 1, 40));
  h.run(1);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.healDrone).length, 0);
  checkInvariants(h.b);
});

test('巫恋: the placed 诅咒娃娃 deploys once at the start, then appears on its tile when S2 fires (15 s)', REAL, () => {
  const h = makeBattle({
    units: [{ chessId: SHAMARE, row: 10, col: 3, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.curseDoll, ownerUid: 1, row: 10, col: 6, uid: 2 }],
    autoFinish: false, timeLimit: 120,
  });
  h.step();
  const sh = h.unit(SHAMARE);
  const doll = h.b.allyUnits.find((u) => u.uid === 2);
  assert.equal(doll.alive, true, 'the free start deploy');
  assert.ok(h.runUntil(() => !doll.alive, 20));
  assert.ok(Math.abs(doll.deathAt - 15) < 0.1, 'its 15 s');
  h.run(6);                                           // past the token's redeploy time: nothing without a cast
  assert.equal(doll.alive, false, 'no second doll before S2');
  sh.skill.sp = sh.skill.spCost;
  sh.skill.activate('test', { free: true });
  h.step();
  assert.equal(doll.alive, true);
  assert.deepEqual([doll.tileR, doll.tileC], [10, 6]);
  const t0 = doll.deployedAt;
  assert.ok(h.runUntil(() => !doll.alive, 20));
  assert.ok(Math.abs(doll.deathAt - t0 - 15) < 0.05, '15 s');
  checkInvariants(h.b);
});

test('#1 凯瑟琳: the two placed devices deploy with the board on their tiles and shield the operator each faces', REAL, () => {
  const h = makeBattle({
    defs: { chess: { test_guard: guard() } },
    units: [
      { chessId: CATHY, row: 12, col: 3, uid: 1 },
      { chessId: 'test_guard', row: 10, col: 5, uid: 2 },
      { chessId: 'test_guard', row: 11, col: 7, uid: 3 },
      { kind: 'token', tokenId: TOKEN_IDS.catShield, ownerUid: 1, row: 10, col: 4, uid: 4, dir: 'RIGHT' },   // faces (10,5)
      { kind: 'token', tokenId: TOKEN_IDS.catShield, ownerUid: 1, row: 12, col: 7, uid: 5, dir: 'DOWN' },    // faces (11,7)
    ],
    autoFinish: false, timeLimit: 30,
  });
  h.step();
  const cat = h.unit(CATHY);
  const devs = h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.catShield);
  assert.equal(devs.length, 2, 'no device beyond the placed ones');
  assert.ok(devs.every((d) => d.alive), 'both deployed at the start');
  assert.deepEqual(devs.map((d) => `${d.tileR},${d.tileC}`).sort(), ['10,4', '12,7']);
  const cap = cat.s.maxHp * h.b.tokenDef(TOKEN_IDS.catShield, cat).talents[0].bb.max_shield_ratio;
  for (const uid of [2, 3]) {
    const g = h.b.allyUnits.find((u) => u.uid === uid);
    assert.ok(Math.abs(g.s.shield - cap) < 1e-6, `operator ${uid} shielded (${g.s.shield} vs ${cap})`);
  }
  // S1 岁月锻打 reads the device shield: the operators holding one are recognised
  assert.ok(h.b.allyUnits.find((u) => u.uid === 2).findBuff('cathy:shield'));
  checkInvariants(h.b);
});

test('#1 凯瑟琳 with no device placed: no device in battle', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_guard: guard() } }, units: [{ chessId: CATHY, row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 5 }], autoFinish: false, timeLimit: 20 });
  h.run(2);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.catShield).length, 0);
  checkInvariants(h.b);
});

test('not placed: 赫默 / 巫恋 / 凯瑟琳 / 浊心斯卡蒂 summon nothing; 伺夜 / 缪尔赛思 still bring their 援军 on a tactical point', REAL, () => {
  const run = (chessId, cast = false) => {
    const h = makeBattle({ units: [{ chessId, row: 10, col: 3, uid: 1 }], autoFinish: false, timeLimit: 20 });
    h.run(2);
    if (cast) {   // the skill that gives the summon fires: still nothing without a piece
      const u = h.unit(chessId);
      u.skill.sp = u.skill.spCost;
      u.skill.activate('test', { free: true });
      h.run(1);
      assert.ok(u.skill.activations >= 1, `${chessId} cast its skill`);
    }
    const toks = h.b.allyUnits.filter((u) => u.kind === 'token' && u.alive);
    checkInvariants(h.b);
    return toks;
  };
  for (const id of [SILENCE, SHAMARE]) assert.equal(run(id, true).length, 0, id);
  for (const id of [CATHY, 'chess_char_6_04_a']) assert.equal(run(id).length, 0, id);
  const wolf = run('chess_char_3_19_a');
  assert.deepEqual(wolf.map((u) => u.defId), [TOKEN_IDS.wolfPack], '伺夜: her 狼群 as 援军');
  const mf = run('chess_char_6_11_a');
  assert.deepEqual(mf.map((u) => u.defId), [TOKEN_IDS.manifold], '缪尔赛思: her 流形 as 援军');
});

test('巫恋 leaves ⇒ her doll leaves (PRTS 诅咒娃娃 备注); 赫默 leaves ⇒ her drone stays (PRTS 医疗探机 备注)', REAL, () => {
  const cast = (h, id) => { const u = h.unit(id); u.skill.sp = u.skill.spCost; u.skill.activate('test', { free: true }); h.step(); return u; };
  // 巫恋 knocked out while her doll is up: the doll is withdrawn, and it does not come back while she is down
  const h = makeBattle({
    units: [{ chessId: SHAMARE, row: 10, col: 3, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.curseDoll, ownerUid: 1, row: 10, col: 6, uid: 2 }],
    autoFinish: false, timeLimit: 120,
  });
  h.step();
  const sh = cast(h, SHAMARE);
  const doll = h.b.allyUnits.find((u) => u.uid === 2);
  assert.equal(doll.alive, true);
  cast(h, SHAMARE);                                   // a second doll in stock while the first one stands
  h.b.dealDamage(null, sh, { amount: 1e9, type: 'true' });
  h.step();
  assert.equal(sh.alive, false);
  assert.equal(doll.alive, false, 'the doll leaves with 巫恋');
  h.run(10);
  assert.equal(doll.alive, false, 'no doll while 巫恋 is off the field (the stocked one waits)');
  assert.equal(h.b.isReservedTile(10, 6), true, 'the piece keeps its tile');
  checkInvariants(h.b);

  // 赫默 knocked out while her drone is up: the drone keeps healing until its 10 s are over
  const g = makeBattle({
    defs: { chess: { test_guard: guard() } },
    units: [{ chessId: SILENCE, row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 4, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.healDrone, ownerUid: 1, row: 11, col: 4, uid: 3 }],
    autoFinish: false, timeLimit: 120,
  });
  g.step();
  const hm = cast(g, SILENCE);
  const drone = g.b.allyUnits.find((u) => u.uid === 3);
  assert.equal(drone.alive, true);
  const t0 = drone.deployedAt;
  g.b.dealDamage(null, hm, { amount: 1e9, type: 'true' });
  g.step();
  assert.equal(hm.alive, false);
  assert.equal(drone.alive, true, 'the drone stays when 赫默 leaves');
  assert.ok(g.runUntil(() => !drone.alive, 12));
  assert.ok(Math.abs(drone.deathAt - t0 - 10) < 0.05, 'until its own 10 s end');
  checkInvariants(g.b);
});

test('a stocked summon takes the field as soon as its owner is back (PRTS "满足条件后立即原地再部署1个"; playtest #6 review)', REAL, () => {
  const cast = (h, id) => { const u = h.unit(id); u.skill.sp = u.skill.spCost; u.skill.activate('test', { free: true }); h.step(); return u; };
  // 赫默: S2 while the drone stands ⇒ one in stock; knocked out, the drone runs out; she redeploys ⇒ the drone at once
  const g = makeBattle({
    defs: { chess: { test_guard: guard() } },
    units: [{ chessId: SILENCE, row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 4, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.healDrone, ownerUid: 1, row: 11, col: 4, uid: 3 }],
    autoFinish: false, timeLimit: 120,
  });
  g.step();
  const drone = g.b.allyUnits.find((u) => u.uid === 3);
  assert.equal(drone.alive, true, 'the start deploy');
  const hm = cast(g, SILENCE);
  assert.equal(hm.mem.summonStock[TOKEN_IDS.healDrone], 1, 'the S2 drone waits in stock while the first one stands');
  g.b.dealDamage(null, hm, { amount: 1e9, type: 'true' });
  g.step();
  assert.ok(g.runUntil(() => !drone.alive, 12), 'the drone runs out its 10 s');
  g.run(8);
  assert.equal(drone.alive, false, 'nothing while 赫默 is down');
  assert.ok(g.b.redeploy(hm, { free: true }), '赫默 back on her tile');
  g.step();
  assert.equal(drone.alive, true, 'the stocked drone deploys at once');
  assert.deepEqual([drone.tileR, drone.tileC], [11, 4]);
  assert.equal(hm.mem.summonStock[TOKEN_IDS.healDrone], 0, 'stock used');
  checkInvariants(g.b);

  // 巫恋: her doll leaves with her; the stocked one comes back with her
  const h = makeBattle({
    units: [{ chessId: SHAMARE, row: 10, col: 3, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.curseDoll, ownerUid: 1, row: 10, col: 6, uid: 2 }],
    autoFinish: false, timeLimit: 120,
  });
  h.step();
  const doll = h.b.allyUnits.find((u) => u.uid === 2);
  const sh = cast(h, SHAMARE);
  assert.equal(doll.alive, true);
  h.b.dealDamage(null, sh, { amount: 1e9, type: 'true' });
  h.step();
  assert.equal(doll.alive, false, 'the doll leaves with 巫恋');
  h.run(8);
  assert.ok(h.b.redeploy(sh, { free: true }));
  h.step();
  assert.equal(doll.alive, true, 'the stocked doll deploys as soon as 巫恋 is back');
  checkInvariants(h.b);
});
