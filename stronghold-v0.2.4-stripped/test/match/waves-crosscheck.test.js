// Adversarial cross-checks of waves.js against the official client algorithms (research 08 §2–§5):
//   * an independent re-implementation of RandomEnemyGenerater (_DoReplaceActionDataClient / BE count rule) and of
//     AutoChessEnemyPreviewManager's zone choice, run straight on the raw official files in .cache/gamedata, compared
//     with buildNormalWave / buildBossWave for every mode × round × template (leader and hidden rounds included) ×
//     allowed special entry — key, count, spawn time, unit step and preview zone of every action (skipped when the
//     cache is absent);
//   * preview zones of leader rounds (row offset 13: the leaders standing at (3,x)/(4,x) are in the LOWER zone);
//   * 联防 timing decoded from the client (`_CalculateActionPredelayConsiderUid`): owner k at preDelay + 0.5·k (no cap),
//     unit step min(max(W/M, 0.05·W), 5) with M = the largest owner group; host action = the first placeholder action of
//     the class, else action 0 (`_GetSpEnemyActionData`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData } from '../../server/match/gamedata.js';
import { buildNormalWave, buildBossWave, buildUniteWave, gateOf, previewOf, bountySpawns, withBounties } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'gamedata');
const HAS_CACHE = ['excel/activity_table.json', 'levels/enemydata/enemy_database.json', 'levels/activities/act1autochess/level_act1autochess_01.json']
  .every((rel) => existsSync(join(CACHE, rel)));
const raw = (rel) => JSON.parse(readFileSync(join(CACHE, rel), 'utf8'));
const TS = DATA.factions.templateSlots;

/** Forced pick of a special entry for round r. */
function pickOf(e, round) {
  return { round, type: e.type, key: e.key, normal: e.N[0].key, elite: e.E[0].key, fly: e.fly, firstHalf: e.firstHalf };
}

test('independent official generator on the raw client data: every mode × round × template × entry (keys, counts, times, steps, preview zones)', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const act = raw('excel/activity_table.json');
  const ac = act.autoChessData;
  const season = act.activity.AUTOCHESS_SEASON.act2autochess;
  const cd = ac.constData;
  const attr = ac.randomEnemyAttributeDict;
  const db = new Map(raw('levels/enemydata/enemy_database.json').enemies.map((e) => [e.Key, e.Value]));
  const f32 = Math.fround;
  const stat = (key, level) => {
    const lv = new Map(db.get(key).map((v) => [v.level, v.enemyData]));
    const base = lv.get(0).attributes;
    const ov = level ? (lv.get(level)?.attributes || {}) : {};
    const g = (n) => (ov[n] && ov[n].m_defined ? ov[n].m_value : base[n].m_value);
    return [g('maxHp'), g('atk'), g('def'), g('magicResistance')];
  };
  const power = (k) => {
    const [hp, atk, df, res] = stat(k, attr[k].level);
    const p = f32(f32(f32(atk * cd.enemyAtkFactor) + f32(hp * cd.enemyMaxHpFactor)) + f32(df * cd.enemyDefFactor));
    return f32(p + f32(cd.enemyMagicResistanceFactor * res));
  };
  const bankers = (x) => { const fl = Math.floor(x); return x - fl === 0.5 ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(x); };
  const newCount = (n, t, k) => {
    const origin = f32(f32(n * power(t)) / attr[t].enemyBattleEffectivenessFactor);
    const ratio = f32(origin / f32(power(k) / attr[k].enemyBattleEffectivenessFactor));
    return Math.max(cd.minReplacedEnemyCount, Math.min(cd.maxReplacedEnemyCount, bankers(ratio)));
  };
  const TPL = {
    [cd.templateEnemyNormal]: ['N', false], [cd.templateEnemyElite]: ['E', false], [cd.templateEnemySpecial]: ['S', false],
    [cd.templateEnemyNormalFly]: ['N', true], [cd.templateEnemyEliteFly]: ['E', true], [cd.templateEnemySpecialFly]: ['S', true],
  };
  // preview pen: enemy_place_rect anchors (15,7) / (18,7); eligible anchors have row ≤ target row; nearest wins
  const zone = (start, leader) => {
    const t = start.row + (leader ? 13 : 6);
    const c = [[15, 'lower'], [18, 'upper']].filter(([r]) => r <= t).sort((a, b) => (Math.abs(a[0] - t) + Math.abs(7 - start.col)) - (Math.abs(b[0] - t) + Math.abs(7 - start.col)));
    return c.length ? c[0][1] : 'lower';
  };
  const levels = new Map();
  const level = (levelId) => {
    const p = levelId.replace(/^Activities\//i, '').toLowerCase();
    if (!levels.has(p)) levels.set(p, raw(`levels/activities/${p}.json`));
    return levels.get(p);
  };
  const compose = (lv, e, leader) => {
    const out = [];
    lv.waves[0].fragments[0].actions.forEach((a, ai) => {
      if (a.actionType !== 'SPAWN') return;
      let k = a.key, n = a.count;
      const win = a.count * a.interval;
      if (TPL[k]) {
        const [cls, fly] = TPL[k];
        const nk = { N: e.attachedNormalEnemyKeys[0], E: e.attachedEliteEnemyKeys[0], S: e.specialEnemyKey }[cls];
        if (attr[nk].isFlyEnemy !== fly) return; // isValid = false
        n = newCount(a.count, k, nk);
        k = nk;
      }
      const step = n > 1 ? Math.max(win / n, 0.05 * win) : 0;
      out.push(`${ai}:${k}x${n}@${a.preDelay}/${step.toFixed(6)}:${zone(lv.routes[a.routeIndex].startPosition, leader)}`);
    });
    return out.join(' ');
  };
  let n = 0;
  let leaderChecks = 0;
  for (const [modeId, rounds] of Object.entries(season.battleDataDict)) {
    if (modeId === 'mode_training_1') continue;
    const gd = new GameData(DATA, modeId);
    const inactive = new Set(season.modeDataDict[modeId].inactiveEnemyKey || []);
    for (const [r, list] of Object.entries(rounds)) {
      const round = Number(r);
      const half = round <= Math.floor(cd.maxLevelCnt / 2);
      for (const entry of list) {
        const lv = level(entry.levelId);
        const templateId = entry.levelId.replace(/^.*level_/i, '').toLowerCase();
        for (const e of Object.values(season.specialEnemyInfoDict)) {
          if (e.isInFirstHalf !== half || inactive.has(e.specialEnemyKey)) continue;
          const picks = [];
          picks[round] = pickOf(DATA.factions.entries[e.specialEnemyKey], round);
          const w = entry.bossId
            ? buildBossWave(gd, createRng(1), { picks }, round, { bossId: entry.bossId, solo: /_s$/.test(templateId) })
            : buildNormalWave(gd, createRng(1), { picks }, round);
          assert.equal(w.templateId, templateId, `${modeId} R${r} ${entry.bossId ?? ''}`);
          const got = w.spawns.map((s) => `${s.actionIndex}:${s.enemyKey}x${s.count}@${s.time}/${(+s.interval).toFixed(6)}:${s.preview.gate}`).join(' ');
          assert.equal(got, compose(lv, e, !!entry.bossId), `${modeId} R${r} ${templateId} ${e.specialEnemyKey}`);
          n++;
          if (entry.bossId) leaderChecks++;
        }
      }
    }
  }
  assert.ok(n > 5000 && leaderChecks > 1000, `${n} compositions (${leaderChecks} leader rounds)`);
});

test('preview zones: target row = start row + 6 (leader rounds + 13), upper zone only from target row 18', () => {
  // normal fields: only the (12,10) gate reaches the upper zone (a row-11 start would target row 17: lower)
  for (const [row, want] of [[9, 'lower'], [10, 'lower'], [11, 'lower'], [12, 'upper']]) assert.equal(gateOf([row, 10]), want, `normal row ${row}`);
  // leader / hidden rounds: (5,10) upper; the (2,10) gate and the leaders at (3,x) / (4,x) lower
  for (const [row, want] of [[2, 'lower'], [3, 'lower'], [4, 'lower'], [5, 'upper']]) {
    assert.equal(gateOf([row, 10], true), want, `leader row ${row}`);
    assert.equal(gateOf([row, 10]), want, `leader row ${row} (inferred from the boss-field row)`);
  }
  assert.equal(gateOf(null), 'lower');
  // real leader templates: 猎手 (h08_02, hidden, route (4,10)) and the h07_02 leader (4,10) sit in the lower zone,
  // the (5,10) escorts in the upper one
  const gd = new GameData(DATA, 'mode_multi_hard');
  const picks = [];
  const e = DATA.factions.entries.enemy_1005_yokai_3;
  picks[14] = pickOf(e, 14);
  picks[15] = pickOf(e, 15);
  const hidden = buildBossWave(gd, createRng(1), { picks }, 15, { bossId: 'boss_9', solo: false });
  assert.equal(hidden.templateId, 'act1autochess_h08_02');
  const boss = hidden.spawns.find((s) => s.tag === 'boss');
  assert.deepEqual(DATA.waves.act1autochess_h08_02.routes[boss.routeIndex].start, [4, 10]);
  assert.equal(boss.preview.gate, 'lower');
  assert.ok(hidden.spawns.filter((s) => s.tag !== 'boss' && s.tag !== 'part').every((s) => s.preview.gate === 'upper'), 'escorts from (5,10): upper');
  const pv = previewOf(hidden.spawns);
  assert.equal(pv.find((x) => x.boss).gate, 'lower');
  // a bounty in a leader round follows the same leader offset
  const card = { enemyKey: 'enemy_1007_slime', count: 1, coin: 1, payout: 'kill' };
  const b = bountySpawns(gd, 15, hidden, [{ id: 'x', card }], 'p', { side: 'L' });
  const bRoute = hidden.routes[b[0].routeIndex];
  assert.equal(b[0].preview.gate, gateOf(bRoute.start, true));
});

const WALK = 'enemy_1422_lrsldr';
const leak = (owner, key = WALK, extra = {}) => ({ enemyKey: key, mods: null, sourcePlayerId: owner, ...extra });

test('联防 timing (decoded _CalculateActionPredelayConsiderUid): step = min(max(W/M, 0.05·W), 5 s), owner k at +0.5·k', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const tpl = DATA.waves.act1autochess_escaped_single;
  const host = tpl.spawns.find((s) => s.key === TS.N); // lrsldr 5 @ 3 s / 8 s ⇒ W = 40
  const W = host.count * host.interval;
  const times = (w, owner) => w.spawns.filter((s) => s.sourcePlayerId === owner).map((s) => s.time);
  // M = 2 ⇒ 40/2 = 20 s, capped at 5 s (the old code spread a lone owner's 2 leaks 20 s apart)
  let w = buildUniteWave(gd, [leak('a'), leak('b'), leak('a')], 1, 60);
  assert.deepEqual(times(w, 'a'), [host.time, host.time + 5]);
  assert.deepEqual(times(w, 'b'), [host.time + 0.5]);
  // the step uses the LARGEST owner group for every owner of the action: a 12, b 2 ⇒ 40/12 for both
  const many = [];
  for (let i = 0; i < 12; i++) many.push(leak('a'));
  many.push(leak('b'), leak('b'));
  w = buildUniteWave(gd, many, 1, 60);
  const step = Math.min(Math.max(W / 12, 0.05 * W), 5);
  assert.ok(times(w, 'a').every((t, i) => Math.abs(t - (host.time + i * step)) < 1e-9));
  assert.ok(times(w, 'b').every((t, i) => Math.abs(t - (host.time + 0.5 + i * step)) < 1e-9), 'b steps by 40/12, not 40/2 capped');
  // 25 leaks of one owner: the 0.05·W floor (2 s)
  w = buildUniteWave(gd, Array.from({ length: 25 }, () => leak('a')), 1, 60);
  assert.equal(times(w, 'a')[24], host.time + 24 * 2);
  // owner offsets are not capped: the 12th owner starts 5.5 s after the action
  w = buildUniteWave(gd, Array.from({ length: 12 }, (_, i) => leak(`o${i}`)), 1, 60);
  assert.equal(times(w, 'o11')[0], host.time + 5.5);
  assert.ok(w.spawns.every((s) => s.actionIndex === tpl.spawns.indexOf(host) && s.routeIndex === host.routeIndex));
  // flyers and walkers are separate actions (each with its own M and owner order)
  w = buildUniteWave(gd, [leak('a', 'enemy_1005_yokai'), leak('b'), leak('b')], 1, 60);
  const fh = tpl.spawns.find((s) => s.key === TS.NF);
  assert.deepEqual(times(w, 'a'), [fh.time], 'owner a is the first owner of the flyer action');
  assert.deepEqual(times(w, 'b'), [host.time, host.time + 5], 'owner b is the first owner of the walker action');
});

test('联防 host action: the first action of the class placeholder, else action 0 (client _GetSpEnemyActionData)', () => {
  const tpl = DATA.waves.act1autochess_escaped_single;
  const noWalk = { ...tpl, spawns: tpl.spawns.filter((s) => s.key !== TS.N) };
  const data = { ...DATA, waves: { ...DATA.waves, act1autochess_escaped_single: noWalk } };
  const gd = new GameData(data, 'mode_multi_normal');
  const w = buildUniteWave(gd, [leak('a'), leak('a')], 1, 60);
  const a0 = noWalk.spawns[0];
  assert.ok(w.spawns.every((s) => s.actionIndex === 0 && s.routeIndex === a0.routeIndex));
  const W = a0.count * a0.interval;
  assert.deepEqual(w.spawns.map((s) => s.time), [a0.time, a0.time + Math.min(Math.max(W / 2, 0.05 * W), 5)]);
});

test('bounty units are inserted among the host action\'s own units (decoded _InsertSpActionToNormal), then spread', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const picks = [];
  picks[1] = pickOf(DATA.factions.entries.enemy_1325_cbgpro_2, 1); // R1: N 2 @ 12 s / 3 s → 猎狗pro ×4, W = 6
  const w = buildNormalWave(gd, createRng(1), { picks }, 1);
  const hostIdx = DATA.waves.act1autochess_01.spawns.findIndex((s) => s.key === TS.N);
  assert.equal(w.spawns.find((s) => s.actionIndex === hostIdx).count, 4);
  const card = (count = 1) => ({ enemyKey: 'enemy_1007_slime', count, coin: 1, payout: 'kill' });
  const units = (list) => {
    const out = [];
    for (const s of list) for (let i = 0; i < s.count; i++) out.push(`${s.tag === 'bounty' ? s.mods.bountyId : 'own'}@${(s.time + i * s.interval).toFixed(3)}`);
    return out.sort((a, b) => Number(a.split('@')[1]) - Number(b.split('@')[1]));
  };
  const hostOf = (list) => list.filter((s) => s.actionIndex === hostIdx);
  // 1 bounty: [o o B o o], step 6/5
  assert.deepEqual(units(hostOf(withBounties(gd, 1, w, [{ id: 'B', card: card() }], 'p'))),
    ['own@12.000', 'own@13.200', 'B@14.400', 'own@15.600', 'own@16.800']);
  assert.equal(bountySpawns(gd, 1, w, [{ id: 'B', card: card() }], 'p')[0].time, 12 + 2 * 1.2);
  // 2 bounties: i=0 at floor(1·4/3) = 1, i=1 at floor(2·5/3) = 3 → [o B0 o B1 o o], step 1
  assert.deepEqual(units(hostOf(withBounties(gd, 1, w, [{ id: 'B0', card: card() }, { id: 'B1', card: card() }], 'p'))),
    ['own@12.000', 'B0@13.000', 'own@14.000', 'B1@15.000', 'own@16.000', 'own@17.000']);
  // a 3-unit card is inserted unit by unit: [o C C o C o o] — two specs for the card (runs)
  const three = withBounties(gd, 1, w, [{ id: 'C', card: card(3) }], 'p');
  const step = 6 / 7;
  assert.deepEqual(units(hostOf(three)), [0, 1, 2, 3, 4, 5, 6].map((j) => `${[1, 2, 4].includes(j) ? 'C' : 'own'}@${(12 + j * step).toFixed(3)}`));
  assert.equal(three.filter((s) => s.tag === 'bounty').length, 2);
  // FLY round: the walker host action spawns nothing → the bounty list alone over the window (one unit at preDelay)
  const fp = [];
  fp[1] = pickOf(DATA.factions.entries.enemy_1355_mrfly, 1);
  const fw = buildNormalWave(gd, createRng(1), { picks: fp }, 1);
  assert.ok(!fw.spawns.some((s) => s.actionIndex === hostIdx));
  const fb = withBounties(gd, 1, fw, [{ id: 'B0', card: card() }, { id: 'B1', card: card() }], 'p').filter((s) => s.tag === 'bounty');
  const hostRoute = DATA.waves.act1autochess_01.spawns[hostIdx].routeIndex;
  assert.deepEqual(fb.map((s) => [s.time, s.count, s.routeIndex]), [[12, 1, hostRoute], [15, 1, hostRoute]], 'step 6/2 on the walker route');
});

test('a bounty whose host action is not server-sent (the leader) spawns alone over that window; the leader is never re-timed', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const picks = [];
  picks[15] = pickOf(DATA.factions.entries.enemy_1006_shield_3, 15);
  const w = buildBossWave(gd, createRng(1), { picks }, 15, { bossId: 'boss_9', solo: false });
  const tpl = DATA.waves[w.templateId];
  assert.equal(tpl.spawns[0].tag, 'boss', 'h08_02: action 0 is the leader (no lrsldr action ⇒ the host is action 0)');
  assert.equal(w.actions.find((a) => a.index === 0).server, false);
  const card = { enemyKey: 'enemy_1007_slime', count: 1, coin: 1, payout: 'kill' };
  const all = withBounties(gd, 15, w, [{ id: 'B', card }], 'p', { side: 'L' });
  const boss = w.spawns.find((s) => s.tag === 'boss');
  assert.deepEqual(all.filter((s) => s.tag === 'boss').map((s) => [s.time, s.count]), [[boss.time, 1]], 'the leader keeps its own timing');
  const b = all.find((s) => s.tag === 'bounty');
  assert.equal(b.time, tpl.spawns[0].time, 'the bounty list alone: first unit at the action preDelay');
  assert.equal(all.length, w.spawns.length + 1);
});

test('round multipliers hit every enemy but 炎佑 (aceffect_enemy_* enemy_exclude): leader ATK / speed, never its HP', () => {
  const eff = DATA.effects;
  // the data behind the PRTS table: 攻坚装备 ATK ×1.1 / HP ×1.2, III ATK ×0.7 / HP ×0.75, only 炎佑 excluded
  // (补给线 also spares the TIMES tokens 瑞印 / 卷轴 / 镜 …, whose HP is a hit count — content's concern)
  const leaders = Object.values(DATA.bosses).map((x) => x.enemyKey).filter(Boolean);
  assert.ok(leaders.length >= 8);
  for (const id of ['aceffect_enemy_1', 'aceffect_enemy_2', 'aceffect_enemy_3', 'aceffect_enemy_4', 'aceffect_enemy_5']) {
    assert.equal(eff[id].effectType, 'ENEMY', id);
    const ex = String(eff[id].params.enemy_exclude).split('|');
    assert.ok(ex.includes('enemy_9012_acloon'), `${id}: 炎佑 excluded`);
    assert.ok(!leaders.some((k) => ex.includes(k)), `${id}: no leader excluded`);
  }
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const scale = gd.enemyScale(15);
  assert.ok(scale.atkMul > 2 && scale.speedMul > 1, 'sanity: 终极 hidden round multipliers');
  const picks = [];
  picks[15] = pickOf(DATA.factions.entries.enemy_1006_shield_3, 15);
  const w = buildBossWave(gd, createRng(1), { picks }, 15, { bossId: 'boss_9', solo: false });
  const boss = w.spawns.find((s) => s.tag === 'boss');
  assert.equal(boss.mods.hpMul, undefined, 'the leader HP is the server pool');
  assert.equal(boss.mods.atkMul, scale.atkMul);
  assert.equal(boss.mods.speedMul, scale.speedMul);
  const parts = w.spawns.filter((s) => s.tag === 'part');
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.deepEqual([p.mods.hpMul, p.mods.atkMul, p.mods.speedMul], [scale.hpMul, scale.atkMul, scale.speedMul], p.enemyKey);
  // solo 标准: the 攻坚装备III base (ATK ×0.7) weakens the leader too
  const sgd = new GameData(DATA, 'mode_single_funny');
  const sp = [];
  sp[9] = pickOf(DATA.factions.entries.enemy_1006_shield_3, 9);
  const sw = buildBossWave(sgd, createRng(1), { picks: sp }, 9, { bossId: 'boss_1', solo: true });
  assert.equal(sw.spawns.find((s) => s.tag === 'boss').mods.atkMul, sgd.enemyScale(9).atkMul);
  assert.ok(sgd.enemyScale(9).atkMul < 1);
});
