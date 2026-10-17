// tools/infinite-demand.mjs — 超限模拟的需求曲线（DPS / HPS）。
//
// 用真实的对局流程取样（不是重新实现一遍波次选择）：驱动一局 solo_infinite 到每一回合的 PREP，
// 读那一刻的 m.wave.spawns，按敌人的真实 stats 折成两个玩家侧指标：
//   需求 DPS = 本回合敌方总有效生命 / 本回合时限
//   需求 HPS = 本回合敌方总输出速率（Σ atk/bat × 数量，乘波次缩放）
// Boss 轮另算：血量来自 getInfiniteBossHp（超限专用成长）。
import { makeMatch } from '../test/match/harness.js';
import { getInfiniteBossHp } from '../shared/infiniteMode.js';
import fsx from 'node:fs';
import pathx from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOTX = pathx.resolve(pathx.dirname(fileURLToPath(import.meta.url)), '..');
const ENEMIES = JSON.parse(fsx.readFileSync(pathx.join(ROOTX, 'data/enemies.json'), 'utf8'));
const missing = new Set();

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const h = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', seed: 11, fake: true,
  script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
h.autoHumans();
const gd = h.m.gd;

function demandOf(wave) {
  let hp = 0, out = 0, count = 0;
  for (const s of (wave && wave.spawns) || []) {
    const e = gd.enemy(s.enemyKey) || ENEMIES[s.enemyKey] || {};
    const st = e.stats || {};
    if (!st.maxHp) missing.add(s.enemyKey);
    const n = Math.max(1, num(s.count, 1));
    const hpMul = num(s.mods && s.mods.hpMul, 1);
    const atkMul = num(s.mods && s.mods.atkMul, 1);
    hp += num(st.maxHp, 1000) * hpMul * n;
    out += (num(st.atk, 0) * atkMul) / Math.max(0.05, num(st.bat, 1.5)) * n;
    count += n;
  }
  return { hp, out, count };
}

const rows = [];
for (let r = 1; r <= 60; r++) {
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'PREP' && h.m.round === r));
  if (!ok || h.ended) { console.log('  (在第 ' + h.m.round + ' 回合结束)'); break; }
  const limit = Math.max(1, num(gd.combatTimeLimit(r), 120));
  const d = demandOf(h.m.wave);
  let bossHp = 0;
  // Boss 池在 PREP 还没建；直接按超限公式算，才是这一回合的真实需求
  if (h.m.bossWaves && h.m.bossWaves.length) {
    const w = h.m.bossWaves[0].wave || {};
    const rec = (w.primaryBoss && (gd.boss(w.primaryBoss) || {})) || {};
    const bp = (rec.bloodPoint && rec.bloodPoint[gd.difficulty]) || 500000;
    bossHp = getInfiniteBossHp(bp, r) * (w.isDouble ? 2 : 1);
  }
  const totalHp = d.hp + bossHp;
  rows.push({ r, count: d.count, hp: totalHp, needDps: totalHp / limit, needHps: d.out, boss: bossHp > 0 });
}

if (missing.size) console.log('  [警告] 这些敌人 key 在 data/enemies.json 里不存在：' + [...missing].slice(0, 6).join(', '));
console.log('   R  怪数   敌总HP(万)  时限  需求DPS   需求HPS');
for (const x of rows) {
  if (x.r % 5 !== 0 && x.r !== 1 && x.r !== 16 && x.r !== 17) continue;
  console.log('  ' + String(x.r).padStart(2) + '  ' + String(x.count).padStart(4) + '  ' +
    (x.hp / 1e4).toFixed(1).padStart(10) + '  ' + String(Math.round(gd.combatTimeLimit(x.r) || 120)).padStart(4) + '  ' +
    Math.round(x.needDps).toLocaleString('en-US').padStart(9) + '  ' + Math.round(x.needHps).toLocaleString('en-US').padStart(9));
}
