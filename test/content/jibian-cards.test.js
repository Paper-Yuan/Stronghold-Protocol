// test/content/jibian-cards.test.js — 我方惊变（server/sim/content/jibian.js）的数值效果规格。
//
// 每个用例都断言**具体数值**，不是「无异常」。移植来源已逐条标注（参考包 0.3.1-mod.4 的 test/*.mjs）。
// 战斗侧走 test/helpers/battleHarness.js 的 makeBattle（modeId = mode_single_zhajing，卡挂在 playerEffects 上，
// key = `jibian:<effectId>`）；prep 侧用假 registry + 假 ctx，测的就是 registerMeta 注册在服务器上的那份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, hashOf } from '../helpers/battleHarness.js';
import { install, registerMeta } from '../../server/sim/content/jibian.js';
import { registerMeta as registerMujicaBondMeta } from '../../server/sim/content/mujicaBond.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';

const OP = 'chess_char_1_01_a';

/** 一张只有本人的平地战斗：卡从 playerEffects 进，autoFinish 关掉，方便逐步断言。 */
function battleWith(effects = [], extra = {}) {
  return makeBattle({
    units: [{ chessId: OP, row: 9, col: 6 }],
    seed: 7,
    modeId: 'mode_single_zhajing',
    playerEffects: effects.map((e) => (typeof e === 'string' ? { key: 'jibian:' + e } : e)),
    autoFinish: false,
    timeLimit: 600,
    captureNoisy: false,
    ...extra,
  });
}

const stats = (h) => h.unit(OP).s;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 战斗侧：三张代表性卡的逐条数值

test('？！强强？！(jibian_qiangqiang)：攻击 / 防御 / 生命各 +15%（直接乘算）', () => {
  const base = battleWith([]); base.step(1);
  const on = battleWith(['jibian_qiangqiang']); on.step(1);
  const b = stats(base), a = stats(on);
  assert.ok(Math.abs(a.atk - b.atk * 1.15) < 1e-6, `atk ${b.atk} → ${a.atk}`);
  assert.ok(Math.abs(a.def - b.def * 1.15) < 1e-6, `def ${b.def} → ${a.def}`);
  assert.ok(Math.abs(a.maxHp - b.maxHp * 1.15) < 1e-6, `maxHp ${b.maxHp} → ${a.maxHp}`);
  assert.equal(on.b.errorCount, 0);
});

test('玻璃大炮 (jibian_bolidapao)：攻击 ×2、最高生命 ×0.4（hpPct −0.6 是加算区）', () => {
  const base = battleWith([]); base.step(1);
  const on = battleWith(['jibian_bolidapao']); on.step(1);
  const b = stats(base), a = stats(on);
  assert.ok(Math.abs(a.atk - b.atk * 2) < 1e-6, `atk ${b.atk} → ${a.atk}`);
  assert.ok(Math.abs(a.maxHp - b.maxHp * 0.4) < 1e-6, `maxHp ${b.maxHp} → ${a.maxHp}`);
});

// ★ 来源 sees-jibian.test.mjs ①：数万真言把技力需求变成 2 倍
test('数万真言 (jibian_shuwanzhenyan)：spCost 恰好 ×2', () => {
  const base = battleWith([]); base.step(1);
  const on = battleWith(['jibian_shuwanzhenyan']); on.step(1);
  const b = base.unit(OP), a = on.unit(OP);
  assert.equal(b.skill.spCostMul, 1);
  assert.equal(a.skill.spCostMul, 2);
  assert.equal(a.skill.spCost, Math.floor(b.skill.baseSpCost * 2), `${b.skill.baseSpCost} → ${a.skill.spCost}`);
});

// ★ 来源 sees-jibian.test.mjs ②：技能持续期间攻击力 +300%（skillStart 挂 buff、skillEnd 撤掉）
test('数万真言：技能期间 atkPct=3 的 buff 在，结束即撤', () => {
  const on = battleWith(['jibian_shuwanzhenyan']); on.step(1);
  const u = on.unit(OP);
  const KEY = 'jibian:shuwanzhenyan:atk';
  assert.ok(!u.findBuff(KEY), '开技前没有那个 buff');
  const before = u.s.atk;
  u.skill.sp = 0;
  u.skill.activate('manual', { free: true });
  on.step(1);
  const buff = u.findBuff(KEY);
  assert.ok(buff, '技能期间有 buff');
  assert.equal(buff.mods.atkPct, 3);
  assert.ok(u.s.atk > before * 2, `${before} → ${u.s.atk}`);
  u.skill.end('done');
  on.step(0.1);
  assert.ok(!u.findBuff(KEY), '技能结束后 buff 被撤掉');
});

// ★ 来源 sees-jibian.test.mjs ③：无下限术式 99.9% 物法闪避
test('无下限术式 (jibian_wuxiaxian)：dodgePhys / dodgeArts 都是 0.999', () => {
  const on = battleWith(['jibian_wuxiaxian']); on.step(1);
  const u = on.unit(OP);
  const buffs = (u.buffs || []).filter((x) => String(x.key).startsWith('jibian:wuxiaxian'));
  assert.ok(buffs.length >= 1, '身上挂了闪避 buff');
  assert.equal(buffs[0].mods.dodgePhys, 0.999);
  assert.equal(buffs[0].mods.dodgeArts, 0.999);
});

// 金酒之杯（params 路线）：整备阶段写进 ref.params，战斗侧按 ref 逐个上 buff
test('金酒之杯 (jibian_jinjiuzhibei)：params.aspd 直接变成攻速加成', () => {
  const base = battleWith([]); base.step(1);
  const on = battleWith([{ key: 'jibian:jibian_jinjiuzhibei', params: { funds: 50, n: 10, aspd: 70, atkPct: 0, hpPct: 0 } }]);
  on.step(1);
  const b = stats(base), a = stats(on);
  assert.ok(Math.abs((a.aspd - b.aspd) - 70) < 1e-6, `aspd ${b.aspd} → ${a.aspd}`);
  const buff = (on.unit(OP).buffs || []).find((x) => x.key === 'jibian:jinjiuzhibei:0');
  assert.ok(buff, '按 ref 序号挂的 buff 存在');
  assert.equal(buff.mods.aspd, 70);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// prep 侧（registerMeta）：假 registry + 假 ctx

function registryOf() {
  const seen = {};
  const reg = { seen, register(name, defs) { seen[name] = defs; }, has: () => false };
  registerMeta(reg);
  return seen;
}

/** 抽到卡的 onChoicePick 调用器：source.kind === 'effect' + ev.card 才是「刚抽到这张卡」。 */
function pickerOf(seen, id) {
  const h = seen[`jibian:${id}`];
  assert.ok(h && h.onChoicePick, `注册了 ${id}`);
  return (ctx) => h.onChoicePick(ctx, { card: { id } });
}

// ★ 来源 jibian-lingqiao.test.mjs ③：灵巧 = skillfulShip +80 层，且**不传 requireActive**
test('灵巧 (jibian_lingqiao)：addLayers(skillfulShip, 80) 且不带 requireActive', () => {
  const seen = registryOf();
  const calls = [];
  pickerOf(seen, 'jibian_lingqiao')({
    source: { kind: 'effect' },
    addLayers: (bond, n, opts) => calls.push({ bond, n, opts }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bond, 'skillfulShip');
  assert.equal(calls[0].n, 80);
  assert.equal(calls[0].opts?.requireActive, undefined, '「无需激活盟约」= 不传 requireActive');
  assert.match(calls[0].opts.reason, /^jibian:/);
});

// ★ 来源 sees-jibian.test.mjs ④：三月五日发一个精锐结城理，且不占商店池份数
test('三月五日 (jibian_sanyuewuri)：grantChess(chess_zj_60_5_b, requirePool:false)', () => {
  const seen = registryOf();
  const granted = [];
  pickerOf(seen, 'jibian_sanyuewuri')({
    source: { kind: 'effect' },
    chessRecord: (id) => (id === 'chess_zj_60_5_b' ? { chessId: id } : null),
    grantChess: (id, opts) => { granted.push({ id, opts }); return true; },
  });
  assert.equal(granted.length, 1);
  assert.equal(granted[0].id, 'chess_zj_60_5_b');
  assert.equal(granted[0].opts.requirePool, false);
});

test('onChoicePick 只在「刚抽到这张卡」时结算（choice:<id> 那一次与别人的卡都不触发）', () => {
  const seen = registryOf();
  const granted = [];
  const ctx = {
    source: { kind: 'choice' },                      // choices.js 先跑 choice:<id>，那一轮还没有 ref
    chessRecord: () => ({ ok: true }),
    grantChess: (id) => { granted.push(id); return true; },
  };
  const h = seen['jibian:jibian_sanyuewuri'];
  h.onChoicePick(ctx, { card: { id: 'jibian_sanyuewuri' } });
  assert.deepEqual(granted, [], 'source.kind = choice ⇒ 不结算');
  // 抽的是别的卡：refs 会被再派发一遍，但「这次抽的就是自己」不成立
  h.onChoicePick({ ...ctx, source: { kind: 'effect' } }, { card: { id: 'jibian_juanzeng' } });
  assert.deepEqual(granted, []);
});

test('捐赠 / 我在马路边捡到一分钱：+15 / +5 资金', () => {
  const seen = registryOf();
  const out = [];
  const ctx = (id) => ({ source: { kind: 'effect' }, addFunds: (n, why) => out.push({ id, n, why }) });
  pickerOf(seen, 'jibian_juanzeng')(ctx('juanzeng'));
  pickerOf(seen, 'jibian_malubian')(ctx('malubian'));
  assert.deepEqual(out, [{ id: 'juanzeng', n: 15, why: 'jibian' }, { id: 'malubian', n: 5, why: 'jibian' }]);
});

// ★ 来源 jibian-cengshu-nostack.test.mjs：不可叠加盟约（noStack）**不参与**洗牌，可叠加的层数总和不变
test('层数打乱 (jibian_cengshudaluan)：noStack 的盟约不被 setLayers，可叠加的总和不变', () => {
  const seen = registryOf();
  const onRoundStart = seen['jibian:jibian_cengshudaluan'].onRoundStart;
  assert.equal(typeof onRoundStart, 'function');

  const layers = { yanShip: 40, preciShip: 30, maniShip: 7, soloShip: 3 };
  const noStack = { maniShip: true, soloShip: true };
  const calls = [];
  const ctx = {
    data: { bonds: Object.fromEntries(Object.keys(layers).map((id) => [id, { bondId: id }])) },
    bonds: () => Object.fromEntries(Object.keys(layers).map((id) => [id, { active: true, count: 1 }])),
    bondActive: () => true,
    bondNoStack: (id) => !!noStack[id],
    layers: (id) => layers[id] || 0,
    setLayers: (id, n, opts) => { calls.push({ id, n, reason: opts?.reason }); layers[id] = n; },
    counter: () => 0,
    setCounter: () => {},
    toast: () => {},
    rng: Object.assign(() => 0.5, { int: (n) => 1 % n }),
  };
  onRoundStart(ctx, { round: 5 });
  assert.ok(!calls.some((c) => c.id === 'maniShip' || c.id === 'soloShip'), 'noStack 盟约一次都不写');
  assert.equal(layers.maniShip, 7, '不可叠加的层数原样保留');
  assert.equal(layers.soloShip, 3);
  assert.equal(layers.yanShip + layers.preciShip, 70, '可叠加的层数总和不变（只是分配被打乱）');
});

test('层数打乱：抽到这张卡的当回合不洗；可叠加盟约不足 2 个不洗', () => {
  const seen = registryOf();
  const onRoundStart = seen['jibian:jibian_cengshudaluan'].onRoundStart;
  const calls = [];
  const mk = (layers, counterRound) => ({
    data: { bonds: Object.fromEntries(Object.keys(layers).map((id) => [id, {}])) },
    bonds: () => Object.fromEntries(Object.keys(layers).map((id) => [id, { active: true }])),
    bondActive: () => true,
    bondNoStack: () => false,
    layers: (id) => layers[id] || 0,
    setLayers: () => calls.push(1),
    counter: () => counterRound,
    setCounter: () => {},
    toast: () => {},
    rng: Object.assign(() => 0, { int: () => 0 }),
  });
  onRoundStart(mk({ a: 1, b: 2 }, 5), { round: 5 });
  assert.equal(calls.length, 0, '当回合不洗');
  onRoundStart(mk({ only: 4 }, 0), { round: 6 });
  assert.equal(calls.length, 0, '不足 2 个可叠加盟约不洗');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 确定性 + 开关无关性

test('确定性：同 seed 同卡 → 战斗快照哈希完全相同（薛定谔的猫用了 battle.rng）', () => {
  const run = (seed) => { const h = battleWith(['jibian_xuedingedemao'], { seed }); h.step(3); return hashOf(h.snapshot()); };
  assert.equal(run(7), run(7), '同 seed 必须逐字节一致');
  // 随机确实来自 seed：不同 seed 之间结果不全相同（10 个 seed 里至少两种结局）
  const distinct = new Set(Array.from({ length: 10 }, (_, i) => run(i + 1)));
  assert.ok(distinct.size > 1, `10 个 seed 只得到 1 种结果：${[...distinct]}`);
});

test('SP_ZHAJING_SKIP_SP 与本模块无关：置位前后战斗快照逐字节相同', () => {
  const build = () => {
    const h = battleWith(['jibian_qiangqiang', 'jibian_shuwanzhenyan'], {
      flags: { startOpCooldown: 0, enemyJibian: ['ejibian_xianfazhiren'] },
      enemies: [{ key: 'ej1', time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    });
    h.step(2);
    return h;
  };
  const before = hashOf(build().snapshot());
  const prev = process.env.SP_ZHAJING_SKIP_SP;
  process.env.SP_ZHAJING_SKIP_SP = '1';
  try {
    const after = build();
    assert.equal(hashOf(after.snapshot()), before);
    assert.equal(after.b.errorCount, 0);
  } finally {
    if (prev === undefined) delete process.env.SP_ZHAJING_SKIP_SP; else process.env.SP_ZHAJING_SKIP_SP = prev;
  }
});

test('四个内容模块都不读 process.env / 不用 Math.random / 不碰时钟', () => {
  for (const f of ['jibian.js', 'ejibian.js', 'jibianBonds.js', 'mujica.js', 'mujicaBond.js']) {
    const src = readFileSync(new URL(`../../server/sim/content/${f}`, import.meta.url), 'utf8');
    // 注释里提到这些词是允许的（本文件的注释就在说明「参考包的 Math.random 已换掉」），所以先剥注释再查。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(!/Math\.random/.test(code), `${f}: 不得使用 Math.random`);
    assert.ok(!/process\.env/.test(code), `${f}: 不得读 process.env`);
    assert.ok(!/SP_ZHAJING_SKIP_SP/.test(code), `${f}: 不得依赖 SP_ZHAJING_SKIP_SP`);
    assert.ok(!/\bDate\.now|new Date\(/.test(code), `${f}: 不得读时钟`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 钩子名守卫：本仓 prep 钩子表是权威（server/match/effectsMeta.js 的 HOOKS）。
// MetaRegistry 对未知钩子名**不抛错、只记一条 warning**（「will never run」）—— 一个拼错的钩子名 = 一张卡静默失效。
// 这条用例就是那个验收矩阵：把 jibian + mujicaBond 的 registerMeta 灌进真实 registry，除下列两个**单点派发**事件外
// 必须零 warning（它们由 `match.dispatch` 直接按名字调、engine-core 已确认不进 `HOOKS` 表；若以后进表，这个白名单自然失效）。
const KNOWN_SINGLE_POINT_HOOKS = ['onRoundWouldStart', 'onWouldEliminate'];

test('所有注册的 prep 钩子名都在 0.3.3 的事件表里（未知钩子零 warning）', () => {
  const reg = new MetaRegistry();
  registerMeta(reg);
  registerMujicaBondMeta(reg);
  const unexpected = reg.warnings.filter((w) => !KNOWN_SINGLE_POINT_HOOKS.some((n) => w.includes(`'${n}'`)));
  assert.deepEqual(unexpected, [], `未知钩子：${unexpected.join(' | ')}`);
  // 两张「回合将开始 / 将淘汰」的卡现在都真的挂上了钩子（之前是注释掉等事件的）
  assert.equal(typeof reg.get('jibian:jibian_zhuiji').onRoundWouldStart, 'function');
  assert.equal(typeof reg.get('jibian:jibian_shiguangzhimo').onWouldEliminate, 'function');
});

// 追忆：只在**进入第 14 回合之前**把回合号改写成 10，且一局只发生一次（写进 jibianConsumed）。
test('追忆 (jibian_zhuiji)：第 14 回合 → 改写为 10，一次性', () => {
  const reg = new MetaRegistry();
  registerMeta(reg);
  const h = reg.get('jibian:jibian_zhuiji');
  const mk = (consumed) => {
    const out = { consumed: new Set(consumed), marked: [], toasts: [] };
    out.ctx = {
      jibianConsumed: () => out.consumed,
      markJibianConsumed: (id) => { out.marked.push(id); out.consumed.add(id); },
      toast: (msg) => out.toasts.push(msg),
    };
    return out;
  };

  // 13 回合（即将进入 14）：改成 10 并记账
  const a = mk([]);
  const evA = { round: 14 };
  h.onRoundWouldStart(a.ctx, evA);
  assert.equal(evA.round, 10);
  assert.deepEqual(a.marked, ['jibian_zhuiji']);
  assert.equal(a.toasts.length, 1);

  // 已经消耗过：不再改写（第二次走到 13 时卡已失效）
  const b = mk(['jibian_zhuiji']);
  const evB = { round: 14 };
  h.onRoundWouldStart(b.ctx, evB);
  assert.equal(evB.round, 14, '已消耗 ⇒ 保持 14');

  // 别的回合一律不动（无 handler 的局也因此逐字节不变）
  for (const r of [1, 10, 13, 15]) {
    const c = mk([]);
    const ev = { round: r };
    h.onRoundWouldStart(c.ctx, ev);
    assert.equal(ev.round, r, `round ${r} 不该被改`);
    assert.deepEqual(c.marked, []);
  }
});

// 时光之末：非 boss 战里置 ev.saved 并消耗自己；**只管 saved**（LP=1 由 settle 做，这里不许 addLp）。
test('时光之末 (jibian_shiguangzhimo)：非 boss 战置 saved 并消耗自己，不动 LP', () => {
  const reg = new MetaRegistry();
  registerMeta(reg);
  const h = reg.get('jibian:jibian_shiguangzhimo');
  const mk = () => {
    const out = { removed: [], lp: [] };
    out.ctx = {
      effects: () => [{ id: 'eff1', key: 'jibian:jibian_shiguangzhimo' }, { id: 'eff2', key: 'jibian:jibian_juanzeng' }],
      removeEffect: (id) => out.removed.push(id),
      addLp: (n) => out.lp.push(n),
    };
    return out;
  };

  const a = mk();
  const evA = { kind: 'normal', saved: false };
  h.onWouldEliminate(a.ctx, evA);
  assert.equal(evA.saved, true);
  assert.deepEqual(a.removed, ['eff1'], '只消耗自己那张 ref');
  assert.deepEqual(a.lp, [], '不自己加 LP（settle 会把 lp 设成 1，重复加就是 +1/+1）');

  for (const kind of ['boss', 'hidden']) {
    const b = mk();
    const evB = { kind, saved: false };
    h.onWouldEliminate(b.ctx, evB);
    assert.equal(evB.saved, false, `${kind} 战不触发`);
    assert.deepEqual(b.removed, []);
  }
});

// 影分身：参考实现还挂了 `onLayout`（0.3.3 没有这个事件）。留在 0.3.3 真实钩子上的那一份必须**真的重算**。
test('影分身 (jibian_yingfenshen)：onPrepEnd 真的重算 bondCountBonus（人数 = 棋盘上该盟约的干员数）', () => {
  const reg = new MetaRegistry();
  registerMeta(reg);
  const h = reg.get('jibian:jibian_yingfenshen');
  assert.ok(h && h.onPrepEnd && h.onGain && h.onBuy && h.onSold && h.onMerge && h.onRoundStart, '六个真实钩子都在');
  assert.equal(h.onLayout, undefined, 'onLayout 已删（0.3.3 无此事件，留着只会静默失效）');

  const calls = [];
  const ctx = {
    board: () => [{ kind: 'chess', uid: 'u1' }, { kind: 'chess', uid: 'u2' }, { kind: 'item', uid: 'x' }],
    pieceBonds: (uid) => (uid === 'u1' ? ['yanShip', 'preciShip'] : ['yanShip']),
    data: { bonds: { yanShip: {}, preciShip: {}, maniShip: {} } },
    bonds: () => ({ yanShip: { active: true } }),
    setBondCountBonus: (id, n) => calls.push([id, n]),
  };
  h.onPrepEnd(ctx);
  // 覆盖式整表：有的写人数、没有的写 0；道具不算干员
  assert.deepEqual(calls, [['yanShip', 2], ['preciShip', 1], ['maniShip', 0]]);
});

test('install() 在没有惊变 ref 的战斗里什么都不装（主玩法零影响）', () => {
  const h = battleWith([]);
  h.step(1);
  // 没有卡：一个 jibian: 前缀的 buff 都不该出现
  const tagged = (h.b.allyUnits || []).flatMap((u) => (u.buffs || []).map((b) => String(b.key))).filter((k) => k.startsWith('jibian:'));
  assert.deepEqual(tagged, []);
  assert.equal(h.b.errorCount, 0);
  // 直接调用 install 也不抛
  assert.doesNotThrow(() => install(h.b));
});
