// test/match/zhajing-forge.test.js — 炸惊模拟「锻造器」的服务端半边（protocol → Match → PlayerState → private view）。
//
// 这条链的每一环失效都不报错：`g.forgeTake` 没有 case = 静默丢弃；`m.private.forge` 不校验 rolled = 客户端能凭空拿卡；
// 发放钩子漏接 = 整个玩法「有面板没来源」；`flags.forge` 不传 = 锻造了但战斗里没有任何效果。
// 同时钉住隔离：官方房与湮灭房**拿不到**锻造器、`m.private` 不长 `forge` 键。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { validateC2S } from '../../shared/protocol.js';
import { FORGE_KILLS_PER, forgeOptionById, drawForge } from '../../shared/forgeData.js';

/** 炸惊单人局（真实数据），走到 PREP（可以安全地改玩家状态）。 */
const zj = (extra = {}) => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: 7, fake: true, ...extra }).start();
  h.toPrep(1);
  return h;
};

/** 抓每一场 Battle 的构造 opts（flags 就在里面）—— fake 战斗够快到 R14，而 FakeBattle 本身不存 flags。 */
const captureBattleOpts = (h) => {
  const seen = [];
  const Base = h.m.BattleClass;
  h.m.BattleClass = class extends Base {
    constructor(opts) { super(opts); seen.push(opts); }
  };
  return seen;
};

/** 给玩家塞 n 个锻造器（服务端权威字段，测试直接写）。 */
const withForges = (h, n = 1) => {
  const ps = h.ps('p_0');
  ps.forge.count += n;
  ps.forge.roll = drawForge(h.m.rngMeta);
  return ps;
};

describe('炸惊模拟 · 锻造器（g.forgeTake）', () => {
  test('协议：optId 是字符串、rarity 只能三档；缺字段/错档位在 C2S 就被拒', () => {
    assert.equal(validateC2S({ t: 'g.forgeTake', optId: 'atk', rarity: 'normal' }), null);
    assert.equal(validateC2S({ t: 'g.forgeTake', optId: 'sp', rarity: 'legend' }), null);
    assert.match(validateC2S({ t: 'g.forgeTake', rarity: 'normal' }) ?? '', /bad field optId/);
    assert.match(validateC2S({ t: 'g.forgeTake', optId: 'atk', rarity: 'rare' }) ?? '', /bad field rarity/);
    assert.match(validateC2S({ t: 'g.forgeTake', optId: 'x'.repeat(25), rarity: 'normal' }) ?? '', /bad field optId/);
  });

  test('发放①：精锐一名干员 → +1 个锻造器（三合一与升华两条路都算）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    assert.equal(ps.forge.count, 0, '开局 0 个');
    ps.forgeOnElite();
    assert.equal(ps.forge.count, 1, '精锐 +1');
    ps.forgeOnElite();
    assert.equal(ps.forge.count, 2);
    assert.equal(ps.forge.elites, 2, '累计精锐数也记');
    h.dispose?.();
  });

  test('发放②：累计击杀每满 FORGE_KILLS_PER 个 +1，且幂等（重复对账不重复发）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    ps.stats.kills = FORGE_KILLS_PER - 1;
    assert.equal(ps.forgeOnKills(), 0, '还差一个');
    ps.stats.kills = FORGE_KILLS_PER;
    assert.equal(ps.forgeOnKills(), 1, '满 40 发 1 个');
    assert.equal(ps.forgeOnKills(), 0, '再对账一次不重复发（幂等）');
    ps.stats.kills = FORGE_KILLS_PER * 3;
    assert.equal(ps.forgeOnKills(), 2, '一次补两档（40 → 120 差 2 个）');
    assert.equal(ps.forge.count, 3);
    h.dispose?.();
  });

  test('选卡：校验 rolled（不在桌上 → BAD_TARGET）、扣 1 个、累计进 forged、资金当场到账、抽下一组', () => {
    const h = zj();
    const ps = withForges(h, 2);
    const roll = ps.forge.roll;
    assert.ok(roll && roll.picks.length >= 1, `有可选的牌（${JSON.stringify(roll)}）`);
    const pick = roll.picks[0];
    const r = h.m.handle('p_0', { t: 'g.forgeTake', optId: pick, rarity: roll.rarity });
    assert.deepEqual(r, { ok: true }, `选卡被接受: ${JSON.stringify(r)}`);
    assert.equal(ps.forge.count, 1, '扣掉一个');
    assert.equal(ps.forge.forged[pick].count, 1, '写进已锻造表');
    assert.ok(ps.forge.roll && ps.forge.roll !== roll, '立刻抽下一组（对象换了）');
    // 一次性：同样的 optId 若不在新一组里，再选就是 BAD_TARGET（它不是「拿过一次」的锁，而是「不在桌上」）
    const off = ['atk', 'def', 'hp', 'crit', 'vamp', 'gold', 'range', 'block', 'sp'].find((id) => !ps.forge.roll.picks.includes(id) && forgeOptionById(id).value[ps.forge.roll.rarity]);
    if (off) {
      const bad = h.m.handle('p_0', { t: 'g.forgeTake', optId: off, rarity: ps.forge.roll.rarity });
      assert.equal(bad.error, 'BAD_TARGET', `不在桌上 → BAD_TARGET: ${JSON.stringify(bad)}`);
    }
    // 稀有度不匹配也拒
    const wrongRarity = roll.rarity === 'normal' ? 'legend' : 'normal';
    assert.equal(h.m.handle('p_0', { t: 'g.forgeTake', optId: pick, rarity: wrongRarity }).error, 'BAD_TARGET');
    h.dispose?.();
  });

  test('资金那一档立刻到账（其余八档等战斗侧）', () => {
    const h = zj();
    const ps = withForges(h, 1);
    ps.forge.roll = { rarity: 'legend', picks: ['gold', 'atk', 'hp'] };
    const before = ps.funds;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.forgeTake', optId: 'gold', rarity: 'legend' }), { ok: true });
    assert.equal(ps.funds - before, 5, '传说资金 +5 当场入账');
    assert.equal(ps.forge.count, 0);
    assert.equal(ps.forge.roll, null, '没牌了就没有 roll');
    h.dispose?.();
  });

  test('没有锻造器 → RATE（不是 BAD_TARGET：消息合法，额度用完了）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    assert.equal(ps.forge.count, 0);
    ps.forge.roll = { rarity: 'normal', picks: ['atk', 'def', 'hp'] };
    const r = h.m.handle('p_0', { t: 'g.forgeTake', optId: 'atk', rarity: 'normal' });
    assert.equal(r.error, 'RATE', JSON.stringify(r));
    h.dispose?.();
  });

  test('fail-closed：count > 0 但 roll 还空（发放后视图未推）→ 先补掷；补不出就 RATE，绝不接受任意组合', () => {
    const h = zj();
    const ps = h.ps('p_0');
    // 发放只加计数（grantForge），roll 由 forgeRoll 惰性抽 —— 这里造出「刚拿到锻造器、m.private 还没推下来」那一帧
    ps.forge.count = 1;
    ps.forge.roll = null;
    // 服务端抽不出牌（bot / 外部 AI / 手写协议消息可能抢在这一帧）：旧实现在这里 fail-open，接受任意 optId/rarity
    const rng = h.m.rngMeta;
    h.m.rngMeta = null;
    const refused = h.m.handle('p_0', { t: 'g.forgeTake', optId: 'range', rarity: 'legend' });
    assert.equal(refused.error, 'RATE', `补掷失败 → RATE（不是接受）: ${JSON.stringify(refused)}`);
    assert.equal(ps.forge.count, 1, '被拒时不扣额度');
    assert.deepEqual(ps.forge.forged, {}, '被拒时不写已锻造表');
    assert.equal(ps.forge.roll, null, '被拒时不留下半张 roll');

    // 随机流恢复后，同一个窗口里的下一次消息由服务端**补掷**再校验：这一手的三张里的一张被接受
    const zero = () => 0;             // 确定性 rng，测试自己算得出服务端会抽到哪一组
    h.m.rngMeta = zero;
    const expect = drawForge(zero);
    const ok = h.m.handle('p_0', { t: 'g.forgeTake', optId: expect.picks[0], rarity: expect.rarity });
    assert.deepEqual(ok, { ok: true }, `补掷后按这一手校验，正常组合被接受: ${JSON.stringify(ok)}`);
    assert.equal(ps.forge.count, 0, '接受后才扣额度');
    assert.equal(ps.forge.forged[expect.picks[0]].count, 1, '写进已锻造表');
    h.m.rngMeta = rng;
    h.dispose?.();
  });

  test('fail-closed：roll 为空时补掷出的那一手之外的选择仍然 BAD_TARGET（不在这一手）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    ps.forge.count = 1;
    ps.forge.roll = null;
    const zero = () => 0;
    const rng = h.m.rngMeta;
    h.m.rngMeta = zero;
    const expect = drawForge(zero);
    const off = ['atk', 'def', 'hp', 'crit', 'vamp', 'gold', 'range', 'block', 'sp']
      .find((id) => !expect.picks.includes(id) && forgeOptionById(id).value[expect.rarity]);
    if (off) {
      const r = h.m.handle('p_0', { t: 'g.forgeTake', optId: off, rarity: expect.rarity });
      assert.equal(r.error, 'BAD_TARGET', `不在补掷的这一手里 → BAD_TARGET: ${JSON.stringify(r)}`);
      assert.equal(ps.forge.count, 1, '被拒时不扣额度');
    }
    h.m.rngMeta = rng;
    h.dispose?.();
  });

  test('m.private.forge 只在炸惊出现，形状 = { count, per, forged, rolled } + 计数', () => {
    const h = zj();
    const ps = withForges(h, 1);
    const view = ps.privateView().forge;
    assert.ok(view, '炸惊房有 forge');
    assert.equal(view.count, 1);
    assert.equal(view.per, FORGE_KILLS_PER, 'per 下发（客户端画「还差 m」）');
    assert.deepEqual(view.forged, {}, '还没锻造过');
    assert.ok(view.rolled && Array.isArray(view.rolled.picks) && view.rolled.picks.length >= 1, 'rolled 带三张');
    assert.equal(typeof view.elites, 'number');
    assert.equal(typeof view.killsPaid, 'number');
    // 官方 / 湮灭：整键不出现，且拿不到锻造器
    for (const difficulty of ['NORMAL', 'ANNIHILATION']) {
      const other = makeMatch({ mode: 'solo', difficulty, seed: 7, fake: true }).start();
      other.toPrep(1);
      const ops = other.ps('p_0');
      assert.equal(ops.privateView().forge, undefined, `${difficulty}: 没有 forge 键`);
      assert.equal(ops.forge, null, `${difficulty}: 没有锻造器状态`);
      assert.equal(ops.forgeOnElite(), 0, `${difficulty}: 精锐不发`);
      assert.equal(ops.forgeOnKills(), 0, `${difficulty}: 击杀不发`);
      assert.equal(other.m.handle('p_0', { t: 'g.forgeTake', optId: 'atk', rarity: 'normal' }).error, 'BAD_TARGET', `${difficulty}: 选卡被拒`);
      other.dispose?.();
    }
    h.dispose?.();
  });

  test('战斗通道：flags.forge 携带扁平数值（没有锻造过时整键不出现）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    assert.equal(ps.forgeBattleFlags(), null, '什么都没锻造 → null（flags 不长键）');
    ps.forge.forged = { atk: { total: 325, count: 1 }, crit: { total: 3, count: 1 }, sp: { total: -10, count: 1 } };
    const f = ps.forgeBattleFlags();
    assert.ok(f && f.forge, '有摘要');
    assert.equal(f.forge.atk, 325);
    assert.equal(f.forge.crit, 3);
    assert.ok(Math.abs(f.forge.spMul - 0.9) < 1e-9, '技力需求按倍率给（-10 ⇒ 0.9）');
    h.dispose?.();
  });

  test('观战：别人 scout 时 m.field 带着该玩家的 forge 摘要（官方房没有这个键）', () => {
    const h = zj();
    const ps = withForges(h, 2);
    const meta = h.m.prepFieldMeta(ps);
    assert.ok(meta.forge, '观战字段里有 forge');
    assert.equal(meta.forge.count, 2);
    assert.ok(meta.forge.rolled, 'rolled 也带着（观战者能看到他在抽什么）');
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 7, fake: true }).start();
    plain.toPrep(1);
    assert.equal(plain.m.prepFieldMeta(plain.ps('p_0')).forge, undefined, '官方房不长这个键');
    h.dispose?.();
    plain.dispose?.();
  });

  test('共享场的 flags：boss / 隐秘核心 / 联防都按 playerId 携带（没锻造时整键不出现）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    // 没锻造过 → null（三处 spec 都因此不长键，与现在逐字节相同）
    assert.equal(h.m._forgeByPlayer(['p_0']), null, '没锻造 → null');
    ps.forge.forged = { atk: { total: 325, count: 1 }, crit: { total: 3, count: 1 } };
    const map = h.m._forgeByPlayer(['p_0']);
    assert.ok(map && map.p_0, '按 playerId 索引');
    assert.equal(map.p_0.atk, 325, 'atk 生效');
    assert.equal(map.p_0.crit, 3, 'crit 生效');
    // 官方房：同一份锻造表也不进 flags（gd 门在 _forgeByPlayer 里）
    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 7, fake: true }).start();
    plain.toPrep(1);
    const ops = plain.ps('p_0');
    if (ops.forge) ops.forge.forged = { atk: { total: 325, count: 1 } };
    assert.equal(plain.m._forgeByPlayer(['p_0']), null, '官方房不携带');
    h.dispose?.();
    plain.dispose?.();
  });

  test('端到端：Final Assault（boss 场）的 BattleSpec 真的带着该玩家的锻造加成', () => {
    const h = zj();
    const seen = captureBattleOpts(h);
    const ps = h.ps('p_0');
    ps.forge.forged = { atk: { total: 325, count: 1 }, crit: { total: 3, count: 1 } };
    assert.ok(h.drive(() => h.m.phase === 'FINAL_ASSAULT' && h.m.round === h.m.gd.bossRound), `走到 Final Assault（${h.m.phase} R${h.m.round}）`);
    const boss = seen.filter((o) => o.kind === 'boss' || o.kind === 'hidden').pop();
    assert.ok(boss, `造过 boss 场（共 ${seen.length} 场：${seen.map((o) => o.kind).join(',')}）`);
    const fp = boss.flags.forgeByPlayer;
    assert.ok(fp && fp.p_0, `boss 场 flags.forgeByPlayer 带着 p_0: ${JSON.stringify(boss.flags)}`);
    assert.equal(fp.p_0.atk, 325, 'atk 生效');
    assert.equal(fp.p_0.crit, 3, 'crit 生效');
    assert.equal(boss.flags.forge, undefined, '共享场不混用扁平形状');
    h.dispose?.();
  });

  test('端到端：隐秘核心（hidden 场）同样携带（test 命令快进到 R15）', () => {
    // 隐秘核心是 Final Assault **之后**的附加回合：lastRound 14 = 最后一个普通回合，hiddenRound 15 由 bossRounds 在
    // 「赢下 R14 boss 且过 hiddenEligible 门槛」时 startRound(15) 开出来。这里用测试命令的快进路径直接跳进那一回合
    // （testCommands 的 `round` 会按需要开 team LP），省掉先造 14 轮胜利的代价。
    const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: 7, fake: true, test: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    ps.forge.forged = { atk: { total: 799, count: 1 } };
    const seen = captureBattleOpts(h);
    const jump = m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: m.gd.hiddenRound } });
    assert.ok(jump && jump.ok !== false, `快进到 R${m.gd.hiddenRound} 被接受: ${JSON.stringify(jump)}`);
    assert.ok(h.drive(() => m.phase === 'HIDDEN_CORE' && m.round === m.gd.hiddenRound), `走到 Hidden Core（${m.phase} R${m.round}）`);
    const hid = seen.filter((o) => o.kind === 'hidden').pop();
    assert.ok(hid, `造出了 kind:'hidden' 的 spec（本局构造过的场次：${seen.map((o) => o.kind).join(',')}）`);
    const fp = hid.flags.forgeByPlayer;
    assert.ok(fp && fp.p_0, `hidden 场 flags.forgeByPlayer 带着 p_0: ${JSON.stringify(hid.flags)}`);
    assert.equal(fp.p_0.atk, 799, 'atk 在隐秘核心场同样生效');
    assert.equal(hid.flags.forge, undefined, '共享场不混用扁平形状');
    h.dispose?.();
  });

  test('对照：没锻造时 boss 场绝不出键（隐秘核心与 boss 同一处 bopts）', () => {
    // 对照：没锻造时 boss 场也绝不出键
    const clean = zj();
    const cleanSeen = captureBattleOpts(clean);
    assert.ok(clean.drive(() => clean.m.phase === 'FINAL_ASSAULT' && clean.m.round === clean.m.gd.bossRound));
    const cleanBoss = cleanSeen.filter((o) => o.kind === 'boss' || o.kind === 'hidden').pop();
    assert.ok(cleanBoss, '对照局也造了 boss 场');
    assert.equal(cleanBoss.flags.forgeByPlayer, undefined, '没锻造时 boss 场不长键');
    clean.dispose?.();
  });

  test('联防场：同一份按玩家索引的映射（_uniteOpts 用同一个 _forgeByPlayer 铺开）', () => {
    const h = zj();
    const ps = h.ps('p_0');
    ps.forge.forged = { crit: { total: 6, count: 1 } };
    // 联防 spec 由 _uniteOpts 用同一份 helper 铺开（铺开点：match/unitePhase.js 的 `forgeByPlayer ? { forgeByPlayer } : null`）。
    // 这里直接断言 helper 对「多个玩家」的返回：只列出真的锻造过、且在场的玩家。
    const map = h.m._forgeByPlayer(['p_0', 'p_1', null, 'ghost']);
    assert.deepEqual(Object.keys(map), ['p_0'], '只列出真的锻造过且在场的玩家');
    assert.equal(map.p_0.crit, 6);
    h.dispose?.();
  });
});
