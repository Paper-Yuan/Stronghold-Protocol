// test/content/feedback5-prisoners.test.js — community report of 2026-10-06 「囚徒类敌人出门就是已解放的模型」: the 孤岛风云
// prisoners (普通 / 老练 / 拳师 / 强壮囚犯, 重犯, 传奇重犯) follow their official battle prefabs' three modes
// (content/enemies/archetypes.js prisoner): confined, mode R — the warning — before the last confined attack (its
// collar light blinks orange: model form 'warning'), mode L — 【解放】 — before the confinement.times-th attack, which
// already hits freed (PRTS "进行第4次攻击前，切换至解放状态"; buff_template_data enemy_confinement[atk_cnt] /
// enemy_liberty_listener[warning]); model form 'liberty' (render/units.js FORMS; test/render/feedback5-prisoners.test.js).
// Until 0.2.0 the sim freed them after the 4th attack's damage and never told the client: they kept the manifest's
// clips, which for 普通囚犯 / 老练囚犯 were the freed set.
// Run: node --test test/content/feedback5-prisoners.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { unitInfo } from '../../server/sim/snapshot.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const PRISONERS = ['enemy_1116_liprr', 'enemy_1116_liprr_2', 'enemy_1118_lidbox_2', 'enemy_1119_vofsd', 'enemy_1121_lifbos', 'enemy_1121_lifbos_2'];
const tb = (key, k) => E[key].talents.bb[k];
// a wall that blocks and never attacks, DEF 0: a prisoner's hit lands its ATK exactly
const WALL = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });

function arena() {
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { t_wall: WALL } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
    units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['damaged', 'beforeAttack'], captureNoisy: true,
  });
}
const put = (h, key, pos) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0 } });
const fxOf = (h, id) => h.eventsOf('fx').filter((f) => f[4] && f[4].id === id);

for (const key of PRISONERS) {
  test(`${key} ${E[key].name}: the warning before attack ${tb(key, 'confinement.times') - 1}, freed before attack ${tb(key, 'confinement.times')} (its hit already freed), model forms 'warning' → 'liberty'`, () => {
    const h = arena();
    h.step();
    const e = put(h, key, [9, 5]);
    const times = tb(key, 'confinement.times');
    const base = E[key].stats.atk;
    const hits = () => h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).map((c) => c.amount);
    assert.equal(e.form ?? null, null, 'spawns confined, on the manifest clips');
    assert.equal(unitInfo(e).form, undefined);
    // the form each attack starts in: read at its beforeAttack (after the kit's own handler, priority 50)
    const formAt = [];
    h.b.on('beforeAttack', (c) => { if (c.attacker === e) formAt.push(e.form ?? null); }, { priority: -100 });
    const aspdAt = [];
    h.b.on('attack', (c) => { if (c.attacker === e) aspdAt.push(e.s.aspd); }, { priority: -100 });
    assert.ok(h.runUntil(() => e.stats.attacks >= times + 1, 120), 'attacks');
    assert.deepEqual(formAt.slice(0, times + 1), [...Array(times - 2).fill(null), 'warning', 'liberty', 'liberty']);
    const dealt = hits();
    for (let i = 0; i < times - 1; i++) assert.equal(dealt[i], base, `confined hit ${i + 1}`);
    assert.ok(Math.abs(dealt[times - 1] - base * (1 + tb(key, 'liberty.atk'))) < 1e-6, `attack ${times} hits freed: ${dealt[times - 1]}`);
    // mode R is still confined: the interval after the warning attack is the confined one
    assert.equal(aspdAt[times - 2], 100 + tb(key, 'confinement.attack_speed'), 'the warning attack still confined');
    assert.equal(aspdAt[times - 1], 100, 'freed from attack ' + times);
    const forms = fxOf(h, e.id).filter((f) => f[4] && Object.hasOwn(f[4], 'form')).map((f) => [f[1], f[4].form]);
    assert.deepEqual(forms, [['phase', 'warning'], ['liberate', 'liberty']], 'the two mode changes reach the client');
    assert.equal(unitInfo(e).form, 'liberty', 'a view built later draws it freed');
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  });
}

test('重犯 / 传奇重犯: the first liberation frees every prisoner on the field, each switched to its liberty form', () => {
  for (const key of ['enemy_1121_lifbos', 'enemy_1121_lifbos_2']) {
    const h = arena();
    h.step();
    const e = put(h, key, [9, 5]);
    const other = put(h, 'enemy_1116_liprr', [11, 8]);
    assert.ok(h.runUntil(() => e.form === 'liberty', 120));
    assert.equal(other.form, 'liberty', `${key}: the other prisoner is drawn freed`);
    assert.ok(!other.findBuff('ab:confined'));
    assert.ok(fxOf(h, other.id).some((f) => f[1] === 'liberate' && f[4].form === 'liberty'));
  }
});

test('拳师囚犯 (PRTS 天赋 "在持有麻痹的情况下，攻击不计数"): an attack 麻痹 interrupts spends no charge', () => {
  const key = 'enemy_1118_lidbox_2';
  const h = arena();
  h.step();
  const e = put(h, key, [9, 5]);
  h.b.applyStatus(e, 'palsy', { duration: 60, stacks: 2, source: h.unit('t_wall') });
  const palsied = e.findBuff('palsy');
  assert.ok(palsied, 'palsy on');
  const st = e.mem.ab.list.find((a) => a.liberate);
  assert.ok(h.runUntil(() => !e.findBuff('palsy'), 60), 'the stacks were spent on interrupted attacks');
  assert.equal(st.n, 0, 'no charge spent');
  assert.equal(e.stats.attacks, 0);
});
