// 无尽模式「Boss / 强化调度」回归自检 —— 无需联网、纯内存跑。
//
//   node tools/endlessscalecheck.mjs
//
// 规则（用户确认）：
//   · 第一次 Boss 在第 14 回合（前 13 回合保持官方节奏）；此后**每 7 回合**一次 Boss（21、28、35…）。
//   · 14 回合后每 7 回合一个周期，波次模板复用官方表的 R8–R13（终局段高阶波次）+ R14（Boss）。
//   · 每经过一次 Boss，怪物「血量 / 攻击」在**官方公式外推之上**再 +1/3 基础难度属性（速度不变）。
//   · 非无尽模式数值与回合配置完全不变。
// 退出码非 0 表示有失败项。

process.env.NODE_ENV = 'test';

import { GameData } from '../server/match/gamedata.js';
import { getData } from '../server/data.js';
import { modeIdFor, ENDLESS_BOSS_EVERY, ENDLESS_BOSS_STEP, ENDLESS_ENEMY_CYCLE_BOOST, ENDLESS_BOSS_CYCLE_SCALE } from '../shared/constants.js';

const data = getData({ log: { warn() {}, error() {}, info() {} } });
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(4) : String(v));

const MODE = modeIdFor('coop', 'ENDLESS_ABYSS');
const gd = new GameData(data, MODE);
// 隔离对照：同一模式但把阶梯比例设为 0 → 拿到「纯官方公式外推」的基准值，用于证明本阶梯是叠加其上的。
const gdPure = new GameData(data, MODE);
gdPure.mode = { ...gdPure.mode, enemyCycleBoost: 0 };

console.log('\n[1] 常量与默认值');
ok(gd.isEndless === true, `模式 ${MODE} 判定为无尽`);
ok(ENDLESS_BOSS_EVERY === 14 && gd.endlessBossFirst === 14, '第一次 Boss 在第 14 回合');
ok(ENDLESS_BOSS_STEP === 7 && gd.endlessBossStep === 7, '第一次之后每 7 回合一次');
ok(near(gd.endlessEnemyCycleBoost, 1 / 3) && near(ENDLESS_ENEMY_CYCLE_BOOST, 1 / 3), '默认每次加强比例 = 1/3');
ok(near(gdPure.endlessEnemyCycleBoost, 0), 'mode.enemyCycleBoost 可覆盖（对照模式设为 0）');

console.log('\n[2] Boss 排期：R14 第一次，其后每 7 回合');
const bossWant = { 7: false, 13: false, 14: true, 15: false, 20: false, 21: true, 27: false, 28: true, 34: false, 35: true, 42: true, 49: true };
let bossOk = true;
for (const [r, want] of Object.entries(bossWant)) {
  const got = gd.isBossRound(Number(r));
  if (got !== want) { bossOk = false; console.log(`  ✗ R${r} 期望 ${want} 实得 ${got}`); }
}
ok(bossOk, 'R14/21/28/35/42/49 是 Boss；R7/13/15/20/27/34 不是');
const idxWant = { 13: 0, 14: 1, 20: 1, 21: 2, 27: 2, 28: 3, 35: 4, 42: 5 };
let idxOk = true;
for (const [r, want] of Object.entries(idxWant)) if (gd.endlessBossIndex(Number(r)) !== want) idxOk = false;
ok(idxOk, 'Boss 序号：R14→1、R21→2、R28→3、R35→4（未到第一次为 0）');
ok(gd.bossRound === 14, 'gd.bossRound（第一次 Boss）仍为 14');

console.log('\n[3] 波次模板循环：7 回合周期复用 R8–R13 + R14(Boss)');
const keyWant = { 1: 'act1autochess_01', 7: 'act1autochess_07', 8: 'act1autochess_h01', 13: 'act1autochess_h06', 14: null };
let keyOk = true;
for (const [r, want] of Object.entries(keyWant)) {
  const rc = gd.roundCfg(Number(r));
  const tpl = rc ? rc.template ?? null : null;
  if (tpl !== want) { keyOk = false; console.log(`  ✗ R${r} 模板期望 ${want} 实得 ${tpl}`); }
}
ok(keyOk, 'R1–R13 与 R14(无普通模板= Boss) 保持官方原样');
const cyc = { 15: 'act1autochess_h01', 20: 'act1autochess_h06', 22: 'act1autochess_h01', 27: 'act1autochess_h06' };
let cycOk = true;
for (const [r, want] of Object.entries(cyc)) { const rc = gd.roundCfg(Number(r)); if ((rc?.template ?? null) !== want) cycOk = false; }
ok(cycOk, 'R15→h01、R20→h06、R22→h01、R27→h06（周期循环）');
const b21 = gd.roundCfg(21), b28 = gd.roundCfg(28);
ok(!!b21?.bossTemplates && !b21.template && !!b28?.bossTemplates && !b28.template,
  'R21 / R28 取到 Boss 回合配置（bossTemplates 有、普通 template 无）');

console.log('\n[4] 强化阶梯：每次 Boss 后 +1/3（叠加在外推之上）');
const rows = [1, 14, 20, 21, 27, 28, 34, 35, 41, 42, 49];
let scaleOk = true;
for (const r of rows) {
  const b = gd.enemyScale(r);
  const p = gdPure.enemyScale(r);
  const want = 1 + Math.max(0, gd.endlessBossIndex(r) - 1) / 3;
  const good = near(b.hpMul, p.hpMul * want) && near(b.atkMul, p.atkMul * want) && near(b.speedMul, p.speedMul);
  if (!good) scaleOk = false;
  console.log(`  ${good ? '✓' : '✗'} R${String(r).padStart(2)} 第 ${gd.endlessBossIndex(r)} 次前 ×${fmt(want)}：hp ${fmt(p.hpMul)}→${fmt(b.hpMul)}，atk ${fmt(p.atkMul)}→${fmt(b.atkMul)}，speed ${fmt(b.speedMul)}`);
}
ok(scaleOk, '各档位 hp/atk = 外推值 × (1 + (Boss序号-1)/3)，speed 恒不变');
ok(near(gd.enemyScale(20).hpMul, gdPure.enemyScale(20).hpMul), 'R1–R20 未加强（第一次增强在第 21 回合，即第一次 Boss 这局之后）');
ok(gd.enemyScale(20).hpMul !== 1 && gd.enemyScale(20).atkMul !== 1, '对照模式 R20 外推值 ≠1（官方公式外推仍生效，未被取代）');

console.log('\n[5] Boss 血池：按新的 Boss 序号成长（独立于怪物 +1/3）');
ok(near(gd.endlessBossPoolScale(14), 1) && near(gd.endlessBossPoolScale(21), ENDLESS_BOSS_CYCLE_SCALE)
  && near(gd.endlessBossPoolScale(28), Math.pow(ENDLESS_BOSS_CYCLE_SCALE, 2))
  && near(gd.endlessBossPoolScale(13), 1),
  `血池：第 1 次(R14) ×1、第 2 次(R21) ×${ENDLESS_BOSS_CYCLE_SCALE}、第 3 次(R28) ×${fmt(Math.pow(ENDLESS_BOSS_CYCLE_SCALE, 2))}`);

console.log('\n[6] 非无尽模式完全不受影响');
let othersOk = true;
for (const d of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
  const g = new GameData(data, modeIdFor('coop', d));
  for (const r of [1, 14, 15, 20]) {
    const a = g.enemyScale(r), o = g.baseEnemyScale(r);
    if (!(near(a.hpMul, o.hpMul) && near(a.atkMul, o.atkMul) && near(a.speedMul, o.speedMul))) othersOk = false;
  }
}
ok(othersOk, '四档常规难度 enemyScale 与改动前完全一致');

console.log('\n[7] 客户端镜像 isBossRoundOf 与服务端一致');
const { isBossRoundOf } = await import('../shared/constants.js');
const pub = { endless: true, bossRound: gd.bossRound, bossStep: gd.endlessBossStep, hiddenRound: null };
let mirrorOk = true;
for (let r = 1; r <= 60; r++) if (isBossRoundOf(pub, r) !== gd.isBossRound(r)) mirrorOk = false;
ok(mirrorOk, 'R1–R60 客户端 isBossRoundOf 与服务端 isBossRound 逐回合一致');

console.log('\n[8] Boss 轮抽：R14 用开局抽的，其后每回合独立重抽');
const { Match } = await import('../server/match/Match.js');
const { modeIdFor: mid } = await import('../shared/constants.js');
const gdEndless = new GameData(data, MODE);
const stub = (seed, setupBoss) => ({ gd: gdEndless, seed, bossId: setupBoss });
const at = (s, r) => Match.prototype.bossIdAtRound.call(s, r);
const S = stub(12345, 'boss_4');
ok(at(S, 1) === 'boss_4' && at(S, 13) === 'boss_4' && at(S, 14) === 'boss_4' && at(S, 20) === 'boss_4',
  'R1–R20 恒为开局抽中的 Boss（含 R14 第一次）');
const cycBoss = (r) => { const s = new Set(); for (let i = r; i < r + 7; i++) s.add(at(S, i)); return s; };
ok(cycBoss(21).size === 1 && cycBoss(28).size === 1 && cycBoss(35).size === 1, '每个 7 回合周期内 Boss 稳定不变');
ok(at(stub(999, 'boss_1'), 21) === at(stub(999, 'boss_1'), 21) && at(stub(999, 'boss_1'), 42) === at(stub(999, 'boss_1'), 42),
  '同一 seed 同一回合可复现（跨客户端一致）');
const pool = gdEndless.bossWeights(false).map(([id]) => id);
let inPool = true;
for (let r = 21; r <= 140; r += 7) if (!pool.includes(at(S, r))) inPool = false;
ok(inPool, '重抽结果都在权重池内（7 个 Boss）');
const seq = (seed) => [21, 28, 35, 42, 49].map((r) => at(stub(seed, 'boss_1'), r)).join(',');
let differs = 0;
for (let s = 1; s <= 60; s++) if (seq(s) !== seq(12345)) differs++;
ok(differs > 50, `不同 seed 的 Boss 序列大多不同（60 个 seed 中 ${differs} 个与基准不同）→ 确实是重抽`);
const gdNormal = new GameData(data, modeIdFor('coop', 'ABYSS'));
const SN = { gd: gdNormal, seed: 7, bossId: 'boss_3' };
ok([1, 14, 21, 28, 35].every((r) => at(SN, r) === 'boss_3'), '非无尽模式恒为开局抽中的 Boss（不受影响）');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
