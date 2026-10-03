// Official ground pathing (research 08 §3): 4-direction SPFA flow field from the goal (UP, RIGHT, DOWN, LEFT), crates
// cost 1000, Bresenham line-of-sight smoothing; enemies walk tile centre to tile centre along next[tile].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, OBSTACLE_COST, bresenhamTiles } from '../../server/sim/grid.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { makeBattle, flatStage, enemyRec } from '../helpers/battleHarness.js';
import { remainingDistance } from '../../server/sim/ai.js';

const REAL = { skip: !hasGeneratedData() && 'no generated data' };
const NORMAL = { r0: 9, r1: 12, c0: 0, c1: 10 };
const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1, ...o });
const K = (r, c) => r * 21 + c;

/** Grid of a real stage with its match-start devices (crates cost 1000, platforms / mounds blocked). */
function stageGrid(id) {
  const st = getDefaultSource().getStage(id);
  const g = new Grid(st, NORMAL);
  for (const d of st.raw.devices) {
    if (!d.active || !d.pos) continue;
    if (d.role === 'crate') g.setObstacle(d.pos[0], d.pos[1], true, 'crate');
    if (d.role === 'platform' || d.role === 'mound') g.setObstacle(d.pos[0], d.pos[1], true);
  }
  return g;
}
const wp = (g, r, c) => g.waypoints(r, c, 9, 2).map((p) => `(${p})`).join(' ');

test('flow field: 4 directions only, strict-improvement SPFA with the official UP/RIGHT/DOWN/LEFT tie-break', () => {
  const g = new Grid(flatStage(), NORMAL);
  const f = g.flowField(9, 2);
  assert.equal(f.dist[K(9, 2)], 0);
  assert.equal(f.dist[K(9, 10)], 8, 'Manhattan distance along the open lane');
  assert.equal(f.dist[K(12, 10)], 11, 'no diagonal edges: 3 + 8');
  // every raw parent is a 4-neighbour one step closer
  for (let k = 0; k < f.dist.length; k++) {
    if (f.dist[k] <= 0) continue;
    const p = f.parent[k];
    assert.equal(Math.abs(((p / 21) | 0) - ((k / 21) | 0)) + Math.abs((p % 21) - (k % 21)), 1);
    assert.equal(f.dist[p], f.dist[k] - 1);
  }
  // equal costs: a tile keeps the first parent that reached it — (10,4) is reached from (10,3) (RIGHT of it) before
  // (9,4) (UP of it) is expanded, because (10,3) entered the queue first (UP from (9,3))
  assert.equal(f.parent[K(10, 4)], K(10, 3));
  // walls are not walkable: the high ground at col 2 of rows 10–12 has no distance
  assert.equal(f.dist[K(11, 2)], -1);
});

test('smoothing: next[] jumps to the farthest ancestor in Bresenham line of sight; diagonal steps need both orthogonals', () => {
  const g = new Grid(flatStage(), NORMAL);
  assert.deepEqual(g.waypoints(9, 10, 9, 2), [[9, 10], [9, 2]], 'straight lane');
  assert.deepEqual(g.waypoints(12, 10, 9, 2), [[12, 10], [9, 2]], 'open field: one straight line to the goal');
  // the crossed tiles form an 8-connected chain that never cuts a corner
  const p = g.findPath(12, 10, 9, 2);
  assert.deepEqual(p, bresenhamTiles([12, 10], [9, 2]));
  for (let i = 1; i < p.length; i++) {
    const [r0, c0] = p[i - 1], [r1, c1] = p[i];
    assert.ok(Math.abs(r1 - r0) <= 1 && Math.abs(c1 - c0) <= 1);
    if (r1 !== r0 && c1 !== c0) assert.ok(g.walkable(r0, c1) && g.walkable(r1, c0));
  }
  // a wall stub at (10,6)…(12,6): the upper route bends around its end instead of cutting through
  for (const r of [10, 11, 12]) g.setObstacle(r, 6, true);
  const bent = g.waypoints(12, 10, 9, 2);
  assert.ok(bent.length > 2);
  for (const [r, c] of g.findPath(12, 10, 9, 2)) assert.ok(!(c === 6 && r >= 10), `crosses the wall at (${r},${c})`);
  // allowDiagonal=false: line of sight only along a row / column
  const fx = g.flowField(9, 2, { allowDiagonal: false });
  let k = K(12, 10);
  while (k !== fx.dest) {
    const n = fx.next[k];
    assert.ok(((n / 21) | 0) === ((k / 21) | 0) || n % 21 === k % 21, 'axis-aligned hop');
    k = n;
  }
});

test('crates: walkable at cost 1000 (blocks line of sight), blocks are impassable; each kind toggles its own bit', () => {
  const g = new Grid(flatStage(), NORMAL);
  const v0 = g.version;
  g.setObstacle(9, 6, true, 'crate');
  assert.ok(g.version > v0 && g.isObstacle(9, 6) && g.isCrate(9, 6) && !g.isBlocked(9, 6));
  assert.equal(g.groundPassable(9, 6), false, 'not a placement / displacement tile');
  assert.equal(g.walkable(9, 6), true, 'but walkable for the flow field');
  let f = g.flowField(9, 2);
  assert.equal(f.dist[K(9, 6)], 3 + OBSTACLE_COST, "(9,5) is 3 from the goal, entering the crate costs 1000");
  assert.ok(!g.findPath(9, 10, 9, 2).some(([r, c]) => r === 9 && c === 6), 'detours around the crate');
  // wall off every detour: the crate is the only way — the path goes through it (the enemy will break it)
  for (const r of [10, 11, 12]) g.setObstacle(r, 6, true);
  f = g.flowField(9, 2);
  assert.ok(f.dist[K(9, 10)] > OBSTACLE_COST);
  assert.ok(g.findPath(9, 10, 9, 2).some(([r, c]) => r === 9 && c === 6), 'through the crate');
  // a crate turned into a platform on the same tile: both bits, order-independent
  g.setObstacle(9, 6, true, 'block');
  g.setObstacle(9, 6, false, 'crate');
  assert.ok(g.isBlocked(9, 6) && !g.isCrate(9, 6));
  assert.equal(g.findPath(9, 10, 9, 2), null, 'fully walled');
  assert.ok(g.findPath(9, 10, 9, 2, { ignoreObstacles: true }));
});

test('flow fields are cached per destination and grid version', () => {
  const g = new Grid(flatStage(), NORMAL);
  const a = g.flowField(9, 2);
  assert.equal(g.flowField(9, 2), a);
  assert.notEqual(g.flowField(9, 3), a);
  g.setObstacle(10, 5, true);
  assert.notEqual(g.flowField(9, 2), a, 'rebuilt after an obstacle change');
  g.setObstacle(10, 5, true); // no change → no version bump
  const b = g.flowField(9, 2);
  assert.equal(g.flowField(9, 2), b);
});

test('real stages: the official lanes of research 08 §3.2 (crates = non-hidden level predefines, platforms blocking) + blockable-ground preference', REAL, () => {
  // m01 lower gate: equal-length choice between the col-9 floor lane and the col-8 road — the road (blockable) wins
  // (official: (9,9) → (12,8) through the floor of (10,9)); m04 lower gate: the official diagonal (9,10) → (10,7) only
  // brushes the corner of the floor (10,9) and stays (community report D5, test/sim/pathing-official.test.js)
  const lanes = {
    act1autochess_m01: ['(12,10) (12,4) (9,4) (9,2)', '(9,10) (9,8) (12,8) (12,4) (9,4) (9,2)'],
    act1autochess_m02: ['(12,10) (12,3) (9,3) (9,2)', '(9,10) (9,9) (11,9) (11,6) (9,6) (9,2)'],
    act1autochess_m03: ['(12,10) (12,6) (11,6) (9,5) (9,2)', '(9,10) (9,2)'], // 射击台 on (10,3)/(10,4) block [ASSUMED]
    act1autochess_m04: ['(12,10) (12,9) (11,9) (11,4) (9,4) (9,2)', '(9,10) (10,7) (10,4) (9,4) (9,2)'],
    act2autochess_m01: ['(12,10) (12,9) (9,9) (9,7) (12,7) (12,5) (9,5) (9,2)', '(9,10) (9,7) (12,7) (12,5) (9,5) (9,2)'],
    act2autochess_m02: ['(12,10) (12,7) (9,7) (9,2)', '(9,10) (9,2)'],
    act2autochess_m03: ['(12,10) (12,4) (9,4) (9,2)', '(9,10) (9,9) (10,9) (10,6) (9,6) (9,2)'],
    act2autochess_m04: ['(12,10) (12,4) (9,4) (9,2)', '(9,10) (9,6) (11,6) (11,4) (9,4) (9,2)'],
  };
  for (const [id, [up, low]] of Object.entries(lanes)) {
    const g = stageGrid(id);
    assert.equal(wp(g, 12, 10), up, `${id} upper gate`);
    assert.equal(wp(g, 9, 10), low, `${id} lower gate`);
  }
});

/** Tiles an enemy of `route` visits (rounded position per tick) on a real stage. */
function walk(stageId, route) {
  const h = makeBattle({ stageId, defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', route }], content: 'none', autoFinish: false, timeLimit: 120 });
  const seen = [];
  h.b.on('tick', () => {
    for (const e of h.b.enemies) {
      const k = `${Math.round(e.y)},${Math.round(e.x)}`;
      if (seen[seen.length - 1] !== k) seen.push(k);
    }
  });
  h.runUntil(() => h.b.enemies.length === 0 && h.b.time > 1, 120);
  return { seen, leaked: h.result().perPlayer.p1.leaked.length };
}

test('act1 m02 (下半, no crates): an upper-gate enemy keeps the top road to col 3 instead of dropping into the lower lane', REAL, () => {
  const { seen, leaked } = walk('act1autochess_m02', { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] });
  assert.equal(leaked, 1);
  const i3 = seen.indexOf('12,3');
  assert.ok(i3 > 0, `reaches (12,3): ${seen.join(' ')}`);
  for (const t of seen.slice(0, i3)) assert.equal(t.split(',')[0], '12', `stays on row 12 before col 3: ${seen.join(' ')}`);
  assert.ok(!seen.includes('9,6') && !seen.includes('10,6'), 'never takes col 6 down to the lower lane');
  // the battle spawned no crate on m02 at match start
  const h = makeBattle({ stageId: 'act1autochess_m02', content: 'none', timeLimit: 1 });
  h.step();
  assert.equal(h.b.allyUnits.filter((u) => u.kind === 'device').length, 0);
});

test('act1 m04: an upper-gate enemy stays on row 11 down to col 4 (does not join the lower-gate lane at once)', REAL, () => {
  const { seen } = walk('act1autochess_m04', { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] });
  const i4 = seen.indexOf('11,4');
  assert.ok(i4 > 0, seen.join(' '));
  for (const t of seen.slice(seen.indexOf('11,9'), i4 + 1)) assert.equal(t.split(',')[0], '11', `row 11: ${seen.join(' ')}`);
  const low = walk('act1autochess_m04', { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }).seen;
  assert.ok(low.includes('10,7') && low.includes('10,4') && !low.includes('11,6'), `lower gate on row 10: ${low.join(' ')}`);
});

test('crates in battle: detour when one exists; otherwise the enemy walks into the crate, is blocked and breaks it', () => {
  // detour available: never enters the crate tile
  const h = makeBattle({ flat: { crates: [[9, 6]] }, defs: { enemies: { enemy_walker: walker({ atk: 100 }) } }, enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false });
  let touched = false;
  h.b.on('tick', () => { for (const u of h.b.enemies) if (Math.round(u.y) === 9 && Math.round(u.x) === 6) touched = true; });
  h.runUntil(() => h.b.enemies.length === 0 && h.b.time > 1, 40);
  assert.equal(touched, false);
  assert.equal(h.result().perPlayer.p1.leaked.length, 1);
  // only way: through the crate
  const rows = { 10: '##hrrr#rrrfrrrrrrrf##', 11: '##hrrr#rrrfrrrrrrrf##', 12: '##hrrr#rrrSrrrrrrrS##' };
  const h2 = makeBattle({ flat: { rows, crates: [[9, 6]] }, defs: { enemies: { enemy_walker: walker({ atk: 500, bat: 1 }) } }, enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false });
  h2.step();
  const crate = h2.b.allyUnits.find((u) => u.kind === 'device');
  assert.ok(crate && h2.b.grid.isCrate(9, 6));
  const e = h2.enemy('enemy_walker');
  assert.ok(h2.runUntil(() => e.blockedBy === crate, 20), 'blocked by the crate');
  assert.ok(h2.runUntil(() => !crate.alive, 10), 'breaks it');
  assert.equal(h2.b.grid.isObstacle(9, 6), false);
  h2.runUntil(() => !e.alive, 30);
  assert.equal(h2.result().perPlayer.p1.leaked.length, 1);
});

test('remaining distance follows the smoothed flow-field route (targeting "closest to the goal")', REAL, () => {
  const route = { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] };
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', route }], content: 'none', autoFinish: false });
  h.run(2);
  const e = h.enemy('enemy_walker');
  approx(remainingDistance(h.b, e), Math.hypot(e.y - 9, e.x - 2), 'open field: one straight segment');
  // act1 m02: along the top road — (12,3) then down col 3
  const h2 = makeBattle({ stageId: 'act1autochess_m02', defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', route }], content: 'none', autoFinish: false });
  h2.run(2);
  const e2 = h2.enemy('enemy_walker');
  approx(remainingDistance(h2.b, e2), Math.hypot(e2.y - 12, e2.x - 3) + 3 + 1, 'to (12,3), down to (9,3), then (9,2)');
});

function approx(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`); }

test('a pushed ground enemy re-plans from its tile centre: never cuts a fence corner or breaks the stage crate on it (act1 m03, tile 11,5)', REAL, () => {
  // Regression: after Battle.displace() the enemy steered straight from its off-centre position to next[tile], cut
  // the corner of the FLY-only fence tile (11,5), got blocked by the decorative crate standing there and broke it.
  const cases = [[12.57, { x: -1, y: 0.2 }], [11, { x: -1, y: -1 }], [13, { x: -1, y: 1 }]];
  for (const [at, dir] of cases) {
    const h = makeBattle({
      stageId: 'act1autochess_m03', routes: [{ motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] }],
      enemies: [{ key: 'enemy_1267_nhpbr', route: 0 }], units: [], timeLimit: 120,
    });
    const b = h.b;
    h.run(at);
    const e = b.enemies[0];
    const crate = b.units.find((u) => u.defId === 'trap_1105_accrate' && u.tileR === 11 && u.tileC === 5);
    assert.ok(e && crate && crate.alive, 'enemy walking, crate on (11,5)');
    assert.ok(b.displace(e, dir, 0.5, { force: 3 }) > 0, 'pushed');
    const ver = b.grid.version;
    const off = [];
    while (e.alive && !b.finished) {
      b.step();
      const r = Math.round(e.y), c = Math.round(e.x);
      if (e.alive && !b.grid.walkable(r, c, true)) off.push(`${b.time.toFixed(2)}@${r},${c}`);
      assert.notEqual(e.blockedBy, crate, `t=${at}: blocked by the fence crate`);
    }
    assert.deepEqual(off, [], `t=${at} push ${JSON.stringify(dir)}: stood on a tile it cannot walk`);
    assert.ok(crate.alive, 'the stage crate survives');
    assert.equal(b.grid.version, ver, 'no obstacle change');
    assert.equal(h.result().perPlayer.p1.leaked.length, 1, 'still reaches the goal');
  }
});
