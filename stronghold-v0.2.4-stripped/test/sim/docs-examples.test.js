// The worked examples of docs/SIM.md, executed (keeps the documentation honest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { releaseSkillSummon } from '../../server/sim/content/tokens.js';

const approx = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });

test('SIM.md §10: 隐现 S2 fires 14 shots then ends', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    hooks: ['ammoUsed', 'skillEnd'],
  });
  const u = h.unit('chess_char_1_01_a');
  assert.ok(h.runUntil(() => u.skill.activations === 1, 60));
  h.runUntil(() => !u.skill.active, 60);
  assert.equal(h.hooksOf('ammoUsed').length, 14);
  checkInvariants(h.b);
});

test('SIM.md example 1: ammo sniper kit with talent (+2 ammo after 20 s)', () => {
  const kit = (bb, chess, def) => ({
    skill: { kind: 'ammo', ammo: bb['attack@trigger_time'], mods: { atkPct: bb.atk, batPct: bb.base_attack_time, taunt: -1 }, targeting: { priority: 'ranged' } },
    talents: [{ install(battle, unit) {
      const t = def.talents[0].bb;
      battle.on('skillStart', ({ unit: u, skill }) => { if (u === unit && battle.time - unit.deployedAt >= t.duration) skill.ammoLeft += t.self_ammo; }, { owner: unit });
    } }],
  });
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } }, kits: { chess_char_1_01_a: kit },
    units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }], hooks: ['ammoUsed'],
  });
  const u = h.unit('chess_char_1_01_a');
  h.run(25);
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => u.skill.activations === 1, 10);
  h.runUntil(() => !u.skill.active, 60);
  assert.equal(h.hooksOf('ammoUsed').length, 14 + 2);
  assert.equal(u.s.taunt, 0, 'taunt −1 removed after the skill');
});

test('SIM.md example 2: 幽灵鲨 undying during the skill, self-stun afterwards', () => {
  const kit = (bb) => ({
    skill: {
      kind: 'duration', mods: { atkPct: bb.atk },
      onStart({ battle, unit }) { unit.mem.undying = battle.on('fatal', (c) => { if (c.unit === unit) c.prevented = true; }, { owner: unit }); },
      onEnd({ battle, unit, reason }) { battle.off(unit.mem.undying); if (reason !== 'death') battle.applyStatus(unit, 'stun', { duration: bb.stun, source: unit }); },
    },
  });
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } }, kits: { chess_char_2_07_a: kit },
    units: [{ chessId: 'chess_char_2_07_a', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }],
  });
  const u = h.unit('chess_char_2_07_a');
  h.runUntil(() => u.skill.active, 60);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, true);
  assert.ok(u.hp >= 1);
  h.runUntil(() => !u.skill.active, 20);
  h.step();
  assert.ok(u.s.flags.stun);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false, 'undying ended with the skill');
});

test('SIM.md example 5: 赫默 brings her placed medical drone onto its tile; it expires after 10 s', () => {
  const kit = (bb) => ({
    skill: {
      kind: 'instant', heal: true,
      onStart({ battle, unit }) { releaseSkillSummon(battle, unit, 'token_10000_silent_healrb', { cap: bb.cnt }); },
    },
  });
  const h = makeBattle({
    defs: { chess: { t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', skill: null, stats: { atk: 0, maxHp: 1e5 } }) } },
    kits: { chess_char_2_02_a: kit },
    units: [{ chessId: 'chess_char_2_02_a', row: 10, col: 4, uid: 1 }, { chessId: 't_guard', row: 10, col: 5, uid: 2 }, { kind: 'token', tokenId: 'token_10000_silent_healrb', ownerUid: 1, row: 11, col: 4, uid: 3 }],
  });
  const u = h.unit('chess_char_2_02_a');
  const drone = h.unit(3);
  h.step();
  assert.equal(drone.alive, true, 'the placed piece deploys once with the board (SKILL_SUMMON_START_DEPLOY)');
  h.run(10.1);
  assert.equal(drone.alive, false, 'its 10 s');
  h.unit('t_guard').hp = 1000;
  h.runUntil(() => u.skill.activations === 1, 60);
  h.step();
  assert.ok(drone.alive && drone.tileR === 11 && drone.tileC === 4);
  assert.equal(drone.profile.dmgType, 'heal');
  h.run(10.1);
  assert.equal(drone.alive, false);
});

test('SIM.md example 6: 古米 备用军粮 — an AUTO heal skill cast by an injured ally of its range (no enemy), the next attack is the heal', () => {
  const kit = (bb, chess, def) => ({
    skill: {
      kind: 'instant', heal: true,
      trigger: { rule: 'SKILL_RANGE', grid: def.skill.rangeGrid, allies: true },
      targeting: { rangeGrid: def.skill.rangeGrid },
      attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: bb.heal_scale },
    },
  });
  const h = makeBattle({
    defs: { chess: { t_ally: chessRec({ id: 't_ally', skill: null, stats: { maxHp: 10000, atk: 0 } }) } },
    kits: { chess_char_1_10_a: kit },
    units: [{ chessId: 'chess_char_1_10_a', row: 9, col: 5 }, { chessId: 't_ally', row: 10, col: 5 }],
    autoFinish: false, // no enemy at all
  });
  const g = h.unit('chess_char_1_10_a');
  h.run(7);
  assert.equal(g.skill.rule, 'SKILL_RANGE');
  assert.equal(g.skill.activations, 0, 'ready, nobody injured');
  h.unit('t_ally').hp = 2000;
  h.run(2);
  assert.equal(g.skill.activations, 1);
  approx(h.unit('t_ally').hp, 2000 + g.s.atk * g.def.skill.bb.heal_scale, 'healed by her heal-mode attack');
  checkInvariants(h.b);
});
