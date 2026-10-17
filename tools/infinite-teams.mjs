#!/usr/bin/env node
// tools/infinite-teams.mjs — 超限模拟：大盟约 × 小盟约组合的整队 DPS / HPS / 一击线。
//
// 规则（业主 2026-10-17）：
//   * 队伍 = **大盟约的真实成员**（每个大盟约自己的干员，满配精英），小盟约只加层数
//   * 绝技（suntShip）默认生效；调和（maniShip）/ 远见（visiShip）/ 奇迹（miraShip）不管
//   * 层数：R15 大盟约 400 / 小盟约 150，之后每回合各 +50
//   * 采样 R15 / 25 / 35 / 45 / 60
//
// 指标：
//   DPS  = damageDealt / 战斗秒数      （打一个 1e12 血的木桩，不还手）
//   HPS  = healingDone / 战斗秒数      （同一批干员顶一个高攻木桩）
//   一击线 = 队伍里**最脆的那个**能挨下的最大单发（物理 maxHp+def / 法术 maxHp×100/(100−res)）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../test/helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8'));
const chess = read('chess');
const backups = read('backups');
const bonds = read('bonds');

const MAJOR = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
const MINOR = ['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip', 'investShip', 'raidShip', 'indomShip', 'emptyShip', 'soloShip'];
const ALWAYS = ['suntShip'];
const SLOT6 = 'chess_char_6_diy1_a';

// ---- 队伍名单：每个大盟约的真实成员（同 baseId 只留精锐）
const map = new Map();
for (const [k, v] of Object.entries(backups.units)) {
  for (const id of String(v.standsIn || '').split(',').map((s) => s.trim()).filter(Boolean)) map.set(id, k);
}
const rosterOf = {};
for (const m of MAJOR) {
  const byBase = new Map();
  for (const k of Object.keys(chess)) {
    const c = chess[k];
    if (!Array.isArray(c.bonds) || !c.bonds.includes(m) || !map.has(k)) continue;
    const base = c.baseId || k;
    const cur = byBase.get(base);
    if (!cur || (k.endsWith('_b') && !cur.endsWith('_b'))) byBase.set(base, k);
  }
  rosterOf[m] = [...byBase.values()];
}

// ---- 层数
const layersOf = (round) => ({ major: 400 + Math.max(0, round - 15) * 50, minor: 150 + Math.max(0, round - 15) * 50 });

const bondState = (id, count, layers) => ({ count, active: true, tier: Math.min(3, Math.max(1, count >= 6 ? 3 : count >= 4 ? 2 : 1)), layers });

function field(roster, majorId, minors, round, { punching = true } = {}) {
  const { major, minor } = layersOf(round);
  const units = roster.slice(0, 8).map((id, i) => {
    const c = chess[id];
    const b = c.backup || {};
    return { uid: i + 1, diy: { slot: SLOT6, charId: b.charId || c.charId, skillIndex: b.skillIndex ?? 1, uniEquipId: b.uniEquipId ?? null }, elite: true, row: 10, col: 4 + i };
  });
  const st = {};
  st[majorId] = bondState(majorId, Math.min(6, roster.length), major);
  for (const m of minors) st[m] = bondState(m, 3, minor);
  for (const m of ALWAYS) st[m] = bondState(m, 3, minor);
  // 木桩：血极厚、不还手（DPS）；或高攻会还手（HPS）
  const dummy = punching
    ? enemyRec({ key: 'e_dps', hp: 1e12, speed: 0, mass: 0, atk: 0 })
    : enemyRec({ key: 'e_hps', hp: 1e12, speed: 0, mass: 0, atk: 3000, bat: 1, range: 3 });
  const h = makeBattle({
    defs: { enemies: { [dummy.key]: dummy } },
    units,
    enemies: [{ key: dummy.key, pos: [10, 9] }],
    timeLimit: 60, autoFinish: false, seed: 7,
    bonds: st,
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999 },
  });
  h.step();
  const allies = h.allies();
  // 一击线：队伍里最脆的那个
  let physLine = Infinity, artsLine = Infinity;
  for (const u of allies) {
    const hp = Number(u.s.maxHp) || 0;
    const def = Number(u.s.def) || 0;
    const res = Math.min(95, Number(u.s.res) || 0);
    physLine = Math.min(physLine, hp + def);
    artsLine = Math.min(artsLine, hp * 100 / Math.max(5, 100 - res));
  }
  h.run(60);
  const r = h.b.result().perPlayer.p1 || {};
  return { dps: (r.damageDealt || 0) / 60, hps: (r.healingDone || 0) / 60, physLine: physLine === Infinity ? 0 : physLine, artsLine: artsLine === Infinity ? 0 : artsLine, n: allies.length };
}

// ---- 组合
function combos(arr, k) {
  const out = [];
  const go = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); go(i + 1, cur); cur.pop(); }
  };
  go(0, []);
  return out;
}
const COMBOS = combos(MINOR, 2);   // 2 小盟约组合（55 组）—— 3 组合留作抽样
const ROUNDS = [15, 30, 45, 60];

const t0 = Date.now();
const rows = [];
const ONLY = process.argv[2] ? process.argv[2].split(',') : MAJOR;
for (const m of ONLY) {
  const roster = rosterOf[m];
  if (!roster.length) { console.log('  [跳过] ' + m + ' 没有可用干员'); continue; }
  for (const c of COMBOS) {
    const per = { major: m, minors: c, rounds: {} };
    for (const r of ROUNDS) {
      const d = field(roster, m, c, r, { punching: true });
      per.rounds[r] = { dps: d.dps, hps: d.hps, physLine: d.physLine, artsLine: d.artsLine, n: d.n };
    }
    rows.push(per);
  }
  console.log('  ' + m + ' 完成（' + COMBOS.length + ' 组）  ' + Math.round((Date.now() - t0) / 1000) + 's');
}
const out = process.argv[2] ? '.cache/infinite-teams-' + process.argv[2].replace(/,/g, '-') + '.json' : '.cache/infinite-teams.json';
fs.writeFileSync(path.join(ROOT, out), JSON.stringify(rows, null, 0), 'utf8');

// ---- 结论：哪个大盟约最菜（按 R60 的平均 DPS / 一击线归一化）
const byMajor = {};
for (const row of rows) {
  const b = (byMajor[row.major] ||= { n: 0, dps: {}, hps: {}, phys: {}, arts: {} });
  b.n++;
  for (const r of ROUNDS) {
    b.dps[r] = (b.dps[r] || 0) + row.rounds[r].dps;
    b.hps[r] = (b.hps[r] || 0) + row.rounds[r].hps;
    b.phys[r] = (b.phys[r] || 0) + row.rounds[r].physLine;
    b.arts[r] = (b.arts[r] || 0) + row.rounds[r].artsLine;
  }
}
console.log('');
console.log('  大盟约均值（' + COMBOS.length + ' 种小盟约组合）');
console.log('  盟约            人数  R15 DPS  R60 DPS   R60 HPS   一击线(物理)  一击线(法术)');
const summary = [];
for (const m of MAJOR) {
  const b = byMajor[m];
  if (!b) continue;
  const avg = (o, r) => Math.round(o[r] / b.n);
  summary.push({ m, n: rosterOf[m].length, d15: avg(b.dps, 15), d60: avg(b.dps, 60), h60: avg(b.hps, 60), p60: avg(b.phys, 60), a60: avg(b.arts, 60) });
}
summary.sort((a, b) => a.d60 - b.d60);
for (const s of summary) {
  console.log('  ' + s.m.padEnd(15) + String(s.n).padStart(3) + String(s.d15).padStart(9) + String(s.d60).padStart(9) + String(s.h60).padStart(10) + String(s.p60).padStart(13) + String(s.a60).padStart(14));
}
console.log('');
console.log('  → 最菜的大盟约：' + summary[0].m + '（R60 平均 DPS ' + summary[0].d60 + '，一击线 ' + summary[0].p60 + '）');
console.log('  总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
