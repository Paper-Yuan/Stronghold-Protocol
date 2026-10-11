#!/usr/bin/env node
// tools/simrun.mjs — run one battle headlessly and print a balancing summary (+ optional ASCII frames).
//
// Usage:
//   node tools/simrun.mjs scenario.json [--ascii 5] [--json]
//   node tools/simrun.mjs --mode mode_multi_normal --round 5 [--stage act2autochess_m01] [--boss boss_1]
//        --lineup "chess_char_1_02_a@9,7 隐现@10,4 角峰*@9,5" [--seed 1] [--content full|generic|none]
//        [--hpMul 1 --atkMul 1 --speedMul 1] [--wave act1autochess_05] [--time 60] [--ascii 5] [--json] [--events]
//
// Lineup entries: `<chessId|name>[*]@row,col` in board coordinates (rows 9–12, cols 2–10); `*` = elite (精锐 _b).
// --mode/--round pick the wave template, time limit and enemy multipliers from data/config.json (placeholder
// template enemies are NOT replaced by factions — that is the match's job; pass --wave to force a template).
// Scenario JSON: { stageId, kind, seed, wave|waveTemplate, round, modeId, timeLimit, mods, content, units:[…]|players:[…],
//                  enemies:[{ key, time, route, count, interval, mods, pos }], sharedBossHp }
// Output: reason, time, kills/total, leaks, per-unit damage / DPS / kills / heals / skill casts / deaths.

import fs from 'node:fs';
import { Battle } from '../server/sim/Battle.js';
import { getDefaultSource, spawnsFromTemplate } from '../server/sim/simdata.js';
import { getData } from '../server/data.js';
import { COLS } from '../server/sim/constants.js';

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opt[k] = v;
  } else pos.push(a);
}
if (opt.help || (!pos.length && !opt.mode && !opt.wave && !opt.lineup)) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

const ds = getDefaultSource();
const data = getData({ log: { warn() {}, error() {}, info() {} } });
const config = data.config ?? {};

function findChess(q) {
  let golden = false;
  if (q.endsWith('*')) { golden = true; q = q.slice(0, -1); }
  let id = null;
  if (ds.rawChess(q)) id = q;
  else {
    for (const cid of ds.chessIds()) {
      const r = ds.rawChess(cid);
      if (r && r.name === q && !r.isGolden && r.visible !== false && !r.isHidden) { id = cid; break; }
    }
    if (!id) for (const cid of ds.chessIds()) { const r = ds.rawChess(cid); if (r && r.name === q && !r.isGolden) { id = cid; break; } }
  }
  if (!id) throw new Error(`unknown chess ${q}`);
  if (golden) id = id.replace(/_a$/, '_b');
  return id;
}

function parseLineup(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).map((tok, i) => {
    const m = tok.match(/^(.+)@(\d+),(\d+)$/);
    if (!m) throw new Error(`bad lineup entry ${tok} (want id@row,col)`);
    return { uid: i + 1, kind: 'chess', chessId: findChess(m[1]), row: +m[2], col: +m[3] };
  });
}

// ---- build scenario
let sc = {};
if (pos[0]) sc = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const modeId = opt.mode ?? sc.modeId ?? 'mode_multi_normal';
const round = Number(opt.round ?? sc.round ?? 1);
const mode = config.modes?.[modeId];
const roundCfg = mode?.rounds?.[String(round)];
let kind = opt.kind ?? sc.kind ?? (roundCfg?.isBoss ? 'boss' : roundCfg?.isHidden ? 'hidden' : 'normal');
let waveId = opt.wave ?? sc.wave ?? sc.waveTemplate ?? roundCfg?.template ?? null;
if (!waveId && roundCfg?.bossTemplates) {
  const bossId = opt.boss ?? Object.keys(roundCfg.bossTemplates)[0];
  waveId = roundCfg.bossTemplates[bossId];
  if (/_s$/.test(waveId) === false && modeId.includes('single')) waveId = waveId + '_s';
}
const stageId = opt.stage ?? sc.stageId ?? mode?.stages?.[0] ?? 'act2autochess_m01';
const scale = mode?.enemyScale?.[String(round)] ?? null;
const mods = sc.mods ?? {
  hpMul: Number(opt.hpMul ?? scale?.hp ?? 1), atkMul: Number(opt.atkMul ?? scale?.atk ?? 1), speedMul: Number(opt.speedMul ?? scale?.speed ?? 1),
};
let routes = [], spawns = [], timeLimit = null, overrides = null;
if (waveId) {
  const tpl = ds.getWave(waveId);
  if (!tpl) throw new Error(`unknown wave ${waveId}`);
  const conv = spawnsFromTemplate(tpl, { mods });
  routes = conv.routes; spawns = conv.spawns; timeLimit = conv.maxPlayTime; overrides = conv.overrides;
  if (tpl.kind === 'boss' || tpl.kind === 'hidden') kind = tpl.kind;
}
for (const e of sc.enemies ?? []) {
  spawns.push({ time: e.time ?? 0, enemyKey: e.key, routeIndex: typeof e.route === 'number' ? e.route : 0, route: typeof e.route === 'object' ? e.route : null, count: e.count ?? 1, interval: e.interval ?? 0, mods: e.mods ?? mods, pos: e.pos ?? null, tag: e.tag ?? null });
}
if (sc.routes) routes = sc.routes;
if (opt.time) timeLimit = Number(opt.time);
else if (sc.timeLimit != null) timeLimit = sc.timeLimit;
if (kind === 'boss' || kind === 'hidden') timeLimit = opt.time ? Number(opt.time) : (sc.timeLimit ?? 300);
const players = sc.players ?? [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: sc.units ?? parseLineup(opt.lineup ?? '') }];
const bossHp = Number(opt.bossHp ?? sc.sharedBossHp ?? 0);
const sharedBoss = bossHp > 0 ? { hp: bossHp, maxHp: bossHp, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } } : null;
const seed = Number(opt.seed ?? sc.seed ?? 1);

const b = new Battle({
  seed, kind, modeId, round, stageId, timeLimit: timeLimit ?? 60, routes, spawns, players, sharedBoss, enemyOverrides: overrides ?? {},
  content: opt.content ?? sc.content ?? 'full', recordEvents: !!opt.events, verbose: !!opt.verbose, fieldId: 'sim',
});

// ---- ASCII frames
const asciiEvery = opt.ascii ? Number(opt.ascii === true ? 5 : opt.ascii) : 0;
const legend = new Map();
function frame() {
  const R = b.rect;
  const lines = [];
  const occ = new Map();
  for (const u of b.units) {
    if (!u.alive || !u.deployed || u.hidden) continue;
    const k = Math.round(u.y) * COLS + Math.round(u.x);
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k).push(u);
  }
  for (let r = R.r1; r >= R.r0; r--) {
    let line = String(r).padStart(2) + ' ';
    for (let c = R.c0; c <= R.c1; c++) {
      const us = occ.get(r * COLS + c) || [];
      const ally = us.find((u) => u.side === 'ally');
      const ens = us.filter((u) => u.side === 'enemy');
      if (ally && ally.kind === 'device') line += ens.length ? '!' : '■';
      else if (ally) {
        if (!legend.has(ally.id)) legend.set(ally.id, String.fromCharCode(65 + legend.size % 26));
        line += ens.length ? legend.get(ally.id).toLowerCase() : legend.get(ally.id);
      } else if (ens.length) line += ens.length > 9 ? '+' : ens.some((e) => e.isFlying) ? '^' : String(ens.length);
      else {
        const t = b.grid.tile(r, c);
        line += t.special === 'end' ? 'E' : t.special === 'start' ? 'S' : t.pass === 'ALL' ? '.' : t.height === 'HIGH' ? '#' : ',';
      }
    }
    lines.push(line);
  }
  const alive = b.enemies.filter((e) => e.alive);
  console.log(`--- t=${b.time.toFixed(1)}s  enemies alive ${alive.length}  killed ${b.killed}/${b.total}  dp ${Math.floor(b.players[0]?.dp ?? 0)}`);
  console.log(lines.join('\n'));
  const ops = b.allyUnits.filter((u) => u.kind !== 'device' && legend.has(u.id));
  console.log(ops.map((u) => `${legend.get(u.id)}=${u.name}${u.def.golden ? '*' : ''} ${u.alive ? Math.round(u.hpRatio * 100) + '%' : 'dead'}${u.skill?.active ? ' [S]' : ''}`).join('  '));
}

const t0 = performance.now();
let n = 0;
let nextFrame = 0;
while (!b.finished) {
  if (asciiEvery && b.time + 1e-9 >= nextFrame) { frame(); nextFrame += asciiEvery; }
  b.step();
  n++;
  if (opt.events && n % 3 === 0) for (const ev of b.drainEvents()) if (ev[0] !== 'dmg' && ev[0] !== 'atk' && ev[0] !== 'heal') console.log(b.time.toFixed(2), JSON.stringify(ev));
  if ((kind === 'boss' || kind === 'hidden') && b.time >= timeLimit) b.forceEnd('forced');
}
const ms = performance.now() - t0;
if (asciiEvery) frame();
const r = b.result();

if (opt.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
console.log(`\n== ${kind} battle · stage ${stageId} · wave ${waveId ?? '(custom)'} · ${modeId} R${round} · seed ${seed}`);
console.log(`   enemy mods: hp×${mods.hpMul ?? 1} atk×${mods.atkMul ?? 1} speed×${mods.speedMul ?? 1}`);
console.log(`   result: ${r.reason} at ${r.time.toFixed(1)} s · killed ${r.killed}/${r.total} · ${n} ticks in ${ms.toFixed(1)} ms (${(ms / n * 1000).toFixed(1)} µs/tick)${b.errorCount ? ' · ERRORS ' + b.errorCount : ''}`);
if (r.bossHpLeft != null) console.log(`   boss pool left: ${Math.round(r.bossHpLeft)}`);
for (const [pid, pp] of Object.entries(r.perPlayer)) {
  const leaks = {};
  for (const l of pp.leaked) leaks[l.enemyKey] = (leaks[l.enemyKey] ?? 0) + 1;
  console.log(`\n   player ${pid}: killed ${pp.killed}/${pp.total} · leaked ${pp.leaked.length}${pp.leaked.length ? ' ' + JSON.stringify(leaks) : ''} · perfect ${pp.perfect} · deaths ${pp.deaths} · coins ${pp.coins}`);
  console.log(`   damage ${Math.round(pp.damageDealt)} · healing ${Math.round(pp.healingDone)} · boss ${Math.round(pp.bossDamage)}${Object.keys(pp.layerGains).length ? ' · layers ' + JSON.stringify(pp.layerGains) : ''}`);
  const rows = pp.unitStats.filter((u) => u.kind === 'op' || u.dmg > 0 || u.heal > 0);
  console.log('   ' + ['unit'.padEnd(18), 'dmg'.padStart(8), 'dps'.padStart(7), 'kills'.padStart(6), 'heal'.padStart(7), 'taken'.padStart(7), 'atks'.padStart(5), 'casts'.padStart(6)].join(' '));
  for (const u of rows) {
    const unit = b.unitById(u.id);
    const casts = unit?.skill?.activations ?? 0;
    console.log('   ' + [(u.name + (unit?.def?.golden ? '*' : '')).slice(0, 16).padEnd(18), String(u.dmg).padStart(8), (u.dmg / Math.max(1, r.time)).toFixed(0).padStart(7), String(u.kills).padStart(6), String(u.heal).padStart(7), String(u.taken).padStart(7), String(u.attacks).padStart(5), String(casts).padStart(6)].join(' '));
  }
}
if (b.errors.length) { console.log('\n   errors:'); for (const e of b.errors.slice(0, 10)) console.log('   - ' + e.label + ' ' + e.who + ': ' + e.message); }
