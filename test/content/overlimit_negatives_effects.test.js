// test/content/overlimit_negatives_effects.test.js — 超限模拟「负面词条」第二批：战斗侧 + 整备侧逐条数值
// （业主 2026-10-31 第二批，17 行表文逐条对齐 docs/research/24-overlimit-negative-relics.json）。
//
// 口径（与 test/content/overlimit_relics_effects.test.js 同一套）：
//   · 每条**至少一条带具体数值的断言**（属性倍率 / 层数 / 次数 / 定值 / 闪避概率）；
//   · 对照局 = 同样的场、**一条负面词条都没有**（`negs: []`），所以断言的是「这条负面带来的那一份」；
//   · 随机项（D15 的闪避掷骰）用 `b.rng = () => …` 钉死，不依赖真实骰子；
//   · 普通 / 湮灭 / 炸惊一帧不变：`flags.overlimit` 为假时**一个监听器都不挂**（最后两条）。
//
// 落点写在每条 test 的名字里：敌方属性走 buff mods（units.js _recalc）、入场走 enemySpawn、免死走 fatal、
// 闪避走 hit、定值走 damageOutput / heal、抵消负面走 beforeStatus、每回合经费走 registerMeta 的 onIncome。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { install as installNegative, registerMeta } from '../../server/sim/content/overlimitNegative.js';

const OP_ID = 'olneg_op_a';
const ENEMY = 'olneg_enemy';

/** 测试干员：atk 1000 / maxHp 10000 / def 100 / res 10 / 技力上限 1000（一场里不会自动开技能）。 */
const opRec = (over = {}) => chessRec({
  id: OP_ID, baseId: OP_ID, profession: 'WARRIOR',
  stats: { atk: 1000, maxHp: 10000, def: 100, res: 10, blockCnt: 2, bat: 2, aspd: 100, spRecovery: 1, cost: 0, moveSpeed: 1 },
  skill: { spCost: 1000, initSp: 0, durationType: 'NONE' },
  ...over,
});

/** 木桩敌人：atk 100 / def 100 / res 20 / 5e6 血 / 不动 / 不打人。 */
const enemyOf = (over = {}) => enemyRec({ key: ENEMY, rank: 'NORMAL', hp: 5e6, def: 100, res: 20, atk: 100, speed: 0, ...over });

/**
 * 一个超限局的战场：一名玩家、一名测试干员、一只木桩敌人。
 * @param {{ negs?: ({ id: string, tier?: number|null })[], at?: number, flags?: any, enemy?: any, round?: number }} [o]
 */
function field(o = {}) {
  const negs = o.negs ?? [];
  const units = [{ chessId: OP_ID, kind: 'chess', col: 5, row: 10 }];
  const h = makeBattle({
    seed: o.seed ?? 7, kind: 'normal', round: o.round ?? 5, units, enemies: [], timeLimit: 60, autoFinish: false,
    flags: { overlimit: true, ...(o.flags || {}) },
    defs: { chess: { [OP_ID]: opRec() }, enemies: { [ENEMY]: o.enemy ?? enemyOf() } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: units.map((u, i) => ({ uid: i + 1, kind: 'chess', chessId: u.chessId, row: u.row, col: u.col })),
      bonds: {}, bandId: null, playerEffects: [],
      ...(negs.length ? { relicsOverlimitNegative: negs.map((n) => ({ id: n.id, at: o.at ?? 5, tier: n.tier ?? null })) } : {}),
    }],
  });
  h.step();
  h.spawn(ENEMY, { pos: [9, 6] });
  return h;
}

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} ≉ ${b}`);
const hit = (h, amount = 1000, opts = {}) => {
  const b = h.b;
  const t = opts.target ?? h.enemies()[0];
  const before = t.hp;
  b.dealDamage({
    source: h.unit(OP_ID), target: t, amount, type: opts.type ?? 'phys', isAttack: true, isSkill: !!opts.isSkill,
    canDodge: opts.canDodge !== false,
  });
  return before - t.hp;
};
/** 本文件注册的那几个 hook 的条数（用来断言「一条都没挂」—— harness 自己的捕获钩子也在，所以只看增量）。 */
const hookCounts = (b) => Object.fromEntries(['hit', 'damaged', 'fatal', 'beforeStatus', 'damageOutput', 'enemySpawn', 'deploy', 'heal', 'skillStart']
  .map((k) => [k, (b._hooks[k] || []).length]));

// =====================================================================================================================
// 整备侧（D01）

test('LC-D01 破坏力Ⅰ/Ⅱ/Ⅲ：我方每回合发放的经费 −2 / −4 / −6（registerMeta onIncome，最低到 0）', () => {
  const globals = [];
  registerMeta({ global: (name, handler) => globals.push({ name, ...handler }) });
  assert.equal(globals.length, 1);
  assert.equal(globals[0].name, 'overlimit_negatives');
  const onIncome = globals[0].onIncome;
  const incomeOf = (negs, base = 10) => {
    const ev = { income: base };
    onIncome({ overlimitNegatives: () => negs }, ev);
    return ev.income;
  };
  assert.equal(incomeOf([]), 10, '一条都没有：不动');
  assert.equal(incomeOf([{ id: 'LC-D01', tier: 0 }]), 8, 'Ⅰ：−2');
  assert.equal(incomeOf([{ id: 'LC-D01', tier: 1 }]), 6, 'Ⅱ：−4');
  assert.equal(incomeOf([{ id: 'LC-D01', tier: 2 }]), 4, 'Ⅲ：−6');
  assert.equal(incomeOf([{ id: 'LC-D01', tier: null }]), 8, 'tier 缺失按 Ⅰ 读');
  assert.equal(incomeOf([{ id: 'LC-D01', tier: 2 }], 3), 0, '经费最低到 0，不会变成负数');
  assert.equal(incomeOf([{ id: 'LC-D02', tier: 2 }]), 10, '别的负面词条不碰经费');
  // 非超限局 / 旧 ctx：没有 overlimitNegatives 就什么都不做
  const ev = { income: 10 };
  onIncome({}, ev);
  assert.equal(ev.income, 10);
});

// =====================================================================================================================
// 敌方属性（D02 / D03 / D04 / D05 / D06 / D09 / D11）

test('LC-D02 基础威力增强Ⅰ/Ⅱ/Ⅲ：敌方基础生命 / 攻击 / 防御 +10/20/35%、法抗 ×(1+30%)（Ⅲ 档实测）', () => {
  const plain = field({ negs: [] }).enemies()[0];
  assert.equal(plain.s.maxHp, 5e6);
  assert.equal(plain.s.atk, 100);
  assert.equal(plain.s.def, 100);
  assert.equal(plain.s.res, 20);

  const h = field({ negs: [{ id: 'LC-D02', tier: 2 }] });
  const e = h.enemies()[0];
  near(e.s.maxHp, 5e6 * 1.35, '生命 +35%');
  near(e.hp, 5e6 * 1.35, '入场是满血：当前血量跟着上限走');
  near(e.s.atk, 135, '攻击 +35%');
  near(e.s.def, 135, '防御 +35%');
  near(e.s.res, 27, '法抗 ×1.35（百分比属性按乘算）');

  // Ⅰ / Ⅱ 档
  for (const [tier, mul] of [[0, 1.1], [1, 1.2]]) {
    const x = field({ negs: [{ id: 'LC-D02', tier }] }).enemies()[0];
    near(x.s.maxHp, 5e6 * mul, `档 ${tier} 生命`);
    near(x.s.atk, 100 * mul, `档 ${tier} 攻击`);
  }
});

test('LC-D03 最终威力增强：敌方造成的伤害 +20/30/45%', () => {
  for (const [tier, mul] of [[0, 1.2], [1, 1.3], [2, 1.45]]) {
    const e = field({ negs: [{ id: 'LC-D03', tier }] }).enemies()[0];
    near(e.s.dmgDealtMul, mul, `档 ${tier}：造成的伤害 ×${mul}`);
  }
  assert.equal(field({ negs: [] }).enemies()[0].s.dmgDealtMul, 1, '对照局没有增伤');
});

test('LC-D04 拼点威力增强：敌方攻击力和生命 +10/20/35%', () => {
  const e = field({ negs: [{ id: 'LC-D04', tier: 2 }] }).enemies()[0];
  near(e.s.atk, 135, '攻击 +35%');
  near(e.s.maxHp, 5e6 * 1.35, '生命 +35%');
  const i = field({ negs: [{ id: 'LC-D04', tier: 0 }] }).enemies()[0];
  near(i.s.atk, 110, 'Ⅰ 档 +10%');
});

test('LC-D05 生长：敌方生命值 +25/40/60%', () => {
  for (const [tier, mul] of [[0, 1.25], [1, 1.4], [2, 1.6]]) {
    const e = field({ negs: [{ id: 'LC-D05', tier }] }).enemies()[0];
    near(e.s.maxHp, 5e6 * mul, `档 ${tier}：生命 ×${mul}`);
    near(e.hp, 5e6 * mul, `档 ${tier}：入场满血`);
  }
});

test('LC-D06 肉体强化：生命 +25%（Ⅲ）、受到伤害 −25%、造成伤害 +10%', () => {
  const h = field({ negs: [{ id: 'LC-D06', tier: 2 }] });
  const e = h.enemies()[0];
  near(e.s.maxHp, 5e6 * 1.25, '生命 +25%');
  near(e.s.dmgTakenMul, 0.75, '受到的伤害 ×0.75');
  near(e.s.dmgDealtMul, 1.1, '造成的伤害 ×1.1');
  // 实际伤害：(1000 − def 100) × 0.75 = 675（受伤乘区叠在防御减伤之后）
  const dealt = hit(h, 1000);
  near(dealt, 675, '打到它身上的伤害 ×0.75', 1e-3);
  const plain = field({ negs: [] });
  near(hit(plain, 1000), 900, '对照局：1000 − def 100 = 900', 1e-3);
});

test('LC-D09 底力：移动速度 / 攻击速度 / 防御力 +25%', () => {
  const e = field({ negs: [{ id: 'LC-D09' }], enemy: enemyOf({ speed: 1 }) }).enemies()[0];
  near(e.s.def, 125, '防御 +25%');
  near(e.s.aspd, 125, '攻击速度 +25');
  near(e.s.moveSpeed, 1.25, '移动速度 ×1.25（基础 1）');
  assert.ok(e.s.interval < 2, '攻速上去后攻击间隔变短');
});

test('LC-D11 灼烧着的伤口：防御 / 法抗 −50%，攻击力 +75%、造成的伤害 +30%', () => {
  const h = field({ negs: [{ id: 'LC-D11' }] });
  const e = h.enemies()[0];
  near(e.s.def, 50, '防御 −50%');
  near(e.s.res, 10, '法抗 ×0.5');
  near(e.s.atk, 175, '攻击 +75%');
  near(e.s.dmgDealtMul, 1.3, '造成的伤害 +30%');
  // 防御减半 → 同一发伤害打得更疼
  const soft = hit(h, 1000);
  const plain = field({ negs: [] });
  assert.ok(soft > hit(plain, 1000), `防御 −50% 后受伤 ${soft} > 对照 ${1000 * 0.75}`);
});

// =====================================================================================================================
// 成长（D07 / D08）

test('LC-D07 锐利：入场后攻击力在 30 秒内爬升到原来的 130/170/210%（Ⅲ 档，到期不回落）', () => {
  const h = field({ negs: [{ id: 'LC-D07', tier: 2 }] });
  const e = h.enemies()[0];
  near(e.s.atk, 100, '刚入场：还没开始加');
  h.run(15);
  assert.ok(e.s.atk > 100 && e.s.atk < 210, `15 秒时在爬升中（${e.s.atk}）`);
  h.run(17);
  near(e.s.atk, 210, '30 秒后到 210%', 1e-3);
  h.run(5);
  near(e.s.atk, 210, '到期后换成常驻 buff，数值不回落', 1e-3);
});

test('LC-D08 坚韧：入场后防御力与法抗在 30 秒内爬升到原来的 130/170/210%', () => {
  const h = field({ negs: [{ id: 'LC-D08', tier: 0 }] });
  const e = h.enemies()[0];
  near(e.s.def, 100, '刚入场：原值');
  h.run(31);
  near(e.s.def, 130, '30 秒后防御 130%（Ⅰ 档）', 1e-3);
  near(e.s.res, 26, '30 秒后法抗 ×1.3', 1e-3);
});

// =====================================================================================================================
// 免死（D10）

test('LC-D10 自体发电：生命归零不退场，受到 12 次伤害后才被彻底击败', () => {
  const h = field({ negs: [{ id: 'LC-D10' }] });
  const t = h.enemies()[0];
  for (let i = 1; i <= 12; i++) {
    h.b.dealDamage({ source: h.unit(OP_ID), target: t, amount: 6e6, type: 'true', canDodge: false });
    assert.equal(t.alive, true, `第 ${i} 次致命伤害：还不退场`);
    assert.equal(t.hp, 1, `第 ${i} 次：血量停在 1`);
  }
  h.b.dealDamage({ source: h.unit(OP_ID), target: t, amount: 6e6, type: 'true', canDodge: false });
  assert.equal(t.alive, false, '第 13 次：彻底击败');
});

// =====================================================================================================================
// 我方负面（D12 / D13 / D14）

test('LC-D12 掌：入场 1 层，每 3 次技能 +1 层；到 3 层时自身眩晕 3 秒、全体敌方回复 2.5% 当前生命', () => {
  const h = field({ negs: [{ id: 'LC-D12' }] });
  const b = h.b;
  const op = h.unit(OP_ID);
  const e = h.enemies()[0];
  e.hp = 1e6;
  assert.equal(op.mem.olPalm, 1, '入场 1 层');
  for (let i = 1; i <= 3; i++) b.emit('skillStart', { unit: op });
  assert.equal(op.mem.olPalm, 2, '3 次技能 → 2 层（还没触发）');
  assert.equal(op.findBuff('stun'), null, '2 层时不眩晕');
  assert.equal(e.hp, 1e6, '2 层时不给敌人回血');
  for (let i = 1; i <= 3; i++) b.emit('skillStart', { unit: op });
  assert.equal(op.mem.olPalm, 0, '到 3 层触发后清零重新累计');
  assert.ok(op.findBuff('stun'), '自身眩晕 3 秒');
  near(op.findBuff('stun').timeLeft, 3, '眩晕时长 3 秒', 1e-3);
  near(e.hp, 1e6 * 1.025, '全体敌方回复 2.5% 当前生命', 1e-6);
});

test('LC-D13 噪音恐慌：每次部署后前三次技能造成的伤害固定为 1，第四次恢复', () => {
  const h = field({ negs: [{ id: 'LC-D13' }] });
  const b = h.b;
  const op = h.unit(OP_ID);
  const t = h.enemies()[0];
  // 第 1 次技能：技能伤害固定为 1
  b.emit('skillStart', { unit: op });
  near(hit(h, 1000, { isSkill: true }), 1, '第 1 次技能伤害 = 1', 1e-9);
  b.emit('skillStart', { unit: op });
  near(hit(h, 1000, { isSkill: true }), 1, '第 2 次技能伤害 = 1', 1e-9);
  b.emit('skillStart', { unit: op });
  near(hit(h, 1000, { isSkill: true }), 1, '第 3 次技能伤害 = 1', 1e-9);
  b.emit('skillStart', { unit: op });
  const fourth = hit(h, 1000, { isSkill: true });
  assert.ok(fourth > 1, `第 4 次技能恢复正常伤害（${fourth}）`);
  // 普攻不受影响
  const plain = field({ negs: [] });
  near(hit(h, 1000), hit(plain, 1000), '普攻两种局一样');
  // 治疗同样被定值（技能激活时的治疗）
  const h2 = field({ negs: [{ id: 'LC-D13' }] });
  const op2 = h2.unit(OP_ID);
  op2.hp = op2.s.maxHp - 500;
  op2.skill.active = true;
  h2.b.emit('skillStart', { unit: op2 });
  const healed = h2.b.heal(op2, op2, 400, { self: true });
  near(healed, 1, '第 1 次技能的治疗 = 1', 1e-9);
  assert.ok(t.alive);
});

test('LC-D14 葬花针：我方单位每秒受到最大生命值 2.5% 的无来源伤害', () => {
  const h = field({ negs: [{ id: 'LC-D14' }] });
  const op = h.unit(OP_ID);
  const maxHp = op.s.maxHp;
  h.run(2.2);
  const lost = maxHp - op.hp;
  assert.ok(lost >= maxHp * 0.025 * 2 - 1e-6, `2 秒掉两跳（${lost} ≥ ${maxHp * 0.05}）`);
  assert.ok(lost <= maxHp * 0.025 * 3 + 1e-6, `不会多跳（${lost} ≤ 3 跳）`);
  // 对照局：同样时间一点血都不掉
  const plain = field({ negs: [] });
  plain.run(2.2);
  near(plain.unit(OP_ID).hp, maxHp, '对照局满血');
});

// =====================================================================================================================
// 闪避（D15）

test('LC-D15 加速的未来：入场 100% 闪避，每受到 1 次伤害 −5%', () => {
  const h = field({ negs: [{ id: 'LC-D15' }] });
  const b = h.b;
  const t = h.enemies()[0];
  assert.equal(t.mem.olNegDodge, 1, '入场 100%');
  // 100% 闪避：必闪（rng 落在任何位置都闪）
  b.rng = () => 0.5;
  near(hit(h, 1000), 0, '第一次伤害被闪掉', 1e-9);
  assert.equal(t.mem.olNegDodge, 1, '闪掉的那次不算「受到伤害」，概率不变');
  // 必不闪（rng = 1）：打中 → 概率 −5%
  b.rng = () => 1;
  const first = hit(h, 1000);
  assert.ok(first > 0, '打中了');
  near(t.mem.olNegDodge, 0.95, '每受到 1 次伤害 −5%');
  // 0.9 < 0.95 → 闪；0.96 > 0.95 → 中
  b.rng = () => 0.9;
  near(hit(h, 1000), 0, '概率 95% 时 0.9 掷点闪掉', 1e-9);
  b.rng = () => 0.96;
  assert.ok(hit(h, 1000) > 0, '0.96 掷点打中');
  near(t.mem.olNegDodge, 0.9, '两次命中后剩 90%');
});

// =====================================================================================================================
// 害虫（D16A / D16B）

test('LC-D16A 攻击害虫：5 层、每层 +7.5% 造成的伤害；同时拥有防御害虫时层数翻倍', () => {
  const alone = field({ negs: [{ id: 'LC-D16A' }] }).enemies()[0];
  near(alone.s.dmgDealtMul, 1 + 0.075 * 5, '5 层 → +37.5%');
  assert.equal(alone.findBuff('overlimitNeg:pestAtk').stacks, 5, '层数挂成一条 buff（显示用）');
  const both = field({ negs: [{ id: 'LC-D16A' }, { id: 'LC-D16B' }] }).enemies()[0];
  near(both.s.dmgDealtMul, 1 + 0.075 * 10, '两者同时拥有 → 10 层 → +75%');
  assert.equal(both.findBuff('overlimitNeg:pestAtk').stacks, 10, '层数翻倍');
});

test('LC-D16B 防御害虫：5 层，每层抵消一次受到的负面效果；同时拥有攻击害虫时翻倍', () => {
  const h = field({ negs: [{ id: 'LC-D16B' }] });
  const t = h.enemies()[0];
  assert.equal(t.mem.olNegPest, 5, '入场 5 层');
  for (let i = 1; i <= 5; i++) {
    assert.equal(h.b.applyStatus(t, 'slow', { duration: 5 }), false, `第 ${i} 次负面被抵消`);
  }
  assert.equal(t.findBuff('slow'), null, '5 次都没挂上');
  assert.equal(t.mem.olNegPest, 0, '层数用光');
  assert.equal(h.b.applyStatus(t, 'slow', { duration: 5 }), true, '第 6 次正常生效');
  assert.ok(t.findBuff('slow'), '这一条负面挂上了');
  // 两者同时拥有：10 层
  const both = field({ negs: [{ id: 'LC-D16A' }, { id: 'LC-D16B' }] }).enemies()[0];
  assert.equal(both.mem.olNegPest, 10, '层数翻倍');
});

// =====================================================================================================================
// 一帧不变

test('不是超限局：带着负面词条列表也一个监听器都不挂、一点数值都不改', () => {
  const h = field({ negs: [{ id: 'LC-D02', tier: 2 }, { id: 'LC-D15' }, { id: 'LC-D14' }], flags: { overlimit: false } });
  const e = h.enemies()[0];
  const op = h.unit(OP_ID);
  near(e.s.maxHp, 5e6, '生命不变');
  near(e.s.atk, 100, '攻击不变');
  assert.equal(e.mem.olNegDodge, undefined, '没有闪避');
  assert.equal(e.findBuff('overlimitNeg:enemyStats'), null, '没有挂负面 buff');
  h.run(2.2);
  near(op.hp, op.s.maxHp, '葬花针不生效');
  // install 本身就是空操作（一个监听器都不多）
  const before = hookCounts(h.b);
  installNegative(h.b);
  assert.deepEqual(hookCounts(h.b), before, '非超限局：install 一个钩子都不加');
});

test('是超限局但一条负面词条都没选：同样不挂监听器', () => {
  const h = field({ negs: [] });
  const e = h.enemies()[0];
  near(e.s.maxHp, 5e6);
  assert.equal(e.mem.olNegDodge, undefined);
  assert.equal(e.findBuff('overlimitNeg:enemyStats'), null);
  const before = hookCounts(h.b);
  installNegative(h.b);
  assert.deepEqual(hookCounts(h.b), before, '空列表：install 一个钩子都不加');
});
