// test/match/overlimit-audit.test.js — 超限模拟（solo_infinite / gd.overlimit）审计修复的回归。
//
// 对应 docs/proposals/OVERLIMIT.md §2 的四条**缺陷面**发现（不含任何玩法改动）：
//   F1  gd.overlimit 从未置位（三处分支是死代码）—— 现在由 Match 按 isInfinite 传入；
//       但 `enemyScale` 的 ×1.19^(r−1) 阶梯**不打开**（R60 会到 1.0e5 倍），已删除并用断言钉住。
//   F2  超限 Boss 轮没有倒计时（bossLevelTime → null → deadline=0）—— R20=120 s、R25=130 s…；
//       普通轮仍是 null，普通模式 R14 的 120 s 不变。
//   F3  结算 roundsPassed 被 gd.bossRound（14）封顶 —— 超限局改为实际回合数（与 overlimit.maxRound 同数）。
//   F5  Boss 档位按 bloodPoint 静态血点排序 —— 改为按实际池血量 bossPoolHp 排序。
//
// 每条断言都写具体数值（修前 → 修后的实测值在注释里），普通模式的对照值也留在同一文件，
// 证明改动没有越界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildResult } from '../../server/match/results.js';
import { buildInfiniteBossWave, buildInfiniteNormalWave } from '../../server/match/infiniteWaves.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
/** 超限 Boss 战：假战一口价把共享血池打空（bossDps），让它按真实流程进 FINAL_ASSAULT。 */
const BOSS_SCRIPT = () => ({ duration: 2, leaks: {}, bossDps: 1e9 });

/** 一份“真实流程”的超限局：虚拟时钟但战斗不瞬移（instant:false），否则 deadline 恒为 0。 */
function infiniteMatch(seed = 11) {
  return makeMatch({ mode: 'solo_infinite', difficulty: 'ABYSS', seed, fake: true, instant: false, script: BOSS_SCRIPT });
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 · gd.overlimit 置位（只按 isInfinite）
// ─────────────────────────────────────────────────────────────────────────────

test('F1 超限开关由 Match 按 isInfinite 置位；普通模式 / 直接 new GameData 一律 false', () => {
  const inf = makeMatch({ mode: 'solo_infinite', difficulty: 'ABYSS', seed: 7, fake: true }).start();
  assert.equal(inf.m.gd.overlimit, true, 'solo_infinite 必须点亮 gd.overlimit（修前恒为 false）');
  inf.m.dispose();

  const solo = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 7, fake: true }).start();
  assert.equal(solo.m.gd.overlimit, false, '普通单人不能被超限口径污染');
  solo.m.dispose();

  const coop = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, seed: 7, fake: true }).start();
  assert.equal(coop.m.gd.overlimit, false, '普通同盟不能被超限口径污染');
  coop.m.dispose();

  // 同盟超限（coop_infinite）同样是超限：Match.isInfinite 由 isInfiniteMode(mode) 判定，两条房间模式都算
  const cinf = makeMatch({ mode: 'coop_infinite', difficulty: 'ABYSS', humans: 2, seed: 7, fake: true }).start();
  assert.equal(cinf.m.isInfinite, true);
  assert.equal(cinf.m.gd.overlimit, true, 'coop_infinite 也必须有 Boss 轮时钟');
  cinf.m.dispose();

  // 工具 / 测试直接 new GameData 时缺省关闭；只有字面量 true 才打开
  assert.equal(new GameData(DATA, 'mode_single_abyss').overlimit, false);
  assert.equal(new GameData(DATA, 'mode_single_abyss', {}).overlimit, false);
  assert.equal(new GameData(DATA, 'mode_single_abyss', { overlimit: 1 }).overlimit, false, '只认 true，不认 truthy');
  assert.equal(new GameData(DATA, 'mode_single_abyss', { overlimit: true }).overlimit, true);
});

test('F1 超限 R1–R15 查同队型的绝境表（单人 abyss / 同盟 multi_abyss），不串队型', () => {
  const soloHard = new GameData(DATA, 'mode_single_hard');
  const soloInf = new GameData(DATA, 'mode_single_hard', { overlimit: true });
  // 修前（overlimit=false）：HARD 的曲线 R1 ×0.8、R15 ×1.65888
  assert.equal(soloHard.enemyScale(1).hpMul, 0.8);
  close(soloHard.enemyScale(15).hpMul, 1.65888);
  // 修后：R1 ×1.2、R15 ×3.5831808（绝境表）
  assert.equal(soloInf.enemyScale(1).hpMul, 1.2);
  close(soloInf.enemyScale(15).hpMul, 3.5831808);

  // 同盟拿的是同盟自己的绝境表：R5 hp ×2.0736 / atk ×1.331（单人 abyss R5 是 ×1.44 / ×1.21）
  const coopInf = new GameData(DATA, 'mode_multi_hard', { overlimit: true });
  close(coopInf.enemyScale(5).hpMul, 2.0736);
  close(coopInf.enemyScale(5).atkMul, 1.331);
  close(coopInf.enemyScale(5).supplyHpMul, 1.2);
  assert.notEqual(coopInf.enemyScale(5).hpMul, 1.44, '同盟不拿单人的绝境表');
});

test('F1 ×1.19^(r−1) 阶梯没有打开：超限 enemyScale 在 R16+ 就是 ×1（R60 不是 1.0e5）', () => {
  const gd = new GameData(DATA, 'mode_single_abyss', { overlimit: true });
  for (const r of [16, 20, 25, 40, 60]) {
    assert.deepEqual(gd.enemyScale(r), { hpMul: 1, atkMul: 1, speedMul: 1 }, `R${r} 必须是官方表口径（表只到 R15）`);
  }
  // 那条死阶梯若被接上：3.5831808 × 1.19^59 ≈ 102,690 倍；R16 也有 48.7 倍。
  const ladderAt60 = 3.5831808 * Math.pow(1.19, 59);
  assert.ok(ladderAt60 > 1e5, '阶梯值本身就该是 1e5 量级（证明这条断言有意义）');
  assert.equal(gd.enemyScale(60).hpMul, 1);
  assert.equal(gd.enemyScale(16).hpMul, 1);
  // R16+ 的曲线由 infiniteWaves 的 enemyInfiniteScale 负责（这里只是不重复乘）
  const r15 = gd.enemyScale(15);
  close(r15.hpMul, 3.5831808);
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 · 超限 Boss 轮的倒计时
// ─────────────────────────────────────────────────────────────────────────────

test('F2 bossLevelTime：超限 R20=120 / R25=130 / R30=140 / R45=170，普通轮与普通模式仍是 null', () => {
  const gd = new GameData(DATA, 'mode_single_abyss', { overlimit: true });
  assert.equal(gd.bossLevelTime(20), 120);
  assert.equal(gd.bossLevelTime(25), 130);
  assert.equal(gd.bossLevelTime(30), 140);
  assert.equal(gd.bossLevelTime(45), 170);
  // 普通轮（R16–R19、R21–R24…）没有 Boss 关时钟
  assert.equal(gd.bossLevelTime(16), null);
  assert.equal(gd.bossLevelTime(19), null);
  assert.equal(gd.bossLevelTime(21), null);
  // 官方最终攻势 / 隐秘核心的时限不变
  assert.equal(gd.bossLevelTime(14), 120);
  assert.equal(gd.bossLevelTime(15), 120);
  // 普通模式（overlimit=false）：R20 仍然没有时钟 —— 修前的超限就长这样
  assert.equal(new GameData(DATA, 'mode_single_abyss').bossLevelTime(20), null);
  assert.equal(new GameData(DATA, 'mode_single_hard').bossLevelTime(20), null);
});

test('F2 超限 R20 Boss 的 deadline = 120 s（修前 0），加时扣血仍在 150 s', () => {
  const h = infiniteMatch();
  h.start();
  h.autoHumans();
  const m = h.m;
  assert.equal(h.drive(() => h.ended != null || (m.phase === 'FINAL_ASSAULT' && m.round === 20)), true);
  assert.equal(m.phase, 'FINAL_ASSAULT');
  assert.equal(m.round, 20);
  assert.equal(m.gd.bossLevelTime(20), 120);
  // 顶栏倒计时 = 120 s 真实秒（修前 deadline 恒为 0）
  assert.equal(m.deadline, m._combatStartAt + 120000);
  assert.equal(m.deadline - m._combatStartAt, 120000);
  // 内部时钟是「游戏秒」：120 真实秒 × combatTimeScale(2) = 240
  assert.equal(m._combatLimit, 240);
  // 加时起点保持官方 150 真实秒（不因为补了倒计时就提前 30 s 扣血）
  assert.equal(m.bossOvertimeStartReal, 150);
  assert.equal(m.overtimeAt, m._combatStartAt + 150000);
  assert.equal(m._overtimeGapGt, 60, '150−120 真实秒 = 60 游戏秒（切倍速时保留这段间隔）');
  h.m.dispose();
});

test('F2 R25 的倒计时 = 130 s；切 2× 按游戏秒折算，不会把倒计时缩短', () => {
  const h = infiniteMatch();
  h.start();
  h.autoHumans();
  const m = h.m;
  h.drive(() => h.ended != null || (m.phase === 'FINAL_ASSAULT' && m.round === 20));
  // 1× → 2×：剩余 240 游戏秒按 4 倍推进 = 60 s 真实时间；加时 = (240+60)/4 = 75 s
  assert.equal(m.handle('p_0', { t: 'g.combatSpeed', speed: 2 }).ok, true);
  assert.equal(m.gameSpeed, 4);
  assert.equal(m.deadline - m.sched.now(), 60000);
  assert.equal(m.overtimeAt - m.sched.now(), 75000);
  // 回到 1×，把 R20 打完并在词条界面选一张（不撤退），继续到 R25
  m.handle('p_0', { t: 'g.combatSpeed', speed: 1 });
  h.drive(() => h.ended != null || m.phase === 'TRAIT_DRAFT');
  assert.equal(m.phase, 'TRAIT_DRAFT');
  assert.equal(m.handle('p_0', { t: 'g.traitChoice', idx: 0 }).ok, true);
  h.drive(() => h.ended != null || (m.phase === 'FINAL_ASSAULT' && m.round === 25));
  assert.equal(m.phase, 'FINAL_ASSAULT');
  assert.equal(m.round, 25);
  assert.equal(m.deadline - m._combatStartAt, 130000);
  assert.equal(m._combatLimit, 260);
  assert.equal(m.overtimeAt - m._combatStartAt, 150000);
  h.m.dispose();
});

test('F2 普通模式 R14 的倒计时逐字节不变（120 s，内部时钟 120）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 11, fake: true, instant: false, script: BOSS_SCRIPT });
  h.start();
  h.autoHumans();
  const m = h.m;
  assert.equal(h.drive(() => h.ended != null || (m.phase === 'FINAL_ASSAULT' && m.round === 14)), true);
  assert.equal(m.gd.overlimit, false);
  assert.equal(m.gd.bossLevelTime(14), 120);
  assert.equal(m.gd.bossLevelTime(20), null);
  assert.equal(m.deadline - m._combatStartAt, 120000);
  assert.equal(m._combatLimit, 120, '普通 Boss 关仍按原来记（不换算游戏秒，行为不变）');
  h.m.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// F3 · 结算 roundsPassed
// ─────────────────────────────────────────────────────────────────────────────

test('F3 超限结算 roundsPassed = 实际回合数（R37 撤退 = 37，修前 14）', () => {
  const h = makeMatch({ mode: 'solo_infinite', difficulty: 'ABYSS', seed: 5, fake: true }).start();
  const m = h.m;
  m.round = 37;
  const won = buildResult(m, { victory: true, hiddenReached: false, hiddenCleared: false, reason: 'retreat' });
  assert.equal(won.roundsPassed, 37);
  assert.equal(won.players[0].roundsPassed, 37);
  assert.equal(won.overlimit.maxRound, 37, '结算分数与档案必须同一个数');
  // 失败收尾同样不封顶（修前 roundCap−1 = 13）
  const lost = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'eliminated' });
  assert.equal(lost.roundsPassed, 37);
  m.dispose();
});

test('F3 超限 R20 Boss 后撤退：roundsPassed = 20（修前 14）', () => {
  const h = makeMatch({ mode: 'solo_infinite', difficulty: 'ABYSS', seed: 11, fake: true, script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
  h.autoHumans();
  const m = h.m;
  assert.equal(h.drive(() => h.ended != null || m.phase === 'TRAIT_DRAFT'), true);
  assert.equal(m.phase, 'TRAIT_DRAFT');
  assert.equal(m.round, 20, '词条抉择开在 R20 的 Boss 清掉之后');
  assert.equal(m.handle('p_0', { t: 'g.retreat' }).ok, true);
  assert.equal(h.ended.reason, 'retreat');
  assert.equal(h.ended.roundsPassed, 20);
  assert.equal(h.ended.overlimit.maxRound, 20);
  m.dispose();
});

test('F3 普通模式仍按 gd.bossRound 封顶（R10 的局 = 14 / 失败 9，不变）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 5, fake: true }).start();
  const m = h.m;
  m.round = 10;
  const won = buildResult(m, { victory: true, hiddenReached: false, hiddenCleared: false, reason: 'victory' });
  assert.equal(won.roundsPassed, 14);
  const lost = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'eliminated' });
  assert.equal(lost.roundsPassed, 9);
  m.dispose();
});

// ─────────────────────────────────────────────────────────────────────────────
// F5 · Boss 档位排序（实际池血量，而不是 bloodPoint）
// ─────────────────────────────────────────────────────────────────────────────

test('F5 超限 Boss 档位按实际池血量排序：ABYSS R20 boss_9 → R25 boss_8 → R30 boss_10', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  const tier = (r) => buildInfiniteBossWave(gd, createRng(deriveSeed(1, 'tier')), r, null).primaryBoss;
  assert.equal(tier(20), 'boss_9');
  assert.equal(tier(25), 'boss_8');
  assert.equal(tier(30), 'boss_10');
  assert.equal(tier(35), 'boss_10', '档位用完后停在最强的那一个，不回环');
  // 同一回合里比池血量：3.95M < 7.2M < 7.6M（这就是排序键）
  assert.deepEqual(
    [tier(20), tier(25), tier(30)].map((id) => bossPoolHp(gd, id, 1, 20)),
    [3950000, 7200000, 7600000],
  );
  // 普通轮里的「带 Boss」也用同一口径
  const wave = buildInfiniteNormalWave(gd, createRng(deriveSeed(1, 'wboss')), 20, null, { withBoss: true });
  const bossSpawn = wave.spawns.find((s) => s && s.tag === 'boss');
  assert.equal(bossSpawn.enemyKey, gd.boss('boss_9').enemyKey);
});

test('F5 缺档时 bloodPoint 会排错：boss_9 的 ABYSS 档缺失后，实际池血量把它排到最强', () => {
  const data = structuredClone(DATA);
  // boss_9 没有 ABYSS 格：旧口径读 `bp[ABYSS] ?? bp[HARD] ?? 0` = 2.8M（池里最弱、会被排成第 1 档）；
  // 真正建池的 bossPoolHp 缺档时退回第一个有限值 ANNIHILATION = 11.52M（最强）。
  data.bosses.boss_9.bloodPoint = { ANNIHILATION: 11520000, HARD: 2800000 };
  const gd = new GameData(data, 'mode_single_abyss');
  assert.equal(gd.difficulty, 'ABYSS');
  const tier = (r) => buildInfiniteBossWave(gd, createRng(deriveSeed(1, 'tier')), r, null).primaryBoss;
  // 按池血量（同一回合 R20）：boss_8 7.2M < boss_10 7.6M < boss_9 11.52M
  assert.deepEqual([tier(20), tier(25), tier(30)], ['boss_8', 'boss_10', 'boss_9']);
  assert.deepEqual(
    ['boss_8', 'boss_10', 'boss_9'].map((id) => bossPoolHp(gd, id, 1, 20)),
    [7200000, 7600000, 11520000],
  );
  // 旧口径（bloodPoint）会把 boss_9 排在第一档 —— 这条断言说明修的是哪一个口径
  const bloodOf = (id) => {
    const bp = (gd.boss(id) || {}).bloodPoint || {};
    return Number(bp[gd.difficulty] ?? bp.HARD ?? 0) || 0;
  };
  assert.deepEqual(
    ['boss_9', 'boss_8', 'boss_10'].slice().sort((a, b) => bloodOf(a) - bloodOf(b)),
    ['boss_9', 'boss_8', 'boss_10'],
  );
});

// HARD 口径（tools/infinite-demand.mjs 的默认难度；真实超限房走 ABYSS，但工具 / 回归都拿这一档量曲线）。
test('F5 HARD 口径 R20/R25/R30 的档位不倒挂：池血量 2.8M → 7.2M → 7.6M', () => {
  const gd = new GameData(DATA, 'mode_single_hard');
  assert.equal(gd.difficulty, 'HARD');
  const tier = (r) => buildInfiniteBossWave(gd, createRng(deriveSeed(1, 'tier')), r, null).primaryBoss;
  const ids = [tier(20), tier(25), tier(30)];
  assert.deepEqual(ids, ['boss_9', 'boss_8', 'boss_10']);
  // 档位口径 = 实际血池（同一回合的成长/人数因子对所有 Boss 相同，比值才是曲线形状）
  const pools = ids.map((id, i) => bossPoolHp(gd, id, 1, [20, 25, 30][i]));
  assert.deepEqual(pools, [2800000, 7200000, 7600000]);
  assert.ok(pools[0] < pools[1] && pools[1] < pools[2], `HARD 档位必须单调（实际 ${pools.join(' → ')}）`);
  // 同回合内比：R20 池里的三档就是 2.8M < 3.6M < 3.8M
  assert.deepEqual(['boss_9', 'boss_8', 'boss_10'].map((id) => bossPoolHp(gd, id, 1, 20)), [2800000, 3600000, 3800000]);
});

test('F5 HARD 缺档时不再倒挂：boss_9 没有 HARD 血点，旧口径把它当最弱（实际 3.95M 最强）', () => {
  const data = structuredClone(DATA);
  // 只留 ABYSS 一档：这才是真实缺口的样子（该难度缺档 → 旧口径 `bp[HARD] ?? 0` = 0 = 「最弱」）
  data.bosses.boss_9.bloodPoint = { ABYSS: 3950000 };
  const gd = new GameData(data, 'mode_single_hard');
  const tier = (r) => buildInfiniteBossWave(gd, createRng(deriveSeed(1, 'tier')), r, null).primaryBoss;
  const pool = (id) => bossPoolHp(gd, id, 1, 20);
  // 修正后：按池血量 3.6M < 3.8M < 3.95M 排，最强的 boss_9 排最后一档
  assert.deepEqual(['boss_8', 'boss_10', 'boss_9'].map(pool), [3600000, 3800000, 3950000]);
  assert.deepEqual([tier(20), tier(25), tier(30)], ['boss_8', 'boss_10', 'boss_9']);
  // 旧口径：bloodPoint 读成 0 → boss_9 被排成第 1 档（R20 就撞上池血量最强的那个）
  const bloodOf = (id) => {
    const bp = (gd.boss(id) || {}).bloodPoint || {};
    return Number(bp[gd.difficulty] ?? bp.HARD ?? 0) || 0;
  };
  assert.equal(bloodOf('boss_9'), 0);
  assert.deepEqual(['boss_9', 'boss_8', 'boss_10'].slice().sort((a, b) => bloodOf(a) - bloodOf(b))[0], 'boss_9');
  assert.ok(pool('boss_9') > pool('boss_8') && pool('boss_8') > 0, '旧的「最先出场」= 最强的那个 → 倒挂');
});
