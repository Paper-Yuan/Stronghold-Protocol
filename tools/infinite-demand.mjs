// tools/infinite-demand.mjs — 超限模拟 R1→R60 的需求曲线（DPS / HPS）。
//
// 用**真实 GameData** 逐回合生成波次（与 Match 同一套生成器与同一套开关）：
//   R1–R15  buildNormalWave + capWaveKinds(…, 3)   （超限的前 15 回合收敛到 3 种怪）
//   R16+    buildInfiniteNormalWave                （无限波次，不设怪池上限）
//   R14/20/25/…  buildInfiniteBossWave             （超限 Boss 轮，血量走 getInfiniteBossHp 的逐回合成长）
// 再把每回合的敌方总量折成两个玩家侧指标：
//   需求 DPS = 敌方总有效生命 / 本回合时限
//   需求 HPS = 敌方总输出速率（Σ atk/bat × 数量，乘波次缩放）
// 这两个数就是「这一回合阵容至少得多能打、多能奶」的下界估计。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData } from '../server/match/gamedata.js';
import { buildNormalWave } from '../server/match/waves.js';
import { buildInfiniteNormalWave, buildInfiniteBossWave, isInfiniteBossRound, capWaveKinds } from '../server/match/infiniteWaves.js';
import { getInfiniteBossHp } from '../shared/infiniteMode.js';
import { createRng } from '../server/sim/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8'));
const data = {};
for (const f of ['config', 'chess', 'enemies', 'items', 'waves', 'stages', 'bands', 'bosses', 'choices', 'effects', 'factions', 'garrisons', 'bonds', 'tokens']) data[f] = read(f);
const gd = new GameData(data, 'mode_single_hard');
const rng = createRng(20261017);
// 超限是单人房：factions 取全部类型（Match 里由 setup.factions 给出，单人不投票）
const FACTIONS = Object.keys(gd.factions?.types || {}).filter((t) => t !== 'SPECIAL');

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function waveOf(r) {
  if (isInfiniteBossRound(r)) return buildInfiniteBossWave(gd, rng, r);
  if (r >= 16) return buildInfiniteNormalWave(gd, rng, r);
  return capWaveKinds(buildNormalWave(gd, rng, FACTIONS, r), 3, rng);
}

function demandOf(wave) {
  let hp = 0, out = 0, count = 0;
  for (const s of (wave && wave.spawns) || []) {
    const e = gd.enemy(s.enemyKey) || {};
    const st = e.stats || {};
    const n = Math.max(1, num(s.count, 1));
    hp += num(st.maxHp, 1000) * num(s.mods && s.mods.hpMul, 1) * n;
    out += (num(st.atk, 0) * num(s.mods && s.mods.atkMul, 1)) / Math.max(0.05, num(st.bat, 1.5)) * n;
    count += n;
  }
  return { hp, out, count };
}

const rows = [];
for (let r = 1; r <= 60; r++) {
  if (r === gd.bossRound || r === gd.hiddenRound) continue;   // 终局 Boss 不在超限的常驻循环里
  const wave = waveOf(r);
  const d = demandOf(wave);
  let bossHp = 0;
  if (isInfiniteBossRound(r)) {
    const rec = gd.boss(wave.primaryBoss) || {};
    // bloodPoint 的键是大写（FUNNY/NORMAL/HARD/ABYSS），gd.difficulty 也是大写
    const bp = num(rec.bloodPoint && (rec.bloodPoint[gd.difficulty] || rec.bloodPoint.HARD), 500000);
    bossHp = getInfiniteBossHp(bp, r) * (wave.isDouble ? 2 : 1);
  }
  const limit = Math.max(1, num(gd.combatTimeLimit(r), 120));
  const totalHp = d.hp + bossHp;
  rows.push({ r, count: d.count, hp: totalHp, limit, needDps: totalHp / limit, needHps: d.out, boss: isInfiniteBossRound(r), bossId: isInfiniteBossRound(r) ? wave.primaryBoss : null });
}

console.log('   R  怪数   敌总HP(万)  时限   需求DPS    需求HPS');
for (const x of rows) {
  if (x.r > 20 && x.r % 5 !== 0) continue;
  console.log('  ' + String(x.r).padStart(2) + '  ' + String(x.count).padStart(4) + '  ' +
    (x.hp / 1e4).toFixed(1).padStart(10) + '  ' + String(Math.round(x.limit)).padStart(4) + '  ' +
    Math.round(x.needDps).toLocaleString('en-US').padStart(9) + '  ' +
    Math.round(x.needHps).toLocaleString('en-US').padStart(9) + (x.boss ? '   BOSS ' + (x.bossId || '') : ''));
}

// ---- 对照表：只列超限 Boss 轮的档位推进（先简单后难，不回环）----
{
  const pool = (gd.bossWeights(true) || []).slice();
  const bloodOf = (id) => { const rec = gd.boss(id) || {}; const bp = rec.bloodPoint || {}; return num(bp[gd.difficulty] ?? bp.HARD, 0); };
  pool.sort((a, b) => bloodOf(a[0]) - bloodOf(b[0]));
  console.log('');
  console.log('  超限 Boss 档位（按血点升序，第 n 次 Boss 战取第 n 档，用完后停在最强档）');
  console.log('   档   Boss     血点(万)   出场回合');
  for (let i = 0; i < pool.length; i++) {
    console.log('   ' + i + '   ' + pool[i][0].padEnd(7) + ' ' + (bloodOf(pool[i][0]) / 1e4).toFixed(1).padStart(9) + '   R' + (20 + i * 5));
  }
}
