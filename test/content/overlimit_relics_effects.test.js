// test/content/overlimit_relics_effects.test.js — 超限模拟「词条」（饰品）第一批实装：战斗侧逐条数值（业主 2026-10-31 第二批）。
//
// 口径（与 docs/research/23-overlimit-relics.json 的效果文本一一对应）：
//   · 每条**至少一条带具体数值的断言**（伤害倍率 / 属性 / 层数 / 次数盾层数 / 技力）；
//   · 伤害一律用 `dealDamage({ amount: 1000 })` 打一只 5e6 血的木桩敌人：倍率可以写成具体数，不受干员白值影响；
//   · 对照局 = 同样的场、**一条词条都没有**（`ids: []`），所以断言的是「词条带来的那一份」；
//   · 随机项（暴击 / 20% 呼吸 / 10% 恐惧 / 50% 技力 / −50% 或 +150%）用 `b.rng = () => 0`（必中）或 `() => 0.9`（不中）
//     钉死，不依赖真实骰子；
//   · 普通 / 湮灭 / 炸惊一帧不变：`flags.overlimit` 为假时**一个监听器都不挂**（最后两条）。
//
// 每个词条的战斗侧落点写在对应 test 的名字里；整备侧（资金 / 免费刷新 / 价格 / 跨回合经费）在
// test/match/overlimit-relics.test.js。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { install as installOverlimitRelics, FGO_SP_ITEM } from '../../server/sim/content/overlimitRelics.js';
import { isMember, bondMembers, itemRecord } from '../../server/sim/content/support/index.js';
import { isShopItem } from '../../server/sim/simdata.js';

const OP_ID = 'ol_op_a';
const ENEMY = 'ol_enemy';

/** 测试干员：atk 1000 / maxHp 10000 / def 100 / res 10 / 技力回复 1；技力上限 1000（一场里不会自动开技能）。 */
const opRec = (over = {}) => chessRec({
  id: OP_ID, baseId: OP_ID, profession: 'WARRIOR',
  stats: { atk: 1000, maxHp: 10000, def: 100, res: 10, blockCnt: 2, bat: 2, aspd: 100, spRecovery: 1, cost: 0, moveSpeed: 1 },
  skill: { spCost: 1000, initSp: 0, durationType: 'NONE' },
  ...over,
});

/** 木桩敌人：def 100 / res 0 / 不移动 / 不打人 / 5e6 血。 */
const enemyOf = (over = {}) => enemyRec({ key: ENEMY, rank: 'NORMAL', hp: 5e6, def: 100, res: 0, atk: 0, speed: 0, ...over });

/**
 * 一个超限局的战场：一名玩家、一名测试干员、一只木桩敌人。
 * `items` = 挂在测试干员身上的装备 id（FGO-SP 的[万色悠滞之核]要靠它，「携带者」就是 `unit.items` 里带着它）。
 * @param {{ ids?: string[], at?: number, round?: number, seed?: number, flags?: any, enemy?: any, enemyKey?: string,
 *   items?: string[], player?: any }} [o]
 */
function field(o = {}) {
  const ids = o.ids ?? [];
  const at = o.at ?? 1;
  const enemyKey = o.enemyKey ?? ENEMY;
  const units = [{ chessId: OP_ID, kind: 'chess', col: 5, row: 10, ...(o.items ? { items: o.items } : {}) }];
  const h = makeBattle({
    seed: o.seed ?? 7, kind: 'normal', round: o.round ?? 3, units, enemies: [], timeLimit: 60, autoFinish: false,
    flags: { overlimit: true, ...(o.flags || {}) },
    defs: { chess: { [OP_ID]: opRec() }, enemies: { [ENEMY]: o.enemy ?? enemyOf(), ol_elite: enemyOf({ key: 'ol_elite', rank: 'ELITE' }), ol_boss: enemyOf({ key: 'ol_boss', rank: 'BOSS' }), ol_immune: enemyOf({ key: 'ol_immune', immunities: { stun: true } }) } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: units.map((u, i) => ({ uid: i + 1, kind: 'chess', chessId: u.chessId, row: u.row, col: u.col, ...(u.items ? { items: u.items } : {}) })),
      bonds: {}, bandId: null, playerEffects: [],
      ...(ids.length ? { relicsOverlimit: ids.map((id) => ({ id, at })) } : {}),
      ...(o.player || {}),
    }],
  });
  h.step();                       // 开局部署
  h.spawn(enemyKey, { pos: [9, 6] });   // 木桩敌人：不在干员攻击范围内，也不动
  return h;
}

/** 打一次木桩，返回真实扣血量。 */
function hit(h, { amount = 1000, type = 'phys', isAttack = true, isSkill = false, target = null } = {}) {
  const b = h.b;
  const t = target ?? h.enemies()[0];
  const src = h.unit(OP_ID);
  const before = t.hp;
  b.dealDamage({ source: src, target: t, amount, type, isAttack, isSkill, canDodge: false });
  return before - t.hp;
}

/** 一名干员身上的某个 buff 的 mods（没有就是 null）。 */
const modsOf = (u, key) => {
  const b = u.findBuff(key);
  return b ? b.mods : null;
};
/** 本文件的 buff 键 = `overlimit:<playerId>:<名字>`。 */
const buffMods = (u, name) => modsOf(u, `overlimit:p1:${name}`);

/** 同一发伤害在「没有任何词条」的对照局里的扣血量。 */
function baseHit(opts = {}) {
  const c = field({ ids: [] });
  return hit(c, opts);
}

// ---------------------------------------------------------------------------------------------------------------------
// LC 组

test('LC-001 竟然是炎鳞？！：[灼燃爆发]期间我方伤害按 50% 累积，爆发结束一次性结算无来源[烧伤]法术伤害（封顶 9999 万）且防御 −15%', () => {
  const h = field({ ids: ['LC-001'] });
  const t = h.enemies()[0];
  // 手动进入[灼燃爆发]（正常路径是灼燃槽满：attack/element.js 挂一条 10 秒的 burnBurst）
  h.b.addBuff(t, { key: 'burnBurst', duration: 10, flags: { burstLock: true } });
  const dmg = hit(h);                       // 900 本伤
  hit(h);                                   // 再 900
  assert.equal(dmg, baseHit(), '爆发期间的这两下本身不被改');
  assert.ok(t.findBuff('overlimit:lc001-pool'), '有一份记分池');
  // 累积 = 50% × 1800 = 900；爆发结束（10 秒）一次性结算
  const before = t.hp;
  h.run(10.5);
  const settled = before - t.hp;
  assert.ok(Math.abs(settled - 900) < 1e-6, `爆发结束结算 900（实际 ${settled}）`);
  assert.ok(Math.abs(t.s.def - 85) < 1e-9, `防御 100 → 85（−15%），实际 ${t.s.def}`);
  // 封顶 9999 万：池子 1 亿 → 只结算 99,990,000
  const big = field({ ids: ['LC-001'], enemy: enemyOf({ hp: 1e9, def: 0 }) });
  const bt = big.enemies()[0];
  big.b.addBuff(bt, { key: 'burnBurst', duration: 10, flags: { burstLock: true } });
  big.b.dealDamage({ source: big.unit(OP_ID), target: bt, amount: 2e8, type: 'phys', canDodge: false });
  const afterHit = bt.hp;
  big.run(10.5);
  assert.ok(Math.abs((afterHit - bt.hp) - 99_990_000) < 1, `封顶 9999 万（实际 ${afterHit - bt.hp}）`);
});

test('LC-003 要不要来杯震颤爆发？：每施加 1 个负面 → [震颤] +1 层，满 20 层爆一次（防御 −30%、法抗 −20、受伤 +10%），最多 5 层', () => {
  const h = field({ ids: ['LC-003'], enemy: enemyOf({ res: 30 }) });
  const t = h.enemies()[0];
  const u = h.unit(OP_ID);
  const debuff = () => h.b.applyStatus(t, 'slow', { duration: 30, value: 0.5, source: u });
  for (let i = 0; i < 19; i++) debuff();
  assert.equal(t.findBuff('overlimit:tremor').stacks, 19, '19 层还没爆');
  assert.equal(t.findBuff('overlimit:tremorBurst'), null, '没爆之前没有[震颤爆发]');
  assert.equal(t.s.def, 100, '没爆之前防御不变');
  debuff();                                  // 第 20 层 → 爆发
  assert.equal(t.findBuff('overlimit:tremor').stacks, 0, '爆完清空层数');
  const burst = t.findBuff('overlimit:tremorBurst');
  assert.equal(burst.stacks, 1, '1 层[震颤爆发]');
  assert.ok(Math.abs(t.s.def - 70) < 1e-9, `防御 100 → 70（−30%），实际 ${t.s.def}`);
  assert.equal(burst.mods.resFlat, -20, '每层法抗 −20');
  assert.ok(Math.abs(t.s.res - 10) < 1e-9, `法抗 30 → 10，实际 ${t.s.res}`);
  assert.ok(Math.abs(hit(h) - (1000 - 70) * 1.1) < 1e-9, '受到伤害 +10%（防御已 −30%：930 × 1.1）');
  // 最多 5 层：再来 4 轮 20 层
  for (let r = 0; r < 4; r++) for (let i = 0; i < 20; i++) debuff();
  assert.equal(t.findBuff('overlimit:tremorBurst').stacks, 5, '最多 5 层');
  assert.ok(Math.abs(burst.mods.dmgTakenMul ** 5 - 1.1 ** 5) < 1e-12, '每层 +10% 相乘');
  assert.ok(Math.abs(t.s.dmgTakenMul - 1.1 ** 5) < 1e-9, `5 层 → 承伤 ×1.61051（实际 ${t.s.dmgTakenMul}）`);
  assert.equal(t.s.res, 0, '5 层法抗 −100 → 夹到 0');
});

test('LC-002 红绵花不是白棉花：每次造成伤害后叠 1 层[流血]（最多 5 层），每层防御 −20%，20 秒内共造成该次伤害 15%', () => {
  const h = field({ ids: ['LC-002'] });
  const t = h.enemies()[0];
  const dmg = hit(h);
  assert.equal(dmg, baseHit(), '这一下本身不该被改');
  const buff = t.findBuff('overlimit:bleed');
  assert.ok(buff, '目标身上有[流血]');
  assert.equal(buff.stacks ?? 1, 1, '1 层');
  assert.ok(Math.abs(t.s.def - 80) < 1e-9, `防御 100 → 80（−20%），实际 ${t.s.def}`);
  // 再打一下 → 2 层，防御 −40%
  hit(h);
  assert.ok(Math.abs(t.s.def - 60) < 1e-9, `2 层 → 防御 60，实际 ${t.s.def}`);
  // 20 秒的流血总量：两层各 15% × 900 = 135，合计 270（±6%，按 1 秒一跳、20 跳）
  const before = t.hp;
  h.run(20.5);
  const bleed = before - t.hp;
  assert.ok(Math.abs(bleed - 270) <= 0.06 * 270, `20 秒流血总量 ≈ 270，实际 ${bleed}`);
  // 最多 5 层：再打 10 下也只有 5 层
  for (let i = 0; i < 10; i++) hit(h);
  assert.equal(h.enemies()[0].buffs.filter((b) => b.key === 'overlimit:bleed').length, 5, '同目标最多 5 层');
});

test('LC-004 你是纯沉沦饰品吗？对带负面的目标 +50%（施加负面的技能再 +10%）；免疫负面时改 30% 独立乘区', () => {
  const h = field({ ids: ['LC-004'] });
  const t = h.enemies()[0];
  const u = h.unit(OP_ID);
  const base = baseHit();
  assert.ok(Math.abs(hit(h) - base) < 1e-9, '没有负面效果：原样');
  h.b.applyStatus(t, 'slow', { duration: 30, value: 0.5, source: u });
  assert.ok(Math.abs(hit(h) - base * 1.5) < 1e-9, '+50%');
  // 施加负面的是「自己」→ 技能伤害再 ×1.1
  assert.ok(Math.abs(hit(h, { isSkill: true }) - base * 1.5 * 1.1) < 1e-9, '施加负面的技能额外 +10%');
  // 免疫负面的目标：改 30%
  const him = field({ ids: ['LC-004'], enemyKey: 'ol_immune' });
  assert.ok(Math.abs(hit(him) - base * 1.3) < 1e-9, '目标免疫负面效果 → 30% 独立乘区');
});

test('LC-005 明！镜！止！水！：20% 概率 +1 层呼吸（每层暴击率 +15%，最多 5 层），暴击时该次 +70% 并清空', () => {
  const h = field({ ids: ['LC-005'] });
  const u = h.unit(OP_ID);
  // 每次伤害用掉的骰子：暴击掷骰只在暴击率 > 0 时发生（0 层时没有），呼吸掷骰每下都有。
  // 所以第一下只喂一个 0（必中呼吸），之后每下喂 [0.99（不暴击）, 0（必中呼吸）]。
  const q = [];
  h.b.rng = () => (q.length ? q.shift() : 0.99);
  q.push(0); hit(h);
  assert.equal(u.mem.olBreath, 1, '1 层呼吸');
  assert.ok(Math.abs(buffMods(u, 'breath').critRate - 0.15) < 1e-9, '每层暴击率 +15%');
  for (let i = 0; i < 4; i++) { q.push(0.99, 0); hit(h); } // 1 → 5 层刚好四下
  assert.equal(u.mem.olBreath, 5, '最多 5 层');
  assert.ok(Math.abs(buffMods(u, 'breath').critRate - 0.75) < 1e-9, '5 层 = +75% 暴击率');
  // 再来一下：触发暴击 → 该次 +70%，并清空层数（rng 恒 0：75% 暴击率必中）
  h.b.rng = () => 0;
  const crit = hit(h);
  assert.ok(Math.abs(crit - baseHit() * 2 * 1.7) < 1e-9, `暴击 ×2 且该次 +70%（${crit}）`);
  assert.equal(u.mem.olBreath, 0, '暴击后清空全部层数');
});

test('LC-006 你是哪位？：每次释放技能 +1 层充能，每满 10 层伤害 +10%、技力回复 +0.1，最多 100 层', () => {
  const h = field({ ids: ['LC-006'] });
  const u = h.unit(OP_ID);
  const cast = () => h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
  for (let i = 0; i < 9; i++) cast();
  assert.equal(u.mem.olCharge, 9);
  assert.equal(buffMods(u, 'charge'), null, '不满 10 层还没有加成');
  cast();
  assert.ok(Math.abs(buffMods(u, 'charge').dmgDealtMul - 1.1) < 1e-9, '满 10 层 → 伤害 +10%');
  assert.ok(Math.abs(buffMods(u, 'charge').spRecoveryFlat - 0.1) < 1e-9, '满 10 层 → 技力回复 +0.1');
  assert.ok(Math.abs(hit(h) - baseHit() * 1.1) < 1e-9, '打出伤害 ×1.1');
  for (let i = 0; i < 110; i++) cast();
  assert.equal(u.mem.olCharge, 100, '最多 100 层');
  assert.ok(Math.abs(buffMods(u, 'charge').dmgDealtMul - 2) < 1e-9, '100 层 = +100% 伤害');
  assert.ok(Math.abs(buffMods(u, 'charge').spRecoveryFlat - 1) < 1e-9, '100 层 = 技力回复 +1.0');
});

test('LC-007 可还记得曾经的他：敌方入场 15 层[破裂]，每次造成伤害消耗 1 层并追加 本次伤害 × 2% × 层数 的无来源真伤', () => {
  const h = field({ ids: ['LC-007'] });
  const t = h.enemies()[0];
  assert.equal(t.findBuff('overlimit:rupture').stacks, 15, '入场 15 层');
  const base = baseHit();
  const dmg = hit(h);                                  // 900 本伤 + 900 × 2% × 15 = 270
  assert.ok(Math.abs(dmg - (base + base * 0.02 * 15)) < 1e-9, `追加 30%（${dmg}）`);
  assert.equal(h.enemies()[0].findBuff('overlimit:rupture').stacks, 14, '消耗 1 层');
  // 第 2 下按 14 层算
  const second = hit(h);
  assert.ok(Math.abs(second - (base + base * 0.02 * 14)) < 1e-9, '按消耗前的层数结算');
});

// ---------------------------------------------------------------------------------------------------------------------
// LC-SP 组

test('LC-SP1 WOC，是⚪神：攻击/防御 +30%、法抗 +20、生命 +40%', () => {
  const h = field({ ids: ['LC-SP1'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.3) < 1e-6, '攻击力 +30%');
  assert.ok(Math.abs(u.s.def - c.s.def * 1.3) < 1e-6, '防御力 +30%');
  assert.ok(Math.abs(u.s.res - (c.s.res + 20)) < 1e-9, '法抗 +20');
  assert.ok(Math.abs(u.s.maxHp - c.s.maxHp * 1.4) < 1e-6, '生命值 +40%');
});

test('LC-SP2 ALL，or Nothing！：每次攻击造成的伤害随机 −50% 或 +150%', () => {
  const h = field({ ids: ['LC-SP2'] });
  const base = baseHit();
  h.b.rng = () => 0.1;             // < 0.5 → −50%
  assert.ok(Math.abs(hit(h) - base * 0.5) < 1e-9, '−50%');
  h.b.rng = () => 0.9;             // ≥ 0.5 → +150%
  assert.ok(Math.abs(hit(h) - base * 2.5) < 1e-9, '+150%');
});

test('LC-SP3 悲伤小金.jpg：伤害 +50%、20% 暴击率、暴击时该次 +50%、受到伤害 −20%', () => {
  const h = field({ ids: ['LC-SP3'] });
  const u = h.unit(OP_ID);
  const base = baseHit();
  assert.ok(Math.abs(buffMods(u, 'crit').critRate - 0.2) < 1e-9, '20% 常态暴击率');
  assert.ok(Math.abs(u.s.dmgTakenMul - 0.8) < 1e-9, '受到伤害 −20%');
  h.b.rng = () => 0.9;             // 不暴击
  assert.ok(Math.abs(hit(h) - base * 1.5) < 1e-9, '伤害 +50%');
  h.b.rng = () => 0;               // 必暴击
  assert.ok(Math.abs(hit(h) - base * 1.5 * 2 * 1.5) < 1e-9, '暴击 ×2 且该次再 +50%');
});

test('LC-SP4 战斗，爽！：火力/易损各 2 层、每回合 +1（各至多 10 层），火力 +15%/层、易损 +20%/层', () => {
  const at = 3;
  const two = field({ ids: ['LC-SP4'], at, round: at });
  const u2 = two.unit(OP_ID);
  assert.ok(Math.abs(u2.s.dmgDealtMul - (1 + 0.15 * 2)) < 1e-9, '获得时 2 层火力 → 伤害 +30%');
  assert.ok(Math.abs(u2.s.dmgTakenMul - (1 + 0.2 * 2)) < 1e-9, '获得时 2 层易损 → 承伤 +40%');
  const later = field({ ids: ['LC-SP4'], at, round: at + 5 });
  const u5 = later.unit(OP_ID);
  assert.ok(Math.abs(u5.s.dmgDealtMul - (1 + 0.15 * 7)) < 1e-9, '5 回合后 7 层火力 → ×2.05');
  assert.ok(Math.abs(u5.s.dmgTakenMul - (1 + 0.2 * 7)) < 1e-9, '5 回合后 7 层易损 → ×2.4');
  const capped = field({ ids: ['LC-SP4'], at, round: at + 40 });
  assert.ok(Math.abs(capped.unit(OP_ID).s.dmgDealtMul - 2.5) < 1e-9, '至多 10 层 → ×2.5');
  assert.ok(Math.abs(capped.unit(OP_ID).s.dmgTakenMul - 3) < 1e-9, '至多 10 层 → 承伤 ×3');
});

test('LC-SP5 不，还是先苟住吧：生命值 +回合数 × 5%、攻击力 +15%', () => {
  const h = field({ ids: ['LC-SP5'], round: 6 });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.maxHp - c.s.maxHp * 1.3) < 1e-6, 'R6：生命 +30%（6 × 5%）');
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.15) < 1e-6, '攻击力 +15%');
});

test('LC-SP6 我回来了，我就没走：首次被击倒立即重新部署并 +50% 攻击 10 秒，只触发一次', () => {
  const h = field({ ids: ['LC-SP6'] });
  const u = h.unit(OP_ID);
  const seq = u.deploySeq;
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, true, '被击倒后立刻重新部署');
  assert.ok(u.deploySeq > seq, '确实重新部署了（deploySeq 变了）');
  const buff = u.findBuff('overlimit:p1:sp6-atk');
  assert.ok(buff && Math.abs(buff.mods.atkPct - 0.5) < 1e-9, '10 秒 +50% 攻击');
  assert.ok(Math.abs(buff.duration - 10) < 1e-9, '持续 10 秒');
  // 第二次被击倒：不再触发
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, false, '只触发一次');
});

test('LC-SP7 叠层困难的来：每次使用技能后 +2 层[禅那]，每层 +1% 伤害（最高 108 层）', () => {
  const h = field({ ids: ['LC-SP7'] });
  const u = h.unit(OP_ID);
  const cast = () => h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
  for (let i = 0; i < 3; i++) cast();
  assert.equal(u.mem.olDhyana, 6, '3 次技能 = 6 层');
  assert.ok(Math.abs(buffMods(u, 'dhyana').dmgDealtMul - 1.06) < 1e-9, '6 层 = +6% 伤害');
  for (let i = 0; i < 60; i++) cast();
  assert.equal(u.mem.olDhyana, 108, '最高 108 层');
  assert.ok(Math.abs(buffMods(u, 'dhyana').dmgDealtMul - 2.08) < 1e-9, '108 层 = +108% 伤害');
});

// ---------------------------------------------------------------------------------------------------------------------
// LC-EX 组

test('LC-EX1 凤·皇：每拥有一件饰品，我方造成的伤害 +15%（含它自己）', () => {
  const one = field({ ids: ['LC-EX1'] });
  assert.ok(Math.abs(one.unit(OP_ID).s.dmgDealtMul - 1.15) < 1e-9, '1 件 → ×1.15');
  const three = field({ ids: ['LC-EX1', 'LC-SP1', 'LC-006'] });
  assert.ok(Math.abs(three.unit(OP_ID).s.dmgDealtMul - 1.45) < 1e-9, '3 件 → ×1.45');
});

test('LC-EX2 YJ就是YJ咯：物理/法术伤害变为弱点伤害，且伤害 +225%', () => {
  const h = field({ ids: ['LC-EX2'] });
  const seen = [];
  h.b.on('hit', (c) => { if (c && c.dmg && c.source && c.target && c.target.side === 'enemy') seen.push(c.dmg.type); }, { priority: -1000 });
  // 木桩 def 100 / res 0：法术伤害更高 → 被改写成 arts
  const dmg = hit(h);
  assert.equal(seen.at(-1), 'arts', '物理伤害被改写成弱点（arts）');
  assert.ok(Math.abs(dmg - 1000 * 3.25) < 1e-6, `伤害 ×3.25（${dmg}）`);
});

test('LC-EX4 某种哲学：真的没有效果（一条 buff / 一次伤害都不改）', () => {
  const h = field({ ids: ['LC-EX4'] });
  const c = field({ ids: [] });
  assert.equal(h.unit(OP_ID).buffs.length, c.unit(OP_ID).buffs.length, '不多挂一条 buff');
  assert.ok(Math.abs(hit(h) - hit(c)) < 1e-9, '伤害原样');
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
});

// ---------------------------------------------------------------------------------------------------------------------
// FGO 组

test('FGO-02 水天日光天照八野鎮石：攻击 +80%、防御 +30%、部署后初始技力 +20', () => {
  const h = field({ ids: ['FGO-02'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.8) < 1e-6, '攻击力 +80%');
  assert.ok(Math.abs(u.s.def - c.s.def * 1.3) < 1e-6, '防御力 +30%');
  // 部署时那一发（开局 deploy 只给一次；首帧还会走一小格技力回复，所以按 < 0.1 夹）
  assert.ok(u.skill.sp >= 20 - 1e-9 && u.skill.sp < 20.1, `部署后初始技力 +20（实际 ${u.skill.sp}）`);
});

test('FGO-04 第一の太陽：部署 2 层次数盾、攻击 +30%、技力回复 +0.3、技能伤害 +30%', () => {
  const h = field({ ids: ['FGO-04'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  const shield = u.findBuff('overlimit:p1:shield-fgo04');
  assert.ok(shield, '部署时拿到了次数盾');
  assert.equal(shield.shieldHits, 2, '2 层');
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.3) < 1e-6, '攻击力 +30%');
  assert.ok(Math.abs(u.s.spRecovery - (c.s.spRecovery + 0.3)) < 1e-9, '技力回复 +0.3');
  assert.ok(Math.abs(hit(h, { isSkill: true }) - baseHit({ isSkill: true }) * 1.3) < 1e-9, '技能伤害 +30%');
});

test('FGO-05 抱き融す黄金劇場：20% 暴击率、暴击 180%、每回合免疫首次负面、受到伤害 −20%', () => {
  const h = field({ ids: ['FGO-05'] });
  const u = h.unit(OP_ID);
  assert.ok(Math.abs(buffMods(u, 'crit').critRate - 0.2) < 1e-9, '20% 暴击率');
  assert.ok(Math.abs(u.s.dmgTakenMul - 0.8) < 1e-9, '受到伤害 −20%');
  h.b.rng = () => 0;               // 必暴击
  assert.ok(Math.abs(hit(h) - baseHit() * 1.8) < 1e-9, '暴击伤害 180%');
  // 每回合免疫首次受到的负面效果
  assert.equal(h.b.applyStatus(u, 'fear', { duration: 5 }), false, '第一次负面被免疫');
  assert.equal(h.b.applyStatus(u, 'fear', { duration: 5 }), true, '同一回合的第二次照常生效');
});

test('FGO-07 始皇帝：攻击 +100%、无视 20% 防御与法抗、每秒回复 1% 最大生命', () => {
  const h = field({ ids: ['FGO-07'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 2) < 1e-6, '攻击力 +100%');
  assert.ok(Math.abs(u.s.defIgnorePct - 0.2) < 1e-9, '无视 20% 防御');
  assert.ok(Math.abs(u.s.resIgnorePct - 0.2) < 1e-9, '无视 20% 法抗');
  assert.ok(Math.abs(u.s.hpRegen - u.s.maxHp * 0.01) < 1e-6, '每秒 1% 最大生命');
  // 无视 20% 防御：木桩 def 100 → 按 80 算
  assert.ok(Math.abs(hit(h) - (1000 - 80)) < 1e-6, '伤害按 def 80 结算');
});

test('FGO-08 第七聖典・断罪死：无视闪避、无视 50% 防御法抗、防御 +100%，有其它暴击饰品时暴伤 +100%', () => {
  const h = field({ ids: ['FGO-08'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.def - c.s.def * 2) < 1e-6, '防御力 +100%');
  assert.ok(Math.abs(u.s.defIgnorePct - 0.5) < 1e-9 && Math.abs(u.s.resIgnorePct - 0.5) < 1e-9, '无视 50%');
  assert.ok(Math.abs(hit(h) - (1000 - 50)) < 1e-6, '伤害按 def 50 结算');
  // 无视闪避：dodgeMode 被置成 ignore
  const seen = [];
  h.b.on('hit', (ctx) => { if (ctx && ctx.source && ctx.source.defId === OP_ID) seen.push(ctx.dmg.dodgeMode); }, { priority: -1000 });
  hit(h);
  assert.equal(seen.at(-1), 'ignore', '无视闪避');
  // 有其它提高暴击率的饰品：暴伤 2 + 1 = 3 → 一次暴击 ×3（木桩 def 100 被无视 50% → 本伤 950）
  const withCrit = field({ ids: ['FGO-08', 'FGO-12'] });
  withCrit.b.rng = () => 0;
  assert.ok(Math.abs(hit(withCrit) - (1000 - 50) * 3) < 1e-9, '暴伤 +100%（×3）');
});

test('FGO-11 虚妄は闇の娘：攻击 +30%、10% 概率恐惧、对恐惧目标伤害 +100%', () => {
  const h = field({ ids: ['FGO-11'] });
  const u = h.unit(OP_ID);
  const t = h.enemies()[0];
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.3) < 1e-6, '攻击力 +30%');
  h.b.rng = () => 0;               // 10% 恐惧必中
  h.b.emit('attack', { attacker: u, targets: [t], isSkill: false });
  assert.equal(t.s.flags.fear, true, '恐惧生效');
  assert.ok(Math.abs(hit(h) - baseHit() * 2) < 1e-9, '对恐惧目标 +100%');
});

test('FGO-12 霊裳重光・79式擲禍大社：暴击率 +40%、普攻 50% 回 1 技力、对精英 +40% 最终增伤', () => {
  const h = field({ ids: ['FGO-12'] });
  const u = h.unit(OP_ID);
  assert.ok(Math.abs(buffMods(u, 'crit').critRate - 0.4) < 1e-9, '暴击率 +40%');
  const sp0 = u.skill.sp;
  h.b.rng = () => 0;               // 50% 必中
  h.b.emit('attack', { attacker: u, targets: [h.enemies()[0]], isSkill: false });
  assert.ok(u.skill.sp >= sp0 + 1 - 1e-9, `普攻回 1 技力（${sp0} → ${u.skill.sp}）`);
  // 对精英 +40%：换成 ELITE 木桩
  const elite = field({ ids: ['FGO-12'], enemyKey: 'ol_elite' });
  elite.b.rng = () => 0.9;         // 不暴击
  const base = (() => { const c = field({ ids: [], enemyKey: 'ol_elite' }); c.b.rng = () => 0.9; return hit(c); })();
  assert.ok(Math.abs(hit(elite) - base * 1.4) < 1e-9, '对精英 +40%');
});

test('FGO-14 彼方に手まねく理想郷：部署 2 层次数盾、生命 +8000、攻击 +20%', () => {
  const h = field({ ids: ['FGO-14'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.equal(u.findBuff('overlimit:p1:shield-fgo14').shieldHits, 2, '部署 2 层次数盾');
  assert.ok(Math.abs(u.s.maxHp - (c.s.maxHp + 8000)) < 1e-6, '生命值 +8000');
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.2) < 1e-6, '攻击力 +20%');
});

test('FGO-15 きみをいだく希望の星：每次技能后技力回复 +0.1；超过原速两倍时攻击 +50%、技能伤害 +50%', () => {
  const h = field({ ids: ['FGO-15'] });
  const u = h.unit(OP_ID);
  const cast = () => h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
  for (let i = 0; i < 6; i++) cast();
  assert.ok(Math.abs(u.s.spRecovery - 1.6) < 1e-9, `6 次 = 原速 1 + 0.6（${u.s.spRecovery}）`);
  assert.equal(buffMods(u, 'sp15-boost'), null, '还没到两倍：没有攻击加成');
  for (let i = 0; i < 5; i++) cast();
  assert.ok(Math.abs(u.s.spRecovery - 2.1) < 1e-9, '11 次 = 2.1，超过原速两倍');
  assert.ok(Math.abs(buffMods(u, 'sp15-boost').atkPct - 0.5) < 1e-9, '攻击力 +50%');
  assert.ok(Math.abs(hit(h, { isSkill: true }) - baseHit({ isSkill: true }) * 1.5) < 1e-9, '技能伤害 +50%');
});

test('FGO-16 宿願接ぐ希望の剣：技力消耗 −20%、无视闪避、伤害 +50%、被攻击的敌 10 秒内受伤 +50%（不可叠加）', () => {
  const h = field({ ids: ['FGO-16'] });
  const u = h.unit(OP_ID);
  const t = h.enemies()[0];
  assert.equal(u.skill.spCost, 800, `技力消耗 −20%（1000 → 800，实际 ${u.skill.spCost}）`);
  assert.ok(Math.abs(hit(h) - baseHit() * 1.5) < 1e-9, '伤害 +50%');
  // 被攻击的敌方：10 秒内受到伤害 +50%（一次攻击挂一次，刷新而不叠加）
  h.b.emit('attack', { attacker: u, targets: [t], isSkill: false });
  const fragile = t.findBuff('overlimit:fgo16-fragile');
  assert.ok(fragile && Math.abs(fragile.mods.dmgTakenMul - 1.5) < 1e-9, '目标受伤 +50%');
  assert.ok(Math.abs(fragile.duration - 10) < 1e-9, '持续 10 秒');
  assert.ok(Math.abs(hit(h) - baseHit() * 1.5 * 1.5) < 1e-9, '易伤再乘 1.5');
  h.b.emit('attack', { attacker: u, targets: [t], isSkill: false });
  assert.equal(t.buffs.filter((b) => b.key === 'overlimit:fgo16-fragile').length, 1, '不可叠加（还是一条）');
});

test('FGO-17 すでに過ぎし人理の終：部署时技力回满、攻击 +40%、技能伤害 +30%，有其它暴击饰品时暴伤 +50%', () => {
  const h = field({ ids: ['FGO-17'] });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.skill.sp - u.skill.spCost) < 1e-9, `部署时技力回满（${u.skill.sp}/${u.skill.spCost}）`);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.4) < 1e-6, '攻击力 +40%');
  assert.ok(Math.abs(hit(h, { isSkill: true }) - baseHit({ isSkill: true }) * 1.3) < 1e-9, '技能伤害 +30%');
  const withCrit = field({ ids: ['FGO-17', 'FGO-12'] });
  withCrit.b.rng = () => 0;
  assert.ok(Math.abs(hit(withCrit) - baseHit() * 2.5) < 1e-9, '暴伤 +50%（×2.5）');
});

test('FGO-Ⅹ 希望証す人理の剣：[人类的威胁] 使伤害变真伤、攻击 +40%、每个其它暴击饰品暴伤 +40%', () => {
  const h = field({ ids: ['FGO_X'] });
  const u = h.unit(OP_ID);
  const t = h.enemies()[0];
  const c = field({ ids: [] }).unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - c.s.atk * 1.4) < 1e-6, '攻击力 +40%');
  assert.ok(t.findBuff('overlimit:humanThreat'), '全体敌方持有[人类的威胁]');
  assert.ok(Math.abs(hit(h) - 1000) < 1e-6, '真实伤害：不打防御（1000 而不是 900）');
  // 每个其它暴击饰品 +40% 暴伤：2 + 0.4 = 2.4（真伤 1000，不受防御影响）
  const one = field({ ids: ['FGO_X', 'FGO-12'] });
  one.b.rng = () => 0;
  assert.ok(Math.abs(hit(one) - 1000 * (2 + 0.4)) < 1e-9, '暴伤 ×2.4');
  // 两个其它暴击饰品：2 + 0.8 = 2.8；LC-SP3 另有「伤害 +50%」与「暴击时该次 +50%」
  const two = field({ ids: ['FGO_X', 'FGO-12', 'LC-SP3'] });
  two.b.rng = () => 0;
  assert.ok(Math.abs(hit(two) - 1000 * 1.5 * (2 + 0.8) * 1.5) < 1e-9, '暴伤 ×2.8（另有 LC-SP3 的两条 +50%）');
});

test('FGO-01 旧き過去を紡ぐ糸：全体敌方[篡改过去]、攻击 +30%、对其伤害 +50%、每次技能后返还 20% 技力', () => {
  const h = field({ ids: ['FGO-01'] });
  const t = h.enemies()[0];
  const u = h.unit(OP_ID);
  assert.ok(t.findBuff('overlimit:pastTamper'), '全体敌方持有[篡改过去]');
  assert.ok(Math.abs(u.s.atk - 1300) < 1e-6, `攻击 1000 → 1300，实际 ${u.s.atk}`);
  assert.ok(Math.abs(hit(h) - baseHit() * 1.5) < 1e-9, '对其伤害 +50%');
  // 技能后返还 20% 技力：消耗 1000 → 返还 200
  u.skill.sp = 0;
  h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
  assert.ok(Math.abs(u.skill.sp - 200) < 1e-9, `返还 200 技力（实际 ${u.skill.sp}）`);
});

test('FGO-03 死告天使：[死之渊]攻击 +70%，首次被击倒立刻重新部署并清除这一场（= 这一回合）的状态', () => {
  const h = field({ ids: ['FGO-03'] });
  const u = h.unit(OP_ID);
  assert.ok(u.findBuff('overlimit:p1:abyss'), '我方持有[死之渊]');
  assert.ok(Math.abs(u.s.atk - 1700) < 1e-6, `攻击 1000 → 1700，实际 ${u.s.atk}`);
  const seq = u.deploySeq;
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, true, '被击倒后立刻重新部署');
  assert.ok(u.deploySeq > seq, '确实重新部署了');
  assert.equal(u.findBuff('overlimit:p1:abyss'), null, '[死之渊]被清除');
  assert.ok(Math.abs(u.s.atk - 1000) < 1e-6, `攻击回到 1000（实际 ${u.s.atk}）`);
  // 第二次被击倒：这一场不再触发
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, false, '一场只触发一次');
});

test('FGO-03 + LC-SP6：死之渊（death 11.6）先复活，LC-SP6（11.5）这一次不消耗', () => {
  const h = field({ ids: ['FGO-03', 'LC-SP6'] });
  const u = h.unit(OP_ID);
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, true, '活了');
  assert.equal(u.mem.olAbyssUsed, true, 'FGO-03 先跑');
  assert.equal(u.mem.olSp6Used, undefined, 'LC-SP6 没被消耗');
  assert.equal(u.findBuff('overlimit:p1:sp6-atk'), null, '也没有 +50% 攻击那一层');
  // 第二次被击倒：LC-SP6 接过这一棒
  h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true', canDodge: false });
  assert.equal(u.alive, true, 'LC-SP6 复活');
  assert.equal(u.mem.olSp6Used, true, 'LC-SP6 用掉了');
});

test('FGO-06 貫き穿つ死翔の槍：普通 5% / 精英 2.5% 直接斩杀（Boss 不触发）、普攻 50% 回 1 技力、有其它暴击饰品时暴伤 +50%', () => {
  // 普通敌 5%：4% 中、6% 不中
  const kill5 = field({ ids: ['FGO-06'] });
  const t5 = kill5.enemies()[0];
  kill5.b.rng = () => 0.04;
  hit(kill5);
  assert.equal(t5.alive, false, '普通敌 4% < 5% → 直接斩杀');
  const miss5 = field({ ids: ['FGO-06'] });
  const m5 = miss5.enemies()[0];
  miss5.b.rng = () => 0.06;
  hit(miss5);
  assert.equal(m5.alive, true, '普通敌 6% > 5% → 不斩杀');
  // 精英 2.5%：3% 不中、2% 中
  const miss25 = field({ ids: ['FGO-06'], enemyKey: 'ol_elite' });
  const m25 = miss25.enemies()[0];
  miss25.b.rng = () => 0.03;
  hit(miss25);
  assert.equal(m25.alive, true, '精英 3% > 2.5% → 不斩杀');
  const kill25 = field({ ids: ['FGO-06'], enemyKey: 'ol_elite' });
  const k25 = kill25.enemies()[0];
  kill25.b.rng = () => 0.02;
  hit(kill25);
  assert.equal(k25.alive, false, '精英 2% < 2.5% → 斩杀');
  // Boss：骰子 0 也不斩杀
  const boss = field({ ids: ['FGO-06'], enemyKey: 'ol_boss' });
  const bt = boss.enemies()[0];
  boss.b.rng = () => 0;
  hit(boss);
  assert.equal(bt.alive, true, 'Boss 不触发斩杀');
  // 每次普通攻击 50% 回 1 技力
  const sp = field({ ids: ['FGO-06'] });
  const u = sp.unit(OP_ID);
  const sp0 = u.skill.sp;
  sp.b.rng = () => 0;
  sp.b.emit('attack', { attacker: u, targets: [sp.enemies()[0]], isSkill: false });
  assert.ok(u.skill.sp >= sp0 + 1 - 1e-9, `普攻回 1 技力（${sp0} → ${u.skill.sp}）`);
  // 有其它提高暴击率的饰品 → 暴伤 +50%（2 + 0.5 = 2.5；Boss 上不会先被斩杀掉）
  const crit = field({ ids: ['FGO-06', 'FGO-12'], enemyKey: 'ol_boss' });
  crit.b.rng = () => 0;
  const baseBoss = (() => { const c = field({ ids: [], enemyKey: 'ol_boss' }); c.b.rng = () => 0.99; return hit(c); })();
  assert.ok(Math.abs(hit(crit) - baseBoss * 2.5) < 1e-9, '暴伤 ×2.5');
});

test('FGO-13 彼方にかざす夢の噺：攻击 +50%、技能伤害 +100%，每次攻击 5% 强制眩晕 5 秒，第 10 次改 20 秒睡眠', () => {
  const h = field({ ids: ['FGO-13'] });
  const u = h.unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - 1500) < 1e-6, `攻击 1000 → 1500，实际 ${u.s.atk}`);
  assert.ok(Math.abs(hit(h, { isSkill: true }) - baseHit({ isSkill: true }) * 2) < 1e-9, '技能伤害 +100%');
  // 「强制，不可无视」：身上有 50% 抵抗，眩晕还是整整 5 秒
  h.b.addBuff(u, { key: 'resist', status: 'resist', mods: {}, data: { value: 0.5 } });
  h.b.rng = () => 0.049;                     // 5% 必中，50% 技力与击杀都不掺和（这里只发 attack 事件）
  const attack = () => h.b.emit('attack', { attacker: u, targets: [h.enemies()[0]], isSkill: false });
  attack();
  const stun = u.findBuff('stun');
  assert.ok(stun, '眩晕');
  assert.ok(Math.abs(stun.duration - 5) < 1e-9 && Math.abs(stun.timeLeft - 5) < 1e-9, `整整 5 秒（实际 ${stun.timeLeft}）`);
  // 第 10 次触发 → 20 秒睡眠（替掉那一次的眩晕）
  for (let i = 0; i < 9; i++) attack();
  assert.equal(u.mem.olFgo13, 10, '累计 10 次');
  const sleep = u.findBuff('sleep');
  assert.ok(sleep, '第 10 次陷入睡眠');
  assert.ok(Math.abs(sleep.timeLeft - 20) < 1e-9, `睡眠 20 秒（实际 ${sleep.timeLeft}）`);
  assert.equal(u.findBuff('stun'), null, '眩晕被睡眠替掉');
});

// ---------------------------------------------------------------------------------------------------------------------
// FGO-SP（业主 2026-10-31 第四批）：词条 + 它的装备[万色悠滞之核]

test('FGO-SP 快楽天・胎蔵曼荼羅：带着[万色悠滞之核]的干员视作拥有[调和]盟约、攻击力 +50%（不带它两样都没有）', () => {
  // ① 选了词条、但没人带装备：攻击力与盟约都不动
  const bare = field({ ids: ['FGO_SP'] });
  const u0 = bare.unit(OP_ID);
  assert.ok(Math.abs(u0.s.atk - 1000) < 1e-6, `没带装备：攻击仍是 1000（实际 ${u0.s.atk}）`);
  assert.equal(isMember(bare.b, u0, 'maniShip'), false, '没带装备：不是[调和]成员');

  // ② 带上词条发的装备：调和成员资格（既有 bond 成员判定）+ 攻击 1000 → 1500
  const h = field({ ids: ['FGO_SP'], items: [FGO_SP_ITEM] });
  const u = h.unit(OP_ID);
  assert.ok(Math.abs(u.s.atk - 1500) < 1e-6, `攻击 1000 → 1500，实际 ${u.s.atk}`);
  assert.equal(isMember(h.b, u, 'maniShip'), true, 'isMember：携带者视作拥有[调和]盟约');
  assert.deepEqual(bondMembers(h.b, 'p1', 'maniShip').map((x) => x.defId), [OP_ID], 'bondMembers 也认这名携带者');

  // ③ 没选词条：装备在身上也不给任何东西（记录里 buffs 为空，数值只由这条词条给，不会叠成 +100%）
  const noRelic = field({ ids: [], items: [FGO_SP_ITEM] });
  const u2 = noRelic.unit(OP_ID);
  assert.ok(Math.abs(u2.s.atk - 1000) < 1e-6, '没选词条：装备本身不带数值，攻击仍是 1000');
  assert.equal(isMember(noRelic.b, u2, 'maniShip'), false, '没选词条：成员资格也不给');

  // ④ 与其它攻击力词条同一口径（直接乘算相加）：FGO-SP +50% + LC-SP1 +30% ⇒ 1000 → 1800
  const both = field({ ids: ['FGO_SP', 'LC-SP1'], items: [FGO_SP_ITEM] });
  assert.ok(Math.abs(both.unit(OP_ID).s.atk - 1800) < 1e-6, `+50% 与 +30% 相加（实际 ${both.unit(OP_ID).s.atk}）`);

  // ⑤ 数据：这件装备只能由词条发放 —— 商店与装备池都抽不到（shopExcluded），也没有精锐形
  const rec = itemRecord(FGO_SP_ITEM);
  assert.ok(rec, 'data/items.json 里有[万色悠滞之核]');
  assert.equal(rec.name, '万色悠滞之核');
  assert.equal(rec.shopExcluded, true);
  assert.equal(isShopItem(rec), false, 'isShopItem 为假：商店槽 / 道具补给 / 机密商店 / 装备池都跳过它');
  assert.equal(rec.goldenId, null, '没有精锐形（upgradeNum 100，永不合体）');
  assert.deepEqual(rec.buffs, [], '记录本身不带数值（数值在词条本体，见 ③）');
  // [ASSUMED] derived icon：以变形同构体那张为基底派生 trap_ol_core（research 25 的显式 iconId 覆盖）；
  // trapId 仍指变形同构体那条同源记录（工具按它反查，运行时 match/sim 不读），两者故意不同名
  assert.equal(rec.trapId, 'trap_1073_acarm073');
  assert.equal(rec.iconId, 'trap_ol_core');
});

// ---------------------------------------------------------------------------------------------------------------------
// 开关：普通 / 湮灭 / 炸惊一帧不变

test('不是超限局：带着词条列表也一个监听器都不挂、一点数值都不改', () => {
  const ids = ['LC-002', 'LC-004', 'FGO-07', 'FGO_X', 'LC-SP3', 'LC-EX2'];
  const h = field({ ids, flags: { overlimit: false } });
  const u = h.unit(OP_ID);
  const c = field({ ids: [] });
  // install 的开关：再装一次，`_hooks` 里一条监听器都不许多
  const snapshot = () => Object.fromEntries(Object.entries(h.b._hooks).map(([k, v]) => [k, v.length]));
  const before = snapshot();
  installOverlimitRelics(h.b);
  assert.deepEqual(snapshot(), before, 'flags.overlimit 为假：一个监听器都不挂');
  assert.equal(u.buffs.length, c.unit(OP_ID).buffs.length, 'buff 一条都不多');
  assert.ok(Math.abs(hit(h) - baseHit()) < 1e-9, '伤害原样');
});

test('是超限局但一条词条都没选：同样不挂监听器', () => {
  const h = field({ ids: [] });
  const snapshot = () => Object.fromEntries(Object.entries(h.b._hooks).map(([k, v]) => [k, v.length]));
  const before = snapshot();
  installOverlimitRelics(h.b);
  assert.deepEqual(snapshot(), before, '没有词条：一个监听器都不挂');
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
});
