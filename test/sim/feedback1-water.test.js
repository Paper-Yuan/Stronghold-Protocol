// Player report #3 after the 0.1.0 release: "有水池的那张图干员可以错误的被部署到水里，突袭分队干员也会自动落到水里".
// The pool is the 深水区 (tile_deepsea) of 战场#08(下半) 涨潮控制 (act2autochess_m04: board (10–12, 6), the partner's
// (10–12, 14), boss (3–5, 6) / (3–5, 14)). The level file says buildableType ALL, but the tile refuses deployment
// officially: PRTS 深水区 地形信息 "地形机制：拒绝部署（待补充）", and the season-1 战场#05 puts a 特制水上平台
// ("在水上建立可以部署任意单位的平台") on every one of its 深水区 tiles. The sim side: `grid.canStand` refuses it, so
// no automatic placement (the 突袭 landing tile, a tactician's tactical point, summon tiles) ever picks a water tile.
// The prep side (placement on the board) is test/match/feedback1-placement.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { inRange } from '../../server/sim/content/support/index.js';

const STAGE = 'act2autochess_m04';
const WATER = [[10, 6], [11, 6], [12, 6]];
const isWater = (b, r, c) => b.grid.tile(r, c).key === 'tile_deepsea';
const VIGIL = 'chess_char_3_19_a'; // 伺夜 (战术家): 狼群 on a tactical point
const WOLF = 'token_10028_vigil_wolf';

test('the stage data: 战场#08\'s 深水区 refuses deployment (effective buildable NONE; the level\'s buildableType kept)', () => {
  const st = getDefaultSource().getStage(STAGE);
  const raw = st.raw ?? st;
  const d = raw.tiles.d;
  assert.equal(d.tileKey, 'tile_deepsea');
  assert.equal(d.buildable, 'NONE', 'PRTS 深水区 地形信息: 拒绝部署');
  assert.equal(d.buildableType, 'ALL', 'the level file\'s own value is kept');
  const deploy = new Set([...raw.deployTiles.normal.melee, ...raw.deployTiles.normal.rangedOnly].map(([r, c]) => `${r},${c}`));
  for (const [r, c] of WATER) assert.ok(!deploy.has(`${r},${c}`), `deployTiles.normal excludes ${r},${c}`);
  for (const side of ['bossLeft', 'bossRight']) {
    const t = new Set([...raw.deployTiles[side].melee, ...raw.deployTiles[side].rangedOnly].map(([r, c]) => `${r},${c}`));
    for (const [r, c] of [[3, 6], [4, 6], [5, 6], [3, 14], [4, 14], [5, 14]]) assert.ok(!t.has(`${r},${c}`), `${side} excludes ${r},${c}`);
  }
});

test('grid.canStand refuses the water for melee and ranged units; the road next to it stays standable', () => {
  const h = makeBattle({ stageId: STAGE, units: [] });
  for (const [r, c] of WATER) {
    assert.ok(isWater(h.b, r, c));
    assert.equal(h.b.grid.canStand(r, c), false, `melee ${r},${c}`);
    assert.equal(h.b.grid.canStand(r, c, { ranged: true }), false, `ranged ${r},${c}`);
    assert.equal(h.b.grid.groundPassable(r, c), true, 'enemies still wade through it');
  }
  assert.equal(h.b.grid.canStand(11, 5), true);
  assert.equal(h.b.grid.canStand(12, 7, { ranged: true }), true);
  // the other tile the deploy map denies to melee units: a hard-blocked tile (a 射击台 a map card switched on, ranged
  // only in the prep) — no automatic placement puts a melee unit there either
  h.b.setObstacle(12, 7, true);
  assert.equal(h.b.grid.canStand(12, 7), false, 'melee: not on a 射击台');
  assert.equal(h.b.grid.canStand(12, 7, { ranged: true }), true, 'ranged: may stand on it');
});

test('#3 突袭: an idle member jumping to an enemy that wades in the pool lands on dry ground next to it, never in the water', () => {
  const defs = {
    chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], profession: 'WARRIOR', skill: null }) },
    enemies: { enemy_wader: enemyRec({ key: 'enemy_wader', hp: 1e7, speed: 0 }) },
  };
  for (const [er, ec] of WATER) {
    const h = makeBattle({
      stageId: STAGE, defs, bonds: { raidShip: { count: 2, active: true, tier: 1, layers: 0 } },
      enemies: [{ key: 'enemy_wader', pos: [er, ec] }], units: [{ chessId: 'r_m', row: 9, col: 3 }],
    });
    const u = h.unit('r_m');
    assert.ok(h.runUntil(() => u.alive && (u.tileR !== 9 || u.tileC !== 3), 14), `jumped (enemy at ${er},${ec})`);
    assert.ok(!isWater(h.b, u.tileR, u.tileC), `landed on ${u.tileR},${u.tileC}, not in the water (enemy ${er},${ec})`);
    assert.ok(h.b.grid.canStand(u.tileR, u.tileC), 'a tile a melee operator may be deployed on');
    assert.ok(inRange(u, h.enemy('enemy_wader')), 'the enemy is in range after the jump');
    checkInvariants(h.b);
  }
});

test('#3 the tactical point of a tactician never lies in the water (伺夜 facing the pool, no 狼群 piece placed)', () => {
  // 伺夜 on the fenced tile (11,7) facing LEFT: her range covers the pool (10–12, 6) — the nearest tiles on the enemy
  // path (11,6) — and the road (12,7) / (12,5) / (11,5) behind it
  const h = makeBattle({ stageId: STAGE, units: [{ chessId: VIGIL, row: 11, col: 7, dir: 'LEFT' }] });
  h.step(1);
  const vigil = h.unit(VIGIL);
  assert.ok(vigil && vigil.alive);
  const tp = h.b.findTacticalPoint(vigil);
  assert.ok(tp, 'a tactical point exists');
  assert.ok(!isWater(h.b, tp[0], tp[1]), `tactical point ${tp} is not water`);
  h.run(1);
  const wolf = h.allies().find((u) => u.defId === WOLF && u.alive);
  assert.ok(wolf, 'the pack came as her 援军');
  assert.ok(!isWater(h.b, wolf.tileR, wolf.tileC), `the pack stands on ${wolf.tileR},${wolf.tileC}, not in the water`);
  assert.ok((vigil.baseRangeKeys || []).includes(wolf.tileR * 21 + wolf.tileC), 'inside her attack range');
  checkInvariants(h.b);
});
