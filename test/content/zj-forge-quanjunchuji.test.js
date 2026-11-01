// test/content/zj-forge-quanjunchuji.test.js — 两张遗留卡的引擎侧：全军出击（wave）与锻造器/黑闪（战斗侧）。
//
// ① 全军出击 (`ejibian_quanjunchuji`)：boss 波里非领袖小怪整体换成随机悬赏怪（source: modref/v2.1/match/waves.js）。
//    门 = 卡在 `enemyJibianCards` 里；只换 key，不动数量/时间（与 countMul 不叠加）。
// ② 锻造器 (`server/sim/content/forge.js`)：暴击（双倍 + `dmg.crit`）与吸血，读 `s.critRate` / `s.lifesteal`；
//    门 = `battle.flags.forge` 或炸惊视图 `battle.zj`，两者都没有 ⇒ 一行都不装。
// ③ 黑闪 (`jibian_heishan`)：+50 暴击率，靠 forge 的 `dmg.crit` 回 3 技力。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { applyQuanjunchuji, bountyEnemyKeys } from '../../server/match/waves.js';
import { install as installForge } from '../../server/sim/content/forge.js';
import { forgeModsEmpty } from '../../shared/forgeData.js';

const CARD = 'ejibian_quanjunchuji';

/** 一个够用的假 gd：只有 waves 侧用到的几个查表口。 */
function fakeGd({ enemies = {}, bounty = [] } = {}) {
  return {
    choices: { cards: { bounty } },
    enemy: (id) => enemies[id] || null,
    enemyScale: () => ({ hp: 1, atk: 1, def: 1 }),
  };
}

const ENEMIES = {
  enemy_boss_1: { key: 'enemy_boss_1', rank: 'BOSS' },
  enemy_grunt_1: { key: 'enemy_grunt_1', rank: 'NORMAL' },
  enemy_grunt_2: { key: 'enemy_grunt_2', rank: 'NORMAL' },
  enemy_bounty_1: { key: 'enemy_bounty_1', rank: 'NORMAL' },
  enemy_bounty_2: { key: 'enemy_bounty_2', rank: 'NORMAL' },
};

/** 一张快照用的 spawn 列表：1 个领袖 + 1 个部位 + 2 个小怪。 */
const spawnsOf = () => ([
  { enemyKey: 'enemy_boss_1', count: 1, time: 0, tag: 'boss' },
  { key: 'enemy_grunt_1', count: 1, time: 2, tag: 'part' },
  { enemyKey: 'enemy_grunt_1', count: 3, time: 5, interval: 1, tag: 'normal' },
  { enemyKey: 'enemy_grunt_2', count: 2, time: 8, interval: 1, tag: 'normal' },
]);

test('bountyEnemyKeys：只收可抽的悬赏怪（draft:false / 不存在记录的被剔除）', () => {
  const gd = fakeGd({
    enemies: ENEMIES,
    bounty: [
      { enemyKey: 'enemy_bounty_1' },
      { enemyKey: 'enemy_bounty_1' },                       // 重复
      { enemyKey: 'enemy_bounty_2', draft: false },         // 不在抽取池
      { enemyKey: 'enemy_bounty_x', draft: true },          // 数据里没有这条敌人
      { enemyKey: 'enemy_grunt_2', draftExcluded: true },   // 被排除
    ],
  });
  assert.deepEqual(bountyEnemyKeys(gd), ['enemy_bounty_1']);
});

test('全军出击：命中卡时非领袖小怪整体换成悬赏怪，领袖与部位保留，数量/时间不变', () => {
  const gd = fakeGd({
    enemies: ENEMIES,
    bounty: [{ enemyKey: 'enemy_bounty_1' }, { enemyKey: 'enemy_bounty_2' }],
  });
  const spawns = spawnsOf();
  const before = spawns.map((s) => ({ n: s.count, t: s.time, i: s.interval }));
  let n = 0;
  const rng = () => { n++; return 0; };           // 总是取池子第一个（确定性）
  applyQuanjunchuji(gd, 8, spawns, [CARD], rng, 'enemy_boss_1', null);

  assert.equal(spawns[0].enemyKey, 'enemy_boss_1', '领袖保留');
  assert.equal(spawns[0].tag, 'boss');
  assert.equal(spawns[1].key, 'enemy_grunt_1', '部位保留');
  assert.equal(spawns[1].tag, 'part');
  for (const i of [2, 3]) {
    assert.equal(spawns[i].enemyKey, 'enemy_bounty_1', `小怪 ${i} 换成悬赏怪`);
    assert.equal(spawns[i].tag, 'bounty');
    assert.ok(spawns[i].preview, '换了 key 也要重算卡面预览');
    assert.deepEqual({ n: spawns[i].count, t: spawns[i].time, i: spawns[i].interval }, before[i], '数量/时间/间隔不动');
  }
  assert.equal(n, 2, '只对小怪掷骰（领袖/部位不消耗随机数）');
});

test('全军出击：没这张卡 / 没有悬赏池 ⇒ 一个字段都不改（官方与湮灭零影响）', () => {
  for (const cards of [null, [], ['ejibian_xianfazhiren']]) {
    const gd = fakeGd({ enemies: ENEMIES, bounty: [{ enemyKey: 'enemy_bounty_1' }] });
    const spawns = spawnsOf();
    const snap = JSON.stringify(spawns);
    applyQuanjunchuji(gd, 8, spawns, cards, () => 0, 'enemy_boss_1', null);
    assert.equal(JSON.stringify(spawns), snap, `cards=${JSON.stringify(cards)} 不改动`);
  }
  // 池子空了：同样不改
  const gd = fakeGd({ enemies: ENEMIES, bounty: [] });
  const spawns = spawnsOf();
  const snap = JSON.stringify(spawns);
  applyQuanjunchuji(gd, 8, spawns, [CARD], () => 0, 'enemy_boss_1', null);
  assert.equal(JSON.stringify(spawns), snap);
  // 领袖段（round 2 那种 BOSS 记录）也不会被换
  const gd2 = fakeGd({ enemies: ENEMIES, bounty: [{ enemyKey: 'enemy_bounty_1' }] });
  const list = [{ enemyKey: 'enemy_boss_1', count: 1, time: 0 }];
  applyQuanjunchuji(gd2, 8, list, [CARD], () => 0, null, null);
  assert.equal(list[0].enemyKey, 'enemy_boss_1', 'rank BOSS 的记录保留');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 锻造器 / 黑闪

const OP = 'chess_char_1_01_a';

function forgeBattle({ flags = {}, effects = [], modeId = 'mode_single_zhajing' } = {}) {
  const h = makeBattle({
    units: [{ chessId: OP, row: 9, col: 6 }],
    enemies: [{ key: 'e1', time: 0, route: { motion: 'WALK', start: [9, 7], end: [9, 7], checkpoints: [] } }],
    defs: { enemies: { e1: enemyRec({ key: 'e1', hp: 1e9, atk: 0, def: 0, speed: 0 }) } },
    seed: 7,
    modeId,
    playerEffects: effects.map((k) => ({ key: k })),
    flags: { startOpCooldown: 0, ...flags },
    autoFinish: false,
    timeLimit: 600,
    captureNoisy: false,
  });
  // forge 已在 DOMAIN_NAMES 里（engine-core 注册），makeBattle 的 installContent 会装它；
  // 这里**不再**手动 install（重复 install 会挂两次 hit 钩子 —— 模块内已有幂等护栏，见下一条用例）。
  return h;
}

test('forgeModsEmpty：全零 = 空', () => {
  assert.equal(forgeModsEmpty(null), true);
  assert.equal(forgeModsEmpty({ atk: 0, spMul: 1 }), true);
  assert.equal(forgeModsEmpty({ range: 1 }), false);
  assert.equal(forgeModsEmpty({ spMul: 0.9 }), false);
});

test('锻造器：没有 flags.forge 也不是炸惊视图 ⇒ install 一行都不装', () => {
  // 官方模式 + 没有 flags.forge：forge 自己不装（installForge 立刻 return）
  const h = forgeBattle({ modeId: 'mode_multi_normal' });
  h.step(0.5);
  const u = h.unit(OP);
  assert.deepEqual((u.buffs || []).filter((b) => String(b.key).startsWith('forge:')), []);
  u.s.critRate = 1;                       // 即使有暴击率也不会被读
  let crit = null;
  h.b.on('hit', (ctx) => { crit = ctx.dmg.crit ?? null; }, { priority: -1000 });
  h.b.dealDamage(u, h.enemies()[0], { amount: 100, type: 'phys' });
  assert.equal(crit, null, '没有 forge ⇒ 不打暴击标记');
});

test('锻造器 + 黑闪：crit 来自 buff 求和（forge 的 crit + 黑闪的 +50%），dmg.mul 翻倍 + dmg.crit 标记 + 回 3 技力', () => {
  // forge 的 crit 0.5 + 黑闪 buff 0.5 = 1.0 ⇒ 必定暴击（确定性，不依赖 rng）
  const h = forgeBattle({ flags: { forge: { crit: 0.5 } }, effects: ['jibian:jibian_heishan'] });
  h.step(0.5);
  const u = h.unit(OP);
  const e = h.enemies()[0];
  // 两个来源的 buff 都在（engine 的 buffs.js 没有 critRate 键，所以 forge 的钩子自己求和）
  assert.ok(u.findBuff('forge:crit'), 'forge 的 critRate buff 在');
  assert.equal(u.findBuff('forge:crit').mods.critRate, 0.5);
  assert.ok(u.findBuff('jibian:heishan:crit'), '黑闪 critRate buff 在');
  assert.equal(u.findBuff('jibian:heishan:crit').mods.critRate, 0.5);
  const spBefore = u.skill && u.skill.sp;
  let seen = null;
  h.b.on('hit', (ctx) => { seen = { crit: ctx.dmg.crit, mul: ctx.dmg.mul }; }, { priority: -1000 });
  h.b.dealDamage(u, e, { amount: 500, type: 'phys' });
  assert.ok(seen, '有一次命中');
  assert.equal(seen.crit, true, 'dmg.crit 被 forge 打上标记');
  assert.equal(seen.mul, 2, '暴击 = 双倍');
  if (spBefore != null && u.skill) assert.ok(u.skill.sp >= spBefore + 3 - 1e-9, `黑闪回技力：${spBefore} → ${u.skill.sp}`);
});

test('锻造器：vamp 走 buff 求和，按比例回自己的血', () => {
  const h = forgeBattle({ flags: { forge: { vamp: 0.5 } } });
  h.step(0.5);
  const u = h.unit(OP);
  const e = h.enemies()[0];
  assert.equal(u.findBuff('forge:vamp').mods.lifesteal, 0.5);
  u.hp = Math.round(u.s.maxHp * 0.5);
  const before = u.hp;
  h.b.dealDamage(u, e, { amount: 200, type: 'phys' });
  assert.ok(u.hp > before, `吸血生效：${before} → ${u.hp}`);
});

test('锻造器：flags.forge 的 range / block / spMul 落成 rangeExtend / blockCnt / spCostMul', () => {
  const h = forgeBattle({ flags: { forge: { range: 1, block: 1, spMul: 0.9 } } });
  h.step(0.5);
  const u = h.unit(OP);
  const stats = u.findBuff('forge:stats');
  assert.ok(stats, 'rangeExtend / blockCnt 的 buff 在');
  assert.equal(stats.mods.rangeExtend, 1);
  assert.equal(stats.mods.blockCnt, 1);
  assert.ok(Math.abs(u.skill.spCostMul - 0.9) < 1e-9, `spCostMul ${u.skill.spCostMul}`);
  // 幂等：重复 deploy / battleStart 不会连乘；重复 install 也不会挂第二个 hit 钩子（模块内有护栏）
  h.b.emit('deploy', { unit: u, initial: false });
  h.b.emit('battleStart');
  installForge(h.b);
  assert.ok(Math.abs(u.skill.spCostMul - 0.9) < 1e-9, `幂等后仍是 0.9（实际 ${u.skill.spCostMul}）`);
  // 一次命中只翻一倍（双 install 也不该变四倍）
  u.findBuff('forge:crit') || u.addBuff?.(u, { key: 'forge:crit', mods: { critRate: 1 } });
  h.b.addBuff(u, { key: 'forge:crit', mods: { critRate: 1 }, persist: true, refresh: 'replace' });
  let mul = null;
  h.b.on('hit', (ctx) => { mul = ctx.dmg.mul; }, { priority: -1000 });
  h.b.dealDamage(u, h.enemies()[0], { amount: 100, type: 'phys' });
  assert.equal(mul, 2, '命中只翻一倍');
});

// ── 共享场（Final Assault / 隐秘核心 / 联防）：`flags.forgeByPlayer`（engine-core 2026-10-28 扩的形状） ──

test('锻造器：共享场读 flags.forgeByPlayer[unit.ownerId]（boss / 隐秘核心 / 联防）', () => {
  // 本玩家的那一份生效
  const on = forgeBattle({ flags: { forgeByPlayer: { p1: { crit: 1, range: 2, spMul: 0.8 } } } });
  on.step(0.5);
  const u = on.unit(OP);
  assert.equal(u.findBuff('forge:crit').mods.critRate, 1);
  assert.equal(u.findBuff('forge:stats').mods.rangeExtend, 2);
  assert.ok(Math.abs(u.skill.spCostMul - 0.8) < 1e-9, `spCostMul ${u.skill.spCostMul}`);
  // 暴击率 1.0 ⇒ 必定暴击（共享场也走同一套钩子）
  let crit = null;
  on.b.on('hit', (ctx) => { crit = ctx.dmg.crit ?? null; }, { priority: -1000 });
  on.b.dealDamage(u, on.enemies()[0], { amount: 100, type: 'phys' });
  assert.equal(crit, true);

  // 表里只有别人 ⇒ 这名单位这一场没有加成（不是 0 加算，是一条都不挂）
  const off = forgeBattle({ flags: { forgeByPlayer: { p2: { crit: 1, range: 2, spMul: 0.8 } } } });
  off.step(0.5);
  const u2 = off.unit(OP);
  assert.deepEqual((u2.buffs || []).filter((b) => String(b.key).startsWith('forge:')), []);
  assert.equal(u2.skill.spCostMul, 1);
});

test('锻造器：两个形状同时在时共享场那一份优先（不回落到扁平 forge）', () => {
  const h = forgeBattle({ flags: { forge: { range: 1 }, forgeByPlayer: { p1: { range: 3 } } } });
  h.step(0.5);
  assert.equal(h.unit(OP).findBuff('forge:stats').mods.rangeExtend, 3, '用 forgeByPlayer 的 3，不是扁平 forge 的 1');
});

test('锻造器：forgeByPlayer 为空 / 形状不对 ⇒ 不崩且一条都不挂', () => {
  for (const flags of [{ forgeByPlayer: {} }, { forgeByPlayer: null }, { forgeByPlayer: { p1: null } }]) {
    const h = forgeBattle({ flags });
    h.step(0.5);
    assert.equal(h.b.errorCount, 0, `${JSON.stringify(flags)} 无错误`);
    assert.deepEqual((h.unit(OP).buffs || []).filter((b) => String(b.key).startsWith('forge:')), []);
  }
});
